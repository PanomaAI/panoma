import { normalizeAccountUrl } from "./account-url";
import { openableUrl } from "./open-url";

/**
 * "Open everything": one click, and the whole working set of a project is in front of you.
 *
 * Sitting down to work on a project is never one gesture. It is the editor on the folder, a
 * terminal with the dev server, the agent in another terminal, and then a round of the browser:
 * the repository, the deploy dashboard, the database console, `localhost:3000`. Panoma already
 * knows every one of those addresses —it detected the service links, the owner wrote the accounts,
 * the runbook says how the project starts— and until now it offered them one by one.
 *
 * A **plan** is the ordered list of what one click opens, kept per project. This module is the
 * pure half: what a plan looks like, what can go in it, how a suggestion is built from what the
 * catalog knows, and how a stored plan is resolved against what this machine has today. Nothing
 * here touches the disk or starts a process; that lives in `open-targets.ts` and in the route.
 * It is split this way for the usual reason: the tests on this site do not transform `.tsx`, and
 * a rule that only exists inside a component has nobody to defend it.
 *
 * Two rules that shape everything below:
 *
 * - **The plan stores keys, not commands or paths.** A step says `editor:cursor` or
 *   `link:service:repository`, and the server looks those up in the candidates it computed from
 *   the catalog and from the tools installed here. What the browser sends is never what gets
 *   executed. The two exceptions are marked and bounded: a terminal step may carry a command the
 *   owner wrote, and a custom link carries its address. Both are validated on save, stored in the
 *   catalog and read back from there when running: the run route accepts neither from its body.
 * - **A plan survives what this machine does.** Uninstalling Cursor does not break the plan: the
 *   step is reported as missing when running, and comes back the day Cursor does.
 */

export const PLAN_VERSION = 1 as const;

/** Enough for a real desk —four tools and a dozen links— and small enough to read in a list. */
export const MAX_STEPS = 24;
export const MAX_COMMAND = 300;
export const MAX_LABEL = 80;
export const MAX_URL = 2048;

export type CandidateKind = "editor" | "desktop" | "app" | "agent" | "terminal" | "folder" | "link";

export type LinkSource = "service" | "account" | "distribution" | "remote";

/**
 * Something this project could open, as the server computed it.
 *
 * Tools come from what is installed here; links from the catalog. The `key` is what a plan stores
 * and what a run resolves, so it has to stay stable across scans: a service id, an account label,
 * a distribution's kind and label. Nothing positional.
 */
export interface Candidate {
  key: string;
  kind: CandidateKind;
  /** What a person reads: "Cursor", "GitHub", "Vercel", "localhost:3000". */
  name: string;
  /** The second line: a service's label, a distribution's evidence, a tool's kind. */
  detail?: string;
  /** Links only. Tools resolve on the server and carry no path. */
  url?: string;
  /** Links only: where the address came from. */
  source?: LinkSource;
  /** The brand icon id of a tool, or the simple-icons slug of a service. */
  icon?: string;
  /** Whether the suggestion picks it when the project has no plan yet. */
  suggested?: boolean;
}

export interface OpenStep {
  key: string;
  /**
   * What this was called the day it went into the plan.
   *
   * The key alone cannot name a step whose candidate is gone: `editor:cursor` can be turned back
   * into "Cursor" from a table, but `agent:claude-cli` and `link:distribution:npm:shop` cannot, and
   * an uninstalled tool or a deleted account link is exactly the case where the report has to say
   * which thing it is talking about. It is written by whoever saves the plan, bounded like a label,
   * and it is never executed: it only gets printed.
   */
  name?: string;
  /** Only with `terminal`: what to run once the terminal is open, written by the owner. */
  command?: string;
  /** Only with `link:custom`: the address, already normalized to `http(s)`. */
  url?: string;
  /** Only with `link:custom`: what to call it. */
  label?: string;
}

export interface OpenPlan {
  version: typeof PLAN_VERSION;
  steps: OpenStep[];
}

export const TERMINAL_KEY = "terminal";
export const FOLDER_KEY = "folder";
export const CUSTOM_LINK_KEY = "link:custom";
export const REMOTE_LINK_KEY = "link:remote";

/** Preserve the browser's saved desktop destination without rewriting installed-app actions. */
export function desktopPreference(value: string): string {
  return /^app:[a-z0-9-]+$/.test(value) ? value.replace(/^app:/, "desktop:") : value;
}

/*
  Every key a plan may carry. The tool ids come from closed lists on the server (`EDITORS`, `APPS`,
  the providers), and a link's tail is a service id, an account label or a distribution's
  kind and label — free text, bounded, on one line.
 */
