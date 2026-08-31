/**
 * AI suppliers catalog.
 *
 * The way comes from studying how open-source agents who have been dealing with this problem for a
 * long time solve it. The three ideas that were worth keeping:
 *
 * 1. **A declarative descriptor per provider**, not a `if` per provider distributed by the code.
 * Adding one is adding a row.
 * 2. **`auth` as a first-class discriminator.** It is what determines the entire interface: the
 * interface is divided into two —"Accounts" and "API Keys"— based on this field, because
 * connecting an account and pasting a key are nothing alike.
 * 3. **Several environment variables per provider, in order of priority.** People already have
 * `ANTHROPIC_API_KEY` set; asking them to copy it somewhere else is unnecessary friction.
 *
 * About signing in with a consumer subscription, which is what is done out there and where you
 * have to distinguish two cases that are not alike:
 *
 * - **Claude Pro/Max: no.** It is not a matter of preference — Anthropic expressly forbids any
 * third party from offering Claude.ai logins or routing requests with credentials from the
 * Free/Pro/Max plans, and starting in early 2026 it enforces this on the server: a subscription
 * token used outside of Claude Code is rejected ("This credential is only authorized for use with
 * Claude Code") and the account may be restricted. In other words, besides being prohibited, it
 * wouldn’t work today.
 * - **ChatGPT Plus/Pro: yes, with the fine print upfront.** OpenAI does allow using the
 * subscription from outside its CLI, and that is what `openai-codex` does down here. What there
 * isn't is a clean way to do it: the public client_id of CLI from Codex is reused and a private
 * endpoint of theirs is called, so it is for personal use and could break the day OpenAI changes
 * it. It is marked as such in its description.
 *
 * And there still exists the route that has none of those drawbacks: if the user already has
 * `claude` or `codex` installed and logged in, **we call them**. The subscription is used by their
 * own official tool, on their machine; Panoma does not store any token. It is the external process
 * pattern, and it is the only thing that Anthropic does allow for a consumption plan.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export type AuthType =
  /** API key pasted by the user or read from the environment. */
  | "api-key"
  /** Delegate to an agent already installed and authenticated on the machine. */
  | "cli"
  /** Log in to the browser and save the token. See `oauth.ts`. */
  | "oauth";

/**
 * How the request is constructed.
 *
 * `openai` —the `/chat/completions` format— is spoken today by twenty-something of the entries
 * below: this is the reason why open agents treat «compatible with OpenAI» as a family and not as
 * a provider. `codex` is separate because ChatGPT's backup does not use that format but the
 * response format, and with headers its own.
 */
export type ApiFamily = "anthropic" | "openai" | "codex";

/** What is needed for an OAuth login. See `oauth.ts`. */
export interface OauthConfig {
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /**
   * Port and return route, fixed.
   *
   * They are not eligible: they are set by the application's registration with the manufacturer,
   * so if the port is busy, the login cannot be done and it must be stated instead of trying
   * another one and receiving a `redirect_uri_mismatch` that explains nothing.
   */
  redirectPort: number;
  redirectPath: string;
}

export interface Provider {
  id: string;
  name: string;
  auth: AuthType;
  description: string;
  /**
   * The same phrase in English. Mandatory on purpose: the Model page is bilingual and these
   * descriptions were the only thing about it that always appeared in Spanish. With the optional
   * field, provider number twenty-eight would arrive untranslated and no one would notice until
   * seeing it on the screen; mandatory, the compiler notices it.
   */
  descriptionEn: string;

  // ── auth: "api-key" ────────────────────────────────────────────────────────
  api?: ApiFamily;
  baseUrl?: string;
  /** In order of priority; the first one that exists wins. */
  apiKeyEnvVars?: string[];
  /** To point to a gateway or a local model. */
  baseUrlEnvVar?: string;
  defaultModel?: string;
  /**
   * Models that are suggested in the interface. **Suggestions, not a closed list.**
   *
   * The model field is still free text, and this is deliberate: these catalogs change every few
   * months —the first attempt with Codex failed because the default model we set no longer existed
   * for ChatGPT accounts— and a closed list turns every manufacturer change into a new version of
   * Panoma. So, at most, the suggestion becomes outdated and the name is written by hand.
   */
  models?: string[];
  /** Where do you get the key. It goes in the error message, which is where it is needed. */
  signupUrl?: string;

