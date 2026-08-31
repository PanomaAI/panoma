/*
  When the call to the model does not happen, and what to do about that.
  A provider can respond incorrectly —a 429, a 401, a 400 saying that this parameter does not
  exist— and that is already recorded: the response brings its body and the message is shown in
  full, because the day they change API is the only thing that will explain it. This is the other
  thing: the request that **doesn't even go out**. A socket that the other end closed and no one
  removed from the reuse pool, a DNS that takes time, a TLS that fails halfway. Node records
  everything the same way, with a `TypeError` whose message is two words: 'fetch failed'.
  Two words that say nothing, and that was the way it looked. The sweep of the author's history —
  2,278 quotes, nine linked passes of about two minutes each — stopped on the ninth, and the next
  two failed in 160 ms, without leaving the machine. The receipt said 'could not distill: fetch
  failed' and with that, nothing can be done: it is not known whether the provider is down,
  whether the session expired, whether there is no network, or whether the problem is on this
  side. It was: the same `complete()` from a freshly started process worked on the first try, and
  after restarting the server it worked again. A long process — and the server of Panoma is one —
  accumulates connections that the other end has already closed.
  ── It is retried, because this failure does not charge ──────────────────────────────────────
  A transport error is a request that did not get answered: no tokens were spent, nothing is
  stored on the other side, and there is nothing to undo. Repeating it is free in everything
  except time, and what is at stake is eight calls in the middle of a forty-minute sweep. With a
  4xx or a 5xx it would be the opposite, and that’s why **none of that is retried**: a repeated
  429 is abuse, a repeated 401 will fail anyway, and a 500 may have executed half of what was
  requested. What the provider responds with is a response, and responses are not retried here.
  And what was canceled by the caller is not retried. A `abort` is a decision, not a failure:
  trying again would be disobeying the one who hung up.
 */

/** How many times is it tried, counting the first. Two retries and it's over. */
export const ATTEMPTS = 3;

/** What is expected between attempts, in milliseconds. Short: this is a socket, not a queue. */
export const WAITS = [500, 2_000] as const;

/**
 * The reason for a transport failure, in a line, or nothing if it is not.
 *
 * Nothing if it isn't, and that is the filter: what returns something is retried and what returns
 * `undefined` goes up as is. A `AbortError` is not transport — it is a decision of the caller —
 * and an error of the code itself neither.
 *
 * Node chains the cause: the `TypeError` from outside says "fetch failed" and inside it has the
 * `Error` with the `code` that truly explains what happened —`UND_ERR_SOCKET`, `ECONNRESET`,
 * `EAI_AGAIN` —. The entire chain is walked through and joined, because the useful one is the one
 * inside and the one that was shown was the one from outside.
 */
export function transportFailure(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error.name === "AbortError" || error.name === "TimeoutError") return undefined;
  if (!(error instanceof TypeError) && codeOf(error) === undefined) return undefined;

  const parts: string[] = [];
  let step: unknown = error;
  while (step instanceof Error && parts.length < 4) {
    const code = codeOf(step);
    parts.push(code === undefined ? step.message : `${code} (${step.message})`);
    step = step.cause;
  }

  // Without duplicates and without the empty wrapper: 'fetch failed' is unnecessary when there is a
  // cause.
  const seen = parts.filter((part, index) => parts.indexOf(part) === index);
  const useful = seen.filter((part) => part !== "fetch failed");
  return (useful.length > 0 ? useful : seen).join(" ← ");
}

function codeOf(error: Error): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : undefined;
}

export interface CallOptions {
  /** For the tests: the wait, which here is real and there does not have to be. */
  wait?: (ms: number) => Promise<void>;
  /** For the tests: who really calls. Without this, `fetch`. */
  fetchImpl?: typeof fetch;
  attempts?: number;
}

/**
 * Call the provider and, if the call does not go through, retry and then account for it.
 *
 * `name` is the provider name shown to the person —«ChatGPT
 * (subscription)»— because the message that comes out of here ends in a receipt and at a terminal.
 */
export async function callProvider(
  name: string,
  url: string,
  init: RequestInit,
  options: CallOptions = {},
): Promise<Response> {
  const attempts = options.attempts ?? ATTEMPTS;
  const call = options.fetchImpl ?? fetch;
  const wait = options.wait ?? sleep;

  let last = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await call(url, init);
    } catch (error) {
      const why = transportFailure(error);
      // It is not transportation: it goes up as is. Here what is already explained by itself is not
      // wrapped.
      if (why === undefined) throw error;
      last = why;
      if (attempt < attempts) await wait(WAITS[Math.min(attempt - 1, WAITS.length - 1)] ?? 0);
    }
  }

  /*
    The number at the end, as in the entire copy of the house: 'attempted 1 times' is the same
    broken agreement that has already appeared seven times in this database, and it is only seen
    when the number is one — that is, exactly when someone has lowered the attempts to debug.
   */
  throw new Error(
    `${name} no llegó a contestar: ${last}. Intentos: ${attempts}. ` +
      `No es que el modelo dijera que no: la petición no salió de esta máquina.`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
