import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TASTE_CAP,
  TasteFullError,
  parseTaste,
  readTaste,
  renderTaste,
  tasteDigest,
  type TasteLine,
  worstBlock,
  writeTaste,
} from "./taste";

/**
 * What must be maintained here is not that a file is written and read — anything can do that — but
 * the four promises for which this module exists:
 *
 * 1. **It can be read and it can be edited.** A portrait that only the program that wrote it
 * understands is an impostor. So the hard test is not the clean back-and-forth; it is the file
 * that someone has already touched: reordered, with extra blank lines, with a dash handwritten
 * without any quotation marks, with a renamed section, and with Windows line endings. None of that
 * can make a rule disappear or throw an exception.
 * 2. **The limit bursts, it does not compact.** When it doesn't fit, you have to check the error
 * with the numbers inside and the previous snapshot intact on the disk. A save that silently trims
 * leaves a file with the same usual appearance and content that no one approved.
 * 3. **The limit measures the portrait, not the file.** Providing evidence for a rule that already
 * exists cannot force the deletion of another rule.
 * 4. **There is never a half file.** Neither after an error, nor after two writes at the same
 * time.
 *
 * The tests use `PANOMA_HOME` and not the parameter `home` except where the parameter is what is
 * being tested: the variable is the same that separates two real catalogs, so it also tests the
 * path that people use.
 */

let root = "";
let cases = 0;
let previous: string | undefined;

beforeAll(() => {
  // `realpathSync` because on macOS `/var` is a link to `/private/var`, and here manually written
  // paths are compared to those resolved by the module.
  root = realpathSync(mkdtempSync(join(tmpdir(), "panoma-retrato-")));
  previous = process.env["PANOMA_HOME"];
});

afterAll(() => {
  // Return the variable as it was, do not delete it: the vitest process is just one, and the next
  // test file inherits the environment we leave.
  if (previous === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previous;
  rmSync(root, { recursive: true, force: true });
});

/**
 * A new Panoma house for each case, marked with `PANOMA_HOME`.
 *
 * The folder **is not created** unless a file needs to be placed inside: thus the common case is
 * that of a newly installed machine, where `~/.panoma` does not yet exist.
 */
function newHome(contents?: string): string {
  cases += 1;
  const home = join(root, `caso-${cases}`, ".panoma");
  process.env["PANOMA_HOME"] = home;

  if (contents !== undefined) {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "TASTE.md"), contents, "utf8");
  }

  return home;
}

function onDisk(home: string): string {
  return readFileSync(join(home, "TASTE.md"), "utf8");
}

/** An identifier with the real form: the sha1 of `saveVerdicts`, forty hexadecimals. */
function id(seed: string): string {
  return seed.repeat(40).slice(0, 40);
}

function line(
  topic: TasteLine["topic"],
  statement: string,
  ...citations: string[]
): TasteLine {
  return { topic, statement, citations };
}

/** Phrases of known length, in order to reason about the limit without guessing. */
function frases(count: number, prefix: string, length = 60): TasteLine[] {
  return Array.from({ length: count }, (_, i) => {
    const text = `${prefix} ${i} `.padEnd(length, "x");
    return line("other", text);
  });
}

/**
 * That only the owner can touch the file, in the language of each system. What’s inside is not a
 * secret, but it lives next to the providers' credentials and whoever can **write it** is
 * dictating instructions to all the user's agents.
 */
async function soloSuDueno(path: string): Promise<void> {
  if (process.platform !== "win32") {
    expect(statSync(path).mode & 0o777).toBe(0o600);
    return;
  }

  const { stdout } = await promisify(execFile)("icacls", [path]);
  expect(stdout, stdout).not.toMatch(/\b(Everyone|Todos)\b/i);
  expect(stdout, stdout).not.toMatch(/BUILTIN\\(Users|Usuarios)/i);
}

