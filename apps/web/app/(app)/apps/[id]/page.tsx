import Link from "next/link";
import { notFound } from "next/navigation";
import { listProjectRoots } from "@panoma/db";
import { AppDetail } from "@/components/apps";
import type { VideoLaunchProject } from "@/components/app-video-launch";
import { PageShell } from "@/components/page-shell";
import { db } from "@/lib/db";
import { getLocale, t } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export default async function AppPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ project?: string }>;
}) {
  const [{ id }, query, locale] = await Promise.all([params, searchParams, getLocale()]);
  if (id !== "panoma-video") notFound();
  let projects: VideoLaunchProject[] = [];
  let projectsError = false;
  try {
    const { db: database } = await db();
    projects = (await listProjectRoots(database))
      .filter(({ identity }) => identity !== null && identity.length > 0 && identity.length <= 1000)
      .map(({ name, slug }) => ({ name, slug }));
  } catch {
    // Catalog availability must not prevent the app's installation and preparation controls.
    projectsError = true;
  }
  /*
    The shell without a title, which is the one page that needs that door.
    The heading of this screen is the app's own name, and `AppDetail` draws it from the manifest
    it fetches in the browser: `appName()` reads `manifest.displayName[locale]` and only falls
    back to «panoma video» when there is no manifest. The server cannot write that name without
    reading the disk a second time, and writing anything else would put two `<h1>`s with the same
    words on one screen. So the page takes the shell for its geometry — which is the whole point,
    since it used to write `py-12` and sit 48px below its siblings — and leaves the heading to the
    component that knows it.
   */
  return (
    <PageShell>
      <Link href="/apps" className="text-sm text-smoke hover:underline">← {t(locale, "apps.back")}</Link>
      <AppDetail id={id} project={query.project} projects={projects} projectsError={projectsError} />
    </PageShell>
  );
}
