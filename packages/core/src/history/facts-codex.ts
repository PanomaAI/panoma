import { isRecord } from "../fs-utils";
import { HANDOFF_CODEX_ORIGINATOR } from "../handoff-marker";
import {
  classifyCommand,
  type CommandFamily,
  type FactEvent,
  type FactReadOptions,
  type FactReadResult,
  failure,
  type HumanTurn,
  type HumanTurnOptions,
  type HumanTurnResult,
  humanText,
  insideRoot,
  lifecycle,
  lookBack,
  parseRecord,
  PendingCalls,
  projectPaths,
  readString,
  type RecipientKey,
  type ScanOptions,
  scanRecords,
  testResult,
  type TypedFact,
} from "./facts";
import { isBrief } from "./shared";

/*
  The facts reader of Codex rollouts: the same closed list of facts as `facts.ts`, read from the
  other format, with the same bytes discipline and the same family table.
  A rollout is `{"timestamp", "type", "payload"}` per line, and what this reader decodes is a
  short list: the session header (`session_meta`, the start of a session and the only place that
  says whether it is a subagent's), the working directory of a turn (`turn_context`), the calls
  (`function_call` with a JSON `arguments`, `custom_tool_call` with a text `input`), their
  outputs, an aborted turn, and a compaction. The person's channels are read by the other
  function of this module and nowhere else. Everything `codex.ts` measured about the format
  applies here and is not repeated: the cheap discard over the first 4 KiB, the three spoken
  channels, the held turn, the injected blocks and the `## My request` marker, the handoff prefix
  that ends at `thread_settings_applied`. Where that reader counts, this one records coordinates.
  ── Calls and their outputs ────────────────────────────────────────────────────────────
  Three shell tools exist on this disk — `shell` with a `command` array, `shell_command` with a
  `command` string, `exec_command` with a `cmd` — and the app now runs most work through the
  `exec` custom tool, whose input is a line of JavaScript calling `tools.exec_command({cmd: …})`
  one or more times. The JavaScript is not interpreted: each `cmd` string literal is found and
  decoded as the JSON string it is, classified by `COMMAND_FAMILIES`, and forgotten. A patch
  names its files on its own header lines (`*** Add File:`, `*** Update File:`, `*** Delete
  File:`), and those are the edit paths, by contract of the tool. Codex outputs do carry an exit
  code — `Process exited with code 1`, a `metadata.exit_code`, an `"exit_code":2` inside a chunk
  — and a non-zero one is a failure; the outcome of a test run still comes only from the summary
  lines the runner printed, because an exit code says the process failed, not which tests did.
  ── Where a window starts matters ─────────────────────────────────────────────────────
  The session state — id, cwd, subagent, carried prefix — is written once in the header, and a
  read that starts mid-file has not seen it. The first record of the file is peeked, bounded to
  `PEEK_BYTES`, so a subagent rollout read from its cursor still says `sub:<id>` and a turn still
  carries its session. A handed-off stream remains carried until the reader observes the native
  continuation marker before the window or inside it. The bounded prefix scan and look-back
  can miss a marker in the middle of a very large prefix; that uncertainty never promotes a
  copied turn to new evidence. One known limit of the held-turn rule
  at a boundary: a `response_item` turn held at the end of a read is emitted, as `codex.ts` does
  at the end of a file; if its event twin is the first record of the next window, the twin is a
  second turn with its own coordinates. It needs the read budget to land exactly between two
  lines the app writes together; the reader inside one read never counts a turn twice.
 */

/** Bumped when the interpretation of a Codex record changes; a `facts` cursor is bound to it. */
export const CODEX_FACTS_PARSER_VERSION = "codex-facts-1";

/** How much of a line is looked at to know what it is; see the header of `codex.ts`. */
const SCAN_BYTES = 4_096;

/** How much of the file's first line is read to seed the session state of a mid-file read. */
const PEEK_BYTES = 64 * 1024;

/** How many `cmd` strings one `exec` input yields; a longer script is a script, and its first commands say what it does. */
const MAX_EXEC_COMMANDS = 8;

/** The shell tools, by the names Codex has used; their arguments carry the command and the workdir. */
const SHELL_TOOLS = new Set(["shell", "shell_command", "exec_command", "local_shell", "container.exec"]);

/** The tools that read one file, by their `path`. */
const READ_TOOLS = new Set(["read_file", "view_image"]);

