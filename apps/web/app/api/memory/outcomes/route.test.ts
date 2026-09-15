import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addHumanNote, latestRevision, listProjectNotes, openIncident, putCheck, recordObservation, schema, type Database, type Environment, type Evidence,
} from "@panoma/db";

/*
  The outcomes door, called for real against a PGlite in a temporary home with looks written as
  the patrol writes them. Written on 14-Sep-2026 with delivery C. What is watched: the page is
  occurrences, newest opened first, fifty behind a cursor, each with its newest row per
  environment, the subject revision, the counts, the tri-state `deliveredBefore` (unknown here:
  nothing was received), the verdict of an incident and whether the newest look is stale, and
  its bytes never carry a root of this disk; `itemId` narrows it to one item; an unknown query
  parameter, a slug that is not one, a cursor that is not one and an unknown slug are refused by
  name. The POST takes the owner's word on one incident by compare-and-set on its verdict
  revision — 200 with the next number, 409 with the number it is at now — and refuses by name
  an observation carried in the body (no technical observation enters from outside), a verdict
  that is not one of the two words, and answers 404 alike for no row, an observation's id and an
  incident of another project. Nothing is judged under quarantine. The 403 from the network is
  in `gates.test.ts`.
 */

const mocks = vi.hoisted(() => ({
  quarantine: vi.fn(async (): Promise<{ quarantined: false } | { quarantined: true; reason: string }> => ({ quarantined: false })),
}));
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }), memoryQuarantine: mocks.quarantine }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
const { GET, POST } = await import("./route");

let database: Database;
let close: () => Promise<void>;
let home: string;
const previous = { PANOMA_HOME: process.env["PANOMA_HOME"], DATABASE_URL: process.env["DATABASE_URL"], PANOMA_OPERATOR_KEY: process.env["PANOMA_OPERATOR_KEY"] };
const PROJECT = { id: "outcomes-route", slug: "outcomes-route", name: "Outcomes route", identity: "git:outcomes-route" };
const OTHER = { id: "outcomes-other", slug: "outcomes-other", name: "Outcomes other", identity: "git:outcomes-other" };
const hex = (seed: string) => createHash("sha256").update(seed).digest("hex");

function get(query: string): Promise<Response> {
  return GET(new Request(`http://localhost:4173/api/memory/outcomes${query}`, { headers: { "accept-language": "en" } }));
}

function post(body: unknown, raw?: string): Promise<Response> {
  return POST(new Request("http://localhost:4173/api/memory/outcomes", {
    method: "POST", headers: { "content-type": "application/json", "accept-language": "en" }, body: raw ?? JSON.stringify(body),
  }));
}

interface Fixture { noteId: string; revisionId: string; checkId: string }

/** An approved note with one grounds check, and the id of its current photograph. */
async function anchored(project = PROJECT, body = "Keep reads local."): Promise<Fixture> {
  const added = await addHumanNote(database, { projectId: project.id, body });
  if (!("id" in added)) throw new Error("fixture refused");
  const [row] = await listProjectNotes(database, project.id, ["approved"]);
  const put = await putCheck(database, "note", added.id, { purpose: "grounds", kind: "path_exists", target: "src/reader.ts", expected: true }, { memoryRev: row!.memoryRev });
  if (!("checkId" in put)) throw new Error("fixture refused");
  const photograph = await latestRevision(database, "note", added.id);
  return { noteId: added.id, revisionId: photograph!.id, checkId: put.checkId };
}

function environment(name: string, root: string, at: Date): Environment {
  return { schemaVersion: 1, environmentId: hex(name), projectRef: PROJECT.id, resolvedRoot: root, observedAt: at.toISOString(), inspected: [{ path: "src/reader.ts", state: "read", hash: hex("content") }] };
}

const evidence = (reason: string): Evidence => ({ schemaVersion: 1, sourceRefs: [], observedCoverage: { inspected: 1, unknown: 0 }, deliveredBefore: "unknown", reason });

