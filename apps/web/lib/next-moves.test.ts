import { describe, expect, it } from "vitest";
import { ASSIGNMENT_KINDS, applies } from "./assignments";
import { capFor, nextMoves, MAX_MOVES, type DirectorFacts } from "./next-moves";

/**
 * The order is the product, so here it is not tested 'that it returns something': each decision it
 * makes is recorded, one by one and with the facts laid out by hand.
 *
 * It is a pure function over literals —no database, no network, no model—, so there is no excuse
 * to test it on top. What these tests protect is what would be costly to lose: that a request not
 * proposed is one the project doesn't support, that each movement brings the fact that chose it,
 * that the same request doesn't come up three times with three excuses, and that a project without
 * direction receives that question before any other.
 */

/** A project in which there is nothing to propose. Each test only spoils its own. */
function facts(changes: Partial<DirectorFacts> = {}): DirectorFacts {
  return {
    state: "active",
    monthsIdle: 0,
    hasReadme: true,
    health: 82,
    outdated: 0,
    notices: 0,
    risks: [],
    openTasks: 0,
    north: "Terminado = que mi hermano lo instale sin llamarme por teléfono.",
    critiques: 0,
    built: true,
    ...changes,
  };
}

/** The pairs (order, done) exactly as they would be read on screen. */
function moves(changes: Partial<DirectorFacts> = {}): [string, string][] {
  return nextMoves(facts(changes)).map((move) => [move.kind, move.reason.code]);
}

describe("un proyecto sin nada que arreglar", () => {
  it("no recibe ningún movimiento, y eso es una respuesta", () => {
    // Making one up to avoid leaving the blank space is the beginning of the horoscope.
    expect(nextMoves(facts())).toEqual([]);
  });
});

describe("sin norte, lo primero es la pregunta", () => {
  it("un proyecto por lo demás perfecto recibe justo ese movimiento", () => {
    expect(moves({ north: null })).toEqual([["plan", "no-north"]]);
  });

  it("va el primero aunque haya cosas más ruidosas debajo", () => {
    const orden = moves({ north: null, hasReadme: false, state: "dormant", monthsIdle: 14 });
    expect(orden[0]).toEqual(["plan", "no-north"]);
  });

  it("se dice una vez: ningún otro movimiento lo repite", () => {
    const razones = moves({ north: null, notices: 3, outdated: 12, health: 20 }).map(
      ([, code]) => code,
    );
    expect(razones.filter((code) => code === "no-north")).toHaveLength(1);
  });

  it("una línea en blanco no cuenta como contestada", () => {
    // It arrives at the database as text and would respond 'it's already written,' leaving the
    // project without the only question it was missing.
    expect(moves({ north: "   " })).toEqual([["plan", "no-north"]]);
  });

  it("con el norte escrito, la pregunta no vuelve nunca", () => {
    const razones = moves({ notices: 2 }).map(([, code]) => code);
    expect(razones).not.toContain("no-north");
  });
});

describe("cada señal, a solas", () => {
  it("trabajo sin guardar en un proyecto parado abre «retomar», y cuenta los avisos", () => {
    const [move] = nextMoves(
      facts({ state: "paused", monthsIdle: 3, risks: [{ code: "no-remote", count: 40 }] }),
    );
    expect(move?.kind).toBe("resume");
    expect(move?.reason).toEqual({ code: "unsaved-work", count: 1 });
  });

  it("sin README abre «presentable», y es el único hecho que lo abre", () => {
    expect(moves({ hasReadme: false })).toEqual([["presentable", "no-readme"]]);
  });

  it("nunca comprobado abre «retomar» en un proyecto parado", () => {
    expect(moves({ state: "paused", monthsIdle: 2, built: false })).toEqual([
      ["resume", "never-built"],
    ]);
  });

  it("los meses parados abren «retomar» y viajan con su número", () => {
    const [move] = nextMoves(facts({ state: "dormant", monthsIdle: 14 }));
    expect(move?.reason).toEqual({ code: "idle", count: 14 });
  });

  it("los avisos de seguridad abren «plan» y dicen cuántos", () => {
    expect(nextMoves(facts({ notices: 3 }))[0]?.reason).toEqual({ code: "advisories", count: 3 });
  });

  it("las dependencias atrasadas abren «plan»", () => {
    expect(moves({ outdated: 9 })).toEqual([["plan", "outdated"]]);
  });

  it("la salud baja abre «plan», y por debajo de 55 es una D", () => {
    expect(moves({ health: 54 })).toEqual([["plan", "low-health"]]);
    expect(moves({ health: 55 }), "justo en la C no hay nada que decir").toEqual([]);
  });

  it("doce meses parado abren la pregunta de si esto sigue teniendo sentido", () => {
    const orden = moves({ state: "dormant", monthsIdle: 12, built: true });
    expect(orden).toContainEqual(["competitors", "long-idle"]);
  });

  it("once meses todavía no la abren", () => {
    const orden = moves({ state: "dormant", monthsIdle: 11, built: true });
    expect(orden.map(([kind]) => kind)).not.toContain("competitors");
  });
});

