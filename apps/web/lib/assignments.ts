import { neutralizeInline, workRisks, type Runbook } from "@panoma/core";
import { stateOf, type ProjectState } from "@panoma/db";
// Relative and not `@/lib/…`: this module is tested with vitest, which does not resolve the alias.
import { riskText, t, type Locale, type MessageKey, type Translate } from "./i18n";

/**
 * The assignments: what Panoma drafts for your agent to carry out.
 *
 * The task queue already existed, and the agent was already picking it up via MCP; what was
 * missing was that the errand was worth it. A handwritten 'competitor search' does not contain any
 * of what Panoma knows about the project — what it is, what it's made of, how long it has been
 * stalled, what it drags along without maintenance — and that context is exactly the difference
 * between a generic prompt and a well-given assignment. Here that difference is written.
 *
 * Three rules support the module:
 *
 * 1. **Only what applies is offered.** 'Tell me what I lack to resume it' does not appear in a
 * project that was touched yesterday. A section of actions that does not read the state is
 * decoration.
 * 2. **The result lives in the project repo, not in Panoma.** Each task requires a committed file:
 * the watcher sees the commit, the attribution comes out automatically, and Panoma remains a
 * catalog, not a file cabinet.
 * 3. **What belongs to others travels neutralized.** The project summary may come from a README
 * that you did not write, and this text ends up in front of an agent with tools. It goes to
 * `neutralizeInline`: in a single line and truncated, an instruction cannot be assembled.
 *
 * The body is written in the interface language — the order is read by the same person who
 * requests it, and often they paste it exactly as it is into their agent.
 */

export const ASSIGNMENT_KINDS = [
  "resume",
  "competitors",
  "plan",
  "presentable",
  /*
    The fifth one is not drafted by the catalog with what it knows about the project: it is
    drafted by the mechanical critic with what it has seen reading its files. It enters this list
    and not its own screen on purpose — thus it inherits the entire machinery that already exists:
    the row of the record with its three ways of delivering it, the queue that does not duplicate
    it as long as it remains open, and the terminal that opens an agent with it inside. A new
    organ with its own button would have been a second place to order things.
   */
  "review",
] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

export function isAssignmentKind(value: unknown): value is AssignmentKind {
  return typeof value === "string" && (ASSIGNMENT_KINDS as readonly string[]).includes(value);
}

export interface Assignment {
  kind: AssignmentKind;
  /** The title is also the title of the task in the queue: it is recognized by it afterward. */
  title: string;
  /** A line for the card: what you take if you order it. */
  promise: string;
  /** The complete order, ready for the queue or to stick it on the agent. */
  body: string;
}

/*
  Title and promise live in the dictionary and not here: they are interface text and the
  `satisfies` from English ensures that they exist in both languages. The explicit map prevents
  creating keys with templates — a manually composed key escapes the compiler.
 */
const TITLE: Record<AssignmentKind, MessageKey> = {
  resume: "assignment.resume",
  competitors: "assignment.competitors",
  plan: "assignment.plan",
  presentable: "assignment.presentable",
  review: "assignment.review",
};

const PROMISE_LINE: Record<AssignmentKind, MessageKey> = {
  resume: "assignment.resume.promise",
  competitors: "assignment.competitors.promise",
  plan: "assignment.plan.promise",
  presentable: "assignment.presentable.promise",
  review: "assignment.review.promise",
};

/** The facts of the project that an assignment can cite. Everything verified, nothing drafted. */
export interface ProjectFacts {
  name: string;
  root: string;
  /** `summary ?? description`; it can come from a foreign README — it is neutralized when quoted. */
  summary: string | null;
  hasReadme: boolean;
  state: ProjectState;
  /** Entire months since the last commit. 0 with recent activity or no history. */
  monthsIdle: number;
  health: number;
  grade: string;
  stack: string[];
  outdated: number;
  direct: number;
  notices: number;
  risks: { code: string; count?: number }[];
  commands: { purpose: string; command: string }[];
  missingVars: string[];
  runtimes: { name: string; required: string }[];
  /**
   * What the mechanical critic saw the last time it read this folder.
   *
   * Empty means two things that here do not need to be distinguished —it has not been checked, or
   * it was checked and there was nothing— because both lead to the same place: there is no order
   * to offer. The difference does matter on the screen, and there it is read from the entire row.
   */
  critiques: { kind: string; claim: string; hint?: string; file?: string; line?: number }[];
}

