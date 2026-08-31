import type { FileIndex, LanguageStat } from "./types";
import { extensionOf } from "./discover";

/**
 * Extension map → language.
 *
 * Deliberately simple for Phase 1. When accuracy matters (percentages that match those on GitHub),
 * it is replaced by `linguist-js` / `go-enry`, which use the same data as GitHub and include
 * content heuristics for ambiguous extensions.
 */
export const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".dart": "Dart",
  ".py": "Python",
  ".pyi": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".rb": "Ruby",
  ".php": "PHP",
  ".java": "Java",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".swift": "Swift",
  ".m": "Objective-C",
  ".mm": "Objective-C++",
  ".c": "C",
  ".h": "C",
  ".cc": "C++",
  ".cpp": "C++",
  ".cxx": "C++",
  ".hpp": "C++",
  ".cs": "C#",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".erl": "Erlang",
  ".scala": "Scala",
  ".clj": "Clojure",
  ".hs": "Haskell",
  ".lua": "Lua",
  ".r": "R",
  ".jl": "Julia",
  ".zig": "Zig",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".astro": "Astro",
  ".html": "HTML",
  ".css": "CSS",
  ".scss": "SCSS",
  ".sass": "Sass",
  ".less": "Less",
  ".sh": "Shell",
  ".bash": "Shell",
  ".zsh": "Shell",
  ".fish": "Shell",
  ".ps1": "PowerShell",
  ".sql": "SQL",
  ".graphql": "GraphQL",
  ".gql": "GraphQL",
  ".proto": "Protocol Buffers",
  ".sol": "Solidity",
};

/** These count little: they are mostly configuration, not product. */
const DOWNWEIGHTED = new Set(["HTML", "CSS", "SCSS", "Sass", "Less", "Shell", "SQL"]);

/**
 * Calculate the distribution of languages by bytes.
 *
 * Markup/style languages are weighted down so that a Flutter project with a lot of HTML generated
 * is not labeled as a HTML project.
 */
export function computeLanguages(index: FileIndex): LanguageStat[] {
  const bytesByLanguage = new Map<string, number>();

  for (const [path, size] of index.sizes) {
    const slash = path.lastIndexOf("/");
    const name = slash === -1 ? path : path.slice(slash + 1);
    const ext = extensionOf(name);
    if (!ext) continue;
    const language = LANGUAGE_BY_EXTENSION[ext];
    if (!language) continue;

    const weight = DOWNWEIGHTED.has(language) ? 0.25 : 1;
    bytesByLanguage.set(language, (bytesByLanguage.get(language) ?? 0) + size * weight);
  }

  const total = [...bytesByLanguage.values()].reduce((sum, n) => sum + n, 0);
  if (total === 0) return [];

  return [...bytesByLanguage.entries()]
    .map(([name, bytes]) => ({ name, bytes: Math.round(bytes), share: bytes / total }))
    .sort((a, b) => b.bytes - a.bytes);
}
