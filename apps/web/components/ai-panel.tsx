"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HiOutlineArrowRight, HiOutlineCheck, HiOutlineChevronDown } from "react-icons/hi2";
import { useT } from "./i18n-provider";
import { readAiState } from "./ai-state";
import { modelOptions, moveHighlight } from "@/lib/model-options";
import { useDismissable } from "./use-dismissable";
import { ActionButton } from "./primitives";
import type { MessageKey } from "@/lib/i18n";

/**
 * The panel of 'what Panoma is thinking about'.
 *
 * It requests its status from `GET /api/ai` when it mounts, and requests it again after each
 * action. **It never receives a key**: the route only returns `maskKey`, so there is none in HTML
 * nor in the React state. And that reading lives in a route and not in a server component on
 * purpose — see the header of `app/api/ai/route.ts`.
 *
 * The password field is emptied as soon as it is sent, without exception. Leaving it written
 * invites sending it twice and, above all, leaves it on screen while one goes to get coffee.
 */

export interface AgentView {
  id: string;
  name: string;
  description: string;
  command: string;
  installed: boolean;
  version: string | null;
  active: boolean;
}

export interface KeyView {
  id: string;
  name: string;
  description: string;
  signupUrl: string | null;
  defaultModel: string | null;
  envVars: string[];
  /** Name of the environment variable that brings the key, if any is set. */
  fromEnv: string | null;
  /** `sk-…1234`, never the password. */
  masked: string | null;
  active: boolean;
}

export interface ActiveProvider {
  id: string;
  name: string;
  model: string | null;
  /** Suggestions written in the catalog. The real ones are requested with 'bring'. */
  models: string[];
  /** If an environment variable redirected this provider to another address. */
  redirected: boolean;
  /** Code, not phrase: the words are chosen by the one who renders. */
  source: "env" | "file" | "agent-session" | "login" | null;
  masked: string | null;
  /** Why the chosen provider cannot be used yet. */
  problem: string | null;
}

export interface SessionView {
  id: string;
  name: string;
  description: string;
  defaultModel: string | null;
  /** If there is a saved token. Never the token. */
  connected: boolean;
  active: boolean;
}

interface State {
  remote: boolean;
  broken: string | null;
  path: string;
  active: ActiveProvider | null;
  agents: AgentView[];
  sessions: SessionView[];
  keys: KeyView[];
}

type ApiResponse = { error?: string; hint?: string; [key: string]: unknown };

const SOURCE: Record<NonNullable<ActiveProvider["source"]>, MessageKey> = {
  env: "ai.sourceEnv",
  file: "ai.sourceFile",
  "agent-session": "ai.sourceAgent",
  login: "ai.sourceLogin",
};

/*
  The ceiling of the wait, which is the other half of the `loadError` below.
  That one covers the response that arrives incorrectly. This one covers the one that **doesn't
  arrive**: without a roof, `fetch` waits for whatever the server wants and the panel stays on
  «reading the configuration…» indefinitely — no error, no button, and nothing to distinguish
  «it's slow» from «it's dead». It's the same fault that was already fixed once, coming in through
  the other door.
  It is not hypothetical: in development this route is compiled the first time it is requested,
  and behind it carries `@panoma/ai` entirely. Measured on August 28, 2026 on the development
  server, with the cache of `.next` already in place: 2.8 s the first request after startup, 8.1 s
  if the route file is invalidated, 0.4 s when already hot. Without cache it is more.
  THIRTY SECONDS, AND NO LESS. The route probes nine agents of CLI —starts a process for each one—
  with a maximum of fifteen seconds per probe. They run in parallel, so the legitimate ceiling is
  those fifteen plus whatever it takes to open the database. Cutting below would turn a silence
  into a false error on a machine that was only slow, which is worse than the original failure. If
  one day the limit of `probe` in `packages/ai` increases, this one has to increase with it: it is
  monitored by `ai-panel-stuck.test.ts`.
 */
const AWAIT_CEILING_MS = 30_000;

/*
  And at six seconds, say it. Fifteen legitimate seconds looking at a text that doesn't change are
  indistinguishable from a freeze even if they end well; the notice doesn't speed anything up, but
  it turns the wait into something that is being watched pass by.
 */
