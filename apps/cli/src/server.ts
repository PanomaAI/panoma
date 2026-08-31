import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, networkInterfaces, platform, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import pc from "picocolors";
import { say } from "./messages";
import {
  avisoDeFormato,
  ensureAccessKey,
  leaseIntruder,
  leasePath,
  panomaPath,
  pidAlive,
  POSTGRES_DEL_PAQUETE,
  readLeases,
  type AccessKey,
} from "@panoma/core";
import { cliEntry, monorepoRoot, runningFromNpx } from "./environment";
import { esperaPorTiempo } from "./wait";
import { bootPlan } from "./on-boot";
import { catalogProbe } from "./catalog-fetch";

const run = promisify(execFile);

/**
 * The catalog server: check it, start it, and stop it from CLI itself.
 *
 * Panoma wants to be the first thing you write in the morning, and so far the first thing you did
 * in the morning was open another terminal and start the web manually. A catalog that needs to be
 * set up before consulting it is not an entry to work: it is a preliminary procedure.
 */

/**
 * The catalog that travels inside the npm package.
 *
 * When installing from npm there is no monorepo to start `next dev` from, so the package comes
 * with the server already built: `dist/index.js` is this CLI and `app/apps/web/server.js` is the
 * catalog, siblings within the same package. Inside the repository that folder does not exist
 * —unless someone has run `build:app` — and the monorepo continues to be used, which is what
 * provides hot reloading.
 */
export function bundledServer(): string | undefined {
  const candidate = join(cliEntry(), "..", "..", "app", "apps", "web", "server.js");
  return existsSync(candidate) ? candidate : undefined;
}

/** Where is the trace of what `panoma up` tears away. */
export function logPath(): string {
  return panomaPath("logs", "web.log");
}

export function pidPath(): string {
  return panomaPath("web.pid");
}

/**
 * The server card that is running: who started it and with which version.
 *
 * It goes apart from `web.pid` and not inside in order not to change the format of a file that an
 * earlier version may have written — reading it has to continue working even if this process is
 * newer than the one that left it there.
 *
 * It exists due to a bug that would happen to **everyone on their first update**: npm replaces
 * `app/` in the same path while the old server is still alive. Then `panoma up` would see the
 * catalog responding, say 'it was already up,' and the user would remain on the previous version
 * convinced that they had updated. Even worse if the old server lazily loaded a chunk that is
 * already from the new build: 500 with no explanation.
 */
export function stampPath(): string {
  return panomaPath("web.json");
}

/** The version of this CLI, read from the manifest that travels alongside it. */
export function cliVersion(): string | undefined {
  for (const arriba of [["..", "package.json"], ["..", "..", "package.json"]]) {
    const candidate = join(cliEntry(), ...arriba);
    if (!existsSync(candidate)) continue;
    try {
      const meta = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string; version?: string };
      if (meta.name === "panoma" && meta.version) return meta.version;
    } catch {
      /* An illegible manifest is not a reason not to start. */
    }
  }
  return undefined;
}

/** What the `up` wrote down that started the server that is alive now. */
async function readStamp(): Promise<{ pid?: number; version?: string; api?: string } | undefined> {
  const raw = await readFile(stampPath(), "utf8").catch(() => undefined);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as { pid?: number; version?: string; api?: string };
  } catch {
    return undefined;
  }
}

/**
 * The same error path for all commands that talk to the catalog.
 *
 * Live here and not in `index.ts` because `index.ts` ends up calling `main()`: importing it from
 * another module would execute the entire CLI. It is the same reason why `args.ts` is a separate
 * file.
 *
 * The hint is no longer "start it with pnpm --filter...". With `panoma up` existing, sending
 * people to the monorepo's package manager was asking them to know where Panoma is installed in
 * order to use Panoma.
 */
export function unreachable(api: string): number {
  process.stderr.write(
    pc.red(`${say("server.unreachable", { api })}\n`) +
      pc.dim(`${say("server.startIt")}\n`),
  );
  return 1;
}

/**
 * Does the catalog respond?
 *
 * It asks about `/api/catalog` and not about the homepage on purpose: in Next development every
 * route compiles the first time it is requested, and the homepage drags half the application. A
 * route of API is the cheapest way to show that **the layer that uses CLI** is alive, which is
 * what matters here.
 */
