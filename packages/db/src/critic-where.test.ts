import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ProjectAnalysis } from "@panoma/core";
import type { Database } from "./client";
import { ingestPortfolio } from "./ingest";
import * as t from "./schema";
import { getDailyReport, saveLook } from "./queries";

/**
 * Where is what the critic saw, which is the missing half.
 *
 * The section of the report said 'the critic has seen something while you weren't looking' and
 * that was it: no link, and when expanding the details it didn't appear either. Whoever read it
 * knew there was something and had no way to get to it — the component's comment promised 'with
 * the link to where the verdict is' and that link had never been written.
 *
 * What is established here is that the report must state **which project** each finding belongs
 * to, because without that the screen cannot link to anything no matter how much it wants to. And
 * both paths count: the paid view is anchored by identity and the mechanical review by id, so a
 * poorly written join leaves out exactly half of the notice.
 */

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-critico-"));
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

afterEach(async () => {
  await db.delete(t.looks);
  await db.delete(t.reviews);
});

const ROOT = "/tmp/panoma-critico-de-prueba";

function analysis(folder: string, rootCommit: string): ProjectAnalysis {
  const root = `${ROOT}/${folder}`;
  return {
    name: folder,
    slug: folder,
    root,
    languages: [],
    technologies: [],
    ecosystems: [],
    distributions: [],
    links: [],
    runbook: { commands: [], runtimes: [], missingEnv: [], docs: [] },
    provenance: {},
    summary: { text: folder, source: "composed", composition: { kind: "project", stack: [], services: [], stores: [] }, composed: folder, discarded: [] },
    health: { score: 50, grade: "C", signals: [], skipped: [] },
    engineVersion: "test",
    scannedAt: new Date("2026-08-21T10:00:00Z").toISOString(),
    stats: { files: 1, sourceBytes: 10, truncated: false, durationMs: 1 },
    git: {
      rootCommitSha: rootCommit,
      repoRoot: root,
      recentCommits: [],
      authors: [],
    },
  } as unknown as ProjectAnalysis;
}

/** A mechanical review with `n` pegs, which is what the report counts. */
async function revisar(projectId: string, n: number): Promise<void> {
  await db.insert(t.reviews).values({
    projectId,
    findings: Array.from({ length: n }, (_, i) => ({ kind: "radius-drift", claim: `${i}px` })),
    sourcesRead: 10,
    truncated: false,
  });
}

describe("el parte dice dónde vio el crítico lo que vio", () => {
  it("nombra el proyecto de una revisión mecánica, con su cuenta", async () => {
    await ingestPortfolio(db, [analysis("uno", "a".repeat(40))], [], ROOT);
    const [project] = await db.select({ id: t.projects.id }).from(t.projects);
    await revisar(project!.id, 3);

    const report = await getDailyReport(db, new Date("2026-08-20T00:00:00Z"));

    expect(report.critic.reviewFindings).toBe(3);
    expect(report.critic.where).toEqual([{ slug: "uno", name: "uno", findings: 3 }]);
  });

  /*
    The paid look hangs from the identity and not from the ID —Twin does not set foreign ones, so
    it survives a rescan—, so it joins through another column. Joining the two would still leave
    this side of the notice mute without anything failing.
   */
  it("y también el de una mirada, que se ancla por identidad", async () => {
    await ingestPortfolio(db, [analysis("dos", "b".repeat(40))], [], ROOT);
    const [project] = await db
      .select({ identity: t.projects.identity })
      .from(t.projects);
    /*
      Identity can be null in the schema — a folder without a repository doesn't have it —, so it
      is stated: without it this test would not be testing what it claims to test.
     */
    expect(project?.identity).toBeTruthy();
    await saveLook(db, {
      identity: project!.identity!,
      digest: "zzz",
      bytes: 10,
      fired: "watch",
      provider: "anthropic",
      model: "modelo-de-prueba",
      statements: 1,
      dropped: 0,
      unreadable: false,
      findings: [{ what: "Rompe el espaciado", where: "La cabecera", fix: "Quítalo", cites: [] }],
    });

    const report = await getDailyReport(db, new Date("2026-08-20T00:00:00Z"));

    expect(report.critic.lookFindings).toBe(1);
    expect(report.critic.where).toEqual([{ slug: "dos", name: "dos", findings: 1 }]);
  });

  it("un proyecto revisado y limpio no es una noticia", async () => {
    await ingestPortfolio(db, [analysis("tres", "c".repeat(40))], [], ROOT);
    const [project] = await db.select({ id: t.projects.id }).from(t.projects);
    await revisar(project!.id, 0);

    const report = await getDailyReport(db, new Date("2026-08-20T00:00:00Z"));

    expect(report.critic.reviews, "la revisión existió").toBe(1);
    expect(report.critic.where, "pero no hay nada a donde mandar a nadie").toEqual([]);
  });

  it("y lo de antes de la ventana no se cuenta: el parte es «desde tu última vez»", async () => {
    await ingestPortfolio(db, [analysis("cuatro", "d".repeat(40))], [], ROOT);
    const [project] = await db.select({ id: t.projects.id }).from(t.projects);
    await db.insert(t.reviews).values({
      projectId: project!.id,
      findings: [{ kind: "radius-drift", claim: "4px" }],
      sourcesRead: 10,
      truncated: false,
      at: new Date("2026-08-19T00:00:00Z"),
    });

    const report = await getDailyReport(db, new Date("2026-08-20T00:00:00Z"));

    expect(report.critic.where).toEqual([]);
  });
});
