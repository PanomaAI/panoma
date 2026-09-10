import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import * as t from "./schema";
import {
  listModelCalls,
  modelSpendByKind,
  modelSpendByModel,
  modelSpendToday,
  saveModelCall,
  startOfDay,
} from "./queries";

/**
 * The book of spending: what has been called today, and what 'today' is.
 *
 * It was born from a flaw that was seen on the screen and read backward. "What has cost today"
 * said five glances and did not move throughout an entire afternoon of distilling and
 * consolidating, so it seemed like a frozen counter. They were two different things and neither
 * was that:
 *
 * 1. Only the look wrote in the book. To distill and consolidate they called to a model, they
 * paid, and they left no trace — a receipt that notes a three-part organ is not incomplete, it
 * lies about the total.
 * 2. 'Today' was the day in UTC. PGlite starts in UTC and no one tells it otherwise, so
 * `date_trunc('day', now())` ended at midnight in London. Measured on the author's machine at
 * 21:51 EDT: the day's budget had already been renewed at 20:00 in the afternoon, in the middle of
 * the session.
 *
 * That is why the cutoff is passed as a parameter and calculated in JavaScript, which does know
 * what time zone the machine is in. These tests check the two halves separately: that the filter
 * respects the cutoff that it is given, and that the cutoff that is calculated is only the local
 * calendar day here.
 */

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-gasto-"));
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

beforeEach(async () => {
  await db.delete(t.modelCalls);
});

/** A call with a hand-written date: `saveModelCall` always writes 'now'. */
async function callAt(
  kind: string,
  at: Date,
  usage?: { input: number; output: number },
  through: { provider: string; model: string } = { provider: "openai", model: "gpt-de-prueba" },
) {
  await db.insert(t.modelCalls).values({
    id: `${kind}-${at.getTime()}-${Math.round(at.getTime() % 1000)}-${kind.length}`,
    kind,
    provider: through.provider,
    model: through.model,
    inputTokens: usage?.input ?? null,
    outputTokens: usage?.output ?? null,
    images: 0,
    createdAt: at,
  });
}

describe("lo gastado desde un corte", () => {
  it("cuenta lo de después del corte y no lo de antes", async () => {
    const corte = new Date(2026, 7, 21, 0, 0, 0);
    await callAt("look", new Date(2026, 7, 20, 23, 59, 0), { input: 900, output: 90 });
    await callAt("look", new Date(2026, 7, 21, 9, 30, 0), { input: 100, output: 10 });

    const spend = await modelSpendToday(db, "look", corte);
    expect(spend.calls).toBe(1);
    expect(spend.input).toBe(100);
    expect(spend.output).toBe(10);
  });

  it("cada clase lleva su propia cuenta", async () => {
    const corte = new Date(2026, 7, 21, 0, 0, 0);
    await callAt("look", new Date(2026, 7, 21, 9, 0, 0), { input: 100, output: 10 });
    await callAt("distill", new Date(2026, 7, 21, 10, 0, 0), { input: 500, output: 50 });

    expect((await modelSpendToday(db, "look", corte)).calls).toBe(1);
    expect((await modelSpendToday(db, "distill", corte)).calls).toBe(1);
    expect((await modelSpendToday(db, "consolidate", corte)).calls).toBe(0);
  });

  /*
    Several classes at once, which is what reading brake needs: distilling, distributing by
    subject, and synthesizing are a single chained job and go against a single limit. See
    `apps/web/lib/reads.ts`.
   */
  it("varias clases suman como una sola cuenta", async () => {
    const corte = new Date(2026, 7, 21, 0, 0, 0);
    await callAt("distill", new Date(2026, 7, 21, 9, 0, 0), { input: 500, output: 50 });
    await callAt("classify", new Date(2026, 7, 21, 9, 5, 0), { input: 300, output: 30 });
    await callAt("synthesize", new Date(2026, 7, 21, 9, 9, 0), { input: 200, output: 20 });
    await callAt("look", new Date(2026, 7, 21, 9, 10, 0), { input: 100, output: 10 });

    const spend = await modelSpendToday(db, ["distill", "classify", "synthesize"], corte);
    expect(spend.calls, "las tres, y la mirada no").toBe(3);
    expect(spend.input).toBe(1_000);
    expect(spend.output).toBe(100);
  });

  /*
    And an empty list spends zero, which is not the same as not filtering. The direction matters:
    if this returned the total for the day, a brake built on an empty list—a poorly imported
    constant, a `filter` that ended up with nothing—would jump over organs that no one has called,
    and stop what it doesn't measure instead of letting what is measured pass.
   */
  it("sin clases que mirar no cuenta nada, en vez de contarlo todo", async () => {
    await callAt("distill", new Date(2026, 7, 21, 9, 0, 0), { input: 500, output: 50 });

    const spend = await modelSpendToday(db, [], new Date(2026, 7, 21, 0, 0, 0));
    expect(spend).toEqual({ calls: 0, input: 0, output: 0, unmetered: 0, images: 0 });
  });

  /*
    The zero of an empty table is indeed the correct answer, and it comes from `coalesce` over the
    sum. Without it, the row returns with nulls and the screen displays 'NaN tokens'.
   */
  it("sin llamadas, todo a cero y ningún nulo", async () => {
    const spend = await modelSpendToday(db, "look", new Date(2026, 7, 21, 0, 0, 0));
    expect(spend).toEqual({ calls: 0, input: 0, output: 0, unmetered: 0, images: 0 });
  });

  it("las que no publican su consumo se cuentan aparte", async () => {
    const corte = new Date(2026, 7, 21, 0, 0, 0);
    await callAt("look", new Date(2026, 7, 21, 9, 0, 0), { input: 100, output: 10 });
    await callAt("look", new Date(2026, 7, 21, 9, 5, 0));

    const spend = await modelSpendToday(db, "look", corte);
    expect(spend.calls, "las dos se han pagado").toBe(2);
    expect(spend.unmetered, "y de una no se sabe cuánto").toBe(1);
    expect(spend.input, "el total no inventa lo que nadie publicó").toBe(100);
  });
});

