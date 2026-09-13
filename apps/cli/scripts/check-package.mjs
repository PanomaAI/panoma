#!/usr/bin/env node
/**
 * Refuses to package a `panoma` that would not start, or that is not the one you expect.
 *
 * It runs on `prepack`, so it is valid for `npm pack` and `npm publish`. It exists because the bug
 * it prevents is not seen when publishing: the package uploads, installs without complaint, and
 * crashes the first time someone writes `panoma up`. By then the version is already in the
 * registry and cannot be replaced, only published over with another.
 *
 * Check three different things, and all three have really failed at some point:
 *
 * 1. **Let the pieces be there.** A package without the server inside installs the same.
 * 2. **That `app/` be from now.** `app/` is in `.gitignore`, so `npm publish` uploads whatever is
 * on the disk that day, coming from wherever it comes. That’s how `drizzle-orm` 0.38.4 got through
 * once —the version with the SQL injection— from an old device: there was no error, there was a
 * stale directory. The commit and the hash of the lockfile from when it was built are compared
 * with the current ones.
 * 3. **Do not let travel what should not.** Build traces, single-platform binaries, environment
 * files, and the absolute path of the laptop of whoever compiled it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(cli, "..", "..");
const app = join(cli, "app");

const problems = [];

function flag(title, detail, fix) {
  problems.push({ title, detail, fix });
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/* ── 1. The pieces ────────────────────────────────────────────────────────── */

const requirements = [
  ["dist/index.js", "the CLI", "pnpm --filter panoma run build"],
  ["app/apps/web/server.js", "the catalog server", "pnpm --filter panoma run build:app"],
  ["app/apps/web/.next-bundle/static", "the web's static assets", "pnpm --filter panoma run build:app"],
  ["app/node_modules/next", "Next", "pnpm --filter panoma run build:app"],
  ["app/node_modules/@panoma/core/dist", "the core", "pnpm -r build && pnpm --filter panoma run build:app"],
  ["app/node_modules/@panoma/db/migrations", "the migrations", "pnpm --filter panoma run build:app"],
  ["app/node_modules/@panoma/mcp/dist/index.js", "the MCP server", "pnpm --filter panoma run build:app"],
  ["app/node_modules/@panoma/apps/dist/index.js", "the app manager", "pnpm --filter @panoma/apps build && pnpm --filter panoma run build:app"],
  ["app/node_modules/@panoma/handoff/dist/index.js", "the handoff engine", "pnpm --filter @panoma/handoff build && pnpm --filter panoma run build:app"],
  ["app/apps/web/.next-bundle/server/app/api/apps/route.js", "the apps API", "pnpm --filter panoma run build:app"],
  ["app/node_modules/@electric-sql/pglite/dist", "the database", "pnpm --filter panoma run build:app"],
  ["THIRD-PARTY-NOTICES.md", "the third-party license notices", "pnpm --filter panoma run build:app"],
];

const missing = requirements.filter(([path]) => !existsSync(join(cli, path)));
if (missing.length > 0) {
  flag(
    `Missing: ${missing.map(([, what]) => what).join(", ")}`,
    "A package like that installs without complaint and fails on the machine of whoever downloads it.",
    [...new Set(missing.map(([, , how]) => how))].join("\n    "),
  );
}

/*
  And that the MCP server STARTS, which is not the same as being there.

  The requirement above has checked the file since it was written, and the file was there in every
  one of the seven published versions in which the server was dead on arrival: an ESM bundle
  importing a CJS-only `yaml`, which throws while loading. Nothing caught it, because that is how
  MCP fails — an agent whose server does not start simply comes up without the tools and says
  nothing, on any screen, ever.

  So it is started here and asked the first question of the protocol. The catalog is not needed and
  must not be: `PANOMA_API` points at a closed port on purpose, so that a server which reached for
  the network before answering would fail here rather than on someone's machine. Twenty seconds is
  far more than the answer takes (measured: well under one), and it is a ceiling, not a wait.
 */
