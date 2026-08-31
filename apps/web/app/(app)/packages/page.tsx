import { getStats, listPackages } from "@panoma/db";
import { isOutdated } from "@panoma/enrich";
import { db } from "@/lib/db";
import { SeverityTag } from "@/components/deps";
import { relativeDate } from "@/components/primitives";
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
    return (
      <main id="app-main" tabIndex={-1} className="app-main legacy-page">
        <section className="content-page empty-catalog-page">
          <p className="eyebrow">{t(locale, "nav.packages")}</p>
          <h1>{t(locale, "packages.emptyTitle")}</h1>
          <p>{t(locale, "packages.emptyBody")}</p>
          <pre>{cliName()} scan ~/Desktop --save</pre>
        </section>
      </main>
    );
  }

  return (
    <>

      <main id="app-main" tabIndex={-1} className="app-main legacy-page">
        <section className="pt-12">
          <p className="eyebrow">{t(locale, "nav.packages")}</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
            {t(locale, "packages.title", { n: used.length })}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-smoke">
            {t(locale, "packages.intro")}
          </p>
          <p className="mt-4 font-mono text-xs text-faint">
            {/*
               A null `enriched_at` is the only honest thing this line knows.
               `outdated_deps` and `vuln_count` default to zero and only enrichment writes them,
               so over a full table of packages the header used to read «0 direct dependencies
               behind · 0 advisories · checked —» on a catalog nobody had ever asked about. That
               is the zero of «I looked and there is nothing» printed for «I have not looked».
               The empty state below does not catch it either: it asks `used.length === 0`, and
               the table is full — the packages come from the scan, the verdict does not.
              */}
            {stats.enrichedAt === null ? (
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
            )}
          </p>
        </section>

        <div className="mt-10 overflow-x-auto">
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
      </main>
    </>
  );
}