async function observe(fixture: Fixture, result: "pass" | "fail" | "unknown", where: string, at = new Date(), project = PROJECT): Promise<string> {
  return database.transaction(async (tx) => (await recordObservation(tx, {
    projectId: project.id, subjectRevisionId: fixture.revisionId, checkId: fixture.checkId, checkRev: 1, result,
    environment: environment(where, join(home, "a"), at), evidence: evidence(result === "pass" ? "exists" : "absent"), observedAt: at,
  })).id);
}

async function incident(fixture: Fixture, where: string, at = new Date(), project = PROJECT): Promise<string> {
  return database.transaction(async (tx) => (await openIncident(tx, {
    projectId: project.id, subjectRevisionId: fixture.revisionId, checkId: fixture.checkId, checkRev: 1,
    environment: environment(where, join(home, "a"), at), evidence: evidence("absent"), observedAt: at,
  })).id);
}

async function row(id: string) {
  return database.query.memoryOutcomes.findFirst({ where: (outcome, { eq }) => eq(outcome.id, id) });
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-outcomes-route-"));
  process.env["PANOMA_HOME"] = home;
  delete process.env["DATABASE_URL"];
  delete process.env["PANOMA_OPERATOR_KEY"];
  ({ db: database, close } = await (await import("@panoma/db/client")).openDatabase());
  await database.insert(schema.projects).values([
    { ...PROJECT, root: join(home, "a") },
    { ...OTHER, root: join(home, "b") },
  ]);
});

beforeEach(async () => {
  mocks.quarantine.mockReset();
  mocks.quarantine.mockResolvedValue({ quarantined: false });
  await database.delete(schema.memoryOutcomes);
  await database.delete(schema.notes);
  await database.delete(schema.memoryRevisions);
});

afterAll(async () => {
  await close();
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await rm(home, { recursive: true, force: true });
});

