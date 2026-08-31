import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { panomaPath } from "@panoma/core";

/**
 * The MCP block that connects an agent with this catalog, composed from the web.
 *
 * Mirror of `mcpEntry()` in `apps/cli/src/mcp.ts`, and with its same two decisions, which are
 * argued at length there and here are only recalled:
 *
 * - **`process.execPath` and not `"node"` **, because a MCP client can start without your PATH and
 * there `node` does not exist.
 * - **A path on this disk and not `npx -y @panoma/mcp` **, because that package is not published:
 * whoever copied that would end up with a server that never boots.
 *
 * What changes is how the server is found. The CLI goes up from its own entry; here the package is
 * resolved, which works the same in the monorepo (pnpm link) and in the published package
 * (`app/node_modules/@panoma/mcp`, where `pack-app.mjs` leaves it).
 *
 * `createRequire` goes inside `new Function` for the same reason as PGlite in `lib/db.ts`: so that
 * webpack does not analyze the specifier and does not include the MCP server in the bundle. Here
 * we only want its path on disk, never its code.
 */
const runtimeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<typeof import("node:module")>;

export interface McpEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * The path of the MCP server on this disk, or `undefined` if it does not travel in this
 * installation.
 *
 * The entire subpath —`@panoma/mcp/dist/index.js`— is requested, and not just the package, because
 * its manifest only declares `bin`: without `main` or `exports`, resolving `@panoma/mcp` alone
 * fails. And since `resolve` is denied if the file is not there, an unbuilt `dist` falls here and
 * responds that there is no server, instead of giving a configuration that points to something
 * that doesn't exist.
 *
 * The basis of the resolution is `process.cwd()` and not `import.meta.url`: within the Next bundle
 * that URL is not a file on disk, so uploading from it does not lead to any `node_modules`. The
 * working directory does work in both worlds — `apps/web` with `next dev`, and the root of `app/`
 * in the published package — because from both it uploads to the `node_modules` that has
 * `@panoma/mcp`.
 */
export async function mcpServerPath(): Promise<string | undefined> {
  try {
    const { createRequire } = await runtimeImport("node:module");
    const from = createRequire(join(process.cwd(), "resolver.cjs"));
    return from.resolve("@panoma/mcp/dist/index.js");
  } catch {
    return undefined;
  }
}

/**
 * The interpreter that goes in the configuration: the node of **who requested** the catalog, not
 * the one who serves it.
 *
 * `panoma up` leaves in the seal (`web.json`) the `process.execPath` of the CLI, which is the
 * user's node on their terminal. The one of the server process can be different: in development,
 * the internal runtime of the panel that started it — a path that names another tool and that
 * disappears when that tool is updated. Showing that path in the configuration of an agent is to
 * sign with another's name and break with its next version. If the seal is missing or its node no
 * longer exists, it falls back to `process.execPath`, which at least runs.
 */
export async function preferredNode(): Promise<string> {
  try {
    const raw = await readFile(panomaPath("web.json"), "utf8");
    const stamp = JSON.parse(raw) as { node?: string };
    if (stamp.node && existsSync(stamp.node)) return stamp.node;
  } catch {
    // Without a legible seal there is nothing to prefer.
  }
  return process.execPath;
}

export function mcpEntry(
  api: string,
  apiKey: string,
  server: string,
  command = process.execPath,
): McpEntry {
  return {
    command,
    args: [server],
    env: { PANOMA_API: api, PANOMA_KEY: apiKey },
  };
}
