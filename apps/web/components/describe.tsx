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
  const [error, setError] = useState<string | null>(null);

  async function describe() {
    setState("writing");
    setError(null);
    try {
      const response = await fetch("/api/describe", {
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
              onClick={describe}
              disabled={state === "writing"}
              className="project-describe__rewrite ml-auto disabled:opacity-50"
            >
              {translate(state === "writing" ? "project.aiWriting" : "project.aiRewrite")}
            </button>
          </p>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={describe}
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
