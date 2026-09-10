import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  challengeNote,
  listSentinels,
  setSentinels,
  validMemoryPath,
  type Challenge,
  type Database,
  type Sentinel,
} from "@panoma/db";

/*
  The sentinels: the memory that watches over its own foundations.
  A text note ages in silence — «use ops/migrate-base-pglite5.mjs» continues to be served months
  after that script has been deleted, and the first to find out is the agent that looks for it.
  Here is the alternative: each note carries the observable conditions on the disk under which it
  ceases to be credible, and the watcher reevaluates them in the same pass in which it reanalyzes
  the project. Comparison against the disk, zero paid calls. A note whose basis has changed is not
  deleted or corrected on its own: it is **challenged** — it stops being served — and the dispute
  waits in the record with the diff in front.
  ── Customs: nobody writes conditions by hand ──────────────────────────────────
  The sentinels extract from the approval of the note's own body: the routes it mentions that
  exist at that moment become `path_exists` anchors. It is the piece that makes the system usable
  — asking the person (or the model) to draft formal defeaters is asking that there be no
  defeaters. The extraction is deliberately conservative: one extra anchor challenges healthy
  notes, and a scale nearby is measuring how much each interruption of the person costs.
  The watcher checks during reanalysis, and memory delivery checks again before serving. Nested
  changes may fall outside the watcher subscription, so its last pass is not a freshness promise.
 */

/** Anchors by note, at most. More than this and the note would be challenged for anything. */
const MAX_ANCHORS = 3;

/** The maximum that can be read for a `file_contains`: beyond that, it is not a text file. */
const MAX_READ_BYTES = 1_000_000;

/**
 * Something that looks like a route within prose: two or more segments separated by `/`.
 *
 * Deliberately narrow. It does not catch plain «package.json» (a word with a dot is too common in
 * technical prose) nor URLs (the `://` is excluded by looking at the context). What it does catch
 * is `apps/web/lib/guard.ts`, `ops/migrar-base-pglite5.mjs`, `.panoma/shots` — the way a note of
 * this product names its fundamentals.
 */
const PATHISH = /(?<![\p{L}\p{N}:/])\.?[\p{L}\p{N}_.@()[\]-]+(?:\/[\p{L}\p{N}_.@()[\]-]+)+/gu;

/**
 * The anchors that the body of a note offers on its own: its routes that exist today.
 *
 * Only `path_exists`, and only from routes verified against the disk at the moment of yes: an
 * anchor that is already born fired is not an anchor, it is a typo in the note — and it is left
 * out in silence because the note may be talking about a route from another project or an example.
 * The resolution is enclosed in the root: a note that mentions `../fuera` cannot put Panoma to
 * watch the disk unrelated to the project.
 */
export async function extractAnchors(body: string, root: string): Promise<Sentinel[]> {
  const anchors: Sentinel[] = [];
  const seen = new Set<string>();

  // Quoted paths preserve spaces. Unquoted mentions retain the conservative slash requirement.
  const quoted = [...body.matchAll(/[`"]([^`"\r\n]+)[`"]/gu)].map((match) => match[1]!);
  const mentions = [...body.matchAll(PATHISH)].map((match) => match[0].replace(/[.,;:»”]+$/, ""));
  for (const candidate of [...quoted, ...mentions]) {
    let raw = candidate;
    // Remove unmatched prose parentheses without changing literal route groups.
    if (!quoted.includes(candidate)) {
      while (raw.startsWith("(") && raw.split("(").length > raw.split(")").length) raw = raw.slice(1);
      while (raw.endsWith(")") && raw.split(")").length > raw.split("(").length) raw = raw.slice(0, -1);
      if (raw.startsWith("(") && raw.indexOf(")") === raw.length - 1) raw = raw.slice(1, -1);
    }
    if (anchors.length >= MAX_ANCHORS) break;

    // Without the closing punctuation of the prose: «…in apps/web/lib/guard.ts.» or «(ops/x.mjs)».
    if (raw.length < 4 || !validMemoryPath(raw) || seen.has(raw)) continue;
    seen.add(raw);

    const absolute = resolve(root, raw);
    if (absolute !== root && !absolute.startsWith(root + sep)) continue;

    try {
      await stat(absolute);
      anchors.push({ kind: "path_exists", target: raw, expected: true });
    } catch {
      // It does not exist today: it is not a basis of this note, it is a mention.
    }
  }

  return anchors;
}

/** What was observed when looking: `holds` indicates whether the basis still stands. */
export interface SentinelReading {
  holds: boolean;
  observed: string;
}

/**
 * Look, a sentinel against the disk. It never throws: an unreadable file is read as absent,
 * because for the agent who was going to follow the note, it is exactly the same.
 */
export async function evaluateSentinel(root: string, sentinel: Sentinel): Promise<SentinelReading> {
  const absolute = resolve(root, sentinel.target);
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    return { holds: false, observed: "target escapes the project root" };
  }

  if (sentinel.kind === "path_exists") {
    try {
      await stat(absolute);
      return { holds: sentinel.expected === true, observed: "exists" };
    } catch {
      return { holds: sentinel.expected !== true, observed: "missing" };
    }
  }

  /*
    The sentinels that READ content pay two more duties than `path_exists`. The size before
    opening: the first version read the entire file and then cut it, so the reading limit was
    decorative and a gigabyte file wandered through the sentinel's memory — and beyond the Buffer
    limit, not even that. And the REAL path besides the lexical one: `stat` and `readFile` follow
    symbolic links, so a symlink committed within the project pointing outside turned the prefix
    comparison into paper.
   */
  let size: number;
  try {
    const real = await realpath(absolute);
    const realRoot = await realpath(root);
    if (real !== realRoot && !real.startsWith(realRoot + sep)) {
      return { holds: false, observed: "target escapes the project root" };
    }
    size = (await stat(real)).size;
  } catch {
    return { holds: false, observed: "missing" };
  }
  if (size > MAX_READ_BYTES) {
    // Your own verdict, not 'missing': the lawsuit must show the true reason.
    return { holds: false, observed: "unreadable: too large" };
  }

  let content: Buffer;
  try {
    content = await readFile(absolute);
  } catch {
    return { holds: false, observed: "missing" };
  }

  if (sentinel.kind === "file_hash") {
    const digest = createHash("sha256").update(content).digest("hex").slice(0, 16);
    return { holds: digest === sentinel.expected, observed: digest };
  }

  // file_contains
  const text = content.toString("utf8");
  const found = typeof sentinel.expected === "string" && text.includes(sentinel.expected);
  return { holds: found, observed: found ? "present" : "absent" };
}

