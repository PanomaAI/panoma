#!/usr/bin/env node
/**
 * Leave the catalog ready to travel within the npm package.
 *
 * `next build` with `output: "standalone"` leaves almost everything done, but not entirely: there
 * are things that Next does not do and without which the server starts and then fails, sometimes
 * serving API and giving 500 on the pages, which is the most confusing symptom possible. This
 * script does those things, and also **refuses to produce an inconsistent package**: the version
 * that travels from each dependency is compared with the lockfile, and if two `.pnpm` folders
 * claim the same package with different versions, it aborts.
 *
 * That safeguard is not theoretical. An audit on Aug-19-2026 found that the package carried
 * `drizzle-orm` 0.38.4 —the version with the SQL injection that we had uploaded to 0.45.2—
 * resurrected from two orphan folders of `.pnpm` that the flattening silently chose in
 * alphabetical order. Here there is no silent choice anymore: either it matches the lockfile or
 * there is no package.
 *
 * It is executed from `pnpm --filter panoma run build:app`, and its output is `apps/cli/app`.
 */

import { cp, rm, readdir, stat, writeFile, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(cli, "..", "..");
const web = join(root, "apps", "web");
const dist = process.env["PANOMA_DIST"] ?? ".next";
const source = join(web, dist, "standalone");
const destination = join(cli, "app");

function print(text) {
  process.stdout.write(`  ${text}\n`);
}

function abort(text) {
  process.stderr.write(`\n  ${text}\n\n`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

if (!existsSync(source)) {
  abort(
    `There is no standalone in ${relative(root, source)}.\n` +
      `  Run first: pnpm --filter panoma run build:app`,
  );
}

/*
  The lockfile, which is the only source of truth about which version should travel.
  Only the `packages:` section is read, whose keys are clean `name@version`. The `snapshots:`
  one has peer suffixes (`pkg@1.0.0(react@19.0.0)`) and is not useful for this.
 */
function lockfileVersions() {
  const text = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  const lines = text.split("\n");
  const versions = new Map();
  let inside = false;
  for (const line of lines) {
    if (/^[a-zA-Z]/.test(line)) {
      inside = line.startsWith("packages:");
      continue;
    }
    if (!inside) continue;
    const m = /^ {2}'?(.+?)'?:$/.exec(line);
    if (!m) continue;
    const spec = m[1];
    const at = spec.lastIndexOf("@");
    if (at <= 0) continue;
    const name = spec.slice(0, at);
    const version = spec.slice(at + 1);
    if (!versions.has(name)) versions.set(name, new Set());
    versions.get(name).add(version);
  }
  return versions;
}

const inLockfile = lockfileVersions();
if (inLockfile.size === 0) abort("I could not read the versions from pnpm-lock.yaml.");

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true, dereference: false });
print(`copied the standalone to ${relative(root, destination)}`);

/*
  1. The statics.
  Next intentionally leaves them out of the standalone —whoever deploys on a CDN doesn’t want them
  on the server— but here the server **is** the CDN: without them the page loads without CSS and
  without JavaScript, which is worse than not loading, because it seems to work.
 */
await cp(join(web, dist, "static"), join(destination, "apps", "web", dist, "static"), {
  recursive: true,
});
/*
  And all of `public/`, which now contains product assets only.
  Here there was a filter that blocked `assets/landing/` —the cover video and its poster, 1.8 MB
  that no one was going to request from a `localhost`, and more than 10% of the tarball—. Those
  files went with the landing to `apps/site/public`, so the filter was left with nothing to filter
  and went with them: a filter that discards nothing is a promise that someone is watching it, and
  no one is watching it.
  What remains in `apps/web/public` are the 236 KB of the brand and the example screenshots of the
  panel, which are indeed Panoma.
 */
if (existsSync(join(web, "public"))) {
  await cp(join(web, "public"), join(destination, "apps", "web", "public"), { recursive: true });
}
print("copied the static files and public/");

/*
  2. A `node_modules` plane, with real copies and not a single symbolic link.
  Two problems that add up. pnpm does not flatten `node_modules`: each package sees its
  dependencies via links inside `.pnpm`, and Next's standalone copies the files but does not
  recreate those links. And even if we recreated them, **npm does not preserve them when
  packaging** — it was tried: in a clean installation the linked folders arrived empty and the
  server died with `Cannot find module 'next'`.
  So it flattens completely: each package of `.pnpm` is truly copied to the first level of
  `app/node_modules`, and `.pnpm` disappears. Node resolves by going up through the
  `node_modules`, so from any point of the tree everything is found.
 */
const nm = join(destination, "node_modules");
const pnpmBase = join(nm, ".pnpm");
/** name → { folder, version, source } of the package that was copied. */
const seen = new Map();
const conflicts = [];
const outsideLockfile = [];

for (const folder of (await readdir(pnpmBase).catch(() => [])).sort()) {
  const inside = join(pnpmBase, folder, "node_modules");
  for (const entry of await readdir(inside, { withFileTypes: true }).catch(() => [])) {
    // The scopes (`@scope`) carry the package one level down.
    const names = entry.name.startsWith("@")
      ? (await readdir(join(inside, entry.name)).catch(() => [])).map((n) => `${entry.name}/${n}`)
      : [entry.name];
    for (const name of names) {
      const packageSource = join(inside, name);
      /*
        Only the package that that `.pnpm` folder has; the rest are its links.
        The `+ "@"` is essential and was hard to find: without it, `startsWith("react")` also hits
        within `react-icons@5.5.0_react@19.2.8`, so `react` was copied from the link that
        dereferenced a neighbor instead of from its own folder. With only one version on disk, the
        content matches and it is not noticeable; with two, the one the neighbor linked wins.
        There are 25 prefix pairs in this monorepo.
       */
      if (!folder.startsWith(name.replace("/", "+") + "@")) continue;

      const meta = readJson(join(packageSource, "package.json"));
      const version = meta?.version ?? "unknown";

      const previous = seen.get(name);
      if (previous) {
        /*
          This is where the flattening fell silent. The `continue` on its own kept the first
          folder in reading order — alphabetical — and buried the other without saying anything:
          this is how drizzle 0.38.4 traveled ahead of 0.45.2. Now it is noted and aborted.
         */
        if (previous.version !== version) {
          conflicts.push({ name, a: previous, b: { folder, version } });
        }
        continue;
      }
      seen.set(name, { folder, version, source: packageSource });

      /*
        And the second network: what travels has to be in the lockfile. The orphan folders from
        old installations survive in `.pnpm` and they are not.
       */
      const known = inLockfile.get(name);
      if (known && !known.has(version)) {
        outsideLockfile.push({ name, version, expected: [...known].join(", ") });
      }

      await cp(packageSource, join(nm, name), { recursive: true, dereference: true });
    }
  }
}

if (conflicts.length > 0) {
  abort(
    `Two versions of the same package want to travel, and I am not going to be the one who chooses:\n\n` +
      conflicts
        .map(
          ({ name, a, b }) =>
            `    ${name}\n      ${a.version}  in ${a.folder}\n      ${b.version}  in ${b.folder}`,
        )
        .join("\n") +
      `\n\n  Almost always they are leftovers of an earlier installation in node_modules/.pnpm.\n` +
      `  They are cleaned with:  pnpm install --frozen-lockfile\n` +
      `  And if they persist:    rm -rf node_modules && pnpm install --frozen-lockfile`,
  );
}

if (outsideLockfile.length > 0) {
  abort(
    `These versions are not in pnpm-lock.yaml, so nobody asked for them:\n\n` +
      outsideLockfile
        .map(({ name, version, expected }) => `    ${name}@${version}  (the lockfile says ${expected})`)
        .join("\n") +
      `\n\n  They are orphan leftovers in node_modules/.pnpm. Clean them with:\n` +
      `    pnpm install --frozen-lockfile`,
  );
}

/*
  The `@panoma/*` are copied from the repository and not from the standalone.
  The tracing leaves them halfway —from `core` only `package.json` arrived, without `dist`, and
  the startup died with `ERR_MODULE_NOT_FOUND` on the user's machine— because they are imported
  from `new Function` and Next cannot follow that trail. From `packages/` what really exists is
  copied: the built `dist`, manifest, and the migrations of `db`.
 */
const panoma = [];
for (const pkg of await readdir(join(root, "packages"))) {
  const packageDir = join(root, "packages", pkg);
  const manifest = readJson(join(packageDir, "package.json"));
  if (!manifest) continue;
  if (!existsSync(join(packageDir, "dist"))) {
    abort(`${pkg} is not built. Run first: pnpm -r build`);
  }
  const target = join(nm, "@panoma", pkg);
  await cp(join(packageDir, "dist"), join(target, "dist"), { recursive: true, dereference: true });
  await cp(join(packageDir, "package.json"), join(target, "package.json"), { dereference: true });
  if (existsSync(join(packageDir, "migrations"))) {
    await cp(join(packageDir, "migrations"), join(target, "migrations"), {
      recursive: true,
      dereference: true,
    });
  }
  panoma.push({ name: manifest.name, packageDir, manifest });
}

await rm(pnpmBase, { recursive: true, force: true });
await rm(join(destination, "packages"), { recursive: true, force: true });
await rm(join(destination, "apps", "web", "node_modules"), { recursive: true, force: true });
print(`packages flattened into real copies: ${seen.size} from npm and ${panoma.length} from @panoma/*`);

/*
  And the two manifests that come along inside the standalone and that nobody in there reads.

  `app/package.json` is the manifest of the monorepo, and it is not written for the package: the
  tracing points at the root of the repository —that is what `outputFileTracingRoot` says— and
  copies it like one more traced file. So the tarball published eslint, vitest, tsup, tsx and
  typescript, none of which travel, and a `packageManager` that Corepack would obey for anyone
  running a command from inside the installed folder. It is deleted whole: the only `.js` under
  `app/` outside `node_modules` is `apps/web/server.js`, and that one has its own manifest
  beside it.

  `apps/web/package.json` Next does write on purpose, and it is a verbatim copy of ours: it
  declared `react-icons` and `recharts` —which are inside `.next-bundle` and not in
  `node_modules`— and six `workspace:*` that no npm tool can resolve. Of everything in it, one
  field holds weight: `type`, which is what tells Node that the `server.js` Next emitted is ESM.
  Without it the server dies at its first `import` on Node 22.0 to 22.6, which `engines` still
  admits.

  Neither of the two is about size: they are two files that state, in the published package,
  dependencies that are not inside it. Whoever reads the tarball —a scanner, an SBOM, a
  person— reads a lie.

  What is NOT touched is `apps/web/.next-bundle/package.json`, the `{"type": "commonjs"}` that
  `next build` writes into its own output directory. Without it the server says «✓ Ready» and
  then answers 500 on every route. That is why two paths are deleted here by name and never a
  pattern.
 */
const webManifest = readJson(join(web, "package.json")) ?? {};
await rm(join(destination, "package.json"), { force: true });
await writeFile(
  join(destination, "apps", "web", "package.json"),
  JSON.stringify(
    {
      name: webManifest.name,
      version: webManifest.version,
      private: true,
      type: webManifest.type ?? "module",
      // If they ever appear, they resolve routes and have to travel; today apps/web has neither.
      ...(webManifest.imports ? { imports: webManifest.imports } : {}),
      ...(webManifest.exports ? { exports: webManifest.exports } : {}),
    },
    null,
    2,
  ) + "\n",
);
print("the monorepo manifest is out, and the web one is left with what Node reads");

/*
  3. The dependencies of the `@panoma/*`, which the layout also doesn’t see.
  Same reason as `dist`: they are imported after `new Function`. The result was that
  `@panoma/core` traveled importing `yaml`, `ignore`, and `smol-toml` without any of them being in
  the package — it worked by coincidence, because CLI declares them in its own manifest and Node
  finds them by climbing up the `node_modules` tree. That coincidence will break the day a package
  gains a dependency that CLI does not have.
  And there was already a broken one: `@panoma/mcp` was running importing
  `@modelcontextprotocol/sdk` and `zod`, which were nowhere to be found. The MCP server —six
  tools, the channel with all agents— couldn't start on anyone's machine who installed it from
  npm. That was fixed from the other side: `packages/mcp` packages itself and no longer asks for
  them
  (see their `tsup.config.ts` ), which also excluded the 90 HTTP transport packages
  that the SDK drags and that here are never executed.
  They are resolved as Node will do at runtime, with `createRequire` from the package that
  requests them, and they are copied with their entire transitive tree.
  The app manager is covered by the same directory scan, including its runtime zod dependency.
  The web's MCP client is a static Next import: tracing follows the stdio client and its AJV
  validator. Do not copy all web dependencies here or prune AJV as an unused HTTP transport;
  the SDK client needs it even though no HTTP server transport is used.
 */
function packageRoot(name, from) {
  const req = createRequire(join(from, "package.json"));

  /*
    Go up to the manifest for real, and don't trust the first folder that appears.
    `@modelcontextprotocol/sdk` maps its `./package.json` to `dist/cjs/package.json` —the
    `{"type":"commonjs"}` marker file, which has neither name nor version—, so keeping the
    `dirname` of the `resolve` gave an internal folder and an 'unknown' version. It is uploaded
    until finding the manifest that is called like the package.
   */
  function climbTo(point) {
    let current = point;
    for (let i = 0; i < 10; i += 1) {
      if (readJson(join(current, "package.json"))?.name === name) return current;
      const up = dirname(current);
      if (up === current) return undefined;
      current = up;
    }
    return undefined;
  }

  for (const attempt of [
    () => dirname(req.resolve(`${name}/package.json`)),
    () => dirname(req.resolve(name)),
    /*
      In the pnpm tree, the dependent has a direct link to the package. It is useful for those who
      do not export either their root or their manifest.
     */
    () => join(from, "node_modules", name),
  ]) {
    let point;
    try {
      point = attempt();
    } catch {
      continue;
    }
    const realRoot = existsSync(point) ? climbTo(point) : undefined;
    if (realRoot) return realRoot;
  }
  return undefined;
}

const pending = [];
for (const { name, packageDir, manifest } of panoma) {
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    if (dep.startsWith("@panoma/")) continue;
    pending.push({ dep, from: packageDir, requestedBy: name });
  }
}

