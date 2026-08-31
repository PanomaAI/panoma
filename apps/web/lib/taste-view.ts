import type { MessageKey } from "@/lib/i18n";

/*
  What the portrait screen needs from a belief, and how it is read without trusting it.
  Live here and not inside the component according to the usual rule in this folder: the web is
  tested through its helpers and never by starting a server. And in this case, there is something
  specific to test — `beliefs.citations` and `beliefs.support` are `jsonb` columns, meaning they
  arrive as `unknown` and their form is a convention, not a contract. A row written by a previous
  version, or manually with `psql` during an afternoon of debugging, might not contain what this
  screen expects.
  What doesn't fit is left out and the belief comes out without that quote. It is worse than with
  it and much better than the alternative: a screen that doesn't load because of a strange row is
  a screen in which nothing can be directed, and directing is the only thing this screen does.
  ── The three badges, and why they are calculated on the server ──────────────────────
  A belief is **signed** (you made it yours), **standing** (the machine inferred it and the
  evidence supports it, so your agents read it) or **in formation** (the machine inferred it and
  it is not yet supported, so it doesn’t leave this screen). The ground rule lives in
  `@panoma/db`, which drags along drizzle and PGlite: importing it from a client component would
  break the packaging, which is exactly the fault that caused a 500 in §2s. So the badge is
  resolved here, on the server, and travels as data.
 */

/** A quote: your words, with when and where you said them. */
/**
 * The name with which each sown subject is taught.
 *
 * Live here and not inside the portrait screen because there are two screens that need it — the
 * portrait and a project card, which shows the phrases that govern it — and one of them is
 * server-side and the other client-side. Copied on both, the first material that is renamed leaves
 * two names for the same thing in the same session of someone.
 *
 * The coined term does not exist and should not: a subject that is invented on a Tuesday has no
 * translation, and teaching it as it is — in lowercase, as it was written — is more honest than
 * inventing one for it.
 */
export const TOPIC_NAME: Record<string, MessageKey> = {
  design: "twin.topicDesign",
  frontend: "twin.topicFrontend",
  backend: "twin.topicBackend",
  cli: "twin.topicCli",
  testing: "twin.topicTesting",
  copy: "twin.topicCopy",
  workflow: "twin.topicWorkflow",
  tooling: "twin.topicTooling",
  data: "twin.topicData",
  other: "twin.topicOther",
};

/** The key to the name of a subject, or nothing if it is coined and must be taught as is. */
export function topicKey(topic: string): MessageKey | undefined {
  return TOPIC_NAME[topic];
}

export interface Citation {
  verdictId: string;
  quote: string;
  at: string;
  project?: string;
}

/** In what state a belief is taught. See header. */
export type BeliefBadge = "signed" | "standing" | "forming";

export interface BeliefView {
  id: string;
  topic: string;
  statement: string;
  badge: BeliefBadge;
  citations: Citation[];
  /** How much evidence supports it: it is always taught, with a badge or without it. */
  support: { observations: number; projects: number; days: number };
  /** The project to which it is restricted, by its name. Absent is 'in everything you do'. */
  scope?: string;
  /**
   * The project to which one **could** limit: the one from which all its visible evidence comes.
   *
   * It exists because scope is a piece of data and not a column with memory. At birth, the
   * synthesis limits a belief when all its evidence comes from the same place; if later the person
   * applies it to everything they do, the row loses its identity and with it the way back. Without
   * this, expanding the scope would be a gesture of going and not returning.
   *
   * It can be deduced from the quotes that the belief is kept: if they all mention the same
   * project, that is the candidate. It is what the person has in front of them when opening the
   * drawer, so the button does not promise anything that the tests do not say.
   */
  learnedIn?: { identity: string; name: string };
  /**
   * Only in one proposal: what the signed beliefs that it wants to replace say today.
   *
   * Whole and all, which is the same rule as the mergers from the previous increment: accepting a
   * proposal makes phrases that the person signed disappear from the portrait, and hiding them
   * would be the silent compaction that `taste.ts` prohibits, moved one step further. The question
   * is also not 'do you like this phrase?' but 'does this say what those said?', and that can only
   * be answered with both parts in front.
   */
  supersedes?: string[];
  /** When it last changed. ISO 8601: the summary compares against the last visit. */
  updatedAt: string;
}

/** A row of `beliefs`, with the columns `jsonb` still unchecked. */
export interface BeliefRowish {
  id: string;
  topic: string;
  statement: string;
  state: string;
  identity?: string | null;
  citations: unknown;
  support: unknown;
  supersedes?: string[];
  updatedAt: Date | string;
}

