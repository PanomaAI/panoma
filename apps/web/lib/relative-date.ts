/**
 * How long ago, said in words, in both languages.
 *
 * It lives here and not inside `components/primitives.tsx` for the same reason as
 * `account-url.ts`: it can be tested. The tests on this website do not transform `.tsx` — it is on
 * purpose — and these two functions are rendered by half the application: the grid, the record, the
 * logbook, and the daily report.
 *
 * The bug that brought them here: between day thirty and fifty-nine they said 'hace 1 meses' and
 * '1 months ago'. The range for years had its guard from day one and the one for months did not,
 * and it is only seen with a project touched exactly one month ago.
 */

// Relative and not `@/lib/…`: this module is tested with vitest, which does not resolve the alias.
import type { Locale } from "./i18n";

/*
  The language is optional and Spanish by default: pages that haven't been migrated yet still call
  with a single argument and don't change a single letter. Without the English variant, the
  translated homepage would say "Last commit hace 2 días" — half a language is worse than none.
 */
export function relativeDate(date: Date | string | null, locale: Locale = "es"): string {
  if (!date) return "—";
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
  if (locale === "en") {
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days} d ago`;
    if (days < 365) {
      const months = Math.floor(days / 30);
      return `${months} month${months === 1 ? "" : "s"} ago`;
    }
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? "" : "s"} ago`;
  }
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} d`;
  if (days < 365) {
    /*
      The section of the months flexed in plural without looking at the number: between day thirty
      and fifty-nine, the whole product said "hace 1 meses" and "1 months ago." It is the house
      rule—never a word inflected attached to a number without guard—and the section of the years,
      three lines below, had always followed it.
     */
    const months = Math.floor(days / 30);
    return `hace ${months} ${months === 1 ? "mes" : "meses"}`;
  }
  const years = Math.floor(days / 365);
  return `hace ${years} año${years === 1 ? "" : "s"}`;
}

/*
  The same as `relativeDate`, but without rounding to days.
  There were two copies of this function, each in its component and both in fixed Spanish:
  `when()` in the daily report and `sinceLabel()` in the commit panel of the record. They said the
  same thing with different words — one ended with '3 days ago' and the other with a 'Mar 12' that
  was not relative — for the same fact: when this happened. Now there is only one.
  The precision of minutes and hours is the reason why `relativeDate` alone is not useful: 'today'
  could be ten minutes ago or fourteen hours ago, and going back to what you left after lunch is
  not the same as finding what an agent did in the early morning. After two days, precision is
  unnecessary and can be delegated, which is where the rest of the language lives.
  `now` can be passed because whoever groups by windows needs all rows to be measured against the
  same instant: two calls to `Date.now()` in the same render can fall on different sides of a
  boundary and split a group in half.
 */
export function relativeTime(at: string | Date, locale: Locale = "es", now = Date.now()): string {
  const ms = now - new Date(at).getTime();
  if (!Number.isFinite(ms)) return "—";
  const english = locale === "en";
  // The 'less than a minute' also covers clocks set ahead: a commit with a date in the future says
  // 'right now' instead of '3 minutes ago'.
  if (ms < 60_000) return english ? "just now" : "ahora mismo";
  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000);
    return english ? `${minutes} min ago` : `hace ${minutes} min`;
  }
  if (ms < 48 * 3_600_000) {
    const hours = Math.floor(ms / 3_600_000);
    return english ? `${hours} h ago` : `hace ${hours} h`;
  }
  return relativeDate(at, locale);
}
