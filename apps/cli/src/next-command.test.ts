import { describe, expect, it } from "vitest";
import { nextLines, reasonText, type ProjectMoves } from "./next-command";

/**
 * `panoma next` is tested for what it renders, not starting the process.
 *
 * It is the same decision as in `twin-command.ts` and for the same reasons: creating a catalog to
 * check a layout would be slow here and red in CI on Windows without anything being broken. The
 * order has already been tested where it is decided —`next-moves.ts`, with literals— and what
 * remains on this side are promises of the output:
 *
 * - that no movement is taught without the fact that chose it;
 * - that the printed command is one that really works, with the exact slug;
 * - that the question of the north be asked **once** and in the place of the north;
 * - and that what comes out in Spanish comes out just as complete in English.
 */

/** The escape of the colors, written in code so as not to put a control character here. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const API = "http://localhost:4173";

function plain(lines: string[]): string {
  return lines.join("\n").replace(ANSI, "");
}

function project(overrides: Partial<ProjectMoves> = {}): ProjectMoves {
  return {
    slug: "demo",
    name: "Demo",
    north: "Terminado = que mi hermano lo instale sin llamarme por teléfono.",
    moves: [{ kind: "plan", reason: { code: "advisories", count: 3 } }],
    ...overrides,
  };
}

describe("cada movimiento llega con su hecho y con su comando", () => {
  it("enseña el encargo, por qué se propone y cómo lanzarlo", () => {
    const salida = plain(nextLines([project()], API));

    expect(salida).toContain("A prioritized plan");
    expect(salida, "el hecho no es opcional: sin él esto es un horóscopo").toContain(
      "3 open security advisories",
    );
    expect(salida, "el comando lleva el slug exacto, que no hay que adivinar").toContain(
      "panoma next demo plan",
    );
  });

  it("el norte escrito se enseña entrecomillado y encima de todo", () => {
    const salida = plain(nextLines([project()], API)).split("\n");
    const nombre = salida.findIndex((line) => line.includes("Demo"));
    expect(salida[nombre + 1]).toContain("«Terminado = que mi hermano lo instale");
  });

  it("un movimiento desconocido no se traga la línea", () => {
    // A newer catalog than this CLI can propose an order that one cannot name here. Worse than
    // showing the raw code would be showing an empty line.
    const raro = project({ moves: [{ kind: "rewrite", reason: { code: "raro" } }] });
    const salida = plain(nextLines([raro], API));
    expect(salida).toContain("rewrite");
    expect(salida).toContain("raro");
  });
});

describe("la pregunta del norte se hace una vez", () => {
  const sinNorte = project({
    north: null,
    moves: [
      { kind: "plan", reason: { code: "no-north" } },
      { kind: "presentable", reason: { code: "no-readme" } },
    ],
  });

  it("la falta de norte se dice arriba, una vez, con su cuenta", () => {
    const salida = plain(nextLines([sinNorte], API));
    expect(salida).toContain("Without knowing what “finished” means, everything proposed below is guesswork.");
    expect(salida).toContain("No north written: 1 on this list");
  });

  it("y no se repite ni por proyecto ni como un movimiento más", () => {
    // Eight projects without direction were eight identical paragraphs, and with the author's
    // catalog —which no one had— the entire screen was the same sentence.
    const ocho = Array.from({ length: 8 }, (_unused, i) =>
      project({
        slug: `p${i}`,
        name: `P${i}`,
        north: null,
        moves: [
          { kind: "plan", reason: { code: "no-north" } },
          { kind: "presentable", reason: { code: "no-readme" } },
        ],
      }),
    );

    const salida = plain(nextLines(ocho, API));

    expect(salida.match(/guesswork/g), "una sola vez, no una regañina").toHaveLength(1);
    expect(salida, "el encargo que ocupó no se ofrece por su cuenta").not.toContain(
      "panoma next p0 plan",
    );
  });

  it("el resto de movimientos sigue enseñándose", () => {
    const salida = plain(nextLines([sinNorte], API));
    expect(salida).toContain("Make it presentable");
    expect(salida).toContain("panoma next demo presentable");
  });
});

describe("los hechos, uno a uno", () => {
  it("distingue singular de plural donde la palabra cambia", () => {
    // "month" does not pluralize with a loose "s", so these two cannot come out of the same key
    // with a `{s}` attached.
    expect(reasonText({ code: "idle", count: 1 })).toBe("idle for a month");
    expect(reasonText({ code: "idle", count: 14 })).toBe("idle for 14 months");
    const aviso = (n: number) => reasonText({ code: "advisories", count: n });
    expect(aviso(1)).toBe("1 open security advisory");
    expect(aviso(2)).toBe("2 open security advisories");
  });

  it("los hechos sin número no fingen tenerlo", () => {
    expect(reasonText({ code: "no-readme" })).not.toContain("0");
    expect(reasonText({ code: "never-built" })).toBe(
      "nobody has ever checked whether it still builds",
    );
  });

  it("un código que este CLI no conoce se enseña tal cual", () => {
    // Rather than a blank space: the code is traced to the dictionary in a grep.
    expect(reasonText({ code: "codigo-del-futuro" })).toBe("codigo-del-futuro");
  });});

describe("la lista completa", () => {
  it("sin nada que proponer lo dice, y dice de dónde sale ese silencio", () => {
    const salida = plain(nextLines([], API));
    expect(salida).toContain("Nothing to propose: what’s in the catalog is where it should be.");
    expect(salida, "un «todo bien» sin explicar no se cree").toContain("README");
  });

  it("cuenta los proyectos y no los movimientos", () => {
    const dos = [project(), project({ slug: "otro", name: "Otro" })];
    expect(plain(nextLines(dos, API))).toContain("2 projects with something to propose");
  });

  it("con muchos proyectos se corta y se dice cuántos faltan", () => {
    const muchos = Array.from({ length: 11 }, (_, i) =>
      project({ slug: `p${i}`, name: `P${i}` }),
    );
    const salida = plain(nextLines(muchos, API));
    expect(salida).toContain("P7");
    expect(salida, "el noveno ya no cabe").not.toContain("P8");
    expect(salida).toContain("and 3 more projects");
  });

  it("un proyecto sin nombre se enseña por su slug", () => {
    const salida = plain(nextLines([project({ name: "" })], API));
    expect(salida).toContain("demo");
  });

  it("en inglés sale entera, sin media línea en castellano", () => {
    const sinNorte = project({
      north: null,
      moves: [
        { kind: "plan", reason: { code: "no-north" } },
        { kind: "presentable", reason: { code: "no-readme" } },
      ],
    });
    const salida = plain(nextLines([sinNorte], API));
    expect(salida).toContain("What’s next");
    expect(salida).toContain("everything proposed below is guesswork");
    expect(salida).toContain("No north written: 1 on this list");
    expect(salida).toMatch(/[a-z]/);
    expect(salida, "ni una palabra suelta del otro idioma").not.toContain("Sin norte");
  });

  it("el que solo tiene la pregunta no ocupa un bloque: se cuenta al final", () => {
    /*
      Measured the first time this ran against the author's catalog: 112 projects and almost all
      opening with the same sentence, because the North had just come into existence and nobody
      had it. One hundred twelve times the same line is not a work screen.
     */
    const soloPregunta = project({
      slug: "sin-norte",
      name: "Sin norte",
      north: null,
      moves: [{ kind: "plan", reason: { code: "no-north" } }],
    });
    const conTrabajo = project({
      slug: "con-trabajo",
      name: "Con trabajo",
      north: "que mi hermano lo instale sin llamarme",
      moves: [{ kind: "presentable", reason: { code: "no-readme" } }],
    });

    const salida = plain(nextLines([soloPregunta, conTrabajo], API));

    expect(salida).toContain("Con trabajo");
    expect(salida, "el que solo pregunta no abre bloque").not.toContain("Sin norte");
    expect(salida).toContain("1 more project");
  });

  it("cuando todo son preguntas, lo dice en una línea y no en ciento doce", () => {
    const soloPreguntas = Array.from({ length: 112 }, (_unused, i) =>
      project({
        slug: `p${i}`,
        name: `P${i}`,
        north: null,
        moves: [{ kind: "plan", reason: { code: "no-north" } }],
      }),
    );

    const salida = plain(nextLines(soloPreguntas, API));

    expect(salida).toContain("112 more projects");
    // What is being maintained is not the exact number of lines, it is that one hundred and twelve
    // projects fit on a screen and not in a scroll.
    expect(
      salida.split("\n").filter((linea) => linea.trim().length > 0).length,
    ).toBeLessThan(6);
  });
});