describe("el ida y vuelta", () => {
  const lines = [
    line("other", "Las cifras se cuentan del disco, nunca se estiman.", id("a"), id("b")),
    line("design", "La portada abre con una frase, no con tres columnas de iconos."),
    line("cli", "Un comando contesta en una línea o se calla.", id("c")),
    line("copy", "El README dice qué es antes de decir cómo se instala.", id("d")),
    line("frontend", "Nada de modales para confirmar algo que se puede deshacer."),
  ];

  it("las frases y sus citas vuelven enteras", () => {
    const profile = parseTaste(renderTaste(lines));

    expect(profile.lines).toHaveLength(lines.length);
    for (const original of lines) {
      const found = profile.lines.find((l) => l.statement === original.statement);
      expect(found, original.statement).toBeDefined();
      expect(found?.topic).toBe(original.topic);
      expect(found?.citations).toEqual(original.citations);
    }
  });

  it("escribirlo dos veces da los mismos bytes", () => {
    // It's what makes a save that doesn't change anything not overwrite the file.
    const once = renderTaste(lines);
    expect(renderTaste(parseTaste(once).lines)).toBe(once);
  });

  it("los temas salen siempre en el mismo orden, entren en el que entren", () => {
    const desordenadas = [lines[3]!, lines[2]!, lines[0]!, lines[4]!, lines[1]!];

    expect(renderTaste(desordenadas)).toBe(renderTaste(lines));
    // The order of `TASTE_TOPICS`, and `other` the last: is the drawer, not the cover.
    expect(parseTaste(renderTaste(desordenadas)).lines.map((l) => l.topic)).toEqual([
      "design",
      "frontend",
      "cli",
      "copy",
      "other",
    ]);
  });

  /*
    A topic that the vocabulary does not cover has to survive the back and forth, because the
    classifier can coin it and a whitelist would send it to `other` on the first read—silently
    deleting the material that the machine had just discovered. Behind the fields and in
    alphabetical order, which is the only rule that does not depend on the order in which the rows
    arrived.
   */
  it("un tema acuñado sobrevive, y va detrás de los sembrados", () => {
    const acunados = [line("infra", "Una."), line("cli", "Otra."), line("accesibilidad", "Y tres.")];
    const text = renderTaste(acunados);

    expect(text).toContain("## accesibilidad");
    expect(parseTaste(text).lines.map((l) => l.topic)).toEqual(["cli", "accesibilidad", "infra"]);
    expect(renderTaste(parseTaste(text).lines)).toBe(text);
  });

  it("un retrato sin ninguna línea se escribe como cero bytes", () => {
    // A single header is a file that promises a portrait and shows a blank form. And so `chars`
    // measures what exists, not what it would cost to have it.
    expect(renderTaste([])).toBe("");
    expect(parseTaste("").lines).toEqual([]);
    expect(parseTaste("").chars).toBe(0);
  });

  it("y se guarda donde se puede abrir con un editor", async () => {
    const home = newHome();

    const saved = await writeTaste(lines);
    const text = onDisk(home);

    expect(saved.cap).toBe(TASTE_CAP);
    expect(text).toContain("## design");
    expect(text).toContain("- Un comando contesta en una línea o se calla.");
    expect(text).toContain(`<!-- panoma: ${id("c")} -->`);
    expect((await readTaste()).lines).toEqual(saved.lines);
    await soloSuDueno(join(home, "TASTE.md"));
  });
});

