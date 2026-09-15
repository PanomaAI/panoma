import {
  listModelCalls,
  modelSpendByKind,
  modelSpendByModel,
  startOfDay,
  quotaState,
  type Database,
  type KindSpend,
  type ModelSpendRow,
  type QuotaState,
} from "@panoma/db";
import {
  BUDGET_FAMILIES,
  SHOT_MAX_EDGE,
  rateKey,
  readSpendSettings,
  resolveCap,
  resolveQuota,
  FACTORY_QUOTA_MB,
  QUOTA_ENV,
  MIB,
  MAX_QUOTA_MB,
  type BudgetFamily,
  type DailyCap,
  type ModelRate,
  type ShotPolicy,
  type QuotaScope,
  type QuotaSource,
} from "./spend-settings";
import { memoryDisk, type MemoryDisk } from "./memory-disk";
import {
  costOf,
  familyLines,
  groupByDay,
  rowCost,
  totalsOf,
  unbudgetedLines,
  type DayBucket,
  type FamilyLine,
  type KindLine,
  type Priced,
} from "./spend-view";

/*
  The whole answer of the spend screen, assembled once.

  `GET /api/spend`, `POST /api/spend` and the `/spend` page all say the same thing —today, the
  last thirty days, every model, every cap— and a screen that assembled it on its own would drift
  from the route the CLI reads within a week. So there is one function, and the three call it.
 */

/** How many local days the chart and the model table cover. */
export const REPORT_DAYS = 30;

/** The five accounts plus the money, for today and for the window. */
export interface SpendTotals extends Priced {
  calls: number;
  input: number;
  output: number;
  unmetered: number;
  images: number;
}

/** One provider/model pair of the window, with the owner's rate for it when there is one. */
export interface ModelLine extends ModelSpendRow {
  /** `rateKey(provider, model)`: the key the form writes the rate under. */
  key: string;
  rate: ModelRate | null;
  cost: number | null;
}

export interface SpendReport {
  storage: {
    state: QuotaState;
    disk: MemoryDisk;
    maximumMb: number;
    scopes: { scope: QuotaScope; chosenMb: number | null; effectiveMb: number; factoryMb: number; source: QuotaSource; variable: string }[];
  };
  /** `DATABASE_URL` is set: the caps are the server's, which is where the calls are made from. */
  remote: boolean;
  /** `spend.json` exists and could not be read as settings; factory values are shown. */
  broken: boolean;
  paused: boolean;
  /** What the critic is shown. The form starts from this, and the receipt says it out loud. */
  shots: ShotPolicy;
  /**
   * The long edge a reduced capture is fitted to, in pixels.
   *
   * It travels in the receipt so that the browser and the terminal can name the size without
   * importing `spend-settings.ts`, which reads a file under `PANOMA_HOME` and therefore never
   * reaches the client bundle. A number written twice is a number that drifts, and this one is the
   * whole content of the choice.
   */
  shotEdge: number;
  currency: string;
  /** What the file holds, family by family: the form starts from this, not from the resolved cap. */
  chosen: Partial<Record<BudgetFamily, number>>;
  /** Every rate on disk, including pairs not seen in the window, so a save does not drop them. */
  rates: Record<string, ModelRate>;
  today: SpendTotals;
  families: FamilyLine[];
  unbudgeted: KindLine[];
  kinds: KindSpend[];
  models: ModelLine[];
  days: DayBucket[];
  month: SpendTotals;
}

export async function spendReport(database: Database, now: Date = new Date()): Promise<SpendReport> {
  const { settings, broken } = await readSpendSettings();
  const caps = Object.fromEntries(
    BUDGET_FAMILIES.map((family) => [family, resolveCap(family, process.env, settings)]),
  ) as Record<BudgetFamily, DailyCap>;
  const quota = resolveQuota(process.env, settings);
  const [storageState, disk] = await Promise.all([quotaState(database, quota), memoryDisk()]);

  const today = startOfDay(now);
  // Thirty local days including today: the window starts at midnight twenty-nine days back.
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (REPORT_DAYS - 1));
  const [kinds, todayModels, windowModels, calls] = await Promise.all([
    modelSpendByKind(database, today),
    modelSpendByModel(database, today),
    modelSpendByModel(database, since),
    listModelCalls(database, { since }),
  ]);

  const models: ModelLine[] = windowModels.map((row) => {
    const key = rateKey(row.provider, row.model);
    const rate = settings.rates[key] ?? null;
    return { ...row, key, rate, cost: rowCost(row, rate) };
  });

  return {
    storage: {
      state: storageState, disk, maximumMb: MAX_QUOTA_MB,
      scopes: (["catalog", "project"] as const).map((scope) => ({
        scope, chosenMb: settings.quota?.[scope === "catalog" ? "catalogMb" : "projectMb"] ?? null,
        effectiveMb: (scope === "catalog" ? quota.catalogBytes : quota.projectBytes) / MIB,
        factoryMb: FACTORY_QUOTA_MB[scope], source: quota.sources[scope], variable: QUOTA_ENV[scope],
      })),
    },
    remote: Boolean(process.env["DATABASE_URL"]),
    broken,
    paused: settings.paused,
    shots: settings.shots,
    shotEdge: SHOT_MAX_EDGE,
    currency: settings.currency,
    chosen: settings.caps,
    rates: settings.rates,
    today: { ...totalsOf(kinds), ...costOf(todayModels, settings.rates) },
    families: familyLines(kinds, caps),
    unbudgeted: unbudgetedLines(kinds),
    kinds,
    models,
    days: groupByDay(calls, REPORT_DAYS, now),
    month: { ...totalsOf(windowModels), ...costOf(windowModels, settings.rates) },
  };
}
