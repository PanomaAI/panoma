import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@panoma/core";
import { DELETION_JOURNAL_FILE, ensureCursor, ensureDeletionJournal, listDeletions, newId, schema, upsertSource, type Database } from "@panoma/db";
import { resetPurgePlans } from "@/lib/memory-purge";

/*
  The purge door, called for real against a PGlite in a temporary home with the real purge
  service. Written on 14-Sep-2026 with the memory contract v2. What is watched: the preview is a
  plan and writes nothing, the confirmation is an operation answered `202`, the same plan
  confirmed twice —before and after a restart of the plan cache— is the same operation (T88), a
  stale revision, a gone plan and a plan previewed on the other door answer `409` with their
  codes, an unknown or malformed body is `invalid_input` by name, the receipt is read by id and
  never through the other door, and a quarantined journal refuses the preview. The 403 from the
  network is in `gates.test.ts`.
 */

vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
const purge = await import("./route");
const withdraw = await import("../withdraw/route");

let database: Database;
let close: () => Promise<void>;
let home: string;
const previousHome = process.env["PANOMA_HOME"];
const previousOperator = process.env["PANOMA_OPERATOR_KEY"];
const PROJECT = "purge-route";

function post(route: typeof purge, body: unknown, raw?: string): Promise<Response> {
  return route.POST(new Request("http://localhost:4173/api/memory/purge", {
    method: "POST", headers: { "content-type": "application/json", "accept-language": "en" }, body: raw ?? JSON.stringify(body),
  }));
}

function get(route: typeof purge, query: string): Promise<Response> {
  return route.GET(new Request(`http://localhost:4173/api/memory/purge${query}`, { headers: { "accept-language": "en" } }));
}

async function source(): Promise<string> {
  return database.transaction(async (tx) => {
    const { source } = await upsertSource(tx, {
      streamKey: sha256Hex(`stream-${newId("x")}`), harness: "claude-code", entrypoint: "desktop", nativeSessionKey: newId("session"),
      locator: "/home/someone/.claude/projects/-home-someone-dev-app/22222222-2222-4222-8222-222222222222.jsonl",
      fileIdentity: { observedSize: 10, anchorTo: 10 }, anchorHash: sha256Hex("anchor"), origin: "native",
    });
    await ensureCursor(tx, { sourceId: source.id, purpose: "receipt", grantId: "grant_0123456789ab", scopeKey: "git:purge-route" }, { grantGeneration: 1, allowedFrom: 0, parserVersion: "claude-code-receipts-1" });
    return source.id;
  });
}

async function plan(route: typeof purge, target: Record<string, unknown>): Promise<{ planId: string; expectedRevision: number; operation: string }> {
  const response = await post(route, { target, dryRun: true });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as { planId: string; expectedRevision: number; operation: string };
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-purge-route-"));
  process.env["PANOMA_HOME"] = home;
  delete process.env["PANOMA_OPERATOR_KEY"];
  ({ db: database, close } = await (await import("@panoma/db/client")).openDatabase());
  await database.insert(schema.projects).values({ id: PROJECT, slug: PROJECT, name: "Purge route", root: join(home, "project"), identity: "git:purge-route" });
  expect(await ensureDeletionJournal(database, home)).toMatchObject({ quarantined: false });
});

beforeEach(() => {
  resetPurgePlans();
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"]; else process.env["PANOMA_HOME"] = previousHome;
  if (previousOperator === undefined) delete process.env["PANOMA_OPERATOR_KEY"]; else process.env["PANOMA_OPERATOR_KEY"] = previousOperator;
  await rm(home, { recursive: true, force: true });
});

