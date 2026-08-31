import type { NewVerdict } from "@panoma/db";

/*
  From what the miner takes out of the disk to what can be stored in the catalog.
  Live here and not inside `app/api/twin/verdicts/route.ts` for a practical reason: the web is
  tested by the assistants of `lib/`, never by raising a server. A translation that occurs inside
  the handler can only be checked with a database in front, and the database has nothing to do
  with the three decisions made here —what is discarded, what is saved as a category, and what is
  copied as is—. So the resolution of the project comes already done, in the form of a
  `cwd → identidad` map, and this remains pure.
  That map is also the route cache: it is resolved once per distinct `cwd` and not once per
  reaction. Measured over this machine's corpus, 2,009 reactions from Claude Code and 1,431 from
  Codex are distributed among 26-28 routes: passing the completed map turns five hundred identical
  queries into twenty-six.
  ── The undated reaction falls through, and it is not saved with an invented date ──────────
  `schema.ts` stated it when describing the table: the real corpus has lines without `timestamp`
  and the miner returns an empty string when it is not there, “so whoever translates a reaction to
  a row will have to make something up.” This is that whoever, and nothing is made up.
  `new Date("")` is `Invalid Date`, the column `at` is `notNull` and —which settles the
  discussion— the deterministic `id` of `saveVerdicts` comes from `row.at.toISOString()`, which on
  an invalid date **throws** `RangeError: Invalid time value`. So letting it pass would not save a
  strange row: it would crash the entire request and with it the other four hundred ninety-nine
  reactions, which had nothing wrong.
  It is checked before that the project on purpose. A reaction without a date also has no fix —the
  transcript did not have the time and it will not have it anymore—, while one that cannot find a
  project will find it as soon as that folder is scanned. Counting them together would promise
  that scanning rescues some quotes that cannot be rescued.
  ── The category is the first signal, or none ──────────────────────────────────
  `detectSignals` returns the signals in the order of its table, so the first one is the most
  specific of those that triggered. When none triggers, `category` is `null` and stays in `null`:
  filling it with "rejection" because the sentence starts with "no", or with a filler "others",
  would be inventing a classification that no one made right in the column through which the
  review screen will later be filtered. The full signals continue to go separately, in `signals`,
  so nothing is lost by not choosing.
  ── Nothing is crossed out here, and it is deliberate ──────────────────────────────────────
  Each `delivery` and each `reaction` that come out of the miner have already passed through
  `redactQuote` in the parser (`packages/core/src/history/claude-code.ts`), which is the only
  correct place: it is drafted **before** trimming, because trimming halfway through a key leaves
  half a key inside the excerpt. A second pass here would not cover anything new and would spoil
  quotes — the `quotes.ts` table was fine-tuned over 2,137 real turns to stop crossing out paths,
  SHA, and checksums, and its own header counts the cost of overdoing it: “fixes the ‘hidden
  credential’ of the panel,” and there is no original anymore. The quote is copied byte by byte,
  and the test next to it saves it.
 */

/**
 * How many reactions does a petition accept.
 *
 * The same number as `VERDICT_CHUNK` in `queries.ts`, which is what fits in a `insert` of the
 * extended PostgreSQL protocol, and not by chance: this way an accepted request is exactly a
 * write. What goes over from here is rejected with its figure in the message, it is never trimmed
 * — see header of the route.
 */
export const MAX_REACTIONS = 500;

/**
 * What is needed from a reaction to write the row, and nothing more.
 *
 * It is not the `Reaction` of `@panoma/core` even though one fits here without an adapter —the
 * test checks it with a typed literal, which is a compiler check and not a promise—. The
 * difference is that this arrives as JSON from the network: `chars` and `brief` are not present
 * because they are not stored, and `source` is a string and not a `HistorySourceId` because the
 * column also allows `interview`, `critic`, and `director`, which are not histories.
 */
export interface ReactionInput {
  source: string;
  sessionId: string;
  /** ISO 8601 as it appeared in the transcript. Empty when the line did not have any. */
  at: string;
  /** Raw, unresolved. Rule 7 of the parser: it is almost never the root of the project. */
  cwd?: string;
  /**
   * Files that the agent touched while preparing the delivery. See `identityOf`: they refer to
   * `cwd`, because they say what was being talked about and not where the terminal was.
   */
  paths?: string[];
  delivery?: string;
  reaction: string;
  signals: string[];
}