/** The file marker of a patch, as `codex.ts` reads it. */
const PATCH_FILE = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm;

/** A `cmd` string literal in the `exec` input, with either spelling of the key; the literal is JSON and is decoded as such. */
const EXEC_COMMAND = /\b"?cmd"?\s*:\s*("(?:[^"\\]|\\.)*")/g;
const EXEC_WORKDIR = /\b"?workdir"?\s*:\s*("(?:[^"\\]|\\.)*")/;

/** The closed markers of a failed output. */
const EXITED_WITH = /^Process exited with code (\d+)/m;
const EXIT_CODE_FIELD = /"exit_code":\s*(\d+)/g;
const ERROR_HEAD = /^(?:apply_patch verification failed|[Ee]rror:)/;

/** With the quotes on purpose, as in `codex.ts`: `"function_call"` does not match inside `"function_call_output"`, so both are listed. */
const FACT_MARKERS = ['"session_meta"', '"turn_context"', '"function_call"', '"function_call_output"', '"custom_tool_call"', '"custom_tool_call_output"', '"turn_aborted"', '"compacted"', '"thread_settings_applied"'];

const HUMAN_MARKERS = ['"session_meta"', '"user_message"', '"agent_message"', '"UserMessage"', '"AgentMessage"', '"input_text"', '"output_text"', '"thread_settings_applied"'];

/** The records that may carry a call, for the look-back; the quotes keep the outputs out. */
const CALL_MARKERS = ['"function_call"', '"custom_tool_call"'];

/** Lines that are a tool's output are never spoken, and the app writes their parts as `input_text`: told apart before the parse. */
const OUTPUT_MARKERS = ['"function_call_output"', '"custom_tool_call_output"'];

/** The blocks the client writes on the person's turn, from `codex.ts` (private there). */
const INJECTED_BLOCKS = [
  /<realtime_delegation>[\s\S]*?<\/realtime_delegation>/g,
  /<in-app-browser-context[\s\S]*?<\/in-app-browser-context>/g,
  /<environment_context>[\s\S]*?<\/environment_context>/g,
  /<recommended_plugins>[\s\S]*?<\/recommended_plugins>/g,
  /<turn_aborted>[\s\S]*?<\/turn_aborted>/g,
  /<codex_internal_context[\s\S]*?<\/codex_internal_context>/g,
];
const INJECTED_WHOLE = /^#[ \t]+AGENTS\.md instructions\b/;
const REQUEST_MARKER = /^##[ \t]+My request(?:[ \t]+for[ \t]+Codex)?:[ \t]*$/m;

/** What the header said, carried across the records that follow it. */
interface SessionState {
  sessionId: string | null;
  cwd: string | null;
  subagent: boolean;
  carried: boolean;
}

function freshState(): SessionState {
  return { sessionId: null, cwd: null, subagent: false, carried: false };
}

/** Read the header into the state: the session's id, its cwd, whether a subagent runs it, whether a handoff wrote it. */
function applyHeader(state: SessionState, payload: Record<string, unknown>): void {
  state.sessionId = readString(payload["id"]);
  state.cwd = readString(payload["cwd"]);
  const source = payload["source"];
  state.subagent = isRecord(source) && source["subagent"] !== undefined;
  state.carried = payload["originator"] === HANDOFF_CODEX_ORIGINATOR;
}

/** The first record of the file, when the read starts after it, so the state is the header's and not a blank. */
async function peekHeader(path: string, state: SessionState, from: number): Promise<number> {
  const scan = await scanRecords(path, { from: 0, to: from, maxBytes: PEEK_BYTES, longLines: "skip" }, (line) => {
    const record = parseRecord(line);
    const payload = record?.["payload"];
    if (record?.["type"] === "session_meta" && isRecord(payload)) applyHeader(state, payload);
    if (record?.["type"] === "event_msg" && isRecord(payload) && payload["type"] === "thread_settings_applied") state.carried = false;
    if (!state.carried) return "stop";
  });
  let bytesRead = scan.bytesRead;
  if (state.carried && scan.nextByte < from) {
    bytesRead += await lookBack(path, from, (line) => {
      if (!hasMarker(line, ['"thread_settings_applied"'])) return;
      const record = parseRecord(line);
      const payload = record?.["payload"];
      if (record?.["type"] === "event_msg" && isRecord(payload) && payload["type"] === "thread_settings_applied") state.carried = false;
    });
  }
  return bytesRead;
}

