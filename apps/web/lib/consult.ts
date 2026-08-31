import { complete } from "@panoma/ai";
import { wrapUntrusted } from "@panoma/core";
import {
  draftConsultation,
  listBeliefs,
  modelSpendToday,
  saveModelCall,
  staleDrafting,
  type Database,
} from "@panoma/db";

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

/** Drafts up to date, unless `PANOMA_ASK_BUDGET` says otherwise. */
const ASKS_PER_DAY = 20;

const MAX_ANSWER_TOKENS = 400;

/** The same contract as the other two environment brakes: empty or invalid, the factory one. */
export function askBudgetFrom(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return ASKS_PER_DAY;
  const limit = Number(value.trim());
  if (!Number.isInteger(limit) || limit < 0) return ASKS_PER_DAY;
  return limit;
}

/** A belief with its batch label, ready for the prompt and to resolve appointments. */
export interface LabelledBelief {
  label: string;
  id: string;
  state: string;
  statement: string;
}

/**
 * The order. Exported to try it without paying.
 *
 * In Spanish, like the Twin prompts. Beliefs are text that once came from transcripts of the
 * owner: they come wrapped — the person's signature filters intention, not origin, which is the
 * same rule as with notes.
 */
export function buildAskPrompt(
  question: string,
  beliefs: LabelledBelief[],
): { system: string; prompt: string } {
  const system = [
    "Eres el doble de la persona dueña de este catálogo: un modelo de su criterio minado de",
    "sus veredictos reales. Un agente que trabaja en un proyecto suyo tiene una pregunta de",
    "criterio. Tu único material son las creencias de abajo, cada una con su etiqueta.",
    "",
    "Reglas:",
    "- Contesta SOLO si alguna creencia cubre la pregunta de verdad. Estirar una creencia",
    "  para que parezca que cubre es el fallo que este sistema existe para medir.",
    "- Una a tres frases, en el idioma de la pregunta, citando las etiquetas usadas.",
    "- Las creencias `signed` son suelos firmados por la persona; pesan más que las `inferred`.",
    '- Formato: JSON `{"answer": "...", "cites": ["b2"]}` para contestar,',
    '  o `{"abstain": true}` si ninguna creencia cubre. Nada más.',
  ].join("\n");

  const material = beliefs
    .map((b) => `- [${b.label}] (${b.state}) ${b.statement}`)
    .join("\n");

  /*
    The warning about foreign material goes with the LAST block, covering both of them: in the
    first version it went with the question and the bigger block —beliefs— remained behind without
    a note, against the multi-block convention of the untrusted module itself.
   */
  const prompt = [
    "La pregunta del agente:",
    wrapUntrusted(question, { origin: "journal", limit: 600, includeNote: false }),
    "",
    "Las creencias del dueño:",
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

/** The prefix of beliefs that fits in the envelope; the labels remain adjacent. */
export function fitBeliefs(beliefs: LabelledBelief[], limit = ASK_MATERIAL_LIMIT): LabelledBelief[] {
  const fitted: LabelledBelief[] = [];
  let used = 0;
  for (const belief of beliefs) {
    const line = `- [${belief.label}] (${belief.state}) ${belief.statement}\n`.length;
    if (used + line > limit) break;
    used += line;
    fitted.push(belief);
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
  if (typeof draft.answer !== "string" || draft.answer.trim() === "") return "abstain";

  const byLabel = new Map(beliefs.map((b) => [b.label, b.id]));
  const cites = Array.isArray(draft.cites) ? draft.cites : [];
  const beliefIds = cites
    .filter((c): c is string => typeof c === "string")
    .map((label) => byLabel.get(label))
    .filter((id): id is string => id !== undefined);

  if (beliefIds.length === 0) return "abstain";
  return { answer: draft.answer.trim(), beliefIds: [...new Set(beliefIds)] };
}

/**
 * The beliefs that apply to this project: the global ones and those limited to its identity, alive
 * (signed or sustained). Labeled in a stable order so that the same batch produces the same map.
 */
export async function beliefsFor(database: Database, identity: string | null): Promise<LabelledBelief[]> {
  const rows = await listBeliefs(database, { states: ["signed", "inferred"] });
  return rows
    .filter((b) => b.identity === null || b.identity === identity)
    .map((b, index) => ({ label: `b${index + 1}`, id: b.id, state: b.state, statement: b.statement }));
}

/**
 * The full shift of the editor, in essence: free brakes, beliefs, call, draft. He never throws
 * upward — the falling shadow loses a draft, not a question: the row remains in `drafting` and is
 * seen in the record as what it is, unedited.
 */
export async function shadowDraft(
  database: Database,
  input: { consultationId: string; identity: string | null },
  question: string,
): Promise<void> {
  // The cut BEFORE labeling: the same prefix travels to the prompt and to the citation map.
  const beliefs = fitBeliefs(await beliefsFor(database, input.identity));
  if (beliefs.length === 0) {
    // Without beliefs there is no double: abstention without paying call.
    await draftConsultation(database, input.consultationId, { abstained: true });
    return;
  }

  const cap = askBudgetFrom(process.env["PANOMA_ASK_BUDGET"]);
  const spent = await modelSpendToday(database, ASK_KIND);
  // It stays in `drafting`, and it is not an empty promise: the next `panoma_ask` of the project
  // goes through `redraftStale` and picks it up with the budget of that day.
  if (spent.calls >= cap) return;

  const built = buildAskPrompt(question, beliefs);
  const answer = await complete({
    system: built.system,
    prompt: built.prompt,
    maxTokens: MAX_ANSWER_TOKENS,
  });

  await saveModelCall(database, {
    kind: ASK_KIND,
    provider: answer.provider,
    model: answer.model,
    identity: input.identity,
    ...(answer.usage ? { input: answer.usage.input, output: answer.usage.output } : {}),
  });

  const draft = parseAsk(answer.text, beliefs);
  await draftConsultation(
    database,
    input.consultationId,
    draft === "abstain" ? { abstained: true } : { answer: draft.answer, beliefIds: draft.beliefIds },
  );
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
 */
export async function redraftStale(
  database: Database,
  projectId: string,
  identity: string | null,
): Promise<void> {
  const stale = await staleDrafting(database, projectId);
  for (const row of stale) {
    await shadowDraft(database, { consultationId: row.id, identity }, row.question);
  }
}