describe("no se ofrece lo que el encargo no admite", () => {
  it("un proyecto activo no recibe «retomar» por mucho que haya en juego", () => {
    // The message says 'what do I need to return tomorrow.' In a project that was touched
    // yesterday, that is not a weak suggestion: it is proof that no one looked at the status.
    const orden = moves({
      state: "active",
      built: false,
      risks: [{ code: "unpushed", count: 4 }],
      monthsIdle: 0,
    });
    expect(orden.map(([kind]) => kind)).not.toContain("resume");
  });

  it("con README no aparece «presentable» ni cuando no hay nada más que proponer", () => {
    expect(moves({ hasReadme: true, health: 10 }).map(([kind]) => kind)).not.toContain(
      "presentable",
    );
  });

  it("una carpeta sin git no recibe «retomar», aunque sea el mayor riesgo del catálogo", () => {
    /*
      `applies` does not support 'resuming' without history, and here `applies` is in charge. It
      is not a resignation: a folder without a repository is fixed with three git commands that
      the unsaved work page already offers with its copy button. Giving it to an agent as a task
      would be theater.
     */
    const orden = moves({
      state: "no-git",
      monthsIdle: 0,
      risks: [{ code: "unversioned" }],
      north: null,
    });
    expect(orden.map(([kind]) => kind)).not.toContain("resume");
    expect(orden[0], "y la pregunta que sí aplica sigue en su sitio").toEqual([
      "plan",
      "no-north",
    ]);
  });

  it("ningún movimiento propuesto contradice a `applies`, con cualquier combinación", () => {
    // The safety net of rule 1, swept over the states and the two forms of README: if someone adds
    // a new rule and forgets the filter, this turns red.
    const estados = ["active", "paused", "dormant", "no-git"] as const;
    for (const state of estados) {
      for (const hasReadme of [true, false]) {
        const entrada = facts({
          state,
          hasReadme,
          north: null,
          monthsIdle: 18,
          built: false,
          health: 12,
          outdated: 30,
          notices: 4,
          risks: [{ code: "uncommitted", count: 7 }],
        });
        for (const move of nextMoves(entrada)) {
          expect(applies(move.kind, entrada), `${move.kind} en un proyecto ${state}`).toBe(true);
        }
      }
    }
  });
});

describe("un encargo se ofrece una vez", () => {
  it("cuatro hechos que apuntan a «plan» dejan un solo «plan», y gana el mejor colocado", () => {
    // Three lines that launch the same prompt are not three moves: it is one repeated with three
    // excuses.
    const orden = moves({ north: null, notices: 5, outdated: 20, health: 11 });
    expect(orden.filter(([kind]) => kind === "plan")).toEqual([["plan", "no-north"]]);
  });

  it("sin la razón mejor colocada, el encargo lo hereda la siguiente", () => {
    expect(moves({ notices: 5, outdated: 20, health: 11 })).toEqual([["plan", "advisories"]]);
    expect(moves({ outdated: 20, health: 11 })).toEqual([["plan", "outdated"]]);
    expect(moves({ health: 11 })).toEqual([["plan", "low-health"]]);
  });

  it("«nunca comprobado» gana a los meses parados, que ya se ven en cualquier pantalla", () => {
    expect(moves({ state: "dormant", monthsIdle: 20, built: false })).toContainEqual([
      "resume",
      "never-built",
    ]);
    expect(moves({ state: "dormant", monthsIdle: 20, built: true })).toContainEqual([
      "resume",
      "idle",
    ]);
  });

  it("y lo que se puede perder gana a las dos", () => {
    const orden = moves({
      state: "dormant",
      monthsIdle: 20,
      built: false,
      risks: [{ code: "no-remote", count: 40 }],
    });
    expect(orden).toContainEqual(["resume", "unsaved-work"]);
  });
});

