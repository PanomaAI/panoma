/*
  The pure part of installing the hooks: the script, the brand, the identities, and the mergers.
  I lived entirely in the CLI (`panoma hooks`) until the bridge won its button: the web and the
  terminal now write the same two files, and two copies of this logic would be two hooks that
  diverge silently. Here there is no disk or processes — only text and objects: who writes and
  where is decided by each surface, with its own customs.

  A managed hook has an identity, and the identity is more than the brand. For a year the brand
  alone told ours apart, and reinstalling rewrote EVERY branded entry of an event with the one
  order being installed. That was harmless with one hook per event and becomes a bug the day an
  event carries two of ours: the memory plan adds a `SessionStart` brief and a `SessionEnd`
  pointer, and a reinstall that cannot tell them apart would overwrite one with the other. So the
  identity is brand + event + verb + matcher, the verb rides on the brand itself (`# panoma-hooks
  scan`), and a reinstall replaces only the entry with the same identity. Old entries with the
  bare brand are still ours: their verb is read off the command, so they upgrade in place instead
  of leaving a duplicate behind.
 */

/**
 * The brand that distinguishes our hooks from those of any other.
 *
 * It goes inside the order itself because in a `.json` there is no room for comments: Claude
 * Code's hooks are executed with a shell, so a `#` at the end of the line is both a valid comment
 * and a signature that can be searched for. Detecting by "contains the word Panoma" would not
 * work: the repository path can be called anything.
 */
export const HOOKS_BRAND = "# panoma-hooks";

export function hookIsOurs(text: string): boolean {
  return text.includes(HOOKS_BRAND);
}

/** The same order, already ready for a shell file. Quote only what you need. */
export function asShellLine(argv: string[]): string {
  return argv
    .map((part) => (/^[\w@%+=:,./-]+$/.test(part) ? part : `'${part.replace(/'/g, `'\\''`)}'`))
    .join(" ");
}

/**
 * The inverse of `asShellLine`, for lines this module wrote: the argv back out of a shell line.
 *
 * It stops at the first unquoted `#` (our brand), redirection or `&`, because the post-commit
 * line ends in `>/dev/null 2>&1 &` and none of that is an argument. It understands single quotes
 * with the `'\''` escape — the only quoting `asShellLine` emits — and double quotes for a line
 * somebody edited by hand. It is what lets the bridge and `panoma hooks` say whether the command
 * a hook would call still exists on this disk, without running it.
 */
export function shellArgv(line: string): string[] {
  const argv: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i]!)) i++;
    if (i >= line.length) break;
    const head = line[i]!;
    if (head === "#" || head === ">" || head === "&" || head === "|" || head === ";") break;
    if (line.startsWith("2>", i)) break;

    let token = "";
    while (i < line.length && !/\s/.test(line[i]!)) {
      const char = line[i]!;
      if (char === "'" || char === '"') {
        const end = line.indexOf(char, i + 1);
        if (end < 0) return argv;
        token += line.slice(i + 1, end);
        i = end + 1;
      } else if (char === "\\" && i + 1 < line.length) {
        token += line[i + 1];
        i += 2;
      } else {
        token += char;
        i += 1;
      }
    }
    argv.push(token);
  }
  return argv;
}

/**
 * The script that is left in `post-commit`.
 *
 * Three decisions, and all three are the same: **a hook cannot cost the commit anything**. In the
 * background, with the output discarded and with a `exit 0` at the end, so that neither the
 * offline catalog nor a network failure nor an unbuilt Panoma can cause `git commit` to fail. The
 * day one of these hooks breaks a commit, what people do is not open a ticket: they delete it, and
 * rightly so.
 */
export function postCommitScript(order: string): string {
  return [
    "#!/bin/sh",
    HOOKS_BRAND,
    "#",
    "# Tells the catalog what just happened, so nobody has to remember to.",
    "# In the background and quiet: if Panoma is not running, the commit never notices.",
    `${order} >/dev/null 2>&1 &`,
    "exit 0",
    "",
  ].join("\n");
}

/**
 * What the git hook runs. It can say `.` because git always runs its hooks from the root of the
 * repository; the Claude Code hooks cannot, and carry the absolute root instead.
 */
export function gitScanOrder(argv: string[], api: string): string {
  return asShellLine([...argv, "scan", ".", "--save", "--api", api]);
}

/** The settings file as both surfaces write it: same indentation, same final newline. */
export function settingsText(settings: Record<string, unknown>): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** The Claude Code events panoma manages, in the order they are written. */
export const MANAGED_EVENTS = ["Stop", "PreToolUse", "SessionStart", "SessionEnd"] as const;
export type HookEvent = (typeof MANAGED_EVENTS)[number];

export type ManagedVerb = "scan" | "signal" | "brief" | "session";

/** One verb per event: the identity a fresh install writes there. */
export const VERB_OF_EVENT: Record<HookEvent, ManagedVerb> = {
  Stop: "scan",
  PreToolUse: "signal",
  SessionStart: "brief",
  SessionEnd: "session",
};

