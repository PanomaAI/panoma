import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readConsent } from "@panoma/core";
import {
  claimJob, enqueueBatchJob, enqueueMemoryJob, jobById, publishJob, schema, stageJob, type Database, type JobManifest,
} from "@panoma/db";
import { CAPTURE_SOURCES } from "@/lib/memory-view";

/*
  The sources door with its two bodies, called for real against a PGlite in a temporary home and
  a temporary user home (so the inventory measures nothing of this machine). Written on
  14-Sep-2026 with the memory contract v2 and widened the same day for delivery B. What is
  watched: the legacy `{ source, allowed }` body and its answer are what they were, with `grants`
  and `permissions` beside them; the grant alternative refuses a missing scope by name (never a
  global permission by omission), a slug on a global grant, no slug on a project one, an unknown
  key, a purpose this version cannot honour, a notice version the purpose does not show; it asks
  for the base permission first (`consent_required`), refuses a source without a reader
  (`unsupported_source`), resolves the slug to the project's identity, answers the grant's
  revision and refuses a stale one; `memoryExtract` is granted only on top of an enabled capture
  of the same scope; notice version 2 opens the facts without moving the generation and a
  revocation never lowers it; the GET names each project grant by its slug, says per source
  whether a receipt reader exists (`captureSupported`) and, with a slug, the effective
  permissions of that project; and a revocation fences the extraction jobs in flight (T76):
  staged answers become unpublishable in the same request, the legacy distiller's job and another
  harness's job stay. Delivery D (the same day) adds the third purpose: `twinAutoLearn` is granted
  on top of an enabled capture of the same scope like the extraction, at its own notice version 1,
  it is reported by the GET as the other two, a grant of it alone opens no extraction and a grant
  of extraction alone opens no learning (T62), and its revocation fences exactly the Twin's three
  processors and never the extraction's — the two fences are kept apart, and only the capture (or
  the source itself, through the legacy body) fences both.
 */

vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
const { GET, POST } = await import("./route");

let database: Database;
let close: () => Promise<void>;
let home: string;
let userHome: string;
const previous = { PANOMA_HOME: process.env["PANOMA_HOME"], HOME: process.env["HOME"], USERPROFILE: process.env["USERPROFILE"], DATABASE_URL: process.env["DATABASE_URL"], PANOMA_OPERATOR_KEY: process.env["PANOMA_OPERATOR_KEY"] };
interface Fixture { id: string; slug: string; name: string; identity: string | null }
const PROJECT: Fixture = { id: "sources-a", slug: "sources-a", name: "Sources A", identity: "git:sources-a" };
const OTHER: Fixture = { id: "sources-b", slug: "sources-b", name: "Sources B", identity: null };
const STAGED_SECRET = "STAGED-SECRET-STATEMENT";

function post(body: unknown): Promise<Response> {
  return POST(new Request("http://localhost:4173/api/twin/sources", {
    method: "POST", headers: { "content-type": "application/json", "accept-language": "en" }, body: JSON.stringify(body),
  }));
}

function get(query = ""): Promise<Response> {
  return GET(new Request(`http://localhost:4173/api/twin/sources${query}`, { headers: { "accept-language": "en" } }));
}

const capture = (extra: Record<string, unknown>) => ({ source: "claude-code", purpose: "memoryCapture", allowed: true, noticeVersion: 1, ...extra });
const extract = (extra: Record<string, unknown>) => ({ source: "claude-code", purpose: "memoryExtract", allowed: true, noticeVersion: 1, ...extra });
const learn = (extra: Record<string, unknown>) => ({ source: "claude-code", purpose: "twinAutoLearn", allowed: true, noticeVersion: 1, ...extra });
type TwinProcessor = "twin_distill" | "twin_classify" | "twin_synthesize";

function manifestFor(harness: string, sourceId: string): JobManifest {
  return {
    schemaVersion: 1, processor: "project_extract", processorVersion: "project_extract-1", promptVersion: "project-extract-1",
    scopeRef: PROJECT.identity ?? PROJECT.id, origin: "automatic",
    intervals: [{ sourceId, generation: 1, grantId: "grant_0123456789ab", start: 0, end: 4_096, parserVersion: `${harness}-facts-1` }],
    evidenceRefs: ["fact_one"], contextRefs: [], permissionSnapshot: { harness, grantIds: { capture: "grant_0123456789ab" } },
  };
}

/**
 * A staged job of one of the Twin's processors, written as the learning pass of delivery D writes
 * it: `purpose: "twin_learn"`, the project and its scope key, the harness in the manifest. Inserted
 * as a row because `enqueueBatchJob` closes its processors and the twin ones are that engineer's;
 * the fence reads rows, never the writer.
 */
