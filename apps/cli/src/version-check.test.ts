import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { avisoDeVersion, esMasNueva } from "./version-check";

/**
 * The version notice, and above all what it **should not** do.
 *
 * The delicate part is not getting the number right: it's that this doesn't block, doesn't fail
 * outward, and doesn't ask more than once a day. A courtesy notice that adds two seconds to each
 * order, or that crashes when there is no network, is worse than not having it.
 */

let casa: string;
const original = process.env["PANOMA_HOME"];
const sinAviso = process.env["PANOMA_NO_UPDATE_CHECK"];

beforeEach(async () => {
  casa = await mkdtemp(join(tmpdir(), "panoma-version-"));
  process.env["PANOMA_HOME"] = casa;
  delete process.env["PANOMA_NO_UPDATE_CHECK"];
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  if (sinAviso === undefined) delete process.env["PANOMA_NO_UPDATE_CHECK"];
  else process.env["PANOMA_NO_UPDATE_CHECK"] = sinAviso;
  await rm(casa, { recursive: true, force: true });
});

function registroQueDice(version: string) {
  const espia = vi.fn(async () => new Response(JSON.stringify({ version })));
  vi.stubGlobal("fetch", espia);
  return espia;
}

describe("comparar versiones", () => {
  it("acierta con los casos normales", () => {
    expect(esMasNueva("0.2.0", "0.1.0")).toBe(true);
    expect(esMasNueva("0.1.1", "0.1.0")).toBe(true);
    expect(esMasNueva("1.0.0", "0.9.9")).toBe(true);
    expect(esMasNueva("0.1.0", "0.1.0")).toBe(false);
    expect(esMasNueva("0.1.0", "0.2.0")).toBe(false);
  });

  it("compara por número y no por texto", () => {
    /* `"10" < "9"` in alphabetical order, which is how this mistake sneaks in. */
    expect(esMasNueva("0.10.0", "0.9.0")).toBe(true);
    expect(esMasNueva("0.9.0", "0.10.0")).toBe(false);
  });

  it("ignora el sufijo de prerelease al comparar", () => {
    expect(esMasNueva("0.2.0", "0.2.0-rc.1")).toBe(false);
    expect(esMasNueva("0.2.0", "0.1.0-rc.1")).toBe(true);
  });
});

describe("el aviso", () => {
  it("aparece cuando el registro tiene una más nueva", async () => {
    registroQueDice("0.2.0");
    const aviso = await avisoDeVersion("0.1.0");
    expect(aviso).toContain("0.2.0");
    expect(aviso).toContain("0.1.0");
  });

  it("se calla cuando ya estás en la última", async () => {
    registroQueDice("0.1.0");
    expect(await avisoDeVersion("0.1.0")).toBeUndefined();
  });

  it("se calla si no hay red, y no lanza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND registry.npmjs.org");
    }));
    expect(await avisoDeVersion("0.1.0")).toBeUndefined();
  });

  it("se calla si el registro contesta con un error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    expect(await avisoDeVersion("0.1.0")).toBeUndefined();
  });

  it("no pregunta dos veces el mismo día", async () => {
    const espia = registroQueDice("0.2.0");
    await avisoDeVersion("0.1.0");
    await avisoDeVersion("0.1.0");
    await avisoDeVersion("0.1.0");
    expect(espia).toHaveBeenCalledTimes(1);
  });

  it("sigue avisando de la caché sin volver a preguntar", async () => {
    registroQueDice("0.2.0");
    await avisoDeVersion("0.1.0");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("no debería llamarse");
    }));
    expect(await avisoDeVersion("0.1.0")).toContain("0.2.0");
  });

  it("apunta la visita aunque la consulta falle, para no reintentar en cada orden", async () => {
    const espia = vi.fn(async () => {
      throw new Error("sin red");
    });
    vi.stubGlobal("fetch", espia);
    await avisoDeVersion("0.1.0");
    await avisoDeVersion("0.1.0");
    expect(espia).toHaveBeenCalledTimes(1);
    const memoria = JSON.parse(await readFile(join(casa, "version.json"), "utf8")) as {
      visto: number;
    };
    expect(memoria.visto).toBeGreaterThan(0);
  });

  it("no toca la red con PANOMA_NO_UPDATE_CHECK=1", async () => {
    const espia = registroQueDice("0.2.0");
    process.env["PANOMA_NO_UPDATE_CHECK"] = "1";
    expect(await avisoDeVersion("0.1.0")).toBeUndefined();
    expect(espia).not.toHaveBeenCalled();
  });

  it("no dice nada si no sabe qué versión es la suya", async () => {
    const espia = registroQueDice("0.2.0");
    expect(await avisoDeVersion(undefined)).toBeUndefined();
    expect(espia).not.toHaveBeenCalled();
  });

  it("le pregunta a npm y a nadie más", async () => {
    const espia = registroQueDice("0.2.0");
    await avisoDeVersion("0.1.0");
    /*
      `mock.calls` is typed from the spy's signature, which does not declare arguments; the call
      is read as what it is, a list of loose values.
     */
    const [primera] = espia.mock.calls as unknown as [unknown[]];
    const url = String(primera[0]);
    expect(url).toContain("registry.npmjs.org");
    /*
      If this were to point to one of our servers, its logs would be a counter of active users and
      the landing page would stop telling the truth.
     */
    expect(url).not.toContain("panoma.ai");
  });
});
