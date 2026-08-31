import { afterEach, describe, expect, it } from "vitest";
import { buildFileIndex } from "./discover";
import { readDesign, type DesignFingerprint } from "./design";
import { critiqueKey, reviewProject, type CriticFinding, type CriticReport } from "./critic";
import { createProject } from "./test-utils/temp-project";

/**
 * The critic is tested in reverse compared to a normal detector: what matters is not that they
 * find, it is that they **shut up**.
 *
 * `secrets.ts` explains why, and this module inherits the argument with the smaller margin: a
 * credential warning is given a second chance because it scares, and a 'missing an alt' is not. So
 * for each check there are two types of tests here: one that shows that the finding comes up when
 * the defect is present —otherwise, the whole module could be a `return []` and all the others
 * would pass—, and one for each type of false positive that the header of the module says it has
 * closed. The data for the first ones are not made up: they come from real projects from the
 * author's disk and are cited where appropriate.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** The whole path: a project of lies, its trace of truth, and the review on top. */
async function reviewOf(
  files: Record<string, string>,
  options: { truncated?: boolean } = {},
): Promise<CriticReport> {
  const { root, cleanup } = createProject(files);
  cleanups.push(cleanup);
  const built = await buildFileIndex(root);
  const index = options.truncated ? { ...built, truncated: true } : built;
  return reviewProject(index, await readDesign(index));
}

/** A project with nothing to look at, to test the loose footprint without touching the disc. */
async function reviewWith(design: Partial<DesignFingerprint>): Promise<CriticFinding[]> {
  const { root, cleanup } = createProject({ "notas.txt": "nada que ver aquí\n" });
  cleanups.push(cleanup);
  const index = await buildFileIndex(root);
  const report = await reviewProject(index, {
    hasUi: true,
    fonts: [],
    libraries: [],
    colors: [],
    radii: [],
    shadows: 0,
    darkMode: false,
    animation: false,
    sourcesRead: 0,
    truncated: false,
    ...design,
  });
  return report.findings;
}

function color(hex: string, count: number, source = "lib/tema.dart") {
  return { hex, count, sources: [source] };
}

function kinds(findings: CriticFinding[]): string[] {
  return findings.map((finding) => finding.kind);
}

/*
  The palette of `in_app_bot`, just as `readDesign` returns it today. It is the case that governs
  the thresholds of the flagship check and contains both things at once: a typo (`#2195f3` twice
  against `#2196f3` twenty-six, a single-digit difference, and also written with opacity so it is
  not visible) and two chosen grays that resemble it as much as the typo but are not it (`#393939`
  and `#3a3a3a` against `#363636` ).
 */
const IN_APP_BOT = [
  color("#2196f3", 26, "lib/chatbot/widgets/message_input_field.dart"),
  color("#363636", 10),
  color("#000000", 8),
  color("#3c3c3c", 6),
  color("#e1306c", 4),
  color("#2195f3", 2, "lib/chatbot/widgets/chatbot_widget.dart"),
  color("#25d366", 2),
  color("#393939", 2),
  color("#3a3a3a", 2),
  color("#606060", 2),
];

