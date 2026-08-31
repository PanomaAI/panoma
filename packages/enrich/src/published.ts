import { NOT_FOUND, fetchJson, isSafeRegistryName } from "./http";

/**
 * When a specific version was published.
 *
 * It exists for a single question: **has this version been out long enough for someone else to
 * have looked at it?** The supply chain commitments that have really caused damage — event-stream,
 * ua-parser-js, node-ipc, the September 2025 batch — were detected and removed within hours or a
 * few days. Installing a version released twenty minutes ago is like running that race in the
 * front row; waiting three days almost always makes it someone else's problem.
 *
 * It is not checked during mass enrichment but at the moment of proposing an execution, and for a
 * single package. The reason is the size: the `time` from npm only comes in the complete package
 * document, which in popular cases weighs megabytes. An extra request per execution is not
 * noticeable; eight hundred in each `panoma enrich`, yes.
 */
export async function publishedAt(
  ecosystem: string,
  name: string,
  version: string,
): Promise<Date | undefined> {
  // The name comes from an unrelated manifest and goes inside a URL. See `isSafeRegistryName`.
  if (!isSafeRegistryName(name)) return undefined;
  if (ecosystem === "npm") return npmPublishedAt(name, version);
  if (ecosystem === "pub") return pubPublishedAt(name, version);
  return undefined;
}

/**
 * How much is accepted to charge for this specific consultation.
 *
 * Well above the general limit, and not by neglect: npm **only** publishes the dates per version
 * within the complete package document. Measured today: `typescript` weighs 15 MB and
 * `@types/node` 11, while `…/latest` is 4 KB and the abbreviated format
 * (`application/vnd.npm.install-v1+json`) still weighs 8.6 MB and on top of that it doesn't
 * include `time`.
 * There is no cheap way; there is an expensive one or there is none.
 *
 * It is paid once per proposed execution, not for each `panoma enrich`, which is what makes the
 * price acceptable. Saving the date in the catalog the first time it is queried would leave the
 * cost at zero from the second time: it is noted as pending.
 */
const NPM_PACKUMENT_MAX_BYTES = 48 * 1024 * 1024;

async function npmPublishedAt(name: string, version: string): Promise<Date | undefined> {
  const data = await fetchJson<{ time?: Record<string, string> }>(
    `https://registry.npmjs.org/${encodeURIComponent(name).replace(/^%40/, "@")}`,
    { maxBytes: NPM_PACKUMENT_MAX_BYTES },
  );
  if (data === NOT_FOUND) return undefined;
  return parse(data.time?.[version]);
}

async function pubPublishedAt(name: string, version: string): Promise<Date | undefined> {
  const data = await fetchJson<{ versions?: { version?: string; published?: string }[] }>(
    `https://pub.dev/api/packages/${encodeURIComponent(name)}`,
    { headers: { Accept: "application/vnd.pub.v2+json" } },
  );
  if (data === NOT_FOUND) return undefined;
  return parse(data.versions?.find((entry) => entry.version === version)?.published);
}

function parse(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Quarantine days. Configurable because the balance is not the same for everyone. */
export function quarantineDays(): number {
  const raw = process.env["PANOMA_CUARENTENA_DIAS"];
  if (raw === undefined) return 3;
  const days = Number.parseInt(raw, 10);
  return Number.isFinite(days) && days >= 0 ? days : 3;
}

export interface QuarantineVerdict {
  /** `undefined` if the record doesn't say when it was published: nothing can be stated. */
  publishedAt?: Date;
  ageHours?: number;
  days: number;
  /** true if it is too recent for the configured threshold. */
  tooFresh: boolean;
}

/**
 * Has the quarantine passed?
 *
 * When the record does not state the date, `tooFresh` is `false`: refusing for not knowing would
 * block entire ecosystems —the records that do not publish dates— because of a doubt that cannot
 * be resolved. What is done, however, is to make a note that it could not be verified.
 */
export async function checkQuarantine(
  ecosystem: string,
  name: string,
  version: string,
): Promise<QuarantineVerdict> {
  const days = quarantineDays();
  if (days === 0) return { days, tooFresh: false };

  const at = await publishedAt(ecosystem, name, version).catch(() => undefined);
  if (!at) return { days, tooFresh: false };

  const ageHours = (Date.now() - at.getTime()) / 3_600_000;
  return { publishedAt: at, ageHours, days, tooFresh: ageHours < days * 24 };
}

export type QuarantineDecision =
  | { action: "seguir" }
  | { action: "avisar"; note: string }
  | { action: "bloquear"; age: string };

/**
 * What to do with a version that has not passed quarantine.
 *
 * Politics lives here and not on route HTTP to be able to check it: there are three branches and
 * the one that matters most is the middle one, which is the one that decides *not* to block.
 *
 * With `security` the scale is reversed and that is why it does not get blocked. The version is
 * named in a public notice **as the fix**, so leaving a known vulnerability open out of caution
 * against a hypothetical one is changing a certain risk for a speculative one. It continues, and
 * it is written in the execution record.
 */
export function quarantineDecision(
  verdict: QuarantineVerdict,
  options: { security?: boolean; force?: boolean },
): QuarantineDecision {
  if (!verdict.tooFresh) return { action: "seguir" };

  const age =
    verdict.ageHours! < 48
      ? `${Math.round(verdict.ageHours!)} h`
      : `${Math.round(verdict.ageHours! / 24)} días`;

  if (options.security) {
    return {
      action: "avisar",
      note:
        `la versión se publicó hace ${age}, por debajo de la cuarentena de ${verdict.days} ` +
        `días (se siguió por ser un arreglo de seguridad)`,
    };
  }
  if (options.force) {
    return {
      action: "avisar",
      note:
        `la versión se publicó hace ${age}, por debajo de la cuarentena de ${verdict.days} ` +
        `días (forzado)`,
    };
  }
  return { action: "bloquear", age };
}
