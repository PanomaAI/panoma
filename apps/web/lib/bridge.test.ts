import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gitScanOrder, managedHooks, postCommitScript, settingsText } from "@panoma/core";
import { hookStateAt, hooksInstalledIn, bridgePending, bridgeProgress, bridgeSteps, type BridgeReport } from "./bridge";

/**
 * The bridge is tested by its two decisions: that detecting the hooks is truly reading the disk,
 * and that the list has ONLY one 'next' — the entire screen exists so that turning on is not a
 * list of tasks.
 *
 * Since 14-Sep-2026 "installed" means more than "the brand is there": it means the command the
 * hook names exists on this disk, and, where a Claude Code settings file exists, that the four
 * events carry their current identity. The 556 exit-127 hook runs measured that day all had the
 * brand; what they lacked was a command a PATH-less shell could find. So the fixtures below name
 * a real interpreter and a real file, and the one that names a bare `panoma` is the legacy case.
 */

/** A command that exists on every machine the tests run on: node, and this very file. */
const ARGV = [process.execPath, fileURLToPath(import.meta.url)];
const API = "http://127.0.0.1:4173";

let withHook: string;
let legacy: string;
let without: string;

beforeAll(async () => {
  withHook = await mkdtemp(join(tmpdir(), "panoma-bridge-a-"));
  legacy = await mkdtemp(join(tmpdir(), "panoma-bridge-l-"));
  without = await mkdtemp(join(tmpdir(), "panoma-bridge-b-"));
  await mkdir(join(withHook, ".git", "hooks"), { recursive: true });
  await writeFile(join(withHook, ".git", "hooks", "post-commit"), postCommitScript(gitScanOrder(ARGV, API)));
  await mkdir(join(legacy, ".git", "hooks"), { recursive: true });
  await writeFile(join(legacy, ".git", "hooks", "post-commit"), "#!/bin/sh\npanoma scan . --save  # panoma-hooks\n");
  await mkdir(join(without, ".git", "hooks"), { recursive: true });
  await writeFile(join(without, ".git", "hooks", "post-commit"), "#!/bin/sh\ndeploy-de-otro\n");
});

afterAll(async () => {
  await rm(withHook, { recursive: true, force: true });
  await rm(legacy, { recursive: true, force: true });
  await rm(without, { recursive: true, force: true });
});

