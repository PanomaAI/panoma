import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? sources(join(directory, entry.name))
    : /\.tsx?$/.test(entry.name) ? [join(directory, entry.name)] : []));
  return nested.flat();
}

it("reserves single-segment keys for desktop apps and two segments for installed app actions", async () => {
  const root = process.cwd();
  const files = (await Promise.all(["apps/web/lib", "apps/cli/src"].map((path) => sources(join(root, path))))).flat();
  const violations: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/(["'`])app:([^"'`\r\n]+)\1/g)) {
      if (!match[2]!.includes(":")) violations.push(`${relative(root, file)}: ${match[0]}`);
    }
  }
  expect(violations).toEqual([]);
});