function identityOf(record: Record<string, unknown>, state: SessionState): Pick<FactEvent, "sessionId" | "recipientKey" | "timestamp" | "copied"> {
  const recipientKey: RecipientKey = state.subagent ? `sub:${state.sessionId ?? "unknown"}` : "main";
  return { sessionId: state.sessionId, recipientKey, timestamp: readString(record["timestamp"]), copied: state.carried };
}

function hasMarker(line: Buffer, markers: string[]): boolean {
  const scan = line.length > SCAN_BYTES ? line.subarray(0, SCAN_BYTES) : line;
  return markers.some((marker) => scan.includes(marker));
}

// ── Facts ─────────────────────────────────────────────────────────────────────────────

/** Read the facts of a Codex rollout from a byte offset, within a budget; same shape as `readFacts` of `facts.ts`. */
export async function readCodexFacts(path: string, options: FactReadOptions): Promise<FactReadResult> {
  const facts: FactEvent[] = [];
  const pending = new PendingCalls();
  const state = freshState();
  const root = options.root;
  let peeked = options.from > 0 ? await peekHeader(path, state, options.from) : 0;
  // The calls of the records just before the window, so an output at its start still knows its tool.
  peeked += await lookBack(path, options.from, (line) => {
    if (!hasMarker(line, CALL_MARKERS)) return;
    const record = parseRecord(line);
    const payload = record?.["payload"];
    if (record?.["type"] === "response_item" && isRecord(payload)) seedCall(payload, pending);
  });

  const scanOptions: ScanOptions = { from: options.from, maxBytes: options.maxBytes };
  if (options.timeBudgetMs !== undefined) scanOptions.timeBudgetMs = options.timeBudgetMs;

  const scan = await scanRecords(path, scanOptions, (line, offset) => {
    if (!hasMarker(line, FACT_MARKERS)) return;
    const record = parseRecord(line);
    if (record === undefined) return;
    const typed = codexFacts(record, state, pending, root);
    if (typed.length === 0) return;
    const identity = identityOf(record, state);
    typed.forEach((fact, subIndex) => {
      facts.push({ kind: fact.kind, subIndex, byteOffset: offset, byteLength: line.length, ...identity, payload: fact.payload });
    });
  });

  const result: FactReadResult = { facts, nextByte: scan.nextByte, endedAt: scan.endedAt, bytesRead: scan.bytesRead + peeked, anchorHash: scan.anchorHash };
  if (scan.gap !== undefined) result.gap = scan.gap;
  return result;
}

/** The facts of one record, in order; the state moves with the headers and the turn contexts. */
function codexFacts(record: Record<string, unknown>, state: SessionState, pending: PendingCalls, root: string | undefined): TypedFact[] {
  const out: TypedFact[] = [];
  const type = record["type"];
  if (type === "compacted") {
    out.push(lifecycle("compact"));
    return out;
  }
  const payload = record["payload"];
  if (!isRecord(payload)) return out;

  if (type === "session_meta") {
    applyHeader(state, payload);
    out.push(lifecycle("start"));
    return out;
  }
  if (type === "turn_context") {
    // The turn's cwd overrides the header's while it lasts; an empty one is a field not filled.
    const cwd = readString(payload["cwd"]);
    if (cwd !== null) state.cwd = cwd;
    return out;
  }
  const kind = payload["type"];
  if (type === "event_msg") {
    if (state.carried && kind === "thread_settings_applied") state.carried = false;
    else if (kind === "turn_aborted") out.push(failure("interrupted", undefined));
    return out;
  }
  if (type !== "response_item") return out;

  if (kind === "function_call") functionCallFacts(payload, state, pending, root, out);
  else if (kind === "custom_tool_call") customCallFacts(payload, state, pending, root, out);
  else if (kind === "function_call_output" || kind === "custom_tool_call_output") outputFacts(payload, pending, out);
  return out;
}

