import { describe, expect, it } from "vitest";
import type { HookState } from "@panoma/core";
import {
  CLAUDE_CODE_VERIFIED_FROM, VERIFIED_HOSTS, capabilityMatrix, profileFor, verifiedHost, versionSatisfies,
} from "./memory-hosts";

/*
  The host matrix claims exactly what was seen and nothing that was inferred: a verified receipt
  site for Claude Code from the desktop entry, an unknown one for its command line, none for
  Codex, and unknown on every axis for a program, entry or version nobody probed (A16/T04).
 */

const installed: HookState = {
  postCommit: true,
  events: { Stop: "installed", PreToolUse: "installed", SessionStart: "installed", SessionEnd: "installed" },
  durable: true,
};

describe("the verified hosts", () => {
  it("names Claude Code from the desktop entry as the one host with a verified receipt site, at the attachment record", () => {
    const desktop = VERIFIED_HOSTS.find((host) => host.harness === "claude-code" && host.entry === "desktop");
    expect(desktop).toMatchObject({ profile: "hook-brief-v1", receiptSite: "verified", site: "hook_additional_context" });
    expect(desktop?.events).toEqual(["SessionStart", "PreToolUse", "Stop", "SessionEnd"]);
    expect(desktop?.versions).toBe(`${CLAUDE_CODE_VERIFIED_FROM}|2.1.266`);
    expect(verifiedHost("claude-code", "desktop", "2.1.267")).toBeUndefined();
    expect(verifiedHost("claude-code", "desktop", "3.0.0")).toBeUndefined();
  });

  it("A15/T08: no host claims a delivery to a subagent — the desktop entry declares the lack, the rest know nothing", () => {
    // A subagent has its own context and no managed hook reaches it: `no_delivery` is a declared absence, never an inherited reception.
    expect(VERIFIED_HOSTS.map((host) => host.subagents)).toEqual(["no_delivery", "unknown", "unknown"]);
    expect(VERIFIED_HOSTS.some((host) => host.subagents === "own_context")).toBe(false);
  });

  it("leaves the command-line entry unknown until it is probed, and Codex unsupported with no events", () => {
    expect(verifiedHost("claude-code", "cli", "2.1.266")).toMatchObject({ profile: null, receiptSite: "unknown", events: [] });
    expect(verifiedHost("codex", "cli", "0.153.0")).toMatchObject({ profile: null, receiptSite: "unsupported", events: [] });
  });

  it("compares versions numerically and refuses a version it cannot read", () => {
    expect(versionSatisfies("2.1.266", ">=2.1.260")).toBe(true);
    expect(versionSatisfies("2.1.260", ">=2.1.260")).toBe(true);
    expect(versionSatisfies("2.1.259", ">=2.1.260")).toBe(false);
    expect(versionSatisfies("2.10.0", ">=2.9.0")).toBe(true);
    expect(versionSatisfies("3.0", ">=2.1.260")).toBe(true);
    expect(versionSatisfies("v2.2.0-beta.1", ">=2.1.260")).toBe(true);
    expect(versionSatisfies("panoma-handoff", ">=2.1.260")).toBe(false);
    expect(versionSatisfies(null, ">=2.1.260")).toBe(false);
    expect(versionSatisfies(undefined, ">=2.1.260")).toBe(false);
    expect(versionSatisfies(null, "*")).toBe(true);
  });
});

