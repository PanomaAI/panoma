import { execFile } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import pc from "picocolors";
import { REDACTED, expandTilde, redactSecrets, resolveExecutable } from "@panoma/core";
import { detectCliAgents, providersByAuth } from "@panoma/ai";
import {
  AGENT_NAMES,
  AGENT_WORDS,
  APP_OF,
  APP_WORDS,
  SIGN_IN,
  SIGN_OUT,
  agentFromWord,
  agentOfApp,
  briefMarkdown,
  digestConversation,
  discoverConversations,
  fidelityOf,
  forkOf,
  fromBundle,
  handoff,
  insideFolder,
  isBundlePath,
  isNativeTarget,
  newestOfFolder,
  readConversation,
  resolveConversation,
  resumeInApp,
  resumeOf,
  toBundle,
  type AgentId,
  type Conversation,
  type ConversationRef,
  type Digest,
  type Discovery,
  type Dropped,
  type Part,
  type Random,
  type Resume,
  type ResumeInApp,
  type StoreOptions,
  type StoreReport,
  type Surface,
  type Tier,
  type Turn,
  type WriteResult,
} from "@panoma/handoff";
import type { Flags } from "./args";
import { catalogFetch } from "./catalog-fetch";
import { handoffFaultText, say } from "./messages";
import { unreachable } from "./server";
import { sinceMs } from "./today";

/*
  `panoma handoff` — a conversation continues in another agent, or in the same one after signing in.

  One grammar and no sub-verbs: `panoma handoff [source] [--to <agent>] …`. Bare, it lists what
  Claude Code, Codex, OpenCode and Gemini kept on this disk; with `--to`, it hands one over. The
  engine is `@panoma/handoff`, which reads the agents' own stores through a closed list of paths
  and writes one new file into the target's store, so the target's normal resume finds it. That is
  why the verb runs in this process, like `md` and `hooks`: the file it writes is the person's own,
  written with the person's permissions, and no API writes a user's files at a client's request.

  The catalog is asked only for the three things it alone has. The project roots, to group the
  list by project (and the list works without them). The model, when `--digest model` is asked:
  the catalog talks to the model and counts the spend under the `handoff` family, so a catalog
  that is down refuses that flag before anything is written. And the receipt afterwards —which
  conversation became which, at which tier, what was left behind— posted best effort: a catalog
  that is down or says no leaves the written file where it is and a dim line saying it was not
  recorded.

  Two doors never open here. The person's login: the same-agent case prints the sign-out and the
  sign-in commands of that agent and the resume line, and runs none of them; every store is per
  machine and folder, never per account, so the same file is there after the person signs in with
  the account they want to continue with. And the source transcript: it is read, never modified,
  and the copy says on its first line where it came from.

  The desktop apps are a surface, not another agent: `--to claude-app` and `--to codex-app` write
  the same file the CLI target gets, and only the door printed afterwards differs — the app's deep
  link, with the terminal line as the fallback. The same agent on the other surface (Claude Code →
  Claude (app), or a Codex app thread → `codex`) writes nothing at all: the app adopts the original
  through its link, the terminal resumes it by id, and this command prints the line and runs nothing.
 */

/** What a test injects: the stores under a temporary home, a fixed clock, and the import runner. */
export interface HandoffDeps {
  /** Where the agents' stores are; the engine refuses to guess under test. */
  store?: StoreOptions;
  /** The folder the person is in; `process.cwd()` otherwise. */
  cwd?: string;
  now?: Date;
  random?: Random;
  /** The installed CLI agents, for the OpenCode import step. */
  detect?: () => Promise<{ id: string; installed: boolean; command?: string }[]>;
  /** Runs the import step; rejects when it fails. */
  exec?: (file: string, args: string[], cwd: string) => Promise<void>;
}

/** `panoma handoff` puts the digest author on the wire as the catalog spells it. */
type DigestBy = "panoma" | "model";

/** A row of `GET /api/catalog`, the part the list uses. */
interface CatalogProject {
  slug: string;
  root: string;
}

const run = promisify(execFile);

/** The words `--to` accepts, in the order the help lists them: the agents, their apps, the portable file. */
const TARGET_WORDS = [...Object.keys(AGENT_WORDS), ...Object.keys(APP_WORDS), "bundle"];

/** The name a row or a receipt shows: the app's when the conversation, or the copy, lives on that surface. */
export function labelOf(ref: Pick<ConversationRef, "agent" | "surface">): string {
  return (ref.surface === "app" ? APP_OF[ref.agent]?.name : undefined) ?? AGENT_NAMES[ref.agent];
}

