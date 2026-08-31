import { completeWithCliAgent } from "./cli-agent";
import { resolveCredential, type ResolvedCredential } from "./credentials";
import { redact } from "./safety";
import { callProvider } from "./transport";

/**
 * A single function to request text from a model, no matter the provider.
 *
 * The three families that need to be covered boil down to this:
 *
 * - **anthropic** — `/v1/messages`, header `x-api-key`, the text in `content[]`.
 * - **openai** — `/chat/completions`, header `Authorization: Bearer`. It is also supported by
 * OpenRouter, Gemini, Ollama, and LM Studio, so a single client covers five entries in the
 * catalog. This is the reason why 'compatible with OpenAI' is treated as a family and not as a
 * provider.
 * - **cli** — launch the user's installed agent.
 */

/**
 * An image that accompanies the prompt.
 *
 * `data` is in base64 and **without** the prefix `data:`: each family writes it in its own way
 * —Anthropic wants the type and the bytes in separate fields, the other two want the entire URL of
 * data— and storing one of the two forms here would force undoing it in the other. What is stored
 * is the material; the wrapper is added by whoever sends it.
 */
export interface CompleteImage {
  /** The content in base64, without `data:image/png;base64,` in front. */
  data: string;
  /** `image/png`, `image/jpeg`, `image/webp` o `image/gif`. */
  mediaType: string;
}

export interface CompleteRequest {
  prompt: string;
  system?: string;
  maxTokens?: number;
  /** Force a specific provider instead of the configured one. */
  provider?: string;
  signal?: AbortSignal;
  /**
   * What needs to be looked at. They go before the text in the three families, because the
   * question is understood better after seeing what is being asked about.
   *
   * A provider who does not know how to receive them **does not attend to the request**: see
   * `VisionUnsupportedError`.
   */
  images?: CompleteImage[];
}

/**
 * The configured provider does not know how to receive images.
 *
 * It is launched before calling anyone, and it is the most important decision of this file: the
 * alternative —sending the text without the images— produces a confident response on a screen that
 * the model has not seen. 'I find nothing to object to' said about nothing is the worst possible
 * outcome from a critic, because it is indistinguishable from the good and, on top of that,
 * reassuring. A command that refuses is worth more.
 *
 * Today only the `cli` family falls here: `claude -p` and `codex exec` receive a prompt through
 * standard input and a PNG does not fit there. It's a limit of how they are called, not of the
 * models behind them, and the day one of them accepts a file path on its command line this stops
 * being true for that one.
 */
export class VisionUnsupportedError extends Error {
  constructor(readonly provider: string) {
    super(
      `${provider} no sabe recibir imágenes. Configura un proveedor con clave ` +
        `—'panoma ai key'— o pásale uno con --provider.`,
    );
    this.name = "VisionUnsupportedError";
  }
}

export interface CompleteResult {
  text: string;
  provider: string;
  model: string;
  /** Absent in providers `cli`: they do not publish the consumption. */
  usage?: { input: number; output: number };
}

export async function complete(request: CompleteRequest): Promise<CompleteResult> {
  const credential = await resolveCredential(request.provider);

  if (credential.provider.auth === "cli") {
    // Before constructing the prompt: if what is requested is to look and this provider does not
    // look, there is nothing to send. See `VisionUnsupportedError`.
    if (request.images?.length) throw new VisionUnsupportedError(credential.provider.name);
    const prompt = request.system ? `${request.system}\n\n---\n\n${request.prompt}` : request.prompt;
    const text = await completeWithCliAgent(credential.provider, prompt);
    return { text, provider: credential.provider.id, model: credential.model || "sesión" };
  }

  if (credential.provider.api === "anthropic") return completeAnthropic(credential, request);
  if (credential.provider.api === "codex") return completeCodex(credential, request);
  return completeOpenAi(credential, request);
}

interface CodexResponse {
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  output_text?: string | string[];
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
  error?: { message?: string };
  detail?: string;
}

/** An event from the flow. Only the fields that are used; the rest is ignored without noise. */
interface CodexEvent {
  type?: string;
  delta?: string;
  response?: CodexResponse;
}

