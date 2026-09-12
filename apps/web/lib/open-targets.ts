import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { promisify } from "node:util";
import { detectCliAgents, providersByAuth, type AgentAvailability } from "@panoma/ai";
import { findExecutable, panomaPath, resolveExecutable } from "@panoma/core";
import { t, type Locale } from "@/lib/i18n";
import { composeCommandScript, composeScript } from "@/lib/launcher";
import { DESKTOP_LABELS, EDITOR_LABELS } from "@/lib/open-all";
import { openableUrl, urlOpener } from "@/lib/open-url";
import { pickTerminal, type Terminal } from "@/lib/terminals";
import { spawnDetached } from "@/lib/spawn-detached";

const run = promisify(execFile);

/**
 * Everything that can open a project on this machine, in one place.
 *
 * It lived inside `app/api/open/route.ts` while that route was the only one opening things. The
 * day "open everything" arrived —one click, six launches— the alternative was copying the closed
 * lists and the launchers into a second route, and the second copy of a security decision is the
 * one that forgets a check. A route file cannot export helpers either: Next only admits the
 * handlers and its config from it. So the lists, the detection and the launchers live here, and
 * the two routes are thin.
 *
 * The rules did not move with the code; they are the same three the original route wrote down:
 *
 * 1. **The path comes from the catalog, not from the body of the request.** The client sends an
 *    id and the server looks up which folder it corresponds to.
 * 2. **What is executed comes from a closed list.** The tool is one of five words, the editor one
 *    of `EDITORS`, the app one of `APPS`, the agent one the detector verified responds. Anything
 *    the browser sends is looked up in those lists and, if it is not there, ignored.
 * 3. **Local only.** With `DATABASE_URL` set the folders are on another machine; the routes refuse
 *    before getting here.
 */

/** How to open a folder on each system. Without shell: the path is an argument. */
export function folderOpener(): { command: string; args: (path: string) => string[] } | undefined {
  switch (platform()) {
    case "darwin":
      return { command: "open", args: (path) => [path] };
    case "win32":
      return { command: "explorer", args: (path) => [path] };
    case "linux":
      return { command: "xdg-open", args: (path) => [path] };
    default:
      return undefined;
  }
}

/**
 * Code editors, in order of default preference.
 *
 * The first one that exists in PATH is chosen. Opening a dormant Flutter project in Finder is
 * useful to view it; opening it in the editor is useful to work on it, which is what was intended.
 * The binaries are written here and do not come from the request: nothing from running what the
 * browser sends.
 */
export const EDITORS = ["cursor", "code", "windsurf", "subl", "webstorm", "idea", "zed"];

/**
 * What is each one called when you show it to a person.
 *
 * The panel said «Editor» and opened the first one it found, so with Cursor and VS Code installed
 * there was no way of knowing which one was going to open until it opened. A button that says the
 * name of the program needs no explanation.
 *
 * The table itself lives in `lib/open-all.ts`, which imports nothing: the dialog runs in a browser
 * and has to name a step whose editor is no longer installed, and this module cannot travel there
 * —it starts processes—. Two tables would drift the day an editor is added to one of them.
 */
export const EDITOR_NAMES = EDITOR_LABELS;

/** The cookie that stores the selected editor, next to `panoma-lang`, which stores the language. */
const EDITOR_COOKIE = "panoma-editor";

/**
 * The editor that this user opens, if they said which one.
 *
 * `cursor` tops the fixed list, so whoever tried Cursor one afternoon and stayed in VS Code ended
 * up every morning in the wrong editor — and with two editors installed that is not an aesthetic
 * preference: it is opening the project, closing it, and reopening it.
 *
 * It is read from the cookie `panoma-editor` and, if it is not there, from `PANOMA_EDITOR`. The
 * cookie takes precedence because it is the last one chosen manually; the environment variable is
 * set once when the server starts and is valid for when there is no browser involved (the CLI, the
 * MCP). Same mechanism as the language, without sharing code with it: here there is no dictionary
 * to load, just a word to compare.
 *
 * And the word **does not execute**: it only serves to reorder the list above. Anything not in it
 * is ignored, so an invented cookie does not become a command.
 */
