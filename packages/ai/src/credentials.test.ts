import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConfigCorruptError,
  configPath,
  readConfig,
  saveKey,
  updateConfig,
  writeConfig,
} from "./credentials";

/**
 * `ai.json` is the only file of Panoma that stores something that cannot be deduced again from the
 * disk. The catalog is regenerated with a scan; a lost API key must be requested from the
 * provider, and several are only shown once.
 *
 * These tests are about the two ways to lose it: writing halfway, and confusing 'there is no
 * setting' with 'I can't read it'.
 */

let home: string;
const original = process.env["PANOMA_HOME"];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-cred-"));
  process.env["PANOMA_HOME"] = home;
});

afterEach(async () => {
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

const KEYS = { anthropic: "sk-ant-uno", openai: "sk-openai-dos" };

describe("leer", () => {
  it("sin fichero, no hay configuración", () => {
    return expect(readConfig()).resolves.toEqual({});
  });

  it("lo escrito es lo leído", async () => {
    await writeConfig({ provider: "anthropic", model: "claude-opus-5", keys: KEYS });
    await expect(readConfig()).resolves.toEqual({
      provider: "anthropic",
      model: "claude-opus-5",
      keys: KEYS,
    });
  });

  /*
    The failure that triggered all of this. Returning `{}` to an unreadable file caused Panoma to
    say 'no provider configured,' the user would paste a key again, and that write would overwrite
    whatever was still inside. A read error turned into a data loss, without a single red message
    appearing.
   */
  it("un fichero corrupto no se hace pasar por «no configurado»", async () => {
    await writeFile(configPath(), '{"provider": "anthro', "utf8");
    await expect(readConfig()).rejects.toBeInstanceOf(ConfigCorruptError);
  });

  it("JSON válido que no es una configuración también es corrupto", async () => {
    // `null`, `[]` and `42` pass the `JSON.parse` and none is a configuration: without checking the
    // form, the failure appeared later, far from the file that caused it.
    for (const content of ["null", "[]", "42", '{"keys": {"anthropic": 7}}']) {
      await writeFile(configPath(), content, "utf8");
      await expect(readConfig()).rejects.toBeInstanceOf(ConfigCorruptError);
    }
  });

  it("el aviso dice dónde está la copia y cuántas claves tiene", async () => {
    await writeConfig({ keys: KEYS });
    await writeConfig({ keys: { ...KEYS, google: "sk-tres" } });
    await writeFile(configPath(), "", "utf8"); // truncated, like after a Ctrl-C

    const error = (await readConfig().catch((e: unknown) => e)) as ConfigCorruptError;
    expect(error).toBeInstanceOf(ConfigCorruptError);
    expect(error.recovery?.keys).toBe(2);
    expect(error.message).toContain("ai.json.anterior");
    expect(error.message).toContain("mv ");
  });
});


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

describe("escribir", () => {
  it("el fichero queda solo para su dueño", async () => {
    await writeConfig({ keys: KEYS });
    await soloSuDueno(configPath());
  });

  it("no deja temporales por el camino", async () => {
    await writeConfig({ keys: KEYS });
    await writeConfig({ keys: { anthropic: "otra" } });
    const leftovers = (await readdir(home)).filter((f) => f.endsWith(".tmp") || f.endsWith(".lock"));
    expect(leftovers).toEqual([]);
  });

  /*
    A SIGKILL between `open` and `rename` does not execute any `catch`: the temporary file
    remains. Killing the writer forty times, sixteen left one. The good `ai.json` remained intact
    —that no longer gets lost— but every remnant is a complete copy of the keys in a file that
    nobody remembers.
   */
  it("recoge el temporal que dejó un proceso muerto", async () => {
    const dead = `${configPath()}.999999.tmp`;
    await writeFile(dead, "a medias", "utf8");
    await writeConfig({ keys: KEYS });
    await expect(stat(dead)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("no toca el temporal de un proceso que sigue vivo", async () => {
    // Sweeping by age would delete what another terminal is writing right now.
    const alive = `${configPath()}.${process.ppid}.tmp`;
    await writeFile(alive, "in-progress", "utf8");
    await writeConfig({ keys: KEYS });
    await expect(readFile(alive, "utf8")).resolves.toBe("in-progress");
  });

  it("guarda una copia de la versión anterior", async () => {
    await writeConfig({ keys: KEYS });
    await writeConfig({ keys: { google: "sk-tres" } });
    const copy = JSON.parse(await readFile(`${configPath()}.anterior`, "utf8")) as {
      keys: Record<string, string>;
    };
    expect(copy.keys).toEqual(KEYS);
  });

  /*
    Order matters: the copy is made from what exists before writing, and **only if it can be read
    in its entirety**. Backing up a corrupt file over a good copy would be burning the only safety
    net left, right at the moment it is needed.
   */
  it("no respalda un fichero corrupto encima de una copia buena", async () => {
    await writeConfig({ keys: KEYS });
    await writeConfig({ keys: { google: "sk-tres" } }); // leave the copy with KEYS
    await writeFile(configPath(), "{roto", "utf8");

    await writeConfig({ keys: { fresh: "sk-cuatro" } });

    const copy = JSON.parse(await readFile(`${configPath()}.anterior`, "utf8")) as {
      keys: Record<string, string>;
    };
    expect(copy.keys).toEqual(KEYS);
  });
});

describe("guardar una clave", () => {
  it("conserva las que ya estaban", async () => {
    await writeConfig({ provider: "anthropic", keys: KEYS });
    await saveKey("google", "sk-tres");
    const config = await readConfig();
    expect(config.keys).toEqual({ ...KEYS, google: "sk-tres" });
    expect(config.provider).toBe("anthropic");
  });

  it("el primer proveedor guardado pasa a ser el activo", async () => {
    await saveKey("openai", "sk-uno");
    await expect(readConfig()).resolves.toMatchObject({ provider: "openai" });
  });

  /*
    The practical consequence of `readConfig` running: `panoma ai key` refuses to write to a file
    it could not read. Before, that command was exactly the gesture that erased the remaining keys
    — and it was also the one one did upon seeing 'unconfigured'.
   */
  it("se niega a escribir sobre una configuración que no ha podido leer", async () => {
    await writeFile(configPath(), '{"provider": "anth', "utf8");
    await expect(saveKey("google", "sk-tres")).rejects.toBeInstanceOf(ConfigCorruptError);
    // And the file remains as it was: nothing has been touched.
    expect(await readFile(configPath(), "utf8")).toBe('{"provider": "anth');
  });

  it("dos escrituras a la vez no pierden ninguna clave", async () => {
    // Read-modify-write without a lock: both read `{}`, both write, and the second overwrites the
    // first. With atomic `rename` the file remains intact — but with only a single key inside,
    // which is the other way to lose them.
    await Promise.all([saveKey("anthropic", "sk-uno"), saveKey("openai", "sk-dos")]);
    const config = await readConfig();
    expect(Object.keys(config.keys ?? {}).sort()).toEqual(["anthropic", "openai"]);
  });

  it("updateConfig ve siempre el estado más reciente", async () => {
    await writeConfig({ keys: { a: "1" } });
    await Promise.all([
      updateConfig((c) => ({ ...c, keys: { ...c.keys, b: "2" } })),
      updateConfig((c) => ({ ...c, keys: { ...c.keys, c: "3" } })),
    ]);
    expect(await readConfig()).toMatchObject({ keys: { a: "1", b: "2", c: "3" } });
  });
});
