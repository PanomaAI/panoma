import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { avisoDeVersion } from "./version-check";

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

describe("cómo se le pregunta al registro", () => {
  it("pide un formato que npm sirve en esa ruta, y no el abreviado", async () => {
    /*
      The abbreviated document is defined for a package's full packument, not for `/<name>/latest`:
      the registry answers 406 to that pair, measured three times out of three on 7-Sep-2026. Every
      non-200 reads as "no answer" in here, so the check failed silently — the visit stamped,
      nothing learnt, nobody told — and it had worked earlier the same day, which is what kept it
      hidden for so long.
     */
    const espia = registroQueDice("0.2.0");
    await avisoDeVersion("0.1.0", true);
    const cabeceras = (espia.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(cabeceras["accept"]).toBe("application/json");
  });
});

describe("cuando no hay nadie mirando la salida", () => {
  it("ni pregunta ni dice nada: el arranque al iniciar sesión escribe en un log que nadie lee", async () => {
    /*
      `panoma up --on-boot` runs at every login with its output redirected. The notice was printed
      there —invisible— and on top of that it spent the machine's one question of the day, almost
      always before there was any Wi-Fi: that stamps the visit with no answer and silences every
      command typed afterwards. What this side stops covering, the catalog covers: it asks on its
      own while it is up.
     */
    const espia = registroQueDice("0.2.0");
    expect(await avisoDeVersion("0.1.0", false)).toBeUndefined();
    expect(espia).not.toHaveBeenCalled();
  });
});

describe("el aviso", () => {
  it("aparece cuando el registro tiene una más nueva", async () => {
    registroQueDice("0.2.0");
    const aviso = await avisoDeVersion("0.1.0", true);
    expect(aviso).toContain("0.2.0");
    expect(aviso).toContain("0.1.0");
  });

  it("se calla cuando ya estás en la última", async () => {
    registroQueDice("0.1.0");
    expect(await avisoDeVersion("0.1.0", true)).toBeUndefined();
  });

  it("se calla si no hay red, y no lanza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND registry.npmjs.org");
    }));
    expect(await avisoDeVersion("0.1.0", true)).toBeUndefined();
  });

  it("se calla si el registro contesta con un error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    expect(await avisoDeVersion("0.1.0", true)).toBeUndefined();
  });

  it("no pregunta dos veces el mismo día", async () => {
    const espia = registroQueDice("0.2.0");
    await avisoDeVersion("0.1.0", true);
    await avisoDeVersion("0.1.0", true);
    await avisoDeVersion("0.1.0", true);
    expect(espia).toHaveBeenCalledTimes(1);
  });

  it("sigue avisando de la caché sin volver a preguntar", async () => {
    registroQueDice("0.2.0");
    await avisoDeVersion("0.1.0", true);
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("no debería llamarse");
    }));
    expect(await avisoDeVersion("0.1.0", true)).toContain("0.2.0");
  });

  it("apunta la visita aunque la consulta falle, para no reintentar en cada orden", async () => {
    const espia = vi.fn(async () => {
      throw new Error("sin red");
    });
    vi.stubGlobal("fetch", espia);
    await avisoDeVersion("0.1.0", true);
    await avisoDeVersion("0.1.0", true);
    expect(espia).toHaveBeenCalledTimes(1);
    const memoria = JSON.parse(await readFile(join(casa, "version.json"), "utf8")) as {
      visto: number;
    };
    expect(memoria.visto).toBeGreaterThan(0);
  });

  it("no toca la red con PANOMA_NO_UPDATE_CHECK=1", async () => {
    const espia = registroQueDice("0.2.0");
    process.env["PANOMA_NO_UPDATE_CHECK"] = "1";
    expect(await avisoDeVersion("0.1.0", true)).toBeUndefined();
    expect(espia).not.toHaveBeenCalled();
  });

  it("no dice nada si no sabe qué versión es la suya", async () => {
    const espia = registroQueDice("0.2.0");
    expect(await avisoDeVersion(undefined, true)).toBeUndefined();
    expect(espia).not.toHaveBeenCalled();
  });

  it("le pregunta a npm y a nadie más", async () => {
    const espia = registroQueDice("0.2.0");
    await avisoDeVersion("0.1.0", true);
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
