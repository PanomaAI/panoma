import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The four doors that operate, called for real and from outside the house.
 *
 * `guard.test.ts` checks two things separately: that `localOperatorOnly` decides correctly, and
 * that these routes mention it. The third one is missing, which is the one that matters: that when
 * called with a network request **they respond with 403 and do nothing**. A `localOperatorOnly`
 * placed after the first query, or inside a `if` that does not hold, would pass the other two
 * tests and still leave the door open.
 *
 * The handler is called directly, serverless: the save goes before touching the catalog, so the
 * response arrives without opening the database.
 *
 * And in case one day it isn't like that, `PANOMA_HOME` points to a temporary directory before
 * importing anything. A regression here means that the handler keeps going, and going ahead with
 * the actual catalog would be opening a second writer on the user's database while their server
 * has it running. A test cannot do that, let alone the test responsible for warning that something
 * broke.
 */

const DE_LA_RED = "192.168.1.50:4173";
const EN_CASA = "localhost:4173";

/**
 * A request like the one sent by a page from another site.
 *
 * `Sec-Fetch-Site: cross-site` is set by the browser and the page's JavaScript cannot touch it;
 * `Host` is the address that the browser is requesting, so the `evil.com` tab that calls
 * `localhost:4173` sends exactly this.
 */
function desdeOtraPestana(ruta: string, method = "GET"): Request {
  return new Request(`http://${EN_CASA}${ruta}`, {
    method,
    headers: {
      host: EN_CASA,
      origin: "http://evil.example",
      "sec-fetch-site": "cross-site",
    },
  });
}

