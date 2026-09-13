/**
 * The addresses at which a project seems to be running on this machine right now, offered to
 * the production screen so a person picks one instead of typing it.
 *
 * Two signals, both measured and neither guessed. The first is the port the project's own
 * scripts declare — `next dev --port 4173`, `PORT=3000 node server`, `${PORT:-8080}` — checked
 * with an HTTP request to the loopback interface: a declared port that answers is the
 * product, whoever started it and from wherever. The second is any loopback listener whose
 * process runs from inside the project's folder, which catches a server started on a port the
 * scripts never wrote down; it asks `lsof`, so it says nothing on Windows and says so in
 * `docs/platforms.md`. The catalog's own owner was the first case on 13-Sep-2026: the
 * catalog runs from an npx cache, not from its repository, so only the declared port finds it.
 *
 * Read-only, and never more than a few hundred milliseconds: a screen that opens slowly
 * because it went looking for servers is worse than a field left to type in.
 */
import { execFile } from "node:child_process";
import { readdir, readFile, realpath } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { join, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type RunningAt = {
  url: string;
  /** `declared`: the port the project's scripts name answers. `folder`: a listener whose process runs from the project's folder. */
  why: "declared" | "folder";
};

/*
  Every way a script names its port that this repository and its neighbours have used. The
  number must be a real port, and `5000`-style numbers inside a version or a hash must not:
  each pattern is anchored on a port word, never on a bare number.
 */
const PORT_PATTERNS = [
  /(?:--port|-p)[= ]+(\d{2,5})\b/g,
  /\bPORT\s*[=:]\s*(\d{2,5})\b/g,
  /\$\{PORT:-(\d{2,5})\}/g,
  /(?:localhost|127\.0\.0\.1):(\d{2,5})\b/g,
];

/** The ports a set of scripts declares, once each, in the order they are met. */
export function declaredPorts(scripts: Record<string, unknown>): number[] {
  const found: number[] = [];
  for (const script of Object.values(scripts)) {
    if (typeof script !== "string") continue;
    for (const pattern of PORT_PATTERNS) {
      for (const match of script.matchAll(pattern)) {
        const port = Number(match[1]);
        if (port >= 1 && port <= 65535 && !found.includes(port)) found.push(port);
      }
    }
  }
  return found;
}

/** The `scripts` of the root package and of every package one workspace level down. */
export async function scriptsUnder(root: string): Promise<Record<string, unknown>> {
  const scripts: Record<string, unknown> = {};
  const take = async (file: string, prefix: string) => {
    try {
      const pkg = JSON.parse(await readFile(file, "utf8")) as { scripts?: Record<string, unknown> };
      for (const [name, script] of Object.entries(pkg.scripts ?? {})) scripts[`${prefix}${name}`] = script;
    } catch { /* No package there, or not JSON: nothing to declare. */ }
  };
  await take(join(root, "package.json"), "");
  for (const group of ["apps", "packages", "services", "sites"]) {
    let names: string[] = [];
    try { names = await readdir(join(root, group)); } catch { continue; }
    for (const name of names) {
      if (name.startsWith(".") || name === "node_modules") continue;
      await take(join(root, group, name, "package.json"), `${group}/${name}:`);
    }
  }
  return scripts;
}

/**
 * Whether something answers HTTP on the loopback interface at that port, within `ms`. HTTP and
 * not a bare TCP connection: a development server opens sockets beside its own — a hot-reload
 * channel, a database, a resolver on 53 — and the first cut of this offered five addresses for
 * one catalog, three of them nothing a browser could open. Any status is an answer; a server
 * that refuses HEAD says so with one.
 */
export function listening(port: number, ms = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const request = httpRequest({ host: "127.0.0.1", port, method: "HEAD", path: "/", timeout: ms }, (response) => {
      response.resume();
      resolve(true);
    });
    request.once("timeout", () => { request.destroy(); resolve(false); });
    request.once("error", () => resolve(false));
    request.end();
  });
}

/*
  `lsof -F` prints one field per line: `p<pid>`, then `n<address>` for each socket of that
  process. A listener bound to every interface shows as `*:4173`, one bound to loopback as
  `127.0.0.1:4173` or `[::1]:4173`; all of them answer at 127.0.0.1.
 */
export function listenersOf(lsofOutput: string): { pid: number; port: number }[] {
  const out: { pid: number; port: number }[] = [];
  let pid = 0;
  for (const line of lsofOutput.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid > 0) {
      const match = /:(\d{1,5})$/.exec(line.trim());
      if (match) out.push({ pid, port: Number(match[1]) });
    }
  }
  return out;
}

/** The folders of the given processes, by pid, or nothing where the system cannot say. */
async function foldersOf(pids: number[], exec: typeof run): Promise<Map<number, string>> {
  const folders = new Map<number, string>();
  if (!pids.length) return folders;
  try {
    const { stdout } = await exec("lsof", ["-a", "-p", pids.join(","), "-d", "cwd", "-F", "pn"], { timeout: 1_500 });
    let pid = 0;
    for (const line of stdout.split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      else if (line.startsWith("n") && pid > 0) folders.set(pid, line.slice(1).trim());
    }
  } catch { /* Fail forward: no folders, no second signal. */ }
  return folders;
}

const inside = (root: string, folder: string) => folder === root || folder.startsWith(root.endsWith(sep) ? root : root + sep);

/** Loopback listeners whose process runs from inside `root`: POSIX only, `lsof` asked with a short leash. */
export async function serversFromFolder(root: string, platform = process.platform, exec = run): Promise<number[]> {
  if (platform === "win32") return [];
  try {
    const real = await realpath(root).catch(() => root);
    const { stdout } = await exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn"], { timeout: 1_500 });
    const listeners = listenersOf(stdout);
    const folders = await foldersOf([...new Set(listeners.map((l) => l.pid))], exec);
    const ports: number[] = [];
    for (const { pid, port } of listeners) {
      const folder = folders.get(pid);
      if (folder && inside(real, folder) && !ports.includes(port)) ports.push(port);
    }
    return ports;
  } catch {
    return [];
  }
}

/**
 * The addresses to offer for a project, declared ports first, at most five, every one of them
 * answering right now. The ports are probed together, so the screen waits one leash, not one
 * per port.
 */
export async function runningAt(
  root: string,
  options: { platform?: NodeJS.Platform; exec?: typeof run; probe?: (port: number) => Promise<boolean> } = {},
): Promise<RunningAt[]> {
  const probe = options.probe ?? listening;
  const declared = declaredPorts(await scriptsUnder(root));
  const folder = (await serversFromFolder(root, options.platform ?? process.platform, options.exec ?? run)).filter((port) => !declared.includes(port));
  const candidates: (RunningAt & { port: number })[] = [
    ...declared.map((port) => ({ url: `http://127.0.0.1:${port}`, why: "declared" as const, port })),
    ...folder.map((port) => ({ url: `http://127.0.0.1:${port}`, why: "folder" as const, port })),
  ].slice(0, 12);
  const answers = await Promise.all(candidates.map((candidate) => probe(candidate.port)));
  return candidates.filter((_, index) => answers[index]).slice(0, 5).map(({ url, why }) => ({ url, why }));
}
