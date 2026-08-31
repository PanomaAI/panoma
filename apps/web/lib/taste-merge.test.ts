import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TasteFullError,
  readTaste,
  writeTaste,
  type TasteLine,
  type TasteTopic,
} from "@panoma/core";
import {
  dropStatements,
  reconcileTaste,
  type TasteMerge,
  type TasteStatement,
} from "./taste-merge";

/**
 * Who is in charge when the database says one thing and the file says another.
 *
 * It is Twin's most dangerous seam, because the possible answers are destructive in opposite
 * directions: adding too much restores a line that the person had just deleted, removing too much
 * sends to the cemetery a belief that nobody touched, and keeping too much leaves the agents
 * reading something that the catalog has already declared dead.
 *
 * What makes them distinguishable is a single thing: **what was written** of each belief is kept
 * (`published`). Without that, there are only two answerable questions —"was it never there?" and
 * "was it there and is no longer?"— and the third, which is the one most used, was answered
 * incorrectly: a belief that the synthesis refines changes both its text and its citations at the
 * same time, so it stopped matching its own line through both paths and was read as hand-erased.
 * Each pass of synthesis vetoed what it had just improved.
 */

const V1 = "a".repeat(40);
const V2 = "b".repeat(40);

function line(statement: string, citations: string[] = [], topic: TasteTopic = "other"): TasteLine {
  return { topic, statement, citations };
}

/** A belief that has never been in the file. */
function nueva(
  id: string,
  statement: string,
  citations: string[] = [],
  topic: TasteTopic = "other",
): TasteStatement {
  return { id, topic, statement, citations };
}

/** And one that does, with what was written about it last time. */
function escrita(
  id: string,
  statement: string,
  citations: string[] = [],
  topic: TasteTopic = "other",
): TasteStatement {
  return { id, topic, statement, citations, published: { topic, statement } };
}

/** The sentences that are going to be written, in the order in which they are going to be written. */
function said(lines: TasteLine[]): string[] {
  return lines.map((one) => one.statement);
}

describe("una creencia que nunca ha estado en el fichero", () => {
  it("entra", () => {
    const merge = reconcileTaste([line("ya escrita", [V1])], [nueva("a", "recién nacida")]);
    expect(said(merge.lines)).toEqual(["ya escrita", "recién nacida"]);
    expect(merge.withdrawn).toEqual([]);
  });

  /*
    And this is the half that prevents the other error: a newly born belief cannot be vetoed on
    its own for not being in a file in which it has never been.
   */
  it("y no se retira por no estar", () => {
    expect(reconcileTaste([line("otra cosa")], [nueva("a", "recién nacida")]).withdrawn).toEqual([]);
  });

  /* An empty file is not a cleared file: `readTaste` returns empty in the event of any failure. */
  it("con el fichero vacío se escriben todas y no se retira ninguna", () => {
    const merge = reconcileTaste([], [escrita("a", "una"), escrita("b", "otra")]);
    expect(said(merge.lines)).toEqual(["una", "otra"]);
    expect(merge.withdrawn).toEqual([]);
  });
});

describe("una creencia que estaba escrita y ya no está", () => {
  it("se retira, que arriba significa un veto", () => {
    const merge = reconcileTaste(
      [line("la que queda", [V1])],
      [escrita("a", "la que queda", [V1]), escrita("b", "la que se borró", [V2])],
    );
    expect(merge.withdrawn).toEqual(["b"]);
    expect(said(merge.lines)).toEqual(["la que queda"]);
  });

  it("y no se vuelve a añadir en la misma pasada", () => {
    const merge = reconcileTaste([line("queda")], [escrita("a", "borrada")]);
    expect(said(merge.lines)).toEqual(["queda"]);
  });
});

