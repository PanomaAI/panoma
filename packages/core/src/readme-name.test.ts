import { describe, expect, it } from "vitest";
import { qualifyWithParent, readmeName } from "./readme-name";

/**
 * The real case, and those that should not be broken to fix it.
 *
 * Changing what a project is called is not cosmetic: the name goes to the slug, to the URL, and to
 * the search. That is why the function is suspicious, and that is why half of these tests check
 * that it **does not** return anything.
 */

describe("el caso que lo trajo", () => {
  it("saca «Ledgerly» de una carpeta llamada quiet_mark", () => {
    const readme =
      "# Ledgerly — the honest backtester for trading strategies\n\n" +
      "Paste a guru's video URL or a strategy description.";
    expect(readmeName(readme, "quiet_mark")).toBe("Ledgerly");
  });
});

describe("los separadores que se usan de verdad", () => {
  it.each([
    ["# Panoma — el App Store de tus proyectos", "Panoma"],
    ["# Panoma – el App Store", "Panoma"],
    ["# Panoma - el App Store", "Panoma"],
    ["# Panoma: el App Store", "Panoma"],
    ["# Panoma | el App Store", "Panoma"],
  ])("%s → %s", (readme, expected) => {
    expect(readmeName(readme, "folder")).toBe(expected);
  });

  it("no parte por un guion que es parte del nombre", () => {
    // Without requiring spaces around, 'quiet-mark' would be cut into 'humo'.
    expect(readmeName("# quiet-mark", "otra")).toBe("quiet-mark");
    expect(readmeName("# create-react-app", "otra")).toBe("create-react-app");
  });
});

describe("los adornos del título", () => {
  it("se queda con el texto del enlace, no con la URL", () => {
    expect(readmeName("# [Panoma](https://panoma.ai)", "x")).toBe("Panoma");
  });

  it("descarta el logo que va delante del nombre", () => {
    expect(readmeName("# ![logo](logo.png) Panoma", "x")).toBe("Panoma");
  });

  it("quita énfasis, emojis y comillas", () => {
    expect(readmeName("# **Panoma**", "x")).toBe("Panoma");
    expect(readmeName("# 🚀 Panoma", "x")).toBe("Panoma");
    expect(readmeName('# "Panoma"', "x")).toBe("Panoma");
  });

  it("salta las insignias de CI que abren casi todos los READMEs", () => {
    const readme = "[![build](a.svg)](b)\n[![cover](c.svg)](d)\n\n# Panoma\n\nTexto.";
    expect(readmeName(readme, "x")).toBe("Panoma");
  });

  it("entiende el título subrayado con iguales", () => {
    expect(readmeName("Panoma\n======\n\nTexto.", "x")).toBe("Panoma");
  });

  it("se salta la portada de metadatos si la trae", () => {
    expect(readmeName("---\ntitle: otra cosa\n---\n\n# Panoma\n", "x")).toBe("Panoma");
  });
});

describe("cuándo NO se devuelve nada, que es lo que protege el catálogo", () => {
  it("títulos de plantilla", () => {
    for (const title of ["# Getting Started", "# README", "# Documentation", "# TODO", "# App"]) {
      expect(readmeName(title, "mi-carpeta"), title).toBeUndefined();
    }
  });

  it("cuando dice lo mismo que la carpeta", () => {
    // Not with another box nor with another divider: it adds nothing and would only give work to
    // the slug.
    expect(readmeName("# kiosk_new", "kiosk_new")).toBeUndefined();
    expect(readmeName("# Kiosk New", "kiosk_new")).toBeUndefined();
    expect(readmeName("# leaselab-app", "leaselab_app")).toBeUndefined();
  });

  it("cuando el título es una frase y no un nombre", () => {
    expect(
      readmeName("# Una herramienta para gestionar todos tus proyectos", "x"),
    ).toBeUndefined();
    expect(readmeName(`# ${"a".repeat(40)}`, "x")).toBeUndefined();
  });

  it("cuando no hay letras", () => {
    expect(readmeName("# 123", "x")).toBeUndefined();
    expect(readmeName("# ***", "x")).toBeUndefined();
  });

  it("cuando el README no empieza por un título", () => {
    // Prose before the first heading: whatever comes after is no longer 'the title'.
    expect(readmeName("Este proyecto hace cosas.\n\n# Instalación\n", "x")).toBeUndefined();
  });

  it("sin README, sin nombre", () => {
    expect(readmeName(undefined, "x")).toBeUndefined();
    expect(readmeName("", "x")).toBeUndefined();
  });
});

describe("las carpetas que no dicen de qué proyecto son", () => {
  it("le pone delante quien la contiene", () => {
    // `echoreel/server` appeared as a 'server', next to another 'server' from another project.
    expect(qualifyWithParent("server", "echoreel")).toBe("echoreel server");
    expect(qualifyWithParent("app", "echoreel")).toBe("echoreel app");
    expect(qualifyWithParent("backend", "kestrel")).toBe("kestrel backend");
  });

  it("un nombre propio se queda como está", () => {
    expect(qualifyWithParent("veloria", "flutter")).toBe("veloria");
    expect(qualifyWithParent("panoma", "Desktop")).toBe("panoma");
  });

  it("si el padre tampoco dice nada, no se inventa contexto", () => {
    expect(qualifyWithParent("server", "app")).toBe("server");
    expect(qualifyWithParent("api", "packages")).toBe("api");
  });

  it("no repite lo que ya dice el padre", () => {
    expect(qualifyWithParent("server", "server")).toBe("server");
  });
});

describe("un contenedor no se llama como su hijo", () => {
  it("descarta el título que nombra a una carpeta de dentro", () => {
    // `brand assets/README.md` starts with «# Sundeck», which is the internal app. Taking it
    // left two cards with the same name and the same icon.
    expect(readmeName("# Sundeck\n\nTexto.", "brand assets", ["sundeck", "app"]))
      .toBeUndefined();
  });

  it("pero sí lo coge si no hay ninguna carpeta que se llame así", () => {
    expect(readmeName("# Sundeck\n\nTexto.", "brand assets", ["app", "templates"]))
      .toBe("Sundeck");
  });
});
