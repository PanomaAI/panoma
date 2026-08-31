import { afterEach, describe, expect, it } from "vitest";
import { buildFileIndex } from "./discover";
import { readDesign, type DesignSignal } from "./design";
import { createProject } from "./test-utils/temp-project";

/**
 * The visual footprint is judged by two things: that it recognizes the three stacks of the real
 * portfolio —Next with Tailwind, HTML and CSS plain, and Flutter— and that it **stays silent**
 * when there is nothing to look at. The second is more important: a Python folder that is given a
 * palette ends up with the top layer giving opinions on the design of a backtest.
 *
 * All signs are verified with their trace. Trust without evidence cannot be disputed, and what
 * cannot be disputed cannot be corrected when we are wrong.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function designOf(files: Record<string, string>, truncated = false) {
  const { root, cleanup } = createProject(files);
  cleanups.push(cleanup);
  const index = await buildFileIndex(root);
  return readDesign(truncated ? { ...index, truncated: true } : index);
}

/** No signal is emitted without a trace, and no trace comes out empty. */
function expectEvidence(signals: DesignSignal[]): void {
  expect(signals.length).toBeGreaterThan(0);
  for (const signal of signals) {
    expect(signal.evidence.length).toBeGreaterThan(0);
    expect(signal.confidence).toBeGreaterThanOrEqual(0.5);
    for (const evidence of signal.evidence) {
      expect(evidence.detail.length).toBeGreaterThan(0);
      expect(evidence.weight).toBeGreaterThan(0);
    }
  }
}

const NEXT_TAILWIND: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "retrato-web",
    dependencies: { next: "^15.1.0", react: "^19.0.0" },
    devDependencies: { tailwindcss: "^3.4.0" },
  }),
  "tailwind.config.ts": `import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./app/**/*.tsx"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "system-ui"] },
      colors: { brand: "#1D4ED8", ink: "#0F172A" },
      borderRadius: { xl: "14px" },
      boxShadow: { card: "0 1px 2px rgba(0, 0, 0, 0.08)" },
    },
  },
} satisfies Config;
`,
  "app/globals.css": `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --brand: #1d4ed8;
  --radius: 12px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --brand: #93c5fd;
  }
}

.card {
  color: #1d4ed8;
  border-radius: 12px;
  box-shadow: 0 1px 2px #0f172a;
  transition: transform 200ms ease;
}
`,
  "app/page.module.css": `.hero {
  border-radius: 12px;
  font-family: "Playfair Display", serif;
}
`,
  "app/layout.tsx": `import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.className}>
      <body className="rounded-xl shadow-lg transition-colors dark:bg-slate-900">{children}</body>
    </html>
  );
}
`,
  /*
    Generated output, with the two names that this repo actually uses. The scan doesn't skip them
    — `SKIP_DIRS` knows `.next`, not `.next-dev` — so they reach this module, and if the palette
    were read it would come out counted twice and with an invented typeface.
   */
  ".next-dev/static/css/app/layout.css": `@font-face{font-family:"Geist Fallback";src:local("Arial")}
.x{color:#ff00ff;border-radius:3px;box-shadow:0 0 1px #ff00ff}
`,
  "app/theme.bundle.css": `.y{color:#00ff00;border-radius:7px}
`,
};

const PLAIN_WEB: Record<string, string> = {
  "index.html": `<!doctype html>
<html lang="es">
  <head>
    <meta name="theme-color" content="#0f172a" />
    <link rel="preconnect" href="https://fonts.gstatic.com" />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400;600&display=swap"
    />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <a href="#top">Arriba</a>
    <h1>Hola</h1>
  </body>
</html>
`,
  "styles.css": `:root {
  --ink: #222222;
  --paper: #fafafa;
  --font-display: "Playfair Display", serif;
}

body {
  font-family: "Inter", system-ui, sans-serif;
  color: #222222;
  background: #fafafa;
}

.btn {
  border-radius: 999px;
  box-shadow: 0 2px 4px #00000022;
  transition: transform 150ms ease-out;
}

@media (prefers-color-scheme: dark) {
  body {
    color: #fafafa;
    background: #222222;
  }
}
`,
};