async function stagedTwinJob(harness: string, processor: TwinProcessor, workKey: string, project: Fixture = PROJECT, status: "staged" | "pending" = "staged") {
  const id = `twin_${workKey}`;
  await database.insert(schema.memoryJobs).values({
    id, processor, workKey, scopeKey: project.identity ?? project.id, projectId: project.id, purpose: "twin_learn", origin: "automatic",
    status, attempts: status === "staged" ? 1 : 0, rev: 2, requestedRev: 1,
    inputManifest: { ...manifestFor(harness, `msrc_${workKey}`), processor, scopeRef: project.identity ?? project.id },
    inputHash: workKey,
    ...(status === "staged" ? { leaseToken: `lease_${workKey}`, leaseUntil: new Date(Date.now() + 60_000), stagedOutput: { schemaVersion: 1, observations: [{ statement: STAGED_SECRET }] } } : {}),
  });
  return id;
}

/** A staged extraction job of the project: paid for, waiting to be published. */
async function stagedJob(harness: string, workKey: string, project: Fixture = PROJECT) {
  const { id } = await enqueueBatchJob(database, {
    processor: "project_extract", purpose: "project_extract", origin: "automatic", projectId: project.id, scopeKey: project.identity ?? project.id,
    workKey, manifest: { ...manifestFor(harness, `msrc_${workKey}`), scopeRef: project.identity ?? project.id },
  });
  const claim = (await claimJob(database, "project_extract", {}))!;
  expect(claim.id).toBe(id);
  expect(await stageJob(database, id, claim, { output: { schemaVersion: 1, candidates: [{ operation: "add", statement: STAGED_SECRET }] }, coverage: {} })).toBe(true);
  return { id, claim };
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-sources-route-"));
  userHome = realpathSync(mkdtempSync(join(tmpdir(), "panoma-sources-route-user-")));
  mkdirSync(join(userHome, ".claude", "projects"), { recursive: true });
  process.env["PANOMA_HOME"] = home;
  process.env["HOME"] = userHome;
  process.env["USERPROFILE"] = userHome;
  delete process.env["DATABASE_URL"];
  delete process.env["PANOMA_OPERATOR_KEY"];
  ({ db: database, close } = await (await import("@panoma/db/client")).openDatabase());
  await database.insert(schema.projects).values([
    { ...PROJECT, root: join(userHome, "dev", "a") },
    { ...OTHER, root: join(userHome, "dev", "b") },
  ]);
  await database.insert(schema.agents).values({ id: "agent-sources", name: "Agent", apiKeyHash: "hash-sources" });
});

beforeEach(async () => {
  await rm(join(home, "twin.json"), { force: true });
  await database.delete(schema.memoryJobs);
  await database.delete(schema.agentSessions);
});

afterAll(async () => {
  await close();
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await rm(home, { recursive: true, force: true });
  await rm(userHome, { recursive: true, force: true });
});

describe("the legacy body and the inventory", () => {
  it("still grants the base permission with { source, allowed } and answers the snapshot, now with grants and permissions", async () => {
    const response = await post({ source: "claude-code", allowed: true });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["grants", "permissions", "sources", "updatedAt"]);
    expect(body["grants"]).toEqual([]);
    expect((body["sources"] as { id: string; state: string }[]).find((source) => source.id === "claude-code")).toMatchObject({ state: "allowed" });
    expect((await readConsent(home)).sources["claude-code"]).toBe(true);
    expect((await (await get()).json()) as Record<string, unknown>).toMatchObject({ grants: [] });
    // Per source, whether a receipt reader exists: the same set the grant door refuses with, so a screen never offers a switch the door would refuse.
    const listed = ((await (await get()).json()) as { sources: { id: string; captureSupported: boolean }[] }).sources;
    expect(listed.map((source) => [source.id, source.captureSupported])).toEqual(expect.arrayContaining([["claude-code", true], ["codex", true], ["cursor", false]]));
    for (const source of listed) expect(source.captureSupported, source.id).toBe(CAPTURE_SOURCES.has(source.id));
    // The malformed legacy body is refused as it always was, with the person's sentence.
    expect((await post({ source: "claude-code" })).status).toBe(400);
  });
});

