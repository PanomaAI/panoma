import { describe, expect, it } from "vitest";
import { renderPredicate, validatePredicate, type ConsentGrant, type MemoryCase } from "@panoma/core";
import {
  FACT_KINDS, FRESHNESS_MS, SUPPORT_FAMILIES_FLOOR as DB_FAMILIES_FLOOR, UNKNOWN_REFERENT as DB_UNKNOWN_REFERENT, isAmbiguousReaction as dbIsAmbiguousReaction,
  type Check, type CommitmentView, type JobView, type OccurrenceView, type OfferRow, type SupportEvidence,
} from "@panoma/db";
import { t, type Locale } from "./i18n";
import type { MemoryStatus } from "./memory-status";
import type { PublicationState } from "./taste-publish";
import type { TwinLearnReport, TwinWaitReason } from "./twin-learn";
import {
  OBSERVATION_KIND_KEYS,
  PUBLICATION_STATUS_KEYS,
  PUBLICATION_STATUS_TONES,
  SUPPORT_FAMILIES_FLOOR,
  TWIN_WAIT_KEYS,
  TWIN_WAIT_TONES,
  UNKNOWN_REFERENT,
  criterionRowView,
  criterionRowViews,
  evidenceMarks,
  familiesLine,
  isAmbiguousReaction,
  learningView,
  observationRowViews,
  proposalGroups,
  publicationView,
  tasteRefusalKey,
  QUOTA_NEAR,
  quotaPauseView,
} from "./memory-view";
import { QUOTA_NEAR as QUOTA_NEAR_OF_GATE } from "./memory-quota";
import {
  ATTEMPT_KEYS,
  CHANNEL_KEYS,
  CHECK_PURPOSE_KEYS,
  CHECK_PURPOSE_ORDER,
  CHECK_RESULT_KEYS,
  COMMITMENT_OBSERVATIONS_SHOWN,
  COMMITMENT_STATE_KEYS,
  DELIVERED_BEFORE_KEYS,
  FACT_KIND_KEYS,
  FACT_KIND_ORDER,
  HOOK_EVENT_KEYS,
  HOOK_EVENT_ORDER,
  HOOK_STATE_KEYS,
  JOB_STATUS_KEYS,
  JOB_STATUS_TONES,
  OBSERVATION_FRESH_MS,
  OFFER_STATUS_KEYS,
  RECEPTION_KEYS,
  UNIT_KIND_KEYS,
  VERDICT_KEYS,
  CAPTURE_SOURCES,
  bridgeMemoryView,
  captureRefusalKey,
  caseListRows,
  caseView,
  checkDescription,
  checkReasonKey,
  checkStateKey,
  checkStateTone,
  checkStateViews,
  commitmentRowView,
  decisionRowView,
  deliveryLines,
  durableKey,
  expiredAt,
  extractionView,
  factCountLines,
  hookEventViews,
  incidentViews,
  isMemoryCase,
  jobOriginKey,
  jobProcessorKey,
  jobReasonKey,
  jobRefusalKey,
  jobRowView,
  jobsPageView,
  lookView,
  memoryRefusalKey,
  offerView,
  omissionKey,
  projectMemoryView,
  reasonView,
  sourceGrantViews,
  successorsOf,
  unitHref,
  verdictWord,
} from "./memory-view";

/*
  The shaping the memory screens rely on, pinned against the real dictionary.

  Two things this file guards that no other test reaches. First, that the text an agent was given
  never reaches a component: an offer row carries `rendered` and `payload.items[].text`, and a
  view that kept either would print a private rule on a card by accident. Second, the wording
  with n = 1 — the number-at-the-end rule has come back nine times and only shows with one, which
  is the count a new user sees first. `plurals.test.ts` reads the dictionaries; this one renders
  the lines a component would render, with 1, in both languages.

  Delivery C adds a third: that no sentence of the checks, commitments, incidents and cases
  says obeyed or ignored (plan §23.4.2), and that a gap — a look that could not read, a check
  nobody looked at, a half the projection could not fill — survives the shaping as a gap and
  never becomes a verdict or an empty list.
 */

const LOCALES: Locale[] = ["es", "en"];

/** «1 offers», «1 ofertas»: an inflected word glued to the figure. */
const GLUED = /\b1 [a-záéíóúñ]{4,}(?:s|es)\b/i;

const BODY = "Never run the migration twice on the packaged catalog";
const RENDERED = `<!-- panoma-memory srv_test ... -->\n- ${BODY}\n<!-- /panoma-memory -->`;

function offerRow(overrides: Partial<OfferRow> = {}): OfferRow {
  return {
    id: "srv_test",
    projectId: "proj_1",
    agentId: null,
    arm: "served",
    experimentId: null,
    noteIds: ["note_1"],
    noteChars: BODY.length,
    at: new Date("2026-09-14T10:00:00.000Z"),
    schemaVersion: 2,
    contextId: "mctx_1",
    contextGeneration: 1,
    channel: "brief",
    requestKey: null,
    payload: {
      schemaVersion: 2,
      status: "requires_check",
      items: [
        {
          kind: "note", id: "note_1", revision: 3, scope: "project", authority: "owner_instruction",
          applicability: "applies", evidenceState: "verified", deliveryMode: "core", text: BODY,
        },
      ],
      checks: [{ itemKind: "decision", itemId: "dec_1", revision: 2, kind: "narrative_condition", text: "only on Fridays" }],
      coverage: { searchComplete: true, requiredComplete: true, sourceReadable: true, limitsHit: [], candidateCount: 3 },
      omissions: [{ reason: "channel_limit", count: 1, required: false }, { reason: "conflict", count: 2, required: false }],
      snapshot: {
        audience: "hook", projectRef: "proj_1", contextId: "mctx_1", contextGeneration: 1, publicationGeneration: 1,
        useGeneration: 0, grantRefs: [], rankingVersion: 1, renderVersion: 1, observedAt: "2026-09-14T10:00:00.000Z",
      },
      manifest: [{ kind: "decision", id: "dec_1", revision: 2, scope: "global", authority: "owner_instruction", applicability: "conditional", evidenceState: "unknown" }],
    },
    contentHash: "a".repeat(64),
    rendered: RENDERED,
    renderedHash: "b".repeat(64),
    serializedBytes: RENDERED.length,
    unitManifest: { schemaVersion: 1, units: [{ kind: "note", id: "note_1", revision: 3, start: 40, end: 98, unitHash: "c".repeat(64) }] },
    policySnapshot: { profile: "hook-brief-v1" },
    purgedAt: null,
    events: [
      { id: "sev_1", eventKind: "attempt", eventKey: null, sourceId: null, byteOffset: null, result: "failed", details: { schemaVersion: 1, error: "timeout" }, observedAt: new Date("2026-09-14T10:00:01.000Z") },
      { id: "sev_2", eventKind: "attempt", eventKey: null, sourceId: null, byteOffset: null, result: "sent", details: { schemaVersion: 1 }, observedAt: new Date("2026-09-14T10:00:02.000Z") },
      { id: "sev_3", eventKind: "reception", eventKey: "msrc_1:uuid-1", sourceId: "msrc_1", byteOffset: 1200, result: "unknown", details: { schemaVersion: 1, unitsIntact: 0, unitsTotal: 1, parserVersion: "claude-code-receipts-1", site: "hook_additional_context" }, observedAt: new Date("2026-09-14T10:00:03.000Z") },
      { id: "sev_4", eventKind: "reception", eventKey: "msrc_1:uuid-2", sourceId: "msrc_1", byteOffset: 2400, result: "partial", details: { schemaVersion: 1, unitsIntact: 1, unitsTotal: 2, parserVersion: "claude-code-receipts-1", site: "hook_additional_context" }, observedAt: new Date("2026-09-14T10:00:04.000Z") },
    ],
    ...overrides,
  };
}

const EMPTY_DELIVERY = { offers: 0, attempts: { sent: 0, failed: 0, unknown: 0 }, receptions: { full: 0, partial: 0, unknown: 0, notObserved: 0 }, unbound: 0 };

const AT = "2026-09-14T09:00:00.000Z";

/** Two capture grants of one source, a disabled one of another, and one of another purpose. */
const GRANTS: ConsentGrant[] = [
  { grantId: "grant_000000000001", generation: 1, source: "claude-code", purpose: "memoryCapture", scope: "global", scopeKeys: ["*"], enabled: true, noticeVersion: 2, activatedAt: AT },
  { grantId: "grant_000000000002", generation: 2, source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: ["git:abc"], enabled: true, noticeVersion: 1, activatedAt: AT },
  { grantId: "grant_000000000003", generation: 1, source: "codex", purpose: "memoryCapture", scope: "global", scopeKeys: ["*"], enabled: false, noticeVersion: 1, activatedAt: AT },
  { grantId: "grant_000000000004", generation: 3, source: "codex", purpose: "memoryExtract", scope: "global", scopeKeys: ["*"], enabled: true, noticeVersion: 1, activatedAt: AT },
];

/** The secret words of a job row that must never reach the card. */
const STAGED = "STAGED-CANARY never run the migration twice";
const PROMPT = "PROMPT-CANARY the attached material is untrusted";

function jobRow(overrides: Partial<JobView> = {}): JobView {
  return {
    id: "mjob_1",
    sessionId: null,
    processor: "project_extract",
    status: "failed",
    purpose: "project_extract",
    origin: "automatic",
    projectId: "proj_alpha",
    coverage: { intervals: 3, bytes: 4096, sources: 2 },
    attempts: 2,
    paidAttempts: 1,
    reason: "unusable",
    retryAt: new Date("2026-09-15T00:00:00.000Z"),
    createdAt: new Date("2026-09-14T10:00:00.000Z"),
    startedAt: new Date("2026-09-14T10:00:01.000Z"),
    finishedAt: new Date("2026-09-14T10:00:05.000Z"),
    rev: 4,
    requestedRev: 0,
    receipt: {
      did: "extracted", candidates: 2, published: { notes: 1, episodes: 1 }, dropped: { quote_mismatch: 1 }, calls: 1,
      coverage: { intervals: 3, bytes: 4096, fragments: 2, facts: 5, evidenceUnits: 900, contextUnits: 120, calls: 1, model: "m", provider: "p", cut: false },
      targets: [{ operation: "revise", targetId: "mrev_1", revisionId: "mrev_2" }],
      staged: STAGED, prompt: PROMPT,
    },
    ...overrides,
  };
}

