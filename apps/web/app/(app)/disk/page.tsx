import Link from "next/link";
import { getDiskTotals, listDiskUsage, stateOf, type DiskRow } from "@panoma/db";
import { db } from "@/lib/db";
import { MeasureDisk } from "@/components/measure-disk";
import { ProjectIcon, StateDot, formatBytes, relativeDate } from "@/components/primitives";
import { Rich } from "@/components/rich-text";
import { getLocale, t, type Locale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.disk") };
}

/**
 * How much disk space do the projects take up and how much of that comes back by itself.
 *
 * The entire page relies on one distinction: 'regenerable' is not 'dispensable'. A 600 MB
 * `node_modules` can be recovered with a command; a `dist/` that turned out to be handwritten code
 * cannot. That is why each folder explains *why* it is considered disposable, and the ambiguous
 * ones that git does not ignore do not appear on the list.
 */
export default async function DiskPage() {
  const { db: database } = await db();
  const [rows, totals, locale] = await Promise.all([
    listDiskUsage(database),
    getDiskTotals(database),
    getLocale(),
  ]);

  return (
    <main id="app-main" tabIndex={-1} className="app-main legacy-page">
      <section className="pt-12">
        <p className="eyebrow">{t(locale, "nav.disk")}</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
          {totals.measured === 0
            ? t(locale, "disk.empty")
            : t(locale, "disk.title", { bytes: formatBytes(totals.reclaimableBytes) })}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-smoke">
          {t(locale, "disk.intro")}
        </p>

        {totals.measured > 0 && (
          <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
            <Metric label={t(locale, "disk.metricTotal")} value={formatBytes(totals.totalBytes)} />
            <Metric
              label={t(locale, "disk.metricReclaimable")}
              value={formatBytes(totals.reclaimableBytes)}
              detail={t(locale, "disk.metricShare", {
                n: Math.round((totals.reclaimableBytes / Math.max(totals.totalBytes, 1)) * 100),
              })}
              accent
            />
            <Metric
              label={t(locale, "disk.metricDormant")}
              value={formatBytes(totals.dormantReclaimableBytes)}
              detail={t(locale, "disk.metricDormantDetail")}
            />
            <Metric
              label={t(locale, "disk.metricMeasured")}
              value={String(totals.measured)}
            />
          </dl>
        )}

        <div className="mt-6">
          <MeasureDisk measuredAt={totals.measuredAt?.toISOString() ?? null} />
        </div>
      </section>

      {rows.length > 0 && (
        <ul className="mt-10 space-y-2">
          {rows.map((row) => (
            <ProjectRow key={row.id} row={row} locale={locale} />
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <p className="mt-8 rounded border border-edge bg-surface p-4 font-mono text-[11px] leading-relaxed text-faint">
          <Rich
            text={t(locale, "disk.rules")}
            slots={{
              generated: (
                <>
                  <code>node_modules</code>, <code>.dart_tool</code>, <code>Pods</code>…
                </>
              ),
              ambiguous: (
                <>
                  <code>build</code>, <code>dist</code>, <code>vendor</code>
                </>
              ),
            }}
          />
        </p>
      )}
    </main>
  );
}

function Metric({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail?: string;
  accent?: boolean;
}) {
  return (
    <div>
      <dd
        className={`font-display text-3xl font-semibold ${accent ? "text-accent" : "text-chalk"}`}
      >
        {value}
      </dd>
      <dt className="mt-0.5 font-mono text-[11px] text-smoke">{label}</dt>
      {detail && <p className="font-mono text-[10px] text-faint">{detail}</p>}
    </div>
  );
}

function ProjectRow({ row, locale }: { row: DiskRow; locale: Locale }) {
  const share = row.totalBytes > 0 ? row.reclaimableBytes / row.totalBytes : 0;

  return (
    <li className="rounded-lg border border-edge bg-surface p-4">
      <div className="flex items-start gap-4">
        <ProjectIcon
          name={row.name}
          src={row.hasIcon ? `/icon/${row.id}` : null}
          size={40}
          locale={locale}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Link href={`/p/${row.slug}`} className="text-sm font-medium hover:text-accent">
              {row.name}
            </Link>
            <StateDot state={stateOf(row.lastCommitAt)} withLabel locale={locale} />
            {row.copyOf && (
              <span className="rounded border border-edge bg-raised px-1.5 font-mono text-[10px] text-faint">
                {t(locale, "common.copyOf", { name: row.copyOf })}
              </span>
            )}
            <span className="ml-auto font-mono text-xs">
              <span className="text-accent">{formatBytes(row.reclaimableBytes)}</span>
              <span className="text-faint">
                {" "}
                {t(locale, "disk.ofTotal", { bytes: formatBytes(row.totalBytes) })}
              </span>
            </span>
          </div>

          {/* The bar uses the same data as the text: no decorative percentages. */}
          <div
            className="mt-2 h-1 w-full overflow-hidden rounded-full bg-raised"
            role="img"
            aria-label={t(locale, "disk.shareAria", { n: Math.round(share * 100) })}
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.min(100, Math.round(share * 100))}%` }}
            />
          </div>

          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
            {row.dirs.slice(0, 6).map((dir) => (
              <li key={dir.path} className="font-mono text-[11px]" title={dir.evidence}>
                <span className="text-smoke">{dir.path}</span>{" "}
                <span className="text-faint">{formatBytes(dir.bytes)}</span>
              </li>
            ))}
            {row.dirs.length > 6 && (
              <li className="font-mono text-[11px] text-faint">
                {t(locale, "disk.moreDirs", { n: row.dirs.length - 6 })}
              </li>
            )}
          </ul>

          <p className="mt-1.5 truncate font-mono text-[10px] text-faint" title={row.root}>
            {row.root} ·{" "}
            {t(locale, "disk.measuredAt", { when: relativeDate(row.measuredAt, locale) })}
          </p>
        </div>
      </div>
    </li>
  );
}

