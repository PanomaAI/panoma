import { redactSecrets } from "@panoma/core";
import { and, asc, desc, eq, getTableColumns, inArray, isNull, sql, type SQLWrapper } from "drizzle-orm";
import type { Database } from "./client";
import { idFor } from "./ingest";
import * as t from "./schema";

export const EPISODE_FIELDS = [
  "context", "goal", "constraints", "alternatives", "decision", "rationale", "outcome", "conditions", "exceptions",
] as const;
export type EpisodeFieldName = typeof EPISODE_FIELDS[number];
export type EpisodeFields = Partial<Record<EpisodeFieldName, { text: string; narrativeId?: string }>>;

export interface NewNarrative {
  identity: string;
  source: string;
  sessionId: string;
  at: Date;
  kind: "opening" | "reaction" | "brief";
  text: string;
  context: string | null;
  truncated: boolean;
}

export interface Narrative extends NewNarrative {
  id: string;
  createdAt: Date;
  readAt?: Date | null;
  /** Set by a pass whose output was unusable; cleared by a pass that read the record. */
  failedAt?: Date | null;
}

export interface NewDecisionEpisode {
  identity: string | null;
  supersedesId?: string | null;
  origin: "owner" | "history";
  fields: EpisodeFields;
  model: string | null;
  /**
   * The last instant this decision applies; omitted or null for one that does not expire. The
   * owner writes a calendar day and it arrives here as that day at 23:59:59.999 UTC: see
   * `valid_until` in the schema for why the end of the day, and why it is a column.
   */
  validUntil?: Date | null;
}