describe("una creencia cuya línea está vieja porque la máquina la cambió", () => {
  /*
    The missing case, and the one most often encountered: refining is the normal work of
    synthesis. The text changes and the quotes change, so it does not match by either of the two
    ways that existed — and it was read as if been erased by hand.
   */
  it("se reescribe con lo que dice hoy, y no se retira", () => {
    const file = [line("usa espaciado de 8 px", [V1])];
    const row: TasteStatement = {
      id: "b",
      topic: "other",
      statement: "usa una escala de 8 px",
      citations: [V1, V2],
      published: { topic: "other", statement: "usa espaciado de 8 px" },
    };

    const merge = reconcileTaste(file, [row]);
    expect(merge.withdrawn, "no la borró nadie").toEqual([]);
    expect(merge.rewritten, "ni la reescribió la persona").toEqual([]);
    expect(said(merge.lines)).toEqual(["usa una escala de 8 px"]);
    expect(merge.lines[0]?.citations).toEqual([V1, V2]);
  });

  it("y se muda de materia si la reclasificaron", () => {
    const file = [line("una frase", [V1], "other")];
    const row: TasteStatement = {
      id: "b",
      topic: "backend",
      statement: "una frase",
      citations: [V1],
      published: { topic: "other", statement: "una frase" },
    };
    expect(reconcileTaste(file, [row]).lines[0]?.topic).toBe("backend");
  });

  /*
    Acotar had the same problem on the other side: the row matched its own line by the text, it
    was accepted as correct, and the `only in dricopilot:` was never written — nor was it ever
    removed when untagging.
   */
  it("acotarla escribe el «solo en» en el fichero", () => {
    const file = [line("no uses degradados", [V1], "design")];
    const row: TasteStatement = {
      id: "b",
      topic: "design",
      statement: "no uses degradados",
      citations: [V1],
      scope: "dricopilot",
      published: { topic: "design", statement: "no uses degradados" },
    };
    expect(reconcileTaste(file, [row]).lines[0]?.scope).toBe("dricopilot");
  });

  it("y desacotarla lo quita", () => {
    const file: TasteLine[] = [
      { topic: "design", statement: "no uses degradados", citations: [V1], scope: "dricopilot" },
    ];
    const row: TasteStatement = {
      id: "b",
      topic: "design",
      statement: "no uses degradados",
      citations: [V1],
      published: { topic: "design", statement: "no uses degradados", scope: "dricopilot" },
    };
    expect(reconcileTaste(file, [row]).lines[0]?.scope).toBeUndefined();
  });
});

describe("una creencia cuya línea la reescribió la persona", () => {
  /*
    The most valuable thing this file can cause, and by text it is indistinguishable from a
    deletion: the published line is no longer there. What separates them is the quotation mark,
    which travels with the line because it is written on it.
   */
  it("manda el fichero, y la creencia queda firmada con esas palabras", () => {
    const merge = reconcileTaste(
      [line("dicho a mi manera", [V1])],
      [escrita("a", "dicho como lo dijo el modelo", [V1])],
    );

    expect(merge.withdrawn).toEqual([]);
    expect(merge.rewritten).toEqual([{ id: "a", statement: "dicho a mi manera" }]);
    expect(said(merge.lines)).toEqual(["dicho a mi manera"]);
  });

  it("reescribir una no retira las demás", () => {
    const file = [line("dicho a mi manera", [V1]), line("esta la dejo como estaba", [V2])];
    const rows = [
      escrita("a", "dicho como lo dijo el modelo", [V1]),
      escrita("b", "esta la dejo como estaba", [V2]),
    ];
    expect(reconcileTaste(file, rows).withdrawn).toEqual([]);
  });

  /*
    Moving a line of material is cutting and pasting it, and the mark travels with it: that is why
    this second step is blind to the material. What is preserved is the sentence; the heading is
    updated with that of its source, because filing is not rewriting.
   */
  it("moverla de materia a mano tampoco la retira", () => {
    const merge = reconcileTaste(
      [line("ni un color de más", [V1], "cli")],
      [escrita("a", "no quieres colores de más", [V1], "design")],
    );
    expect(merge.withdrawn).toEqual([]);
    expect(merge.lines[0]?.statement).toBe("ni un color de más");
    expect(merge.lines[0]?.topic).toBe("design");
  });

  it("sin marca no hay con qué distinguirla: se retira la fila, no el texto", () => {
    const merge = reconcileTaste(
      [line("dicho a mi manera")],
      [escrita("a", "dicho como lo dijo el modelo")],
    );
    expect(merge.withdrawn).toEqual(["a"]);
    expect(said(merge.lines)).toEqual(["dicho a mi manera"]);
  });

  it("dos líneas con la misma marca no dicen cuál es cuál, y en la duda se retira", () => {
    const merge = reconcileTaste(
      [line("una cosa", [V1]), line("otra cosa", [V1])],
      [escrita("a", "lo que decía la fila", [V1])],
    );
    expect(merge.withdrawn).toEqual(["a"]);
    expect(said(merge.lines)).toEqual(["una cosa", "otra cosa"]);
  });
});

