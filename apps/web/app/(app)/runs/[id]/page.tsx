import Link from "next/link";
import { notFound } from "next/navigation";
import { getRunWithProject } from "@panoma/db";
import { db } from "@/lib/db";
import { PageSection, PageShell } from "@/components/page-shell";
import { Card, Tag, relativeDate } from "@/components/primitives";
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

  /*
    The row of states and the line of who and when, both inside the header.
    They used to sit above the title, and the shell has no slot there: what it offers over the
    `<h1>` is the eyebrow, which is uppercased by `.eyebrow` and would shout the project's name.
    So they come down one step, in the order they are read — what happened, then who asked for it.
    Whoever decides the shell should grow a slot above the title, this is the call site that wants
    it.
   */
  const head = (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <RunStatusTag status={run.status} verified={run.verified} locale={locale} />
        {run.kind === "vulnerability-fix" && <Tag tone="fail">{t(locale, "runs.security")}</Tag>}
        <IsolationTag isolation={run.isolation} note={run.isolationNote} locale={locale} />
        <Link
          href={`/p/${run.projectSlug}`}
          className="font-mono text-xs text-accent hover:underline"
        >
          {run.projectName}
        </Link>
      </div>

      <p className="mt-3 font-mono text-[11px] text-faint">
        {run.requestedBy} · {relativeDate(run.createdAt, locale)}
        {run.branch && (
          <> · {t(locale, "runs.branch")} <span className="text-smoke">{run.branch}</span></>
        )}
        {target.advisoryId && (
          <> · {t(locale, "runs.advisory")} <span className="text-smoke">{target.advisoryId}</span></>
        )}
      </p>
    </>
  );

  return (
    <PageShell
      eyebrow={t(locale, "nav.activity")}
      title={
        <>
          {target.packageName} → {target.targetVersion}
        </>
      }
      lead={run.summary}
      headExtra={head}
    >
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
        <PageSection>
          <RunActions runId={run.id} branch={run.branch!} />
        </PageSection>
      )}

      {run.isolationNote && (
        <Card tone="raised" pad="none" className="mt-6 px-4 py-3">
          <p className="text-xs leading-relaxed text-smoke">{run.isolationNote}</p>
        </Card>
      )}

      {steps.length > 0 && (
        <PageSection title={t(locale, "runs.steps")}>
          <Steps steps={steps} locale={locale} />
        </PageSection>
      )}

      {run.patch && (
        <PageSection title={t(locale, "runs.patchLines", { n: run.patch.split("\n").length })}>
          <Patch patch={run.patch} />
        </PageSection>
      )}
    </PageShell>
  );
}
