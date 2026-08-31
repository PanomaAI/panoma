import { complete } from "@panoma/ai";
import { wrapUntrusted } from "@panoma/core";
import {
  NOTE_MAX,
  NOTE_PENDING_MAX,
  listProjectNotes,
  listSessionActivities,
  modelSpendToday,
  noteUsage,
  proposeNote,
  saveModelCall,
  validTrigger,
  type Database,
} from "@panoma/db";

/*
  The distiller: the memory that writes itself, with the gate intact.
  `panoma_remember` depends on the agent's initiative, and an agent who has just spent two hours
  discovering something is thinking about finishing, not about documenting. Here is the other
  source: when closing a session, they reread what they left in the log and ask what of that will
  still be true next month. Whatever comes out enters through the SAME door as everything else —
  `proposeNote`, proposed, waiting for the person's yes. The distiller has no privilege: they are
  just another proposer, with the same limits.
  ── What it is NOT ─────────────────────────────────────────────────────────────────────
  It is not a summarizer. A session summary already exists and is called a log; proposing it as a
  memory would be putting the log in the rule box, which is exactly the distinction that the
  `notes` table exists to maintain. The prompt insists on that and emptiness is a correct
  response: most sessions do not discover anything lasting.
  ── The order of the brakes ───────────────────────────────────────────────────────────
  First the free ones (session with substance, review queue with gap), then the expense book, and
  only then is the call paid. And the expense is recorded BEFORE understanding the answer — the
  rule of `look-run`: a brake that only counts calls that were also understood stops counting
  exactly the day a model starts answering anything.
 */

/**
 * The class with which this writes in the expense book.
 *
 * `distill` is already taken —it is the Twin distilling verdicts in observations— and both are
 * real distillations, so the surname is determined by fate: this writes in the project's memory.
 */
export const DISTILL_KIND = "memory";

/** Distillations per day, unless `PANOMA_DISTILL_BUDGET` says otherwise. */
const DISTILLS_PER_DAY = 12;

/** With just one activity there is no story to reread: it would be paying to paraphrase. */
const MIN_ACTIVITIES = 2;

/** Candidates per session, at most. A session that 'discovers' six things is summarizing. */
const MAX_CANDIDATES = 3;

const MAX_ANSWER_TOKENS = 500;

/** The same contract as `budgetFrom` of the critic: empty or invalid → the factory one. */
export function distillBudgetFrom(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DISTILLS_PER_DAY;
  const limit = Number(value.trim());
  if (!Number.isInteger(limit) || limit < 0) return DISTILLS_PER_DAY;
  return limit;
}

/**
 * How it ended, for whoever wants to look at it. The route that fires it does not look at it: it
 * is background.
 */
export type DistillReceipt =
  | { did: "thin" | "queueFull" | "budget" | "unreadable" }
  | { did: "distilled"; proposed: number; dropped: number };

/**
 * The order. Exported to be able to test it without paying for a call.
 *
 * In Spanish like the Twin prompts, with the output language set separately: the notes must come
 * out in the language of the material, because they will be read by whoever wrote that material.
 * Everything foreign travels wrapped — the log was written by an agent who read third-party text,
 * and the existing notes as well.
 */
export function buildDistillPrompt(input: {
  activities: { kind: string; summary: string; details: string | null; filesTouched: string[] }[];
  existing: { body: string; status: string }[];
}): { system: string; prompt: string } {
  const system = [
    "Eres el destilador de memoria de panoma, un catálogo local de proyectos de código.",
    "Te llega la bitácora de UNA sesión de trabajo de un agente sobre un proyecto. Tu único",
    "trabajo es decidir si esa sesión descubrió algún hecho DURABLE del proyecto: algo que",
    "seguirá siendo verdad el mes que viene y que cualquier agente debería saber antes de",
    "tocar nada. Ejemplos del tipo de hecho que buscas: «los tests exigen build antes en un",
    "árbol frío», «el servidor del puerto 4173 es build de producción y no recoge código».",
    "",
    "Reglas:",
    "- NO resumas la sesión. Lo que PASÓ ya está en la bitácora; tú buscas lo que SIGUE SIENDO VERDAD.",
    `- Cada hecho: una o dos frases, ${NOTE_MAX - 100} caracteres como mucho, en el mismo idioma que el material.`,
    "- Nada que ya esté en la memoria existente, ni nada equivalente a una nota descartada: un descarte es la persona diciendo que no.",
    "- En la duda, fuera. Cero hechos es la respuesta correcta para la mayoría de las sesiones.",
    "- Si un hecho es de un SITIO concreto —un directorio o fichero que la sesión tocó—, dilo",
    '  con `where`: la ruta tal como aparece en la bitácora. Un hecho del proyecto entero va sin `where`.',
    `- Contesta SOLO con un array JSON, ${MAX_CANDIDATES} elementos como mucho: cadenas, u objetos`,
    '  `{"note": "...", "where": "ruta"}`. Sin nada, contesta [].',
  ].join("\n");

  const journal = input.activities
    .map((a) => {
      const files = a.filesTouched.length > 0 ? `\n  ficheros: ${a.filesTouched.slice(0, 12).join(", ")}` : "";
      return `- [${a.kind}] ${a.summary}${a.details ? `\n  ${a.details.slice(0, 400)}` : ""}${files}`;
    })
    .join("\n");

  const memory =
    input.existing.length === 0
      ? "La memoria del proyecto está vacía."
      : wrapUntrusted(
          input.existing.map((n) => `- [${n.status}] ${n.body}`).join("\n"),
          { origin: "notes", limit: 4000, includeNote: false },
        );

  const prompt = [
    "La bitácora de la sesión:",
    wrapUntrusted(journal, { origin: "journal", limit: 8000 }),
    "",
    "La memoria existente (approved ya se sabe; proposed ya está esperando; discarded es un no de la persona):",
    memory,
  ].join("\n");

  return { system, prompt };
}

