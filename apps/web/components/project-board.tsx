"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useT } from "./i18n-provider";
import { PROJECT_VIEWS, viewFromHash, type ProjectViewId } from "./project-views";

export { PROJECT_VIEWS, viewFromHash, type ProjectViewId };

/*
  The menu of the tab not only jumps: it trims.
  By default, everything is visible. When a section is clicked, the rest is hidden and only that
  section remains, with the right column —attention, who built it, with what— always in view. The
  usual anchors still work: a link to `#md` opens that view, not a scroll to a buried block.
 */

function applyView(view: ProjectViewId) {
  document.querySelector(".project-detail-page")?.setAttribute("data-view", view);
}

export function ProjectBoard({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const translate = useT();
  const [view, setView] = useState<ProjectViewId>("all");

  useEffect(() => {
    const sync = () => {
      const next = viewFromHash(window.location.hash);
      setView(next);
      applyView(next);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return (
    <>
      <nav className="project-subnav" aria-label={translate("project.sections")}>
        {PROJECT_VIEWS.map((item) => {
          const href = item.id === "all" ? "#all" : `#${item.hashes[0]}`;
          const active = view === item.id;
          return (
            <a
              key={item.id}
              href={href}
              className={active ? "is-active" : undefined}
              aria-current={active ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                const base = window.location.pathname + window.location.search;
                if (item.id !== "all" && view === item.id) {
                  window.history.replaceState(null, "", base);
                  setView("all");
                  applyView("all");
                  return;
                }
                window.history.replaceState(null, "", item.id === "all" ? base : `${base}${href}`);
                setView(item.id);
                applyView(item.id);
              }}
            >
              {translate(item.label)}
            </a>
          );
        })}
      </nav>

      <div className="project-detail-layout" id="summary">
        <div className="project-primary-column">{children}</div>
        <aside className="project-secondary-column">{sidebar}</aside>
      </div>
    </>
  );
}
