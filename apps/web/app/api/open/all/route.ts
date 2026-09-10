import { stat } from "node:fs/promises";
import { getOpenContext, saveOpenPlan } from "@panoma/db";
import type { Runbook } from "@panoma/core";
import { db } from "@/lib/db";
import { appIsReady } from "@/lib/apps";
import { VIDEO_ACTION_KEY } from "@/lib/apps-view";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { localeFrom, t, type Locale, type MessageKey } from "@/lib/i18n";
import {
  linkCandidates,
  normalizePlan,
  planFromKeys,
  readPlan,
  resolvePlan,
  stepDisplayName,
  suggestPlan,
  CUSTOM_LINK_KEY,
  EDITOR_LABELS,
  MAX_STEPS,
  TERMINAL_KEY,
  FOLDER_KEY,
  type Candidate,
  type OpenPlan,
  type PlanProblem,
} from "@/lib/open-all";
import {
  agentsOf,
  editorsFor,
  folderAvailable,
  installedApps,
  installedEditors,
  openAgent,
  openApp,
  openEditor,
  openFolder,
  openLink,
  openTerminal,
  terminalAvailable,
  type LaunchOutcome,
} from "@/lib/open-targets";

/**
 * "Open everything": the plan of a project, and the click that runs it.
 *
 * `GET` answers what this project could open —the tools installed here and the links the catalog
 * holds—, the plan the owner saved, and the suggestion for when there is none. `POST` saves a plan
 * or runs one. The rules of `/api/open` hold here unchanged, and one more is added on top:
 *
 * **Nothing that gets opened or executed travels in the run request.** The body of a run carries
 * an id and, at most, a list of keys chosen among what this very route offered. The addresses come
 * from the catalog; the one command a terminal step may carry comes from the plan stored in the
 * catalog, where the owner put it through the save action, which carries the same two guards.
 * A run cannot be handed a command or an address, and that is what keeps "open everything" at the
 * trust level of "open in Cursor" instead of turning it into "run what the page says".
 *
 * The steps run in the order the plan lists them, one after the other, so that the windows land
 * in that order and the last one ends up on top. A step that fails does not stop the rest: the
 * answer says, step by step, what opened and what did not, and why.
 */

/** What "is this machine's" means for every tool step, in one list. */
async function toolCandidates(request: Request, locale: Locale): Promise<Candidate[]> {
  const order = editorsFor(request);
  const editors = await installedEditors();
  const out: Candidate[] = order
    .filter((editor) => editors.has(editor))
    .map((editor) => ({
      key: `editor:${editor}`,
      kind: "editor",
      name: EDITOR_LABELS[editor] ?? editor,
      icon: editor,
    }));

  for (const app of await installedApps()) {
    out.push({
      key: `desktop:${app.id}`,
      kind: "desktop",
      name: app.name,
      detail: t(locale, "catalog.appSub"),
      icon: app.id,
    });
  }

  for (const agent of await agentsOf()) {
    if (agent.broken || !agent.installed) continue;
    out.push({
      key: `agent:${agent.provider.id}`,
      kind: "agent",
      name: agent.provider.name,
      detail: t(locale, "catalog.agentSub"),
      icon: agent.provider.id,
    });
  }

  if (terminalAvailable()) {
    out.push({
      key: TERMINAL_KEY,
      kind: "terminal",
      name: t(locale, "catalog.terminal"),
      detail: t(locale, "catalog.terminalSub"),
    });
  }
  if (folderAvailable()) {
    out.push({
      key: FOLDER_KEY,
      kind: "folder",
      name: t(locale, "catalog.folder"),
      detail: t(locale, "catalog.folderSub"),
    });
  }
  return out;
}

type Context = NonNullable<Awaited<ReturnType<typeof getOpenContext>>>;

/** Everything a project could open today: the links first, the tools after. */
async function candidatesFor(context: Context, request: Request, locale: Locale) {
  const accounts = Array.isArray(context.decision?.accounts)
    ? (context.decision!.accounts as { label: string; url?: string }[])
    : [];
  /*
    The app's optional step. It asks the catalog row and nothing else: an app whose files cannot be
    read must drop its own step, never take the whole answer down with it, and measuring what it
    occupies is the app page's business rather than this one's.
   */
  const actions: Candidate[] = context.project.identity && await appIsReady("panoma-video")
    ? [{ key: VIDEO_ACTION_KEY, kind: "app", name: t(locale, "apps.createVideo"), detail: "panoma video" }]
    : [];
  return [
    ...linkCandidates({
      links: context.links,
      distributions: context.distributions,
      accounts,
      gitRemoteUrl: context.project.gitRemoteUrl,
    }),
    ...(await toolCandidates(request, locale)),
    ...actions,
  ];
}

