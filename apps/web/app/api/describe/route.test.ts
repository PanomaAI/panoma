import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listModelCalls, modelSpendToday, schema, startOfDay, type Database } from "@panoma/db";

/**
 * The project card's paragraph: paid once, counted, and never paid twice for the same project.
 *
 * Until 6-Sep-2026 this route had no budget and no row in the ledger, and paid again on every
 * press. What is checked here is the whole receipt: one call writes one row of kind `describe`
 * and stores the fingerprint; a second identical press is answered from the record; `force` pays
 * again; the cap of the `card` family refuses with a 429; and a project with no repository is
 * told the truth — paid, counted, not kept.
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
const roots: Record<"atlas" | "loose" | "lit", string> = { atlas: "", loose: "", lit: "" };
let close: () => Promise<void>;
const originalHome = process.env["PANOMA_HOME"];
const originalBudget = process.env["PANOMA_CARD_BUDGET"];

function request(body: unknown, options: { locale?: string; crossSite?: boolean } = {}) {
  return new Request("http://localhost:4173/api/describe", {
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

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-describe-route-"));
  base = await mkdtemp(join(tmpdir(), "panoma-describe-project-"));
  for (const slug of ["atlas", "loose", "lit"] as const) {
    roots[slug] = join(base, slug);
    await mkdir(roots[slug]);
    await writeFile(join(roots[slug], "README.md"), "# Atlas\n\nA catalog of the projects on a disk.\n");
  }
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: "project-atlas", slug: "atlas", name: "Atlas", root: roots.atlas, identity: "git:atlas" },
    { id: "project-loose", slug: "loose", name: "Loose", root: roots.loose, identity: null },
    { id: "project-lit", slug: "lit", name: "Lit", root: roots.lit, identity: "git:lit", recentCommits: [{ subject: "first light" }, { subject: "second light" }] },
  ]);
});

beforeEach(async () => {
  completeMock.mockReset().mockResolvedValue({
    text: "  It catalogs the projects on a disk.  ",
    provider: "test",
    model: "test-writer",
    usage: { input: 120, output: 30 },
  });
  delete process.env["PANOMA_CARD_BUDGET"];
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

describe("the paragraph a model writes about a project", () => {
  it("pays once, writes one ledger row of kind describe, and stores the fingerprint", async () => {
    const response = await POST(request({ slug: "atlas" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text: "It catalogs the projects on a disk.",
      model: "test/test-writer",
      cached: false,
      saved: true,
    });
    expect(completeMock).toHaveBeenCalledTimes(1);

    const rows = await listModelCalls(database, { since: startOfDay() });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "describe", provider: "test", model: "test-writer", identity: "git:atlas", input: 120, output: 30 });

    const decision = await decisionOf("git:atlas");
    expect(decision).toMatchObject({ aiSummary: "It catalogs the projects on a disk.", aiSummaryModel: "test/test-writer", aiSummaryLang: "en" });
    expect(decision?.aiSummaryHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("sends the untrusted notice once, behind the last wrapped block", async () => {
    await POST(request({ slug: "lit" }));
    const prompt = promptOf(0);
    expect(prompt.match(/<untrusted_data origin="commits">/g)).toHaveLength(1);
    expect(prompt.match(/<untrusted_data origin="readme">/g)).toHaveLength(1);
    expect(prompt).toContain("- first light\n- second light");
    expect(prompt.split(NOTE)).toHaveLength(2);
    expect(prompt.indexOf('origin="commits"')).toBeLessThan(prompt.indexOf('origin="readme"'));
  });

  it("answers a second identical press from the saved description, with no call and no row", async () => {
    await POST(request({ slug: "atlas" }));
    const again = await POST(request({ slug: "atlas" }));
    expect(again.status).toBe(200);
    const body = await again.json();
    expect(body).toMatchObject({ text: "It catalogs the projects on a disk.", model: "test/test-writer", cached: true, saved: true });
    expect(typeof body.at).toBe("string");
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect((await modelSpendToday(database, "describe")).calls).toBe(1);
  });

  it("force: true asks the model again even when nothing changed", async () => {
    await POST(request({ slug: "atlas" }));
    const forced = await POST(request({ slug: "atlas", force: true }));
    expect(await forced.json()).toMatchObject({ cached: false, saved: true });
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect((await modelSpendToday(database, "describe")).calls).toBe(2);
  });

  it("a changed README is new material and pays again without force", async () => {
    await POST(request({ slug: "atlas" }));
    const before = (await decisionOf("git:atlas"))!.aiSummaryHash;
    await writeFile(join(roots.atlas, "README.md"), "# Atlas\n\nA catalog of the projects on a disk, now with a watcher.\n");
    try {
      const changed = await POST(request({ slug: "atlas" }));
      expect(await changed.json()).toMatchObject({ cached: false });
      expect(completeMock).toHaveBeenCalledTimes(2);
      expect((await decisionOf("git:atlas"))!.aiSummaryHash).not.toBe(before);
    } finally {
      await writeFile(join(roots.atlas, "README.md"), "# Atlas\n\nA catalog of the projects on a disk.\n");
    }
  });

  it("a paragraph saved in another language is not an answer for this reader", async () => {
    await POST(request({ slug: "atlas" }));
    const spanish = await POST(request({ slug: "atlas" }, { locale: "es" }));
    expect(await spanish.json()).toMatchObject({ cached: false });
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect((await decisionOf("git:atlas"))!.aiSummaryLang).toBe("es");
  });

  it("refuses with a 429 at the card cap, and still answers what is saved for free", async () => {
    process.env["PANOMA_CARD_BUDGET"] = "1";
    await POST(request({ slug: "atlas" }));
    const refused = await POST(request({ slug: "atlas", force: true }));
    expect(refused.status).toBe(429);
    const body = await refused.json();
    expect(body.error).toContain("1 of 1");
    expect(body.hint).toContain("/spend");
    expect(body.hint).toContain("PANOMA_CARD_BUDGET");
    expect(completeMock).toHaveBeenCalledTimes(1);

    const cached = await POST(request({ slug: "atlas" }));
    expect(cached.status).toBe(200);
    expect(await cached.json()).toMatchObject({ cached: true });
  });

  it("a project without a repository is paid, counted, and told it was not kept", async () => {
    const response = await POST(request({ slug: "loose" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cached: false, saved: false });
    const rows = await listModelCalls(database, { since: startOfDay() });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "describe", identity: null });
    expect(await database.select().from(schema.decisions)).toHaveLength(0);

    // With nothing kept there is nothing to answer from: the next press pays again.
    await POST(request({ slug: "loose" }));
    expect(completeMock).toHaveBeenCalledTimes(2);
  });

  it("a cross-site tab is refused before anything is read", async () => {
    const response = await POST(request({ slug: "atlas" }, { crossSite: true }));
    expect(response.status).toBe(403);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("an unknown project is a 404, not a call", async () => {
    const response = await POST(request({ slug: "missing" }));
    expect(response.status).toBe(404);
    expect(completeMock).not.toHaveBeenCalled();
  });
});