const mcpServer = join(app, "node_modules", "@panoma", "mcp", "dist", "index.js");
if (existsSync(mcpServer)) {
  const greeting =
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "panoma-prepack", version: "0" },
      },
    }) + "\n";
  const launch = spawnSync(process.execPath, [mcpServer], {
    input: greeting,
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, PANOMA_API: "http://127.0.0.1:1", PANOMA_KEY: "" },
  });
  const answered = launch.status === 0 && /"serverInfo"/.test(launch.stdout ?? "");
  if (!answered) {
    const reason =
      launch.error?.message ??
      (launch.signal ? `killed by signal ${launch.signal}` : (launch.stderr ?? "").trim().split("\n")[0]) ??
      "it did not answer the protocol's greeting";
    flag(
      "The MCP server travels but does not start",
      `It installs all the same and the agent comes up without tools, without saying a word:\n    ${reason || "it did not answer the protocol's greeting"}`,
      "pnpm --filter @panoma/mcp build && pnpm --filter panoma run build:app",
    );
  }
}

/*
  App management has two runtime boundaries: the external package and the Next route containing
  the stdio MCP client. Import both from the packaged tree, without opening a catalog or starting
  an app. A file-existence check would miss absent zod/AJV dependencies or broken CJS interop.
 */
const appManager = join(app, "node_modules", "@panoma", "apps", "dist", "index.js");
const appsRoute = join(app, "apps", "web", ".next-bundle", "server", "app", "api", "apps", "route.js");
if (existsSync(appManager) && existsSync(appsRoute)) {
  const smoke = spawnSync(process.execPath, ["--input-type=module", "--eval", [
    'import { pathToFileURL } from "node:url";',
    'const manager = await import(pathToFileURL(process.argv[1]).href);',
    'if (!manager.OFFICIAL.some(app => app.id === "panoma-video")) throw new Error("official app missing");',
    'await import(pathToFileURL(process.argv[2]).href);',
  ].join("\n"), appManager, appsRoute], {
    cwd: app, encoding: "utf8", timeout: 20_000,
    env: { ...process.env, PANOMA_NO_UPDATE_CHECK: "1" },
  });
  if (smoke.status !== 0) {
    flag(
      "The packaged app manager or MCP client cannot load",
      smoke.error?.message ?? (smoke.stderr ?? "").trim().slice(0, 2_000),
      "pnpm --filter @panoma/apps build && pnpm --filter panoma run build:app",
    );
  }
}

/*
  And that this file says something.
  Simply existing was not enough: it existed for weeks with 21 of its 29 entries as 'undeclared,'
  which is worse than not existing — it puts in writing that we redistribute code without knowing
  under what conditions. This is checked here as well as in the generator because this file is
  committed, and `npm publish` publishes what is on the disk, not what the last build produced.
 */
const thirdPartyNotices = existsSync(join(cli, "THIRD-PARTY-NOTICES.md"))
  ? readFileSync(join(cli, "THIRD-PARTY-NOTICES.md"), "utf8").split("\n")
  : [];
const summaryEntries = thirdPartyNotices.filter((line) => /^- \S+ — /.test(line));
const silent = summaryEntries.filter((line) => /sin declarar|desconocida|unknown/i.test(line));
if (silent.length > 0) {
  flag(
    `Entries with no declared license in THIRD-PARTY-NOTICES.md: ${silent.length}`,
    `A notice that admits not knowing what it distributes does not do its job:\n    ` +
      silent.slice(0, 5).map((l) => l.trim()).join("\n    "),
    "pnpm --filter panoma run build:app",
  );
}

/*
  Announced copyleft: the LGPL and the MPL are not complied with just by naming them. This slipped
  through once, and on top of that being false: `@img/sharp-libvips-darwin-arm64` appeared in the
  summary without traveling in the package, because pruning deleted the folder and not the keys
  with scope.
 */
const copyleft = summaryEntries.filter((line) =>
  / — (A?GPL|LGPL|MPL|EPL|CDDL|CECILL|OSL|EUPL)/i.test(line),
);
if (copyleft.length > 0) {
  flag(
    `Copyleft announced in THIRD-PARTY-NOTICES.md: ${copyleft.length}`,
    `They demand their full text, and the LGPL on top of that the ability to replace the library:\n    ` +
      copyleft.map((l) => l.trim()).join("\n    "),
    "either it gets pruned in pack-app.mjs, or the whole job gets done",
  );
}

/*
  And the pages, which until now nobody looked at.
  The requirements above check the engine —the server, Next, the database, the migrations— but not
  a single one looks at what pages exist inside. And that's where the two symmetrical errors fit,
  the two silent ones:
  · Let public site travel. `build-app.mjs` sets it aside by the name of its folder, and that name
  has already changed once. If it changes again, the sales page is published within the product
  and no one complains: it is 2.2 MB out of 174, so the weight limit below doesn’t even notice. ·
  Do NOT let the catalog travel. Setting aside the wrong group gives a package that installs,
  starts, and declares itself healthy —the probe checks for `/api/catalog`, never for the cover—
  until someone opens `/` and encounters a factory 404.
  It is checked against the manifest of routes, whose values are the URL with the groups already
  removed: this way it does not depend on what the group is called next year.
 */
