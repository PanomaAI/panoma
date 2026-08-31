import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RootRejectedError, addRoot, cleanRoot, rejectionReason, normalize, watchedRoots } from "./roots";

/*
  The expected routes are built with `resolve`, they are not written by hand.
  `normalize` normalizes —that's what it's for—, and normalizing in Windows converts `/a/b` into
  `D:\a\b`. Writing `"/a/b"` on the expected side did not test that the list was cleaned properly:
  it tested that the operating system was POSIX. Already normalized paths are compared against
  already normalized paths, and the test says the same on all three systems.
 */
const r = (...paths: string[]): string[] => paths.map((path) => resolve(path));

/**
 * The list of monitored sites has two ways to go wrong, and neither gives a warning:
 *
 * - **Overlapping.** With `~/Documents` and `~/Documents/trad89` at the same time, each change
 * triggers twice and the same project is analyzed twice for nothing.
 * - **Too wide.** Watching the entire personal folder throws in `Library` —tens of thousands of
 * application folders— and turns each startup into a sweep of minutes to find the same thing that
 * two specific folders find.
 */

describe("normalizar la lista", () => {
  it("quita las que ya cubre otra de la lista", () => {
    expect(normalize(["/a/b", "/a", "/a/b/c"])).toEqual(r("/a"));
  });

  it("respeta las hermanas: cubrir no es empezar igual", () => {
    // `/a/bc` does NOT hang from `/a/b` even though its text starts the same. Comparing by string
    // without the separator would swallow legitimate folders.
    expect(normalize(["/a/b", "/a/bc"])).toEqual(r("/a/b", "/a/bc"));
  });

  it("no repite ni deja barras finales", () => {
    expect(normalize(["/a/b/", "/a/b", "/a/b//"])).toEqual(r("/a/b"));
  });

  it("devuelve rutas absolutas y ordenadas", () => {
    const output = normalize(["/z/uno", "/a/dos"]);
    expect(output).toEqual(r("/a/dos", "/z/uno"));
    // `startsWith("/")` was the same as asking if the system is POSIX.
    for (const path of output) expect(isAbsolute(path), path).toBe(true);
  });

  it("una lista vacía no revienta", () => {
    expect(normalize([])).toEqual([]);
  });
});

describe("qué no se vigila ni aunque lo pidan", () => {
  it("la carpeta personal entera, no", () => {
    expect(rejectionReason(homedir())?.code).toBe("home");
  });

  /*
    The tilde opens before checking. It is the error that was missing: the form placeholder shows
    «~/Documents» and the list itself shortens to «~/…», so typing what the screen shows failed
    with «it is not a folder that exists». That `~` by itself being recognized as the personal
    folder tests the entire expansion.
   */
  it("la virgulilla es la carpeta personal, no un nombre raro bajo el cwd", () => {
    expect(rejectionReason("~")?.code).toBe("home");
    expect(cleanRoot("~/Documents")).toBe(join(homedir(), "Documents"));
  });

  it("Library tampoco: ahí no hay proyectos tuyos", () => {
    expect(rejectionReason(join(homedir(), "Library"))).toBeTruthy();
    expect(rejectionReason(join(homedir(), "Library", "Caches"))).toBeTruthy();
  });

  it("ni la raíz del disco ni los directorios del sistema", () => {
    /*
      Each system has its own, and the macOS list does not protect anyone on Windows: there, what
      must be rejected is the system drive and what hangs from it. You test what the system in
      which the test runs actually rejects, not what another would reject.
     */
    const system =
      process.platform === "win32"
        ? [
            resolve(process.env["SystemRoot"] ?? "C:\\Windows", ".."),
            process.env["SystemRoot"] ?? "C:\\Windows",
            join(resolve(process.env["SystemRoot"] ?? "C:\\Windows", ".."), "Program Files"),
          ]
        : ["/", "/usr", "/etc", ...(process.platform === "darwin" ? ["/System", "/Applications"] : [])];

    for (const path of system) {
      expect(rejectionReason(path), path).toBeTruthy();
    }
  });

  it("pero las carpetas normales de trabajo sí", () => {
    for (const name of ["Documents", "Desktop", "Developer", "code"]) {
      expect(rejectionReason(join(homedir(), name)), name).toBeNull();
    }
  });

  it("una carpeta cuyo nombre empieza por «Library» no es Library", () => {
    /*
      The case that exposes the failure of comparing prefixes as text: `~/LibraryDeFotos` **does**
      start with the string `~/Library`, so without requiring the separator it would be rejected
      without reason. Be careful when choosing the example: `~/Libraries` is not suitable for this
      because it differs in the seventh letter and is not a prefix of anything.
     */
    expect(rejectionReason(join(homedir(), "LibraryDeFotos"))).toBeNull();
    expect(rejectionReason(join(homedir(), "Library"))).toBeTruthy();
    expect(rejectionReason(join(homedir(), "Library", "Caches"))).toBeTruthy();
  });
});

