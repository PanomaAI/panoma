import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { schema, type Database } from "@panoma/db";
import { claudeSlug } from "@panoma/handoff";
import {
  FIXTURE_CLAUDE_ID,
  FIXTURE_CODEX_ID,
  FIXTURE_CWD,
  fixtureText,
  layCodex,
} from "../../../../../packages/handoff/src/fixtures/index";

/*
  What the five handoff route tests share: a temporary `PANOMA_HOME` with a real PGlite in it,
  a temporary agent home with the engine's fixtures laid out as Claude Code and Codex CLI would
  keep them, and one catalog project whose folder exists on disk — `handoff()` refuses a
  conversation whose folder is gone, so the fixture's `/Users/someone/dev/lemonade` is rewritten
  to that folder before it is laid. Claude's transcript goes under the slug of that folder, the
  way Claude Code files it: since 12-Sep-2026 discovery asked for a folder reads the folder
  names first, and a transcript filed under the fixture's slug would be a shape no disk has.

  The routes read `{ home, env }` from `globalThis.__panomaHandoffStores` (see
  `lib/handoff-cache.ts`): under `NODE_ENV=test` the engine refuses to guess either, which is
  what keeps a route test from ever reading or writing the developer's own `~/.claude`.

  Not a test file (vitest runs `*.test.ts` only) and not a route (Next mounts `route.ts` only).
 */

export const CLAUDE_ID = `claude-cli:${FIXTURE_CLAUDE_ID}`;
export const CODEX_ID = `codex-cli:${FIXTURE_CODEX_ID}`;
export const PROJECT_ID = "project-lemonade";
export const PROJECT_SLUG = "lemonade";

export interface Harness {
  home: string;
  agentHome: string;
  /** The catalog project's folder: the conversations' cwd. */
  root: string;
  database: Database;
  close: () => Promise<void>;
}

const global = globalThis as unknown as { __panomaHandoffStores?: { home: string; env: NodeJS.ProcessEnv } };
const originalHome = process.env["PANOMA_HOME"];

/** A Claude transcript of `cwd`, filed where Claude Code keeps it: `projects/<slug of cwd>/<id>.jsonl`. */
export async function layClaudeOf(agentHome: string, cwd: string, text: string, id = FIXTURE_CLAUDE_ID): Promise<string> {
  const path = join(agentHome, ".claude", "projects", claudeSlug(cwd), `${id}.jsonl`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  return path;
}

/**
 * Lays the fixture stores under `agentHome`, with every conversation's folder rewritten to
 * `root`; `mutate` edits the transcript text on its way in, for a test that plants something.
 */
export async function layStores(agentHome: string, root: string, mutate: (text: string) => string = (text) => text): Promise<void> {
  await rm(join(agentHome, ".claude"), { recursive: true, force: true });
  await rm(join(agentHome, ".codex"), { recursive: true, force: true });
  await layClaudeOf(agentHome, root, mutate(fixtureText("claude.jsonl").replaceAll(FIXTURE_CWD, root)));
  layCodex(agentHome, mutate(fixtureText("codex.jsonl").replaceAll(FIXTURE_CWD, root)));
}

export async function openHarness(name: string): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), `panoma-${name}-home-`));
  const agentHome = await mkdtemp(join(tmpdir(), `panoma-${name}-agents-`));
  const root = join(await mkdtemp(join(tmpdir(), `panoma-${name}-project-`)), "lemonade");
  await mkdir(root);
  await layStores(agentHome, root);
  // An empty environment for the engine (no `CLAUDE_CONFIG_DIR`, no `CODEX_HOME`); Next's
  // global typing makes `NODE_ENV` a required key, so it is the one that travels.
  global.__panomaHandoffStores = { home: agentHome, env: { NODE_ENV: "test" } };

  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  const { db: database, close } = await openDatabase();
  await database.insert(schema.projects).values([
    { id: PROJECT_ID, slug: PROJECT_SLUG, name: "Lemonade", root, identity: "git:lemonade" },
  ]);
  return { home, agentHome, root, database, close: () => close() as Promise<void> };
}

export async function closeHarness(harness: Harness): Promise<void> {
  await harness.close();
  delete global.__panomaHandoffStores;
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  for (const folder of [harness.home, harness.agentHome, join(harness.root, "..")]) {
    await rm(folder, { recursive: true, force: true });
  }
}

/** A same-origin request from this machine's browser, in English, with a JSON body when given. */
export function request(path: string, body?: unknown, init: { method?: string; crossSite?: boolean } = {}): Request {
  return new Request(`http://localhost:4173${path}`, {
    method: init.method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      host: "localhost:4173",
      origin: "http://localhost:4173",
      "sec-fetch-site": init.crossSite ? "cross-site" : "same-origin",
      "content-type": "application/json",
      "accept-language": "en",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
