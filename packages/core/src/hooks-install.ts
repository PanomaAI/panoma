/*
  The pure part of installing the hooks: the script, the brand, and the mergers.
  I lived entirely in the CLI (`panoma hooks`) until the bridge won its button: the web and the
  terminal now write the same two files, and two copies of this logic would be two hooks that
  diverge silently. Here there is no disk or processes — only text and objects: who writes and
  where is decided by each surface, with its own customs.
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

interface HookGroup {
  matcher?: string;
  hooks?: { type?: string; command?: string }[];
}

/**
 * Add the `Stop` hook without touching the ones that were already there.
 *
 * Here it does merge instead of giving in to what is foreign, and it is not an exception to the
 * rule of `post-commit`: there the file **is** the hook and writing over it erases someone else's;
 * here the list allows several, so adding ours does not take anyone else's turn. The only thing
 * that gets rewritten is an entry that was already ours —so that the catalog address gets updated—
 * and that is known by the mark, not by similarity.
 */
export function mergeStop(
  settings: Record<string, unknown>,
  order: string,
): { result: Record<string, unknown>; updatedAt: boolean } {
  return mergeEvent(settings, "Stop", order);
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
  return mergeEvent(settings, "PreToolUse", order, "Edit|Write|MultiEdit|NotebookEdit");
}

/** The merger, once: same treatment for any event — what is foreign intact, what is ours up to date. */
function mergeEvent(
  settings: Record<string, unknown>,
  event: string,
  order: string,
  matcher?: string,
): { result: Record<string, unknown>; updatedAt: boolean } {
  const base: Record<string, unknown> = { ...settings };

  const previousList = base["hooks"];
  if (previousList !== undefined && !isObject(previousList)) {
    // In plain English: this text ends on machine surfaces, not on the card.
    throw new Error("settings.hooks is not an object");
  }
  const hooks: Record<string, unknown> = { ...(previousList ?? {}) };

  const previous = hooks[event];
  if (previous !== undefined && !Array.isArray(previous)) {
    throw new Error(`settings.hooks.${event} is not a list`);
  }

  let updatedAt = false;
  const merged = (previous ?? []).map((group) => {
    if (!isObject(group)) return group;
    const list = (group as HookGroup).hooks;
    if (!Array.isArray(list) || !list.some((hook) => hookIsOurs(hook?.command ?? ""))) {
      return group;
    }
    updatedAt = true;
    return {
      ...group,
      hooks: list.map((hook) =>
        hookIsOurs(hook?.command ?? "") ? { ...hook, type: "command", command: order } : hook,
      ),
    };
  });

  if (!updatedAt) {
    merged.push({
      ...(matcher !== undefined ? { matcher } : {}),
      hooks: [{ type: "command", command: order }],
    });
  }

  hooks[event] = merged;
  base["hooks"] = hooks;
  return { result: base, updatedAt };
}

/** Remove only what is ours, and pick up afterwards: an empty `hooks: {}` is leftover trash. */
export function removeStop(settings: Record<string, unknown>): {
  result: Record<string, unknown>;
  removed: number;
} {
  /*
    Sweep ALL the events where there is something of ours: removing the hooks means removing them
    entirely, not just remembering the list of events that had to be touched during installation.
   */
  const base: Record<string, unknown> = { ...settings };
  const previousList = base["hooks"];
  if (!isObject(previousList)) return { result: base, removed: 0 };

  const hooks: Record<string, unknown> = { ...previousList };
  let removed = 0;

  for (const event of Object.keys(hooks)) {
    const previous = hooks[event];
    if (!Array.isArray(previous)) continue;

    const cleanGroups = previous
      .map((group) => {
        if (!isObject(group)) return group;
        const list = (group as HookGroup).hooks;
        if (!Array.isArray(list)) return group;
        const cleanValue = list.filter((hook) => !hookIsOurs(hook?.command ?? ""));
        removed += list.length - cleanValue.length;
        return cleanValue.length > 0 ? { ...group, hooks: cleanValue } : undefined;
      })
      .filter((group) => group !== undefined);

    if (cleanGroups.length > 0) hooks[event] = cleanGroups;
    else delete hooks[event];
  }

  if (Object.keys(hooks).length > 0) base["hooks"] = hooks;
  else delete base["hooks"];

  return { result: base, removed };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
