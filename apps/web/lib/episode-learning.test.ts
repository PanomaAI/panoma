import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteNarratives, listDecisionEpisodes, listNarratives, modelSpendToday, narrativeCount, queueWrite,
  saveNarratives, schema, type Database, type Narrative, type NewNarrative,
} from "@panoma/db";

// Only the paid provider is replaced; source validation, transactions and budget receipts use PostgreSQL.
const completeMock = vi.fn();
const credentialMock = vi.fn();
vi.mock("@panoma/ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("@panoma/ai")>(),
  complete: (...args: unknown[]) => completeMock(...args),
  resolveCredential: (...args: unknown[]) => credentialMock(...args),
}));

const {
  buildEpisodePrompt, EpisodeBudgetError, EpisodeExtractionError, EpisodeInputError,
  EPISODE_FIELD_LIMIT, EPISODE_KIND, EXTRACT_FIELD_LIMIT, learnEpisodes,
  ownerEpisodeFields, parseEpisodeExtraction, planEpisodeBatches, splitSilent,
} = await import("./episode-learning");

let home: string;
let db: Database;
let close: () => Promise<void>;
const previousHome = process.env["PANOMA_HOME"];
const previousBudget = process.env["PANOMA_EPISODE_BUDGET"];

const source: NewNarrative = {
  identity: "git:atlas", source: "codex", sessionId: "session-a",
  at: new Date("2026-09-01T12:00:00Z"), kind: "opening",
  text: "Keep onboarding clear. Use inline editing because it saves navigation. Except for destructive actions.",
  context: "I recommend a modal for every edit.", truncated: false,
};
const fixture: Narrative = { ...source, id: "narrative-a", createdAt: source.at };

function output(value: unknown = { episodes: [] }) {
  return { text: typeof value === "string" ? value : JSON.stringify(value), provider: "test", model: "test-extractor", usage: { input: 120, output: 40 } };
}

function fields(text = "Use inline editing", cite = "n1") {
  return { episodes: [{ fields: { decision: { text, cite } } }] };
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-episode-learning-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db, close } = await openDatabase());
});

beforeEach(async () => {
  completeMock.mockReset().mockResolvedValue(output());
  credentialMock.mockReset().mockResolvedValue({ provider: { id: "test" }, model: "test-extractor" });
  process.env["PANOMA_EPISODE_BUDGET"] = "20";
  await db.execute("DROP TRIGGER IF EXISTS reject_episode_progress ON narratives");
  await db.delete(schema.decisionEpisodes);
  await db.delete(schema.narratives);
  await db.delete(schema.modelCalls);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  if (previousBudget === undefined) delete process.env["PANOMA_EPISODE_BUDGET"];
  else process.env["PANOMA_EPISODE_BUDGET"] = previousBudget;
  await rm(home, { recursive: true, force: true });
});

