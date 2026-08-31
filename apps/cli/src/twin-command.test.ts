import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "./args";
import {
  decisionLines,
  distilledLines,
  dryRunLines,
  funnelLines,
  groupVerdicts,
  profileLines,
  projectLabel,
  projectPrefix,
  reactionBatches,
  restCount,
  sampleLines,
  saveTotals,
  scoreLines,
  sourceLines,
  synthEstimateLines,
  synthLines,
  totalLines,
  toSample,
  verdictLines,
  type SaveReply,
  type ScoreReply,
  type SourceRow,
  type StoredVerdict,
  type SynthesizeReply,
  type TasteProfileWire,
  collectLimit,
  inboxLine,
  lookEstimateLines,
  lookLines,
  type LookEstimate,
  type LookReply,
} from "./twin-command";
import type { HistorySource, MineStats, QuoteRedaction, Reaction } from "@panoma/core";

/**
 * Twin is tested by its formatters, and not by starting the process.
 *
 * It is the same decision as in `args.ts` and `lang.ts`: what has its own logic is taken out into
 * a pure function and tested with fake objects. Here, it is also necessary: actual mining requires
 * a Claude Code story on the disk, meaning the test would pass on this laptop and fail on the CI
 * of Windows without anything being broken.
 *
 * And that is why `twin-command.ts` imports the engine with `await import(…)` inside each
 * subcommand: their types are erased upon compilation, so this file can load it without
 * `@panoma/core` being rebuilt with the miner inside.
 *
 * What is monitored is not the layout —which will change— but the promises made by the output:
 * that the discards from the funnel are shown without pretending that they are subtracted, that
 * the only rendered subtraction matches, that an absent story is not told as empty, and that the
 * text that reaches the terminal is the one that went through the cap.
 *
 * The five screens that communicate with the catalog —`verdicts`, `distill`, `review`, `taste`,
 * and `score` — are tested with the same rule and for two additional reasons. One, because
 * launching the web to check a grouping would be slow here and show red on the CI of Windows
 * without anything being broken. And two, because `review` asks about `readline`: a test that
 * opened a terminal would end up waiting for a response that no one is going to type, which is
 * exactly the failure that the command itself guards against when `stdin` is not a terminal. So
 * what is tested is what decides: the distribution by project, the three painters, and the board
 * that turns a key into a decision that cannot be undone.
 */

/** The escape of the colors, written in code so as not to put a control character here. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function plain(lines: string[]): string {
  return lines.join("\n").replace(ANSI, "");
}

function source(overrides: Partial<HistorySource> = {}): HistorySource {
  return {
    id: "claude-code",
    label: "Claude Code",
    path: "/en/ninguna/parte/.claude/projects",
    present: true,
    files: 412,
    bytes: 12 * 1024 * 1024,
    ...overrides,
  };
}

/** An inventory row already resolved, which is what `sourceLines` represents. */
function row(
  overrides: Partial<HistorySource> = {},
  state: SourceRow["state"] = "denied",
): SourceRow {
  return { source: source(overrides), state };
}

/*
  The fixture respects the only identity that the miner guarantees — `userTurns` already arrives
  without the discards, and from there come `reactions + spontaneous`, verified in
  claude-code.test.ts:463 —. The previous one had 41,002 turns with 6,240 reactions and 311
  spontanes, which doesn’t match 34,451: with impossible numbers there was no way the false
  subtraction that the funnel showed would trigger. `toolResults` is greater than `userTurns` on
  purpose, because in the real disk it is, and thus a subtraction on that row would show negative
  visually.
 */
const STATS: MineStats = {
  files: 1284,
  bytes: 412 * 1024 * 1024,
  sessions: 3918,
  userTurns: 6551,
  toolResults: 29110,
  sidechain: 842,
  commands: 611,
  reactions: 6240,
  briefs: 1902,
  spontaneous: 311,
  withSignal: 4120,
};

function reaction(overrides: Partial<Reaction> = {}): Reaction {
  return {
    source: "claude-code",
    sessionId: "0f3a",
    at: "2026-08-19T21:40:00.000Z",
    cwd: "/Users/quien/Desktop/anotes",
    delivery: "listo, ya compila",
    reaction: "no era eso",
    chars: 10,
    brief: true,
    signals: ["rejection", "redo"],
    ...overrides,
  };
}

function redaction(overrides: Partial<QuoteRedaction> = {}): QuoteRedaction {
  return { text: "no era eso", redacted: false, labels: [], ...overrides };
}

/*
  The identities in the catalog, written out in full because that's what half the test is about:
  they are forty-character hashes and what is being checked is that they are shortened without
  losing their distinctness.
 */
const ANOTES = "git:5f2a1c9d0e11223344556677889900aabbccddee";
const OTRO = "git:bb31cc7d0e11223344556677889900aabbccddee";

/** A verdict just as it comes from `GET /api/twin/verdicts`, that is, already passed through JSON. */
function stored(overrides: Partial<StoredVerdict> = {}): StoredVerdict {
  return {
    identity: ANOTES,
    source: "claude-code",
    at: "2026-08-19T21:40:00.000Z",
    quote: "no era eso",
    signals: ["rejection", "redo"],
    ...overrides,
  };
}


/* The materials arrive in the reverse order in which they are rendered: that is part of the test. */
const PROFILE: TasteProfileWire = {
  lines: [
    {
      topic: "cli",
      statement: "Odias las barras de progreso que no miden nada.",
      citations: ["v1", "v2"],
    },
    {
      topic: "design",
      statement: "Prefieres el «no» antes que el resumen.",
      citations: ["v3"],
    },
  ],
  chars: 1240,
  cap: 3000,
};

describe("el inventario se lee antes de abrir nada", () => {
  it("cada historia presente dice cuántos ficheros y cuánto ocupa", () => {
    const text = plain(sourceLines([row()]));
    expect(text).toContain("claude-code");
    expect(text).toContain("Claude Code");
    expect(text).toContain("412");
    expect(text).toContain("12 MB");
    // The route follows the line: without it, one does not know where one has looked.
    expect(text).toContain("/.claude/projects");
  });

  /*
    "'Not there' and 'it's empty' are not the same, and the difference matters before accepting
    anything: a zero invites you to think that the folder was opened and there was nothing
    inside."
   */
  it("una historia ausente no se cuenta como vacía", () => {
    const ausente = row(
      { id: "codex", label: "Codex", path: "/nada/.codex", present: false, files: 0, bytes: 0 },
      "absent",
    );
    const text = plain(sourceLines([ausente]));
    expect(text).toContain("codex");
    expect(text).not.toMatch(/\b0\b/);
  });
});

/*
  The rule of the situation —`consentState`— is tested in `@panoma/core`, which is where it has
  lived since the terminal and the web ask it. Here it is tested what really belongs to this
  command: that each situation is rendered differently, and that the absent one does not offer a
  permission that would be useless.
 */
