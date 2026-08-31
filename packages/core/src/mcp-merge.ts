import { parse } from "smol-toml";

/**
 * Put Panoma in the `mcpServers` of another tool without destroying what is there.
 *
 * It lives in the core because **two need it**: the CLI when it writes a `.mcp.json` with
 * `agent-key --install`, and the web when it connects an agent from the 'Agents' page. What was in
 * the CLI was moved here before there were two copies, which is the only way they don't separate:
 * this morning's in `account-url.ts` was already separated.
 *
 * The failure that this prevents does not give any error when it occurs. Rewriting the entire file
 * leaves someone with **only** Panoma inside and their other servers MCP deleted, and it is not
 * discovered until the day one is missing — probably without connecting it to us.
 *
 * Messages are not translated here: the reason is returned and the caller tells it in their
 * language. The core does not have a dictionary and should not have one.
 */

export interface McpEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** The key under which Panoma lives inside `mcpServers`. */
export const SERVER_NAME = "panoma";

/** Why it could not be merged. Whoever calls decides how it is said. */
export type McpMergeReason = "not-an-object" | "servers-not-an-object";

export class McpMergeError extends Error {
  constructor(readonly reason: McpMergeReason) {
    super(reason);
    this.name = "McpMergeError";
  }
}

export interface McpMergeResult {
  result: Record<string, unknown>;
  /** There was already an entry for Panoma and it has been replaced. */
  replaced: boolean;
  /** The other servers that are still there. Naming them is what shows that they remain. */
  coexists: string[];
}

export function mergeMcp(existing: unknown, entry: McpEntry): McpMergeResult {
  if (existing !== undefined && !isObject(existing)) {
    throw new McpMergeError("not-an-object");
  }
  const base: Record<string, unknown> = { ...(existing ?? {}) };

  const previousList = base["mcpServers"];
  if (previousList !== undefined && !isObject(previousList)) {
    throw new McpMergeError("servers-not-an-object");
  }

  const servers: Record<string, unknown> = { ...(previousList ?? {}) };
  const replaced = Object.prototype.hasOwnProperty.call(servers, SERVER_NAME);
  servers[SERVER_NAME] = entry;
  base["mcpServers"] = servers;

  return {
    result: base,
    replaced,
    coexists: Object.keys(servers).filter((clave) => clave !== SERVER_NAME),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ── And the Codex TOML, which until now was only taught ─────────────────────── */

/**
 * Why couldn't the TOML be written. Whoever calls decides how it is said.
 *
 * - `unparseable`: the file is not valid TOML. Overwriting a file with a syntax error erases the
 * work of whoever was fixing it — the same rule as JSON.
 * - `manual`: Panoma is already inside but written in a way that is not our table
 * (`panoma = {…}` online, for example). Touch what a person wrote to their
 * one way would mean guessing the user's intention; show the fragment and let them decide.
 */
export type McpTomlReason = "unparseable" | "manual";

export class McpTomlError extends Error {
  constructor(
    readonly reason: McpTomlReason,
    readonly detail?: string,
  ) {
    super(reason);
    this.name = "McpTomlError";
  }
}

export interface McpTomlMergeResult {
  /** The complete text of the resulting file, ready to be written in full. */
  result: string;
  replaced: boolean;
  coexists: string[];
}

/**
 * Put the `[mcp_servers.panoma]` board into someone else's `config.toml` without touching anything
 * else.
 *
 * The reason this exists: the Connect Codex screen showed the snippet and the file, and the most
 * motivated user in the world would just stare at it not knowing what to do. "Merging TOML while
 * keeping comments and order is not improvised" is still true — that's why nothing is merged here:
 * text is **added at the end**, which is the only operation on a TOML that cannot break what
 * already exists. A new table at the end of a valid document is always a valid document, and not a
 * single byte of what exists changes place.
 *
 * If our table already exists —from a previous "Connect"—, **only that section** is replaced,
 * located by its header and closed at the following header or the end of the file. It is text that
 * we wrote ourselves; what is around it is not looked at.
 *
 * The result is checked before being returned: it must be valid TOML again and declare exactly the
 * command that was requested. If this function has a failure, let it pay for it with an exception,
 * not someone's configuration file.
 */
export function mergeMcpToml(existing: string | undefined, entry: McpEntry): McpTomlMergeResult {
  let parsed: Record<string, unknown> = {};
  if (existing !== undefined && existing.trim() !== "") {
    try {
      parsed = parse(existing) as Record<string, unknown>;
    } catch (error) {
      throw new McpTomlError("unparseable", (error as Error).message);
    }
  }

  const servers = isObject(parsed["mcp_servers"]) ? parsed["mcp_servers"] : {};
  const coexists = Object.keys(servers).filter((clave) => clave !== SERVER_NAME);
  const already = Object.prototype.hasOwnProperty.call(servers, SERVER_NAME);

  const table = tomlTable(entry);
  const text = existing ?? "";

  let result: string;
  if (!already) {
    const body = text === "" || text.endsWith("\n") ? text : `${text}\n`;
    result = `${body}${body === "" ? "" : "\n"}${table}\n`;
  } else {
    /*
      The header is searched for as a whole line. If the parser says that Panoma is there but
      header does not appear, it means someone wrote it differently (an inline table within
      `[mcp_servers]` ): that is not to be touched.
     */
    const lines = text.split("\n");
    const start = lines.findIndex((line) => /^\s*\[mcp_servers\.panoma\]\s*(#.*)?$/.test(line));
    if (start === -1) throw new McpTomlError("manual");
    /*
      The section ends at the following header that is not ours. The subtables
      (`[mcp_servers.panoma.env]`) are also ours: leaving them orphaned would redefine
      `env` and the entire document would stop parsing.
     */
    let end = start + 1;
    while (end < lines.length) {
      const line = lines[end]!;
      if (/^\s*\[/.test(line) && !/^\s*\[mcp_servers\.panoma[.\]]/.test(line)) break;
      end += 1;
    }
    // The whites that closed the section stay with what comes next.
    let keep = end;
    while (keep > start + 1 && lines[keep - 1]!.trim() === "") keep -= 1;
    result = [...lines.slice(0, start), ...table.split("\n"), ...lines.slice(keep)].join("\n");
    if (!result.endsWith("\n")) result += "\n";
  }

  let final: Record<string, unknown>;
  try {
    final = parse(result) as Record<string, unknown>;
  } catch (error) {
    throw new McpTomlError("unparseable", (error as Error).message);
  }
  const written = isObject(final["mcp_servers"]) ? final["mcp_servers"] : {};
  const ours = written[SERVER_NAME];
  if (!isObject(ours) || ours["command"] !== entry.command) {
    throw new McpTomlError("unparseable", "el resultado no declara la tabla que se pidió");
  }

  return { result, replaced: already, coexists };
}

/** The table as it is taught: same four lines as `mcpSnippet(entry, "toml")`. */
function tomlTable(entry: McpEntry): string {
  const env = Object.entries(entry.env)
    .map(([clave, valor]) => `${JSON.stringify(clave)} = ${JSON.stringify(valor)}`)
    .join(", ");
  return [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${JSON.stringify(entry.command)}`,
    `args = [${entry.args.map((argumento) => JSON.stringify(argumento)).join(", ")}]`,
    `env = { ${env} }`,
  ].join("\n");
}
