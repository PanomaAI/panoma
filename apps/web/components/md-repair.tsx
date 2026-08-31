"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/api";
import { useT } from "./i18n-provider";
import { ActionError } from "./primitives";

/**
 * Fix the obvious with a click and count the result in numbers: how many fixes were applied and
 * how many remain for the user's hand. The click is the consent; the findings are recalculated by
 * the server against the disk — this button sends none.
 */
export function MdRepair({
  slug,
  path,
  fixable,
  onDone,
}: {
  slug: string;
  /** Inherited path; absent for the files of the own project. */
  path?: string;
  /** How many findings have a lead: what the button promises. */
  fixable: number;
  /** So that the online review refreshes on the site instead of reloading the card. */
  onDone?: () => void;
}) {
  const translate = useT();
  const router = useRouter();
  const [state, setState] = useState<"ready" | "working">("ready");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function repair() {
    setState("working");
    setError(null);
    const result = await postJson<{ applied?: number; remaining?: number }>(
      "/api/md/repair",
      { slug, ...(path ? { path } : {}) },
      translate("project.unreachable"),
    );
    if (result.ok) {
      const applied = result.data.applied ?? 0;
      const remaining = result.data.remaining ?? 0;
      setMessage(
        remaining === 0
          ? translate("project.mdRepairDoneAll", { n: applied })
          : translate("project.mdRepairDone", { n: applied, m: remaining }),
      );
      if (onDone) setTimeout(onDone, 1800);
      else setTimeout(() => router.refresh(), 2200);
    } else {
      setError(result.message);
    }
    setState("ready");
  }

  return (
    <span className="project-md-repair">
      <button
        type="button"
        onClick={repair}
        disabled={state === "working"}
        className="inline-flex items-center rounded border border-accent bg-accent px-2.5 py-1 font-mono text-[11px] text-white transition-opacity hover:opacity-85 disabled:opacity-50"
      >
        {state === "working"
          ? translate("project.mdRepairWorking")
          : translate("project.mdRepairButton", { n: fixable })}
      </button>
      {message && <span className="ml-2 text-xs text-live">{message}</span>}
      {error && <ActionError as="span" text={error} className="ml-2" />}
    </span>
  );
}