describe("cómo se pinta cada situación del permiso", () => {
  it("la que no está y además no tiene lector se queda callada, no medida", () => {
    const text = plain(sourceLines([row({ id: "aider", present: false }, "absent")]));
    expect(text).not.toContain("panoma twin allow");
  });

  it("la que está sin permiso trae el comando exacto que la abre", () => {
    const text = plain(sourceLines([row({}, "denied")]));
    expect(text).toContain("panoma twin allow claude-code");
    expect(text).not.toContain("panoma twin revoke");
  });

  it("y la que lo tiene, el que lo retira", () => {
    const text = plain(sourceLines([row({}, "allowed")]));
    expect(text).toContain("panoma twin revoke claude-code");
    expect(text).not.toContain("panoma twin allow");
  });

  /*
    The one that cannot be read cannot seem like the one missing to allow: they are the opposite.
    Promising that a `allow` would open Cursor is the only lie that this screen cannot afford,
    because it is the one that charges the permission in advance.
   */
  it("la que no tiene lector no ofrece un permiso que no leería nada", () => {
    const text = plain(sourceLines([row({ id: "cursor", label: "Cursor" }, "noReader")]));
    expect(text).not.toContain("panoma twin allow");
    expect(text).not.toBe(plain(sourceLines([row({ id: "cursor" }, "denied")])));
  });

  /*
    A clue for each of the five sources turns the inventory into a wall, and there is nothing to
    grant about what is not there.
   */
  it("la ausente no gasta una segunda línea", () => {
    expect(sourceLines([row({ present: false }, "absent")])).toHaveLength(1);
    expect(sourceLines([row({}, "denied")])).toHaveLength(2);
  });
});

/**
 * What is answered after conceding, which is the last opportunity to make amends.
 *
 * Whoever just typed `allow` has given Panoma the entire year-and-a-half-long conversation with a
 * work tool. The inventory already knows how much that is, so stating it in the confirmation costs
 * a line and a `revoke` to the one who got the source wrong; keeping it silent turns the
 * measurement that justified the entire screen of the permission into decoration.
 */
describe("la confirmación de allow y revoke", () => {
  it("el sí dice el tamaño de lo que acaba de conceder", () => {
    const text = plain(decisionLines(source(), true, true));
    expect(text).toContain("Claude Code");
    expect(text).toContain("412");
    expect(text).toContain("12 MB");
    expect(text).toContain("panoma twin mine --source claude-code");
  });

  /*
    A «covers 0 files · 0 B» on a tool that was never written here reads as a command failure, not
    as the state of the machine.
   */
  it("sobre una historia que no está, no se anuncia un cero", () => {
    const text = plain(decisionLines(source({ present: false }), true, true));
    expect(text).not.toMatch(/\b0\b/);
  });

  it("sin lector se dice que el permiso queda sin nada que abrir", () => {
    const conLector = plain(decisionLines(source(), true, true));
    const sinLector = plain(decisionLines(source(), true, false));
    expect(sinLector).not.toBe(conLector);
    // And you don't send someone to mine something that they don't know how to read.
    expect(sinLector).not.toContain("panoma twin mine");
  });

  it("el no confirma que esos ficheros no se vuelven a abrir", () => {
    const text = plain(decisionLines(source(), false, true));
    expect(text).toContain("Claude Code");
    expect(text).not.toContain("412");
  });
});

describe("el embudo se enseña entero", () => {
  it("no se salta ningún escalón", () => {
    const text = plain(funnelLines(STATS));
    for (const n of [1284, 3918, 6551, 29110, 842, 611, 6240, 1902, 311, 4120]) {
      expect(text, `falta el ${n} en el embudo`).toContain(String(n));
    }
    expect(text).toContain("412 MB");
  });

  /*
    What makes the result believable are the discards, and that's why they are shown. What they
    cannot do is subtract themselves: the miner counts the three and does `continue` before
    touching `userTurns` (claude-code.ts:313, 318, and 330 versus 334), meaning that row already
    comes clean. rendered with «−» underneath it, the funnel showed 6,551 − 29,110 = 6,240 right in
    the row with which the command sells that it is not lying to you.
   */
  it("los descartes se enseñan, pero no fingen restarse de lo que ya los excluye", () => {
    const text = plain(funnelLines(STATS));
    for (const n of [STATS.toolResults, STATS.sidechain, STATS.commands]) {
      expect(text, `el descarte ${n} tiene que verse`).toContain(String(n));
      expect(text, `y el ${n} no puede ir restado`).not.toMatch(new RegExp(`−\\s+${n}\\b`));
    }
  });

  /*
    The arithmetic is read from the screen itself, which is what the doubter sees: the only
    subtraction rendered has to be the one that adds up, `userTurns − spontaneous = reactions`.
   */
  it("la única resta pintada cuadra, y el resultado va marcado", () => {
    const text = plain(funnelLines(STATS));
    const restados = [...text.matchAll(/−\s+(\d+)/g)].map(([, n]) => Number(n));
    const iguales = [...text.matchAll(/=\s+(\d+)/g)].map(([, n]) => Number(n));

    expect(restados).toEqual([STATS.spontaneous]);
    expect(iguales).toEqual([STATS.reactions]);
    expect(STATS.userTurns - restados.reduce((total, n) => total + n, 0)).toBe(STATS.reactions);
  });

  /*
    `spontaneous` is not a breakdown of the reactions but their exact complement, so bleeding it
    under the '=' meant that those turns were included in the total marked when they were actually
    outside. In a corpus of sessions that only have an opening message, the absurdity was total:
    '= 0 reactions' with '30 without anyone asking you anything' nested inside.
   */
  it("solo se sangra lo que de verdad está dentro de las reacciones", () => {
    const lines = funnelLines(STATS).map((line) => line.replace(ANSI, ""));
    const sangria = (n: number): number => {
      const found = lines.find((line) => line.includes(String(n)));
      if (found === undefined) throw new Error(`no se pintó el ${n} en el embudo`);
      return found.search(/\S/);
    };

    expect(sangria(STATS.spontaneous)).toBe(sangria(STATS.reactions));
    expect(sangria(STATS.briefs)).toBeGreaterThan(sangria(STATS.reactions));
    expect(sangria(STATS.withSignal)).toBeGreaterThan(sangria(STATS.reactions));
  });
});

/**
 * The line that adds the stories, that only exists when there is something to add.
 *
 * `mine` without `--source` reads all the allowed ones, so with two sources there are two funnels
 * and it is necessary to know how much has been opened in total. With only one, that 'total' would
 * repeat the figure of the funnel above, and a total that repeats a partial teaches to skip them.
 */