export async function isAlive(api: string, ms = 2_000): Promise<boolean> {
  try {
    const reply = await catalogProbe(new URL("/api/catalog", api), {
      signal: AbortSignal.timeout(ms),
    });
    /*
      A 401 or a 403 is also being alive, and it goes without saying.
      With `panoma up --network` the catalog requests credentials from everyone. While this
      returned only `reply.ok`, the survey considered a server dead that in its own log said
      "Ready in 1242ms": sixty seconds of waiting, "did not respond," and the child dead
      afterwards. Whoever responds with the Panoma door **is** Panoma; whether it lets us in is
      another question, and this function does not do that.
     */
    return reply.ok || reply.status === 401 || reply.status === 403;
  } catch {
    return false;
  }
}

/**
 * Does *something* answer on that port that is not a healthy catalog?
 *
 * It is the missing question between 'is it alive' and 'is it free,' and the case that uncovered
 * it is the most common of all: any service listening on the wildcard. Our server binds to
 * `127.0.0.1`, so it **manages to start** —on macOS both coexist without `EADDRINUSE` — but the
 * probe asks `localhost`, which reaches the other one via `::1`. Result, before this: sixty
 * seconds of waiting to end up at 'the server did not respond' —the only thing that hadn't
 * happened— with our child alive and hidden behind the port. Asking before starting turns all of
 * that into a sentence in two seconds.
 *
 * It is only called when `isAlive` has already said no: if anything answers here, there is a
 * tenant and it is not a catalog that is useful.
 */
async function strangerOnPort(api: string, ms = 2_000): Promise<boolean> {
  try {
    await catalogProbe(new URL("/api/catalog", api), { signal: AbortSignal.timeout(ms) });
    return true;
  } catch {
    return false;
  }
}

/**
 * The processes that have this database open, taken from the output of `lsof -t`.
 *
 * Pure and exported to be able to test it: what comes in is a list of pids in lines, and what
 * comes out is the same list without ours and without duplicates —a server opens dozens of files
 * from the data directory and `lsof` gives one line for each one—.
 */
export function otherHolders(lsofOutput: string, ownPid: number = process.pid): number[] {
  const pids = new Set<number>();
  for (const line of lsofOutput.split("\n")) {
    const pid = Number(line.trim());
    if (Number.isInteger(pid) && pid > 0 && pid !== ownPid) pids.add(pid);
  }
  return [...pids].sort((a, b) => a - b);
}

/**
 * Is someone else with the data directory open?
 *
 * The seal (`web.json`) only knows about the servers that this command started, and that is its
 * blindness: a catalog raised with `pnpm --filter @panoma/web start`, with `next dev`, from an
 * editor's panel or from an agent does NOT leave a seal. So
 * `panoma up --api http://localhost:4174` did not see the one from 4173, it started up so calmly
 * on the SAME `~/.panoma/db`, and two writers corrupt it — which is exactly the accident that the
 * seal wanted to prevent.
 *
 * The operating system is asked instead of the stamp because the system does not depend on who
 * started anyone: if a process has that directory open, it has it. And by design it is the SAME
 * database, so a catalog from another `PANOMA_HOME` —the neighboring test database, for example— does
 * not get locked by mistake.
 *
 * Fails forward on purpose: without `lsof` (Windows) or if it takes time, it returns the empty
 * list and the startup continues as usual — there remains the lease note
 * (`db.lease.d/`), which is the network that does exist in all three systems. This is just one
 * more network, not
 * a new door: better to let it start than to prevent it out of ignorance.
 */
async function holdersOfDatabase(ms = 3_000): Promise<number[]> {
  const db = panomaPath("db");
  if (!existsSync(db)) return [];
  try {
    const { stdout } = await run("lsof", ["-t", "+D", db], { timeout: ms });
    return otherHolders(stdout);
  } catch (error) {
    return holdersFromFailure(error);
  }
}

/**
 * What can be read from a `lsof` that did not end well.
 *
 * Two failures that have nothing in common:
 *
 * - **It came out with 1 without writing anything.** It's like `lsof` says 'there is no one,' and
 * `execFile` treats it as an error anyway. There you do read whatever there is: the empty list is
 * the truth.
 * - **We killed it** for exceeding the limit. What it wrote is therefore cut off wherever it got
 * caught, and a PID could have been left half complete: «40874» read as «4087». That number parses
 * just as well and would name a process that doesn't exist, leaving the reader with nothing to
 * kill. From the outside, a truncated output is indistinguishable from a complete one, so the
 * cutoff is recognized by the signal and not by the content.
 *
 * Separated and exported because it is the decision, and a decision is tested.
 */
