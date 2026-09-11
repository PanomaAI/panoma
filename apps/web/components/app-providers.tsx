"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { HiOutlineKey, HiOutlineMicrophone } from "react-icons/hi2";
import { appRequest, type AppCredentialStatus, type AppSummary } from "@/lib/apps-view";
import { useLocale, useT } from "./i18n-provider";
import { ActionButton, ActionError, Card, Check, Field, Select, Tag } from "./primitives";

export const BRAINS = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "anthropic", label: "Anthropic API" },
  { value: "openai", label: "OpenAI API" },
];

/** Credential storage and provider consent are separate actions. Neither starts production. */
export function AppProviders({ app, busy, onSave, step }: {
  app: AppSummary;
  busy: boolean;
  onSave: () => Promise<void>;
  /** Where this card stands in the order of the setup, drawn above its title. */
  step?: ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const [brain, setBrain] = useState<string | null>(null);
  const [voice, setVoice] = useState<boolean | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const [credential, setCredential] = useState<AppCredentialStatus | null>(null);
  const [credentialError, setCredentialError] = useState(false);
  const [checking, setChecking] = useState(true);
  const inFlight = useRef(false);
  const chosenBrain = brain ?? app.settings?.brain ?? "none";
  const chosenVoice = voice ?? app.settings?.voice ?? false;
  const enabling = (chosenBrain !== "none" && chosenBrain !== (app.settings?.brain ?? "none"))
    || (chosenVoice && !app.settings?.voice);
  const missingVoiceKey = chosenVoice && !credential?.configured;
  const locked = busy || saving;
  const endpoint = `/api/apps/${encodeURIComponent(app.id)}/credentials`;

  const loadCredential = useCallback(async (signal?: AbortSignal) => {
    setChecking(true);
    setCredentialError(false);
    try {
      const status = await appRequest<AppCredentialStatus>(endpoint, undefined, "GET", signal);
      if (!signal?.aborted) setCredential(status);
    } catch {
      if (!signal?.aborted) setCredentialError(true);
    } finally {
      if (!signal?.aborted) setChecking(false);
    }
  }, [endpoint]);
  useEffect(() => {
    const controller = new AbortController();
    void loadCredential(controller.signal);
    return () => controller.abort();
  }, [loadCredential]);

  function changed() {
    setConfirmed(false);
    setSaved(false);
    setError(false);
  }

  async function save() {
    if (inFlight.current || locked || missingVoiceKey || (enabling && !confirmed)) return;
    inFlight.current = true;
    setSaving(true);
    setSaved(false);
    setError(false);
    try {
      const result = await appRequest<{ settings: { brain: string; voice: boolean } }>(`/api/apps/${encodeURIComponent(app.id)}/settings`, {
        brain: chosenBrain, voice: chosenVoice, confirm: confirmed,
      }, "PATCH");
      // A successful patch remains visible even if refreshing disk usage subsequently fails.
      setBrain(result.settings.brain);
      setVoice(result.settings.voice);
      await onSave();
      setConfirmed(false);
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="app-providers-title">
      {step}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <h2 id="app-providers-title" className="text-base font-semibold">{t("apps.providers")}</h2>
        <Tag size="md">{t("apps.optional")}</Tag>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-smoke">{t("apps.providersIntro")}</p>

      <div className="mt-5">
        <Select label={t("apps.brain")} value={chosenBrain} disabled={locked}
          onChange={(event) => { setBrain(event.target.value); changed(); }}>
          <option value="none">{t("apps.none")}</option>
          <option value="auto">{t("apps.auto")}</option>
          {BRAINS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
        <p className="mt-2 text-xs leading-relaxed text-smoke">{t("apps.brainHint")}</p>
        <Link href="/ai" className="mt-2 inline-block text-xs underline underline-offset-4">{t("apps.configureModel")}</Link>
      </div>

      <div className="mt-5 border-t border-edge pt-5">
        <div className="flex items-center gap-2">
          <HiOutlineMicrophone aria-hidden className="h-5 w-5" />
          <h3 className="text-sm font-semibold">{t("apps.voice")}</h3>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-smoke">{t("apps.voiceHint")}</p>
        {checking ? <p role="status" className="mt-3 text-xs text-smoke">{t("apps.key.loading")}</p>
          : credentialError ? (
            <div className="mt-3">
              <ActionError text={t("apps.key.loadFailed")} />
              <ActionButton type="button" tone="surface" className="mt-2" onClick={() => void loadCredential()}>{t("apps.retry")}</ActionButton>
            </div>
          ) : credential && (
            <ElevenLabsCredential endpoint={endpoint} status={credential} busy={locked} onChanged={(status) => {
              setCredential(status);
              changed();
            }} />
          )}
        <Check size="lg" className="mt-4" checked={chosenVoice}
          disabled={locked || (checking && !chosenVoice) || (!credential?.configured && !chosenVoice)}
          onChange={(event) => { setVoice(event.target.checked); changed(); }}>
          {t("apps.enableVoice")}
        </Check>
        {missingVoiceKey && <p className="mt-2 text-xs text-smoke">{t("apps.key.required")}</p>}
      </div>

      {enabling && (
        <div className="mt-5 border-t border-edge pt-4">
          <div className="space-y-2 text-xs leading-relaxed text-smoke">
            {(app.manifest?.providers?.filter((provider) => provider.id === "brain" ? chosenBrain !== "none" : chosenVoice) ?? []).map((provider) => (
              <p key={provider.id}>{provider.sends[locale]}</p>
            ))}
          </div>
          <Check size="lg" className="mt-3" checked={confirmed} disabled={locked}
            onChange={(event) => setConfirmed(event.target.checked)}>{t("apps.providerConfirm")}</Check>
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-edge pt-4">
        <ActionButton type="button" tone="accent" busy={saving} busyLabel={t("apps.saving")}
          disabled={locked || missingVoiceKey || (enabling && !confirmed)} onClick={() => void save()}>
          {t("apps.providerSave")}
        </ActionButton>
        <p role="status" className="text-xs text-smoke">{saved ? t("apps.providersSaved") : ""}</p>
      </div>
      {error && <ActionError text={t("apps.providersFailed")} className="mt-3" />}
      <Link href="/spend" className="mt-3 inline-block text-xs underline underline-offset-4">{t("apps.spendLink")}</Link>
    </Card>
  );
}

/** The server returns presence only. A stored key is never rendered or used as an input value. */
function ElevenLabsCredential({ endpoint, status, busy, onChanged }: {
  endpoint: string; status: AppCredentialStatus; busy: boolean; onChanged: (status: AppCredentialStatus) => void;
}) {
  const t = useT();
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [message, setMessage] = useState<"saved" | "removed" | null>(null);
  const inFlight = useRef(false);
  const locked = busy || saving;
  const editor = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (editing) editor.current?.querySelector("input")?.focus();
  }, [editing]);

  async function mutate(method: "POST" | "DELETE") {
    if (inFlight.current || locked) return;
    inFlight.current = true;
    setSaving(true);
    setError(false);
    setMessage(null);
    try {
      const result = await appRequest<AppCredentialStatus>(endpoint,
        method === "POST" ? { provider: "elevenlabs", key: key.trim() } : { provider: "elevenlabs" }, method);
      setKey("");
      setEditing(false);
      setRemoving(false);
      setMessage(method === "POST" ? "saved" : "removed");
      onChanged(result);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <HiOutlineKey aria-hidden className="h-4 w-4" />
        <Tag size="md" tone={status.configured ? "strong" : "neutral"}>
          {t(status.configured ? "apps.key.configured" : "apps.key.missing")}
        </Tag>
      </div>
      {(!status.configured || editing) && (
        <form ref={editor} className="mt-3" onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          if (key.trim()) void mutate("POST");
        }}>
          <Field label={t("apps.key.label")} type="password" autoComplete="off" spellCheck={false}
            required maxLength={500} value={key} disabled={locked} aria-describedby="elevenlabs-key-hint"
            onChange={(event) => { setKey(event.target.value); setError(false); setMessage(null); }} />
          <p id="elevenlabs-key-hint" className="mt-2 text-xs leading-relaxed text-smoke">{t("apps.key.hint")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <ActionButton type="submit" tone="surface" busy={saving} busyLabel={t("apps.saving")} disabled={locked || !key.trim()}>
              {t("apps.key.save")}
            </ActionButton>
            {editing && <ActionButton type="button" tone="quiet" disabled={locked} onClick={() => { setEditing(false); setKey(""); }}>{t("apps.cancel")}</ActionButton>}
            <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer" className="text-xs underline underline-offset-4">
              {t("apps.key.get")}
            </a>
          </div>
        </form>
      )}
      {status.configured && !editing && !removing && (
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionButton type="button" tone="surface" disabled={locked} onClick={() => { setEditing(true); setMessage(null); }}>{t("apps.key.replace")}</ActionButton>
          <ActionButton type="button" tone="quiet" disabled={locked} onClick={() => setRemoving(true)}>{t("apps.key.remove")}</ActionButton>
        </div>
      )}
      {removing && (
        <div className="mt-3 border-l border-edge pl-3">
          <p className="text-xs leading-relaxed">{t("apps.key.removeConfirm")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <ActionButton type="button" tone="danger" busy={saving} disabled={locked} onClick={() => void mutate("DELETE")}>{t("apps.key.remove")}</ActionButton>
            <ActionButton type="button" tone="quiet" disabled={locked} onClick={() => setRemoving(false)}>{t("apps.cancel")}</ActionButton>
          </div>
        </div>
      )}
      <p role="status" className="mt-2 text-xs text-smoke">{message ? t(message === "saved" ? "apps.key.saved" : "apps.key.removed") : ""}</p>
      {error && <ActionError text={t("apps.key.saveFailed")} className="mt-2" />}
    </div>
  );
}
