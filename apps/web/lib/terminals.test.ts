import { describe, expect, it } from "vitest";
import { pickTerminal } from "./terminals";

/**
 * Opening a terminal is one of the few things that does not resemble anything between systems.
 *
 * On macOS there is one. On Windows there are two, and the good one may not be there. On Linux
 * there are fifteen, each with its own way of saying where to open, and none are guaranteed. What
 * is fixed here is which one is called and with what exact arguments — which is where the fault
 * lives: an option that terminal does not have opens a window in the wrong folder, or does not
 * open it.
 */

/** A disk where only what it is told is installed. */
const conInstalados = (...programas: string[]) => ({
  installed: (command: string) => programas.includes(command),
});

const RUTA = "/home/jesus/mis proyectos/panoma";

describe("macOS", () => {
  it("se lo pide al sistema, sin buscar nada", () => {
    const terminal = pickTerminal({ platform: "darwin" })!;
    expect(terminal.command).toBe("open");
    expect(terminal.args(RUTA)).toEqual(["-a", "Terminal", RUTA]);
  });
});

describe("Linux", () => {
  it("elige el primero instalado, no el primero de la lista", () => {
    const terminal = pickTerminal({ platform: "linux", ...conInstalados("kitty", "xterm") })!;
    expect(terminal.command).toBe("kitty");
    expect(terminal.args(RUTA)).toEqual(["--directory", RUTA]);
  });

  it("cada uno con la opción que ese terminal entiende", () => {
    // A borrowed option from someone else does not fail when starting: it opens the window in
    // another place, or swallows the path as if it were a command.
    const casos: [string, string[]][] = [
      ["gnome-terminal", [`--working-directory=${RUTA}`]],
      ["konsole", ["--workdir", RUTA]],
      ["tilix", ["-w", RUTA]],
      ["alacritty", ["--working-directory", RUTA]],
      ["wezterm", ["start", "--cwd", RUTA]],
    ];
    for (const [command, args] of casos) {
      const terminal = pickTerminal({ platform: "linux", ...conInstalados(command) })!;
      expect(terminal.command, command).toBe(command);
      expect(terminal.args(RUTA), command).toEqual(args);
    }
  });

  it("a los que no saben decir dónde, se les arranca con la carpeta puesta", () => {
    const terminal = pickTerminal({ platform: "linux", ...conInstalados("xterm") })!;
    expect(terminal.args(RUTA)).toEqual([]);
    expect(terminal.useCwd).toBe(true);
  });

  it("sin ninguno instalado no se inventa uno", () => {
    // Returning something that isn't there causes the button to fail when pressed instead of not
    // being there.
    expect(pickTerminal({ platform: "linux", ...conInstalados() })).toBeUndefined();
  });
});

describe("Windows", () => {
  it("Windows Terminal cuando está", () => {
    const terminal = pickTerminal({ platform: "win32", ...conInstalados("wt", "conhost") })!;
    expect(terminal.command).toBe("wt");
    expect(terminal.args(RUTA)).toEqual(["-d", RUTA]);
  });

  it("y el de siempre cuando no", () => {
    const terminal = pickTerminal({ platform: "win32", ...conInstalados("conhost") })!;
    expect(terminal.command).toBe("conhost");
    expect(terminal.useCwd).toBe(true);
  });
});

describe("la ruta nunca se mete en una línea de texto", () => {
  it("va siempre como un argumento suelto", () => {
    /*
      A folder can be called «project && rm -rf ~» —nothing prevents it— and its name comes from
      the disk, not from a form. As long as the path is an argument and not part of a string that
      a shell interprets, that name is just an ugly name.
     */
    const raro = "/home/jesus/proyecto && rm -rf ~";
    for (const [platform, programas] of [
      ["darwin", []],
      ["linux", ["gnome-terminal"]],
      ["linux", ["kitty"]],
      ["win32", ["wt"]],
    ] as [NodeJS.Platform, string[]][]) {
      const terminal = pickTerminal({ platform, ...conInstalados(...programas) })!;
      const args = terminal.args(raro);
      if (terminal.useCwd) continue;
      expect(args, `${platform}/${terminal.command}`).toContain(
        args.find((arg) => arg.endsWith(raro)),
      );
      // No argument mixes the route with anything other than its own choice.
      for (const arg of args) {
        if (!arg.includes(raro)) continue;
        expect(arg === raro || arg.endsWith(`=${raro}`), arg).toBe(true);
      }
    }
  });
});
