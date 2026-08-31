import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, inArray, or, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import * as t from "./schema";
import {
  SCORE_FLOOR,
  SUPPORT_FLOOR,
  insertBeliefs,
  listBeliefs,
  saveObservations,
  signBelief,
  standsUp,
  briefScore,
  tasteScore,
  vetoBelief,
  type BeliefSupport,
} from "./queries";
// Launching lives with tasks, which is where its row comes from.
import { discardTask, discardedCritiques, discardedFindings, launchedTasks, listProjectTasks, recordLaunch } from "./agents";

/**
 * The only number that Twin responds to, against PGlite and not against a double.
 *
 * The question of the document has not changed —'how many times do you correct me?'— but what is
 * counted has. Before it was the yeses to what was decided; with the tail closed nobody signs
 * anything by default, so what is counted are the **corrections**: the vetoes and the rewrites.
 * And `better` becomes **less**, not more.
 *
 * Here two things that do not exist in TypeScript are checked. The first is what counts as a
 * correction, which is decided with a `filter (where …)` within PostgreSQL by looking at the
 * status and whether the `model` is empty — which distinguishes a rewritten belief from one fixed
 * as is. The second is the division into two thirty-day windows that touch each other at a
 * juncture of `>` and `<=`. If that juncture were written with two loose `>`, the previous window
 * would contain the current one, and the “month-to-month” would compare thirty days against sixty
 * that already include them: they would always resemble each other, it would never fail
 * completely, and there would be no way to see it on screen. That is engine interval arithmetic,
 * not of this code.
 *
 * Months are made by pushing the dates back by hand, which is the only way to test a 'month to
 * month' without waiting two months.
 */

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-score-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});

