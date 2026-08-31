import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { ProjectState } from "@panoma/db";
import { HiOutlineCodeBracketSquare } from "react-icons/hi2";
import { t, type Locale } from "@/lib/i18n";

export const STATE_STYLE: Record<ProjectState, { label: string; dot: string; text: string }> = {
  active: { label: "activo", dot: "bg-live", text: "text-live" },
  paused: { label: "en pausa", dot: "bg-idle", text: "text-idle" },
  dormant: { label: "dormido", dot: "bg-dormant", text: "text-dormant" },
  "no-git": { label: "sin git", dot: "bg-nogit", text: "text-faint" },
};

/**
 * The status point, with its word if requested.
 *
 * `locale` is optional and by default Spanish, the same pattern as `relativeDate` and
 * `RunStatusTag`: pages that are not yet translated —space, copies— continue to display exactly
 * what they displayed before, and those that are translated convey their language. The `label` in
 * the table remains as a backup for those who do not provide it.
 */
export function StateDot({
  state,
  withLabel = false,
  locale,
}: {
  state: ProjectState;
  withLabel?: boolean;
  locale: Locale;
}) {
  const style = STATE_STYLE[state];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-[6px] w-[6px] rounded-full ${style.dot}`} aria-hidden />
      {withLabel && (
        <span className={`font-mono text-[11px] ${style.text}`}>
          {t(locale, `state.${state}`).toLowerCase()}
        </span>
      )}
    </span>
  );
}

/**
 * Actual app icon when it exists; if not, a monogram with a color derived from the name. The
 * background is deterministic so that the grid does not change appearance between scans.
 *
 * `tone` decides what color that background is. By default, the brand's purple, which is what it
 * had and what all the pages that don't pass still render. The catalog asks for `neutral`: there,
 * most projects don't have their own icon, so the background appeared forty times on the same
 * screen and the purple stopped being an accent to become the background color of the entire
 * catalog.
 */
export function ProjectIcon({
  name,
  src,
  size = 56,
  tone = "brand",
  locale,
}: {
  name: string;
  src: string | null;
  size?: number;
  tone?: "brand" | "neutral";
  locale: Locale;
}) {
  const isPanoma = name.toLowerCase() === "panoma";
  const generatedAsset = name.toLowerCase() === "demo-runner"
    ? "/assets/projects/demo-runner.png"
    : null;
  const resolvedSrc = isPanoma ? "/assets/brand/panoma.svg" : src ?? generatedAsset;

  if (resolvedSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- ruta dinámica o asset local
      <img
        src={resolvedSrc}
        loading="lazy"
        alt={t(locale, "common.iconOf", { name })}
        width={size}
        height={size}
        className="shrink-0 rounded-[22%] border border-edge object-cover shadow-sm"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-[22%] border border-edge ${
        tone === "neutral" ? "project-icon--neutral" : "bg-raised text-accent"
      }`}
      style={{
        width: size,
        height: size,
      }}
    >
      <HiOutlineCodeBracketSquare style={{ width: size * 0.46, height: size * 0.46 }} />
    </span>
  );
}

export function TechChip({ name, version }: { name: string; version?: string | null }) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded border border-edge bg-raised px-1.5 py-0.5 font-mono text-[11px] text-smoke">
      {name}
      {version && <span className="text-faint">{version}</span>}
    </span>
  );
}

export function Grade({
  score,
  grade,
  locale,
}: {
  score: number;
  grade: string;
  locale: Locale;
}) {
  const tone =
    grade === "A" || grade === "B" ? "text-live" : grade === "C" ? "text-idle" : "text-smoke";
  return (
    <span className={`font-mono text-xs ${tone}`} title={t(locale, "common.health", { score })}>
      {grade}
      <span className="text-faint">{score}</span>
    </span>
  );
}

/*
  `relativeDate` and `relativeTime` live in `lib/relative-date.ts` and are re-exported here.
  They left in order to be able to test themselves: the tests on this website do not transform
  `.tsx`, so everything that remains in this file is code with no one to defend it. They are
  re-exported because half the application imports them from here and moving the imports adds
  nothing.
 */
