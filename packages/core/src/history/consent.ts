import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isRecord } from "../fs-utils";
import { panomaPath } from "../home";
import { restrictToOwner } from "../restrict";
import type { HistorySourceId } from "./inventory";

/*
  The yes that must be asked before opening someone's conversation with their tools.
  What the folder next to it reads is the most intimate file on the disk. It is not code: in those
  1.78 GB spread across 778 `.jsonl` files is what someone ordered at eleven at night, what they
  rejected rudely, the names of their clients, the path of the projects they haven't shown anyone,
  and what they pasted into the terminal without thinking. No other part of Panoma reads anything
  similar; the project analyzer looks at files that are already in a repository, and the disk
  analyzer only counts bytes.
  The previous increase came out the other way around, and this module is half of what was
  missing. `inventory.ts` exists precisely for this: it measures with `stat` how many files and
  how many bytes each history has **without opening any of them**, so that the permissions screen
  can say “Claude Code: 778 files, 1.7 GB” instead of asking permission for “your history” in the
  abstract. That measurement was useless as long as there was nowhere to save the response:
  `mineClaudeCode` opened the 1.78 GB without asking, and a permission that is never requested is
  not a permission, it is a phrase in a README. Here the response is saved, and the reader should
  not open a file without first going through `isAllowed`.
  ── By source, never by Twin ────────────────────────────────────────────────────
  Reading Claude Code is not reading Codex. They are different tools, used for different tasks and
  often for different clients: anyone who lets you look at their 82 Claude Code sessions might
  have in `~/.codex` —4.97 GB of folder, 3.63 GB of conversation— the work of another company. A
  single switch forces you to choose between everything and nothing, and whoever has to choose
  between everything and nothing says no; the one who says yes, worse, is also saying it about
  what they would not have wanted to show.
  ── The default value is 'no', also for what does not yet exist ───────────────
  The absence of a key is a no, not a 'ask again.' That is why a file written today is still valid
  when a new reader comes in: the source that is not named inside appears as false without any
  migration, which is what has to happen — no one has decided anything about it yet.
  For the same reason, an identifier that the file knows and this module does not **is discarded**
  when reading, and with it it is lost when writing. This is deliberate and it is the only
  asymmetry that matters in the whole file: a 'yes' written by hand, or left there by a later
  version, cannot become permission the day that reader exists. Losing a yes is a one-click
  nuisance; inheriting one that no one gave on this screen is the mistake from which there is no
  return, because by the time it is discovered it has already been read.
  ── None of this throws, and the path of error ends where that of silence does ─────────
  Without a file, with the unreadable file, with JSON cut in half —the usual case when a process
  dies while writing— or with a JSON that turns out to be a list, the answer is the same: all
  false. It's not just that absence is the common case and crashing the command because of it
  would be absurd. It's that a permissions reader that crashes ends up wrapped in a `try/catch` at
  the top layer, and the default value that someone hurriedly writes inside that `catch` is 'go
  on.' Here, error and silence lead to the same place, so there is no `catch` to write wrongly.
  ── Where it lives, and why it is written the way it is written ──────────────────────────────
  In `panomaPath("twin.json")`, never in a manually composed route: `PANOMA_HOME` is what allows
  having two separate catalogs and what makes the tests of this not write in the home of whoever
  runs them. JSON with two spaces and the source identifier untranslated, so that it can be read
  with `cat` and revoked with `rm` — a permission that can only be withdrawn from the application
  that requested it is not a permission either.
  It is written separately and renamed on top, as in `access.json` and as in the merge of MCP: the
  file keeps the decisions of the five sources at once and a `writeFile` cut in half throws them
  all away —to false, which is not dangerous, but forces everything to be asked again—. And it is
  set to 0600 with `restrictToOwner` even though a decision is not a secret: what needs to be
  protected here is not reading, it is **writing**. Whoever can write this file grants themselves
  your entire history without the permission screen ever getting drawn.
 */

/**
 * The only thing that Twin keeps between executions. Not a single quote goes in here: the miner
 * reads, prints, and forgets, and this file only remembers what was said yes to.
 */
