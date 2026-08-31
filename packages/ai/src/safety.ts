import type { Provider } from "./providers";

/**
 * The two things that can take a credential from this machine without anyone noticing.
 *
 * They went out to see how it is resolved by the open agents, and to find that hardly anyone
 * solves one of the two:
 *
 * 1. **That the key ends up written in a message.** Panoma shows the provider's errors as they
 * are, deliberately, because its message explains what happened; the cost is that any
 * provider that returns the key in its error displays it on the screen. It is crossed out before
 * it comes out.
 * 2. **That the key is sent to the wrong place.** The norm out there is a `base_url` available
 * with documentation saying that putting in the correct one is up to the user. Here that means
 * that a `OPENAI_BASE_URL` pointing to another site sends your OpenAI key to that other site, and
 * if it’s `http://`, in clear text over the network. Tying the credential to the configured origin
 * is the minimum rule that doesn’t get in the way, and it’s the one that is applied.
 */

/**
 * Check where the credential is going to be sent. Throw if it is not a place to send it.
 *
 * What it **does not** do is prohibit changing locations: pointing to your own gateway, to
 * LiteLLM, or to a local model is a legitimate use and is half the fun of having `baseUrlEnvVar`.
 * What is prohibited is what has no legitimate use: sending a secret in plain text outside of this
 * machine, and sending it to a URL that has a built-in username and password.
 */
export function checkBaseUrl(provider: Provider, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `La dirección de ${provider.name} no es una URL válida: «${value}». ` +
        `Revisa ${provider.baseUrlEnvVar ?? "la configuración"}.`,
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`La dirección de ${provider.name} tiene que ser http o https.`);
  }

  /*
    User and password inside the URL: out.
    `https://who:sea@host/v1` sends some credentials that no one has reviewed, they travel in
    every record saved by URL and are not the ones Panoma believes it is using. There is no
    legitimate case that needs them: whoever has a gateway with a password uses their API key.
   */
  if (url.username || url.password) {
    throw new Error(
      `La dirección de ${provider.name} lleva usuario o contraseña dentro. Quítalos y usa la clave.`,
    );
  }

  // In cleartext only against your own machine: there is no network to spy on between the process
  // and the model. Outside of loopback, `http://` is the key traveling in plain sight of anyone.
  if (url.protocol === "http:" && !isLocal(url.hostname)) {
    throw new Error(
      `Panoma no manda la credencial de ${provider.name} sin cifrar a ${url.hostname}. ` +
        `Usa https, o un servidor en tu propia máquina.`,
    );
  }

  return value;
}

/** Loopback, in its three writings. Everything else is 'another machine'. */
function isLocal(hostname: string): boolean {
  const clean = hostname.replace(/^\[|\]$/g, "");
  return clean === "localhost" || clean === "127.0.0.1" || clean === "::1";
}

/** Whether the address differs from the one supplied by the provider. Report it; do not cancel. */
export function pointsElsewhere(provider: Provider, url: string | undefined): boolean {
  if (!url || !provider.baseUrl) return false;
  try {
    return new URL(url).origin !== new URL(provider.baseUrl).origin;
  } catch {
    return false;
  }
}

/*
  Known forms of credential. The list matters little compared to the generic rule below, but it
  catches the short ones —the twenty-some-character ones— that the rule barely misses.
 */
const SHAPES = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bgsk_[A-Za-z0-9]{8,}/g,
  /\bxai-[A-Za-z0-9]{8,}/g,
  /\bAIza[A-Za-z0-9_-]{8,}/g,
  /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{8,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{8,}/g,
  /\bhf_[A-Za-z0-9]{8,}/g,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
];

/**
 * What is rendered in the place of a secret. Short and obvious: it does not seem to be part of the
 * message.
 */
export const REDACTED = "«credencial oculta»";

/**
 * Cross out credentials in a text before anyone sees it.
 *
 * It applies to provider error messages, which Panoma shows integers because their content is what
 * explains what failed — and because a provider can perfectly well return the key within its own
 * error (‘invalid api key: sk-…’). It also applies to the output of CLI agents, which is loose
 * text from an external process.
 *
 * `known` is the strongest thing it has: the credential that Panoma is using right now is marked
 * for exact match, regardless of whether it has a recognizable form. The expressions above are for
 * what comes from another place.
 */
export function redact(text: string, known: (string | undefined)[] = []): string {
  let output = text;

  for (const secret of known) {
    // Four characters is already a ridiculous secret, but below that what there is is an empty or
    // test value, and crossing out two-letter strings would destroy the message.
    if (!secret || secret.length < 4) continue;
    output = output.split(secret).join(REDACTED);
  }

  for (const shape of SHAPES) output = output.replace(shape, REDACTED);

  /*
    And the generic network: any long string of credential characters.
    Forty is the threshold because below it things that are not secrets start to fall—model
    identifiers, paths, short sums—and an error message crossed out as unnecessary stops serving
    for what it was intended. Above forty, in an error message, almost nothing that is not a
    credential.
   */
  return output.replace(/\b[A-Za-z0-9_-]{40,}\b/g, REDACTED);
}
