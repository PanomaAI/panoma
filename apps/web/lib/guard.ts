import { cliName } from "@/lib/cli-name";
import { localeFrom, t, type Locale } from "@/lib/i18n";
import { portIsOpen } from "@/lib/exposure";
import { sameSecret } from "@/lib/same-secret";

/**
 * Reject requests that do not come from the Panoma interface itself.
 *
 * It is necessary because the server of Panoma runs on the user's machine and does real things on
 * it: installs dependencies, runs tests, opens folders, writes to the catalog. Any web page opened
 * in any browser tab can send a POST to `http://localhost:4173/api/runs` without the user knowing
 * — a form with `enctype="text/plain"` doesn't even need CORS, because the browser sends it first
 * and asks later. And `npm install` runs the `postinstall` of the project.
 *
 * `isLocalRequest` did not protect against this: it looked at the hostname of **URL of the
 * request**, which is that of the server itself and is always localhost, not that of the caller.
 *
 * The two headers are checked because they cover different cases:
 *
 * - `Sec-Fetch-Site` is put there by the browser, and the page's JavaScript cannot touch it. It is
 * the only reliable signal of 'this was caused by another site'.
 * - `Origin` is also sent by old clients, and when it exists it has to match **with header `Host`
 * **, which is the address the client wrote in the bar.
 *
 * That detail is not a detail. Previously, it was compared against `new URL(request.url).origin`,
 * which is the address that Next was tied to at startup: with `-H 0.0.0.0` the server thought it
 * was called `http://0.0.0.0:4173` and rejected its own interface, which comes from
 * `http://localhost:4173`. Result: the open, rescan, hide, and launch buttons returned 403 with a
 * message accusing the browser of coming from another site.
 *
 * `Host` is correct in addition to what works: the browser sets it based on the URL being
 * requested, and a page cannot falsify it. A tab in `evil.com` sends `Origin: http://evil.com`
 * with `Host: localhost:4173` and still ends up here; and the port has to match, so another
 * development server on `:3000` also fails.
 *
 * Without either of the two is a client that is not a browser —CLI, `curl`, the MCP server— and it
 * is allowed to pass: these are the ones that have to work against this same port. The protection
 * is against the browser, which is where the risk comes from.
 *
 * **And that’s why there is a second layer, which is the one that stops the neighbor.** This
 * guardian lets `curl` pass on purpose, so by itself it doesn’t protect against anything except a
 * browser. While the server was listening on `0.0.0.0`, anyone on the same Wi-Fi could request
 * `/api/secrets` and receive the 55 credentials found in the history of the eighty projects, with
 * file and line. Verified against the IP of the local network: HTTP
 * 200. The fix is not here but in `apps/web/package.json`, which now starts Next with
 * `-H 127.0.0.1`.
 *
 * Both layers are necessary and neither replaces the other: the link to loopback for the neighbor,
 * this guardian for the tab next door. If one day Panoma is exposed to the network, exposing it
 * must require **two** things at the same time —address and credential— and never just the
 * address.
 */
export function sameOrigin(request: Request): Response | undefined {
  const locale = localeFrom(request);
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return reject(locale, t(locale, "guard.otherSite", { site }));
  }

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && originHost(origin) !== host) {
    return reject(locale, t(locale, "guard.otherOrigin", { origin }));
  }

  return undefined;
}

/**
 * The 'host:port' of an origin, to compare it with header `Host`.
 *
 * The scheme is deliberately discarded: `Host` does not carry it, and whoever serves Panoma over
 * https behind a tunnel sends `Origin: https://…` with the same host. What is not discarded is the
 * port — that is where half of the protection is.
 */
function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    // A `Origin` that is not a URL is garbage or is a `null` (a sandbox): it matches nothing.
    return null;
  }
}

function reject(locale: Locale, detail: string): Response {
  return Response.json(
    {
      error: t(locale, "guard.rejected", { detail }),
      hint: t(locale, "guard.rejectedHint"),
    },
    { status: 403 },
  );
}

