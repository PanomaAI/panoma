import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  checkReception,
  codePointLength,
  contractIdIn,
  finalMessage,
  packMemory,
  parseMemoryRequest,
  renderMemory,
  renderPredicate,
  renderUnit,
  sha256Hex,
  TRANSPORT_PROFILES,
  utf8Length,
  type MemoryCoverage,
  type MemoryItem,
} from "./memory-contract";

/*
  The contract is the one piece of the memory that two programs must agree on byte for byte:
  the server renders and hashes, and the receipt reader compares. These tests pin the three
  properties a receipt depends on — unit offsets are exact UTF-8 byte ranges, every unit hash
  covers exactly those bytes, and a unit that travels cut is not a unit that travelled — plus the
  packing rule the plan states in one sentence: a required unit is never dropped to make room
  for an optional one, and a core that does not fit makes the contract incomplete.
 */

const COVERAGE: MemoryCoverage = { searchComplete: true, requiredComplete: true, sourceReadable: true, limitsHit: [], candidateCount: 2 };

function note(id: string, text: string, extra: Partial<MemoryItem> = {}): MemoryItem {
  return {
    kind: "note", id, revision: 1, scope: "project", authority: "owner_confirmation", applicability: "applies",
    evidenceState: "unknown", deliveryMode: "core", text, ...extra,
  };
}

function render(items: MemoryItem[], profile: keyof typeof TRANSPORT_PROFILES = "hook-brief-v1") {
  return renderMemory({
    contractId: "srv_test", contentHash: "a".repeat(64), status: "ready", projectName: "panoma",
    items, checks: [], omissions: [], coverage: COVERAGE, manifest: [], profile,
  });
}

describe("canonical JSON and hashes", () => {
  it("sorts object keys, keeps array order, drops undefined and normalizes line breaks", () => {
    expect(canonicalJson({ b: [3, 1, { z: 1, a: undefined }], a: "x\r\ny" })).toBe('{"a":"x\\ny","b":[3,1,{"z":1}]}');
  });

  it("does not touch negations, numbers or inner spaces", () => {
    expect(canonicalJson({ t: "do not  publish 3 times" })).toBe('{"t":"do not  publish 3 times"}');
  });

  it("refuses what cannot travel", () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow();
  });

  it("counts bytes and code points apart", () => {
    expect(utf8Length("ü")).toBe(2);
    expect(codePointLength("😀a")).toBe(2);
    expect("😀a".length).toBe(3);
  });
});

