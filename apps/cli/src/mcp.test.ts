import { execFile, execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { installMcp, mergeMcp } from "./mcp";

/**
 * Writing in someone's `.mcp.json` is one of the few things this CLI does on anyone's disk, and
 * the mistake that matters —leaving the file with **only** Panoma inside— doesn't give any error
 * when it happens. It is discovered weeks later, the day someone is missing another MCP server and
 * doesn't know since when.
 */

const ENTRY = { command: "/usr/bin/node", args: ["/repo/packages/mcp/dist/index.js"], env: { PANOMA_API: "http://localhost:4173", PANOMA_KEY: "k" } };

describe("fusionar el bloque MCP", () => {
  it("crea el fichero cuando no había nada", () => {
    const { result, replaced, coexists } = mergeMcp(undefined, ENTRY);
    expect(result["mcpServers"]).toEqual({ panoma: ENTRY });
    expect(replaced).toBe(false);
    expect(coexists).toEqual([]);
  });

  it("no se lleva por delante los servidores de otros", () => {
    const antes = { mcpServers: { github: { command: "npx", args: ["-y", "@x/github"] } } };
    const { result, coexists } = mergeMcp(antes, ENTRY);
    expect(result["mcpServers"]).toEqual({ github: antes.mcpServers.github, panoma: ENTRY });
    expect(coexists).toEqual(["github"]);
  });

  it("respeta las claves de primer nivel que no son suyas", () => {
    const { result } = mergeMcp({ $schema: "https://x/schema.json", other: 1 }, ENTRY);
    expect(result["$schema"]).toBe("https://x/schema.json");
    expect(result["other"]).toBe(1);
  });

  it("actualiza la entrada de panoma y lo dice", () => {
    const antes = { mcpServers: { panoma: { command: "npx", args: ["-y", "@panoma/mcp"], env: {} } } };
    const { result, replaced } = mergeMcp(antes, ENTRY);
    expect(replaced).toBe(true);
    expect((result["mcpServers"] as Record<string, unknown>)["panoma"]).toEqual(ENTRY);
  });

  it("no toca el objeto que le dan", () => {
    // If the input mutated, whoever read it before to decide what to tell would see something else.
    const antes = { mcpServers: { github: {} } };
    mergeMcp(antes, ENTRY);
    expect(Object.keys(antes.mcpServers)).toEqual(["github"]);
  });

  it("se planta ante un fichero con otra forma en vez de sobrescribirlo", () => {
    expect(() => mergeMcp([1, 2, 3], ENTRY)).toThrow();
    expect(() => mergeMcp({ mcpServers: "aquí antes había algo" }, ENTRY)).toThrow();
  });
});


/**
 * And what that file is, in addition to a JSON: **a file with a credential inside**.
 *
 * `PANOMA_KEY` goes there clearly, and with it you read the report, the logbook, and the tasks of
 * all the projects in the catalog. It was written with the default mode —0644— and in the root of
 * the repository you were working on, without anyone saying a word either way.
 *
 * The two halves are tested here because both fail silently. The one in the mode already failed
 * once in the dumbest way: `writeFile(ruta, datos, "utf8", { mode })` compiles, runs, doesn't give
 * any error, and **leaves the file at 644**, because the signature only has three parameters and
 * the fourth one is discarded. Without this test, the array would have been a comment.
 */
/**
 * That a file can only be read by its owner, asked in the language of each system.
 *
 * In macOS and Linux it is a number: `mode & 0o777` has to be 0600. In Windows the permissions are
 * access control lists, and `mode` **always lies** —it returns 0666 no matter what you write,
 * because `chmod` there only moves the read-only bit—, so asking for the number gives a red flag
 * that says nothing about the code: it was exactly what brought down Windows in both versions of
 * Node while Linux and macOS passed. There you ask `icacls` and check what really matters, that
 * there is no entry left for everyone.
 *
 * It is a twin of `packages/core/src/access.test.ts`, which stores the network key for the same
 * reason. It is copied and not shared because a test assistant who crosses the package would need
 * a package of their own; if a third party appears, that is the moment.
 */
async function soloSuDueno(path: string): Promise<void> {
  if (process.platform !== "win32") {
    expect(statSync(path).mode & 0o777).toBe(0o600);
    return;
  }

  const { stdout } = await promisify(execFile)("icacls", [path]);
  expect(stdout, stdout).not.toMatch(/\b(Everyone|Todos)\b/i);
  expect(stdout, stdout).not.toMatch(/BUILTIN\\(Users|Usuarios)/i);
}

describe("el fichero lleva una clave dentro, y se nota", () => {
  function repoDePruebas(): string {
    const folder = mkdtempSync(join(tmpdir(), "panoma-mcp-"));
    execFileSync("git", ["init", "-q", folder]);
    return folder;
  }

  it("se escribe para su dueño y para nadie más", async () => {
    const folder = repoDePruebas();
    const { path } = await installMcp(folder, ENTRY);
    await soloSuDueno(path);
    // And it is still a JSON with what it was supposed to have.
    const written = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    expect((written["mcpServers"] as Record<string, unknown>)["panoma"]).toEqual(ENTRY);
  });

  /*
    The case that `mode` of `writeFile` **does not** fix: the file already existed. There the mode
    is ignored —it only applies when creating— and without the `chmod` behind it, any `.mcp.json`
    from before this change would stay at 644 forever.
   */
  it("y también los que ya estaban escritos con los permisos de antes", async () => {
    const folder = repoDePruebas();
    const file = join(folder, ".mcp.json");
    writeFileSync(file, JSON.stringify({ mcpServers: { github: { command: "npx" } } }));
    chmodSync(file, 0o644);

    const { path, coexists } = await installMcp(folder, ENTRY);
    await soloSuDueno(path);
    // Without taking down what was there, which is the other rule of this function.
    expect(coexists).toEqual(["github"]);
  });

  it("avisa cuando git se llevaría la clave, que es como se filtran de verdad", async () => {
    const folder = repoDePruebas();
    const { exposedToGit } = await installMcp(folder, ENTRY);
    expect(exposedToGit).toBe(true);
  });

  it("y se calla cuando ya está ignorado: un aviso que salta siempre no se lee", async () => {
    const folder = repoDePruebas();
    writeFileSync(join(folder, ".gitignore"), ".mcp.json\n");
    const { exposedToGit } = await installMcp(folder, ENTRY);
    expect(exposedToGit).toBe(false);
  });

  it("fuera de un repositorio tampoco avisa: no hay git que se lleve nada", async () => {
    const folder = mkdtempSync(join(tmpdir(), "panoma-sin-git-"));
    const { exposedToGit } = await installMcp(folder, ENTRY);
    expect(exposedToGit).toBe(false);
  });

  /*
    And the trap, seen in the source code because from the outside it can't be seen.
    `writeFile(ruta, datos, "utf8", { mode })` **compiles, runs, and does not apply the mode**:
    the signature has three parameters and the fourth is thrown away without saying anything.
    Measured: 644 where 600 was requested.
    The tests above wouldn't catch it, and that is exactly the reason for this one. They look at
    the target file, and there the `chmod` behind it fixes the result even though the `mode`
    hasn't done anything — so the error would be covered up in the place that matters less and
    alive in the one that matters more: **the temporary**, which is born with the key inside, in a
    predictable path next to the original, and that no `chmod` afterward reaches because it is
    renamed immediately. Checking that from the outside would require catching a file that exists
    for a few milliseconds.
    The two writers look at each other —the one from CLI and the one from the web— because they
    write the same files and the error fits equally in either of them.
   */
  it("ningún escritor cae en la firma que descarta el modo en silencio", async () => {
    const escritores = [
      new URL("./mcp.ts", import.meta.url),
      new URL("../../web/app/api/agent/mcp/route.ts", import.meta.url),
    ];

    for (const escritor of escritores) {
      const source = await readFile(escritor, "utf8");
      // The real calls, without which they only appear inside a comment.
      const llamadas = source
        .split("\n")
        .filter((line) => /^\s*(await )?writeFile\(/.test(line));
      expect(llamadas.length, `${escritor.pathname} ya no escribe nada`).toBeGreaterThan(0);

      for (const llamada of llamadas) {
        expect(
          llamada,
          `${escritor.pathname}: el modo va en el objeto de opciones, no como cuarto argumento`,
        ).not.toMatch(/"utf8"\s*,\s*\{/);
      }
      // And the mode is named as many times as it is written.
      expect(
        source.match(/MCP_FILE_MODE/g)?.length ?? 0,
        `${escritor.pathname} escribe sin nombrar MCP_FILE_MODE`,
      ).toBeGreaterThanOrEqual(llamadas.length);
    }
  });
});