const unresolved = [];
let copiedSeparately = 0;
while (pending.length > 0) {
  const { dep, from, requestedBy } = pending.shift();
  if (seen.has(dep)) continue;
  const folder = packageRoot(dep, from);
  if (!folder) {
    unresolved.push(`${dep} (requested by ${requestedBy})`);
    continue;
  }
  const meta = readJson(join(folder, "package.json"));
  const version = meta?.version ?? "unknown";
  const known = inLockfile.get(dep);
  if (known && !known.has(version)) {
    outsideLockfile.push({ name: dep, version, expected: [...known].join(", ") });
  }
  seen.set(dep, { folder: `resolved from ${requestedBy}`, version, source: folder });
  await cp(folder, join(nm, dep), { recursive: true, dereference: true });
  copiedSeparately += 1;
  for (const sub of Object.keys(meta?.dependencies ?? {})) {
    if (!seen.has(sub)) pending.push({ dep: sub, from: folder, requestedBy: dep });
  }
}

if (unresolved.length > 0) {
  abort(
    `I cannot find dependencies that the @panoma/* need:\n\n` +
      unresolved.map((line) => `    ${line}`).join("\n") +
      `\n\n  Without them the package installs and fails when used. Run: pnpm install`,
  );
}
if (outsideLockfile.length > 0) {
  abort(
    `Versions outside the lockfile among the dependencies of @panoma/*:\n\n` +
      outsideLockfile
        .map(({ name, version, expected }) => `    ${name}@${version}  (the lockfile says ${expected})`)
        .join("\n"),
  );
}
if (copiedSeparately > 0) {
  print(`dependencies of the @panoma/* that the tracing does not see, copied separately: ${copiedSeparately}`);
}