describe("profileFor", () => {
  it("gives the verified brief profile to the verified host and flags every other host", () => {
    expect(profileFor("claude-code", "desktop", "2.1.258")).toEqual({ profile: "hook-brief-v1", verified: true });
    expect(profileFor("claude-code", "desktop", "2.1.258", "brief")).toEqual({ profile: "hook-brief-v1", verified: true });
    expect(profileFor("claude-code", "desktop", "2.1.266", "brief")).toEqual({ profile: "mcp-memory-v2", verified: false });
    // Below the verified floor, the brief falls back to the MCP limits and says it is unverified.
    expect(profileFor("claude-code", "desktop", "2.0.9")).toEqual({ profile: "mcp-memory-v2", verified: false });
    expect(profileFor("claude-code", "desktop", null)).toEqual({ profile: "mcp-memory-v2", verified: false });
    expect(profileFor("claude-code", "cli", "2.1.266")).toEqual({ profile: "mcp-memory-v2", verified: false });
    expect(profileFor("codex", "cli", "0.153.0")).toEqual({ profile: "mcp-memory-v2", verified: false });
    expect(profileFor("cursor", "desktop", "1.0.0")).toEqual({ profile: "mcp-memory-v2", verified: false });
  });

  it("keeps the edit signal on its legacy shape and unverified for everyone in delivery A", () => {
    expect(profileFor("claude-code", "desktop", "2.1.266", "signal")).toEqual({ profile: "hook-signal-v1", verified: false });
    expect(profileFor("codex", "cli", "0.153.0", "signal")).toEqual({ profile: "hook-signal-v1", verified: false });
  });

  it("answers the server's own profiles for the MCP and handoff channels", () => {
    expect(profileFor("mcp", "mcp", null, "mcp")).toEqual({ profile: "mcp-memory-v2", verified: true });
    expect(profileFor("claude-code", "desktop", "2.1.266", "handoff")).toEqual({ profile: "handoff-memory-v1", verified: true });
  });
});

describe("capabilityMatrix", () => {
  it("A16/T04: a program, entry or version without a validated parser is unknown on every axis, with no invented attestation", () => {
    const rows = capabilityMatrix({
      installed: { "claude-code": installed },
      observed: [
        { harness: "cursor", entry: "desktop", version: "1.4.0", lastInvocation: "ok", receipts: 0 },
        { harness: "claude-code", entry: "desktop", version: "2.0.1", lastInvocation: "ok", receipts: 3 },
      ],
    });
    const cursor = rows.find((row) => row.harness === "cursor");
    expect(cursor).toEqual({
      harness: "cursor", entry: "desktop", version: "1.4.0", profile: null, configured: null, invocation: "observed",
      events: [], receiptSite: "unknown", subagents: "unknown", limits: null,
    });
    // Same program, a version below the floor: the verified row's claims do not travel down.
    const old = rows.find((row) => row.harness === "claude-code" && row.entry === "desktop");
    expect(old).toMatchObject({ version: "2.0.1", profile: null, events: [], receiptSite: "unknown", subagents: "unknown", limits: null, invocation: "observed", configured: true });
  });

  it("keeps the three kinds of evidence apart: installed, invoked and verified", () => {
    const rows = capabilityMatrix({
      installed: { "claude-code": { ...installed, events: { ...installed.events, SessionEnd: "missing" } } },
      observed: [{ harness: "claude-code", entry: "desktop", version: "2.1.266", lastInvocation: "failed", receipts: 0 }],
    });
    const desktop = rows.find((row) => row.harness === "claude-code" && row.entry === "desktop");
    expect(desktop).toEqual({
      harness: "claude-code", entry: "desktop", version: "2.1.266", profile: null, configured: false, invocation: "failed",
      events: ["PostToolUse", "Stop"], receiptSite: "verified", subagents: "no_delivery",
      limits: null,
    });
    const cli = rows.find((row) => row.harness === "claude-code" && row.entry === "cli");
    expect(cli).toMatchObject({ version: null, profile: null, invocation: "unknown", receiptSite: "unknown", configured: false });
    const codex = rows.find((row) => row.harness === "codex");
    expect(codex).toMatchObject({ profile: null, configured: null, invocation: "unknown", events: [], receiptSite: "unsupported", limits: null });
    expect(rows).toHaveLength(VERIFIED_HOSTS.length);
  });

  it("says configured only when the four events are installed and the command is durable", () => {
    const legacy = capabilityMatrix({ installed: { "claude-code": { ...installed, durable: false } }, observed: [] });
    expect(legacy.find((row) => row.entry === "desktop")?.configured).toBe(false);
    const nothing = capabilityMatrix({ installed: {}, observed: [] });
    expect(nothing.find((row) => row.entry === "desktop")?.configured).toBeNull();
  });
});
