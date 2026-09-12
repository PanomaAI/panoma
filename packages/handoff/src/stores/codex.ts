/**
 * Where Codex CLI keeps its conversations.
 *
 * Verified on Codex CLI 0.153.0 (11-Sep-2026): `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<local
 * timestamp>-<uuid>.jsonl`, default home `~/.codex`. The stamp and the day folder are the
 * machine's local time, the way Codex itself names them (a thread the app forked at 21:18 EDT
 * landed in `sessions/2026/09/11/rollout-2026-09-11T21-18-27-…`); resume goes by id, so the
 * name is a courtesy to whoever browses the folder. Two SQLite indexes sit beside the folder
 * and neither is touched: Codex read-repairs a row for any file it finds on first listing or
 * resume, so a file dropped in the right day folder is a conversation. The only index written
 * is `session_index.jsonl`, an append-only `{id, thread_name, updated_at}` list that gives a
 * conversation a name.
 *
 * The desktop app (bundled in ChatGPT.app on macOS) shares this folder with the CLI and lists
 * from its state database only; it renders a rollout only when the file ends with a
 * `thread_settings_applied` event naming a model and a reasoning effort. Those two come from
 * `config.toml`, read by `codexModelSettings` — four top-level keys and nothing else of the
 * file: the model, the effort, and since 12-Sep-2026 the approval policy and the sandbox mode,
 * because the event also stamps those two and the copy must say what the person's own
 * threads say, never the loosest values.
 */
import { readFile } from "node:fs/promises";
import { envValue, exists, resolveStoreOptions, type ResolvedStoreOptions } from "./shared";
import type { StoreOptions } from "../types";

/** The relative globs this package may open under `CODEX_HOME`. Closed list. */
export const MAY_OPEN: readonly string[] = ["sessions/*/*/*/rollout-*.jsonl", "session_index.jsonl", "config.toml"];

/** What the writer says when `config.toml` names no model or no effort, or is not there. */
export const CODEX_DEFAULT_MODEL = "gpt-5-codex";
export const CODEX_DEFAULT_REASONING_EFFORT = "medium";
/**
 * And for the two settings that decide what a thread may do without asking: Codex's own
 * defaults, which are the careful ones. Until 12-Sep-2026 the writer stamped `never` and a
 * disabled sandbox on every copy — the values the threads of the machine it was verified on
 * carried, because that machine's `config.toml` says so — and a person whose config asks to
 * be consulted would have had a thread record saying the opposite on their own disk.
 */
export const CODEX_DEFAULT_APPROVAL_POLICY = "on-request";
export const CODEX_DEFAULT_SANDBOX_MODE = "workspace-write";

export interface CodexModelSettings {
  model: string;
  reasoningEffort: string;
  /** `approval_policy` of `config.toml`: `untrusted`, `on-failure`, `on-request` or `never`. */
  approvalPolicy: string;
  /** `sandbox_mode` of `config.toml`: `read-only`, `workspace-write` or `danger-full-access`. */
  sandboxMode: string;
}

export const STORE_MARKER = "sessions";

export interface CodexStore {
  /** `CODEX_HOME` or `~/.codex`. */
  root: string;
  sessions: string;
  index: string;
  /** `config.toml`: read for its `model`, `model_reasoning_effort`, `approval_policy` and `sandbox_mode` lines, never written. */
  config: string;
  resolved: ResolvedStoreOptions;
}

function build(root: string, resolved: ResolvedStoreOptions): CodexStore {
  const { path } = resolved;
  return {
    root,
    sessions: path.join(root, "sessions"),
    index: path.join(root, "session_index.jsonl"),
    config: path.join(root, "config.toml"),
    resolved,
  };
}

export function codexStore(options: StoreOptions = {}): CodexStore {
  const resolved = resolveStoreOptions(options);
  const root = envValue(resolved.env, "CODEX_HOME") ?? resolved.path.join(resolved.home, ".codex");
  return build(root, resolved);
}

export function codexStoreAt(root: string, options: StoreOptions = {}): CodexStore {
  return build(root, resolveStoreOptions(options));
}

export function codexStoreExists(store: CodexStore): boolean {
  return exists(store.sessions);
}

/** The local calendar fields of an instant, zero-padded, in the order a stamp spells them. */
function localFields(at: Date): [year: string, month: string, day: string, hour: string, minute: string, second: string] {
  const two = (n: number) => String(n).padStart(2, "0");
  return [String(at.getFullYear()).padStart(4, "0"), two(at.getMonth() + 1), two(at.getDate()), two(at.getHours()), two(at.getMinutes()), two(at.getSeconds())];
}

/** `2026-09-11T13-51-53`: the instant in local time, the way Codex spells it in a file name. */
export function codexFileStamp(at: Date): string {
  const [year, month, day, hour, minute, second] = localFields(at);
  return `${year}-${month}-${day}T${hour}-${minute}-${second}`;
}

/** The day folder and the file name a new rollout gets, both from the same instant in local time. */
export function codexRolloutPath(store: CodexStore, at: Date, sessionId: string): string {
  const { path } = store.resolved;
  const [year, month, day] = localFields(at);
  return path.join(store.sessions, year, month, day, `rollout-${codexFileStamp(at)}-${sessionId}.jsonl`);
}

/**
 * The model and the reasoning effort the person configured, from the top-level `model = "…"`
 * and `model_reasoning_effort = "…"` lines of `config.toml`, by regex and nothing more: no TOML
 * parser, no table below the first `[header]` (profiles and MCP servers live there), and a
 * missing or unreadable file is the fallback. Everything else in the file stays unread.
 */
export async function codexModelSettings(store: CodexStore): Promise<CodexModelSettings> {
  const settings: CodexModelSettings = {
    model: CODEX_DEFAULT_MODEL,
    reasoningEffort: CODEX_DEFAULT_REASONING_EFFORT,
    approvalPolicy: CODEX_DEFAULT_APPROVAL_POLICY,
    sandboxMode: CODEX_DEFAULT_SANDBOX_MODE,
  };
  let text: string;
  try {
    text = await readFile(store.config, "utf8");
  } catch {
    return settings;
  }
  const firstTable = /^[ \t]*\[/m.exec(text);
  const top = firstTable ? text.slice(0, firstTable.index) : text;
  const line = (key: string) => new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*"([^"\\n]+)"`, "m").exec(top)?.[1]?.trim();
  const model = line("model");
  const effort = line("model_reasoning_effort");
  const approval = line("approval_policy");
  const sandbox = line("sandbox_mode");
  if (model) settings.model = model;
  if (effort) settings.reasoningEffort = effort;
  if (approval) settings.approvalPolicy = approval;
  if (sandbox) settings.sandboxMode = sandbox;
  return settings;
}

/** The thread id in a rollout file name, or nothing when the name is not one. */
export function codexIdFromName(name: string): string | undefined {
  const match = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f-]{36})(?:_[0-9a-f-]{36})?\.jsonl$/i.exec(
    name,
  );
  return match?.[1];
}