export function holdersFromFailure(error: unknown, ownPid: number = process.pid): number[] {
  const roto = error as { killed?: boolean; signal?: string | null; stdout?: unknown } | null;
  if (!roto || roto.killed || roto.signal) return [];
  return typeof roto.stdout === "string" ? otherHolders(roto.stdout, ownPid) : [];
}

/**
 * With what order was that process started, in order to be able to name it instead of just
 * numbering it.
 *
 * «pid 40874» does not tell anyone what to turn off; «pid 40874 · next-server» does. It's the same
 * machine that `couldStillBeOurs` already uses, and like everything from this guardian, silence is
 * a valid response: without `ps` the number is shown as is.
 */
async function commandOf(pid: number, ms = 4_000): Promise<string | undefined> {
  try {
    const { stdout } = await run("ps", ["-p", String(pid), "-o", "command="], { timeout: ms });
    return shortCommand(stdout);
  } catch {
    return undefined;
  }
}

/**
 * The order of `ps`, in a line that can be read.
 *
 * `ps` does not print the control characters: it writes them in octal, so a process started with
 * `node -e "…"` of multiple lines comes out with `\012` embedded. Blindly cutting that left the
 * message split in the middle of a quote. Those escapes and spaces are flattened, and if there is
 * still anything left, it is said to be left over instead of ending in the air.
 *
 * From the terminal, `safe-output.ts` already takes care, which filters escape sequences in the
 * output: this is just readability.
 */
