/**
 * The sections of a project page, and how they are read from the anchor.
 *
 * Each view's `id` is not a URL: it is the mark the stylesheet uses to show one and hide the
 * rest (`[data-view="…"]` in `globals.css`). It is still Spanish because renaming it means
 * touching that stylesheet, and nothing outside sees it. It is one of the four documented
 * exceptions in [open-questions.md](../../../docs/open-questions.md). What *is* seen — the
 * anchor — is English.
 *
 * In a file of its own and without JSX for a concrete reason: this list is half of a contract
 * the other half — the frames in `p/[slug]/page.tsx` — has to honour, and a tab that renders
 * with no frame behind it leaves the column blank. Checking that requires importing the list
 * from a test, and this app's tests neither mount React nor transform `.tsx`: on purpose, not
 * for lack of trying. See `project-views.test.ts`.
 */

import type { MessageKey } from "@/lib/i18n";

/*
  The anchor that ends up in the browser bar goes **first**, and it is English.

  A URL is an identifier, not prose, and the house rule — identifiers in English — holds for
  `/p/x#assignments` exactly as it does for a file name. And this is read outside the app: it
  gets pasted into a chat, saved as a bookmark, printed in the documentation. The whole page
  read in English with a Spanish URL underneath it.

  The old ones stay as aliases and are not going anywhere: a link saved three months ago has to
  keep opening its section, and `viewFromHash` looks at the whole list. The menu always emits
  the first one, which is what reaches the bar.
*/
export const PROJECT_VIEWS = [
  { id: "all", hashes: ["", "all"], label: "project.navAll" as MessageKey },
  { id: "resumen", hashes: ["summary", "resumen"], label: "project.navSummary" as MessageKey },
  { id: "actividad", hashes: ["activity", "actividad"], label: "project.navChanges" as MessageKey },
  { id: "retomar", hashes: ["resume", "retomar"], label: "project.navResume" as MessageKey },
  { id: "cuentas", hashes: ["accounts", "cuentas"], label: "project.navAccounts" as MessageKey },
  { id: "encargos", hashes: ["assignments", "encargos"], label: "project.navAssignments" as MessageKey },
  { id: "md", hashes: ["md"], label: "project.navMd" as MessageKey },
  {
    id: "dependencias",
    hashes: ["dependencies", "dependencias", "security", "seguridad"],
    label: "project.navDeps" as MessageKey,
  },
  {
    id: "agentes",
    hashes: ["agents", "agentes", "log", "bitacora"],
    label: "project.navAgents" as MessageKey,
  },
  {
    id: "detalles",
    hashes: ["details", "detalles", "stack", "tecnologias"],
    label: "project.navDetails" as MessageKey,
  },
];

export type ProjectViewId = (typeof PROJECT_VIEWS)[number]["id"];

export function viewFromHash(hash: string): ProjectViewId {
  const id = hash.replace(/^#/, "");
  /* The unsaved-work band lives inside the summary and has an anchor of its own, so it is not
     a view: it maps to the one that holds it. Both spellings, today's and the old one. */
  if (id === "unsaved" || id === "respaldo") return "resumen";
  for (const view of PROJECT_VIEWS) {
    if ((view.hashes as readonly string[]).includes(id)) return view.id;
  }
  return "all";
}
