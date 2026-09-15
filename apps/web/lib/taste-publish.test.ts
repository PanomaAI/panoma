import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@panoma/db";

/*
  The publication outbox against a real catalog and a real disk: the file is written whole and
  read back before the catalog is told (§22.10), a file that moved since the plan is a conflict
  and never a veto, a crash between the write and the catalog update is recovered by the hash on
  the next claim, and the same plan finds the same job. The managed block of a project's
  `AGENTS.md` goes through the same road from the same lines.
 */

const publish = await import("./taste-publish");
const { ABSENT_FILE_HASH, TASTE_PROCESSOR, planPublication, publicationState, publicationTargetPath, runPublication, runPublicationPass } = publish;
const db = await import("@panoma/db");
const { schema, claimJob, insertBeliefs, jobById, listBeliefs, listJobs } = db;
const core = await import("@panoma/core");
const { PANOMA_BLOCK_BEGIN, PANOMA_BLOCK_END, TASTE_FILE, readTaste, setInferredConsent, sha256Hex, writeTaste } = core;

let home: string;
let userHome: string;
let database: Database;
let close: () => Promise<void>;
const previousHome = process.env["PANOMA_HOME"];
const PROJECT = "proj_publish";
const IDENTITY = "git:publish";
let root = "";

const clock = () => new Date();
const later = (ms: number) => new Date(Date.now() + ms);

async function signedBelief(statement: string, extra: Record<string, unknown> = {}): Promise<string> {
  const [id] = await insertBeliefs(database, [{
    topic: "design", statement, identity: null, state: "signed", citations: [], support: { observations: 0, projects: 0, days: 0 }, model: "owner", ...extra,
  }]);
  return id!;
}

async function inferredBelief(statement: string, extra: Record<string, unknown> = {}): Promise<string> {
  const [id] = await insertBeliefs(database, [{
    topic: "design", statement, identity: null, state: "inferred",
    citations: [{ verdictId: "v1", observationId: "obs_1", quote: "…", at: new Date().toISOString(), project: "fixture" }],
    support: { observations: 4, projects: 3, days: 5 }, model: "fixture-model", ...extra,
  }]);
  return id!;
}

async function beliefById(id: string) {
  return (await listBeliefs(database)).find((row) => row.id === id)!;
}

function tastePath(): string {
  return join(home, TASTE_FILE);
}

async function planTaste() {
  const plan = await planPublication(database, { target: "TASTE" });
  if ("code" in plan) throw new Error(`plan refused: ${plan.code} ${plan.reason}`);
  return plan;
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-publish-home-"));
  userHome = realpathSync(mkdtempSync(join(tmpdir(), "panoma-publish-user-")));
  process.env["PANOMA_HOME"] = home;
  delete process.env["DATABASE_URL"];
  root = join(userHome, "dev", "publish");
  mkdirSync(root, { recursive: true });
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: PROJECT, slug: "publish", name: "Publish fixture", root, identity: IDENTITY },
  ]);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"]; else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
  await rm(userHome, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const name of ["AGENTS.md", "CLAUDE.md"]) await rm(join(root, name), { recursive: true, force: true });
  await database.delete(schema.memoryJobs);
  await database.delete(schema.beliefs);
  await database.delete(schema.memoryRevisions);
  await rm(tastePath(), { force: true });
  await setInferredConsent(false, home);
});