describe("el total de todas las historias juntas", () => {
  const otro: MineStats = {
    ...STATS,
    files: 246,
    bytes: 100 * 1024 * 1024,
    reactions: 1431,
    withSignal: 129,
  };

  it("con dos historias suma ficheros, bytes, reacciones y señales", () => {
    const text = plain(totalLines([{ stats: STATS }, { stats: otro }]));
    expect(text).toContain(String(STATS.files + otro.files));
    expect(text).toContain(String(STATS.reactions + otro.reactions));
    expect(text).toContain(String(STATS.withSignal + otro.withSignal));
    expect(text).toContain("512 MB");
  });

  it("con una sola no se pinta, porque sería el embudo de encima repetido", () => {
    expect(totalLines([{ stats: STATS }])).toEqual([]);
    expect(totalLines([])).toEqual([]);
  });

  /*
    Each funnel fits within its story (`userTurns − spontaneous = reactions`), but an added funnel
    would invite making that subtraction between different formats, where 'bar order' doesn't even
    mean the same thing in both.
   */
  it("y no suma los descartes, que no son comparables entre formatos", () => {
    const text = plain(totalLines([{ stats: STATS }, { stats: otro }]));
    expect(text).not.toContain(String(STATS.toolResults + otro.toolResults));
    expect(text).not.toContain(String(STATS.userTurns + otro.userTurns));
  });
});

describe("las reacciones que no caben en la muestra", () => {
  it("sin filtro se dice cuántas quedan fuera", () => {
    expect(restCount(STATS, 8, false)).toBe(STATS.reactions - 8);
  });

  /*
    `stats.reactions` is counted before the route filter (claude-code.ts:347 compared to
    `underPrefix` of the 355), so with `--project` the two numbers are from different populations:
    measured with four reactions, one of which fell under the prefix, the remainder announced “and
    3 more that don’t fit here” when under that project there were none left. No one knows the
    filtered total without a new counter in the engine, and staying silent is better than
    promising a number that this filter would never return.
   */
  it("con --project no se promete un resto que ese filtro no daría", () => {
    expect(restCount(STATS, 8, true)).toBeUndefined();
  });

  it("y un resto de cero no se anuncia", () => {
    expect(restCount({ ...STATS, reactions: 3 }, 3, false)).toBeUndefined();
    expect(restCount({ ...STATS, reactions: 2 }, 3, false)).toBeUndefined();
  });
});

/**
 * The route of `--project`, which traveled raw up to a pure text comparison.
 *
 * `underPrefix` does not touch the disk on purpose, so an unexpanded tilde does not prefix any
 * `cwd` and the failure is silent: zero reactions with the entire funnel on top. It happens with
 * quoting in zsh and always in PowerShell, which does not expand `~` in native program arguments —
 * and Windows is a first-class target of CI. The expander is passed as a parameter to be able to
 * test it without `@panoma/core` reconstructed, just like the wording.
 */
describe("la ruta de --project", () => {
  const home = "/Users/quien";
  const expand = (path: string): string =>
    path.startsWith("~/") ? `${home}${path.slice(1)}` : path;

  it("la tilde se expande antes de comparar", () => {
    expect(projectPrefix("~/Desktop/anotes", expand)).toBe(resolve(`${home}/Desktop/anotes`));
  });

  it("y una relativa se ancla, porque nunca prefijaría un cwd absoluto", () => {
    expect(projectPrefix("apps/web", expand)).toBe(resolve("apps/web"));
  });

  it("una absoluta llega intacta", () => {
    const absoluta = resolve(`${home}/Desktop/anotes`);
    expect(projectPrefix(absoluta, expand)).toBe(absoluta);
  });
});

describe("las reacciones de ejemplo", () => {
  it("el proyecto es el nombre de la carpeta, no la ruta entera", () => {
    expect(toSample(reaction(), redaction()).project).toBe("anotes");
  });

  it("una sesión sin carpeta no estrena un proyecto inventado", () => {
    const sample = toSample(reaction({ cwd: undefined }), redaction());
    expect(sample.project).not.toContain("anotes");
    expect(sample.project.length).toBeLessThan(3);
  });

  it("aplasta los saltos de línea y recorta lo que no cabe", () => {
    const largo = "vuelve a hacerlo. ".repeat(20);
    const sample = toSample(reaction(), redaction({ text: `no,\n\n   ${largo}` }));
    expect(sample.text).not.toContain("\n");
    expect(sample.text.length).toBeLessThanOrEqual(72);
    expect(sample.text.endsWith("…")).toBe(true);
  });

  /*
    The reason why the writing is passed as a parameter instead of being called inside: the text
    that is printed is the one that comes in, so there is no way for the raw data to end up on the
    screen. One of your reactions can have a API key attached, and this takes it from a file that
    only you could read.
   */
  it("se enseña lo que devolvió el tapador, jamás el texto crudo", () => {
    const sample = toSample(
      reaction({ reaction: "toma la clave sk-live-999 y arréglalo" }),
      redaction({ text: "toma la clave ● y arréglalo", redacted: true }),
    );
    expect(sample.text).not.toContain("sk-live-999");
    expect(sample.redacted).toBe(true);
  });

  it("la línea lleva día, proyecto y señales", () => {
    const text = plain(sampleLines([toSample(reaction(), redaction())]));
    expect(text).toContain("2026-08-19");
    expect(text).toContain("anotes");
    expect(text).toContain("rejection");
    expect(text).toContain("redo");
    expect(text).toContain("no era eso");
  });

  it("lo tapado se avisa en la propia línea", () => {
    const tapada = toSample(reaction(), redaction({ text: "la clave es ●", redacted: true }));
    const limpia = toSample(reaction(), redaction({ text: "la clave es ●" }));
    const conAviso = plain(sampleLines([tapada]));
    expect(conAviso).not.toBe(plain(sampleLines([limpia])));
    expect(conAviso).toContain("!");
  });
});

/**
 * What `--save` sends and what it reports back, without a server in between.
 *
 * Nothing is raised here: what makes sense is the chopping and the sum of the counters, and both
 * are pure functions. A test that would start the website to check an integer division would be
 * slow on this machine and fail on the CI of Windows without anything being broken.
 */
