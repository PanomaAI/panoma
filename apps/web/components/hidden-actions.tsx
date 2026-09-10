"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "./i18n-provider";
import { ActionButton, ActionError } from "./primitives";

/** Undo, in its smallest form: a request and refresh. */
function useUndo() {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) router.refresh();
      else
        setError(
          ((await response.json()) as { error?: string }).error ?? t("undo.failed"),
        );
    } catch {
      setError(t("undo.unreachable"));
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, send };
}

export function Unhide({ projectId }: { projectId: string }) {
  const t = useT();
  const { busy, error, send } = useUndo();
  return (
    <span className="inline-flex items-center gap-2">
      {error && <ActionError as="span" text={error} />}
      <ActionButton
        tone="raised"
        size="sm"
        type="button"
        busy={busy}
        busyLabel="…"
        onClick={() => send({ action: "mostrar", id: projectId })}
        className="shrink-0"
      >
        {t("undo.unhide")}
      </ActionButton>
    </span>
  );
}

export function Readmit({ root }: { root: string }) {
  const t = useT();
  const { busy, error, send } = useUndo();
  return (
    <span className="inline-flex items-center gap-2">
      {error && <ActionError as="span" text={error} />}
      <ActionButton
        tone="raised"
        size="sm"
        type="button"
        busy={busy}
        busyLabel="…"
        onClick={() => send({ action: "readmitir", root })}
        className="shrink-0"
      >
        {t("undo.readmit")}
      </ActionButton>
    </span>
  );
}
