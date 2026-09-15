import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { localeFrom, t, type MessageKey } from "@/lib/i18n";
import { spendReport } from "@/lib/spend-report";
import {
  patchSpendSettings,
  readSpendSettings,
  writeSpendSettings,
  type SettingsFault,
} from "@/lib/spend-settings";

/**
 * What panoma spends on models, and the caps that hold it back.
 *
 * The only external spend of this product is a model call, and until 6-Sep-2026 there was no place
 * that added it up: the twin page painted four of the seven caps and the rest lived in this
 * repository's documentation. This route answers the whole receipt —today, the last thirty days,
 * every provider/model pair— and takes the owner's decisions: a cap per family, a rate per model,
 * the currency, the pause, and how much of a screenshot the critic is shown.
 *
 * Both handlers ask for the operator, not just the origin. A quota is the operator's: whoever holds
 * the phone link may look at the catalog, and raising the number of calls this machine will pay
 * for is not looking. The GET goes behind the same key because the receipt names the models the
 * owner pays for and how much they use them, which is the same inventory `/api/ai` keeps behind
 * its guard.
 *
 * The POST answers with the same body as the GET, so the screen repaints from the answer instead
 * of asking twice. What it writes is `spend.json` under `PANOMA_HOME`; the precedence between that
 * file, the environment and the factory values is in the header of `lib/spend-settings.ts`.
 */

const FAULT_KEY: Record<SettingsFault, MessageKey> = {
  body: "spend.errBody",
  caps: "spend.errCaps",
  rates: "spend.errRates",
  currency: "spend.errCurrency",
  paused: "spend.errPaused",
  shots: "spend.errShots",
  quota: "spend.errQuota",
};

export async function GET(request: Request) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const { db: database } = await db();
  // Without cache: it is a receipt that changes with every call the organs make.
  return Response.json(await spendReport(database), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  // A body that is not JSON reaches the strict parser as `undefined`, which it refuses as `body`.
  const patch: unknown = await request.json().catch(() => undefined);
  const { settings: current } = await readSpendSettings();
  const patched = patchSpendSettings(current, patch);
  if ("fault" in patched) {
    return Response.json(
      { error: t(locale, FAULT_KEY[patched.fault]), code: patched.fault },
      { status: 400 },
    );
  }

  await writeSpendSettings(patched.settings);
  const { db: database } = await db();
  return Response.json(await spendReport(database), { headers: { "Cache-Control": "no-store" } });
}