/*
  4. Pruning.
  `outputFileTracingExcludes` carries part of the ballast, but a lot escapes from it and its
  anchored patterns do not match when `outputFileTracingRoot` is above the project. Here it is
  erased by hand, which is deterministic and can be measured.
  - `typescript` and `@types`: nine megabytes of a compiler that doesn't compile anything here.
  - `sharp` and `@img`: 16 MB of libvips compiled **only for Apple Silicon**. The package is
  intended to be cross-platform and Next only requires it if images are optimized, which is not
  done (`images.unoptimized` in the package compilation).
  - The `*.nft.json`: the traces that `next build` uses to *build* the standalone. At runtime, no
  one opens them and they were **81 MB**, almost half of the package.
  - The `*.map`: 12 MB of source maps that no one is going to open on the user's computer.
  - The PGlite extension tarballs: 48 Postgres extensions, 5.8 MB. No migration declares them and
  `new PGlite(path)` is built without `extensions`.
 */
const pruned = [];

async function prune(label, fn) {
  const before = await sizeOf(destination);
  await fn();
  const after = await sizeOf(destination);
  const saved = (before - after) / 1048576;
  if (saved > 0.05) pruned.push(`${label} (${saved.toFixed(1)} MB)`);
}

async function deleteByPattern(base, matches) {
  for (const entry of await readdir(base, { withFileTypes: true }).catch(() => [])) {
    const child = join(base, entry.name);
    if (entry.isDirectory()) await deleteByPattern(child, matches);
    else if (matches(entry.name)) await rm(child, { force: true });
  }
}

