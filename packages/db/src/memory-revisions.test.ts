import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { canonicalHash } from "@panoma/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import { addDependencies, dependenciesOf } from "./memory-dependencies";
import {
  deleteNarratives, listNarratives, saveDecisionEpisodes, saveNarratives, setDecisionEpisodeStatus,
  setDecisionEpisodeValidUntil, type NewNarrative,
} from "./episodes";
import {
  REVISION_KINDS, commitmentAuthority, commitmentPayload, criterionPayload, decisionPayload, ensureBaselineRevisions, ensureDeliveryModes,
  latestRevision, notePayload, observationPayload, readRevision, recordRevision, revisionHistory, revisionRefsOf, type RevisionInput,
} from "./memory-revisions";
import { addHumanNote, challengeNote, decideNote, proposeNote, setSentinels } from "./notes";
import {
  insertBeliefs, listBeliefs, markPublished, resolveProposal, resolveProposalByRevision, retireBeliefs, setBeliefScope, setBeliefTopics,
  signBelief, updateBelief, vetoBelief, type NewBelief,
} from "./queries";
import * as t from "./schema";

/**
 * Real migrated PostgreSQL: the unique index, the CHECKs on scope and payload, and the row locks
 * the writers rely on are what these tests exercise, not a mock of them.
 */
let home: string;
let db: Database;
let close: () => Promise<void>;
const previousHome = process.env["PANOMA_HOME"];
const PROJECT = "proj-revisions-test";

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-revisions-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
  await db.insert(t.projects).values({ id: PROJECT, slug: "revisions", name: "Revisions", root: "/tmp/revisions", identity: "git:revisions" });
});

