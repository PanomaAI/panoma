import { complete } from "@panoma/ai";
import { redactSecrets, wrapUntrusted } from "@panoma/core";
import {
  CONSULT_MAX,
  CONSULT_PENDING_MAX,
  draftConsultation,
  draftingConsultation,
  listBeliefs,
  listDecisionEpisodes,
  narrativesByIds,
  modelSpendToday,
  pendingConsultations,
  saveModelCall,
  publishableByPolicy,
  staleDrafting,
  type Database,
} from "@panoma/db";
// Lexical ranking is deterministic and free; the model still decides whether evidence applies.
import { terms } from "./lexical";
import { capFor } from "./spend-settings";
import { memoryFence } from "./memory-availability";
import { fileStatement } from "./publishable";

/*
  The substitute writer: the double writes what HE WOULD HAVE answered, and no one reads it yet
  except the person.
  The entire contract of the shadow mode lives here. The question is already recorded and the
  agent has already received their "question to the owner"; this runs in the background, and
  leaves the draft waiting for the tag. Three rules that are non-negotiable:
  1. **Only from beliefs.** The twin does not give opinions: it answers if the Twin's beliefs
  cover the question, quoting them, or abstains. The quote uses batch tags
  (`b1`, `b2` …) for the same reason that the synthesis uses `c1`: a label that is not in the
  A map cannot be convincingly falsified, and the back translation is done by this module, which
  is the one that has the map. An answer whose citations do not resolve is downgraded to
  abstention — an uncited answer does not exist in this house.
  2. **Abstention is the most common honest answer.** Twenty-five beliefs cover little, and that
  is exactly what the shadow measures (coverage). A double that stretches its beliefs to answer
  more is a double that fidelity will kill afterward.
  3. **The expense is recorded before understanding the answer** — the critic's and the
  distiller's rule, for the same reason as always.
 */

/** The expense book class. `ask` because it is what the agent did. */
export const ASK_KIND = "ask";

/**
 * The owner's rehearsal pays from its own ledger — the `rehearse` family in `spend-settings.ts`,
 * `PANOMA_REHEARSE_BUDGET` or the Spend screen — and not from the agents'. Sharing one cap was
 * measured on the first day: twenty rehearsals in the morning left every `panoma_ask` of the day
 * stranded in `drafting`, and the double's exam — the gate before it may ever answer an agent — got
 * no data that day. Two organs that never call each other must not compete for one number; the
 * same reason the critic's cap sits apart from the reads'.
 */
export const REHEARSE_KIND = "rehearse";

/**
 * Room for one to three cited sentences. An answer that hits it is retried once with twice the
 * room (`runRehearsal`); one that cannot close in twice the room is answering something else.
 */
const MAX_ANSWER_TOKENS = 400;

/** A belief with its batch label, ready for the prompt and to resolve appointments. */
export interface LabelledBelief {
  label: string;
  id: string;
  state: string;
  statement: string;
  topic?: string;
  scope?: string;
  kind?: "episode";
}

/**
 * The order. Exported to try it without paying.
 *
 * Instructions use English; the answer follows the language of the question, because the one who
 * reads it is the one who asked. Source evidence remains in its original language and is wrapped
 * as untrusted material even when the owner entered it directly.
 */