describe("the page", () => {
  it("refuses an unknown query parameter, a slug that is not one, an item id that is not one, a cursor that is not one and an unknown slug, by name", async () => {
    const cases: [string, number, string][] = [
      [`?slug=${PROJECT.slug}&path=/tmp`, 400, "path is not a known query parameter."],
      ["", 400, "slug is not a project slug."],
      ["?slug=has%20space", 400, "slug is not a project slug."],
      [`?slug=${PROJECT.slug}&itemId=../x`, 400, "itemId must be an opaque id of 1 to 128 characters."],
      [`?slug=${PROJECT.slug}&cursor=${encodeURIComponent("not a token")}`, 400, "cursor must be the page cursor this door answered."],
      [`?slug=${PROJECT.slug}&cursor=${Buffer.from("select 1", "utf8").toString("base64url")}`, 400, "cursor must be the page cursor this door answered."],
      ["?slug=nowhere", 404, "No project has that slug."],
    ];
    for (const [query, status, error] of cases) {
      const response = await get(query);
      expect(response.status, query).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ error, retryable: false });
    }
    expect(await (await get(`?slug=${PROJECT.slug}`)).json()).toEqual({ occurrences: [], nextCursor: null });
  });

  it("lists occurrences newest first with the newest row per environment, the subject revision, counts, deliveredBefore, verdict and staleness; itemId narrows; never a root of this disk", async () => {
    const fixture = await anchored();
    const eleven = new Date(Date.now() - 11 * 60_000);
    await observe(fixture, "fail", "worktree-a", eleven);
    const passId = await observe(fixture, "pass", "worktree-a");
    await observe(fixture, "unknown", "worktree-b", eleven);
    const incidentId = await incident(fixture, "worktree-a");
    const theirs = await anchored(OTHER, "Theirs.");
    await incident(theirs, "worktree-z", new Date(), OTHER);

    const response = await get(`?slug=${PROJECT.slug}`);
    expect(response.status).toBe(200);
    const text = await response.clone().text();
    expect(text).not.toContain(home);
    expect(text).not.toContain("resolvedRoot");
    const page = (await response.json()) as { occurrences: Record<string, unknown>[]; nextCursor: string | null };
    expect(page.nextCursor).toBeNull();
    expect(page.occurrences).toHaveLength(3);
    const [opened, byB, byA] = page.occurrences as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
    expect(opened).toMatchObject({
      kind: "incident", check: { checkId: fixture.checkId, checkRev: 1 }, rows: 1, results: { pass: 0, fail: 1, unknown: 0 },
      subject: { revisionId: fixture.revisionId, kind: "note", objectId: fixture.noteId, rev: expect.any(Number) },
      verdict: { value: null, rev: 1, rowId: incidentId }, deliveredBefore: "unknown",
      latest: { id: incidentId, result: "fail", stale: false, evidence: { reason: "absent", deliveredBefore: "unknown", observedCoverage: { inspected: 1, unknown: 0 } }, environment: { environmentId: hex("worktree-a"), inspected: [{ path: "src/reader.ts", state: "read" }] } },
    });
    expect(byB).toMatchObject({ kind: "observation", rows: 1, results: { pass: 0, fail: 0, unknown: 1 }, verdict: null, latest: { result: "unknown", stale: true } });
    // Two looks in worktree a on one occurrence: the newest row is the pass, the counts keep both.
    expect(byA).toMatchObject({ kind: "observation", rows: 2, results: { pass: 1, fail: 1, unknown: 0 }, verdict: null, latest: { id: passId, result: "pass", stale: false } });
    expect((byA["latestByEnvironment"] as { environmentId: string; row: { id: string } }[]).map((entry) => [entry.environmentId, entry.row.id])).toEqual([[hex("worktree-a"), passId]]);

    const narrowed = (await (await get(`?slug=${PROJECT.slug}&itemId=${fixture.noteId}`)).json()) as { occurrences: unknown[] };
    expect(narrowed.occurrences).toHaveLength(3);
    const elsewhere = (await (await get(`?slug=${PROJECT.slug}&itemId=${theirs.noteId}`)).json()) as { occurrences: unknown[] };
    expect(elsewhere.occurrences).toEqual([]);
    const other = (await (await get(`?slug=${OTHER.slug}`)).json()) as { occurrences: { kind: string }[] };
    expect(other.occurrences.map((entry) => entry.kind)).toEqual(["incident"]);
  });

  it("pages fifty occurrences behind a cursor without gaps or repeats", async () => {
    const fixture = await anchored();
    const ids = new Set<string>();
    for (let n = 0; n < 51; n += 1) ids.add(await incident(fixture, "worktree-a", new Date(Date.now() - n * 1_000)));
    const first = (await (await get(`?slug=${PROJECT.slug}`)).json()) as { occurrences: { latest: { id: string } }[]; nextCursor: string | null };
    expect(first.occurrences).toHaveLength(50);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await (await get(`?slug=${PROJECT.slug}&cursor=${encodeURIComponent(first.nextCursor!)}`)).json()) as { occurrences: { latest: { id: string } }[]; nextCursor: string | null };
    expect(second.occurrences).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const seen = new Set([...first.occurrences, ...second.occurrences].map((entry) => entry.latest.id));
    expect(seen).toEqual(ids);
  });
});

