import type { HistorySourceId } from "./inventory";
import type { MineOptions, MineResult } from "./claude-code";
import { mineClaudeCode } from "./claude-code";
import { mineCodex } from "./codex";
import { isAllowed, readConsent } from "./consent";

/*
  The only door through which a history is read.
  The previous increment left `mineClaudeCode` exported from the package root, along with a path
  that opens 1.5 GB of conversation without consulting anyone. Having a check next to it is not
  enough: whoever writes the second consumer—a web route, a bot, a migration script—doesn't have
  to know that it needs to be called, and the failure doesn't warn, because reading too much works
  perfectly. It's the same lesson that made `apps/cli/src/hooks.ts` exist: the log is not
  requested from the model, it is hooked, because what depends on remembering is forgotten.
  Hence the shape of this module. Tool readers remain pure and probable on their own—a test passes
  them a fake folder and checks the parser—but **they stop being exported from `index.ts` of the
  package**. Outside of `@panoma/core` only `mineHistory` exists, and `mineHistory` does not read
  anything that the user has not allowed beforehand. The path without permission is not
  discouraged: it becomes unreachable.
  ── Why doesn't it throw an exception ────────────────────────────────────────────────
  "'You have not given permission' is not a failure: it is a correct and expected response, and
  the first one everyone will receive, because the default value is 'no' for all sources.
  Returning it as an exception would force each interface to distinguish in a `catch` between 'you
  didn’t want to' and 'the disk failed,' which are opposite things: one is fixed with a kind
  phrase and a command, the other needs to be taught. It goes in the result, with the source
  inside, so that whoever receives it can say exactly what to enable."
 */

export interface MineOutcome {
  source: HistorySourceId;
  /** `false` when this source does not have permission. Then not a single file has been opened. */
  allowed: boolean;
  /** Only when `allowed`. */
  result?: MineResult;
}

/** The sources that today have a reader. The others would invent the result. */
const READERS: Partial<Record<HistorySourceId, (options: MineOptions) => Promise<MineResult>>> = {
  "claude-code": mineClaudeCode,
  codex: mineCodex,
};

export function hasReader(source: HistorySourceId): boolean {
  return READERS[source] !== undefined;
}

export function readableSources(): HistorySourceId[] {
  return Object.keys(READERS) as HistorySourceId[];
}

/**
 * Read the history of a source, if and only if that source has permission.
 *
 * `panomaHome` is the directory of Panoma (where `twin.json` lives) and not the user's personal
 * folder, which is what `MineOptions.home` means to readers. They are two different paths and it
 * is easy to confuse them: the first one is moved by `PANOMA_HOME` and the second one is not. They
 * are requested separately on purpose.
 */
export async function mineHistory(
  source: HistorySourceId,
  options: MineOptions = {},
  panomaHome?: string,
): Promise<MineOutcome> {
  const reader = READERS[source];
  if (!reader) return { source, allowed: false };

  const consent = await readConsent(panomaHome);
  if (!isAllowed(consent, source)) return { source, allowed: false };

  return { source, allowed: true, result: await reader(options) };
}
