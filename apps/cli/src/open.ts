import pc from "picocolors";
import { unreachable } from "./server";
import { say } from "./messages";
import { catalogFetch } from "./catalog-fetch";
import { fold } from "@panoma/core/fold";

/**
 * `panoma open <project>` — from the list to the editor without going through the `cd`.
 *
 * The catalog already knows where each folder is; what was missing was being able to use that data
 * without opening the browser. With thirty repositories, the expensive part of resuming something
 * is not opening it: it's remembering in which of the four project folders it was.
 *
 * The opening is done by the server and not by this process, and not for convenience: `/api/open`
 * receives an id, looks up the path **in the catalog**, and chooses the binary from a closed list.
 * If CLI opened the folder on its own, there would end up being two implementations of the same
 * security decision, and the second one is always the one that forgets to check something.
 */

export type OpenTool = "editor" | "folder" | "terminal";

interface CatalogProject {
  id: string;
  name: string;
  slug: string;
  root: string;
  copyOf?: string | null;
}

export async function openCommand(
  api: string,
  query: string,
  tool: OpenTool,
  ): Promise<number> {
  let reply: Response;
  try {
    reply = await catalogFetch(new URL("/api/catalog", api));
  } catch {
    return unreachable(api);
  }
  if (!reply.ok) {
    process.stderr.write(pc.red(`${say("open.httpError", { status: reply.status })}\n`));
    return 1;
  }

  const { projects } = (await reply.json()) as { projects?: CatalogProject[] };
  const candidates = search(projects ?? [], query);

  if (candidates.length === 0) {
    process.stderr.write(
      pc.red(`${say("open.noMatch", { query })}\n`) +
        pc.dim(`${say("open.noMatchHint")}\n`),
    );
    return 1;
  }

  /*
    With several matches, do not choose for the user. Opening "the most likely" almost always hits,
    and the day it fails it leaves you touching the wrong project without having noticed, which is
    worse than typing six more letters.
   */
  if (candidates.length > 1) {
    process.stderr.write(
      `\n  ${pc.yellow(say("open.several", { query, n: candidates.length }))}\n\n`,
    );
    for (const project of candidates.slice(0, 12)) {
      const copy = project.copyOf ? pc.dim(say("open.copy")) : "";
      process.stderr.write(
        `      ${pc.cyan(project.slug.padEnd(28))}${pc.dim(project.root)}${copy}\n`,
      );
    }
    if (candidates.length > 12) {
      process.stderr.write(pc.dim(`      ${say("open.andMore", { n: candidates.length - 12 })}\n`));
    }
    process.stderr.write(`\n  ${pc.dim(say("open.useSlug"))}\n\n`);
    return 1;
  }

  const chosen = candidates[0]!;

  let opening: Response;
  try {
    opening = await catalogFetch(new URL("/api/open", api), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: chosen.id, tool: tool }),
    });
  } catch {
    return unreachable(api);
  }

  const result = (await opening.json().catch(() => ({}))) as {
    ok?: boolean;
    root?: string;
    name?: string;
    with?: string;
    error?: string;
    hint?: string;
  };

  if (!opening.ok || !result.ok) {
    process.stderr.write(pc.red(`${result.error ?? opening.statusText}\n`));
    if (result.hint) process.stderr.write(pc.dim(`${result.hint}\n`));
    return 1;
  }

  /* Just like the signature of `describe`: the tool is only named if it is known which one it was. */
  const opened = result.with ? ` ${pc.dim(say("open.openedWith", { tool: result.with }))}` : "";
  process.stdout.write(
    `\n  ${pc.green("✓")} ${pc.bold(result.name ?? chosen.name)}${opened}\n` +
      `      ${pc.dim(result.root ?? chosen.root)}\n\n`,
  );
  return 0;
}

/**
 * From what you wrote to the project, in three passes from less to more permissive.
 *
 * The exact slug always wins and stops the search: it is the identifier, and that a similar name
 * could beat it would turn the identifier into a suggestion. Then the exact name, and only at the
 * end the 'contains', which is the one that can return multiple results — and when it returns
 * multiple, the caller asks instead of deciding.
 *
 * They are compared without accents or capital letters because `panoma open logistica` having a
 * project called 'Logistics' is a success, not a failed search.
 */
export function search(projects: CatalogProject[], query: string): CatalogProject[] {
  const needle = normalize(query);
  if (!needle) return [];

  const bySlug = projects.filter((p) => normalize(p.slug) === needle);
  if (bySlug.length > 0) return bySlug;

  const byName = projects.filter((p) => normalize(p.name) === needle);
  if (byName.length > 0) return byName;

  return projects.filter(
    (p) => normalize(p.slug).includes(needle) || normalize(p.name).includes(needle),
  );
}

function normalize(text: string): string {
  return fold(text).trim();
}
