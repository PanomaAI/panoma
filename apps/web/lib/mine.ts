import type { HistorySource, HistorySourceId, TwinConsent } from "@panoma/core";

/*
  Which stories can be read right now, and why the others cannot.
  It was the hole that remained: mining —opening Claude Code and Codex's `.jsonl` and extracting
  the quotes— only existed on the terminal. The portrait screen learned to distill, but distilling
  chews what is already stored; if no one mines, nothing new ever comes in. The live effect: with
  the entire corpus read, the screen offered **no** buttons, so what the author wrote today to their
  agents could not enter without opening a terminal.
  What decides what opens are three things, and all three must be able to be said separately,
  because each one sends to a different place:
  - **It exists and can be read and there is permission**: it is read.
  - **It is there and can be read and there is no permission**: the answer is to give the
  permission, not to retry. And the permission is by source, never a global one — see header of
  `history/consent.ts`.
  - **It exists and there is no reader**: Cursor and Aider are seen in the inventory and still no
  one knows how to open them. Counting them as 'without permission' would mean granting one that
  would not be useful.
  What is not on the disk does not come out anywhere: it is not a refusal, it is that it does not
  exist.
  This is pure and lives here by the usual rule: the website is tested by its assistants and never
  by raising a server. The one who opens the files is `mineHistory`, in the engine.
 */

export interface MinePlan {
  /** With reader and with permission: these open. */
  ready: HistorySourceId[];
  /** With reader and without permission. The exit is to grant, not to retry. */
  denied: HistorySourceId[];
  /**
   * Present and without a reader. There is no permission that matters: no one knows how to open
   * them yet.
   */
  unreadable: HistorySourceId[];
}

/**
 * Distribute the stories from the disk into the three piles. Do not open anything.
 *
 * `found` is the inventory —measured with `stat`, without opening a file—, `readable` the sources
 * that today have a reader, and `consent` what has been decided. The order of the piles is that of
 * the inventory, which is what the person sees in `twin sources`.
 */
export function planMine(
  found: HistorySource[],
  readable: readonly HistorySourceId[],
  consent: TwinConsent,
): MinePlan {
  const plan: MinePlan = { ready: [], denied: [], unreadable: [] };

  for (const source of found) {
    if (!source.present) continue;
    if (!readable.includes(source.id)) {
      plan.unreadable.push(source.id);
      continue;
    }
    // Only `true` grants, just like in the engine: a half file is not a permission.
    if (consent.sources?.[source.id] === true) plan.ready.push(source.id);
    else plan.denied.push(source.id);
  }

  return plan;
}
