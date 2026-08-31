#!/usr/bin/env node
import { relative, resolve } from "node:path";
import { readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import pc from "picocolors";
import { expandTilde,
  analyzeProject,
  classifyOrigin,
  type OriginEvidence,
  deduceIdentity,
  discoverProjects,
  findDuplicateFamilies,
  isProjectRoot,
  type ProjectAnalysis,
  type ProjectFamily,
} from "@panoma/core";
import { parseArgs } from "./args";
import { openCommand, type OpenTool } from "./open";
import { hooksCommand } from "./hooks";
import { signalCommand } from "./signal";
import { entryCommand, todayCommand } from "./today";
import { helpText } from "./lang";
import { plural, say, type MessageKey } from "./messages";
import { mcpEntry, installFor } from "./mcp";
import { panomaCommand } from "./environment";
import { installSafeOutput } from "./safe-output";
import { renderFamilies, renderGrid, renderProject } from "./render";
import { cliVersion, downCommand, isAlive, upCommand, unreachable } from "./server";
import { avisoDeVersion } from "./version-check";
import { espera } from "./wait";
import { catalogFetch } from "./catalog-fetch";

/**
 * The exit code that applies, and by the way the version notice if there is one.
 *
 * It hangs only on the commands with which someone **starts** —the part of the day, `scan`, `up` —
 * and not on all of them: `panoma open x` has to open the editor and stay quiet, and a network
 * query, even if it's two seconds and once a day, doesn't matter in the middle of that.
 */
async function conAviso(codigo: number): Promise<number> {
  const aviso = await avisoDeVersion(cliVersion());
  if (aviso) process.stdout.write(pc.dim(`  ${aviso.replace(/\n/g, "\n  ")}\n\n`));
  return codigo;
}

async function main(): Promise<number> {
  // First of all: from here on nothing that Panoma prints can move the cursor or delete lines, no
  // matter where it comes from. See `output-segura.ts`.
  installSafeOutput();

  // Only the help is translated for now; the rest of the messages remain in Spanish.

  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);

  if (parsed === "help") {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }

  if (parsed === "version") {
    // The number on its own, like node and npm: is for people and for scripts at the same time.
    process.stdout.write(`${cliVersion() ?? "desconocida"}\n`);
    return 0;
  }

  if ("error" in parsed) {
    process.stderr.write(`${pc.red(parsed.error)}\n${pc.dim(say("error.seeHelp"))}\n`);
    return 1;
  }

  /*
    The command comes from the positionals and not from `argv.find(a => !a.startsWith("-"))`,
    which was the same error with other clothing: in `panoma --api http://x scan`, the first
    argument that does not start with a dash is `http://x`, so the value of a flag turned into the
    command and displayed “Unknown command: http://x».” The parser already knows which arguments
    are values; asking it is the only thing that cannot get out of sync.
   */
  const command = parsed.positionals[0];

  /*
    One name per command, and in English.
    For a time, each verb also responded to its Spanish name —`espacio`, `buscar`, `secretos`,
    `describir`, `hoy` — so as not to break already trained fingers. They were removed on August
    25, 2026, along with the rest of the Spanish from the terminal: none of this has been
    published yet, so there are no fingers to break, and two names for the same thing are two
    names to learn.
    Yes, they were documented, contrary to what was said here before: the README showed the first
    four in the section of the four questions and on the code map. They were removed from there
    the same day as from the code, and `hoy` —which survived the first pass— with them.
    `commands.test.ts` is watching it, so that next time it doesn't depend on someone remembering.
    The verbs of the day go first, and the first of all is not to write none.
    `panoma` on its own no longer provides help: it gives the day's report. It's the difference
    between a tool that is installed and one that is used — no one opens in the morning a program
    that only knows how to introduce itself. See `hoy.ts`.
   */
  if (command === undefined) return conAviso(await entryCommand(parsed.api));

  if (command === "today") return todayCommand(parsed.api);

  /*
    `next` is attached to `today` because they are the same morning split in two: one tells what
    happened and the other what is missing. Without a Spanish alias, for the same reason as
    `twin`: it premieres today, so there are no trained fingers to preserve and yes, two names to
    learn.
    In deferred charge like `check` and `md`: whoever writes `panoma` by itself does not have to
    pay for the start-up of a module they are not going to use.
   */
  if (command === "next") {
    const { nextCommand } = await import("./next-command");
    return nextCommand(parsed.api, parsed.positionals.slice(1));
  }

  /*
    `north` is attached to `next` because it is the phrase that `next` asks for and there was
    nowhere to say it. `panoma next` opens asking what 'finished' is in each project and sent to
    the form, which has no space to answer it; the path that stores it existed from the first day
    with nothing that knew how to call it. See the header of `north-command.ts`.
    It receives the flags as integers and not just the address, unlike `next`: it lacks the
    positional ones **and** `--force`, which is the only thing that allows replacing a north that
    cannot be read from the terminal. Without a Spanish alias, for the same reason as `twin` and
    `review`.
   */
  if (command === "north") {
    const { northCommand } = await import("./north-command");
    return northCommand(parsed);
  }

  if (command === "open") {
    const query = parsed.positionals.slice(1).join(" ");
    if (!query) {
      process.stderr.write(pc.red(`${say("usage.open")}\n`));
      return 1;
    }
    const tool: OpenTool = parsed.folder
      ? "folder"
      : parsed.terminal
        ? "terminal"
        : "editor";
    return openCommand(parsed.api, query, tool);
  }

  if (command === "check") {
    const query = parsed.positionals.slice(1).join(" ");
    if (!query) {
      process.stderr.write(pc.red(`${say("usage.check")}\n`));
      return 1;
    }
    const { checkCommand } = await import("./check-command");
    return checkCommand(parsed.api, query);
  }

  /*
    `up` with a folder behind does both things at once.
    Whoever arrives via `npx` **does not have the `panoma` command in the PATH**: npx runs from
    its cache and links nothing, so every command of theirs starts again from `npx panoma`. Asking
    them for two pastes to see the full catalog was already too much; and the second one,
    moreover, failed — the empty catalog showed them `panoma scan … --save`, a command that does
    not exist for them.
    With the folder, `up` starts the server and continues to the scan, saving. Without the folder,
    it behaves exactly as always, which is what someone who already has it installed and just
    wants to start it expects.
    Order matters and it is not negotiable: saving requires the server to be up, so it is started
    first and only if that goes well is it scanned.
   */
  let escanear = command === "scan";
  let veniaDeUp = false;

  if (command === "up") {
    const code = await upCommand(parsed.api, parsed.atBoot, {
      enabled: parsed.network,
      rotate: parsed.rotateKey,
    });
    if (code !== 0) return code;
    if (parsed.positionals[1] === undefined) return conAviso(0);
    escanear = true;
    veniaDeUp = true;
  }

  if (command === "down") return downCommand(parsed.api);

  if (command === "signal") {
    // The PreToolUse hook: machine output or nothing, and never a code other than 0.
    return signalCommand(resolve(expandTilde(parsed.path)), parsed.api);
  }

  if (command === "hooks") {
    const target = resolve(expandTilde(parsed.path));
    return hooksCommand(
      target,
      parsed.api,
      parsed.install ? "install" : parsed.remove ? "remove" : "status",
    );
  }

  if (command === "ai") {
    const { aiCommand } = await import("./ai-command");
    return aiCommand(parsed);
  }

  if (command === "md") {
    // The route starts from the third positional: in 'Panoma md sync .', `parsed.path` equals
    // 'sync'.
    const target = resolve(
      expandTilde(parsed.positionals[2] ?? "."),
    );
    const { mdCommand } = await import("./md-command");
    return mdCommand(parsed.positionals[1], target, parsed.api);
  }

  if (command === "disk") return reportDisk(parsed.api);

  if (command === "secrets") return reportSecrets(parsed.api);

  if (command === "describe") {
    const slug = parsed.positionals.slice(1).join(" ");
    if (!slug) {
      process.stderr.write(pc.red(`${say("usage.describe")}\n`));
      return 1;
    }
    return describeProject(parsed.api, slug);
  }

  if (command === "search") {
    const term = parsed.positionals.slice(1).join(" ");
    if (term.length < 2) {
      process.stderr.write(pc.red(`${say("usage.search")}\n`));
      return 1;
    }
    return searchCode(parsed.api, term);
  }

  if (command === "enrich") return enrichCatalog(parsed.api, parsed.force);

  if (command === "run") {
    const [slug, packageName, version] = parsed.positionals.slice(1);
    if (!slug || (!packageName && !parsed.security)) {
      process.stderr.write(
        pc.red(`${say("usage.run")}\n`),
      );
      return 1;
    }
    return dispatchRun(
      parsed.api,
      slug,
      packageName,
      version,
      { security: parsed.security, force: parsed.force, isolation: parsed.isolation },
    );
  }

  if (command === "agent-key") {
    const name = parsed.positionals.slice(1).join(" ");
    if (!name) {
      process.stderr.write(pc.red(`${say("usage.agentKey")}\n`));
      return 1;
    }
    return createAgentKey(parsed.api, name, parsed.install);
  }

  if (command === "twin") {
    const { twinCommand } = await import("./twin-command");
    return twinCommand(parsed);
  }

  /*
    `review` goes loose and not inside `md`, even though `panoma md review` exists.
    That one asks a model what it thinks about the instruction file and gets paid; this one
    doesn't call anyone: it looks at the project against its own design footprint and returns
    facts. Hanging it on `md` would tie it to a file it has nothing to do with, and putting it in
    `check` —which compiles the project in a separate worktree— would tie it to something that
    takes minutes. Otherwise, the rule of `twin`: English name and only one.
    The route departs from the second position, as in `scan`: `panoma review ~/Desktop/cabeman`.
   */
  if (command === "review") {
    const target = resolve(expandTilde(parsed.positionals[1] ?? "."));
    const { reviewCommand } = await import("./review-command");
    return reviewCommand(target);
  }

  if (!escanear) {
    process.stderr.write(pc.red(`${say("error.unknownCommand", { command: command ?? say("error.noCommand") })}\n${helpText()}\n`));
    return 1;
  }

  /*
    Getting here from `up` involves saving: bringing up the catalog to leave it empty would make
    no sense.
   */
  const guardar = parsed.save || veniaDeUp;

  const target = resolve(expandTilde(parsed.path));

  /*
    A path can be a project in itself or a directory that contains many — except for the home,
    which is never "a project." A loose `~/package.json` (npm leaves it to the first `npm i`
    confused) turned `panoma up ~` — the command that the landing page sells as "your entire disk"
    — into a single F card with the entire disk inside.
   */
  const roots =
    target !== homedir() && (await isProjectRoot(target))
      ? [target]
      : await discoverProjects(target, parsed.depth);

  if (roots.length === 0) {
    /*
      Zero projects has four causes that require different solutions: the path does not exist
      (a twisted finger), it is a file, it exists and does not allow itself to be read —in macOS,
      the permission of
      Desktop and Documents that the system requests app by app; `stat` works there and what fails
      is reading it, that's why the probe is `readdir` —, or it exists, it is read and there
      really is nothing. Telling 'no project found' to someone who typed the path wrong—or to
      someone whose folder the system closed—is sending them to look for a problem they don't
      have.
     */
    const acceso = await readdir(target).then(
      () => "readable",
      (error: NodeJS.ErrnoException) =>
        error.code === "ENOENT" ? "missing" : error.code === "ENOTDIR" ? "file" : "denied",
    );
    const motivo =
      acceso === "missing"
        ? say("scan.noSuchPath", { path: target })
        : acceso === "file"
          ? say("scan.notAFolder", { path: target })
          : acceso === "denied"
            ? say("scan.noPermission", { path: target })
            : say("scan.none", { path: target });
    process.stderr.write(pc.yellow(`${motivo}\n`));
    return 1;
  }

  if (!parsed.json) {
    process.stderr.write(
      pc.dim(`${say("scan.analyzing", { n: roots.length, s: plural(roots.length), path: target })}\n`),
    );
  }

  /*
    One point per project analyzed.
    Scanning the entire desktop takes a long twenty seconds, and so far between 'Analyzing 75
    projects' and the result, absolutely nothing would happen on the screen. With many projects,
    one out of three is marked so that the line does not wrap around.
    It is silenced with `--json` because there the output is a piece of data, and also if an error
    from a project has already written its own line: two things writing at the same time would
    leave the dots split in half.
   */
  const marcha = parsed.json ? undefined : espera(roots.length > 40 ? 3 : 1);

  const analyses: ProjectAnalysis[] = [];
  for (const root of roots) {
    try {
      analyses.push(await analyzeProject(root, { skipGit: !parsed.git }));
      marcha?.uno();
    } catch (error) {
      marcha?.fin();
      process.stderr.write(pc.red(`  ${say("scan.failed", { root, reason: (error as Error).message })}\n`));
    }
  }
  marcha?.fin();

  analyses.sort((a, b) => b.health.score - a.health.score);
  const families = analyses.length > 1 ? findDuplicateFamilies(analyses) : [];

  /*
    Who you are is deduced from the whole, so the origin is decided here and not in the engine.
    With a single project the deduction is supported by its `git config user.email`, which remains
    true: what is lost is the ability to compare with the rest of the portfolio.
   */
  const identity = deduceIdentity(analyses);
  const origins = analyses.map((analysis) => ({
    root: analysis.root,
    ...classifyOrigin(analysis, identity),
  }));

  if (guardar) {
    const saved = await saveToCatalog(parsed.api, analyses, families, target, origins);
    if (!saved) return 1;
  }

  if (parsed.json || parsed.out) {
    const json = JSON.stringify(
      {
        scannedAt: new Date().toISOString(),
        root: target,
        projects: analyses,
        // We reference by path instead of nesting the complete analyses: otherwise, each duplicated
        // project would appear twice in the file.
        families: families.map((family) => ({
          name: family.name,
          canonical: family.canonical.root,
          canonicalReason: family.canonicalReason,
          redundantBytes: family.redundantBytes,
          copies: family.copies.map((copy) => ({
            root: copy.analysis.root,
            confidence: copy.confidence,
            reason: copy.reason,
            daysBehind: copy.daysBehind,
          })),
        })),
      },
      null,
      2,
    );
    if (parsed.out) {
      await writeFile(parsed.out, json, "utf8");
      process.stderr.write(pc.green(`✓ ${say("scan.wrote", { path: parsed.out })}\n`));
    } else {
      process.stdout.write(`${json}\n`);
    }
    return 0;
  }

  if (parsed.duplicates) {
    if (families.length === 0) {
      process.stdout.write(pc.green(`\n  ${say("families.none")}\n\n`));
      return 0;
    }
    process.stdout.write(`${renderFamilies(families, target)}\n`);
    return 0;
  }

  // A single project: complete sheet. Several: grid + sheet if --verbose was requested.
  if (analyses.length === 1) {
    process.stdout.write(
      `${renderProject(analyses[0]!, { verbose: parsed.verbose, origin: origins[0]})}\n\n`,
    );
  } else {
    process.stdout.write(`${renderGrid(analyses, target)}\n`);
    if (parsed.verbose) {
      for (const [index, analysis] of analyses.entries()) {
        process.stdout.write(
          `${renderProject(analysis, { verbose: true, origin: origins[index]})}\n`,
        );
      }
    }
    const totalCopies = families.reduce((sum, f) => sum + f.copies.length, 0);
    const hint =
      totalCopies > 0
        ? pc.yellow(
            say(totalCopies === 1 ? "scan.looksLikeCopiesOne" : "scan.looksLikeCopiesMany", {
              n: totalCopies,
            }),
          )
        : say("scan.seeFullCard");
    const cuantos = say("scan.projects", {
      n: analyses.length,
      s: plural(analyses.length),
    });
    process.stdout.write(pc.dim(`\n  ${cuantos} · ${hint}\n`));

    // The notice of unbacked work goes **after** the summary and in red: it is the only thing in
    // the entire scan that can cost points, and losing it among eighty gray lines would be burying
    // it right where it needs to be seen.
    const orphans = analyses.filter(
      (a) => a.git?.work?.ownRepo && !a.git.remoteUrl && (a.git.commitCount ?? 0) > 0,
    );
    const dirty = analyses.filter(
      (a) => (a.git?.work?.modified ?? 0) > 0 || (a.git?.work?.ahead ?? 0) > 0,
    );
    if (orphans.length > 0 || dirty.length > 0) {
      const bits = [
        orphans.length > 0
          ? pc.red(
              ((commits) =>
                say(commits === 1 ? "scan.noRemote" : "scan.noRemote.n", {
                  n: orphans.length,
                  commits,
                }))(orphans.reduce((sum, a) => sum + (a.git?.commitCount ?? 0), 0)),
            )
          : undefined,
        dirty.length > 0
          ? pc.yellow(say("scan.unsavedWork", { n: dirty.length }))
          : undefined,
      ].filter(Boolean);
      process.stdout.write(`  ${bits.join(pc.dim(" · "))}\n`);
    }
    process.stdout.write("\n");
  }

  /*
    The door at the end of the funnel, and now for both paths.
    It used to live inside the "multiple projects" branch, so anyone scanning **a single folder**—the most
    likely case for someone trying it for the first time—reached the end of its file and that was
    it, without anyone telling them that a catalog exists. The landing page points to
    `npx panoma scan ~/Desktop`; if that points to a project, the tasting ended in a dead end.
   */
  if (veniaDeUp) {
    /*
      The last thing you read is where to go. The server banner appeared before the scan, and by
      the time it finishes, the scroll has already carried it away.
     */
    process.stdout.write(pc.dim(`  ${say("scan.catalogAt", { api: parsed.api })}\n\n`));
  } else if (guardar) {
    /*
      Truly saved: the door is the catalog, already standing or to be set up. Without this line,
      `scan --save` ended in silence and no one discovered that a website exists.
     */
    const puerta = (await isAlive(parsed.api))
      ? say("scan.catalogAt", { api: parsed.api })
      : say("scan.nextApp");
    process.stdout.write(pc.dim(`  ${puerta}\n\n`));
  } else {
    /*
      The circle that was here: without `--save` nothing was saved, and sending to `panoma up` led
      to an empty catalog with the face of something freshly scanned. The truth is told —it was a
      tasting— and the exit of a paste, which lifts and fills at the same time.
     */
    process.stdout.write(pc.dim(`  ${say("scan.tasting", { path: parsed.path })}\n\n`));
  }

  return conAviso(0);
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * Measure the record of the entire catalog.
 *
 * The work is done by the server, just like `enrich`: it is the one that can write to the
 * database. Here it only notifies that it is going to be long and presents the result.
 */
async function reportDisk(api: string): Promise<number> {
  process.stderr.write(
    pc.dim(`${say("disk.walking")}\n`),
  );

  let response: Response;
  try {
    response = await catalogFetch(new URL("/api/disk", api), { method: "POST" });
  } catch {
    return unreachable(api);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    process.stderr.write(pc.red(`${say("cli.httpError", { status: response.status, detail })}\n`));
    return 1;
  }

  const result = (await response.json()) as {
    measured: number;
    missing: number;
    totalBytes: number;
    reclaimableBytes: number;
  };

  const share = result.totalBytes > 0 ? result.reclaimableBytes / result.totalBytes : 0;
  process.stdout.write(
    [
      "",
      `  ${pc.bold(say("disk.title"))}`,
      `      ${say("disk.inProjects", { size: size(result.totalBytes), n: result.measured, s: plural(result.measured) })}`,
      `      ${pc.cyan(size(result.reclaimableBytes))} ${say("disk.regenerate")} ${pc.dim(
        `(${Math.round(share * 100)}%)`,
      )}`,
      result.missing > 0
        ? pc.dim(`      ${say("disk.missing", { n: result.missing, s: plural(result.missing) })}`)
        : "",
      "",
      pc.dim(`      ${say("disk.breakdown", { url: `${api}/disk` })}`),
      "",
    ]
      .filter(Boolean)
      .join("\n") + "\n",
  );

  return 0;
}

/**
 * Send the analysis to the catalog.
 *
 * The CLI does not write to the database: the web is its only owner. PGlite supports only one
 * process and two writers corrupt the data directory — something we learned the hard way. Also, in
 * production the database credentials should never be on the user's machine, so this is the right
 * path anyway.
 */
async function saveToCatalog(
  api: string,
  analyses: ProjectAnalysis[],
  families: ProjectFamily[],
  scope: string,
  origins: { root: string; kind: string; startedBy?: string; yourShare?: number; evidence: OriginEvidence[] }[],
  ): Promise<boolean> {
  const payload = {
    origins,
    // The scanned route travels with the analysis: it is what allows the catalog to distinguish
    // 'this project is no longer there' from 'this scan hadn't looked at it'.
    scope,
    projects: analyses,
    families: families.map((family) => ({
      name: family.name,
      canonicalRoot: family.canonical.root,
      canonicalReason: family.canonicalReason,
      redundantBytes: family.redundantBytes,
      copies: family.copies.map((copy) => ({
        root: copy.analysis.root,
        confidence: copy.confidence,
        reason: copy.reason,
        daysBehind: copy.daysBehind,
      })),
    })),
  };

  let response: Response;
  try {
    response = await catalogFetch(new URL("/api/ingest", api), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    unreachable(api);
    return false;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    process.stderr.write(pc.red(`${say("cli.ingestRejected", { status: response.status, detail })}\n`));
    return false;
  }

  const result = (await response.json()) as {
    projects: number;
    technologies: number;
    packages: number;
    families: number;
    removed?: number;
    excluded?: number;
    reslugged?: number;
  };
  process.stderr.write(
    pc.green(
      `\u2713 ${say("cli.catalogUpdated", {
        projects: result.projects,
        ps: plural(result.projects),
        technologies: result.technologies,
        // «technology» and «family» do not pluralize with an `s`, so the gap carries both halves.
        ts: plural(result.technologies, "ies", "y"),
        packages: result.packages,
        ks: plural(result.packages),
        families: result.families,
        fs: plural(result.families, "ies", "y"),
      })}\n`,
    ),
  );
  // Removing projects is a change that the user did not request; saying this prevents the feeling
  // that the catalog does strange things on its own.
  if (result.removed) {
    process.stderr.write(
      pc.dim(
        `  ${say(result.removed === 1 ? "cli.removedOne" : "cli.removedMany", { n: result.removed })}\n`,
      ),
    );
  }
  if (result.excluded) {
    process.stderr.write(
      pc.dim(
        `  ${say(result.excluded === 1 ? "cli.excludedOne" : "cli.excludedMany", { n: result.excluded })}\n`,
      ),
    );
  }
  // Changing a URL without warning is breaking a marker in silence.
  if (result.reslugged) {
    process.stderr.write(
      pc.dim(`  ${say("cli.reslugged", { n: result.reslugged })}\n`),
    );
  }
  return true;
}

/** Code search across the entire portfolio, with what could and could not be reviewed. */
async function searchCode(api: string, term: string): Promise<number> {
  let response: Response;
  try {
    response = await catalogFetch(new URL(`/api/search?q=${encodeURIComponent(term)}`, api));
  } catch {
    return unreachable(api);
  }
  if (!response.ok) {
    process.stderr.write(pc.red(`${say("open.httpError", { status: response.status })}\n`));
    return 1;
  }

  const result = (await response.json()) as {
    searched: number;
    skipped: number;
    total: number;
    results: { name: string; matches: { file: string; line: number; text: string }[] }[];
  };

  const out = process.stdout;
  out.write(
    `\n${pc.dim(
      `${say("search.searched", { n: result.searched, y: plural(result.searched, "ies", "y") })}${
        result.skipped > 0
          ? ` · ${say("search.skippedNoGit", { n: result.skipped })}`
          : ""
      }`,
    )}\n`,
  );
  if (result.total === 0) {
    out.write(`${pc.dim(say("search.nothingTracked", { term }))}\n\n`);
    return 0;
  }

  out.write(
    `\n${pc.bold(say("search.matches", { n: result.total, es: plural(result.total, "es") }))} ${say("search.inProjects", { n: result.results.length, s: plural(result.results.length) })}\n`,
  );
  for (const project of result.results) {
    out.write(`\n  ${pc.cyan(pc.bold(project.name))}\n`);
    for (const match of project.matches) {
      out.write(
        `    ${pc.dim(`${match.file}:${match.line}`)}  ${match.text.slice(0, 90)}\n`,
      );
    }
  }
  out.write("\n");
  return 0;
}

/**
 * Credentials committed in the files that git tracks.
 *
 * The values already arrive truncated from the server; here none is recomposed again. A terminal
 * stores its scrollback just like a browser stores its cache.
 */
async function reportSecrets(api: string): Promise<number> {
  process.stderr.write(pc.dim(`${say("secrets.reading")}\n`));

  let response: Response;
  try {
    response = await catalogFetch(new URL("/api/secrets", api), { method: "POST" });
  } catch {
    return unreachable(api);
  }
  if (!response.ok) {
    process.stderr.write(pc.red(`${say("open.httpError", { status: response.status })}\n`));
    return 1;
  }

  const result = (await response.json()) as {
    scanned: number;
    skipped: number;
    ignoredPublic: number;
    total: number;
    results: {
      name: string;
      findings: { severity: string; ruleId: string; label: string; file: string; line: number; excerpt: string }[];
    }[];
  };

  const out = process.stdout;
  out.write(
    `\n${pc.dim(
      `${say("secrets.checked", { n: result.scanned, y: plural(result.scanned, "ies", "y"), skipped: result.skipped })}` +
        say("secrets.publicByDesign", { n: result.ignoredPublic }),
    )}\n`,
  );

  if (result.total === 0) {
    out.write(`\n${pc.green("✓")} ${say("secrets.none")}\n\n`);
    return 0;
  }

  const tone: Record<string, (s: string) => string> = {
    critical: pc.red,
    high: pc.yellow,
    medium: pc.dim,
  };
  // The value that comes is the one the catalog stores, in English; what is printed is the word, in
  // the language of the viewer.
  const word = (severity: string) => say(`severity.${severity}` as MessageKey) ?? severity;
  out.write(
    `\n${pc.bold(pc.red(say("secrets.findings", { n: result.total, s: plural(result.total) })))} ${say("secrets.inProjects", { n: result.results.length, s: plural(result.results.length) })}\n`,
  );
  for (const project of result.results) {
    out.write(`\n  ${pc.cyan(pc.bold(project.name))}\n`);
    for (const finding of project.findings) {
      const color = tone[finding.severity] ?? pc.dim;
      out.write(
        `    ${color(word(finding.severity).padEnd(8))} ${say(`secret.${finding.ruleId}` as MessageKey) ?? finding.label}\n` +
          `             ${pc.dim(`${finding.file}${finding.line ? `:${finding.line}` : ""}`)}\n`,
      );
    }
  }
  out.write(
    `\n${pc.dim(
      say("secrets.revokeFirst"),
    )}\n\n`,
  );
  // Non-zero output: this can run on a hook or on CI.
  return 1;
}

/**
 * Ask the configured model to explain what a project is about.
 *
 * It is printed with the model's signature in front. It is the only text that Panoma produces
 * without being based on a verifiable fact, and mixing it with the rest without saying so would be
 * exactly what this tool promises not to do.
 */
async function describeProject(api: string, slug: string): Promise<number> {
  process.stderr.write(pc.dim(`${say("describe.reading", { slug })}\n`));

  let response: Response;
  try {
    response = await catalogFetch(new URL("/api/describe", api), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
  } catch {
    return unreachable(api);
  }

  const result = (await response.json()) as { text?: string; model?: string; error?: string; hint?: string };
  if (!response.ok || !result.text) {
    process.stderr.write(pc.red(`${result.error ?? response.statusText}\n`));
    if (result.hint) process.stderr.write(pc.dim(`${result.hint}\n`));
    return 1;
  }

  /* The signature only if there is one: 'written by undefined' is worse than not signing. */
  const signature = result.model
    ? `\n${pc.dim(`  ${say("describe.writtenBy", { model: result.model })}`)}\n`
    : "";
  process.stdout.write(`\n${wrap(result.text, 78, "  ")}\n${signature}\n`);
  return 0;
}

/** Adjust a paragraph to the width of the terminal without breaking words. */
function wrap(text: string, width: number, indent: string): string {
  const lines: string[] = [];
  let line = indent;
  for (const word of text.split(/\s+/)) {
    if (line.length + word.length + 1 > width && line.trim()) {
      lines.push(line);
      line = indent;
    }
    line += (line === indent ? "" : " ") + word;
  }
  if (line.trim()) lines.push(line);
  return lines.join("\n");
}

/**
 * Triggers the enrichment of the catalog.
 *
 * The work is done by the server, which is the one that can write to the database. The CLI only
 * requests it and presents the result.
 */
async function enrichCatalog(api: string, force: boolean): Promise<number> {
  process.stderr.write(pc.dim(`${say("enrich.asking")}\n`));

  let response: Response;
  try {
    response = await catalogFetch(new URL(`/api/enrich?force=${force}`, api), { method: "POST" });
  } catch {
    return unreachable(api);
  }

  if (!response.ok) {
    process.stderr.write(pc.red(`${say("open.httpError", { status: response.status })}\n`));
    return 1;
  }

  const result = (await response.json()) as {
    checked: number;
    resolved: number;
    unresolvable: number;
    failed: number;
    outdated: number;
    advisories: number;
    vulnerablePackages: number;
  };

  process.stdout.write(
    [
      "",
      `  ${pc.bold(say("enrich.registries"))}`,
      `      ${say("enrich.resolved", { n: pc.green(String(result.resolved)), s: plural(result.resolved), checked: result.checked })}`,
      result.unresolvable > 0
        ? `      ${pc.dim(say("enrich.unresolvable", { n: result.unresolvable }))}`
        : "",
      result.failed > 0 ? `      ${pc.yellow(say("enrich.retry", { n: result.failed }))}` : "",
      "",
      `  ${pc.bold(say("enrich.portfolio"))}`,
      `      ${say("enrich.outdated", { n: pc.yellow(String(result.outdated)), ies: plural(result.outdated, "ies", "y") })}`,
      result.advisories > 0
        ? `      ${pc.red(say("enrich.advisories", { n: result.advisories, ies: plural(result.advisories, "ies", "y") }))} ${say("enrich.affect", { n: result.vulnerablePackages, s: plural(result.vulnerablePackages) })}`
        : `      ${pc.green(say("enrich.noVulns"))}`,
      "",
    ]
      .filter(Boolean)
      .join("\n") + "\n",
  );

  return 0;
}

/**
 * Create an agent key and leave it plugged in.
 *
 * The key is printed only once because the catalog only stores its hash. What has changed is
 * everything else: before, a block of JSON was printed so that you would copy it by hand to the
 * correct place, and with `--install` it writes it itself into the `.mcp.json` in this folder,
 * merging it with whatever was already there. Copying and pasting configuration is exactly the
 * step where people leave it halfway, and it is also where other people's keys get lost.
 *
 * Where does the block come from and why does it no longer say `npx -y @panoma/mcp`, but `mcp.ts`.
 */
async function createAgentKey(api: string, name: string, install: boolean): Promise<number> {
  /*
    Before the key exists, and not after.
    `panoma hooks` already refuses under npx, and the reason written there —a file that outlives
    the copy that wrote it— is word for word this one: `--install` names the MCP server by its path
    on disk, and under npx that path is inside a cache npm may clear whenever it likes. The agent
    would then start without the tools and say nothing, because that is how MCP fails.
    The refusal goes ahead of the HTTP call on purpose. Refusing afterwards would leave the key
    issued and never used, which is the exact row that makes the bridge count an agent that is not
    there — the state this whole screen exists to name.
   */
  if (install) {
    const { efimero } = await panomaCommand();
    if (efimero) {
      process.stderr.write(
        `\n  ${pc.yellow(say("npx.mcpRefused"))}\n` +
          `  ${pc.dim(say("npx.mcpRefusedWhy"))}\n\n` +
          `  ${pc.cyan(say("npx.mcpRefusedHow"))}\n\n`,
      );
      return 1;
    }
  }

  let response: Response;
  try {
    response = await catalogFetch(new URL("/api/agent/keys", api), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind: guessAgentKind(name) }),
    });
  } catch {
    return unreachable(api);
  }

  if (!response.ok) {
    process.stderr.write(pc.red(`${say("open.httpError", { status: response.status })}\n`));
    return 1;
  }

  const agent = (await response.json()) as { id: string; name: string; apiKey: string };

  const { entry, aviso } = mcpEntry(api, agent.apiKey);

  const lines: string[] = [
    "",
    `  ${pc.green("\u2713")} ${say("agentKey.registered", { name: pc.bold(agent.name) })}`,
    "",
    `  ${pc.bold(say("agentKey.key"))} ${pc.dim(say("agentKey.onlyNow"))}`,
    `      ${pc.cyan(agent.apiKey)}`,
    "",
  ];

  const kind = guessAgentKind(name);

  if (install) {
    const done = await installFor(kind, entry, process.cwd());

    if (done.wrote) {
      const written = done.installed;
      lines.push(
        `  ${pc.green("✓")} ${say(written.created ? "mcp.written" : "mcp.merged", { path: pc.cyan(written.path) })}`,
      );
      if (written.replaced) {
        lines.push(pc.dim(`      ${say("mcp.updated")}`));
      }
      // Naming what was already there is the only way to show that it is still there.
      if (written.coexists.length > 0) {
        lines.push(pc.dim(`      ${say("mcp.coexists", { list: written.coexists.join(", ") })}`));
      }
      /*
        And the warning that can really cost someone money: the key that was just typed is in a
        file that git would take. In yellow and not in gray, because this is not a detail to
        report but something that must be done before the next commit.
       */
      if (written.exposedToGit) {
        lines.push(
          `  ${pc.yellow("!")} ${say("mcp.gitWarning", { name: relative(process.cwd(), written.path) })}`,
        );
      }
    } else {
      /*
        Nothing has been written, and it is said. Before, this path did not exist: Claude Code's
        `.mcp.json` was written for any agent and it was announced as a success.
       */
      lines.push(
        `  ${pc.yellow("!")} ${say(done.file ? "mcp.cannotWrite" : "mcp.unknownAgent", { path: done.file ?? "" })}`,
      );
      if (done.reason) lines.push(pc.dim(`      ${done.reason}`));
      lines.push("");
      lines.push(
        done.snippet
          .split("\n")
          .map((line: string) => `      ${pc.dim(line)}`)
          .join("\n"),
      );
    }
    lines.push("");
    lines.push(`  ${pc.dim(say("mcp.restart", { name }))}`);
  } else {
    const config = JSON.stringify({ mcpServers: { panoma: entry } }, null, 2);
    lines.push(`  ${pc.bold(say("mcp.configTitle"))}`);
    lines.push(
      config
        .split("\n")
        .map((line) => `      ${pc.dim(line)}`)
        .join("\n"),
    );
    lines.push("");
    lines.push(`  ${pc.dim(say("mcp.pasteIt"))}`);
  }

  if (aviso) {
    lines.push("");
    for (const line of aviso.split("\n")) lines.push(`  ${pc.yellow("!")} ${pc.dim(line)}`);
  }
  lines.push("");

  process.stdout.write(lines.join("\n"));

  return 0;
}

