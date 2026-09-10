import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isNewerVersion, panomaPath } from "@panoma/core";

/**
 * Whether this catalog has something to say about its own version, and which of the two things.
 *
 * The terminal already says it —once a day, when you start— and that was enough while panoma was
 * something you typed. It stopped being enough the day `panoma up` became something you leave
 * running: the person who lives in the browser for three weeks never runs `panoma`, `scan` or `up`
 * again, and those three are the only commands that carry the notice
 * (`conAviso` in `apps/cli/src/index.ts`). So the screen that is open says it too.
 *
 * There are **two** truths here and they are not the same one:
 *
 * - **`restart`** — panoma has already been updated on this disk and this page is still being
 *   served by the process that was running before. It is the sharper of the two: it costs no
 *   network to know, it is acted on in ten seconds, and it is the state that `panoma up` already
 *   refuses to keep quiet about when you try to start a second one. Whoever has just run
 *   `npm i -g panoma@latest` gets exactly this.
 * - **`newer`** — the npm registry publishes a version later than the one running here. This is
 *   what the terminal says, read from the same file the terminal writes: nothing here asks anybody
 *   anything.
 *
 * When both are true, `restart` wins: telling someone to install what they have already installed
 * would be the notice being wrong at the one moment it finally mattered.
 *
 * **Nothing in this file goes out to the network**, and its test asserts that by reading the file.
 * The daily question stays where the doctrine put it, in the CLI, and this reads the answer.
 */

export type VersionNotice =
  | { kind: "restart"; running: string; installed: string }
  | { kind: "newer"; running: string; latest: string };

/**
 * The version of the panoma that is serving this page, or nothing.
 *
 * `panoma up` writes the seal `~/.panoma/web.json` as `{pid, version, api, node}` with the pid of
 * the process it spawns, and in the packaged path that process **is** this one: the CLI launches
 * `node <bundled server.js>` directly (`apps/cli/src/server.ts`, the `command`/`order` pair). So
 * `stamp.pid === process.pid` is not a heuristic, it is the question "does this seal describe me?"
 * asked exactly.
 *
 * And that gate is the whole design, because the seal is blind in ways that would otherwise make
 * this lie: it is written once and never refreshed, it survives a crash and a reboot, and inside
 * the repository the spawned process is `pnpm` and not the server, so the pid belongs to someone
 * else. Every one of those cases fails the comparison and this returns nothing, which is the house
 * rule for a notice: an unknown answer says nothing, never "I could not check".
 */
export async function runningVersion(): Promise<string | undefined> {
  try {
    const raw = await readFile(panomaPath("web.json"), "utf8");
    const stamp = JSON.parse(raw) as { pid?: number; version?: string };
    if (stamp.pid !== process.pid) return undefined;
    /* `JSON.stringify` drops the field when `cliVersion()` could not read the manifest. */
    return typeof stamp.version === "string" ? stamp.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where the package that contains this server lives, worked out once.
 *
 * The bundled server is started with its cwd at `<package>/app/apps/web` —a contract of
 * `panoma up`, not a guess— so three levels up is the package root. It is captured at load and
 * read afterwards by absolute path because npm **removes and recreates that directory** when it
 * installs a new version: asking `process.cwd()` again afterwards can throw on a directory that no
 * longer exists, and that is precisely the moment this feature exists for.
 */
const PACKAGE_ROOT = (() => {
  try {
    return resolve(process.cwd(), "..", "..", "..");
  } catch {
    return undefined;
  }
})();

/**
 * The version that is installed on the disk right now, which after an update is not the one that
 * is running.
 *
 * The manifest is only accepted when it is called `panoma` — the same guard `cliVersion()` uses on
 * the other side. It matters: the nearest manifest to the running server is `@panoma/web`, which
 * says `0.1.0` and always has, and comparing that against the registry would tell everybody they
 * are ten versions behind for ever.
 */
async function installedVersion(): Promise<string | undefined> {
  if (!PACKAGE_ROOT) return undefined;
  try {
    const raw = await readFile(resolve(PACKAGE_ROOT, "package.json"), "utf8");
    const manifest = JSON.parse(raw) as { name?: string; version?: string };
    if (manifest.name !== "panoma") return undefined;
    return typeof manifest.version === "string" ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The last thing the registry told the terminal, from the file the terminal keeps.
 *
 * Read on every call and not remembered: this server runs for weeks, so anything read once at
 * startup is what it would keep saying for ever. It is fifty bytes, next to the catalog query the
 * layout already makes.
 */
async function cachedLatest(): Promise<string | undefined> {
  try {
    const raw = await readFile(panomaPath("version.json"), "utf8");
    const memory = JSON.parse(raw) as { ultima?: string };
    return typeof memory.ultima === "string" ? memory.ultima : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The decision, apart from the three files it is made of.
 *
 * It is separated so it can be tested: the readers are the edge —a seal, a manifest and a cache,
 * each of which can be absent, stale or unreadable— and this is the sentence the screen shows.
 * Without the split, the branch that matters most would be the one no test could reach.
 */
export function composeNotice(input: {
  running?: string;
  installed?: string;
  latest?: string;
}): VersionNotice | undefined {
  const { running, installed, latest } = input;
  /* Not knowing what is running is the end of it: everything below is relative to that number. */
  if (!running) return undefined;

  if (installed && isNewerVersion(installed, running)) {
    return { kind: "restart", running, installed };
  }
  if (latest && isNewerVersion(latest, running)) {
    return { kind: "newer", running, latest };
  }
  return undefined;
}

export async function versionNotice(): Promise<VersionNotice | undefined> {
  const running = await runningVersion();
  /* The two remaining reads are skipped when there is nothing to compare them against. */
  if (!running) return undefined;

  /*
    `PANOMA_NO_UPDATE_CHECK=1` silences the news as well as the question. Somebody who sets that is
    not asking for a cheaper query, they are asking not to be told — and a notice served from an
    answer cached before they set it would go on nagging for ever, which is worse than the query
    they turned off. What survives is «you already updated, restart the catalog»: that one asks
    nobody anything, it is about something they did themselves, and it is the only one they can act
    on in ten seconds.
   */
  const quiet = process.env["PANOMA_NO_UPDATE_CHECK"] === "1";

  const [installed, latest] = await Promise.all([
    installedVersion(),
    quiet ? undefined : cachedLatest(),
  ]);
  return composeNotice({ running, installed, latest });
}
