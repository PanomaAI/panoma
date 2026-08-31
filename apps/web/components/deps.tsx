import { bumpType, isOutdated, type Bump } from "@panoma/enrich";
import { t, type Locale, type MessageKey } from "@/lib/i18n";

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

export const SEVERITY_STYLE: Record<string, string> = {
  critical: "text-fail border-fail/30 bg-fail/10",
  high: "text-idle border-idle/30 bg-idle/10",
  medium: "text-accent border-accent/30 bg-accent/10",
  low: "text-smoke border-edge bg-raised",
  unknown: "text-faint border-edge bg-raised",
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
    <span
      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
        SEVERITY_STYLE[severity] ?? SEVERITY_STYLE["unknown"]
      }`}
      title={severity}
    >
      {label ?? severity}
    </span>
  );
}
