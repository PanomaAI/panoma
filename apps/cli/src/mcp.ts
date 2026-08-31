import { say } from "./messages";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  MCP_FILE_MODE,
  McpMergeError,
  McpTomlError,
  mcpProjectTarget,
  mcpSnippet,
  mergeMcp,
  mergeMcpToml,
  SERVER_NAME,
  trackedByGit,
  type McpEntry,
} from "@panoma/core";
import { cliEntry, monorepoRoot } from "./environment";

/**
 * The MCP block that connects an agent with the catalog, and how to leave it in place.
 *
 * **Why a local route and not `npx -y @panoma/mcp`. ** That's what this command printed until now,
 * and `@panoma/mcp` is not published on npm. Whoever copied the configuration got an MCP server
 * that never starts, with an npm error on a Claude Code registry that almost nobody looks at. A
 * configuration that doesn't work is worse than giving none at all: the first one makes you lose
 * half an hour looking for the fault on your machine.
 *
 * There are two local routes, and the order matters:
 *
 * 1. **Within the monorepo**, the server built in `packages/mcp/dist`, which is what gets
 * recompiled when developing.
 * 2. **Installed from npm**, the one that travels inside the package itself, in
 * `app/node_modules/@panoma/mcp`. This path did not exist and was a hole the size of half a
 * promise: the catalog would start but the channel with agents—the six tools that the
 * documentation lists—pointed to a non-existent package and sent the user to clone the repository.
 * It is the same fault that `up` had when it looked for the monorepo and gave up outside of it, in
 * the other half of the product.
 *
 * If someday `@panoma/mcp` is released individually, `npx` becomes an option again — but it will
 * still be worse than this one, because this one does not touch the network nor depends on the
 * registry.
 */

/**
 * The block to write, and the notice of what it lacks to function.
 *
 * It is returned the same even though the `dist` is not built: the configuration is correct and
 * what is missing is a `build`, so what is useful is to say which one — not refuse to write it.
 */
/*
  Here the language is detected instead of being received.
  `parseArgs`, `mcpEntry`, and `panomaCommand` are utilities that are called from many places and
  sometimes before the command exists; threading the language into them would require passing it
  through half a dozen signatures that do not use it for anything else. `detectLang()` is a pure
  environment function and is executed only once in a process, so asking it here gives exactly the
  same answer as receiving it from above.
 */

/**
 * The MCP server that travels inside the published package.
 *
 * Mirror of `bundledServer()` in `server.ts`: from the entrance of CLI (`dist/index.js`) you go up
 * to the package and go down to `app/node_modules`, which is where `pack-app.mjs` leaves the
 * flattened `@panoma/*` with their dependencies.
 */
export function bundledMcpServer(): string | undefined {
  const candidate = join(
    cliEntry(),
    "..",
    "..",
    "app",
    "node_modules",
    "@panoma",
    "mcp",
    "dist",
    "index.js",
  );
  return existsSync(candidate) ? candidate : undefined;
}

export function mcpEntry(api: string, apiKey: string): { entry: McpEntry; aviso?: string } {
  const root = monorepoRoot();
  const enElRepo = root ? join(root, "packages", "mcp", "dist", "index.js") : undefined;
  const server = enElRepo ?? bundledMcpServer();

  if (!server) {
    return {
      entry: {
        command: "npx",
        args: ["-y", "@panoma/mcp"],
        env: { PANOMA_API: api, PANOMA_KEY: apiKey },
      },
      aviso: say("mcp.noMonorepo"),
    };
  }

  return {
    entry: {
      // `process.execPath` and not «node»: a hook or a client MCP can start without your PATH, and
      // there «node» does not exist.
      command: process.execPath,
      args: [server],
      env: { PANOMA_API: api, PANOMA_KEY: apiKey },
    },
    aviso: existsSync(server)
      ? undefined
      : say("mcp.notBuilt", { path: server }),
  };
}

export interface Installed {
  path: string;
  created: boolean;
  replaced: boolean;
  coexists: string[];
  /**
   * Git would take this file, and inside goes the agent's key in clear text.
   *
   * `--install` leaves the `.mcp.json` in the root of the repository you are working on. A
   * `git add .` puts it in a commit and a `git push` publishes it — which is how credentials
   * really leak: not through an exploit, but through a file that appeared in a folder that is
   * uploaded in full. Panoma doesn't touch anyone's `.gitignore`, so it says it at the only moment
   * the person is looking: this one.
   */
  exposedToGit: boolean;
}

/**
 * Write the configuration where this agent reads it, or say why not.
 *
 * `--install` always wrote `.mcp.json`, which is Claude Code’s file, whatever agent you mentioned.
 * `panoma agent-key Codex --install` left something in your folder that Codex does not read —its
 * own is `~/.codex/config.toml` — and answered «Configuration MCP written»: a guaranteed success
 * for doing nothing. It is the same sin that the comment above boasts about regarding
 * `npx -y @panoma/mcp`, committed two functions down.
 *
 * The rule of where each one goes lives in the core and is the same one that the "Agents" page
 * applies; here it is only decided what to do with their answer. `agent` is the canonical name of
 * the tool —`claude-cli`, `codex-cli` —, not the one the user wrote.
 */