/**
 * Reject anyone who is not the operator of this machine.
 *
 * Save the routes that **give orders to the catalog computer**: install and build (`/api/check`),
 * rewrite the catalog (`/api/ingest`), open an editor
 * (`/api/open`), launch and consult proposals (`/api/runs`, `/api/assignments/launch` ) and
 * four o'clock of the twin. `--network` lets you **look** from the mobile, and that's fine;
 * ordering an execution is another league.
 *
 * ## Why it looks at a key and not the address
 *
 * Until August 25, 2026, it was called `loopbackOnly` and compared the header `Host` against a
 * list of house names. That header is written by whoever calls: a `curl -H 'Host: localhost'`
 * passed through here as if it were in front of the keyboard, and with it arrived at eleven. The
 * function promised 'the key grants access to reading, not hands on the keyboard,' and it did not
 * fulfill it.
 *
 * It couldn't be fixed by looking at the request —by HTTP there is no way to distinguish the local
 * loop from who claims to be it— so it was fixed on the other side: there is a second key that
 * **does not travel over the mobile link**. It lives in `~/.panoma/access.json` with 0600
 * permissions and on the link 'this machine' that the terminal prints, and both paths require
 * being on the machine. It is fully accounted for in `packages/core/src/access.ts`.
 *
 * ## Without an operator key there are two cases, and taking them as one would open eleven
 *
 * If the port is closed —the everyday `panoma up`, tied to `127.0.0.1` — whoever arrives is
 * already inside the machine and there is nothing to ask of them. The next tab over, which can
 * call `localhost` without being invited, is handled by `sameOrigin`, which always goes ahead of
 * this one.
 *
 * But the port can be opened **without** an operator key: `PANOMA_HOST=0.0.0.0` with
 * `PANOMA_ACCESS_KEY`, which is what `docs/environment.md` documents and what someone does when
 * setting this up manually instead of with `panoma up --network`. There, "no key" does not mean
 * "I'm at home": it means that the phone connects with the network key and there is nothing that
 * distinguishes it from the owner. Returning `undefined` left those routes open to the phone —
 * worse than with the `Host` comparison that this replaced, because a browser cannot fake its
 * `Host` and it can have the key.
 *
 * So if it fails closed: open port and no operator password is 403 for everyone, and the remedy is
 * to boot with `panoma up --network`, which creates both.
 */
export function localOperatorOnly(request: Request): Response | undefined {
  const expected = (process.env["PANOMA_OPERATOR_KEY"] ?? "").trim();
  if (!expected) {
    if (!portIsOpen()) return undefined;
    return refuse(request);
  }

  const carried = operatorKeyFrom(request);
  if (carried && sameSecret(carried, expected)) return undefined;

  return refuse(request);
}

/** The same 403 for both ways of not being the operator. */
function refuse(request: Request): Response {
  const locale = localeFrom(request);
  return Response.json(
    {
      error: t(locale, "guard.localOperatorOnly"),
      hint: t(locale, "guard.localOperatorOnlyHint", { cli: cliName() }),
    },
    { status: 403 },
  );
}

/**
 * The operator key, whether it comes from the browser or the terminal.
 *
 * A route handler receives a bare `Request`, without the `cookies` that brings `NextRequest`, so
 * the cookie is taken from the header by hand. The direct header is for the CLI, which reads it
 * from the 0600 file and has no browser to store anything.
 */
function operatorKeyFrom(request: Request): string {
  const direct = request.headers.get("x-panoma-operator");
  if (direct) return direct;

  const jar = request.headers.get("cookie") ?? "";
  for (const piece of jar.split(";")) {
    const at = piece.indexOf("=");
    if (at === -1) continue;
    if (piece.slice(0, at).trim() !== "panoma-operator") continue;
    // It is decoded because `NextResponse.cookies.set` writes it that way, and an undecoded
    // hexadecimal would be identical — but the key will not always be hexadecimal.
    try {
      return decodeURIComponent(piece.slice(at + 1).trim());
    } catch {
      return piece.slice(at + 1).trim();
    }
  }
  return "";
}
