import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { panomaPath } from "@panoma/core";

/*
  The daily budgets, in one place, and the file where the owner moves them.

  Until 6-Sep-2026 each organ read its own environment variable at its own call site — six
  functions with the same four-line body scattered over six files — and the only way to lower a
  cap was to restart the server with a variable exported. The owner asked for two things that
  variable could not give: a screen that says what panoma spends, and a control over the caps
  without leaving the browser. This file is the second half. The screen reads it; the organs ask
  it, at request time, how many calls fit today.

  ── Why a file under PANOMA_HOME and not a table ────────────────────────────────────────────
  A cap is a preference of this machine, not a fact about the portfolio: the same reason
  `visit.json` and `roots.json` live here and not in the catalog. It needs no migration, the
  routes read it without opening a transaction, and it survives a catalog rebuilt from disk.
  With `DATABASE_URL` (several people, one catalog) the file describes the server's own home,
  which is where the calls are made from — that is the right place for the brake.

  ── Precedence: pause, then environment, then file, then factory ─────────────────────────────
  The pause wins over everything, because it is the one control whose failure direction is not
  negotiable: a switch that says "stop" and does not stop is worse than no switch. Then the
  environment, because an exported variable is the more recent and more deliberate decision —
  the same rule the credentials follow in `docs/ai-providers.md` — and it is what makes an
  install behave the same on a development machine and in CI without touching a file. Then the
  file, which is what the screen writes. Then the factory value.

  A value that cannot be read falls to the factory value and never to "no limit": the contract of
  every brake in this repository, stated in `docs/budgets.md`. Zero is a value, and it switches
  the organ off.
 */

/**
 * The families a cap holds back. Several kinds in the ledger can answer to one family: the three
 * reads are one chained job, and the two buttons of the project card are one gesture repeated.
 */
export type BudgetFamily = "read" | "look" | "memory" | "ask" | "rehearse" | "episodes" | "card" | "app" | "handoff";

export const BUDGET_FAMILIES = [
  "read",
  "look",
  "memory",
  "ask",
  "rehearse",
  "episodes",
  "card",
  "app",
  // The model-written digest of one conversation about to be handed off; one action, by the person.
  "handoff",
] as const satisfies readonly BudgetFamily[];

/** Out of the box. The reasons behind each number are in `docs/budgets.md`. */
export const FACTORY_CAPS: Record<BudgetFamily, number> = {
  read: 300,
  look: 20,
  memory: 12,
  ask: 20,
  rehearse: 20,
  episodes: 20,
  card: 100,
  app: 20,
  // One conversation, one action, by the person; ten covers a bad day and stops a loop.
  handoff: 10,
};

/** The variable that overrides each family. `PANOMA_DISTILL_BUDGET` keeps its historical name. */
export const BUDGET_ENV: Record<BudgetFamily, string> = {
  read: "PANOMA_READ_BUDGET",
  look: "PANOMA_LOOK_BUDGET",
  memory: "PANOMA_DISTILL_BUDGET",
  ask: "PANOMA_ASK_BUDGET",
  rehearse: "PANOMA_REHEARSE_BUDGET",
  episodes: "PANOMA_EPISODE_BUDGET",
  card: "PANOMA_CARD_BUDGET",
  app: "PANOMA_APP_BUDGET",
  handoff: "PANOMA_HANDOFF_BUDGET",
};

/**
 * Which ledger kinds each family counts. These are the exact strings the organs write in
 * `model_calls.kind`; a renamed kind stops braking in silence, which is why `reads.test.ts` reads
 * the route sources for them.
 */
export const FAMILY_KINDS: Record<BudgetFamily, readonly string[]> = {
  read: ["distill", "classify", "synthesize"],
  look: ["look"],
  memory: ["memory"],
  ask: ["ask"],
  rehearse: ["rehearse"],
  episodes: ["episodes"],
  card: ["describe", "review"],
  app: ["app"],
  handoff: ["handoff"],
};

/**
 * Kinds that are written down and held back by nothing: the probe that proves a credential works
 * asks for one word and cannot run on its own.
 */
export const UNBUDGETED_KINDS = ["probe"] as const;

/** The family a ledger kind answers to, or undefined for the unbudgeted ones. */
export function familyOf(kind: string): BudgetFamily | undefined {
  return BUDGET_FAMILIES.find((family) => FAMILY_KINDS[family].includes(kind));
}

/** A cap above this is a typo, not a decision. */
export const MAX_CAP = 100_000;

export const DEFAULT_CURRENCY = "USD";

/**
 * What the owner pays per million tokens for one provider/model pair, in `currency`.
 *
 * The rate is the owner's, copied from their own bill: there is no rate table in this repository,
 * and there must not be one — a shipped price goes stale and a stale price is worse than none
 * (`docs/budgets.md`). Without a rate, the screen shows tokens and no money.
 */
