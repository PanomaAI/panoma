import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hooksInstalledIn, bridgePending, bridgeSteps, type BridgeReport } from "./bridge";

/**
 * The bridge is tested by its two decisions: that detecting the hooks is truly reading the disk,
 * and that the list has ONLY one 'next' — the entire screen exists so that turning on is not a
 * list of tasks.
 */

let withHook: string;
let without: string;

beforeAll(async () => {
  withHook = await mkdtemp(join(tmpdir(), "panoma-bridge-a-"));
  without = await mkdtemp(join(tmpdir(), "panoma-bridge-b-"));
  await mkdir(join(withHook, ".git", "hooks"), { recursive: true });
  await writeFile(join(withHook, ".git", "hooks", "post-commit"), "#!/bin/sh\npanoma scan . --save  # panoma-hooks\n");
  await mkdir(join(without, ".git", "hooks"), { recursive: true });
  await writeFile(join(without, ".git", "hooks", "post-commit"), "#!/bin/sh\ndeploy-de-otro\n");
});

afterAll(async () => {
  await rm(withHook, { recursive: true, force: true });
  await rm(without, { recursive: true, force: true });
});

describe("detectar los ganchos", () => {
  it("cuenta por la marca, no por existir: el gancho de otro no es el nuestro", async () => {
    const result = await hooksInstalledIn([withHook, without, "/no/existe"]);
    /* `without` has git and somebody else's hook: it counts as installable and not installed. */
    expect(result).toEqual({ checked: 3, installed: 1, installable: 2 });
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
      await writeFile(join(custom, "mis-ganchos", "post-commit"), "#!/bin/sh\n# panoma-hooks\n");

      // A worktree: `.git` is a FILE, and the hooks reside in the common repository.
      const main = join(tree, "principal");
      const linked = join(tree, "rama");
      await mkdir(join(main, ".git", "hooks"), { recursive: true });
      await mkdir(join(main, ".git", "worktrees", "rama"), { recursive: true });
      await writeFile(join(main, ".git", "hooks", "post-commit"), "#!/bin/sh\n# panoma-hooks\n");
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

  it("y nunca lleva la flecha, porque una flecha es una instrucción", () => {
    expect(bridgeSteps(report(0))[4]!.state).toBe("waiting");
  });

  it("lo que sí es del usuario sigue contando", () => {
    const steps = bridgeSteps({ ...report(0), agents: { keys: 1, connected: 0 } });
    expect(bridgePending(steps)).toBe(1);
  });
});
