import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureManifest, fixtureTarball } from "./fixtures";
import { fixtureManager, activate, cleanData, installedApp, readCurrent, readStaged, reconcileDisk, rollback, uninstall } from "./manager";
import { layoutFor } from "./layout";

let home: string;
let server: Server;
let origin: string;
let tarballs: Map<string, Buffer>;
let manifests: Map<string, Record<string, unknown>>;
const probe = vi.fn(async () => [{ id: "browser", present: false }, { id: "ffmpeg", present: true }]);

function publish(version: string, options: { protocol?: string; missingEntry?: boolean } = {}) {
  const manifest = fixtureManifest();
  if (options.protocol) manifest.protocol = options.protocol;
  const pkg = {
    name: "@panoma/video", version, type: "module", panoma: { app: manifest },
    scripts: { postinstall: 'node -e "require(\'fs\').writeFileSync(\'postinstall-ran\',\'bad\')"' },
  };
  const files: Record<string, string> = {
    "package.json": JSON.stringify(pkg), "LICENSE": "Test license", "NOTICE.md": "Test notice", "docs/codecs.md": "Test codecs",
  };
  if (!options.missingEntry) files["dist/mcp.js"] = "process.stdin.resume();";
  const tarball = fixtureTarball(files);
  tarballs.set(version, tarball);
  manifests.set(version, { ...pkg, dist: { tarball: `${origin}/video-${version}.tgz`, integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}` } });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-app-install-"));
  vi.stubEnv("PANOMA_HOME", home);
  vi.stubEnv("NODE_ENV", "test");
  tarballs = new Map(); manifests = new Map(); probe.mockClear();
  server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url!, "http://localhost").pathname);
    if (path.endsWith(".tgz")) {
      const version = path.slice("/video-".length, -4);
      const tarball = tarballs.get(version);
      response.writeHead(tarball ? 200 : 404); response.end(tarball); return;
    }
    if (path.toLowerCase() === "/@panoma/video") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ name: "@panoma/video", "dist-tags": { latest: "0.2.0" }, versions: Object.fromEntries(manifests) })); return;
    }
    if (path === "/@panoma/video/latest") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(manifests.get("0.2.0"))); return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  publish("0.2.0");
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true });
});

describe("official installation against a real fixture npm registry", () => {
  it("installs with npm, suppresses lifecycle scripts, stages updates, rolls back and preserves data", async () => {
    const manager = fixtureManager(origin);
    const first = await manager.install("panoma-video", { probe });
    expect(first.status).toBe("installed");
    expect(first.requirements[0]?.present).toBe(false);
    expect(await readdir(layoutFor("panoma-video").browsers).catch(() => undefined)).toBeUndefined();
    expect(await readFile(join(first.packageRoot, "postinstall-ran")).catch(() => undefined)).toBeUndefined();
    publish("0.2.1");
    await manager.install("panoma-video", { version: "0.2.1", activate: false, probe });
    expect((await readCurrent("panoma-video"))?.version).toBe("0.2.0");
    expect(await readStaged("panoma-video")).toBe("0.2.1");
    await activate("panoma-video", "0.2.1");
    expect((await readCurrent("panoma-video"))?.previous).toBe("0.2.0");
    await rollback("panoma-video");
    expect((await installedApp("panoma-video")).version).toBe("0.2.0");
    const data = layoutFor("panoma-video").data;
    await mkdir(data); await writeFile(join(data, "production.json"), "keep");
    await uninstall("panoma-video", { keepData: true });
    expect(await readFile(join(data, "production.json"), "utf8")).toBe("keep");
    expect((await cleanData("panoma-video")).removedBytes).toBe(4);
  });

  it("leaves the active pointer intact after package validation, entry and startup failures", async () => {
    const manager = fixtureManager(origin);
    await manager.install("panoma-video", { version: "0.2.0", probe });
    const original = await readFile(layoutFor("panoma-video").current, "utf8");
    publish("0.2.1", { protocol: "2" });
    publish("0.2.2", { missingEntry: true });
    publish("0.2.3");
    const cases = [
      { version: "0.2.1", probe, error: "incompatible-protocol" },
      { version: "0.2.2", probe, error: "manifest-file-missing-or-outside" },
      { version: "0.2.3", probe: async () => { throw new Error("does-not-start"); }, error: "does-not-start" },
    ];
    for (const test of cases) {
      await expect(manager.install("panoma-video", test)).rejects.toThrow(test.error);
      expect(await readFile(layoutFor("panoma-video").current, "utf8")).toBe(original);
      expect((await readdir(layoutFor("panoma-video").versions)).some((name) => name.endsWith(".partial"))).toBe(false);
    }
  });

  it("cleans partial installation after npm failure and cancellation without replacing the active version", async () => {
    await fixtureManager(origin).install("panoma-video", { version: "0.2.0", probe });
    const original = await readFile(layoutFor("panoma-video").current, "utf8");
    const failing = fixtureManager(origin, async () => { throw new Error("download-failed"); });
    await expect(failing.install("panoma-video", { version: "0.2.4", probe })).rejects.toThrow("download-failed");
    const abort = new AbortController();
    const cancelled = fixtureManager(origin, async () => { abort.abort(); throw new Error("cancelled"); });
    await expect(cancelled.install("panoma-video", { version: "0.2.4", signal: abort.signal, probe })).rejects.toThrow("cancelled");
    expect(await readFile(layoutFor("panoma-video").current, "utf8")).toBe(original);
    expect(await readdir(layoutFor("panoma-video").versions)).toEqual(["0.2.0"]);
  });

  it("reconciles orphan partials and reports a broken pointer without deleting productions", async () => {
    const layout = layoutFor("panoma-video");
    await mkdir(join(layout.versions, "0.2.0.partial"), { recursive: true });
    await writeFile(layout.current, JSON.stringify({ version: "0.2.0", activatedAt: new Date().toISOString() }));
    const result = await reconcileDisk();
    expect(result.removedPartials).toBe(1);
    expect(result.apps[0]?.status).toBe("broken");
    expect(await readFile(layout.current, "utf8")).toContain("0.2.0");
  });

  it("rejects tampered tarball bytes before starting the app", async () => {
    const manager = fixtureManager(origin);
    await manager.install("panoma-video", { version: "0.2.0", probe });
    const original = await readFile(layoutFor("panoma-video").current, "utf8");
    publish("0.2.1");
    tarballs.set("0.2.1", Buffer.from("tampered"));
    probe.mockClear();
    await expect(manager.install("panoma-video", { version: "0.2.1", probe })).rejects.toThrow("process-failed");
    expect(probe).not.toHaveBeenCalled();
    expect(await readFile(layoutFor("panoma-video").current, "utf8")).toBe(original);
  });

  it("does not break an active version when a staged update disappears", async () => {
    await fixtureManager(origin).install("panoma-video", { version: "0.2.0", probe });
    await writeFile(layoutFor("panoma-video").staged, JSON.stringify({ version: "0.2.1" }));
    const result = await reconcileDisk();
    expect(result.apps[0]).toMatchObject({ status: "installed", current: { version: "0.2.0" }, error: expect.stringContaining("staged-update-invalid") });
    expect(await readStaged("panoma-video")).toBeUndefined();
  });

  it("preserves a partial while its guardian lives and reclaims a stale lock on the next operation", async () => {
    const layout = layoutFor("panoma-video");
    const lock = join(layout.root, ".operation-lock");
    await mkdir(lock, { recursive: true });
    await mkdir(join(layout.versions, "0.2.0.partial"), { recursive: true });
    await writeFile(join(lock, "pid"), "0");
    await writeFile(join(lock, "worker.pid"), String(process.pid));
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    expect((await reconcileDisk()).removedPartials).toBe(0);
    await expect(fixtureManager(origin).install("panoma-video", { version: "0.2.0", probe })).rejects.toThrow("app-operation-in-progress");
    await writeFile(join(lock, "worker.pid"), "0");
    await fixtureManager(origin).install("panoma-video", { version: "0.2.0", probe });
    expect((await readCurrent("panoma-video"))?.version).toBe("0.2.0");
    expect(await readdir(layout.versions)).toEqual(["0.2.0"]);
  });
});
