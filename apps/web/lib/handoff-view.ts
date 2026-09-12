/**
 * What the handoff screen decides before it paints anything, with nothing from the disk in it.
 *
 * The list arrives from `GET /api/handoff` as plain rows; the receipts arrive from the page. Every
 * rule that turns those rows into what the person sees — which project a conversation belongs to,
 * what the limit badge says at this minute, which word names a tier, how a size reads — lives
 * here, where `handoff-view.test.ts` can run it. The components only ask.
 *
 * Nothing here imports the engine's runtime. `@panoma/handoff` pulls `node:fs` through its index,
 * and a client component that touched it would drag that into the browser bundle (the trap
 * `twin-teach.tsx` met). The two small tables the screen needs — the agents' names and the sign-in
 * commands — are copied, and `handoff-view.test.ts` holds them equal to the engine's so they
 * cannot drift. Types are imported as types only: they are erased at build time.
 */
import type {
  ConversationRef,
  Digest,
  Dropped,
  Fidelity,
  LimitHit,
  StoreReport,
  Surface,
  Tier,
} from "@panoma/handoff";
import { isHandoffFaultCode } from "@panoma/handoff/faults";
import { formatBytes } from "./format-bytes";
import type { Locale, MessageKey } from "./i18n";

/* ── Copies of the engine's pure tables ─────────────────────────────────────────────────── */

/** The display names, one per canonical id; `handoff-view.test.ts` compares them to `AGENT_NAMES`. */
export const AGENT_LABELS: Readonly<Record<string, string>> = {
  "claude-cli": "Claude Code",
  "codex-cli": "Codex CLI",
  opencode: "OpenCode",
  "gemini-cli": "Gemini CLI",
  "cursor-agent": "Cursor Agent",
  "copilot-cli": "GitHub Copilot",
  aider: "Aider",
  "amp-cli": "Amp",
  goose: "Goose",
};

/**
 * The desktop app of an agent, when one exists, by the agent's id: the name a row shows when the
 * surface is `app`, and the word the terminal accepts after `--to`, which is also the icon's key.
 * `handoff-view.test.ts` holds both equal to the engine's `APP_OF` and `APP_WORDS`.
 */
export const APP_LABELS: Readonly<Record<string, string>> = {
  "claude-cli": "Claude (app)",
  "codex-cli": "Codex (app)",
};

export const APP_WORD: Readonly<Record<string, string>> = {
  "claude-cli": "claude-app",
  "codex-cli": "codex-app",
};

/** The agents whose own resume finds a file panoma wrote; the rest get a document. */
export const NATIVE_TARGETS: readonly string[] = ["claude-cli", "codex-cli", "opencode", "gemini-cli"];

/** The plain word the terminal accepts after `--to`, for the line the same-agent panel copies. */
export const AGENT_WORD: Readonly<Record<string, string>> = {
  "claude-cli": "claude",
  "codex-cli": "codex",
  opencode: "opencode",
  "gemini-cli": "gemini",
  "cursor-agent": "cursor",
  "copilot-cli": "copilot",
  aider: "aider",
  "amp-cli": "amp",
  goose: "goose",
};

/**
 * What a person types to sign out and to sign in, per agent: the same-agent flow with another
 * account signs out of one, signs in with the other, and resumes the same file. Both tables mirror
 * the engine's `SIGN_OUT` and `SIGN_IN` word for word (the test holds them equal). Printed, never
 * run: panoma holds no credential and never sees a login.
 */
export const SIGN_OUT_WORDS: Readonly<Record<string, string>> = {
  "claude-cli": "claude auth logout",
  "codex-cli": "codex logout",
  opencode: "opencode auth logout",
  "gemini-cli": "/auth inside gemini",
};

export const SIGN_IN_WORDS: Readonly<Record<string, string>> = {
  "claude-cli": "claude auth login",
  "codex-cli": "codex login",
  opencode: "opencode auth login",
  "gemini-cli": "/auth inside gemini",
};

/**
 * The slash commands Claude Code accepts at its own prompt, for the «or … inside claude» aside
 * after each auth command. Gemini's word already names its prompt and gets no aside.
 */
export const INSIDE_CLAUDE: Readonly<{ signOut: string; signIn: string }> = { signOut: "/logout", signIn: "/login" };

/**
 * What the copy button copies for one of those words: the command alone. «/auth inside gemini»
 * is a sentence about where to type, and the clipboard should hold `/auth`, not the sentence;
 * the label keeps the whole word so the screen still says where.
 */
export function copyOfWord(word: string): string {
  const inside = word.indexOf(" inside ");
  return inside === -1 ? word : word.slice(0, inside);
}

