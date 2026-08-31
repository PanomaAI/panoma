import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CatalogClient, unsafeDestination } from "./client";

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
const seen: { url: string; method: string; auth: string | undefined }[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    seen.push({
      url: request.url ?? "",
      method: request.method ?? "",
      auth: request.headers.authorization,
    });
    if (request.url === "/redirige") {
      response.writeHead(302, { location: "http://otro.example/x" });
      return response.end();
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ claimed: true }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as { port: number }).port;
});

afterAll(() => server.close());

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

describe("lo que hay al otro lado tiene que ser el catálogo", () => {
  it("una redirección se cuenta, no se sigue", async () => {
    const client = new CatalogClient(`http://127.0.0.1:${port}/redirige`, "k");
    await expect(client.post("/redirige", {})).rejects.toThrow(/answered with a redirect/);
  });
});
