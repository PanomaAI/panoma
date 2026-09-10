import { createInterface } from "node:readline/promises";
import type { Flags } from "./args";
import { catalogFetch } from "./catalog-fetch";
import { appFaultText, say } from "./messages";
import { unreachable } from "./server";

export type AppJob = {
  id: string; status: string; progress?: { message?: string; progress?: number; total?: number } | null;
  result?: unknown; error?: string | null;
};
type AppDetail = {
  id: string; status: string; version?: string | null; ready?: boolean;
  requirements?: Record<string, { present?: boolean }> | { id: string; present?: boolean }[];
  manifest?: { requirements?: { id: string; kind?: string; browser?: string; approxMB?: number; termsUrl?: string }[] } | null;
  space?: { dataBytes: number };
};

export async function appsFetch<T>(api: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await catalogFetch(new URL(path, api), body === undefined ? { signal } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  const value = await response.json() as { id?: unknown; error?: unknown };
  if (!response.ok && !(response.status === 409 && typeof value.id === "string")) {
    throw new Error(typeof value.error === "string" ? value.error : String(response.status));
  }
  return value as T;
}

export async function confirmApps(message: string): Promise<boolean> {
  process.stderr.write(`${message}\n`);
  if (!process.stdin.isTTY) return false;
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  try { return (await reader.question(say("apps.confirm"))).trim().toLowerCase() === "yes"; }
  finally { reader.close(); }
}

/** Long polling follows a durable job; leaving this process does not cancel the job. */
export async function followAppJob(api: string, id: string, json: boolean, quiet = false): Promise<number> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  let last = "";
  process.stderr.write(`${say("apps.job", { id })}\n`);
  try {
    for (;;) {
      const job = await appsFetch<AppJob>(api, `/api/apps/jobs/${encodeURIComponent(id)}?wait=1`, undefined, controller.signal);
      const message = `${job.status}:${job.progress?.message ?? ""}`;
      if (message !== last) {
        process.stderr.write(`${say("apps.jobProgress", { status: job.status, message: job.progress?.message ?? "" })}\n`);
        last = message;
      }
      if (job.status === "done") {
        if (!quiet) process.stdout.write(json ? `${JSON.stringify(job, null, 2)}\n` : `${say("apps.jobDone", { id })}\n`);
        return 0;
      }
      if (job.status === "cancelled") { process.stderr.write(`${say("apps.cancelled")}\n`); return 3; }
      if (job.status === "failed") {
        process.stderr.write(`${appFaultText(job.error ?? job.status, "apps.jobFailed")}\n`);
        if (json) process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
        return 1;
      }
    }
  } catch (reason) {
    if (controller.signal.aborted) { process.stderr.write(`${say("apps.jobDetached", { id })}\n`); return 0; }
    throw reason;
  } finally { process.removeListener("SIGINT", stop); }
}

export async function appsCommand(flags: Flags): Promise<number> {
  const verb = flags.positionals[1];
  const id = flags.positionals[2];
  if (verb && (!id || !["install", "update", "rollback", "remove", "clean", "doctor", "enable", "disable", "check"].includes(verb))) {
    process.stderr.write(`${say("apps.usage")}\n`); return 1;
  }
  try {
    if (!verb) {
      const result = await appsFetch<{ apps: AppDetail[] }>(flags.api, "/api/apps");
      process.stdout.write(flags.json ? `${JSON.stringify(result, null, 2)}\n` : result.apps.map((app) => say("apps.line", {
        id: app.id, status: app.ready ? "ready" : app.status, version: app.version ?? "—",
      })).join("\n") + "\n");
      return 0;
    }
    const path = `/api/apps/${encodeURIComponent(id!)}`;
    if (verb === "doctor") {
      let app = await appsFetch<AppDetail>(flags.api, path);
      if (app.version) {
        const job = await appsFetch<{ id: string }>(flags.api, `${path}/doctor`, {});
        const checked = await followAppJob(flags.api, job.id, false, true);
        if (checked !== 0) return checked;
        app = await appsFetch<AppDetail>(flags.api, path);
      }
      if (flags.json) process.stdout.write(`${JSON.stringify(app, null, 2)}\n`);
      else {
        const requirements = Array.isArray(app.requirements) ? app.requirements : Object.entries(app.requirements ?? {})
          .filter(([, value]) => value && typeof value === "object").map(([name, value]) => ({ id: name, ...value }));
        for (const item of requirements) process.stdout.write(`${say("apps.requirement", { name: item.id,
          status: say(item.present === true ? "apps.present" : item.present === false ? "apps.missing" : "apps.unchecked") })}\n`);
      }
      return app.version ? (app.ready ? 0 : 1) : 2;
    }
    if (verb === "clean") {
      const app = await appsFetch<AppDetail>(flags.api, `${path}?space=1`);
      if (!await confirmApps(say("apps.cleanConfirm", { bytes: app.space?.dataBytes ?? 0 }))) {
        process.stderr.write(`${say("apps.cancelled")}\n`); return 3;
      }
    }
    const operation = verb === "remove" ? "uninstall" : verb;
    const queued = await appsFetch<{ id: string }>(flags.api, `${path}/${operation}`, verb === "clean" ? { confirm: true } : {});
    const chainingBrowser = verb === "install" && flags.browser;
    const exit = queued.id ? await followAppJob(flags.api, queued.id, flags.json, chainingBrowser) : 0;
    if (exit !== 0 || verb !== "install" || !flags.browser) return exit;
    /* The size and the terms are the installed package's own words, never a figure typed here. */
    const installed = await appsFetch<AppDetail>(flags.api, path);
    const browserRequirement = installed.manifest?.requirements?.find((item) => item.kind === "playwright-browser");
    if (!browserRequirement) { process.stderr.write(`${say("apps.browserUndeclared")}\n`); return 0; }
    if (!await confirmApps(say("apps.browserConsent", {
      browser: browserRequirement.browser ?? browserRequirement.id,
      terms: browserRequirement.termsUrl ?? "",
      n: browserRequirement.approxMB ?? 0,
    }))) {
      process.stderr.write(`${say(process.stdin.isTTY ? "apps.cancelled" : "apps.browserRequired")}\n`); return 3;
    }
    const browser = await appsFetch<{ id: string }>(flags.api, `${path}/browser`, {});
    return followAppJob(flags.api, browser.id, flags.json);
  } catch (reason) {
    if (reason instanceof TypeError) return unreachable(flags.api);
    process.stderr.write(`${appFaultText((reason as Error).message, "apps.rejected")}\n`); return 1;
  }
}
