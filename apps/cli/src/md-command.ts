import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import pc from "picocolors";
import {
  analyzeEcosystems,
  analyzeProject,
  buildFileIndex,
  depVersions,
  readEnvKeys,
  repairAgentDoc,
  composeBlockData,
  openShots,
  shotsOpen,
  pickAgentDoc,
  readAgentsMd,
  readGitInfo,
  renderPanomaBlock,
  readTaste,
  TASTE_GLOBAL_ONLY,
  tasteDigest,
  TASTE_CAP,
  upsertPanomaBlock,
  CLAUDE_BRIDGE,
  type CatalogMdContext,
} from "@panoma/core";
import { plural, say } from "./messages";
import { unreachable } from "./server";
import { catalogFetch } from "./catalog-fetch";

/*
  `panoma md`: the agents' instruction file, handled by Panoma.
  `check` checks what the file states against the disk — read-only, works without a catalog and
  without a network. `init` and `sync` write the context block, and write *here*, in the user's
  process and with their permissions: the web only lends what the catalog knows through a read
  path. That no API writes files is a security decision, not a limitation — see
  `apps/web/lib/md-sync.ts`.
  For the block, the complete catalog is missing: without its data, two consecutive `sync` would
  give different blocks depending on whether there is a server or not, and a file that is
  rewritten only has to be boringly predictable.
 */

export type MdAction = "check" | "fix" | "init" | "sync" | "review";

export async function mdCommand(
  sub: string | undefined,
  target: string,
  api: string,
  ): Promise<number> {
  if (sub === undefined || sub === "check") return check(target);
  if (sub === "fix") return fix(target);
  if (sub === "init" || sub === "sync") return write(target, api, sub);
  if (sub === "review") return review(target, api);

  process.stderr.write(
    pc.red(`${say("md.unknownSub", { sub })}\n`) +
      pc.dim(`${say("md.unknownSubHint")}\n${say("md.usage")}\n`),
  );
  return 1;
}

/** The linter: what the file states and is no longer true. Returns 1 if there are findings. */
async function check(target: string): Promise<number> {
  process.stderr.write(pc.dim(`${say("md.checking")}\n`));

  const [index, scripts, git] = await Promise.all([
    buildFileIndex(target),
    scriptsOf(target),
    readGitInfo(target),
  ]);
  const [ecosystems, env] = await Promise.all([analyzeEcosystems(index), readEnvKeys(index)]);
  const report = await readAgentsMd(index, {
    scripts,
    deps: depVersions(ecosystems),
    env,
    touches: git?.docTouches,
  });

  if (!report) {
    process.stderr.write(
      pc.yellow(`${say("md.noDocs")}\n`) + pc.dim(`${say("md.noDocsHint")}\n`),
    );
    // Without a file there are no lies: the 1 is reserved for the findings, which is what a CI
    // wants to distinguish. The clue above already says how to make a start.
    return 0;
  }

  const out: string[] = [""];
  for (const file of report.files) {
    const managed = file.managed ? pc.dim(` · ${say("md.managedTag")}`) : "";
    out.push(
      `  ${pc.bold(say("md.fileHead", { file: file.file, tokens: file.tokens, lines: file.lines }))}${managed}`,
    );
    if (file.findings.length === 0) {
      out.push(`      ${pc.green(say("md.clean"))}`);
    } else {
      out.push(
        `      ${pc.red(
          file.findings.length === 1
            ? say("md.findingCountOne")
            : say("md.findingCount", { n: file.findings.length, s: plural(file.findings.length) }),
        )}`,
      );
      for (const finding of file.findings) {
        const reason =
          finding.kind === "broken-block"
            ? say("md.blockBroken")
            : finding.kind === "wrong-version"
              ? say("md.versionWrong", { v: finding.hint ?? "?" })
              : finding.kind === "missing-env"
                ? finding.hint
                  ? say("md.envNear", { names: finding.hint })
                  : say("md.envMissing")
                : finding.kind === "missing-path"
              ? finding.hint
                ? say("md.pathMovedTo", { path: finding.hint })
                : say("md.pathMissing")
              : finding.hint
                ? say("md.scriptNear", { names: finding.hint })
                : say("md.scriptMissing");
        out.push(
          `      ${say("md.findingRow", { line: finding.line, claim: finding.claim, reason })}`,
        );
      }
    }
    out.push("");
  }

  if (index.truncated) out.push(`  ${pc.yellow(say("md.truncated"))}`, "");

  /*
    The bridge clue: AGENTS.md without CLAUDE.md is a file that Claude Code will never load — it
    only reads its own, and a markdown link doesn't work for it either: only the import with an at
    symbol works. It is a clue and not a discovery: the file does not lie, it lacks a reader; the
    output 1 is reserved for lies.
   */
  const nombres = report.files.map((f) => f.file);
  if (nombres.includes("AGENTS.md") && !nombres.includes("CLAUDE.md")) {
    out.push(
      `  ${pc.yellow(say("md.bridgeMissing"))}`,
      `  ${pc.dim(say("md.bridgeMissingHint"))}`,
      "",
    );
  }

  for (const doc of report.inherited ?? []) {
    /*
      Anchored to the beginning and with the real home: `replace` alone with empty HOME would
      place the accent on any path, and without anchoring it bit in the middle.
     */
    const home = homedir();
    const path =
      home && doc.path.startsWith(`${home}/`) ? `~${doc.path.slice(home.length)}` : doc.path;
    out.push(`  ${pc.yellow(say("md.inherited", { path, tokens: doc.tokens }))}`);
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir) out.push(`  ${pc.dim(say("md.inheritedHint", { dir }))}`, "");
  }

  const touch = report.touches?.find((t) => t.agent);
  if (touch) {
    out.push(
      `  ${pc.dim(say("md.touchedBy", { agent: touch.agent!, file: touch.file, added: touch.added, deleted: touch.deleted }))}`,
      "",
    );
  }

  process.stdout.write(out.join("\n"));
  return report.findings > 0 ? 1 : 0;
}

