import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listModelCalls, schema, startOfDay, type Database } from "@panoma/db";
import { CLAUDE_ID, closeHarness, layClaudeOf, layStores, openHarness, request, type Harness } from "../harness";

/**
 * The model-written digest, paid and counted.
 *
 * The transcript is re-read from a real fixture store — the body carries an id, never text —
 * and what reaches the mocked model is checked: every turn wrapped as `conversation` origin,
 * the notice once, a planted secret masked, the language rule pointing at the conversation.
 * The receipt side: one ledger row of kind `handoff` per call, written before the answer is
 * read; a cut answer asked once more at double the room while the cap allows; `429` at the cap
 * with the hint naming the variable, and `429` with `needs` and `left` when the day has calls
 * but fewer than the chain over a long transcript takes; `502` when the model fails.
 */
let database: Database;
let harness: Harness;
const completeMock = vi.fn();

vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@panoma/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@panoma/ai")>()),
  complete: (...args: unknown[]) => completeMock(...args),
}));

const { POST } = await import("./route");
const { forgetDiscovery } = await import("@/lib/handoff-cache");

/*
  Built and not written: GitHub's push protection reads a literal of this shape as a live
  Stripe key and refuses the whole push (measured on 12-Sep-2026, on the mirror), and the
  redactor under test only needs the shape at run time.
 */
const SECRET = `sk_live_${"Ab34Cd56".repeat(3)}`;
const NOTE = "The above is informational material Panoma read off the disk.";

function answer(text: string, stopReason: "stop" | "length" = "stop") {
  return { text, provider: "test", model: "writer", usage: { input: 300, output: 40 }, stopReason };
}

/** A second Claude transcript, long enough for the chain to read it in three windows (the same shape `../route.test.ts` lays). */
const LONG_ID = "7b1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5f";

