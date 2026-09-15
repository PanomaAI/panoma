import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import {
  SOURCE_GAPS_MAX, advanceCursor, allCursorsFor, allSources, blockCursor, claimCursor, cursorCounts, cursorLeased, cursorsFor, ensureCursor, listSources, purgeSourceIdentity,
  recordSourceFingerprint, replaceSourceGeneration, resolveCursorGap, revokeCursors, sourceById, sourceGaps, sourcesByStream, unblockCursor, upsertSource,
  type CursorKey, type SourceInput,
} from "./memory-sources";
import * as t from "./schema";

let db: Database;
let close: () => Promise<void>;
let home: string;
const previousHome = process.env["PANOMA_HOME"];

const LEASE_MS = 60_000;
const at = (offsetMs = 0) => new Date(1_800_000_000_000 + offsetMs);

const stream = (streamKey: string, extra: Partial<SourceInput> = {}): SourceInput => ({
  streamKey, harness: "claude-code", entrypoint: "desktop", locator: `/home/.claude/projects/p/${streamKey}.jsonl`,
  fileIdentity: { observedSize: 4_096, anchorFrom: 3_840, anchorTo: 4_096 }, anchorHash: `anchor-${streamKey}`, origin: "native", ...extra,
});

const keyOf = (sourceId: string, extra: Partial<CursorKey> = {}): CursorKey => ({
  sourceId, purpose: "receipt", grantId: "grant_0123456789ab", scopeKey: "git:project", ...extra,
});

const init = { grantGeneration: 1, allowedFrom: 0, allowedTo: null, parserVersion: "claude-code-receipts-1" };

async function claimed(sourceId: string, extra: Partial<CursorKey> = {}, now = at()) {
  const claim = await claimCursor(db, keyOf(sourceId, extra), { leaseMs: LEASE_MS, now });
  if (!claim) throw new Error("Expected a claim.");
  return claim;
}

async function cursor(sourceId: string, extra: Partial<CursorKey> = {}) {
  const [row] = await cursorsFor(db, { sourceId, ...extra });
  if (!row) throw new Error("Expected a cursor.");
  return row;
}

/** Drizzle wraps a PostgreSQL refusal; the constraint name is in the cause. */
async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "";
  } catch (error) {
    const wrapped = error as Error & { cause?: Error };
    return `${wrapped.message}\n${wrapped.cause?.message ?? ""}`;
  }
}

async function rawLease(sourceId: string): Promise<{ token: string | null; until: Date | null }> {
  const [row] = await db.select({ token: t.memorySourceCursors.leaseToken, until: t.memorySourceCursors.leaseUntil })
    .from(t.memorySourceCursors).where(eq(t.memorySourceCursors.sourceId, sourceId));
  return row ?? { token: null, until: null };
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-sources-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});