/** The command and the arguments that resume one conversation, mirroring the engine's `resumeOf`. */
const RESUME: Readonly<Record<string, (id: string) => string[]>> = {
  "claude-cli": (id) => ["claude", "--resume", id],
  "codex-cli": (id) => ["codex", "resume", id],
  opencode: (id) => ["opencode", "-s", id],
  "gemini-cli": (id) => ["gemini", "--resume", id],
};

const FORK: Readonly<Record<string, (id: string) => string[]>> = {
  "claude-cli": (id) => ["claude", "--resume", id, "--fork-session"],
  "codex-cli": (id) => ["codex", "fork", id],
};

/** The same shape check the engine makes before an id reaches a command line. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** `claude --resume <id>` without the `cd`: the page's `inFolder` adds it with the right shell. */
export function resumeCommandOf(agent: string, sessionId: string): string | undefined {
  const build = RESUME[agent];
  if (!build || !SAFE_ID.test(sessionId)) return undefined;
  return build(sessionId).join(" ");
}

export function forkCommandOf(agent: string, sessionId: string): string | undefined {
  const build = FORK[agent];
  if (!build || !SAFE_ID.test(sessionId)) return undefined;
  return build(sessionId).join(" ");
}

export function agentLabel(id: string): string {
  return AGENT_LABELS[id] ?? id;
}

export function isNativeTarget(id: string): boolean {
  return NATIVE_TARGETS.includes(id);
}

/**
 * What a row calls an agent on a surface: «Claude (app)» when the conversation was kept by the
 * desktop app, or is meant for it; the CLI name otherwise. An agent with no app keeps its name
 * whatever the surface says, because the surface is a marker on a file and not a promise.
 */
export function sourceLabel(agent: string, surface?: Surface): string {
  if (surface === "app") return APP_LABELS[agent] ?? agentLabel(agent);
  return agentLabel(agent);
}

/** The icon key for an agent on a surface: the app's own id when it has one. */
export function iconKey(agent: string, surface?: Surface): string {
  return surface === "app" ? (APP_WORD[agent] ?? agent) : agent;
}

/** Whether an agent has a desktop app the screen can offer as a target. */
export function hasApp(agent: string): boolean {
  return agent in APP_LABELS;
}

/**
 * What to do by hand when an app's link does not answer, by the app's id: the engine's
 * `ResumeInApp.sentence` says it in English for the terminal and the channel, and the screen
 * says it in the viewer's language from the same three facts — the app, the folder and the id.
 * `handoff-view.test.ts` holds one key per app in `APP_OF`, in both halves.
 */
export const IN_APP_BY_HAND_KEY: Readonly<Record<string, MessageKey>> = {
  "claude-app": "handoff.inAppByHand.claude-app",
  "codex-app": "handoff.inAppByHand.codex-app",
};

/**
 * The key a preview files its receipts and fidelity under, and the value of a target radio:
 * the agent id, with `@app` when the copy is meant for the desktop app.
 */
export function receiptKey(agent: string, surface?: Surface): string {
  return surface === "app" ? `${agent}@app` : agent;
}

/** The inverse of `receiptKey`: what a radio value names. */
export function parseTarget(value: string): { agent: string; surface: Surface } {
  return value.endsWith("@app")
    ? { agent: value.slice(0, -"@app".length), surface: "app" }
    : { agent: value, surface: "cli" };
}

/* ── What the routes answer ─────────────────────────────────────────────────────────────── */

export interface HandoffAgentRow {
  /** The agent id, or the app id (`claude-app`) for a desktop-app row. */
  id: string;
  name: string;
  installed: boolean;
  broken?: boolean;
  native: boolean;
  /** Set on a desktop-app row: the agent whose store the app shares, and `"app"`. */
  agent?: string;
  surface?: Surface;
}

/** `GET /api/handoff`. */
export interface HandoffList {
  conversations: ConversationRef[];
  stores: StoreReport[];
  agents: HandoffAgentRow[];
  digest: { left: number; cap: number; connected: boolean };
  remote?: boolean;
}

/**
 * A receipt as the client sees it: dates as strings, plus what only the server knows. The page
 * lists them with the project slug and a look at the target file; a receipt that arrives from a
 * write or a preview is the bare catalog row, so those two fields are optional and absent there.
 */
