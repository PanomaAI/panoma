import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkQuarantine, quarantineDays, quarantineDecision } from "./published";

/**
 * The quarantine decides whether Panoma installs a newly released version. Being wrong on one side
 * lets a compromised package through; on the other, it blocks legitimate updates forever. Both
 * extremes matter, and that is why both are here.
 */

const originalFetch = globalThis.fetch;
const originalDays = process.env["PANOMA_CUARENTENA_DIAS"];

/** Respond like the npm registry, with the `time` of the requested version. */
function npmResponding(time: Record<string, string> | undefined) {
  globalThis.fetch = vi.fn(async () =>
    time === undefined
      ? new Response("", { status: 404 })
      : new Response(JSON.stringify({ time }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  delete process.env["PANOMA_CUARENTENA_DIAS"];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalDays === undefined) delete process.env["PANOMA_CUARENTENA_DIAS"];
  else process.env["PANOMA_CUARENTENA_DIAS"] = originalDays;
});

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe("el umbral", () => {
  it("son tres días por defecto", () => {
    expect(quarantineDays()).toBe(3);
  });

  it("se puede cambiar, y una basura no lo rompe", () => {
    process.env["PANOMA_CUARENTENA_DIAS"] = "7";
    expect(quarantineDays()).toBe(7);
    process.env["PANOMA_CUARENTENA_DIAS"] = "no";
    expect(quarantineDays()).toBe(3);
    process.env["PANOMA_CUARENTENA_DIAS"] = "-1";
    expect(quarantineDays()).toBe(3);
  });
});

describe("qué se considera demasiado reciente", () => {
  it("publicada hace dos horas: no pasa", async () => {
    npmResponding({ "1.2.3": hoursAgo(2) });
    const verdict = await checkQuarantine("npm", "algo", "1.2.3");
    expect(verdict.tooFresh).toBe(true);
    expect(Math.round(verdict.ageHours!)).toBe(2);
  });

  it("publicada hace un mes: pasa", async () => {
    npmResponding({ "1.2.3": hoursAgo(24 * 30) });
    await expect(checkQuarantine("npm", "algo", "1.2.3")).resolves.toMatchObject({
      tooFresh: false,
    });
  });

  it("justo en el límite de tres días: pasa", async () => {
    npmResponding({ "1.2.3": hoursAgo(72.5) });
    await expect(checkQuarantine("npm", "algo", "1.2.3")).resolves.toMatchObject({
      tooFresh: false,
    });
  });

  /*
    Refusing for not knowing would block entire ecosystems —the records that do not publish dates—
    over a doubt that can never be resolved. It is a decision, not a negligence: what is done is
    not to affirm that the quarantine happened, leaving `publishedAt` empty.
   */
  it("sin fecha del registro, no se bloquea, pero tampoco se afirma nada", async () => {
    npmResponding({});
    const verdict = await checkQuarantine("npm", "algo", "1.2.3");
    expect(verdict.tooFresh).toBe(false);
    expect(verdict.publishedAt).toBeUndefined();
  });

  it("un ecosistema que no sabemos consultar no bloquea", async () => {
    await expect(checkQuarantine("cargo", "serde", "1.0.0")).resolves.toMatchObject({
      tooFresh: false,
    });
  });

  it("si el registro se cae, no se bloquea", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("sin red");
    }) as unknown as typeof fetch;
    await expect(checkQuarantine("npm", "algo", "1.2.3")).resolves.toMatchObject({
      tooFresh: false,
    });
  });

  it("con el umbral en 0 no se consulta siquiera al registro", async () => {
    // Turning it off has to be free: whoever turns it off should not have to pay a petition.
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    process.env["PANOMA_CUARENTENA_DIAS"] = "0";
    await expect(checkQuarantine("npm", "algo", "1.2.3")).resolves.toMatchObject({
      tooFresh: false,
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("qué se hace con una versión que no ha pasado la cuarentena", () => {
  const fresh = { days: 3, tooFresh: true, ageHours: 5, publishedAt: new Date() };
  const oldOne = { days: 3, tooFresh: false };

  it("una subida rutinaria se bloquea", () => {
    expect(quarantineDecision(fresh, {})).toMatchObject({ action: "bloquear", age: "5 h" });
  });

  /*
    The branch that matters most: the one that decides *not* to block. The version is named in a
    public notice as the fix, so leaving a known vulnerability open out of caution against a
    hypothetical one is to trade a certain risk for a speculative one.
   */
  it("un arreglo de seguridad sigue, y queda dicho por qué", () => {
    const decision = quarantineDecision(fresh, { security: true });
    expect(decision.action).toBe("avisar");
    expect((decision as { note: string }).note).toContain("arreglo de seguridad");
  });

  it("forzar sigue, y también queda dicho", () => {
    const decision = quarantineDecision(fresh, { force: true });
    expect(decision.action).toBe("avisar");
    expect((decision as { note: string }).note).toContain("forzado");
  });

  it("lo que ya pasó la cuarentena no deja ninguna nota", () => {
    expect(quarantineDecision(oldOne, {})).toEqual({ action: "seguir" });
    expect(quarantineDecision(oldOne, { security: true })).toEqual({ action: "seguir" });
  });

  it("la edad se cuenta en horas hasta las 48, y en días a partir de ahí", () => {
    // “2 days ago” hides that it was 50 hours; “50 h ago” hides little.
    expect(quarantineDecision({ ...fresh, ageHours: 47 }, {})).toMatchObject({ age: "47 h" });
    expect(quarantineDecision({ ...fresh, ageHours: 50, days: 7 }, {})).toMatchObject({
      age: "2 días",
    });
  });
});