export async function installFor(
  agent: string,
  entry: McpEntry,
  directory: string,
): Promise<
  | { wrote: true; installed: Installed }
  | { wrote: false; file?: string; format: "json" | "toml"; snippet: string; reason?: string }
> {
  const target = mcpProjectTarget(agent, directory);

  /*
    Without a recognized agent, the usual is maintained: the `.mcp.json` of this folder, which is
    Claude Code's with project scope. It is the correct answer for whoever writes
    `panoma agent-key "mi bot"`, because there is nothing better than to suppose there.
   */
  if (target.kind === "unknown") {
    return { wrote: true, installed: await installMcp(directory, entry) };
  }

  if (target.kind !== "write" || !target.file) {
    return {
      wrote: false,
      file: target.file,
      format: target.format ?? "json",
      snippet: mcpSnippet(entry, target.format ?? "json"),
    };
  }

  /*
    The Codex TOML is written by adding our table at the end — the full reason is in
    `mergeMcpToml`. Previously this case was 'teach', and `panoma agent-key Codex --install` ended
    with a fragment on screen instead of with Codex connected.
   */
  if (target.format === "toml") {
    const raw = await readFile(target.file, "utf8").catch(() => undefined);
    try {
      const fusion = mergeMcpToml(raw, entry);
      const scratch = `${target.file}.panoma-tmp`;
      /*
        The temporary file is born already with the key inside: the mode goes here, not after the
        renaming, because between the two things the file exists and is readable.
        And it goes in the options object, not as a fourth argument:
        `writeFile(ruta, datos, "utf8", { mode })` **compiles, runs and does not apply the mode**
        — the signature only has three parameters and the fourth is discarded without saying
        anything. Measured: 644.
       */
      await writeFile(scratch, fusion.result, { encoding: "utf8", mode: MCP_FILE_MODE });
      await rename(scratch, target.file);
      await chmod(target.file, MCP_FILE_MODE).catch(() => undefined);
      return {
        wrote: true,
        installed: {
          path: target.file,
          created: raw === undefined,
          replaced: fusion.replaced,
          coexists: fusion.coexists,
          exposedToGit: await trackedByGit(target.file),
        },
      };
    } catch (error) {
      if (error instanceof McpTomlError) {
        return {
          wrote: false,
          file: target.file,
          format: "toml",
          snippet: mcpSnippet(entry, "toml"),
          reason: say(error.reason === "manual" ? "mcp.tomlManual" : "mcp.badToml", {
            path: target.file,
          }),
        };
      }
      throw error;
    }
  }

  try {
    await mkdir(dirname(target.file), { recursive: true });
    return { wrote: true, installed: await installMcp(directory, entry, target.file) };
  } catch (error) {
    /* A broken JSON is not overwritten: the fragment is returned, which is the actionable part. */
    return {
      wrote: false,
      file: target.file,
      format: "json",
      snippet: mcpSnippet(entry, "json"),
      reason: (error as Error).message,
    };
  }
}

/** Write the indicated file —or the `.mcp.json` from the folder— keeping whatever was there. */
export async function installMcp(
  directory: string,
  entry: McpEntry,
  file?: string,
): Promise<Installed> {
  const path = file ?? join(directory, ".mcp.json");
  const raw = await readFile(path, "utf8").catch(() => undefined);

  let existing: unknown;
  if (raw !== undefined) {
    try {
      existing = JSON.parse(raw);
    } catch (error) {
      // Overwriting a JSON with a syntax error deletes the work of the person who was fixing it. It
      // stops here and the user should decide.
      throw new Error(say("mcp.badJson", { path, reason: (error as Error).message }), {
        cause: error,
      });
    }
  }

  let fusion: ReturnType<typeof mergeMcp>;
  try {
    fusion = mergeMcp(existing, entry);
  } catch (error) {
    /*
      The core returns the motif untranslated — it has no dictionary nor should it have one — and
      the language is applied here, where there is a reader.
     */
    if (error instanceof McpMergeError) {
      throw new Error(
        say(error.reason === "not-an-object" ? "mcp.notAnObject" : "mcp.serversNotAnObject"),
        { cause: error },
      );
    }
    throw error;
  }
  const { result, replaced, coexists } = fusion;
  /*
    Mode 0600 and a `chmod` behind.
    The `mode` of `writeFile` only applies when **creating**: a `.mcp.json` that already
    existed—or a 162 KB `~/.claude.json` —would keep the usual 0644, and inside there is the
    agent's key in clear text, readable by any other account on the machine. So it is written with
    the mode and it insists with `chmod`, which is the one that fixes the ones that already
    existed. If the file system doesn’t understand permissions—a Windows mount—it fails and
    continues: what it cannot do is prevent the configuration from being written.
   */
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    mode: MCP_FILE_MODE,
  });
  await chmod(path, MCP_FILE_MODE).catch(() => undefined);
  return {
    path,
    created: raw === undefined,
    replaced,
    coexists,
    exposedToGit: await trackedByGit(path),
  };
}

export { mergeMcp, SERVER_NAME, type McpEntry };
