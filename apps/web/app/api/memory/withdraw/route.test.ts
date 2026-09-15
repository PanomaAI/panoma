import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@panoma/core";
import { ensureCursor, ensureDeletionJournal, listDeletions, newId, schema, sourceById, upsertSource, type Database } from "@panoma/db";
import { resetPurgePlans, runDeletionWork } from "@/lib/memory-purge";

/*
  The withdraw door, called for real against a PGlite in a temporary home with the real purge
  service. Written on 14-Sep-2026 with the memory contract v2. What is watched: the door speaks
  the purge door's protocol with the other word —the plan says `withdraw`, the operation blocks
  the stream and blanks nothing—, the receipt is read here and not through the purge door, and
  the same malformed body is refused the same way. Everything about staleness, restarts and the
  quarantine is exercised once, in `../purge/route.test.ts`, because the two doors share the code.
 */

vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
const withdraw = await import("./route");
const purge = await import("../purge/route");

let database: Database;
let close: () => Promise<void>;
let home: string;
const previousHome = process.env["PANOMA_HOME"];
const previousOperator = process.env["PANOMA_OPERATOR_KEY"];
const PROJECT = "withdraw-route";

function post(route: typeof withdraw, body: unknown): Promise<Response> {
  return route.POST(new Request("http://localhost:4173/api/memory/withdraw", {
    method: "POST", headers: { "content-type": "application/json", "accept-language": "en" }, body: JSON.stringify(body),
  }));
}

function get(route: typeof withdraw, query: string): Promise<Response> {
  return route.GET(new Request(`http://localhost:4173/api/memory/withdraw${query}`, { headers: { "accept-language": "en" } }));
}

async function source(): Promise<string> {
  return database.transaction(async (tx) => {
    const { source } = await upsertSource(tx, {
      streamKey: sha256Hex(`stream-${newId("x")}`), harness: "claude-code", entrypoint: "desktop", nativeSessionKey: newId("session"),
      locator: "/home/someone/.claude/projects/-home-someone-dev-app/33333333-3333-4333-8333-333333333333.jsonl",
      fileIdentity: { observedSize: 10, anchorTo: 10 }, anchorHash: sha256Hex("anchor"), origin: "native",
    });
    await ensureCursor(tx, { sourceId: source.id, purpose: "receipt", grantId: "grant_0123456789ab", scopeKey: "git:withdraw-route" }, { grantGeneration: 1, allowedFrom: 0, parserVersion: "claude-code-receipts-1" });
    return source.id;
  });
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-withdraw-route-"));
  process.env["PANOMA_HOME"] = home;
  delete process.env["PANOMA_OPERATOR_KEY"];
  ({ db: database, close } = await (await import("@panoma/db/client")).openDatabase());
  await database.insert(schema.projects).values({ id: PROJECT, slug: PROJECT, name: "Withdraw route", root: join(home, "project"), identity: "git:withdraw-route" });
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

describe("withdrawing a source", () => {
  it("plans a withdrawal, confirms it once, blocks the stream without blanking it, and reads the receipt here only", async () => {
    const id = await source();
    const preview = await post(withdraw, { target: { kind: "source", id }, dryRun: true });
    expect(preview.status).toBe(200);
    const plan = (await preview.json()) as { planId: string; expectedRevision: number; operation: string; affected: { sources: number } };
    expect(plan).toMatchObject({ operation: "withdraw", affected: { sources: 1 } });

    const confirm = { planId: plan.planId, expectedRevision: plan.expectedRevision, confirm: true };
    const first = await post(withdraw, confirm);
    expect(first.status).toBe(202);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    const accepted = (await first.json()) as { operationId: string; operation: string };
    expect(accepted).toMatchObject({ operation: "withdraw" });
    const { operationId } = accepted;
    expect(((await (await post(withdraw, confirm)).json()) as { operationId: string }).operationId).toBe(operationId);
    expect((await listDeletions(database)).filter((row) => row.operation === "withdraw")).toHaveLength(1);

    await runDeletionWork(database);
    const receipt = await get(withdraw, `?id=${operationId}`);
    expect(receipt.status).toBe(200);
    expect(await receipt.json()).toMatchObject({ operationId, operation: "withdraw", status: "complete", remaining: 0 });
    const row = await sourceById(database, id);
    expect(row).toMatchObject({ status: "blocked" });
    expect(row?.locator).not.toBeNull();
    expect((await get(purge, `?id=${operationId}`)).status).toBe(404);
  });

  it("refuses the same malformed bodies as the purge door", async () => {
    for (const body of [{ target: { kind: "source", id: "x" }, dryRun: true, confirm: true }, { target: { kind: "session" }, dryRun: true }, { planId: "plan_x", expectedRevision: 1 }]) {
      const response = await post(withdraw, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_input", retryable: false });
    }
  });
});