const FLUTTER: Record<string, string> = {
  "pubspec.yaml": `name: retrato
description: Una app de retratos
environment:
  sdk: ">=3.4.0 <4.0.0"
dependencies:
  flutter:
    sdk: flutter
  google_fonts: ^6.2.1
  flutter_animate: ^4.5.0
`,
  "lib/theme.dart": `import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

final ThemeData lightTheme = ThemeData(
  useMaterial3: true,
  scaffoldBackgroundColor: Color(0xFFFDFCFA),
  colorScheme: ColorScheme.fromSeed(seedColor: Color(0xFF1D4ED8)),
  textTheme: GoogleFonts.playfairDisplayTextTheme(),
);

final ThemeData darkTheme = ThemeData(
  brightness: Brightness.dark,
  scaffoldBackgroundColor: Color(0xFF0F172A),
);
`,
  "lib/widgets/card.dart": `import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class PortraitCard extends StatelessWidget {
  const PortraitCard({super.key});

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 240),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        boxShadow: [BoxShadow(color: Color(0xFF1D4ED8), blurRadius: 12)],
      ),
      child: Text('Hola', style: GoogleFonts.inter(fontSize: 16)),
    );
  }
}
`,
};

const PYTHON_ONLY: Record<string, string> = {
  "pyproject.toml": `[project]
name = "backtest"
version = "0.1.0"
dependencies = ["numpy", "pandas"]
`,
  "src/strategy.py": `import numpy as np


def sharpe(returns: np.ndarray) -> float:
    return returns.mean() / returns.std()
`,
  "README.md": "# backtest\n\nUna estrategia de medias móviles.\n",
};

describe("Next con Tailwind", () => {
  it("reconoce Tailwind y los módulos CSS, cada uno con su rastro", async () => {
    const design = await designOf(NEXT_TAILWIND);

    expect(design.hasUi).toBe(true);
    expect(design.libraries.map((library) => library.id)).toEqual(
      expect.arrayContaining(["tailwind", "css-modules"]),
    );
    expectEvidence(design.libraries);
  });

  it("saca la tipografía de next/font y la declarada en el módulo CSS", async () => {
    const design = await designOf(NEXT_TAILWIND);

    expect(design.fonts.map((font) => font.id)).toEqual(
      expect.arrayContaining(["inter", "playfair-display"]),
    );
    expectEvidence(design.fonts);

    const inter = design.fonts.find((font) => font.id === "inter");
    expect(inter?.evidence.some((evidence) => evidence.matcher === "next-font")).toBe(true);
  });

  it("no le parte el nombre a una tipografía que ya venía escrita", async () => {
    // The case measured on the author's disk: `JetBrains Mono` appears 129 times in one of their
    // projects, and splitting on internal capitals produced «Jet Brains Mono». The single-word
    // identifier is indeed split: it's what next/font writes.
    const design = await designOf({
      "package.json": JSON.stringify({ name: "tipos" }),
      "index.html": "<html><body></body></html>",
      "styles.css": [
        "body { font-family: 'JetBrains Mono', monospace; }",
        "code { font-family: \"IBM Plex Sans\", sans-serif; }",
      ].join("\n"),
      "app/layout.tsx": 'import { playfairDisplay } from "next/font/google";',
    });
    const names = design.fonts.map((font) => font.name);

    expect(names).toContain("JetBrains Mono");
    expect(names).toContain("IBM Plex Sans");
    expect(names).toContain("Playfair Display");
    expect(names).not.toContain("Jet Brains Mono");
  });

  it("cuenta la paleta con sus ficheros y recoge los radios de los dos sitios", async () => {
    const design = await designOf(NEXT_TAILWIND);

    const brand = design.colors.find((color) => color.hex === "#1d4ed8");
    // The `#1D4ED8` of the configuration and the `#1d4ed8` of the CSS are the same color.
    expect(brand?.count).toBeGreaterThanOrEqual(3);
    expect(brand?.sources).toContain("app/globals.css");
    expect(design.colors[0]?.hex).toBe("#1d4ed8");

    expect(design.radii).toEqual(expect.arrayContaining(["12px", "14px"]));
  });

  it("ve el modo oscuro, la animación y las sombras", async () => {
    const design = await designOf(NEXT_TAILWIND);

    expect(design.darkMode).toBe(true);
    expect(design.animation).toBe(true);
    expect(design.shadows).toBeGreaterThanOrEqual(2);
    expect(design.sourcesRead).toBe(4);
    expect(design.truncated).toBe(false);
  });

  it("no lee lo compilado: ni el CSS de .next-dev ni el bundle", async () => {
    const design = await designOf(NEXT_TAILWIND);

    const hexes = design.colors.map((color) => color.hex);
    expect(hexes).not.toContain("#ff00ff");
    expect(hexes).not.toContain("#00ff00");
    expect(design.radii).not.toContain("3px");
    expect(design.radii).not.toContain("7px");
    // «Geist Fallback» is the font that next/font produces, not one that anyone chose.
    expect(design.fonts.map((font) => font.id)).not.toContain("geist-fallback");
  });
});