describe("detectar los ganchos", () => {
  it("cuenta por la marca, no por existir: el gancho de otro no es el nuestro", async () => {
    const result = await hooksInstalledIn([withHook, legacy, without, "/no/existe"]);
    /*
      `without` has git and somebody else's hook: installable and not installed. `legacy` has our
      brand over a bare `panoma`, which no hook shell can find: installable, not installed either.
     */
    expect(result).toEqual({ checked: 4, installed: 1, installable: 3 });
  });

  it("reads the three evidences apart: brand, identity per event, and a command that exists", async () => {
    expect(await hookStateAt(legacy)).toEqual({
      postCommit: true,
      events: { Stop: "missing", PreToolUse: "missing", SessionStart: "missing", SessionEnd: "missing" },
      durable: false,
      settingsFile: false,
    });
    expect(await hookStateAt(without)).toMatchObject({ postCommit: false, durable: null, settingsFile: false });
    expect(await hookStateAt("/no/existe")).toMatchObject({ postCommit: false, durable: null });
  });

  it("with a Claude Code settings file, installed means the four events with their identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "panoma-bridge-s-"));
    try {
      await mkdir(join(root, ".git", "hooks"), { recursive: true });
      await mkdir(join(root, ".claude"), { recursive: true });
      await writeFile(join(root, ".git", "hooks", "post-commit"), postCommitScript(gitScanOrder(ARGV, API)));
      const hooks = managedHooks(ARGV, root, API);
      const settings = join(root, ".claude", "settings.local.json");

      /* Only the two old events, written with the old bare brand: legacy, installable, not installed. */
      await writeFile(
        settings,
        settingsText({
          hooks: {
            Stop: [{ hooks: [{ type: "command", command: "panoma scan /r --save  # panoma-hooks" }] }],
            PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "panoma signal /r  # panoma-hooks" }] }],
          },
        }),
      );
      expect(await hookStateAt(root)).toMatchObject({
        postCommit: true,
        events: { Stop: "legacy", PreToolUse: "legacy", SessionStart: "missing", SessionEnd: "missing" },
        durable: false,
        settingsFile: true,
      });
      expect(await hooksInstalledIn([root])).toEqual({ checked: 1, installed: 0, installable: 1 });

      /* Two of the four current ones: not installed yet. */
      await writeFile(
        settings,
        settingsText({ hooks: { Stop: [{ hooks: [{ type: "command", command: hooks[0]!.command }] }], SessionEnd: [{ hooks: [{ type: "command", command: hooks[3]!.command }] }] } }),
      );
      expect((await hookStateAt(root)).events).toEqual({ Stop: "installed", PreToolUse: "missing", SessionStart: "missing", SessionEnd: "installed" });
      expect((await hooksInstalledIn([root])).installed).toBe(0);

      /* The four, as the installer writes them: installed. */
      await writeFile(
        settings,
        settingsText({
          hooks: Object.fromEntries(hooks.map((hook) => [hook.event, [{ ...(hook.matcher ? { matcher: hook.matcher } : {}), hooks: [{ type: "command", command: hook.command }] }]])),
        }),
      );
      expect(await hookStateAt(root)).toMatchObject({
        events: { Stop: "installed", PreToolUse: "installed", SessionStart: "installed", SessionEnd: "installed" },
        durable: true,
      });
      expect(await hooksInstalledIn([root])).toEqual({ checked: 1, installed: 1, installable: 1 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("encuentra los ganchos donde git los tenga: core.hooksPath y worktrees incluidos", async () => {
    // The audit pointed it out: the installer resolves the actual site with git, and the bridge
    // looked at `.git/hooks` raw — a project with hooksPath came out as 'without a hook' even
    // having it set.
    const custom = await mkdtemp(join(tmpdir(), "panoma-bridge-c-"));
    const tree = await mkdtemp(join(tmpdir(), "panoma-bridge-w-"));
    try {
      // core.hooksPath relative to the root of the tree.
      await mkdir(join(custom, ".git"), { recursive: true });
      await mkdir(join(custom, "mis-ganchos"), { recursive: true });
      await writeFile(join(custom, ".git", "config"), "[core]\n\thooksPath = mis-ganchos\n");
      await writeFile(join(custom, "mis-ganchos", "post-commit"), postCommitScript(gitScanOrder(ARGV, API)));

      // A worktree: `.git` is a FILE, and the hooks reside in the common repository.
      const main = join(tree, "principal");
      const linked = join(tree, "rama");
      await mkdir(join(main, ".git", "hooks"), { recursive: true });
      await mkdir(join(main, ".git", "worktrees", "rama"), { recursive: true });
      await writeFile(join(main, ".git", "hooks", "post-commit"), postCommitScript(gitScanOrder(ARGV, API)));
      await mkdir(linked, { recursive: true });
      await writeFile(join(linked, ".git"), `gitdir: ${join(main, ".git", "worktrees", "rama")}\n`);
      await writeFile(join(main, ".git", "worktrees", "rama", "commondir"), "../..\n");

      expect(await hooksInstalledIn([custom, linked])).toEqual({ checked: 2, installed: 2, installable: 2 });
    } finally {
      await rm(custom, { recursive: true, force: true });
      await rm(tree, { recursive: true, force: true });
    }
  });
});

describe("un solo siguiente", () => {
  function report(overrides: Partial<BridgeReport> = {}): BridgeReport {
    return {
      catalog: { projects: 5, watcherActive: true },
      model: { active: null, envKeys: 0 },
      agents: { keys: 0, connected: 0 },
      hooks: { checked: 5, installed: 0, installable: 5 },
      memory: { activities: 0, approved: 0, sleeping: 0, pending: 0, consultations: 0 },
      scale: { ablation: false },
      ...overrides,
    };
  }

  it("el primero sin hacer lleva la flecha; los demás esperan en gris", () => {
    const steps = bridgeSteps(report());
    expect(steps.map((s) => s.state)).toEqual(["done", "next", "waiting", "waiting", "waiting"]);
  });

  it("al resolver un paso, la flecha avanza sola al siguiente", () => {
    const steps = bridgeSteps(report({ model: { active: "anthropic", envKeys: 0 } }));
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "next", "waiting", "waiting"]);
  });

  it("con todo en marcha, todo en verde — y la clave sin usar no cuenta como conectado", () => {
    const ready = bridgeSteps(
      report({
        model: { active: "anthropic", envKeys: 0 },
        agents: { keys: 1, connected: 1 },
        hooks: { checked: 5, installed: 5, installable: 5 },
        memory: { activities: 12, approved: 3, sleeping: 1, pending: 2, consultations: 4 },
      }),
    );
    expect(ready.every((s) => s.state === "done")).toBe(true);

    const keyOnly = bridgeSteps(report({ model: { active: "anthropic", envKeys: 0 }, agents: { keys: 1, connected: 0 } }));
    expect(keyOnly[2]?.state).toBe("next");
  });
});

