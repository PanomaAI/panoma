import { neutralizeInline } from "@panoma/core";
import type { StoredCritique } from "@panoma/db";
// Relative and not `@/lib/…`: this module is tested with vitest, which does not resolve the alias.
import { CRITIQUE_LABEL, closingLine } from "./assignments";
import type { Locale } from "./i18n";

/*
  A mechanical finding, managed one by one.
  The mechanical critic already had its assignment: a row in the file with the twenty findings
  inside, grouped by class. It's the right thing to do for twenty loose colors—sorting them
  separately would be twenty terminals—and it's crude for the single broken link of an otherwise
  clean project: to request that, you had to send the entire assignment and trust that the agent
  wouldn't get distracted by the rest.
  The visual critic already knew how to do it from its first version: each finding with its button.
  This is the same for the other critic, and the difference with that one is entirely in how a
  finding is identified — see `critiqueKey`, and column `from_critique`.
  ── The text comes off the disc, so it goes treated ──────────────────────────────────────
  There is no model here: what is being reported is a value read from a file and a path. But a
  file name could have been written by anyone —a dependency, a template, someone who is not you—
  and this ends up in front of an agent with tools. Everything goes through `neutralizeInline`,
  just like in `look-brief.ts` and for the same reason.
  ── And it says what to do with what is no longer there
  ───────────────────────────────────────────
  The review is from the last time the folder was changed, not from this minute. An agent who
  doesn't find what the finding describes has to be able to say so and stop, instead of searching
  until they find something to change.
 */

/** What is saved as homework: a title that is read on a list and the entire message. */
export interface CritiqueBrief {
  title: string;
  body: string;
}

/** What fits of a title in a list of orders. The same as in `look-brief.ts`. */
const TITLE_CHARS = 100;

/** The short name of each class, for the title. The long one is in `CRITIQUE_LABEL`. */
const SHORT: Record<string, { es: string; en: string }> = {
  "color-drift": { es: "Color suelto", en: "Stray colour" },
  "radius-drift": { es: "Radio suelto", en: "Stray radius" },
  "image-no-alt": { es: "Imagen que no dice qué muestra", en: "Image that doesn’t say what it shows" },
  "broken-link": { es: "Enlace roto", en: "Broken link" },
};

/**
 * What to do with each class, which is the half that turns a finding into an assignment.
 *
 * They are the same four rules contained within the assignment of all together, one per class. The
 * one about colors and the one about radios carry their exception along — 'unless it was
 * deliberately set' — because without it the agent would unify the yellow of the notice with the
 * gray of the cards and leave the screen worse than it was.
 */
const FIX: Record<string, { es: string; en: string }> = {
  "color-drift": {
    es: "Unifícalo con el color que sí usa el proyecto, **salvo que estuviera puesto a propósito** —un estado, un aviso, una marca—: si lo estaba, déjalo como está y dilo.",
    en: "Unify it with the colour the project does use, **unless it was there on purpose** —a state, a warning, a brand—: if it was, leave it and say so.",
  },
  "radius-drift": {
    es: "Unifícalo con el radio que sí usa el proyecto, **salvo que la diferencia estuviera puesta a propósito**: si lo estaba, déjalo como está y dilo.",
    en: "Unify it with the radius the project does use, **unless the difference was there on purpose**: if it was, leave it and say so.",
  },
  "image-no-alt": {
    es: "Pon un `alt` que diga qué muestra la imagen. Si es decorativa y no aporta nada, `alt=\"\"` es la respuesta correcta.",
    en: "Add an `alt` that says what the image shows. If it is decorative and adds nothing, `alt=\"\"` is the right answer.",
  },
  "broken-link": {
    es: "Apúntalo a donde esté el fichero, o quítalo. Si no encuentras a dónde debería apuntar, déjalo y dilo.",
    en: "Point it at wherever the file lives, or remove it. If you cannot tell where it should point, leave it and say so.",
  },
};

/** Which project is the folder from. The minimum to place the agent. */
export interface CritiqueProject {
  name: string;
  root: string;
}

/**
 * The assignment that comes from a single mechanical finding.
 *
 * Bilingual on the inside and not by the dictionary, just like `buildAssignment` and
 * `briefFromFinding`: it is a fifteen-line text that must be able to be read in full before giving
 * it to an agent, and splitting it into fifteen keys would make it unreadable.
 */
export function briefFromCritique(
  input: { project: CritiqueProject; finding: StoredCritique; at: Date },
  locale: Locale,
): CritiqueBrief {
  const es = locale === "es";
  const { finding } = input;

  const claim = neutralizeInline(finding.claim, 200);
  const hint = finding.hint ? neutralizeInline(finding.hint, 200) : "";
  const file = finding.file ? neutralizeInline(finding.file, 200) : "";
  const where = file ? `${file}${finding.line ? `:${finding.line}` : ""}` : "";

  const name = neutralizeInline(input.project.name, 80);
  const root = neutralizeInline(input.project.root, 200);
  const when = input.at.toISOString().slice(0, 10);

  const label = CRITIQUE_LABEL[finding.kind];
  const short = SHORT[finding.kind];
  const fix = FIX[finding.kind];

  const lines: string[] = [];
  lines.push(
    es
      ? `Encargo de panoma sobre «${name}» (${root}).`
      : `Assignment from panoma about “${name}” (${root}).`,
  );
  lines.push("");
  lines.push(
    es
      ? `Sale de una revisión del ${when}: panoma leyó la carpeta, sin abrir el proyecto, sin ejecutarlo y sin modelo. Es un hecho comprobable, no una opinión.`
      : `It comes from a review on ${when}: panoma read the folder, without opening the project, without running it and without a model. It is a checkable fact, not an opinion.`,
  );
  lines.push("");

  if (label) lines.push(es ? `Qué es: ${label.es}` : `What it is: ${label.en}`);
  lines.push(es ? `Qué se ve: ${claim}` : `What shows: ${claim}`);
  if (hint) {
    lines.push(es ? `Con qué se compara: ${hint}` : `What it compares against: ${hint}`);
  }
  if (where) lines.push(es ? `Dónde: ${where}` : `Where: ${where}`);
  lines.push("");

  if (fix) lines.push(es ? `El encargo: ${fix.es}` : `The assignment: ${fix.en}`);
  lines.push("");
  lines.push(
    es
      ? "Arregla eso y nada más. Si al abrir el fichero no ves lo que dice el hallazgo, dilo y para: la revisión es de la última vez que cambió esta carpeta, no de este minuto."
      : "Fix that and nothing else. If, once you open the file, you cannot see what the finding describes, say so and stop: the review is from the last time this folder changed, not from this minute.",
  );
  /*
    And close it. This task ALWAYS starts with a queue —the two buttons that create it write to
    the queue before anyone reads it—, so without this line the queue would remain open forever:
    only an agent can close it, and none had been asked to do so.
   */
  lines.push("");
  lines.push(closingLine(locale, es ? "diciendo qué cambiaste" : "stating what you changed"));

  const head = short ? (es ? short.es : short.en) : finding.kind;
  return { title: title(`${head}: ${claim}${where ? ` · ${where}` : ""}`), body: lines.join("\n") };
}

/** The title, shortened to what is read in a list. See `TITLE_CHARS`. */
function title(text: string): string {
  return text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS - 1).trimEnd()}…` : text;
}
