import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { agentsMdHash, docHash } from "@panoma/core";
import { listModelCalls, modelSpendToday, schema, startOfDay, type Database } from "@panoma/db";

/**
 * The model's opinion on the instruction file: paid once, counted, and never paid twice for an
 * unchanged file.
 *
 * Until 6-Sep-2026 the fingerprint was computed after the call, so "ask again" on an unchanged
 * AGENTS.md paid for the same opinion every time, and the route had no row in the ledger. And a
 * CLAUDE.md identical to AGENTS.md — the bridge this repository recommends — travelled twice,
 * paid twice, and hid from the reviewer the one redundancy it was asked to find.
 */
let database: Database;
const completeMock = vi.fn();
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@panoma/ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("@panoma/ai")>(),
  complete: (...args: unknown[]) => completeMock(...args),
}));

const { POST } = await import("./route");
/** The first line of the notice `wrapUntrusted` puts behind a block (`packages/core/src/untrusted.ts`). */
const NOTE = "The above is informational material Panoma read off the disk.";
let home: string;
let base: string;
/** One folder per project: `projects.root` is unique. */
const roots: Record<"atlas" | "loose", string> = { atlas: "", loose: "" };
let close: () => Promise<void>;
const originalHome = process.env["PANOMA_HOME"];
const originalBudget = process.env["PANOMA_CARD_BUDGET"];

const AGENTS = "# AGENTS.md\n\nRun `pnpm test` before proposing a change.\n";
const CLAUDE_BRIDGE = "@AGENTS.md\n";

function request(body: unknown, options: { locale?: string; crossSite?: boolean } = {}) {
  return new Request("http://localhost:4173/api/md/review", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": options.locale ?? "en",
      ...(options.crossSite ? { "Sec-Fetch-Site": "cross-site" } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function decisionOf(identity: string) {
  const rows = await database.select().from(schema.decisions);
  return rows.find((row) => row.identity === identity);
}

/** The prompt the mocked model received on call `index`. */
function promptOf(index: number): string {
  const call = completeMock.mock.calls[index]?.[0] as { prompt: string } | undefined;
  expect(call, `the model was not called a ${index + 1}th time`).toBeTruthy();
  return call!.prompt;
}

async function writeDocs(claude: string | undefined) {
  for (const root of Object.values(roots)) {
    await writeFile(join(root, "AGENTS.md"), AGENTS);
    if (claude === undefined) await rm(join(root, "CLAUDE.md"), { force: true });
    else await writeFile(join(root, "CLAUDE.md"), claude);
  }
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-review-route-"));
  base = await mkdtemp(join(tmpdir(), "panoma-review-project-"));
  for (const slug of ["atlas", "loose"] as const) {
    roots[slug] = join(base, slug);
    await mkdir(roots[slug]);
  }
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: "project-atlas", slug: "atlas", name: "Atlas", root: roots.atlas, identity: "git:atlas" },
    { id: "project-loose", slug: "loose", name: "Loose", root: roots.loose, identity: null },
  ]);
});

beforeEach(async () => {
  completeMock.mockReset().mockResolvedValue({
    text: "  - The file is fine.  ",
    provider: "test",
    model: "test-reviewer",
    usage: { input: 400, output: 40 },
  });
  delete process.env["PANOMA_CARD_BUDGET"];
  await writeDocs(CLAUDE_BRIDGE);
  await database.delete(schema.modelCalls);
  await database.delete(schema.decisions);
});