/**
 * What a patrol reports so the watcher can record it in the logbook and the context route can
 * say what it did not look at. The two optional fields appear only when the patrol could not
 * verify: `unverified` counts the anchored notes it left as they were, and `skipped` says why —
 * the root is not on this disk (`root-missing`) or the catalog is remote and the root is not
 * here (`remote`). Without them, every anchored note was compared against the disk.
 */
export interface PatrolResult {
  checked: number;
  challenged: { noteId: string; body: string; observed: string }[];
  unverified?: number;
  skipped?: "remote" | "root-missing";
}

/** Whether the root is a directory on this disk. Anything else is "cannot look", not "empty". */
async function rootOnThisDisk(root: string): Promise<boolean> {
  try {
    return (await stat(root)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The patrol: reevaluates the sentinels of the approved notes of a project and challenges those
 * whose basis is contradictory. A single fallen sentinel is enough—a note with two anchors and one
 * broken is speaking, at least in part, of a world that no longer exists.
 *
 * Unless the root itself is not here. An unmounted volume, a folder moved without a rescan or a
 * catalog served from another machine make every `path_exists` read as `missing`, and the first
 * version of this patrol challenged every anchored note of the project in one pass on that
 * evidence. A root that cannot be looked at is not a world that no longer exists: it is a world
 * nobody can see from here, so the notes are reported as unverified and left as they were.
 */
export async function patrolSentinels(
  database: Database,
  project: { id: string; root: string },
): Promise<PatrolResult> {
  const guarded = await listSentinels(database, project.id);
  const challenged: PatrolResult["challenged"] = [];
  if (!(await rootOnThisDisk(project.root))) {
    return { checked: 0, challenged, unverified: guarded.length, skipped: "root-missing" };
  }

  for (const note of guarded) {
    for (const sentinel of note.sentinels) {
      const reading = await evaluateSentinel(project.root, sentinel);
      if (reading.holds) continue;

      const evidence: Challenge = { at: new Date().toISOString(), sentinel, observed: reading.observed };
      if (await challengeNote(database, note.id, evidence, note.decidedAt)) {
        challenged.push({ noteId: note.id, body: note.body, observed: reading.observed });
      }
      break;
    }
  }

  return { checked: guarded.length, challenged };
}

/**
 * The entire customs, for the decision route: extract the anchors from the body and leave them in
 * place. In each approval, also the re-approvals — the current basis is that of the last yes.
 *
 * The trigger of a sleep enters in addition to the three of the body, because it is its
 * **guaranteed** foundation: if its path goes off the disk, the note sleeps forever without anyone
 * waking or challenging it —the blind spot found by the audit. Only if the database exists at
 * the moment of yes: a trigger on a path that does not yet exist is legitimate
 * ("if someday you create this, no…") and watch it with `path_exists` would contest it for
 * to wait, which is precisely what it handles.
 */
export async function anchorNote(
  database: Database,
  input: { noteId: string; body: string; root: string; trigger?: string | null },
): Promise<void> {
  await setSentinels(database, input.noteId, await extractNoteAnchors(input));
}

/** Build the complete replacement set before the atomic approval write. */
export async function extractNoteAnchors(
  input: { body: string; root: string; trigger?: string | null },
): Promise<Sentinel[]> {
  const anchors = await extractAnchors(input.body, input.root);

  if (input.trigger) {
    const base = input.trigger.endsWith("/**") ? input.trigger.slice(0, -3) : input.trigger;
    const absolute = resolve(input.root, base);
    const confined = absolute === input.root || absolute.startsWith(input.root + sep);
    if (confined && !anchors.some((anchor) => anchor.target === base)) {
      try {
        await stat(absolute);
        anchors.push({ kind: "path_exists", target: base, expected: true });
      } catch {
        // It does not exist yet: the note waits to be created, and that is not monitored.
      }
    }
  }

  return anchors;
}

/**
 * Recheck the anchors at delivery time; the catalog watcher does not observe every nested path.
 *
 * Remote or not: what decides whether the patrol can look is whether the project root is on the
 * serving machine's disk, not which driver opened the catalog. A server with `DATABASE_URL` that
 * also has the folder —the usual case for one person with a shared database— verifies exactly as
 * a local one does. When the root is not here, the patrol reports the notes as unverified and the
 * reason names the more likely cause: `remote` when the catalog is remote, `root-missing` when it
 * is local and the volume or the folder is simply gone. Only the watcher stays off remotely: a
 * patrol is one look at the moment of serving, a watcher is a standing subscription to a disk
 * that, with a remote catalog, is usually somewhere else.
 */
export async function refreshProjectMemory(database: Database, project: { id: string; root: string }): Promise<PatrolResult> {
  const result = await patrolSentinels(database, project);
  if (result.skipped === "root-missing" && process.env["DATABASE_URL"]) return { ...result, skipped: "remote" };
  return result;
}
