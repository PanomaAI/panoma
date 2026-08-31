import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import * as t from "./schema";
import { autoLooksToday, listLooks, lookedAt, saveLook, type NewLook } from "./queries";

/**
 * The memory of the critic.
 *
 * It is tested what the automatic shot needs in order not to be a loop: that an already viewed
 * capture is recognized **for what is inside it** and within its project, that a glance that was
 * not understood leaves a row the same —otherwise, it would repeat every morning— and that the
 * automatic is counted separately from what a person asks for, which is where its reserve comes
 * from.
 */

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-miradas-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});

afterAll(async () => {
  await close?.();
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.delete(t.looks);
});

function look(patch: Partial<NewLook> = {}): NewLook {
  return {
    identity: "git:uno",
    digest: "aaa",
    bytes: 1000,
    fired: "hand",
    provider: "anthropic",
    model: "modelo-de-prueba",
    statements: 12,
    dropped: 0,
    unreadable: false,
    findings: [{ what: "Rompe el espaciado", where: "La cabecera", fix: "Quita el degradado", cites: ["Nada de degradados"] }],
    ...patch,
  };
}

describe("lo que el crítico recuerda", () => {
  it("guarda los hallazgos y los devuelve enteros", async () => {
    await saveLook(db, look());
    const [row] = await listLooks(db);

    expect(row?.findings).toHaveLength(1);
    expect(row?.findings[0]?.fix).toBe("Quita el degradado");
    expect(row?.findings[0]?.cites).toEqual(["Nada de degradados"]);
  });

  /* A capture is what is inside: the agent overwrites `home.png` on each pass. */
  it("reconoce una captura por su contenido y no por su nombre", async () => {
    await saveLook(db, look({ digest: "aaa", shot: "home.png" }));

    expect(await lookedAt(db, "git:uno", "aaa")).toBe(true);
    expect(await lookedAt(db, "git:uno", "bbb")).toBe(false);
  });

  /* The same image from another project is judged by another standard: it is another question. */
  it("y dentro de su proyecto", async () => {
    await saveLook(db, look({ identity: "git:uno", digest: "aaa" }));
    expect(await lookedAt(db, "git:dos", "aaa")).toBe(false);
  });

  /*
    The one that was not understood also leaves a line. Without this, the watcher looks at it
    again tomorrow, and the day after: a call that turns strange stays strange forever, so it
    would be a loop that pays.
   */
  it("una mirada que no se entendió cuenta como mirada", async () => {
    await saveLook(db, look({ unreadable: true, findings: [] }));
    expect(await lookedAt(db, "git:uno", "aaa")).toBe(true);
  });

  it("la más reciente primero, y se puede acotar a un proyecto", async () => {
    await saveLook(db, look({ identity: "git:uno", digest: "a" }));
    await saveLook(db, look({ identity: "git:dos", digest: "b" }));

    expect(await listLooks(db)).toHaveLength(2);
    const solo = await listLooks(db, { identity: "git:dos" });
    expect(solo.map((one) => one.digest)).toEqual(["b"]);
  });

  /* The reservation of the automatic is measured here, not in the expense book. See `autoLooksToday`. */
  it("lo que disparó el vigía se cuenta aparte", async () => {
    await saveLook(db, look({ digest: "a", fired: "watch" }));
    await saveLook(db, look({ digest: "b", fired: "watch" }));
    await saveLook(db, look({ digest: "c", fired: "hand" }));

    expect(await autoLooksToday(db)).toBe(2);
  });

  it("y las de ayer no gastan la reserva de hoy", async () => {
    await saveLook(db, look({ digest: "a", fired: "watch" }));
    await db.update(t.looks).set({ at: new Date(2020, 0, 1) });

    expect(await autoLooksToday(db)).toBe(0);
  });
});
