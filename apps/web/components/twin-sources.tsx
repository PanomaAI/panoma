"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "./i18n-provider";
import { ActionButton, ActionError, Card, Check, formatBytes } from "./primitives";
import type { ConsentState } from "@panoma/core";
import { captureRefusalKey, type GrantView, type SourceGrantsView } from "@/lib/memory-view";

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
  ── The second permission of a source: reading its receipts ──────────────────────
  Letting Panoma read a history for the portrait is one thing; letting it read the receipts a
  hook leaves in a transcript, to know whether the memory it served actually reached the session,
  is another (plan §7.1: `memoryCapture` is a grant on top of the source permission, never
  implied by it). The switch lives under the rows, only for a source that is already open, and
  the sentences above it say what the plan demands be said before the yes: what is read (hook
  receipts and lifecycle records only), what is kept (offer ids, byte coordinates, hashes —
  never text), from which point (the end of each file at activation) and how it is taken back
  and what stays. The label by itself is not the consent. Delivery A grants it globally; the
  per-project variant is a later delivery and the body already carries the `scope` door.
  ── Only where a reader exists, and refused in the reader's language ─────────────────
  The switch is drawn for the sources this version reads receipts from (`supported`, from the
  same set the door refuses with) and the others get one quiet sentence: a switch on Codex would
  promise to read what nothing reads, and the door would answer `unsupported_source` to the
  click. When the door does refuse, it answers `{ code, error }` because the CLI reads the same
  door; this card translates the code (`captureRefusalKey`) and shows the English sentence only
  for a code it does not know, so a person reading in Spanish is not handed a machine's English.
  ── Three decisions per source since delivery B, each with its own notice ─────────────
  The receipts switch is the first. The second is the version-2 notice of the same capture
  grant: accepting it lets the capture pass note typed facts of each session — reads, edits,
  the family of a command, test outcomes, failures, commits, lifecycle — and never a line of
  text; it posts `noticeVersion: 2` on the enabled grant, a re-consent that moves no generation,
  so the door needs `expectedRevision` and the boundary is fixed at the end of each stream as it
  is then. The third is the paid extraction (`memoryExtract`), its own grant, whose notice says
  what travels to the provider (the person's new messages of the allowed range, redacted, and
  the facts), what is kept (the quotes that support a proposal, bounded), what it costs (the
  automatic calls a day and per conversation), from which byte, how it is taken back, and that
  it stops with the capture: a process that may not observe may not extract.
  ── What re-enabling means ─────────────────────────────────────────────────────
  Turning the receipts back on posts notice 1, whatever version the stored grant kept: the
  sentence next to the box is the version-1 notice, and what a person accepts is what is on
  the screen at that moment. The facts notice therefore has to be accepted again, and its own
  sentence says so. A revoke posts the stored version because the door ignores the notice of a
  revocation anyway (taking a permission back is not accepting a smaller one). The extraction
  box stays drawn while the receipts are off — granted but stopped — because a permission that
  is not seen is not revoked; it can be unticked then, and cannot be ticked, since the door would
  answer `consent_required`.
  ── The fourth decision since delivery D: the Twin learns continuously ──────────────────
  `twinAutoLearn` is its own grant on top of the capture (plan §10.5): with it, the worker reads
  the person's new messages of the allowed range in batches, notes observations and proposes
  criteria, and never asks per batch. Its notice says what travels (the redacted messages, never
  the agent's replies nor a copy or a relay), what is kept (observations with their quote, the
  criteria proposed), what it costs (the automatic batches a day inside the reading cap, the
  figure from the processor's own constant and today's cap), what it never does (publish: the
  publication permission stays its own yes further down), from which byte, how it is taken back
  and what a revocation keeps — the signatures, the published criteria, the direct teaching.
  The box follows the extraction's rule: granted but stopped while the receipts are off, and it
  cannot be ticked then. Its progress and the pause per project live in the learning block
  under this card (`twin-learning.tsx`).
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

/** The grant alternative of `/api/twin/sources`, one purpose at a time and always with the revision the screen saw. */
interface GrantRequest {
  source: string;
  purpose: "memoryCapture" | "memoryExtract" | "twinAutoLearn";
  allowed: boolean;
  noticeVersion: 1 | 2;
  expectedRevision: number;
}