const NOT_AT_RUNTIME = new Set(["typescript", "@types", "sharp", "@img", "detect-libc"]);
await prune("packages not needed at runtime", async () => {
  for (const entry of await readdir(nm).catch(() => [])) {
    if (!NOT_AT_RUNTIME.has(entry)) continue;
    /*
      The registry is deleted by package name, not by folder name.
      `@img` is a folder; in `seen` the keys are `@img/colour`, `@img/sharp-darwin-arm64`, and
      `@img/sharp-libvips-darwin-arm64`. `delete("@img")` did not delete any of the three, so the
      third-party notices and the BUILD-INFO declared three packages that no longer traveled —
      among them libvips, which is LGPL-3.0-or-later. Announcing that you redistribute LGPL when
      you do not is the same kind of falsehood as keeping silent about it when you do. Deleting
      from a Map while iterating over its keys is allowed and the iterator tolerates it.
     */
    for (const name of seen.keys()) {
      if (name === entry || name.startsWith(entry + "/")) seen.delete(name);
    }
    await rm(join(nm, entry), { recursive: true, force: true });
  }
});

await prune("build traces (*.nft.json)", () =>
  deleteByPattern(join(destination, "apps"), (n) => n.endsWith(".nft.json")),
);

await prune("source maps", () => deleteByPattern(destination, (n) => n.endsWith(".map")));

