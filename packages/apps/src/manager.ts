import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { assertVersion, validateManifest, type AppManifest } from "./manifest";
import { OFFICIAL, officialApp } from "./official";
import { assertManagedPath, insideDir, layoutFor, readJson, writeJsonAtomic } from "./layout";
import { BROWSER_IDLE_MS, BROWSER_TOTAL_MS, GUIDE_TIMEOUT_MS, buildAppEnvironment } from "./environment";
import { createRegistryClient, NPM_REGISTRY, registryVersion, type RegistryClient } from "./registry";
import { findNpm, runProcess, type ProcessRequest } from "./process";
import { AppFault, asAppFault } from "./faults";
import { nodeFloorFault } from "./engines";

export interface RequirementStatus {
  id: string;
  present: boolean;
  version?: string;
  [key: string]: unknown;
}
export interface InstalledApp {
  id: string;
  pkg: string;
  version: string;
  manifest: AppManifest;
  /** The npm prefix, whose node_modules contains the app and its dependencies. */
  root: string;
  packageRoot: string;
  entry: string;
}
export type AppProbe = (app: InstalledApp, signal?: AbortSignal) => Promise<RequirementStatus[]>;

/*
  Zod's own refusal is a pretty-printed array of issues, and it used to arrive on screen as one.
  What a person needs to know is that the app did not answer with the requirements it declares.
 */
function readIds(requirements: unknown): string[] {
  const shape = z.object({ id: z.string(), present: z.boolean() }).passthrough();
  try {
    return z.array(shape).max(10).parse(requirements).map((item) => item.id);
  } catch { throw new AppFault("malformed-requirements"); }
}
async function checkedProbe(app: InstalledApp, probe: AppProbe, parent?: AbortSignal): Promise<RequirementStatus[]> {
  parent?.throwIfAborted();
  const deadline = AbortSignal.timeout(GUIDE_TIMEOUT_MS);
  const signal = parent ? AbortSignal.any([parent, deadline]) : deadline;
  let abort: (() => void) | undefined;
  try {
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(parent?.aborted ? new AppFault("cancelled") : new AppFault("does-not-start", "guide timeout"));
      signal.addEventListener("abort", abort, { once: true });
    });
    const requirements = await Promise.race([probe(app, signal), cancelled]);
    const ids = readIds(requirements);
    const declared = app.manifest.requirements.map((item) => item.id);
    if (new Set(ids).size !== ids.length || declared.some((id) => !ids.includes(id))) {
      throw new AppFault("malformed-requirements");
    }
    return requirements;
  } finally { if (abort) signal.removeEventListener("abort", abort); }
}
export interface InstallOptions {
  version?: string;
  activate?: boolean;
  signal?: AbortSignal;
  onProgress?: (line: string) => void;
  probe: AppProbe;
}
export interface InstallOutcome extends InstalledApp {
  status: "installed" | "staged";
  previousVersion?: string;
  requirements: RequirementStatus[];
}
export interface CurrentApp { version: string; activatedAt: string; previous?: string }
export interface DiskAppState {
  id: string;
  status: "absent" | "installed" | "staged" | "broken";
  current?: CurrentApp;
  stagedVersion?: string;
  app?: InstalledApp;
  error?: string;
}
export interface DiskState { apps: DiskAppState[]; removedPartials: number }

const currentSchema = z.object({
  version: z.string().transform(assertVersion),
  activatedAt: z.string().datetime(),
  previous: z.string().transform(assertVersion).optional(),
}).strict();

export async function readCurrent(id: string): Promise<CurrentApp | undefined> {
  const path = layoutFor(id).current;
  await assertManagedPath(path);
  const raw = await readJson(path);
  if (raw === undefined) return undefined;
  // A pointer this catalog wrote and can no longer read is a damaged installation, not a blob.
  try { return currentSchema.parse(raw); }
  catch (error) { throw error instanceof AppFault ? error : new AppFault("disk-unreadable"); }
}

export async function readStaged(id: string): Promise<string | undefined> {
  const path = layoutFor(id).staged;
  await assertManagedPath(path);
  const raw = await readJson(path);
  if (raw === undefined) return undefined;
  try { return z.object({ version: z.string().transform(assertVersion) }).strict().parse(raw).version; }
  catch (error) { throw error instanceof AppFault ? error : new AppFault("disk-unreadable"); }
}

