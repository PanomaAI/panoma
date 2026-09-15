import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KNOWN_FLAGS } from "../../cli/src/args";
import {
  ALLOW_FRAME,
  DECIDE_FRAME,
  FRAME_COUNT,
  MEMORY_COPY,
  PROPOSAL_FRAME,
  RULE_FRAME,
  type MemoryTelling,
} from "./memory-copy";

/*
  What the page promises with a number is compared with the constant that makes it true, the
  way `docs-copy.test.ts` does for `/docs`: a figure that ages on the public page is the worst
  kind of lie, because the reader has no way to discover it. Both registers are read, in both
  languages, and the technical one is held to more of them.
 */
const SPANISH_UI = /\b(el|la|de|para|qué|cómo|tú|catálogo)\b/i;
const root = new URL("../../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const constant = (path: string, name: string): number => {
  const found = source(path).match(new RegExp(`export const ${name}\\s*(?::[^=]+)?=\\s*([0-9_]+)`));
  expect(found, `${name} in ${path}`).not.toBeNull();
  return Number(found![1]!.replace(/_/g, ""));
};
/** Every string of a telling, frames included. */
const strings = (telling: MemoryTelling): string[] => [
  telling.title, telling.lede, telling.sentence, telling.proposalSentence, ...telling.states,
  telling.stateAllowed, telling.stateDiscarded, telling.allowNote, telling.allowedNote, telling.discardedNote, telling.approvedNote,
  ...telling.frames.flatMap((frame) => [frame.h, ...frame.p]), telling.endTitle, ...telling.end, telling.namesTitle,
  ...telling.names.flat(),
];
/** Digits with the thousands mark of either language removed, so "2 000" and "2,000" both read 2000. */
const figures = (text: string) => text.replace(/(\d)[\s\u202f\u00a0,.](\d{3})\b/g, "$1$2");

