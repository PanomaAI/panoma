import { afterEach, describe, expect, it } from "vitest";
import { buildFileIndex } from "./discover";
import { analyzeEcosystems } from "./ecosystems";
import { readGitInfo } from "./git";
import { applyEnrichment, computeHealth } from "./health";
import { createProject } from "./test-utils/temp-project";

/**
 * The health note is the only thing that Panoma **claims about the work of others**. Everything
 * else it describes; this it judges. A failure here does not produce a strange data point: it produces a
 * false accusation, and on top of that with two decimals of apparent precision.
 *
 * What is tested are **invariants**, not specific scores. Claiming 'this project scores 73' turns
 * any adjustment of the weights into a failing test that is fixed by editing the expected number,
 * which is the fastest way for a test to stop meaning anything. The invariants here must continue
 * to hold true after any reasonable adjustment, and if they stop being true, it means that the
 * adjustment was not reasonable.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function healthOf(files: Record<string, string>, git = false) {
  const { root, cleanup } = createProject(files, { git });
  cleanups.push(cleanup);
  const index = await buildFileIndex(root);
  return computeHealth(index, await analyzeEcosystems(index), git ? await readGitInfo(root) : undefined);
}

/** Four projects of very different quality, so that the invariants are not tested alone. */
const CASES: Record<string, Record<string, string>> = {
  vacío: { "package.json": "{}" },
  mínimo: { "package.json": JSON.stringify({ name: "m", version: "1.0.0" }) },
  decent: {
    "package.json": JSON.stringify({
      name: "d",
      version: "1.0.0",
      description: "Algo",
      license: "MIT",
      scripts: { test: "vitest" },
      dependencies: { next: "^15.0.0" },
    }),
    "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {} }),
    "README.md": "# d\n\nUn proyecto.",
    ".gitignore": "node_modules\n",
    "src/index.ts": "export const x = 1;\n",
    "src/index.test.ts": "it('x', () => {});\n",
  },
  raro: {
    // Hostile names and contents: the engine must not crash or go out of range.
    "package.json": '{"name": "', // JSON broken on purpose
    "README.md": "",
    "a b/c(d)/e.ts": "export {};",
  },
};

describe("computeHealth", () => {
  it("mantiene la nota dentro de 0..100 y la letra coherente en todos los casos", async () => {
    for (const [name, files] of Object.entries(CASES)) {
      const health = await healthOf(files);

      expect(health.score, `${name}: la nota se sale del rango`).toBeGreaterThanOrEqual(0);
      expect(health.score, `${name}: la nota se sale del rango`).toBeLessThanOrEqual(100);
      expect(Number.isInteger(health.score), `${name}: la nota no es entera`).toBe(true);
      expect(["A", "B", "C", "D", "F"], `${name}: letra desconocida`).toContain(health.grade);
    }
  });

  it("ninguna señal puntúa por encima de su máximo", async () => {
    for (const [name, files] of Object.entries(CASES)) {
      const health = await healthOf(files);
      for (const signal of health.signals) {
        expect(signal.points, `${name}/${signal.id}: puntúa más que su máximo`).toBeLessThanOrEqual(
          signal.max,
        );
        expect(signal.max, `${name}/${signal.id}: máximo no positivo`).toBeGreaterThan(0);
        expect(signal.detail, `${name}/${signal.id}: señal sin explicación`).toBeTruthy();
      }
    }
  });

  it("un proyecto cuidado no puntúa menos que uno vacío", async () => {
    // The invariant that really matters: order. The weights can change; an empty `package.json`
    // giving more than a project with lockfile, tests, license, and README, cannot.
    const vacío = await healthOf(CASES.vacío!);
    const decent = await healthOf(CASES.decent!);
    expect(decent.score).toBeGreaterThan(vacío.score);
  });

  it("declara qué no pudo evaluar en vez de puntuarlo a cero", async () => {
    // Without a network, you don't know if the dependencies are up to date. Counting it as 'bad'
    // would be punishing the project for our own limitation.
    const health = await healthOf(CASES.decent!);
    expect(health.skipped.length, "no declara ninguna señal omitida sin red").toBeGreaterThan(0);
  });
});

describe("applyEnrichment", () => {
  it("es idempotente: aplicarlo dos veces da lo mismo que una", async () => {
    // This is stated in the comment of `health.ts`, and until now nothing confirmed it. If it
    // ceases to be so, the note would change by itself in each `panoma enrich` without the code
    // changing.
    const base = await healthOf(CASES.decent!);
    const data = { directDeps: 10, outdatedDeps: 3, vulnCount: 2, vulnCritical: 1 };

    const una = applyEnrichment(base, data);
    const dos = applyEnrichment(applyEnrichment(base, data), data);

    expect(dos.score).toBe(una.score);
    expect(dos.grade).toBe(una.grade);
    expect(dos.signals.length).toBe(una.signals.length);
  });

  it("no saca la nota del rango ni con datos absurdos", async () => {
    const base = await healthOf(CASES.decent!);
    for (const data of [
      { directDeps: 0, outdatedDeps: 0, vulnCount: 0, vulnCritical: 0 },
      { directDeps: 1, outdatedDeps: 999, vulnCount: 999, vulnCritical: 999 },
    ]) {
      const health = applyEnrichment(base, data);
      expect(health.score).toBeGreaterThanOrEqual(0);
      expect(health.score).toBeLessThanOrEqual(100);
    }
  });
});
