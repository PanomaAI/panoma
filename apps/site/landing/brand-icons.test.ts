import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRAND_ICONS } from "./brand-icons";

/**
 * Let no agent of the landing be without their brand.
 *
 * The map here has three entries —Claude Code, Codex, and Cursor— and not the seventeen of
 * `apps/web/components/brand-icons.ts`, because public site does not open editors: it only draws
 * those three in the memory scene and in the row of agents. Three copied entries are what prevent
 * `apps/site` from depending on `apps/web`.
 *
 * The risk of cropping is that the crop falls short without warning: `landing-experience.tsx`
 * paints `BRAND_ICONS[agent.id] ?? PiRobotBold`, so a new agent without a mark doesn't break
 * anything — a generic robot appears among three real logos, and only those who look at the page
 * see that. You can see it here before.
 *
 * The file is read instead of imported because `landing-experience.tsx` is a two thousand seven
 * hundred line client component with CSS modules hanging off it: importing it from vitest would
 * require setting up half of Next to read a list of three strings.
 */
describe("las marcas de los agentes de la landing", () => {
  const fuente = readFileSync(new URL("./landing-experience.tsx", import.meta.url), "utf8");

  const bloque = /const LANDING_AGENTS = \[([\s\S]*?)\] as const;/.exec(fuente);
  const ids = [...(bloque?.[1] ?? "").matchAll(/id: "([^"]+)"/g)].map((m) => m[1]);

  it("la lista de agentes se sigue leyendo, o este test no vigila nada", () => {
    expect(bloque).not.toBeNull();
    expect(ids.length).toBeGreaterThan(0);
  });

  it("todos tienen logotipo, sin caer en el robot de reserva", () => {
    expect(ids.filter((id) => !(id! in BRAND_ICONS))).toEqual([]);
  });

  it("y no sobra ninguno: lo que no pinta la landing no viaja", () => {
    expect(Object.keys(BRAND_ICONS).filter((id) => !ids.includes(id)).sort()).toEqual([]);
  });
});
