import type { HookState, MemoryChannel, TransportProfileId } from "@panoma/core";
import { TRANSPORT_PROFILES } from "@panoma/core";

/*
  The host matrix: which program, at which entry and version, has been shown to receive a memory
  message at a validated site of its own record, and what Panoma may therefore claim about it.

  Three pieces of evidence, and none of them is another one (plan §23.2.5): a configuration was
  installed — the hook is in the settings file; an invocation was observed — the program ran our
  command and its record says so; and a receipt site was verified — a person read the program's
  transcript and found the exact bytes of an offer at the place the parser looks. Only the third
  lets a reception be sealed. The first two let a delivery be attempted. A version string found by
  grepping a binary is none of the three.

  ── What is verified today, and where the bytes were found ──────────────────────────────────

  Claude Code from the desktop entry (`entrypoint: "claude-desktop"` in its records), versions
  2.1.258 and 2.1.266 on this machine, writes every hook's `additionalContext` as an `attachment`
  record of type `hook_additional_context` whose `content[]` strings are the exact text the hook
  printed. That attachment is the receipt site; `packages/core/src/history/receipts.ts` reads it.
  It was observed for `PostToolUse` and `Stop` on 2.1.266, and for `SessionStart` on 2.1.258 in
  the probe of 14-Sep-2026 (six `claude -p` sessions whose briefs came back as that attachment,
  four of them whole); the parser keeps the event name it finds rather than assuming one. The
  profile for the start-of-session brief is `hook-brief-v1`, and the same program is the one the edit
  signal has reached for months under its legacy shape — which is why `hook-signal-v1` keeps
  that shape and is never called verified here: nobody has measured its native ceiling, and an
  invented maximum is exactly what this file exists to refuse.

  The command-line entry of Claude Code has not been probed on this machine: its records are
  expected to be the same, and "expected" is `unknown`, not `verified`. Codex has no hook that
  could carry a message and no attachment record to read: `unsupported`, with no events.

  ── What the matrix never does ───────────────────────────────────────────────────────────────

  It never turns "the program is similar" into "the program is verified" (A16/T04): a harness,
  entry or version outside the rows below gets `unknown` on every axis, a `null` profile, and no
  installation is triggered by it. And it never confuses the server's own MCP profile with a
  claim about the client: `mcp-memory-v2` is a limit Panoma imposes on what it emits, verified in
  the sense that the server measures it, with reception `unknown` because no MCP client records
  a site anyone has validated.
 */

export type HostEntry = "cli" | "desktop" | "mcp";
export type ReceiptSite = "verified" | "unsupported" | "unknown";
export type Invocation = "observed" | "failed" | "unknown";

export interface HostCapability {
  harness: string;
  entry: HostEntry;
  version: string | null;
  /** The profile a delivery to this host uses; null when the host has none Panoma would emit. */
  profile: TransportProfileId | null;
  /** Our hooks are installed for this harness here; null when the harness has no configuration to check. */
  configured: boolean | null;
  invocation: Invocation;
  /** Only the lifecycle, edit and close events that have been checked for this host. */
  events: string[];
  receiptSite: ReceiptSite;
  /**
   * What a subagent of this host receives. `own_context`: it runs in its own context and a
   * verified channel delivers there; `no_delivery`: it runs in its own context and no managed
   * hook delivers to it — the lack is declared, never a reception supposed (A15/T08);
   * `unknown`: nothing was probed.
   */
  subagents: SubagentDelivery;
  limits: { maxCodePoints?: number; maxSerializedBytes?: number } | null;
}

export type SubagentDelivery = "own_context" | "no_delivery" | "unknown";

export interface VerifiedHost {
  harness: string;
  entry: HostEntry;
  /** Exact observed versions separated by `|`, or `*` when a claim does not depend on version. */
  versions: string;
  /** The profile of the start-of-session brief for this host, or null when it has none. */
  profile: TransportProfileId | null;
  events: string[];
  receiptSite: ReceiptSite;
  /** The record type at which the receipt reader finds the delivered bytes, when verified. */
  site?: string;
  subagents: SubagentDelivery;
}