const packageRoutes = Object.values(
  readJson(join(app, "apps", "web", ".next-bundle", "app-path-routes-manifest.json")) ?? {},
);
if (packageRoutes.length === 0) {
  flag(
    "The package does not carry the routes manifest",
    "Without it there is no way to know which pages travel inside.",
    "pnpm --filter panoma run build:app",
  );
} else {
  const publicRoutes = packageRoutes.filter((route) => route === "/landing" || route === "/docs");
  const pages = packageRoutes.filter((route) => !route.startsWith("/api"));
  if (publicRoutes.length > 0) {
    flag(
      `The public site travelled inside the package: ${publicRoutes.join(", ")}`,
      "It is the sales page, served from the localhost of someone who already installed panoma.",
      "the public site lives in apps/site: apps/web must not have those routes",
    );
  }
  if (!packageRoutes.includes("/")) {
    flag(
      "The package does not carry the catalog's front page",
      "It installs, starts and declares itself healthy; then it serves a factory 404 at `/`.",
      "apps/web/app/(app)/page.tsx is missing, or next build never got as far as compiling it",
    );
  }
  if (pages.length < 12) {
    flag(
      `Too few pages inside the package: ${pages.length}`,
      "Today there are 20, not counting /api. So few means half the application is missing.",
      "pnpm --filter panoma run build:app, and look at whether next build complained",
    );
  }
}

/* ── 2. Freshness ─────────────────────────────────────────────────────────── */

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

const info = readJson(join(app, "BUILD-INFO.json"));
if (!info) {
  flag(
    "The app/ does not say where it came from",
    "Without BUILD-INFO.json there is no way to know whether it is from this commit or from three weeks ago.",
    "pnpm --filter panoma run build:app",
  );
} else {
  const commitNow = git("rev-parse", "HEAD");
  const lockNow = existsSync(join(root, "pnpm-lock.yaml"))
    ? createHash("sha256").update(readFileSync(join(root, "pnpm-lock.yaml"))).digest("hex")
    : undefined;
  const versionNow = readJson(join(cli, "package.json"))?.version;

  if (commitNow && info.commit && info.commit !== commitNow) {
    flag(
      "The app/ was built on another commit",
      `Built on ${info.commit.slice(0, 7)}, you are on ${commitNow.slice(0, 7)}.\n` +
        `    The package would carry code that is not this tree's.`,
      "pnpm -r build && pnpm --filter panoma run build:app",
    );
  }
  if (lockNow && info.lockfile && info.lockfile !== lockNow) {
    flag(
      "The lockfile changed after the app/ was built",
      "The versions travelling inside are no longer the ones this tree declares.",
      "pnpm install --frozen-lockfile && pnpm --filter panoma run build:app",
    );
  }
  if (versionNow && info.version && info.version !== versionNow) {
    flag(
      `The app/ was built for version ${info.version} and the manifest says ${versionNow}`,
      "You would publish one version number with the contents of another.",
      "pnpm --filter panoma run build:app",
    );
  }
  /*
    The dirty tree is an error and not a warning: if what is being shipped is not in any commit,
    no one can reproduce the tarball or know what was published. The emergency output exists to
    test locally—package and install without having committed yet—and it is called by its name on
    purpose, so that it doesn't sneak into a release by mistake.
   */
  if (info.arbolLimpio === false && process.env["PANOMA_PACK_SUCIO"] !== "1") {
    flag(
      "The app/ was built with uncommitted changes",
      "What travels inside is in no commit, so it cannot be reproduced.\n" +
        "    For a local test:  PANOMA_PACK_SUCIO=1 npm pack",
      "commit or discard, and go back to: pnpm --filter panoma run build:app",
    );
  }
}

/*
  The 2% that does not travel frozen.
  The whole pitch of the package is 'all in, no network after installation' — but the five
  dependencies of manifest are resolved with `^` ranges **on the user's machine, the day they
  install**. A compromised release of `yaml` or SDK from Anthropic would land in every new
  installation: exactly the vector we saved ourselves by not having `postinstall`, coming in
  through the other door.
  `npm-shrinkwrap.json` is the standard mechanism for this and npm respects it in the installed
  package (unlike `package-lock.json`, which it ignores). Here it is only checked that it hasn't
  gone bad: if the manifest asks for a version that the shrinkwrap doesn't lock, or locks a
  different one from what pnpm resolved, it means someone tampered with one and not the other.
 */
