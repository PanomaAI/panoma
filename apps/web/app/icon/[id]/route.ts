import { getProjectIcon } from "@panoma/db";
import { db } from "@/lib/db";

/**
 * The icon of a project is useful.
 *
 * We could embed the data URI directly into the grid, but with 24 cards and real app icons that is
 * several megabytes of HTML on each load. A cached route keeps the HTML small and the browser
 * takes care of the rest.
 *
 * **The cache is validated on every load, it is not considered valid for an hour.** Previously,
 * `max-age=3600` responded without any validator, and that means that for an hour the browser does
 * not ask again: if during that time the icon changed —or if the request failed because the server
 * was in the middle of rebuilding— the user is stuck with whatever they have, no matter how many
 * times they reload. In a catalog whose content changes with every scan, that is not an
 * optimization, it is a way of showing old data and not being able to explain why.
 *
 * With `no-cache` + `ETag` the browser still keeps saving the image and still does not download it
 * twice; it only asks 'has it changed?' and receives an empty 304 when it has not. The cost is a
 * conditional request per icon; the benefit is that a rescan is seen immediately.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db: database } = await db();
  const icon = await getProjectIcon(database, id);

  if (!icon) return new Response(null, { status: 404 });

  // The hash of the icon is its identity: if the file changes, the ETag changes.
  const etag = icon.hash ? `"${icon.hash}"` : undefined;
  if (etag && request.headers.get("if-none-match") === etag) {
    /*
      The headers safety devices also go in the 304, and this is not due to symmetry.
      A 304 tells the browser 'reuse what you have,' and what it reuses includes the headers that
      it saved the first time. If the 304 does not include them, the response that the browser
      ends up using is the old one —without CSP— forever: it is enough to have loaded the icon
      once before the fix. I discovered it because the attack kept working with the CSP already in
      place.
     */
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "no-cache", ...UNTRUSTED_BYTES_HEADERS },
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": icon.contentType,
    "Cache-Control": "no-cache",
    ...UNTRUSTED_BYTES_HEADERS,
  };
  if (etag) headers.ETag = etag;

  return new Response(icon.body, { headers });
}

/**
 * headers to serve bytes that someone else wrote.
 *
 * This is the only site where Panoma returns through HTTP the content of a file from the disk as
 * is, and it was serving it from the same source as the rest of the app. Two of the eighty
 * projects in the catalog have the logo in SVG, and an SVG **is not an image**: it is an XML
 * document that can carry `<script>` inside. Opening `/icon/<id>` executed that script in
 * `localhost:4173`.
 *
 * Tested with a test repository: the script read the cover of Panoma and counted the 77 projects.
 * From there it reaches everything else, because the only defense of API is `sameOrigin()` and
 * this **is** the same origin: `/api/secrets` returns the 55 disk credentials, and `/api/runs`
 * executes commands. It's enough to clone a repo and scan it.
 *
 * - `sandbox` without `allow-scripts` is the one that really cuts: the document goes to an opaque
 * source, so even if something were to execute, it could neither read nor write in Panoma.
 * `default-src 'none'` also cuts any outgoing request.
 * - `nosniff` matters even though we set the type ourselves, precisely **because** we set it
 * ourselves: it comes from the file extension, not its content. A `logo.png` that inside is HTML
 * would be served as `image/png`, and without this header the browser may decide that it is
 * actually HTML and execute it.
 *
 * Neither of the two affects `<img src="/icon/…">`, which is how the grid uses it: an image
 * continues to be rendered the same. Only the ability to execute code disappears.
 */
const UNTRUSTED_BYTES_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "X-Content-Type-Options": "nosniff",
} as const;
