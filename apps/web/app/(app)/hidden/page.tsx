import Link from "next/link";
import { listHidden } from "@panoma/db";
import { db } from "@/lib/db";
import { Readmit, Unhide } from "@/components/hidden-actions";
import { ProjectIcon, relativeDate } from "@/components/primitives";
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

  return (
    <main id="app-main" tabIndex={-1} className="app-main legacy-page">
      <section className="pt-12">
        <p className="eyebrow">{t(locale, "nav.hidden")}</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
          {hidden.length + excluded.length === 0
            ? t(locale, "hidden.empty")
            : t(locale, "hidden.count", { hidden: hidden.length, excluded: excluded.length })}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-smoke">
          <Rich
            text={t(locale, "hidden.intro")}
            slots={{
              hidden: (
                <strong className="font-medium text-chalk">
                  {t(locale, "hidden.wordHidden")}
                </strong>
              ),
              excluded: (
                <strong className="font-medium text-chalk">
                  {t(locale, "hidden.wordExcluded")}
                </strong>
              ),
            }}
          />
        </p>
        <p className="mt-3 max-w-2xl rounded border border-live/30 bg-live/[0.06] p-3 text-xs leading-relaxed text-smoke">
          {t(locale, "hidden.diskNote")}
        </p>
      </section>

      {hidden.length > 0 && (
        <Section title={t(locale, "hidden.sectionHidden", { n: hidden.length })}>
          <ul className="space-y-2">
            {hidden.map((project) => (
              <li
                key={project.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-edge bg-surface p-3"
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
              </li>
            ))}
          </ul>
        </Section>
      )}

      {excluded.length > 0 && (
        <Section title={t(locale, "hidden.sectionExcluded", { n: excluded.length })}>
          <ul className="space-y-2">
            {excluded.map((entry) => (
              <li
                key={entry.root}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-edge bg-surface p-3"
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
              </li>
            ))}
          </ul>
          <p className="mt-3 font-mono text-[11px] text-faint">
            <Rich
              text={t(locale, "hidden.readmitNote")}
              slots={{ cmd: <code>panoma scan</code> }}
            />
          </p>
        </Section>
      )}

      {hidden.length + excluded.length === 0 && (
        <p className="mt-10 rounded-lg border border-edge bg-surface p-6 text-sm text-smoke">
          {t(locale, "hidden.emptyBody")}
        </p>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="eyebrow mb-3 border-b border-edge pb-2">{title}</h2>
      {children}
    </section>
  );
}
