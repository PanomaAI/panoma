import { describe, expect, it } from "vitest";
import { SUPPORT_FLOOR, standsUp } from "@panoma/db";
import type { BeliefSupport, ObservationRow, TasteCitation } from "@panoma/db";
import {
  CITATIONS_SHOWN,
  citationsFor,
  planChanges,
  scopeOf,
  supportOf,
  type CurrentBelief,
  type Draft,
} from "./beliefs";

/**
 * The arithmetic that decides what reaches the agents, tested apart from everything else.
 *
 * Three things intersect here and all three can be mistaken in silence: how much evidence there is
 * —on which trust depends, the only brake left now that no one signs anything—, where a belief is
 * worth, and what is rewritten in each pass.
 *
 * The last one is the one that seems to matter least and is most noticeable: if `planChanges`
 * marks a belief that didn't change as tuned, the summary on the screen —"2 tuned"— stops meaning
 * anything and the churn, which is the metric that indicates whether this converges, measures the
 * noise of rewriting for the sake of rewriting.
 */

function citation(extra: Partial<TasteCitation> = {}): TasteCitation {
  return { verdictId: "v1", quote: "no me gusta ese verde", at: "2026-08-20T10:00:00.000Z", ...extra };
}

function observation(extra: Partial<ObservationRow> = {}): ObservationRow {
  return {
    id: "o1",
    identity: "git:uno",
    topic: "design",
    classified: true,
    statement: "Quieres la portada con aire.",
    citations: [citation()],
    model: "prueba/modelo",
    at: new Date("2026-08-20T10:00:00.000Z"),
    createdAt: new Date("2026-08-21T10:00:00.000Z"),
    ...extra,
  };
}

const SOSTENIDA: BeliefSupport = { observations: 4, projects: 2, days: 3 };

describe("cuánta evidencia sostiene una creencia", () => {
  it("cuenta observaciones, proyectos y días distintos", () => {
    const support = supportOf([
      observation({ id: "o1", identity: "git:uno" }),
      observation({ id: "o2", identity: "git:dos" }),
      observation({
        id: "o3",
        identity: "git:uno",
        citations: [citation({ at: "2026-03-01T10:00:00.000Z" })],
      }),
    ]);
    expect(support).toEqual({ observations: 3, projects: 2, days: 2 });
  });

  /*
    The days come from the **dates** and not from the observation date. Two observations distilled
    the same afternoon share `at` even if one cites March and the other August: counting by
    observation would say that this happened on a single day, which is exactly what the soil looks
    at.
   */
  it("los días son los de las citas, no el de la destilación", () => {
    const misma = new Date("2026-08-21T10:00:00.000Z");
    const support = supportOf([
      observation({ id: "o1", at: misma, citations: [citation({ at: "2026-03-01T00:00:00Z" })] }),
      observation({ id: "o2", at: misma, citations: [citation({ at: "2026-08-01T00:00:00Z" })] }),
    ]);
    expect(support.days).toBe(2);
  });

  it("una observación del portafolio entero no suma proyecto", () => {
    expect(supportOf([observation({ identity: null })]).projects).toBe(0);
  });

  it("sin observaciones, todo a cero", () => {
    expect(supportOf([])).toEqual({ observations: 0, projects: 0, days: 0 });
  });

  /*
    The ground lives in `@panoma/db` so that the terminal and the web publish the same portrait,
    and it is checked here because it is the rule that replaces the signature as a brake.
   */
  it("el suelo pide tres observaciones y dos sitios", () => {
    expect(standsUp({ observations: 3, projects: 1, days: 2 })).toBe(true);
    expect(standsUp({ observations: 3, projects: 2, days: 1 })).toBe(true);
    expect(standsUp({ observations: 3, projects: 1, days: 1 })).toBe(false);
    expect(standsUp({ observations: 2, projects: 2, days: 2 })).toBe(false);
    expect(SUPPORT_FLOOR.observations).toBe(3);
  });
});