const shrink = readJson(join(cli, "npm-shrinkwrap.json"));
if (!shrink) {
  flag(
    "There is no npm-shrinkwrap.json",
    "Without it, the manifest's dependencies are resolved with ^ on the user's machine.",
    "generate it with: npm install --package-lock-only  (and rename it)",
  );
} else {
  const manifest = readJson(join(cli, "package.json")) ?? {};
  const pinned = new Map(
    Object.entries(shrink.packages ?? {})
      .filter(([path]) => path.startsWith("node_modules/"))
      .map(([path, meta]) => [path.slice("node_modules/".length), meta.version]),
  );

  /* And against what the monorepo really resolved, which is what it was tested with. */
  const mismatches = [];
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    const inShrinkwrap = pinned.get(dep);
    if (!inShrinkwrap) {
      mismatches.push(`${dep}: the shrinkwrap does not pin it`);
      continue;
    }
    const real = readJson(join(root, "node_modules", dep, "package.json"))?.version;
    if (real && real !== inShrinkwrap) {
      mismatches.push(`${dep}: shrinkwrap ${inShrinkwrap}, installed ${real}`);
    }
  }
  if (mismatches.length > 0) {
    flag(
      "The npm-shrinkwrap.json does not square with the dependencies",
      mismatches.join("\n    "),
      "regenerate it: npm install --package-lock-only  (and rename it to npm-shrinkwrap.json)",
    );
  }

  /*
    And its own version, which is the number the document promised was watched and was not.

    The file carries the package's version twice —`version` and `packages[""].version`— and it is
    regenerated by hand, so a release that only bumps `package.json` leaves it behind without a
    word: `panoma@0.1.10` was packaged on 6-Sep-2026 carrying a shrinkwrap that still said
    `0.1.9`, and nothing anywhere said so. [release.md](../../docs/release.md) already claimed
    that `prepack` refuses when the two drift apart. Now it does.
   */
  const packageVersion = readJson(join(cli, "package.json"))?.version;
  const inShrinkwrap = [shrink.version, shrink.packages?.[""]?.version];
  if (packageVersion && inShrinkwrap.some((v) => v !== packageVersion)) {
    flag(
      `The npm-shrinkwrap.json says ${inShrinkwrap.join(" and ")} and the package is ${packageVersion}`,
      "It is regenerated by hand, so a new version leaves it behind without complaint.",
      `put ${packageVersion} in "version" and in packages[""].version of apps/cli/npm-shrinkwrap.json`,
    );
  }

  /*
    And to really travel, which is different from being here next door.
    `files` is a whitelist, and npm **does not** add the shrinkwrap on its own. Measured on August
    28, 2026 with npm 11.19.0, in a three-file package made separately to isolate it: with
    `files: ["dist"]` the tarball comes out without it; naming it, it is included. Here it had
    been out all along, with all of the above checked religiously — the file matched, and it
    stayed on the disk.
    Without a single error: the tarball is built, published, installed, and the five dependencies
    of manifest are resolved with `^` on the day someone installs it. That is, exactly what this
    entire block exists to prevent, without anything turning red.
   */
  if (!(manifest.files ?? []).includes("npm-shrinkwrap.json")) {
    flag(
      "The npm-shrinkwrap.json does not travel inside the package",
      "`files` is a whitelist and does not name it, so npm leaves it out of the tarball.",
      'add "npm-shrinkwrap.json" to `files`, in apps/cli/package.json',
    );
  }
}

/* ── 3. What should not travel ─────────────────────────────────────────────── */

function walk(base, visit) {
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const child = join(base, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walk(child, visit);
    else visit(child, entry.name);
  }
}

const traces = [];
const envFiles = [];
const natives = [];
const manifests = [];
const nested = [];
let bytes = 0;
let files = 0;

