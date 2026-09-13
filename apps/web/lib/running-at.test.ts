import { createServer as tcpServer } from "node:net";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { declaredPorts, listenersOf, listening, runningAt, scriptsUnder, serversFromFolder } from "./running-at";

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function listen(): Promise<number> {
  const server = createServer((_request, response) => { response.statusCode = 405; response.end(); });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}
async function project(scripts: Record<string, Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "panoma-running-at-"));
  dirs.push(root);
  for (const [path, value] of Object.entries(scripts)) {
    await mkdir(join(root, path), { recursive: true });
    await writeFile(join(root, path, "package.json"), JSON.stringify({ name: path || "root", scripts: value }));
  }
  return root;
}

describe("the addresses a project seems to be running at", () => {
  it("reads every way a script names its port, once each, and never a bare number", () => {
    expect(declaredPorts({
      dev: "next dev -H ${PANOMA_HOST:-127.0.0.1} --port ${PORT:-4173}",
      start: "next start --port 4173",
      site: "next dev --port=4174",
      api: "PORT=3000 node server.js",
      short: "vite -p 5173",
      proxy: "open http://localhost:8080/health",
      build: "tsup --target node22 --minify",
      version: "echo 2.0.31",
    })).toEqual([4173, 4174, 3000, 5173, 8080]);
    expect(declaredPorts({ odd: "--port 0", huge: "--port 70000", none: 7 })).toEqual([]);
  });

  it("gathers the scripts of the root and of one workspace level, prefixed by their package", async () => {
    const root = await project({ "": { dev: "pnpm -r dev" }, "apps/web": { dev: "next dev --port 4173" }, "packages/core": { build: "tsup" } });
    await mkdir(join(root, "apps", "node_modules", "x"), { recursive: true });
    expect(await scriptsUnder(root)).toEqual({ dev: "pnpm -r dev", "apps/web:dev": "next dev --port 4173", "packages/core:build": "tsup" });
    expect(await scriptsUnder(join(root, "nowhere"))).toEqual({});
  });

  it("parses lsof's field output into listeners, whatever interface they bound", () => {
    expect(listenersOf("p123\nn127.0.0.1:4173\nn*:4180\np456\nn[::1]:8080\nnlocalhost:60\n")).toEqual([
      { pid: 123, port: 4173 }, { pid: 123, port: 4180 }, { pid: 456, port: 8080 }, { pid: 456, port: 60 },
    ]);
    expect(listenersOf("")).toEqual([]);
  });

  it("answers a live HTTP port, refuses a dead one and a socket that speaks no HTTP, within the leash", async () => {
    const port = await listen();
    expect(await listening(port)).toBe(true);
    /* A development server's sidecar: open, silent, not a page anyone can open. */
    const mute = tcpServer((socket) => { socket.on("data", () => undefined); });
    await new Promise<void>((resolve) => mute.listen(0, "127.0.0.1", resolve));
    expect(await listening((mute.address() as { port: number }).port)).toBe(false);
    await new Promise<void>((resolve) => mute.close(() => resolve()));
    const dead = tcpServer();
    await new Promise<void>((resolve) => dead.listen(0, "127.0.0.1", resolve));
    const gone = (dead.address() as { port: number }).port;
    await new Promise<void>((resolve) => dead.close(() => resolve()));
    expect(await listening(gone)).toBe(false);
  });

  it("offers a declared port only while it answers, and a folder's listener only where lsof can say", async () => {
    const live = await listen();
    const root = await project({ "": { dev: `next dev --port ${live}`, api: "PORT=1 node api" } });
    /* A fake lsof: one listener from inside the folder, one from elsewhere, one already declared. The real one prints real paths. */
    const other = await listen();
    const real = await realpath(root);
    const exec = (async (_file: string, args: string[]) =>
      args.includes("-sTCP:LISTEN")
        ? { stdout: `p11\nn127.0.0.1:${other}\np22\nn*:${live}\np33\nn127.0.0.1:1\n`, stderr: "" }
        : { stdout: `p11\nn${join(real, "apps", "web")}\np22\nn${real}\np33\nn${tmpdir()}\n`, stderr: "" }) as never;
    expect(await runningAt(root, { platform: "darwin", exec })).toEqual([
      { url: `http://127.0.0.1:${live}`, why: "declared" },
      { url: `http://127.0.0.1:${other}`, why: "folder" },
    ]);
    expect(await runningAt(root, { platform: "win32", exec })).toEqual([{ url: `http://127.0.0.1:${live}`, why: "declared" }]);
    expect(await serversFromFolder(root, "win32", exec)).toEqual([]);
    const broken = (async () => { throw new Error("lsof: command not found"); }) as never;
    expect(await runningAt(root, { platform: "linux", exec: broken })).toEqual([{ url: `http://127.0.0.1:${live}`, why: "declared" }]);
  });
});