export { relativeDate, relativeTime } from "@/lib/relative-date";

/* And for the same reason, the bytes: there were three copies and they no longer said the same thing. */
export { formatBytes } from "@/lib/format-bytes";

/**
 * The red line that says what went wrong.
 *
 * It was handwritten in sixteen places with the SAME font, the same size, and the same red — and
 * with ten different class chains, because the only thing that really varied was the top margin.
 * Ten chains for one thing is what causes that the day someone decides to lower the red, nine get
 * changed and one is forgotten.
 *
 * The margin DOES NOT go in here: it is the only thing that depends on the site, and putting it
 * inside would require a parameter for each value. It comes through `className`, which is what
 * everyone is already doing.
 *
 * `role="alert"` does enter, and it's what most didn’t have: these lines appear AFTER someone
 * presses something, and without the paper, a screen reader announces nothing — the action fails
 * and whoever cannot see the screen is left waiting.
 */
export function ActionError({
  text,
  as = "p",
  className,
}: {
  text: string;
  /** `p` cuts the line, `span` goes inside one. It's what each site was already doing. */
  as?: "p" | "span";
  /** The margin, and only the margin. */
  className?: string;
}) {
  const Tag = as;
  return (
    <Tag role="alert" className={`font-mono text-[11px] text-fail${className ? ` ${className}` : ""}`}>
      {text}
    </Tag>
  );
}

/**
 * The button that turns off while it works.
 *
 * Forty buttons on this website write the same thing by hand: `disabled` tied to the work state
 * and a label that alternates between "saving" and "save." Among those forty, there are
 * twenty-nine different class strings, and only four are repeated: these are the four tones, and
 * they cover fourteen buttons. The rest are from a single place and stay there.
 *
 * `tone` sets the four backgrounds that really exist. It does NOT unify sizes: `raised` goes in
 * `text-[11px]` and `surface` in `text-xs` because they are areas of different density, and
 * swapping one for the other would move pixels. `plain` is the one that has no background and
 * lightens the edge instead of accentuating it; `accent` is the solid one.
 *
 * `busy` decides the label; `disabled` decides if it can be clicked, and by default it takes the
 * value of `busy`. They are separated on purpose: half a dozen places turn off the button for more
 * reasons than just working — the field is empty, nothing to save — and joining them here would
 * change when each one is turned off.
 *
 * Margin and placement DO NOT count: they are the only thing that depends on the site. They arrive
 * via `className`, just like in `ActionError`.
 */
const ACTION_BUTTON_TONE = {
  raised:
    "rounded border border-edge bg-raised px-3 py-1.5 font-mono text-[11px] text-smoke transition-colors hover:border-accent hover:text-accent disabled:opacity-50",
  surface:
    "rounded border border-edge bg-surface px-3 py-1.5 font-mono text-xs text-smoke transition-colors hover:border-accent hover:text-accent disabled:opacity-50",
  plain:
    "rounded border border-edge px-2.5 py-1 font-mono text-xs text-smoke transition-colors hover:border-chalk disabled:opacity-50",
  accent:
    "rounded border border-accent bg-accent px-3 py-1.5 font-mono text-xs text-white transition-opacity hover:opacity-85 disabled:opacity-50",
} as const;

export function ActionButton({
  tone,
  busy = false,
  busyLabel,
  disabled,
  className,
  children,
  ...rest
}: {
  tone: keyof typeof ACTION_BUTTON_TONE;
  /** While it is true `busyLabel` is rendered, and it is not pressed unless `disabled` says otherwise. */
  busy?: boolean;
  /**
   * What it says while working. Without it, the label does not change: there are buttons that
   * turn off without changing the word.
   */
  busyLabel?: ReactNode;
  /** When you CANNOT press, if it is for something other than working. */
  disabled?: boolean;
  /** The margin and the placement, and that's it. */
  className?: string;
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "disabled" | "children">) {
  return (
    <button
      {...rest}
      disabled={disabled ?? busy}
      className={`${ACTION_BUTTON_TONE[tone]}${className ? ` ${className}` : ""}`}
    >
      {busy && busyLabel !== undefined ? busyLabel : children}
    </button>
  );
}
