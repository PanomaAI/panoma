import { isOpaqueId, isOpaqueToken, isRevision } from "@panoma/core";
import {
  CHECK_DOMAINS, checksOf, commitmentById, decisionEpisodeById, listBeliefs, listCommitments, listDecisionEpisodes,
  listProjectNotes, outcomesFor, putCheck, queueWrite, resolveProject, staleOf, validateCheck,
  type Check, type CheckDomain, type CheckInput, type Database, type OccurrenceView,
} from "@panoma/db";
import { NO_STORE, memoryRefusal, readMemoryBody, shapeRefusal, unknownProperty } from "@/lib/agent-channel";
import { db, memoryQuarantine } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { decisionInScope } from "@/lib/select-memory";

/**
 * The checks of a project's memory, for the operator: `GET /api/memory/checks?slug=&itemKind=
 * &itemId=&cursor=` and `POST /api/memory/checks` (plan §23.4.1, spec C).
 *
 * A check is a definition — what a note, a criterion, a decision or a commitment says can be
 * looked at on the disk, with a purpose that says what a miss means — and this door registers
 * definitions only. It never evaluates one: the patrol reads the disk outside any transaction
 * and writes what it saw into `memory_outcomes`; what this door shows beside each definition is
 * that record, the newest look per subject revision and environment with its `stale` flag, so
 * the screen can say `pass`, `fail` or `unknown` with the reason and never the words obeyed or
 * ignored. The rule that a definition and its observations are two different things lives in
 * `packages/db/src/memory-checks.ts`; this is its wire.
 *
 * ── Create and modify ────────────────────────────────────────────────────────────────────
 *
 * A create names the item and the revision the person read (`itemRevision`, the row's
 * `memory_rev`) and gets `201 { id, revision: 1, itemRevision }` — the item moved to a new
 * revision, photographed with the definition. A modify names the check (`checkId`) and, as
 * every other door of this plan, the row revision the person read as `expectedRevision`
 * (`itemRevision` may travel too, and then must be the same number); it gets `200` with the
 * definition's next revision. A create that names a check, or a modify that does not name the
 * revision, is `400 invalid_input` — the two gestures are told apart by their keys, not guessed.
 * A definition the validator refuses is `400 invalid_check` with the validator's reason and
 * never the value; a row that moved is `409 stale_revision` with the number it is at now; a
 * check the row does not carry, or a row that is closed, is `404 not_found`. A first-generation
 * sentinel (`legacy:<n>`) is re-anchored by approval and never edited here: `invalid_check`
 * with reason `legacy`.
 *
 * ── The page ─────────────────────────────────────────────────────────────────────────────
 *
 * With `itemKind` and `itemId` the page is that item's checks. Without them it is the checks of
 * every live item of the project — the notes that are proposed, approved or challenged, the
 * criteria and decisions in the project's scope, the open commitments — fifty at a time in a
 * fixed order (kind, then id, then position) behind an opaque cursor that names the last check
 * served, so a page boundary holds while definitions are added. The observations of a check are
 * read through its item's photographs (`outcomesFor` by item), so a look taken at a previous
 * `memory_rev` of the same definition is still shown, with the subject revision it was made
 * against; the two hundred newest occurrences of an item are read, which for six checks in a
 * handful of worktrees is all of them.
 *
 * The operator key and not only the same origin, in this order and before the body is read:
 * the page names every live rule of the project with its anchors on this disk, and a definition
 * decides what the patrol will look at. The POST needs the local catalog, since the patrol that
 * will honour the definition runs beside it; the GET reads what the catalog holds wherever it
 * lives. Nothing is written under quarantine.
 */

const QUERY_KEYS = ["slug", "itemKind", "itemId", "cursor"] as const;
const BODY_KEYS = ["slug", "itemKind", "itemId", "itemRevision", "checkId", "kind", "purpose", "target", "expected", "expectedRevision"] as const;
const SLUG = /^[A-Za-z0-9._-]{1,200}$/;
const PAGE = 50;
/** Occurrences read per item to find the newest look at each of its checks. */
const OCCURRENCES_PER_ITEM = 200;
/** Commitments read per page while enumerating a project's open ones. */
const COMMITMENTS_PER_PAGE = 200;
/** Pages of commitments an enumeration reads before it stops: two thousand open obligations. */
const COMMITMENT_PAGES_MAX = 10;
const ITEM_KINDS = Object.keys(CHECK_DOMAINS) as CheckDomain[];
/** The notes the patrol reads and `putCheck` accepts: the live ones. */
const NOTE_LIVE = ["proposed", "approved", "challenged"];
/** The criteria that are alive: inferred or signed, as `ALIVE` in `queries.ts`. */
const CRITERION_ALIVE = ["inferred", "signed"] as const;

