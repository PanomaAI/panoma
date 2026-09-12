import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CatalogClient, CatalogError, checkConversationId, unsafeDestination } from "./client";

/**
 * The two things that this client can never do: send the agent's key where it doesn't belong, and
 * let the text of a third party choose the request path.
 *
 * The reason these tests exist is not a bug that would break anything: it is that the
 * configuration file MCP —`.mcp.json`, `~/.claude.json` — is a text file on the user's disk,
 * without special permissions, which is also written **inside their repositories**. It is the
 * surface that an attacker would want to touch, and it is what decides where the key goes. And
 * `taskId` is chosen by the agent from text that Panoma marks as unverified precisely because it
 * is not.
 */

/** A fake catalog that records everything that comes its way. */
let server: Server;
let port: number;
const seen: { url: string; method: string; auth: string | undefined; key: unknown; operator: unknown }[] = [];

/**
 * The two keys of this machine, in a temporary `PANOMA_HOME` and never the real one: the client
 * reads `access.json` once, on the first call, so the home is pointed here before any test posts.
 */
let home: string;
const NETWORK_KEY = "n".repeat(64);
const OPERATOR_KEY = "o".repeat(64);

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-mcp-client-"));
  await writeFile(
    join(home, "access.json"),
    JSON.stringify({ key: NETWORK_KEY, operator: OPERATOR_KEY, createdAt: "2026-09-12T00:00:00.000Z" }),
  );
  process.env["PANOMA_HOME"] = home;

  server = createServer((request, response) => {
    seen.push({
      url: request.url ?? "",
      method: request.method ?? "",
      auth: request.headers.authorization,
      key: request.headers["x-panoma-key"],
      operator: request.headers["x-panoma-operator"],
    });
    if (request.url === "/redirige") {
      response.writeHead(302, { location: "http://otro.example/x" });
      return response.end();
    }
    if (request.url === "/refuse") {
      response.writeHead(409, { "content-type": "application/json" });
      return response.end(JSON.stringify({ error: "ambiguous-id", detail: "claude-cli:a, codex-cli:b", hint: "Name one." }));
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ claimed: true }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  server.close();
  delete process.env["PANOMA_HOME"];
  await rm(home, { recursive: true, force: true });
});

const local = () => new CatalogClient(`http://127.0.0.1:${port}`, "panoma_clave");

describe("a dónde puede viajar la clave del agente", () => {
  /*
    The decision is tested, not the connection: actually asking `http://192.168.1.50` takes ten
    seconds of waiting for a TCP that does not respond, and what needs to be checked here is which
    destinations are accepted, not what is listening on them. The other half — that the check goes
    **before** touching the network — is indeed measured against the server below.
   */
  it("al bucle local, que es el caso de siempre", () => {
    for (const api of ["http://localhost:4173", "http://127.0.0.1:4173", "http://[::1]:4173"]) {
      expect(unsafeDestination(api), api).toBeUndefined();
    }
  });

  it("a la red de casa por http, que es `panoma up --network`", () => {
    for (const api of [
      "http://192.168.1.50:4173",
      "http://10.0.0.7:4173",
      "http://172.16.4.1:4173",
      "http://[fd00::1]:4173",
    ]) {
      expect(unsafeDestination(api), api).toBeUndefined();
    }
  });

  it("a cualquier sitio por https, que es un catálogo remoto de verdad", () => {
    expect(unsafeDestination("https://catalogo.example")).toBeUndefined();
  });

  it("pero NUNCA en claro a un nombre de internet, que es la firma de una configuración tocada", () => {
    for (const api of ["http://evil.example", "http://8.8.8.8", "http://catalogo.example:4173"]) {
      expect(unsafeDestination(api), api).toMatch(/is not sent there/);
    }
  });

  it("y el error señala el fichero que hay que mirar, que es lo accionable", () => {
    expect(unsafeDestination("http://evil.example")).toMatch(/MCP config/);
  });

  it("una dirección que no es una dirección tampoco pasa", () => {
    for (const api of ["no-es-una-url", "file:///etc/passwd", "ftp://x.example"]) {
      expect(unsafeDestination(api), api).toMatch(/PANOMA_API/);
    }
  });

  it("se comprueba antes de tocar la red: ni una conexión al destino vetado", async () => {
    seen.length = 0;
    const client = new CatalogClient("http://evil.example", "k");
    await expect(client.post("/api/agent/log", {})).rejects.toThrow(/is not sent there/);
    expect(seen).toHaveLength(0);
  });
});

