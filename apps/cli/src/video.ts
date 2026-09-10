import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Flags } from "./args";
import { appsFetch, followAppJob } from "./apps";
import { resolve } from "./open";
import { say } from "./messages";

/** The host owns project paths, workspace identity and provider settings. */
export function videoInput(flags: Flags): Record<string, unknown> {
  let extra: unknown = {};
  if (flags.input) {
    try { extra = JSON.parse(flags.input); } catch { throw new Error(say("apps.videoInput")); }
    if (!extra || typeof extra !== "object" || Array.isArray(extra)) throw new Error(say("apps.videoInput"));
  }
  const verb = flags.positionals[1];
  const subject = flags.positionals[3];
  return {
    ...(verb === "auto" ? { goal: flags.goal ?? "promo", until: flags.until ?? "preview", langs: (flags.langs ?? "en").split(","), format: flags.format ?? "v" } : {}),
    ...(flags.format && verb !== "auto" ? { format: flags.format } : {}),
    ...(flags.force ? { force: true } : {}),
    ...(subject ? { [verb === "review" ? "render_id" : "brief_id"]: subject } : {}),
    ...extra as Record<string, unknown>,
  };
}

async function doctor(json: boolean): Promise<number> {
  const { installedApp, buildAppEnvironment, insideDir } = await import("@panoma/apps");
  let app: Awaited<ReturnType<typeof installedApp>>;
  try { app = await installedApp("panoma-video"); }
  catch { process.stderr.write(`${say("apps.notInstalled")}\n`); return 2; }
  const entry = join(app.packageRoot, "dist", "panoma-video.js");
  if (!await insideDir(app.packageRoot, entry)) throw new Error(say("apps.notInstalled"));
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [entry, "doctor", ...(json ? ["--json"] : [])], {
      cwd: app.root, env: buildAppEnvironment("panoma-video"), stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
}

export async function videoCommand(flags: Flags): Promise<number> {
  const verb = flags.positionals[1];
  try {
    if (verb === "doctor") return await doctor(flags.json);
    const query = flags.positionals[2];
    if (!query) { process.stderr.write(`${say("apps.videoUsage")}\n`); return 1; }
    const app = await appsFetch<{ version?: string | null }>(flags.api, "/api/apps/panoma-video");
    if (!app.version) { process.stderr.write(`${say("apps.notInstalled")}\n`); return 2; }
    const project = await resolve(flags.api, query);
    if (typeof project === "number") return project;
    if (!project.identity) { process.stderr.write(`${say("apps.noIdentity")}\n`); return 1; }
    const queued = await appsFetch<{ id: string }>(flags.api, "/api/apps/panoma-video/jobs", {
      identity: project.identity, projectId: project.id, tool: `panoma_video_${verb}`, input: videoInput(flags),
    });
    return await followAppJob(flags.api, queued.id, flags.json);
  } catch (reason) {
    process.stderr.write(`${say("apps.rejected", { detail: (reason as Error).message })}\n`); return 1;
  }
}
