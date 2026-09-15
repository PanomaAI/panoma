"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./i18n-provider";
import { ActionButton, ActionError, Card } from "./primitives";
import { tasteRefusalKey } from "@/lib/memory-view";

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
  ── Since delivery D the yes names the publication it looked at ──────────────────────────
  The body is the revisioned one (`version: 2`): the permission carries the generation of the
  publication GET reported, and a generation that moved — another plan, a flip from another
  tab — is refused as `publication_conflict` before anything is written, so the screen re-reads
  and the person answers over what is there. And the file now goes through the outbox: the door
  answers 200 when the portrait was written inline and 202 when the write is still pending, and
  both are a saved yes. What is no longer true is that a portrait that does not fit leaves the
  yes saved: the v2 door measures the cap before the flip, so `taste_full` is a refusal of the
  permission too, and the card says the door's sentence and grants nothing.
 */

export function TwinConsent({
  standing,
  chars,
  cap,
  publicationRevision,
}: {
  standing: number;
  chars: number;
  cap: number;
  /** The generation of the publication this screen read; the yes names it back. */
  publicationRevision: number;
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
        body: JSON.stringify({ version: 2, publishInferred, expectedPublicationRevision: publicationRevision }),
      });
      const payload = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
      /*
        A refusal is said by its code in the reader's language when the card knows it — the
        publication moved, the content changed — and by the door's own sentence otherwise, which
        for a portrait that does not fit is the translated one with the figures. The screen is
        refreshed either way: what is underneath may already be different.
       */
      if (!response.ok) {
        const key = tasteRefusalKey(payload.code);
        setError(key ? translate(key) : payload.error ?? String(response.status));
      }
      router.refresh();
    } catch {
      setError(translate("project.unreachable"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card as="section" tone="plain" className="mt-8" aria-labelledby="twin-consent-title">
      <h2 id="twin-consent-title" className="text-base font-semibold">{translate("twin.consentTitle")}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed">{translate("twin.consentBody")}</p>
      {/*
         Publication is not capture. The switch that opens a transcript sits three sections above
         this yes, and plan §14.1 asks that the controls of a source keep their effects apart: the
         sentence says what this one does NOT do, so «let them reach the file» cannot be read as one
         more door into the history.
        */}
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-smoke">
        {translate("twin.consentDistinct")}{" "}
        {/*
           And since delivery B the histories card holds a third door, the paid extraction that
           proposes project memory; this yes is not that one either, and it says so in the same
           breath, because «publish» and «propose» are the two words a person could take for the
           same thing (plan §14.1: capture, extraction and publication with distinct effects).
          */}
        {translate("twin.consentDistinctExtract")}
      </p>
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
      {/*
         The refusal of the one question on this screen, announced. It was a bare paragraph on
         `text-idle` — 2.15:1, the worst of the five inks the owner keeps below AA — with no role
         at all, so a yes that was not saved reached only the eye that happened to be on it.
         `ActionError` carries `role="alert"`, and the sources card next door already took it.
        */}
      {error && (
        <ActionError text={translate("twin.saveFailed", { detail: error })} className="mt-2" />
      )}
    </Card>
  );
}
