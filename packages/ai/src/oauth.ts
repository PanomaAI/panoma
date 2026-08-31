import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Provider } from "./providers";
import { AiError } from "./failures";

/**
 * Sign in with a subscription, in the browser.
 *
 * OAuth 2.0 with PKCE and loopback return: the same dance performed by Codex's CLI, which is where
 * the constants come from. Here is only the mechanics; which providers use it and with what
 * limits, in `providers.ts`.
 *
 * The four defenses, each against a specific attack and none decorative:
 *
 * 1. **PKCE (S256).** The authorization code travels through the address bar and the history.
 * Without the verifier —which never leaves this process— a stolen code is useless.
 * 2. **`state` compared in constant time.** It is what ties the return to the request that started
 * it; without checking it, anyone who makes you open a URL can put their session into your Panoma.
 * 3. **Only loopback, and only one use.** The server listens on 127.0.0.1, handles one return, and
 * closes. An open port waiting forever is a door.
 * 4. **Deadline.** If no one returns in five minutes it closes anyway: an abandoned login cannot
 * leave a server hanging until Panoma is restarted.
 */

export interface Challenge {
  verifier: string;
  challenge: string;
  state: string;
}

export interface OauthToken {
  access: string;
  refresh?: string;
  /** Milliseconds since epoch. `resolveCredential` refreshes before arriving here. */
  expiresAt?: number;
  /** The account to which it is charged. It goes in a header in each request. */
  accountId?: string;
}

/** Verifier, challenge and `state`, all of `randomBytes`. Nothing of `Math.random`. */
export function createChallenge(): Challenge {
  const verifier = base64url(randomBytes(48));
  return {
    verifier,
    challenge: base64url(createHash("sha256").update(verifier).digest()),
    state: base64url(randomBytes(24)),
  };
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export function redirectUri(provider: Provider): string {
  const config = requireOauth(provider);
  // `localhost` and not `127.0.0.1`: it is the string registered in the manufacturer's application
  // and the comparison they make is literal.
  return `http://localhost:${config.redirectPort}${config.redirectPath}`;
}

export function authorizeUrl(provider: Provider, challenge: Challenge): string {
  const config = requireOauth(provider);
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(provider));
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("code_challenge", challenge.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", challenge.state);
  return url.toString();
}

/** Five minutes: the time it takes someone to read a permissions screen without rushing. */
const DEADLINE_MS = 300_000;

/**
 * Raises the return server, waits for the code, and closes.
 *
 * Returns the authorization code. Throws if the provider responds with an error, if the `state`
 * does not match, if the port is busy, or if the deadline expires.
 */
export function awaitCallback(provider: Provider, challenge: Challenge): Promise<string> {
  const config = requireOauth(provider);

  return new Promise<string>((resolve, reject) => {
    /*
      `let` and not `const`: `close()` captures it three lines below and `createServer` receives a
      handler that calls `finish`, so the statement has to go before the two.
     */
    // eslint-disable-next-line prefer-const -- ver el comentario de arriba
    let server: Server | undefined;
    const close = () => server?.close();

    const deadline = setTimeout(() => {
      close();
      reject(new AiError({ code: "oauthTimeout" }));
    }, DEADLINE_MS);

    const finish = (error: Error | null, code?: string) => {
      clearTimeout(deadline);
      close();
      if (error) reject(error);
      else resolve(code!);
    };

    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", `http://localhost:${config.redirectPort}`);
      if (url.pathname !== config.redirectPath) {
        response.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") ?? "";

      /*
        The `state` is compared in constant time and **before** looking at the code. Comparing
        with `===` filters by how long it takes to fail, which with a short secret is a real
        attack; and looking at the code first would mean you had already accepted it when you
        discover that the return wasn't yours.
       */
      if (!same(state, challenge.state)) {
        respond(response, 400, "Ese retorno no era de esta sesión.");
        finish(new Error("El «state» del retorno no coincide: se descarta."));
        return;
      }

      if (error) {
        respond(response, 400, "No se pudo iniciar sesión.");
        finish(new Error(`El proveedor devolvió «${error}».`));
        return;
      }
      if (!code) {
        respond(response, 400, "El retorno vino sin código.");
        finish(new Error("El retorno no traía código de autorización."));
        return;
      }

      respond(response, 200, "Listo. Ya puedes cerrar esta pestaña y volver a Panoma.");
      finish(null, code);
    });

    server.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(deadline);
      // The port is set by the manufacturer's application registry, so 'try another one' is not an
      // option: you have to say who has it and make them release it.
      reject(
        new Error(
          error.code === "EADDRINUSE"
            ? `El puerto ${config.redirectPort} está ocupado, y es el único que vale para este ` +
              `inicio de sesión. Suele ser un 'codex login' a medias: ciérralo y vuelve a probar.`
            : `No se pudo escuchar en el puerto ${config.redirectPort}: ${error.message}`,
        ),
      );
    });

    // Loopback only: listening on 0.0.0.0 would open the loopback to anyone on the same Wi-Fi,
    // which is the same flaw that was already fixed by serving Panoma on 127.0.0.1.
    server.listen(config.redirectPort, "127.0.0.1");
  });
}

