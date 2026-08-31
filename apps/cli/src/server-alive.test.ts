import { afterEach, describe, expect, it } from "vitest";
import { holdersFromFailure, isAlive, otherHolders, shortCommand } from "./server";

/**
 * What counts as 'the catalog is standing'.
 *
 * This function decides whether `panoma up` waits, gives up, or kills the child, and returned
 * `reply.ok`. With the port open the catalog asks everyone for credentials, so a probe without it
 * receives 401 — and `reply.ok` was `false`.
 *
 * The result, measured on August 25, 2026: `panoma up --network` **never** started. Sixty seconds
 * of waiting, 'the server did not respond,' and then the child process was dead, while its own log
 * said 'Ready in 1242ms.' And since killing it sent the signal to the leader and not to the group,
 * `next-server` survived listening over the entire Wi-Fi after its files had been deleted: neither
 * `down` could find it nor `up` could handle the port. Three orphans were left like this before
 * seeing it.
 *
 * The one who answers with the door of Panoma **is** Panoma. Whether it lets us pass is another
 * question, and this function it does not perform.
 */
function responde(status: number): typeof fetch {
  return (() => Promise.resolve(new Response("{}", { status }))) as typeof fetch;
}

const original = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = original;
});

describe("isAlive", () => {
  it("un 200 es estar vivo", async () => {
    globalThis.fetch = responde(200);
    expect(await isAlive("http://localhost:4173")).toBe(true);
  });

  it("un 401 y un 403 también, que es el catálogo con el puerto abierto", async () => {
    for (const status of [401, 403]) {
      globalThis.fetch = responde(status);
      expect(await isAlive("http://localhost:4173"), `${status} se dio por muerto`).toBe(true);
    }
  });

  it("un 503 no: es el servidor diciendo que no está en condiciones", async () => {
    /*
      The 503 is returned by the middleware when the port is open and the key is missing. It is
      exactly the opposite of 'ready': there is a process, but it is poorly set up and will be of
      no use to anyone. Considering it alive would leave `up` saying 'catalog standing' about
      something useless.
     */
    globalThis.fetch = responde(503);
    expect(await isAlive("http://localhost:4173")).toBe(false);
  });

  it("y si no contesta nadie, tampoco", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("ECONNREFUSED"))) as typeof fetch;
    expect(await isAlive("http://localhost:4173")).toBe(false);
  });
});

/**
 * Who has the database open, which differs from 'who left a marker'.
 *
 * The seal (`web.json`) only recognizes the servers that `panoma up` started. Measured on August
 * 25, 2026, on this machine: a catalog lifted with `pnpm --filter @panoma/web start` served on
 * 4173 and there was no seal at all, so `panoma up --api http://localhost:4174` would have started
 * a SECOND server on the same `~/.panoma/db`. PGlite does not lock its data directory — it is
 * verified in `upCommand` 's comment — and two writers corrupt it: it's the August accident again.
 *
 * That is why the operating system is asked, which does not depend on who started anyone. Here the
 * pure half is tested: reading the output of `lsof -t`, which brings one line per open file and
 * therefore the same pid dozens of times.
 */
describe("quién más tiene la base abierta", () => {
  it("resume decenas de líneas en los pids distintos que hay detrás", () => {
    expect(otherHolders("40874\n40874\n40874\n40874\n", 999)).toEqual([40874]);
  });

  it("no se cuenta a sí mismo: el proceso que pregunta no es el intruso", () => {
    expect(otherHolders("40874\n999\n", 999)).toEqual([40874]);
    expect(otherHolders("999\n999\n", 999)).toEqual([]);
  });

  it("varios inquilinos salen ordenados, que es como se leen", () => {
    expect(otherHolders("777\n40874\n123\n", 999)).toEqual([123, 777, 40874]);
  });

  it("la salida vacía o con basura no inventa a nadie", () => {
    // `lsof` comes out with 1 and without writing anything when it finds no one: that is 'none',
    // and confusing it with 'could not check' would leave `panoma up` blocked forever.
    expect(otherHolders("", 999)).toEqual([]);
    expect(otherHolders("\n  \nno-soy-un-pid\n-3\n0\n", 999)).toEqual([]);
  });

  /*
    And the CUT output is not read at all, which is another thing.
    If `lsof` exceeds the limit, we send the signal and what was written gets cut off wherever it
    hits: “40874” may have become “4087”. That number parses just as well and would name a process
    that does not exist, leaving the reader with nothing to shut down. That is why the cutoff is
    detected by `killed` /`signal` and not by the content — from the outside, a truncated output
    is indistinguishable from a complete one.
   */
  it("una salida a medias es un pid a medias: no se lee", () => {
    expect(holdersFromFailure({ killed: true, signal: "SIGTERM", stdout: "4087" }, 999)).toEqual([]);
    expect(holdersFromFailure({ signal: "SIGKILL", stdout: "40874" }, 999)).toEqual([]);
  });

  it("pero salir con 1 sin que nadie lo mate sí se lee: es «no hay nadie», o los que haya", () => {
    expect(holdersFromFailure({ killed: false, signal: null, stdout: "" }, 999)).toEqual([]);
    expect(holdersFromFailure({ killed: false, signal: null, stdout: "40874\n" }, 999)).toEqual([40874]);
  });

  it("y un fallo sin salida —lsof que no existe, en Windows— deja arrancar", () => {
    // Intentionally fail forward: this is one more network, not a new door.
    expect(holdersFromFailure(new Error("ENOENT"), 999)).toEqual([]);
    expect(holdersFromFailure(undefined, 999)).toEqual([]);
  });

  /*
    And the name of the process, readable.
    `ps` writes the control characters in octal, so a `node -e` of multiple lines comes out with
    `\012` inside. The first version cut it blindly and the message ended up split in the middle
    of a quote — measured with the test process of this same setup.
   */
  it("aplana los escapes de ps y avisa cuando corta", () => {
    expect(shortCommand("next-server (v15.5.23)\n")).toBe("next-server (v15.5.23)");
    expect(shortCommand("node -e \\012const fs=require('fs');\\012const fd=0;\n", 30)).toBe(
      "node -e const fs=require('fs'…",
    );
    expect(shortCommand("\n")).toBeUndefined();
    expect(shortCommand("   \n")).toBeUndefined();
  });
});
