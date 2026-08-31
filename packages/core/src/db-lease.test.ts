import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  clearLease,
  leaseDir,
  leaseIntruder,
  leasePath,
  pidAlive,
  readLeases,
  writeLease,
} from "./db-lease";

/**
 * The third network against the two writers, and the only one that exists in Windows.
 *
 * The `panoma up` seal only knows its own and `lsof` does not exist in all systems: on Aug 25,
 * 2026 a catalog torn by another agent was good without a stamp, and on Windows not even the
 * `lsof` probe would have seen it. And the first version of this network —a single-place file—
 * fell under revision with a specific sequence: B steps on A's note, B closes and withdraws it,
 * and A continues to write invisible. Here we prove what makes the network a network: no one steps
 * on anyone, everyone removes only their own, and only betrays a LIVING person who is not me.
 */

let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-lease-"));
  process.env["PANOMA_HOME"] = home;
});

afterAll(async () => {
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

afterEach(async () => {
  await rm(leaseDir(), { recursive: true, force: true });
});

/** Another note, planted by hand as another process would leave it. */
async function plantada(pid: number, command = "vecino"): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(leaseDir(), { recursive: true });
  await writeFile(leasePath(pid), JSON.stringify({ pid, command, startedAt: "" }), "utf8");
}

/** A truly living process that is not us, for the tests that need it. */
function vecinoVivo(): ChildProcess {
  return spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "ignore" });
}

describe("la nota va y viene", () => {
  it("anota a este proceso y se lee entera", async () => {
    await writeLease();
    const [lease] = readLeases();
    expect(lease?.pid).toBe(process.pid);
    expect(lease?.command, "el guardián necesita poder nombrar al proceso").toBeTruthy();
  });

  it("vive junto al directorio de datos, nunca dentro: db/ es de PostgreSQL", () => {
    expect(leaseDir()).toBe(join(home, "db.lease.d"));
    expect(leasePath(123)).toBe(join(home, "db.lease.d", "123.json"));
  });

  it("una nota ilegible no existe, y una escritura en vuelo tampoco", async () => {
    await plantada(4321);
    await writeFile(leasePath(4321), "esto no es JSON", "utf8");
    await writeFile(`${leasePath(8765)}.tmp`, '{"pid": 8765}', "utf8");
    expect(readLeases()).toEqual([]);
  });
});

describe("nadie pisa a nadie", () => {
  it("anotar no toca la nota de otro VIVO: era el agujero de la plaza única", async () => {
    const vecino = vecinoVivo();
    try {
      await plantada(vecino.pid!, "servidor-de-antes");
      await writeLease();

      const pids = readLeases().map((lease) => lease.pid).sort((a, b) => a - b);
      expect(pids).toContain(vecino.pid);
      expect(pids).toContain(process.pid);
    } finally {
      vecino.kill();
    }
  });

  it("retirar es por nombre y solo lo propio: B cierra y A sigue delatado", async () => {
    const vecino = vecinoVivo();
    try {
      await plantada(vecino.pid!, "servidor-de-antes");
      await writeLease();
      await clearLease();

      const restantes = readLeases();
      expect(restantes.map((lease) => lease.pid)).toEqual([vecino.pid]);
      expect(
        leaseIntruder(restantes, 999, pidAlive)?.pid,
        "el que sobrevive sigue a la vista del guardián",
      ).toBe(vecino.pid);
    } finally {
      vecino.kill();
    }
  });

  it("anotar barre a los muertos, restos ilegibles incluidos", async () => {
    const muerto = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    await plantada(muerto.pid!);
    await writeFile(`${leasePath(muerto.pid!)}.tmp`, "a medias", "utf8");

    await writeLease();
    const nombres = await readdir(leaseDir());
    expect(nombres).toEqual([`${process.pid}.json`]);
  });
});

describe("a quién delata", () => {
  const lease = (pid: number) => ({ pid, startedAt: "" });

  it("solo a otro proceso vivo: ni a mí, ni a un muerto, ni a nadie sin nota", () => {
    expect(leaseIntruder([lease(4321)], 999, () => true)?.pid).toBe(4321);
    expect(leaseIntruder([lease(999)], 999, () => true)).toBeUndefined();
    expect(leaseIntruder([lease(4321)], 999, () => false)).toBeUndefined();
    expect(leaseIntruder([], 999, () => true)).toBeUndefined();
    expect(leaseIntruder([lease(-1), lease(0)], 999, () => true)).toBeUndefined();
  });

  it("con varios vivos señala siempre al mismo: el de pid más bajo", () => {
    expect(leaseIntruder([lease(50), lease(20), lease(999)], 999, () => true)?.pid).toBe(20);
  });

  it("pidAlive distingue a un vivo de un muerto de verdad, en este sistema", () => {
    expect(pidAlive(process.pid)).toBe(true);
    // A child process that has already exited is the most reliably dead process: its PID has just
    // been freed.
    const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    expect(child.pid, "el hijo tuvo que nacer para poder morir").toBeGreaterThan(0);
    expect(pidAlive(child.pid!)).toBe(false);
  });
});

describe("y el conjunto, como lo usará el guardián", () => {
  it("nota de este proceso + pregunta de otro = negativa con nombre", async () => {
    await writeLease();
    const intruder = leaseIntruder(readLeases(), 999, pidAlive);
    expect(intruder?.pid).toBe(process.pid);
    expect(intruder?.command).toBeTruthy();
  });

  it("retirar lo que no está no es un error", async () => {
    await expect(clearLease()).resolves.toBeUndefined();
  });
});
