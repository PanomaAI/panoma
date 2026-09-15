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

  /*
    Delivery C (14-Sep-2026): an approval may name the note it replaces and until when it holds.
    The legacy body stays byte-identical in what it sends and what it gets; only a body that
    carries the new keys reaches the new refusals, which speak the machine shape of the memory
    doors.
   */
  describe("succession and expiry on the approval", () => {
    async function proposed(body: string): Promise<string> {
      const proposal = await proposeNote(database, { projectId: "notes-a", body, createdBy: "test" });
      if (!("id" in proposal)) throw new Error("fixture rejected");
      return proposal.id;
    }

    it("T52: approving a successor while the predecessor moved answers 409 stale_revision and approves nothing", async () => {
      expect((await POST(request({ slug: "notes-a", action: "add", body: "Reads stay local." }))).status).toBe(200);
      const [predecessor] = await listProjectNotes(database, "notes-a", ["approved"]);
      const successor = await proposed("Reads stay local, and cached.");
      // The predecessor moves — discarded here, a new revision — before the successor is decided.
      expect((await POST(request({ slug: "notes-a", action: "discard", id: predecessor!.id }))).status).toBe(200);
      const stale = await POST(request({ slug: "notes-a", action: "approve", id: successor, supersedesId: predecessor!.id, expectedRevision: predecessor!.memoryRev }));
      expect(stale.status).toBe(409);
      expect(stale.headers.get("cache-control")).toBe("private, no-store");
      expect(await stale.json()).toMatchObject({ code: "stale_revision", error: expect.stringContaining("nothing was approved"), hint: expect.any(String), retryable: false });
      const after = await listProjectNotes(database, "notes-a", ["approved", "proposed", "discarded", "superseded"], { includeExpired: true });
      expect(after.find((note) => note.id === successor)).toMatchObject({ status: "proposed", supersedesId: null });
      expect(after.find((note) => note.id === predecessor!.id)).toMatchObject({ status: "discarded", memoryRev: predecessor!.memoryRev + 1 });
    });

    it("approves a successor at the predecessor's revision, supersedes it, and keeps the owner's expiry as the end of that day in UTC", async () => {
      expect((await POST(request({ slug: "notes-a", action: "add", body: "Reads stay local." }))).status).toBe(200);
      const [predecessor] = await listProjectNotes(database, "notes-a", ["approved"]);
      const successor = await proposed("Reads stay local, and cached.");
      const approved = await POST(request({ slug: "notes-a", action: "approve", id: successor, supersedesId: predecessor!.id, expectedRevision: predecessor!.memoryRev, validUntil: "2026-12-31" }));
      expect(approved.status).toBe(200);
      expect(await approved.json()).toEqual({ ok: true });
      const after = await listProjectNotes(database, "notes-a", ["approved", "superseded"], { includeExpired: true });
      expect(after.find((note) => note.id === successor)).toMatchObject({ status: "approved", supersedesId: predecessor!.id, validUntil: new Date("2026-12-31T23:59:59.999Z") });
      expect(after.find((note) => note.id === predecessor!.id)).toMatchObject({ status: "superseded", memoryRev: predecessor!.memoryRev + 1 });
      // Only the successor is eligible now.
      expect((await listProjectNotes(database, "notes-a")).map((note) => note.id)).toEqual([successor]);
      // An expiry in the past leaves the note approved, kept for the owner's screen, and not eligible.
      const expiring = await proposed("Until yesterday.");
      expect((await POST(request({ slug: "notes-a", action: "approve", id: expiring, validUntil: "2020-01-01" }))).status).toBe(200);
      expect((await listProjectNotes(database, "notes-a")).map((note) => note.id)).toEqual([successor]);
      expect((await listProjectNotes(database, "notes-a", ["approved"], { includeExpired: true })).map((note) => note.id).sort()).toEqual([expiring, successor].sort());
    });

    it("refuses the new keys on a discard, a predecessor without its revision, a successor of itself and a day that is not one, by name", async () => {
      const id = await proposed("Reads stay local.");
      const cases: [Record<string, unknown>, string][] = [
        [{ action: "discard", id, validUntil: "2026-12-31" }, "supersedesId, expectedRevision and validUntil belong to an approval."],
        [{ action: "approve", id, supersedesId: "other" }, "expectedRevision must be the revision of the replaced note you read."],
        [{ action: "approve", id, expectedRevision: 1 }, "supersedesId names the approved note this one replaces."],
        [{ action: "approve", id, supersedesId: id, expectedRevision: 1 }, "supersedesId names the approved note this one replaces."],
        [{ action: "approve", id, supersedesId: "other", expectedRevision: 0 }, "expectedRevision must be the revision of the replaced note you read."],
        [{ action: "approve", id, validUntil: "2026-02-31" }, "validUntil is the last day the note holds, as YYYY-MM-DD, or null."],
        [{ action: "approve", id, validUntil: 20261231 }, "validUntil is the last day the note holds, as YYYY-MM-DD, or null."],
      ];
      for (const [body, error] of cases) {
        const response = await POST(request({ slug: "notes-a", ...body }));
        expect(response.status, JSON.stringify(body)).toBe(400);
        expect(await response.json()).toMatchObject({ code: "invalid_input", error, retryable: false });
      }
      expect((await listProjectNotes(database, "notes-a", ["proposed"])).map((note) => note.id)).toEqual([id]);
      // A predecessor that is not approved at all is the same stale answer: nothing to replace at that revision.
      const gone = await POST(request({ slug: "notes-a", action: "approve", id, supersedesId: "nowhere", expectedRevision: 1 }));
      expect(gone.status).toBe(409);
      expect(await gone.json()).toMatchObject({ code: "stale_revision" });
      expect((await listProjectNotes(database, "notes-a", ["proposed"])).map((note) => note.id)).toEqual([id]);
    });
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