/**
 * Gather the answer from the flow of events.
 *
 * The Codex backend **only** responds in streaming —a request without `stream: true` is rejected
 * with "Stream must be set to true"—, so here there is no choice between waiting for the entire
 * body and reading it in chunks: you have to read it in chunks. The text deltas are accumulated
 * and the final event is saved, which is the one that brings the model and usage.
 *
 * Both ways of extracting the text are accepted for the same reason as in the rest of the file: it
 * is a private endpoint that can change, and sticking to only one way is leaving yourself at the
 * mercy of another deployment stopping to work.
 */
async function readCodexStream(
  body: ReadableStream<Uint8Array>,
): Promise<{ text: string; final?: CodexResponse }> {
  const lector = body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  let text = "";
  let final: CodexResponse | undefined;

  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    pending += value;

    // The events arrive batched wherever the network is, so they are processed by complete lines
    // and what is left halfway waits for the next piece.
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const datum = line.slice(5).trim();
      if (!datum || datum === "[DONE]") continue;

      let event: CodexEvent;
      try {
        event = JSON.parse(datum) as CodexEvent;
      } catch {
        // An unreadable event does not discard the entire response: the rest of the flow is still
        // valid.
        continue;
      }

      if (typeof event.delta === "string" && event.type?.endsWith(".delta")) {
        text += event.delta;
      }
      if (event.response) final = event.response;
    }
  }

  return { text: text, ...(final ? { final } : {}) };
}

/**
 * ChatGPT through the Codex door.
 *
 * It is not OpenAI's API: the subscription token does not work against `api.openai.com`, only
 * against the ChatGPT backend, and there the format is that of **responses** —`input`,
 * `instructions`, `output[]` — and not the chat completions one. That is why this family exists
 * separately instead of reusing `completeOpenAi`.
 *
 * **It is a private OpenAI endpoint, intended for its own CLI.** It is not documented for third
 * parties, so the day they change the method or the headers this will stop working without notice
 * — and the error message below is the only thing that will tell you. It is written to be readable
 * for that reason: when it breaks, the 4xx or 5xx with its body says more than anything we could
 * make up here.
 */
async function completeCodex(
  credential: ResolvedCredential,
  request: CompleteRequest,
): Promise<CompleteResult> {
  const response = await callProvider(credential.provider.name, `${credential.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credential.apiKey}`,
      // Which account is charged. It comes from the `id_token` at login; without it, the request
      // goes to the user's default account.
      ...(credential.accountId ? { "chatgpt-account-id": credential.accountId } : {}),
      // Who is calling. The support looks at it to decide whether to accept the subscription token.
      originator: "codex_cli_rs",
      "openai-beta": "responses=experimental",
      accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: credential.model,
      ...(request.system ? { instructions: request.system } : {}),
      input: [
        {
          role: "user",
          content: [
            ...(request.images ?? []).map((image) => ({
              type: "input_image",
              // Here yes, the entire URL of data: this backup does not have a field for the type.
              image_url: dataUrl(image),
            })),
            { type: "input_text", text: request.prompt },
          ],
        },
      ],
      /*
        Without `max_output_tokens`, and not out of forgetfulness: this backup rejects it
        —"Unsupported parameter"— because the cap is not set by the request, it is set by the
        plan. This is the fundamental difference between paying per token and paying a
        subscription, and that is why `request.maxTokens` does not go here: in this provider it
        means nothing.
       */
      // Mandatory: without this, it answers 400 «Stream must be set to true». This is not our
      // preference — this backend does not know how to respond in any other way.
      stream: true,
      store: false,
    }),
    signal: request.signal,
  });

  if (!response.ok) {
    // The error does come as JSON in one piece, and its message is the only thing that will explain
    // what changed the day this breaks. That is why it is shown in full.
    const failure = (await response.json().catch(() => ({}))) as CodexResponse;
    throw new Error(
      redact(
        `${credential.provider.name} respondió ${response.status}: ` +
          `${failure.error?.message ?? failure.detail ?? response.statusText}`,
        [credential.apiKey],
      ),
    );
  }
  if (!response.body) throw new Error(`${credential.provider.name} contestó sin cuerpo.`);

  const { text, final } = await readCodexStream(response.body);

  // If the deltas didn't bring anything, the final event is looked at: two ways to extract the same
  // text, because this endpoint doesn't promise anything.
  const outputText = (final?.output ?? [])
    .flatMap((block) => block.content ?? [])
    .flatMap((chunk) => (chunk.text ? [chunk.text] : []))
    .join("\n");
  const shortcut = Array.isArray(final?.output_text)
    ? final.output_text.join("\n")
    : final?.output_text;

  return {
    text: (text || outputText || shortcut || "").trim(),
    provider: credential.provider.id,
    model: final?.model ?? credential.model,
    ...(final?.usage
      ? {
          usage: {
            input: final.usage.input_tokens ?? 0,
            output: final.usage.output_tokens ?? 0,
          },
        }
      : {}),
  };
}

