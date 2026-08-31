import { describe, expect, it } from "vitest";
import type { HistorySource, HistorySourceId, TwinConsent } from "@panoma/core";
import { planMine } from "./mine";

/**
 * What stories can be opened right now, and why the others cannot.
 *
 * The three piles have to go out separately because each one is sent to a different place: what is
 * read, what needs to be granted, and what nobody knows how to open yet. Combining the last two
 * sends to give a permission that would be useless.
 */

function source(id: HistorySourceId, patch: Partial<HistorySource> = {}): HistorySource {
  return {
    id,
    label: id,
    path: `/home/quien/.${id}`,
    present: true,
    files: 10,
    bytes: 1_000,
    ...patch,
  };
}

const READABLE: HistorySourceId[] = ["claude-code", "codex"];
const consent = (sources: TwinConsent["sources"]): TwinConsent => ({ sources });

describe("qué historias se abren", () => {
  it("con lector y con permiso, se lee", () => {
    const plan = planMine([source("claude-code")], READABLE, consent({ "claude-code": true }));
    expect(plan.ready).toEqual(["claude-code"]);
    expect(plan.denied).toEqual([]);
  });

  /* The course of action when the permission is missing is to go give it, not to try again. */
  it("con lector y sin permiso, no se abre y se dice cuál falta", () => {
    const plan = planMine([source("codex")], READABLE, consent({}));
    expect(plan.ready).toEqual([]);
    expect(plan.denied).toEqual(["codex"]);
  });

  it("un permiso que no es exactamente `true` no concede nada", () => {
    const raro = { sources: { codex: "sí" } } as unknown as TwinConsent;
    expect(planMine([source("codex")], READABLE, raro).denied).toEqual(["codex"]);
  });

  /*
    Cursor and Aider are seen in the inventory and still no one knows how to open them. Counting
    them as "without permission" would lead to granting one that would be useless.
   */
  it("sin lector no es falta de permiso, y va en su propio montón", () => {
    const plan = planMine([source("cursor")], READABLE, consent({ cursor: true }));
    expect(plan.ready).toEqual([]);
    expect(plan.denied).toEqual([]);
    expect(plan.unreadable).toEqual(["cursor"]);
  });

  /* What is not on the disk is not a refusal: it simply does not exist. */
  it("lo que no está no sale por ningún lado", () => {
    const plan = planMine(
      [source("codex", { present: false })],
      READABLE,
      consent({ codex: true }),
    );
    expect(plan).toEqual({ ready: [], denied: [], unreadable: [] });
  });

  it("reparte varias a la vez y conserva el orden del inventario", () => {
    const plan = planMine(
      [source("claude-code"), source("codex"), source("cursor")],
      READABLE,
      consent({ "claude-code": true, codex: false }),
    );
    expect(plan).toEqual({
      ready: ["claude-code"],
      denied: ["codex"],
      unreadable: ["cursor"],
    });
  });

  it("sin nada en el disco no hay nada que planear", () => {
    expect(planMine([], READABLE, consent({}))).toEqual({
      ready: [],
      denied: [],
      unreadable: [],
    });
  });
});