describe("el tope", () => {
  it("cuando no cabe lanza, y lleva la cifra y el tope dentro", async () => {
    newHome();

    // Sixty sentences of sixty characters: well above three thousand.
    const caught: unknown = await writeTaste(frases(60, "regla")).catch((e: unknown) => e);

    expect(caught, "no lanzó nada").toBeInstanceOf(TasteFullError);
    // The `expect` above would have already failed; this is what narrows the type.
    if (!(caught instanceof TasteFullError)) return;

    expect(caught.cap).toBe(TASTE_CAP);
    expect(caught.chars).toBeGreaterThan(TASTE_CAP);
    expect(caught.name).toBe("TasteFullError");
  });

  it("y no toca el retrato que ya estaba", async () => {
    const home = newHome();
    const bueno = [line("cli", "Una línea por comando.", id("a"))];

    await writeTaste(bueno);
    const antes = onDisk(home);

    await expect(writeTaste([...bueno, ...frases(60, "regla")])).rejects.toBeInstanceOf(
      TasteFullError,
    );

    // Not cropped, not halfway, not empty: exactly what the user had approved.
    expect(onDisk(home)).toBe(antes);
    expect((await readTaste()).lines).toEqual(bueno);
    expect(readdirSync(home)).toEqual(["TASTE.md"]);
  });

  it("las citas no gastan presupuesto", async () => {
    const home = newHome();
    const sinCitas = frases(30, "regla");
    const conCitas = sinCitas.map((l) => ({
      ...l,
      citations: [id("a"), id("b"), id("c"), id("d")],
    }));

    const magro = parseTaste(renderTaste(sinCitas));
    const saved = await writeTaste(conCitas);

    // The same account: providing one more proof for an existing rule cannot force the deletion of
    // another rule. See header of the module.
    expect(saved.chars).toBe(magro.chars);
    expect(saved.chars).toBeLessThan(TASTE_CAP);
    // And the file weighs much more than the limit, which is exactly what was expected.
    expect(onDisk(home).length).toBeGreaterThan(TASTE_CAP);
  });
});

describe("un fichero que alguien ya editó", () => {
  it("reordenado, con huecos, con guiones sin cita y con asteriscos", async () => {
    const home = newHome(
      [
        "# Taste",
        "",
        "Apuntes míos que no son reglas y que no hacen falta para nada.",
        "",
        "",
        "## cli",
        "",
        "* Un comando contesta en una línea o se calla.",
        "",
        "1. Nada de barras de progreso para algo que tarda medio segundo.",
        "",
        "## other",
        "  - Las cifras se cuentan del disco.   <!-- panoma: " + id("a") + " -->",
        "- Nada de degradados salvo en la portada.",
        "",
      ].join("\n"),
    );

    const profile = await readTaste();

    // When reading, the order of the file comes out, which is the one the person left; the fixed
    // order of the sections is set by `renderTaste` when rewriting, not by reading.
    expect(profile.lines).toEqual([
      {
        topic: "cli",
        statement: "Un comando contesta en una línea o se calla.",
        citations: [],
      },
      {
        topic: "cli",
        statement: "Nada de barras de progreso para algo que tarda medio segundo.",
        citations: [],
      },
      {
        topic: "other",
        statement: "Las cifras se cuentan del disco.",
        citations: [id("a")],
      },
      {
        topic: "other",
        statement: "Nada de degradados salvo en la portada.",
        citations: [],
      },
    ]);

    // Loose prose is not rewritten, and that is said in the header: whatever one wants to preserve
    // is written as a script.
    await writeTaste(profile.lines);
    expect(onDisk(home)).not.toContain("Apuntes míos");
  });

  it("con finales de línea de Windows", async () => {
    const marcada = `- La portada abre con una frase. <!-- panoma: ${id("b")} -->`;
    newHome(["## design", "", marcada, ""].join("\r\n"));

    const profile = await readTaste();

    // Not a single `\r` hanging: it would end up inside the sentence and count toward the limit.
    expect(profile.lines).toEqual([
      { topic: "design", statement: "La portada abre con una frase.", citations: [id("b")] },
    ]);
    expect(profile.chars).toBe(parseTaste(renderTaste(profile.lines)).chars);
  });

  it("una sección que no existe cae en general en vez de perderse", async () => {
    newHome(
      [
        "## Landing page",
        "- Nada de carruseles.",
        "",
        "### COPY",
        "- Un ejemplo por página.",
      ].join("\n"),
    );

    const profile = await readTaste();

    // `## Landing page` is not a section: its rule applies excessively, which is visible, instead
    // of disappearing, which is not visible. `### COPY` is — the comparison does not consider
    // capitalization.
    expect(profile.lines).toEqual([
      { topic: "other", statement: "Nada de carruseles.", citations: [] },
      { topic: "copy", statement: "Un ejemplo por página.", citations: [] },
    ]);
  });

  it("un guion dentro de una valla de código no es una regla", async () => {
    newHome(
      ["## copy", "", "Así se escribe una regla:", "", "```md", "- Ejemplo.", "```"].join("\n"),
    );

    expect((await readTaste()).lines).toEqual([]);
  });

  it("un comentario que no lleva la marca no es una cita", async () => {
    newHome(["## frontend", "- Nada de modales. <!-- pendiente de revisar -->"].join("\n"));

    const profile = await readTaste();

    expect(profile.lines).toEqual([
      {
        topic: "frontend",
        // Neutralized upon rereading it, so that it cannot open a fake brand later.
        statement: "Nada de modales. <! -- pendiente de revisar -- >",
        citations: [],
      },
    ]);
    const escrito = renderTaste(profile.lines);
    expect(renderTaste(parseTaste(escrito).lines)).toBe(escrito);
  });

  it("un guion que solo trae la marca no es una regla", async () => {
    const sola = `- <!-- panoma: ${id("a")} -->`;
    newHome(["## cli", sola, "-", "- Una línea por comando."].join("\n"));

    expect((await readTaste()).lines).toEqual([
      { topic: "cli", statement: "Una línea por comando.", citations: [] },
    ]);
  });
});

