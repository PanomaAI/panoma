import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANDING_COPY } from "./landing-copy";

/**
 * That no menu option leads to a site that does not exist.
 *
 * The bar and the footer point to sections of the page itself with anchors. A broken anchor
 * doesn't break anything: the compilation doesn't fail, nothing appears in the console, the link
 * remains clickable — it just does nothing when clicked. It's the cheapest mistake to make.
 * (it's enough to rename a `id` ) and the most expensive to watch, because you have to keep
 * pressing.
 *
 * The component is read as text instead of being mounted: what is stated is that the destination
 * **is written** in some `id`, and for that, it is not necessary to run React.
 */
describe("el menú lleva donde dice", () => {
  const fuente = readFileSync(new URL("./landing-experience.tsx", import.meta.url), "utf8");

  const anclas = [...fuente.matchAll(/href="#([a-z-]+)"/g)].map((m) => m[1]!);
  const ids = new Set([...fuente.matchAll(/id="([a-z-]+)"/g)].map((m) => m[1]!));

  it("hay anclas que comprobar", () => {
    expect(anclas.length).toBeGreaterThan(3);
  });

  it("todas resuelven a una sección de la página", () => {
    const rotas = [...new Set(anclas)].filter((ancla) => !ids.has(ancla));
    expect(rotas).toEqual([]);
  });

  /*
    And the three from the menu are what they are.
    It's not a list for fun: on August 27, 2026, the bar announced «What it finds» and led to the
    comparison with GitHub —whose own tagline is «The obvious substitute»—, while the two sections
    that support the headline («intelligent, always learning») did not appear anywhere. It was
    changed to the memory of projects, which is what the page labels as `sectionFrame.memory`.
    Writing it here is what prevents it from diverging again without anyone noticing: the menu is
    a promise about the content, and promises are tested.
   */
  it("apunta a memoria, agentes y local, en el orden de la página", () => {
    const menu = /<nav className={styles\.navLinks}[\s\S]*?<\/nav>/.exec(fuente)?.[0] ?? "";
    const enElMenu = [...menu.matchAll(/href="#([a-z-]+)"/g)].map((m) => m[1]!);
    expect(enElMenu).toEqual(["memory", "agents", "local"]);
  });

  /*
    And the foot repeats the same block, so it has to say the same thing: two lists that
    contradict each other are worse than a single incomplete one.
   */
  it("el pie ofrece exactamente las mismas secciones", () => {
    const pie = /<footer[\s\S]*?<\/footer>/.exec(fuente)?.[0] ?? "";
    const enElPie = [...pie.matchAll(/href="#([a-z-]+)"/g)].map((m) => m[1]!);
    expect(enElPie).toEqual(["memory", "agents", "local"]);
  });

  /*
    The signs, in both languages. The menu names sections, so an empty or untranslated entry is an
    option that does not say where it leads.
   */
  it("cada opción tiene texto en castellano y en inglés", () => {
    for (const locale of ["es", "en"] as const) {
      for (const clave of ["memory", "agents", "local"] as const) {
        expect(LANDING_COPY[locale].nav[clave].trim().length, `${locale}.nav.${clave}`)
          .toBeGreaterThan(0);
      }
    }
  });
});

/**
 * That the skip to content link jumps to the content.
 *
 * It is the first focusable element of the two pages: it is fixed, hidden with a
 * `translateY(-160%)`, and only appears when it receives focus. Its job is to skip past the bar
 * —WCAG criterion 2.4.1, level A—, and for that very reason, it is invisible to those who navigate
 * with a mouse: no one sees it fail.
 *
 * It failed in two ways at the same time, corrected on 28-Aug-2026:
 *
 * 1. **It jumped too far.** On the landing, it pointed to `#encuentra`, which is the
 * sixth section. The first press of Tab offered «skip» and whoever accepted it left behind the
 * hero, the door, the video, the memory, and the twin — five sections, including the two that
 * support the headline. A skip link for the bar cannot skip the page.
 * 2. **It did not move the focus.** The destinations were `<section>` without `tabindex="-1"`, and
 * without it Safari moves but leaves the keyboard where it was: the next keystroke returns to the
 * bar and the link seems to do nothing.
 *
 * The convention is the one that the catalog was already using with
 * `<main id="app-main" tabIndex={-1}>`, and it is accounted for in
 * `apps/web/app/(app)/skip-target.test.ts`.
 */
describe("el enlace de saltar al contenido", () => {
  const paginas = [
    { nombre: "landing", fuente: "./landing-experience.tsx", destino: "main" },
    { nombre: "docs", fuente: "../docs/docs-experience.tsx", destino: "docs-main" },
  ] as const;

  it.each(paginas)("$nombre salta a su <main>, no a una sección", ({ fuente, destino }) => {
    const texto = readFileSync(new URL(fuente, import.meta.url), "utf8");
    const salto = /className={styles\.skipLink} href="#([a-z-]+)"/.exec(texto)?.[1];
    expect(salto, "no encuentro el enlace de salto").toBe(destino);
  });

  it.each(paginas)("$nombre tiene ese <main> y puede recibir el foco", ({ fuente, destino }) => {
    const texto = readFileSync(new URL(fuente, import.meta.url), "utf8");
    const main = new RegExp(`<main[^>]*id="${destino}"[^>]*>`).exec(texto)?.[0] ?? "";
    expect(main, `falta <main id="${destino}">`).not.toBe("");
    expect(main, "sin tabIndex={-1} el foco no se mueve en Safari").toContain("tabIndex={-1}");
  });

  /*
    And the ring turned off on both, because focusing on the container of the whole page would
    draw it around the entire screen — a rectangle that points to nothing.
   */
  it("y ninguno de los dos dibuja el anillo al recibirlo", () => {
    const hoja = readFileSync(new URL("../app/site.css", import.meta.url), "utf8");
    expect(hoja).toMatch(/#main:focus,\s*\n#docs-main:focus\s*\{[^}]*outline:\s*none/);
  });
});
