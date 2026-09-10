import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appsDir, assertManagedPath, insideDir, layoutFor } from "./layout";

let home: string;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "panoma-app-layout-")); vi.stubEnv("PANOMA_HOME", home); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }); });

describe("app directories", () => {
  it("moves application binaries and data together with PANOMA_HOME", () => {
    expect(appsDir()).toBe(join(home, "apps"));
    expect(layoutFor("panoma-video").data).toBe(join(home, "video"));
    expect(layoutFor("panoma-video").current).toBe(join(home, "apps", "panoma-video", "current.json"));
  });
  it("accepts the directory itself and descendants, rejects siblings sharing its prefix", async () => {
    const root = join(home, "a");
    const sibling = join(home, "ab");
    await mkdir(root); await mkdir(sibling); await writeFile(join(root, "file"), "ok");
    expect(await insideDir(root, root)).toBe(true);
    expect(await insideDir(root, join(root, "file"))).toBe(true);
    expect(await insideDir(root, sibling)).toBe(false);
    expect(await insideDir(root, join(root, "..", "ab"))).toBe(false);
  });
  /*
    A dotfile directory kept on another volume behind a link is a normal arrangement, and it used
    to make every single app operation fail with `managed-path-is-symlink`.
   */
  it("works when the home itself is a link, and still refuses one inside it", async () => {
    const box = await mkdtemp(join(tmpdir(), "panoma-app-linked-home-"));
    try {
      const real = join(box, "store");
      const linked = join(box, "home");
      await mkdir(real);
      await symlink(real, linked, process.platform === "win32" ? "junction" : "dir");
      vi.stubEnv("PANOMA_HOME", linked);
      await expect(assertManagedPath(join(linked, "apps", "panoma-video", "current.json"))).resolves.toBeUndefined();
      await mkdir(join(real, "apps"), { recursive: true });
      await symlink(box, join(real, "apps", "escape"), process.platform === "win32" ? "junction" : "dir");
      await expect(assertManagedPath(join(linked, "apps", "escape", "current.json")))
        .rejects.toThrow("managed-path-is-symlink");
      await expect(assertManagedPath(join(box, "elsewhere"))).rejects.toThrow("path-outside-home");
    } finally {
      vi.stubEnv("PANOMA_HOME", home);
      await rm(box, { recursive: true, force: true });
    }
  });
  it("rejects a symlink that escapes and refuses mutations through managed symlinks", async () => {
    const root = join(home, "apps");
    const outside = join(home, "outside");
    await mkdir(root); await mkdir(outside);
    await symlink(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
    expect(await insideDir(root, join(root, "escape"))).toBe(false);
    await expect(assertManagedPath(join(root, "escape", "future-file"))).rejects.toThrow("managed-path-is-symlink");
  });
});