function statusDocument(): MemoryStatus {
  const hookState = (events: Record<"Stop" | "PreToolUse" | "SessionStart" | "SessionEnd", "installed" | "legacy" | "missing">, durable: boolean | null, settingsFile: boolean) =>
    ({ postCommit: durable !== null, events, durable, settingsFile });
  const hooks = hookState;
  const project = (slug: string, hooks: ReturnType<typeof hookState>, capture: MemoryStatus["projects"][number]["capture"]) => ({
    id: `proj_${slug}`, slug, name: slug, identity: null, root: `/tmp/${slug}`, capture, hooks, contexts: 0,
    delivery: { ...EMPTY_DELIVERY, offers: 1 },
  });
  return {
    schemaVersion: 2,
    capabilities: [
      { harness: "claude-code", entry: "desktop", version: "2.1.266", profile: "hook-brief-v1", configured: true, invocation: "observed", events: ["SessionStart"], receiptSite: "verified", subagents: "own_context", limits: null },
      { harness: "codex", entry: "cli", version: null, profile: null, configured: null, invocation: "unknown", events: [], receiptSite: "unsupported", subagents: "unknown", limits: null },
    ],
    projects: [
      project("alpha", hooks({ Stop: "installed", PreToolUse: "installed", SessionStart: "installed", SessionEnd: "installed" }, true, true), { grantId: "grant_000000000001", generation: 1, scope: "global" }),
      project("beta", hooks({ Stop: "legacy", PreToolUse: "missing", SessionStart: "missing", SessionEnd: "missing" }, false, true), null),
      project("gamma", hooks({ Stop: "missing", PreToolUse: "missing", SessionStart: "missing", SessionEnd: "missing" }, null, false), null),
    ],
    sources: [],
    delivery: { ...EMPTY_DELIVERY, offers: 3, receptions: { full: 1, partial: 0, unknown: 1, notObserved: 0 }, unbound: 1 },
    queue: { cursors: { pending: 2, active: 0, blocked: 1, complete: 4, revoked: 0 }, pointers: 3, deletions: { pending: 0, cleaning: 0 }, lastPass: null },
    coverage: {
      grants: GRANTS.map((grant) => ({
        grantId: grant.grantId, source: grant.source, purpose: grant.purpose, scope: grant.scope, scopeKeys: [...grant.scopeKeys],
        enabled: grant.enabled, generation: grant.generation, activatedAt: grant.activatedAt,
      })),
      quarantined: true,
      quarantineReason: "journal_mismatch",
    },
  };
}

describe("hooks per event", () => {
  it("lists the four events in session order with their state words", () => {
    const rows = hookEventViews({ events: { Stop: "installed", PreToolUse: "legacy", SessionStart: "missing", SessionEnd: "installed" } });
    expect(rows.map((row) => row.event)).toEqual([...HOOK_EVENT_ORDER]);
    expect(rows.map((row) => row.state)).toEqual(["missing", "legacy", "installed", "installed"]);
    for (const row of rows) {
      expect(row.label).toBe(HOOK_EVENT_KEYS[row.event]);
      expect(row.stateLabel).toBe(HOOK_STATE_KEYS[row.state]);
      for (const locale of LOCALES) expect(t(locale, row.label)).not.toBe("");
    }
  });

  it("judges durability in three sentences, and null is not «cannot run»", () => {
    expect(durableKey(true)).toBe("memory.durable");
    expect(durableKey(false)).toBe("memory.notDurable");
    expect(durableKey(null)).toBe("memory.durableUnknown");
    expect(t("en", durableKey(null))).not.toMatch(/cannot/i);
  });
});

describe("delivery counters", () => {
  it("closes every sentence with its figure, in both languages, with n = 1", () => {
    const lines = deliveryLines({ offers: 1, attempts: { sent: 1, failed: 1, unknown: 0 }, receptions: { full: 1, partial: 1, unknown: 1, notObserved: 1 }, unbound: 1 });
    expect(lines).toHaveLength(7);
    for (const line of lines) {
      for (const locale of LOCALES) {
        const text = t(locale, line.key, line.vars);
        expect(text, `${locale} ${line.key}`).toMatch(/: 1$/);
        expect(text, `${locale} ${line.key}`).not.toMatch(GLUED);
      }
    }
  });

  it("prints failed sends only when there is one", () => {
    const keys = deliveryLines(EMPTY_DELIVERY).map((line) => line.key);
    expect(keys).not.toContain("memory.attemptsFailed");
    expect(keys).toEqual([
      "memory.offers", "memory.receptionsFull", "memory.receptionsPartial", "memory.receptionsUnknown",
      "memory.receptionsNotObserved", "memory.unbound",
    ]);
  });
});

