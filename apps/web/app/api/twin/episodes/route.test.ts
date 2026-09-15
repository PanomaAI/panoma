import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decisionEpisodeById, listDecisionEpisodes, listNarratives, modelSpendToday, narrativeCount,
  saveDecisionEpisodes, saveNarratives, schema, type Database,
} from "@panoma/db";
import { EPISODE_PAGE, EPISODE_QUERY_MAX, episodeCursor } from "@/lib/twin-memory-view";

let database: Database;
const dbMock = vi.fn(() => ({ db: database }));
const completeMock = vi.fn();
const revalidateMock = vi.fn();
vi.mock("@/lib/db", () => ({ db: async () => dbMock() }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidateMock(...args) }));
vi.mock("@panoma/ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("@panoma/ai")>(),
  complete: (...args: unknown[]) => completeMock(...args),
  resolveCredential: async () => ({ provider: { id: "test" }, model: "test-extractor" }),
}));

const { GET, POST } = await import("./route");
const { POST: learnPOST } = await import("./learn/route");
let home: string;
let close: () => Promise<void>;
const originalHome = process.env["PANOMA_HOME"];
const originalBudget = process.env["PANOMA_EPISODE_BUDGET"];
const originalOperator = process.env["PANOMA_OPERATOR_KEY"];

const decision = {
  goal: "Keep onboarding understandable.",
  decision: "Use inline editing for profile details.",
  rationale: "It keeps the current task visible.",
  exceptions: "Use a confirmation step for destructive actions.",
};

describe("owner decision predicates", () => {
  it("accepts a closed typed patch by memory revision and rejects a stale or malformed patch", async () => {
    const saved = await POST(request({ fields: decision }));
    expect(saved.status).toBe(200);
    const { episode } = await saved.json();
    const predicate = { schemaVersion: 1, expression: { kind: "operation_is", operation: "edit" } };
    const patched = await POST(request({ id: episode.id, expectedRevision: episode.memoryRev, conditionsPredicate: predicate }));
    expect(patched.status).toBe(200);
    expect((await patched.json()).episode.conditionsPredicate).toEqual(predicate);
    expect((await POST(request({ id: episode.id, expectedRevision: episode.memoryRev, conditionsPredicate: null }))).status).toBe(409);
    expect((await POST(request({ id: episode.id, expectedRevision: episode.memoryRev + 1, conditionsPredicate: { schemaVersion: 1, expression: {} } }))).status).toBe(400);
    expect((await decisionEpisodeById(database, episode.id))?.conditionsPredicate).toEqual(predicate);
  });
});

function request(body: unknown, crossSite = false, path = "episodes") {
  return new Request(`http://localhost:4173/api/twin/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept-Language": "en", ...(crossSite ? { "Sec-Fetch-Site": "cross-site" } : {}) },
    body: JSON.stringify(body),
  });
}

function pageRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:4173/api/twin/episodes");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url, { headers: { "Accept-Language": "en" } });
}

async function setStatus(id: string, status: "active" | "dismissed") {
  const response = await POST(request({ id, status }));
  expect(response.status).toBe(200);
}

function getRequest(id?: string, crossSite = false) {
  return new Request(`http://localhost:4173/api/twin/episodes${id ? `?id=${encodeURIComponent(id)}` : ""}`, {
    headers: { "Accept-Language": "en", ...(crossSite ? { "Sec-Fetch-Site": "cross-site" } : {}) },
  });
}

async function historyEpisode() {
  await saveNarratives(database, [{
    identity: "git:atlas", source: "codex", sessionId: "session-a", at: new Date("2026-09-01T12:00:00Z"),
    kind: "opening", text: "Use inline editing for profile details.", context: "The agent suggested a modal.", truncated: false,
  }]);
  const [narrative] = await listNarratives(database);
  const [episode] = await saveDecisionEpisodes(database, [{
    identity: "git:atlas", origin: "history", fields: { decision: { text: "Use inline editing for profile details.", narrativeId: narrative!.id } }, model: "test/extractor",
  }]);
  return { episode: episode!, narrative: narrative! };
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-episode-routes-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: "project-atlas", slug: "atlas", name: "Atlas", root: "/tmp/episode-atlas", identity: "git:atlas" },
    { id: "project-unstable", slug: "unstable", name: "Unstable", root: "/tmp/episode-unstable", identity: null },
  ]);
});

