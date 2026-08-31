import { wrapUntrusted } from "@panoma/core";
import { TOPICS, TOPIC_NAMES } from "@/lib/distill";

/*
  Distribute the evidence by subjects, which is the step that makes it possible to synthesize.
  The synthesis runs **by topic**: all design-related matters together, in order to be able to say
  what this person asks from design. Without that, a single call with hundreds of mixed sentences
  returns generalities, which is exactly what the portrait cannot be.
  What the model distills already arrives classified —the order `distill.ts` requests the material
  with the observation— so this almost never runs. It exists for two specific reasons:
  1. **Migration.** The hundreds of sentences that come from the old tail do not bring substance:
  they were born with a surface —`app`, `landing`, `docs` — which was another question. They all
  enter `other` without looking, and without this step the synthesis would look at them all
  together, which is the worst batch possible.
  2. **The coined.** The vocabulary is open, so a new subject can appear on a Tuesday; rearranging
  what was already written shouldn't cost re-distilling the entire history.
  It is Twin's cheapest call, and that's why it can run on its own before synthesizing: it doesn't
  send quotes, context, or outputs — just the sentence, which a model has already written. A batch
  of sixty sentences is about three thousand characters.
 */

/**
 * How many sentences go in each call.
 *
 * Sixty sentences of two hundred characters are about twelve thousand, that is, about three
 * thousand input tokens and about six hundred output tokens. It fits comfortably and keeps the
 * error bounded: if the model gets lost in one batch, sixty classifications are lost and not the
 * entire dataset.
 */
export const CLASSIFY_BATCH = 60;

/** How many rounds does one pass at most make. See `MAX_CHUNKS` in `distill.ts`. */
export const CLASSIFY_MAX_BATCHES = 12;

/** A sentence with the label with which the model is going to refer to it. */
export interface LabelledStatement {
  label: string;
  id: string;
  statement: string;
}

export interface BuiltClassify {
  system: string;
  prompt: string;
  /** From label to `id` of the row. It is the map against which the answer is resolved. */
  labels: Map<string, string>;
}

/**
 * Distribute the phrases in batches of {@link CLASSIFY_BATCH}, in the order they arrive.
 *
 * In the order in which they arrive and without choosing: here there is nothing to prioritize.
 * Whoever calls for them asks for them already ordered by the most recent, and classifying one
 * phrase does not depend on the ones next to it.
 */
export function planBatches<T>(rows: T[], size = CLASSIFY_BATCH): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += size) batches.push(rows.slice(i, i + size));
  return batches.slice(0, CLASSIFY_MAX_BATCHES);
}

/**
 * The assignment: a list of sentences and a subject for each one.
 *
 * The sentences are wrapped in `untrusted_data` like everything that comes out of a history, even
 * if a model from this same house wrote them: they came from the person's quotes and the channel
 * they go through is the same one that ends in `claude -p` with its disk in front.
 *
 * No language. What comes out of here are identifiers in English —`design`, `backend` — which are
 * never translated: they are the headers of `TASTE.md` and the keys of the grouping. The
 * assignment is indeed in Spanish, which is the company's voice, like that of `describe`.
 */
export function buildClassifyPrompt(rows: { id: string; statement: string }[]): BuiltClassify {
  const labelled: LabelledStatement[] = rows.map((row, index) => ({
    label: `s${index + 1}`,
    id: row.id,
    statement: row.statement,
  }));
  const labels = new Map(labelled.map((one) => [one.label, one.id]));

  const list = wrapUntrusted(
    labelled.map((one) => `[${one.label}] ${one.statement}`).join("\n"),
    { origin: "journal", limit: 40_000 },
  );

  const prompt = [
    "Abajo van frases sobre cómo le gusta a una persona que quede su trabajo, numeradas",
    "—[s1], [s2], …—. Dile a cada una de qué materia es.",
    "",
    "Las materias son estas:",
    ...TOPICS.map((one) => `- ${one.name}: ${one.hint}.`),
    "",
    "Reglas:",
    "- Una materia por frase, y todas las frases llevan la suya.",
    "- Elige por lo que la frase pide, no por dónde se vería. «Quieres que el listado cargue",
    "  antes de pintar nada» es `backend` si habla de la consulta y `frontend` si habla del",
    "  esqueleto que se enseña mientras tanto; lee la frase, no la palabra.",
    "- `other` solo cuando de verdad no encaje en ninguna. Es el cajón, no el desempate.",
    "- Puedes escribir una materia que no esté en la lista: una sola palabra, en minúsculas",
    "  y en inglés. Hazlo solo si varias frases la comparten y ninguna de arriba les vale.",
    "",
    "Contesta con un array JSON y nada más: sin vallas de código, sin explicación delante",
    "ni detrás.",
    `[{"item":"s1","topic":"design"},{"item":"s2","topic":"backend"}]`,
    "",
    list,
  ].join("\n");

  return { system: SYSTEM, prompt, labels };
}