describe("renderMemory", () => {
  it("gives every unit an exact UTF-8 byte range and a hash over those bytes", () => {
    const rendered = render([
      note("note_1", "Run `pnpm build` first\nSegunda línea con ñ and </untrusted_data> inside"),
      note("note_2", "Numbers go at the end 😀", { deliveryMode: "contextual", trigger: "apps/web/**" }),
    ]);
    const bytes = Buffer.from(rendered.text, "utf8");
    expect(rendered.units.units).toHaveLength(2);
    for (const unit of rendered.units.units) {
      const slice = bytes.subarray(unit.start, unit.end).toString("utf8");
      expect(sha256Hex(slice)).toBe(unit.unitHash);
      expect(slice.startsWith("- [")).toBe(true);
    }
    const [first, second] = rendered.units.units;
    expect(first!.end).toBeLessThanOrEqual(second!.start);
    // The fence cannot be closed from inside a unit: the delimiter is neutralized before hashing.
    expect(rendered.text).not.toContain("</untrusted_data> inside");
    expect(rendered.text).toContain("</untrusted-data> inside");
    expect(rendered.text.match(/<untrusted_data/g)).toHaveLength(1);
    expect(rendered.text.match(/<\/untrusted_data>/g)).toHaveLength(1);
  });

  it("opens and closes with the receipt marker carrying the contract id, never the rendered hash", () => {
    const rendered = render([note("note_1", "x")]);
    expect(rendered.text.startsWith("panoma-memory srv_test aaaaaaaaaaaaaaaa begin\n")).toBe(true);
    expect(rendered.text.endsWith("panoma-memory srv_test end")).toBe(true);
    expect(contractIdIn(rendered.text)).toBe("srv_test");
    expect(rendered.text).not.toContain(sha256Hex(rendered.text));
  });

  it("keeps a decision whole: conditions and exceptions travel with the decision", () => {
    const long = "when the copy is read by a person, ".repeat(12);
    const rendered = render([{
      kind: "decision", id: "dec_1", revision: 4, scope: "global", authority: "owner_instruction",
      applicability: "conditional", evidenceState: "unknown", deliveryMode: "contextual",
      text: "The number closes the sentence", conditions: long, exceptions: "except in the CLI",
      recordedAt: "2026-09-01", source: "/twin?episode=dec_1#episode-dec_1",
    }]);
    expect(rendered.text).toContain(`conditions: ${long.trim()}`);
    expect(rendered.text).toContain("exceptions: except in the CLI");
    expect(rendered.text).toContain("conditional: read the conditions and exceptions before applying");
  });

  it("measures the final message of the profile, wrapper and escaping included", () => {
    const rendered = render([note("note_1", 'a "quoted" line')]);
    const message = finalMessage("hook-brief-v1", rendered.text);
    expect(JSON.parse(message)).toEqual({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: rendered.text } });
    expect(rendered.serializedBytes).toBe(utf8Length(message));
    expect(rendered.serializedBytes).toBeGreaterThan(utf8Length(rendered.text));
    expect(finalMessage("mcp-memory-v2", rendered.text)).toBe(rendered.text);
  });

  it("says when nothing travelled instead of leaving an empty fence", () => {
    const rendered = render([]);
    expect(rendered.text).toContain("(no unit travelled)");
    expect(rendered.units.units).toHaveLength(0);
  });
});

describe("packMemory", () => {
  const pack = (items: MemoryItem[], profile: keyof typeof TRANSPORT_PROFILES) => packMemory({
    contractId: "srv_pack", contentHash: "b".repeat(64), status: "ready", projectName: "panoma",
    items, required: (item) => item.deliveryMode === "core", coverage: COVERAGE, omissions: [], checks: [], profile,
  });

  it("drops optional units from the end until the profile fits, and lists them in the manifest", () => {
    const items = [
      note("core_1", "core rule"),
      ...Array.from({ length: 20 }, (_, i) => note(`opt_${i}`, "x".repeat(200), { deliveryMode: "contextual" })),
    ];
    const packed = pack(items, "handoff-memory-v1");
    expect(packed.status).toBe("ready");
    expect(packed.items[0]!.id).toBe("core_1");
    expect(packed.items.length).toBeLessThan(items.length);
    expect(packed.manifest.length).toBe(items.length - packed.items.length);
    expect(packed.omissions).toEqual([{ reason: "channel_limit", count: packed.manifest.length, required: false }]);
    expect(packed.rendered.codePoints).toBeLessThanOrEqual(TRANSPORT_PROFILES["handoff-memory-v1"].maxCodePoints!);
    expect(packed.rendered.text).toContain("Additional units not included:");
  });

  it("A08/T17: a core that does not fit makes the contract incomplete with the reason incomplete_core", () => {
    const items = Array.from({ length: 6 }, (_, i) => note(`core_${i}`, "y".repeat(600)));
    const packed = pack(items, "handoff-memory-v1");
    expect(packed.status).toBe("incomplete");
    expect(packed.coverage.requiredComplete).toBe(false);
    expect(packed.coverage.limitsHit).toContain("channel_limit");
    const core = packed.omissions.find((omission) => omission.reason === "incomplete_core");
    expect(core?.required).toBe(true);
    expect(core!.count + packed.items.length).toBe(items.length);
    expect(packed.rendered.text).toContain("Required units missing:");
    expect(packed.rendered.text).toContain("Not delivered here, readable in full by id");
    expect(packed.rendered.codePoints).toBeLessThanOrEqual(TRANSPORT_PROFILES["handoff-memory-v1"].maxCodePoints!);
  });

  it("never drops a required unit to make room for an optional one", () => {
    const items = [
      note("opt_big", "z".repeat(3_000), { deliveryMode: "contextual" }),
      note("core_small", "small core"),
    ];
    const packed = pack(items, "handoff-memory-v1");
    expect(packed.items.map((item) => item.id)).toEqual(["core_small"]);
    expect(packed.status).toBe("ready");
  });

  it("keeps the legacy signal body under 16,000 UTF-16 units with thirty notes of five hundred", () => {
    const items = Array.from({ length: 30 }, (_, i) => note(`sig_${i}`, `${i}`.padEnd(500, i % 2 ? "é" : "x"), { trigger: "apps/web/**" }));
    const packed = pack(items, "hook-signal-v1");
    expect(packed.items).toHaveLength(30);
    expect(packed.rendered.bodyUnits).toBeLessThanOrEqual(16_000);
    // The legacy shape, byte for byte: a bullet and the body, no header per note.
    for (const item of items) expect(packed.rendered.text).toContain(`\n- ${item.text}\n`);
  });
});