describe("leer nunca lanza", () => {
  it("sin fichero, retrato vacío", async () => {
    newHome();

    const profile = await readTaste();

    expect(profile.lines).toEqual([]);
    expect(profile.chars).toBe(0);
    expect(profile.cap).toBe(TASTE_CAP);
  });

  it("con el fichero vacío, retrato vacío", async () => {
    newHome("");

    expect((await readTaste()).lines).toEqual([]);
  });

  it("con basura dentro, retrato vacío", async () => {
    newHome("\0binario\0{[}]<>ÿ\n%PDF-1.4\n");

    expect((await readTaste()).lines).toEqual([]);
  });

  it("con un directorio donde iba el fichero, retrato vacío", async () => {
    // The `EISDIR` that can occur in the three systems, without depending on `chmod 000` meaning
    // anything.
    const home = newHome();
    mkdirSync(join(home, "TASTE.md"), { recursive: true });

    expect((await readTaste()).lines).toEqual([]);
  });
});

describe("el resumen para AGENTS.md", () => {
  const lines = [
    line("other", "Las cifras se cuentan del disco, nunca se estiman.", id("a"), id("b")),
    line("other", "Nada de degradados salvo en la portada.", id("c")),
    line("cli", "Un comando contesta en una línea o se calla.", id("d")),
  ];

  it("tira las citas: al agente le hace falta la regla, no la prueba", () => {
    const profile = parseTaste(renderTaste(lines));

    const summary = tasteDigest(profile, TASTE_CAP);

    expect(summary).toContain("Las cifras se cuentan del disco, nunca se estiman.");
    expect(summary).toContain("Un comando contesta en una línea o se calla.");
    for (const seed of ["a", "b", "c", "d"]) {
      expect(summary, seed).not.toContain(id(seed));
    }
    expect(summary).not.toContain("<!--");
  });

  it("respeta maxChars sin partir ninguna frase", () => {
    const profile = parseTaste(renderTaste(lines));

    for (const budget of [0, 10, 40, 70, 120, 200, profile.chars]) {
      const summary = tasteDigest(profile, budget);
      expect(summary.length, `presupuesto ${budget}`).toBeLessThanOrEqual(budget);

      // Cutting a sentence can reverse it: 'do not use gradients except on the cover' cut is 'do
      // not use gradients'. So either all of it, or none.
      for (const l of profile.lines) {
        const trozo = summary.includes(l.statement.slice(0, 12));
        expect(trozo === summary.includes(l.statement), l.statement).toBe(true);
      }
    }
  });

  it("con presupuesto de sobra sale entero, y eso es lo que mide chars", () => {
    const profile = parseTaste(renderTaste(lines));

    expect(tasteDigest(profile, TASTE_CAP).length).toBe(profile.chars);
    expect(tasteDigest(profile, profile.chars - 1).length).toBeLessThan(profile.chars);
  });

  it("subir el presupuesto solo añade", () => {
    // The summary is always a preface to the portrait, not a selection made by lengths.
    const profile = parseTaste(renderTaste(lines));
    let anterior = "";

    for (let budget = 0; budget <= profile.chars; budget += 7) {
      const summary = tasteDigest(profile, budget);
      expect(summary.startsWith(anterior), `presupuesto ${budget}`).toBe(true);
      anterior = summary;
    }
  });
});