const KEY = /^(?:(?:editor|desktop|agent):[a-z0-9][a-z0-9-]{0,40}|app:[a-z0-9][a-z0-9-]{0,40}:[a-z0-9][a-z0-9-]{0,40}|terminal|folder|link:custom|link:remote|link:(?:service|account|distribution):[^\r\n]{1,160})$/;

export type PlanProblem =
  | "notAPlan"
  | "tooManySteps"
  | "empty"
  | "badKey"
  | "commandWhere"
  | "commandTooLong"
  | "urlWhere"
  | "badUrl";

export type NormalizedPlan =
  | { ok: true; plan: OpenPlan }
  | { ok: false; problem: PlanProblem; at?: number };

/**
 * One printable line, or nothing.
 *
 * The whole control range goes, not only the three whitespace ones: a NUL inside a `#!/bin/sh`
 * makes bash warn and skip the line, and an ESC sequence in the command is written to the terminal
 * by the script's own echo before anything runs. Only the operator of this machine can put a
 * command here, so it is not a door — but it is stored text that gets printed, and printed text is
 * cheaper to clean than to explain.
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]+/g;

function oneLine(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(CONTROL, " ").trim().slice(0, limit);
  return text || undefined;
}

/**
 * What arrives from the browser, turned into a plan or refused with the reason.
 *
 * It is strict on purpose. A step with a `command` on anything but a terminal is refused instead
 * of having the command dropped: dropping it would save a plan the owner did not write, and the
 * first time they notice is when the terminal opens with nothing running. Same with a link that
 * cannot be understood — it is said, with the row, instead of being swallowed. That is the deal
 * the accounts editor already keeps, and this is the same person writing.
 */
export function normalizePlan(raw: unknown): NormalizedPlan {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { steps?: unknown }).steps)) {
    return { ok: false, problem: "notAPlan" };
  }
  const given = (raw as { steps: unknown[] }).steps;
  if (given.length > MAX_STEPS) return { ok: false, problem: "tooManySteps" };

  const steps: OpenStep[] = [];
  const seen = new Set<string>();

  for (const [at, entry] of given.entries()) {
    if (!entry || typeof entry !== "object") return { ok: false, problem: "badKey", at };
    const item = entry as Record<string, unknown>;
    const key = typeof item["key"] === "string" ? item["key"] : "";
    if (!KEY.test(key)) return { ok: false, problem: "badKey", at };

    const step: OpenStep = { key };
    const command = oneLine(item["command"], MAX_COMMAND + 1);
    if (command !== undefined) {
      if (key !== TERMINAL_KEY) return { ok: false, problem: "commandWhere", at };
      if (command.length > MAX_COMMAND) return { ok: false, problem: "commandTooLong", at };
      step.command = command;
    }

    const name = oneLine(item["name"], MAX_LABEL);
    if (name) step.name = name;

    if (key === CUSTOM_LINK_KEY) {
      const link = normalizeAccountUrl(oneLine(item["url"], MAX_URL));
      /*
        Two validators for one address was one too many. `normalizeAccountUrl` understands what a
        person types —a bare domain, `localhost:3000`— and `openableUrl` decides what may become the
        argument of `open`, and the second is stricter: a space inside the path passes the first and
        is refused by the second. The plan saved without complaint and the step failed on every
        single click, with the dialog unable to say why because the validator that had let it in
        still approved of it. Whatever is stored has to pass the rule that will open it.
       */
      if (link.kind !== "url" || !openableUrl(link.url)) {
        return { ok: false, problem: "badUrl", at };
      }
      step.url = link.url;
      const label = oneLine(item["label"], MAX_LABEL);
      if (label) step.label = label;
    } else if (item["url"] !== undefined || item["label"] !== undefined) {
      return { ok: false, problem: "urlWhere", at };
    }

    /*
      The same catalog key twice opens the same thing twice. Terminals and custom links may repeat
      —two terminals with two commands is a real desk— so they are told apart by what they carry.
     */
    const identity =
      key === TERMINAL_KEY
        ? `${key}\0${step.command ?? ""}`
        : key === CUSTOM_LINK_KEY
          ? `${key}\0${step.url}`
          : key;
    if (seen.has(identity)) continue;
    seen.add(identity);
    steps.push(step);
  }

  if (steps.length === 0) return { ok: false, problem: "empty" };
  return { ok: true, plan: { version: PLAN_VERSION, steps } };
}

/**
 * A stored value, read back. Anything that is not a plan reads as "no plan": the column is
 * `jsonb` and a row written by a future version must not blank the button.
 */
export function readPlan(stored: unknown): OpenPlan | null {
  const result = normalizePlan(stored);
  return result.ok ? result.plan : null;
}

