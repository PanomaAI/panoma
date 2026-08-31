import {
  exchangeCode,
  complete,
  configPath,
  createChallenge,
  detectCliAgents,
  awaitCallback,
  findProvider,
  pointsElsewhere,
  forgetCredential,
  listModels,
  maskKey,
  providersByAuth,
  readConfig,
  resolveCredential,
  saveKey,
  saveToken,
  updateConfig,
  authorizeUrl,
  type AiConfig,
} from "@panoma/ai";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t, type Locale } from "@/lib/i18n";
import { modelErrorParts } from "@/lib/model-errors";

/**
 * Connect a model from the web. The same configuration as `panoma ai`, with a mouse.
 *
 * The file, the bolt, and the atomic writing were already resolved in
 * `packages/ai/src/credentials.ts`; what was missing was the door from the browser, which is where
 * people are when they find out they are missing a model — the notice 'set up a provider with
 * Panoma ai use' appears today on a button on the record and sends to another application.
 *
 * **The key goes in and does not come out.** This route accepts it and saves it; no response from
 * here ever returns a full key — only `maskKey`. A panel that fills the field with the saved key
 * “so that you can see it” distributes it to any browser extension with access to DOM, and to any
 * screenshot.
 *
 * And it goes in the body of the POST, never in the URL: routes with query end up in the browser
 * history and in the logs of any proxy in between.
 *
 * ───────────────────────────────────────────────────────────────────────────────────── **Why the
 * GET is here and the page does not read the file. Do not change it without reading this.**
 *
 * `/ai` was a server component that called `readConfig()` and only passed masked keys to the
 * client. It seemed correct and it wasn't: in **development mode**, Next instruments the
 * input/output of the render of a server component and puts what it reads into the RSC payload
 * that travels to the browser. Measured in this same application — the entire `ai.json`, with the
 * key in plain text, appeared inside `self.__next_f` in the HTML. In the production build it
 * doesn't happen; the problem is that `panoma up` starts `next dev`, so the mode that filters is
 * precisely the one everyone uses.
 *
 * The lesson: **the leak is not in what you render, it's in what you read.** No amount of care in
 * choosing props saves a server render that opens a file containing secrets. That's why this route
 * reads it, whose response is not part of any RSC payload, and the page is a shell that asks for
 * this data already masked.
 */

/** Longer than this is not anyone's key: it is a file pasted by mistake. */
const MAX_KEY = 500;

/*
  Where the credential came from, as a code and not as a phrase.
  `resolveCredential` returns the word in Spanish because CLI prints it as is and CLI is
  monolingual. Sending it like this to the browser would leave an "agent session" in the middle of
  an English page, so here it is translated to a stable code and the painter chooses the words. It
  is the same rule that left `workRisks` returning `code` instead of prose.
 */
/*
  The table that was here translated «session started» to `login`. Since `resolveCredential`
  returns the code directly, there is nothing to translate: it is passed as is and a mapping layer
  that could only get out of sync ceases to exist.
 */
const SOURCE: Record<string, "env" | "file" | "agent-session" | "login"> = {
  env: "env",
  file: "file",
  "agent-session": "agent-session",
  login: "login",
};

/**
 * Everything the page needs to know, already masked.
 *
 * Here the key file is indeed read: this response is JSON requested by the browser after loading,
 * not an RSC load embedded in HTML. See the notice above.
 *
 * "Already masked" was all there was, and it wasn't enough. This GET lived without `sameOrigin`
 * next to a POST that did have it – the exact gap that the door test describes – and what it
 * answers is the inventory of this person's AI credentials: which providers they have configured,
 * which ones have an open session, which environmental variable each key comes from, the four
 * visible characters of each one and the path of the file where they live. Masked in a password, a
 * key continues to tell which one it is and whose own. The fact that the CORS prevents a foreign
 * tab from reading the response is a protection put by the visitor's browser, not us, and it was
 * the only one there was.
 */
