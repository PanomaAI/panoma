import { describe, expect, it } from "vitest";
import type { TasteLine } from "@panoma/core";
import { countProjectTaste, tasteForProject } from "./project-taste";

/**
 * The portrait seen from a project.
 *
 * What needs to be proven is that it filters **the same** as the summary that the agents read: the
 * global always and the limited only here. If the two diverge, the screen promises "this is what
 * your agents read here" and the channel delivers something else, which is the budget card failure
 * again.
 */

function line(patch: Partial<TasteLine> = {}): TasteLine {
  return {
    topic: "design",
    statement: "Quieres la portada con aire.",
    citations: [],
    ...patch,
  } as TasteLine;
}

describe("el retrato de un proyecto", () => {
  it("lo global rige en todas partes", () => {
    const topics = tasteForProject([line()], "travocato");
    expect(topics).toEqual([
      { topic: "design", lines: [{ statement: "Quieres la portada con aire.", only: false }] },
    ]);
  });

  it("lo acotado a este proyecto rige, y va marcado", () => {
    const topics = tasteForProject([line({ scope: "travocato" })], "travocato");
    expect(topics[0]?.lines[0]?.only).toBe(true);
  });

  it("lo acotado a otro proyecto no rige aquí", () => {
    expect(tasteForProject([line({ scope: "otro" })], "travocato")).toEqual([]);
  });

  /*
    The order of the subjects comes from `topicsOf`, which is the same with which the file is
    written: those sown by their order and the minted ones behind, alphabetical.
   */
  it("agrupa por materia en el orden en que se escribe el fichero", () => {
    const topics = tasteForProject(
      [
        line({ topic: "zumba", statement: "Una acuñada." }),
        line({ topic: "workflow", statement: "Una de trabajo." }),
        line({ topic: "design", statement: "Una de diseño." }),
      ],
      "travocato",
    );
    expect(topics.map((one) => one.topic)).toEqual(["design", "workflow", "zumba"]);
  });

  it("una materia que se queda sin frases aquí no sale", () => {
    const topics = tasteForProject(
      [line({ topic: "backend", scope: "otro", statement: "Solo de otro." }), line()],
      "travocato",
    );
    expect(topics.map((one) => one.topic)).toEqual(["design"]);
  });

  /* Just like when writing: a sentence that comes to nothing does not take up an empty line. */
  it("una frase en blanco no cuenta", () => {
    expect(tasteForProject([line({ statement: "   " })], "travocato")).toEqual([]);
  });

  it("el espacio se colapsa, como al escribir el fichero", () => {
    const topics = tasteForProject([line({ statement: "  Quieres   aire.  " })], "travocato");
    expect(topics[0]?.lines[0]?.statement).toBe("Quieres aire.");
  });

  it("cuenta cuántas rigen y cuántas son solo de aquí", () => {
    const topics = tasteForProject(
      [line(), line({ statement: "Otra.", scope: "travocato" }), line({ topic: "copy" })],
      "travocato",
    );
    expect(countProjectTaste(topics)).toEqual({ total: 3, only: 1 });
  });

  it("sin retrato no hay nada que enseñar", () => {
    expect(tasteForProject([], "travocato")).toEqual([]);
    expect(countProjectTaste([])).toEqual({ total: 0, only: 0 });
  });
});