/** What `factsOf` needs from the result of `getProject`. Structural on purpose. */
export interface AssignmentInput {
  project: {
    name: string;
    root: string;
    summary: string | null;
    description: string | null;
    summaryReadme: string | null;
    healthScore: number;
    healthGrade: string;
    lastCommitAt: Date | null;
    outdatedDeps: number;
    directDeps: number;
    runbook: unknown;
    gitVersioned: boolean | null;
    gitRemoteUrl: string | null;
    gitCommitCount: number | null;
  };
  work: Parameters<typeof workRisks>[0]["work"];
  technologies: { name: string; version: string | null; confidence: number }[];
  advisories: unknown[];
  /** The last mechanical check, just as `getProject` brings it. */
  review?: { findings: { kind: string; claim: string; hint?: string; file?: string; line?: number }[] } | undefined;
}

/**
 * From the record to the facts. The record and the route of the API call this with the same
 * `getProject`, so the assignment that is previewed and the one that is saved come from the same
 * place and cannot differ.
 */
export function factsOf(card: AssignmentInput): ProjectFacts {
  const { project } = card;
  const runbook = (project.runbook ?? {}) as Partial<Runbook>;
  const months = project.lastCommitAt
    ? Math.max(0, Math.floor((Date.now() - project.lastCommitAt.getTime()) / (30 * 86_400_000)))
    : 0;

  return {
    name: project.name,
    root: project.root,
    summary: project.summary ?? project.description,
    hasReadme: Boolean(project.summaryReadme),
    state: stateOf(project.lastCommitAt),
    monthsIdle: months,
    health: project.healthScore,
    grade: project.healthGrade,
    // The same threshold and the same cap as the 'describe' material: below 0.6 the stack is a
    // suspicion, and citing suspicions to an agent is asking them to repeat them.
    stack: card.technologies
      .filter((tech) => tech.confidence >= 0.6)
      .slice(0, 6)
      .map((tech) => (tech.version ? `${tech.name} ${tech.version}` : tech.name)),
    outdated: project.outdatedDeps,
    direct: project.directDeps,
    notices: card.advisories.length,
    risks: workRisks({
      versioned: project.gitVersioned,
      remoteUrl: project.gitRemoteUrl,
      commitCount: project.gitCommitCount,
      work: card.work,
    }).map((risk) => ({ code: risk.code, count: risk.count })),
    commands: (runbook.commands ?? []).map((c) => ({ purpose: c.purpose, command: c.command })),
    missingVars: runbook.missingEnv ?? [],
    runtimes: (runbook.runtimes ?? []).map((r) => ({ name: r.name, required: r.required })),
    critiques: card.review?.findings ?? [],
  };
}

/** The tasks that this project accepts today, in the order in which they are offered. */
export function projectAssignments(facts: ProjectFacts, locale: Locale): Assignment[] {
  const asked = { ...facts, critiques: facts.critiques.length };
  return ASSIGNMENT_KINDS.filter((kind) => applies(kind, asked)).map((kind) =>
    buildAssignment(kind, facts, locale),
  );
}

/**
 * Build any order, whether applicable or not: the API path uses it as is because between rendering
 * the record and pressing the button the project may have changed status, and then rejecting an
 * order that was being viewed on the screen would be a misleading error.
 */
export function buildAssignment(
  kind: AssignmentKind,
  facts: ProjectFacts,
  locale: Locale,
): Assignment {
  return {
    kind,
    title: t(locale, TITLE[kind]),
    promise: t(locale, PROMISE_LINE[kind]),
    body: BODIES[kind](facts, locale),
  };
}

/**
 * The title of an assignment written in the language requested.
 *
 * It is needed by whoever renders what was thrown: a row of `launches` without a task only stores
 * the class —`plan`, `review` —, and teaching «plan» alone is teaching the name of a variable.
 */
export function assignmentTitle(kind: AssignmentKind, locale: Locale): string {
  return t(locale, TITLE[kind]);
}