async function inspectAt(id: string, version: string, root: string): Promise<InstalledApp> {
  const official = officialApp(id);
  assertVersion(version);
  await assertManagedPath(root);
  const packageRoot = join(root, "node_modules", ...official.pkg.split("/"));
  if (!(await insideDir(root, packageRoot))) throw new AppFault("package-outside-installation");
  const declared = await readFile(join(packageRoot, "package.json"), "utf8");
  let pkg: { name?: string; version?: string };
  try { pkg = JSON.parse(declared) as { name?: string; version?: string }; }
  catch { throw new AppFault("broken-package-manifest"); }
  if (pkg.name !== official.pkg || pkg.version !== version) throw new AppFault("package-version-mismatch");
  const manifest = validateManifest(pkg);
  if (manifest.id !== id) throw new AppFault("manifest-id-mismatch");
  if (!official.protocols.includes(manifest.protocol)) throw new AppFault("incompatible-protocol");
  for (const path of [manifest.entry.mcp, ...Object.values(manifest.legal)]) {
    const file = join(packageRoot, path);
    const contained = await insideDir(packageRoot, file);
    if (!contained || !(await stat(file)).isFile()) throw new AppFault("manifest-file-missing-or-outside");
  }
  return { id, pkg: official.pkg, version, manifest, root, packageRoot, entry: join(packageRoot, manifest.entry.mcp) };
}

export async function installedApp(id: string, version?: string): Promise<InstalledApp> {
  const selected = version ?? (await readCurrent(id))?.version;
  if (!selected) throw new AppFault("not-installed");
  return inspectAt(id, assertVersion(selected), join(layoutFor(id).versions, selected));
}

