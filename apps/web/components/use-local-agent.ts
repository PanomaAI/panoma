"use client";

import { useEffect, useState } from "react";

/**
 * If this facility can launch an agent right now, and which one.
 *
 * Same pattern as `useOpenTarget`: one query per tab saved in the module. But the assumption while
 * it arrives is the opposite there, and on purpose — there it is assumed that it can be opened
 * because that is the normal case; here it is assumed that it cannot, because showing a "do it
 * now" for half a second that then disappears breaks an immediate promise.
 *
 * In a file of its own since there are two places that offer that 'now': the orders from the form
 * and the critic's findings. Copied in both, the day the answer changes in one of the two screens
 * would promise a terminal that does not open.
 */
export type LocalAgent = { available: boolean; agent: string | null };

let query: Promise<LocalAgent> | undefined;

export function useLocalAgent(): LocalAgent {
  const [state, setState] = useState<LocalAgent>({ available: false, agent: null });

  useEffect(() => {
    query ??= fetch("/api/assignments/launch")
      .then((response) => response.json() as Promise<LocalAgent>)
      .catch(() => ({ available: false, agent: null }));
    let alive = true;
    void query.then((value) => {
      if (alive) setState(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