export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  /*
    The language decides which sentence from the catalog travels: the descriptions were the only
    thing on this page that always appeared in Spanish.
   */
  const locale = localeFrom(request);
  const remote = Boolean(process.env["DATABASE_URL"]);

  let config: AiConfig = {};
  try {
    config = await readConfig();
  } catch (error) {
    /*
      Translated, and with the recovery kept whole. The reason it used to travel raw still holds —
      that message carries the exact command that gets somebody out of this, and shortening it
      would take away the only thing that helps — but «raw» meant Spanish to an English reader.
      `modelErrorParts` says what happened in the reader's language and hands back the commands
      untouched as the hint, so nothing is lost and nothing is in the wrong language.
     */
    const parts = modelErrorParts(locale, error);
    const broken = [parts.detail, parts.hint].filter(Boolean).join("\n");
    return Response.json({
      remote,
      broken,
      path: configPath(),
      active: null,
      agents: [],
      sessions: [],
      keys: [],
    });
  }

  const agents = (await detectCliAgents(providersByAuth("cli"))).map(
    ({ provider, installed, version }) => ({
      id: provider.id,
      name: provider.name,
      description: locale === "en" ? provider.descriptionEn : provider.description,
      command: provider.command ?? "",
      installed,
      version: version ?? null,
      active: config.provider === provider.id,
    }),
  );

  const keys = providersByAuth("api-key").map((provider) => {
    const inEnv = (provider.apiKeyEnvVars ?? []).find((name) => process.env[name]);
    const savedAt = config.keys?.[provider.id];
    return {
      id: provider.id,
      name: provider.name,
      description: locale === "en" ? provider.descriptionEn : provider.description,
      signupUrl: provider.signupUrl ?? null,
      defaultModel: provider.defaultModel ?? null,
      envVars: provider.apiKeyEnvVars ?? [],
      // The name of the variable, not its value: knowing that the key comes from the environment is
      // what explains why saving another one here wouldn't change anything.
      fromEnv: inEnv ?? null,
      masked: savedAt ? maskKey(savedAt) : null,
      active: config.provider === provider.id,
    };
  });

  const sessions = providersByAuth("oauth").map((provider) => ({
    id: provider.id,
    name: provider.name,
    description: locale === "en" ? provider.descriptionEn : provider.description,
    defaultModel: provider.defaultModel ?? null,
    // Only if there is a session, never the token. The same as with the keys and for the same
    // reason.
    connected: Boolean(config.tokens?.[provider.id]),
    active: config.provider === provider.id,
  }));

  let active = null;
  if (config.provider) {
    try {
      const credential = await resolveCredential(config.provider, config);
      active = {
        id: credential.provider.id,
        name: credential.provider.name,
        model: credential.model || credential.provider.defaultModel || null,
        // The active provider's suggestions, for the model field dropdown. They go with the asset
        // and not with each row: the configuration saves one model, not one per provider, so the
        // only place where it can be chosen is here.
        models: credential.provider.models ?? [],
        // If someone redirected this provider with an environment variable, it is said. It is
        // legitimate —a proprietary gateway, LiteLLM— but it cannot be invisible: the key is sent
        // there, and knowing it is the difference between a decision and a surprise.
        redirected: pointsElsewhere(credential.provider, credential.baseUrl),
        source: SOURCE[credential.source] ?? null,
        masked: credential.apiKey ? maskKey(credential.apiKey) : null,
        problem: null as string | null,
      };
    } catch (error) {
      // Elected but without any valid credential. It is a real and frequent state —the provider is
      // chosen and the key is left for later— and saying it here prevents it from being discovered
      // on the first button that needs it, three screens later.
      active = {
        id: config.provider,
        name: config.provider,
        model: config.model ?? null,
        models: findProvider(config.provider)?.models ?? [],
        redirected: false,
        source: null,
        masked: null,
        // The detail in the viewer's language; foreign material travels unchanged
        // (lib/model-errors.ts).
        problem: modelErrorParts(locale, error).detail,
      };
    }
  }

  return Response.json(
    { remote, broken: null, path: configPath(), active, agents, sessions, keys },
    // Without cache: it is a configuration state, and a response stored with a masked key inside
    // has no reason to survive the request.
    { headers: { "Cache-Control": "no-store" } },
  );
}

type Action =
  | { action: "usar"; provider?: string; model?: string }
  | { action: "clave"; provider?: string; key?: string }
  | { action: "olvidar"; provider?: string }
  | { action: "probar"; provider?: string }
  | { action: "entrar"; provider?: string }
  | { action: "entrar-estado" }
  | { action: "modelos"; provider?: string };

/**
 * The login is in progress, if there is one.
 *
 * It lives in the module because the browser cannot hold it: between requesting the URL and
 * coming back from the provider there is a whole round trip through another tab, and the PKCE
 * verifier cannot travel to the client in the middle — it is precisely the secret that makes a
 * stolen code useless. So the server keeps waiting and the client asks how it's going.
 *
 * One at a time, on purpose: the return port is fixed, so two at the same time do not fit.
 */
