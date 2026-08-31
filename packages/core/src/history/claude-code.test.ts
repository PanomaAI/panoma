import { Buffer } from "node:buffer";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectSignals, mineClaudeCode } from "./claude-code";

/**
 * The seven rules of the parser came from counting false positives by hand over the real corpus of
 * this machine —1.78 GB, 778 files, 55,338 tool results—. That corpus cannot be put into a test,
 * so here is the opposite: minimal transcripts in a temporary file, one per rule, each with the
 * exact case that made it necessary.
 *
 * The files are written with `.jsonl` for real and are read with the truth function, without
 * exposing the parser internally. If tomorrow the reader changes from `readline` to something
 * else, this still works; if it stops excluding the tool results, it fails.
 */

type Line = Record<string, unknown> | string;

let root = "";
let cases = 0;

beforeAll(() => {
  // `realpathSync`: on macOS `/var` is a link to `/private/var`, and `cwd` is compared as text
  // against the path returned by `mkdtemp`.
  root = realpathSync(mkdtempSync(join(tmpdir(), "panoma-historial-")));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * A house with transcripts inside. The keys are `<carpeta-mangled>/<sesión>.jsonl`, and the order
 * in which they are declared is the order in time: the last one is the most recent.
 *
 * That antiquity is **hand-stamped**, separated by a minute, instead of leaving it to the clock.
 * `listTranscripts` sorts by `mtime` and breaks ties by path, and two `writeFileSync` followed by
 * two hundred bytes do not produce two different marks everywhere: on Linux —which is in the CI
 * matrix— the inode dates come from the kernel's cheap clock and 195 out of 200 pairs tie, and on
 * Windows the system clock jump is ~15 ms. In case of a tie, the tie is broken by path,
 * `-casa-anotes` is placed in front of `-casa-otro` and the sample from the `limit` test comes
 * from the wrong file: measured, it failed 28 out of 30 times on Linux and none on macOS, which is
 * where it was written.
 */
function makeHome(transcripts: Record<string, Line[]>): string {
  cases += 1;
  const home = join(root, `caso-${cases}`);
  let stamp = Date.UTC(2026, 7, 20, 10, 0, 0) / 1000;

  for (const [relative, lines] of Object.entries(transcripts)) {
    const file = join(home, ".claude", "projects", ...relative.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    // A string is written as is: this is how the corrupted lines are planted.
    const body = lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line)));
    writeFileSync(file, `${body.join("\n")}\n`, "utf8");
    utimesSync(file, stamp, stamp);
    stamp += 60;
  }

  return home;
}

const AT = "2026-08-20T10:00:00.000Z";
const CWD = "/casa/anotes/apps/web";

function assistant(text: string, extra: Record<string, unknown> = {}): Line {
  return {
    type: "assistant",
    sessionId: "sesion-1",
    timestamp: AT,
    message: { role: "assistant", content: [{ type: "text", text }] },
    ...extra,
  };
}

/** An assistant turn that taught you nothing: it only reasoned and called a tool. */
function silent(): Line {
  return {
    type: "assistant",
    sessionId: "sesion-1",
    timestamp: AT,
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Voy a mirar el fichero." },
        { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "a.ts" } },
      ],
    },
  };
}

function user(content: unknown, extra: Record<string, unknown> = {}): Line {
  return {
    type: "user",
    sessionId: "sesion-1",
    timestamp: AT,
    cwd: CWD,
    gitBranch: "master",
    message: { role: "user", content },
    ...extra,
  };
}

function toolResult(text: string): Line {
  return user([{ type: "tool_result", tool_use_id: "toolu_1", content: text }]);
}

/**
 * Well formed: without a single loose emoji.
 *
 * It is verified with the round trip through UTF-8 and not with `isWellFormed`, which is from
 * ES2024, and the `lib` of this repository is ES2023. It doesn’t matter: the trip is exactly what
 * awaits the appointment —the terminal, the catalog— and a loose substitute can’t handle it, it
 * returns turned into a diamond.
 */
function wellFormed(text: string): boolean {
  return Buffer.from(text, "utf8").toString("utf8") === text;
}

