import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addHumanNote, createAgent, listProjectNotes, schema, type Database } from "@panoma/db";
import { extractNoteAnchors } from "@/lib/sentinels";

let database: Database;
let close: () => Promise<void>;
let home: string;
let root: string;
let agentId: string;
const originalHome = process.env["PANOMA_HOME"];
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
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
  await database.delete(schema.notes);
  await database.delete(schema.servings);
  await writeFile(join(root, "src", "nested", "reader.ts"), "export const local = true;\n");
});
afterAll(async () => {
  await close();
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  await rm(home, { recursive: true, force: true });
});

async function remember(trigger?: string) {
  const body = "Use src/nested/reader.ts for local reads.";
  const sentinels = await extractNoteAnchors({ body, root, trigger });
  await addHumanNote(database, { projectId: "delivery", body, trigger, sentinels });
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
});