export async function handoffCommand(parsed: Flags, deps: HandoffDeps = {}): Promise<number> {
  const [, source, extra] = parsed.positionals;
  if (extra !== undefined) {
    process.stderr.write(
      pc.red(`${say("handoff.extraArgument", { extra })}\n`) + pc.dim(`${say("handoff.usage")}\n${say("handoff.usageHint")}\n`),
    );
    return 1;
  }

  const cwd = await realFolder(deps.cwd ?? process.cwd());
  const store = deps.store ?? {};
  const tier: Tier = (parsed.tier as Tier | undefined) ?? "full";
  const digestBy: DigestBy = (parsed.digest as DigestBy | undefined) ?? "panoma";
  const out = parsed.out ? resolve(expandTilde(parsed.out)) : undefined;

  /*
    The target is resolved before anything is read: a misspelled agent should cost a suggestion,
    not a discovery of every store on the disk first.
   */
  let target: AgentId | "bundle" | undefined;
  let surface: Surface = "cli";
  if (parsed.to !== undefined) {
    const word = parsed.to.trim().toLowerCase();
    const app = agentOfApp(word);
    if (word === "bundle") target = "bundle";
    else if (app !== undefined) {
      target = app;
      surface = "app";
    } else target = agentFromWord(word);
    if (target === undefined) {
      const guess = nearestWord(word);
      process.stderr.write(
        pc.red(`${say("handoff.unknownTarget", { target: parsed.to })}${guess ? `  ${say("error.didYouMean", { guess })}` : ""}\n`) +
          pc.dim(`${say("handoff.targets", { list: TARGET_WORDS.join(" · ") })}\n`),
      );
      return 1;
    }
  }

  // The bare verb, with nothing to hand: the list.
  if (source === undefined && target === undefined && tier !== "brief") {
    return list(parsed, cwd, store);
  }

  // The conversation, from a bundle file, a handle, or the folder the person is in.
  const loaded = await load(source, target === undefined || target === "bundle" ? "<agent>" : wordOf(target, surface), parsed, cwd, store);
  if (typeof loaded === "number") return loaded;
  const { conversation, taken } = loaded;
  let digest = loaded.digest;

  /*
    `--dry-run` stops before anything is spent, and a model digest is one call of the `handoff`
    family with its ledger row written before the answer is read; so the preview carries the
    mechanical digest and says so, and the model is asked only by the command that writes. Until
    12-Sep-2026 the dry run paid that call and then wrote nothing, the one thing the flag promises
    not to do.
   */
  if (digestBy === "model" && !parsed.dryRun) {
    const written = await modelDigest(parsed, conversation);
    if (typeof written === "number") return written;
    digest = written;
  } else {
    if (digestBy === "model" && !parsed.json) process.stderr.write(pc.dim(`${say("handoff.dryRunDigest")}\n`));
    digest ??= digestConversation(conversation);
  }

  const now = deps.now ?? new Date();

  // The portable file: the conversation and its digest, for another machine.
  if (target === "bundle") {
    // The bundle carries the conversation whole, whatever `--tier` said: the preview names that tier.
    if (parsed.dryRun) return preview(parsed, conversation, digest, "bundle", "full", out);
    const covered = coverBundle(conversation, digest);
    const bundle = toBundle(covered.conversation, covered.digest, now);
    const json = `${JSON.stringify(bundle, null, 2)}\n`;
    if (out) {
      // 0600 like every file the engine writes: the copy that leaves the agents' stores is still a transcript.
      await writeFile(out, json, { encoding: "utf8", mode: 0o600 });
      if (parsed.json) process.stdout.write(`${JSON.stringify({ ok: true, bundle: out, dropped: covered.conversation.dropped }, null, 2)}\n`);
      else process.stderr.write(pc.green(`✓ ${say("handoff.bundleWritten", { path: out })}\n`));
      return 0;
    }
    process.stdout.write(json);
    return 0;
  }

  // The document: the `brief` tier, or an agent that cannot resume a written conversation.
  const documentOnly = target !== undefined && !isNativeTarget(target);
  if (tier === "brief" || documentOnly) {
    if (documentOnly && !parsed.json) {
      process.stderr.write(pc.dim(`${say("handoff.documentOnly", { agent: AGENT_NAMES[target!] })}\n`));
    }
    // The write below forces `brief` on this branch; the preview names the tier the write would record.
    if (parsed.dryRun) return preview(parsed, conversation, digest, target, "brief");
    const options = { keepTurns: parsed.keep, now };
    if (out === undefined) {
      const markdown = briefMarkdown(conversation, digest, options);
      if (parsed.json) process.stdout.write(`${JSON.stringify({ ok: true, tier: "brief", document: markdown }, null, 2)}\n`);
      else process.stdout.write(markdown.endsWith("\n") ? markdown : `${markdown}\n`);
      return 0;
    }
    return write({ parsed, deps, conversation, digest, target: target ?? conversation.agent, surface, named: target !== undefined, tier: "brief", out, taken, cwd, store, now });
  }

  if (target === undefined) {
    // A handle without a destination: the preview, and the line that hands it.
    if (!parsed.json) process.stderr.write(pc.dim(`${say("handoff.hint", { handle: conversation.handle })}\n`));
    return preview(parsed, conversation, digest, undefined, tier);
  }

  if (target === conversation.agent && parsed.targetHome === undefined && tier === "full") {
    // The same agent, whichever surface, and no second home: nothing is written. The person signs
    // out, signs in with the account they want and resumes the original; both doors — the
    // terminal line and, on macOS, the app link — are printed under the resume step. At
    // `--tier compact` the same agent is written like any other target: a shorter copy in the
    // same store, and `write` prints the two account steps ahead of its resume line.
    // This comes before the dry run on purpose: a preview of what travels would describe a copy
    // that is never written, so `--dry-run` gets the real answer with a line saying why.
    if (parsed.dryRun && !parsed.json) process.stderr.write(pc.dim(`${say("handoff.dryRunSameAgent")}\n`));
    return sameAgent(parsed, conversation, cwd, store.platform);
  }

  if (parsed.dryRun) return preview(parsed, conversation, digest, target, tier);

  return write({ parsed, deps, conversation, digest, target, surface, named: true, tier, out, taken, cwd, store, now });
}