beforeEach(async () => {
  await db.delete(t.memoryDependencies);
  await db.delete(t.memoryRevisions);
  await db.delete(t.observations);
  await db.delete(t.commitments);
  await db.delete(t.notes);
  await db.delete(t.beliefs);
  await db.delete(t.decisionEpisodes);
  await db.delete(t.narratives);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

const input = (patch: Partial<RevisionInput> = {}): RevisionInput => ({
  kind: "note", objectId: "note_x", rev: 1, scopeKind: "project", scopeRef: PROJECT, authority: "agent_report",
  disposition: "proposed", payload: { body: "A fact.", status: "proposed" }, reason: "create", ...patch,
});

async function noteRow(id: string) {
  const [row] = await db.select().from(t.notes).where(eq(t.notes.id, id));
  return row!;
}

async function beliefRow(id: string) {
  const [row] = await db.select().from(t.beliefs).where(eq(t.beliefs.id, id));
  return row!;
}

async function episodeRow(id: string) {
  const [row] = await db.select().from(t.decisionEpisodes).where(eq(t.decisionEpisodes.id, id));
  return row!;
}

const belief = (patch: Partial<NewBelief> = {}): NewBelief => ({
  topic: "design", statement: "You want one idea per screen.", state: "inferred", citations: [],
  support: { observations: 3, projects: 2, days: 2 }, model: "test-synthesis", ...patch,
});

describe("recordRevision", () => {
  it("inherits evidence through a normal signature and severs it only for an explicit owner criterion adoption", async () => {
    const evidence = await db.transaction((tx) => recordRevision(tx, input()));
    const criterion = input({ kind: "criterion", objectId: "criterion_adoption", authority: "inference", disposition: "inferred", payload: { statement: "An inferred rule." } });
    const first = await db.transaction((tx) => recordRevision(tx, criterion));
    await db.transaction((tx) => addDependencies(tx, [{ dependent: { revisionId: first.id }, input: { revisionId: evidence.id }, relation: "derived_from" }]));
    const signed = await db.transaction((tx) => recordRevision(tx, { ...criterion, rev: 2, authority: "owner_instruction", disposition: "signed", reason: "approve" }));
    expect(await dependenciesOf(db, { revisionId: signed.id })).toMatchObject([{ inputRevisionId: evidence.id, relation: "derived_from" }]);
    const adopted = await db.transaction((tx) => recordRevision(tx, { ...criterion, rev: 3, authority: "owner_instruction", disposition: "signed", reason: "approve", payload: { statement: "My replacement rule." }, inheritDependencies: false }));
    expect(await dependenciesOf(db, { revisionId: adopted.id })).toEqual([]);
    expect(await readRevision(db, "criterion", "criterion_adoption", 3)).toMatchObject({ previousId: signed.id });
    await expect(db.transaction((tx) => recordRevision(tx, input({ objectId: "invalid_independence", inheritDependencies: false })))).rejects.toThrow("Only an explicit owner criterion adoption");
  });

  it("hashes the canonical payload, links the previous photograph and refuses a second one at the same number", async () => {
    const first = await db.transaction((tx) => recordRevision(tx, input()));
    expect(first.payloadHash).toBe(canonicalHash({ status: "proposed", body: "A fact." }));
    const second = await db.transaction((tx) => recordRevision(tx, input({ rev: 2, disposition: "approved", authority: "owner_confirmation", reason: "approve" })));
    expect(second.id).not.toBe(first.id);

    const stored = await readRevision(db, "note", "note_x", 2);
    expect(stored).toMatchObject({ id: second.id, rev: 2, previousId: first.id, schemaVersion: 1, coverage: "complete", purgedAt: null });
    expect((await readRevision(db, "note", "note_x", 1))?.previousId).toBeNull();
    expect((await latestRevision(db, "note", "note_x"))?.rev).toBe(2);
    expect((await revisionHistory(db, "note", "note_x")).map((row) => row.rev)).toEqual([1, 2]);
    expect(await readRevision(db, "note", "note_x", 3)).toBeUndefined();
    expect(await latestRevision(db, "criterion", "note_x")).toBeUndefined();
    // The references of many objects at once, by object then number, one kind only; nothing for no ids.
    await db.transaction((tx) => recordRevision(tx, input({ objectId: "note_y", payload: { body: "Another." } })));
    expect(await revisionRefsOf(db, "note", ["note_y", "note_x", "note_none"])).toEqual([
      { id: first.id, objectId: "note_x", rev: 1 }, { id: second.id, objectId: "note_x", rev: 2 }, { id: expect.any(String), objectId: "note_y", rev: 1 },
    ]);
    expect(await revisionRefsOf(db, "criterion", ["note_x"])).toEqual([]);
    expect(await revisionRefsOf(db, "note", [])).toEqual([]);

    await expect(db.transaction((tx) => recordRevision(tx, input({ rev: 2 })))).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("keeps an explicit null predecessor and a documented gap in the chain", async () => {
    await db.transaction((tx) => recordRevision(tx, input({ rev: 3, previousId: null, coverage: "baseline_only", reason: "baseline" })));
    expect(await readRevision(db, "note", "note_x", 3)).toMatchObject({ previousId: null, coverage: "baseline_only", reason: "baseline" });
    await db.transaction((tx) => recordRevision(tx, input({ rev: 5 })));
    expect((await readRevision(db, "note", "note_x", 5))?.previousId).toBeNull();
  });

  it("refuses programmer misuse before touching the table", async () => {
    await expect(db.transaction((tx) => recordRevision(tx, input({ kind: "belief" as never })))).rejects.toThrow(/kind/);
    await expect(db.transaction((tx) => recordRevision(tx, input({ scopeRef: null })))).rejects.toThrow(/project/);
    await expect(db.transaction((tx) => recordRevision(tx, input({ rev: 0 })))).rejects.toThrow(/positive/);
    await expect(db.transaction((tx) => recordRevision(tx, input({ reason: "tidy" as never })))).rejects.toThrow(/reason/);
    await expect(db.transaction((tx) => recordRevision(tx, input({ authority: "me" as never })))).rejects.toThrow(/authority/);
    expect(await revisionHistory(db, "note", "note_x")).toEqual([]);
  });
});

describe("notes", () => {
  it("photographs every step of a note's life, the discarded end included", async () => {
    const proposed = await proposeNote(db, { projectId: PROJECT, body: "Build before test.", createdBy: "claude" });
    if (!("id" in proposed)) throw new Error("Fixture proposal was refused.");
    let row = await noteRow(proposed.id);
    expect(row.memoryRev).toBe(1);
    let photo = await readRevision(db, "note", proposed.id, 1);
    expect(photo).toMatchObject({ reason: "create", authority: "agent_report", disposition: "proposed", scopeKind: "project", scopeRef: PROJECT });
    expect(photo?.payload).toEqual(notePayload(row));
    expect(photo?.payloadHash).toBe(canonicalHash(notePayload(row)));
    expect(photo?.payload).not.toHaveProperty("memoryRev");

    expect(await decideNote(db, proposed.id, "approved", { sentinels: [{ kind: "path_exists", target: "package.json", expected: true }] })).toMatchObject({ decided: true });
    row = await noteRow(proposed.id);
    expect(row.memoryRev).toBe(2);
    photo = await readRevision(db, "note", proposed.id, 2);
    expect(photo).toMatchObject({ reason: "approve", authority: "owner_confirmation", disposition: "approved" });
    expect(photo?.payload).toEqual(notePayload(row));
    expect((photo?.payload as { sentinels: unknown[] }).sentinels).toHaveLength(1);

    const challenge = { at: new Date().toISOString(), sentinel: { kind: "path_exists" as const, target: "package.json", expected: true }, observed: "missing" };
    expect(await challengeNote(db, proposed.id, challenge, row.decidedAt)).toBe(true);
    row = await noteRow(proposed.id);
    expect(row.memoryRev).toBe(3);
    photo = await readRevision(db, "note", proposed.id, 3);
    expect(photo).toMatchObject({ reason: "policy", authority: "observed_result", disposition: "challenged" });
    expect(photo?.payload).toEqual(notePayload(row));

    expect(await decideNote(db, proposed.id, "discarded")).toEqual({ decided: true });
    row = await noteRow(proposed.id);
    expect(row.memoryRev).toBe(4);
    photo = await readRevision(db, "note", proposed.id, 4);
    expect(photo).toMatchObject({ reason: "veto", authority: "owner_confirmation", disposition: "discarded" });
    expect(photo?.payload).toEqual(notePayload(row));

    const history = await revisionHistory(db, "note", proposed.id);
    expect(history.map((entry) => entry.rev)).toEqual([1, 2, 3, 4]);
    expect(history.map((entry) => entry.previousId)).toEqual([null, history[0]!.id, history[1]!.id, history[2]!.id]);

    // Nothing moves a note that already has its no: a late decision is `gone`, not a revision.
    expect(await decideNote(db, proposed.id, "approved")).toEqual({ decided: false, reason: "gone" });
    expect(await challengeNote(db, proposed.id, challenge)).toBe(false);
    await setSentinels(db, proposed.id, []);
    expect((await noteRow(proposed.id)).memoryRev).toBe(4);
    expect(await revisionHistory(db, "note", proposed.id)).toHaveLength(4);
  });

  it("gives a human note the person's authority at birth and a new revision when its grounds change", async () => {
    const added = await addHumanNote(db, { projectId: PROJECT, body: "Run pnpm install first.", sentinels: [] });
    if (!("id" in added)) throw new Error("Fixture note was refused.");
    expect(await readRevision(db, "note", added.id, 1)).toMatchObject({ reason: "create", authority: "owner_instruction", disposition: "approved" });

    await setSentinels(db, added.id, [{ kind: "file_contains", target: "package.json", expected: "pnpm" }]);
    const row = await noteRow(added.id);
    expect(row.memoryRev).toBe(2);
    expect(await readRevision(db, "note", added.id, 2)).toMatchObject({ reason: "edit", authority: "owner_instruction", disposition: "approved" });
    expect((await readRevision(db, "note", added.id, 2))?.payload).toEqual(notePayload(row));
  });

  it("does not lose an increment when a decision and a challenge race for the same note", async () => {
    const added = await addHumanNote(db, { projectId: PROJECT, body: "Racy fact." });
    if (!("id" in added)) throw new Error("Fixture note was refused.");
    const challenge = { at: new Date().toISOString(), sentinel: { kind: "path_exists" as const, target: "gone", expected: true }, observed: "missing" };
    const [decided, challenged] = await Promise.all([
      decideNote(db, added.id, "discarded"),
      challengeNote(db, added.id, challenge),
    ]);
    const moves = Number(decided.decided) + Number(challenged);
    expect(moves).toBeGreaterThanOrEqual(1);
    const row = await noteRow(added.id);
    expect(row.memoryRev).toBe(1 + moves);
    const history = await revisionHistory(db, "note", added.id);
    expect(history.map((entry) => entry.rev)).toEqual(Array.from({ length: 1 + moves }, (_, i) => i + 1));
    expect(history[history.length - 1]!.payload).toEqual(notePayload(row));
  });
});

describe("beliefs", () => {
  it("derives the scope from the identity, accepts an explicit unresolved one and refuses a contradiction", async () => {
    const [global, scoped, unresolved] = await insertBeliefs(db, [
      belief(),
      belief({ identity: "git:revisions" }),
      belief({ identity: "git:nameless", scopeKind: "unresolved" }),
    ]);
    expect((await beliefRow(global!)).scopeKind).toBe("global");
    expect((await beliefRow(scoped!)).scopeKind).toBe("project");
    expect((await beliefRow(unresolved!)).scopeKind).toBe("unresolved");
    expect(await readRevision(db, "criterion", global!, 1)).toMatchObject({ reason: "create", authority: "inference", disposition: "inferred", scopeKind: "global", scopeRef: null });
    expect(await readRevision(db, "criterion", scoped!, 1)).toMatchObject({ scopeKind: "project", scopeRef: "git:revisions" });
    expect(await readRevision(db, "criterion", unresolved!, 1)).toMatchObject({ scopeKind: "unresolved", scopeRef: "git:nameless" });
    const row = await beliefRow(global!);
    expect((await readRevision(db, "criterion", global!, 1))?.payload).toEqual(criterionPayload(row));
    expect((await readRevision(db, "criterion", global!, 1))?.payload).not.toHaveProperty("publishedAs");
    expect((await listBeliefs(db)).find((one) => one.id === global!)).toMatchObject({ memoryRev: 1, scopeKind: "global", deliveryMode: "contextual", deliveryPolicyRev: 1 });

    await expect(insertBeliefs(db, [belief({ identity: "git:x", scopeKind: "global" })])).rejects.toThrow(/global/);
    await expect(insertBeliefs(db, [belief({ scopeKind: "project" })])).rejects.toThrow(/project/);
    const [signed] = await insertBeliefs(db, [belief({ state: "signed", model: "owner" })]);
    expect(await readRevision(db, "criterion", signed!, 1)).toMatchObject({ authority: "owner_instruction", disposition: "signed" });
  });

  it("moves the revision on the owner's gestures and never on publication", async () => {
    const [id] = await insertBeliefs(db, [belief()]);

    expect(await signBelief(db, id!)).toBe(true);
    expect((await beliefRow(id!)).memoryRev).toBe(2);
    expect(await readRevision(db, "criterion", id!, 2)).toMatchObject({ reason: "approve", authority: "owner_instruction", disposition: "signed" });
    // Signing again, with the same words, is the same state.
    expect(await signBelief(db, id!)).toBe(true);
    expect((await beliefRow(id!)).memoryRev).toBe(2);
    expect(await signBelief(db, id!, "You want one idea per screen, always.")).toBe(true);
    expect((await beliefRow(id!)).memoryRev).toBe(3);
    expect((await readRevision(db, "criterion", id!, 3))?.payload).toEqual(criterionPayload(await beliefRow(id!)));

    await markPublished(db, [{ id: id!, published: { topic: "design", statement: "You want one idea per screen, always." } }]);
    expect((await beliefRow(id!)).memoryRev).toBe(3);
    expect(await revisionHistory(db, "criterion", id!)).toHaveLength(3);
    // A04/T05 §5.2/§22.3: the line written seeds the core, and the policy revision counts the change once.
    expect(await beliefRow(id!)).toMatchObject({ deliveryMode: "core", deliveryPolicyRev: 2 });
    await markPublished(db, [{ id: id!, published: { topic: "design", statement: "You want one idea per screen, always." } }]);
    expect(await beliefRow(id!)).toMatchObject({ deliveryMode: "core", deliveryPolicyRev: 2, memoryRev: 3 });
    await markPublished(db, [{ id: id!, published: null }]);
    expect(await beliefRow(id!)).toMatchObject({ deliveryMode: "contextual", deliveryPolicyRev: 3, memoryRev: 3, publishedAs: null });
    await markPublished(db, [{ id: id!, published: null }]);
    expect(await beliefRow(id!)).toMatchObject({ deliveryMode: "contextual", deliveryPolicyRev: 3 });
    expect(await revisionHistory(db, "criterion", id!)).toHaveLength(3);

    expect(await setBeliefScope(db, id!, "git:revisions")).toBe(true);
    expect(await beliefRow(id!)).toMatchObject({ memoryRev: 4, scopeKind: "project", identity: "git:revisions" });
    expect(await readRevision(db, "criterion", id!, 4)).toMatchObject({ reason: "scope", scopeKind: "project", scopeRef: "git:revisions" });
    expect(await setBeliefScope(db, id!, "git:revisions")).toBe(true);
    expect((await beliefRow(id!)).memoryRev).toBe(4);
    expect(await setBeliefScope(db, id!, null)).toBe(true);
    expect(await beliefRow(id!)).toMatchObject({ memoryRev: 5, scopeKind: "global", identity: null });

    expect(await vetoBelief(db, id!)).toBe(true);
    const buried = await beliefRow(id!);
    expect(buried).toMatchObject({ memoryRev: 6, state: "vetoed" });
    const photo = await readRevision(db, "criterion", id!, 6);
    expect(photo).toMatchObject({ reason: "veto", authority: "owner_confirmation", disposition: "vetoed" });
    expect(photo?.payload).toEqual(criterionPayload(buried));
    expect(photo?.payloadHash).toBe(canonicalHash(criterionPayload(buried)));
    expect(await vetoBelief(db, id!)).toBe(false);
    expect((await beliefRow(id!)).memoryRev).toBe(6);
  });

  it("photographs a rewrite, a recount that changes nothing does not count, and a redistribution only when it moves", async () => {
    const [id] = await insertBeliefs(db, [belief()]);
    expect(await updateBelief(db, id!, { support: { observations: 3, projects: 2, days: 2 } })).toBe(true);
    expect((await beliefRow(id!)).memoryRev).toBe(1);
    expect(await updateBelief(db, id!, { support: { observations: 4, projects: 2, days: 3 } })).toBe(true);
    expect((await beliefRow(id!)).memoryRev).toBe(2);
    expect(await updateBelief(db, id!, { statement: "You want one idea per screen and one verb per button." })).toBe(true);
    expect((await beliefRow(id!)).memoryRev).toBe(3);
    expect(await readRevision(db, "criterion", id!, 3)).toMatchObject({ reason: "edit", authority: "inference", disposition: "inferred" });
    expect(await updateBelief(db, id!, { identity: "git:revisions" })).toBe(true);
    expect(await beliefRow(id!)).toMatchObject({ memoryRev: 4, scopeKind: "project" });

    expect(await setBeliefTopics(db, [{ id: id!, topic: "design" }])).toBe(1);
    expect((await beliefRow(id!)).memoryRev).toBe(4);
    expect(await setBeliefTopics(db, [{ id: id!, topic: "process" }])).toBe(1);
    expect((await beliefRow(id!)).memoryRev).toBe(5);
    expect(await readRevision(db, "criterion", id!, 5)).toMatchObject({ reason: "edit" });

    expect(await retireBeliefs(db, [id!])).toBe(1);
    expect(await beliefRow(id!)).toMatchObject({ memoryRev: 6, state: "retired" });
    expect(await readRevision(db, "criterion", id!, 6)).toMatchObject({ reason: "supersede", authority: "inference", disposition: "retired" });
    expect(await retireBeliefs(db, [id!])).toBe(0);
    expect((await beliefRow(id!)).memoryRev).toBe(6);
  });

  it("§22.3: a rewrite that resolves the scope word without moving the identity is a change of scope, revised and photographed", async () => {
    const [id] = await insertBeliefs(db, [belief({ identity: "git:nameless", scopeKind: "unresolved" })]);
    expect(await beliefRow(id!)).toMatchObject({ memoryRev: 1, scopeKind: "unresolved" });
    // The same identity again: the word flips from unresolved to project, and that is what an agent receives.
    expect(await updateBelief(db, id!, { identity: "git:nameless" })).toBe(true);
    expect(await beliefRow(id!)).toMatchObject({ memoryRev: 2, scopeKind: "project", identity: "git:nameless" });
    expect(await readRevision(db, "criterion", id!, 2)).toMatchObject({ reason: "edit", scopeKind: "project", scopeRef: "git:nameless" });
    expect((await readRevision(db, "criterion", id!, 2))?.payload).toEqual(criterionPayload(await beliefRow(id!)));
    // Repeated, nothing moves: the word already says project.
    expect(await updateBelief(db, id!, { identity: "git:nameless" })).toBe(true);
    expect((await beliefRow(id!)).memoryRev).toBe(2);
  });

  it("resolves a proposal with a revision on the heir, the absorbed and the question, and closes orphans by rule", async () => {
    const [first, second] = await insertBeliefs(db, [
      belief({ state: "signed", statement: "First signed." }),
      belief({ state: "signed", statement: "Second signed." }),
    ]);
    const [proposal, sibling] = await insertBeliefs(db, [
      belief({ state: "proposed", statement: "Both together.", supersedes: [first!, second!] }),
      belief({ state: "proposed", statement: "Another way.", supersedes: [second!] }),
    ]);

    expect(await resolveProposal(db, proposal!, true)).toBe(true);
    expect(await beliefRow(first!)).toMatchObject({ memoryRev: 2, state: "signed", statement: "Both together." });
    expect(await readRevision(db, "criterion", first!, 2)).toMatchObject({ reason: "adopt", authority: "owner_instruction" });
    expect(await beliefRow(second!)).toMatchObject({ memoryRev: 2, state: "retired" });
    expect(await readRevision(db, "criterion", second!, 2)).toMatchObject({ reason: "supersede", authority: "owner_confirmation", disposition: "retired" });
    expect(await beliefRow(proposal!)).toMatchObject({ memoryRev: 2, state: "answered" });
    expect(await readRevision(db, "criterion", proposal!, 2)).toMatchObject({ reason: "adopt", disposition: "answered" });
    expect(await beliefRow(sibling!)).toMatchObject({ memoryRev: 2, state: "answered" });
    expect(await readRevision(db, "criterion", sibling!, 2)).toMatchObject({ reason: "policy", disposition: "answered" });

    const [third] = await insertBeliefs(db, [belief({ state: "signed", statement: "Third signed." })]);
    const [orphan] = await insertBeliefs(db, [belief({ state: "proposed", statement: "Replace the third.", supersedes: [third!] })]);
    expect(await vetoBelief(db, third!)).toBe(true);
    expect(await beliefRow(orphan!)).toMatchObject({ memoryRev: 2, state: "answered" });
    expect(await readRevision(db, "criterion", orphan!, 2)).toMatchObject({ reason: "policy", disposition: "answered" });

    const [declined] = await insertBeliefs(db, [belief({ state: "proposed", statement: "Never mind.", supersedes: [first!] })]);
    expect(await resolveProposal(db, declined!, false)).toBe(true);
    expect(await readRevision(db, "criterion", declined!, 2)).toMatchObject({ reason: "veto", disposition: "answered" });
    expect((await beliefRow(first!)).memoryRev).toBe(2);
  });

  it("resolves a proposal by compare-and-set (the taste door v2): a moved number is refused with nothing applied, and an answered one is not found", async () => {
    const [signed] = await insertBeliefs(db, [belief({ state: "signed", statement: "Signed one." })]);
    const [proposal] = await insertBeliefs(db, [belief({ state: "proposed", statement: "A better one.", supersedes: [signed!] })]);
    expect(await resolveProposalByRevision(db, proposal!, { memoryRev: 2 }, true)).toEqual({ conflict: true, reason: "stale_revision" });
    expect(await beliefRow(proposal!)).toMatchObject({ memoryRev: 1, state: "proposed" });
    expect(await beliefRow(signed!)).toMatchObject({ memoryRev: 1, statement: "Signed one." });
    expect(await resolveProposalByRevision(db, proposal!, { memoryRev: 1 }, true)).toEqual({ revision: 2, applied: true });
    expect(await beliefRow(signed!)).toMatchObject({ memoryRev: 2, statement: "A better one." });
    expect(await beliefRow(proposal!)).toMatchObject({ memoryRev: 2, state: "answered" });
    expect(await resolveProposalByRevision(db, proposal!, { memoryRev: 2 }, true)).toEqual({ conflict: true, reason: "not_found" });
    expect(await resolveProposalByRevision(db, "bel_nowhere", { memoryRev: 1 }, false)).toEqual({ conflict: true, reason: "not_found" });
    await expect(resolveProposalByRevision(db, proposal!, { memoryRev: 0 }, false)).rejects.toThrow(/positive integer/);
    // Accepting a proposal whose heirs are gone is answered without a place to write: `applied` says so.
    const [lonely] = await insertBeliefs(db, [belief({ state: "proposed", statement: "Nobody to replace.", supersedes: ["bel_gone"] })]);
    expect(await resolveProposalByRevision(db, lonely!, { memoryRev: 1 }, true)).toEqual({ revision: 2, applied: false });
  });
});

describe("decision episodes", () => {
  const owner = (text: string, identity: string | null = null) => ({
    identity, origin: "owner" as const, fields: { decision: { text } }, model: null,
  });

  it("derives the scope from the identity and photographs the creation, a retry adds nothing", async () => {
    const [general] = await saveDecisionEpisodes(db, [owner("Ship on Fridays.")]);
    const [scoped] = await saveDecisionEpisodes(db, [owner("Never on Fridays here.", "git:revisions")]);
    expect(general).toMatchObject({ memoryRev: 1, scopeKind: "global" });
    expect(scoped).toMatchObject({ memoryRev: 1, scopeKind: "project" });
    const photo = await readRevision(db, "decision", general!.id, 1);
    expect(photo).toMatchObject({ reason: "create", authority: "owner_instruction", disposition: "active", scopeKind: "global", scopeRef: null });
    expect(photo?.payload).toEqual(decisionPayload(await episodeRow(general!.id)));
    expect(photo?.payloadHash).toBe(canonicalHash(decisionPayload(await episodeRow(general!.id))));
    expect(await readRevision(db, "decision", scoped!.id, 1)).toMatchObject({ scopeKind: "project", scopeRef: "git:revisions" });

    const [retried] = await saveDecisionEpisodes(db, [owner("Ship on Fridays.")]);
    expect(retried).toEqual(general);
    expect(await revisionHistory(db, "decision", general!.id)).toHaveLength(1);

    const [unresolved] = await saveDecisionEpisodes(db, [{ ...owner("Somewhere.", "git:nameless"), scopeKind: "unresolved" }]);
    expect(unresolved).toMatchObject({ scopeKind: "unresolved" });
    expect(await readRevision(db, "decision", unresolved!.id, 1)).toMatchObject({ scopeKind: "unresolved", scopeRef: "git:nameless" });
    await expect(saveDecisionEpisodes(db, [{ ...owner("Wrong.", "git:x"), scopeKind: "global" }])).rejects.toThrow(/global/);
    await expect(saveDecisionEpisodes(db, [{ ...owner("Wrong."), scopeKind: "project" }])).rejects.toThrow(/project/);
  });

  it("supersedes the predecessor with its own revision and files status and expiry under policy", async () => {
    const [first] = await saveDecisionEpisodes(db, [owner("Use tabs.", "git:revisions")]);
    const [second] = await saveDecisionEpisodes(db, [{ ...owner("Use spaces.", "git:revisions"), supersedesId: first!.id }]);
    expect(second).toMatchObject({ memoryRev: 1, status: "active" });
    const dismissed = await episodeRow(first!.id);
    expect(dismissed).toMatchObject({ memoryRev: 2, status: "dismissed" });
    expect(await readRevision(db, "decision", first!.id, 2)).toMatchObject({ reason: "supersede", authority: "owner_instruction", disposition: "dismissed" });
    expect((await readRevision(db, "decision", first!.id, 2))?.payload).toEqual(decisionPayload(dismissed));

    expect(await setDecisionEpisodeStatus(db, second!.id, "dismissed")).toBe(true);
    expect((await episodeRow(second!.id)).memoryRev).toBe(2);
    expect(await readRevision(db, "decision", second!.id, 2)).toMatchObject({ reason: "policy", disposition: "dismissed" });
    expect(await setDecisionEpisodeStatus(db, second!.id, "dismissed")).toBe(false);
    expect((await episodeRow(second!.id)).memoryRev).toBe(2);
    expect(await setDecisionEpisodeStatus(db, second!.id, "active")).toBe(true);
    expect((await episodeRow(second!.id)).memoryRev).toBe(3);

    const until = new Date("2026-12-31T23:59:59.999Z");
    expect(await setDecisionEpisodeValidUntil(db, second!.id, until)).toBe(true);
    const expiring = await episodeRow(second!.id);
    expect(expiring.memoryRev).toBe(4);
    expect(await readRevision(db, "decision", second!.id, 4)).toMatchObject({ reason: "policy", disposition: "active" });
    expect((await readRevision(db, "decision", second!.id, 4))?.payload).toMatchObject({ validUntil: until.toISOString() });
    expect(await setDecisionEpisodeValidUntil(db, second!.id, until)).toBe(false);
    expect((await episodeRow(second!.id)).memoryRev).toBe(4);
  });

  it("reports an extracted episode as the owner's words and keeps numbering after it is forgotten and extracted again", async () => {
    const source: NewNarrative = {
      identity: "git:revisions", source: "codex", sessionId: "session-a", at: new Date("2026-09-01T12:00:00.000Z"),
      kind: "opening", text: "Use inline editing because it saves navigation.", context: null, truncated: false,
    };
    await saveNarratives(db, [source]);
    const [narrative] = await listNarratives(db);
    const extracted = {
      identity: source.identity, origin: "history" as const, model: "test-extractor",
      fields: { decision: { text: "Use inline editing", narrativeId: narrative!.id } },
    };
    const [saved] = await saveDecisionEpisodes(db, [extracted]);
    expect(saved).toMatchObject({ memoryRev: 1, scopeKind: "project" });
    expect(await readRevision(db, "decision", saved!.id, 1)).toMatchObject({ authority: "owner_report", disposition: "active" });
    expect(await setDecisionEpisodeStatus(db, saved!.id, "dismissed")).toBe(true);
    expect(await readRevision(db, "decision", saved!.id, 2)).toMatchObject({ authority: "owner_confirmation", disposition: "dismissed" });

    expect(await deleteNarratives(db)).toEqual({ narratives: 1, episodes: 1 });
    expect(await revisionHistory(db, "decision", saved!.id)).toHaveLength(2);
    await saveNarratives(db, [source]);
    const [again] = await saveDecisionEpisodes(db, [extracted]);
    expect(again!.id).toBe(saved!.id);
    expect(again).toMatchObject({ memoryRev: 3, status: "active" });
    const history = await revisionHistory(db, "decision", saved!.id);
    expect(history.map((entry) => [entry.rev, entry.reason])).toEqual([[1, "create"], [2, "policy"], [3, "create"]]);
    expect(history[2]!.previousId).toBe(history[1]!.id);
  });
});

describe("ensureBaselineRevisions", () => {
  it("photographs every row without a revision at its number, once, in pages, and leaves the photographed ones alone", async () => {
    const proposed = await proposeNote(db, { projectId: PROJECT, body: "Already photographed.", createdBy: "claude" });
    if (!("id" in proposed)) throw new Error("Fixture proposal was refused.");
    await db.insert(t.notes).values([
      { id: "legacy-note-a", projectId: PROJECT, body: "Old approved.", status: "approved", createdBy: "human", decidedAt: new Date() },
      { id: "legacy-note-b", projectId: PROJECT, body: "Old challenged.", status: "challenged", createdBy: "codex", memoryRev: 3 },
    ]);
    await db.insert(t.beliefs).values([
      { id: "legacy-belief-a", topic: "design", statement: "Old inferred.", state: "inferred", citations: [], support: { observations: 3, projects: 2, days: 2 }, model: "m", scopeKind: "global" },
      { id: "legacy-belief-b", topic: "design", statement: "Old signed.", state: "signed", signedAt: new Date(), identity: "git:revisions", citations: [], support: { observations: 3, projects: 2, days: 2 }, model: "", scopeKind: "project", memoryRev: 2 },
    ]);
    await db.insert(t.decisionEpisodes).values([
      { id: "legacy-decision-a", identity: null, origin: "owner", fields: { decision: { text: "Old general." } }, model: null, scopeKind: "global" },
    ]);

    expect(await ensureBaselineRevisions(db, { batch: 1 })).toEqual({ notes: 2, criteria: 2, decisions: 1, commitments: 0, observations: 0 });

    const noteA = await readRevision(db, "note", "legacy-note-a", 1);
    expect(noteA).toMatchObject({ coverage: "baseline_only", reason: "baseline", authority: "owner_instruction", disposition: "approved", scopeKind: "project", scopeRef: PROJECT });
    expect(noteA?.payload).toEqual(notePayload(await noteRow("legacy-note-a")));
    expect(noteA?.payloadHash).toBe(canonicalHash(notePayload(await noteRow("legacy-note-a"))));
    const noteB = await latestRevision(db, "note", "legacy-note-b");
    expect(noteB).toMatchObject({ rev: 3, previousId: null, authority: "observed_result", disposition: "challenged" });
    expect(await revisionHistory(db, "note", "legacy-note-b")).toHaveLength(1);

    expect(await readRevision(db, "criterion", "legacy-belief-a", 1)).toMatchObject({ coverage: "baseline_only", authority: "inference", scopeKind: "global", scopeRef: null });
    const beliefB = await readRevision(db, "criterion", "legacy-belief-b", 2);
    expect(beliefB).toMatchObject({ coverage: "baseline_only", authority: "owner_instruction", disposition: "signed", scopeKind: "project", scopeRef: "git:revisions" });
    expect(beliefB?.payload).toEqual(criterionPayload(await beliefRow("legacy-belief-b")));

    const decision = await readRevision(db, "decision", "legacy-decision-a", 1);
    expect(decision).toMatchObject({ coverage: "baseline_only", authority: "owner_instruction", disposition: "active", scopeKind: "global" });
    expect(decision?.payload).toEqual(decisionPayload(await episodeRow("legacy-decision-a")));

    // The note the writer photographed keeps its complete revision, untouched.
    expect(await readRevision(db, "note", proposed.id, 1)).toMatchObject({ coverage: "complete", reason: "create" });
    expect(await revisionHistory(db, "note", proposed.id)).toHaveLength(1);

    expect(await ensureBaselineRevisions(db)).toEqual({ notes: 0, criteria: 0, decisions: 0, commitments: 0, observations: 0 });
    const [count] = await db.select({ count: t.memoryRevisions.id }).from(t.memoryRevisions);
    expect(count).toBeDefined();
    expect((await db.select().from(t.memoryRevisions)).length).toBe(6);
  });

  it("photographs a row whose counter moved without a photograph, at the number it carries", async () => {
    const added = await addHumanNote(db, { projectId: PROJECT, body: "Bumped by an older binary." });
    if (!("id" in added)) throw new Error("Fixture note was refused.");
    await db.update(t.notes).set({ memoryRev: 4 }).where(eq(t.notes.id, added.id));
    expect(await ensureBaselineRevisions(db)).toEqual({ notes: 1, criteria: 0, decisions: 0, commitments: 0, observations: 0 });
    expect(await readRevision(db, "note", added.id, 4)).toMatchObject({ coverage: "baseline_only", reason: "baseline", previousId: null });
    expect((await revisionHistory(db, "note", added.id)).map((entry) => entry.rev)).toEqual([1, 4]);
    expect(await ensureBaselineRevisions(db)).toEqual({ notes: 0, criteria: 0, decisions: 0, commitments: 0, observations: 0 });
  });

  it("is a no-op on an empty catalog", async () => {
    expect(await ensureBaselineRevisions(db)).toEqual({ notes: 0, criteria: 0, decisions: 0, commitments: 0, observations: 0 });
  });

  it("photographs the commitments too (delivery C), with the authority their standing gives them", async () => {
    const resolution = { schemaVersion: 1, actor: "checks", revision: 2, checks: [], environmentId: "e" };
    await db.insert(t.commitments).values([
      { id: "legacy-cmt-open", projectId: PROJECT, text: "Open, by the person." },
      { id: "legacy-cmt-agent", projectId: PROJECT, text: "Open, written by an agent.", createdBy: "agent", memoryRev: 2 },
      { id: "legacy-cmt-done", projectId: PROJECT, text: "Fulfilled by checks.", status: "fulfilled", memoryRev: 3, resolution, resolvedAt: new Date() },
      { id: "legacy-cmt-owner", projectId: PROJECT, text: "Fulfilled by the owner.", status: "fulfilled", memoryRev: 2, resolution: { schemaVersion: 1, actor: "owner", revision: 1 }, resolvedAt: new Date() },
      { id: "legacy-cmt-off", projectId: PROJECT, text: "Cancelled.", status: "cancelled", resolution: { schemaVersion: 1, actor: "owner", revision: 1, reason: "no" }, resolvedAt: new Date(), memoryRev: 2 },
    ]);
    expect(await ensureBaselineRevisions(db, { batch: 2 })).toEqual({ notes: 0, criteria: 0, decisions: 0, commitments: 5, observations: 0 });
    const open = await readRevision(db, "commitment", "legacy-cmt-open", 1);
    expect(open).toMatchObject({ coverage: "baseline_only", reason: "baseline", authority: "owner_instruction", disposition: "open", scopeKind: "project", scopeRef: PROJECT });
    const [row] = await db.select().from(t.commitments).where(eq(t.commitments.id, "legacy-cmt-open"));
    expect(open?.payload).toEqual(commitmentPayload(row!));
    expect(open?.payloadHash).toBe(canonicalHash(commitmentPayload(row!)));
    expect(open?.payload).not.toHaveProperty("memoryRev");
    expect(await readRevision(db, "commitment", "legacy-cmt-agent", 2)).toMatchObject({ authority: "agent_report", previousId: null });
    expect(await readRevision(db, "commitment", "legacy-cmt-done", 3)).toMatchObject({ authority: "observed_result", disposition: "fulfilled" });
    expect(await readRevision(db, "commitment", "legacy-cmt-owner", 2)).toMatchObject({ authority: "owner_confirmation", disposition: "fulfilled" });
    expect(await readRevision(db, "commitment", "legacy-cmt-off", 2)).toMatchObject({ authority: "owner_confirmation", disposition: "cancelled" });
    expect(await ensureBaselineRevisions(db)).toEqual({ notes: 0, criteria: 0, decisions: 0, commitments: 0, observations: 0 });
    expect(commitmentAuthority({ status: "open", createdBy: "human", resolution: null })).toBe("owner_instruction");
    expect(commitmentAuthority({ status: "fulfilled", createdBy: "agent", resolution: { actor: "checks" } })).toBe("observed_result");
    expect(REVISION_KINDS).toContain("commitment");
    expect(REVISION_KINDS).toContain("check");
  });

  it("photographs the observations at their backfilled revision (delivery D), as the person's report, filed under the project they are about", async () => {
    const citations = [{ verdictId: "v1", quote: "no dialogs", at: "2026-09-01T10:00:00.000Z" }];
    await db.insert(t.observations).values([
      { id: "legacy-obs-a", identity: null, topic: "workflow", statement: "Legacy, unclassified.", classified: false, citations, model: "m", at: new Date("2026-09-01T10:00:00.000Z") },
      { id: "legacy-obs-b", identity: "git:revisions", topic: "design", classified: true, statement: "Legacy, moved by an older binary.", citations, model: "m", at: new Date("2026-09-02T10:00:00.000Z"), memoryRev: 3, caseOriginKey: "claude-code:ses-1:owner" },
    ]);
    expect(await ensureBaselineRevisions(db, { batch: 1 })).toEqual({ notes: 0, criteria: 0, decisions: 0, commitments: 0, observations: 2 });
    const a = await readRevision(db, "observation", "legacy-obs-a", 1);
    expect(a).toMatchObject({ coverage: "baseline_only", reason: "baseline", authority: "owner_report", disposition: "unclassified", scopeKind: "global", scopeRef: null, previousId: null });
    const [rowA] = await db.select().from(t.observations).where(eq(t.observations.id, "legacy-obs-a"));
    expect(a?.payload).toEqual(observationPayload(rowA!));
    expect(a?.payloadHash).toBe(canonicalHash(observationPayload(rowA!)));
    expect(a?.payload).toMatchObject({ caseOriginKey: null, classified: false, statement: "Legacy, unclassified." });
    expect(a?.payload).not.toHaveProperty("memoryRev");
    expect(a?.payload).not.toHaveProperty("topicAt");
    const b = await readRevision(db, "observation", "legacy-obs-b", 3);
    expect(b).toMatchObject({ coverage: "baseline_only", disposition: "classified", scopeKind: "project", scopeRef: "git:revisions", previousId: null });
    expect(b?.payload).toMatchObject({ caseOriginKey: "claude-code:ses-1:owner", topic: "design" });
    expect(await revisionHistory(db, "observation", "legacy-obs-b")).toHaveLength(1);
    expect(await ensureBaselineRevisions(db)).toEqual({ notes: 0, criteria: 0, decisions: 0, commitments: 0, observations: 0 });
    expect(REVISION_KINDS).toContain("observation");
  });
});

describe("the payloads of delivery C", () => {
  it("name the successor's predecessor and the expiry of a note, and the typed predicates and checks of a decision", async () => {
    const until = new Date("2026-12-31T23:59:59.999Z");
    await db.insert(t.notes).values([
      { id: "note-old", projectId: PROJECT, body: "Old.", status: "superseded", createdBy: "human", memoryRev: 2 },
      { id: "note-new", projectId: PROJECT, body: "New.", status: "approved", createdBy: "human", supersedesId: "note-old", validUntil: until },
    ]);
    const [heir] = await db.select().from(t.notes).where(eq(t.notes.id, "note-new"));
    expect(notePayload(heir!)).toMatchObject({ supersedesId: "note-old", validUntil: until.toISOString() });
    const [old] = await db.select().from(t.notes).where(eq(t.notes.id, "note-old"));
    expect(notePayload(old!)).toMatchObject({ supersedesId: null, validUntil: null, status: "superseded" });

    const predicate = { schemaVersion: 1, expression: { kind: "operation_is", operation: "deploy" } };
    const check = { schemaVersion: 1, checkId: "chk_abcdefgh", revision: 1, purpose: "violation", kind: "path_exists", target: "x", expected: false };
    await db.insert(t.decisionEpisodes).values([
      { id: "decision-typed", identity: null, origin: "owner", fields: { decision: { text: "Typed." } }, model: null, scopeKind: "global", conditionsPredicate: predicate, checks: [check] },
      { id: "decision-plain", identity: null, origin: "owner", fields: { decision: { text: "Plain." } }, model: null, scopeKind: "global" },
    ]);
    const [typed] = await db.select().from(t.decisionEpisodes).where(eq(t.decisionEpisodes.id, "decision-typed"));
    expect(decisionPayload(typed!)).toMatchObject({ conditionsPredicate: predicate, exceptionsPredicate: null, checks: [check] });
    const [plain] = await db.select().from(t.decisionEpisodes).where(eq(t.decisionEpisodes.id, "decision-plain"));
    expect(decisionPayload(plain!)).toMatchObject({ conditionsPredicate: null, exceptionsPredicate: null, checks: [] });
    // The baseline photographs exactly those payloads.
    await ensureBaselineRevisions(db);
    expect((await readRevision(db, "decision", "decision-typed", 1))?.payload).toEqual(decisionPayload(typed!));
    expect((await readRevision(db, "note", "note-new", 1))?.payload).toEqual(notePayload(heir!));
  });
});

describe("ensureDeliveryModes (A04/T05, §5.2/§22.3)", () => {
  it("seeds the core from the published manifest in pages, bumps the policy revision once per row moved, and is a no-op afterwards", async () => {
    // Rows written before the mode existed: the column says contextual whatever the file said.
    await db.insert(t.beliefs).values([
      { id: "seed-published-a", topic: "design", statement: "Published, signed.", state: "signed", signedAt: new Date(), citations: [], support: { observations: 3, projects: 2, days: 2 }, model: "", scopeKind: "global", publishedAs: { topic: "design", statement: "Published, signed." } },
      { id: "seed-published-b", topic: "design", statement: "Published, inferred.", state: "inferred", citations: [], support: { observations: 3, projects: 2, days: 2 }, model: "m", scopeKind: "global", publishedAs: { topic: "design", statement: "Published, inferred." }, deliveryPolicyRev: 4 },
      { id: "seed-unpublished", topic: "design", statement: "Never in the file.", state: "signed", signedAt: new Date(), citations: [], support: { observations: 3, projects: 2, days: 2 }, model: "", scopeKind: "global" },
      // Core without a line: the column drifted, and the manifest says contextual.
      { id: "seed-drifted", topic: "design", statement: "Core by hand.", state: "inferred", citations: [], support: { observations: 3, projects: 2, days: 2 }, model: "m", scopeKind: "global", deliveryMode: "core" },
      // Already in step: untouched, policy revision included.
      { id: "seed-in-step", topic: "design", statement: "Already core.", state: "signed", signedAt: new Date(), citations: [], support: { observations: 3, projects: 2, days: 2 }, model: "", scopeKind: "global", publishedAs: { topic: "design", statement: "Already core." }, deliveryMode: "core", deliveryPolicyRev: 7 },
    ]);

    expect(await ensureDeliveryModes(db, { batch: 1 })).toEqual({ promoted: 2, demoted: 1 });
    expect(await beliefRow("seed-published-a")).toMatchObject({ deliveryMode: "core", deliveryPolicyRev: 2, memoryRev: 1 });
    expect(await beliefRow("seed-published-b")).toMatchObject({ deliveryMode: "core", deliveryPolicyRev: 5 });
    expect(await beliefRow("seed-unpublished")).toMatchObject({ deliveryMode: "contextual", deliveryPolicyRev: 1 });
    expect(await beliefRow("seed-drifted")).toMatchObject({ deliveryMode: "contextual", deliveryPolicyRev: 2 });
    expect(await beliefRow("seed-in-step")).toMatchObject({ deliveryMode: "core", deliveryPolicyRev: 7 });
    // A signature alone never enters the core; a line written does, and the same rule holds afterwards.
    expect(await signBelief(db, "seed-unpublished")).toBe(true);
    expect(await ensureDeliveryModes(db)).toEqual({ promoted: 0, demoted: 0 });
    expect((await beliefRow("seed-unpublished")).deliveryMode).toBe("contextual");
    await markPublished(db, [{ id: "seed-unpublished", published: { topic: "design", statement: "Never in the file." } }]);
    expect(await beliefRow("seed-unpublished")).toMatchObject({ deliveryMode: "core", deliveryPolicyRev: 2 });
    expect(await ensureDeliveryModes(db)).toEqual({ promoted: 0, demoted: 0 });
    // Publication never photographs: the revisions are the writers' alone.
    expect(await revisionHistory(db, "criterion", "seed-published-a")).toHaveLength(0);
  });

  it("is a no-op on an empty catalog", async () => {
    expect(await ensureDeliveryModes(db)).toEqual({ promoted: 0, demoted: 0 });
  });
});
