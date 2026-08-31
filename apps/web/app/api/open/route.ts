import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { platform } from "node:os";
import { promisify } from "node:util";
import { detectCliAgents, providersByAuth, type AgentAvailability } from "@panoma/ai";
import { getProjectLocation } from "@panoma/db";
import { canonicalAgentKind, findExecutable, mcpTarget } from "@panoma/core";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { composeScript } from "@/lib/launcher";
import { pickTerminal, type Terminal } from "@/lib/terminals";
import { spawnDetached } from "@/lib/spawn-detached";
import { localeFrom, t, type Locale } from "@/lib/i18n";
// Only the type: `import type` is deleted when compiling, so the path does not carry over to the
// client.
import type { OpenTarget } from "@/components/use-open-target";

const run = promisify(execFile);

/**
 * Open the project folder in the system file explorer.
 *
 * A web page cannot open a local folder on its own —browsers prevent it, and for good reason—, so
 * the action is performed by the server. Here that is legitimate because the server **is** the
 * user's machine: the same site from which dependencies are already installed and tests are run on
 * `panoma run`.
 *
 * Two precautions that are not optional:
 *
 * 1. **The path comes from the catalog, not from the body of the request.** The client sends an id
 * and the server looks up which folder it corresponds to. Accepting the path directly would turn
 * this into "open whatever they tell you," and it doesn't matter that today only our own interface
 * calls it: the next browser tab could also call it.
 * 2. **Local only.** With `DATABASE_URL` set, the catalog lives on another machine and the folders
 * are not on the server's disk: opening there would be useless and could cause harm. It is
 * rejected instead of attempting it.
 */