export function editorsFor(request: Request): string[] {
  const wanted = (cookie(request, EDITOR_COOKIE) ?? process.env["PANOMA_EDITOR"])
    ?.trim()
    .toLowerCase();
  if (!wanted || !EDITORS.includes(wanted)) return EDITORS;
  return [wanted, ...EDITORS.filter((editor) => editor !== wanted)];
}

function cookie(request: Request, name: string): string | undefined {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

/**
 * Desktop applications that know how to open on a folder.
 *
 * Claude Code and Codex are two things at once: a terminal binary and an application. The panel
 * only offered the first, so whoever had the Claude app open pressed 'Claude Code' and a Terminal
 * popped up — the same brand leading to a site that was not the one they were using.
 *
 * What can be done is your business, not ours: both declare `public.folder` in their
 * `CFBundleDocumentTypes`, which is exactly the promise of 'I know how to open a folder.' It is
 * checked that `.app` exists and is opened with `open -a`, without invented schemes.
 */
const APPS: { id: string; name: string; bundle: string }[] = [
  { id: "claude-app", name: DESKTOP_LABELS["claude-app"]!, bundle: "Claude" },
  { id: "chatgpt-app", name: DESKTOP_LABELS["chatgpt-app"]!, bundle: "ChatGPT" },
];

/**
 * Where an application lives. You look in the two folders where macOS puts them.
 *
 * A `stat` through the app and nothing else: unlike with agents, here you don't have to start
 * anything to know if it exists — and starting someone's app to check that it exists would be
 * exactly what you don't want.
 */
export async function installedApps(): Promise<{ id: string; name: string; path: string }[]> {
  /*
    Outside of macOS there are no application queues, and it's not for lack of having looked.
    On August 19, 2026, both were installed on a clean Windows machine and the registry and disk
    were compared before and after. It is mounted and can be repeated when they change:
    `.github/workflows/apps-probe.yml`.
    Finding them is not the problem. Claude leaves `HKCU\…\Uninstall\AnthropicClaude` with its
    folder written inside, a shortcut in the start menu, and even a `claude://` protocol. ChatGPT
    arrives through the store, and store packages are asked by family, not by path.
    Be careful with that family, it’s misleading: ChatGPT’s is `OpenAI.Codex_2p2nqsd0c76g0`. It’s
    not that something else was installed. The product store entry for `9PLM9XGG6VKS` says
    `PackageName: ChatGPT`, `Publisher: OpenAI`, and it’s described as bringing ChatGPT to the
    desktop "with ChatGPT Work and Codex"; Windows lists it in the start menu as "ChatGPT."
    `OpenAI.Codex` is just the package’s internal name. What is something else is `OpenAI.Codex`
    in the winget catalog: that is the Codex CLI, the terminal agent from github.com/openai/codex,
    which here below is searched in PATH as `codex` and has nothing to do with this application.
    The problem is the other one. Neither of the two registered a verb under `Directory\shell`,
    which is where a Windows application declares that it knows how to open a folder: the same as
    in macOS they declare in `public.folder`, and which is the only thing that makes the `open -a`
    below honest. Giving them the project path would be inventing a promise they haven’t made, and
    the button would say 'open this project with Claude' without knowing if it opens the project.
    Launching them is possible —the executable is there and the store identifier too—, but that is
    opening the application, not opening the project with it, and that is not what the button
    says. If either of the two registers a folder verb, the probe will see it.
    In Linux, neither of the two is distributed.
   */
  if (platform() !== "darwin") return [];
  const homeApps = `${process.env["HOME"] ?? ""}/Applications`;
  const found = await Promise.all(
    APPS.map(async (app) => {
      for (const dir of ["/Applications", homeApps]) {
        const path = `${dir}/${app.bundle}.app`;
        try {
          const info = await stat(path);
          if (info.isDirectory()) return { id: app.id, name: app.name, path };
        } catch {
          // It's not in this folder; the next one is tried.
        }
      }
      return undefined;
    }),
  );
  return found.filter((app): app is { id: string; name: string; path: string } => app !== undefined);
}

/**
 * What editors are there in the PATH.
 *
 * Asking costs a process per editor, and now it is also asked when rendering the interface—not just
 * when opening something—so it is remembered for a minute: installing an editor in the middle of a
 * session is rare, but not impossible. Same treatment as in `/api/environment`.
 */
let installed: { at: number; value: Promise<Set<string>> } | undefined;

export function installedEditors(): Promise<Set<string>> {
  if (!installed || Date.now() - installed.at > 60_000) {
    installed = {
      at: Date.now(),
      /*
        The PATH is viewed, a `which` is not released by editor.
        `which` does not exist in Windows —there it is called `where` — so there all five failed,
        and Panoma said that no editor was installed on a machine with two. And on the other two
        systems, it was five processes every minute to read what the file system already knows.
        `findExecutable` does the same without launching anything and also checks the execution
        bit, which a `which` does not check.
       */
      value: Promise.resolve(
        new Set(EDITORS.filter((editor) => findExecutable(editor) !== undefined)),
      ),
    };
  }
  return installed.value;
}

export async function editorOpener(
  order: string[],
): Promise<{ command: string; args: (p: string) => string[] } | undefined> {
  const available = await installedEditors();
  const editor = order.find((candidate) => available.has(candidate));
  return editor ? { command: editor, args: (path) => [path] } : undefined;
}

/**
 * Which coding agents are installed and what they open with.
 *
 * Same one-minute cache as the editors, and for the same reason: asking costs a process per agent
 * and now it is asked when rendering the card of each project.
 */
let agentsCache: { at: number; value: Promise<AgentAvailability[]> } | undefined;

/** Those that can be used and those that are there and don’t start. Those that aren’t, out. */
export function agentsOf(): Promise<AgentAvailability[]> {
  if (!agentsCache || Date.now() - agentsCache.at > 60_000) {
    agentsCache = {
      at: Date.now(),
      value: detectCliAgents(providersByAuth("cli")).then((found) =>
        found.filter((entry) => entry.installed || entry.broken),
      ),
    };
  }
  return agentsCache.value;
}

async function installedAgents(): Promise<AgentAvailability[]> {
  return (await agentsOf()).filter((entry) => entry.installed);
}

/**
 * What a launch answers: it opened with such a program, or it did not, with the status the route
 * should send back and the two halves of the reason —what failed and how to fix it—.
 */
export type LaunchOutcome =
  | { ok: true; with: string }
  | { ok: false; status: number; error: string; hint?: string };

/**
 * What the program said is taught, not just that it failed.
 *
 * “Command failed: code /Users/…” doesn’t say anything that can be fixed. Almost always the reason
 * is in the first line of its stderr — a broken shim, an app that is no longer there — and that
 * phrase is the difference between knowing what’s happening and pressing the button again. It’s
 * trimmed because some editors spit out half of the Electron trace.
 */
function firstLineOf(error: unknown): string {
  const failure = error as Error & { stderr?: string };
  const said = (failure.stderr ?? "").trim().split("\n")[0]?.slice(0, 160);
  return said || failure.message;
}

/**
 * The folder, in the system file explorer.
 *
 * On Windows it is released instead of awaited, and a code of 1 counts as success: `explorer.exe`
 * hands the request to the shell that is already running and exits 1 with the window open, so
 * awaiting it reported every folder as failed while the folder was there in front of the person.
 * `open` and `xdg-open` do say what happened through their code, and keep being awaited.
 */
export async function openFolder(root: string, locale: Locale): Promise<LaunchOutcome> {
  const target = folderOpener();
  if (!target) {
    return {
      ok: false,
      status: 501,
      error: t(locale, "open.unsupportedTool", { tool: "folder", os: platform() }),
    };
  }

  if (platform() === "win32") {
    const failure = await spawnDetached(target.command, target.args(root), undefined, [0, 1]);
    if (failure) {
      return {
        ok: false,
        status: 500,
        error: t(locale, "open.launchFailed", { command: target.command }),
        hint: failure.message,
      };
    }
    return { ok: true, with: target.command };
  }

  try {
    await run(target.command, target.args(root), { timeout: 15_000 });
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: t(locale, "open.launchFailed", { command: target.command }),
      hint: firstLineOf(error),
    };
  }
  return { ok: true, with: target.command };
}

