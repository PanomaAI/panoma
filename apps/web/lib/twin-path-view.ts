import type { MessageKey } from "./i18n";

/**
 * The four links of the chain and where each one stands, resolved outside the component.
 *
 * It is four conditions, and every one of them is about a state a fresh catalog is actually in —
 * no history granted, nothing believed, an empty file, no agent reading it. Left inside the page
 * it would be code with nobody to defend it: `vitest` does not transform `.tsx`, so a rule written
 * in a component is a rule no test can reach. The rendering stays in `twin-path.tsx`; the
 * arithmetic is here, where the empty case can be asserted without a server.
 *
 * See `docs/twin.md`, «The order of the screen, which is the order of the chain».
 */

/** What each stage needs to know about the catalog, already counted by the page. */
export interface PathFacts {
  /** The histories on this disk that a permission could be given for, and how many were. */
  histories: { grantable: number; allowed: number };
  /** Beliefs alive plus decisions recorded: everything the person and the machine have put in. */
  thoughts: number;
  /** What the portrait would take in `TASTE.md`, against the hard cap. */
  file: { chars: number; cap: number };
  /** Projects whose `AGENTS.md` carries the portrait, out of those that could. */
  reach: { reached: number; projects: number };
}

/** One cell: the name, the figure, whether it has anything in it, and where it is worked on. */
export interface PathStage {
  key: MessageKey;
  noteKey: MessageKey;
  figure: string;
  href?: string;
  reached: boolean;
  alarming?: boolean;
}

/** `3 / 8`, with the spaces, so a figure never reads as a date or a fraction. */
const of = (part: number, whole: number) => `${part} / ${whole}`;

export function pathStages(facts: PathFacts): PathStage[] {
  return [
    {
      key: "twinPath.history",
      noteKey: "twinPath.historyNote",
      figure: of(facts.histories.allowed, facts.histories.grantable),
      href: "#history",
      reached: facts.histories.allowed > 0,
    },
    {
      key: "twinPath.mind",
      noteKey: "twinPath.mindNote",
      figure: String(facts.thoughts),
      href: "#portrait",
      reached: facts.thoughts > 0,
    },
    {
      key: "twinPath.file",
      noteKey: "twinPath.fileNote",
      figure: of(facts.file.chars, facts.file.cap),
      href: "#file",
      reached: facts.file.chars > 0,
    },
    {
      key: "twinPath.agents",
      noteKey: "twinPath.agentsNote",
      figure: of(facts.reach.reached, facts.reach.projects),
      /*
        Only where the section exists. `Reach` draws nothing on a catalog with no scanned project,
        because «reaches 0 of 0» reports a failure that has not had its chance to happen — and a
        cell linking into an element that is sometimes absent is a link that goes nowhere.
       */
      ...(facts.reach.projects > 0 ? { href: "#reach" } : {}),
      reached: facts.reach.reached > 0,
      /*
        The one that shouts when it is empty. The other three measure Twin from the inside and can
        all look healthy while no agent reads a word of it, which is the state this catalog was in:
        the `AGENTS.md` block only exists where the person opened it. A zero here is the news.
       */
      alarming: true,
    },
  ];
}
