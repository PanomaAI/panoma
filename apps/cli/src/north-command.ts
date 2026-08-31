import pc from "picocolors";
import type { Flags } from "./args";
import { plural, say, type MessageKey } from "./messages";
import type { ProjectMoves } from "./next-command";
import { unreachable } from "./server";
import { reportUrl } from "./today";
import { catalogFetch } from "./catalog-fetch";

/**
 * `panoma north` — the place to write the north, which did not exist anywhere.
 *
 * `panoma next` opens by asking for a phrase —«no one has written what “finished” is here, so any
 * order is a guess»— and sent the project index to say it. The index has no place.
 * `POST /api/north` works and is tested, and there was not a single screen in the whole product
 * that knew how to call it: the only entry in the catalog that no one but the person could deduce
 * was also the only one that could not be made. A command that sends you to a place that cannot
 * help you is a broken promise, and it is the first one taken by whoever executes `panoma next`
 * for the first time.
 *
 * ── It is written by HTTP, like everything else ───────────────────────────────────────────
 *
 * No opening the database from here. The catalog is a single-writer PGlite and it already got
 * corrupted once from having two hands inside; the header of `packages/db/src/queue.ts` tells the
 * whole story. The CLI talks to the server and the server writes, which is the same rule that
 * forces `twin mine --save` to go through `/api/twin/verdicts`.
 *
 * And the rules of the sentence are from the route, not from here. Empty, over three hundred
 * characters, or on a project without a stable identity: the three "no's" are written by the
 * catalog with their reason, and this command shows them exactly as they are. Copying them here
 * would create two places to change the limit and one of the two would be left behind. The only
 * one that is accompanied is 409 —"does not yet have a stable identity"—, and only to place below
 * the command that fixes it: of the three, it is the only one that is not answered by rewriting.
 *
 * ── What this terminal can know about a north, and what it cannot ─────────────────────────
 *
 * Reading is more expensive than writing, because there is no route that gives back the north of a
 * project. What exists is the daily report, which carries in `nextMoves` the north of each project
 * **with something pending** — and there is the edge: one in progress, with its README, without
 * notices and with its north written has nothing pending, so it does not travel in the report.
 *
 * From that same edge comes what can indeed be affirmed. The director's first rule
 * (`apps/web/lib/next-moves.ts`) proposes to write the north whenever it is not there, it
 * applies to any project and goes first on the list, so **any project without direction is in the
 * report**. From there two certainties: the count of those missing is exact, and from a project
 * that the report does not include, it is known that its direction is written even if the sentence
 * cannot be read.
 *
 * That is decided by the three screens. The list shows those that are read and separately counts
 * those that are not, without considering them empty. A loose project that does not travel shows
 * it, instead of pretending it is blank. And writing over one of these comes to a halt: the
 * sentence that would exist would be lost without anyone ever seeing it, which is exactly what
 * this command exists to prevent. With `--force` it is done the same way, as with the quarantine
 * of `panoma run`.
 *
 * ── The census comes from two questions, and not from one ───────────────────────────────────────
 *
 * The denominator —how many projects there are— comes from `/api/catalog` and not from the
 * `catalog` field of the report, which also counts the sections. `/api/catalog` discards them with
 * the same condition as the director's query, so the two lists cover the same set and subtracting
 * them means something. Along the way, it brings the path of each project, which is what is needed
 * to be able to write `panoma scan <ruta> --save` under a 409.
 */

/** What is missing from `/api/catalog`, which returns quite a lot more. */
interface CatalogProject {
  slug: string;
  name: string;
  root: string;
}

/**
 * What is known about the north of a project from the terminal, which are three things and not
 * two.
 *
 * `unlisted` is not 'I don't know': it is 'it exists and cannot be read from here,' and that is
 * why it has its own case instead of slipping in as an empty string. A project that the report
 * does not bring is one that has nothing pending, and having no direction always is.
 */
export type NorthStatus =
  | { kind: "written"; north: string }
  | { kind: "blank" }
  | { kind: "unlisted" };

export interface NorthProject {
  slug: string;
  name: string;
  /** The folder, in order to be able to write the exact `panoma scan` when the identity is missing. */
  root: string;
  status: NorthStatus;
}

/** Slug column width in the list. It is what you type, so it goes first. */
const SLUG_COLUMN = 22;

