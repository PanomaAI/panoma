import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import type { Reaction } from "@panoma/core";
import {
  MAX_REACTIONS,
  distinctCwds,
  identityOf,
  readBatch,
  toVerdicts,
  type ReactionInput,
} from "./verdicts";

/**
 * What is kept from a reaction, and above all what is not.
 *
 * The translation alone is tested because that is where the decisions are: the route that uses it
 * does nothing more than resolve projects and call `saveVerdicts`, and testing that would require
 * a database to not check anything new. Here fit the four cases that can truly break the catalog
 * or the account returned to the miner: the date that does not exist, the invented category, the
 * project that is not there, and the altered quotation.
 */

const CWD = "/Users/yo/Desktop/anotes/apps/web";
const IDENTITY = "git:2f1c9b0e";
/** Already resolved: the one who builds the map climbed the tree up to the root of the project. */
const CATALOG: ReadonlyMap<string, string> = new Map([[CWD, IDENTITY]]);

function reaction(extra: Partial<ReactionInput> = {}): ReactionInput {
  return {
    source: "claude-code",
    sessionId: "1f3d0a2e-0000-4000-8000-000000000001",
    at: "2026-08-20T23:14:02.511Z",
    cwd: CWD,
    delivery: "He cambiado el verde del botón por el de la marca.",
    reaction: "no, así no: déjalo como estaba",
    signals: ["rejection", "redo"],
    ...extra,
  };
}

describe("la fecha que no se puede guardar", () => {
  it("la reacción sin timestamp se cae, no se guarda con una fecha inválida", () => {
    const batch = toVerdicts([reaction({ at: "" })], CATALOG);
    expect(batch.rows).toHaveLength(0);
    expect(batch.undated).toBe(1);
    // This is not confused with failing to find the project, which was found successfully.
    expect(batch.unmatched).toBe(0);
  });

  it("y la que trae algo que no es una fecha, igual", () => {
    const batch = toVerdicts([reaction({ at: "ayer por la noche" })], CATALOG);
    expect(batch.rows).toHaveLength(0);
    expect(batch.undated).toBe(1);
  });

  it("porque una fecha inválida no se queda en una fila rara: tumba la petición entera", () => {
    /* The deterministic `id` of `saveVerdicts` comes out of `at.toISOString()`, and that throws. */
    expect(() => new Date("").toISOString()).toThrow(RangeError);
  });

  it("la que sí trae fecha guarda ese instante y no otro", () => {
    const [row] = toVerdicts([reaction()], CATALOG).rows;
    expect(row?.at.toISOString()).toBe("2026-08-20T23:14:02.511Z");
  });

  it("un lote mezclado cuenta cada mitad por su lado", () => {
    const batch = toVerdicts([reaction(), reaction({ at: "" }), reaction()], CATALOG);
    expect(batch.rows).toHaveLength(2);
    expect(batch.undated).toBe(1);
  });
});

describe("la categoría es la primera señal, o ninguna", () => {
  it("la primera de la lista, que es la más específica que saltó", () => {
    const [row] = toVerdicts([reaction()], CATALOG).rows;
    expect(row?.category).toBe("rejection");
  });

  it("y las señales enteras siguen yendo aparte, en su orden", () => {
    const [row] = toVerdicts([reaction()], CATALOG).rows;
    expect(row?.signals).toEqual(["rejection", "redo"]);
  });

  it("sin señales no se inventa una categoría de relleno", () => {
    const [row] = toVerdicts([reaction({ signals: [] })], CATALOG).rows;
    expect(row?.category).toBeNull();
    expect(row?.signals).toEqual([]);
  });

  it("la entrega vacía se guarda como null, que no es lo mismo que una cadena vacía", () => {
    const [row] = toVerdicts([reaction({ delivery: "" })], CATALOG).rows;
    expect(row?.context).toBeNull();
  });
});

