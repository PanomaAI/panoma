import { authenticateAgent } from "@panoma/db";
import { db } from "./db";

/** Extract and validate the agent's key. Return the agent or an error response. */
export async function requireAgent(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const apiKey = header.startsWith("Bearer ") ? header.slice(7) : undefined;

  const { db: database } = await db();
  const agent = await authenticateAgent(database, apiKey);

  if (!agent) {
    return {
      error: Response.json(
        { error: "Invalid agent key. Create one with: panoma agent-key <name>" },
        { status: 401 },
      ),
    };
  }

  return { agent, database };
}

/**
 * Check that the **server** is listening locally.
 *
 * Be careful about what this is and what it is not. Look at the hostname of the URL in the
 * request, which is that of the server itself: it says 'Panoma is not deployed on the internet,'
 * not 'the caller is on this machine.' For a while, it was used as if it were the second, and it
 * protected nothing: any page opened in another tab calls `localhost:4173` and the hostname is
 * still `localhost`.
 *
 * Who the call is handled by is `sameOrigin` in `lib/guard.ts`, and it is the one to use for that.
 * This one stays because the question it does answer —Am I local?— is the one that decides if
 * creating keys without authentication is acceptable: as soon as Panoma is deployed, that
 * operation has to go through the user's session.
 *
 * ## `0.0.0.0` counts as local, and you have to say why
 *
 * With `panoma up --network` the server ties itself to `0.0.0.0`, which is not an address to call:
 * it is 'all mine.' Without that name on the list, the three doors that this guards—create key,
 * withdraw key, connect an agent—would respond 403 to the owner sitting at their
 * computer, with a message that said 'only from the local machine' while being on the local
 * machine. And withdrawing a key is exactly what is urgent in the only mode where it is urgent.
 *
 * It is the same arrangement that `guard.ts` and `packages/core/src/access.ts` already had, and
 * that did not reach this file.
 *
 * What is widened by this, said in full: in `--network`, whoever has the access key can issue and
 * revoke agent keys. It is not a real escalation —that same key already opens the entire catalog,
 * including found routes and credentials— and since the middleware stopped exempting the local
 * loop, the key is the only boundary there is. That it is *the* door is preferable to having two
 * and one being broken.
 *
 * ## `[::1]` with brackets, which is how `URL` returns it
 *
 * The test found it when writing it: `new URL("http://[::1]:4173/").hostname` returns `"[::1]"`,
 * with the brackets included, so the comparison against `"::1"` alone was never true. The local
 * loop through IPv6 had never been recognized here. `guard.ts` did have both names; this one, only
 * one, and the one it had was the one that doesn't arrive.
 */
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export function isLocalServer(request: Request): boolean {
  return LOCAL.has(new URL(request.url).hostname);
}
