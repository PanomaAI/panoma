import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { layoutFor } from "@panoma/apps";
import { describe, expect, it } from "vitest";
import { fixtureManager } from "../../../packages/apps/src/manager";
import { connectApp } from "./app-client";

/*
 * Explicit release integration lab. It uses a real packed Video, npm dependencies, Chromium,
 * FFmpeg, PGlite, Next and HTTP jobs. The normal suite neither downloads nor renders anything.
 * Set PANOMA_E2E=1, PANOMA_VIDEO_TARBALL, PANOMA_VIDEO_FIXTURE and PANOMA_BROWSER_CACHE.
 * PANOMA_E2E_KEEP=1 preserves the isolated lab for browser review; its path/PIDs are printed.
 */
const enabled = process.env.PANOMA_E2E === "1";
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const base = "http://127.0.0.1:4188";
const appId = "panoma-video";
const identity = "git:apps-e2e-product";
const projectId = "apps-e2e-product";
const terminal = new Set(["done", "failed", "cancelled"]);
interface Job {
  id: string; status: string; error?: string; workspaceId?: string;
  result?: { renders?: { id: string; file: string; review: { status: string; file: string } }[]; [key: string]: unknown };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((done, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing-fixture-address");
  return address.port;
}
async function closeServer(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
}
function packedManifest(bytes: Buffer): Record<string, unknown> {
  const tar = gunzipSync(bytes);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = tar.subarray(offset, offset + 100).toString().split("\0")[0];
    const size = parseInt(tar.subarray(offset + 124, offset + 136).toString().replace(/\0/g, "").trim(), 8) || 0;
    if (name === "package/package.json") return JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString());
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("packed-package-json-missing");
}
async function fixtureRegistry(tarball: string) {
  const bytes = await readFile(tarball);
  const pkg = packedManifest(bytes);
  expect(pkg.name).toBe("@panoma/video");
  let origin = "";
  const server = createServer((request, response) => {
    void (async () => {
      const path = request.url ?? "/";
      const decoded = decodeURIComponent(path);
      if (decoded === "/video.tgz") {
        response.writeHead(200, { "Content-Type": "application/octet-stream" }); response.end(bytes); return;
      }
      const version = { ...pkg, dist: { tarball: origin + "/video.tgz", integrity: "sha512-" + createHash("sha512").update(bytes).digest("base64") } };
      if (decoded === "/@panoma/video" || decoded === "/@panoma/video/latest") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(decoded.endsWith("/latest") ? version : {
          name: pkg.name, "dist-tags": { latest: pkg.version }, versions: { [String(pkg.version)]: version },
        })); return;
      }
      // Only ordinary dependencies reach the public registry. The production manager has no override.
      const upstream = await fetch("https://registry.npmjs.org" + path, {
        headers: { Accept: request.headers.accept ?? "application/json" }, signal: AbortSignal.timeout(30_000),
      });
      response.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream" });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    })().catch(error => { response.writeHead(502); response.end(String(error)); });
  });
  origin = "http://127.0.0.1:" + await listen(server);
  return { server, origin };
}
function launch(args: string[], cwd: string, env: NodeJS.ProcessEnv, logfile: string): ChildProcess {
  const log = openSync(logfile, "a", 0o600);
  try {
    const child = spawn(process.execPath, args, { cwd, env, detached: process.platform !== "win32", stdio: ["ignore", log, log] });
    child.unref(); return child;
  } finally { closeSync(log); }
}
async function stop(child?: ChildProcess) {
  if (!child?.pid || child.exitCode !== null) return;
  const exited = new Promise<void>(done => child.once("exit", () => done()));
  try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGTERM"); } catch { return; }
  await Promise.race([exited, delay(5000)]);
  if (child.exitCode === null) {
    try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL"); } catch { /* Already stopped. */ }
    await Promise.race([exited, delay(1000)]);
  }
}
async function waitHttp(url: string, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  let last = "not-ready";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (response.ok) { await response.arrayBuffer(); return; }
      last = await response.text();
    } catch (error) { last = String(error); }
    await delay(500);
  }
  throw new Error("HTTP lab did not start: " + last.slice(0, 1500));
}
async function submit(path: string, input?: unknown): Promise<string> {
  const response = await fetch(base + path, { method: "POST", headers: {
    Origin: base, "Content-Type": "application/json", "Accept-Language": "en",
  }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const value = await response.json();
  expect(response.status, JSON.stringify(value)).toBe(202);
  return value.id;
}
async function job(id: string): Promise<Job> {
  const response = await fetch(base + "/api/apps/jobs/" + id, { signal: AbortSignal.timeout(30_000) });
  expect(response.status).toBe(200);
  return response.json();
}
async function finished(id: string, timeout = 10 * 60_000): Promise<Job> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await job(id);
    if (terminal.has(value.status)) return value;
    await delay(1000);
  }
  throw new Error("App job did not finish: " + JSON.stringify(await job(id)));
}