let session: { provider: string; state: "esperando" | "ready" | "error"; error?: string } | null =
  null;

export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  /*
    In hosted mode this would write to the `~/.panoma/ai.json` of the server, which belongs to
    everyone and no one: a user's key would end up being that of the entire installation. The same
    reason why `/api/tasks` and `/api/rescan` are cut off here.
   */
  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "api.localOnly", { action: t(locale, "api.action.aiConfig") }) },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Partial<Action>;

  try {
    switch (body.action) {
      case "usar":
        return await activate(body as Extract<Action, { action: "usar" }>, locale);
      case "clave":
        return await clave(body as Extract<Action, { action: "clave" }>, locale);
      case "olvidar":
        return await forget(body as Extract<Action, { action: "olvidar" }>, locale);
      case "probar":
        return await attempt(body as Extract<Action, { action: "probar" }>, locale);
      case "entrar":
        return await enter(body as Extract<Action, { action: "entrar" }>, locale);
      case "entrar-estado":
        return Response.json(session ?? { state: "none" });
      case "modelos":
        return await models(body as Extract<Action, { action: "modelos" }>);
      default:
        return Response.json({ error: t(locale, "api.unknownAction") }, { status: 400 });
    }
  } catch (error) {
    /*
      `ConfigCorruptError` reaches this point deliberately: its message includes the exact recovery
      command, and rewriting it with something shorter would take away the only thing that resolves
      the problem. It goes through the translator, which keeps that command as the hint.
     */
    const parts = modelErrorParts(locale, error);
    return Response.json(
      { error: [parts.detail, parts.hint].filter(Boolean).join("\n") },
      { status: 500 },
    );
  }
}

/*
  It is called `activate` and not `use` because `use` is a React hook since 19: in a file of this
  application, the hooks linter treats it as such and complains about it being called inside a
  `try` or an asynchronous function. They were two warnings for one name. The command that travels
  in the body is still `"usar"`, which is protocol and is not touched.
 */
async function activate(
  { provider, model }: { provider?: string; model?: string },
  locale: Locale,
) {
  const chosen = provider ? findProvider(provider) : undefined;
  if (!chosen) return Response.json({ error: t(locale, "ai.unknownProvider") }, { status: 400 });

  const next = await updateConfig((config) => {
    const updated: AiConfig = { ...config, provider: chosen.id };
    /*
      Changing the provider discards the previous model, just like in `panoma ai use`: `gpt-5`
      does not exist in Anthropic, and dragging it results in a 404 with a message that does not
      indicate the cause. An empty model is a valid choice — it means 'the provider's default'.
     */
    const clean = model?.trim();
    if (clean) updated.model = clean;
    else if (model !== undefined || config.provider !== chosen.id) delete updated.model;
    return updated;
  });

  return Response.json({ ok: true, provider: chosen.id, model: next.model ?? null });
}

async function clave(
  { provider, key }: { provider?: string; key?: string },
  locale: Locale,
) {
  const chosen = provider ? findProvider(provider) : undefined;
  if (!chosen) return Response.json({ error: t(locale, "ai.unknownProvider") }, { status: 400 });
  if (chosen.auth !== "api-key") {
    return Response.json(
      { error: t(locale, "ai.noKeyNeeded", { name: chosen.name }) },
      { status: 400 },
    );
  }

  const cleanValue = (key ?? "").trim();
  if (!cleanValue) return Response.json({ error: t(locale, "ai.emptyKey") }, { status: 400 });
  if (cleanValue.length > MAX_KEY) {
    return Response.json({ error: t(locale, "ai.notAKey") }, { status: 400 });
  }

  await saveKey(chosen.id, cleanValue);
  // Neither the key nor its mask: the panel requests the status again from the GET above, which is
  // the only source. Returning it here would be starting to distribute it through responses from
  // API.
  return Response.json({ ok: true, provider: chosen.id });
}

/**
 * Start the OAuth dance and respond with the URL that you need to go to.
 *
 * The server stays waiting for the return on its port; the client opens the URL and then asks for
 * `enter-state`. It's ugly compared to waiting on the same request, and it's the only thing that
 * works: you can't open the provider tab before having URL, nor have URL without someone already
 * listening for the return.
 */
