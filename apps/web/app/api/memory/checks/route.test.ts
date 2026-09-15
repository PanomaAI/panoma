import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addHumanNote, checksOf, createCommitment, insertBeliefs, latestRevision, listProjectNotes, recordObservation, saveDecisionEpisodes, schema,
  type Check, type Database,
} from "@panoma/db";

/*
  The checks door, called for real against a PGlite in a temporary home with items made through
  the catalog's own writers. Written on 14-Sep-2026 with delivery C. What is watched: a create
  names the item and its revision and gets 201 with definition revision 1 and the item's next
  revision, a modify names the check and the revision and gets 200 with revision 2; the two
  gestures are told apart by their keys and a body that mixes them is refused by name; a
  definition the validator refuses is `invalid_check` with the validator's reason and never the
  value — a regex where a digest goes, a command where a script name goes, a path that climbs
  out, a literal one unit over the cap, an unknown kind, a completion purpose outside a
  commitment; a moved item is `stale_revision` with the number it is at now; an item of another
  project, a closed item and a check the row does not carry are `not_found`; the page shows each
  definition with the patrol's newest look per subject revision and environment and whether it
  is stale, without ever evaluating anything itself (no `memory_outcomes` row is written by a
  POST); the project-wide page is fifty behind a cursor; the remote catalog is refused where the
  door cuts and the quarantine refuses the write. The 403 from the network is in `gates.test.ts`.
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
const PROJECT = { id: "checks-route", slug: "checks-route", name: "Checks route", identity: "git:checks-route" };
const OTHER = { id: "checks-other", slug: "checks-other", name: "Checks other", identity: "git:checks-other" };
const hex = (seed: string) => createHash("sha256").update(seed).digest("hex");

function get(query: string): Promise<Response> {
  return GET(new Request(`http://localhost:4173/api/memory/checks${query}`, { headers: { "accept-language": "en" } }));
}

function post(body: unknown, raw?: string): Promise<Response> {
  return POST(new Request("http://localhost:4173/api/memory/checks", {
    method: "POST", headers: { "content-type": "application/json", "accept-language": "en" }, body: raw ?? JSON.stringify(body),
  }));
}

const definition = { kind: "path_exists", purpose: "grounds", target: "src/reader.ts", expected: true };

async function note(projectId = PROJECT.id, body = "Keep reads local."): Promise<{ id: string; revision: number }> {
  const added = await addHumanNote(database, { projectId, body });
  if (!("id" in added)) throw new Error("fixture refused");
  const [row] = await listProjectNotes(database, projectId, ["approved"]);
  return { id: added.id, revision: row!.memoryRev };
}

async function criterion(identity: string | null = PROJECT.identity): Promise<string> {
  const [id] = await insertBeliefs(database, [{
    topic: "design", statement: "One idea per screen.", state: "signed", identity, citations: [],
    support: { observations: 3, projects: 2, days: 2 }, model: "owner", ...(identity === null ? { scopeKind: "global" as const } : {}),
  }]);
  return id!;
}

async function decision(identity: string | null = PROJECT.identity): Promise<string> {
  const [row] = await saveDecisionEpisodes(database, [{ identity, origin: "owner", fields: { decision: { text: "Never ship on Fridays." } }, model: null }]);
  return row!.id;
}

/** One look by the patrol at a check of an item, on the item's current photograph, in one environment. */
async function observe(kind: "note" | "commitment", itemId: string, check: { checkId: string; revision: number }, result: "pass" | "fail" | "unknown", environment: string, at = new Date()): Promise<void> {
  const photograph = await latestRevision(database, kind, itemId);
  if (!photograph) throw new Error("no photograph");
  await database.transaction(async (tx) => {
    await recordObservation(tx, {
      projectId: PROJECT.id, subjectRevisionId: photograph.id, checkId: check.checkId, checkRev: check.revision, result,
      environment: {
        schemaVersion: 1, environmentId: hex(environment), projectRef: PROJECT.id, resolvedRoot: join(home, "a"), observedAt: at.toISOString(),
        inspected: [{ path: "src/reader.ts", state: result === "unknown" ? "unreadable" : "read" }],
      },
      evidence: { schemaVersion: 1, sourceRefs: [], observedCoverage: { inspected: 1, unknown: result === "unknown" ? 1 : 0 }, deliveredBefore: "unknown", reason: result === "pass" ? "exists" : result === "fail" ? "absent" : "unreadable" },
      observedAt: at,
    });
  });
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-checks-route-"));
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
  await database.delete(schema.memoryDependencies);
  await database.delete(schema.commitments);
  await database.delete(schema.notes);
  await database.delete(schema.beliefs);
  await database.delete(schema.decisionEpisodes);
  await database.delete(schema.memoryRevisions);
});

