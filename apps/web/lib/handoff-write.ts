import { readFile } from "node:fs/promises";
import { redactSecrets } from "@panoma/core";
import { listProjectRoots, recordHandoff, type Database, type HandoffRow } from "@panoma/db";
import { NO_PROJECT } from "./agent-channel";
import {
  agentFromWord,
  agentOfApp,
  briefMarkdown,
  compactConversation,
  estimateTokens,
  handoff,
  insideFolder,
  isAgentId,
  isNativeTarget,
  isSessionIdOf,
  isSurface,
  newestOfFolder,
  readConversation,
  realFolder,
  splitConversationId,
  textOfTurns,
  type AgentId,
  type Conversation,
  type ConversationRef,
  type Digest,
  type Discovery,
  type LimitHit,
  type Surface,
  type Tier,
  type WriteResult,
} from "@panoma/handoff";
import { HandoffFault, type HandoffFaultCode } from "@panoma/handoff/faults";
import { revalidatePath } from "next/cache";
import { discoverCached, forgetDiscovery, storeOptions } from "./handoff-cache";
import { planDigest } from "./handoff-digest";
import { projectOnDisk } from "./handoff-http";

/*
  What a handoff over HTTP does between the guards and the answer, shared by the two doors that
  write one: `POST /api/handoff`, which a person opens from the screen, and
  `POST /api/agent/handoff`, which an agent opens through the MCP channel. The preview
  (`GET /api/handoff/[id]`) and the channel's list (`POST /api/agent/conversations`) take their
  reading half from here too.

  The pieces are the ones both doors would otherwise copy: reading a target word, checking an
  id, listing what discovery knows over the catalog's folders, opening one conversation and
  finding its project, picking the newest conversation of a project when none was named, the
  same-store refusal, and the write itself — the file, the receipt, the revalidation. Every
  function here throws a `HandoffFault` and answers plain data; what a refusal looks like on the
  wire (`handoffHttpError`), and in which language, is the route's decision. Nothing here starts a
  process: the one the family runs, `opencode import`, stays in the operator route, which is the
  file `guard.test.ts` sweeps for it.

  ── Why the discovery is asked with the same folders from every door ─────────────────────────
  `discoverCached` remembers a listing for thirty seconds, keyed by the folders it was asked
  with. The five operator routes ask with the catalog roots plus the server's cwd, so that one
  visit to the screen costs one listing; `catalogCwds` is that set, and the agent channel asks
  with it too. The channel adds the project's root as `cwd`: its answer is that folder's
  conversations, chosen before the cap of forty per store, remembered under its own key beside
  the disk-wide listing. Until 12-Sep-2026 the channel filtered the disk-wide listing instead,
  and a project whose files were not among the newest forty of a store was answered as having
  none — an absence the formatter then asserted.

  ── Why the guard sweep names this file ──────────────────────────────────────────────────────
  `guard.test.ts` looks for `discoverCached` and `readConversation` in every route to demand the
  operator key of whoever opens the agents' private history. With those calls moved here, a route
  reads the history by calling `discoverForCatalog`, `openConversation` or `writeHandoff`, and
  the sweep names those three too. Renaming one without renaming it there blinds the test.
 */

/** The rule is the engine's since 12-Sep-2026, shared with `panoma handoff`; re-exported for the tests that measure it here. */
export { SAME_HOUR_MS } from "@panoma/handoff";

/** A catalog project as `listProjectRoots` lists it; defined beside `projectAt` in `agent-channel.ts`. */
import type { CatalogProject } from "./agent-channel";
export type { CatalogProject };

/* ── Reading what a body says ───────────────────────────────────────────────────────────── */

export interface TargetOnSurface {
  target: AgentId;
  surface: Surface;
}

/**
 * The target word and its surface, the same words the terminal takes after `--to`: an agent
 * word (`codex`, `codex-cli`) with `surface` beside it, or an app word (`codex-app`) that means
 * the agent on its `app` surface. An app word with `surface: "cli"` contradicts itself and is
 * refused; a surface that is not one is refused; an unknown word is refused.
 */
export function targetOf(word: unknown, surface?: unknown): TargetOnSurface | undefined {
  if (typeof word !== "string") return undefined;
  if (surface !== undefined && (typeof surface !== "string" || !isSurface(surface))) return undefined;
  const app = agentOfApp(word);
  const target = app ?? agentFromWord(word);
  if (!target) return undefined;
  if (app && surface === "cli") return undefined;
  return { target, surface: app ? "app" : (surface ?? "cli") };
}