describe("checkReception", () => {
  const offer = (() => {
    const rendered = render([note("note_1", "first rule"), note("note_2", "second rule")]);
    return { rendered: rendered.text, renderedHash: sha256Hex(rendered.text), units: rendered.units };
  })();

  it("is full for the exact bytes, whatever wraps them", () => {
    const wrapped = `<system-reminder>\nSessionStart hook additional context: ${offer.rendered}\n</system-reminder>`;
    expect(checkReception(offer, offer.rendered)).toMatchObject({ result: "full", exact: true });
    expect(checkReception(offer, wrapped)).toMatchObject({ result: "full", exact: false, unitsIntact: 2 });
  });

  it("A11/T12: both markers present but the middle altered is partial, never full", () => {
    const tampered = offer.rendered.replace("second rule", "second rules");
    expect(contractIdIn(tampered)).toBe("srv_test");
    expect(tampered.endsWith("panoma-memory srv_test end")).toBe(true);
    expect(checkReception(offer, tampered)).toMatchObject({ result: "partial", unitsIntact: 1, unitsTotal: 2 });
  });

  it("a prefix of a unit is not the unit", () => {
    const cut = offer.rendered.slice(0, offer.units.units[1]!.start + 20);
    expect(checkReception(offer, cut)).toMatchObject({ result: "partial", unitsIntact: 1 });
  });

  it("A12/T13: text with nothing of the offer is not observed; the offer's own marker with no unit intact is partial", () => {
    expect(checkReception(offer, "Some other message, and a stray panoma-memory srv_other bbbbbbbbbbbbbbbb begin marker")).toMatchObject({ result: "not_observed", unitsIntact: 0 });
    expect(checkReception(offer, "panoma-memory srv_test aaaaaaaaaaaaaaaa begin ... panoma-memory srv_test end")).toMatchObject({ result: "partial", unitsIntact: 0, unitsTotal: 2 });
  });

  it("an offer with no unit is full only with both markers carrying its contract id, partial on the opening one alone", () => {
    const rendered = render([]);
    const empty = { rendered: rendered.text, renderedHash: sha256Hex(rendered.text), units: rendered.units };
    expect(checkReception(empty, `<system-reminder>\n${rendered.text}\n</system-reminder>`)).toMatchObject({ result: "full", unitsIntact: 0, unitsTotal: 0, exact: false });
    expect(checkReception(empty, "panoma-memory srv_test aaaaaaaaaaaaaaaa begin\ncut before the end")).toMatchObject({ result: "partial", unitsTotal: 0 });
    // One marker of another contract, or the closing one alone, is not this message.
    expect(checkReception(empty, "panoma-memory srv_other aaaaaaaaaaaaaaaa begin\npanoma-memory srv_other end")).toMatchObject({ result: "not_observed" });
    expect(checkReception(empty, "panoma-memory srv_test end")).toMatchObject({ result: "not_observed" });
  });
});