export interface DecisionEpisode extends NewDecisionEpisode {
  id: string;
  supersedesId: string | null;
  status: "active" | "dismissed";
  validUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const CHUNK = 500;

/** A rejected revision leaves both the saved history and its current version untouched. */
export class DecisionEpisodeConflict extends Error {
  constructor(readonly code: "activeSuccessor" | "stale") {
    super(code === "stale" ? "The decision episode changed since it was read." : "Another version of this decision is active.");
    this.name = "DecisionEpisodeConflict";
  }
}

/**
 * These short writes lock in PostgreSQL, not just in the web process. The lock also protects
 * families whose original source was forgotten: there may be no ancestor row left to lock.
 * Nested callers retain their surrounding transaction, including extraction read receipts.
 */
async function episodeWrite<T>(db: Database, work: (tx: Database) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table ${t.decisionEpisodes} in share row exclusive mode`);
    return work(tx);
  });
}

/** Caller owns the write queue and transaction; these helpers also work inside that transaction. */
export async function saveNarratives(db: Database, rows: NewNarrative[]): Promise<{ inserted: number }> {
  const unique = new Map<string, NewNarrative>();
  for (const row of rows) {
    const clean = { ...row, text: redactSecrets(row.text.trim()), context: row.context === null ? null : redactSecrets(row.context) };
    if (!clean.text || !clean.identity || !clean.source || !clean.sessionId || !Number.isFinite(clean.at.getTime())) {
      throw new Error("Narratives require human text, a project identity, a source, a session and a valid date.");
    }
    // Identity is resolved from the catalog and can improve; it does not create a second source.
    const id = idFor(JSON.stringify([clean.source, clean.sessionId, clean.at.toISOString(), clean.text]));
    unique.set(id, clean);
  }
  const values = [...unique].map(([id, row]) => ({ id, ...row }));
  let inserted = 0;
  for (let offset = 0; offset < values.length; offset += CHUNK) {
    const chunk = values.slice(offset, offset + CHUNK);
    const saved = await db.insert(t.narratives).values(chunk).onConflictDoNothing().returning({ id: t.narratives.id });
    inserted += saved.length;
    const insertedIds = new Set(saved.map((row) => row.id));
    const existing = chunk.filter((row) => !insertedIds.has(row.id));
    if (existing.length === 0) continue;
    const stored = await narrativesByIds(db, existing.map((row) => row.id));
    const identities = new Map(stored.map((row) => [row.id, row.identity]));
    const remaps = new Map<string, string[]>();
    for (const row of existing) {
      if (identities.get(row.id) === row.identity) continue;
      const ids = remaps.get(row.identity) ?? [];
      ids.push(row.id);
      remaps.set(row.identity, ids);
    }
    for (const [identity, ids] of remaps) {
      await db.update(t.narratives).set({ identity, readAt: null }).where(inArray(t.narratives.id, ids));
    }
  }
  return { inserted };
}

/**
 * Newest first; an omitted limit means the complete requested corpus. Among the unread, the
 * records no pass has failed on come before the ones one has: see `failedAt` in the schema.
 */
export async function listNarratives(
  db: Database,
  options: { identity?: string; limit?: number; unread?: boolean } = {},
): Promise<Narrative[]> {
  const query = db.select().from(t.narratives).where(and(
    options.identity === undefined ? undefined : eq(t.narratives.identity, options.identity),
    options.unread ? isNull(t.narratives.readAt) : undefined,
  )).orderBy(
    ...(options.unread ? [sql`${t.narratives.failedAt} asc nulls first`] : []),
    desc(t.narratives.at),
    asc(t.narratives.id),
  );
  return options.limit === undefined ? query : query.limit(options.limit);
}

/** Resolve provenance in bounded SQL batches, with deterministic ordering and no missing rows invented. */
export async function narrativesByIds(db: Database, ids: string[]): Promise<Narrative[]> {
  const unique = [...new Set(ids)];
  const rows: Narrative[] = [];
  for (let offset = 0; offset < unique.length; offset += CHUNK) {
    rows.push(...await db.select().from(t.narratives).where(inArray(t.narratives.id, unique.slice(offset, offset + CHUNK))));
  }
  return rows.sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id));
}

/** `deferred` counts the pending records a pass already failed on; they are still pending. */
export async function narrativeCount(db: Database): Promise<{ total: number; pending: number; deferred: number }> {
  const [row] = await db.select({
    total: sql<number>`count(*)::int`,
    pending: sql<number>`count(*) filter (where ${t.narratives.readAt} is null)::int`,
    deferred: sql<number>`count(*) filter (where ${t.narratives.readAt} is null and ${t.narratives.failedAt} is not null)::int`,
  }).from(t.narratives);
  return row ?? { total: 0, pending: 0, deferred: 0 };
}

/**
 * Remember that a pass over these records came back unusable, so the next pass takes other
 * records first. Only unread records: a read one has nothing left to rotate.
 */
export async function markNarrativesFailed(db: Database, ids: string[]): Promise<number> {
  let marked = 0;
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += CHUNK) {
    const rows = await db.update(t.narratives).set({ failedAt: new Date() }).where(and(
      inArray(t.narratives.id, unique.slice(offset, offset + CHUNK)),
      isNull(t.narratives.readAt),
    )).returning({ id: t.narratives.id });
    marked += rows.length;
  }
  return marked;
}

/** Forget source material and all extracted fields that copied it. Owner-authored episodes remain. */
export async function deleteNarratives(
  db: Database,
  options: { source?: string } = {},
): Promise<{ narratives: number; episodes: number }> {
  const episodes = await db.delete(t.decisionEpisodes).where(and(
    eq(t.decisionEpisodes.origin, "history"),
    options.source === undefined ? undefined : sql`exists (
      select 1 from jsonb_each(${t.decisionEpisodes.fields}) as field(name, evidence)
      inner join ${t.narratives} on ${t.narratives.id} = field.evidence->>'narrativeId'
      where ${t.narratives.source} = ${options.source}
    )`,
  )).returning({ id: t.decisionEpisodes.id });
  const narratives = await db.delete(t.narratives).where(
    options.source === undefined ? undefined : eq(t.narratives.source, options.source),
  ).returning({ id: t.narratives.id });
  return { narratives: narratives.length, episodes: episodes.length };
}

/** A successful empty extraction still advances. A remapped source cannot consume a stale receipt. */
export async function markNarrativesRead(db: Database, ids: string[], expectedIdentity?: string): Promise<number> {
  let marked = 0;
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += CHUNK) {
    const rows = await db.update(t.narratives).set({ readAt: new Date() }).where(and(
      inArray(t.narratives.id, unique.slice(offset, offset + CHUNK)),
      isNull(t.narratives.readAt),
      expectedIdentity === undefined ? undefined : eq(t.narratives.identity, expectedIdentity),
    )).returning({ id: t.narratives.id });
    marked += rows.length;
  }
  return marked;
}

function cleanFields(input: NewDecisionEpisode): EpisodeFields {
  const fields: EpisodeFields = {};
  for (const name of Object.keys(input.fields)) {
    if (!(EPISODE_FIELDS as readonly string[]).includes(name)) throw new Error("Unknown decision episode field.");
  }
  for (const name of EPISODE_FIELDS) {
    const field = input.fields[name];
    if (!field) continue;
    const text = redactSecrets(field.text.trim());
    if (!text) throw new Error("Decision episode fields must contain text.");
    if (input.origin === "owner" && field.narrativeId !== undefined) {
      throw new Error("Owner-authored episodes cannot claim extracted narrative evidence.");
    }
    if (input.origin === "history" && !field.narrativeId) {
      throw new Error("Every extracted field must cite its human narrative.");
    }
    fields[name] = field.narrativeId ? { text, narrativeId: field.narrativeId } : { text };
  }
  if (Object.keys(fields).length === 0) throw new Error("A decision episode must contain at least one field.");
  return fields;
}

function normalized(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function episodeId(row: NewDecisionEpisode): string {
  const fields = EPISODE_FIELDS.flatMap((name) => {
    const field = row.fields[name];
    return field ? [[name, row.origin === "owner" ? normalized(field.text) : field.text, field.narrativeId ?? null]] : [];
  });
  return idFor(JSON.stringify([row.origin, row.origin === "owner" ? row.identity : null, row.supersedesId ?? null, fields]));
}

/**
 * Validate the entire batch before its first write. Only literal human text can become a history
 * field; an agent delivery in narrative.context cannot acquire human authorship through a citation.
 */
export async function saveDecisionEpisodes(
  db: Database,
  rows: NewDecisionEpisode[],
  options: { expectedPreviousUpdatedAt?: Date } = {},
): Promise<DecisionEpisode[]> {
  if (rows.length === 0) return [];
  return episodeWrite(db, (tx) => saveEpisodesLocked(tx, rows, options));
}

async function saveEpisodesLocked(
  db: Database,
  rows: NewDecisionEpisode[],
  options: { expectedPreviousUpdatedAt?: Date },
): Promise<DecisionEpisode[]> {
  const unique = new Map<string, NewDecisionEpisode>();
  for (const input of rows) {
    if (input.origin !== "owner" && input.origin !== "history") throw new Error("Unknown decision episode origin.");
    if (input.origin === "owner" && input.model !== null) throw new Error("Owner-authored episodes cannot have a model attribution.");
    if (input.origin === "history" && (!input.identity || !input.model?.trim())) {
      throw new Error("Extracted episodes require a project identity and a model attribution.");
    }
    if (input.validUntil !== undefined && input.validUntil !== null && !Number.isFinite(input.validUntil.getTime())) {
      throw new Error("A decision episode expiry must be a valid instant.");
    }
    if (input.supersedesId !== undefined && input.supersedesId !== null) {
      if (input.origin !== "owner") throw new Error("Only an owner-authored episode can revise a previous decision.");
      const previous = await decisionEpisodeById(db, input.supersedesId);
      if (!previous || previous.identity !== input.identity) throw new Error("A revision must reference an existing episode in the same project scope.");
    }
    const row = { ...input, fields: cleanFields(input) };
    unique.set(episodeId(row), row);
  }
  const narrativeIds = [...unique.values()].flatMap((row) => Object.values(row.fields).flatMap((field) => field.narrativeId ? [field.narrativeId] : []));
  const evidence = new Map((await narrativesByIds(db, narrativeIds)).map((row) => [row.id, row]));
  for (const row of unique.values()) {
    if (row.origin !== "history") continue;
    for (const field of Object.values(row.fields)) {
      const narrative = evidence.get(field.narrativeId!);
      if (!narrative || narrative.identity !== row.identity || !narrative.text.includes(field.text)) {
        throw new Error("Extracted fields must quote an existing human narrative from the same project.");
      }
    }
  }
  const saved: DecisionEpisode[] = [];
  for (const [id, row] of unique) {
    const existing = await decisionEpisodeById(db, id);
    // An exact retry returns its original receipt, including a later owner dismissal — and its
    // stored expiry, which a retry never changes: `validUntil` is outside the identifier, so two
    // saves of the same testimony with different dates are the same record, and silently taking
    // the newer date would let a retried request move a decision's end without saying so. The
    // expiry is changed on purpose, through `setDecisionEpisodeValidUntil`.
    if (existing) { saved.push(existing); continue; }
    if (row.supersedesId) {
      const previous = await decisionEpisodeById(db, row.supersedesId);
      if (options.expectedPreviousUpdatedAt && previous?.updatedAt.getTime() !== options.expectedPreviousUpdatedAt.getTime()) {
        throw new DecisionEpisodeConflict("stale");
      }
      if (await activeSuccessor(db, row.supersedesId)) throw new DecisionEpisodeConflict("activeSuccessor");
    }
    const [inserted] = await db.insert(t.decisionEpisodes).values({ id, ...row }).onConflictDoNothing().returning();
    if (inserted) {
      if (row.supersedesId) {
        await db.update(t.decisionEpisodes).set({ status: "dismissed", updatedAt: sql`greatest(current_timestamp, ${t.decisionEpisodes.updatedAt} + interval '1 millisecond')` })
          .where(eq(t.decisionEpisodes.id, row.supersedesId));
      }
      saved.push(asEpisode(inserted));
      continue;
    }
    // A re-extraction may repair a remapped scope. The existing owner dismissal always survives.
    if (row.origin === "history") {
      await db.update(t.decisionEpisodes).set({ identity: row.identity, updatedAt: new Date() }).where(and(
        eq(t.decisionEpisodes.id, id),
        sql`${t.decisionEpisodes.identity} is distinct from ${row.identity}`,
      ));
    }
    const replayed = await decisionEpisodeById(db, id);
    if (replayed) saved.push(replayed);
  }
  return saved;
}

function asEpisode(row: typeof t.decisionEpisodes.$inferSelect): DecisionEpisode {
  return { ...row, fields: row.fields as EpisodeFields };
}

/** Source reattribution or deletion immediately makes stale extracted evidence ineligible. */
function validEvidence(columns: { origin: SQLWrapper; fields: SQLWrapper; identity: SQLWrapper } = t.decisionEpisodes) {
  return sql`(${columns.origin} = 'owner' or not exists (
    select 1 from jsonb_each(${columns.fields}) as field(name, evidence)
    left join ${t.narratives} on ${t.narratives.id} = field.evidence->>'narrativeId'
    where ${t.narratives.id} is null
      or ${t.narratives.identity} is distinct from ${columns.identity}
  ))`;
}

/** The row the correlated family subqueries below walk, seen through `validEvidence`. */
const CANDIDATE = { origin: sql`candidate.origin`, fields: sql`candidate.fields`, identity: sql`candidate.identity` };

/** Another valid active member anywhere in this row's revision family: the conflict predicate. */
function competingActive() {
  return sql`exists (
    select 1 from decision_episodes candidate
    where candidate.id in (${familyIds(sql`decision_episodes.id`)})
      and candidate.id <> decision_episodes.id and candidate.status = 'active'
      and ${validEvidence(CANDIDATE)}
  )`;
}

/**
 * The listing order, and the reason it is truncated. `created_at` keeps microseconds and every row
 * of one transaction shares the same instant, while a JavaScript `Date` — which is what a client
 * hands back as a paging position — stops at the millisecond. Ordering by the raw column and paging
 * by the rounded one would let two rows written within the same millisecond straddle a page and
 * fall through it. Truncating on both sides makes the key the client can see the key the database
 * sorts by; below one millisecond the identifier decides, as it always did on exact ties.
 */
const CREATED_MS = sql`date_trunc('milliseconds', ${t.decisionEpisodes.createdAt})`;

/** The fields a search reads. Outcome, constraints and alternatives explain a decision; these name it. */
const SEARCHED_FIELDS = ["goal", "decision", "rationale", "conditions", "exceptions", "context"] as const;

export interface EpisodePosition {
  createdAt: Date;
  id: string;
}

/**
 * An explicit null identity requests only portfolio-wide owner episodes. Undefined requests all.
 * `query` is a case-insensitive substring over the texts of the searched fields, with the `LIKE`
 * wildcards escaped so a person searching for `100%` finds that and not everything. `before` pages
 * older rows from a position on the same order; both are ignored when absent.
 *
 * `activeAt` withholds the decisions that had already stopped applying at that instant, and every
 * delivery to an agent passes it. It is not the default, and that is the whole design: an expired
 * decision is wasted context for an agent and the owner's own history for the owner, so their
 * screen keeps listing it, expired and visible, and only they can see it that way.
 */
export async function listDecisionEpisodes(
  db: Database,
  options: {
    identity?: string | null;
    status?: "active" | "dismissed";
    limit?: number;
    ownerDecisionsOnly?: boolean;
    unambiguousOnly?: boolean;
    activeAt?: Date;
    query?: string;
    before?: EpisodePosition;
  } = {},
): Promise<DecisionEpisode[]> {
  const needle = options.query?.trim() ?? "";
  const pattern = `%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const query = db.select().from(t.decisionEpisodes).where(and(
    validEvidence(),
    options.identity === undefined ? undefined : options.identity === null ? isNull(t.decisionEpisodes.identity) : eq(t.decisionEpisodes.identity, options.identity),
    options.status === undefined ? undefined : eq(t.decisionEpisodes.status, options.status),
    // Legacy conflicting families remain inspectable by the owner, but cannot supply authority.
    options.unambiguousOnly ? sql`not ${competingActive()}` : undefined,
    // The stored instant is the boundary and not the last valid moment: reaching it is expiring.
    // That is why a day is stored at 23:59:59.999 — the decision covers the whole of its last day.
    options.activeAt === undefined ? undefined : sql`(${t.decisionEpisodes.validUntil} is null
      or ${t.decisionEpisodes.validUntil} > ${options.activeAt.toISOString()}::timestamptz)`,
    options.ownerDecisionsOnly ? and(
      eq(t.decisionEpisodes.origin, "owner"),
      sql`nullif(btrim(${t.decisionEpisodes.fields}->'decision'->>'text'), '') is not null`,
    ) : undefined,
    needle === "" ? undefined : sql`concat_ws(' ', ${sql.join(
      SEARCHED_FIELDS.map((name) => sql`coalesce(${t.decisionEpisodes.fields}->${sql.raw(`'${name}'`)}->>'text', '')`),
      sql`, `,
    )}) ilike ${pattern} escape '\\'`,
    options.before === undefined ? undefined : sql`(${CREATED_MS} < ${options.before.createdAt.toISOString()}::timestamptz
      or (${CREATED_MS} = ${options.before.createdAt.toISOString()}::timestamptz and ${t.decisionEpisodes.id} > ${options.before.id}))`,
  )).orderBy(sql`${CREATED_MS} desc`, asc(t.decisionEpisodes.id));
  const rows = await (options.limit === undefined ? query : query.limit(options.limit));
  return rows.map(asEpisode);
}

/**
 * The legacy conflicts, for the owner to resolve: every valid active row whose family holds
 * another, grouped per family. Nothing here can be created any more — a revision dismisses its
 * predecessor in the same transaction and a second active version is refused with a conflict —
 * but families written before that rule exist, and until now the owner met them only as a card
 * whose "Revise" was disabled. The briefing and the Lab withhold the whole family (`unambiguousOnly`)
 * and this is the list of what they withhold.
 *
 * The group key is the family's own active membership, aggregated per row: the walk is symmetric,
 * so every member of one family aggregates the same set. Families arrive newest first and members
 * newest first, from the one ordering.
 */
export async function listConflictingEpisodeFamilies(db: Database): Promise<DecisionEpisode[][]> {
  const rows = await db.select({
    ...getTableColumns(t.decisionEpisodes),
    members: sql<string>`(
      select string_agg(candidate.id, ',' order by candidate.created_at desc, candidate.id asc)
      from decision_episodes candidate
      where candidate.id in (${familyIds(sql`decision_episodes.id`)})
        and candidate.status = 'active'
        and ${validEvidence(CANDIDATE)}
    )`,
  }).from(t.decisionEpisodes).where(and(
    eq(t.decisionEpisodes.status, "active"),
    validEvidence(),
    competingActive(),
  )).orderBy(sql`${CREATED_MS} desc`, asc(t.decisionEpisodes.id));
  const families = new Map<string, DecisionEpisode[]>();
  for (const { members, ...row } of rows) {
    const family = families.get(members) ?? [];
    family.push(asEpisode(row));
    families.set(members, family);
  }
  return [...families.values()];
}

export async function decisionEpisodeById(db: Database, id: string): Promise<DecisionEpisode | undefined> {
  const [row] = await db.select().from(t.decisionEpisodes).where(and(eq(t.decisionEpisodes.id, id), validEvidence())).limit(1);
  return row ? asEpisode(row) : undefined;
}

/** Traverse the whole family, including siblings and missing original source identifiers. */
function familyIds(id: string | ReturnType<typeof sql>) {
  return sql`with recursive family(id) as (
    select ${id}::text
    union
    select case when edge.id = family.id then edge.supersedes_id else edge.id end
    from decision_episodes edge inner join family
      on edge.id = family.id or edge.supersedes_id = family.id
    where case when edge.id = family.id then edge.supersedes_id else edge.id end is not null
  ) select id from family`;
}

/** The other active member of this revision family, regardless of its distance or direction. */
export async function activeSuccessor(db: Database, id: string): Promise<DecisionEpisode | undefined> {
  const [row] = await db.select().from(t.decisionEpisodes).where(and(
    sql`${t.decisionEpisodes.id} in (${familyIds(id)})`,
    sql`${t.decisionEpisodes.id} <> ${id}`,
    eq(t.decisionEpisodes.status, "active"),
    validEvidence(),
  )).orderBy(desc(t.decisionEpisodes.createdAt), asc(t.decisionEpisodes.id)).limit(1);
  return row ? asEpisode(row) : undefined;
}

/** Server-computed restore/revise state, independent of the limited recent-record view. */
export async function activeEpisodeRevisions(db: Database, ids: string[]): Promise<Record<string, string>> {
  const revisions: Record<string, string> = {};
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += CHUNK) {
    const rows = await db.select({ id: t.decisionEpisodes.id, activeId: sql<string | null>`(
      select candidate.id from decision_episodes candidate
      where candidate.id in (${familyIds(sql`decision_episodes.id`)})
        and candidate.id <> decision_episodes.id and candidate.status = 'active'
        and ${validEvidence(CANDIDATE)}
      order by candidate.created_at desc, candidate.id asc limit 1
    )` }).from(t.decisionEpisodes).where(inArray(t.decisionEpisodes.id, unique.slice(offset, offset + CHUNK)));
    for (const row of rows) if (row.activeId) revisions[row.id] = row.activeId;
  }
  return revisions;
}

