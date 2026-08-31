/*
  Your history with the agents, read where it already is: on your disk.
  It is a folder and not a file for the same reason as `ecosystems/`: what goes inside is **a
  reader per tool** — today Claude Code; later Codex, Cursor, Aider — and each format is a world.
  Claude Code writes JSONL line by line; Cursor puts the conversation in a SQLite database per
  workspace; Aider leaves a Markdown inside each repository. All of that in a single module
  produces a file with four stitched parsers and a header that no one can explain. Behind this
  facade, however, they all return the same shape and the caller does not notice the difference.
  The two functions are exported in this order on purpose, because this is the order in which they
  should be called:
  1. `inventoryHistory()` looks **how much there is** without opening anything. It is what is
  taught to someone before asking for permission, and it is what makes that permission mean
  something.
  2. `mineHistory()` truly reads, and only after that yes: consult the permission of that source
  before opening anything. The tool readers (`mineClaudeCode`, `mineCodex` ) remain here inside to
  be able to test them separately, but they do not leave the package: outside there is only the
  door with permission, so the path without it is not discouraged, it is out of reach.
  Everything happens locally, everything is read-only, and nothing leaves here without going
  through `redactQuote`. The engine does not touch the network —`no-network.test.ts` checks it by
  running it with the network broken— and this is precisely the module where that promise matters
  most: what it reads is someone's entire conversation with their work tool.
 */

export type { HistorySource, HistorySourceId } from "./inventory";
export { inventoryHistory } from "./inventory";

export type {
  MineOptions,
  MineResult,
  MineStats,
  Reaction,
  VerdictSignal,
} from "./claude-code";
export { detectSignals } from "./claude-code";



export type { TwinConsent } from "./consent";
export {
  isAllowed,
  publishesInferred,
  readConsent,
  setConsent,
  setInferredConsent,
} from "./consent";

export type { MineOutcome } from "./mine";
export { hasReader, mineHistory, readableSources } from "./mine";
