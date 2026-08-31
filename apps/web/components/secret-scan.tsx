"use client";

import Link from "next/link";
import { useState } from "react";
import type { SecretFinding } from "@panoma/core";
import { useT } from "./i18n-provider";
import { Rich } from "./rich-text";
import type { MessageKey } from "@/lib/i18n";
import { ActionButton, ActionError } from "./primitives";

type Result = {
  id: string;
  name: string;
  slug: string;
  root: string;
  findings: SecretFinding[];
};

type Payload = {
  scanned: number;
  skipped: number;
  ignoredPublic: number;
  total: number;
  results: Result[];
};

/*
  The label of the finding, here and not on the engine.
  `secrets.ts` composed the phrase "file .env followed by git," and composing prose is the work of
  those who render: the same finding is shown on this page in Spanish and the CLI in the language
  requested. The engine gives the `ruleId`, which is the only thing that doesn't change.
 */
const FILE_RULES = new Set(["env-file", "key-file", "google-service-account", "ssh-private-key"]);

const TONE: Record<SecretFinding["severity"], string> = {
  critical: "text-fail border-fail/40 bg-fail/8",
  high: "text-[#b45309] border-idle/40 bg-idle/[0.08]",
  medium: "text-smoke border-edge bg-raised",
};

/**
 * Portfolio credentials review.
 *
 * The result lives in memory and is not saved: storing exactly where someone's leaked keys are
 * creates a second place from which they can be leaked. And the values are shown trimmed for the
 * same reason — the prefix is enough to find the key and know which provider it belongs to.
 */
export function SecretScan() {
  const t = useT();

  /*
    The name of the finding and its reason, by identifier.
    `packages/core/src/secrets.ts` brings the two texts in Spanish, along with the pattern that
    finds them: it is prose from the repository and it is fine there. What was wrong was
    displaying it raw — a card in English showed «Secret Stripe key in production» and composed
    «.env file tracked by git», half and half, which reads as a program error.
    It is the same mechanism that the terminal already used, with the same backup: if a new rule
    appears in `core` before its key here, the text from `core` is shown instead of a blank.
    `secrets-i18n.test.ts` ensures that this backup is never needed.
   */
  const labelFor = (finding: SecretFinding) =>
    t(`secret.${finding.ruleId}` as MessageKey) ?? finding.label;
  /* The four of the file share a reason: what is committed is not deleted from the history. */
  const whyFor = (finding: SecretFinding) =>
    t(`secretWhy.${FILE_RULES.has(finding.ruleId) ? "file" : finding.ruleId}` as MessageKey) ??
    finding.why;
  const [state, setState] = useState<"ready" | "searching">("ready");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    setState("searching");
    setError(null);
    try {
      const response = await fetch("/api/secrets", { method: "POST" });
      const body = await response.json();
      if (response.ok) setPayload(body as Payload);
      else setError((body as { error?: string }).error ?? t("scan.failed"));
    } catch {
      setError(t("scan.unreachable"));
    } finally {
      setState("ready");
    }
  }

  return (
    <div>
      <ActionButton
        tone="surface"
        type="button"
        onClick={scan}
        busy={state === "searching"}
        busyLabel={t("scan.busy")}
      >
        {payload ? t("scan.again") : t("scan.start")}
      </ActionButton>

      {error && <ActionError text={error} className="mt-2" />}

      {payload && (
        <>
          <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-faint">
            <span className={payload.total > 0 ? "text-fail" : "text-live"}>
              {t(payload.total === 1 ? "scan.findingOne" : "scan.findingMany", {
                n: payload.total,
              })}{" "}
              {t(
                payload.results.length === 1 ? "search.inProjectOne" : "search.inProjectMany",
                { n: payload.results.length },
              )}
            </span>
            <span>{t("scan.reposScanned", { n: payload.scanned })}</span>
            {payload.skipped > 0 && <span>{t("scan.skipped", { n: payload.skipped })}</span>}
            {payload.ignoredPublic > 0 && (
              <span title={t("scan.publicTitle")}>
                {t("scan.public", { n: payload.ignoredPublic })}
              </span>
            )}
          </p>

          {payload.results.length === 0 ? (
            <p className="mt-4 rounded border border-edge bg-surface p-5 text-sm text-smoke">
              {t("scan.clean")}
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {payload.results.map((result) => (
                <li key={result.id} className="rounded-lg border border-edge bg-surface">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-edge px-4 py-2.5">
                    <Link href={`/p/${result.slug}`} className="text-sm font-medium hover:text-accent">
                      {result.name}
                    </Link>
                    <span className="font-mono text-[11px] text-faint" title={result.root}>
                      {shorten(result.root)}
                    </span>
                    <span className="ml-auto font-mono text-[11px] text-faint">
                      {result.findings.length}
                    </span>
                  </div>
                  <ul className="divide-y divide-edge/50">
                    {result.findings.map((finding, index) => (
                      <li key={`${finding.file}:${finding.line}:${index}`} className="px-4 py-2">
                        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                          <span
                            className={`rounded border px-1.5 font-mono text-[10px] ${TONE[finding.severity]}`}
                            title={finding.severity}
                          >
                            {t(`severity.${finding.severity}` as MessageKey)}
                          </span>
                          <span className="text-xs text-chalk">
                            {FILE_RULES.has(finding.ruleId)
                              ? t("scan.trackedByGit", { label: labelFor(finding) })
                              : labelFor(finding)}
                          </span>
                          <span className="font-mono text-[10px] text-faint">
                            {finding.file}
                            {finding.line > 0 && `:${finding.line}`}
                          </span>
                        </div>
                        {finding.line > 0 && (
                          <code className="mt-1 block truncate font-mono text-[10px] text-smoke">
                            {finding.excerpt}
                          </code>
                        )}
                        <p className="mt-0.5 text-[11px] leading-relaxed text-faint">
                          {whyFor(finding)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 rounded border border-edge bg-surface p-4 text-xs leading-relaxed text-smoke">
            <p className="font-medium text-chalk">{t("scan.orderTitle")}</p>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-faint">
              <li>
                <Rich
                  text={t("scan.step1")}
                  slots={{ act: <span className="text-smoke">{t("scan.step1Act")}</span> }}
                />
              </li>
              <li>
                <span className="text-smoke">{t("scan.step2")}</span>
              </li>
              <li>
                <Rich
                  text={t("scan.step3")}
                  slots={{ act: <span className="text-smoke">{t("scan.step3Act")}</span> }}
                />
              </li>
            </ol>
            <p className="mt-3 font-mono text-[10px]">{t("scan.notStored")}</p>
          </div>
        </>
      )}
    </div>
  );
}

function shorten(root: string): string {
  const parts = root.split("/");
  return parts.length <= 3 ? root : `…/${parts.slice(-2).join("/")}`;
}