describe("cuánto perdona la comparación", () => {
  /*
    Only what the file itself no longer distinguishes is normalized. Too strict and an extra space
    is read as a deletion; too lax and two different rules fall under the same key.
   */
  it("el espacio y las mayúsculas no distinguen", () => {
    const merge = reconcileTaste(
      [line("Nada  de   degradados", [V1])],
      [
        {
          id: "a",
          topic: "other",
          statement: "nada de degradados",
          citations: [V1],
          published: { topic: "other", statement: "nada de degradados" },
        },
      ],
    );
    expect(merge.withdrawn, "es su propia línea").toEqual([]);
  });

  it("pero la puntuación sí distingue, y no se perdona", () => {
    expect(
      reconcileTaste([line("usa comillas «»")], [escrita("a", "usa comillas")]).withdrawn,
    ).toEqual(["a"]);
  });

  it("la misma frase en dos materias son dos reglas, y cada una espera la suya", () => {
    expect(
      reconcileTaste([line("una frase", [], "cli")], [escrita("a", "una frase", [], "copy")])
        .withdrawn,
    ).toEqual(["a"]);
  });
});

describe("las líneas de lo que ya no se publica", () => {
  /*
    Removing didn’t take anything out of the file: the line was a gap that no one claimed, the
    rule of 'what no one claimed stays' preserved it, and the agents kept reading a belief that
    the catalog had already declared dead — without any gesture capable of removing it, because
    the screen only lists what is alive.
   */
  it("se quitan por lo que se escribió de ellas, no por lo que digan hoy", () => {
    const file = [line("la vieja", [V1]), line("la que se queda", [V2])];
    expect(said(dropStatements(file, [{ topic: "other", statement: "la vieja" }]))).toEqual([
      "la que se queda",
    ]);
  });

  it("y una que ya no está en el fichero no rompe nada", () => {
    expect(dropStatements([line("una")], [{ topic: "other", statement: "otra" }])).toHaveLength(1);
  });

  it("el alcance entra en la comparación", () => {
    const file: TasteLine[] = [
      { topic: "design", statement: "una", citations: [], scope: "dricopilot" },
    ];
    expect(
      dropStatements(file, [{ topic: "design", statement: "una" }]),
      "sin alcance no es la misma línea",
    ).toHaveLength(1);
    expect(
      dropStatements(file, [{ topic: "design", statement: "una", scope: "dricopilot" }]),
    ).toHaveLength(0);
  });
});

/**
 * The file and the database, together and checked against the real disk.
 *
 * The above tests reconciliation with literals. What is missing is the cycle: write, read again,
 * and for the second pass not to read a deletion where there was none. That is where the flaw
 * lived that killed a belief with every pass of synthesis.
 */
describe("el ciclo completo, contra el disco", () => {
  const HOME = mkdtempSync(join(tmpdir(), "panoma-merge-"));
  const previo = process.env["PANOMA_HOME"];

  beforeAll(() => {
    process.env["PANOMA_HOME"] = HOME;
  });

  afterAll(() => {
    if (previo === undefined) delete process.env["PANOMA_HOME"];
    else process.env["PANOMA_HOME"] = previo;
    rmSync(HOME, { recursive: true, force: true });
  });

  /** What the path points to after writing: what really remained on the disk. */
  function publicado(lines: TasteLine[], statement: string) {
    const one = lines.find((line) => line.statement === statement);
    if (one === undefined) throw new Error(`no se escribió: ${statement}`);
    return { topic: one.topic, statement: one.statement, ...(one.scope ? { scope: one.scope } : {}) };
  }

  it("escribir, leer y volver a guardar sin tocar nada no cambia nada", async () => {
    const uno = reconcileTaste([], [nueva("a", "Quieres la portada con aire.", [V1], "design")]);
    const escrito = await writeTaste(uno.lines);

    const fila: TasteStatement = {
      id: "a",
      topic: "design",
      statement: "Quieres la portada con aire.",
      citations: [V1],
      published: publicado(escrito.lines, "Quieres la portada con aire."),
    };

    const dos = reconcileTaste((await readTaste()).lines, [fila]);
    expect(dos.withdrawn).toEqual([]);
    expect(dos.rewritten).toEqual([]);
    expect(said(dos.lines)).toEqual(["Quieres la portada con aire."]);
  });

  /*
    The ruling that killed a belief for being outdated: fine-tuning changes text and quotes at the
    same time.
   */
  it("afinarla entre dos guardados la reescribe, no la veta", async () => {
    const afinada: TasteStatement = {
      id: "a",
      topic: "design",
      statement: "Quieres la portada con mucho aire y una sola idea.",
      citations: [V1, V2],
      published: { topic: "design", statement: "Quieres la portada con aire." },
    };

    const merge = reconcileTaste((await readTaste()).lines, [afinada]);
    expect(merge.withdrawn).toEqual([]);
    const escrito = await writeTaste(merge.lines);
    expect(said(escrito.lines)).toEqual(["Quieres la portada con mucho aire y una sola idea."]);
  });

  it("y borrar su línea a mano sí la retira", () => {
    const fila: TasteStatement = {
      id: "a",
      topic: "design",
      statement: "Quieres la portada con mucho aire y una sola idea.",
      citations: [V1, V2],
      published: {
        topic: "design",
        statement: "Quieres la portada con mucho aire y una sola idea.",
      },
    };
    // The empty file does not remove —that case is above—, so here remains another line inside.
    expect(reconcileTaste([], [fila]).withdrawn, "el vacío no retira").toEqual([]);
    expect(reconcileTaste([line("otra cosa de la persona")], [fila]).withdrawn).toEqual(["a"]);
  });

  /*
    A portrait that does not fit **writes nothing**, and that is the half that makes the limit
    livable: the request falls entirely and the previous file stays as it was.
   */
  it("uno que no cabe lanza y deja el fichero como estaba", async () => {
    const habia = said((await readTaste()).lines);
    const largo = Array.from({ length: 40 }, (_unused, i) =>
      line(`Una cosa numero ${i} `.padEnd(120, "x"), [], "design"),
    );
    await expect(writeTaste(largo)).rejects.toBeInstanceOf(TasteFullError);
    expect(said((await readTaste()).lines)).toEqual(habia);
  });
});