export interface ModelRate {
  input: number;
  output: number;
}

/**
 * How much of a screenshot the critic gets to see.
 *
 * `full` sends the capture as it is, which is what panoma did from the first day and still does
 * unless somebody says otherwise. `fit` shrinks it to {@link SHOT_MAX_EDGE} on the long edge
 * before it travels.
 *
 * It is a spending decision and it lives here for that reason: an image is charged by its pixels,
 * and a full-screen capture on a modern laptop carries four times the pixels of what its owner
 * actually sees, because the screen doubles them. But it is also a decision about **what gets
 * judged**, which is why it is a choice and not a default: `screenshot.ts` refused to shrink
 * silently for exactly that reason, and the answer to that refusal is not to shrink behind
 * anyone's back — it is to let the person choose, say so before spending, and say so again on the
 * receipt.
 */
export type ShotPolicy = "full" | "fit";

/**
 * The long edge a reduced capture is fitted to, in pixels.
 *
 * 1,568 and not a rounder number: it is the edge above which the model that reads the capture
 * stops charging more for it, so it is the last size that costs what a smaller one would. Below
 * it a critic starts losing what it is there to see —a caption in small type, a one-pixel
 * misalignment— and above it the extra pixels are paid for and thrown away.
 */
export const SHOT_MAX_EDGE = 1_568;

export interface SpendSettings {
  /** Absent families fall to the environment or the factory value. */
  caps: Partial<Record<BudgetFamily, number>>;
  /** Keyed by `rateKey(provider, model)`. */
  rates: Record<string, ModelRate>;
  /** ISO 4217, three capital letters. Only for display. */
  currency: string;
  /** Every cap reads as zero while this is on. */
  paused: boolean;
  /** What the critic is shown. `full` is what panoma has always done. */
  shots: ShotPolicy;
}

export function emptySpendSettings(): SpendSettings {
  return { caps: {}, rates: {}, currency: DEFAULT_CURRENCY, paused: false, shots: "full" };
}

/** The ledger stores provider and model apart; the rate is written against the pair. */
export function rateKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

export function spendSettingsPath(): string {
  return panomaPath("spend.json");
}

const CURRENCY = /^[A-Z]{3}$/;
const MAX_RATE_KEY = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCap(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_CAP;
}

function isRate(value: unknown): value is ModelRate {
  if (!isRecord(value)) return false;
  const { input, output } = value;
  return typeof input === "number" && Number.isFinite(input) && input >= 0
    && typeof output === "number" && Number.isFinite(output) && output >= 0;
}

function isRateKey(key: string): boolean {
  return key.length > 0 && key.length <= MAX_RATE_KEY && key.includes("/");
}

/**
 * Read the file tolerantly: what is understood is kept, what is not is dropped.
 *
 * Tolerant because it is read on every paid request, and a single bad entry written by hand must
 * not turn every cap into the factory one. The strict half is `patchSpendSettings`, which faces a
 * person typing in a form and owes them an error instead of silence.
 */
export function parseSpendSettings(raw: unknown): SpendSettings | undefined {
  if (!isRecord(raw)) return undefined;
  const settings = emptySpendSettings();
  if (isRecord(raw["caps"])) {
    for (const family of BUDGET_FAMILIES) {
      const cap = raw["caps"][family];
      if (isCap(cap)) settings.caps[family] = cap;
    }
  }
  if (isRecord(raw["rates"])) {
    for (const [key, rate] of Object.entries(raw["rates"])) {
      if (isRateKey(key) && isRate(rate)) settings.rates[key] = { input: rate.input, output: rate.output };
    }
  }
  if (typeof raw["currency"] === "string" && CURRENCY.test(raw["currency"])) settings.currency = raw["currency"];
  if (raw["paused"] === true) settings.paused = true;
  if (raw["shots"] === "fit") settings.shots = "fit";
  return settings;
}

/**
 * The settings on disk. `broken` says the file exists and could not be read as settings, so the
 * screen can say so instead of painting factory values as if they were chosen.
 */
export async function readSpendSettings(): Promise<{ settings: SpendSettings; broken: boolean }> {
  let text: string;
  try {
    text = await readFile(spendSettingsPath(), "utf8");
  } catch {
    // No file yet: nothing was ever chosen, so nothing is broken.
    return { settings: emptySpendSettings(), broken: false };
  }
  try {
    const settings = parseSpendSettings(JSON.parse(text));
    return settings ? { settings, broken: false } : { settings: emptySpendSettings(), broken: true };
  } catch {
    return { settings: emptySpendSettings(), broken: true };
  }
}