/**
 * What each key is called in the reader's language, for a step whose candidate is gone.
 *
 * Only the three that have no name of their own: an editor, an app or a link carry theirs in the
 * step or in `stepDisplayName`'s tables. It is built per request because it is language.
 */
function labelsFor(locale: Locale): Record<string, string> {
  return {
    [TERMINAL_KEY]: t(locale, "catalog.terminal"),
    [FOLDER_KEY]: t(locale, "catalog.folder"),
    "link:remote": t(locale, "openAll.sourceRemote"),
    // Without this the step of a plan whose app is no longer ready is announced by its raw key.
    [VIDEO_ACTION_KEY]: t(locale, "apps.createVideo"),
  };
}

/** The project's own start command, if it declares one: what the configurator offers to fill in. */
function startCommandOf(runbook: unknown): string | undefined {
  const commands = (runbook as Runbook | null)?.commands;
  if (!Array.isArray(commands)) return undefined;
  return commands.find((command) => command.purpose === "start")?.command;
}

export async function GET(request: Request) {
  /*
    Exempt from `localOperatorOnly` for the same reason as `GET /api/open`: it lists what is
    installed —probing the agents with `--version`, cached a minute— and what the catalog knows,
    and executes nothing. `sameOrigin` stays: the inventory of this machine and the links of a
    project are not for the tab next door.
   */
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  if (process.env["DATABASE_URL"]) {
    return Response.json({
      remote: true,
      canSave: false,
      plan: null,
      startCommand: null,
      candidates: [],
    });
  }

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: t(locale, "api.missingId") }, { status: 400 });

  const { db: database } = await db();
  const context = await getOpenContext(database, id);
  if (!context) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  const candidates = await candidatesFor(context, request, locale);
  /*
    No `suggested` field: the dialog computes the suggestion itself, because the tool the owner
    opens by habit lives in that browser's `localStorage` and this server cannot see it. Sending a
    second suggestion that nobody reads is a figure that ages. `panoma open --all` on a project
    with no plan uses the one below, which ends with the first installed editor, and the terminal
    says so in its own line.
   */
  return Response.json({
    remote: false,
    /* Without a repository there is nowhere to hang the plan; the button has to say so. */
    canSave: Boolean(context.project.identity),
    plan: readPlan(context.decision?.openPlan),
    startCommand: startCommandOf(context.project.runbook) ?? null,
    candidates,
  });
}

const PROBLEM_KEY: Record<PlanProblem, MessageKey> = {
  notAPlan: "openAll.badPlan",
  tooManySteps: "openAll.badPlanTooMany",
  empty: "openAll.emptyPlan",
  badKey: "openAll.badPlanKey",
  commandWhere: "openAll.badPlanCommand",
  commandTooLong: "openAll.badPlanCommand",
  urlWhere: "openAll.badPlanKey",
  badUrl: "openAll.badPlanUrl",
};

export interface StepOutcome {
  key: string;
  name: string;
  ok: boolean;
  /** On failure, the two halves already joined: what failed and how to fix it. */
  error?: string;
}

/**
 * One step, to the launcher that knows how to open it.
 *
 * The step carries a key and the candidate the server resolved for it; what reaches a launcher is
 * the project's root from the catalog, an id validated against a closed list, and —for a terminal
 * step— the command the owner stored. Custom links carry their address, validated on save and
 * checked again by `openLink`.
 */
async function launch(
  root: string,
  order: string[],
  step: { key: string; command?: string; url?: string; label?: string },
  candidate: Candidate | undefined,
  locale: Locale,
): Promise<LaunchOutcome> {
  const [kind, id] = step.key.split(":", 2) as [string, string | undefined];
  if (candidate?.kind === "link" || step.key === CUSTOM_LINK_KEY) {
    const url = candidate?.url ?? step.url ?? "";
    return openLink(url, locale);
  }
  switch (kind) {
    case "editor":
      return openEditor(root, order, id, locale);
    case "desktop":
      return openApp(root, id, locale);
    case "agent":
      return openAgent(root, id, locale);
    case "terminal":
      return openTerminal(root, step.command, locale);
    case "folder":
      return openFolder(root, locale);
    default:
      return { ok: false, status: 400, error: t(locale, "openAll.badPlanKey") };
  }
}

