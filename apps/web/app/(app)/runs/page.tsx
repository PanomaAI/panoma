import Link from "next/link";
import { listAllRuns } from "@panoma/db";
import { db } from "@/lib/db";
import { relativeDate } from "@/components/primitives";
import { RunStatusTag } from "@/components/run-status";
import { IsolationTag } from "@/components/isolation";
import { getLocale, t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.activity") };
}

export default async function RunsPage() {
  const { db: database } = await db();
  const [runs, locale] = await Promise.all([listAllRuns(database), getLocale()]);

  return (
    <>

      <main id="app-main" tabIndex={-1} className="app-main legacy-page">
        <section className="pt-12">
          <p className="eyebrow">{t(locale, "nav.activity")}</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
            {runs.length === 0
              ? t(locale, "runs.empty")
              : t(locale, runs.length === 1 ? "runs.countOne" : "runs.countMany", {
                  n: runs.length,
                })}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-smoke">
            {t(locale, "runs.intro")}
          </p>
        </section>

        {runs.length === 0 ? (
          <section className="mt-10 rounded-lg border border-edge bg-surface p-6">
            <p className="text-sm text-smoke">{t(locale, "runs.tryHint")}</p>
            <pre className="mt-4 overflow-x-auto rounded border border-edge bg-ground p-4 font-mono text-xs text-chalk">
              npx panoma run &lt;{t(locale, "runs.argProject")}&gt; &lt;{t(locale, "runs.argPackage")}&gt;
            </pre>
          </section>
        ) : (
          <ul className="mt-10 space-y-2">
            {runs.map((run) => {
              const target = run.target as { packageName?: string; targetVersion?: string };
              return (
                <li key={run.id} className="rounded-lg border border-edge bg-surface transition-colors hover:border-edge-bright">
                  <Link href={`/runs/${run.id}`} className="block p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <RunStatusTag status={run.status} verified={run.verified} locale={locale} />
                    <IsolationTag isolation={run.isolation} note={run.isolationNote} locale={locale} />
                    <span className="font-mono text-xs text-accent">{run.projectName}</span>
                    <span className="font-mono text-xs text-chalk">
                      {target.packageName} → {target.targetVersion}
                    </span>
                    <span className="ml-auto font-mono text-[11px] text-faint">
                      {run.requestedBy} · {relativeDate(run.createdAt, locale)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-smoke">{run.summary}</p>
                  {run.branch && (
                    <p className="mt-1.5 font-mono text-[11px] text-faint">
                      {t(locale, "runs.branch")} <span className="text-smoke">{run.branch}</span>
                    </p>
                  )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