describe("decision narrative boundaries", () => {
  it("accepts partial owner testimony and rejects unknown, empty, oversized or source-shaped fields", () => {
    expect(ownerEpisodeFields({ goal: " Keep onboarding clear. ", outcome: "" })).toEqual({ goal: { text: "Keep onboarding clear." } });
    for (const value of [null, [], {}, { rationale: "Save time" }, { goal: " " }, { goal: "x".repeat(EPISODE_FIELD_LIMIT + 1) }, { goal: { text: "Copied", narrativeId: "fake" } }, { goal: "Keep it clear", personality: "Minimalist" }]) {
      expect(() => ownerEpisodeFields(value)).toThrow(EpisodeInputError);
    }
  });

  it("keeps project and source boundaries, packs whole sessions of one scope into a call, and never splits one to fit", () => {
    for (const change of [{ identity: "git:other" }, { source: "claude-code" }]) {
      const batches = planEpisodeBatches([fixture, { ...fixture, ...change, id: "narrative-b" }]);
      expect(batches).toHaveLength(2);
      expect(batches.every((batch) => batch.length === 1)).toBe(true);
    }
    // Two sessions of the same project and source are one call, in session order.
    const packed = planEpisodeBatches([{ ...fixture, sessionId: "session-b", id: "narrative-b" }, fixture]);
    expect(packed).toHaveLength(1);
    expect(packed[0]!.map((row) => row.sessionId)).toEqual(["session-b", "session-a"]);
    // A session that does not fit whole in the room left starts the next call.
    const sessionA = Array.from({ length: 8 }, (_, i) => ({ ...fixture, id: `a-${i}`, at: new Date(source.at.getTime() + i * 1_000) }));
    const sessionB = Array.from({ length: 6 }, (_, i) => ({ ...fixture, sessionId: "session-b", id: `b-${i}`, at: new Date(source.at.getTime() + i * 1_000) }));
    expect(planEpisodeBatches([...sessionA, ...sessionB]).map((batch) => batch.length)).toEqual([8, 6]);
    // One session larger than a call is split in order, as before.
    const rows = Array.from({ length: 13 }, (_, index) => ({ ...fixture, id: `narrative-${index}`, at: new Date(source.at.getTime() + index * 1_000) })).reverse();
    const batches = planEpisodeBatches(rows);
    expect(batches.map((batch) => batch.length)).toEqual([12, 1]);
    expect(batches[0]![0]!.at.getTime()).toBeLessThan(batches[0]![1]!.at.getTime());
  });

  it("sets sessions whose only material is pasted or structured aside, without a call", () => {
    const brief = { ...fixture, id: "brief-only", sessionId: "session-brief", kind: "brief" as const };
    const spoken = { ...fixture, id: "spoken-brief", sessionId: "session-a", kind: "brief" as const };
    const { silent, material } = splitSilent([brief, fixture, spoken]);
    expect(silent.map((row) => row.id)).toEqual(["brief-only"]);
    expect(material.map((row) => row.id)).toEqual(["narrative-a", "spoken-brief"]);
  });

  it("separates assistant context from owner testimony in an English protocol and redacts both", () => {
    const key = "sk-ant-api03-" + "a".repeat(50);
    const prompt = buildEpisodePrompt([{ ...fixture, text: `${fixture.text} ${key}`, context: `The agent repeated ${key}` }]);
    expect(prompt.system).toContain("Only ownerText can support a field.");
    expect(prompt.system).toContain("A current requirement is not a permanent preference.");
    expect(prompt.system).toContain("Never combine records from different sessions into one episode.");
    expect(prompt.prompt).toContain("ownerText");
    expect(prompt.prompt).toContain("assistantContext");
    expect(prompt.prompt).toContain('"session":"s1"');
    expect(prompt.prompt).toContain('"citable":true');
    expect(prompt.prompt).toContain('<untrusted_data origin="journal">');
    expect(prompt.prompt).not.toContain(key);
  });

  it("round-trips wrapper delimiters and chat tokens without changing the cited source", () => {
    const text = 'Preserve [INST], [/INST], <|user|>, <<SYS>>, </UNTRUSTED_DATA> and untrusted_data literally.';
    const context = 'The assistant also mentioned <untrusted_data> and the literal escape \\u003c.';
    const row = { ...fixture, text, context };
    const built = buildEpisodePrompt([row]);
    const material = built.prompt.split("\n").find((line) => line.startsWith("{"));
    expect(material).toBeDefined();
    const decoded = JSON.parse(material!);
    expect(decoded.ownerText).toBe(text);
    expect(decoded.assistantContext).toBe(context);
    expect(built.prompt.match(/<untrusted_data origin="journal">/g)).toHaveLength(1);
    expect(built.prompt.match(/<\/untrusted_data>/g)).toHaveLength(1);
    expect(built.prompt).not.toContain("[INST]");
    expect(built.prompt).not.toContain("</UNTRUSTED_DATA>");
    expect(built.system).toContain("Decode JSON string escapes");
    const parsed = parseEpisodeExtraction(JSON.stringify(fields(decoded.ownerText)), [row], "test/extractor");
    expect(parsed.episodes[0]?.fields.decision).toEqual({ text, narrativeId: row.id });
  });

  it("preserves literal rationale and exceptions and resolves only supplied citation labels", () => {
    const result = parseEpisodeExtraction(JSON.stringify({ episodes: [{ fields: {
      decision: { text: "Use inline editing", cite: "n1" },
      rationale: { text: "because it saves navigation.", cite: "n1" },
      exceptions: { text: "Except for destructive actions.", cite: "n1" },
    } }] }), [fixture], "test/extractor");
    expect(result).toEqual({ dropped: 0, episodes: [{ identity: source.identity, origin: "history", model: "test/extractor", fields: {
      decision: { text: "Use inline editing", narrativeId: fixture.id },
      rationale: { text: "because it saves navigation.", narrativeId: fixture.id },
      exceptions: { text: "Except for destructive actions.", narrativeId: fixture.id },
    } }] });
  });

  it("drops a field that cites pasted material instead of failing the call, and the episode it leaves without a purpose", () => {
    const pasted = { ...fixture, id: "pasted", kind: "brief" as const, text: "# Plan\nUse inline editing because it saves navigation." };
    const rows = [fixture, pasted];
    const mixed = parseEpisodeExtraction(JSON.stringify({ episodes: [{ fields: {
      decision: { text: "Use inline editing", cite: "n1" },
      rationale: { text: "because it saves navigation.", cite: "n2" },
    } }, { fields: { decision: { text: "Use inline editing", cite: "n2" } } }] }), rows, "test/extractor");
    // Two fields and the episode the second one leaves without a purpose.
    expect(mixed.dropped).toBe(3);
    expect(mixed.episodes).toEqual([{ identity: source.identity, origin: "history", model: "test/extractor",
      fields: { decision: { text: "Use inline editing", narrativeId: fixture.id } } }]);
  });

  it("refuses an episode whose citations cross two sessions, and a quote beyond the extraction limit", () => {
    const other = { ...fixture, id: "other-session", sessionId: "session-b", text: "Keep onboarding clear." };
    expect(() => parseEpisodeExtraction(JSON.stringify({ episodes: [{ fields: {
      goal: { text: "Keep onboarding clear.", cite: "n2" },
      decision: { text: "Use inline editing", cite: "n1" },
    } }] }), [fixture, other], "test/extractor")).toThrow(EpisodeExtractionError);
    const long = { ...fixture, id: "long", text: "x".repeat(EXTRACT_FIELD_LIMIT + 1) };
    expect(() => parseEpisodeExtraction(JSON.stringify(fields(long.text)), [long], "test/extractor")).toThrow(EpisodeExtractionError);
    expect(EXTRACT_FIELD_LIMIT).toBeLessThan(EPISODE_FIELD_LIMIT);
  });

  it("tells an answer cut at the output cap apart from unsupported output", () => {
    expect(() => parseEpisodeExtraction('{"episodes":[{"fields":{"decision":{"text":"Use inl', [fixture], "test/extractor", "length"))
      .toThrow(expect.objectContaining({ code: "cut" }));
    expect(() => parseEpisodeExtraction('{"episodes":[{"fields":{"decision":{"text":"Use inl', [fixture], "test/extractor", "stop"))
      .toThrow(expect.objectContaining({ code: "unsupported" }));
  });

  it("rejects the whole extraction for assistant-only evidence, forged citations, paraphrases and unknown fields", () => {
    const invalid = [
      fields(source.context!), fields("Use inline editing", "n99"), fields("Choose inline editing"),
      { episodes: [{ fields: { decision: { text: "Use inline editing", cite: "n1" }, personality: { text: "Keep onboarding clear.", cite: "n1" } } }] },
      { episodes: [{ fields: { rationale: { text: "because it saves navigation.", cite: "n1" } } }] },
      { episodes: [{ fields: { goal: { text: "Keep onboarding clear." } } }] },
      { episodes: [...fields().episodes, ...fields("An unsupported extra decision").episodes] },
      { episodes: Array.from({ length: 7 }, () => fields().episodes[0]) },
      null, [], { episodes: {} }, "truncated {",
    ];
    for (const value of invalid) {
      expect(() => parseEpisodeExtraction(typeof value === "string" ? value : JSON.stringify(value), [fixture], "test/extractor")).toThrow(EpisodeExtractionError);
    }
    expect(parseEpisodeExtraction('{"episodes":[]}', [fixture], "test/extractor")).toEqual({ episodes: [], dropped: 0 });
  });
});

