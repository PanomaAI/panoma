import { NoCredentialError } from "@panoma/ai";
import { t, type Locale } from "@/lib/i18n";

/**
 * The model failure, described in the viewer's language —truly.
 *
 * Five routes repeated the same idea halfway: framing in the client's language a message that
 * arrived in fixed Spanish from `@panoma/ai`, using the excuse that 'it's what the provider said.'
 * For the two errors that every newcomer sees, that excuse is false: 'no provider configured' and
 * 'missing X's credential' are not said by any provider — there is none to quote — they are said
 * by Panoma. And Panoma does know languages.
 *
 * `NoCredentialError` travels typed from `@panoma/ai` with the entire provider inside, so here the
 * complete remedy is drafted in the language of the viewer, without guessing anything about the
 * text. The “without provider” case arrives as `Error` plain; it is recognized by the only
 * sentence that produces it. Everything else —a 429 from the provider, the network down— is indeed
 * someone else’s word or technical detail, and is left as is: translating that would be inventing.
 */
export function modelErrorParts(
  locale: Locale,
  error: unknown,
): { detail: string; hint?: string } {
  if (error instanceof NoCredentialError) {
    const { provider } = error;
    const hint =
      provider.auth === "cli"
        ? t(locale, "model.hintCli", { name: provider.name, command: provider.command ?? provider.id })
        : provider.auth === "oauth"
          ? t(locale, "model.hintOauth", { name: provider.name })
          : t(locale, "model.hintKey", { id: provider.id, url: provider.signupUrl ?? "" });
    return { detail: t(locale, "model.noCredential", { name: provider.name }), hint };
  }

  const message = (error as Error).message ?? String(error);
  if (message.includes("proveedor de IA")) {
    return {
      detail: t(locale, "model.noneConnected"),
      hint: t(locale, "model.connectHint"),
    };
  }

  return { detail: message };
}
