import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject } from "@panoma/db";
import { db } from "@/lib/db";
import { getLocale, t } from "@/lib/i18n";
import { PageShell } from "@/components/page-shell";
import { VideoProduction } from "@/components/video-production";

export const dynamic = "force-dynamic";
export default async function VideoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [{ db: database }, locale] = await Promise.all([db(), getLocale()]);
  const data = await getProject(database, slug);
  if (!data) notFound();
  /*
    The way back goes in `headExtra`, which puts it under the lead instead of over the eyebrow
    where this page used to write it. That move is deliberate and it is the only visible change of
    the conversion besides the geometry: the shell owns the ORDER of the header — eyebrow, title,
    lead, note, everything else — and buying a place above the eyebrow would mean a second slot on
    a component eighteen pages share, for one link on two pages.
    The other candidate was the eyebrow itself, as a breadcrumb. It is refused because `.eyebrow`
    uppercases what it holds, and a project name is a name: «acme» would arrive as «ACME» on the
    one line of this screen that says whose project it is.
    `panoma video` is not translated, here or anywhere: it is the name of the app, not a phrase.
   */
  return (
    <PageShell
      eyebrow="panoma video"
      title={t(locale, "apps.jobs.production")}
      lead={t(locale, "apps.jobs.productionIntro")}
      headExtra={
        <Link href={`/p/${slug}`} className="mt-4 inline-block text-sm text-smoke hover:underline">
          ← {data.project.name}
        </Link>
      }
    >
      <VideoProduction projectId={data.project.id} identity={data.project.identity} slug={slug} />
    </PageShell>
  );
}
