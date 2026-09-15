import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEMORY_OPERATIONS } from "@panoma/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CONTEXT_MEMORY_INPUT,
  CatalogClient,
  CatalogError,
  MemoryNegotiation,
  RECALL_INPUT,
  checkConversationId,
  checkRecallInput,
  contextRequest,
  memoryReadRequest,
  memoryVersionOf,
  unsafeDestination,
} from "./client";

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

/** What the fake catalog says to a hello; each negotiation test sets it before starting one. */
let hello: { status: number; body: unknown } = { status: 200, body: { ok: true, agent: "a" } };

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
    if (request.url === "/memory-fault") {
      response.writeHead(409, { "content-type": "application/json" });
      return response.end(JSON.stringify({ code: "stale_cursor", error: "The continuation is stale.", hint: "Restart the read.", retryable: false }));
    }
    if (request.url === "/api/agent/hello") {
      response.writeHead(hello.status, { "content-type": "application/json" });
      return response.end(JSON.stringify(hello.body));
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

// ── The memory contract, version 2 ────────────────────────────────────────────────────────

const helloRequests = () => seen.filter((request) => request.url === "/api/agent/hello").length;

describe("the hello is a negotiation, and it is asked once", () => {
  it("a catalog that lists version 2 enables the contract", async () => {
    hello = { status: 200, body: { ok: true, agent: "a", memory: { versions: [1, 2], features: ["read", "continuation", "contexts"], profiles: ["mcp-memory-v2"] } } };
    seen.length = 0;
    const negotiation = new MemoryNegotiation(local());
    negotiation.start();
    expect(await negotiation.version()).toBe(2);
    expect(helloRequests()).toBe(1);
    expect(seen[0]!.auth).toBe("Bearer panoma_clave");
  });

  it("a catalog whose hello knows nothing of memory is the legacy catalog", async () => {
    hello = { status: 200, body: { ok: true, agent: "a" } };
    const negotiation = new MemoryNegotiation(local());
    negotiation.start();
    expect(await negotiation.version()).toBe(1);
  });

  it("a hello that failed is legacy for the life of the process, without a second hello", async () => {
    hello = { status: 500, body: { error: "boom" } };
    seen.length = 0;
    const negotiation = new MemoryNegotiation(local());
    negotiation.start();
    expect(await negotiation.version()).toBe(1);
    negotiation.start();
    expect(await negotiation.version()).toBe(1);
    expect(await negotiation.version()).toBe(1);
    expect(helloRequests()).toBe(1);
  });

  it("a catalog that is not there is legacy too, and nothing else is asked of it", async () => {
    // A port nothing listens on: taken from the kernel and released before the hello goes out.
    const probe = createServer();
    await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
    const closed = (probe.address() as { port: number }).port;
    await new Promise<void>((done) => probe.close(() => done()));
    const negotiation = new MemoryNegotiation(new CatalogClient(`http://127.0.0.1:${closed}`, "panoma_clave"));
    negotiation.start();
    expect(await negotiation.version()).toBe(1);
  });

  it("before start there is no hello to wait for, and the answer is legacy", async () => {
    seen.length = 0;
    expect(await new MemoryNegotiation(local()).version()).toBe(1);
    expect(helloRequests()).toBe(0);
  });

  it("only a list that names 2 enables the contract", () => {
    expect(memoryVersionOf({ ok: true, agent: "a", memory: { versions: [1, 2] } })).toBe(2);
    expect(memoryVersionOf({ ok: true, agent: "a", memory: { versions: [1] } })).toBe(1);
    expect(memoryVersionOf({ ok: true, agent: "a", memory: { versions: ["2"] } })).toBe(1);
    expect(memoryVersionOf({ ok: true, agent: "a", memory: { versions: 2 } })).toBe(1);
    expect(memoryVersionOf({ ok: true, agent: "a", memory: null })).toBe(1);
    expect(memoryVersionOf(null)).toBe(1);
    expect(memoryVersionOf("ok")).toBe(1);
  });
});

describe("what a brief asks for", () => {
  const where = { cwd: "/Users/x/panoma", root: "/Users/x/panoma", remote: "https://github.com/x/panoma" };

  it("without the contract, the body the tool has always sent, byte for byte", () => {
    expect(contextRequest(where, {}, 1)).toStrictEqual(where);
    expect(contextRequest(where, { files: ["src/a.ts"], task: "fix the build" }, 1)).toStrictEqual({ ...where, files: ["src/a.ts"], task: "fix the build" });
    // The v2-only inputs do not leak into a legacy body under any name.
    const body = contextRequest(where, { operation: "edit", contextId: "mctx_1", contextGeneration: 2, continuation: "mc_x" }, 1);
    expect(body).toStrictEqual(where);
  });

  it("with the contract, memory v2 with the mode the inputs imply and nothing invented", () => {
    expect(contextRequest(where, {}, 2)).toStrictEqual({ ...where, memory: { version: 2, mode: "orientation" } });
    expect(contextRequest(where, { task: "fix the build" }, 2)).toStrictEqual({ ...where, task: "fix the build", memory: { version: 2, mode: "action" } });
    expect(contextRequest(where, { files: [] }, 2)).toStrictEqual({ ...where, files: [], memory: { version: 2, mode: "action" } });
    expect(contextRequest(where, { files: ["src/a.ts"], operation: "edit", contextId: "mctx_1", contextGeneration: 2, continuation: "mc_x" }, 2)).toStrictEqual({
      ...where,
      files: ["src/a.ts"],
      memory: { version: 2, mode: "action", operation: "edit", contextId: "mctx_1", contextGeneration: 2, continuation: "mc_x" },
    });
  });

  it("memoryVersion 2 is the agent asking for the contract regardless of the hello", () => {
    expect(contextRequest(where, { memoryVersion: 2 }, 1)).toStrictEqual({ ...where, memory: { version: 2, mode: "orientation" } });
  });

  it("the operations it accepts are core's vocabulary, no more and no fewer", () => {
    for (const word of MEMORY_OPERATIONS) expect(CONTEXT_MEMORY_INPUT.operation.safeParse(word).success, word).toBe(true);
    expect(CONTEXT_MEMORY_INPUT.operation.safeParse("delete").success).toBe(false);
    expect(CONTEXT_MEMORY_INPUT.memoryVersion.safeParse(1).success).toBe(false);
    expect(CONTEXT_MEMORY_INPUT.contextId.safeParse("../x").success).toBe(false);
    expect(CONTEXT_MEMORY_INPUT.contextGeneration.safeParse(0).success).toBe(false);
  });
});

describe("what a read by id asks for", () => {
  const where = { cwd: "/Users/x/panoma" };

  it("the location and memory.read, and nothing of a brief", () => {
    expect(memoryReadRequest(where, { memoryKind: "note", memoryId: "note_1", revision: 3 })).toStrictEqual({
      cwd: "/Users/x/panoma",
      memory: { version: 2, read: { kind: "note", id: "note_1", revision: 3 } },
    });
    expect(memoryReadRequest(where, { memoryKind: "decision", memoryId: "dec_1", revision: 1, continuation: "mc_next" })).toStrictEqual({
      cwd: "/Users/x/panoma",
      memory: { version: 2, read: { kind: "decision", id: "dec_1", revision: 1, continuation: "mc_next" } },
    });
  });
});

describe("panoma_recall sorts its inputs before anything travels", () => {
  it("memoryId needs memoryKind and revision, exactly as the brief listed them", () => {
    expect(() => checkRecallInput({ memoryId: "note_1" })).toThrow(/memoryId needs memoryKind and revision/);
    expect(() => checkRecallInput({ memoryId: "note_1" })).toThrow(/missing: memoryKind, revision/);
    expect(() => checkRecallInput({ memoryId: "note_1", memoryKind: "note" })).toThrow(/missing: revision\./);
    expect(() => checkRecallInput({ memoryId: "note_1", revision: 2 })).toThrow(/missing: memoryKind\./);
  });

  it("memoryKind, revision or continuation without memoryId name nothing", () => {
    expect(() => checkRecallInput({ memoryKind: "note" })).toThrow(/memoryKind only make sense with memoryId/);
    expect(() => checkRecallInput({ revision: 2, continuation: "mc_x" })).toThrow(/revision, continuation only make sense with memoryId/);
  });

  it("a read by id and a journal search are two calls, not one", () => {
    const read = { memoryId: "note_1", memoryKind: "note" as const, revision: 2 };
    expect(() => checkRecallInput({ ...read, query: "broken catalog" })).toThrow(/drop query or drop memoryId/);
    expect(() => checkRecallInput({ ...read, entryId: "jrn_1", offset: 10 })).toThrow(/drop entryId, offset or drop memoryId/);
    expect(() => checkRecallInput({ ...read, cursor: "c" })).toThrow(/drop cursor/);
  });

  it("a well-formed read is a read, with its continuation only when given", () => {
    expect(checkRecallInput({ memoryId: "note_1", memoryKind: "note", revision: 2 })).toStrictEqual({ read: { memoryKind: "note", memoryId: "note_1", revision: 2 } });
    expect(checkRecallInput({ memoryId: "dec_1", memoryKind: "decision", revision: 1, continuation: "mc_next" })).toStrictEqual({
      read: { memoryKind: "decision", memoryId: "dec_1", revision: 1, continuation: "mc_next" },
    });
  });

  it("the journal keeps its shape: query with cursor, entryId with offset, or nothing at all", () => {
    expect(checkRecallInput({ query: "broken catalog", cursor: "c" })).toStrictEqual({ journal: { query: "broken catalog", cursor: "c" } });
    expect(checkRecallInput({ entryId: "jrn_1", offset: 1200 })).toStrictEqual({ journal: { entryId: "jrn_1", offset: 1200 } });
    expect(checkRecallInput({})).toStrictEqual({ journal: {} });
  });

  it("§23.4: memoryKind names a commitment or a case too; a case needs no revision and is read at 1, a commitment still does", () => {
    expect(RECALL_INPUT.memoryKind.safeParse("commitment").success).toBe(true);
    expect(RECALL_INPUT.memoryKind.safeParse("case").success).toBe(true);
    expect(RECALL_INPUT.memoryKind.safeParse("task").success).toBe(false);
    expect(checkRecallInput({ memoryId: "cmt_1", memoryKind: "commitment", revision: 2 })).toStrictEqual({ read: { memoryKind: "commitment", memoryId: "cmt_1", revision: 2 } });
    expect(() => checkRecallInput({ memoryId: "cmt_1", memoryKind: "commitment" })).toThrow(/missing: revision\./);
    expect(checkRecallInput({ memoryId: "tsk_1", memoryKind: "case" })).toStrictEqual({ read: { memoryKind: "case", memoryId: "tsk_1", revision: 1 } });
    expect(checkRecallInput({ memoryId: "tsk_1", memoryKind: "case", revision: 1, continuation: "mc_next" })).toStrictEqual({
      read: { memoryKind: "case", memoryId: "tsk_1", revision: 1, continuation: "mc_next" },
    });
    // The wire carries the kind as given: the catalog decides what a case or a commitment is.
    expect(memoryReadRequest({ cwd: "/Users/x/panoma" }, { memoryKind: "case", memoryId: "tsk_1", revision: 1 })).toStrictEqual({
      cwd: "/Users/x/panoma",
      memory: { version: 2, read: { kind: "case", id: "tsk_1", revision: 1 } },
    });
    // Without memoryId the two words name nothing, as before.
    expect(() => checkRecallInput({ memoryKind: "case" })).toThrow(/memoryKind only make sense with memoryId/);
  });
});

describe("the third refusal shape: a code, a sentence and a hint", () => {
  it("the code is the code, and the sentence travels ahead of the hint in the message", async () => {
    const failure = await local().post("/memory-fault", {}).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CatalogError);
    const refused = failure as CatalogError;
    expect(refused.status).toBe(409);
    expect(refused.code).toBe("stale_cursor");
    expect(refused.detail).toBeUndefined();
    expect(refused.hint).toBe("The continuation is stale. Restart the read.");
    expect(refused.message).toBe("stale_cursor. The continuation is stale. Restart the read.");
  });
});
