import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The two sites that talk about the same roof, side by side.
 *
 * The body of an order is written here, in `lib/assignments.ts`, and it is cut there, on the
 * MCP server, when it is delivered to an agent. They are two separate packages, and neither
 * affects the other: the second one lives behind HTTP. So the number is written twice, and that is
 * exactly the pair that separates one day without anyone noticing — the writer uploads theirs, the
 * channel stays on the old one, and the orders keep arriving cut as they used to.
 *
 * The source code is read instead of importing, for the same reason as `i18n-gaps.test.ts`: the
 * fault is not in any function, it's that two files that are supposed to say the same thing say
 * different things, and that can only be seen by putting them side by side.
 */

const RAIZ = join(import.meta.dirname, "..", "..", "..");

function numeroDe(ruta: string, patron: RegExp): number {
  const fuente = readFileSync(join(RAIZ, ruta), "utf8");
  const hallado = patron.exec(fuente);
  if (!hallado?.[1]) throw new Error(`No se encontró ${patron} en ${ruta}`);
  return Number(hallado[1]);
}

describe("el techo del cuerpo de un encargo", () => {
  it("es el mismo para quien lo escribe y para quien lo sirve", () => {
    const redactor = numeroDe("apps/web/lib/assignments.ts", /const BODY_LIMIT = (\d+);/);
    const canal = numeroDe("packages/mcp/src/format.ts", /fullTaskBody: (\d+),/);

    expect(redactor, "si esto cae, el encargo de revisión vuelve a llegar recortado").toBe(canal);
  });
});