/**
 * A `gc()` really without starting vitest with `--expose-gc`.
 *
 * It is necessary because what is measured in the retention test is what **survives** a
 * collection, and without forcing it the figure would be the collector's noise. Two passes: the
 * first loosens what was left hanging from the sweep and the second collects what the first left
 * pending.
 */
function collect(): () => void {
  setFlagsFromString("--expose-gc");
  const gc = runInNewContext("gc") as () => void;
  setFlagsFromString("--no-expose-gc");
  return () => {
    gc();
    gc();
  };
}

describe("mineClaudeCode", () => {
  it("regla 1: descarta los resultados de herramienta aunque su type sea «user»", async () => {
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        assistant("He puesto el botón en la cabecera."),
        toolResult("export function boton() { return null; }"),
        user("no me gusta"),
      ],
    });

    const { stats, reactions } = await mineClaudeCode({ home });

    expect(stats.toolResults).toBe(1);
    expect(stats.userTurns).toBe(1);
    expect(reactions).toHaveLength(1);
    expect(reactions[0]?.reaction).toBe("no me gusta");
  });

  it("regla 1: una lista con un tool_result y texto tuyo sí es un turno", async () => {
    // The filter is by blocks, not by `type`: when you paste a result and on top of that you write,
    // that's when someone actually spoke, and losing it would be losing the entire reaction.
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        assistant("Ya compila."),
        user([
          { type: "tool_result", tool_use_id: "toolu_1", content: "ok" },
          { type: "text", text: "sigue mal" },
        ]),
      ],
    });

    const { stats, reactions } = await mineClaudeCode({ home });

    expect(stats.toolResults).toBe(0);
    expect(reactions[0]?.reaction).toBe("sigue mal");
  });

  it("regla 2: lee el contenido tanto si es cadena como si es lista de bloques", async () => {
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        assistant("Hecho."),
        user("quítalo"),
        assistant("Quitado."),
        user([
          { type: "text", text: "no era así" },
          { type: "image", source: { type: "base64", data: "AAAA" } },
          { type: "text", text: "vuelve a hacer la cabecera" },
        ]),
      ],
    });

    const { reactions } = await mineClaudeCode({ home });

    expect(reactions).toHaveLength(2);
    expect(reactions[0]?.reaction).toBe("quítalo");
    // The text blocks come together and the image block does not get in the way.
    expect(reactions[1]?.reaction).toBe("no era así\nvuelve a hacer la cabecera");
  });

  it("regla 3: descarta subagentes, metadatos y turnos que no escribiste tú", async () => {
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        assistant("Ya está la portada."),
        user("no me gusta el subagente", { isSidechain: true }),
        user("<system reminder de la herramienta>", { isMeta: true }),
        user("esto lo escribió la propia herramienta", { userType: "internal" }),
        user("esto sí lo escribí yo", { userType: "external" }),
      ],
    });

    const { stats, reactions } = await mineClaudeCode({ home });

    expect(stats.sidechain).toBe(1);
    expect(stats.userTurns).toBe(1);
    expect(reactions).toHaveLength(1);
    expect(reactions[0]?.reaction).toBe("esto sí lo escribí yo");
  });

  it("regla 4: descarta comandos de barra y avisos colados como turnos tuyos", async () => {
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        assistant("Listo."),
        user("<command-name>clear</command-name>"),
        user("<local-command-stdout>nada</local-command-stdout>"),
        user("<command-message>compact</command-message>"),
        user("[Request interrupted by user for tool use]"),
        user("Caveat: The messages below were generated by the user while running..."),
      ],
    });

    const { stats, reactions } = await mineClaudeCode({ home });

    expect(stats.commands).toBe(5);
    expect(stats.userTurns).toBe(0);
    expect(reactions).toHaveLength(0);
  });

  it("regla 4: un aviso del sistema colado entero no es un turno tuyo", async () => {
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        assistant("Listo."),
        user("<task-notification><task-id>abc</task-id><event>[Monitor stopped]</event></task-notification>"),
        user("<system-reminder>Recuerda usar la herramienta X</system-reminder>"),
      ],
    });

    const { stats, reactions } = await mineClaudeCode({ home });

    expect(stats.commands).toBe(2);
    expect(reactions).toHaveLength(0);
  });

  it("regla 4: rescata tu frase cuando viaja pegada a la salida de un comando", async () => {
    // The real case that forced cutting instead of discarding: changing the model and continuing to
    // speak in the same turn. Filtering by prefix, the command was completely lost.
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        assistant("Ahí tienes el plan."),
        user(
          "<local-command-caveat>Caveat: The messages below were generated by the user " +
            "while running local commands.</local-command-caveat>\n" +
            "<command-name>/model</command-name>\n" +
            "<command-args>claude-opus-5</command-args>\n" +
            "<local-command-stdout>Set model to claude-opus-5</local-command-stdout>\n" +
            "ok me gusta, comienza la implementación",
        ),
      ],
    });

    const { stats, reactions } = await mineClaudeCode({ home });

    expect(stats.commands).toBe(0);
    expect(reactions).toHaveLength(1);
    expect(reactions[0]?.reaction).toBe("ok me gusta, comienza la implementación");
  });

  it("regla 4: el recordatorio pegado al final no entra en la cita", async () => {
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        assistant("Cambiado el botón."),
        user(
          "no me gusta ese azul\n<system-reminder>El usuario tiene 3 ficheros abiertos" +
            "</system-reminder>",
        ),
      ],
    });

    const { reactions } = await mineClaudeCode({ home });

    expect(reactions).toHaveLength(1);
    expect(reactions[0]?.reaction).toBe("no me gusta ese azul");
    expect(reactions[0]?.signals).toContain("rejection");
  });

  it("regla 5: sin una entrega de texto previa no hay reacción, hay orden nueva", async () => {
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        silent(),
        user("haz un login con Google"),
        assistant("Login puesto."),
        user("perfecto"),
      ],
    });

    const { stats, reactions } = await mineClaudeCode({ home });

    expect(stats.userTurns).toBe(2);
    expect(stats.spontaneous).toBe(1);
    expect(reactions).toHaveLength(1);
    expect(reactions[0]?.reaction).toBe("perfecto");
    expect(reactions[0]?.delivery).toBe("Login puesto.");
  });

  it("un fichero sin una sola línea de texto del asistente no produce reacciones", async () => {
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        silent(),
        toolResult("contenido"),
        user("cambia el color a azul"),
        silent(),
        user("y el borde también"),
      ],
    });

    const { stats, reactions } = await mineClaudeCode({ home });

    expect(reactions).toHaveLength(0);
    expect(stats.userTurns).toBe(2);
    expect(stats.spontaneous).toBe(2);
    expect(stats.reactions).toBe(0);
  });

  it("regla 6: marca como brief lo pegado y no le busca señales", async () => {
    const largo = `perfecto, ${"palabra ".repeat(120)}`;
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        assistant("Ahí va el plan."),
        user(largo),
        assistant("Ahí va otro."),
        user("## Plan\nperfecto"),
        assistant("Y otro."),
        user("- perfecto\n- y consistente"),
        assistant("Y otro más."),
        user("```ts\nconst perfecto = 1;\n```"),
        assistant("Y el último."),
        user("| clave | valor |\n| a | b |"),
      ],
    });

    const { stats, reactions } = await mineClaudeCode({ home });

    expect(reactions).toHaveLength(5);
    expect(stats.briefs).toBe(5);
    for (const reaction of reactions) {
      expect(reaction.brief, `no se marcó como brief: ${reaction.reaction}`).toBe(true);
      expect(reaction.signals, `un brief salió etiquetado: ${reaction.reaction}`).toEqual([]);
    }
    expect(stats.withSignal).toBe(0);
    // The true length is preserved even though the returned text is truncated.
    expect(reactions[0]?.chars).toBe(largo.trim().length);
  });

  it("regla 6: una viñeta suelta no es un documento pegado", async () => {
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        assistant("Hecho."),
        user("- quita el borde, no me gusta"),
      ],
    });

    const { reactions } = await mineClaudeCode({ home });

    expect(reactions[0]?.brief).toBe(false);
    expect(reactions[0]?.signals).toEqual(["rejection"]);
  });

  it("regla 7: devuelve el cwd crudo, aunque esa carpeta ya no exista", async () => {
    const borrado = "/casa/borrado-hace-meses/frontend";
    const home = makeHome({
      "-casa-borrado/sesion-1.jsonl": [
        assistant("Hecho."),
        user("quítalo", { cwd: borrado, gitBranch: "feature/x" }),
      ],
    });

    const { reactions } = await mineClaudeCode({ home });

    expect(reactions[0]?.cwd).toBe(borrado);
    expect(reactions[0]?.gitBranch).toBe("feature/x");
    expect(reactions[0]?.sessionId).toBe("sesion-1");
    expect(reactions[0]?.at).toBe(AT);
    expect(reactions[0]?.source).toBe("claude-code");
  });

  it("sobrevive a una línea corrupta en medio del fichero", async () => {
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        assistant("Primera entrega."),
        '{"type":"user","message":{"role":"user","content":"a med',
        "",
        "no soy json ni lo pretendo",
        user("está feo"),
      ],
    });

    const { reactions } = await mineClaudeCode({ home });

    // Neither is the file aborted nor is what came after the broken byte lost.
    expect(reactions).toHaveLength(1);
    expect(reactions[0]?.reaction).toBe("está feo");
  });

  it("limit recorta la muestra y deja el embudo entero", async () => {
    const lines: Line[] = [];
    for (let i = 0; i < 5; i += 1) {
      lines.push(assistant(`Entrega ${i}.`), user(`reacción ${i}`));
    }
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": lines,
      "-casa-otro/sesion-2.jsonl": [assistant("Hecho."), user("y esto también cuenta")],
    });

    const { reactions, stats } = await mineClaudeCode({ home, limit: 2 });

    // The sample comes from the most recent file, which is the one that `listTranscripts` puts
    // first: to develop a taste, what is from this month is worth more than last year's.
    expect(reactions).toHaveLength(2);
    expect(reactions.map((r) => r.reaction)).toContain("y esto también cuenta");
    // What was asked to be cut is what is taught, not what is counted: the second file is read the
    // same. A count made on part of the disk and presented as the total is exactly the lie that
    // this counter exists to avoid saying.
    expect(stats.files).toBe(2);
    expect(stats.reactions).toBe(6);
  });

  it("el fixture sella la antigüedad a mano y no se fía del reloj", () => {
    /*
      The test above relies on the second transcript being more recent than the first, and writing
      them consecutively does not guarantee that: on Linux, two `writeFileSync` almost always fall
      on the same tick of the inode dates, and on Windows the clock jumps by 15 ms increments.
      Tied, `listTranscripts` breaks the tie by path, and the sample comes from the wrong file.
      Here the premise is being checked, not the machine's clock.
     */
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [assistant("Hecho."), user("vale")],
      "-casa-otro/sesion-2.jsonl": [assistant("Hecho."), user("vale")],
    });
    const projects = join(home, ".claude", "projects");
    const primero = statSync(join(projects, "-casa-anotes", "sesion-1.jsonl")).mtimeMs;
    const segundo = statSync(join(projects, "-casa-otro", "sesion-2.jsonl")).mtimeMs;

    expect(segundo - primero).toBeGreaterThanOrEqual(1_000);
  });

  it("el comentario de limit dice lo que hace el código, no lo contrario", async () => {
    /*
      What `limit` does is already set by the test above; what is checked here is the **published
      contract**, which is the only thing that someone importing `MineOptions` from `@panoma/core`
      sees and which said the opposite of the implementation: “It cuts the sweep as soon as it is
      reached, so the figures of `stats` describe what was read up to that point and not the
      entire corpus.” With that promise in front, whoever runs `--limit 1` over 1.78 GB thinks
      they are limiting the work —they are not limiting it, it takes the same time— and reads the
      funnel as if it were partial right on the screen that claims it is not.
     */
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        assistant("Hecho."),
        user("no me gusta"),
        assistant("Hecho."),
        user("perfecto"),
      ],
    });

    const entero = await mineClaudeCode({ home });
    const muestra = await mineClaudeCode({ home, limit: 1 });

    expect(muestra.reactions).toHaveLength(1);
    expect(muestra.stats).toEqual(entero.stats);

    const source = readFileSync(new URL("./claude-code.ts", import.meta.url), "utf8");
    const doc = source.slice(0, source.indexOf("limit?: number;"));
    const jsdoc = doc.slice(doc.lastIndexOf("/**"));
    expect(jsdoc).not.toContain("Cuts the scan short");
    expect(jsdoc).toContain("never on the scan itself");
  });

  it("cwdPrefix filtra por proyecto sin tocar el disco", async () => {
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        assistant("Hecho."),
        user("de la web", { cwd: "/casa/anotes/apps/web" }),
        assistant("Hecho."),
        user("de la cli", { cwd: "/casa/anotes/apps/cli" }),
        assistant("Hecho."),
        // The neighbor with the same literal prefix: without checking the slash, it would match.
        user("del vecino", { cwd: "/casa/anotes-viejo/apps/web" }),
        assistant("Hecho."),
        user("sin cwd", { cwd: undefined }),
      ],
    });

    const { reactions } = await mineClaudeCode({ home, cwdPrefix: "/casa/anotes" });

    expect(reactions.map((reaction) => reaction.reaction)).toEqual(["de la web", "de la cli"]);
  });

  it("onlySignals deja fuera lo que no se pudo etiquetar", async () => {
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        assistant("Hecho."),
        user("vale, sigue con lo siguiente"),
        assistant("Hecho."),
        user("no me gusta ese azul"),
      ],
    });

    const { stats, reactions } = await mineClaudeCode({ home, onlySignals: true });

    expect(reactions).toHaveLength(1);
    expect(reactions[0]?.signals).toEqual(["rejection"]);
    // The figures continue to describe the corpus read, not what was returned.
    expect(stats.reactions).toBe(2);
    expect(stats.withSignal).toBe(1);
  });

  it("recorta la entrega a un extracto y la deja en una línea", async () => {
    const largo = `${"Te dejo la cabecera nueva. ".repeat(60)}fin`;
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [assistant(`Primera línea\n\n${largo}`), user("quítalo")],
    });

    const { reactions } = await mineClaudeCode({ home });

    const delivery = reactions[0]?.delivery ?? "";
    expect(delivery.length).toBeLessThanOrEqual(240);
    expect(delivery).not.toContain("\n");
    expect(delivery.startsWith("Primera línea Te dejo")).toBe(true);
  });

  it("el recorte no parte un emoji por la mitad", async () => {
    /*
      `slice` cuts by units UTF-16: if the boundary character is outside the BMP, the trimming
      keeps the high surrogate alone and the quote stops being well-formed — it becomes a diamond
      as soon as it is written in UTF-8, which is what awaits it. The emoji goes **exactly** at
      the boundary, which is the only place where the error appears: 238 characters before in the
      delivery and 1,998 in the reaction.
     */
    const entrega = `${"palabra ".repeat(29)}palabr🙂${" y sigue".repeat(20)}`;
    const reaccion = `${"palabra ".repeat(249)}palabr🙂${" y sigue".repeat(20)}`;
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [assistant(entrega), user(reaccion)],
    });

    const { reactions } = await mineClaudeCode({ home });

    const delivery = reactions[0]?.delivery ?? "";
    const reaction = reactions[0]?.reaction ?? "";
    // The message shows the tail, which is where the loose substitute stays.
    const tail = (text: string): string => JSON.stringify(text.slice(-3));
    expect(wellFormed(delivery), `entrega rota: ${tail(delivery)}`).toBe(true);
    expect(wellFormed(reaction), `reacción rota: ${tail(reaction)}`).toBe(true);
    // And it really got cut: one character less, not a broken one.
    expect(delivery.endsWith("…")).toBe(true);
    expect(reaction.endsWith("…")).toBe(true);
    expect(reaction.length).toBe(1_999);
  });

  it("el recorte copia el trozo y no deja anclado el turno entero", async () => {
    /*
      The top of `REACTION_CHARS` was supposed to limit the memory of a sweep, but it didn't:
      `slice` returns in V8 a piece that keeps the original alive, so every 2,000-character quote
      continued to anchor its full turn. Measured on the real corpus with `--expose-gc`: 18.4 MB
      retained versus 7.1 MB with the copied cut.
      Here the same is measured in small and with the margin in favor: 24 shifts of 300,000
      characters —with an arrow inside, which forces V8 to store them in two bytes— hold 14.1 MB
      measured if the quote is a piece of the shift, and 124 KB if it is a copy. The ceiling goes
      to 4 MB because what is compared are orders of magnitude and not bytes: the collector's
      noise fits easily there and the error does not fit in any way.
     */
    const gc = collect();
    const grande = `${"palabra → ".repeat(30_000)}fin`;
    const lines: Line[] = [];
    for (let i = 0; i < 24; i += 1) lines.push(assistant("Hecho."), user(grande));
    const home = makeHome({ "-casa-anotes/sesion-1.jsonl": lines });

    gc();
    const antes = process.memoryUsage().heapUsed;
    const { reactions } = await mineClaudeCode({ home });
    gc();
    const retenido = process.memoryUsage().heapUsed - antes;

    // Without this, a reader who returned nothing would pass the memory test.
    expect(reactions).toHaveLength(24);
    expect(reactions[0]?.reaction.length).toBe(2_000);
    expect(reactions[0]?.chars).toBe(grande.length);
    expect(
      retenido,
      `retenidos ${Math.round(retenido / 1024)} KB con 24 citas de 2.000 caracteres`,
    ).toBeLessThan(4 * 1024 * 1024);
  });

  it("las cifras cuadran entre sí", async () => {
    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        silent(),
        user("empieza por la portada"),
        assistant("Portada lista."),
        user("no me gusta"),
        toolResult("algo"),
        user("<command-name>clear</command-name>"),
      ],
      "-casa-otro/sesion-2.jsonl": [
        assistant("Otra sesión.", { sessionId: "sesion-2" }),
        user("perfecto", { sessionId: "sesion-2" }),
      ],
    });

    const { stats } = await mineClaudeCode({ home });

    expect(stats.files).toBe(2);
    expect(stats.bytes).toBeGreaterThan(0);
    expect(stats.sessions).toBe(2);
    expect(stats.userTurns).toBe(stats.reactions + stats.spontaneous);
    expect(stats.toolResults).toBe(1);
    expect(stats.commands).toBe(1);
    expect(stats.reactions).toBe(2);
  });

  it("no lanza cuando no hay historial ninguno", async () => {
    const casa = join(root, "casa-que-no-existe");
    const { stats, reactions } = await mineClaudeCode({ home: casa });

    expect(reactions).toEqual([]);
    expect(stats.files).toBe(0);
  });

  it("ningún secreto plantado en el historial sale en el resultado", async () => {
    /*
      The canary, in the `links.test.ts` line: instead of going over each field that the reader
      returns —which is what gets forgotten when one is added tomorrow—, impossible-to-confuse
      values are placed in the four places where one could escape, and the value is searched for
      in **everything** that comes out.
      The secrets go at the beginning of each text on purpose. At the end, the cut would erase
      them and the test would pass without anyone having written anything.
      The one who writes is `redactQuote` for real, without folding: what is verified here is not
      their quality —that is a matter for `quotes.test.ts` — but that through this module not a
      single text that avoids it passes.
     */
    const secretos = {
      entrega: "sk-CANARIO-entrega-77aa41b0c9",
      reaccion: "sk-CANARIO-reaccion-9f3a2b1c4d",
      herramienta: "sk-CANARIO-herramienta-4b7e01ff",
      subagente: "sk-CANARIO-subagente-1c5566aa",
    };

    const home = makeHome({
      "-casa-anotes/sesion-1.jsonl": [
        assistant(`${secretos.entrega} es la clave que acabo de poner en el .env`),
        toolResult(`OPENAI_API_KEY=${secretos.herramienta}`),
        user(`${secretos.subagente} mira esto`, { isSidechain: true }),
        user(`${secretos.reaccion} no me gusta, quítala de ahí`),
      ],
    });

    const { reactions } = await mineClaudeCode({ home });

    // Without this, a reader who always returned an empty list would pass the exam.
    expect(reactions).toHaveLength(1);
    // And the rest of the sentence does arrive: what is removed is the key, not the reaction.
    expect(reactions[0]?.reaction).toContain("no me gusta");
    expect(reactions[0]?.delivery).toContain("es la clave que acabo de poner");

    const salida = JSON.stringify(reactions);
    for (const [donde, valor] of Object.entries(secretos)) {
      expect(salida, `el secreto de ${donde} salió entero`).not.toContain(valor);
      // And without the prefix, in case someone trims the value believing that this way it is
      // worth.
      expect(salida, `un trozo del secreto de ${donde} salió`).not.toContain(valor.slice(-12));
    }
  });
});

