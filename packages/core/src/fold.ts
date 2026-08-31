/**
 * Lowercase and without accents: the basis for comparing text that a person wrote.
 *
 * Nobody types "Web Design" when looking for their project. They type "diseno," or "diseño" with
 * the accent in the wrong place, and expect to find it anyway. This is the operation that allows
 * it, and it was written five times in the repository with five variants: two removed the marks
 * with `\p{Diacritic}` and two with the range `[̀-ͯ]`, which is narrower.
 *
 * Five copies were not five oversights: each site does something different **on top** —trimming,
 * collapsing spaces, leaving only letters and numbers—. What repeated was this, and it is the only
 * thing taken from here. Each call continues doing its own thing afterwards.
 *
 * It lives in its own module rather than `index.ts` because the browser also needs it, and the
 * index of this package drags `node:fs`. Same reason and same treatment as `untrusted.ts`.
 *
 * `\p{Diacritic}` and not the range: it covers more marks —those of Vietnamese, those of polytonic
 * Greek— and where the narrow range was previously used, what comes afterward (sticking only with
 * `a-z0-9`, or collapsing spaces) makes the widening harmless.
 */
export function fold(value: string): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}