await prune("Postgres extensions that the catalog does not declare", () =>
  deleteByPattern(join(nm, "@electric-sql"), (n) => n.endsWith(".tar.gz")),
);

if (pruned.length > 0) print(`pruned: ${pruned.join(", ")}`);

/*
  5. The license notices of what we redistribute.
  The build copies the files needed to run, and the licenses are not needed to run—so they did not
  travel. But MIT and Apache-2.0 require keeping the notice when redistributing copies, and here
  actual copies of next, react, drizzle, and PGlite are redistributed. For a project that is
  published under AGPL with a CLA behind it, traveling without third-party notices is the easiest
  inconsistency to avoid.
 */
/*
  `LICENSE-MIT` is a real name: `ignore` uses it, and the previous form —which only allowed a dot
  at the end— would lose it and treat it as a package without text.
 */
const LICENSE_NAMES = /^(LICEN[CS]E|COPYING|NOTICE)([-._].*)?$/i;

/*
  Where the license is read, which is the question that this step had answered incorrectly.
  `seen` records the `source` of each flattened package inside `app/node_modules/.pnpm`, and
  that folder is deleted in step 2, two hundred lines above. So `readJson` silently failed,
  returned `{}`, and the 21 packages coming from the flattening appeared "undeclared." It's not
  that they declared nothing: all 21 carry their `license` field in `package.json`. It's just that
  it was reading a directory that no longer exists. The 8 that did appear correctly were exactly
  those resolved from the monorepo for the `@panoma/*`, whose `source` is still intact — hence why
  the failure seemed random.
  And there is a second reason not to read from what travels: Next's standalone is a *traced*
  copy, and a license is not needed to run it, so Next does not copy it. Of the 26 packages that
  travel, only 6 keep their file; in the pnpm store they have 22. The text is there, but not where
  we were looking.
  Searching for `name@version` exactly —or with the peer suffix, `_react@…` — and it falls back
  to the copy that travels if it is not there.
 */
const store = join(root, "node_modules", ".pnpm");
const storeFolders = await readdir(store).catch(() => []);
if (storeFolders.length === 0) {
  abort(
    `I cannot find node_modules/.pnpm, and that is where the license texts come from.\n` +
      `  Without the store the notice would come out with the names but without a single text.\n` +
      `  Run: pnpm install --frozen-lockfile`,
  );
}

function licenseOrigin(name, version) {
  const prefix = `${name.replace("/", "+")}@${version}`;
  const folder = storeFolders.find((c) => c === prefix || c.startsWith(prefix + "_"));
  const inStore = folder ? join(store, folder, "node_modules", name) : undefined;
  return inStore && existsSync(inStore) ? inStore : join(nm, name);
}