// ── The list ───────────────────────────────────────────────────────────────

async function list(parsed: Flags, cwd: string, store: StoreOptions): Promise<number> {
  const projects = await catalogProjects(parsed.api);
  const roots = projects === undefined ? [] : projects.map((project) => project.root);
  const discovery = await discover(store, { cwds: [cwd, ...roots] });
  if (typeof discovery === "number") return discovery;
  const now = new Date().toISOString();

  if (parsed.json) {
    process.stdout.write(`${JSON.stringify({ conversations: discovery.conversations, stores: discovery.stores, catalog: projects !== undefined }, null, 2)}\n`);
    return 0;
  }

  if (discovery.conversations.length === 0) {
    process.stdout.write(["", `  ${pc.yellow(say("handoff.emptyAll"))}`, ...storeLines(discovery.stores), "", `  ${pc.dim(say("handoff.storesHint"))}`, ""].join("\n"));
    return 0;
  }

  const lines: string[] = [""];
  const here = await inFolder(discovery.conversations, cwd, store.platform);
  const rest = discovery.conversations.filter((ref) => !here.includes(ref));
  if (here.length > 0) {
    lines.push(`  ${pc.bold(say("handoff.inFolder"))}`, ...rowLines(here, now), "");
  }

  if (projects === undefined) {
    if (rest.length > 0) lines.push(`  ${pc.bold(say("handoff.elsewhere"))}`, ...rowLines(rest, now), "");
    lines.push(`  ${pc.dim(say("handoff.catalogDown"))}`, "");
  } else {
    for (const group of groupByProject(rest, projects, store.platform)) {
      lines.push(`  ${pc.bold(group.slug ?? say("handoff.notInCatalog"))}`, ...rowLines(group.conversations, now), "");
    }
  }
  process.stdout.write(lines.join("\n"));
  return 0;
}

/** The catalog's projects, or nothing when it is down or says no: the list does not need it. */
async function catalogProjects(api: string): Promise<CatalogProject[] | undefined> {
  try {
    const reply = await catalogFetch(new URL("/api/catalog", api));
    if (!reply.ok) return undefined;
    const body = (await reply.json()) as { projects?: CatalogProject[] };
    return (body.projects ?? []).filter((project) => typeof project.root === "string" && typeof project.slug === "string");
  } catch {
    return undefined;
  }
}

/** Grouped under the deepest catalog root that contains the conversation's folder; the rest last. */
export function groupByProject(
  conversations: ConversationRef[],
  projects: CatalogProject[],
  platform?: NodeJS.Platform,
): { slug: string | undefined; conversations: ConversationRef[] }[] {
  const deepestFirst = [...projects].sort((a, b) => b.root.length - a.root.length);
  const groups = new Map<string | undefined, ConversationRef[]>();
  for (const ref of conversations) {
    const owner = deepestFirst.find((project) => insideFolder(ref.cwd, project.root, platform));
    const key = owner?.slug;
    const bucket = groups.get(key);
    if (bucket) bucket.push(ref);
    else groups.set(key, [ref]);
  }
  const named = [...groups.entries()].filter(([slug]) => slug !== undefined).sort(([a], [b]) => a!.localeCompare(b!));
  const orphans = groups.get(undefined);
  return [
    ...named.map(([slug, refs]) => ({ slug, conversations: refs })),
    ...(orphans ? [{ slug: undefined, conversations: orphans }] : []),
  ];
}

/** One row per conversation, and beneath a row that ended on a limit, the line that hands it. */
export function rowLines(refs: ConversationRef[], now: string): string[] {
  const lines: string[] = [];
  for (const ref of refs) {
    const when = sinceMs(ref.updatedAt, now) || ref.updatedAt.slice(0, 10);
    const facts =
      ref.turnCount === null
        ? say("handoff.rowSize", { when, size: size(ref.bytes) })
        : say("handoff.rowTurns", { when, n: ref.turnCount });
    const tags = [ref.compacted ? say("handoff.rowSummary") : "", limitWord(ref, now)].filter(Boolean);
    lines.push(
      `    ${pc.cyan(ref.handle.padEnd(10))}${pc.dim(labelOf(ref).padEnd(16))}${ref.title ?? pc.dim(ref.cwd)}`,
      `              ${pc.dim([facts, ...tags].join(" · "))}`,
    );
    if (ref.limit) {
      const target = ref.agent === "codex-cli" ? "claude" : "codex";
      lines.push(`              ${say("handoff.readyLine", { handle: ref.handle, target })}`);
    }
  }
  return lines;
}

/** The limit as a fact: before the reset, after it, or with no reset time known. */
function limitWord(ref: ConversationRef, now: string): string {
  if (!ref.limit) return "";
  if (!ref.limit.resetsAt) return say("handoff.rowLimit");
  const reset = Date.parse(ref.limit.resetsAt);
  if (!Number.isFinite(reset)) return say("handoff.rowLimit");
  if (reset > Date.parse(now)) {
    const minutes = Math.max(1, Math.round((reset - Date.parse(now)) / 60_000));
    const when = minutes < 60 ? say("handoff.inMinutes", { n: minutes }) : say("handoff.inHours", { n: Math.round(minutes / 60) });
    return say("handoff.rowLimitBack", { when });
  }
  return say("handoff.rowLimitLifted", { when: sinceMs(ref.limit.resetsAt, now) });
}

