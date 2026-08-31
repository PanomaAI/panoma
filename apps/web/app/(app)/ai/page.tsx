import { getLocale, t } from "@/lib/i18n";
import { AiPanel } from "@/components/ai-panel";

export const dynamic = "force-dynamic";

/*
  It was the only page without its own title: all the others say «Something · Panoma» and this one
  stayed at the default «Panoma», so in a window with several catalog tabs open there was no way
  to know which one it was. It is labeled as the menu calls it.
 */
export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.ai") };
}

/**
 * What model does Panoma use, and how is it connected.
 *
 * The entire machinery existed —provider catalog, credentials with a lock and atomic writing,
 * delegation to installed agents— and `panoma ai` existed to manage it. What did not exist was the
 * door from the browser: the "explain what it is about" button on a record failed, saying
 * "configure a provider with Panoma ai use," which sends someone who is already in front of
 * this to another application.
 *
 * The panel is split in two for a matter of gesture, not manufacturer: **connecting an account and
 * pasting a key are nothing alike.** On top, what you already have —if you pay for Claude Pro and
 * have `claude` with the session started, Panoma passes the work along and doesn't see any
 * credentials—. Below, the keys API, which do need to be saved to disk.
 *
 * **This page doesn't read anything.** Neither the settings, nor the keys, nor which agents exist:
 * all of that is requested by the panel to `GET /api/ai` already masked. It is not a style
 * preference — a server component that opens a file with secrets inside publishes them to HTML in
 * development mode, which is the mode in which `panoma up` runs. The full, measured reason is in
 * the header of `app/api/ai/route.ts`.
 */
export default async function AiPage() {
  const locale = await getLocale();

  return (
    <main id="app-main" tabIndex={-1} className="app-main legacy-page">
      <section className="pt-12">
        <p className="eyebrow">{t(locale, "nav.ai")}</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
          {t(locale, "ai.title")}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-smoke">
          {t(locale, "ai.intro")}
        </p>
      </section>

      <AiPanel />
    </main>
  );
}