beforeEach(async () => {
  await db.delete(t.memorySourceCursors);
  // Generations reference their predecessor with RESTRICT, so the newest ones go first.
  for (;;) {
    const gone = await db.delete(t.memorySources)
      .where(sql`${t.memorySources.id} not in (select ${t.memorySources.previousId} from ${t.memorySources} where ${t.memorySources.previousId} is not null)`)
      .returning({ id: t.memorySources.id });
    if (gone.length === 0) break;
  }
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

describe("sources", () => {
  it("worker metadata pages include sources and cursors beyond the first thousand", async () => {
    const sources = Array.from({ length: 1002 }, (_, index) => ({
      id: `msrc_page_${String(index).padStart(5, "0")}`, streamKey: `page:${index}`, generation: 1, harness: "codex", entrypoint: "cli", origin: "native",
    }));
    await db.insert(t.memorySources).values(sources);
    await db.insert(t.memorySourceCursors).values(sources.map((source) => ({
      sourceId: source.id, purpose: "facts", grantId: "grant_pages", scopeKey: "git:project", grantGeneration: 1,
      allowedFrom: 0, nextByte: 0, parserVersion: "codex-facts-1",
    })));
    expect(await listSources(db, { limit: 1000 })).toHaveLength(1000);
    expect(await cursorsFor(db, { purpose: "facts", limit: 1000 })).toHaveLength(1000);
    expect((await allSources(db)).map((source) => source.id)).toEqual(sources.map((source) => source.id));
    expect((await allCursorsFor(db, { purpose: "facts" })).map((cursor) => cursor.sourceId)).toEqual(sources.map((source) => source.id));
  });

  it("creates generation 1 once and returns the same generation afterwards, fingerprint untouched", async () => {
    const first = await upsertSource(db, stream("s1"));
    expect(first.created).toBe(true);
    expect(first.source).toMatchObject({ streamKey: "s1", generation: 1, previousId: null, status: "active", origin: "native", anchorHash: "anchor-s1" });
    expect(first.source.id).toMatch(/^msrc_/);

    const again = await upsertSource(db, stream("s1", { locator: "/moved/s1.jsonl", anchorHash: "another", fileIdentity: { observedSize: 1 }, parentStreamKey: "parent" }));
    expect(again.created).toBe(false);
    expect(again.source.id).toBe(first.source.id);
    expect(again.source.locator).toBe("/moved/s1.jsonl");
    expect(again.source.parentStreamKey).toBe("parent");
    expect(again.source.anchorHash).toBe("anchor-s1");
    expect(again.source.fileIdentity).toEqual({ observedSize: 4_096, anchorFrom: 3_840, anchorTo: 4_096 });
    expect(again.source.lastSeenAt.getTime()).toBeGreaterThanOrEqual(first.source.lastSeenAt.getTime());
    expect(await sourceById(db, first.source.id)).toEqual(again.source);
  });

  it("records a verified fingerprint only on an active generation", async () => {
    const { source } = await upsertSource(db, stream("s1"));
    expect(await recordSourceFingerprint(db, source.id, { fileIdentity: { observedSize: 8_192, anchorFrom: 7_936, anchorTo: 8_192 }, anchorHash: "anchor-2" })).toBe(true);
    expect(await sourceById(db, source.id)).toMatchObject({ fileIdentity: { observedSize: 8_192, anchorFrom: 7_936, anchorTo: 8_192 }, anchorHash: "anchor-2" });
    await replaceSourceGeneration(db, source.id, stream("s1"));
    expect(await recordSourceFingerprint(db, source.id, { fileIdentity: null, anchorHash: null })).toBe(false);
    expect((await sourceById(db, source.id))?.anchorHash).toBe("anchor-2");
  });

  it("T36: a replaced generation links previous_id, is marked replaced and keeps its cursors while the new one starts bare", async () => {
    const { source: old } = await upsertSource(db, stream("s1"));
    await ensureCursor(db, keyOf(old.id), init);
    const claim = await claimed(old.id);
    expect(await advanceCursor(db, keyOf(old.id), { rev: claim.cursor.rev, leaseToken: claim.leaseToken }, { nextByte: 2_048, release: true })).toBe(true);

    const fresh = await replaceSourceGeneration(db, old.id, stream("s1", { anchorHash: "anchor-after-rewrite", fileIdentity: { observedSize: 512 } }));
    expect(fresh).toMatchObject({ streamKey: "s1", generation: 2, previousId: old.id, status: "active", anchorHash: "anchor-after-rewrite" });
    expect(fresh.id).not.toBe(old.id);
    expect((await sourceById(db, old.id))?.status).toBe("replaced");
    expect((await sourcesByStream(db, "s1")).map((row) => [row.generation, row.status])).toEqual([[1, "replaced"], [2, "active"]]);

    expect(await cursorsFor(db, { sourceId: old.id })).toMatchObject([{ sourceId: old.id, nextByte: 2_048, state: "active" }]);
    expect(await cursorsFor(db, { sourceId: fresh.id })).toEqual([]);
    expect((await upsertSource(db, stream("s1"))).source.id).toBe(fresh.id);

    await expect(replaceSourceGeneration(db, old.id, stream("s1"))).rejects.toThrow(/replaced source generation cannot be replaced/);
    await expect(replaceSourceGeneration(db, fresh.id, stream("s2"))).rejects.toThrow(/one of its own stream/);
    await expect(replaceSourceGeneration(db, "msrc_missing", stream("s1"))).rejects.toThrow(/does not exist/);
    expect((await sourcesByStream(db, "s1")).length).toBe(2);
  });

  it("lists by harness and status, newest seen first", async () => {
    const a = await upsertSource(db, stream("a"));
    await upsertSource(db, stream("b", { harness: "codex", entrypoint: "cli" }));
    await replaceSourceGeneration(db, a.source.id, stream("a"));
    expect((await listSources(db, { harness: "codex" })).map((row) => row.streamKey)).toEqual(["b"]);
    expect((await listSources(db, { status: "replaced" })).map((row) => row.id)).toEqual([a.source.id]);
    expect((await listSources(db, { status: "active" })).map((row) => row.streamKey).sort()).toEqual(["a", "b"]);
    expect((await listSources(db, { limit: 1 })).length).toBe(1);
    await expect(listSources(db, { limit: 0 })).rejects.toThrow(/limit/);
  });

  it("refuses inputs a program should never produce", async () => {
    await expect(upsertSource(db, stream("s1", { harness: "Claude Code" }))).rejects.toThrow(/harness/);
    await expect(upsertSource(db, stream("s1", { entrypoint: "web" as "cli" }))).rejects.toThrow(/entrypoint/);
    await expect(upsertSource(db, stream("s1", { origin: "handoff" as "copy" }))).rejects.toThrow(/origin/);
    await expect(upsertSource(db, stream("s1", { fileIdentity: [1] as unknown as Record<string, unknown> }))).rejects.toThrow(/file identity/);
    await expect(upsertSource(db, stream(""))).rejects.toThrow(/stream key/);
    expect(await listSources(db)).toEqual([]);
  });

  it("purges a source's identity once, closes the generation, revokes its cursors and leaves the tombstone in place", async () => {
    const { source } = await upsertSource(db, stream("s1"));
    await ensureCursor(db, keyOf(source.id), init);
    const claim = await claimed(source.id);
    expect(await purgeSourceIdentity(db, source.id)).toBe(true);
    expect(await sourceById(db, source.id)).toMatchObject({ status: "purged", locator: null, fileIdentity: null, anchorHash: null, streamKey: "s1" });
    expect((await sourceById(db, source.id))?.purgedAt).toBeInstanceOf(Date);
    expect(await cursor(source.id)).toMatchObject({ state: "revoked", leaseUntil: null });
    expect(await advanceCursor(db, keyOf(source.id), { rev: claim.cursor.rev, leaseToken: claim.leaseToken }, { nextByte: 10 })).toBe(false);
    expect(await purgeSourceIdentity(db, source.id)).toBe(false);
    expect(await purgeSourceIdentity(db, "msrc_missing")).toBe(false);
    const tombstone = await upsertSource(db, stream("s1"));
    expect(tombstone).toMatchObject({ created: false, source: { id: source.id, status: "purged", locator: null } });
    expect(await claimCursor(db, keyOf(source.id), { leaseMs: LEASE_MS, now: at() })).toBeUndefined();
  });
});

describe("cursors", () => {
  it("T33: the same offset on two streams is two identities, and two purposes on one stream progress apart", async () => {
    const a = (await upsertSource(db, stream("a"))).source;
    const b = (await upsertSource(db, stream("b"))).source;
    expect(a.id).not.toBe(b.id);
    await ensureCursor(db, keyOf(a.id), init);
    await ensureCursor(db, keyOf(b.id), init);
    await ensureCursor(db, keyOf(a.id, { purpose: "facts" }), init);
    const ca = await claimed(a.id);
    const cb = await claimed(b.id);
    expect(await advanceCursor(db, keyOf(a.id), { rev: ca.cursor.rev, leaseToken: ca.leaseToken }, { nextByte: 4_000, release: true })).toBe(true);
    expect(await advanceCursor(db, keyOf(b.id), { rev: cb.cursor.rev, leaseToken: cb.leaseToken }, { nextByte: 4_000, release: true })).toBe(true);
    const rows = await cursorsFor(db);
    // Ids are random, so the key order of the listing follows whichever id sorts first.
    const progress = new Map<string, (string | number)[][]>([[a.id, [["facts", 0], ["receipt", 4_000]]], [b.id, [["receipt", 4_000]]]]);
    const expected = [a.id, b.id].sort().flatMap((id) => progress.get(id)!.map((row) => [id, ...row]));
    expect(rows.map((row) => [row.sourceId, row.purpose, row.nextByte])).toEqual(expected);
    expect(await cursorsFor(db, { sourceId: a.id, purpose: "receipt" })).toHaveLength(1);
    expect(await cursorsFor(db, { state: "pending" })).toMatchObject([{ sourceId: a.id, purpose: "facts" }]);
    expect(JSON.stringify(rows)).not.toContain(ca.leaseToken);
    expect(JSON.stringify(rows)).not.toContain(cb.leaseToken);
  });

  it("ensures a pending cursor at the boundary once and never rewinds it", async () => {
    const { source } = await upsertSource(db, stream("s1"));
    const created = await ensureCursor(db, keyOf(source.id), { ...init, allowedFrom: 4_096 });
    expect(created).toMatchObject({ state: "pending", allowedFrom: 4_096, nextByte: 4_096, allowedTo: null, rev: 1, grantGeneration: 1, parserVersion: "claude-code-receipts-1" });
    const claim = await claimed(source.id);
    expect(await advanceCursor(db, keyOf(source.id), { rev: claim.cursor.rev, leaseToken: claim.leaseToken }, { nextByte: 5_000, release: true })).toBe(true);
    const same = await ensureCursor(db, keyOf(source.id), { ...init, allowedFrom: 0 });
    expect(same).toMatchObject({ allowedFrom: 4_096, nextByte: 5_000, state: "active" });
    const older = await ensureCursor(db, keyOf(source.id), { ...init, grantGeneration: 1, allowedFrom: 9_000 });
    expect(older).toMatchObject({ allowedFrom: 4_096, nextByte: 5_000 });
  });

  it("re-arms a revoked cursor when the grant generation rises, at the new boundary and never behind the old position", async () => {
    const { source } = await upsertSource(db, stream("s1"));
    await ensureCursor(db, keyOf(source.id), init);
    const claim = await claimed(source.id);
    expect(await advanceCursor(db, keyOf(source.id), { rev: claim.cursor.rev, leaseToken: claim.leaseToken }, { nextByte: 3_000, release: true })).toBe(true);
    expect(await revokeCursors(db, { grantId: "grant_0123456789ab" })).toBe(1);
    expect(await claimCursor(db, keyOf(source.id), { leaseMs: LEASE_MS, now: at() })).toBeUndefined();

    const rearmed = await ensureCursor(db, keyOf(source.id), { ...init, grantGeneration: 2, allowedFrom: 8_000 });
    expect(rearmed).toMatchObject({ state: "pending", grantGeneration: 2, allowedFrom: 8_000, nextByte: 8_000, leaseUntil: null, reason: null });
    expect(rearmed.rev).toBeGreaterThan(claim.cursor.rev);

    const behind = await ensureCursor(db, keyOf(source.id), { ...init, grantGeneration: 3, allowedFrom: 100 });
    expect(behind).toMatchObject({ grantGeneration: 3, allowedFrom: 8_000, nextByte: 8_000, state: "pending" });
    await expect(ensureCursor(db, keyOf(source.id), { ...init, grantGeneration: 4, allowedFrom: 100, allowedTo: 200 })).rejects.toThrow(/after the position already reached/);
    expect(await claimCursor(db, keyOf(source.id), { leaseMs: LEASE_MS, now: at() })).toBeDefined();
  });

  it("re-arming keeps a gap that lies inside the new range and drops one the new boundary leaves behind", async () => {
    const { source } = await upsertSource(db, stream("s1"));
    await ensureCursor(db, keyOf(source.id), init);
    const claim = await claimed(source.id);
    expect(await blockCursor(db, keyOf(source.id), { rev: claim.cursor.rev, leaseToken: claim.leaseToken }, { from: 500, to: null, reason: "line_too_long" })).toBe(true);
    await revokeCursors(db, { sourceId: source.id });
    const kept = await ensureCursor(db, keyOf(source.id), { ...init, grantGeneration: 2, allowedFrom: 100 });
    expect(kept).toMatchObject({ state: "blocked", allowedFrom: 500, nextByte: 500, blockedFrom: 500, reason: "line_too_long" });
    await revokeCursors(db, { sourceId: source.id });
    const dropped = await ensureCursor(db, keyOf(source.id), { ...init, grantGeneration: 3, allowedFrom: 9_000 });
    expect(dropped).toMatchObject({ state: "pending", allowedFrom: 9_000, nextByte: 9_000, blockedFrom: null, blockedTo: null, reason: null });
  });

  it("grants one lease among concurrent claims, refuses while it lives and reclaims it once expired with a fresh token", async () => {
    const { source } = await upsertSource(db, stream("s1"));
    await ensureCursor(db, keyOf(source.id), init);
    const started = at();
    const claims = await Promise.all([1, 2, 3].map(() => claimCursor(db, keyOf(source.id), { leaseMs: LEASE_MS, now: started })));
    const winners = claims.filter((claim) => claim !== undefined);
    expect(winners).toHaveLength(1);
    const first = winners[0]!;
    expect(first.cursor).toMatchObject({ state: "active", rev: 2 });
    expect(cursorLeased(await cursor(source.id), started)).toBe(true);
    expect(await claimCursor(db, keyOf(source.id), { leaseMs: LEASE_MS, now: at(LEASE_MS - 1) })).toBeUndefined();
    const recovered = await claimCursor(db, keyOf(source.id), { leaseMs: LEASE_MS, now: at(LEASE_MS) });
    expect(recovered).toBeDefined();
    expect(recovered!.leaseToken).not.toBe(first.leaseToken);
    expect(recovered!.cursor.rev).toBe(3);
    expect((await rawLease(source.id)).until?.getTime()).toBe(at(2 * LEASE_MS).getTime());
  });

  it("T37: a stale revision or a stale lease fails the compare-and-set, and the cursor never rewinds", async () => {
    const { source } = await upsertSource(db, stream("s1"));
    await ensureCursor(db, keyOf(source.id), { ...init, allowedTo: 10_000 });
    const first = await claimed(source.id);
    const k = keyOf(source.id);
    expect(await advanceCursor(db, k, { rev: first.cursor.rev - 1, leaseToken: first.leaseToken }, { nextByte: 100 })).toBe(false);
    expect(await advanceCursor(db, k, { rev: first.cursor.rev, leaseToken: "not-the-lease" }, { nextByte: 100 })).toBe(false);
    expect(await advanceCursor(db, k, { rev: first.cursor.rev, leaseToken: first.leaseToken }, { nextByte: 300 })).toBe(true);
    expect(await cursor(source.id)).toMatchObject({ nextByte: 300, rev: first.cursor.rev + 1, state: "active" });
    expect((await rawLease(source.id)).token).toBe(first.leaseToken);

    const rev = first.cursor.rev + 1;
    expect(await advanceCursor(db, k, { rev, leaseToken: first.leaseToken }, { nextByte: 200 })).toBe(false);
    expect(await advanceCursor(db, k, { rev, leaseToken: first.leaseToken }, { nextByte: 10_001 })).toBe(false);
    expect(await advanceCursor(db, k, { rev, leaseToken: first.leaseToken }, { nextByte: 9_000, state: "complete" })).toBe(false);
    expect((await cursor(source.id)).nextByte).toBe(300);
    expect(await advanceCursor(db, k, { rev, leaseToken: first.leaseToken }, { nextByte: 300, reason: "nothing_new", release: true })).toBe(true);
    expect(await cursor(source.id)).toMatchObject({ nextByte: 300, reason: "nothing_new", leaseUntil: null, rev: rev + 1 });
    expect(await advanceCursor(db, k, { rev: rev + 1, leaseToken: first.leaseToken }, { nextByte: 400 })).toBe(false);

    const second = await claimed(source.id, {}, at(1));
    expect(second.leaseToken).not.toBe(first.leaseToken);
    expect(await advanceCursor(db, k, { rev: second.cursor.rev, leaseToken: first.leaseToken }, { nextByte: 400 })).toBe(false);
    expect(await advanceCursor(db, k, { rev: second.cursor.rev, leaseToken: second.leaseToken }, { nextByte: 10_000, state: "complete" })).toBe(true);
    expect(await cursor(source.id)).toMatchObject({ nextByte: 10_000, state: "complete", leaseUntil: null, reason: "nothing_new" });
    expect(await claimCursor(db, k, { leaseMs: LEASE_MS, now: at(2) })).toBeUndefined();
  });

  it("T35: a blocked gap is persisted at the cursor, cannot be crossed or overwritten, and reopens only through its resolution", async () => {
    const { source } = await upsertSource(db, stream("s1"));
    await ensureCursor(db, keyOf(source.id), init);
    const k = keyOf(source.id);
    const first = await claimed(source.id);
    expect(await blockCursor(db, k, { rev: first.cursor.rev, leaseToken: first.leaseToken }, { from: 700, to: 1_300, reason: "line_too_long" })).toBe(true);
    const blocked = await cursor(source.id);
    expect(blocked).toMatchObject({ state: "blocked", nextByte: 700, blockedFrom: 700, blockedTo: 1_300, reason: "line_too_long", leaseUntil: null });
    expect((await rawLease(source.id)).token).toBeNull();

    expect(await claimCursor(db, k, { leaseMs: LEASE_MS, now: at() })).toBeUndefined();
    expect(await advanceCursor(db, k, { rev: blocked.rev, leaseToken: first.leaseToken }, { nextByte: 2_000 })).toBe(false);
    expect(await blockCursor(db, k, { rev: blocked.rev, leaseToken: first.leaseToken }, { from: 700, to: null, reason: "unreadable" })).toBe(false);
    expect(await cursor(source.id)).toMatchObject({ blockedFrom: 700, blockedTo: 1_300, reason: "line_too_long", rev: blocked.rev });

    expect(await unblockCursor(db, k, { rev: blocked.rev - 1 }, { reason: null })).toBe(false);
    expect(await unblockCursor(db, k, { rev: blocked.rev }, { reason: "gap_reparsed" })).toBe(true);
    expect(await cursor(source.id)).toMatchObject({ state: "pending", nextByte: 700, blockedFrom: null, blockedTo: null, reason: "gap_reparsed" });
    const second = await claimed(source.id);
    expect(await advanceCursor(db, k, { rev: second.cursor.rev, leaseToken: second.leaseToken }, { nextByte: 2_000, release: true })).toBe(true);
    expect(await cursor(source.id)).toMatchObject({ nextByte: 2_000, state: "active" });
  });

  it("T35/§22.5: resolving a gap records its range and reason on the generation before the cursor moves past it, once, by CAS", async () => {
    const { source } = await upsertSource(db, stream("s1"));
    await ensureCursor(db, keyOf(source.id), init);
    const k = keyOf(source.id);
    const first = await claimed(source.id);
    expect(await blockCursor(db, k, { rev: first.cursor.rev, leaseToken: first.leaseToken }, { from: 700, to: 1_300, reason: "line_too_long" })).toBe(true);
    const blocked = await cursor(source.id);

    // A stale revision, or a cursor that is not blocked, resolves nothing and writes nothing.
    expect(await resolveCursorGap(db, k, { rev: blocked.rev - 1 }, { now: at() })).toBeUndefined();
    expect(sourceGaps((await sourceById(db, source.id))!)).toEqual([]);

    const resolved = await resolveCursorGap(db, k, { rev: blocked.rev }, { now: at(5_000) });
    expect(resolved?.gap).toEqual({ from: 700, to: 1_300, reason: "line_too_long", at: at(5_000).toISOString() });
    expect(resolved?.cursor).toMatchObject({ nextByte: 1_300, state: "active", blockedFrom: null, blockedTo: null, reason: "gap_resolved", leaseUntil: null, rev: blocked.rev + 1 });
    expect(await cursor(source.id)).toEqual(resolved!.cursor);
    expect((await rawLease(source.id)).token).toBeNull();
    // The generation keeps the gap, and keeps it through the fingerprint the next read records.
    expect(sourceGaps((await sourceById(db, source.id))!)).toEqual([resolved!.gap]);
    expect(await recordSourceFingerprint(db, source.id, { fileIdentity: { observedSize: 9_000, anchorFrom: 8_744, anchorTo: 9_000 }, anchorHash: "anchor-3" })).toBe(true);
    expect((await sourceById(db, source.id))?.fileIdentity).toEqual({ observedSize: 9_000, anchorFrom: 8_744, anchorTo: 9_000, gaps: [resolved!.gap] });
    // Resolved once: the same revision again is stale, and the cursor is claimable and reads on from the end of the gap.
    expect(await resolveCursorGap(db, k, { rev: blocked.rev }, { now: at() })).toBeUndefined();
    const second = await claimed(source.id);
    expect(second.cursor.nextByte).toBe(1_300);
    expect(await advanceCursor(db, k, { rev: second.cursor.rev, leaseToken: second.leaseToken }, { nextByte: 2_000, release: true })).toBe(true);
    expect(await cursor(source.id)).toMatchObject({ nextByte: 2_000, state: "active" });
  });

  it("T35: a gap with an unknown end needs the measured end, is clamped to allowed_to, and the list of gaps stays bounded", async () => {
    const { source } = await upsertSource(db, stream("s1"));
    await ensureCursor(db, keyOf(source.id), { ...init, allowedTo: 10_000 });
    const k = keyOf(source.id);
    const first = await claimed(source.id);
    expect(await blockCursor(db, k, { rev: first.cursor.rev, leaseToken: first.leaseToken }, { from: 100, to: null, reason: "line_too_long" })).toBe(true);
    const blocked = await cursor(source.id);
    // Without an end there is nothing to cross; a measured end that does not end after the start is a programming error.
    expect(await resolveCursorGap(db, k, { rev: blocked.rev })).toBeUndefined();
    await expect(resolveCursorGap(db, k, { rev: blocked.rev }, { to: 100 })).rejects.toThrow(/ends after it starts/);
    expect(await cursor(source.id)).toMatchObject({ state: "blocked", nextByte: 100, blockedFrom: 100, blockedTo: null, rev: blocked.rev });
    const resolved = await resolveCursorGap(db, k, { rev: blocked.rev }, { to: 4_000, now: at() });
    expect(resolved?.gap).toMatchObject({ from: 100, to: 4_000, reason: "line_too_long" });
    expect(resolved?.cursor).toMatchObject({ nextByte: 4_000, state: "active" });

    // Forty-nine more gaps, then one past the end of the range: the cursor completes at the boundary and the list keeps the last fifty.
    for (let n = 0; n < SOURCE_GAPS_MAX - 1; n += 1) {
      const claim = await claimed(source.id, {}, at(n));
      const from = 4_000 + n * 100;
      expect(await blockCursor(db, k, { rev: claim.cursor.rev, leaseToken: claim.leaseToken }, { from, to: from + 50, reason: "unreadable" })).toBe(true);
      expect(await resolveCursorGap(db, k, { rev: (await cursor(source.id)).rev }, { now: at(n) })).toBeDefined();
    }
    expect(sourceGaps((await sourceById(db, source.id))!)).toHaveLength(SOURCE_GAPS_MAX);
    const last = await claimed(source.id, {}, at(99_000));
    expect(await blockCursor(db, k, { rev: last.cursor.rev, leaseToken: last.leaseToken }, { from: 9_000, to: 12_000, reason: "line_too_long" })).toBe(true);
    const done = await resolveCursorGap(db, k, { rev: (await cursor(source.id)).rev }, { now: at(99_000) });
    expect(done?.cursor).toMatchObject({ nextByte: 10_000, state: "complete" });
    expect(done?.gap).toMatchObject({ from: 9_000, to: 12_000 });
    const gaps = sourceGaps((await sourceById(db, source.id))!);
    expect(gaps).toHaveLength(SOURCE_GAPS_MAX);
    expect(gaps[0]).toMatchObject({ from: 4_000, to: 4_050, reason: "unreadable" });
    expect(gaps[gaps.length - 1]).toEqual(done!.gap);
    expect(await claimCursor(db, k, { leaseMs: LEASE_MS, now: at() })).toBeUndefined();
  });

  it("records a gap through advanceCursor only where the cursor stops, and rejects the shapes that would lie", async () => {
    const { source } = await upsertSource(db, stream("s1"));
    await ensureCursor(db, keyOf(source.id), init);
    const k = keyOf(source.id);
    const claim = await claimed(source.id);
    const expected = { rev: claim.cursor.rev, leaseToken: claim.leaseToken };
    await expect(advanceCursor(db, k, expected, { nextByte: 100, blockedFrom: 200 })).rejects.toThrow(/starts where the cursor stops/);
    await expect(advanceCursor(db, k, expected, { nextByte: 100, state: "blocked" })).rejects.toThrow(/names the start of its gap/);
    await expect(advanceCursor(db, k, expected, { nextByte: 100, state: "active", blockedFrom: 100 })).rejects.toThrow(/Only a blocked cursor/);
    await expect(advanceCursor(db, k, expected, { nextByte: 100, blockedFrom: 100, blockedTo: 100 })).rejects.toThrow(/ends after it starts/);
    await expect(advanceCursor(db, k, expected, { nextByte: 100, state: "pending" as "active" })).rejects.toThrow(/Invalid cursor state/);
    await expect(advanceCursor(db, k, expected, { nextByte: 100, reason: "a line of the session, verbatim" })).rejects.toThrow(/bounded code/);
    await expect(advanceCursor(db, k, expected, { nextByte: -1 })).rejects.toThrow(/cursor position/);
    await expect(advanceCursor(db, k, expected, { nextByte: 1.5 })).rejects.toThrow(/cursor position/);
    expect(await cursor(source.id)).toMatchObject({ nextByte: 0, rev: claim.cursor.rev });
    expect(await advanceCursor(db, k, expected, { nextByte: 100, blockedFrom: 100, blockedTo: null, reason: "unreadable" })).toBe(true);
    expect(await cursor(source.id)).toMatchObject({ state: "blocked", nextByte: 100, blockedFrom: 100, blockedTo: null, leaseUntil: null });
  });

  it("revokes by source, purpose or grant, clears leases, and refuses to revoke without a filter", async () => {
    const a = (await upsertSource(db, stream("a"))).source;
    const b = (await upsertSource(db, stream("b"))).source;
    await ensureCursor(db, keyOf(a.id), init);
    await ensureCursor(db, keyOf(a.id, { purpose: "facts" }), init);
    await ensureCursor(db, keyOf(b.id, { grantId: "grant_other" }), init);
    const claim = await claimed(a.id);
    await expect(revokeCursors(db, {})).rejects.toThrow(/needs a filter/);
    expect(await revokeCursors(db, { sourceId: a.id, purpose: "facts" })).toBe(1);
    expect(await revokeCursors(db, { grantId: "grant_0123456789ab" })).toBe(1);
    expect(await revokeCursors(db, { grantId: "grant_0123456789ab" })).toBe(0);
    expect((await cursorsFor(db, { state: "revoked" })).map((row) => [row.sourceId, row.purpose])).toEqual([[a.id, "facts"], [a.id, "receipt"]]);
    expect(await cursor(b.id)).toMatchObject({ state: "pending" });
    expect((await rawLease(a.id)).token).toBeNull();
    expect(await advanceCursor(db, keyOf(a.id), { rev: claim.cursor.rev, leaseToken: claim.leaseToken }, { nextByte: 1 })).toBe(false);
    expect(await cursorCounts(db)).toEqual({ pending: 1, active: 0, blocked: 0, complete: 0, revoked: 2 });
    expect(await cursorCounts(db, { sourceId: a.id, purpose: "receipt" })).toEqual({ pending: 0, active: 0, blocked: 0, complete: 0, revoked: 1 });
    expect(await revokeCursors(db, { sourceId: b.id })).toBe(1);
  });

  it("validates keys and initial ranges before touching the table", async () => {
    const { source } = await upsertSource(db, stream("s1"));
    await expect(ensureCursor(db, keyOf(source.id, { purpose: "everything" as "receipt" }), init)).rejects.toThrow(/purpose/);
    await expect(ensureCursor(db, keyOf(source.id, { scopeKey: "" }), init)).rejects.toThrow(/scope key/);
    await expect(ensureCursor(db, keyOf(source.id), { ...init, parserVersion: "latest" })).rejects.toThrow(/concrete parser version/);
    await expect(ensureCursor(db, keyOf(source.id), { ...init, grantGeneration: 0 })).rejects.toThrow(/grant generation/);
    await expect(ensureCursor(db, keyOf(source.id), { ...init, allowedFrom: -1 })).rejects.toThrow(/range start/);
    await expect(ensureCursor(db, keyOf(source.id), { ...init, allowedFrom: 10, allowedTo: 10 })).rejects.toThrow(/end after it starts/);
    await expect(ensureCursor(db, keyOf("msrc_missing"), init)).rejects.toThrow();
    await expect(claimCursor(db, keyOf(source.id), { leaseMs: 0 })).rejects.toThrow(/lease/);
    expect(await cursorsFor(db)).toEqual([]);
  });

  it("the table itself refuses a position before the boundary, a lease without an end, and a gap that ends first", async () => {
    const { source } = await upsertSource(db, stream("s1"));
    const row = { ...keyOf(source.id), grantGeneration: 1, allowedFrom: 100, parserVersion: "claude-code-receipts-1" };
    expect(await refusal(db.insert(t.memorySourceCursors).values({ ...row, nextByte: 99 }))).toMatch(/memory_source_cursors_next_check/);
    expect(await refusal(db.insert(t.memorySourceCursors).values({ ...row, nextByte: 100, allowedTo: 100 }))).toMatch(/memory_source_cursors_range_check/);
    expect(await refusal(db.insert(t.memorySourceCursors).values({ ...row, nextByte: 100, leaseToken: "token" }))).toMatch(/memory_source_cursors_lease_check/);
    expect(await refusal(db.insert(t.memorySourceCursors).values({ ...row, nextByte: 100, blockedTo: 200 }))).toMatch(/memory_source_cursors_blocked_check/);
    expect(await refusal(db.insert(t.memorySourceCursors).values({ ...row, nextByte: 100, state: "done" }))).toMatch(/memory_source_cursors_state_check/);
    expect(await refusal(db.update(t.memorySources).set({ purgedAt: new Date() }).where(eq(t.memorySources.id, source.id)))).toMatch(/memory_sources_purged_check/);
    expect(await cursorsFor(db)).toEqual([]);
  });
});
