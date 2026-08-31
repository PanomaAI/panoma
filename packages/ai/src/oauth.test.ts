import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { expired, createChallenge, accountFrom, redirectUri, authorizeUrl } from "./oauth";
import { PROVIDERS, findProvider } from "./providers";

/**
 * What is established here is what makes a stolen authorization code useless, and what ties each
 * return to the request that started it. It is the part of the login that cannot be tested
 * manually: if the challenge or the `state` went wrong, the flow would continue to work perfectly
 * and only what it protects would be broken.
 */

const CODEX = findProvider("openai-codex")!;

describe("el desafío PKCE", () => {
  it("el desafío es el sha256 del verificador, en base64url", () => {
    const challenge = createChallenge();
    const expected = createHash("sha256").update(challenge.verifier).digest("base64url");
    expect(challenge.challenge).toBe(expected);
  });

  it("no se repite: dos inicios de sesión no comparten secreto", () => {
    const some = Array.from({ length: 50 }, () => createChallenge());
    expect(new Set(some.map((d) => d.verifier)).size).toBe(50);
    expect(new Set(some.map((d) => d.state)).size).toBe(50);
  });

  it("son suficientemente largos y sin caracteres que haya que escapar", () => {
    const { verifier, challenge, state } = createChallenge();
    // The minimum of the specification is 43; less than that is guessable by brute force.
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    for (const value of [verifier, challenge, state]) {
      expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe("la URL de autorización", () => {
  const challenge = createChallenge();
  const url = new URL(authorizeUrl(CODEX, challenge));

  it("va al emisor por https", () => {
    expect(url.origin).toBe("https://auth.openai.com");
    expect(url.pathname).toBe("/oauth/authorize");
  });

  it("lleva el desafío, nunca el verificador", () => {
    expect(url.searchParams.get("code_challenge")).toBe(challenge.challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // The important thing about the test: the verifier is the secret that stays at home. If it
    // appeared in the URL, PKCE would stop protecting anything.
    expect(url.toString()).not.toContain(challenge.verifier);
  });

  it("lleva el `state` y los permisos que hacen falta", () => {
    expect(url.searchParams.get("state")).toBe(challenge.state);
    const scopes = (url.searchParams.get("scope") ?? "").split(" ");
    // Without `offline_access` there is no refresh token, and you would have to log in again every
    // few hours — the failure would be noticed a week later, not on the first day.
    expect(scopes).toContain("offline_access");
  });

  it("el retorno es loopback, en el puerto y la ruta que fija el fabricante", () => {
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
    expect(redirectUri(CODEX)).toBe("http://localhost:1455/auth/callback");
  });

  it("un proveedor sin inicio de sesión no compone ninguna URL", () => {
    const withKey = findProvider("anthropic")!;
    expect(() => authorizeUrl(withKey, challenge)).toThrow();
  });
});

describe("la cuenta sale del id_token, y un id_token roto no tumba la sesión", () => {
  function idToken(claims: unknown): string {
    const chunk = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `cabecera.${chunk}.firma`;
  }

  it("lee la cuenta de ChatGPT", () => {
    const token = idToken({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_123" } });
    expect(accountFrom(token)).toBe("acct_123");
  });

  it("sin la afirmación, sin cuenta — y sin excepción", () => {
    expect(accountFrom(idToken({ sub: "quien-sea" }))).toBeUndefined();
    expect(accountFrom(undefined)).toBeUndefined();
    expect(accountFrom("esto-no-es-un-jwt")).toBeUndefined();
    expect(accountFrom("a.no-es-base64-válido-{}.c")).toBeUndefined();
  });
});

describe("la caducidad se adelanta a propósito", () => {
  it("un token sin fecha no caduca", () => {
    expect(expired({ access: "x" })).toBe(false);
  });

  it("uno que caduca dentro de un minuto ya cuenta como caducado", () => {
    // The margin exists so that a long request doesn't get cut off halfway with the token expiring
    // along the way: it refreshes before, not after it has already failed.
    expect(expired({ access: "x", expiresAt: Date.now() + 60_000 })).toBe(true);
  });

  it("uno con una hora por delante, no", () => {
    expect(expired({ access: "x", expiresAt: Date.now() + 3_600_000 })).toBe(false);
  });
});

describe("el catálogo de proveedores se mantiene coherente", () => {
  it("no hay dos con el mismo id", () => {
    expect(new Set(PROVIDERS.map((p) => p.id)).size).toBe(PROVIDERS.length);
  });

  it("cada proveedor trae lo que su forma de autenticarse necesita", () => {
    for (const provider of PROVIDERS) {
      if (provider.auth === "api-key") {
        expect(provider.baseUrl, provider.id).toBeTruthy();
        expect(provider.api, provider.id).toBeTruthy();
        expect(provider.apiKeyEnvVars?.length, provider.id).toBeGreaterThan(0);
      }
      if (provider.auth === "cli") expect(provider.command, provider.id).toBeTruthy();
      if (provider.auth === "oauth") {
        expect(provider.oauth?.clientId, provider.id).toBeTruthy();
        expect(provider.oauth?.authorizeUrl.startsWith("https://"), provider.id).toBe(true);
        expect(provider.oauth?.tokenUrl.startsWith("https://"), provider.id).toBe(true);
      }
    }
  });

  it("ningún endpoint remoto viaja por http", () => {
    for (const provider of PROVIDERS) {
      const url = provider.baseUrl ?? "";
      // Local ones yes: there is no network to spy on between your process and your own laptop.
      const local = url.includes("127.0.0.1") || url.includes("localhost");
      if (url && !local) expect(url.startsWith("https://"), provider.id).toBe(true);
    }
  });
});
