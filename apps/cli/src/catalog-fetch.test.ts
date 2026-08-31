import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogFetch } from "./catalog-fetch";

/**
 * Let no one call the catalog again bypassing the header language.
 *
 * `Accept-Language` was handled manually, call by call, and ended up with six out of twenty-four.
 * The other eighteen —`/api/ingest`, `/api/agent/keys`, `/api/describe`, `/api/md/review`,
 * `/api/runs` …— were serviced in the website’s default language, which is bilingual, while the
 * terminal requesting them spoke English and only English. `error` and `hint` from those routes
 * arrived in Spanish at an output that is not.
 *
 * It is not a bug that you notice when reviewing: the call works, it returns what it has to
 * return, and it is only noticeable on the error line — which is exactly the one that is almost
 * never tested. That is why it is checked by reading the code.
 */
const SRC = dirname(fileURLToPath(import.meta.url));

/**
 * Who can call `fetch` on their own, and why.
 *
 * `catalog-fetch.ts` is the one who wraps it, and `version-check.ts` does not talk to the catalog
 * but to the npm registry, where the terminal language means nothing.
 */
const PROPIOS = new Set(["catalog-fetch.ts", "version-check.ts"]);

function ficherosDelCli(): string[] {
  return readdirSync(SRC)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !PROPIOS.has(name))
    .map((name) => join(SRC, name));
}

describe("toda llamada al catálogo dice en qué idioma habla el terminal", () => {
  it("hay ficheros que mirar", () => {
    expect(ficherosDelCli().length).toBeGreaterThan(8);
  });

  it.each(ficherosDelCli())("%s", (ruta) => {
    const codigo = readFileSync(ruta, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    /* `catalogFetch(` contains `Fetch(` with a capital letter, so the pattern does not get confused. */
    const sueltas = [...codigo.matchAll(/(?<![\w.])fetch\s*\(/g)].map((m) => m[0]);
    expect(sueltas, "usa catalogFetch(…) de ./catalog-fetch").toEqual([]);
  });

  it("y la cabecera va puesta, sin pisar las que traiga quien llama", async () => {
    let visto: Headers | undefined;
    const antes = globalThis.fetch;
    globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
      visto = new Headers(init?.headers);
      return Promise.resolve(new Response("{}"));
    }) as typeof fetch;
    try {
      await catalogFetch(new URL("http://localhost:4173/api/catalog"), {
        headers: { "Content-Type": "application/json" },
      });
    } finally {
      globalThis.fetch = antes;
    }
    expect(visto?.get("accept-language")).toBe("en");
    expect(visto?.get("content-type")).toBe("application/json");
  });
});

/**
 * And the part that is not about language: which credential travels, and how far.
 *
 * With the port open there are two keys and not one. `operator` authorizes **executing on this
 * machine** —installing, building, opening an editor— and that is why it cannot leave it: if it
 * traveled to a remote directory, we would be giving another machine the permission to control
 * ours. The network one, on the other hand, is the one the owner printed to view from outside and
 * it can go wherever necessary.
 *
 * The second test is the one that really matters. It is a `if` of a line in `catalog-fetch.ts`, of
 * the type that gets deleted by accident when refactoring and doesn't break anything visible:
 * everything would keep working, and the key would be going out over the network.
 */
