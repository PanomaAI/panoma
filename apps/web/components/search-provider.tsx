"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { queryForPath } from "./search-query";

/**
 * The search term, with a single owner.
 *
 * Before, two had it: the top bar's box and the catalog grid, each with its `useState`, stitched
 * with a `panoma:search` event that the bar emitted and the grid listened to. In one direction and
 * nothing more, so it unraveled on both sides:
 *
 * - 'Clear filters' would clean the grid and trigger the event, but the bar didn't listen: the box
 * kept the old term, and when typing a letter it would filter again by everything previous.
 * - With the Back button, the bar did know —look at the URL— and the grid didn’t, since it only
 * read it when mounting: the box emptied and the grid remained filtered.
 *
 * The circle could be closed by making the bar listen as well. The other thing has been done:
 * remove the channel. Two manually synchronized copies get out of sync again as soon as a third
 * site starts writing — and there were already three: the box, the delete button, and the URL. Now
 * the state is one and both read it.
 *
 * **Why the state and not the URL directly.** The filtering is from the grid, on data that is
 * already on the client: writing to the URL on every keystroke would force a round trip to the
 * server for each letter for a filter that never needed the server. The URL remains the durable
 * copy —it is written when sending, and they send it along with the Back button—, which fixes the
 * second bug: this effect depends on `useSearchParams`, which does change when navigating.
 */
const SearchContext = createContext<{ query: string; setQuery: (value: string) => void }>({
  query: "",
  setQuery: () => {},
});

export function useSearch() {
  return useContext(SearchContext);
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(() => queryForPath(pathname, params));

  useEffect(() => {
    setQuery(queryForPath(pathname, params));
  }, [pathname, params]);

  const value = useMemo(() => ({ query, setQuery }), [query]);
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}
