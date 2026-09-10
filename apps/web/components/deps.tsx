import { bumpType, isOutdated, type Bump } from "@panoma/enrich";
import { t, type Locale, type MessageKey } from "@/lib/i18n";
import { Tag, type TagTone } from "./primitives";

const BUMP_STYLE: Record<Bump, string> = {
  major: "text-idle",
  minor: "text-accent",
  patch: "text-smoke",
  prerelease: "text-smoke",
  same: "text-faint",
  unknown: "text-faint",
};

/**
 * Difference between the version you use and the latest published.
 *
 * The major leap stands out in amber because it is the only one that usually breaks: a delayed
 * patch is noise, three major delayed versions are a pending decision.
 */
export function VersionDiff({
  current,
  latest,
}: {
  current: string | null;
  latest: string | null;
}) {
  if (!current) return <span className="text-faint">—</span>;
  if (!latest || !isOutdated(current, latest)) {
    return <span className="text-smoke">{current}</span>;
  }

  const bump = bumpType(current, latest);
  return (
    <span className="whitespace-nowrap">
      <span className="text-faint line-through">{current}</span>
      <span className="mx-1 text-faint">→</span>
      <span className={BUMP_STYLE[bump]}>{latest}</span>
    </span>
  );
}

/**
 * Severity, as one of the pill's tones.
 *
 * It used to be five class chains, and they were the fifth of the five colour maps behind one
 * word-pill — `activity.tsx`, `run-status.tsx`, `isolation.tsx` and `resume.tsx` wrote the other
 * four. What each chain said is exactly what a tone says, letter for letter, so nothing here moves
 * a pixel: `critical` was `text-fail border-fail/30 bg-fail/10`, which is `Tag`'s `fail`, and the
 * other four map the same way.
 */
export const SEVERITY_TONE: Record<string, TagTone> = {
  critical: "fail",
  high: "idle",
  medium: "accent",
  low: "neutral",
  unknown: "quiet",
};

/**
 * Severity, named in the viewer's language.
 *
 * Before, the value was rendered as it was and could be read well, because the value was in
 * Spanish. When transferring the data to English, that stopped working: the word that arrives is
 * `high`, and 'high' in the middle of a page in Spanish is a piece of data that has escaped to the
 * screen. The raw value is still at hand in `title` for anyone who is debugging.
 */
export function SeverityTag({ severity, locale }: { severity: string; locale: Locale }) {
  const key = `severity.${severity}` as MessageKey;
  const label = t(locale, key);
  return (
    <Tag tone={SEVERITY_TONE[severity] ?? SEVERITY_TONE["unknown"]!} title={severity}>
      {label ?? severity}
    </Tag>
  );
}