export interface TwinConsent {
  sources: Partial<Record<HistorySourceId, boolean>>;
  /**
   * If what the machine deduces **on its own** can go down to `TASTE.md`.
   *
   * It is the only decision that Twin asks of anyone, and it is one. Before, there were hundreds:
   * each distilled sentence awaited a yes, and with two thousand quotes in a corpus, that is work
   * the size of the history. By closing that queue, something that no one has signed can go to the
   * file that all of this person’s agents read, and that is a boundary that does deserve to be
   * questioned — once, not two thousand times.
   *
   * Signed text does not pass through here: those are your words, whether you wrote or corrected them. What
   * this permission opens is what is inferred.
   *
   * It is lacking while no one has answered, and that **is not** a yes. A `undefined` read as
   * permission would turn the absence of the question into its answer, which is exactly what a
   * consent screen exists not to do.
   */
  inferred?: boolean;
  /** ISO 8601, stamped at each change. It is missing as long as no one has decided anything. */
  updatedAt?: string;
}

const FILE = "twin.json";

/**
 * The sources about which one can decide today.
 *
 * It is a `Record<HistorySourceId, true>` and not a list for the compiler to check exhaustiveness:
 * the day a new reader enters `HistorySourceId`, this stops compiling until someone decides which
 * source the permission belongs to. An array of strings would have fallen short silently, and
 * falling short here means discarding the yes from a real source every time it is saved.
 */
const KNOWN_SOURCES: Record<HistorySourceId, true> = {
  "claude-code": true,
  codex: true,
  cursor: true,
  aider: true,
};

/**
 * `home` is the folder of Panoma already resolved —the one `PANOMA_HOME` names—, not the personal
 * folder. Without it, it is resolved with `panomaPath`, which is the same thing going through the
 * variable; with it, anyone who already knows where their catalog is avoids having to touch the
 * process environment to tell a function.
 */
function file(home?: string): string {
  return home === undefined ? panomaPath(FILE) : join(home, FILE);
}

/**
 * What has been decided, or a no for everything. Never throws. See header.
 *
 * Only a boolean counts as a decision: a `"sí"`, a `1`, or a `null` in the value field is a file
 * that someone edited by hand and left half-finished, and from a half-finished file, no permission
 * comes out.
 */
export async function readConsent(home?: string): Promise<TwinConsent> {
  const raw = await readFile(file(home), "utf8").catch(() => undefined);
  // Without a file, without permissions to open it, or with a directory where the file was supposed
  // to go.
  if (raw === undefined) return { sources: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Cut in half. Corruption is not interpreted: the answer is no.
    return { sources: {} };
  }
  // A list or a number are JSON valid and they are not this.
  if (!isRecord(parsed)) return { sources: {} };

  const stored = parsed["sources"];
  const sources: TwinConsent["sources"] = {};
  if (isRecord(stored)) {
    // The known is traversed and not what the file brings: thus an identifier that does not exist
    // here is left out instead of waiting for it to exist. See header.
    for (const id of Object.keys(KNOWN_SOURCES) as HistorySourceId[]) {
      const value = stored[id];
      if (typeof value === "boolean") sources[id] = value;
    }
  }

  const consent: TwinConsent = { sources };
  // Only one boolean counts, just like above: a half file grants nothing.
  const inferred = parsed["inferred"];
  if (typeof inferred === "boolean") consent.inferred = inferred;
  const updatedAt = parsed["updatedAt"];
  if (typeof updatedAt === "string" && updatedAt.length > 0) consent.updatedAt = updatedAt;
  return consent;
}

/**
 * Save the decision of **one** source and return the entire consent already updated.
 *
 * One reads before writing because the five decisions live in the same file, and saying yes to
 * Codex cannot withdraw the yes that was given to Claude Code last week.
 *
 * This does fail if the disk fails, unlike `readConsent`, and the asymmetry is the point: from a
 * failed read you exit with a no, which is safe; from a failed write you would exit with a screen
 * saying 'granted' over a file that does not exist, and the user would believe they decided
 * something that will be lost on reboot.
 */
export async function setConsent(
  source: HistorySourceId,
  allowed: boolean,
  home?: string,
): Promise<TwinConsent> {
  const before = await readConsent(home);
  const sources = { ...before.sources };
  sources[source] = allowed;
  return save({ ...before, sources }, home);
}

/**
 * Keep the answer to the only question that Twin asks, and return the entire consent.
 *
 * Live here and not on a board because it is a permission, and the permissions of this house are
 * withdrawn with `rm`: whoever does not want the machine to speak on their behalf deletes
 * `twin.json` and that's it, without having to open the application that granted it.
 *
 * It is read before writing for the same reason as `setConsent`: the permissions of the sources
 * live in this same file, and saying yes to the inferred cannot withdraw the yes that was given to
 * Codex last week.
 */
export async function setInferredConsent(allowed: boolean, home?: string): Promise<TwinConsent> {
  const before = await readConsent(home);
  return save({ ...before, inferred: allowed }, home);
}

