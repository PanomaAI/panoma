import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No page can read secrets while it is rendering.
 *
 * It's not a style preference: **in development mode, Next puts what a server component reads
 * inside the RSC payload that travels to the browser.** Measured in this same application: `/ai`
 * was a server component that called `readConfig()` and only passed the masked keys to the client,
 * and yet the entire `ai.json` —with the key in clear— appeared inside `self.__next_f` in HTML. In
 * the production build, this doesn't happen; the problem is that `panoma up` starts `next dev`, so
 * the mode that filters is exactly the one everyone uses.
 *
 * The lesson, which is what this test sets: **the leak is not in what you render, it is in what you
 * read.** No care in choosing props saves a render that opens a file with secrets inside. What
 * needs to be read is read from a API path, the answer to which is not part of any RSC payload.
 *
 * If this test turns red, the solution is **not** to add the module to the list: it is to move
 * that reading to `app/api/…` and have the page request it already masked, like `/ai` does.
 */

/** What can never appear in the render of a page. Everyone reads something that burns. */
const FORBIDDEN = [
  // Model keys, in clear, in `~/.panoma/ai.json`.
  "@panoma/ai",
  // And their loose names, in case one day they are imported from somewhere else.
  "readConfig",
  "resolveCredential",
];

const ROOT = join(import.meta.dirname, "..", "app");

async function pages(directory: string): Promise<string[]> {
  const foundSet: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    // `api` is left out on purpose: **that is exactly where these readings should live.**
    if (entry.isDirectory()) {
      if (entry.name === "api") continue;
      foundSet.push(...(await pages(path)));
    } else if (entry.name === "page.tsx" || entry.name === "layout.tsx") {
      foundSet.push(path);
    }
  }
  return foundSet;
}

describe("las páginas no leen secretos durante el render", () => {
  it("hay páginas que revisar", async () => {
    // A broken run would leave the test in green without checking anything, which is the worst way
    // to have a guardian.
    expect((await pages(ROOT)).length).toBeGreaterThan(5);
  });

  it("ninguna página toca el lector de credenciales", async () => {
    const culprits: string[] = [];
    for (const path of await pages(ROOT)) {
      const content = await readFile(path, "utf8");
      for (const señal of FORBIDDEN) {
        if (content.includes(señal)) culprits.push(`${path.split("/app/")[1]} → ${señal}`);
      }
    }
    expect(culprits).toEqual([]);
  });
});