describe("the body is one of two shapes", () => {
  it("refuses an unknown key, both halves at once, neither, a false dryRun and a malformed target, by name", async () => {
    const cases: [unknown, string][] = [
      [{ target: { kind: "source", id: "x" }, dryRun: true, force: true }, "force is not a known property."],
      [{ target: { kind: "source", id: "x" }, dryRun: true, planId: "plan_x" }, expect.stringContaining("either") as unknown as string],
      [{}, expect.stringContaining("either") as unknown as string],
      [{ target: { kind: "source", id: "x" }, dryRun: false }, expect.stringContaining("dryRun") as unknown as string],
      [{ target: { kind: "everything", id: "x" }, dryRun: true }, "target.kind must be source, project, session or item."],
      [{ target: { kind: "source", id: "x", revision: 2 }, dryRun: true }, "target.itemKind and target.revision belong to an item target only."],
      [{ target: { kind: "item", itemKind: "prompt", id: "x" }, dryRun: true }, "target.itemKind must be note, criterion or decision."],
      [{ target: { kind: "item", itemKind: "note", id: "x", revision: 0 }, dryRun: true }, "target.revision must be a positive integer."],
      [{ target: { kind: "source", id: "x", path: "/tmp" }, dryRun: true }, "target.path is not a known property."],
      [{ target: { kind: "source", id: "has space" }, dryRun: true }, "target.id must be an opaque id of 1 to 128 characters."],
      [{ planId: "plan_x", expectedRevision: "1", confirm: true }, expect.stringContaining("expectedRevision") as unknown as string],
      [{ planId: "plan_x", expectedRevision: 1, confirm: false }, "confirm must be true."],
      [{ planId: "nope", expectedRevision: 1, confirm: true }, expect.stringContaining("planId") as unknown as string],
    ];
    for (const [body, error] of cases) {
      const response = await post(purge, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_input", error, retryable: false });
    }
    expect((await post(purge, undefined, "{")).status).toBe(400);
    expect(await listDeletions(database, { state: "pending" })).toHaveLength(0);
  });
});

describe("preview, confirm, receipt", () => {
  it("previews without writing and confirms once: the same plan is the same operation, across a restart (T88)", async () => {
    const id = await source();
    const before = (await listDeletions(database)).length;
    const preview = await post(purge, { target: { kind: "source", id }, dryRun: true });
    expect(preview.status).toBe(200);
    expect(preview.headers.get("cache-control")).toBe("private, no-store");
    const plan = (await preview.json()) as Record<string, unknown>;
    expect(plan).toMatchObject({ planId: expect.stringMatching(/^plan_/), operation: "purge", affected: { sources: 1 }, retained: [], expiresAt: expect.any(String) });
    expect(plan["externalCopies"]).toEqual([`transcript:${id}`]);
    expect((await listDeletions(database)).length).toBe(before);

    const confirm = { planId: plan["planId"], expectedRevision: plan["expectedRevision"], confirm: true };
    const first = await post(purge, confirm);
    expect(first.status).toBe(202);
    const accepted = (await first.json()) as { operationId: string; status: string };
    expect(accepted).toEqual({ operationId: expect.stringMatching(/^mdel_/), operation: "purge", status: "pending" });
    expect(((await (await post(purge, confirm)).json()) as { operationId: string }).operationId).toBe(accepted.operationId);
    resetPurgePlans();
    const afterRestart = await post(purge, confirm);
    expect(afterRestart.status).toBe(202);
    expect(((await afterRestart.json()) as { operationId: string }).operationId).toBe(accepted.operationId);
    expect((await listDeletions(database)).length).toBe(before + 1);

    const receipt = await get(purge, `?id=${accepted.operationId}`);
    expect(receipt.status).toBe(200);
    expect(await receipt.json()).toMatchObject({ operationId: accepted.operationId, operation: "purge", status: expect.any(String), removed: 0, retained: [], createdAt: expect.any(String) });
    // The other door does not know this operation, and an unknown id is not found either.
    expect((await get(withdraw, `?id=${accepted.operationId}`)).status).toBe(404);
    expect(await (await get(purge, "?id=mdel_nobody")).json()).toMatchObject({ code: "not_found", retryable: false });
    expect((await get(purge, "")).status).toBe(400);
    expect((await get(purge, `?id=${accepted.operationId}&verbose=1`)).status).toBe(400);
  });

  it("answers 409 stale_revision for another revision and stale_plan for a plan nobody holds, with a hint each", async () => {
    const id = await source();
    const made = await plan(purge, { kind: "source", id });
    const stale = await post(purge, { planId: made.planId, expectedRevision: made.expectedRevision + 7, confirm: true });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_revision", retryable: false, hint: expect.stringContaining("preview") });
    const gone = await post(purge, { planId: "plan_00000000-0000-4000-8000-000000000000", expectedRevision: made.expectedRevision, confirm: true });
    expect(gone.status).toBe(409);
    expect(await gone.json()).toMatchObject({ code: "stale_plan", retryable: false, hint: expect.stringContaining("preview") });
  });

  it("§23.2.6: a plan previewed here is not confirmed through the withdraw door, nor a withdrawal through this one", async () => {
    const id = await source();
    const before = (await listDeletions(database)).length;
    const mine = await plan(purge, { kind: "source", id });
    const theirs = await plan(withdraw, { kind: "source", id });
    const crossed = await post(withdraw, { planId: mine.planId, expectedRevision: mine.expectedRevision, confirm: true });
    expect(crossed.status).toBe(409);
    expect(await crossed.json()).toMatchObject({ code: "stale_plan", error: expect.stringContaining("withdraw"), hint: expect.stringContaining("preview"), retryable: false });
    const other = await post(purge, { planId: theirs.planId, expectedRevision: theirs.expectedRevision, confirm: true });
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ code: "stale_plan", error: expect.stringContaining("purge") });
    expect((await listDeletions(database)).length).toBe(before);
    // Through its own door, the same plan begins; through the other, the confirmed operation stays refused.
    const own = await post(purge, { planId: mine.planId, expectedRevision: mine.expectedRevision, confirm: true });
    expect(own.status).toBe(202);
    expect(await own.json()).toMatchObject({ operation: "purge", status: "pending" });
    resetPurgePlans();
    expect((await post(withdraw, { planId: mine.planId, expectedRevision: mine.expectedRevision, confirm: true })).status).toBe(409);
    expect((await post(purge, { planId: mine.planId, expectedRevision: mine.expectedRevision, confirm: true })).status).toBe(202);
    expect((await listDeletions(database)).length).toBe(before + 1);
  });

  it("previews a project and an item target through the same door", async () => {
    expect(await plan(purge, { kind: "project", id: PROJECT })).toMatchObject({ operation: "purge" });
    expect(await plan(purge, { kind: "item", itemKind: "note", id: "note_absent", revision: 1 })).toMatchObject({ operation: "purge" });
  });

  it("refuses the preview under quarantine with a retryable 503", async () => {
    const journal = join(home, DELETION_JOURNAL_FILE);
    const intact = readFileSync(journal, "utf8");
    appendFileSync(journal, "torn line without a closing brace\n");
    try {
      const id = await source();
      const response = await post(purge, { target: { kind: "source", id }, dryRun: true });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "unavailable", retryable: true, error: expect.stringContaining("corrupt_line") });
    } finally {
      writeFileSync(journal, intact);
    }
  });
});