describe("guardar", () => {
  it("dos escrituras a la vez no dejan un fichero a medias", async () => {
    const home = newHome();
    const uno = frases(20, "uno");
    const dos = frases(20, "dos");

    /*
      `allSettled` and not `all`: in Windows, renaming over a destination that another thread in
      the pool is replacing can fail with EPERM, and that is not the failure that this test is
      aiming for. What needs to be ensured is that the disk contains **a complete portrait**,
      never a mix of both or a half-cut one, and that neither of the two writes leaves its
      temporary file behind.
     */
    const results = await Promise.allSettled([writeTaste(uno), writeTaste(dos)]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);

    const profile = await readTaste();
    const statements = profile.lines.map((l) => l.statement);
    const posibles = [uno, dos].map((set) =>
      parseTaste(renderTaste(set)).lines.map((l) => l.statement),
    );

    expect(posibles).toContainEqual(statements);
    expect(readdirSync(home)).toEqual(["TASTE.md"]);
  });

  it("el parámetro `home` escribe donde dice, sin pasar por el entorno", async () => {
    // It is the path of someone who already knows where their catalog is and does not want to touch
    // the environment of the process to tell a function.
    newHome();
    const aparte = join(root, `aparte-${cases}`);

    await writeTaste([line("copy", "Un ejemplo por página.")], aparte);

    const escrito = readFileSync(join(aparte, "TASTE.md"), "utf8");
    expect(escrito).toContain("- Un ejemplo por página.");
    // And the environment's home was left untouched.
    expect((await readTaste()).lines).toEqual([]);
    expect((await readTaste(aparte)).lines).toEqual([
      { topic: "copy", statement: "Un ejemplo por página.", citations: [] },
    ]);
  });

  it("guardar un retrato vacío lo borra sin borrar el fichero", async () => {
    const home = newHome();
    await writeTaste([line("cli", "Una línea por comando.")]);

    const saved = await writeTaste([]);

    expect(saved.lines).toEqual([]);
    expect(saved.chars).toBe(0);
    expect(onDisk(home)).toBe("");
  });
});

/**
 * The scope: which phrases go down to all projects and which only to yours.
 *
 * It is the answer to the only question that a human answers correctly by reading a sentence about
 * themselves —“does this also apply to my other projects?”— and it is what makes the limit stop
 * pressing: what an agent reads is the general plus what belongs to **their** project, not the
 * whole portrait. The case that revealed it: “you want the app to work like an audio tray,” true
 * in `linkaloud` and absurd in the app that stores a car's history.
 */
describe("el alcance de una frase", () => {
  const global = { topic: "frontend", statement: "Quieres que todo comparta la misma UI." } as const;
  const solo = {
    topic: "frontend",
    statement: "Quieres una bandeja de audio.",
    scope: "linkaloud",
  } as const;

  it("se escribe delante y se lee de vuelta", () => {
    const text = renderTaste([{ ...solo, citations: [] }]);
    expect(text).toContain("- only in linkaloud: Quieres una bandeja de audio.");
    expect(parseTaste(text).lines[0]).toMatchObject({
      statement: "Quieres una bandeja de audio.",
      scope: "linkaloud",
    });
  });

  it("una frase sin alcance no gana ninguno al ir y volver", () => {
    const text = renderTaste([{ ...global, citations: [] }]);
    expect(text).not.toContain("only in");
    expect(parseTaste(text).lines[0]).not.toHaveProperty("scope");
  });

  /* The file is edited by hand: whoever writes 'Only In X:' means the same thing. */
  it("se lee escrito de cualquier forma", () => {
    const leido = parseTaste("## frontend\n- Only  In  dricopilot :  Una cosa.\n");
    expect(leido.lines[0]).toMatchObject({ statement: "Una cosa.", scope: "dricopilot" });
  });

  /*
    A sentence that **starts** with 'only in' and does not qualify anything has to survive whole.
    Without the limitation of the name, half a handwritten rule would be read as the name of a
    project.
   */
  it("una frase larga que empieza igual no se convierte en alcance", () => {
    const larga = `Only in the cases where ${"x".repeat(80)}: no hagas nada.`;
    const leido = parseTaste(`## frontend\n- ${larga}\n`);
    expect(leido.lines[0]!.statement).toBe(larga);
    expect(leido.lines[0]).not.toHaveProperty("scope");
  });

  it("un guion que solo trae el alcance no es una regla", () => {
    expect(parseTaste("## frontend\n- only in dricopilot:\n").lines).toHaveLength(0);
  });

  it("la marca de citas sigue funcionando con alcance delante", () => {
    const text = renderTaste([{ ...solo, citations: ["abc123"] }]);
    const leido = parseTaste(text).lines[0];
    expect(leido).toMatchObject({ scope: "linkaloud", citations: ["abc123"] });
  });

  it("el ida y vuelta da los mismos bytes", () => {
    const lines = [
      { ...global, citations: [] },
      { ...solo, citations: ["abc123"] },
    ];
    const una = renderTaste(lines);
    expect(renderTaste(parseTaste(una).lines)).toBe(una);
  });
});