describe("el tope de tres", () => {
  it("un proyecto que lo tiene todo mal se queda en tres, y sobra «competidores»", () => {
    const orden = moves({
      north: null,
      hasReadme: false,
      state: "dormant",
      monthsIdle: 24,
      built: false,
      risks: [{ code: "unpushed", count: 3 }],
      notices: 6,
      outdated: 40,
      health: 9,
    });
    expect(orden).toHaveLength(MAX_MOVES);
    expect(orden).toEqual([
      ["plan", "no-north"],
      ["resume", "unsaved-work"],
      ["presentable", "no-readme"],
    ]);
    // The twenty-four months are still true; what is not acceptable is to postpone three things to
    // do inside in order to go look at the competition.
    expect(orden.map(([kind]) => kind)).not.toContain("competitors");
  });

  it("la cola ya empezada recorta la lista, uno por recado", () => {
    const roto = {
      north: null,
      hasReadme: false,
      state: "dormant" as const,
      monthsIdle: 24,
      built: false,
    };
    expect(moves({ ...roto, openTasks: 0 })).toHaveLength(3);
    expect(moves({ ...roto, openTasks: 1 })).toHaveLength(2);
    expect(moves({ ...roto, openTasks: 2 })).toHaveLength(1);
  });

  it("nunca baja de uno, por muchos encargos que esperen", () => {
    // A project that disappears from the list is not read as 'here you already have work,' it is
    // read as 'there is nothing to do here.'
    expect(capFor(9)).toBe(1);
    expect(moves({ north: null, hasReadme: false, openTasks: 9 })).toEqual([
      ["plan", "no-north"],
    ]);
  });

  it("una cola imposible no invierte la cuenta", () => {
    expect(capFor(-3)).toBe(MAX_MOVES);
  });

  it("lo que se recorta es la cola de la lista, no el principio", () => {
    const orden = moves({ north: null, hasReadme: false, openTasks: 1 });
    expect(orden).toEqual([
      ["plan", "no-north"],
      ["presentable", "no-readme"],
    ]);
  });
});

describe("los mismos hechos dan siempre la misma lista", () => {
  it("no hay azar ni reloj: diez llamadas seguidas coinciden", () => {
    const entrada = facts({
      north: null,
      state: "dormant",
      monthsIdle: 13,
      hasReadme: false,
      notices: 2,
    });
    const primera = JSON.stringify(nextMoves(entrada));
    for (let i = 0; i < 10; i += 1) {
      expect(JSON.stringify(nextMoves(entrada))).toBe(primera);
    }
  });

  it("y ordenar los hechos de otra manera no cambia nada", () => {
    // The object is written with the keys in a different order: if something depended on it, it
    // would be a bug that would only appear when refactoring the caller.
    const a = nextMoves({
      built: false,
      north: null,
      risks: [],
      openTasks: 0,
      critiques: 0,
      notices: 0,
      outdated: 0,
      health: 40,
      hasReadme: false,
      monthsIdle: 13,
      state: "dormant",
    });
    const b = nextMoves(
      facts({
        north: null,
        state: "dormant",
        monthsIdle: 13,
        hasReadme: false,
        health: 40,
        built: false,
      }),
    );
    expect(a).toEqual(b);
  });

  it("todos los encargos que propone son encargos que existen", () => {
    // The day that `assignments.ts` renames one, this says it before the interface.
    const orden = nextMoves(
      facts({ north: null, hasReadme: false, state: "dormant", monthsIdle: 30 }),
    );
    for (const move of orden) {
      expect(ASSIGNMENT_KINDS).toContain(move.kind);
    }
  });
});

/*
  And the cheapest move on the list: what the mechanical critic already saw. There’s no need to
  find out anything—the list is written and each line is a verifiable fact—and that’s why it goes
  ahead of the overdue obligations and behind the safety notices.
 */
describe("lo que ya se ve sin abrir el proyecto", () => {
  it("se propone cuando el crítico vio algo", () => {
    const moves = nextMoves(facts({ critiques: 7 }));
    expect(moves).toContainEqual({ kind: "review", reason: { code: "critiques", count: 7 } });
  });

  it("y no se propone con la carpeta limpia", () => {
    expect(nextMoves(facts({ critiques: 0 })).map((m) => m.kind)).not.toContain("review");
  });

  /* An open vulnerability reigns over a loose color. The order is the product. */
  it("va detrás del aviso de seguridad", () => {
    const moves = nextMoves(facts({ critiques: 7, notices: 2 }));
    const codes = moves.map((move) => move.reason.code);
    expect(codes.indexOf("advisories")).toBeLessThan(codes.indexOf("critiques"));
  });
});
