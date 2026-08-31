import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * No inflected word attached to a number.
 *
 * "1 commits." "1 month ago." "1 folders without version control." "1 signals detected." It's the
 * same bug nine times, in two dictionaries and over four years of commits, and it doesn't get
 * fixed by looking: you only see it when the number is one, which is exactly the case for someone
 * who just installed this and has a project. With eighty on the disk it never appears.
 *
 * The house rule is "the number at the end": either the sentence is arranged so that the figure
 * closes, or the text provides both forms. For the second option, there is a gap —`{s}`, `{es}`,
 * `{y}` — which is filled with `plural(n)` from which it is known what n is worth. This file
 * checks that it is used.
 *
 * What is NOT checked, and it must be said: that whoever calls passes the gap with the correct
 * number. That cannot be read without executing. What this does prevent is what really happened —
 * writing "{n} projects" and not remembering that the other form exists.
 *
 * And a second blind spot, found on 31-Aug-2026 and left open on purpose. `GLUED` recognises a
 * count by the **name of its gap**, from the closed list below. A sentence whose gap is named for
 * what it counts — `{technologies}`, `{families}`, `{packages}` — is invisible to it, and that is
 * how «Catalog updated: 3 projects, 1 technologies, 0 packages, 1 families» reached the first
 * line a new user reads: the tenth return of the same bug, through the door this file leaves open.
 *
 * Widening it was measured rather than guessed. Accepting any gap at all lights up 88 sentences,
 * of which most are not counts —`{size} of repeated code`, `{path} belongs to the system`— and
 * would need some forty exemptions, which is theatre. Restricting it to gaps whose own name is a
 * plural noun lights up fifteen, and those are real. Three were fixed the day this was written,
 * all in the CLI. The rest wait because several are Spanish with agreement across the phrase —«1
 * dependencias directas atrasadas» needs three forms, not one suffix— and the exemption list below
 * already says that such cases deserve their own pair of keys. That is a copy pass, not a line.
 *
 * One warning for whoever does it: `scan.noRemote.n` looks broken and is not. It has a twin,
 * `scan.noRemote`, chosen by `commits === 1`, which is the other way of following the rule. Check
 * the call site before writing the gap.
 *
 * And the warning in the other direction, paid for on 31-Aug-2026: an exemption is a claim about
 * the code, and a claim can be false. `card.copies` sat here saying that a group of one copy is
 * never formed, so the guard never looked at it. `findDuplicateFamilies` discards a group with
 * fewer than two **members**, and the copies are the members minus the canonical one: every
 * duplicated pair makes a family with exactly one copy, and the card had been printing «(1
 * copies)» all along, under this file's protection. Read the code an exemption describes before
 * you trust it, and again before you write a new one.
 */
const REPO = new URL("../../../", import.meta.url);

const DICTS = [
  { name: "apps/cli/src/messages.ts", source: readFileSync(new URL("apps/cli/src/messages.ts", REPO), "utf8") },
  { name: "apps/web/lib/i18n.ts", source: readFileSync(new URL("apps/web/lib/i18n.ts", REPO), "utf8") },
];

/** The gaps that bring a figure. */
const COUNT = /\{(?:n|m|count|days|months|years|files|signals|skipped|checked|total)\}/;

/** And those who accompany it with the correct form of the word. */
const SHAPE = /\{(?:s|es|y|ps|fs|ms|ies)\}/;

/**
 * A word inflected right after a number: «{n} projects», «{n} projects».
 *
 * It is requested that the word have at least four letters so as not to mark «{n} % more» or the
 * units («{n} MB»), which are not inflected.
 */
const GLUED = /\{(?:n|m|count|days|months|years|files|total)\}\s+[a-záéíóúñ]{4,}(?:s|es)\b/i;

/**
 * Exempt, with the reason written. Each line here costs more than fixing the sentence, which is
 * exactly what is sought: the cheap output has to be the correct one.
 */