/**
 * What fits of a north in a line of the list without breaking it.
 *
 * The route accepts up to three hundred characters and does well: a two-line sentence is still a
 * sentence. But eighty two-line projects are a scroll, and here what is read is the whole. What
 * doesn't fit is cut off with ellipses and is read in full a command away, which is the same
 * treatment that `twin mine` gives to its quotes.
 */
const LINE_MAX = 64;

export async function northCommand(parsed: Flags): Promise<number> {
  const args = northArgs(parsed.positionals.slice(1));

  const census = await requestCensus(parsed.api);
  if (census.state === "unreachable") return unreachable(parsed.api);
  if (census.state === "error") {
    process.stderr.write(pc.red(`${census.error}\n`));
    if (census.hint) process.stderr.write(pc.dim(`${census.hint}\n`));
    return 1;
  }

  if (args.mode === "list") {
    process.stdout.write(`${northLines(census.projects).join("\n")}\n`);
    return 0;
  }

  /*
    By exact slug and not by similarity, just like in `next` and the opposite of `open`. Opening
    the folder that looks most similar costs a `⌘W`; writing the north of the one that looks most
    similar deletes a sentence from another project, and on top of that, it deletes it without
    anyone asking for it.
   */
  const chosen = census.projects.find((project) => project.slug === args.slug);
  if (!chosen) {
    process.stderr.write(
      pc.red(`${say("north.noSuchProject", { query: args.slug })}\n`) +
        pc.dim(`${say("north.noSuchProjectHint")}\n`),
    );
    return 1;
  }

  if (args.mode === "show") {
    process.stdout.write(`${projectLines(chosen, parsed.api).join("\n")}\n`);
    return 0;
  }

  return write(parsed, chosen, args.phrase);
}

/** The three forms of command, resolved before touching the network. */
export type NorthArgs =
  | { mode: "list" }
  | { mode: "show"; slug: string }
  | { mode: "write"; slug: string; phrase: string };

/**
 * What has been requested, read from the positionals.
 *
 * What remains is combined in the sentence instead of being rejected, and here this separates from
 * `next`, which, when faced with a third argument, stands its ground. It is not an exception to
 * that rule but the same rule applied to another material: there, what was left over was a word
 * that no one was going to obey, and here what “remains” is the sentence itself written without
 * quotation marks. The shell has already split it by the spaces, the path collapses the blanks
 * before saving, and keeping just “Terminado” because two quotation marks were missing would be to
 * lose exactly what the person came to say.
 *
 * The empty phrase —`panoma north demo ""`— is still a writing and not a query: whoever types it
 * wants to write, and the one who has to tell them that there is no phrase is the catalog, with
 * its message, and not an additional check on this side.
 */
export function northArgs(positionals: string[]): NorthArgs {
  const slug = positionals[0]?.trim() ?? "";
  const rest = positionals.slice(1);
  if (slug === "" && rest.length === 0) return { mode: "list" };
  if (rest.length === 0) return { mode: "show", slug };
  return { mode: "write", slug, phrase: rest.join(" ") };
}

/** The census, or the reason why there is no census. */
type Census =
  | { state: "unreachable" }
  | { state: "error"; error: string; hint?: string }
  | { state: "ok"; projects: NorthProject[] };

/**
 * Who is in the catalog and what direction the report of each one brings.
 *
 * The two questions go at the same time because they are independent and travel to the same
 * machine; in series, the first time, they would be two chained Next compilations to answer a
 * command that is read at a glance.
 *
 * The error messages are those of `next` and not custom ones: exactly the same thing is being
 * requested —`nextMoves`, from the day's report— so a catalog that is too old to bring it is for
 * the same reason and is fixed with the same command. Two wordings of the same fault only serve to
 * make it seem like two faults.
 */
