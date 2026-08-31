import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { middleware } from "./middleware";

/**
 * The network gateway, which was open and without a single test.
 *
 * `middleware.ts` is the only thing separating the entire catalog —disk paths, project names, the
 * credentials that `/api/secrets` found in the git history— from anyone who shares the wifi when
 * the port is open. Its two neighbors
 * (`lib/guard.ts` and `packages/core/src/access.ts` ) did have evidence; this one didn't, because
 * it is alive
 * at the root of `apps/web/` and no pattern of `vitest.config.ts` reached that far.
 *
 * What happened in the meantime: the door decided 'this comes from this machine' by reading the
 * header `Host`, which is written by the caller. A `curl -H 'Host: localhost'` from another
 * machine on the same network entered everything. The first of these tests is that `curl`.
 */
const KEY = "k".repeat(64);

/** The server bound to 0.0.0.0 is what `panoma up --network` does. */
function fromNetwork(path = "/api/catalog", headers: Record<string, string> = {}) {
  return new NextRequest(new URL(`http://192.168.1.239:4173${path}`), {
    headers: { host: "192.168.1.239:4173", ...headers },
  });
}

/** What really comes from the machine's own browser. */
function fromHere(path = "/api/catalog", headers: Record<string, string> = {}) {
  return new NextRequest(new URL(`http://localhost:4173${path}`), {
    headers: { host: "localhost:4173", ...headers },
  });
}

/** `NextResponse.next()` does not have its own code: it is recognized by its header. */
const letThrough = (response: Response) => response.headers.get("x-middleware-next") === "1";

afterEach(() => {
  delete process.env["PANOMA_ACCESS_KEY"];
});

