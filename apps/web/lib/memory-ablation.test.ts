import { describe, expect, it } from "vitest";
import { ablationArm, ablationEnabled } from "./memory-ablation";

/**
 * The distribution contract, which is what makes the experiment scientific: deterministic, stable
 * during the day, auditable afterwards, and ~50/50 between visits. A distribution that does not
 * meet any of the four turns the scale into an anecdote.
 */

const AT = new Date("2026-08-25T14:30:00.000Z");

describe("el interruptor", () => {
  it("apagada de fábrica, y solo la encienden las dos formas explícitas", () => {
    expect(ablationEnabled(undefined)).toBe(false);
    expect(ablationEnabled("")).toBe(false);
    expect(ablationEnabled("true")).toBe(false);
    expect(ablationEnabled("0")).toBe(false);
    expect(ablationEnabled("1")).toBe(true);
    expect(ablationEnabled("on")).toBe(true);
  });

  it("apagada, todo el mundo recibe su memoria: el brazo retenido no existe", () => {
    for (let i = 0; i < 50; i++) {
      expect(ablationArm({ agentId: `agt_${i}`, projectId: "p", at: AT, enabled: false })).toBe("served");
    }
  });
});

describe("el reparto", () => {
  it("la misma visita cae siempre en el mismo brazo: se puede auditar recalculando", () => {
    const visit = { agentId: "agt_claude", projectId: "proj_panoma", at: AT, enabled: true };
    const arm = ablationArm(visit);
    for (let i = 0; i < 10; i++) expect(ablationArm(visit)).toBe(arm);
  });

  it("y es estable durante todo el día UTC, que es la unidad del experimento", () => {
    const morning = ablationArm({ agentId: "a", projectId: "p", at: new Date("2026-08-25T00:00:01Z"), enabled: true });
    const night = ablationArm({ agentId: "a", projectId: "p", at: new Date("2026-08-25T23:59:59Z"), enabled: true });
    expect(night).toBe(morning);
  });

  it("reparte ~50/50 entre visitas, incluso con ids que solo difieren en un carácter", () => {
    let withheld = 0;
    const total = 400;
    for (let i = 0; i < total; i++) {
      const arm = ablationArm({ agentId: `agt_${i}`, projectId: `proj_${i % 7}`, at: AT, enabled: true });
      if (arm === "withheld") withheld++;
    }
    // A binomial of 400 at 50% falls in [160, 240] with probability >99.99%: if this fails, the
    // hash disperses poorly and the arms are not comparable.
    expect(withheld).toBeGreaterThan(160);
    expect(withheld).toBeLessThan(240);
  });

  it("no es la paridad: el predictor que rompió la primera versión ya no acierta", () => {
    /*
      The first version did `% 2` without avalanche, and the cousin of FNV is odd: bit 0 was a
      linear function of the low bits of the key, and this parity predictor always hit the arm on
      ALL keys — the distribution was a schedule, not a lottery. It runs here as is: if it keeps
      always hitting, the degeneration has returned.
     */
    let hits = 0;
    const total = 500;
    for (let i = 0; i < total; i++) {
      const key = `agt_${i}:proj_${i % 13}:2026-08-25`;
      let parity = 1; // bit 0 of the base 0x811c9dc5
      for (let j = 0; j < key.length; j++) parity ^= key.charCodeAt(j) & 1;
      const predicted = parity === 0 ? "served" : "withheld";
      if (ablationArm({ agentId: `agt_${i}`, projectId: `proj_${i % 13}`, at: AT, enabled: true }) === predicted) hits++;
    }
    // Without correlation, getting it right is around half: the binomial of 500 at 50% falls on
    // [200, 300] with probability >99.99%.
    expect(hits).toBeGreaterThan(200);
    expect(hits).toBeLessThan(300);
  });

  it("dos proyectos con ids de igual paridad ya no comparten calendario de brazos", () => {
    // With parity, 'aa' and 'bb' fell into the same arm every day in history.
    let differs = 0;
    for (let day = 0; day < 60; day++) {
      const at = new Date(Date.UTC(2026, 0, 1 + day, 12));
      const a = ablationArm({ agentId: "agt", projectId: "aa", at, enabled: true });
      const b = ablationArm({ agentId: "agt", projectId: "bb", at, enabled: true });
      if (a !== b) differs++;
    }
    expect(differs, "algún día tienen que discrepar").toBeGreaterThan(0);
  });

  it("con los días, la misma pareja pasa por los dos brazos: nadie vive sin memoria", () => {
    const arms = new Set<string>();
    for (let day = 1; day <= 20; day++) {
      arms.add(
        ablationArm({
          agentId: "agt_fijo",
          projectId: "proj_fijo",
          at: new Date(`2026-08-${String(day).padStart(2, "0")}T12:00:00Z`),
          enabled: true,
        }),
      );
    }
    expect(arms).toEqual(new Set(["served", "withheld"]));
  });
});
