"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./i18n-provider";
import { ActionButton, ActionError } from "./primitives";

/**
 * To remove an agent, first saying what is being taken out.
 *
 * Connecting without being able to disconnect is half a function: whoever tries an agent and
 * regrets it stays with the token forever, and whoever presses by mistake has no way back.
 *
 * Confirm in two steps and **with the account in front**, because deletion is not just the
 * password: sessions and activity hang from the agent in cascade, so what it recorded also goes
 * away. A generic “Are you sure?” would not have said the only thing you need to know to answer
 * it.
 */
export function DisconnectAgent({
  id,
  name,
  entries,
}: {
  id: string;
  name: string;
  /** Log entries that will be removed with it. Zero means nothing is lost. */
  entries: number;
}) {
  const t = useT();
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [state, setState] = useState<"ready" | "working">("ready");
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setState("working");
    setError(null);
    try {
      const response = await fetch("/api/agent/keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (response.ok && payload.ok) router.refresh();
      else {
        setError(payload.error ?? String(response.status));
        setState("ready");
      }
    } catch {
      setError(t("project.unreachable"));
      setState("ready");
    }
  }

  if (!asking) {
    return (
      /*
        `quiet` is the borderless text button of the house, and this is one of the four sites it
        was counted from. What it does not carry is the red hover this used to have: `quiet` goes
        to `smoke`. The gesture is still a first step and not the deletion — that one is `danger`
        below — so the cue moves from the hover to the word and to the sentence the click opens.
       */
      <ActionButton tone="quiet" size="sm" type="button" onClick={() => setAsking(true)}>
        {t("disconnect.do")}
      </ActionButton>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[11px] text-smoke">
        {t(entries > 0 ? "disconnect.losing" : "disconnect.nothingLost", { name, n: entries })}
      </span>
      {/*
         The red eraser is the tone `danger` exists for: `primitives.tsx` names this button by file
         when it explains why the sixth tone was added, and this is that chain retired.
        */}
      <ActionButton
        tone="danger"
        size="sm"
        type="button"
        onClick={() => void remove()}
        busy={state === "working"}
        busyLabel={t("disconnect.working")}
      >
        {t("disconnect.confirm")}
      </ActionButton>
      <ActionButton tone="quiet" size="sm" type="button" onClick={() => setAsking(false)}>
        {t("accounts.cancel")}
      </ActionButton>
      {error && <ActionError as="span" text={error} />}
    </span>
  );
}