describe("HTML y CSS a pelo", () => {
  it("saca las dos fuentes de Google y la que declara la hoja de estilos", async () => {
    const design = await designOf(PLAIN_WEB);

    expect(design.hasUi).toBe(true);
    expect(design.fonts.map((font) => font.id)).toEqual(
      expect.arrayContaining(["inter", "playfair-display"]),
    );
    expectEvidence(design.fonts);

    const playfair = design.fonts.find((font) => font.id === "playfair-display");
    expect(playfair?.name).toBe("Playfair Display");
    expect(playfair?.evidence.some((evidence) => evidence.matcher === "google-fonts")).toBe(true);
  });

  it("una página sin framework no inventa bibliotecas, pero sí tiene paleta", async () => {
    const design = await designOf(PLAIN_WEB);

    expect(design.libraries).toHaveLength(0);
    expect(design.colors.map((color) => color.hex)).toEqual(
      expect.arrayContaining(["#222222", "#fafafa"]),
    );
    // `#00000022` carries alpha: the color is the same black.
    expect(design.colors.map((color) => color.hex)).toContain("#000000");
    expect(design.radii).toContain("999px");
    expect(design.shadows).toBeGreaterThanOrEqual(1);
    expect(design.darkMode).toBe(true);
    expect(design.animation).toBe(true);
  });

  it("un `href=\"#top\"` no es un color y un `theme-color` sí", async () => {
    const design = await designOf(PLAIN_WEB);
    expect(design.colors.map((color) => color.hex)).toContain("#0f172a");
  });
});

describe("Flutter", () => {
  it("entiende material, google_fonts y flutter_animate", async () => {
    const design = await designOf(FLUTTER);

    expect(design.hasUi).toBe(true);
    expect(design.libraries.map((library) => library.id)).toEqual(
      expect.arrayContaining(["material", "google-fonts", "flutter-animate"]),
    );
    expectEvidence(design.libraries);
  });

  it("lee las fuentes de GoogleFonts.x() con el nombre en dos palabras", async () => {
    const design = await designOf(FLUTTER);

    expect(design.fonts.map((font) => font.id)).toEqual(
      expect.arrayContaining(["playfair-display", "inter"]),
    );
    expectEvidence(design.fonts);
  });

  it("Color(0xFF…) es un color y BorderRadius.circular un radio", async () => {
    const design = await designOf(FLUTTER);

    const brand = design.colors.find((color) => color.hex === "#1d4ed8");
    expect(brand?.count).toBeGreaterThanOrEqual(2);
    expect(design.colors.map((color) => color.hex)).toContain("#fdfcfa");
    expect(design.radii).toContain("18px");
    expect(design.shadows).toBeGreaterThanOrEqual(1);
    expect(design.darkMode).toBe(true);
    expect(design.animation).toBe(true);
  });
});

describe("un color no cabe siempre en una línea", () => {
  it("recoge un box-shadow y un gradiente partidos por el formateador", async () => {
    // Prettier splits the values of several layers into one line per layer, so the colons of the
    // declaration stay at the top. Asking for them on the same physical line left this file in a
    // single color, and for a real project from the author's disk it threw out the two most
    // repeated from its gradient.
    const design = await designOf({
      "index.html": "<html><body></body></html>",
      "styles.css": [
        ":root{--ink:#141722}",
        ".card {",
        "  box-shadow:",
        "    0 1px 2px 0 #1417220f,",
        "    0 8px 24px -4px #14172214;",
        "  background-image:",
        "    linear-gradient(180deg, #f8f9fc 0%, #ffffff 100%),",
        "    radial-gradient(circle at 50% 0%, #0b0b0d 0%, transparent 70%);",
        "}",
      ].join("\n"),
    });

    // Both layers of the shadow carry alpha: they are the same `#141722` of the variable.
    expect(design.colors.find((color) => color.hex === "#141722")?.count).toBe(3);
    expect(design.colors.map((color) => color.hex)).toEqual(
      expect.arrayContaining(["#f8f9fc", "#ffffff", "#0b0b0d"]),
    );
  });

  it("un fill, un stroke y un stop-color de un SVG en línea son colores", async () => {
    // In the markup, a color does not go after a colon: it goes inside an attribute. A landing of
    // HTML directly from the author's disk lost seven of its twelve colors because of that.
    const design = await designOf({
      "index.html": [
        "<html><body>",
        '<svg><rect fill="#1d4ed8"/><stop stop-color="#0f172a"/><path stroke="#25b878"/></svg>',
        "<style>body{background:#fafafa}</style>",
        "</body></html>",
      ].join("\n"),
    });

    expect(design.colors.map((color) => color.hex)).toEqual(
      expect.arrayContaining(["#1d4ed8", "#0f172a", "#25b878", "#fafafa"]),
    );
  });

  it("un ancla a un id no es un color aunque el id parezca uno", async () => {
    const design = await designOf({
      "index.html": [
        "<html><body>",
        '<p style="color:#1d4ed8">Ver <a href="#facade">la sección</a></p>',
        "</body></html>",
      ].join("\n"),
    });

    expect(design.colors.map((color) => color.hex)).toEqual(["#1d4ed8"]);
  });
});