describe("la puerta de la red", () => {
  describe("con clave puesta, que es `panoma up --network`", () => {
    it("no deja entrar a quien dice venir de localhost y no trae la clave", () => {
      process.env["PANOMA_ACCESS_KEY"] = KEY;
      /*
        The test. This call returned 200 and the entire catalog:
        curl -H 'Host: localhost:4199' http://192.168.1.239:4199/api/catalog
        The header `Host` is written by the person who calls, so they cannot decide anything. With
        the key in place, everyone is asked, and this question ceases to exist.
       */
      const forged = middleware(fromNetwork("/api/catalog", { host: "localhost:4173" }));
      expect(letThrough(forged)).toBe(false);
      expect(forged.status).toBe(401);
    });

    it("no deja entrar a quien llama desde la red sin traer nada", () => {
      process.env["PANOMA_ACCESS_KEY"] = KEY;
      expect(middleware(fromNetwork()).status).toBe(401);
    });

    it("tampoco con Host: 0.0.0.0, que también estaba en la lista de nombres de casa", () => {
      process.env["PANOMA_ACCESS_KEY"] = KEY;
      const forged = middleware(fromNetwork("/api/catalog", { host: "0.0.0.0:4173" }));
      expect(forged.status).toBe(401);
    });

    it("pide la clave también en la propia máquina", () => {
      process.env["PANOMA_ACCESS_KEY"] = KEY;
      /*
        It is the change that is noticeable, and it is the only way for what is above to be true:
        if the local loop remained exempt, it would be enough to say that you come from it.
        Instead, `panoma up --network` prints the link of this machine with the key inside.
       */
      expect(middleware(fromHere()).status).toBe(401);
    });

    it("deja pasar la cabecera, la cookie y una clave por la URL", () => {
      process.env["PANOMA_ACCESS_KEY"] = KEY;
      expect(letThrough(middleware(fromHere("/", { "x-panoma-key": KEY })))).toBe(true);
      expect(letThrough(middleware(fromNetwork("/", { "x-panoma-key": KEY })))).toBe(true);
      expect(letThrough(middleware(fromNetwork("/", { authorization: `Bearer ${KEY}` })))).toBe(true);
      expect(letThrough(middleware(fromNetwork("/", { cookie: `panoma-access=${KEY}` })))).toBe(true);
    });

    it("una clave equivocada es 401, mida lo que mida", () => {
      process.env["PANOMA_ACCESS_KEY"] = KEY;
      for (const wrong of ["", "x", "k".repeat(63), "k".repeat(65), `${"k".repeat(63)}z`]) {
        const response = middleware(fromNetwork("/", { "x-panoma-key": wrong }));
        expect(response.status, `«${wrong.slice(0, 8)}…» entró`).toBe(401);
      }
    });

    it("la clave que entra por la URL se guarda en cookie y se quita de la barra", () => {
      process.env["PANOMA_ACCESS_KEY"] = KEY;
      const response = middleware(fromNetwork(`/?key=${KEY}`));
      /*
        A URL with the credential inside stays in the phone's history, in the clipboard of whoever
        shares it, and in the log of any proxy it passes through. Entering via link is convenient;
        staying on the link is not.
       */
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).not.toContain(KEY);
      expect(response.headers.get("set-cookie")).toContain("panoma-access=");
      expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    });
  });

  /**
   * The two links that `panoma up --network` prints, and what each one leaves.
   *
   * This is where the difference between looking and commanding lives. The one on the mobile
   * carries `key`; the one on this machine carries `key` and `op`. If the mobile one left the
   * operator cookie, the entire separation —and the routes that depend on it— would be worth
   * nothing, and there would be no way to notice it by looking at the screen: everything would
   * keep working just as well.
   */
  describe("los dos enlaces, y lo que deja cada uno", () => {
    const OPERADOR = "o".repeat(64);

    /** The cookies that the response sends to be set, by name. */
    function galletas(response: Response): Record<string, string> {
      const puestas: Record<string, string> = {};
      for (const raw of response.headers.getSetCookie()) {
        const [pair] = raw.split(";");
        const at = pair!.indexOf("=");
        puestas[pair!.slice(0, at)] = pair!.slice(at + 1);
      }
      return puestas;
    }

    it("el de esta máquina deja las dos, y no queda ni rastro en la barra", () => {
      process.env["PANOMA_ACCESS_KEY"] = KEY;
      process.env["PANOMA_OPERATOR_KEY"] = OPERADOR;
      const response = middleware(fromHere(`/?key=${KEY}&op=${OPERADOR}`));
      expect(response.status).toBe(307);
      const destino = response.headers.get("location") ?? "";
      expect(destino).not.toContain(KEY);
      expect(destino).not.toContain(OPERADOR);

      const puestas = galletas(response);
      expect(puestas["panoma-access"]).toBe(KEY);
      expect(puestas["panoma-operator"]).toBe(OPERADOR);
      delete process.env["PANOMA_OPERATOR_KEY"];
    });

    it("el de la red deja SOLO la de mirar", () => {
      process.env["PANOMA_ACCESS_KEY"] = KEY;
      process.env["PANOMA_OPERATOR_KEY"] = OPERADOR;
      const puestas = galletas(middleware(fromNetwork(`/?key=${KEY}`)));
      expect(puestas["panoma-access"]).toBe(KEY);
      expect(puestas["panoma-operator"], "el móvil se llevó manos en el teclado").toBeUndefined();
      delete process.env["PANOMA_OPERATOR_KEY"];
    });

    it("una `op` que no es la buena no deja nada, aunque la de red sí lo sea", () => {
      process.env["PANOMA_ACCESS_KEY"] = KEY;
      process.env["PANOMA_OPERATOR_KEY"] = OPERADOR;
      const puestas = galletas(middleware(fromNetwork(`/?key=${KEY}&op=${"x".repeat(64)}`)));
      expect(puestas["panoma-access"]).toBe(KEY);
      expect(puestas["panoma-operator"]).toBeUndefined();
      delete process.env["PANOMA_OPERATOR_KEY"];
    });

    it("y una `op` suelta, con la cookie de red ya puesta, se recoge y se borra de la barra", () => {
      /*
        The CLI does not print it, but it arrives on its own: the link to this machine opens a
        month later, the browser still has the network cookie, and before this used to continue
        without picking up the key and leaving it written in the bar — it neither entered nor
        deleted.
       */
      process.env["PANOMA_ACCESS_KEY"] = KEY;
      process.env["PANOMA_OPERATOR_KEY"] = OPERADOR;
      const response = middleware(fromHere(`/?op=${OPERADOR}`, { cookie: `panoma-access=${KEY}` }));
      expect(response.status).toBe(307);
      expect(response.headers.get("location") ?? "").not.toContain(OPERADOR);
      expect(galletas(response)["panoma-operator"]).toBe(OPERADOR);
      delete process.env["PANOMA_OPERATOR_KEY"];
    });
  });

  describe("con clave, cualquiera de las vías vale", () => {
    it("una cookie rancia no tapa una cabecera correcta", () => {
      process.env["PANOMA_ACCESS_KEY"] = KEY;
      /*
        This was a chained one with `??`, so the cookie won by existing and the other routes were
        never checked. The day you rotate the key, the browser keeps the old one and there is no
        way in except by manually deleting cookies — and the MCP client, which sends its
        `Authorization: Bearer` with the agent's key, crashed the same way.
       */
      for (const rancia of ["", "vieja", "k".repeat(63)]) {
        expect(
          letThrough(middleware(fromHere("/", { cookie: `panoma-access=${rancia}`, "x-panoma-key": KEY }))),
          `la cookie «${rancia}» tapó la cabecera`,
        ).toBe(true);
      }
    });
  });

  describe("con el puerto abierto y SIN clave configurada", () => {
    afterEach(() => {
      delete process.env["PANOMA_HOST"];
    });

    it("no se sirve a nadie, ni al que dice venir de casa", () => {
      /*
        `PANOMA_HOST=0.0.0.0 pnpm dev` teaches it to `docs/environment.md` and passes it to `-H`
        the `package.json` itself, in `dev` and in `start`. Without a key, this door stayed
        looking at the `Host` —which is written by whoever calls— so the hole that this file
        closed remained open in the branch next door: measured, `curl -H 'Host: localhost'`
        returned 200 and the entire catalog.
        503 and not 401 because it is not that the caller does not identify themselves: it is that
        this server is not in a position to attend to anyone, and the one who set it up has to
        find out.
       */
      process.env["PANOMA_HOST"] = "0.0.0.0";
      expect(middleware(fromNetwork("/api/catalog", { host: "localhost:4173" })).status).toBe(503);
      expect(middleware(fromNetwork("/api/catalog")).status).toBe(503);
      expect(middleware(fromHere("/api/catalog")).status).toBe(503);
    });

    it("y con el puerto atado a casa no cambia nada", () => {
      process.env["PANOMA_HOST"] = "127.0.0.1";
      expect(letThrough(middleware(fromHere()))).toBe(true);
    });
  });

  describe("sin clave, que es el `panoma up` de todos los días", () => {
    it("el bucle local pasa sin nada", () => {
      expect(letThrough(middleware(fromHere()))).toBe(true);
    });

    it("de fuera se contesta 503 y no una página", () => {
      /*
        503 and not 401: it's not that the caller hasn't identified themselves, it's that this
        server is not in a position to serve anyone from outside. Here the header does decide, and
        it doesn't matter if it can be faked: without a key the port is tied to 127.0.0.1 and the
        packet that would carry it doesn't arrive.
       */
      expect(middleware(fromNetwork()).status).toBe(503);
    });
  });
});