describe("the purge cleans catalog-owned files before discarding their mappings", () => {
  /** A managed `AGENTS.md` with the portrait's block written by the outbox, as a project has after a sync. */
  async function managedAgents(): Promise<{ path: string; text: string }> {
    const path = join(root, "AGENTS.md");
    await writeFile(path, `Owner text outside the block.\n${PANOMA_BLOCK_BEGIN}\n${PANOMA_BLOCK_END}\n`);
    await planPublication(database, { target: "AGENTS", projectId: PROJECT });
    await runPublicationPass(database);
    return { path, text: await readFile(path, "utf8") };
  }

  async function removeCriterion(id: string, operation: "purge" | "withdraw" = "purge") {
    const purge = await import("./memory-purge");
    await db.ensureDeletionJournal(database, home);
    const plan = await purge.previewPurge(database, home, { operation, targets: [{ kind: "item", itemKind: "criterion", id }], scope: {} });
    if (!("planId" in plan)) throw new Error("No purge preview.");
    const receipt = await purge.executePurge(database, home, { operation, planId: plan.planId, expectedRevision: plan.expectedRevision, confirm: true });
    if (!("operationId" in receipt)) throw new Error("No deletion receipt.");
    return { purge, id: receipt.operationId };
  }

  it("a withdrawal removes the published copy from the files and keeps the bytes in the catalog", async () => {
    const id = await signedBelief("A withdrawn rule leaves the files and stays in the catalog.");
    await planTaste();
    await runPublicationPass(database);
    const { path: agents } = await managedAgents();
    expect(await readFile(agents, "utf8")).toContain("A withdrawn rule");
    const deletion = await removeCriterion(id, "withdraw");
    await deletion.purge.runDeletionWork(database);
    expect(await deletion.purge.purgeStatus(database, deletion.id)).toMatchObject({ status: "complete", remaining: 0 });
    expect(await readFile(tastePath(), "utf8")).not.toContain("A withdrawn rule");
    expect(await readFile(agents, "utf8")).not.toContain("A withdrawn rule");
    // The catalog keeps the bytes: a withdrawal blocks, it does not blank.
    const row = (await database.select().from(schema.beliefs)).find((one) => one.id === id);
    expect(row?.statement).toBe("A withdrawn rule leaves the files and stays in the catalog.");
  });

  it("removes a published criterion from TASTE and both managed blocks, preserving text outside them", async () => {
    const id = await signedBelief("A private rule that must leave every managed copy.");
    await planTaste();
    await runPublicationPass(database);
    for (const target of ["AGENTS", "CLAUDE"] as const) {
      await writeFile(join(root, `${target}.md`), `Owner text outside the block.\n${PANOMA_BLOCK_BEGIN}\n${PANOMA_BLOCK_END}\n`);
      await planPublication(database, { target, projectId: PROJECT });
      await runPublicationPass(database);
      expect(await readFile(join(root, `${target}.md`), "utf8")).toContain("A private rule");
    }
    const deletion = await removeCriterion(id);
    await deletion.purge.runDeletionWork(database);
    expect(await deletion.purge.purgeStatus(database, deletion.id)).toMatchObject({ status: "complete", remaining: 0 });
    expect(await readFile(tastePath(), "utf8")).not.toContain("A private rule");
    for (const target of ["AGENTS", "CLAUDE"]) {
      const text = await readFile(join(root, `${target}.md`), "utf8");
      expect(text).toContain("Owner text outside the block.");
      expect(text).not.toContain("A private rule");
    }
  });

  it("keeps the domain mapping and reports pending while a managed block cannot be cleaned, and finishes once it can", async () => {
    const id = await signedBelief("This rule waits for its inaccessible copy.");
    await planTaste();
    await runPublicationPass(database);
    // The block loses its end marker: the file reads, the block does not, and the copy inside it cannot be removed.
    const { path: agents, text: intact } = await managedAgents();
    expect(intact).toContain("inaccessible copy");
    await writeFile(agents, intact.replace(PANOMA_BLOCK_END, "<!-- panoma:torn -->"));
    const deletion = await removeCriterion(id);
    await deletion.purge.runDeletionWork(database);
    expect(await deletion.purge.purgeStatus(database, deletion.id)).toMatchObject({ status: "cleaning" });
    const row = (await database.select().from(schema.beliefs)).find((one) => one.id === id);
    expect(row?.statement).toBe("This rule waits for its inaccessible copy.");
    await writeFile(agents, intact);
    await deletion.purge.runDeletionWork(database);
    expect(await deletion.purge.purgeStatus(database, deletion.id)).toMatchObject({ status: "complete", remaining: 0 });
    expect(await readFile(agents, "utf8")).not.toContain("inaccessible copy");
  });

  it("a copy that stays unreachable does not hold the deletion for ever: after the retries it is named as external and the catalog side completes", async () => {
    const id = await signedBelief("This rule's copy is never reachable.");
    await planTaste();
    await runPublicationPass(database);
    const { path: agents, text: intact } = await managedAgents();
    await writeFile(agents, intact.replace(PANOMA_BLOCK_END, "<!-- panoma:torn -->"));
    const deletion = await removeCriterion(id);
    for (let heartbeat = 0; heartbeat < db.FILE_CLEANUP_ATTEMPTS_MAX - 1; heartbeat += 1) {
      await deletion.purge.runDeletionWork(database);
      expect(await deletion.purge.purgeStatus(database, deletion.id)).toMatchObject({ status: "cleaning" });
    }
    // The last retry: the copy is listed, by project and file name and never by path, and the batches run.
    await deletion.purge.runDeletionWork(database);
    const receipt = await deletion.purge.purgeStatus(database, deletion.id);
    expect(receipt).toMatchObject({ status: "complete", remaining: 0 });
    expect(receipt!.externalCopies).toContain(`managed:${PROJECT}:AGENTS.md`);
    expect(receipt!.externalCopies.join(" ")).not.toContain(root);
    const row = (await database.select().from(schema.beliefs)).find((one) => one.id === id);
    expect(row?.statement).not.toBe("This rule's copy is never reachable.");
    // The torn file is left as it was: the cleanup never writes through a block it cannot read.
    expect(await readFile(agents, "utf8")).toContain("<!-- panoma:torn -->");
  });

  it("a folder under a managed file's name is nobody's copy: the deletion does not wait for it", async () => {
    const id = await signedBelief("This rule has no copy in a folder.");
    await planTaste();
    await runPublicationPass(database);
    const agents = join(root, "AGENTS.md");
    await mkdir(agents);
    const deletion = await removeCriterion(id);
    await deletion.purge.runDeletionWork(database);
    expect(await deletion.purge.purgeStatus(database, deletion.id)).toMatchObject({ status: "complete", remaining: 0 });
    await rm(agents, { recursive: true });
  });

  it("waits for an in-flight owned write, then removes its staged copy before completing", async () => {
    const id = await signedBelief("A rule written just before its purge.");
    await planTaste();
    let release!: () => void;
    let arrived!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { arrived = resolve; });
    const writing = runPublicationPass(database, { hooks: { afterWrite: async () => { arrived(); await paused; } } });
    await entered;
    const deletion = await removeCriterion(id);
    const cleaning = deletion.purge.runDeletionWork(database);
    expect(await deletion.purge.purgeStatus(database, deletion.id)).toMatchObject({ status: "pending" });
    release();
    await writing;
    await cleaning;
    expect(await deletion.purge.purgeStatus(database, deletion.id)).toMatchObject({ status: "complete", remaining: 0 });
    expect(await readFile(tastePath(), "utf8")).not.toContain("A rule written just before");
  });
});

