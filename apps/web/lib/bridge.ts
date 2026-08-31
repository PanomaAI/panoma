import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readConfig, providersByAuth } from "@panoma/ai";
import { listProjectRoots, bridgeCounts, type Database } from "@panoma/db";
import { watchState } from "@/lib/watch";

/*
  The command bridge: the status of each piece of Panoma, and the next indicated step.
  It exists by a measured number, not by intuition: quorum mining found a catalog with 76
  projects, nine built agent tools… and zero usage — a key created and never used, the empty log.
  The reason was exactly this screen not existing: turning on Panoma was guessing commands, screen
  by screen, and what needs to be guessed does not turn on. The bridge brings together in one
  place what is alive, what is missing, and what needs to be done NOW — a single 'next step' at a
  time, not a list of tasks.
  Everything you see here is cheap on purpose: counting rows, reading a small file per project,
  looking at the already loaded configuration. Nothing starts processes or pays for calls — a
  health screen that costs health does not open twice.
 */

/**
 * The same brand that `panoma hooks` plant: see their comment — it is being looked for, it does
 * not look alike.
 */
const HOOKS_BRAND = "# panoma-hooks";

export interface BridgeReport {
  catalog: { projects: number; watcherActive: boolean };
  model: { active: string | null; envKeys: number };
  agents: { keys: number; connected: number };
  hooks: { checked: number; installed: number; installable: number };
  memory: {
    activities: number;
    approved: number;
    sleeping: number;
    pending: number;
    consultations: number;
  };
  scale: { ablation: boolean };
}

/**
 * Where do the hooks of this root really live? The same that the installer resolves with
 * `git rev-parse --git-path hooks`, but by reading small files instead of launching a process per
 * project — the bridge promises that looking is free. Three cases that the first version ignored
 * and the audit pointed out: a worktree (`.git` is a FILE with `gitdir:` ), its `commondir` (the
 * hooks live in the common repository), and `core.hooksPath` in the configuration, which moves
 * them to anywhere.
 */
async function gitDirOf(root: string): Promise<string> {
  let gitDir = join(root, ".git");
  try {
    const marker = await readFile(gitDir, "utf8");
    const pointed = marker.match(/^gitdir:\s*(.+)\s*$/m)?.[1];
    if (pointed) gitDir = resolve(root, pointed.trim());
  } catch {
    // A directory cannot be read as a file: this is the normal case, `.git/` really.
  }

  try {
    const common = (await readFile(join(gitDir, "commondir"), "utf8")).trim();
    if (common !== "") gitDir = resolve(gitDir, common);
  } catch {
    // Without commondir it is not a worktree: the gitDir is already the common one.
  }
  return gitDir;
}

async function hooksDirOf(root: string): Promise<string> {
  const gitDir = await gitDirOf(root);

  try {
    const config = await readFile(join(gitDir, "config"), "utf8");
    const custom = config.match(/^\s*hooksPath\s*=\s*(.+)\s*$/m)?.[1];
    // Relative, git resolves it against the root of the working tree.
    if (custom) return resolve(root, custom.trim());
  } catch {
    // Without a readable config, there is no hooksPath that works either.
  }
  return join(gitDir, "hooks");
}

/** Does this project have the hook on? The card shows it next to its memory. */
export async function hookInstalledAt(root: string): Promise<boolean> {
  try {
    const hook = await readFile(join(await hooksDirOf(root), "post-commit"), "utf8");
    return hook.includes(HOOKS_BRAND);
  } catch {
    // Without a hook, without .git, or without permission: for the bridge they are the same — it is
    // not there.
    return false;
  }
}

/**
 * Can this project take a hook at all? A folder without git has nowhere to put one.
 *
 * It is asked separately because for a while it was not, and the answer was «for the bridge they
 * are the same — it is not there». They are not the same. A catalog of 76 projects where 44 have
 * git and all 44 carry the hook read «44 of 76», kept the install button on offer, and counted the
 * step as unfinished for ever: the 32 that were missing could never have it, and pressing again
 * would do nothing. A denominator that includes what cannot be done is a number that can never be
 * reached.
 */
async function couldHaveHook(root: string): Promise<boolean> {
  /*
    The git directory itself, and not a path relative to where the hooks ended up: with
    `core.hooksPath` those two are different places, and the first version of this asked next to
    the hooks — so a repository that had moved them answered that it was not a repository.
   */
  const gitDir = await gitDirOf(root);
  return (
    (await stat(gitDir).then(
      (entry) => entry.isDirectory(),
      () => false,
    )) === true
  );
}

/**
 * How many of these projects have the hooks in place, and how many could.
 *
 * `checked` stays as the total, because the card that names it is telling you how much of your
 * catalog this covers. What decides whether the step is done, and whether the button is still
 * worth pressing, is `installable`.
 */
