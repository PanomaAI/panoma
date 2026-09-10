import { t, type Locale, type MessageKey } from "@/lib/i18n";
import { Tag, type TagTone } from "./primitives";

/*
  Only the tone lives here, and it used to be a class chain: one of the five colour maps that sat
  behind the same word-pill. `container` was `border-live/30 bg-live/10 text-live`, which is what
  `Tag`'s `live` renders, and the other two map the same way — so the pill is now one recipe and
  this file keeps only the part that is a decision.
  The sign and the explanation are interface text, and the interface text lives in the dictionary: `isolation.local.title` is a paragraph about what an installation
  script touched on your machine, and that is precisely the paragraph that cannot appear in a
  language the reader does not understand.
 */
const TONE: Record<string, TagTone> = {
  container: "live",
  hardened: "accent",
  local: "idle",
};

/**
 * With what isolation did a proposal run.
 *
 * It is always shown, even when it is the lowest level. A proposal verified in a container
 * deserves more trust than one verified on the host, and presenting them the same would be hiding
 * exactly the difference that matters.
 */
export function IsolationTag({
  isolation,
  note,
  locale,
}: {
  isolation: string;
  note?: string | null;
  locale: Locale;
}) {
  const level = isolation in TONE ? isolation : "local";
  return (
    <span className="inline-flex items-center gap-1.5">
      <Tag tone={TONE[level]!} title={note ?? t(locale, `isolation.${level}.title` as MessageKey)}>
        {t(locale, `isolation.${level}` as MessageKey)}
      </Tag>
      {note && (
        <span className="font-mono text-[10px] text-faint">
          {t(locale, "isolation.degraded")}
        </span>
      )}
    </span>
  );
}
