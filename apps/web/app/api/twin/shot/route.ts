import { readFile } from "node:fs/promises";
import { MAX_SCREENSHOT_BYTES, imageTypeOf } from "@panoma/core";
import { getProject } from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";
import { pickShot } from "@/lib/shots";

/**
 * The pixels of a snapshot of the mailbox, so you can see it before judging it.
 *
 * It is the quiet half of giving the critic a platform. A verdict on something you can't see
 * cannot be contradicted: 'this breaks the spacing of the header' next to a thumbnail is a
 * sentence that can be checked in a second, and alone it is a sentence that must be believed. And
 * without this, choosing from the inbox would be choosing between file names — `home.png`,
 * `Captura de pantalla 2026-08-22.png` — that is, blindly.
 *
 * ── The name does not become a route ────────────────────────────────────────────
 *
 * The same rule as the POST of the look, and that is why they share it in `lib/shots.ts`: the root
 * comes out of the catalog by its slug, the name is searched in the mailbox listing, and what is
 * opened is the path that `readShots` put. Here it matters doubly, because a path that serves
 * files is what most resembles an open door: what is behind it is a list of ten names, not a file
 * system.
 *
 * ── It is served with `sameOrigin`, like the rest of what is looked at ───────────────────
 *
 * The asymmetry of Twin is elsewhere: you can look at the catalog from your phone, but you can't
 * give orders to this machine. And a screenshot is of what is being looked at — the same criterion
 * with which `/api/secrets` serves the credentials found on the disk, which is material much
 * hotter than an image. What must be said plainly is what can be inside: a screenshot of an
 * application in development shows what would be on the screen, including a key in a terminal, and
 * that doesn't go through any redactor here or when it travels to a provider.
 *
 * ── And never from the cache ───────────────────────────────────────────────────────
 *
 * `no-store`, which in any other image would be throwing performance away, and here it is the only
 * correct thing: the agent overwrites `home.png` on each pass, so the same URL returns a different
 * screen each time. A cached thumbnail would be yesterday's delivery next to today's findings.
 */
export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  const params = new URL(request.url).searchParams;
  const slug = params.get("slug");
  const name = params.get("name");
  if (!slug) return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });
  if (!name) return Response.json({ error: t(locale, "look.noShotName") }, { status: 400 });

  const { db: database } = await db();
  const data = await getProject(database, slug);
  if (!data) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  const shot = await pickShot(data.project.root, name);
  if (shot === undefined) {
    return Response.json({ error: t(locale, "look.noShot", { name }) }, { status: 404 });
  }

  /*
    The limit is the same as that of looking, and that equality is on purpose: what doesn't fit in
    a call doesn't need to be rendered either, because the button next to it won't be able to
    handle it. Two different limits would give a beautiful miniature of something that later
    refuses to be looked at.
   */
  if (shot.bytes > MAX_SCREENSHOT_BYTES) {
    return Response.json(
      { error: t(locale, "look.unreadableShot", { detail: `${name} · ${shot.bytes} B` }) },
      { status: 409 },
    );
  }

  const bytes = await readFile(shot.path).catch(() => undefined);
  if (bytes === undefined) {
    return Response.json({ error: t(locale, "look.noShot", { name }) }, { status: 404 });
  }

  /*
    The type comes from the bytes and not from the extension, just like in `readScreenshot`: a
    `.png` that is internally a JPEG is the most normal thing in the world. Declaring it
    incorrectly here does not break a paid call, it just renders a broken hole, but the correct
    answer costs eight bytes.
   */
  const type = imageTypeOf(bytes);
  if (type === undefined) {
    return Response.json({ error: t(locale, "look.badImage") }, { status: 409 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store",
      // Nothing that comes out of here is executed, nor can the type be guessed. See the header.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