if (existsSync(app)) {
  walk(app, (path, name) => {
    files += 1;
    bytes += statSync(path).size;
    if (name.endsWith(".nft.json")) traces.push(path);
    if (/^\.env($|\.)/.test(name)) envFiles.push(path);
    if (name.endsWith(".node")) natives.push(path);
    if (name !== "package.json") return;
    const inside = relative(app, path).replace(/\\/g, "/");
    if (!inside.split("/").includes("node_modules")) {
      manifests.push(inside);
      return;
    }
    /*
      A manifest inside a package that is not the manifest OF that package.

      There are 120 of them today and every one holds something up, which is why this looks at
      what they say and not at where they are. 111 live under `next/dist/compiled/`: Next
      declares no `exports`, so `next/dist/compiled/<x>` resolves as a plain directory through
      that nested `main`, and 30 of them have no `index.js` to fall back on. The other 9 declare
      no name: they are `{"type": "..."}` markers and `main` redirections, and
      `@swc/helpers/_/_interop_require_default/` is a folder that contains **nothing but** its
      manifest. Both kinds would be destroyed by the obvious rule.

      The kind this counts is the third, which declares a name and is nobody's package. There
      was one: `fast-uri` publishes a `benchmark/` folder with a manifest of its own —
      `{"name": "benchmark", "version": "1.0.0", "dependencies": {"tinybench", "uri-js"}}` — so
      a scanner reading the tarball counted three packages that are not here, one of them
      published by an npm account that no longer exists. Nothing installed, nothing ran; what
      travelled was a false statement about what we redistribute. It left with the MCP SDK's
      HTTP transport on 6-Sep-2026, and this stays so the next one does not arrive unremarked.
     */
    /*
      Its own manifest or somebody else's: what is left after the last `node_modules` says so.
      `fast-uri/package.json` leaves two segments and `@panoma/mcp/package.json` leaves three
      starting with the scope; anything longer is inside another package's folder.
     */
    const segments = inside.split("/");
    const rest = segments.slice(segments.lastIndexOf("node_modules") + 1);
    const isOwn = rest.length === 2 || (rest.length === 3 && rest[0].startsWith("@"));
    if (!isOwn && !inside.includes("node_modules/next/dist/compiled/") && readJson(path)?.name) {
      nested.push(inside);
    }
  });
}

if (traces.length > 0) {
  flag(
    `Build traces (*.nft.json) inside the package: ${traces.length}`,
    "Only `next build` uses them; at runtime nobody opens them, and they weighed 81 MB.",
    "pnpm --filter panoma run build:app",
  );
}
if (envFiles.length > 0) {
  flag(
    `Environment files inside the package: ${envFiles.length}`,
    `Next's standalone copies them and npm would publish them:\n    ` +
      envFiles.map((r) => relative(cli, r)).join("\n    "),
    "delete them from apps/web and build the app/ again",
  );
}
if (natives.length > 0) {
  flag(
    `Native binaries (*.node) inside the package: ${natives.length}`,
    `They are compiled for a single platform; the package installs on every one:\n    ` +
      natives.slice(0, 5).map((r) => relative(cli, r)).join("\n    "),
    "review the pruning in pack-app.mjs",
  );
}
/*
  The manifests outside `node_modules`, which are two and say what they say.

  `pack-app.mjs` deletes the one from the monorepo —which announced eslint, vitest and tsup, none
  of which travel— and leaves the web one with what Node reads. But `app/` is in `.gitignore` and
  gets packaged from whatever is on disk that day, so a stale directory, or a Next that moves
  where it writes them, brings the old one back without saying a word.

  And the direction that hurts most is the other one. If `.next-bundle/package.json` goes
  missing, the server says «✓ Ready» and then answers 500 on every route; if the web one loses
  its `type`, the server dies at its first `import` on Node 22.0 to 22.6, which `engines` still
  admits. Neither failure is visible when packaging: both are visible on the machine of whoever
  installs it.
 */
if (nested.length > 0) {
  flag(
    `Manifests of another package inside a package: ${nested.length}`,
    `Nobody installs or runs them, and a scanner reads them as dependencies of ours:\n    ` +
      nested.slice(0, 8).join("\n    "),
    "prune that folder in pack-app.mjs, or remove at the root the dependency that brings it in",
  );
}