/**
 * When transferring the project to English, this file went from `raices.json` with key `raices` to
 * `roots.json` with key `roots`. Without transfer, someone who was already using Panoma would open
 * the catalog and find that they have stopped monitoring their folders — without error and without
 * notice, which is the worst way to lose a preference. This test is what prevents that from
 * happening again.
 */
describe("añadir una carpeta que ya está dentro de otra vigilada", () => {
  /*
    The collapse of nested ones is correct —watching the parent covers the child— but it was
    **mute**, and that muteness had consequences measured by the whole gesture: adding
    `escritorio/proyectos` while having `escritorio` replied "found: 2" and left the list
    unchanged; whoever thought they had put it in would then remove the outer one and also lose
    the inner ones.
    Now it is rejected and the one that already covers it is appointed, which is the information
    needed to decide: to look only at the one inside you have to remove the one outside first.
    Which of the two it wants cannot be guessed.
    The folders are actually created because `addRoot` checks beforehand that they exist: with
    made-up paths this test would go through 'not a folder' and would not get to test anything.
   */
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "panoma-anidadas-"));
    process.env["PANOMA_HOME"] = home;
  });

  afterEach(async () => {
    delete process.env["PANOMA_HOME"];
    await rm(home, { recursive: true, force: true });
  });

  it("se rechaza, y el motivo dice cuál la cubre", async () => {
    const fuera = join(home, "escritorio");
    const dentro = join(fuera, "proyectos");
    await mkdir(dentro, { recursive: true });
    await writeFile(join(home, "roots.json"), JSON.stringify({ roots: [fuera] }));

    const error = await addRoot(dentro, []).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RootRejectedError);
    const { rejection } = error as RootRejectedError;
    expect(rejection.code).toBe("covered");
    expect(rejection).toHaveProperty("covering", resolve(fuera));
  });

  it("y la lista no cambia: lo rechazado no se guarda a medias", async () => {
    const fuera = join(home, "escritorio");
    const dentro = join(fuera, "proyectos");
    await mkdir(dentro, { recursive: true });
    await writeFile(join(home, "roots.json"), JSON.stringify({ roots: [fuera] }));

    await addRoot(dentro, []).catch(() => undefined);

    expect(await watchedRoots([])).toEqual(r(fuera));
  });

  /*
    The other way around is accepted: adding the outer one absorbs the inner one, which is what
    `normalize` already did and it is still correct — monitoring the father covers the child.
   */
  it("pero la de fuera sí entra, y se lleva por delante a la de dentro", async () => {
    const fuera = join(home, "escritorio");
    const dentro = join(fuera, "proyectos");
    await mkdir(dentro, { recursive: true });
    await writeFile(join(home, "roots.json"), JSON.stringify({ roots: [dentro] }));

    expect(await addRoot(fuera, [])).toEqual(r(fuera));
  });
});

describe("el fichero heredado", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "panoma-roots-"));
    process.env["PANOMA_HOME"] = home;
  });

  afterEach(async () => {
    delete process.env["PANOMA_HOME"];
    await rm(home, { recursive: true, force: true });
  });

  it("recoge las raíces del nombre viejo y las deja en el nuevo", async () => {
    await writeFile(join(home, "raices.json"), JSON.stringify({ raices: ["/a", "/b"] }));

    expect(await watchedRoots([])).toEqual(r("/a", "/b"));

    // The file is copied as is, without normalizing: the one who normalizes is the reading, and
    // doing it here as well would write paths from this machine to disk for a list that might have
    // been written on another.
    const moved = JSON.parse(await readFile(join(home, "roots.json"), "utf8"));
    expect(moved.roots).toEqual(["/a", "/b"]);
  });

  it("el nombre nuevo manda cuando están los dos", async () => {
    await writeFile(join(home, "raices.json"), JSON.stringify({ raices: ["/viejo"] }));
    await writeFile(join(home, "roots.json"), JSON.stringify({ roots: ["/nuevo"] }));

    expect(await watchedRoots([])).toEqual(r("/nuevo"));
  });
});
