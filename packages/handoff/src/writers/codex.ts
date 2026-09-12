/**
 * A conversation written where Codex CLI's own resume finds it.
 *
 * Verified on 0.153.0 (11-Sep-2026) with `codex exec resume` on a hand-written five-line
 * file: `session_meta` first, then `response_item` messages. No SQLite is written — Codex
 * read-repairs its `threads` row on first listing or resume. `event_msg` `user_message` and
 * `agent_message` go beside each message or the picker shows no preview and titles the thread
 * with the next prompt. `history_mode` is omitted (legacy) so no `ordinal` is needed. Tool
 * activity becomes bracketed text notes, exactly what Codex's own importer of Claude sessions
 * does; reasoning cannot be produced. The name goes to `session_index.jsonl`, appended.
 *
 * The last line is one `event_msg` of type `thread_settings_applied`. The CLI ignores it; the
 * Codex desktop app (verified on 11-Sep-2026 with nine probes against the app-server bundled in
 * ChatGPT.app, 0.154.0-alpha.6) renders a rollout's transcript and lists it only when the file
 * carries one, whatever else the file looks like. It is written for every target surface, so
 * the same file opens in both. Its model and effort are the person's own from `config.toml`,
 * with the store's fallback when the file names neither. `originator` stays `panoma` and
 * `source` stays `cli`: the app lists and renders them as they are, and the value lets both
 * surfaces label the row as handed off.
 */
import { appendFile } from "node:fs/promises";
import { textOfPart } from "../notes";
import { codexModelSettings, codexRolloutPath, codexStoreAt } from "../stores/codex";
import type { Turn, WriteResult } from "../types";
import { Redactor, clock, resultOf, withProvenance, writeAtomic, type WriteRequest } from "./shared";

/** What the `session_meta` says wrote the file. */
export const CODEX_ORIGINATOR = "panoma";
export const CODEX_CLI_VERSION = "0.0.0-panoma";

export async function writeCodexConversation(request: WriteRequest): Promise<WriteResult> {
  const { conversation, cwd, gitBranch, random, now, platform, title } = request;
  const store = codexStoreAt(request.root, { home: request.root, env: {}, platform });
  const sessionId = random.uuid();
  const path = codexRolloutPath(store, now, sessionId);
  const dir = store.resolved.path.dirname(path);
  const redactor = new Redactor();
  const turns = withProvenance(conversation.turns, request);
  const tick = clock(now);
  const lines: Record<string, unknown>[] = [];

  const meta: Record<string, unknown> = {
    session_id: sessionId,
    id: sessionId,
    timestamp: now.toISOString(),
    cwd,
    originator: CODEX_ORIGINATOR,
    cli_version: CODEX_CLI_VERSION,
    source: "cli",
  };
  if (gitBranch) meta["git"] = { branch: gitBranch };
  lines.push({ timestamp: now.toISOString(), type: "session_meta", payload: meta });

  for (const turn of turns) {
    const at = turn.at ?? tick().toISOString();
    const texts = turn.parts.map((part) => redactor.text(textOfPart(part))).filter((t) => t.length > 0);
    if (texts.length === 0) continue;
    const message = turn.role === "user"
      ? { type: "message", role: "user", content: texts.map((text) => ({ type: "input_text", text })) }
      : { type: "message", role: "assistant", content: texts.map((text) => ({ type: "output_text", text })) };
    lines.push({ timestamp: at, type: "response_item", payload: message });
    lines.push({
      timestamp: at,
      type: "event_msg",
      payload: { type: turn.role === "user" ? "user_message" : "agent_message", message: texts.join("\n\n") },
    });
  }

  lines.push(threadSettingsApplied(sessionId, cwd, await codexModelSettings(store), tick().toISOString()));

  const content = `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
  const bytes = await writeAtomic(path, content, dir, sessionId);

  const shownTitle = title ?? conversation.title;
  if (shownTitle) {
    const entry = { id: sessionId, thread_name: redactor.text(shownTitle), updated_at: now.toISOString() };
    try {
      await appendFile(store.index, `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      // The rollout is already in place and resumes by id; a name is a convenience.
    }
  }

  return resultOf("codex-cli", request, sessionId, path, countWritten(turns), bytes, redactor);
}

/**
 * The settings snapshot the app needs at the tail, with the fields its protocol marks required:
 * `model`, `model_provider_id`, `approval_policy`, `approvals_reviewer`, `permission_profile`,
 * an absolute `cwd` and `collaboration_mode`. The model, the effort, the approval policy and the
 * sandbox come from the person's own `config.toml` (`codexModelSettings`), with Codex's own
 * defaults where the file says nothing; `approvals_reviewer: "user"` is what every thread on
 * disk carries. Until 12-Sep-2026 the policy and the profile were fixed at `never` and
 * `disabled` — the values the threads of the machine this was verified on carried, because its
 * config says so — which stamped the loosest policy Codex has onto a copy on any disk, whatever
 * that person's config asked. The app shows the model and effort in its picker, where the
 * person changes them. Nothing here is executed by anyone.
 */
export function threadSettingsApplied(
  sessionId: string,
  cwd: string,
  settings: { model: string; reasoningEffort: string; approvalPolicy: string; sandboxMode: string },
  at: string,
): Record<string, unknown> {
  const { model, reasoningEffort, approvalPolicy, sandboxMode } = settings;
  return {
    timestamp: at,
    type: "event_msg",
    payload: {
      type: "thread_settings_applied",
      thread_id: sessionId,
      thread_settings: {
        model,
        model_provider_id: "openai",
        approval_policy: approvalPolicy,
        approvals_reviewer: "user",
        permission_profile: permissionProfile(sandboxMode, cwd),
        cwd,
        reasoning_effort: reasoningEffort,
        collaboration_mode: { mode: "default", settings: { model, reasoning_effort: reasoningEffort, developer_instructions: null } },
      },
    },
  };
}

/**
 * The profile Codex itself writes for a sandbox mode, read off the threads on disk (0.153.0):
 * `danger-full-access` is `{type: "disabled"}`; the two sandboxed modes are a managed profile
 * whose file system lists the root as readable, the thread's folder as writable — not under
 * `read-only` — and the two temporary folders as writable. Codex adds entries of its own to
 * that list (the `.git` folder, its visualizations folder) and re-derives the profile from the
 * config when the thread runs; what matters here is that a copy never says more than the
 * person's config allows.
 */
function permissionProfile(sandboxMode: string, cwd: string): Record<string, unknown> {
  if (sandboxMode === "danger-full-access") return { type: "disabled" };
  const entries: Record<string, unknown>[] = [{ path: { type: "special", value: { kind: "root" } }, access: "read" }];
  if (sandboxMode !== "read-only") entries.push({ path: { type: "path", path: cwd }, access: "write" });
  entries.push(
    { path: { type: "special", value: { kind: "slash_tmp" } }, access: "write" },
    { path: { type: "special", value: { kind: "tmpdir" } }, access: "write" },
  );
  return { type: "managed", file_system: { type: "restricted", entries } };
}

function countWritten(turns: readonly Turn[]): number {
  return turns.filter((turn) => turn.parts.some((part) => textOfPart(part).length > 0)).length;
}
