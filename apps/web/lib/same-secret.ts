/**
 * Compare two credentials without saying where they stop resembling each other.
 *
 * `a === b` exits the loop at the first character that does not match, and that time difference is
 * measurable: with it, a 64-character key can be guessed character by character in a few thousand
 * attempts instead of never. It is always traversed entirely and the difference accumulates.
 *
 * Live here and not in `guard.ts` because the middleware also needs it, and the middleware runs in
 * a runtime without `node:crypto` or disk: `timingSafeEqual` does not exist there. This file
 * deliberately does not matter, so that both can use it.
 *
 * Early exit due to different length does not filter anything important: the length of a Panoma
 * key is public—64 characters—and it is not what needs to be guessed.
 */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