describe("an offer for the card", () => {
  it("keeps references and counters, never the text that travelled", () => {
    const view = offerView(offerRow());
    expect(view).toEqual({
      id: "srv_test",
      at: "2026-09-14T10:00:00.000Z",
      channel: "brief",
      status: "requires_check",
      purged: false,
      bound: true,
      units: [{ kind: "note", id: "note_1", revision: 3 }],
      manifest: [{ kind: "decision", id: "dec_1", revision: 2 }],
      omissions: [{ reason: "channel_limit", count: 1, required: false }, { reason: "conflict", count: 2, required: false }],
      attempt: "sent",
      reception: "partial",
      receptionUnits: { intact: 1, total: 2 },
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(BODY);
    expect(serialized).not.toContain("panoma-memory");
    expect(serialized).not.toContain("only on Fridays");
    expect(Object.keys(view)).not.toContain("rendered");
    expect(Object.keys(view)).not.toContain("payload");
  });

  it("the last event of each kind wins, and an unknown result word is no result", () => {
    const view = offerView(offerRow({
      events: [
        { id: "sev_1", eventKind: "reception", eventKey: null, sourceId: null, byteOffset: null, result: "full", details: { unitsIntact: 1, unitsTotal: 1 }, observedAt: new Date() },
        { id: "sev_2", eventKind: "reception", eventKey: null, sourceId: null, byteOffset: null, result: "bogus" as never, details: {}, observedAt: new Date() },
      ],
    }));
    expect(view.reception).toBeNull();
    expect(view.receptionUnits).toBeNull();
    expect(view.attempt).toBeNull();
  });

  it("a purged offer keeps the record that it existed and nothing of its content", () => {
    const view = offerView(offerRow({
      payload: null, rendered: null, renderedHash: null, contentHash: null, unitManifest: null, policySnapshot: null,
      serializedBytes: null, purgedAt: new Date("2026-09-15T00:00:00.000Z"), contextId: null, contextGeneration: null,
    }));
    expect(view.purged).toBe(true);
    expect(view.bound).toBe(false);
    expect(view.status).toBeNull();
    expect(view.units).toEqual([]);
    expect(view.manifest).toEqual([]);
    expect(view.omissions).toEqual([]);
    expect(view.reception).toBe("partial");
  });

  it("links every unit to the record a person reads", () => {
    expect(unitHref({ kind: "note", id: "note_1", revision: 1 }, "my-app")).toBe("/p/my-app#memory");
    expect(unitHref({ kind: "criterion", id: "crit", revision: 1 }, "my-app")).toBe("/twin#portrait");
    expect(unitHref({ kind: "decision", id: "dec 1", revision: 1 }, "my-app")).toBe("/twin?episode=dec%201#episode-dec 1");
  });

  it("names every omission reason the selector writes, and shows an unknown one as its code", () => {
    for (const reason of ["channel_limit", "unresolved_scope", "conflict", "incomplete_core"]) {
      const key = omissionKey(reason);
      expect(key).not.toBe("memory.omissionOther");
      for (const locale of LOCALES) {
        const text = t(locale, key, { count: 1, reason });
        expect(text, `${locale} ${reason}`).toMatch(/: 1$/);
        expect(text, `${locale} ${reason}`).not.toMatch(GLUED);
      }
    }
    expect(omissionKey("something_new")).toBe("memory.omissionOther");
    expect(t("en", omissionKey("something_new"), { count: 1, reason: "something_new" })).toBe("something_new: 1");
  });

  it("every status, channel, reception, attempt and kind word exists in both dictionaries", () => {
    const keys = [
      ...Object.values(OFFER_STATUS_KEYS), ...Object.values(CHANNEL_KEYS), ...Object.values(RECEPTION_KEYS),
      ...Object.values(ATTEMPT_KEYS), ...Object.values(UNIT_KIND_KEYS),
    ];
    for (const key of keys) {
      for (const locale of LOCALES) expect(t(locale, key), `${locale} ${key}`).not.toBe("");
    }
  });
});

describe("the bridge reading", () => {
  it("counts events over the projects with a settings file and durability over those with a hook", () => {
    const view = bridgeMemoryView(statusDocument());
    expect(view).not.toBeNull();
    expect(view!.judged).toBe(2);
    expect(view!.events.map((row) => [row.event, row.installed, row.legacy, row.missing])).toEqual([
      ["SessionStart", 1, 0, 1], ["PreToolUse", 1, 0, 1], ["Stop", 1, 1, 0], ["SessionEnd", 1, 0, 1],
    ]);
    expect(view!.durable).toEqual({ yes: 1, no: 1 });
  });

  it("carries the hosts, the catalog delivery, the backlog and the quarantine as plain fields", () => {
    const view = bridgeMemoryView(statusDocument())!;
    expect(view.hosts).toEqual([
      { harness: "claude-code", entry: "desktop", version: "2.1.266", invocation: "observed", receiptSite: "verified", profile: "hook-brief-v1", configured: true },
      { harness: "codex", entry: "cli", version: null, invocation: "unknown", receiptSite: "unsupported", profile: null, configured: null },
    ]);
    expect(view.delivery.offers).toBe(3);
    expect(view.backlog).toEqual({ pending: 2, blocked: 1, pointers: 3 });
    expect(view.quarantine).toEqual({ reason: "journal_mismatch" });
  });

  it("counts a source once however many enabled capture grants it holds, and never a disabled one", () => {
    expect(bridgeMemoryView(statusDocument())!.captureSources).toBe(1);
  });

  it("is null without a status document", () => {
    expect(bridgeMemoryView(undefined)).toBeNull();
  });

  it("the bridge lines close with the figure at n = 1", () => {
    for (const locale of LOCALES) {
      expect(t(locale, "memory.judged", { n: 1 })).toMatch(/: 1$/);
      expect(t(locale, "memory.captureSources", { n: 1 })).toMatch(/: 1$/);
      expect(t(locale, "memory.backlog", { count: 1 })).toMatch(/: 1$/);
      expect(t(locale, "memory.backlogBlocked", { count: 1 })).toMatch(/: 1$/);
      expect(t(locale, "memory.pointers", { n: 1 })).toMatch(/: 1$/);
      expect(t(locale, "memory.eventCounts", { installed: 1, legacy: 1, missing: 1 })).not.toMatch(GLUED);
      expect(t(locale, "memory.durableCount", { yes: 1, no: 1 })).not.toMatch(GLUED);
      expect(t(locale, "memory.unitsIntact", { intact: 1, total: 1 })).not.toMatch(GLUED);
      expect(t(locale, "memory.unitsTravelled", { n: 1 })).toMatch(/: 1$/);
      expect(t(locale, "memory.unitsReferenced", { n: 1 })).toMatch(/: 1$/);
    }
  });
});

describe("the project reading", () => {
  it("picks the project of the slug and says whether its receipts may be read", () => {
    const view = projectMemoryView(statusDocument(), "beta");
    expect(view).toEqual({
      hooks: { postCommit: true, events: { Stop: "legacy", PreToolUse: "missing", SessionStart: "missing", SessionEnd: "missing" }, durable: false, settingsFile: true },
      delivery: { ...EMPTY_DELIVERY, offers: 1 },
      capture: false,
      quarantined: true,
    });
    expect(projectMemoryView(statusDocument(), "alpha")!.capture).toBe(true);
  });

  it("is null for an unknown slug or without a document", () => {
    expect(projectMemoryView(statusDocument(), "nope")).toBeNull();
    expect(projectMemoryView(undefined, "alpha")).toBeNull();
  });
});

describe("the grants per source", () => {
  it("shows the global grant of each purpose, off included, null when never asked, and whether a reader exists", () => {
    const views = sourceGrantViews(GRANTS, ["claude-code", "codex", "cursor"]);
    expect(views).toEqual({
      "claude-code": {
        supported: true,
        capture: { enabled: true, generation: 1, noticeVersion: 2, activatedAt: AT },
        extract: null,
        autoLearn: null,
      },
      // Codex has a fact reader since delivery B: the card draws its switches; its receipts stay unread.
      codex: {
        supported: true,
        capture: { enabled: false, generation: 1, noticeVersion: 1, activatedAt: AT },
        extract: { enabled: true, generation: 3, noticeVersion: 1, activatedAt: AT },
        autoLearn: null,
      },
      cursor: { supported: false, capture: null, extract: null, autoLearn: null },
    });
  });

  it("ignores project-scoped grants: the switches are the global ones", () => {
    const grants = GRANTS.filter((grant) => grant.scope === "project");
    expect(sourceGrantViews(grants, ["claude-code"])).toEqual({ "claude-code": { supported: true, capture: null, extract: null, autoLearn: null } });
    expect(sourceGrantViews(undefined, ["codex"])).toEqual({ codex: { supported: true, capture: null, extract: null, autoLearn: null } });
  });

  it("carries the generation of each grant, which is the expectedRevision of the next click", () => {
    const views = sourceGrantViews(GRANTS, ["codex"]);
    expect(views["codex"]?.extract?.generation).toBe(3);
    expect(views["codex"]?.capture?.generation).toBe(1);
  });

  it("supports exactly the sources the capture pass reads: Claude Code and Codex", () => {
    expect([...CAPTURE_SOURCES]).toEqual(["claude-code", "codex"]);
    for (const source of CAPTURE_SOURCES) expect(sourceGrantViews(undefined, [source])[source]?.supported).toBe(true);
  });

  it("the three notices say their figures with the number at the end, in both languages", () => {
    for (const locale of LOCALES) {
      const retains = t(locale, "twin.extractRetains", { quotes: 1, chars: 1 });
      expect(retains).not.toMatch(GLUED);
      expect(retains).toMatch(/: 1\.$/);
      const quota = t(locale, "twin.extractQuota", { daily: 1, perConversation: 1 });
      expect(quota).not.toMatch(GLUED);
      expect(quota).toMatch(/: 1\.$/);
      for (const key of ["twin.factsReads", "twin.factsFrom", "twin.extractTravels", "twin.extractFrom", "twin.extractRevokeNote", "twin.extractNeedsCapture"] as const) {
        expect(t(locale, key), `${locale} ${key}`).not.toMatch(/\{[a-z]+\}/i);
      }
    }
    /* The facts notice names what is noted and what never is, in the words the plan closes. */
    expect(t("en", "twin.factsReads")).toMatch(/reads, edits/i);
    expect(t("en", "twin.factsReads")).toMatch(/never a command line/i);
    expect(t("en", "twin.extractNeedsCapture")).toMatch(/stops/i);
  });
});

describe("the grant door's refusals, in the reader's language (§20.4)", () => {
  it("maps every code the doors answer to a key that exists in both dictionaries, B codes included", () => {
    const codes = ["consent_required", "unsupported_source", "stale_revision", "stale_policy", "not_retryable", "invalid_input", "local_catalog_required"];
    for (const code of codes) {
      const key = captureRefusalKey(code);
      expect(key, code).toBeDefined();
      for (const locale of LOCALES) {
        const sentence = t(locale, key!);
        expect(sentence).not.toBe(key);
        expect(sentence).not.toMatch(/^[a-z_]+$/);
      }
    }
    expect(t("es", captureRefusalKey("unsupported_source")!)).not.toBe(t("en", captureRefusalKey("unsupported_source")!));
    expect(t("es", captureRefusalKey("stale_policy")!)).not.toBe(t("en", captureRefusalKey("stale_policy")!));
    expect(t("es", captureRefusalKey("not_retryable")!)).not.toBe(t("en", captureRefusalKey("not_retryable")!));
  });

  it("knows no key for an unknown code, so the card falls back to the door's sentence", () => {
    expect(captureRefusalKey("not_found")).toBeUndefined();
    expect(captureRefusalKey(undefined)).toBeUndefined();
    expect(captureRefusalKey(42)).toBeUndefined();
  });

  it("the jobs door says «the job changed», not «the permission changed», for a stale revision", () => {
    expect(jobRefusalKey("stale_revision")).toBe("memory.jobStale");
    expect(jobRefusalKey("not_found")).toBe("memory.jobUnknown");
    expect(jobRefusalKey("not_retryable")).toBe(captureRefusalKey("not_retryable"));
    expect(jobRefusalKey("local_catalog_required")).toBe(captureRefusalKey("local_catalog_required"));
    expect(jobRefusalKey("bogus")).toBeUndefined();
    for (const locale of LOCALES) {
      expect(t(locale, jobRefusalKey("stale_revision")!)).not.toMatch(/permis/i);
    }
  });
});

describe("the jobs of a project", () => {
  it("keeps status, attempts, paid calls, reason, revision and the published counts, never the receipt's structure", () => {
    const view = jobRowView(jobRow());
    expect(view).toEqual({
      id: "mjob_1",
      processor: "project_extract",
      status: "failed",
      origin: "automatic",
      intervals: 3,
      bytes: 4096,
      attempts: 2,
      paidAttempts: 1,
      reason: "unusable",
      retryAt: "2026-09-15T00:00:00.000Z",
      createdAt: "2026-09-14T10:00:00.000Z",
      finishedAt: "2026-09-14T10:00:05.000Z",
      rev: 4,
      published: { notes: 1, episodes: 1 },
      retryable: true,
      cancellable: true,
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(STAGED);
    expect(serialized).not.toContain(PROMPT);
    expect(serialized).not.toContain("mrev_");
    expect(Object.keys(view)).not.toContain("receipt");
    expect(Object.keys(view)).not.toContain("sessionId");
  });

  it("offers retry to failed and deferred jobs only, and cancel to every job that has not ended", () => {
    const verbs = (status: JobView["status"]) => {
      const view = jobRowView(jobRow({ status }));
      return [view.retryable, view.cancellable];
    };
    expect(verbs("pending")).toEqual([false, true]);
    expect(verbs("running")).toEqual([false, true]);
    expect(verbs("staged")).toEqual([false, true]);
    expect(verbs("deferred")).toEqual([true, true]);
    expect(verbs("failed")).toEqual([true, true]);
    expect(verbs("complete")).toEqual([false, false]);
    expect(verbs("cancelled")).toEqual([false, false]);
    expect(verbs("obsolete")).toEqual([false, false]);
  });

  it("a legacy job has no coverage, no receipt counts and null dates where it never got there", () => {
    const view = jobRowView(jobRow({ processor: "legacy_session", origin: "legacy", coverage: null, receipt: null, retryAt: null, finishedAt: null, status: "pending", reason: null }));
    expect(view.intervals).toBeNull();
    expect(view.bytes).toBeNull();
    expect(view.published).toBeNull();
    expect(view.retryAt).toBeNull();
    expect(view.finishedAt).toBeNull();
    /* A receipt whose counts are not numbers yields zeros, never a string on the card. */
    expect(jobRowView(jobRow({ receipt: { published: { notes: "many", episodes: -1 } } })).published).toEqual({ notes: 0, episodes: 0 });
  });

  it("the page counts the backlog over the jobs not yet published and says whether older ones exist", () => {
    const page = jobsPageView({
      jobs: [
        jobRow({ id: "a", status: "pending", coverage: { intervals: 2, bytes: 1, sources: 1 } }),
        jobRow({ id: "b", status: "deferred", coverage: { intervals: 5, bytes: 1, sources: 1 } }),
        jobRow({ id: "c", status: "complete", coverage: { intervals: 7, bytes: 1, sources: 1 } }),
        jobRow({ id: "d", status: "obsolete", coverage: { intervals: 11, bytes: 1, sources: 1 } }),
        jobRow({ id: "e", status: "running", coverage: null }),
      ],
      nextCursor: "next",
    });
    expect(page).not.toBeNull();
    expect(page!.jobs.map((job) => job.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(page!.pendingIntervals).toBe(7);
    expect(page!.more).toBe(true);
    expect(jobsPageView({ jobs: [], nextCursor: null })).toEqual({ jobs: [], more: false, pendingIntervals: 0 });
    expect(jobsPageView(undefined)).toBeNull();
  });

  it("every status, processor, origin and reason word exists in both dictionaries, and an unknown one is printed as its code", () => {
    const statuses: JobView["status"][] = ["pending", "running", "staged", "deferred", "failed", "complete", "cancelled", "obsolete"];
    for (const status of statuses) {
      expect(JOB_STATUS_TONES[status]).toBeDefined();
      for (const locale of LOCALES) {
        const word = t(locale, JOB_STATUS_KEYS[status]);
        expect(word, `${locale} ${status}`).not.toBe("");
        /* No internal name on a control (§20.4): a staged job is not called «staged» to a person. */
        expect(word.toLowerCase(), `${locale} ${status}`).not.toBe("staged");
      }
    }
    for (const processor of ["legacy_session", "project_extract"]) {
      const key = jobProcessorKey(processor);
      expect(key, processor).toBeDefined();
      for (const locale of LOCALES) expect(t(locale, key!)).not.toBe("");
    }
    expect(jobProcessorKey("something_new")).toBeUndefined();
    for (const origin of ["legacy", "manual", "automatic"]) {
      const key = jobOriginKey(origin);
      expect(key, origin).toBeDefined();
      for (const locale of LOCALES) expect(t(locale, key!)).not.toBe("");
    }
    expect(jobOriginKey("robot")).toBeUndefined();
    const reasons = [
      "budget", "subquota", "conversation", "queueFull", "paused", "source_changed", "unusable", "unreadable", "extraction_failed",
      "publish_failed", "unavailable", "paid_ceiling", "duplicate_attempt", "leaseExpired", "permission_revoked", "source_purged",
      "window_overtaken", "extracted", "distilled", "thin", "unpublished", "cancelled",
    ];
    for (const reason of reasons) {
      const key = jobReasonKey(reason);
      expect(key, reason).not.toBe("memory.jobReasonOther");
      for (const locale of LOCALES) {
        const sentence = t(locale, key, { reason });
        expect(sentence, `${locale} ${reason}`).not.toBe("");
        expect(sentence, `${locale} ${reason}`).not.toMatch(/lease|staged/i);
      }
    }
    expect(jobReasonKey("something_new")).toBe("memory.jobReasonOther");
    expect(t("en", jobReasonKey("something_new"), { reason: "something_new" })).toBe("something_new");
  });

  it("the job lines close with the figure at n = 1, in both languages", () => {
    for (const locale of LOCALES) {
      expect(t(locale, "memory.jobAttempts", { n: 1 })).toMatch(/: 1$/);
      expect(t(locale, "memory.jobPaid", { n: 1 })).toMatch(/: 1$/);
      expect(t(locale, "memory.jobIntervals", { n: 1 })).toMatch(/: 1$/);
      expect(t(locale, "memory.backlog", { count: 1 })).toMatch(/: 1$/);
      expect(t(locale, "memory.attemptsPerWindow", { n: 1 })).toMatch(/: 1$/);
      expect(t(locale, "memory.jobPublished", { notes: 1, episodes: 1 })).not.toMatch(GLUED);
      expect(t(locale, "memory.jobPublished", { notes: 1, episodes: 1 })).toMatch(/1$/);
    }
  });
});

describe("the extraction's capacity", () => {
  const report = { intervals: { arrived: 9, completed: 4, deferred: 2, dropped: 1 }, attemptsPerCompleted: 1.3333, pendingBytes: 98304, oldestPendingAt: "2026-09-14T06:00:00.000Z", capacityLimited: true };

  it("keeps the figures a person can act on and rounds the attempts to one decimal", () => {
    expect(extractionView(report)).toEqual({
      pendingBytes: 98304,
      oldestPendingAt: "2026-09-14T06:00:00.000Z",
      attemptsPerCompleted: 1.3,
      intervals: { arrived: 9, completed: 4, deferred: 2, dropped: 1 },
      capacityLimited: true,
    });
    expect(extractionView({ ...report, attemptsPerCompleted: null, oldestPendingAt: null, pendingBytes: 0, capacityLimited: false })).toMatchObject({
      attemptsPerCompleted: null, oldestPendingAt: null, pendingBytes: 0, capacityLimited: false,
    });
    expect(extractionView(undefined)).toBeNull();
  });

  it("the capacity notice and its next step exist in both languages and name no internal word", () => {
    for (const locale of LOCALES) {
      expect(t(locale, "memory.capacityLimited")).not.toBe("");
      expect(t(locale, "memory.capacityHint")).toMatch(/spend/);
      expect(t(locale, "memory.pendingBytes", { size: "96 KB" })).toMatch(/96 KB$/);
      expect(t(locale, "memory.oldestPending", { date: "x" })).toMatch(/x$/);
    }
  });
});

/*
  T39 — the storage quota on the project card (plan §25.3). The view names the scope that
  closes the project — the catalog first, because a full catalog pauses every project — or the
  one nearing its limit, and is null when there is nothing to say. Every sentence is rendered
  in both languages with a figure of one, the way the rule has to be checked.
 */
describe("T39: the storage quota on the card", () => {
  const scope = (bytes: number, limit: number) => ({ bytes, limit, exceeded: bytes >= limit });

  it("pins the four-fifths threshold to the gate's", () => {
    expect(QUOTA_NEAR).toBe(QUOTA_NEAR_OF_GATE);
  });

  it("T39: says the catalog when it is full, this project when it is, the nearer scope otherwise, and nothing when nobody is near", () => {
    expect(quotaPauseView(undefined, "p1")).toBeNull();
    expect(quotaPauseView({ catalog: scope(10, 100), projects: { p1: scope(10, 50) }, paused: false }, "p1")).toBeNull();
    expect(quotaPauseView({ catalog: scope(10, 100), projects: {}, paused: false }, "p1")).toBeNull();
    expect(quotaPauseView({ catalog: scope(100, 100), projects: { p1: scope(10, 50) }, paused: true }, "p1")).toEqual({
      scope: "catalog", scopeKey: "memory.quotaScopeCatalog", paused: true, near: false, bytes: 100, limit: 100,
    });
    expect(quotaPauseView({ catalog: scope(60, 100), projects: { p1: scope(50, 50) }, paused: false }, "p1")).toEqual({
      scope: "project", scopeKey: "memory.quotaScopeProject", paused: true, near: false, bytes: 50, limit: 50,
    });
    // Another project's full counter is not this card's pause.
    expect(quotaPauseView({ catalog: scope(60, 100), projects: { p2: scope(50, 50) }, paused: false }, "p1")).toBeNull();
    expect(quotaPauseView({ catalog: scope(60, 100), projects: { p1: scope(40, 50) }, paused: false }, "p1")).toEqual({
      scope: "project", scopeKey: "memory.quotaScopeProject", paused: false, near: true, bytes: 40, limit: 50,
    });
    expect(quotaPauseView({ catalog: scope(80, 100), projects: { p1: scope(10, 50) }, paused: false }, "p1")).toEqual({
      scope: "catalog", scopeKey: "memory.quotaScopeCatalog", paused: false, near: true, bytes: 80, limit: 100,
    });
  });

  it("T39: the three sentences and the two scope words exist in both languages, and the line closes on the limit", () => {
    for (const locale of LOCALES) {
      for (const key of ["memory.quotaScopeCatalog", "memory.quotaScopeProject"] as const) {
        const word = t(locale, key);
        expect(word).not.toBe("");
        expect(t(locale, "memory.quotaPaused", { scope: word })).toContain(word);
        expect(t(locale, "memory.quotaNear", { scope: word })).toContain(word);
        const line = t(locale, "memory.quotaLine", { scope: word, used: "1.0 MB", limit: "1.0 MB" });
        expect(line).toMatch(/1\.0 MB$/);
        expect(line).not.toMatch(GLUED);
      }
      expect(t(locale, "memory.reasonQuota")).not.toBe("");
    }
    expect(jobReasonKey("quota")).toBe("memory.reasonQuota");
  });
});

describe("the facts by kind", () => {
  it("lists the kinds in the order @panoma/db closes them, each with a key in both dictionaries", () => {
    expect([...FACT_KIND_ORDER]).toEqual([...FACT_KINDS]);
    for (const kind of FACT_KINDS) {
      for (const locale of LOCALES) {
        expect(t(locale, FACT_KIND_KEYS[kind], { n: 1 }), `${locale} ${kind}`).toMatch(/: 1$/);
        expect(t(locale, FACT_KIND_KEYS[kind], { n: 1 }), `${locale} ${kind}`).not.toMatch(GLUED);
      }
    }
  });

  it("prints only the kinds with a count, in order, and nothing for no counts", () => {
    const lines = factCountLines({ read: 0, edit: 2, command: 0, test_result: 1, failure: 0, commit: 0, lifecycle: 5, receipt_seen: 0 });
    expect(lines).toEqual([
      { key: "memory.factEdit", vars: { n: 2 } },
      { key: "memory.factTestResult", vars: { n: 1 } },
      { key: "memory.factLifecycle", vars: { n: 5 } },
    ]);
    expect(factCountLines({ read: 0, edit: 0, command: 0, test_result: 0, failure: 0, commit: 0, lifecycle: 0, receipt_seen: 0 })).toEqual([]);
    expect(factCountLines(null)).toEqual([]);
    expect(factCountLines(undefined)).toEqual([]);
  });
});

// ── Delivery C: checks, commitments, incidents and cases ──────────────────────────────────

const NOW = new Date("2026-09-14T12:00:00.000Z");
const ROOT = "/Users/someone/Dev/private-project";
const CHECK_ID = "chk_00000000-0000-4000-8000-000000000001";
const OTHER_CHECK = "chk_00000000-0000-4000-8000-000000000002";
const ENVIRONMENT = "e".repeat(64);

/** The words the C screens must never print (plan §23.4.2), in either language. */
const OBEDIENCE = /obey|obedec|ignor/i;

function check(overrides: Partial<Check> & { kind?: Check["kind"] } = {}): Check {
  return {
    schemaVersion: 1, checkId: CHECK_ID, revision: 2, purpose: "grounds", kind: "file_hash", target: "package.json", expected: "a".repeat(64),
    ...overrides,
  } as Check;
}

function occurrence(overrides: {
  id?: string; kind?: "observation" | "incident"; objectId?: string; rev?: number; checkId?: string | null; checkRev?: number | null;
  result?: "pass" | "fail" | "unknown"; reason?: string; observedAt?: string; verdict?: "confirmed" | "false_positive" | null; verdictRev?: number;
} = {}): OccurrenceView {
  const kind = overrides.kind ?? "observation";
  const observedAt = new Date(overrides.observedAt ?? "2026-09-14T11:55:00.000Z");
  const row: OccurrenceView["latest"] = {
    id: overrides.id ?? "mout_1",
    kind,
    occurrenceId: `occ_${overrides.id ?? "1"}`,
    projectId: "proj_1",
    subjectRevisionId: "mrev_1",
    checkId: overrides.checkId === undefined ? CHECK_ID : overrides.checkId,
    checkRev: overrides.checkRev === undefined ? 2 : overrides.checkRev,
    environment: {
      schemaVersion: 1, environmentId: ENVIRONMENT, projectRef: "proj_1", resolvedRoot: ROOT, head: "b".repeat(40),
      dirtyFingerprint: "c".repeat(64), observedAt: observedAt.toISOString(),
      inspected: [{ path: "package.json", hash: "d".repeat(64), state: "read" }, { path: "src/secret-name.ts", state: "missing" }],
    },
    result: overrides.result ?? "fail",
    evidence: { schemaVersion: 1, sourceRefs: [], checkRevision: 2, observedCoverage: { inspected: 2, unknown: 0 }, deliveredBefore: "unknown", reason: overrides.reason ?? "hash_mismatch: 3f9a1b2c" },
    sourceId: null,
    observedAt,
    createdAt: observedAt,
    ownerVerdict: overrides.verdict ?? null,
    verdictRev: overrides.verdictRev ?? 1,
  };
  return {
    occurrenceId: row.occurrenceId,
    kind,
    projectId: "proj_1",
    subject: { revisionId: "mrev_1", kind: "note", objectId: overrides.objectId ?? "note_1", rev: overrides.rev ?? 3 },
    check: row.checkId !== null && row.checkRev !== null ? { checkId: row.checkId, checkRev: row.checkRev } : null,
    latest: row,
    latestByEnvironment: [{ environmentId: ENVIRONMENT, row }],
    rows: 4,
    results: { pass: 1, fail: 3, unknown: 0 },
    verdict: kind === "incident" ? { value: row.ownerVerdict, rev: row.verdictRev, rowId: row.id } : null,
    deliveredBefore: "unknown",
    openedAt: observedAt,
    lastAt: observedAt,
  };
}

function commitment(overrides: Partial<CommitmentView> = {}): CommitmentView {
  const at = (iso: string) => new Date(iso);
  return {
    id: "cmt_1",
    projectId: "proj_1",
    taskId: "task_1",
    text: "Ship the migration only after the packaged catalog restores from a copy",
    conditions: null,
    completionChecks: [check({ purpose: "completion", kind: "path_exists", target: "ops/restore.mjs", expected: true } as Partial<Check>)],
    checks: [check({ checkId: OTHER_CHECK, purpose: "violation", kind: "text_absent", target: "README.md", expected: "TODO" } as Partial<Check>)],
    status: "open",
    memoryRev: 3,
    createdBy: "human",
    resolution: null,
    createdAt: at("2026-09-13T10:00:00.000Z"),
    resolvedAt: null,
    observations: [
      { id: "mout_a", kind: "observation", occurrenceId: "occ_a", revision: 3, checkId: CHECK_ID, checkRev: 2, environmentId: ENVIRONMENT, result: "fail", evidence: { reason: "absent" }, observedAt: at("2026-09-14T11:58:00.000Z"), createdAt: at("2026-09-14T11:58:00.000Z"), ownerVerdict: null, verdictRev: 1 },
      { id: "mout_b", kind: "observation", occurrenceId: "occ_a", revision: 3, checkId: CHECK_ID, checkRev: 2, environmentId: ENVIRONMENT, result: "pass", evidence: { reason: "exists" }, observedAt: at("2026-09-14T11:40:00.000Z"), createdAt: at("2026-09-14T11:40:00.000Z"), ownerVerdict: null, verdictRev: 1 },
      { id: "mout_c", kind: "observation", occurrenceId: "occ_b", revision: 2, checkId: CHECK_ID, checkRev: 1, environmentId: ENVIRONMENT, result: "unknown", evidence: { reason: "unreadable" }, observedAt: null, createdAt: at("2026-09-14T09:00:00.000Z"), ownerVerdict: null, verdictRev: 1 },
      { id: "mout_d", kind: "observation", occurrenceId: "occ_c", revision: 1, checkId: CHECK_ID, checkRev: 1, environmentId: ENVIRONMENT, result: "pass", evidence: { reason: "exists" }, observedAt: at("2026-09-13T12:00:00.000Z"), createdAt: at("2026-09-13T12:00:00.000Z"), ownerVerdict: null, verdictRev: 1 },
      { id: "mout_e", kind: "observation", occurrenceId: "occ_d", revision: 1, checkId: CHECK_ID, checkRev: 1, environmentId: ENVIRONMENT, result: "pass", evidence: { reason: "exists" }, observedAt: at("2026-09-13T11:00:00.000Z"), createdAt: at("2026-09-13T11:00:00.000Z"), ownerVerdict: null, verdictRev: 1 },
      { id: "mout_f", kind: "observation", occurrenceId: "occ_e", revision: 1, checkId: CHECK_ID, checkRev: 1, environmentId: ENVIRONMENT, result: "fail", evidence: { reason: "absent" }, observedAt: at("2026-09-13T10:30:00.000Z"), createdAt: at("2026-09-13T10:30:00.000Z"), ownerVerdict: null, verdictRev: 1 },
      { id: "inc_1", kind: "incident", occurrenceId: "inc_occ", revision: 3, checkId: CHECK_ID, checkRev: 2, environmentId: ENVIRONMENT, result: "fail", evidence: { reason: "completion: absent" }, observedAt: at("2026-09-14T11:59:00.000Z"), createdAt: at("2026-09-14T11:59:00.000Z"), ownerVerdict: null, verdictRev: 1 },
    ],
    ...overrides,
  };
}

function memoryCase(overrides: Partial<MemoryCase> = {}): MemoryCase {
  return {
    schemaVersion: 1,
    taskId: "task_1",
    project: { id: "proj_1", slug: "my-app", name: "My app" },
    asked: { text: "Add the restore script\n\nOnly after the copy is verified", createdAt: "2026-09-13T09:00:00.000Z" },
    decided: [{ episodeId: "dec_1", revision: 2, decision: "Restores go through ops/restore.mjs", when: "2026-09-12T09:00:00.000Z" }],
    declared: [{ sessionId: "ses_1", kind: "change", summary: "Wrote ops/restore.mjs" }, { sessionId: "ses_1", kind: "summary", summary: "Task closed" }],
    checked: [{ commitmentId: "cmt_1", status: "open", observations: [{ checkId: CHECK_ID, revision: 2, result: "fail", environmentId: ENVIRONMENT, observedAt: "2026-09-14T11:58:00.000Z", looks: 1 }] }],
    unknown: [],
    ...overrides,
  };
}

describe("a check and its look (delivery C)", () => {
  it("reads the patrol's reason back into its code and what was seen, dropping the purpose prefix of an incident", () => {
    expect(reasonView("hash_mismatch")).toEqual({ code: "hash_mismatch", observed: null });
    expect(reasonView("hash_mismatch: 3f9a1b2c")).toEqual({ code: "hash_mismatch", observed: "3f9a1b2c" });
    expect(reasonView("violation: present")).toEqual({ code: "present", observed: null });
    expect(reasonView("grounds: version_differs: workspace")).toEqual({ code: "version_differs", observed: "workspace" });
    expect(reasonView("")).toEqual({ code: "", observed: null });
    expect(reasonView(undefined)).toEqual({ code: "", observed: null });
  });

  it("names every evaluator reason in both dictionaries, prints an unknown one as its code, and never says obeyed or ignored", () => {
    const reasons = [
      "limit_reached", "malformed", "outside_root", "unreadable", "missing", "exists", "absent", "present", "hash_match", "hash_mismatch",
      "script_defined", "script_missing", "script_differs", "dependency_declared", "dependency_missing", "version_differs",
      "key_present", "key_missing", "value_matches", "value_differs",
    ];
    for (const reason of reasons) {
      const key = checkReasonKey(reason);
      expect(key, reason).not.toBe("memory.checkReasonOther");
      for (const locale of LOCALES) {
        const sentence = t(locale, key, { reason });
        expect(sentence, `${locale} ${reason}`).not.toBe("");
        expect(sentence, `${locale} ${reason}`).not.toMatch(OBEDIENCE);
      }
    }
    expect(t("en", checkReasonKey("brand_new"), { reason: "brand_new" })).toBe("brand_new");
  });

  it("describes every kind with a sentence in both languages, and a text check by its length, never its literal", () => {
    const literal = "NEVER-PRINT-THIS-LITERAL";
    const descriptions = [
      checkDescription(check({ kind: "path_exists", expected: true } as Partial<Check>)),
      checkDescription(check({ kind: "path_exists", expected: false } as Partial<Check>)),
      checkDescription(check()),
      checkDescription(check({ kind: "text_present", expected: literal } as Partial<Check>)),
      checkDescription(check({ kind: "text_absent", expected: literal } as Partial<Check>)),
      checkDescription(check({ kind: "manifest_script", expected: { name: "test" } } as Partial<Check>)),
      checkDescription(check({ kind: "direct_dependency", expected: { ecosystem: "npm", name: "vitest" } } as Partial<Check>)),
      checkDescription(check({ kind: "direct_dependency", expected: { ecosystem: "npm", name: "vitest", version: "^4" } } as Partial<Check>)),
      checkDescription(check({ kind: "structured_key", target: "tsconfig.json", expected: { path: ["compilerOptions", "strict"], value: true } } as Partial<Check>)),
    ];
    expect(new Set(descriptions.map((description) => description.key)).size).toBe(9);
    for (const description of descriptions) {
      for (const locale of LOCALES) {
        const sentence = t(locale, description.key, description.vars);
        expect(sentence, `${locale} ${description.key}`).not.toMatch(/\{[a-z]+\}/i);
        expect(sentence).not.toContain(literal);
        expect(sentence).not.toContain("a".repeat(13));
      }
    }
    /* A one-character literal closes with its figure. */
    const one = checkDescription(check({ kind: "text_present", expected: "x" } as Partial<Check>));
    for (const locale of LOCALES) {
      expect(t(locale, one.key, one.vars)).toMatch(/: 1$/);
      expect(t(locale, one.key, one.vars)).not.toMatch(GLUED);
    }
  });

  it("keeps the coordinates of a look and never the root of the disk nor the inspected paths", () => {
    const view = lookView(occurrence(), true);
    expect(view).toEqual({
      id: "mout_1",
      occurrenceId: "occ_1",
      kind: "observation",
      subject: { kind: "note", objectId: "note_1", rev: 3 },
      check: { checkId: CHECK_ID, checkRev: 2 },
      result: "fail",
      reason: { code: "hash_mismatch", observed: "3f9a1b2c" },
      observedAt: "2026-09-14T11:55:00.000Z",
      stale: true,
      head: "b".repeat(40),
      environmentId: ENVIRONMENT,
      coverage: { inspected: 2, unknown: 0 },
      deliveredBefore: "unknown",
      rows: 4,
      results: { pass: 1, fail: 3, unknown: 0 },
      verdict: null,
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(ROOT);
    expect(serialized).not.toContain("secret-name");
    expect(serialized).not.toContain("dirtyFingerprint");
  });

  it("draws each check with its newest look, says when the look is at an earlier revision, and a check nobody looked at is a gap", () => {
    const looks = [
      lookView(occurrence({ id: "old", observedAt: "2026-09-14T10:00:00.000Z", rev: 2, checkRev: 1, result: "pass", reason: "hash_match" }), true),
      lookView(occurrence({ id: "new", observedAt: "2026-09-14T11:55:00.000Z", rev: 3, checkRev: 2 }), false),
      lookView(occurrence({ id: "incident", kind: "incident", observedAt: "2026-09-14T11:59:00.000Z" }), false),
      lookView(occurrence({ id: "elsewhere", objectId: "note_9", observedAt: "2026-09-14T11:59:00.000Z", result: "pass" }), false),
    ];
    const [hash, absent, legacy] = checkStateViews({
      id: "note_1", revision: 3, checks: [check(), check({ checkId: OTHER_CHECK, kind: "path_exists", target: "src", expected: true } as Partial<Check>), check({ checkId: "legacy:0", revision: 1 })],
    }, looks);
    expect(hash!.look).toEqual({
      result: "fail", reason: { code: "hash_mismatch", observed: "3f9a1b2c" }, observedAt: "2026-09-14T11:55:00.000Z", stale: false,
      subjectRev: 3, currentItem: true, currentDefinition: true, coverage: { inspected: 2, unknown: 0 },
    });
    expect(checkStateKey(hash!)).toBe("memory.checkFail");
    expect(checkStateTone(hash!)).toBe("fail");
    expect(absent!.look).toBeNull();
    expect(checkStateKey(absent!)).toBe("memory.checkNotObserved");
    expect(checkStateTone(absent!)).toBe("quiet");
    expect(legacy!.legacy).toBe(true);
    /* The newest look wins even at an earlier revision, and the row says so. */
    const [earlier] = checkStateViews({ id: "note_1", revision: 4, checks: [check({ revision: 3 })] }, looks);
    expect(earlier!.look).toMatchObject({ result: "fail", currentItem: false, currentDefinition: false, subjectRev: 3 });
    for (const locale of LOCALES) {
      for (const key of ["memory.checkEarlierItem", "memory.checkEarlierDefinition", "memory.checkNotObserved", "memory.checkStale", ...Object.values(CHECK_RESULT_KEYS)] as const) {
        expect(t(locale, key), `${locale} ${key}`).not.toMatch(OBEDIENCE);
      }
      expect(t(locale, "memory.checkCoverage", { inspected: 1, unknown: 1 })).not.toMatch(GLUED);
    }
  });

  it("lists the four purposes of plan §9.1 in its order, each with a word in both dictionaries", () => {
    expect([...CHECK_PURPOSE_ORDER]).toEqual(["grounds", "applicability", "violation", "completion"]);
    for (const purpose of CHECK_PURPOSE_ORDER) {
      for (const locale of LOCALES) expect(t(locale, CHECK_PURPOSE_KEYS[purpose]), `${locale} ${purpose}`).not.toBe("");
    }
  });
});

describe("succession and expiry", () => {
  it("links every superseded note to its successor over the whole list, superseded rows included", () => {
    const successors = successorsOf([
      { id: "n1", supersedesId: null }, { id: "n2", supersedesId: "n1" }, { id: "n3", supersedesId: "n2" }, { id: "n4" },
    ]);
    expect([...successors.entries()]).toEqual([["n1", "n2"], ["n2", "n3"]]);
  });

  it("reaching the stored instant is expiring, the one reading of dates (plan §9.2)", () => {
    expect(expiredAt(new Date("2026-09-14T12:00:00.000Z"), NOW)).toBe(true);
    expect(expiredAt("2026-09-14T12:00:00.001Z", NOW)).toBe(false);
    expect(expiredAt(null, NOW)).toBe(false);
    expect(expiredAt(undefined, NOW)).toBe(false);
    expect(expiredAt("not a date", NOW)).toBe(false);
  });

  it("the expiry and succession lines exist in both languages", () => {
    for (const locale of LOCALES) {
      for (const key of ["memory.expiresOn", "memory.expiredOn"] as const) expect(t(locale, key, { date: "x" })).toMatch(/x$/);
      for (const key of ["memory.supersededBy", "memory.supersedes"] as const) expect(t(locale, key, { id: "n2" })).toMatch(/n2$/);
      expect(t(locale, "memory.supersededHint")).not.toMatch(OBEDIENCE);
    }
  });
});

describe("a decision in force", () => {
  it("carries its decision text, its worded predicates, its expiry and its checks with their looks", () => {
    const looks = [lookView(occurrence({ objectId: "dec_1", rev: 2, result: "pass", reason: "hash_match" }), false)];
    const view = decisionRowView(
      { id: "dec_1", memoryRev: 2, fields: { decision: { text: "  Restores go through ops/restore.mjs  " } }, validUntil: new Date("2026-12-31T23:59:59.999Z"), checks: [check()] },
      looks,
      { now: NOW, conditions: "the operation is deploy", exceptions: null },
    );
    expect(view).toMatchObject({
      id: "dec_1", revision: 2, decision: "Restores go through ops/restore.mjs", conditions: "the operation is deploy", exceptions: null,
      validUntil: "2026-12-31T23:59:59.999Z", expired: false,
    });
    expect(view.checks).toHaveLength(1);
    expect(view.checks[0]!.look).toMatchObject({ result: "pass", currentItem: true });
    /* An episode without a decision text says so instead of vanishing. */
    const bare = decisionRowView({ id: "dec_2", memoryRev: 1, fields: {}, validUntil: new Date("2026-01-01T00:00:00.000Z"), checks: [] }, looks, { now: NOW, conditions: null, exceptions: null });
    expect(bare.decision).toBeNull();
    expect(bare.expired).toBe(true);
    expect(bare.checks).toEqual([]);
  });
});

describe("a commitment for the card", () => {
  it("keeps the state and the observations apart: an open obligation with a failing criterion beside it (T49)", () => {
    const looks = [lookView(occurrence({ objectId: "cmt_1", rev: 3, checkRev: 2, result: "fail", reason: "absent", observedAt: "2026-09-14T11:58:00.000Z" }), false)];
    const view = commitmentRowView(commitment(), looks, { now: NOW, conditions: "the project is proj_1", continues: "cmt_0" });
    expect(view.state).toBe("open");
    expect(view.open).toBe(true);
    expect(view.revision).toBe(3);
    expect(view.criteria).toHaveLength(1);
    expect(view.criteria[0]!.look).toMatchObject({ result: "fail", currentItem: true, currentDefinition: true });
    expect(view.checks).toHaveLength(1);
    expect(view.checks[0]!.purpose).toBe("violation");
    expect(view.observations).toEqual({ total: 6, passed: 3, failed: 2, unknown: 1 });
    expect(view.incidents).toBe(1);
    expect(view.continues).toBe("cmt_0");
    expect(view.continuedBy).toBeNull();
    expect(view.conditions).toBe("the project is proj_1");
    expect(view.resolution).toBeNull();
    expect(view.createdAt).toBe("2026-09-13T10:00:00.000Z");
  });

  it("draws the newest row of each occurrence only, freshness by age at ten minutes, the same rule as the catalog", () => {
    expect(OBSERVATION_FRESH_MS).toBe(FRESHNESS_MS);
    const view = commitmentRowView(commitment(), [], { now: NOW, conditions: null });
    expect(view.recent).toHaveLength(COMMITMENT_OBSERVATIONS_SHOWN);
    /* occ_a has two rows; the older one (mout_b) is history, not a second line. */
    expect(view.recent.map((line) => line.id)).toEqual(["mout_a", "mout_c", "mout_d", "mout_e", "mout_f"]);
    expect(view.recent[0]).toEqual({ id: "mout_a", checkId: CHECK_ID, revision: 3, result: "fail", reason: { code: "absent", observed: null }, observedAt: "2026-09-14T11:58:00.000Z", stale: false });
    /* A row the patrol wrote no instant for is dated by its creation. */
    expect(view.recent[1]).toMatchObject({ id: "mout_c", observedAt: "2026-09-14T09:00:00.000Z", stale: true, result: "unknown" });
    expect(view.recent[2]!.stale).toBe(true);
    expect(view.recent.some((line) => line.id === "inc_1")).toBe(false);
    /* The counts still tally every row, the folded ones included. */
    expect(view.observations.total).toBe(6);
  });

  it("a closed commitment carries its resolution and offers no verb; the resolution outlives a later regression (C04/T50)", () => {
    const view = commitmentRowView(commitment({
      status: "fulfilled", memoryRev: 4, resolvedAt: new Date("2026-09-14T11:50:00.000Z"),
      resolution: { schemaVersion: 1, actor: "checks", revision: 3, checks: [{ checkId: CHECK_ID, revision: 2, observationId: "mout_b" }], environmentId: ENVIRONMENT },
    }), [], { now: NOW, conditions: null, continuedBy: "cmt_2" });
    expect(view.open).toBe(false);
    expect(view.resolution).toEqual({ actor: "checks", revision: 3, reason: null });
    expect(view.resolvedAt).toBe("2026-09-14T11:50:00.000Z");
    expect(view.continuedBy).toBe("cmt_2");
    /* The incident of the regression is counted beside the intact resolution. */
    expect(view.incidents).toBe(1);
    expect(JSON.stringify(view)).not.toContain("observationId");
  });

  it("every state word and the lines exist in both languages, close with the figure at n = 1, and never say obeyed", () => {
    for (const state of ["open", "fulfilled", "cancelled"] as const) {
      for (const locale of LOCALES) expect(t(locale, COMMITMENT_STATE_KEYS[state]), `${locale} ${state}`).not.toBe("");
    }
    for (const locale of LOCALES) {
      expect(t(locale, "memory.commitmentIncidents", { n: 1 })).toMatch(/: 1$/);
      expect(t(locale, "memory.commitmentObservations", { total: 1, passed: 1, failed: 1, unknown: 1 })).not.toMatch(GLUED);
      expect(t(locale, "memory.commitmentObservations", { total: 1, passed: 1, failed: 1, unknown: 1 })).toMatch(/1$/);
      for (const key of ["memory.commitmentsHint", "memory.commitmentNoCriteria", "memory.commitmentClosed", "memory.commitmentResolvedChecks"] as const) {
        expect(t(locale, key), `${locale} ${key}`).not.toMatch(OBEDIENCE);
      }
    }
  });
});

describe("the incidents and the owner's two words", () => {
  it("lists the incidents newest first and leaves the observations out", () => {
    const looks = [
      lookView(occurrence({ id: "obs", observedAt: "2026-09-14T11:59:00.000Z" }), false),
      lookView(occurrence({ id: "inc_old", kind: "incident", observedAt: "2026-09-14T09:00:00.000Z", verdict: "false_positive", verdictRev: 2 }), true),
      lookView(occurrence({ id: "inc_new", kind: "incident", observedAt: "2026-09-14T11:00:00.000Z", reason: "violation: present" }), false),
    ];
    const incidents = incidentViews(looks);
    expect(incidents.map((look) => look.id)).toEqual(["inc_new", "inc_old"]);
    expect(incidents[0]!.verdict).toEqual({ value: null, rev: 1 });
    expect(incidents[0]!.reason).toEqual({ code: "present", observed: null });
    expect(verdictWord(incidents[0]!)).toBe("none");
    expect(verdictWord(incidents[1]!)).toBe("false_positive");
    expect(incidents[1]!.verdict).toEqual({ value: "false_positive", rev: 2 });
  });

  it("the two verdict sentences are the plan's (§20.4), the tri-state of delivery is worded, and nothing says obeyed or ignored", () => {
    for (const locale of LOCALES) {
      expect(t(locale, "memory.falsePositive")).not.toBe("");
      expect(t(locale, "memory.outcomeConfirmed")).not.toBe("");
      for (const word of ["confirmed", "false_positive", "none"] as const) expect(t(locale, VERDICT_KEYS[word]), `${locale} ${word}`).not.toMatch(OBEDIENCE);
      for (const state of ["yes", "no", "unknown"] as const) {
        expect(t(locale, DELIVERED_BEFORE_KEYS[state]), `${locale} ${state}`).not.toBe("");
        expect(t(locale, DELIVERED_BEFORE_KEYS[state]), `${locale} ${state}`).not.toMatch(OBEDIENCE);
      }
      expect(t(locale, "memory.incidentsHint")).not.toMatch(OBEDIENCE);
      expect(t(locale, "memory.incidentRows", { n: 1 })).toMatch(/: 1$/);
      expect(t(locale, "memory.looksLimited", { n: 1 })).toMatch(/: 1$/);
    }
    expect(t("en", "memory.falsePositive")).toBe("Mark this occurrence as a false alarm.");
    expect(t("en", "memory.outcomeConfirmed")).toBe("Outcome verified for this case.");
  });
});

describe("the decision case as four columns", () => {
  it("recognises the door's projection by shape and refuses a refusal or a page", () => {
    expect(isMemoryCase(memoryCase())).toBe(true);
    expect(isMemoryCase({ code: "not_found", error: "No task of this project has that id." })).toBe(false);
    expect(isMemoryCase({ cases: [], nextCursor: null })).toBe(false);
    expect(isMemoryCase(null)).toBe(false);
    expect(isMemoryCase([])).toBe(false);
  });

  it("copies the four halves field by field, and a closing report stays declared while checked carries observations only (T51)", () => {
    const view = caseView(memoryCase());
    expect(view).toEqual({
      taskId: "task_1",
      asked: { text: "Add the restore script\n\nOnly after the copy is verified", createdAt: "2026-09-13T09:00:00.000Z" },
      decided: [{ episodeId: "dec_1", revision: 2, decision: "Restores go through ops/restore.mjs", when: "2026-09-12T09:00:00.000Z" }],
      declared: [{ sessionId: "ses_1", kind: "change", summary: "Wrote ops/restore.mjs" }, { sessionId: "ses_1", kind: "summary", summary: "Task closed" }],
      checked: [{ commitmentId: "cmt_1", status: "open", observations: [{ checkId: CHECK_ID, revision: 2, result: "fail", observedAt: "2026-09-14T11:58:00.000Z", looks: 1 }] }],
      unknown: { asked: false, decided: false, declared: false, checked: false, fields: [] },
    });
    expect(JSON.stringify(view)).not.toContain("project");
    // The folded looks travel as their count; a body without one is one look.
    const folded = memoryCase();
    folded.checked[0]!.observations[0]!.looks = 7;
    expect(caseView(folded).checked[0]!.observations[0]!.looks).toBe(7);
    const legacy = memoryCase();
    delete (legacy.checked[0]!.observations[0] as { looks?: number }).looks;
    expect(caseView(legacy).checked[0]!.observations[0]!.looks).toBe(1);
  });

  it("an unknown half stays unknown and never becomes an empty list, and field gaps travel by their dotted path", () => {
    const view = caseView(memoryCase({
      asked: null, decided: [{ episodeId: "dec_2", revision: 1, decision: null, when: null }], declared: [], checked: [],
      unknown: ["asked", "decided.dec_2.decision", "decided.dec_2.when", "declared", "checked"],
    }));
    expect(view.asked).toBeNull();
    expect(view.unknown).toEqual({ asked: true, decided: false, declared: true, checked: true, fields: ["decided.dec_2.decision", "decided.dec_2.when"] });
    expect(view.decided[0]).toEqual({ episodeId: "dec_2", revision: 1, decision: null, when: null });
    for (const locale of LOCALES) {
      expect(t(locale, "memory.caseUnknown")).not.toBe("");
      expect(t(locale, "memory.caseUnknownFields", { list: "a, b" })).toMatch(/a, b$/);
      expect(t(locale, "memory.caseCommitments", { n: 1 })).toMatch(/: 1$/);
      for (const key of ["memory.casesHint", "memory.caseDecidedNote", "memory.caseDeclaredNote", "memory.caseCheckedNote"] as const) {
        expect(t(locale, key), `${locale} ${key}`).not.toMatch(OBEDIENCE);
      }
    }
  });

  it("lists the tasks with how many of the commitments read name each, and null when they could not be read", () => {
    const tasks = [
      { id: "task_1", title: "Add the restore script", status: "open", createdAt: new Date("2026-09-13T09:00:00.000Z"), agentName: "claude" },
      { id: "task_2", title: "Old one", status: "done", createdAt: new Date("2026-09-01T09:00:00.000Z"), agentName: null },
    ];
    expect(caseListRows(tasks, new Map([["task_1", 2]]))).toEqual([
      { taskId: "task_1", title: "Add the restore script", status: "open", createdAt: "2026-09-13T09:00:00.000Z", agent: "claude", commitments: 2 },
      { taskId: "task_2", title: "Old one", status: "done", createdAt: "2026-09-01T09:00:00.000Z", agent: null, commitments: 0 },
    ]);
    expect(caseListRows(tasks, undefined).map((row) => row.commitments)).toEqual([null, null]);
  });
});

describe("the refusals of the C doors, in the reader's language", () => {
  it("maps invalid_check, stale_revision, not_found and not_retryable to keys that exist and differ between the languages", () => {
    for (const code of ["invalid_check", "stale_revision", "not_found", "not_retryable", "invalid_input", "local_catalog_required", "unavailable"]) {
      const key = memoryRefusalKey(code);
      expect(key, code).toBeDefined();
      expect(t("es", key!), code).not.toBe(t("en", key!));
      for (const locale of LOCALES) expect(t(locale, key!), `${locale} ${code}`).not.toMatch(/^[a-z_]+$/);
    }
    expect(memoryRefusalKey("stale_revision")).toBe("memory.staleRevision");
    expect(t("en", memoryRefusalKey("not_retryable")!)).toMatch(/closed/);
    expect(memoryRefusalKey("bogus")).toBeUndefined();
    expect(memoryRefusalKey(undefined)).toBeUndefined();
  });
});

// ── Delivery D: the criteria, the learning and the publication on the portrait ──────────────

/** A predicate as the door stores it, validated by core so the fixture cannot drift from the closed shape. */
const CONDITIONS = validatePredicate({ schemaVersion: 1, expression: { all: [{ kind: "path_under", path: "src/forms" }, { kind: "operation_is", operation: "edit" }] } });
const EXCEPTIONS = validatePredicate({ schemaVersion: 1, expression: { kind: "task_kind_is", taskKind: "release" } });

function supportEvidence(families: number): SupportEvidence {
  return {
    schemaVersion: 1,
    supportPolicyVersion: 2,
    families: Array.from({ length: families }, (_, index) => ({ originKey: `claude-code:s${index}:main`, kind: "case" as const, revisionIds: [`mrev_${index}`], at: AT })),
    counts: { families, observations: families, projects: 1, days: 1 },
    refs: Array.from({ length: families }, (_, index) => `obs_${index}`),
  };
}

function criterionRow(overrides: Partial<Parameters<typeof criterionRowView>[0]> = {}) {
  return { id: "bel_1", memoryRev: 4, conditions: CONDITIONS, exceptions: EXCEPTIONS, supportEvidence: supportEvidence(3), ...overrides };
}

function learnReport(overrides: Partial<TwinLearnReport> = {}): TwinLearnReport {
  return {
    scopes: [
      {
        projectId: "proj_alpha", slug: "alpha", identity: "git:abc", harness: "claude-code", grantId: "grant_000000000009", generation: 2, scope: "global",
        active: true, paused: false, pending: { bytes: 4096, streams: 1 }, lastInterval: { jobId: "mjob_1", sourceId: "msrc_1", end: 9000, at: AT },
      },
      {
        projectId: "proj_beta", slug: "beta", identity: "git:def", harness: "codex", grantId: "grant_000000000010", generation: 1, scope: "project",
        active: false, paused: true, pending: { bytes: 0, streams: 0 }, lastInterval: null,
      },
    ],
    jobs: { pending: 1, running: 0, staged: 2, deferred: 0, failed: 0, complete: 5, cancelled: 0, obsolete: 0 },
    pending: { bytes: 4096, streams: 1 },
    lastInterval: { jobId: "mjob_1", sourceId: "msrc_1", end: 9000, at: AT },
    spend: { automaticToday: 2, subquota: 6, cap: 40, paused: false },
    waiting: "unstable",
    lastPass: null,
    ...overrides,
  };
}

describe("a criterion's conditions, exceptions and independence (delivery D, §10.1, §10.2)", () => {
  it("renders the typed predicates with core's renderPredicate, so the screen and the agent read one sentence for one tree", () => {
    const view = criterionRowView(criterionRow(), renderPredicate);
    expect(view.revision).toBe(4);
    expect(view.appliesWhen).toBe(renderPredicate(CONDITIONS.expression));
    expect(view.appliesWhen).toBe("(the path is under src/forms and the operation is edit)");
    expect(view.exceptWhen).toBe("the task kind is release");
    /* The trees travel as stored, so a signature can restate exactly what was read. */
    expect(view.conditions).toEqual(CONDITIONS);
    expect(view.exceptions).toEqual(EXCEPTIONS);
    const bare = criterionRowView(criterionRow({ conditions: null, exceptions: null }), renderPredicate);
    expect(bare.appliesWhen).toBeNull();
    expect(bare.exceptWhen).toBeNull();
    expect(bare.conditions).toBeNull();
  });

  it("counts the independent families against the floor @panoma/db enforces, and an inherited row was never counted", () => {
    expect(SUPPORT_FAMILIES_FLOOR).toBe(DB_FAMILIES_FLOOR);
    expect(criterionRowView(criterionRow(), renderPredicate)).toMatchObject({ families: 3, meetsFloor: true });
    expect(criterionRowView(criterionRow({ supportEvidence: supportEvidence(2) }), renderPredicate)).toMatchObject({ families: 2, meetsFloor: false });
    expect(criterionRowView(criterionRow({ supportEvidence: null }), renderPredicate)).toMatchObject({ families: null, meetsFloor: false });
    const views = criterionRowViews([criterionRow(), criterionRow({ id: "bel_2", memoryRev: 1 })], renderPredicate);
    expect(Object.keys(views)).toEqual(["bel_1", "bel_2"]);
    expect(views["bel_2"]?.revision).toBe(1);
  });

  it("the families line closes with its figure at n = 1, the inherited row says so, and the sentences exist in both languages", () => {
    expect(familiesLine({ families: null })).toEqual({ key: "twin.familiesLegacy", vars: {} });
    expect(familiesLine({ families: 1 })).toEqual({ key: "twin.families", vars: { n: 1 } });
    for (const locale of LOCALES) {
      const one = t(locale, "twin.families", { n: 1 });
      expect(one).toMatch(/: 1$/);
      expect(one).not.toMatch(GLUED);
      expect(t(locale, "twin.familiesShort", { floor: SUPPORT_FAMILIES_FLOOR })).toMatch(/: 3$/);
      expect(t(locale, "twin.familiesLegacy")).not.toMatch(/\{/);
      expect(t(locale, "twin.appliesWhen", { sentence: "X" })).toMatch(/X$/);
      expect(t(locale, "twin.exceptWhen", { sentence: "X" })).toMatch(/X$/);
      expect(t(locale, "twin.signWhatYouSee")).not.toMatch(/\{/);
    }
    expect(t("es", "twin.appliesWhen", { sentence: "X" })).not.toBe(t("en", "twin.appliesWhen", { sentence: "X" }));
  });
});

describe("the kind of each quote, and the reaction that founds nothing (D01/T64)", () => {
  it("names the seven kinds in both dictionaries and agrees with @panoma/db about what an ambiguous reaction is", () => {
    expect(UNKNOWN_REFERENT).toBe(DB_UNKNOWN_REFERENT);
    for (const kind of Object.keys(OBSERVATION_KIND_KEYS) as (keyof typeof OBSERVATION_KIND_KEYS)[]) {
      for (const locale of LOCALES) expect(t(locale, OBSERVATION_KIND_KEYS[kind]), `${locale} ${kind}`).not.toMatch(/^twin\./);
    }
    const rows = [
      { kind: "reaction", referent: "unknown" },
      { kind: "reaction", referent: "the save button" },
      { kind: "choice", referent: "unknown" },
      { kind: null, referent: null },
    ] as const;
    for (const row of rows) expect(isAmbiguousReaction(row), JSON.stringify(row)).toBe(dbIsAmbiguousReaction(row));
    expect(isAmbiguousReaction({ kind: "reaction", referent: "unknown" })).toBe(true);
    for (const locale of LOCALES) {
      const sentence = t(locale, "twin.observationAmbiguous");
      expect(sentence).not.toMatch(/obey|obedec|ignor/i);
      expect(sentence).not.toMatch(/\{/);
    }
  });

  it("marks a belief's quotes by their verdict, flags the ambiguous reaction, and claims nothing about a quote whose observation was not read", () => {
    const observations = [
      { id: "obs_a", kind: "choice" as const, referent: "the form" },
      { id: "obs_b", kind: "reaction" as const, referent: "unknown" },
      { id: "obs_c", kind: null, referent: null },
    ];
    const marks = evidenceMarks(
      [
        { verdictId: "v1", observationId: "obs_a" },
        { verdictId: "v2", observationId: "obs_b" },
        { verdictId: "v3", observationId: "obs_c" },
        { verdictId: "v4", observationId: "obs_older" },
      ],
      observations,
    );
    expect(marks).toEqual({
      v1: { kind: "choice", ambiguous: false },
      v2: { kind: "reaction", ambiguous: true },
      v3: { kind: null, ambiguous: false },
    });
    expect(marks["v4"]).toBeUndefined();
  });

  it("lists the newest observations with their kind and the project's name, bounded, and never the identity", () => {
    const rows = [
      { id: "obs_1", statement: "Prefer direct actions in forms", topic: "frontend", identity: "git:abc", at: new Date(AT), kind: "choice" as const, referent: "the form" },
      { id: "obs_2", statement: "perfecto", topic: "other", identity: null, at: AT, kind: "reaction" as const, referent: "unknown" },
      { id: "obs_3", statement: "Never run the migration twice", topic: "backend", identity: "git:gone", at: AT, kind: null, referent: null },
    ];
    const views = observationRowViews(rows, { "git:abc": "Alpha" }, 2);
    expect(views).toHaveLength(2);
    expect(views[0]).toEqual({ id: "obs_1", statement: "Prefer direct actions in forms", topic: "frontend", kind: "choice", ambiguous: false, project: "Alpha", at: AT });
    expect(views[1]).toMatchObject({ id: "obs_2", kind: "reaction", ambiguous: true, project: null });
    expect(observationRowViews(rows, {}, 10)[2]).toMatchObject({ project: null, kind: null, ambiguous: false });
    expect(JSON.stringify(observationRowViews(rows, { "git:abc": "Alpha" }, 10))).not.toContain("git:");
  });
});

describe("the proposals grouped by the criterion they would touch (§10.5)", () => {
  it("puts two proposals about the same signed criteria in one group, keeps their order, and leaves a proposal about none alone", () => {
    const groups = proposalGroups([
      { id: "p1", supersedes: ["Keep forms direct", "Confirm deletions"] },
      { id: "p2", supersedes: ["Confirm deletions", "Keep forms direct"] },
      { id: "p3", supersedes: ["Never ship on Fridays"] },
      { id: "p4" },
      { id: "p5", supersedes: [] },
    ]);
    expect(groups.map((group) => group.proposals.map((one) => one.id))).toEqual([["p1", "p2"], ["p3"], ["p4"], ["p5"]]);
    expect(groups[0]?.criteria).toEqual(["Confirm deletions", "Keep forms direct"]);
    expect(groups[2]?.criteria).toEqual([]);
    expect(proposalGroups([])).toEqual([]);
    for (const locale of LOCALES) {
      expect(t(locale, "twin.proposalGroup", { n: 1 })).toMatch(/: 1$/);
      expect(t(locale, "twin.proposalEvidence", { n: 1 })).toMatch(/: 1$/);
    }
  });
});

describe("the continuous learning block (§10.5, §14.1)", () => {
  it("carries active or paused per source and project, the pending bytes, the last range and the spend as plain fields, with the source label", () => {
    const view = learningView(learnReport(), { "claude-code": "Claude Code" });
    expect(view).not.toBeNull();
    expect(view!.scopes).toEqual([
      { projectId: "proj_alpha", slug: "alpha", source: "claude-code", sourceLabel: "Claude Code", scope: "global", generation: 2, active: true, pending: { bytes: 4096, streams: 1 }, lastAt: AT },
      { projectId: "proj_beta", slug: "beta", source: "codex", sourceLabel: "codex", scope: "project", generation: 1, active: false, pending: { bytes: 0, streams: 0 }, lastAt: null },
    ]);
    expect(view!.jobs).toEqual([{ status: "pending", n: 1 }, { status: "staged", n: 2 }, { status: "complete", n: 5 }]);
    expect(view!.pending).toEqual({ bytes: 4096, streams: 1 });
    expect(view!.lastAt).toBe(AT);
    expect(view!.spend).toEqual({ automaticToday: 2, subquota: 6, cap: 40, paused: false });
    expect(view!.waiting).toBe("unstable");
    /* Nothing of the report that is not a count or a coordinate survives: no job id, no source id, no plan. */
    expect(JSON.stringify(view)).not.toMatch(/mjob_|msrc_|grant_|lastPass/);
    expect(learningView(undefined)).toBeNull();
    expect(learningView(null)).toBeNull();
  });

  it("says every reason of waiting in both languages, as a fact and never as a verdict on the model, and the lines close with the figure at n = 1", () => {
    const reasons: TwinWaitReason[] = ["paused", "budget", "provider", "no_grant", "unstable", "no_pending", "no_referent"];
    for (const reason of reasons) {
      expect(TWIN_WAIT_TONES[reason]).toBeDefined();
      for (const locale of LOCALES) {
        const sentence = t(locale, TWIN_WAIT_KEYS[reason]);
        expect(sentence, `${locale} ${reason}`).not.toMatch(/^twin\./);
        expect(sentence, `${locale} ${reason}`).not.toMatch(/obey|obedec|ignor|lease|staged/i);
      }
      expect(t("es", TWIN_WAIT_KEYS[reason])).not.toBe(t("en", TWIN_WAIT_KEYS[reason]));
    }
    for (const locale of LOCALES) {
      expect(t(locale, "twin.learnWorking")).not.toMatch(/\{/);
      expect(t(locale, "twin.learnPending", { size: "4 KB", streams: 1 })).toMatch(/: 1$/);
      expect(t(locale, "twin.learnJobLine", { status: t(locale, "memory.jobStatusPending"), n: 1 })).toMatch(/: 1$/);
      expect(t(locale, "twin.learnJobLine", { status: t(locale, "memory.jobStatusStaged"), n: 1 })).not.toMatch(/staged/i);
      expect(t(locale, "twin.learnRevoked", { n: 1 })).toMatch(/: 1$/);
      expect(t(locale, "twin.learnQuota", { daily: 1 })).toMatch(/: 1\.$/);
      expect(t(locale, "twin.learnSpend", { used: 1, subquota: 6, cap: 40 })).toMatch(/: 40$/);
      /* The block promises what the plan promises: no question per batch, no notice per observation. */
      expect(t(locale, "twin.learnLead")).not.toMatch(/\{/);
      expect(t(locale, "twin.learnPauseNote")).not.toMatch(/\{/);
    }
  });
});

describe("the publication of the file (§10.4)", () => {
  it("copies the generation, the status, the reason and the instant, and is null without a state", () => {
    const state: PublicationState = { revision: 3, status: "conflict", jobId: "mjob_9", pendingJobId: "mjob_9", reason: "file_changed" };
    expect(publicationView(state)).toEqual({ revision: 3, status: "conflict", reason: "file_changed", at: null });
    expect(publicationView({ revision: 2, status: "published", jobId: "mjob_8", at: AT })).toEqual({ revision: 2, status: "published", reason: null, at: AT });
    expect(publicationView({ revision: 1, status: "none" })).toEqual({ revision: 1, status: "none", reason: null, at: null });
    expect(publicationView(undefined)).toBeNull();
    expect(publicationView(null)).toBeNull();
  });

  it("names every status in both languages with a tone, and the conflict's reason is the plan's own sentence", () => {
    for (const status of ["none", "pending", "published", "conflict", "failed"] as const) {
      expect(PUBLICATION_STATUS_TONES[status]).toBeDefined();
      for (const locale of LOCALES) expect(t(locale, PUBLICATION_STATUS_KEYS[status]), `${locale} ${status}`).not.toMatch(/^twin\./);
      expect(t("es", PUBLICATION_STATUS_KEYS[status])).not.toBe(t("en", PUBLICATION_STATUS_KEYS[status]));
    }
    expect(jobReasonKey("file_changed")).toBe("memory.publicationConflict");
    for (const reason of ["call_failed", "bad_manifest", "input_changed", "classified", "synthesized", "unchanged", "taste_full", "write_mismatch", "block_broken", "not_managed", "revisions_moved", "permission_changed", "project_gone", "unreconciled", "published"]) {
      const key = jobReasonKey(reason);
      expect(key, reason).not.toBe("memory.jobReasonOther");
      for (const locale of LOCALES) expect(t(locale, key, { reason }), `${locale} ${reason}`).not.toMatch(/lease|staged|hash/i);
    }
    for (const processor of ["twin_distill", "twin_classify", "twin_synthesize", "taste_publish"]) {
      const key = jobProcessorKey(processor);
      expect(key, processor).toBeDefined();
      for (const locale of LOCALES) expect(t(locale, key!)).not.toMatch(/^memory\./);
    }
    for (const locale of LOCALES) {
      expect(t(locale, "twin.publicationConflictHint")).not.toMatch(/\{/);
      expect(t(locale, "twin.publicationPublished", { date: "today" })).toMatch(/today$/);
      expect(t(locale, "twin.publicationFailed", { reason: "x" })).toMatch(/x$/);
    }
  });

  it("translates the portrait door's refusals by code, leaves a full portrait to the door's own sentence, and knows no unknown code", () => {
    expect(tasteRefusalKey("stale_revision")).toBe("twin.saveStale");
    expect(tasteRefusalKey("publication_conflict")).toBe("memory.publicationConflict");
    expect(tasteRefusalKey("taste_full")).toBeUndefined();
    expect(tasteRefusalKey("bogus")).toBeUndefined();
    expect(tasteRefusalKey(undefined)).toBeUndefined();
    for (const code of ["stale_revision", "publication_conflict", "not_found", "invalid_input", "local_catalog_required", "unavailable"]) {
      const key = tasteRefusalKey(code);
      expect(key, code).toBeDefined();
      expect(t("es", key!), code).not.toBe(t("en", key!));
      for (const locale of LOCALES) expect(t(locale, key!), `${locale} ${code}`).not.toMatch(/^[a-z_]+$/);
    }
  });
});
