import { afterEach, describe, expect, it, vi } from "vitest";
import { postJson } from "./api";

/**
 * The three ways it could go wrong, which are the ones that were copied by hand into thirteen
 * files and nobody tested them because they all lived inside `.tsx`.
 */
const NO_HAY_NADIE = "no se pudo llegar";

function contesta(status: number, body: unknown, ok = status < 400) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status,
      json: async () => body,
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("hablar con las rutas de la propia aplicación", () => {
  it("cuando sale bien devuelve el cuerpo entero, no solo un sí", () => {
    contesta(200, { ok: true, file: "AGENTS.md", created: true });
    return postJson<{ file: string; created: boolean }>("/api/md/apply", { slug: "x" }, NO_HAY_NADIE).then(
      (result) => {
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.file).toBe("AGENTS.md");
          expect(result.data.created).toBe(true);
        }
      },
    );
  });

  it("manda JSON con su cabecera, que es lo que estaba copiado en cuarenta y cinco sitios", async () => {
    contesta(200, { ok: true });
    await postJson("/api/open", { id: "p1", tool: "folder" }, NO_HAY_NADIE);
    const llamada = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(llamada[0]).toBe("/api/open");
    const opciones = llamada[1] as RequestInit;
    expect(opciones.method).toBe("POST");
    expect((opciones.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(opciones.body).toBe('{"id":"p1","tool":"folder"}');
  });

  it("si el servidor explica por qué, se enseña lo que dijo", async () => {
    contesta(400, { ok: false, error: "esa carpeta ya no está" });
    const result = await postJson("/api/open", {}, NO_HAY_NADIE);
    expect(result).toEqual({ ok: false, message: "esa carpeta ya no está" });
  });

  it("si no lo explica, se enseña el número: peor un número que un hueco", async () => {
    contesta(500, { ok: false });
    const result = await postJson("/api/open", {}, NO_HAY_NADIE);
    expect(result).toEqual({ ok: false, message: "500" });
  });

  /*
    A 200 with `ok: false` is the way these routes say 'I understood you and the answer is no.' It
    is not a transport error, and that is why `response.ok` is not enough.
   */
  it("un 200 que dice ok:false sigue siendo un no", async () => {
    contesta(200, { ok: false, error: "el proyecto no tiene git" });
    const result = await postJson("/api/project", {}, NO_HAY_NADIE);
    expect(result).toEqual({ ok: false, message: "el proyecto no tiene git" });
  });

  it("sin servidor al otro lado se enseña la frase de la pantalla, no una traza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const result = await postJson("/api/open", {}, NO_HAY_NADIE);
    expect(result).toEqual({ ok: false, message: NO_HAY_NADIE });
  });

  /*
    And the case that used to be read backwards: a proxy or a Next error page responds HTML. That
    fell into the same `catch` as the down network and said "no server" — when what there was was
    a server responding incorrectly.
   */
  it("si contesta algo que no es JSON, se dice el estado y no «no hay servidor»", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError("<html>"); } })),
    );
    const result = await postJson("/api/open", {}, NO_HAY_NADIE);
    expect(result).toEqual({ ok: false, message: "502" });
  });
});

/*
  The stitching for the 'nos' that do not fit in `error`. It is the case of `/api/open`, which
  also sends a `hint` with how to fix it, and the two halves are shown together.
 */
describe("cuando el motivo no cabe en una sola clave", () => {
  it("quien llama decide cómo se lee, y si no dice nada se usa `error`", async () => {
    contesta(400, { ok: false, error: "no se pudo abrir", hint: "¿está instalado?" });
    const junto = await postJson("/api/open", {}, NO_HAY_NADIE, (p) =>
      [p.error, p.hint].filter(Boolean).join(" "),
    );
    expect(junto).toEqual({ ok: false, message: "no se pudo abrir ¿está instalado?" });

    contesta(400, { ok: false, error: "no se pudo abrir", hint: "¿está instalado?" });
    const solo = await postJson("/api/open", {}, NO_HAY_NADIE);
    expect(solo).toEqual({ ok: false, message: "no se pudo abrir" });
  });

  it("si la costura no encuentra nada que decir, se cae al motivo de siempre", async () => {
    contesta(500, { ok: false, error: "reventó" });
    const result = await postJson("/api/open", {}, NO_HAY_NADIE, (p) => String(p.hint ?? ""));
    expect(result).toEqual({ ok: false, message: "reventó" });
  });
});
