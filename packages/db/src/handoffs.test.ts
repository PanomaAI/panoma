import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { REDACTED } from "@panoma/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import { findHandoff, getHandoff, listHandoffs, listProjectHandoffs, recordHandoff } from "./handoffs";
import type { NewHandoff } from "./handoffs";
import * as t from "./schema";

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const originalHome = process.env.PANOMA_HOME;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-handoff-db-"));
  process.env.PANOMA_HOME = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});
afterAll(async () => {
  await close?.();
  if (originalHome === undefined) delete process.env.PANOMA_HOME;
  else process.env.PANOMA_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});
beforeEach(async () => {
  // Receipts outlive their project (`set null`), so they are wiped before the parent.
  await db.delete(t.handoffs);
  await db.delete(t.projects);
  await db.insert(t.projects).values([
    { id: "project", slug: "project", name: "Project", root: "/tmp/project", identity: "git:project" },
    { id: "other", slug: "other", name: "Other", root: "/tmp/other", identity: "git:other" },
  ]);
});

const HASH = "a".repeat(64);

function receipt(overrides: Partial<NewHandoff> = {}): NewHandoff {
  return {
    projectId: "project",
    cwd: "/tmp/project",
    title: "Wire the login flow",
    sourceAgent: "claude-cli",
    sourceSessionId: "a3f19c2e-0000-4000-8000-000000000001",
    sourcePath: "/tmp/claude/projects/-tmp-project/a3f19c2e.jsonl",
    sourceHash: HASH,
    targetAgent: "codex-cli",
    targetSessionId: "0d5c7a1e-0000-4000-8000-000000000002",
    targetPath: "/tmp/codex/sessions/2026/09/11/rollout-2026-09-11T10-00-00-0d5c7a1e.jsonl",
    tier: "full",
    turns: 12,
    bytes: 40_960,
    resumeCommand: "cd '/tmp/project' && codex resume 0d5c7a1e-0000-4000-8000-000000000002",
    ...overrides,
  };
}

