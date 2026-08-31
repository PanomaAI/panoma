import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

/**
 * Where does each agent keep their MCP servers, and if we dare to write it down.
 *
 * The house rule is the one already written in `apps/cli/src/mcp.ts`: **a configuration that
 * doesn't work is worse than giving none**, because the former makes you waste half an hour
 * searching for the fault in your machine. Here that translates to not pretending. A button that
 * says "Connected" after writing a file that that agent doesn't read is exactly the lie we are
 * fixing — and it was literally what happened with `panoma agent-key Codex --install`, which wrote
 * Claude Code's `.mcp.json`.
 *
 * That is why there are three levels and not two:
 *
 * - **`write`** — we know the file and we know how to get in without touching anything else: in
 * JSON it is done by `mergeMcp` by merging `mcpServers`; in Codex's TOML it is done by
 * `mergeMcpToml` by adding our table at the end — the only operation on a TOML that cannot break
 * what is there, because merging it while preserving comments and order is not something
 * improvised, and that is why it is not merged.
 * - **`show`** — we know the file but we don't dare with its content: a TOML that doesn't parse,
 * or an entry of Panoma written by hand in another way. The fragment is shown and it is said in
 * which file it goes.
 * - **`unknown`** — we don't know where it is stored. The block is taught in JSON and **no path is
 * made up**. A made-up path is worse than none: it sends someone to create a file that their tool
 * will not look at.
 *
 * And there is one safe room, on top of everything: even if the destiny is `write`, it is only
 * written if **the agent's folder already exists**. That it exists means that the tool has already
 * been there; that it does not exist means that we would be planting a configuration tree blindly
 * in someone's house.
 *
 * It lives in core because both callers that write those files use it: the "Agents" page and
 * `panoma agent-key --install`. It began in `apps/web/lib` and stayed there for a few hours; it
 * moved as soon as the CLI needed it, before two copies could emerge.
 */

/**
 * The canonical name of each tool, and the ones used before.
 *
 * The CLI deduced `claude_code` from the name you wrote and the website saves `claude-cli`, which
 * is the `id` of the provider. Two vocabularies for the same thing mean **two entries of the same
 * agent** on the page, one per path, and that reconnecting from the website does not find the one
 * created by the terminal. The `id` of the provider wins, which is the one already used by
 * detection and the rest of the product; the old ones are still recognized to adopt what exists.
 */
const ALIASES: Record<string, string> = {
  claude_code: "claude-cli",
  claude: "claude-cli",
  cursor: "cursor-agent",
  codex: "codex-cli",
  copilot: "copilot-cli",
  gemini: "gemini-cli",
};

/** The `kind` with which an agent is saved comes from the CLI or from the web. */
export function canonicalAgentKind(kind: string): string {
  return ALIASES[kind] ?? kind;
}

/** All the `kind` that this tool means, to adopt old chips. */
export function agentKindAliases(kind: string): string[] {
  const canonical = canonicalAgentKind(kind);
  const viejos = Object.entries(ALIASES)
    .filter(([, nuevo]) => nuevo === canonical)
    .map(([viejo]) => viejo);
  return [canonical, ...viejos];
}

export type McpTargetKind = "write" | "show" | "unknown";

export interface McpTarget {
  /** The provider `id` returned by `GET /api/open` in `agents[]`. */
  agent: string;
  kind: McpTargetKind;
  /** Absolute and already expanded. Absent in `unknown`. */
  file?: string;
  /** How is the fragment taught when it is not written. */
  format?: "json" | "toml";
}

/** The file of each agent, relating to the personal directory. */
const FILES: Record<string, { path: string[]; format: "json" | "toml" }> = {
  /* Claude Code: user scope. It is the one that CLI already mentioned in `mcp.pasteIt`. */
  "claude-cli": { path: [".claude.json"], format: "json" },
  "cursor-agent": { path: [".cursor", "mcp.json"], format: "json" },
  "gemini-cli": { path: [".gemini", "settings.json"], format: "json" },
  /* TOML, and with the table in `[mcp_servers.panoma]` instead of `mcpServers`. */
  "codex-cli": { path: [".codex", "config.toml"], format: "toml" },
};

/**
 * What can be done with this agent, looking at the actual disc.
 *
 * `home` is injected in order to be able to test it without touching the personal directory of the
 * person running the tests, which is exactly the place where a failure here would be noticed.
 */
export function mcpTarget(agent: string, home = homedir()): McpTarget {
  const known = FILES[agent];
  if (!known) return { agent, kind: "unknown" };

  const file = join(home, ...known.path);

  /*
    Only inside a folder that the tool has already created. Without this, 'connecting' an agent
    that is not actually installed would leave a `~/.cursor/mcp.json` orphaned and a success
    message for something that is useless to anyone. The same applies to Codex's TOML: `~/.codex`
    exists if Codex passed through there.
   */
  const directory = known.path.length > 1 ? join(home, known.path[0]!) : home;
  if (!existsSync(directory)) return { agent, kind: "show", file, format: known.format };

  return { agent, kind: "write", file, format: known.format };
}