describe("las citas que se enseñan debajo", () => {
  it("van las más recientes primero", () => {
    const shown = citationsFor([
      observation({ id: "o1", citations: [citation({ quote: "vieja", at: "2026-01-01T00:00:00Z" })] }),
      observation({ id: "o2", citations: [citation({ quote: "nueva", at: "2026-08-01T00:00:00Z" })] }),
    ]);
    expect(shown.map((one) => one.quote)).toEqual(["nueva", "vieja"]);
  });

  it("cada cita sabe de qué observación vino", () => {
    const [cita] = citationsFor([observation({ id: "o7" })]);
    expect(cita!.observationId).toBe("o7");
  });

  /*
    Two quotes with the same text are a single test, even if they have different IDs. Measured in
    the author's corpus: Claude Code rewrites the same turn of yours within the same file when the
    conversation is compacted, so the catalog keeps different verdicts with the identical
    sentence. Here, they would also be seen as two identical lines in the drawer.
   */
  it("la misma frase dos veces es una sola prueba", () => {
    const shown = citationsFor([
      observation({ id: "o1", citations: [citation({ verdictId: "v1", quote: "así no" })] }),
      observation({ id: "o2", citations: [citation({ verdictId: "v2", quote: "así no" })] }),
    ]);
    expect(shown).toHaveLength(1);
  });

  it("se recortan, porque una creencia con cuarenta observaciones tiene cientos", () => {
    const muchas = Array.from({ length: 40 }, (_unused, i) =>
      observation({ id: `o${i}`, citations: [citation({ verdictId: `v${i}`, quote: `cita ${i}` })] }),
    );
    expect(citationsFor(muchas)).toHaveLength(CITATIONS_SHOWN);
  });
});

describe("dónde vale una creencia", () => {
  /*
    To limit is a fact and not an opinion: as soon as an observation comes from elsewhere, the
    belief has already manifested outside, and saying that it only counts there would contradict
    its quotes.
   */
  it("con toda la evidencia de un proyecto, se acota a él", () => {
    expect(scopeOf([observation({ identity: "git:uno" }), observation({ identity: "git:uno" })])).toBe(
      "git:uno",
    );
  });

  it("con evidencia de dos proyectos, vale en todo", () => {
    expect(scopeOf([observation({ identity: "git:uno" }), observation({ identity: "git:dos" })])).toBeNull();
  });

  /* An observation of the entire portfolio is already worthwhile outside of any project. */
  it("una sola del portafolio entero desacota a las demás", () => {
    expect(scopeOf([observation({ identity: "git:uno" }), observation({ identity: null })])).toBeNull();
  });

  it("sin evidencia no hay a qué acotar", () => {
    expect(scopeOf([])).toBeNull();
  });
});

