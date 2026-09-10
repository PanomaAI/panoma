import { db } from "@/lib/db";
import { getLocale, t, type Locale } from "@/lib/i18n";
import { spendReport, type SpendReport, type SpendTotals } from "@/lib/spend-report";
import { formatMoney, formatTokens, hasDetail, hasNoTokenMeasurement, kindKey } from "@/lib/spend-format";
import { SpendControls } from "@/components/spend-controls";
import { PageSection, PageShell } from "@/components/page-shell";
import { Card, EmptyState, Tag } from "@/components/primitives";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.spend") };
}

/** The ledger stays on the server; the form combines each function's usage and daily cap. */
export default async function SpendPage() {
  const [locale, { db: database }] = await Promise.all([getLocale(), db()]);
  const report = await spendReport(database);

  return (
    <PageShell
      eyebrow={t(locale, "nav.spend")}
      title={t(locale, "spend.title")}
      lead={t(locale, "spend.intro")}
      headExtra={
        <>
          <p className="mt-3 max-w-2xl text-xs leading-relaxed text-smoke">{t(locale, "spend.scope")}</p>
          {report.broken && <p role="alert" className="mt-3 text-sm leading-relaxed text-fail">{t(locale, "spend.brokenFile")}</p>}
          {report.remote && <p className="mt-3 text-sm leading-relaxed text-smoke">{t(locale, "spend.remote")}</p>}
        </>
      }
    >
      <PageSection>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Card as="section" aria-labelledby="spend-today-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="spend-today-title" className="text-base font-semibold">{t(locale, "spend.today")}</h2>
              {report.paused && <Tag size="md">{t(locale, "spend.state.paused")}</Tag>}
            </div>
            <Totals totals={report.today} currency={report.currency} locale={locale} />
            {report.today.calls === 0 && <EmptyState variant="note" className="mt-4" title={t(locale, "spend.empty")} />}
          </Card>
          <Month report={report} locale={locale} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-smoke">{t(locale, "spend.billingHint")}</p>
      </PageSection>

      {report.unbudgeted.length > 0 && (
        <PageSection>
          <Card as="section" tone="raised">
            <h2 className="text-sm font-semibold">{t(locale, "spend.unbudgeted")}</h2>
            <p className="mt-2 text-xs leading-relaxed text-smoke">{t(locale, "spend.unbudgetedHint")}</p>
            <ul className="mt-3 space-y-3">
              {report.unbudgeted.map((line) => {
                const key = kindKey(line.kind);
                return (
                  <li key={line.kind}>
                    <p className="text-sm">{t(locale, "spend.kindLine", { name: key ? t(locale, key) : line.kind, n: line.calls })}</p>
                    {hasDetail(line) && (
                      <p className="mt-1 text-xs text-smoke">
                        {[
                          line.input + line.output > 0 ? t(locale, "spend.tokens", { input: formatTokens(line.input, locale), output: formatTokens(line.output, locale) }) : null,
                          line.unmetered > 0 ? t(locale, "spend.unmetered", { n: line.unmetered }) : null,
                          line.images > 0 ? t(locale, "spend.images", { n: line.images }) : null,
                        ].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </PageSection>
      )}
      <SpendControls initial={report} />
    </PageShell>
  );
}

/** Daily history complements the same totals shown for today, without an empty chart frame. */
function Month({ report, locale }: { report: SpendReport; locale: Locale }) {
  const most = Math.max(1, ...report.days.map((day) => day.calls));
  return (
    <Card as="section" aria-labelledby="spend-month-title">
      <h2 id="spend-month-title" className="text-base font-semibold">{t(locale, "spend.month")}</h2>
      <Totals totals={report.month} currency={report.currency} locale={locale} />
      {report.month.calls === 0 ? (
        <EmptyState variant="note" className="mt-4" title={t(locale, "spend.monthEmpty")} />
      ) : (
        <div className="mt-4 border-t border-edge pt-4">
          <div
            role="img"
            aria-label={t(locale, "spend.daysAria", {
              calls: report.month.calls, input: formatTokens(report.month.input, locale), output: formatTokens(report.month.output, locale),
            })}
            className="flex h-16 items-end gap-0.5"
          >
            {report.days.map((day) => (
              <div
                key={day.day}
                title={t(locale, "spend.dayTitle", { day: day.day, calls: day.calls, tokens: formatTokens(day.input + day.output, locale) })}
                className={`min-w-0 flex-1 rounded-t ${day.calls > 0 ? "bg-accent" : "bg-raised"}`}
                style={{ height: `${day.calls > 0 ? Math.max(6, Math.round((day.calls / most) * 100)) : 2}%` }}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between gap-3 font-mono text-xs text-smoke">
            <span>{report.days[0]?.day}</span>
            <span>{report.days[report.days.length - 1]?.day}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Unknown pricing or missing usage must never look like a complete zero-dollar bill. */
function Totals({ totals, currency, locale }: { totals: SpendTotals; currency: string; locale: Locale }) {
  const unmeasured = hasNoTokenMeasurement(totals);
  const cost = unmeasured ? null : totals.cost;
  const partial = totals.unpriced > 0 || totals.unmetered > 0;
  return (
    <>
      <dl className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-xs text-smoke">{t(locale, "spend.totalCalls")}</dt>
          <dd className="mt-2 font-mono text-3xl font-medium">{formatTokens(totals.calls, locale)}</dd>
        </div>
        <div>
          <dt className="text-xs text-smoke">{t(locale, partial ? "spend.partialCost" : "spend.estimatedCost")}</dt>
          <dd className={`mt-2 ${cost === null ? "text-sm text-smoke" : "font-mono text-xl font-medium"}`}>
            {cost === null ? t(locale, totals.calls === 0 ? "spend.noActivityCost" : unmeasured ? "spend.rateUnmetered" : "spend.rateMissing") : formatMoney(cost, currency, locale)}
          </dd>
        </div>
      </dl>
      {totals.calls > 0 && (
        <div className="mt-4 space-y-2 border-t border-edge pt-3 text-xs text-smoke">
          {totals.input + totals.output > 0 && (
            <p>{t(locale, "spend.tokens", { input: formatTokens(totals.input, locale), output: formatTokens(totals.output, locale) })}</p>
          )}
          {totals.unmetered > 0 && <p>{t(locale, "spend.unmetered", { n: totals.unmetered })}</p>}
          {totals.images > 0 && <p>{t(locale, "spend.images", { n: totals.images })}</p>}
          {totals.unpriced > 0 && <p>{t(locale, "spend.unpriced", { n: totals.unpriced })}</p>}
          {cost === null && !unmeasured && <p>{t(locale, "spend.noCost")}</p>}
        </div>
      )}
    </>
  );
}