/** With `compact`: how many of the newest turns travel whole. A positive integer, or nothing. */
export function isKeepTurns(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1;
}

/** `agent:sessionId` with the id in that agent's own shape, or `invalid-id`. */
export function checkId(id: string): void {
  const split = splitConversationId(id);
  if (!split || !isAgentId(split.agent) || !isSessionIdOf(split.agent, split.sessionId)) {
    throw new HandoffFault("invalid-id", id.slice(0, 80));
  }
}

/* ── The catalog and its discovery ──────────────────────────────────────────────────────── */

/** The catalog roots and the server's cwd: the folders every door asks discovery with. */
export function catalogCwds(roots: readonly { root: string }[]): string[] {
  return [...roots.map((entry) => entry.root), process.cwd()];
}

export interface Catalog {
  roots: CatalogProject[];
  cwds: string[];
  discovery: Discovery;
}

/**
 * The catalog's projects and the discovery over their folders, from the cache when it is fresh.
 * With `cwd`, the discovery is that folder's alone — its conversations chosen before the cap —
 * and `inProject` on the result is still the last word, resolving both sides on disk.
 */
export async function discoverForCatalog(database: Database, options: { fresh?: boolean; cwd?: string } = {}): Promise<Catalog> {
  const roots = await listProjectRoots(database);
  const cwds = catalogCwds(roots);
  const discovery = await discoverCached({
    cwds,
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.fresh ? { fresh: true } : {}),
  });
  return { roots, cwds, discovery };
}

/* `projectAt` — the project the location names — is in `agent-channel.ts` since 12-Sep-2026. */
export { projectAt } from "./agent-channel";

/* ── One conversation ───────────────────────────────────────────────────────────────────── */

/**
 * The listed row a client named by id — checked for shape first, then found among the rows the
 * caller may see — or the fault that says which of the two failed. Every door checks the shape
 * with `checkId` before it asks discovery, so a malformed id never pays a cold listing; the check
 * is repeated here so the function is safe on its own. A route that lists a project's
 * conversations passes those alone, so an id from another project is not found rather than read.
 */
export function findConversation(refs: readonly ConversationRef[], id: string): ConversationRef {
  checkId(id);
  const ref = refs.find((entry) => entry.id === id);
  if (!ref) throw new HandoffFault("conversation-not-found", id);
  return ref;
}

export interface Opened {
  ref: ConversationRef;
  conversation: Conversation;
  /** The catalog project whose root contains the conversation's folder, when one does. */
  project: CatalogProject | undefined;
  /** The folder the target resumes in: the project's root, else the conversation's own. */
  cwd: string;
}

/** The conversation whole, with the project it belongs to and the folder its copy will name. */
export async function openConversation(catalog: Catalog, ref: ConversationRef): Promise<Opened> {
  const conversation = await readConversation(ref, storeOptions(), { cwds: catalog.cwds });
  const project = await projectOnDisk(conversation.cwd, catalog.roots);
  return { ref, conversation, project, cwd: project?.root ?? conversation.cwd };
}

/**
 * The conversations kept for one project: those whose folder is the root or lies inside it,
 * both sides resolved on disk by the engine's `realFolder` — the agent that wrote the
 * transcript and the catalog may spell `/var` and `/private/var` differently, or on Windows an
 * 8.3 alias and the long name — and one row per id. Discovery already lists one row per id
 * (Codex's listing keeps the newest of a thread's two rollouts); this keeps it so if a store
 * ever answers twice, the first row winning. Discovery lists newest first, and that order is
 * kept.
 */
export async function inProject(refs: readonly ConversationRef[], root: string): Promise<ConversationRef[]> {
  const folder = await realFolder(root);
  const kept = new Map<string, ConversationRef>();
  for (const ref of refs) {
    if (!ref.cwd || kept.has(ref.id)) continue;
    if (insideFolder(await realFolder(ref.cwd), folder)) kept.set(ref.id, ref);
  }
  return [...kept.values()];
}