describe("lo que se envía al catálogo con --save", () => {
  const muchas = (n: number): Reaction[] =>
    Array.from({ length: n }, (_, i) => reaction({ sessionId: `s${i}` }));

  it("se trocea en tandas del tamaño pedido, y la última lleva el resto", () => {
    const groups = reactionBatches(muchas(1201), 500);
    expect(groups.map((group) => group.length)).toEqual([500, 500, 201]);
    expect(groups.flat()).toHaveLength(1201);
  });

  it("un múltiplo exacto no estrena una tanda vacía al final", () => {
    expect(reactionBatches(muchas(1000), 500).map((group) => group.length)).toEqual([500, 500]);
  });

  /*
    Without reactions, nothing is sent. A `{ reactions: [] }` is a request that can only respond
    with zeros, and those zeros would be displayed as 'saved: 0' on a screen that had nothing to
    save.
   */
  it("sin reacciones no hay ninguna petición que hacer", () => {
    expect(reactionBatches([], 500)).toEqual([]);
  });

  /* A size of zero would turn the loop into an infinite one with the entire list inside. */
  it("un tamaño imposible no se queda dando vueltas", () => {
    expect(reactionBatches(muchas(3), 0)).toHaveLength(1);
    expect(reactionBatches([], 0)).toEqual([]);
  });

  it("los contadores de reacciones se suman tanda a tanda", () => {
    const replies: SaveReply[] = [
      { saved: 400, duplicates: 88, unmatched: 10, undated: 2, projects: 3 },
      { saved: 90, duplicates: 400, unmatched: 8, undated: 2, projects: 2 },
    ];
    const totals = saveTotals(replies);
    expect(totals.saved).toBe(490);
    expect(totals.duplicates).toBe(488);
    expect(totals.unmatched).toBe(18);
    expect(totals.undated).toBe(4);
    /*
      The reason for collecting `undated`: without it, the accounts do not balance. The route
      returns it precisely for that —it argues in its header—, and collecting it without showing
      it would be the silence that the funnel of `mine` spends the entire screen teaching not to
      have.
     */
    const enviadas = 500 + 500;
    expect(totals.saved + totals.duplicates + totals.unmatched + totals.undated).toBe(enviadas);
  });

  /*
    These figures come from a `as` about the server's response, that is, from its word. A catalog
    from another version that returned four fields would give 'saved: NaN', which is worse than a
    zero and much worse than staying silent.
   */
  it("un campo que no llega cuenta como cero, nunca como NaN", () => {
    const vieja = { saved: 10, duplicates: 0, unmatched: 0, projects: 1 } as SaveReply;
    expect(saveTotals([vieja]).undated).toBe(0);
    expect(saveTotals([vieja]).saved).toBe(10);
  });

  /*
    The one that cannot be added. `projects` counts different projects, and a large project
    distributes its reactions in several batches — they go in the miner's order, that is, grouped
    by session and therefore by folder — so adding it counts it once per batch. With 3,400
    reactions from two projects, there were seven. It stays silent, like `restCount` with
    `--project`: a silent figure costs one line, and a false one costs the other three.
   */
  it("los proyectos no se suman entre tandas: o se saben, o no se dicen", () => {
    const una: SaveReply = { saved: 1, duplicates: 0, unmatched: 0, undated: 0, projects: 3 };
    expect(saveTotals([una]).projects).toBe(3);
    expect(saveTotals([una, una]).projects).toBeUndefined();
    expect(saveTotals([]).projects).toBeUndefined();
  });
});

/**
 * The flags of `twin mine`, checked in the parser and not in the command.
 *
 * A flag implemented in your command but unknown here does not exist: `parseArgs` runs first and
 * kills with "Unknown Option" whatever is not on its list. This is exactly what happened to
 * `--model` and `--provider`, which were written and were unreachable.
 */
describe("los flags de twin mine y twin distill", () => {
  function flagsOf(argv: string[]) {
    const parsed = parseArgs(argv);
    if (parsed === "help" || parsed === "version" || "error" in parsed) {
      throw new Error(`no se esperaba error ni ayuda: ${JSON.stringify(parsed)}`);
    }
    return parsed;
  }

  function errorOf(argv: string[]): string {
    const parsed = parseArgs(argv);
    if (parsed === "help" || parsed === "version" || !("error" in parsed)) {
      throw new Error(`se esperaba un error y se aceptó: ${JSON.stringify(argv)}`);
    }
    return parsed.error;
  }

  it("--limit vale con espacio y con igual, y no cae en los posicionales", () => {
    expect(flagsOf(["twin", "mine", "--limit", "5"]).limit).toBe(5);
    expect(flagsOf(["twin", "mine", "--limit=5"]).limit).toBe(5);
    expect(flagsOf(["twin", "mine", "--limit", "5"]).positionals).toEqual(["twin", "mine"]);
  });

  it("--project llega entero y tampoco se cuela entre los posicionales", () => {
    const flags = flagsOf(["twin", "mine", "--project", "~/Desktop/anotes"]);
    expect(flags.project).toBe("~/Desktop/anotes");
    expect(flags.positionals).toEqual(["twin", "mine"]);
  });

  /*
    `--source` goes through `takeValue` like the others, and that is what needs to be noted:
    without consuming the next argument, `codex` would fall into the positionals, where
    `positionals[1]` is the subcommand and the one next to it is the identifier of `allow`. A
    `twin mine --source codex` would then have been read as another distinct command.
   */
  it("--source vale con espacio y con igual, y no cae en los posicionales", () => {
    const flags = flagsOf(["twin", "mine", "--source", "codex"]);
    expect(flags.source).toBe("codex");
    expect(flagsOf(["twin", "mine", "--source=codex"]).source).toBe("codex");
    expect(flags.positionals).toEqual(["twin", "mine"]);
  });

  it("y se combina con los otros dos sin pisarlos", () => {
    const flags = flagsOf(["twin", "mine", "--source", "codex", "--limit", "3", "--save"]);
    expect(flags.source).toBe("codex");
    expect(flags.limit).toBe(3);
    expect(flags.save).toBe(true);
  });

  it("sin ellos no hay valores fantasma", () => {
    expect(flagsOf(["twin", "mine"]).limit).toBeUndefined();
    expect(flagsOf(["twin", "mine"]).project).toBeUndefined();
    expect(flagsOf(["twin", "mine"]).source).toBeUndefined();
  });

  /* A `--source` with nothing behind it cannot mean 'all': it is the opposite. */
  it("un --source sin valor se rechaza en vez de leerse como todas", () => {
    expect(errorOf(["twin", "mine", "--source"])).toContain("--source");
    expect(errorOf(["twin", "mine", "--source", "--save"])).toContain("--source");
  });

  /*
    A limit that is not understood cannot be left at 'all': it would be writing it wrong and
    receiving the opposite of what was requested, with the entire story on screen and the same
    expression of having obeyed that `--securiy` had.
   */
  it("un límite que no es un número se rechaza", () => {
    expect(errorOf(["twin", "mine", "--limit", "dos"])).toContain("--limit");
    expect(errorOf(["twin", "mine", "--limit", "0"])).toContain("--limit");
    expect(errorOf(["twin", "mine", "--limit"])).toContain("--limit");
  });

  it("y uno mal escrito se sugiere bien", () => {
    const error = errorOf(["twin", "mine", "--limt", "5"]);
    expect(error).toContain("--limt");
    expect(error).toContain("--limit");
  });

  /*
    And that of `twin distill`, which is the only flag of the command that decides if money is
    spent. A `--dry-run` that would die in 'Unknown Option' would be the failure of `--model`:
    written, documented, and unreachable, because this parser runs before the command. Worse here,
    because the path that was wanted to be avoided—the one that spends—is the one taken without
    it.
   */
  it("--dry-run se reconoce y no cae en los posicionales", () => {
    const flags = flagsOf(["twin", "distill", "--dry-run"]);
    expect(flags.dryRun).toBe(true);
    expect(flags.positionals).toEqual(["twin", "distill"]);
  });

  it("sin él no hay ensayo fantasma, y se combina con --limit", () => {
    expect(flagsOf(["twin", "distill"]).dryRun).toBe(false);
    const flags = flagsOf(["twin", "distill", "--limit", "500", "--dry-run"]);
    expect(flags.limit).toBe(500);
    expect(flags.dryRun).toBe(true);
  });

  it("mal escrito se sugiere en vez de ignorarse", () => {
    const error = errorOf(["twin", "distill", "--dry-runn"]);
    expect(error).toContain("--dry-runn");
    expect(error).toContain("--dry-run");
  });
});

