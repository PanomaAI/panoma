import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_TASTE_BYTES, TASTE_FILE, writeTaste, type TasteLine, type TwinConsent } from "@panoma/core";
import {
  addDependencies, addHumanNote, beginDeletion, decideNote, insertBeliefs, listBeliefs, markPublished, proposeNote, queueWrite, readRevision,
  recordObservation, runDeletionBatches, saveDecisionEpisodes, schema, setBeliefScope, setValidUntil,
  type Database, type Environment, type NewBelief, type OutcomeResult,
} from "@panoma/db";
import { MemoryRequestError, predicateSentence, selectMemory, taskKindOf, type SelectInput } from "./select-memory";

/*
  The selector, and the four promises the plan makes about it: the core is whole and no ranking
  displaces it (A04/T05), and an inference with much support never gains priority over a
  signature (T24); a scope nobody can name never widens to global (A05/T23); the search
  covers the whole eligible archive before any limit, so a decision behind 250 newer rows is
  found by its words (A06/T19); and a limit produces a continuation and partial coverage rather
  than a quiet cut (T21). Plus what travels with a conditional decision (T22), a long exception
  (A07/T18), a query that mixes Spanish, English and an identifier (T20), and the file heard
  before a criterion is served: a line the owner deleted from `TASTE.md` is a veto and a line
  they rewrote is their text (A20/T57).

  Delivery C adds the typed predicates in three values (§10.1): a fresh pass applies, a fresh
  fail is `not_applicable`, and a missing, stale or unknown observation — or an undeclared fact —
  keeps the unit travelling `conditional` with the check it needs named (§9.1); verification
  never transfers between environments (C03/T48). And the two eligibility rules of notes: a
  superseded or expired note is out, its successor names it (T52), and a revision derived from a
  withdrawn input is never rescued by later support (T53).

  Delivery D gives a criterion the same two predicates: judged with the same facts and the same
  three outcomes, its conditions and exceptions rendered inside the unit («Applies when»,
  «Except when») and counted in its budget (§10.4); a global criterion born private reaches
  another project with them and never with its evidence (§10.3, D08); an unresolved identity
  still blocks it; and a criterion without a predicate is served exactly as before.
 */

let home: string;
let database: Database;
let close: () => Promise<void>;
const previousHome = process.env["PANOMA_HOME"];

const PROJECT = { id: "select-memory", slug: "select-memory", name: "Select memory", identity: "git:select-memory", root: "/tmp/select-memory" };
const OTHER = { id: "other-project", slug: "other-project", name: "Other project", identity: "git:other", root: "/tmp/other-project" };
const NAMES = { [PROJECT.identity]: PROJECT.name, [OTHER.identity]: OTHER.name };
const CONSENT: TwinConsent = { sources: {}, inferred: true };

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-select-memory-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: PROJECT.id, slug: PROJECT.slug, name: PROJECT.name, root: PROJECT.root, identity: PROJECT.identity },
    { id: OTHER.id, slug: OTHER.slug, name: OTHER.name, root: OTHER.root, identity: OTHER.identity },
  ]);
});

