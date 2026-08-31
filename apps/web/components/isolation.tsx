import { t, type Locale, type MessageKey } from "@/lib/i18n";

/*
  Only the color lives here. The sign and the explanation are interface text, and the interface
  text lives in the dictionary: `isolation.local.title` is a paragraph about what an installation
  script touched on your machine, and that is precisely the paragraph that cannot appear in a
  language the reader does not understand.
 */
const STYLE: Record<string, string> = {
  container: "border-live/30 bg-live/10 text-live",
  hardened: "border-accent/30 bg-accent/10 text-accent",
  local: "border-idle/30 bg-idle/10 text-idle",
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
  const level = isolation in STYLE ? isolation : "local";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        title={note ?? t(locale, `isolation.${level}.title` as MessageKey)}
        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${STYLE[level]}`}
      >
        {t(locale, `isolation.${level}` as MessageKey)}
      </span>
      {note && (
        <span className="font-mono text-[10px] text-faint">
          {t(locale, "isolation.degraded")}
        </span>
      )}
    </span>
  );
}
