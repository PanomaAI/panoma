import { describe, expect, it } from "vitest";
import {
  mergeNorths,
  northArgs,
  northLines,
  projectLines,
  savedLines,
  type NorthProject,
} from "./north-command";
import type { ProjectMoves } from "./next-command";

/**
 * `panoma north` is tested for what it decides and for what it renders, not by starting the
 * process.
 *
 * Same rule as in `next-command.ts` and in `twin-command.ts`: pulling up a catalog to check a
 * layout would be slow here and red in CI on Windows without anything being broken. What has its
 * own logic here are three things and all three are pure: what has been requested, what is known
 * about the north of each project, and how it is said.
 *
 * What is being monitored is not the layout —which will change— but the promises of the outcome:
 *
 * - that a project that the report does **not** include is not counted as one without direction,
 * which is the only way this screen can lie about something the person wrote;
 * - that the count of those missing be calculated over the total catalog and not over what the
 * report brought, because a percentage with the wrong denominator is not data;
 * - that to replace a north always teaches the one who is carried away;
 * - and that the phrase written without quotation marks reaches the path whole and not split by
 * the shell.
 */

/** The escape of the colors, written in code so as not to put a control character here. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const API = "http://localhost:4173";

const NORTH = "Terminado = que mi hermano lo instale sin llamarme por teléfono.";

function plain(lines: string[]): string {
  return lines.join("\n").replace(ANSI, "");
}

function row(slug: string): { slug: string; name: string; root: string } {
  return { slug, name: slug, root: `/Users/x/${slug}` };
}

function moves(slug: string, north: string | null): ProjectMoves {
  return { slug, name: slug, north, moves: [] };
}

function project(overrides: Partial<NorthProject> = {}): NorthProject {
  return {
    slug: "demo",
    name: "Demo",
    root: "/Users/x/demo",
    status: { kind: "written", north: NORTH },
    ...overrides,
  };
}

describe("qué se ha pedido", () => {
  it("sin argumentos, la lista", () => {
    expect(northArgs([])).toEqual({ mode: "list" });
  });

  it("con un proyecto, su norte", () => {
    expect(northArgs(["cabeman"])).toEqual({ mode: "show", slug: "cabeman" });
  });

  it("con una frase detrás, la escritura", () => {
    expect(northArgs(["cabeman", NORTH])).toEqual({
      mode: "write",
      slug: "cabeman",
      phrase: NORTH,
    });
  });

  it("la frase escrita sin comillas llega entera y no partida", () => {
    // The shell has already split it by the spaces. Keeping the first word would be losing exactly
    // what the person came to say, and the path collapses the whites anyway.
    const args = northArgs(["cabeman", "Terminado", "=", "que", "compile"]);
    expect(args).toEqual({ mode: "write", slug: "cabeman", phrase: "Terminado = que compile" });
  });

  it("una frase vacía sigue siendo una escritura, para que conteste el catálogo", () => {
    // Who types `panoma north demo ""` wants to write. The one who has to tell them that there is
    // no phrase is the route, with its message, and not an extra check on this side.
    expect(northArgs(["demo", ""])).toEqual({ mode: "write", slug: "demo", phrase: "" });
  });
});

describe("lo que se sabe del norte de cada proyecto", () => {
  it("el que el parte trae escrito se lee entero", () => {
    const [uno] = mergeNorths([row("demo")], [moves("demo", NORTH)]);
    expect(uno?.status).toEqual({ kind: "written", north: NORTH });
  });

  it("el que el parte trae vacío es uno sin contestar", () => {
    const [uno] = mergeNorths([row("demo")], [moves("demo", null)]);
    expect(uno?.status).toEqual({ kind: "blank" });
  });

  it("un norte de solo espacios cuenta como no escrito", () => {
    // The same criterion as `written()` in `next-moves.ts`, and here it matters twice as much: if
    // given in writing, the following deed would be announced as a substitution.
    const [uno] = mergeNorths([row("demo")], [moves("demo", "   ")]);
    expect(uno?.status).toEqual({ kind: "blank" });
  });

  it("el que el parte no trae no es uno sin norte: es uno que no se puede leer", () => {
    /*
      The director's first rule proposes writing down the north whenever it is not there and
      applies to any project, so every project without a north travels in the part. One that does
      not travel has its own written; what there is no way to do is read the sentence.
     */
    const [uno] = mergeNorths([row("callado")], []);
    expect(uno?.status).toEqual({ kind: "unlisted" });
  });

  it("la ruta viaja con el proyecto, para poder escribir el escaneo exacto", () => {
    const [uno] = mergeNorths([row("demo")], [moves("demo", NORTH)]);
    expect(uno?.root).toBe("/Users/x/demo");
  });
});