export interface HandoffReceiptView {
  id: string;
  projectId: string | null;
  projectSlug?: string | null;
  /** The folder the copy resumes in; on the row a write answers, absent on the page's list. */
  cwd?: string;
  title: string | null;
  sourceAgent: string;
  sourceSessionId: string;
  targetAgent: string;
  /** Where the copy is meant to be opened; absent on rows written before the apps existed. */
  targetSurface?: Surface;
  targetSessionId: string;
  targetPath: string;
  tier: Tier;
  turns: number;
  bytes: number;
  dropped: Dropped;
  resumeCommand: string | null;
  /** The agent that asked over the MCP channel, by the name of its key; absent or `null` when a person did. */
  requestedBy?: string | null;
  createdAt: string;
  /** `null` when nobody looked (a remote catalog); `false` when `stat` failed on this machine. */
  fileExists?: boolean | null;
}

/** `GET /api/handoff/[id]`: the preview the panel paints before anything is written. */
export interface HandoffPreview {
  ref: ConversationRef;
  digest: Digest;
  /** Per native target, keyed by agent id or listed; `fidelityFor` reads either shape. */
  fidelity: Record<string, Fidelity> | Fidelity[];
  dropped: Dropped;
  size: { turns: number; bytes: number; estimatedTokens?: number; tokens?: number };
  /** The newest receipt per native target, keyed by `receiptKey`, or a plain list; `receiptFor` reads either. */
  receipts: Record<string, HandoffReceiptView | null> | HandoffReceiptView[];
  /**
   * The same-agent doors on the original conversation, when the agent is installed: the resume
   * line for the terminal, and the `open` line for the desktop app when the app is here too.
   */
  sameSurfaceDoor?: { cli: string | null; app: string | null };
}

/** What the engine answers for a copy meant for the desktop app; the `line` is what a person pastes. */
export interface ResumeInAppView {
  app: { id: string; name: string; bundle: string };
  url: string;
  line: string;
  /** What to do by hand when the link does not answer, in English for the machine surfaces; the panel words it through `IN_APP_BY_HAND_KEY`. */
  sentence: string;
}

/** `POST /api/handoff`. */
export interface HandoffWritten {
  receipt: HandoffReceiptView;
  result: {
    path: string;
    /** `null` for a document: there is nothing to resume, the person pastes the file. */
    resume?: { command: string; args: string[]; line: string } | null;
    /** Where the copy is meant to be opened; `"cli"` when the route does not say. */
    surface?: Surface;
    /** The desktop-app door for an app target; `null` when there is none on this platform. */
    resumeInApp?: ResumeInAppView | null;
    steps: string[];
    fidelity: Fidelity;
    dropped: Dropped;
    turns: number;
    bytes: number;
    /** The brief itself, when the route chooses to return it for a document-only target. */
    document?: string;
  };
}

export function fidelityFor(fidelity: HandoffPreview["fidelity"], agent: string): Fidelity | undefined {
  if (Array.isArray(fidelity)) return fidelity.find((row) => row.agent === agent);
  return fidelity[agent];
}

export function tokensOf(size: HandoffPreview["size"]): number {
  return size.estimatedTokens ?? size.tokens ?? 0;
}

/* ── The sentences a code becomes ───────────────────────────────────────────────────────── */

/**
 * A fault code is a dictionary key; anything else is quoted as it came. The same seam as
 * `appFaultText`: the routes answer `{error: code, detail?}` and the code is looked up, never the
 * detail, which can be a path or an errno the person needs to see verbatim.
 */
export function handoffFaultKey(code: string): MessageKey | undefined {
  return isHandoffFaultCode(code) ? (`handoff.fault.${code}` as MessageKey) : undefined;
}

/* ── Grouping by project ────────────────────────────────────────────────────────────────── */

export interface RootRow {
  slug: string;
  name: string;
  /** The root as the catalog stores it. */
  root: string;
  /** The same folder with links resolved, computed by the page; equal to `root` when it cannot be. */
  real: string;
}

export interface ConversationGroup {
  /** `null` for a folder that is not in the catalog. */
  slug: string | null;
  name: string;
  /** The catalog root, or the folder the conversations name when there is no project. */
  path: string;
  conversations: ConversationRef[];
}

function normalize(path: string): string {
  const unified = path.replace(/\\/g, "/");
  const trimmed = unified.length > 1 ? unified.replace(/\/+$/, "") : unified;
  return trimmed;
}

/** `cwd` equals the folder or sits inside it. */
export function insideFolder(cwd: string, folder: string): boolean {
  const a = normalize(cwd);
  const b = normalize(folder);
  if (a === b) return true;
  return a.startsWith(b.endsWith("/") ? b : `${b}/`);
}