/** A breath between launches, so that the windows arrive in the order of the plan. */
const BETWEEN_STEPS_MS = 150;

export async function POST(request: Request) {
  /*
    Both keys, like `POST /api/open`: this starts editors, terminals, agents and a browser on the
    computer that serves the catalog, and saving a plan is deciding what the next click starts.
   */
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "api.localOnly", { action: t(locale, "api.action.openAll") }) },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    action?: string;
    /** With `save`: the plan, or `null` to go back to the suggestion. */
    plan?: unknown;
    /** With `run`, and only for a project whose plan cannot be saved: keys among the candidates. */
    keys?: unknown;
  };

  if (!body.id) return Response.json({ error: t(locale, "api.missingId") }, { status: 400 });
  const action = body.action ?? "run";
  if (action !== "save" && action !== "run") {
    return Response.json({ error: t(locale, "openAll.unknownAction", { action }) }, { status: 400 });
  }

  const { db: database } = await db();
  const context = await getOpenContext(database, body.id);
  if (!context) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  if (action === "save") {
    if (body.plan === null) {
      const saved = await saveOpenPlan(database, context.project.id, null);
      return Response.json({ ok: true, saved, plan: null });
    }
    const result = normalizePlan(body.plan);
    if (!result.ok) {
      return Response.json(
        { error: t(locale, PROBLEM_KEY[result.problem], { n: MAX_STEPS }), at: result.at ?? null },
        { status: 400 },
      );
    }
    const saved = await saveOpenPlan(database, context.project.id, result.plan);
    return Response.json({ ok: true, saved, plan: result.plan });
  }

  // Folders are moved and deleted, and the catalog doesn't notice until the next scan.
  try {
    const info = await stat(context.project.root);
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch {
    return Response.json(
      {
        error: t(locale, "open.gone", { root: context.project.root }),
        hint: t(locale, "open.goneHint"),
      },
      { status: 410 },
    );
  }

  const candidates = await candidatesFor(context, request, locale);
  const saved = readPlan(context.decision?.openPlan);
  /*
    Where the plan comes from, said in the answer: the stored one, a selection of keys the browser
    made among the candidates, or the suggestion. The terminal prints it, because "opened the
    suggested set" is the line that tells someone the plan is still theirs to write.
   */
  const source: "saved" | "picked" | "suggested" = saved
    ? "saved"
    : Array.isArray(body.keys)
      ? "picked"
      : "suggested";
  const plan: OpenPlan =
    saved ??
    (Array.isArray(body.keys)
      ? planFromKeys(body.keys as string[], candidates)
      : suggestPlan(candidates));

  const { steps, missing } = resolvePlan(plan, candidates);
  if (steps.length === 0 && missing.length === 0) {
    return Response.json({ error: t(locale, "openAll.emptyPlan") }, { status: 400 });
  }

  const order = editorsFor(request);
  const labels = labelsFor(locale);
  const outcomes: StepOutcome[] = [];
  for (const [index, { step, candidate }] of steps.entries()) {
    const name = stepDisplayName(step, candidate, labels);
    const outcome = step.key === VIDEO_ACTION_KEY
      ? await openLink(new URL(`/p/${encodeURIComponent(context.project.slug)}/video`, request.url).href, locale)
      : await launch(context.project.root, order, step, candidate, locale);
    outcomes.push(
      outcome.ok
        ? { key: step.key, name, ok: true }
        : { key: step.key, name, ok: false, error: [outcome.error, outcome.hint].filter(Boolean).join(" ") },
    );
    if (index < steps.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, BETWEEN_STEPS_MS));
    }
  }
  /*
    The name goes in its own field —the terminal and the notice both print it in front— and the
    reason distinguishes the two ways of going missing. "No longer on this machine" is true of a
    tool that was uninstalled and false of an account link the owner deleted: the machine did not
    change there, the project did, and sending someone to look for a program that was never the
    problem is worse than saying nothing.
   */
  for (const step of missing) {
    outcomes.push({
      key: step.key,
      name: stepDisplayName(step, undefined, labels),
      ok: false,
      error: t(locale, step.key.startsWith("link:") ? "openAll.missingLink" : "openAll.missing"),
    });
  }

  const opened = outcomes.filter((outcome) => outcome.ok).length;
  return Response.json({
    ok: true,
    source,
    root: context.project.root,
    name: context.project.name,
    opened,
    total: outcomes.length,
    outcomes,
  });
}
