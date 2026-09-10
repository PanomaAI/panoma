"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./i18n-provider";
import { ActionButton, ActionError, Card, formatBytes } from "./primitives";
import type { ConsentState } from "@panoma/core";

/*
  The first gesture of all, which until now was a terminal command.
  The portrait screen, with the empty catalog, said "start with `panoma twin sources` " — meaning
  that the first step of the product was a prerequisite. And it wasn’t just the inventory:
  granting the permission also existed solely on the terminal, and it is the step that cannot be
  skipped, because it is the one that opens the most intimate 1.78 GB of the disk.
  ── What is taught before asking for anything ─────────────────────────────────────────
  How many files and how many bytes each story has, measured with `stat` and **without opening any
  of them**. This is what turns the question into a decision: no one says yes to 'your history,'
  they say yes to 1.7 GB with a name in front. Without the amount, this would be a button to
  accept terms.
  ── One switch per source, and none that is worth for all ─────────────────────
  Reading Claude Code is not reading Codex: they are different tools and often from different
  clients. A 'allow everything' turns five decisions into one, and whoever has to choose between
  everything and nothing chooses poorly — the one who says yes ends up saying it also about what
  they would not have wanted to teach.
  ── The four situations are rendered differently because they lead to different places ───
  Granted, pending, without a reader, and absent. `noReader` is not a shade of 'pending': they are
  the opposite, and offering a button on Cursor would promise to read it in exchange for a
  permission that opens nothing. The rule is decided by the engine —`consentState`— so that this
  screen and the terminal cannot disagree.
 */

interface SourceView {
  id: string;
  label: string;
  path: string;
  present: boolean;
  files: number;
  bytes: number;
  state: ConsentState;
}

export function TwinSources({ sources }: { sources: SourceView[] }) {
  const translate = useT();
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState(sources);

  async function decide(source: string, allowed: boolean) {
    setSaving(source);
    setError(null);
    try {
      const response = await fetch("/api/twin/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, allowed }),
      });
      const payload = (await response.json()) as { sources?: SourceView[]; error?: string };
      if (!response.ok) {
        setError(payload.error ?? String(response.status));
        return;
      }
      /*
        What is being rendered is what the server responds and not what was requested. The
        permission file may be being handled by two places —this screen and `panoma twin allow` —
        and drawing 'yes' before it is written is exactly how a permission that wasn't saved is
        shown.
       */
      if (payload.sources) setRows(payload.sources);
      router.refresh();
    } catch {
      setError(translate("project.unreachable"));
    } finally {
      setSaving(null);
    }
  }

  /* The absent is not listed: there is nothing to offer about what has not been written here. */
  const shown = rows.filter((row) => row.state !== "absent");
  if (shown.length === 0) {
    return (
      <Card as="section" tone="plain" aria-labelledby="twin-sources-title">
        <h2 id="twin-sources-title" className="text-base font-semibold">{translate("twin.sourcesTitle")}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed">
          {translate("twin.sourcesNone")}
        </p>
      </Card>
    );
  }

  return (
    <Card as="section" tone="plain" aria-labelledby="twin-sources-title">
      <h2 id="twin-sources-title" className="text-base font-semibold">{translate("twin.sourcesTitle")}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed">{translate("twin.sourcesLead")}</p>

      {/*
         One row per history, on a grid rather than a wrapped line: the answer sat immediately
         after text of a different width in every row, so the two buttons that open 1.7 GB and
         3.8 GB of private conversation landed at two different places on the screen. The decision
         column is the same column for every source now.
        */}
      <div className="mt-3 flex flex-col gap-2">
        {shown.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1"
          >
            <span className="min-w-0">
              <span className="font-mono text-xs">{row.label}</span>{" "}
              {/*
                 The measure is not chrome: it is what turns «may I read your history» into a
                 decision — nobody says yes to «your history», they say yes to 1.7 GB with a name
                 in front. `--color-smoke` is the ink content is written in.
                */}
              <span className="font-mono text-xs text-smoke">
                {row.present
                  ? translate("twin.sourceSize", {
                      files: row.files,
                      size: formatBytes(row.bytes),
                    })
                  : translate("twin.sourceGone")}
              </span>
            </span>
            {row.state === "noReader" ? (
              <span className="justify-self-end font-mono text-xs text-idle">
                {translate("twin.sourceNoReader")}
              </span>
            ) : (
              /* The two chains this ternary alternated are the `plain` and `accent` tones at the
                 same box: the row that is already open offers the quiet way out, the one that is
                 shut offers the black button. That is one prop now, not two class strings. */
              <ActionButton
                tone={row.state === "allowed" ? "plain" : "accent"}
                type="button"
                onClick={() => decide(row.id, row.state !== "allowed")}
                busy={saving === row.id}
                busyLabel={translate("twin.saving")}
                disabled={saving !== null}
                className="justify-self-end"
              >
                {translate(row.state === "allowed" ? "twin.sourceRevoke" : "twin.sourceAllow")}
              </ActionButton>
            )}
          </div>
        ))}
      </div>

      {/*
         And what revocation **does not** do, said where it is revoked. The word promises that
         what has been read is erased, and it is not true: it closes the door and leaves inside
         what has already entered. Half a promise on a privacy screen is a false promise.
        */}
      <p className="mt-3 max-w-2xl font-mono text-xs text-faint">
        {translate("twin.sourcesRevokeNote")}
      </p>
      {/*
         The permission card's only failure channel. `ActionError` carries `role="alert"`, which is
         what a refused grant needs: the row goes back to how it was and nothing else says why.
        */}
      {error && <ActionError text={error} className="mt-2" />}
    </Card>
  );
}