describe("componentes de fichero único", () => {
  it("un selector de id dentro del <style> de un .vue no es un color", async () => {
    // Inside a `<style>` there are CSS of truth, with its selector syntax: `#fade` is an id, and as
    // a four-digit hexadecimal it was used expanded to `#ffaadd`.
    const design = await designOf({
      "package.json": JSON.stringify({ name: "sfc" }),
      "src/App.vue": [
        '<template><nav id="fade"><a href="#faded">x</a></nav></template>',
        "<style scoped>#fade { color: #1d4ed8; }</style>",
      ].join("\n"),
    });

    expect(design.colors.map((color) => color.hex)).toEqual(["#1d4ed8"]);
  });

  it("fuera del <style> se sigue leyendo lo que no lleva declaración delante", async () => {
    // This exception supports the rest: neither a palette array nor a Tailwind class with an
    // arbitrary value have colons in front, so asking for them would remove them.
    const design = await designOf({
      "package.json": JSON.stringify({ name: "sfc" }),
      "src/App.vue": [
        '<script setup lang="ts">',
        'const palette = ["#0f172a", "#1d4ed8"];',
        "</script>",
        '<template><div class="bg-[#25b878]" /></template>',
      ].join("\n"),
    });

    expect(design.colors.map((color) => color.hex)).toEqual(
      expect.arrayContaining(["#0f172a", "#1d4ed8", "#25b878"]),
    );
  });
});

describe("el coste de leer un CSS compilado", () => {
  it("un output.css de una sola línea no cuesta un segundo", async () => {
    // A `output.css` at the root is not output generated for `GENERATED_PATTERN` nor is it minified
    // for `MINIFIED_PATTERN`: it is read entirely up to the 256 KiB limit. Looking back to the
    // beginning of the line, which here is the file, took 959 ms measured; with the bounded window
    // it’s just a few. The threshold is intentionally loose, since the CI machine is not this one.
    const { root, cleanup } = createProject({
      "index.html": "<html><body></body></html>",
      "output.css": ".a{color:#abcdef}".repeat(18000),
    });
    cleanups.push(cleanup);
    const index = await buildFileIndex(root);

    const started = performance.now();
    const design = await readDesign(index);
    const elapsed = performance.now() - started;

    expect(design.colors[0]?.hex).toBe("#abcdef");
    expect(elapsed).toBeLessThan(400);
  });
});

describe("carpetas sin interfaz", () => {
  it("una estrategia en Python no tiene huella visual que juzgar", async () => {
    const design = await designOf(PYTHON_ONLY);

    expect(design.hasUi).toBe(false);
    expect(design.fonts).toEqual([]);
    expect(design.libraries).toEqual([]);
    expect(design.colors).toEqual([]);
    expect(design.radii).toEqual([]);
    expect(design.shadows).toBe(0);
    expect(design.darkMode).toBe(false);
    expect(design.animation).toBe(false);
    expect(design.sourcesRead).toBe(0);
    expect(design.truncated).toBe(false);
  });
});

describe("lo que no se pudo mirar", () => {
  it("un índice truncado marca el informe y no borra lo que sí vio", async () => {
    const design = await designOf(NEXT_TAILWIND, true);

    // The dash is the only thing that separates 'doesn't have it' from 'we haven't seen it':
    // without it, the `darkMode: false` of a half-indexed project would read as a statement.
    expect(design.truncated).toBe(true);
    // Truncating does not erase the positives: what was read is still affirmed.
    expect(design.fonts.map((font) => font.id)).toContain("inter");
    expect(design.libraries.map((library) => library.id)).toContain("tailwind");
    expectEvidence(design.fonts);
  });

  it("con el índice completo el informe no se marca", async () => {
    const design = await designOf(NEXT_TAILWIND);
    expect(design.truncated).toBe(false);
  });

  it("truncado y sin interfaz: los negativos van marcados, no afirmados", async () => {
    const design = await designOf(PYTHON_ONLY, true);

    expect(design.hasUi).toBe(false);
    expect(design.truncated).toBe(true);
  });
});
