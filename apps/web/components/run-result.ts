/**
 * What did the servant answer to a proposal, read in full and not halfway.
 *
 * The button read exactly two fields, `error` and `summary`, and when neither of them was present
 * it wrote “Done.”. That turned **all** responses in another form into successes, and there is one
 * that arrives daily: in the face of a previous identical failure, `/api/runs` responds 409 with
 * `{ skipped, knownFailure, hint }` to avoid wasting another installation and another batch of
 * tests in reaching the same conclusion. Neither `error` nor `summary`. The button said “Done.”
 * about something that the server had refused to do, and in passing it threw the summary of the
 * failure, which was exactly what needed to be read.
 *
 * The CLI already understood that way —see `dispatchRun` in `apps/cli/src/index.ts` — and that is
 * why the two surfaces told different things about the same event.
 *
 * This lives outside of the component because it can be tested that way: the web intentionally
 * does not have a harness to mount React in tests, and a decision of this magnitude cannot go
 * unchecked because of that.
 *
 * **Success requires a positive test.** It is not enough that there is no error: the `runId` that
 * the server places in every good response is needed. Thus, a form that no one has yet anticipated
 * falls into `unknown` and is said, instead of disguising itself as 'Done.' — which is the bug we
 * are fixing, and next time it will have a different form.
 */

export interface RunResponse {
  runId?: string;
  /** `proposed`, `failed` or `no-changes`: what the executor decided. */
  status?: string;
  /** True only if there were tests and they passed. */
  verified?: boolean;
  error?: string;
  hint?: string;
  skipped?: boolean;
  knownFailure?: { runId?: string; summary?: string; at?: string };
  summary?: string;
}

/**
 * What color is said, that it is part of saying it.
 *
 * The four tones are the same four used by the CLI with the same responses —green for the verified
 * proposal, amber for the one that couldn’t be verified and the already known failure, red for
 * what failed, gray for what didn’t change anything— because it’s the same event seen from two
 * places and it doesn’t make sense for each one to depict it their own way. It lives here and not
 * in the component so it can be tested: it was always gray, and the gray made it pass as a happy
 * ending even for an execution that had broken the project.
 */
export type RunTone = "ok" | "quiet" | "warn" | "bad";

export type RunOutcome =
  | { kind: "done"; text?: string; tone: RunTone }
  | {
      kind: "known-failure";
      summary?: string;
      runId?: string;
      hint?: string;
      forceable: true;
      tone: "warn";
    }
  | { kind: "error"; text?: string; hint?: string; status: number; forceable: false; tone: "bad" }
  | { kind: "unknown"; status: number; tone: "bad" };

/*
  What can be retried from here, and what cannot.
  The API accepts `force` in two places and only one deserves a button.
  **The known failure, yes.** Forcing it costs what it costs—a setup and a batch of tests—and the
  worst thing that happens is that it fails again. Denying the retry to someone who just fixed the
  cause would leave them without an option on this screen while the CLI does have one.
  **Quarantine, no.** There `force` means installing a version released twenty minutes ago that no
  one has looked at, and the server's own notice says it in plain letters: 'or right now with
  --force if you know what you're doing.' That sentence is the friction, not an obstacle to
  remove: whoever decides to skip the quarantine must write it by hand in CLI, deliberately. One
  click is not a deliberate decision.
 */

export function readRunResponse(
  response: { ok: boolean; status: number },
  body: RunResponse | null | undefined,
): RunOutcome {
  const data = body && typeof body === "object" ? body : {};

  /*
    First the well-known ruling, and in this order on purpose.
    It arrives with status 409, so the check of `response.ok` would return an error if it were
    before — and it is not: it is a response with information inside. CLI is handled the same way
    and comes out with code 0.
   */
  if (data.skipped && data.knownFailure) {
    return {
      kind: "known-failure",
      summary: data.knownFailure.summary,
      runId: data.knownFailure.runId,
      hint: data.hint,
      forceable: true,
      tone: "warn",
    };
  }

  if (!response.ok || data.error) {
    return {
      kind: "error",
      text: data.error,
      hint: data.hint,
      status: response.status,
      forceable: false,
      tone: "bad",
    };
  }

  /*
    A performance that ended is not the same as one that went well.
    `/api/runs` responds 200 with the result no matter what: `proposed` if there's something to
    review, `no-changes` if there was nothing to touch, and `failed` if the update broke the
    project. All three were rendered the same gray, so a proposal that had left the tests in red
    looked the same as one that had passed. And `verified` is the difference between 'the tests
    passed' and 'there were no tests': to call the latter verified would be exactly the kind of
    small lie that this is meant to eliminate.
   */
  if (data.runId) return { kind: "done", text: data.summary, tone: toneOf(data) };

  return { kind: "unknown", status: response.status, tone: "bad" };
}

function toneOf(data: RunResponse): RunTone {
  if (data.status === "failed") return "bad";
  if (data.status === "no-changes") return "quiet";
  if (data.status === "proposed") return data.verified ? "ok" : "warn";
  // A state that we do not know is not rendered green.
  return "quiet";
}