describe("handoff receipts", () => {
  it("records a receipt with a `hnd_` id, every column, and the dropped default when none is given", async () => {
    const row = await recordHandoff(db, receipt());
    expect(row.id).toMatch(/^hnd_[A-Za-z0-9_-]{12}$/);
    expect(row.projectId).toBe("project");
    expect(row.cwd).toBe("/tmp/project");
    expect(row.title).toBe("Wire the login flow");
    expect(row.sourceAgent).toBe("claude-cli");
    expect(row.targetAgent).toBe("codex-cli");
    expect(row.tier).toBe("full");
    expect(row.turns).toBe(12);
    expect(row.bytes).toBe(40_960);
    expect(row.dropped).toEqual({ thinking: 0, images: 0, subagents: 0, offloaded: 0, secrets: 0, other: 0 });
    expect(row.resumeCommand).toContain("codex resume");
    // A person asked: nobody is named. The agent channel is the one that fills this in.
    expect(row.requestedBy).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);

    const stored = await getHandoff(db, row.id);
    expect(stored).toEqual(row);
  });

  it("keeps the name of the agent that asked over the channel, and every select returns it", async () => {
    const row = await recordHandoff(db, receipt({ requestedBy: "claude-code" }));
    expect(row.requestedBy).toBe("claude-code");
    expect((await getHandoff(db, row.id))?.requestedBy).toBe("claude-code");
    expect((await listHandoffs(db))[0]?.requestedBy).toBe("claude-code");
    expect((await listProjectHandoffs(db, "project"))[0]?.requestedBy).toBe("claude-code");
    expect((await findHandoff(db, HASH, "codex-cli"))?.requestedBy).toBe("claude-code");
    // Said outright as null, the same as absent.
    expect((await recordHandoff(db, receipt({ requestedBy: null }))).requestedBy).toBeNull();
  });

  it("keeps the dropped counts it is given", async () => {
    const dropped = { thinking: 3, images: 1, subagents: 2, offloaded: 0, secrets: 4, other: 0 };
    const row = await recordHandoff(db, receipt({ dropped, tier: "compact" }));
    expect((await getHandoff(db, row.id))?.dropped).toEqual(dropped);
    expect((await getHandoff(db, row.id))?.tier).toBe("compact");
  });

  it("redacts a secret in the title before storing it", async () => {
    const key = `sk-ant-${"k".repeat(40)}`;
    const row = await recordHandoff(db, receipt({ title: `Rotate ${key} in the deploy` }));
    expect(row.title).toBe(`Rotate ${REDACTED} in the deploy`);
    expect(row.title).not.toContain(key);
    expect((await getHandoff(db, row.id))?.title).not.toContain(key);
  });

  it("accepts a receipt without a project, a title or a resume line", async () => {
    const row = await recordHandoff(db, receipt({ projectId: null, title: null, resumeCommand: null, tier: "brief" }));
    expect(row.projectId).toBeNull();
    expect(row.title).toBeNull();
    expect(row.resumeCommand).toBeNull();
    const [listed] = await listHandoffs(db);
    expect(listed?.projectSlug).toBeNull();
  });

  it("lists newest first with the project slug, and honours the limit", async () => {
    const first = await recordHandoff(db, receipt({ targetAgent: "codex-cli" }));
    await db.update(t.handoffs).set({ createdAt: new Date("2026-09-10T10:00:00Z") }).where(eq(t.handoffs.id, first.id));
    const second = await recordHandoff(db, receipt({ targetAgent: "opencode", projectId: "other" }));
    await db.update(t.handoffs).set({ createdAt: new Date("2026-09-11T10:00:00Z") }).where(eq(t.handoffs.id, second.id));
    const third = await recordHandoff(db, receipt({ targetAgent: "gemini-cli", projectId: null }));
    await db.update(t.handoffs).set({ createdAt: new Date("2026-09-12T10:00:00Z") }).where(eq(t.handoffs.id, third.id));

    const all = await listHandoffs(db);
    expect(all.map((row) => row.id)).toEqual([third.id, second.id, first.id]);
    expect(all.map((row) => row.projectSlug)).toEqual([null, "other", "project"]);

    const limited = await listHandoffs(db, 2);
    expect(limited.map((row) => row.id)).toEqual([third.id, second.id]);
  });

  it("lists the receipts of one project, newest first", async () => {
    const old = await recordHandoff(db, receipt());
    await db.update(t.handoffs).set({ createdAt: new Date("2026-09-01T10:00:00Z") }).where(eq(t.handoffs.id, old.id));
    const recent = await recordHandoff(db, receipt({ targetAgent: "opencode" }));
    await recordHandoff(db, receipt({ projectId: "other" }));
    await recordHandoff(db, receipt({ projectId: null }));

    const rows = await listProjectHandoffs(db, "project");
    expect(rows.map((row) => row.id)).toEqual([recent.id, old.id]);
    expect(await listProjectHandoffs(db, "nobody")).toEqual([]);
  });

  it("finds the newest receipt for a conversation and a target, and nothing for another pair", async () => {
    const old = await recordHandoff(db, receipt());
    await db.update(t.handoffs).set({ createdAt: new Date("2026-09-01T10:00:00Z") }).where(eq(t.handoffs.id, old.id));
    const again = await recordHandoff(db, receipt({ tier: "compact" }));
    await recordHandoff(db, receipt({ targetAgent: "opencode" }));

    expect((await findHandoff(db, HASH, "codex-cli"))?.id).toBe(again.id);
    expect((await findHandoff(db, HASH, "opencode"))?.tier).toBe("full");
    expect(await findHandoff(db, HASH, "gemini-cli")).toBeUndefined();
    expect(await findHandoff(db, "b".repeat(64), "codex-cli")).toBeUndefined();
  });

  it("outlives its project: deleting the project nulls the reference instead of taking the receipt", async () => {
    const row = await recordHandoff(db, receipt());
    await db.delete(t.projects).where(eq(t.projects.id, "project"));
    const survivor = await getHandoff(db, row.id);
    expect(survivor).toBeDefined();
    expect(survivor?.projectId).toBeNull();
    expect(survivor?.cwd).toBe("/tmp/project");
    expect((await listHandoffs(db))[0]?.projectSlug).toBeNull();
    expect(await listProjectHandoffs(db, "project")).toEqual([]);
  });
});
