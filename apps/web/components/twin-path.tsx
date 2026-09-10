import Link from "next/link";
import { t, type Locale } from "@/lib/i18n";
import type { PathStage } from "@/lib/twin-path-view";

/**
 * The chain, said once, with the state of each link in it.
 *
 * This screen used to open on four bare figures — signed, standing, published, episodes — under a
 * title and a paragraph. On a Twin nobody has trained yet that is «0 0 0 0» with three-word labels
 * and no sentence saying whether that is broken or simply new, and it was the first thing anyone
 * met. Underneath it came eleven panels of equal weight in an order that inverted the one the
 * product actually runs in: the permission that has to come first sat three thousand pixels down,
 * below three forms that cannot do anything until it is given.
 *
 * So the header states the pipeline instead of counting its output. `docs/twin.md` opens with that
 * pyramid — history, what you think, the file, the agents that read it — and the person had no way
 * to see it from the screen. Four cells, in the order the work happens, each one carrying the
 * figure that says where it stands and a link to the section that moves it.
 *
 * ── Why the same strip serves the newcomer and the veteran ────────────────────────────────
 *
 * Because it is a readout and not a checklist. A tour that congratulates you for finishing it has
 * to be dismissed and then it is gone; these four figures are worth reading on the four hundredth
 * visit, because they are the four numbers that decide whether any of this is working. Empty, the
 * same cells read as the path — which is the only state a first visit has.
 *
 * ── Why «reaches nobody» is the loud one ──────────────────────────────────────────────────
 *
 * The other three measure Twin from the inside and can all look healthy in a catalog where the
 * portrait reaches no agent at all: the `AGENTS.md` block only exists where the person opened it.
 * `tasteReach`'s own record says a zero there is the news and not a gap, and the terminal already
 * says it in amber. Here it is the one cell that changes colour.
 */

export function TwinPath({ stages, locale }: { stages: readonly PathStage[]; locale: Locale }) {
  return (
    <section aria-labelledby="twin-path-title" className="page-shell__section">
      <h2 id="twin-path-title" className="eyebrow page-shell__section-title">
        {t(locale, "twinPath.title")}
      </h2>
      {/*
         The sentence the screen never said. Everything below is one of these four words, and
         without the sentence the reader has to infer the chain from eleven panels that never
         mention each other.
        */}
      <p className="max-w-3xl text-sm leading-relaxed text-smoke">{t(locale, "twinPath.lead")}</p>

      {/*
         Two across on a phone and not one. Stacked, the four cells ran 668px — nearly two screens
         of orientation before the first thing anybody can press, which turns the map into an
         obstacle. Each cell is a label, a figure and a short line, so half a 375px screen holds
         one comfortably.
        */}
      <ol role="list" className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stages.map((stage, index) => {
          const body = (
            <>
              <span className="flex items-baseline gap-2">
                {/*
                   The step number is drawn and not announced: the list is already ordered, so a
                   screen reader counts it once and does not need to hear «01» twice.
                  */}
                <span aria-hidden className="font-mono text-[11px] text-faint">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="text-sm font-semibold">{t(locale, stage.key)}</span>
              </span>
              {/*
                 A link of the chain with nothing in it is drawn quieter but not fainter: the
                 figure is the content of this cell, and `--color-faint` is 2.58:1, one of the five
                 inks the owner keeps below AA for chrome. `--color-smoke` is the step that was
                 taken to 4.54:1 for exactly this, and it still reads as the quiet one beside ink.
                */}
              <span
                className={`mt-3 font-display text-2xl font-semibold tabular-nums tracking-tight ${
                  stage.reached ? "" : "text-smoke"
                }`}
              >
                {stage.figure}
              </span>
              <span className="mt-1 text-xs leading-relaxed text-smoke">{t(locale, stage.noteKey)}</span>
            </>
          );
          const alarmed = stage.alarming && !stage.reached;
          const box = `flex flex-col rounded-lg border p-4 ${
            alarmed ? "border-warn/40 bg-warn/[0.04]" : "border-edge bg-surface"
          }`;
          /*
            `display: contents` lets the cell itself be the grid item rather than a box around it —
            and it also drops the row's listitem role, which is why the role is written back by
            hand. The same is true of the `grid` on the list above.
           */
          return (
            <li key={stage.key} role="listitem" className="contents">
              {stage.href ? (
                <Link
                  href={stage.href}
                  className={`${box} transition-colors ${alarmed ? "hover:border-warn" : "hover:border-chalk"}`}
                >
                  {body}
                </Link>
              ) : (
                /* No destination, so no affordance: the figure still reads, it just does not lie
                   about being a link. */
                <div className={box}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