beforeEach(async () => {
  await database.delete(schema.memoryDeletions);
  await database.delete(schema.memoryOutcomes);
  await database.delete(schema.memoryDependencies);
  await database.delete(schema.memoryRevisions);
  await database.delete(schema.notes);
  await database.delete(schema.decisionEpisodes);
  await database.delete(schema.beliefs);
  await rm(join(home, TASTE_FILE), { recursive: true, force: true });
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

const at = (daysAgo: number) => new Date(Date.UTC(2026, 8, 14 - daysAgo));

const note = (id: string, body: string, trigger: string | null, extra: Partial<typeof schema.notes.$inferInsert> = {}) => ({
  id, projectId: PROJECT.id, body, createdBy: "human", status: "approved", trigger, createdAt: at(0), ...extra,
});

const owner = (identity: string | null, fields: Record<string, string>) => ({
  identity, origin: "owner" as const, model: null,
  fields: Object.fromEntries(Object.entries(fields).map(([name, text]) => [name, { text }])),
});

const belief = (statement: string, patch: Partial<NewBelief> = {}): NewBelief => ({
  topic: "workflow", statement, identity: null, state: "signed", citations: [],
  support: { observations: 4, projects: 2, days: 3 }, model: "owner", ...patch,
});

/** A criterion in the core: its line was written to the file, which is the only thing that seeds the core (§5.2/§22.3). */
async function coreBelief(statement: string, patch: Partial<NewBelief> = {}): Promise<string> {
  const [id] = await insertBeliefs(database, [belief(statement, patch)]);
  const scope = patch.identity ? { scope: NAMES[patch.identity] ?? patch.identity } : {};
  await markPublished(database, [{ id: id!, published: { topic: patch.topic ?? "workflow", statement, ...scope } }]);
  return id!;
}

function select(patch: Partial<SelectInput> = {}) {
  return selectMemory({ database, project: PROJECT, mode: "orientation", audience: "agent", consent: CONSENT, names: NAMES, ...patch });
}

const refs = (selection: Awaited<ReturnType<typeof selectMemory>>) => selection.items.map((item) => `${item.kind}:${item.id}`);

describe("the core (A04/T05)", () => {
  it("delivers every awake note and every core criterion of the project, whole, with scope and authority, and nothing else without a task", async () => {
    await database.insert(schema.notes).values([
      note("awake-human", "Run the guard tests before the full suite.", null),
      note("awake-agent", "The build needs the packages built first.", null, { createdBy: "distiller" }),
      note("sleeping", "Keep this screen bilingual.", "apps/web/**"),
      note("proposed", "Not decided yet.", null, { status: "proposed" }),
      note("challenged", "The disk said no.", null, { status: "challenged" }),
      { ...note("foreign", "Another project's rule.", null), projectId: OTHER.id },
    ]);
    const global = await coreBelief("Every screen keeps the number at the end of the sentence.");
    const mine = await coreBelief("Here, commit messages name the guard they touch.", { identity: PROJECT.identity });
    const theirs = await coreBelief("Only there.", { identity: OTHER.identity });
    const inferred = await coreBelief("You want tests beside their code.", { state: "inferred", model: "openai/gpt" });
    const weak = await coreBelief("Weak inference.", { state: "inferred", model: "openai/gpt", support: { observations: 1, projects: 1, days: 1 } });
    const [contextual] = await insertBeliefs(database, [belief("A contextual criterion.")]);

    const selection = await select();
    expect(new Set(refs(selection))).toEqual(new Set([
      "note:awake-human", "note:awake-agent", `criterion:${global}`, `criterion:${mine}`, `criterion:${inferred}`,
    ]));
    expect([...selection.required]).toEqual(refs(selection));
    expect(selection.items.every((item) => item.deliveryMode === "core")).toBe(true);
    // Notes first, then criteria, then decisions; ids ascending inside a kind: the same archive prints the same text.
    expect(refs(selection).slice(0, 2)).toEqual(["note:awake-agent", "note:awake-human"]);
    const byId = new Map(selection.items.map((item) => [item.id, item]));
    expect(byId.get("awake-human")).toMatchObject({ scope: "project", authority: "owner_instruction", applicability: "applies", evidenceState: "unverified", revision: 1, text: "Run the guard tests before the full suite." });
    expect(byId.get("awake-agent")).toMatchObject({ authority: "owner_confirmation" });
    expect(byId.get(global)).toMatchObject({ scope: "global", authority: "owner_instruction", topic: "workflow" });
    expect(byId.get(global)).not.toHaveProperty("scopeName");
    expect(byId.get(mine)).toMatchObject({ scope: "project", scopeName: PROJECT.name });
    expect(byId.get(inferred)).toMatchObject({ authority: "inference", scope: "global" });
    expect(byId.has(theirs)).toBe(false);
    expect(byId.has(weak)).toBe(false);
    expect(byId.has(contextual!)).toBe(false);
    expect(selection.status).toBe("ready");
    expect(selection.checks).toEqual([]);
    expect(selection.coverage).toEqual({ searchComplete: null, requiredComplete: true, sourceReadable: null, limitsHit: [], candidateCount: 0 });
    expect(selection.omissions).toEqual([]);
    expect(selection.continuation).toBeNull();
    expect(selection.snapshot).toMatchObject({ audience: "agent", projectRef: PROJECT.id, useGeneration: 0, grantRefs: [], rankingVersion: 1, renderVersion: 1 });
    expect(selection.revisions).toEqual(selection.items.map((item) => ({ kind: item.kind, id: item.id, rev: item.revision })));
  });

  it("does not deliver an inferred criterion without the owner's yes, whatever its support", async () => {
    await coreBelief("You want tests beside their code.", { state: "inferred", model: "openai/gpt" });
    const selection = await select({ consent: { sources: {} } });
    expect(selection.items).toEqual([]);
  });

  it("T24: an inference with much support that contradicts a signature never gains priority over it — each travels with its own authority, neither displaces the other", async () => {
    const heavy = { observations: 40, projects: 4, days: 20 };
    const signed = await coreBelief("Tests live beside their module.", { topic: "testing", support: { observations: 1, projects: 1, days: 1 } });
    const inferred = await coreBelief("You want tests in a tests folder of their own.", { topic: "testing", state: "inferred", model: "openai/gpt", support: heavy });

    // In the core: both are required, the signature is the owner's instruction, the inference stays an inference.
    const selection = await select();
    expect(new Set(refs(selection))).toEqual(new Set([`criterion:${signed}`, `criterion:${inferred}`]));
    expect([...selection.required].sort()).toEqual(refs(selection).slice().sort());
    const byId = new Map(selection.items.map((item) => [item.id, item]));
    expect(byId.get(signed)).toMatchObject({ authority: "owner_instruction", deliveryMode: "core", topic: "testing", text: "Tests live beside their module." });
    expect(byId.get(inferred)).toMatchObject({ authority: "inference", deliveryMode: "core", topic: "testing" });
    // The support never reaches the contract, so nothing downstream can weigh it against the signature (§10.3, D08).
    expect(byId.get(inferred)).not.toHaveProperty("support");
    expect(byId.get(signed)).not.toHaveProperty("support");
    // Nor does it order the core: ids ascending, whichever one carries the larger figures (§4.3).
    expect(refs(selection)).toEqual([signed, inferred].sort().map((id) => `criterion:${id}`));
    expect(selection.omissions).toEqual([]);
    expect(selection.status).toBe("ready");

    // Outside the core the same holds: two contextual criteria that share the task's words tie on their words and fall
    // to id order, and the heavy support of the inference is not a score.
    const [signedContextual, inferredContextual] = await insertBeliefs(database, [
      belief("Gradients never appear on a button.", { topic: "color", support: { observations: 1, projects: 1, days: 1 } }),
      belief("Gradients never appear on a card.", { topic: "color", state: "inferred", model: "openai/gpt", support: heavy }),
    ]);
    const contextual = await select({ task: "gradients never appear" });
    const found = contextual.items.filter((item) => item.deliveryMode === "contextual");
    expect(found.map((item) => item.id)).toEqual([signedContextual, inferredContextual].sort());
    expect(found.map((item) => item.authority).sort()).toEqual(["inference", "owner_instruction"]);
    expect(found.find((item) => item.id === signedContextual)).toMatchObject({ authority: "owner_instruction" });
    expect(found.find((item) => item.id === inferredContextual)).toMatchObject({ authority: "inference" });
    // And without the owner's yes the inference is gone while the signature stands, support or no support.
    const withoutYes = await select({ consent: { sources: {} }, task: "gradients never appear" });
    expect(refs(withoutYes)).toEqual([`criterion:${signed}`, `criterion:${signedContextual}`]);
  });

  it("in an action, a sleeping note whose trigger covers a declared path is core, with the paths it covered", async () => {
    await database.insert(schema.notes).values([
      note("web", "Keep this screen bilingual.", "apps/web/**"),
      note("db", "Rebuild the package after a schema change.", "packages/db/src/schema.ts"),
      note("elsewhere", "Not this path.", "apps/cli/**"),
    ]);
    const selection = await select({ mode: "action", paths: ["apps/web/lib/i18n.ts", "packages/db/src/schema.ts"] });
    expect(refs(selection)).toEqual(["note:db", "note:web"]);
    expect([...selection.required]).toEqual(["note:db", "note:web"]);
    expect(selection.items[0]).toMatchObject({ deliveryMode: "core", trigger: "packages/db/src/schema.ts", matchedPaths: ["packages/db/src/schema.ts"] });
    expect(selection.items[1]).toMatchObject({ deliveryMode: "core", matchedPaths: ["apps/web/lib/i18n.ts"] });
    // In orientation the same paths are an exact route, not the core.
    const orientation = await select({ mode: "orientation", paths: ["apps/web/lib/i18n.ts"] });
    expect(refs(orientation)).toEqual(["note:web"]);
    expect(orientation.required.size).toBe(0);
    expect(orientation.items[0]).toMatchObject({ deliveryMode: "contextual", matchedPaths: ["apps/web/lib/i18n.ts"] });
    expect(orientation.coverage).toMatchObject({ searchComplete: true, candidateCount: 1 });
  });

  it("reads the evidence state of a note from the patrol, never from the note alone", async () => {
    await database.insert(schema.notes).values([
      note("anchored", "The migrations folder exists.", null, { sentinels: [{ kind: "path_exists", target: "packages/db/migrations", expected: "" }] }),
      note("bare", "No anchor here.", null),
    ]);
    const patrolled = await select({ patrol: { checked: 1, challenged: [] } });
    expect(patrolled.items.map((item) => [item.id, item.evidenceState])).toEqual([["anchored", "verified"], ["bare", "unknown"]]);
    expect(patrolled.coverage.sourceReadable).toBe(true);
    const skipped = await select({ patrol: { checked: 0, challenged: [], unverified: 1, skipped: "root-missing" } });
    expect(skipped.items.map((item) => item.evidenceState)).toEqual(["unverified", "unverified"]);
    expect(skipped.coverage.sourceReadable).toBe(false);
    const none = await select();
    expect(none.items.map((item) => item.evidenceState)).toEqual(["unverified", "unverified"]);
    expect(none.coverage.sourceReadable).toBeNull();
  });
});

describe("the file before the criteria (A20/T57, §10.4)", () => {
  const cite = (verdictId: string) => ({ verdictId, observationId: "obs_1", quote: "…", at: "2026-09-01T00:00:00.000Z", project: PROJECT.name });
  const line = (statement: string, citations: string[] = []): TasteLine => ({ topic: "workflow", statement, citations });

  it("A20/T57: a published criterion the owner deleted from TASTE.md is not served, is vetoed, and is not served later from the row", async () => {
    const kept = await coreBelief("Keep the number at the end.");
    const gone = await coreBelief("Never use gradients.");
    await writeTaste([line("Keep the number at the end."), line("Never use gradients.")]);
    // The owner opens the file and deletes the second line.
    await writeTaste([line("Keep the number at the end.")]);

    const selection = await select();
    expect(refs(selection)).toEqual([`criterion:${kept}`]);
    expect(selection.criteriaReconciled).toBe(true);
    expect(selection.omissions).toEqual([]);
    expect(selection.status).toBe("ready");
    const buried = (await listBeliefs(database)).find((row) => row.id === gone);
    expect(buried).toMatchObject({ state: "vetoed", publishedAs: null, deliveryMode: "contextual", memoryRev: 2 });
    // The next selection reads the row alone, and the row is dead: the veto is not a filter of one request.
    expect(refs(await select())).toEqual([`criterion:${kept}`]);
    expect(refs(await select({ task: "gradients" }))).toEqual([`criterion:${kept}`]);
  });

  it("A20/T57: a line the owner rewrote by hand is served with the file's text, signed as their own instruction", async () => {
    const id = await coreBelief("You prefer tests beside their code.", { state: "inferred", model: "openai/gpt", citations: [cite("v1")] });
    await writeTaste([line("You prefer tests beside their code.", ["v1"])]);
    // The owner rewrites the sentence; the mark travels with it, which is what tells a rewrite from a deletion.
    await writeTaste([line("Tests live beside their module, always.", ["v1"])]);

    const selection = await select();
    expect(selection.items).toEqual([expect.objectContaining({ id, text: "Tests live beside their module, always.", authority: "owner_instruction", revision: 2, deliveryMode: "core" })]);
    expect((await listBeliefs(database)).find((row) => row.id === id)).toMatchObject({ state: "signed", statement: "Tests live beside their module, always.", memoryRev: 2 });
    // Reconciled again, the file and the row agree: nothing moves.
    const again = await select();
    expect(again.items[0]).toMatchObject({ revision: 2, text: "Tests live beside their module, always." });
    expect((await listBeliefs(database)).find((row) => row.id === id)?.memoryRev).toBe(2);
  });

  it("an absent file is a reset, not a veto: the published criteria are served and nothing is buried", async () => {
    const id = await coreBelief("Keep the number at the end.");
    expect(refs(await select())).toEqual([`criterion:${id}`]);
    expect((await listBeliefs(database)).find((row) => row.id === id)).toMatchObject({ state: "signed", memoryRev: 1 });
  });

  it("an oversized TASTE file is unavailable and never interpreted as an empty portrait", async () => {
    const id = await coreBelief("Keep this signed criterion intact.");
    await writeFile(join(home, TASTE_FILE), "x".repeat(MAX_TASTE_BYTES + 1));
    const selection = await select();
    expect(selection.criteriaReconciled).toBe(false);
    expect(selection.items).toEqual([]);
    expect((await listBeliefs(database)).find((row) => row.id === id)).toMatchObject({ state: "signed", memoryRev: 1 });
  });

  it("a file that cannot be read leaves the criteria unavailable: none travels, the omission says so, and a core one makes the contract incomplete", async () => {
    // A directory where the portrait should be: `readTaste` would answer an empty portrait, which is not the same thing.
    await mkdir(join(home, TASTE_FILE));
    await database.insert(schema.notes).values([note("awake", "An awake note.", null)]);
    const core = await coreBelief("A core rule about screens.");
    const [contextual] = await insertBeliefs(database, [belief("A contextual rule about screens.")]);

    const selection = await select({ task: "rule about screens" });
    expect(refs(selection)).toEqual(["note:awake"]);
    expect(selection.criteriaReconciled).toBe(false);
    expect(selection.omissions).toEqual([{ reason: "taste_unreconciled", count: 2, required: true }]);
    expect(selection.status).toBe("incomplete");
    expect(selection.coverage.requiredComplete).toBe(false);
    // Nothing is buried for a file nobody could read.
    expect((await listBeliefs(database)).map((row) => [row.id, row.state]).sort()).toEqual([[contextual, "signed"], [core, "signed"]].sort());

    // Without a core criterion among the missing, the contract is not incomplete: the omission is optional.
    await database.delete(schema.beliefs);
    await insertBeliefs(database, [belief("A contextual rule about screens.")]);
    const optional = await select({ task: "rule about screens" });
    expect(optional.omissions).toEqual([{ reason: "taste_unreconciled", count: 1, required: false }]);
    expect(optional.status).toBe("ready");
    expect(optional.coverage.requiredComplete).toBe(true);
  });

  it("a reconciliation that does not finish within the budget leaves the criteria unavailable this time, and the veto still lands", async () => {
    const kept = await coreBelief("Keep the number at the end.");
    const gone = await coreBelief("Never use gradients.");
    await writeTaste([line("Keep the number at the end."), line("Never use gradients.")]);
    await writeTaste([line("Keep the number at the end.")]);

    // The write queue is busy: the veto cannot land within the budget.
    const busy = queueWrite(() => new Promise<void>((resolve) => setTimeout(resolve, 120)));
    const selection = await select({ limits: { tasteBudgetMs: 20 } });
    expect(selection.criteriaReconciled).toBe(false);
    expect(selection.items).toEqual([]);
    expect(selection.omissions).toEqual([{ reason: "taste_unreconciled", count: 2, required: true }]);
    expect(selection.status).toBe("incomplete");
    await busy;
    // FIFO: once a later job has run, the veto queued before it has landed.
    await queueWrite(async () => undefined);
    expect((await listBeliefs(database)).find((row) => row.id === gone)?.state).toBe("vetoed");
    expect(refs(await select())).toEqual([`criterion:${kept}`]);
  });
});

describe("scope (A05/T23)", () => {
  it("never delivers a criterion whose identity has no catalog name, here or in another project, and reports it once", async () => {
    await coreBelief("A rule for a project that lost its name.", { identity: "git:vanished" });
    await coreBelief("A rule for this project.", { identity: PROJECT.identity });
    const here = await select();
    expect(here.items.map((item) => item.text)).toEqual(["A rule for this project."]);
    // No name was known for this project's own identity either: its rules are unresolved, not global.
    const nameless = await select({ names: {} });
    expect(nameless.items).toEqual([]);
    expect(nameless.omissions).toEqual([{ reason: "unresolved_scope", count: 1, required: false }]);
    const elsewhere = await select({ project: OTHER });
    expect(elsewhere.items).toEqual([]);
    expect(elsewhere.omissions).toEqual([]);
  });

  it("a decision or criterion the catalog marked unresolved reaches no agent, and a general decision must say it is global", async () => {
    const [marked] = await saveDecisionEpisodes(database, [{ ...owner(PROJECT.identity, { decision: "Marked unresolved." }), scopeKind: "unresolved" }]);
    const [general] = await saveDecisionEpisodes(database, [owner(null, { decision: "General and global." })]);
    const [criterion] = await insertBeliefs(database, [belief("Born global.")]);
    await database.execute(`update beliefs set scope_kind = 'unresolved' where id = '${criterion}'`);
    const selection = await select({ task: "marked unresolved general global born" });
    expect(refs(selection)).toEqual([`decision:${general!.id}`]);
    expect(selection.items[0]).toMatchObject({ scope: "global", authority: "owner_instruction" });
    expect(marked!.scopeKind).toBe("unresolved");
    expect(selection.omissions).toEqual([{ reason: "unresolved_scope", count: 2, required: false }]);
  });
});

describe("the search over the whole eligible archive (A06/T19, T20)", () => {
  it("finds the one relevant decision behind 250 newer ones by its words, without a recency window", async () => {
    await saveDecisionEpisodes(database, [owner(null, { decision: "Keep the PGlite catalog closed between sessions.", rationale: "It corrupted when left open." })]);
    const filler = Array.from({ length: 250 }, (_, index) => owner(index % 2 === 0 ? null : PROJECT.identity, { decision: `Filler decision number ${index}.` }));
    await saveDecisionEpisodes(database, filler);
    const selection = await select({ mode: "action", task: "why does the catalog corrupt when PGlite stays open" });
    expect(selection.items).toHaveLength(1);
    expect(selection.items[0]).toMatchObject({ kind: "decision", text: "Keep the PGlite catalog closed between sessions.", rationale: "It corrupted when left open.", deliveryMode: "contextual" });
    // Three shared words, each in one document of 251: equal weights, so the alphabet orders them.
    expect(selection.items[0]!.matched).toEqual(["catalog", "open", "pglite"]);
    expect(selection.coverage).toMatchObject({ searchComplete: true, requiredComplete: true, candidateCount: 1, limitsHit: [] });
    expect(selection.status).toBe("ready");
    expect(selection.required.size).toBe(0);
  });

  it("T20: a query in Spanish and English with an identifier finds by the exact id first and by the words of each language", async () => {
    await database.insert(schema.notes).values([
      note("note_pagos", "Los cobros pasan por la pasarela y nunca por el cliente.", "apps/web/app/pagos/**"),
      note("note_ingles", "Refunds are issued from the ledger screen only.", "apps/web/app/refunds/**"),
      note("note_exacta", "Unrelated words entirely.", "docs/**"),
      note("note_muda", "Nothing in common with the question.", "scripts/**"),
    ]);
    const [decision] = await saveDecisionEpisodes(database, [owner(PROJECT.identity, { decision: "Refunds older than a year are refused." })]);
    const selection = await select({ mode: "action", task: "Revisa los cobros de la pasarela and the refunds flow; see note_exacta" });
    expect(refs(selection)).toEqual(["note:note_exacta", "note:note_pagos", "note:note_ingles", `decision:${decision!.id}`]);
    expect(selection.items[0]).not.toHaveProperty("matched");
    expect(selection.items[1]!.matched).toEqual(["cobros", "pasarela"]);
    expect(selection.items[2]!.matched).toEqual(["refunds"]);
    expect(selection.items[3]!.matched).toEqual(["refunds"]);
    expect(selection.coverage).toMatchObject({ searchComplete: true, candidateCount: 4 });
  });

  it("finds a sleeping note by a path written in the task, by segments and never by a text prefix", async () => {
    await database.insert(schema.notes).values([
      note("lib", "Everything under lib is tested beside its module.", "apps/web/lib/**"),
      note("libx", "A folder that merely starts the same.", "apps/web/libx/**"),
    ]);
    const selection = await select({ task: "edit apps/web/lib/select-memory.ts carefully" });
    // Both share the words `apps` and `web`; only one covers the path, and the exact route ranks it first.
    expect(refs(selection)).toEqual(["note:lib", "note:libx"]);
    expect(selection.items[0]).toMatchObject({ matchedPaths: ["apps/web/lib/select-memory.ts"] });
    expect(selection.items[1]).not.toHaveProperty("matchedPaths");
  });

  it("§20.2: N and df count the core too, so a word every awake note carries is worth less than one only a sleeping note has", async () => {
    await database.insert(schema.notes).values([
      note("awake", "Alpha is everywhere in this project.", null),
      note("n1", "Alpha handling for payments.", "a/**"),
      note("n2", "Beta handling for payments.", "b/**"),
    ]);
    const selection = await select({ task: "alpha beta" });
    // Over the sleeping notes alone the two would tie and n1 would come first by id; the awake note makes `alpha` a common word.
    expect(refs(selection)).toEqual(["note:awake", "note:n2", "note:n1"]);
    expect(selection.items[1]!.matched).toEqual(["beta"]);
    expect(selection.items[2]!.matched).toEqual(["alpha"]);
  });

  it("a task of stop words searches and finds nothing, without omissions", async () => {
    await database.insert(schema.notes).values([note("sleeping", "Keep this screen bilingual.", "apps/web/**")]);
    const selection = await select({ task: "the of and para" });
    expect(selection.items).toEqual([]);
    expect(selection.coverage).toMatchObject({ searchComplete: true, candidateCount: 0 });
    expect(selection.omissions).toEqual([]);
  });
});

describe("limits and the continuation (T21)", () => {
  it("cuts the page at the first limit, names it, and continues from a cursor bound to the archive", async () => {
    await database.insert(schema.notes).values([
      note("n1", "Payment retries wait a minute.", "a/**"),
      note("n2", "Payment failures are logged.", "b/**"),
      note("n3", "Payment emails go out nightly.", "c/**"),
      note("n4", "Payment totals are rounded.", "d/**"),
      note("n5", "Payment forms are bilingual.", "e/**"),
    ]);
    const first = await select({ task: "payment", limits: { candidatesPerRoute: 2 } });
    expect(refs(first)).toEqual(["note:n1", "note:n2"]);
    expect(first.coverage).toMatchObject({ searchComplete: false, limitsHit: ["candidates_lexical"], candidateCount: 5 });
    expect(first.continuation).toMatchObject({ audience: "agent", rankingVersion: 1, offset: 2 });
    expect(first.continuation?.query).toMatch(/^[0-9a-f]{64}$/);
    expect(first.continuation?.revisionsFingerprint).toMatch(/^[0-9a-f]{64}$/);

    const second = await select({ task: "payment", limits: { candidatesPerRoute: 2 }, continuation: first.continuation! });
    expect(refs(second)).toEqual(["note:n3", "note:n4"]);
    expect(second.coverage).toMatchObject({ searchComplete: false, requiredComplete: null });
    const third = await select({ task: "payment", limits: { candidatesPerRoute: 2 }, continuation: second.continuation! });
    expect(refs(third)).toEqual(["note:n5"]);
    expect(third.coverage).toMatchObject({ searchComplete: true, limitsHit: [] });
    expect(third.continuation).toBeNull();

    // The union limit too, and one candidate beyond it is what says the page was cut.
    const union = await select({ task: "payment", limits: { unionMax: 4 } });
    expect(union.items).toHaveLength(4);
    expect(union.coverage).toMatchObject({ searchComplete: false, limitsHit: ["union"] });
    const exact = await select({ task: "payment", limits: { unionMax: 5 } });
    expect(exact.items).toHaveLength(5);
    expect(exact.coverage).toMatchObject({ searchComplete: true, limitsHit: [] });
    expect(exact.continuation).toBeNull();
  });

  it("refuses a continuation whose query, audience or archive moved", async () => {
    await database.insert(schema.notes).values([
      note("n1", "Payment retries wait a minute.", "a/**"),
      note("n2", "Payment failures are logged.", "b/**"),
      note("n3", "Payment emails go out nightly.", "c/**"),
    ]);
    const first = await select({ task: "payment", limits: { candidatesPerRoute: 2 } });
    const state = first.continuation!;
    await expect(select({ task: "payment failures", limits: { candidatesPerRoute: 2 }, continuation: state })).rejects.toMatchObject({ name: "MemoryRequestError", code: "stale_cursor" });
    await expect(select({ task: "payment", audience: "hook", limits: { candidatesPerRoute: 2 }, continuation: state })).rejects.toBeInstanceOf(MemoryRequestError);
    await expect(select({ task: "payment", limits: { candidatesPerRoute: 2 }, continuation: { ...state, rankingVersion: 99 } })).rejects.toBeInstanceOf(MemoryRequestError);
    // A revision moved: the archive the cursor was cut from is gone.
    const added = await addHumanNote(database, { projectId: PROJECT.id, body: "Payment notes are approved by the owner.", trigger: "f/**" });
    expect("id" in added).toBe(true);
    await expect(select({ task: "payment", limits: { candidatesPerRoute: 2 }, continuation: state })).rejects.toMatchObject({ code: "stale_cursor" });
  });

  it("stops the page when the relations of the closure would exceed the limit", async () => {
    await saveDecisionEpisodes(database, [
      owner(null, { decision: "Deploy on Tuesdays.", conditions: "When the suite is green.", exceptions: "Hotfixes." }),
      owner(null, { decision: "Deploy from main.", conditions: "After review." }),
      owner(null, { decision: "Deploy with the changelog." }),
    ]);
    const selection = await select({ task: "deploy", limits: { relationsMax: 3 } });
    // Three, two and one relation, in id order: whichever comes first fits alone, the second never does.
    expect(selection.items).toHaveLength(1);
    expect(selection.coverage).toMatchObject({ searchComplete: false, limitsHit: ["relations"], candidateCount: 3 });
    expect(selection.continuation).toMatchObject({ offset: 1 });
    const rest = await select({ task: "deploy", limits: { relationsMax: 3 }, continuation: selection.continuation! });
    expect(rest.items).toHaveLength(1);
    expect(rest.continuation).toMatchObject({ offset: 2 });
  });
});

describe("conditions, exceptions and conflicts (T22, A07/T18)", () => {
  it("T22: a decision with conditions or exceptions is conditional and its text travels whole as pending checks", async () => {
    const exceptions = "Except when the migration touches a table with more than a million rows, or when the owner is away and nobody can restore a backup, or when the change is a pure rename that drizzle would emit as a drop and a create — in each of those cases stop and ask before running anything at all against the catalog.";
    expect(exceptions.length).toBeGreaterThan(240);
    const [row] = await saveDecisionEpisodes(database, [owner(PROJECT.identity, {
      decision: "Run migrations from the CLI, never from a route.", conditions: "Only on the local catalog.", exceptions,
    })]);
    const selection = await select({ task: "run the migrations" });
    expect(selection.items).toHaveLength(1);
    expect(selection.items[0]).toMatchObject({ applicability: "conditional", conditions: "Only on the local catalog.", exceptions, recordedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(selection.checks).toEqual([
      { itemKind: "decision", itemId: row!.id, revision: 1, kind: "narrative_condition", text: "Only on the local catalog." },
      { itemKind: "decision", itemId: row!.id, revision: 1, kind: "narrative_exception", text: exceptions },
    ]);
    expect(selection.status).toBe("requires_check");
  });

  it("two active owner decisions of one family are withheld and exposed as a conflict, never resolved by recency", async () => {
    const [first] = await saveDecisionEpisodes(database, [owner(PROJECT.identity, { decision: "Choose inline editing." })]);
    await saveDecisionEpisodes(database, [{ ...owner(PROJECT.identity, { decision: "Choose a modal." }), supersedesId: first!.id }]);
    await database.execute(`update decision_episodes set status = 'active' where id = '${first!.id}'`);
    const selection = await select({ task: "editing modal inline" });
    expect(selection.items).toEqual([]);
    expect(selection.omissions).toEqual([{ reason: "conflict", count: 1, required: false }]);
    expect(selection.status).toBe("conflict");
  });

  it("an expired or dismissed decision is not a candidate and is not counted", async () => {
    await saveDecisionEpisodes(database, [
      { ...owner(null, { decision: "Freeze deploys until Friday." }), validUntil: at(3) },
      owner(null, { decision: "Freeze the schema for the release." }),
    ]);
    const selection = await select({ task: "freeze" });
    expect(selection.items.map((item) => item.text)).toEqual(["Freeze the schema for the release."]);
    expect(selection.omissions).toEqual([]);
  });
});

describe("withdrawal", () => {
  it("a note under a withdrawal is not delivered and leaves no count behind", async () => {
    const kept = await addHumanNote(database, { projectId: PROJECT.id, body: "Kept and awake." });
    const gone = await addHumanNote(database, { projectId: PROJECT.id, body: "Withdrawn and awake." });
    if (!("id" in kept) || !("id" in gone)) throw new Error("fixture");
    const begun = await beginDeletion(database, home, { operation: "withdraw", targets: [{ kind: "item", itemKind: "note", id: gone.id }], scope: { projectId: PROJECT.id } });
    if ("refused" in begun) throw new Error(begun.reason);
    await runDeletionBatches(database, begun.id);
    const selection = await select();
    expect(selection.items.map((item) => item.text)).toEqual(["Kept and awake."]);
    expect(selection.omissions).toEqual([]);
    expect(selection.snapshot.useGeneration).toBe(begun.sequence);
  });
});

// ── Delivery C ───────────────────────────────────────────────────────────────────────────────

const ENV_A = "a".repeat(64);
const ENV_B = "b".repeat(64);
const CHECK = "chk_selector_applicability_1";
const OTHER_CHECK = "chk_selector_exception_1";
const MINUTE = 60_000;

/** An environment as the evaluator would report it: the id is what matters here, the files are none. */
function environment(environmentId: string, at: Date): Environment {
  return { schemaVersion: 1, environmentId, projectRef: PROJECT.id, resolvedRoot: PROJECT.root, observedAt: at.toISOString(), inspected: [] };
}

/** One look of the patrol at a check of a decision's current photograph, in one environment. */
async function observe(episodeId: string, checkId: string, environmentId: string, result: OutcomeResult, options: { minutesAgo?: number; reason?: string } = {}): Promise<void> {
  const rows = await database.select({ id: schema.decisionEpisodes.id, memoryRev: schema.decisionEpisodes.memoryRev }).from(schema.decisionEpisodes);
  const rev = rows.find((one) => one.id === episodeId)?.memoryRev;
  const photograph = rev === undefined ? undefined : await readRevision(database, "decision", episodeId, rev);
  if (!photograph) throw new Error("fixture: the decision has no photograph");
  const at = new Date(Date.now() - (options.minutesAgo ?? 0) * MINUTE);
  await database.transaction((tx) => recordObservation(tx, {
    projectId: PROJECT.id, subjectRevisionId: photograph.id, checkId, checkRev: 1, environment: environment(environmentId, at), result,
    evidence: { schemaVersion: 1, sourceRefs: [], observedCoverage: { inspected: 1, unknown: result === "unknown" ? 1 : 0 }, deliveredBefore: "unknown", reason: options.reason ?? "fixture" },
    observedAt: at,
  }));
}

const applicabilityCheck = (checkId: string) => ({ checkId, purpose: "applicability", kind: "path_exists", target: "packages/db", expected: true });
const passes = (checkId: string) => ({ schemaVersion: 1, expression: { kind: "check_result_is", checkId, revision: 1, result: "pass" } });

describe("typed conditions in three values (§10.1, §9.1)", () => {
  it("§10.1: a fresh pass applies, a fresh fail is not_applicable, and no observation is requires_check with the check named", async () => {
    const [row] = await saveDecisionEpisodes(database, [{
      ...owner(PROJECT.identity, { decision: "Run the migrations from the CLI." }),
      checks: [applicabilityCheck(CHECK)], conditionsPredicate: passes(CHECK),
    }]);
    const id = row!.id;

    // Nothing observed yet: the rule travels with its gap (§9.1), never dropped and never applied by default.
    const unseen = await select({ task: "migrations" });
    expect(unseen.items).toHaveLength(1);
    expect(unseen.items[0]).toMatchObject({ id, applicability: "conditional" });
    expect(unseen.checks).toEqual([{ itemKind: "decision", itemId: id, revision: 1, kind: "requires_check", text: expect.stringContaining(CHECK) }]);
    expect(unseen.checks[0]!.text).toContain("path_exists packages/db expected true");
    expect(unseen.checks[0]!.text).toContain("no patrol has observed this project yet");
    expect(unseen.status).toBe("requires_check");
    expect(unseen.omissions).toEqual([]);

    await observe(id, CHECK, ENV_A, "pass");
    const applies = await select({ task: "migrations" });
    expect(applies.items[0]).toMatchObject({ id, applicability: "applies" });
    expect(applies.checks).toEqual([]);
    expect(applies.status).toBe("ready");

    await observe(id, CHECK, ENV_A, "fail");
    const excluded = await select({ task: "migrations" });
    expect(excluded.items).toEqual([]);
    expect(excluded.omissions).toEqual([{ reason: "not_applicable", count: 1, required: false }]);
    expect(excluded.status).toBe("ready");

    // A look that ended unknown decides nothing: the unit is conditional again and says why.
    await observe(id, CHECK, ENV_A, "unknown", { reason: "unreadable" });
    const undecided = await select({ task: "migrations" });
    expect(undecided.items[0]).toMatchObject({ id, applicability: "conditional" });
    expect(undecided.checks[0]!.text).toContain("the last observation was unknown (unreadable)");
  });

  it("§9.2: a stale observation makes the unit conditional again, with the check named as stale", async () => {
    const [row] = await saveDecisionEpisodes(database, [{
      ...owner(PROJECT.identity, { decision: "Deploy from main." }), checks: [applicabilityCheck(CHECK)], conditionsPredicate: passes(CHECK),
    }]);
    await observe(row!.id, CHECK, ENV_A, "pass", { minutesAgo: 11 });
    const selection = await select({ task: "deploy" });
    expect(selection.items[0]).toMatchObject({ id: row!.id, applicability: "conditional" });
    expect(selection.checks).toEqual([expect.objectContaining({ kind: "requires_check", text: expect.stringContaining("the last observation is stale") })]);
    expect(selection.status).toBe("requires_check");
    // A fresh look settles it again.
    await observe(row!.id, CHECK, ENV_A, "pass");
    expect((await select({ task: "deploy" })).status).toBe("ready");
  });

  it("C03/T48: verification never transfers between environments; the environment is the last one the patrol observed", async () => {
    const [first, second] = await saveDecisionEpisodes(database, [
      { ...owner(PROJECT.identity, { decision: "Verified in the first worktree." }), checks: [applicabilityCheck(CHECK)], conditionsPredicate: passes(CHECK) },
      { ...owner(PROJECT.identity, { decision: "Verified in the second worktree." }), checks: [applicabilityCheck(OTHER_CHECK)], conditionsPredicate: passes(OTHER_CHECK) },
    ]);
    await observe(first!.id, CHECK, ENV_A, "pass");
    expect((await select({ task: "worktree" })).items.find((item) => item.id === first!.id)).toMatchObject({ applicability: "applies" });

    // The patrol runs again elsewhere: the newest outcome names the second environment.
    await observe(second!.id, OTHER_CHECK, ENV_B, "pass");
    const moved = await select({ task: "worktree" });
    expect(moved.items.find((item) => item.id === second!.id)).toMatchObject({ applicability: "applies" });
    expect(moved.items.find((item) => item.id === first!.id)).toMatchObject({ applicability: "conditional" });
    expect(moved.checks).toEqual([expect.objectContaining({ itemId: first!.id, text: expect.stringContaining("not observed in the current environment") })]);
    // Told the environment explicitly, the selector judges in that one.
    const pinned = await select({ task: "worktree", environmentId: ENV_A });
    expect(pinned.items.find((item) => item.id === first!.id)).toMatchObject({ applicability: "applies" });
    expect(pinned.items.find((item) => item.id === second!.id)).toMatchObject({ applicability: "conditional" });
  });

  it("§10.1: an unknown decisive exception requires checking; a false condition settles it without asking", async () => {
    const [row] = await saveDecisionEpisodes(database, [{
      ...owner(PROJECT.identity, { decision: "Deploy on Tuesdays." }),
      checks: [applicabilityCheck(OTHER_CHECK)],
      conditionsPredicate: { schemaVersion: 1, expression: { kind: "operation_is", operation: "deploy" } },
      exceptionsPredicate: passes(OTHER_CHECK),
    }]);
    const asked = await select({ task: "deploy", operation: "deploy" });
    expect(asked.items[0]).toMatchObject({ id: row!.id, applicability: "conditional" });
    expect(asked.checks).toEqual([expect.objectContaining({ kind: "requires_check", text: expect.stringContaining(OTHER_CHECK) })]);
    expect(asked.status).toBe("requires_check");

    const settled = await select({ task: "deploy", operation: "edit" });
    expect(settled.items).toEqual([]);
    expect(settled.omissions).toEqual([{ reason: "not_applicable", count: 1, required: false }]);

    // The exception seen true keeps the unit out; seen false, the unit applies.
    await observe(row!.id, OTHER_CHECK, ENV_A, "pass");
    expect((await select({ task: "deploy", operation: "deploy" })).omissions).toEqual([{ reason: "not_applicable", count: 1, required: false }]);
    await observe(row!.id, OTHER_CHECK, ENV_A, "fail");
    expect((await select({ task: "deploy", operation: "deploy" })).items[0]).toMatchObject({ applicability: "applies" });
  });

  it("an undeclared fact is unknown, never false: operation, path and task label travel only when the request states them", async () => {
    const [row] = await saveDecisionEpisodes(database, [{
      ...owner(PROJECT.identity, { decision: "Keep the screen bilingual while releasing.", conditions: "Only while a release is being cut." }),
      conditionsPredicate: { schemaVersion: 1, expression: { all: [
        { kind: "operation_is", operation: "edit" }, { kind: "path_under", path: "apps/web" }, { kind: "task_kind_is", taskKind: "release" },
      ] } },
    }]);
    const undeclared = await select({ task: "bilingual" });
    expect(undeclared.items[0]).toMatchObject({ id: row!.id, applicability: "conditional" });
    expect(undeclared.checks.map((check) => check.kind)).toEqual(["narrative_condition", "requires_check"]);
    expect(undeclared.checks[1]!.text).toBe("the conditions depend on facts this request did not declare: operation, path, task kind");

    // Every fact declared and matching: the predicate holds, and the narrative stays the owner's to resolve.
    const held = await select({ task: "kind:release polish the bilingual screen", operation: "edit", path: "apps/web/lib/i18n.ts" });
    expect(held.items[0]).toMatchObject({ applicability: "conditional", conditions: "Only while a release is being cut." });
    expect(held.checks.map((check) => check.kind)).toEqual(["narrative_condition"]);

    const elsewhere = await select({ task: "kind:release polish the bilingual screen", operation: "edit", path: "apps/cli/src/index.ts" });
    expect(elsewhere.items).toEqual([]);
    expect(elsewhere.omissions).toEqual([{ reason: "not_applicable", count: 1, required: false }]);
    expect(taskKindOf("kind:release polish")).toBe("release");
    expect(taskKindOf("unkind:release")).toBeUndefined();
    expect(taskKindOf("kind:Big")).toBeUndefined();
  });
});

describe("supersession and expiry of notes (T52)", () => {
  it("T52: a superseded note is not eligible, its successor names it, and an expired note is not eligible either", async () => {
    const predecessor = await addHumanNote(database, { projectId: PROJECT.id, body: "Run the guard tests first." });
    const proposed = await proposeNote(database, { projectId: PROJECT.id, body: "Run the guard tests, then the whole suite.", createdBy: "claude" });
    if (!("id" in predecessor) || !("id" in proposed)) throw new Error("fixture");
    expect(await decideNote(database, proposed.id, "approved", { supersedesId: predecessor.id, expectedPredecessorRev: 1 })).toMatchObject({ decided: true });

    const selection = await select();
    expect(refs(selection)).toEqual([`note:${proposed.id}`]);
    expect(selection.items[0]).toMatchObject({ supersedesId: predecessor.id, authority: "owner_confirmation" });
    expect(selection.omissions).toEqual([]);

    const expiring = await addHumanNote(database, { projectId: PROJECT.id, body: "Freeze deploys until Friday." });
    if (!("id" in expiring)) throw new Error("fixture");
    expect(await setValidUntil(database, expiring.id, { memoryRev: 1 }, new Date(Date.now() - MINUTE))).toEqual({ revision: 2 });
    const later = await select();
    expect(refs(later)).toEqual([`note:${proposed.id}`]);
    expect(later.omissions).toEqual([]);
  });
});

describe("withdrawal and dependency groups (T53)", () => {
  const revisionOf = async (noteId: string, rev: number) => {
    const row = await readRevision(database, "note", noteId, rev);
    if (!row) throw new Error("fixture: no photograph");
    return row.id;
  };

  it("T53: later support or a changed expiry cannot rescue a dependent revision; a new owner instruction can", async () => {
    const input = await addHumanNote(database, { projectId: PROJECT.id, body: "The source the summary was made from." });
    const derived = await addHumanNote(database, { projectId: PROJECT.id, body: "A summary derived from the source." });
    if (!("id" in input) || !("id" in derived)) throw new Error("fixture");
    const derivedRev1 = await revisionOf(derived.id, 1);
    const inputRev1 = await revisionOf(input.id, 1);
    await database.transaction((tx) => addDependencies(tx, [{ dependent: { revisionId: derivedRev1 }, input: { revisionId: inputRev1 }, relation: "derived_from" }]));

    const begun = await beginDeletion(database, home, { operation: "withdraw", targets: [{ kind: "item", itemKind: "note", id: input.id }], scope: { projectId: PROJECT.id } });
    if ("refused" in begun) throw new Error(begun.reason);
    await runDeletionBatches(database, begun.id);
    expect(refs(await select())).toEqual([]);

    // Support arrives afterwards, as an alternative group: the blocked revision stays blocked (plan §11.2).
    const support = await addHumanNote(database, { projectId: PROJECT.id, body: "Independent support that arrived later." });
    if (!("id" in support)) throw new Error("fixture");
    const supportRev1 = await revisionOf(support.id, 1);
    await database.transaction((tx) => addDependencies(tx, [
      { dependent: { revisionId: derivedRev1 }, input: { revisionId: supportRev1 }, relation: "supported_by", groupNo: 1, groupMode: "any" },
    ]));
    const rescued = await select();
    expect(refs(rescued)).toEqual([`note:${support.id}`]);
    expect(rescued.omissions).toEqual([]);

    // Changing the expiry copies the old statement; it is not an independent owner instruction.
    expect(await setValidUntil(database, derived.id, { memoryRev: 1 }, new Date(Date.now() + 30 * MINUTE))).toEqual({ revision: 2 });
    const derivedRev2 = await revisionOf(derived.id, 2);
    await database.transaction((tx) => addDependencies(tx, [{ dependent: { revisionId: derivedRev2 }, input: { revisionId: supportRev1 }, relation: "derived_from" }]));
    expect(refs(await select())).toEqual([`note:${support.id}`]);
    const independent = await addHumanNote(database, { projectId: PROJECT.id, body: "A newly authored instruction grounded in the surviving support." });
    if (!("id" in independent)) throw new Error("fixture");
    const independentRev = await revisionOf(independent.id, 1);
    await database.transaction((tx) => addDependencies(tx, [{ dependent: { revisionId: independentRev }, input: { revisionId: supportRev1 }, relation: "derived_from" }]));
    const rebuilt = await select();
    expect(new Set(refs(rebuilt))).toEqual(new Set([`note:${independent.id}`, `note:${support.id}`]));
  });
});

// ── Delivery D ───────────────────────────────────────────────────────────────────────────────

const CRITERION_CHECK = "chk_selector_criterion_1";
const CANARY_QUOTE = "CANARY-quote: the owner said so in src/private/secret-path.ts of the other repository";
const CANARY_PROJECT = "CANARY-Other-Project-Name";

/**
 * The typed columns of delivery D, written as the catalog's writers will store them: the
 * envelope of the validator in `conditions` and `exceptions`, the checks beside them. The db
 * writers that accept them are another engineer's; the selector reads the columns.
 */
async function withPredicates(id: string, columns: { conditions?: object | null; exceptions?: object | null; checks?: object[] }): Promise<void> {
  const json = (value: object | null | undefined) => value ? `'${JSON.stringify(value)}'::jsonb` : "null";
  const checks = columns.checks ? `'${JSON.stringify(columns.checks)}'::jsonb` : "'[]'::jsonb";
  await database.execute(`update beliefs set conditions = ${json(columns.conditions)}, exceptions = ${json(columns.exceptions)}, checks = ${checks} where id = '${id}'`);
}

/** One look of the patrol at a check of a criterion's current photograph, in one environment. */
async function observeCriterion(id: string, checkId: string, environmentId: string, result: OutcomeResult, options: { minutesAgo?: number; reason?: string } = {}): Promise<void> {
  const rev = (await listBeliefs(database)).find((row) => row.id === id)?.memoryRev;
  const photograph = rev === undefined ? undefined : await readRevision(database, "criterion", id, rev);
  if (!photograph) throw new Error("fixture: the criterion has no photograph");
  const at = new Date(Date.now() - (options.minutesAgo ?? 0) * MINUTE);
  await database.transaction((tx) => recordObservation(tx, {
    projectId: PROJECT.id, subjectRevisionId: photograph.id, checkId, checkRev: 1, environment: environment(environmentId, at), result,
    evidence: { schemaVersion: 1, sourceRefs: [], observedCoverage: { inspected: 1, unknown: result === "unknown" ? 1 : 0 }, deliveredBefore: "unknown", reason: options.reason ?? "fixture" },
    observedAt: at,
  }));
}

const operationIs = (operation: string) => ({ schemaVersion: 1, expression: { kind: "operation_is", operation } });
/** A check as the catalog stores it once `putCheck` assigned its id and revision: the shape the selector reads from the column. */
const storedCheck = (checkId: string) => ({ schemaVersion: 1, revision: 1, ...applicabilityCheck(checkId) });

describe("a criterion under conditions and exceptions (delivery D: §10.1, §10.3, §10.4)", () => {
  it("§10.1: true conditions and false exceptions apply; a false condition is not_applicable; an unknown decisive exception is requires_check with the check named — and the sentences travel inside the unit", async () => {
    const id = await coreBelief("Prefer direct actions in forms.");
    const plain = await coreBelief("Keep the number at the end.");
    await withPredicates(id, { conditions: operationIs("edit"), exceptions: passes(CRITERION_CHECK), checks: [storedCheck(CRITERION_CHECK)] });

    // Nothing observed: the exception is undecided, and the criterion travels conditional with the check it needs, still core, still required (§9.1).
    const unseen = await select({ operation: "edit" });
    expect(new Set(refs(unseen))).toEqual(new Set([`criterion:${plain}`, `criterion:${id}`]));
    const unit = unseen.items.find((item) => item.id === id)!;
    expect(unit).toMatchObject({ applicability: "conditional", deliveryMode: "core", appliesWhen: "the operation is edit", exceptWhen: `check ${CRITERION_CHECK} r1 is pass` });
    expect(unseen.required.has(`criterion:${id}`)).toBe(true);
    expect(unseen.checks).toEqual([{ itemKind: "criterion", itemId: id, revision: 1, kind: "requires_check", text: expect.stringContaining(CRITERION_CHECK) }]);
    expect(unseen.checks[0]!.text).toContain("path_exists packages/db expected true");
    expect(unseen.checks[0]!.text).toContain("no patrol has observed this project yet");
    expect(unseen.status).toBe("requires_check");
    expect(unseen.omissions).toEqual([]);
    expect(unseen.notApplicable).toEqual([]);
    // The legacy criterion beside it is served exactly as before: no predicate, nothing judged, nothing rendered.
    const legacy = unseen.items.find((item) => item.id === plain)!;
    expect(legacy).toMatchObject({ applicability: "applies" });
    expect(legacy).not.toHaveProperty("appliesWhen");
    expect(legacy).not.toHaveProperty("exceptWhen");

    // The exception seen false: conditions true, exceptions false → applies, and the sentences still travel.
    await observeCriterion(id, CRITERION_CHECK, ENV_A, "fail");
    const applies = await select({ operation: "edit" });
    expect(applies.items.find((item) => item.id === id)).toMatchObject({ applicability: "applies", appliesWhen: "the operation is edit", exceptWhen: `check ${CRITERION_CHECK} r1 is pass` });
    expect(applies.checks).toEqual([]);
    expect(applies.status).toBe("ready");

    // A false condition settles without asking anything of the exception.
    const settled = await select({ operation: "deploy" });
    expect(refs(settled)).toEqual([`criterion:${plain}`]);
    expect(settled.omissions).toEqual([{ reason: "not_applicable", count: 1, required: false }]);
    expect(settled.notApplicable).toEqual([{ kind: "criterion", id, rev: 1 }]);
    expect(settled.status).toBe("ready");
    expect(settled.coverage.requiredComplete).toBe(true);

    // An undeclared fact is unknown, never false: the brief without an operation asks for it.
    const undeclared = await select();
    expect(undeclared.items.find((item) => item.id === id)).toMatchObject({ applicability: "conditional" });
    expect(undeclared.checks).toEqual([expect.objectContaining({ itemKind: "criterion", itemId: id, kind: "requires_check", text: "the conditions depend on facts this request did not declare: operation" })]);

    // The exception seen true keeps the criterion out, whole: never the statement without its «except when».
    await observeCriterion(id, CRITERION_CHECK, ENV_A, "pass");
    const excepted = await select({ operation: "edit" });
    expect(refs(excepted)).toEqual([`criterion:${plain}`]);
    expect(excepted.omissions).toEqual([{ reason: "not_applicable", count: 1, required: false }]);
    expect(JSON.stringify(excepted)).not.toContain("Prefer direct actions");
  });

  it("§9.2: a stale observation makes a criterion conditional again, with the check named as stale; a look that ended unknown decides nothing", async () => {
    const id = await coreBelief("Run the migrations from the CLI.");
    await withPredicates(id, { conditions: passes(CRITERION_CHECK), checks: [storedCheck(CRITERION_CHECK)] });
    await observeCriterion(id, CRITERION_CHECK, ENV_A, "pass", { minutesAgo: 11 });
    const stale = await select();
    expect(stale.items[0]).toMatchObject({ id, applicability: "conditional", appliesWhen: `check ${CRITERION_CHECK} r1 is pass` });
    expect(stale.checks).toEqual([expect.objectContaining({ itemKind: "criterion", kind: "requires_check", text: expect.stringContaining("the last observation is stale") })]);
    expect(stale.status).toBe("requires_check");

    await observeCriterion(id, CRITERION_CHECK, ENV_A, "pass");
    const fresh = await select();
    expect(fresh.items[0]).toMatchObject({ id, applicability: "applies" });
    expect(fresh.status).toBe("ready");

    await observeCriterion(id, CRITERION_CHECK, ENV_A, "unknown", { reason: "unreadable" });
    const undecided = await select();
    expect(undecided.items[0]).toMatchObject({ id, applicability: "conditional" });
    expect(undecided.checks[0]!.text).toContain("the last observation was unknown (unreadable)");

    // A fresh fail of the condition: out, whole.
    await observeCriterion(id, CRITERION_CHECK, ENV_A, "fail");
    const out = await select();
    expect(out.items).toEqual([]);
    expect(out.omissions).toEqual([{ reason: "not_applicable", count: 1, required: false }]);
    // Verification never transfers between environments (C03/T48): judged in another one, the pass of this one decides nothing.
    const elsewhere = await select({ environmentId: ENV_B });
    expect(elsewhere.items[0]).toMatchObject({ id, applicability: "conditional" });
    expect(elsewhere.checks[0]!.text).toContain("not observed in the current environment");
  });

  it("§20.2: the sentences are part of the text a task reaches for, and the relations of the closure count them", async () => {
    const [id] = await insertBeliefs(database, [belief("Confirm before running anything against the catalog.")]);
    await withPredicates(id!, {
      conditions: { schemaVersion: 1, expression: { kind: "task_kind_is", taskKind: "migration" } },
      exceptions: { schemaVersion: 1, expression: { any: [{ kind: "path_under", path: "apps/site" }, { kind: "operation_is", operation: "review" }] } },
    });
    const found = await select({ task: "kind:migration touch the site" });
    expect(found.items).toEqual([expect.objectContaining({
      id, applicability: "conditional", appliesWhen: "the task kind is migration", exceptWhen: "(the path is under apps/site or the operation is review)", matched: ["kind", "migration", "site"],
    })]);
    expect(found.checks[0]!.text).toBe("the conditions depend on facts this request did not declare: path, operation");
    // Two relations: with a limit of one the page stops before the criterion and says why.
    const cut = await select({ task: "kind:migration touch the site", limits: { relationsMax: 1 } });
    expect(cut.items).toEqual([]);
    expect(cut.coverage).toMatchObject({ searchComplete: false, limitsHit: ["relations"], candidateCount: 1 });
  });

  it("D08/§10.3: a criterion born private and widened by a scope gesture reaches another project with its statement, conditions and exceptions, and never with its evidence; an unresolved identity still blocks it", async () => {
    const cite = { verdictId: "v_canary", observationId: "obs_canary", quote: CANARY_QUOTE, at: "2026-09-01T00:00:00.000Z", project: CANARY_PROJECT };
    const [id] = await insertBeliefs(database, [belief("Prefer direct actions in forms.", { identity: OTHER.identity, citations: [cite], model: "CANARY-model" })]);
    await withPredicates(id!, { conditions: operationIs("edit"), exceptions: { schemaVersion: 1, expression: { kind: "path_under", path: "apps/web/app/irreversible" } } });
    // Private: served in its own project with its name, nowhere else.
    const home = await select({ project: OTHER, task: "forms", operation: "edit" });
    expect(home.items).toEqual([expect.objectContaining({ id, scope: "project", scopeName: OTHER.name, appliesWhen: "the operation is edit", exceptWhen: "the path is under apps/web/app/irreversible" })]);
    expect((await select({ task: "forms", operation: "edit" })).items).toEqual([]);

    // The owner widens it: the abstraction travels, with its conditions and exceptions, to this project.
    expect(await setBeliefScope(database, id!, null)).toBe(true);
    const transferred = await select({ task: "forms", operation: "edit" });
    expect(transferred.items).toEqual([expect.objectContaining({
      id, revision: 2, scope: "global", authority: "owner_instruction", applicability: "conditional",
      text: "Prefer direct actions in forms.", appliesWhen: "the operation is edit", exceptWhen: "the path is under apps/web/app/irreversible",
    })]);
    expect(transferred.items[0]).not.toHaveProperty("scopeName");
    expect(transferred.checks).toEqual([expect.objectContaining({ itemKind: "criterion", itemId: id, kind: "requires_check", text: expect.stringContaining("path") })]);
    // Nothing of the evidence: the whole selection, serialized, carries no quote, no path, no name, no model of the source.
    const serialized = JSON.stringify(transferred);
    expect(serialized).not.toContain("CANARY");
    expect(serialized).not.toContain("secret-path");
    expect(serialized).not.toContain(OTHER.name);
    expect(serialized).not.toContain(OTHER.identity);
    // On the signal, with the path declared under the exception, the transferred rule is out whole.
    const excepted = await select({ task: "forms", operation: "edit", path: "apps/web/app/irreversible/delete.tsx" });
    expect(excepted.items).toEqual([]);
    expect(excepted.omissions).toEqual([{ reason: "not_applicable", count: 1, required: false }]);

    // An identity nobody can resolve blocks the transfer, predicates or not (A05/T23).
    await database.execute(`update beliefs set scope_kind = 'unresolved' where id = '${id}'`);
    const blocked = await select({ task: "forms", operation: "edit" });
    expect(blocked.items).toEqual([]);
    expect(blocked.omissions).toEqual([{ reason: "unresolved_scope", count: 1, required: false }]);
  });

  it("predicateSentence renders the same closed sentences as renderPredicate of core: leaves, operators, groups only when plural", () => {
    expect(predicateSentence({ not: { any: [{ kind: "path_under", path: "apps/web" }, { kind: "task_kind_is", taskKind: "release" }] } }))
      .toBe("not (the path is under apps/web or the task kind is release)");
    expect(predicateSentence({ all: [{ kind: "check_result_is", checkId: CRITERION_CHECK, revision: 2, result: "fail" }] })).toBe(`check ${CRITERION_CHECK} r2 is fail`);
    expect(predicateSentence({ kind: "environment_is", environmentId: ENV_A })).toBe(`the environment is ${"a".repeat(12)}…`);
    expect(predicateSentence({ kind: "project_is", projectId: "prj_1" })).toBe("the project is prj_1");
    expect(predicateSentence({ all: [{ kind: "operation_is", operation: "edit" }, { not: { any: [{ kind: "path_under", path: "apps/site" }, { kind: "operation_is", operation: "deploy" }] } }] }))
      .toBe("(the operation is edit and not (the path is under apps/site or the operation is deploy))");
  });
});
