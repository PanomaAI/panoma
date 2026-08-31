import { TASTE_CAP, tasteDigest, worstBlock, type TasteLine } from "@panoma/core";
import { describe, expect, it } from "vitest";
import { budgetOf, charsOf, heaviest, worstBlockOf } from "./taste-budget";

/**
 * The cost arithmetic is written twice —here in `charsOf` and in `digest()` of the engine— because
 * the one who needs it is a client component and the engine carries `node:fs`. Duplicating a
 * calculation is acceptable **only** if something screams when the two copies disagree, and this
 * is that something: each case is measured with both and the same number is required.
 *
 * Without this file, the day the engine changed the separator, the screen would keep saying 'three
 * more fit' until someone actually hit the stop.
 */

const TOPIC_OF = ["design", "frontend", "backend", "cli", "testing", "copy"];

function line(topic: string, statement: string): TasteLine {
  return { topic, statement, citations: [] };
}

/** What the engine says, which is the truth. */
function engine(lines: TasteLine[]): number {
  return tasteDigest({ lines, chars: 0, cap: TASTE_CAP }, Infinity).length;
}

describe("lo que ocupa el retrato, contado igual que en el motor", () => {
  const casos: { nombre: string; lines: TasteLine[] }[] = [
    { nombre: "vacío", lines: [] },
    { nombre: "una sola frase", lines: [line("frontend", "Quieres que todo comparta la misma UI.")] },
    {
      nombre: "dos de la misma sección, que comparten fila",
      lines: [line("frontend", "Una cosa."), line("frontend", "Otra cosa.")],
    },
    {
      nombre: "dos secciones, que son dos filas y un salto",
      lines: [line("other", "Una cosa."), line("cli", "Otra cosa.")],
    },
    {
      nombre: "las cinco secciones a la vez",
      lines: [
        line("other", "G."),
        line("landing", "L."),
        line("frontend", "A."),
        line("cli", "C."),
        line("docs", "D."),
      ],
    },
    {
      nombre: "con espacio de sobra dentro de la frase",
      lines: [line("frontend", "  Quieres   que   todo   encaje.  ")],
    },
    {
      nombre: "una seccion que el motor no conoce",
      lines: [line("frontend", "Si."), line("inventada", "No deberia contar.")],
    },
    {
      nombre: "una frase vacia, que no es una regla",
      lines: [line("frontend", "   "), line("frontend", "Si.")],
    },
  ];

  for (const caso of casos) {
    it(`coincide con el motor: ${caso.nombre}`, () => {
      expect(charsOf(caso.lines)).toBe(engine(caso.lines));
    });
  }

  /* The case that really matters: a portrait the size of the one that broke. */
  it("coincide con el motor en un retrato que se pasa del tope", () => {
    const lines = Array.from({ length: 30 }, (_unused, index) =>
      line(TOPIC_OF[index % 5]!, `Frase numero ${index} sobre como te gusta que quede esto.`),
    );
    expect(charsOf(lines)).toBe(engine(lines));
  });
});

/**
 * What is accepted versus what is truly written.
 *
 * The measured case: 27 sentences accepted in the database, 14 in the file, 13 that didn't reach
 * any agent — and a screen that displayed them all together under 'what represents you'.
 */
describe("que esta aceptado y que llega de verdad a los agentes", () => {
  const fichero = {
    lines: [line("frontend", "Dentro del fichero.")],
    chars: 40,
    cap: TASTE_CAP,
  };

  it("nombra las aceptadas que no estan escritas", () => {
    const budget = budgetOf(
      [
        { id: "a", topic: "frontend", statement: "Dentro del fichero." },
        { id: "b", topic: "frontend", statement: "Fuera del fichero." },
      ],
      fichero,
    );

    expect([...budget.unpublished]).toEqual(["b"]);
    expect(budget.written).toBe(40);
  });

  /*
    The file is a command surface: editing it by hand is a function of the product, and
    reinserting a line cannot convert it into another sentence.
   */
  it("el espacio de mas no convierte una frase en otra", () => {
    const budget = budgetOf(
      [{ id: "a", topic: "frontend", statement: "  Dentro   del fichero.  " }],
      fichero,
    );
    expect(budget.unpublished.size).toBe(0);
  });

  it("una frase de otra seccion no es la misma frase", () => {
    const budget = budgetOf([{ id: "a", topic: "cli", statement: "Dentro del fichero." }], fichero);
    expect([...budget.unpublished]).toEqual(["a"]);
  });

  it("sin nada aceptado no hay nada sin publicar", () => {
    expect(budgetOf([], fichero).unpublished.size).toBe(0);
    expect(budgetOf([], fichero).chars).toBe(0);
  });
});

/**
 * The worst block: the global one plus the project that has the most limited phrases.
 *
 * It is the number against which the limit is checked, and confusing it with the global block
 * caused a real error: the marking bar only projected the global, so it said '2,990, fits' while
 * what was going to be written was 3,533 and the save was refused. A projection that does not
 * project the same thing that is checked is worse than none, because one trusts it.
 */