describe("detectSignals", () => {
  it("detecta las seis señales con la ortografía cuidada", () => {
    expect(detectSignals("no me gustó, está feo")).toEqual(["rejection"]);
    expect(detectSignals("me gustó cómo quedó")).toEqual(["praise"]);
    expect(detectSignals("igual que la sección de arriba")).toEqual(["consistency"]);
    expect(detectSignals("deshazlo y déjalo como estaba")).toEqual(["redo"]);
    expect(detectSignals("yo solo te pedí el borde")).toEqual(["scope-creep"]);
    expect(detectSignals("parecido a la landing de Linear")).toEqual(["reference"]);
  });

  it("detecta las mismas señales escritas sin tildes", () => {
    // The author writes without accents very often, and in the same sentence mixes the two
    // spellings. A stressed pattern leaves out half of the corpus.
    expect(detectSignals("no me gusto, quitalo")).toEqual(["rejection"]);
    expect(detectSignals("vuelve a hacer la cabecera, rehazla")).toEqual(["redo"]);
    expect(detectSignals("solo te dije el titulo, hiciste de mas")).toEqual(["scope-creep"]);
    expect(detectSignals("mismo diseño en toda la web")).toEqual(["consistency"]);
    // The `ñ` breaks down and loses the accent: 'diseño' and 'diseno' have to match the same.
    expect(detectSignals("mismo diseno en todas las secciones")).toEqual(["consistency"]);
  });

  it("no lee un rechazo como elogio", () => {
    // “I liked” is literally inside “I did not like”: without the negation guardian, every
    // rejection in the corpus also came out labeled as praise.
    expect(detectSignals("no me gusta")).toEqual(["rejection"]);
    expect(detectSignals("ya no me gusto ese azul")).toEqual(["rejection"]);
    expect(detectSignals("no quedó bien")).toEqual([]);
  });

  it("no etiqueta lo que no reconoce, en vez de aproximar", () => {
    // The broad lexicon that existed before marked this as a visual hierarchy by being 'clean' and
    // 'aligned.' Precision before coverage: no pattern, no label.
    const trading = "la gráfica de trading tiene que estar limpia y alineada";
    expect(detectSignals(trading)).toEqual([]);
    expect(detectSignals("añade un endpoint para las velas de un minuto")).toEqual([]);
  });

  it("puede devolver varias señales, siempre en el mismo orden", () => {
    const signals = detectSignals("no me gusta, rehazlo igual que la otra sección");
    expect(signals).toEqual(["rejection", "consistency", "redo"]);
  });
});

