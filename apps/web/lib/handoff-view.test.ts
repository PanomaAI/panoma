import { describe, expect, it } from "vitest";
import { AGENT_NAMES, APP_OF, APP_WORDS, NATIVE_AGENTS, SIGN_IN, SIGN_OUT, forkOf, resumeOf, type ConversationRef } from "@panoma/handoff";
import { HANDOFF_FAULTS } from "@panoma/handoff/faults";
import { t, type MessageKey } from "./i18n";
import {
  AGENT_LABELS,
  APP_LABELS,
  APP_WORD,
  DROPPED_KEYS,
  IN_APP_BY_HAND_KEY,
  INSIDE_CLAUDE,
  LARGE_BYTES,
  LARGE_TOKENS,
  NATIVE_TARGETS,
  SIGN_IN_WORDS,
  SIGN_OUT_WORDS,
  clockText,
  copyOfWord,
  dedupeById,
  defaultTier,
  digestText,
  filterConversations,
  forkCommandOf,
  groupByProject,
  handoffFaultKey,
  hasApp,
  iconKey,
  insideFolder,
  kiloTokens,
  largeBy,
  leftBehind,
  limitBadge,
  modelDigestDefault,
  parseTarget,
  projectFilterFrom,
  receiptFor,
  receiptKey,
  resumeCommandOf,
  sortNewest,
  sourceLabel,
  tierTokens,
  untilText,
  type HandoffReceiptView,
  type RootRow,
} from "./handoff-view";

const NOW = Date.parse("2026-09-11T10:00:00Z");

function ref(over: Partial<ConversationRef> & { id: string; cwd: string }): ConversationRef {
  return {
    agent: "claude-cli",
    sessionId: over.id,
    handle: over.id.slice(0, 8),
    path: `/home/x/.claude/projects/${over.id}.jsonl`,
    updatedAt: "2026-09-11T09:00:00Z",
    turnCount: 4,
    bytes: 2048,
    compacted: false,
    ...over,
  };
}

const ROOTS: RootRow[] = [
  { slug: "dev", name: "dev", root: "/Users/me/dev", real: "/Users/me/dev" },
  { slug: "lemonade", name: "Lemonade", root: "/Users/me/dev/lemonade", real: "/Users/me/dev/lemonade" },
  { slug: "tmp-thing", name: "Thing", root: "/tmp/thing", real: "/private/tmp/thing" },
];