describe("collectLimit", () => {
  it("sin --save, --limit acota lo que se recoge", () => {
    expect(collectLimit({ limit: 5, save: false })).toBe(5);
  });

  it("con --save, --limit deja de acotar: se guarda todo y solo se enseñan unas pocas", () => {
    // The measured case: `twin mine --limit 3 --save` stored 3 out of 2,010 and responded 'stored:
    // 3'. No word was false and the entire sentence was misleading.
    expect(collectLimit({ limit: 3, save: true })).toBeUndefined();
  });

  it("sin --limit no se acota nada, con o sin --save", () => {
    expect(collectLimit({ save: false })).toBeUndefined();
    expect(collectLimit({ save: true })).toBeUndefined();
  });
});

/**
 * The receipt of what was saved, which is the only way to verify the figure given by `--save`.
 *
 * `twin mine --save` responds «saved: 2,604» and until now that phrase could only be verified by
 * opening the database, meaning it couldn’t be done. What is monitored here is that the
 * distribution by project does not invent or create anything: a verdict keeps the identity under
 * which it was archived and not the folder name —the table does not hang from `projects` on
 * purpose, `schema.ts` explains— and that identity needs to be shortened so that it fits without
 * two different projects ending up being read as the same.
 */
describe("los veredictos guardados, repartidos por proyecto", () => {
  it("cada proyecto junta los suyos y el orden que llega es el que se pinta", () => {
    const groups = groupVerdicts([
      stored({ quote: "primera" }),
      stored({ identity: OTRO, quote: "de otro sitio" }),
      stored({ quote: "tercera" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.verdicts.map((one) => one.quote)).toEqual(["primera", "tercera"]);
    expect(groups[1]?.verdicts.map((one) => one.quote)).toEqual(["de otro sitio"]);
  });

  /*
    The case that decides how much identity is taught. Two different repositories with a
    `apps/web` inside are two projects, and with the fully shortened sha they would be read as a
    single one: the screen that serves as a receipt would be combining phrases from two places
    under the same title.
   */
  it("dos proyectos con la misma ruta interna no se funden en uno", () => {
    const groups = groupVerdicts([
      stored({ identity: `${ANOTES}:apps/web` }),
      stored({ identity: `${OTRO}:apps/web` }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.label).not.toBe(groups[1]?.label);
  });

  it("un veredicto sin identidad no estrena un proyecto inventado", () => {
    const groups = groupVerdicts([stored({ identity: null })]);
    expect(groups[0]?.label.length).toBeLessThan(3);
  });

  /*
    `signals` is `jsonb` in the database and `unknown` to Drizzle, and this comes through the
    network: a `null` in there would blow up the `.map` of the painter with a fault that mentions
    neither verdicts nor signals. It is the same defense that `saveTotals` makes with the
    counters.
   */
  it("unas señales que no llegan como lista se leen como ninguna", () => {
    const rota = { ...stored(), signals: null } as StoredVerdict;
    expect(groupVerdicts([rota])[0]?.verdicts[0]?.signals).toEqual([]);
  });
});

describe("la identidad de catálogo, acortada para que quepa", () => {
  it("se recorta el sha y se conserva la ruta de dentro", () => {
    expect(projectLabel(`${ANOTES}:apps/web`)).toBe("git:5f2a1c9d:apps/web");
    expect(projectLabel(ANOTES)).toBe("git:5f2a1c9d");
  });

  /* The `project` of an appointment can already come as a name, and there is nothing to cut there. */
  it("lo que no tiene esa forma se devuelve intacto", () => {
    expect(projectLabel("anotes")).toBe("anotes");
    expect(projectLabel(null)).not.toContain("git");
  });
});

describe("cómo se pinta un veredicto guardado", () => {
  it("lleva el día, la fuente, las señales y tus palabras", () => {
    const text = plain(verdictLines(groupVerdicts([stored()])));
    expect(text).toContain("2026-08-19");
    expect(text).toContain("claude-code");
    expect(text).toContain("rejection");
    expect(text).toContain("no era eso");
  });

  /*
    The project goes in the header of the group and not repeated in each line: with twenty
    verdicts from the same site, twenty forty-character identities do not inform anything and take
    up the column where your words go.
   */
  it("el proyecto se dice una vez por grupo", () => {
    const dos = groupVerdicts([stored(), stored({ quote: "otra" })]);
    expect(plain(verdictLines(dos)).match(/git:5f2a1c9d/g)).toHaveLength(1);
  });

  it("una cita larga se aplasta a una línea y se recorta", () => {
    const largo = `no,\n\n   ${"vuelve a hacerlo. ".repeat(20)}`;
    const text = plain(verdictLines(groupVerdicts([stored({ quote: largo })])));
    expect(text).toContain("…");
    for (const line of text.split("\n")) expect(line.length).toBeLessThan(96);
  });
});

/**
 * The budget of `distill`, which is the only thing that is printed before spending money.
 *
 * The four figures go together because all four are needed to decide: the number of tokens alone
 * does not say what it costs —it's not the same in a subscription as paying per token— and the
 * provider alone does not say how much will be sent to them.
 */
describe("el ensayo de distill", () => {
  const estimate = {
    verdicts: 2604,
    estimatedTokens: 812_000,
    provider: "anthropic",
    model: "claude-sonnet",
  };

  it("dice cuántos veredictos, cuántos tokens, con quién y con qué", () => {
    const text = plain(dryRunLines(estimate));
    expect(text).toContain("2604");
    expect(text).toContain("812000");
    expect(text).toContain("anthropic");
    expect(text).toContain("claude-sonnet");
  });
});

/**
 * What comes back from the model, with the two figures that do not mean the same thing.
 *
 * `observed` contains the phrases it wrote and `saved` the ones accepted: the remainder are the
 * ones that were already there, because the identifier of an entry is deterministic and distilling
 * the same corpus twice duplicates nothing. It is the same lesson that `twin.saved` learned with
 * «saved: 0» about three thousand reactions that were already inside.
 */
describe("lo que contesta distill después de gastar", () => {
  const outcome = { verdicts: 2604, observed: 12, saved: 12, model: "anthropic/claude-sonnet" };

  it("las observaciones y las guardadas se dicen por separado", () => {
    const repetido = plain(distilledLines({ ...outcome, saved: 0 }));
    expect(repetido).toContain("12");
    expect(repetido).not.toBe(plain(distilledLines(outcome)));
  });

  it("el consumo se dice cuando el modelo lo devuelve, y si no, no se inventa", () => {
    const usage = { input: 811_000, output: 900 };
    const con = plain(distilledLines({ ...outcome, usage }));
    expect(con).toContain("811000");
    expect(con).toContain("900");
    expect(plain(distilledLines(outcome))).not.toContain("→");
  });

  /* Zero proposals cannot carry the green mark that something went well. */
  it("sin ninguna propuesta no se pinta un éxito", () => {
    const text = plain(distilledLines({ ...outcome, observed: 0, saved: 0 }));
    expect(text).not.toContain("✓");
    expect(text).not.toContain("panoma twin synthesize");
  });
});

/**
 * The portrait and its budget, which is a hard limit and not a suggestion.
 *
 * Three thousand characters are imposed by `writeTaste`, which refuses to be bypassed. A limit
 * that you only find out about when you hit it is discovered at the worst possible moment, so the
 * number always goes, whether it is near or far.
 *
 * Here there were also two more screens —the one for reviewing a sentence while waiting for a
 * decision and the one for replying with a key— and they are not here because the queue is not
 * here: no one approves sentences one by one. What replaces those two is the synthesis, which asks
 * nothing, and its screens are the ones below.
 */
describe("el retrato, con el presupuesto a la vista", () => {
  it("las creencias se agrupan por materia y en un orden estable", () => {
    const text = plain(profileLines(PROFILE));
    // «design» goes before «cli» even if the list comes in reverse: the order is set by the screen,
    // and a portrait that rearranges itself is read as if it had changed.
    expect(text.indexOf("Prefieres")).toBeLessThan(text.indexOf("Odias"));
  });

  it("el presupuesto dice lo que ocupa, lo que cabe y lo que queda", () => {
    const text = plain(profileLines(PROFILE));
    expect(text).toContain("1240");
    expect(text).toContain("3000");
    expect(text).toContain("1760");
  });

  /* An overexposed portrait cannot announce that negative characters remain. */
  it("pasado el tope, lo que queda es cero y nunca un número negativo", () => {
    const text = plain(profileLines({ ...PROFILE, chars: 3200 }));
    expect(text).not.toContain("-200");
    expect(text).toContain("3200");
  });

  it("cada creencia dice cuántas citas la sostienen", () => {
    expect(plain(profileLines(PROFILE))).toMatch(/2 quotes/);
  });

  /*
    The range, which the file does write —`only in dricopilot:`— and this screen threw when
    reading it. Without it, the terminal generally showed one that only applies in a project,
    which is half of what you need to know to judge it.
   */
  it("una creencia acotada dice dónde vale, y una global no dice nada", () => {
    const acotada = {
      ...PROFILE,
      lines: [
        { topic: "cli", statement: "Solo aquí.", scope: "dricopilot" },
        { topic: "cli", statement: "En todo." },
      ],
    };
    const text = plain(profileLines(acotada));
    expect(text).toContain("dricopilot");
    expect(text.split("\n").find((l) => l.includes("En todo."))).not.toContain("solo en");
  });

  /*
    The state of everyone in the world up to the first synthesis, that is, the screen that the
    most people are going to see. A frame with '0 of 3,000' inside would be true and would not say
    the only thing that needs to be known, which are the two commands that need to be typed.
   */
  it("un retrato vacío trae el camino que lo llena, no una caja vacía", () => {
    const text = plain(profileLines({ lines: [], chars: 0, cap: 3000 }));
    expect(text).toContain("panoma twin distill");
    expect(text).toContain("panoma twin synthesize");
    expect(text).not.toContain("3000");
  });

  /*
    The vocabulary is open: the classifier can coin a subject that this CLI does not know. It is
    taught as is and behind the planted ones, because an invented label would be the only word on
    the screen that came from neither the person nor the model.
   */
  it("una materia acuñada se enseña tal cual, detrás de las que sí conoce", () => {
    const raro = {
      ...PROFILE,
      lines: [...PROFILE.lines, { topic: "accessibility", statement: "Escribes corto." }],
    };
    const text = plain(profileLines(raro));
    expect(text).toContain("accessibility");
    expect(text.indexOf("accessibility")).toBeGreaterThan(text.indexOf("Odias"));
  });
});

/**
 * The synthesis: the command that replaced the entire queue.
 *
 * What is being monitored here are the two things that this screen could do to look good. One is
 * to silence the cast: the first pass over a database from the old tail classifies hundreds
 * of sentences, and a trial that only talked about synthesis would promise something cheap behind
 * something that was not. The other is to silence the silence—a portrait that does not change is
 * the correct response to a pass over already viewed evidence, and not saying it makes the command
 * relaunch just in case.
 */
describe("escribir el retrato sin preguntar nada", () => {
  const ESTIMATE: SynthesizeReply = {
    topics: 6,
    observations: 214,
    estimatedTokens: 48_000,
    provider: "anthropic",
    model: "claude-opus-4-1",
  };

  it("el ensayo dice cuántas materias, cuánta evidencia y cuánto costaría", () => {
    const text = plain(synthEstimateLines(ESTIMATE, {}));
    expect(text).toContain("6");
    expect(text).toContain("214");
    expect(text).toContain("48000");
  });

  it("y con qué modelo se haría, antes de gastarlo", () => {
    expect(plain(synthEstimateLines(ESTIMATE, {}))).toContain("anthropic");
  });

  it("el reparto se cuenta aparte, porque es otra llamada y otro precio", () => {
    const text = plain(synthEstimateLines(ESTIMATE, { classified: 240, minted: 2 }));
    expect(text).toContain("240");
    expect(text).toContain("2");
  });

  it("sin nada que repartir, el reparto no se menciona", () => {
    expect(plain(synthEstimateLines(ESTIMATE, { classified: 0 }))).not.toContain(
      "repartida",
    );
  });

  it("lo que se movió se dice con las tres cifras", () => {
    const text = plain(synthLines({ created: 3, refined: 2, retired: 1 }));
    expect(text).toContain("3");
    expect(text).toContain("2");
    expect(text).toContain("1");
  });

  /* A stable snapshot is not a failure, and keeping quiet about it would cause the command to relaunch. */
  it("cuando no cambia nada, lo dice en vez de callarse", () => {
    const text = plain(synthLines({ created: 0, refined: 0, retired: 0, proposed: 0 }));
    expect(text).toContain("Nothing changed");
  });

  /*
    The proposals are the only thing in the entire synthesis that expects something from the
    person: the machine wanted to change something the person signed and did not do it. Merging them
    in the line above would turn them into just another number on a receipt that otherwise asks
    for nothing.
   */
  it("lo que quiere tocar de lo firmado se avisa aparte", () => {
    const con = plain(synthLines({ created: 1, proposed: 2 }));
    const sin = plain(synthLines({ created: 1, proposed: 0 }));
    expect(con).toContain("you signed");
    expect(sin).not.toContain("you signed");
  });
});

/**
 * The commentator, who is the only one allowed to deliver bad news.
 *
 * `EL-DOBLE.md` is committed to a metric and to teaching it 'on its page,' that is, also the
 * months when it goes wrong, so what is being monitored here is not the layout but the two things
 * the screen could do to look good: display a percentage that doesn't mean anything yet, and stay
 * silent about the 'doesn't go up' when it's time to say it.
 *
 * The numbers arrive already counted and already read from the catalog —the floor and the two
 * windows are tested against PGlite in `packages/db/src/score.test.ts`, which is where they live—,
 * so what is tested here is what this file decides: what is rendered, what is kept silent, and what
 * is done with a word that is not understood.
 */
describe("el marcador de cuántas veces le corriges", () => {
  const SCORE: ScoreReply = {
    beliefs: 24,
    standing: 18,
    forming: 6,
    signed: 4,
    vetoed: 3,
    shown: 34,
    corrections: 7,
    observations: 214,
    density: 8.9,
    rate: 21,
    floor: 20,
    recent: { shown: 20, corrections: 5, rate: 25 },
    previous: { shown: 0, corrections: 0, rate: null },
    reading: "noTrend",
  };

  it("los montones se dicen por separado", () => {
    const text = plain(scoreLines(SCORE));
    expect(text).toContain("24");
    expect(text).toContain("6");
    expect(text).toContain("4");
  });

  /*
    And in front of the percentage, always. The denominator of this marker is everything the
    machine has told you, and silence counts as correct: it is weaker than counting decisions one
    by one, so the raw number — '7 out of 34' — has to be visible, because that is checked by
    looking at the portrait and 21% is not.
   */
  it("las correcciones en crudo van con su denominador al lado", () => {
    const text = plain(scoreLines(SCORE));
    expect(text).toContain("7");
    expect(text).toContain("34");
  });

  /*
    The most important thing about the screen, and now in the other direction: a `null` rendered as
    '0%' would here be the **best** possible grade —'you haven't had to correct it even once'—
    said about a double about which nothing is known yet.
   */
  it("por debajo del suelo no aparece ningún porcentaje", () => {
    const pocas: ScoreReply = {
      ...SCORE,
      shown: 5,
      corrections: 1,
      rate: null,
      recent: { shown: 5, corrections: 1, rate: null },
      reading: "tooFew",
    };
    const text = plain(scoreLines(pocas));
    expect(text, "ni el signo, que es lo que se lee de un vistazo").not.toContain("%");
    expect(text, "y sí lo que falta para tenerlo").toContain("20");
  });

  /* Density: if it stays at one, the synthesis is copying instead of synthesizing. */
  it("la densidad se dice con la evidencia que hay detrás", () => {
    const text = plain(scoreLines(SCORE));
    expect(text).toContain("8.9");
    expect(text).toContain("214");
  });

  it("«no baja» se dice, y con los dos meses delante", () => {
    const peor: ScoreReply = {
      ...SCORE,
      rate: 24,
      recent: { shown: 21, corrections: 8, rate: 38 },
      previous: { shown: 24, corrections: 5, rate: 21 },
      reading: "notBetter",
    };
    const text = plain(scoreLines(peor));
    expect(text).toContain("38");
    expect(text).toContain("21");
    expect(text, "las palabras del documento, sin suavizar").toContain("you corrected");
  });

  it("bajar se dice distinto de no bajar", () => {
    const mejor: ScoreReply = {
      ...SCORE,
      recent: { shown: 21, corrections: 3, rate: 14 },
      previous: { shown: 24, corrections: 9, rate: 38 },
      reading: "better",
    };
    const peor: ScoreReply = { ...mejor, reading: "notBetter" };
    expect(plain(scoreLines(mejor))).not.toBe(plain(scoreLines(peor)));
  });

  /*
    A newer catalog may bring a fifth reading. Translating it to the one it most resembles would
    be making up the only sentence on the screen that decides what to think about the numbers;
    showing it raw, inserting a word that came out neither from you nor from the catalog.
   */
  it("una lectura que este CLI no conoce no se traduce ni se inventa", () => {
    const rara = plain(scoreLines({ ...SCORE, reading: "sideways" }));
    expect(rara, "los números se enseñan igual").toContain("24");
    expect(rara).not.toContain("sideways");
    expect(rara).not.toContain("aprendiendo");
  });

  it("un porcentaje que no ha llegado no se rellena con un cero", () => {
    // If the catalog said 'better' without sending the two numbers, the phrase would appear with
    // the written gap —`{recent}`—, which can be seen and fixed. A 0% would be read as a
    // measurement.
    const cojo: ScoreReply = { ...SCORE, reading: "better" };
    expect(plain(scoreLines(cojo))).not.toContain("0 %");
  });

  /*
    A veto does not erase: it remains as negative evidence, and that has to be said or it seems
    like it does.
   */
  it("el cementerio se explica cuando hay algo dentro", () => {
    expect(plain(scoreLines(SCORE))).toContain("negative evidence");
    expect(plain(scoreLines({ ...SCORE, vetoed: 0 }))).not.toContain("negative evidence");
  });

  /*
    The first screen of everyone. A "0 of 0 · 0%" would be true and would not say the only thing
    that needs to be known, which are the two commands that have to be typed — the same decision
    made by the empty portrait and the `distill` without verdicts.
   */
  it("sin nada dicho trae el camino que lo llena, no un marcador de ceros", () => {
    const vacío: ScoreReply = {
      ...SCORE,
      beliefs: 0,
      forming: 0,
      signed: 0,
      vetoed: 0,
      shown: 0,
      corrections: 0,
      density: null,
      rate: null,
      recent: { shown: 0, corrections: 0, rate: null },
      reading: "tooFew",
    };
    const text = plain(scoreLines(vacío));
    expect(text).toContain("panoma twin distill");
    expect(text).toContain("panoma twin synthesize");
    expect(text).not.toContain("%");
  });

  it("ninguna línea se sale del ancho de un terminal", () => {
    for (const reading of ["tooFew", "noTrend", "better", "notBetter"]) {
      const text = plain(scoreLines({ ...SCORE, reading }));
      for (const line of text.split("\n")) expect(line.length).toBeLessThan(96);
    }
  });
});

/**
 * The visual critic, tested through its screen.
 *
 * What is stated here is not that the model is correct—that a test cannot determine that—but that
 * the screen cannot lie in the three things in which it would be easiest: it cannot show a finding
 * without saying against which sentence it goes, it cannot remain silent about the judgments that
 * have been made, and it cannot depict a passing grade without saying with how many sentences it
 * passed.
 */
describe("qué está mal en esta pantalla", () => {
  const HALLAZGO = {
    what: "El botón de sesión usa otro radio que el resto de la barra.",
    where: "arriba a la derecha",
    fix: "Iguala el radio del botón de sesión al de los botones de al lado.",
    cites: ["Quieres que todas las secciones compartan la misma UI."],
  };

  const ESTIMATE: LookEstimate = {
    statements: 12,
    estimatedTokens: 900,
    imageBytes: 1,
    provider: "openai-codex",
    model: "gpt-5",
    budget: { used: 0, cap: 20, input: 0, output: 0, unmetered: 0 },
  };

  const RESPUESTA: LookReply = {
    findings: [HALLAZGO],
    dropped: 0,
    statements: 12,
    model: "openai-codex/gpt-5",
    budget: { used: 3, cap: 20, input: 0, output: 0, unmetered: 3 },
  };

  it("cada hallazgo sale con su encargo y con la frase que rompe", () => {
    const text = plain(lookLines(RESPUESTA));
    expect(text).toContain(HALLAZGO.what);
    expect(text).toContain(HALLAZGO.fix);
    expect(text).toContain(HALLAZGO.cites[0]!);
  });

  /*
    Without findings, an empty list is not rendered: what has truly been verified is stated, which
    is that nothing approved breaks. And the foot keeps coming out, because 'with how many phrases
    ahead' is exactly what is needed to read an approval.
   */
  it("una pantalla limpia dice qué se ha comprobado, y con cuánto", () => {
    const text = plain(lookLines({ ...RESPUESTA, findings: [] }));
    expect(text).toContain("Nothing you have approved");
    expect(text).toContain("12 statements");
    expect(text).not.toContain("Rompe tu retrato");
  });

  /*
    The case that is most prone to hiding something: the test comes out clean and the model had
    four opinions that could not be tied to any of your sentences. Keeping it quiet would leave a
    passing grade that seems more solid than it actually is.
   */
  it("los descartes se dicen también cuando no se rompe nada", () => {
    const text = plain(lookLines({ ...RESPUESTA, findings: [], dropped: 4 }));
    expect(text).toContain("4 judgements with nothing behind them");
    expect(text).toContain("panoma twin synthesize");
  });

  it("una respuesta ilegible no se dibuja como una pantalla limpia", () => {
    const text = plain(lookLines({ ...RESPUESTA, findings: [], unreadable: true }));
    expect(text).not.toContain("Nothing you have approved");
    expect(text).toContain("the shape it was asked for");
  });

  it("el presupuesto del día sale en el pie", () => {
    expect(plain(lookLines(RESPUESTA))).toContain("3 of 20");
  });

  /* One alone cannot read 'Breaks your portrait in 1 places'. */
  it("concuerda en singular y en plural", () => {
    expect(plain(lookLines(RESPUESTA))).toContain("in 1 place");
    expect(plain(lookLines({ ...RESPUESTA, findings: [HALLAZGO, HALLAZGO] }))).toContain(
      "in 2 places",
    );
  });

  it("ninguna línea se sale del ancho de un terminal", () => {
    const text = plain(lookLines({ ...RESPUESTA, dropped: 4, unreadable: false }));
    for (const line of text.split("\n")) expect(line.length).toBeLessThan(96);
  });
  /*
    The file size is displayed based on what the disk measured, not what the server replied: in
    the test they are the same number because we just told it, and the day they stop being the
    same, the one that matters is the file that is going to be sent.
   */
  /*
    Regression of a failure that was only seen when executing it: with whole megabytes, the
    rejection of a large capture said "it weighs 3 MB and the limit is 3 MB" — 3,522,274 bytes and
    3,500,000 were rounded the same — and a denial that contradicts itself seems like a broken
    command. What is stated is the only thing that matters: the two numbers must be able to be
    distinguished.
   */
  it("un tamaño justo por encima del tope no se redondea hasta parecer el tope", () => {
    const casi = plain(lookEstimateLines(ESTIMATE, 3_522_274));
    const tope = plain(lookEstimateLines(ESTIMATE, 3_500_000));
    expect(casi).not.toBe(tope);
  });

  it("el presupuesto enseña el tamaño medido en el disco", () => {
    const text = plain(lookEstimateLines(ESTIMATE, 512_000));
    expect(text).toContain("500 KB");
    expect(text).toContain("openai-codex/gpt-5");
  });
});

/*
  The day's expense is shown, and only when someone has posted it. With a subscription provider,
  both counters reset to zero: a '0 tokens' below three views would be read as if they were free,
  and what happens is that this record does not say that.
 */
describe("el gasto del día", () => {
  const BASE: LookReply = {
    findings: [],
    dropped: 0,
    statements: 12,
    model: "openai-codex/gpt-5",
    budget: { used: 3, cap: 20, input: 0, output: 0, unmetered: 3 },
  };

  it("no se pinta un cero cuando nadie publicó el consumo", () => {
    expect(plain(lookLines(BASE))).not.toContain("tokens de entrada");
  });

  it("se pinta cuando lo hay", () => {
    const reply = { ...BASE, budget: { ...BASE.budget, input: 4200, output: 300, unmetered: 0 } };
    expect(plain(lookLines(reply))).toContain("4200 input tokens");
  });

  /* Mixing suppliers on the same day leaves a short total; saying how many are missing fixes it. */
  it("las llamadas sin medir se nombran junto al total", () => {
    const reply = { ...BASE, budget: { ...BASE.budget, input: 4200, output: 300, unmetered: 2 } };
    expect(plain(lookLines(reply))).toContain("2 unmeasured");
  });
});

/**
 * The line that says where the screenshot came from.
 *
 * It is short and does two tasks that can be spoiled separately: placing the delivery in time —a
 * screenshot from a minute ago is from the delivery you just received, one from yesterday is
 * something else— and saying that there were more. Without the second, 'the last' is read as 'the
 * only one' and the deliveries that are not looked at disappear from the screen.
 */
describe("de dónde salió la captura", () => {
  const AHORA = "2026-08-21T12:00:00.000Z";
  const elegida = (extra: Partial<Parameters<typeof inboxLine>[0]> = {}) => ({
    path: "/p/.panoma/shots/a.png",
    at: "2026-08-21T11:58:00.000Z",
    total: 1,
    skipped: 0,
    ...extra,
  });

  it("sitúa la entrega en el tiempo", () => {
    expect(inboxLine(elegida(), AHORA)).toContain("2 min ago");
  });

  it("dice cuántas quedan sin mirar", () => {
    expect(inboxLine(elegida({ total: 4 }), AHORA)).toContain("3 more unseen");
  });

  it("con una sola no dice nada de las demás", () => {
    expect(inboxLine(elegida(), AHORA)).not.toContain("sin mirar");
  });

  /*
    Regression of a failure seen on screen: '1 file that is not images.' The subject in front
    requires the verb to agree, and calculating it would require a key per number.
   */
  it("lo que no es imagen se cuenta sin tener que concordar en número", () => {
    for (const n of [1, 3] as const) {
      const text = inboxLine(elegida({ skipped: n }), AHORA);
      expect(text).toContain(String(n));
      expect(text).not.toContain("{s}");
    }
    expect(inboxLine(elegida({ skipped: 1 }), AHORA)).not.toContain("1 fichero que");
  });
});