describe("el id de tarea no puede elegir la ruta", () => {
  it("un id normal llega donde tiene que llegar, con su clave", async () => {
    seen.length = 0;
    await local().task("tsk_AbC-123_x", { action: "claim" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/agent/tasks/tsk_AbC-123_x");
    expect(seen[0]!.method).toBe("PATCH");
    expect(seen[0]!.auth).toBe("Bearer panoma_clave");
  });

  it("un uuid también: hay tareas más viejas que el formato de hoy", async () => {
    seen.length = 0;
    await local().task("00000000-0000-0000-0000-000000000000", { action: "claim" });
    expect(seen[0]!.url).toBe("/api/agent/tasks/00000000-0000-0000-0000-000000000000");
  });

  /*
    The one who brought this evidence. `new URL()` crashes the `..` before anyone looks, so
    `../../secrets` was not a strange route: it was **another route**, chosen by whoever wrote the
    text from which the agent got the id, and with the Bearer key applied.
   */
  it("no se sale de /api/agent/tasks por mucho que lo intente", async () => {
    for (const malo of [
      "../../secrets",
      "../../../api/secrets",
      "x/../../ai",
      "x?action=complete",
      "x#/otra",
      "..%2f..%2fsecrets",
      "con espacio",
      "",
    ]) {
      seen.length = 0;
      await expect(local().task(malo, { action: "claim" })).rejects.toThrow(/not shaped like a task id/);
      // And above all: nothing has come out on the internet.
      expect(seen, `«${malo}» llegó a pedir algo`).toHaveLength(0);
    }
  });
});

describe("el id de conversación tiene forma antes de viajar", () => {
  it("agente:sesión, con letras, cifras, guiones y puntos, pasa tal cual", () => {
    for (const id of [
      "claude-cli:0f8b2a1c-1111-4222-8333-444455556666",
      "opencode:ses_0199abcDEF123456789012345",
      "gemini-cli:a.b_c-d",
    ]) {
      expect(checkConversationId(id)).toBe(id);
    }
  });

  it("lo que no es un id se rechaza antes de pedir nada, y el error dice de dónde salen", () => {
    for (const malo of ["sin-dos-puntos", ":x", "x:", "a:b:c", "claude cli:x", "../x:y", "a:b?c", "", `a:${"b".repeat(200)}`]) {
      expect(() => checkConversationId(malo), malo).toThrow(/not shaped like a conversation id/);
    }
    expect(() => checkConversationId("x y:z")).toThrow(/panoma_conversations/);
  });
});

describe("una negativa del catálogo llega con su código, su detalle y su pista", () => {
  it("los tres campos viajan enteros y el mensaje conserva la forma de siempre", async () => {
    const client = new CatalogClient(`http://127.0.0.1:${port}/`, "panoma_clave");
    const failure = await client.post("/refuse", {}).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CatalogError);
    const refused = failure as CatalogError;
    expect(refused.status).toBe(409);
    expect(refused.code).toBe("ambiguous-id");
    expect(refused.detail).toBe("claude-cli:a, codex-cli:b");
    expect(refused.hint).toBe("Name one.");
    expect(refused.message).toBe("ambiguous-id. Name one.");
  });
});

describe("las dos llaves de esta máquina viajan solo al bucle local", () => {
  /*
    The network key opens the catalog when the port is open; the operator key is what lets a call
    order this machine to read its own conversation stores and write into another agent's. Both
    come out of the 0600 file, and both go to the local loop and nowhere else — `unsafeDestination`
    lets a private address through for the agent key, and that is exactly where these two must not
    follow: `PANOMA_API` is one editable line in a file inside the person's repositories.
   */
  it("al 127.0.0.1 llegan las dos, junto a la del agente", async () => {
    seen.length = 0;
    await local().post("/api/agent/conversations", {});
    expect(seen).toHaveLength(1);
    expect(seen[0]!.auth).toBe("Bearer panoma_clave");
    expect(seen[0]!.key).toBe(NETWORK_KEY);
    expect(seen[0]!.operator).toBe(OPERATOR_KEY);
  });

  it("a una dirección privada no llega ninguna de las dos, aunque la del agente sí", async () => {
    /*
      The decision, not the connection: `http://192.168.1.50` passes `unsafeDestination`, and a
      real request there would wait on a TCP that never answers. `fetch` is stood in for, so what
      gets measured is the exact header set the client hands it.
     */
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fake = vi.fn(async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fake);
    try {
      await new CatalogClient("http://192.168.1.50:4173", "panoma_clave").post("/api/agent/handoff", {});
    } finally {
      vi.unstubAllGlobals();
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://192.168.1.50:4173/api/agent/handoff");
    expect(calls[0]!.headers["Authorization"]).toBe("Bearer panoma_clave");
    expect(calls[0]!.headers).not.toHaveProperty("x-panoma-key");
    expect(calls[0]!.headers).not.toHaveProperty("x-panoma-operator");
  });
});

describe("lo que hay al otro lado tiene que ser el catálogo", () => {
  it("una redirección se cuenta, no se sigue", async () => {
    const client = new CatalogClient(`http://127.0.0.1:${port}/redirige`, "k");
    await expect(client.post("/redirige", {})).rejects.toThrow(/answered with a redirect/);
  });
});