/** From a task title to the assignment that created it, look who you look at in whichever language. */
export function kindFromTitle(title: string): AssignmentKind | null {
  for (const kind of ASSIGNMENT_KINDS) {
    if (t("es", TITLE[kind]) === title || t("en", TITLE[kind]) === title) return kind;
  }
  return null;
}

/**
 * If this assignment makes sense in this project. Exported because the director of `next-moves.ts`
 * orders about these same four assignments and **cannot** propose one that does not apply here:
 * two copies of this rule would end up offering 'tell me what I am missing to resume it' in a
 * project that was touched yesterday.
 *
 * Ask only for the two fields it uses, not all of `ProjectFacts`, because the code that decides
 * what to propose does not have the stack or project commands available —those can only be known
 * by opening the project record— and requiring them would force the code to invent them.
 */
export function applies(
  kind: AssignmentKind,
  /*
    The findings come **singly** and not in a list, which is the only way for the two who ask to
    be able to answer. The file has the list in front because they are going to write it in the
    assignment; the director of `next-moves.ts` goes through the entire catalog and only brings
    the number — bringing twenty lists of findings to decide whether to offer a row would be
    paying attention to the detail only to discard it. What both share is the only question this
    asks: if there is anything.
   */
  facts: Pick<ProjectFacts, "state" | "hasReadme"> & { critiques: number },
): boolean {
  if (kind === "resume") return facts.state === "dormant" || facts.state === "paused";
  if (kind === "presentable") return !facts.hasReadme;
  /*
    And this only when there is something to fix. It is the only one of the five that cannot
    always be offered: the other four are questions that a project always allows —'what am I
    missing to resume it'— and this is a concrete list of things observed. Without findings, the
    task would be 'fix these zero things'.
   */
  if (kind === "review") return facts.critiques > 0;
  return true;
}

// ─── The writing ───────────────────────────────────────────────────────────────────────

function lineKind(facts: ProjectFacts, locale: Locale): string {
  if (!facts.summary) {
    return locale === "es" ? "el proyecto no trae descripción" : "the project ships no description";
  }
  return neutralizeInline(facts.summary, 280);
}

function fraseEstado(facts: ProjectFacts, locale: Locale): string {
  const months = facts.monthsIdle;
  if (locale === "es") {
    if (facts.state === "active") return "en marcha";
    if (facts.state === "no-git") return "sin historial git";
    return months >= 1
      ? `parado desde hace ${months === 1 ? "un mes" : `${months} meses`}`
      : "parado desde hace semanas";
  }
  if (facts.state === "active") return "actively worked on";
  if (facts.state === "no-git") return "no git history";
  return months >= 1
    ? `idle for ${months === 1 ? "a month" : `${months} months`}`
    : "idle for a few weeks";
}

/** Maintenance pending on a line, or `null` if the catalog does not indicate anything. */
function maintenance(facts: ProjectFacts, locale: Locale): string | null {
  const translate: Translate = (key, vars) => t(locale, key, vars);
  const reports: string[] = [];
  if (facts.outdated > 0) {
    reports.push(
      locale === "es"
        ? `${facts.outdated} de ${facts.direct} dependencias directas atrasadas`
        : `${facts.outdated} of ${facts.direct} direct dependencies outdated`,
    );
  }
  if (facts.notices > 0) {
    reports.push(
      locale === "es"
        ? facts.notices === 1
          ? "1 aviso de seguridad abierto"
          : `${facts.notices} avisos de seguridad abiertos`
        : facts.notices === 1
          ? "1 open security advisory"
          : `${facts.notices} open security advisories`,
    );
  }
  for (const risk of facts.risks) reports.push(riskText(translate, risk));
  return reports.length > 0 ? reports.join(" · ") : null;
}

function header(facts: ProjectFacts, locale: Locale): string {
  return locale === "es"
    ? `Encargo de panoma sobre «${neutralizeInline(facts.name, 80)}» (${neutralizeInline(facts.root, 200)}).`
    : `Assignment from panoma about “${neutralizeInline(facts.name, 80)}” (${neutralizeInline(facts.root, 200)}).`;
}