afterAll(async () => {
  await close();
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await rm(home, { recursive: true, force: true });
});

describe("the two gestures", () => {
  it("refuses an unknown key, a slug, an item, a create that names a check or a modify without its revision, by name", async () => {
    const cases: [unknown, string][] = [
      [{ slug: PROJECT.slug, itemKind: "note", itemId: "n", itemRevision: 1, ...definition, force: true }, "force is not a known property."],
      [{ slug: "has space", itemKind: "note", itemId: "n", itemRevision: 1, ...definition }, "slug is not a project slug."],
      [{ slug: PROJECT.slug, itemKind: "rule", itemId: "n", itemRevision: 1, ...definition }, "itemKind must be note, criterion, decision or commitment."],
      [{ slug: PROJECT.slug, itemKind: "note", itemId: "../n", itemRevision: 1, ...definition }, "itemId must be an opaque id of 1 to 128 characters."],
      [{ slug: PROJECT.slug, itemKind: "note", itemId: "n", itemRevision: 1, checkId: "chk_x", ...definition }, "A modify names both checkId and expectedRevision; a create names neither."],
      [{ slug: PROJECT.slug, itemKind: "note", itemId: "n", itemRevision: 1, expectedRevision: 1, ...definition }, "A modify names both checkId and expectedRevision; a create names neither."],
      [{ slug: PROJECT.slug, itemKind: "note", itemId: "n", itemRevision: 2, checkId: "chk_x", expectedRevision: 1, ...definition }, "On a modify, itemRevision and expectedRevision are the same number: the item revision the page answered."],
      [{ slug: PROJECT.slug, itemKind: "note", itemId: "n", checkId: "chk_x", expectedRevision: 0, ...definition }, "expectedRevision must be the item revision the page answered."],
      [{ slug: PROJECT.slug, itemKind: "note", itemId: "n", itemRevision: "1", ...definition }, "itemRevision must be the item revision the page answered."],
      [{ slug: PROJECT.slug, itemKind: "note", itemId: "n", ...definition }, "itemRevision must be the item revision the page answered."],
      [{ slug: PROJECT.slug, itemKind: "note", itemId: "n", itemRevision: 1, kind: "path_exists", purpose: "grounds", target: "x" }, "A check names its kind, purpose, target and expected value."],
    ];
    for (const [body, error] of cases) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ code: "invalid_input", error, retryable: false });
    }
    expect((await post(undefined, "{")).status).toBe(400);
    expect((await post(undefined, JSON.stringify({ slug: PROJECT.slug, itemKind: "note", itemId: "n", itemRevision: 1, ...definition, pad: "x".repeat(70_000) }))).status).toBe(413);
    // Nothing was touched before the refusals: no photograph, no outcome.
    expect(await database.select().from(schema.memoryOutcomes)).toHaveLength(0);
  });

  it("answers invalid_check with the validator's reason for every refused shape, never the value, and writes nothing", async () => {
    const { id, revision } = await note();
    const on = (patch: Record<string, unknown>) => ({ slug: PROJECT.slug, itemKind: "note", itemId: id, itemRevision: revision, ...definition, ...patch });
    const cases: [Record<string, unknown>, string][] = [
      [{ kind: "file_hash", expected: "^[a-f0-9]{64}$" }, "expected_sha256"],
      [{ kind: "file_hash", expected: "/sha256/i" }, "expected_sha256"],
      [{ kind: "manifest_script", target: "package.json", expected: { name: "pnpm run build && rm -rf /" } }, "expected_name"],
      [{ kind: "direct_dependency", target: "package.json", expected: { ecosystem: "shell", name: "curl" } }, "expected_ecosystem"],
      [{ target: "../../etc/passwd" }, "target"],
      [{ target: "/etc/passwd" }, "target"],
      [{ kind: "text_present", expected: "x".repeat(2_049) }, "expected_literal_length"],
      [{ kind: "text_present", expected: "" }, "expected_literal"],
      [{ target: `src/${"a".repeat(2_049)}.ts` }, "target_length"],
      [{ kind: "regex", expected: ".*" }, "kind"],
      [{ kind: "structured_key", target: "src/reader.ts", expected: { path: ["a"] } }, "target"],
      [{ kind: "structured_key", target: "package.json", expected: { path: Array.from({ length: 21 }, (_, n) => `k${n}`) } }, "expected_path_length"],
      [{ kind: "structured_key", target: "package.json", expected: { path: ["a"], value: { nested: true } } }, "expected_value"],
      [{ purpose: "completion" }, "purpose_domain"],
      [{ purpose: "obedience" }, "purpose"],
      [{ expected: "yes" }, "expected_boolean"],
    ];
    for (const [patch, reason] of cases) {
      const response = await post(on(patch));
      expect(response.status, JSON.stringify(patch)).toBe(400);
      const body = (await response.json()) as { code: string; reason: string; error: string; retryable: boolean };
      expect(body).toMatchObject({ code: "invalid_check", reason, retryable: false });
      for (const value of ["passwd", "rm -rf", "curl", ".*", "^[a-f0-9]"]) expect(body.error).not.toContain(value);
    }
    // Nothing moved: the note is at the revision it was read at and carries no definition.
    const [row] = await listProjectNotes(database, PROJECT.id, ["approved"]);
    expect(row!.memoryRev).toBe(revision);
    expect(await checksOf(database, "note", id)).toEqual([]);
  });

  it("creates on every domain with 201 and the item's next revision, modifies with 200 and revision 2, and refuses a moved item with stale_revision and a foreign check with not_found", async () => {
    const { id, revision } = await note();
    const created = await post({ slug: PROJECT.slug, itemKind: "note", itemId: id, itemRevision: revision, ...definition });
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("private, no-store");
    const first = (await created.json()) as { id: string; revision: number; itemRevision: number };
    expect(first).toEqual({ id: expect.stringMatching(/^chk_/), revision: 1, itemRevision: revision + 1 });
    expect(await checksOf(database, "note", id)).toEqual([{ schemaVersion: 1, checkId: first.id, revision: 1, purpose: "grounds", kind: "path_exists", target: "src/reader.ts", expected: true }]);
    // The route registers the definition only: no evaluation, no outcome row.
    expect(await database.select().from(schema.memoryOutcomes)).toHaveLength(0);

    const stale = await post({ slug: PROJECT.slug, itemKind: "note", itemId: id, itemRevision: revision, ...definition });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_revision", error: expect.stringContaining(`revision ${revision + 1}`), hint: expect.any(String) });

    const modified = await post({ slug: PROJECT.slug, itemKind: "note", itemId: id, checkId: first.id, expectedRevision: revision + 1, ...definition, kind: "text_absent", expected: "TODO" });
    expect(modified.status).toBe(200);
    expect(await modified.json()).toEqual({ id: first.id, revision: 2, itemRevision: revision + 2 });
    expect((await checksOf(database, "note", id))[0]).toMatchObject({ checkId: first.id, revision: 2, kind: "text_absent", expected: "TODO" });

    const foreign = await post({ slug: PROJECT.slug, itemKind: "note", itemId: id, checkId: "chk_nowhere", expectedRevision: revision + 2, ...definition });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toMatchObject({ code: "not_found", error: "The note carries no check with that id." });
    const legacy = await post({ slug: PROJECT.slug, itemKind: "note", itemId: id, checkId: "legacy:0", expectedRevision: revision + 2, ...definition });
    expect(legacy.status).toBe(400);
    expect(await legacy.json()).toMatchObject({ code: "invalid_check", reason: "legacy" });

    // The other domains take a create too; a completion criterion only on a commitment.
    const beliefId = await criterion();
    const onCriterion = await post({ slug: PROJECT.slug, itemKind: "criterion", itemId: beliefId, itemRevision: 1, ...definition, purpose: "applicability" });
    expect(onCriterion.status).toBe(201);
    const episodeId = await decision();
    const onDecision = await post({ slug: PROJECT.slug, itemKind: "decision", itemId: episodeId, itemRevision: 1, ...definition, purpose: "violation", kind: "text_absent", expected: "console.log" });
    expect(onDecision.status).toBe(201);
    const commitment = await createCommitment(database, { projectId: PROJECT.id, text: "Land the migration with its test." });
    const onCommitment = await post({ slug: PROJECT.slug, itemKind: "commitment", itemId: commitment.id, itemRevision: commitment.revision, ...definition, purpose: "completion" });
    expect(onCommitment.status).toBe(201);
    expect((await checksOf(database, "commitment", commitment.id)).map((check) => check.purpose)).toEqual(["completion"]);
    expect((await get(`?slug=${PROJECT.slug}`)).status).toBe(200);
    const page = (await (await get(`?slug=${PROJECT.slug}`)).json()) as { checks: { itemKind: string; purpose: string }[] };
    expect(page.checks.map((check) => `${check.itemKind}:${check.purpose}`)).toEqual(["note:grounds", "criterion:applicability", "decision:violation", "commitment:completion"]);
  });

  it("answers not_found for an item of another project, a closed item and a global criterion of nobody's, without touching them", async () => {
    const theirs = await note(OTHER.id, "Theirs.");
    const response = await post({ slug: PROJECT.slug, itemKind: "note", itemId: theirs.id, itemRevision: theirs.revision, ...definition });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "not_found", error: "No live note with that id belongs to this project." });
    expect(await checksOf(database, "note", theirs.id)).toEqual([]);
    const foreignDecision = await decision(OTHER.identity);
    expect((await post({ slug: PROJECT.slug, itemKind: "decision", itemId: foreignDecision, itemRevision: 1, ...definition })).status).toBe(404);
    const foreignCriterion = await criterion(OTHER.identity);
    expect((await post({ slug: PROJECT.slug, itemKind: "criterion", itemId: foreignCriterion, itemRevision: 1, ...definition })).status).toBe(404);
    // A global criterion applies here and takes a definition; an unresolved one does not.
    const global = await criterion(null);
    expect((await post({ slug: PROJECT.slug, itemKind: "criterion", itemId: global, itemRevision: 1, ...definition })).status).toBe(201);
    const commitment = await createCommitment(database, { projectId: PROJECT.id, text: "Closed already." });
    const { cancelCommitment } = await import("@panoma/db");
    expect(await cancelCommitment(database, commitment.id, { memoryRev: commitment.revision }, "done elsewhere")).toEqual({ revision: 2 });
    const closed = await post({ slug: PROJECT.slug, itemKind: "commitment", itemId: commitment.id, itemRevision: 2, ...definition });
    expect(closed.status).toBe(404);
    expect((await get(`?slug=nowhere`)).status).toBe(404);
    expect((await get(`?slug=${PROJECT.slug}&itemKind=note&itemId=${theirs.id}`)).status).toBe(404);
  });

  it("needs the local catalog to define, not to read, and defines nothing under quarantine", async () => {
    const { id, revision } = await note();
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    try {
      const response = await post({ slug: PROJECT.slug, itemKind: "note", itemId: id, itemRevision: revision, ...definition });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "local_catalog_required" });
      expect((await get(`?slug=${PROJECT.slug}`)).status).toBe(200);
    } finally {
      delete process.env["DATABASE_URL"];
    }
    mocks.quarantine.mockResolvedValue({ quarantined: true, reason: "corrupt_line" });
    const refused = await post({ slug: PROJECT.slug, itemKind: "note", itemId: id, itemRevision: revision, ...definition });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ code: "unavailable", retryable: true, error: expect.stringContaining("corrupt_line") });
    expect(await checksOf(database, "note", id)).toEqual([]);
  });
});

