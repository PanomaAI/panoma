import { afterEach, describe, expect, it, vi } from "vitest";
import { NOT_FOUND, ResponseTooLargeError, fetchJson, isSafeRegistryName } from "./http";

/**
 * The two things that Panoma receives from outside through HTTP and does not control: how much
 * they send, and what package name ends up inside a URL.
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** A chopped-up answer, like the real one: without `Content-Length` and in parts. */
function responding(bytes: number, options: { declarar?: boolean } = {}) {
  globalThis.fetch = vi.fn(async () => {
    const chunk = new TextEncoder().encode("x".repeat(1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= bytes) return controller.close();
        controller.enqueue(chunk);
        sent += chunk.byteLength;
      },
    });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.declarar) headers["Content-Length"] = String(bytes);
    return new Response(body, { status: 200, headers });
  }) as unknown as typeof fetch;
}

describe("cuánto se acepta leer", () => {
  it("una respuesta normal pasa", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(fetchJson("https://x.test/a")).resolves.toEqual({ ok: 1 });
  });

  /*
    With `Content-Length` it stops before downloading anything: it's the cheap case. But that
    header is set by the server and it can be missing or lie —in a chunked response it doesn't
    even appear— so you also have to count what arrives.
   */
  it("se corta por lo que declara la cabecera, sin descargar el cuerpo", async () => {
    responding(8 * 1024 * 1024, { declarar: true });
    await expect(fetchJson("https://x.test/a", { maxBytes: 1024 })).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
  });

  it("y también sin cabecera, contando lo que llega", async () => {
    responding(8 * 1024, { declarar: false });
    await expect(fetchJson("https://x.test/a", { maxBytes: 2048 })).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
  });

  it("pasarse de tamaño no se reintenta", async () => {
    // Retrying costs the entire download again to reach the same conclusion.
    responding(8 * 1024, { declarar: false });
    const spy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await fetchJson("https://x.test/a", { maxBytes: 1024 }).catch(() => {});
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("un 404 sigue siendo «no existe», no un error", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("", { status: 404 }),
    ) as unknown as typeof fetch;
    await expect(fetchJson("https://x.test/a")).resolves.toBe(NOT_FOUND);
  });
});

describe("qué nombre puede acabar dentro de una URL", () => {
  /*
    Two of the seven clients interpolate the name without encoding it, because their names contain
    slashes. The host cannot be changed from there — it is not an SSRF — but it is possible to
    move through the record itself: measured, `a/../../evil` ends up requesting `/evil.json`, that
    is, the data of another package presented as if it were this one, vulnerabilities included.
   */
  it("rechaza lo que navega o corta la ruta", () => {
    for (const malo of [
      "a/../../evil",
      "..",
      "a/b?x=1",
      "a#frag",
      "a\\b",
      "con espacio",
      "salto\nlinea",
      "\x1bescape",
      "/absoluto",
      ".oculto",
      "",
    ]) {
      expect(isSafeRegistryName(malo), malo).toBe(false);
    }
  });

  it("acepta los nombres reales de los siete ecosistemas", () => {
    // A list of allowed ones by ecosystem would be narrower and would leave out legitimate
    // packages, which is a silent failure and worse than this one.
    for (const good of [
      "react",
      "@types/node",
      "flutter_riverpod",
      "vendor/paquete",
      "github.com/gorilla/mux",
      "django-rest-framework",
      "serde_json",
      "activesupport",
      "symfony/http-foundation",
      "@scope/name.with.dots",
      "a-b_c.d",
    ]) {
      expect(isSafeRegistryName(good), good).toBe(true);
    }
  });

  it("rechaza un nombre absurdamente largo", () => {
    expect(isSafeRegistryName("a".repeat(215))).toBe(false);
  });
});