describe("reviewProject · el proyecto contra su propia paleta", () => {
  it("denuncia el color suelto que se distingue en un dígito del que sí se usa", async () => {
    const findings = await reviewWith({ colors: IN_APP_BOT });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "color-drift",
      claim: "#2195f3",
      hint: "#2196f3",
      file: "lib/chatbot/widgets/chatbot_widget.dart",
    });
  });

  it("se calla con los grises vecinos: mueven los tres canales, o sea que se eligieron", async () => {
    // `#393939` and `#3a3a3a` are just as strange as the typo and are just as close. The only thing
    // that distinguishes them is that there isn't a single wrong digit, there is a different gray.
    const findings = await reviewWith({
      colors: IN_APP_BOT.filter((entry) => entry.hex !== "#2195f3"),
    });

    expect(findings).toEqual([]);
  });

  it("se calla con la rampa de Tailwind, que es la que rompería una simple distancia", async () => {
    // slate-50 versus slate-100: 7, 5, and 3 points difference, that is, closer than some typos.
    // They are two steps of a published scale.
    const findings = await reviewWith({
      colors: [
        color("#f8fafc", 30),
        color("#0f172a", 22),
        color("#f1f5f9", 2),
      ],
    });

    expect(findings).toEqual([]);
  });

  it("se calla cuando el color raro no tiene contra qué destacar", async () => {
    // A single settled color is not a palette: without «the rest of the project», something
    // appearing twice means nothing.
    const findings = await reviewWith({
      colors: [color("#2196f3", 26), color("#2195f3", 2)],
    });

    expect(findings).toEqual([]);
  });

  it("se calla cuando el color de al lado también se usa", async () => {
    const findings = await reviewWith({
      colors: [color("#2196f3", 26), color("#363636", 10), color("#2195f3", 9)],
    });

    expect(findings).toEqual([]);
  });

  it("con la huella truncada no se cuenta nada: dos apariciones pueden ser doscientas", async () => {
    const findings = await reviewWith({ colors: IN_APP_BOT, truncated: true });

    expect(findings).toEqual([]);
  });
});

describe("reviewProject · las esquinas", () => {
  it("denuncia el radio suelto que a la vista es el mismo que el de siempre", async () => {
    // `in_app_bot`: `15px` in all the chat bubbles and a `16.0px` in a form.
    const findings = await reviewWith({
      radii: ["10px", "15px", "10.0px", "5px", "8.0px", "25.0px", "16.0px", "2px"],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "radius-drift", claim: "16.0px", hint: "15px" });
    // Without a file: the design footprint does not keep track of where each radius came from, and
    // to name one would be to make it up.
    expect(findings[0]?.file).toBeUndefined();
  });

  it("se calla ante una escala de verdad, que avanza de dos en dos como poco", async () => {
    const píxeles = await reviewWith({ radii: ["8px", "4px", "12px", "16px", "2px"] });
    const cuadratines = await reviewWith({ radii: ["0.5rem", "0.25rem", "0.375rem"] });

    expect(píxeles).toEqual([]);
    expect(cuadratines).toEqual([]);
  });

  it("no compara unidades distintas: `0.5rem` y `8px` son lo mismo solo si se supone algo", async () => {
    const findings = await reviewWith({ radii: ["8px", "0.5rem"] });

    expect(findings).toEqual([]);
  });

  it("se calla ante el mismo radio escrito por dos manos: `10px` y `10.0px`", async () => {
    // The CSS is written by one person and the `BorderRadius.circular(10.0)` of Dart is written by
    // another. It's an inconsistency that is not seen, and what is not seen is not a design flaw.
    const findings = await reviewWith({ radii: ["10px", "10.0px"] });

    expect(findings).toEqual([]);
  });

  it("con la huella truncada tampoco opina de las esquinas", async () => {
    const findings = await reviewWith({ radii: ["15px", "16.0px"], truncated: true });

    expect(findings).toEqual([]);
  });
});

