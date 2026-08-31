import { chmod, mkdir, open as openFile, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { join } from "node:path";
import {
  detectCliAgents,
  providersByAuth,
  type AgentAvailability,
} from "@panoma/ai";
import { panomaPath } from "@panoma/core";
import { getProject, getTask, listProjectTasks, recordLaunch } from "@panoma/db";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";
import { buildAssignment, isAssignmentKind, factsOf, kindFromTitle } from "@/lib/assignments";
import { composeScript } from "@/lib/launcher";
import { pickTerminal } from "@/lib/terminals";
import { spawnDetached } from "@/lib/spawn-detached";

/**
 * "Do it now": the project's terminal, with the agent already working on the assignment.
 *
 * It is the midpoint between the two methods that already existed. Assign leaves the message in
 * the queue and the agent picks it up when it logs in — perfect for what can wait until tomorrow,
 * useless when you want it now —; copying gives you the text but leaves you the job of opening the
 * terminal, going to the folder, launching the agent, and pasting. This does those four steps.
 *
 * **It is still your agent, with your session and on your machine.** Panoma does not carry out the
 * task nor see any credentials: it writes the text to a file, writes a three-line script that it
 * passes to your CLI, and asks the system to open it. It is the same doctrine as
 * `packages/ai/src/cli-agent.ts` — if you already pay for Claude Pro and already have a session
 * started, the correct way to take advantage of it is to request the work from your own tool.
 *
 * The three precautions, which are those of `/api/open` plus one:
 *
 * 1. **The route comes from the catalog**, not from the body of the request.
 * 2. **The task is drafted by the server** based on the facts of the project. The browser sends
 * `{slug, kind}` and nothing else: a prompt that comes from a page and ends up in front of an
 * agent with tools is exactly the hole we do not want.
 * 3. **The command never goes through the shell.** It goes to a file, and the script reads it with
 * `"$(cat …)"` — in double quotes, so it arrives as a single argument and is not reinterpreted.
 * The two paths that are written inside the script do go through `quoteForShell`.
 */

/** Where the task and its launcher are left. Outside the project: it is not your code. */
function assignmentsDir(): string {
  return panomaPath("assignments");
}

/**
 * How an assignment is given to each agent **to work**, not to answer.
 *
 * It is different from `provider.args`, which asks for a single, non-interactive response (`claude
 * -p`) because there Panoma wants the text back. Here, the one who stays in front is you: the
 * agent starts in conversation mode with the task set as the first turn.
 */
const INTERACTIVE: Record<string, string[]> = {
  "claude-cli": [],
  "codex-cli": [],
  // Gemini distinguishes between responding and staying: `-p` prints and exits, `-i` logs in.
  "gemini-cli": ["-i"],
};

/**
 * What agent is installed. One minute is remembered, like the editors of `/api/open`.
 *
 * Asking costs one process per agent and now it is also asked when rendering the token —not just
 * when rolling—, so without cache each visit to a project would start three.
 */
let cache: { at: number; value: Promise<AgentAvailability | undefined> } | undefined;

function agentAvailable(): Promise<AgentAvailability | undefined> {
  if (!cache || Date.now() - cache.at > 60_000) {
    cache = {
      at: Date.now(),
      value: (async () => {
        const candidates = providersByAuth("cli").filter((p) => p.id in INTERACTIVE);
        const detected = await detectCliAgents(candidates);
        // The entire finding is returned and not just the provider: the binary that the detector
        // checked is needed, which may be inside a `.app` and not in the PATH.
        return detected.find((entry) => entry.installed);
      })(),
    };
  }
  return cache.value;
}

/**
 * What prevents launching, if something prevents it. In the same order in which it must be fixed.
 *
 * The project page uses it to decide whether to render the button: one that exists but cannot work is a
 * broken promise, and here the promise is strong—'do it now'—so breaking it is more noticeable
 * than anywhere else.
 */
export async function GET(request: Request) {
  /*
    The same two guards as the POST, although this only answers one question: replying already
    costs process execution —`agentAvailable` probes the three agents with a real `--version` —
    and it was the only handler in the entire subsystem that gave an order to the machine without
    checking who called. An external tab cannot read the response, but it could make this machine
    execute things, and that half also counts.
   */
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  if (process.env["DATABASE_URL"]) {
    return Response.json({ available: false, agent: null, reason: "remote" });
  }
  // Opening an agent is opening a terminal with a script inside, and that can be done in all three.
  // What may be missing is the terminal, not the system.
  if (!pickTerminal()) {
    return Response.json({ available: false, agent: null, reason: "sistema" });
  }

  const found = await agentAvailable();
  return Response.json(
    found
      ? { available: true, agent: found.provider.name, reason: null }
      : { available: false, agent: null, reason: "sin-agente" },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}

export async function POST(request: Request) {
  // This opens a terminal with an agent inside, working on the project and with permission to edit.
  // It is the most 'hands-on keyboard' thing the catalog does, so the network key is not enough: it
  // has to come from this machine.
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "api.localOnly", { action: t(locale, "api.action.launchAgent") }) },
      { status: 400 },
    );
  }
  const terminal = pickTerminal();
  if (!terminal) {
    return Response.json(
      {
        error: t(locale, "open.noTerminalHere", { os: platform() }),
        hint: t(locale, "assign.pasteHint"),
      },
      { status: 501 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    slug?: string;
    kind?: string;
    /**
     * An order that is already in the queue, by its identifier.
     *
     * The other way to call here, and the one the critic opened: their findings are none of the
     * four assigned drafts, so `kind` does not name them. What is launched is the row that Panoma
     * wrote, read from the database — the text still cannot come from the client, which is what
     * separates this from a gate that dictates to an agent what to write.
     */
    taskId?: string;
  };

  const queued = typeof body.taskId === "string" && body.taskId !== "" ? body.taskId : undefined;
  const slug = body.slug;
  const kind = body.kind;
  if (queued === undefined) {
    if (!slug) {
      return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });
    }
    if (!isAssignmentKind(kind)) {
      return Response.json({ error: t(locale, "api.noAssignment") }, { status: 400 });
    }
  }

  const found = await agentAvailable();
  if (!found?.command) {
    return Response.json(
      {
        error: t(locale, "open.noAgent"),
        /*
          The clue was handwritten and in fixed Spanish, next to a `error` that does translate:
          the same message appeared halfway in each language. The key already existed —
          `/api/open` uses it for this same case — and it kept what this sentence said, which was
          better: the order matters, and with the agent installed but without an active session,
          the button also doesn’t trigger anything.
         */
        /*
          And it only names those that this button knows how to open. It listed the nine
          command-line providers that the catalog knows, but `agentAvailable` only probes those
          that are in `INTERACTIVE`, which are three: whoever installed aider or copilot following
          this lead found the button just as absent and without knowing why.
         */
        hint: t(locale, "open.noAgentHint", {
          agents: providersByAuth("cli")
            .filter((provider) => provider.id in INTERACTIVE)
            .map((provider) => provider.command)
            .join(", "),
        }),
      },
      { status: 501 },
    );
  }

  const { db: database } = await db();

  /*
    Both paths end in the same thing: a file name, a root, and a text. What changes is where the
    text comes from— from the queue, or written now with the facts of the project— and in both
    cases it was written by Panoma.
   */
  let launch:
    | {
        name: string;
        root: string;
        assignment: string;
        /** For the row `launches`: from which project it came and what assignment it was. */
        projectId: string;
        taskId?: string;
        kind?: string;
      }
    | undefined;

  if (queued !== undefined) {
    const task = await getTask(database, queued);
    if (task === undefined || !task.body) {
      return Response.json({ error: t(locale, "assign.noTask") }, { status: 404 });
    }
    launch = {
      name: `${sanitize(task.projectSlug)}-${sanitize(task.id)}`,
      root: task.projectRoot,
      assignment: task.body,
      projectId: task.projectId,
      taskId: task.id,
    };
  } else if (slug !== undefined && isAssignmentKind(kind)) {
    const data = await getProject(database, slug);
    if (!data) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });
    /*
      If that same task is already in the queue, **that** row is launched instead of writing
      another one.
      Previously, it was written from scratch without looking at the queue, so pressing "leave it
      in the queue" and then "open in your terminal" sent the same job twice: the terminal agent
      did it, and the queue remained open, announcing it as pending, because nothing linked it to
      what had just happened. Recognizing the queue is what allows you to tell the agent what its
      ID is, and with that, it can take it and close it itself.
     */
    const enCola = (await listProjectTasks(database, data.project.id)).find(
      (task) =>
        (task.status === "open" || task.status === "in-progress") &&
        kindFromTitle(task.title) === kind &&
        task.body,
    );
    const assignment = buildAssignment(kind, factsOf(data), locale);
    launch = {
      name: `${sanitize(data.project.slug)}-${kind}`,
      root: data.project.root,
      assignment: enCola?.body ?? assignment.body,
      projectId: data.project.id,
      ...(enCola ? { taskId: enCola.id } : {}),
      kind,
    };
  } else {
    /*
      Unreachable: without `taskId` the two checks above have already answered 400. It is written
      because the compiler cannot see that relationship between two separate branches, and because
      a `!` here would hide the day someone moves one of the two.
     */
    return Response.json({ error: t(locale, "api.noAssignment") }, { status: 400 });
  }

  try {
    const script = await writeLauncher({
      name: launch.name,
      root: launch.root,
      /*
        And with its id inside when the queue exists. The body asks to close the task "if this
        assignment is in the queue," and up to this point the agent had no way of knowing which
        one it was: `panoma_complete_task` requests an id that did not appear anywhere in the
        text.
       */
      assignment: launch.taskId
        ? `${launch.assignment}\n\n${t(locale, "assign.taskIdLine", { id: launch.taskId })}`
        : launch.assignment,
      // The binary that the detector checked, which can live inside a `.app`.
      command: found.command!,
      args: INTERACTIVE[found.provider.id] ?? [],
    });
    /*
      It opens and releases. Several Linux terminals do not return until you close the window, and
      the agent inside can be working for half an hour: waiting for it would tie the request to
      the entire session. What is looked at, however, is the first 400 ms, which is how long it
      takes for what does not start to fail.
     */
    const failure = await spawnDetached(
      terminal.command,
      terminal.withScript(launch.root, script),
      terminal.useCwd ? launch.root : undefined,
    );
    if (failure) throw failure;

    /*
      And here the queue remains, with the terminal already open in front. Until this launch
      increment, it left no trace: the only vestige was the `~/.panoma/assignments` file, which is
      overwritten on each relaunch and therefore only knows to say 'at least once.' It is recorded
      **after** `spawn` on purpose, just like `saveModelCall` with the calls that are paid: what
      never got opened has not gone anywhere.
     */
    await recordLaunch(database, {
      projectId: launch.projectId,
      ...(launch.taskId ? { taskId: launch.taskId } : {}),
      ...(launch.kind ? { kind: launch.kind } : {}),
      agent: found.provider.name,
    });

    return Response.json({ ok: true, agent: found.provider.name });
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
}

