import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { newId } from "./agents";
import * as t from "./schema";

/**
 * A context is what one recipient keeps; a session is a conversation. The two were one thing
 * until the memory contract v2, and that was the hole: a rule delivered at the start of a session
 * was marked "seen" for the whole session, while the program that received it compacted its
 * window, resumed from a summary or spawned a subagent with an empty context, and the rule was
 * gone for everyone who came after. This module keeps the counter that says which generation of
 * which recipient a delivery was prepared for, so that the selector can repeat a rule when the
 * context that held it was discarded, and only then.
 *
 * ── The rules, and why an ambiguous event repeats instead of suppressing ─────────────────────
 *
 * When the program names the lifecycle event with a reliable coordinate of its own, the event
 * becomes a `lifecycle_key` and a retry of the same event finds the same row unchanged. Without
 * that coordinate a start, a resume or a compaction is ambiguous: it may be the retry of an event
 * already counted, or a new one that emptied the window. The generation rises in both cases.
 * Repeating a rule costs a few hundred tokens; suppressing one that vanished costs the rule, and
 * the decision record (plan §6.2) accepts the first cost by name. A plain touch —a delivery that
 * mentions no lifecycle event— never raises anything: it says the recipient is still here.
 *
 * ── Why the counter lives here and not in a file ───────────────────────────────────────────────
 *
 * The hooks that ask for memory run in separate processes, and any file they could share would
 * be a second authority with its own races and its own idea of "seen". The catalog decides;
 * restarting the server loses no generation, and two callers resolving the same recipient at
 * once serialize on an advisory lock keyed by that recipient, so that they end with one row and
 * not two. The row's `rev` is the compare-and-set counter: a generation only rises against the
 * revision the caller read.
 */

export type ContextLifecycleKind = "start" | "resume" | "compact";

export interface ContextRow {
  id: string;
  projectId: string;
  harness: string;
  entrypoint: string;
  recipientKey: string;
  nativeSessionKey: string | null;
  agentId: string | null;
  generation: number;
  rev: number;
  lifecycleKey: string | null;
  createdAt: Date;
  lastSeenAt: Date;
}

export interface ResolveContextInput {
  projectId: string;
  harness: string;
  entrypoint: string;
  recipientKey: string;
  nativeSessionKey?: string | null;
  agentId?: string | null;
  lifecycle?: { kind: ContextLifecycleKind; nativeEventId?: string };
}

export interface ResolvedContext {
  context: ContextRow;
  /** The row was inserted by this call. */
  created: boolean;
  /** An existing row's generation rose by one in this call. */
  generationRaised: boolean;
}

const LIFECYCLE_KINDS: readonly ContextLifecycleKind[] = ["start", "resume", "compact"];
/** The first half of the advisory lock key: this table, and nothing else that hashes text. */
const LOCK_NAMESPACE = 0x6d637478;
const KEY_MAX = 256;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

const COLUMNS = {
  id: t.memoryContexts.id,
  projectId: t.memoryContexts.projectId,
  harness: t.memoryContexts.harness,
  entrypoint: t.memoryContexts.entrypoint,
  recipientKey: t.memoryContexts.recipientKey,
  nativeSessionKey: t.memoryContexts.nativeSessionKey,
  agentId: t.memoryContexts.agentId,
  generation: t.memoryContexts.generation,
  rev: t.memoryContexts.rev,
  lifecycleKey: t.memoryContexts.lifecycleKey,
  createdAt: t.memoryContexts.createdAt,
  lastSeenAt: t.memoryContexts.lastSeenAt,
};

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > KEY_MAX || CONTROL_CHARACTER.test(value)) {
    throw new TypeError(`A memory context ${name} must be a short identifier.`);
  }
  return value;
}

/**
 * A segment of the lifecycle key is an identifier the server or the program produced, never
 * free text: no separator inside it, so that `a/b` + `c` and `a` + `b/c` cannot name the same
 * lifecycle key.
 */
function keySegment(value: unknown, name: string): string {
  const segment = identifier(value, name);
  if (segment.includes("/")) throw new TypeError(`A memory context ${name} cannot contain a separator.`);
  return segment;
}

function optionalIdentifier(value: unknown, name: string): string | null {
  return value === undefined || value === null ? null : identifier(value, name);
}

/** The recipient tuple the rules match on, as one string for the advisory lock. */
function recipientLockKey(input: { projectId: string; harness: string; entrypoint: string; recipientKey: string; nativeSessionKey: string | null }): string {
  return JSON.stringify([input.projectId, input.harness, input.entrypoint, input.recipientKey, input.nativeSessionKey]);
}

function lifecycleKeyOf(input: { harness: string; entrypoint: string; recipientKey: string }, nativeEventId: string): string {
  return `${input.harness}/${input.entrypoint}/${input.recipientKey}/${nativeEventId}`;
}