export function buildAskPrompt(
  question: string,
  beliefs: LabelledBelief[],
): { system: string; prompt: string } {
  const system = [
    "Represent the catalog owner's decision criteria using only the labelled evidence below.",
    "A question about their work needs a grounded answer, not a generic recommendation.",
    "",
    "Rules:",
    "- Answer only when the evidence actually covers the question. Do not stretch it to manufacture coverage.",
    "- Answer in the language the question is written in, using one to three sentences, and cite the labels you use. Keep quoted source evidence verbatim.",
    "- Signed beliefs are owner-confirmed criteria and take priority over inferred beliefs.",
    "- Evidence marked project applies only to the selected project.",
    "- Decision episodes describe particular situations, not permanent rules. Compare their goals, constraints and conditions with the question.",
    "- An episode without a project is general context, not a universally applicable preference.",
    "- Keep exceptions and alternatives visible. Never invent missing reasons or outcomes. An owner-reported result is not independent verification.",
    "- If applicable evidence conflicts, or a missing condition could change the choice, abstain.",
    '- Return JSON {"answer":"...","cites":["b2"]} or {"abstain":true}. Nothing else.',
  ].join("\n");

  const material = beliefs
    .map(beliefLine)
    .join("\n");

  /*
    The warning about foreign material goes with the LAST block, covering both of them: in the
    first version it went with the question and the bigger block —beliefs— remained behind without
    a note, against the multi-block convention of the untrusted module itself.
   */
  const prompt = [
    "Question:",
    wrapUntrusted(redactSecrets(question), { origin: "journal", limit: 600, includeNote: false }),
    "",
    "Owner evidence:",
    wrapUntrusted(material, { origin: "notes", limit: ASK_MATERIAL_LIMIT + 500 }),
  ].join("\n");

  return { system, prompt };
}

/**
 * What belief material can occupy in the prompt, and the half that matters: beliefs are cut to the
 * list that fits BEFORE labeling. The audit found the hole in another way of doing it:
 * `wrapUntrusted` silently truncated to so many characters, but the citation map was built with
 * the entire list — a hallucinated citation of a belief the model never saw solved the same way,
 * and the answer went through as supported. Label that didn’t travel, label that doesn’t exist.
 */
export const ASK_MATERIAL_LIMIT = 5_500;

function beliefLine(belief: LabelledBelief): string {
  return `- [${belief.label}] (${belief.state})${belief.scope ? ` [${belief.scope}]` : ""} ${belief.statement}`;
}

/** Keep whole beliefs inside the envelope, then label only what will actually travel. */
export function fitBeliefs(beliefs: LabelledBelief[], limit = ASK_MATERIAL_LIMIT): LabelledBelief[] {
  const fitted: LabelledBelief[] = [];
  let used = 0;
  for (const belief of beliefs) {
    const labelled = { ...belief, label: `b${fitted.length + 1}` };
    const line = `${beliefLine(labelled)}\n`.length;
    if (used + line > limit) continue;
    used += line;
    fitted.push(labelled);
  }
  return fitted;
}

/**
 * Read the draft. `abstain` also collects the illegible and the quotes that are unresolved: for
 * the shadow, 'could not answer with the available evidence' is a single category, and it is
 * measured by coverage.
 */
export function parseAsk(
  text: string,
  beliefs: LabelledBelief[],
): { answer: string; beliefIds: string[] } | "abstain" {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end <= start) return "abstain";

  let parsed: unknown;
  try {
    parsed = JSON.parse(clean.slice(start, end + 1));
  } catch {
    return "abstain";
  }
  if (parsed === null || typeof parsed !== "object") return "abstain";

  const draft = parsed as { answer?: unknown; cites?: unknown; abstain?: unknown };
  if (draft.abstain === true) return "abstain";
  if (typeof draft.answer !== "string" || draft.answer.trim() === "" || draft.answer.length > 2000) return "abstain";

  const byLabel = new Map(beliefs.map((b) => [b.label, b.id]));
  const cites = Array.isArray(draft.cites) ? draft.cites : [];
  // A valid citation beside an invented one does not make the invented backing acceptable.
  if (cites.some((cite) => typeof cite !== "string" || !byLabel.has(cite))) return "abstain";
  const beliefIds = (cites as string[]).map((label) => byLabel.get(label)!);

  if (beliefIds.length === 0) return "abstain";
  return { answer: redactSecrets(draft.answer.trim()), beliefIds: [...new Set(beliefIds)] };
}

/**
 * The beliefs that apply to this project: the global ones and those limited to its identity, alive
 * (signed or sustained). Labeled in a stable order so that the same batch produces the same map.
 */
