/**
 * What went wrong, said once and readable by both audiences.
 *
 * This package threw sentences in fixed Spanish, and both of its readers were wrong ones. The
 * terminal prints `error.message` raw and is a machine surface, where the house rule is English.
 * The browser is bilingual and got Spanish whichever language it was showing. `model-errors.ts`
 * had already patched the two worst cases, and its own comment admits how: one by a typed error,
 * the other by matching a Spanish substring — a sentence used as a key, which stops working the
 * day somebody rewords it and says nothing.
 *
 * So the failure travels as data. `message` is English, because that is what a machine reads and
 * what the CLI prints; `failure` carries the code and its parts, so the web can say the same thing
 * in the language in front of it without parsing prose.
 *
 * What is NOT here: anything a provider said. A 429, a refusal, the text of somebody else's API —
 * those are quotes, and translating a quote is inventing one. They travel inside `detail`, whole.
 */
export type AiFailure =
  /* The agent's own binary, and the three ways running it ends badly. */
  | { code: "noCommand"; provider: string }
  | { code: "launchFailed"; command: string; reason: string }
  | { code: "exited"; provider: string; status: number; output: string }
  /* An answer that arrived and was not usable. */
  | { code: "emptyBody"; provider: string }
  | { code: "providerRefused"; provider: string; status: number; detail: string }
  | { code: "tokenRefused"; provider: string; status: number; detail: string }
  | { code: "neverAnswered"; provider: string; last: string; attempts: number }
  /* The configuration on this disk. */
  | { code: "configShape" }
  | { code: "configLocked"; lock: string; holder: string | undefined }
  | { code: "noProvider" }
  | { code: "unknownProvider"; id: string }
  /* Signing in. */
  | { code: "oauthTimeout" }
  | { code: "noOauth"; provider: string }
  /* And the address a credential would be sent to, which is the one worth being rude about. */
  | { code: "badUrl"; provider: string; value: string; where: string }
  | { code: "notHttp"; provider: string }
  | { code: "urlHasCredentials"; provider: string }
  | { code: "insecureHost"; provider: string; host: string };

/**
 * The English sentence for a failure, written in one place.
 *
 * One place because two would drift: the whole point of carrying the code is that the message and
 * the translation cannot disagree about what happened.
 */
export function failureMessage(failure: AiFailure): string {
  switch (failure.code) {
    case "noCommand":
      return `${failure.provider} declares no command to run.`;
    case "launchFailed":
      return `Could not launch ${failure.command}: ${failure.reason}`;
    case "exited":
      return `${failure.provider} exited with code ${failure.status}. ${failure.output}`.trim();
    case "emptyBody":
      return `${failure.provider} answered with no body.`;
    case "providerRefused":
      return `${failure.provider} answered ${failure.status}: ${failure.detail}`;
    case "tokenRefused":
      return `${failure.provider} refused the token request (${failure.status}): ${failure.detail}`;
    case "neverAnswered":
      return (
        `${failure.provider} never answered: ${failure.last}. Attempts: ${failure.attempts}. ` +
        `The model did not say no — the request never left this machine.`
      );
    case "configShape":
      return "the contents are not shaped like a panoma configuration";
    case "configLocked":
      return (
        `Another panoma process is writing the configuration${failure.holder ? ` (${failure.holder})` : ""}.\n` +
        `If none is running, the lock was left behind by an earlier run:\n  rm ${failure.lock}`
      );
    case "noProvider":
      return "No AI provider is configured. Run 'panoma ai' to see the options.";
    case "unknownProvider":
      return `Unknown provider: ${failure.id}`;
    case "oauthTimeout":
      return "Timed out waiting for you to come back from the browser.";
    case "noOauth":
      return `${failure.provider} does not use sign-in.`;
    case "badUrl":
      return `${failure.provider}'s address is not a valid URL: «${failure.value}». Check ${failure.where}.`;
    case "notHttp":
      return `${failure.provider}'s address has to be http or https.`;
    case "urlHasCredentials":
      return `${failure.provider}'s address carries a user or a password inside. Take them out and use the key.`;
    case "insecureHost":
      return (
        `panoma will not send ${failure.provider}'s credential unencrypted to ${failure.host}. ` +
        `Use https, or a server on your own machine.`
      );
  }
}

/**
 * An error this package raised about itself.
 *
 * `instanceof` rather than a string check, so that whoever translates it is reading a type and not
 * guessing at prose. The two typed errors that already existed —`NoCredentialError` and
 * `ConfigCorruptError`— keep their own classes: they carry more than a code and were already
 * being read that way.
 */
export class AiError extends Error {
  readonly failure: AiFailure;

  constructor(failure: AiFailure) {
    super(failureMessage(failure));
    this.name = "AiError";
    this.failure = failure;
  }
}
