import { VisionUnsupportedError, resolveCredential } from "@panoma/ai";
import {
  ScreenshotError,
  readScreenshot,
  readShots,
  readTaste,
  type TasteTopic,
} from "@panoma/core";
import { getProject, modelSpendToday, type ModelSpend } from "@panoma/db";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { cliName } from "@/lib/cli-name";
import { localeFrom, t, type Locale } from "@/lib/i18n";
import {
  budgetFrom,
  buildLookPrompt,
  estimateLookTokens,
  type LookSubject,
} from "@/lib/look";
import { LOOK_KIND, runLook, type LookImage } from "@/lib/look-run";
import { pickShot } from "@/lib/shots";

/**
 * Look at a screen and it says what is wrong, quoting what you had already said.
 *
 * It's the turn of the middle done by someone else: the agent delivers, you open the screen, judge
 * it, and draft the next order. This route performs the second and third steps. What it returns is
 * not an opinion on design—there are plenty of those, and none are yours—but a list of violations
 * of `TASTE.md`, each with the sentence it breaks and the task that should be assigned. A finding
 * that does not stem from one of your sentences does not come out of here; the filter is in
 * `lib/look.ts` and the discards are counted on the receipt.
 *
 * ── The image comes from two places, and neither is a route ────────────────────────
 *
 * Panoma does not take the capture: your project does not start nor does it carry a browser inside
 * (see `screenshot.ts` ). Either it arrives in base64 inside the body —the terminal reads it and
 * sends it, the browser uploads it from the viewer's disk— or it is requested **by its name** one
 * of those that the agent left in the mailbox of this project.
 *
 * The second thing is new and necessary for this to have a screen: the page cannot read
 * `.panoma/shots/home.png`, and making the browser download four megabytes only to send them back
 * to the server that has them on its own disk is paying for two trips for nothing. What still
 * doesn't happen is for a route to enter through the body: the name is searched in the mailbox
 * list, and what opens is the route that `readShots` put. Choosing from a list is not opening what
 * you're told; the whole reason is in `lib/shots.ts`.
 *
 * And that is why the mailbox also requires `localOperatorOnly`. Uploading your own image from the
 * mobile is sending bytes you already had; requesting one from the mailbox is ordering **this**
 * machine to open one of its own files and send it to a provider, which is the kind of thing the
 * `panoma up --network` key does not authorize. The key allows you to look, not hands on the
 * keyboard.
 *
 * None of this goes through a scratcher: there is no way to cross out pixels. The command says it
 * before sending it, the screen says it, and the expense book notes it — which keeps track of how
 * many images were sent precisely so that this account can be checked.
 *
 * ── Refuses before spending, in three cases ────────────────────────────────────────
 *
 * Without a portrait and without a direction there is no yardstick, so all the findings would
 * collapse when parsing: the call would have been paid for producing a zero. Without the day's
 * budget, the same story for a different reason. And with a provider that cannot receive
 * images, even worse: the response would be a self-assured judgment on a screen that nobody looked
 * at, and `@panoma/ai` cuts that off before calling anyone.
 *
 * ── And what is said is kept ─────────────────────────────────────────────────────
 *
 * Until today, a look was printed and lost when scrolling. Now it leaves a row—findings
 * included—and that is not an ornament: it is what allows something other than a person to trigger
 * it. The watcher looks at a folder, and a folder that does not change still contains the same
 * capture tomorrow; without a row that says 'this has already been seen,' the automatic trigger is
 * a loop that pays for the same image. It is written by `runLook`, which is the piece shared by
 * this path and the watcher.
 */

/** An image takes longer to upload and to look at than a text prompt. */
export const maxDuration = 180;

/** The four types that the three families of providers accept today. See `ImageType`. */
const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** The class with which this route writes in the expense book, and for which it is counted. */
const KIND = LOOK_KIND;

