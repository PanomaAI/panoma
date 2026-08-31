import { describe, expect, it } from "vitest";
import { summarize, type DependencyRow } from "./refresh";

/**
 * Two rules that look alike and are not the same, and confusing them already cost once.
 *
 * “Delayed direct messages” counts only the direct messages: it is what the column name says and
 * what the card states out loud. Safety warnings count **all** of them, because a vulnerability in
 * a dependency that drags another affects you exactly the same way and nobody chose it anyway.
 *
 * The arrangement of the first number was written as a `continue` at the beginning of the loop,
 * and with that it turned off the second: the notices of the hints stopped being counted, and with
 * them the health penalty that hangs from the count. Nothing gave it away — the number just went
 * down — and no test looked at this function, which until this file could not be called from
 * outside.
 *
 * Only Go marks it, which is the only ecosystem whose reader distinguishes the `// indirect`; in
 * the rest everything goes in as direct and both rules are the same.
 */

function dep(patch: Partial<DependencyRow> = {}): DependencyRow {
  return {
    projectId: "p1",
    resolvedVersion: "1.0.0",
    isDev: false,
    isDirect: true,
    latestVersion: "2.0.0",
    packageId: "pkg-uno",
    ...patch,
  };
}

describe("los números de las dependencias de un proyecto", () => {
  it("una indirecta atrasada no cuenta como directa atrasada", () => {
    const summary = summarize([dep(), dep({ packageId: "pkg-dos", isDirect: false })], new Map());

    expect(summary.get("p1")?.direct, "solo la directa").toBe(1);
    expect(summary.get("p1")?.outdated).toBe(1);
  });

  it("pero su vulnerabilidad sí cuenta: el aviso no distingue quién la trajo", () => {
    const summary = summarize(
      [dep({ packageId: "pkg-dos", isDirect: false })],
      new Map([["pkg-dos@1.0.0", ["critical"]]]),
    );

    expect(summary.get("p1")?.direct, "no es directa").toBe(0);
    expect(summary.get("p1")?.vulns, "y aun así el aviso cuenta").toBe(1);
    expect(summary.get("p1")?.critical).toBe(1);
  });

  it("las de desarrollo no cuentan para nada, ni siquiera sus avisos", () => {
    const summary = summarize([dep({ isDev: true })], new Map([["pkg-uno@1.0.0", ["high"]]]));

    expect(summary.get("p1"), "un proyecto sin nada que contar no llega a la tabla").toBeUndefined();
  });

  it("una directa sin versión fijada no se cuenta como al día: se cuenta como que no se sabe", () => {
    const summary = summarize([dep({ resolvedVersion: null })], new Map());

    expect(summary.get("p1")?.unknown).toBe(1);
    expect(summary.get("p1")?.direct).toBe(0);
    expect(summary.get("p1")?.outdated).toBe(0);
  });

  it("y un salto de mayor se cuenta además aparte", () => {
    const summary = summarize(
      [dep({ resolvedVersion: "1.0.0", latestVersion: "2.0.0" }), dep({ packageId: "b", resolvedVersion: "1.0.0", latestVersion: "1.4.0" })],
      new Map(),
    );

    expect(summary.get("p1")?.outdated).toBe(2);
    expect(summary.get("p1")?.major, "solo el que cambia de mayor").toBe(1);
  });
});