describe("the page", () => {
  it("refuses an unknown query parameter, a slug that is not one, half an item and a cursor that is not one, by name", async () => {
    const cases: [string, number, string][] = [
      [`?slug=${PROJECT.slug}&path=/tmp`, 400, "path is not a known query parameter."],
      ["", 400, "slug is not a project slug."],
      ["?slug=has%20space", 400, "slug is not a project slug."],
      [`?slug=${PROJECT.slug}&itemKind=note`, 400, "itemKind and itemId name one item together."],
      [`?slug=${PROJECT.slug}&itemId=n`, 400, "itemKind and itemId name one item together."],
      [`?slug=${PROJECT.slug}&itemKind=rule&itemId=n`, 400, "itemKind must be note, criterion, decision or commitment."],
      [`?slug=${PROJECT.slug}&cursor=${encodeURIComponent("not a token")}`, 400, "cursor must be the page cursor this door answered."],
      [`?slug=${PROJECT.slug}&cursor=${Buffer.from("select 1", "utf8").toString("base64url")}`, 400, "cursor must be the page cursor this door answered."],
      ["?slug=nowhere", 404, "No project has that slug."],
    ];
    for (const [query, status, error] of cases) {
      const response = await get(query);
      expect(response.status, query).toBe(status);
      expect(await response.json()).toMatchObject({ error, retryable: false });
    }
    expect(await (await get(`?slug=${PROJECT.slug}`)).json()).toEqual({ checks: [], nextCursor: null });
  });

  it("shows each definition with the patrol's newest look per subject revision and environment, stale after ten minutes, and legacy sentinels normalized", async () => {
    const added = await addHumanNote(database, { projectId: PROJECT.id, body: "Use src/reader.ts.", sentinels: [{ kind: "file_contains", target: "src/reader.ts", expected: "local" }] });
    if (!("id" in added)) throw new Error("fixture refused");
    const [row] = await listProjectNotes(database, PROJECT.id, ["approved"]);
    const created = (await (await post({ slug: PROJECT.slug, itemKind: "note", itemId: added.id, itemRevision: row!.memoryRev, ...definition })).json()) as { id: string; itemRevision: number };
    const check = { checkId: created.id, revision: 1 };
    await observe("note", added.id, check, "fail", "worktree-a", new Date(Date.now() - 11 * 60_000));
    await observe("note", added.id, check, "pass", "worktree-a");
    await observe("note", added.id, check, "unknown", "worktree-b");
    // The definition is edited: the item moves to a new photograph, the earlier looks stay readable with theirs.
    const modified = (await (await post({ slug: PROJECT.slug, itemKind: "note", itemId: added.id, checkId: created.id, expectedRevision: created.itemRevision, ...definition, expected: false })).json()) as { revision: number; itemRevision: number };
    await observe("note", added.id, { checkId: created.id, revision: 2 }, "fail", "worktree-a");
    // A third worktree looked eleven minutes ago and nobody since: that look is stale by age.
    await observe("note", added.id, { checkId: created.id, revision: 2 }, "pass", "worktree-c", new Date(Date.now() - 11 * 60_000));

    const response = await get(`?slug=${PROJECT.slug}&itemKind=note&itemId=${added.id}`);
    expect(response.status).toBe(200);
    const page = (await response.json()) as { checks: Record<string, unknown>[]; nextCursor: string | null };
    expect(page.nextCursor).toBeNull();
    expect(page.checks).toHaveLength(2);
    const [legacy, defined] = page.checks as [Record<string, unknown>, Record<string, unknown> & { observations: Record<string, unknown>[]; latest: Record<string, unknown> }];
    expect(legacy).toMatchObject({ itemKind: "note", itemId: added.id, itemRevision: modified.itemRevision, checkId: "legacy:0", revision: 1, purpose: "grounds", kind: "text_present", expected: "local", legacy: true, latest: null, observations: [] });
    expect(defined).toMatchObject({ checkId: created.id, revision: 2, kind: "path_exists", expected: false, legacy: false });
    expect(defined.latest).toMatchObject({ subjectRevision: modified.itemRevision, checkRev: 2, environmentId: hex("worktree-a"), result: "fail", reason: "absent", stale: false });
    const worktree = (look: Record<string, unknown>) => (look["environmentId"] === hex("worktree-a") ? "a" : look["environmentId"] === hex("worktree-b") ? "b" : "c");
    expect(defined.observations.map((look) => [look["subjectRevision"], look["checkRev"], worktree(look), look["result"], look["stale"]])).toEqual([
      [modified.itemRevision, 2, "a", "fail", false],
      [created.itemRevision, 1, "b", "unknown", false],
      [created.itemRevision, 1, "a", "pass", false],
      [modified.itemRevision, 2, "c", "pass", true],
    ]);
    // The eleven-minute fail in worktree a was one occurrence with the fresh pass: only the newest row of an occurrence is shown.
    expect(defined.observations.every((look) => typeof look["observedAt"] === "string")).toBe(true);
    const text = await (await get(`?slug=${PROJECT.slug}&itemKind=note&itemId=${added.id}`)).text();
    expect(text).not.toContain(home);
  });

  it("pages the project's checks fifty at a time behind a cursor, in a fixed order, and refuses a cursor that names a check that is gone", async () => {
    const { id, revision } = await note();
    for (let n = 0; n < 51; n += 1) {
      const response = await post({ slug: PROJECT.slug, itemKind: "note", itemId: id, itemRevision: revision + n, ...definition, target: `src/file-${String(n).padStart(2, "0")}.ts` });
      expect(response.status).toBe(201);
    }
    const first = (await (await get(`?slug=${PROJECT.slug}`)).json()) as { checks: { target: string; checkId: string }[]; nextCursor: string | null };
    expect(first.checks).toHaveLength(50);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await (await get(`?slug=${PROJECT.slug}&cursor=${encodeURIComponent(first.nextCursor!)}`)).json()) as { checks: { target: string; checkId: string }[]; nextCursor: string | null };
    expect(second.checks).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const targets = [...first.checks, ...second.checks].map((check) => check.target);
    expect(new Set(targets).size).toBe(51);
    expect(targets[0]).toBe("src/file-00.ts");
    expect(targets[50]).toBe("src/file-50.ts");
    // The check the cursor names is removed: the page cannot continue from it.
    const { removeCheck } = await import("@panoma/db");
    const checks: Check[] = await checksOf(database, "note", id);
    const named = first.checks[49]!.checkId;
    expect(await removeCheck(database, "note", id, named, { memoryRev: revision + 51 })).toBe(true);
    expect(checks.some((check) => check.checkId === named)).toBe(true);
    const gone = await get(`?slug=${PROJECT.slug}&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(gone.status).toBe(409);
    expect(await gone.json()).toMatchObject({ code: "stale_cursor" });
  });
});
