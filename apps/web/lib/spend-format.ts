import type { Locale, MessageKey } from "./i18n";

/*
  The half of the spend screen that the browser may import.

  `spend-settings.ts` reads a file under `PANOMA_HOME`, so anything that imports it at runtime
  stays on the server; the client form still has to format money and tokens and to compute the
  cost of a row while a rate is being typed. Everything here is arithmetic, `Intl`, and the map
  from a family or a kind to its dictionary key — no disk, no database, nothing that decides.
 */

/** What the owner pays per million tokens for one provider/model pair. Mirrors `ModelRate`. */
export interface RateLike {
  input: number;
  output: number;
}

/** The `Intl` tag for each interface language, as the twin page already chooses it. */
export function localeTag(locale: Locale): string {
  return locale === "es" ? "es-ES" : "en-US";
}

/**
 * Money in the viewer's language, with up to four decimals: a day of small calls comes to
 * fractions of a cent, and «$0.01» for a spend of 0.006 would round the only figure the owner came
 * to read. Any three capital letters are well formed for `Intl`, but a code it still refuses falls
 * to the plain figure with the code behind it instead of to an error on the screen.
 */
export function formatMoney(value: number, currency: string, locale: Locale): string {
  try {
    return new Intl.NumberFormat(localeTag(locale), {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** A token count with its grouping separators: «1,234,567» reads, «1234567» is counted. */
export function formatTokens(n: number, locale: Locale): string {
  return new Intl.NumberFormat(localeTag(locale)).format(n);
}

/**
 * What one row of the ledger costs at a rate, in the rate's currency. Null without a rate:
 * unknown is not zero, the same rule the tokens follow in `packages/db`.
 */
export function rowCost(
  row: { input: number; output: number },
  rate: RateLike | null | undefined,
): number | null {
  if (!rate) return null;
  return (row.input / 1_000_000) * rate.input + (row.output / 1_000_000) * rate.output;
}

/** The width of a bar, capped at the whole track: a cap already spent stays at 100. */
export function share(used: number, cap: number): number {
  if (cap <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, Math.round((used / cap) * 100));
}

/** The families, in the order of `BUDGET_FAMILIES`, as literal keys so the client can name them. */
export const FAMILY_KEY = {
  read: "spend.family.read",
  look: "spend.family.look",
  memory: "spend.family.memory",
  ask: "spend.family.ask",
  rehearse: "spend.family.rehearse",
  episodes: "spend.family.episodes",
  card: "spend.family.card",
  app: "spend.family.app",
  handoff: "spend.family.handoff",
} as const satisfies Record<string, MessageKey>;

export type FamilyName = keyof typeof FAMILY_KEY;

/** One line each about what the cap holds back, from the table in `docs/budgets.md`. */
export const FAMILY_HINT_KEY = {
  read: "spend.familyHint.read",
  look: "spend.familyHint.look",
  memory: "spend.familyHint.memory",
  ask: "spend.familyHint.ask",
  rehearse: "spend.familyHint.rehearse",
  episodes: "spend.familyHint.episodes",
  card: "spend.familyHint.card",
  app: "spend.familyHint.app",
  handoff: "spend.familyHint.handoff",
} as const satisfies Record<FamilyName, MessageKey>;

/**
 * The kinds the organs write. A kind that is not here —a catalog newer than this screen—
 * is shown by its raw name rather than hidden, which is what `kindKey` returns undefined for.
 */
const KIND_KEY: Record<string, MessageKey> = {
  look: "spend.kind.look",
  distill: "spend.kind.distill",
  classify: "spend.kind.classify",
  synthesize: "spend.kind.synthesize",
  memory: "spend.kind.memory",
  ask: "spend.kind.ask",
  rehearse: "spend.kind.rehearse",
  episodes: "spend.kind.episodes",
  describe: "spend.kind.describe",
  review: "spend.kind.review",
  probe: "spend.kind.probe",
  app: "spend.kind.app",
  handoff: "spend.kind.handoff",
};

export function kindKey(kind: string): MessageKey | undefined {
  return KIND_KEY[kind];
}

/** Who decided a cap, as the badge says it. */
export const SOURCE_KEY = {
  factory: "spend.source.factory",
  file: "spend.source.file",
  env: "spend.source.env",
  paused: "spend.source.paused",
} as const satisfies Record<string, MessageKey>;

/** The four accounts a line can detail under its own name. Both `FamilyLine` and `KindLine` carry them. */
export interface SpendDetail {
  input: number;
  output: number;
  unmetered: number;
  images: number;
}

/** Hide empty token and image details while keeping unmetered calls visible. */
export function hasDetail(row: SpendDetail): boolean {
  return row.input > 0 || row.output > 0 || row.unmetered > 0 || row.images > 0;
}

/** An unmetered zero is unknown; a measured zero or known output is still usable. */
export function hasNoTokenMeasurement(row: { calls: number; unmetered: number; input: number; output: number }): boolean {
  return row.calls > 0 && row.unmetered === row.calls && row.input + row.output === 0;
}
