import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, updateConfig } from "@panoma/ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appCredentialStatus, deleteAppCredential, saveAppCredential } from "./app-provider-credentials";

/*
  ElevenLabs must reach Video without becoming Panoma's text provider. Exercise the real config
  writer in a temporary home: credentials survive edits together, stay owner-only, and never
  appear in the status or in an error even when malformed JSON quotes a key.
 */
let taskHome: string;
const key = "elevenlabs-test-secret-123456789";

beforeEach(async () => {
  taskHome = await mkdtemp(join(tmpdir(), "panoma-app-credentials-"));
  vi.stubEnv("PANOMA_HOME", taskHome);
  vi.stubEnv("ELEVENLABS_API_KEY", "environment-key-must-not-be-used");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(taskHome, { recursive: true, force: true });
});

describe("the app's saved voice credential", () => {
  it("ignores the inherited environment and never selects a text provider when saving", async () => {
    expect(await appCredentialStatus("panoma-video")).toEqual({ provider: "elevenlabs", configured: false, source: null });
    expect(await saveAppCredential("panoma-video", { provider: "elevenlabs", key: ` ${key} ` }))
      .toEqual({ provider: "elevenlabs", configured: true, source: "file" });
    expect(await readConfig()).toEqual({ keys: { elevenlabs: key } });
    expect(JSON.stringify(await appCredentialStatus("panoma-video"))).not.toContain(key);
    if (process.platform !== "win32") expect((await stat(join(taskHome, "ai.json"))).mode & 0o777).toBe(0o600);
  });

  it("preserves the active model, other credentials and concurrent changes through save and removal", async () => {
    await updateConfig(() => ({ provider: "openai", model: "chosen-model", keys: { openai: "text-key" },
      tokens: { account: { access: "session-token" } } }));
    await Promise.all([
      saveAppCredential("panoma-video", { provider: "elevenlabs", key }),
      updateConfig(config => ({ ...config, keys: { ...config.keys, anthropic: "other-key" } })),
    ]);
    expect(await readConfig()).toEqual({ provider: "openai", model: "chosen-model",
      keys: { openai: "text-key", anthropic: "other-key", elevenlabs: key },
      tokens: { account: { access: "session-token" } } });
    expect(await deleteAppCredential("panoma-video", { provider: "elevenlabs" }))
      .toEqual({ provider: "elevenlabs", configured: false, source: null });
    expect(await readConfig()).toEqual({ provider: "openai", model: "chosen-model",
      keys: { openai: "text-key", anthropic: "other-key" }, tokens: { account: { access: "session-token" } } });
  });

  it("rejects unlisted apps, providers and settings before writing anything", async () => {
    await expect(appCredentialStatus("another-app")).rejects.toThrow("unknown-app");
    await expect(saveAppCredential("another-app", { provider: "elevenlabs", key })).rejects.toThrow("unknown-app");
    await expect(saveAppCredential("panoma-video", { provider: "openai", key })).rejects.toThrow("invalid-provider");
    await expect(deleteAppCredential("panoma-video", { provider: "openai" })).rejects.toThrow("invalid-provider");
    await expect(saveAppCredential("panoma-video", { provider: "elevenlabs", key, voice: true, confirm: true }))
      .rejects.toThrow("invalid-credential-body");
    await expect(deleteAppCredential("panoma-video", { provider: "elevenlabs", key }))
      .rejects.toThrow("invalid-credential-body");
    expect(await readConfig()).toEqual({});
  });

  it("rejects missing, oversized and multiline secrets without echoing them", async () => {
    for (const value of [undefined, null, 123, "", " ", "k".repeat(501), "key\nsecond-line", "key\u0000suffix"]) {
      await expect(saveAppCredential("panoma-video", { provider: "elevenlabs", key: value }))
        .rejects.toThrow(/^invalid-credential-key$/);
    }
    expect(await readConfig()).toEqual({});
  });

  it("leaves corrupt configuration intact and returns only a static error", async () => {
    const broken = `{"keys":{"elevenlabs":"${key}"}, broken}`;
    await writeFile(join(taskHome, "ai.json"), broken, { mode: 0o600 });
    for (const attempt of [
      () => appCredentialStatus("panoma-video"),
      () => saveAppCredential("panoma-video", { provider: "elevenlabs", key: "replacement" }),
      () => deleteAppCredential("panoma-video", { provider: "elevenlabs" }),
    ]) await expect(attempt()).rejects.toThrow(/^credential-config-unreadable$/);
    expect(await readFile(join(taskHome, "ai.json"), "utf8")).toBe(broken);
  });
});