describe("el resumen que baja a cada proyecto", () => {
  const lines: TasteLine[] = [
    { topic: "frontend", statement: "Global.", citations: [] },
    { topic: "frontend", statement: "De linkaloud.", citations: [], scope: "linkaloud" },
    { topic: "frontend", statement: "De dricopilot.", citations: [], scope: "dricopilot" },
  ];
  const profile = parseTaste(renderTaste(lines));

  it("un proyecto recibe lo global y lo suyo, y nada de los demás", () => {
    const bloque = tasteDigest(profile, Infinity, "linkaloud");
    expect(bloque).toContain("Global.");
    expect(bloque).toContain("De linkaloud.");
    expect(bloque).not.toContain("De dricopilot.");
  });

  it("un proyecto sin frases propias recibe solo lo global", () => {
    const bloque = tasteDigest(profile, Infinity, "otro");
    expect(bloque).toContain("Global.");
    expect(bloque).not.toContain("De linkaloud.");
  });

  /*
    Without a project, the entire portrait is seen: it is the view of the one who reviews it, not
    the one that is published.
   */
  it("sin proyecto entra todo", () => {
    const bloque = tasteDigest(profile, Infinity);
    expect(bloque).toContain("De linkaloud.");
    expect(bloque).toContain("De dricopilot.");
  });
});

/**
 * The top goes on to measure what **an** agent reads, not the entire portrait.
 *
 * Before, two hundred sentences spread across one hundred twelve projects collided against 3,000
 * characters even though no agent was going to read more than ten. What the limit protects is the
 * context window of a session, and in a session only one project fits.
 */
describe("qué mide el tope", () => {
  it("un retrato sin alcances mide lo mismo que antes", () => {
    const lines = [
      { topic: "frontend" as const, statement: "Una.", citations: [] },
      { topic: "cli" as const, statement: "Otra.", citations: [] },
    ];
    expect(worstBlock(lines)).toBe(tasteDigest(parseTaste(renderTaste(lines)), Infinity).length);
  });

  it("las frases de dos proyectos distintos no se suman", () => {
    const largo = "x".repeat(200);
    const lines = [
      { topic: "frontend" as const, statement: `A ${largo}`, citations: [], scope: "uno" },
      { topic: "frontend" as const, statement: `B ${largo}`, citations: [], scope: "dos" },
    ];
    const entero = tasteDigest(parseTaste(renderTaste(lines)), Infinity).length;
    expect(worstBlock(lines)).toBeLessThan(entero);
    expect(worstBlock(lines)).toBeGreaterThan(200);
  });

  it("lo global sí se suma a lo de cada proyecto", () => {
    const lines = [
      { topic: "frontend" as const, statement: "Global.", citations: [] },
      { topic: "frontend" as const, statement: "Propia.", citations: [], scope: "uno" },
    ];
    expect(worstBlock(lines)).toBeGreaterThan(worstBlock([lines[0]!]));
  });
});