describe("the verdict", () => {
  it("refuses an unknown key — an observation carried from outside included —, an id, a verdict or a revision that is not one, by name", async () => {
    const cases: [unknown, string][] = [
      [{ id: "mout_x", verdict: "confirmed", expectedRevision: 1, result: "pass" }, "result is not a known property."],
      [{ id: "mout_x", verdict: "confirmed", expectedRevision: 1, observation: { result: "fail" } }, "observation is not a known property."],
      [{ id: "mout_x", verdict: "confirmed", expectedRevision: 1, slug: "has space" }, "slug is not a project slug."],
      [{ id: "../x", verdict: "confirmed", expectedRevision: 1 }, "id must be an incident id of 1 to 128 characters."],
      [{ id: "mout_x", verdict: "obeyed", expectedRevision: 1 }, "verdict must be confirmed or false_positive."],
      [{ id: "mout_x", verdict: "confirmed", expectedRevision: 0 }, "expectedRevision must be the verdict revision the page answered."],
      [{ id: "mout_x", verdict: "confirmed" }, "expectedRevision must be the verdict revision the page answered."],
    ];
    for (const [body, error] of cases) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ code: "invalid_input", error, retryable: false });
    }
    expect((await post(undefined, "{")).status).toBe(400);
  });

  it("T85: sets the owner's word on an incident by compare-and-set — the same verdict enum, the observation history intact — 409 when it moved, 404 alike for no row, an observation and another project's incident", async () => {
    const fixture = await anchored();
    const observationId = await observe(fixture, "fail", "worktree-a");
    const incidentId = await incident(fixture, "worktree-a");
    const theirs = await anchored(OTHER, "Theirs.");
    const theirIncident = await incident(theirs, "worktree-z", new Date(), OTHER);

    for (const [body, error] of [
      [{ id: "mout_00000000-0000-4000-8000-000000000000", verdict: "confirmed", expectedRevision: 1 }, "No incident of this project has that id."],
      [{ id: observationId, verdict: "confirmed", expectedRevision: 1 }, "No incident of this project has that id."],
      [{ slug: PROJECT.slug, id: theirIncident, verdict: "confirmed", expectedRevision: 1 }, "No incident of this project has that id."],
      [{ slug: "nowhere", id: incidentId, verdict: "confirmed", expectedRevision: 1 }, "No project has that slug."],
    ] as [unknown, string][]) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(404);
      expect(await response.json()).toMatchObject({ code: "not_found", error });
    }
    expect((await row(observationId))!.ownerVerdict).toBeNull();
    expect((await row(theirIncident))!.ownerVerdict).toBeNull();

    const stale = await post({ slug: PROJECT.slug, id: incidentId, verdict: "false_positive", expectedRevision: 2 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_revision", error: expect.stringContaining("revision 1"), hint: expect.any(String) });
    expect((await row(incidentId))!).toMatchObject({ ownerVerdict: null, verdictRev: 1 });

    const judged = await post({ slug: PROJECT.slug, id: incidentId, verdict: "false_positive", expectedRevision: 1 });
    expect(judged.status).toBe(200);
    expect(judged.headers.get("cache-control")).toBe("private, no-store");
    expect(await judged.json()).toEqual({ id: incidentId, verdict: "false_positive", revision: 2 });
    const after = (await row(incidentId))!;
    expect(after).toMatchObject({ ownerVerdict: "false_positive", verdictRev: 2, result: "fail", kind: "incident" });
    // The judgement changed the verdict and nothing else: the observation beside it is untouched.
    expect((await row(observationId))!).toMatchObject({ ownerVerdict: null, verdictRev: 1, result: "fail" });

    // Judging again at the old number is stale; at the new one it moves on, without a slug as well.
    expect((await post({ id: incidentId, verdict: "confirmed", expectedRevision: 1 })).status).toBe(409);
    const again = await post({ id: incidentId, verdict: "confirmed", expectedRevision: 2 });
    expect(await again.json()).toEqual({ id: incidentId, verdict: "confirmed", revision: 3 });
    const page = (await (await get(`?slug=${PROJECT.slug}`)).json()) as { occurrences: { kind: string; verdict: unknown }[] };
    expect(page.occurrences.find((entry) => entry.kind === "incident")!.verdict).toEqual({ value: "confirmed", rev: 3, rowId: incidentId });
  });

  it("judges nothing under quarantine", async () => {
    const fixture = await anchored();
    const incidentId = await incident(fixture, "worktree-a");
    mocks.quarantine.mockResolvedValue({ quarantined: true, reason: "journal_mismatch" });
    const response = await post({ id: incidentId, verdict: "confirmed", expectedRevision: 1 });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "unavailable", retryable: true, error: expect.stringContaining("journal_mismatch") });
    expect((await row(incidentId))!.ownerVerdict).toBeNull();
    // The page still reads.
    expect((await get(`?slug=${PROJECT.slug}`)).status).toBe(200);
  });
});
