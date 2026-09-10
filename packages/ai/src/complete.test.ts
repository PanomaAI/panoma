import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedCredential } from "./credentials";
import { findProvider } from "./providers";

/**
 * What a call says it consumed, and what it says when it does not know.
 *
 * The ledger in `@panoma/db` stores null for a call that did not state its usage and forbids zero
 * there: null is 'unknown', zero is 'free', and a day's total that adds a few unknowns as zeros
 * lies downward exactly when the person is trying to find out what was spent. Two families
 * coerced a missing field with `?? 0`, so a response without a `usage` block —or with half of one—
 * came back as a free call. These tests pin the other behaviour: no usage stated, no usage field.
 *
 * The credential is doubled and `fetch` is stubbed, so nothing here leaves the machine.
 */

const doubled = vi.hoisted(() => ({ credential: undefined as ResolvedCredential | undefined }));

vi.mock("./credentials", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./credentials")>()),
  resolveCredential: async () => doubled.credential,
}));

import { complete } from "./complete";

/** A credential for a family, pointing at a host nobody will answer from. */
function through(id: "openai" | "openai-codex"): ResolvedCredential {
  return {
    provider: findProvider(id)!,
    model: "modelo-de-prueba",
    apiKey: "sk-de-prueba",
    baseUrl: "https://ejemplo.invalid/v1",
    source: "env",
  };
}

/** What the provider answers, whatever is asked. */
function answers(body: string): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
}

/** A chat completion in the OpenAI format, with the usage block given or left out. */
function chat(usage?: Record<string, number>): string {
  return JSON.stringify({
    model: "gpt-x",
    choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
    ...(usage ? { usage } : {}),
  });
}

/** The Codex event stream: one text delta and the completed response, with or without usage. */
function stream(usage?: Record<string, number>): string {
  const response = { model: "gpt-x", status: "completed", ...(usage ? { usage } : {}) };
  return [
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "ok" })}`,
    `data: ${JSON.stringify({ type: "response.completed", response })}`,
    "",
  ].join("\n");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the usage of a call through the openai family", () => {
  it("a response without usage yields no usage field, not zeros", async () => {
    doubled.credential = through("openai");
    answers(chat());

    const result = await complete({ prompt: "hola" });
    expect(result.text).toBe("ok");
    expect("usage" in result, "absent, so the ledger writes null and counts it unmetered").toBe(false);
  });

  it("half a usage is no usage", async () => {
    doubled.credential = through("openai");
    answers(chat({ prompt_tokens: 12 }));

    const result = await complete({ prompt: "hola" });
    expect("usage" in result).toBe(false);
  });

  it("both halves stated come through as they are", async () => {
    doubled.credential = through("openai");
    answers(chat({ prompt_tokens: 12, completion_tokens: 3 }));

    const result = await complete({ prompt: "hola" });
    expect(result.usage).toEqual({ input: 12, output: 3 });
  });
});

describe("the usage of a call through the codex family", () => {
  it("a completed response without usage yields no usage field, not zeros", async () => {
    doubled.credential = through("openai-codex");
    answers(stream());

    const result = await complete({ prompt: "hola" });
    expect(result.text).toBe("ok");
    expect(result.stopReason, "the final event did arrive").toBe("stop");
    expect("usage" in result).toBe(false);
  });

  it("half a usage is no usage", async () => {
    doubled.credential = through("openai-codex");
    answers(stream({ output_tokens: 3 }));

    const result = await complete({ prompt: "hola" });
    expect("usage" in result).toBe(false);
  });

  it("both halves stated come through as they are", async () => {
    doubled.credential = through("openai-codex");
    answers(stream({ input_tokens: 12, output_tokens: 3 }));

    const result = await complete({ prompt: "hola" });
    expect(result.usage).toEqual({ input: 12, output: 3 });
  });
});
