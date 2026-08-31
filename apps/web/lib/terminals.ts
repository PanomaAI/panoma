import { findExecutable } from "@panoma/core";

/**
 * Open a terminal already located in the project folder, on all three systems.
 *
 * In macOS there is one and it is called Terminal. In Windows there are two, and the good one
 * —Windows Terminal— may not be there. In Linux there are fifteen and there is none that is safe:
 * you try them in order and the first one that is installed wins. That is why this is a table and
 * not a `switch`.
 *
 * Each one says in a way where to open —`--working-directory=`, `--workdir`, `-w`, `--directory`,
 * `start --cwd` — and for the two who don't know how to say it, it is taken out with the folder in
 * place, which is what the shell inside inherits. No one receives a line of text: the path always
 * goes as a separate argument, so a folder with a `;` or a `&&` in the name cannot execute
 * anything.
 */

export interface Terminal {
  command: string;
  args: (path: string) => string[];
  /**
   * If it has to be started with the folder set instead of telling it by argument.
   *
   * `xterm` and the Debian generic have no option for this, and the shell inside starts where the
   * process started. It is the same solution without writing a command.
   */
  useCwd?: boolean;
  /**
   * How do you ask this terminal to run a script, in addition to opening in the folder.
   *
   * Each one has their option —`--`, `-e`, or nothing— and some want it last. What is always
   * passed to it is **a single argument**: the path of a script that Panoma has written. That is
   * what allows even `terminator`, whose `-e` takes a string and not a list, not to need to
   * compose a line of text that nobody can twist.
   */
  withScript: (path: string, script: string) => string[];
}

/*
  The order is that of finding it installed, not that of personal preference: first those that
  come standard on large desktops —GNOME, KDE, Xfce—, then those installed by the one who chooses
  them, and finally the two that are everywhere.
  `ptyxis` comes before `gnome-terminal` because it is the one that GNOME brings from Fedora 40,
  and on those machines `gnome-terminal` may exist as a compatibility wrapper.
 */
const LINUX: Terminal[] = [
  {
    command: "ptyxis",
    args: (path) => [`--working-directory=${path}`],
    withScript: (path, script) => [`--working-directory=${path}`, "--", script],
  },
  {
    command: "gnome-terminal",
    args: (path) => [`--working-directory=${path}`],
    withScript: (path, script) => [`--working-directory=${path}`, "--", script],
  },
  {
    command: "konsole",
    args: (path) => ["--workdir", path],
    withScript: (path, script) => ["--workdir", path, "-e", script],
  },
  {
    command: "xfce4-terminal",
    args: (path) => [`--working-directory=${path}`],
    withScript: (path, script) => [`--working-directory=${path}`, "-e", script],
  },
  {
    command: "tilix",
    args: (path) => ["-w", path],
    withScript: (path, script) => ["-w", path, "-e", script],
  },
  {
    command: "terminator",
    args: (path) => [`--working-directory=${path}`],
    withScript: (path, script) => [`--working-directory=${path}`, "-e", script],
  },
  {
    command: "alacritty",
    args: (path) => ["--working-directory", path],
    withScript: (path, script) => ["--working-directory", path, "-e", script],
  },
  {
    command: "kitty",
    args: (path) => ["--directory", path],
    withScript: (path, script) => ["--directory", path, script],
  },
  {
    command: "wezterm",
    args: (path) => ["start", "--cwd", path],
    withScript: (path, script) => ["start", "--cwd", path, "--", script],
  },
  {
    command: "foot",
    args: (path) => [`--working-directory=${path}`],
    withScript: (path, script) => [`--working-directory=${path}`, script],
  },
  { command: "x-terminal-emulator", args: () => [], useCwd: true, withScript: (_p, s) => ["-e", s] },
  { command: "xterm", args: () => [], useCwd: true, withScript: (_p, s) => ["-e", s] },
];

/*
  Windows Terminal first because it is the one that comes with Windows 11 and the one people
  recognize. If it is not there, `conhost` is the usual one and is in all installations: you are
  asked to start a `cmd` with the folder set, without going through `start`, which is an internal
  command of `cmd` and would require composing a line of text that someone could misinterpret.
 */
/*
  `-ExecutionPolicy Bypass` because Windows blocks scripts by default, and without that the agent
  would never start. It is valid only for that process, it does not touch the machine policy, and
  the script was just written by Panoma in the personal folder of the person who presses the
  button.
 */
const POWERSHELL = (script: string): string[] => [
  "powershell",
  "-NoExit",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  script,
];

const WINDOWS: Terminal[] = [
  {
    command: "wt",
    args: (path) => ["-d", path],
    withScript: (path, script) => ["-d", path, ...POWERSHELL(script)],
  },
  {
    command: "conhost",
    args: () => ["cmd.exe"],
    useCwd: true,
    withScript: (_path, script) => POWERSHELL(script),
  },
];

export interface PickOptions {
  platform?: NodeJS.Platform;
  /** If a program is installed. Injectable to test the three systems from one. */
  installed?: (command: string) => boolean;
}

/** The first terminal installed, or `undefined` if there isn't one that we know how to open. */
export function pickTerminal(options: PickOptions = {}): Terminal | undefined {
  const platform = options.platform ?? process.platform;
  const installed = options.installed ?? ((command) => findExecutable(command) !== undefined);

  if (platform === "darwin") {
    // `open -a Terminal <ruta>` requests it from the system, so there is nothing to look for.
    // `open <guion.command>` gives it to Terminal.app, which executes it and leaves the window.
    return {
      command: "open",
      args: (path) => ["-a", "Terminal", path],
      withScript: (_path, script) => [script],
    };
  }

  const candidates = platform === "linux" ? LINUX : platform === "win32" ? WINDOWS : [];
  return candidates.find((terminal) => installed(terminal.command));
}