/**
 * Which tool it is, based on the name that the user wrote.
 *
 * Returns the `id` of the provider —the same one used by agent detection and the “Agents” page—
 * and not a proprietary vocabulary. Previously it returned `claude_code` where the website said
 * `claude-cli`, so connecting through both paths would leave **two records of the same agent**:
 * the terminal did not recognize the one from the web nor vice versa.
 *
 * And now it decides something more than a label: from this comes which file it is written in.
 */
function guessAgentKind(name: string): string {
  const lower = name.toLowerCase();
  /*
    "Claude Code" before "Claude": the first is the terminal agent and the second the desktop
    application, and here only agents connect.
   */
  if (lower.includes("claude")) return "claude-cli";
  if (lower.includes("cursor")) return "cursor-agent";
  if (lower.includes("codex")) return "codex-cli";
  if (lower.includes("copilot")) return "copilot-cli";
  if (lower.includes("gemini")) return "gemini-cli";
  return "custom";
}

/**
 * Ask the catalog to propose an update.
 *
 * The important thing about this command is what it **does not** do: it does not apply the change
 * in your folder, it does not push, and it does not open any PR. It leaves a branch with the patch
 * and tells you if the tests pass. Publishing is your decision, and for that, you have to look at
 * the diff.
 */
async function dispatchRun(
  api: string,
  slug: string,
  packageName: string | undefined,
  targetVersion: string | undefined,
  options: { security: boolean; force: boolean; isolation?: string },
  ): Promise<number> {
  process.stderr.write(
    pc.dim(`${say("run.isolating", { slug })}\n`),
  );

  let response: Response;
  try {
    response = await catalogFetch(new URL("/api/runs", api), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, packageName, targetVersion, ...options }),
    });
  } catch {
    return unreachable(api);
  }

  const result = (await response.json()) as {
    error?: string;
    hint?: string;
    skipped?: boolean;
    knownFailure?: { runId: string; summary: string; at: string };
    kind?: string;
    advisoryId?: string;
    isolation?: string;
    isolationNote?: string;
    runId?: string;
    status?: string;
    verified?: boolean;
    summary?: string;
    branch?: string;
    patch?: string;
    steps?: {
      name: string;
      command: string;
      exitCode: number | null;
      durationMs: number;
      output?: string;
    }[];
  };

  // A known flaw is not an error: it is a response with information.
  if (result.skipped && result.knownFailure) {
    process.stdout.write(
      [
        "",
        `  ${pc.yellow(pc.bold(say("run.alreadyFailed")))}`,
        `      ${result.knownFailure.summary}`,
        pc.dim(`      ${say("run.runId", { id: result.knownFailure.runId })}`),
        "",
        pc.dim(`      ${result.hint ?? ""}`),
        "",
      ].join("\n"),
    );
    return 0;
  }

  if (!response.ok || result.error) {
    process.stderr.write(pc.red(`${result.error ?? response.statusText}\n`));
    if (result.hint) process.stderr.write(pc.dim(`${result.hint}\n`));
    return 1;
  }

  const lines: string[] = [];
  if (result.kind === "vulnerability-fix") {
    lines.push("", `  ${pc.red(pc.bold(say("run.securityFix")))} ${pc.dim(result.advisoryId ?? "")}`);
  }
  const isoLabel: Record<string, string> = {
    container: pc.green(say("run.container")),
    /*
      Yellow and not cyan: `hardened` closes your personal folder where there is a system sandbox,
      but **never** the network, and the process is still yours. rendering it the color of the
      container suggested that they were two degrees of the same isolation; they are two different
      things, and the difference matters for reading a "verified".
      The exact phrase is set by the server in `isolationNote`, which knows if there was a sandbox
      or not; here only the short label goes.
     */
    hardened: pc.yellow(say("run.hardened")),
    local: pc.yellow(say("run.local")),
  };
  lines.push("", `  ${pc.bold(say("run.isolation"))}  ${isoLabel[result.isolation ?? "local"]}`);
  if (result.isolationNote) lines.push(pc.dim(`      ${result.isolationNote}`));
  lines.push("", `  ${pc.bold(say("run.steps"))}`);
  for (const step of result.steps ?? []) {
    const ok = step.exitCode === 0;
    const mark = ok ? pc.green("✓") : pc.red("✗");
    const time = step.durationMs > 0 ? pc.dim(` ${(step.durationMs / 1000).toFixed(1)}s`) : "";
    lines.push(`      ${mark} ${step.name.padEnd(18)}${pc.dim(step.command.slice(0, 60))}${time}`);
  }

  lines.push("");
  if (result.status === "proposed") {
    lines.push(
      `  ${
        result.verified
          ? pc.green(pc.bold(say("run.proposalVerified")))
          : pc.yellow(pc.bold(say("run.proposalUnverified")))
      }`,
    );
    lines.push(`      ${result.summary}`);
    lines.push(`      ${say("run.branch")} ${pc.cyan(result.branch ?? "")}`);
    lines.push("");
    lines.push(pc.dim(`      ${say("run.notApplied")}`));
    lines.push(pc.dim(`      ${say("run.reviewAt", { url: `${api}/runs/${result.runId ?? ""}` })}`));
  } else if (result.status === "no-changes") {
    lines.push(`  ${pc.dim(result.summary ?? say("run.nothingToChange"))}`);
  } else {
    lines.push(`  ${pc.red(pc.bold(say("run.failed")))}`);
    lines.push(`      ${result.summary}`);

    // Without the output of the step that failed, the message forces you to guess.
    const broken = result.steps?.find((step) => step.exitCode !== 0 && step.exitCode !== null);
    const tail = broken?.output?.trim().split("\n").slice(-12) ?? [];
    if (tail.length > 0) {
      lines.push("");
      lines.push(`  ${pc.dim(say("run.stepOutput", { step: broken?.name ?? "" }))}`);
      for (const line of tail) lines.push(pc.dim(`      ${line}`));
    }
  }
  lines.push("");

  process.stdout.write(lines.join("\n") + "\n");
  return result.status === "failed" ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    /*
      The trace goes after `PANOMA_DEBUG` and not in front of the message.
      The errors that arrive here are almost always for the user and not for the person who wrote
      the code — 'no provider configured,' 'the configuration cannot be read' — and starting with
      twenty lines of `at Object.<anonymous>` buries the sentence that says what to do. When the
      error is indeed a programming fault, the trace is still only an environment variable away.
     */
    const failure = error as Error;
    process.stderr.write(pc.red(`${failure.message ?? String(error)}\n`));
    if (process.env["PANOMA_DEBUG"] && failure.stack) {
      process.stderr.write(pc.dim(`${failure.stack}\n`));
    } else if (failure.stack) {
      process.stderr.write(pc.dim(`${say("cli.trace")}\n`));
    }
    process.exit(1);
  },
);