export function shortCommand(psOutput: string, max = 60): string | undefined {
  const flat = psOutput
    .split("\n")[0]!
    .replace(/\\0\d\d/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flat === "") return undefined;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** It only makes sense to start a server that was going to run on this same machine. */
function isLocal(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"].includes(url.hostname);
}

export async function upCommand(
  api: string,
  onBoot: boolean,
  network: { enabled: boolean; rotate: boolean } = { enabled: false, rotate: false },
): Promise<number> {
  let url: URL;
  try {
    url = new URL(api);
  } catch {
    process.stderr.write(pc.red(`${say("server.badApi", { api })}\n`));
    return 1;
  }

  if (!isLocal(url)) {
    process.stderr.write(
      pc.red(`${say("server.notThisMachine", { host: url.host })}\n`) +
        pc.dim(`${say("server.remoteHint")}\n`),
    );
    return 1;
  }

  if (await isAlive(api)) {
    /*
      Alive, yes — but is it yours? After `npm i -g panoma@nuevo`, the process that responds is
      still the old one with the new files underneath. Saying 'it was already up' and keeping
      quiet is lying to someone who has just updated.
     */
    const stamp = await readStamp();
    const ahora = cliVersion();
    if (stamp?.version && ahora && stamp.version !== ahora) {
      process.stdout.write(
        `\n  ${pc.yellow("●")} ${say("server.staleVersion", {
          running: stamp.version,
          installed: ahora,
        })}\n` + pc.dim(`      ${say("server.staleVersionHint")}\n\n`),
      );
      return 1;
    }
    process.stdout.write(
      `\n  ${pc.green("●")} ${say("server.alreadyUp", { api: pc.cyan(api) })}\n\n`,
    );
    return onBoot ? installOnBoot(api) : 0;
  }

  /*
    First of all: does this database belong to this version?
    The server starts the same with an old-format catalog — Next comes up, the homepage responds —
    and it only crashes on the first request that touches the database. Since the polling waits
    for `/api/catalog` to respond properly, the user would spend **the full sixty seconds** ending
    up with 'the server did not respond,' with the real reason buried in the log. Reading a text
    file costs less than that.
   */
  // The port with a tenant is said now, not after sixty seconds of probing the other's.
  if (await strangerOnPort(api)) {
    process.stderr.write(
      `\n  ${pc.red(say("server.portBusy", { api }))}\n` +
        pc.dim(`      ${say("server.portBusyHint")}\n\n`),
    );
    return 1;
  }

  const formato = await avisoDeFormato();
  if (formato) {
    process.stderr.write(
      `\n  ${pc.red(say("server.oldDatabase", { written: formato.escrita, current: POSTGRES_DEL_PAQUETE }))}\n` +
        /*
          The following lines are indented the same as the first: a `\n` within the message pushes
          the text to the margin and breaks the column.
         */
        pc.dim(
          `      ${say("server.oldDatabaseHint", { path: formato.directorio }).replace(/\n/g, "\n      ")}\n\n`,
        ),
    );
    return 1;
  }

  /*
    And before starting a new one: is there another Panoma alive on ANOTHER port on this same
    database? PGlite does not lock its data directory —verified with 0.2: two servers on the same
    `~/.panoma/db` open and serve without a complaint — and two writers corrupt it. The comment
    that said otherwise was false.
   */
  const otro = await readStamp();
  if (otro?.pid && otro.api && otro.api !== api && (await couldStillBeOurs(otro.pid))) {
    process.stderr.write(
      `\n  ${pc.red(say("server.otherInstance", { api: otro.api, pid: otro.pid }))}\n` +
        pc.dim(`      ${say("server.otherInstanceHint")}\n\n`),
    );
    return 1;
  }

  /*
    And the same question to the operating system, for those who did not leave a mark.
    The seal only knows those that this command pulled out. The one next to it —raised with
    `pnpm start`, with `next dev`, from a panel or from an agent— nobody saw it, and that is the
    one that ends up opening the database for the second time.
   */
  for (const pid of await holdersOfDatabase()) {
    const command = await commandOf(pid);
    process.stderr.write(
      `\n  ${pc.red(say("server.databaseBusy", { who: command ? `pid ${pid} · ${command}` : `pid ${pid}` }))}\n` +
        pc.dim(`      ${say("server.databaseBusyHint", { db: panomaPath("db") })}\n\n`),
    );
    return 1;
  }

  /*
    And the lease note, which is the network that exists in the three systems.
    `lsof` is the most honest answer wherever it is — it even sees the one who didn't write
    anything — but in Windows it does not exist, and there the guardian would go completely blind.
    Every process that opens the database leaves its note (`db.lease.d/`, written in
    `openDatabase` ), so here it is enough to read it and check that its owner is still alive:
    that of a dead person is ignored, a stale lease cannot keep you out of your own catalog. The
    name comes from the note itself — in Windows there is no `ps` to ask.
   */
  const leased = leaseIntruder(readLeases(), process.pid, pidAlive);
  if (leased) {
    process.stderr.write(
      `\n  ${pc.red(say("server.databaseBusy", { who: leased.command ? `pid ${leased.pid} · ${leased.command}` : `pid ${leased.pid}` }))}\n` +
        pc.dim(`      ${say("server.databaseLeasedHint", { lease: leasePath(leased.pid) })}\n\n`),
    );
    return 1;
  }

  /*
    Two ways to load the same catalog, and the one inside the repository takes precedence.
    In the monorepo `next dev` is used, which recompiles on save: whoever is developing wants that
    and not a frozen copy. Outside —which is the case for everyone who arrives via `npx panoma` —
    the already built server that travels in the package is started.
    If there is none of the two, the message is still the same as before: it is that someone runs
    the CLI from a half-built copy.
   */
  const root = monorepoRoot();
  const bundled = root ? undefined : bundledServer();
  if (!root && !bundled) {
    process.stderr.write(
      pc.red(`${say("server.noMonorepo")}\n`) +
        pc.dim(`${say("server.noMonorepoHint", { entry: cliEntry() })}\n`),
    );
    return 1;
  }

  const log = logPath();
  await mkdir(join(log, ".."), { recursive: true });

  /*
    `next dev` and not `next start`: `start` requires a previous `next build`, and on the first
    day —just when it is most needed that this works without explanations— there is none. Since
    development writes in `.next-dev`, starting it also does not align with a production build.
    `next` is called directly instead of the script `dev` from the package because the port has to
    exit from `--api`: the script takes it fixed, and adding a second `--port` behind depends on
    which of the two the Next parser obeys.
   */
  const port = url.port || (url.protocol === "https:" ? "443" : "80");

  /*
    The local loop unless otherwise requested, and requesting it brings the key with it.
    The two things go on the same flag and cannot be separated on purpose: opening the port
    without a credential is exactly what left the catalog in view of the Wi-Fi. If the key could
    not be created, the port does not open — there is no path that ends in 'listening outside and
    with nothing to request'.
   */
  const host = network.enabled ? "0.0.0.0" : "127.0.0.1";
  const access = network.enabled ? await ensureAccessKey({ rotate: network.rotate }) : null;
  /*
    The built server does not accept flags: it reads `HOSTNAME` and `PORT` from the environment,
    which is the contract set by `server.js` itself that Next generates. That is why the port and
    host travel in two ways depending on who starts it.
   */
  const command = root ? "pnpm" : process.execPath;
  const order = root
    ? ["--filter", "@panoma/web", "exec", "next", "dev", "-H", host, "--port", port]
    : [bundled!];
  const cwd = root ?? join(bundled!, "..");

  /*
    And each path tells the truth about what is going to happen. "The first time it compiles" is
    true with `next dev` inside the repository, and false in the package: there the catalog is
    already built and it starts in less than a second. Promising a wait that does not arrive makes
    people go get coffee for nothing.
   */
  process.stderr.write(pc.dim(`${say(root ? "server.startingDev" : "server.starting")}\n`));

  /*
    Truly decoupled: `detached` takes it out of this group of processes —otherwise, closing the
    terminal where you typed `panoma up` would take the server down— and `unref` allows this
    process to finish without waiting for it. The output goes to a file and not to a `ignore`
    because when something doesn't start, the reason is right there.
   */
  const target = openSync(log, "a");
  const child = spawn(command, order, {
    cwd,
    detached: true,
    stdio: ["ignore", target, target],
    // The key travels through the child's environment and not through a file that the server reads:
    // the middleware runs in a diskless runtime, and so it is not written in the registry either.
    env: {
      ...process.env,
      ...(access
        ? { PANOMA_ACCESS_KEY: access.key, PANOMA_OPERATOR_KEY: access.operator }
        : {}),
      ...(root ? {} : { PORT: port, HOSTNAME: host }),
      /*
        And the catalog is told how it was started, because it spends the day telling people to
        type commands — «panoma enrich», «panoma twin», some thirty of them. Under npx every one
        of those is wrong advice, and a page that hands you a command that does not exist is worse
        than one that stays quiet.
       */
      ...(runningFromNpx() ? { PANOMA_EPHEMERAL: "1" } : {}),
    },
  });

  /*
    Without this listener, a `pnpm` that is not installed emits a `error` that no one listens to,
    and Node crashes the process with a trace — the style of failure that this CLI has made a
    point of not having. It is saved and looked at from the probe, so as not to wait sixty seconds
    for something we already know is not going to start.
   */
  let failure: Error | undefined;
  child.on("error", (error) => {
    failure = error;
  });

  /*
    And the other possible ending: that the son runs away and dies.
    The normal case is the port being occupied. The Next server tries once and exits immediately
    with `EADDRINUSE`, but without this listener nobody would have noticed: the probe kept asking
    the external service that does respond on that port for **the full sixty seconds**, only to
    end up saying 'the server did not respond,' which is the only thing that hadn’t actually
    happened. The failure occurred in the first second.
   */
  let died: number | undefined;
  child.on("exit", (code) => {
    died = code ?? 1;
  });
  child.unref();
  // The child already has its own copy of the descriptor; leaving it open here is useless.
  closeSync(target);

  if (child.pid === undefined) {
    process.stderr.write(pc.red(`${say("server.noPnpm")}\n`));
    return 1;
  }
  await writeFile(pidPath(), `${child.pid}\n`, "utf8");
  /*
    `node` is the interpreter of **who requested** the catalog — this CLI, on the user's terminal
    —, and it is saved for the MCP configurations that the website composes afterward. The server
    may be running under the internal runtime of any panel, with a path that names another tool
    and that disappears when that tool is updated; the user's node is theirs and stable. See
    `preferredNode` on the web.
   */
  await writeFile(
    stampPath(),
    `${JSON.stringify({ pid: child.pid, version: cliVersion(), api, node: process.execPath }, null, 2)}\n`,
    "utf8",
  );

  /*
    A dot every so often while the server is starting up.
    There is nothing to report here yet —the survey only asks— so the only honest thing that can
    be said is 'I'm still here.' It stops no matter what happens, even if the start fails, so as
    not to leave the line half-finished in front of the error.
   */
  const dejarDeEsperar = esperaPorTiempo();
  let alive: boolean;
  try {
    alive = await waitFor(api, 60_000, () => failure ?? died);
  } finally {
    dejarDeEsperar();
  }
  if (failure) {
    process.stderr.write(
      pc.red(`${say("server.pnpmFailed", { reason: failure.message })}\n`) +
        pc.dim(`${say("server.pnpmHint")}\n`),
    );
    return 1;
  }
  if (died !== undefined) {
    /*
      The process died. The useful part is not its exit code but what it wrote: the `EADDRINUSE`
      and its port are in the log, which no one was going to open. Read and show its last lines;
      if the port is the problem, say so in Spanish.
     */
    const cola = (await readFile(log, "utf8").catch(() => ""))
      .trimEnd()
      .split("\n")
      .slice(-8)
      .join("\n");
    const ocupado = /EADDRINUSE/.test(cola);
    process.stderr.write(
      pc.red(
        `\n  ${ocupado ? say("server.portBusy", { api }) : say("server.childDied", { code: died })}\n`,
      ) +
        (ocupado ? pc.dim(`      ${say("server.portBusyHint")}\n`) : "") +
        (cola ? pc.dim(`\n${cola.replace(/^/gm, "      ")}\n`) : "") +
        "\n",
    );
    return 1;
  }
  if (!alive) {
    /*
      Saying 'failed' and leaving it alive was the worst of both worlds: the user goes away
      believing there is no server, and the next `panoma up` finds the stamp and replies 'it was
      already up' about a process that nobody ever responded to. If the probe declares it dead, it
      is truly killed and its files are removed: the next attempt starts from scratch. SIGKILL and
      not SIGTERM, as in everything that could be blocked inside WASM.
      And to the **group** (`-pid`), not to the leader, which is what `downCommand` had already
      done and here had remained undone. What was kicked off is `pnpm`, which launches `next`,
      which launches its workers: the signal to the father left `next-server` listening —in
      `--network`, over the entire Wi-Fi— right after deleting their papers, so neither `down`
      could find it nor `up` could handle the port. Three orphans stayed like this on the same
      machine before seeing it.
     */
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {
        // It was already gone: even better.
      }
    }
    await rm(pidPath(), { force: true });
    await rm(stampPath(), { force: true });
    process.stderr.write(
      pc.red(`${say("server.timedOut")}\n`) +
        pc.dim(`${say("server.timedOutHint", { log })}\n`),
    );
    return 1;
  }

  /*
    If the port was left open to the network, it is said here and in yellow.
    `PANOMA_HOST` is the only way for Next to listen outside the local loop, so it's the only way
    to get to this. It is warned at startup and not in the documentation: whoever exported it
    three weeks ago to see the cover on the mobile does not remember, and what remains in sight
    are the keys to all their repositories.
   */

  process.stdout.write(
    [
      "",
      `  ${pc.green("●")} ${say("server.up", { api: pc.cyan(api) })}`,
      pc.dim(`      ${say("server.upDetail", { pid: child.pid ?? "?", log })}`),
      pc.dim(`      ${say("server.upStop")}`),
      /*
        The one place worth saying it: the catalog is open, the promise has been kept, and the
        reader is convinced. Dim and one line, after the address and not before it — nobody who
        just typed a command wants to be sold the next one first.
       */
      ...(runningFromNpx() ? [pc.dim(`      ${say("npx.upEphemeral")}`)] : []),
      ...(access ? networkLines(access, port) : []),
      "",
      "",
    ].join("\n"),
  );

  return onBoot ? installOnBoot(api) : 0;
}