/**
 * The conversation a caller means when it names none: the newest in the folder. Two agents within
 * the same hour is not a choice made here — the person was in both, and the wrong one handed over
 * is the one they were not looking at — so the fault names both ids for the next call to be exact.
 * The rule is the engine's `newestOfFolder`, the same one `panoma handoff` reads.
 */
export function newestOf(refs: readonly ConversationRef[]): ConversationRef {
  const { newest, rival } = newestOfFolder(refs);
  if (!newest) throw new HandoffFault("conversation-not-found", "no conversation kept for this project");
  if (rival) throw new HandoffFault("ambiguous-id", `${newest.id}, ${rival.id}`);
  return newest;
}

/**
 * The same agent as the source: the app and the CLI share one store, so a whole copy would sit
 * next to the original in the same folder. The operator door refuses that at `full` only — at
 * `compact` a shorter copy in the same store is what the person resumes after signing in again,
 * when the whole conversation is what hit the limit. The agent channel refuses it at every tier:
 * the steps that make a same-agent copy useful are a person's to run, and the channel has no
 * door for them.
 */
export function refuseSameStore(conversation: Pick<Conversation, "agent">, target: AgentId, tier: Tier, rule: "full-only" | "any-tier"): void {
  if (target !== conversation.agent) return;
  if (rule === "any-tier" || tier === "full") throw new HandoffFault("same-store", target);
}

/* ── What an answer carries ─────────────────────────────────────────────────────────────── */

/** A row as the channel shows it: `ConversationRow` on the MCP side, field for field. */
export interface PublicRef {
  id: string;
  handle: string;
  agent: AgentId;
  surface: Surface;
  title: string | null;
  updatedAt: string;
  turnCount: number | null;
  bytes: number;
  compacted: boolean;
  limit?: LimitHit;
}

/**
 * The row as a client that did not list the disk may see it: named fields, never the spread of
 * the discovery row. No file path of this disk — neither the transcript's nor the folder the
 * conversation ran in: the id names it, and the server knows where the file is — and the title
 * through the redactor, because a title the person did not set is the first prompt, and a first
 * prompt can carry a pasted key. The receipt keeps the same rule: `recordHandoff` redacts the
 * title it stores.
 */
export function publicRef(ref: ConversationRef): PublicRef {
  return {
    id: ref.id,
    handle: ref.handle,
    agent: ref.agent,
    surface: ref.surface ?? "cli",
    title: ref.title === undefined ? null : redactSecrets(ref.title),
    updatedAt: ref.updatedAt,
    turnCount: ref.turnCount,
    bytes: ref.bytes,
    compacted: ref.compacted,
    ...(ref.limit !== undefined ? { limit: ref.limit } : {}),
  };
}

/** The size line of a preview: turns, bytes and the digest's token estimate. */
export function sizeOf(conversation: Conversation, digest: Digest): { turns: number; bytes: number; estimatedTokens: number } {
  return { turns: conversation.turns.length, bytes: conversation.bytes, estimatedTokens: digest.stats.estimatedTokens };
}

/** What each tier would carry, measured before anything is written. */
export interface TierSizes {
  full: { turns: number; estimatedTokens: number };
  compact: { turns: number; estimatedTokens: number };
  brief: { estimatedTokens: number };
}

/**
 * The three tiers sized on the same conversation, pure, with the engine's own measure: `full`
 * is the transcript as it is, `compact` is what `compactConversation` would write with this
 * `keepTurns` — the digest as a summary turn plus the newest turns — and `brief` is the
 * Markdown `briefMarkdown` would write, all counted by `estimateTokens` over `textOfTurns`, the
 * rule behind `stats.estimatedTokens`, so `full.estimatedTokens` is the digest's own figure and
 * the three can be compared. Computed once per preview; the panel and the channel's dry run
 * paint from it, so the person chooses a tier with the figures in front of them.
 */
export function tierSizes(conversation: Conversation, digest: Digest, keepTurns?: number): TierSizes {
  const options = keepTurns !== undefined ? { keepTurns } : {};
  const compact = compactConversation(conversation, digest, options);
  return {
    full: { turns: conversation.turns.length, estimatedTokens: estimateTokens(textOfTurns(conversation.turns)) },
    compact: { turns: compact.turns.length, estimatedTokens: estimateTokens(textOfTurns(compact.turns)) },
    brief: { estimatedTokens: estimateTokens(briefMarkdown(conversation, digest, options)) },
  };
}