/**
 * The lowest Claude Code version whose records were read on this machine while writing the
 * parser: 2.1.258 is the `claude` binary that ran the probe of 14-Sep-2026 (a SessionStart hook's
 * `additionalContext` landed as a `hook_additional_context` attachment of a `claude-desktop`
 * entrypoint session), and 2.1.266 is what the desktop app's own transcripts carried that day.
 */
export const CLAUDE_CODE_VERIFIED_FROM = "2.1.258";

export const VERIFIED_HOSTS: readonly VerifiedHost[] = [
  {
    harness: "claude-code",
    entry: "desktop",
    versions: `${CLAUDE_CODE_VERIFIED_FROM}|2.1.266`,
    profile: "hook-brief-v1",
    events: ["SessionStart", "PreToolUse", "Stop", "SessionEnd"],
    receiptSite: "verified",
    site: "hook_additional_context",
    /*
      A subagent's transcript is its own stream (`<session>/subagents/<name>.jsonl`), so its
      context is its own — but `SessionStart` does not fire for it, the brief never reaches it,
      and the edit signal it may trigger is the legacy shape nobody has verified there. The
      reader counts a receipt found in one as `sidechain` and seals nothing (A15/T08). What is
      declared is the lack, not an inheritance from the parent.
     */
    subagents: "no_delivery",
  },
  {
    harness: "claude-code",
    entry: "cli",
    versions: `${CLAUDE_CODE_VERIFIED_FROM}|2.1.266`,
    profile: null,
    events: [],
    receiptSite: "unknown",
    subagents: "unknown",
  },
  {
    harness: "codex",
    entry: "cli",
    versions: "*",
    profile: null,
    events: [],
    receiptSite: "unsupported",
    subagents: "unknown",
  },
];

/** `major.minor.patch` with optional extra numeric parts; anything else is not a version. */
function parseVersion(value: string | null | undefined): number[] | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^v?(\d+(?:\.\d+)*)(?:[-+].*)?$/.exec(value.trim());
  if (!match) return undefined;
  return match[1]!.split(".").map((part) => Number.parseInt(part, 10));
}

/** Whether `version` satisfies a `>=floor` or `*` requirement; an unparsable version never does. */
export function versionSatisfies(version: string | null | undefined, requirement: string): boolean {
  if (requirement === "*") return true;
  if (!requirement.startsWith(">=")) return typeof version === "string" && requirement.split("|").includes(version);
  const floor = parseVersion(requirement.startsWith(">=") ? requirement.slice(2) : requirement);
  const actual = parseVersion(version);
  if (!floor || !actual) return false;
  for (let index = 0; index < Math.max(floor.length, actual.length); index += 1) {
    const have = actual[index] ?? 0;
    const need = floor[index] ?? 0;
    if (have !== need) return have > need;
  }
  return true;
}

/** The verified row for a host, when its harness, entry and version are all inside a row. */
export function verifiedHost(harness: string, entry: string, version: string | null | undefined): VerifiedHost | undefined {
  const host = VERIFIED_HOSTS.find((host) => host.harness === harness && host.entry === entry && versionSatisfies(version, host.versions));
  // 2.1.266 supplied real PostToolUse/Stop attachments, but the SessionStart transport was
  // measured only on 2.1.258. Sharing a receipt shape is not a verified brief profile.
  if (host?.harness === "claude-code" && host.entry === "desktop" && version === "2.1.266") {
    return { ...host, profile: null, events: ["PostToolUse", "Stop"] };
  }
  return host;
}

/**
 * The profile a channel uses for a host, and whether that pairing is verified.
 *
 * - `brief`: the host's verified brief profile; an unverified host falls back to the MCP profile
 *   limits and is flagged, so a route can refuse it (`unsupported_host`) and the hook can stay silent.
 * - `signal`: `hook-signal-v1`, the legacy shape, never verified in delivery A — no native ceiling
 *   was measured, so the automatic v2 signal is not enabled by this function for anyone.
 * - `mcp` and `handoff`: the server's own profiles; verified means the server measures them.
 */
