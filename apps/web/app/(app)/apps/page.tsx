import { AppsCatalog } from "@/components/apps-catalog";
import { PageShell } from "@/components/page-shell";
import { getLocale, t } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export async function generateMetadata() { return { title: t(await getLocale(), "apps.title") }; }

export default async function AppsPage() {
  const locale = await getLocale();
  /*
    The header is the shell's, and the body is `AppsCatalog` on its own.
    This page was one of the three that opened with `py-12` where its fifteen siblings wrote
    `pt-12`: `app-layout.css` cancels only the second spelling, so it sat 48px lower than they did
    for no reason anybody chose. On the shell there is nothing left to spell twice.
    `AppsCatalog` is NOT wrapped in `<PageSection>`: its grid already opens with `mt-8`, which is
    the same 32px the section would add, and the two would stack into a 64px hole under the lead.
   */
  return (
    <PageShell
      eyebrow={t(locale, "apps.official")}
      title={t(locale, "apps.title")}
      lead={t(locale, "apps.intro")}
    >
      <AppsCatalog />
    </PageShell>
  );
}
