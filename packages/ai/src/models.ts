import { resolveCredential } from "./credentials";
import { redact } from "./safety";

/**
 * Ask the provider which models it actually offers.
 *
 * It is the live discovery, and the difference with having the list written in the code was seen
 * on the first day Codex was used: the model we had noted no longer existed for ChatGPT accounts,
 * the call failed with a 400, and there was no way to fix it from the application. A handwritten
 * list ages on its own; this one cannot, because it is answered by whoever knows.
 *
 * What it returns are **better suggestions**, not a closed list: the model's field still accepts
 * anything. A provider that does not have this endpoint—or that has it behind another
 * permission—does not break anything, it just leaves the suggestions that were already there.
 */

/** A large catalog does not fit in a foldout, and no one goes below sixty by hand. */
const MAX = 60;

/**
 * The version we claim to be when asking Codex for the catalog.
 *
 * **The number is not cosmetic: it filters the response.** Measured against the truth backing:
 * with `0.55.0` and `0.60.1` it returns zero models, and from `1.0.0` it returns all seven. Each
 * model also brings its own `minimal_client_version`, so the server is saying 'I won't show you
 * what your client wouldn't know how to use'.
 *
 * The minimum that unlocks the entire list is sent and not an inflated number: here the only
 * capacity needed is text that goes in and text that comes out, but asserting more would be asking
 * for models that depend on tools that Panoma does not implement.
 */
const CLIENT_VERSION = "1.0.0";

interface ModelsResponse {
  /** The OpenAI form: `{ data: [{ id }] }`. Almost everyone speaks it. */
  data?: { id?: string }[];
  /**
   * The other form: `{ models: [...] }`, which Anthropic and the Codex backup use.
   *
   * And there the identifier is called `slug`, not `id` — reading it wrong was what made the first
   * version return an empty list with a perfectly correct 200. The three names are looked at
   * because each of these endpoints chose its own.
   */
  models?: { id?: string; slug?: string; name?: string }[];
  error?: { message?: string };
}

export async function listModels(providerId?: string, signal?: AbortSignal): Promise<string[]> {
  const credential = await resolveCredential(providerId);
  const { provider } = credential;

  // An installed agent does not publish a catalog: it chooses the model in its own session.
  if (provider.auth === "cli" || !credential.baseUrl) return [];

  const anthropic = provider.api === "anthropic";
  /*
    Codex also requests the client version ("Field required: client_version") because its catalog
    depends on what the asker knows how to do: an old client shouldn't see models it wouldn't know
    how to use. It's a private endpoint, so this parameter can change just like the rest — and
    when it changes, the error message will indicate it with the same detail.
   */
  const version = provider.api === "codex" ? `?client_version=${CLIENT_VERSION}` : "";
  const url = `${credential.baseUrl}${anthropic ? "/v1/models" : "/models"}${version}`;

  const response = await fetch(url, {
    headers: anthropic
      ? {
          "x-api-key": credential.apiKey ?? "",
          "anthropic-version": "2023-06-01",
        }
      : {
          authorization: `Bearer ${credential.apiKey}`,
          ...(credential.accountId ? { "chatgpt-account-id": credential.accountId } : {}),
        },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ModelsResponse;
    throw new Error(
      redact(
        `${provider.name} no quiso listar sus modelos (${response.status}): ` +
          `${body.error?.message ?? response.statusText}`,
        [credential.apiKey],
      ),
    );
  }

  const body = (await response.json().catch(() => ({}))) as ModelsResponse;
  const rawIds = [
    ...(body.data ?? []).map((m) => m.id),
    ...(body.models ?? []).map((m) => m.id ?? m.slug ?? m.name),
  ];

  // Ordered and without repeating: the answer arrives in the order the provider feels like, and in
  // a dropdown of sixty rows alphabetical order is the only thing that lets you find something.
  return [...new Set(rawIds.filter((id): id is string => Boolean(id)))].sort().slice(0, MAX);
}
