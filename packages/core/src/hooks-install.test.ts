import { describe, expect, it } from "vitest";
import {
  EDIT_MATCHER,
  LIFECYCLE_MATCHER,
  HOOKS_BRAND,
  asShellLine,
  gitScanOrder,
  hookIdentityOf,
  managedHooks,
  mergeManagedHooks,
  mergePreToolUse,
  mergeStop,
  removeManagedHooks,
  removeStop,
  shellArgv,
  type ManagedHook,
} from "./hooks-install";

/**
 * A02/T02 of the memory plan: two managed hooks and one foreign hook in the same event, and a
 * reinstall or a removal touches only the identity it names.
 *
 * Until 14-Sep-2026 the identity of a hook was the brand alone, and `mergeEvent` rewrote every
 * branded entry of an event with the one order being installed. Nothing failed while each event
 * had one hook of ours; with a `SessionStart` brief and a `SessionEnd` pointer on the way, a
 * reinstall that cannot tell verbs apart would have overwritten one with the other, in silence,
 * inside somebody else's settings file. The wrappers `mergeStop`/`mergePreToolUse`/`removeStop`
 * keep their old outputs (their own suite lives in `apps/cli/src/hooks.test.ts`); what is new is
 * asserted here.
 */

const ARGV = ["/usr/local/bin/node", "/usr/local/lib/node_modules/panoma/dist/index.js"];
const API = "http://127.0.0.1:4173";

function commandsOf(settings: Record<string, unknown>, event: string): { matcher?: string; commands: string[] }[] {
  const groups = (settings["hooks"] as Record<string, { matcher?: string; hooks: { command: string }[] }[]>)[event] ?? [];
  return groups.map((group) => ({
    ...(group.matcher !== undefined ? { matcher: group.matcher } : {}),
    commands: group.hooks.map((hook) => hook.command),
  }));
}

describe("managedHooks", () => {
  it("writes the four events with their verbs, matchers and the brand followed by the verb", () => {
    const hooks = managedHooks(ARGV, "/repo", API);
    expect(hooks.map((hook) => [hook.event, hook.verb, hook.matcher])).toEqual([
      ["Stop", "scan", undefined],
      ["PreToolUse", "signal", EDIT_MATCHER],
      ["SessionStart", "brief", LIFECYCLE_MATCHER],
      ["SessionEnd", "session", undefined],
    ]);
    for (const hook of hooks) {
      expect(hook.command.endsWith(`  ${HOOKS_BRAND} ${hook.verb}`)).toBe(true);
      expect(hook.command.startsWith(asShellLine(ARGV))).toBe(true);
    }
    expect(hooks[0]!.command).toContain(" scan /repo --save --api ");
    expect(hooks[3]!.command).toContain(" memory session /repo --api ");
    expect(gitScanOrder(ARGV, API)).toBe(`${asShellLine(ARGV)} scan . --save --api ${API}`);
  });

  it("§6.2: the SessionStart matcher names the four reasons a context is new, clear included, in the order Claude Code lists them", () => {
    // `clear` was missing and the brief never ran for a session cleared by hand; the brief maps it to a start.
    expect(LIFECYCLE_MATCHER).toBe("startup|resume|clear|compact");
    expect(EDIT_MATCHER).toBe("Edit|Write|MultiEdit|NotebookEdit");
  });
});