/**
 * What the agent has left in the mailbox of this project.
 *
 * The root comes out of the catalog by its slug and **never from the client**, which is the same
 * rule with which `/api/md/apply` decides where to write. Here only a known folder within that
 * root is listed, so there is not even a path that could come from outside: what is received is a
 * slug and what is replied is the content of `<raíz>/.panoma/shots`.
 *
 * Respond with `exists: false` when the channel is not set up, and with an empty list when it is
 * and no one has left anything. They are two different sentences in the terminal because they are
 * two different situations: one is fixed with `panoma md init` and the other by asking the agent
 * to do their job.
 */
export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug) return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });

  const { db: database } = await db();
  const data = await getProject(database, slug);
  if (!data) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  const inbox = await readShots(data.project.root, { limit: SHOTS_SHOWN });
  return Response.json({
    slug: data.project.slug,
    dir: inbox.dir,
    exists: inbox.exists,
    skipped: inbox.skipped,
    shots: inbox.shots.map((shot) => ({
      name: shot.name,
      bytes: shot.bytes,
      at: shot.at.toISOString(),
    })),
  });
}

/**
 * How many deliveries are taught.
 *
 * The one that matters is the last one: what the agent just did. The others exist so you can say
 * 'there are four and you are looking at the one from a minute ago,' which is what prevents you
 * from believing that the mailbox had only one thing inside.
 */
const SHOTS_SHOWN = 10;

interface LookBody {
  slug?: unknown;
  image?: unknown;
  /**
   * The name of a screenshot of the mailbox, as an alternative to sending the image.
   *
   * A name, never a path: it is searched in the `.panoma/shots` listing of this project and what
   * opens is what `readShots` returned. See `lib/shots.ts` and header.
   */
  shot?: unknown;
  /**
   * What the image weighs, for the essay.
   *
   * The essay exists to teach the budget before spending it, and for that, the image is not
   * needed: its size is needed. Uploading four and a half megabytes twice —once to ask how much it
   * costs and another to spend it— would be paying the entire shipping for the privilege of being
   * told how much it costs. With `image` present, this field is ignored and what has really
   * arrived is measured.
   */
  imageBytes?: unknown;
  mediaType?: unknown;
  topic?: unknown;
  dryRun?: unknown;
}

