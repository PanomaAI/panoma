import { CodeSearch } from "@/components/code-search";
import { PageSection, PageShell } from "@/components/page-shell";
import { getLocale, t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/*
  The tab title is also interface text. With `metadata` fixed it said 'Search in the code' for
  anyone who had the entire application in English.
 */
export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.searchCode") };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ q }, locale] = await Promise.all([searchParams, getLocale()]);

  return (
    <PageShell
      eyebrow={t(locale, "nav.searchCode")}
      title={t(locale, "search.title")}
      lead={t(locale, "search.intro")}
    >
      <PageSection>
        <CodeSearch initialQuery={q ?? ""} />
      </PageSection>
    </PageShell>
  );
}