describe("el peor bloque, contado igual que en el motor", () => {
  function scoped(topic: string, statement: string, scope: string): TasteLine {
    return { ...line(topic, statement), scope };
  }

  const casos: { nombre: string; lines: TasteLine[] }[] = [
    { nombre: "sin nada acotado", lines: [line("frontend", "Una."), line("cli", "Otra.")] },
    {
      nombre: "un solo proyecto acotado",
      lines: [line("frontend", "Global."), scoped("frontend", "De uno.", "uno")],
    },
    {
      nombre: "dos proyectos, que no se suman entre ellos",
      lines: [
        line("frontend", "Global."),
        scoped("frontend", "De uno.", "uno"),
        scoped("frontend", "De dos.", "dos"),
      ],
    },
    {
      nombre: "acotadas en secciones distintas",
      lines: [
        line("other", "Global."),
        scoped("cli", "De uno en cli.", "uno"),
        scoped("frontend", "De uno en app.", "uno"),
      ],
    },
    { nombre: "todo acotado y nada global", lines: [scoped("frontend", "Solo esta.", "uno")] },
    { nombre: "vacio", lines: [] },
  ];

  for (const caso of casos) {
    it(`coincide con el motor: ${caso.nombre}`, () => {
      expect(worstBlockOf(caso.lines)).toBe(worstBlock(caso.lines));
    });
  }

  /*
    The scope of a sentence comes in **two** fields —`scoped` indicates if it is only valid in its
    place and `project` indicates which one it is— and this test passes them like that, which is
    how they really come from the catalog. The previous version gave `budgetOf` a `scope` already
    resolved that the page had no way of obtaining, and that is why it saw nothing when the page
    started to pass unresolved rows: the card counted the entire portrait as global and said
    “3,718 of 3,000, does not fit” about one that occupied 2,630 and did fit. A test that gives
    the function what the function wants, instead of what its caller has, does not test the path
    that is actually used.
   */
  it("el presupuesto de lo aceptado mide el peor bloque, no la suma de todo", () => {
    const largo = "x".repeat(150);
    const accepted = [
      { id: "a", topic: "frontend", statement: `A ${largo}`, scope: "uno" },
      { id: "b", topic: "frontend", statement: `B ${largo}`, scope: "dos" },
    ];
    const lines = [
      { topic: "frontend", statement: `A ${largo}`, scope: "uno" },
      { topic: "frontend", statement: `B ${largo}`, scope: "dos" },
    ];
    const budget = budgetOf(accepted, { lines: [], chars: 0, cap: TASTE_CAP });
    expect(budget.chars, "no es la suma de los dos proyectos").toBeLessThan(charsOf(lines));
    expect(budget.chars).toBe(worstBlock(lines as TasteLine[]));
  });

  /* And a bounded one without a known project cannot be bounded to any place: global count. */
  it("una acotada cuyo proyecto ya no está en el catálogo cuenta como global", () => {
    const accepted = [{ id: "a", topic: "frontend", statement: "Una.", scoped: true }];
    const budget = budgetOf(accepted, { lines: [], chars: 0, cap: TASTE_CAP });
    expect(budget.chars).toBe(charsOf([{ topic: "frontend", statement: "Una." }]));
  });
});

/**
 * And whose block is the one that doesn't fit.
 *
 * Measured live: limiting three consecutive sentences moved the total from 3,228 to 3,195, because
 * they were going to a project that was already the heaviest. Without the name in front, that
 * looks like a broken button.
 */
describe("quien manda en el peor bloque", () => {
  const largo = "x".repeat(200);

  it("sin acotadas, todo es global y no hay proyecto que nombrar", () => {
    const uno = heaviest([{ topic: "frontend", statement: largo }]);
    expect(uno.project).toBeUndefined();
    expect(uno.own).toBe(0);
    expect(uno.global).toBe(uno.chars);
  });

  it("nombra el proyecto que mas suma encima de lo global", () => {
    const lines = [
      { topic: "frontend", statement: "Corta." },
      { topic: "frontend", statement: `A ${largo}`, scope: "pesado" },
      { topic: "frontend", statement: "B.", scope: "ligero" },
    ];
    expect(heaviest(lines).project).toBe("pesado");
  });

  /*
    What this test taught and changed in the design: the block of a project is the global PLUS its
    own, so with a single limited sentence the "heaviest" is its project by construction. Simply
    naming it would mean removing things from there when what bulks up is the shared.
   */
  it("el reparto dice cuanto viene de lo compartido, aunque mande el proyecto", () => {
    const lines = [
      { topic: "frontend", statement: `G ${largo}` },
      { topic: "frontend", statement: "B.", scope: "ligero" },
    ];
    const worst = heaviest(lines);
    expect(worst.project, "el proyecto siempre gana: su bloque incluye lo global").toBe("ligero");
    expect(worst.global, "y aun asi casi todo es global").toBeGreaterThan(worst.own * 10);
    expect(worst.global + worst.own).toBe(worst.chars);
  });

  it("el numero es el mismo que devuelve worstBlockOf", () => {
    const lines = [
      { topic: "frontend", statement: "Global." },
      { topic: "frontend", statement: `A ${largo}`, scope: "uno" },
    ];
    expect(heaviest(lines).chars).toBe(worstBlockOf(lines));
  });
});
