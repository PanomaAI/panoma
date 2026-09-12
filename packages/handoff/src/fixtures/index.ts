/**
 * Test-only: lays the four fixture files out as the agents would under a temporary home.
 *
 * Not a tsup entry and not on the public index. The shapes were captured on 11-Sep-2026
 * against Claude Code 2.1.258, Codex CLI 0.153.0 and OpenCode 1.2.6, and from the gemini-cli
 * source; the texts are synthetic. Every test passes `home` and `env: {}`, so nothing here
 * can reach the real stores.
 *
 * Two shapes were added on 12-Sep-2026 from what the disk showed: the Gemini fixture carries
 * one message appended three times under its id, as the recorder writes it, and
 * `codex-compacted.jsonl` is a rollout cut by a `compacted` record whose `message` is empty
 * and whose replacement history closes with the encrypted `compaction` item.
 *
 * The first Windows run (12-Sep-2026) added two rules. A test that points a fixture at a folder
 * of this disk goes through `withCwd`, which spells the folder the way a JSON string does: a
 * bare `replaceAll` put `C:\Users\…` into the records and every line with a `cwd` stopped
 * parsing, so the conversation read back with no folder at all. And the OpenCode store is laid
 * where the engine looks for it on the platform that runs the test —`%LOCALAPPDATA%\opencode`
 * on Windows, `~/.local/share/opencode` elsewhere— which `opencodeRoot` answers.
 */
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { opencodeStore } from "../stores/opencode";
import type { Random } from "../types";

export const FIXTURE_CWD = "/Users/someone/dev/lemonade";
export const FIXTURE_CLAUDE_SLUG = "-Users-someone-dev-lemonade";
export const FIXTURE_CLAUDE_ID = "7b1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5e";
export const FIXTURE_CODEX_ID = "01a08fab-9c49-7bcd-9bf1-ffc0d78795a5";
export const FIXTURE_OPENCODE_ID = "ses_3e45b2e7cffeLy7v1L0qDKNyMU";
export const FIXTURE_GEMINI_ID = "c013b946-ad37-4e51-828f-88250400147e";
export const FIXTURE_GEMINI_PROJECT = "ad6a8de343d58a1d60afd4a51f68d6829c3f5bcaefcb853dfa4e82aaf464a14f";

export function fixtureText(name: "claude.jsonl" | "codex.jsonl" | "codex-compacted.jsonl" | "opencode.json" | "gemini.jsonl"): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

/**
 * The fixture with `FIXTURE_CWD` replaced by `cwd` as a JSON string spells it. Every
 * occurrence in the five fixtures sits inside one JSON string, so a backslash of a Windows
 * folder must arrive doubled, and a bare `replaceAll` is the bug this helper exists for.
 */
export function withCwd(text: string, cwd: string): string {
  return text.replaceAll(FIXTURE_CWD, JSON.stringify(cwd).slice(1, -1));
}

/** Where the engine looks for OpenCode's data under `home` on the platform running the test. */
export function opencodeRoot(home: string): string {
  // An empty environment, cast because the web's route tests compile this module under Next's
  // global typing, where `NODE_ENV` is a required key of `ProcessEnv`.
  return opencodeStore({ home, env: {} as NodeJS.ProcessEnv }).root;
}

function put(path: string, text: string, stampSeconds?: number): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
  if (stampSeconds !== undefined) utimesSync(path, stampSeconds, stampSeconds);
  return path;
}

/** `<home>/.claude/projects/<slug>/<id>.jsonl`, plus an empty sidecar so the store looks lived in. */
export function layClaude(home: string, text = fixtureText("claude.jsonl"), id = FIXTURE_CLAUDE_ID): string {
  return put(join(home, ".claude", "projects", FIXTURE_CLAUDE_SLUG, `${id}.jsonl`), text);
}

/** `<home>/.codex/sessions/2026/09/11/rollout-…-<id>.jsonl`. */
export function layCodex(home: string, text = fixtureText("codex.jsonl"), id = FIXTURE_CODEX_ID): string {
  return put(join(home, ".codex", "sessions", "2026", "09", "11", `rollout-2026-09-11T13-51-53-${id}.jsonl`), text);
}