describe("qué credencial viaja, y hasta dónde", () => {
  const CLAVE_OPERADOR = "o".repeat(64);
  const CLAVE_RED = "r".repeat(64);

  /** A fake `~/.panoma`, with its `access.json` already written. */
  function casaFalsa(): string {
    const home = mkdtempSync(join(tmpdir(), "panoma-fetch-"));
    writeFileSync(
      join(home, "access.json"),
      JSON.stringify({ key: CLAVE_RED, operator: CLAVE_OPERADOR, createdAt: "" }),
    );
    return home;
  }

  /**
   * The headers with which a call to that address would be made.
   *
   * `resetModules` is not decoration: `catalog-fetch.ts` reads the file once and saves it, which
   * is correct — that is twenty-four calls per scan — but it means that two tests of the same
   * module would share the first reading.
   */
  async function llamar(destino: string): Promise<Headers> {
    vi.resetModules();
    const { catalogFetch: fresco } = await import("./catalog-fetch");
    let visto = new Headers();
    const antes = globalThis.fetch;
    globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
      visto = new Headers(init?.headers);
      return Promise.resolve(new Response("{}"));
    }) as typeof fetch;
    try {
      await fresco(new URL(destino));
    } finally {
      globalThis.fetch = antes;
    }
    return visto;
  }

  beforeEach(() => {
    process.env["PANOMA_HOME"] = casaFalsa();
    delete process.env["PANOMA_ACCESS_KEY"];
  });

  afterEach(() => {
    delete process.env["PANOMA_HOME"];
    delete process.env["PANOMA_ACCESS_KEY"];
  });

  it("al catálogo de esta máquina van LAS DOS claves", async () => {
    /*
      The network one is necessary even if the catalog is the home one, and finding that out cost
      a broken startup: with the port open, the middleware asks everyone for it, so without it
      `panoma up --network` would get a 401 on its own probe, would consider a server that said
      'Ready in 1242ms' dead, and would kill it. And without the operator one, the routes that
      execute something respond with 403.
     */
    const visto = await llamar("http://localhost:4173/api/ingest");
    expect(visto.get("x-panoma-operator")).toBe(CLAVE_OPERADOR);
    expect(visto.get("x-panoma-key")).toBe(CLAVE_RED);
  });

  it("un sondeo no enseña ninguna, que para eso es un sondeo", async () => {
    /*
      `catalogProbe` exists because the two questions of CLI —“has mine started yet?” and “is
      there a stranger at this port?”— are asked when it is still not known who is attending.
      Sending the keys to someone we still don't know would be giving them away: on a shared
      machine, another account could lock the port before us and keep them without ever having
      been able to read the 0600 file.
     */
    vi.resetModules();
    const { catalogProbe } = await import("./catalog-fetch");
    let visto = new Headers();
    const antes = globalThis.fetch;
    globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
      visto = new Headers(init?.headers);
      return Promise.resolve(new Response("{}"));
    }) as typeof fetch;
    try {
      await catalogProbe(new URL("http://localhost:4173/api/catalog"));
    } finally {
      globalThis.fetch = antes;
    }
    expect(visto.get("x-panoma-operator")).toBeNull();
    expect(visto.get("x-panoma-key")).toBeNull();
    expect(visto.get("accept-language")).toBe("en");
  });

  it("la clave de operador va al catálogo de esta máquina, se escriba como se escriba", async () => {
    for (const destino of [
      "http://localhost:4173/api/ingest",
      "http://127.0.0.1:4173/api/ingest",
      "http://[::1]:4173/api/ingest",
    ]) {
      expect((await llamar(destino)).get("x-panoma-operator"), destino).toBe(CLAVE_OPERADOR);
    }
  });

  it("y NO sale de ella, ni a una IP de la red ni a un dominio", async () => {
    for (const destino of [
      "http://192.168.1.239:4173/api/ingest",
      "https://panoma.example.com/api/ingest",
      "http://otra-maquina:4173/api/ingest",
    ]) {
      expect((await llamar(destino)).get("x-panoma-operator"), destino).toBeNull();
    }
  });

  it("fuera de esta máquina, la de red solo si quien llama la exportó", async () => {
    expect((await llamar("http://192.168.1.239:4173/api/catalog")).get("x-panoma-key")).toBeNull();

    process.env["PANOMA_ACCESS_KEY"] = CLAVE_RED;
    /*
      It is the one that makes a `--api` from one machine to another stop crashing against a 401
      with no output.
     */
    expect((await llamar("http://192.168.1.239:4173/api/catalog")).get("x-panoma-key")).toBe(
      CLAVE_RED,
    );
    expect((await llamar("http://localhost:4173/api/catalog")).get("x-panoma-key")).toBe(CLAVE_RED);
  });

  it("sin access.json no manda nada, que es el `panoma up` de todos los días", async () => {
    process.env["PANOMA_HOME"] = mkdtempSync(join(tmpdir(), "panoma-vacia-"));
    const visto = await llamar("http://localhost:4173/api/ingest");
    expect(visto.get("x-panoma-operator")).toBeNull();
    expect(visto.get("x-panoma-key")).toBeNull();
    expect(visto.get("accept-language")).toBe("en");
  });
});
