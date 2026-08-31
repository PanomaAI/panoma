import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureAccessKey, isLoopbackHost, readAccessKey } from "./access";

/**
 * The credential that separates 'open to the network' from 'open to the network and to anyone'.
 *
 * What these tests uphold is a rule, not a function: exposing Panoma has to require both direction
 * **and** credential. If the key could be read with group permissions, or if a IP from the LAN
 * counted as local, the rule falls without anything appearing to fail.
 */

/**
 * Check that a file can only be read by its owner, in the language of each system.
 *
 * In macOS and Linux that is a number: `mode & 0o777` has to be 0600. On Windows, permissions are
 * access control lists and `mode` always lies — it returns 0666 no matter what — so `icacls` is
 * asked and what really matters is checked: that there isn't an entry for everyone.
 */
async function soloSuDueno(path: string): Promise<void> {
  if (process.platform !== "win32") {
    const info = await stat(path);
    expect(info.mode & 0o777).toBe(0o600);
    return;
  }

  const { stdout } = await promisify(execFile)("icacls", [path]);
  expect(stdout, stdout).not.toMatch(/\b(Everyone|Todos)\b/i);
  expect(stdout, stdout).not.toMatch(/BUILTIN\\(Users|Usuarios)/i);
}

describe("la clave de acceso en red", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "panoma-acceso-"));
    process.env["PANOMA_HOME"] = home;
  });

  afterEach(async () => {
    delete process.env["PANOMA_HOME"];
    await rm(home, { recursive: true, force: true });
  });

  it("no hay ninguna hasta que se pide", async () => {
    expect(await readAccessKey()).toBeNull();
  });

  it("se crea una vez y se reutiliza", async () => {
    const first = await ensureAccessKey();
    const second = await ensureAccessKey();
    expect(second.key).toBe(first.key);
    expect(first.key).toHaveLength(64);
  });

  it("solo la puede leer su dueño", async () => {
    await ensureAccessKey();
    // Whoever reads this file enters the catalog from anywhere on the network.
    await soloSuDueno(join(home, "access.json"));
  });

  it("rotar invalida la anterior", async () => {
    const old = await ensureAccessKey();
    const fresh = await ensureAccessKey({ rotate: true });
    expect(fresh.key).not.toBe(old.key);
    const saved = JSON.parse(await readFile(join(home, "access.json"), "utf8"));
    expect(saved.key).toBe(fresh.key);
  });

  it("no deja temporales por medio", async () => {
    await ensureAccessKey();
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(home)).filter((name) => name.includes(".tmp"))).toEqual([]);
  });
});

describe("qué cuenta como esta máquina", () => {
  it("el bucle local, en sus tres escrituras y con cualquier puerto", () => {
    for (const host of ["localhost:4173", "127.0.0.1:4173", "[::1]:4173", "localhost"]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
  });

  it("una IP de la red local no es esta máquina", () => {
    // It is the case that brought all this: the phone calling from the wifi.
    for (const host of ["192.168.1.239:4173", "10.0.0.5:4173", "panoma.local:4173"]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });

  it("sin cabecera `Host` no se da por local", () => {
    // Fail closed: what cannot be verified does not happen.
    expect(isLoopbackHost(null)).toBe(false);
    expect(isLoopbackHost("")).toBe(false);
  });
});