/** The size, the sizes per tier and the model digest's cost: what both previews say, from one place. */
export interface PreviewSizes {
  size: { turns: number; bytes: number; estimatedTokens: number };
  sizes: TierSizes;
  /** What «Let a model write the digest» would spend: one call per window of `planDigest`. */
  modelDigest: { calls: number };
}

/**
 * The figures the two previews share — the operator's `GET /api/handoff/[id]` and the channel's
 * dry run — assembled once so the two doors cannot drift: the source's size line, the three
 * tiers sized, and the calls the model digest would take. Nothing here pays or writes.
 */
export function previewSizes(conversation: Conversation, digest: Digest, keepTurns?: number): PreviewSizes {
  return {
    size: sizeOf(conversation, digest),
    sizes: tierSizes(conversation, digest, keepTurns),
    modelDigest: { calls: planDigest(conversation, digest).calls },
  };
}

/**
 * The digest with every string field passed through the redactor. The mechanical digest quotes
 * the transcript — the goal, the decisions, the last exchange — and a transcript can carry a
 * pasted key; what a machine reads over the channel goes out covered, the same way the catalog
 * covers what an agent logs.
 */
export function redactDigest(digest: Digest): Digest {
  const cover = (list: string[]) => list.map(redactSecrets);
  return {
    ...digest,
    title: redactSecrets(digest.title),
    goal: redactSecrets(digest.goal),
    ...(digest.summary !== undefined ? { summary: redactSecrets(digest.summary) } : {}),
    decisions: cover(digest.decisions),
    filesTouched: cover(digest.filesTouched),
    commandsRun: cover(digest.commandsRun),
    openItems: cover(digest.openItems),
    lastExchange: {
      ...(digest.lastExchange.user !== undefined ? { user: redactSecrets(digest.lastExchange.user) } : {}),
      ...(digest.lastExchange.assistant !== undefined ? { assistant: redactSecrets(digest.lastExchange.assistant) } : {}),
    },
  };
}

/* ── The write ──────────────────────────────────────────────────────────────────────────── */

export interface WriteInput extends Opened {
  target: AgentId;
  surface: Surface;
  tier: Tier;
  digest: Digest;
  keepTurns?: number;
  /** The agent that asked over the MCP channel, by the name of its key; a person leaves it unset. */
  requestedBy?: string | null;
  /**
   * The route's own step between the file and the receipt, taken only for an OpenCode target
   * that is not a document: the operator route runs `opencode import` here through the binary
   * the detector verified, and answers the steps left for the person (none when it ran). Absent,
   * the engine's steps stay in the answer and nothing is started.
   */
  importer?: (result: WriteResult) => Promise<string[]>;
}

export interface Written {
  result: WriteResult;
  steps: string[];
  receipt: HandoffRow;
  /** The target's own resume finds the file; `false` for a document. */
  native: boolean;
  /** The brief itself, for a document-only target: the caller offers to copy it. */
  document?: string;
}

/**
 * The write, in the order every door keeps: the file into the target's store, the cache
 * forgotten so the next listing sees it, the route's import step when there is one, the receipt,
 * and the screens that show receipts revalidated. A step that fails leaves no receipt behind.
 */
export async function writeHandoff(database: Database, input: WriteInput): Promise<Written> {
  const result = await handoff({
    conversation: input.conversation,
    target: input.target,
    surface: input.surface,
    tier: input.tier,
    digest: input.digest,
    cwd: input.cwd,
    ...(input.keepTurns !== undefined ? { keepTurns: input.keepTurns } : {}),
    options: storeOptions(),
  });
  forgetDiscovery();

  let steps = result.steps;
  if (input.importer && input.target === "opencode" && input.tier !== "brief") {
    steps = await input.importer(result);
  }

  const native = isNativeTarget(input.target) && input.tier !== "brief";
  // An app target's line is the deep link; without one (no app, not a Mac) the CLI line stands.
  const resumeLine = input.surface === "app" ? (result.resumeInApp?.line ?? result.resume?.line) : result.resume?.line;
  const receipt = await recordHandoff(database, {
    projectId: input.project?.id ?? null,
    cwd: input.cwd,
    title: input.ref.title ?? null,
    sourceAgent: input.conversation.agent,
    sourceSessionId: input.conversation.sessionId,
    sourcePath: input.conversation.path,
    sourceHash: input.conversation.hash,
    targetAgent: input.target,
    targetSurface: input.surface,
    targetSessionId: result.sessionId,
    targetPath: result.path,
    tier: input.tier,
    turns: result.turns,
    bytes: result.bytes,
    dropped: result.dropped,
    resumeCommand: native ? (resumeLine ?? null) : null,
    requestedBy: input.requestedBy ?? null,
  });
  revalidatePath("/handoff");
  if (input.project) revalidatePath(`/p/${input.project.slug}`);

  // A document-only handoff answers with the document itself: the panel offers to copy it.
  const document = native ? undefined : await readFile(result.path, "utf8").catch(() => undefined);
  return { result, steps, receipt, native, ...(document !== undefined ? { document } : {}) };
}

