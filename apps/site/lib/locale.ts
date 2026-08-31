import { cookies, headers } from "next/headers";

/**
 * The language of the one who arrives, and nothing more.
 *
 * In `apps/web` this lives inside `lib/i18n.ts`, which are 3,800 lines: the entire panel
 * dictionary, more than a thousand keys in two languages. public site does not translate by
 * dictionary—the landing page carries its copy in `landing-copy.ts`, and `/docs` is only in
 * English, which is the house rule for what a machine reads or whoever installs it—so from all
 * that, I only needed these thirty lines.
 *
 * They are a copy and not an import, and that is the boundary working: `apps/site` does not import
 * anything from `apps/web` on purpose. The duplication also cannot be desynchronized in a harmful
 * way, because since the site is deployed and the panel runs on `localhost`, they are two
 * different origins: **they do not share a cookie jar.** Someone who chooses Spanish on the
 * landing page does not carry that choice over to the panel on their laptop nor vice versa, so
 * what needs to be kept the same is the habit, not a piece of data. `locale.test.ts` fixes the
 * order.
 *
 * What does change compared to the original: there `next/headers` is loaded with a `new Function`
 * so that it does not enter the webpack graph, because `lib/i18n.ts` is also imported by sites
 * that are not Next. Here there are none, so the import is normal.
 */
export type Locale = "es" | "en";

/** The cookie that writes the selector of the landing footer, with `document.cookie`. */
export const LOCALE_COOKIE = "panoma-lang";

/**
 * Send the cookie; without it, the first browser hint in `Accept-Language` that is Spanish or
 * English. Browsers send that list already ordered by preference, so it is traversed as is: a
 * parser of `q` values to choose between two languages would be more code than criterion.
 */
export async function getLocale(): Promise<Locale> {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (saved === "es" || saved === "en") return saved;

  const accepted = (await headers()).get("accept-language") ?? "";
  return localeFromAcceptLanguage(accepted);
}

/**
 * Output English.
 *
 * The product was born in Spanish and the texts are still written there first, but outwardly the
 * door opens in English: whoever arrives without a cookie and without a recognizable header is,
 * almost always, someone who does not speak Spanish. Those who do speak it say it in their
 * `Accept-Language` and enter in Spanish without touching anything.
 *
 * Aside from `getLocale` to be able to test it without setting up a Next request.
 */
export function localeFromAcceptLanguage(accepted: string): Locale {
  for (const part of accepted.split(",")) {
    const tag = part.trim().toLowerCase();
    if (tag.startsWith("en")) return "en";
    if (tag.startsWith("es")) return "es";
  }
  return "en";
}