export async function decisionEpisodeCount(db: Database): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(t.decisionEpisodes)
    .where(and(eq(t.decisionEpisodes.status, "active"), validEvidence()));
  return row?.count ?? 0;
}

export async function setDecisionEpisodeStatus(
  db: Database,
  id: string,
  status: "active" | "dismissed",
  options: { expectedUpdatedAt?: Date } = {},
): Promise<boolean> {
  if (status !== "active" && status !== "dismissed") throw new Error("Unknown decision episode status.");
  return episodeWrite(db, async (tx) => {
    const existing = await decisionEpisodeById(tx, id);
    if (!existing || existing.status === status) return false;
    if (options.expectedUpdatedAt && existing.updatedAt.getTime() !== options.expectedUpdatedAt.getTime()) {
      throw new DecisionEpisodeConflict("stale");
    }
    if (status === "active" && await activeSuccessor(tx, id)) throw new DecisionEpisodeConflict("activeSuccessor");
    const rows = await tx.update(t.decisionEpisodes).set({ status, updatedAt: sql`greatest(current_timestamp, ${t.decisionEpisodes.updatedAt} + interval '1 millisecond')` }).where(and(
      eq(t.decisionEpisodes.id, id),
      validEvidence(),
      eq(t.decisionEpisodes.status, existing.status),
    )).returning({ id: t.decisionEpisodes.id });
    return rows.length > 0;
  });
}