describe("the memory page tells one story twice, in two languages", () => {
  const tellings = Object.entries(MEMORY_COPY).flatMap(([lang, copy]) =>
    (["easy", "tech"] as const).map((mode) => ({ lang, mode, telling: copy[mode] })),
  );

  it("has one drawing per frame, and the frames line up across registers", () => {
    // The drawings are a component file, which a test does not import: it reads the list as text.
    const pics = readFileSync(new URL("./memory-pics.tsx", import.meta.url), "utf8").match(/\)\[\] = \[([^\]]*)\]/)!;
    expect(pics[1]!.split(",").map((name) => name.trim()).filter(Boolean)).toHaveLength(FRAME_COUNT);
    for (const { lang, mode, telling } of tellings) {
      expect(telling.frames, `${lang}.${mode}`).toHaveLength(FRAME_COUNT);
      expect(telling.states, `${lang}.${mode} states`).toHaveLength(FRAME_COUNT);
      expect(telling.frames[ALLOW_FRAME]!.act, `${lang}.${mode} permission gate`).toBe("allow");
      expect(telling.frames[DECIDE_FRAME]!.act, `${lang}.${mode} decision gate`).toBe("decide");
      expect(telling.frames.filter((frame) => frame.act)).toHaveLength(2);
      for (const frame of telling.frames) {
        expect(frame.h.trim().length).toBeGreaterThan(0);
        expect(frame.p.length).toBeGreaterThan(0);
      }
    }
    expect(PROPOSAL_FRAME).toBeLessThan(DECIDE_FRAME);
    expect(DECIDE_FRAME).toBeLessThan(RULE_FRAME);
  });

  it("names the Twin in both registers, because the Twin is part of the memory", () => {
    for (const { lang, mode, telling } of tellings) {
      expect(strings(telling).some((line) => /\bTwin\b/.test(line)), `${lang}.${mode}`).toBe(true);
    }
  });

  it("keeps the English telling free of Spanish function words", () => {
    for (const mode of ["easy", "tech"] as const) {
      for (const line of strings(MEMORY_COPY.en[mode])) expect(line, line).not.toMatch(SPANISH_UI);
    }
    for (const line of [MEMORY_COPY.en.modeEasy, MEMORY_COPY.en.modeTech, MEMORY_COPY.en.kindLabel, MEMORY_COPY.en.allow, MEMORY_COPY.en.approve, ...Object.values(MEMORY_COPY.en.pics)]) {
      expect(line, line).not.toMatch(SPANISH_UI);
    }
  });

  it("promises the caps the code enforces", () => {
    const noteMax = constant("packages/db/src/notes.ts", "NOTE_MAX");
    const noteBudget = constant("packages/db/src/notes.ts", "NOTE_BUDGET");
    const sleeping = constant("packages/db/src/notes.ts", "NOTE_SLEEPING_MAX");
    const pending = constant("packages/db/src/notes.ts", "NOTE_PENDING_MAX");
    const tasteCap = constant("packages/core/src/taste.ts", "TASTE_CAP");
    const families = constant("packages/db/src/twin.ts", "SUPPORT_FAMILIES_FLOOR");
    const memoryCap = Number(source("apps/web/lib/spend-settings.ts").match(/^\s*memory:\s*(\d+),/m)![1]);
    const extract = source("apps/web/lib/memory-extract.ts");
    const stabilityMinutes = Number(extract.match(/export const STABILITY_MS = (\d+) \* 60_000;/)![1]);
    const pendingKiB = Number(extract.match(/export const PENDING_BYTES_TRIGGER = (\d+) \* 1024;/)![1]);
    const oldestHours = Number(extract.match(/export const OLDEST_PENDING_MS = (\d+) \* 60 \* 60_000;/)![1]);
    const receipt = source("apps/web/lib/memory-receipts.ts").match(/bytesPerPass: (\d+) \* MiB, msPerPass: (\d+), bytesPerMinute: (\d+) \* MiB/)!;
    const patrolSeconds = constant("apps/web/lib/memory-patrol.ts", "PATROL_BUDGET_MS") / 1000;
    const freshnessMinutes = Number(source("packages/db/src/memory-outcomes.ts").match(/export const FRESHNESS_MS = (\d+) \* 60 \* 1_000;/)![1]);
    const verifiedFrom = source("apps/web/lib/memory-hosts.ts").match(/CLAUDE_CODE_VERIFIED_FROM = "([\d.]+)"/)![1]!;

    for (const { lang, mode, telling } of tellings) {
      const raw = strings(telling).join("\n");
      const text = figures(raw);
      const says = (figure: string | number) => expect(text, `${lang}.${mode} says ${figure}`).toContain(String(figure));
      // The plain telling says "half an hour" and names no version; the technical one says it all.
      says(noteMax);
      says(pending);
      says(memoryCap);
      if (mode === "tech") {
        says(sleeping);
        says(noteBudget);
        // The version keeps its dots: it is read from the text before the thousands marks are folded.
        expect(raw, `${lang}.${mode} says ${verifiedFrom}`).toContain(verifiedFrom);
        says(stabilityMinutes);
        says(tasteCap);
        says(families);
        says(`${pendingKiB} KiB`);
        says(`${oldestHours} h`);
        says(`${receipt[1]} MiB`);
        says(`${receipt[2]} ms`);
        says(`${receipt[3]} MiB`);
        says(`${patrolSeconds} s`);
        says(`${freshnessMinutes} min`);
      }
    }
  });

  /*
    A command the page teaches has to be one the dispatcher recognises. Commands live in code
    spans — in prose, "panoma reads" is a sentence and not an invocation — and the hidden verbs,
    such as `brief`, which the hook runs, are allowed: the check is against the dispatcher, not the
    help.
   */
  it("only names commands the CLI dispatches, and flags the parser knows", () => {
    const dispatcher = source("apps/cli/src/index.ts");
    const verbs = new Set([...dispatcher.matchAll(/command === "([a-z-]+)"/g)].map((m) => m[1]!));
    let commands = 0;
    for (const { lang, mode, telling } of tellings) {
      for (const line of strings(telling)) {
        for (const [, span] of line.matchAll(/`([^`]+)`/g)) {
          for (const match of span!.matchAll(/\bpanoma\s+([a-z][a-z-]*)/g)) {
            commands += 1;
            expect(verbs.has(match[1]!), `${lang}.${mode}: panoma ${match[1]}`).toBe(true);
          }
          for (const match of span!.matchAll(/(?<![\w-])--[a-z][a-z0-9-]*/g)) {
            expect(KNOWN_FLAGS, `${lang}.${mode}: ${match[0]}`).toContain(match[0]);
          }
        }
      }
    }
    expect(commands).toBeGreaterThan(0);
  });

  it("uses only the inline markup the page renders", () => {
    for (const { lang, mode, telling } of tellings) {
      for (const line of strings(telling)) {
        // Placeholders such as `<folder>` live inside code spans; outside them, an angle bracket is HTML.
        expect(line.replace(/`[^`]*`/g, ""), `${lang}.${mode}: raw HTML`).not.toMatch(/<[a-z]+[ >]/);
        expect((line.match(/`/g) ?? []).length % 2, `${lang}.${mode}: unbalanced code span in "${line.slice(0, 40)}"`).toBe(0);
        // A glob such as `**/*.jsonl` lives in a code span and is not a strong marker.
        expect((line.replace(/`[^`]*`/g, "").match(/\*\*/g) ?? []).length % 2, `${lang}.${mode}: unbalanced strong in "${line.slice(0, 40)}"`).toBe(0);
      }
    }
  });
});
