import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, type Database } from "@panoma/db";
import { memoryFiles, projectMemoryForFiles } from "./project-memory-files";

let home: string;
let database: Database;
let close: () => Promise<void>;
const previousHome = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-files-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: "memory-files", slug: "memory-files", name: "Memory files", root: "/tmp/memory-files" },
    { id: "other-files", slug: "other-files", name: "Other files", root: "/tmp/other-files" },
  ]);
  await database.insert(schema.notes).values([
    { id: "scoped", projectId: "memory-files", body: "Preserve route behavior.", createdBy: "human", status: "approved", trigger: "app/(group)/**" },
    { id: "exact", projectId: "memory-files", body: "Keep the parameter.", createdBy: "human", status: "approved", trigger: "app/(group)/[id]/page.tsx" },
    { id: "global", projectId: "memory-files", body: "Already in the brief.", createdBy: "human", status: "approved" },
    { id: "pending", projectId: "memory-files", body: "Unapproved text.", createdBy: "agent", status: "proposed", trigger: "app/(group)/**" },
    { id: "challenged", projectId: "memory-files", body: "Invalidated text.", createdBy: "agent", status: "challenged", trigger: "app/(group)/**" },
    { id: "other", projectId: "other-files", body: "Another project.", createdBy: "human", status: "approved", trigger: "app/(group)/**" },
  ]);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

describe("project rules for a client's planned files", () => {
  it("delivers approved applicable rules once across files, with matching scope evidence", async () => {
    const files = memoryFiles(["app/(group)/[id]/page.tsx", "app/(group)/layout.tsx", "app/(group)/layout.tsx"]);
    const notes = await projectMemoryForFiles(database, "memory-files", files);
    expect(notes.map((note) => note.id).sort()).toEqual(["exact", "scoped"]);
    expect(notes.find((note) => note.id === "scoped")!.files).toEqual(files);
    expect(notes.find((note) => note.id === "exact")!.files).toEqual([files[0]]);
    expect(await projectMemoryForFiles(database, "memory-files", ["app/(group)-other/page.tsx"])).toEqual([]);
    expect(await projectMemoryForFiles(database, "memory-files", [])).toEqual([]);
  });

  it("accepts real filenames while rejecting traversal, control input and unbounded requests", () => {
    expect(memoryFiles(["docs/My guide.md", "app/(group)/[id]/page.tsx", "docs/diseño.md"])).toHaveLength(3);
    for (const value of [null, "src/a.ts", ["../outside"], ["/etc/passwd"], ["a/../b"], ["a\\b"], ["a\nb"], ["src/**"], Array(31).fill("src/a.ts")]) {
      expect(() => memoryFiles(value)).toThrow(RangeError);
    }
    expect(memoryFiles(undefined)).toEqual([]);
  });
});