function desdeLaRed(ruta: string, method: string, body: unknown): Request {
  return new Request(`http://${DE_LA_RED}${ruta}`, {
    method,
    headers: {
      host: DE_LA_RED,
      // Same origin as the host: thus `sameOrigin` lets it pass and the only thing that can stop
      // this request is the guard we are testing.
      origin: `http://${DE_LA_RED}`,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** The operator key of this server is fake. It is what `--network` puts on the child. */
const OPERADOR = "o".repeat(64);

/**
 * The same request, but with the URL that Next really builds under `--network`.
 *
 * It's a difference that seems like a detail and decides whether the test works. Next does not
 * build `request.url` with the address of the caller: it builds it with **its own**, that of the
 * socket it is attached to (`fetchHostname`). With `panoma up --network` that is `0.0.0.0` for all
 * requests, no matter where they come from.
 *
 * So a test that writes the attacker's IP inside the URL —as this one did— is exercising a path
 * that does not exist in production, and considers as valid a guard that there is a no-op. It was
 * verified: removing `localOperatorOnly` from `/api/agent/keys`, the test remained green because
 * the 403 was returned by `isLocalServer`, which there returns `true` to everyone. The header
 * `Host` does bring the attacker's, and that is why it is separate.
 */
function comoEnProduccion(ruta: string, method: string, body: unknown): Request {
  return new Request(`http://0.0.0.0:4173${ruta}`, {
    method,
    headers: {
      host: DE_LA_RED,
      origin: `http://${DE_LA_RED}`,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  process.env["PANOMA_HOME"] = mkdtempSync(join(tmpdir(), "panoma-puertas-"));
  /*
    Without this, nothing is being tested.
    The scenario of this block is a server in `--network`, and since August 25, 2026, that means
    exactly one thing: `PANOMA_OPERATOR_KEY` in the process environment. Without the variable,
    `localOperatorOnly` lets everyone in on purpose — it's the usual `panoma up`, tied to the
    local loop, where whoever arrives is already inside the machine — and the eight tests below
    would end up checking that an open door is open.
   */
  process.env["PANOMA_OPERATOR_KEY"] = OPERADOR;
});

afterAll(() => {
  delete process.env["PANOMA_OPERATOR_KEY"];
});

describe("desde la red, con clave y todo, estas puertas no se abren", () => {
  it("proponer una actualización", async () => {
    const { POST } = await import("./runs/route");
    const response = await POST(desdeLaRed("/api/runs", "POST", { slug: "x", packageName: "y" }));
    expect(response.status).toBe(403);
  });

  it("aplicar o descartar una propuesta", async () => {
    const { PATCH } = await import("./runs/[id]/route");
    const response = await PATCH(
      desdeLaRed("/api/runs/00000000-0000-0000-0000-000000000000", "PATCH", {
        action: "aplicar",
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(response.status).toBe(403);
  });

  it("abrir un terminal con un agente", async () => {
    const { POST } = await import("./assignments/launch/route");
    const response = await POST(
      desdeLaRed("/api/assignments/launch", "POST", {
        id: "00000000-0000-0000-0000-000000000000",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("abrir un editor, una carpeta o un agente", async () => {
    const { POST } = await import("./open/route");
    const response = await POST(desdeLaRed("/api/open", "POST", { slug: "x", tool: "editor" }));
    expect(response.status).toBe(403);
  });

  /*
    The three from Twin, which are the ones that slipped in. None of them starts a process—hence
    the doctrinal test didn't look at them—and the three decide on the most intimate part of the
    disk: granting permission to read the history, opening it, and writing the file that all the
    agents read.
   */
  it("conceder el permiso de leer tu historial", async () => {
    const { POST } = await import("./twin/sources/route");
    const response = await POST(
      desdeLaRed("/api/twin/sources", "POST", { source: "claude-code", allowed: true }),
    );
    expect(response.status).toBe(403);

    /*
      And it not only returns 403: it has granted nothing. It's the half that matters — a guard
      who responds badly after having written the permit is not a guard, it's a notice.
     */
    const { readConsent } = await import("@panoma/core");
    expect((await readConsent()).sources["claude-code"]).not.toBe(true);
  });

  it("hacer que esta máquina abra tu historial", async () => {
    const { POST } = await import("./twin/mine/route");
    const response = await POST(desdeLaRed("/api/twin/mine", "POST", {}));
    expect(response.status).toBe(403);
  });

  it("escribir el retrato que leen todos tus agentes", async () => {
    const { POST } = await import("./twin/taste/route");
    const response = await POST(
      desdeLaRed("/api/twin/taste", "POST", { publishInferred: true }),
    );
    expect(response.status).toBe(403);

    const { readConsent } = await import("@panoma/core");
    expect((await readConsent()).inferred).not.toBe(true);
  });

  /*
    And the fourth, which is from another family: it does not grant permissions or open histories,
    it orders this machine **to open one of its files and send it to a provider**. The same path
    with the image inside the body does not carry this safeguard on purpose — there the caller
    already had the bytes — so what is tested here is exactly the asymmetric half.
   */
  it("hacer que esta máquina abra una captura de su disco y la mande fuera", async () => {
    const { POST } = await import("./twin/look/route");
    const response = await POST(
      desdeLaRed("/api/twin/look", "POST", { slug: "x", shot: "home.png" }),
    );
    expect(response.status).toBe(403);
  });

  /*
    The four that were left out of the first round, and one of them was the worst.
    `/api/agent/keys` and `/api/agent/mcp` defended themselves with `isLocalServer`, which looks
    at the hostname of **the URL of the server** —the address to which Next was tied— and not the
    caller’s. With `--network` that is `0.0.0.0`, so the function returned `true` to everyone: a
    no-op exactly in the mode it was needed. Measured from the wifi with only the network key, the
    one that goes in the mobile link:
    POST /api/check -> 403 POST /api/agent/keys -> 200 {"apiKey":"panoma_w8AL0f…"}
    With that agent key you can access all `/api/agent/*`, you write it in the `~/.claude.json` of
    the owner and revoke theirs. `/api/roots` was simpler: it had no guard, and its `add` ends in
    the same `analyzeProject` as `/api/check`.
   */
  it("emitir una clave de agente", async () => {
    const { POST } = await import("./agent/keys/route");
    const response = await POST(comoEnProduccion("/api/agent/keys", "POST", { name: "pwn" }));
    expect(response.status).toBe(403);
  });

  it("revocar la clave de agente de otro", async () => {
    const { DELETE } = await import("./agent/keys/route");
    const response = await DELETE(comoEnProduccion("/api/agent/keys", "DELETE", { id: "agt_x" }));
    expect(response.status).toBe(403);
  });

  it("escribirle a alguien un servidor MCP en su ~/.claude.json", async () => {
    const { POST } = await import("./agent/mcp/route");
    const response = await POST(
      comoEnProduccion("/api/agent/mcp", "POST", { agent: "claude-cli", name: "pwn" }),
    );
    expect(response.status).toBe(403);
  });

  it("dar de alta una carpeta, que corre git dentro de ella", async () => {
    const { POST } = await import("./roots/route");
    const response = await POST(comoEnProduccion("/api/roots", "POST", { action: "add", folder: "/tmp" }));
    expect(response.status).toBe(403);
  });

  /*
    And the one that gives meaning to all the ones above: the header `Host` no longer decides.
    Until August 25, 2026, these eight defended themselves by comparing `Host` against a list of
    house names, and `Host` is written by whoever calls. A `curl -H 'Host: localhost'` from the
    Wi-Fi went through the eight. The tests above did not see it because they all called with the
    honest header, which is exactly the blind spot that the `docs/network-access.md` table had.
   */
  it("ni fingiendo venir de casa, que es como se saltaban antes", async () => {
    const { POST } = await import("./runs/route");
    const fingido = new Request(`http://${DE_LA_RED}/api/runs`, {
      method: "POST",
      headers: {
        host: EN_CASA,
        origin: `http://${EN_CASA}`,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
      body: JSON.stringify({ slug: "x", packageName: "y" }),
    });
    expect((await POST(fingido)).status).toBe(403);
  });

  it("y el motivo que da es el de la doctrina, no un error cualquiera", async () => {
    const { POST } = await import("./runs/route");
    const response = await POST(desdeLaRed("/api/runs", "POST", { slug: "x" }));
    const body = (await response.json()) as { error?: string; hint?: string };
    expect(body.error).toBeTruthy();
    // The clue has to say what to do, and what needs to be done comes from a command.
    expect(`${body.hint}`).toContain("panoma up");
  });
});

/**
 * The other half, without which what is above does not prove what it says.
 *
 * A guard that responds 403 to everything passes the previous eight tests and leaves the product
 * unusable: the owner, sitting at their computer with the port open, could not launch
 * anything either. So the other side is checked — with the operator key in front, the same call is
 * **not** stopped by this guard.
 *
 * It is not claimed to return 200: past the gate, the route continues on its path and fails
 * because of its own thing (a project that does not exist, an invented id). What is claimed is
 * that the 403 of the doctrine is no longer there, which is the only thing this function responds
 * to.
 */
describe("con la clave de operador, la misma puerta se abre", () => {
  /**
   * Did the request pass through the gate?
   *
   * After the guard, the route goes straight to the database, and this file starts nothing: it
   * crashes with «A dynamic import callback was not specified». That **is** the test — what was
   * wanted to know is that the guard didn't stop it — so it counts as crossing instead of faking a
   * 200 that the route can't give without a catalog.
   *
   * And it does not confuse a previous failure with a subsequent one: in all four routes the guard
   * is the first line of the handler (`sameOrigin(request) ?? localOperatorOnly(request)`), and
   * the tests above verify that without a key it responds with a clean 403, without crashing. If
   * the guard were executed after touching the database, that 403 would not be reached.
   */
  async function cruza(call: () => Promise<Response>): Promise<boolean> {
    try {
      return (await call()).status !== 403;
    } catch {
      return true;
    }
  }

  function conClave(ruta: string, method: string, body: unknown): Request {
    return new Request(`http://${DE_LA_RED}${ruta}`, {
      method,
      headers: {
        host: DE_LA_RED,
        origin: `http://${DE_LA_RED}`,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "x-panoma-operator": OPERADOR,
      },
      body: JSON.stringify(body),
    });
  }

  it("por la cabecera, que es como la manda el CLI", async () => {
    const { POST } = await import("./runs/route");
    expect(
      await cruza(() => POST(conClave("/api/runs", "POST", { slug: "x", packageName: "y" }))),
    ).toBe(true);
  });

  it("y por la cookie, que es como la lleva el navegador de esta máquina", async () => {
    const { POST } = await import("./runs/route");
    const conCookie = new Request(`http://${DE_LA_RED}/api/runs`, {
      method: "POST",
      headers: {
        host: DE_LA_RED,
        origin: `http://${DE_LA_RED}`,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        cookie: `panoma-lang=es; panoma-operator=${OPERADOR}; panoma-access=x`,
      },
      body: JSON.stringify({ slug: "x", packageName: "y" }),
    });
    expect(await cruza(() => POST(conCookie))).toBe(true);
  });

  it("pero no con una clave que se parece", async () => {
    const { POST } = await import("./runs/route");
    for (const falsa of ["", "o".repeat(63), `${"o".repeat(63)}x`, "o".repeat(65)]) {
      const response = await POST(
        new Request(`http://${DE_LA_RED}/api/runs`, {
          method: "POST",
          headers: {
            host: DE_LA_RED,
            origin: `http://${DE_LA_RED}`,
            "sec-fetch-site": "same-origin",
            "content-type": "application/json",
            "x-panoma-operator": falsa,
          },
          body: JSON.stringify({ slug: "x", packageName: "y" }),
        }),
      );
      expect(response.status, `«${falsa.slice(0, 8)}…» abrió la puerta`).toBe(403);
    }
  });
});


/**
 * And the other half of the risk, which is not the network but **the tab next to it**.
 *
 * These six did not have `sameOrigin`. None 'run' in the sense of the `guard.test.ts` lists —
 * that's why none of those tests looked at them — and all six were open to any web page that the
 * user had open at another time:
 *
 * - `/api/search` is the one that matters. An external page cannot read the response —CORS
 * prevents it— but it **can time it**, and behind it there is a `git grep` per project: asking
 * `?q=sk_live_51H` and measuring if it takes time is an oracle, character by character, on code
 * that never left this disk.
 * - `/api/catalog` and `/api/roots` are the disk map: names and absolute paths.
 * - `/api/ai` is this person's AI credentials inventory.
 * - `/api/environment` and `/api/open` start processes to probe what is installed.
 *
 * Here the real handlers are called, as in the block above: a guard placed after the first query
 * passes the `grep` from the file and leaves the door open anyway.
 */
describe("desde la pestaña de al lado, estas puertas tampoco se abren", () => {
  const PUERTAS: { nombre: string; ruta: string; carga: () => Promise<{ GET: (r: Request) => Promise<Response> }> }[] = [
    {
      nombre: "buscar en el código de los ochenta proyectos",
      ruta: "/api/search?q=sk_live",
      carga: () => import("./search/route"),
    },
    {
      nombre: "listar el catálogo con las rutas del disco",
      ruta: "/api/catalog",
      carga: () => import("./catalog/route"),
    },
    {
      nombre: "listar las carpetas vigiladas",
      ruta: "/api/roots",
      carga: () => import("./roots/route"),
    },
    {
      nombre: "el inventario de credenciales de IA",
      ruta: "/api/ai",
      carga: () => import("./ai/route"),
    },
    {
      nombre: "sondear qué runtimes hay instalados",
      ruta: "/api/environment",
      carga: () => import("./environment/route"),
    },
    {
      nombre: "sondear qué editores y agentes hay instalados",
      ruta: "/api/open",
      carga: () => import("./open/route"),
    },
  ];

  for (const { nombre, ruta, carga } of PUERTAS) {
    it(nombre, async () => {
      const { GET } = await carga();
      const response = await GET(desdeOtraPestana(ruta));
      expect(response.status).toBe(403);
    });
  }

  it("el 403 lo da la guarda, no un fallo cualquiera del camino", async () => {
    const { GET } = await import("./catalog/route");
    const response = await GET(desdeOtraPestana("/api/catalog"));
    const body = (await response.json()) as { error?: string; hint?: string };
    expect(body.error).toBeTruthy();
    expect(body.hint).toBeTruthy();
  });

  /*
    And the half that breaks when fixing this: that the interface and the CLI continue to enter.
    It is checked on `sameOrigin` with the exact requests of these six routes, and without calling
    the handlers, because calling them means opening the catalog — and this test runs with
    `PANOMA_HOME` in a temporary directory precisely to avoid doing that. That the cache decides
    correctly in general is already covered by `lib/guard.test.ts`; what is added here is that it
    decides correctly **for these routes**, which are the ones that have just received it.
   */
  it("y la propia interfaz y el CLI siguen entrando por las seis", async () => {
    const { sameOrigin } = await import("@/lib/guard");
    for (const { ruta } of PUERTAS) {
      const laInterfaz = new Request(`http://${EN_CASA}${ruta}`, {
        headers: { host: EN_CASA, origin: `http://${EN_CASA}`, "sec-fetch-site": "same-origin" },
      });
      expect(sameOrigin(laInterfaz), `${ruta} rechaza a su propia interfaz`).toBeUndefined();

      // The CLI and the MCP server are not browsers: neither of the two headers sends.
      const elCli = new Request(`http://${EN_CASA}${ruta}`, { headers: { host: EN_CASA } });
      expect(sameOrigin(elCli), `${ruta} rechaza al CLI`).toBeUndefined();
    }
  });
});