/** Probe until it responds, the time runs out, or it is known that it is not going to start. */
async function waitFor(
  api: string,
  ceilingMs: number,
  giveUp?: () => unknown,
): Promise<boolean> {
  const limit = Date.now() + ceilingMs;
  while (Date.now() < limit) {
    if (giveUp?.()) return false;
    if (await isAlive(api, 5_000)) return true;
    await new Promise((ready) => setTimeout(ready, 1_000));
  }
  return false;
}

export async function downCommand(api: string): Promise<number> {
  const file = pidPath();
  const raw = await readFile(file, "utf8").catch(() => undefined);
  const pid = Number.parseInt(raw?.trim() ?? "", 10);

  if (!raw || !Number.isInteger(pid) || pid <= 1) {
    process.stdout.write(`\n  ${pc.dim(say("server.none"))}\n`);
    // The fact that we didn't pull it out doesn't mean that nothing is listening, and silencing it
    // would leave the one who just asked 'stop it' believing that they are.
    if (await isAlive(api)) {
      process.stdout.write(
        `  ${pc.yellow(say("server.somethingElse"))} ${pc.cyan(api)}${pc.yellow(":")} ${pc.dim(say("server.somethingElseHint"))}\n`,
      );
    }
    process.stdout.write("\n");
    return 0;
  }

  if (!(await couldStillBeOurs(pid))) {
    await rm(file, { force: true });
    await rm(stampPath(), { force: true });
    process.stdout.write(`\n  ${pc.dim(say("server.gone", { pid }))}\n`);
    /*
      The same courtesy as the branch above, which was missing here.
      A `up` on another port overwrites the pid, so the one remaining pointing may be dead while
      the catalog is actually still alive. Without this, `down` would delete the file, say 'the
      process is no longer there,' and the user would leave convinced that they had stopped it.
     */
    if (await isAlive(api)) {
      process.stdout.write(
        `  ${pc.yellow(say("server.somethingElse"))} ${pc.cyan(api)}${pc.yellow(":")} ${pc.dim(say("server.somethingElseHint"))}\n`,
      );
    }
    process.stdout.write("\n");
    return 0;
  }

  /*
    The **group** (`-pid`) is killed and not just the pid: what was killed is `pnpm`, which in
    turn launches `next`, which launches its workers. A signal to the parent leaves the server
    alive listening on the port, which is exactly the failure that makes one think `down` does not
    work. `detached: true` at startup is what turns the child into the leader of its group and
    makes this possible.
   */
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // It died between the check and the signal. That is fine: it was the goal.
    }
  }

  const limit = Date.now() + 10_000;
  while (Date.now() < limit && (await isAlive(api, 1_000))) {
    await new Promise((ready) => setTimeout(ready, 500));
  }

  await rm(file, { force: true });
  await rm(stampPath(), { force: true });
  process.stdout.write(`\n  ${pc.green("✓")} ${say("server.stopped", { pid })}\n\n`);
  return 0;
}