/** How to open a folder on each system. Without shell: the path is an argument. */
function opener(): { command: string; args: (path: string) => string[] } | undefined {
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
const EDITORS = ["cursor", "code", "windsurf", "subl", "webstorm", "idea", "zed"];

/**
 * What is each one called when you show it to a person.
 *
 * The panel said «Editor» and opened the first one it found, so with Cursor and VS Code installed
 * there was no way of knowing which one was going to open until it opened. A button that says the
 * name of the program needs no explanation.
 */
const EDITOR_NAMES: Record<string, string> = {
  cursor: "Cursor",
  code: "VS Code",
  windsurf: "Windsurf",
  subl: "Sublime Text",
  webstorm: "WebStorm",
  idea: "IntelliJ IDEA",
  zed: "Zed",
};

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
function editorsFor(request: Request): string[] {
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
  { id: "claude-app", name: "Claude", bundle: "Claude" },
  { id: "chatgpt-app", name: "ChatGPT", bundle: "ChatGPT" },
];

/**
 * Where an application lives. You look in the two folders where macOS puts them.
 *
 * A `stat` through the app and nothing else: unlike with agents, here you don't have to start
 * anything to know if it exists — and starting someone's app to check that it exists would be
 * exactly what you don't want.
 */
async function installedApps(): Promise<{ id: string; name: string; path: string }[]> {
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

function installedEditors(): Promise<Set<string>> {
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

async function editorOpener(
  order: string[],
): Promise<{ command: string; args: (p: string) => string[] } | undefined> {
  const available = await installedEditors();
  const editor = order.find((candidate) => available.has(candidate));
  return editor ? { command: editor, args: (path) => [path] } : undefined;
}

/** The system terminal, already located in the folder. */
/**
 * The terminal that is on this machine, or nothing if we don't know how to open it.
 *
 * The table lives in `lib/terminals.ts` because in Linux there is not one terminal but fifteen,
 * and choosing between them is a list of names and options that you try without launching them.
 */
function terminalOpener(): Terminal | undefined {
  return pickTerminal();
}

/**
 * What can be opened from this browser, and with what.
 *
 * The POST down here rejects everything when the catalog is remote —the folders are on another
 * machine—, but the client had no way of knowing it: the buttons kept being displayed and only
 * admitted it when pressed. A button that exists and cannot work is a broken promise; this is what
 * is needed not to display it.
 *
 * And by the way, it says **which editor** is going to be used, which is what the code search
 * needs to compose a `cursor://` or `vscode://` link that opens the file on its line.
 *
 * It returns no path: whoever cannot open also does not need to know where anything is.
 */
export async function GET(request: Request) {
  /*
    `sameOrigin` and not `localOperatorOnly`: this obeys no one —it doesn't even carry a byte from
    the body— but it scans the disk by starting the editors and agents installed with `--version`,
    and responds with the inventory of programs of this machine. Without the safeguard, any page
    opened in another tab could request that list in a loop.
   */
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  if (process.env["DATABASE_URL"]) {
    /*
      Here `apps` was missing, which the guy declares as mandatory. It didn't crash because
      remotely no one ever goes through that list — the open buttons are already hidden —, and
      that's why it had been like this for a while: a broken contract that goes unnoticed until
      the day a new component does `apps.map` and crashes on another machine. Both responses are
      noted with `OpenTarget` so that the compiler will find the next difference.
     */
    const nothing: OpenTarget = { remote: true, editor: null, editors: [], apps: [], agents: [] };
    return Response.json(nothing);
  }

  const order = editorsFor(request);
  const available = await installedEditors();
  /*
    The entire list is returned and not just the selected one.
    The panel displayed three generic buttons —editor, terminal, folder— and none indicated which
    program would open. With the real names, 'Open in' ceases to be a promise and becomes a menu
    of what is on this machine; and what is not there is not displayed, which is what prevents the
    button that can only fail.
   */
  const editors = order
    .filter((editor) => available.has(editor))
    .map((editor) => ({ id: editor, name: EDITOR_NAMES[editor] ?? editor }));

  /*
    The broken ones are also taught, and they say why.
    In this `/usr/local/bin/codex` machine it exists and its vendorized binary does not, so
    `codex --version` fails. Marking it as absent leaves its owner searching on the panel for
    something found in PATH; saying 'it exists and does not start' alongside what it reported on
    failing is the difference between an inexplicable gap and something that can be fixed.
   */
  const agents = (await agentsOf()).map((entry) => ({
    id: entry.provider.id,
    name: entry.provider.name,
    broken: entry.broken ?? null,
  }));

  const apps = (await installedApps()).map((app) => ({ id: app.id, name: app.name }));

  const here: OpenTarget = {
    remote: false,
    editor: editors[0]?.id ?? null,
    editors,
    apps,
    agents,
  };
  return Response.json(here, { headers: { "Cache-Control": "private, max-age=60" } });
}

/**
 * Which encoding agents are installed and what they open with.
 *
 * Same one-minute cache as the editors, and for the same reason: asking costs a process per agent
 * and now it is asked when rendering the card of each project.
 */
let agentsCache: { at: number; value: Promise<AgentAvailability[]> } | undefined;

/** Those that can be used and those that are there and don’t start. Those that aren’t, out. */
function agentsOf(): Promise<AgentAvailability[]> {
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

export async function POST(request: Request) {
  /*
    To open is always to open **here**, so only from here.
    This route starts editors, terminals, desktop applications, and agents on the computer that
    serves the catalog. From the mobile it wouldn't make sense even if it worked —what opens does
    not appear on the mobile— and with the network key it did work: a forwarded link was enough to
    open a terminal with a working agent. The GET from above stays open: it only says what is
    installed, and the panel needs it to render.
   */
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "api.localOnly", { action: t(locale, "api.action.openFolder") }) },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    tool?: "folder" | "editor" | "terminal" | "agent" | "app";
    /** Which one exactly, when there are several: `code`, `claude-cli`… */
    with?: string;
    /** Open the configuration file MCP of this agent, instead of a project. */
    config?: string;
  };

  /*
    Open the configuration file of an agent in the editor.
    It is the output of the 'you paste this' case: when the connector cannot write —a TOML that
    doesn't parse, a manually made entry— the screen shows the snippet and the file, and until now
    opening it was the user's gesture and their patience. The browser only sends the agent's
    identifier; **the path is decided by the server** with `mcpTarget`, so nothing from the client
    becomes an argument of a process.
   */
  if (body.config) {
    const configFile = mcpTarget(canonicalAgentKind(body.config)).file;
    if (!configFile) {
      return Response.json({ error: t(locale, "open.noConfig") }, { status: 404 });
    }
    const editor = await editorOpener(editorsFor(request));
    if (!editor) {
      return Response.json(
        {
          error: t(locale, "open.noEditor"),
          hint: t(locale, "open.noEditorHint", { order: editorsFor(request).join(", ") }),
        },
        { status: 501 },
      );
    }
    try {
      await run(editor.command, editor.args(configFile), { timeout: 15_000 });
    } catch (error) {
      const failure = error as Error & { stderr?: string };
      const said = (failure.stderr ?? "").trim().split("\n")[0]?.slice(0, 160);
      return Response.json(
        {
          error: t(locale, "open.launchFailed", { command: editor.command }),
          hint: said || failure.message,
        },
        { status: 500 },
      );
    }
    return Response.json({ ok: true, file: configFile, with: editor.command });
  }

  if (!body.id) return Response.json({ error: t(locale, "api.missingId") }, { status: 400 });

  // The tool comes as one of four words and is translated into a binary from a closed list. Nothing
  // sent by the browser ends up being a command.
  const tool = body.tool ?? "folder";
  if (!["folder", "editor", "terminal", "agent", "app"].includes(tool)) {
    return Response.json({ error: t(locale, "open.unknownTool", { tool }) }, { status: 400 });
  }

  const { db: database } = await db();
  const project = await getProjectLocation(database, body.id);
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  // Folders are moved and deleted, and the catalog doesn't notice until the next scan. Checking it
  // here turns a silent failure into a phrase that can be understood.
  try {
    const info = await stat(project.root);
    if (!info.isDirectory()) throw new Error("no es un directorio");
  } catch {
    return Response.json(
      {
        error: t(locale, "open.gone", { root: project.root }),
        hint: t(locale, "open.goneHint"),
      },
      { status: 410 },
    );
  }

  /*
    `with` chooses a specific one, and it is validated against the same closed list.
    It's what allows the panel to say 'Cursor' and 'VS Code' separately instead of an 'Editor'
    that opens whatever it wants. What comes from the browser does not execute: it is searched in
    `EDITORS` or among the detected agents, and if it is not there, it is ignored and the usual
    order of preference is sent.
   */
  const order =
    tool === "editor" && body.with && EDITORS.includes(body.with)
      ? [body.with, ...editorsFor(request).filter((editor) => editor !== body.with)]
      : editorsFor(request);

  if (tool === "agent") return openAgent(project.root, body.with, locale);
  if (tool === "app") return openApp(project.root, body.with, locale);

  const target =
    tool === "editor"
      ? await editorOpener(order)
      : tool === "terminal"
        ? terminalOpener()
        : opener();

  if (!target) {
    return Response.json(
      {
        error:
          tool === "editor"
            ? t(locale, "open.noEditor")
            : t(locale, "open.unsupportedTool", { tool, os: platform() }),
        hint:
          tool === "editor"
            ? t(locale, "open.noEditorHint", { order: order.join(", ") })
            : undefined,
      },
      { status: 501 },
    );
  }

  if (tool === "terminal") return launchTerminal(target as Terminal, project, locale);

  try {
    await run(target.command, target.args(project.root), { timeout: 15_000 });
  } catch (error) {
    /*
      What the program said is taught, not just that it failed.
      “Command failed: code /Users/…” doesn’t say anything that can be fixed. Almost always the
      reason is in the first line of its stderr — a broken shim, an app that is no longer there —
      and that phrase is the difference between knowing what’s happening and pressing the button
      again. It’s trimmed because some editors spit out half of the Electron trace.
     */
    const failure = error as Error & { stderr?: string };
    const said = (failure.stderr ?? "").trim().split("\n")[0]?.slice(0, 160);
    return Response.json(
      { error: t(locale, "open.launchFailed", { command: target.command }), hint: said || failure.message },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, root: project.root, name: project.name, with: target.command });
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
 */
async function launchTerminal(
  terminal: Terminal,
  project: { root: string; name: string },
  locale: Locale,
): Promise<Response> {
  const failure = await spawnDetached(
    terminal.command,
    terminal.args(project.root),
    // Only for the two who don't know how to say where to open: the shell inherits the folder.
    terminal.useCwd ? project.root : undefined,
  );

  if (failure) {
    return Response.json(
      {
        error: t(locale, "open.launchFailed", { command: terminal.command }),
        hint: failure.message,
      },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, root: project.root, name: project.name, with: terminal.command });
}


/**
 * Open a coding agent in the project folder.
 *
 * It is not the same as 'do it now' from the card: that one writes an assignment and hands it over
 * in writing; this one only opens the session where it belongs and steps aside. It is what you
 * want nine times out of ten — to sit down and work on a specific project without having to
 * remember which of the four folders it was in.
 *
 * The script is composed of `composeScript`, which is where the quotation rule lives and where it
 * has its tests: 32 of the 81 folders in this catalog have a space in the name, so a `cd` without
 * quotes would fail in four out of ten projects.
 */
async function openAgent(root: string, wanted: string | undefined, locale: Locale) {
  /*
    One no longer asks about the system but about what is there: opening an agent is opening a
    terminal with a script inside, and that is known how to do on all three. What may be missing
    is the terminal—in a Linux without any of the fifteen we know—and then one says that, which is
    actionable, instead of 'I don't know how to open a terminal in Linux,' which it was not.
   */
  const terminal = pickTerminal();
  if (!terminal) {
    return Response.json(
      {
        error: t(locale, "open.noTerminalHere", { os: platform() }),
        hint: t(locale, "open.noTerminalHereHint"),
      },
      { status: 501 },
    );
  }

  const available = await installedAgents();
  // The id comes from the browser, so it is searched among those detected instead of trusted: what
  // is executed is the binary that the detector verified responds, never a string that has traveled
  // from the page.
  const found = available.find((entry) => entry.provider.id === wanted) ?? available[0];
  if (!found?.command) {
    return Response.json(
      {
        error: t(locale, "open.noAgent"),
        hint: t(locale, "open.noAgentHint", {
          agents: providersByAuth("cli")
            .map((entry) => entry.command)
            .join(", "),
        }),
      },
      { status: 501 },
    );
  }

  let script: string;
  try {
    script = await writeAgentScript(root, found);
  } catch (error) {
    return Response.json(
      {
        error: t(locale, "open.launchNamedFailed", {
          name: found.provider.name,
          detail: (error as Error).message,
        }),
      },
      { status: 500 },
    );
  }

  const failure = await spawnDetached(
    terminal.command,
    terminal.withScript(root, script),
    terminal.useCwd ? root : undefined,
  );
  if (failure) {
    return Response.json(
      {
        error: t(locale, "open.launchNamedFailed", {
          name: found.provider.name,
          detail: failure.message,
        }),
      },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, root, with: found.provider.name });
}

async function writeAgentScript(root: string, found: AgentAvailability): Promise<string> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { panomaPath } = await import("@panoma/core");
  const dir = panomaPath("open");
  await mkdir(dir, { recursive: true });
  /*
    The extension is not decorative. On macOS a `.command` is what Terminal.app knows how to
    execute when opened; on Windows PowerShell it only runs `.ps1`; on Linux it doesn't matter,
    but `.sh` tells what it is to whoever finds it.
   */
  const windows = platform() === "win32";
  const extension = windows ? "ps1" : platform() === "darwin" ? "command" : "sh";
  const script = `${dir}/${found.provider.id}.${extension}`;
  // 0700 like the task launcher: it is an executable, and no one else on this machine should be
  // able to write inside it before the terminal opens it.
  await writeFile(
    script,
    composeScript({
      root,
      command: found.command!,
      args: [],
      ...(windows ? { shell: "powershell" as const } : {}),
    }),
    { mode: 0o700 },
  );
  return script;
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
async function openApp(root: string, wanted: string | undefined, locale: Locale) {
  const available = await installedApps();
  const app = available.find((entry) => entry.id === wanted);
  if (!app) {
    return Response.json(
      { error: t(locale, "open.appMissing") },
      { status: 501 },
    );
  }

  try {
    await run("open", ["-a", app.path, root], { timeout: 15_000 });
    return Response.json({ ok: true, root, with: app.name });
  } catch (error) {
    return Response.json(
      {
        error: t(locale, "open.launchNamedFailed", {
          name: app.name,
          detail: (error as Error).message,
        }),
      },
      { status: 500 },
    );
  }
}