/**
 * What a project without a plan opens: the first suggestion, built from the catalog.
 *
 * Links first —the browser tabs—, then the terminal, then the one tool where work happens, so
 * that the editor is what ends up on top. Which tool is the one the owner opens by habit: the
 * split button's preference, if it is installed here, and otherwise the first editor.
 *
 * What it does **not** put in: a command in the terminal, a desktop app or an agent when they are
 * not the preference, and the console-only links. Running something the owner has not read is
 * not a suggestion; it is a surprise, and the configurator is one click away.
 */
export function suggestPlan(candidates: Candidate[], preferred?: string): OpenPlan {
  const links = candidates.filter((candidate) => candidate.kind === "link" && candidate.suggested);
  const terminal = candidates.find((candidate) => candidate.key === TERMINAL_KEY);
  const chosen =
    (preferred && candidates.find((c) => c.key === preferred && c.kind !== "link" && c.kind !== "app")) ??
    candidates.find((candidate) => candidate.kind === "editor") ??
    candidates.find((candidate) => candidate.kind === "desktop");

  const steps: OpenStep[] = [
    ...links.map((link) => ({ key: link.key })),
    ...(terminal ? [{ key: terminal.key }] : []),
    ...(chosen && chosen.key !== TERMINAL_KEY ? [{ key: chosen.key }] : []),
  ];
  return { version: PLAN_VERSION, steps };
}

export interface ResolvedStep {
  step: OpenStep;
  /** The candidate that matches, or `undefined` for a custom link, which carries its own address. */
  candidate?: Candidate;
}

/**
 * A stored plan against what exists today.
 *
 * A key with no candidate behind it —an editor that was uninstalled, an account link the owner
 * deleted— goes to `missing`, so the run can say "Cursor is no longer here" instead of skipping it
 * in silence. The step stays in the plan: the day the tool is back, so is the step.
 *
 * The whole step travels and not its key, because the key is not a name: the step remembers what
 * it was called the day it was saved, and that is the only thing that can name an agent or a
 * service link that the catalog no longer resolves.
 */
export function resolvePlan(
  plan: OpenPlan,
  candidates: Candidate[],
): { steps: ResolvedStep[]; missing: OpenStep[] } {
  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const steps: ResolvedStep[] = [];
  const missing: OpenStep[] = [];
  for (const step of plan.steps) {
    if (step.key === CUSTOM_LINK_KEY) {
      if (step.url) steps.push({ step });
      continue;
    }
    const candidate = byKey.get(step.key);
    if (candidate) steps.push({ step, candidate });
    else missing.push(step);
  }
  return { steps, missing };
}

/**
 * A plan from a list of keys and nothing else.
 *
 * It is what the run route accepts from a browser that could not save: a selection among what the
 * server itself offered. No command and no address can travel this way, which is the point.
 */
export function planFromKeys(keys: string[], candidates: Candidate[]): OpenPlan {
  const known = new Set(candidates.map((candidate) => candidate.key));
  const steps: OpenStep[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (typeof key !== "string" || !known.has(key) || seen.has(key)) continue;
    seen.add(key);
    steps.push({ key });
  }
  return { version: PLAN_VERSION, steps };
}

/** The names of what a plan would open, in order, for a tooltip or a terminal line. */
export function describePlan(
  plan: OpenPlan,
  candidates: Candidate[],
  labels: Record<string, string> = {},
): string[] {
  const { steps } = resolvePlan(plan, candidates);
  return steps.map(({ step, candidate }) => {
    const name = stepDisplayName(step, candidate, labels);
    return step.command ? `${name} · ${step.command}` : name;
  });
}

/**
 * What each editor and each desktop app is called.
 *
 * They live here, in the module with no imports of its own, because two surfaces need them and one
 * of them is a browser: the route resolves the name of a step whose tool is gone, and the dialog
 * paints that same step. `open-targets.ts` —which starts processes— reads the table from here, so
 * there is one table and not two that drift.
 */
export const EDITOR_LABELS: Record<string, string> = {
  cursor: "Cursor",
  code: "VS Code",
  windsurf: "Windsurf",
  subl: "Sublime Text",
  webstorm: "WebStorm",
  idea: "IntelliJ IDEA",
  zed: "Zed",
};

export const DESKTOP_LABELS: Record<string, string> = {
  "claude-app": "Claude",
  "chatgpt-app": "ChatGPT",
};

/**
 * What a step is called, wherever it is printed.
 *
 * Four sources in order, and the order is the point: the candidate that resolved it today, the
 * name stored the day it was saved, the word the caller's dictionary has for it —"Terminal",
 * "Folder"—, and only then something derived from the key. Deriving is the last resort because a
 * key is not a name: splitting `link:distribution:npm:npm: shop` on every colon left the report
 * saying " shop", and `editor:cursor` read as "cursor" in the dialog while the terminal said
 * "Cursor" for the very same step.
 */
