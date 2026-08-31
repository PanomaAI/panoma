"use client";

import { useState } from "react";
import { useT } from "./i18n-provider";
import { MdRepair } from "./md-repair";
import { ActionError } from "./primitives";

/*
  The review of an inherited .md, within the file.
  Previously this line delivered a bare terminal command, and a bare command is not understood
  ('what is this for?'). Since the review is read-only, the website can do it itself: the button
  says what it is going to do, and the lies appear right here, looking the same as those in the
  own file.
 */

interface Finding {
  kind: "missing-path" | "missing-script" | "wrong-version" | "missing-env" | "broken-block";
  line: number;
  claim: string;
  hint?: string;
}

export function MdInspect({ slug, path }: { slug: string; path: string }) {
  const translate = useT();
  const [state, setState] = useState<"ready" | "working" | "done">("ready");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function inspect() {
    setState("working");
    setError(null);
    try {
      const response = await fetch("/api/md/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, path }),
      });
      const payload = (await response.json()) as {
        findings?: Finding[];
        truncated?: boolean;
        error?: string;
      };
      if (response.ok && payload.findings) {
        setFindings(payload.findings);
        setTruncated(payload.truncated ?? false);
        setState("done");
      } else {
        setError(payload.error ?? String(response.status));
        setState("ready");
      }
    } catch {
      setError(translate("project.unreachable"));
      setState("ready");
    }
  }

  function reason(finding: Finding): string {
    if (finding.kind === "broken-block") return translate("project.mdBlockBroken");
    if (finding.kind === "wrong-version") {
      return translate("project.mdVersionWrong", { v: finding.hint ?? "?" });
    }
    if (finding.kind === "missing-env") {
      return finding.hint
        ? translate("project.mdEnvNear", { names: finding.hint })
        : translate("project.mdEnvMissing");
    }
    if (finding.kind === "missing-path") {
      return finding.hint
        ? translate("project.mdPathMovedTo", { path: finding.hint })
        : translate("project.mdPathMissing");
    }
    return finding.hint
      ? translate("project.mdScriptNear", { names: finding.hint })
      : translate("project.mdScriptMissing");
  }

  if (state !== "done") {
    return (
      <span className="project-md-inspect">
        <button
          type="button"
          onClick={inspect}
          disabled={state === "working"}
          className="inline-flex items-center rounded border border-edge px-2 py-0.5 font-mono text-[11px] text-smoke transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {translate(state === "working" ? "project.mdInspectWorking" : "project.mdInspectButton")}
        </button>
        {error && <ActionError as="span" text={error} className="ml-2" />}
      </span>
    );
  }

  return (
    <div className="project-md-inspect-result">
      {findings.length === 0 ? (
        <p className="project-md-clean">{translate("project.mdClean")}</p>
      ) : (
        <>
          <p className="project-md-count">
            {findings.length === 1
              ? translate("project.mdFindingOne")
              : translate("project.mdFindings", { n: findings.length })}
          </p>
          <ul className="project-md-findings">
            {findings.map((finding) => (
              <li key={`${finding.line}:${finding.claim}`}>
                <span className="project-md-line">
                  {translate("project.mdLine", { n: finding.line })}
                </span>
                <code>{finding.claim}</code>
                <span className="project-md-reason">{reason(finding)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {(() => {
        const fixable = findings.filter(
          (f) =>
            f.hint &&
            (f.kind === "missing-path" ||
              f.kind === "wrong-version" ||
              (f.kind === "missing-script" && !f.hint.includes(","))),
        ).length;
        return fixable > 0 ? (
          <div className="project-md-actions">
            {/*
               After repairing, the review is repeated on site: the new numbers are the proof of
               what has been fixed and what is still waiting for a hand.
              */}
            <MdRepair slug={slug} path={path} fixable={fixable} onDone={inspect} />
          </div>
        ) : null;
      })()}
      {truncated && <p className="project-md-hint">{translate("project.mdTruncated")}</p>}
    </div>
  );
}