describe("hookIdentityOf", () => {
  it("reads the verb off the brand and normalises an empty matcher", () => {
    expect(hookIdentityOf("x scan /r  # panoma-hooks scan", "Stop")).toEqual({ event: "Stop", verb: "scan", bare: false });
    expect(hookIdentityOf("x brief /r  # panoma-hooks brief", "SessionStart", "")).toEqual({
      event: "SessionStart",
      verb: "brief",
      bare: false,
    });
    expect(hookIdentityOf("x signal /r  # panoma-hooks signal", "PreToolUse", EDIT_MATCHER)).toEqual({
      event: "PreToolUse",
      verb: "signal",
      matcher: EDIT_MATCHER,
      bare: false,
    });
  });

  it("infers scan and signal from a bare brand, and calls the rest legacy", () => {
    expect(hookIdentityOf("panoma scan /repo --save --api http://x  # panoma-hooks", "Stop")).toMatchObject({
      verb: "scan",
      bare: true,
    });
    expect(hookIdentityOf("panoma signal /repo --api http://x  # panoma-hooks", "PreToolUse")).toMatchObject({
      verb: "signal",
      bare: true,
    });
    /* A folder called `scan` is quoted as part of a path: it never stands alone as a token. */
    expect(hookIdentityOf("node '/my scan/index.js' brief /r  # panoma-hooks", "Stop")).toMatchObject({ verb: "legacy" });
    expect(hookIdentityOf("x scan /r  # panoma-hooks dance", "Stop")).toMatchObject({ verb: "scan", bare: true });
  });

  it("is undefined for anything without the brand", () => {
    expect(hookIdentityOf("npm run format", "Stop")).toBeUndefined();
    expect(hookIdentityOf("panoma scan . # panoma-hook", "Stop")).toBeUndefined();
  });
});

describe("shellArgv", () => {
  it("undoes asShellLine for paths with spaces and quotes, and stops at the brand", () => {
    const argv = ["/Applications/Node Tools/node", "/Users/it's me/panoma/dist/index.js", "scan", "/a b", "--api", API];
    expect(shellArgv(`${asShellLine(argv)}  ${HOOKS_BRAND} scan`)).toEqual(argv);
  });

  it("stops at the redirections of the post-commit line", () => {
    expect(shellArgv("node /p/index.js scan . --save >/dev/null 2>&1 &")).toEqual(["node", "/p/index.js", "scan", ".", "--save"]);
  });

  it("reads double quotes from a line somebody wrote by hand", () => {
    expect(shellArgv('"/opt/my node/node" "/x y/index.js" scan .')).toEqual(["/opt/my node/node", "/x y/index.js", "scan", "."]);
  });
});

describe("A02/T02: two managed hooks and one foreign hook in the same event", () => {
  const foreign = { matcher: "Bash", hooks: [{ type: "command", command: "npm run lint" }] };
  const signal: ManagedHook = {
    event: "PreToolUse",
    verb: "signal",
    matcher: EDIT_MATCHER,
    command: `panoma signal /repo --api ${API}  ${HOOKS_BRAND} signal`,
  };
  const brief: ManagedHook = {
    event: "PreToolUse",
    verb: "brief",
    matcher: "Task",
    command: `panoma brief /repo --api ${API}  ${HOOKS_BRAND} brief`,
  };

  function installed(): Record<string, unknown> {
    const { result, added } = mergeManagedHooks({ hooks: { PreToolUse: [foreign] } }, [signal, brief]);
    expect(added).toBe(2);
    return result;
  }

  it("reinstalling one identity replaces only that entry and keeps the others in place", () => {
    const before = installed();
    const newer: ManagedHook = { ...signal, command: signal.command.replace("4173", "4188") };
    const { result, updated, added } = mergeManagedHooks(before, [newer]);

    expect({ updated, added }).toEqual({ updated: 1, added: 0 });
    expect(commandsOf(result, "PreToolUse")).toEqual([
      { matcher: "Bash", commands: ["npm run lint"] },
      { matcher: EDIT_MATCHER, commands: [newer.command] },
      { matcher: "Task", commands: [brief.command] },
    ]);
    /* The foreign group is the very same object: not even a copy was made of it. */
    expect((result["hooks"] as Record<string, unknown[]>)["PreToolUse"]![0]).toBe(foreign);
  });

  it("removing one identity leaves the foreign hook and the other one of ours", () => {
    const { result, removed } = removeManagedHooks(installed(), [{ event: "PreToolUse", verb: "brief" }]);
    expect(removed).toBe(1);
    expect(commandsOf(result, "PreToolUse")).toEqual([
      { matcher: "Bash", commands: ["npm run lint"] },
      { matcher: EDIT_MATCHER, commands: [signal.command] },
    ]);
  });

  it("removing everything of ours leaves only the foreign hook", () => {
    const { result, removed } = removeManagedHooks(installed());
    expect(removed).toBe(2);
    expect(commandsOf(result, "PreToolUse")).toEqual([{ matcher: "Bash", commands: ["npm run lint"] }]);
  });

  it("never touches another event, another verb or another matcher", () => {
    const stop = { hooks: [{ type: "command", command: `panoma scan /repo  ${HOOKS_BRAND} scan` }] };
    const settings = { permissions: { allow: ["Bash(git status)"] }, hooks: { Stop: [stop], PreToolUse: [foreign] } };
    const { result } = mergeManagedHooks(settings, [{ ...signal, matcher: "Edit" }]);
    expect((result["hooks"] as Record<string, unknown>)["Stop"]).toEqual([stop]);
    expect(result["permissions"]).toEqual(settings.permissions);
    expect(commandsOf(result, "PreToolUse")).toEqual([
      { matcher: "Bash", commands: ["npm run lint"] },
      { matcher: "Edit", commands: [signal.command] },
    ]);
  });

  it("folds a duplicated identity into one entry", () => {
    const twice = { matcher: EDIT_MATCHER, hooks: [{ type: "command", command: signal.command }, { type: "command", command: signal.command }] };
    const { result, updated } = mergeManagedHooks({ hooks: { PreToolUse: [twice] } }, [signal]);
    expect(updated).toBe(1);
    expect(commandsOf(result, "PreToolUse")).toEqual([{ matcher: EDIT_MATCHER, commands: [signal.command] }]);
  });
});