/**
 * The editor, the first installed one of `order`.
 *
 * `wanted` chooses a specific one, and it is validated against the same closed list. It's what
 * allows the panel to say 'Cursor' and 'VS Code' separately instead of an 'Editor' that opens
 * whatever it wants. What comes from the browser does not execute: it is searched in `EDITORS`,
 * and if it is not there, it is ignored and the usual order of preference is sent.
 */
export async function openEditor(
  root: string,
  order: string[],
  wanted: string | undefined,
  locale: Locale,
): Promise<LaunchOutcome> {
  const preferred =
    wanted && EDITORS.includes(wanted) ? [wanted, ...order.filter((e) => e !== wanted)] : order;
  const target = await editorOpener(preferred);
  if (!target) {
    return {
      ok: false,
      status: 501,
      error: t(locale, "open.noEditor"),
      hint: t(locale, "open.noEditorHint", { order: preferred.join(", ") }),
    };
  }
  /*
    Resolved before running, which on Windows is the difference between opening and an ENOENT.
    `findExecutable` honours PATHEXT, so `code` and `cursor` are found there as `code.cmd` — and
    `execFile` cannot start a `.cmd` without a shell. The editor was offered, saved into the plan,
    and failed on every launch. `resolveExecutable` returns the `cmd.exe /d /s /c` form when it has
    to, and the command as it is everywhere else.
   */
  const launch = resolveExecutable(target.command, target.args(root));
  try {
    await run(launch.file, launch.args, { timeout: 15_000 });
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: t(locale, "open.launchFailed", { command: target.command }),
      hint: firstLineOf(error),
    };
  }
  return { ok: true, with: target.command };
}