describe("control characters never render", () => {
  it("removes C0 and C1 controls except LF and TAB from every unit and inline value before hashing, so no output filter can alter the bytes", () => {
    const rendered = render([
      note("note_1", "Put the number\u0085 at the end\x07, always.\nSecond\tline\x7f\x1b", { topic: "wri\u0089ting", scopeName: "Lemon\x08ade", trigger: "apps/\x00web/**" }),
    ]);
    // eslint-disable-next-line no-control-regex
    const controls = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;
    expect(rendered.text).not.toMatch(controls);
    expect(rendered.text).toContain("Put the number at the end, always.\n  Second\tline");
    expect(rendered.text).toContain("topic writing");
    expect(rendered.text).toContain("only in Lemonade");
    expect(rendered.text).toContain("where: apps/web/**");
    const unit = rendered.units.units[0]!;
    const slice = Buffer.from(rendered.text, "utf8").subarray(unit.start, unit.end).toString("utf8");
    expect(sha256Hex(slice)).toBe(unit.unitHash);
    // The signal shape too, and the header's project name and path.
    expect(renderMemory({
      contractId: "srv_test", contentHash: "a".repeat(64), status: "ready", projectName: "panoma", items: [note("note_1", "xy")],
      checks: [{ itemKind: "note", itemId: "note_1", revision: 1, kind: "narrative_condition", text: "when tested" }],
      omissions: [], coverage: COVERAGE, manifest: [], profile: "hook-signal-v1", path: "src/x.ts",
    }).text).not.toMatch(controls);
  });
});

describe("parseMemoryRequest", () => {
  it("rejects unknown properties, the wrong version and ambiguous unions", () => {
    expect(parseMemoryRequest({ version: 2, mode: "action", extra: 1 })).toMatchObject({ code: "invalid_input" });
    expect(parseMemoryRequest({ version: 1, mode: "action" })).toMatchObject({ code: "invalid_input" });
    expect(parseMemoryRequest({ version: 2, mode: "action", read: { kind: "note", id: "n", revision: 1 } })).toMatchObject({ code: "invalid_input" });
    expect(parseMemoryRequest({ version: 2, read: { kind: "note", id: "n", revision: 0 } })).toMatchObject({ code: "invalid_input" });
    expect(parseMemoryRequest({ version: 2, read: { kind: "note", id: "n/1", revision: 1 } })).toMatchObject({ code: "invalid_input" });
    expect(parseMemoryRequest([])).toMatchObject({ code: "invalid_input" });
  });

  it("returns typed requests and reads", () => {
    expect(parseMemoryRequest({ version: 2, mode: "orientation" })).toEqual({ version: 2, mode: "orientation" });
    expect(parseMemoryRequest({ version: 2, mode: "action", operation: "edit", contextId: "ctx_1", contextGeneration: 3, requestId: "r1" }))
      .toEqual({ version: 2, mode: "action", operation: "edit", contextId: "ctx_1", contextGeneration: 3, requestId: "r1" });
    expect(parseMemoryRequest({ version: 2, read: { kind: "decision", id: "dec_1", revision: 2, continuation: "mc_x" } }))
      .toEqual({ version: 2, read: { kind: "decision", id: "dec_1", revision: 2, continuation: "mc_x" } });
  });

  it("reads a commitment and a case by id since delivery C, and still refuses a kind it does not know", () => {
    expect(parseMemoryRequest({ version: 2, read: { kind: "commitment", id: "cmt_1", revision: 1 } }))
      .toEqual({ version: 2, read: { kind: "commitment", id: "cmt_1", revision: 1 } });
    expect(parseMemoryRequest({ version: 2, read: { kind: "case", id: "task_1", revision: 1 } }))
      .toEqual({ version: 2, read: { kind: "case", id: "task_1", revision: 1 } });
    expect(parseMemoryRequest({ version: 2, read: { kind: "prompt", id: "p", revision: 1 } }))
      .toEqual({ code: "invalid_input", error: "memory.read.kind must be note, criterion, decision, commitment or case." });
  });
});

