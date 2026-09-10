import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { getProjectLocation } from "@panoma/db";
import { canonicalAgentKind, mcpTarget } from "@panoma/core";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";
import {
  agentsOf,
  editorOpener,
  editorsFor,
  EDITOR_NAMES,
  installedApps,
  installedEditors,
  openAgent,
  openApp,
  openEditor,
  openFolder,
  openTerminal,
  type LaunchOutcome,
} from "@/lib/open-targets";
// Only the type: `import type` is deleted when compiling, so the path does not carry over to the
// client.
import type { OpenTarget } from "@/components/use-open-target";

const run = promisify(execFile);

/**
 * Open the project folder in the system file explorer, the editor, a terminal, an agent or a
 * desktop app.
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
 *
 * The lists of what may open, the detection and the launchers live in `lib/open-targets.ts`, shared
 * with `/api/open/all`, which opens several of these in one go.
 */

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
    const nothing: OpenTarget = { remote: true, editor: null, editors: [], desktopApps: [], agents: [] };
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

  const desktopApps = (await installedApps()).map((app) => ({ id: app.id, name: app.name }));

  const here: OpenTarget = {
    remote: false,
    editor: editors[0]?.id ?? null,
    editors,
    desktopApps,
    agents,
  };
  return Response.json(here, { headers: { "Cache-Control": "private, max-age=60" } });
}

/** A launch, as this route has always answered it: the two halves of the reason on failure. */
function answer(outcome: LaunchOutcome, extra: Record<string, unknown>): Response {
  if (outcome.ok) return Response.json({ ok: true, ...extra, with: outcome.with });
  return Response.json(
    { error: outcome.error, ...(outcome.hint ? { hint: outcome.hint } : {}) },
    { status: outcome.status },
  );
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

  // The tool comes as one of five words and is translated into a binary from a closed list. Nothing
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
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch {
    return Response.json(
      {
        error: t(locale, "open.gone", { root: project.root }),
        hint: t(locale, "open.goneHint"),
      },
      { status: 410 },
    );
  }

  const root = project.root;
  const named = { root, name: project.name };

  if (tool === "agent") return answer(await openAgent(root, body.with, locale), { root });
  if (tool === "app") return answer(await openApp(root, body.with, locale), { root });
  if (tool === "terminal") return answer(await openTerminal(root, undefined, locale), named);
  if (tool === "editor") {
    return answer(await openEditor(root, editorsFor(request), body.with, locale), named);
  }
  return answer(await openFolder(root, locale), named);
}