/*
  A real catalog: 76 projects, 44 of them with git, and the hook in all 44. It read «44 of 76»,
  kept offering the button, and counted the step as unfinished — for ever, because the 32 without
  git can never take one.
 */
describe("los ganchos se cuentan contra lo que se puede", () => {
  function report(hooks: BridgeReport["hooks"]): BridgeReport {
    return {
      catalog: { projects: 76, watcherActive: true },
      model: { active: "anthropic", envKeys: 0 },
      agents: { keys: 1, connected: 1 },
      hooks,
      memory: { activities: 0, approved: 0, sleeping: 0, pending: 0, consultations: 0 },
      scale: { ablation: false },
    };
  }

  it("con el gancho en todo lo que puede llevarlo, el paso está hecho", () => {
    const step = bridgeSteps(report({ checked: 76, installed: 44, installable: 44 }))[3]!;
    expect(step.state).toBe("done");
    expect(step.detail).toEqual({ count: 44, total: 44 });
  });

  it("y si falta alguno de los que sí pueden, sigue pendiente", () => {
    expect(bridgeSteps(report({ checked: 76, installed: 43, installable: 44 }))[3]!.state).not.toBe("done");
  });

  it("un catálogo entero sin git no deja el paso hecho por vacío", () => {
    expect(bridgeSteps(report({ checked: 76, installed: 0, installable: 0 }))[3]!.state).not.toBe("done");
  });
});

/*
  And the journal, which is not anybody's to press. It fills when an agent calls `panoma_log`, so
  it never carries the arrow and it is not counted among what is left to switch on: a catalog whose
  owner has done all four of their parts was being told it was one short, and sent to a screen with
  nothing to do on it.
 */
describe("la bitácora es consecuencia, no paso", () => {
  function report(activities: number): BridgeReport {
    return {
      catalog: { projects: 5, watcherActive: true },
      model: { active: "anthropic", envKeys: 0 },
      agents: { keys: 1, connected: 1 },
      hooks: { checked: 5, installed: 5, installable: 5 },
      memory: { activities, approved: 0, sleeping: 0, pending: 0, consultations: 0 },
      scale: { ablation: false },
    };
  }

  it("con todo lo del usuario hecho, no queda nada por encender", () => {
    const steps = bridgeSteps(report(0));
    expect(bridgePending(steps)).toBe(0);
    expect(steps[4]!.kind).toBe("consequence");
  });

  it("reports setup ready even before the first journal entry", () => {
    const progress = bridgeProgress(bridgeSteps(report(0)));

    expect(progress.setupSteps.map((step) => step.id)).toEqual(["catalog", "model", "agent", "hooks"]);
    expect(progress).toMatchObject({ completed: 4, total: 4, pending: 0, ready: true });
    expect(progress.next).toBeUndefined();
    expect(bridgeProgress(bridgeSteps(report(12)))).toEqual(progress);
  });

  it("reports only the first unfinished setup step as next", () => {
    const steps = bridgeSteps({
      ...report(0),
      model: { active: null, envKeys: 0 },
      agents: { keys: 1, connected: 0 },
      hooks: { checked: 5, installed: 0, installable: 5 },
    });
    const progress = bridgeProgress(steps);

    expect(progress).toMatchObject({ completed: 1, total: 4, pending: 3, ready: false });
    expect(progress.next?.id).toBe("model");
    expect(progress.setupSteps.filter((step) => step.state === "next")).toEqual([progress.next]);
    expect(progress.pending).toBe(bridgePending(steps));
  });

  it("y nunca lleva la flecha, porque una flecha es una instrucción", () => {
    expect(bridgeSteps(report(0))[4]!.state).toBe("waiting");
  });

  it("lo que sí es del usuario sigue contando", () => {
    const steps = bridgeSteps({ ...report(0), agents: { keys: 1, connected: 0 } });
    expect(bridgePending(steps)).toBe(1);
  });
});