function newestOf(rows: ConversationRef[]): number {
  return rows.reduce((top, row) => Math.max(top, Date.parse(row.updatedAt) || 0), 0);
}

export function sortNewest(rows: ConversationRef[]): ConversationRef[] {
  return [...rows].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}

/**
 * One row per id, the newest kept. Discovery lists files, and a store can hold two files that
 * answer to one session id — Codex writes `rollout-<ts>-<id>_<child>.jsonl` next to the parent —
 * so the screen keys its rows by id and must never receive the same key twice.
 */
export function dedupeById(rows: ConversationRef[]): ConversationRef[] {
  const kept = new Map<string, ConversationRef>();
  for (const row of sortNewest(rows)) if (!kept.has(row.id)) kept.set(row.id, row);
  return [...kept.values()];
}

/**
 * Which catalog project a conversation belongs to: the deepest root whose folder contains its
 * `cwd`, comparing against both the stored root and its resolved twin. Folders no root contains
 * are grouped by their own path, after every project, so the screen can say «scan this folder».
 */
export function groupByProject(rows: ConversationRef[], roots: RootRow[]): ConversationGroup[] {
  const byProject = new Map<string, ConversationGroup>();
  const loose = new Map<string, ConversationGroup>();

  for (const row of rows) {
    let chosen: RootRow | undefined;
    let depth = -1;
    for (const root of roots) {
      const candidates = root.real === root.root ? [root.root] : [root.root, root.real];
      for (const folder of candidates) {
        if (!insideFolder(row.cwd, folder)) continue;
        const thisDepth = normalize(folder).split("/").length;
        if (thisDepth > depth) {
          depth = thisDepth;
          chosen = root;
        }
      }
    }
    if (chosen) {
      const group = byProject.get(chosen.slug) ?? {
        slug: chosen.slug,
        name: chosen.name,
        path: chosen.root,
        conversations: [],
      };
      group.conversations.push(row);
      byProject.set(chosen.slug, group);
    } else {
      const key = normalize(row.cwd);
      const group = loose.get(key) ?? { slug: null, name: row.cwd, path: row.cwd, conversations: [] };
      group.conversations.push(row);
      loose.set(key, group);
    }
  }

  const finish = (groups: Iterable<ConversationGroup>) =>
    [...groups]
      .map((group) => ({ ...group, conversations: sortNewest(group.conversations) }))
      .sort((a, b) => newestOf(b.conversations) - newestOf(a.conversations));

  return [...finish(byProject.values()), ...finish(loose.values())];
}

/** The filters, applied before grouping. `project` is a slug, or `"none"` for the loose folders. */
export function filterConversations(
  rows: ConversationRef[],
  roots: RootRow[],
  filter: { agent: string; project: string },
): ConversationRef[] {
  return rows.filter((row) => {
    if (filter.agent !== "all" && row.agent !== filter.agent) return false;
    if (filter.project === "all") return true;
    const groups = groupByProject([row], roots);
    const slug = groups[0]?.slug ?? null;
    return filter.project === "none" ? slug === null : slug === filter.project;
  });
}

/* ── The limit badge ────────────────────────────────────────────────────────────────────── */

export type LimitBadge =
  | { state: "before"; resetsAt: Date }
  | { state: "after"; resetsAt: Date }
  | { state: "unknown" };

/**
 * A fact, not an alarm: whether the reset the agent recorded is still ahead at this minute. The
 * clock is passed in because the rows are judged in one render and must agree with each other.
 */
export function limitBadge(limit: LimitHit | undefined, now: number): LimitBadge | undefined {
  if (!limit) return undefined;
  if (!limit.resetsAt) return { state: "unknown" };
  const resetsAt = new Date(limit.resetsAt);
  if (!Number.isFinite(resetsAt.getTime())) return { state: "unknown" };
  return resetsAt.getTime() > now ? { state: "before", resetsAt } : { state: "after", resetsAt };
}

/** «in 2 h» / «en 35 min»: the mirror of `relativeTime`, looking forward. */
export function untilText(at: Date, locale: Locale, now: number): string {
  const ms = at.getTime() - now;
  const english = locale === "en";
  if (ms < 60_000) return english ? "in under a minute" : "en menos de un minuto";
  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000);
    return english ? `in ${minutes} min` : `en ${minutes} min`;
  }
  if (ms < 48 * 3_600_000) {
    const hours = Math.floor(ms / 3_600_000);
    return english ? `in ${hours} h` : `en ${hours} h`;
  }
  const days = Math.floor(ms / 86_400_000);
  return english ? `in ${days} d` : `en ${days} d`;
}