describe("el cwd que no lleva a ningún proyecto", () => {
  it("una carpeta que el catálogo no conoce se cuenta y se salta", () => {
    const batch = toVerdicts([reaction({ cwd: "/Users/yo/borrado/hace/meses" })], CATALOG);
    expect(batch.rows).toHaveLength(0);
    expect(batch.unmatched).toBe(1);
  });

  it("y una sesión que no dijo dónde ocurría, también", () => {
    const batch = toVerdicts([reaction({ cwd: undefined })], CATALOG);
    expect(batch.rows).toHaveLength(0);
    expect(batch.unmatched).toBe(1);
  });

  it("un proyecto con la identidad todavía sin asignar es lo mismo: no está en el mapa", () => {
    /*
      Whoever builds the map leaves out what is solved with `identity` in null, just like
      `saveBuildCheck` does in queries.ts. Here it arrives as a missing route.
     */
    const batch = toVerdicts([reaction()], new Map());
    expect(batch.unmatched).toBe(1);
  });

  it("los proyectos se cuentan sin repetir", () => {
    const otra = "/Users/yo/Desktop/humo_check/frontend";
    const mapa = new Map([
      [CWD, IDENTITY],
      [otra, "git:aa11bb22"],
    ]);
    const batch = toVerdicts(
      [reaction(), reaction({ sessionId: "otra" }), reaction({ cwd: otra })],
      mapa,
    );
    expect(batch.rows).toHaveLength(3);
    expect(batch.projects).toBe(2);
  });

  it("y las rutas se preguntan una vez cada una, no una por reacción", () => {
    const lote = [reaction(), reaction({ sessionId: "b" }), reaction({ cwd: undefined })];
    expect(distinctCwds(lote)).toEqual([CWD]);
  });
});

describe("el tope del lote", () => {
  function cuerpo(n: number): unknown {
    return { reactions: Array.from({ length: n }, () => reaction()) };
  }

  it("quinientas entran", () => {
    const batch = readBatch(cuerpo(MAX_REACTIONS));
    expect(batch.kind).toBe("batch");
  });

  it("quinientas y una se rechazan enteras, con su cifra para poder decirla", () => {
    /*
      And without `reactions` inside: there is nothing cut out that someone could keep by mistake,
      which is what would turn the cap into a fake account.
     */
    expect(readBatch(cuerpo(MAX_REACTIONS + 1))).toEqual({
      kind: "tooMany",
      sent: MAX_REACTIONS + 1,
    });
  });

  it.each([undefined, null, "reacciones", { reactions: {} }, { otras: [] }])(
    "%p no es un lote de reacciones",
    (body) => {
      expect(readBatch(body).kind).toBe("malformed");
    },
  );

  it("una lista suelta tampoco: el cuerpo es un objeto con su clave", () => {
    expect(readBatch([reaction()]).kind).toBe("malformed");
  });

  it("una sola reacción mal formada tumba el lote, no se descarta en silencio", () => {
    expect(readBatch({ reactions: [reaction(), { source: "codex" }] }).kind).toBe("malformed");
  });

  it("pero sin cwd ni entrega es una reacción normal, no un cuerpo roto", () => {
    const suelta = { source: "codex", sessionId: "s", at: "", reaction: "así no" };
    expect(readBatch({ reactions: [suelta] })).toEqual({
      kind: "batch",
      reactions: [{ ...suelta, signals: [] }],
    });
  });
});

describe("la cita viaja tal cual, sin una segunda pasada de tapado", () => {
  /*
    It carries inside what a cap applied twice would ruin: the mark that the miner already put, a
    git SHA, and a long path. None of the three can change.
   */
  const QUOTE =
    "el «credencial oculta» del panel sigue mal en 9f1c2ab3c4d5e6f708192a3b4c5d6e7f8091a2b3, " +
    "mira /Users/yo/Desktop/anotes/packages/core/src/history/claude-code.ts";

  it("sale byte a byte como entró", () => {
    const [row] = toVerdicts([reaction({ reaction: QUOTE })], CATALOG).rows;
    expect(row?.quote).toBe(QUOTE);
    expect(Buffer.byteLength(row?.quote ?? "")).toBe(Buffer.byteLength(QUOTE));
  });

  it("y no se le añade ninguna marca nueva", () => {
    const [row] = toVerdicts([reaction({ reaction: QUOTE })], CATALOG).rows;
    expect([...(row?.quote ?? "").matchAll(/«credencial oculta»/g)]).toHaveLength(1);
  });

  it("la entrega tampoco se toca", () => {
    const [row] = toVerdicts([reaction({ delivery: QUOTE })], CATALOG).rows;
    expect(row?.context).toBe(QUOTE);
  });
});