describe("the memoryCapture grant", () => {
  it("refuses the shapes that would grant more than was said, by name, and writes nothing", async () => {
    await post({ source: "claude-code", allowed: true });
    const cases: [Record<string, unknown>, string][] = [
      [capture({}), expect.stringContaining("scope must be project or global") as unknown as string],
      [capture({ scope: "global", slug: PROJECT.slug }), expect.stringContaining("global grant names no slug") as unknown as string],
      [capture({ scope: "project" }), expect.stringContaining("slug") as unknown as string],
      [capture({ scope: "project", slug: PROJECT.slug, force: true }), "force is not a known property."],
      [capture({ scope: "project", slug: PROJECT.slug, purpose: "everything" }), "purpose must be memoryCapture, memoryExtract or twinAutoLearn."],
      [capture({ scope: "project", slug: PROJECT.slug, purpose: "twin" }), "purpose must be memoryCapture, memoryExtract or twinAutoLearn."],
      [learn({ scope: "project", slug: PROJECT.slug, noticeVersion: 2 }), expect.stringContaining("noticeVersion must be 1 for twinAutoLearn") as unknown as string],
      [capture({ scope: "project", slug: PROJECT.slug, noticeVersion: 3 }), expect.stringContaining("noticeVersion must be 1 or 2 for memoryCapture") as unknown as string],
      [capture({ scope: "project", slug: PROJECT.slug, noticeVersion: "2" }), expect.stringContaining("noticeVersion") as unknown as string],
      [extract({ scope: "project", slug: PROJECT.slug, noticeVersion: 2 }), expect.stringContaining("noticeVersion must be 1 for memoryExtract") as unknown as string],
      [capture({ scope: "project", slug: PROJECT.slug, allowed: "yes" }), "allowed must be true or false."],
      [capture({ scope: "project", slug: PROJECT.slug, expectedRevision: -1 }), expect.stringContaining("expectedRevision") as unknown as string],
      [capture({ scope: "global", source: "typewriter" }), "typewriter is not a history source of this machine."],
    ];
    for (const [body, error] of cases) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ code: "invalid_input", error, retryable: false });
    }
    const unknown = await post(capture({ scope: "project", slug: "nowhere" }));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: "not_found" });
    expect((await readConsent(home)).grants).toBeUndefined();
  });

  it("asks for the base permission first, and for a source the reader can read", async () => {
    const early = await post(capture({ scope: "project", slug: PROJECT.slug }));
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ code: "consent_required", retryable: false, hint: expect.stringContaining("Allow") });
    await post({ source: "cursor", allowed: true });
    const cursor = await post(capture({ source: "cursor", scope: "global" }));
    expect(cursor.status).toBe(409);
    // The machine shape, for the CLI; the card translates the code (memory-view.test.ts).
    expect(await cursor.json()).toMatchObject({ code: "unsupported_source", error: expect.stringContaining("cursor"), retryable: false });
    expect(CAPTURE_SOURCES.has("cursor")).toBe(false);
    // Codex is read by the capture pass of delivery B (its facts, never receipts): a grant is accepted.
    expect(CAPTURE_SOURCES.has("codex")).toBe(true);
    expect((await readConsent(home)).grants).toBeUndefined();
  });

  it("grants by slug, answers the revision, lists the grant with its slug, and refuses a stale revision", async () => {
    await post({ source: "claude-code", allowed: true });
    const granted = await post(capture({ scope: "project", slug: PROJECT.slug }));
    expect(granted.status).toBe(200);
    const body = (await granted.json()) as Record<string, unknown>;
    expect(body["permissionRevision"]).toBe(1);
    expect(body).not.toHaveProperty("jobsObsoleted");
    expect(body["grants"]).toEqual([expect.objectContaining({ source: "claude-code", purpose: "memoryCapture", scope: "project", slug: PROJECT.slug, allowed: true, permissionRevision: 1, noticeVersion: 1 })]);
    const consent = await readConsent(home);
    expect(consent.grants).toHaveLength(1);
    expect(consent.grants![0]).toMatchObject({ scope: "project", scopeKeys: [PROJECT.identity], enabled: true });

    const stale = await post(capture({ scope: "project", slug: PROJECT.slug, allowed: false, expectedRevision: 7 }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_revision", retryable: false });
    expect((await readConsent(home)).grants![0]).toMatchObject({ enabled: true });

    const revoked = await post(capture({ scope: "project", slug: PROJECT.slug, allowed: false, expectedRevision: 1 }));
    expect(revoked.status).toBe(200);
    const revocation = (await revoked.json()) as { grants: { allowed: boolean }[]; jobsObsoleted: number };
    expect(revocation.grants).toEqual([expect.objectContaining({ slug: PROJECT.slug, allowed: false })]);
    expect(revocation.jobsObsoleted).toBe(0);

    // A project without an identity is keyed by its id, and a global grant by `*`, listed without a slug.
    const byId = await post(capture({ scope: "project", slug: OTHER.slug }));
    expect(byId.status).toBe(200);
    const global = await post(capture({ scope: "global" }));
    expect(global.status).toBe(200);
    const listed = ((await (await get()).json()) as { grants: { scope: string; slug?: string }[] }).grants;
    expect(listed).toHaveLength(3);
    expect(listed.find((grant) => grant.scope === "global")).not.toHaveProperty("slug");
    expect(listed.filter((grant) => grant.scope === "project").map((grant) => grant.slug).sort()).toEqual([PROJECT.slug, OTHER.slug]);
    expect((await readConsent(home)).grants!.map((grant) => grant.scopeKeys)).toEqual(expect.arrayContaining([[PROJECT.identity], [OTHER.id], ["*"]]));
  });

  it("opens the facts with notice version 2 without moving the generation, and a revocation never lowers the notice", async () => {
    await post({ source: "claude-code", allowed: true });
    expect((await post(capture({ scope: "global" }))).status).toBe(200);
    const raised = await post(capture({ scope: "global", noticeVersion: 2, expectedRevision: 1 }));
    expect(raised.status).toBe(200);
    expect(await raised.json()).toMatchObject({ permissionRevision: 1, grants: [expect.objectContaining({ noticeVersion: 2, permissionRevision: 1, allowed: true })] });
    const before = (await readConsent(home)).grants![0]!;
    expect(before).toMatchObject({ generation: 1, noticeVersion: 2 });

    // The CLI sends notice 1 with every revocation; the grant keeps the 2 the person accepted.
    const revoked = await post(capture({ scope: "global", allowed: false, noticeVersion: 1 }));
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ permissionRevision: 2, grants: [expect.objectContaining({ noticeVersion: 2, permissionRevision: 2, allowed: false })] });
    expect((await readConsent(home)).grants![0]).toMatchObject({ generation: 2, noticeVersion: 2, enabled: false, activatedAt: before.activatedAt });
  });

  it("needs the local catalog: a grant names this disk's transcripts", async () => {
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    try {
      const response = await post(capture({ scope: "global" }));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "local_catalog_required" });
    } finally {
      delete process.env["DATABASE_URL"];
    }
  });
});