/** The clock time in the viewer's locale; the day too when it is not today. */
export function clockText(at: Date, locale: Locale, now: number): string {
  const sameDay = new Date(now).toDateString() === at.toDateString();
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
  }).format(at);
}

export function dateText(at: Date | string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-ES", { dateStyle: "medium" }).format(
    typeof at === "string" ? new Date(at) : at,
  );
}

/* ── Tiers, sizes and words ─────────────────────────────────────────────────────────────── */

export const TIER_KEY: Readonly<Record<Tier, MessageKey>> = {
  full: "handoff.tier.full",
  compact: "handoff.tier.compact",
  brief: "handoff.tier.brief",
};

export const TIER_HINT_KEY: Readonly<Record<Tier, MessageKey>> = {
  full: "handoff.tierHint.full",
  compact: "handoff.tierHint.compact",
  brief: "handoff.tierHint.brief",
};

/** Above this the panel preselects `compact`; mirrors `LARGE_CONVERSATION_BYTES`. */
export const LARGE_BYTES = 16 * 1024 * 1024;

export function defaultTier(bytes: number, native: boolean): Tier {
  if (!native) return "brief";
  return bytes > LARGE_BYTES ? "compact" : "full";
}

/** «12k» for the size line; never «0k» for a conversation that exists. */
export function kiloTokens(tokens: number): number {
  return Math.max(1, Math.round(tokens / 1000));
}

export function sizeText(bytes: number): string {
  return formatBytes(bytes);
}

/**
 * The six counts of `Dropped`, in the order the terminal prints them, each with the key that
 * names it. `FidelityTable` paints all six as rows (thinking as «never travels», the rest as
 * a count) and `leftBehind` lists the ones above zero. Until 12-Sep-2026 the screen knew four of
 * the six: a Claude Code conversation whose tool results over 64 KiB stayed behind read as if
 * nothing but thinking, images, subagents and secrets had, while the CLI and the channel counted
 * all six.
 */
export const DROPPED_KEYS: readonly { count: keyof Dropped; row: MessageKey; left: MessageKey }[] = [
  { count: "thinking", row: "handoff.row.thinking", left: "handoff.left.thinking" },
  { count: "images", row: "handoff.row.images", left: "handoff.left.images" },
  { count: "subagents", row: "handoff.row.subagents", left: "handoff.left.subagents" },
  { count: "offloaded", row: "handoff.row.offloaded", left: "handoff.left.offloaded" },
  { count: "secrets", row: "handoff.row.secrets", left: "handoff.left.secrets" },
  { count: "other", row: "handoff.row.other", left: "handoff.left.other" },
];

/** «Left behind: thinking, images: 2» — the keys, omitting zeros, for the caller to translate. */
export function leftBehind(dropped: Dropped): { key: MessageKey; n: number }[] {
  return DROPPED_KEYS.filter(({ count }) => dropped[count] > 0).map(({ count, left }) => ({ key: left, n: dropped[count] }));
}

/**
 * The digest as text, for the read-only preview and for «Copy the document». The route already
 * returns the digest as data; the one thing this adds is line breaks.
 */
export function digestText(digest: Digest): string {
  const lines: string[] = [`# ${digest.title}`, "", digest.goal];
  if (digest.summary) lines.push("", digest.summary);
  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push("", `## ${title}`, ...items.map((item) => `- ${item}`));
  };
  section("Decisions", digest.decisions);
  section("Files touched", digest.filesTouched);
  section("Commands run", digest.commandsRun);
  section("Open items", digest.openItems);
  if (digest.lastExchange.user || digest.lastExchange.assistant) {
    lines.push("", "## Last exchange");
    if (digest.lastExchange.user) lines.push(`**User:** ${digest.lastExchange.user}`);
    if (digest.lastExchange.assistant) lines.push("", `**Assistant:** ${digest.lastExchange.assistant}`);
  }
  return lines.join("\n");
}

/** The already-handed receipt for one target on one surface, whichever shape the preview carries them in. */
export function receiptFor(
  receipts: HandoffPreview["receipts"],
  target: string,
  surface: Surface = "cli",
): HandoffReceiptView | undefined {
  if (Array.isArray(receipts)) {
    return receipts.find((receipt) => receipt.targetAgent === target && (receipt.targetSurface ?? "cli") === surface);
  }
  return receipts[receiptKey(target, surface)] ?? undefined;
}

/** The `?project=` query, kept only when it names a root the page knows. */
export function projectFilterFrom(value: string | undefined, roots: RootRow[]): string {
  if (!value) return "all";
  return roots.some((root) => root.slug === value) ? value : "all";
}
