/*
  The portrait budget: what fits in TASTE.md and what has been left out.
  `TASTE.md` is limited to 3,000 characters and **fails when it is filled** instead of silently
  truncating, which is a good and deliberate decision —every character is paid for in tokens in
  each session of each agent, and a file that is pruned would just end up discarding the phrase
  you cared about the most without telling you—. What was missing was the other half: showing the
  limit **before** hitting it.
  Measured in the author's catalog when this was written: 27 publishable sentences in the
  database, 14 in the file, **13 that didn’t reach any agent**. And the screen displayed them all
  together under 'what represents you', without distinguishing which ones are read and which ones
  are not. The error message said 'your decision was saved, but something has to come out' and
  there was no way to know what was inside, how much each sentence cost, or what to take out.
  ── Why is the cost calculated here and not imported from the engine ────────────────────────
  Because the one who needs it is the dial screen, which is a client component: what needs to be
  projected is 'how much space the portrait would take **if** I save these marks,' and only the
  browser knows that while dialing. Importing `@panoma/core` there would drag `node:fs`.
  So the arithmetic is written twice —here and in `digest()` of the engine— and the test next to
  it compares the two over the same sentences. It’s the same deal as `TOPICS` in `lib/distill.ts`:
  duplicating the data is acceptable as long as there is something that screams when they
  disagree, and without that something it wouldn’t be.
 */

/** The subjects sown, in the order in which the engine writes them. See `TASTE_TOPICS`. */
export const TOPICS = [
  "design",
  "frontend",
  "backend",
  "cli",
  "testing",
  "copy",
  "workflow",
  "tooling",
  "data",
  "other",
] as const;

/**
 * The subjects of a portrait, in the order in which they are written: those sown in their order
 * and then the coined ones, alphabetical. It is `topicsOf` of the engine, written again.
 *
 * The duplication is the same as always in this file and under the same condition: the neighboring
 * test compares this arithmetic with that of `digest()` over the same phrases, so if one day they
 * disagree there is something that screams. Without that something, duplicating would not be
 * worthwhile.
 */
function topicsOf(lines: Sized[]): string[] {
  const present = new Set(lines.map((line) => line.topic));
  const seeded = (TOPICS as readonly string[]).filter((topic) => present.has(topic));
  const minted = [...present].filter((topic) => !(TOPICS as readonly string[]).includes(topic));
  return [...seeded, ...minted.sort()];
}

/** The minimum that is needed from a sentence to know what it occupies. */
export interface Sized {
  topic: string;
  statement: string;
  /** The project to which it is limited. Absent is 'in everything you do.' */
  scope?: string;
}

/**
 * What a set of sentences occupies within the portrait.
 *
 * Exact replica of `digest(lines, Infinity)`: one row per section with the phrases joined by
 * ` · `, and the break that separates each row from the previous one counted once. A section that
 * is not in the sown list is written the same, behind and in order — see `topicsOf`.
 */
export function charsOf(lines: Sized[], project?: string): number {
  const rows: string[] = [];

  for (const topic of topicsOf(lines)) {
    let row = "";
    for (const line of lines) {
      if (line.topic !== topic) continue;
      // The global always; from the limited, only what's in this project. Just like in `digest`.
      if (project !== undefined && line.scope !== undefined && line.scope !== project) continue;
      /*
        The same thing that `oneLine` does in the engine, and that's why the `<!--`: if it is not
        neutralized here, a belief with a comment inside is measured with two characters less than
        what the file ends up writing. They are two digits for the same thing, which is the error
        that this duplication is forbidden to commit.
       */
      const statement = line.statement
        .replace(/\s+/g, " ")
        .replaceAll("<!--", "<! --")
        .replaceAll("-->", "-- >")
        .trim();
      if (statement === "") continue;
      row = row === "" ? `- Taste (${topic}): ${statement}` : `${row} · ${statement}`;
    }
    if (row !== "") rows.push(row);
  }

  return rows.join("\n").length;
}