export async function beliefsFor(database: Database, identity: string | null): Promise<LabelledBelief[]> {
  const rows = await listBeliefs(database, { states: ["signed", "inferred"] });
  return rows
    .filter((b) => b.scopeKind !== "unresolved")
    .filter((b) => b.identity === null || b.identity === identity)
    .filter((b) => b.state === "signed" || publishableByPolicy(b.support, b.supportEvidence))
    .map((b, index) => ({
      label: `b${index + 1}`,
      id: b.id,
      state: b.state,
      statement: redactSecrets(fileStatement(b)),
      topic: b.topic,
      ...(b.identity === null ? {} : { scope: "project" }),
    }));
}

export function selectAskBeliefs(question: string, beliefs: LabelledBelief[]): LabelledBelief[] {
  const query = terms(question);
  const documents = beliefs.map((belief) => terms(`${belief.topic ?? ""} ${belief.statement}`));
  const frequency = new Map<string, number>();
  for (const document of documents) {
    for (const term of document) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  }
  return fitBeliefs(beliefs.map((belief, index) => {
    let relevance = 0;
    for (const term of query) {
      if (documents[index]!.has(term)) relevance += 1 + Math.log(1 + beliefs.length / frequency.get(term)!);
    }
    return { belief, relevance, index };
  }).sort((a, b) =>
    b.relevance - a.relevance ||
    Number(b.belief.state === "signed") - Number(a.belief.state === "signed") ||
    Number(b.belief.scope === "project") - Number(a.belief.scope === "project") ||
    a.index - b.index,
  ).map(({ belief }) => belief));
}

export interface RehearsalReceipt {
  status: "preview" | "drafted" | "abstained";
  answer?: string;
  evidence: { id: string; statement: string; state: string; topic: string; scope?: string; kind?: "episode" }[];
  omittedBeliefs: number;
  reason?: "no-beliefs" | "no-match" | "unsupported";
  remainingCalls: number;
}

export class AskBudgetError extends Error {
  constructor() {
    super("The daily decision budget is exhausted.");
    this.name = "AskBudgetError";
  }
}

/** The question limit applies before redaction; secrets never reach ranking or a model. */
export function consultationQuestion(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const question = value.trim();
  if (question.length === 0 || question.length > CONSULT_MAX) return undefined;
  return redactSecrets(question);
}

// Separate from the catalog write queue: a model call must never delay an ingest. Keeping the
// queue on globalThis also makes it survive Next hot reload, like the database connection.
const askRuntime = globalThis as unknown as { panomaAskQueues?: WeakMap<Database, Promise<void>> };

function queueAsk<T>(database: Database, work: () => Promise<T>): Promise<T> {
  const queues = askRuntime.panomaAskQueues ??= new WeakMap();
  const turn = (queues.get(database) ?? Promise.resolve()).then(work);
  queues.set(database, turn.then(() => undefined, () => undefined));
  return turn;
}

interface RehearsalInput {
  question: string;
  identity: string | null;
  dryRun?: boolean;
  includeEpisodes?: boolean;
  /** Which ledger pays. The owner's rehearsal has its own; the agent's shadow draft keeps `ask`. */
  ledger?: "ask" | "rehearse";
}

/** The owner can inspect the selected evidence without spending or changing the portrait. */
export async function rehearse(
  database: Database,
  input: Omit<RehearsalInput, "ledger">,
): Promise<RehearsalReceipt> {
  const owned = { ...input, ledger: "rehearse" as const };
  if (input.dryRun === true) return runRehearsal(database, owned);
  // The same queue as the shadow: two paid calls never race the same daily slot, on either ledger.
  return queueAsk(database, () => runRehearsal(database, owned));
}