function storeLines(stores: StoreReport[]): string[] {
  return stores.map((report) =>
    `    ${pc.dim(
      report.found
        ? say("handoff.storeFound", { agent: AGENT_NAMES[report.agent], path: report.path, n: report.conversations })
        : say("handoff.storeMissing", { agent: AGENT_NAMES[report.agent], path: report.path }),
    )}`,
  );
}

// ── The source ─────────────────────────────────────────────────────────────

interface Loaded {
  conversation: Conversation;
  /** The bundle brings its digest along; a store does not. */
  digest?: Digest;
  /** The dim line that says which conversation was taken when none was named. */
  taken?: string;
}

async function load(
  source: string | undefined,
  /** The `--to` word as the person would type it, for the lines that name a candidate. */
  targetWord: string,
  parsed: Flags,
  cwd: string,
  store: StoreOptions,
): Promise<Loaded | number> {
  if (source !== undefined && isBundlePath(source)) {
    try {
      const text = await readFile(resolve(expandTilde(source)), "utf8");
      const bundle = fromBundle(JSON.parse(text));
      return { conversation: bundle.conversation, digest: bundle.digest };
    } catch (error) {
      process.stderr.write(pc.red(`${handoffFaultText(error instanceof SyntaxError ? "bundle-invalid: not JSON" : error)}\n`));
      return 1;
    }
  }

  if (source === undefined) {
    /*
      No handle: the newest conversation in this folder. Two agents within the same hour is not a
      choice this command makes — the person was in both, and the wrong one handed over is the
      one they were not looking at.
     */
    const discovery = await discover(store, { cwds: [cwd] });
    if (typeof discovery === "number") return discovery;
    const { newest: first, rival } = newestOfFolder(await inFolder(discovery.conversations, cwd, store.platform));
    if (!first) {
      process.stderr.write(pc.red(`${say("handoff.noneHere", { cwd })}\n`) + pc.dim(`${say("handoff.noneHereHint")}\n`));
      return 1;
    }
    const now = new Date().toISOString();
    if (rival) {
      process.stderr.write(
        `${pc.yellow(say("handoff.twoRecent"))}\n` +
          [first, rival]
            .map((ref) => `  ${say("handoff.candidate", { handle: ref.handle, target: targetWord, agent: labelOf(ref), when: sinceMs(ref.updatedAt, now) })}`)
            .join("\n") +
          "\n",
      );
      return 1;
    }
    const conversation = await read(first, store);
    if (typeof conversation === "number") return conversation;
    const taken = say("handoff.tookNewest", { agent: labelOf(first), handle: first.handle, when: sinceMs(first.updatedAt, now) });
    if (!parsed.json) process.stderr.write(pc.dim(`${taken}\n`));
    return { conversation, taken };
  }

  const discovery = await discover(store, { cwds: [cwd] });
  if (typeof discovery === "number") return discovery;
  let ref: ConversationRef;
  try {
    ref = resolveConversation(source, discovery);
  } catch (error) {
    process.stderr.write(pc.red(`${handoffFaultText(error)}\n`));
    return 1;
  }
  const conversation = await read(ref, store);
  if (typeof conversation === "number") return conversation;
  return { conversation };
}

async function discover(store: StoreOptions, extra: { cwds: string[] }): Promise<Discovery | number> {
  try {
    return await discoverConversations({ ...store, ...extra });
  } catch (error) {
    process.stderr.write(pc.red(`${handoffFaultText(error)}\n`));
    return 1;
  }
}

async function read(ref: ConversationRef, store: StoreOptions): Promise<Conversation | number> {
  try {
    return await readConversation(ref, store, { cwds: [ref.cwd] });
  } catch (error) {
    process.stderr.write(pc.red(`${handoffFaultText(error)}\n`));
    return 1;
  }
}

// ── The digest a model writes ──────────────────────────────────────────────

/**
 * `POST /api/handoff/digest {id}`: the catalog re-reads the conversation, asks the model and
 * counts the spend. Refused before anything is written when the catalog is down: a handoff that
 * silently fell back to the mechanical digest would say "digest by model" nowhere and spend
 * nothing, which is exactly the kind of quiet substitution `args.ts` exists to prevent.
 */
async function modelDigest(parsed: Flags, conversation: Conversation): Promise<Digest | number> {
  let reply: Response;
  try {
    reply = await catalogFetch(new URL("/api/handoff/digest", parsed.api), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: conversation.id }),
    });
  } catch {
    // The error path every command that talks to the catalog shares — it names the address that
    // failed — and under it the one way out that is this flag's own.
    unreachable(parsed.api);
    process.stderr.write(pc.dim(`${say("handoff.needsCatalog")}\n`));
    return 1;
  }
  if (!reply.ok) {
    process.stderr.write(pc.red(`${say("handoff.digestRejected", { status: reply.status, detail: await refusalOf(reply) })}\n`));
    return 1;
  }
  const body = (await reply.json().catch(() => undefined)) as { digest?: Digest; by?: string } | undefined;
  const digest = body?.digest ?? (body?.by === "model" ? (body as Digest) : undefined);
  if (!digest || typeof digest.title !== "string") {
    process.stderr.write(pc.red(`${say("handoff.digestUnreadable")}\n`));
    return 1;
  }
  return digest;
}

// ── The preview ────────────────────────────────────────────────────────────

/**
 * What would travel and what would stay, before or instead of writing. The bundle is not an
 * agent and has no fidelity table: its preview says where the file would go, and the file stays
 * unwritten, which is the whole promise of the flag.
 */
