import { createHash } from "node:crypto";
import { complete } from "@panoma/ai";
import { saveLook, saveModelCall, type Database, type LookFired } from "@panoma/db";
import { buildLookPrompt, parseFindings, type Finding, type LookSubject } from "@/lib/look";
import type { Locale } from "@/lib/i18n";

/*
  What a glance costs and what remains of it: the part that the two surfaces share.
  The critic stopped being a command the day the watcher could trigger it, and that forces
  splitting the route where the seam actually is. What **is not** shared are the doors: the route
  answers 409 and 429 in the language of the one asking, the watcher stays silent and notes it in
  its logbook, and both things are fine where they are. What **is** shared is the piece that
  spends money and leaves a trace — building the assignment, calling, recording the call in the
  expense book, reading the response, and keeping the verdict.
  That piece being a single one is not hygiene: it is what prevents one of the two surfaces from
  forgetting to aim. An automatic checker that calls without writing in `model_calls` leaves the
  day's brake counting half, and one that does not write in `looks` looks at the same capture
  again tomorrow. Both failures are invisible until the invoice arrives.
  ── The expense is noted before understanding the response ────────────────────────────────
  The order is the same as the route had and for the same reason: the expense book is the brake,
  and a brake that only counts the calls that were also understood stops counting precisely on the
  day a model starts answering anything — which is the day a broken loop calls more often.
  ── And the glance is kept even if nothing has come out ─────────────────────────────────
  Zero findings is a correct answer and an unreadable answer is a paid call; both leave a row. The
  row is what makes the automatic shot converge: without it, 'this capture yielded nothing' and
  'this capture has not been looked at' are indistinguishable, and the watcher treats them the
  same, that is, paying again.
 */

/** What is allowed to be written to the model. See the header of the path. */
const MAX_ANSWER_TOKENS = 2000;

/** The class with which this is written in the expense book, and for which it is counted. */
export const LOOK_KIND = "look";

/** The image that is going to travel, already read by the one who had it. */
export interface LookImage {
  /** The content in base64, without the prefix `data:`. */
  data: string;
  mediaType: string;
  bytes: number;
  /** What was it called in the mailbox, when it came out of a mailbox. */
  shot?: string | undefined;
}

/** What returns is a look already made and already saved. */
export interface LookReceipt {
  findings: Finding[];
  dropped: number;
  unreadable: boolean;
  statements: number;
  provider: string;
  model: string;
  usage?: { input: number; output: number };
  /** The digest of the capture: it is the name by which it is remembered. */
  digest: string;
  /**
   * The row that has been saved.
   *
   * It goes out because a newly discovered finding must be able to be handled without reloading
   * the screen, and what is sent to handle it is **the look identifier and the finding number**,
   * never its text. Without this, the buttons of the newly rendered list would be the only ones
   * that do not work.
   */
  lookId: string;
}

/**
 * Look at a screen, write down what it has cost, and save what it has said.
 *
 * It throws if the provider throws —missing credential, network that doesn't work, a model that
 * doesn't know how to receive images— and then nothing is recorded: a call that wasn't answered
 * hasn't been charged to anyone, and counting it would turn the delay into a punishment for having
 * a bad connection. The phrase for that exception is written by each surface, because on one it's
 * a 502 and on the other it's a line in the watcher's log.
 */
export async function runLook(
  database: Database,
  options: {
    subject: LookSubject;
    image: LookImage;
    identity: string;
    fired: LookFired;
    locale: Locale;
  },
): Promise<LookReceipt> {
  const built = buildLookPrompt(options.subject, { locale: options.locale });

  const answer = await complete({
    system: built.system,
    prompt: built.prompt,
    images: [{ data: options.image.data, mediaType: options.image.mediaType }],
    maxTokens: MAX_ANSWER_TOKENS,
  });

  await saveModelCall(database, {
    kind: LOOK_KIND,
    provider: answer.provider,
    model: answer.model,
    identity: options.identity,
    ...(answer.usage ? { input: answer.usage.input, output: answer.usage.output } : {}),
    images: 1,
  });

  const outcome = parseFindings(answer.text, built.labels);
  const digest = digestOf(options.image.data);

  const lookId = await saveLook(database, {
    identity: options.identity,
    digest,
    ...(options.image.shot ? { shot: options.image.shot } : {}),
    bytes: options.image.bytes,
    fired: options.fired,
    provider: answer.provider,
    model: answer.model,
    statements: built.labels.size,
    dropped: outcome.dropped,
    unreadable: outcome.unreadable,
    findings: outcome.findings,
  });

  return {
    findings: outcome.findings,
    dropped: outcome.dropped,
    unreadable: outcome.unreadable,
    statements: built.labels.size,
    provider: answer.provider,
    model: answer.model,
    ...(answer.usage ? { usage: answer.usage } : {}),
    digest,
    lookId,
  };
}

/**
 * The name by which a capture is remembered: the sha256 of its bytes.
 *
 * From the bytes and not from the base64 in which they arrive, which seems the same and is not:
 * base64 allows variants —padding, line breaks— that give different strings for the same image,
 * and then the same capture read in two ways would not be recognized. Decoding takes a few
 * milliseconds on something that is already entirely in memory because it is going to travel to a
 * provider.
 *
 * And by content and not by name or date, which is the substantive decision: an agent overwrites
 * `home.png` on each pass, and a folder copied from one place to another changes all the dates at
 * once. The only thing that identifies a delivery is the image.
 */
export function digestOf(base64: string): string {
  return sha256(Buffer.from(base64, "base64"));
}

/**
 * The digest of some bytes. A single implementation on purpose.
 *
 * They call it the two paths through which a capture reaches here —the mailbox file, which is read
 * from the disk, and the image uploaded by the viewer— and they have to give the same result for
 * the same image. Two `createHash` in two different files do not contradict each other on the day
 * they are written; they contradict on the day someone changes one.
 */
export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
