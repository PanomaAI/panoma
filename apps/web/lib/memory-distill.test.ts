import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@panoma/db";

/**
 * Only the model is stubbed: it costs money and answers however it wants. The database is real
 * PGlite, because half of the distiller consists of brakes made with queries — today's spending,
 * full queue, dedupe — and that half is the one that has to be tested.
 */
const completeMock = vi.fn();
vi.mock("@panoma/ai", () => ({ complete: (...args: unknown[]) => completeMock(...args) }));

const { buildDistillPrompt, byOwnerDecision, distillSession, parseCandidates, whereToTrigger, DISTILL_KIND } =
  await import("./memory-distill");
const { listProjectNotes, logActivity, modelSpendToday, openSession, proposeNote } = await import(
  "@panoma/db"
);

let home: string;
let db: Database;
let close: () => Promise<void>;
const original = process.env["PANOMA_HOME"];
const originalQuota = { catalog: process.env["PANOMA_MEMORY_QUOTA_MB"], project: process.env["PANOMA_PROJECT_QUOTA_MB"] };

const PROJECT = "proj-distill-test";

function answer(text: string) {
  return { text, provider: "anthropic", model: "claude-sonnet-5", usage: { input: 100, output: 20 } };
}

async function sessionWith(lines: string[]): Promise<string> {
  const sessionId = await openSession(db, "ag-d", PROJECT);
  for (const summary of lines) {
    await logActivity(db, { agentId: "ag-d", projectId: PROJECT, sessionId, kind: "change", summary });
  }
  return sessionId;
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-distill-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db, close } = await openDatabase());
  const { schema: t } = await import("@panoma/db");
  await db.insert(t.projects).values({ id: PROJECT, slug: "distill-test", name: "distill-test", root: "/tmp/distill-test" });
  await db.insert(t.agents).values({ id: "ag-d", name: "claude", apiKeyHash: "h-distill" });
});

afterAll(async () => {
  await close();
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  if (originalQuota.catalog === undefined) delete process.env["PANOMA_MEMORY_QUOTA_MB"]; else process.env["PANOMA_MEMORY_QUOTA_MB"] = originalQuota.catalog;
  if (originalQuota.project === undefined) delete process.env["PANOMA_PROJECT_QUOTA_MB"]; else process.env["PANOMA_PROJECT_QUOTA_MB"] = originalQuota.project;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  completeMock.mockReset();
  const { schema: t } = await import("@panoma/db");
  await db.delete(t.notes);
  await db.delete(t.modelCalls);
  await db.delete(t.agentActivities);
  await db.delete(t.agentSessions);
  await db.delete(t.memoryUsage);
  delete process.env["PANOMA_DISTILL_BUDGET"];
  delete process.env["PANOMA_MEMORY_QUOTA_MB"];
  delete process.env["PANOMA_PROJECT_QUOTA_MB"];
});

