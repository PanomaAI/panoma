/*
  The journey of someone who installs panoma and expects the catalog to open.

  Everything else in this repository tests the source. This tests the product: it takes `panoma`
  from the PATH —the binary npm just installed— and walks the promise from end to end, because the
  two can pass and fail separately. The packaged application is a compiled Next standalone, and
  its classic failure is that the HTML arrives and its static files do not: what the person sees
  is an unstyled skeleton, and no test of the source sees that.

  It runs the same on the three systems on purpose. What is being verified does not depend on the
  shell, and writing it in Node instead of a shell script is what allows Windows to be covered
  without a second copy that ages apart from this one.

  It needs PANOMA_HOME and PANOMA_SMOKE_PORT from whoever calls it, so that it never opens a real
  catalog.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PORT = process.env.PANOMA_SMOKE_PORT ?? "4188";
const API = `http://localhost:${PORT}`;
const HOME = process.env.PANOMA_HOME;
if (!HOME) throw new Error("PANOMA_HOME must be set: this must never open a real catalog.");

const results = [];
let failed = 0;

function check(name, fn) {
  try {
    const detail = fn();
    results.push(`  PASS  ${name}${detail ? ` · ${detail}` : ""}`);
  } catch (error) {
    failed += 1;
    results.push(`  FAIL  ${name} · ${error.message}`);
  }
}

/** `panoma` as the person who installed it runs it: by name, from the PATH. */
function panoma(args, options = {}) {
  const run = spawnSync("panoma", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: options.timeout ?? 180_000,
    env: { ...process.env, PANOMA_HOME: HOME },
  });
  return {
    code: run.status,
    out: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

async function get(path) {
  const response = await fetch(`${API}${path}`, { redirect: "manual" });
  const body = await response.text();
  return { status: response.status, body, type: response.headers.get("content-type") ?? "" };
}

/* ── A disk with something on it, because an empty catalog proves little ─────────────── */

const disk = join(tmpdir(), `panoma-smoke-disk-${process.pid}`);
rmSync(disk, { recursive: true, force: true });
const project = join(disk, "hello-catalog");
mkdirSync(project, { recursive: true });
writeFileSync(
  join(project, "package.json"),
  JSON.stringify({ name: "hello-catalog", version: "1.0.0", dependencies: { yaml: "^2.6.1" } }, null, 2),
);
writeFileSync(join(project, "README.md"), "# hello catalog\n\nA project that exists only to be found.\n");
try {
  const git = (args) => execFileSync("git", args, { cwd: project, stdio: "ignore" });
  git(["init", "-q"]);
  git(["config", "user.email", "smoke@example.com"]);
  git(["config", "user.name", "Smoke"]);
  git(["add", "-A"]);
  git(["commit", "-qm", "first"]);
} catch {
  /* Without git the project is still a project: the catalog says so with `no git`. */
}

/* ── The journey ────────────────────────────────────────────────────────────────────── */

console.log(`platform: ${process.platform}-${process.arch} · node ${process.version}`);
console.log(`home: ${HOME}\napi: ${API}\ndisk: ${disk}\n`);

const version = panoma(["--version"]);
check("panoma --version answers", () => {
  if (version.code !== 0) throw new Error(`exit ${version.code}: ${version.out.trim()}`);
  if (!/\d+\.\d+\.\d+/.test(version.out)) throw new Error(`no version in "${version.out.trim()}"`);
  return version.out.trim();
});

const scan = panoma(["scan", disk]);
console.log(`--- panoma scan ---\n${scan.out}\n`);
check("panoma scan finds the project", () => {
  if (scan.code !== 0) throw new Error(`exit ${scan.code}`);
  if (!scan.out.includes("hello-catalog") && !/\b1\b/.test(scan.out)) {
    throw new Error("the scanned project is not named in the output");
  }
  return "found";
});

/*
  `up <folder>` and not a bare `up`, because that is the promise that is being sold: `scan` says
  out loud that it saved nothing —"that was a taste"— and points here. Whoever installs panoma
  types this and expects to see their projects, not an empty catalog.
 */
const up = panoma(["up", disk, "--api", API]);
console.log(`--- panoma up ---\n${up.out}\n`);
check("panoma up starts the catalog", () => {
  if (up.code !== 0) throw new Error(`exit ${up.code}: ${up.out.trim()}`);
  return "up";
});

/* The server is already answering when `up` returns: it waits for it before printing. */
let home = { status: 0, body: "", type: "" };
let homeError = null;
try {
  home = await get("/");
} catch (error) {
  homeError = error.message;
}
check("GET / answers 200 with HTML", () => {
  if (homeError) throw new Error(homeError);
  if (home.status !== 200) throw new Error(`status ${home.status}`);
  if (!home.type.includes("text/html")) throw new Error(`content-type ${home.type}`);
  return `${home.body.length} bytes`;
});

check("the page is the catalog, not an error screen", () => {
  if (/Application error|Internal Server Error|__next_error__/i.test(home.body)) {
    throw new Error("the page rendered Next's error screen");
  }
  if (!/panoma/i.test(home.body)) throw new Error("the word panoma is not on the page");
  return "rendered";
});

/*
  The promise itself, and the only check that separates 'the server boots' from 'panoma works':
  the project that was on disk a minute ago has to be on the page, with its name.
 */
check("the scanned project is on the page", () => {
  if (!home.body.includes("hello-catalog")) {
    throw new Error("the catalog opened without the project that was just scanned");
  }
  return "hello-catalog is in the catalog";
});

/*
  The classic failure of a packaged Next: the HTML arrives and its static files do not, so what the
  person sees is an unstyled skeleton. Asking for the page is not enough — its assets must be asked
  for too.
 */
const assets = [...home.body.matchAll(/(?:href|src)="(\/_next\/[^"]+)"/g)].map((m) => m[1]);
const uniqueAssets = [...new Set(assets)].slice(0, 12);
const assetStatuses = [];
for (const asset of uniqueAssets) {
  try {
    const response = await get(asset);
    assetStatuses.push([asset, response.status]);
  } catch (error) {
    assetStatuses.push([asset, `error: ${error.message}`]);
  }
}
check("the static files of the packaged app are served", () => {
  if (uniqueAssets.length === 0) throw new Error("the page references no /_next/ asset");
  const broken = assetStatuses.filter(([, status]) => status !== 200);
  if (broken.length) throw new Error(`${broken.length} broken: ${broken.map(([a, s]) => `${a} → ${s}`).join(", ")}`);
  return `${assetStatuses.length} of ${assetStatuses.length} at 200`;
});

const routes = [
  ["/api/today", 200],
  ["/landing", 404],
  ["/docs", 404],
];
for (const [path, expected] of routes) {
  let observed;
  try {
    observed = (await get(path)).status;
  } catch (error) {
    observed = `error: ${error.message}`;
  }
  check(`${path} answers ${expected}`, () => {
    if (observed !== expected) throw new Error(`answered ${observed}`);
    return "";
  });
}

/*
  And the channel this whole product is built around: the MCP server actually starting.

  It never did. In every version published, the packaged server died while node was still
  evaluating it — `yaml` bundled as CommonJS into an ES module, and its interop shim looking for a
  `require` that is not there. Nothing caught it because nothing here ever started it: the journey
  walked the catalog, the CLI and the static files, and stopped at the door of the one piece that
  talks to agents.

  It cannot be caught anywhere else, either. An MCP server that fails to load is silent by
  construction — the agent comes up, its tool list is empty, and no error reaches the agent, the
  catalog or any screen. The only way to know is to run it, which is what this does.

  The path is not guessed: it is read from what `agent-key` prints, which is the very path the
  product hands to the agent. If that path is wrong, this fails too, and it should.
 */
const keyRun = panoma(["agent-key", "Smoke", "--api", API]);
/* Not `\S*`: the configuration is printed as JSON and that swallowed the opening quote. */
const mcpServer = (keyRun.out.match(/[^"'\s]*@panoma[/\\]mcp[/\\]dist[/\\]index\.js/) ?? [])[0];
const agentKey = (keyRun.out.match(/panoma_[A-Za-z0-9_-]{8,}/) ?? [])[0];

check("panoma agent-key names the MCP server on this disk", () => {
  if (keyRun.code !== 0) throw new Error(`exit ${keyRun.code}: ${keyRun.out.trim()}`);
  if (!mcpServer) throw new Error("the printed configuration names no @panoma/mcp server");
  if (!existsSync(mcpServer)) throw new Error(`it names a file that is not there: ${mcpServer}`);
  return mcpServer.split(/[\\/]/).slice(-4).join("/");
});

check("the MCP server starts instead of dying as it loads", () => {
  if (!mcpServer) throw new Error("no server to start");
  const run = spawnSync(process.execPath, [mcpServer], {
    encoding: "utf8",
    timeout: 30_000,
    /* Closing stdin at once: a stdio server with nothing to talk to leaves on its own. */
    input: "",
    env: { ...process.env, PANOMA_HOME: HOME, PANOMA_API: API, PANOMA_KEY: agentKey ?? "" },
  });
  /*
    Silence is the pass. This transport carries the protocol on stdout and nothing else belongs
    there, so anything printed at all — the load error included — is the failure.
   */
  const noise = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
  if (noise) throw new Error(noise.split("\n").slice(0, 2).join(" / "));
  return "silent, which is what a healthy stdio server is";
});

const down = panoma(["down"]);
console.log(`--- panoma down ---\n${down.out}\n`);
check("panoma down stops the catalog", () => {
  if (down.code !== 0) throw new Error(`exit ${down.code}: ${down.out.trim()}`);
  return "down";
});

let stopped = false;
try {
  await get("/");
} catch {
  stopped = true;
}
check("the catalog no longer answers after down", () => {
  if (!stopped) throw new Error("the port keeps answering");
  return "";
});

rmSync(disk, { recursive: true, force: true });

console.log("\n──────── the journey of someone who installs panoma ────────");
for (const line of results) console.log(line);
console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} FAILED`} · ${results.length} checks\n`);
process.exit(failed === 0 ? 0 : 1);