/**
 * The context a delivery is prepared for, created, touched or advanced according to the rules
 * above. Call it inside a transaction: the advisory lock and the row lock last exactly as long
 * as that transaction, which is what makes two concurrent callers end with one row.
 */
export async function resolveContext(tx: Database, input: ResolveContextInput): Promise<ResolvedContext> {
  const recipient = {
    projectId: identifier(input.projectId, "project id"),
    harness: keySegment(input.harness, "harness"),
    entrypoint: keySegment(input.entrypoint, "entrypoint"),
    recipientKey: keySegment(input.recipientKey, "recipient key"),
    nativeSessionKey: optionalIdentifier(input.nativeSessionKey, "native session key"),
  };
  const agentId = optionalIdentifier(input.agentId, "agent id");
  const lifecycle = input.lifecycle;
  if (lifecycle !== undefined && !LIFECYCLE_KINDS.includes(lifecycle.kind)) throw new TypeError("Unknown memory context lifecycle kind.");
  const nativeEventId = lifecycle?.nativeEventId === undefined ? null : keySegment(lifecycle.nativeEventId, "native event id");
  const lifecycleKey = nativeEventId === null ? null : lifecycleKeyOf(recipient, nativeEventId);

  await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}::int, hashtext(${recipientLockKey(recipient)}::text))`);

  if (lifecycleKey !== null) {
    const [retried] = await tx.select(COLUMNS).from(t.memoryContexts).where(eq(t.memoryContexts.lifecycleKey, lifecycleKey)).limit(1);
    if (retried) return { context: retried, created: false, generationRaised: false };
  }

  const [current] = await tx.select(COLUMNS).from(t.memoryContexts)
    .where(and(
      eq(t.memoryContexts.projectId, recipient.projectId),
      eq(t.memoryContexts.harness, recipient.harness),
      eq(t.memoryContexts.entrypoint, recipient.entrypoint),
      eq(t.memoryContexts.recipientKey, recipient.recipientKey),
      recipient.nativeSessionKey === null ? isNull(t.memoryContexts.nativeSessionKey) : eq(t.memoryContexts.nativeSessionKey, recipient.nativeSessionKey),
    ))
    .orderBy(desc(t.memoryContexts.lastSeenAt), desc(t.memoryContexts.createdAt), desc(t.memoryContexts.id))
    .limit(1)
    .for("update");

  if (!current) {
    const [created] = await tx.insert(t.memoryContexts).values({
      id: newId("mctx"),
      projectId: recipient.projectId,
      harness: recipient.harness,
      entrypoint: recipient.entrypoint,
      recipientKey: recipient.recipientKey,
      nativeSessionKey: recipient.nativeSessionKey,
      agentId,
      lifecycleKey,
    }).returning(COLUMNS);
    if (!created) throw new Error("The memory context insert returned no row.");
    return { context: created, created: true, generationRaised: false };
  }

  if (lifecycle === undefined) {
    const [touched] = await tx.update(t.memoryContexts).set({ lastSeenAt: sql`now()` })
      .where(eq(t.memoryContexts.id, current.id)).returning(COLUMNS);
    return { context: touched ?? current, created: false, generationRaised: false };
  }

  const [raised] = await tx.update(t.memoryContexts).set({
    generation: sql`${t.memoryContexts.generation} + 1`,
    rev: sql`${t.memoryContexts.rev} + 1`,
    lastSeenAt: sql`now()`,
    lifecycleKey,
  }).where(and(eq(t.memoryContexts.id, current.id), eq(t.memoryContexts.rev, current.rev))).returning(COLUMNS);
  if (!raised) throw new Error("The memory context changed while its generation was being raised.");
  return { context: raised, created: false, generationRaised: true };
}

/** The recipient is still here; nothing about what it holds changed. */
export async function touchContext(tx: Database, id: string): Promise<void> {
  await tx.update(t.memoryContexts).set({ lastSeenAt: sql`now()` }).where(eq(t.memoryContexts.id, id));
}

export async function contextById(db: Database, id: string): Promise<ContextRow | undefined> {
  const [row] = await db.select(COLUMNS).from(t.memoryContexts).where(eq(t.memoryContexts.id, id)).limit(1);
  return row;
}

/** The recipients most recently seen in a project, newest first. */
export async function contextsForProject(db: Database, projectId: string, limit = 50): Promise<ContextRow[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError("A memory context limit must be a positive integer.");
  return db.select(COLUMNS).from(t.memoryContexts).where(eq(t.memoryContexts.projectId, projectId))
    .orderBy(desc(t.memoryContexts.lastSeenAt), desc(t.memoryContexts.createdAt), desc(t.memoryContexts.id)).limit(limit);
}