async function runRehearsal(database: Database, input: RehearsalInput): Promise<RehearsalReceipt> {
  const memoryCurrent = await memoryFence(database);
  const question = consultationQuestion(input.question);
  if (question === undefined) throw new Error("Invalid consultation question.");
  const eligible = await beliefsFor(database, input.identity);
  // Rich episodes are available in the owner's lab. Agent shadow drafts keep their existing
  // belief-only citation contract, so no episode is silently promoted into the agent protocol.
  if (input.includeEpisodes) eligible.push(...await episodeEvidenceFor(database, input.identity, question));
  const beliefs = selectAskBeliefs(question, eligible);
  const kind = input.ledger === "rehearse" ? REHEARSE_KIND : ASK_KIND;
  const { cap } = await capFor(kind === REHEARSE_KIND ? "rehearse" : "ask");
  const spent = await modelSpendToday(database, kind);
  const remainingCalls = Math.max(cap - spent.calls, 0);
  const receipt = {
    evidence: beliefs.map(({ id, statement, state, topic, scope, kind }) => ({
      id, statement, state, topic: topic ?? "other", ...(scope ? { scope } : {}), ...(kind ? { kind } : {}),
    })),
    omittedBeliefs: eligible.length - beliefs.length,
    remainingCalls,
  };
  if (beliefs.length === 0) return { ...receipt, status: "abstained", reason: "no-beliefs" };
  if (input.dryRun === true) {
    return { ...receipt, status: "preview" };
  }
  if (remainingCalls === 0) throw new AskBudgetError();

  const built = buildAskPrompt(question, beliefs);
  // The spend is written before the answer is understood: the rule of every organ that pays.
  const paid = async (answer: Awaited<ReturnType<typeof complete>>) => saveModelCall(database, {
    kind,
    provider: answer.provider,
    model: answer.model,
    identity: input.identity,
    ...(answer.usage ? { input: answer.usage.input, output: answer.usage.output } : {}),
  });
  await memoryCurrent();
  let answer = await complete({ ...built, maxTokens: MAX_ANSWER_TOKENS });
  await paid(answer);
  await memoryCurrent();
  let parsed = parseAsk(answer.text, beliefs);
  let calls = 1;
  /*
    An answer cut at `maxTokens` is not an abstention: the model was still writing when the room
    ran out, and the cut JSON reads as "unusable" below. Filed as it was, that paid call counted in
    the exam as "the owner's taste does not cover this", which is a claim about the person made by
    a limit on the request. So it is retried once, with twice the room, inside the same queue turn
    and against the same cap — a second row in the ledger, and only if a call still fits today. Once
    and no more: a model that cannot close in twice the room is answering something else.
   */
  if (parsed === "abstain" && answer.stopReason === "length" && remainingCalls > calls) {
    await memoryCurrent();
    answer = await complete({ ...built, maxTokens: MAX_ANSWER_TOKENS * 2 });
    await paid(answer);
    await memoryCurrent();
    parsed = parseAsk(answer.text, beliefs);
    calls += 1;
  }
  if (parsed === "abstain") {
    // Only an explicit, well-formed abstention says there was no match. Bad JSON or invented
    // evidence is a different limitation and must not be presented as a gap in the owner's taste.
    const noMatch = explicitAbstention(answer.text);
    return { ...receipt, status: "abstained", evidence: [], reason: noMatch ? "no-match" : "unsupported", remainingCalls: remainingCalls - calls };
  }
  const cited = new Set(parsed.beliefIds);
  return {
    ...receipt,
    status: "drafted",
    answer: parsed.answer,
    evidence: receipt.evidence.filter((belief) => cited.has(belief.id)),
    remainingCalls: remainingCalls - calls,
  };
}

/**
 * Select relevant cases without sending unrelated project history or inventing confidence.
 *
 * A decision the owner gave an end to stops being evidence the day it ends, here as well as in the
 * agents' briefing: the Lab rehearses what applies now, and the owner's archive is where a decision
 * that has run out is still read. Both scopes are asked at one instant, before the candidate caps.
 */
