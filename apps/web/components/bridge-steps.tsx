"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCliName, useT } from "./i18n-provider";
import type { MessageKey } from "@/lib/i18n";
import type { BridgeReport, BridgeStep } from "@/lib/bridge";

/**
 * The steps of the bridge, rendered: a single 'next' marked and the rest in their place.
 *
 * The product decision lives in `lib/bridge.ts` (`bridgeSteps`); here it is only rendered and
 * copied — with one exception requested by the owner: the hook step has a real button, because
 * 'copy this and run it in every project' was exactly guessing that the bridge exists to kill. The
 * button does not execute commands: it calls `/api/hooks`
 * (sameOrigin, local catalog only), which writes the same two files as `Panoma
 * hooks --install` with the shared logic of @panoma/core — and the command sits next to it, as a
 * terminal alternative.
 */

export function BridgeSteps({ report, steps }: { report: BridgeReport; steps: BridgeStep[] }) {
  const t = useT();
  const cli = useCliName();
  const router = useRouter();
  const [copied, setCopied] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function installHooks() {
    if (installing) return;
    setInstalling(true);
    setOutcome(null);
    try {
      const response = await fetch("/api/hooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        installed?: number;
        noRepo?: number;
        foreign?: number;
        failed?: number;
      };
      if (response.ok) {
        setOutcome(
          t("bridge.hooksDone", {
            installed: String(result.installed ?? 0),
            noRepo: String(result.noRepo ?? 0),
            foreign: String(result.foreign ?? 0),
            failed: String(result.failed ?? 0),
          }),
        );
        startTransition(() => router.refresh());
      } else {
        setOutcome(result.error ?? t("bridge.hooksNoCli"));
      }
    } catch {
      setOutcome(t("bridge.hooksNoCli"));
    } finally {
      setInstalling(false);
    }
  }

  async function copy(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(command);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // Without clipboard permission the text is still there to be selected: it is not an error.
    }
  }

  function mark(state: BridgeStep["state"]): string {
    if (state === "done") return "✓";
    if (state === "next") return "→";
    return "·";
  }

  function tone(state: BridgeStep["state"]): string {
    if (state === "done") return "text-accent";
    if (state === "next") return "text-chalk";
    return "text-faint";
  }

  /*
     These three are made to be copied into a terminal with the button beside them, so the name in
     front of them has to be the one the reader has. This map held both wrong answers at once: an
     `npx panoma` written into the first line and a bare `panoma` in the other two, so whichever of
     the two kinds of install was reading it got one working command and two that fail. The name
     comes down from the layout now — see `lib/cli-name.ts`.
    */
  const commands: Partial<Record<BridgeStep["id"], string>> = {
    catalog: `${cli} up ~/Desktop`,
    agent: `${cli} agent-key "Claude Code" --install`,
    hooks: `${cli} hooks --install`,
  };

  const links: Partial<Record<BridgeStep["id"], string>> = {
    model: "/ai",
    agent: "/agents",
  };

  return (
    <ol className="mt-6 space-y-4">
      {steps.map((step) => (
        <li key={step.id} className="flex gap-3 rounded-lg border border-edge bg-surface p-4">
          <span className={`font-mono text-sm ${tone(step.state)}`} aria-hidden>
            {mark(step.state)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className={`text-sm font-semibold ${tone(step.state)}`}>
                {t(`bridge.step.${step.id}.title` as MessageKey)}
              </h3>
              <span className="font-mono text-[10px] text-faint">
                {t(`bridge.step.${step.id}.detail` as MessageKey, {
                  count: String(step.detail.count),
                  total: String(step.detail.total ?? ""),
                })}
              </span>
            </div>

            {/*
               Against `installable` and not `checked`. With 44 of 76 projects carrying git and the
               hook in all 44, this button stayed on offer for ever and pressing it did nothing:
               the 32 that were missing have nowhere to keep one.
              */}
            {step.id === "hooks" && report.hooks.installed < report.hooks.installable && (
              <div className="mt-1.5 space-y-2">
                <button
                  type="button"
                  onClick={() => void installHooks()}
                  disabled={installing}
                  className="rounded border border-accent px-3 py-1.5 text-xs font-semibold text-accent hover:bg-raised disabled:opacity-60"
                >
                  {installing ? t("bridge.step.hooks.installing") : t("bridge.step.hooks.install")}
                </button>
                {outcome && <p className="text-[11px] leading-relaxed text-smoke">{outcome}</p>}
              </div>
            )}

            {step.state !== "done" && (
              <div className="mt-1.5 space-y-2">
                <p className="text-xs leading-relaxed text-smoke">
                  {t(
                    step.id === "agent" && report.agents.keys > 0
                      ? "bridge.step.agent.keyUnused"
                      : (`bridge.step.${step.id}.pending` as MessageKey),
                    /*
                       The journal names the tool that fills it. It is one MCP tool among nine and
                       the only one that matters to whoever is reading this line, so it travels
                       written rather than described: it is what they will type when they ask their
                       agent for it.
                      */
                    { tool: "panoma_log" },
                  )}
                </p>
                {step.state === "next" && commands[step.id] && (
                  <div className="flex flex-wrap items-center gap-2">
                    {step.id === "hooks" && (
                      <span className="text-[11px] text-faint">{t("bridge.hooksAlt")}</span>
                    )}
                    <code className="rounded border border-edge bg-raised px-2 py-1 font-mono text-[11px] text-chalk">
                      {commands[step.id]}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copy(commands[step.id] ?? "")}
                      className="rounded border border-edge px-2 py-1 text-[11px] text-smoke hover:text-chalk"
                    >
                      {copied === commands[step.id] ? t("bridge.copied") : t("bridge.copy")}
                    </button>
                  </div>
                )}
                {step.state === "next" && links[step.id] && (
                  <Link href={links[step.id] ?? "/"} className="inline-block text-xs text-accent underline-offset-2 hover:underline">
                    {t(`bridge.step.${step.id}.go` as MessageKey)}
                  </Link>
                )}
                {step.state === "next" && (step.id === "agent" || step.id === "hooks") && (
                  <p className="text-[11px] leading-relaxed text-faint">{t("bridge.restartHint")}</p>
                )}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