describe("the memoryExtract grant", () => {
  it("is granted only on top of an enabled capture of the same scope: the base permission first, then the capture, then the extraction", async () => {
    const floorless = await post(extract({ scope: "project", slug: PROJECT.slug }));
    expect(floorless.status).toBe(409);
    expect(await floorless.json()).toMatchObject({ code: "consent_required", error: expect.stringContaining("base permission") });
    await post({ source: "claude-code", allowed: true });

    const uncaptured = await post(extract({ scope: "project", slug: PROJECT.slug }));
    expect(uncaptured.status).toBe(409);
    expect(await uncaptured.json()).toMatchObject({ code: "consent_required", error: expect.stringContaining("memoryCapture"), hint: expect.stringContaining("capture"), retryable: false });
    expect((await readConsent(home)).grants).toBeUndefined();

    // A project capture does not cover a global extraction: the scopes must match.
    expect((await post(capture({ scope: "project", slug: PROJECT.slug }))).status).toBe(200);
    const wider = await post(extract({ scope: "global" }));
    expect(wider.status).toBe(409);
    expect(await wider.json()).toMatchObject({ code: "consent_required" });

    const granted = await post(extract({ scope: "project", slug: PROJECT.slug }));
    expect(granted.status).toBe(200);
    const body = (await granted.json()) as { permissionRevision: number; grants: Record<string, unknown>[]; permissions: Record<string, { memoryExtract: Record<string, unknown> }> };
    expect(body.permissionRevision).toBe(1);
    expect(body.grants).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: "memoryExtract", scope: "project", slug: PROJECT.slug, allowed: true, permissionRevision: 1, noticeVersion: 1 })]));
    expect(body.permissions["claude-code"]!.memoryExtract).toEqual({ allowed: true, decidedBy: "project", permissionRevision: 1, noticeVersion: 1 });
    expect((await readConsent(home)).grants!.find((grant) => grant.purpose === "memoryExtract")).toMatchObject({ scopeKeys: [PROJECT.identity], enabled: true, noticeVersion: 1 });

    // A global capture covers a global extraction, and the stale revision rule is the same.
    expect((await post(capture({ scope: "global" }))).status).toBe(200);
    expect((await post(extract({ scope: "global", expectedRevision: 0 }))).status).toBe(200);
    const stale = await post(extract({ scope: "global", allowed: false, expectedRevision: 0 }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_revision" });
  });

  it("T76: revoking a grant fences the extraction jobs in flight — the staged answer is dropped and the old claim cannot publish; the distiller's job and another harness's stay", async () => {
    await post({ source: "claude-code", allowed: true });
    expect((await post(capture({ scope: "project", slug: PROJECT.slug, noticeVersion: 2 }))).status).toBe(200);
    expect((await post(extract({ scope: "project", slug: PROJECT.slug }))).status).toBe(200);
    const claude = await stagedJob("claude-code", "window-claude");
    const codex = await stagedJob("codex", "window-codex");
    await database.insert(schema.agentSessions).values({ id: "session-sources", agentId: "agent-sources", projectId: PROJECT.id, endedAt: new Date() });
    await enqueueMemoryJob(database, "session-sources");

    const revoked = await post(extract({ scope: "project", slug: PROJECT.slug, allowed: false, expectedRevision: 1 }));
    expect(revoked.status).toBe(200);
    const text = await revoked.clone().text();
    expect(await revoked.json()).toMatchObject({ permissionRevision: 2, jobsObsoleted: 1 });
    expect(text).not.toContain(STAGED_SECRET);

    const fenced = (await jobById(database, claude.id))!;
    expect(fenced).toMatchObject({ status: "obsolete", reason: "permission_revoked", stagedOutput: null, leaseToken: null });
    expect(fenced.rev).toBeGreaterThan(claude.claim.rev);
    expect(await publishJob(database, claude.id, claude.claim, async () => "published")).toEqual({ current: false });
    expect(JSON.stringify(fenced)).not.toContain(STAGED_SECRET);
    // The codex window kept its permission, and the legacy distiller's job never depended on one.
    expect((await jobById(database, codex.id))!).toMatchObject({ status: "staged" });
    expect((await jobById(database, "legacy:session-sources"))!).toMatchObject({ status: "pending" });

    // The same revocation again finishes nothing more.
    const again = await post(extract({ scope: "project", slug: PROJECT.slug, allowed: false }));
    expect(await again.json()).toMatchObject({ jobsObsoleted: 0 });
  });

  it("T76: revoking the global capture fences every project the revocation leaves without extraction, and spares one with its own grants", async () => {
    await post({ source: "claude-code", allowed: true });
    expect((await post(capture({ scope: "global", noticeVersion: 2 }))).status).toBe(200);
    expect((await post(extract({ scope: "global" }))).status).toBe(200);
    // The other project has explicit grants of its own: the global revocation does not reach it.
    expect((await post(capture({ scope: "project", slug: OTHER.slug, noticeVersion: 2 }))).status).toBe(200);
    expect((await post(extract({ scope: "project", slug: OTHER.slug }))).status).toBe(200);
    const covered = await stagedJob("claude-code", "window-global-a");
    const own = await stagedJob("claude-code", "window-global-b", OTHER);

    const revoked = await post(capture({ scope: "global", allowed: false, noticeVersion: 1 }));
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ jobsObsoleted: 1, grants: expect.arrayContaining([expect.objectContaining({ scope: "global", purpose: "memoryCapture", allowed: false, noticeVersion: 2 })]) });
    expect((await jobById(database, covered.id))!).toMatchObject({ status: "obsolete", reason: "permission_revoked", stagedOutput: null });
    expect((await jobById(database, own.id))!).toMatchObject({ status: "staged" });
    expect(await publishJob(database, covered.id, covered.claim, async () => "published")).toEqual({ current: false });
  });
});