/** `{ok, receipt, result}`: the body both doors answer after a write. */
export interface WrittenBody {
  ok: true;
  receipt: HandoffRow;
  result: {
    agent: AgentId;
    surface: Surface;
    sessionId: string;
    path: string;
    resume: WriteResult["resume"] | null;
    resumeInApp: WriteResult["resumeInApp"] | null;
    steps: string[];
    fidelity: WriteResult["fidelity"];
    dropped: WriteResult["dropped"];
    turns: number;
    bytes: number;
    digest: Digest;
    document?: string;
  };
}

/** The body both doors answer after a write, with the digest the caller wants shown. */
export function writtenBody(written: Written, digest: Digest): WrittenBody {
  const { result, native } = written;
  return {
    ok: true as const,
    receipt: written.receipt,
    result: {
      agent: result.agent,
      surface: result.surface,
      sessionId: result.sessionId,
      path: result.path,
      resume: native ? (result.resume ?? null) : null,
      resumeInApp: native ? (result.resumeInApp ?? null) : null,
      steps: written.steps,
      fidelity: result.fidelity,
      dropped: result.dropped,
      turns: result.turns,
      bytes: result.bytes,
      digest,
      ...(written.document !== undefined ? { document: written.document } : {}),
    },
  };
}

/* ── The agent channel's half ───────────────────────────────────────────────────────────── */

/*
  What `POST /api/agent/conversations` and `POST /api/agent/handoff` share with the video doors —
  the location an MCP client describes, the `no-store` header, the body refusal — is in
  `agent-channel.ts`; what only these two share is here: the refusals about the stores, and the
  receipt as the channel shows it. Data, not responses: each route wraps them with its status and
  the header, so that what a door answers stays in the door.
 */
export { NO_STORE, LOCATION_KEYS, locationOf, channelBodyRefusal, type Location } from "./agent-channel";

/** The refusals that are not the engine's, in fixed English: a machine reads no dictionary. */
export const CHANNEL_REFUSALS = {
  /** Under `DATABASE_URL`: the stores live on the catalog's disk, and that disk is another machine's. */
  remote: {
    error: "local-only",
    code: "local-only",
    detail: "The conversations live on the catalog's own disk, and this catalog is on another machine: nothing can be listed or handed from here.",
  },
  noProject: NO_PROJECT,
} as const;

/**
 * The next step beside a refusal the channel can meet, one sentence each, and only the step:
 * the fact behind the refusal is the formatter's sentence on the MCP side, so the hint does not
 * say it twice. The same-store sentence is the one place this channel names the person's own
 * doors, because that flow is not on the channel at all: what makes a same-agent copy useful is
 * the person's to do.
 */
export const CHANNEL_HINTS: Readonly<Partial<Record<HandoffFaultCode, string>>> = {
  "same-store":
    "To continue in the same agent with another account, the person uses the /handoff screen or panoma handoff: the steps there are theirs to run.",
  "ambiguous-id": "Name one of the two ids with id.",
  "conversation-not-found": "panoma_conversations lists the ids kept for this project.",
};

/** A receipt as the channel shows it: no path of this disk, dates as ISO, the agent that asked. */
export function receiptView(row: HandoffRow) {
  return {
    id: row.id,
    sourceAgent: row.sourceAgent,
    sourceSessionId: row.sourceSessionId,
    targetAgent: row.targetAgent,
    targetSurface: row.targetSurface,
    tier: row.tier,
    createdAt: row.createdAt.toISOString(),
    resumeCommand: row.resumeCommand,
    requestedBy: row.requestedBy,
  };
}
