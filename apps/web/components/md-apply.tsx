"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/api";
import { useT } from "./i18n-provider";
import { ActionError } from "./primitives";

/**
 * The button that does, and then counts what happened and what to expect.
 *
 * The .md section said a lot and offered no gesture: it diagnosed and that was it. This button
 * creates the AGENTS.md (or regenerates its block) with one click — the click is the consent — and
 * when finished it says in one sentence what was written and what will happen from now on, which
 * is the half that is always missing.
 */
export function MdApply({
  slug,
  action,
  label,
}: {
  slug: string;
  action: "init" | "sync";
  /** What the button promises: create the file, add the block, or regenerate it. */
  label: string;
}) {
  const translate = useT();
  const router = useRouter();
  const [state, setState] = useState<"ready" | "working">("ready");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setState("working");
    setError(null);
    setMessage(null);
    const result = await postJson<{
      file?: string;
      created?: boolean;
      changed?: boolean;
      bridged?: boolean;
    }>(
      "/api/md/apply",
      { slug, action },
      translate("project.unreachable"),
    );
    if (result.ok) {
      const file = result.data.file ?? "AGENTS.md";
      const base = result.data.created
        ? translate("project.mdInitDone", { file })
        : result.data.changed
          ? action === "init"
            ? translate("project.mdBlockAdded", { file })
            : translate("project.mdSyncDone", { file })
          : translate("project.mdSyncSame");
      /*
        The bridge is counted separately: it is another file, and half the fun is that the user
        knows it now exists and why.
       */
      setMessage(
        result.data.bridged ? `${base} ${translate("project.mdBridgeWritten")}` : base,
      );
      // The record is repainted with the file already inside (the re-analysis ran on the server
      // before responding) — but first the phrase about what happened and what to expect is left to
      // be read, which is the half that is always missing.
      setTimeout(() => router.refresh(), 2200);
    } else {
      setError(result.message);
    }
    setState("ready");
  }

  return (
    <div className="project-md-apply">
      <button
        type="button"
        onClick={apply}
        disabled={state === "working"}
        className="inline-flex items-center gap-2 rounded border border-accent bg-accent px-3 py-1.5 font-mono text-xs text-white transition-opacity hover:opacity-85 disabled:opacity-50"
      >
        {state === "working" ? translate("project.mdApplyWorking") : label}
      </button>
      {message && <p className="mt-2 text-xs leading-relaxed text-live">{message}</p>}
      {error && <ActionError text={error} className="mt-2" />}
    </div>
  );
}
