import { describe, expect, it } from "vitest";
import { renderPanomaBlock, type PanomaBlockData } from "./agentsmd";

/**
 * The managed block has to be stable, and 'stable' must be measured from the file.
 *
 * `AGENTS.md` is a file that is versioned —that is how agents of a team receive it— and that
 * Panoma rewrites by itself. Both things at the same time only work if what it writes changes when
 * something important has changed, and not before.
 *
 * And it failed precisely in that. The row of agents carried the number of commits for each one,
 * which increases with **each commit**, including the one that saves the file itself. Measured in
 * the repository of Panoma on August 25, 2026: its `AGENTS.md` was created, committed, and
 * `git status` already considered it modified; two commits later the number had gone up by two. A
 * permanent dirty tree for anyone who versions theirs.
 *
 * No one noticed it because the block kept composing itself perfectly: the failure was not a
 * mistake, it was a decision about what is 'the same'.
 */
const BASE: PanomaBlockData = {
  name: "panoma-monorepo",
  stack: ["TypeScript", "Node.js"],
  commands: [
    { purpose: "install", command: "pnpm install" },
    { purpose: "tests", command: "pnpm run test" },
  ],
  deps: { direct: 36, outdated: 6, vulns: 0 },
  openTasks: 3,
  agents: [
    { name: "Claude", commits: 340 },
    { name: "Cursor", commits: 12 },
  ],
};

describe("el bloque gestionado no se mueve solo", () => {
  it("commitear no lo cambia", () => {
    /*
      The entire test, stated with data: the same reality after two commits is the same reality.
      If this breaks, someone put a number that increases by itself back into the block, and the
      symptom the user will see will be `M AGENTS.md` forever.
     */
    const despues: PanomaBlockData = {
      ...BASE,
      agents: [
        { name: "Claude", commits: 342 },
        { name: "Cursor", commits: 12 },
      ],
    };
    expect(renderPanomaBlock(despues)).toBe(renderPanomaBlock(BASE));
  });

  it("y sigue diciendo quién ha trabajado aquí, que es lo que le sirve al que llega", () => {
    const block = renderPanomaBlock(BASE);
    expect(block).toContain("Claude");
    expect(block).toContain("Cursor");
    // The order is still decided by the number, so the most present one goes first.
    expect(block.indexOf("Claude")).toBeLessThan(block.indexOf("Cursor"));
  });

  it("regenerarlo sin que nada haya cambiado da los mismos bytes", () => {
    expect(renderPanomaBlock(BASE)).toBe(renderPanomaBlock({ ...BASE }));
  });

  /*
    And the other side, so that this is not read as "the block never changes." What does need to
    move, moves: when a security notice or a task appears, the diff is the news and you want to
    see it in the history.
   */
  it("pero lo que importa sí lo mueve", () => {
    expect(renderPanomaBlock({ ...BASE, deps: { direct: 36, outdated: 6, vulns: 2 } })).not.toBe(
      renderPanomaBlock(BASE),
    );
    expect(renderPanomaBlock({ ...BASE, openTasks: 4 })).not.toBe(renderPanomaBlock(BASE));
    expect(
      renderPanomaBlock({ ...BASE, agents: [{ name: "Codex", commits: 340 }] }),
    ).not.toBe(renderPanomaBlock(BASE));
  });
});
