import Link from "next/link";
import { HiOutlineCommandLine } from "react-icons/hi2";
import { t, type Locale } from "@/lib/i18n";
import { relativeDate } from "./primitives";

/**
 * What an agent left done and cannot apply alone.
 *
 * A proposal in the 'proposed' state is finished work waiting for a human decision: the change is
 * tested in a separate worktree and on a branch, and it stays there forever if no one looks at it.
 * It lived at the end of the record, inside 'Agent activity,' behind dependencies, security, and
 * the entire stack — that is, in the place one looks when they have already decided what they were
 * going to do. The person covering a night shift cannot find out by going all the way down.
 *
 * That is why it is a stripe and not just another card: the token already has a 'protect your
 * work' stripe and the pattern is understood—a wide line that interrupts the reading, indicating
 * what needs to be done on the right. This is its violet sister, which is the color of what Panoma
 * does and not of what is wrong: here nothing is broken, there is something to decide.
 *
 * It returns `null` when there is none, so that the card can mount it without asking and the page
 * does not load with the vocabulary of execution states.
 */

export interface ProposalRun {
  id: string;
  status: string;
  target: unknown;
  verified: boolean;
  createdAt: Date;
}

/*
  Three fit in the strip without it becoming unreadable at a glance. With more, the strip turns
  into the list that already exists in /runs, so from there it links there instead of growing.
 */
const VISIBLE = 3;

export function ProposalsStrip({ runs, locale }: { runs: ProposalRun[]; locale: Locale }) {
  const waiting = runs.filter((run) => run.status === "proposed");
  if (waiting.length === 0) return null;

  return (
    <section
      id="propuestas"
      aria-labelledby="proposals-title"
      className="project-proposals-strip mt-5 grid scroll-mt-[106px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-[19px] py-[17px] max-md:grid-cols-[auto_minmax(0,1fr)]"
    >
      <HiOutlineCommandLine className="h-[26px] w-[26px]" aria-hidden />
      <div>
        <p className="project-question project-question--violet">{t(locale, "proposals.waiting")}</p>
        {/*
           The same body and the same weight as the h2 of the backup stripe: they are the same
           kind of notice and have to weigh the same on the page.
          */}
        <h2 id="proposals-title" className="mt-[3px] text-[0.9rem] [font-weight:690]">
          {t(locale, waiting.length === 1 ? "proposals.readyOne" : "proposals.readyMany", {
            n: waiting.length,
          })}
        </h2>
        <p className="mt-[3px] text-[0.7rem] text-smoke">{t(locale, "proposals.branchNote")}</p>
      </div>
      <div className="flex flex-wrap justify-end gap-2 max-md:col-span-full max-md:justify-start">
        {waiting.slice(0, VISIBLE).map((run) => {
          const target = run.target as { packageName?: string; targetVersion?: string };
          return (
            <Link
              key={run.id}
              href={`/runs/${run.id}`}
              className="project-proposals-strip__card flex flex-col items-end px-3 py-1.5 max-md:items-start"
            >
              <span className="font-mono text-[11px] text-chalk">
                {target.packageName ?? t(locale, "proposals.fallbackName")}
                {target.targetVersion ? ` → ${target.targetVersion}` : ""}
              </span>
              {/*
                 Literally the same key used by `RunStatusTag`, by the way: if the same fact were
                 said in two ways depending on the screen, you would have to learn both. And the
                 distinction is the product — a proposal without tests is not a proven proposal,
                 and deciding without knowing which of the two it is is not deciding.
                */}
              <span
                className={`font-mono text-[10px] ${run.verified ? "text-live" : "text-idle"}`}
              >
                {t(locale, run.verified ? "proposals.testsGreen" : "proposals.unverified")}
              </span>
              <span className="font-mono text-[10px] text-faint">
                {relativeDate(run.createdAt, locale)}
              </span>
            </Link>
          );
        })}
        {waiting.length > VISIBLE && (
          <Link
            href="/runs"
            className="project-proposals-strip__more self-center font-mono text-[11px]"
          >
            {t(locale, "proposals.andMore", { n: waiting.length - VISIBLE })}
          </Link>
        )}
      </div>
    </section>
  );
}
