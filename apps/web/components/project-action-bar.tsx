"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  HiOutlineArrowPath,
  HiOutlineBolt,
  HiOutlineCheck,
  HiOutlineClipboardDocument,
  HiOutlineEllipsisHorizontal,
  HiOutlineExclamationCircle,
} from "react-icons/hi2";
import { CreateVideo } from "./create-video";
import { OpenAll } from "./open-all";
import { OpenMenu } from "./open-menu";
import { ProjectActions } from "./project-actions";
import { useLocale, useT } from "./i18n-provider";
import { useDismissable } from "./use-dismissable";

export function ProjectActionBar({
  projectId,
  projectName,
  slug,
  path,
  hidden,
  videoReady,
}: {
  projectId: string;
  projectName: string;
  slug: string;
  path: string;
  hidden: boolean;
  /** Resolved by the page from the catalog row: no request, and right on the first paint. */
  videoReady: boolean;
}) {
  const translate = useT();
  // `OpenFolder` takes the language as a prop, not from the context: see why in its file.
  const locale = useLocale();
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<"ok" | "error">("ok");
  const [rescanning, setRescanning] = useState(false);
  /* Each press of the menu item bumps it; the button opens its configurator on every change. */
  const [configureSignal, setConfigureSignal] = useState(0);

  useDismissable(menuRef, open, () => setOpen(false));

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(path);
      setNoticeTone("ok");
      setNotice(translate("project.pathCopied"));
      setTimeout(() => setNotice(null), 1800);
    } catch {
      setNoticeTone("error");
      setNotice(translate("project.pathCopyFailed"));
    }
  }

  async function rescan() {
    setRescanning(true);
    setNotice(null);
    try {
      const response = await fetch("/api/rescan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: projectId }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? translate("project.rescanFailed"));
      }
      setNoticeTone("ok");
      setNotice(translate("project.rescanned"));
      router.refresh();
    } catch (error) {
      setNoticeTone("error");
      // If the error comes from the API it comes in Spanish, which is how it responds entirely.
      setNotice((error as Error).message);
    } finally {
      setRescanning(false);
    }
  }

  return (
    <div className="project-action-bar" ref={menuRef}>
      <div className="project-action-bar__primary">
        {/*
           One click for the whole desk, before the split button that opens one place.
           The links the catalog knows, a terminal with the dev server, the editor, the agent:
           `OpenAll` runs the project's plan, and shows it first the day there is none.
          */}
        <OpenAll projectId={projectId} projectName={projectName} configureSignal={configureSignal} />
        {/*
           A split button instead of three generic verbs.
           The tab offered 'open in editor,' 'open terminal,' and 'open folder' while the catalog
           panel already listed the programs by their name — two screens of the same project
           responding differently to 'open it for me.' Here are the same nine destinations, in the
           same order, behind the arrow.
          */}
        <CreateVideo slug={slug} ready={videoReady} />
        <OpenMenu
          projectId={projectId}
          path={path}
          locale={locale}
          closed={open}
          onOpenChange={(next) => next && setOpen(false)}
        />
        <button
          type="button"
          className="project-more-button"
          aria-label={translate("project.moreActions")}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((value) => !value)}
        >
          <HiOutlineEllipsisHorizontal aria-hidden />
        </button>
      </div>

      {open && (
        <div className="project-overflow-menu" role="menu">
          <button type="button" role="menuitem" className="project-menu-item" onClick={copyPath}>
            <HiOutlineClipboardDocument aria-hidden />
            {translate("project.copyPath")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="project-menu-item"
            onClick={rescan}
            disabled={rescanning}
          >
            <HiOutlineArrowPath aria-hidden className={rescanning ? "is-spinning" : undefined} />
            {translate(rescanning ? "project.rescanning" : "project.rescan")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="project-menu-item"
            onClick={() => {
              setOpen(false);
              setConfigureSignal((value) => value + 1);
            }}
          >
            <HiOutlineBolt aria-hidden />
            {translate("openAll.configure")}
          </button>

          {notice && (
            <p className={`project-menu-notice project-menu-notice--${noticeTone}`} role="status">
              {noticeTone === "ok" ? (
                <HiOutlineCheck aria-hidden />
              ) : (
                <HiOutlineExclamationCircle aria-hidden />
              )}
              {notice}
            </p>
          )}

          <div className="project-menu-divider" />
          <ProjectActions
            projectId={projectId}
            name={projectName}
            hidden={hidden}
            redirectTo="/"
            appearance="menu"
          />
        </div>
      )}
    </div>
  );
}
