"use client";

import { useState } from "react";
import type { AssetReport } from "@panoma/core";
import { useT } from "./i18n-provider";
import { formatBytes } from "@/lib/format-bytes";
import { ActionButton, ActionError } from "./primitives";

/**
 * Resources that no code file mentions.
 *
 * The word that **does not** appear here is 'delete'. This indicates an absence—the file name is
 * not written anywhere—and that absence is a strong clue, not proof: an asset can be loaded with a
 * composite path at runtime. That is why each result states what was checked, and the folders
 * where the code constructs paths are listed as territory in which nothing can be stated.
 */
export function UnusedAssets({ projectId }: { projectId: string }) {
  const translate = useT();
  const [state, setState] = useState<"ready" | "searching">("ready");
  const [report, setReport] = useState<AssetReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setState("searching");
    setError(null);
    try {
      const response = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: projectId }),
      });
      const payload = await response.json();
      if (response.ok) setReport(payload as AssetReport);
      // If the API gave a reason, that one; if not, ours. The API responds in Spanish on purpose
      // and its text is shown just as it is, without going through the dictionary.
      else setError((payload as { error?: string }).error ?? translate("project.assetsFailed"));
    } catch {
      setError(translate("project.unreachable"));
    } finally {
      setState("ready");
    }
  }

  if (!report) {
    return (
      <div>
        <ActionButton
          tone="surface"
          type="button"
          onClick={search}
          busy={state === "searching"}
          busyLabel={translate("project.assetsReading")}
        >
          {translate("project.assetsSearch")}
        </ActionButton>
        {error && <ActionError text={error} className="mt-2" />}
        <p className="mt-2 font-mono text-[11px] text-faint">{translate("project.assetsSlow")}</p>
      </div>
    );
  }

  return (
    <div>
      <p className="font-mono text-[11px] text-faint">
        {translate("project.assetsStats", {
          n: report.analyzed,
          platform: report.skippedPlatform,
          sources: report.sourcesRead,
        })}
      </p>

      {report.unused.length === 0 ? (
        <p className="mt-3 rounded border border-edge bg-surface p-4 text-sm text-smoke">
          {translate("project.assetsAllUsed")}
        </p>
      ) : (
        <>
          <p className="mt-3 font-display text-2xl font-semibold">
            {translate("project.assetsUnused", { n: report.unused.length })}{" "}
            <span className="font-mono text-sm font-normal text-faint">
              {formatBytes(report.unusedBytes)}
            </span>
          </p>
          <ul className="mt-3 space-y-0.5">
            {report.unused.map((asset) => (
              <li
                key={asset.path}
                className="flex items-baseline justify-between gap-3 border-b border-edge/50 py-1.5 font-mono text-xs"
              >
                {/*
                   `reason` is drafted by the engine and comes out exactly like this: it is what
                   was verified, not one of our labels. See `packages/core/src/assets.ts`.
                  */}
                <span className="truncate text-smoke" title={asset.reason}>
                  {asset.path}
                </span>
                <span className="shrink-0 text-faint">{formatBytes(asset.bytes)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {report.dynamicDirs.length > 0 && (
        <p className="mt-4 rounded border border-edge bg-surface p-3 font-mono text-[11px] text-smoke">
          {translate("project.assetsDynamic", { dirs: report.dynamicDirs.join(", ") })}
        </p>
      )}

      <p className="mt-3 font-mono text-[11px] text-faint">{translate("project.assetsCaveat")}</p>
    </div>
  );
}

