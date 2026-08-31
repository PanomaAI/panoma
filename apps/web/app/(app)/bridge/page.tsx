import { db } from "@/lib/db";
import { getLocale, t } from "@/lib/i18n";
import { bridgeReport, bridgeSteps } from "@/lib/bridge";
import { BridgeSteps } from "@/components/bridge-steps";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.bridge") };
}

/**
 * The bridge: what is on, what is missing, and the next step indicated.
 *
 * The why is measured in `lib/bridge.ts`: a whole catalog built and unused because turning it on
 * was guessing commands. This screen is the answer — a short list with only one 'next', and below
 * the numbers of the day to see the memory breathe when everything is already running.
 */
export default async function BridgePage() {
  const { db: database } = await db();
  const [report, locale] = await Promise.all([bridgeReport(database), getLocale()]);
  const steps = bridgeSteps(report);
  const ready = steps.every((step) => step.state === "done");

  return (
    <main id="app-main" tabIndex={-1} className="app-main legacy-page">
      <section className="pt-12">
        <p className="eyebrow">{t(locale, "nav.bridge")}</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
          {ready ? t(locale, "bridge.titleReady") : t(locale, "bridge.title")}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-smoke">
          {t(locale, ready ? "bridge.leadReady" : "bridge.lead")}
        </p>

        <BridgeSteps report={report} steps={steps} />

        <section className="mt-8 rounded-lg border border-edge bg-surface p-4">
          <h2 className="eyebrow">{t(locale, "bridge.todayTitle")}</h2>
          {/*
             Raw numbers without adjectives: the tower does not comment on whether they are good —
             that's what the scale is for, which compares. Here you only see memory breathing.
            */}
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-smoke">{t(locale, "bridge.stat.journal")}</dt>
              <dd className="font-mono text-chalk">{report.memory.activities}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-smoke">{t(locale, "bridge.stat.approved")}</dt>
              <dd className="font-mono text-chalk">{report.memory.approved}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-smoke">{t(locale, "bridge.stat.sleeping")}</dt>
              <dd className="font-mono text-chalk">{report.memory.sleeping}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-smoke">{t(locale, "bridge.stat.pending")}</dt>
              <dd className="font-mono text-chalk">{report.memory.pending}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-smoke">{t(locale, "bridge.stat.consultations")}</dt>
              <dd className="font-mono text-chalk">{report.memory.consultations}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-smoke">{t(locale, "bridge.stat.watcher")}</dt>
              <dd className="font-mono text-chalk">
                {t(locale, report.catalog.watcherActive ? "bridge.on" : "bridge.off")}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-smoke">{t(locale, "bridge.stat.ablation")}</dt>
              <dd className="font-mono text-chalk">
                {t(locale, report.scale.ablation ? "bridge.on" : "bridge.off")}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-faint">{t(locale, "bridge.scaleHint")}</p>
        </section>
      </section>
    </main>
  );
}
