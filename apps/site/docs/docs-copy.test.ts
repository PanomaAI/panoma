import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KNOWN_FLAGS } from "../../cli/src/args";
import { helpText } from "../../cli/src/lang";
import {
  DOCS_COMMANDS,
  DOCS_COPY,
  DOCS_MD_SUBS,
  DOCS_NAV,
  DOCS_SWARM,
  REQUIRED_DOCS_VERBS,
  documentedCommandVerbs,
  documentedFlags,
} from "./docs-copy";

const SPANISH_UI = /\b(el|la|de|para|qué|cómo|tú|catálogo)\b/i;

function collectStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") {
    into.push(value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
    return into;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, into);
  }
  return into;
}

describe("docs copy is English and matches the shipped CLI", () => {
  it("keeps the stay-formed hero bound to the mark plus the word docs", () => {
    expect(DOCS_SWARM.stayFormed).toBe(true);
    expect(DOCS_SWARM.word).toBe("docs");
    expect([...DOCS_SWARM.order]).toEqual([0]);
  });

  it("has the in-page sections the page is required to show", () => {
    const ids = DOCS_NAV.map((item) => item.id);
    expect(ids).toEqual([
      "start",
      "catalog",
      "day",
      "agents",
      "memory",
      "twin",
      "maintain",
      "models",
      "network",
      "commands",
      "reference",
    ]);
  });

  it("numbers the sections in the order they are read", () => {
    // The kicker is the only place where the order is written by hand: a new section in the middle
    // leaves those below lying, and the reader counts for them.
    const kickers = DOCS_NAV.map((item) => DOCS_COPY[item.id].kicker);
    expect(kickers).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
      "11",
    ]);
  });

  /*
    The limits of memory are promises with numbers, and a stale number on the public page is the
    worst kind of lie: the reader has no way to discover it. They are compared to the constants
    that truly make them fulfilled.
   */
  it("promises the memory caps the code actually enforces", () => {
    const source = readFileSync(
      new URL("../../../packages/db/src/notes.ts", import.meta.url),
      "utf8",
    );
    const constant = (name: string): number => {
      const found = source.match(new RegExp(`export const ${name} = ([0-9_]+)`));
      expect(found, name).not.toBeNull();
      return Number(found![1]!.replace(/_/g, ""));
    };

    const promised = new Map(
      DOCS_COPY.memory.caps.map((cap) => [cap.label, Number(cap.value.replace(/[,.]/g, ""))]),
    );
    expect(promised.get("characters in a single note")).toBe(constant("NOTE_MAX"));
    expect(promised.get("characters of awake memory, per project")).toBe(constant("NOTE_BUDGET"));
    expect(promised.get("sleeping notes, per project")).toBe(constant("NOTE_SLEEPING_MAX"));
    expect(promised.get("proposals waiting for review")).toBe(constant("NOTE_PENDING_MAX"));
  });

  it("promises the portrait cap the core enforces", () => {
    const source = readFileSync(
      new URL("../../../packages/core/src/taste.ts", import.meta.url),
      "utf8",
    );
    const cap = Number(source.match(/export const TASTE_CAP = ([0-9_]+)/)![1]!.replace(/_/g, ""));
    const line = DOCS_COPY.twin.pyramid.find((floor) => floor.step.includes("TASTE.md"));
    expect(line?.detail).toContain(cap.toLocaleString("en-US"));
  });

  /*
    An environment variable named here and absent from the `environment.md` table is a lever that
    the reader cannot find again. The two lists are compared, and by the way this keeps the table
    alive: the memory premiered three and none were written.
   */
  it("only names environment variables the reference lists", () => {
    const table = readFileSync(new URL("../../../docs/environment.md", import.meta.url), "utf8");
    const mentioned = new Set<string>();
    for (const line of collectStrings(DOCS_COPY)) {
      for (const match of line.matchAll(/\bPANOMA_[A-Z_]+/g)) mentioned.add(match[0]);
    }
    expect(mentioned.size).toBeGreaterThan(0);
    for (const variable of mentioned) {
      expect(table, variable).toContain(`\`${variable}\``);
    }
  });

  it("documents the required command verbs, and only verbs that exist in la ayuda del CLI", () => {
    const help = helpText();
    const verbs = documentedCommandVerbs();
    for (const verb of REQUIRED_DOCS_VERBS) {
      expect(verbs).toContain(verb);
    }
    for (const verb of verbs) {
      expect(help).toContain(`panoma ${verb}`);
    }
  });

  it("uses flags the parser already knows", () => {
    for (const flag of documentedFlags()) {
      expect(KNOWN_FLAGS).toContain(flag);
    }
  });

  it("lists md subcommands the CLI actually dispatches", () => {
    const source = readFileSync(new URL("../../cli/src/md-command.ts", import.meta.url), "utf8");
    expect(source).toContain('export type MdAction = "check" | "fix" | "init" | "sync" | "review"');
    for (const sub of DOCS_MD_SUBS) {
      expect(source).toContain(`"${sub}"`);
    }
  });

  /*
    The page promises six tools by name. If tomorrow the server registers a seventh, or changes
    the name of one, the documentation ends up lying in the place where it is hardest to discover:
    the reader will not know until their agent calls something that does not exist. Here the two
    sides are compared, in both directions.
   */
  it("documents exactly the tools the MCP server registers", () => {
    const source = readFileSync(
      new URL("../../../packages/mcp/src/index.ts", import.meta.url),
      "utf8",
    );
    const registered = [...source.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]!);
    expect(registered.length).toBeGreaterThan(0);
    expect(DOCS_COPY.agents.tools.map((tool) => tool.name).sort()).toEqual([...registered].sort());
  });

  it("says how many tools there are without having to be told twice", () => {
    const source = readFileSync(
      new URL("../../../packages/mcp/src/index.ts", import.meta.url),
      "utf8",
    );
    const total = [...source.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].length;
    const words = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
    const expected = words[total - 1];
    const strings = [...collectStrings(DOCS_COPY), ...DOCS_COMMANDS.map((block) => block.body)];
    for (const line of strings) {
      /*
        A pattern per word-number, not a generic one that captures 'the previous word': with the
        generic one, 'the six catalog tools' anchors on 'the' and the six hides in its shadow — it
        really happened, with the stale figure published in /docs.
       */
      for (const word of words) {
        const hit = new RegExp(`\\b${word}\\b(?:\\s+[a-z]+){0,2}\\s+tools\\b`, "i").test(line);
        if (hit) expect(word, line).toBe(expected!);
      }
    }
  });

  /*
    The block being taught to assemble has to be the one that CLI actually writes: the same file,
    the same two variables. Before this test, the page said `npx -y @panoma/mcp`, which was
    correct the day it was written and stopped being so without anything failing.
   */
  it("promises the same MCP wiring the CLI writes", () => {
    const source = readFileSync(new URL("../../cli/src/mcp.ts", import.meta.url), "utf8");
    for (const promise of [".mcp.json", "PANOMA_API", "PANOMA_KEY"]) {
      expect(
        [DOCS_COPY.agents.setupNote, ...DOCS_COPY.agents.setupSteps.map((step) => step.note)].some(
          (line) => line.includes(promise),
        ),
        promise,
      ).toBe(true);
      expect(source).toContain(promise);
    }
  });

  /*
    Commands do not only live in DOCS_COMMANDS: there are loose commands in the notes, in the
    extras, and in the connection steps, and no one was looking at those.
   */
  it("only mentions commands and flags the CLI accepts, anywhere on the page", () => {
    const help = helpText();
    const strings = [...collectStrings(DOCS_COPY), ...DOCS_COMMANDS.map((block) => block.command)];
    for (const line of strings) {
      for (const match of line.matchAll(/\bpanoma\s+([a-z][a-z-]*)/g)) {
        expect(help, line).toContain(`panoma ${match[1]}`);
      }
      // By phrases, and skipping those that invoke another tool: `pnpm --filter` is a correct flag
      // of a program that is not this one, and the test caught it when writing it.
      for (const clause of line.split(/[.;:\n]/)) {
        if (/\b(pnpm|git)\b/.test(clause)) continue;
        for (const match of clause.matchAll(/(?<![\w-])--[a-z][a-z0-9-]*/g)) {
          expect(KNOWN_FLAGS, clause).toContain(match[0]);
        }
      }
    }
  });

  it("has no Spanish function words in user-facing strings", () => {
    const strings = [
      ...collectStrings(DOCS_COPY),
      ...DOCS_COMMANDS.flatMap((block) => [block.title, block.body, block.command, block.verb]),
      ...DOCS_NAV.map((item) => item.label),
    ];
    for (const line of strings) {
      expect(line, line).not.toMatch(SPANISH_UI);
    }
  });
});