beforeEach(async () => {
  dbMock.mockClear();
  completeMock.mockReset().mockResolvedValue({ text: '{"episodes":[]}', provider: "test", model: "test-extractor" });
  revalidateMock.mockClear();
  process.env["PANOMA_EPISODE_BUDGET"] = "20";
  delete process.env["PANOMA_OPERATOR_KEY"];
  await database.execute("DROP TRIGGER IF EXISTS reject_episode_revision ON decision_episodes");
  await database.delete(schema.decisionEpisodes);
  await database.delete(schema.narratives);
  await database.delete(schema.modelCalls);
});

afterAll(async () => {
  await close();
  for (const [key, value] of [["PANOMA_HOME", originalHome], ["PANOMA_EPISODE_BUDGET", originalBudget], ["PANOMA_OPERATOR_KEY", originalOperator]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(home, { recursive: true, force: true });
});

describe("owner-controlled decision memory", () => {
  it("creates an owner episode without a model call and returns durable structured testimony", async () => {
    const response = await POST(request({ fields: decision }));
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt.episode).toMatchObject({ origin: "owner", model: null, identity: null, status: "active", supersedesId: null, fields: {
      goal: { text: decision.goal }, decision: { text: decision.decision }, rationale: { text: decision.rationale }, exceptions: { text: decision.exceptions },
    } });
    expect(receipt.episodeId).toBe(receipt.episode.id);
    expect(await listDecisionEpisodes(database)).toHaveLength(1);
    expect(completeMock).not.toHaveBeenCalled();
    expect(revalidateMock).toHaveBeenCalledWith("/twin");
    const listed = await GET(getRequest());
    expect(listed.headers.get("cache-control")).toBe("no-store");
    expect(await listed.json()).toMatchObject({ episodes: [{ id: receipt.episodeId }], coverage: { total: 0, pending: 0 } });
  });

  it("keeps simultaneous identical owner saves idempotent", async () => {
    const responses = await Promise.all([POST(request({ fields: decision })), POST(request({ fields: decision }))]);
    const receipts = await Promise.all(responses.map((response) => response.json()));
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(receipts[0].episodeId).toBe(receipts[1].episodeId);
    expect(await listDecisionEpisodes(database)).toHaveLength(1);
  });

  it("dismisses and restores explicitly, treating a repeated status as a successful retry", async () => {
    const { episodeId } = await (await POST(request({ fields: decision }))).json();
    for (const status of ["dismissed", "dismissed", "active", "active"]) {
      expect((await POST(request({ id: episodeId, status }))).status).toBe(200);
      expect(await decisionEpisodeById(database, episodeId)).toMatchObject({ status });
      if (status === "dismissed") {
        const duplicate = await POST(request({ fields: decision }));
        expect(duplicate.status).toBe(400);
        expect(await duplicate.json()).toMatchObject({ code: "dismissedDuplicate", error: expect.stringContaining("dismissed") });
        expect(await decisionEpisodeById(database, episodeId)).toMatchObject({ status: "dismissed" });
      }
    }
    expect((await POST(request({ id: "missing", status: "dismissed" }))).status).toBe(404);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("preserves project scope and rejects unknown or unstable selections", async () => {
    expect((await POST(request({ fields: decision, slug: "missing" }))).status).toBe(404);
    expect((await POST(request({ fields: decision, slug: "unstable" }))).status).toBe(400);
    expect(await listDecisionEpisodes(database)).toEqual([]);
    const response = await POST(request({ fields: decision, slug: "atlas" }));
    expect(response.status).toBe(200);
    expect((await response.json()).episode.identity).toBe("git:atlas");
  });

  it("returns the cited human narrative and keeps assistant context visibly separate", async () => {
    const { episode, narrative } = await historyEpisode();
    const response = await GET(getRequest(episode.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ episode: { id: episode.id, origin: "history" }, evidence: [{ id: narrative.id, text: narrative.text, context: narrative.context, source: "codex" }] });
    expect((await GET(getRequest("missing"))).status).toBe(404);
    expect((await GET(getRequest("x".repeat(101)))).status).toBe(400);
  });

  it("records a revision as owner testimony and atomically dismisses its cited predecessor", async () => {
    const { episode: previous } = await historyEpisode();
    const response = await POST(request({ replacesId: previous.id, fields: { decision: "Require confirmation for destructive edits.", rationale: "The recovery cost is too high." } }));
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt.episode).toMatchObject({ origin: "owner", model: null, identity: "git:atlas", supersedesId: previous.id, status: "active" });
    expect(await decisionEpisodeById(database, previous.id)).toMatchObject({ status: "dismissed", origin: "history" });
    expect(await listDecisionEpisodes(database)).toHaveLength(2);
    expect((await POST(request({ replacesId: previous.id, slug: "atlas", fields: decision }))).status).toBe(400);
    expect((await POST(request({ replacesId: "missing", fields: decision }))).status).toBe(400);
  });

  it("refuses to restore an original while its revision is active, and allows it once the revision is dismissed", async () => {
    const { episode: previous } = await historyEpisode();
    const revised = await (await POST(request({ replacesId: previous.id, fields: { decision: "Require confirmation for destructive edits." } }))).json();
    const refused = await POST(request({ id: previous.id, status: "active" }));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "activeSuccessor" });
    expect(await decisionEpisodeById(database, previous.id)).toMatchObject({ status: "dismissed" });
    expect((await POST(request({ id: revised.episodeId, status: "dismissed" }))).status).toBe(200);
    expect((await POST(request({ id: previous.id, status: "active" }))).status).toBe(200);
    expect((await listDecisionEpisodes(database, { status: "active" })).map((row) => row.id)).toEqual([previous.id]);
  });

  it("refuses restore and revision of an ancestor while a later descendant remains active", async () => {
    const { episodeId: first } = await (await POST(request({ fields: decision }))).json();
    const { episodeId: second } = await (await POST(request({ replacesId: first, fields: { decision: "Second choice." } }))).json();
    const { episodeId: third } = await (await POST(request({ replacesId: second, fields: { decision: "Third choice." } }))).json();
    for (const body of [{ id: first, status: "active" }, { replacesId: first, fields: { decision: "Competing choice." } }]) {
      const response = await POST(request(body));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "activeSuccessor" });
    }
    expect((await listDecisionEpisodes(database, { status: "active" })).map((episode) => episode.id)).toEqual([third]);
    const listed = await (await GET(getRequest())).json();
    expect(listed.episodes.find((episode: { id: string }) => episode.id === first)).toMatchObject({ activeRevisionId: third });
  });

  it("rejects competing revision requests and stale owner views without replacing the winner", async () => {
    const { episode: first } = await (await POST(request({ fields: decision }))).json();
    const responses = await Promise.all(["Second choice.", "Another choice."].map((text) => POST(request({
      replacesId: first.id, expectedUpdatedAt: first.updatedAt, fields: { decision: text },
    }))));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await listDecisionEpisodes(database)).toHaveLength(2);
    const [active] = await listDecisionEpisodes(database, { status: "active" });
    const stale = await POST(request({ id: active!.id, status: "dismissed", expectedUpdatedAt: "2000-01-01T00:00:00Z" }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale" });
    expect(await decisionEpisodeById(database, active!.id)).toMatchObject({ status: "active" });
  });

  it("does not leave a second active record if dismissing the predecessor fails", async () => {
    const { episodeId } = await (await POST(request({ fields: decision }))).json();
    await database.execute(`CREATE OR REPLACE FUNCTION reject_revision_update() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Revision update unavailable'; END $$`);
    await database.execute(`CREATE TRIGGER reject_episode_revision BEFORE UPDATE ON decision_episodes
      FOR EACH ROW EXECUTE FUNCTION reject_revision_update()`);
    await expect(POST(request({ replacesId: episodeId, fields: { decision: "Require confirmation instead." } }))).rejects.toThrow();
    expect(await listDecisionEpisodes(database)).toMatchObject([{ id: episodeId, status: "active" }]);
  });

  it("sets and clears when a decision stops applying, and shows the day on the way out", async () => {
    const { episodeId } = await (await POST(request({ fields: decision }))).json();
    const set = await POST(request({ id: episodeId, validUntil: "2026-12-31" }));
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ id: episodeId, validUntil: "2026-12-31T23:59:59.999Z" });
    // The end of the day in UTC, and not a word of the testimony or the status moved.
    const stored = await decisionEpisodeById(database, episodeId);
    expect(stored).toMatchObject({ status: "active", validUntil: new Date("2026-12-31T23:59:59.999Z") });
    expect(stored!.fields.decision).toEqual({ text: decision.decision });
    const listed = await (await GET(getRequest())).json();
    expect(listed.episodes[0]).toMatchObject({ id: episodeId, validUntil: "2026-12-31T23:59:59.999Z" });
    expect((await (await GET(getRequest(episodeId))).json()).episode.validUntil).toBe("2026-12-31T23:59:59.999Z");
    const cleared = await POST(request({ id: episodeId, validUntil: null }));
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ id: episodeId, validUntil: null });
    expect((await decisionEpisodeById(database, episodeId))!.validUntil).toBeNull();
    expect(revalidateMock).toHaveBeenCalledWith("/twin");
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("records an expiry with the capture itself and refuses a day that is not one", async () => {
    const response = await POST(request({ fields: decision, validUntil: "2027-03-01" }));
    expect(response.status).toBe(200);
    expect((await response.json()).episode.validUntil).toBe("2027-03-01T23:59:59.999Z");
    const refused = await POST(request({ fields: decision, validUntil: "the first of March" }));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: "validUntil" });
    expect(await listDecisionEpisodes(database)).toHaveLength(1);
  });

  it("refuses a malformed expiry, a stale view of the record, and a status in the same request", async () => {
    const { episode } = await (await POST(request({ fields: decision }))).json();
    // 31 February parses in JavaScript and answers 3 March: a day that does not exist is refused.
    for (const validUntil of ["31-12-2026", "2026-13-01", "2026-02-31", "2026-12-3", "2026-12-31T00:00:00Z", 20261231, [], {}, true]) {
      const refused = await POST(request({ id: episode.id, validUntil }));
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ code: "validUntil" });
    }
    expect((await POST(request({ id: episode.id, status: "dismissed", validUntil: "2026-12-31" }))).status).toBe(400);
    const stale = await POST(request({ id: episode.id, validUntil: "2026-12-31", expectedUpdatedAt: "2000-01-01T00:00:00Z" }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale" });
    expect((await decisionEpisodeById(database, episode.id))!.validUntil).toBeNull();
    expect((await POST(request({ id: "missing", validUntil: "2026-12-31" }))).status).toBe(404);
    // The revision the owner actually read goes through.
    expect((await POST(request({ id: episode.id, validUntil: "2026-12-31", expectedUpdatedAt: episode.updatedAt }))).status).toBe(200);
    expect((await decisionEpisodeById(database, episode.id))!.validUntil).toEqual(new Date("2026-12-31T23:59:59.999Z"));
  });

  it("rejects malformed bodies and status arrays with a client error before writing", async () => {
    for (const body of [null, [], "wrong", {}, { fields: {} }, { fields: { goal: "Keep it clear", personality: "Minimalist" } }, { fields: { goal: { text: "Copied", narrativeId: "n1" } } }, { fields: decision, slug: null }, { fields: decision, replacesId: [] }, { id: "missing", status: ["active"] }, { id: "missing", status: {} }, { id: "missing", status: "unknown" }, { id: "missing", status: "active", fields: decision }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    const malformed = new Request("http://localhost:4173/api/twin/episodes", { method: "POST", body: "{" });
    expect((await POST(malformed)).status).toBe(400);
    expect(await listDecisionEpisodes(database)).toEqual([]);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("blocks cross-site and non-operator access before opening the catalog", async () => {
    expect((await POST(request({ fields: decision }, true))).status).toBe(403);
    expect((await GET(getRequest(undefined, true))).status).toBe(403);
    expect((await learnPOST(request({}, true, "episodes/learn"))).status).toBe(403);
    process.env["PANOMA_OPERATOR_KEY"] = "local-operator-test-key";
    expect((await POST(request({ fields: decision }))).status).toBe(403);
    expect((await GET(getRequest())).status).toBe(403);
    expect((await learnPOST(request({}, false, "episodes/learn"))).status).toBe(403);
    expect(dbMock).not.toHaveBeenCalled();
    expect(completeMock).not.toHaveBeenCalled();
  });
});

describe("the archive the owner can walk", () => {
  it("names the other live version on every row, not only on the dismissed ones", async () => {
    const owner = { identity: null, origin: "owner" as const, model: null };
    const [first] = await saveDecisionEpisodes(database, [{ ...owner, fields: { decision: { text: "Choose inline editing." } } }]);
    const [second] = await saveDecisionEpisodes(database, [{ ...owner, supersedesId: first!.id, fields: { decision: { text: "Choose a modal." } } }]);
    // A legacy family: two live versions of one decision, which is what the screen has to resolve.
    // Written straight to the table because no route creates one any more; `drizzle-orm` is not in
    // the web dependency graph, so the statement is raw, like the trigger drop above.
    await database.execute(`update decision_episodes set status = 'active' where id = '${first!.id}'`);

    const page = await (await GET(pageRequest())).json() as { episodes: { id: string; status: string; activeRevisionId: string | null }[] };
    const rows = new Map(page.episodes.map((episode) => [episode.id, episode]));
    expect(rows.get(first!.id)).toMatchObject({ status: "active", activeRevisionId: second!.id });
    expect(rows.get(second!.id)).toMatchObject({ status: "active", activeRevisionId: first!.id });

    await setStatus(second!.id, "dismissed");
    const after = await (await GET(pageRequest())).json() as { episodes: { id: string; activeRevisionId: string | null }[] };
    const settled = new Map(after.episodes.map((episode) => [episode.id, episode.activeRevisionId]));
    expect(settled.get(second!.id)).toBe(first!.id);
    expect(settled.get(first!.id)).toBeNull();
  });

  it("searches the archive by words and refuses a search longer than the input allows", async () => {
    const owner = { identity: null, origin: "owner" as const, model: null };
    await saveDecisionEpisodes(database, [
      { ...owner, fields: { decision: { text: "Use inline editing for profile details." } } },
      { ...owner, fields: { decision: { text: "Keep nightly backups." }, exceptions: { text: "Skip them while migrating." } } },
      { ...owner, fields: { decision: { text: "Ship on Thursdays." } } },
    ]);

    const found = await (await GET(pageRequest({ q: "  INLINE  " }))).json() as { episodes: { fields: Record<string, { text: string }> }[]; nextCursor: string | null };
    expect(found.episodes).toHaveLength(1);
    expect(found.episodes[0]!.fields["decision"]!.text).toContain("inline editing");
    expect(found.nextCursor).toBeNull();

    // The needle reaches a field the card only shows when it is open, and a wildcard is a letter.
    const exception = await (await GET(pageRequest({ q: "migrating" }))).json() as { episodes: unknown[] };
    expect(exception.episodes).toHaveLength(1);
    expect(((await (await GET(pageRequest({ q: "%" }))).json()) as { episodes: unknown[] }).episodes).toHaveLength(0);
    expect(((await (await GET(pageRequest({ q: "   " }))).json()) as { episodes: unknown[] }).episodes).toHaveLength(3);

    const refused = await GET(pageRequest({ q: "x".repeat(EPISODE_QUERY_MAX + 1) }));
    expect(refused.status).toBe(400);
    expect((await refused.json() as { error: string }).error).toContain(String(EPISODE_QUERY_MAX));
  });

  it("hands back a position to continue from, and refuses a position it did not write", async () => {
    const owner = { identity: null, origin: "owner" as const, model: null };
    await saveDecisionEpisodes(database, Array.from({ length: EPISODE_PAGE + 3 }, (_, index) => ({
      ...owner, fields: { decision: { text: `Decision number ${index}.` } },
    })));

    const first = await (await GET(pageRequest())).json() as { episodes: { id: string }[]; nextCursor: string | null };
    expect(first.episodes).toHaveLength(EPISODE_PAGE);
    expect(first.nextCursor).not.toBeNull();

    const older = await (await GET(pageRequest({ before: first.nextCursor! }))).json() as { episodes: { id: string }[]; nextCursor: string | null };
    expect(older.episodes).toHaveLength(3);
    expect(older.nextCursor).toBeNull();
    // No row is served twice and none is skipped: the two pages are the whole archive.
    expect(new Set([...first.episodes, ...older.episodes].map((episode) => episode.id)).size).toBe(EPISODE_PAGE + 3);

    expect((await GET(pageRequest({ before: "not a cursor" }))).status).toBe(400);
    expect((await GET(pageRequest({ before: episodeCursor({ createdAt: "2026-09-06T12:00:00.000Z", id: "absent" }) }))).status).toBe(200);
  });
});

describe("decision learning HTTP receipts", () => {
  it("previews without payment and accepts a later explicit learning call", async () => {
    await historyEpisode();
    const preview = await learnPOST(request({ dryRun: true }, false, "episodes/learn"));
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ selected: 1, calls: 1, provider: "test" });
    expect(completeMock).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
    expect(await narrativeCount(database)).toEqual({ total: 1, pending: 1, deferred: 0 });
    const learned = await learnPOST(request({}, false, "episodes/learn"));
    expect(learned.status).toBe(200);
    expect(await learned.json()).toMatchObject({ processed: 1, stored: 0, remaining: 0 });
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("reports exhausted budget and unsupported model output without losing pending evidence", async () => {
    await historyEpisode();
    process.env["PANOMA_EPISODE_BUDGET"] = "0";
    const exhausted = await learnPOST(request({}, false, "episodes/learn"));
    expect(exhausted.status).toBe(429);
    expect(await exhausted.json()).toMatchObject({ remainingCalls: 0 });
    expect(completeMock).not.toHaveBeenCalled();
    process.env["PANOMA_EPISODE_BUDGET"] = "20";
    completeMock.mockResolvedValue({ text: "truncated {", provider: "test", model: "test-extractor", stopReason: "length" });
    const cut = await learnPOST(request({}, false, "episodes/learn"));
    expect(cut.status).toBe(502);
    expect(await cut.json()).toMatchObject({ code: "cut", error: expect.stringContaining("cut at the output limit") });
    expect(await narrativeCount(database)).toEqual({ total: 1, pending: 1, deferred: 1 });
    expect((await modelSpendToday(database, "episodes")).calls).toBe(1);
  });

  it("rejects invalid learning flags before a provider call", async () => {
    for (const body of [null, [], { dryRun: "true" }, { dryRun: 1 }, { dryRun: null }]) {
      expect((await learnPOST(request(body, false, "episodes/learn"))).status).toBe(400);
    }
    expect(completeMock).not.toHaveBeenCalled();
    expect(dbMock).not.toHaveBeenCalled();
  });
});
