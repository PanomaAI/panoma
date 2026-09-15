import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, platform, arch, cpus } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, saveDecisionEpisodes, saveNarratives, listNarratives, type Database } from "@panoma/db";
import type { MemoryContractV2, MemoryOperation } from "@panoma/core";
import { prepareMemory, readMemoryItem } from "./memory-delivery";
import { BYTE_TOKENIZER, MemoryEvaluationBudget, evaluationCoverage, proportion } from "./memory-evaluation";

interface CorpusCase {
  id: string; split: string; sourceFamily: string; project: string; language: string; scenario: string; critical: boolean;
  objective: string; operation: MemoryOperation | null; budgetImpossible: boolean;
  fixture: { decision: string; exceptions: string | null };
  expected: { visible: boolean; applicability: string; decision: string | null; exceptions: string | null; answerRequirement: string };
}
const directory = new URL("./fixtures/memory-evaluation/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8")) as { sha256: Record<string, string> };
const corpus: CorpusCase[] = [];
for (const name of ["development.json", "evaluation.json"]) {
  const bytes = await readFile(new URL(name, directory));
  if (createHash("sha256").update(bytes).digest("hex") !== manifest.sha256[name]) throw new Error(`Frozen corpus changed: ${name}`);
  corpus.push(...JSON.parse(bytes.toString()) as CorpusCase[]);
}
let home: string;
let database: Database;
let close: () => Promise<void>;
const originalHome = process.env["PANOMA_HOME"];
const originalUrl = process.env["DATABASE_URL"];
const results: { id: string; split: string; scenario: string; language: string; critical: boolean; expectedVisible: boolean; initialRecall: boolean; finalRecall: boolean; falseApplication: boolean; available: boolean; conformity: boolean; budget: MemoryEvaluationBudget["totals"] }[] = [];
const projects = [...new Set(corpus.map((row) => row.project))].map((name) => ({ id: `eval-${name}`, slug: `eval-${name}`, name, identity: `git:eval-${name}`, root: join(tmpdir(), `panoma-eval-${name}`) }));

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-corpus-"));
  process.env["PANOMA_HOME"] = home;
  delete process.env["DATABASE_URL"];
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values(projects);
  /*
    One selection and one read before any case is timed. The task budget of a case measures the
    task — its pages, its full reads — and not the first load of the delivery modules or the
    query planner's cold start, which on a shared CI runner cost the first two cases their five
    seconds on 15-Sep-2026 while every case after them conformed. Nothing here enters a result.
   */
  const warm = projects[0]!;
  await prepareMemory({ database, project: warm, audience: "agent", channel: "mcp", profile: "mcp-memory-v2", agentId: null, context: null,
    requestKey: null, names: {}, consent: { sources: {} }, task: "warm-up", request: { version: 2, mode: "action" } });
  await readMemoryItem({ database, project: warm, audience: "agent", profile: "mcp-memory-v2", consent: { sources: {} },
    read: { kind: "decision", id: "dec_warm_up", revision: 1 }, names: {} });
});

afterAll(async () => {
  const reportPath = process.env["PANOMA_MEMORY_EVALUATION_REPORT"];
  if (reportPath) {
    const metrics = (rows: typeof results, expected: CorpusCase[]) => ({
      ...evaluationCoverage(expected, rows),
      initialRecall: proportion(rows.filter((row) => row.expectedVisible && row.initialRecall).length, expected.filter((row) => row.expected.visible).length),
      finalRecall: proportion(rows.filter((row) => row.expectedVisible && row.finalRecall).length, expected.filter((row) => row.expected.visible).length),
      requiredAbstentions: proportion(rows.filter((row) => !row.expectedVisible && row.available && !row.falseApplication).length, expected.filter((row) => !row.expected.visible).length),
      falseApplications: rows.filter((row) => row.falseApplication).length,
      contractConformity: proportion(rows.filter((row) => row.conformity).length, expected.length),
    });
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify({
      scope: "Synthetic retrieval and complete-unit preservation; not model-answer accuracy or a human pilot.",
      ...evaluationCoverage(corpus, results),
      tokenizer: BYTE_TOKENIZER.id, serialization: "JSON.stringify of the complete returned response, including repeated text and metadata",
      baseline: "not run", model: null, answersJudged: 0, corpus: manifest,
      machine: { platform: platform(), architecture: arch(), cpu: cpus()[0]?.model, node: process.version },
      development: metrics(results.filter((row) => row.split === "development"), corpus.filter((row) => row.split === "development")),
      evaluation: metrics(results.filter((row) => row.split === "evaluation"), corpus.filter((row) => row.split === "evaluation")),
      strata: Object.fromEntries([...new Set(corpus.map((row) => row.scenario))].map((name) => [name, metrics(results.filter((row) => row.scenario === name), corpus.filter((row) => row.scenario === name))])),
      criticalFailures: corpus.filter((row) => row.critical && !results.some((result) => result.id === row.id && result.conformity)).map((row) => row.id), results,
    }, null, 2) + "\n");
  }
  await close();
  if (originalHome === undefined) delete process.env["PANOMA_HOME"]; else process.env["PANOMA_HOME"] = originalHome;
  if (originalUrl === undefined) delete process.env["DATABASE_URL"]; else process.env["DATABASE_URL"] = originalUrl;
  await rm(home, { recursive: true, force: true });
});