function context(facts: ProjectFacts, locale: Locale, extras: string[] = []): string[] {
  const es = locale === "es";
  const lines = [
    es ? "Lo que panoma sabe del proyecto:" : "What panoma knows about the project:",
    `- ${es ? "Qué es" : "What it is"}: ${lineKind(facts, locale)}`,
  ];
  if (facts.stack.length > 0) {
    /*
      Neutralized like the name and the root, and for the same reason: the version comes from the
      project's lockfile —`cleanVersion` lets `resolvedVersion` pass as is— and a lockfile is disk
      text that ends up in front of an agent with tools. The names come from the fixed catalog of
      `fingerprint`, but the line travels whole and is treated whole.
     */
    lines.push(`- ${es ? "Pila" : "Stack"}: ${neutralizeInline(facts.stack.join(", "), 200)}`);
  }
  lines.push(
    `- ${es ? "Estado" : "State"}: ${fraseEstado(facts, locale)} · ${
      es ? "salud" : "health"
    } ${facts.health}/100 (${facts.grade})`,
  );
  lines.push(...extras);
  return lines;
}

/**
 * How is the order in the queue closed, if there is a line.
 *
 * In a dedicated function because there are five tasks that need it and until now it was handled
 * by three: the review one did not write it and those of a loose finding —`critique-brief` and
 * `look-brief` — neither. Their rows remained open forever, because only an agent can close them
 * and no one had been asked to do so.
 *
 * Conditional on purpose: by 'open in your terminal' there is no queue at all, and asking an agent
 * to close something that doesn't exist is sending them to look for it.
 */
export function closingLine(locale: Locale, closing: string): string {
  return locale === "es"
    ? `- Si tienes las herramientas de panoma y este encargo está en la cola de tareas, cógelo (panoma_claim_task) y ciérralo al terminar (panoma_complete_task) ${closing}.`
    : `- If you have panoma's tools and this assignment is in the task queue, claim it (panoma_claim_task) and close it when done (panoma_complete_task) ${closing}.`;
}

function delivery(locale: Locale, archivo: string, closing: string): string[] {
  return locale === "es"
    ? [
        "Entrega:",
        `- Escribe el resultado en ${archivo} en la raíz del repo y haz commit.`,
        closingLine(locale, closing),
      ]
    : [
        "Deliverable:",
        `- Write the result to ${archivo} at the repo root and commit it.`,
        closingLine(locale, closing),
      ];
}

/**
 * How many findings of each type are included in the assignment.
 *
 * The same number that `panoma review` shows on the terminal, and therefore: twelve say the form
 * of the problem and the count gives its size. An order with one hundred and twenty lines of loose
 * colors cannot be read, it is closed.
 */
const CRITIQUES_SHOWN = 12;

/**
 * What fits in the body of a task before the agent channel cuts it off.
 *
 * It is the same number as `MAX.fullTaskBody` in `packages/mcp/src/format.ts`, and the fact that
 * both say the same is confirmed by a test: they are two files from two different packages that
 * talk about the same ceiling, and that is precisely the pair that separates without anyone
 * noticing.
 *
 * The limit per class was not enough. With the critic's four classes full, the entry reached
 * forty-eight lines of list and overflowed from here, so the agent received it cut — and what was
 * cut were the rules, which went at the end. Measured: with short findings the cut started around
 * twenty-seven; with a long statement and its route, around twelve. That’s why the limit counts
 * characters, not findings: what exceeds is not the quantity, it is what each one occupies.
 */
const BODY_LIMIT = 2400;

/** What is reserved for the line that accounts for what was left out. */
const LEFTOVER_ROOM = 60;

/**
 * The titles of each class, in the order in which the engine arranges them.
 *
 * Exported because the assignment of just one (`lib/critique-brief.ts`) has to say the same as
 * that of all twenty together: two write-ups of the same finding in two places are separated.
 */
export const CRITIQUE_LABEL: Record<string, { es: string; en: string }> = {
  "color-drift": {
    es: "Colores sueltos: un valor que aparece una vez al lado de otro casi idéntico que se usa en todo el proyecto",
    en: "Stray colours: a value used once next to a near-identical one used everywhere",
  },
  "radius-drift": {
    es: "Radios sueltos: dos esquinas que a la vista son la misma y están escritas distinto",
    en: "Stray radii: two corners that look the same and are written differently",
  },
  "image-no-alt": {
    es: "Imágenes que no dicen qué muestran",
    en: "Images that don’t say what they show",
  },
  "broken-link": {
    es: "Enlaces que apuntan a algo que no está",
    en: "Links pointing at something that isn’t there",
  },
};

