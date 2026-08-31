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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mineCodex } from "./codex";
import { inventoryHistory } from "./inventory";

/**
 * The rules of `codex.ts` came from counting by hand over the real corpus of this machine —246
 * files, 3.63 GB, 234,123 lines, 1,724 of your turns—. That corpus does not fit in a test, so here
 * is the opposite: minimal rollouts in a temporary file, one per rule, each with the exact case
 * that made it necessary.
 *
 * The files are written with `.jsonl` for real, in the real date hierarchy, and are read with the
 * real function. If tomorrow the reader changes from `readline` to something else, this still
 * holds; if it stops preferring the `event_msg` channel, it fails.
 */

type Line = Record<string, unknown> | string;

let root = "";
let cases = 0;

beforeAll(() => {
  // `realpathSync`: on macOS `/var` is a link to `/private/var`, and `cwd` is compared as text
  // against the path returned by `mkdtemp`.
  root = realpathSync(mkdtempSync(join(tmpdir(), "panoma-codex-")));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * A house with rollouts inside. The keys are paths relative to `~/.codex`, and the order in which
 * they are declared is the order in time: the last one is the most recent.
 *
 * The age is **hand-stamped**, separated by a minute, instead of leaving it to the clock.
 * `listRollouts` orders by `mtime` and breaks ties by path, and two consecutive `writeFileSync` do
 * not give two different timestamps everywhere: on Linux —which is in the CI matrix— the inode
 * dates come from the kernel's cheap clock, and on Windows the system clock jump is ~15 ms. When
 * tied, it uses the path to break the tie, and the `limit` test sample comes from the wrong file.
 */
function makeHome(rollouts: Record<string, Line[]>): string {
  cases += 1;
  const home = join(root, `caso-${cases}`);
  let stamp = Date.UTC(2026, 7, 20, 10, 0, 0) / 1000;

  for (const [relative, lines] of Object.entries(rollouts)) {
    const file = join(home, ".codex", ...relative.split("/"));
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
const ROLLOUT = "sessions/2026/08/20/rollout-2026-08-20T10-00-00-sesion-1.jsonl";

/** The header. It is the only place where the session, the project, and the branch live. */
function meta(payload: Record<string, unknown> = {}): Line {
  return {
    timestamp: AT,
    type: "session_meta",
    payload: {
      id: "sesion-1",
      timestamp: AT,
      cwd: CWD,
      originator: "codex_cli_rs",
      cli_version: "0.108.0",
      instructions: null,
      source: "vscode",
      git: { commit_hash: "abc123", branch: "master", repository_url: null },
      ...payload,
    },
  };
}

/** The `cwd` per shift, which commands over the header while it lasts. */
function turnContext(cwd: unknown): Line {
  return {
    timestamp: AT,
    type: "turn_context",
    payload: {
      cwd,
      approval_policy: "on-request",
      sandbox_policy: "workspace-write",
      model: "gpt-5-codex",
      summary: "auto",
    },
  };
}

/** What they taught you. */
function agent(text: string): Line {
  const payload = { type: "agent_message", message: text };
  return { timestamp: AT, type: "event_msg", payload };
}

/** What you typed. */
function human(text: string): Line {
  return {
    timestamp: AT,
    type: "event_msg",
    payload: { type: "user_message", message: text, kind: null },
  };
}

/**
 * The same shift just as the other channel repeats it, the one that is not read.
 *
 * It is the one that brings 55 entries where the good one brings 9: besides the echo, it puts in
 * `<environment_context>` blocks and summaries with your paper on.
 */
function echo(text: string, role = "user"): Line {
  return {
    timestamp: AT,
    type: "response_item",
    payload: { type: "message", role, content: [{ type: "input_text", text }] },
  };
}

function call(name: string, args: Record<string, unknown> = {}): Line {
  return {
    timestamp: AT,
    type: "response_item",
    // `arguments` travels as **string** with JSON inside, which is how Codex writes it.
    payload: {
      type: "function_call",
      name,
      arguments: JSON.stringify(args),
      call_id: "call-1",
    },
  };
}

/** `exec`: the `input` is a line of JavaScript with the parameters object inside. */
function exec(cmd: string, workdir: string): Line {
  return {
    timestamp: AT,
    type: "response_item",
    payload: {
      type: "custom_tool_call",
      name: "exec",
      call_id: "call-exec",
      input: `const r = await tools.exec_command(${JSON.stringify({
        cmd,
        workdir,
        yield_time_ms: 10_000,
      })});\ntext(r.output);\n`,
    },
  };
}

/** `apply_patch`: the `input` is the patch, and it names each file on its own line. */
function patch(files: string[]): Line {
  const body = files.map((file) => `*** Update File: ${file}\n@@\n-antes\n+después`).join("\n");
  return {
    timestamp: AT,
    type: "response_item",
    payload: {
      type: "custom_tool_call",
      name: "apply_patch",
      call_id: "call-patch",
      input: `*** Begin Patch\n${body}\n*** End Patch\n`,
    },
  };
}

function callOutput(text: string): Line {
  return {
    timestamp: AT,
    type: "response_item",
    payload: { type: "function_call_output", call_id: "call-1", output: text },
  };
}

/** Good channel noise: you neither saw it nor wrote it. */
function noise(): Line[] {
  const event = (payload: Record<string, unknown>): Line => ({
    timestamp: AT,
    type: "event_msg",
    payload,
  });
  return [
    event({ type: "agent_reasoning", text: "Miro el fichero." }),
    event({ type: "token_count", info: { total_tokens: 812 } }),
    { timestamp: AT, type: "response_item", payload: { type: "reasoning", summary: [] } },
  ];
}

describe("mineCodex", () => {
  it("lee lo que tecleaste y no lo que el otro canal repite", async () => {
    /*
      The decision that the module holds. The same turn travels through both channels, and in the
      one that is not read it also travels escorted by a block that nobody wrote. If both were
      read, this conversation would give two reactions —the same twice— and a third with a
      `<environment_context>` inside presented as your opinion.
     */
    const home = makeHome({
      [ROLLOUT]: [
        meta(),
        agent("He puesto el botón en la cabecera."),
        human("no me gusta"),
        echo("no me gusta"),
        echo("<environment_context>\n  <cwd>/casa/anotes</cwd>\n</environment_context>"),
        echo("He puesto el botón en la cabecera.", "assistant"),
      ],
    });

    const { stats, reactions } = await mineCodex({ home });

    expect(stats.userTurns).toBe(1);
    expect(reactions).toHaveLength(1);
    expect(reactions[0]?.reaction).toBe("no me gusta");
    expect(reactions[0]?.delivery).toBe("He puesto el botón en la cabecera.");
    expect(reactions[0]?.source).toBe("codex");
  });

  it("regla 2: reanudar repite la cabecera y no inventa otra conversación", async () => {
    // 639 headers and 246 identifiers on the author's disk: upon resuming, the `id` is the same.
    // Counting headers would multiply by 2.6 the most visible figure of the funnel.
    const home = makeHome({
      [ROLLOUT]: [
        meta(),
        agent("Primera entrega."),
        human("perfecto"),
        meta(),
        agent("Segunda entrega."),
        human("quítalo"),
      ],
    });

    const { stats, reactions } = await mineCodex({ home });

    expect(stats.sessions).toBe(1);
    expect(stats.reactions).toBe(2);
    expect(reactions.map((reaction) => reaction.sessionId)).toEqual(["sesion-1", "sesion-1"]);
  });

  it("regla 4: dos sesiones de un fichero no comparten proyecto ni entrega", async () => {
    /*
      Without forgetting the dedication in each header, "and now the cover" —the first sentence of
      the second session— would be paired with the last thing the assistant showed in the first
      one, which was said hours earlier and in another repository. That reads as a reaction, and
      it is not: it is a new order.
     */
    const home = makeHome({
      [ROLLOUT]: [
        meta({ id: "sesion-a", cwd: "/casa/uno" }),
        agent("Listo lo de uno."),
        human("me gusta"),
        meta({ id: "sesion-b", cwd: "/casa/dos" }),
        human("y ahora la portada"),
        agent("Portada lista."),
        human("está feo"),
      ],
    });

    const { stats, reactions } = await mineCodex({ home });

    expect(stats.sessions).toBe(2);
    expect(stats.userTurns).toBe(3);
    expect(stats.spontaneous).toBe(1);
    expect(reactions).toHaveLength(2);
    expect(reactions[0]?.sessionId).toBe("sesion-a");
    expect(reactions[0]?.cwd).toBe("/casa/uno");
    expect(reactions[1]?.sessionId).toBe("sesion-b");
    expect(reactions[1]?.cwd).toBe("/casa/dos");
    expect(reactions[1]?.delivery).toBe("Portada lista.");
  });

  it("regla 3: el cwd del turno manda sobre el de la cabecera", async () => {
    const home = makeHome({
      [ROLLOUT]: [
        meta({ cwd: "/casa/anotes" }),
        agent("Hecho en anotes."),
        human("quítalo"),
        turnContext("/casa/otro-repo"),
        agent("Hecho en el otro."),
        human("no me gusta"),
        // An empty `cwd` is not a move, it is a field that was not filled in.
        turnContext(""),
        agent("Y otra cosa."),
        human("sigue mal"),
      ],
    });

    const { reactions } = await mineCodex({ home });

    expect(reactions.map((reaction) => reaction.cwd)).toEqual([
      "/casa/anotes",
      "/casa/otro-repo",
      "/casa/otro-repo",
    ]);
  });

  it("devuelve el instante, la rama y el cwd crudo aunque ya no exista", async () => {
    const borrado = "/casa/borrado-hace-meses/frontend";
    const home = makeHome({
      [ROLLOUT]: [
        meta({ cwd: borrado, git: { branch: "feature/x" } }),
        agent("Hecho."),
        human("quítalo"),
      ],
    });

    const { reactions } = await mineCodex({ home });

    expect(reactions[0]?.cwd).toBe(borrado);
    expect(reactions[0]?.gitBranch).toBe("feature/x");
    expect(reactions[0]?.at).toBe(AT);
  });

  it("una sesión fuera de un repositorio no inventa una rama", async () => {
    // 589 of the 639 headers from the disk carry `git`; the other 50 do not, and there `gitBranch`
    // must be missing, not come empty.
    const home = makeHome({
      [ROLLOUT]: [meta({ git: null }), agent("Hecho."), human("quítalo")],
    });

    const { reactions } = await mineCodex({ home });

    expect(reactions[0]?.gitBranch).toBeUndefined();
    expect("gitBranch" in (reactions[0] ?? {})).toBe(false);
  });

  it("sin un agent_message previo no hay reacción, hay orden nueva", async () => {
    const home = makeHome({
      [ROLLOUT]: [
        meta(),
        ...noise(),
        call("shell"),
        callOutput("total 4"),
        human("haz un login con Google"),
        agent("Login puesto."),
        human("perfecto"),
      ],
    });

    const { stats, reactions } = await mineCodex({ home });

    expect(stats.userTurns).toBe(2);
    expect(stats.spontaneous).toBe(1);
    expect(reactions).toHaveLength(1);
    expect(reactions[0]?.reaction).toBe("perfecto");
    expect(reactions[0]?.signals).toEqual(["praise"]);
  });

  it("regla 5: los turnos de una sesión de subagente no son tuyos", async () => {
    /*
      What is inside those 18 sessions is not an impostor: it is your own sentence, copied into
      the thread that the agent started. That is why the fixture repeats the same one: telling it
      would be like telling one of your opinions five times and giving it five times its weight.
     */
    const opinion = "me gusta mucho el diseño que hiciste";
    const home = makeHome({
      [ROLLOUT]: [meta(), agent("Ahí va el diseño."), human(opinion)],
      "sessions/2026/08/20/rollout-2026-08-20T10-01-00-sub.jsonl": [
        meta({
          id: "sesion-sub",
          source: { subagent: { thread_spawn: { parent_thread_id: "sesion-1", depth: 1 } } },
        }),
        agent("Ahí va el diseño."),
        human(opinion),
      ],
    });

    const { stats, reactions } = await mineCodex({ home });

    expect(stats.sidechain).toBe(1);
    expect(stats.userTurns).toBe(1);
    expect(reactions).toHaveLength(1);
    expect(reactions[0]?.sessionId).toBe("sesion-1");
  });

  it("regla 6: rescata tu frase del preámbulo que el cliente le pega delante", async () => {
    /*
      The real case that forced cutting instead of discarding. In front of `## My request…` the
      client lists the files you mentioned or the state of their browser; behind it is what you
      wrote. Discarding the entire turn threw away 64 opinions from this disk, and saving it
      entirely saved as yours a paragraph written by a machine — and on top of that with headers,
      so the turn came out marked as brief and without signals.
     */
    const home = makeHome({
      [ROLLOUT]: [
        meta(),
        agent("Ahí tienes la portada."),
        human(
          "# Files mentioned by the user:\n\n## captura.png: /tmp/captura.png\n\n" +
            "## My request for Codex:\nno me gusta ese azul",
        ),
        agent("Cambiado."),
        human(
          '<in-app-browser-context source="ambient-ui-state">\n' +
            "# In app browser:\n- The user has the in-app browser open with 1 tab.\n" +
            "</in-app-browser-context>\n\n## My request:\nperfecto, sigue así",
        ),
      ],
    });

    const { stats, reactions } = await mineCodex({ home });

    expect(stats.commands).toBe(0);
    expect(reactions).toHaveLength(2);
    expect(reactions[0]?.reaction).toBe("no me gusta ese azul");
    expect(reactions[0]?.brief).toBe(false);
    expect(reactions[0]?.signals).toEqual(["rejection"]);
    expect(reactions[1]?.reaction).toBe("perfecto, sigue así");
    expect(reactions[1]?.signals).toEqual(["praise"]);
  });

  it("regla 6: un turno que es solo contexto inyectado no es un turno tuyo", async () => {
    const home = makeHome({
      [ROLLOUT]: [
        meta(),
        agent("Hecho."),
        human(
          "<realtime_delegation>\n  <source>transcript_tail_flush</source>\n" +
            "  <input>The user just ended their realtime session.</input>\n" +
            "</realtime_delegation>",
        ),
        human("   "),
      ],
    });

    const { stats, reactions } = await mineCodex({ home });

    expect(stats.commands).toBe(1);
    // The empty turn is not a command nor a turn: it is not counted in any box.
    expect(stats.userTurns).toBe(0);
    expect(reactions).toHaveLength(0);
  });

  it("marca como brief lo pegado y no le busca señales", async () => {
    const largo = `perfecto, ${"palabra ".repeat(120)}`;
    const home = makeHome({
      [ROLLOUT]: [
        meta(),
        agent("Ahí va el plan."),
        human(largo),
        agent("Ahí va otro."),
        human("## Plan\nperfecto"),
        agent("Y otro."),
        human("- perfecto\n- y consistente"),
        agent("Y el último."),
        human("```ts\nconst perfecto = 1;\n```"),
      ],
    });

    const { stats, reactions } = await mineCodex({ home });

    expect(reactions).toHaveLength(4);
    expect(stats.briefs).toBe(4);
    for (const reaction of reactions) {
      expect(reaction.brief, `no se marcó como brief: ${reaction.reaction}`).toBe(true);
      expect(reaction.signals, `un brief salió etiquetado: ${reaction.reaction}`).toEqual([]);
    }
    expect(stats.withSignal).toBe(0);
    // The true length is preserved even though the returned text is truncated.
    expect(reactions[0]?.chars).toBe(largo.trim().length);
  });

  it("cuenta las llamadas a herramientas sin abrirlas, por gordas que sean", async () => {
    /*
      The thick lines of this format are precisely the tool outputs: a single one reaches 19.7 MB
      on the author's disk, and 1,464 exceed half a megabyte. By applying the length limit before
      classifying, those 1,464 disappeared from the only box that exists to count them. The giant
      shift below is indeed lost, and it is the known cost of the limit: there are 8 shifts in
      1,724, all of them glued documents.
     */
    const enorme = "x".repeat(600_000);
    const home = makeHome({
      [ROLLOUT]: [
        meta(),
        agent("Miro el fichero."),
        call("shell"),
        callOutput(enorme),
        human("no me gusta"),
        agent("Otra vez."),
        human(enorme),
      ],
    });

    const { stats, reactions } = await mineCodex({ home });

    expect(stats.toolResults).toBe(2);
    expect(stats.userTurns).toBe(1);
    expect(reactions).toHaveLength(1);
    expect(reactions[0]?.reaction).toBe("no me gusta");
  });

  it("una llamada no se cuela por citar tu turno la palabra function_call", async () => {
    // The order of the checks: first the channels that are read, and only if none appear do you
    // check if it was plumbing. The other way around, this turn disappeared.
    const home = makeHome({
      [ROLLOUT]: [
        meta(),
        agent("Ahí va el parser."),
        human('no me gusta cómo tratas el "function_call" del rollout'),
      ],
    });

    const { stats, reactions } = await mineCodex({ home });

    expect(stats.toolResults).toBe(0);
    expect(reactions).toHaveLength(1);
    expect(reactions[0]?.signals).toEqual(["rejection"]);
  });

  it("sobrevive a una línea corrupta en medio del fichero", async () => {
    const home = makeHome({
      [ROLLOUT]: [
        '{"timestamp":"2026-08-20T10:00:00.000Z","type":"session_meta","payload":{"id":"a med',
        agent("Primera entrega."),
        "",
        "no soy json ni lo pretendo",
        '{"timestamp":"…","type":"event_msg","payload":{"type":"user_message","message":"a med',
        human("está feo"),
      ],
    });

    const { stats, reactions } = await mineCodex({ home });

    // Neither is the file aborted nor is what came after the broken byte lost.
    expect(reactions).toHaveLength(1);
    expect(reactions[0]?.reaction).toBe("está feo");
    // And with the header broken, the shift does not go without a session: it uses the file name as
    // an identifier, which is the only thing left when the process died halfway.
    expect(stats.sessions).toBe(1);
    expect(reactions[0]?.sessionId).toBe("rollout-2026-08-20T10-00-00-sesion-1");
    expect(reactions[0]?.cwd).toBeUndefined();
  });

  it("lee lo archivado y no lee lo que no es una conversación", async () => {
    /*
      `~/.codex` has more `.jsonl` than conversations: `history.jsonl` are the loose prompts of
      CLI, `session_index.jsonl` is an index and `transcription-history.jsonl` is the dictation.
      None open, and that is why `inventory.ts` does not count them either.
     */
    const home = makeHome({
      [ROLLOUT]: [meta(), agent("Hecho."), human("quítalo")],
      "archived_sessions/rollout-2026-03-06T20-09-33-vieja.jsonl": [
        meta({ id: "sesion-vieja" }),
        agent("Hecho hace meses."),
        human("no me gusta"),
      ],
      "history.jsonl": [meta({ id: "no-es-una-sesion" }), agent("Hecho."), human("perfecto")],
      "session_index.jsonl": [meta({ id: "tampoco" }), agent("Hecho."), human("perfecto")],
    });

    const { stats, reactions } = await mineCodex({ home });

    expect(stats.files).toBe(2);
    expect(reactions).toHaveLength(2);
    expect(reactions.map((reaction) => reaction.sessionId).sort()).toEqual([
      "sesion-1",
      "sesion-vieja",
    ]);

    // And the check that ties the two figures together instead of relying on them matching: what
    // the permit screen announces is what this reader opens, counted by both.
    const codex = (await inventoryHistory(home)).find((source) => source.id === "codex");
    expect(codex?.files).toBe(stats.files);
    expect(codex?.bytes).toBe(stats.bytes);
  });

  it("limit recorta la muestra y deja el embudo entero", async () => {
    const lines: Line[] = [meta()];
    for (let i = 0; i < 5; i += 1) lines.push(agent(`Entrega ${i}.`), human(`reacción ${i}`));
    const home = makeHome({
      [ROLLOUT]: lines,
      "sessions/2026/08/21/rollout-2026-08-21T09-00-00-sesion-2.jsonl": [
        meta({ id: "sesion-2" }),
        agent("Hecho."),
        human("y esto también cuenta"),
      ],
    });

    const { stats, reactions } = await mineCodex({ home, limit: 2 });

    // The sample comes from the most recent file, which is the one that `listRollouts` puts first:
    // to develop a taste, what is from this month is worth more than last year's.
    expect(reactions).toHaveLength(2);
    expect(reactions.map((reaction) => reaction.reaction)).toContain("y esto también cuenta");
    // What was asked to be cut is what is taught, not what is counted: the second file is read the
    // same. A count made on part of the disk and presented as the total is exactly the lie that
    // this counter exists to avoid saying.
    expect(stats.files).toBe(2);
    expect(stats.reactions).toBe(6);
  });

  it("el fixture sella la antigüedad a mano y no se fía del reloj", () => {
    /*
      The `limit` test relies on the second rollout being more recent than the first, and writing
      them consecutively does not guarantee that: on Linux, two `writeFileSync` almost always fall
      on the same tick of the inode dates, and on Windows the clock jumps by 15 ms. Tied,
      `listRollouts` breaks the tie by path and the sample comes from the wrong file. Here the
      premise is checked, not the machine's clock.
     */
    const segundoRollout = "sessions/2026/08/21/rollout-2026-08-21T09-00-00-sesion-2.jsonl";
    const home = makeHome({
      [ROLLOUT]: [meta(), agent("Hecho."), human("vale")],
      [segundoRollout]: [meta({ id: "sesion-2" }), agent("Hecho."), human("vale")],
    });
    const primero = statSync(join(home, ".codex", ...ROLLOUT.split("/")));
    const segundo = statSync(join(home, ".codex", ...segundoRollout.split("/")));

    expect(segundo.mtimeMs - primero.mtimeMs).toBeGreaterThanOrEqual(1_000);
  });

  it("cwdPrefix y onlySignals filtran lo que sale, no lo que se cuenta", async () => {
    const home = makeHome({
      [ROLLOUT]: [
        meta({ cwd: "/casa/anotes/apps/web" }),
        agent("Hecho."),
        human("de la web, no me gusta"),
        turnContext("/casa/anotes-viejo/apps/web"),
        agent("Hecho."),
        // The neighbor with the same literal prefix: without checking the slash, it would match.
        human("del vecino, no me gusta"),
        turnContext("/casa/anotes/apps/cli"),
        agent("Hecho."),
        human("de la cli, vale sigue"),
      ],
    });

    const porProyecto = await mineCodex({ home, cwdPrefix: "/casa/anotes" });
    expect(porProyecto.reactions.map((reaction) => reaction.reaction)).toEqual([
      "de la web, no me gusta",
      "de la cli, vale sigue",
    ]);

    const conSeñal = await mineCodex({ home, onlySignals: true });
    expect(conSeñal.reactions).toHaveLength(2);
    // The figures continue to describe the corpus read, not what was returned.
    expect(conSeñal.stats.reactions).toBe(3);
    expect(conSeñal.stats.withSignal).toBe(2);
  });

  it("las cifras cuadran entre sí", async () => {
    const home = makeHome({
      [ROLLOUT]: [
        meta(),
        ...noise(),
        human("empieza por la portada"),
        agent("Portada lista."),
        human("no me gusta"),
        call("shell"),
        callOutput("ok"),
        human("<realtime_delegation>\n  <input>nada</input>\n</realtime_delegation>"),
      ],
      "sessions/2026/08/21/rollout-2026-08-21T09-00-00-sesion-2.jsonl": [
        meta({ id: "sesion-2" }),
        agent("Otra sesión."),
        human("perfecto"),
      ],
    });

    const { stats } = await mineCodex({ home });

    expect(stats.files).toBe(2);
    expect(stats.bytes).toBeGreaterThan(0);
    expect(stats.sessions).toBe(2);
    expect(stats.userTurns).toBe(stats.reactions + stats.spontaneous);
    expect(stats.toolResults).toBe(2);
    expect(stats.commands).toBe(1);
    expect(stats.reactions).toBe(2);
    expect(stats.spontaneous).toBe(1);
    expect(stats.sidechain).toBe(0);
  });

  it("no lanza cuando no hay historial de Codex", async () => {
    const casa = join(root, "casa-que-no-existe");
    const { stats, reactions } = await mineCodex({ home: casa });

    expect(reactions).toEqual([]);
    expect(stats.files).toBe(0);
    expect(stats.sessions).toBe(0);
  });

  it("ningún secreto plantado en el historial sale en el resultado", async () => {
    /*
      The canary, as in `claude-code.test.ts`: instead of going over each field returned by the
      reader —which is what gets forgotten when one is added tomorrow—, impossible-to-confuse
      values are planted in the spots where one could slip out, and the value is searched for in
      **everything** that comes out.
      The secrets go at the beginning of each text on purpose. At the end, the cut would erase
      them and the test would pass without anyone having written anything.
     */
    const secretos = {
      entrega: "sk-CANARIO-entrega-77aa41b0c9",
      reaccion: "sk-CANARIO-reaccion-9f3a2b1c4d",
      herramienta: "sk-CANARIO-herramienta-4b7e01ff",
      subagente: "sk-CANARIO-subagente-1c5566aa",
      preambulo: "sk-CANARIO-preambulo-3d9e77b0",
    };

    const home = makeHome({
      [ROLLOUT]: [
        meta(),
        agent(`${secretos.entrega} es la clave que acabo de poner en el .env`),
        call("shell"),
        callOutput(`OPENAI_API_KEY=${secretos.herramienta}`),
        human(`${secretos.reaccion} no me gusta, quítala de ahí`),
        agent("Quitada."),
        human(
          `# Files mentioned by the user:\n\n## .env: ${secretos.preambulo}\n\n` +
            "## My request for Codex:\nperfecto, ahora el resto",
        ),
      ],
      "sessions/2026/08/20/rollout-2026-08-20T10-02-00-sub.jsonl": [
        meta({ id: "sub", source: { subagent: { thread_spawn: { depth: 1 } } } }),
        agent("Hecho."),
        human(`${secretos.subagente} mira esto`),
      ],
    });

    const { reactions } = await mineCodex({ home });

    // Without this, a reader who always returned an empty list would pass the exam.
    expect(reactions).toHaveLength(2);
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

  it("los topes que shared.ts se trajo de claude-code.ts no se han separado", () => {
    /*
      `shared.ts` is today a declared copy: `claude-code.ts` still has these same constants as its
      own private ones because this increment does not touch that file. The way such a copy rots
      is that someone uploads `BRIEF_CHARS` somewhere, tests it, it works, and the folder starts
      calling brief two different things depending on whose history it is. This does not prevent
      it; it makes it noisy, which is what can be done without touching the other file.
     */
    const topes = (file: string): Record<string, string> => {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      const found: Record<string, string> = {};
      const nombres = "DELIVERY_CHARS|REACTION_CHARS|BRIEF_CHARS|MAX_LINE_CHARS";
      const pattern = new RegExp(`^(?:export )?const (${nombres}) = ([^;]+);`, "gm");
      for (const match of source.matchAll(pattern)) {
        if (match[1] !== undefined && match[2] !== undefined) found[match[1]] = match[2];
      }
      return found;
    };

    const compartidos = topes("./shared.ts");
    expect(Object.keys(compartidos).sort()).toEqual([
      "BRIEF_CHARS",
      "DELIVERY_CHARS",
      "MAX_LINE_CHARS",
      "REACTION_CHARS",
    ]);
    expect(topes("./claude-code.ts")).toEqual(compartidos);
  });
});

/**
 * Which project was the work for, which is not where the terminal was.
 *
 * It is rule 8, and it arrived six increments late: during all that time, 61% of the author's
 * corpus was tied to `cwd`. Measured over 120 sessions on the author's disk, the commands' `workdir`
 * disagrees with `cwd` in 16 of the 109 that carry it, and it disagrees with the exact form of the
 * failure — the terminal parked at `~/Documents/trad89` while the work occurred at
 * `trad89/humo_check`, which is another project in the catalog.
 *
 * What is extracted are fields by contract and nothing more. From a shell command, you don't get
 * paths: `rm -rf node_modules` and `cd ..` would give two that are not the work.
 */
describe("de qué proyecto era el trabajo", () => {
  it("saca el workdir que declara la herramienta, aunque el terminal esté en otro sitio", async () => {
    const home = makeHome({
      [ROLLOUT]: [
        meta(),
        exec("pnpm test", "/casa/anotes/apps/web/interno"),
        agent("Hecho."),
        human("no me gusta ese borde"),
      ],
    });

    const { reactions } = await mineCodex({ home });
    expect(reactions[0]?.cwd, "el terminal seguía donde estaba").toBe(CWD);
    expect(reactions[0]?.paths).toEqual(["/casa/anotes/apps/web/interno"]);
  });

  it("y el de las llamadas normales, que traen el JSON en `arguments`", async () => {
    const home = makeHome({
      [ROLLOUT]: [
        meta(),
        call("exec_command", { cmd: "ls", workdir: "/casa/otro" }),
        agent("Hecho."),
        human("no"),
      ],
    });

    const { reactions } = await mineCodex({ home });
    expect(reactions[0]?.paths).toEqual(["/casa/otro"]);
  });

  /* A patch names the files that were really edited: the strongest signal there is. */
  it("saca los ficheros que nombra un parche", async () => {
    const home = makeHome({
      [ROLLOUT]: [
        meta(),
        patch(["/casa/anotes/uno.ts", "/casa/anotes/dos.ts"]),
        agent("Hecho."),
        human("mal"),
      ],
    });

    const { reactions } = await mineCodex({ home });
    expect(reactions[0]?.paths).toEqual(["/casa/anotes/uno.ts", "/casa/anotes/dos.ts"]);
  });

  /*
    Nothing comes out of a command. It is the prohibition of the other reader, written here as
    proof: a `cd ..` inside the command cannot be turned into a path.
   */
  it("del comando en sí no sale ninguna ruta", async () => {
    const home = makeHome({
      [ROLLOUT]: [
        meta(),
        exec("cd /casa/inventada && rm -rf /casa/tampoco", "/casa/anotes"),
        agent("Hecho."),
        human("no"),
      ],
    });

    const { reactions } = await mineCodex({ home });
    expect(reactions[0]?.paths).toEqual(["/casa/anotes"]);
  });

  /* Not even the root alone, which comes out in this album and is not any project. */
  it("la raíz sola no cuenta como proyecto", async () => {
    const home = makeHome({
      [ROLLOUT]: [meta(), exec("ls", "/"), agent("Hecho."), human("no")],
    });

    const { reactions } = await mineCodex({ home });
    expect(reactions[0]?.paths).toBeUndefined();
  });

  /*
    The window is "what it did since you spoke," so it accumulates over all the calls between two
    of your turns and empties when the reaction is issued — not when a delivery is seen. The work
    is not in the message that closes it, which is usually the summary.
   */
  it("acumula entre dos turnos tuyos y se vacía al reaccionar", async () => {
    const home = makeHome({
      [ROLLOUT]: [
        meta(),
        exec("uno", "/casa/uno"),
        agent("Voy."),
        exec("dos", "/casa/dos"),
        agent("Hecho."),
        human("no me gusta"),
        agent("Cambiado."),
        human("ahora sí"),
      ],
    });

    const { reactions } = await mineCodex({ home });
    expect(reactions[0]?.paths).toEqual(["/casa/uno", "/casa/dos"]);
    /*
      The second one did not have its own tools: it inherits those of the session, ordered by how
      many times each one was used and alphabetically in case of a tie. The order is not that of
      appearance on purpose — two sweeps of the same history have to produce the same rows.
     */
    expect(reactions[1]?.paths).toEqual(["/casa/dos", "/casa/uno"]);
  });

  /* Rule 4, also for the routes: what was covered in the previous session is not from this one. */
  it("una cabecera nueva olvida las rutas de la anterior", async () => {
    const home = makeHome({
      [ROLLOUT]: [
        meta(),
        exec("uno", "/casa/vieja"),
        meta({ id: "sesion-2", cwd: "/casa/nueva" }),
        agent("Hecho."),
        human("no"),
      ],
    });

    const { reactions } = await mineCodex({ home });
    expect(reactions[0]?.paths, "no hereda de la sesión de antes").toBeUndefined();
  });

  /* A tool output weighs megabytes and doesn't even have a path field: it won't open. */
  it("de la salida de una herramienta no se saca nada", async () => {
    const home = makeHome({
      [ROLLOUT]: [
        meta(),
        callOutput('{"workdir":"/casa/mentira"}'),
        agent("Hecho."),
        human("no"),
      ],
    });

    const { reactions } = await mineCodex({ home });
    expect(reactions[0]?.paths).toBeUndefined();
  });
});