/** `init` and `sync`: the context block, written by this process and not by the web. */
async function write(target: string, api: string, action: MdAction): Promise<number> {
  const picked = await pickAgentDoc(target);
  if (action === "sync" && !picked.managed) {
    process.stderr.write(
      pc.yellow(`${say("md.syncNone")}\n`) + pc.dim(`${say("md.syncNoneHint")}\n`),
    );
    return 1;
  }

  /* The first catalog: if it is not standing, it is cut here, before touching anything. */
  let response: Response;
  try {
    response = await catalogFetch(
      new URL(`/api/md/context?path=${encodeURIComponent(target)}`, api),
    );
  } catch {
    return unreachable(api);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    process.stderr.write(
      pc.red(`${say("cli.httpError", { status: response.status, detail })}\n`),
    );
    return 1;
  }
  const remote = (await response.json()) as { found: boolean; context?: CatalogMdContext };
  if (!remote.found) {
    process.stderr.write(
      pc.yellow(`${say("md.notCataloged")}\n`) +
        pc.dim(`${say("md.notCatalogedHint")}\n`),
    );
  }

  const analysis = await analyzeProject(target);
  // See `apps/web/lib/md-sync.ts`: the same portrait, through the same channel. The two places that
  // write the block have to write the same thing, or the file would change depending on who
  // regenerates it, which is exactly what a managed block cannot do. Trimmed to this project, just
  // like in `apps/web/lib/md-sync.ts`: the two places that write the block have to write the same
  // thing, or the file would change depending on who regenerates it. See there for why the name and
  // not the identity.
  /*
    With the sentinel and not with `undefined`: without a name, `digest` does not filter anything
    and the annotations of all the other projects would decrease. See `TASTE_GLOBAL_ONLY`.
   */
  const taste = tasteDigest(await readTaste(), TASTE_CAP, remote.context?.name ?? TASTE_GLOBAL_ONLY);
  /*
    `init` mounts the mailbox; `sync` only checks if it is there. See the header of
    `deliveries.ts`: the folder is the channel switch, and deleting it is how it turns off.
   */
  if (action === "init") await openShots(target);

  /*
    The bridge for Claude Code, only in init and only if missing: the block goes to AGENTS.md,
    which Claude Code never reads — without a CLAUDE.md that imports it with the at symbol, the
    most used agent starts without seeing any of this. An already existing CLAUDE.md is user prose
    and is not touched (the usual rule); there `md check` is the one who gives the notice.
   */
  if (action === "init" && picked.file === "AGENTS.md") {
    const claude = await readFile(join(target, "CLAUDE.md"), "utf8").catch(() => undefined);
    if (claude === undefined) {
      await writeFile(join(target, "CLAUDE.md"), CLAUDE_BRIDGE, "utf8");
      process.stdout.write(`${say("md.bridgeCreated")}\n`);
    }
  }
  const shots = await shotsOpen(target);
  const block = renderPanomaBlock(composeBlockData(analysis, remote.context, { taste, shots }));

  let next: string;
  try {
    next = upsertPanomaBlock(picked.content, block);
  } catch (reason) {
    process.stderr.write(
      pc.red(
        `${say("md.broken", { reason: reason instanceof Error ? reason.message : String(reason) })}\n`,
      ),
    );
    return 1;
  }

  if (next === (picked.content ?? "")) {
    process.stdout.write(`${say("md.syncSame", { file: picked.file })}\n`);
    return 0;
  }

  await writeFile(join(target, picked.file), next, "utf8");

  const done =
    picked.content === undefined
      ? say("md.initCreated", { file: picked.file })
      : action === "init"
        ? say("md.initDone", { file: picked.file })
        : say("md.syncDone", { file: picked.file });
  process.stdout.write(`${done}\n${pc.dim(`${say("md.initKeeps")}\n`)}`);
  return 0;
}