  // ── auth: "cli" ────────────────────────────────────────────────────────────
  /** Binary to search in the PATH. */
  command?: string;
  /** Arguments for a single non-interactive response. The prompt goes through stdin. */
  args?: string[];
  /**
   * Where the same agent lives when it arrives inside a desktop application.
   *
   * They are tested in order and only if the one from PATH does not respond. They are needed
   * because a binary inside a `.app` is not in PATH and will never be: whoever installs the
   * ChatGPT application does not expect to have to export anything, and yet inside there is a
   * `codex` that works. Absolute paths and written here — nothing coming from outside.
   */
  bundles?: string[];

  // ── auth: "oauth" ──────────────────────────────────────────────────────────
  oauth?: OauthConfig;
}

export const PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    auth: "api-key",
    description: "Claude por API. Facturación por uso.",
    descriptionEn: "Claude over the API. Pay as you go.",
    api: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKeyEnvVars: ["ANTHROPIC_API_KEY"],
    baseUrlEnvVar: "ANTHROPIC_BASE_URL",
    defaultModel: "claude-opus-5",
    models: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
    signupUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    name: "OpenAI",
    auth: "api-key",
    description: "GPT por API. Facturación por uso.",
    descriptionEn: "GPT over the API. Pay as you go.",
    api: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnvVars: ["OPENAI_API_KEY"],
    baseUrlEnvVar: "OPENAI_BASE_URL",
    defaultModel: "gpt-5",
    models: ["gpt-5", "gpt-5-mini"],
    signupUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    auth: "api-key",
    description: "Una clave para modelos de muchos fabricantes.",
    descriptionEn: "One key for models from many makers.",
    api: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnvVars: ["OPENROUTER_API_KEY"],
    baseUrlEnvVar: "OPENROUTER_BASE_URL",
    defaultModel: "anthropic/claude-opus-4.6",
    models: ["anthropic/claude-opus-4.6", "openai/gpt-5", "google/gemini-2.5-pro", "deepseek/deepseek-chat"],
    signupUrl: "https://openrouter.ai/keys",
  },
  {
    id: "google",
    name: "Google AI Studio",
    auth: "api-key",
    description: "Gemini por su endpoint compatible con OpenAI.",
    descriptionEn: "Gemini through its OpenAI-compatible endpoint.",
    api: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyEnvVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    baseUrlEnvVar: "GEMINI_BASE_URL",
    defaultModel: "gemini-2.5-pro",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    signupUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "local",
    name: "Modelo local",
    auth: "api-key",
    description: "Ollama, LM Studio o cualquier servidor compatible con OpenAI.",
    descriptionEn: "Ollama, LM Studio, or any OpenAI-compatible server.",
    api: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKeyEnvVars: ["LOCAL_LLM_API_KEY"],
    baseUrlEnvVar: "LOCAL_LLM_BASE_URL",
    defaultModel: "qwen3:8b",
    signupUrl: "https://ollama.com",
  },

  /*
    ── The others, and why they are ─────────────────────────────────────────────────────
    Everyone talks in the OpenAI format, so none includes code: they are rows. It is the promise
    of the declarative record fulfilled, and the reason for having chosen this form — its catalog
    goes beyond thirty providers without a `if` per manufacturer anywhere.
    The list comes from those offered by veteran open agents, removing those that are not a row:
    the big cloud ones (Bedrock, Vertex, Azure) need entire credential chains — AWS’s, a Google
    service account — and putting them here would be promising a key field that is useless. Those
    go in the day someone needs them, with their code.
    Each one allows `baseUrlEnvVar` because these endpoints move —they change region, route
    version— and an environment variable fixes in a moment what otherwise would require waiting
    for a new version of Panoma.
   */
  {
    id: "deepseek",
    name: "DeepSeek",
    auth: "api-key",
    description: "Modelos de razonamiento a precio bajo.",
    descriptionEn: "Reasoning models at a low price.",
    api: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnvVars: ["DEEPSEEK_API_KEY"],
    baseUrlEnvVar: "DEEPSEEK_BASE_URL",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    signupUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "groq",
    name: "Groq",
    auth: "api-key",
    description: "Modelos abiertos, con la respuesta más rápida del mercado.",
    descriptionEn: "Open models, with the fastest responses on the market.",
    api: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnvVars: ["GROQ_API_KEY"],
    baseUrlEnvVar: "GROQ_BASE_URL",
    defaultModel: "llama-3.3-70b-versatile",
    signupUrl: "https://console.groq.com/keys",
  },
  {
    id: "xai",
    name: "xAI",
    auth: "api-key",
    description: "Grok por API.",
    descriptionEn: "Grok over the API.",
    api: "openai",
    baseUrl: "https://api.x.ai/v1",
    apiKeyEnvVars: ["XAI_API_KEY"],
    baseUrlEnvVar: "XAI_BASE_URL",
    defaultModel: "grok-4-fast-reasoning",
    signupUrl: "https://console.x.ai",
  },
  {
    id: "together",
    name: "Together AI",
    auth: "api-key",
    description: "Catálogo grande de modelos abiertos alojados.",
    descriptionEn: "A large catalog of hosted open models.",
    api: "openai",
    baseUrl: "https://api.together.xyz/v1",
    apiKeyEnvVars: ["TOGETHER_API_KEY"],
    baseUrlEnvVar: "TOGETHER_BASE_URL",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    signupUrl: "https://api.together.ai/settings/api-keys",
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    auth: "api-key",
    description: "Modelos abiertos servidos rápido.",
    descriptionEn: "Open models, served fast.",
    api: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    apiKeyEnvVars: ["FIREWORKS_API_KEY"],
    baseUrlEnvVar: "FIREWORKS_BASE_URL",
    defaultModel: "accounts/fireworks/models/kimi-k2-instruct",
    signupUrl: "https://fireworks.ai/account/api-keys",
  },
  {
    id: "cerebras",
    name: "Cerebras",
    auth: "api-key",
    description: "Inferencia sobre oblea entera. Muy rápida, catálogo corto.",
    descriptionEn: "Wafer-scale inference. Very fast, short catalog.",
    api: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    apiKeyEnvVars: ["CEREBRAS_API_KEY"],
    baseUrlEnvVar: "CEREBRAS_BASE_URL",
    defaultModel: "llama-3.3-70b",
    signupUrl: "https://cloud.cerebras.ai",
  },
  {
    id: "moonshot",
    name: "Moonshot · Kimi",
    auth: "api-key",
    description: "Kimi, con ventana de contexto larga.",
    descriptionEn: "Kimi, with a long context window.",
    api: "openai",
    baseUrl: "https://api.moonshot.ai/v1",
    apiKeyEnvVars: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
    baseUrlEnvVar: "MOONSHOT_BASE_URL",
    defaultModel: "kimi-k2-turbo-preview",
    signupUrl: "https://platform.moonshot.ai/console/api-keys",
  },
  {
    id: "alibaba",
    name: "Qwen · DashScope",
    auth: "api-key",
    description: "Qwen por el endpoint compatible de Alibaba.",
    descriptionEn: "Qwen through Alibaba’s compatible endpoint.",
    api: "openai",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    apiKeyEnvVars: ["DASHSCOPE_API_KEY"],
    baseUrlEnvVar: "DASHSCOPE_BASE_URL",
    defaultModel: "qwen-max",
    signupUrl: "https://bailian.console.alibabacloud.com",
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    auth: "api-key",
    description: "Modelos abiertos servidos por NVIDIA.",
    descriptionEn: "Open models served by NVIDIA.",
    api: "openai",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKeyEnvVars: ["NVIDIA_API_KEY"],
    baseUrlEnvVar: "NVIDIA_BASE_URL",
    defaultModel: "meta/llama-3.3-70b-instruct",
    signupUrl: "https://build.nvidia.com",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    auth: "api-key",
    description: "El enrutador de inferencia del Hub.",
    descriptionEn: "The Hub’s inference router.",
    api: "openai",
    baseUrl: "https://router.huggingface.co/v1",
    apiKeyEnvVars: ["HF_TOKEN", "HUGGINGFACE_API_KEY"],
    baseUrlEnvVar: "HF_BASE_URL",
    defaultModel: "Qwen/Qwen2.5-72B-Instruct",
    signupUrl: "https://huggingface.co/settings/tokens",
  },
  {
    id: "ollama-cloud",
    name: "Ollama Cloud",
    auth: "api-key",
    description: "Los modelos de Ollama, servidos por ellos en vez de por tu portátil.",
    descriptionEn: "Ollama’s models, served by them instead of your laptop.",
    api: "openai",
    baseUrl: "https://ollama.com/v1",
    apiKeyEnvVars: ["OLLAMA_API_KEY"],
    baseUrlEnvVar: "OLLAMA_BASE_URL",
    defaultModel: "gpt-oss:120b",
    signupUrl: "https://ollama.com/settings/keys",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    auth: "api-key",
    description: "El servidor local de LM Studio. Sin clave, salvo que le pongas una.",
    descriptionEn: "LM Studio’s local server. No key, unless you set one.",
    api: "openai",
    baseUrl: "http://127.0.0.1:1234/v1",
    apiKeyEnvVars: ["LM_API_KEY", "LMSTUDIO_API_KEY"],
    baseUrlEnvVar: "LMSTUDIO_BASE_URL",
    defaultModel: "local-model",
    signupUrl: "https://lmstudio.ai",
  },

  // ── Sign in with a subscription ───────────────────────────────────────
  {
    id: "openai-codex",
    name: "ChatGPT (Codex)",
    auth: "oauth",
    description:
      "Tu suscripción de ChatGPT Plus o Pro, sin clave. Uso personal: se apoya en el " +
      "inicio de sesión del CLI de Codex y en un endpoint privado de OpenAI, así que " +
      "puede dejar de funcionar el día que ellos lo cambien.",
    descriptionEn:
      "Your ChatGPT Plus or Pro subscription, no key. Personal use: it leans on the " +
      "Codex CLI sign-in and a private OpenAI endpoint, so it can stop working the " +
      "day they change it.",
    api: "codex",
    // The backup of ChatGPT, not `api.openai.com`: the subscription token is the only thing from
    // OpenAI that is charged from the plan, and it is only valid against this gate.
    baseUrl: "https://chatgpt.com/backend-api/codex",
    baseUrlEnvVar: "CODEX_BASE_URL",
    /*
      Those who accept a ChatGPT account are not the same as those who accept a API key.
      With a key, any model of the API is valid; with a subscription, the backup only supports
      those assigned to your plan and returns 400 for the rest — 'The 'X' model is not supported
      when using Codex with a ChatGPT account.' `terra` is the balanced one and that is why it is
      the default; `sol` is for difficult tasks, `luna` for fast tasks, and `spark` only if you
      pay for Pro. If this list becomes outdated, the model field is written manually.
     */
    defaultModel: "gpt-5.6-terra",
    models: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.5"],
    signupUrl: "https://chatgpt.com",
    oauth: {
      /*
        The public client_id distributed by CLI of Codex itself.
        It is not a secret —it travels in every login of anyone who uses `codex` — but it is not
        ours either: it belongs to the registered OpenAI application, and the port and return path
        are set in that registry. That is why 1455 cannot be changed.
       */
      clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
      authorizeUrl: "https://auth.openai.com/oauth/authorize",
      tokenUrl: "https://auth.openai.com/oauth/token",
      // `offline_access` is what causes them to return a refresh token; without it, you would have
      // to log in again every few hours.
      scopes: ["openid", "profile", "email", "offline_access"],
      redirectPort: 1455,
      redirectPath: "/auth/callback",
    },
  },

  // ── Delegation to already installed agents ────────────────────────────────────── This is the
  // 'subscription' route: the session is held by the user's official tool, on their machine. Panoma
  // does not store any token nor sees their credentials.
  {
    id: "claude-cli",
    name: "Claude Code",
    auth: "cli",
    description: "Usa tu sesión de Claude Code ya iniciada. Sin claves.",
    descriptionEn: "Uses your signed-in Claude Code session. No keys.",
    command: "claude",
    args: ["-p"],
    bundles: [
      join(homedir(), ".claude", "local", "claude"),
      "/Applications/Claude.app/Contents/Resources/claude",
    ],
  },
  {
    id: "codex-cli",
    name: "Codex",
    auth: "cli",
    description: "Usa tu sesión de Codex ya iniciada. Sin claves.",
    descriptionEn: "Uses your signed-in Codex session. No keys.",
    command: "codex",
    args: ["exec"],
    bundles: ["/Applications/ChatGPT.app/Contents/Resources/codex"],
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    auth: "cli",
    description: "Usa tu sesión de Gemini CLI ya iniciada. Sin claves.",
    descriptionEn: "Uses your signed-in Gemini CLI session. No keys.",
    command: "gemini",
    args: ["-p"],
  },
  /*
    The three at the top were the only ones, and the list ran short immediately.
    When teaching the agents in the catalog panel, the gap was seen: on this same machine there
    was a `cursor-agent` running that Panoma did not know about. Those that have a stable binary
    and a non-interactive mode are added; what is not installed is not displayed, so expanding the
    list does not make noise — it just stops having invisible agents.
   */
  {
    id: "cursor-agent",
    name: "Cursor Agent",
    auth: "cli",
    description: "Usa tu sesión de Cursor ya iniciada. Sin claves.",
    descriptionEn: "Uses your signed-in Cursor session. No keys.",
    command: "cursor-agent",
    args: ["-p"],
    // Its installer puts it in `~/.local/bin`, which is in the PATH of a session shell but not in
    // that of the server that starts `panoma up`. Same case as the `.app`.
    bundles: [join(homedir(), ".local", "bin", "cursor-agent")],
  },
  {
    id: "copilot-cli",
    name: "GitHub Copilot",
    auth: "cli",
    description: "Usa tu suscripción de Copilot ya iniciada. Sin claves.",
    descriptionEn: "Uses your signed-in Copilot subscription. No keys.",
    command: "copilot",
    args: ["-p"],
  },
  {
    id: "opencode",
    name: "OpenCode",
    auth: "cli",
    description: "Usa tu instalación de OpenCode. Sin claves.",
    descriptionEn: "Uses your OpenCode install. No keys.",
    command: "opencode",
    args: ["run"],
  },
  {
    id: "aider",
    name: "Aider",
    auth: "cli",
    description: "Usa tu instalación de Aider. Sin claves.",
    descriptionEn: "Uses your Aider install. No keys.",
    command: "aider",
    args: ["--message"],
  },
  {
    id: "amp-cli",
    name: "Amp",
    auth: "cli",
    description: "Usa tu sesión de Amp ya iniciada. Sin claves.",
    descriptionEn: "Uses your signed-in Amp session. No keys.",
    command: "amp",
    args: ["-x"],
  },
  {
    id: "goose",
    name: "Goose",
    auth: "cli",
    description: "Usa tu instalación de Goose. Sin claves.",
    descriptionEn: "Uses your Goose install. No keys.",
    command: "goose",
    args: ["run", "-t"],
  },
];

export function findProvider(id: string): Provider | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

/** The interface is grouped by how it is authenticated, not by manufacturer. */
export function providersByAuth(auth: AuthType): Provider[] {
  return PROVIDERS.filter((provider) => provider.auth === auth);
}
