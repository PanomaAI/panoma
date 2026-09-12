/**
 * `handoff()`: one conversation, one target, one tier, one new file.
 *
 * The refusals come before any write: a target with no store here, a folder the target would
 * not find, the same store the source lives in at `full` (a second whole copy in the same
 * history helps no one), nothing to carry, a source past the size ceiling. Then the tier
 * decides what travels and the target's writer decides where. For a document-only target, or
 * the `brief` tier, the result is a Markdown file and no resume.
 *
 * The same agent at `compact` is a target like any other: a shorter file in the same store —
 * the digest and the newest turns — which is what the person resumes after signing in with
 * another account when the whole conversation is what hit the limit. Nothing is written over
 * the original; the copy has its own id.
 *
 * `targetHome` is the CLI's second-folder case — another `CLAUDE_CONFIG_DIR`, another
 * `CODEX_HOME` — and must already contain the store: this package never creates a tree. The
 * default home only needs the agent's own folder to exist; the day folders under it are made.
 *
 * `checkHandoff()` is the same refusals and nothing after them: a door that pays for something
 * before it writes — the model digest of `POST /api/handoff` — asks it first, so a request the
 * engine would refuse costs nothing. Both run `prepare()`, which is what keeps them from ever
 * disagreeing about what is refused. Since 12-Sep-2026.
 */
import { realpath, stat } from "node:fs/promises";
import { panomaPath } from "@panoma/core";
import { compactConversation } from "./compact";
import { digestConversation } from "./digest";
import { HandoffFault } from "./faults";
import { fidelityOf, isNativeTarget } from "./fidelity";
import { cryptoRandom } from "./ids";
import { claudeStore, claudeStoreAt, claudeStoreExists } from "./stores/claude";
import { codexStore, codexStoreAt, codexStoreExists } from "./stores/codex";
import { geminiStore, geminiStoreAt, geminiStoreExists } from "./stores/gemini";
import { opencodeStore, opencodeStoreAt, opencodeStoreExists } from "./stores/opencode";
import { exists, isAbsoluteOn, resolveStoreOptions } from "./stores/shared";
import {
  KEEP_TURNS_DEFAULT,
  MAX_CONVERSATION_BYTES,
  isAgentId,
  type AgentId,
  type Conversation,
  type Digest,
  type HandoffInput,
  type StoreOptions,
  type Tier,
  type WriteResult,
} from "./types";
import { briefMarkdown, writeBrief } from "./writers/brief";
import { writeClaudeConversation } from "./writers/claude";
import { writeCodexConversation } from "./writers/codex";
import { writeGeminiConversation } from "./writers/gemini";
import { writeOpencodeConversation } from "./writers/opencode";
import { Redactor, type WriteRequest } from "./writers/shared";

export async function handoff(input: HandoffInput): Promise<WriteResult> {
  const plan = await prepare(input);
  if (plan.kind === "document") return writeDocument(input, plan.digest, plan.now, plan.keepTurns);

  switch (plan.target) {
    case "claude-cli":
      return writeClaudeConversation(plan.request);
    case "codex-cli":
      return writeCodexConversation(plan.request);
    case "opencode":
      return writeOpencodeConversation(plan.request);
    case "gemini-cli":
      return writeGeminiConversation(plan.request);
    default:
      throw new HandoffFault("unsupported-target", plan.target);
  }
}

/**
 * The refusals `handoff()` would raise for this input, in its order, and no file: the same
 * `prepare()`, thrown away. `now`, `random` and `out` are accepted and unused, so a caller can
 * pass the very input it will write with.
 */
export async function checkHandoff(input: HandoffInput): Promise<void> {
  await prepare(input);
}

/** What `handoff()` decided before writing: a document, or the request one native writer takes. */
type Plan =
  | { kind: "document"; digest: Digest; now: Date; keepTurns: number }
  | { kind: "native"; target: AgentId; request: WriteRequest };

/**
 * Every refusal, then the plan. Reading only: the target's store root is looked up, the folder
 * is stat'ed, the `compact` tier is composed to know whether anything would travel — and nothing
 * is written, which is what lets `checkHandoff()` share it.
 */