/**
 * The tools that touch files. Unscoped, the signal would fire on every `Bash` too, and that is
 * paying for a catalog query on every `ls`.
 */
export const EDIT_MATCHER = "Edit|Write|MultiEdit|NotebookEdit";

/**
 * The four moments a context is new: a session starts, resumes, is cleared, or has just been
 * compacted. The brief is delivered at each one because what a previous context saw is gone at
 * all four — `/clear` empties it as completely as a startup, and the brief maps `clear` to a
 * start (plan §6.2). Without `clear` in the matcher the hook never ran for it, and a session
 * cleared by hand went on without the rules it had just lost.
 */
export const LIFECYCLE_MATCHER = "startup|resume|clear|compact";

export interface ManagedHook {
  event: HookEvent;
  verb: ManagedVerb;
  matcher?: string;
  command: string;
}

/** The order with its signature: the brand followed by the verb, after two spaces. */
export function managedCommand(argv: string[], verbArgs: string[], verb: ManagedVerb): string {
  return `${asShellLine([...argv, ...verbArgs])}  ${HOOKS_BRAND} ${verb}`;
}

/**
 * The four hooks a full install writes for Claude Code, from one argv, one root and one address.
 *
 * Both surfaces call this and nothing else to know what goes into the settings file, so that the
 * button and the terminal produce the same bytes: a divergence between them is a hook that only
 * one of the two can recognise as its own.
 */
export function managedHooks(argv: string[], root: string, api: string): ManagedHook[] {
  return [
    {
      event: "Stop",
      verb: "scan",
      command: managedCommand(argv, ["scan", root, "--save", "--api", api], "scan"),
    },
    {
      event: "PreToolUse",
      verb: "signal",
      matcher: EDIT_MATCHER,
      command: managedCommand(argv, ["signal", root, "--api", api], "signal"),
    },
    {
      event: "SessionStart",
      verb: "brief",
      matcher: LIFECYCLE_MATCHER,
      command: managedCommand(argv, ["brief", root, "--api", api], "brief"),
    },
    {
      event: "SessionEnd",
      verb: "session",
      command: managedCommand(argv, ["memory", "session", root, "--api", api], "session"),
    },
  ];
}

const MANAGED_VERBS: ReadonlySet<string> = new Set<ManagedVerb>(["scan", "signal", "brief", "session"]);

export function isManagedVerb(value: string): value is ManagedVerb {
  return MANAGED_VERBS.has(value);
}

export interface HookIdentity {
  event: string;
  /** `legacy` only when the entry carries the bare brand and its verb cannot be read off it. */
  verb: ManagedVerb | "legacy";
  matcher?: string;
  /** Whether the brand came without its verb — an entry written before identities existed. */
  bare: boolean;
}

/**
 * Whose is this entry, and which one of ours.
 *
 * `undefined` when it is not ours. A brand followed by a known verb is the identity as written.
 * A bare brand is an entry from before verbs existed: its verb is inferred from the argv tokens
 * (`scan` for the old `Stop`, `signal` for the old `PreToolUse`), so a reinstall finds it and
 * upgrades it in place. Only whole tokens count — a folder called `scan` is quoted as part of a
 * path and never stands alone.
 */
export function hookIdentityOf(command: string, event: string, matcher?: string): HookIdentity | undefined {
  const at = command.indexOf(HOOKS_BRAND);
  if (at < 0) return undefined;
  const normalized = matcher === undefined || matcher === "" ? undefined : matcher;
  const after = command.slice(at + HOOKS_BRAND.length).trim().split(/\s+/)[0] ?? "";
  if (isManagedVerb(after)) {
    return { event, verb: after, ...(normalized !== undefined ? { matcher: normalized } : {}), bare: false };
  }
  const tokens = shellArgv(command.slice(0, at));
  const inferred = tokens.find((token) => token === "scan" || token === "signal") as ManagedVerb | undefined;
  return {
    event,
    verb: inferred ?? "legacy",
    ...(normalized !== undefined ? { matcher: normalized } : {}),
    bare: true,
  };
}

function identityKey(event: string, verb: string, matcher: string | undefined): string {
  return JSON.stringify([event, verb, matcher ?? null]);
}

interface HookGroup {
  matcher?: string;
  hooks?: { type?: string; command?: string }[];
}

/**
 * Put the managed hooks in, replacing only what has the same identity.
 *
 * Here it does merge instead of giving in to what is foreign, and it is not an exception to the
 * rule of `post-commit`: there the file **is** the hook and writing over it erases someone else's;
 * here the list allows several, so adding ours does not take anyone else's turn. What gets
 * rewritten is the entry with the same identity —so that the catalog address gets updated— and
 * everything else, ours or not, keeps its place and its order. Two entries with the same identity
 * are one hook firing twice, so the second is folded into the first.
 */
