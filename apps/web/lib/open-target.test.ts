import { afterEach, describe, expect, it, vi } from "vitest";
import { openTarget } from "./open-target";

/**
 * What nobody used to check before, because it lived duplicated inside two `.tsx`.
 *
 * The case that matters is the last one: the reason and the hint are taught together. It is the
 * difference between 'Cursor could not be opened' —which leaves the reader exactly where they
 * were— and 'Cursor could not be opened. Is it installed?', which tells them what to do.
 */
const NO_HAY_NADIE = "no se pudo llegar al catálogo";

function contesta(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status < 400, status, json: async () => body })));
}
const llamada = () =>
  (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;

afterEach(() => vi.unstubAllGlobals());

describe("abrir un proyecto en el disco", () => {
  it("manda el proyecto y la herramienta", async () => {
    contesta(200, { ok: true });
    expect(await openTarget({ id: "p1", tool: "folder" }, NO_HAY_NADIE)).toEqual({ ok: true });
    expect(llamada()[0]).toBe("/api/open");
    expect((llamada()[1] as RequestInit).body).toBe('{"id":"p1","tool":"folder"}');
  });

  /* The only difference between the two copies that existed: the specific destiny. */
  it("y el destino concreto solo cuando lo hay", async () => {
    contesta(200, { ok: true });
    await openTarget({ id: "p1", tool: "editor", with: "cursor" }, NO_HAY_NADIE);
    expect((llamada()[1] as RequestInit).body).toBe('{"id":"p1","tool":"editor","with":"cursor"}');

    vi.unstubAllGlobals();
    contesta(200, { ok: true });
    await openTarget({ id: "p1", tool: "editor", with: "" }, NO_HAY_NADIE);
    expect((llamada()[1] as RequestInit).body).toBe('{"id":"p1","tool":"editor"}');
  });

  it("el motivo y la pista se enseñan juntos: por separado, la mitad que sirve se pierde", async () => {
    contesta(400, { ok: false, error: "No se pudo abrir Cursor.", hint: "¿Está instalado?" });
    expect(await openTarget({ id: "p1", tool: "editor" }, NO_HAY_NADIE)).toEqual({
      ok: false,
      message: "No se pudo abrir Cursor. ¿Está instalado?",
    });
  });

  it("con motivo pero sin pista, se enseña el motivo a secas", async () => {
    contesta(400, { ok: false, error: "Esa carpeta ya no está." });
    expect(await openTarget({ id: "p1", tool: "folder" }, NO_HAY_NADIE)).toEqual({
      ok: false,
      message: "Esa carpeta ya no está.",
    });
  });

  it("y sin servidor, la frase de la pantalla", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await openTarget({ id: "p1", tool: "folder" }, NO_HAY_NADIE)).toEqual({
      ok: false,
      message: NO_HAY_NADIE,
    });
  });
});