const SYSTEM = [
  "Clasificas frases por materia y no haces nada más: no las reescribes, no las juzgas,",
  "no las resumes y no opinas sobre ellas. Contestas solo con el JSON que se te pide.",
].join(" ");

/** A sentence with its subject, already solved at the `id` of its row. */
export interface Assignment {
  id: string;
  topic: string;
  /** If the material was not in the planted vocabulary. */
  minted: boolean;
}

export interface ClassifyOutcome {
  assigned: Assignment[];
  /** Entries that did not match any label of the round. They are counted, not saved. */
  dropped: number;
  /**
   * The response was not an array. See `parseObservations`, which fails the same way and for the
   * same reason.
   */
  unreadable: boolean;
}

/**
 * Read the model's answer. It never throws, like everything it reads to a model here.
 *
 * A label that does not resolve is discarded: `s99` invented cannot move a row that the model has
 * not seen. And a repeated label only counts the first time — two subjects for the same sentence
 * are not two classifications, they are one answer that contradicts itself, and the second would
 * overwrite the first without anyone having decided which one counts.
 */
export function parseTopics(text: string, labels: ReadonlyMap<string, string>): ClassifyOutcome {
  const parsed = readArray(text);
  if (parsed === undefined) return { assigned: [], dropped: 0, unreadable: true };
  if (parsed.length > 0 && !parsed.some(isRecord)) {
    return { assigned: [], dropped: 0, unreadable: true };
  }

  const assigned: Assignment[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const item of parsed) {
    if (!isRecord(item)) {
      dropped += 1;
      continue;
    }
    const label = asText(item["item"])?.trim().toLowerCase().match(/\bs\d+\b/)?.[0];
    const id = label === undefined ? undefined : labels.get(label);
    if (id === undefined || seen.has(id)) {
      dropped += 1;
      continue;
    }

    const topic = topicOf(item["topic"]);
    if (topic === undefined) {
      dropped += 1;
      continue;
    }

    seen.add(id);
    assigned.push({ id, ...topic });
  }

  return { assigned, dropped, unreadable: false };
}

/**
 * The subject that the model mentioned, or nothing.
 *
 * Here the illegible is indeed discarded, unlike in distillation —where a rare material falls into
 * `other` —. The difference is what is lost: there, discarding it would throw away an entire
 * observation with its citations; here, the row stays as it was and unclassified, meaning it will
 * go through the classifier again next time. Sending it to `other` would mark it as seen when what
 * happened is that the answer was not understood.
 */
function topicOf(value: unknown): { topic: string; minted: boolean } | undefined {
  const named = asText(value)?.trim().toLowerCase().replace(/[.:]+$/, "") ?? "";
  if (TOPIC_NAMES.includes(named)) return { topic: named, minted: false };
  if (TOPIC.test(named)) return { topic: named, minted: true };
  return undefined;
}

/** The same way that `topicOf` requires in the engine: whatever is written ends up as a header. */
const TOPIC = /^[a-z][a-z0-9-]{0,23}$/;

/** The array JSON that is inside the response, or nothing. See `readArray` in `distill.ts`. */
function readArray(text: string): unknown[] | undefined {
  const clean = stripFences(text).trim();

  try {
    const whole: unknown = JSON.parse(clean);
    return Array.isArray(whole) ? whole : undefined;
  } catch {
    // The model said something before the array, or after. It is searched by hand.
  }

  /*
    And **all** the brackets are searched for, not just the first one.
    The first `[` was tested, and if the piece up to its closure did not parse, "unreadable" was
    returned with the good array intact two lines below. The task shows the tags in brackets, so
    the typical preamble carries them: "Based on [c3] and [c7]:" already triggers the entire
    response. Any prose bracket works the same — "Here are [8 in total]:".
   */
  for (let start = clean.indexOf("["); start !== -1; start = clean.indexOf("[", start + 1)) {
    const found = arrayAt(clean, start);
    if (found !== undefined) return found;
  }

  return undefined;
}

/**
 * The array that starts at `start`, if it exists and if it parses.
 *
 * Advance counting brackets until the one that closes it, respecting strings and their escapes:
 * without that, a `]` inside a quote would close the array prematurely. If it never closes, the
 * response came cut off and there is nothing to return.
 */
function arrayAt(clean: string, start: number): unknown[] | undefined {
  let depth = 0;
  let inString = false;
  for (let i = start; i < clean.length; i += 1) {
    const char = clean[i];
    if (inString) {
      if (char === "\\") i += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          const found: unknown = JSON.parse(clean.slice(start, i + 1));
          return Array.isArray(found) ? found : undefined;
        } catch {
          return undefined;
        }
      }
    }
  }

  return undefined;
}

function stripFences(text: string): string {
  const fence = /```(?:[a-zA-Z]+)?\n([\s\S]*?)```/.exec(text);
  return fence?.[1] ?? text;
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