/**
 * Rule 8: `cwd` says where the terminal was, not what was being talked about.
 *
 * The real case that made it necessary: a transcript with `cwd` in `trad89/humo_check` in 1,095
 * turns while the files that the agent touched were **161 under `linkaloud/` and one under
 * `humo_check/` **. The session was opened in one project and the work belonged to another, which
 * is normal when several live under the same parent folder. Consequence: a sentence about an audio
 * tray, learned while working in `linkaloud`, ended up being credited to `Travocato` — and the
 * owner caught it by reading the review screen.
 *
 * The engine does not solve projects, so what is checked here is the only thing it is responsible
 * for: that each reaction comes out with the routes needed to solve it properly.
 */
describe("de qué se hablaba, no dónde estaba el terminal", () => {
  /** A shift by the assistant that touched specific files. */
  function working(paths: string[], text = "Hecho."): Line {
    return {
      type: "assistant",
      sessionId: "sesion-1",
      timestamp: AT,
      message: {
        role: "assistant",
        content: [
          ...paths.map((file_path, index) => ({
            type: "tool_use",
            id: `toolu_${index}`,
            name: "Edit",
            input: { file_path },
          })),
          { type: "text", text },
        ],
      },
    };
  }

  it("la reacción sale con lo que el agente acababa de tocar", async () => {
    const home = makeHome({
      "-casa-uno/s.jsonl": [
        working(["/otro/linkaloud/app/audio.dart"]),
        user("hazlo, el share sheet"),
      ],
    });

    const { reactions } = await mineClaudeCode({ home });
    expect(reactions[0]!.cwd).toBe(CWD);
    expect(reactions[0]!.paths).toEqual(["/otro/linkaloud/app/audio.dart"]);
  });

  /*
    The shift that closes a delivery is usually the summary, without a single tool inside: the
    work is in the ten before. Without accumulating the entire window, the reaction to what was
    hardest to get out would be precisely the one that is left without routes.
   */
  it("la ventana es todo lo hecho desde tu turno anterior, no el último mensaje", async () => {
    const home = makeHome({
      "-casa-dos/s.jsonl": [
        working(["/otro/linkaloud/app/a.dart"], ""),
        working(["/otro/linkaloud/app/b.dart"], ""),
        assistant("Listo: he tocado dos ficheros."),
        user("no, eso no"),
      ],
    });

    const { reactions } = await mineClaudeCode({ home });
    expect(reactions[0]!.paths).toEqual([
      "/otro/linkaloud/app/a.dart",
      "/otro/linkaloud/app/b.dart",
    ]);
  });

  /*
    The owner's case, exactly: the reaction that matters is conversation about what to build, said
    before touching a single file. There the window is empty and the backup was `cwd`, which
    pointed to the wrong project. The session does know what it was about.
   */
  it("una reacción anterior a tocar nada hereda las rutas de su sesión", async () => {
    const home = makeHome({
      "-casa-tres/s.jsonl": [
        assistant("Podríamos leer los posts en voz alta."),
        user("lo que tiene mas sentido para una app como esta es leer post"),
        working(["/otro/linkaloud/app/audio.dart"], "Hecho."),
        user("perfecto"),
      ],
    });

    const { reactions } = await mineClaudeCode({ home });
    expect(reactions).toHaveLength(2);
    expect(reactions[0]!.reaction).toContain("lo que tiene mas sentido");
    expect(reactions[0]!.paths, "hereda lo que la sesión acabó tocando").toEqual([
      "/otro/linkaloud/app/audio.dart",
    ]);
  });

  /*
    Inheritance goes by majority: what was touched the most comes first. A `README` from the
    father briefly opened cannot weigh the same as twelve files from the real project.
   */
  it("hereda primero lo más tocado", async () => {
    const home = makeHome({
      "-casa-cuatro/s.jsonl": [
        assistant("¿Por dónde empiezo?"),
        user("tú dirás"),
        working(["/otro/linkaloud/app/audio.dart"], ""),
        working(["/otro/linkaloud/app/audio.dart"], ""),
        working(["/otro/humo_check/README.md"], "Hecho."),
        user("vale"),
      ],
    });

    const { reactions } = await mineClaudeCode({ home });
    expect(reactions[0]!.paths?.[0]).toBe("/otro/linkaloud/app/audio.dart");
  });

  /*
    Nothing about getting paths from a Bash command with a regular expression:
    `rm -rf node_modules` and `cd ..` would give paths that are not the work, and an assigner who
    gets it right 80% of the time is worse than one who stays quiet, because the 20% cannot be
    distinguished.
   */
  it("solo cuentan las rutas que la herramienta declara como tales", async () => {
    const home = makeHome({
      "-casa-cinco/s.jsonl": [
        {
          type: "assistant",
          sessionId: "sesion-1",
          timestamp: AT,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "Bash",
                input: { command: "rm -rf /otro/linkaloud/node_modules" },
              },
              { type: "text", text: "Limpio." },
            ],
          },
        },
        user("bien"),
      ],
    });

    const { reactions } = await mineClaudeCode({ home });
    expect(reactions[0]!.paths).toBeUndefined();
  });

  it("una ruta relativa no viaja: habría que resolverla contra el cwd", async () => {
    const home = makeHome({
      "-casa-seis/s.jsonl": [working(["lib/audio.dart"], "Hecho."), user("vale")],
    });

    const { reactions } = await mineClaudeCode({ home });
    expect(reactions[0]!.paths).toBeUndefined();
  });
});
