import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { complete } from "@panoma/ai";
import { wrapUntrusted } from "@panoma/core";
import { getProject, modelSpendToday, saveAiSummary, saveModelCall } from "@panoma/db";
import { cardFingerprint } from "@/lib/card-fingerprint";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t, type Locale } from "@/lib/i18n";
import { modelErrorParts } from "@/lib/model-errors";
import { capFor, FAMILY_KINDS } from "@/lib/spend-settings";

/**
 * Ask a model to explain what a project is about.
 *
 * It is the only part of Panoma where the text does not come from a verifiable fact, and that is
 * why it is separated from the others in every way possible: it is kept in its own column, it is
 * labeled with the model that wrote it and the date, it never replaces the author's description,
 * and it does not regenerate on its own with each scan.
 *
 * The model is given real material —the README, the detected stack, the folder structure— and is
 * explicitly forbidden to fill in gaps. An invented paragraph about a personal project is
 * immediately detected and ruins the entire function.
 *
 * It is paid for, and since 6-Sep-2026 it is counted and held back like every other paid call:
 * a row of kind `describe` in the ledger, and a cap shared with `/api/md/review` — the family
 * `card`, `PANOMA_CARD_BUDGET`, one hundred a day out of the box. A person pressing a button was
 * the argument for leaving it out, and it is the same argument that held for the reads until a
 * loop proved it did not. And it never pays twice for the same project: the saved paragraph
 * carries the fingerprint of the material it was written from, and an unchanged project gets the
 * saved text back unless the caller says `force`.
 */
/*
  The language of the answer is decided by the person who asks, and that is why it lives here and
  not in `i18n.ts`.
  This is not an interface copy: it is the instruction that the model receives, and `i18n.ts`
  stores what a person reads. What it does share with the interface is the criteria — until August
  25, 2026, this line set plain Spanish, so a reader with the browser in English and the terminal,
  which has been monolingual English since that same day, would receive a paragraph in Spanish and
  pay for it.
  And unlike the rest of the copy, this text **is saved**: `saveAiSummary` writes it in the
  database. That is why the array has two halves and the second is the column `aiSummaryLang` —
  without it, what was saved before today would continue to be shown as if it were in the language
  of whoever is looking.
 */
const SYSTEM: Record<Locale, string> = {
  es:
    "Eres un catalogador de proyectos de software. Escribes en español neutro —sin " +
    "marcas regionales, entendible igual en América y en España—, en prosa llana, " +
    "sin adjetivos de marketing y sin listas. Tu respuesta va en español.",
  en:
    "You catalog software projects. You write plain English — no regional idioms, no " +
    "marketing adjectives, no lists. Your answer is in English.",
};