describe("the outbox writes TASTE.md", () => {
  it("the watcher enqueues a managed publication and lets the same outbox write it", async () => {
    await signedBelief("The watcher uses the durable publication path.");
    await planTaste();
    await runPublicationPass(database);
    const original = `Owner text.\n${PANOMA_BLOCK_BEGIN}\n${PANOMA_BLOCK_END}\n`;
    await writeFile(join(root, "AGENTS.md"), original);
    const { syncManagedDoc } = await import("./md-sync");
    await syncManagedDoc(root, database);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(original);
    expect((await publicationState(database, { target: "AGENTS", projectId: PROJECT })).status).toBe("pending");
    await runPublicationPass(database);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("The watcher uses the durable publication path.");
    await expect(readFile(join(root, "CLAUDE.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("recovers a saved signature through TASTE and both managed files after the caller disappears", async () => {
    await signedBelief("A saved signature survives a missing enqueue.");
    for (const target of ["AGENTS", "CLAUDE"]) await writeFile(join(root, `${target}.md`), `Owner text.\n${PANOMA_BLOCK_BEGIN}\n${PANOMA_BLOCK_END}\n`);
    // No route plans anything. Each round represents the next heartbeat, including a restart
    // after TASTE was written but before managed targets could be enqueued.
    for (let round = 0; round < 4; round += 1) {
      await publish.recoveryPublicationPlanning(database);
      await runPublicationPass(database);
    }
    expect(await readFile(tastePath(), "utf8")).toContain("A saved signature");
    for (const target of ["AGENTS", "CLAUDE"]) expect(await readFile(join(root, `${target}.md`), "utf8")).toContain("A saved signature");
    const count = (await listJobs(database, { processor: TASTE_PROCESSOR })).jobs.length;
    await publish.recoveryPublicationPlanning(database);
    await runPublicationPass(database);
    expect((await listJobs(database, { processor: TASTE_PROCESSOR })).jobs).toHaveLength(count);
  });
  it("§22.10: the file is written whole, the bytes are read back, and only then are the beliefs marked as published", async () => {
    const first = await signedBelief("Prefer inline editing for small changes.");
    const second = await signedBelief("Never animate without a purpose.");

    const plan = await planTaste();
    expect(plan).toMatchObject({ created: true, status: "pending", baseFileHash: ABSENT_FILE_HASH, removals: [] });
    expect(plan.revisions).toEqual([`${first}@1`, `${second}@1`].sort());
    expect((await jobById(database, plan.id))?.processor).toBe(TASTE_PROCESSOR);

    let seenAtWrite: { file: string; published: (unknown)[] } | undefined;
    const pass = await runPublicationPass(database, {
      hooks: {
        afterWrite: async (path) => {
          // The bytes are on the disk before the catalog knows: the order the plan fixes.
          seenAtWrite = { file: await readFile(path, "utf8"), published: (await listBeliefs(database)).map((row) => row.publishedAs) };
        },
      },
    });
    expect(pass.claimed).toBe(1);
    expect(pass.outcomes[0]).toMatchObject({ did: "published", jobId: plan.id, target: "TASTE", units: 2 });
    expect(seenAtWrite?.file).toContain("Prefer inline editing for small changes.");
    expect(seenAtWrite?.published).toEqual([null, null]);

    const job = (await jobById(database, plan.id))!;
    expect(job.status).toBe("complete");
    expect(job.receipt).toMatchObject({ did: "published", target: "TASTE", units: 2 });
    expect(job.receipt).not.toHaveProperty("path");
    expect((job.receipt as { renderedHash: string }).renderedHash).toBe(sha256Hex(await readFile(tastePath(), "utf8")));
    expect((await readTaste(home)).lines.map((line) => line.statement)).toEqual(["Prefer inline editing for small changes.", "Never animate without a purpose."]);
    expect((await beliefById(first)).publishedAs).toEqual({ topic: "design", statement: "Prefer inline editing for small changes." });
    expect((await beliefById(second)).deliveryMode).toBe("core");

    const state = await publicationState(database, { target: "TASTE" });
    expect(state).toMatchObject({ revision: 2, status: "published", jobId: plan.id });
  });

  it("T70: with the permission off an inference stays in the Twin; with it on it publishes through the same outbox", async () => {
    const inferred = await inferredBelief("You want the tray to stay out of the way.");
    await signedBelief("Keep the sidebar narrow.");
    const off = await planTaste();
    expect(off.revisions).toHaveLength(1);
    await runPublicationPass(database);
    expect((await readTaste(home)).lines.map((line) => line.statement)).toEqual(["Keep the sidebar narrow."]);
    expect((await beliefById(inferred)).publishedAs).toBeNull();

    await setInferredConsent(true, home);
    const on = await planTaste();
    expect(on.created).toBe(true);
    expect(on.revisions).toContain(`${inferred}@1`);
    const pass = await runPublicationPass(database);
    expect(pass.outcomes.map((one) => one.did)).toEqual(["published"]);
    expect((await readTaste(home)).lines.map((line) => line.statement)).toContain("You want the tray to stay out of the way.");
    expect((await beliefById(inferred)).publishedAs?.statement).toBe("You want the tray to stay out of the way.");
  });

  it("§10.4: a criterion travels with its conditions and exceptions, and a portrait that does not fit with them fails without writing", async () => {
    const predicate = (expression: unknown) => ({ schemaVersion: 1, expression });
    const conditioned = await signedBelief("Prefer inline editing.", {
      conditions: predicate({ kind: "operation_is", operation: "edit" }),
      exceptions: predicate({ kind: "path_under", path: "docs" }),
    });
    await planTaste();
    await runPublicationPass(database);
    const [line] = (await readTaste(home)).lines;
    expect(line?.statement).toBe("Prefer inline editing. Applies when: the operation is edit. Except when: the path is under docs.");
    expect((await beliefById(conditioned)).publishedAs?.statement).toBe(line?.statement);

    // A second belief that fits alone but not with the first one's clauses: nothing half-written.
    await signedBelief("x".repeat(2_900));
    const full = await planTaste();
    const pass = await runPublicationPass(database);
    expect(pass.outcomes[0]).toMatchObject({ did: "failed", reason: "taste_full", jobId: full.id });
    expect((await jobById(database, full.id))?.receipt).toMatchObject({ did: "taste_full", cap: 3_000 });
    expect((await readTaste(home)).lines).toHaveLength(1);
  });
});

describe("a file that moved since the plan", () => {
  it("is a publication conflict: the job is deferred with file_changed and nobody is vetoed", async () => {
    const id = await signedBelief("Prefer inline editing for small changes.");
    const plan = await planTaste();
    await writeFile(tastePath(), "# Taste\n\n## design\n\n- A rule the owner typed meanwhile.\n", "utf8");

    const pass = await runPublicationPass(database);
    expect(pass.outcomes[0]).toMatchObject({ did: "conflict", reason: "file_changed", jobId: plan.id });
    const job = (await jobById(database, plan.id))!;
    expect(job.status).toBe("deferred");
    expect(job.reason).toBe("file_changed");
    expect(job.receipt).toMatchObject({ did: "conflict", target: "TASTE" });
    const row = await beliefById(id);
    expect(row.state).toBe("signed");
    expect(row.publishedAs).toBeNull();
    expect((await readTaste(home)).lines.map((line) => line.statement)).toEqual(["A rule the owner typed meanwhile."]);
    expect(await publicationState(database, { target: "TASTE" })).toMatchObject({ status: "conflict", reason: "file_changed", pendingJobId: plan.id });

    // A new plan reconciles the owner's line, supersedes the conflicted job and publishes beside it.
    const again = await planTaste();
    expect(again.created).toBe(true);
    expect((await jobById(database, plan.id))?.status).toBe("cancelled");
    const second = await runPublicationPass(database);
    expect(second.outcomes[0]).toMatchObject({ did: "published", jobId: again.id });
    expect((await readTaste(home)).lines.map((line) => line.statement)).toEqual(["A rule the owner typed meanwhile.", "Prefer inline editing for small changes."]);
    expect((await publicationState(database, { target: "TASTE" })).revision).toBe(3);
  });

  it("a deleted published line is the owner's veto, reconciled before the plan freezes anything", async () => {
    const kept = await signedBelief("Keep the sidebar narrow.");
    const deleted = await signedBelief("Use gradients everywhere.");
    await planTaste();
    await runPublicationPass(database);
    expect((await readTaste(home)).lines).toHaveLength(2);

    const lines = (await readTaste(home)).lines.filter((line) => line.statement !== "Use gradients everywhere.");
    await writeTaste(lines, home);
    const plan = await planTaste();
    expect((await beliefById(deleted)).state).toBe("vetoed");
    expect(plan.revisions).toEqual([`${kept}@1`]);
    const pass = await runPublicationPass(database);
    expect(pass.outcomes[0]).toMatchObject({ did: "unchanged" });
    expect((await readTaste(home)).lines.map((line) => line.statement)).toEqual(["Keep the sidebar narrow."]);
  });
});

describe("a crash between the write and the catalog update", () => {
  it("does not mark a vetoed revision published when the owner changes it after the file write", async () => {
    const id = await signedBelief("Keep this criterion subject to the owner's veto.");
    await planTaste();
    const result = await runPublicationPass(database, {
      hooks: { afterWrite: async () => { await db.vetoBelief(database, id); } },
    });
    expect(result.outcomes[0]).toMatchObject({ did: "obsolete", reason: "revisions_moved" });
    expect(await beliefById(id)).toMatchObject({ state: "vetoed", publishedAs: null });
  });

  it("revalidates staged units before confirming a file left behind by a crashed worker", async () => {
    const id = await signedBelief("A recovered publication must keep the current human revision.");
    await planTaste();
    await expect(runPublicationPass(database, {
      leaseMs: 1,
      hooks: { afterWrite: async () => { throw new Error("crash after write"); } },
    })).rejects.toThrow("crash after write");
    await db.vetoBelief(database, id);
    const result = await runPublicationPass(database, { now: later(1_000) });
    expect(result.outcomes[0]).toMatchObject({ did: "obsolete", reason: "revisions_moved" });
    expect(await beliefById(id)).toMatchObject({ state: "vetoed", publishedAs: null });
  });

  it("is recovered on the next claim by comparing the target hash with the staged one, and confirmed without a second write", async () => {
    const id = await signedBelief("Prefer inline editing for small changes.");
    const plan = await planTaste();
    await expect(runPublicationPass(database, { hooks: { afterWrite: () => { throw new Error("the process died here"); } } }))
      .rejects.toThrow("the process died here");

    const written = await readFile(tastePath(), "utf8");
    expect(written).toContain("Prefer inline editing for small changes.");
    const crashed = (await jobById(database, plan.id))!;
    expect(crashed.status).toBe("staged");
    expect((await beliefById(id)).publishedAs).toBeNull();
    expect(await publicationState(database, { target: "TASTE" })).toMatchObject({ status: "pending", pendingJobId: plan.id });

    // The lease is still held: nothing to claim until it expires.
    expect((await runPublicationPass(database)).claimed).toBe(0);

    const recovered = await runPublicationPass(database, { now: later(6 * 60_000) });
    expect(recovered.outcomes[0]).toMatchObject({ did: "confirmed", jobId: plan.id, units: 1 });
    expect(await readFile(tastePath(), "utf8")).toBe(written);
    expect((await jobById(database, plan.id))?.status).toBe("complete");
    expect((await jobById(database, plan.id))?.receipt).toMatchObject({ did: "confirmed" });
    expect((await beliefById(id)).publishedAs).toEqual({ topic: "design", statement: "Prefer inline editing for small changes." });
  });

  it("and a file the owner touched after the crash is a conflict, never a veto and never a second write", async () => {
    const id = await signedBelief("Prefer inline editing for small changes.");
    const plan = await planTaste();
    await expect(runPublicationPass(database, { hooks: { afterWrite: () => { throw new Error("died"); } } })).rejects.toThrow("died");
    await appendFile(tastePath(), "- And one more the owner added by hand.\n", "utf8");
    const edited = await readFile(tastePath(), "utf8");

    const next = await runPublicationPass(database, { now: later(6 * 60_000) });
    expect(next.outcomes[0]).toMatchObject({ did: "conflict", reason: "file_changed", jobId: plan.id });
    expect(await readFile(tastePath(), "utf8")).toBe(edited);
    expect((await beliefById(id)).state).toBe("signed");
    expect((await beliefById(id)).publishedAs).toBeNull();
  });
});

describe("one job per target and manifest", () => {
  it("planning the same publication twice finds the same job, and never restarts it", async () => {
    await signedBelief("Keep the sidebar narrow.");
    const first = await planTaste();
    const second = await planTaste();
    expect(second).toMatchObject({ id: first.id, created: false, status: "pending" });
    expect((await jobById(database, first.id))?.attempts).toBe(0);
    expect((await listJobs(database, { processor: TASTE_PROCESSOR })).jobs).toHaveLength(1);

    await runPublicationPass(database);
    expect((await jobById(database, first.id))?.status).toBe("complete");
    // The file moved by the publication itself: the next plan is a new job, and it writes nothing.
    const third = await planTaste();
    expect(third.created).toBe(true);
    expect(third.id).not.toBe(first.id);
    const pass = await runPublicationPass(database);
    expect(pass.outcomes[0]).toMatchObject({ did: "unchanged", jobId: third.id });
    expect((await publicationState(database, { target: "TASTE" })).revision).toBe(3);
  });

  it("a claim whose revisions moved since the plan ends obsolete, and a bad manifest fails without retries", async () => {
    const id = await signedBelief("Keep the sidebar narrow.");
    const plan = await planTaste();
    await db.signBelief(database, id, "Keep the sidebar narrower.");
    const pass = await runPublicationPass(database);
    expect(pass.outcomes[0]).toMatchObject({ did: "obsolete", reason: "revisions_moved", jobId: plan.id });
    expect((await readTaste(home)).lines).toHaveLength(0);

    await database.update(schema.memoryJobs).set({ status: "pending", availableAt: new Date(0), inputManifest: { schemaVersion: 1, processor: "project_extract" } });
    const claim = (await claimJob(database, TASTE_PROCESSOR, { now: clock() }))!;
    expect(await runPublication(database, claim)).toMatchObject({ did: "failed", reason: "bad_manifest" });
  });
});

describe("the managed block of a project", () => {
  const managed = `# My project\n\nProse the owner wrote.\n\n${PANOMA_BLOCK_BEGIN}\nold block\n${PANOMA_BLOCK_END}\n\nMore prose after.\n`;

  it("resolves the path on the server from the target and the project, never from the caller", async () => {
    expect(await publicationTargetPath(database, { target: "AGENTS", projectId: PROJECT })).toEqual({ path: join(root, "AGENTS.md"), root, file: "AGENTS.md" });
    expect(await publicationTargetPath(database, { target: "CLAUDE", projectId: PROJECT })).toMatchObject({ path: join(root, "CLAUDE.md") });
    expect(await publicationTargetPath(database, { target: "AGENTS", projectId: "proj_missing" })).toEqual({ code: "not_found", reason: "project" });
    expect(await publicationTargetPath(database, { target: "AGENTS", projectId: "../../etc" })).toEqual({ code: "invalid_input", reason: "project" });
    expect(await publicationTargetPath(database, { target: "TASTE", projectId: PROJECT })).toEqual({ code: "invalid_input", reason: "project" });
    expect(await publicationTargetPath(database, { target: "TASTE" }, home)).toEqual({ path: tastePath(), root: null, file: TASTE_FILE });
  });

  it("writes the block from the same publishable lines, keeps the prose, and refuses a file without the markers", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "publish-fixture", scripts: { test: "vitest run" } }));
    writeFileSync(join(root, "AGENTS.md"), managed);
    await signedBelief("Keep the sidebar narrow.");
    await signedBelief("Use tabs in this project only.", { identity: IDENTITY });
    await planTaste();
    await runPublicationPass(database);

    const plan = await planPublication(database, { target: "AGENTS", projectId: PROJECT, origin: "automatic" });
    if ("code" in plan) throw new Error(plan.code);
    expect(plan.baseFileHash).toBe(sha256Hex(managed));
    const pass = await runPublicationPass(database);
    expect(pass.outcomes[0]).toMatchObject({ did: "published", target: "AGENTS", jobId: plan.id });
    const written = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(written).toContain("Prose the owner wrote.");
    expect(written).toContain("More prose after.");
    expect(written).not.toContain("old block");
    expect(written).toContain("Keep the sidebar narrow.");
    expect(written).toContain("Use tabs in this project only.");
    expect(await publicationState(database, { target: "AGENTS", projectId: PROJECT })).toMatchObject({ status: "published", jobId: plan.id });

    expect(await planPublication(database, { target: "CLAUDE", projectId: PROJECT })).toEqual({ code: "invalid_input", reason: "not_managed" });
    expect(await planPublication(database, { target: "AGENTS", projectId: "proj_missing" })).toEqual({ code: "not_found", reason: "project" });
  });
});
