import { t, type Locale, type MessageKey } from "@/lib/i18n";

/** Type of agent log entry. The color distinguishes at a glance what to read. */
const KIND_STYLE: Record<string, string> = {
  change: "text-smoke border-edge",
  decision: "text-accent border-accent/30",
  note: "text-faint border-edge",
  blocker: "text-idle border-idle/30",
};

/** The entry type, in words. The raw database value goes in the `title`. */
export function ActivityKind({ kind, locale }: { kind: string; locale: Locale }) {
  return (
    <span
      className={`w-16 shrink-0 rounded border bg-raised px-1.5 py-0.5 text-center font-mono text-[10px] ${
        KIND_STYLE[kind] ?? KIND_STYLE["change"]
      }`}
      title={kind}
    >
      {t(locale, `activityKind.${kind}` as MessageKey) ?? kind}
    </span>
  );
}

const TASK_STYLE: Record<string, string> = {
  open: "text-chalk border-edge",
  "in-progress": "text-accent border-accent/30",
  done: "text-live border-live/30",
  discarded: "text-faint border-edge",
};

/** The state of the task, in words. The value stored in the database goes in `title`. */
export function TaskStatus({ status, locale }: { status: string; locale: Locale }) {
  return (
    <span
      className={`rounded border bg-raised px-1.5 py-0.5 font-mono text-[10px] ${
        TASK_STYLE[status] ?? TASK_STYLE["open"]
      }`}
      title={status}
    >
      {t(locale, `taskState.${status}` as MessageKey) ?? status}
    </span>
  );
}
