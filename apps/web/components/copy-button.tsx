"use client";

import { t, type Locale } from "@/lib/i18n";
import { useCopied } from "./use-copied";
import { ActionButton } from "./primitives";

/**
 * Copy a command to the clipboard.
 *
 * It shows the command instead of executing it. Panoma can read your disk but it will not do
 * `git push` on its own: publishing is a decision, and the day a tool makes it by itself is the
 * day it stops deserving access to the repository.
 *
 * The language comes by prop and not from the context, just like in `RunStatusTag`: this button
 * also appears in "Unsaved Work," which remains entirely in Spanish, and a stray "copied" in the
 * middle of a Spanish page reads as an error. Whoever already translates their screen gets past
 * it.
 */
export function CopyCommand({
  command,
  label,
  locale,
}: {
  command: string;
  label?: string;
  locale: Locale;
}) {
  const { copied, copy } = useCopied();

  /*
    It was `px-2 py-0.5` with no height — about nineteen pixels tall, which is the smallest of the
    53 buttons that declared none. `sm` is the 26px step and the same colour it already had.
   */
  return (
    <ActionButton
      tone="raised"
      size="sm"
      type="button"
      onClick={() => copy(command)}
      title={t(locale, "copy.command", { command })}
    >
      <span>{label ?? command}</span>
      <span className="text-faint">{copied ? t(locale, "copy.done") : "⧉"}</span>
    </ActionButton>
  );
}
