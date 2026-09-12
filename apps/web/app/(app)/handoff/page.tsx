import { existsSync, realpathSync } from "node:fs";
import { platform } from "node:os";
import { listHandoffs, listProjectRoots } from "@panoma/db";
import { db } from "@/lib/db";
import { shellOf } from "@/components/command";
import { HandoffScreen } from "@/components/handoff-screen";
import { PageShell } from "@/components/page-shell";
import type { HandoffReceiptView, RootRow } from "@/lib/handoff-view";
import { getLocale, t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.handoff") };
}

/*
  The handoff screen. The server reads what only it can: the receipts, with a `stat` on each
  target file so a copy the agent has since deleted says so; and the project roots, with their
  links resolved, so the client can group conversations by folder without asking again. The
  conversations themselves come from `GET /api/handoff` on the client — discovery walks the
  agents' stores, and it is done once per visit, not once per render of this tree.

  Under `DATABASE_URL` the catalog is on another machine: the receipts still list, but nobody
  looks at their files (`fileExists: null`), and the client shows the remote sentence in place
  of the list.
 */
export default async function HandoffPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string | string[] }>;
}) {
  const [{ project }, locale, { db: database }] = await Promise.all([searchParams, getLocale(), db()]);
  const [rows, roots] = await Promise.all([listHandoffs(database), listProjectRoots(database)]);
  const remote = Boolean(process.env["DATABASE_URL"]);

  const receipts: HandoffReceiptView[] = rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    projectSlug: row.projectSlug,
    title: row.title,
    sourceAgent: row.sourceAgent,
    sourceSessionId: row.sourceSessionId,
    targetAgent: row.targetAgent,
    targetSurface: row.targetSurface,
    targetSessionId: row.targetSessionId,
    targetPath: row.targetPath,
    tier: row.tier,
    turns: row.turns,
    bytes: row.bytes,
    dropped: row.dropped,
    resumeCommand: row.resumeCommand,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt.toISOString(),
    fileExists: remote ? null : existsSync(row.targetPath),
  }));

  /* The root as stored and as resolved: an agent records the folder it was started in, links and all. */
  const rootRows: RootRow[] = roots.map((root) => {
    let real = root.root;
    try {
      real = realpathSync(root.root);
    } catch {
      /* A root that is not there today groups by its stored path alone. */
    }
    return { slug: root.slug, name: root.name, root: root.root, real };
  });

  return (
    <PageShell eyebrow={t(locale, "handoff.eyebrow")} title={t(locale, "handoff.title")} lead={t(locale, "handoff.intro")} measure="sheet">
      <HandoffScreen
        roots={rootRows}
        shell={shellOf(platform())}
        receipts={receipts}
        remote={remote}
        initialProject={Array.isArray(project) ? project[0] : project}
      />
    </PageShell>
  );
}
