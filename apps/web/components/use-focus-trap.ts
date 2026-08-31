"use client";

import { useEffect, type RefObject } from "react";

/**
 * Trap the tab key within a dialog, and return focus when exiting.
 *
 * The three dialogs of this application—the command palette, the share card, and the confirmation
 * of reserving a project—are drawn on top of everything with a curtain that covers the screen, and
 * until today the keyboard didn't notice. The palette would open, Tab would be pressed, and the
 * focus would go to the sidebar behind: tabbing continued through an interface that, visually, was
 * turned off, with no way to know where it was or to return.
 *
 * It is criterion 2.4.3 of the WCAG, and the problem is not theoretical. With a screen reader, a
 * dialog that does not retain focus is not a dialog: it is a drawing layer above a page that still
 * remains entirely there.
 *
 * What it does, and only that:
 *
 * · **Wrap the Tab.** Upon reaching the last focusable element, the next one returns to the first;
 * with Shift, vice versa. If the focus has escaped —because something was unmounted underneath—,
 * the next Tab brings it back instead of leaving it loose.
 *
 * · **Returns focus on close.** Whoever opens the palette from a button returns to that button.
 * Without this, closing leaves the focus on `body` and the next Tab starts again at the
 * skip-to-content link: the place where one was is lost.
 *
 * What it DOES NOT do is set the initial focus. Each dialogue knows where it wants to start —the
 * palette in its box, the confirmation in its own— and it already did that before.
 *
 * It also does not hide the rest of the page from the screen reader. That is `inert` about the
 * siblings, and in a Next tree, the siblings of a dialogue mounted on the framework are not at
 * hand. With focus trapped, keyboard navigation no longer goes out; the virtual cursor of a reader
 * can still continue down, which is a known limitation and not an oversight.
 */
const ENFOCABLES = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useFocusTrap(caja: RefObject<HTMLElement | null>, open: boolean): void {
  useEffect(() => {
    if (!open) return;

    /*
      Who had the focus before opening. It is saved when opening and not when closing for the
      obvious reason: when closing, the one who has it is something inside the dialog that is
      about to disappear.
     */
    const anterior = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const caja_ = caja.current;
      if (!caja_) return;

      /*
        Two filters, and both were paid with a measured mistake.
        `getClientRects()` and not `offsetParent`: an element inside a `fixed` container —which is
        what the three dialogs are— has a null `offsetParent` even though it is perfectly visible,
        so that filter would discard them all and the fence would fence nothing.
        And `tabIndex >= 0` **in addition** to the selector. The fifteen rows of the palette are
        `<button>` with `tabIndex={-1}`, and `button:not([disabled])` handle them the same: the
        fence thought it had fifteen focusable elements where the browser only sees one, so when
        tabbing from the cell it did not recognize the end of the list and let the focus escape.
        Measured in the open palette: the only case in which the fence did not fence was exactly
        the dialog that is used the most.
       */
      const dentro = [...caja_.querySelectorAll<HTMLElement>(ENFOCABLES)].filter(
        (elemento) => elemento.tabIndex >= 0 && elemento.getClientRects().length > 0,
      );
      if (dentro.length === 0) {
        // A dialogue with nothing to focus on: unless the Tab goes behind.
        event.preventDefault();
        return;
      }

      const primero = dentro[0]!;
      const ultimo = dentro[dentro.length - 1]!;
      const activo = document.activeElement;
      const fuera = !caja_.contains(activo);

      if (event.shiftKey ? activo === primero || fuera : activo === ultimo || fuera) {
        event.preventDefault();
        (event.shiftKey ? ultimo : primero).focus();
      }
    };

    /*
      In capture phase: otherwise, a `onKeyDown` from within the dialog that calls
      `stopPropagation` —and the one from the palette does it with the arrows— could prevent it
      from ever arriving. Listening on capture, the fence is applied before anything else.
     */
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      /* It may have disappeared with the previous page; `focus` does not exist then. */
      anterior?.focus?.();
    };
  }, [caja, open]);
}
