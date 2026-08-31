"use client";

import { useEffect, useState } from "react";

/**
 * A preference that survives reloading the page.
 *
 * Favorites lived in a plain `useState`: you marked five projects, entered one, returned, and none
 * were left. A star that erases itself teaches not to press it again. The same happened with the
 * filter, the order, and the grid or list view.
 *
 * The initial value is read in an effect and not when constructing the state: on the first render
 * the server does not have `localStorage`, and returning something different from what the client
 * will render is exactly what React calls a hydration error.
 */
export function usePreference<T>(
  key: string,
  fallback: T,
  /**
   * What was this preference called before, if it was called something else.
   *
   * When transferring the project to English, `favoritos` became `favorites`. Without this, anyone
   * who had twelve marked projects would open the catalog and not find any: the star that deletes
   * itself teaches not to click it again, and it doesn't matter if the reason is a name change. It
   * is read once, rewritten with the new name, and the old one is erased.
   */
  legacyKey?: string,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`panoma:${key}`);
      if (stored !== null) {
        setValue(JSON.parse(stored) as T);
        return;
      }
      if (!legacyKey) return;
      const legacy = window.localStorage.getItem(`panoma:${legacyKey}`);
      if (legacy === null) return;
      setValue(JSON.parse(legacy) as T);
      window.localStorage.setItem(`panoma:${key}`, legacy);
      window.localStorage.removeItem(`panoma:${legacyKey}`);
    } catch {
      // Private mode, full quota, or a corrupt value from a previous version: it continues with the
      // default value, which is exactly the previous behavior.
    }
  }, [key, legacyKey]);

  function update(next: T) {
    setValue(next);
    try {
      window.localStorage.setItem(`panoma:${key}`, JSON.stringify(next));
    } catch {
      // The fact that it cannot be remembered is not a reason for it not to be usable.
    }
  }

  return [value, update];
}
