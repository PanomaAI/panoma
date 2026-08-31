"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./i18n-provider";
import { ActionButton } from "./primitives";

/**
 * What the mechanical critic saw, one finding and one button at a time.
 *
 * The queue of orders already offered 'fix what can be seen without opening the project,' and that
 * order carries all twenty findings inside. It is the right thing for twenty loose colors
 * —ordering them separately would be twenty terminals— and it is rough for the single broken link
 * of an otherwise clean project: to request that one, you had to send the entire list and trust
 * that the agent wouldn't get distracted by the rest.
 *
 * So this is the one next to it, not the one above: the entire list still exists and this adds the
 * other granularity. Both paths end up at the same tail.
 *
 * ── What is sent is a number ─────────────────────────────────────────────────────
 *
 * The position within the review being taught, never the text: it is written by the server reading
 * the row. See header of `/api/twin/critique`, which also explains why what **is saved** is not
 * that position but the content key.
 */

export interface CritiqueView {
  /** The position in the saved review. It is the only thing that travels to the server. */
  index: number;
  kind: string;
  claim: string;
  hint?: string | undefined;
  file?: string | undefined;
  line?: number | undefined;
  /** The content key, to recognize the one that is already assigned. See `critiqueKey`. */
  key: string;
}

/** A notice under a row: the result of the last thing that was pressed there. */
type Note = { text: string; bad: boolean };

export function Critiques({
  slug,
  findings,
  queued,
  discarded = [],
  review = null,
}: {
  slug: string;
  findings: CritiqueView[];
  /** From finding key to the live assignment that came from it. See `assignedCritiques`. */
  queued: Record<string, string>;
  /**
   * The keys that you already said no to. See `discardedCritiques`.
   *
   * Without this, the 'discarded' only lived in the client's state and was forgotten upon reload:
   * the person's no disappeared from the screen, which is exactly what the discard came to
   * prevent.
   */
  discarded?: string[];
  /**
   * The last review, if there was one: how many files were looked at and if it fell short.
   *
   * Without this, 'there are no findings' and 'it has not been checked' were rendered the same way
   * —the entire block disappeared— and they are two different pieces of news: one says that the
   * file is clean and the other that nothing is known here. The terminal already distinguished
   * them; the record did not.
   */
  review?: { sourcesRead: number; truncated: boolean } | null;
}) {
  const t = useT();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tasks, setTasks] = useState<Record<string, string>>(queued);
  const [dead, setDead] = useState<ReadonlySet<string>>(() => new Set(discarded));
  /*
    And the two look at each other again when the waiter brings something else.
    It is the same case as in `Assignments`, and that is why it is here: the initializers of
    `useState` run once at mount, and this component does not unmount —the tab menu hides the
    views with CSS, it does not remove them—. So a task that an agent closed, or a discard made
    from the look screen, did not reach until manually reloading.
    It is compared by content and not by identity: the props arrive new on each server render, and
    with identity this would be a loop.
   */
  const encargados = JSON.stringify(Object.entries(queued).sort());
  const descartados = JSON.stringify([...discarded].sort());
  useEffect(() => {
    setTasks(Object.fromEntries(JSON.parse(encargados) as [string, string][]));
  }, [encargados]);
  useEffect(() => {
    setDead(new Set(JSON.parse(descartados) as string[]));
  }, [descartados]);
  const [busy, setBusy] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, Note>>({});
  const [open, setOpen] = useState(false);

  if (findings.length === 0) {
    return (
      <p className="mt-4 font-mono text-[11px] leading-relaxed text-faint">
        {review === null
          ? t("critique.never")
          : `${t("critique.clean", { n: review.sourcesRead })}${
              review.truncated ? ` ${t("critique.partial")}` : ""
            }`}
      </p>
    );
  }

  function note(index: number, value: Note) {
    setNotes((before) => ({ ...before, [index]: value }));
  }

  async function decide(finding: CritiqueView, decision: "queue" | "discard") {
    if (busy !== null) return;
    setBusy(finding.index);
    try {
      const response = await fetch("/api/twin/critique", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /*
          The position says which one, and the content key says which one the screen thought it
          was: between rendering the list and clicking, the watcher may have redone the review.
         */
        body: JSON.stringify({ slug, finding: finding.index, key: finding.key, decision }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };

      if (!response.ok) {
        /*
          A 409 with an id is not a failure: it means it was already assigned, and it brings the
          one that existed.
          One without an ID is indeed one, and since the content witness exists there is one:
          'this review is no longer the one you are seeing.' Looking only at the code rendered it
          in gray, like good news, just when what is needed is for it to be noticed and refreshed.
         */
        if (payload.id) setTasks((before) => ({ ...before, [finding.key]: payload.id! }));
        note(finding.index, {
          text: payload.error ?? String(response.status),
          bad: !(response.status === 409 && payload.id !== undefined),
        });
        return;
      }

      if (decision === "discard") {
        setDead((before) => new Set(before).add(finding.key));
        setTasks((before) => {
          const next = { ...before };
          delete next[finding.key];
          return next;
        });
        note(finding.index, { text: t("critique.dismissed"), bad: false });
      } else {
        if (payload.id) setTasks((before) => ({ ...before, [finding.key]: payload.id! }));
        setDead((before) => {
          const next = new Set(before);
          next.delete(finding.key);
          return next;
        });
        note(finding.index, { text: t("critique.queued"), bad: false });
      }
      // The task log of the record shows the new one without reloading manually.
      startTransition(() => router.refresh());
    } catch {
      note(finding.index, { text: t("task.unreachable"), bad: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-edge bg-surface px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((before) => !before)}
        className="font-mono text-xs text-smoke transition-colors hover:text-chalk"
      >
        {/*
           Entry folding. Twenty open findings would push the entire token down, and what most
           visitors want is the order of all together, which is just above.
          */}
        {open
          ? t("critique.hide")
          : findings.length === 1
            ? t("critique.showOne")
            : t("critique.showMany", { findings: findings.length })}
      </button>

      {open && (
        <ol className="mt-3 flex flex-col gap-3">
          {findings.map((finding) => {
            const taskId = tasks[finding.key];
            const no = dead.has(finding.key);
            const note = notes[finding.index];
            return (
              <li key={finding.key} className="flex flex-col gap-1">
                <p className="max-w-2xl text-sm leading-relaxed">
                  {finding.claim}
                  {finding.hint ? <span className="text-smoke"> · {finding.hint}</span> : null}
                </p>
                {finding.file && (
                  <p className="max-w-2xl font-mono text-xs text-faint">
                    {finding.file}
                    {finding.line ? `:${finding.line}` : ""}
                  </p>
                )}

                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <ActionButton
                    tone="plain"
                    type="button"
                    onClick={() => void decide(finding, "queue")}
                    disabled={busy !== null || taskId !== undefined}
                  >
                    {taskId !== undefined ? t("look.assigned") : t("look.assignButton")}
                  </ActionButton>
                  {!no && (
                    <button
                      type="button"
                      onClick={() => void decide(finding, "discard")}
                      disabled={busy !== null}
                      className="rounded border border-edge px-2.5 py-1 font-mono text-xs text-faint transition-colors hover:border-chalk hover:text-smoke disabled:opacity-50"
                    >
                      {t("look.dismissButton")}
                    </button>
                  )}
                  {no && <span className="font-mono text-xs text-faint">{t("look.dismissed")}</span>}
                </div>

                {note && (
                  <p
                    className={`max-w-2xl font-mono text-xs ${note.bad ? "text-fail" : "text-smoke"}`}
                  >
                    {note.text}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