/**
 * The list of what the mechanical critic saw, grouped by class.
 *
 * Everything that comes out of the disk —the reported value, the path, the track— goes through
 * `neutralizeInline` for the same reason as the summary of someone else's project: this ends up in
 * front of an agent with tools, and a file name is text that anyone wrote.
 */
function critiqueLines(facts: ProjectFacts, locale: Locale, budget: number): string[] {
  const es = locale === "es";
  const groups = new Map<string, ProjectFacts["critiques"]>();
  for (const finding of facts.critiques) {
    groups.set(finding.kind, [...(groups.get(finding.kind) ?? []), finding]);
  }

  const lines: string[] = [];
  /* What we have written so far, counting the line break that each line takes in front. */
  let gastado = 0;
  let fuera = 0;
  const cabe = (line: string) => gastado + line.length + 1 <= budget - LEFTOVER_ROOM;
  const escribir = (line: string) => {
    lines.push(line);
    gastado += line.length + 1;
  };

  for (const [kind, found] of groups) {
    const label = CRITIQUE_LABEL[kind];
    const titulo = `${label ? (es ? label.es : label.en) : kind} — ${found.length}:`;
    const entran = found.slice(0, CRITIQUES_SHOWN);
    const renglones = entran.map((finding) => {
      const where = finding.file
        ? ` · ${neutralizeInline(finding.file, 120)}${finding.line ? `:${finding.line}` : ""}`
        : "";
      const hint = finding.hint ? ` · ${neutralizeInline(finding.hint, 120)}` : "";
      return `- ${neutralizeInline(finding.claim, 80)}${hint}${where}`;
    });
    fuera += found.length - entran.length;

    /*
      The heading is only written if at least one finding fits behind it. Checking it separately
      —first the heading, then the rows— left announced and empty classes: two lines to say
      nothing, and the number next to it promising twelve that are not there.
     */
    const primero = renglones[0];
    if (primero === undefined || gastado + 1 + titulo.length + 1 + primero.length + 1 > budget - LEFTOVER_ROOM) {
      fuera += renglones.length;
      continue;
    }
    escribir("");
    escribir(titulo);
    for (const renglon of renglones) {
      if (!cabe(renglon)) {
        fuera += 1;
        continue;
      }
      escribir(renglon);
    }
  }

  if (fuera > 0) {
    lines.push("");
    lines.push(es ? `Y quedan fuera de esta lista: ${fuera}` : `And left off this list: ${fuera}`);
  }
  return lines;
}

