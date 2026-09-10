import { getLocale, t } from "@/lib/i18n";
import { AiPanel } from "@/components/ai-panel";
import { PageShell } from "@/components/page-shell";

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
    <PageShell
      eyebrow={t(locale, "nav.ai")}
      title={t(locale, "ai.title")}
      lead={t(locale, "ai.intro")}
    >
      {/*
         The panel keeps the gap it already declared, and there is no `PageSection` around it.
         It is a client component with five mutually exclusive branches —loading, load failed,
         remote catalog, unreadable file, and the real panel— and all five open with the same
         `mt-10`. The space above it is the panel's; a section here would put a second one on top
         of it and only on this screen.
        */}
      <AiPanel />
    </PageShell>
  );
}
