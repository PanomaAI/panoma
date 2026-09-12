import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveProject } from "./agents";
import type { Database } from "./client";
import * as t from "./schema";

/**
 * The project an agent stands in, from its folder. The exact root first; then the deepest root
 * the folder lies under, which is what an agent in `packages/core` of a monorepo needs. The
 * prefix match was a `like` pattern until 12-Sep-2026, and in a `like` pattern a backslash is
 * the escape character: a Windows root never matched a subfolder of itself, and an agent there
 * resolved its project only through the remote.
 */
let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const originalHome = process.env.PANOMA_HOME;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-resolve-db-"));
  process.env.PANOMA_HOME = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});
afterAll(async () => {
  await close?.();
  if (originalHome === undefined) delete process.env.PANOMA_HOME;
  else process.env.PANOMA_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.delete(t.projects);
  await db.insert(t.projects).values([
    { id: "posix", slug: "posix", name: "Posix", root: "/work/lemonade", identity: "git:posix" },
    { id: "posix-inner", slug: "posix-inner", name: "Inner", root: "/work/lemonade/packages/core", identity: "git:inner" },
    { id: "windows", slug: "windows", name: "Windows", root: "C:\\Users\\ana\\lemonade", identity: "git:windows" },
    { id: "wild", slug: "wild", name: "Wild", root: "/work/100%_done", identity: "git:wild" },
  ]);
});

describe("resolveProject by folder", () => {
  it("takes the exact root, then the deepest root the folder lies under", async () => {
    expect((await resolveProject(db, { cwd: "/work/lemonade" }))?.id).toBe("posix");
    expect((await resolveProject(db, { cwd: "/work/lemonade/apps/web" }))?.id).toBe("posix");
    expect((await resolveProject(db, { cwd: "/work/lemonade/packages/core/src" }))?.id).toBe("posix-inner");
    // A sibling that merely starts with the same letters is not inside it.
    expect(await resolveProject(db, { cwd: "/work/lemonade-2/src" })).toBeUndefined();
  });

  it("matches a Windows root under a subfolder spelled either way", async () => {
    expect((await resolveProject(db, { cwd: "C:\\Users\\ana\\lemonade\\apps\\web" }))?.id).toBe("windows");
    expect((await resolveProject(db, { cwd: "C:\\Users\\ana\\lemonade/apps/web" }))?.id).toBe("windows");
    expect(await resolveProject(db, { cwd: "C:\\Users\\ana\\lemonade-2\\src" })).toBeUndefined();
  });

  it("reads a root with a pattern character as letters, not as a wildcard", async () => {
    expect((await resolveProject(db, { cwd: "/work/100%_done/src" }))?.id).toBe("wild");
    expect(await resolveProject(db, { cwd: "/work/1000-done/src" })).toBeUndefined();
  });
});
