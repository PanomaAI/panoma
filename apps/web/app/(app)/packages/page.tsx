import { getStats, listPackages } from "@panoma/db";
import { isOutdated } from "@panoma/enrich";
import { db } from "@/lib/db";
import { SeverityTag } from "@/components/deps";
import { PageSection, PageShell } from "@/components/page-shell";
import { Card, relativeDate } from "@/components/primitives";
import { Rich } from "@/components/rich-text";
import { cliName } from "@/lib/cli-name";
import { getLocale, t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.packages") };
}

export default async function PackagesPage() {
  const { db: database } = await db();
  const [packages, stats, locale] = await Promise.all([
    listPackages(database),
    getStats(database),
    getLocale(),
  ]);

  // Only what is really used matters; packages without dependents are leftovers from projects that
  // are no longer in the catalog.
  const used = packages.filter((pkg) => pkg.projects > 0);

  /*
    It was the only section page without an empty state: header from a table with no row, '0
    dependencies' and 'checked —'. An empty table doesn't indicate whether the page is broken or
    if something still needs to be done; this does. The command comes from `cliName()` and not
    from this file, which is the lesson documented on the cover: whoever arrived by `npx panoma
    up` does not have `panoma` in the PATH, and whoever installed it globally does not want the
    `npx`.
   */
  if (used.length === 0) {
    /*
      This branch and the catalog's own empty branch were the two users of
      `.content-page.empty-catalog-page`, and the same pair of classes did not put them in the
      same place: this one sat inside `.legacy-page`, whose 122px top and 32px sides come first,
      so it started 122 + 48 = 170px down while the catalog's started 74 + 48 = 122. The gutter
      differed too, and by an accident of source order: `.content-page`'s `min(100% - 48px, …)`
      and `.legacy-page > *`'s `min(100%, …)` weigh exactly the same, the second is written twelve
      lines later, so here the gutter was `.legacy-page`'s own 32 and on the catalog it was 24.
      48px lower and 8px narrower a side, and nobody chose either figure.
      On the shell it is a page like the fifteen beside it, and its title comes down from
      `--type-display` to the `--type-title` every secondary screen now shares — `docs/theme.md`,
      D2. The catalog's branch does not follow it here and should not: its `<main>` carries
      `catalog-screen`, which D13 keeps as a door to a dark theme, `PageShell` takes no
      `className`, and D2 gives that one screen `--type-display` by name. It moved onto
      `.catalog-screen__inner` instead, so between the two of us `.content-page` is left with no
      writer in the markup at all — the rule in `app-layout.css` and its narrowing in
      `responsive.css` are now dead and can go.
     */
    return (
      <PageShell
        eyebrow={t(locale, "nav.packages")}
        title={t(locale, "packages.emptyTitle")}
        lead={t(locale, "packages.emptyBody")}
      >
        <PageSection>
          {/*
             `Card` and not the sheet's `<pre>` rule: the frame is the same hairline, paper and
             corner the primitive already draws, and the scroll stays on the box so a long path
             never widens the page under it.
            */}
          <Card className="overflow-x-auto">
            <pre className="font-mono text-xs">{cliName()} scan ~/Desktop --save</pre>
          </Card>
        </PageSection>
      </PageShell>
    );
  }

  /*
    A null `enriched_at` is the only honest thing this line knows.
    `outdated_deps` and `vuln_count` default to zero and only enrichment writes them, so over a
    full table of packages the header used to read «0 direct dependencies behind · 0 advisories ·
    checked —» on a catalog nobody had ever asked about. That is the zero of «I looked and there is
    nothing» printed for «I have not looked».
    The empty state above does not catch it either: it asks `used.length === 0`, and the table is
    full — the packages come from the scan, the verdict does not.
   */
  const checked =
    stats.enrichedAt === null ? (
      <Rich
        text={t(locale, "packages.statsUnchecked")}
        slots={{ cmd: <code className="text-smoke">{cliName()} enrich</code> }}
      />
    ) : (
      t(locale, "packages.stats", {
        n: stats.outdatedDeps,
        m: stats.advisories,
        when: relativeDate(stats.enrichedAt, locale),
      })
    );

  return (
    <PageShell
      eyebrow={t(locale, "nav.packages")}
      title={t(locale, "packages.title", { n: used.length })}
      lead={t(locale, "packages.intro")}
      note={checked}
    >
      <PageSection>
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-edge text-faint">
                <th className="py-2 pr-4 font-normal">{t(locale, "packages.colPackage")}</th>
                <th className="py-2 pr-4 font-normal">{t(locale, "packages.colProjects")}</th>
                <th className="py-2 pr-4 font-normal">{t(locale, "packages.colInUse")}</th>
                <th className="py-2 pr-4 font-normal">{t(locale, "packages.colLatest")}</th>
                <th className="py-2 font-normal">{t(locale, "packages.colAdvisories")}</th>
              </tr>
            </thead>
            <tbody>
              {used.map((pkg) => {
                const stale = pkg.versionsInUse.filter((entry) =>
                  isOutdated(entry.version, pkg.latestVersion),
                );
                return (
                  <tr key={pkg.id} className="border-b border-edge/50 align-top">
                    <td className="py-2 pr-4">
                      <span className="text-chalk">{pkg.name}</span>
                      <span className="ml-2 text-faint">{pkg.ecosystem}</span>
                      {pkg.deprecated && (
                        <span className="ml-2 text-idle">{t(locale, "packages.deprecated")}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-smoke">{pkg.projects}</td>
                    <td className="py-2 pr-4">
                      {pkg.versionsInUse.length === 0 ? (
                        <span className="text-faint">{t(locale, "packages.unpinned")}</span>
                      ) : (
                        <span className={stale.length > 0 ? "text-idle" : "text-smoke"}>
                          {pkg.versionsInUse
                            .slice(0, 3)
                            .map((entry) => entry.version)
                            .join(", ")}
                          {pkg.versionsInUse.length > 3 && (
                            <span className="text-faint"> +{pkg.versionsInUse.length - 3}</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-smoke">{pkg.latestVersion ?? "—"}</td>
                    <td className="py-2">
                      {pkg.advisories > 0 && pkg.worstSeverity ? (
                        <span className="flex items-center gap-1.5">
                          <SeverityTag severity={pkg.worstSeverity} locale={locale} />
                          <span className="text-faint">{pkg.advisories}</span>
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </PageSection>
    </PageShell>
  );
}