export function stepDisplayName(
  step: OpenStep,
  candidate?: Candidate,
  /** `terminal`, `folder` and `link:remote` in the reader's language. */
  labels: Record<string, string> = {},
): string {
  if (candidate) return candidate.name;
  if (step.name) return step.name;
  if (step.key === CUSTOM_LINK_KEY) {
    return step.label || (step.url ? hostOf(step.url) : labels[step.key] || step.key);
  }
  if (labels[step.key]) return labels[step.key]!;

  const [family, ...rest] = step.key.split(":");
  const first = rest[0] ?? "";
  if (family === "editor") return EDITOR_LABELS[first] ?? first;
  if (family === "desktop") return DESKTOP_LABELS[first] ?? first;
  if (family === "agent") return first;
  if (family === "link") {
    /* `link:distribution:<kind>:<label>` keeps the label; the rest keep everything after the source. */
    const tail = first === "distribution" ? rest.slice(2).join(":") : rest.slice(1).join(":");
    return tail || step.key;
  }
  return step.key;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Trailing slash and case do not make two addresses: `GitHub.com/x/` is `github.com/x`. */
function sameUrl(url: string): string {
  return url.replace(/\/+$/, "").toLowerCase();
}

/**
 * The link candidates of a project, from what the catalog holds.
 *
 * Four sources, in the order they are trusted for a suggestion: the service links the scan
 * resolved (`deep` ones are suggested, `console` ones are offered), the git remote when it is an
 * `https` address no resolver recognized, the accounts the owner wrote —always suggested: a person
 * typed them—, and the distributions with a public page, offered and not suggested. The same
 * address from two sources is one candidate, the first one.
 */
export function linkCandidates(input: {
  links: {
    serviceId: string;
    service: string;
    label: string;
    url: string;
    kind: string;
    iconSlug?: string | null;
  }[];
  distributions: { kind: string; label: string; url?: string | null; evidence: string }[];
  accounts: { label: string; url?: string }[];
  gitRemoteUrl?: string | null;
}): Candidate[] {
  const out: Candidate[] = [];
  const seenUrls = new Set<string>();
  const seenKeys = new Set<string>();

  const push = (candidate: Candidate) => {
    /*
      The same rule the run applies, applied before offering. A candidate whose address `openLink`
      will refuse is a row that can only fail: a remote cloned with a token inside
      (`https://oauth2:TOKEN@gitlab.com/g/p`, which is what a CI clone leaves in `.git/config`) or a
      pasted address with a space. Leaving it out also keeps the token from travelling in the
      answer of a route that only asks what could be opened.
     */
    if (!candidate.url || !openableUrl(candidate.url) || seenKeys.has(candidate.key)) return;
    const same = sameUrl(candidate.url);
    if (seenUrls.has(same)) return;
    seenUrls.add(same);
    seenKeys.add(candidate.key);
    out.push(candidate);
  };

  for (const link of input.links) {
    push({
      key: `link:service:${link.serviceId}`,
      kind: "link",
      name: link.service,
      detail: link.label,
      url: link.url,
      source: "service",
      icon: link.iconSlug ?? undefined,
      suggested: link.kind === "deep",
    });
  }

  const remote = input.gitRemoteUrl?.trim();
  if (
    remote &&
    /^https?:\/\//i.test(remote) &&
    !input.links.some((link) => link.serviceId === "repository")
  ) {
    /*
      A clone made with a token carries it in the remote —`https://oauth2:TOKEN@gitlab.com/g/p`— and
      that address opens nothing: `openableUrl` refuses credentials, on purpose. Dropping the
      `user:pass@` gives back the link that was wanted and leaves the token out of the answer.
     */
    const url = remote.replace(/\.git$/i, "").replace(/^(https?:\/\/)[^/@]*@/i, "$1");
    push({
      key: REMOTE_LINK_KEY,
      kind: "link",
      name: hostOf(url),
      detail: url.replace(/^https?:\/\/[^/]+\/?/i, ""),
      url,
      source: "remote",
      suggested: true,
    });
  }

  for (const account of input.accounts) {
    const link = normalizeAccountUrl(account.url);
    const label = account.label.trim();
    if (link.kind !== "url" || !label) continue;
    push({
      key: `link:account:${label}`,
      kind: "link",
      name: label,
      detail: hostOf(link.url),
      url: link.url,
      source: "account",
      suggested: true,
    });
  }

  for (const distribution of input.distributions) {
    if (!distribution.url || !/^https?:\/\//i.test(distribution.url)) continue;
    push({
      key: `link:distribution:${distribution.kind}:${distribution.label}`,
      kind: "link",
      name: distribution.label,
      detail: distribution.evidence,
      url: distribution.url,
      source: "distribution",
      suggested: false,
    });
  }

  return out;
}
