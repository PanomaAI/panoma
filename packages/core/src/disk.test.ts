import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { walkSizes } from "./disk";

/**
 * The own past has the same contract as `du`: each directory in the tree appears with its
 * accumulated total. It is the one measured in Windows, so it is tested directly.
 */
describe("walkSizes", () => {
  let root: string;

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("acumula de las hojas hacia arriba y lista cada directorio", async () => {
    root = await mkdtemp(join(tmpdir(), "panoma-disk-"));
    await writeFile(join(root, "a.txt"), "12345");
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "sub", "b.txt"), "1234567890");

    const sizes = await walkSizes(root);

    expect(sizes.get(join(root, "sub"))).toBe(10);
    expect(sizes.get(root)).toBe(15);
  });

  it("no sigue enlaces simbólicos, que es lo que evita los ciclos", async () => {
    const dir = await mkdtemp(join(tmpdir(), "panoma-disk-link-"));
    try {
      await writeFile(join(dir, "real.txt"), "abc");
      await symlink(dir, join(dir, "bucle"));

      const sizes = await walkSizes(dir);

      expect(sizes.get(dir)).toBe(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