async function licenseText(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
    if (entry.isFile() && LICENSE_NAMES.test(entry.name)) {
      /*
        A LF at the door, which is where the foreign text enters.
        Some third-party licenses come with Windows line endings, and those CR traveled all the
        way to `THIRD-PARTY-NOTICES.md`, which is committed. The repository normalizes everything
        to LF (`.gitattributes`), so the newly generated file differed from the saved one in
        invisible bytes: `git status` marked it as modified after EACH packaging, `pack-app`
        recorded `arbolLimpio: false`, and the guardian of `prepack` refused to package. That is:
        the guardian that exists so that nothing is published without committing ended up
        requiring `PANOMA_PACK_SUCIO=1` in ALL releases, which is exactly the opposite of what it
        protects.
        It is normalized here and not when writing the document because this is where the text
        stops being someone else's and becomes ours: anyone who reads `notices[].text` afterwards
        receives it already in the house convention.
       */
      const raw = await readFile(join(folder, entry.name), "utf8");
      return raw.replace(/\r\n?/g, "\n").trim();
    }
  }
  return undefined;
}

/*
  The three sources, in order: the field `license`, its object form `{ type }`, and the field
  `licenses` from the old npm, which is still alive in packages that no one has touched since
  2015. Today, none of the 26 use the last two — they are read because the day an old dependency
  comes in, the packaging would stop for nothing.
 */
function declaredLicense(meta) {
  if (typeof meta.license === "string" && meta.license.trim()) return meta.license.trim();
  if (typeof meta.license?.type === "string") return meta.license.type;
  if (typeof meta.licenses === "string") return meta.licenses;
  if (Array.isArray(meta.licenses)) {
    const types = meta.licenses.map((l) => (typeof l === "string" ? l : l?.type)).filter(Boolean);
    if (types.length > 0) return types.join(" OR ");
  }
  return undefined;
}

const notices = [];
const withoutLicense = [];
for (const [name, { version }] of [...seen].sort()) {
  const folder = licenseOrigin(name, version);
  const meta = readJson(join(folder, "package.json")) ?? {};
  const license = declaredLicense(meta);
  const text = await licenseText(folder);
  if (!license && !text) {
    withoutLicense.push(`${name}@${version}  (looked in ${relative(root, folder)})`);
    continue;
  }
  notices.push({ name, version, license: license ?? "only the attached text", text });
}

/*
  And here it is aborted, which is the change that really matters.
  A third-party notice that says 'undeclared' informs nothing: it puts in writing that we
  redistribute code without knowing under what conditions. That is not an incomplete notice, it is
  the absence of a notice in the form of one. If a license is missing, packaging stops and it is
  checked manually; it takes thirty seconds and happens once per new dependency.
 */
if (withoutLicense.length > 0) {
  abort(
    `I do not know under which license this travels, and I am not going to publish it without knowing:\n\n` +
      withoutLicense.map((line) => `    ${line}`).join("\n") +
      `\n\n  Look for the license in its repository. If it really declares none, it cannot be\n` +
      `  redistributed: without an express license, copyright forbids it by default.`,
  );
}

/*
  Strong copyleft: just naming it is not enough, and we don’t want to get into that conversation
  by surprise.
  `sharp` drags along `@img/sharp-libvips-darwin-arm64`, which is LGPL-3.0-or-later and travels as
  an already compiled binary. The LGPL is not fulfilled with a line in a summary: it requires the
  text of the LGPL and the GPL, and when distributing the object it also demands allowing the user
  to replace the library with another version of their own (§4). Here it is pruned before reaching
  it and `check-package.mjs` refuses to package if it appears; this is the third network, and the
  one that would trigger the day someone reactivates image optimization without remembering the
  rest.
 */
const STRONG_COPYLEFT = /^(A?GPL|LGPL|MPL|EPL|CDDL|CECILL|OSL|EUPL)/i;
const withCopyleft = notices.filter(({ license }) => STRONG_COPYLEFT.test(license));
if (withCopyleft.length > 0) {
  abort(
    `Copyleft inside the package, and that is not settled by naming it in a summary:\n\n` +
      withCopyleft
        .map(({ name, version, license }) => `    ${name}@${version} — ${license}`)
        .join("\n") +
      `\n\n  These licenses ask for their full text, and the LGPL also asks to be able to replace the\n` +
      `  library. Either the package is pruned, or the whole job is done.`,
  );
}

