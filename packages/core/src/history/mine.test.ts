import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasReader, mineHistory, readableSources } from "./mine";
import { setConsent } from "./consent";

/**
 * What must be upheld here is a single phrase: **without permission, a file is not opened.**
 *
 * It is not enough to check that the result comes back empty, because a reader could have read the
 * entire disc and return little. That is why the cases set up a transcript with a recognizable
 * sentence and check that that sentence does not appear: if it did, it means it was opened.
 */
let root = "";
let casos = 0;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "panoma-mine-")));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A house with a transcript of Claude Code inside and a directory of Panoma aside. */
function escenario(): { home: string; panomaHome: string } {
  casos += 1;
  const home = join(root, `caso-${casos}`);
  const file = join(home, ".claude", "projects", "-casa-proyecto", "sesion-1.jsonl");
  mkdirSync(dirname(file), { recursive: true });
  const lineas = [
    {
      type: "assistant",
      sessionId: "s1",
      timestamp: "2026-08-20T10:00:00.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "Cambiado el botón." }] },
    },
    {
      type: "user",
      sessionId: "s1",
      timestamp: "2026-08-20T10:01:00.000Z",
      cwd: "/casa/proyecto",
      message: { role: "user", content: "no me gusta ese azul" },
    },
  ];
  writeFileSync(file, `${lineas.map((l) => JSON.stringify(l)).join("\n")}\n`, "utf8");
  return { home, panomaHome: join(root, `panoma-${casos}`) };
}

describe("mineHistory", () => {
  it("sin permiso no abre ni un fichero", async () => {
    const { home, panomaHome } = escenario();

    const salida = await mineHistory("claude-code", { home }, panomaHome);

    expect(salida.allowed).toBe(false);
    expect(salida.result).toBeUndefined();
    expect(JSON.stringify(salida)).not.toContain("no me gusta ese azul");
  });

  it("con permiso lee y devuelve las reacciones", async () => {
    const { home, panomaHome } = escenario();
    await setConsent("claude-code", true, panomaHome);

    const salida = await mineHistory("claude-code", { home }, panomaHome);

    expect(salida.allowed).toBe(true);
    expect(salida.result?.reactions).toHaveLength(1);
    expect(salida.result?.reactions[0]?.reaction).toBe("no me gusta ese azul");
  });

  it("el permiso de una fuente no abre la de al lado", async () => {
    const { home, panomaHome } = escenario();
    await setConsent("codex", true, panomaHome);

    const salida = await mineHistory("claude-code", { home }, panomaHome);

    expect(salida.allowed).toBe(false);
  });

  it("revocar vuelve a cerrar la puerta", async () => {
    const { home, panomaHome } = escenario();
    await setConsent("claude-code", true, panomaHome);
    await setConsent("claude-code", false, panomaHome);

    const salida = await mineHistory("claude-code", { home }, panomaHome);

    expect(salida.allowed).toBe(false);
    expect(salida.result).toBeUndefined();
  });

  it("una fuente sin lector se comporta como una sin permiso, no como un fallo", async () => {
    // Cursor appears in the inventory because it is on the disk, but no one knows how to read them
    // yet. Returning 'not allowed' is honest; throwing would turn a known gap into an error that
    // has to be caught on every surface.
    const { home, panomaHome } = escenario();
    await setConsent("cursor", true, panomaHome);

    const salida = await mineHistory("cursor", { home }, panomaHome);

    expect(salida.allowed).toBe(false);
    expect(hasReader("cursor")).toBe(false);
  });

  it("las fuentes con lector son las dos que hay", () => {
    expect(readableSources().sort()).toEqual(["claude-code", "codex"]);
  });
});