/**
 * A terminal opens and is released; it is not waited for.
 *
 * `alacritty`, `kitty`, `foot`, and `xterm` do not return until you close the window, so waiting
 * for them like the others would leave the request hanging for fifteen seconds and would respond
 * with an error with the terminal already open in front. And `unref` so that the server does not
 * get tied to a window that could still be alive tomorrow.
 *
 * But letting go and saying 'done' without looking would be worse: 400 ms are waited in case the
 * startup fails, which is how long it takes for an ENOENT to arrive. What doesn't fail in that
 * time is considered open, because the binary has already been checked to exist before choosing
 * it.
 *
 * With a `command`, the terminal does not open on the folder: it opens on a script that goes to
 * the folder and runs it. The script is `composeCommandScript`'s, with its rules and its test.
 */
export async function openTerminal(
  root: string,
  command: string | undefined,
  locale: Locale,
): Promise<LaunchOutcome> {
  const terminal = pickTerminal();
  if (!terminal) {
    return {
      ok: false,
      status: 501,
      error: t(locale, "open.unsupportedTool", { tool: "terminal", os: platform() }),
    };
  }

  let args: string[];
  try {
    args = command
      ? terminal.withScript(root, await writeCommandScript(root, command))
      : terminal.args(root);
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: t(locale, "open.launchFailed", { command: terminal.command }),
      hint: (error as Error).message,
    };
  }

  const failure = await spawnDetached(
    terminal.command,
    args,
    // Only for the two who don't know how to say where to open: the shell inherits the folder.
    terminal.useCwd ? root : undefined,
  );
  if (failure) {
    return {
      ok: false,
      status: 500,
      error: t(locale, "open.launchFailed", { command: terminal.command }),
      hint: failure.message,
    };
  }
  return { ok: true, with: terminal.command };
}

/**
 * What the handoff launch adds to opening an agent, and nothing the card's button sends.
 *
 * `args` are the resume arguments the server re-derived from a receipt (`resumeOf`), never a
 * string from a client, and they still pass `isSafeArgument` before reaching the script: a
 * session id is letters, digits and dashes, and a flag is a flag. `strict` refuses the
 * fallback to whichever agent is installed: a conversation handed to Codex must open in Codex
 * or say that Codex is not here, not open Claude on the wrong history.
 */
export interface OpenAgentOptions {
  args?: string[];
  strict?: boolean;
}

/** A flag or a bare token: what `composeScript` joins into the line without quoting. */
function isSafeArgument(value: string): boolean {
  return /^-{0,2}[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value);
}

/**
 * Open a coding agent in the project folder.
 *
 * It is not the same as 'do it now' from the card: that one writes an assignment and hands it over
 * in writing; this one only opens the session where it belongs and steps aside. It is what you
 * want nine times out of ten — to sit down and work on a specific project without having to
 * remember which of the four folders it was in.
 *
 * The script is composed by `composeScript`, which is where the quotation rule lives and where it
 * has its tests: 32 of the 81 folders in this catalog have a space in the name, so a `cd` without
 * quotes would fail in four out of ten projects.
 */
