"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { HiOutlineEye, HiOutlineEyeSlash, HiOutlineTrash } from "react-icons/hi2";
import { useT } from "./i18n-provider";
import { useFocusTrap } from "./use-focus-trap";

/**
 * Hide and remove from the catalog.
 *
 * The two actions are separated because they are not the same thing and the user has to be able to
 * distinguish them before clicking: hide removes from view and gets rid of with one click; exclude
 * takes out of the catalog and you have to rescan to recover it.
 *
 * No one touches the record, and that is said **within** the dialogue, not in a footnote. The word
 * 'delete' is felt in the stomach, and whoever presses it needs to know at that exact moment that
 * their folder stays where it is.
 */
export function ProjectActions({
  projectId,
  name,
  hidden,
  redirectTo,
  appearance = "inline",
}: {
  projectId: string;
  name: string;
  hidden: boolean;
  /** Where to go after excluding. The chip ceases to exist. */
  redirectTo?: string;
  appearance?: "inline" | "menu";
}) {
  const translate = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The two words that travel to the API —'hide' and 'show'— are the command, not a label: they
  // remain in Spanish no matter what happens with the language on the screen.
  async function act(action: "ocultar" | "mostrar", confirmation?: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id: projectId, confirmation }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? translate("project.actionFailed"));
      } else router.refresh();
    } catch {
      setError(translate("project.unreachable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span className={appearance === "menu" ? "project-menu-actions" : "inline-flex flex-wrap items-baseline gap-2"}>
        <button
          type="button"
          onClick={() => act(hidden ? "mostrar" : "ocultar")}
          disabled={busy}
          title={translate(hidden ? "project.showTitle" : "project.hideTitle")}
          className={
            appearance === "menu"
              ? "project-menu-item"
              : "inline-flex items-center gap-1.5 rounded border border-edge px-2 py-0.5 font-mono text-[11px] text-smoke transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          }
        >
          {hidden ? (
            <HiOutlineEye className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <HiOutlineEyeSlash className="h-3.5 w-3.5" aria-hidden />
          )}
          {translate(hidden ? "project.show" : "project.hide")}
        </button>

        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy}
          title={translate("project.removeTitle")}
          className={
            appearance === "menu"
              ? "project-menu-item project-menu-item--danger"
              : "inline-flex items-center gap-1.5 rounded border border-edge px-2 py-0.5 font-mono text-[11px] text-smoke transition-colors hover:border-fail hover:text-fail disabled:opacity-50"
          }
        >
          <HiOutlineTrash className="h-3.5 w-3.5" aria-hidden />
          {translate("project.remove")}
        </button>

        {error && (
          <span className={appearance === "menu" ? "project-menu-error" : "font-mono text-[11px] text-fail"}>
            {error}
          </span>
        )}
      </span>

      {confirming && (
        <ConfirmDelete
          name={name}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={async (confirmation) => {
            setBusy(true);
            setError(null);
            try {
              const response = await fetch("/api/project", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "excluir", id: projectId, confirmation }),
              });
              const payload = await response.json();
              if (!response.ok) {
                setError((payload as { error?: string }).error ?? translate("project.actionFailed"));
                setConfirming(false);
              } else {
                setConfirming(false);
                if (redirectTo) router.push(redirectTo);
                else router.refresh();
              }
            } catch {
              setError(translate("project.unreachable"));
              setConfirming(false);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}

/**
 * Confirmation dialog with the name typed by hand.
 *
 * The text that needs to be written is the name of the project and not a generic 'DELETE': that
 * forces you to look at **which** one is being removed, which is the mistake that is actually made
 * —not 'I didn't want to delete anything', but 'I didn't want to delete *that*'.
 */
function ConfirmDelete({
  name,
  busy,
  onCancel,
  onConfirm,
}: {
  name: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (confirmation: string) => void;
}) {
  const translate = useT();
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const matches = typed.trim() === name;

  /*
    The Tab stays inside, and when closing the focus it returns to the button that opened this.
    Without the border, tabbing from the confirmation field went to the sidebar behind: you
    continued moving through an interface that is visually off, and here that is worse than in the
    other two dialogs, because the next ↵ of that movement presses the button that was focused and
    this dialog exists precisely so that no extra pressing occurs.
   */
  useFocusTrap(dialogRef, true);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        ref={dialogRef}
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (matches && !busy) onConfirm(typed.trim());
        }}
      >
        <h2 id="confirm-title">{translate("project.removeHeading", { name })}</h2>

        <p>{translate("project.removeBody")}</p>
        <p className="confirm-dialog__safe">
          <strong>{translate("project.removeSafeStrong")}</strong>{" "}
          {translate("project.removeSafeBody")}
        </p>

        <label>
          {/*
             In a `span`: the `label` is a grid, and the loose text was spread over three rows
             with the name stretched across in the middle.
            */}
          <span>
            {translate("project.removeTypeBefore")} <code>{name}</code>{" "}
            {translate("project.removeTypeAfter")}
          </span>
          <input
            ref={inputRef}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label={translate("project.removeTypeAria", { name })}
          />
        </label>

        <div className="confirm-dialog__actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            {translate("project.cancel")}
          </button>
          <button type="submit" disabled={!matches || busy} className="is-danger">
            {translate(busy ? "project.removing" : "project.removeConfirm")}
          </button>
        </div>
      </form>
    </div>
  );
}