describe.skipIf(!enabled)("official Video release integration", () => {
  it("installs a packed app, persists doctor results and renders after an HTTP observer disconnects", async () => {
    const tarball = process.env.PANOMA_VIDEO_TARBALL;
    const fixture = process.env.PANOMA_VIDEO_FIXTURE;
    const browserCache = process.env.PANOMA_BROWSER_CACHE;
    if (!tarball || !fixture || !browserCache) throw new Error("Set PANOMA_VIDEO_TARBALL, PANOMA_VIDEO_FIXTURE and PANOMA_BROWSER_CACHE to release fixtures");
    // Never reuse a server or catalog that happens to be listening at the lab address.
    await expect(fetch(base, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
    const home = await mkdtemp(join(tmpdir(), "panoma-apps-lab-"));
    const oldHome = process.env.PANOMA_HOME;
    const oldDatabase = process.env.DATABASE_URL;
    process.env.PANOMA_HOME = home; delete process.env.DATABASE_URL;
    let next: ChildProcess | undefined;
    let product: ChildProcess | undefined;
    let registry: Server | undefined;
    let passed = false;
    const nextFiles = await Promise.all(["tsconfig.json", "next-env.d.ts"].map(async name => {
      const path = join(repo, "apps/web", name);
      return { path, content: await readFile(path, "utf8") };
    }));
    try {
      const projectRoot = join(home, "product");
      await cp(resolve(fixture), projectRoot, { recursive: true });
      const proxy = await fixtureRegistry(resolve(tarball)); registry = proxy.server;
      await fixtureManager(proxy.origin).install(appId, { probe: async (app, signal) => {
        const session = await connectApp(app, { signal });
        try {
          return ["browser", "ffmpeg"].map(id => ({ id, ...session.guide.requirements[id] as { present: boolean } }));
        } finally { await session.close(); }
      } });
      await closeServer(registry); registry = undefined;
      await cp(resolve(browserCache), layoutFor(appId).browsers, { recursive: true });
      const { schema } = await import("@panoma/db");
      const { openDatabase } = await import("@panoma/db/client");
      const database = await openDatabase();
      try {
        await database.db.insert(schema.projects).values({
          id: projectId, slug: projectId, name: "Acme Catalog", root: projectRoot, identity,
          description: "A local product fixture for the official Video release integration.",
        });
      } finally { await database.close(); }
      // The seeder closes before Next becomes the sole catalog writer.
      const portServer = createServer();
      const productPort = await listen(portServer); await closeServer(portServer);
      const productUrl = "http://127.0.0.1:" + productPort;
      product = launch(["server.js"], projectRoot, {
        NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(productPort), HOST: "127.0.0.1",
      }, join(home, "product.log"));
      await waitHttp(productUrl);
      const nextEnv: NodeJS.ProcessEnv = {
        ...process.env, NODE_ENV: "development", PANOMA_HOME: home, PANOMA_HOST: "127.0.0.1",
        PANOMA_DIST: ".next-apps-lab", PANOMA_NO_UPDATE_CHECK: "1", NEXT_TELEMETRY_DISABLED: "1",
      };
      for (const key of ["DATABASE_URL", "PANOMA_ACCESS_KEY", "PANOMA_OPERATOR_KEY", "NODE_OPTIONS"]) delete nextEnv[key];
      next = launch(["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "4188"],
        join(repo, "apps/web"), nextEnv, join(home, "next.log"));
      await waitHttp(base + "/api/apps");
      const diagnosis = await finished(await submit("/api/apps/" + appId + "/doctor"));
      expect(diagnosis.status, JSON.stringify(diagnosis)).toBe("done");
      const detail = await (await fetch(base + "/api/apps/" + appId)).json();
      expect(detail).toMatchObject({ ready: true, requirements: { browser: { present: true }, ffmpeg: { present: true } } });
      const id = await submit("/api/apps/" + appId + "/jobs", {
        identity, projectId, tool: "panoma_video_auto",
        input: { goal: "promo", format: "h", langs: ["en"], until: "preview", brain: "none", voice: "none", url: productUrl },
      });
      expect((await job(id)).status).toBe("running");
      const observer = new AbortController();
      let disconnected = false;
      const observation = fetch(base + "/api/apps/jobs/" + id + "?wait=1", { signal: observer.signal }).then(async response => {
        await response.arrayBuffer();
      }).catch(error => { if (!observer.signal.aborted) throw error; disconnected = true; });
      await delay(100); observer.abort(); await observation;
      expect(disconnected).toBe(true);
      const result = await finished(id);
      expect(result.status, JSON.stringify(result)).toBe("done");
      expect(result.result?.renders?.length).toBeGreaterThan(0);
      const render = result.result!.renders![0]!;
      expect(["pass", "warn"]).toContain(render.review.status);
      expect((await stat(render.file)).size).toBeGreaterThan(10_000);
      expect((await stat(render.review.file)).size).toBeGreaterThan(0);
      const artifact = await fetch(base + "/api/apps/jobs/" + id + "/artifact?path=" + encodeURIComponent(render.file), {
        headers: { Range: "bytes=0-63" },
      });
      expect(artifact.status).toBe(206);
      expect(artifact.headers.get("content-type")).toBe("video/mp4");
      expect(Buffer.from(await artifact.arrayBuffer()).includes(Buffer.from("ftyp"))).toBe(true);
      const review = await finished(await submit("/api/apps/" + appId + "/jobs", {
        identity, projectId, tool: "panoma_video_review", input: { render_id: render.id, detail: "concise" },
      }));
      expect(review.status, JSON.stringify(review)).toBe("done");
      const lab = { home, url: base, projectSlug: projectId, projectUrl: base + "/p/" + projectId + "/video",
        nextPid: next.pid, productPid: product.pid, jobId: id, mp4: render.file };
      await writeFile(join(home, "lab.json"), JSON.stringify(lab, null, 2) + "\n");
      console.info("PANOMA_E2E_LAB=" + JSON.stringify(lab));
      passed = true;
    } finally {
      if (registry) await closeServer(registry);
      if (process.env.PANOMA_E2E_KEEP !== "1" || !passed) {
        await stop(next); await stop(product);
        if (passed) await rm(home, { recursive: true, force: true });
        else console.info("PANOMA_E2E_FAILURE_LOGS=" + home);
      }
      if (oldHome === undefined) delete process.env.PANOMA_HOME; else process.env.PANOMA_HOME = oldHome;
      if (oldDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldDatabase;
      for (const file of nextFiles) {
        if (await readFile(file.path, "utf8") !== file.content) await writeFile(file.path, file.content);
      }
    }
  }, 15 * 60_000);
});
