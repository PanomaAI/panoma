import Link from "next/link";
import { notFound } from "next/navigation";
import { getRunWithProject } from "@panoma/db";
import { db } from "@/lib/db";
import { relativeDate } from "@/components/primitives";
import { RunStatusTag } from "@/components/run-status";
import { Patch, Steps } from "@/components/patch";
import { RunActions } from "@/components/run-actions";
import { IsolationTag } from "@/components/isolation";
import { Rich } from "@/components/rich-text";
import { getLocale, t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, locale] = await Promise.all([params, getLocale()]);
  const { db: database } = await db();
  const run = await getRunWithProject(database, id);
  if (!run) notFound();

  const target = run.target as {
    packageName?: string;
    targetVersion?: string;
    advisoryId?: string;
  };
  const steps = Array.isArray(run.steps) ? (run.steps as Parameters<typeof Steps>[0]["steps"]) : [];
  const decidable = run.status === "proposed" && Boolean(run.branch);

  return (
    <>

      <main id="app-main" tabIndex={-1} className="app-main legacy-page">
        <section className="pt-12">
          <div className="flex flex-wrap items-center gap-3">
            <RunStatusTag status={run.status} verified={run.verified} locale={locale} />
            {run.kind === "vulnerability-fix" && (
              <span className="rounded border border-fail/30 bg-fail/10 px-2 py-0.5 font-mono text-[10px] text-fail">
                {t(locale, "runs.security")}
              </span>
            )}
            <IsolationTag isolation={run.isolation} note={run.isolationNote} locale={locale} />
            <Link
              href={`/p/${run.projectSlug}`}
              className="font-mono text-xs text-accent hover:underline"
            >
              {run.projectName}
            </Link>
          </div>

          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">
            {target.packageName} → {target.targetVersion}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-smoke">{run.summary}</p>

          <p className="mt-3 font-mono text-[11px] text-faint">
            {run.requestedBy} · {relativeDate(run.createdAt, locale)}
            {run.branch && (
              <> · {t(locale, "runs.branch")} <span className="text-smoke">{run.branch}</span></>
            )}
            {target.advisoryId && (
              <> · {t(locale, "runs.advisory")} <span className="text-smoke">{target.advisoryId}</span></>
            )}
          </p>
        </section>

        {/*
           Verification is the first thing you need to know when deciding: 'the tests pass' is not
           the same as 'there were no tests to run'.
          */}
        {run.status === "proposed" && !run.verified && (
          <p className="mt-8 rounded-lg border border-idle/30 bg-idle/10 px-4 py-3 text-sm text-idle">
            <Rich
              text={t(locale, "runs.noTests")}
              slots={{ nobody: <strong>{t(locale, "runs.noTestsEmphasis")}</strong> }}
            />
          </p>
        )}

        {decidable && (
          <section className="mt-8">
            <RunActions runId={run.id} branch={run.branch!} />
          </section>
        )}

        {run.isolationNote && (
          <p className="mt-6 rounded-lg border border-edge bg-raised px-4 py-3 text-xs leading-relaxed text-smoke">
            {run.isolationNote}
          </p>
        )}

        {steps.length > 0 && (
          <section className="mt-10">
            <h2 className="eyebrow mb-3 border-b border-edge pb-2">{t(locale, "runs.steps")}</h2>
            <Steps steps={steps} locale={locale} />
          </section>
        )}

        {run.patch && (
          <section className="mt-10">
            <h2 className="eyebrow mb-3 border-b border-edge pb-2">
              {t(locale, "runs.patchLines", { n: run.patch.split("\n").length })}
            </h2>
            <Patch patch={run.patch} />
          </section>
        )}
      </main>
    </>
  );
}
