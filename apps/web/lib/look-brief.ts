import { join } from "node:path";
import { SHOTS_DIR, neutralizeInline } from "@panoma/core";
import type { StoredFinding } from "@panoma/db";
import { closingLine } from "@/lib/assignments";
import type { Locale } from "@/lib/i18n";

/*
  From a find to a task that an agent can take.
  It was the missing step and the most noticeable one: the critic drafted the following order
  —"unify the edge of the three cards"— and that was it. It had to be copied by hand and pasted
  into an agent, which meant that the turn that this organ exists to remove still had a manual
  step inside, and on top of that, the last one.
  What comes out of here is the text of a task from the catalog, which is an existing channel and
  reaches two places without inventing anything: any agent connected through MCP reads the tasks
  of their project with `panoma_tasks` and can take them, and from the record you can open a
  terminal with the agent already working on it.
  ── The text is processed, because it was written by a model looking at an image ─────────────
  A finding is not text from the house: it is written by a model looking at a capture that can
  contain anything, including a sign that says 'ignore previous instructions.' While the finding
  was only displayed on a screen, the worst outcome was a strange sentence; as soon as it becomes
  **the order received by an agent with tools**, the bar is raised. That is why everything that
  comes from the model goes through `neutralizeInline` —a line, trimmed— just like the summary of
  someone else's project in `assignments.ts`, and that is why the assignment states aloud what it
  is about and that nothing else should be done.
  ── It also says that the capture may be old ──────────────────────────────────────────
  The last line is not a courtesy formula. Between the glance and the commission, a week may have
  passed, and the arrangement may be done: an agent who does not find what the finding describes
  must be able to say it and stop, instead of searching until finding something to change. It is
  the same rule the critic applies to itself when it remains silent before a cropped
  capture.
 */

/** What is saved as homework: a title that is read on a list and the entire message. */
export interface Brief {
  title: string;
  body: string;
}

/**
 * What fits from an order in the title of a task.
 *
 * The `fix` can hold up to 220 characters —`MAX_FINDING_CHARS`— and that in a list of tasks takes
 * up three lines and covers the others. One hundred is what fits at a glance, and the body carries
 * the entire order two lines below, so nothing is lost here.
 */
const TITLE_CHARS = 100;

/** Which project is the screen from. The minimum to place the agent. */
export interface BriefProject {
  name: string;
  root: string;
}

/**
 * The commission that comes from a discovery.
 *
 * Bilingual inside and not by the dictionary, just like `buildAssignment`: it is a text followed
 * by twenty lines, and splitting it into twenty keys would make it impossible to read in full
 * —which is exactly what you have to be able to do before giving it to an agent.
 */
export function briefFromFinding(
  input: {
    project: BriefProject;
    finding: StoredFinding;
    /** The mailbox file, when the capture came out of a mailbox. */
    shot?: string | undefined;
    at: Date;
  },
  locale: Locale,
): Brief {
  const es = locale === "es";
  const { finding } = input;

  const what = neutralizeInline(finding.what, 220);
  const where = neutralizeInline(finding.where, 220);
  const fix = neutralizeInline(finding.fix, 220);
  const cites = finding.cites.map((cite) => neutralizeInline(cite, 220));

  const name = neutralizeInline(input.project.name, 80);
  const root = neutralizeInline(input.project.root, 200);
  const when = input.at.toISOString().slice(0, 10);

  const lines: string[] = [];
  lines.push(
    es
      ? `Encargo de panoma sobre «${name}» (${root}).`
      : `Assignment from panoma about “${name}” (${root}).`,
  );
  lines.push("");

  /*
    Where it comes from, with the capture route when there is one. It is the first thing needed by
    whoever takes it: without the image in front, 'the card on the right' points to nothing.
   */
  if (input.shot) {
    /*
      With `join` and not adding a slash: `SHOTS_DIR` it already comes assembled with the system
      separator, so the slash here produced `.panoma\shots/panel.png` on Windows — half native
      path and half POSIX, which belongs to no one. This is text for an agent that is going to
      open the file on that same machine, so the path has to be the one that exists there. The
      name is neutralized before being joined: `join` normalizes, and what is normalized has to
      already be harmless.
     */
    const path = join(SHOTS_DIR, neutralizeInline(input.shot, 120));
    lines.push(
      es
        ? `Sale de una mirada del crítico a una captura del ${when}. Está en \`${path}\`: ábrela antes de tocar nada.`
        : `It comes from a critic look at a screenshot from ${when}. It is at \`${path}\`: open it before touching anything.`,
    );
  } else {
    lines.push(
      es
        ? `Sale de una mirada del crítico a una pantalla, del ${when}.`
        : `It comes from a critic look at a screen, from ${when}.`,
    );
  }
  lines.push("");

  lines.push(es ? `Qué está mal: ${what}` : `What is wrong: ${what}`);
  lines.push(es ? `Dónde se ve: ${where}` : `Where it shows: ${where}`);
  lines.push("");

  /*
    And the sentences it breaks, which are the half that makes this a defensible assignment.
    Without them, what reaches the agent is a model's opinion on a screen; with them, it is a rule
    that the person in charge had already written and signed.
   */
  if (cites.length > 0) {
    lines.push(
      es
        ? "Lo que incumple, con las palabras de quien lo pidió:"
        : "What it breaks, in the words of whoever asked for it:",
    );
    for (const cite of cites) lines.push(`- ${cite}`);
    lines.push("");
  }

  lines.push(es ? `El encargo: ${fix}` : `The assignment: ${fix}`);
  lines.push("");
  lines.push(
    es
      ? "Arregla eso y nada más. Si al abrir la captura no ves lo que dice el hallazgo, dilo y para: puede que ya esté arreglado, y la captura es de ese día y no de hoy."
      : "Fix that and nothing else. If, once you open the screenshot, you cannot see what the finding describes, say so and stop: it may already be fixed, and the screenshot is from that day, not today.",
  );
  /*
    Just like in `critique-brief`: this order always has a queue, and without requesting the
    closure, no one would close the queue.
   */
  lines.push("");
  lines.push(closingLine(locale, es ? "diciendo qué cambiaste" : "stating what you changed"));

  return { title: title(fix), body: lines.join("\n") };
}

/** The order, shortened to what is read in a list. See `TITLE_CHARS`. */
function title(fix: string): string {
  return fix.length > TITLE_CHARS ? `${fix.slice(0, TITLE_CHARS - 1).trimEnd()}…` : fix;
}
