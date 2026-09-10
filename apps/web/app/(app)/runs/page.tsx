import Link from "next/link";
import { listAllRuns } from "@panoma/db";
import { db } from "@/lib/db";
import { PageSection, PageShell } from "@/components/page-shell";
import { Card, relativeDate } from "@/components/primitives";
import { RunStatusTag } from "@/components/run-status";
import { IsolationTag } from "@/components/isolation";
import { cliName } from "@/lib/cli-name";
import { getLocale, t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.activity") };
}

export default async function RunsPage() {
  const { db: database } = await db();
  const [runs, locale] = await Promise.all([listAllRuns(database), getLocale()]);

  return (
    <PageShell
      eyebrow={t(locale, "nav.activity")}
      title={
        runs.length === 0
          ? t(locale, "runs.empty")
          : t(locale, runs.length === 1 ? "runs.countOne" : "runs.countMany", {
              n: runs.length,
            })
      }
      lead={t(locale, "runs.intro")}
    >
      <PageSection>
        {runs.length === 0 ? (
          <Card pad="lg">
            <p className="text-sm text-smoke">{t(locale, "runs.tryHint")}</p>
            <pre className="mt-4 overflow-x-auto rounded border border-edge bg-ground p-4 font-mono text-xs text-chalk">
              {cliName()} run &lt;{t(locale, "runs.argProject")}&gt; &lt;{t(locale, "runs.argPackage")}&gt;
            </pre>
          </Card>
        ) : (
          <ul className="space-y-2">
            {runs.map((run) => {
              const target = run.target as { packageName?: string; targetVersion?: string };
              return (
                /*
                  The row is the same panel the primitive draws, with no padding of its own: the
                  `<Link>` inside carries it, so the whole card is the target and not just the
                  words. Only the hover edge is left here, which is the one thing the panel does
                  not decide.
                 */
                <Card
                  as="li"
                  key={run.id}
                  pad="none"
                  className="transition duration-[var(--duration-fast)] hover:border-edge-bright"
                >
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
                </Card>
              );
            })}
          </ul>
        )}
      </PageSection>
    </PageShell>
  );
}
