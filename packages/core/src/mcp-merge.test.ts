import { describe, expect, it } from "vitest";
import { parse } from "smol-toml";
import { McpTomlError, mergeMcpToml, type McpEntry } from "./mcp-merge";

/**
 * What is protected here is someone else's file. `~/.codex/config.toml` contains much more than
 * MCP servers —model, trusted projects, approval policy— and it is also written by Codex. The
 * promise of `mergeMcpToml` is surgical: not a single byte of someone else's changes, and if it
 * cannot promise that, it does not write.
 */

const entry: McpEntry = {
  command: "/usr/local/bin/node",
  args: ["/x/mcp/dist/index.js"],
  env: { PANOMA_API: "http://localhost:4173", PANOMA_KEY: "panoma_abc" },
};

function serversOf(text: string): Record<string, unknown> {
  const doc = parse(text) as Record<string, unknown>;
  return (doc["mcp_servers"] ?? {}) as Record<string, unknown>;
}

describe("añadir donde no había nada", () => {
  it("sin fichero, la tabla sola", () => {
    const merged = mergeMcpToml(undefined, entry);
    expect(merged.replaced).toBe(false);
    expect(merged.coexists).toEqual([]);
    const panoma = serversOf(merged.result)["panoma"] as Record<string, unknown>;
    expect(panoma["command"]).toBe(entry.command);
    expect(panoma["env"]).toEqual(entry.env);
  });

  it("con configuración ajena, se añade al final y lo de antes queda byte a byte", () => {
    const original = [
      'model = "gpt-5"',
      "# el comentario que un merge de verdad se comería",
      "",
      "[mcp_servers.supabase]",
      'command = "npx"',
      'args = ["-y", "supabase-mcp"]',
      "",
      "[projects.\"/Users/alguien/cosa\"]",
      'trust_level = "trusted"',
      "",
    ].join("\n");

    const merged = mergeMcpToml(original, entry);
    // The whole promise in an assertion: the original is an intact prefix of the result.
    expect(merged.result.startsWith(original)).toBe(true);
    expect(merged.replaced).toBe(false);
    expect(merged.coexists).toEqual(["supabase"]);
    expect(Object.keys(serversOf(merged.result)).sort()).toEqual(["panoma", "supabase"]);
  });
});

describe("volver a conectar", () => {
  it("sustituye solo nuestra tabla, con la clave nueva y sin duplicarla", () => {
    const original = [
      "[mcp_servers.panoma]",
      'command = "/viejo/node"',
      'args = ["/viejo/index.js"]',
      'env = { "PANOMA_API" = "http://localhost:4173", "PANOMA_KEY" = "panoma_vieja" }',
      "",
      "[mcp_servers.supabase]",
      'command = "npx"',
      "",
    ].join("\n");

    const merged = mergeMcpToml(original, entry);
    expect(merged.replaced).toBe(true);
    expect(merged.coexists).toEqual(["supabase"]);
    expect(merged.result).not.toContain("panoma_vieja");
    expect(merged.result.match(/\[mcp_servers\.panoma\]/g)).toHaveLength(1);
    const servers = serversOf(merged.result);
    expect((servers["panoma"] as Record<string, unknown>)["command"]).toBe(entry.command);
    expect(servers["supabase"]).toBeDefined();
  });

  it("se lleva también nuestras subtablas: dejarlas huérfanas rompería el documento", () => {
    const original = [
      "[mcp_servers.panoma]",
      'command = "/viejo/node"',
      'args = []',
      "",
      "[mcp_servers.panoma.env]",
      'PANOMA_KEY = "panoma_vieja"',
      "",
      "[desktop]",
      'tema = "claro"',
      "",
    ].join("\n");

    const merged = mergeMcpToml(original, entry);
    expect(merged.replaced).toBe(true);
    expect(merged.result).not.toContain("panoma_vieja");
    expect(merged.result).toContain('[desktop]');
    expect((parse(merged.result) as Record<string, unknown>)["desktop"]).toEqual({ tema: "claro" });
  });
});

describe("cuándo no se escribe", () => {
  it("un TOML que no parsea no se toca: alguien lo estaba arreglando", () => {
    expect(() => mergeMcpToml('model = "sin cerrar', entry)).toThrowError(McpTomlError);
    try {
      mergeMcpToml('model = "sin cerrar', entry);
    } catch (error) {
      expect((error as McpTomlError).reason).toBe("unparseable");
    }
  });

  it("un panoma escrito a mano de otra forma se respeta: eso lo decide su autor", () => {
    const original = ['[mcp_servers]', 'panoma = { command = "/su/node", args = [] }', ""].join("\n");
    try {
      mergeMcpToml(original, entry);
      expect.unreachable("tendría que haber lanzado");
    } catch (error) {
      expect((error as McpTomlError).reason).toBe("manual");
    }
  });
});