function alive(pid: unknown): boolean {
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

async function locked<T>(id: string, work: () => Promise<T>): Promise<T> {
  const layout = layoutFor(id);
  await assertManagedPath(layout.root);
  await mkdir(layout.root, { recursive: true });
  const lock = join(layout.root, ".operation-lock");
  await assertManagedPath(lock);
  for (let attempt = 0; ; attempt += 1) {
    try { await mkdir(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw asAppFault(error);
      if (attempt) throw new AppFault("app-operation-in-progress", undefined, { cause: error });
      // A fresh orphan is initially left alone so its guardian can finish. A later user
      // operation retries reclamation; recovery never depends on restarting the host again.
      await reconcileDisk();
    }
  }
  try {
    await writeFile(join(lock, "pid"), String(process.pid));
    return await work();
  } finally { await rm(lock, { recursive: true, force: true }); }
}

async function activateUnlocked(id: string, version: string): Promise<void> {
  await installedApp(id, version);
  const previous = await readCurrent(id);
  // What to fall back to: whatever this replaces, or —when it replaces itself— what it already had.
  const fallback = previous?.version && previous.version !== version ? previous.version : previous?.previous;
  await writeJsonAtomic(layoutFor(id).current, {
    version,
    activatedAt: new Date().toISOString(),
    ...(fallback ? { previous: fallback } : {}),
  });
  if ((await readStaged(id)) === version) await rm(layoutFor(id).staged, { force: true });
}

export async function activate(id: string, version: string): Promise<void> {
  return locked(id, () => activateUnlocked(id, assertVersion(version)));
}

export async function rollback(id: string): Promise<void> {
  return locked(id, async () => {
    const current = await readCurrent(id);
    if (!current?.previous) throw new AppFault("no-previous-version");
    await activateUnlocked(id, current.previous);
  });
}

interface ManagerDependencies {
  registry: RegistryClient;
  registryOrigin: string;
  run: (request: ProcessRequest) => Promise<void>;
}

/** Not exported by the package: fixtures can inject a registry without a runtime override. */
export function createAppManager(dependencies: ManagerDependencies) {
  return {
    async install(id: string, options: InstallOptions): Promise<InstallOutcome> {
      const official = officialApp(id);
      return locked(id, async () => {
        options.signal?.throwIfAborted();
        /*
          `force` because the cache remembers a failure for a day. Opening the app's page calls the
          same registry through apps.ts with no options, and a check that threw still writes an
          entry — so pressing Install after a publish that succeeded would answer `offline` until
          the entry aged out. Forcing costs one request and is safe with the registry down: a fetch
          that throws still falls through to the version already known.
         */
        const asked = await dependencies.registry.latest(official.pkg, { explicit: true, force: true });
        const selected = options.version ?? asked.version;
        if (!selected) throw new AppFault("offline");
        const version = assertVersion(selected);
        const layout = layoutFor(id);
        const partial = join(layout.versions, `${version}.partial`);
        const final = join(layout.versions, version);
        await assertManagedPath(partial);
        await mkdir(layout.versions, { recursive: true });
        let app: InstalledApp;
        let requirements: RequirementStatus[];
        if (await stat(final).then(() => true, () => false)) {
          app = await installedApp(id, version);
          requirements = await checkedProbe(app, options.probe, options.signal);
        } else {
          await rm(partial, { recursive: true, force: true });
          await mkdir(partial);
          try {
            const npm = findNpm();
            if (!npm) throw new AppFault("npm-not-found");
            /*
              The declared floor guards a real install only. Fixtures inject a loopback origin
              and build a package that declares no engines, so checking here unconditionally
              would fail every install test on the very Node range this exists to serve. The
              authoritative half — reading what npm itself refused — runs on both.
             */
            if (dependencies.registryOrigin === NPM_REGISTRY) {
              const floor = nodeFloorFault(id);
              if (floor) throw floor;
            }
            const home = join(partial, ".npm-home");
            await mkdir(home);
            const config = join(home, "npmrc");
            await writeFile(config, "", { mode: 0o600 });
            const globalConfig = join(home, "global-npmrc");
            await writeFile(globalConfig, "", { mode: 0o600 });
            const env = buildAppEnvironment(id);
            env.HOME = home;
            env.USERPROFILE = home;
            env.npm_config_cache = join(home, "cache");
            env.npm_config_userconfig = config;
            env.npm_config_globalconfig = globalConfig;
            env.npm_config_registry = dependencies.registryOrigin;
            // npm's own install and audit settings cannot be inherited from the user's npmrc.
            const args = [
              "install", "--prefix", partial, "--ignore-scripts", "--engine-strict",
              "--no-audit", "--no-fund", "--no-package-lock", "--fetch-retries=0",
              "--registry", dependencies.registryOrigin, `${official.pkg}@${version}`,
            ];
            const leasePath = join(layout.root, ".operation-lock", "worker.pid");
            await assertManagedPath(leasePath);
            await dependencies.run({
              file: npm.file, args: [...npm.args, ...args], cwd: partial, env,
              signal: options.signal, onProgress: options.onProgress, leasePath,
            });
            await rm(home, { recursive: true, force: true });
            app = await inspectAt(id, version, partial);
            await assertTreeContained(partial);
            options.signal?.throwIfAborted();
            requirements = await checkedProbe(app, options.probe, options.signal);
            options.signal?.throwIfAborted();
            await rename(partial, final);
            app = await installedApp(id, version);
          } catch (error) {
            await rm(partial, { recursive: true, force: true });
            throw asAppFault(error);
          }
        }
        options.signal?.throwIfAborted();
        const before = await readCurrent(id);
        if (options.activate === false) await writeJsonAtomic(layout.staged, { version });
        else await activateUnlocked(id, version);
        return {
          ...app, requirements, previousVersion: before?.version,
          status: options.activate === false ? "staged" : "installed",
        };
      });
    },
    async installBrowser(id: string, onProgress?: (line: string) => void, signal?: AbortSignal): Promise<void> {
      return locked(id, async () => {
        const app = await installedApp(id);
        const browser = app.manifest.requirements.find((item) => item.kind === "playwright-browser");
        if (!browser || browser.kind !== "playwright-browser") throw new AppFault("browser-not-declared");
        const candidates = [
          join(app.root, "node_modules", "playwright", "cli.js"),
          join(app.packageRoot, "node_modules", "playwright", "cli.js"),
        ];
        const entry = await firstContainedFile(app.root, candidates);
        if (!entry) throw new AppFault("playwright-not-installed");
        const layout = layoutFor(id);
        await assertManagedPath(layout.browsers);
        await mkdir(layout.browsers, { recursive: true });
        const leasePath = join(layoutFor(id).root, ".operation-lock", "worker.pid");
        await assertManagedPath(leasePath);
        await dependencies.run({
          file: process.execPath, args: [entry, "install", browser.browser], cwd: app.root,
          env: buildAppEnvironment(id), onProgress, signal, leasePath,
          // Hundreds of megabytes: what must not stop is the progress, not the clock.
          idleMs: BROWSER_IDLE_MS, timeoutMs: BROWSER_TOTAL_MS,
        });
      });
    },
  };
}

const manager = createAppManager({
  registry: { latest: registryVersion }, registryOrigin: NPM_REGISTRY, run: runProcess,
});
export const install = manager.install;
export const installBrowser = manager.installBrowser;
export function update(id: string, options: Omit<InstallOptions, "activate">): Promise<InstallOutcome> {
  return install(id, { ...options, activate: false });
}
export async function probeRequirements(
  id: string, probe: AppProbe, signal?: AbortSignal,
): Promise<RequirementStatus[]> {
  return checkedProbe(await installedApp(id), probe, signal);
}

async function firstContainedFile(root: string, candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (!(await insideDir(root, candidate))) continue;
    if (await stat(candidate).then((entry) => entry.isFile(), () => false)) return candidate;
  }
  return undefined;
}

/** npm bins may be symlinks, but every one must resolve inside the installation npm wrote. */
async function assertTreeContained(root: string, path = root): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isSymbolicLink()) {
      if (!(await insideDir(root, child))) throw new AppFault("broken-installation");
    } else if (entry.isDirectory()) await assertTreeContained(root, child);
  }
}

