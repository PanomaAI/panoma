import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { assertManagedPath, buildAppEnvironment, layoutFor, GUIDE_TIMEOUT_MS, type InstalledApp } from "@panoma/apps";
import { MAX_APP_SPEND_CALLS } from "@panoma/db";
import { AppFault } from "@panoma/apps/faults";

export interface AppGuide {
  version: string;
  requirements: Record<string, unknown>;
  [key: string]: unknown;
}
export interface AppProgress { progress: number; total?: number; message?: string }
export class AppCallError extends Error {
  constructor(message: string, readonly result?: Record<string, unknown>) { super(message); }
}

/*
 * The SDK transport does not expose detached process groups. Its child is a tiny guardian:
 * the actual app starts in its own group, and stdin EOF also kills that group after a host
 * crash. No PID from the database is ever trusted as permission to kill a later process.
 */
export const APP_GUARDIAN = [
  'const {spawn}=require("node:child_process");',
  'const parent=process.ppid;',
  'const child=spawn(process.execPath,[process.argv[1]],{env:process.env,cwd:process.cwd(),detached:process.platform!=="win32",stdio:["pipe","pipe","pipe"],windowsHide:true});',
  'let closing=false;',
  'function stop(code=0){if(closing)return;closing=true;clearInterval(watch);',
  'if(process.platform==="win32"){const k=spawn("taskkill",["/T","/F","/PID",String(child.pid)],{windowsHide:true,stdio:"ignore"});k.on("error",()=>process.exit(code));k.on("exit",()=>process.exit(code));}',
  'else{try{process.kill(-child.pid,"SIGTERM")}catch{}setTimeout(()=>{try{process.kill(-child.pid,"SIGKILL")}catch{}process.exit(code)},1000)}',
  'setTimeout(()=>process.exit(code),1800).unref();}',
  'const watch=setInterval(()=>{try{process.kill(parent,0);if(process.ppid!==parent)stop(1)}catch{stop(1)}},1000);',
  'child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);process.stdin.pipe(child.stdin);',
  'process.stdout.on("error",()=>stop(1));process.stderr.on("error",()=>stop(1));',
  'process.stdin.on("end",()=>stop());process.stdin.on("error",()=>stop(1));',
  'child.stdin.on("error",()=>{});child.on("error",()=>stop(1));child.on("exit",code=>stop(code||0));',
  'process.on("SIGTERM",()=>stop());process.on("SIGINT",()=>stop());',
].join("\n");