/**
 * Is that PID still the server we started?
 *
 * The pids are recycled. An old file pointing to a number that today is someone else’s editor
 * turns `panoma down` into "kills something at random," so besides existing, the process has to
 * resemble what we started. `ps` is not everywhere; if it cannot be queried, just move on, which
 * is what any pid file does.
 */
async function couldStillBeOurs(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }

  try {
    const { stdout } = await run("ps", ["-p", String(pid), "-o", "command="], {
      timeout: 4_000,
    });
    const line = stdout.trim().toLowerCase();
    if (!line) return false;
    return line.includes("next") || line.includes("pnpm") || line.includes("panoma");
  } catch {
    return true;
  }
}

/**
 * Leave the catalog opened when logging in.
 *
 * The LaunchAgent does not start Next: `panoma up` starts, which already knows how to check if it
 * is needed, where to write the log, and which pid to keep. Duplicating that logic in an XML
 * —which nobody is going to maintain and that cannot be tested— would be having two versions of
 * the same decision, and the XML one would age on its own.
 */
async function installOnBoot(api: string): Promise<number> {
  const root = monorepoRoot();
  const entry = cliEntry();
  /*
    The three systems execute this without your shell, so a `.ts` is useless: the input has to be
    built JavaScript. If only the source exists, it says what is missing instead of installing a
    service that will fail silently every time you log in.
   */
  const built = root ? join(root, "apps", "cli", "dist", "index.js") : undefined;
  const program = entry.endsWith(".js") ? entry : built;
  if (!program || !existsSync(program)) {
    process.stderr.write(
      pc.red(`${say("server.bootNeedsBuild")}\n`) +
        pc.dim(`${say("server.bootNeedsBuildHint")}\n`),
    );
    return 1;
  }

  const plan = bootPlan({
    platform: platform(),
    node: process.execPath,
    program,
    api,
    log: logPath(),
    home: homedir(),
    path: process.env["PATH"] ?? "/usr/bin:/bin",
    root,
    uid: userInfo().uid,
    panomaHome: panomaPath(),
  });

  if (!plan) {
    process.stderr.write(
      pc.yellow(`${say("server.bootUnsupported", { platform: platform() })}\n`) +
        pc.dim(`${say("server.bootUnsupportedHint")}\n`),
    );
    return 1;
  }

  await mkdir(dirname(plan.file), { recursive: true });
  await writeFile(plan.file, plan.content, "utf8");

  // The previous thing cleans whatever there was and it doesn't matter if it fails: almost always
  // there was nothing.
  for (const step of plan.before) {
    await run(step.command, step.args, { timeout: 10_000 }).catch(() => undefined);
  }

  let failed: string | undefined;
  for (const step of plan.activate) {
    try {
      await run(step.command, step.args, { timeout: 20_000 });
      continue;
    } catch {
      if (!step.fallback) {
        failed = [step.command, ...step.args].join(" ");
        break;
      }
    }
    try {
      await run(step.fallback.command, step.fallback.args, { timeout: 20_000 });
    } catch {
      failed = [step.fallback.command, ...step.fallback.args].join(" ");
      break;
    }
  }

  process.stdout.write(
    [
      "",
      `  ${pc.green("✓")} ${say("server.bootInstalled")}`,
      pc.dim(`      ${plan.file}`),
      failed ? pc.yellow(`      ${say("server.bootNotLoaded", { command: failed })}`) : "",
      pc.dim(`      ${say("server.bootLog")} ${plan.where}`),
      pc.dim(`      ${say("server.bootRemove")} ${plan.remove}`),
      "",
      "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  );
  return failed ? 1 : 0;
}

/**
 * The link that opens Panoma from the mobile, with the key inside.
 *
 * It is printed whole and only once: it is more convenient than dictating sixty-four characters,
 * and when the server opens it, it saves it in a cookie and removes it from the bar. Whoever wants
 * it again restarts with `--network`, which does not rotate the key if it already exists.
 *
 * It comes with the warning of what it means to have it open, because the link by itself reads as
 * a convenience and this is a decision.
 */
function networkLines(access: AccessKey, port: string): string[] {
  const address = lanAddress();
  /*
    The one at home has both keys; the one on the network, only the viewing key.
    It's the whole difference between watching and commanding, and that's why the mobile link can
    be leaked without anyone putting this machine to compile. The second key doesn't come from
    here or from `~/.panoma/access.json`, and both ways require being in front of the keyboard.
   */
  const here = `http://localhost:${port}/?key=${access.key}&op=${access.operator}`;
  const there = `http://${address ?? "TU-IP"}:${port}/?key=${access.key}`;
  /* Labels at the same width so that both links start in the same column. */
  const width = Math.max(say("server.networkHere").length, say("server.networkThere").length);
  return [
    "",
    `  ${pc.yellow("!")} ${pc.yellow(say("server.networkOpen"))}`,
    pc.dim(`      ${say("server.networkHint")}`),
    "",
    `      ${pc.dim(say("server.networkHere").padEnd(width))}  ${pc.cyan(here)}`,
    `      ${pc.dim(say("server.networkThere").padEnd(width))}  ${pc.cyan(there)}`,
    "",
    pc.dim(`      ${say("server.networkLocalToo")}`),
    pc.dim(`      ${say("server.networkOperator")}`),
    /*
      And the consequence of leave, which is the only one that no one sees coming.
      With the catalog in `localhost`, AGPL asks for nothing: a single user, nothing is
      transmitted. `--network` changes exactly that — its §13 requires offering the code to anyone
      who uses the program over a network, and whoever opens the link from the mobile is exactly
      that. For Panoma without modifying, the obligation is fulfilled on its own because the
      sidebar links to the source; for someone who patched it, it does not. It is said here
      because it is the only moment when someone is deciding to open it.
     */
    "",
    pc.dim(`      ${say("server.networkLicence").replace(/\n/g, "\n      ")}`),
  ];
}

/**
 * The IP of this machine on its local network.
 *
 * The first IPv4 that is not internal is sought. If there is none — no network, or only IPv6 —
 * `TU-IP` is printed in its place instead of making one up: a link that does not work is worse
 * than a visible gap.
 */
function lanAddress(): string | undefined {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return undefined;
}