/**
 * Fix the obvious: the lies with clues. Local like `check` —read, replace and write in this
 * process— and with the same criteria as the website: facts, never opinion.
 */
async function fix(target: string): Promise<number> {
  const [index, scripts] = await Promise.all([buildFileIndex(target), scriptsOf(target)]);
  const [ecosystems, env] = await Promise.all([analyzeEcosystems(index), readEnvKeys(index)]);
  const report = await readAgentsMd(index, { scripts, deps: depVersions(ecosystems), env });
  if (!report || report.files.length === 0) {
    process.stderr.write(
      pc.yellow(`${say("md.noDocs")}\n`) + pc.dim(`${say("md.noDocsHint")}\n`),
    );
    return 0;
  }

  let algo = false;
  for (const file of report.files) {
    if (file.findings.length === 0) continue;
    const ruta = join(target, file.file);
    const content = await readFile(ruta, "utf8").catch(() => undefined);
    if (content === undefined) continue;
    const repair = repairAgentDoc(content, file.findings);
    if (repair.applied > 0) {
      await writeFile(ruta, repair.content, "utf8");
      algo = true;
      process.stdout.write(
        `${say("md.fixDone", { n: repair.applied, es: plural(repair.applied, "es"), file: file.file, m: file.findings.length - repair.applied })}\n`,
      );
    } else {
      algo = true;
      process.stdout.write(pc.dim(`${say("md.fixClean", { file: file.file })}\n`));
    }
  }
  if (!algo) process.stdout.write(pc.green(`${say("md.fixNothing")}\n`));
  return 0;
}

/**
 * The model's opinion, by API: the provider's credential lives on the server and the result is
 * saved in the record, so CLI only requests and displays. By payment and manually, like
 * `panoma describe` — the expensive never runs alone.
 */
async function review(target: string, api: string): Promise<number> {
  process.stderr.write(pc.dim(`${say("md.reviewAsking")}\n`));

  let response: Response;
  try {
    response = await catalogFetch(new URL("/api/md/review", api), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: target }),
    });
  } catch {
    return unreachable(api);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    text?: string;
    model?: string;
    project?: string;
    error?: string;
    hint?: string;
  };
  if (!response.ok) {
    process.stderr.write(pc.red(`${payload.error ?? response.status}\n`));
    if (payload.hint) process.stderr.write(pc.dim(`${payload.hint}\n`));
    return 1;
  }

  process.stdout.write(`\n${payload.text}\n\n`);
  process.stdout.write(
    pc.dim(
      `${say("md.reviewBy", { model: payload.model ?? "?", name: payload.project ?? "?" })}\n`,
    ),
  );
  return 0;
}

/** The scripts in package.json, to verify the `run x` that the file cites. */
async function scriptsOf(target: string): Promise<Record<string, string> | undefined> {
  try {
    const raw = await readFile(join(target, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts;
  } catch {
    return undefined;
  }
}