export function asBelief(
  row: BeliefRowish,
  options: {
    names?: Record<string, string>;
    /** From name to identity, to deduce which project it could be limited to. See `learnedIn`. */
    identities?: Record<string, string>;
    /** If the evidence supports it. It is decided by `standsUp` on the server: see header. */
    stands?: boolean;
    /** What the signed ones they point to say, when this is a proposal. */
    supersedes?: string[];
  } = {},
): BeliefView {
  const names = options.names ?? {};
  const scope = row.identity ? names[row.identity] : undefined;
  const badge: BeliefBadge =
    row.state === "signed" ? "signed" : options.stands === true ? "standing" : "forming";
  const citations = asCitations(row.citations);

  return {
    id: row.id,
    topic: row.topic,
    statement: row.statement,
    badge,
    support: asSupport(row.support),
    ...(scope ? { scope } : {}),
    ...(scope ? {} : learnedIn(citations, options.identities ?? {})),
    ...(options.supersedes && options.supersedes.length > 0
      ? { supersedes: options.supersedes }
      : {}),
    updatedAt:
      typeof row.updatedAt === "string" ? row.updatedAt : row.updatedAt.toISOString(),
    citations,
  };
}

/**
 * The project from which all the visible evidence comes, if it is a single one and is known which.
 *
 * Three reasons not to return anything, and all three go in the same direction: no citations,
 * citations from more than one project, or a name that is no longer in the catalog. In all three,
 * the screen ends up without the narrow-down button, which is better than a button that narrows
 * down to the wrong project — narrowing down incorrectly hides a belief from the one hundred
 * eleven places where it was valid.
 */
function learnedIn(
  citations: Citation[],
  identities: Record<string, string>,
): { learnedIn?: { identity: string; name: string } } {
  const projects = new Set(citations.map((cite) => cite.project ?? ""));
  if (projects.size !== 1) return {};
  const name = [...projects][0]!;
  const identity = identities[name];
  return identity ? { learnedIn: { identity, name } } : {};
}

/**
 * The evidence accounts, defended from a column that can bring anything.
 *
 * Zeros are the sure failure: a belief without readable accounts is taught as if it had no
 * evidence, that is, 'in formation,' meaning it does not come off the screen. On the contrary
 * —inventing three observations in case of doubt— I would publish it in the `AGENTS.md` of one
 * hundred twelve projects for a wrongly written row.
 */
function asSupport(value: unknown): { observations: number; projects: number; days: number } {
  const empty = { observations: 0, projects: 0, days: 0 };
  if (typeof value !== "object" || value === null) return empty;
  const row = value as Record<string, unknown>;
  const count = (key: string) => (typeof row[key] === "number" ? Math.max(0, row[key]) : 0);
  return { observations: count("observations"), projects: count("projects"), days: count("days") };
}

function asCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((one) => {
    if (typeof one !== "object" || one === null) return [];
    const cite = one as Record<string, unknown>;
    const quote = typeof cite["quote"] === "string" ? cite["quote"] : undefined;
    const at = typeof cite["at"] === "string" ? cite["at"] : undefined;
    /*
      Without a citation or without a date there is no evidence to show. Both are mandatory and
      not just one of the two: the phrase in quotation marks without a date cannot be placed —
      «you said this once» is not evidence — and a date without a phrase says nothing at all.
     */
    if (!quote || !at) return [];
    const project = typeof cite["project"] === "string" ? cite["project"] : undefined;
    return [
      {
        /*
          It is only used as a React key, so what is needed is for it to be stable and different
          among siblings, not to be the real identifier. Phrase and date together achieve this
          without inventing anything; the index does not, because it changes position as soon as a
          previous quote drops.
         */
        verdictId: typeof cite["verdictId"] === "string" ? cite["verdictId"] : `${quote}${at}`,
        quote,
        at,
        ...(project ? { project } : {}),
      },
    ];
  });
}

/**
 * An appointment date in the viewer's format.
 *
 * Without a library and without `Intl`: they are two formats, they are written in four lines, and
 * `Intl` in a server component renders with the process timezone and on the client with the
 * browser's — two different dates for the same appointment, and the hydration complains.
 */
export function citationDay(at: string, locale: "es" | "en"): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at.slice(0, 10);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return locale === "en"
    ? `${date.getFullYear()}-${month}-${day}`
    : `${day}/${month}/${date.getFullYear()}`;
}