describe("frozen memory corpus: expected answers never enter retrieval", () => {
  for (const fixture of corpus) it(fixture.id, async () => {
    await database.delete(schema.memoryDependencies);
    await database.delete(schema.memoryRevisions);
    await database.delete(schema.decisionEpisodes);
    const project = projects.find((row) => row.name === fixture.project)!;
    const foreign = projects.find((row) => row.id !== project.id)!;
    let narrativeId: string | undefined;
    if (fixture.scenario === "unconfirmed") {
      await database.delete(schema.narratives);
      await saveNarratives(database, [{ identity: project.identity, source: "codex", sessionId: fixture.id,
        at: new Date("2026-09-01T12:00:00Z"), kind: "opening", text: fixture.fixture.decision,
        context: "Synthetic imported conversation, not a confirmed decision.", truncated: false }]);
      narrativeId = (await listNarratives(database))[0]!.id;
    }
    const operation = { schemaVersion: 1, expression: { kind: "operation_is", operation: "edit" } };
    // Only source facts enter these writers. Oracle text/labels and expected visibility are withheld.
    const [decision] = await saveDecisionEpisodes(database, [{
      identity: fixture.scenario === "global" ? null : project.identity,
      origin: fixture.scenario === "unconfirmed" ? "history" : "owner", model: fixture.scenario === "unconfirmed" ? "fixture/offline" : null,
      fields: { decision: { text: fixture.fixture.decision, ...(narrativeId ? { narrativeId } : {}) }, ...(fixture.fixture.exceptions ? { exceptions: { text: fixture.fixture.exceptions } } : {}) },
      ...(fixture.scenario === "expired" ? { validUntil: new Date("2000-01-01T00:00:00Z") } : {}),
      ...(fixture.scenario.startsWith("condition_") ? { conditionsPredicate: operation } : {}),
      ...(fixture.scenario === "exception_blocks" ? { exceptionsPredicate: operation } : {}),
    }]);
    const [other] = await saveDecisionEpisodes(database, [{ identity: foreign.identity, origin: "owner", model: null, fields: { decision: { text: `Foreign instruction: ${fixture.fixture.decision}` } } }]);
    if (fixture.scenario === "archive") {
      await saveDecisionEpisodes(database, Array.from({ length: 270 }, (_, index) => ({ identity: project.identity, origin: "owner" as const, model: null, fields: { decision: { text: `Unrelated inventory record ${index}: retain the color swatches.` } } })));
    }
    const budget = new MemoryEvaluationBudget(BYTE_TOKENIZER);
    const contracts: MemoryContractV2[] = [];
    let continuation: string | undefined;
    do {
      const response = await prepareMemory({ database, project, audience: "agent", channel: "mcp", profile: "mcp-memory-v2",
        agentId: null, context: null, requestKey: null, names: Object.fromEntries(projects.map((row) => [row.identity, row.name])),
        consent: { sources: {} }, task: fixture.objective,
        request: { version: 2, mode: "action", ...(fixture.operation ? { operation: fixture.operation } : {}), ...(continuation ? { continuation } : {}) },
      });
      budget.record("recovery", JSON.stringify(response), "unavailable" in response);
      if (!("contract" in response)) break;
      contracts.push(response.contract);
      continuation = response.contract.continuation ?? undefined;
    } while (continuation && budget.canCall("recovery"));
    for (const ref of contracts.flatMap((contract) => contract.manifest)) {
      if (!budget.canCall("full_read")) break;
      const response = await readMemoryItem({ database, project, audience: "agent", profile: "mcp-memory-v2", consent: { sources: {} },
        read: { kind: ref.kind, id: ref.id, revision: ref.revision }, names: {} });
      budget.record("full_read", JSON.stringify(response), "code" in response);
      if (!("code" in response)) contracts.push(response);
    }
    const initial = contracts[0]?.items.find((row) => row.id === decision!.id);
    const item = contracts.flatMap((contract) => contract.items).find((row) => row.id === decision!.id);
    const falseApplication = (!fixture.expected.visible && !!item) || contracts.some((contract) => contract.items.some((row) => row.id === other!.id));
    const preserved = fixture.expected.visible
      ? !!item && item.text.includes(fixture.expected.decision!) && item.applicability === fixture.expected.applicability
        && (!fixture.expected.exceptions || JSON.stringify(item).includes(fixture.expected.exceptions))
      : !item;
    // An operational failure must not masquerade as a correct abstention on an excluded item.
    const available = contracts.length > 0 && budget.totals.failures === 0;
    const conformity = available && preserved && !falseApplication && budget.conforms;
    results.push({ id: fixture.id, split: fixture.split, scenario: fixture.scenario, language: fixture.language, critical: fixture.critical, expectedVisible: fixture.expected.visible,
      initialRecall: fixture.expected.visible ? !!initial : !initial, finalRecall: fixture.expected.visible ? !!item : !item,
      falseApplication, available, conformity, budget: budget.totals });
    expect(available, "Unavailability is not a correct abstention").toBe(true);
    expect(falseApplication, "A foreign, expired, unconfirmed or excepted decision must not apply").toBe(false);
    expect(preserved, "The expected complete constraint and applicability must survive delivery").toBe(true);
    expect(budget.conforms, "All pages, text repetitions and full reads share one task budget").toBe(true);
  });
});
