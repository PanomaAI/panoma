import { writeFile } from "node:fs/promises";
import pc from "picocolors";
import type { Flags } from "./args";
import { catalogFetch } from "./catalog-fetch";
import { say } from "./messages";
import { unreachable } from "./server";

/*
  `panoma memory export <project>` — the memory of one project, carried out of the catalog as a file.
  The catalog kept what a person approved, discarded and decided in a PGlite directory that nothing
  outside this repository can open, and the only JSON the terminal knew how to write was the disk
  analysis of `scan --json --out`. The memory audit of 6-Sep-2026 listed the portable export as
  pending; this verb is the export half of it and nothing else: no import, no deletion contract.
  The shape is the server's (`packages/db/src/memory-export.ts`, `version: 1`), and this command
  does not reshape it: whatever `GET /api/memory/export` answers is what lands on stdout or in the
  file, pretty-printed and with a final newline, so a diff between two exports says something.
  The route asks for the operator key, and `catalogFetch` sends it on the local loop only: with
  `--api` pointing at another machine the catalog answers 403, and that is the design and not a
  gap — the file carries the owner's own testimony, and the network key was printed to look, not
  to carry things out.
 */

/** The parts of the document this command counts for the person; the rest travels untouched. */
interface MemoryExportDocument {
  notes?: unknown[];
  decisions?: unknown[];
  generalDecisions?: unknown[];
}

export async function memoryCommand(parsed: Flags): Promise<number> {
  const [, sub, slug, extra] = parsed.positionals;
  /*
    The slug is exact, like in `next` and `north`: the wrong file carries somebody else's memory,
    and that is not a mistake a person should find out about after mailing it.
   */
  if (sub !== "export" || !slug || extra !== undefined) {
    process.stderr.write(pc.red(`${say("memory.usage")}\n`) + pc.dim(`${say("memory.usageHint")}\n`));
    return 1;
  }

  let response: Response;
  try {
    response = await catalogFetch(
      new URL(`/api/memory/export?slug=${encodeURIComponent(slug)}`, parsed.api),
    );
  } catch {
    return unreachable(parsed.api);
  }

  if (!response.ok) {
    const detail = await refusalOf(response);
    process.stderr.write(pc.red(`${say("cli.httpError", { status: response.status, detail })}\n`));
    return 1;
  }

  const doc = (await response.json()) as MemoryExportDocument;
  const json = `${JSON.stringify(doc, null, 2)}\n`;

  if (parsed.out) {
    await writeFile(parsed.out, json, "utf8");
    const decisions = (doc.decisions?.length ?? 0) + (doc.generalDecisions?.length ?? 0);
    process.stderr.write(
      pc.green(`✓ ${say("memory.wrote", { path: parsed.out, notes: doc.notes?.length ?? 0, decisions })}\n`),
    );
    return 0;
  }

  process.stdout.write(json);
  return 0;
}

/**
 * The reason the catalog gave, in one line.
 *
 * The route answers `{ error, hint }`; an older server, or Next in development, may answer a page.
 * Either way what is printed is a sentence and not a body: the JSON of a refusal read whole is
 * the same noise as the trace this CLI never shows.
 */
async function refusalOf(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: unknown; hint?: unknown };
    const error = typeof body.error === "string" ? body.error : "";
    const hint = typeof body.hint === "string" ? ` ${body.hint}` : "";
    if (error) return `${error}${hint}`;
  } catch {
    // Not JSON: the first line of whatever came is the most a terminal can use.
  }
  return text.split("\n")[0]?.trim() ?? "";
}