async function prepare(input: HandoffInput): Promise<Plan> {
  const options = input.options ?? {};
  const resolved = resolveStoreOptions(options);
  const { conversation, target, tier } = input;
  if (!isAgentId(target)) throw new HandoffFault("unsupported-target", String(target));
  if (conversation.bytes > MAX_CONVERSATION_BYTES) throw new HandoffFault("too-large", String(conversation.bytes));
  const now = input.now ?? new Date();
  const random = input.random ?? cryptoRandom;
  const keepTurns = Math.max(1, Math.floor(input.keepTurns ?? KEEP_TURNS_DEFAULT));
  const digest = input.digest ?? digestConversation(conversation);

  if (!isNativeTarget(target) || tier === "brief") {
    return { kind: "document", digest, now, keepTurns };
  }

  if (target === conversation.agent && tier === "full" && !input.targetHome) throw new HandoffFault("same-store", target);
  const root = await resolveRoot(target, input.targetHome, options, conversation, tier);
  const cwd = input.cwd ?? conversation.cwd;
  if (!cwd) throw new HandoffFault("cwd-missing");
  const folder = await stat(cwd).catch(() => undefined);
  if (!folder?.isDirectory()) throw new HandoffFault("cwd-missing", cwd);

  const tiered = tier === "compact" ? compactConversation(conversation, digest, { keepTurns }) : conversation;
  if (!carriesAnything(tiered)) throw new HandoffFault("nothing-to-carry");

  const request: WriteRequest = {
    conversation: tiered,
    tier,
    root,
    cwd,
    title: digest.title,
    now,
    random,
    platform: resolved.platform,
    surface: input.surface ?? "cli",
  };
  const branch = input.gitBranch ?? conversation.gitBranch;
  if (branch) request.gitBranch = branch;
  return { kind: "native", target, request };
}

function carriesAnything(conversation: Conversation): boolean {
  return conversation.turns.some((turn) =>
    turn.parts.some((part) => (part.kind === "tool_call" ? true : part.kind === "tool_result" ? part.output.length > 0 : part.text.trim().length > 0)),
  );
}

/**
 * The store root the writer gets: the named second home, checked, or the agent's own. A second
 * home that resolves to the source's own store is the same-store case again, refused at `full`
 * like the bare one.
 */
async function resolveRoot(
  target: AgentId,
  targetHome: string | undefined,
  options: StoreOptions,
  conversation: Conversation,
  tier: Tier,
): Promise<string> {
  const resolved = resolveStoreOptions(options);
  if (targetHome !== undefined) {
    if (!isAbsoluteOn(targetHome, resolved.platform)) throw new HandoffFault("target-store-missing", "must be absolute");
    const store = storeAt(target, targetHome, options);
    if (!store.exists) throw new HandoffFault("target-store-missing", targetHome);
    if (target === conversation.agent && tier === "full") {
      const own = defaultRoot(target, options);
      const [a, b] = await Promise.all([realpath(targetHome).catch(() => targetHome), realpath(own).catch(() => own)]);
      if (a === b) throw new HandoffFault("same-store", targetHome);
    }
    return targetHome;
  }
  const root = defaultRoot(target, options);
  if (!exists(root)) throw new HandoffFault("target-store-missing", root);
  return root;
}

function defaultRoot(target: AgentId, options: StoreOptions): string {
  switch (target) {
    case "claude-cli":
      return claudeStore(options).root;
    case "codex-cli":
      return codexStore(options).root;
    case "opencode":
      return opencodeStore(options).root;
    case "gemini-cli":
      return geminiStore(options).root;
    default:
      throw new HandoffFault("unsupported-target", target);
  }
}

function storeAt(target: AgentId, root: string, options: StoreOptions): { exists: boolean } {
  switch (target) {
    case "claude-cli":
      return { exists: claudeStoreExists(claudeStoreAt(root, options)) };
    case "codex-cli":
      return { exists: codexStoreExists(codexStoreAt(root, options)) };
    case "opencode":
      return { exists: opencodeStoreExists(opencodeStoreAt(root, options)) };
    case "gemini-cli":
      return { exists: geminiStoreExists(geminiStoreAt(root, options)) };
    default:
      throw new HandoffFault("unsupported-target", target);
  }
}

/** The `brief` tier, or any document-only target: a Markdown file, no resume. */
async function writeDocument(input: HandoffInput, digest: Digest, now: Date, keepTurns: number): Promise<WriteResult> {
  const { conversation, target } = input;
  const redactor = new Redactor();
  const markdown = briefMarkdown(conversation, digest, { keepTurns, now, redactor });
  // A document has no session; the receipt gets a stable name in the id's place.
  const stem = `${conversation.agent}-${conversation.handle}-${now.toISOString().slice(0, 10)}`;
  const path = input.out ?? panomaPath("handoff", `${stem}.md`);
  const bytes = await writeBrief(path, markdown);
  return {
    agent: target,
    surface: input.surface ?? "cli",
    sessionId: stem,
    path,
    resume: undefined,
    resumeInApp: undefined,
    steps: [],
    fidelity: fidelityOf(target),
    provenance: {
      sourceAgent: conversation.agent,
      sourceSessionId: conversation.sessionId,
      sourceHash: conversation.hash,
      tier: "brief",
      at: now.toISOString(),
      by: "panoma",
    },
    turns: Math.min(keepTurns, conversation.turns.length),
    bytes,
    dropped: { ...conversation.dropped, secrets: conversation.dropped.secrets + redactor.count },
  };
}