type Project = NonNullable<Awaited<ReturnType<typeof resolveProject>>>;

/** A live item of the project with the revision a write must name and its checks in stored order. */
interface Item {
  kind: CheckDomain;
  id: string;
  revision: number;
  checks: Check[];
}

/** One look at a check, as the page shows it: the newest row of an occurrence and whether it still counts. */
interface ObservationView {
  subjectRevision: number | null;
  checkRev: number;
  environmentId: string;
  result: string;
  reason: string;
  observedAt: string | null;
  stale: boolean;
}

function isItemKind(value: unknown): value is CheckDomain {
  return typeof value === "string" && (ITEM_KINDS as string[]).includes(value);
}

function inScope(project: Project, row: { identity: string | null; scopeKind: string }): boolean {
  return row.scopeKind === "global" || (row.identity !== null && row.identity === project.identity);
}

/** The stored entries of a column as checks, legacy sentinels normalized by position, as `checksOf` reads them. */
function storedChecks(column: unknown): Check[] {
  return Array.isArray(column) ? column.map((entry, index) => validateCheck(entry, { legacyIndex: index })) : [];
}

/** One live item by kind and id, only when it belongs to this project; undefined otherwise, which the door says as `not_found`. */
async function itemOf(database: Database, project: Project, kind: CheckDomain, id: string): Promise<Item | undefined> {
  switch (kind) {
    case "note": {
      const note = (await listProjectNotes(database, project.id, NOTE_LIVE, { includeExpired: true })).find((row) => row.id === id);
      return note ? { kind, id, revision: note.memoryRev, checks: storedChecks(note.sentinels) } : undefined;
    }
    case "criterion": {
      const belief = (await listBeliefs(database, { states: [...CRITERION_ALIVE] })).find((row) => row.id === id);
      if (!belief || !inScope(project, belief)) return undefined;
      return { kind, id, revision: belief.memoryRev, checks: await checksOf(database, kind, id) };
    }
    case "decision": {
      const episode = await decisionEpisodeById(database, id);
      if (!episode || episode.status !== "active" || decisionInScope(episode, project) !== "in") return undefined;
      return { kind, id, revision: episode.memoryRev, checks: episode.checks };
    }
    case "commitment": {
      const commitment = await commitmentById(database, id);
      if (!commitment || commitment.projectId !== project.id || commitment.status !== "open") return undefined;
      return { kind, id, revision: commitment.memoryRev, checks: [...commitment.checks, ...commitment.completionChecks] };
    }
  }
}

const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Every live item of the project in the page's fixed order: notes, criteria, decisions, commitments; ids ascending. */
async function liveItems(database: Database, project: Project): Promise<Item[]> {
  const items: Item[] = [];
  const notes = await listProjectNotes(database, project.id, NOTE_LIVE, { includeExpired: true });
  for (const note of notes.sort(byId)) items.push({ kind: "note", id: note.id, revision: note.memoryRev, checks: storedChecks(note.sentinels) });
  const beliefs = (await listBeliefs(database, { states: [...CRITERION_ALIVE] })).filter((row) => inScope(project, row)).sort(byId);
  for (const belief of beliefs) items.push({ kind: "criterion", id: belief.id, revision: belief.memoryRev, checks: await checksOf(database, "criterion", belief.id) });
  const episodes = (await listDecisionEpisodes(database, { status: "active" })).filter((row) => decisionInScope(row, project) === "in").sort(byId);
  for (const episode of episodes) items.push({ kind: "decision", id: episode.id, revision: episode.memoryRev, checks: episode.checks });
  const open: Item[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < COMMITMENT_PAGES_MAX; page += 1) {
    const listed = await listCommitments(database, project.id, { status: "open", limit: COMMITMENTS_PER_PAGE, cursor });
    for (const row of listed.commitments) open.push({ kind: "commitment", id: row.id, revision: row.memoryRev, checks: [...row.checks, ...row.completionChecks] });
    cursor = listed.nextCursor;
    if (cursor === null) break;
  }
  items.push(...open.sort(byId));
  return items;
}

