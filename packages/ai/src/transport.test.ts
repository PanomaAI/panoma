import { describe, expect, it } from "vitest";
import { ATTEMPTS, callProvider, transportFailure } from "./transport";

/**
 * The call that doesn't get made.
 *
 * It comes from a sweep of the history that stopped on the ninth pass: two consecutive calls
 * failed in 160 ms, without leaving the machine, and the receipt said ‘fetch failed.’ Nothing can
 * be done with that — not knowing whether it’s the provider, the session, the network, or the
 * process itself. These tests check both halves of the setup: that the internal cause is counted,
 * and that only what can be retried is retried without charging twice.
 */

/** The `TypeError` that Node produces when the connection drops, with its cause inside. */
function fetchFailed(code: string, message: string): TypeError {
  const cause = Object.assign(new Error(message), { code });
  return new TypeError("fetch failed", { cause });
}

const quieto = { wait: async () => {} };

describe("el porqué de un fallo de transporte", () => {
  it("saca el código de la causa, no las dos palabras de fuera", () => {
    expect(transportFailure(fetchFailed("UND_ERR_SOCKET", "other side closed"))).toBe(
      "UND_ERR_SOCKET (other side closed)",
    );
  });

  it("sin causa se queda con lo que hay", () => {
    expect(transportFailure(new TypeError("fetch failed"))).toBe("fetch failed");
  });

  /* A `abort` is a decision of the one who called. Trying again would be disobeying the one who hung up. */
  it("una cancelación no es transporte", () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    expect(transportFailure(abort)).toBeUndefined();
  });

  it("un error del propio código tampoco", () => {
    expect(transportFailure(new Error("no se pudo leer el fichero"))).toBeUndefined();
    expect(transportFailure("una cadena")).toBeUndefined();
  });

  it("un error de red con código y sin envoltura sí lo es", () => {
    expect(transportFailure(Object.assign(new Error("getaddrinfo"), { code: "EAI_AGAIN" }))).toBe(
      "EAI_AGAIN (getaddrinfo)",
    );
  });
});

describe("la llamada al proveedor", () => {
  it("devuelve la respuesta a la primera cuando no falla nada", async () => {
    let veces = 0;
    const response = await callProvider(
      "ChatGPT",
      "https://ejemplo/responses",
      {},
      {
        ...quieto,
        fetchImpl: async () => {
          veces += 1;
          return new Response("bien");
        },
      },
    );

    expect(await response.text()).toBe("bien");
    expect(veces, "sin fallo no hay reintento").toBe(1);
  });

  it("reintenta el fallo de transporte y devuelve lo que conteste el intento bueno", async () => {
    let veces = 0;
    const response = await callProvider(
      "ChatGPT",
      "https://ejemplo/responses",
      {},
      {
        ...quieto,
        fetchImpl: async () => {
          veces += 1;
          if (veces < 3) throw fetchFailed("UND_ERR_SOCKET", "other side closed");
          return new Response("a la tercera");
        },
      },
    );

    expect(await response.text()).toBe("a la tercera");
    expect(veces).toBe(3);
  });

  it("se rinde con la causa dentro del mensaje", async () => {
    let veces = 0;
    const fallo = callProvider(
      "ChatGPT (suscripción)",
      "https://ejemplo/responses",
      {},
      {
        ...quieto,
        fetchImpl: async () => {
          veces += 1;
          throw fetchFailed("ECONNRESET", "socket hang up");
        },
      },
    );

    await expect(fallo).rejects.toThrow(/ECONNRESET/);
    await expect(fallo).rejects.toThrow(/ChatGPT \(suscripción\)/);
    // The number at the end, which is the house rule for everything that has a digit next to it.
    await expect(fallo).rejects.toThrow(`Intentos: ${ATTEMPTS}`);
    expect(veces).toBe(ATTEMPTS);
  });

  /*
    What the provider answers is not retried: that is checked by the caller, with their body in
    front. Here, only what was not answered is retried.
   */
  it("un 429 es una respuesta y sale tal cual, sin repetir la llamada", async () => {
    let veces = 0;
    const response = await callProvider(
      "ChatGPT",
      "https://ejemplo/responses",
      {},
      {
        ...quieto,
        fetchImpl: async () => {
          veces += 1;
          return new Response("demasiadas", { status: 429 });
        },
      },
    );

    expect(response.status).toBe(429);
    expect(veces).toBe(1);
  });

  it("lo que no es transporte sube tal cual y sin reintentar", async () => {
    let veces = 0;
    const fallo = callProvider(
      "ChatGPT",
      "https://ejemplo/responses",
      {},
      {
        ...quieto,
        fetchImpl: async () => {
          veces += 1;
          throw new Error("el cuerpo no era JSON");
        },
      },
    );

    await expect(fallo).rejects.toThrow("el cuerpo no era JSON");
    expect(veces).toBe(1);
  });

  it("espera entre intentos, y no más veces que reintentos hay", async () => {
    const esperas: number[] = [];
    await expect(
      callProvider(
        "ChatGPT",
        "https://ejemplo/responses",
        {},
        {
          wait: async (ms) => {
            esperas.push(ms);
          },
          fetchImpl: async () => {
            throw fetchFailed("UND_ERR_SOCKET", "other side closed");
          },
        },
      ),
    ).rejects.toThrow();

    expect(esperas.length, "no se espera después del último intento").toBe(ATTEMPTS - 1);
    expect(esperas[0]).toBeLessThan(esperas[1] ?? Infinity);
  });
});
