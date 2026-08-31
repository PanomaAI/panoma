"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Close a panel by clicking outside or by pressing Escape.
 *
 * Four dropdowns wrote it on their own —the account sheet, the open menu, the action bar of the
 * sheet, and the list of models—, and they had already started to diverge: three were listening to
 * `pointerdown` on `window` and the fourth `mousedown` on `document`.
 *
 * It is not a detail. `pointerdown` covers mouse, pen, and finger with the same event; `mousedown`
 * arrives for the finger only because the browser synthesizes it afterwards, and for the pen it
 * sometimes does not arrive. With a tablet, that fourth panel would stay open when touching
 * outside. Here all four close the same way.
 *
 * What does NOT unify is the panel: the four are visually different and they do not resemble each
 * other in anything else but this. The hook is removed, not the box.
 *
 * `reason` is there because closing with Escape sometimes has to do something else: the account
 * tab returns focus to its button, or someone navigating with the keyboard is left with nothing
 * and has to go through the whole bar to get back to where they were.
 */
export function useDismissable(
  box: RefObject<HTMLElement | null>,
  open: boolean,
  dismiss: (reason: "outside" | "escape") => void,
): void {
  /*
    The notice is saved in a reference and is not listed as a dependency on purpose: otherwise, an
    inline-written function —which is what this is called in the four places— changes identity on
    each render and the listeners are removed and re-added each time. They are registered once per
    opening, which is what the previous code did.
   */
  const latest = useRef(dismiss);
  useEffect(() => {
    /*
      It is assigned in an effect and not during rendering. Writing to a ref while rendering is
      prohibited —React can start a render, throw it away, and start again—, and here it is not
      necessary: both listeners read `latest.current` once it has already been rendered.
     */
    latest.current = dismiss;
  });

  useEffect(() => {
    if (!open) return;

    /*
      Inside the box it doesn't close, or the arrow itself would close on itself before its click
      arrived.
     */
    const onPointerDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) latest.current("outside");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") latest.current("escape");
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [box, open]);
}
