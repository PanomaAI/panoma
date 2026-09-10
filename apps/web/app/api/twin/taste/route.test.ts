import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readTaste, writeTaste } from "@panoma/core";
import { listBeliefs, schema, tasteScore, type Database } from "@panoma/db";

let database: Database;
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
const { POST } = await import("./route");
let home: string;
let close: () => Promise<void>;
const originalHome = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-teaching-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: "project-a", slug: "alpha", name: "Alpha", root: "/tmp/twin-alpha", identity: "git:alpha" },
    { id: "project-b", slug: "beta", name: "Beta", root: "/tmp/twin-beta", identity: null },
  ]);
});

afterAll(async () => {
  await close();
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  await database.delete(schema.beliefs);
  await writeTaste([]);
});

function request(body: unknown, crossSite = false) {
  return new Request("http://localhost:4173/api/twin/taste", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept-Language": "en", ...(crossSite ? { "Sec-Fetch-Site": "cross-site" } : {}) },
    body: JSON.stringify(body),
  });
}

const teaching = { statement: "Prefer inline editing for small changes.", topic: "design" };

describe("direct teaching reaches the portrait", () => {
  it("publishes an owner signature without inventing observations or a model correction", async () => {
    const response = await POST(request({ teach: teaching }));
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt.taught).toBe(1);
    const [belief] = await listBeliefs(database);
    expect(belief).toMatchObject({ id: receipt.beliefId, state: "signed", model: "owner", citations: [], support: { observations: 0, projects: 0, days: 0 } });
    expect(belief!.signedAt).toBeInstanceOf(Date);
    expect(belief!.publishedAs?.statement).toBe(teaching.statement);
    expect((await readTaste()).lines).toMatchObject([{ statement: teaching.statement }]);
    expect(await tasteScore(database)).toMatchObject({ corrections: 0, shown: 0, density: null });
  });

  it("keeps retries idempotent and preserves the original signature", async () => {
    const first = await (await POST(request({ teach: teaching }))).json();
    const second = await (await POST(request({ teach: { ...teaching, statement: `  ${teaching.statement}  ` } }))).json();
    expect(second).toMatchObject({ taught: 0, beliefId: first.beliefId });
    expect(await listBeliefs(database)).toHaveLength(1);
    expect((await readTaste()).lines).toHaveLength(1);
  });

  it("serializes two simultaneous signatures of the same criterion", async () => {
    const responses = await Promise.all([POST(request({ teach: teaching })), POST(request({ teach: teaching }))]);
    const receipts = await Promise.all(responses.map((response) => response.json()));
    expect(receipts[0].beliefId).toBe(receipts[1].beliefId);
    expect(await listBeliefs(database)).toHaveLength(1);
    expect((await readTaste()).lines).toHaveLength(1);
  });

  it("editing and vetoing your own criterion do not grade Twin's predictions", async () => {
    const receipt = await (await POST(request({ teach: teaching }))).json();
    await POST(request({ sign: [{ id: receipt.beliefId, statement: "Prefer inline for renaming." }] }));
    expect((await listBeliefs(database))[0]!.model).toBe("owner");
    await POST(request({ veto: [receipt.beliefId] }));
    expect(await tasteScore(database)).toMatchObject({ corrections: 0, shown: 0, density: null });
  });

  it("preserves scope, rejecting unknown or unstable projects instead of broadening a rule", async () => {
    expect((await POST(request({ teach: { ...teaching, slug: "missing" } }))).status).toBe(404);
    expect((await POST(request({ teach: { ...teaching, slug: "beta" } }))).status).toBe(400);
    expect(await listBeliefs(database)).toHaveLength(0);
    expect((await POST(request({ teach: { ...teaching, slug: "alpha" } }))).status).toBe(200);
    expect((await listBeliefs(database))[0]!.identity).toBe("git:alpha");
    expect((await readTaste()).lines[0]!.scope).toBe("Alpha");
  });

  it("rolls back the signature and preserves the file when the portrait is full", async () => {
    await writeTaste([{ topic: "design", statement: "x".repeat(2900), citations: [] }]);
    const before = await readTaste();
    const response = await POST(request({ teach: { ...teaching, statement: "a".repeat(300) } }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ taught: 0, signed: 0 });
    expect(await listBeliefs(database)).toHaveLength(0);
    expect((await readTaste()).lines).toEqual(before.lines);
  });

  it("rejects invalid teaching and cross-site requests before touching the portrait", async () => {
    for (const teach of [null, [], {}, { ...teaching, statement: " " }, { ...teaching, topic: "not a topic" }, { ...teaching, statement: "x".repeat(301) }, { ...teaching, slug: null }]) {
      expect((await POST(request({ teach }))).status).toBe(400);
    }
    expect((await POST(request({ teach: teaching }, true))).status).toBe(403);
    expect(await listBeliefs(database)).toHaveLength(0);
    expect((await readTaste()).lines).toHaveLength(0);
  });
});