async function requestCensus(api: string): Promise<Census> {
  let roster: Response;
  let report: Response;
  try {
    [roster, report] = await Promise.all([
      catalogFetch(new URL("/api/catalog", api)),
      /*
        With `?fijo=1`, as in `next`: looking at which norths are written is not having read the
        day's news, and moving someone's mark erases without reading what they came to read. The
        header of language is needed because `fetch` from Node doesn't send any and `localeFrom`
        defaults to English without it; here it would be noticeable in the catalog errors, which
        are exactly the moment when understanding them is necessary.
       */
      catalogFetch(reportUrl(api, false)),
    ]);
  } catch {
    return { state: "unreachable" };
  }

  if (report.status === 404) {
    return { state: "error", error: say("next.tooOld"), hint: say("next.tooOldHint") };
  }
  const failed = !report.ok ? report : !roster.ok ? roster : undefined;
  if (failed) {
    const detail = await failed.text().catch(() => "");
    return {
      state: "error",
      error: say("next.httpError", { status: failed.status, detail }).trim(),
    };
  }

  const catalog = (await roster.json().catch(() => undefined)) as
    | { projects?: CatalogProject[] }
    | undefined;
  const parte = (await report.json().catch(() => undefined)) as
    | { nextMoves?: ProjectMoves[] }
    | undefined;
  if (!catalog?.projects || !parte) {
    return { state: "error", error: say("next.badReport") };
  }

  /*
    Without the field, the catalog is older than this CLI. Keeping silent here would be worse than
    in `next`: the list would come out complete with 'no one has written any,' which is the most
    reassuring answer possible and also invites rewriting over what was already there.
   */
  if (!parte.nextMoves) {
    return { state: "error", error: say("next.tooOld"), hint: say("next.tooOldHint") };
  }

  return { state: "ok", projects: mergeNorths(catalog.projects, parte.nextMoves) };
}

/**
 * Put the two lists together: the catalog shows who exists and the report shows what each north
 * says.
 *
 * A north of only spaces counts as unwritten, by the same criterion and for the same reason as
 * `written()` in `next-moves.ts`: it reached the database as text from a version that did not trim,
 * and answering 'it's already written' would leave the project without the only question it was
 * missing. Here it matters twice as much, because from that 'it's already written' it would depend
 * whether a writing was announced as a replacement.
 */
export function mergeNorths(
  catalog: CatalogProject[],
  reported: ProjectMoves[],
): NorthProject[] {
  const byslug = new Map(reported.map((project) => [project.slug, project]));

  return catalog.map(({ slug, name, root }) => {
    const row = byslug.get(slug);
    if (row === undefined) return { slug, name, root, status: { kind: "unlisted" } };

    const north = row.north?.trim() ?? "";
    return {
      slug,
      name,
      root,
      status: north === "" ? { kind: "blank" } : { kind: "written", north },
    };
  });
}

/**
 * The whole list, line by line.
 *
 * Return the lines and not a string so that it can be tested with literals, which is how what is
 * decided in this CLI is tested. Show the written norths and **count** the ones that are missing
 * instead of naming them: whoever has none is already read in `panoma next`, which also says what
 * to do with each one; repeating eighty names here with nothing next to them would be the scolding
 * with scroll that `withMoves` took to that screen.
 *
 * It does not receive the catalog address, and it is the only thing about this command that it
 * does not show: see the reason a few lines below, where those who have no north are counted.
 */
export function northLines(projects: NorthProject[]): string[] {
  /*
    The empty catalog is said with the words on the cover and in the report, which is the same
    news told in a third place. See `today.empty*`.
   */
  if (projects.length === 0) {
    return [
      "",
      `  ${pc.yellow(say("today.emptyTitle"))}`,
      `  ${pc.dim(say("today.emptyBody"))}`,
      "",
    ];
  }

  const written = projects.flatMap((project) =>
    project.status.kind === "written" ? [{ ...project, north: project.status.north }] : [],
  );
  const blank = projects.filter((project) => project.status.kind === "blank").length;
  const unlisted = projects.filter((project) => project.status.kind === "unlisted").length;

  const lines = ["", `  ${pc.bold(say("north.title"))}`, ""];

  /*
    "'There isn't any written yet' only when that phrase adds something. Measured against the
    author's catalog the first time this was run—112 projects and none with direction—on top of
    'no direction written: 112 of 112' it said exactly the same thing twice. Where it is necessary
    is when there are fewer missing than those that exist: then the empty list is the
    question—'and the others?'—that is answered by the line of those that cannot be read.
   */
  if (written.length === 0 && blank < projects.length) {
    lines.push(`  ${pc.yellow(say("north.noneWritten"))}`, "");
  }
  for (const project of written) {
    const quote = say("north.quote", { north: short(project.north) });
    lines.push(`  ${pc.cyan(project.slug.padEnd(SLUG_COLUMN))}${pc.dim(quote)}`);
  }
  if (written.length > 0) lines.push("");

  if (blank > 0) {
    lines.push(
      `  ${pc.yellow(
        say("north.blankCount", {
          n: blank,
          total: projects.length,
          s: plural(projects.length),
        }),
      )}`,
    );
    /*
      Here the card is not offered, and yes on the screen of a project: this line talks about all
      that are missing at once, and an address with a blank to fill in is not a link, it is a
      form. The second way of saying it is shown where there is a real slug to insert.
     */
    lines.push(`  ${pc.dim(say("north.blankHint"))}`);
  } else {
    const total = { n: projects.length, s: plural(projects.length) };
    lines.push(`  ${pc.green(say("north.allWritten", total))}`);
  }

  // Only when there are some: over a zero it would be a warning about something that hasn't
  // happened.
  if (unlisted > 0) {
    lines.push(`  ${pc.dim(say("north.unlistedCount", { n: unlisted }))}`);
  }

  return [...lines, ""];
}

