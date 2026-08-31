"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  HiOutlineArrowPath,
  HiOutlineCheck,
  HiOutlineClipboardDocument,
  HiOutlineEllipsisHorizontal,
  HiOutlineExclamationCircle,
} from "react-icons/hi2";
import { OpenMenu } from "./open-menu";
import { ProjectActions } from "./project-actions";
import { useLocale, useT } from "./i18n-provider";
import { useDismissable } from "./use-dismissable";

export function ProjectActionBar({
  projectId,
  projectName,
  path,
  hidden,
}: {
  projectId: string;
  projectName: string;
  path: string;
  hidden: boolean;
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
           A split button instead of three generic verbs.
           The tab offered 'open in editor,' 'open terminal,' and 'open folder' while the catalog
           panel already listed the programs by their name — two screens of the same project
           responding differently to 'open it for me.' Here are the same nine destinations, in the
           same order, behind the arrow.
          */}
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
