import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveProject: vi.fn(),
  getProject: vi.fn(),
  listProjectTasks: vi.fn(),
}));
vi.mock("@panoma/db", async (original) => ({
  ...(await original<typeof import("@panoma/db")>()),
  resolveProject: mocks.resolveProject,
  getProject: mocks.getProject,
  listProjectTasks: mocks.listProjectTasks,
}));

import { catalogMdContext } from "./md-sync";

/**
 * What the catalog contributes to the block, and why it is counted where it is counted.
 *
 * The block used to take «N with security advisories» from `projects.vuln_count` and the names of
 * those advisories from `getProject`, and nothing made the two agree. They do not answer the same
 * question: `vuln_count` is written by `summarize()` in `packages/enrich/src/refresh.ts` behind
 * `if (row.isDev) continue`, so a dev dependency never reaches it, while the advisory list joins
 * `project_dependencies` with no `is_dev` predicate at all.
 *
 * Measured in panoma's own `AGENTS.md` on 8-Sep-2026 — `vitest`, a dev dependency, carried
 * GHSA-82fw-gwwq-j7x9 at 4.1.10, so the counter said 0 while the list named it, two lines apart.
 * Both numbers were correct; the paragraph was not.
 */

const ROOT = "/disk/demo";

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    slug: "demo",
    name: "demo",
    root: ROOT,
    enrichedAt: new Date("2026-09-08T00:00:00.000Z"),
    outdatedDeps: 5,
    vulnCount: 0,
    vulnCritical: 0,
    ...overrides,
  };
}

function detail(advisories: { packageName: string; advisoryId: string; severity: string }[]) {
  return { advisories, agents: [], decision: null };
}

async function context(row: Record<string, unknown>, advisories: Parameters<typeof detail>[0]) {
  mocks.resolveProject.mockResolvedValue(project(row));
  mocks.getProject.mockResolvedValue(detail(advisories));
  mocks.listProjectTasks.mockResolvedValue([]);
  return catalogMdContext({} as never, ROOT);
}

describe("the advisory count comes from the advisories", () => {
  it("counts the dev dependency the summary pass never counted", async () => {
    const result = await context({ vulnCount: 0 }, [
      { packageName: "vitest", advisoryId: "GHSA-82fw-gwwq-j7x9", severity: "medium" },
    ]);
    // The denormalized counter says zero and is ignored: the list is the evidence.
    expect(result?.vulns).toBe(1);
    expect(result?.advisories).toEqual([{ package: "vitest", id: "GHSA-82fw-gwwq-j7x9" }]);
    expect(result?.critical).toBeUndefined();
  });

  it("counts critical and high, which is what the catalog means by 'critical'", async () => {
    const result = await context({ vulnCount: 0, vulnCritical: 0 }, [
      { packageName: "a", advisoryId: "GHSA-a", severity: "critical" },
      { packageName: "b", advisoryId: "GHSA-b", severity: "high" },
      { packageName: "c", advisoryId: "GHSA-c", severity: "low" },
    ]);
    expect(result?.vulns).toBe(3);
    expect(result?.critical).toBe(2);
  });

  /*
    The gate that was already there and stays: `outdated_deps` and company are born at `default(0)`,
    so on a project nobody ever enriched a zero is the factory value and not an answer.
   */
  it("says nothing about advisories on a project that was never enriched", async () => {
    const result = await context({ enrichedAt: null }, []);
    expect(result?.vulns).toBeUndefined();
    expect(result?.outdated).toBeUndefined();
  });

  /*
    But a named advisory is its own proof that somebody asked. That project exists: the same
    `isDev` filter keeps a project whose dependencies are all dev out of `byProject`, which is what
    leaves its `enriched_at` null for good while its dev advisories sit in the table.
   */
  it("still states the count when the list is not empty and the project was never enriched", async () => {
    const result = await context({ enrichedAt: null }, [
      { packageName: "vitest", advisoryId: "GHSA-82fw-gwwq-j7x9", severity: "medium" },
    ]);
    expect(result?.vulns).toBe(1);
    expect(result?.outdated).toBeUndefined();
  });

  it("states the zero that was actually asked for", async () => {
    const result = await context({}, []);
    expect(result?.vulns).toBe(0);
    expect(result?.outdated).toBe(5);
  });

  it("keeps the block on the disk when the root is not the project's own", async () => {
    mocks.resolveProject.mockResolvedValue(project({ root: "/disk" }));
    expect(await catalogMdContext({} as never, ROOT)).toBeUndefined();
  });
});