export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  const body = (await request.json().catch(() => ({}))) as LookBody;

  if (typeof body.slug !== "string" || body.slug === "") {
    return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });
  }

  const dryRun = body.dryRun === true;
  const wanted = typeof body.shot === "string" && body.shot !== "" ? body.shot : undefined;

  /*
    And if what is requested is one from the mailbox, also from this machine. It goes before
    touching the disk: what is being ordered is for this computer to open one of its files and
    send it to a provider, and that is not authorized by the network key. See the header.
   */
  if (wanted !== undefined) {
    const far = localOperatorOnly(request);
    if (far) return far;
  }

  const { db: database } = await db();
  const data = await getProject(database, body.slug);
  if (!data) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  /*
    Without a stable identity one does not look, and this is new: before one looked and nothing
    was kept.
    The identity comes from the root commit, so a folder without git has none, and it is the same
    door through which this project does not appear in the rest of Twin — its references cannot be
    attributed and its direction cannot be written. Since the look leaves the row, looking without
    identity would be like paying for a call whose verdict cannot be hung anywhere or found again:
    it would be forgotten when the tab is closed, and the watcher would repeat it tomorrow.
   */
  const identity = data.project.identity;
  if (identity === null) {
    return Response.json({ error: t(locale, "look.noIdentity") }, { status: 409 });
  }

  /*
    The capture: the one from the mailbox that is requested by its name, or the one that arrives
    in the body.
    The one from the mailbox is also read in full in the test, and the reason why the terminal's
    test travels without an image does not apply there: the expensive part there was **uploading**
    four and a half megabytes twice over the network, and this file is on this disk. Reading it
    takes a few milliseconds and in return the test measures what is actually going to travel
    instead of assuming a figure from the body.
   */
  let image = "";
  let mediaType = "";
  let shot: string | undefined;
  let shotBytes = 0;

  if (wanted !== undefined) {
    const found = await pickShot(data.project.root, wanted);
    if (found === undefined) {
      return Response.json({ error: t(locale, "look.noShot", { name: wanted }) }, { status: 404 });
    }
    try {
      const read = await readScreenshot(found.path);
      image = read.data;
      mediaType = read.mediaType;
      shotBytes = read.bytes;
      shot = found.name;
    } catch (error) {
      /*
        A file that was in the listing and cannot be read when opened: it was deleted between the
        two instances, or it is too large. It is not a catalog error nor the fault of the
        requester, so it is reported with the name first and with the size when it was known.
       */
      if (!(error instanceof ScreenshotError)) throw error;
      const detail = error.bytes === undefined ? wanted : `${wanted} · ${error.bytes} B`;
      return Response.json(
        { error: t(locale, "look.unreadableShot", { detail }) },
        { status: 409 },
      );
    }
  } else {
    image = typeof body.image === "string" ? body.image : "";
    // In the essay the image may be missing; in the look of truth, it cannot. The guy is verified
    // in both cases: it is the only way for the essay to promise a call that takes off.
    if (!dryRun && image === "") {
      return Response.json({ error: t(locale, "look.noImage") }, { status: 400 });
    }
    mediaType = typeof body.mediaType === "string" ? body.mediaType : "";
  }

  if (!TYPES.has(mediaType)) {
    return Response.json({ error: t(locale, "look.badImage") }, { status: 400 });
  }

  /*
    The portrait comes out of the file and not from the database, and it is the fundamental
    decision of this route.
    `TASTE.md` is exactly what goes down through `AGENTS.md` to all your agents: if the critic
    judged according to database beliefs instead of the file, they would be judging with a yardstick
    that no one used to build. And there is one case where they really disagree: editing the file
    by hand is the undo — `/api/twin/taste` reconciles it — so between an edit and the next
    reconciliation, the file rules. Letting it rule here as well is what makes deleting a line
    stop being flagged **on the spot**.
   */
  const profile = await readTaste();
  const north = data.decision?.north ?? undefined;
  if (profile.lines.length === 0 && !north) {
    return Response.json({ error: t(locale, "look.noProfile", { cli: cliName() }) }, { status: 409 });
  }

  const cap = budgetFrom(process.env["PANOMA_LOOK_BUDGET"]);
  const spent = await modelSpendToday(database, KIND);
  if (spent.calls >= cap) {
    return Response.json(
      {
        error: t(locale, "look.budgetSpent", { used: spent.calls, cap }),
        budget: bare(spent, cap),
      },
      { status: 429 },
    );
  }

  const subject: LookSubject = {
    lines: profile.lines,
    north,
    project: data.project.name,
    topic: topicOf(body.topic),
  };
  const built = buildLookPrompt(subject, { locale });

  const credential = await resolveCredential().catch((error: unknown) => error as Error);
  if (credential instanceof Error) return failure(locale, credential, { budget: bare(spent, cap) });

  if (dryRun) {
    return Response.json({
      statements: built.labels.size,
      /*
        The text tokens and the image bytes, separately and without adding them. What an image
        costs in tokens is calculated by each provider with their formula, and choosing one to
        show here would be taking that calculation as valid for the other four. See
        `estimateLookTokens`.
       */
      estimatedTokens: estimateLookTokens(built),
      imageBytes: imageBytesOf(body, image),
      provider: credential.provider.id,
      model: credential.model,
      budget: bare(spent, cap),
    });
  }

  const picture: LookImage = {
    data: image,
    mediaType,
    bytes: shot === undefined ? imageBytesOf(body, image) : shotBytes,
    ...(shot === undefined ? {} : { shot }),
  };

  let receipt;
  try {
    receipt = await runLook(database, {
      subject,
      image: picture,
      identity,
      // From here it is always requested by someone: through the screen button or through the
      // terminal.
      fired: "hand",
      locale,
    });
  } catch (error) {
    return failure(locale, error, { budget: bare(spent, cap) });
  }

  return Response.json({
    /* The row that has been left, so that your findings can be handled without overloading. */
    lookId: receipt.lookId,
    findings: receipt.findings,
    /*
      Unsupported judgments are counted and taught. The model will have opinions about your
      screen—it has opinions about everything—and saying how many have been tossed is what
      distinguishes 'this comes from your sentences' from 'this comes from its taste.' It is also
      the price of having the portrait halfway done, expressed with a number.
     */
    dropped: receipt.dropped,
    ...(receipt.unreadable ? { unreadable: true } : {}),
    statements: receipt.statements,
    model: `${receipt.provider}/${receipt.model}`,
    ...(receipt.usage ? { usage: receipt.usage } : {}),
    budget: withCall(spent, cap, receipt.usage),
  });
}

