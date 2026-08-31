import pc from "picocolors";
import { search } from "./open";
import { unreachable } from "./server";
import { say } from "./messages";
import { catalogFetch } from "./catalog-fetch";

/**
 * `panoma check <proyecto>` — does this still compile?
 *
 * The execution is done by the server and not this process, for the same reason as `open` and
 * `enrich`: `/api/check` resolves the path **in the catalog**, runs with the strongest machine
 * isolation, and is the only one that can write the verdict in the database. If CLI compiled on
 * its own, there would be two implementations of the same security decision, and the second one is
 * always the one that forgets to check something.
 *
 * For that very reason, this command belongs to the catalog: the value of the verdict is not
 * seeing it pass through the terminal — it is that the record remembers it within eight months.
 */

interface CatalogProject {
  id: string;
  name: string;
  slug: string;
  root: string;
  copyOf?: string | null;
}

/** Installing and compiling from scratch takes time: the timeout is generous on purpose. */
const CHECK_TIMEOUT = 15 * 60_000;

export async function checkCommand(api: string, query: string): Promise<number> {
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
  if (candidates.length > 1) {
    process.stderr.write(
      `\n  ${pc.yellow(say("open.several", { query, n: candidates.length }))}\n\n`,
    );
    for (const project of candidates.slice(0, 12)) {
      process.stderr.write(
        `      ${pc.cyan(project.slug.padEnd(28))}${pc.dim(project.root)}\n`,
      );
    }
    process.stderr.write(`\n  ${pc.dim(say("open.useSlug"))}\n\n`);
    return 1;
  }

  const chosen = candidates[0]!;
  process.stderr.write(pc.dim(`${say("check.running", { name: chosen.name })}\n`));

  let checking: Response;
  try {
    checking = await catalogFetch(new URL("/api/check", api), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: chosen.slug }),
      signal: AbortSignal.timeout(CHECK_TIMEOUT),
    });
  } catch {
    return unreachable(api);
  }

  const result = (await checking.json().catch(() => ({}))) as {
    ok?: boolean;
    verdict?: {
      status: string;
      summary: string;
      reason?: string;
      isolation: string;
      isolationNote?: string;
      dirty?: boolean;
      durationMs: number;
    };
    error?: string;
    hint?: string;
  };

  if (!checking.ok || !result.ok || !result.verdict) {
    process.stderr.write(pc.red(`${result.error ?? checking.statusText}\n`));
    if (result.hint) process.stderr.write(pc.dim(`${result.hint}\n`));
    return 1;
  }

  const v = result.verdict;
  const mark = v.status === "ok" ? pc.green("✓") : v.status === "failed" ? pc.red("✗") : pc.yellow("·");
  process.stdout.write(`\n  ${mark} ${pc.bold(chosen.name)} — ${v.summary}\n`);
  if (v.dirty) process.stdout.write(`      ${pc.yellow(say("check.dirty"))}\n`);
  if (v.reason) {
    for (const line of v.reason.split("\n").slice(-12)) {
      process.stdout.write(`      ${pc.dim(line)}\n`);
    }
  }
  if (v.isolationNote) process.stdout.write(`      ${pc.dim(v.isolationNote)}\n`);
  process.stdout.write(`      ${pc.dim(say("check.saved"))}\n\n`);
  return v.status === "ok" || v.status === "no-build" ? 0 : 1;
}
