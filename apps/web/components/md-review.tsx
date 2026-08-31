"use client";

import { useState } from "react";
import { HiOutlineSparkles } from "react-icons/hi2";
import { useLocale, useT } from "./i18n-provider";
import { ActionError } from "./primitives";
import { WrittenIn } from "./written-in";

/**
 * The model's opinion on the instruction file.
 *
 * The same treatment as `Describe`, because it is the same kind of thing: the only part of the
 * section that does not come from a verifiable fact. It is requested by hand, signed with the
 * model and the date, and when the file changes after the opinion, it is said — old judgment
 * presented as fresh is the kind of lie that this section exists to catch.
 */
export function MdReview({
  slug,
  initial,
  stale,
}: {
  slug: string;
  initial: { text: string; model: string | null; at: string | null; lang: string | null } | null;
  /** The file changed after the saved opinion. */
  stale: boolean;
}) {
  const translate = useT();
  const locale = useLocale();
  const [state, setState] = useState<"ready" | "writing">("ready");
  const [result, setResult] = useState(initial);
  /*
    If the opinion has just been asked for, it is fresh by definition: the term 'stale' only
    applies to what had been kept.
   */
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review() {
    setState("writing");
    setError(null);
    try {
      const response = await fetch("/api/md/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const payload = await response.json();
      if (response.ok) {
        setResult({
          text: (payload as { text: string }).text,
          model: (payload as { model: string }).model,
          at: new Date().toISOString(),
          /* What has just been written is in the language of the person who requested it, which is this one. */
          lang: locale,
        });
        setFresh(true);
      } else {
        // What API says comes out exactly as is, and from August 25, 2026, it answers in the
        // language of the person who asks: `error` and `hint` go through `t(locale, …)` on the
        // route.
        const body = payload as { error?: string; hint?: string };
        setError([body.error, body.hint].filter(Boolean).join(" · "));
      }
    } catch {
      setError(translate("project.unreachable"));
    } finally {
      setState("ready");
    }
  }

  return (
    <div className="rounded-lg border border-edge bg-surface p-4">
      {result ? (
        <>
          {stale && !fresh && (
            <p className="mb-2 font-mono text-[11px] text-amber-600">
              {translate("project.mdReviewStale")}
            </p>
          )}
          <p className="whitespace-pre-line text-sm leading-relaxed text-chalk">{result.text}</p>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-edge pt-2.5 font-mono text-[11px] text-faint">
            <span className="inline-flex items-center gap-1.5">
              <HiOutlineSparkles className="h-3.5 w-3.5" aria-hidden />
              {translate("project.aiWrittenBy", {
                model: result.model ?? translate("project.aiSomeModel"),
              })}
            </span>
            {result.at && <span>{new Date(result.at).toLocaleDateString(locale)}</span>}
            <WrittenIn lang={result.lang} />
            <button
              type="button"
              onClick={review}
              disabled={state === "writing"}
              className="ml-auto transition-colors hover:text-accent disabled:opacity-50"
            >
              {translate(state === "writing" ? "project.mdReviewAsking" : "project.mdReviewAgain")}
            </button>
          </p>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={review}
            disabled={state === "writing"}
            className="inline-flex items-center gap-2 rounded border border-edge px-3 py-1.5 font-mono text-xs text-smoke transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            <HiOutlineSparkles className="h-4 w-4" aria-hidden />
            {translate(state === "writing" ? "project.mdReviewAsking" : "project.mdReviewAsk")}
          </button>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-faint">
            {translate("project.mdReviewNote")}{" "}
            {/* The command is typed in a terminal: it is not translated. */}
            {translate("project.aiNoteBefore")} <code>panoma ai use</code>.
          </p>
        </>
      )}
      {error && <ActionError text={error} className="mt-2" />}
    </div>
  );
}
