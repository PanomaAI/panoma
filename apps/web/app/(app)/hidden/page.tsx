import Link from "next/link";
import { listHidden } from "@panoma/db";
import { db } from "@/lib/db";
import { Readmit, Unhide } from "@/components/hidden-actions";
import { PageSection, PageShell } from "@/components/page-shell";
import { Card, EmptyState, ProjectIcon, relativeDate } from "@/components/primitives";
import { Rich } from "@/components/rich-text";
import { getLocale, t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.hidden") };
}

/**
 * What you have taken out of sight, and how to return it.
 *
 * It exists because hiding and excluding are only acceptable if they are reversible, and a
 * reversible action whose undo cannot be found anywhere is, in practice, a definitive action.
 */
export default async function HiddenPage() {
  const { db: database } = await db();
  const [{ hidden, excluded }, locale] = await Promise.all([listHidden(database), getLocale()]);

  /*
    The disk note stays in the header and keeps its own frame: it is the one line on this page that
    promises nothing is deleted, and a tinted box is what says «read this» without needing a word
    for it. It is not the shell's `note`, which is the monospaced line of figures other screens
    carry — this one is prose, and green.
   */
  const diskNote = (
    <p className="mt-4 max-w-2xl rounded border border-live/30 bg-live/[0.06] p-3 text-xs leading-relaxed text-smoke">
      {t(locale, "hidden.diskNote")}
    </p>
  );

  return (
    <PageShell
      eyebrow={t(locale, "nav.hidden")}
      title={
        hidden.length + excluded.length === 0
          ? t(locale, "hidden.empty")
          : t(locale, "hidden.count", { n: hidden.length, m: excluded.length })
      }
      lead={
        <Rich
          text={t(locale, "hidden.intro")}
          slots={{
            hidden: (
              <strong className="font-medium text-chalk">{t(locale, "hidden.wordHidden")}</strong>
            ),
            excluded: (
              <strong className="font-medium text-chalk">{t(locale, "hidden.wordExcluded")}</strong>
            ),
          }}
        />
      }
      headExtra={diskNote}
    >
      {hidden.length > 0 && (
        <PageSection title={t(locale, "hidden.sectionHidden", { n: hidden.length })}>
          <ul className="space-y-2">
            {hidden.map((project) => (
              <Card
                as="li"
                pad="sm"
                key={project.id}
                className="flex flex-wrap items-center gap-3"
              >
                <ProjectIcon
                  name={project.name}
                  src={project.hasIcon ? `/icon/${project.id}` : null}
                  size={34}
                  locale={locale}
                />
                <div className="min-w-0 flex-1">
                  <Link href={`/p/${project.slug}`} className="text-sm font-medium hover:text-accent">
                    {project.name}
                  </Link>
                  <p className="truncate font-mono text-[11px] text-faint" title={project.root}>
                    {project.root}
                  </p>
                </div>
                <Unhide projectId={project.id} />
              </Card>
            ))}
          </ul>
        </PageSection>
      )}

      {excluded.length > 0 && (
        <PageSection title={t(locale, "hidden.sectionExcluded", { n: excluded.length })}>
          <ul className="space-y-2">
            {excluded.map((entry) => (
              <Card
                as="li"
                pad="sm"
                key={entry.root}
                className="flex flex-wrap items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{entry.name}</p>
                  <p className="truncate font-mono text-[11px] text-faint" title={entry.root}>
                    {entry.root} ·{" "}
                    {t(locale, "hidden.outSince", {
                      when: relativeDate(entry.excludedAt, locale),
                    })}
                  </p>
                </div>
                <Readmit root={entry.root} />
              </Card>
            ))}
          </ul>
          <p className="mt-3 font-mono text-[11px] text-faint">
            <Rich
              text={t(locale, "hidden.readmitNote")}
              slots={{ cmd: <code>panoma scan</code> }}
            />
          </p>
        </PageSection>
      )}

      {hidden.length + excluded.length === 0 && (
        <PageSection>
          <Card pad="lg">
            <EmptyState variant="note" title={t(locale, "hidden.emptyBody")} />
          </Card>
        </PageSection>
      )}
    </PageShell>
  );
}