/** `<home>/.gemini/tmp/<sha256(cwd)>/chats/session-…-<id8>.jsonl`. */
export function layGemini(home: string, text = fixtureText("gemini.jsonl"), id = FIXTURE_GEMINI_ID): string {
  return put(join(home, ".gemini", "tmp", FIXTURE_GEMINI_PROJECT, "chats", `session-2026-09-11T14-00-${id.slice(0, 8)}.jsonl`), text);
}

interface Envelope {
  info: Record<string, unknown>;
  messages: { info: Record<string, unknown>; parts: Record<string, unknown>[] }[];
}

/** The legacy JSON store under `<opencodeRoot(home)>/storage/**`, from the envelope fixture. */
export function layOpencodeStorage(home: string, text = fixtureText("opencode.json")): string {
  const envelope = JSON.parse(text) as Envelope;
  const root = opencodeRoot(home);
  const storage = join(root, "storage");
  const id = envelope.info["id"] as string;
  const project = (envelope.info["projectID"] as string) ?? "global";
  put(join(storage, "session", project, `${id}.json`), JSON.stringify(envelope.info, null, 2));
  for (const message of envelope.messages) {
    const messageId = message.info["id"] as string;
    put(join(storage, "message", id, `${messageId}.json`), JSON.stringify(message.info, null, 2));
    for (const part of message.parts) {
      put(join(storage, "part", messageId, `${part["id"] as string}.json`), JSON.stringify(part, null, 2));
    }
  }
  return root;
}

/** The SQL that builds an `opencode.db` with the fixture inside, for a Node with `node:sqlite`. */
export function opencodeSql(text = fixtureText("opencode.json")): string[] {
  const envelope = JSON.parse(text) as Envelope;
  const q = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;
  const info = envelope.info;
  const time = info["time"] as { created: number; updated: number };
  const statements = [
    "CREATE TABLE project (id text PRIMARY KEY, worktree text NOT NULL, vcs text, name text, time_created integer NOT NULL, time_updated integer NOT NULL)",
    "CREATE TABLE session (id text PRIMARY KEY, project_id text NOT NULL, parent_id text, slug text NOT NULL, directory text NOT NULL, title text NOT NULL, version text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL)",
    "CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)",
    "CREATE TABLE part (id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)",
    `INSERT INTO project VALUES ('global', '/', NULL, NULL, ${time.created}, ${time.updated})`,
    `INSERT INTO session VALUES (${q(info["id"])}, 'global', NULL, ${q(info["slug"])}, ${q(info["directory"])}, ${q(info["title"])}, ${q(info["version"])}, ${time.created}, ${time.updated})`,
  ];
  for (const message of envelope.messages) {
    const { id, sessionID, ...data } = message.info;
    const created = (data["time"] as { created: number }).created;
    statements.push(`INSERT INTO message VALUES (${q(id)}, ${q(sessionID)}, ${created}, ${created}, ${q(JSON.stringify(data))})`);
    for (const part of message.parts) {
      const { id: partId, sessionID: partSession, messageID, ...partData } = part;
      const start = (partData["time"] as { start?: number } | undefined)?.start ?? created;
      statements.push(
        `INSERT INTO part VALUES (${q(partId)}, ${q(messageID)}, ${q(partSession)}, ${start}, ${start}, ${q(JSON.stringify(partData))})`,
      );
    }
  }
  return statements;
}

/** Deterministic ids and hex, so a written file can be compared byte for byte. */
export function fixedRandom(seed = 1): Random {
  let n = seed;
  const hex = (bytes: number) => {
    let out = "";
    while (out.length < bytes * 2) {
      n = (n * 1103515245 + 12345) % 2147483648;
      out += n.toString(16).padStart(8, "0");
    }
    return out.slice(0, bytes * 2);
  };
  return {
    uuid: () => {
      const h = hex(16);
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    },
    hex,
  };
}

export const FIXED_NOW = new Date("2026-09-11T15:00:00.000Z");
