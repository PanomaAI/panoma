import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { InstalledApp } from "@panoma/apps";
import { APP_GUARDIAN, appRequirementsReady, connectApp, parseAppGuide, requiredRequirementIds } from "./app-client";

const roots: string[] = [];
const oldHome = process.env["PANOMA_HOME"];
afterEach(async () => {
  if (oldHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = oldHome;
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function fixture(guide = { version: "1", requirements: { browser: { present: true }, ffmpeg: { present: true } } }) {
  const root = await mkdtemp(join(tmpdir(), "panoma-app-client-")); roots.push(root);
  process.env["PANOMA_HOME"] = root;
  await mkdir(join(root, "video"));
  const entry = join(root, "fixture.cjs");
  await writeFile(entry, `
const {createInterface}=require('node:readline');
const {spawn}=require('node:child_process');
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
createInterface({input:process.stdin}).on('line', line => {
 const req=JSON.parse(line); if(req.id===undefined)return;
 const result = body => send({jsonrpc:'2.0',id:req.id,result:body});
 if(req.method==='initialize')return result({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}});
 if(req.method==='tools/list')return result({tools:[]});
 if(req.method!=='tools/call')return result({});
 if(req.params.name==='panoma_video_guide')return result({content:[],structuredContent:${JSON.stringify(guide)}});
 if(req.params.name==='fail')return result({isError:true,content:[{type:'text',text:'Provider refused '+process.env.OPENAI_API_KEY}],structuredContent:{spend:{calls:0}}});
 if(req.params.name==='wait'){
  const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
  writeFileSync(join(process.env.PANOMA_VIDEO_HOME,'child.pid'),String(child.pid));
  setInterval(()=>send({jsonrpc:'2.0',method:'notifications/message',params:{level:'info',data:'working'}}),5);
  return;
 }
 const token=req.params._meta?.progressToken;
 if(token)send({jsonrpc:'2.0',method:'notifications/progress',params:{progressToken:token,progress:1,total:2,message:'render: frame'}});
 const spend={calls:1,provider:'fixture',model:'fixture'};
 process.stderr.write(JSON.stringify({event:'panoma-app-spend',job:process.env.PANOMA_APP_JOB,spend})+'\\n');
 process.stderr.write('diagnostic '+(process.env.OPENAI_API_KEY||'')+'\\n');
 // A real app reports progress while it works and answers later. Written back to back, the
 // progress and the result can share one chunk of the pipe, and the SDK then drops the
 // progress: it removes the request's progress handler on the result before the deferred
 // notification reaches it. Linux coalesces those writes far more often than macOS did.
 setTimeout(()=>result({content:[],structuredContent:{ok:true,spend,env:{db:process.env.DATABASE_URL||null,nodeOptions:process.env.NODE_OPTIONS||null,brain:process.env.PANOMA_VIDEO_BRAIN}}}),30);
});
`);
  return { id: "panoma-video", pkg: "@panoma/video", version: "0.2.0", root, packageRoot: root, entry,
    manifest: { protocol: "1", requirements: [{ id: "browser" }, { id: "ffmpeg" }] } } as unknown as InstalledApp;
}
describe("app MCP transport", () => {
  it("requires the protocol and every capability the manifest declares, not a list written here", () => {
    const two = ["browser", "ffmpeg"];
    expect(() => parseAppGuide({ version: "2", requirements: {} }, "1", two)).toThrow("protocol-mismatch");
    expect(() => parseAppGuide({ version: "1", requirements: {} }, "1", two)).toThrow("malformed-requirements");
    expect(appRequirementsReady({ browser: { present: true }, ffmpeg: { present: false } }, two)).toBe(false);
    expect(appRequirementsReady({ browser: { present: true }, ffmpeg: { present: true } }, two)).toBe(true);
    // A third capability declared by a newer package is answered for too, and silence is not "ready".
    const three = [...two, "encoder"];
    expect(appRequirementsReady({ browser: { present: true }, ffmpeg: { present: true } }, three)).toBe(false);
    expect(() => parseAppGuide({ version: "1", requirements: { browser: { present: true }, ffmpeg: { present: true } } }, "1", three))
      .toThrow("malformed-requirements: encoder");
    expect(appRequirementsReady({ browser: { present: true } }, [])).toBe(false);
    expect(requiredRequirementIds({ requirements: [{ id: "browser" }, { id: "ffmpeg" }] })).toEqual(two);
    expect(requiredRequirementIds(null)).toEqual([]);
  });
  it("initializes a real stdio server, forwards progress and redacts logs", async () => {
    const app = await fixture();
    const session = await connectApp(app, { jobId: "transport-test", providerEnv: { OPENAI_API_KEY: "test-secret-123" } });
    const progress: number[] = [];
    try {
      const result = await session.call("work", {}, { token: "transport-test", onProgress: p => progress.push(p.progress) });
      expect(result.ok).toBe(true);
      expect(result.env).toMatchObject({ db: null, nodeOptions: null, brain: "none" });
      // Progress is forwarded; the fixture answers a beat after sending it (see there why). On
      // Linux the bare assertion failed three runs out of four on 11-Sep-2026.
      await vi.waitFor(() => expect(progress).toEqual([1]), { timeout: 2_000 });
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(session.spend).toMatchObject({ calls: 1, provider: "fixture" });
      await expect(session.call("fail", {})).rejects.toThrow("Provider refused [redacted]");
    } finally { await session.close(); }
    const log = await readFile(join(app.root, "apps/panoma-video/logs/job-transport-test.log"), "utf8");
    expect(log).toContain("[redacted]"); expect(log).not.toContain("test-secret-123");
  });
  it("refuses a real incompatible guide", async () => {
    const app = await fixture({ version: "2", requirements: { browser: { present: true }, ffmpeg: { present: true } } });
    await expect(connectApp(app)).rejects.toThrow("protocol-mismatch");
  });
  it("cancellation closes the actual descendant process tree", async () => {
    const app = await fixture(); const session = await connectApp(app, { jobId: "cancel-test" });
    const controller = new AbortController();
    const pending = session.call("wait", {}, { signal: controller.signal }).catch(error => error);
    let pid = 0;
    try {
      await expect.poll(async () => {
        pid = Number(await readFile(join(app.root, "video/child.pid"), "utf8").catch(() => "0"));
        return pid;
      }).toBeGreaterThan(0);
      controller.abort(new Error("cancelled"));
      expect(await pending).toBeInstanceOf(Error);
    } finally { await session.close(); }
    await expect.poll(() => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    }, { timeout: 5000 }).toBe(false);
  });
  it("a killed host leaves no app descendant behind", async () => {
    const app = await fixture();
    const parentEntry = join(app.root, "parent.cjs");
    await writeFile(parentEntry, `
const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['-e',${JSON.stringify(APP_GUARDIAN)},${JSON.stringify(app.entry)}],{stdio:['pipe','ignore','ignore']});
child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'wait',arguments:{}}})+'\\n');
setInterval(()=>{},1000);
`);
    const parent = spawn(process.execPath, [parentEntry], {
      env: { NODE_ENV: "test", PATH: process.env["PATH"], PANOMA_VIDEO_HOME: join(app.root, "video") }, stdio: "ignore",
    });
    let pid = 0;
    try {
      await expect.poll(async () => {
        pid = Number(await readFile(join(app.root, "video/child.pid"), "utf8").catch(() => "0"));
        return pid;
      }).toBeGreaterThan(0);
      const exited = once(parent, "exit"); parent.kill("SIGKILL"); await exited;
      await expect.poll(() => {
        try { process.kill(pid, 0); return true; } catch { return false; }
      }, { timeout: 6000 }).toBe(false);
    } finally {
      parent.kill("SIGKILL");
      if (pid) { try { process.kill(pid, "SIGKILL"); } catch { /* Already gone. */ } }
    }
  });
});
