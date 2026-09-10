import Link from "next/link";
import { getDiskTotals, listDiskUsage, stateOf, type DiskRow } from "@panoma/db";
import { db } from "@/lib/db";
import { MeasureDisk } from "@/components/measure-disk";
import { PageSection, PageShell } from "@/components/page-shell";
import { Card, ProjectIcon, StateDot, Tag, formatBytes, relativeDate } from "@/components/primitives";
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
    <PageShell
      eyebrow={t(locale, "nav.disk")}
      title={
        totals.measured === 0
          ? t(locale, "disk.empty")
          : t(locale, "disk.title", { bytes: formatBytes(totals.reclaimableBytes) })
      }
      lead={t(locale, "disk.intro")}
      headExtra={
        /*
           The four figures and the button that produces them are the header's, not the body's:
           they are what the title says, spelled out, and the measurement is the one thing to do
           on this screen when there is nothing below yet.
          */
        <>
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
              <Metric label={t(locale, "disk.metricMeasured")} value={String(totals.measured)} />
            </dl>
          )}

          <div className="mt-6">
            <MeasureDisk measuredAt={totals.measuredAt?.toISOString() ?? null} />
          </div>
        </>
      }
    >
      {rows.length > 0 && (
        <PageSection>
          <ul className="space-y-2">
            {rows.map((row) => (
              <ProjectRow key={row.id} row={row} locale={locale} />
            ))}
          </ul>

          {/*
             The rules of the list, in the same frame as everything else that is a panel. Measured
             before moving it: the markup writes `rounded border border-edge bg-surface` in four
             places and `rounded-lg border border-edge` in thirty-six, so this panel was on the
             4px corner of a minority nobody argued for. `Card` puts it on the 8px the other
             thirty-six already draw.
            */}
          <Card className="mt-8 font-mono text-[11px] leading-relaxed text-faint">
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
          </Card>
        </PageSection>
      )}
    </PageShell>
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
      {/*
         `text-2xl` and no longer `text-3xl`, and the reason is one step above it. The page title
         came down from a fixed 36px to `--type-title`, which tops out at 28: at 30px these four
         figures would have been the loudest thing on a screen whose own headline is quieter, and
         the metric would have read as the heading. 24 puts them back underneath it — the same
         inversion D2 fixed between the catalog and its seventeen secondary screens, one level
         further in.
        */}
      <dd
        className={`font-display text-2xl font-semibold ${accent ? "text-accent" : "text-chalk"}`}
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
    <Card as="li">
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
              <Tag tone="quiet">{t(locale, "common.copyOf", { name: row.copyOf })}</Tag>
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
    </Card>
  );
}

