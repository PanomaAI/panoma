import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readRunResponse } from "./run-result";

/**
 * The forms here are not made up: they come from `apps/web/app/api/runs/route.ts`, and the test
 * that compares them with the truth file is at the end. A new `Response.json` there without a new
 * form here is exactly how this bug appeared.
 */
describe("lo que contestó el servidor a una propuesta", () => {
  it("no llama éxito a un relanzamiento que el servidor se negó a hacer", () => {
    const outcome = readRunResponse(
      { ok: false, status: 409 },
      {
        skipped: true,
        knownFailure: {
          runId: "run_9",
          summary: "Los tests fallaron con react 19.2.0: 3 suites en rojo.",
          at: "2026-08-19T10:00:00.000Z",
        },
        hint: "Vuelve a intentarlo con --force si crees que algo ha cambiado.",
      },
    );
    expect(outcome.kind).toBe("known-failure");
    // And the summary that was thrown in the trash arrives whole.
    expect(outcome).toMatchObject({
      summary: "Los tests fallaron con react 19.2.0: 3 suites en rojo.",
      runId: "run_9",
      // And it can be retried: forcing it just takes time, nothing more.
      forceable: true,
    });
  });

  it("da por buena una ejecución solo si el servidor devolvió su identificador", () => {
    const outcome = readRunResponse(
      { ok: true, status: 200 },
      {
        runId: "run_10",
        status: "proposed",
        verified: true,
        summary: "Actualizado a 19.2.0 · 128 tests en verde.",
      },
    );
    expect(outcome).toEqual({
      kind: "done",
      text: "Actualizado a 19.2.0 · 128 tests en verde.",
      tone: "ok",
    });
  });

  it("un 200 sin identificador no es un éxito, es una forma que no se entiende", () => {
    // It is the safeguard against the next new field: without it, any unforeseen form would be
    // marked again as "Done.", which is the failure that this file comes to address.
    expect(readRunResponse({ ok: true, status: 200 }, {})).toEqual({
      kind: "unknown",
      status: 200,
      tone: "bad",
    });
  });

  it("pasa el error y su pista tal como los redactó el servidor", () => {
    const outcome = readRunResponse(
      { ok: false, status: 400 },
      { error: "react no es una dependencia de cabeman.", hint: "Ejecuta 'panoma enrich'." },
    );
    expect(outcome).toEqual({
      kind: "error",
      text: "react no es una dependencia de cabeman.",
      hint: "Ejecuta 'panoma enrich'.",
      status: 400,
      forceable: false,
      tone: "bad",
    });
  });

  it("un fallo sin cuerpo legible sigue siendo un fallo, con su estado", () => {
    // A 502 from a proxy does not bring JSON. Before this used to end with 'Done.' anyway.
    expect(readRunResponse({ ok: false, status: 502 }, null)).toEqual({
      kind: "error",
      text: undefined,
      hint: undefined,
      status: 502,
      forceable: false,
      tone: "bad",
    });
  });

  it("distingue los tres finales que la ruta devuelve con un 200", () => {
    /*
      Finishing does not mean succeeding. These three arrive with the same status 200 and the same
      `runId`, and they appeared in the same gray: an update that had left the tests in red was
      read the same as one that had passed them. The shades are those of CLI with these same
      responses.
     */
    const base = { runId: "run_11", summary: "…" };
    const tono = (extra: Partial<typeof base> & { status: string; verified?: boolean }) =>
      readRunResponse({ ok: true, status: 200 }, { ...base, ...extra }).tone;

    expect(tono({ status: "proposed", verified: true })).toBe("ok");
    // There were changes, but no tests to support them: proposal unverified.
    expect(tono({ status: "proposed", verified: false })).toBe("warn");
    expect(tono({ status: "failed" })).toBe("bad");
    expect(tono({ status: "no-changes" })).toBe("quiet");
    // A state that this reader does not know is not rendered green.
    expect(tono({ status: "algo-nuevo" })).toBe("quiet");
  });

  it("conoce todos los estados que el ejecutor puede devolver", () => {
    // A new state falls into gray, which does not lie but also says nothing. Better to find out
    // here and decide what color to render it, as it is a product decision and not a neglect.
    const source = readFileSync(
      new URL("../../../packages/runner/src/execute.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      'export type RunStatus = "proposed" | "failed" | "no-changes"',
    );
  });

  it("no ofrece saltarse la cuarentena con un clic, aunque la API lo aceptaría", () => {
    /*
      The API supports `force` here just like in the known failure, and even so this is not
      retried from the web. Forcing a quarantine is installing a version published twenty minutes
      ago that no one has looked at, and the notice from the server itself says: 'or right now
      with --force if you know what you're doing.' Typing it by hand into the CLI is the friction,
      and the friction is the guard.
     */
    const outcome = readRunResponse(
      { ok: false, status: 409 },
      {
        error: "react 19.2.0 se publicó hace 4 horas.",
        hint: "Vuelve a intentarlo más adelante, o ahora mismo con --force si sabes lo que haces.",
        quarantine: { publishedAt: "2026-08-20T08:00:00.000Z", days: 3 },
      } as never,
    );
    expect(outcome).toMatchObject({ kind: "error", forceable: false });
  });

  it("cubre todas las formas que la ruta puede devolver, no solo las que recordamos", () => {
    /*
      The guard of truth against the next time.
      This failure arose because someone added a new response to the route —the 409 of the known
      failure— and the button kept reading the usual two. Nobody noticed because the new form was
      read as a success. So here the forms we remember are not checked: all those in the file are
      read and each one is required to have one of the three marks that `readRunResponse` knows
      how to recognize.
      A fourth way puts this in red, which is what should have happened then.
     */
    const source = readFileSync(
      new URL("../app/api/runs/route.ts", import.meta.url),
      "utf8",
    );

    const shapes: string[] = [];
    for (let at = source.indexOf("Response.json("); at !== -1; at = source.indexOf("Response.json(", at + 1)) {
      let depth = 0;
      let end = at + "Response.json(".length - 1;
      do {
        const char = source[end]!;
        if (char === "(") depth++;
        if (char === ")") depth--;
        end++;
      } while (depth > 0 && end < source.length);
      shapes.push(source.slice(at, end));
    }

    expect(shapes.length).toBeGreaterThan(4);

    // And the one with the known error, field by field: it is the one this file came to fix, and
    // the reader relies on those four exact names.
    const known = shapes.find((shape) => /\bskipped\b/.test(shape));
    expect(known, "la ruta ya no devuelve el 409 del fallo conocido").toBeDefined();
    for (const field of ["knownFailure", "summary", "runId", "hint"]) {
      expect(known, field).toContain(field);
    }

    for (const shape of shapes) {
      const marked =
        /\berror\b/.test(shape) || /\bskipped\b/.test(shape) || /\brunId\b/.test(shape);
      expect(marked, `respuesta sin error, skipped ni runId:\n${shape}`).toBe(true);
    }
  });

  it("se niega a leer un fallo conocido al que le falta el fallo", () => {
    // `skipped` by itself says nothing; without `knownFailure` there is no summary to show, and a
    // 409 without explanation is an error like any other.
    expect(readRunResponse({ ok: false, status: 409 }, { skipped: true })).toMatchObject({
      kind: "error",
      status: 409,
    });
  });
});