export function mergeManagedHooks(
  settings: Record<string, unknown>,
  hooks: ManagedHook[],
): { result: Record<string, unknown>; updated: number; added: number } {
  const base: Record<string, unknown> = { ...settings };

  const previousList = base["hooks"];
  if (previousList !== undefined && !isObject(previousList)) {
    // In plain English: this text ends on machine surfaces, not on the card.
    throw new Error("settings.hooks is not an object");
  }
  const all: Record<string, unknown> = { ...(previousList ?? {}) };

  let updated = 0;
  let added = 0;
  for (const hook of hooks) {
    const previous = all[hook.event];
    if (previous !== undefined && !Array.isArray(previous)) {
      throw new Error(`settings.hooks.${hook.event} is not a list`);
    }

    const wanted = identityKey(hook.event, hook.verb, hook.matcher);
    let replaced = false;
    const merged: unknown[] = [];
    for (const group of previous ?? []) {
      if (!isObject(group) || !Array.isArray((group as HookGroup).hooks)) {
        merged.push(group);
        continue;
      }
      const matcher = typeof group["matcher"] === "string" ? (group["matcher"] as string) : undefined;
      let touched = false;
      const next: unknown[] = [];
      for (const entry of (group as HookGroup).hooks ?? []) {
        const identity = entry?.command !== undefined ? hookIdentityOf(entry.command, hook.event, matcher) : undefined;
        if (!identity || identityKey(identity.event, identity.verb, identity.matcher) !== wanted) {
          next.push(entry);
          continue;
        }
        touched = true;
        if (replaced) continue;
        replaced = true;
        next.push({ ...entry, type: "command", command: hook.command });
      }
      if (!touched) merged.push(group);
      else if (next.length > 0) merged.push({ ...group, hooks: next });
    }

    if (replaced) {
      updated += 1;
    } else {
      merged.push({
        ...(hook.matcher !== undefined ? { matcher: hook.matcher } : {}),
        hooks: [{ type: "command", command: hook.command }],
      });
      added += 1;
    }
    all[hook.event] = merged;
  }

  base["hooks"] = all;
  return { result: base, updated, added };
}

/**
 * Remove ours — all of them, or only the identities named — and pick up afterwards: an empty
 * `hooks: {}` is leftover trash.
 *
 * Without identities it sweeps EVERY event where there is something of ours, legacy entries
 * included: removing the hooks means removing them entirely, not just remembering the list of
 * events that had to be touched during installation. With identities, an entry goes only when its
 * event and verb match one of them, so the rest of ours stay exactly where they were.
 */
export function removeManagedHooks(
  settings: Record<string, unknown>,
  identities?: { event: string; verb: ManagedVerb }[],
): { result: Record<string, unknown>; removed: number } {
  const base: Record<string, unknown> = { ...settings };
  const previousList = base["hooks"];
  if (!isObject(previousList)) return { result: base, removed: 0 };

  const all: Record<string, unknown> = { ...previousList };
  let removed = 0;

  const goes = (identity: HookIdentity): boolean =>
    identities === undefined ||
    identities.some((wanted) => wanted.event === identity.event && wanted.verb === identity.verb);

  for (const event of Object.keys(all)) {
    const previous = all[event];
    if (!Array.isArray(previous)) continue;

    const cleanGroups = previous
      .map((group) => {
        if (!isObject(group)) return group;
        const list = (group as HookGroup).hooks;
        if (!Array.isArray(list)) return group;
        const matcher = typeof group["matcher"] === "string" ? (group["matcher"] as string) : undefined;
        const kept = list.filter((hook) => {
          const identity = hook?.command !== undefined ? hookIdentityOf(hook.command, event, matcher) : undefined;
          return !(identity && goes(identity));
        });
        removed += list.length - kept.length;
        return kept.length > 0 ? { ...group, hooks: kept } : undefined;
      })
      .filter((group) => group !== undefined);

    if (cleanGroups.length > 0) all[event] = cleanGroups;
    else delete all[event];
  }

  if (Object.keys(all).length > 0) base["hooks"] = all;
  else delete base["hooks"];

  return { result: base, removed };
}

/**
 * The `Stop` hook on its own, as the first installer wrote it. A thin wrapper now: the identity
 * is `Stop/scan`, so an entry with the old bare brand and a `scan` in its argv is found and
 * replaced in place.
 */
export function mergeStop(
  settings: Record<string, unknown>,
  order: string,
): { result: Record<string, unknown>; updatedAt: boolean } {
  const { result, updated } = mergeManagedHooks(settings, [{ event: "Stop", verb: "scan", command: order }]);
  return { result, updatedAt: updated > 0 };
}

/**
 * The hook of the signals: before each edition, ask if there is a dormant note on that path. The
 * `matcher` limits to the tools that touch files — triggering it on each `Bash` would be paying a
 * query for each `ls`.
 */
export function mergePreToolUse(
  settings: Record<string, unknown>,
  order: string,
): { result: Record<string, unknown>; updatedAt: boolean } {
  const { result, updated } = mergeManagedHooks(settings, [
    { event: "PreToolUse", verb: "signal", matcher: EDIT_MATCHER, command: order },
  ]);
  return { result, updatedAt: updated > 0 };
}

/** Remove everything of ours, from every event. The name stays for the callers that knew it. */
export function removeStop(settings: Record<string, unknown>): {
  result: Record<string, unknown>;
  removed: number;
} {
  return removeManagedHooks(settings);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