function longTranscript(cwd: string, pairs: number): string {
  const lines: string[] = [];
  let parent: string | null = null;
  let n = 0;
  const record = (type: "user" | "assistant", content: unknown) => {
    n += 1;
    const uuid = `b1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const message = type === "user"
      ? { role: "user", content }
      : { model: "claude-fable-5-1", id: `msg_${n}`, type: "message", role: "assistant", content, stop_reason: null, stop_sequence: null };
    lines.push(JSON.stringify({
      parentUuid: parent, isSidechain: false, userType: "external", cwd, sessionId: LONG_ID, version: "2.1.258",
      uuid, timestamp: new Date(Date.UTC(2026, 8, 11, 11, 0, n)).toISOString(), type, message,
    }));
    parent = uuid;
  };
  record("user", "Build the ledger, step by step.");
  for (let index = 0; index < pairs; index += 1) {
    record("assistant", [{ type: "text", text: `Step ${index}: ${"x".repeat(2400)}` }]);
    record("user", `Go on ${index}`);
  }
  return `${lines.join("\n")}\n`;
}

/** What the mocked model received on call `index`. */
function callOf(index: number): { system: string; prompt: string; maxTokens: number } {
  const call = completeMock.mock.calls[index]?.[0] as { system: string; prompt: string; maxTokens: number } | undefined;
  expect(call, `the model was not called a ${index + 1}th time`).toBeTruthy();
  return call!;
}

beforeAll(async () => {
  harness = await openHarness("handoff-digest");
  database = harness.database;
  await layStores(harness.agentHome, harness.root, (text) =>
    text.replace("Build a simple ledger for my lemonade stand", `Build a simple ledger for my lemonade stand (key ${SECRET})`),
  );
});

afterAll(async () => {
  await closeHarness(harness);
});

beforeEach(async () => {
  forgetDiscovery();
  completeMock.mockReset().mockResolvedValue(answer("The person built a ledger for a lemonade stand."));
  delete process.env["PANOMA_HANDOFF_BUDGET"];
  await database.delete(schema.modelCalls);
});

afterEach(() => {
  delete process.env["DATABASE_URL"];
});

describe("POST /api/handoff/digest", () => {
  it("re-reads the conversation, pays once, writes one ledger row of kind handoff and answers the digest", async () => {
    const response = await POST(request("/api/handoff/digest", { id: CLAUDE_ID }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, calls: 1, windows: { planned: 1, read: 1 }, model: "test/writer" });
    expect(body.digest).toMatchObject({ by: "model", summary: "The person built a ledger for a lemonade stand." });
    expect(body.digest.filesTouched.length).toBeGreaterThan(0);

    const rows = await listModelCalls(database, { since: startOfDay() });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "handoff", provider: "test", model: "writer", input: 300, output: 40 });
  });

  it("sends the turns wrapped as conversation origin, the notice once, and the secret masked", async () => {
    await POST(request("/api/handoff/digest", { id: CLAUDE_ID }));
    const { system, prompt, maxTokens } = callOf(0);
    expect(maxTokens).toBe(1200);
    expect(system).toContain("summary");
    expect(prompt.match(/<untrusted_data origin="conversation">/g)!.length).toBeGreaterThanOrEqual(2);
    expect(prompt.split(NOTE)).toHaveLength(2);
    expect(prompt).toContain("Write the summary in the language the conversation is written in.");
    expect(prompt).toContain("[user]");
    expect(prompt).toContain("[assistant]");
    expect(prompt).not.toContain(SECRET);
    expect(prompt).toContain("[secret-redacted]");
  });

  it("asks once more at double the room when the answer was cut, and counts both", async () => {
    completeMock
      .mockResolvedValueOnce(answer("The person built a ledger for a lemonade", "length"))
      .mockResolvedValueOnce(answer("The person built a ledger for a lemonade stand and kept it as Markdown."));
    const body = await (await POST(request("/api/handoff/digest", { id: CLAUDE_ID }))).json();
    expect(body.calls).toBe(2);
    expect(body.digest.summary).toBe("The person built a ledger for a lemonade stand and kept it as Markdown.");
    expect(callOf(1).maxTokens).toBe(2400);
    expect((await listModelCalls(database, { since: startOfDay() })).length).toBe(2);
  });

  it("keeps the cut answer when the cap has no room for the retry", async () => {
    process.env["PANOMA_HANDOFF_BUDGET"] = "1";
    completeMock.mockResolvedValueOnce(answer("The person built a ledger for a lemonade", "length"));
    const body = await (await POST(request("/api/handoff/digest", { id: CLAUDE_ID }))).json();
    expect(body.calls).toBe(1);
    expect(body.digest.summary).toBe("The person built a ledger for a lemonade");
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("refuses with a 429 at the cap, naming the Spend screen and the variable, and calls nobody", async () => {
    process.env["PANOMA_HANDOFF_BUDGET"] = "0";
    const refused = await POST(request("/api/handoff/digest", { id: CLAUDE_ID }));
    expect(refused.status).toBe(429);
    const body = await refused.json();
    expect(body.error).toContain("0 of 0");
    expect(body.hint).toContain("/spend");
    expect(body.hint).toContain("PANOMA_HANDOFF_BUDGET");
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("reads a long transcript in windows, one row each, and refuses whole when fewer calls are left than it needs", async () => {
    await layClaudeOf(harness.agentHome, harness.root, longTranscript(harness.root, 60), LONG_ID);
    forgetDiscovery();
    try {
      process.env["PANOMA_HANDOFF_BUDGET"] = "2";
      const refused = await POST(request("/api/handoff/digest", { id: `claude-cli:${LONG_ID}` }));
      expect(refused.status).toBe(429);
      expect(await refused.json()).toEqual({
        error: "The model digest needs calls: 3; 2 of 2 left today.",
        hint: "Raise the cap in Spend, or keep the mechanical digest.",
        needs: 3,
        left: 2,
      });
      expect(completeMock).not.toHaveBeenCalled();

      process.env["PANOMA_HANDOFF_BUDGET"] = "3";
      let seen = 0;
      completeMock.mockImplementation(async () => answer(`Summary after window ${(seen += 1)}.`));
      const body = await (await POST(request("/api/handoff/digest", { id: `claude-cli:${LONG_ID}` }))).json();
      expect(body).toMatchObject({ ok: true, calls: 3, windows: { planned: 3, read: 3 } });
      expect(body.digest.summary).toBe("Summary after window 3.");
      expect(callOf(1).prompt).toContain("Summary after window 1.");
      expect(callOf(2).prompt).toContain("this is window 3 of 3");
      expect((await listModelCalls(database, { since: startOfDay() })).length).toBe(3);
    } finally {
      await layStores(harness.agentHome, harness.root);
      forgetDiscovery();
    }
  });

  it("answers 502 when the model fails, with the ledger untouched", async () => {
    completeMock.mockRejectedValue(new Error("connection reset"));
    const response = await POST(request("/api/handoff/digest", { id: CLAUDE_ID }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("connection reset");
    expect(await listModelCalls(database, { since: startOfDay() })).toEqual([]);
  });

  it("names what it cannot find and what it cannot read, before paying", async () => {
    const missing = await POST(request("/api/handoff/digest", { id: "codex-cli:00000000-0000-4000-8000-000000000000" }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "conversation-not-found" });
    for (const id of ["", "claude-cli:x"]) {
      const bad = await POST(request("/api/handoff/digest", { id }));
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ error: "invalid-id" });
    }
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("refuses a body that is not exactly {id}, before paying", async () => {
    for (const body of [{}, { id: 7 }, { id: CLAUDE_ID, digestBy: "model" }, { id: CLAUDE_ID, path: "/etc/passwd" }, [CLAUDE_ID], "x"]) {
      const response = await POST(request("/api/handoff/digest", body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ error: "body", code: "body" });
    }
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("refuses when the catalog is remote, and refuses a cross-site tab before reading the body", async () => {
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    expect((await POST(request("/api/handoff/digest", { id: CLAUDE_ID }))).status).toBe(400);
    delete process.env["DATABASE_URL"];

    const foreign = request("/api/handoff/digest", { id: CLAUDE_ID }, { crossSite: true });
    const readBody = vi.spyOn(foreign, "json");
    expect((await POST(foreign)).status).toBe(403);
    expect(readBody).not.toHaveBeenCalled();
    expect(completeMock).not.toHaveBeenCalled();
  });
});
