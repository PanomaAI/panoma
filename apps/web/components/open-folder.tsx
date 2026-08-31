"use client";

import { useState } from "react";
import {
  HiOutlineCodeBracketSquare,
  HiOutlineCommandLine,
  HiOutlineFolder,
} from "react-icons/hi2";
import { t, type Locale, type MessageKey } from "@/lib/i18n";
import { openTarget } from "@/lib/open-target";

/* Three of the five that this button offers; the whole list lives in `lib/open-target.ts`. */
type Tool = "folder" | "editor" | "terminal";

/*
  The three words of `tool` are what the server understands and are not touched; what changes
  language is the label. The table keeps keys and not texts so that the dictionary remains the
  only place where a sentence lives.
 */
const LABELS: Record<Tool, { idle: MessageKey; busy: MessageKey; done: MessageKey }> = {
  folder: { idle: "open.folder", busy: "open.busy", done: "open.doneFolder" },
  editor: { idle: "open.editor", busy: "open.busy", done: "open.done" },
  terminal: { idle: "open.terminal", busy: "open.busy", done: "open.done" },
};

/**
 * Open the project where it is really going to be worked on.
 *
 * Send the id and one of three words, never the path or a command: the server resolves the path
 * against the catalog and the word is translated there into a binary from a closed list. And if
 * the folder no longer exists, the error is shown right here instead of failing silently — that
 * case is common, because the catalog keeps where the project was the last time it was scanned,
 * not where it is now.
 *
 * The language comes by prop with «es» by default, as in `RunStatusTag`: this button also appears
 * in «Unsaved Work», which remains entirely in Spanish, and there a label in English would be the
 * only thing translated on the page. The record, which does translate, passes its own.
 */
export function OpenFolder({
  projectId,
  path,
  tool = "folder",
  appearance = "inline",
  locale,
}: {
  projectId: string;
  path: string;
  tool?: Tool;
  appearance?: "inline" | "primary" | "secondary";
  locale: Locale;
}) {
  const [state, setState] = useState<"ready" | "opening" | "open">("ready");
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setState("opening");
    setError(null);
    const result = await openTarget({ id: projectId, tool }, t(locale, "open.unreachable"));
    if (result.ok) {
      setState("open");
      // Return to 'ready' so that it can be used again without reloading.
      setTimeout(() => setState("ready"), 2000);
    } else {
      setState("ready");
      setError(result.message);
    }
  }

  const label = LABELS[tool];
  const idle = t(locale, label.idle);
  const Icon =
    tool === "editor"
      ? HiOutlineCodeBracketSquare
      : tool === "terminal"
        ? HiOutlineCommandLine
        : HiOutlineFolder;

  return (
    <span className={`open-project-action open-project-action--${appearance}`}>
      <button
        type="button"
        onClick={open}
        disabled={state === "opening"}
        title={`${idle} · ${path}`}
      >
        <Icon aria-hidden />
        {state === "opening"
          ? t(locale, label.busy)
          : state === "open"
            ? t(locale, label.done)
            : idle}
      </button>
      {error && <span className="open-project-action__error">{error}</span>}
    </span>
  );
}