/**
 * A project alone: its north, or the invitation to write it.
 *
 * The invitation is the same phrase that `panoma next` makes —the same dictionary key, not a
 * similar wording— because it is the same question asked on the site where it can finally be
 * answered. Below goes the command with the slug already set, so that there is no need to type
 * anything that this screen already knows, and the card as a second option.
 */
export function projectLines(project: NorthProject, api: string): string[] {
  const lines = ["", `  ${pc.cyan(pc.bold(project.name || project.slug))}`, ""];

  if (project.status.kind === "written") {
    lines.push(`      ${say("north.quote", { north: project.status.north })}`, "");
    lines.push(`      ${pc.dim(say("north.rewrite", { slug: project.slug }))}`);
    return [...lines, ""];
  }

  if (project.status.kind === "unlisted") {
    lines.push(`      ${pc.yellow(say("north.unlistedOne"))}`);
    lines.push(`      ${pc.dim(say("north.unlistedOneHint"))}`);
    return [...lines, ""];
  }

  lines.push(`      ${pc.yellow(say("next.noNorth"))}`, "");
  lines.push(`      ${pc.dim(say("north.sayIt"))}`);
  lines.push(`          ${pc.cyan(`panoma north ${project.slug} "…"`)}`);
  lines.push(
    `          ${pc.dim(say("north.card", { url: cardUrl(api, project.slug) }))}`,
  );
  return [...lines, ""];
}

/**
 * To write, which is what could not be done from anywhere.
 *
 * What existed is read **before** sending anything, because afterwards it no longer exists: the
 * route returns the new sentence and the catalog does not keep the previous one anywhere.
 * Replacing a sentence that someone thought without returning even an echo of what it said is the
 * exact way to lose it in silence, and that is why when it cannot be read —the project that the
 * branch does not bring— this stops instead of writing.
 */
/**
 * The north of a project, asked directly.
 *
 * `GET /api/north?slug=` did not exist when this command was written, and its absence forced
 * deducing the main point from the day's report—which only lists projects with something
 * pending—and inventing a third state for the healthy project that did not appear on any list. If
 * it exists, asking is better than deducing: it also answers for those who have nothing pending,
 * who are precisely the ones who have already answered the question.
 *
 * `undefined` means that it could not be queried —old catalog without that route, or down— and so
 * it proceeds with what is deduced, which is worse but is nothing.
 */
async function askNorth(api: string, slug: string): Promise<string | null | undefined> {
  try {
    const url = new URL("/api/north", api);
    url.searchParams.set("slug", slug);
    const response = await catalogFetch(url);
    if (!response.ok) return undefined;
    const body = (await response.json()) as { north?: unknown };
    return typeof body.north === "string" ? body.north : null;
  } catch {
    return undefined;
  }
}

