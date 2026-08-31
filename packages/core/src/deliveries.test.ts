import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SHOTS_DIR, openShots, readShots, shotsPath } from "./deliveries";

/**
 * The mailbox is tested against a real disc and not against a duplicate.
 *
 * All this module does are four calls to the file system —list, check the date, read twelve bytes,
 * write a `.gitignore` — so a double would test the double. What really matters to check is what
 * isn't seen when reading the code: that a file that isn't an image doesn't sneak in as 'the
 * latest capture,' that the most recent one is truly the most recent, and that the `.gitignore` is
 * never overwritten.
 */

let carpeta: string;

beforeEach(async () => {
  carpeta = await mkdtemp(join(tmpdir(), "panoma-buzon-"));
});

afterEach(async () => {
  await rm(carpeta, { recursive: true, force: true });
});

/** A PNG with the correct signature. There is no need to decode it: no one decodes it. */
function png(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 0),
  ]);
}

async function dejar(name: string, bytes: Buffer, when?: Date): Promise<string> {
  const path = join(shotsPath(carpeta), name);
  await mkdir(shotsPath(carpeta), { recursive: true });
  await writeFile(path, bytes);
  if (when) await utimes(path, when, when);
  return path;
}

describe("el buzón que todavía no existe", () => {
  /*
    "'Not there' and 'it's empty' are different things: without a folder, the channel needs to be
    set up; empty means that no agent has left anything. Confusing them leads to fixing what isn't
    broken."
   */
  it("se distingue de uno vacío", async () => {
    expect((await readShots(carpeta)).exists).toBe(false);

    await mkdir(shotsPath(carpeta), { recursive: true });
    const vacio = await readShots(carpeta);
    expect(vacio.exists).toBe(true);
    expect(vacio.shots).toHaveLength(0);
  });

  it("no lanza ni crea nada al leerlo", async () => {
    await readShots(carpeta);
    expect((await readShots(carpeta)).exists).toBe(false);
  });
});

describe("qué cuenta como captura", () => {
  it("lo decide la firma y no la extensión", async () => {
    await dejar("buena.png", png());
    await dejar("mentira.png", Buffer.from("%PDF-1.7\n1 0 obj", "latin1"));

    const buzon = await readShots(carpeta);
    expect(buzon.shots.map((one) => one.name)).toEqual(["buena.png"]);
    expect(buzon.skipped).toBe(1);
  });

  /*
    An agent who leaves a note next to the capture will continue leaving it. Counting it is the
    only way for anyone who looks at the mailbox to know that there is something there that Panoma
    does not see.
   */
  it("lo que no es imagen se cuenta, no se esconde", async () => {
    await dejar("captura.png", png());
    await dejar("notas.md", Buffer.from("lo que hice hoy"));
    await dejar("salida.log", Buffer.from("..."));

    expect((await readShots(carpeta)).skipped).toBe(2);
  });

  it("los ocultos no son entregas: ni el .gitignore de la propia carpeta", async () => {
    await openShots(carpeta);
    await dejar("captura.png", png());

    const buzon = await readShots(carpeta);
    expect(buzon.shots).toHaveLength(1);
    expect(buzon.skipped).toBe(0);
  });
});

describe("cuál es la última", () => {
  it("la más reciente va primera", async () => {
    await dejar("vieja.png", png(), new Date("2026-08-01T10:00:00Z"));
    await dejar("nueva.png", png(), new Date("2026-08-21T10:00:00Z"));
    await dejar("media.png", png(), new Date("2026-08-10T10:00:00Z"));

    const buzon = await readShots(carpeta);
    expect(buzon.shots.map((one) => one.name)).toEqual(["nueva.png", "media.png", "vieja.png"]);
  });

  /*
    Three captures saved at the same moment —the resolution of the file system is what it is—
    would leave 'the last one' to chance without a second criterion, and different in each
    execution. With the name, two readings of the same mailbox choose the same one.
   */
  it("con la misma fecha manda el nombre, y no el azar", async () => {
    const mismo = new Date("2026-08-21T10:00:00Z");
    await dejar("a.png", png(), mismo);
    await dejar("b.png", png(), mismo);
    await dejar("c.png", png(), mismo);

    const una = await readShots(carpeta);
    const otra = await readShots(carpeta);
    expect(una.shots[0]!.name).toBe("c.png");
    expect(otra.shots.map((s) => s.name)).toEqual(una.shots.map((s) => s.name));
  });

  it("el tope recorta por el final, dejando las recientes", async () => {
    await dejar("vieja.png", png(), new Date("2026-08-01T10:00:00Z"));
    await dejar("nueva.png", png(), new Date("2026-08-21T10:00:00Z"));

    const buzon = await readShots(carpeta, { limit: 1 });
    expect(buzon.shots.map((one) => one.name)).toEqual(["nueva.png"]);
  });
});

describe("montar el canal", () => {
  it("crea la carpeta acordada y la deja ignorada por git", async () => {
    const { dir, created } = await openShots(carpeta);
    expect(created).toBe(true);
    expect(dir).toBe(join(carpeta, SHOTS_DIR));

    const ignore = await readFile(join(dir, ".gitignore"), "utf8");
    expect(ignore).toContain("*");
  });

  /*
    The usual `!.gitignore` would be wrong: it would leave a file untracked within the repository
    and `git status` would show `.panoma/` as a novelty forever. A local working branch that
    dirties someone's repository state ends up deleted.
   */
  it("el propio .gitignore también se ignora, para no ensuciar el estado del repositorio", async () => {
    const { dir } = await openShots(carpeta);
    expect(await readFile(join(dir, ".gitignore"), "utf8")).not.toContain("!.gitignore");
  });

  /*
    What this test protects is a privacy failure and not a convenience issue: if the `.gitignore`
    is lost in a subsequent `init`, the captures from a developing application —with whatever was
    on the screen— enter the repository and no longer come out.
   */
  it("no pisa un .gitignore que alguien editó a mano", async () => {
    await openShots(carpeta);
    const ignore = join(shotsPath(carpeta), ".gitignore");
    await writeFile(ignore, "solo-lo-mio\n");

    const segunda = await openShots(carpeta);
    expect(segunda.created).toBe(false);
    expect(await readFile(ignore, "utf8")).toBe("solo-lo-mio\n");
  });

  it("montarlo dos veces no cambia nada", async () => {
    await openShots(carpeta);
    const antes = await readFile(join(shotsPath(carpeta), ".gitignore"), "utf8");
    await openShots(carpeta);
    expect(await readFile(join(shotsPath(carpeta), ".gitignore"), "utf8")).toBe(antes);
  });
});
