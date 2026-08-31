import { afterEach, describe, expect, it, vi } from "vitest";
import { espera, esperaPorTiempo } from "./wait";
import { sanitizeOutput } from "./safe-output";

/**
 * The progress indicator, and the two things that it has to respect.
 *
 * That it does not write anything outside of a terminal — a seventy-five dot line in a log file is
 * garbage — and that what it writes **survives the output filter**. The second is the proof that
 * this does not need any exception: if the filter leaves it intact, it means it is not moving
 * anyone's cursor.
 */

function conTTY<T>(valor: boolean, hacer: () => T): T {
  const previo = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
  Object.defineProperty(process.stderr, "isTTY", { value: valor, configurable: true });
  try {
    return hacer();
  } finally {
    if (previo) Object.defineProperty(process.stderr, "isTTY", previo);
    else delete (process.stderr as unknown as { isTTY?: boolean }).isTTY;
  }
}

function capturar(): string[] {
  const salidas: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    salidas.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  return salidas;
}

afterEach(() => vi.restoreAllMocks());

describe("fuera de un terminal", () => {
  it("no escribe ni un punto", () => {
    const salidas = capturar();
    conTTY(false, () => {
      const marca = espera();
      for (let i = 0; i < 10; i += 1) marca.uno();
      marca.fin();
    });
    expect(salidas).toEqual([]);
  });
});

describe("en un terminal", () => {
  it("escribe un punto por paso y cierra la línea", () => {
    const salidas = capturar();
    conTTY(true, () => {
      const marca = espera();
      for (let i = 0; i < 3; i += 1) marca.uno();
      marca.fin();
    });
    expect(salidas).toEqual(["·", "·", "·", "\n"]);
  });

  it("marca uno de cada N cuando hay muchos", () => {
    const salidas = capturar();
    conTTY(true, () => {
      const marca = espera(3);
      for (let i = 0; i < 9; i += 1) marca.uno();
      marca.fin();
    });
    expect(salidas.filter((s) => s === "·")).toHaveLength(3);
  });

  it("no cierra una línea que nunca empezó", () => {
    const salidas = capturar();
    conTTY(true, () => espera().fin());
    expect(salidas).toEqual([]);
  });

  it("por tiempo, se para cuando se le dice", async () => {
    const salidas = capturar();
    const parar = conTTY(true, () => esperaPorTiempo(10));
    await new Promise((listo) => setTimeout(listo, 60));
    parar();
    const antes = salidas.length;
    await new Promise((listo) => setTimeout(listo, 40));
    expect(salidas.filter((s) => s === "·").length).toBeGreaterThan(0);
    expect(salidas.length).toBe(antes);
  });
});

describe("no hace falta ninguna excepción en el filtro", () => {
  it("lo que escribe pasa entero por el filtro de salida", () => {
    /*
      The filter erases everything that moves the cursor. If this survives intact, it means it
      doesn't move anything — which is exactly the reason for having chosen dots and not a little
      wheel.
     */
    for (const texto of ["·", "···", "\n", "·····\n"]) {
      expect(sanitizeOutput(texto)).toBe(texto);
    }
  });

  it("y una ruedecita no habría pasado", () => {
    /* Document the reason: `\\r` is the first thing the filter takes away. */
    expect(sanitizeOutput("\r⠋ analizando")).not.toContain("\r");
  });
});
