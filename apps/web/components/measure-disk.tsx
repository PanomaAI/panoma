"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale, useT } from "./i18n-provider";
import { ActionButton, ActionError } from "./primitives";

/**
 * Trigger the measurement of the entire catalog's disk.
 *
 * It takes minutes, so the button tells you how long it will take **before** you press it. A
 * announced wait is a wait; a surprise wait is a frozen app.
 */
export function MeasureDisk({ measuredAt }: { measuredAt: string | null }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [state, setState] = useState<"ready" | "measuring">("ready");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ measured: number; missing: number } | null>(null);

  async function measure() {
    setState("measuring");
    setError(null);
    try {
      const response = await fetch("/api/disk", { method: "POST" });
      const payload = await response.json();
      if (response.ok) {
        setResult(payload as { measured: number; missing: number });
        router.refresh();
      } else {
        setError((payload as { error?: string }).error ?? t("measure.failed"));
      }
    } catch {
      setError(t("measure.unreachable"));
    } finally {
      setState("ready");
    }
  }

  return (
    <div>
      <ActionButton
        tone="surface"
        type="button"
        onClick={measure}
        busy={state === "measuring"}
        busyLabel={t("measure.busy")}
      >
        {measuredAt ? t("measure.again") : t("measure.start")}
      </ActionButton>

      <p className="mt-2 font-mono text-[11px] text-faint">
        {state === "measuring"
          ? t("measure.noteBusy")
          : measuredAt
            ? t("measure.noteLast", { when: new Date(measuredAt).toLocaleString(locale) })
            : t("measure.noteFirst")}
      </p>

      {result && (
        <p className="mt-1 font-mono text-[11px] text-live">
          {t("measure.done", { n: result.measured })}
          {result.missing > 0 && ` · ${t("measure.missing", { n: result.missing })}`}
        </p>
      )}
      {error && <ActionError text={error} className="mt-1" />}
    </div>
  );
}
