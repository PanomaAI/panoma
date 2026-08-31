import { describe, expect, it } from "vitest";
import { resolveExecutable } from "./exec";

/**
 * The Windows branch is tested from anywhere.
 *
 * `platform` and `exists` are injected on purpose: if this could only be checked on Windows, it
 * would be checked once every several weeks and at the worst possible moment. Here it is set what
 * has to happen — which file ends up being launched and with what arguments — and it runs on every
 * `pnpm test`, no matter who is in front.
 */

const WINDOWS = {
  platform: "win32" as NodeJS.Platform,
  env: {
    PATH: "C:\\bin;C:\\otros",
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
  } as NodeJS.ProcessEnv,
};

/**
 * A fake disk: it only exists what is told to it, and without distinguishing uppercase letters.
 *
 * The second thing is not a shortcut. `PATHEXT` comes in uppercase —`.COM;.EXE;.BAT;.CMD`— and the
 * files on the disk are in lowercase, and in Windows that doesn't matter because its file system
 * does not distinguish them. An emulator that did distinguish them would accept a code that works
 * there, or vice versa: what would be tested would not be Windows.
 */
const disco = (...files: string[]) => {
  const set = new Set(files.map((file) => file.toLowerCase()));
  return (path: string) => set.has(path.toLowerCase());
};

describe("fuera de Windows no se toca nada", () => {
  it("el comando y sus argumentos pasan tal cual", () => {
    for (const platform of ["darwin", "linux"] as NodeJS.Platform[]) {
      expect(resolveExecutable("npm", ["test"], { platform })).toEqual({
        file: "npm",
        args: ["test"],
      });
    }
  });
});

describe("en Windows", () => {
  it("encuentra el .cmd que hay detrás de un nombre sin extensión", () => {
    const launch = resolveExecutable("npm", ["run", "test"], {
      ...WINDOWS,
      exists: disco("C:\\bin\\npm.cmd"),
    });

    // A `.cmd` is not a program: it is read by `cmd.exe`, with the file already resolved and the
    // arguments separately. A line of text that someone could twist is never composed.
    expect(launch.file).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(launch.args).toEqual(["/d", "/s", "/c", "C:\\bin\\npm.cmd", "run", "test"]);
  });

  it("un .exe se lanza directo, sin cmd.exe de por medio", () => {
    const launch = resolveExecutable("git", ["status"], {
      ...WINDOWS,
      exists: disco("C:\\otros\\git.exe"),
    });

    expect(launch).toEqual({ file: "C:\\otros\\git.exe", args: ["status"] });
  });

  it("respeta el orden del PATH", () => {
    const launch = resolveExecutable("pnpm", [], {
      ...WINDOWS,
      exists: disco("C:\\bin\\pnpm.cmd", "C:\\otros\\pnpm.cmd"),
    });

    expect(launch.args).toContain("C:\\bin\\pnpm.cmd");
  });

  it("quien escribe la extensión pide esa y no otra", () => {
    const launch = resolveExecutable("node.exe", [], {
      ...WINDOWS,
      exists: disco("C:\\bin\\node.exe", "C:\\bin\\node.exe.cmd"),
    });

    expect(launch).toEqual({ file: "C:\\bin\\node.exe", args: [] });
  });

  it("una ruta con carpetas dentro se mira donde dice, no en el PATH", () => {
    const launch = resolveExecutable("C:\\apps\\ChatGPT\\codex", [], {
      ...WINDOWS,
      exists: disco("C:\\apps\\ChatGPT\\codex.exe", "C:\\bin\\codex.exe"),
    });

    expect(launch.file).toBe("C:\\apps\\ChatGPT\\codex.exe");
  });

  it("un fichero sin extensión no es un ejecutable, aunque exista", () => {
    /*
      The real case, and not an invented one: Node installs on Windows a `npm` without an
      extension —the shell script, for Git Bash— right next to `npm.cmd`. Keeping the first one
      caused `spawn` to fail, pointing to a file that exists, which is the worst possible error.
     */
    const launch = resolveExecutable("npm", ["test"], {
      ...WINDOWS,
      exists: disco("C:\\bin\\npm", "C:\\bin\\npm.cmd"),
    });

    expect(launch.args).toContain("C:\\bin\\npm.cmd");
    expect(launch.args).not.toContain("C:\\bin\\npm");
  });

  it("lo que no está se devuelve tal cual, para que falle spawn y no nosotros", () => {
    // The spawn ENOENT names the command that the user typed. Any path we composed here would name
    // something else and send it to the wrong place.
    const launch = resolveExecutable("no-existe", ["x"], { ...WINDOWS, exists: disco() });

    expect(launch).toEqual({ file: "no-existe", args: ["x"] });
  });
});