/*
  And the licenses return to the place where they have to be: inside the copy.
  MIT, BSD, and ISC do not require a separate summary: they require that the copyright notice
  travels **in every copy**. The standalone of Next copies what is needed to run, and a license is
  not needed to run. Measured on August 25, 2026: among the 26 packages that travel there are 134
  upstream license files and only 7 reached the tarball.
  The ones that hurt the most are inside Next: `next/dist/compiled/` are 112 third-party libraries
  packaged within Next itself —tar, ws, zod, debug, browserslist…— which we redistribute just like
  we redistribute Next, and which arrived without a single line from their authors. Returning them
  costs 262 KB over 174 MB.
  `cp` creates the intermediate directories, so nested paths do not need `mkdir`.
 */
async function licensesInside(base, prefix = "") {
  const found = [];
  const here = prefix ? join(base, prefix) : base;
  for (const entry of await readdir(here, { withFileTypes: true }).catch(() => [])) {
    if (entry.isSymbolicLink()) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await licensesInside(base, rel)));
    else if (LICENSE_NAMES.test(entry.name)) found.push(rel);
  }
  return found;
}

let returned = 0;
for (const [name, { version }] of seen) {
  const origin = licenseOrigin(name, version);
  if (origin === join(nm, name)) continue;
  for (const rel of await licensesInside(origin)) {
    const target = join(nm, name, ...rel.split("/"));
    if (existsSync(target)) continue;
    await cp(join(origin, ...rel.split("/")), target);
    returned += 1;
  }
}
if (returned > 0) print(`licenses the tracing left out and that go back inside: ${returned}`);

const notes =
  `# Third-party notices\n\n` +
  `panoma is distributed under the AGPL-3.0-only. This package includes copies of the\n` +
  `programs below, each under its own license and with its own copyright.\n` +
  `Nothing that follows is altered by panoma's license.\n\n` +
  `Generated by \`apps/cli/scripts/pack-app.mjs\`; it is not edited by hand.\n\n` +
  `## Summary\n\n` +
  notices.map(({ name, version, license }) => `- ${name}@${version} — ${license}`).join("\n") +
  `\n\n## Texts\n\n` +
  `Below goes the notice exactly as each author publishes it. The original files also\n` +
  `travel inside the package, next to each library, in \`app/node_modules/\`.\n\n` +
  `The ones that do not appear below are missing because their author publishes no license\n` +
  `file: they declare theirs in \`package.json\` and distribute no more text than that name.\n\n` +
  notices
    .filter(({ text }) => text)
    .map(({ name, version, text }) => `### ${name}@${version}\n\n\`\`\`\n${text}\n\`\`\``)
    .join("\n\n") +
  `\n`;

await writeFile(join(cli, "THIRD-PARTY-NOTICES.md"), notes);
const withText = notices.filter((a) => a.text).length;
print(`packages with a declared license: ${notices.length}, of which with full text: ${withText}`);

/*
  6. The origin, so that `prepack` can refuse to publish a stale package.
  `app/` is in `.gitignore`, so `npm publish` packages whatever is on the disk that day, no matter
  where it comes from. That is exactly how the orphan drizzle slipped in: there wasn’t an error,
  there was an old artifact. With this, the guardian of `prepack` can compare the commit and the
  lockfile from when it was built with the ones from now.
 */
