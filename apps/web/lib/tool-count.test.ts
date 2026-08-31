import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { t } from "./i18n";

/**
 * The number of tools an agent gets, said out loud on two screens.
 *
 * The MCP screen promised «the six tools» and the bridge, two clicks away, promised nine. Nine is
 * the true one. Nobody was harmed by a screen that undersells, but it is the same failure this
 * release keeps finding: a figure written by hand in prose, next to a list that grew without it.
 *
 * So the count is read from the source that decides it — one `registerTool` per tool — and the
 * sentences have to agree with it. In words and not in digits, because that is how the copy says
 * it and the house rule keeps a number from being glued to an inflected word.
 */
describe("las dos pantallas cuentan las mismas herramientas", () => {
  const server = readFileSync(
    new URL("../../../packages/mcp/src/index.ts", import.meta.url),
    "utf8",
  );

  const REAL = server.match(/server\.registerTool\(/g)?.length ?? 0;

  /** As far as anyone will plausibly write it. Beyond that, the test says so rather than passing. */
  const WORDS: Record<number, { es: string; en: string }> = {
    5: { es: "cinco", en: "five" },
    6: { es: "seis", en: "six" },
    7: { es: "siete", en: "seven" },
    8: { es: "ocho", en: "eight" },
    9: { es: "nueve", en: "nine" },
    10: { es: "diez", en: "ten" },
    11: { es: "once", en: "eleven" },
    12: { es: "doce", en: "twelve" },
  };

  /** Where the figure is written down. Both, because they disagreed. */
  const CLAIMS = ["connect.lead", "bridge.step.agent.pending"] as const;

  it("el servidor MCP registra herramientas y se pueden contar", () => {
    expect(REAL, "no `registerTool` in packages/mcp/src/index.ts — has it been renamed?").toBeGreaterThan(0);
    expect(WORDS[REAL], `${REAL} tools and no word written for that number`).toBeDefined();
  });

  for (const key of CLAIMS) {
    it(`${key} dice el número que hay`, () => {
      const word = WORDS[REAL]!;
      expect(
        t("es", key),
        `dice otra cifra: el servidor registra ${REAL} herramientas`,
      ).toContain(`${word.es} herramientas`);
      expect(
        t("en", key),
        `says another figure: the server registers ${REAL} tools`,
      ).toContain(`${word.en} tools`);
    });
  }
});
