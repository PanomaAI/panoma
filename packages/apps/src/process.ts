import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { findExecutable, resolveExecutable } from "@panoma/core";
import { AppFault, asAppFault } from "./faults";
import { engineFault } from "./engines";

export interface NpmLocation { file: string; args: string[]; source: "adjacent-cli" | "adjacent-bin" | "path" }

export function findNpm(
  options: { execPath?: string; env?: NodeJS.ProcessEnv; exists?: typeof existsSync } = {},
): NpmLocation | undefined {
  const node = options.execPath ?? process.execPath;
  const dir = dirname(node);
  const exists = options.exists ?? existsSync;
  const env = options.env ?? process.env;
  const scripts = [
    join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    join(dir, "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const script of scripts) {
    if (exists(script)) return { file: node, args: [script], source: "adjacent-cli" };
  }
  const adjacent = join(dir, process.platform === "win32" ? "npm.cmd" : "npm");
  if (exists(adjacent)) return { ...resolveExecutable(adjacent, [], { env }), source: "adjacent-bin" };
  const found = findExecutable("npm", { env });
  return found ? { ...resolveExecutable(found, [], { env }), source: "path" } : undefined;
}

export interface ProcessRequest {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /*
    A ceiling on silence instead of on the whole command. A browser is about 550 MB, which at a
    modest 5 Mbps is already the fifteen-minute total ceiling: on a slower line the download died
    halfway and the failure said `timeout`, which reads like the program hung rather than the
    network being slow. What is worth watching is whether it is still making progress.
   */
  idleMs?: number;
  onProgress?: (line: string) => void;
  /** Internal manager lease. The guardian records its PID before launching the command. */
  leasePath?: string;
}

/** The guardian survives host death, owns the command group and never evaluates a command string. */
export const PROCESS_GUARDIAN = [
  'const {spawn}=require("node:child_process");const {writeFileSync}=require("node:fs");',
  'const parent=process.ppid;const lease=process.argv[1];',
  'if(lease)writeFileSync(lease,String(process.pid),{mode:0o600,flag:"wx"});',
  'const child=spawn(process.argv[2],process.argv.slice(3),{env:process.env,cwd:process.cwd(),detached:process.platform!=="win32",stdio:["ignore","inherit","inherit"],windowsHide:true});',
  'let closing=false;const watch=setInterval(()=>{try{process.kill(parent,0);if(process.ppid!==parent)stop(1)}catch{stop(1)}},250);',
  'function stop(code=0){if(closing)return;closing=true;clearInterval(watch);',
  'if(!child.pid){process.exit(code);return;}',
  'if(process.platform==="win32"){const k=spawn("taskkill",["/T","/F","/PID",String(child.pid)],{windowsHide:true,stdio:"ignore"});k.on("error",()=>{child.kill();process.exit(code)});k.on("exit",()=>process.exit(code));}',
  'else{try{process.kill(-child.pid,"SIGTERM")}catch{process.exit(code);return;}setTimeout(()=>{try{process.kill(-child.pid,"SIGKILL")}catch{}process.exit(code)},2000)}',
  '}',
  'process.stdin.on("end",()=>stop(1));process.stdin.on("error",()=>stop(1));process.stdin.resume();',
  'process.stdout.on("error",()=>stop(1));process.stderr.on("error",()=>stop(1));',
  'child.on("error",error=>{process.stderr.write(error.message);stop(1)});child.on("exit",code=>stop(code??1));',
  'process.on("SIGTERM",()=>stop(1));process.on("SIGINT",()=>stop(1));',
].join("\n");

/** No shell; bounded output; cancellation and host death reach npm/browser descendants. */
export async function runProcess(request: ProcessRequest): Promise<void> {
  request.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const argv = ["-e", PROCESS_GUARDIAN, "--", request.leasePath ?? "", request.file, ...request.args];
    const child = spawn(process.execPath, argv, {
      cwd: request.cwd, env: request.env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true, detached: process.platform !== "win32",
    });
    let tail = "";
    let aborted = false;
    let timedOut = false;
    let stalled = false;
    const stop = () => {
      // Closing this keepalive works on Windows too; killing the guardian itself would
      // remove the process that owns the descendant cleanup and its grace timer.
      child.stdin.end();
    };
    child.stdin.on("error", () => {});
    const cancel = () => { aborted = true; stop(); };
    request.signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; stop(); }, request.timeoutMs ?? 15 * 60_000);
    timer.unref();
    let idle: ReturnType<typeof setTimeout> | undefined;
    const armIdle = () => {
      if (!request.idleMs) return;
      clearTimeout(idle);
      idle = setTimeout(() => { timedOut = true; stalled = true; stop(); }, request.idleMs);
      idle.unref();
    };
    armIdle();
    const output = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      tail = (tail + text).slice(-65_536);
      for (const line of text.split(/\r?\n/).filter(Boolean)) request.onProgress?.(line.slice(0, 2_000));
      armIdle();
    };
    child.stdout.on("data", output);
    child.stderr.on("data", output);
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(idle);
      request.signal?.removeEventListener("abort", cancel);
    };
    child.once("error", (error) => { cleanup(); reject(asAppFault(error, "command-did-not-start")); });
    child.once("close", (code) => {
      cleanup();
      if (aborted) reject(new AppFault("cancelled"));
      // What it last said is what tells a person a download stopped at 40 % rather than never began.
      else if (timedOut) reject(stalled
        ? new AppFault("stalled", (tail.trim().split(/\r?\n/).pop() ?? "").trim().slice(0, 300))
        : new AppFault("timeout"));
      /*
        An engine refusal is read here and not after the fact, because this message is what
        `app-jobs.ts` persists to a text column and re-reads on every page load. A code parsed
        at the throw site is a code that is still translatable a week later.
       */
      else if (code !== 0) reject(engineFault(tail) ?? new AppFault("process-failed", tail.trim() || String(code)));
      else resolve();
    });
    // Abort may have arrived between the initial check and attaching the listener.
    if (request.signal?.aborted) cancel();
  });
}
