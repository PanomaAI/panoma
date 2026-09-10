import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import * as t from "./schema";
import { getOpenContext, saveOpenPlan, saveProjectAccounts } from "./queries";

/**
 * The plan of "open everything" lives in `decisions` like the accounts, and the two promises are
 * the same: it is written by identity and read back by id, and a project with no identity has
 * nowhere to keep it — which the save says instead of pretending.
 */

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-open-plan-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});

afterAll(async () => {
  await close?.();
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

const WITH_REPO = "proj_plan";
const WITHOUT_REPO = "proj_plan_loose";

beforeEach(async () => {
  await db.delete(t.projectLinks);
  await db.delete(t.decisions);
  await db.delete(t.projects);
  await db.insert(t.projects).values([
    {
      id: WITH_REPO,
      name: "shop",
      slug: "shop",
      root: "/tmp/shop",
      identity: "identity_shop",
      gitRemoteUrl: "https://git.example.com/ana/shop.git",
      runbook: { commands: [{ purpose: "start", command: "pnpm run dev", source: "scripts.dev" }], runtimes: [], missingEnv: [], docs: [] },
    },
    { id: WITHOUT_REPO, name: "notes", slug: "notes", root: "/tmp/notes" },
  ]);
  await db.insert(t.projectLinks).values({
    projectId: WITH_REPO,
    serviceId: "supabase",
    service: "Supabase",
    label: "abc",
    url: "https://supabase.com/dashboard/project/abc",
    kind: "deep",
    evidence: "SUPABASE_URL",
  });
});

describe("the plan of open everything", () => {
  it("is saved by identity and comes back with the links, the accounts and the runbook", async () => {
    await saveProjectAccounts(db, WITH_REPO, [{ label: "Dev", url: "http://localhost:3000" }]);
    const plan = { version: 1, steps: [{ key: "terminal", command: "pnpm run dev" }, { key: "editor:cursor" }] };
    expect(await saveOpenPlan(db, WITH_REPO, plan)).toBe(true);

    const context = await getOpenContext(db, WITH_REPO);
    expect(context?.decision?.openPlan).toEqual(plan);
    expect(context?.decision?.accounts).toEqual([{ label: "Dev", url: "http://localhost:3000" }]);
    expect(context?.links.map((link) => link.serviceId)).toEqual(["supabase"]);
    expect(context?.project.gitRemoteUrl).toBe("https://git.example.com/ana/shop.git");
    expect((context?.project.runbook as { commands: { command: string }[] }).commands[0]!.command).toBe("pnpm run dev");
  });

  it("saving the plan does not touch the accounts next to it, and null removes it", async () => {
    await saveProjectAccounts(db, WITH_REPO, [{ label: "Dev", url: "http://localhost:3000" }]);
    await saveOpenPlan(db, WITH_REPO, { version: 1, steps: [{ key: "folder" }] });
    await saveOpenPlan(db, WITH_REPO, null);
    const context = await getOpenContext(db, WITH_REPO);
    expect(context?.decision?.openPlan).toBeNull();
    expect(context?.decision?.accounts).toEqual([{ label: "Dev", url: "http://localhost:3000" }]);
  });

  it("without an identity there is nowhere to hang it, and the save says so", async () => {
    expect(await saveOpenPlan(db, WITHOUT_REPO, { version: 1, steps: [{ key: "folder" }] })).toBe(false);
    const context = await getOpenContext(db, WITHOUT_REPO);
    expect(context?.decision).toBeNull();
    expect(context?.project.identity).toBeNull();
  });

  it("an unknown id is nobody", async () => {
    expect(await getOpenContext(db, "proj_nope")).toBeUndefined();
  });
});
