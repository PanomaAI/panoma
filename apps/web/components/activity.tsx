import { t, type Locale, type MessageKey } from "@/lib/i18n";
import { Tag, type TagTone } from "./primitives";

/**
 * Type of agent log entry. The colour distinguishes at a glance what to read.
 *
 * These are tones and no longer class chains. Two of the four moved when the pill became one
 * recipe, and it is worth writing down which: `decision` and `blocker` were a coloured border over
 * `bg-raised`, and they now carry the hue's own tint at 10% like every other coloured pill in the
 * app. That disagreement — three sites painting grey under a coloured border, two painting the
 * tint — is the one `primitives.tsx` settles in favour of the tint, because a coloured border over
 * a grey ground is a pill that half-committed.
 */
const KIND_TONE: Record<string, TagTone> = {
  change: "neutral",
  decision: "accent",
  note: "quiet",
  blocker: "idle",
};

/**
 * The entry type, in words. The raw database value goes in the `title`.
 *
 * The fixed width is this pill's own and stays in `className`, which is what `Tag` takes it for:
 * these sit in a column down the left of a log and a ragged left edge would make the log harder to
 * scan than the words are to read. `justify-center` and not `text-center`, because the pill is a
 * flex box.
 */
export function ActivityKind({ kind, locale }: { kind: string; locale: Locale }) {
  return (
    <Tag
      tone={KIND_TONE[kind] ?? KIND_TONE["change"]!}
      className="w-16 shrink-0 justify-center"
      title={kind}
    >
      {t(locale, `activityKind.${kind}` as MessageKey) ?? kind}
    </Tag>
  );
}

/** Where a task stands. `done` and `in-progress` gained the tint with the rest; see above. */
const TASK_TONE: Record<string, TagTone> = {
  open: "strong",
  "in-progress": "accent",
  done: "live",
  discarded: "quiet",
};

/** The state of the task, in words. The value stored in the database goes in `title`. */
export function TaskStatus({ status, locale }: { status: string; locale: Locale }) {
  return (
    <Tag tone={TASK_TONE[status] ?? TASK_TONE["open"]!} title={status}>
      {t(locale, `taskState.${status}` as MessageKey) ?? status}
    </Tag>
  );
}
