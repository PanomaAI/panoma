"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./i18n-provider";
import { ActionButton } from "./primitives";

/*
  The only question that Twin asks, and why there is exactly one.
  Before, there were hundreds: each distilled phrase awaited a yes, and with two thousand quotes
  in a corpus, that is work the size of history. When that queue closed, something happened that
  must be faced directly: **something that nobody has signed can now speak on your behalf** in
  every session of every agent you open. That boundary certainly deserves to be questioned.
  It is asked once and stored in `twin.json`, next to the permissions of the stories and with the
  same property: it is removed with `rm`. A permission that can only be removed from the
  application that requested it is not a permission either.
  ── What is taught before asking ──────────────────────────────────────────
  How many beliefs would enter and how much space they would take. A permission question without
  the figure next to it is an accept terms button: the answer is given anyway, but nothing has
  been decided.
  As long as it is not answered, the portrait is exactly what the person signed. It is not an
  error or a half state — it is the default value, and that is why the card is not rendered red.
 */

export function TwinConsent({
  standing,
  chars,
  cap,
}: {
  standing: number;
  chars: number;
  cap: number;
}) {
  const translate = useT();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(publishInferred: boolean) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/twin/taste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publishInferred }),
      });
      const payload = (await response.json()) as { error?: string };
      /*
        A portrait that does not fit answers 409 with its message, and here that **is not** a
        permission error: the yes was saved before reconciling. It shows what the catalog says
        —"does not fit, remove something"— and it refreshes the same, because the screen
        underneath is already different.
       */
      if (!response.ok) setError(payload.error ?? String(response.status));
      router.refresh();
    } catch {
      setError(translate("project.unreachable"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-12 rounded-lg border border-edge px-4 py-4">
      <p className="eyebrow">{translate("twin.consentTitle")}</p>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed">{translate("twin.consentBody")}</p>
      {/*
         The figure, and if it would fit with it. A permission question without the number next to
         it is an accept terms button; with the number but without saying it doesn't fit, the
         answer is given and the save is denied right after, which is worse than asking it
         beforehand.
        */}
      <p className={`mt-2 max-w-2xl font-mono text-xs ${chars > cap ? "text-idle" : "text-smoke"}`}>
        {translate("twin.consentCount", { n: standing, chars })}
        {chars > cap ? ` · ${translate("twin.consentOver", { cap })}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ActionButton
          tone="accent"
          type="button"
          onClick={() => answer(true)}
          busy={saving}
          busyLabel={translate("twin.saving")}
        >
          {translate("twin.consentAllow")}
        </ActionButton>
        <span className="font-mono text-xs text-faint">{translate("twin.consentRevoke")}</span>
      </div>
      {error && (
        <p className="mt-2 font-mono text-xs text-idle">
          {translate("twin.saveFailed", { detail: error })}
        </p>
      )}
    </section>
  );
}