const BODIES: Record<AssignmentKind, (facts: ProjectFacts, locale: Locale) => string> = {
  review(facts, locale) {
    const es = locale === "es";
    const fijo = [
      header(facts, locale),
      "",
      es
        ? "Esto lo vio panoma leyendo la carpeta: sin abrir el proyecto, sin ejecutarlo y sin modelo. Cada línea es un hecho comprobable, no una opinión."
        : "panoma saw this by reading the folder: without opening the project, without running it and without a model. Every line is a checkable fact, not an opinion.",
      "",
      /*
        The rules go BEFORE the list, and it is the only thing in this body that cannot be moved.
        The agent channel cuts to 2400 characters, and here the list is what grows: with the rules
        at the end, the first thing that was lost was "don't touch anything that isn't on the
        list"—in the only one of the five tasks that edits code. Ahead, what is lost are findings,
        which is a cut that announces itself and does not change what the agent can do.
       */
      ...(es
        ? [
            "El encargo: arregla lo de la lista de abajo y nada más.",
            "- Un color o un radio suelto se unifica con el que sí usa el proyecto, **salvo que estuviera puesto a propósito** —un estado, un aviso, una marca—: si lo estaba, déjalo como está y dilo en el resumen.",
            "- Un `alt` dice qué muestra la imagen. Si la imagen es decorativa y no aporta nada, `alt=\"\"` es la respuesta correcta.",
            "- Un enlace roto se arregla apuntando a donde esté el fichero, o se quita. Si no encuentras a dónde debería apuntar, déjalo y dilo.",
            "- Si algo de la lista ya no está en el código, sigue con lo siguiente y dilo: la revisión es de la última vez que cambió esta carpeta, no de este minuto.",
            "- No toques nada que no esté en la lista.",
            "- Haz commit de lo que arregles.",
            closingLine(locale, "diciendo qué tocaste y qué dejaste como estaba"),
          ]
        : [
            "The assignment: fix what is on the list below and nothing else.",
            "- A stray colour or radius is unified with the one the project does use, **unless it was there on purpose** —a state, a warning, a brand—: if it was, leave it and say so in the summary.",
            "- An `alt` says what the image shows. If the image is decorative and adds nothing, `alt=\"\"` is the right answer.",
            "- A broken link is fixed by pointing at wherever the file lives, or removed. If you cannot tell where it should point, leave it and say so.",
            "- If something on the list is no longer in the code, move on and say so: the review is from the last time this folder changed, not from this minute.",
            "- Do not touch anything that is not on the list.",
            "- Commit what you fix.",
            closingLine(locale, "stating what you touched and what you left alone"),
          ]),
    ].join("\n");
    /*
      The list is added with whatever space is left: the top part is the one that cannot be lost,
      so it is measured first and the list is adjusted to what remains.
     */
    return [fijo, ...critiqueLines(facts, locale, BODY_LIMIT - fijo.length)].join("\n");
  },

  competitors(facts, locale) {
    const es = locale === "es";
    return [
      header(facts, locale),
      "",
      ...context(facts, locale),
      "",
      ...(es
        ? [
            "El encargo: averigua contra qué compite este proyecto hoy.",
            "1. Busca en la web productos que resuelvan lo mismo y sigan vivos: nombre, qué hacen, precio y tracción visible (estrellas, descargas, reseñas, actividad reciente).",
            "2. Busca también los muertos o abandonados, y de qué murieron: sin usuarios, sin modelo, se los comió una plataforma.",
            "3. Compara: qué hace este proyecto que ninguno cubre, y qué dan todos por hecho que a este le falta.",
            "4. Cierra con un veredicto honesto: si la idea sigue viva, para quién, y qué habría que cambiar para competir. Sin ánimo de vendedor — si el hueco no existe, dilo.",
          ]
        : [
            "The assignment: find out what this project competes against today.",
            "1. Search the web for products that solve the same thing and are still alive: name, what they do, pricing, and visible traction (stars, downloads, reviews, recent activity).",
            "2. Also find the dead and abandoned ones, and what killed them: no users, no business model, eaten by a platform.",
            "3. Compare: what does this project do that none of them cover, and what do they all take for granted that this one lacks.",
            "4. Close with an honest verdict: whether the idea is still alive, for whom, and what would have to change to compete. No salesmanship — if the gap doesn't exist, say so.",
          ]),
      "",
      ...delivery(
        locale,
        es ? "COMPETIDORES.md" : "COMPETITORS.md",
        es ? "con el veredicto en una frase" : "with the verdict in one sentence",
      ),
    ].join("\n");
  },

  plan(facts, locale) {
    const es = locale === "es";
    const pending = maintenance(facts, locale);
    const extras = pending
      ? [`- ${es ? "Mantenimiento pendiente" : "Pending maintenance"}: ${pending}`]
      : [];
    return [
      header(facts, locale),
      "",
      ...context(facts, locale, extras),
      "",
      ...(es
        ? [
            "El encargo: léete el código y hazme un plan de mejora priorizado.",
            "1. Recorre el proyecto y apunta lo que encuentres de verdad: deuda que muerde, código muerto, tests que faltan donde duele, docs que mienten.",
            "2. Cruza lo tuyo con los hechos de arriba: lo que panoma mide ya está contado; tu valor es lo que no se ve desde fuera.",
            "3. Ordena por valor partido esfuerzo y quédate con pocos puntos: cada uno con el archivo o la zona concreta, qué hacer y por qué ese antes que el resto. Nada de lista de deseos.",
          ]
        : [
            "The assignment: read the code and draft me a prioritized improvement plan.",
            "1. Walk the project and note what you actually find: debt that bites, dead code, missing tests where it hurts, docs that lie.",
            "2. Cross your findings with the facts above: what panoma measures is already counted; your value is what can't be seen from outside.",
            "3. Order by value over effort and keep it short: each item with the concrete file or area, what to do, and why that one before the rest. No wish lists.",
          ]),
      "",
      ...delivery(locale, "PLAN.md", es ? "diciendo el primer paso" : "stating the first step"),
    ].join("\n");
  },

  resume(facts, locale) {
    const es = locale === "es";
    const startup: string[] = [];
    if (facts.commands.length > 0) {
      const list = facts.commands
        .slice(0, 4)
        .map((c) => `«${neutralizeInline(c.command, 120)}»`)
        .join(", ");
      startup.push(`- ${es ? "Comandos apuntados" : "Commands on file"}: ${list}`);
    }
    if (facts.missingVars.length > 0) {
      const list = facts.missingVars
        .slice(0, 8)
        .map((name) => neutralizeInline(name, 60))
        .join(", ");
      startup.push(`- ${es ? "Variables de entorno que faltan" : "Missing env vars"}: ${list}`);
    }
    if (facts.runtimes.length > 0) {
      const list = facts.runtimes
        .slice(0, 4)
        .map((r) => neutralizeInline(`${r.name} ${r.required}`, 60))
        .join(", ");
      startup.push(`- ${es ? "Pide" : "Requires"}: ${list}`);
    }
    if (startup.length === 0) {
      startup.push(
        `- ${
          es
            ? "Cómo se arranca: no hay nada apuntado — averiguarlo es parte del encargo"
            : "How to start it: nothing on file — finding out is part of the assignment"
        }`,
      );
    }
    return [
      header(facts, locale),
      "",
      ...context(facts, locale, startup),
      "",
      ...(es
        ? [
            "El encargo: averigua qué hace falta para volver a trabajar aquí mañana.",
            "1. Intenta instalarlo y arrancarlo de cero siguiendo lo apuntado; anota cada cosa que falle o falte (versiones, variables, servicios).",
            "2. Mira en qué se quedó el trabajo: últimos commits, ramas sin fusionar, TODOs recientes.",
            "3. Escribe la lista mínima para estar productivo otra vez: qué instalar, qué configurar y por dónde seguir, en orden.",
          ]
        : [
            "The assignment: find out what it takes to work here again tomorrow.",
            "1. Try to install and start it from scratch following what's on file; note everything that fails or is missing (versions, env vars, services).",
            "2. Look at where the work left off: latest commits, unmerged branches, recent TODOs.",
            "3. Write the minimal list to be productive again: what to install, what to configure, and where to pick up, in order.",
          ]),
      "",
      ...delivery(
        locale,
        es ? "RETOMAR.md" : "RESUMING.md",
        es ? "con el primer obstáculo real" : "with the first real obstacle",
      ),
    ].join("\n");
  },

  presentable(facts, locale) {
    const es = locale === "es";
    const extras = [
      `- ${
        es
          ? "README: no hay ninguno que cuente el proyecto, o no dice nada citable"
          : "README: there is none that tells the story, or it says nothing quotable"
      }`,
    ];
    return [
      header(facts, locale),
      "",
      ...context(facts, locale, extras),
      "",
      ...(es
        ? [
            "El encargo: que alguien que llegue de fuera lo entienda en dos minutos.",
            "1. Escribe un README honesto: qué es, para quién, cómo se instala y arranca, y en qué estado real está. No vendas lo que no hay.",
            "2. Comprueba que la forma de arrancarlo que escribas funciona de verdad; si no arranca, documenta el estado tal cual.",
            "3. Si no tiene licencia, no elijas una: deja al final del README una nota con dos opciones y qué implica cada una, para que lo decida el humano.",
            "",
            "Entrega:",
            "- Commitea el README (es la entrega: no hace falta otro archivo).",
            closingLine(locale, "diciendo qué faltaba"),
          ]
        : [
            "The assignment: make it so an outsider gets it in two minutes.",
            "1. Write an honest README: what it is, who it's for, how to install and start it, and what state it's really in. Don't sell what isn't there.",
            "2. Verify that the startup instructions you write actually work; if it doesn't start, document the state as it is.",
            "3. If it has no license, don't pick one: leave a note at the end of the README with two options and what each implies, for the human to decide.",
            "",
            "Deliverable:",
            "- Commit the README (that is the deliverable: no extra file needed).",
            closingLine(locale, "stating what was missing"),
          ]),
    ].join("\n");
  },
};