export async function openAgent(
  root: string,
  wanted: string | undefined,
  locale: Locale,
  options: OpenAgentOptions = {},
): Promise<LaunchOutcome> {
  /*
    One no longer asks about the system but about what is there: opening an agent is opening a
    terminal with a script inside, and that is known how to do on all three. What may be missing
    is the terminal—in a Linux without any of the fifteen we know—and then one says that, which is
    actionable, instead of 'I don't know how to open a terminal in Linux,' which it was not.
   */
  const terminal = pickTerminal();
  if (!terminal) {
    return {
      ok: false,
      status: 501,
      error: t(locale, "open.noTerminalHere", { os: platform() }),
      hint: t(locale, "open.noTerminalHereHint"),
    };
  }

  const available = await installedAgents();
  // The id comes from the browser, so it is searched among those detected instead of trusted: what
  // is executed is the binary that the detector verified responds, never a string that has traveled
  // from the page.
  const found =
    available.find((entry) => entry.provider.id === wanted) ?? (options.strict ? undefined : available[0]);
  if (!found?.command) {
    return {
      ok: false,
      status: 501,
      error: t(locale, "open.noAgent"),
      hint: t(locale, "open.noAgentHint", {
        agents: options.strict && wanted
          ? wanted
          : providersByAuth("cli")
              .map((entry) => entry.command)
              .join(", "),
      }),
    };
  }

  const args = options.args ?? [];
  if (!args.every(isSafeArgument)) {
    return {
      ok: false,
      status: 400,
      error: t(locale, "open.launchNamedFailed", { name: found.provider.name, detail: "unsafe argument" }),
    };
  }

  let script: string;
  try {
    script = await writeAgentScript(root, found, args);
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: t(locale, "open.launchNamedFailed", {
        name: found.provider.name,
        detail: (error as Error).message,
      }),
    };
  }

  const failure = await spawnDetached(
    terminal.command,
    terminal.withScript(root, script),
    terminal.useCwd ? root : undefined,
  );
  if (failure) {
    return {
      ok: false,
      status: 500,
      error: t(locale, "open.launchNamedFailed", {
        name: found.provider.name,
        detail: failure.message,
      }),
    };
  }
  return { ok: true, with: found.provider.name };
}

/**
 * Where the scripts go, and with what extension.
 *
 * The extension is not decorative. On macOS a `.command` is what Terminal.app knows how to execute
 * when opened; on Windows PowerShell it only runs `.ps1`; on Linux it doesn't matter, but `.sh`
 * tells what it is to whoever finds it. 0700 like the task launcher: it is an executable, and no
 * one else on this machine should be able to write inside it before the terminal opens it.
 */
async function scriptHome(): Promise<{ dir: string; extension: string; windows: boolean }> {
  const dir = panomaPath("open");
  await mkdir(dir, { recursive: true });
  const windows = platform() === "win32";
  const extension = windows ? "ps1" : platform() === "darwin" ? "command" : "sh";
  return { dir, extension, windows };
}

/**
 * Windows PowerShell reads a `.ps1` without a mark as the ANSI code page, not as UTF-8 — that is
 * 5.1, the one that ships with Windows, and the one `terminals.ts` launches. Without the mark a
 * root like `C:\Users\Ana María\shop` arrives at `Set-Location` as `Ana MarÃ­a` and the script
 * dies on its first line. PowerShell 7 would not need it and does not mind it.
 */
const BOM = "\uFEFF";

/**
 * The file each script is written to, and the mark it needs.
 *
 * The name carries the folder because two projects launching the same agent within a second wrote
 * the same file: the second launch rewrote the script the first terminal had not read yet, and the
 * agent opened twice on the same project. It is the reason `writeCommandScript` hashes what it
 * hashes, and it applies just the same here.
 */