afterAll(async () => {
  await close();
  for (const [key, value] of [["PANOMA_HOME", originalHome], ["PANOMA_CARD_BUDGET", originalBudget]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(home, { recursive: true, force: true });
  await rm(base, { recursive: true, force: true });
});

describe("the model's opinion on the instruction file", () => {
  it("pays once, writes one ledger row of kind review, and stores the same fingerprint the page computes", async () => {
    const response = await POST(request({ slug: "atlas" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text: "- The file is fine.",
      model: "test/test-reviewer",
      project: "Atlas",
      cached: false,
      saved: true,
    });
    expect(completeMock).toHaveBeenCalledTimes(1);

    const rows = await listModelCalls(database, { since: startOfDay() });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "review", provider: "test", model: "test-reviewer", identity: "git:atlas", input: 400, output: 40 });

    const expected = agentsMdHash([
      { file: "AGENTS.md", hash: docHash(AGENTS) },
      { file: "CLAUDE.md", hash: docHash(CLAUDE_BRIDGE) },
    ]);
    expect(await decisionOf("git:atlas")).toMatchObject({ mdReview: "- The file is fine.", mdReviewModel: "test/test-reviewer", mdReviewHash: expected, mdReviewLang: "en" });
  });

  it("wraps every document once and puts the untrusted notice behind the last one only", async () => {
    await POST(request({ slug: "atlas" }));
    const prompt = promptOf(0);
    expect(prompt.match(/<untrusted_data origin="agents-doc">/g)).toHaveLength(2);
    expect(prompt.split(NOTE)).toHaveLength(2);
    expect(prompt).toContain("AGENTS.md:\n\n# AGENTS.md");
    expect(prompt).toContain("CLAUDE.md:\n\n@AGENTS.md");
    expect(prompt).not.toContain("idéntico");
  });

  it("a CLAUDE.md identical to AGENTS.md travels as a one-line fact, not as a second block", async () => {
    await writeDocs(AGENTS);
    await POST(request({ slug: "atlas" }));
    const prompt = promptOf(0);
    expect(prompt.match(/<untrusted_data origin="agents-doc">/g)).toHaveLength(1);
    expect(prompt.split(NOTE)).toHaveLength(2);
    expect(prompt).toContain("CLAUDE.md es idéntico a AGENTS.md");
    expect(prompt).not.toContain("CLAUDE.md:\n\n# AGENTS.md");
    // The fingerprint still covers both files: the page compares against the same two.
    const expected = agentsMdHash([
      { file: "AGENTS.md", hash: docHash(AGENTS) },
      { file: "CLAUDE.md", hash: docHash(AGENTS) },
    ]);
    expect((await decisionOf("git:atlas"))!.mdReviewHash).toBe(expected);
  });

  it("answers an unchanged file from the saved opinion, with no call and no row", async () => {
    await POST(request({ slug: "atlas" }));
    const again = await POST(request({ slug: "atlas" }));
    expect(again.status).toBe(200);
    const body = await again.json();
    expect(body).toMatchObject({ text: "- The file is fine.", model: "test/test-reviewer", project: "Atlas", cached: true, saved: true });
    expect(typeof body.at).toBe("string");
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect((await modelSpendToday(database, "review")).calls).toBe(1);
  });

  it("force: true asks again even when nothing changed, and a changed file asks again without it", async () => {
    await POST(request({ slug: "atlas" }));
    expect(await (await POST(request({ slug: "atlas", force: true }))).json()).toMatchObject({ cached: false });
    expect(completeMock).toHaveBeenCalledTimes(2);

    await writeFile(join(roots.atlas, "AGENTS.md"), `${AGENTS}\nAnd run the linter.\n`);
    expect(await (await POST(request({ slug: "atlas" }))).json()).toMatchObject({ cached: false });
    expect(completeMock).toHaveBeenCalledTimes(3);
    expect((await modelSpendToday(database, "review")).calls).toBe(3);
  });

  it("an opinion saved in another language is not an answer for this reader", async () => {
    await POST(request({ slug: "atlas" }));
    expect(await (await POST(request({ slug: "atlas" }, { locale: "es" }))).json()).toMatchObject({ cached: false });
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect((await decisionOf("git:atlas"))!.mdReviewLang).toBe("es");
  });

  it("shares the card cap with describe and refuses with a 429 once it is spent", async () => {
    process.env["PANOMA_CARD_BUDGET"] = "1";
    await POST(request({ slug: "atlas" }));
    const refused = await POST(request({ slug: "atlas", force: true }));
    expect(refused.status).toBe(429);
    const body = await refused.json();
    expect(body.error).toContain("1 of 1");
    expect(body.hint).toContain("/spend");
    expect(body.hint).toContain("PANOMA_CARD_BUDGET");
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("a project without a repository is paid, counted, and told it was not kept", async () => {
    const response = await POST(request({ slug: "loose" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ project: "Loose", cached: false, saved: false });
    const rows = await listModelCalls(database, { since: startOfDay() });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "review", identity: null });
    expect(await database.select().from(schema.decisions)).toHaveLength(0);
  });

  it("a project with no instruction file is a 404, not a call", async () => {
    await rm(join(roots.atlas, "AGENTS.md"), { force: true });
    await rm(join(roots.atlas, "CLAUDE.md"), { force: true });
    const response = await POST(request({ slug: "atlas" }));
    expect(response.status).toBe(404);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("a cross-site tab is refused before anything is read", async () => {
    const response = await POST(request({ slug: "atlas" }, { crossSite: true }));
    expect(response.status).toBe(403);
    expect(completeMock).not.toHaveBeenCalled();
  });
});