/*
 * How much a managed directory occupies. Symbolic links count as nothing —their target is
 * measured where it lives, or not at all when it lives elsewhere— and a directory that
 * disappears while being read contributes what was already counted.
 *
 * `withFileTypes` is what makes it affordable: the kind of each entry arrives with the listing,
 * so only files need a call of their own. The previous shape asked the system twice about every
 * directory, once to learn it was one and again to list it.
 */
async function subtreeBytes(path: string): Promise<number> {
  const entries = await readdir(path, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw asAppFault(error);
  });
  let bytes = 0;
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) bytes += await subtreeBytes(child);
    else bytes += (await lstat(child).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw asAppFault(error);
    }))?.size ?? 0;
  }
  return bytes;
}

export async function directoryBytes(path: string): Promise<number> {
  const entry = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw asAppFault(error);
  });
  if (!entry || entry.isSymbolicLink()) return 0;
  if (!entry.isDirectory()) return entry.size;
  return subtreeBytes(path);
}

export async function cleanData(id: string): Promise<{ removedBytes: number }> {
  return locked(id, async () => {
    const data = layoutFor(id).data;
    await assertManagedPath(data);
    const removedBytes = await directoryBytes(data);
    await rm(data, { recursive: true, force: true });
    return { removedBytes };
  });
}

export async function uninstall(id: string, options: { keepData: boolean } = { keepData: true }): Promise<void> {
  if (!options.keepData) throw new AppFault("use-clean-data");
  return locked(id, async () => {
    const layout = layoutFor(id);
    for (const path of [layout.versions, layout.current, layout.staged, layout.browsers, layout.logs]) {
      await assertManagedPath(path);
      await rm(path, { recursive: true, force: true });
    }
  });
}

export async function reconcileDisk(): Promise<DiskState> {
  const result: DiskState = { apps: [], removedPartials: 0 };
  for (const official of OFFICIAL) {
    const layout = layoutFor(official.id);
    let current: CurrentApp | undefined;
    try {
      await assertManagedPath(layout.root);
      const lock = join(layout.root, ".operation-lock");
      const pid = Number(await readFile(join(lock, "pid"), "utf8").catch(() => "0"));
      const workerPid = Number(await readFile(join(lock, "worker.pid"), "utf8").catch(() => "0"));
      const lockEntry = await stat(lock).catch(() => undefined);
      // A newly acquired lock may not have its pid written yet. Never reap that window.
      const busy = alive(pid) || alive(workerPid) || (!!lockEntry && Date.now() - lockEntry.mtimeMs < 30_000);
      if (!busy) {
        if (lockEntry) await rm(lock, { recursive: true, force: true });
        for (const name of await readdir(layout.versions).catch(() => [])) {
          if (!name.endsWith(".partial")) continue;
          const path = join(layout.versions, name);
          await assertManagedPath(path);
          await rm(path, { recursive: true, force: true });
          result.removedPartials += 1;
        }
      }
      current = await readCurrent(official.id);
      const app = current ? await installedApp(official.id, current.version) : undefined;
      let stagedVersion: string | undefined;
      let error: string | undefined;
      try {
        stagedVersion = await readStaged(official.id);
        if (stagedVersion) await installedApp(official.id, stagedVersion);
      } catch (caught) {
        // A damaged update must not disable a working active installation. Remove only the
        // staging pointer; the version directory and all productions remain available to inspect.
        await assertManagedPath(layout.staged);
        if (!busy) await rm(layout.staged, { force: true });
        stagedVersion = undefined;
        error = "staged-update-invalid: " + (caught instanceof Error ? caught.message : "unreadable");
      }
      if (!current) {
        const status = error ? "broken" : stagedVersion ? "staged" : "absent";
        result.apps.push({ id: official.id, status, stagedVersion, error });
      } else {
        const status = stagedVersion ? "staged" : "installed";
        result.apps.push({ id: official.id, status, current, stagedVersion, app, error });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "disk-unreadable";
      result.apps.push({ id: official.id, status: "broken", current, error: message });
    }
  }
  return result;
}

/** Test-only construction is deliberately absent from the public package entry point. */
export function fixtureManager(origin: string, run = runProcess) {
  if (process.env.NODE_ENV !== "test") throw new AppFault("fixtures-are-test-only");
  const url = new URL(origin);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (!loopback || url.protocol !== "http:") throw new AppFault("fixture-registry-must-be-loopback");
  return createAppManager({ registry: createRegistryClient({ origin }), registryOrigin: origin, run });
}
