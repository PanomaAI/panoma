import { describe, expect, it } from "vitest";
import type { BeliefRow } from "@panoma/db";
import { publishable } from "./publishable";

/**
 * What is written to the file, and with what it will be recognized there.
 *
 * The case this file brought is the last one: `published_as` was saved in the database, read in
 * the row, and lost right here, when moving from the row to what the reconciliation looks at.
 * Since `published` always came up empty, it seemed like the entry had never been in the file and
 * was added again, with its old line intact beside it. In the author's catalog, this left a
 * `TASTE.md` with the same sentence twice — the one before refining and the one after — and a
 * receipt that said “withdrawn: 0, rewritten: 0” without lying: it didn’t pass that way.
 */

function belief(patch: Partial<BeliefRow> = {}): BeliefRow {
  return {
    id: "b1",
    topic: "design",
    classified: true,
    statement: "Quieres que cada animación tenga propósito.",
    identity: null,
    state: "inferred",
    supersedes: [],
    citations: [{ verdictId: "v1", quote: "…", at: new Date(), project: "panoma" }],
    support: { observations: 4, projects: 3, days: 5 },
    model: "openai-codex/gpt",
    signedAt: null,
    vetoedAt: null,
    retiredAt: null,
    publishedAs: null,
    updatedAt: new Date(),
    createdAt: new Date(),
    ...patch,
  } as BeliefRow;
}

describe("lo que baja al fichero", () => {
  it("lleva consigo lo que se escribió la última vez", () => {
    const antes = { topic: "design", statement: "Quieres animaciones con propósito." };
    const [row] = publishable([belief({ publishedAs: antes })], {}, true);

    expect(row?.published, "sin esto la reconciliación no puede reconocer su línea").toEqual(
      antes,
    );
  });

  it("y no se inventa una cuando nunca ha llegado al fichero", () => {
    const [row] = publishable([belief({ publishedAs: null })], {}, true);
    expect(row?.published).toBeUndefined();
  });

  it("lo firmado baja aunque el permiso no esté dado", () => {
    const rows = publishable([belief({ state: "signed" })], {}, false);
    expect(rows).toHaveLength(1);
  });

  it("lo inferido no baja sin permiso", () => {
    expect(publishable([belief()], {}, false)).toHaveLength(0);
  });

  /* The ground of trust: a belief underneath is a coincidence, not a belief. */
  it("lo inferido que no se sostiene tampoco baja, aun con permiso", () => {
    const flojo = belief({ support: { observations: 2, projects: 1, days: 1 } });
    expect(publishable([flojo], {}, true)).toHaveLength(0);
  });

  /*
    The second branch did not check the state: a dead row with extra support would have entered
    the file if any caller forgot to filter to ALIVE beforehand. The two that exist do filter;
    this function writes what all your agents read and does not trust that.
   */
  it("una fila muerta no baja aunque su soporte aguante", () => {
    for (const state of ["vetoed", "retired", "proposed", "answered"] as const) {
      expect(publishable([belief({ state })], {}, true), state).toHaveLength(0);
    }
  });

  it("el alcance viaja por nombre, no por identidad", () => {
    const [row] = publishable(
      [belief({ identity: "git:0516a71734" })],
      { "git:0516a71734": "panoma-monorepo" },
      true,
    );
    expect(row?.scope).toBe("panoma-monorepo");
  });

  /*
    A project that is no longer in the catalog leaves the belief out of reach instead of writing
    the hash: it is applied excessively and is visible, instead of leaving a line that nobody can
    read.
   */
  it("una identidad sin nombre baja como global", () => {
    const [row] = publishable([belief({ identity: "git:desaparecido" })], {}, true);
    expect(row?.scope).toBeUndefined();
  });

  it("las citas viajan como identificadores de veredicto", () => {
    const [row] = publishable([belief()], {}, true);
    expect(row?.citations).toEqual(["v1"]);
  });
});