/**
 * The entire receipt, which is what was missing.
 *
 * One row per class and no total already summed: the three cost different things —a glance sends
 * an image, a distillation sends half a history— and merging them into a number would stop
 * answering 'where did this come from?'.
 */
describe("el gasto por clases", () => {
  it("saca una fila por clase, con lo suyo dentro", async () => {
    const corte = new Date(2026, 7, 21, 0, 0, 0);
    await callAt("look", new Date(2026, 7, 21, 9, 0, 0), { input: 100, output: 10 });
    await callAt("distill", new Date(2026, 7, 21, 10, 0, 0), { input: 500, output: 50 });
    await callAt("distill", new Date(2026, 7, 21, 10, 5, 0), { input: 400, output: 40 });
    await callAt("consolidate", new Date(2026, 7, 21, 11, 0, 0), { input: 300, output: 30 });

    const spend = await modelSpendByKind(db, corte);
    expect(spend.map((one) => one.kind), "en orden, para que la pantalla no baile").toEqual([
      "consolidate",
      "distill",
      "look",
    ]);
    expect(spend.find((one) => one.kind === "distill")).toMatchObject({
      calls: 2,
      input: 900,
      output: 90,
    });
  });

  it("una clase sin llamadas no sale como cero: no sale", async () => {
    await callAt("distill", new Date(2026, 7, 21, 10, 0, 0), { input: 500, output: 50 });
    const spend = await modelSpendByKind(db, new Date(2026, 7, 21, 0, 0, 0));
    expect(spend.map((one) => one.kind)).toEqual(["distill"]);
  });

  it("lo de antes del corte tampoco cuenta aquí", async () => {
    await callAt("look", new Date(2026, 7, 20, 22, 0, 0), { input: 100, output: 10 });
    expect(await modelSpendByKind(db, new Date(2026, 7, 21, 0, 0, 0))).toEqual([]);
  });

  /* What is really noted, through the door that the routes use. */
  it("lo que escribe saveModelCall cae dentro del día de hoy", async () => {
    await saveModelCall(db, { kind: "consolidate", provider: "openai", model: "m", input: 7, output: 3 });
    const spend = await modelSpendByKind(db);
    expect(spend).toEqual([
      { kind: "consolidate", calls: 1, input: 7, output: 3, unmetered: 0, images: 0 },
    ]);
  });

  /*
    The upper bound, which the spend screen needs for a closed window —'yesterday'— and the brakes
    never pass. Exclusive on purpose: the row written exactly at the next midnight belongs to the
    next day, or two adjacent windows would count it twice.
   */
  it("an until bound leaves out what happened at or after it", async () => {
    const since = new Date(2026, 7, 21, 0, 0, 0);
    const until = new Date(2026, 7, 22, 0, 0, 0);
    await callAt("look", new Date(2026, 7, 21, 9, 0, 0), { input: 100, output: 10 });
    await callAt("look", new Date(2026, 7, 22, 0, 0, 0), { input: 200, output: 20 });
    await callAt("look", new Date(2026, 7, 22, 8, 0, 0), { input: 300, output: 30 });

    const spend = await modelSpendByKind(db, since, until);
    expect(spend).toEqual([{ kind: "look", calls: 1, input: 100, output: 10, unmetered: 0, images: 0 }]);
    expect((await modelSpendByKind(db, since)).map((one) => one.calls), "without it, open-ended").toEqual([3]);
  });
});

/**
 * The receipt by provider and model, which is where a price can be attached: a rate is per pair,
 * not per organ, and a look through two providers costs two different amounts of money.
 */
