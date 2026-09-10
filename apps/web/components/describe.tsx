"use client";

import { useState } from "react";
import { HiOutlineSparkles } from "react-icons/hi2";
import { useLocale, useT } from "./i18n-provider";
import { ActionError } from "./primitives";
import { WrittenIn } from "./written-in";

/**
 * Ask a model to explain what the project is about.
 *
 * It is always taught with the model's signature and the date at the front, and separated from the
 * rest of the card. In a tool whose promise is 'what is asserted can be verified,' a generated
 * paragraph has to be seen for what it is: the only part that does not come from a fact.
 *
 * Two facts about the money travel with the answer and are said out loud. `cached` means the
 * route answered from the saved paragraph because nothing changed — nothing was paid — and the
 * button that asks again says it asks even then, so nobody presses it expecting a free refresh.
 * `saved: false` means the paragraph was paid for and has nowhere to live: a project with no
 * repository has no stable identity to hang it from, and tomorrow the card would offer the button
 * again as if it had never been pressed. Saying so is the honest half of that gap.
 */
export function Describe({
  slug,
  initial,
}: {
  slug: string;
  initial: { text: string; model: string | null; at: string | null; lang: string | null } | null;
}) {
  const translate = useT();
  const locale = useLocale();
  const [state, setState] = useState<"ready" | "writing">("ready");
  const [result, setResult] = useState(initial);
  const [cached, setCached] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function describe(force: boolean) {
    setState("writing");
    setError(null);
    try {
      const response = await fetch("/api/describe", {
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
        setCached(answer.cached === true);
        setUnsaved(answer.saved === false);
      } else {
        // What the API says comes out just as it is: it responds entirely in Spanish on purpose,
        // and rewriting its message here would be inventing an error that no one has made.
        const body = payload as { error?: string; hint?: string };
        setError([body.error, body.hint].filter(Boolean).join(" · "));
      }
    } catch {
      setError(translate("project.unreachable"));
    } finally {
      setState("ready");
    }
  }

  /*
    Neither of the two buttons below is a primitive, and the class names say why: they are dressed
    by `project-sections.css`, which gives them their border, their corner, their paper, their ink
    and their transition, and `print.css` names them again to flatten them on paper. What the
    markup adds is padding and type. Converting them means retiring those two rules in a stylesheet
    this step does not own, in the same commit — not leaving a dead selector behind in each of two
    sheets. It is the same shape as `.apps-button` in `apps.tsx`: a control the sheet owns.
   */
  return (
    <div className="project-describe">
      {result ? (
        <>
          <p className="text-sm leading-relaxed text-chalk">{result.text}</p>
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
              onClick={() => describe(true)}
              disabled={state === "writing"}
              className="project-describe__rewrite ml-auto disabled:opacity-50"
            >
              {translate(state === "writing" ? "project.aiWriting" : "project.aiRewrite")}
            </button>
          </p>
          {cached && (
            <p className="mt-1 font-mono text-[11px] leading-relaxed text-faint">
              {translate("project.aiCached")}
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
          <button
            type="button"
            onClick={() => describe(false)}
            disabled={state === "writing"}
            className="project-describe__ask inline-flex items-center gap-2 px-3 py-1.5 font-mono text-xs disabled:opacity-50"
          >
            <HiOutlineSparkles className="h-4 w-4" aria-hidden />
            {translate(state === "writing" ? "project.aiReading" : "project.aiExplain")}
          </button>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-faint">
            {/*
               `panoma ai use` is typed in a terminal, so it is not translated or put in the
               dictionary: it is the command, not a way of saying it.
              */}
            {translate("project.aiNoteBefore")} <code>panoma ai use</code>.{" "}
            {translate("project.aiNoteAfter")}
          </p>
        </>
      )}
      {error && <ActionError text={error} className="mt-2" />}
    </div>
  );
}