export function profileFor(
  harness: string,
  entry: string,
  version: string | null | undefined,
  channel: MemoryChannel = "brief",
): { profile: TransportProfileId; verified: boolean } {
  if (channel === "mcp") return { profile: "mcp-memory-v2", verified: true };
  if (channel === "handoff") return { profile: "handoff-memory-v1", verified: true };
  if (channel === "signal") return { profile: "hook-signal-v1", verified: false };
  const host = verifiedHost(harness, entry, version);
  if (host?.profile && host.receiptSite === "verified") return { profile: host.profile, verified: true };
  return { profile: "mcp-memory-v2", verified: false };
}

function limitsOf(profile: TransportProfileId | null): HostCapability["limits"] {
  if (!profile) return null;
  const shape = TRANSPORT_PROFILES[profile];
  return {
    ...(shape.maxCodePoints !== undefined ? { maxCodePoints: shape.maxCodePoints } : {}),
    ...(shape.maxSerializedBytes !== undefined ? { maxSerializedBytes: shape.maxSerializedBytes } : {}),
  };
}

export interface ObservedHost {
  harness: string;
  entry: HostEntry;
  version: string | null;
  /** The result of the last invocation of our command this host's record shows, or null when none. */
  lastInvocation: "ok" | "failed" | null;
  /** How many receipts the reader found for this host. */
  receipts: number;
}

/** Whether the four managed events are installed for a harness; null when there is nothing to check. */
function configuredFor(state: HookState | undefined): boolean | null {
  if (!state) return null;
  return Object.values(state.events).every((event) => event === "installed") && state.durable === true;
}

/**
 * The capability matrix for the status screen: one row per verified host and one per observed
 * host that no row covers. Every axis comes from its own evidence — the installed hooks say
 * `configured`, the record says `invocation` and `version`, the table above says `events`,
 * `receiptSite` and `profile` — and none of them fills another one in.
 */
export function capabilityMatrix(input: {
  installed: Record<string, HookState | undefined>;
  observed: ObservedHost[];
}): HostCapability[] {
  const rows: HostCapability[] = [];
  const seen = new Set<string>();
  const observedBy = new Map<string, ObservedHost>();
  for (const one of input.observed) observedBy.set(`${one.harness}/${one.entry}`, one);

  for (const host of VERIFIED_HOSTS) {
    const key = `${host.harness}/${host.entry}`;
    seen.add(key);
    const observed = observedBy.get(key);
    const inside = observed ? versionSatisfies(observed.version, host.versions) : false;
    const measured = observed ? verifiedHost(host.harness, host.entry, observed.version) : undefined;
    rows.push({
      harness: host.harness,
      entry: host.entry,
      version: observed?.version ?? null,
      // A version outside the row's floor takes the row's claims away: what was verified was another program.
      profile: measured?.profile ?? null,
      configured: host.harness === "codex" ? null : configuredFor(input.installed[host.harness]),
      invocation: observed?.lastInvocation === "ok" ? "observed" : observed?.lastInvocation === "failed" ? "failed" : "unknown",
      events: measured ? [...measured.events] : [],
      receiptSite: host.receiptSite === "unsupported" ? "unsupported" : inside ? host.receiptSite : "unknown",
      subagents: inside ? host.subagents : "unknown",
      limits: measured ? limitsOf(measured.profile) : null,
    });
  }
  for (const observed of input.observed) {
    const key = `${observed.harness}/${observed.entry}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      harness: observed.harness,
      entry: observed.entry,
      version: observed.version,
      profile: null,
      configured: configuredFor(input.installed[observed.harness]),
      invocation: observed.lastInvocation === "ok" ? "observed" : observed.lastInvocation === "failed" ? "failed" : "unknown",
      events: [],
      receiptSite: "unknown",
      subagents: "unknown",
      limits: null,
    });
  }
  return rows;
}
