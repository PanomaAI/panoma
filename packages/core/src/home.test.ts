import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { panomaHome, panomaPath } from "./home";

const original = process.env["PANOMA_HOME"];

/*
  Test routes are built, not written.
  A `/tmp/panoma-uno` literal is an absolute path in two of the three systems where this runs. In
  Windows `resolve` it anchors to the current drive and returns `D:\tmp\panoma-uno`, which is
  exactly what it has to return — the one that was wrong was the test. With `resolve` on both
  sides, what was wanted to be checked is verified: that the value comes from the environment on
  each call, and not from a constant frozen in the `import`.
 */
const UNO = resolve(tmpdir(), "panoma-uno");
const DOS = resolve(tmpdir(), "panoma-dos");

afterEach(() => {
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
});

describe("dónde vive Panoma", () => {
  it("sin variable, bajo el home del usuario", () => {
    delete process.env["PANOMA_HOME"];
    expect(panomaHome()).toBe(join(homedir(), ".panoma"));
  });

  /*
    The raison d'être of the entire file. With a module constant, this test could not exist: the
    value would be fixed in `import`, before any test could touch the environment. Having it
    resolved on each call is what makes the variable usable — for tests, for a test catalog, and
    to have two separate catalogs.
   */
  it("se resuelve en cada llamada, no al importar el módulo", () => {
    process.env["PANOMA_HOME"] = UNO;
    expect(panomaHome()).toBe(UNO);
    process.env["PANOMA_HOME"] = DOS;
    expect(panomaHome()).toBe(DOS);
  });

  it("una variable vacía es lo mismo que ninguna", () => {
    // `export PANOMA_HOME=` leaves an empty string. Treating it as a path would write the
    // repository, the keys, and the worktrees at the root of the disk.
    process.env["PANOMA_HOME"] = "";
    expect(panomaHome()).toBe(join(homedir(), ".panoma"));
    process.env["PANOMA_HOME"] = "   ";
    expect(panomaHome()).toBe(join(homedir(), ".panoma"));
  });

  it("expande la tilde, que el shell no expande entre comillas", () => {
    process.env["PANOMA_HOME"] = "~/panoma-pruebas";
    expect(panomaHome()).toBe(join(homedir(), "panoma-pruebas"));
    process.env["PANOMA_HOME"] = "~";
    expect(panomaHome()).toBe(homedir());
  });

  it("devuelve siempre una ruta absoluta", () => {
    process.env["PANOMA_HOME"] = "relativa";
    expect(panomaHome()).toBe(join(process.cwd(), "relativa"));
  });

  it("las tres cosas que guarda cuelgan del mismo sitio", () => {
    // Moving the catalog and leaving the keys where they were leaves half Panoma on each side.
    process.env["PANOMA_HOME"] = UNO;
    expect(panomaPath("db")).toBe(join(UNO, "db"));
    expect(panomaPath("ai.json")).toBe(join(UNO, "ai.json"));
    expect(panomaPath("work")).toBe(join(UNO, "work"));
  });
});