/**
 * What the agent would read with more text in front: the global one plus the project that has the
 * most.
 *
 * It is **the number against which the limit applies**, and confusing it with the global block
 * caused a real error: the marking bar only projected the global, so it said «2,990, fits» while
 * what was going to be written was 3,533 and the save was refused. A projection that does not
 * project the same thing that is checked is worse than none, because people rely on it.
 *
 * Replica of `worstBlock` in the engine, and tested against it in the adjacent file for the same
 * reason as `charsOf`: the one who needs it is a client component.
 */
export function worstBlockOf(lines: Sized[]): number {
  return heaviest(lines).chars;
}

/**
 * The worst block, **distributed**: how much comes from the global and how much from the project
 * that adds the most on top.
 *
 * The distribution and not just the name, and the difference was shown by a test. The block of a
 * project is the global **plus** its own, so it always weighs the same or more than the global: if
 * there is a single limited phrase, the 'heavier' one is its project by construction. Naming it
 * plainly would lead to removing things from that project when what is bulky can be the shared
 * part.
 *
 * With the distribution in front, the decision is the one that has to be made: if the global
 * factor rules, you have to produce something that everyone reads; if the project part rules,
 * limiting less there is enough. Measured live: limiting three consecutive sentences moved the
 * total from 3,228 to 3,195, because they were going to a project that was already the most loaded
 * — without the distribution, that seems like a broken button.
 */
export interface Heaviest {
  chars: number;
  /** It occupies what it is worth everywhere. It is always inside `chars`. */
  global: number;
  /** The project that adds the most on top of the global, if there is any that is limited. */
  project?: string;
  /** What that project adds: `chars - global`. Zero when there are no dimensions. */
  own: number;
}

export function heaviest(lines: Sized[]): Heaviest {
  const global = charsOf(lines, GLOBAL_ONLY);
  const projects = new Set<string>();
  for (const line of lines) if (line.scope !== undefined) projects.add(line.scope);

  let worst: Heaviest = { chars: global, global, own: 0 };
  for (const project of projects) {
    const chars = charsOf(lines, project);
    if (chars > worst.chars) worst = { chars, global, project, own: chars - global };
  }
  return worst;
}

/** The 'project' for which only the global is requested. See `GLOBAL_ONLY` in the engine. */
const GLOBAL_ONLY = "\u0000";

export interface Budget {
  /** Which would occupy everything that is published. */
  chars: number;
  cap: number;
  /** What the file takes up right now. */
  written: number;
  /** Publishable beliefs that are not in the file, by `id`. */
  unpublished: Set<string>;
}

/**
 * The budget of the portrait: what it would take, what it takes, and what never got written.
 *
 * The two numbers split right when it matters. `TASTE.md` **fails to fill in** instead of trimming
 * silently, so the database can have beliefs that no agent has ever read: here there were 27
 * publishable and 14 written. The screen rendered them all together under 'what represents you,'
 * which is the kind of lie this product cannot afford on the only screen where something is
 * directed.
 *
 * It is paired by what the sentence says and not by its `id`, because the file does not store IDs:
 * what is on the disk is a subject and a sentence, and that is all the identity that a line
 * someone may have written by hand has.
 */
export function budgetOf(
  published: (Sized & { id: string })[],
  file: { lines: Sized[]; chars: number; cap: number },
): Budget {
  const written = new Set(file.lines.map((line) => key(line)));
  const unpublished = new Set<string>();
  for (const one of published) {
    if (!written.has(key(one))) unpublished.add(one.id);
  }

  return {
    chars: worstBlockOf(published),
    cap: file.cap,
    written: file.chars,
    unpublished,
  };
}

/**
 * The same normalization that `oneLine` does when writing, and for the same reason as in
 * `charsOf`.
 *
 * Without the `<!--`, a belief with a comment inside did not match its own already written line
 * and was counted as 'does not reach your agents' when written word for word.
 */
function key(line: Sized): string {
  const dicho = line.statement
    .replace(/\s+/g, " ")
    .replaceAll("<!--", "<! --")
    .replaceAll("-->", "-- >")
    .trim();
  return `${line.topic} ${dicho}`;
}