async function writeScript(name: string, body: string, windows: boolean, dir: string): Promise<string> {
  const script = `${dir}/${name}`;
  // 0700 on macOS and Linux: it is an executable, and nobody else on this machine should be able to
  // write inside it before the terminal opens it. On Windows Node ignores the mode and the file
  // inherits the profile's permissions.
  await writeFile(script, windows ? BOM + body : body, { mode: 0o700 });
  return script;
}

/*
  The stamp carries the arguments as well as the folder since the handoff launch: resuming two
  conversations of one project within a second would otherwise write the same file twice, and
  the first terminal would open the second one's session. `sha1(root)` alone is what every
  launch without arguments still gets, byte for byte, so the scripts already on disk keep their
  names.
 */
async function writeAgentScript(root: string, found: AgentAvailability, args: string[] = []): Promise<string> {
  const { dir, extension, windows } = await scriptHome();
  const stamped = args.length === 0 ? root : `${root}\0${args.join("\0")}`;
  const stamp = createHash("sha1").update(stamped).digest("hex").slice(0, 12);
  return writeScript(
    `agent-${found.provider.id}-${stamp}.${extension}`,
    composeScript({
      root,
      command: found.command!,
      args,
      ...(windows ? { shell: "powershell" as const } : {}),
    }),
    windows,
    dir,
  );
}

/**
 * One file per folder and command, named by their hash: two projects opening their dev server at
 * the same second must not overwrite each other's script while a terminal is still reading it.
 */
async function writeCommandScript(root: string, command: string): Promise<string> {
  const { dir, extension, windows } = await scriptHome();
  const stamp = createHash("sha1").update(`${root}\0${command}`).digest("hex").slice(0, 12);
  return writeScript(
    `terminal-${stamp}.${extension}`,
    composeCommandScript({ root, command, ...(windows ? { shell: "powershell" as const } : {}) }),
    windows,
    dir,
  );
}

/**
 * Open a desktop application over the project folder.
 *
 * `open -a` and nothing more: the system decides what the app does with the folder, which is
 * exactly what it declared it could do in its `Info.plist`. No `claude://` or `codex://` schema is
 * composed by hand — an undocumented schema changes without notice and leaves the button mute.
 *
 * The identifier comes from the browser and is searched among the detected ones, so what is
 * executed always comes from `APPS`, which is written here.
 */
export async function openApp(
  root: string,
  wanted: string | undefined,
  locale: Locale,
): Promise<LaunchOutcome> {
  const available = await installedApps();
  const app = available.find((entry) => entry.id === wanted);
  if (!app) return { ok: false, status: 501, error: t(locale, "open.appMissing") };

  try {
    await run("open", ["-a", app.path, root], { timeout: 15_000 });
    return { ok: true, with: app.name };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: t(locale, "open.launchNamedFailed", { name: app.name, detail: (error as Error).message }),
    };
  }
}

/**
 * An address, in the default browser.
 *
 * The address is checked one last time with `openableUrl` even though everything that reaches
 * here came from the catalog or from a plan the owner saved: `open` also opens files, and this is
 * the last place where a mistake upstream can still be refused.
 */
export async function openLink(url: string, locale: Locale): Promise<LaunchOutcome> {
  const target = urlOpener(platform());
  if (!target) {
    return {
      ok: false,
      status: 501,
      error: t(locale, "open.unsupportedTool", { tool: "link", os: platform() }),
    };
  }
  const safe = openableUrl(url);
  if (!safe) return { ok: false, status: 400, error: t(locale, "openAll.badLink") };

  /*
    Released, not awaited: `xdg-open` hands the address to a browser that may not be running yet
    and on some desktops does not return until it is. The 400 ms window of `spawnDetached` still
    catches a missing binary.
   */
  const failure = await spawnDetached(target.command, target.args(safe));
  if (failure) {
    return {
      ok: false,
      status: 500,
      error: t(locale, "open.launchFailed", { command: target.command }),
      hint: failure.message,
    };
  }
  return { ok: true, with: target.command };
}

/**
 * Whether this machine knows how to open a terminal and a folder at all.
 *
 * Both answers are free —a table lookup and a `findExecutable`— and both decide whether the step
 * is offered: a "terminal" row on a Linux with none of the fifteen we know is a button that can
 * only fail.
 */
export function terminalAvailable(): Terminal | undefined {
  return pickTerminal();
}

export function folderAvailable(): boolean {
  return folderOpener() !== undefined;
}