export async function hooksInstalledIn(
  roots: string[],
): Promise<{ checked: number; installed: number; installable: number }> {
  const readings = await Promise.all(
    roots.map(async (root) => ({
      installed: await hookInstalledAt(root),
      possible: await couldHaveHook(root),
    })),
  );
  return {
    checked: roots.length,
    installed: readings.filter((r) => r.installed).length,
    /* A hook that is already there proves its own possibility, whatever the config says. */
    installable: readings.filter((r) => r.possible || r.installed).length,
  };
}

export async function bridgeReport(database: Database): Promise<BridgeReport> {
  const roots = await listProjectRoots(database);

  const counts = await bridgeCounts(database);

  const config = await readConfig().catch(() => undefined);
  const envKeys = providersByAuth("api-key").filter((provider) =>
    (provider.apiKeyEnvVars ?? []).some((name) => process.env[name]),
  ).length;

  const hooks = await hooksInstalledIn(roots.map((project) => project.root));

  return {
    catalog: { projects: roots.length, watcherActive: watchState().active },
    model: { active: config?.provider ?? null, envKeys },
    agents: { keys: counts.agentKeys, connected: counts.agentsConnected },
    hooks,
    memory: {
      activities: counts.activities,
      approved: counts.approved,
      sleeping: counts.sleeping,
      pending: counts.pending,
      consultations: counts.consultations,
    },
    scale: { ablation: process.env["PANOMA_MEMORY_ABLATION"] === "1" || process.env["PANOMA_MEMORY_ABLATION"] === "on" },
  };
}

export type StepState = "done" | "next" | "waiting";

export interface BridgeStep {
  /** The step's short i18n key: `bridge.step.<id>`. */
  id: "catalog" | "model" | "agent" | "hooks" | "alive";
  state: StepState;
  /** The fact that makes the state true, to render it next to the title. */
  detail: { count: number; total?: number };
  /**
   * Whether this is something to do, or something that happens.
   *
   * Four of the five are switched on by the person reading: scan, connect a model, connect an
   * agent, plant the hooks. The journal is not — it fills when an agent working in a project calls
   * `panoma_log`, and there is no button here because there is nothing here to press. Counting it
   * among the pending ones made the frame say «1 step left to switch on» to somebody who had
   * finished everything that was theirs, and pointed them at a screen with no way forward.
   */
  kind: "step" | "consequence";
}

/**
 * The list of steps with ONLY one 'next': the first one that is not done.
 *
 * It is the entire product decision: a health screen with six items pending in red is a to-do
 * list, and to-do lists are closed. A single flagged step is done. Those behind wait in gray,
 * without scolding.
 */
export function bridgeSteps(report: BridgeReport): BridgeStep[] {
  type Condition = {
    id: BridgeStep["id"];
    done: boolean;
    detail: BridgeStep["detail"];
    kind?: BridgeStep["kind"];
  };

  const conditions: Condition[] = [
    { id: "catalog", done: report.catalog.projects > 0, detail: { count: report.catalog.projects } },
    {
      id: "model",
      done: report.model.active !== null || report.model.envKeys > 0,
      detail: { count: report.model.active !== null ? 1 : report.model.envKeys },
    },
    { id: "agent", done: report.agents.connected > 0, detail: { count: report.agents.connected } },
    {
      /*
        Against what can be done, not against the whole catalog. A folder without git has nowhere
        to keep a hook, so counting it in the denominator invents a debt nobody can pay.
       */
      id: "hooks",
      done: report.hooks.installable > 0 && report.hooks.installed >= report.hooks.installable,
      detail: { count: report.hooks.installed, total: report.hooks.installable },
    },
    {
      id: "alive",
      done: report.memory.activities > 0,
      detail: { count: report.memory.activities },
      kind: "consequence",
    },
  ];

  /*
    Only one 'next', and only among the things that are somebody's to do. A consequence that has
    not happened yet waits — it never carries the arrow, because an arrow is an instruction.
   */
  let nextMarked = false;
  return conditions.map((step) => {
    const kind = step.kind ?? "step";
    if (step.done) return { id: step.id, state: "done", detail: step.detail, kind };
    if (kind === "step" && !nextMarked) {
      nextMarked = true;
      return { id: step.id, state: "next", detail: step.detail, kind };
    }
    return { id: step.id, state: "waiting", detail: step.detail, kind };
  });
}

/**
 * What is still off and is somebody's to switch on — the number the frame carries.
 *
 * Consequences are excluded on purpose: the journal fills when an agent logs something, and a
 * catalog whose owner has done all four of their parts should not be told it is one short.
 */
export function bridgePending(steps: BridgeStep[]): number {
  return steps.filter((step) => step.kind === "step" && step.state !== "done").length;
}
