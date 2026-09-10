import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * How an installed agent is launched, read from the source as text.
 *
 * `claude -p` alone boots the person's whole Claude Code —every MCP server in their config, the
 * instruction files of the folder it starts in, a session persisted under `~/.claude/projects`—
 * and measured elsewhere that cost about 70 times more for a one-line answer. The flags that stop
 * it are arguments in a list, and the neutral working directory is one option in one call: the
 * kind of thing that disappears in a tidy-up without any test executing differently. So this
 * reads `providers.ts` and `complete.ts` as text, the house pattern for invariants that cannot be
 * executed.
 *
 * Each name says what breaks if it fails.
 */
const dir = new URL("./", import.meta.url);
const providers = readFileSync(new URL("providers.ts", dir), "utf8");
const complete = readFileSync(new URL("complete.ts", dir), "utf8");

/** The `args` list of one `cli` row, by its id. */
function argsOf(id: string): string[] {
  const from = providers.indexOf(`id: "${id}"`);
  expect(from, `${id} is no longer in providers.ts`).toBeGreaterThan(-1);
  const match = /args:\s*\[([^\]]*)\]/.exec(providers.slice(from));
  expect(match, `${id} has no args list`).not.toBeNull();
  return [...match![1]!.matchAll(/"([^"]*)"/g)].map((one) => one[1]!);
}

describe("how claude-cli is launched", () => {
  const args = argsOf("claude-cli");

  it("without --strict-mcp-config every MCP server in the person's config boots on each call", () => {
    expect(args).toContain("--strict-mcp-config");
  });

  it("without --no-session-persistence every call leaves a session under ~/.claude/projects", () => {
    expect(args).toContain("--no-session-persistence");
  });

  it("with --bare the agent loses OAuth and the subscription route stops working", () => {
    expect(args).not.toContain("--bare");
  });

  it("still answers once and exits: -p stays", () => {
    expect(args[0]).toBe("-p");
  });
});

describe("how codex-cli is launched", () => {
  const args = argsOf("codex-cli");

  it("without --ephemeral every call leaves a session on disk", () => {
    expect(args).toContain("--ephemeral");
  });

  it("without --skip-git-repo-check it refuses the neutral working directory, which is no repository", () => {
    expect(args).toContain("--skip-git-repo-check");
  });
});

describe("where an agent is launched from", () => {
  it("without cwd: tmpdir() the agent discovers the server folder's CLAUDE.md and AGENTS.md and pays for them", () => {
    expect(complete).toMatch(/completeWithCliAgent\([^)]*\{\s*cwd:\s*tmpdir\(\)\s*\}/);
  });

  it("and tmpdir has to come from node:os, or the call above is a different function", () => {
    expect(complete).toMatch(/import \{ tmpdir \} from "node:os"/);
  });
});
