import { CodeSearch } from "@/components/code-search";
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
    <main id="app-main" tabIndex={-1} className="app-main legacy-page">
      <section className="pt-12">
        <p className="eyebrow">{t(locale, "nav.searchCode")}</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
          {t(locale, "search.title")}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-smoke">
          {t(locale, "search.intro")}
        </p>
      </section>

      <div className="mt-8">
        <CodeSearch initialQuery={q ?? ""} />
      </div>
    </main>
  );
}
