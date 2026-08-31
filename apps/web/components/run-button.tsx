"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./i18n-provider";
import { readRunResponse, type RunResponse, type RunTone } from "./run-result";

/**
 * Trigger an update proposal.
 *
 * The button text says "propose," not "update," because that is literally what happens: a change
 * is prepared in isolation and awaits review. A button that said "update" would promise something
 * that this system deliberately does not do. In English it says "propose" for the same reason: the
 * promise of the button is the same in both languages.
 *
 * With `security` no package is chosen: the server looks at the open notices and attacks the most
 * serious one according to the published schedule — the same decision that `panoma run --security`
 * makes. The choice lives there and not here so that the button and CLI cannot disagree on what is
 * "the most serious".
 */
type RunButtonProps = { slug: string } & (
  | { packageName: string; targetVersion: string; security?: undefined }
  | { security: true; packageName?: undefined; targetVersion?: undefined }
);

/** The four tones of the CLI, in classes. The reason for each one is in `run-result.ts`. */
const TONES: Record<RunTone, string> = {
  ok: "text-live",
  quiet: "text-faint",
  warn: "text-idle",
  bad: "text-fail",
};

export function RunButton(props: RunButtonProps) {
  const translate = useT();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  /*
    The color says the same thing as the text, and it is necessary for it to say it.
    Everything the server answered was rendered the same shade of gray, so a failure counted as a
    happy ending even if the text was not. The amber of the known failure is the same yellow that
    the CLI uses for that same response: the same event, the same color, no matter how you look at
    it.
   */
  const [tone, setTone] = useState<RunTone>("quiet");
  /*
    The retry appears only when the server has said that there is something to force.
    It is not a permanent button: it appears next to the 'already tried and failed' and disappears
    as soon as it is pressed or as soon as the next response no longer allows it. Who can force
    themselves and who cannot is decided by `readRunResponse`, and why quarantine is not among
    them is explained there.
   */
  const [forceable, setForceable] = useState(false);
  const [running, setRunning] = useState(false);
  const router = useRouter();

  async function dispatch(force = false) {
    setRunning(true);
    setMessage(null);
    setForceable(false);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: props.slug,
          ...(props.security
            ? { security: true }
            : { packageName: props.packageName, targetVersion: props.targetVersion }),
          // Only when the retry has been pressed. Sending it always would turn this button into one
          // that skips the checks without anyone having requested it.
          ...(force ? { force: true } : {}),
        }),
      });
      /*
        The texts are written by API in the language of the person asking; the ones here are only
        the reserve ones and the label of the known ruling. The form of the answer is decided by
        `readRunResponse`, who lives separately in order to be tested — this button said "Done."
        for months over relaunches that the server had rejected.
       */
      const body = (await response.json().catch(() => null)) as RunResponse | null;
      const outcome = readRunResponse(response, body);

      setTone(outcome.tone);

      if (outcome.kind === "known-failure") {
        setForceable(outcome.forceable);
        setMessage(
          [translate("project.alreadyFailed"), outcome.summary, outcome.hint]
            .filter(Boolean)
            .join(" "),
        );
      } else if (outcome.kind === "error") {
        setMessage(
          [
            outcome.text ?? translate("project.proposeRefused", { status: outcome.status }),
            outcome.hint,
          ]
            .filter(Boolean)
            .join(" "),
        );
      } else if (outcome.kind === "unknown") {
        setMessage(translate("project.proposeUnreadable", { status: outcome.status }));
      } else {
        setMessage(outcome.text ?? translate("project.proposeDone"));
      }

      // An already known failure didn't change anything on the server —that's what it's about: not
      // repeating the work— so refreshing the record is asking the database to confirm that
      // everything remains the same. The rest does leave a trace, even when it crashes.
      if (outcome.kind !== "known-failure") startTransition(() => router.refresh());
    } catch {
      setTone("bad");
      setMessage(translate("project.runUnreachable"));
    } finally {
      setRunning(false);
    }
  }

  const busy = running || pending;

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        // Wrapped and not `onClick={dispatch}`: React would pass the mouse event as the first
        // argument, and a `MouseEvent` is true, so this button would send `force: true` in every
        // single proposal. The typecheck caught it.
        onClick={() => void dispatch()}
        disabled={busy}
        className="rounded border border-edge bg-raised px-2 py-0.5 font-mono text-[10px] text-smoke transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
      >
        {translate(busy ? "project.proposing" : "project.propose")}
      </button>
      {forceable && !busy && (
        <button
          type="button"
          onClick={() => void dispatch(true)}
          className="rounded border border-idle/40 bg-raised px-2 py-0.5 font-mono text-[10px] text-idle transition-colors hover:border-idle hover:text-accent"
        >
          {translate("project.tryAnyway")}
        </button>
      )}
      {message && (
        <span
          role="status"
          className={`font-mono text-[10px] ${TONES[tone]}`}
        >
          {message}
        </span>
      )}
    </span>
  );
}
