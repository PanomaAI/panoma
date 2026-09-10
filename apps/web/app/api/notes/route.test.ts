import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listProjectNotes, proposeNote, schema, type Database } from "@panoma/db";
import { patrolSentinels } from "@/lib/sentinels";

let database: Database;
let close: () => Promise<void>;
let home: string;
let root: string;
const originalHome = process.env["PANOMA_HOME"];
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { POST } = await import("./route");

function request(body: unknown) {
  return new Request("http://localhost:4173/api/notes", {
    method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": "en" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-note-routes-"));
  root = join(home, "project");
  await mkdir(join(root, "src"), { recursive: true });
  process.env["PANOMA_HOME"] = home;
  ({ db: database, close } = await (await import("@panoma/db/client")).openDatabase());
  await database.insert(schema.projects).values([
    { id: "notes-a", slug: "notes-a", name: "A", root },
    { id: "notes-b", slug: "notes-b", name: "B", root: join(home, "other") },
  ]);
});

beforeEach(async () => {
  await database.delete(schema.notes);
  await writeFile(join(root, "src", "reader.ts"), "export const local = true;\n");
});

afterAll(async () => {
  await close();
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe("project memory approval boundary", () => {
  it.each([null, [], { slug: 3 }, { slug: "notes-a", action: "add", body: 4 },
    { slug: "notes-a", action: "add", body: "Keep it local.", where: [] }])("rejects malformed input %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
  });

  it("cannot approve or discard a note through another project's slug", async () => {
    const proposal = await proposeNote(database, { projectId: "notes-b", body: "Keep it local.", createdBy: "test" });
    if (!("id" in proposal)) throw new Error("fixture rejected");
    for (const action of ["approve", "discard"]) {
      expect((await POST(request({ slug: "notes-a", action, id: proposal.id }))).status).toBe(409);
    }
    expect((await listProjectNotes(database, "notes-b", ["proposed"]))).toHaveLength(1);
  });

  it("stores owner path rules with their anchors before returning success", async () => {
    const result = await POST(request({ slug: "notes-a", action: "add", body: "Keep reads local.", where: "src/reader.ts" }));
    expect(result.status).toBe(200);
    const [note] = await listProjectNotes(database, "notes-a");
    expect(note?.trigger).toBe("src/reader.ts");
    expect(note?.sentinels).toEqual([{ kind: "path_exists", target: "src/reader.ts", expected: true }]);
  });

  it("reapproval replaces a broken anchor with an empty set instead of immediately challenging it again", async () => {
    await POST(request({ slug: "notes-a", action: "add", body: "Use src/reader.ts for local reads." }));
    await rm(join(root, "src", "reader.ts"));
    expect((await patrolSentinels(database, { id: "notes-a", root })).challenged).toHaveLength(1);
    const [note] = await listProjectNotes(database, "notes-a", ["challenged"]);
    const result = await POST(request({ slug: "notes-a", action: "approve", id: note!.id }));
    expect(result.status).toBe(200);
    expect((await listProjectNotes(database, "notes-a"))[0]?.sentinels).toEqual([]);
    expect((await patrolSentinels(database, { id: "notes-a", root })).challenged).toEqual([]);
  });
});
