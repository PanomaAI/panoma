import { ORIGIN_EVIDENCE_CODES, type OriginEvidence } from "@panoma/core";
import { t, type Locale, type MessageKey } from "@/lib/i18n";

/**
 * Why Panoma classified a project like this, written in the language of the reader.
 *
 * The verdict —'own', 'split', 'other's'— was already going through the dictionary. The underlying
 * reasons were not: they were composed in Spanish inside the engine, so the card showed half a
 * screen translated and half untranslated.
 *
 * And the reasons are half of what matters. For almost everyone, the verdict is 'their own,' so
 * without them it is no different from a default value: what convinces that Panoma has really
 * looked is reading 'the first commit is yours' and being able to go check it.
 */

const CODES: ReadonlySet<string> = new Set(ORIGIN_EVIDENCE_CODES);

export function renderEvidence(locale: Locale, evidence: OriginEvidence[]): string[] {
  return evidence.map((item) => renderOne(locale, item)).filter((line): line is string => Boolean(line));
}

function renderOne(locale: Locale, item: OriginEvidence): string | undefined {
  if (!item || !CODES.has(item.code)) return undefined;
  /*
    `n` goes in addition to `value` for the two sentences that have a countable figure —"and the
    history has 12 commits"—. With the placeholder called `n`, the form of the word is solved by
    `t()` alone by looking at the number, which is the mechanism that prevents '1 commits' from
    appearing again.
   */
  const value = item.value;
  return t(locale, `origin.${item.code}` as MessageKey, {
    value: value ?? "",
    ...(typeof value === "number" ? { n: value } : {}),
  });
}

/**
 * The saved item comes from `jsonb`, so it arrives as `unknown` and it must be checked before
 * being believed.
 *
 * And there are previous rows: until 08-25-2026 this was stored as an array of already written
 * sentences, in Spanish. These are shown as they are —old Spanish is better than a gap— and they
 * fix themselves as soon as the project is scanned again.
 */
export function evidenceLines(locale: Locale, stored: unknown): string[] {
  if (!Array.isArray(stored)) return [];

  return stored
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "code" in item) {
        return renderOne(locale, item as OriginEvidence);
      }
      return undefined;
    })
    .filter((line): line is string => Boolean(line));
}