describe("the copies of the engine's tables", () => {
  it("name every agent the way the engine does", () => {
    expect(AGENT_LABELS).toEqual(AGENT_NAMES);
    expect([...NATIVE_TARGETS]).toEqual([...NATIVE_AGENTS]);
  });

  it("know the same sign-out and sign-in commands, and the same resume lines", () => {
    /* Word for word: a panel that prints `/login` while the engine prints `claude auth login` is two flows. */
    expect(SIGN_OUT_WORDS).toEqual(SIGN_OUT);
    expect(SIGN_IN_WORDS).toEqual(SIGN_IN);
    expect(copyOfWord("claude auth logout")).toBe("claude auth logout");
    expect(copyOfWord("/auth inside gemini")).toBe("/auth");
    expect(INSIDE_CLAUDE).toEqual({ signOut: "/logout", signIn: "/login" });
    const id = "0b1c2d3e-4f50-4617-8899-aabbccddeeff";
    for (const agent of NATIVE_AGENTS) {
      const sessionId = agent === "opencode" ? "ses_0123456789abcdefABCD" : id;
      const engine = resumeOf(agent, sessionId, "/x", "linux");
      expect(resumeCommandOf(agent, sessionId)).toBe([engine!.command, ...engine!.args].join(" "));
      const fork = forkOf(agent, sessionId, "/x", "linux");
      expect(forkCommandOf(agent, sessionId)).toBe(fork ? [fork.command, ...fork.args].join(" ") : undefined);
    }
    expect(resumeCommandOf("claude-cli", "not safe; rm -rf /")).toBeUndefined();
    expect(resumeCommandOf("aider", id)).toBeUndefined();
  });

  it("name each desktop app the way the engine does, and by the same word", () => {
    const apps = Object.entries(APP_OF);
    expect(apps.length).toBe(Object.keys(APP_LABELS).length);
    for (const [agent, app] of apps) {
      expect(APP_LABELS[agent], agent).toBe(app!.name);
      expect(APP_WORD[agent], agent).toBe(app!.id);
      expect(APP_WORDS[app!.id]).toBe(agent);
      expect(hasApp(agent)).toBe(true);
    }
    expect(hasApp("opencode")).toBe(false);
  });

  /*
    The engine's `ResumeInApp.sentence` is English for the terminal and the channel, and the panel
    painted it as it came until 12-Sep-2026 — an English instruction on a Spanish screen. The
    screen now words the same three facts through a key per app, in both halves.
   */
  it("words the by-hand fallback of every app door in both languages, with the folder and the id", () => {
    for (const app of Object.values(APP_OF)) {
      const key = IN_APP_BY_HAND_KEY[app!.id];
      expect(key, app!.id).toBeDefined();
      for (const locale of ["es", "en"] as const) {
        const sentence = t(locale, key!, { cwd: "/Users/ana/proj", id: "6e6b7766" });
        expect(sentence, `${locale} ${app!.id}`).toContain("/Users/ana/proj");
        expect(sentence).toContain("6e6b7766");
        expect(sentence).not.toMatch(/\{cwd\}|\{id\}/);
      }
    }
    expect(Object.keys(IN_APP_BY_HAND_KEY).length).toBe(Object.keys(APP_OF).length);
  });

  /* A native writer checked against the source only has no `testedWith`; the screen says so in its own language. */
  it("has a sentence for a writer that was never run live, in both languages", () => {
    expect(t("es", "handoff.neverRunLive")).not.toBe("");
    expect(t("en", "handoff.neverRunLive")).toMatch(/never run live/);
  });

  it("have a sentence for every fault code in both languages", () => {
    for (const code of HANDOFF_FAULTS) {
      const key = handoffFaultKey(code);
      expect(key, code).toBe(`handoff.fault.${code}`);
      expect(t("es", key!)).not.toBe("");
      expect(t("en", key!)).not.toBe("");
    }
    expect(handoffFaultKey("body")).toBeUndefined();
  });
});