function preview(parsed: Flags, conversation: Conversation, digest: Digest, target: AgentId | "bundle" | undefined, tier: Tier, out?: string): number {
  const fidelity = target !== undefined && target !== "bundle" ? fidelityOf(target) : undefined;
  const sizeFacts = { turns: conversation.turns.length, tokens: digest.stats.estimatedTokens, bytes: conversation.bytes };
  if (parsed.json) {
    process.stdout.write(
      `${JSON.stringify({ dryRun: true, conversation: refOf(conversation), digest, tier, target: target ?? null, fidelity: fidelity ?? null, size: sizeFacts, dropped: conversation.dropped, ...(target === "bundle" ? { bundle: out ?? null } : {}) }, null, 2)}\n`,
    );
    return 0;
  }
  const lines = ["", `  ${pc.bold(say("handoff.preview"))}`, ...digestLines(conversation, digest, tier)];
  if (fidelity) {
    lines.push("", `  ${pc.bold(say("handoff.travels", { agent: AGENT_NAMES[fidelity.agent] }))}`);
    for (const item of fidelity.carries) lines.push(`    ${pc.green("+")} ${item}`);
    lines.push(`  ${pc.bold(say("handoff.stays"))}`);
    for (const item of fidelity.leaves) lines.push(`    ${pc.dim("−")} ${pc.dim(item)}`);
  }
  if (target === "bundle") lines.push("", `  ${pc.dim(out ? say("handoff.bundleWouldWrite", { path: out }) : say("handoff.bundleWouldPrint"))}`);
  lines.push("", `  ${sizeLine(sizeFacts)}`, `  ${pc.dim(leftBehind(conversation.dropped))}`, "");
  process.stdout.write(lines.join("\n"));
  return 0;
}

function digestLines(conversation: Conversation, digest: Digest, tier: Tier): string[] {
  const lines = [
    `  ${say("handoff.source", { agent: labelOf(conversation), handle: pc.cyan(conversation.handle), title: digest.title })}`,
    `  ${pc.dim(say("handoff.digestBy", { by: digest.by, tier }))}`,
    "",
    `  ${say("handoff.goal", { goal: oneLine(digest.goal, 160) })}`,
  ];
  if (digest.summary) lines.push(`  ${pc.dim(say("handoff.sourceSummary"))}`);
  lines.push(
    `  ${pc.dim(
      say("handoff.counts", {
        decisions: digest.decisions.length,
        files: digest.filesTouched.length,
        commands: digest.commandsRun.length,
        open: digest.openItems.length,
      }),
    )}`,
  );
  return lines;
}

function sizeLine(facts: { turns: number; tokens: number; bytes: number }): string {
  return say("handoff.sizeLine", { n: facts.turns, k: Math.max(1, Math.round(facts.tokens / 1000)), size: size(facts.bytes) });
}

/** «Left behind: thinking: 3, images: 1» — every zero omitted, so an empty list says nothing. */
export function leftBehind(dropped: Dropped): string {
  const parts: string[] = [];
  for (const key of ["thinking", "images", "subagents", "offloaded", "secrets", "other"] as const) {
    const n = dropped[key];
    if (n > 0) parts.push(say(`handoff.left.${key}`, { n }));
  }
  return parts.length === 0 ? "" : say("handoff.leftBehind", { list: parts.join(", ") });
}

// ── The bundle through the redactor ────────────────────────────────────────

/*
  The native writers cover every text they emit and count the marks into `dropped.secrets`; the
  bundle is serialised here, from the conversation as read, so the covering happens here too. A
  transcript quotes what the person pasted, and the digest quotes the transcript: turn text, tool
  inputs and outputs, the compactions, the title, and every string of the digest go through
  `redactSecrets`, and the count travels with the file. Until 12-Sep-2026 the portable file — the
  one copy the same-agent steps recommend keeping outside every agent — was the one handoff
  artifact that carried a pasted key intact, at the default file mode.
 */

/** `redactSecrets` with the marks counted, the way the engine's writers count them. */
class Cover {
  count = 0;

  text(value: string): string {
    const out = redactSecrets(value);
    if (out !== value) this.count += marks(out) - marks(value);
    return out;
  }

  /** Strings inside a tool input pass through; the structure stays as it was. */
  input(value: unknown): unknown {
    if (typeof value === "string") return this.text(value);
    if (Array.isArray(value)) return value.map((item) => this.input(item));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = this.input(item);
      return out;
    }
    return value;
  }

  part(part: Part): Part {
    switch (part.kind) {
      case "text":
      case "summary":
        return { ...part, text: this.text(part.text) };
      case "tool_call":
        return { ...part, input: this.input(part.input) };
      case "tool_result":
        return { ...part, output: this.text(part.output) };
    }
  }

  turn(turn: Turn): Turn {
    return { ...turn, parts: turn.parts.map((part) => this.part(part)) };
  }

  digest(digest: Digest): Digest {
    const list = (items: string[]): string[] => items.map((item) => this.text(item));
    const exchange: Digest["lastExchange"] = {};
    if (digest.lastExchange.user !== undefined) exchange.user = this.text(digest.lastExchange.user);
    if (digest.lastExchange.assistant !== undefined) exchange.assistant = this.text(digest.lastExchange.assistant);
    return {
      ...digest,
      title: this.text(digest.title),
      goal: this.text(digest.goal),
      ...(digest.summary !== undefined ? { summary: this.text(digest.summary) } : {}),
      decisions: list(digest.decisions),
      filesTouched: list(digest.filesTouched),
      commandsRun: list(digest.commandsRun),
      openItems: list(digest.openItems),
      lastExchange: exchange,
    };
  }
}

