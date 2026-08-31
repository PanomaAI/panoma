import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sync = readFileSync(new URL("./md-sync.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/md/apply/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/(app)/p/[slug]/page.tsx", import.meta.url), "utf8");
const boton = readFileSync(new URL("../components/md-apply.tsx", import.meta.url), "utf8");

/**
 * The bridge for Claude Code, in the web halfway of the channel.
 *
 * The pair of this file is `apps/cli/src/md-bridge.test.ts`, and between the two they set the same
 * decision with different dashes: Claude Code only loads CLAUDE.md ("Claude Code reads CLAUDE.md,
 * not AGENTS.md", literal from its documentation, verified on August 28, 2026), so the block in
 * AGENTS.md needs a CLAUDE.md that imports it with the at sign. In the terminal, the bridge is
 * first used by `init` and not `sync`, because sync runs with hyphens. Here the dash goes
 * somewhere else: **the click**. Both actions of the button are a person's click, and both write
 * the bridge; the watcher, which only runs on each commit, can never write it.
 */
describe("el puente que escribe el clic", () => {
  it("syncProjectDoc solo lo escribe con la opción bridge, y sobre la ausencia", () => {
    expect(sync).toMatch(/if \(options\.bridge && picked\.file === "AGENTS\.md"\)/);
    expect(sync).toMatch(
      /if \(claude === undefined\) \{\s*\n\s*await writeFile\(join\(root, "CLAUDE\.md"\), CLAUDE_BRIDGE/,
    );
  });

  it("la ruta del botón lo pasa en las dos acciones", () => {
    expect(route).toMatch(/bridge: true/);
  });

  /*
    The guard that really matters: the watcher calls with the fixed form `create: false` and
    without `bridge`. If someone "unifies" the calls and the watcher begins to pass bridge, each
    commit of each monitored project could debut a file that no one asked for — and nothing will
    turn red, because the file it writes is innocent.
   */
  it("el vigía no puede escribirlo", () => {
    expect(sync).toMatch(/syncProjectDoc\(root, \{ create: false, analysis, database \}\)/);
    const vigia = /export async function syncManagedDoc[\s\S]*$/.exec(sync)?.[0] ?? "";
    expect(vigia).not.toContain("bridge");
  });

  it("y lo que escribe es la constante de core, no una plantilla local", () => {
    expect(sync).toMatch(/CLAUDE_BRIDGE,\n/);
  });
});

describe("el aviso de la ficha", () => {
  /*
    The same criterion as the `md check` track, with zero false positives: AGENTS.md present and
    CLAUDE.md absent. A CLAUDE.md linked by symlink appears as a file with content —the index
    reads it through the link— so it does not trigger the warning.
   */
  it("se enseña cuando hay AGENTS.md sin CLAUDE.md", () => {
    expect(page).toMatch(
      /files\.some\(\(file\) => file\.file === "AGENTS\.md"\) &&\s*\n\s*!agentsMd\.files\.some\(\(file\) => file\.file === "CLAUDE\.md"\)/,
    );
    expect(page).toMatch(/project\.mdBridgeMissing/);
  });

  it("y el botón cuenta el puente cuando lo estrena", () => {
    expect(boton).toMatch(/result\.data\.bridged/);
    expect(boton).toMatch(/project\.mdBridgeWritten/);
  });
});