const SLOW_NOTICE_MS = 6_000;

export function AiPanel() {
  const t = useT();
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  /*
    Why the panel is not being rendered, which is not the same as 'not yet'.
    This is the missing state. Without it, there were only two situations —there is a state or
    there isn't— and 'there isn't' was always displayed as 'Loading…', even when the load had
    failed a while ago. The `catch` notice existed and was unreachable: the render cuts off before
    it. Whoever opened this screen with the catalog down saw an eternal 'Loading…'.
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [slow, setSlow] = useState(false);

  /*
    If the panel goes, the login wait goes with it.
    `enter` leaves a six-minute loop asking every one and a half seconds if the provider has
    already replied. That loop doesn't know anything about the component: navigating to another
    page while waiting kept it alive until the end—two hundred forty POSTs to `/api/ai` from a
    screen that no longer exists, each one opening the database—and at the end it called
    `setNotice` about something dismantled. It is cut at both points: the flag to not make another
    round, the `AbortController` to not leave a request halfway.
    AND THE FLAG IS RAISED AGAIN WHEN RIDING, which is what was missing.
    `useRef(true)` only applies to the first assembly of an instance. The one who lowers it is the
    cleaning — and in React development it intentionally runs right after mounting, so it's
    obvious who doesn't clean properly: mount, clean, mount again. Without this line, the flag
    stayed at `false` from the first blink and **all** `if (!mounted.current) return` of this file
    exited through the back door. The most expensive is the `load`, the one just after `fetch`:
    the response arrived fine, in 0.4 s, and it crashed before rendering it. The panel remained on
    "reading the configuration…" forever.
    Played on August 28, 2026, on this same version and on the one before this fix, with the
    server healthy: entering 'AI' from the side menu —a client navigation— never rendered;
    entering by typing the address did, because there the mounting is the first. Hence it seemed
    intermittent.
    It goes in its own effect and not inside `load` 's because the order matters: effects run in
    the order they are declared, and this one has to have raised the flag before `load` looks.
   */
  const mounted = useRef(true);
  const waiting = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      waiting.current?.abort();
    };
  }, []);

  const load = useCallback(async () => {
    setSlow(false);
    const aviso = window.setTimeout(() => {
      if (mounted.current) setSlow(true);
    }, SLOW_NOTICE_MS);
    try {
      const response = await fetch("/api/ai", {
        signal: AbortSignal.timeout(AWAIT_CEILING_MS),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!mounted.current) return;

      const read = readAiState<State>(response, body);
      if (read.kind === "state") {
        setState(read.state);
        setLoadError(null);
        return;
      }

      const text = read.text ?? t("ai.loadFailed", { status: response.status });
      setLoadError(text);
      // And as a warning as well, for when there is already a panel underneath: a reload that fails
      // after an operation cannot leave the previous screen as if nothing happened.
      setNotice({ text, bad: true });
    } catch (error) {
      if (!mounted.current) return;
      /*
        Winning is not the same as not arriving, and saying it wrong orders to look where it is
        not: "could not contact the catalog" in front of a catalog that is up and responding —just
        slowly— is a false clue.
        And this check **is only true in a browser**, which is where this file runs. Measured on
        28-Aug-2026, the two cases, in both places: in the browser the expiration fails with
        `DOMException` with the name `TimeoutError` and the network failure with `TypeError`,
        which is what distinguishes them; in Node —undici— **both** are `TypeError`, and the name
        doesn't distinguish anything. Anyone who comes to check this with a Node script will
        conclude that this branch is dead, and it is not.
       */
      const vencido = error instanceof DOMException && error.name === "TimeoutError";
      const text = vencido ? t("ai.loadTimeout") : t("task.unreachable");
      setLoadError(text);
      setNotice({ text, bad: true });
    } finally {
      window.clearTimeout(aviso);
      if (mounted.current) setSlow(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(brand: string, body: Record<string, unknown>): Promise<ApiResponse | null> {
    if (busy) return null;
    setBusy(brand);
    setNotice(null);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok) {
        setNotice({
          text: [payload.error ?? t("ai.failed"), payload.hint].filter(Boolean).join(" "),
          bad: true,
        });
        return null;
      }
      // The state is requested again instead of patching it here: the file is the source, and two
      // copies of the truth on a credentials screen get out of sync the day someone exports an
      // environment variable in another terminal.
      await load();
      return payload;
    } catch {
      setNotice({ text: t("task.unreachable"), bad: true });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function use(provider: string, name: string) {
    const fact = await send(`usar:${provider}`, { action: "usar", provider });
    if (fact) setNotice({ text: t("ai.nowUsing", { name: name }), bad: false });
  }

  async function attempt() {
    const fact = await send("probar", { action: "probar" });
    if (fact) {
      setNotice({
        text: t("ai.testOk", {
          model: String(fact["model"] ?? ""),
          s: (Number(fact["ms"] ?? 0) / 1000).toFixed(1),
        }),
        bad: false,
      });
    }
  }

  /**
   * Log in: request the URL, open it, and wait for the server to say it has returned.
   *
   * The tab opens **with the URL that the server has just responded to**, not before: opening a
   * blank one and navigating it afterwards leaves it blocked as a pop-up window after a moment
   * passes since the click.
   */
  async function enter(provider: string, name: string) {
    const start = await send(`entrar:${provider}`, { action: "entrar", provider });
    if (!start?.["url"]) return;

    window.open(String(start["url"]), "_blank", "noopener,noreferrer");
    setBusy(`entrar:${provider}`);
    setNotice({ text: t("ai.loginWaiting", { name: name }), bad: false });

    /*
      It asks every second and a half and stops asking at six minutes. The server's timeout is
      five, so this is theirs plus a bit: without a limit, closing the provider's tab would leave
      this loop alive until the page is reloaded.
     */
    const hasta = Date.now() + 360_000;
    waiting.current = new AbortController();
    while (mounted.current && Date.now() < hasta) {
      await new Promise((poll) => setTimeout(poll, 1500));
      if (!mounted.current) return;
      let step: { state?: string; error?: string };
      try {
        const response = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "entrar-estado" }),
          signal: waiting.current.signal,
        });
        step = (await response.json()) as { state?: string; error?: string };
      } catch {
        continue;
      }

      if (step.state === "ready") {
        setBusy(null);
        await load();
        setNotice({ text: t("ai.loginDone", { name: name }), bad: false });
        return;
      }
      if (step.state === "error" || step.state === "none") {
        setBusy(null);
        setNotice({ text: step.error ?? t("ai.loginFailed"), bad: true });
        return;
      }
    }

    if (!mounted.current) return;
    setBusy(null);
    setNotice({ text: t("ai.loginTimeout"), bad: true });
  }

  /**
   * Change the model without changing the provider.
   *
   * Reuse `use` with the provider that is already set because in the configuration the model and
   * the provider are the same saved decision: changing them separately would open the door to
   * having a model from another manufacturer, which is a 404 with a message that does not indicate
   * the cause. Empty means 'the default one,' not 'none'.
   */
  async function changeModel(provider: string, model: string) {
    const fact = await send("modelo", { action: "usar", provider, model });
    if (fact) {
      setNotice({
        text: model.trim()
          ? t("ai.modelSaved", { model: model.trim() })
          : t("ai.modelCleared"),
        bad: false,
      });
    }
  }

  async function forget(provider: string) {
    const fact = await send(`olvidar:${provider}`, { action: "olvidar", provider });
    if (fact) {
      // If it was also in the environment, it has to be said: 'forgotten' and 'poll working' at the
      // same time seems like a mistake until you know they are two different places.
      const inEnv = fact["stillInEnv"];
      setNotice({
        text: inEnv ? t("ai.forgottenButEnv", { var: String(inEnv) }) : t("ai.forgotten"),
        bad: false,
      });
    }
  }

  if (!state) {
    if (!loadError) {
      /*
        `role="status"` because this text **changes** at six seconds, and a change that is only
        seen does not exist for someone navigating with a screen reader.
       */
      return (
        <p role="status" className="mt-10 font-mono text-[11px] text-faint">
          {slow ? t("ai.loadingSlow") : t("ai.loading")}
        </p>
      );
    }
    return (
      <div className="mt-10">
        <p role="status" className="font-mono text-[11px] leading-relaxed text-fail">
          {loadError}
        </p>
        <button
          type="button"
          onClick={() => {
            setReloading(true);
            void load().finally(() => {
              if (mounted.current) setReloading(false);
            });
          }}
          disabled={reloading}
          className="mt-3 rounded border border-edge bg-raised px-2 py-0.5 font-mono text-[10px] text-smoke transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {t(reloading ? "ai.retrying" : "ai.retry")}
        </button>
      </div>
    );
  }

  if (state.remote) {
    return (
      <section className="mt-10 rounded-lg border border-edge bg-surface p-6">
        <p className="text-sm text-smoke">{t("ai.remote")}</p>
      </section>
    );
  }

  if (state.broken) {
    return (
      <section className="mt-10 rounded-lg border border-edge bg-surface p-6">
        <h2 className="text-sm font-semibold text-chalk">{t("ai.brokenTitle")}</h2>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded border border-edge bg-raised p-4 font-mono text-[11px] leading-relaxed text-smoke">
          {state.broken}
        </pre>
      </section>
    );
  }

  const { active } = state;

  return (
    <>
      <section className="mt-10 rounded-lg border border-edge bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="eyebrow">{t("ai.activeTitle")}</h2>
          {active && !active.problem && (
            <ActionButton
              tone="raised"
              type="button"
              onClick={attempt}
              busy={busy === "probar"}
              busyLabel={t("ai.testing")}
              disabled={busy !== null}
            >
              {t("ai.test")}
            </ActionButton>
          )}
        </div>

        {active ? (
          <div className="mt-3">
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span
                aria-hidden
                className={`inline-block h-2 w-2 rounded-full ${
                  active.problem ? "bg-idle" : "bg-live"
                }`}
              />
              <strong className="font-semibold text-chalk">{active.name}</strong>
              <span className="font-mono text-[11px] text-faint">
                {active.model ?? t("ai.defaultModel")}
              </span>
            </p>
            {active.problem ? (
              <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-idle">
                {active.problem}
              </p>
            ) : (
              active.source && (
                <p className="mt-1.5 font-mono text-[11px] text-faint">
                  {active.masked
                    ? t("ai.sourceKey", {
                        source: t(SOURCE[active.source]),
                        key: active.masked,
                      })
                    : t(SOURCE[active.source])}
                </p>
              )
            )}

            <ModelField
              key={`${active.id}:${active.model ?? ""}`}
              active={active}
              busy={busy !== null}
              saving={busy === "modelo"}
              onSave={(model) => changeModel(active.id, model)}
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-smoke">{t("ai.none")}</p>
        )}

        {notice && (
          <p
            className={`mt-3 font-mono text-[11px] leading-relaxed ${
              notice.bad ? "text-fail" : "text-faint"
            }`}
          >
            {notice.text}
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="eyebrow border-b border-edge pb-2">{t("ai.subscriptionTitle")}</h2>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-smoke">
          {t("ai.subscriptionNote")}
        </p>
        <ul className="mt-4 space-y-2">
          {/*
             First those that really connect—a button and a tab—and then those that require having
             something installed. It's the order by effort, not by manufacturer.
            */}
          {state.sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-edge bg-surface p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <strong className="text-sm font-semibold text-chalk">{session.name}</strong>
                  <span className="font-mono text-[11px] text-faint">
                    {session.connected ? t("ai.connected") : t("ai.notConnected")}
                    {session.defaultModel && ` · ${session.defaultModel}`}
                  </span>
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-faint">{session.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ActionButton
                  tone="raised"
                  type="button"
                  onClick={() => enter(session.id, session.name)}
                  busy={busy === `entrar:${session.id}`}
                  busyLabel={t("ai.loggingIn")}
                  disabled={busy !== null}
                >
                  {t(session.connected ? "ai.loginAgain" : "ai.login")}
                </ActionButton>
                {session.connected && (
                  <>
                    <Choose
                      active={session.active}
                      can
                      busy={busy !== null}
                      loading={busy === `usar:${session.id}`}
                      onChoose={() => use(session.id, session.name)}
                    />
                    <button
                      type="button"
                      onClick={() => forget(session.id)}
                      disabled={busy !== null}
                      className="font-mono text-[11px] text-faint transition-colors hover:text-fail disabled:opacity-50"
                    >
                      {t("ai.logout")}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}

          {state.agents.map((agent) => (
            <li
              key={agent.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-edge bg-surface p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <strong className="text-sm font-semibold text-chalk">{agent.name}</strong>
                  <span className="font-mono text-[11px] text-faint">
                    {agent.installed
                      ? (agent.version ?? t("ai.installed"))
                      : t("ai.notInstalled", { command: agent.command })}
                  </span>
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-faint">{agent.description}</p>
              </div>
              <Choose
                active={agent.active}
                can={agent.installed}
                busy={busy !== null}
                loading={busy === `usar:${agent.id}`}
                onChoose={() => use(agent.id, agent.name)}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="eyebrow border-b border-edge pb-2">{t("ai.keysTitle")}</h2>
        <ul className="mt-4 space-y-2">
          {state.keys.map((entry) => (
            <KeyRow
              key={entry.id}
              entry={entry}
              busy={busy}
              onSave={(key) =>
                send(`clave:${entry.id}`, { action: "clave", provider: entry.id, key })
              }
              onForget={() => forget(entry.id)}
              onUsar={() => use(entry.id, entry.name)}
            />
          ))}
        </ul>
      </section>

      <p className="mt-10 max-w-2xl font-mono text-[11px] leading-relaxed text-faint">
        {/*
           The route is a fact of this machine and is not translated; what accompanies it is,
           including the awkward part: 0600 is not encryption.
          */}
        {t("ai.fileNote", { path: state.path })}
      </p>
    </>
  );
}

/**
 * The model field: free text, and a list that we open ourselves.
 *
 * A closed dropdown —a `<select>` — is the fault that brought all this: the OpenAI catalog moved,
 * the model we had written stopped being valid for ChatGPT accounts, and without a place to write
 * another one there was no way to fix it from the app. Writing by hand is still the emergency exit
 * and it is not touched.
 *
 * What does change is who draws the suggestions. They were in a `<datalist>`, which the browser
 * draws and **filters based on what is in the box**. And the box always arrives filled with the
 * model in use: with `gpt-5.6-terra` inside, the only suggestion that passes the filter is that
 * same one. Clicking the field would open an empty menu, or one with a single line repeating what
 * was already visible; the other three models required clearing the box first, and nothing
 * indicated that. On top of that, this menu cannot be viewed from here — the browser draws it,
 * outside the document — so it cannot be styled, tested, or even known if it appeared.
 *
 * Now the list is ours: it appears in HTML, it looks the same in all browsers, it has an arrow to
 * show that it is there, and the rule that governs it can be checked in `lib/model-options.ts` —
 * opening with the arrow shows **all**, typing limits.
 */
function ModelField({
  active,
  busy,
  saving,
  onSave,
}: {
  active: ActiveProvider;
  busy: boolean;
  saving: boolean;
  onSave: (model: string) => void;
}) {
  const t = useT();
  const [value, setValue] = useState(active.model ?? "");
  /*
    Two lists, and the one on top rules.
    `active.models` are the ones we have written down: they serve as input, without costing a
    call, and they age. `imported` are the ones the provider just said they have, and those cannot
    age — that is the difference between a fixed handwritten catalog and live discovery against
    the provider, and what would have avoided the 400 on the first attempt with Codex.
   */
  const [imported, setImported] = useState<string[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [noCatalog, setNoCatalog] = useState(false);

  const [open, setOpen] = useState(false);
  /**
   * What was typed since the list was opened. `null` = it was opened with the arrow: you can see
   * them all.
   */
  const [typed, setTyped] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(-1);

  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  const all = imported ?? active.models;
  const shown = modelOptions(all, typed);
  const listId = `models-${active.id}`;
  const changed = value.trim() !== (active.model ?? "").trim();

  useDismissable(box, open, () => setOpen(false));

  function pick(model: string) {
    setValue(model);
    setTyped(null);
    setHighlight(-1);
    setOpen(false);
    // Choosing does not save: the box is filled in and 'save' is lit up. The commit remains a
    // single one, whether it was reached by writing or choosing.
    field.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      if (!open) {
        setTyped(null);
        setOpen(true);
        setHighlight(moveHighlight(-1, step, all.length));
        return;
      }
      setHighlight(moveHighlight(highlight, step, shown.length));
      return;
    }
    if (event.key === "Enter" && open && highlight >= 0) {
      // Without this, Enter sends the form with whatever is half in the box instead of choosing
      // what is highlighted, which is what one thinks they are doing.
      event.preventDefault();
      const chosen = shown[highlight];
      if (chosen) pick(chosen);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setHighlight(-1);
    }
  }

  async function fetchCatalog() {
    setSearching(true);
    setNoCatalog(false);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "modelos", provider: active.id }),
      });
      const payload = (await response.json()) as { models?: string[] };
      // Without a catalog, what was already there is not deleted: many providers do not publish the
      // endpoint, and being left without suggestions would be worse than sticking with the old
      // ones.
      if (payload.models?.length) {
        setImported(payload.models);
        // And they open: whoever asks for the list wants to see it, not to find out in a line that
        // now there are thirty and have to search where.
        setTyped(null);
        setHighlight(-1);
        setOpen(true);
      } else setNoCatalog(true);
    } catch {
      setNoCatalog(true);
    } finally {
      setSearching(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && changed) onSave(value);
      }}
      className="mt-3 border-t border-edge pt-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`model-${active.id}`} className="font-mono text-[11px] text-faint">
          {t("ai.modelLabel")}
        </label>

        <div className="model-picker" ref={box}>
          <input
            id={`model-${active.id}`}
            ref={field}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              open && highlight >= 0 ? `${listId}-${highlight}` : undefined
            }
            autoComplete="off"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setTyped(event.target.value);
              setHighlight(-1);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("ai.modelPlaceholder")}
            spellCheck={false}
            className="model-picker__field font-mono text-xs text-chalk placeholder:text-faint"
          />
          {/*
             The arrow, which is the missing half: without it, nothing on screen indicated that
             there was a list behind. Turned off when there is none, and with the why in the label
             — a deactivated button without explanation makes you guess.
            */}
          <button
            type="button"
            className="model-picker__toggle"
            aria-label={t("ai.modelsOpen")}
            aria-expanded={open}
            aria-controls={listId}
            disabled={all.length === 0}
            title={all.length === 0 ? t("ai.modelsEmpty") : undefined}
            onClick={() => {
              const next = !open;
              setTyped(null);
              setHighlight(-1);
              setOpen(next);
              if (next) field.current?.focus();
            }}
          >
            <HiOutlineChevronDown aria-hidden />
          </button>

          {open && (
            <ul
              id={listId}
              role="listbox"
              aria-label={t("ai.modelsOpen")}
              className="model-picker__list"
            >
              {shown.length === 0 ? (
                <li className="model-picker__empty">{t("ai.modelsNoMatch")}</li>
              ) : (
                shown.map((model, index) => (
                  <li
                    key={model}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={model === value}
                    className={`model-picker__item${index === highlight ? " is-highlighted" : ""}`}
                    // Without this, the `pointerdown` takes the focus from the box before the click
                    // arrives, and choosing with the mouse leaves the cursor nowhere.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => pick(model)}
                  >
                    <span className="model-picker__name">{model}</span>
                    {model === (active.model ?? "") && (
                      <span className="model-picker__tag">{t("ai.inUse")}</span>
                    )}
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={fetchCatalog}
          disabled={busy || searching}
          className="rounded border border-edge bg-raised px-3 py-1.5 font-mono text-[11px] text-faint transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {t(searching ? "ai.modelsLoading" : "ai.modelsFetch")}
        </button>
        <ActionButton
          tone="raised"
          type="submit"
          busy={saving}
          busyLabel={t("ai.saving")}
          disabled={busy || !changed}
        >
          {t("ai.save")}
        </ActionButton>
      </div>

      <p className="mt-1.5 font-mono text-[11px] text-faint">
        {imported
          ? t("ai.modelsLive", { n: imported.length })
          : noCatalog
            ? t("ai.modelsNone")
            : all.length === 0
              ? t("ai.modelsEmpty")
              : t("ai.modelsHint", { n: all.length })}
      </p>

      {/*
         That the address is redirected is not wrong —pointing to one's own gateway is a
         legitimate use— but it also cannot be invisible: the key is sent there.
        */}
      {active.redirected && (
        <p className="mt-1 font-mono text-[11px] text-idle">{t("ai.redirected")}</p>
      )}
    </form>
  );
}

function KeyRow({
  entry,
  busy,
  onSave,
  onForget,
  onUsar,
}: {
  /*
    It is called `entry` and not `key` because `key` is from React: as a prop, it is intercepted
    by the reconciler and never reaches the component. When moving the project to English, `clave`
    fell right on that word and the component was left without its data.
   */
  entry: KeyView;
  busy: string | null;
  onSave: (key: string) => Promise<ApiResponse | null>;
  onForget: () => void;
  onUsar: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const key = value.trim();
    if (!key || busy) return;
    // It is emptied before knowing if it went well: if it failed, the password is re-entered; if it
    // worked, it is not left written on the screen. The field is never the place where a password
    // lives.
    setValue("");
    await onSave(key);
  }

  const state = entry.fromEnv
    ? t("ai.fromEnv", { var: entry.fromEnv })
    : entry.masked
      ? t("ai.stored", { key: entry.masked })
      : t("ai.noKey");

  return (
    <li className="rounded-lg border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <strong className="text-sm font-semibold text-chalk">{entry.name}</strong>
            <span className="font-mono text-[11px] text-faint">{state}</span>
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-faint">
            {entry.description}
            {entry.defaultModel && ` · ${entry.defaultModel}`}
          </p>
        </div>
        <Choose
          active={entry.active}
          can={Boolean(entry.fromEnv || entry.masked)}
          busy={busy !== null}
          loading={busy === `usar:${entry.id}`}
          onChoose={onUsar}
        />
      </div>

      <form onSubmit={save} className="mt-3 flex flex-wrap items-center gap-2">
        {/*
           `type="password"` and `autoComplete="off"`: without the first one the password is
           visible to anyone who passes behind, and without the second one the browser offers to
           save it in its own store, which is one more place over which we no longer control
           anything.
          */}
        <input
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          maxLength={500}
          placeholder={entry.envVars[0] ?? t("ai.keyPlaceholder")}
          aria-label={t("ai.keyLabel", { name: entry.name })}
          className="min-w-0 flex-1 rounded border border-edge bg-raised px-2.5 py-1.5 font-mono text-xs text-chalk placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <ActionButton
          tone="raised"
          type="submit"
          busy={busy === `clave:${entry.id}`}
          busyLabel={t("ai.saving")}
          disabled={busy !== null || !value.trim()}
        >
          {t("ai.save")}
        </ActionButton>
        {entry.masked && (
          <button
            type="button"
            onClick={onForget}
            disabled={busy !== null}
            className="font-mono text-[11px] text-faint transition-colors hover:text-fail disabled:opacity-50"
          >
            {t("ai.forget")}
          </button>
        )}
        {entry.signupUrl && (
          <a
            href={entry.signupUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-faint transition-colors hover:text-accent"
          >
            {t("ai.getKey")} <HiOutlineArrowRight aria-hidden />
          </a>
        )}
      </form>
    </li>
  );
}

/** The choose provider button, with its three states: set, eligible, and not eligible. */
function Choose({
  active,
  can,
  busy,
  loading,
  onChoose,
}: {
  active: boolean;
  can: boolean;
  busy: boolean;
  loading: boolean;
  onChoose: () => void;
}) {
  const t = useT();

  if (active) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded border border-edge bg-raised px-3 py-1.5 font-mono text-[11px] text-faint">
        <HiOutlineCheck aria-hidden /> {t("ai.inUse")}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onChoose}
      disabled={busy || !can}
      /*
        Disabled and with the reason on the label: a turned-off button without explanation leaves
        you guessing, and here the cause is always one of two and both can be fixed.
       */
      title={can ? undefined : t("ai.cantUse")}
      className="shrink-0 rounded border border-edge bg-raised px-3 py-1.5 font-mono text-[11px] text-smoke transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
    >
      {t(loading ? "ai.choosing" : "ai.choose")}
    </button>
  );
}