describe("a criterion's typed conditions and exceptions (delivery D, plan §10.1, §10.4)", () => {
  const CHECK = "chk_contract_applicability_1";
  const criterion = (id: string, text: string, extra: Partial<MemoryItem> = {}): MemoryItem => ({
    kind: "criterion", id, revision: 3, scope: "global", authority: "owner_instruction", applicability: "applies",
    evidenceState: "unknown", deliveryMode: "contextual", text, topic: "forms", ...extra,
  });

  it("renderPredicate: a closed, deterministic English rendering — leaves as clauses, all/any joined, not prefixed, groups only when plural", () => {
    expect(renderPredicate({ kind: "project_is", projectId: "prj_1" })).toBe("the project is prj_1");
    expect(renderPredicate({ kind: "path_under", path: "apps/web" })).toBe("the path is under apps/web");
    expect(renderPredicate({ kind: "operation_is", operation: "deploy" })).toBe("the operation is deploy");
    expect(renderPredicate({ kind: "environment_is", environmentId: "c".repeat(64) })).toBe(`the environment is ${"c".repeat(12)}…`);
    expect(renderPredicate({ kind: "task_kind_is", taskKind: "release" })).toBe("the task kind is release");
    expect(renderPredicate({ kind: "check_result_is", checkId: CHECK, revision: 2, result: "fail" })).toBe(`check ${CHECK} r2 is fail`);
    expect(renderPredicate({ all: [{ kind: "check_result_is", checkId: CHECK, revision: 2, result: "fail" }] })).toBe(`check ${CHECK} r2 is fail`);
    expect(renderPredicate({ not: { any: [{ kind: "path_under", path: "apps/web" }, { kind: "task_kind_is", taskKind: "release" }] } }))
      .toBe("not (the path is under apps/web or the task kind is release)");
    const tree = { all: [{ kind: "operation_is" as const, operation: "edit" as const }, { not: { any: [{ kind: "path_under" as const, path: "apps/site" }, { kind: "operation_is" as const, operation: "deploy" as const }] } }] };
    expect(renderPredicate(tree)).toBe("(the operation is edit and not (the path is under apps/site or the operation is deploy))");
    // The same tree, the same bytes: the sentence is hashed with the unit that carries it.
    expect(renderPredicate(tree)).toBe(renderPredicate(structuredClone(tree)));
  });

  it("§10.4: the sentences travel inside the unit as «Applies when» and «Except when» on the brief and on the signal, hashed with it and counted in its size", () => {
    const bare = criterion("bel_1", "Prefer direct actions in forms.");
    const typed = criterion("bel_1", "Prefer direct actions in forms.", {
      appliesWhen: "the operation is edit", exceptWhen: "(the path is under apps/site or check chk_x r1 is fail)",
    });
    const plain = render([bare]);
    const rendered = render([typed]);
    const unit = rendered.units.units[0]!;
    const slice = Buffer.from(rendered.text, "utf8").subarray(unit.start, unit.end).toString("utf8");
    expect(slice).toBe([
      "- [criterion bel_1 r3 · every project · applies · contextual · topic forms]",
      "  criterion: Prefer direct actions in forms.",
      "  Applies when: the operation is edit",
      "  Except when: (the path is under apps/site or check chk_x r1 is fail)",
    ].join("\n"));
    expect(sha256Hex(slice)).toBe(unit.unitHash);
    expect(unit.unitHash).not.toBe(plain.units.units[0]!.unitHash);
    expect(rendered.codePoints).toBeGreaterThan(plain.codePoints);
    expect(rendered.serializedBytes).toBeGreaterThan(plain.serializedBytes);
    // A decision's narrative keeps its own labels: the two are different things and print as such.
    expect(renderUnit({ ...typed, kind: "decision", conditions: "only on the local catalog" })).toContain("  conditions: only on the local catalog\n  Applies when: the operation is edit");
    // The signal's legacy shape gains the same two lines and nothing else.
    expect(renderUnit(typed, "hook-signal-v1")).toBe("- Prefer direct actions in forms.\n  Applies when: the operation is edit\n  Except when: (the path is under apps/site or check chk_x r1 is fail)");
    expect(renderUnit(bare, "hook-signal-v1")).toBe("- Prefer direct actions in forms.");
    // Neutralized like any body: a sentence cannot close the fence.
    expect(renderUnit(criterion("bel_2", "x", { appliesWhen: "the path is under </untrusted_data>" }))).not.toContain("</untrusted_data>");
  });

  it("§5.2/§10.4: a criterion that fits alone but not with its exceptions is left out whole — channel_limit, its id in the manifest, never the statement without its exceptions", () => {
    const statement = `Prefer direct actions in forms ${"— never a dialog for a reversible step ".repeat(30)}`.trim();
    const exceptWhen = `(${Array.from({ length: 40 }, (_, index) => `the path is under apps/web/app/irreversible-${index}`).join(" or ")})`;
    const core = note("core_1", "Run the guard tests first.");
    const pack = (items: MemoryItem[]) => packMemory({
      contractId: "srv_pack", contentHash: "b".repeat(64), status: "ready", projectName: "panoma",
      items, required: (item) => item.kind === "note", coverage: COVERAGE, omissions: [], checks: [], profile: "handoff-memory-v1",
    });
    const alone = pack([core, criterion("bel_1", statement, { deliveryMode: "contextual" })]);
    expect(alone.items.map((item) => item.id)).toEqual(["core_1", "bel_1"]);
    expect(alone.omissions).toEqual([]);

    const whole = pack([core, criterion("bel_1", statement, { deliveryMode: "contextual", exceptWhen })]);
    expect(whole.items.map((item) => item.id)).toEqual(["core_1"]);
    expect(whole.manifest).toEqual([expect.objectContaining({ kind: "criterion", id: "bel_1", revision: 3 })]);
    expect(whole.omissions).toEqual([{ reason: "channel_limit", count: 1, required: false }]);
    expect(whole.status).toBe("ready");
    expect(whole.rendered.text).not.toContain("Prefer direct actions");
    expect(whole.rendered.text).not.toContain("Except when");
    expect(whole.rendered.text).toContain("- criterion bel_1 r3 · global");
    expect(whole.rendered.codePoints).toBeLessThanOrEqual(TRANSPORT_PROFILES["handoff-memory-v1"].maxCodePoints!);
    // A core criterion in the same case is a missing required unit, not a criterion served without its exceptions.
    const required = packMemory({
      contractId: "srv_pack", contentHash: "b".repeat(64), status: "ready", projectName: "panoma",
      items: [criterion("bel_1", statement, { deliveryMode: "core", exceptWhen })], required: () => true, coverage: COVERAGE, omissions: [], checks: [], profile: "handoff-memory-v1",
    });
    expect(required.status).toBe("incomplete");
    expect(required.items).toEqual([]);
    expect(required.omissions).toEqual([{ reason: "incomplete_core", count: 1, required: true }]);
  });
});

describe("renderUnit for the delivery-C kinds", () => {
  it("labels a commitment and a case by their own word, and names the note a successor replaced", () => {
    const text = render([
      note("n_2", "Use the new form.", { supersedesId: "n_1" }),
      { ...note("cmt_1", "Ship the migration before Friday."), kind: "commitment", authority: "owner_instruction" },
      { ...note("task_1", "asked: fix the login"), kind: "case", authority: "owner_report" },
    ]).text;
    expect(text).toContain("- [note n_2 r1 · this project · applies · core · supersedes n_1]");
    expect(text).toContain("  rule: Use the new form.");
    expect(text).toContain("  commitment: Ship the migration before Friday.");
    expect(text).toContain("  case: asked: fix the login");
  });
});