function respond(response: import("node:http").ServerResponse, status: number, text: string) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(
    `<!doctype html><meta charset="utf-8"><title>Panoma</title>` +
      `<body style="font:15px system-ui;padding:3rem;color:#141722">${text}</body>`,
  );
}

/** Constant-time comparison that does not fail with different lengths. */
function same(a: string, b: string): boolean {
  const one = Buffer.from(a);
  const other = Buffer.from(b);
  if (one.length !== other.length) return false;
  return timingSafeEqual(one, other);
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export async function exchangeCode(
  provider: Provider,
  code: string,
  verifier: string,
): Promise<OauthToken> {
  return requestToken(provider, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(provider),
    code_verifier: verifier,
  });
}

export async function refresh(provider: Provider, refresh: string): Promise<OauthToken> {
  const token = await requestToken(provider, { grant_type: "refresh_token", refresh_token: refresh });
  // Some providers do not reissue the refresh one when refreshing: losing the old one would require
  // logging in again at the first renewal.
  return { ...token, refresh: token.refresh ?? refresh };
}

async function requestToken(
  provider: Provider,
  fields: Record<string, string>,
): Promise<OauthToken> {
  const config = requireOauth(provider);
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, client_id: config.clientId }),
  });

  const body = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !body.access_token) {
    throw new AiError({
      code: "tokenRefused",
      provider: provider.name,
      status: response.status,
      /* The provider's own words, whole: translating somebody else's refusal invents one. */
      detail: body.error_description ?? body.error ?? response.statusText,
    });
  }

  return {
    access: body.access_token,
    ...(body.refresh_token ? { refresh: body.refresh_token } : {}),
    ...(body.expires_in ? { expiresAt: Date.now() + body.expires_in * 1000 } : {}),
    ...(accountFrom(body.id_token) ? { accountId: accountFrom(body.id_token)! } : {}),
  };
}

/**
 * The account to which the charge is made, taken from the `id_token`.
 *
 * The assertions are read **without verifying the signature**, and that's fine: this token just
 * arrived via TLS from the issuer itself and is not used to decide anything — only to put in a
 * header which account the request goes to, which the server will check again. Verifying it here
 * would require bringing in the issuer's public keys for no gain.
 */
export function accountFrom(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined;
  const chunk = idToken.split(".")[1];
  if (!chunk) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(chunk, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const auth = claims["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
    const account = auth?.["chatgpt_account_id"];
    return typeof account === "string" ? account : undefined;
  } catch {
    // A `id_token` that is not understood is not a reason to discard a valid login: without an
    // account, the request will go to the user's default one.
    return undefined;
  }
}

/** Margin to refresh before it expires: a long request can't catch it just in time. */
export const MARGIN_MS = 120_000;

export function expired(token: OauthToken): boolean {
  return token.expiresAt !== undefined && Date.now() > token.expiresAt - MARGIN_MS;
}

function requireOauth(provider: Provider) {
  if (!provider.oauth) throw new AiError({ code: "noOauth", provider: provider.name });
  return provider.oauth;
}
