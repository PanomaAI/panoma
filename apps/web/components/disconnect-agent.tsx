"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./i18n-provider";
import { ActionError } from "./primitives";

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
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="font-mono text-[11px] text-faint transition-colors hover:text-fail"
      >
        {t("disconnect.do")}
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[11px] text-smoke">
        {t(entries > 0 ? "disconnect.losing" : "disconnect.nothingLost", { name, n: entries })}
      </span>
      <button
        type="button"
        onClick={() => void remove()}
        disabled={state === "working"}
        className="rounded border border-fail px-2 py-0.5 font-mono text-[11px] text-fail transition-colors hover:bg-fail hover:text-white disabled:opacity-50"
      >
        {t(state === "working" ? "disconnect.working" : "disconnect.confirm")}
      </button>
      <button
        type="button"
        onClick={() => setAsking(false)}
        className="font-mono text-[11px] text-faint transition-colors hover:text-smoke"
      >
        {t("accounts.cancel")}
      </button>
      {error && <ActionError as="span" text={error} />}
    </span>
  );
}
