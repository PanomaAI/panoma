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

/**
 * The block is not allowed to contradict itself, and 'itself' is measured from the bytes.
 *
 * This lives beside the stability guard because it is the same failure seen from the other side.
 * That one exists because the block moved when reality had not; this one exists because the block
 * stood still while saying two different things about one reality. Both are failures of what the
 * file *claims*, and both are invisible while the block keeps composing itself perfectly.
 *
 * Measured in panoma's own repository on 8-Sep-2026, two lines apart in `AGENTS.md`:
 *
 *   - Dependencies: 37 direct · 5 outdated · 0 with security advisories
 *   - Advisories: `vitest` (GHSA-82fw-gwwq-j7x9)
 *
 * Neither number was invented. `projects.vuln_count`, which fed the first line, is written by
 * `summarize()` in `packages/enrich/src/refresh.ts` behind `if (row.isDev) continue`, so a dev
 * dependency never reaches it; the advisory list, which fed the second, joins
 * `project_dependencies` with no `is_dev` predicate. Two right answers to two different questions,
 * printed as one paragraph — and a block that a reader and every agent take as verified fact is
 * worse when it contradicts itself than when it says nothing.
 */
function readBack(block: string): {
  hasDepsRow: boolean;
  figure?: number;
  critical?: number;
  named?: number;
} {
  const deps = /^- Dependencies: .*$/m.exec(block)?.[0];
  const figure = deps ? /(\d+) with security advisories/.exec(deps) : null;
  const critical = deps ? /\((\d+) critical\)/.exec(deps) : null;

  /*
    The list is read the way a person reads it, counting the "and N more" tail too: the row shows
    six names at most, and a guard that only counted the visible ones would bless a block claiming
    six advisories while carrying forty.
   */
  const listed = /^- Advisories: (.*)$/m.exec(block);
  let named: number | undefined;
  if (listed) {
    const items = listed[1]!.split(" · ");
    const more = /^and (\d+) more$/.exec(items[items.length - 1] ?? "");
    named = more ? items.length - 1 + Number(more[1]) : items.length;
  }

  return {
    hasDepsRow: deps !== undefined,
    ...(figure ? { figure: Number(figure[1]) } : {}),
    ...(critical ? { critical: Number(critical[1]) } : {}),
    ...(named !== undefined ? { named } : {}),
  };
}

/** The complaint the block would deserve, or `undefined` if it holds together. */
function contradiction(block: string): string | undefined {
  const { hasDepsRow, figure, critical, named } = readBack(block);
  if (named !== undefined && hasDepsRow) {
    if (figure === undefined) return `names ${named} advisories and counts none`;
    if (figure !== named) return `counts ${figure} advisories and names ${named}`;
  }
  if (critical !== undefined && figure !== undefined && critical > figure) {
    return `${critical} critical out of ${figure}`;
  }
  return undefined;
}

describe("the block cannot contradict itself", () => {
  it("the exact rendering of 8-Sep-2026 is no longer possible", () => {
    const block = renderPanomaBlock({
      ...BASE,
      deps: { direct: 37, outdated: 5, vulns: 0 },
      advisories: [{ package: "vitest", id: "GHSA-82fw-gwwq-j7x9" }],
    });

    expect(block).not.toContain("0 with security advisories");
    expect(block).toContain("37 direct · 5 outdated · 1 with security advisories");
    // And the advisory is still named: the fix is one question answered once, not a line deleted.
    expect(block).toContain("GHSA-82fw-gwwq-j7x9");
    expect(contradiction(block)).toBeUndefined();
  });

  /*
    The invariant, not the example. Every row here is a shape that a caller can compose today —
    `composeBlockData` copies `vulns`, `critical` and `advisories` from a `CatalogMdContext` that
    reaches the CLI over HTTP, so 'the caller got it right' is not something this renderer may
    assume.
   */
  const shapes: [string, PanomaBlockData][] = [
    ["a counter behind its own list", { ...BASE, advisories: [{ package: "vitest", id: "GHSA-82fw-gwwq-j7x9" }] }],
    [
      "a counter ahead of its own list",
      { ...BASE, deps: { direct: 36, outdated: 6, vulns: 9 }, advisories: [{ package: "axios", id: "GHSA-a" }] },
    ],
    [
      "a list longer than the six the row shows",
      {
        ...BASE,
        deps: { direct: 36, outdated: 6, vulns: 0 },
        advisories: Array.from({ length: 8 }, (_, i) => ({ package: `p${i}`, id: `GHSA-${i}` })),
      },
    ],
    [
      "more critical than there are advisories at all",
      {
        ...BASE,
        deps: { direct: 36, outdated: 6, vulns: 0, critical: 3 },
        advisories: [{ package: "axios", id: "GHSA-a" }],
      },
    ],
    ["nothing to say about advisories", { ...BASE, deps: { direct: 36, outdated: 6 } }],
    ["an honest zero", BASE],
    [
      "a counter that already agreed with its list",
      {
        ...BASE,
        deps: { direct: 36, outdated: 6, vulns: 2, critical: 1 },
        advisories: [
          { package: "axios", id: "GHSA-b" },
          { package: "lodash", id: "GHSA-a" },
        ],
      },
    ],
  ];

  it.each(shapes)("holds with %s", (_name, data) => {
    expect(contradiction(renderPanomaBlock(data))).toBeUndefined();
  });

  /*
    And the other side again, so this is not read as "the row was silenced". A zero that was
    actually asked for is still printed, and data that already agreed is not moved by the guard —
    if it were, every AGENTS.md in the catalog would have shown a diff for nothing.
   */
  it("keeps the zero that was asked for, and does not move data that already agreed", () => {
    expect(renderPanomaBlock(BASE)).toContain("0 with security advisories");
    expect(
      renderPanomaBlock({
        ...BASE,
        deps: { direct: 36, outdated: 6, vulns: 2, critical: 1 },
        advisories: [
          { package: "axios", id: "GHSA-b" },
          { package: "lodash", id: "GHSA-a" },
        ],
      }),
    ).toContain("36 direct · 6 outdated · 2 with security advisories (1 critical)");
  });
});