function functionCallFacts(payload: Record<string, unknown>, state: SessionState, pending: PendingCalls, root: string | undefined, out: TypedFact[]): void {
  const name = readString(payload["name"]);
  if (name === null) return;
  const args = parseJson(readString(payload["arguments"]));
  const input = isRecord(args) ? args : {};
  let family: CommandFamily | null = null;

  if (SHELL_TOOLS.has(name)) {
    const workdir = readString(input["workdir"]) ?? state.cwd;
    family = commandFacts([commandOf(input)], name, workdir, root, out);
  } else if (name === "apply_patch") {
    patchFacts(readString(input["input"]) ?? readString(input["patch"]) ?? "", name, state.cwd, root, out);
  } else if (READ_TOOLS.has(name)) {
    const path = readString(input["path"]);
    out.push({ kind: "read", payload: { schemaVersion: 1, tool: name, paths: projectPaths(path === null ? [] : [path], state.cwd, root) } });
  }

  const id = readString(payload["call_id"]);
  if (id !== null) pending.set(id, { tool: name, family });
}

function customCallFacts(payload: Record<string, unknown>, state: SessionState, pending: PendingCalls, root: string | undefined, out: TypedFact[]): void {
  const name = readString(payload["name"]);
  if (name === null) return;
  const input = readString(payload["input"]) ?? "";
  let family: CommandFamily | null = null;

  if (name === "apply_patch") {
    patchFacts(input, name, state.cwd, root, out);
  } else if (name === "exec") {
    const workdir = stringLiteral(EXEC_WORKDIR.exec(input)?.[1]) ?? state.cwd;
    family = commandFacts(execCommands(input), name, workdir, root, out);
  }

  const id = readString(payload["call_id"]);
  if (id !== null) pending.set(id, { tool: name, family });
}

/**
 * One command fact per command line, and a commit fact after the one that commits. Returns the
 * family the output will be judged by: `test` when any command is a test run, else the first.
 */
function commandFacts(commands: string[], tool: string, workdir: string | null, root: string | undefined, out: TypedFact[]): CommandFamily | null {
  const cwdInside = insideRoot(workdir, root);
  for (const command of commands) {
    const classified = classifyCommand(command);
    out.push({ kind: "command", payload: { schemaVersion: 1, family: classified.family, tool, cwdInside } });
    if (classified.commit) out.push({ kind: "commit", payload: { schemaVersion: 1, validated: false, family: "git" } });
  }
  return outputFamily(commands);
}

/** The family an output is judged by: `test` when any command is a test run, else the first's. */
function outputFamily(commands: string[]): CommandFamily | null {
  let family: CommandFamily | null = null;
  for (const command of commands) {
    const { family: found } = classifyCommand(command);
    if (family === null || (family !== "test" && found === "test")) family = found;
  }
  return family;
}

/** What a call leaves for its output, without its facts: the seeding of a window that starts after the call. */
function seedCall(payload: Record<string, unknown>, pending: PendingCalls): void {
  const name = readString(payload["name"]);
  const id = readString(payload["call_id"]);
  if (name === null || id === null) return;
  let family: CommandFamily | null = null;
  if (payload["type"] === "function_call" && SHELL_TOOLS.has(name)) {
    const args = parseJson(readString(payload["arguments"]));
    family = outputFamily([commandOf(isRecord(args) ? args : {})]);
  } else if (payload["type"] === "custom_tool_call" && name === "exec") {
    family = outputFamily(execCommands(readString(payload["input"]) ?? ""));
  }
  pending.set(id, { tool: name, family });
}

/** The edit facts of a patch: the files it adds, then the files it updates or deletes. */
function patchFacts(patch: string, tool: string, cwd: string | null, root: string | undefined, out: TypedFact[]): void {
  const created: string[] = [];
  const modified: string[] = [];
  for (const match of patch.matchAll(PATCH_FILE)) {
    const path = match[2]?.trim();
    if (path === undefined || path.length === 0) continue;
    (match[1] === "Add" ? created : modified).push(path);
  }
  if (created.length > 0) out.push({ kind: "edit", payload: { schemaVersion: 1, tool, kind: "create", paths: projectPaths(created, cwd, root) } });
  if (modified.length > 0) out.push({ kind: "edit", payload: { schemaVersion: 1, tool, kind: "modify", paths: projectPaths(modified, cwd, root) } });
}

function outputFacts(payload: Record<string, unknown>, pending: PendingCalls, out: TypedFact[]): void {
  const id = readString(payload["call_id"]);
  const call = id === null ? undefined : pending.take(id);
  const { text, exitCode } = outputOf(payload["output"]);
  if (failed(text, exitCode)) out.push(failure("tool_error", call));
  if (call?.family === "test") out.push({ kind: "test_result", payload: testResult(text) });
}

