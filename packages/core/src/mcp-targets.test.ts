import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mcpSnippet, mcpTarget } from "./mcp-targets";

/**
 * To whom do we write the file and to whom do we only show it.
 *
 * This exists due to a specific failure: `panoma agent-key Codex --install` was writing
 * `.mcp.json` —Claude Code's file— and responded "✓ Configuration MCP written." Codex does not
 * read that file, so it was a success announced for doing nothing. The rule that prevents this is
 * the one tested here: it only writes where we know the file, the format is known to be mergeable,
 * and **the agent's folder already exists**.
 *
 * With real directories and a fake `home`: what is checked is how the disk is viewed, and a double
 * would prove nothing.
 */

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-mcp-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("a quién se le escribe", () => {
  it("a Cursor, si su carpeta ya existe", async () => {
    await mkdir(join(home, ".cursor"), { recursive: true });
    expect(mcpTarget("cursor-agent", home)).toEqual({
      agent: "cursor-agent",
      kind: "write",
      file: join(home, ".cursor", "mcp.json"),
      format: "json",
    });
  });

  it("a Claude Code, que guarda en la raíz del directorio personal", () => {
    const target = mcpTarget("claude-cli", home);
    expect(target.kind).toBe("write");
    expect(target.file).toBe(join(home, ".claude.json"));
  });

  it("pero no si la herramienta nunca pasó por ahí", () => {
    /*
      Without `~/.gemini` there is no Gemini configured: writing it would leave an orphan file and
      a success message for something that is of no use to anyone.
     */
    const target = mcpTarget("gemini-cli", home);
    expect(target.kind).toBe("show");
    expect(target.file).toBe(join(home, ".gemini", "settings.json"));
  });
});

describe("a quién solo se le enseña", () => {
  it("a Codex ya no: su TOML se escribe añadiendo la tabla al final", async () => {
    /*
      It was `show` because 'merging TOML is not improvised' — and it still isn't improvised: it
      is not merged, it is added, which is the only operation that cannot break what exists. The
      screen that showed the fragment left the user more motivated without knowing what to do, and
      that was the loss of truth.
     */
    await mkdir(join(home, ".codex"), { recursive: true });
    const target = mcpTarget("codex-cli", home);
    expect(target.kind).toBe("write");
    expect(target.format).toBe("toml");
    expect(target.file).toBe(join(home, ".codex", "config.toml"));
  });

  it("a Codex sin carpeta sí: la herramienta nunca pasó por ahí", () => {
    const target = mcpTarget("codex-cli", home);
    expect(target.kind).toBe("show");
    expect(target.format).toBe("toml");
  });

  it("y a un agente que no conocemos, sin inventarle una ruta", () => {
    const target = mcpTarget("aider", home);
    expect(target.kind).toBe("unknown");
    expect(target.file).toBeUndefined();
  });
});

describe("el fragmento que se copia", () => {
  const entry = {
    command: "/usr/local/bin/node",
    args: ["/x/mcp/dist/index.js"],
    env: { PANOMA_API: "http://localhost:4173", PANOMA_KEY: "abc" },
  };

  it("en JSON lleva la forma que espera quien lo pega", () => {
    expect(JSON.parse(mcpSnippet(entry))).toEqual({ mcpServers: { panoma: entry } });
  });

  it("en TOML usa la tabla de Codex, que no se llama igual", () => {
    const toml = mcpSnippet(entry, "toml");
    expect(toml).toContain("[mcp_servers.panoma]");
    expect(toml).not.toContain("mcpServers");
    expect(toml).toContain('"PANOMA_KEY" = "abc"');
  });
});
