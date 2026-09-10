/**
 * Is `candidate` a later version than `current`?
 *
 * Comparison by numeric parts and nothing else. A semver library is not brought in from outside
 * for a twelve-line function, and what has to be decided here is exactly that: whether the number
 * on the right is greater. Any prerelease suffix (`-rc.1`) is ignored when comparing, which is
 * correct: someone on `0.2.0-rc.1` should not be told to move to `0.2.0` as if it were something
 * else, and someone on `0.1.0` should be.
 *
 * It lives in the engine, and not next to whoever asks the registry, because **two surfaces now
 * compare the same two numbers**: the terminal, which says it when you start your day, and the
 * catalog in the browser, which is the one running for weeks. Two copies of the prerelease rule
 * would eventually disagree about the same pair of versions on the same machine, and the person
 * would have no way to tell which half was wrong. It is pure arithmetic with no imports, so the
 * rule that the engine does not touch the network is untouched by it.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parts = (version: string) =>
    version
      .split("-")[0]!
      .split(".")
      .map((piece) => Number.parseInt(piece, 10))
      .map((number) => (Number.isFinite(number) ? number : 0));

  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
