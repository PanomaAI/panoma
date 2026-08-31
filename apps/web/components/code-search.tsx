"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HiOutlineFolderOpen, HiOutlineMagnifyingGlass } from "react-icons/hi2";
import { useT } from "./i18n-provider";
import { fileLink, useOpenTarget } from "./use-open-target";

type Match = { file: string; line: number; text: string };
type Result = {
  id: string;
  name: string;
  slug: string;
  root: string;
  matches: Match[];
  truncated: boolean;
};
type Payload = {
  query: string;
  searched: number;
  skipped: number;
  total: number;
  results: Result[];
};

/**
 * Code search across the entire portfolio.
 *
 * Each answer says **in how many projects it was searched for and in how many it couldn't be**.
 * Without that line, 'no results' and 'I didn't look at half' read exactly the same, and the
 * second one is what makes you stop using a search engine.
 *
 * And each match opens on its line. Finding the file and the number and then having to go look for
 * it manually leaves the work half done: the result already knew where what you were looking for
 * was. It opens with a link `vscode://` or `cursor://` —a scheme that the operating system
 * resolves, not a request to the server—just so you don't have to send a path from the browser:
 * `/api/open` does not accept any on purpose, and this route does not ask you to start doing so.
 * The path is composed with the root that the catalog itself returned.
 */
export function CodeSearch({ initialQuery }: { initialQuery: string }) {
  const t = useT();
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<"ready" | "searching">("ready");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // In remote mode, neither the folder nor the file are on this disk: nothing is displayed that
  // points to them, instead of offering links that open nothing.
  const { remote, editor } = useOpenTarget();

  const search = useCallback(
    async (term: string) => {
      if (term.trim().length < 2) return;
      setState("searching");
      setError(null);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term.trim())}`);
        const body = await response.json();
        if (response.ok) setPayload(body as Payload);
        else setError((body as { error?: string }).error ?? t("search.failed"));
      } catch {
        setError(t("search.unreachable"));
      } finally {
        setState("ready");
      }
    },
    // `useT` is memoized by language, so this is not redone in each render: only if someone changes
    // the language, and then the page reloads entirely anyway.
    [t],
  );

  // A search that arrives in the URL (from the palette, or shared) runs by itself.
  useEffect(() => {
    if (initialQuery.trim().length >= 2) void search(initialQuery);
    else inputRef.current?.focus();
  }, [initialQuery, search]);

  return (
    <div>
      <form
        className="code-search"
        onSubmit={(event) => {
          event.preventDefault();
          void search(query);
          // The URL reflects the search so that it can be recharged and shared.
          const url = new URL(window.location.href);
          url.searchParams.set("q", query.trim());
          window.history.replaceState(null, "", url);
        }}
      >
        <HiOutlineMagnifyingGlass aria-hidden />
        {/* The marker is not translated: they are examples of what is typed, not text that is read. */}
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="stripe.webhook, TODO, API_KEY…"
          aria-label={t("search.fieldLabel")}
        />
        <button type="submit" disabled={state === "searching" || query.trim().length < 2}>
          {t(state === "searching" ? "search.searching" : "search.submit")}
        </button>
      </form>

      {/*
         Folder names remain outside the translated sentence —they are folder names, the same in
         both languages— and thus retain their `code` without splitting the sentence into two
         keys, which is how one ends up with a word order that is impossible to translate.
        */}
      <p className="mt-2 font-mono text-[11px] text-faint">
        {t("search.scopeNote")} {t("search.scopeVendors")} <code>Pods</code>, <code>vendor</code>,{" "}
        <code>third_party</code>, <code>node_modules</code>.
      </p>

      {error && <p className="mt-3 font-mono text-xs text-fail">{error}</p>}

      {payload && (
        <>
          <p className="mt-6 flex flex-wrap gap-x-4 font-mono text-xs text-faint">
            <span className="text-chalk">
              {t(payload.total === 1 ? "search.matchOne" : "search.matchMany", { n: payload.total })}{" "}
              {t(
                payload.results.length === 1 ? "search.inProjectOne" : "search.inProjectMany",
                { n: payload.results.length },
              )}
            </span>
            <span>{t("search.reposSearched", { n: payload.searched })}</span>
            {payload.skipped > 0 && (
              <span className="text-idle" title={t("search.skippedTitle")}>
                {t("search.skipped", { n: payload.skipped })}
              </span>
            )}
            {/*
               That a line can be clicked is not seen alone, and it is what turns this page into
               the shortcut it intends to be.
              */}
            {!remote && payload.results.length > 0 && (
              <span className="ml-auto">{t("search.clickToOpen")}</span>
            )}
          </p>

          {payload.results.length === 0 ? (
            <p className="mt-4 rounded border border-edge bg-surface p-5 text-sm text-smoke">
              {t("search.noMatch", { query: payload.query })}
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {payload.results.map((result) => (
                <li key={result.id} className="rounded-lg border border-edge bg-surface">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-edge px-4 py-2.5">
                    <a
                      href={`/p/${result.slug}`}
                      className="text-sm font-medium hover:text-accent"
                    >
                      {result.name}
                    </a>
                    <span className="font-mono text-[11px] text-faint" title={result.root}>
                      {shorten(result.root)}
                    </span>
                    <span className="ml-auto font-mono text-[11px] text-accent">
                      {result.matches.length}
                      {result.truncated && "+"}
                    </span>
                    {!remote && <OpenFolderButton id={result.id} />}
                  </div>
                  <ul className="divide-y divide-edge/50">
                    {result.matches.map((match) => {
                      const link = remote
                        ? null
                        : fileLink(editor, result.root, match.file, match.line);
                      const where = (
                        <>
                          {match.file}
                          <span className="text-accent">:{match.line}</span>
                        </>
                      );
                      return (
                        <li
                          key={`${match.file}:${match.line}`}
                          className="flex gap-3 px-4 py-1.5 font-mono text-[11px]"
                        >
                          {/*
                             Without a known editor there is no link and the usual text remains:
                             never a link that leads nowhere.
                            */}
                          {link ? (
                            <a
                              href={link}
                              className="w-56 shrink-0 truncate text-faint hover:text-accent"
                              title={t("search.openAt", { file: match.file, line: match.line })}
                            >
                              {where}
                            </a>
                          ) : (
                            <span className="w-56 shrink-0 truncate text-faint" title={match.file}>
                              {where}
                            </span>
                          )}
                          <code className="min-w-0 flex-1 truncate text-smoke">{match.text}</code>
                        </li>
                      );
                    })}
                  </ul>
                  {result.truncated && (
                    <p className="px-4 py-1.5 font-mono text-[10px] text-faint">
                      {t("search.truncated", { n: result.matches.length })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function OpenFolderButton({ id }: { id: string }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  return (
    <button
      type="button"
      title={error ?? t("search.openFolder")}
      onClick={async () => {
        try {
          const response = await fetch("/api/open", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          });
          if (!response.ok) {
            const body = await response.json();
            setError((body as { error?: string }).error ?? t("search.openFailed"));
          }
        } catch {
          setError(t("search.unreachable"));
        }
      }}
      className={`shrink-0 ${error ? "text-fail" : "text-faint hover:text-accent"}`}
      aria-label={t("search.openFolderAria")}
    >
      <HiOutlineFolderOpen className="h-4 w-4" aria-hidden />
    </button>
  );
}

function shorten(root: string): string {
  const parts = root.split("/");
  return parts.length <= 3 ? root : `…/${parts.slice(-2).join("/")}`;
}
