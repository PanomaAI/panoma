import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addHumanNote, beginDeletion, createAgent, listProjectNotes, runDeletionBatches, schema, type Database } from "@panoma/db";
import { extractNoteAnchors } from "@/lib/sentinels";

let database: Database;
let close: () => Promise<void>;
let home: string;
let root: string;
let agentId: string;
const originalHome = process.env["PANOMA_HOME"];
const mocks = vi.hoisted(() => ({ quarantine: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }), memoryQuarantine: mocks.quarantine }));
vi.mock("@/lib/agent-auth", () => ({ requireAgent: async () => ({ database, agent: { id: agentId, name: "test" } }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
vi.mock("@/lib/memory-ablation", () => ({ ablationEnabled: () => false, ablationArm: () => "served" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { GET, POST } = await import("./route");

async function reread(body: unknown = { slug: "delivery" }) {
  const response = await POST(new Request("http://localhost:4173/api/agent/notes", {
    method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": "en" }, body: JSON.stringify(body),
  }));
  expect(response).toBeInstanceOf(Response);
  return response!;
}
function touching(path: string) {
  return GET(new Request(`http://localhost:4173/api/agent/notes?${new URLSearchParams({ cwd: root, touching: path })}`));
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-note-delivery-"));
  root = join(home, "project");
  await mkdir(join(root, "src", "nested"), { recursive: true });
  process.env["PANOMA_HOME"] = home;
  ({ db: database, close } = await (await import("@panoma/db/client")).openDatabase());
  await database.insert(schema.projects).values({ id: "delivery", slug: "delivery", name: "Delivery", root });
  agentId = (await createAgent(database, { name: "test" })).id;
});
beforeEach(async () => {
  await database.delete(schema.memoryDeletions);
  await database.delete(schema.memoryRevisions);
  await database.delete(schema.notes);
  await database.delete(schema.servings);
  await writeFile(join(root, "src", "nested", "reader.ts"), "export const local = true;\n");
  mocks.quarantine.mockResolvedValue({ quarantined: false });
});
afterAll(async () => {
  await close();
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  await rm(home, { recursive: true, force: true });
});

async function remember(trigger?: string, body = "Use src/nested/reader.ts for local reads."): Promise<string> {
  const sentinels = await extractNoteAnchors({ body, root, trigger });
  const saved = await addHumanNote(database, { projectId: "delivery", body, trigger, sentinels });
  if (!("id" in saved)) throw new Error(`fixture refused: ${saved.refused}`);
  return saved.id;
}

async function withdraw(noteId: string) {
  const begun = await beginDeletion(database, home, { operation: "withdraw", targets: [{ kind: "item", itemKind: "note", id: noteId }], scope: { projectId: "delivery" } });
  if ("refused" in begun) throw new Error(begun.reason);
  await runDeletionBatches(database, begun.id);
}

describe("fresh project memory delivery", () => {
  it("checks a nested path before each hook delivery even without a watcher event", async () => {
    await remember("src/nested/reader.ts");
    expect((await (await touching("src/nested/reader.ts")).json()).notes).toHaveLength(1);
    await rm(join(root, "src", "nested", "reader.ts"));
    expect((await (await touching("src/nested/reader.ts")).json()).notes).toEqual([]);
    expect(await listProjectNotes(database, "delivery", ["challenged"])).toHaveLength(1);
  });

  it("checks ordinary rereads and separates ordinary deliveries from experiment enrollment", async () => {
    await remember();
    expect((await (await reread()).json()).notes).toHaveLength(1);
    const [serving] = await database.select().from(schema.servings);
    expect(serving?.experimentId).toBeNull();
    await rm(join(root, "src", "nested", "reader.ts"));
    expect((await (await reread()).json()).notes).toEqual([]);
    expect(await database.select().from(schema.servings)).toHaveLength(1);
  });

  it.each([null, { slug: [] }, { slug: "delivery", note: 4 }, { slug: "delivery", where: [] }])("rejects malformed memory request %j", async (body) => {
    expect((await reread(body)).status).toBe(400);
  });

  it("rejects paths outside the project", async () => {
    expect((await touching("../private.txt")).status).toBe(400);
  });

  /*
    The legacy roads under the deletion contract (A18, T54, §23.2.7): a withdrawn note travels
    neither on the signal's GET nor on the reread, and the scale's row names only what travelled.
   */
  it("A18/T54: a withdrawn note no longer travels on the signal road nor on the reread", async () => {
    const kept = await remember(undefined, "Kept and awake.");
    const gone = await remember(undefined, "Withdrawn and awake.");
    const sleeping = await remember("src/nested/reader.ts");
    expect((await (await touching("src/nested/reader.ts")).json()).notes.map((note: { id: string }) => note.id)).toEqual([sleeping]);
    expect((await (await reread()).json()).notes).toHaveLength(2);

    await withdraw(gone);
    await withdraw(sleeping);
    expect((await (await touching("src/nested/reader.ts")).json()).notes).toEqual([]);
    const body = await (await reread()).json();
    expect(body.notes).toEqual([{ body: "Kept and awake.", createdBy: "human" }]);
    const rows = await database.select().from(schema.servings);
    expect(rows.at(-1)?.noteIds).toEqual([kept]);
    // Ordinary catalog readers obey the same barrier; withdrawal retains the underlying rows.
    expect((await listProjectNotes(database, "delivery")).map((note) => note.id)).toEqual([kept]);
    expect(await database.select().from(schema.notes)).toHaveLength(3);
  });

  it("T56: under quarantine the signal road and the reread answer 503, and the proposal door stays open", async () => {
    await remember("src/nested/reader.ts");
    await remember(undefined, "Awake.");
    mocks.quarantine.mockResolvedValue({ quarantined: true, reason: "behind" });
    const signal = await touching("src/nested/reader.ts");
    expect(signal.status).toBe(503);
    expect(await signal.json()).toMatchObject({ code: "unavailable", retryable: true, error: expect.stringContaining("behind") });
    const read = await reread();
    expect(read.status).toBe(503);
    expect(await read.json()).toMatchObject({ code: "unavailable", retryable: true });
    expect(await database.select().from(schema.servings)).toHaveLength(0);
    const proposed = await reread({ slug: "delivery", note: "A proposal under quarantine." });
    expect(proposed.status).toBe(200);
    expect(await proposed.json()).toMatchObject({ proposed: true });
  });
});
