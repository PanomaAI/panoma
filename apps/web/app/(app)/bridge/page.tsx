import { db } from "@/lib/db";
import { getLocale, t } from "@/lib/i18n";
import { bridgeProgress, bridgeReport, bridgeSteps } from "@/lib/bridge";
import { memoryStatus } from "@/lib/memory-status";
import { bridgeMemoryView } from "@/lib/memory-view";
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
  /*
    The memory bridge beside the setup: hooks event by event, deliveries and their receipts,
    backlog and quarantine (plan §14.1 «Puente»). Read once for the whole catalog and shaped into
    plain props; when it cannot be read the two cards fall back to what they showed before.
   */
  const [report, locale, status] = await Promise.all([
    bridgeReport(database),
    getLocale(),
    memoryStatus(database, undefined).catch(() => undefined),
  ]);
  const steps = bridgeSteps(report);
  const memory = bridgeMemoryView(status);

  return (
    <PageShell eyebrow={t(locale, "nav.bridge")} title={t(locale, "bridge.title")} lead={t(locale, "bridge.lead")}>
      <PageSection>
        <div className="grid items-start gap-6 xl:grid-cols-3">
          <BridgeSteps report={report} progress={bridgeProgress(steps)} memory={memory} />
          <BridgeActivity report={report} locale={locale} memory={memory} />
        </div>
      </PageSection>
    </PageShell>
  );
}
