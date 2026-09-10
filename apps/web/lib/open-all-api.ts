import { postJson, type ApiResult } from "./api";
import type { Candidate, OpenPlan } from "./open-all";

/**
 * Talk to `/api/open/all` from the browser, in one place.
 *
 * Same reason as `open-target.ts`: the button and the configurator are `.tsx`, and nothing that
 * lives inside a `.tsx` has a test here. The three calls —what could open, save the plan, run it—
 * are the whole client contract, and the shape of each answer is written once.
 */

export interface OpenAllState {
  /** The catalog lives on another machine: nothing here can open. */
  remote: boolean;
  /** Whether a plan can be stored: false for a project with no repository. */
  canSave: boolean;
  plan: OpenPlan | null;
  /** The project's own start command, if it declares one. */
  startCommand: string | null;
  candidates: Candidate[];
}

export interface StepOutcome {
  key: string;
  name: string;
  ok: boolean;
  error?: string;
}

export interface RunResult {
  source: "saved" | "picked" | "suggested";
  opened: number;
  total: number;
  outcomes: StepOutcome[];
}

/** What could open and what is planned. `null` when the server cannot be reached or says no. */
export async function fetchOpenAll(id: string): Promise<OpenAllState | null> {
  try {
    const response = await fetch(`/api/open/all?id=${encodeURIComponent(id)}`);
    if (!response.ok) return null;
    return (await response.json()) as OpenAllState;
  } catch {
    return null;
  }
}

/**
 * Store the plan, or `null` to go back to the suggestion.
 *
 * `saved: false` means it had nowhere to go —a project with no repository— and the answer carries
 * `plan` because the server normalizes what it stores: an address typed as `localhost:3000` comes
 * back as `http://localhost:3000`, and a client that keeps its own copy ends up naming a link it
 * cannot read.
 */
export async function saveOpenAll(
  id: string,
  plan: OpenPlan | null,
  unreachable: string,
): Promise<ApiResult<{ saved: boolean; plan: OpenPlan | null }>> {
  return postJson<{ saved: boolean; plan: OpenPlan | null }>(
    "/api/open/all",
    { id, action: "save", plan },
    unreachable,
  );
}

/**
 * Run the plan. `keys` only for a project whose plan cannot be saved: a selection among what the
 * server offered, nothing else.
 */
export async function runOpenAll(
  id: string,
  unreachable: string,
  keys?: string[],
): Promise<ApiResult<RunResult>> {
  return postJson<RunResult>(
    "/api/open/all",
    { id, action: "run", ...(keys ? { keys } : {}) },
    unreachable,
    (payload) => [payload.error, payload.hint].filter(Boolean).join(" "),
  );
}
