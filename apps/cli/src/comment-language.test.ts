import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/*
  Repository prose is English, and source comments are the easiest part of that rule to regress.
  They are spread across hundreds of files and never reach a screen, so neither interface tests nor
  manual review reliably catch a sentence added in another language. This guard reads comments as
  syntax rather than searching whole files: Spanish interface strings, fixtures, and model samples
  remain valid and must not be mistaken for comments.

  Quoted text and inline code are removed before classification. Comments legitimately mention
  Spanish examples such as locale labels and search inputs; the surrounding explanation is what
  must be English.
 */

const ROOT = new URL("../../../", import.meta.url);
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".sql",
  ".yaml",
  ".yml",
]);

const SPANISH = new Set(
  `ahora aqui así aunque carpeta castellano comentario cuando código debe del después desde donde
  entonces español esta estas este esto estos fichero hasta las los luego mantiene mientras ninguna
  ninguno para pero porque puede prueba raíz siempre solo tampoco todas todos todavía una unas uno
  unos`.split(/\s+/),
);

interface CommentRange {
  start: number;
  end: number;
}

function trackedSources(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\0")
    .filter((file) => SOURCE_EXTENSIONS.has(extname(file)));
}

function scriptComments(source: string, file: string): CommentRange[] {
  const extension = extname(file);
  const kind =
    extension === ".tsx"
      ? ts.ScriptKind.TSX
      : extension === ".jsx"
        ? ts.ScriptKind.JSX
        : [".js", ".mjs", ".cjs"].includes(extension)
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const ranges = new Map<string, CommentRange>();
  const remember = (found: readonly ts.CommentRange[] | undefined) => {
    for (const range of found ?? []) {
      ranges.set(`${range.pos}:${range.end}`, { start: range.pos, end: range.end });
    }
  };
  const visit = (node: ts.Node) => {
    remember(ts.getLeadingCommentRanges(source, node.getFullStart()));
    remember(ts.getTrailingCommentRanges(source, node.end));
    for (const child of node.getChildren(sourceFile)) visit(child);
  };
  visit(sourceFile);
  return [...ranges.values()];
}

function blockComments(source: string): CommentRange[] {
  const ranges: CommentRange[] = [];
  for (let start = source.indexOf("/*"); start >= 0; start = source.indexOf("/*", start + 2)) {
    const marker = source.indexOf("*/", start + 2);
    const end = marker < 0 ? source.length : marker + 2;
    ranges.push({ start, end });
    start = end - 2;
  }
  return ranges;
}

function lineComments(source: string, marker: string): CommentRange[] {
  const ranges: CommentRange[] = [];
  let offset = 0;
  for (const line of source.split("\n")) {
    const column = line.indexOf(marker);
    if (column >= 0) ranges.push({ start: offset + column, end: offset + line.length });
    offset += line.length + 1;
  }
  return ranges;
}

function comments(source: string, file: string): CommentRange[] {
  const extension = extname(file);
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    return scriptComments(source, file);
  }
  if (extension === ".css") return blockComments(source);
  if (extension === ".sql") return [...blockComments(source), ...lineComments(source, "--")];
  return lineComments(source, "#");
}

function looksSpanish(raw: string): boolean {
  const prose = raw
    .replace(/```[\s\S]*?```|`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/«[^»]*»|“[^”]*”|"[^"]*"|'[^']*'/g, " ")
    .replace(/(?:\/\*+|\*\/|^\s*\*|^\s*\/\/|^\s*--|^\s*#)/gm, " ");
  const words = prose.toLocaleLowerCase("es").match(/[a-záéíóúüñ]+/g) ?? [];
  const signals = new Set(words.filter((word) => SPANISH.has(word)));
  return signals.size >= 2;
}

describe("source comments use the repository language", () => {
  it("keeps tracked code comments in English", () => {
    const failures: string[] = [];
    for (const file of trackedSources()) {
      const source = readFileSync(new URL(file, ROOT), "utf8");
      for (const range of comments(source, file)) {
        const raw = source.slice(range.start, range.end);
        if (!looksSpanish(raw)) continue;
        const line = source.slice(0, range.start).split("\n").length;
        failures.push(`${file}:${line}`);
      }
    }
    expect(failures, "Spanish prose found in source comments").toEqual([]);
  });

  it("preserves machine-readable migration comments exactly", () => {
    const failures: string[] = [];
    for (const file of trackedSources().filter((candidate) => candidate.endsWith(".sql"))) {
      const lines = readFileSync(new URL(file, ROOT), "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!line.includes("statement-breakpoint")) return;
        if (line === "--> statement-breakpoint" || line.endsWith(";--> statement-breakpoint")) return;
        failures.push(`${file}:${index + 1}`);
      });
    }
    expect(failures, "Migration delimiter comments must remain machine-readable").toEqual([]);
  });
});
