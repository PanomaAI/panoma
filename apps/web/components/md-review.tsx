"use client";

import { useState } from "react";
import { HiOutlineSparkles } from "react-icons/hi2";
import { useLocale, useT } from "./i18n-provider";
import { ActionButton, ActionError } from "./primitives";
import { WrittenIn } from "./written-in";

/**
 * The model's opinion on the instruction file.
 *
 * The same treatment as `Describe`, because it is the same kind of thing: the only part of the
 * section that does not come from a verifiable fact. It is requested by hand, signed with the
 * model and the date, and when the file changes after the opinion, it is said — old judgment
 * presented as fresh is the kind of lie that this section exists to catch.
 *
 * And the same two honest lines as `Describe`: `cached` when the route answered from the saved
 * opinion because the file did not change, `saved: false` when the opinion was paid for and the
 * project has no repository to keep it in. See there.
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
  const [cached, setCached] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review(force: boolean) {
    setState("writing");
    setError(null);
    try {
      const response = await fetch("/api/md/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(force ? { slug, force: true } : { slug }),
      });
      const payload = await response.json();
      if (response.ok) {
        const answer = payload as {
          text: string;
          model: string | null;
          at?: string | null;
          cached?: boolean;
          saved?: boolean;
        };
        setResult({
          text: answer.text,
          model: answer.model,
          /* A saved answer keeps its own date; a fresh one was written now. */
          at: answer.at ?? new Date().toISOString(),
          /* What has just been written is in the language of the person who requested it, which is this one. */
          lang: locale,
        });
        setFresh(true);
        setCached(answer.cached === true);
        setUnsaved(answer.saved === false);
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
          {/* Age is a caveat, not a failure: it is said in ink, not in an alarm color. */}
          {stale && !fresh && (
            <p className="mb-2 font-mono text-[11px] text-smoke">
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
            {/*
               NOT a primitive, and the reason is the paragraph around it. This button is one item
               of the signature line — model · date · language · ask again — and it carries no box
               at all: it inherits the line's `font-mono text-[11px] text-faint` and only changes
               its ink on hover. `ActionButton` would give it a border, a 30px floor and its own
               padding inside a flex row of bare words, which breaks the line it belongs to. See
               the tenth exception in `docs/`-less form: an inline control inside a sentence.
              */}
            <button
              type="button"
              onClick={() => review(true)}
              disabled={state === "writing"}
              className="ml-auto transition-colors hover:text-accent disabled:opacity-50"
            >
              {translate(state === "writing" ? "project.mdReviewAsking" : "project.mdReviewAgain")}
            </button>
          </p>
          {cached && (
            <p className="mt-1 font-mono text-[11px] leading-relaxed text-faint">
              {translate("project.mdReviewCached")}
            </p>
          )}
          {unsaved && (
            <p className="mt-1 font-mono text-[11px] leading-relaxed text-faint">
              {translate("project.aiUnsaved")}
            </p>
          )}
        </>
      ) : (
        <>
          {/*
             The word changes inside `children` and not through `busyLabel`, because `busyLabel`
             replaces everything the button holds and the icon would go with it.
            */}
          <ActionButton
            tone="surface"
            type="button"
            onClick={() => review(false)}
            busy={state === "writing"}
          >
            <HiOutlineSparkles className="h-4 w-4" aria-hidden />
            {translate(state === "writing" ? "project.mdReviewAsking" : "project.mdReviewAsk")}
          </ActionButton>
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
