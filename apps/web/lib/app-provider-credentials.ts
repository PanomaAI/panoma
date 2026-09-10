import { ConfigCorruptError, readConfig, updateConfig } from "@panoma/ai";
import type { AppCredentialStatus } from "./apps-view";

/*
  Video already reads keys.elevenlabs from ai.json, but the text-model provider catalog does not
  contain a voice provider. Keep this door separate from app settings, which contain no secrets,
  and use the existing locked, owner-only writer without selecting ElevenLabs as the text model.
  Only the credentials route may call these functions: reading this file during a server render
  would expose its contents through Next's development instrumentation. See /api/ai.
 */
const PROVIDER = "elevenlabs";
const MAX_KEY = 500;

export type AppCredentialFault =
  | "unknown-app"
  | "invalid-credential-body"
  | "invalid-provider"
  | "invalid-credential-key"
  | "credential-config-unreadable"
  | "credential-write-failed";

/** A fixed code, never the underlying error: malformed JSON can quote a saved secret. */
export class AppCredentialError extends Error {
  constructor(readonly code: AppCredentialFault) {
    super(code);
    this.name = "AppCredentialError";
  }
}

function checkApp(id: string): void {
  if (id !== "panoma-video") throw new AppCredentialError("unknown-app");
}

function status(configured: boolean): AppCredentialStatus {
  return { provider: PROVIDER, configured, source: configured ? "file" : null };
}

function credentialBody(id: string, value: unknown, saving: boolean): Record<string, unknown> {
  checkApp(id);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppCredentialError("invalid-credential-body");
  }
  const body = value as Record<string, unknown>;
  const fields = saving ? ["provider", "key"] : ["provider"];
  if (Object.keys(body).some(key => !fields.includes(key))) {
    throw new AppCredentialError("invalid-credential-body");
  }
  if (body.provider !== PROVIDER) throw new AppCredentialError("invalid-provider");
  return body;
}

export async function appCredentialStatus(id: string): Promise<AppCredentialStatus> {
  checkApp(id);
  try {
    const config = await readConfig();
    // An exported ELEVENLABS_API_KEY is deliberately not a second path to the app child.
    return status(Boolean(config.keys?.[PROVIDER]?.trim()));
  } catch {
    throw new AppCredentialError("credential-config-unreadable");
  }
}

export async function saveAppCredential(id: string, value: unknown): Promise<AppCredentialStatus> {
  const body = credentialBody(id, value, true);
  if (typeof body.key !== "string") throw new AppCredentialError("invalid-credential-key");
  const key = body.key.trim();
  if (!key || key.length > MAX_KEY || /\s|\p{Cc}/u.test(key)) {
    throw new AppCredentialError("invalid-credential-key");
  }
  try {
    await updateConfig(config => ({ ...config, keys: { ...config.keys, [PROVIDER]: key } }));
  } catch (error) {
    throw new AppCredentialError(error instanceof ConfigCorruptError
      ? "credential-config-unreadable" : "credential-write-failed");
  }
  return status(true);
}

export async function deleteAppCredential(id: string, value: unknown): Promise<AppCredentialStatus> {
  credentialBody(id, value, false);
  try {
    await updateConfig(config => {
      const keys = { ...config.keys };
      delete keys[PROVIDER];
      return { ...config, keys };
    });
  } catch (error) {
    throw new AppCredentialError(error instanceof ConfigCorruptError
      ? "credential-config-unreadable" : "credential-write-failed");
  }
  return status(false);
}