/**
 * What the image weighs: what has arrived, or what they say it weighs.
 *
 * One always prefers what has arrived. The number of the body is written by whoever calls and
 * nobody verifies it; it serves so that the essay does not require uploading the image, and as
 * soon as there are real bytes ahead, there is no need to believe anyone.
 */
function imageBytesOf(body: LookBody, image: string): number {
  if (image !== "") return Math.floor((image.length * 3) / 4);
  const declared = body.imageBytes;
  return typeof declared === "number" && Number.isFinite(declared) && declared > 0
    ? Math.floor(declared)
    : 0;
}

/** What was spent today, with the limit next to it. It is what makes the day's spending visible. */
interface Budget {
  used: number;
  cap: number;
  input: number;
  output: number;
  /** Today's calls that did not state their consumption. Without this, a zero would be read as free. */
  unmetered: number;
}

/** The budget as it was before this call. */
function bare(spent: ModelSpend, cap: number): Budget {
  return {
    used: spent.calls,
    cap,
    input: spent.input,
    output: spent.output,
    unmetered: spent.unmetered,
  };
}

/** The budget already with this call included, without asking the database again. */
function withCall(spent: ModelSpend, cap: number, usage?: { input: number; output: number }): Budget {
  const before = bare(spent, cap);
  return {
    ...before,
    used: before.used + 1,
    input: before.input + (usage?.input ?? 0),
    output: before.output + (usage?.output ?? 0),
    unmetered: before.unmetered + (usage === undefined ? 1 : 0),
  };
}

/**
 * The requested matter, if it has the form of matter. Anything else is not asking for anything.
 *
 * By form and not against a list, just like in the engine: the vocabulary is open — the classifier
 * can coin a subject — and a whitelist would leave out exactly the one the machine has just
 * discovered.
 */
function topicOf(value: unknown): TasteTopic | undefined {
  if (typeof value !== "string") return undefined;
  return TOPIC.test(value) ? value : undefined;
}

/** The same way that `topicOf` requires in the engine. Whoever does not have it is not a material. */
const TOPIC = /^[a-z][a-z0-9-]{0,23}$/;

/**
 * The flaw, in the viewer's language.
 *
 * Just like in distillation, with one more branch: a provider who does not know how to receive
 * images is not a credential or network error, it is a configuration that does not allow this
 * command, and it deserves its own phrase because its remedy is also different — change provider,
 * not retry. The message inside comes in fixed Spanish from `@panoma/ai` and is not translated: it
 * is what the provider said.
 */
function failure(locale: Locale, error: unknown, extra: object): Response {
  const detail = (error as Error).message;

  if (error instanceof VisionUnsupportedError) {
    return Response.json(
      { ...extra, error: t(locale, "look.noVision", { detail }) },
      { status: 409 },
    );
  }

  const missing =
    detail.includes("credencial") ||
    detail.includes("Credential") ||
    detail.includes("proveedor");

  return Response.json(
    {
      ...extra,
      error: t(locale, "look.failed", { detail }),
      ...(missing ? { hint: t(locale, "distill.noProvider", { cli: cliName() }) } : {}),
    },
    { status: 502 },
  );
}
