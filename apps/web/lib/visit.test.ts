import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { visitWindow } from "./visit";

/**
 * The window of the day's report has two ways of breaking, and both are easy to write by mistake:
 * that it advances with each load (refreshing leaves the report empty and the user learns to
 * ignore it) or that it never advances (the report becomes a file). Here the intermediate behavior
 * is fixed.
 */
describe("ventana de visita", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "panoma-visita-"));
    process.env["PANOMA_HOME"] = home;
  });

  afterEach(async () => {
    delete process.env["PANOMA_HOME"];
    await rm(home, { recursive: true, force: true });
  });

  it("la primera vez no inventa una ventana", async () => {
    expect(await visitWindow()).toBeNull();
  });

  it("deja constancia de la mirada para la siguiente vez", async () => {
    await visitWindow();
    const state = JSON.parse(await readFile(join(home, "visit.json"), "utf8"));
    expect(state.lastVisit).toBeTruthy();
  });

  it("refrescar al momento enseña el mismo parte", async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const window = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    await writeFile(
      join(home, "visit.json"),
      // The window premiered five minutes ago: that is what makes it sticky.
      JSON.stringify({ lastVisit: fiveMinutesAgo, windowSince: window, windowAt: fiveMinutesAgo }),
    );

    // Within the sticky half hour: the window doesn’t move, so reloading the cover can’t empty the
    // report that was being read.
    expect((await visitWindow())?.toISOString()).toBe(window);
  });

  /*
    The failure that this test sets, found by using the application and not by reading it.
    Stickiness was measured against the last glance, so each visit rebuilt it: to freeze the
    window forever, it was enough to open the cover once every half hour, which is exactly what is
    done while working. Measured on the reporter's machine: `windowSince` had been stuck for three
    hours while `lastVisit` updated every few minutes, and the report had stopped saying 'what's
    new' to say 'everything for today'.
   */
  it("trabajar sin parar no congela la ventana: se mide su edad, no la de la mirada", async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    await writeFile(
      join(home, "visit.json"),
      // Looking just now, but with a window that has already reached its half hour.
      JSON.stringify({
        lastVisit: fiveMinutesAgo,
        windowSince: threeHoursAgo,
        windowAt: threeHoursAgo,
      }),
    );

    expect((await visitWindow())?.toISOString()).toBe(fiveMinutesAgo);
  });

  it("y un fichero de antes de esta marca se pone al día en la primera visita", async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    await writeFile(
      join(home, "visit.json"),
      // Without `windowAt`: the age cannot be known, so it is treated as expired.
      JSON.stringify({ lastVisit: fiveMinutesAgo, windowSince: threeHoursAgo }),
    );

    expect((await visitWindow())?.toISOString()).toBe(fiveMinutesAgo);
  });

  it("volver después de un rato cuenta desde la última vez que miraste", async () => {
    const yesterday = new Date(Date.now() - 20 * 60 * 60_000).toISOString();
    await writeFile(
      join(home, "visit.json"),
      JSON.stringify({ lastVisit: yesterday, windowSince: yesterday }),
    );

    expect((await visitWindow())?.toISOString()).toBe(yesterday);
  });

  it("al volver de vacaciones enseña lo último, no dos semanas de todo", async () => {
    const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60_000).toISOString();
    await writeFile(
      join(home, "visit.json"),
      JSON.stringify({ lastVisit: twoMonthsAgo, windowSince: twoMonthsAgo }),
    );

    const since = await visitWindow();
    const daysAgo = (Date.now() - (since?.getTime() ?? 0)) / 86_400_000;
    expect(daysAgo).toBeLessThanOrEqual(14.1);
    expect(daysAgo).toBeGreaterThan(13.9);
  });

  it("una consulta fija no le mueve la ventana a nadie", async () => {
    const antes = new Date(Date.now() - 90 * 60_000).toISOString();
    await writeFile(
      join(home, "visit.json"),
      JSON.stringify({ lastVisit: antes, windowSince: antes }),
    );

    await visitWindow(false);

    const state = JSON.parse(await readFile(join(home, "visit.json"), "utf8"));
    expect(state.lastVisit).toBe(antes);
  });
});

/**
 * This case came from a check in the browser, not from imagination: the entire homepage was
 * failing with ENOENT because two simultaneous Next renders were sharing the same temporary file.
 * It is written down so it won't happen again.
 */
describe("escrituras a la vez", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "panoma-visita-race-"));
    process.env["PANOMA_HOME"] = home;
  });

  afterEach(async () => {
    delete process.env["PANOMA_HOME"];
    await rm(home, { recursive: true, force: true });
  });

  it("diez visitas simultáneas no se pisan ni tiran nada", async () => {
    const allOf = await Promise.all(Array.from({ length: 10 }, () => visitWindow()));

    expect(allOf).toHaveLength(10);
    const state = JSON.parse(await readFile(join(home, "visit.json"), "utf8"));
    expect(state.lastVisit).toBeTruthy();
  });
});
