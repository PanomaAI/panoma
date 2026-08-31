import { AiError, ConfigCorruptError, NoCredentialError, VisionUnsupportedError } from "@panoma/ai";
import { cliName } from "@/lib/cli-name";
import { t, type Locale, type MessageKey } from "@/lib/i18n";

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
          : t(locale, "model.hintKey", {
              cli: cliName(),
              id: provider.id,
              url: provider.signupUrl ?? "",
            });
    return { detail: t(locale, "model.noCredential", { name: provider.name }), hint };
  }

  /*
    The typed failure, and no longer the sentence read as a key.

    This used to test `message.includes("proveedor de IA")`: a Spanish string standing in for an
    identifier, which would have gone quiet the first time somebody reworded it — and every other
    failure from that package reached the screen in Spanish whatever language was showing. The
    package carries `failure` now, so the code decides and the prose does not.
   */
  if (error instanceof AiError) {
    const f = error.failure;
    if (f.code === "noProvider") {
      return {
        detail: t(locale, "model.noneConnected"),
        hint: t(locale, "model.connectHint", { cli: cliName() }),
      };
    }
    return {
      detail: t(locale, `aiFail.${f.code}` as MessageKey, {
        provider: "provider" in f ? f.provider : "",
        command: "command" in f ? f.command : "",
        reason: "reason" in f ? f.reason : "",
        status: "status" in f ? String(f.status) : "",
        where: "where" in f ? f.where : "",
        /* Closing the sentence, which is where a figure goes in this repository. */
        attempts: "attempts" in f ? String(f.attempts) : "",
        /*
          One slot for the part that is somebody else's — a provider's refusal, a hostname, a path,
          the command to remove a lock. It travels whole and untranslated, which is the difference
          between saying what happened and inventing what they said.
         */
        detail:
          "detail" in f ? f.detail
          : "output" in f ? f.output
          : "last" in f ? f.last
          : "host" in f ? f.host
          : "value" in f ? f.value
          : "lock" in f ? `rm ${f.lock}`
          : "id" in f ? f.id
          : "",
      }),
    };
  }

  if (error instanceof VisionUnsupportedError) {
    return { detail: t(locale, "aiFail.visionUnsupported", { provider: error.provider }) };
  }

  /* Its own recovery lines stay as they are: they are commands to type, not prose to translate. */
  if (error instanceof ConfigCorruptError) {
    return {
      detail: t(locale, "aiFail.configCorrupt", { detail: error.path }),
      hint: error.message.split("\n").slice(1).join(" ").trim() || undefined,
    };
  }

  return { detail: (error as Error).message ?? String(error) };
}
