import { NextResponse, type NextRequest } from "next/server";
import { portIsOpen } from "@/lib/exposure";
import { sameSecret } from "@/lib/same-secret";

/**
 * The network gateway: address **and** credential, never just the address.
 *
 * Panoma runs on your machine and does real things on it. With the port tied to the local loop
 * that is safe because nobody else can call it; as soon as it is opened to the network it stops
 * being safe. It was checked from the home wifi: `POST /api/secrets` returned 55 credentials found
 * in fourteen repositories, with file and line, to whoever requested it with `curl`.
 *
 * Here and not on every route because there are twenty-something more plus all the pages, and the
 * home page already shows the routes of your eighty projects. A door that you have to remember to
 * put in every place is a door that one day will be missing.
 *
 * ## The two rules
 *
 * 1. **No key configured, only the local loop.** It is the `panoma up` of every day: the port is
 * bound to `127.0.0.1`, there is no key to request, and whoever opens `localhost:4173` on their
 * own computer is already inside the machine. No one comes from outside; and if they did —because
 * someone opened the port manually, or because something failed when passing the key— the response
 * is a 503 and not a page. Failing closed means that the insecure mode does not exist.
 * 2. **With the key set, everyone has the key.** Also the local loop. It comes via `?key=`, via
 * cookie or via header.
 *
 * ## Why the local loop stopped being exempt
 *
 * Because 'this comes from this machine' was decided by reading the header `Host`, and that header
 * is written by whoever is calling. Here it was written that a `curl` from the LAN could send
 * `Host: localhost`, and then it was excused with 'that's why the port remains closed by default'
 * — which is a circular argument, because with the port closed this file does not run. With
 * `--network` the port is open, and this was the only defense that remained.
 *
 * Measured on 25-Aug-2026 against a real server tied to `0.0.0.0` with the key in place, calling
 * from another machine on the same Wi-Fi:
 *
 * curl http://192.168.1.239:4199/api/catalog -> 401 curl -H 'Host: localhost:4199'
 * http://192.168.1.239:4199/api/catalog -> 200
 *
 * And it didn't stop at reading: with the same header entered `POST /api/check` —which installs
 * and builds a project on this machine— and `POST /api/ingest`, which rewrites the catalog. The
 * key was decorative.
 *
 * The arrangement is not a better list of names: it is stopping asking the caller where they come
 * from. When there is a key, it is requested, period. Comfort is maintained on the other side:
 * `panoma up --network` prints two links, and when opening either one the browser keeps the cookie
 * for thirty days.
 *
 * ## The two links do not lead to the same thing, and that is the other half
 *
 * This door decides whether to **enter**. Who can **command**—install, build, open an editor—is
 * decided by `localOperatorOnly` in `lib/guard.ts` with a second key, and that key travels in the
 * link of 'this machine' and not in the network link. How many routes there are is NOT written
 * here: the figure changes with each new route and a comment does not find out. The live count,
 * with the command that reproduces it, is in `docs/guards.md`.
 *
 * Here it is only collected from the link and stored in its cookie, which is the same as what was
 * already done with the network one. The reason there are two is entirely in
 * `packages/core/src/access.ts`; the summary is that through HTTP there is no way to distinguish
 * the local loop from who claims to be it, so the distinction is made with what can only be had by
 * being on the machine.
 */

/** The name of the cookie, next to `panoma-lang` and `panoma-editor`. */
const COOKIE = "panoma-access";

/** How the key can come, in order of convenience for whoever uses it. */
const HEADER = "x-panoma-key";
const QUERY = "key";

/*
  And the second credential, the one that authorizes you to command this machine.
  It goes apart from the network one on purpose, and the difference is fully explained in
  `packages/core/src/access.ts`: the mobile link carries `key` and does not carry `op`, so whoever
  has it looks at the catalog but does not set the computer to compile. The routes that execute
  something check it, via `localOperatorOnly` in `lib/guard.ts`; here it is only collected from
  the link and saved, which is where the same was already done with the other one.
 */
const OPERATOR_COOKIE = "panoma-operator";
const OPERATOR_QUERY = "op";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function isLoopback(host: string | null): boolean {
  if (!host) return false;
  return LOOPBACK.has(host.replace(/:\d+$/, "").toLowerCase());
}