/**
 * Which line each belief stays on.
 *
 * It is born from a hole with two exits, both permanent. The route recorded “what was written” for
 * each row by looking for its line **through the text of the row**, and a belief that the person
 * rewrites by hand ends up in the file with its text and in the database with the previous one: it
 * found nothing and noted down “it was never written.” The next day, deleting that line stopped
 * blocking it — it was added again as if it had never been there — and blocking it from the screen
 * did not remove it from the file, so the agents continued reading a belief considered dead.
 *
 * Reconciliation says so, which is the only one that knows which line each row stayed with.
 */
describe("qué línea reclama cada creencia", () => {
  const dice = (merge: TasteMerge, id: string) =>
    merge.claims.find((one) => one.id === id)?.line.statement;

  it("la que empareja por lo que se escribió reclama esa línea, ya reescrita", () => {
    const file: TasteLine[] = [
      { topic: "design", statement: "Quieres la portada con aire.", citations: ["v1"] },
    ];
    const merge = reconcileTaste(file, [
      {
        id: "b1",
        topic: "design",
        statement: "Quieres la portada con mucho aire.",
        citations: ["v1"],
        published: { topic: "design", statement: "Quieres la portada con aire." },
      },
    ]);
    expect(dice(merge, "b1")).toBe("Quieres la portada con mucho aire.");
  });

  /*
    The case that brought it: the person rewrote it, so send the file and you have to note
    **their** text — not the one from the row, which is the previous one.
   */
  it("la reescrita a mano reclama la línea con las palabras de la persona", () => {
    const file: TasteLine[] = [
      { topic: "design", statement: "Quieres MUCHÍSIMO aire en la portada.", citations: ["v1"] },
    ];
    const merge = reconcileTaste(file, [
      {
        id: "b1",
        topic: "design",
        statement: "Quieres la portada con aire.",
        citations: ["v1"],
        published: { topic: "design", statement: "Quieres la portada con aire." },
      },
    ]);
    expect(merge.rewritten.map((one) => one.id)).toEqual(["b1"]);
    expect(dice(merge, "b1")).toBe("Quieres MUCHÍSIMO aire en la portada.");
  });

  it("la que se añade reclama la línea nueva", () => {
    const merge = reconcileTaste(
      [{ topic: "copy", statement: "Otra cosa.", citations: ["v9"] }],
      [{ id: "b2", topic: "design", statement: "Recién nacida.", citations: ["v2"] }],
    );
    expect(dice(merge, "b2")).toBe("Recién nacida.");
  });

  it("con el fichero vacío también, que es el camino corto", () => {
    const merge = reconcileTaste(
      [],
      [{ id: "b3", topic: "design", statement: "La primera de todas.", citations: [] }],
    );
    expect(dice(merge, "b3")).toBe("La primera de todas.");
  });

  /*
    The one that the person deleted does not claim any: it is removed, and marking a line for it
    would be like writing 'remains in the file' to something that is no longer there.
   */
  it("la borrada a mano no reclama nada", () => {
    const merge = reconcileTaste(
      [{ topic: "copy", statement: "Otra cosa.", citations: ["v9"] }],
      [
        {
          id: "b4",
          topic: "design",
          statement: "La que se fue.",
          citations: [],
          published: { topic: "design", statement: "La que se fue." },
        },
      ],
    );
    expect(merge.withdrawn).toEqual(["b4"]);
    expect(merge.claims.some((one) => one.id === "b4")).toBe(false);
  });
});