describe("legacy session jobs keep paid work through a storage or publication delay", () => {
  async function claimed() {
    const { closeSession, enqueueMemoryJob, claimMemoryJob } = await import("@panoma/db");
    const sessionId = await sessionWith(["Investigate the build.", "Verified the required procedure."]);
    await closeSession(db, sessionId);
    await enqueueMemoryJob(db, sessionId);
    const claim = (await claimMemoryJob(db, { now: new Date(Date.now() + 1000) }))!;
    const input = { projectId: PROJECT, identity: null, sessionId };
    const ownership = { leaseToken: claim.leaseToken, jobId: claim.id, attempts: claim.attempts, origin: "automatic" as const, isActive: () => true };
    return { input, ownership, claim };
  }

  async function retry(first: Awaited<ReturnType<typeof claimed>>, reason: string) {
    const { finishMemoryJob, claimMemoryJob } = await import("@panoma/db");
    await finishMemoryJob(db, first.input.sessionId, first.ownership.leaseToken, { status: "deferred", reason, consumeAttempt: false, runAfter: new Date(0) });
    const claim = (await claimMemoryJob(db, { now: new Date(Date.now() + 1000) }))!;
    return { ...first.ownership, leaseToken: claim.leaseToken, attempts: claim.attempts };
  }

  it("reserves before payment, rolls back an over-quota commit and later publishes the saved result exactly once", async () => {
    const { chargeUsage, creditUsage, jobById, usageOf, usageBytesOf, schema: t } = await import("@panoma/db");
    process.env["PANOMA_MEMORY_QUOTA_MB"] = "1";
    process.env["PANOMA_PROJECT_QUOTA_MB"] = "1";
    const work = await claimed();
    completeMock.mockImplementationOnce(async () => {
      expect((await jobById(db, work.claim.id))!.storageReservedBytes).toBeGreaterThan(0);
      await chargeUsage(db, { projectId: PROJECT, bytes: 1024 * 1024, origin: "human" });
      return answer('["Build packages before testing."]');
    });
    expect(await distillSession(db, work.input, work.ownership)).toMatchObject({ did: "quota" });
    expect(await listProjectNotes(db, PROJECT, ["proposed"])).toHaveLength(0);
    expect((await jobById(db, work.claim.id))!.stagedOutput).not.toBeNull();
    await creditUsage(db, { projectId: PROJECT, bytes: 1024 * 1024 });
    const ownership = await retry(work, "quota");
    expect(await distillSession(db, work.input, ownership)).toMatchObject({ did: "distilled", proposed: 1, calls: 1 });
    expect(completeMock).toHaveBeenCalledTimes(1);
    const [note] = await listProjectNotes(db, PROJECT, ["proposed"]);
    const revision = (await db.select().from(t.memoryRevisions)).find((row) => row.objectId === note!.id);
    expect(await usageOf(db)).toEqual({ catalog: usageBytesOf(revision!.payload), projects: { [PROJECT]: usageBytesOf(revision!.payload) } });
    expect(await jobById(db, work.claim.id)).toMatchObject({ status: "complete", stagedOutput: null, storageReservedBytes: 0 });
    const { finishMemoryJob, claimMemoryJob } = await import("@panoma/db");
    expect(await finishMemoryJob(db, work.input.sessionId, ownership.leaseToken, { status: "complete" })).toBe(false);
    expect(await claimMemoryJob(db)).toBeUndefined();
    expect((await usageOf(db)).catalog).toBe(usageBytesOf(revision!.payload));
  });

  it("refuses a new automatic call when its durable answer reservation cannot fit", async () => {
    const { chargeUsage, jobById, reservationsForJob } = await import("@panoma/db");
    process.env["PANOMA_MEMORY_QUOTA_MB"] = "1";
    const work = await claimed();
    await chargeUsage(db, { projectId: PROJECT, bytes: 1024 * 1024 - 100, origin: "human" });
    expect(await distillSession(db, work.input, work.ownership)).toEqual({ did: "quota" });
    expect(completeMock).not.toHaveBeenCalled();
    expect(await reservationsForJob(db, work.claim.id)).toHaveLength(0);
    expect((await jobById(db, work.claim.id))!.storageReservedBytes).toBe(0);
  });

  it("reuses a paid answer after the review queue fills during extraction", async () => {
    const { decideNote, jobById } = await import("@panoma/db");
    const work = await claimed();
    completeMock.mockImplementationOnce(async () => {
      for (let index = 0; index < 20; index++) await proposeNote(db, { projectId: PROJECT, body: `Concurrent proposal ${index}.`, createdBy: "agent" });
      return answer('["Build packages before testing."]');
    });
    expect(await distillSession(db, work.input, work.ownership)).toMatchObject({ did: "queueFull" });
    expect((await jobById(db, work.claim.id))!.stagedOutput).not.toBeNull();
    const [first] = await listProjectNotes(db, PROJECT, ["proposed"]);
    await decideNote(db, first!.id, "discarded");
    expect(await distillSession(db, work.input, await retry(work, "queueFull"))).toMatchObject({ did: "distilled", proposed: 1, calls: 1 });
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("keeps an answer after lease expiry but lets only a new claim publish it", async () => {
    const { schema: t, claimMemoryJob, jobById } = await import("@panoma/db");
    const work = await claimed();
    completeMock.mockImplementationOnce(async () => {
      await db.update(t.memoryJobs).set({ leaseUntil: new Date(0) });
      return answer('["The recovered answer is still useful."]');
    });
    await expect(distillSession(db, work.input, work.ownership)).rejects.toMatchObject({ name: "DistillPublishError" });
    expect(await listProjectNotes(db, PROJECT, ["proposed"])).toHaveLength(0);
    expect((await jobById(db, work.claim.id))!.stagedOutput).not.toBeNull();
    const claim = (await claimMemoryJob(db))!;
    expect(await distillSession(db, work.input, { ...work.ownership, leaseToken: claim.leaseToken, attempts: claim.attempts })).toMatchObject({ did: "distilled", proposed: 1 });
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("does not pay from an already expired claim", async () => {
    const { schema: t, reservationsForJob } = await import("@panoma/db");
    const work = await claimed();
    await db.update(t.memoryJobs).set({ leaseUntil: new Date(0) });
    await expect(distillSession(db, work.input, work.ownership)).rejects.toThrow("lease");
    expect(completeMock).not.toHaveBeenCalled();
    expect(await reservationsForJob(db, work.claim.id)).toHaveLength(0);
  });

  it("does not restage a model answer after its job was cancelled", async () => {
    const { cancelJob, jobById, usageOf } = await import("@panoma/db");
    const work = await claimed();
    completeMock.mockImplementationOnce(async () => {
      const row = (await jobById(db, work.claim.id))!;
      await cancelJob(db, row.id, { rev: row.rev });
      return answer('["Cancelled output must not return."]');
    });
    await expect(distillSession(db, work.input, work.ownership)).rejects.toMatchObject({ name: "DistillPublishError" });
    expect(await listProjectNotes(db, PROJECT, ["proposed"])).toHaveLength(0);
    expect(await jobById(db, work.claim.id)).toMatchObject({ status: "cancelled", stagedOutput: null, storageReservedBytes: 0 });
    expect((await usageOf(db)).catalog).toBe(0);
  });

  it("a purge of an input note fences the in-flight legacy job before its answer can be staged", async () => {
    const { beginDeletion, runDeletionBatches, jobById } = await import("@panoma/db");
    const source = await proposeNote(db, { projectId: PROJECT, body: "A private input instruction.", createdBy: "agent" });
    if (!("id" in source)) throw new Error("Fixture proposal refused.");
    const work = await claimed();
    completeMock.mockImplementationOnce(async () => {
      const deletion = await beginDeletion(db, home, { operation: "purge", targets: [{ kind: "item", itemKind: "note", id: source.id }], scope: {} }, { intentId: "purge_legacy_input" });
      if ("refused" in deletion) throw new Error("Fixture purge refused.");
      await runDeletionBatches(db, deletion.id);
      return answer('["A private derived instruction must disappear."]');
    });
    await expect(distillSession(db, work.input, work.ownership)).rejects.toThrow();
    expect(await jobById(db, work.claim.id)).toMatchObject({ status: "obsolete", stagedOutput: null, storageReservedBytes: 0 });
    expect(await listProjectNotes(db, PROJECT, ["proposed"])).toHaveLength(0);
    expect(completeMock).toHaveBeenCalledTimes(1);
  });
});

describe("los frenos gratis van antes que el caro", () => {
  it("una sesión sin sustancia no paga llamada", async () => {
    const sessionId = await sessionWith(["solo una línea"]);
    expect(await distillSession(db, { projectId: PROJECT, identity: null, sessionId })).toEqual({
      did: "thin",
    });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("con la cola de revisión llena tampoco: las propuestas se rechazarían igual", async () => {
    for (let i = 0; i < 20; i++) {
      await proposeNote(db, { projectId: PROJECT, body: `pendiente ${i}`, createdBy: "claude" });
    }
    const sessionId = await sessionWith(["descubrí algo", "y algo más"]);
    expect(await distillSession(db, { projectId: PROJECT, identity: null, sessionId })).toEqual({
      did: "queueFull",
    });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("y el libro de gasto corta el día: presupuesto 0 significa apagado", async () => {
    process.env["PANOMA_DISTILL_BUDGET"] = "0";
    const sessionId = await sessionWith(["descubrí algo", "y algo más"]);
    expect(await distillSession(db, { projectId: PROJECT, identity: null, sessionId })).toEqual({
      did: "budget",
    });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("T39: the storage quota is answered before the journal is read — the project's own limit, or the catalog's — and nothing is paid", async () => {
    const sessionId = await sessionWith(["descubrí algo", "y algo más"]);
    const scope = (exceeded: boolean) => ({ bytes: exceeded ? 1 : 0, limit: 1, exceeded });
    const limits = { catalogBytes: 1, projectBytes: 1, source: "factory" as const, sources: { catalog: "factory" as const, project: "factory" as const } };
    const at = new Date().toISOString();
    const projectFull = { catalog: scope(false), projects: { [PROJECT]: scope(true) }, paused: false, limits, at };
    expect(await distillSession(db, { projectId: PROJECT, identity: null, sessionId }, undefined, { quota: projectFull })).toEqual({ did: "quota" });
    const catalogFull = { catalog: scope(true), projects: {}, paused: true, limits, at };
    expect(await distillSession(db, { projectId: PROJECT, identity: null, sessionId }, undefined, { quota: catalogFull })).toEqual({ did: "quota" });
    expect(completeMock).not.toHaveBeenCalled();
    // Another project at its limit is not this one's business: the call goes out.
    completeMock.mockResolvedValue(answer("[]"));
    const elsewhere = { catalog: scope(false), projects: { "proj-elsewhere": scope(true) }, paused: false, limits, at };
    expect(await distillSession(db, { projectId: PROJECT, identity: null, sessionId }, undefined, { quota: elsewhere })).toMatchObject({ did: "distilled" });
    expect(completeMock).toHaveBeenCalledTimes(1);
  });
});

describe("destilar", () => {
  it("propone lo que el modelo saque, como distiller y SIN aprobar: la compuerta sigue", async () => {
    completeMock.mockResolvedValue(answer('["Los tests exigen build antes en árbol frío."]'));
    const sessionId = await sessionWith(["tests fallaban en frío", "build primero lo arregló"]);

    const receipt = await distillSession(db, { projectId: PROJECT, identity: "id-x", sessionId });
    expect(receipt).toMatchObject({ did: "distilled", proposed: 1, dropped: 0, coverage: { total: 2, selected: 2, omitted: 0, clipped: 0 } });

    const pending = await listProjectNotes(db, PROJECT, ["proposed"]);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.createdBy).toBe("distiller");
    // And nothing approved: the distiller has no privilege over the door.
    expect(await listProjectNotes(db, PROJECT)).toHaveLength(0);
  });

  it("apunta el gasto ANTES de entender la respuesta: la ilegible también se cuenta", async () => {
    completeMock.mockResolvedValue(answer("pues yo creo que esta sesión estuvo muy bien"));
    const sessionId = await sessionWith(["a", "b"]);

    expect(await distillSession(db, { projectId: PROJECT, identity: null, sessionId })).toMatchObject({
      did: "unreadable",
    });
    expect((await modelSpendToday(db, DISTILL_KIND)).calls).toBe(1);
  });

  it("no repite lo que la memoria ya tiene — incluida una descartada, que es un no", async () => {
    const said = await proposeNote(db, { projectId: PROJECT, body: "El 4173 es producción.", createdBy: "claude" });
    if (!("id" in said)) throw new Error("no propuso");
    const { decideNote } = await import("@panoma/db");
    await decideNote(db, said.id, "discarded");

    completeMock.mockResolvedValue(answer('["el 4173  es producción.", "Algo nuevo de verdad."]'));
    const sessionId = await sessionWith(["a", "b"]);

    const receipt = await distillSession(db, { projectId: PROJECT, identity: null, sessionId });
    expect(receipt).toMatchObject({ did: "distilled", proposed: 1, dropped: 1 });
    const pending = await listProjectNotes(db, PROJECT, ["proposed"]);
    expect(pending.map((n) => n.body)).toEqual(["Algo nuevo de verdad."]);
  });

  it("[] no es un fallo: la mayoría de las sesiones no descubren nada durable", async () => {
    completeMock.mockResolvedValue(answer("```json\n[]\n```"));
    const sessionId = await sessionWith(["a", "b"]);
    expect(await distillSession(db, { projectId: PROJECT, identity: null, sessionId })).toMatchObject({
      did: "distilled",
      proposed: 0,
      dropped: 0,
    });
  });

  it("keeps the latest resolution and reports the earlier session window it omitted", async () => {
    completeMock.mockResolvedValue(answer("[]"));
    const sessionId = await sessionWith(Array.from({ length: 110 }, (_, i) => i === 109 ? "Final resolution: use the verified build procedure." : `Earlier step ${i}.`));
    const receipt = await distillSession(db, { projectId: PROJECT, identity: null, sessionId });
    expect(receipt).toMatchObject({ coverage: { total: 110, selected: 100, omitted: 10, clipped: 0 } });
    const prompt = completeMock.mock.calls[0]?.[0].prompt;
    expect(prompt).toContain("Final resolution: use the verified build procedure.");
    expect(prompt).not.toContain("Earlier step 0.");
    expect(prompt).toContain("omitted earlier records 10");
  });

  it("sends a session longer than the window before 6-Sep-2026 to the model whole", async () => {
    /*
      The window was 50 records and the envelope 24,000 characters until that day, so a session
      of eighty records reached the model without its first thirty — and the goal of a session
      is stated at its beginning, not at its end. One call still, a bigger one: 100 records
      fitted into 36,000 characters.
     */
    completeMock.mockResolvedValue(answer("[]"));
    const sessionId = await sessionWith(Array.from({ length: 80 }, (_, i) =>
      i === 0 ? "Goal: replace the migration that leaves the catalog unreadable." : `Step ${i}.`));
    const receipt = await distillSession(db, { projectId: PROJECT, identity: null, sessionId });
    expect(receipt).toMatchObject({ coverage: { total: 80, selected: 80, omitted: 0, clipped: 0 } });
    const prompt = completeMock.mock.calls[0]?.[0].prompt;
    expect(prompt).toContain("Goal: replace the migration that leaves the catalog unreadable.");
    expect(prompt).toContain("Step 79.");
    expect(prompt).toContain("omitted earlier records 0");
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("does not discard a final finding after the first 400 detail characters", async () => {
    completeMock.mockResolvedValue(answer("[]"));
    const sessionId = await sessionWith(["Initial investigation."]);
    await logActivity(db, { agentId: "ag-d", projectId: PROJECT, sessionId, kind: "discovery", summary: "Resolved.",
      details: `${"Background. ".repeat(100)}Final verified requirement: build packages first.` });
    await distillSession(db, { projectId: PROJECT, identity: null, sessionId });
    expect(completeMock.mock.calls[0]?.[0].prompt).toContain("Final verified requirement: build packages first.");
  });

  it("does not repropose a challenged note while its owner decision is pending", async () => {
    const { addHumanNote, challengeNote } = await import("@panoma/db");
    const note = await addHumanNote(db, { projectId: PROJECT, body: "Use the verified procedure." });
    if (!("id" in note)) throw new Error("Fixture note was refused.");
    await challengeNote(db, note.id, { at: new Date().toISOString(), sentinel: { kind: "path_exists", target: "docs/guide.md", expected: true }, observed: "missing" });
    completeMock.mockResolvedValue(answer('["Use the verified procedure."]'));
    const sessionId = await sessionWith(["Initial attempt.", "Resolved."]);
    expect(await distillSession(db, { projectId: PROJECT, identity: null, sessionId })).toMatchObject({ did: "distilled", proposed: 0, dropped: 1 });
    expect(await listProjectNotes(db, PROJECT, ["proposed"])).toHaveLength(0);
  });

  it("reserves the call before it leaves and completes it with the usage: a manual call from the session, an automatic one from its job", async () => {
    const { closeSession, enqueueMemoryJob, claimMemoryJob, schema: t, reservationsForJob } = await import("@panoma/db");
    completeMock.mockResolvedValue(answer('["Run the build first."]'));
    const manual = await sessionWith(["Manual investigation.", "Manual resolution."]);
    expect((await distillSession(db, { projectId: PROJECT, identity: null, sessionId: manual })).did).toBe("distilled");
    const [row] = await db.select().from(t.modelCalls);
    expect(row).toMatchObject({ kind: DISTILL_KIND, state: "completed", origin: "manual", jobId: null, inputTokens: 100, outputTokens: 20, reservationRev: 3 });
    expect(row!.attemptKey).toBe(`session:${manual}:${row!.attemptKey!.split(":")[2]}:1`);
    expect(row!.reservedAt).not.toBeNull();
    expect(row!.sentAt!.getTime()).toBeGreaterThanOrEqual(row!.reservedAt!.getTime());

    const worked = await sessionWith(["Worker investigation.", "Worker resolution."]);
    await closeSession(db, worked);
    await enqueueMemoryJob(db, worked);
    const claim = (await claimMemoryJob(db, { now: new Date(Date.now() + 1_000) }))!;
    expect((await distillSession(db, { projectId: PROJECT, identity: null, sessionId: worked }, {
      leaseToken: claim.leaseToken, isActive: () => true, jobId: claim.id, attempts: claim.attempts, origin: "automatic",
    })).did).toBe("distilled");
    const [attempt] = await reservationsForJob(db, claim.id);
    expect(attempt).toMatchObject({ state: "completed", origin: "automatic", jobId: claim.id, attemptKey: `${claim.id}:1:1` });
    expect((await modelSpendToday(db, DISTILL_KIND)).calls).toBe(2);
  });

  it("a cut answer's second call is its own reservation, and a provider that throws leaves the sent attempt uncertain", async () => {
    const { schema: t } = await import("@panoma/db");
    completeMock
      .mockResolvedValueOnce({ ...answer('["cut'), stopReason: "length" })
      .mockResolvedValueOnce(answer('["Whole this time."]'));
    const cut = await sessionWith(["Cut investigation.", "Cut resolution."]);
    expect((await distillSession(db, { projectId: PROJECT, identity: null, sessionId: cut })).did).toBe("distilled");
    const rows = await db.select().from(t.modelCalls);
    expect(rows.map((row) => row.state)).toEqual(["completed", "completed"]);
    expect(rows.map((row) => row.attemptKey!.split(":").pop())).toEqual(["1", "2"]);

    completeMock.mockRejectedValueOnce(new Error("socket hang up CANARY-PROVIDER"));
    const failed = await sessionWith(["Failed investigation.", "Failed resolution."]);
    await expect(distillSession(db, { projectId: PROJECT, identity: null, sessionId: failed })).rejects.toThrow("CANARY-PROVIDER");
    const states = (await db.select().from(t.modelCalls)).map((row) => row.state).sort();
    expect(states).toEqual(["completed", "completed", "uncertain"]);
    // The uncertain attempt still counts against the day.
    expect((await modelSpendToday(db, DISTILL_KIND)).calls).toBe(3);
  });

  it("serializes the final daily paid slot across concurrent sessions", async () => {
    const { closeSession } = await import("@panoma/db");
    process.env["PANOMA_DISTILL_BUDGET"] = "1";
    completeMock.mockResolvedValue(answer("[]"));
    const first = await sessionWith(["First investigation.", "First resolution."]);
    await closeSession(db, first);
    const second = await sessionWith(["Second investigation.", "Second resolution."]);
    const results = await Promise.all([first, second].map((sessionId) => distillSession(db, { projectId: PROJECT, identity: null, sessionId })));
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.did)).toEqual(["distilled", "budget"]);
  });
});

describe("el encargo y su lectura, sin pagar nada", () => {
  it("el material ajeno viaja envuelto, y las reglas nombran la distinción log/memoria", () => {
    const built = buildDistillPrompt({
      activities: [{ kind: "change", summary: "hice cosas", details: null, filesTouched: ["apps/web/lib/guard.ts"] }],
      existing: [{ body: "regla vieja", status: "approved" }],
    });
    expect(built.prompt).toContain('<untrusted_data origin="journal">');
    expect(built.prompt).toContain('<untrusted_data origin="notes">');
    expect(built.system).toContain("Do not summarize");
    expect(built.system).toContain("JSON array");
    // The touched files travel: they are the map from which the 'where' comes.
    expect(built.prompt).toContain('"files":["apps/web/lib/guard.ts"]');
  });

  it("fits whole newest records and declares clipping even when JSON escaping expands text", () => {
    const built = buildDistillPrompt({ activities: Array.from({ length: 5 }, (_, i) => ({
      kind: "change", summary: `Stage ${i}`, details: `${"\u0001".repeat(7900)}Final resolution ${i}.`, filesTouched: [],
    })), existing: [] });
    expect(built.coverage.clipped).toBeGreaterThan(0);
    expect(built.coverage.omitted).toBeGreaterThan(0);
    expect(built.prompt).toContain("Final resolution 4.");
    expect(built.prompt.length).toBeLessThan(26_000);
    expect(built.prompt).toContain("Earlier detail text omitted");
  });

  it("la lectura distingue «nada» de «no se entendió», y admite cadenas y objetos", () => {
    expect(parseCandidates("[]")).toEqual([]);
    expect(parseCandidates('Claro: ["un hecho"] espero que sirva')).toEqual([{ body: "un hecho" }]);
    expect(parseCandidates('```json\n["a", 3, "b"]\n```')).toEqual([{ body: "a" }, { body: "b" }]);
    expect(parseCandidates('[{"note": "con sitio", "where": "apps/web"}, "sin sitio"]')).toEqual([
      { body: "con sitio", where: "apps/web" },
      { body: "sin sitio" },
    ]);
    expect(parseCandidates("no hay nada")).toBeUndefined();
    expect(parseCandidates('{"notas": 3}')).toBeUndefined();
  });

  it("el «dónde» solo sobrevive si está en el mapa de lo tocado — como una cita", () => {
    const touched = ["apps/web/lib/guard.ts", "apps/web/lib/i18n.ts", "docs/memory.md"];
    // File touched as is: exact trigger.
    expect(whereToTrigger("docs/memory.md", touched)).toBe("docs/memory.md");
    // Directorio ancestro real: zona.
    expect(whereToTrigger("apps/web/lib", touched)).toBe("apps/web/lib/**");
    expect(whereToTrigger("apps/web/lib/", touched)).toBe("apps/web/lib/**");
    // Invented, outside the project or in a strange form: it falls, and the note lives without
    // anywhere.
    expect(whereToTrigger("packages/db", touched)).toBeUndefined();
    expect(whereToTrigger("../fuera", touched)).toBeUndefined();
    expect(whereToTrigger(undefined, touched)).toBeUndefined();
  });

  /*
    The cap comes from `capFor("memory")` since 6-Sep-2026; `spend-settings.test.ts` holds its
    contract. What stays here is the order of the memory block, because it decides what the
    4,000-character cut removes: until that day, newest-first with every status mixed, so an
    overflowing memory lost its oldest approved notes while last week's discarded ones travelled.
   */
  it("puts the owner's decisions first, newest first within each rank", () => {
    const existing = [
      { body: "discarded newest", status: "discarded" },
      { body: "proposed newest", status: "proposed" },
      { body: "approved newest", status: "approved" },
      { body: "challenged old", status: "challenged" },
      { body: "approved oldest", status: "approved" },
      { body: "discarded oldest", status: "discarded" },
    ];
    expect(byOwnerDecision(existing).map((n) => n.body)).toEqual([
      "approved newest", "challenged old", "approved oldest",
      "proposed newest",
      "discarded newest", "discarded oldest",
    ]);
  });

  it("so the cut of the memory block eats discarded notes before an old approved one", () => {
    const flood = Array.from({ length: 60 }, (_, i) => ({ body: `Discarded ${i} ${"x".repeat(90)}`, status: "discarded" }));
    const built = buildDistillPrompt({
      activities: [],
      existing: [...flood, { body: "Build the packages before testing.", status: "approved" }],
    });
    expect(built.prompt).toContain("[approved] Build the packages before testing.");
    expect(built.prompt).toContain("(truncated)");
    expect(built.prompt).not.toContain("Discarded 59 ");
  });
});