describe("reviewProject · imágenes que no dicen qué muestran", () => {
  it("denuncia la imagen sin alt, con su fichero y su línea", async () => {
    const report = await reviewOf({
      "index.html": [
        "<!doctype html>",
        "<main>",
        '  <img src="assets/hero.png" width="900" height="400">',
        "</main>",
      ].join("\n"),
      "assets/hero.png": "la imagen está: lo que falta es lo que dice\n",
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      kind: "image-no-alt",
      claim: "assets/hero.png",
      file: "index.html",
      line: 3,
    });
  });

  it("la decorativa lleva `alt=\"\"` a propósito, y eso es un alt", async () => {
    const report = await reviewOf({
      "index.html": '<img src="assets/marca.svg" alt="" width="32" height="32">\n',
      "assets/marca.svg": "<svg></svg>\n",
    });

    expect(report.findings).toEqual([]);
  });

  it("un alt calculado sigue siendo un alt, se escriba como se escriba", async () => {
    const report = await reviewOf({
      "app/tarjeta.tsx": 'export const A = () => <img src={foto} alt={pie} />;\n',
      "app/vista.vue": '<template><img :alt="pie" :src="foto"></template>\n',
      "app/aparte.svelte": "<img {src} {alt}>\n",
    });

    expect(report.findings).toEqual([]);
  });

  it("no denuncia lo que puede venir de fuera: `{...props}`", async () => {
    // A component that forwards its properties can receive the alt from whoever uses it, and from
    // here that cannot be known.
    const report = await reviewOf({
      "app/foto.tsx": "export const Foto = (props) => <img {...props} className=\"foto\" />;\n",
    });

    expect(report.findings).toEqual([]);
  });

  it("se calla con lo que ya tiene nombre o se declara decorativo", async () => {
    const report = await reviewOf({
      "index.html": [
        '<img src="a.png" aria-label="Un perro">',
        '<img src="b.png" aria-hidden="true">',
        '<img src="c.png" role="presentation">',
        '<img src="https://ejemplo.com/p.gif" width="1" height="1">',
      ].join("\n"),
      "a.png": "a\n",
      "b.png": "b\n",
      "c.png": "c\n",
    });

    expect(report.findings).toEqual([]);
  });

  it("no le engaña un `>` dentro de una expresión de JSX", async () => {
    // With the naive search for the first `>`, the tag was cut off just before the alt: the
    // attribute being sought was the one that caused the report.
    const report = await reviewOf({
      "app/vista.tsx": 'const A = () => <img src={foto} alt={ancho > 1 ? "grande" : "pequeña"} />;\n',
    });

    expect(report.findings).toEqual([]);
  });

  it("una imagen comentada no es una imagen", async () => {
    const report = await reviewOf({
      "index.html": '<!-- <img src="viejo.png"> -->\n<p>hola</p>\n',
      "app/vista.tsx": "const A = () => <div>{/* <img src=\"viejo.png\" /> */}</div>;\n",
    });

    expect(report.findings).toEqual([]);
  });

  it("al `<Image>` de next/image se le pide alt; a un `<Image>` de la casa, no", async () => {
    const report = await reviewOf({
      "app/portada.tsx": [
        'import Image from "next/image";',
        'export const P = () => <Image src="/hero.png" width={800} height={400} />;',
      ].join("\n"),
      "app/ficha.tsx": [
        'import { Image } from "@/components/image";',
        'export const F = () => <Image src="/ficha.png" />;',
      ].join("\n"),
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      kind: "image-no-alt",
      claim: "/hero.png",
      file: "app/portada.tsx",
    });
  });

  it("no copia un `data:` de tres megas en el informe", async () => {
    const report = await reviewOf({
      "index.html": `<img src="data:image/png;base64,${"A".repeat(4000)}">\n`,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!.claim.length).toBeLessThanOrEqual(60);
    expect(report.findings[0]!.claim.endsWith("…")).toBe(true);
  });
});

describe("reviewProject · enlaces que no llevan a ninguna parte", () => {
  it("denuncia el enlace roto del markdown y dice dónde vive uno que se llama igual", async () => {
    // It is the exact shape that the defect has on the author's disc: a tracking table in `cabeman`
    // that links screens that were rearranged months ago.
    const report = await reviewOf({
      "SEGUIMIENTO.md": [
        "| Pantalla | Fichero |",
        "|---|---|",
        "| Login | [login.dart](lib/pantallas/login.dart) |",
        "| Menú | [menu.dart](lib/pantallas/menu.dart) |",
      ].join("\n"),
      "lib/pantallas/login.dart": "void main() {}\n",
      "lib/auth/menu.dart": "void main() {}\n",
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      kind: "broken-link",
      claim: "lib/pantallas/menu.dart",
      hint: "lib/auth/menu.dart",
      file: "SEGUIMIENTO.md",
      line: 4,
    });
  });

  it("resuelve el destino contra la carpeta del fichero, no contra la raíz", async () => {
    const report = await reviewOf({
      "README.md": "# raíz\n",
      "docs/guia.md": "[la raíz](../README.md) · [al lado](vecina.md) · [nada](../falta.md)\n",
      "docs/vecina.md": "# vecina\n",
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ claim: "../falta.md", file: "docs/guia.md" });
  });

  it("un fichero que está en el disco pero no en el índice no es una mentira", async () => {
    // `agentsmd.ts` 's second opinion: the index respects the .gitignore, so without looking at the
    // disk it would report exactly what is there and not versioned.
    const report = await reviewOf({
      ".gitignore": "privado/\n",
      "privado/nota.md": "# secreta\n",
      "README.md": "[la nota](privado/nota.md)\n",
    });

    expect(report.findings).toEqual([]);
  });

  it("se calla con lo que no es una ruta de este disco", async () => {
    const report = await reviewOf({
      "README.md": [
        "[web](https://panoma.ai/precios) · [correo](mailto:hola@panoma.ai)",
        "[ancla](#instalación) · [absoluta](/docs/guia.md)",
        "[plantilla](${base}/guia.md) · [otra]({{ url }}/guia.md)",
        "[compilado](dist/informe.html) · [cobertura](coverage/index.html)",
      ].join("\n"),
    });

    expect(report.findings).toEqual([]);
  });

  it("el markdown que enseña un enlace no está enlazando", async () => {
    // The case came from running this through the repository itself: `docs/agents-md.md` explains
    // the syntax with an example, and the example does not promise that anything exists.
    const report = await reviewOf({
      "docs/linter.md": [
        "Se comprueban los destinos relativos (`[guía](docs/setup.md)`), contra el índice.",
        "",
        "```md",
        "[otra guía](docs/tampoco-existe.md)",
        "```",
      ].join("\n"),
    });

    expect(report.findings).toEqual([]);
  });

  it("en el marcado, una ruta del servidor no es un fichero", async () => {
    const report = await reviewOf({
      "index.html": [
        '<a href="/precios">Precios</a>',
        '<a href="contacto">Contacto</a>',
        '<a href="blog/">Blog</a>',
        '<script src="flutter_bootstrap.js"></script>',
        '<link rel="stylesheet" href="estilos.css">',
      ].join("\n"),
    });

    expect(report.findings).toEqual([]);
  });

  it("el ancla y la consulta son del navegador: el fichero es el mismo", async () => {
    const report = await reviewOf({
      "index.html": [
        '<a href="guia.html#instalación">Instalar</a>',
        '<img src="assets/logo.svg?v=2" alt="Logotipo">',
      ].join("\n"),
      "guia.html": "<h1>Guía</h1>\n",
      "assets/logo.svg": "<svg></svg>\n",
    });

    expect(report.findings).toEqual([]);
  });

  it("y una imagen del marcado que no está, sí lo es", async () => {
    const report = await reviewOf({
      "index.html": '<img src="assets/logo.png" alt="Logotipo">\n',
    });

    expect(kinds(report.findings)).toEqual(["broken-link"]);
    expect(report.findings[0]).toMatchObject({
      claim: "assets/logo.png",
      file: "index.html",
      line: 1,
    });
  });
});

describe("reviewProject · lo que no se puede afirmar", () => {
  it("con el paseo truncado no se denuncia ningún enlace: no verlo no es que falte", async () => {
    const files = {
      "README.md": "[la guía](docs/guia.md)\n",
      "index.html": '<img src="assets/hero.png">\n',
    };

    const entero = await reviewOf(files);
    const corto = await reviewOf(files, { truncated: true });

    expect(kinds(entero.findings)).toContain("broken-link");
    expect(kinds(corto.findings)).not.toContain("broken-link");
    // And what does survive, because it does not affirm any absence of the project: the label was
    // read in full, and a walk that stops earlier does not add an alt.
    expect(kinds(corto.findings)).toEqual(["image-no-alt"]);
    expect(corto.truncated).toBe(true);
  });

  it("un proyecto limpio devuelve un informe vacío, y dice cuánto se miró", async () => {
    const report = await reviewOf({
      "README.md": "# limpio\n\n[la guía](docs/guia.md)\n",
      "docs/guia.md": "# guía\n\n![captura](captura.png)\n",
      "docs/captura.png": "no es un png de verdad, pero está\n",
      "index.html": '<img src="docs/captura.png" alt="Una captura">\n',
    });

    expect(report.findings).toEqual([]);
    expect(report.sourcesRead).toBe(3);
    expect(report.truncated).toBe(false);
  });

  it("no hace ruido en un proyecto sin interfaz ninguna", async () => {
    const report = await reviewOf({
      "estrategia.py": "def backtest():\n    return 42\n",
      "requirements.txt": "pandas\n",
    });

    expect(report.findings).toEqual([]);
    expect(report.sourcesRead).toBe(0);
  });
});

describe("el silencio parcial se dice", () => {
  it("una huella truncada marca el informe, aunque el índice esté entero", async () => {
    // Measured in humo_check/frontend: the footprint came out truncated, the two drift checks
    // turned off by themselves —correct— and the report answered 'nothing to report.' Regarding a
    // partial silence, that is not good news, it is a false sense of security.
    const { root, cleanup } = createProject({
      "package.json": JSON.stringify({ name: "demo" }),
      "index.html": '<html><body><img src="a.png" alt="a"></body></html>',
    });
    cleanups.push(cleanup);
    const index = await buildFileIndex(root);
    const design = await readDesign(index);

    const entero = await reviewProject(index, design);
    const parcial = await reviewProject(index, { ...design, truncated: true });

    expect(entero.truncated, "el índice y el barrido estaban completos").toBe(false);
    expect(parcial.truncated, "el informe hereda el truncado de la huella").toBe(true);
  });
});

/**
 * The key to a finding, which is what makes it possible to handle it one by one.
 *
 * `reviews` saves one row per folder and overwrites it completely on each review, so the position
 * within its list does not identify anything. What is tested here is the property on which the
 * button depends: the same report gives the same key — even if it changes position in the list —
 * and two different reports do not share it.
 */
describe("critiqueKey", () => {
  const link: CriticFinding = { kind: "broken-link", claim: "./guia.md", file: "README.md", line: 12 };

  it("el mismo hallazgo encontrado otra vez es el mismo hallazgo", () => {
    expect(critiqueKey({ ...link })).toBe(critiqueKey(link));
  });

  it("la línea, el fichero, la clase y el valor entran todos", () => {
    expect(critiqueKey({ ...link, line: 13 })).not.toBe(critiqueKey(link));
    expect(critiqueKey({ ...link, file: "OTRO.md" })).not.toBe(critiqueKey(link));
    expect(critiqueKey({ ...link, claim: "./otra.md" })).not.toBe(critiqueKey(link));
    expect(critiqueKey({ ...link, kind: "image-no-alt" })).not.toBe(critiqueKey(link));
  });

  /* Without a separator, «ab» + «c» and «a» + «bc» would give the same key. */
  it("dos hallazgos que solo se distinguen por dónde parte el campo no colisionan", () => {
    const uno = critiqueKey({ kind: "broken-link", claim: "b", file: "a" });
    const otro = critiqueKey({ kind: "broken-link", claim: "", file: "ab" });
    expect(uno).not.toBe(otro);
  });

  it("y el hallazgo sin fichero ni línea también tiene clave", () => {
    expect(critiqueKey({ kind: "radius-drift", claim: "17px" })).toMatch(/^[0-9a-f]{12}$/);
  });
});
