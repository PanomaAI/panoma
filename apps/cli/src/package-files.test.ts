import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * What actually goes into the tarball, which is not the same as what is in the folder.
 *
 * `files` is a **whitelist**: npm puts `package.json`, README, and the license on its own, and
 * from there on only what is named travels. The rest stays on the disk without anything turning
 * red — the package is built, published, and installed the same, and what is missing is missed on
 * another machine.
 *
 * It already happened, and with the file worse: `npm-shrinkwrap.json` had been out from the
 * beginning. `check-package.mjs` checked it with a magnifying glass in every `pack` — noting the
 * five dependencies, and with the versions that pnpm resolved — and then npm left it behind.
 * Measured on 28-Aug-2026 with npm 11.19.0 in a three-file package made separately: with `files`
 * that does not name it, the tarball comes out without it; naming it, it goes in.
 *
 * The consequence was precisely what that guardian exists to prevent: the five dependencies of
 * manifest being resolved with `^` on the day someone installs, that is, a compromised release of
 * `yaml` or SDK from Anthropic landing in each new installation. The promise of the package is
 * 'everything inside and no network afterward'; that 2% broke it.
 */
describe("lo que viaja en el paquete", () => {
  const manifiesto = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { files: string[] };

  it("el shrinkwrap está en la lista blanca", () => {
    expect(manifiesto.files).toContain("npm-shrinkwrap.json");
  });

  /*
    And the other three, so that this test counts for the entire list and not just for one entry:
    the CLI, the catalog that is served, and the license notices without which distributing 117
    third-party packages is not legal.
   */
  it("y con él, las cuatro entradas que hacen el paquete", () => {
    expect(manifiesto.files.slice().sort()).toEqual([
      "THIRD-PARTY-NOTICES.md",
      "app",
      "dist",
      "npm-shrinkwrap.json",
    ]);
  });

  /*
    The guardian of `prepack` checks the same thing from the other side, and this line is what
    prevents it from getting lost in a cleanup: a correct `files` without anyone watching it
    twists again the day a new entry is added.
   */
  it("y el guardián de prepack lo vigila también", () => {
    const guardian = readFileSync(new URL("../scripts/check-package.mjs", import.meta.url), "utf8");
    expect(guardian).toMatch(/manifiesto\.files \?\? \[\]\)\.includes\("npm-shrinkwrap\.json"\)/);
  });
});
