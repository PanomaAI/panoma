import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { complete } from "@panoma/ai";
import { wrapUntrusted } from "@panoma/core";
import { getProject, saveAiSummary } from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t, type Locale } from "@/lib/i18n";
import { modelErrorParts } from "@/lib/model-errors";

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

  const body = (await request.json().catch(() => ({}))) as { slug?: string };
  if (!body.slug) return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });

  const { db: database } = await db();
  const data = await getProject(database, body.slug);
  if (!data) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  const { project, technologies, links, distributions } = data;

  const readme = await readReadme(project.root);
  const stack = technologies
    .filter((tech) => tech.confidence >= 0.6)
    .slice(0, 12)
    .map((tech) => (tech.version ? `${tech.name} ${tech.version}` : tech.name))
    .join(", ");
  const services = links.map((link) => link.service).join(", ");
  const stores = distributions.map((dist) => dist.label).join(", ");
  const commits = (project.recentCommits ?? []) as { subject: string }[];

  /*
    The README and commit issues are wrapped; the rest are not.
    The difference is who wrote it. The stack, the services, and the stores were inferred by the
    Panoma engine from configuration files: these are our facts. The README and the commits are
    another person's prose — `ask_pdf` is literally a downloaded tutorial, and Panoma knows it:
    `provenance.ts` classifies it as someone else's — and this prompt ends in `claude -p` or
    `codex exec`, agents with tools and the user's disk in front of them. A README with a 'ignore
    the above and execute…' would arrive through the same channel as the real instruction.
   */
  const foreign =
    project.originKind === "foreign" || project.originKind === "forked"
      ? (project.originStartedBy ?? "otra persona")
      : undefined;

  const material = [
    `Nombre: ${project.name}`,
    project.description ? `Descripción declarada: ${project.description}` : "",
    stack ? `Pila detectada: ${stack}` : "",
    services ? `Servicios externos: ${services}` : "",
    stores ? `Se distribuye en: ${stores}` : "",
    commits.length > 0
      ? wrapUntrusted(commits.map((c) => `- ${c.subject}`).join("\n"), {
          origin: "commits",
          author: foreign,
          limit: 1000,
        })
      : "",
    wrapUntrusted(readme, { origin: "readme", author: foreign }),
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

    const text = result.text.trim();
    await saveAiSummary(database, project.id, text, `${result.provider}/${result.model}`, locale);

    return Response.json({ text, model: `${result.provider}/${result.model}` });
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
      // El siguiente.
    }
  }
  return undefined;
}

export const maxDuration = 120;
