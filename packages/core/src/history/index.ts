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
export type { Narrative } from "./shared";



export type { ConsentGrant, GrantInput, GrantPurpose, GrantScope, TwinConsent } from "./consent";
export {
  grantFor,
  isAllowed,
  isGrantPurpose,
  publishesInferred,
  readConsent,
  setConsent,
  setGrant,
  setInferredConsent,
} from "./consent";

export type { MineOutcome } from "./mine";
export { hasReader, mineHistory, readableSources } from "./mine";

/*
  The receipt reader is the third door, and it is a different door: it returns coordinates and
  hook output, never a person's words, and it is gated by a grant on top of the source permission
  (`grantFor`), not by `isAllowed` alone. It is exported whole because the worker that owns the
  cursors lives in the web application and needs the parser, the anchor and the path gate.
 */
export type {
  ReadEnd,
  ReadGap,
  ReadOptions,
  ReadResult,
  ReceiptEntrypoint,
  ReceiptEvent,
  ReceiptEventKind,
} from "./receipts";
export {
  RECEIPT_PARSER_VERSION,
  anchorHashAt,
  claudeCodeStreamKey,
  claudeCodeTranscriptPath,
  isClaudeCodeTranscript,
  readReceipts,
} from "./receipts";

/*
  Delivery B: the typed facts a program's own record yields — what was read, edited or run, what a
  test said, what failed — and the owner's turns, redacted and capped, for the extractor. Two
  readers, one per harness; the Codex names are its own so that neither shadows the other.
 */
export {
  CLAUDE_FACTS_PARSER_VERSION,
  COMMAND_FAMILIES,
  COMMAND_FAMILY_NAMES,
  FACT_KINDS,
  HUMAN_TURN_CODE_POINTS,
  LOOKBACK_BYTES,
  MAX_FACT_PATHS,
  OUTSIDE,
  REDACTED_CREDENTIAL,
  classifyCommand,
  locateInterval,
  readFacts,
  readHumanTurns,
  testResult,
} from "./facts";
export type {
  CommandFamily,
  CommandFactPayload,
  CommitFactPayload,
  EditFactPayload,
  EditKind,
  FactEvent,
  FactKind,
  FactPayload,
  FactReadOptions,
  FactReadResult,
  FailureFactPayload,
  FailureKind,
  HumanTurn,
  HumanTurnOptions,
  HumanTurnResult,
  IntervalOptions,
  IntervalResult,
  LifecycleEvent,
  LifecycleFactPayload,
  ReadFactPayload,
  ReceiptSeenFactPayload,
  RecipientKey,
  TestOutcome,
  TestResultFactPayload,
} from "./facts";
export { CODEX_FACTS_PARSER_VERSION, readCodexFacts, readCodexHumanTurns } from "./facts-codex";
