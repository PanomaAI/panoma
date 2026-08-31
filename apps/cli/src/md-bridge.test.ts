import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const comando = readFileSync(new URL("./md-command.ts", import.meta.url), "utf8");

/**
 * Let the block also reach the agent who does not read AGENTS.md.
 *
 * Claude Code only loads CLAUDE.md — its documentation literally says: «Claude Code reads
 * CLAUDE.md, not AGENTS.md» (verified on August 28, 2026). So a `md init` that launches AGENTS.md
 * in a project without CLAUDE.md wrote an invisible file for the agent with the most commits in
 * this same catalog, and nothing turned red: the block was perfect, only without a reader.
 *
 * The bridge is `CLAUDE_BRIDGE` (core): a CLAUDE.md whose first line imports AGENTS.md with the at
 * sign. The command is read as text, in the house style, to set the three decisions in a way that
 * they have no other way of being executed. The web half — the tab button, where the line does not
 * pass through init/sync but through the click — is set by its pair,
 * `apps/web/lib/md-bridge.test.ts`.
 */
describe("el puente que escribe md init", () => {
  /*
    Only init, and only towards AGENTS.md. `sync` regenerates the block and nothing else —
    creating new files in each sync would turn the watcher into a writer of new files, which is
    exactly what the init opt-in exists to prevent.
   */
  it("solo lo escribe init, y solo cuando el bloque vive en AGENTS.md", () => {
    expect(comando).toMatch(/action === "init" && picked\.file === "AGENTS\.md"/);
  });

  /*
    And only about the absence. An already existing CLAUDE.md is the user's prose, even if it's a
    link that doesn't work: rewriting it would be exactly the 'do not touch their prose' broken.
    There, the remedy is the `md check` track, which warns without touching.
   */
  it("y solo si CLAUDE.md no existe: el fichero del usuario no se toca", () => {
    expect(comando).toMatch(
      /if \(claude === undefined\) \{\s*\n\s*await writeFile\(join\(target, "CLAUDE\.md"\), CLAUDE_BRIDGE/,
    );
  });

  it("el puente que escribe es la constante de core, no una plantilla local", () => {
    expect(comando).toContain("CLAUDE_BRIDGE,");
    expect(comando).toMatch(/say\("md\.bridgeCreated"\)/);
  });
});

describe("la pista que da md check", () => {
  /*
    Clue and not finding, on purpose: the file does not lie, it lacks a reader. Exit code 1 is
    reserved for lies, which is what a CI wants to distinguish — a project without CLAUDE.md
    cannot turn red because of that.
   */
  it("avisa cuando hay AGENTS.md y no hay CLAUDE.md", () => {
    expect(comando).toMatch(/includes\("AGENTS\.md"\) && !nombres\.includes\("CLAUDE\.md"\)/);
    expect(comando).toMatch(/say\("md\.bridgeMissing"\)/);
    expect(comando).toMatch(/say\("md\.bridgeMissingHint"\)/);
  });
});