export interface AppSession {
  guide: AppGuide;
  pid: number | null;
  readonly spend: Record<string, unknown> | undefined;
  call(tool: string, input: Record<string, unknown>, options?: {
    signal?: AbortSignal; timeout?: number; token?: string;
    onProgress?: (progress: AppProgress) => void;
  }): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
/*
  Which capabilities have to be answered for, taken from the manifest the package publishes and
  not from a list written here. The manager already refuses a probe that skips one of them
  (`checkedProbe`); this is the same rule on the reading side, so that a third requirement in a
  future version cannot be quietly left out of "ready".
 */
export function requiredRequirementIds(manifest: unknown): string[] {
  if (!record(manifest) || !Array.isArray(manifest.requirements)) return [];
  return manifest.requirements
    .map(item => record(item) && typeof item.id === "string" ? item.id : "")
    .filter(Boolean);
}
export function parseAppGuide(value: unknown, protocol: string, required: readonly string[]): AppGuide {
  if (!record(value) || typeof value.version !== "string") throw new AppFault("malformed-guide");
  if (value.version !== protocol) throw new AppFault("protocol-mismatch");
  if (!record(value.requirements)) throw new AppFault("malformed-requirements");
  if (!required.length) throw new Error("malformed-requirements: none declared");
  for (const key of required) {
    const requirement = value.requirements[key];
    if (!record(requirement) || typeof requirement.present !== "boolean") {
      throw new Error("malformed-requirements: " + key);
    }
  }
  return value as AppGuide;
}
/** An app with no declared requirement is never ready: silence is not an answer. */
export function appRequirementsReady(value: unknown, required: readonly string[]): boolean {
  if (!record(value) || !required.length) return false;
  return required.every(key => record(value[key]) && value[key].present === true);
}
export async function connectApp(app: InstalledApp, options: {
  jobId?: string; brain?: string; maxBrainCalls?: number;
  providerEnv?: Record<string, string>; signal?: AbortSignal;
  onPid?: (pid: number) => void;
  /** Ask the app to actually start what it needs. A person pressed a button; a job did not. */
  deepProbe?: boolean;
} = {}): Promise<AppSession> {
  const layout = layoutFor(app.id);
  const env = buildAppEnvironment(app.id, {
    jobId: options.jobId, brain: options.brain ?? "none", providerEnv: options.providerEnv,
    maxBrainCalls: options.maxBrainCalls ?? 0,
  });
  await assertManagedPath(layout.logs);
  await assertManagedPath(layout.data);
  await mkdir(layout.logs, { recursive: true, mode: 0o700 });
  if (options.jobId && !/^[a-zA-Z0-9-]{1,100}$/.test(options.jobId)) throw new AppFault("invalid-job-id");
  const log = await open(join(layout.logs, "job-" + (options.jobId ?? "probe") + ".log"),
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0), 0o600);
  let bytes = 0;
  let stderrLine = "";
  let stderrOverflow = false;
  let spend: Record<string, unknown> | undefined;
  let logWrites = Promise.resolve();
  const client = new Client({ name: "panoma-app-host", version: "1" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["-e", APP_GUARDIAN, app.entry],
    cwd: app.root, env, stderr: "pipe",
  });
  function redact(text: string) {
    for (const secret of Object.values(options.providerEnv ?? {})) {
      if (secret) text = text.split(secret).join("[redacted]");
    }
    return text.replace(/(?:sk-[A-Za-z0-9_-]{10,}|panoma_[A-Za-z0-9_-]{15,})/g, "[redacted]");
  }
  function writeLog(text: string) {
    if (bytes >= 1_048_576) return;
    const data = Buffer.from(redact(text)).subarray(0, 1_048_576 - bytes);
    bytes += data.length;
    logWrites = logWrites.then(async () => { await log.write(data); }).catch(() => {});
  }
  transport.stderr?.on("data", (chunk: Buffer) => {
    // Buffer complete lines so a credential split across pipe chunks cannot leak.
    const lines = (stderrLine + chunk.toString("utf8")).split("\n");
    stderrLine = lines.pop()!;
    for (const line of lines) {
      const oversized = stderrOverflow || line.length > 65_536;
      stderrOverflow = false;
      if (oversized) continue;
      // Receipts stay live after the log limit and survive tool errors/cancellation.
      try {
        const event = JSON.parse(line);
        // Bounded at the edge: a receipt the ledger would refuse must not reach the write that
        // closes the job, where an exception would leave the row claimed and the queue stuck.
        if (event.event === "panoma-app-spend" && event.job === options.jobId && record(event.spend) &&
          Number.isSafeInteger(event.spend.calls) && event.spend.calls >= 0 &&
          event.spend.calls <= MAX_APP_SPEND_CALLS &&
          event.spend.calls >= (spend?.calls ?? 0)) spend = event.spend;
      } catch { /* Ordinary diagnostics are not protocol messages. */ }
      writeLog(line + "\n");
    }
    if (stderrLine.length > 65_536) { stderrLine = ""; stderrOverflow = true; }
  });
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await client.close().catch(() => {});
    if (!stderrOverflow) writeLog(stderrLine);
    await logWrites;
    await log.close();
  }
  async function call(tool: string, input: Record<string, unknown>, callOptions: {
    signal?: AbortSignal; timeout?: number; token?: string; onProgress?: (progress: AppProgress) => void;
  } = {}) {
    const result = await client.callTool({
      name: tool, arguments: input,
      ...(callOptions.token ? { _meta: { progressToken: callOptions.token } } : {}),
    }, CallToolResultSchema, {
      signal: callOptions.signal, timeout: callOptions.timeout ?? 20_000,
      maxTotalTimeout: callOptions.timeout ?? 20_000,
      onprogress: callOptions.onProgress,
    });
    const structured = record(result.structuredContent) ? result.structuredContent : undefined;
    if (result.isError) {
      const content = result.content as { type: string; text?: string }[];
      const said = content.find(item => item.type === "text")?.text ?? "app-error";
      throw new AppCallError(redact(said).slice(0, 4000), structured);
    }
    if (!structured) throw new AppCallError("malformed-app-result");
    return structured;
  }
  try {
    await client.connect(transport, { timeout: 20_000, signal: options.signal });
    if (transport.pid) options.onPid?.(transport.pid);
    const asked = options.deepProbe ? { probe: "deep" } : {};
    const guide = parseAppGuide(
      await call("panoma_video_guide", asked, { signal: options.signal, timeout: GUIDE_TIMEOUT_MS }),
      app.manifest.protocol, app.manifest.requirements.map(item => item.id));
    return { guide, pid: transport.pid, get spend() { return spend; }, call, close };
  } catch (error) { await close(); throw error; }
}