const EXEMPT: Record<string, string> = {
  "open.several":
    "Printed only inside `if (candidates.length > 1)`, in check-command.ts. With a single matching project it opens straight away and this sentence does not exist.",
  "next.whyIdleMany":
    "The plural half of a pair declared in next-command.ts: `idle: [\"next.whyIdle\", \"next.whyIdleMany\"]`. The singular is the other key, which is the other way of following the rule.",
  "next.whyCritiquesMany":
    "The same pair as the one above: `critiques: [\"next.whyCritiques\", \"next.whyCritiquesMany\"]`.",
  "next.whyLongIdle":
    "«long-idle» is a different category from «idle» and starts well above one month: the sentence is never produced with a single month.",

  /* Figures that are never worth one because they are limits, not accounts. */
  "tasks.tooLong":
    "The figure is `MAX_TITLE`, the sentence's own ceiling: 160 today. It is never one, and the day it were, the plural would not be the problem.",
  "north.tooLong":
    "The same: the sentence is printed only once the text has already passed the maximum, so the figure is always far above one.",
  "verdicts.tooMany":
    "It appears only when more reactions arrive than fit at once, so the figure is above the quota, which is never one.",
  "project.mdCost":
    "These are context tokens for a whole instructions file: hundreds or thousands. An AGENTS.md of one token does not exist.",

  /*
    And those that could indeed be worth one, but whose singular in Spanish is not the same word
    with one letter less. “carácter” loses the accent when pluralized and “afirmación” does too:
    the gap doesn’t know how to do that, and pretending it does would be worse than leaving it
    written here. They get their own key, which is the other way to follow the rule — work pending
    and accounted for, not a mistake.
   */
  "patch.output": "«{n} caracteres» with one would be «1 carácter», which moves its accent. It needs its own pair of keys.",
  "twin.fileRoom": "The same case as the one above: «carácter» / «caracteres» is not settled by a suffix.",
  "project.mdFindings":
    "«{n} afirmaciones que ya no son verdad»: «afirmación» loses its accent in the plural and the verb agrees as well. It needs its own pair of keys.",
  "project.assetsStats":
    "Three figures in the one sentence, each with its own word behind it. Rewriting it means redoing the sentence, not adding a gap.",
};

/**
 * The other way to follow the rule: two keys, one per shape.
 *
 * The house agreement is `XOne` / `XMany`, and whoever renders chooses. A `Many` key with its `One`
 * next to it is fine and is not marked — but **only** for the figure that prompted the pair: if
 * the sentence contains a second number, that second one remains unmatched. That's what happens in
 * `today.inProjectsMany`, where the `Many` talks about the commits and the projects go separately.
 *
 * `X` / `X.n` is not a pair of those. `risk.no-commits` says "repository with no commits" and
 * `risk.no-commits.n` says "{n} files and no commits": the second is the *with number* variant,
 * not the plural, and with one file it still says "1 files".
 */
function hasSingularSibling(key: string, source: string): boolean {
  if (!key.endsWith("Many")) return false;
  return source.includes(`"${key.slice(0, -4)}One"`);
}

describe("el número y la palabra que va detrás", () => {
  for (const dict of DICTS) {
    it(`${dict.name} no flexiona ninguna palabra pegada a una cifra`, () => {
      const culpables: string[] = [];
      for (const m of dict.source.matchAll(/"([\w.-]+)":\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)) {
        const key = m[1]!;
        const text = m[2]!;
        if (EXEMPT[key]) continue;
        if (!COUNT.test(text)) continue;
        if (SHAPE.test(text)) continue;
        if (hasSingularSibling(key, dict.source)) continue;
        if (GLUED.test(text)) culpables.push(`${key}: "${text}"`);
      }
      expect(
        culpables,
        `«1 commits» otra vez. O la cifra cierra la frase, o el texto trae las dos formas:\n${culpables.join("\n")}`,
      ).toEqual([]);
    });
  }

  it("y las exentas siguen existiendo, con su motivo", () => {
    const all = DICTS.map((d) => d.source).join("\n");
    for (const [key, reason] of Object.entries(EXEMPT)) {
      expect(all.includes(`"${key}"`), `${key} está exenta y ya no existe`).toBe(true);
      expect(reason.length, `${key} está exenta sin un motivo de verdad`).toBeGreaterThan(70);
    }
  });
});