describe("la lista", () => {
  it("enseña el norte escrito junto al slug que hay que teclear", () => {
    const salida = plain(northLines(mergeNorths([row("demo")], [moves("demo", NORTH)])));
    expect(salida).toContain("demo");
    expect(salida).toContain(`“${NORTH}”`);
  });

  it("cuenta los que faltan sobre el catálogo entero, no sobre lo que trajo el parte", () => {
    const catalogo = [row("uno"), row("dos"), row("tres")];
    const parte = [moves("uno", null), moves("dos", NORTH)];

    const salida = plain(northLines(mergeNorths(catalogo, parte)));

    expect(salida, "el denominador es el catálogo").toContain("1 of 3 projects");
    expect(salida, "y el que no viaja se cuenta aparte, sin darlo por vacío").toContain(
      "Norths written that can’t be read from here: 1",
    );
  });

  it("los que el parte no trae no engordan la cuenta de los que faltan", () => {
    const catalogo = [row("uno"), row("dos")];
    const salida = plain(northLines(mergeNorths(catalogo, [moves("uno", null)])));
    expect(salida).toContain("1 of 2 projects");
    expect(salida).not.toContain("2 de 2");
  });

  it("cuando no le falta a ninguno lo dice, y no cuenta un cero", () => {
    const salida = plain(northLines(mergeNorths([row("demo")], [moves("demo", NORTH)])));
    expect(salida).toContain("1 project in the catalog");
    expect(salida).not.toContain("No north written");
  });

  it("un catálogo vacío manda a escanear, con las palabras del parte", () => {
    const salida = plain(northLines([]));
    expect(salida).toContain("Empty catalog: nothing scanned yet.");
    expect(salida).not.toContain("No north written");
  });

  it("un norte larguísimo no parte la línea, y se dice cómo leerlo entero", () => {
    const largo = `Terminado = ${"que ruede ".repeat(30)}`.trim();
    const salida = plain(northLines(mergeNorths([row("demo")], [moves("demo", largo)])));
    const linea = salida.split("\n").find((one) => one.includes("Terminado"));
    expect(linea!.length).toBeLessThan(96);
    expect(linea).toContain("…");
  });

  it("en inglés sale entera, sin media línea en castellano", () => {
    const catalogo = [row("uno"), row("dos"), row("tres")];
    const parte = [moves("uno", null), moves("dos", NORTH)];

    const salida = plain(northLines(mergeNorths(catalogo, parte)));

    expect(salida).toContain("No north written: 1 of 3 projects.");
    expect(salida).toContain("panoma north <project>");
    expect(salida, "ni una palabra suelta del otro idioma").not.toContain("Sin norte");
  });
});

describe("un proyecto solo", () => {
  it("con norte escrito, la frase entera y cómo reescribirla", () => {
    const salida = plain(projectLines(project(), API));
    expect(salida).toContain(`“${NORTH}”`);
    expect(salida, "el comando llega con el slug puesto").toContain(
      'panoma north demo "…"',
    );
  });

  it("sin norte, la invitación con el comando y la ficha como segunda opción", () => {
    const salida = plain(projectLines(project({ status: { kind: "blank" } }), API));

    expect(salida, "la misma pregunta que hace panoma next").toContain(
      "Nobody has written what “finished” means here",
    );
    expect(salida).toContain('panoma north demo "…"');
    expect(salida, "y la ficha detrás, no delante").toContain(`${API}/p/demo`);
  });

  it("el que el parte no trae lo dice, en vez de enseñarlo en blanco", () => {
    const salida = plain(projectLines(project({ status: { kind: "unlisted" } }), API));
    expect(salida).toContain("can’t read it");
    expect(salida, "no es una invitación a escribirlo encima").not.toContain(
      "Nadie ha escrito",
    );
  });
});

describe("el recibo de la escritura", () => {
  it("sustituir enseña la frase nueva y la que se lleva por delante", () => {
    const vieja = "Terminado = que compile.";
    const salida = plain(
      savedLines(project({ status: { kind: "written", north: vieja } }), NORTH),
    );

    expect(salida).toContain("North replaced in Demo");
    expect(salida).toContain(`“${NORTH}”`);
    expect(salida, "el eco de lo que había es la última vez que se puede leer").toContain(
      `“${vieja}”`,
    );
  });

  it("escribir el primero no inventa una sustitución", () => {
    const salida = plain(savedLines(project({ status: { kind: "blank" } }), NORTH));
    expect(salida).toContain("North written in Demo");
    expect(salida).not.toContain("Sustituye");
  });

  it("lo forzado a ciegas se cuenta como lo que fue: una sustitución sin eco", () => {
    // One only gets here with `--force`, and the report didn't bring the project: not bringing it
    // means it had a direction. Writing 'written direction' would be the only phrase in the command
    // that downplays what just happened.
    const salida = plain(savedLines(project({ status: { kind: "unlisted" } }), NORTH));
    expect(salida).toContain("North replaced in Demo");
    expect(salida).toContain("The one that was there couldn’t be read, so not even an echo of it is left.");
  });

  it("un proyecto sin nombre se dice por su slug", () => {
    const salida = plain(savedLines(project({ name: "" }), NORTH));
    expect(salida).toContain("demo");
  });
});
