"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { t, type Locale, type MessageKey, type TranslationVars } from "@/lib/i18n";

/**
 * The language comes down from the layout by context and not by props: it is needed from the
 * sidebar to the last button on a card, and threading it manually through each intermediate
 * component is the kind of plumbing that ends up out of sync.
 *
 * The default value is "en" on purpose, the same one that `getLocale()` resolves when there is no
 * cookie or header: a component rendered outside the provider —a test, a future Storybook— speaks
 * the product's default language, not another.
 */
const LocaleContext = createContext<Locale>("en");

/**
 * And the name of the command, down the same road, because the reasoning above holds word for
 * word: whether the reader types `panoma` or `npx panoma` is needed anywhere a sentence tells them
 * to type something, and that is scattered over route handlers, pages and half a dozen cards.
 *
 * It cannot be read here from the environment: `PANOMA_EPHEMERAL` is not a `NEXT_PUBLIC_` variable
 * and the browser bundle does not carry it. Only the server knows, so the server passes it.
 *
 * The default is "panoma" for the same reason "en" is the default above — it is what `cliName()`
 * answers for the ordinary install, so a component rendered outside the provider says the common
 * thing rather than a third one.
 */
const CliContext = createContext<string>("panoma");

export function I18nProvider({
  locale,
  cli,
  children,
}: {
  locale: Locale;
  cli: string;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>
      <CliContext.Provider value={cli}>{children}</CliContext.Provider>
    </LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/**
 * The command name on its own, for the places where it is not inside a sentence: a `<pre>` to copy
 * or a `<code>` that goes into a `Rich` slot.
 */
export function useCliName(): string {
  return useContext(CliContext);
}

/**
 * `useT()` returns `t` with the language already set. Memoized by language so that it can enter
 * dependencies of `useMemo` /`useEffect` without invalidating them on each render.
 *
 * It also puts `{cli}` in every call without being asked. That is deliberate and it is the same
 * lesson as the shape gaps in `lib/i18n.ts`: a gap that every call site has to remember is a gap
 * that some call site will forget, and this one fails quietly — the sentence still renders, it
 * just names a command the reader does not have. Passing it explicitly still wins, because `vars`
 * is spread afterwards.
 */
export function useT(): (key: MessageKey, vars?: TranslationVars) => string {
  const locale = useContext(LocaleContext);
  const cli = useContext(CliContext);
  return useCallback(
    (key: MessageKey, vars?: TranslationVars) => t(locale, key, { cli, ...vars }),
    [locale, cli],
  );
}
