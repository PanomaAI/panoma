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

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/**
 * `useT()` returns `t` with the language already set. Memoized by language so that it can enter
 * dependencies of `useMemo` /`useEffect` without invalidating them on each render.
 */
export function useT(): (key: MessageKey, vars?: TranslationVars) => string {
  const locale = useContext(LocaleContext);
  return useCallback((key: MessageKey, vars?: TranslationVars) => t(locale, key, vars), [locale]);
}