describe("the spend by provider and model", () => {
  it("groups by the pair and orders by provider, then model", async () => {
    const since = new Date(2026, 7, 21, 0, 0, 0);
    await callAt("look", new Date(2026, 7, 21, 9, 0, 0), { input: 100, output: 10 }, { provider: "openai", model: "gpt-b" });
    await callAt("distill", new Date(2026, 7, 21, 9, 1, 0), { input: 500, output: 50 }, { provider: "anthropic", model: "claude-z" });
    await callAt("look", new Date(2026, 7, 21, 9, 2, 0), { input: 200, output: 20 }, { provider: "openai", model: "gpt-a" });
    await callAt("classify", new Date(2026, 7, 21, 9, 3, 0), { input: 300, output: 30 }, { provider: "openai", model: "gpt-b" });

    const spend = await modelSpendByModel(db, since);
    expect(spend.map((one) => `${one.provider}/${one.model}`)).toEqual([
      "anthropic/claude-z",
      "openai/gpt-a",
      "openai/gpt-b",
    ]);
    expect(spend[2], "two kinds through the same pair are one line").toMatchObject({
      calls: 2,
      input: 400,
      output: 40,
    });
  });

  it("keeps the unmetered calls apart from the token sum", async () => {
    const since = new Date(2026, 7, 21, 0, 0, 0);
    await callAt("ask", new Date(2026, 7, 21, 9, 0, 0), { input: 100, output: 10 }, { provider: "claude-cli", model: "session" });
    await callAt("ask", new Date(2026, 7, 21, 9, 5, 0), undefined, { provider: "claude-cli", model: "session" });

    const [row] = await modelSpendByModel(db, since);
    expect(row).toEqual({
      provider: "claude-cli",
      model: "session",
      calls: 2,
      input: 100,
      output: 10,
      unmetered: 1,
      images: 0,
    });
  });

  it("honours the until bound like the receipt by kind", async () => {
    await callAt("look", new Date(2026, 7, 21, 9, 0, 0), { input: 100, output: 10 });
    await callAt("look", new Date(2026, 7, 22, 9, 0, 0), { input: 200, output: 20 });

    const spend = await modelSpendByModel(db, new Date(2026, 7, 21), new Date(2026, 7, 22));
    expect(spend.map((one) => one.input)).toEqual([100]);
  });
});

/**
 * The raw lines, for whoever groups them by local day in JavaScript. The database runs in UTC and
 * cannot cut a day where this machine does; see the header of `startOfDay`.
 */
describe("the lines of the ledger", () => {
  it("returns them oldest first, with unknown usage as null and never as zero", async () => {
    const since = new Date(2026, 7, 21, 0, 0, 0);
    await callAt("look", new Date(2026, 7, 21, 11, 0, 0), { input: 100, output: 10 });
    await callAt("ask", new Date(2026, 7, 21, 9, 0, 0));
    await callAt("distill", new Date(2026, 7, 20, 23, 0, 0), { input: 900, output: 90 });

    const rows = await listModelCalls(db, { since });
    expect(rows.map((one) => one.kind), "before the cutoff stays out; the rest, in order").toEqual(["ask", "look"]);
    expect(rows[0]).toMatchObject({ kind: "ask", input: null, output: null, images: 0, identity: null });
    expect(rows[0]!.createdAt.getTime()).toBe(new Date(2026, 7, 21, 9, 0, 0).getTime());
    expect(rows[1]).toMatchObject({ provider: "openai", model: "gpt-de-prueba", input: 100, output: 10 });
  });

  it("stops at the until bound and at the limit", async () => {
    const since = new Date(2026, 7, 21, 0, 0, 0);
    for (const hour of [9, 10, 11, 12]) {
      await callAt("look", new Date(2026, 7, 21, hour, 0, 0), { input: hour, output: 1 });
    }
    await callAt("look", new Date(2026, 7, 22, 9, 0, 0), { input: 500, output: 1 });

    const window = await listModelCalls(db, { since, until: new Date(2026, 7, 22, 0, 0, 0) });
    expect(window.map((one) => one.input)).toEqual([9, 10, 11, 12]);

    const capped = await listModelCalls(db, { since, limit: 2 });
    expect(capped.map((one) => one.input), "the oldest survive a cap, so a chart truncates at its end").toEqual([9, 10]);
  });
});

/**
 * And the cut, which is the half that was wrong.
 *
 * The property that was breaking: **all hours of the natural day share a cutoff**, the last one
 * included. With the UTC day that stops being true as soon as the machine is not in London — at
 * 9:00 PM in New York it is already tomorrow in UTC, so the afternoon calls fell outside the day
 * they were made and the counter reset in the middle of a session.
 */
describe("cuándo empezó hoy", () => {
  it("todas las horas del mismo día natural dan el mismo corte", () => {
    const day = [0, 6, 12, 20, 23].map((hour) => startOfDay(new Date(2026, 7, 21, hour, 30)));
    for (const one of day) expect(one.getTime()).toBe(day[0]?.getTime());
  });

  it("y el corte es la medianoche de aquí, no la de ningún otro sitio", () => {
    const at = new Date(2026, 7, 21, 23, 59, 59);
    const from = startOfDay(at);
    expect([from.getFullYear(), from.getMonth(), from.getDate()]).toEqual([2026, 7, 21]);
    expect([from.getHours(), from.getMinutes(), from.getSeconds()]).toEqual([0, 0, 0]);
  });

  it("el día siguiente empieza en otro sitio", () => {
    const hoy = startOfDay(new Date(2026, 7, 21, 23, 59));
    const manana = startOfDay(new Date(2026, 7, 22, 0, 1));
    expect(manana.getTime()).toBeGreaterThan(hoy.getTime());
  });
});