function encodeCursor(kind: CheckDomain, id: string, checkId: string): string {
  return Buffer.from(JSON.stringify({ kind, id, checkId }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { kind: CheckDomain; id: string; checkId: string } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const { kind, id, checkId } = parsed as Record<string, unknown>;
  if (!isItemKind(kind) || !isOpaqueId(id) || typeof checkId !== "string" || checkId.length === 0 || checkId.length > 128) return undefined;
  return { kind, id, checkId };
}

/** The observations of one item's checks, keyed by check id: the newest row per occurrence, newest first. */
async function observationsOf(database: Database, itemId: string, now: Date): Promise<Map<string, ObservationView[]>> {
  const { occurrences } = await outcomesFor(database, { itemId, limit: OCCURRENCES_PER_ITEM });
  const views = new Map<string, ObservationView[]>();
  // Newest look first, by the instant the disk was looked at; the row's own instant when the patrol wrote none.
  const lookedAt = (occurrence: OccurrenceView) => (occurrence.latest.observedAt ?? occurrence.latest.createdAt).getTime();
  const sorted = [...occurrences].sort((a, b) => lookedAt(b) - lookedAt(a));
  for (const occurrence of sorted) {
    if (occurrence.kind !== "observation" || occurrence.check === null) continue;
    const list = views.get(occurrence.check.checkId) ?? [];
    list.push(observationView(occurrence, now));
    views.set(occurrence.check.checkId, list);
  }
  return views;
}

function observationView(occurrence: OccurrenceView, now: Date): ObservationView {
  const row = occurrence.latest;
  return {
    subjectRevision: occurrence.subject?.rev ?? null,
    checkRev: occurrence.check?.checkRev ?? row.checkRev ?? 0,
    environmentId: row.environment.environmentId,
    result: row.result,
    reason: row.evidence.reason,
    observedAt: (row.observedAt ?? row.createdAt).toISOString(),
    stale: staleOf(row, now),
  };
}

/** A check on the wire: the definition, the item it belongs to, and what the patrol saw of it. */
function serialize(item: Item, check: Check, observations: ObservationView[]) {
  return {
    itemKind: item.kind,
    itemId: item.id,
    itemRevision: item.revision,
    checkId: check.checkId,
    revision: check.revision,
    purpose: check.purpose,
    kind: check.kind,
    target: check.target,
    expected: check.expected,
    legacy: check.checkId.startsWith("legacy:"),
    latest: observations[0] ?? null,
    observations,
  };
}

export async function GET(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const query = new URL(request.url).searchParams;
  const unknown = [...query.keys()].find((key) => !(QUERY_KEYS as readonly string[]).includes(key));
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known query parameter.`, 400);
  const slug = query.get("slug");
  const itemKind = query.get("itemKind") ?? undefined;
  const itemId = query.get("itemId") ?? undefined;
  const cursor = query.get("cursor") ?? undefined;
  if (slug === null || !SLUG.test(slug)) return memoryRefusal("invalid_input", "slug is not a project slug.", 400);
  if ((itemKind === undefined) !== (itemId === undefined)) return memoryRefusal("invalid_input", "itemKind and itemId name one item together.", 400);
  if (itemKind !== undefined && !isItemKind(itemKind)) return memoryRefusal("invalid_input", "itemKind must be note, criterion, decision or commitment.", 400);
  if (itemId !== undefined && !isOpaqueId(itemId)) return memoryRefusal("invalid_input", "itemId must be an opaque id of 1 to 128 characters.", 400);
  const after = cursor === undefined ? undefined : (isOpaqueToken(cursor) ? decodeCursor(cursor) : undefined);
  if (cursor !== undefined && after === undefined) return memoryRefusal("invalid_input", "cursor must be the page cursor this door answered.", 400);

  const database = (await db()).db;
  const project = await resolveProject(database, { slug });
  if (!project) return memoryRefusal("not_found", "No project has that slug.", 404);

  let items: Item[];
  if (itemKind !== undefined && itemId !== undefined) {
    const item = await itemOf(database, project, itemKind as CheckDomain, itemId);
    if (!item) return memoryRefusal("not_found", `No live ${itemKind} with that id belongs to this project.`, 404);
    items = [item];
  } else {
    items = await liveItems(database, project);
  }

  // The flat run of (item, check) in the fixed order, cut after the cursor and at the page.
  const run: { item: Item; check: Check }[] = [];
  for (const item of items) for (const check of item.checks) run.push({ item, check });
  let start = 0;
  if (after !== undefined) {
    const position = run.findIndex(({ item, check }) => item.kind === after.kind && item.id === after.id && check.checkId === after.checkId);
    if (position < 0) return memoryRefusal("stale_cursor", "The check the cursor names is no longer on the page.", 409, "Read the first page again.");
    start = position + 1;
  }
  const page = run.slice(start, start + PAGE);
  const last = run.length > start + PAGE ? page[page.length - 1] : undefined;

  const now = new Date();
  const observations = new Map<string, Map<string, ObservationView[]>>();
  const checks = [];
  for (const { item, check } of page) {
    let ofItem = observations.get(`${item.kind}:${item.id}`);
    if (ofItem === undefined) {
      ofItem = await observationsOf(database, item.id, now);
      observations.set(`${item.kind}:${item.id}`, ofItem);
    }
    checks.push(serialize(item, check, ofItem.get(check.checkId) ?? []));
  }
  return Response.json({
    checks,
    nextCursor: last ? encodeCursor(last.item.kind, last.item.id, last.check.checkId) : null,
  }, { headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  if (process.env["DATABASE_URL"]) {
    return memoryRefusal("local_catalog_required", "A check is defined beside the patrol that will look at it, on the local catalog.", 403);
  }

  const read = await readMemoryBody(request);
  if ("refusal" in read) return read.refusal;
  const { body } = read;
  const unknown = unknownProperty(body, BODY_KEYS);
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known property.`, 400);
  const { slug, itemKind, itemId, itemRevision, checkId, kind, purpose, target, expected, expectedRevision } = body;
  if (typeof slug !== "string" || !SLUG.test(slug)) return memoryRefusal("invalid_input", "slug is not a project slug.", 400);
  if (!isItemKind(itemKind)) return memoryRefusal("invalid_input", "itemKind must be note, criterion, decision or commitment.", 400);
  if (!isOpaqueId(itemId)) return memoryRefusal("invalid_input", "itemId must be an opaque id of 1 to 128 characters.", 400);
  const modifying = checkId !== undefined || expectedRevision !== undefined;
  let memoryRev: number;
  if (modifying) {
    if (checkId === undefined || expectedRevision === undefined) {
      return memoryRefusal("invalid_input", "A modify names both checkId and expectedRevision; a create names neither.", 400);
    }
    if (!isRevision(expectedRevision)) return memoryRefusal("invalid_input", "expectedRevision must be the item revision the page answered.", 400);
    if (itemRevision !== undefined && itemRevision !== expectedRevision) {
      return memoryRefusal("invalid_input", "On a modify, itemRevision and expectedRevision are the same number: the item revision the page answered.", 400);
    }
    // Bounded here; its shape is the validator's word (`check_id`, or `legacy` for a first-generation sentinel).
    if (typeof checkId !== "string" || checkId.length === 0 || checkId.length > 128) return memoryRefusal("invalid_input", "checkId must be the id the page answered.", 400);
    memoryRev = expectedRevision;
  } else {
    if (!isRevision(itemRevision)) return memoryRefusal("invalid_input", "itemRevision must be the item revision the page answered.", 400);
    memoryRev = itemRevision;
  }
  if (kind === undefined || purpose === undefined || target === undefined || expected === undefined) {
    return memoryRefusal("invalid_input", "A check names its kind, purpose, target and expected value.", 400);
  }

  const guard = await memoryQuarantine();
  if (guard.quarantined) {
    return memoryRefusal("unavailable", `The memory is quarantined (${guard.reason}): nothing is defined until it is reconciled.`, 503, "Reconcile the journal with panoma memory status.");
  }
  const database = (await db()).db;
  const project = await resolveProject(database, { slug });
  if (!project) return memoryRefusal("not_found", "No project has that slug.", 404);
  const item = await itemOf(database, project, itemKind, itemId);
  if (!item) return memoryRefusal("not_found", `No live ${itemKind} with that id belongs to this project.`, 404);

  // The validator refuses the shape before anything is touched; its reason is the answer.
  const definition = { purpose, kind, target, expected, ...(modifying ? { checkId } : {}) } as unknown as CheckInput;
  let outcome: Awaited<ReturnType<typeof putCheck>>;
  try {
    outcome = await queueWrite(() => putCheck(database, itemKind, itemId, definition, { memoryRev }));
  } catch (error) {
    const refusal = shapeRefusal(error);
    if (refusal) return refusal;
    throw error;
  }
  if ("conflict" in outcome) {
    const now = await itemOf(database, project, itemKind, itemId);
    return memoryRefusal("stale_revision", `The ${itemKind} is at revision ${now?.revision ?? "another number"}, not ${memoryRev}.`, 409, "Read the page again before defining.");
  }
  if ("notFound" in outcome) {
    return memoryRefusal("not_found", modifying ? `The ${itemKind} carries no check with that id.` : `No live ${itemKind} with that id belongs to this project.`, 404);
  }
  return Response.json(
    { id: outcome.checkId, revision: outcome.revision, itemRevision: outcome.memoryRev },
    { status: modifying ? 200 : 201, headers: NO_STORE },
  );
}
