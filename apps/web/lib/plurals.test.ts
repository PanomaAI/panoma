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
 * That second blind spot, found on 31-Aug-2026, is closed. `GLUED` used to recognise a count by
 * the **name of its gap**, from a closed list, so a sentence whose gap was named for what it
 * counts — `{technologies}`, `{families}`, `{packages}` — was invisible to it, and that is how
 * «Catalog updated: 3 projects, 1 technologies, 0 packages, 1 families» reached the first line a
 * new user reads: the tenth return of the same bug, through the door this file used to leave open.
 *
 * Widening it was measured rather than guessed. Accepting any gap at all lit up eighty-eight
 * sentences, of which most are not counts —`{cap} characters`, `{path} belongs to the system`,
 * `{ecosystem} dependencies`— and would have needed some forty exemptions, which is theatre.
 * Restricting it to gaps whose own name is a plural noun lit up fifteen, and those were real:
 * three were fixed in the CLI the day it was measured, and the remaining twelve, all in the web
 * dictionary, the day it was widened. Several of the twelve did need what this comment predicted,
 * a rewrite instead of a suffix, because Spanish agrees across the whole phrase: «las 1 cita
 * guardadas ya se han leído» moves the article, the participle and the verb, so `twin.corpusDone`
 * became the pair `…One` / `…Many`, and three stat lines put their figure at the end instead.
 *
 * One warning that outlived its own bug: `scan.noRemote.n` looks broken and is not. It has a twin,
 * `scan.noRemote`, chosen by `commits === 1`, which is the other way of following the rule. It is
 * in the exemption list below now, because the wider pattern does reach it. Check the call site
 * before writing the gap.
 *
 * And the third blind spot, measured on the same day and left open with its price written down.
 * `SHAPE` is asked of the **whole sentence**: one `{s}` anywhere and everything else in that
 * sentence is skipped, second figure included. That is what hides `twin.sourcesTotal` in the CLI
 * —«{n} source{s} on disk · {files} files»— which prints «1 source on disk · 1 files» for anyone
 * whose single agent history holds a single file. Asking `SHAPE` per figure instead of per
 * sentence is the right shape of the check; what it costs is that every sentence it uncovers is in
 * `apps/cli/src/messages.ts`, where the fix is not a suffix but a `plural(n)` at each call site —
 * the CLI does not derive shapes, the caller passes them. That is its own pass, and this note is
 * here so it is not rediscovered from scratch.
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

/**
 * The gaps that bring a figure.
 *
 * This is the door, and it has to open as wide as `GLUED` reaches. Widening only `GLUED` was tried
 * on 31-Aug-2026 and did nothing at all: a sentence is discarded here, before `GLUED` ever runs, so
 * `{families} familias` — the very shape the widening was for — was still skipped. Proven by
 * putting the old sentence back and watching the guard stay green.
 */
const COUNT = /\{(?:n|m|count|days|months|years|files|signals|skipped|checked|total|[a-z]{3,}(?:s|es|ies))\}/;

/**
 * A word inflected right after a number: «{n} projects», «{families} families».
 *
 * It is requested that the word have at least four letters so as not to mark «{n} % more» or the
 * units («{n} MB»), which are not inflected.
 *
 * A figure that already carries its gap needs no exception: a word written `project{s}` does not
 * end in `s`, so this pattern simply does not see it. There used to be a `SHAPE` constant asking
 * the same question of the WHOLE sentence, and it is gone — it bought nothing this expression was
 * not already doing, and it cost four sentences, because one figure done properly excused every
 * other figure standing beside it. That is how «{n} source{s} on disk · {files} files» printed
 * «1 source on disk · 1 files» under this file's protection, for as long as its first half was
 * right. The third blind spot this guard has had to lose.
 *
 * Two kinds of gap count as a figure. The names of the first list are the ones a sentence uses
 * when it has nothing to call the number after —`{n}`, `{m}`, `{days}`. The second half,
 * `[a-z]{3,}(?:s|es|ies)`, is the widening: a gap named after the very thing it counts, which is
 * where the tenth return of this bug came in. Three letters are demanded before the ending so that
 * the shape gaps themselves —`{s}`, `{es}`, `{ms}`, `{ies}`— are not read as counts.
 */
const GLUED =
  /\{(?:n|m|count|days|months|years|files|total|[a-z]{3,}(?:s|es|ies))\}\s+[a-záéíóúñ]{4,}(?:s|es)\b/i;

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
  /*
    The two token estimates. Both sum `estimateTokens(system) + estimateTokens(prompt)` over a
    whole system prompt and a whole user prompt, and `estimateTokens` is one token per four
    characters — so the figure is in the hundreds before the first quote is read. Same shape as
    `project.mdCost` below, and verified the same way: at the call sites in `twin-command.ts`, and
    at `estimateRunTokens` / `estimateLookTokens` in `apps/web/lib`.
   */
  "twin.distillEstimate":
    "«{tokens} tokens» is the estimate for a whole distilling pass: system prompt plus user prompt, at one token per four characters. It is never one, and a pass that were would have no quotes in it.",
  "twin.lookEstimate":
    "Same estimate for the look pass, built the same way from `estimateLookTokens`: a system prompt and a portrait, never one token.",
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

  /*
    And two that the wider pattern reaches for the first time. Both are in the CLI dictionary and
    both were read in the code before being written here, which is the rule this file paid for.
   */
  "scan.noRemote.n":
    "The plural half of a twin. `apps/cli/src/index.ts` picks it with `commits === 1 ? \"scan.noRemote\" : \"scan.noRemote.n\"`, and the singular key writes «{commits} commit that lives only on this disk» in full.",
  "md.inherited":
    "«({tokens} tokens)» of an inherited AGENTS.md or CLAUDE.md. `estimateTokens` in `packages/core/src/agentsmd.ts` is `ceil(length / 4)`, so a one there means an instructions file of four characters or fewer, inherited from a parent folder. Reachable, and absurd.",
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