/**
 * Write the entire file separately and rename it on top.
 *
 * This does fail if the disk fails, unlike `readConsent`, and the asymmetry is the point: from a
 * failed read you exit with a no, which is safe; from a failed write you would exit with a screen
 * saying 'granted' over a file that does not exist, and the user would believe they decided
 * something that will be lost on reboot.
 */
async function save(consent: TwinConsent, home?: string): Promise<TwinConsent> {
  const next: TwinConsent = { ...consent, updatedAt: new Date().toISOString() };

  const target = file(home);
  // On a newly installed `~/.panoma` machine it does not exist: the first permission is the first
  // thing that is saved, even before the catalog.
  await mkdir(dirname(target), { recursive: true });

  // With pid and randomness in the name, like in `access.json`: two processes writing the same
  // `.tmp` overwrite each other, and that already crashed the cover once with `visit.json`.
  const temporary = `${target}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    /*
      The temporary file is compressed **before** renaming, not the destination afterward:
      `rename` keeps permissions and owner, so by this path the good file never exists even for a
      moment with extra permissions.
      And you look at what it returns, because `restrictToOwner` does not throw an error: on
      Windows, it relies on `icacls` and gives up quietly if `USERNAME` is not in the environment
      — the case of a service —, and there the mode of `writeFile` does not mean anything. If it
      failed on the temporary, it retries on the destination, which is the path that really needs
      to be protected. What is not done is aborting: the decision has already been made and saved,
      and deleting it due to a permissions problem would wipe out the decisions of the other four
      sources, which were in the same file and were not at fault.
     */
    const tightened = await restrictToOwner(temporary);
    await rename(temporary, target);
    if (!tightened) await restrictToOwner(target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }

  return next;
}

/**
 * Can you download to the file what the machine deduced on its own? Pure, and only `true` allows
 * it.
 *
 * The absence of a response is a no. It is the difference between asking once and taking as
 * answered what no one answered.
 */
export function publishesInferred(consent: TwinConsent): boolean {
  return consent.inferred === true;
}

/**
 * In what situation is a story regarding the permission.
 *
 * `noReader` is not a shade of `denied`: they are opposites. The second one says 'you're missing a
 * yes' and carries the gesture that gives it; the first one says 'we don't know how to read this,'
 * and there the gesture would be useless. rendering them the same would turn the only screen that
 * cannot lie into one that promises to read Cursor in exchange for a permission.
 *
 * `absent` is what has not written anything on this machine. It is not a refusal: there is
 * nothing.
 */
export type ConsentState = "allowed" | "denied" | "noReader" | "absent";

/**
 * The situation of a story, crossing what is on the disk with what has been decided.
 *
 * Live here and not on a screen because there are two asking it —the terminal and the web— and
 * it's the same question. Copied in both, the day a new reader enters, one surface would say
 * 'grant permission' and the other 'we still don't know how to read this' about the same folder.
 *
 * The order of the questions is the only thing that makes sense about this function:
 *
 * 1. What does not exist and no one has allowed has no offer to make, and that is Aider's
 * situation throughout the machine: the inventory deliberately declares it absent — it writes
 * inside each repository and there is no machine figure to give, see `AIDER_FILE` — so attaching a
 * 'measured here' would be lying about the only source that is never measured. That comes first.
 * 2. Without a reader there is nothing to offer, not even if the folder is full, nor even if
 * someone has already said yes: that yes is written in `twin.json` and opens nothing, and what
 * must be read on the screen is precisely that it is not read. See `ConsentState`.
 * 3. A granted permission is shown **even if the history is no longer on the disk**: it is granted
 * once and it remains recorded, so hiding it when the tool is uninstalled would leave a live yes
 * with no way to revoke it from the screen that requested it. A permission that is not visible
 * cannot be revoked.
 * 4. And what remains is what is left to decide, which is what the gesture brings.
 */
export function consentState(
  source: { present: boolean },
  allowed: boolean,
  readable: boolean,
): ConsentState {
  if (!source.present && !allowed) return "absent";
  if (!readable) return "noReader";
  return allowed ? "allowed" : "denied";
}

/**
 * Can this source be read? Pure function over an already read consent.
 *
 * Separated from the reading on purpose: whoever goes through the five sources to render the
 * screen, or to mine several in a row, asks five times about the same object instead of going back
 * to the disk five times. And only `true` grants — anything else, including a half-built object,
 * is a no.
 */
export function isAllowed(consent: TwinConsent, source: HistorySourceId): boolean {
  return consent.sources?.[source] === true;
}
