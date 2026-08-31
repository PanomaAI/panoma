import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SHOTS_DIR } from "@panoma/core";
import { pickShot, shotDigest } from "./shots";
import { autoLookCap, budgetFrom } from "./look";
import { digestOf } from "./look-run";

/**
 * Choose from the mailbox, and recognize a capture by what is inside.
 *
 * The two halves that support the automatic critic. The first is for safety: the name that arrives
 * in the body never turns into a path, it is looked up in a list, and that is why a `../..` finds
 * nothing instead of finding something. The second is for convergence: the digest is what prevents
 * the watcher from paying for the same image tomorrow, and it has to give the same result for both
 * paths through which a capture arrives —from the disk and in base64—.
 */

let carpeta: string;

/** A minimal PNG: the eight bytes of the signature are enough for `readShots` to count it. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const OTRO = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);

beforeAll(async () => {
  carpeta = await mkdtemp(join(tmpdir(), "panoma-buzon-"));
  await mkdir(join(carpeta, SHOTS_DIR), { recursive: true });
  await writeFile(join(carpeta, SHOTS_DIR, "home.png"), PNG);
  await writeFile(join(carpeta, SHOTS_DIR, "notas.txt"), "esto no es una imagen");
  // And something appetizing outside the mailbox, which is what a malicious name would want to
  // reach.
  await writeFile(join(carpeta, "secreto.png"), OTRO);
});

afterAll(async () => {
  await rm(carpeta, { recursive: true, force: true });
});

describe("elegir una captura del buzón", () => {
  it("por su nombre, con la ruta que puso el listado", async () => {
    const shot = await pickShot(carpeta, "home.png");
    expect(shot?.path).toBe(join(carpeta, SHOTS_DIR, "home.png"));
  });

  it("lo que no está en el listado no existe", async () => {
    expect(await pickShot(carpeta, "otra.png")).toBeUndefined();
  });

  /*
    The proof that the name never becomes a path: if it were composed, this would open a file
    outside the mailbox. Since it is searched for in a list, it does not match anything.
   */
  it("y una ruta disfrazada de nombre tampoco", async () => {
    expect(await pickShot(carpeta, "../secreto.png")).toBeUndefined();
    expect(await pickShot(carpeta, "../../etc/passwd")).toBeUndefined();
    expect(await pickShot(carpeta, join("..", "secreto.png"))).toBeUndefined();
  });

  /* What is not an image is not on the list, so it also cannot be chosen. */
  it("ni un fichero del buzón que no sea una imagen", async () => {
    expect(await pickShot(carpeta, "notas.txt")).toBeUndefined();
  });

  it("un proyecto sin buzón no tiene de dónde elegir", async () => {
    expect(await pickShot(join(carpeta, "no-existe"), "home.png")).toBeUndefined();
  });
});

describe("reconocer una captura por lo que hay dentro", () => {
  /*
    The two paths have to match. If not, the capture uploaded by one person and the one read by
    the watcher from the same file would be two different images for the memory, and the automatic
    shot would pay again for what has already been seen.
   */
  it("el digesto del fichero es el mismo que el de sus bytes en base64", async () => {
    const delDisco = await shotDigest(join(carpeta, SHOTS_DIR, "home.png"));
    expect(delDisco).toBe(digestOf(PNG.toString("base64")));
  });

  it("dos imágenes distintas no se confunden", async () => {
    expect(digestOf(PNG.toString("base64"))).not.toBe(digestOf(OTRO.toString("base64")));
  });

  it("un fichero que ya no está no tiene digesto", async () => {
    expect(await shotDigest(join(carpeta, SHOTS_DIR, "fantasma.png"))).toBeUndefined();
  });
});

/*
  The allocation of the budget. The automatic one spends from a smaller drawer so that a looping
  agent does not leave without looks the person sitting in front.
 */
describe("cuánto puede gastar el vigía por su cuenta", () => {
  it("la mitad de lo del día", () => {
    expect(autoLookCap(20)).toBe(10);
  });

  /* With a cap of one, the automatic stays at zero: that look belongs to the person. */
  it("con un tope de una mirada, ninguna es automática", () => {
    expect(autoLookCap(1)).toBe(0);
  });

  it("y apagar el crítico apaga también el disparo", () => {
    expect(autoLookCap(budgetFrom("0"))).toBe(0);
  });
});