export function middleware(request: NextRequest) {
  const expected = (process.env["PANOMA_ACCESS_KEY"] ?? "").trim();

  /*
    Without a key there are two very different situations, and confusing them would cost the
    entire catalog.
    The normal one: the port is tied to `127.0.0.1`, there is no key to request, and whoever
    manages to call is already inside the machine. There, header can decide even if it can be
    falsified, because the package that would bring it does not arrive — a lying `Host` from the
    machine itself gets nothing that an honest one cannot get.
    The other: someone opened the port **without** a password, with
    `PANOMA_HOST=0.0.0.0 pnpm dev`, which is a path that the documentation itself teaches. Here
    the above would become the same hole that this file just closed, moved to the branch next
    door: measured on August 25, 2026, `curl -H 'Host: localhost'` from the Wi-Fi returned `200`
    and the catalog. So when the port is open, nothing is asked of the caller: 503 to everyone,
    including the local loop. Fail-closed means that the insecure mode does not exist, and that
    503 is also the only way for whoever set it up to find out that the password is missing.
   */
  if (!expected) {
    if (portIsOpen()) return locked();
    return isLoopback(request.headers.get("host")) ? NextResponse.next() : locked();
  }

  const url = request.nextUrl;
  const fromQuery = url.searchParams.get(QUERY);
  const operatorFromQuery = url.searchParams.get(OPERATOR_QUERY);
  /*
    You enter with the key, no matter where it comes from, and **all of them count**: not just the
    first one that appears.
    This was a chained process with `??` and it allowed the cookie to win simply for existing.
    With a stale cookie — or empty, which also 'exists' — the other two paths were never seen:
    measured, a correct header `x-panoma-key` returned 401 if the browser brought `panoma-access=`
    from a rotated key. And this is exactly the moment when it is necessary for header to work:
    rotating the key left the browser out with no way to get back in except by manually deleting
    cookies. The MCP client has the same problem on the other side, because it sends its
    `Authorization: Bearer` with the agent's key, which is never this one.
   */
  const offered = [
    fromQuery,
    request.cookies.get(COOKIE)?.value,
    request.headers.get(HEADER),
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""),
  ];
  if (!offered.some((value) => !!value && sameSecret(value, expected))) {
    return unauthorized(request);
  }

  /*
    And if something entered through URL, it is saved in its cookie and removed from the bar. Both
    halves matter: one URL with the credential inside remains in the phone's history, in the
    clipboard of whoever shares it, and in the log of any proxy it passes through. Entering via
    link is convenient; staying on the link, not.
    The condition looks at both keys and not just the network one. With `fromQuery` alone, a link
    that brought only `?op=` —because the browser already had last week's network cookie— still
    went ahead without picking up anything and left the operator key written in the bar: it
    neither entered nor was deleted, which are the two worst results at the same time.
   */
  if (fromQuery || operatorFromQuery) {
    const clean = new URL(url);
    clean.searchParams.delete(QUERY);
    clean.searchParams.delete(OPERATOR_QUERY);
    const response = NextResponse.redirect(clean);
    const jar = {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: url.protocol === "https:",
      maxAge: 60 * 60 * 24 * 30,
    } as const;
    response.cookies.set(COOKIE, expected, jar);

    /*
      The second cookie only if the link brought the second key, that is, if it is the link of
      'this machine.' The one from the mobile doesn’t have it, so that browser just watches —
      which is exactly the line that separates watching from sending.
     */
    const operator = (process.env["PANOMA_OPERATOR_KEY"] ?? "").trim();
    if (operator && operatorFromQuery && sameSecret(operatorFromQuery, operator)) {
      response.cookies.set(OPERATOR_COOKIE, operator, jar);
    }
    return response;
  }

  return NextResponse.next();
}

/**
 * The port is open and no one set up the key.
 *
 * 503 and not 401 on purpose: it's not that the caller hasn't identified themselves, it's that
 * this server is not in a position to attend to anyone from outside. The difference matters to the
 * one setting it up, who is the one who has to read this.
 */
function locked() {
  return new NextResponse(
    JSON.stringify({
      error: "Panoma is listening on the network without an access key configured.",
      hint: "Start it with `panoma up --network`, which creates the keys and passes them in.",
    }),
    { status: 503, headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

/**
 * Neither cookie nor header nor `?key=`. It says what is missing, without saying anything about
 * the catalog.
 *
 * The body JSON is in **English** and the page in Spanish, and the fork is the same that decides
 * the format: `accept: text/html` separates the person from the machine. Whoever receives JSON is
 * a `curl`, the CLI —which prints it as is— or the client MCP, who also deliberately requests
 * English through `Accept-Language`; it is the house rule, and until today all three received
 * Spanish.
 *
 * The page remains in Spanish and it is a noted debt: to be bilingual it would need the dictionary
 * of `lib/i18n.ts`, and here nothing from Next can be rendered —the layout queries the catalog,
 * which is exactly what this gate does not allow to see— so the two texts would have to be brought
 * manually. Fits; not touching today.
 */
function unauthorized(request: NextRequest) {
  const wantsHtml = request.headers.get("accept")?.includes("text/html");
  if (!wantsHtml) {
    return new NextResponse(
      JSON.stringify({
        error: "This Panoma has its port open, so it needs the access key.",
        hint:
          `Send it in the ${HEADER} header. The browser can also enter once with ?${QUERY}=…, ` +
          `and the link is printed by \`panoma up --network\`.`,
      }),
      { status: 401, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }

  /*
    A minimal page and written here, without a template.
    Everything beneath this door speaks of the catalog —project names, disk paths— and none of
    that can reach someone who hasn't entered yet. Rendering a Next page would mean executing its
    layout, and the layout queries the catalog.
   */
  return new NextResponse(
    `<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panoma · hace falta la clave</title>
<style>
  body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;
       background:#fbfbfc;color:#0e0f11;
       font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
  main{max-width:34rem}
  h1{margin:0 0 12px;font-size:1.25rem;letter-spacing:-0.01em}
  p{margin:0 0 10px;color:#5c6169}
  code{font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
       background:#f1f1f3;border-radius:6px;padding:2px 6px}
  @media (prefers-color-scheme:dark){
    body{background:#0e0f11;color:#f4f4f5}p{color:#a1a1aa}code{background:#1c1c20}
  }
</style>
<main>
  <h1>Hace falta la clave</h1>
  <p>Este Panoma está abierto a la red, y con el puerto abierto pide credencial a todo el
     mundo — también a esta máquina, porque desde fuera se puede fingir venir de ella.</p>
  <p>Pídesela a quien lo arrancó: <code>panoma up --network</code> imprime el enlace
     completo, con la clave dentro. Al abrirlo una vez, este navegador queda dentro.</p>
</main>`,
    { status: 401, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/*
  Everything except what cannot carry a credential or reveals nothing.
  Next's static resources and the favicon are passed through so that the 'key is missing' page
  itself can be seen: they are framework files, the same in any installation. A project's icon
  **does not** fall into this category — `/icon/[id]` comes from the catalog, and a project's name
  is already information.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
