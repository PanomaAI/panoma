import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sameOrigin } from "./guard";

/**
 * The guardian has to let the interface through and stop at the next tab, and the two halves break
 * in ways that do not resemble each other.
 *
 * What these tests brought: the `Origin` was compared against the address to which Next was tied
 * at startup. With `-H 0.0.0.0` the server believed it was called `http://0.0.0.0:4173` and
 * returned 403 to its own interface — all the buttons of the application, with a message blaming
 * the browser. There was not a single test that noticed it.
 */

function petir(headers: Record<string, string>): Request {
  return new Request("http://0.0.0.0:4173/api/open", { method: "POST", headers });
}

describe("quién puede pedirle cosas a Panoma", () => {
  it("la propia interfaz pasa, aunque el servidor escuche en otra dirección", () => {
    // The browser is on localhost; Next is bound to 0.0.0.0. It is the same application.
    expect(
      sameOrigin(
        petir({ origin: "http://localhost:4173", host: "localhost:4173", "sec-fetch-site": "same-origin" }),
      ),
    ).toBeUndefined();
  });

  it("da igual cómo se escriba el bucle local", () => {
    for (const host of ["127.0.0.1:4173", "[::1]:4173"]) {
      expect(
        sameOrigin(petir({ origin: `http://${host}`, host, "sec-fetch-site": "same-origin" })),
      ).toBeUndefined();
    }
  });

  it("desde el móvil por la red local también es la misma aplicación", () => {
    expect(
      sameOrigin(
        petir({
          origin: "http://192.168.1.239:4173",
          host: "192.168.1.239:4173",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).toBeUndefined();
  });

  it("una página de otro sitio no pasa, aunque diga que es de la casa", () => {
    // `Host` is set by the browser with the URL that it is requesting: it cannot be falsified.
    const blocked = sameOrigin(petir({ origin: "http://evil.com", host: "localhost:4173" }));
    expect(blocked?.status).toBe(403);
  });

  it("otro servidor de desarrollo del mismo equipo tampoco pasa", () => {
    // Same local loop, another port: the port is half of the protection.
    const blocked = sameOrigin(
      petir({ origin: "http://localhost:3000", host: "localhost:4173" }),
    );
    expect(blocked?.status).toBe(403);
  });

  it("`Sec-Fetch-Site` manda por encima de todo lo demás", () => {
    const blocked = sameOrigin(
      petir({ origin: "http://localhost:4173", host: "localhost:4173", "sec-fetch-site": "cross-site" }),
    );
    expect(blocked?.status).toBe(403);
  });

  it("un cliente que no es un navegador pasa: el CLI y el MCP viven de esto", () => {
    expect(sameOrigin(petir({ host: "localhost:4173" }))).toBeUndefined();
  });

  it("un `Origin` que no es una URL no cuela", () => {
    const blocked = sameOrigin(petir({ origin: "null", host: "localhost:4173" }));
    expect(blocked?.status).toBe(403);
  });
});

import { afterEach, beforeEach } from "vitest";
import { localOperatorOnly } from "./guard";

/**
 * Who can order an execution, which is no longer decided by management.
 *
 * These tests said something else until 25-Aug-2026: they checked that a `Host: localhost` passed
 * and a `Host: 192.168.1.239` did not. They faithfully tested what the function did, and what the
 * function did was useless — `Host` is written by whoever calls it, so the `curl` of the wifi sent
 * `localhost` and entered the saved routes.
 *
 * Now it is decided with a key that does not travel on the mobile link. Its absence means that the
 * port is closed, and then there is nothing to ask for.
 */
const OPERADOR = "o".repeat(64);

function ordenar(headers: Record<string, string> = {}): Request {
  return new Request("http://0.0.0.0:4173/api/runs", { method: "POST", headers });
}

describe("quién puede ordenar una ejecución", () => {
  afterEach(() => {
    delete process.env["PANOMA_OPERATOR_KEY"];
  });

  describe("sin clave de operador, que es el `panoma up` de todos los días", () => {
    it("pasa todo el mundo, y no es un descuido", () => {
      /*
        Without the variable, the server is tied to `127.0.0.1`: whoever manages to call it is
        already inside the machine, and asking someone for a credential who could already open the
        folder with the mouse does not protect against anything. The tab next to it —which can
        call `localhost` without being invited— is handled by `sameOrigin`, which goes ahead.
       */
      for (const host of ["localhost:4173", "127.0.0.1:4173", "192.168.1.239:4173"]) {
        expect(localOperatorOnly(ordenar({ host }))).toBeUndefined();
      }
      expect(localOperatorOnly(ordenar())).toBeUndefined();
    });
  });

  describe("con el puerto abierto pero sin clave de operador", () => {
    afterEach(() => {
      delete process.env["PANOMA_ACCESS_KEY"];
      delete process.env["PANOMA_HOST"];
    });

    /*
      The case that made this change WORSE than what it replaced.
      `PANOMA_HOST=0.0.0.0` with `PANOMA_ACCESS_KEY` and without the operator one is the
      configuration documented by `docs/environment.md`, and it is what someone does when setting
      this up manually instead of with `panoma up --network`. There «there is no operator key»
      does not mean «I am at home»: it means that the phone enters with the network key and
      nothing distinguishes it from the owner. Returning `undefined` left those routes open to the
      phone — and with the comparison of `Host` that this replaced the phone received 403, because
      a browser cannot fake its `Host` and can have the key.
     */
    it("se falla cerrado: 403 a todo el mundo", () => {
      process.env["PANOMA_ACCESS_KEY"] = "r".repeat(64);
      expect(localOperatorOnly(ordenar({ host: "192.168.1.239:4173" }))?.status).toBe(403);
      expect(localOperatorOnly(ordenar({ host: "localhost:4173" }))?.status).toBe(403);
    });

    it("también si el puerto se abrió a mano y no hay ninguna clave", () => {
      process.env["PANOMA_HOST"] = "0.0.0.0";
      expect(localOperatorOnly(ordenar({ host: "localhost:4173" }))?.status).toBe(403);
    });

    it("pero con el puerto atado a casa sigue pasando todo el mundo", () => {
      process.env["PANOMA_HOST"] = "127.0.0.1";
      expect(localOperatorOnly(ordenar({ host: "localhost:4173" }))).toBeUndefined();
    });
  });

  describe("con clave de operador, que es `panoma up --network`", () => {
    beforeEach(() => {
      process.env["PANOMA_OPERATOR_KEY"] = OPERADOR;
    });

    it("sin traerla no se pasa, ni diciendo que vienes de casa", () => {
      /*
        The second half is the real test. `Host: localhost` was the master key: it is handwritten
        on a `curl` and counted for all of them. Now it counts for none.
       */
      expect(localOperatorOnly(ordenar({ host: "192.168.1.239:4173" }))?.status).toBe(403);
      for (const host of ["localhost:4173", "127.0.0.1:4173", "[::1]:4173", "0.0.0.0:4173"]) {
        expect(localOperatorOnly(ordenar({ host }))?.status, `«${host}» abrió la puerta`).toBe(403);
      }
    });

    it("con la cabecera pasa, que es como la manda el CLI", () => {
      expect(
        localOperatorOnly(ordenar({ host: "localhost:4173", "x-panoma-operator": OPERADOR })),
      ).toBeUndefined();
    });

    it("con la cookie pasa, que es como la lleva el navegador de esta máquina", () => {
      /* Among other cookies and with spaces, which is how a header `Cookie` arrives real. */
      expect(
        localOperatorOnly(
          ordenar({ cookie: `panoma-lang=es; panoma-operator=${OPERADOR}; panoma-access=zzz` }),
        ),
      ).toBeUndefined();
    });

    it("una clave que se parece no pasa", () => {
      for (const falsa of ["", "o".repeat(63), `${"o".repeat(63)}x`, "o".repeat(65), "O".repeat(64)]) {
        expect(
          localOperatorOnly(ordenar({ "x-panoma-operator": falsa }))?.status,
          `«${falsa.slice(0, 8)}…» abrió la puerta`,
        ).toBe(403);
      }
    });

    it("explica el rechazo en el idioma de quien pregunta", async () => {
      const spanish = localOperatorOnly(ordenar({ cookie: "panoma-lang=es" }));
      const english = localOperatorOnly(ordenar({ cookie: "panoma-lang=en" }));
      const [es, en] = await Promise.all([
        spanish?.json() as Promise<{ error: string }>,
        english?.json() as Promise<{ error: string }>,
      ]);
      expect(es.error).not.toBe(en.error);
      expect(es.error).toMatch(/[áéíóúñ]/);
    });

    it("sin cookie ni cabecera contesta en inglés, como la puerta de entrada", async () => {
      const blocked = localOperatorOnly(ordenar({ host: "192.168.1.239:4173" }));
      const body = (await blocked?.json()) as { error: string; hint: string };
      expect(body.error).not.toMatch(/[áéíóúñ¿¡]/);
      // Explain and advise. It is not checked *with which words*: an assertion about the text
      // breaks when translated without the guardian having changed in any way.
      expect(body.error.length).toBeGreaterThan(20);
      expect(body.hint).toContain("panoma up");
    });
  });
});


/*
  The doors that execute, listed, so that no other opens in silence.
  The mistake that this monitors was not writing a guard incorrectly: it was **not putting it**.
  The doctrine was written in `guard.ts` —the network key allows viewing, not hands on the
  keyboard— and it was applied on only one of five routes. With `panoma up --network` and the link
  with the key, from a mobile device one could launch an installation with its `postinstall`,
  merge a proposal into the repository, or open a terminal with an agent working.
  A doctrine that lives only in a comment is applied when someone remembers. This list is checked,
  and the second test looks for new doors: any route that starts processes has to be on one of the
  two lists, and the exempt one requires writing down why.
  ── And starting processes is not the only way to command this machine ─────────
  One slipped through. `POST /api/twin/sources` grants permission to read the history and
  `POST /api/twin/mine` opens the 1.78 GB and saves them: neither of the two starts a process, so
  the second test didn't look at them, and both decide over the most intimate parts of the disk
  from any mobile with the key. The third test closes that gap with the other family of verbs
  —opening the person's disk and granting permissions on it—, which is the same doctrine stated
  about what really causes harm here.
 */
describe("las puertas que ejecutan llevan todas la misma guarda", () => {
  const API = new URL("../app/api/", import.meta.url);

  const EJECUTAN = [
    "check/route.ts",
    "runs/route.ts",
    "runs/[id]/route.ts",
    "assignments/launch/route.ts",
    "open/route.ts",
    /* They decide on the person's history: grant permission and open the files. */
    "twin/sources/route.ts",
    "twin/mine/route.ts",
    /* And write TASTE.md —what all your agents read— and save the permission of what is inferred. */
    "twin/taste/route.ts",
  ];

  /*
    Exempt **from `localOperatorOnly` **, which is not the same as exempt from everything. Both
    have `sameOrigin`, and for a while, they did not have it: see the list below, where that no
    longer depends on someone remembering.
   */
  const EXENTAS: Record<string, string> = {
    "environment/route.ts":
      "Arranca `--version` de herramientas fijas para saber qué hay instalado. Es detectar, no obedecer: no lleva nada del cliente y el panel lo necesita para pintarse.",
    "search/route.ts":
      "Busca en el código con git. Es mirar, que es justo lo que la clave de red sí da: desde el móvil con la clave se puede buscar. Del navegador ajeno la separa sameOrigin.",
  };

  /*
    And inside a saved route, handler by handler. The first version of the test below did
    `toContain` over the entire file, and thus a hole lived for months: the GET of
    `assignments/launch` probed the three agents with a real `--version` without even receiving
    the `request`, and the test passed because the POST next to it did call the guards. A
    read-only handler inside a door that executes ends up outside writing here why looking is not
    obeying.
   */
  const HANDLERS_EXENTOS: Record<string, string> = {
    "open/route.ts GET":
      "Exento de localOperatorOnly, no de sameOrigin: lista qué editores hay instalados para que el menú pinte solo lo que existe. Es detectar, no obedecer, y no lleva nada del cliente.",
    "twin/sources/route.ts GET":
      "El inventario del historial: tamaños y permisos, sin abrir un solo fichero. Mirar es lo que la clave de red sí da, y aun así lleva sameOrigin.",
    "twin/taste/route.ts GET":
      "Lee el retrato ya escrito y la nota. Mirar, con sameOrigin delante.",
  };

  /*
    Each `export async function` with its body, in order to be able to demand from each one what
    is theirs.
   */
  function handlersDe(source: string): { name: string; body: string }[] {
    return source
      .split(/(?=export async function )/)
      .filter((parte) => parte.startsWith("export async function "))
      .map((parte) => ({
        name: /export async function (\w+)/.exec(parte)![1]!,
        body: parte,
      }));
  }

  function rutas(carpeta: URL, prefijo = ""): string[] {
    const encontradas: string[] = [];
    for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
      if (entrada.isDirectory()) {
        encontradas.push(
          ...rutas(new URL(`${entrada.name}/`, carpeta), `${prefijo}${entrada.name}/`),
        );
      } else if (entrada.name === "route.ts") {
        encontradas.push(`${prefijo}${entrada.name}`);
      }
    }
    return encontradas;
  }

  it("cada handler de cada una lleva las dos guardas, o su motivo escrito", () => {
    for (const ruta of EJECUTAN) {
      const source = readFileSync(new URL(ruta, API), "utf8");
      const handlers = handlersDe(source);
      expect(handlers.length, `${ruta} no exporta ningún handler`).toBeGreaterThan(0);
      for (const { name, body } of handlers) {
        const clave = `${ruta} ${name}`;
        if (clave in HANDLERS_EXENTOS) {
          expect(
            HANDLERS_EXENTOS[clave]!.length,
            `${clave} está exento sin explicar por qué`,
          ).toBeGreaterThan(40);
          continue;
        }
        expect(body, `${clave} no llama a localOperatorOnly`).toContain("localOperatorOnly(request)");
        // And with `sameOrigin` in front: a foreign tab cannot arrange them with a form.
        expect(body, `${clave} no llama a sameOrigin`).toContain("sameOrigin(request)");
      }
    }
  });

  it("una puerta nueva que arranque procesos no puede colarse sin decidir", () => {
    const arranca = /\b(spawn|spawnSync|execFile|execFileSync|exec|run)\s*\(/;
    for (const ruta of rutas(API)) {
      const source = readFileSync(new URL(ruta, API), "utf8");
      if (!arranca.test(source)) continue;
      const decidida = EJECUTAN.includes(ruta) || ruta in EXENTAS;
      expect(
        decidida,
        `${ruta} arranca procesos y no está ni guardada ni exenta con un motivo escrito`,
      ).toBe(true);
      if (ruta in EXENTAS) {
        expect(EXENTAS[ruta]!.length, `${ruta} está exenta sin explicar por qué`).toBeGreaterThan(40);
      }
    }
  });

  /*
    The other family, which is the one that sneaked in: opening the person's history or granting
    permission to open it. It doesn't start any process and does more damage than most of those
    that do — reading 1.78 GB of private conversation and leaving them in a catalog that the
    visitor themselves can consult.
    The call is sought and not the file name: a new path that calls `mineHistory` or `setConsent`
    appears here alone, which is exactly what did not happen the first time.
   */
  /*
    And the third family, which came with the critic: a route that opens a file **from the disk of
    this machine** because the body says which one, and sends it to a provider. It doesn't start
    processes and doesn't touch the history, so the two tests above let it pass.
    The asymmetry of that route is the entire doctrine in one place: uploading your own capture
    from the phone is sending bytes you already had, and requesting one from the mailbox is
    putting your hands on the keyboard of this computer. That is why `readScreenshot` is sought,
    which is the call that opens.
   */
  it("una puerta nueva que abra una captura de este disco tampoco", () => {
    const abre = /\breadScreenshot\s*\(/;
    for (const ruta of rutas(API)) {
      const source = readFileSync(new URL(ruta, API), "utf8");
      if (!abre.test(source)) continue;
      expect(
        source,
        `${ruta} abre un fichero de este disco y no llama a localOperatorOnly`,
      ).toContain("localOperatorOnly(request)");
    }
  });

  /*
    And the rule of which all the above are particular cases: **every** route leads to
    `sameOrigin`, or write here why not.
    The previous lists track families —what runs, what opens the history, what reads a capture—
    and a family is only monitored after someone names it. Three paths belonged to none and that
    is why no one looked at them:
    - `GET /api/search` was by far the worst, precisely because it seemed harmless. Any random tab
    cannot read its response — CORS prevents it — but it **can time it**, and behind it there are
    eighty `git grep`: asking `?q=sk_live_51H` and measuring if it takes time is an oracle,
    character by character, over code that never left this disk. Incidentally, eighty processes
    per request from a `<img src=…>` in a loop.
    - `GET /api/catalog` returns the name and the absolute path of the eighty projects.
    - `GET /api/environment` starts eight processes per request.
    None 'executes' in the sense of the lists above, and all three were open to any webpage the
    user had open in another tab. The lesson is that the good list is the one of **exceptions**:
    that way a new route arrives monitored by default, and anyone who wants to leave it out has to
    write the reason.
    It is checked handler by handler and not file by file, for the same reason as the
    `localOperatorOnly` test: a GET without a guard next to a saved POST went unnoticed.
   */
  const SIN_SAMEORIGIN: Record<string, string> = {
    /*
      The agent channel. It is not called by a browser but by the MCP server, which does not send
      `Sec-Fetch-Site` or `Origin` — `sameOrigin` would let it pass anyway, so putting it would be
      decoration. What really stores them is `requireAgent`: a 192-bit Bearer key stored hashed,
      without which they respond with nothing. And that is indeed checked by the test below, which
      is the half that matters.
     */
    "agent/context/route.ts POST": "Clave de agente (requireAgent). La llama el servidor MCP, que no es un navegador.",
    "agent/log/route.ts POST": "Clave de agente (requireAgent). La llama el servidor MCP, que no es un navegador.",
    "agent/tasks/route.ts POST": "Clave de agente (requireAgent). La llama el servidor MCP, que no es un navegador.",
    "agent/tasks/[id]/route.ts PATCH": "Clave de agente (requireAgent). La llama el servidor MCP, que no es un navegador.",
    "agent/notes/route.ts POST": "Clave de agente (requireAgent). La llama el servidor MCP, que no es un navegador.",
    "agent/journal/route.ts POST": "Clave de agente (requireAgent). La llama el servidor MCP, que no es un navegador.",
    "agent/consult/route.ts POST": "Clave de agente (requireAgent). La llama el servidor MCP, que no es un navegador.",
  };

  it("toda puerta lleva sameOrigin, o dice por escrito por qué no", () => {
    for (const ruta of rutas(API)) {
      const source = readFileSync(new URL(ruta, API), "utf8");
      for (const { name, body } of handlersDe(source)) {
        const clave = `${ruta} ${name}`;
        const motivo = SIN_SAMEORIGIN[clave];
        if (motivo !== undefined) {
          expect(motivo.length, `${clave} está exenta sin explicar por qué`).toBeGreaterThan(40);
          continue;
        }
        expect(body, `${clave} no llama a sameOrigin`).toContain("sameOrigin(request)");
      }
    }
  });

  it("y las que se libran de sameOrigin es porque piden clave de agente", () => {
    for (const clave of Object.keys(SIN_SAMEORIGIN)) {
      const ruta = clave.slice(0, clave.lastIndexOf(" "));
      const nombre = clave.slice(clave.lastIndexOf(" ") + 1);
      const source = readFileSync(new URL(ruta, API), "utf8");
      const handler = handlersDe(source).find((h) => h.name === nombre);
      expect(handler, `${clave} ya no existe: sobra de la lista`).toBeDefined();
      expect(handler!.body, `${clave} no llama a requireAgent`).toContain("requireAgent(request)");
    }
  });

  it("una puerta nueva que abra el historial o conceda su permiso tampoco", () => {
    const intima = /\b(mineHistory|setConsent|setInferredConsent)\s*\(/;
    for (const ruta of rutas(API)) {
      const source = readFileSync(new URL(ruta, API), "utf8");
      if (!intima.test(source)) continue;
      /*
        Only if it really writes: `readConsent` and `inventoryHistory` are looking, and looking is
        what the network key does give. What is pursued here is the route that decides or that
        opens.
       */
      expect(
        source,
        `${ruta} abre el historial o concede su permiso y no llama a localOperatorOnly`,
      ).toContain("localOperatorOnly(request)");
      expect(source, `${ruta} no llama a sameOrigin`).toContain("sameOrigin(request)");
    }
  });
});
