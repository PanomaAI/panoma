"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HiOutlineCheckCircle, HiOutlinePlay, HiOutlineXCircle } from "react-icons/hi2";
import { useLocale, useT } from "./i18n-provider";
import { ActionError } from "./primitives";

/*
  Does this still compile? — the verdict and its button, in the Resume view.
  The health of the card deduces; this demonstrates: the server raises an ephemeral worktree,
  installs without scripts, and runs the project build with the strongest isolation on the
  machine. Here only requests and teaches are made — the path never leaves the browser, only the
  slug, and `/api/check` only responds from the machine itself (loopback): the --network mode
  allows looking at the catalog, not ordering executions.
 */

export interface BuildVerdict {
  status: "ok" | "failed" | "no-git" | "no-toolchain" | "no-build";
  at: string;
  durationMs: number;
  command?: string;
  isolation: string;
  isolationNote?: string;
  reason?: string;
  sha?: string;
  dirty?: boolean;
  summary: string;
}

export function ProjectBuildCheck({
  slug,
  initial,
}: {
  slug: string;
  initial: BuildVerdict | null;
}) {
  const translate = useT();
  const locale = useLocale();
  const router = useRouter();
  const [verdict, setVerdict] = useState<BuildVerdict | null>(initial);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        verdict?: BuildVerdict;
        error?: string;
      };
      if (response.ok && payload.ok && payload.verdict) {
        setVerdict(payload.verdict);
        router.refresh();
      } else {
        setError(payload.error ?? String(response.status));
      }
    } catch {
      setError(translate("project.unreachable"));
    } finally {
      setRunning(false);
    }
  }

  const button = (
    <button
      type="button"
      onClick={check}
      disabled={running}
      className="inline-flex items-center gap-1.5 rounded border border-edge px-2.5 py-1 font-mono text-[11px] text-smoke transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
    >
      <HiOutlinePlay className="h-3.5 w-3.5" aria-hidden />
      {translate(verdict ? "check.rerun" : "check.run")}
    </button>
  );

  if (running) {
    return (
      <div className="project-build-check">
        <p className="project-muted-message">{translate("check.running")}</p>
      </div>
    );
  }

  if (!verdict) {
    return (
      <div className="project-build-check">
        <p className="project-muted-message">{translate("check.none")}</p>
        {button}
        {error && <ActionError text={error} className="mt-2" />}
      </div>
    );
  }

  const conclusive = verdict.status === "ok" || verdict.status === "failed";
  const date = new Date(verdict.at).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const seconds = Math.max(1, Math.round(verdict.durationMs / 1000));

  return (
    <div className="project-build-check">
      <p className="flex items-center gap-1.5 text-sm">
        {verdict.status === "ok" ? (
          <HiOutlineCheckCircle className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        ) : verdict.status === "failed" ? (
          <HiOutlineXCircle className="h-4 w-4 shrink-0 text-fail" aria-hidden />
        ) : null}
        <strong>
          {translate(
            verdict.status === "ok"
              ? "check.ok"
              : verdict.status === "failed"
                ? "check.broken"
                : "check.inconclusive",
          )}
        </strong>
        {conclusive && (
          <span className="font-mono text-[11px] text-faint">
            {translate("check.checkedOn", { date, seconds: String(seconds) })}
          </span>
        )}
      </p>
      {/* The runner's summary: the honest phrase of in what conditions it was checked. */}
      <p className="mt-1 text-[13px] text-smoke">{verdict.summary}</p>
      {verdict.dirty && (
        <p className="mt-1 font-mono text-[11px] text-amber-600">{translate("check.dirty")}</p>
      )}
      {verdict.reason && (
        <pre className="project-build-check-reason">{verdict.reason}</pre>
      )}
      {verdict.isolationNote && (
        <p className="mt-1 text-[11px] text-faint">{verdict.isolationNote}</p>
      )}
      <div className="mt-2">{button}</div>
      {error && <ActionError text={error} className="mt-2" />}
    </div>
  );
}