export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  const body = (await request.json().catch(() => ({}))) as { slug?: string; force?: boolean };
  if (!body.slug) return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });

  const { db: database } = await db();
  const data = await getProject(database, body.slug);
  if (!data) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  const { project, technologies, links, distributions, decision } = data;

  const readme = await readReadme(project.root);
  const stack = technologies
    .filter((tech) => tech.confidence >= 0.6)
    .slice(0, 12)
    .map((tech) => (tech.version ? `${tech.name} ${tech.version}` : tech.name))
    .join(", ");
  const services = links.map((link) => link.service).join(", ");
  const stores = distributions.map((dist) => dist.label).join(", ");
  const commits = (project.recentCommits ?? []) as { subject: string }[];
  const subjects = commits.map((commit) => `- ${commit.subject}`).join("\n");

  /*
    The fingerprint goes over the raw pieces, before any prompt is built: the same project, the
    same paragraph. It is compared against what was saved with the text, and the language too —
    a paragraph saved in Spanish is not an answer for a browser in English, which is the whole
    reason `aiSummaryLang` exists. A null fingerprint is a text written before the fingerprint
    existed: unknown, so it pays once more and is stored with one from then on.
   */
  const hash = cardFingerprint([
    project.name,
    project.description ?? undefined,
    stack,
    services,
    stores,
    subjects,
    readme,
  ]);
  if (
    body.force !== true &&
    decision?.aiSummary &&
    decision.aiSummaryHash === hash &&
    decision.aiSummaryLang === locale
  ) {
    return Response.json({
      text: decision.aiSummary,
      model: decision.aiSummaryModel,
      at: decision.aiSummaryAt?.toISOString() ?? null,
      cached: true,
      saved: true,
    });
  }

  /*
    The brake, before the prompt is built and after the saved answer was ruled out: an answer
    that costs nothing is never refused. The count is the family's, not this route's — the two
    buttons of the card are one gesture repeated, and `FAMILY_KINDS.card` names both kinds.
   */
  const spent = await modelSpendToday(database, FAMILY_KINDS.card);
  const { cap } = await capFor("card");
  if (spent.calls >= cap) {
    return Response.json(
      {
        error: t(locale, "api.cardSpent", { used: spent.calls, cap }),
        hint: t(locale, "api.cardSpentHint"),
      },
      { status: 429 },
    );
  }

  /*
    The README and commit issues are wrapped; the rest are not.
    The difference is who wrote it. The stack, the services, and the stores were inferred by the
    Panoma engine from configuration files: these are our facts. The README and the commits are
    another person's prose — `pdf_quiz` is literally a downloaded tutorial, and Panoma knows it:
    `provenance.ts` classifies it as someone else's — and this prompt ends in `claude -p` or
    `codex exec`, agents with tools and the user's disk in front of them. A README with a 'ignore
    the above and execute…' would arrive through the same channel as the real instruction.

    The three-line notice behind the envelope goes once, behind the last block: repeated behind
    each one it turns into filler the model skips, and the notice is the part that has to be read.
   */
  const foreign =
    project.originKind === "foreign" || project.originKind === "forked"
      ? (project.originStartedBy ?? "otra persona")
      : undefined;

  const foreignBlocks = [
    subjects ? { text: subjects, origin: "commits" as const, limit: 1000 } : undefined,
    readme?.trim() ? { text: readme, origin: "readme" as const, limit: undefined } : undefined,
  ].filter((block) => block !== undefined);
  const wrapped = foreignBlocks.map((block, index) =>
    wrapUntrusted(block.text, {
      origin: block.origin,
      author: foreign,
      limit: block.limit,
      includeNote: index < foreignBlocks.length - 1 ? false : undefined,
    }),
  );

  const material = [
    `Nombre: ${project.name}`,
    project.description ? `Descripción declarada: ${project.description}` : "",
    stack ? `Pila detectada: ${stack}` : "",
    services ? `Servicios externos: ${services}` : "",
    stores ? `Se distribuye en: ${stores}` : "",
    ...wrapped,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const result = await complete({
      system: SYSTEM[locale],
      prompt:
        "A partir del material de abajo, escribe de dos a cuatro frases que expliquen de " +
        "qué trata este proyecto: qué hace, para quién y con qué se apoya.\n\n" +
        "Reglas estrictas:\n" +
        "- Solo puedes afirmar lo que esté en el material. No completes con lo que suele " +
        "hacer un proyecto así.\n" +
        "- Si el material no dice para qué sirve, dilo: «el proyecto no explica para qué " +
        "sirve» es una respuesta correcta y útil.\n" +
        "- Nada de «potente», «moderno», «robusto», «solución integral».\n" +
        "- No empieces con «Este proyecto». Empieza por lo que hace.\n\n" +
        `---\n${material}`,
      maxTokens: 500,
    });

    // The ledger first, before anything is parsed or saved: the call was answered and it counts.
    await saveModelCall(database, {
      kind: "describe",
      provider: result.provider,
      model: result.model,
      identity: project.identity ?? null,
      ...(result.usage ? { input: result.usage.input, output: result.usage.output } : {}),
    });

    const text = result.text.trim();
    const signature = `${result.provider}/${result.model}`;
    await saveAiSummary(database, project.id, text, signature, locale, hash);

    /*
      `saved` is honest about the one case `saveAiSummary` stays quiet on: a project with no
      stable identity has no row in `decisions` to hang the text from, so the paragraph was paid
      for and lives only in this response. The card says so instead of offering the button again
      tomorrow as if it had never been pressed.
     */
    return Response.json({ text, model: signature, cached: false, saved: project.identity !== null });
  } catch (error) {
    // The track was fixed in Spanish within the English interface. See `lib/model-errors.ts`.
    const { detail, hint } = modelErrorParts(locale, error);
    return Response.json(
      { error: t(locale, "api.modelFailed", { detail }), hint },
      { status: 502 },
    );
  }
}

/** The principle of README: enough to know what it's about, without exhausting the context. */
async function readReadme(root: string): Promise<string | undefined> {
  for (const candidate of ["README.md", "readme.md", "README"]) {
    try {
      const text = await readFile(join(root, candidate), "utf8");
      return text;
    } catch {
      // The next one.
    }
  }
  return undefined;
}

export const maxDuration = 120;
