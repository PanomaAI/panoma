import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * That the 404 has its two doors while the root layout lives inside a group.
 *
 * The bug that anchors this test took weeks to appear and no one caught it: with a root layout per
 * group, the route that Next generates for the not found case ends up with none, and since Next
 * 15.5 the development server responds with 500 —with a compilation error message— to any unknown
 * address. The production build succeeds, so no release turned red: the bug was only seen by the
 * developer.
 *
 * The disc is read and not a handwritten list: a third group with its layout enters the
 * surveillance for existing.
 */
describe("el 404 tiene puerta para cada entrada", () => {
  const appDir = new URL("./", import.meta.url);
  const grupos = readdirSync(appDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("(") && e.name.endsWith(")"))
    .filter((e) => {
      const layout = readdirSync(new URL(`./${e.name}/`, appDir));
      return layout.includes("layout.tsx");
    });

  /*
    The premise was measured by counting root layouts — 'more than one' — because there were two:
    that of `(app)` and that of `(site)`. Since public site went to `apps/site`, only one remains
    here, and with that count this test would have turned red implying that something was extra.
    It is not superfluous: the condition that leaves the route `/_not-found` without an overlay
    was never 'there are two', but 'there is none in layer zero', and that remains true with a
    single layout placed inside a group. So what is stated is what actually triggers the failure:
    there is at least one root layout in a group, and `app/layout.tsx` does not exist. The day
    someone removes the layout from the group, the two lower halves will no longer be needed, and
    this test indicates that.
   */
  it("el layout raíz vive dentro de un grupo, que es lo que deja sin sobre a /_not-found", () => {
    expect(grupos.length).toBeGreaterThan(0);
    expect(existsSync(new URL("./layout.tsx", appDir))).toBe(false);
  });

  it("existe la puerta global y trae su propio <html>", () => {
    const global = readFileSync(new URL("./global-not-found.tsx", appDir), "utf8");
    expect(global).toContain("<html");
    expect(global).toContain("<body");
    expect(global).toContain("NotFoundView");
  });

  it("la puerta de los notFound() no repite el sobre ni el visual", () => {
    const local = readFileSync(new URL("./not-found.tsx", appDir), "utf8");
    expect(local).toContain("NotFoundView");
    /*
      Without the comments, which here talk about the envelope precisely to say that it doesn't
      go. This test caught itself the first time by reading its own explanation.
     */
    const codigo = local.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    /* The group's root layout has already set the `<html>`; setting it again nests it. */
    expect(codigo).not.toContain("<html");
  });

  it("el interruptor que hace mirar la puerta global está puesto", () => {
    const config = readFileSync(new URL("../next.config.ts", appDir), "utf8");
    expect(config).toMatch(/experimental:\s*\{[^}]*globalNotFound:\s*true/);
  });

  /*
    And the Next version is spot on, without `^`.
    The 500 above was not brought by any commit: it was brought by a version jump that nobody
    asked for. The manifest said `^15.1.3`, the interpolation resolved 15.5.23, and the behavior
    change came with it. A `package.json` does not support comments, so the reason why there is no
    range here lives in this test.
   */
  it("la versión de Next está fijada, que es lo que dejó entrar el fallo", () => {
    const manifiesto = JSON.parse(
      readFileSync(new URL("../package.json", appDir), "utf8"),
    ) as { dependencies: Record<string, string> };

    expect(manifiesto.dependencies["next"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
