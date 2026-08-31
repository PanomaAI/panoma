"use client";

import { useCallback, useState } from "react";

/**
 * Copy something to the clipboard and say that it was copied, for a moment.
 *
 * It was written four times with the same `setTimeout(…, 1600)` inside: the command copy button,
 * the body of a task, the connection fragment of an agent, and the value of an account. Four
 * places where the same number lived, which is what makes one day three say 1600 and the fourth
 * 1800 without anyone deciding it.
 *
 * `failed` exists because of a real case and not because of symmetry: outside of a secure origin,
 * `navigator.clipboard` does not exist, so this throws before copying anything. It really happens
 * — `panoma up --network` serves the app through IP to view it from mobile, and there the button
 * did not copy, did not indicate it, and it was the only way left because "open on your terminal"
 * does not render from another machine—. Whoever does not need to distinguish it, ignores the
 * field: without permission, the text remains visible and can be selected manually.
 */

/** The duration of the 'copying' on screen. Enough to read it, little to bother. */
const VISIBLE_MS = 1600;

export function useCopied(): {
  copied: boolean;
  failed: boolean;
  copy: (text: string) => Promise<void>;
} {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), VISIBLE_MS);
    } catch {
      setFailed(true);
    }
  }, []);

  return { copied, failed, copy };
}