export async function episodeEvidenceFor(database: Database, identity: string | null, question: string): Promise<LabelledBelief[]> {
  const now = new Date();
  const rows = (await Promise.all([
    listDecisionEpisodes(database, { identity: null, status: "active", unambiguousOnly: true, activeAt: now, limit: 250 }),
    ...(identity === null ? [] : [listDecisionEpisodes(database, { identity, status: "active", unambiguousOnly: true, activeAt: now, limit: 250 })]),
  ])).flat();
  const query = terms(question);
  const relevant = rows.filter((row) => {
    const vocabulary = terms(Object.values(row.fields).map((field) => field!.text).join(" "));
    return [...query].some((term) => vocabulary.has(term));
  });
  const sources = new Map((await narrativesByIds(database, relevant.flatMap((row) => Object.values(row.fields)
    .flatMap((field) => field?.narrativeId ? [field.narrativeId] : [])))).map((row) => [row.id, row]));
  return relevant.map((row) => {
    const text = Object.entries(row.fields).map(([key, value]) => {
      const label = key === "rationale" ? "Reasoning" : key === "conditions" ? "When it applies" : key.charAt(0).toUpperCase() + key.slice(1);
      return `${label}: ${value!.text}`;
    }).join("\n");
    const dates = [...new Set(Object.values(row.fields).flatMap((field) => {
      const source = field?.narrativeId ? sources.get(field.narrativeId) : undefined;
      return source ? [source.at.toISOString().slice(0, 10)] : [];
    }))].sort();
    const when = dates.length ? `Source dates: ${dates.join(", ")}` : `Recorded: ${row.createdAt.toISOString().slice(0, 10)}`;
    return { label: "", id: row.id, kind: "episode" as const,
      state: row.origin === "owner" ? "owner-recorded episode" : "history-extracted episode",
      statement: redactSecrets(`${when}\n${text}`),
      topic: "decision", ...(row.identity ? { scope: "project" } : {}),
    };
  });
}

function explicitAbstention(text: string): boolean {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return false;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof parsed === "object" && parsed !== null && "abstain" in parsed && parsed.abstain === true;
  } catch {
    return false;
  }
}

/**
 * The full shift of the editor, in essence: free brakes, beliefs, call, draft. He never throws
 * upward — the falling shadow loses a draft, not a question: the row remains in `drafting` and is
 * seen in the record as what it is, unedited.
 */
export async function shadowDraft(
  database: Database,
  input: { consultationId: string; identity: string | null },
  _question: string,
): Promise<void> {
  await queueAsk(database, async () => {
    // Recheck inside the spending queue: two stale sweepers may have selected this same row.
    // Reading the stored question also keeps the redaction at record time on every retry path.
    const pending = await draftingConsultation(database, input.consultationId);
    if (pending === undefined) return;
    let receipt: RehearsalReceipt;
    try {
      receipt = await runRehearsal(database, { question: pending.question, identity: input.identity });
    } catch (error) {
      if (error instanceof AskBudgetError) return;
      throw error;
    }
    await draftConsultation(database, input.consultationId,
      receipt.status === "drafted" && receipt.answer !== undefined
        ? { answer: receipt.answer, beliefIds: receipt.evidence.map((belief) => belief.id) }
        : { abstained: true },
    );
  });
}

/**
 * Picks up a project's stranded drafts and retries them.
 *
 * “Tomorrow there is a budget” is only true if someone comes back tomorrow, and the audit found
 * that no one was coming back: the editor would shoot himself once per question and a stranded row
 * — fallen, or without budget that day — would stay in `drafting` forever. This is the one that
 * comes back: it boards the next `panoma_ask` of the project, by the same path and with the same
 * brakes, and the CAS of `draftConsultation` (only on `drafting` ) harmlessly prevents two runs
 * from crossing. In series on purpose: if the budget runs out halfway, the rest stays stranded and
 * will be picked up another day, which is exactly the contract.
 *
 * Two bounds keep it from paying for drafts nobody will ever label. `staleDrafting` reaches back
 * `STALE_MAX_DAYS` and no further — the exam's own window — and the sweep stops while the
 * project's review list is full (`CONSULT_PENDING_MAX`): a draft that cannot be labelled is a
 * paid call nobody needed, and the list is re-counted after each one because every draft that
 * lands fills a slot.
 */
export async function redraftStale(
  database: Database,
  projectId: string,
  identity: string | null,
): Promise<void> {
  if (await pendingConsultations(database, projectId) >= CONSULT_PENDING_MAX) return;
  const stale = await staleDrafting(database, projectId);
  for (const row of stale) {
    await shadowDraft(database, { consultationId: row.id, identity }, row.question);
    if (await pendingConsultations(database, projectId) >= CONSULT_PENDING_MAX) return;
  }
}