describe("entries with the bare brand are ours and upgrade in place", () => {
  const old = {
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: `panoma scan /repo --save --api http://localhost:9999  ${HOOKS_BRAND}` }] }],
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "other" }] },
        { matcher: EDIT_MATCHER, hooks: [{ type: "command", command: `panoma signal /repo --api http://localhost:9999  ${HOOKS_BRAND}` }] },
      ],
    },
  };

  it("a full install replaces the old Stop and PreToolUse entries and adds the two new events", () => {
    const hooks = managedHooks(ARGV, "/repo", API);
    const { result, updated, added } = mergeManagedHooks(old, hooks);
    expect({ updated, added }).toEqual({ updated: 2, added: 2 });
    expect(commandsOf(result, "Stop")).toEqual([{ commands: [hooks[0]!.command] }]);
    expect(commandsOf(result, "PreToolUse")).toEqual([
      { matcher: "Bash", commands: ["other"] },
      { matcher: EDIT_MATCHER, commands: [hooks[1]!.command] },
    ]);
    expect(commandsOf(result, "SessionStart")).toEqual([{ matcher: LIFECYCLE_MATCHER, commands: [hooks[2]!.command] }]);
    expect(commandsOf(result, "SessionEnd")).toEqual([{ commands: [hooks[3]!.command] }]);
    /* And a second install on top changes nothing: same identities, same text. */
    const again = mergeManagedHooks(result, hooks);
    expect({ updated: again.updated, added: again.added }).toEqual({ updated: 4, added: 0 });
    expect(JSON.stringify(again.result)).toBe(JSON.stringify(result));
  });

  it("removal by identity reaches the old entries too, and removeStop sweeps them all", () => {
    expect(removeManagedHooks(old, [{ event: "Stop", verb: "scan" }]).removed).toBe(1);
    expect(removeManagedHooks(old, [{ event: "PreToolUse", verb: "signal" }]).removed).toBe(1);
    expect(removeManagedHooks(old, [{ event: "SessionStart", verb: "brief" }]).removed).toBe(0);
    const { result, removed } = removeStop(old);
    expect(removed).toBe(2);
    expect(commandsOf(result, "PreToolUse")).toEqual([{ matcher: "Bash", commands: ["other"] }]);
    expect((result["hooks"] as Record<string, unknown>)["Stop"]).toBeUndefined();
  });

  it("the wrappers keep their shape: mergeStop and mergePreToolUse report updatedAt", () => {
    const order = `panoma scan /repo --save --api ${API}  ${HOOKS_BRAND}`;
    expect(mergeStop({}, order)).toEqual({ result: { hooks: { Stop: [{ hooks: [{ type: "command", command: order }] }] } }, updatedAt: false });
    expect(mergeStop(old, order).updatedAt).toBe(true);
    expect(mergePreToolUse(old, `panoma signal /repo  ${HOOKS_BRAND}`).updatedAt).toBe(true);
  });
});
