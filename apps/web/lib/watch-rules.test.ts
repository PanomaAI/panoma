import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isGitSignal,
  isRootSignal,
  parentsOf,
  couldBeNewProject,
  catalogFailure,
} from "./watch-rules";

describe("señales de re-análisis", () => {
  it("disparan los ficheros que cambian lo que el catálogo afirma", () => {
    expect(isRootSignal("package.json")).toBe(true);
    expect(isRootSignal("pubspec.lock")).toBe(true);
    expect(isRootSignal(".env.example")).toBe(true);
    expect(isGitSignal("HEAD")).toBe(true);
  });

  it("no dispara el ruido de un dev server ni el código fuente", () => {
    expect(isRootSignal("index.ts")).toBe(false);
    expect(isRootSignal("README.md")).toBe(false);
    expect(isRootSignal("next.config.ts")).toBe(false);
    expect(isGitSignal("ORIG_HEAD")).toBe(false);
  });
});

describe("nacimientos", () => {
  it("descarta lo que aparece junto a un proyecto y nunca es uno", () => {
    expect(couldBeNewProject("node_modules")).toBe(false);
    expect(couldBeNewProject(".DS_Store")).toBe(false);
    expect(couldBeNewProject(".git")).toBe(false);
    expect(couldBeNewProject("dist")).toBe(false);
  });

  it("acepta un nombre de proyecto cualquiera", () => {
    expect(couldBeNewProject("mi-app-nueva")).toBe(true);
    expect(couldBeNewProject("chatbot_new copy 3")).toBe(true);
  });
});

describe("padres a vigilar", () => {
  it("son los directorios donde nacería el siguiente proyecto", () => {
    const parents = parentsOf(["/d/uno", "/d/dos", "/d/contenedor/hijo"]);
    expect(parents).toContain("/d");
    expect(parents).toContain("/d/contenedor");
    expect(parents).toHaveLength(2);
  });

  it("no duplica y no revienta con la raíz del disco", () => {
    expect(parentsOf(["/a", "/a"])).toEqual(["/"]);
    expect(parentsOf([])).toEqual([]);
  });
});

describe("cuando el catálogo no abre, se cuenta con hechos", () => {
  const RUTA = "/Users/x/.panoma/db";

  /*
    What comes from PGlite when the data directory is broken is a paragraph with the WASM stack
    inside. It doesn't fit on a warning strip, and it tells nobody anything; the first line does.
   */
  it("se queda con la primera línea del error y tira el resto", () => {
    const error = new Error(
      "Aborted(). Build with -sASSERTIONS for more info.\n    at abort (wasm)\n    at openDatabase",
    );
    expect(catalogFailure(error, RUTA)).toEqual({
      open: false,
      detail: "Aborted(). Build with -sASSERTIONS for more info.",
      path: RUTA,
    });
  });

  it("salta las líneas en blanco de delante", () => {
    expect(catalogFailure(new Error("\n\n  PANIC: could not locate a valid checkpoint record  "), RUTA).detail).toBe(
      "PANIC: could not locate a valid checkpoint record",
    );
  });

  it("recorta lo larguísimo con puntos suspensivos", () => {
    const largo = "x".repeat(400);
    const { detail } = catalogFailure(new Error(largo), RUTA);
    expect(detail).toHaveLength(200);
    expect(detail.endsWith("…")).toBe(true);
  });

  // What is thrown is not always an Error, and 'undefined' in the panel is not a cause.
  it("no deja el detalle vacío aunque no le den un Error", () => {
    expect(catalogFailure(undefined, RUTA).detail).toBe("sin detalle");
    expect(catalogFailure("se fue la luz", RUTA).detail).toBe("se fue la luz");
  });

  it("lleva siempre la ruta, que es la mitad accionable del mensaje", () => {
    expect(catalogFailure(new Error("x"), RUTA).path).toBe(RUTA);
  });
});

import { forgetMounts } from "./watch-rules";

describe("lo que un rearme olvida", () => {
  it("vacía los tres conjuntos de «ya montado», buzones incluidos", () => {
    /*
      The bug that this nails: the rearming emptied projects and parents by hand and forgot about
      the mailboxes, so `watchShots` was seen 'mounted' on dead descriptors and the visual critic
      went blind until the server was restarted.
     */
    const mounted = {
      watchedProjects: new Set(["/d/uno"]),
      watchedParents: new Set(["/d"]),
      watchedShots: new Set(["/d/uno"]),
    };
    forgetMounts(mounted);
    expect(mounted.watchedProjects.size).toBe(0);
    expect(mounted.watchedParents.size).toBe(0);
    expect(mounted.watchedShots.size).toBe(0);
  });

  it("y el rearme del latido lo usa, en vez de vaciar a mano y olvidarse de uno", () => {
    const source = readFileSync(new URL("./watch.ts", import.meta.url), "utf8");
    const rearme = source.slice(
      source.indexOf("rearmando"),
      source.indexOf("void startWatcher()"),
    );
    expect(rearme, "el rearme ya no pasa por forgetMounts").toContain("forgetMounts(");
    expect(rearme, "ha vuelto el vaciado a mano que dejó ciegos los buzones").not.toContain(
      ".clear()",
    );
  });
});