describe("qué cambia en una pasada de síntesis", () => {
  const CITAS = ["v1", "v2", "v3"];
  const inferida: CurrentBelief = {
    id: "b1",
    statement: "Quieres la portada con aire.",
    signed: false,
    support: SOSTENIDA,
    citations: CITAS,
  };
  const firmada: CurrentBelief = {
    id: "f1",
    statement: "No soportas los degradados.",
    signed: true,
    support: SOSTENIDA,
    citations: CITAS,
  };

  function draft(extra: Partial<Draft> = {}): Draft {
    return {
      statement: "Una creencia nueva.",
      observations: ["o1"],
      support: SOSTENIDA,
      citations: CITAS,
      ...extra,
    };
  }

  it("lo que no estaba nace inferido", () => {
    expect(planChanges([draft()], [])).toEqual([
      { kind: "new", statement: "Una creencia nueva.", observations: ["o1"] },
    ]);
  });

  it("una inferida con otro texto y evidencia nueva se afina", () => {
    const cambios = planChanges(
      [
        draft({
          belief: { id: "b1", signed: false },
          statement: "Quieres la portada con mucho aire.",
          support: { observations: 9, projects: 2, days: 5 },
        }),
      ],
      [inferida],
    );
    expect(cambios).toEqual([
      {
        kind: "refine",
        id: "b1",
        statement: "Quieres la portada con mucho aire.",
        observations: ["o1"],
      },
    ]);
  });

  /*
    The rule of stability, and it is about the evidence and not about the text. It said "the same
    bytes AND the same evidence," which allowed any reformulation; with the same evidence behind
    it, there is no way to know if the new sentence is better said or just said in a different
    way, and the one that is already written the person has already seen.
    It is the last net and not the brake: what prevents a subject from rewriting itself each time
    is not calling the model when no new evidence has entered. See the route.
   */
  it("otro texto con la misma evidencia no es un cambio", () => {
    const otroTexto = draft({
      belief: { id: "b1", signed: false },
      statement: "Quieres una portada aireada.",
    });
    expect(planChanges([otroTexto], [inferida])).toEqual([]);
  });

  it("los mismos bytes y la misma evidencia tampoco", () => {
    const igual = draft({ belief: { id: "b1", signed: false }, statement: inferida.statement });
    expect(planChanges([igual], [inferida])).toEqual([]);
  });

  /*
    Except when the subject is requested by name, which is asking for it to be redone. Without
    this, `--topic backend` called the model, paid for the call, and discarded the response for
    citing the same evidence: a subject written with old rules could not be redone.
   */
  it("pero rehaciendo la materia a propósito sí se reescribe", () => {
    const otroTexto = draft({
      belief: { id: "b1", signed: false },
      statement: "Quieres una portada aireada.",
    });
    const cambios = planChanges([otroTexto], [inferida], new Set(), new Set(), { redo: true });
    expect(cambios[0]?.kind).toBe("refine");
  });

  it("el mismo texto con evidencia nueva sí se reescribe", () => {
    const masEvidencia = draft({
      belief: { id: "b1", signed: false },
      statement: inferida.statement,
      support: { observations: 9, projects: 2, days: 5 },
    });
    expect(planChanges([masEvidencia], [inferida])[0]?.kind).toBe("refine");
  });

  /*
    Soil measurements are easily repeated — three observations from two projects over four days is
    quite normal — so with the same measurements and different verdicts behind them, there is
    indeed new evidence.
   */
  it("las mismas cuentas sobre otras citas también son evidencia nueva", () => {
    const otrasCitas = draft({
      belief: { id: "b1", signed: false },
      statement: "Quieres la portada con mucho aire.",
      citations: ["v9", "v8", "v7"],
    });
    expect(planChanges([otrasCitas], [inferida])[0]?.kind).toBe("refine");
  });

  it("las mismas citas en otro orden no son evidencia nueva", () => {
    const barajadas = draft({
      belief: { id: "b1", signed: false },
      statement: "Quieres una portada aireada.",
      citations: ["v3", "v1", "v2"],
    });
    expect(planChanges([barajadas], [inferida])).toEqual([]);
  });

  /*
    The signed boundary. The machine can suggest how the person might say it, and that comes out as a
    question and not as a change: it is the only tail that remains in all of Twin.
   */
  it("tocar algo firmado sale como propuesta, no como cambio", () => {
    const cambios = planChanges(
      [draft({ replaces: ["f1"], statement: "Odias los degradados." })],
      [firmada],
    );
    expect(cambios).toEqual([
      {
        kind: "propose",
        supersedes: ["f1"],
        statement: "Odias los degradados.",
        observations: ["o1"],
      },
    ]);
  });

  /* Both doors say the same thing: naming it in `belief` is the short form of a single one. */
  it("nombrarla en «belief» también propone", () => {
    const cambios = planChanges(
      [draft({ belief: { id: "f1", signed: true }, statement: "Odias los degradados." })],
      [firmada],
    );
    expect(cambios[0]).toMatchObject({ kind: "propose", supersedes: ["f1"] });
  });

  /*
    And this is what makes a portrait full of signatures shrink. The synthesis brings together
    what is repeated among what it can rewrite, and what is signed cannot be rewritten: without
    being able to propose replacing several, fifteen signed design beliefs remain fifteen forever
    and the limit ends up refusing to write anything. Measured when migrating the author's
    catalog: 3,189 characters against a limit of 3,000.
   */
  it("una propuesta puede juntar varias firmadas en una", () => {
    const otra: CurrentBelief = {
      id: "f2",
      statement: "No te gustan los degradados.",
      signed: true,
      support: SOSTENIDA,
      citations: CITAS,
    };
    const cambios = planChanges(
      [draft({ replaces: ["f1", "f2"], statement: "Odias los degradados." })],
      [firmada, otra],
    );
    expect(cambios).toEqual([
      {
        kind: "propose",
        supersedes: ["f1", "f2"],
        statement: "Odias los degradados.",
        observations: ["o1"],
      },
    ]);
  });

  /*
    Combining two with the text of one of them is indeed a question: what the proposal then
    contributes is not the text, it is that the other one disappears.
   */
  it("juntar varias se propone aunque el texto sea el de una de ellas", () => {
    const otra: CurrentBelief = {
      id: "f2",
      statement: "No te gustan los degradados.",
      signed: true,
      support: SOSTENIDA,
      citations: CITAS,
    };
    const cambios = planChanges(
      [draft({ replaces: ["f1", "f2"], statement: firmada.statement })],
      [firmada, otra],
    );
    expect(cambios[0]).toMatchObject({ kind: "propose", supersedes: ["f1", "f2"] });
  });

  /*
    And if there is already an open question about it, another one is not made. Without this, the
    queue grows on its own: each pass proposes the same thing again about the same belief.
    Measured in the author's catalog, two passes left two different proposals about the same
    signed sentence.
   */
  it("no vuelve a preguntar por algo que ya está preguntado", () => {
    const cambios = planChanges(
      [draft({ replaces: ["f1"], statement: "Otra manera de decirlo." })],
      [firmada],
      new Set(["f1"]),
    );
    expect(cambios).toEqual([]);
  });

  it("y una pregunta abierta sobre otra no estorba", () => {
    const cambios = planChanges(
      [draft({ replaces: ["f1"], statement: "Otra manera de decirlo." })],
      [firmada],
      new Set(["f-otra"]),
    );
    expect(cambios[0]).toMatchObject({ kind: "propose" });
  });

  /* A signature that between two passes ceased to be so is not proposed: that has already been decided. */
  it("no propone sustituir algo que ya no está firmado", () => {
    const inferidaAhora: CurrentBelief = { ...firmada, signed: false };
    const cambios = planChanges(
      [draft({ replaces: ["f1"], statement: "Odias los degradados." })],
      [inferidaAhora],
    );
    expect(cambios.some((one) => one.kind === "propose")).toBe(false);
  });

  it("y devolver una firmada tal cual no propone nada", () => {
    const igual = draft({ replaces: ["f1"], statement: firmada.statement });
    expect(planChanges([igual], [firmada])).toEqual([]);
  });

  it("una firmada nunca se retira, aunque el modelo no la devuelva", () => {
    expect(planChanges([], [firmada])).toEqual([]);
  });

  /*
    Removing is not erasing. What the model does not return is what the evidence stopped
    supporting, and letting it disappear in silence would be the compression that `taste.ts`
    prohibits, moved one floor up.
   */
  it("una inferida que no vuelve se retira", () => {
    expect(planChanges([], [inferida])).toEqual([{ kind: "retire", id: "b1" }]);
  });

  it("una inferida que vuelve no se retira", () => {
    const igual = draft({ belief: { id: "b1", signed: false }, statement: inferida.statement });
    expect(planChanges([igual], [inferida])).toEqual([]);
  });

  /* An id that no longer exists cannot rewrite anything: it enters as a new belief. */
  it("una etiqueta que apunta a nada nace como nueva", () => {
    const cambios = planChanges([draft({ belief: { id: "fantasma", signed: false } })], [inferida]);
    expect(cambios[0]?.kind).toBe("new");
    expect(cambios[1], "y la que no volvió se retira igual").toEqual({ kind: "retire", id: "b1" });
  });
});
