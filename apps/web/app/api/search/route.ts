import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listProjectRoots } from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";

const run = promisify(execFile);

/**
 * Search for a text in the code of all projects at once.
 *
 * It is the question that only a catalog can answer: 'Where did I write that thing about the
 * Stripe webhook?' No editor answers it, because none has the eighty projects open.
 *
 * `git grep` is used and not a custom traversal for three reasons that are reinforced: it only
 * looks at files tracked by git, so it never enters `node_modules` or `build/`; it respects the
 * `.gitignore` of each project without needing to interpret it here; and it is written in C, so
 * eighty repositories are processed in seconds.
 *
 * The price is explicit and is reported: a project without git is not searched for, and a file
 * without being committed does not appear either. Keeping it silent would turn 'no results' into
 * an answer that seems complete without being so.
 *
 * ── Why this displays `sameOrigin` even though I only look ─────────────────────────────────
 *
 * I wasn't carrying it, and it was the worst-locked door in the catalog. 'Just look' is true for
 * the network key — that's why it remains exempt from `localOperatorOnly` — and it is misleading
 * for the browser, because here looking has two effects that escape a foreign tab even if it
 * cannot read the response:
 *
 * 1. **It is an oracle about private code.** Any page opened in another tab does
 * `fetch("http://localhost:4173/api/search?q=sk_live_51H", {mode:"no-cors"})`. CORS prevents it
 * from reading the body, but **it does not prevent it from timing the promise**, and with eighty
 * `git grep` behind, hitting and missing do not take the same amount of time. Repeating the
 * question character by character guesses from the outside what is inside repositories that never
 * left this disk. The fact that the answer is unreadable does not make it mute.
 * 2. **It is an amplifier.** Each request is up to eighty processes with a maximum of twenty
 * seconds each, and `maxDuration` allows up to one hundred twenty. A `<img src=…>` in a loop from
 * any page brings this machine to its knees without asking permission.
 *
 * `sameOrigin` cuts both: the browser sets `Sec-Fetch-Site` and the page cannot touch it. And it
 * doesn't break the one who has to keep entering —`panoma search` is not a browser, it doesn't
 * send that header and the same thing happens as before.
 */

/** Matches by project. Beyond this, the list stops being read. */
const MAX_PER_PROJECT = 12;
/** Repositories searched at the same time. */
const CONCURRENCY = 6;

/**
 * Third-party code that is indeed in the history.
 *
 * `git grep` look at what git follows, and there are projects that commit their dependencies: when
 * searching for «stripe» twelve lines of `ios/Pods 2/gRPC-C++/third_party/xxhash` came up. They
 * are real coincidences and they are useless — no one searches their portfolio to find the
 * implementation of xxhash. They are excluded by path and stated in the interface, instead of
 * scoring them lower and leaving the user guessing why they don't appear.
 *
 * `Pods*` with asterisk on purpose: on this disk there are folders called «Pods 2», which is what
 * Finder leaves when copying.
 */
const VENDORED = [
  ":(exclude,glob)**/Pods*/**",
  ":(exclude,glob)**/node_modules/**",
  ":(exclude,glob)**/vendor/**",
  ":(exclude,glob)**/third_party/**",
  ":(exclude,glob)**/Carthage/**",
  ":(exclude,glob)**/.dart_tool/**",
];

export interface CodeMatch {
  file: string;
  line: number;
  text: string;
}

export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return Response.json({ error: "Escribe al menos dos caracteres." }, { status: 400 });
  }

  const { db: database } = await db();
  const projects = await listProjectRoots(database);

  const results: {
    id: string;
    name: string;
    slug: string;
    root: string;
    matches: CodeMatch[];
    truncated: boolean;
  }[] = [];
  let skipped = 0;

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, projects.length) }, async () => {
      while (next < projects.length) {
        const project = projects[next++]!;
        const found = await grep(project.root, query);
        if (found === undefined) {
          skipped++;
          continue;
        }
        if (found.length > 0) {
          results.push({
            id: project.id,
            name: project.name,
            slug: project.slug,
            root: project.root,
            matches: found.slice(0, MAX_PER_PROJECT),
            truncated: found.length > MAX_PER_PROJECT,
          });
        }
      }
    }),
  );

  results.sort((a, b) => b.matches.length - a.matches.length || a.name.localeCompare(b.name, "es"));

  return Response.json({
    query,
    searched: projects.length - skipped,
    skipped,
    total: results.reduce((sum, result) => sum + result.matches.length, 0),
    results,
  });
}

/**
 * Matches in a repository, or `undefined` if there is no git to ask there.
 *
 * Distinguishing "zero results" from "I couldn't search" is the difference between an answer and
 * silence: git exits with 1 when it finds nothing —which is information— and with 128 when the
 * folder is not a repository —which it is not.
 */
async function grep(root: string, query: string): Promise<CodeMatch[] | undefined> {
  try {
    const { stdout } = await run(
      "git",
      [
        "-C",
        root,
        "grep",
        "--no-color",
        "-I", // nothing of binaries
        "-n",
        "-i",
        "-F", // literal text: the user is not writing a regular expression
        "-e",
        query,
        "--", // end of options: a search that starts with '-' is not a flag
        ".", // only under this folder, not the entire repository that contains it
        ...VENDORED,
      ],
      { maxBuffer: 16 * 1024 * 1024, timeout: 20_000 },
    );
    return parse(stdout);
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 1) return []; // The search completed and found nothing.
    if (code === 128) return undefined; // It is not a repository. A timeout or an overflowed buffer
                                        // returns whatever had arrived: half a response is better
                                        // than none, as long as it is not presented as complete.
    const stdout = (error as { stdout?: string }).stdout ?? "";
    return stdout ? parse(stdout) : undefined;
  }
}

function parse(stdout: string): CodeMatch[] {
  const matches: CodeMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    // `path:línea:text`, and the path can contain two points, so it is cut from the left looking
    // for the first number that goes between two separators.
    const match = /^(.+?):(\d+):(.*)$/.exec(line);
    if (!match) continue;
    matches.push({
      file: match[1]!.replace(/^\.\//, ""),
      line: Number.parseInt(match[2]!, 10),
      // A minified line of 40,000 characters breaks the layout and doesn't say anything.
      text: match[3]!.slice(0, 240).trim(),
    });
  }
  return matches;
}

export const maxDuration = 120;