/**
 * What has been understood from the body of the petition.
 *
 * Three answers and not two because the rejection due to size must be countable with its number:
 * '2,009 arrive and 500 fit' tells the caller what to do, and 'the body is no good' does not. Same
 * way as `normalizeAccountUrl`, for the same reason.
 */
export type BatchRead =
  | { kind: "batch"; reactions: ReactionInput[] }
  | { kind: "malformed" }
  | { kind: "tooMany"; sent: number };

/**
 * The body of the request, understood or rejected in full.
 *
 * A single poorly formed reaction knocks down the batch, which seems severe and is the opposite.
 * Whoever calls is going to print the number that is returned to them; if here the ones that are
 * not understood were silently discarded, that number would describe a different batch than the
 * one that was sent and no one could notice. It is the same reason why the limit rejects instead
 * of trimming.
 *
 * What is indeed considered absent are `cwd` and `delivery`: the miner omits them when the session
 * did not specify in which folder it occurred or when there was no previous delivery to cite, and
 * that is a normal reaction, not a broken body.
 */
export function readBatch(body: unknown): BatchRead {
  if (!isRecord(body)) return { kind: "malformed" };

  const sent = body["reactions"];
  if (!Array.isArray(sent)) return { kind: "malformed" };
  if (sent.length > MAX_REACTIONS) return { kind: "tooMany", sent: sent.length };

  const reactions: ReactionInput[] = [];
  for (const item of sent) {
    const one = asReaction(item);
    if (one === undefined) return { kind: "malformed" };
    reactions.push(one);
  }
  return { kind: "batch", reactions };
}

/**
 * The different routes of the batch, which is what you have to ask the catalog.
 *
 * The two types go together —the `cwd` and the files that the agent touched— because the catalog
 * is asked the same question about both: "Which project is this path from?" `resolveProject` goes
 * up the tree to the deepest cataloged root, so it doesn't matter if it is given a folder or a
 * file from inside.
 */
export function distinctCwds(reactions: ReactionInput[]): string[] {
  const seen = new Set<string>();
  for (const reaction of reactions) {
    if (reaction.cwd) seen.add(reaction.cwd);
    for (const path of reaction.paths ?? []) seen.add(path);
  }
  return [...seen];
}

/**
 * Which project is a reaction from: send what was touched, and `cwd` is the backup.
 *
 * This order is the arrangement of a real and measured failure. `cwd` says where the terminal was,
 * not what was being talked about: in a transcript from this machine it said `trad89/humo_check`
 * in 1,095 turns while the files touched were **161 under `linkaloud/` and one under `humo_check/`
 * **. Result: a phrase about an audio tray, learned working in `linkaloud`, ended up signed as
 * from `Travocato`. And since the portrait goes down to `AGENTS.md` of all projects, the wrong
 * label was the least of it: the serious thing is that no one could judge whether the phrase was
 * valuable out of place, because its place was wrong.
 *
 * By majority and not by the first: a session touches files from several projects —the same file
 * mixed three— and the first path that appears can be a `README` of the parent opened briefly. The
 * majority is of the paths that **resolve**; those that do not lead to any cataloged project do
 * not vote, so that a loose file on the desktop does not tie with twelve from the real project.
 *
 * Tie: `cwd` wins if it is among the tied, and if not, the first in order of appearance. The
 * important thing is not what wins but that it is always the same — two sweeps of the same history
 * have to produce the same rows, because the verdict identifier is deterministic and a dancing
 * identity creates duplicates that no one associates.
 */
export function identityOf(
  reaction: ReactionInput,
  identities: ReadonlyMap<string, string>,
): string | undefined {
  const votes = new Map<string, number>();
  for (const path of reaction.paths ?? []) {
    const identity = identities.get(path);
    if (identity === undefined) continue;
    votes.set(identity, (votes.get(identity) ?? 0) + 1);
  }

  const fromCwd = reaction.cwd === undefined ? undefined : identities.get(reaction.cwd);
  if (votes.size === 0) return fromCwd;

  let best: string | undefined;
  let top = 0;
  for (const [identity, count] of votes) {
    if (count > top) {
      best = identity;
      top = count;
      continue;
    }
    // Tie: the `cwd` breaks the tie if it is one of the tied. See header.
    if (count === top && identity === fromCwd) best = identity;
  }
  return best ?? fromCwd;
}

