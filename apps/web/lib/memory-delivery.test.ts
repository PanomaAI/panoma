import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  RECEIPT_MARKER, TASTE_FILE, TRANSPORT_PROFILES, checkReception, codePointLength, contentHashOf, contractIdIn, finalMessage,
  setInferredConsent, sha256Hex, untrustedFence, utf8Length, writeTaste,
  type MemoryContractV2, type MemoryPayload, type TwinConsent,
} from "@panoma/core";
import {
  addHumanNote, beginDeletion, cancelCommitment, chargeUsage, createCommitment, createTask, creditUsage, decideNote, forgetProjectsUnder, insertBeliefs,
  listBeliefs, logActivity, markPublished, offerById, offersForContext, openSession, proposeNote, readRevision, recordObservation, resolveContext,
  reviseCommitment, runDeletionBatches, saveDecisionEpisodes, schema, setBeliefScope, setDecisionEpisodeStatus, setValidUntil, signBelief, usageOf,
  type Database, type Environment, type NewBelief,
} from "@panoma/db";
import {
  CONTINUATIONS, MemoryRequestError, predicateSentence, prepareMemory, readMemoryItem, recordAttemptFor, type PrepareInput, type ReadInput,
} from "./memory-delivery";
import { composeRequestKey } from "./memory-eligibility";
import { selectMemory } from "./select-memory";
import { MIB } from "./spend-settings";

/*
  The delivery, end to end against a real catalog: an offer whose markers carry its id and whose
  bytes are what the row keeps (A04 through the wire); an exception over 240 characters that
  travels whole in the item and in the text (A07/T18); a core larger than the envelope that comes
  back `incomplete` with the missing units named (A08/T17); a revision that moves between the
  selection and its confirmation (A09), and the publication permission that moves there too
  (§5.3 step 8); the same request key twice and then with other content (A10/T10-T11); a
  continuation token that pages and goes stale; a unit larger than a page, read in parts that
  never cut a character, each inside the fence, and stale once the unit moves between two parts
  (T80); a historical revision served only under the permission it needs today (§12/§4.3); the
  signal's own core (§5.4); the file heard before a criterion is served (A20/T57); a sleeping
  rule offered again under the same request id once the context compacted (T06); and a folder
  that left the catalog, whose photographed note is history and not a copy to serve (T83).

  Delivery C: a superseded note is refused at every revision, the old one that was historical
  included, and its successor names it (T52); the typed predicates of a decision are judged in a
  read with the facts a read has, and a pending check travels with the unit (§9.1); an open
  commitment and a task's case are read as units of this project only (§9.4, T51); and the
  signal declares its path as the `path_under` fact.

  Delivery D: a criterion's typed conditions and exceptions render inside its unit and count in
  its budget — one that fits alone but not with its exceptions is left out whole (§10.4); a read
  by id renders them the same way, at the current revision and from a photograph, and judges
  them with the read's facts; and what travels to another project is the abstraction, never the
  evidence (§10.3, D08).
 */

let home: string;
let database: Database;
let close: () => Promise<void>;
let contextId: string;
const previousHome = process.env["PANOMA_HOME"];

const PROJECT = { id: "memory-delivery", slug: "memory-delivery", name: "Memory delivery", identity: "git:memory-delivery", root: "/tmp/memory-delivery" };
const OTHER = { id: "other-delivery", slug: "other-delivery", name: "Other delivery", identity: "git:other-delivery", root: "/tmp/other-delivery" };
const NAMES = { [PROJECT.identity]: PROJECT.name, [OTHER.identity]: OTHER.name };
const CONSENT: TwinConsent = { sources: {}, inferred: true };

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-delivery-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: PROJECT.id, slug: PROJECT.slug, name: PROJECT.name, root: PROJECT.root, identity: PROJECT.identity },
    { id: OTHER.id, slug: OTHER.slug, name: OTHER.name, root: OTHER.root, identity: OTHER.identity },
  ]);
  await database.insert(schema.agents).values({ id: "agent_1", name: "agent one", apiKeyHash: "hash-agent-1" });
  const resolved = await database.transaction((tx) => resolveContext(tx, { projectId: PROJECT.id, harness: "mcp", entrypoint: "mcp", recipientKey: "agent_1", nativeSessionKey: "session-1", agentId: "agent_1" }));
  contextId = resolved.context.id;
});