async function completeAnthropic(
  credential: ResolvedCredential,
  request: CompleteRequest,
): Promise<CompleteResult> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: credential.apiKey!, baseURL: credential.baseUrl });

  // `stream` instead of `create`: with `max_tokens` high, a long response can exceed the timeout of
  // a normal request, and `finalMessage()` returns the same.
  const message = await client.messages
    .stream(
      {
        model: credential.model,
        max_tokens: request.maxTokens ?? 2048,
        system: request.system,
        messages: [
          {
            role: "user",
            content: [
              ...(request.images ?? []).map((image) => ({
                type: "image" as const,
                // The only one of the three families that separates type and bytes, and the one
                // that states it in its typing: that's why `CompleteImage` stores both separately.
                source: {
                  type: "base64" as const,
                  media_type: image.mediaType as "image/png",
                  data: image.data,
                },
              })),
              { type: "text" as const, text: request.prompt },
            ],
          },
        ],
      },
      { signal: request.signal },
    )
    .finalMessage();

  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();

  return {
    text,
    provider: credential.provider.id,
    model: message.model,
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
  };
}

interface ChatCompletion {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  error?: { message?: string };
}

/** A part of a message in the OpenAI format: text, or an image by URL of data. */
type OpenAiPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

async function completeOpenAi(
  credential: ResolvedCredential,
  request: CompleteRequest,
): Promise<CompleteResult> {
  const messages: { role: string; content: string | OpenAiPart[] }[] = [];
  if (request.system) messages.push({ role: "system", content: request.system });

  /*
    Without images, the content is still a string and not an array of a part.
    Both forms are valid in the OpenAI format, but this client is also supported by Ollama, LM
    Studio, and OpenRouter, and of those there are implementations that only understand the old
    form. A change that fixes images and breaks text in three providers is not a fix, so the new
    form appears only when necessary.
   */
  const images = request.images ?? [];
  if (images.length === 0) {
    messages.push({ role: "user", content: request.prompt });
  } else {
    messages.push({
      role: "user",
      content: [
        ...images.map(
          (image): OpenAiPart => ({ type: "image_url", image_url: { url: dataUrl(image) } }),
        ),
        { type: "text", text: request.prompt },
      ],
    });
  }

  const response = await callProvider(
    credential.provider.name,
    `${credential.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credential.apiKey}`,
      },
      body: JSON.stringify({
        model: credential.model,
        max_tokens: request.maxTokens ?? 2048,
        messages,
      }),
      signal: request.signal,
    },
  );

  const body = (await response.json().catch(() => ({}))) as ChatCompletion;
  if (!response.ok) {
    // The provider's message says whether it is the key, the quota, or the model. Swallowing it and
    // displaying "error 400" forces repeating the call manually to find out the same thing. Struck
    // out before leaving: a provider can return the key inside its own error ("invalid api key:
    // sk-…") and this message is displayed entirely on the screen.
    throw new Error(
      redact(
        `${credential.provider.name} respondió ${response.status}: ${
          body.error?.message ?? response.statusText
        }`,
        [credential.apiKey],
      ),
    );
  }

  return {
    text: (body.choices?.[0]?.message?.content ?? "").trim(),
    provider: credential.provider.id,
    model: body.model ?? credential.model,
    usage: body.usage
      ? { input: body.usage.prompt_tokens ?? 0, output: body.usage.completion_tokens ?? 0 }
      : undefined,
  };
}

/**
 * The image as URL of data, which is what two of the three families expect.
 *
 * It checks nothing: whoever builds a `CompleteImage` has already decided that those bytes are an
 * image and of what type —`readScreenshot`, in the engine, does it by reading the first bytes of
 * the file and not its extension—. Repeating the check here, with the material already in base64
 * and without the file in front of you, would be guessing worse with less information.
 */
function dataUrl(image: CompleteImage): string {
  return `data:${image.mediaType};base64,${image.data}`;
}
