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
  ── Grants: a purpose on top of a source, never instead of it ─────────────────────────────
  The memory work of September 2026 added a second layer to the same file. The source permission
  above says "you may read my Claude Code conversations for the twin"; it says nothing about a
  worker that opens the same files every minute looking for the receipts of what Panoma sent, and
  even less about sending human text to a provider. Those are different promises with different
  data classes, so each is a `grant` with a purpose: `memoryCapture` (typed local observation of
  receipts and lifecycle, the only one delivery A implements), `memoryExtract` and `twinAutoLearn`
  (semantic, and both require an enabled `memoryCapture` for the same scope — a process that
  cannot observe cannot extract). A grant never widens the source permission: with `sources`
  saying no, every grant of that source is dead, whatever it says.
  A grant is scoped: `project` names the identities it covers, `global` uses the explicit marker
  `*` and nothing else; the two never mix in one grant. The explicit project decision beats the
  global one, including an explicit `false` — the person who turned memory on for everything and
  then off for one client's project meant exactly that. Every grant carries a `generation` that
  grows only when `enabled` flips: the catalog's cursors are keyed on it, so a revoke-and-enable
  starts new frontiers instead of resuming the old ones (plan §7.1). And a grant that does not
  have the closed shape is dropped on read, like an unknown source: an invalid edit denies, it
  never falls back to a factory permission (plan §25.1). The file stays the authority; the
  catalog keeps cursors, never permissions.
 */

/** The purposes a grant can carry. Delivery A implements `memoryCapture`; the other two are vocabulary validated here and acted on later. */
export type GrantPurpose = "memoryCapture" | "memoryExtract" | "twinAutoLearn";

/** Where a grant applies: named project identities, or everything through the explicit `*`. */
export type GrantScope = "project" | "global";

/**
 * One decision about one purpose of one source, in the closed shape `twin.json` keeps.
 *
 * Every field is required so that a hand edit that drops one is a dropped grant and not a
 * half-granted one. `generation` is the frontier the catalog's cursors are bound to; it moves only
 * when `enabled` flips, so re-saving the same decision changes nothing downstream.
 */
export interface ConsentGrant {
  /** Opaque, `grant_` followed by twelve hex digits; generated here, never chosen by a caller. */
  grantId: string;
  /** Starts at 1; +1 on every flip of `enabled` of this grant. */
  generation: number;
  source: HistorySourceId;
  purpose: GrantPurpose;
  scope: GrantScope;
  /** Project identities for `project`; exactly `["*"]` for `global`. */
  scopeKeys: string[];
  enabled: boolean;
  /** The version of the notice the person accepted; 1 in delivery A. */
  noticeVersion: number;
  /** ISO 8601 of the last enabling, or of the creation when the grant was born disabled. */
  activatedAt: string;
  /** The explicit acceptance of this notice; absent only on legacy grants. */
  noticeAcceptedAt?: string;
}

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
  /** The purpose grants, absent while nobody has decided one. See the header. */
  grants?: ConsentGrant[];
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

/** Same discipline for purposes: a purpose the file names and this module does not is dropped. */
const KNOWN_PURPOSES: Record<GrantPurpose, true> = {
  memoryCapture: true,
  memoryExtract: true,
  twinAutoLearn: true,
};

/** The purposes that need an enabled `memoryCapture` on the same scope resolution before they mean anything. */
const SEMANTIC_PURPOSES: Record<GrantPurpose, boolean> = {
  memoryCapture: false,
  memoryExtract: true,
  twinAutoLearn: true,
};

/** The one marker a global grant carries. Never a project identity. */
const GLOBAL_KEY = "*";

const GRANT_ID = /^grant_[0-9a-f]{12}$/;

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
  const grants = readGrants(parsed["grants"]);
  if (grants.length > 0) consent.grants = grants;
  return consent;
}

/**
 * The grants of the file that have the closed shape, in file order, without duplicates.
 *
 * A malformed entry is dropped and the others survive: one bad line of a hand edit denies that
 * one purpose, not the whole file. Two entries with the same id or the same key —source, purpose,
 * scope and the set of keys— are one decision written twice; the first one stays, which is the
 * one `setGrant` would have kept in place.
 */
function readGrants(value: unknown): ConsentGrant[] {
  if (!Array.isArray(value)) return [];
  const kept: ConsentGrant[] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const entry of value) {
    const grant = parseGrant(entry);
    if (grant === undefined) continue;
    const key = grantKey(grant.source, grant.purpose, grant.scope, grant.scopeKeys);
    if (ids.has(grant.grantId) || keys.has(key)) continue;
    ids.add(grant.grantId);
    keys.add(key);
    kept.push(grant);
  }
  return kept;
}

