/**
 * Which search term corresponds to an address.
 *
 * A one-line rule, in its own file, because it is the only source of truth for a screen that until
 * now had two and they did not talk to each other: the `?q=` from the address bar and a copy in
 * the state of each component, sewn by hand with an event that only traveled in one direction.
 *
 * The rule itself: the term only exists in the catalog. When opening a project's record, the box
 * empties, because it doesn't filter anything there, and leaving what was written before invites
 * typing over a filter that doesn't exist.
 */
export function queryForPath(pathname: string, search: string | URLSearchParams): string {
  if (pathname !== "/") return "";
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return params.get("q") ?? "";
}