export async function writeSpendSettings(settings: SpendSettings): Promise<void> {
  const target = spendSettingsPath();
  await mkdir(dirname(target), { recursive: true });
  // Atomic and with a unique temporary name, for the reason `visit.json` learned the hard way: Next
  // renders several times at once, and two writers on the same temporary file crash each other.
  const tempPath = `${target}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tempPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
  await rename(tempPath, target);
}

export type SettingsFault = "body" | "caps" | "rates" | "currency" | "paused" | "shots";

/**
 * Apply what a form sent over the settings on disk. Strict: any field that is present and wrong
 * refuses the whole patch, naming the field, so the person fixes it instead of finding out at
 * midnight that a cap fell to the factory value.
 *
 * `caps` replaces family by family: a family sent as `null` goes back to the environment or the
 * factory value. `rates` replaces the whole map: the screen always sends every row it shows.
 */
export function patchSpendSettings(
  current: SpendSettings,
  patch: unknown,
): { settings: SpendSettings } | { fault: SettingsFault } {
  if (!isRecord(patch)) return { fault: "body" };
  const next: SpendSettings = {
    caps: { ...current.caps },
    rates: { ...current.rates },
    currency: current.currency,
    paused: current.paused,
    shots: current.shots,
  };
  if (patch["caps"] !== undefined) {
    if (!isRecord(patch["caps"])) return { fault: "caps" };
    for (const [key, cap] of Object.entries(patch["caps"])) {
      const family = BUDGET_FAMILIES.find((one) => one === key);
      if (!family) return { fault: "caps" };
      if (cap === null) {
        delete next.caps[family];
        continue;
      }
      if (!isCap(cap)) return { fault: "caps" };
      next.caps[family] = cap;
    }
  }
  if (patch["rates"] !== undefined) {
    if (!isRecord(patch["rates"])) return { fault: "rates" };
    const rates: Record<string, ModelRate> = {};
    for (const [key, rate] of Object.entries(patch["rates"])) {
      if (!isRateKey(key)) return { fault: "rates" };
      if (rate === null) continue;
      if (!isRate(rate)) return { fault: "rates" };
      rates[key] = { input: rate.input, output: rate.output };
    }
    next.rates = rates;
  }
  if (patch["currency"] !== undefined) {
    if (typeof patch["currency"] !== "string" || !CURRENCY.test(patch["currency"])) return { fault: "currency" };
    next.currency = patch["currency"];
  }
  if (patch["paused"] !== undefined) {
    if (typeof patch["paused"] !== "boolean") return { fault: "paused" };
    next.paused = patch["paused"];
  }
  if (patch["shots"] !== undefined) {
    if (patch["shots"] !== "full" && patch["shots"] !== "fit") return { fault: "shots" };
    next.shots = patch["shots"];
  }
  return { settings: next };
}

/** What the critic is shown, read at request time like the caps. */
export async function shotPolicy(): Promise<ShotPolicy> {
  const { settings } = await readSpendSettings();
  return settings.shots;
}

/**
 * The contract every brake shares, in one body: empty → the fallback; not an integer, or
 * negative → the fallback, never "no limit"; zero is a value and switches the organ off. The
 * notation is not judged — `1e3` is a thousand.
 */
export function capFrom(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const limit = Number(value.trim());
  if (!Number.isInteger(limit) || limit < 0) return fallback;
  return limit;
}

export type CapSource = "paused" | "env" | "file" | "factory";

export interface DailyCap {
  /** How many calls of this family fit today. */
  cap: number;
  /** Who decided the number. */
  source: CapSource;
  /** What it would be out of the box, so a screen can say "raised from 20". */
  factory: number;
  /**
   * The variable's raw value when it is set, even when it could not be read — the screen must say
   * that the environment decides, and that it could not be understood, instead of showing a file
   * value nobody is applying.
   */
  env?: string;
}

/** Pure: the precedence in the header, with every input in hand. */
export function resolveCap(
  family: BudgetFamily,
  env: Record<string, string | undefined>,
  settings: SpendSettings,
): DailyCap {
  const factory = FACTORY_CAPS[family];
  const raw = env[BUDGET_ENV[family]];
  const exported = raw !== undefined && raw.trim() !== "" ? raw : undefined;
  if (settings.paused) return { cap: 0, source: "paused", factory, ...(exported !== undefined ? { env: exported } : {}) };
  if (exported !== undefined) return { cap: capFrom(exported, factory), source: "env", factory, env: exported };
  const chosen = settings.caps[family];
  if (chosen !== undefined) return { cap: chosen, source: "file", factory };
  return { cap: factory, source: "factory", factory };
}

/** What an organ asks before spending: reads the environment and the file at request time. */
export async function capFor(family: BudgetFamily): Promise<DailyCap> {
  const { settings } = await readSpendSettings();
  return resolveCap(family, process.env, settings);
}

/** All nine at once, for the screens. */
export async function capsFor(): Promise<Record<BudgetFamily, DailyCap>> {
  const { settings } = await readSpendSettings();
  return Object.fromEntries(
    BUDGET_FAMILIES.map((family) => [family, resolveCap(family, process.env, settings)]),
  ) as Record<BudgetFamily, DailyCap>;
}
