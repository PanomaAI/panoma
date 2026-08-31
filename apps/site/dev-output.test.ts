import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * That no Next application compiles in the same directory from which it serves.
 *
 * `next build` and `next dev`, both writing in `.next`, is a trap with a symptom that does not
 * resemble its cause: compiling with the live development server replaces the pieces under your
 * feet, the webpack cache still points to the previous ones, and the page crashes with
 * `__webpack_modules__[moduleId] is not a function` or `Cannot find module './3267.js'`. The error
 * talks about webpack and does not say anywhere that there were two compilations, so you look in
 * the code and it is not there.
 *
 * `apps/web` paid it five times in one session and set the line. `apps/site` was born copying that
 * configuration **without that line**, and paid it again on the first try. Two applications, the
 * same failure, and between them only a comment that needed to be remembered to read — so now we
 * have this.
 *
 * The **disk** applications are listed and not a handwritten list: the third one that appears
 * enters monitoring for existence, which is exactly what the second one lacked.
 */
describe("cada Next compila fuera de donde sirve", () => {
  const apps = new URL("../", import.meta.url);

  const conNext = readdirSync(apps, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => ({
      nombre: entrada.name,
      config: new URL(`./${entrada.name}/next.config.ts`, apps),
    }))
    .filter(({ config }) => existsSync(config));

  it("hay aplicaciones de Next que vigilar", () => {
    /*
      Two today —`web` and `site` —; the day there is only one, this check warns that the sweep
      stopped looking where it thought.
     */
    expect(conNext.length).toBeGreaterThanOrEqual(2);
  });

  it.each(conNext)("$nombre separa la salida de desarrollo de la de producción", ({ config }) => {
    const fuente = readFileSync(config, "utf8");

    /*
      The file is read instead of imported because `next.config.ts` is TypeScript with Next
      imports inside, and setting that up in vitest to read a string would cost more than what it
      tests. What is stated is that the line **is written**, which is exactly what was missing.
     */
    expect(fuente, `${config.pathname} no declara distDir`).toContain("distDir:");

    /*
      And that it really distributes: a fixed `distDir` would pass the `toContain` from above and
      leave the failure intact. It has to name both directories.
     */
    expect(fuente).toMatch(/distDir:[^\n]*"\.next-dev"[^\n]*"\.next"/);
  });
});
