import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROJECT_VIEWS, viewFromHash } from "./project-views";

/**
 * Each tab of the form has to lead to something.
 *
 * `PROJECT_VIEWS` is a fixed list: the tab is always rendered, whether its frame has been mounted
 * or not. Eight frames were always mounted and the ninth —"Agents"— only if there was activity,
 * tasks, or executions. In a newly scanned project, which is the normal case on the first day,
 * clicking that tab emptied the entire column: active tab, zero content, without a single word
 * explaining anything. There was no error; there was simply nothing.
 *
 * It is a flaw that is not seen by reading the component or reading the page: it is seen by
 * crossing the two. That is why it is checked here, and that is why both halves are checked — that
 * the frame exists, and that **no one has wrapped it in a condition**, which is the exact form
 * this one had.
 */
describe("las pestañas de la ficha y los marcos que abren", () => {
  const source = readFileSync(new URL("../app/(app)/p/[slug]/page.tsx", import.meta.url), "utf8");
  const lines = source.split("\n");

  /** The real views: `all` has no own frame, it shows all the others. */
  const CON_MARCO = PROJECT_VIEWS.filter((view) => view.id !== "all").map((view) => view.id);

  it("cada pestaña tiene su marco en la ficha", () => {
    for (const id of CON_MARCO) {
      expect(source, `la pestaña ${id} no tiene marco`).toContain(`<ProjectViewFrame view="${id}"`);
    }
  });

  it("ningún marco se monta solo si hay datos", () => {
    for (const [index, line] of lines.entries()) {
      const match = /<ProjectViewFrame view="([a-z]+)"/.exec(line);
      if (!match) continue;

      // The previous line with content: if it opens a condition, the frame is conditional.
      let previous = "";
      for (let i = index - 1; i >= 0 && !previous; i -= 1) previous = lines[i]!.trim();

      expect(
        previous.endsWith("&& (") || previous.endsWith("? ("),
        `el marco de ${match[1]} se monta solo a veces, y su pestaña se pinta siempre: quien la pulse sin datos se queda mirando el vacío`,
      ).toBe(false);
    }
  });

  it("el marco de agentes dice algo cuando no ha pasado ningún agente", () => {
    const desde = source.indexOf('<ProjectViewFrame view="agentes"');
    const hasta = source.indexOf("</ProjectViewFrame>", desde);
    const marco = source.slice(desde, hasta);
    // With quotes: without them, `project.logEmptyHow` contains `project.logEmpty` and the check
    // passed even if the text that matters had been removed. Caught testing it.
    expect(marco).toContain('"project.logEmpty"');
    // And with the output: the command that makes that gap stop being empty.
    expect(marco).toContain("panoma agent-key");
  });

  it("la pila completa forma parte visible de Detalles", () => {
    const desde = source.indexOf('<ProjectViewFrame view="detalles"');
    const hasta = source.indexOf("</ProjectViewFrame>", desde);
    const marco = source.slice(desde, hasta);

    expect(marco).toContain('id="stack"');
    expect(marco).not.toContain('<details className="project-deep-section group" id="stack"');
  });

  /*
    The URL is the only thing from the card that is read outside of the card: it is pasted in a
    chat, saved in a bookmark, appears in the documentation. It was in Spanish under a screen that
    is seen in English, and a URL is an identifier —the house rule applies here the same as in a
    file name—.
   */
  it("el ancla que acaba en la barra del navegador está en inglés", () => {
    const CASTELLANO = [
      "resumen",
      "actividad",
      "retomar",
      "cuentas",
      "encargos",
      "dependencias",
      "seguridad",
      "agentes",
      "bitacora",
      "detalles",
      "tecnologias",
      "respaldo",
    ];

    for (const view of PROJECT_VIEWS) {
      const primera = view.hashes[0];
      expect(
        CASTELLANO.includes(primera ?? ""),
        `la vista ${view.id} emite «#${primera}», y eso acaba en la barra`,
      ).toBe(false);
    }
  });

  /*
    And the other half, which is the one that really breaks on its own: the previous ones continue
    opening their section. A link saved three months ago cannot stay in the 'all' view without
    saying anything, which is exactly what would happen if someone cleaned the alias list.
   */
  it("y las de antes siguen llevando a donde llevaban", () => {
    const ANTES: [string, string][] = [
      ["resumen", "resumen"],
      ["actividad", "actividad"],
      ["retomar", "retomar"],
      ["cuentas", "cuentas"],
      ["encargos", "encargos"],
      ["dependencias", "dependencias"],
      ["seguridad", "dependencias"],
      ["agentes", "agentes"],
      ["bitacora", "agentes"],
      ["detalles", "detalles"],
      ["tecnologias", "detalles"],
      ["respaldo", "resumen"],
    ];

    for (const [hash, esperado] of ANTES) {
      expect(viewFromHash(`#${hash}`), `#${hash} dejó de abrir su sección`).toBe(esperado);
    }
  });

  /* And the ones from now, which are the ones that are being written. */
  it("las nuevas abren lo que dicen", () => {
    const AHORA: [string, string][] = [
      ["summary", "resumen"],
      ["activity", "actividad"],
      ["resume", "retomar"],
      ["accounts", "cuentas"],
      ["assignments", "encargos"],
      ["md", "md"],
      ["dependencies", "dependencias"],
      ["security", "dependencias"],
      ["agents", "agentes"],
      ["log", "agentes"],
      ["details", "detalles"],
      ["stack", "detalles"],
      ["unsaved", "resumen"],
    ];

    for (const [hash, esperado] of AHORA) {
      expect(viewFromHash(`#${hash}`), `#${hash} no abre nada`).toBe(esperado);
    }
  });

  /* Each new anchor has to exist on the page, or the browser doesn't jump anywhere. */
  it("y cada ancla tiene su sitio en la ficha", () => {
    const ANCLAS = [
      "summary",
      "activity",
      "accounts",
      "assignments",
      "md",
      "dependencies",
      "security",
      "agents",
      "details",
      "stack",
      "unsaved",
    ];
    const board = readFileSync(new URL("./project-board.tsx", import.meta.url), "utf8");
    const changes = readFileSync(new URL("./project-changes.tsx", import.meta.url), "utf8");
    const todo = source + board + changes;

    for (const ancla of ANCLAS) {
      expect(todo, `#${ancla} no lleva a ningún sitio`).toContain(`id="${ancla}"`);
    }
  });

  it("la limpieza vive en Mantenimiento y no mezclada con Detalles", () => {
    const mantenimientoDesde = source.indexOf('<ProjectViewFrame view="dependencias"');
    const mantenimientoHasta = source.indexOf("</ProjectViewFrame>", mantenimientoDesde);
    const mantenimiento = source.slice(mantenimientoDesde, mantenimientoHasta);
    const detallesDesde = source.indexOf('<ProjectViewFrame view="detalles"');
    const detallesHasta = source.indexOf("</ProjectViewFrame>", detallesDesde);
    const detalles = source.slice(detallesDesde, detallesHasta);

    expect(mantenimiento).toContain("<UnusedAssets");
    expect(detalles).not.toContain("<UnusedAssets");
  });
});