beforeEach(async () => {
  await database.delete(schema.servingEvents);
  await database.delete(schema.servings);
  await database.delete(schema.memoryDeletions);
  await database.delete(schema.memoryOutcomes);
  await database.delete(schema.memoryDependencies);
  await database.delete(schema.commitments);
  await database.delete(schema.agentActivities);
  await database.delete(schema.agentSessions);
  await database.delete(schema.tasks);
  await database.delete(schema.memoryRevisions);
  await database.delete(schema.notes);
  await database.delete(schema.decisionEpisodes);
  await database.delete(schema.beliefs);
  await rm(join(home, TASTE_FILE), { recursive: true, force: true });
  await rm(join(home, "twin.json"), { force: true });
  CONTINUATIONS.clear();
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

const note = (id: string, body: string, trigger: string | null = null) => ({
  id, projectId: PROJECT.id, body, createdBy: "human", status: "approved", trigger, createdAt: new Date("2026-09-14T00:00:00Z"),
});

const owner = (identity: string | null, fields: Record<string, string>) => ({
  identity, origin: "owner" as const, model: null,
  fields: Object.fromEntries(Object.entries(fields).map(([name, text]) => [name, { text }])),
});

async function human(body: string, trigger?: string): Promise<string> {
  const saved = await addHumanNote(database, { projectId: PROJECT.id, body, ...(trigger ? { trigger } : {}) });
  if (!("id" in saved)) throw new Error(`fixture refused: ${saved.refused}`);
  return saved.id;
}

const belief = (statement: string, patch: Partial<NewBelief> = {}): NewBelief => ({
  topic: "testing", statement, identity: null, state: "signed", citations: [], support: { observations: 4, projects: 2, days: 3 }, model: "owner", ...patch,
});

/** A criterion in the core: its line was written to the file, which is what seeds the core (§5.2/§22.3). */
async function coreBelief(statement: string, patch: Partial<NewBelief> = {}): Promise<string> {
  const [id] = await insertBeliefs(database, [belief(statement, patch)]);
  await markPublished(database, [{ id: id!, published: { topic: patch.topic ?? "testing", statement } }]);
  return id!;
}

const FENCE = untrustedFence("notes");

/** The raw bytes of a part: what lies between the fence lines, which is what the segment describes. */
function rawChunk(text: string): string {
  expect(text.startsWith(`${FENCE.open}\n`)).toBe(true);
  expect(text.endsWith(`\n${FENCE.close}`)).toBe(true);
  return text.slice(FENCE.open.length + 1, text.length - FENCE.close.length - 1);
}

function prepare(patch: Partial<PrepareInput> = {}) {
  return prepareMemory({
    database, project: PROJECT, audience: "agent", channel: "mcp", profile: "mcp-memory-v2", agentId: "agent_1",
    context: { id: contextId, generation: 1 }, request: { version: 2, mode: "orientation" }, requestKey: null,
    consent: CONSENT, names: NAMES, ...patch,
  });
}

function read(patch: Partial<ReadInput> & { read: ReadInput["read"] }) {
  return readMemoryItem({ database, project: PROJECT, audience: "agent", profile: "mcp-memory-v2", consent: CONSENT, names: NAMES, ...patch });
}

function contractOf(result: Awaited<ReturnType<typeof prepareMemory>>): MemoryContractV2 {
  if ("unavailable" in result) throw new Error(`unavailable: ${result.reason}`);
  return result.contract;
}

/** The canonical payload of a contract: what `contentHash` must cover and nothing else. */
function payloadOf(contract: MemoryContractV2): MemoryPayload {
  const { contractId: _id, contentHash: _hash, continuation: _next, presentation: _text, segment: _segment, ...payload } = contract;
  return payload;
}

describe("an offer (A04 on the wire)", () => {
  it("renders the markers with its id, persists the exact bytes and the manifest, and hashes the canonical payload", async () => {
    const noteId = await human("Run the guard tests before the full suite.");
    const criterion = await coreBelief("Tests live beside their module.");

    const result = await prepare();
    const contract = contractOf(result);
    if ("unavailable" in result) throw new Error("unreachable");
    expect(result.reused).toBe(false);
    expect(contract.contractId).toMatch(/^srv_[A-Za-z0-9_-]{12}$/);
    expect(contract.schemaVersion).toBe(2);
    expect(contract.status).toBe("ready");
    expect(contract.items.map((item) => `${item.kind}:${item.id}`)).toEqual([`note:${noteId}`, `criterion:${criterion}`]);
    expect(contract.contentHash).toBe(contentHashOf(payloadOf(contract)));
    expect(contract.snapshot).toMatchObject({ audience: "agent", projectRef: PROJECT.id, contextId, contextGeneration: 1, rankingVersion: 1, renderVersion: 1 });
    expect(contract.snapshot.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(contract.continuation).toBeNull();
    expect(contract.presentation.profile).toBe("mcp-memory-v2");
    const text = contract.presentation.text;
    expect(text.startsWith(`${RECEIPT_MARKER} ${contract.contractId} ${contract.contentHash.slice(0, 16)} begin\n`)).toBe(true);
    expect(text.endsWith(`${RECEIPT_MARKER} ${contract.contractId} end`)).toBe(true);
    expect(contractIdIn(text)).toBe(contract.contractId);
    expect(text).toContain("Run the guard tests before the full suite.");
    expect(text).toContain("Tests live beside their module.");

    const stored = await offerById(database, result.servingId);
    expect(stored).toMatchObject({
      projectId: PROJECT.id, agentId: "agent_1", contextId, contextGeneration: 1, channel: "mcp", schemaVersion: 2,
      contentHash: contract.contentHash, rendered: text, renderedHash: sha256Hex(text), serializedBytes: utf8Length(finalMessage("mcp-memory-v2", text)),
      noteIds: [noteId], purgedAt: null, events: [],
    });
    expect(stored?.payload).toEqual(payloadOf(contract));
    expect(stored?.policySnapshot).toMatchObject({ schemaVersion: 1, profile: "mcp-memory-v2", channel: "mcp", inferredPublished: true, deletionGeneration: 0 });
    // The manifest maps every unit to its bytes in that text, and the receipt check recognizes them.
    const units = stored?.unitManifest?.units ?? [];
    expect(units.map((unit) => `${unit.kind}:${unit.id}:${unit.revision}`)).toEqual([`note:${noteId}:1`, `criterion:${criterion}:1`]);
    const bytes = Buffer.from(text, "utf8");
    for (const unit of units) expect(sha256Hex(bytes.subarray(unit.start, unit.end))).toBe(unit.unitHash);
    expect(checkReception({ rendered: text, renderedHash: sha256Hex(text), units: { schemaVersion: 1, units } }, text)).toMatchObject({ result: "full", unitsIntact: 2 });
  });

  it("stores the offer under the contract id its markers carry (needs OfferInput.id in packages/db)", async () => {
    await human("One awake note.");
    const result = await prepare();
    const contract = contractOf(result);
    if ("unavailable" in result) throw new Error("unreachable");
    expect(result.servingId).toBe(contract.contractId);
  });

  it("T39: an offer under the storage quota answers unavailable with the reason quota, persists nothing and fakes no marker; the next brief after a purge answers again", async () => {
    const previous = process.env["PANOMA_PROJECT_QUOTA_MB"];
    await human("One awake note.");
    // The note the owner wrote was charged on its way in, as a human write: the counter holds it.
    const charged = await usageOf(database);
    expect(charged.projects[PROJECT.id]).toBeGreaterThan(0);
    // The project is put at its limit by a human write, which a quota never refuses; the offer is automatic and is.
    process.env["PANOMA_PROJECT_QUOTA_MB"] = "1";
    await database.transaction((tx) => chargeUsage(tx, { projectId: PROJECT.id, bytes: MIB, origin: "human" }));
    try {
      const refused = await prepare({ requestKey: "req_quota" });
      expect(refused).toEqual({ unavailable: true, reason: "quota" });
      expect(await offersForContext(database, contextId, 1)).toHaveLength(0);
      expect((await usageOf(database)).projects[PROJECT.id]).toBe(charged.projects[PROJECT.id]! + MIB);
      // A read by id is untouched: the reading arm keeps its access to eligible memory.
      const [noteRow] = await database.select().from(schema.notes);
      const opened = await read({ read: { kind: "note", id: noteRow!.id, revision: 1 } });
      expect("code" in opened).toBe(false);

      // A purge credits the counter, and the same request key is prepared like any other.
      await database.transaction((tx) => creditUsage(tx, { projectId: PROJECT.id, bytes: MIB }));
      const served = await prepare({ requestKey: "req_quota" });
      const contract = contractOf(served);
      expect(contract.presentation.text).toContain(RECEIPT_MARKER);
      expect(await offersForContext(database, contextId, 1)).toHaveLength(1);
      // The catalog's own limit refuses the same way, whatever the project holds.
      process.env["PANOMA_MEMORY_QUOTA_MB"] = "1";
      await database.transaction((tx) => chargeUsage(tx, { projectId: null, bytes: MIB, origin: "human" }));
      expect(await prepare({ requestKey: "req_quota_2" })).toEqual({ unavailable: true, reason: "quota" });
    } finally {
      if (previous === undefined) delete process.env["PANOMA_PROJECT_QUOTA_MB"]; else process.env["PANOMA_PROJECT_QUOTA_MB"] = previous;
      delete process.env["PANOMA_MEMORY_QUOTA_MB"];
      await database.delete(schema.memoryUsage);
    }
  });

  it("records the transport attempt the caller reports, as an event of the offer", async () => {
    await human("One awake note.");
    const result = await prepare();
    if ("unavailable" in result) throw new Error("unreachable");
    await recordAttemptFor(database, result.servingId, "sent", { latencyMs: 12 });
    await recordAttemptFor(database, result.servingId, "failed", { error: "socket closed" });
    const stored = await offerById(database, result.servingId);
    expect(stored?.events.map((event) => [event.eventKind, event.result])).toEqual([["attempt", "sent"], ["attempt", "failed"]]);
  });

  it("A07/T18: an exception over 240 characters travels whole, in the item and in the text", async () => {
    const exceptions = "Except when the migration touches a table with more than a million rows, or when the owner is away and nobody can restore a backup, or when the change is a pure rename that drizzle would emit as a drop and a create — in each of those cases stop and ask before running anything at all against the catalog.";
    expect(exceptions.length).toBeGreaterThan(240);
    await saveDecisionEpisodes(database, [owner(PROJECT.identity, { decision: "Run migrations from the CLI, never from a route.", exceptions })]);
    const contract = contractOf(await prepare({ request: { version: 2, mode: "action" }, task: "run the migrations" }));
    expect(contract.items).toHaveLength(1);
    expect(contract.items[0]).toMatchObject({ kind: "decision", applicability: "conditional", exceptions });
    expect(contract.presentation.text).toContain(`exceptions: ${exceptions}`);
    expect(contract.checks).toEqual([expect.objectContaining({ kind: "narrative_exception", text: exceptions })]);
    expect(contract.status).toBe("requires_check");
    expect(contract.presentation.text).toContain("Pending checks (1)");
  });

  it("A08/T17: a core larger than the envelope is incomplete, names the missing units and never looks whole", async () => {
    const bodies = Array.from({ length: 20 }, (_, index) => `Rule ${index}: ${"ñ".repeat(20)} ${"word ".repeat(90)}`.slice(0, 500).trimEnd());
    await database.insert(schema.notes).values(bodies.map((body, index) => note(`core-${String(index).padStart(2, "0")}`, body)));
    const contract = contractOf(await prepare({ channel: "brief", profile: "hook-brief-v1", audience: "hook" }));
    expect(contract.status).toBe("incomplete");
    expect(contract.coverage).toMatchObject({ requiredComplete: false });
    expect(contract.coverage.limitsHit).toContain("channel_limit");
    const missing = contract.omissions.find((omission) => omission.reason === "incomplete_core");
    expect(missing).toMatchObject({ required: true });
    expect(missing!.count).toBeGreaterThan(0);
    expect(contract.items.length + missing!.count).toBe(20);
    expect(contract.manifest.map((ref) => ref.id)).toEqual(bodies.map((_, index) => `core-${String(index).padStart(2, "0")}`).slice(contract.items.length));
    const text = contract.presentation.text;
    const profile = TRANSPORT_PROFILES["hook-brief-v1"];
    expect(codePointLength(text)).toBeLessThanOrEqual(profile.maxCodePoints!);
    expect(utf8Length(finalMessage("hook-brief-v1", text))).toBeLessThanOrEqual(profile.maxSerializedBytes!);
    expect(text).toContain(`Required units missing: ${missing!.count}.`);
    expect(text).toContain("status incomplete");
    for (const item of contract.items) expect(text).toContain(item.text);
    for (const ref of contract.manifest) expect(text).toContain(`- note ${ref.id} r1`);
  });
});

describe("confirmation (A09) and the request key (A10/T10-T11)", () => {
  it("re-selects once when a revision moves between the selection and its confirmation, and carries the new revision", async () => {
    const first = await human("The first rule.");
    let added: string | undefined;
    const contract = contractOf(await prepare({
      beforeConfirm: async (attempt) => {
        if (attempt === 0) added = await human("Approved while the offer was being built.");
      },
    }));
    expect(contract.items.map((item) => item.id).sort()).toEqual([first, added].sort());
    expect(contract.items.find((item) => item.id === added)).toMatchObject({ revision: 1, text: "Approved while the offer was being built." });
    expect(contract.presentation.text).toContain("Approved while the offer was being built.");
    expect(contract.status).toBe("ready");
  });

  it("answers unavailable, with the reason, when the archive moves again under the second selection", async () => {
    await human("The first rule.");
    let attempts = 0;
    const result = await prepare({
      beforeConfirm: async () => {
        attempts += 1;
        await human(`Approved during attempt ${attempts}.`);
      },
    });
    expect(result).toEqual({ unavailable: true, reason: "revisions_changed" });
    expect(attempts).toBe(2);
    expect(await database.select().from(schema.servings)).toHaveLength(0);
  });

  it("a withdrawal that lands between the selection and the confirmation moves the barrier and forces a new selection", async () => {
    const kept = await human("Kept.");
    const gone = await human("Withdrawn while building.");
    let sequence = 0;
    const contract = contractOf(await prepare({
      beforeConfirm: async (attempt) => {
        if (attempt !== 0) return;
        const begun = await beginDeletion(database, home, { operation: "withdraw", targets: [{ kind: "item", itemKind: "note", id: gone }], scope: { projectId: PROJECT.id } });
        if ("refused" in begun) throw new Error(begun.reason);
        sequence = begun.sequence;
        await runDeletionBatches(database, begun.id);
      },
    }));
    expect(contract.items.map((item) => item.id)).toEqual([kept]);
    expect(sequence).toBeGreaterThan(0);
    expect(contract.snapshot.useGeneration).toBe(sequence);
  });

  it("§5.3 step 8: the publication permission is read again at the confirmation, and a yes withdrawn meanwhile re-selects under the new permission", async () => {
    await setInferredConsent(true);
    const signed = await coreBelief("Signed, always served.");
    const inferred = await coreBelief("Inferred, served under the yes.", { state: "inferred", model: "openai/gpt" });
    let attempts = 0;
    const result = await prepareMemory({
      database, project: PROJECT, audience: "agent", channel: "mcp", profile: "mcp-memory-v2", agentId: "agent_1",
      context: { id: contextId, generation: 1 }, request: { version: 2, mode: "orientation" }, requestKey: null, names: NAMES,
      beforeConfirm: async (attempt) => {
        attempts += 1;
        if (attempt === 0) await setInferredConsent(false);
      },
    });
    const contract = contractOf(result);
    if ("unavailable" in result) throw new Error("unreachable");
    expect(attempts).toBe(2);
    expect(contract.items.map((item) => item.id)).toEqual([signed]);
    expect(contract.presentation.text).not.toContain("Inferred, served under the yes.");
    expect((await offerById(database, result.servingId))?.policySnapshot).toMatchObject({ inferredPublished: false });
    expect(inferred).toBeDefined();
  });

  it("the same request key returns the same offer, and the same key with other content is a stale revision", async () => {
    await human("The first rule.");
    const first = await prepare({ requestKey: "agent_1/mctx_1/1/mcp/req-1" });
    const again = await prepare({ requestKey: "agent_1/mctx_1/1/mcp/req-1" });
    if ("unavailable" in first || "unavailable" in again) throw new Error("unreachable");
    expect(first.reused).toBe(false);
    expect(again.reused).toBe(true);
    expect(again.servingId).toBe(first.servingId);
    // The reused contract is the stored row: its id is the row's id (equal to the first contract id once the row is stored under it).
    expect(again.contract.contractId).toBe(first.servingId);
    expect(again.contract.presentation.text).toBe(first.contract.presentation.text);
    expect(again.contract.contentHash).toBe(first.contract.contentHash);
    // The retry keeps the instant of the first offer: the time of an offer is never moved by its retries.
    expect(again.contract.snapshot.observedAt).toBe(first.contract.snapshot.observedAt);
    expect(await database.select().from(schema.servings)).toHaveLength(1);

    await human("A second rule, approved after the first offer.");
    await expect(prepare({ requestKey: "agent_1/mctx_1/1/mcp/req-1" })).rejects.toMatchObject({ name: "MemoryRequestError", code: "stale_revision" });
    const other = await prepare({ requestKey: "agent_1/mctx_1/1/mcp/req-2" });
    if ("unavailable" in other) throw new Error("unreachable");
    expect(other.contract.contractId).not.toBe(first.contract.contractId);
    expect(other.contract.items).toHaveLength(2);
    expect(await database.select().from(schema.servings)).toHaveLength(2);
    // A policy that changes under the same key is other content too: the owner's yes to inferred beliefs.
    await expect(prepare({ requestKey: "agent_1/mctx_1/1/mcp/req-2", consent: { sources: {} } })).rejects.toBeInstanceOf(MemoryRequestError);
  });

  it("T06: a sleeping rule delivered before a compaction is eligible again under the same request id in the new generation", async () => {
    // The sleeping rule: a triggered note that only an action on its path wakes (§5.4).
    const sleeping = await human("Keep this screen bilingual.", "apps/web/**");
    const recipient = { projectId: PROJECT.id, harness: "mcp", entrypoint: "mcp", recipientKey: "agent_1", nativeSessionKey: "session-1", agentId: "agent_1" };
    const keyFor = (generation: number) => composeRequestKey({ audience: "hook", callerId: "claude-code/main", contextId, contextGeneration: generation, channel: "signal", requestId: "req_1" });
    const onPath = (generation: number, requestKey: string | null) => prepare({
      channel: "signal", profile: "hook-signal-v1", audience: "hook", request: { version: 2, mode: "action" },
      paths: ["apps/web/lib/i18n.ts"], path: "apps/web/lib/i18n.ts", context: { id: contextId, generation }, requestKey,
    });

    const before = await onPath(1, keyFor(1));
    if ("unavailable" in before) throw new Error("unreachable");
    expect(before.reused).toBe(false);
    expect(before.contract.items.map((item) => item.id)).toEqual([sleeping]);
    expect(before.contract.snapshot.contextGeneration).toBe(1);
    // A retry in the same generation is the same offer: nothing new was said.
    const retried = await onPath(1, keyFor(1));
    if ("unavailable" in retried) throw new Error("unreachable");
    expect(retried).toMatchObject({ reused: true, servingId: before.servingId });

    // The program compacts and loses the rule it was given; the context keeps its id and moves its generation.
    const compacted = await database.transaction((tx) => resolveContext(tx, { ...recipient, lifecycle: { kind: "compact", nativeEventId: "session-1:compact-1" } }));
    expect(compacted).toMatchObject({ generationRaised: true, context: { id: contextId, generation: 2 } });

    // The same request id in the new generation is a new key, hence a new offer, and it carries the rule again.
    const after = await onPath(compacted.context.generation, keyFor(compacted.context.generation));
    if ("unavailable" in after) throw new Error("unreachable");
    expect(after.reused).toBe(false);
    expect(after.servingId).not.toBe(before.servingId);
    expect(after.contract.contractId).not.toBe(before.contract.contractId);
    expect(after.contract.items.map((item) => item.id)).toEqual([sleeping]);
    expect(after.contract.snapshot).toMatchObject({ contextId, contextGeneration: 2 });
    expect(after.contract.presentation.text).toContain("Keep this screen bilingual.");
    expect(await offerById(database, after.servingId)).toMatchObject({ contextId, contextGeneration: 2, requestKey: keyFor(2) });
    // What the earlier generation was offered is not looked up for the new one (`priorOffer` is scoped by generation):
    // the key of the old generation, presented in the new one, names other content and is refused rather than reused.
    await expect(onPath(2, keyFor(1))).rejects.toMatchObject({ name: "MemoryRequestError", code: "stale_revision" });
    expect((await offersForContext(database, contextId, 1)).map((row) => row.id)).toEqual([before.servingId]);
    expect((await offersForContext(database, contextId, 2)).map((row) => row.id)).toEqual([after.servingId]);
  });
});

describe("a project that lost its authority (T83 through the delivery)", () => {
  it("T83: once the folder is forgotten, its photographed note is not_found by id and the selection is empty — the photograph is history, never a copy to serve", async () => {
    const GONE = { id: "gone-delivery", slug: "gone-delivery", name: "Gone delivery", identity: "git:gone-delivery", root: "/tmp/gone-delivery" };
    await database.insert(schema.projects).values({ id: GONE.id, slug: GONE.slug, name: GONE.name, root: GONE.root, identity: GONE.identity });
    const saved = await addHumanNote(database, { projectId: GONE.id, body: "A rule of the folder that left." });
    if (!("id" in saved)) throw new Error(`fixture refused: ${saved.refused}`);
    const resolved = await database.transaction((tx) => resolveContext(tx, { projectId: GONE.id, harness: "mcp", entrypoint: "mcp", recipientKey: "agent_1", nativeSessionKey: "session-gone", agentId: "agent_1" }));
    const gone = { ...GONE };
    const served = await prepare({ project: gone, context: { id: resolved.context.id, generation: 1 }, names: { ...NAMES, [GONE.identity]: GONE.name } });
    if ("unavailable" in served) throw new Error("unreachable");
    expect(served.contract.items.map((item) => item.id)).toEqual([saved.id]);
    const whole = await read({ project: gone, read: { kind: "note", id: saved.id, revision: 1 } });
    if ("code" in whole) throw new Error(whole.code);
    expect(whole.items[0]).toMatchObject({ id: saved.id, text: "A rule of the folder that left." });
    const photograph = (await readRevision(database, "note", saved.id, 1))!;
    expect(photograph).toMatchObject({ scopeKind: "project", scopeRef: GONE.id });

    // The folder leaves the catalog: the note, the context and the offer go with it, and nothing on the derived side blocks the delete.
    expect(await forgetProjectsUnder(database, GONE.root)).toBe(1);
    expect(await offerById(database, served.servingId)).toBeUndefined();
    // The photograph is still there, as history; the delivery has no row to serve it from and says so.
    expect(await readRevision(database, "note", saved.id, 1)).toMatchObject({ id: photograph.id, purgedAt: null });
    expect(await read({ project: gone, read: { kind: "note", id: saved.id, revision: 1 } })).toEqual({ code: "not_found" });
    const selection = await selectMemory({ database, project: gone, mode: "orientation", audience: "agent", consent: CONSENT, names: NAMES });
    expect(selection.items).toEqual([]);
    expect(selection.status).toBe("ready");
    // Nor does the note reach another project of the catalog by its words.
    expect((await selectMemory({ database, project: PROJECT, mode: "orientation", task: "rule folder left", audience: "agent", consent: CONSENT, names: NAMES })).items).toEqual([]);
  });
});

describe("what the packer decides (§5.4, status after packing)", () => {
  it("a conditional unit the packer moved to the manifest asks nothing: the status is judged on what travels", async () => {
    const bodies = Array.from({ length: 3 }, (_, index) => `Rule ${index}: ${"word ".repeat(98)}`.slice(0, 500).trimEnd());
    await database.insert(schema.notes).values(bodies.map((body, index) => note(`core-${index}`, body)));
    const [row] = await saveDecisionEpisodes(database, [owner(PROJECT.identity, {
      decision: "Deploy the handoff only on Tuesdays.", conditions: "When the suite is green and the owner is awake.", rationale: "reason ".repeat(100).trim(),
    })]);
    const contract = contractOf(await prepare({ channel: "handoff", profile: "handoff-memory-v1", audience: "handoff", request: { version: 2, mode: "action" }, task: "deploy the handoff" }));
    // The core fits, the decision does not: it is in the manifest, and nothing delivered is conditional.
    expect(contract.items.map((item) => item.kind)).toEqual(["note", "note", "note"]);
    expect(contract.manifest).toEqual([expect.objectContaining({ kind: "decision", id: row!.id, applicability: "conditional" })]);
    expect(contract.omissions).toEqual([{ reason: "channel_limit", count: 1, required: false }]);
    expect(contract.checks).toEqual([]);
    expect(contract.status).toBe("ready");
    expect(contract.coverage.requiredComplete).toBe(true);
    expect(contract.presentation.text).toContain("status ready");
    expect(contract.presentation.text).not.toContain("Pending checks");
  });

  it("§5.4: on the signal the path-triggered notes are the required core and the awake notes travel after them, optional", async () => {
    const triggered = await human("Keep this screen bilingual.", "apps/web/**");
    const elsewhere = await human("Not this path.", "apps/cli/**");
    const bodies = Array.from({ length: 40 }, (_, index) => `Awake ${index}: ${"word ".repeat(98)}`.slice(0, 500).trimEnd());
    await database.insert(schema.notes).values(bodies.map((body, index) => note(`awake-${String(index).padStart(2, "0")}`, body)));
    const contract = contractOf(await prepare({
      channel: "signal", profile: "hook-signal-v1", audience: "hook", request: { version: 2, mode: "action" },
      paths: ["apps/web/lib/i18n.ts"], path: "apps/web/lib/i18n.ts",
    }));
    expect(contract.items[0]).toMatchObject({ id: triggered, deliveryMode: "core", matchedPaths: ["apps/web/lib/i18n.ts"] });
    expect(contract.items.slice(1).every((item) => item.id.startsWith("awake-"))).toBe(true);
    expect(contract.items.some((item) => item.id === elsewhere)).toBe(false);
    // The awake notes that did not fit are optional units, not a missing core.
    expect(contract.manifest.length).toBeGreaterThan(0);
    expect(contract.manifest.every((ref) => ref.id.startsWith("awake-"))).toBe(true);
    expect(contract.omissions).toEqual([{ reason: "channel_limit", count: contract.manifest.length, required: false }]);
    expect(contract.status).toBe("ready");
    expect(contract.coverage.requiredComplete).toBe(true);
    expect(contract.presentation.text.startsWith(`${RECEIPT_MARKER} ${contract.contractId}`)).toBe(true);
    expect(contract.presentation.text).toContain("Project memory posted on apps/web/lib/i18n.ts");
    // On the brief the same awake notes are the core, and the same overflow is `incomplete_core`.
    const brief = contractOf(await prepare({ channel: "brief", profile: "hook-brief-v1", audience: "hook" }));
    expect(brief.status).toBe("incomplete");
    expect(brief.omissions.some((omission) => omission.reason === "incomplete_core")).toBe(true);
  });
});

describe("the file before a criterion is served (A20/T57 through the delivery)", () => {
  const line = (statement: string) => ({ topic: "testing", statement, citations: [] });

  it("A20/T57: a criterion the owner deleted from TASTE.md is not in the offer, is vetoed, and is not read whole either", async () => {
    const kept = await coreBelief("Keep the number at the end.");
    const gone = await coreBelief("Never use gradients.");
    await writeTaste([line("Keep the number at the end."), line("Never use gradients.")]);
    await writeTaste([line("Keep the number at the end.")]);
    const contract = contractOf(await prepare());
    expect(contract.items.map((item) => item.id)).toEqual([kept]);
    expect(contract.status).toBe("ready");
    expect(contract.presentation.text).not.toContain("gradients");
    expect((await listBeliefs(database)).find((row) => row.id === gone)).toMatchObject({ state: "vetoed", memoryRev: 2 });
    expect(await read({ read: { kind: "criterion", id: gone, revision: 1 } })).toEqual({ code: "not_found" });
    expect(await read({ read: { kind: "criterion", id: gone, revision: 2 } })).toEqual({ code: "not_found" });
    expect(contractOf(await prepare()).items.map((item) => item.id)).toEqual([kept]);
  });

  it("a veto the owner left in the file before a read by id is heard by that read", async () => {
    const gone = await coreBelief("Never use gradients.");
    await coreBelief("Keep the number at the end.");
    await writeTaste([line("Keep the number at the end."), line("Never use gradients.")]);
    await writeTaste([line("Keep the number at the end.")]);
    expect(await read({ read: { kind: "criterion", id: gone, revision: 1 } })).toEqual({ code: "not_found" });
    expect((await listBeliefs(database)).find((row) => row.id === gone)?.state).toBe("vetoed");
  });

  it("a file that cannot be read makes the criteria unavailable: the offer is incomplete and says why, and a read by id is unavailable", async () => {
    await mkdir(join(home, TASTE_FILE));
    const noteId = await human("An awake note.");
    const core = await coreBelief("A core rule.");
    const result = await prepare();
    const contract = contractOf(result);
    expect(contract.items.map((item) => item.id)).toEqual([noteId]);
    expect(contract.status).toBe("incomplete");
    expect(contract.omissions).toEqual([{ reason: "taste_unreconciled", count: 1, required: true }]);
    expect(contract.coverage.requiredComplete).toBe(false);
    expect(contract.presentation.text).toContain("Required units missing: 1.");
    expect(await read({ read: { kind: "criterion", id: core, revision: 1 } })).toEqual({ code: "unavailable" });
    // A note is not the file's business.
    const whole = await read({ read: { kind: "note", id: noteId, revision: 1 } });
    expect("code" in whole).toBe(false);
  });
});

describe("continuation tokens (T21 through the cache)", () => {
  it("issues an opaque token for a cut page, pages with it, and refuses an unknown or expired one", async () => {
    const [decision] = await saveDecisionEpisodes(database, [owner(null, { decision: "Payment decisions are recorded here." })]);
    await database.insert(schema.notes).values([
      note("n1", "Payment retries wait a minute.", "a/**"),
      note("n2", "Payment failures are logged.", "b/**"),
      note("n3", "Payment emails go out nightly.", "c/**"),
    ]);
    let clock = Date.parse("2026-09-14T10:00:00Z");
    const now = () => new Date(clock);
    // Three lexical matches over the union of two: the third waits for the next page.
    const request = { version: 2 as const, mode: "action" as const };
    const first = contractOf(await prepare({ request, task: "payment", now }));
    expect(first.coverage.searchComplete).toBe(true);
    expect(first.items).toHaveLength(4);
    expect(first.continuation).toBeNull();
    expect(decision).toBeDefined();

    // With a smaller page the cursor appears: the selector's limits are the server's, so the seam is the cache itself.
    const token = CONTINUATIONS.issue({ kind: "select", audience: "agent", projectId: PROJECT.id, state: {
      query: "not-the-query", audience: "agent", rankingVersion: 1, offset: 2, revisionsFingerprint: "stale",
    } }, clock);
    expect(token).toMatch(/^mc_[0-9a-f-]{36}$/);
    await expect(prepare({ request: { ...request, continuation: token }, task: "payment", now })).rejects.toMatchObject({ code: "stale_cursor" });
    await expect(prepare({ request: { ...request, continuation: "mc_unknown" }, task: "payment", now })).rejects.toMatchObject({ code: "stale_cursor" });
    // Bound to the audience and the project: another audience's token is nobody's.
    const foreign = CONTINUATIONS.issue({ kind: "select", audience: "hook", projectId: PROJECT.id, state: { query: "q", audience: "hook", rankingVersion: 1, offset: 1, revisionsFingerprint: "f" } }, clock);
    await expect(prepare({ request: { ...request, continuation: foreign }, task: "payment", now })).rejects.toMatchObject({ code: "stale_cursor" });
    // And it lives fifteen minutes.
    const living = CONTINUATIONS.issue({ kind: "read", audience: "agent", projectId: PROJECT.id, itemKind: "note", id: "n1", revision: 1, nextStart: 10, profile: "mcp-memory-v2", revisionHash: "h" }, clock);
    expect(CONTINUATIONS.resolve(living, clock + CONTINUATIONS.ttlMs - 1)).toBeDefined();
    clock += CONTINUATIONS.ttlMs;
    expect(CONTINUATIONS.resolve(living, clock)).toBeUndefined();
  });

  it("keeps at most 256 tokens, dropping the oldest", () => {
    const tokens = Array.from({ length: 300 }, (_, index) => CONTINUATIONS.issue({
      kind: "read", audience: "agent", projectId: PROJECT.id, itemKind: "note", id: `n${index}`, revision: 1, nextStart: 0, profile: "mcp-memory-v2", revisionHash: "h",
    }, 1_000 + index));
    expect(CONTINUATIONS.size).toBe(256);
    expect(CONTINUATIONS.resolve(tokens[0]!, 2_000)).toBeUndefined();
    expect(CONTINUATIONS.resolve(tokens[299]!, 2_000)).toMatchObject({ id: "n299" });
  });
});

describe("reading one unit by id and revision", () => {
  it("does not return bytes read before a purge confirmed during final consent validation", async () => {
    const id = await human("A sentence that must stop travelling immediately.");
    const result = await read({
      read: { kind: "note", id, revision: 1 },
      readConsent: async () => {
        await beginDeletion(database, home, { operation: "purge", targets: [{ kind: "item", itemKind: "note", id }], scope: {} });
        return CONSENT;
      },
    });
    expect(result).toEqual({ code: "not_found" });
  });

  it("returns the current unit whole when it fits, and not_found for a unit outside this project's authority", async () => {
    const id = await human("Run the guard tests before the full suite.");
    const whole = await read({ read: { kind: "note", id, revision: 1 } });
    if ("code" in whole) throw new Error(whole.code);
    expect(whole.status).toBe("ready");
    expect(whole.items).toEqual([expect.objectContaining({ kind: "note", id, revision: 1, text: "Run the guard tests before the full suite." })]);
    expect(whole.segment).toBeUndefined();
    expect(whole.continuation).toBeNull();
    expect(whole.contentHash).toBe(contentHashOf(payloadOf(whole)));
    expect(whole.presentation.text).toContain(`${RECEIPT_MARKER} ${whole.contractId}`);

    expect(await read({ read: { kind: "note", id, revision: 2 } })).toEqual({ code: "not_found" });
    expect(await read({ read: { kind: "note", id: "nobody", revision: 1 } })).toEqual({ code: "not_found" });
    expect(await read({ project: OTHER, read: { kind: "note", id, revision: 1 } })).toEqual({ code: "not_found" });

    const [theirs] = await insertBeliefs(database, [{ topic: "design", statement: "Only there.", identity: OTHER.identity, state: "signed", citations: [], support: { observations: 0, projects: 0, days: 0 }, model: "owner" }]);
    expect(await read({ read: { kind: "criterion", id: theirs!, revision: 1 } })).toEqual({ code: "not_found" });
    const [dismissed] = await saveDecisionEpisodes(database, [owner(PROJECT.identity, { decision: "Taken back." })]);
    await database.execute(`update decision_episodes set status = 'dismissed' where id = '${dismissed!.id}'`);
    expect(await read({ read: { kind: "decision", id: dismissed!.id, revision: 1 } })).toEqual({ code: "not_found" });
  });

  it("serves an older revision as historical with its own text and a check, never the current text in its place", async () => {
    const [id] = await insertBeliefs(database, [{ topic: "testing", statement: "Tests beside their code.", identity: null, state: "inferred", citations: [], support: { observations: 4, projects: 2, days: 3 }, model: "openai/gpt" }]);
    expect(await signBelief(database, id!, "Tests live beside their module, always.")).toBe(true);
    const current = await read({ read: { kind: "criterion", id: id!, revision: 2 } });
    if ("code" in current) throw new Error(current.code);
    expect(current.items[0]).toMatchObject({ revision: 2, text: "Tests live beside their module, always.", authority: "owner_instruction", applicability: "applies" });
    expect(current.status).toBe("ready");

    const old = await read({ read: { kind: "criterion", id: id!, revision: 1 } });
    if ("code" in old) throw new Error(old.code);
    expect(old.items[0]).toMatchObject({ revision: 1, text: "Tests beside their code.", authority: "inference", applicability: "historical", use: "historical" });
    expect(old.checks).toEqual([{ itemKind: "criterion", itemId: id, revision: 1, kind: "historical_revision", text: "Revision 1 is not current; the current revision is 2." }]);
    expect(old.status).toBe("requires_check");
    expect(old.presentation.text).toContain("historical: no longer the current revision");
    expect(old.presentation.text).not.toContain("always.");
  });

  it("a withdrawn revision is not_found even when the object is still current", async () => {
    const id = await human("Withdrawn at revision one.");
    const begun = await beginDeletion(database, home, { operation: "withdraw", targets: [{ kind: "item", itemKind: "note", id, revision: 1 }], scope: { projectId: PROJECT.id } });
    if ("refused" in begun) throw new Error(begun.reason);
    await runDeletionBatches(database, begun.id);
    expect(await read({ read: { kind: "note", id, revision: 1 } })).toEqual({ code: "not_found" });
  });

  it("§12/§4.3: a historical revision is served only under the permission its photographed state needs today", async () => {
    // An inferred criterion signed later: its first revision needs the owner's yes and the floor, like any inferred belief.
    const [strong] = await insertBeliefs(database, [belief("Tests beside their code.", { state: "inferred", model: "openai/gpt" })]);
    expect(await signBelief(database, strong!, "Tests live beside their module, always.")).toBe(true);
    expect(await read({ read: { kind: "criterion", id: strong!, revision: 1 } })).toMatchObject({ items: [expect.objectContaining({ applicability: "historical", authority: "inference" })] });
    expect(await read({ read: { kind: "criterion", id: strong!, revision: 1 }, consent: { sources: {} } })).toEqual({ code: "not_found" });
    expect(await read({ read: { kind: "criterion", id: strong!, revision: 2 }, consent: { sources: {} } })).toMatchObject({ status: "ready" });
    const [weak] = await insertBeliefs(database, [belief("A hunch.", { state: "inferred", model: "openai/gpt", support: { observations: 1, projects: 1, days: 1 } })]);
    expect(await signBelief(database, weak!)).toBe(true);
    expect(await read({ read: { kind: "criterion", id: weak!, revision: 1 } })).toEqual({ code: "not_found" });
    expect(await read({ read: { kind: "criterion", id: weak!, revision: 2 } })).toMatchObject({ status: "ready" });

    // A decision photographed while dismissed is not a rule at that revision, even if it is active again now.
    const [row] = await saveDecisionEpisodes(database, [owner(PROJECT.identity, { decision: "Ship on Tuesdays." })]);
    expect(await setDecisionEpisodeStatus(database, row!.id, "dismissed")).toBe(true);
    expect(await setDecisionEpisodeStatus(database, row!.id, "active")).toBe(true);
    expect(await read({ read: { kind: "decision", id: row!.id, revision: 3 } })).toMatchObject({ status: "ready" });
    expect(await read({ read: { kind: "decision", id: row!.id, revision: 2 } })).toEqual({ code: "not_found" });
    expect(await read({ read: { kind: "decision", id: row!.id, revision: 1 } })).toMatchObject({ status: "requires_check", items: [expect.objectContaining({ applicability: "historical" })] });

    // A note photographed before its approval was a proposal, not a rule.
    const proposed = await proposeNote(database, { projectId: PROJECT.id, body: "Proposed first.", createdBy: "claude" });
    if (!("id" in proposed)) throw new Error("fixture");
    expect(await decideNote(database, proposed.id, "approved")).toMatchObject({ decided: true });
    expect(await read({ read: { kind: "note", id: proposed.id, revision: 2 } })).toMatchObject({ status: "ready" });
    expect(await read({ read: { kind: "note", id: proposed.id, revision: 1 } })).toEqual({ code: "not_found" });
  });

  it("T80: the continuation of a read is bound to the reading its first part measured; a unit that moves between parts is stale", async () => {
    const statement = Array.from({ length: 500 }, (_, index) => `Criterio ${index}: la señal llega entera — año tras año, 😀 sin cortar.`).join(" ");
    const [id] = await insertBeliefs(database, [belief(statement, { state: "inferred", model: "openai/gpt" })]);
    const first = await read({ read: { kind: "criterion", id: id!, revision: 1 } });
    if ("code" in first) throw new Error(first.code);
    expect(first.segment).toMatchObject({ start: 0, complete: false });
    expect(first.continuation).toMatch(/^mc_/);
    const second = await read({ read: { kind: "criterion", id: id!, revision: 1, continuation: first.continuation! } });
    if ("code" in second) throw new Error(second.code);
    expect(second.segment?.start).toBe(first.segment?.end);
    expect(second.segment?.revisionHash).toBe(first.segment?.revisionHash);

    // The owner signs the criterion with other words: revision 1 is now historical, and its rendering is another reading.
    expect(await signBelief(database, id!, `${statement} Y firmado.`)).toBe(true);
    expect(await read({ read: { kind: "criterion", id: id!, revision: 1, continuation: first.continuation! } })).toEqual({ code: "stale_cursor" });
    expect(await read({ read: { kind: "criterion", id: id!, revision: 2, continuation: first.continuation! } })).toEqual({ code: "stale_cursor" });
    // From byte zero the historical reading is its own, whole, with its own hash.
    const again = await read({ read: { kind: "criterion", id: id!, revision: 1 } });
    if ("code" in again) throw new Error(again.code);
    expect(again.segment?.revisionHash).not.toBe(first.segment?.revisionHash);
    expect(again.manifest[0]).toMatchObject({ applicability: "historical" });
    expect(rawChunk(again.presentation.text)).toContain("historical: no longer the current revision");
  });

  it("T80: a unit larger than the page comes in parts that never cut a character, each fenced, incomplete until the last, stale when the token is unknown", async () => {
    const rationale = Array.from({ length: 400 }, (_, index) => `Razón ${index}: la señal llega entera — año tras año, 😀 sin cortar ningún carácter.`).join(" ");
    const [row] = await saveDecisionEpisodes(database, [owner(PROJECT.identity, { decision: "Ship the long rationale whole.", rationale, conditions: "Only when read in full." })]);
    expect(utf8Length(rationale)).toBeGreaterThan(TRANSPORT_PROFILES["mcp-memory-v2"].maxSerializedBytes!);

    const parts: MemoryContractV2[] = [];
    let continuation: string | undefined;
    for (let guard = 0; guard < 20; guard += 1) {
      const part = await read({ read: { kind: "decision", id: row!.id, revision: 1, ...(continuation ? { continuation } : {}) } });
      if ("code" in part) throw new Error(part.code);
      parts.push(part);
      if (part.continuation === null) break;
      continuation = part.continuation;
      expect(continuation).toMatch(/^mc_/);
    }
    expect(parts.length).toBeGreaterThan(1);
    const limit = TRANSPORT_PROFILES["mcp-memory-v2"].maxSerializedBytes!;
    const assembled: string[] = [];
    let cursor = 0;
    for (const [index, part] of parts.entries()) {
      const last = index === parts.length - 1;
      expect(part.items).toEqual([]);
      expect(part.manifest).toEqual([expect.objectContaining({ kind: "decision", id: row!.id, revision: 1, applicability: "conditional" })]);
      expect(part.segment).toBeDefined();
      const segment = part.segment!;
      expect(segment.start).toBe(cursor);
      expect(segment.end).toBeGreaterThan(segment.start);
      expect(segment.complete).toBe(last);
      expect(part.status).toBe(last ? "requires_check" : "incomplete");
      expect(part.continuation === null).toBe(last);
      expect(part.checks.length > 0).toBe(last);
      // The part travels fenced as data; the segment describes the bytes between the fence lines.
      const chunk = rawChunk(part.presentation.text);
      expect(utf8Length(finalMessage("mcp-memory-v2", part.presentation.text))).toBeLessThanOrEqual(limit);
      expect(utf8Length(chunk)).toBe(segment.end - segment.start);
      expect(chunk).not.toContain("�");
      expect(sha256Hex(chunk)).toBe(segment.chunkHash);
      expect(part.contentHash).toBe(contentHashOf(payloadOf(part)));
      assembled.push(chunk);
      cursor = segment.end;
    }
    const whole = assembled.join("");
    const segment = parts[0]!.segment!;
    expect(utf8Length(whole)).toBe(segment.totalBytes);
    expect(sha256Hex(whole)).toBe(segment.revisionHash);
    expect(new Set(parts.map((part) => part.segment!.revisionHash)).size).toBe(1);
    // The assembled reading is the unit's own rendering, whole: rationale and conditions included.
    expect(whole).toContain(rationale);
    expect(whole).toContain("conditions: Only when read in full.");
    expect(whole.startsWith(`- [decision ${row!.id} r1`)).toBe(true);

    // The same token gives the same part again; an unknown one is stale; one bound to another revision too.
    const repeat = await read({ read: { kind: "decision", id: row!.id, revision: 1, continuation: parts[0]!.continuation! } });
    if ("code" in repeat) throw new Error(repeat.code);
    expect(repeat.segment).toEqual(parts[1]!.segment);
    expect(await read({ read: { kind: "decision", id: row!.id, revision: 1, continuation: "mc_nobody" } })).toEqual({ code: "stale_cursor" });
    expect(await read({ read: { kind: "decision", id: row!.id, revision: 2, continuation: parts[0]!.continuation! } })).toEqual({ code: "stale_cursor" });
  });
});

// ── Delivery C ───────────────────────────────────────────────────────────────────────────────

const ENV = "c".repeat(64);
const CHECK = "chk_delivery_applicability_1";
const MINUTE = 60_000;

function environment(at: Date): Environment {
  return { schemaVersion: 1, environmentId: ENV, projectRef: PROJECT.id, resolvedRoot: PROJECT.root, observedAt: at.toISOString(), inspected: [] };
}

/** One look of the patrol at a check of one photograph. */
async function observe(kind: "decision" | "commitment", objectId: string, rev: number, checkId: string, result: "pass" | "fail" | "unknown", minutesAgo = 0): Promise<void> {
  const photograph = await readRevision(database, kind, objectId, rev);
  if (!photograph) throw new Error("fixture: no photograph");
  const at = new Date(Date.now() - minutesAgo * MINUTE);
  await database.transaction((tx) => recordObservation(tx, {
    projectId: PROJECT.id, subjectRevisionId: photograph.id, checkId, checkRev: 1, environment: environment(at), result,
    evidence: { schemaVersion: 1, sourceRefs: [], observedCoverage: { inspected: 1, unknown: 0 }, deliveredBefore: "unknown", reason: "fixture" },
    observedAt: at,
  }));
}

const applicabilityCheck = (checkId: string) => ({ checkId, purpose: "applicability", kind: "path_exists", target: "packages/db", expected: true });
const passes = (checkId: string) => ({ schemaVersion: 1, expression: { kind: "check_result_is", checkId, revision: 1, result: "pass" } });

describe("supersession through the delivery (T52)", () => {
  it("T52: an old revision is historical while the note stands, refused once superseded; the predecessor moving refuses the successor; the successor names it", async () => {
    const predecessor = await human("Run the guard tests first.");
    expect(await setValidUntil(database, predecessor, { memoryRev: 1 }, new Date(Date.now() + 60 * MINUTE))).toEqual({ revision: 2 });
    const historical = await read({ read: { kind: "note", id: predecessor, revision: 1 } });
    if ("code" in historical) throw new Error(historical.code);
    expect(historical.items[0]).toMatchObject({ revision: 1, applicability: "historical" });
    expect(historical.checks).toEqual([expect.objectContaining({ kind: "historical_revision" })]);

    const proposed = await proposeNote(database, { projectId: PROJECT.id, body: "Run the guard tests, then the whole suite.", createdBy: "claude" });
    if (!("id" in proposed)) throw new Error("fixture");
    // The predecessor moved since revision 1 was read: nothing is approved (T52).
    expect(await decideNote(database, proposed.id, "approved", { supersedesId: predecessor, expectedPredecessorRev: 1 })).toEqual({ decided: false, reason: "stale_revision" });
    expect(contractOf(await prepare()).items.map((item) => item.id)).toEqual([predecessor]);
    expect(await read({ read: { kind: "note", id: proposed.id, revision: 1 } })).toEqual({ code: "not_found" });

    expect(await decideNote(database, proposed.id, "approved", { supersedesId: predecessor, expectedPredecessorRev: 2 })).toMatchObject({ decided: true });
    const contract = contractOf(await prepare());
    expect(contract.items).toEqual([expect.objectContaining({ id: proposed.id, revision: 2, supersedesId: predecessor })]);
    expect(contract.presentation.text).not.toContain("Run the guard tests first.");
    for (const revision of [1, 2, 3]) expect(await read({ read: { kind: "note", id: predecessor, revision } })).toEqual({ code: "not_found" });
    const successor = await read({ read: { kind: "note", id: proposed.id, revision: 2 } });
    if ("code" in successor) throw new Error(successor.code);
    expect(successor.items[0]).toMatchObject({ supersedesId: predecessor, authority: "owner_confirmation" });

    // Expiry: the owner's date passed, and the successor travels nowhere either.
    expect(await setValidUntil(database, proposed.id, { memoryRev: 2 }, new Date(Date.now() - MINUTE))).toEqual({ revision: 3 });
    expect(contractOf(await prepare()).items).toEqual([]);
    expect(await read({ read: { kind: "note", id: proposed.id, revision: 3 } })).toEqual({ code: "not_found" });
    expect(await read({ read: { kind: "note", id: proposed.id, revision: 2 } })).toEqual({ code: "not_found" });
  });
});

describe("typed predicates in a read and on the signal (§9.1, §10.1)", () => {
  it("a decision read by id carries the check it still needs, then applies once the check is observed fresh", async () => {
    const [row] = await saveDecisionEpisodes(database, [{
      ...owner(PROJECT.identity, { decision: "Run migrations from the CLI." }), checks: [applicabilityCheck(CHECK)], conditionsPredicate: passes(CHECK),
    }]);
    const pending = await read({ read: { kind: "decision", id: row!.id, revision: 1 } });
    if ("code" in pending) throw new Error(pending.code);
    expect(pending.items[0]).toMatchObject({ applicability: "conditional" });
    expect(pending.checks).toEqual([{ itemKind: "decision", itemId: row!.id, revision: 1, kind: "requires_check", text: expect.stringContaining(CHECK) }]);
    expect(pending.status).toBe("requires_check");
    expect(pending.presentation.text).toContain("requires check:");

    await observe("decision", row!.id, 1, CHECK, "pass");
    const settled = await read({ read: { kind: "decision", id: row!.id, revision: 1 } });
    if ("code" in settled) throw new Error(settled.code);
    expect(settled.items[0]).toMatchObject({ applicability: "applies" });
    expect(settled.status).toBe("ready");

    // A fresh fail settles against the read's facts: the unit still comes, conditional, and says so.
    await observe("decision", row!.id, 1, CHECK, "fail");
    const against = await read({ read: { kind: "decision", id: row!.id, revision: 1 } });
    if ("code" in against) throw new Error(against.code);
    expect(against.items[0]).toMatchObject({ applicability: "conditional" });
    expect(against.checks[0]!.text).toContain("evaluate false with what this read knows");
    // While a brief leaves it out as not applicable.
    const brief = contractOf(await prepare({ request: { version: 2, mode: "action" }, task: "migrations" }));
    expect(brief.items).toEqual([]);
    expect(brief.omissions).toEqual([{ reason: "not_applicable", count: 1, required: false }]);
  });

  it("the signal declares its path as the path_under fact; the brief leaves it undeclared", async () => {
    const [row] = await saveDecisionEpisodes(database, [{
      ...owner(PROJECT.identity, { decision: "Keep the screen bilingual." }),
      conditionsPredicate: { schemaVersion: 1, expression: { kind: "path_under", path: "apps/web" } },
    }]);
    await human("Keep this screen bilingual.", "apps/web/**");
    const signal = contractOf(await prepare({
      channel: "signal", profile: "hook-signal-v1", audience: "hook", request: { version: 2, mode: "action" }, task: "bilingual screen",
      paths: ["apps/web/lib/i18n.ts"], path: "apps/web/lib/i18n.ts",
    }));
    expect(signal.items.find((item) => item.id === row!.id)).toMatchObject({ applicability: "applies" });
    const elsewhere = contractOf(await prepare({
      channel: "signal", profile: "hook-signal-v1", audience: "hook", request: { version: 2, mode: "action" }, task: "bilingual screen",
      paths: ["apps/cli/src/index.ts"], path: "apps/cli/src/index.ts",
    }));
    expect(elsewhere.items.some((item) => item.id === row!.id)).toBe(false);
    expect(elsewhere.omissions).toEqual([{ reason: "not_applicable", count: 1, required: false }]);
    const brief = contractOf(await prepare({ request: { version: 2, mode: "action" }, task: "bilingual screen" }));
    expect(brief.items.find((item) => item.id === row!.id)).toMatchObject({ applicability: "conditional" });
    expect(brief.checks).toEqual([expect.objectContaining({ kind: "requires_check", text: "the conditions depend on facts this request did not declare: path" })]);
  });
});

describe("a commitment read as a unit (§9.4)", () => {
  const completion = { checkId: "chk_delivery_completion_1", purpose: "completion", kind: "manifest_script", target: "package.json", expected: { name: "test" } };

  it("reads an open commitment of this project whole: text, conditions as sentences, completion state and the observations count", async () => {
    const { id } = await createCommitment(database, {
      projectId: PROJECT.id, text: "Ship the release notes with every version.",
      conditions: { schemaVersion: 1, expression: { all: [{ kind: "project_is", projectId: PROJECT.id }, { kind: "operation_is", operation: "deploy" }] } },
      completionChecks: [completion],
    });
    const whole = await read({ read: { kind: "commitment", id, revision: 1 } });
    if ("code" in whole) throw new Error(whole.code);
    const [item] = whole.items;
    expect(item).toMatchObject({ kind: "commitment", id, revision: 1, scope: "project", authority: "owner_instruction", applicability: "conditional", deliveryMode: "contextual" });
    expect(item!.text).toContain("Ship the release notes with every version.");
    expect(item!.text).toContain("Status: open · written by the owner · observations: 0 (pass 0 · fail 0 · unknown 0)");
    expect(item!.text).toContain("Completion criteria (1): manifest_script package.json script test → not observed");
    expect(item!.conditions).toBe(`(the project is ${PROJECT.id} and the operation is deploy)`);
    // A read has no operation: the condition is undecided, and the unit says which fact is missing.
    expect(whole.checks).toEqual([expect.objectContaining({ itemKind: "commitment", itemId: id, kind: "requires_check", text: expect.stringContaining("operation") })]);
    expect(whole.status).toBe("requires_check");
    expect(whole.presentation.text).toContain(`commitment ${id} r1`);
    expect(whole.presentation.text).toContain("conditions: (the project is");

    await observe("commitment", id, 1, completion.checkId, "pass");
    const looked = await read({ read: { kind: "commitment", id, revision: 1 } });
    if ("code" in looked) throw new Error(looked.code);
    expect(looked.items[0]!.text).toContain("observations: 1 (pass 1 · fail 0 · unknown 0)");
    expect(looked.items[0]!.text).toContain("script test → pass");
    // Observed a while ago: still counted, marked stale.
    await observe("commitment", id, 1, completion.checkId, "fail", 11);
    const stale = await read({ read: { kind: "commitment", id, revision: 1 } });
    if ("code" in stale) throw new Error(stale.code);
    expect(stale.items[0]!.text).toContain("observations: 2 (pass 1 · fail 1 · unknown 0)");
    expect(stale.items[0]!.text).toContain("script test → fail (stale)");
  });

  it("applies without conditions, is historical at an older revision, and is not found when closed, foreign, unknown or ahead", async () => {
    const { id } = await createCommitment(database, { projectId: PROJECT.id, text: "Answer every review within a day.", createdBy: "agent" });
    const current = await read({ read: { kind: "commitment", id, revision: 1 } });
    if ("code" in current) throw new Error(current.code);
    expect(current.items[0]).toMatchObject({ applicability: "applies", authority: "agent_report" });
    expect(current.items[0]!.text).toContain("written by an agent");
    expect(current.items[0]!.text).toContain("Completion criteria (0): none approved");
    expect(current.status).toBe("ready");

    expect(await reviseCommitment(database, id, { memoryRev: 1 }, { text: "Answer every review within two days." })).toEqual({ revision: 2 });
    const old = await read({ read: { kind: "commitment", id, revision: 1 } });
    if ("code" in old) throw new Error(old.code);
    expect(old.items[0]).toMatchObject({ revision: 1, applicability: "historical", use: "historical" });
    expect(old.items[0]!.text).toContain("Answer every review within a day.");
    expect(old.checks).toEqual([expect.objectContaining({ kind: "historical_revision", text: "Revision 1 is not current; the current revision is 2." })]);
    expect(await read({ read: { kind: "commitment", id, revision: 3 } })).toEqual({ code: "not_found" });
    expect(await read({ read: { kind: "commitment", id: "cmt_nobody", revision: 1 } })).toEqual({ code: "not_found" });
    expect(await read({ project: OTHER, read: { kind: "commitment", id, revision: 2 } })).toEqual({ code: "not_found" });

    const theirs = await createCommitment(database, { projectId: OTHER.id, text: "Only there." });
    expect(await read({ read: { kind: "commitment", id: theirs.id, revision: 1 } })).toEqual({ code: "not_found" });

    // Closed: history the screen keeps, not a unit an agent applies — at any revision.
    expect(await cancelCommitment(database, id, { memoryRev: 2 }, "no longer wanted")).toEqual({ revision: 3 });
    for (const revision of [1, 2, 3]) expect(await read({ read: { kind: "commitment", id, revision } })).toEqual({ code: "not_found" });
  });

  it("renders a predicate as sentences, operators included", () => {
    expect(predicateSentence({ not: { any: [{ kind: "path_under", path: "apps/web" }, { kind: "task_kind_is", taskKind: "release" }] } }))
      .toBe("not (the path is under apps/web or the task kind is release)");
    expect(predicateSentence({ all: [{ kind: "check_result_is", checkId: CHECK, revision: 2, result: "fail" }] })).toBe(`check ${CHECK} r2 is fail`);
    expect(predicateSentence({ kind: "environment_is", environmentId: ENV })).toBe(`the environment is ${"c".repeat(12)}…`);
  });
});

describe("a case read as a unit (§9.4, T51)", () => {
  it("projects the task's four columns from this project's rows, with unknown where the rows say nothing, and never fulfils from a declaration", async () => {
    const taskId = await createTask(database, { projectId: PROJECT.id, title: "Move the catalog to PostgreSQL 18", body: "Keep the migrations replayable." });
    const [decision] = await saveDecisionEpisodes(database, [owner(PROJECT.identity, { decision: "Migrations run from the CLI." })]);
    const session = await openSession(database, "agent_1", PROJECT.id);
    const logged = await logActivity(database, { agentId: "agent_1", projectId: PROJECT.id, sessionId: session, kind: "decision", summary: "task_closed: migrations replayed on a fresh catalog" });
    if (!("id" in logged)) throw new Error("fixture");
    const { id: commitmentId } = await createCommitment(database, {
      projectId: PROJECT.id, taskId, text: "Every migration replays on an empty catalog.",
      completionChecks: [{ checkId: "chk_delivery_case_completion", purpose: "completion", kind: "path_exists", target: "packages/db/migrations", expected: true }],
    });
    await observe("commitment", commitmentId, 1, "chk_delivery_case_completion", "pass");

    const whole = await read({ read: { kind: "case", id: taskId, revision: 1 } });
    if ("code" in whole) throw new Error(whole.code);
    const [item] = whole.items;
    expect(item).toMatchObject({ kind: "case", id: taskId, revision: 1, scope: "project", authority: "owner_report", applicability: "applies" });
    const text = item!.text;
    expect(text).toContain("asked: Move the catalog to PostgreSQL 18\n\nKeep the migrations replayable. (");
    expect(text).toContain(`decided (1):\n- ${decision!.id} r1 `);
    expect(text).toContain(": Migrations run from the CLI.");
    expect(text).toContain(`declared (1):\n- ${session} decision: task_closed: migrations replayed on a fresh catalog`);
    // T51: the agent's closing declaration stays declared; the commitment stays open, its observation counted apart.
    expect(text).toContain(`checked (1):\n- commitment ${commitmentId} open · observations 1 (pass 1 · fail 0 · unknown 0)`);
    expect(text).toContain("unknown: nothing");
    expect(whole.status).toBe("ready");
    expect(whole.presentation.text).toContain(`case ${taskId} r1`);

    // A task with nothing around it: three halves unknown, and no story written to fill them.
    const bare = await createTask(database, { projectId: PROJECT.id, title: "A bare task", createdBy: "claude" });
    await database.delete(schema.agentActivities);
    await database.delete(schema.decisionEpisodes);
    const empty = await read({ read: { kind: "case", id: bare, revision: 1 } });
    if ("code" in empty) throw new Error(empty.code);
    expect(empty.items[0]).toMatchObject({ authority: "agent_report" });
    expect(empty.items[0]!.text).toContain("decided (0):\ndeclared (0):\nchecked (0):\nunknown: decided, declared, checked");
  });

  it("is not found for a task of another project, an unknown task, or a revision a projection does not have", async () => {
    const taskId = await createTask(database, { projectId: PROJECT.id, title: "Ours" });
    const theirs = await createTask(database, { projectId: OTHER.id, title: "Theirs" });
    expect(await read({ read: { kind: "case", id: theirs, revision: 1 } })).toEqual({ code: "not_found" });
    expect(await read({ project: OTHER, read: { kind: "case", id: taskId, revision: 1 } })).toEqual({ code: "not_found" });
    expect(await read({ read: { kind: "case", id: "tsk_nobody", revision: 1 } })).toEqual({ code: "not_found" });
    expect(await read({ read: { kind: "case", id: taskId, revision: 2 } })).toEqual({ code: "not_found" });
    expect("code" in (await read({ read: { kind: "case", id: taskId, revision: 1 } }))).toBe(false);
  });
});

// ── Delivery D ───────────────────────────────────────────────────────────────────────────────

const CANARY_QUOTE = "CANARY-quote: the owner said so in src/private/secret-path.ts of the other repository";
const CANARY_PROJECT = "CANARY-Other-Project-Name";

/** The typed columns of delivery D as the catalog's writers will store them (another engineer's); the delivery reads the columns. */
async function withPredicates(id: string, columns: { conditions?: object | null; exceptions?: object | null }): Promise<void> {
  const json = (value: object | null | undefined) => value ? `'${JSON.stringify(value)}'::jsonb` : "null";
  await database.execute(`update beliefs set conditions = ${json(columns.conditions)}, exceptions = ${json(columns.exceptions)} where id = '${id}'`);
}

const operationIs = (operation: string) => ({ schemaVersion: 1, expression: { kind: "operation_is", operation } });
const projectIs = (projectId: string) => ({ schemaVersion: 1, expression: { kind: "project_is", projectId } });

describe("a criterion's conditions and exceptions through the delivery (delivery D: §10.1, §10.3, §10.4, D08)", () => {
  it("§10.4: the sentences travel inside the unit and count in its budget — a criterion that fits alone but not with its exceptions is left out whole, its id in the manifest", async () => {
    const core = await human("Run the guard tests first.");
    const statement = `Prefer direct actions in forms ${"— never a dialog for a reversible step ".repeat(30)}`.trim();
    const [id] = await insertBeliefs(database, [belief(statement)]);
    const exceptions = { schemaVersion: 1, expression: { any: Array.from({ length: 20 }, (_, index) => ({ kind: "path_under", path: `apps/web/app/irreversible-${index}/confirm` })) } };
    await withPredicates(id!, { conditions: operationIs("edit"), exceptions });
    const handoff = { channel: "handoff" as const, profile: "handoff-memory-v1" as const, audience: "handoff" as const, request: { version: 2 as const, mode: "action" as const, operation: "edit" as const }, task: "direct actions in forms" };

    const whole = contractOf(await prepare(handoff));
    expect(whole.items.map((item) => item.id)).toEqual([core]);
    expect(whole.manifest).toEqual([expect.objectContaining({ kind: "criterion", id, revision: 1, applicability: "conditional" })]);
    expect(whole.omissions).toEqual([{ reason: "channel_limit", count: 1, required: false }]);
    expect(whole.status).toBe("ready");
    expect(whole.coverage.requiredComplete).toBe(true);
    expect(whole.presentation.text).not.toContain("Prefer direct actions");
    expect(whole.presentation.text).not.toContain("Except when");
    expect(whole.presentation.text).toContain(`- criterion ${id} r1 · global`);
    expect(codePointLength(whole.presentation.text)).toBeLessThanOrEqual(TRANSPORT_PROFILES["handoff-memory-v1"].maxCodePoints!);

    // Without the exceptions the same statement fits, and it travels with its «Applies when» — and only then.
    await withPredicates(id!, { conditions: operationIs("edit"), exceptions: null });
    const fits = contractOf(await prepare(handoff));
    expect(fits.items.map((item) => item.id)).toEqual([core, id]);
    expect(fits.items[1]).toMatchObject({ applicability: "applies", appliesWhen: "the operation is edit" });
    expect(fits.items[1]).not.toHaveProperty("exceptWhen");
    expect(fits.presentation.text).toContain(`  criterion: ${statement}\n  Applies when: the operation is edit`);
    expect(fits.omissions).toEqual([]);
    expect(fits.status).toBe("ready");
    // The rendered unit is what the receipt will look for: the sentence is inside its byte range.
    const stored = await offerById(database, fits.contractId);
    const unit = stored?.unitManifest?.units.find((one) => one.id === id);
    expect(unit).toBeDefined();
    const slice = Buffer.from(fits.presentation.text, "utf8").subarray(unit!.start, unit!.end).toString("utf8");
    expect(slice).toContain("Applies when: the operation is edit");
    expect(sha256Hex(slice)).toBe(unit!.unitHash);
  });

  it("a core criterion the facts rule out is not a required unit that appeared: the confirmation stands, and a moved revision is still heard", async () => {
    const id = await coreBelief("Deploy only from main.");
    await withPredicates(id, { conditions: operationIs("deploy") });
    const kept = await coreBelief("Keep the number at the end.");
    const result = await prepare({ request: { version: 2, mode: "orientation", operation: "edit" } });
    const contract = contractOf(result);
    if ("unavailable" in result) throw new Error("unreachable");
    expect(result.reused).toBe(false);
    expect(contract.items.map((item) => item.id)).toEqual([kept]);
    expect(contract.omissions).toEqual([{ reason: "not_applicable", count: 1, required: false }]);
    expect(contract.status).toBe("ready");
    // Its revision moves between the selection and the confirmation: heard as any move, the offer is built again on the new archive.
    let attempts = 0;
    const moved = contractOf(await prepare({
      request: { version: 2, mode: "orientation", operation: "edit" },
      beforeConfirm: async (attempt) => {
        attempts += 1;
        if (attempt === 0) expect(await signBelief(database, id, "Deploy only from main, always.")).toBe(true);
      },
    }));
    expect(attempts).toBe(2);
    expect(moved.items.map((item) => item.id)).toEqual([kept]);
    expect(await database.select().from(schema.servings)).toHaveLength(2);
  });

  it("a read by id renders the conditions the same way, judges them with the read's facts, at the current revision and from a photograph, and carries no evidence (D08)", async () => {
    const cite = { verdictId: "v_canary", observationId: "obs_canary", quote: CANARY_QUOTE, at: "2026-09-01T00:00:00.000Z", project: CANARY_PROJECT };
    const id = await coreBelief("Prefer direct actions in forms.", { citations: [cite], model: "CANARY-model" });
    await withPredicates(id, { conditions: projectIs(PROJECT.id), exceptions: operationIs("deploy") });

    // The read declares the project and nothing else: the conditions hold, the exception is undecided.
    const whole = await read({ read: { kind: "criterion", id, revision: 1 } });
    if ("code" in whole) throw new Error(whole.code);
    expect(whole.items[0]).toMatchObject({ kind: "criterion", id, revision: 1, applicability: "conditional", appliesWhen: `the project is ${PROJECT.id}`, exceptWhen: "the operation is deploy" });
    expect(whole.checks).toEqual([{ itemKind: "criterion", itemId: id, revision: 1, kind: "requires_check", text: "the conditions depend on facts this request did not declare: operation" }]);
    expect(whole.status).toBe("requires_check");
    const lines = `  criterion: Prefer direct actions in forms.\n  Applies when: the project is ${PROJECT.id}\n  Except when: the operation is deploy`;
    expect(whole.presentation.text).toContain(lines);
    // The same lines the brief prints for the same unit.
    const brief = contractOf(await prepare({ request: { version: 2, mode: "orientation", operation: "edit" } }));
    expect(brief.items[0]).toMatchObject({ id, applicability: "applies", appliesWhen: `the project is ${PROJECT.id}`, exceptWhen: "the operation is deploy" });
    expect(brief.presentation.text).toContain(lines);
    // D08: nothing of the evidence in either.
    for (const contract of [whole, brief]) {
      const serialized = JSON.stringify(contract);
      expect(serialized).not.toContain("CANARY");
      expect(serialized).not.toContain("secret-path");
    }
    // A read from another project: the criterion is global, so it is served there too — with its conditions, which then evaluate false.
    const elsewhere = await read({ project: OTHER, read: { kind: "criterion", id, revision: 1 } });
    if ("code" in elsewhere) throw new Error(elsewhere.code);
    expect(elsewhere.items[0]).toMatchObject({ applicability: "conditional", appliesWhen: `the project is ${PROJECT.id}` });
    expect(elsewhere.checks[0]!.text).toContain("evaluate false with what this read knows");
    expect(JSON.stringify(elsewhere)).not.toContain("CANARY");

    // Signed with other words: revision 1 is historical, and its photograph decides what it carries.
    expect(await signBelief(database, id, "Prefer direct actions in every form.")).toBe(true);
    const bare = await read({ read: { kind: "criterion", id, revision: 1 } });
    if ("code" in bare) throw new Error(bare.code);
    expect(bare.items[0]).toMatchObject({ revision: 1, applicability: "historical", text: "Prefer direct actions in forms." });
    // A photograph that carries the predicates (the shape `criterionPayload` writes since delivery D) renders them as the current one does.
    await database.execute(`update memory_revisions set payload = payload || '${JSON.stringify({ conditions: projectIs(PROJECT.id), exceptions: operationIs("deploy") })}'::jsonb where kind = 'criterion' and object_id = '${id}' and rev = 1`);
    const photographed = await read({ read: { kind: "criterion", id, revision: 1 } });
    if ("code" in photographed) throw new Error(photographed.code);
    expect(photographed.items[0]).toMatchObject({ revision: 1, applicability: "historical", use: "historical", appliesWhen: `the project is ${PROJECT.id}`, exceptWhen: "the operation is deploy" });
    expect(photographed.checks.map((check) => check.kind)).toEqual(["requires_check", "historical_revision"]);
    expect(photographed.presentation.text).toContain(lines);
    expect(JSON.stringify(photographed)).not.toContain("CANARY");
    // The current revision keeps the row's own predicates and the new words.
    const current = await read({ read: { kind: "criterion", id, revision: 2 } });
    if ("code" in current) throw new Error(current.code);
    expect(current.items[0]).toMatchObject({ revision: 2, text: "Prefer direct actions in every form.", appliesWhen: `the project is ${PROJECT.id}` });
  });

  it("D08/§10.3: a criterion born private and widened by the owner is read from another project with its conditions and exceptions, never with the source's citations, paths or name; unresolved blocks it", async () => {
    const cite = { verdictId: "v_canary", observationId: "obs_canary", quote: CANARY_QUOTE, at: "2026-09-01T00:00:00.000Z", project: CANARY_PROJECT };
    const [id] = await insertBeliefs(database, [belief("Confirm an irreversible operation.", { identity: OTHER.identity, citations: [cite], model: "CANARY-model" })]);
    await withPredicates(id!, { conditions: operationIs("edit"), exceptions: { schemaVersion: 1, expression: { kind: "path_under", path: "apps/site" } } });
    expect(await read({ read: { kind: "criterion", id: id!, revision: 1 } })).toEqual({ code: "not_found" });

    expect(await setBeliefScope(database, id!, null)).toBe(true);
    const transferred = await read({ read: { kind: "criterion", id: id!, revision: 2 } });
    if ("code" in transferred) throw new Error(transferred.code);
    expect(transferred.items[0]).toMatchObject({ id, revision: 2, scope: "global", applicability: "conditional", text: "Confirm an irreversible operation.", appliesWhen: "the operation is edit", exceptWhen: "the path is under apps/site" });
    expect(transferred.items[0]).not.toHaveProperty("scopeName");
    const serialized = JSON.stringify(transferred);
    expect(serialized).not.toContain("CANARY");
    expect(serialized).not.toContain("secret-path");
    expect(serialized).not.toContain(OTHER.name);
    expect(serialized).not.toContain(OTHER.identity);
    expect(transferred.presentation.text).toContain("  Applies when: the operation is edit\n  Except when: the path is under apps/site");

    await database.execute(`update beliefs set scope_kind = 'unresolved' where id = '${id}'`);
    expect(await read({ read: { kind: "criterion", id: id!, revision: 2 } })).toEqual({ code: "not_found" });
    expect(contractOf(await prepare({ request: { version: 2, mode: "action", operation: "edit" }, task: "irreversible operation" })).items).toEqual([]);
  });
});
