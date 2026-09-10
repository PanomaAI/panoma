import Link from "next/link";
import { getStats, listFamilies, stateOf } from "@panoma/db";
import { db } from "@/lib/db";
import { PageSection, PageShell } from "@/components/page-shell";
import { Card, EmptyState, StateDot, formatBytes } from "@/components/primitives";
import { Rich } from "@/components/rich-text";
import { cliName } from "@/lib/cli-name";
import { getLocale, t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.copies") };
}

export default async function CopiesPage() {
  const { db: database } = await db();
  const [families, stats, locale] = await Promise.all([
    listFamilies(database),
    getStats(database),
    getLocale(),
  ]);

  /*
    `n` and not `families`: the shape gap that keeps «1 familias» away looks at that name and no
    other. See the key in `lib/i18n.ts`.
   */
  const counted = t(locale, "families.stats", {
    n: families.length,
    bytes: formatBytes(stats.redundantBytes),
  });

  return (
    <PageShell
      eyebrow={t(locale, "nav.copies")}
      title={t(locale, stats.copies === 1 ? "families.titleOne" : "families.titleMany", {
        n: stats.copies,
      })}
      lead={t(locale, "families.intro")}
      note={counted}
    >
      <PageSection>
        {families.length === 0 ? (
          /*
             The house empty state, not a ninth panel of its own. The whole sentence is the title
             because the dictionary holds it as one string with one `{cmd}` gap in the middle:
             splitting it into a heading and a line would mean two new keys in two languages, and
             `families.empty` is already the shape a translator agreed to.
            */
          <EmptyState
            title={
              <Rich
                text={t(locale, "families.empty")}
                slots={{
                  cmd: (
                    <code className="font-mono text-chalk">{cliName()} scan ~/Desktop --save</code>
                  ),
                }}
              />
            }
          />
        ) : (
          <ul className="space-y-8">
            {families.map((family) => (
              <Card key={family.id} as="li" pad="none">
                <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-edge px-5 py-3">
                  <h2 className="font-display text-lg font-semibold tracking-tight">
                    {family.name}
                  </h2>
                  <p className="font-mono text-[11px] text-faint">
                    {t(locale, "families.copiesAndSize", {
                      n: family.copies.length,
                      bytes: formatBytes(family.redundantBytes),
                    })}
                  </p>
                </div>

                <div className="px-5 py-3">
                  <Link
                    href={`/p/${family.canonical.slug}`}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded py-1.5 hover:text-accent"
                  >
                    {/*
                       “Main” and not “alive”: choosing the canonical one is a *relative* judgment
                       — of these copies, this is the one to keep — and rendering it green with the
                       word “alive” turned it into an *absolute* statement about the project. An
                       entire family abandoned three years ago appeared in green and saying it was
                       alive. the real status is calculated separately, with the same function as
                       the rest of the catalog.
                      */}
                    <span className="font-mono text-[11px] text-accent">
                      {t(locale, "families.canonical")}
                    </span>
                    <StateDot state={stateOf(family.canonical.lastCommitAt)} withLabel locale={locale} />
                    <span className="font-mono text-xs">{shorten(family.canonical.root)}</span>
                    <span className="font-mono text-[11px] text-faint">
                      {family.canonicalReason}
                    </span>
                  </Link>

                  <ul className="mt-1">
                    {family.copies.map((copy) => (
                      <li
                        key={copy.root}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-edge/50 py-1.5"
                      >
                        <span className="w-10 font-mono text-[11px] text-faint">
                          {t(locale, "families.copy")}
                        </span>
                        <span className="font-mono text-xs text-smoke">
                          {shorten(copy.root)}
                        </span>
                        <span className="ml-auto font-mono text-[11px] text-idle">
                          {copy.daysBehind === null
                            ? t(locale, "families.noGit")
                            : copy.daysBehind === 0
                              ? t(locale, "families.sameDate")
                              : t(locale, "families.daysBehind", { n: copy.daysBehind })}
                        </span>
                        <span
                          className="font-mono text-[11px] text-faint"
                          title={copy.reason}
                        >
                          {Math.round(copy.confidence * 100)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            ))}
          </ul>
        )}
      </PageSection>
    </PageShell>
  );
}

/** Long absolute paths: only the last two folders matter. */
function shorten(root: string): string {
  const parts = root.split("/");
  return parts.length <= 3 ? root : `…/${parts.slice(-2).join("/")}`;
}