function marks(text: string): number {
  return text.split(REDACTED).length - 1;
}

/** The conversation and the digest with every key covered, and `dropped.secrets` raised by the marks. */
export function coverBundle(conversation: Conversation, digest: Digest): { conversation: Conversation; digest: Digest } {
  const cover = new Cover();
  const turns = conversation.turns.map((turn) => cover.turn(turn));
  const compactions = conversation.compactions.map((compaction) => ({ ...compaction, text: cover.text(compaction.text) }));
  const covered: Conversation = {
    ...conversation,
    ...(conversation.title !== undefined ? { title: cover.text(conversation.title) } : {}),
    turns,
    compactions,
    dropped: { ...conversation.dropped },
  };
  const coveredDigest = cover.digest(digest);
  covered.dropped.secrets += cover.count;
  return { conversation: covered, digest: coveredDigest };
}

// ── The same agent ─────────────────────────────────────────────────────────

/**
 * The slash commands a running agent takes instead of the shell ones in `SIGN_OUT` and `SIGN_IN`,
 * printed in parentheses after them. Only Claude Code has both verified; Gemini's `/auth` is
 * already the whole command in the engine's table.
 */
const INSIDE: Readonly<Partial<Record<AgentId, { binary: string; out: string; in: string }>>> = {
  "claude-cli": { binary: "claude", out: "/logout", in: "/login" },
};

/**
 * Nothing is written: the conversation stays on this disk, because every store is per machine
 * and folder and never per account. The steps are the person's own —sign out, sign in with the
 * account they want to continue with, resume the same file— and panoma runs none of them. On
 * macOS, when the agent has an app, the app door is printed under the resume line: Claude.app
 * lists its conversations per account, so the link is what adopts this one into the account
 * that signed in; the Codex app lists from the shared database and the link opens the thread.
 * The fork and the bundle are optional: the bundle is the copy that survives anything.
 */