describe("the surface on a row", () => {
  it("labels an app row by the app and everything else by the agent", () => {
    expect(sourceLabel("claude-cli", "app")).toBe("Claude (app)");
    expect(sourceLabel("codex-cli", "app")).toBe("Codex (app)");
    expect(sourceLabel("claude-cli", "cli")).toBe("Claude Code");
    expect(sourceLabel("claude-cli")).toBe("Claude Code");
    /* An agent with no app keeps its name whatever the marker says. */
    expect(sourceLabel("opencode", "app")).toBe("OpenCode");
    expect(iconKey("codex-cli", "app")).toBe("codex-app");
    expect(iconKey("codex-cli", "cli")).toBe("codex-cli");
    expect(iconKey("opencode", "app")).toBe("opencode");
  });

  it("keys a receipt by agent and surface, and reads the key back", () => {
    expect(receiptKey("claude-cli", "cli")).toBe("claude-cli");
    expect(receiptKey("claude-cli")).toBe("claude-cli");
    expect(receiptKey("claude-cli", "app")).toBe("claude-cli@app");
    expect(parseTarget("claude-cli@app")).toEqual({ agent: "claude-cli", surface: "app" });
    expect(parseTarget("codex-cli")).toEqual({ agent: "codex-cli", surface: "cli" });
    for (const agent of ["claude-cli", "codex-cli"]) {
      for (const surface of ["cli", "app"] as const) expect(parseTarget(receiptKey(agent, surface))).toEqual({ agent, surface });
    }
  });

  it("finds the receipt of one target on one surface in either shape", () => {
    const receipt = (targetAgent: string, targetSurface?: "cli" | "app"): HandoffReceiptView => ({
      id: `${targetAgent}-${targetSurface ?? "cli"}`,
      projectId: null,
      title: null,
      sourceAgent: "codex-cli",
      sourceSessionId: "s",
      targetAgent,
      ...(targetSurface ? { targetSurface } : {}),
      targetSessionId: "t",
      targetPath: "/x",
      tier: "full",
      turns: 1,
      bytes: 1,
      dropped: { thinking: 0, images: 0, subagents: 0, offloaded: 0, secrets: 0, other: 0 },
      resumeCommand: null,
      createdAt: "2026-09-11T00:00:00Z",
    });
    const list = [receipt("claude-cli"), receipt("claude-cli", "app")];
    expect(receiptFor(list, "claude-cli")?.id).toBe("claude-cli-cli");
    expect(receiptFor(list, "claude-cli", "app")?.id).toBe("claude-cli-app");
    expect(receiptFor(list, "codex-cli", "app")).toBeUndefined();
    const keyed = { "claude-cli": list[0]!, "claude-cli@app": list[1]!, "codex-cli": null };
    expect(receiptFor(keyed, "claude-cli", "cli")?.id).toBe("claude-cli-cli");
    expect(receiptFor(keyed, "claude-cli", "app")?.id).toBe("claude-cli-app");
    expect(receiptFor(keyed, "codex-cli")).toBeUndefined();
  });

  it("filters an app row under its agent", () => {
    const rows = [ref({ id: "a", cwd: "/x", surface: "app" }), ref({ id: "b", cwd: "/x", agent: "codex-cli", surface: "app" })];
    expect(filterConversations(rows, ROOTS, { agent: "claude-cli", project: "all" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterConversations(rows, ROOTS, { agent: "codex-cli", project: "all" }).map((r) => r.id)).toEqual(["b"]);
  });

  it("has the app sentences in both languages, with the app named", () => {
    for (const locale of ["es", "en"] as const) {
      expect(t(locale, "handoff.openInApp", { app: "Claude (app)" })).toContain("Claude (app)");
      expect(t(locale, "handoff.appTrust", { cwd: "/x/y" })).toContain("/x/y");
      expect(t(locale, "handoff.sameAgentApp", { app: "Codex (app)" })).toContain("Codex (app)");
      expect(t(locale, "handoff.targetAppSub")).not.toBe("");
      expect(t(locale, "handoff.appLine")).not.toBe("");
      expect(t(locale, "handoff.appOpened", { app: "X" })).toContain("X");
      expect(t(locale, "handoff.appOpenFailed", { app: "X" })).toContain("X");
    }
  });
});

describe("grouping by project", () => {
  it("picks the deepest root and lists the loose folders last", () => {
    const rows = [
      ref({ id: "a", cwd: "/Users/me/dev/lemonade/src", updatedAt: "2026-09-10T00:00:00Z" }),
      ref({ id: "b", cwd: "/Users/me/dev/other", updatedAt: "2026-09-11T00:00:00Z" }),
      ref({ id: "c", cwd: "/Users/me/elsewhere", updatedAt: "2026-09-12T00:00:00Z" }),
      ref({ id: "d", cwd: "/Users/me/dev/lemonade", updatedAt: "2026-09-13T00:00:00Z" }),
    ];
    const groups = groupByProject(rows, ROOTS);
    expect(groups.map((g) => [g.slug, g.conversations.map((c) => c.id)])).toEqual([
      ["lemonade", ["d", "a"]],
      ["dev", ["b"]],
      [null, ["c"]],
    ]);
    expect(groups[2]!.path).toBe("/Users/me/elsewhere");
  });

  it("matches a folder through its resolved path too", () => {
    const rows = [ref({ id: "e", cwd: "/private/tmp/thing/sub" }), ref({ id: "f", cwd: "/tmp/thing" })];
    expect(groupByProject(rows, ROOTS).map((g) => g.slug)).toEqual(["tmp-thing"]);
  });

  it("never mistakes a sibling with the same prefix for a child", () => {
    expect(insideFolder("/Users/me/dev/lemonade-2", "/Users/me/dev/lemonade")).toBe(false);
    expect(insideFolder("/Users/me/dev/lemonade/", "/Users/me/dev/lemonade")).toBe(true);
    expect(insideFolder("C:\\Users\\me\\dev\\x", "C:/Users/me/dev")).toBe(true);
  });

  it("filters by agent and by project, and «none» means the loose folders", () => {
    const rows = [
      ref({ id: "a", cwd: "/Users/me/dev/lemonade" }),
      ref({ id: "b", cwd: "/Users/me/elsewhere", agent: "codex-cli" }),
    ];
    expect(filterConversations(rows, ROOTS, { agent: "all", project: "lemonade" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterConversations(rows, ROOTS, { agent: "codex-cli", project: "all" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterConversations(rows, ROOTS, { agent: "all", project: "none" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterConversations(rows, ROOTS, { agent: "codex-cli", project: "lemonade" })).toEqual([]);
  });

  it("sorts newest first and keeps the query only when it names a root", () => {
    const rows = [ref({ id: "old", cwd: "/x", updatedAt: "2026-01-01T00:00:00Z" }), ref({ id: "new", cwd: "/x" })];
    expect(sortNewest(rows).map((r) => r.id)).toEqual(["new", "old"]);
    /* Two files, one id: the newest survives, so the list never keys two rows the same. */
    const twins = [ref({ id: "same", cwd: "/x", updatedAt: "2026-01-01T00:00:00Z", bytes: 1 }), ref({ id: "same", cwd: "/x", bytes: 2 })];
    expect(dedupeById(twins).map((r) => r.bytes)).toEqual([2]);
    expect(projectFilterFrom("lemonade", ROOTS)).toBe("lemonade");
    expect(projectFilterFrom("nope", ROOTS)).toBe("all");
    expect(projectFilterFrom(undefined, ROOTS)).toBe("all");
  });
});

describe("the limit badge", () => {
  it("is a fact about the clock, judged at one instant", () => {
    expect(limitBadge(undefined, NOW)).toBeUndefined();
    expect(limitBadge({ at: "2026-09-11T09:00:00Z" }, NOW)).toEqual({ state: "unknown" });
    expect(limitBadge({ at: "2026-09-11T09:00:00Z", resetsAt: "garbage" }, NOW)).toEqual({ state: "unknown" });
    const ahead = limitBadge({ at: "2026-09-11T09:00:00Z", resetsAt: "2026-09-11T12:00:00Z" }, NOW);
    expect(ahead?.state).toBe("before");
    const behind = limitBadge({ at: "2026-09-11T09:00:00Z", resetsAt: "2026-09-11T09:30:00Z" }, NOW);
    expect(behind?.state).toBe("after");
  });

  it("says how long until the reset, forward, in both languages", () => {
    const at = (minutes: number) => new Date(NOW + minutes * 60_000);
    expect(untilText(at(0.5), "en", NOW)).toBe("in under a minute");
    expect(untilText(at(35), "en", NOW)).toBe("in 35 min");
    expect(untilText(at(35), "es", NOW)).toBe("en 35 min");
    expect(untilText(at(3 * 60), "en", NOW)).toBe("in 3 h");
    expect(untilText(at(3 * 24 * 60), "es", NOW)).toBe("en 3 d");
  });

  it("formats the time with the viewer's Intl and adds the day only when it is not today", () => {
    const today = new Date(NOW + 5 * 60_000);
    const sameDay = clockText(today, "en", NOW);
    expect(sameDay).toMatch(/\d{1,2}:\d{2}/);
    expect(sameDay).not.toMatch(/Sep/);
    const tomorrow = clockText(new Date(NOW + 30 * 3_600_000), "en", NOW);
    expect(tomorrow).toMatch(/Sep/);
  });
});

describe("tiers, sizes and words", () => {
  it("preselects compact only over sixteen mebibytes, and brief for a document-only target", () => {
    expect(defaultTier(1024, true)).toBe("full");
    expect(defaultTier(16 * 1024 * 1024, true)).toBe("full");
    expect(defaultTier(16 * 1024 * 1024 + 1, true)).toBe("compact");
    expect(defaultTier(1024, false)).toBe("brief");
    expect(LARGE_BYTES).toBe(16 * 1024 * 1024);
  });

  /*
    Since 15-Sep-2026 the estimate decides too: a transcript over 150,000 tokens is more than a
    context takes at once, whatever its bytes say, and the hint under the radios names the
    measure that decided — the tokens first, the file size only when the estimate is absent or
    under the line.
   */
  it("preselects compact over 150k tokens too, and says which measure decided", () => {
    expect(LARGE_TOKENS).toBe(150_000);
    expect(defaultTier(1024, true, 150_000)).toBe("full");
    expect(defaultTier(1024, true, 150_001)).toBe("compact");
    expect(defaultTier(1024, true, undefined)).toBe("full");
    expect(defaultTier(LARGE_BYTES + 1, true, 10)).toBe("compact");
    /* A document-only target is a document whatever the size. */
    expect(defaultTier(1024, false, 900_000)).toBe("brief");
    expect(largeBy(1024, 150_001)).toBe("tokens");
    expect(largeBy(LARGE_BYTES + 1, 150_001)).toBe("tokens");
    expect(largeBy(LARGE_BYTES + 1, 10)).toBe("bytes");
    expect(largeBy(LARGE_BYTES + 1)).toBe("bytes");
    expect(largeBy(1024, 10)).toBeUndefined();
    expect(largeBy(1024)).toBeUndefined();
    for (const locale of ["es", "en"] as const) {
      const hint = t(locale, "handoff.tierPreselectedTokens", { k: 628 });
      expect(hint, locale).toContain("628k");
      expect(hint).not.toMatch(/\{/);
    }
  });

  it("reads each tier's weight from the preview's sizes, and nothing from an older catalog", () => {
    const sizes = { full: { turns: 40, estimatedTokens: 628_000 }, compact: { turns: 13, estimatedTokens: 9_200 }, brief: { estimatedTokens: 2_900 } };
    expect(tierTokens(sizes, "full")).toBe(628_000);
    expect(tierTokens(sizes, "compact")).toBe(9_200);
    expect(tierTokens(sizes, "brief")).toBe(2_900);
    expect(tierTokens(undefined, "full")).toBeUndefined();
    for (const locale of ["es", "en"] as const) {
      expect(t(locale, "handoff.tierTokens", { k: kiloTokens(628_000) }), locale).toBe("≈ 628k tokens");
    }
  });

  it("rounds tokens to thousands and never says zero", () => {
    expect(kiloTokens(120)).toBe(1);
    expect(kiloTokens(14_600)).toBe(15);
  });

  it("names what stays behind and omits the zeros", () => {
    const parts = leftBehind({ thinking: 3, images: 0, subagents: 2, offloaded: 0, secrets: 1, other: 0 });
    expect(parts.map((p) => p.key)).toEqual(["handoff.left.thinking", "handoff.left.subagents", "handoff.left.secrets"]);
    const words = parts.map((p) => t("en", p.key, { n: p.n }));
    expect(words).toEqual(["thinking", "subagent runs: 2", "secrets masked: 1"]);
    expect(t("es", "handoff.leftBehind", { list: words.join(", ") })).toContain("thinking, subagent runs: 2");
  });

  /*
    All six counts, in the terminal's order: a Claude Code conversation whose tool results over
    64 KiB stayed behind was painted as if nothing had, because the screen knew four of the six
    while the CLI and the channel listed «offloaded tool outputs» and «other records».
   */
  it("names the offloaded tool outputs and the other records too, as the terminal does", () => {
    const parts = leftBehind({ thinking: 0, images: 1, subagents: 0, offloaded: 4, secrets: 0, other: 2 });
    expect(parts.map((p) => p.key)).toEqual(["handoff.left.images", "handoff.left.offloaded", "handoff.left.other"]);
    expect(parts.map((p) => t("en", p.key, { n: p.n }))).toEqual(["images: 1", "offloaded tool outputs: 4", "other records: 2"]);
    expect(t("es", "handoff.left.offloaded", { n: 4 })).toMatch(/4$/);
    /* One row per count of `Dropped`, so the table above the button paints every figure the engine keeps. */
    expect(DROPPED_KEYS.map((entry) => entry.count)).toEqual(["thinking", "images", "subagents", "offloaded", "secrets", "other"]);
    for (const { row, left } of DROPPED_KEYS) {
      for (const locale of ["es", "en"] as const) {
        expect(t(locale, row), `${locale} ${row}`).not.toBe("");
        expect(t(locale, left, { n: 2 }), `${locale} ${left}`).not.toBe("");
      }
    }
  });

  it("renders the digest as a document with only the sections that have something", () => {
    const text = digestText({
      by: "panoma",
      title: "Lemonade ledger",
      goal: "Keep the ledger balanced.",
      decisions: ["Use SQLite."],
      filesTouched: [],
      commandsRun: ["pnpm test"],
      openItems: [],
      lastExchange: { user: "Done?", assistant: "Yes." },
      stats: { turns: 4, toolCalls: 1, estimatedTokens: 300 },
    });
    expect(text).toContain("# Lemonade ledger");
    expect(text).toContain("## Decisions\n- Use SQLite.");
    expect(text).not.toContain("## Files touched");
    expect(text).toContain("**Assistant:** Yes.");
  });

  it("puts the number at the end of every counted sentence", () => {
    const counted: MessageKey[] = [
      "handoff.turns",
      "handoff.row.lastTurns",
      "handoff.left.images",
      "handoff.left.subagents",
      "handoff.left.offloaded",
      "handoff.left.secrets",
      "handoff.left.other",
    ];
    for (const key of counted) {
      for (const locale of ["es", "en"] as const) {
        expect(t(locale, key, { n: 1 }), `${locale} ${key}`).toMatch(/1$/);
      }
    }
    /* The cap too: with PANOMA_HANDOFF_BUDGET=1 the line once read «Today’s 1 are spent». */
    for (const locale of ["es", "en"] as const) {
      expect(t(locale, "handoff.digestSpent", { cap: 1 }), locale).toMatch(/1$/);
    }
  });

  /*
    A cap of zero is the family paused, or disabled by hand, in Spend: «Today’s 0 are spent — more
    tomorrow» was a false sentence. The zero gets its own, with no figure in it.
   */
  it("says paused, not spent, for a cap of zero", () => {
    for (const locale of ["es", "en"] as const) {
      const sentence = t(locale, "handoff.digestPaused");
      expect(sentence, locale).not.toBe("");
      expect(sentence).not.toMatch(/\d|\{/);
    }
    expect(t("en", "handoff.digestPaused")).toMatch(/Spend/);
  });

  /*
    `too-large` is thrown at read time, whatever the tier: the preview itself fails with it and
    no tier is ever offered, so a sentence that said «choose digest + last turns» pointed at a
    choice the person could not make. Both halves now say what the terminal and the channel say.
   */
  it("tells the truth about a conversation over 64 MiB: it is more than a handoff carries", () => {
    for (const locale of ["es", "en"] as const) {
      const sentence = t(locale, "handoff.fault.too-large");
      expect(sentence, locale).toContain("64 MiB");
      expect(sentence).not.toMatch(/digest \+ last turns|resumen \+ últimos turnos/);
    }
    expect(t("en", "handoff.fault.too-large")).toBe("The conversation is over 64 MiB, which is more than a handoff carries.");
  });
});

describe("the model digest's box", () => {
  const base = { tier: "compact" as const, connected: true, cap: 10, left: 7, calls: 3, summaryReadable: false };

  /*
    The chain reads the transcript in windows, one paid call each, so the box is a price before
    it is a choice: on by default only when the tier needs a digest, a model is connected, the
    source carries no summary panoma can read and the chain fits in what is left today.
   */
  it("starts ticked for a source with no readable summary when the chain fits today", () => {
    const choice = modelDigestDefault(base);
    expect(choice.on).toBe(true);
    expect(choice.disabled).toBe(false);
    expect(choice.key).toBe("handoff.digestNoSourceSummary");
    expect(choice.params).toEqual({ n: 3, m: 7, cap: 10 });
    /* The whole cap exactly fits: the brake is `spent + calls > cap`, and seven of seven left is not over it. */
    expect(modelDigestDefault({ ...base, calls: 7 }).on).toBe(true);
  });

  it("starts off, and stays enabled, when the source carries its own readable summary", () => {
    const choice = modelDigestDefault({ ...base, summaryReadable: true });
    expect(choice).toEqual({ on: false, disabled: false, key: "handoff.digestSourceSummary", params: { n: 3 } });
  });

  it("is off and disabled at tier full, with the source's line still under it", () => {
    const full = modelDigestDefault({ ...base, tier: "full" });
    expect(full.on).toBe(false);
    expect(full.disabled).toBe(true);
    expect(full.key).toBe("handoff.digestNoSourceSummary");
    expect(modelDigestDefault({ ...base, tier: "full", summaryReadable: true })).toMatchObject({ on: false, disabled: true, key: "handoff.digestSourceSummary" });
    expect(modelDigestDefault({ ...base, tier: "brief" }).on).toBe(true);
  });

  it("names the cause where the count would be, in the order a person acts on", () => {
    expect(modelDigestDefault({ ...base, connected: false })).toEqual({ on: false, disabled: true, key: "handoff.digestNoModel", params: {} });
    /* A cap of zero is the family paused or disabled in Spend, not a day's worth spent. */
    expect(modelDigestDefault({ ...base, cap: 0, left: 0 })).toEqual({ on: false, disabled: true, key: "handoff.digestPaused", params: {} });
    expect(modelDigestDefault({ ...base, left: 0 })).toEqual({ on: false, disabled: true, key: "handoff.digestSpent", params: { cap: 10 } });
    /* Something left, but fewer calls than the chain needs: the 429 the write would answer, said before the click. */
    expect(modelDigestDefault({ ...base, calls: 8 })).toEqual({ on: false, disabled: true, key: "handoff.digestNeeds", params: { n: 8, m: 7, cap: 10 } });
    /* No model wins over everything, and a summary the model could read changes nothing about the price. */
    expect(modelDigestDefault({ ...base, connected: false, calls: 8, summaryReadable: true }).key).toBe("handoff.digestNoModel");
    expect(modelDigestDefault({ ...base, calls: 8, summaryReadable: true }).key).toBe("handoff.digestNeeds");
  });

  /* A catalog older than the chain answers no `modelDigest`: the box behaves as it did before, off with the «left today» line. */
  it("keeps the old line, and the box off, when the catalog did not count the calls", () => {
    expect(modelDigestDefault({ ...base, calls: undefined })).toEqual({ on: false, disabled: false, key: "handoff.digestLeft", params: { n: 7, cap: 10 } });
    expect(modelDigestDefault({ ...base, calls: undefined, tier: "full" }).disabled).toBe(true);
  });

  it("fills every gap of every line it can choose, in both languages, and closes each clause with its figure", () => {
    const cases = [
      base,
      { ...base, summaryReadable: true },
      { ...base, connected: false },
      { ...base, cap: 0, left: 0 },
      { ...base, left: 0 },
      { ...base, calls: 8 },
      { ...base, calls: undefined },
    ];
    for (const input of cases) {
      const choice = modelDigestDefault(input);
      for (const locale of ["es", "en"] as const) {
        const line = t(locale, choice.key, choice.params);
        expect(line, `${locale} ${choice.key}`).not.toBe("");
        expect(line, `${locale} ${choice.key}`).not.toMatch(/\{/);
      }
    }
    /* «{n} llamadas» would have been the tenth return of the glued plural: the figure closes the clause instead. */
    for (const locale of ["es", "en"] as const) {
      expect(t(locale, "handoff.digestSourceSummary", { n: 1 }), locale).toMatch(/1$/);
      expect(t(locale, "handoff.digestNeeds", { n: 1, m: 1, cap: 1 }), locale).toMatch(/: 1; .*1 .* 1 /);
      expect(t(locale, "handoff.digestNoSourceSummary", { n: 1, m: 1, cap: 1 }), locale).toMatch(/: 1 \(/);
    }
    expect(t("en", "handoff.digestNeeds", { n: 3, m: 2, cap: 10 })).toBe("Needs calls: 3; 2 of 10 left today — raise the cap in Spend or keep the mechanical digest");
  });
});