/** The project scope file of each agent, related to the project folder. */
const PROJECT_FILES: Record<string, string[]> = {
  /*
    `.mcp.json` belongs to Claude Code, and it is the one `--install` has always written. For that agent it was
    never wrong: the mistake was writing it also for others.
   */
  "claude-cli": [".mcp.json"],
  "cursor-agent": [".cursor", "mcp.json"],
};

/**
 * Where does the configuration **of this project** go, which is what `--install` asks for.
 *
 * The CLI runs inside a folder, and connecting there means 'for this project,' not 'for
 * everything.' The difference is not cosmetic: Claude Code's global scope lives in a
 * `~/.claude.json` which on this machine is 162 KB and which it rewrites itself while working,
 * whereas the project scope is a small file that exists for this purpose. When an agent does not
 * have project scope—Codex—it falls back to the global, which for it is teaching.
 */
export function mcpProjectTarget(agent: string, directory: string, home = homedir()): McpTarget {
  const relative = PROJECT_FILES[agent];
  if (!relative) return mcpTarget(agent, home);

  /*
    Here the folder is indeed created if it's missing, unlike in the global: `<proyecto>/.cursor`
    belongs to this project and usually does not exist yet. The caution with the global was not to
    plant a configuration tree in someone's home; in its own repository it does not apply.
   */
  return { agent, kind: "write", file: join(directory, ...relative), format: "json" };
}

/**
 * The fragment that is taught when it is not written, in the agent's format.
 *
 * The TOML one is composed by hand and not with a library: it's four lines, and adding a
 * dependency to generate four lines that are only ever shown — never written — is not worth it.
 */
export function mcpSnippet(
  entry: { command: string; args: string[]; env: Record<string, string> },
  format: "json" | "toml" = "json",
): string {
  if (format === "toml") {
    const env = Object.entries(entry.env)
      .map(([clave, valor]) => `${JSON.stringify(clave)} = ${JSON.stringify(valor)}`)
      .join(", ");
    return [
      "[mcp_servers.panoma]",
      `command = ${JSON.stringify(entry.command)}`,
      `args = [${entry.args.map((a) => JSON.stringify(a)).join(", ")}]`,
      `env = { ${env} }`,
    ].join("\n");
  }
  return JSON.stringify({ mcpServers: { panoma: entry } }, null, 2);
}

/* ── And what that file contains ────────────────────────────────────────── */

const run = promisify(execFile);

/**
 * The mode in which any MCP configuration file is written: only its owner.
 *
 * Inside goes `PANOMA_KEY` in plain text, which is the credential used to read the report, the
 * logbook, and the tasks of this person's eighty projects. It was written with the default mode
 * —0644 with the usual umask—, meaning readable by any other account on the machine. On a
 * single-person laptop it doesn't matter; on a shared computer, on a development server, or in a
 * container with several users, it does.
 *
 * It applies to all four sites: the `.mcp.json` of the project, the `~/.claude.json`, the
 * `~/.cursor/mcp.json`, and the `~/.codex/config.toml`. And **also to the temporary file** of the
 * atomic write, which is the one most easily forgotten: it is created with the key inside, in a
 * predictable path, and if the renaming fails, it stays there.
 */
export const MCP_FILE_MODE = 0o600;

/**
 * Would git take this file, with the key inside?
 *
 * `--install` leaves a `.mcp.json` **in the root of the repository you are working in**, and
 * inside it is the agent key in clear text. It only takes a `git add .` to put it in a commit, and
 * a `git push` to publish it — which is exactly how credentials are leaked in real life: not
 * through an exploit, but through a file that ended up in a folder that gets uploaded in its
 * entirety.
 *
 * Panoma does not touch anyone's `.gitignore`: it is that person's repository, and adding lines by
 * hand is going where you are not called. What you can do is **look and say it** at the same
 * moment that the file is being written, which is the only moment the person is looking.
 *
 * You ask git and `.gitignore` is not interpreted here: the precedence rules between the global,
 * the repository one, the nested `.gitignore`, and the `.git/info/exclude` are yours, and
 * reimplementing them would get it right 90% of the time on a question where failing means staying
 * silent when you should have warned.
 *
 * Returns `false` in case of any doubt —there is no git, it is not a repository, git is not
 * installed— because the warning only makes sense when it is true. A warning that always pops up
 * stops being read by the third time.
 */
export async function trackedByGit(file: string): Promise<boolean> {
  const folder = dirname(file);
  try {
    const { stdout } = await run("git", ["-C", folder, "rev-parse", "--is-inside-work-tree"], {
      timeout: 5_000,
    });
    if (stdout.trim() !== "true") return false;
  } catch {
    return false;
  }

  try {
    /* It comes out as 0 if it is ignored: then git does not take it and there is nothing to say. */
    await run("git", ["-C", folder, "check-ignore", "-q", "--", file], { timeout: 5_000 });
    return false;
  } catch (error) {
    /*
      1 = it is not ignored, which is exactly the case of the notice. Any other code means that
      `check-ignore` could not answer, and there it is silent: see the reason above.
     */
    return (error as { code?: number }).code === 1;
  }
}
