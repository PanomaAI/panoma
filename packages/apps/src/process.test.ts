import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { findNpm, PROCESS_GUARDIAN, runProcess } from "./process";

let home: string;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "panoma-app-process-")); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

it("prefers the npm JavaScript entry adjacent to its own Node interpreter", () => {
  const node = join(home, "bin", "node");
  const npm = join(home, "lib", "node_modules", "npm", "bin", "npm-cli.js");
  expect(findNpm({ execPath: node, exists: (path) => path === npm })).toEqual({ file: node, args: [npm], source: "adjacent-cli" });
});

it("a killed installer host leaves no command or grandchild, even when output continues and TERM is ignored", async () => {
  const marker = join(home, "workers.json");
  const lease = join(home, "worker.pid");
  const command = join(home, "command.cjs");
  const parentEntry = join(home, "parent.cjs");
  const stubborn = "process.on('SIGTERM',()=>{});process.stdout.on('error',()=>{});setInterval(()=>process.stdout.write('working\\n'),10);";
  await writeFile(command, `
const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');
process.on('SIGTERM',()=>{});process.stdout.on('error',()=>{});
const child=spawn(process.execPath,['-e',${JSON.stringify(stubborn)}],{stdio:'inherit'});
writeFileSync(${JSON.stringify(marker)},JSON.stringify({command:process.pid,grandchild:child.pid}));
setInterval(()=>process.stdout.write('working\\n'),10);
`);
  await writeFile(parentEntry, `
const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['-e',${JSON.stringify(PROCESS_GUARDIAN)},'--',${JSON.stringify(lease)},process.execPath,${JSON.stringify(command)}],{detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
child.stdout.resume();child.stderr.resume();setInterval(()=>{},1000);
`);
  const parent = spawn(process.execPath, [parentEntry], { stdio: "ignore" });
  let pids: number[] = [];
  try {
    await expect.poll(async () => {
      const value = JSON.parse(await readFile(marker, "utf8").catch(() => "{}")) as { command?: number; grandchild?: number };
      if (value.command && value.grandchild) pids = [value.command, value.grandchild];
      return pids.length;
    }).toBe(2);
    pids.push(Number(await readFile(lease, "utf8")));
    const exited = once(parent, "exit"); parent.kill("SIGKILL"); await exited;
    await expect.poll(() => pids.some(pid => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    }), { timeout: 6000 }).toBe(false);
  } finally {
    parent.kill("SIGKILL");
    for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch { /* Already stopped. */ } }
  }
});

/*
  A browser download is hundreds of megabytes: what says it is alive is that it keeps reporting,
  not the clock. A total ceiling killed a slow but healthy download halfway and called it
  `timeout`, which reads like a program that hung.
 */
it("kills a command that goes quiet, keeps one that keeps reporting, and says what it last said", async () => {
  const talking = runProcess({
    file: process.execPath, cwd: home, env: {}, idleMs: 400,
    args: ["-e", "let n=0;const t=setInterval(()=>{process.stdout.write(`Downloading | ${++n*10}% of 550 MiB\\n`);if(n===8){clearInterval(t)}},100)"],
  });
  await expect(talking).resolves.toBeUndefined();
  const quiet = runProcess({
    file: process.execPath, cwd: home, env: {}, idleMs: 300,
    args: ["-e", "process.stdout.write('Downloading | 40% of 550 MiB\\n');setInterval(()=>{},1000)"],
  });
  await expect(quiet).rejects.toThrow("stalled: Downloading | 40% of 550 MiB");
});

it("cancels a spawned process and bounds the output included in an error", async () => {
  const abort = new AbortController();
  const running = runProcess({
    file: process.execPath, args: ["-e", "process.stdout.write('ready\\n'); setInterval(()=>{},1000)"],
    cwd: home, env: {}, signal: abort.signal, onProgress: () => abort.abort(),
  });
  await expect(running).rejects.toThrow("cancelled");
  try {
    await runProcess({ file: process.execPath, args: ["-e", "process.stderr.write('x'.repeat(100000)); process.exitCode=1"], cwd: home, env: {} });
    throw new Error("expected failure");
  } catch (error) {
    expect((error as Error).message.length).toBeLessThan(65_560);
    expect((error as Error).message).toContain("process-failed:");
  }
});

/*
  The engine refusal is read here, at the throw site, and not later in the browser — because this
  message is what gets written to a text column and re-read on every page load afterwards. A code
  parsed now is a code that is still translatable a week from now; a wall of npm output parsed at
  render time would have to be re-parsed by every reader forever, and the row would still hold
  the wall.

  The block below is npm 11.19.0's real output, captured on 10-Sep-2026 by installing a package
  declaring `{"node":">=99.0.0"}` with the same flags the installer passes.
 */
it("turns npm's engine refusal into a code, with both versions in it", async () => {
  const refusal = [
    "npm error code EBADENGINE",
    "npm error engine Unsupported engine",
    "npm error engine Not compatible with your version of node/npm: engine-victim@1.0.0",
    'npm error notsup Required: {"node":">=99.0.0"}',
    'npm error notsup Actual:   {"node":"v26.7.0","npm":"11.19.0"}',
  ].join("\n");
  const failing = runProcess({
    file: process.execPath, cwd: home, env: {},
    args: ["-e", `process.stderr.write(${JSON.stringify(refusal)}); process.exitCode = 1`],
  });
  await expect(failing).rejects.toThrow("node-too-old: >=99.0.0 | v26.7.0");
  // Everything else npm can fail at keeps its own words, quoted under a sentence of its own.
  const ordinary = runProcess({
    file: process.execPath, cwd: home, env: {},
    args: ["-e", "process.stderr.write('npm error code E404'); process.exitCode = 1"],
  });
  await expect(ordinary).rejects.toThrow("process-failed: npm error code E404");
});
