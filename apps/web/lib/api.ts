/**
 * Talk to the routes of this same application, in one place.
 *
 * There are 53 calls to `/api/` spread across 36 client components. Of these, six copy this entire
 * block —header, check, message, and `catch` — and they are the ones that use it; the other 47
 * have something of their own that this does not cover: eight are GET, two use DELETE or PATCH,
 * seven look at `status` to DECIDE and not just to display. They are counted one by one, not
 * estimated.
 *
 * What this module focuses on are three decisions that do not belong to any particular component:
 *
 * 1. The header `Content-Type: application/json`, copied in forty-five places.
 * 2. How to get the message when the server says no: `payload.error`, and if it doesn't provide
 * it, the status number. It was copied literally in thirteen files.
 * 3. What is taught when there is no server on the other side, which is the `catch` of the
 * network.
 *
 * Copied is not free: as soon as a route starts returning the reason in another key, or you want
 * to retry, or distinguish a 401 from a 500, you have to find thirty-seven places.
 *
 * It lives in `lib/` and not in a component because the tests on this website do not transform
 * `.tsx` —it's on purpose—, so the logic that deserves testing has to be in a `.ts`. See
 * `api.test.ts` next to it.
 *
 * The dropped network message comes as a parameter and is not resolved here: each screen has its
 * dictionary key —`open.unreachable`, `project.unreachable` — and this module does not know the
 * reader's language nor should it know it.
 */

/**
 * It went well and brings data, or it went badly and brings a reason that can be taught. Never
 * both, and never neither: that's what forces the caller to look at the result before using it.
 */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string };

/** What every route of this application answers, besides its own. */
type Envelope = { ok?: boolean; error?: string };

export async function postJson<T>(
  path: string,
  body: unknown,
  unreachable: string,
  /*
    How do you read a specific 'no,' when the reason does not fit in `error`.
    `/api/open` is the case: in addition to the what, a `hint` sends the how to fix it —'is the
    editor installed?'— and the two halves are shown together. Without this seam, whoever needs
    both has to write their own `fetch`, which is where we come from.
   */
  explain?: (payload: Record<string, unknown>) => string | undefined,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* It didn't even reach the server: there is nothing to unpack. */
    return { ok: false, message: unreachable };
  }

  let payload: Envelope & T;
  try {
    payload = (await response.json()) as Envelope & T;
  } catch {
    /*
      The server responded, but not with JSON. This happens with a 502 from a proxy or an error page
      from Next itself. Previously, this would fall into the same `catch` as a network outage and
      would be read as 'no server,' which is exactly the opposite of what was happening.
     */
    return { ok: false, message: String(response.status) };
  }

  if (response.ok && payload?.ok) return { ok: true, data: payload };
  const dicho = explain?.((payload ?? {}) as Record<string, unknown>);
  return { ok: false, message: dicho || payload?.error || String(response.status) };
}
