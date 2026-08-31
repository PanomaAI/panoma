import { readFile } from "node:fs/promises";
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
  hooks: { checked: number; installed: number };
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
async function hooksDirOf(root: string): Promise<string> {
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

/** How many of these projects have the hooks in place? Small files, in parallel. */
export async function hooksInstalledIn(roots: string[]): Promise<{ checked: number; installed: number }> {
  const readings = await Promise.all(roots.map(hookInstalledAt));
  return { checked: roots.length, installed: readings.filter(Boolean).length };
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
}

/**
 * The list of steps with ONLY one 'next': the first one that is not done.
 *
 * It is the entire product decision: a health screen with six items pending in red is a to-do
 * list, and to-do lists are closed. A single flagged step is done. Those behind wait in gray,
 * without scolding.
 */
export function bridgeSteps(report: BridgeReport): BridgeStep[] {
  const conditions: { id: BridgeStep["id"]; done: boolean; detail: BridgeStep["detail"] }[] = [
    { id: "catalog", done: report.catalog.projects > 0, detail: { count: report.catalog.projects } },
    {
      id: "model",
      done: report.model.active !== null || report.model.envKeys > 0,
      detail: { count: report.model.active !== null ? 1 : report.model.envKeys },
    },
    { id: "agent", done: report.agents.connected > 0, detail: { count: report.agents.connected } },
    {
      id: "hooks",
      done: report.hooks.installed > 0,
      detail: { count: report.hooks.installed, total: report.hooks.checked },
    },
    {
      id: "alive",
      done: report.memory.activities > 0,
      detail: { count: report.memory.activities },
    },
  ];

  let nextMarked = false;
  return conditions.map((step) => {
    if (step.done) return { id: step.id, state: "done", detail: step.detail };
    if (!nextMarked) {
      nextMarked = true;
      return { id: step.id, state: "next", detail: step.detail };
    }
    return { id: step.id, state: "waiting", detail: step.detail };
  });
}