async function sameAgent(parsed: Flags, conversation: Conversation, cwd: string, platform?: NodeJS.Platform): Promise<number> {
  const agent = conversation.agent;
  const resume = resumeOf(agent, conversation.sessionId, conversation.cwd, platform);
  const fork = forkOf(agent, conversation.sessionId, conversation.cwd, platform);
  const app = resumeInApp(agent, conversation.sessionId, conversation.cwd, platform);
  const signOut = SIGN_OUT[agent] ?? "";
  const signIn = SIGN_IN[agent] ?? "";
  const bundle = `panoma handoff ${conversation.handle} --to bundle --out <file>`;
  if (parsed.json) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, sameAgent: true, agent, signOut, signIn, resume: resume ?? null, resumeInApp: app ?? null, fork: fork ?? null, bundle }, null, 2)}\n`,
    );
    return 0;
  }
  const lines = ["", `  ${say("handoff.sameAgent")}`, ""];
  let n = 0;
  const step = (text: string): void => {
    n += 1;
    lines.push(`  ${n}. ${text}`);
  };
  for (const line of accountLines(agent)) step(line);
  if (resume) {
    step(say("handoff.sameAgentResume", { line: pc.cyan(await lineFor(resume, conversation.cwd, cwd)) }));
    if (app) {
      const name = app.app.name;
      lines.push(`     ${say("handoff.sameAgentAppDoor", { app: name, line: pc.cyan(app.line) })}`);
      lines.push(`     ${pc.dim(say(agent === "claude-cli" ? "handoff.sameAgentAppClaude" : "handoff.sameAgentAppCodex", { app: name }))}`);
    }
  }
  if (fork) step(say("handoff.sameAgentFork", { line: pc.cyan(await lineFor(fork, conversation.cwd, cwd)) }));
  step(say("handoff.sameAgentBundle", { handle: conversation.handle }));
  lines.push("", `  ${pc.dim(say("handoff.sameAgentHome", { handle: conversation.handle, target: wordOf(agent) }))}`, "");
  process.stdout.write(lines.join("\n"));
  return 0;
}

/**
 * The sign-out and the sign-in of one agent, as the two sentences every same-agent path starts
 * with; for an agent with a slash command the sentence names it after the terminal command.
 */
function accountLines(agent: AgentId): string[] {
  const inside = INSIDE[agent];
  const withSlash = (command: string, slash: string): string =>
    inside ? say("handoff.sameAgentOrInside", { command: pc.cyan(command), slash: pc.cyan(slash), binary: inside.binary }) : pc.cyan(command);
  return [
    say("handoff.sameAgentSignOut", { agent: AGENT_NAMES[agent], command: withSlash(SIGN_OUT[agent] ?? "", inside?.out ?? "") }),
    say("handoff.sameAgentSignIn", { command: withSlash(SIGN_IN[agent] ?? "", inside?.in ?? "") }),
  ];
}

/**
 * The app door and the terminal line under it: «Open it in Claude (app):», the `open '…'` line,
 * the sentence for when the link does not answer, then «Or, in a terminal:» with the CLI line.
 * With no door (not macOS), the app is named as absent and the terminal line stands alone.
 */
function doorLines(app: ResumeInApp | undefined, name: string, line: string | undefined, agent: AgentId): string[] {
  const lines: string[] = [];
  if (app) {
    lines.push(`  ${pc.bold(say("handoff.openInApp", { app: name }))}`, `    ${pc.cyan(app.line)}`, `    ${pc.dim(say("handoff.appFallback", { sentence: app.sentence }))}`);
    if (agent === "claude-cli") lines.push(`    ${pc.dim(say("handoff.claudeTrust"))}`);
    if (line) lines.push("", `  ${pc.bold(say("handoff.orTerminal"))}`, `    ${pc.cyan(line)}`);
  } else {
    lines.push(`  ${say("handoff.appMacOnly", { app: name })}`);
    if (line) lines.push(`    ${pc.cyan(line)}`);
  }
  return lines;
}

// ── The write ──────────────────────────────────────────────────────────────

interface WriteArgs {
  parsed: Flags;
  deps: HandoffDeps;
  conversation: Conversation;
  digest: Digest;
  target: AgentId;
  /** `app` when the copy is meant for the target's desktop app; the file is the same either way. */
  surface: Surface;
  /** A target the person named gets a receipt; a bare `--tier brief --out` document does not. */
  named: boolean;
  tier: Tier;
  out: string | undefined;
  taken: string | undefined;
  cwd: string;
  store: StoreOptions;
  now: Date;
}

async function write({ parsed, deps, conversation, digest, target, surface, named, tier, out, taken, cwd, store, now }: WriteArgs): Promise<number> {
  let result: WriteResult;
  try {
    result = await handoff({
      conversation,
      target,
      surface,
      tier,
      digest,
      cwd: conversation.cwd,
      targetHome: parsed.targetHome === undefined ? undefined : resolve(expandTilde(parsed.targetHome)),
      keepTurns: parsed.keep,
      out,
      now,
      random: deps.random,
      options: store,
    });
  } catch (error) {
    process.stderr.write(pc.red(`${handoffFaultText(error)}\n`));
    return 1;
  }

  // OpenCode's door is its own importer: run it when the agent is installed, print it otherwise.
  const steps: { step: string; ran: boolean }[] = [];
  let importFault: string | undefined;
  if (target === "opencode" && result.steps.length > 0) {
    const command = await opencodeCommand(deps);
    if (command === undefined) {
      steps.push(...result.steps.map((step) => ({ step, ran: false })));
    } else {
      try {
        const exec = deps.exec ?? runImport;
        await exec(command, ["import", result.path], conversation.cwd);
        steps.push(...result.steps.map((step) => ({ step, ran: true })));
      } catch (error) {
        importFault = handoffFaultText(`import-command-failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
        steps.push(...result.steps.map((step) => ({ step, ran: false })));
      }
    }
  } else {
    steps.push(...result.steps.map((step) => ({ step, ran: false })));
  }

  const recorded = named ? await record(parsed, conversation, result, target, surface, tier) : "";
  const resume = result.resume ? await lineFor(result.resume, conversation.cwd, cwd) : undefined;
  /* The shorter copy for the same agent: the person signs out and in before resuming it, so those two lines come first. */
  const account = target === conversation.agent && parsed.targetHome === undefined && tier !== "brief";

  if (parsed.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: importFault === undefined,
          result,
          resume: resume ?? null,
          account: account ? { signOut: SIGN_OUT[target] ?? "", signIn: SIGN_IN[target] ?? "" } : null,
          steps,
          recorded: recorded ?? null,
          importFault: importFault ?? null,
          taken: taken ?? null,
        },
        null,
        2,
      )}\n`,
    );
    return importFault === undefined ? 0 : 1;
  }

  const lines = [""];
  if (tier === "brief" || !isNativeTarget(target)) {
    lines.push(`  ${pc.green("✓")} ${say("handoff.documentWritten", { path: pc.dim(result.path) })}`);
  } else {
    lines.push(`  ${pc.green("✓")} ${say("handoff.written", { agent: labelOf({ agent: target, surface }), path: pc.dim(result.path) })}`);
  }
  lines.push(`    ${pc.dim(say("handoff.digestBy", { by: digest.by, tier }))}`);
  lines.push(`    ${pc.dim(sizeLine({ turns: result.turns, tokens: digest.stats.estimatedTokens, bytes: result.bytes }))}`);
  if (account) {
    lines.push("");
    accountLines(target).forEach((line, index) => lines.push(`  ${index + 1}. ${line}`));
  }
  // An app target gets the app door with the terminal line under it; the engine leaves the door empty off macOS.
  if (surface === "app" && tier !== "brief" && isNativeTarget(target)) {
    lines.push("", ...doorLines(result.resumeInApp, labelOf({ agent: target, surface }), resume, target));
  } else if (resume) lines.push("", `  ${pc.bold(say("handoff.resume"))}`, `    ${pc.cyan(resume)}`);
  if (steps.length > 0) {
    lines.push("", `  ${pc.bold(say("handoff.then"))}`);
    for (const { step, ran } of steps) {
      lines.push(`    ${ran ? pc.green("✓") : pc.yellow("→")} ${ran ? say("handoff.stepRan", { step }) : say("handoff.stepPending", { step })}`);
    }
  }
  if (importFault) lines.push(`    ${pc.red(importFault)}`);
  if (target === "claude-cli" && surface === "cli" && tier !== "brief") lines.push(`    ${pc.dim(say("handoff.claudeContinue"))}`);
  const left = leftBehind(result.dropped);
  if (left) lines.push("", `  ${pc.dim(left)}`);
  if (recorded === undefined) lines.push(`  ${pc.dim(say("handoff.notRecorded"))}`);
  else if (recorded) lines.push(`  ${pc.dim(say("handoff.recorded", { id: recorded }))}`);
  lines.push("");
  process.stdout.write(lines.join("\n"));
  return importFault === undefined ? 0 : 1;
}

/** The verified OpenCode binary, from the PATH or inside the app; nothing when it is not here. */
async function opencodeCommand(deps: HandoffDeps): Promise<string | undefined> {
  const detect = deps.detect ?? (async () => (await detectCliAgents(providersByAuth("cli"))).map((agent) => ({ id: agent.provider.id, installed: agent.installed, command: agent.command })));
  const found = (await detect()).find((agent) => agent.id === "opencode" && agent.installed && agent.command);
  return found?.command;
}

async function runImport(file: string, args: string[], cwd: string): Promise<void> {
  const launch = resolveExecutable(file, args);
  await run(launch.file, launch.args, { cwd, timeout: 60_000 });
}

/**
 * The receipt, best effort: `POST /api/handoff/record`. `true` with the id when the catalog
 * took it, `false` when it is off or said no; the written file stays either way.
 */
async function record(parsed: Flags, conversation: Conversation, result: WriteResult, target: AgentId, surface: Surface, tier: Tier): Promise<string | undefined> {
  try {
    const reply = await catalogFetch(new URL("/api/handoff/record", parsed.api), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: conversation.id,
        target,
        surface,
        tier,
        targetSessionId: result.sessionId,
        targetPath: result.path,
        sourceHash: conversation.hash,
        turns: result.turns,
        bytes: result.bytes,
        dropped: result.dropped,
      }),
    });
    if (!reply.ok) return undefined;
    const body = (await reply.json().catch(() => undefined)) as { receipt?: { id?: string }; id?: string } | undefined;
    return body?.receipt?.id ?? body?.id ?? "";
  } catch {
    return undefined;
  }
}

// ── Small helpers ──────────────────────────────────────────────────────────

/** The resume line, without its `cd` when the person is already in the conversation's folder. */
async function lineFor(resume: Resume, conversationCwd: string, cwd: string): Promise<string> {
  return (await realFolder(conversationCwd)) === cwd ? [resume.command, ...resume.args].join(" ") : resume.line;
}

/*
  Folders are compared by what they resolve to, not by how they were typed. On macOS the
  temporary tree is `/var/…` for the agent that wrote the transcript and `/private/var/…` for
  `process.cwd()`, and a person standing in the conversation's folder was told to `cd` into it.
  A folder that no longer exists keeps its spelling, so the comparison still says something.
 */
async function realFolder(path: string): Promise<string> {
  return realpath(path).catch(() => path);
}

/** The conversations whose folder is this one or lies inside it, resolved on both sides. */
async function inFolder(refs: ConversationRef[], cwd: string, platform?: NodeJS.Platform): Promise<ConversationRef[]> {
  const kept: ConversationRef[] = [];
  for (const ref of refs) {
    if (ref.cwd && insideFolder(await realFolder(ref.cwd), cwd, platform)) kept.push(ref);
  }
  return kept;
}

/** The plain word for an agent, the one `--to` takes; the app's word when the surface is the app. */
function wordOf(agent: AgentId, surface: Surface = "cli"): string {
  if (surface === "app" && APP_OF[agent]) return APP_OF[agent].id;
  return Object.entries(AGENT_WORDS).find(([, id]) => id === agent)?.[0] ?? agent;
}

/** The closest target word, when one is close enough to be the one meant. */
export function nearestWord(word: string): string | undefined {
  let best: { word: string; distance: number } | undefined;
  for (const candidate of TARGET_WORDS) {
    const distance = editDistance(word, candidate);
    if (distance <= 2 && (!best || distance < best.distance)) best = { word: candidate, distance };
  }
  return best?.word;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}

function refOf(conversation: Conversation): ConversationRef {
  const ref: ConversationRef = {
    id: conversation.id,
    agent: conversation.agent,
    sessionId: conversation.sessionId,
    handle: conversation.handle,
    path: conversation.path,
    cwd: conversation.cwd,
    updatedAt: conversation.updatedAt,
    turnCount: conversation.turnCount,
    bytes: conversation.bytes,
    compacted: conversation.compacted,
  };
  for (const key of ["gitBranch", "title", "model", "startedAt"] as const) {
    if (conversation[key] !== undefined) ref[key] = conversation[key];
  }
  if (conversation.surface !== undefined) ref.surface = conversation.surface;
  if (conversation.limit) ref.limit = conversation.limit;
  return ref;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The reason the catalog gave, in one line; the same reading `memory-command.ts` does. */
async function refusalOf(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: unknown; hint?: unknown };
    const error = typeof body.error === "string" ? body.error : "";
    const hint = typeof body.hint === "string" ? ` ${body.hint}` : "";
    if (error) return `${error}${hint}`;
  } catch {
    // Not JSON: the first line of whatever came is the most a terminal can use.
  }
  return text.split("\n")[0]?.trim() ?? "";
}

/*
  The byte formatter of `twin-command.ts`, letter by letter, for the reason written there: the
  two that exist are not exported, and merging them is a deletion nobody has made yet.
 */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 10 * 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