/** The command a shell call carries: `cmd`, or `command` as a string or as the argv of a shell. */
function commandOf(input: Record<string, unknown>): string {
  const cmd = readString(input["cmd"]);
  if (cmd !== null) return cmd;
  const command = input["command"];
  if (typeof command === "string") return command;
  if (!Array.isArray(command)) return "";
  const argv = command.filter((part): part is string => typeof part === "string");
  // `["bash", "-lc", "pnpm test"]`: the script is the command, the shell is the wrapper.
  if (argv.length === 3 && /^(?:bash|sh|zsh|dash)$/.test(argv[0] ?? "") && /^-l?c$/.test(argv[1] ?? "")) return argv[2] ?? "";
  return argv.join(" ");
}

/** The `cmd` literals of an `exec` input, decoded; at most `MAX_EXEC_COMMANDS`. */
function execCommands(input: string): string[] {
  const found: string[] = [];
  for (const match of input.matchAll(EXEC_COMMAND)) {
    const command = stringLiteral(match[1]);
    if (command !== null) found.push(command);
    if (found.length >= MAX_EXEC_COMMANDS) break;
  }
  return found;
}

/** A JSON string literal decoded, or null when it is not one. */
function stringLiteral(literal: string | undefined): string | null {
  if (literal === undefined) return null;
  const value = parseJson(literal);
  return typeof value === "string" ? value : null;
}

/** The text of an output and the exit code it declares, from the three shapes the tool has written. */
function outputOf(output: unknown): { text: string; exitCode: number | undefined } {
  if (typeof output === "string") {
    const asJson = output.startsWith("{") ? parseJson(output) : undefined;
    return isRecord(asJson) ? outputOf(asJson) : { text: output, exitCode: undefined };
  }
  if (Array.isArray(output)) {
    const text = output
      .map((part) => (isRecord(part) ? readString(part["text"]) ?? "" : ""))
      .filter((part) => part.length > 0)
      .join("\n");
    return { text, exitCode: undefined };
  }
  if (isRecord(output)) {
    const metadata = output["metadata"];
    const code = isRecord(metadata) ? metadata["exit_code"] : undefined;
    const text = readString(output["output"]) ?? "";
    return { text, exitCode: typeof code === "number" && Number.isInteger(code) ? code : undefined };
  }
  return { text: "", exitCode: undefined };
}