/** One entry of the file, or `undefined` when any field is missing, of another type, or out of its domain. */
function parseGrant(value: unknown): ConsentGrant | undefined {
  if (!isRecord(value)) return undefined;
  const grantId = value["grantId"];
  const generation = value["generation"];
  const source = value["source"];
  const purpose = value["purpose"];
  const scope = value["scope"];
  const scopeKeys = value["scopeKeys"];
  const enabled = value["enabled"];
  const noticeVersion = value["noticeVersion"];
  const activatedAt = value["activatedAt"];

  if (typeof grantId !== "string" || !GRANT_ID.test(grantId)) return undefined;
  if (!isPositiveInteger(generation)) return undefined;
  if (!isKnownSource(source)) return undefined;
  if (!isGrantPurpose(purpose)) return undefined;
  if (scope !== "project" && scope !== "global") return undefined;
  if (!validScopeKeys(scope, scopeKeys)) return undefined;
  if (typeof enabled !== "boolean") return undefined;
  if (!isPositiveInteger(noticeVersion)) return undefined;
  if (typeof activatedAt !== "string" || Number.isNaN(Date.parse(activatedAt))) return undefined;

  const noticeAcceptedAt = value["noticeAcceptedAt"];
  if (noticeAcceptedAt !== undefined && (typeof noticeAcceptedAt !== "string" || Number.isNaN(Date.parse(noticeAcceptedAt)))) return undefined;
  return { grantId, generation, source, purpose, scope, scopeKeys, enabled, noticeVersion, activatedAt,
    ...(noticeAcceptedAt === undefined ? {} : { noticeAcceptedAt: noticeAcceptedAt as string }) };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isKnownSource(value: unknown): value is HistorySourceId {
  return typeof value === "string" && Object.hasOwn(KNOWN_SOURCES, value);
}

export function isGrantPurpose(value: unknown): value is GrantPurpose {
  return typeof value === "string" && Object.hasOwn(KNOWN_PURPOSES, value);
}

/**
 * `global` is exactly `["*"]`; `project` is one or more identities, none of them the marker. The
 * two shapes never mix: a grant that names projects and `*` at once would be read by one screen as
 * "these" and by another as "everything", and both would be right.
 */
function validScopeKeys(scope: GrantScope, value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  if (!value.every((key) => typeof key === "string" && key.length > 0)) return false;
  if (scope === "global") return value.length === 1 && value[0] === GLOBAL_KEY;
  return value.length >= 1 && !value.includes(GLOBAL_KEY);
}

/** The upsert key: the set of keys, sorted and without repeats, so that order and duplicates do not make two grants. */
function grantKey(source: HistorySourceId, purpose: GrantPurpose, scope: GrantScope, scopeKeys: string[]): string {
  return JSON.stringify([source, purpose, scope, canonicalKeys(scopeKeys)]);
}

function canonicalKeys(scopeKeys: string[]): string[] {
  return [...new Set(scopeKeys)].sort();
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
  const wasAllowed = sources[source] === true;
  sources[source] = allowed;
  /*
    The source permission is the floor under every grant of that source. Turning the floor off
    keeps the grants written but dead; turning it back on must not resume where they were: the
    interval spent without permission was never authorized (plan §7.1, "reactivating does not
    authorize the intervals of the disabled period"). So a floor that comes back raises the
    generation of every enabled grant of the source, exactly as a flip of the grant itself does,
    and the catalog's cursors — keyed on that generation — start a new frontier.
   */
  const revived = allowed && !wasAllowed;
  const grants = before.grants?.map((grant) =>
    revived && grant.source === source && grant.enabled
      ? { ...grant, generation: grant.generation + 1, activatedAt: new Date().toISOString() }
      : grant,
  );
  return save({ ...before, sources, ...(grants && grants.length > 0 ? { grants } : {}) }, home);
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

/** What a caller decides about a grant; the id, the generation and the timestamp are this module's. */
export interface GrantInput {
  source: HistorySourceId;
  purpose: GrantPurpose;
  scope: GrantScope;
  scopeKeys: string[];
  enabled: boolean;
  noticeVersion: number;
}

/**
 * Upsert one grant by its key —source, purpose, scope and the set of keys— and return the consent
 * and the grant as saved.
 *
 * The generation grows only when `enabled` flips. Re-saving the same decision, or raising the
 * notice version of a grant that stays enabled, keeps it: the catalog's cursors are bound to the
 * generation, and a frontier that moved every time a screen was saved would lose coverage for
 * nothing. `activatedAt` is the instant of the last enabling; a revoke leaves it as the record of
 * when the last enabled period began.
 *
 * Throws on a malformed input — an unknown source or purpose, keys that do not fit the scope —
 * because that is a caller that did not validate its request, not a decision of the person.
 */
export async function setGrant(
  input: GrantInput,
  home?: string,
): Promise<{ consent: TwinConsent; grant: ConsentGrant }> {
  if (!isKnownSource(input.source)) throw new TypeError(`Unknown history source: ${String(input.source)}`);
  if (!isGrantPurpose(input.purpose)) throw new TypeError(`Unknown grant purpose: ${String(input.purpose)}`);
  if (input.scope !== "project" && input.scope !== "global") throw new TypeError(`Unknown grant scope: ${String(input.scope)}`);
  if (!validScopeKeys(input.scope, input.scopeKeys)) {
    throw new TypeError(`Scope keys do not fit a ${input.scope} grant: ${JSON.stringify(input.scopeKeys)}`);
  }
  if (typeof input.enabled !== "boolean") throw new TypeError("A grant is enabled or not; nothing else.");
  if (!isPositiveInteger(input.noticeVersion)) throw new TypeError(`Notice version must be a positive integer: ${String(input.noticeVersion)}`);

  const before = await readConsent(home);
  const grants = [...(before.grants ?? [])];
  const key = grantKey(input.source, input.purpose, input.scope, input.scopeKeys);
  const index = grants.findIndex((grant) => grantKey(grant.source, grant.purpose, grant.scope, grant.scopeKeys) === key);
  const now = new Date().toISOString();

  let grant: ConsentGrant;
  const existing = grants[index];
  if (existing === undefined) {
    grant = {
      grantId: newGrantId(),
      generation: 1,
      source: input.source,
      purpose: input.purpose,
      scope: input.scope,
      scopeKeys: canonicalKeys(input.scopeKeys),
      enabled: input.enabled,
      noticeVersion: input.noticeVersion,
      activatedAt: now,
      ...(input.enabled ? { noticeAcceptedAt: now } : {}),
    };
    grants.push(grant);
  } else {
    const flipped = existing.enabled !== input.enabled;
    grant = {
      ...existing,
      generation: flipped ? existing.generation + 1 : existing.generation,
      enabled: input.enabled,
      noticeVersion: input.noticeVersion,
      activatedAt: flipped && input.enabled ? now : existing.activatedAt,
      ...(input.enabled && (flipped || existing.noticeVersion !== input.noticeVersion || existing.noticeAcceptedAt === undefined) ? { noticeAcceptedAt: now } : {}),
    };
    grants[index] = grant;
  }

  const consent = await save({ ...before, grants }, home);
  return { consent, grant };
}

/** `grant_` and twelve hex digits: opaque, unguessable enough for a key nobody types, and never a path or a phrase. */
function newGrantId(): string {
  return `grant_${randomBytes(6).toString("hex")}`;
}

/**
 * The grant that governs one purpose of one source for one scope key, or `undefined` when the
 * answer is no. Pure, over an already read consent.
 *
 * The precedence is plan §25.1, in this order:
 *
 * 1. The source permission is the floor: without `sources[source] === true` nothing below is
 *    consulted. Revoking it turns every purpose of that source off at once.
 * 2. An explicit project grant —one whose keys name `scopeKey`— wins over the global one, and it
 *    wins when it says `false` too. When several project grants name the same key, the most
 *    restrictive one decides: one disabled among them is a no.
 * 3. Without a project grant, the global one (`*`) answers; without any, the answer is no.
 * 4. A semantic purpose (`memoryExtract`, `twinAutoLearn`) needs an enabled `memoryCapture`
 *    resolved the same way for the same key: a process that may not observe may not extract.
 *
 * What comes back is always an enabled grant, so a caller can bind its cursor to the id and the
 * generation it names.
 */
export function grantFor(
  consent: TwinConsent,
  source: HistorySourceId,
  purpose: GrantPurpose,
  scopeKey: string,
): ConsentGrant | undefined {
  if (!isAllowed(consent, source)) return undefined;
  const grant = resolveGrant(consent.grants ?? [], source, purpose, scopeKey);
  if (grant === undefined) return undefined;
  if (SEMANTIC_PURPOSES[purpose] && resolveGrant(consent.grants ?? [], source, "memoryCapture", scopeKey) === undefined) {
    return undefined;
  }
  return grant;
}

function resolveGrant(
  grants: ConsentGrant[],
  source: HistorySourceId,
  purpose: GrantPurpose,
  scopeKey: string,
): ConsentGrant | undefined {
  const own = grants.filter((grant) => grant.source === source && grant.purpose === purpose);
  const explicit = own.filter((grant) => grant.scope === "project" && grant.scopeKeys.includes(scopeKey));
  if (explicit.length > 0) {
    return explicit.every((grant) => grant.enabled) ? explicit[0] : undefined;
  }
  const global = own.find((grant) => grant.scope === "global");
  return global !== undefined && global.enabled ? global : undefined;
}

/**
 * Write the entire file separately and rename it on top.
 *
 * This does fail if the disk fails, unlike `readConsent`, and the asymmetry is the point: from a
 * failed read you exit with a no, which is safe; from a failed write you would exit with a screen
 * saying 'granted' over a file that does not exist, and the user would believe they decided
 * something that will be lost on reboot.
 *
 * `grants` is written only when there is at least one: a file that never held a grant keeps the
 * exact shape it had before grants existed, so nothing that compares it byte for byte notices.
 */
async function save(consent: TwinConsent, home?: string): Promise<TwinConsent> {
  const { grants, ...rest } = consent;
  const next: TwinConsent = { ...rest, updatedAt: new Date().toISOString() };
  if (grants !== undefined && grants.length > 0) next.grants = grants;

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