describe("lo que devuelve el motor cabe aquí sin adaptador", () => {
  it("una Reaction de @panoma/core entra tal cual", () => {
    /*
      The truth check is done by the compiler with this typed literal: if the miner renames
      `sessionId` or `delivery`, this stops compiling instead of silently stopping saving.
     */
    const mined: Reaction = {
      source: "codex",
      sessionId: "rollout-2026-08-20",
      at: "2026-08-20T09:00:00.000Z",
      cwd: CWD,
      delivery: "Listo el filtro de la tabla.",
      reaction: "igual que la otra sección",
      chars: 25,
      brief: false,
      signals: ["reference"],
    };
    const batch = toVerdicts([mined], CATALOG);
    expect(batch.rows[0]?.source).toBe("codex");
    expect(batch.rows[0]?.category).toBe("reference");
  });
});

/**
 * Which project is a reaction from: send what was touched, and the `cwd` is the backup.
 *
 * Order is the arrangement of a measured fault. `cwd` says where the terminal was, not what was
 * being talked about: in a real transcript, it said `trad89/humo_check` in 1,095 turns while the
 * files touched were 161 under `linkaloud/` and one under `humo_check/`. The result was a sentence
 * about an audio tray, learned while working in `linkaloud`, signed as from `Travocato` — and as
 * the portrait goes down to the AGENTS.md of all projects, the wrong tag prevented judging whether
 * the sentence was worthwhile out of place.
 */
describe("de qué proyecto es una reacción", () => {
  const IDS = new Map([
    ["/w/trad89/humo_check", "git:humo"],
    ["/w/trad89/linkaloud/app/lib/audio.dart", "git:linka"],
    ["/w/trad89/linkaloud/app/lib/feed.dart", "git:linka"],
    ["/w/suelto/notas.md", "git:suelto"],
  ]);

  function reaccion(extra: Partial<ReactionInput> = {}): ReactionInput {
    return {
      source: "claude-code",
      sessionId: "ses-1",
      at: "2026-08-06T10:00:00.000Z",
      reaction: "hazlo",
      signals: [],
      ...extra,
    };
  }

  it("los ficheros tocados ganan al cwd", () => {
    const one = reaccion({
      cwd: "/w/trad89/humo_check",
      paths: ["/w/trad89/linkaloud/app/lib/audio.dart", "/w/trad89/linkaloud/app/lib/feed.dart"],
    });
    expect(identityOf(one, IDS)).toBe("git:linka");
  });

  it("sin ficheros tocados manda el cwd, como siempre", () => {
    expect(identityOf(reaccion({ cwd: "/w/trad89/humo_check" }), IDS)).toBe("git:humo");
  });

  it("sin nada que resolver no hay proyecto", () => {
    expect(identityOf(reaccion(), IDS)).toBeUndefined();
    expect(identityOf(reaccion({ paths: ["/w/desconocido/x.ts"] }), IDS)).toBeUndefined();
  });

  /*
    A route that does not lead to any catalogued project does not vote. Without this rule, a loose
    file opened casually would tie with twelve from the real project.
   */
  it("lo que no resuelve no vota", () => {
    const one = reaccion({
      cwd: "/w/trad89/humo_check",
      paths: ["/w/nada/a.ts", "/w/nada/b.ts", "/w/trad89/linkaloud/app/lib/audio.dart"],
    });
    expect(identityOf(one, IDS)).toBe("git:linka");
  });

  /*
    Tie: the cwd wins if it is among the tied. The important thing is not what it wins but that it
    is always the same — the verdict identifier is deterministic, and a dancing identity creates
    duplicate rows that no one connects.
   */
  it("en empate desempata el cwd, y el resultado no baila", () => {
    const one = reaccion({
      cwd: "/w/trad89/humo_check",
      paths: ["/w/trad89/linkaloud/app/lib/audio.dart", "/w/trad89/humo_check"],
    });
    expect(identityOf(one, IDS)).toBe("git:humo");
    expect(identityOf(one, IDS)).toBe(identityOf(one, IDS));
  });

  it("cwd y ficheros se le preguntan al catálogo en la misma lista", () => {
    const rutas = distinctCwds([
      reaccion({ cwd: "/w/trad89/humo_check", paths: ["/w/trad89/linkaloud/app/lib/audio.dart"] }),
    ]);
    expect(rutas).toContain("/w/trad89/humo_check");
    expect(rutas).toContain("/w/trad89/linkaloud/app/lib/audio.dart");
  });
});