/**
 * Read the model's answer. Exported for the same reason as the assignment.
 *
 * `undefined` is 'it was not understood,' which is not the same as `[]` ('there is nothing
 * durable'): the first is a paid and unreadable call and the second is the most common response.
 */
export interface Candidate {
  body: string;
  where?: string;
}

export function parseCandidates(text: string): Candidate[] | undefined {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = clean.indexOf("[");
  const end = clean.lastIndexOf("]");
  if (start === -1 || end <= start) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(clean.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;

  // Strings or objects {note, where}: the two forms that the assignment allows coexist in the same
  // array, because a model that mixes them is not making a mistake.
  return parsed.flatMap((item): Candidate[] => {
    if (typeof item === "string") return [{ body: item }];
    if (item !== null && typeof item === "object" && typeof (item as { note?: unknown }).note === "string") {
      const where = (item as { where?: unknown }).where;
      return [{ body: (item as { note: string }).note, ...(typeof where === "string" ? { where } : {}) }];
    }
    return [];
  });
}

/**
 * From the 'where' of the model to the stored trigger, against the map of what the session
 * touched.
 *
 * The same principle as synthesis quotes: a route that is not in the logbook cannot be
 * convincingly invented. A file touched as is → exact trigger; a real ancestor directory of
 * something touched → `dir/**`; anything else falls apart — and the note survives without a
 * location, which is the cheap failure.
 */
export function whereToTrigger(where: string | undefined, touched: string[]): string | undefined {
  if (where === undefined) return undefined;
  const clean = where.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  if (clean === "" || !validTrigger(clean)) return undefined;
  if (touched.includes(clean)) return clean;
  if (touched.some((file) => file.startsWith(`${clean}/`))) return `${clean}/**`;
  return undefined;
}

/** Two facts that only differ in capitalization or spaces are the same fact. */
function normalized(body: string): string {
  return body.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Reread the session that has just closed and propose what is durable. Running in the background:
 * the route that triggers it has already responded, and a fallen distiller owes nothing to anyone
 * — memory loses a source, not the session its record.
 */
export async function distillSession(
  database: Database,
  input: { projectId: string; identity: string | null; sessionId: string },
): Promise<DistillReceipt> {
  const activities = await listSessionActivities(database, input.sessionId);
  if (activities.length < MIN_ACTIVITIES) return { did: "thin" };

  const usage = await noteUsage(database, input.projectId);
  if (usage.pending >= NOTE_PENDING_MAX) return { did: "queueFull" };

  const cap = distillBudgetFrom(process.env["PANOMA_DISTILL_BUDGET"]);
  const spent = await modelSpendToday(database, DISTILL_KIND);
  if (spent.calls >= cap) return { did: "budget" };

  const existing = await listProjectNotes(database, input.projectId, [
    "approved",
    "proposed",
    "discarded",
  ]);

  /*
    The jsonb arrives without type: it is normalized once and serves for the prompt and for the
    map. The separators too — an agent in Windows points to `apps\web\x.ts`, and the triggers only
    speak `/`: without the translation, `whereToTrigger` would never quote anything there.
   */
  const shaped = activities.map((a) => ({
    kind: a.kind,
    summary: a.summary,
    details: a.details,
    filesTouched: Array.isArray(a.filesTouched)
      ? a.filesTouched
          .filter((f): f is string => typeof f === "string")
          .map((f) => f.replaceAll("\\", "/"))
      : [],
  }));
  const touched = shaped.flatMap((a) => a.filesTouched);

  const built = buildDistillPrompt({ activities: shaped, existing });
  const answer = await complete({
    system: built.system,
    prompt: built.prompt,
    maxTokens: MAX_ANSWER_TOKENS,
  });

  await saveModelCall(database, {
    kind: DISTILL_KIND,
    provider: answer.provider,
    model: answer.model,
    identity: input.identity,
    ...(answer.usage ? { input: answer.usage.input, output: answer.usage.output } : {}),
  });

  const candidates = parseCandidates(answer.text);
  if (candidates === undefined) return { did: "unreadable" };

  const known = new Set(existing.map((note) => normalized(note.body)));
  let proposed = 0;
  let dropped = 0;

  for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
    const body = candidate.body.trim();
    if (body.length === 0 || body.length > NOTE_MAX || known.has(normalized(body))) {
      dropped++;
      continue;
    }
    const trigger = whereToTrigger(candidate.where, touched);
    const result = await proposeNote(database, {
      projectId: input.projectId,
      body,
      createdBy: "distiller",
      ...(trigger !== undefined ? { trigger } : {}),
    });
    if ("refused" in result) {
      dropped++;
      // The queue filled up between the brake and now: the rest no longer fits and there is no
      // insistence.
      if (result.refused === "pendingFull") break;
      continue;
    }
    known.add(normalized(body));
    proposed++;
  }

  return { did: "distilled", proposed, dropped };
}