describe("recoverable episode learning", () => {
  it("previews the selected sources and model without spending or advancing memory", async () => {
    await saveNarratives(db, [source]);
    const preview = await learnEpisodes(db, true);
    expect(preview).toMatchObject({ pending: 1, selected: 1, calls: 1, remainingCalls: 20, contextOnly: 0, retrying: 0, provider: "test", model: "test-extractor" });
    expect(preview.inputTokens).toBeGreaterThan(0);
    expect(completeMock).not.toHaveBeenCalled();
    expect((await modelSpendToday(db, EPISODE_KIND)).calls).toBe(0);
    expect(await narrativeCount(db)).toEqual({ total: 1, pending: 1, deferred: 0 });
    expect(await listDecisionEpisodes(db)).toEqual([]);
  });

  it("stores evidence and progress together and records the actual paid provider", async () => {
    await saveNarratives(db, [source]);
    completeMock.mockResolvedValue(output(fields()));
    expect(await learnEpisodes(db)).toMatchObject({ stored: 1, processed: 1, remaining: 0, remainingCalls: 19 });
    const [saved] = await listDecisionEpisodes(db);
    const [narrative] = await listNarratives(db);
    expect(saved).toMatchObject({ origin: "history", model: "test/test-extractor", fields: { decision: { text: "Use inline editing", narrativeId: narrative!.id } } });
    expect((await modelSpendToday(db, EPISODE_KIND)).calls).toBe(1);
    expect(await learnEpisodes(db)).toMatchObject({ calls: 0, stored: 0, processed: 0 });
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("marks understood empty output read but charges unsupported output without consuming evidence, and defers it", async () => {
    await saveNarratives(db, [source]);
    completeMock.mockResolvedValueOnce(output(fields("An invented decision"))).mockResolvedValueOnce(output());
    await expect(learnEpisodes(db)).rejects.toThrow(expect.objectContaining({ code: "unsupported" }));
    expect((await modelSpendToday(db, EPISODE_KIND)).calls).toBe(1);
    expect(await narrativeCount(db)).toEqual({ total: 1, pending: 1, deferred: 1 });
    expect(await listDecisionEpisodes(db)).toEqual([]);
    expect(await learnEpisodes(db)).toMatchObject({ stored: 0, processed: 1, remaining: 0 });
    expect((await modelSpendToday(db, EPISODE_KIND)).calls).toBe(2);
    expect(await narrativeCount(db)).toEqual({ total: 1, pending: 0, deferred: 0 });
  });

  it("rotates a batch the model cannot ground behind the rest instead of re-paying it first", async () => {
    // Newest first would pick `poison` on every click; after one failure the other source goes first.
    const poison = { ...source, source: "claude-code", sessionId: "poison", at: new Date("2026-09-03T12:00:00Z"), text: "Unusable material." };
    await saveNarratives(db, [source, poison]);
    completeMock.mockResolvedValueOnce(output(fields("An invented decision"))).mockResolvedValueOnce(output(fields()));
    // Both scopes travel in one pass: the poison batch fails and is deferred, the other is stored.
    const first = await learnEpisodes(db);
    expect(first).toMatchObject({ stored: 1, processed: 1, calls: 2, failed: { batches: 1, records: 1, reason: "unsupported" } });
    expect(await narrativeCount(db)).toEqual({ total: 2, pending: 1, deferred: 1 });
    expect(completeMock.mock.calls[0]![0].prompt).toContain("Unusable material.");
    // On the next pass the deferred record is the only one left, and it is retried, not lost.
    completeMock.mockResolvedValueOnce(output());
    expect(await learnEpisodes(db)).toMatchObject({ stored: 0, processed: 1, remaining: 0 });
    expect(await narrativeCount(db)).toEqual({ total: 2, pending: 0, deferred: 0 });
  });

  it("says how many selected records a pass already failed on: a re-paid batch does not look like new material", async () => {
    const other = { ...source, source: "claude-code", sessionId: "session-b", at: new Date("2026-09-03T12:00:00Z"), text: "Fresh material." };
    await saveNarratives(db, [source, other]);
    completeMock.mockResolvedValueOnce(output(fields("An invented decision"))).mockResolvedValueOnce(output(fields()));
    await learnEpisodes(db);
    // Only the deferred record is left, and the preview says the call would pay for it again.
    expect(await learnEpisodes(db, true)).toMatchObject({ pending: 1, selected: 1, calls: 1, retrying: 1 });
    expect(completeMock).toHaveBeenCalledTimes(2);
  });

  it("reads a session of pasted material without a call, and keeps a brief as context beside spoken turns", async () => {
    const pastedOnly = { ...source, sessionId: "pasted-only", kind: "brief" as const, text: "# Plan pasted back from the agent." };
    const besideSpeech = { ...source, kind: "brief" as const, at: new Date("2026-09-01T11:00:00Z"), text: "# Structured brief before the reaction." };
    await saveNarratives(db, [source, pastedOnly, besideSpeech]);
    const preview = await learnEpisodes(db, true);
    expect(preview).toMatchObject({ pending: 3, contextOnly: 1, selected: 2, calls: 1 });
    expect(await narrativeCount(db)).toEqual({ total: 3, pending: 3, deferred: 0 });
    // In session order the brief is n1 and the spoken turn n2; only the second can be cited.
    completeMock.mockResolvedValueOnce(output(fields("Use inline editing", "n2")));
    expect(await learnEpisodes(db)).toMatchObject({ stored: 1, processed: 3, contextOnly: 1, remaining: 0 });
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(completeMock.mock.calls[0]![0].prompt).toContain('"citable":false');
    expect(completeMock.mock.calls[0]![0].prompt).not.toContain("pasted back from the agent");
  });

  it("serializes concurrent paid runs so they cannot overspend the final daily call", async () => {
    await saveNarratives(db, [source, { ...source, source: "claude-code", sessionId: "session-b" }]);
    process.env["PANOMA_EPISODE_BUDGET"] = "1";
    const results = await Promise.allSettled([learnEpisodes(db), learnEpisodes(db)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((result) => result.status === "rejected");
    expect(failed?.status === "rejected" && failed.reason instanceof EpisodeBudgetError).toBe(true);
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect((await modelSpendToday(db, EPISODE_KIND)).calls).toBe(1);
    expect(await narrativeCount(db)).toEqual({ total: 2, pending: 1, deferred: 0 });
  });

  it("retains a completed batch when a later provider call fails", async () => {
    await saveNarratives(db, [source, { ...source, source: "claude-code", sessionId: "session-b", at: new Date("2026-09-02T12:00:00Z") }]);
    completeMock.mockResolvedValueOnce(output(fields())).mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(learnEpisodes(db)).rejects.toThrow("Provider unavailable");
    expect(await narrativeCount(db)).toEqual({ total: 2, pending: 1, deferred: 0 });
    expect(await listDecisionEpisodes(db)).toHaveLength(1);
    expect((await modelSpendToday(db, EPISODE_KIND)).calls).toBe(1);
  });

  it("does not transmit a later batch whose source was forgotten during the first provider call", async () => {
    const forgotten = { ...source, source: "claude-code", sessionId: "forgotten-session",
      at: new Date("2026-08-31T12:00:00Z"), text: "Do not transmit this forgotten source." };
    await saveNarratives(db, [source, forgotten]);
    completeMock.mockImplementationOnce(async () => {
      await queueWrite(() => db.transaction((tx) => deleteNarratives(tx, { source: "claude-code" })));
      return output(fields());
    });
    await expect(learnEpisodes(db)).rejects.toThrow(/changed before analysis/);
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(completeMock.mock.calls)).not.toContain(forgotten.text);
    expect((await modelSpendToday(db, EPISODE_KIND)).calls).toBe(1);
    expect(await narrativeCount(db)).toEqual({ total: 1, pending: 0, deferred: 0 });
    expect(await listDecisionEpisodes(db)).toHaveLength(1);
  });

  it.each(["identity", "text", "context"] as const)("invalidates a later batch when its %s changes before transmission", async (field) => {
    const later = { ...source, source: "claude-code", sessionId: "later-session", at: new Date("2026-08-31T12:00:00Z") };
    await saveNarratives(db, [source, later]);
    const laterRow = (await listNarratives(db)).find((row) => row.sessionId === later.sessionId)!;
    completeMock.mockImplementationOnce(async () => {
      await queueWrite(() => db.execute(
        `UPDATE narratives SET ${field} = 'Changed source value' WHERE id = '${laterRow.id}'`,
      ));
      return output();
    });
    await expect(learnEpisodes(db)).rejects.toThrow(/changed before analysis/);
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(await narrativeCount(db)).toEqual({ total: 2, pending: 1, deferred: 0 });
    expect((await modelSpendToday(db, EPISODE_KIND)).calls).toBe(1);
  });

  it("does not mark even an empty extraction read after its source changes project during the call", async () => {
    await saveNarratives(db, [source]);
    completeMock.mockImplementationOnce(async () => {
      await queueWrite(() => saveNarratives(db, [{ ...source, identity: "git:corrected" }]));
      return output();
    });
    await expect(learnEpisodes(db)).rejects.toThrow(/attribution changed/);
    expect(await narrativeCount(db)).toEqual({ total: 1, pending: 1, deferred: 0 });
    expect(await listNarratives(db, { unread: true })).toMatchObject([{ identity: "git:corrected" }]);
    expect((await modelSpendToday(db, EPISODE_KIND)).calls).toBe(1);
  });

  it("rolls back extracted fields when the read marker cannot be committed", async () => {
    await saveNarratives(db, [source]);
    await db.execute(`CREATE OR REPLACE FUNCTION reject_episode_read() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Read receipt unavailable'; END $$`);
    await db.execute(`CREATE TRIGGER reject_episode_progress BEFORE UPDATE ON narratives
      FOR EACH ROW EXECUTE FUNCTION reject_episode_read()`);
    completeMock.mockResolvedValue(output(fields()));
    await expect(learnEpisodes(db)).rejects.toThrow();
    expect(await listDecisionEpisodes(db)).toEqual([]);
    expect(await narrativeCount(db)).toEqual({ total: 1, pending: 1, deferred: 0 });
    expect((await modelSpendToday(db, EPISODE_KIND)).calls).toBe(1);
  });
});
