import Link from "next/link";
import type { BridgeReport } from "@/lib/bridge";
import { t, type Locale } from "@/lib/i18n";
import { Card, EmptyState, Tag } from "@/components/primitives";

export function BridgeActivity({ report, locale }: { report: BridgeReport; locale: Locale }) {
  const memoryStats = [
    ["bridge.stat.journal", report.memory.activities],
    ["bridge.stat.approved", report.memory.approved],
    ["bridge.stat.sleeping", report.memory.sleeping],
    ["bridge.stat.pending", report.memory.pending],
    ["bridge.stat.consultations", report.memory.consultations],
  ] as const;

  return (
    <div className="grid min-w-0 content-start gap-4">
      <Card as="section">
        <h2 className="text-sm font-semibold text-chalk">{t(locale, "bridge.todayTitle")}</h2>
        <p className="mt-2 text-xs leading-relaxed text-smoke">
          {t(locale, "bridge.activity.lead")}
        </p>

        {report.memory.activities === 0 && (
          <EmptyState variant="bare" title={t(locale, "bridge.activity.empty")} className="mt-4">
            {t(locale, "bridge.activity.pending", { tool: "panoma_log" })}
          </EmptyState>
        )}

        <dl className="mt-4 grid gap-3 text-xs">
          {memoryStats.map(([label, count]) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <dt className="text-smoke">{t(locale, label)}</dt>
              <dd className="shrink-0 font-mono text-chalk">{count.toLocaleString(locale)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 border-t border-edge pt-3 text-xs leading-relaxed text-smoke">
          {t(locale, "bridge.activity.review")}
        </p>
        <Link href="/twin" className="mt-3 inline-block text-xs text-chalk underline underline-offset-4">
          {t(locale, "bridge.activity.openTwin")}
        </Link>
      </Card>

      <Card as="section" tone="ground">
        <h2 className="text-sm font-semibold text-chalk">{t(locale, "bridge.system.title")}</h2>
        <dl className="mt-4 grid gap-4 text-xs">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
            <dt className="font-medium text-chalk">{t(locale, "bridge.stat.watcher")}</dt>
            <dd>
              <Tag tone={report.catalog.watcherActive ? "strong" : "neutral"} size="md">
                {t(locale, report.catalog.watcherActive ? "bridge.on" : "bridge.off")}
              </Tag>
            </dd>
            <dd className="w-full leading-relaxed text-smoke">
              {t(locale, report.catalog.watcherActive ? "bridge.system.watcherOn" : "bridge.system.watcherOff")}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2 border-t border-edge pt-4">
            <dt className="font-medium text-chalk">{t(locale, "bridge.stat.ablation")}</dt>
            <dd>
              <Tag size="md">{t(locale, report.scale.ablation ? "bridge.on" : "bridge.off")}</Tag>
            </dd>
            <dd className="w-full leading-relaxed text-smoke">
              {t(locale, report.scale.ablation ? "bridge.system.ablationOn" : "bridge.system.ablationOff")}
            </dd>
          </div>
        </dl>
        <p className="mt-4 border-t border-edge pt-3 text-xs leading-relaxed text-smoke">
          {t(locale, "bridge.scaleHint")}
        </p>
        <a href="/api/scale" className="mt-3 inline-block text-xs text-chalk underline underline-offset-4">
          {t(locale, "bridge.system.openScale")}
        </a>
      </Card>
    </div>
  );
}
