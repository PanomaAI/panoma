import { db } from "@/lib/db";
import { getLocale, t } from "@/lib/i18n";
import { bridgeProgress, bridgeReport, bridgeSteps } from "@/lib/bridge";
import { BridgeSteps } from "@/components/bridge-steps";
import { BridgeActivity } from "@/components/bridge-activity";
import { PageShell, PageSection } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.bridge") };
}

/** Configuration and observed activity answer different questions and stay distinct. */
export default async function BridgePage() {
  const { db: database } = await db();
  const [report, locale] = await Promise.all([bridgeReport(database), getLocale()]);
  const steps = bridgeSteps(report);

  return (
    <PageShell eyebrow={t(locale, "nav.bridge")} title={t(locale, "bridge.title")} lead={t(locale, "bridge.lead")}>
      <PageSection>
        <div className="grid items-start gap-6 xl:grid-cols-3">
          <BridgeSteps report={report} progress={bridgeProgress(steps)} />
          <BridgeActivity report={report} locale={locale} />
        </div>
      </PageSection>
    </PageShell>
  );
}
