import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NATIVE_AGENTS } from "./types";
import { MAY_OPEN } from "./stores/index";

/**
 * The legal line of the feature: panoma never holds, reads, copies or rotates a credential.
 * The engine reads agent stores through a closed list of paths, and the files that hold
 * credentials sit in those same folders — `auth.json` beside Codex's sessions, `oauth_creds`
 * beside Gemini's chats. This test reads every source file of the package as text, comments
 * stripped, and fails on the name of any such file, so that a reader that "just needs the
 * account id" cannot be written without the test going red first.
 */

const FORBIDDEN = ["auth.json", ".credentials", "oauth_creds", "google_accounts", "keychain", "state_5.sqlite", "thread_history"];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "fixtures") out.push(...sources(path));
      continue;
    }
    if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}

describe("no credential file is named anywhere in the engine", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const files = sources(here);

  it("sweeps every source file", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith(join("stores", "codex.ts")))).toBe(true);
  });

  it.each(files.map((file) => [relative(here, file).split(sep).join("/"), file] as const))("%s", (shown, file) => {
    const source = stripComments(readFileSync(file, "utf8"));
    for (const name of FORBIDDEN) {
      expect(source.toLowerCase(), `${shown} names ${name}`).not.toContain(name.toLowerCase());
    }
  });

  it("the closed list of what may be opened names no such file either", () => {
    for (const agent of NATIVE_AGENTS) {
      const globs = MAY_OPEN[agent] ?? [];
      expect(globs.length).toBeGreaterThan(0);
      for (const glob of globs) for (const name of FORBIDDEN) expect(glob.toLowerCase()).not.toContain(name.toLowerCase());
    }
  });
});