async function write(
  parsed: Flags,
  project: NorthProject,
  phrase: string,
  ): Promise<number> {
  /*
    Before writing, one asks. The notice of this command —"I teach you what you replace"— only
    matters if one really knows what was there, and for the project that did not appear in the
    report, it was not known: hence `north.blind` and the flag for writing blindly. With the
    reading path, that becomes unnecessary in the normal case, and the flag remains for when the
    catalog does not know how to respond.
   */
  const asked = await askNorth(parsed.api, project.slug);
  const said = asked ?? "";
  const known: NorthProject =
    asked === undefined
      ? project
      : {
          ...project,
          status: said.trim() === "" ? { kind: "blank" } : { kind: "written", north: said },
        };

  if (known.status.kind === "unlisted" && !parsed.force) {
    process.stderr.write(
      pc.red(`${say("north.blind")}\n`) + pc.dim(`${say("north.blindHint")}\n`),
    );
    return 1;
  }
  project = known;

  let response: Response;
  try {
    response = await catalogFetch(new URL("/api/north", parsed.api), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: project.slug, north: phrase }),
    });
  } catch {
    return unreachable(parsed.api);
  }

  if (!response.ok) {
    process.stderr.write(
      pc.red(
        `${say("north.rejected", {
          status: response.status,
          detail: await refusal(response),
        }).trim()}\n`,
      ),
    );
    /*
      The 409 is not just another 'no.' The other two talk about the sentence —it's empty, it's
      long— and answer it by rewriting it; this one talks about the project, and it is answered by
      scanning it again so that it has something to hang on. Swallowing all three in a generic
      ruling would leave the person correcting a sentence that had nothing wrong with it.
     */
    if (response.status === 409) {
      const scan = say("north.noIdentityHint", { root: project.root });
      process.stderr.write(pc.dim(`${scan}\n`));
    }
    return 1;
  }

  const body = (await response.json().catch(() => ({}))) as { north?: string };
  // The phrase that is taught is the one the catalog kept, not the one that was sent: the route
  // collapses the spaces and trims, so they are the same phrase in two forms.
  const saved = typeof body.north === "string" ? body.north : phrase;

  process.stdout.write(`${savedLines(project, saved).join("\n")}\n`);
  return 0;
}

/**
 * The receipt of the deed, with what it replaces underneath when it replaces something.
 *
 * The verb of the header distinguishes writing from substituting, and below goes the phrase that
 * has gone, whole and in quotation marks. It is the last time it can be read: the catalog keeps a
 * north by project and not a history, so this echo is all there is between changing your mind and
 * not being able to go back.
 *
 * The previous state is read from the project and does not arrive on its own, and there is the
 * third case: the one that was forced with `--force`. There something was indeed replaced —the
 * report didn’t include it, and not including it means that it existed— and saying “north written”
 * would be the only phrase in the entire command that downplays what just happened. It is said
 * “replaced,” and it is said that nothing remains of that, not even the echo.
 */
export function savedLines(project: NorthProject, north: string): string[] {
  const fresh = project.status.kind === "blank";
  const heading: MessageKey = fresh ? "north.saved" : "north.savedOver";
  const lines = [
    "",
    `  ${pc.green("✓")} ${say(heading, { name: project.name || project.slug })}`,
    `      ${say("north.quote", { north })}`,
  ];

  if (project.status.kind === "written") {
    lines.push(
      "",
      `  ${pc.dim(say("north.replaced"))}`,
      `      ${pc.dim(say("north.quote", { north: project.status.north }))}`,
    );
  }
  if (project.status.kind === "unlisted") {
    lines.push("", `  ${pc.yellow(say("north.replacedBlind"))}`);
  }

  return [...lines, ""];
}

/** The address on the card, which continues to be the second way of saying it. */
function cardUrl(api: string, slug: string): string {
  // `new URL` and not a concatenation: `--api` can come with a trailing slash, and `http://x//p/y`
  // is not the same address as `http://x/p/y` for the web router.
  return new URL(`/p/${slug}`, api).href;
}

/** What fits from a north in its line of the list. */
function short(north: string): string {
  return north.length <= LINE_MAX ? north : `${north.slice(0, LINE_MAX - 1).trimEnd()}…`;
}

/**
 * The 'no' of the catalog, read in the two ways in which it can be said.
 *
 * The route responds `{ error }`, but a 500 is rendered by the framework: in development that is an
 * entire HTML page, and dumping it raw buries the only line that matters under kilobytes of
 * markup. Same squashing and same trimming as `refusalOf` in `twin-command.ts`.
 */
async function refusal(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object") {
      const { error } = parsed as { error?: unknown };
      if (typeof error === "string") return error;
    }
  } catch {
    // It wasn't JSON. The raw text works just the same, and crushed it fits on one line.
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}