function git(...args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

const lockfileHash = createHash("sha256")
  .update(readFileSync(join(root, "pnpm-lock.yaml")))
  .digest("hex");

await writeFile(
  join(destination, "BUILD-INFO.json"),
  JSON.stringify(
    {
      version: readJson(join(cli, "package.json"))?.version,
      commit: git("rev-parse", "HEAD"),
      arbolLimpio: git("status", "--porcelain") === "",
      lockfile: lockfileHash,
      node: process.version,
      plataformaDeCompilacion: `${process.platform}-${process.arch}`,
      paquetes: Object.fromEntries([...seen].sort().map(([n, { version }]) => [n, version])),
    },
    null,
    2,
  ) + "\n",
);

/*
  7. The verification that what has to exist actually exists.
  A package that is published without the server inside does not fail when published: it fails on
  the machine of the person who installs it, which is the worst place and the latest possible.
 */
const essentials = [
  ["apps/web/server.js", "the server"],
  ["node_modules/next", "Next"],
  [`apps/web/${dist}/static`, "the static files"],
  ["node_modules/@panoma/db/dist", "the catalog engine"],
  ["node_modules/@panoma/core", "the core"],
  ["node_modules/@panoma/db/migrations", "the migrations"],
  ["node_modules/@panoma/mcp/dist/index.js", "the MCP server"],
  ["node_modules/@panoma/apps/dist/index.js", "the app manager"],
  ["node_modules/@panoma/handoff/dist/index.js", "the handoff engine"],
  [`apps/web/${dist}/server/app/api/apps/route.js`, "the apps API and its MCP client"],
  ["node_modules/@electric-sql/pglite", "the database"],
  ["node_modules/drizzle-orm", "the database access"],
];
const missing = essentials.filter(([path]) => !existsSync(join(destination, path)));
if (missing.length) abort(`Missing from the package: ${missing.map(([, what]) => what).join(", ")}`);

/*
  And the checking of the routes, in both directions.
  That the public site is in another application (`apps/site`) makes it structurally impossible
  for it to travel in here, so the first half of this is a belt over a strap. It stays in place
  because what it monitors is not yesterday’s mechanism but the border: the day someone returns a
  landing—or any sales page—to `apps/web`, it announces this before publishing, and it does so
  looking at the constructed package rather than trusting where the folders are. It would be the
  ad served from the `localhost` of whoever already installed Panoma.
  The second half is not theoretical: a package without the catalog cover is not noticed at
  startup, because the `panoma up` probe asks for `/api/catalog` and never for `/`, so the server
  declares itself healthy and serves a factory 404 on the first screen.
  The manifest of routes is being looked at and not the folders: its values are the URL with the
  groups already removed, so this still holds true regardless of what the groups are called
  tomorrow.
  Here and not only in `prepack` because `build:app` does not go through `prepack`.
 */
const routesInside = Object.values(
  readJson(join(destination, "apps", "web", dist, "app-path-routes-manifest.json")) ?? {},
);
if (routesInside.length === 0) {
  abort("The package does not carry the routes manifest: there is no way to know which pages travel.");
}
const leaked = routesInside.filter((route) => route === "/landing" || route === "/docs");
if (leaked.length) {
  abort(
    `The public site traveled inside the package: ${leaked.join(", ")}\n` +
      `  The public site lives in apps/site: apps/web must not have those routes.`,
  );
}
if (!routesInside.includes("/")) {
  abort(
    "The package does not carry the catalog cover (`/`).\n" +
      "  apps/web/app/(app)/page.tsx is missing, or next build never got to compile it.",
  );
}

/*
  The WASM of PGlite, without assuming what it's called.
  Previously `dist/postgres.wasm` was checked raw, and when moving to PGlite 0.5 that path stopped
  existing: the engine moved to `pglite.wasm`, a separate `initdb.wasm` appeared, and the data
  goes in `pglite.data`. The check jumped —it did its job, the package would have been published
  without being able to open the catalog if it hadn't been there— but the cause was herself.
  So instead of fixed names, it is compared against the source package: every binary that PGlite
  brings must also be in the one that is traveling. That survives the next name change without
  anyone having to remember.
 */
/*
  It is resolved from the monorepo and not from what was annotated when flattening: that was
  pointing inside `app/node_modules/.pnpm`, which by now has already been deleted.
 */
const pgliteSource = packageRoot("@electric-sql/pglite", join(root, "packages", "db"));
if (!pgliteSource) abort("I cannot find PGlite in the monorepo to compare its binaries.");

const pgliteBinaries = (await readdir(join(pgliteSource, "dist"), { withFileTypes: true }))
  .filter((e) => e.isFile() && /\.(wasm|data)$/.test(e.name))
  .map((e) => e.name);

if (pgliteBinaries.length === 0) abort("PGlite carries no .wasm at all: check the version.");

const notCopied = pgliteBinaries.filter(
  (name) => !existsSync(join(nm, "@electric-sql", "pglite", "dist", name)),
);
if (notCopied.length > 0) {
  abort(`PGlite traveled without ${notCopied.join(", ")}: the catalog would not open.`);
}
print(`PGlite carries its binaries, ${pgliteBinaries.length} of them: ${pgliteBinaries.join(", ")}`);

const drizzle = readJson(join(nm, "drizzle-orm", "package.json"))?.version;
const expected = [...(inLockfile.get("drizzle-orm") ?? [])].join(", ");
if (drizzle !== expected) {
  abort(`drizzle-orm traveled as ${drizzle} and the lockfile says ${expected}.`);
}

async function sizeOf(path) {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    const child = join(path, entry.name);
    if (entry.isSymbolicLink()) continue;
    total += entry.isDirectory() ? await sizeOf(child) : (await stat(child)).size;
  }
  return total;
}

print(`ready: ${((await sizeOf(destination)) / 1024 / 1024).toFixed(0)} MB on disk`);