export interface VerdictBatch {
  rows: NewVerdict[];
  /** Reactions dropped due to not bringing a date that can be saved. See header. */
  undated: number;
  /** Reactions whose pathways do not lead to any project with identity. */
  unmatched: number;
  /** How many different projects have been represented in `rows`. */
  projects: number;
}

/**
 * From reactions to lines, with the project resolution already done.
 *
 * `identities` is a map of `cwd` exactly of stable identity: whoever builds it has already climbed
 * the tree —`resolveProject` keeps the deepest root that is a prefix of the path— so there is
 * nothing to search here, only to consult. An absent `cwd` and a `cwd` that is not on the map end
 * up in the same place and for the same reason: without identity there is no row, because
 * `verdicts.identity` is `notNull` and it is the only thing that can be found afterwards.
 */
export function toVerdicts(
  reactions: ReactionInput[],
  identities: ReadonlyMap<string, string>,
): VerdictBatch {
  const rows: NewVerdict[] = [];
  const projects = new Set<string>();
  let undated = 0;
  let unmatched = 0;

  for (const reaction of reactions) {
    const at = instant(reaction.at);
    if (at === undefined) {
      undated += 1;
      continue;
    }

    const identity = identityOf(reaction, identities);
    if (identity === undefined) {
      unmatched += 1;
      continue;
    }

    projects.add(identity);
    rows.push({
      identity,
      source: reaction.source,
      sessionId: reaction.sessionId,
      at,
      // The first signal, never a made-up one. See the header.
      category: reaction.signals[0] ?? null,
      quote: reaction.reaction,
      // Without prior submission, the column remains empty, which is not the same as an empty
      // string: `null` is read as 'there was nothing to quote.'
      context: reaction.delivery ? reaction.delivery : null,
      signals: reaction.signals,
    });
  }

  return { rows, undated, unmatched, projects: projects.size };
}

/**
 * The date of the line, or nothing.
 *
 * `new Date` accepts much more than ISO 8601 and here that is fine: what arrives are `timestamp`
 * from three different tools and none promises the same format. What is not allowed is
 * `Invalid Date`, which is where the empty string and any text that was not a date end up.
 */
function instant(at: string): Date | undefined {
  if (at === "") return undefined;
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** An understood reaction, or nothing if it lacks something from what makes up the line. */
function asReaction(item: unknown): ReactionInput | undefined {
  if (!isRecord(item)) return undefined;

  const source = text(item["source"]);
  const sessionId = text(item["sessionId"]);
  const reaction = text(item["reaction"]);
  if (source === undefined || sessionId === undefined || reaction === undefined) {
    return undefined;
  }

  // `at` is allowed to be absent and is resolved in `toVerdicts`, which is where it counts: a line
  // without `timestamp` is a case of the corpus, not a poorly constructed body.
  const one: ReactionInput = {
    source,
    sessionId,
    at: typeof item["at"] === "string" ? item["at"] : "",
    reaction,
    signals: strings(item["signals"]),
  };
  const cwd = text(item["cwd"]);
  if (cwd !== undefined) one.cwd = cwd;
  /*
    Missing ones are allowed, like the `cwd`: a reaction to a turn that only wrote text and didn't
    touch any file, and that is normal and not a broken body. Only the absolutes are accepted for
    the same reason as in the engine — a relative one would have to be resolved against the `cwd`,
    which is exactly the data that is being distrusted.
   */
  const paths = strings(item["paths"]).filter((one) => one.startsWith("/"));
  if (paths.length > 0) one.paths = paths;
  const delivery = text(item["delivery"]);
  if (delivery !== undefined) one.delivery = delivery;
  return one;
}

/** A string with something inside, or nothing. The empty one counts as absent in all fields. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The signals, staying only with the chains.
 *
 * They are not checked against `VerdictSignal`: the column stores what `detectSignals` returns,
 * and a new signal from the engine must be able to get here without passing through this file
 * first. What is discarded is what is not a string, because `category` comes from the first one
 * and a `null` inside would be stored as category `"null"`.
 */
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