/** Whether an output is a failure, by the closed markers; the text is judged, never kept. */
function failed(text: string, exitCode: number | undefined): boolean {
  if (exitCode !== undefined) return exitCode !== 0;
  const exited = EXITED_WITH.exec(text);
  if (exited !== null) return Number(exited[1]) !== 0;
  for (const match of text.matchAll(EXIT_CODE_FIELD)) {
    if (Number(match[1]) !== 0) return true;
  }
  return ERROR_HEAD.test(text);
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// ── Human turns ───────────────────────────────────────────────────────────────────────

/**
 * Read the person's turns of a rollout between two bytes, by the three channels and the held-turn
 * rule of `codex.ts`: a `response_item` turn waits for its event twin and the event is the turn;
 * anything else arriving first makes the held one the turn. Subagent sessions are the person's
 * words copied by the agent and are not turns. Same redaction and cap as the Claude Code reader.
 */
export async function readCodexHumanTurns(path: string, options: HumanTurnOptions): Promise<HumanTurnResult> {
  const turns: HumanTurn[] = [];
  const state = freshState();
  const peeked = options.from > 0 ? await peekHeader(path, state, options.from) : 0;
  /** A `response_item` turn waiting to learn whether an event twin follows; `text` is what is left after the client's blocks. */
  let held: { text: string; at: string | null; offset: number; length: number } | undefined;
  /** The last turn taken, whichever channel said it, to fold a twin that arrives afterwards. */
  let lastTurn: string | undefined;

  const emit = (text: string, at: string | null, offset: number, length: number): void => {
    lastTurn = text;
    if (state.subagent || text.length === 0) return;
    turns.push({
      byteOffset: offset,
      byteLength: length,
      sessionId: state.sessionId,
      timestamp: at,
      ...humanText(text),
      role: "owner",
      attribution: isBrief(text) ? "ambiguous" : "owner",
      copied: state.carried,
    });
  };
  const takeHeld = (): void => {
    if (held === undefined) return;
    const { text, at, offset, length } = held;
    held = undefined;
    emit(text, at, offset, length);
  };

  const scanOptions: ScanOptions = { from: options.from, maxBytes: options.maxBytes };
  if (options.to !== undefined) scanOptions.to = options.to;
  if (options.timeBudgetMs !== undefined) scanOptions.timeBudgetMs = options.timeBudgetMs;

  const scan = await scanRecords(path, scanOptions, (line, offset) => {
    if (!hasMarker(line, HUMAN_MARKERS) || hasMarker(line, OUTPUT_MARKERS)) return;
    const record = parseRecord(line);
    if (record === undefined) return;
    const payload = record["payload"];
    if (!isRecord(payload)) return;
    const type = record["type"];

    if (type === "session_meta") {
      // A turn held from the previous session is that session's: taken before the header renames it.
      takeHeld();
      applyHeader(state, payload);
      lastTurn = undefined;
      return;
    }
    const kind = payload["type"];
    if (state.carried && type === "event_msg" && kind === "thread_settings_applied") {
      state.carried = false;
      return;
    }
    const spoken = spokenOf(type, kind, payload);
    if (spoken === undefined) return;
    const at = readString(record["timestamp"]);

    if (spoken.role === "assistant") {
      takeHeld();
      return;
    }
    // Twins are compared after the client's blocks are cut, unlike `codex.ts`, which compares the
    // raw text: the app may pad one channel with a preamble, and a padded twin is still one turn.
    const text = stripInjected(spoken.text.trim());
    if (spoken.channel === "response") {
      takeHeld();
      // Nothing but the client's injected context: dropped, never counted.
      if (text.length === 0) return;
      // The older client wrote the event first and the response item after it: the same twin, the other way round.
      if (text === lastTurn) return;
      held = { text, at, offset, length: line.length };
      return;
    }
    // An event turn: its response-item twin, if held, is dropped; another held text is a turn.
    if (held !== undefined && held.text === text) held = undefined;
    else takeHeld();
    // An event turn with nothing of the person's is not a turn; it still releases the held one.
    if (text.length === 0) return;
    emit(text, at, offset, line.length);
  });
  // The end of the window: a turn still held was the last thing the person typed.
  takeHeld();

  const result: HumanTurnResult = { turns, nextByte: scan.nextByte, endedAt: scan.endedAt, bytesRead: scan.bytesRead + peeked };
  if (scan.gap !== undefined) result.gap = scan.gap;
  return result;
}

/** What a line says in a person's voice or the assistant's, on whichever of the three channels; as `spokenOf` in `codex.ts`. */
function spokenOf(type: unknown, kind: unknown, payload: Record<string, unknown>): { role: "user" | "assistant"; channel: "event" | "response"; text: string } | undefined {
  if (type === "event_msg") {
    if (kind === "user_message" || kind === "agent_message") {
      const text = readString(payload["message"]) ?? readString(payload["text"]) ?? "";
      return { role: kind === "user_message" ? "user" : "assistant", channel: "event", text };
    }
    if (kind !== "item_completed") return undefined;
    const item = payload["item"];
    if (!isRecord(item)) return undefined;
    if (item["type"] === "UserMessage") return { role: "user", channel: "event", text: partsText(item["content"]) };
    if (item["type"] === "AgentMessage") return { role: "assistant", channel: "event", text: partsText(item["content"]) };
    return undefined;
  }
  if (type === "response_item" && kind === "message") {
    const role = payload["role"];
    if (role !== "user" && role !== "assistant") return undefined;
    return { role, channel: "response", text: partsText(payload["content"]) };
  }
  return undefined;
}

function partsText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isRecord(part) ? readString(part["text"]) ?? "" : ""))
    .filter((text) => text.length > 0)
    .join("\n");
}

/** Remove what the client put in the person's turn and return what was left; as `codex.ts`. */
function stripInjected(text: string): string {
  let out = text;
  for (const block of INJECTED_BLOCKS) out = out.replace(block, " ");
  if (INJECTED_WHOLE.test(out.trimStart())) return "";
  const marker = REQUEST_MARKER.exec(out);
  if (marker !== null) out = out.slice(marker.index + marker[0].length);
  return out.trim();
}

/** The spec's names for the two readers of this harness; the package root re-exports the prefixed ones. */
export { readCodexFacts as readFacts, readCodexHumanTurns as readHumanTurns };