/**
 * The slug already comes clean from the engine; this is the belt in case one day it stops coming
 * with it.
 */
function sanitize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60) || "proyecto";
}

async function writeLauncher(input: {
  name: string;
  root: string;
  assignment: string;
  command: string;
  args: string[];
}): Promise<string> {
  const directory = assignmentsDir();
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const assignmentPath = join(directory, `${input.name}.md`);
  const windows = platform() === "win32";
  // `.command` is executed by Terminal.app when it is opened; PowerShell only runs `.ps1`.
  const scriptPath = join(
    directory,
    `${input.name}.${windows ? "ps1" : platform() === "darwin" ? "command" : "sh"}`,
  );

  // The same file per project and task: relaunch rewrites instead of accumulating. Without this,
  // `~/.panoma/assignments` would grow by a couple of files per click and forever.
  await writeFile(assignmentPath, `${input.assignment}\n`, { mode: 0o600 });

  const script = composeScript({
    root: input.root,
    assignmentPath,
    command: input.command,
    args: input.args,
    ...(windows ? { shell: "powershell" as const } : {}),
  });

  // The mode goes in the creation, not in a later `chmod`: between the two things there is an
  // instant with the file in 0644. Same rule as in `credentials.ts`.
  const handle = await openFile(scriptPath, "w", 0o700);
  try {
    await handle.writeFile(script, "utf8");
  } finally {
    await handle.close();
  }
  // In case the file already existed from a previous release: `open` keeps the old mode.
  await chmod(scriptPath, 0o700).catch(() => {});

  return scriptPath;
}
