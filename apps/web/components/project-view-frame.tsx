import type { ReactNode } from "react";

/*
  Each view of the tab goes on a plate, not on a card.
  The name of the section sits on the top edge, like the label of an instrument: you read where
  you are before entering the content. The box is the container; what is inside is not framed
  again.
 */

export function ProjectViewFrame({
  view,
  title,
  children,
}: {
  view: string;
  title: string;
  children: ReactNode;
}) {
  const headingId = `view-${view}`;
  return (
    <section
      className="project-view project-view-frame"
      data-view={view}
      aria-labelledby={headingId}
    >
      <header className="project-view-frame__plate">
        <p className="project-view-frame__name" id={headingId}>
          {title}
        </p>
      </header>
      <div className="project-view-frame__body">{children}</div>
    </section>
  );
}
