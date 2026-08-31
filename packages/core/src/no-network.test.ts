import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeProject } from "./analyze";
import { createProject } from "./test-utils/temp-project";

/**
 * “The engine doesn’t network” is the first sentence of the README and the first rule of
 * `types.ts`. Three things depend on it: that a scan of eighty projects takes fourteen seconds,
 * that the result is deterministic, and that the user’s code does not leave its disk.
 *
 * So far it was held by the discipline of not writing a `fetch`. This test verifies it **by
 * running the engine** with the network broken, instead of looking for `fetch` in the source. The
 * difference matters: a grep does not see an indirect call through a dependency, and that is
 * exactly where it would get in.
 */

const cleanups: (() => void)[] = [];

function boom(via: string) {
  return () => {
    throw new Error(`El motor intentó salir a la red vía ${via}`);
  };
}

/*
  The `vi.mock` go at the top level because vitest lifts them anyway.
  Writings inside a function seem to run in each test but actually apply once, before everything.
  Vitest warns about it and announces that it will stop allowing it; leaving it nested would be
  having a test whose execution order is not what it appears to be, which is precisely what a test
  cannot allow itself.
 */
vi.mock("node:http", () => ({ default: {}, request: boom("http.request"), get: boom("http.get") }));
vi.mock("node:https", () => ({
  default: {},
  request: boom("https.request"),
  get: boom("https.get"),
}));
vi.mock("node:dns", () => ({ default: {}, lookup: boom("dns.lookup"), promises: {} }));
vi.mock("node:net", () => ({
  default: {},
  connect: boom("net.connect"),
  Socket: boom("net.Socket"),
}));

// `fetch` is global, so this one is put on and taken off in each test.
beforeEach(() => {
  vi.stubGlobal("fetch", boom("fetch"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("analyzeProject", () => {
  it("analiza un proyecto npm completo sin tocar la red", async () => {
    const { root, cleanup } = createProject(
      {
        "package.json": JSON.stringify({
          name: "sin-red",
          version: "2.1.0",
          description: "Prueba",
          dependencies: { next: "^15.0.0", react: "^19.0.0" },
          devDependencies: { typescript: "^5.7.0" },
          scripts: { dev: "next dev", test: "vitest" },
        }),
        "package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "node_modules/next": { version: "15.1.3" },
            "node_modules/react": { version: "19.0.0" },
          },
        }),
        "README.md": "# sin-red\n\nUn proyecto para comprobar que no se sale a internet.",
        ".env": "DATABASE_URL=postgres://x\n",
        "src/index.ts": "export const x = 1;\n",
      },
      { git: true },
    );
    cleanups.push(cleanup);

    // If something inside calls the network, the corresponding `boom` launches and this fails.
    const analysis = await analyzeProject(root);

    // And that it has also done its job: an engine that gives up silently would also pass the
    // inspection from above.
    expect(analysis.name).toBe("sin-red");
    expect(analysis.version).toBe("2.1.0");
    expect(analysis.technologies.map((t) => t.id)).toContain("nextjs");
    expect(analysis.ecosystems[0]?.dependencies.length).toBeGreaterThan(0);
    expect(analysis.health.score).toBeGreaterThan(0);
    expect(analysis.git?.commitCount).toBe(1);
    expect(analysis.summary.text).toContain("no se sale a internet");
  });

  it("analiza un proyecto Flutter sin tocar la red", async () => {
    // Second ecosystem, because each parser has its own dependencies and the promise must be tested
    // in more than one path.
    const { root, cleanup } = createProject({
      "pubspec.yaml": [
        "name: flutter_sin_red",
        "description: Otra prueba",
        "environment:",
        '  sdk: ">=3.0.0 <4.0.0"',
        "dependencies:",
        "  flutter:",
        "    sdk: flutter",
        "  dio: ^5.4.0",
      ].join("\n"),
      "lib/main.dart": "void main() {}\n",
    });
    cleanups.push(cleanup);

    const analysis = await analyzeProject(root);
    expect(analysis.name).toBe("flutter_sin_red");
    expect(analysis.technologies.map((t) => t.id)).toContain("flutter");
  });

  it("el sabotaje funciona de verdad", () => {
    // Without this, a misspelled `vi.stubGlobal` would pass the two tests above without having
    // checked anything: they would not have demonstrated that the engine does not go online, but
    // that the sabotage was not set. The check is synchronous because the substitute throws instead
    // of returning a rejected promise, and writing it as `rejects` made this test fail for the
    // wrong reason.
    expect(() => fetch("https://registry.npmjs.org/next")).toThrow(/vía fetch/);
  });
});
