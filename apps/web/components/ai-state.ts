/**
 * What did `/api/ai` answer when the panel asked for their status.
 *
 * The panel did this:
 *
 *     const response = await fetch("/api/ai");
 * setState((await response.json()) as State);
 *
 * and it was not checking the response status. From there, two different broken screens
 * come out, and neither of them says anything:
 *
 * **The one that keeps loading.** If the request fails —the server is down, a body that is not
 * JSON— the `catch` would write a notice, but the render cuts off earlier with «Loading…» while
 * `state` is null, so that notice never got rendered. The screen looked frozen, with no message and
 * no way out.
 *
 * **The one who lies.** If the server responds 500 with `{ error }`, that is JSON valid: it was
 * saved as if it were the state, and the panel would be rendered entirely with everything empty.
 * That is to say, 'you don't have any agent installed' said calmly about a machine that has three.
 *
 * That is why the good state requires a positive test—the list of agents, which both branches of
 * the GET always return—instead of being satisfied with the JSON being readable. It is the same
 * rule as `run-result.ts`, for the same reason.
 */

export type AiLoad<T> = { kind: "state"; state: T } | { kind: "error"; text?: string };

export function readAiState<T>(
  response: { ok: boolean; status: number },
  body: unknown,
): AiLoad<T> {
  const data = body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
  const said = typeof data?.["error"] === "string" ? (data["error"] as string) : undefined;

  if (!response.ok) return { kind: "error", text: said };

  // `agents` travels in both good responses: the normal one and the corrupted file one, which
  // returns 200 with `broken` and empty lists because the panel knows how to display that.
  if (Array.isArray(data?.["agents"])) return { kind: "state", state: data as T };

  return { kind: "error", text: said };
}