afterAll(async () => {
  await close?.();
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

/** The house signs with a model what a model writes. See `decisions.aiSummaryModel`. */
const MODELO = "claude-opus-4-1-20250805";

const DIA = 86_400_000;

/** Plenty of evidence: three observations over two days. See `SUPPORT_FLOOR`. */
const SOSTENIDA: BeliefSupport = { observations: 4, projects: 1, days: 3 };

/** A belief with the support that one wants to give it, in order to be able to reason about density. */
function belief(support: BeliefSupport, statement = "Una creencia.") {
  return {
    topic: "design",
    statement,
    state: "inferred" as const,
    citations: [],
    support,
    model: MODELO,
  };
}

/** A batch of inferred beliefs, like those written by a pass of synthesis. */
async function synthesize(count: number, tag: string): Promise<string[]> {
  return insertBeliefs(
    db,
    Array.from({ length: count }, (_, i) => ({
      topic: "design",
      statement: `${tag} ${i}`,
      state: "inferred" as const,
      citations: [],
      support: SOSTENIDA,
      model: MODELO,
    })),
  );
}

/**
 * Push back the birth date: this is how 'last month's cohort' is made.
 *
 * Only `created_at`, which is why the fifths are distributed. The dates of the gestures are left
 * where they are on purpose: part of what must be able to be stated is that correcting something
 * today from two months ago counts in the fifth where it was born.
 *
 * With `ids` move only those, which is what is needed to have two different fifths in the same
 * table.
 */
async function backdate(days: number, ids?: string[]): Promise<void> {
  const at = new Date(Date.now() - days * DIA);
  await db
    .update(t.beliefs)
    .set({ createdAt: at })
    .where(ids === undefined ? sql`true` : inArray(t.beliefs.id, ids));
}

beforeEach(async () => {
  await db.delete(t.beliefs);
  await db.delete(t.observations);
});

describe("el suelo de confianza", () => {
  /*
    It is the brake that replaces the signature with a phrase: a belief with a single observation
    behind it directs no one. And the 'two sites' thing is what does the work — three observations
    from the same afternoon and the same repository are someone wrestling with a file, not a
    belief.
   */
  it("tres observaciones de dos días la sostienen", () => {
    expect(standsUp({ observations: 3, projects: 1, days: 2 })).toBe(true);
  });

  it("tres observaciones de dos proyectos también", () => {
    expect(standsUp({ observations: 3, projects: 2, days: 1 })).toBe(true);
  });

  it("tres del mismo día y del mismo proyecto, no", () => {
    expect(standsUp({ observations: 3, projects: 1, days: 1 })).toBe(false);
  });

  it("dos de dos sitios tampoco: hacen falta las tres", () => {
    expect(standsUp({ observations: 2, projects: 2, days: 2 })).toBe(false);
  });

  it("el suelo viaja como dato, para que ninguna pantalla lo copie", () => {
    expect(SUPPORT_FLOOR.observations).toBe(3);
    expect(SUPPORT_FLOOR.sources).toBe(2);
  });

  /* Signing is the permission: what the person made their own does not go through any ground. */
  it("una firmada cuenta como en pie aunque no llegue al suelo", async () => {
    await insertBeliefs(db, [
      {
        topic: "design",
        statement: "Poca evidencia, pero la firmé.",
        state: "signed",
        citations: [],
        support: { observations: 1, projects: 1, days: 1 },
        model: MODELO,
      },
    ]);

    const score = await tasteScore(db);
    expect(score.standing).toBe(1);
    expect(score.forming).toBe(0);
  });

  it("una inferida sin evidencia se queda en formación y no baja al fichero", async () => {
    await insertBeliefs(db, [
      {
        topic: "design",
        statement: "Todavía no se sabe.",
        state: "inferred",
        citations: [],
        support: { observations: 1, projects: 1, days: 1 },
        model: MODELO,
      },
    ]);

    const score = await tasteScore(db);
    expect(score.standing).toBe(0);
    expect(score.forming).toBe(1);
    expect(score.beliefs, "pero sigue estando viva y visible").toBe(1);
  });
});

describe("los montones", () => {
  it("vivas, firmadas, enterradas y retiradas se cuentan por separado", async () => {
    const ids = await synthesize(4, "una");
    await signBelief(db, ids[0]!);
    await vetoBelief(db, ids[1]!);
    await db
      .update(t.beliefs)
      .set({ state: "retired", retiredAt: new Date() })
      .where(eq(t.beliefs.id, ids[2]!));

    const score = await tasteScore(db);
    expect(score.beliefs, "viva la firmada y la que nadie tocó").toBe(2);
    expect(score.signed).toBe(1);
    expect(score.vetoed).toBe(1);
    expect(score.retired).toBe(1);
  });

  /*
    A proposal has not been taught to anyone as a belief: it has been taught as a question.
    Putting it in the denominator I would say that the double affirmed something that was only
    asked.
   */
  it("una propuesta no cuenta como algo que el doble te haya dicho", async () => {
    await synthesize(2, "dicha");
    await insertBeliefs(db, [
      {
        topic: "design",
        statement: "¿Sustituyo la que firmaste?",
        state: "proposed",
        citations: [],
        support: SOSTENIDA,
        model: MODELO,
      },
    ]);

    const score = await tasteScore(db);
    expect(score.proposed).toBe(1);
    expect(score.shown, "solo las dos que afirmó").toBe(2);
  });

  it("sin nada guardado no hay porcentaje ni división por cero", async () => {
    const score = await tasteScore(db);
    expect(score.shown).toBe(0);
    expect(score.corrections).toBe(0);
    expect(score.rate).toBeNull();
    expect(score.density, "ni densidad de un retrato que no existe").toBeNull();
    expect(score.reading).toBe("tooFew");
  });
});

describe("qué cuenta como corregir", () => {
  /*
    The two ways of saying 'this was not mine': bury it and rewrite it. Fixing one as it is
    —meaning that it was fine—, and telling it as a correction would inflate the only number to
    which this product responds with gestures of approval.
   */
  it("vetar cuenta, reescribir cuenta, y fijar tal cual no", async () => {
    const ids = await synthesize(3, "gesto");
    await vetoBelief(db, ids[0]!);
    await signBelief(db, ids[1]!, "Lo digo yo de otra manera.");
    await signBelief(db, ids[2]!);

    const score = await tasteScore(db);
    expect(score.corrections).toBe(2);
    expect(score.signed, "las dos firmas cuentan como firmas").toBe(2);
  });

  it("y lo que nadie toca no cuenta como corrección", async () => {
    await synthesize(5, "quieta");
    expect((await tasteScore(db)).corrections).toBe(0);
  });
});

describe("el porcentaje y su suelo", () => {
  it("con una creencia menos del suelo no se enseña ningún número", async () => {
    const ids = await synthesize(SCORE_FLOOR - 1, "corta");
    await vetoBelief(db, ids[0]!);

    const score = await tasteScore(db);
    expect(score.shown).toBe(SCORE_FLOOR - 1);
    expect(score.corrections, "los montones sí se enseñan").toBe(1);
    expect(score.rate).toBeNull();
    expect(score.reading).toBe("tooFew");
  });

  it("justo en el suelo sale, redondeado a entero", async () => {
    const ids = await synthesize(SCORE_FLOOR, "justa");
    for (const id of ids.slice(0, 5)) await vetoBelief(db, id);

    expect((await tasteScore(db)).rate, "5 de 20").toBe(25);
  });

  it("el redondeo es de verdad y no un recorte", async () => {
    const ids = await synthesize(30, "redonda");
    for (const id of ids.slice(0, 5)) await vetoBelief(db, id);
    // 5/30 = 16.66…, which rounds to 17 and would be cut down to 16.
    expect((await tasteScore(db)).rate).toBe(17);
  });

  it("el suelo viaja con los números, para que la pantalla no lo copie", async () => {
    expect((await tasteScore(db)).floor).toBe(SCORE_FLOOR);
  });
});

describe("la densidad", () => {
  /*
    The number that tells if this works, and the one that was missing since the saying 'a person
    does not have two hundred tastes: they have twenty, each repeated two thousand times' was
    written. If it stays at one, the synthesis is copying observations instead of synthesizing
    them.
   */
  it("es la media de en cuántas observaciones se apoya una creencia", async () => {
    await insertBeliefs(db, [
      belief({ observations: 6, projects: 2, days: 3 }),
      belief({ observations: 3, projects: 1, days: 2 }),
    ]);
    expect((await tasteScore(db)).density, "seis y tres, de media cuatro y medio").toBe(4.5);
  });

  it("con un decimal, porque copiar y sintetizar se distinguen ahí", async () => {
    await insertBeliefs(db, [
      belief({ observations: 1, projects: 1, days: 1 }),
      belief({ observations: 2, projects: 1, days: 2 }),
      belief({ observations: 1, projects: 1, days: 1 }),
    ]);
    expect((await tasteScore(db)).density).toBe(1.3);
  });

  /*
    And **it is not** observations among beliefs, which inflates by itself: it is enough to
    distill more for the numerator to grow without any belief being supported by an additional
    proof. With the entire corpus read, there are observations that no belief ever ends up citing,
    because the synthesis only sees the most recent ones of each subject.
   */
  it("leer más historial no la sube sola", async () => {
    await insertBeliefs(db, [belief({ observations: 3, projects: 1, days: 2 })]);
    const antes = (await tasteScore(db)).density;

    await saveObservations(
      db,
      Array.from({ length: 40 }, (_unused, i) => ({
        identity: null,
        topic: "design",
        statement: `una cita mas ${i}`,
        citations: [],
        model: MODELO,
      })),
    );

    const despues = await tasteScore(db);
    expect(despues.observations, "el corpus sí crece").toBe(40);
    expect(despues.density, "y la densidad no se mueve").toBe(antes);
  });
});

describe("mes a mes", () => {
  /*
    The 'quintas' are staggered by a month: the one in the middle and the one before, never the
    one that is running. A newly born 'quinta' has not yet been fully evaluated —its corrections
    are still to come— and comparing it against an established one would always suggest that it
    has improved, which is the automatic congratulation that this marker exists not to give.
    And they are distributed by **when the belief was born**, not by when it was corrected: this
    way the numerator is always within the denominator. Before, the two criteria were crossed and
    the percentage of a month could exceed 100% — a month without new beliefs in which the person
    cleared ten old things would come out as "1,000% corrected".
   */
  it("una quinta recién nacida no se compara con nada", async () => {
    const ids = await synthesize(SCORE_FLOOR + 5, "de hoy");
    for (const id of ids.slice(0, 5)) await vetoBelief(db, id);

    const score = await tasteScore(db);
    expect(score.rate, "en el total sí cuenta").not.toBeNull();
    expect(score.recent.shown, "pero no es una quinta juzgada").toBe(0);
    expect(score.reading).toBe("noTrend");
  });

  it("dos quintas asentadas y corrigiendo menos es lo único que dice que aprende", async () => {
    const viejas = await synthesize(SCORE_FLOOR, "vieja");
    for (const id of viejas.slice(0, 10)) await vetoBelief(db, id);
    await backdate(75);

    const medianas = await synthesize(SCORE_FLOOR, "mediana");
    for (const id of medianas.slice(0, 4)) await vetoBelief(db, id);
    await backdate(45, medianas);

    const score = await tasteScore(db);
    expect(score.previous.rate, "la mitad").toBe(50);
    expect(score.recent.rate, "una de cada cinco").toBe(20);
    expect(score.reading).toBe("better");
  });

  it("quedarse igual no es mejorar", async () => {
    const viejas = await synthesize(SCORE_FLOOR, "vieja");
    for (const id of viejas.slice(0, 5)) await vetoBelief(db, id);
    await backdate(75);

    const medianas = await synthesize(SCORE_FLOOR, "mediana");
    for (const id of medianas.slice(0, 5)) await vetoBelief(db, id);
    await backdate(45, medianas);

    expect((await tasteScore(db)).reading).toBe("notBetter");
  });

  it("y corregir más, tampoco", async () => {
    const viejas = await synthesize(SCORE_FLOOR, "vieja");
    for (const id of viejas.slice(0, 4)) await vetoBelief(db, id);
    await backdate(75);

    const medianas = await synthesize(SCORE_FLOOR, "mediana");
    for (const id of medianas.slice(0, 10)) await vetoBelief(db, id);
    await backdate(45, medianas);

    expect((await tasteScore(db)).reading).toBe("notBetter");
  });

  it("una quinta floja no se compara: seis creencias no son un mes", async () => {
    const viejas = await synthesize(6, "vieja");
    await vetoBelief(db, viejas[0]!);
    await backdate(75);

    const medianas = await synthesize(SCORE_FLOOR + 10, "mediana");
    for (const id of medianas.slice(0, 3)) await vetoBelief(db, id);
    await backdate(45, medianas);

    const score = await tasteScore(db);
    expect(score.recent.rate).not.toBeNull();
    expect(score.previous.rate, "seis no dan porcentaje").toBeNull();
    expect(score.reading).toBe("noTrend");
  });

  /*
    A correction made now about a belief from two months ago counts in **its** fifth, which is
    where it was born. Crossing the two criteria was what allowed passing from 100%.
   */
  it("corregir hoy algo de hace dos meses cuenta en la quinta de aquel mes", async () => {
    const viejas = await synthesize(SCORE_FLOOR, "vieja");
    await backdate(45);

    for (const id of viejas.slice(0, 4)) await vetoBelief(db, id);

    const score = await tasteScore(db);
    expect(score.recent.shown).toBe(SCORE_FLOOR);
    expect(score.recent.corrections, "las cuatro, aunque se hayan vetado hoy").toBe(4);
    expect(score.recent.rate).toBe(20);
  });

  it("un porcentaje de quinta nunca pasa del cien por cien", async () => {
    const viejas = await synthesize(SCORE_FLOOR, "vieja");
    await backdate(45);
    for (const id of viejas) await vetoBelief(db, id);

    expect((await tasteScore(db)).recent.rate).toBe(100);
  });

  it("lo de hace cuatro meses está en el total y en ninguna quinta", async () => {
    const ids = await synthesize(SCORE_FLOOR, "antigua");
    for (const id of ids.slice(0, 5)) await vetoBelief(db, id);
    await backdate(130);

    const score = await tasteScore(db);
    expect(score.corrections, "en el total sí").toBe(5);
    expect(score.recent.shown).toBe(0);
    expect(score.previous.shown).toBe(0);
  });
});

describe("las dos tablas no se pisan", () => {
  it("las creencias enterradas siguen en la base, contadas y fuera del retrato", async () => {
    const ids = await synthesize(3, "enterrada");
    for (const id of ids) await vetoBelief(db, id);

    expect(await listBeliefs(db)).toHaveLength(3);
    expect(await listBeliefs(db, { states: ["inferred", "signed"] })).toHaveLength(0);
    const score = await tasteScore(db);
    expect(score.beliefs).toBe(0);
    expect(score.vetoed).toBe(3);
  });

  it("borrar la evidencia no borra lo que sostiene", async () => {
    await saveObservations(db, [
      { identity: null, topic: "design", statement: "una prueba", citations: [], model: MODELO },
    ]);
    await synthesize(1, "apoyada");

    await db.delete(t.observations).where(or(sql`true`));

    const score = await tasteScore(db);
    expect(score.observations).toBe(0);
    expect(score.beliefs, "la creencia sigue en pie con sus citas copiadas").toBe(1);
    expect(score.standing, "y con su evidencia guardada, que no bajó sola").toBe(1);
  });

  it("y una lista vacía de ids no entierra nada", async () => {
    await synthesize(2, "quieta");
    expect(await db.select().from(t.beliefs).where(inArray(t.beliefs.id, []))).toHaveLength(0);
  });
});

/*
  The other half of the review: from what the critic points out, how much you end up ordering.
  What these tests establish is not the arithmetic —it's `rateOf`, which has already been proven
  above— but the three decisions that make it honest: that the denominator be the findings and not
  the assignments, that distinct pairs are counted and not rows, and that a manually requested
  assignment does not sneak into a number that claims to measure the critic.
 */
describe("los hallazgos que acabaron en encargo", () => {
  beforeEach(async () => {
    await db.delete(t.launches);
    await db.delete(t.tasks);
    await db.delete(t.looks);
    await db.delete(t.projects);
  });

  /** A look with the findings that are requested. Only the number matters. */
  async function mirada(id: string, hallazgos: number) {
    await db.insert(t.looks).values({
      id,
      identity: "git:uno",
      digest: id,
      bytes: 1000,
      fired: "hand",
      provider: "anthropic",
      model: MODELO,
      statements: 12,
      dropped: 0,
      unreadable: false,
      findings: Array.from({ length: hallazgos }, (_, i) => ({
        what: `mal ${i}`,
        where: "ahí",
        fix: "arréglalo",
        cites: ["una frase"],
      })),
    });
  }

  /** A real project: `tasks` has a foreign key and does not allow a made-up id. */
  async function proyecto(): Promise<string> {
    const id = "proj-nota";
    await db.insert(t.projects).values({ id, name: "demo", slug: "demo-nota", root: "/tmp/demo-nota" });
    return id;
  }

  async function encargo(
    projectId: string,
    patch: {
      id: string;
      fromLook?: string;
      fromFinding?: number;
      fromCritique?: string;
      status?: string;
      claimedAt?: Date;
      /*
        Explicit when the test goes in the order: leaving it to the clock is testing the clock's
        resolution, not the rule.
       */
      createdAt?: Date;
    },
  ) {
    await db.insert(t.tasks).values({
      id: patch.id,
      projectId,
      title: "arréglalo",
      status: patch.status ?? "open",
      fromLook: patch.fromLook ?? null,
      fromFinding: patch.fromFinding ?? null,
      fromCritique: patch.fromCritique ?? null,
      claimedAt: patch.claimedAt ?? null,
      ...(patch.createdAt ? { createdAt: patch.createdAt } : {}),
    });
  }

  /** Yesterday and today, to write "one row after another" without relying on the clock. */
  const AYER = new Date("2026-08-20T10:00:00Z");
  const HOY = new Date("2026-08-24T10:00:00Z");

  it("sin miradas no hay nada que contar", async () => {
    const score = await briefScore(db);
    expect(score.findings).toBe(0);
    expect(score.ordered).toBe(0);
    expect(score.rate).toBeNull();
  });

  it("el denominador son los hallazgos, sumados de todas las miradas", async () => {
    await mirada("m1", 3);
    await mirada("m2", 2);
    expect((await briefScore(db)).findings).toBe(5);
  });

  /*
    Rows and pairs are not the same: a finding whose assignment has been closed can be reassigned,
    and counting rows the rate would go over 100 %.
   */
  it("un hallazgo encargado dos veces cuenta una, y las filas se dicen aparte", async () => {
    await mirada("m1", 4);
    const p = await proyecto();
    await encargo(p, { id: "t1", fromLook: "m1", fromFinding: 0, status: "done" });
    await encargo(p, { id: "t2", fromLook: "m1", fromFinding: 0 });

    const score = await briefScore(db);
    expect(score.ordered).toBe(1);
    expect(score.tasks).toBe(2);
  });

  /* A hand-requested commission did not come from a discovery, so it does not measure the critic. */
  it("los encargos que no salen de una mirada no cuentan", async () => {
    await mirada("m1", 2);
    const p = await proyecto();
    await encargo(p, { id: "t1" });

    expect((await briefScore(db)).ordered).toBe(0);
  });

  it("cogidos y cerrados se cuentan por separado", async () => {
    await mirada("m1", 3);
    const p = await proyecto();
    await encargo(p, { id: "t1", fromLook: "m1", fromFinding: 0, claimedAt: new Date(), status: "in-progress" });
    await encargo(p, { id: "t2", fromLook: "m1", fromFinding: 1, status: "done" });

    const score = await briefScore(db);
    expect(score.claimed, "cerrar no exige haber cogido: `completeTask` cierra sin agente").toBe(1);
    expect(score.done).toBe(1);
  });

  /* The same ground as the rest of the marker, and for the same arithmetic reason. */
  it("por debajo del suelo hay montones y no hay porcentaje", async () => {
    await mirada("m1", SCORE_FLOOR - 1);
    const p = await proyecto();
    await encargo(p, { id: "t1", fromLook: "m1", fromFinding: 0 });

    const score = await briefScore(db);
    expect(score.ordered).toBe(1);
    expect(score.rate).toBeNull();
  });

  it("y con hallazgos de sobra, el porcentaje sale", async () => {
    await mirada("m1", 20);
    const p = await proyecto();
    for (let i = 0; i < 5; i += 1) {
      await encargo(p, { id: `t${i}`, fromLook: "m1", fromFinding: i });
    }

    expect((await briefScore(db)).rate).toBe(25);
  });

  /*
    What came out to an agent, which is the last question in the chain and the one that had no
    place to be looked at: until this increment launch, it did not leave a queue.
   */
  it("un encargo lanzado cuatro veces es un encargo y cuatro gestos", async () => {
    await mirada("m1", 4);
    const p = await proyecto();
    await encargo(p, { id: "t1", fromLook: "m1", fromFinding: 0 });
    for (let i = 0; i < 4; i += 1) {
      await recordLaunch(db, { projectId: p, taskId: "t1", agent: "Claude Code" });
    }

    const score = await briefScore(db);
    expect(score.launched, "encargos distintos").toBe(1);
    expect(score.launches, "gestos: relanzar es corregir, y se ve aquí").toBe(4);
  });

  /* The four hastily written pieces leave no assignment, so they do not measure up to the critic. */
  it("un lanzamiento sin encargo detrás no cuenta", async () => {
    await mirada("m1", 2);
    const p = await proyecto();
    await recordLaunch(db, { projectId: p, kind: "resume", agent: "Claude Code" });

    const score = await briefScore(db);
    expect(score.launched).toBe(0);
    expect(score.launches).toBe(0);
  });

  it("y los de un encargo que no salió de una mirada, tampoco", async () => {
    await mirada("m1", 2);
    const p = await proyecto();
    await encargo(p, { id: "t1" });
    await recordLaunch(db, { projectId: p, taskId: "t1", agent: "Claude Code" });

    expect((await briefScore(db)).launched).toBe(0);
  });

  /*
    And what you said no, that until this increase it could not be written: the state existed in
    the schema and no one put it down.
   */
  it("un hallazgo descartado no cuenta como encargado", async () => {
    await mirada("m1", 4);
    const p = await proyecto();
    await encargo(p, { id: "t1", fromLook: "m1", fromFinding: 0, status: "discarded" });

    const score = await briefScore(db);
    expect(score.ordered, "decir que no no es encargar").toBe(0);
    expect(score.discarded).toBe(1);
  });

  it("y si después lo encargas, deja de ser un descarte", async () => {
    await mirada("m1", 4);
    const p = await proyecto();
    await encargo(p, { id: "t1", fromLook: "m1", fromFinding: 0, status: "discarded" });
    await encargo(p, { id: "t2", fromLook: "m1", fromFinding: 0 });

    const score = await briefScore(db);
    expect(score.ordered).toBe(1);
    expect(score.discarded, "cambiar de idea deshace la respuesta anterior").toBe(0);
  });

  it("descartar solo mueve lo vivo, y la pantalla sabe cuáles son", async () => {
    await mirada("m1", 4);
    const p = await proyecto();
    await encargo(p, { id: "t1", fromLook: "m1", fromFinding: 0 });
    await encargo(p, { id: "t2", fromLook: "m1", fromFinding: 1, status: "done" });

    expect(await discardTask(db, "t1")).toBe(true);
    expect(await discardTask(db, "t1"), "descartar dos veces no pasa dos veces").toBe(false);
    expect(await discardTask(db, "t2"), "lo hecho no se tacha: es el único sitio donde consta").toBe(
      false,
    );

    const dichos = await discardedFindings(db);
    expect(dichos.has("m1 0")).toBe(true);
    expect(dichos.has("m1 1")).toBe(false);
  });

  /*
    The mirror by project for the mechanical critic: without it, the 'discarded' only lived in the
    client's state and was forgotten when the record was reloaded.
   */
  it("un descarte de crítica se recuerda, y encargarlo después lo deshace", async () => {
    const p = await proyecto();
    await db.insert(t.tasks).values({
      id: "c1",
      projectId: p,
      title: "enlace roto",
      status: "discarded",
      fromCritique: "abc123def456",
    });

    expect((await discardedCritiques(db, p)).has("abc123def456")).toBe(true);

    await db.insert(t.tasks).values({
      id: "c2",
      projectId: p,
      title: "enlace roto",
      status: "open",
      fromCritique: "abc123def456",
    });
    expect(
      (await discardedCritiques(db, p)).has("abc123def456"),
      "un encargo vivo posterior significa que te lo pensaste mejor",
    ).toBe(false);
  });

  /*
    The ordinary path, and the one that got lost: you assign a finding, an agent fixes it and
    closes the task, the finding stays on the list —the screen only shows the active ones and
    doesn’t see the closed— and you tell it no. With the old rule, that row `done` counted as
    "something not discarded" and the no didn’t disappear when reloading, over and over again.
   */
  it("el «no» se recuerda aunque antes hubiera un encargo ya cerrado", async () => {
    const p = await proyecto();
    await encargo(p, { id: "c1", fromCritique: "clave11hallazgo", status: "done", createdAt: AYER });
    await encargo(p, { id: "c2", fromCritique: "clave11hallazgo", status: "discarded", createdAt: HOY });

    expect(
      (await discardedCritiques(db, p)).has("clave11hallazgo"),
      "manda la última fila, no el montón",
    ).toBe(true);
  });

  it("y el mismo caso en el crítico de la mirada, que tenía el fallo idéntico", async () => {
    await mirada("m1", 4);
    const p = await proyecto();
    await encargo(p, { id: "t1", fromLook: "m1", fromFinding: 0, status: "done", createdAt: AYER });
    await encargo(p, { id: "t2", fromLook: "m1", fromFinding: 0, status: "discarded", createdAt: HOY });

    expect((await discardedFindings(db)).has("m1 0")).toBe(true);
  });

  it("pero un encargo posterior sigue deshaciendo el no: cambiar de idea vale", async () => {
    const p = await proyecto();
    await encargo(p, { id: "c1", fromCritique: "clave11hallazgo", status: "discarded", createdAt: AYER });
    await encargo(p, { id: "c2", fromCritique: "clave11hallazgo", status: "open", createdAt: HOY });

    expect((await discardedCritiques(db, p)).has("clave11hallazgo")).toBe(false);
  });

  it("y el descarte de un proyecto no habla por su copia", async () => {
    // Two copies of the same repository share a critical key: the decision is by folder.
    const p = await proyecto();
    const otra = "proj-copia";
    await db.insert(t.projects).values({ id: otra, name: "copia", slug: "demo-copia", root: "/tmp/demo-copia" });
    await db.insert(t.tasks).values({
      id: "c1",
      projectId: p,
      title: "x",
      status: "discarded",
      fromCritique: "misma11clave",
    });

    expect((await discardedCritiques(db, otra)).has("misma11clave")).toBe(false);
  });

  /*
    The person's 'no' cannot be undone by an agent who arrives late. Without the state filter, the
    process is normal: it takes the assignment, the person discards it while it runs, and at the
    end of the queue it returned to `done` — so the pair went from discarded to assigned in the
    only marker that this product uses.
   */
  it("completar no resucita lo que se descartó mientras el agente trabajaba", async () => {
    await mirada("m1", 4);
    const p = await proyecto();
    await encargo(p, { id: "t1", fromLook: "m1", fromFinding: 0, status: "in-progress" });
    const { completeTask } = await import("./agents");

    expect(await discardTask(db, "t1")).toBe(true);
    expect(
      await completeTask(db, "t1", "agente-x", "ya está"),
      "y el agente se entera: contesta que no, en vez de creer que entregó",
    ).toBe(false);

    const score = await briefScore(db);
    expect(score.discarded, "sigue siendo un no").toBe(1);
    expect(score.ordered).toBe(0);
    expect(score.done).toBe(0);
  });

  it("y completar dos veces no pisa el informe del primero", async () => {
    const p = await proyecto();
    await encargo(p, { id: "t1", status: "open" });
    const { completeTask } = await import("./agents");

    expect(await completeTask(db, "t1", "agente-x", "lo hice yo")).toBe(true);
    expect(await completeTask(db, "t1", "agente-y", "no, yo")).toBe(false);

    const [row] = await db.select().from(t.tasks).where(eq(t.tasks.id, "t1"));
    expect(row!.result).toBe("lo hice yo");
  });

  it("y la pantalla puede preguntar cuáles salieron", async () => {
    const p = await proyecto();
    await encargo(p, { id: "t1" });
    await encargo(p, { id: "t2" });
    await recordLaunch(db, { projectId: p, taskId: "t1", agent: "Claude Code" });
    await recordLaunch(db, { projectId: p, kind: "plan", agent: "Claude Code" });

    const out = await launchedTasks(db);
    expect(out.has("t1")).toBe(true);
    expect(out.has("t2"), "encargado no es lanzado").toBe(false);
    expect(out.size, "el que no traía tarea no se cuela con un nulo dentro").toBe(1);
  });
});

/*
  The promise that the agents' channel makes in three comments: only open and ongoing. The
  function served it without looking at the status, so the person's 'no'—a discarded row, with the
  entire finding inside—traveled to any agent who listed tasks, turned into a message.
 */
describe("lo que un agente ve al listar tareas", () => {
  beforeEach(async () => {
    await db.delete(t.tasks);
    await db.delete(t.projects);
  });

  async function cola(): Promise<string> {
    const id = "proj-cola";
    await db.insert(t.projects).values({ id, name: "demo", slug: "demo-cola", root: "/tmp/demo-cola" });
    await db.insert(t.tasks).values([
      { id: "t-abierta", projectId: id, title: "haz esto", status: "open" },
      { id: "t-encurso", projectId: id, title: "sigue con esto", status: "in-progress" },
      { id: "t-hecha", projectId: id, title: "ya está", status: "done" },
      { id: "t-no", projectId: id, title: "a esto dije que no", status: "discarded" },
    ]);
    return id;
  }

  it("sin filtro es la historia entera, que es lo que pinta la ficha", async () => {
    const p = await cola();
    expect((await listProjectTasks(db, p)).length).toBe(4);
  });

  it("con el filtro del canal, ni el descarte ni la historia viajan", async () => {
    const p = await cola();
    const visibles = await listProjectTasks(db, p, ["open", "in-progress"]);
    const ids = visibles.map((row) => row.id).sort();
    expect(ids).toEqual(["t-abierta", "t-encurso"]);
  });
});
