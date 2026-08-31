import { describe, expect, it } from "vitest";
import { asBelief, citationDay, type BeliefRowish } from "./taste-view";

/**
 * What is tested here is distrust, which is the only thing this module contributes.
 *
 * `citations` and `support` are `jsonb` columns: they arrive as `unknown` and their form is a
 * convention, not a contract. A row written by an earlier version—or by hand with `psql` on a
 * debugging afternoon—can contain anything, and the screen that reads it is the only one in the
 * product where someone controls what all its agents are going to read. Having it not load because
 * of a strange row is worse than showing it without a citation.
 *
 * And there is an asymmetry that is worth looking at twice: when in doubt, **less evidence**. An
 * unreadable `support` column is read as zeros, that is, 'in formation,' meaning that the belief
 * does not leave the screen. Conversely —filling in with three observations when in doubt— one
 * would publish it in the `AGENTS.md` of one hundred and twelve projects due to a miswritten row.
 */

function row(extra: Partial<BeliefRowish> = {}): BeliefRowish {
  return {
    id: "b1",
    topic: "design",
    statement: "Quieres la portada con una sola idea.",
    state: "inferred",
    citations: [],
    support: { observations: 4, projects: 2, days: 3 },
    updatedAt: new Date("2026-08-20T10:00:00.000Z"),
    ...extra,
  };
}

const CITA = {
  verdictId: "v1",
  quote: "no me gusta ese verde",
  at: "2026-08-20T23:11:00.000Z",
  project: "panoma",
};

describe("de fila del catálogo a creencia con sus pruebas", () => {
  it("una cita completa pasa entera", () => {
    expect(asBelief(row({ citations: [CITA] })).citations).toEqual([CITA]);
  });

  it("el proyecto es opcional y no se inventa", () => {
    const { project, ...sinProyecto } = CITA;
    expect(project).toBe("panoma");
    const [cita] = asBelief(row({ citations: [sinProyecto] })).citations;
    expect(cita).not.toHaveProperty("project");
  });

  it("una cita sin frase o sin fecha no es una prueba y se cae", () => {
    const rotas = [
      { verdictId: "v2", at: CITA.at },
      { verdictId: "v3", quote: "algo" },
      "ni siquiera es un objeto",
      null,
    ];
    expect(asBelief(row({ citations: rotas })).citations).toEqual([]);
  });

  it("una columna que no es una lista se lee como ninguna cita", () => {
    expect(asBelief(row({ citations: { verdictId: "v1" } })).citations).toEqual([]);
    expect(asBelief(row({ citations: null })).citations).toEqual([]);
  });

  it("sin identificador se deriva uno estable de la frase y la fecha", () => {
    const { verdictId, ...sinId } = CITA;
    expect(verdictId).toBe("v1");
    const [cita] = asBelief(row({ citations: [sinId] })).citations;
    expect(cita!.verdictId).toBe(`${CITA.quote}${CITA.at}`);
  });
});

describe("cuánta evidencia dice que la sostiene", () => {
  it("las tres cuentas pasan enteras", () => {
    expect(asBelief(row()).support).toEqual({ observations: 4, projects: 2, days: 3 });
  });

  /* When in doubt, less evidence: see header. */
  it("una columna ilegible se lee como cero y no como tres", () => {
    for (const roto of [null, "cuatro", [], { observations: "muchas" }]) {
      expect(asBelief(row({ support: roto })).support).toEqual({
        observations: 0,
        projects: 0,
        days: 0,
      });
    }
  });

  it("un número negativo tampoco pasa", () => {
    expect(asBelief(row({ support: { observations: -5, projects: 1, days: 1 } })).support).toEqual({
      observations: 0,
      projects: 1,
      days: 1,
    });
  });
});

describe("la insignia", () => {
  /*
    It is decided on the server and travels as data, because the floor rule lives in `@panoma/db`
    —which drags drizzle and PGlite— and solving it in the client component would break the
    packaging. Here it is only checked that the data dictates.
   */
  it("lo firmado es firmado, mire lo que mire el suelo", () => {
    expect(asBelief(row({ state: "signed" }), { stands: false }).badge).toBe("signed");
  });

  it("lo inferido con evidencia está en pie", () => {
    expect(asBelief(row(), { stands: true }).badge).toBe("standing");
  });

  it("lo inferido sin evidencia está en formación, y sin decir nada también", () => {
    expect(asBelief(row(), { stands: false }).badge).toBe("forming");
    expect(asBelief(row()).badge).toBe("forming");
  });
});

describe("dónde vale y dónde podría valer", () => {
  const names = { "git:uno": "dricopilot", "git:dos": "linkaloud" };
  const identities = { dricopilot: "git:uno", linkaloud: "git:dos" };

  it("se resuelve el nombre desde la identidad", () => {
    expect(asBelief(row({ identity: "git:uno" }), { names }).scope).toBe("dricopilot");
  });

  it("una identidad que ya no está en el catálogo no se rellena con el hash", () => {
    expect(asBelief(row({ identity: "git:fantasma" }), { names }).scope).toBeUndefined();
  });

  /*
    The scope is a datum and not a column with memory: the synthesis limits at birth and, if the
    person returns it to everything they do, the row loses identity. Without the candidate,
    expanding the scope would be a gesture of no return.
   */
  it("con toda la evidencia de un proyecto, se sabe a cuál se podría acotar", () => {
    const belief = asBelief(row({ citations: [CITA, { ...CITA, verdictId: "v2" }] }), {
      names,
      identities: { panoma: "git:tres" },
    });
    expect(belief.learnedIn).toEqual({ identity: "git:tres", name: "panoma" });
  });

  it("con evidencia de dos proyectos no se ofrece acotar a ninguno", () => {
    const belief = asBelief(
      row({ citations: [CITA, { ...CITA, verdictId: "v2", project: "linkaloud" }] }),
      { names, identities },
    );
    expect(belief.learnedIn).toBeUndefined();
  });

  it("con un nombre que ya no está en el catálogo, tampoco", () => {
    const belief = asBelief(row({ citations: [CITA] }), { names, identities });
    expect(belief.learnedIn, "panoma no está en el mapa de este caso").toBeUndefined();
  });

  /* One that is already delimited does not offer to be delimited: what it offers is the way back. */
  it("una ya acotada no trae candidato", () => {
    const belief = asBelief(row({ identity: "git:uno", citations: [CITA] }), {
      names,
      identities: { panoma: "git:tres" },
    });
    expect(belief.scope).toBe("dricopilot");
    expect(belief.learnedIn).toBeUndefined();
  });
});

describe("el día de la cita", () => {
  it("no se va al día siguiente por el huso", () => {
    const local = new Date("2026-08-20T23:11:00.000Z");
    const esperado = String(local.getDate()).padStart(2, "0");
    expect(citationDay("2026-08-20T23:11:00.000Z", "es").slice(0, 2)).toBe(esperado);
  });

  it("una fecha ilegible no se convierte en un día inventado", () => {
    expect(citationDay("cuando sea", "es")).toBe("cuando sea");
  });

  it("cada idioma escribe la fecha como se lee en él", () => {
    const es = citationDay("2026-08-20T12:00:00.000Z", "es");
    const en = citationDay("2026-08-20T12:00:00.000Z", "en");
    expect(es).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(en).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