describe("the twinAutoLearn grant (delivery D)", () => {
  it("is granted only on top of an enabled capture of the same scope, at notice 1, and the GET reports it as the other two", async () => {
    const floorless = await post(learn({ scope: "project", slug: PROJECT.slug }));
    expect(floorless.status).toBe(409);
    expect(await floorless.json()).toMatchObject({ code: "consent_required", error: expect.stringContaining("base permission") });
    await post({ source: "claude-code", allowed: true });

    const uncaptured = await post(learn({ scope: "project", slug: PROJECT.slug }));
    expect(uncaptured.status).toBe(409);
    expect(await uncaptured.json()).toMatchObject({
      code: "consent_required", error: expect.stringContaining("the Twin learns on top of capture"), hint: expect.stringContaining("then the learning"), retryable: false,
    });
    expect((await readConsent(home)).grants).toBeUndefined();

    // A project capture does not cover a global learning: the scopes must match, as for the extraction.
    expect((await post(capture({ scope: "project", slug: PROJECT.slug }))).status).toBe(200);
    const wider = await post(learn({ scope: "global" }));
    expect(wider.status).toBe(409);
    expect(await wider.json()).toMatchObject({ code: "consent_required" });

    const granted = await post(learn({ scope: "project", slug: PROJECT.slug }));
    expect(granted.status).toBe(200);
    expect(granted.headers.get("cache-control")).toBe("private, no-store");
    const body = (await granted.json()) as { permissionRevision: number; grants: Record<string, unknown>[]; permissions: Record<string, Record<string, unknown>> };
    expect(body.permissionRevision).toBe(1);
    expect(body).not.toHaveProperty("jobsObsoleted");
    expect(body.grants).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: "twinAutoLearn", scope: "project", slug: PROJECT.slug, allowed: true, permissionRevision: 1, noticeVersion: 1 })]));
    expect(body.permissions["claude-code"]!["twinAutoLearn"]).toEqual({ allowed: true, decidedBy: "project", permissionRevision: 1, noticeVersion: 1 });
    expect((await readConsent(home)).grants!.find((grant) => grant.purpose === "twinAutoLearn")).toMatchObject({ scopeKeys: [PROJECT.identity], enabled: true, noticeVersion: 1, generation: 1 });

    // The GET says the same, per slug and without one; the publication switch is not touched by a grant.
    const viewed = (await (await get(`?slug=${PROJECT.slug}`)).json()) as { grants: Record<string, unknown>[]; permissions: Record<string, Record<string, unknown>> };
    expect(viewed.permissions["claude-code"]!["twinAutoLearn"]).toEqual({ allowed: true, decidedBy: "project", permissionRevision: 1, noticeVersion: 1 });
    expect(viewed.grants.filter((grant) => grant["purpose"] === "twinAutoLearn")).toHaveLength(1);
    expect(((await (await get()).json()) as { permissions: Record<string, Record<string, unknown>> }).permissions["claude-code"]!["twinAutoLearn"]).toEqual({ allowed: false, decidedBy: null, permissionRevision: 0, noticeVersion: 0 });
    expect((await readConsent(home)).inferred).toBeUndefined();

    // The stale revision rule is the same as for the other two.
    const stale = await post(learn({ scope: "project", slug: PROJECT.slug, allowed: false, expectedRevision: 0 }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_revision" });
    expect((await readConsent(home)).grants!.find((grant) => grant.purpose === "twinAutoLearn")).toMatchObject({ enabled: true });
  });

  it("T62: a learning grant alone opens no extraction, and an extraction grant alone opens no learning", async () => {
    await post({ source: "claude-code", allowed: true });
    expect((await post(capture({ scope: "project", slug: PROJECT.slug, noticeVersion: 2 }))).status).toBe(200);
    expect((await post(learn({ scope: "project", slug: PROJECT.slug }))).status).toBe(200);
    const learning = (await (await get(`?slug=${PROJECT.slug}`)).json()) as { permissions: Record<string, Record<string, unknown>> };
    expect(learning.permissions["claude-code"]).toMatchObject({
      memoryCapture: { allowed: true },
      memoryExtract: { allowed: false, decidedBy: null, permissionRevision: 0 },
      twinAutoLearn: { allowed: true, decidedBy: "project", permissionRevision: 1 },
    });

    expect((await post(capture({ scope: "project", slug: OTHER.slug, noticeVersion: 2 }))).status).toBe(200);
    expect((await post(extract({ scope: "project", slug: OTHER.slug }))).status).toBe(200);
    const extracting = (await (await get(`?slug=${OTHER.slug}`)).json()) as { permissions: Record<string, Record<string, unknown>> };
    expect(extracting.permissions["claude-code"]).toMatchObject({
      memoryExtract: { allowed: true, decidedBy: "project" },
      twinAutoLearn: { allowed: false, decidedBy: null, permissionRevision: 0 },
    });
  });

  it("T76: revoking the learning fences exactly the Twin's processors of that scope — the extraction job, the other harness's, the other project's and the distiller's stay", async () => {
    await post({ source: "claude-code", allowed: true });
    expect((await post(capture({ scope: "project", slug: PROJECT.slug, noticeVersion: 2 }))).status).toBe(200);
    expect((await post(extract({ scope: "project", slug: PROJECT.slug }))).status).toBe(200);
    expect((await post(learn({ scope: "project", slug: PROJECT.slug }))).status).toBe(200);
    expect((await post(capture({ scope: "project", slug: OTHER.slug, noticeVersion: 2 }))).status).toBe(200);
    expect((await post(learn({ scope: "project", slug: OTHER.slug }))).status).toBe(200);
    const extraction = await stagedJob("claude-code", "window-extract");
    const distill = await stagedTwinJob("claude-code", "twin_distill", "distill-a");
    const classify = await stagedTwinJob("claude-code", "twin_classify", "classify-a", PROJECT, "pending");
    const synthesize = await stagedTwinJob("claude-code", "twin_synthesize", "synth-a");
    const codex = await stagedTwinJob("codex", "twin_distill", "distill-codex");
    const other = await stagedTwinJob("claude-code", "twin_distill", "distill-b", OTHER);
    await database.insert(schema.agentSessions).values({ id: "session-twin", agentId: "agent-sources", projectId: PROJECT.id, endedAt: new Date() });
    await enqueueMemoryJob(database, "session-twin");

    const revoked = await post(learn({ scope: "project", slug: PROJECT.slug, allowed: false, expectedRevision: 1 }));
    expect(revoked.status).toBe(200);
    const text = await revoked.clone().text();
    expect(await revoked.json()).toMatchObject({ permissionRevision: 2, jobsObsoleted: 3, grants: expect.arrayContaining([expect.objectContaining({ purpose: "twinAutoLearn", slug: PROJECT.slug, allowed: false })]) });
    expect(text).not.toContain(STAGED_SECRET);
    for (const id of [distill, classify, synthesize]) {
      const fenced = (await jobById(database, id))!;
      expect(fenced, id).toMatchObject({ status: "obsolete", reason: "permission_revoked", stagedOutput: null, leaseToken: null });
      expect(fenced.rev, id).toBeGreaterThan(2);
      expect(JSON.stringify(fenced)).not.toContain(STAGED_SECRET);
    }
    // The two fences are kept apart: the extraction of the same scope keeps its permission and its staged answer.
    expect((await jobById(database, extraction.id))!).toMatchObject({ status: "staged" });
    expect(await publishJob(database, extraction.id, extraction.claim, async () => "published")).toMatchObject({ current: true });
    expect((await jobById(database, codex))!).toMatchObject({ status: "staged" });
    expect((await jobById(database, other))!).toMatchObject({ status: "staged" });
    expect((await jobById(database, "legacy:session-twin"))!).toMatchObject({ status: "pending" });
    // And the person's own word is not a job: the grant view lists the other grants exactly as they were.
    expect((await readConsent(home)).grants!.filter((grant) => grant.enabled).map((grant) => grant.purpose).sort()).toEqual(["memoryCapture", "memoryCapture", "memoryExtract", "twinAutoLearn"]);

    // The same revocation again finishes nothing more.
    const again = await post(learn({ scope: "project", slug: PROJECT.slug, allowed: false }));
    expect(await again.json()).toMatchObject({ jobsObsoleted: 0 });
  });

  it("T76: revoking the extraction leaves the Twin's jobs alone, and revoking the capture fences both families", async () => {
    await post({ source: "claude-code", allowed: true });
    expect((await post(capture({ scope: "project", slug: PROJECT.slug, noticeVersion: 2 }))).status).toBe(200);
    expect((await post(extract({ scope: "project", slug: PROJECT.slug }))).status).toBe(200);
    expect((await post(learn({ scope: "project", slug: PROJECT.slug }))).status).toBe(200);
    const extraction = await stagedJob("claude-code", "window-extract-2");
    const twin = await stagedTwinJob("claude-code", "twin_synthesize", "synth-2");

    const extractOff = await post(extract({ scope: "project", slug: PROJECT.slug, allowed: false }));
    expect(await extractOff.json()).toMatchObject({ jobsObsoleted: 1 });
    expect((await jobById(database, extraction.id))!).toMatchObject({ status: "obsolete", reason: "permission_revoked" });
    expect((await jobById(database, twin))!).toMatchObject({ status: "staged" });

    const captureOff = await post(capture({ scope: "project", slug: PROJECT.slug, allowed: false }));
    expect(await captureOff.json()).toMatchObject({ jobsObsoleted: 1 });
    expect((await jobById(database, twin))!).toMatchObject({ status: "obsolete", reason: "permission_revoked", stagedOutput: null });
  });

  it("T76: revoking the global learning fences every project it leaves without one, and spares a project with its own grant", async () => {
    await post({ source: "claude-code", allowed: true });
    expect((await post(capture({ scope: "global", noticeVersion: 2 }))).status).toBe(200);
    expect((await post(learn({ scope: "global" }))).status).toBe(200);
    expect((await post(capture({ scope: "project", slug: OTHER.slug, noticeVersion: 2 }))).status).toBe(200);
    expect((await post(learn({ scope: "project", slug: OTHER.slug }))).status).toBe(200);
    const covered = await stagedTwinJob("claude-code", "twin_distill", "global-a");
    const own = await stagedTwinJob("claude-code", "twin_distill", "global-b", OTHER);

    const revoked = await post(learn({ scope: "global", allowed: false }));
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ jobsObsoleted: 1 });
    expect((await jobById(database, covered))!).toMatchObject({ status: "obsolete", reason: "permission_revoked" });
    expect((await jobById(database, own))!).toMatchObject({ status: "staged" });
  });

  it("the legacy body: taking the source itself back fences both families of every project, and granting it keeps its answer", async () => {
    await post({ source: "claude-code", allowed: true });
    expect((await post(capture({ scope: "global", noticeVersion: 2 }))).status).toBe(200);
    expect((await post(extract({ scope: "global" }))).status).toBe(200);
    expect((await post(learn({ scope: "global" }))).status).toBe(200);
    const extraction = await stagedJob("claude-code", "window-floor");
    const twin = await stagedTwinJob("claude-code", "twin_classify", "classify-floor", OTHER);
    const codex = await stagedTwinJob("codex", "twin_distill", "distill-floor-codex");

    const revoked = await post({ source: "claude-code", allowed: false });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ jobsObsoleted: 2 });
    expect((await jobById(database, extraction.id))!).toMatchObject({ status: "obsolete", reason: "permission_revoked", stagedOutput: null });
    expect((await jobById(database, twin))!).toMatchObject({ status: "obsolete", reason: "permission_revoked", stagedOutput: null });
    expect((await jobById(database, codex))!).toMatchObject({ status: "staged" });
    // The grants stay written, dead under the floor, exactly as `consent.ts` says.
    expect((await readConsent(home)).grants!.filter((grant) => grant.enabled)).toHaveLength(3);

    const back = await post({ source: "claude-code", allowed: true });
    expect(Object.keys((await back.json()) as object).sort()).toEqual(["grants", "permissions", "sources", "updatedAt"]);
  });
});

