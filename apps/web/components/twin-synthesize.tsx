"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./i18n-provider";

/*
  The button that writes the portrait.
  It replaces the one of 'unifying what repeats,' which suggested fusions and expected a yes for
  each one. Here there is nothing to approve: the synthesis reads all the evidence of each subject
  and leaves written the beliefs of that subject. What comes out is the portrait, not a tail.
  ── Two calls and a single button ─────────────────────────────────────────────────
  Before synthesizing, you need to distribute by subjects what doesn't have it, because the
  synthesis runs by topic and a subject `other` with six hundred phrases inside returns
  generalities. There are two routes because they are two different tasks — classifying is cheap
  and synthesizing is not —, and it is one button because for the person who presses it it is a
  single gesture: 'catch up'.
  Classify first and synthesize later, in series and not at the same time: the second depends on
  what the first writes. If the first fails, the second does not run — synthesizing on a partial
  distribution would write the portrait of the drawer.
 */

export function TwinSynthesize({ pending, compact }: { pending: number; compact?: boolean }) {
  const translate = useT();
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setNote(null);

    try {
      if (pending > 0) {
        const sorted = await fetch("/api/twin/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const outcome = (await sorted.json()) as { error?: string };
        if (!sorted.ok) {
          setNote(outcome.error ?? translate("twin.synthFailed"));
          return;
        }
      }

      const response = await fetch("/api/twin/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as {
        error?: string;
        topics?: number;
        /** Subjects that were not called due to lack of new evidence. See the route. */
        unchanged?: number;
        created?: number;
        refined?: number;
        retired?: number;
        proposed?: number;
      };

      if (!response.ok) {
        setNote(payload.error ?? translate("twin.synthFailed"));
        return;
      }

      /*
        The receipt says what was moved, and when nothing was moved it says so as well. A button
        that answers with silence is pressed again; one that says 'nothing has changed' has
        already answered — and with a stable portrait that is the correct answer, not a failure.
       */
      const created = payload.created ?? 0;
      const refined = payload.refined ?? 0;
      const retired = payload.retired ?? 0;
      const proposed = payload.proposed ?? 0;
      const moved = created + refined + retired + proposed;

      /*
        And the questions are said separately, because they are the only thing that expects
        something from the person. Without this, a pass that only left a proposal against
        something signed showed «new: 0 · refined: 0 · withdrawn: 0» — three zeros over a pass
        that had indeed done something, and the only move didn't show up anywhere.
       */
      /*
        And the three silences, which are not the same. The route already distinguishes them and
        the terminal already counts them; here they collapsed into 'the evidence says the same,'
        which over an empty catalog is false—there is no evidence—and over a current portrait is a
        response about a call that wasn’t made. Without evidence, the way out is to read the
        history; for the current day, there is no way out, and saying it is the answer.
       */
      const unchanged = payload.unchanged ?? 0;
      const quieto =
        payload.topics === 0
          ? unchanged > 0
            ? translate("twin.synthUpToDate")
            : translate("twin.synthNothing")
          : translate("twin.synthSame");

      const hecho = translate("twin.synthDone", { created, refined, retired });
      setNote(
        moved === 0
          ? quieto
          : proposed === 0
            ? hecho
            : `${hecho} ${translate("twin.synthAsks", { n: proposed })}`,
      );
      router.refresh();
    } catch {
      setNote(translate("project.unreachable"));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={compact ? "flex items-center gap-2" : "mt-3 flex flex-col gap-1"}>
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="self-start rounded border border-edge px-2.5 py-1 font-mono text-xs text-smoke transition-colors hover:border-chalk disabled:opacity-50"
      >
        {running ? translate("twin.synthesizing") : translate("twin.synthesize")}
      </button>
      {note ? (
        <p className="font-mono text-xs text-smoke">{note}</p>
      ) : compact ? null : (
        <p className="font-mono text-xs text-faint">{translate("twin.synthHint")}</p>
      )}
    </div>
  );
}
