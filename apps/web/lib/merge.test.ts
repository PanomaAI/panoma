import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  insertBeliefs,
  listBeliefs,
  resolveProposal,
  saveObservations,
  tasteScore,
  type Database,
  type NewBelief,
  type ObservationRow,
} from "@panoma/db";
import { citationsFor, planChanges, scopeOf, supportOf, type Draft } from "./beliefs";
import { buildSynthesisPrompt, parseBeliefs } from "./synthesize";

/**
 * The fusion of various beliefs, seen run entire.
 *
 * It is the only Twin path that was built, tested in parts, and **never executed**: two signed
 * beliefs saying the same thing are needed, and there were none in the author's catalog. Each link
 * had its test —the parser knows how to read `replaces`, `planChanges` knows how to produce a
 * proposal with several, `resolveProposal` knows how to apply it— and no one traversed the seam
 * between them. It is exactly the kind of failure that `docs/twin.md` pursues: pieces that pass
 * their tests and a chain that has not been walked.
 *
 * So here we go, against PGlite and with the real functions. The only scripted part is the model's
 * opinion —the JSON response— because it's the only thing that isn't our code: what still can't be
 * verified in a test is that a model proposes the merge on its own, and that depends on the
 * corpus, not on this.
 *
 * The step that is repeated here by hand is the route: from a `BeliefChange` to the row. There are
 * ten lines within a HTTP handler, and they are exactly the ones that decide if a proposal is
 * created with its `supersedes` inside — without them, the question arrives on the screen with
 * nothing crossed out and saying yes doesn't change anything.
 */

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-fusion-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db, close } = await openDatabase());
});

afterAll(async () => {
  await close?.();
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

const AYER = new Date("2026-08-20T09:00:00.000Z");

/** An observation with its quote, which is what makes a belief able to be sustained. */
function observation(id: string, statement: string) {
  return {
    identity: "git:uno",
    topic: "design",
    statement,
    citations: [{ verdictId: id.padEnd(40, "0"), quote: statement, at: AYER.toISOString() }],
    model: "prueba/modelo",
    at: AYER,
  };
}

async function firmada(statement: string): Promise<string> {
  const row: NewBelief = {
    topic: "design",
    statement,
    state: "signed",
    citations: [],
    support: { observations: 3, projects: 2, days: 2 },
    model: "prueba/modelo",
  };
  const [id] = await insertBeliefs(db, [row]);
  return id!;
}

describe("dos creencias firmadas que dicen lo mismo, de la respuesta a la base", () => {
  it("acaban en una sola, y la otra retirada", async () => {
    /* What there was: two signed sentences that say the same thing in other words. */
    const una = await firmada("No quiero animaciones que no se puedan desactivar.");
    const otra = await firmada("Las animaciones tienen que poder apagarse.");

    await saveObservations(db, [
      observation("a", "pidió quitar la animación del menú"),
      observation("b", "rechazó una transición que no se podía desactivar"),
    ]);
    const observations = await observationsOf();

    /* The real task: this function assigns the `f1`, `f2`, and `o1` labels. */
    const built = buildSynthesisPrompt(
      "design",
      observations.map((one) => ({ id: one.id, statement: one.statement, at: AYER.toISOString() })),
      [
        { id: una, statement: "No quiero animaciones que no se puedan desactivar.", signed: true },
        { id: otra, statement: "Las animaciones tienen que poder apagarse.", signed: true },
      ],
      [],
    );

    expect(built.prompt, "el encargo tiene que ofrecer la fusión, o no pasa nunca").toContain(
      '"replaces"',
    );
    expect([...built.beliefs.keys()], "las dos firmadas, etiquetadas").toEqual(["f1", "f2"]);

    /* The only scripted part: what a model that sees repetition would answer. */
    const answer = JSON.stringify([
      {
        replaces: ["f1", "f2"],
        statement: "Toda animación tiene que poder apagarse.",
        observations: ["o1", "o2"],
      },
    ]);

    const read = parseBeliefs(answer, built, []);
    expect(read.unreadable).toBe(false);
    expect(read.beliefs).toHaveLength(1);
    expect(read.beliefs[0]?.replaces, "las dos, resueltas a su id").toEqual([una, otra]);

    /* From there to the plan, with what is now in front. */
    const byId = new Map(observations.map((one) => [one.id, one] as const));
    const drafts: Draft[] = read.beliefs.map((draft) => {
      const rows = draft.observations.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      });
      return {
        ...draft,
        support: supportOf(rows),
        citations: citationsFor(rows).map((cite) => cite.verdictId),
      };
    });

    const changes = planChanges(drafts, [
      { id: una, statement: "No quiero animaciones…", signed: true, support: { observations: 3, projects: 2, days: 2 }, citations: [] },
      { id: otra, statement: "Las animaciones…", signed: true, support: { observations: 3, projects: 2, days: 2 }, citations: [] },
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "propose", supersedes: [una, otra] });

    /* And to the database, with the same ten lines the route writes. */
    const change = changes[0]!;
    if (change.kind !== "propose") throw new Error("el plan tenía que ser una pregunta");
    const rows = change.observations.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
    await insertBeliefs(db, [
      {
        topic: "design",
        statement: change.statement,
        state: "proposed",
        supersedes: change.supersedes,
        identity: change.kind === "propose" ? null : scopeOf(rows),
        citations: citationsFor(rows),
        support: supportOf(rows),
        model: "prueba/modelo",
      },
    ]);

    const [pregunta] = await listBeliefs(db, { states: ["proposed"] });
    expect(pregunta, "la pregunta existe").toBeDefined();
    expect(
      pregunta!.supersedes,
      "y sabe a quién sustituiría: sin esto llega a la pantalla sin nada tachado",
    ).toEqual([una, otra]);

    /* The person says yes. */
    const antes = await tasteScore(db);
    expect(await resolveProposal(db, pregunta!.id, true)).toBe(true);

    const final = new Map((await listBeliefs(db)).map((row) => [row.id, row] as const));
    expect(final.get(una)!.statement, "la primera hereda el texto").toBe(
      "Toda animación tiene que poder apagarse.",
    );
    expect(final.get(una)!.state, "y sigue firmada: quien acepta acaba de firmar").toBe("signed");
    expect(final.get(otra)!.state, "la otra se retira, que no es vetarla").toBe("retired");
    expect(final.get(pregunta!.id)!.state).toBe("answered");

    const despues = await tasteScore(db);
    expect(despues.corrections, "juntar no es corregir").toBe(antes.corrections);
  });
});

/** The newly saved observations, which is where the assignment labels come from. */
async function observationsOf(): Promise<ObservationRow[]> {
  const { listObservations } = await import("@panoma/db");
  return listObservations(db, { topic: "design", limit: 10 });
}