async function enter({ provider }: { provider?: string }, locale: Locale) {
  const chosen = provider ? findProvider(provider) : undefined;
  if (!chosen?.oauth) {
    return Response.json({ error: t(locale, "ai.noLogin") }, { status: 400 });
  }
  if (session?.state === "esperando") {
    return Response.json(
      { error: t(locale, "ai.loginBusy") },
      { status: 409 },
    );
  }

  const challenge = createChallenge();
  const url = authorizeUrl(chosen, challenge);
  session = { provider: chosen.id, state: "esperando" };

  /*
    The wait is left loose on purpose: this request has to be answered immediately with URL, and
    what comes after — the return, the exchange, saving — takes however long the person takes. The
    result is left in `session`, which is what the client checks. None of this can remain hanging
    without an end: `awaitCallback` has its own five-minute deadline.
   */
  const work = awaitCallback(chosen, challenge)
    .then((code) => exchangeCode(chosen, code, challenge.verifier))
    .then(async (token) => {
      await saveToken(chosen.id, token);
      session = { provider: chosen.id, state: "ready" };
    })
    .catch((error: Error) => {
      session = { provider: chosen.id, state: "error", error: error.message };
    });

  /*
    A breath before answering. The most likely failure of all —port 1455 occupied by a
    half-finished `codex login` — is known in the first millisecond, and saying it here prevents
    sending someone to the browser to return to an error that was already known.
   */
  await Promise.race([work, new Promise((listo) => setTimeout(listo, 250))]);
  if (session.state === "error") {
    const failure = session.error;
    session = null;
    return Response.json({ error: failure }, { status: 500 });
  }

  return Response.json({ url });
}

async function forget({ provider }: { provider?: string }, locale: Locale) {
  const chosen = provider ? findProvider(provider) : undefined;
  if (!chosen) return Response.json({ error: t(locale, "ai.unknownProvider") }, { status: 400 });

  // Key and token: `forgetCredential` delete both. Forgetting one half is the silent way for
  // 'forgetting' to leave the session active.
  await forgetCredential(chosen.id);

  /*
    Forgetting deletes it from the file and nothing more. If the key is also in the environment,
    the provider keeps working — and that has to be said, because "forgotten" and "still
    connected" together seem like a failure until you know they are two different places.
   */
  const inEnv = (chosen.apiKeyEnvVars ?? []).find((name) => process.env[name]);
  return Response.json({ ok: true, provider: chosen.id, stillInEnv: inEnv ?? null });
}

/**
 * Asks the provider which models it offers.
 *
 * It is the live discovery, and what prevents a list written in the code from aging without anyone
 * noticing — which is exactly what broke the first attempt with Codex. It runs on demand and not
 * when the page loads: it costs a call to the provider and is only needed when someone is going to
 * switch models.
 */
async function models({ provider }: { provider?: string }) {
  try {
    return Response.json({ ok: true, models: await listModels(provider) });
  } catch (error) {
    // The fact that there is no catalog is not a failure that needs to be made a fuss about: many
    // providers do not publish the endpoint. The interface sticks with the suggestions it already
    // had.
    return Response.json({ ok: false, models: [], error: (error as Error).message });
  }
}

async function attempt({ provider }: { provider?: string }, locale: Locale) {
  const started = Date.now();
  try {
    const result = await complete({
      // Short on purpose: this proves that the credential is valid and that the model responds, not
      // how well it writes. With a CLI agent in between, every word takes seconds.
      prompt: "Responde exactamente con la palabra: listo",
      maxTokens: 32,
      ...(provider ? { provider } : {}),
    });
    return Response.json({
      ok: true,
      provider: result.provider,
      model: result.model,
      ms: Date.now() - started,
      text: result.text.trim().slice(0, 120),
    });
  } catch (error) {
    /*
      The detail is in the language of the viewer (`lib/model-errors.ts`), but the clue is from
      this page: sending «to the Model page» to someone who is already on it would be a map that
      indicates the place where you are standing.
     */
    const { detail, hint } = modelErrorParts(locale, error);
    return Response.json(
      {
        error: t(locale, "api.modelFailed", { detail }),
        hint: hint ? t(locale, "ai.testHint") : undefined,
      },
      { status: 502 },
    );
  }
}

/*
  The agents CLI start a process and can take time: the default ceiling of the path falls short
  exactly in the case that matters most to check. Same value as `/api/describe`.
 */
export const maxDuration = 120;
