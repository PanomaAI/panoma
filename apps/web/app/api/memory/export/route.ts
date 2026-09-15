import { redactSecrets } from "@panoma/core";
import { exportProjectMemory, resolveProject } from "@panoma/db";
import { memoryRefusal } from "@/lib/agent-channel";
import { db, memoryQuarantine } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/**
 * The portable memory of one project, as a file: `GET /api/memory/export?slug=<slug>`.
 *
 * It hands over everything the catalog remembers about a project —the notes in every state, the
 * decisions with their revision links, the distiller's receipts— in the versioned document that
 * `exportProjectMemory` composes (`packages/db/src/memory-export.ts`). The audit of 6-Sep-2026
 * listed the export as pending; this is the export half only. There is no import behind this
 * route, and it says so in [memory.md](../../../../../docs/memory.md).
 *
 * ── Under the deletion contract, since 14-Sep-2026 ──────────────────────────────────
 *
 * The export is one of the doors the deletion contract closes (plan §12.1 step 4, §12.2). A
 * catalog whose deletion journal disagrees with its rows —a copy restored from before a purge,
 * a torn or missing journal— answers `503 unavailable` from `memoryQuarantine()` until a person
 * reconciles (T56); and a note or a decision under a live withdrawal or purge is left out of the
 * document by `exportProjectMemory` itself (A18/T54), so the file never carries what the owner
 * withdrew.
 *
 * ── The two guards, and why the second one ─────────────────────────────────────────
 *
 * `sameOrigin` for the usual reason: the tab next door does not read your catalog. And
 * `localOperatorOnly` because of what travels: the owner's own testimony —what they approved,
 * what they discarded, what they decided and why— which is exactly what `GET /api/twin/episodes`
 * already reserves for the person in front of the keyboard. The network key lets a phone look at
 * the catalog; carrying the whole memory of a project out in one file is another league, and it
 * is the precedent that decides here. The CLI reaches it through `catalogFetch`, which sends the
 * operator key on the local loop only: over `--api` to another machine this route answers 403,
 * and that is by design.
 *
 * ── No `DATABASE_URL` cut ───────────────────────────────────────────────────────────
 *
 * `/api/notes` refuses against a remote catalog because it writes and would have to ask whose
 * project it is before writing. This route only reads what the catalog already holds: the anchors
 * come back exactly as they were stored, nothing is re-evaluated against a disk this server may
 * not see, so there is nothing a remote catalog cannot answer.
 *
 * ── Redacted once more, on the way out ──────────────────────────────────────────────
 *
 * Every text in the document was covered at its own gate —`redactSecrets` runs on notes, on
 * narratives and on episode fields before they are stored— so this pass should find nothing.
 * It runs anyway, over the serialized JSON, because the file is the one thing here that leaves
 * the machine on purpose, and the vault rule counts double for that: metadata yes, secrets never.
 */
export async function GET(request: Request) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug) return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });

  const { db: database } = await db();
  const project = await resolveProject(database, { slug });
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });
  const guard = await memoryQuarantine();
  if (guard.quarantined) {
    return memoryRefusal(
      "unavailable",
      `The memory is quarantined (${guard.reason}): the deletion journal and the catalog disagree.`,
      503,
      "Reconcile the journal with panoma memory status before exporting.",
    );
  }

  const document = await exportProjectMemory(database, {
    id: project.id,
    slug: project.slug,
    name: project.name,
    root: project.root,
    identity: project.identity,
  });
  const body = redactSecrets(JSON.stringify(document, null, 2));

  /*
    The slug is an identifier the intake hands out, so it is already safe for a file name; the
    replacement is there for the day that stops being true, because a quote inside a
    `Content-Disposition` is a broken header and not a broken name.
   */
  const filename = `panoma-memory-${project.slug.replace(/[^A-Za-z0-9._-]/g, "-")}.json`;
  return new Response(`${body}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