describe("the GET with a slug", () => {
  it("describes the effective permissions of that project per source and purpose, and the global ones without a slug", async () => {
    await post({ source: "claude-code", allowed: true });
    expect((await post(capture({ scope: "global", noticeVersion: 2 }))).status).toBe(200);
    expect((await post(capture({ scope: "project", slug: PROJECT.slug, allowed: false }))).status).toBe(200);
    expect((await post(extract({ scope: "global" }))).status).toBe(200);

    const denied = (await (await get(`?slug=${PROJECT.slug}`)).json()) as { permissions: Record<string, Record<string, unknown>> };
    expect(denied.permissions["claude-code"]).toEqual({
      sourceAllowed: true,
      // The explicit no of the project wins over the global yes (plan §25.1), and the project's own grant is what a client revises.
      memoryCapture: { allowed: false, decidedBy: "project", permissionRevision: 1, noticeVersion: 1 },
      // Extraction is dead without capture, even with a global extraction grant on.
      memoryExtract: { allowed: false, decidedBy: "global", permissionRevision: 0, noticeVersion: 0 },
      twinAutoLearn: { allowed: false, decidedBy: null, permissionRevision: 0, noticeVersion: 0 },
    });
    expect(denied.permissions["codex"]).toMatchObject({ sourceAllowed: false, memoryCapture: { allowed: false, decidedBy: null } });

    const covered = (await (await get(`?slug=${OTHER.slug}`)).json()) as { permissions: Record<string, Record<string, unknown>> };
    expect(covered.permissions["claude-code"]).toMatchObject({
      memoryCapture: { allowed: true, decidedBy: "global", permissionRevision: 0, noticeVersion: 0 },
      memoryExtract: { allowed: true, decidedBy: "global", permissionRevision: 0 },
    });

    const global = await get();
    expect(global.headers.get("cache-control")).toBe("private, no-store");
    expect(((await global.json()) as { permissions: Record<string, Record<string, unknown>> }).permissions["claude-code"]).toMatchObject({
      memoryCapture: { allowed: true, decidedBy: "global", permissionRevision: 1, noticeVersion: 2 },
      memoryExtract: { allowed: true, decidedBy: "global", permissionRevision: 1, noticeVersion: 1 },
    });

    const unknown = await get("?slug=nowhere");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: "not_found" });
    const foreign = await get("?path=/tmp");
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toMatchObject({ code: "invalid_input", error: "path is not a known query parameter." });
  });
});