export function TwinSources({
  sources,
  grants,
  extraction,
  learning,
}: {
  sources: SourceView[];
  /** Per source id: whether this version reads it, and its global grant per purpose (null when never asked). */
  grants: Record<string, SourceGrantsView>;
  /** The figures the extraction notice states: the caps and the retention bounds, from the processor's constants. */
  extraction: { dailyCap: number; perConversation: number; quotes: number; quoteChars: number };
  /** The figure the learning notice states: the automatic batches a day, min(subquota, reading cap). */
  learning: { dailyCap: number };
}) {
  const translate = useT();
  const locale = useLocale();
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

  /*
    The grants, the same door with a purpose on it. Nothing is drawn from the request: on success
    the page is refreshed and the boxes reflect the grant the server wrote, because `twin.json`
    is also written by the terminal and a box ticked before the write is exactly the «permission
    that was not saved» this card exists to avoid. Every click carries the generation it saw, so
    two hands on the same file meet a `stale_revision` instead of overwriting each other.
   */
  async function grant(request: GrantRequest) {
    setSaving(request.source);
    setError(null);
    try {
      const response = await fetch("/api/twin/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, scope: "global" }),
      });
      const payload = (await response.json().catch(() => ({}))) as { sources?: SourceView[]; code?: string; error?: string };
      if (!response.ok) {
        const key = captureRefusalKey(payload.code);
        setError(key ? translate(key) : payload.error ?? String(response.status));
        return;
      }
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
         The grants, only for the sources that are already open: a grant on a closed source
         would promise to read what nothing may open. The three notices are written once, above
         the boxes, and every sentence of each is required before its yes (plan §7.1, §20.4).
        */}
      {shown.some((row) => row.state === "allowed") && (
        <div className="mt-4 border-t border-edge pt-3">
          <h3 className="text-sm font-semibold">{translate("twin.captureTitle")}</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-smoke">{translate("memory.captureConsent")}</p>
          <ul className="mt-2 max-w-2xl space-y-1 text-xs leading-relaxed text-smoke">
            <li>{translate("twin.captureReads")}</li>
            <li>{translate("twin.captureRetains")}</li>
            <li>{translate("twin.captureFrom")}</li>
            <li>{translate("twin.captureRevokeNote")}</li>
            <li>{translate("twin.captureScope")}</li>
          </ul>

          <h4 className="mt-3 text-xs font-semibold">{translate("twin.factsTitle")}</h4>
          <ul className="mt-1 max-w-2xl space-y-1 text-xs leading-relaxed text-smoke">
            <li>{translate("twin.factsReads")}</li>
            <li>{translate("twin.factsFrom")}</li>
          </ul>

          <h4 className="mt-3 text-xs font-semibold">{translate("twin.extractTitle")}</h4>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-smoke">{translate("memory.extractConsent")}</p>
          <ul className="mt-1 max-w-2xl space-y-1 text-xs leading-relaxed text-smoke">
            <li>{translate("twin.extractTravels")}</li>
            <li>{translate("twin.extractRetains", { quotes: extraction.quotes, chars: extraction.quoteChars })}</li>
            <li>{translate("twin.extractQuota", { daily: extraction.dailyCap, perConversation: extraction.perConversation })}</li>
            <li>{translate("twin.extractFrom")}</li>
            <li>{translate("twin.extractRevokeNote")}</li>
            <li>{translate("twin.extractNeedsCapture")}</li>
            <li>{translate("twin.captureScope")}</li>
          </ul>

          <h4 className="mt-3 text-xs font-semibold">{translate("twin.learnSwitchTitle")}</h4>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-smoke">{translate("memory.twinAutoLearnConsent")}</p>
          <ul className="mt-1 max-w-2xl space-y-1 text-xs leading-relaxed text-smoke">
            <li>{translate("twin.learnTravels")}</li>
            <li>{translate("twin.learnRetains")}</li>
            <li>{translate("twin.learnQuota", { daily: learning.dailyCap })}</li>
            <li>{translate("twin.learnNeverPublishes")}</li>
            <li>{translate("twin.learnFrom")}</li>
            <li>{translate("twin.learnRevokeNote")}</li>
            <li>{translate("twin.learnNeedsCapture")}</li>
            <li>{translate("twin.captureScope")}</li>
          </ul>

          <div className="mt-3 flex flex-col gap-3">
            {shown.filter((row) => row.state === "allowed").map((row) => {
              const view = grants[row.id];
              /* No reader, no switch: the sentence says what this version does with the source. */
              if (view?.supported !== true) {
                return (
                  <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1">
                    <span className="font-mono text-xs">{row.label}</span>
                    <span className="justify-self-end font-mono text-xs text-idle">{translate("twin.captureUnsupported")}</span>
                  </div>
                );
              }
              const capture = view.capture;
              const extract = view.extract;
              const autoLearn = view.autoLearn;
              const captureOn = capture?.enabled === true;
              const factsOn = captureOn && (capture?.noticeVersion ?? 1) >= 2;
              const extractOn = extract?.enabled === true;
              const learnOn = autoLearn?.enabled === true;
              const revisionOf = (one: GrantView | null) => one?.generation ?? 0;
              const since = (one: GrantView) => new Date(one.activatedAt).toLocaleDateString(locale);
              return (
                <div key={row.id}>
                  <p className="font-mono text-xs">{row.label}</p>
                  <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1">
                    <Check
                      size="sm"
                      checked={captureOn}
                      disabled={saving !== null}
                      onChange={(event) => void grant({
                        source: row.id, purpose: "memoryCapture", allowed: event.target.checked,
                        /* Enabling accepts the notice on screen (1); a revoke carries the stored version, which the door keeps. */
                        noticeVersion: event.target.checked ? 1 : capture?.noticeVersion === 2 ? 2 : 1,
                        expectedRevision: revisionOf(capture),
                      })}
                    >
                      <span className="text-xs">{translate("twin.captureAccept")}</span>
                    </Check>
                    <span className="justify-self-end font-mono text-xs text-smoke">
                      {captureOn && capture ? translate("twin.captureOn", { date: since(capture) }) : translate("twin.captureOff")}
                    </span>
                    {captureOn && capture && (
                      <>
                        <Check
                          size="sm"
                          checked={factsOn}
                          disabled={saving !== null}
                          onChange={(event) => void grant({
                            source: row.id, purpose: "memoryCapture", allowed: true,
                            noticeVersion: event.target.checked ? 2 : 1,
                            expectedRevision: revisionOf(capture),
                          })}
                        >
                          <span className="text-xs">{translate("twin.factsAccept")}</span>
                        </Check>
                        <span className="justify-self-end font-mono text-xs text-smoke">
                          {translate(factsOn ? "twin.factsOn" : "twin.factsOff")}
                        </span>
                      </>
                    )}
                    <Check
                      size="sm"
                      checked={extractOn}
                      /* Granted-but-stopped can be unticked; a tick with the receipts off would be refused. */
                      disabled={saving !== null || (!captureOn && !extractOn)}
                      onChange={(event) => void grant({
                        source: row.id, purpose: "memoryExtract", allowed: event.target.checked,
                        noticeVersion: 1,
                        expectedRevision: revisionOf(extract),
                      })}
                    >
                      <span className="text-xs">{translate("memory.extractConsent")}</span>
                    </Check>
                    <span className="justify-self-end font-mono text-xs text-smoke">
                      {extractOn && extract
                        ? translate(captureOn ? "twin.extractOn" : "twin.extractPaused", { date: since(extract) })
                        : translate("twin.extractOff")}
                    </span>
                    {/*
                       The learning, on the same rule as the extraction: it can be unticked while
                       the receipts are off, and cannot be ticked then. Enabling posts notice 1,
                       the one on screen; a revoke carries the same number and the door keeps the
                       accepted one anyway.
                      */}
                    <Check
                      size="sm"
                      checked={learnOn}
                      disabled={saving !== null || (!captureOn && !learnOn)}
                      onChange={(event) => void grant({
                        source: row.id, purpose: "twinAutoLearn", allowed: event.target.checked,
                        noticeVersion: 1,
                        expectedRevision: revisionOf(autoLearn),
                      })}
                    >
                      <span className="text-xs">{translate("memory.twinAutoLearnConsent")}</span>
                    </Check>
                    <span className="justify-self-end font-mono text-xs text-smoke">
                      {learnOn && autoLearn
                        ? translate(captureOn ? "twin.learnOn" : "twin.learnStopped", { date: since(autoLearn) })
                        : translate("twin.learnOff")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/*
         The permission card's only failure channel. `ActionError` carries `role="alert"`, which is
         what a refused grant needs: the row goes back to how it was and nothing else says why.
        */}
      {error && <ActionError text={error} className="mt-2" />}
    </Card>
  );
}