const MANIFESTS = {
  "apps/web/package.json": { type: "module", empty: ["dependencies", "devDependencies", "scripts"] },
  "apps/web/.next-bundle/package.json": { type: "commonjs", empty: [] },
};
if (existsSync(app)) {
  const extra = manifests.filter((m) => !(m in MANIFESTS));
  const missing = Object.keys(MANIFESTS).filter((m) => !manifests.includes(m));
  if (extra.length > 0) {
    flag(
      `Surplus manifests inside the package: ${extra.join(", ")}`,
      "They declare dependencies that do not travel, and whoever reads the tarball reads something that is not true.",
      "pnpm --filter panoma run build:app",
    );
  }
  if (missing.length > 0) {
    flag(
      `A manifest that really is needed is missing: ${missing.join(", ")}`,
      "Without it the server starts and answers 500, or dies on its first import. It is not visible when packaging.",
      "pnpm --filter panoma run build:app",
    );
  }
  for (const [path, { type, empty }] of Object.entries(MANIFESTS)) {
    if (missing.includes(path)) continue;
    const meta = readJson(join(app, ...path.split("/"))) ?? {};
    if (meta.type !== type) {
      flag(
        `${path} travels with type ${JSON.stringify(meta.type)} and it has to be "${type}"`,
        "It is what decides whether Node reads that tree as ESM or as CommonJS.",
        "pnpm --filter panoma run build:app",
      );
    }
    const declared = empty.filter((field) => meta[field] !== undefined);
    if (declared.length > 0) {
      flag(
        `${path} declares ${declared.join(", ")} and should not`,
        "Nothing inside reads it, and what it names —react-icons, recharts, six workspace:*— does not travel.",
        "pnpm --filter panoma run build:app",
      );
    }
  }
}
/*
  The database engine, without trusting the filename.
  In PGlite 0.2 it was `postgres.wasm`; in 0.5 it is `pglite.wasm` plus a `initdb.wasm` and a
  `pglite.data`. Checking a specific name expires in each version, so only what does not change is
  checked: that there is at least one `.wasm` inside. Without it, the package installs anyway and
  the catalog does not open.
 */
const pgliteDist = join(app, "node_modules", "@electric-sql", "pglite", "dist");
const wasms = existsSync(pgliteDist)
  ? readdirSync(pgliteDist).filter((n) => n.endsWith(".wasm"))
  : [];
if (wasms.length === 0) {
  flag(
    "PGlite travels without a single .wasm",
    "The package would install all the same and the catalog would not open on the user's machine.",
    "pnpm --filter panoma run build:app",
  );
}

for (const forbidden of ["sharp", "@img"]) {
  if (existsSync(join(app, "node_modules", forbidden))) {
    flag(
      `${forbidden} travels in the package`,
      "That is 16 MB compiled for Apple Silicon alone, and it is not used: the web runs with images.unoptimized.",
      "pnpm --filter panoma run build:app",
    );
  }
}

/*
  The path of the laptop of the person who compiled.
  Next embeds it in `server.js`, in `required-server-files.json`, and as a module key in each
  `page.js`. It doesn't break anything — they are identifiers, not paths that get resolved — but
  it publishes to npm the username and disk structure of whoever made the release. It warns
  instead of aborting: the real solution is to build the release in a neutral path, and blocking
  `pack` because of this would leave the project unable to package locally.
 */
const buildPath = root;
let withPath = 0;
if (existsSync(app)) {
  walk(app, (path, name) => {
    if (!/\.(js|json|map)$/.test(name)) return;
    if (statSync(path).size > 4_000_000) return;
    if (readFileSync(path, "utf8").includes(buildPath)) withPath += 1;
  });
}

/* ── The verdict ──────────────────────────────────────────────────────────── */

const megabytes = bytes / 1048576;
const CEILING_MB = 220;
if (megabytes > CEILING_MB) {
  flag(
    `The app/ weighs ${megabytes.toFixed(0)} MB and the ceiling is at ${CEILING_MB}`,
    "Either something got in that should not have, or the ceiling has grown stale. Look at it before uploading it.",
    "pnpm --filter panoma run build:app",
  );
}

if (problems.length > 0) {
  process.stderr.write(`\n  Cannot package. Things to fix: ${problems.length}\n\n`);
  for (const { title, detail, fix } of problems) {
    process.stderr.write(`  ▸ ${title}\n    ${detail}\n    → ${fix}\n\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `  package checked: ${files} ${files === 1 ? "file" : "files"}, ${megabytes.toFixed(0)} MB in app/` +
    (info?.commit ? `, from commit ${info.commit.slice(0, 7)}` : "") +
    `\n`,
);
if (withPath > 0) {
  process.stdout.write(
    `  warning: files that carry the build path (${buildPath}) baked in: ${withPath}.\n` +
      `  It breaks nothing, but it gets published to npm. It is avoided by building the release in a neutral path.\n`,
  );
}