/**
 * Set or clear when a decision stops applying, without rewriting a word of its testimony.
 *
 * The same lock and the same stale guard as the status change, for the same reason: two owner
 * screens can be open, and one of them can be showing a record another one already changed.
 * Asking for the expiry the record already carries is a successful retry and touches nothing,
 * which is also how a repeated dismissal behaves.
 *
 * Nothing here interprets the date. The caller hands over the instant that the owner's calendar
 * day ends at in UTC; `valid_until` in the schema explains why that is the honest translation.
 */
export async function setDecisionEpisodeValidUntil(
  db: Database,
  id: string,
  validUntil: Date | null,
  options: { expectedUpdatedAt?: Date } = {},
): Promise<boolean> {
  if (validUntil !== null && !Number.isFinite(validUntil.getTime())) throw new Error("A decision episode expiry must be a valid instant.");
  return episodeWrite(db, async (tx) => {
    const existing = await decisionEpisodeById(tx, id);
    if (!existing) return false;
    const stored = existing.validUntil ? existing.validUntil.getTime() : null;
    if (stored === (validUntil ? validUntil.getTime() : null)) return false;
    if (options.expectedUpdatedAt && existing.updatedAt.getTime() !== options.expectedUpdatedAt.getTime()) {
      throw new DecisionEpisodeConflict("stale");
    }
    const rows = await tx.update(t.decisionEpisodes).set({ validUntil, updatedAt: sql`greatest(current_timestamp, ${t.decisionEpisodes.updatedAt} + interval '1 millisecond')` }).where(and(
      eq(t.decisionEpisodes.id, id),
      validEvidence(),
    )).returning({ id: t.decisionEpisodes.id });
    return rows.length > 0;
  });
}
