import { describe, expect, it } from "vitest";
import { findIcon } from "./icon";
import type { FileIndex } from "./types";

/**
 * The catalog icon, chosen from all the images of a project.
 *
 * It is the part of the detector that is most noticeable when it fails: a card without a logo in a
 * grid where the others have it is read as a second-rate project, and the logo is almost always on
 * the disc — only not where the pattern was looking for it.
 */

/** A lie index: `findIcon` only needs the list of routes to choose from. */
function index(files: string[]): FileIndex {
  return {
    root: "/proyecto-de-prueba",
    files,
    fileSet: new Set(files),
    dirSet: new Set(),
    sizes: new Map(),
    truncated: false,
  };
}

describe("el caso que lo trajo", () => {
  it("encuentra el logo con el nombre del producto en la carpeta de imágenes", async () => {
    // Travocato saves its logo in `frontend/img/travocato-logo.png`: it is neither called
    // `logo.png` nor does it live in `assets`, so the catalog showed it without an icon even though
    // it had a good one.
    const found = await findIcon(
      index([
        "README.md",
        "frontend/img/travocato-logo.png",
        "frontend/img/travocato-email-logo.png",
        "academy-design-reference.png",
        "edge-mine-after-route.png",
      ]),
    );
    expect(found?.path).toBe("frontend/img/travocato-logo.png");
  });

  it("las capturas y las referencias de diseño no son el logo", async () => {
    const found = await findIcon(
      index(["academy-design-reference.png", "edge-mine-qa-hero-comparison.png", "l1.PNG"]),
    );
    expect(found).toBeUndefined();
  });
});

describe("el orden entre candidatos no cambia", () => {
  it("un icono declarado de la app gana a una imagen que se llame logo", async () => {
    // The one from Android is the one that the operating system shows: it rules over any other.
    const found = await findIcon(
      index([
        "img/mi-logo.png",
        "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png",
      ]),
    );
    expect(found?.path).toBe("android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png");
  });

  it("entre dos con «logo» dentro gana el nombre más corto, que es el canónico", async () => {
    const found = await findIcon(
      index(["img/travocato-email-logo.png", "img/travocato-logo.png"]),
    );
    expect(found?.path).toBe("img/travocato-logo.png");
  });

  it("sigue valiendo el `logo.png` de toda la vida en la raíz", async () => {
    const found = await findIcon(index(["logo.png", "src/main.ts"]));
    expect(found?.path).toBe("logo.png");
  });
});

describe("las carpetas de imágenes que se aceptan", () => {
  it.each(["img", "images", "imagenes", "assets", "public", "static", "www", "media"])(
    "%s/",
    async (folder) => {
      const found = await findIcon(index([`${folder}/mi-app-logo.svg`]));
      expect(found?.path).toBe(`${folder}/mi-app-logo.svg`);
    },
  );

  it("pero no cualquier carpeta: una imagen suelta en `docs/capturas` no es el logo", async () => {
    expect(await findIcon(index(["docs/capturas/pantalla-logo.png"]))).toBeUndefined();
  });
});
