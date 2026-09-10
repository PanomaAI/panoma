import {
  OFFICIAL, officialApp, reconcileDisk, installedApp, install, update, activate, rollback,
  installBrowser, uninstall, cleanData, registryVersion, readCurrent, readStaged,
  insideDir, TOOL_TIMEOUT_MS, type InstalledApp,
} from "@panoma/apps";
import {
  ensureApp, getApp, updateApp, queueWrite, listAppJobs, getAppJob, claimAppJob,
  enqueueAppJobRow, transitionAppJob, updateAppJobProgress, getAppWorkspace, saveAppWorkspace,
  forgetAppWorkspaces, appProject, recordAppSpend, revalidateAppBudget, hasPendingAppJob,
  MAX_APP_SPEND_CALLS, type AppJob, type Database,
} from "@panoma/db";
import { readConfig } from "@panoma/ai";
import { db } from "./db";
import { capFor } from "./spend-settings";
import { AppCallError, connectApp, appRequirementsReady, type AppProgress } from "./app-client";
import { MANAGER_TOOLS, VIDEO_FIELDS, validateAppInput, appResultFailure, isRecord } from "./app-input";
import { AppFault, faultOf } from "@panoma/apps/faults";

export const MAX_RUNNING = 1;
export const APP_PROGRESS_INTERVAL = 1000;
/*
  How often the queue looks for work nobody announced. Enqueueing wakes it, and a finished job
  goes straight to the next one, so this only has to catch what a restart left pending. It used
  to be two seconds, which on an idle catalog was a table lock every two seconds forever,
  competing in the single write queue with the scan and the watcher.
 */
export const APP_QUEUE_SWEEP = 30_000;
/** How long an observer sleeps when no change arrives; the notification is the fast path. */
export const APP_WATCH_BACKSTOP = 2000;

/*
  Everything that moves a job runs in this process, so an observer does not have to ask the
  catalog whether anything happened: it is told. The backstop below is what makes a missed
  notification cost a second rather than the whole wait, which is why the notice can stay a plain
  broadcast —one running job at a time— instead of a registry keyed by id.
 */
const watchers = new Set<() => void>();
export function appJobsChanged(): void {
  for (const wake of [...watchers]) wake();
}
export function whenAppJobsChange(signal: AbortSignal, within: number): Promise<void> {
  return new Promise<void>(resolve => {
    const done = () => {
      watchers.delete(done); clearTimeout(timer);
      signal.removeEventListener("abort", done); resolve();
    };
    const timer = setTimeout(done, Math.max(0, within));
    watchers.add(done);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
}
interface Runtime {
  initialized?: Promise<void>; running?: Promise<void>; controller?: AbortController;
  jobId?: string; stopped: boolean; timer?: ReturnType<typeof setInterval>;
}
const globalRuntime = globalThis as unknown as { panomaAppWorkers?: WeakMap<Database, Runtime> };
function runtime(database: Database): Runtime {
  const workers = globalRuntime.panomaAppWorkers ??= new WeakMap();
  let state = workers.get(database);
  if (!state) { state = { stopped: false }; workers.set(database, state); }
  return state;
}
export async function reconcileApps(database: Database) {
  const disk = await reconcileDisk();
  await queueWrite(async () => {
    for (const official of OFFICIAL) await ensureApp(database, official.id, official.pkg);
    for (const item of disk.apps) {
      const previous = await getApp(database, item.id);
      await updateApp(database, item.id, {
        version: item.current?.version ?? null, previousVersion: item.current?.previous ?? null,
        stagedVersion: item.stagedVersion ?? null,
        status: previous?.enabled === false ? "disabled" : item.status,
        protocol: item.app?.manifest.protocol ?? null,
        manifest: item.app?.manifest ?? null, error: item.error ?? null,
      });
    }
    // The guardian owns process cleanup. A reused PID from yesterday is never killed here.
    for (const job of await listAppJobs(database, { statuses: ["running", "cancelling"], limit: 1000 })) {
      await transitionAppJob(database, job.id, job.status, "failed", { error: "interrupted" });
    }
  });
  appJobsChanged();
}
export async function ensureAppSupervisor(): Promise<void> {
  if (process.env["DATABASE_URL"]) return;
  const { db: database } = await db();
  const state = runtime(database);
  if (state.stopped) return;
  state.initialized ??= reconcileApps(database).catch(error => {
    state.initialized = undefined; throw error;
  });
  await state.initialized;
  if (!state.timer) {
    state.timer = setInterval(() => { void runAppQueue(database).catch(() => {}); }, APP_QUEUE_SWEEP);
    state.timer.unref();
  }
  void runAppQueue(database).catch(() => {});
}
export async function stopAppSupervisor(database: Database): Promise<void> {
  const state = runtime(database);
  state.stopped = true;
  clearInterval(state.timer);
  state.controller?.abort(new AppFault("interrupted"));
  await state.running;
}
export function appProgressSink(write: (progress: NonNullable<AppJob["progress"]>) => Promise<void>) {
  let pending: NonNullable<AppJob["progress"]> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain = Promise.resolve();
  let last = 0;
  function flush() {
    clearTimeout(timer); timer = undefined;
    const value = pending; pending = undefined;
    if (value) {
      last = Date.now();
      chain = chain.then(() => write(value));
    }
    return chain;
  }
  return {
    push(value: AppProgress) {
      const message = (value.message ?? "").slice(0, 1000);
      pending = { stage: message.split(":")[0]!.slice(0, 60), progress: value.progress,
        ...(value.total === undefined ? {} : { total: value.total }), message, at: new Date().toISOString() };
      if (!timer) timer = setTimeout(() => { void flush().catch(() => {}); },
        Math.max(0, APP_PROGRESS_INTERVAL - (Date.now() - last)));
    }, flush,
  };
}
/*
  What the app can do on this machine. The handshake before a job asks the cheap question —is the
  browser on disk— because starting one costs a second of every job; `deep` is for the two moments
  a person is waiting on the answer: pressing «check requirements», and finishing a download.
 */
async function probe(app: InstalledApp, signal?: AbortSignal, deepProbe = false) {
  const session = await connectApp(app, { signal, deepProbe });
  try {
    return Object.entries(session.guide.requirements).filter(([, value]) =>
      isRecord(value) && typeof value.present === "boolean",
    ).map(([id, value]) => ({ ...(value as { present: boolean }), id }));
  } finally { await session.close(); }
}
async function syncInstalled(database: Database, id: string) {
  const current = await readCurrent(id);
  const app = current ? await installedApp(id) : undefined;
  const row = await getApp(database, id);
  await queueWrite(() => updateApp(database, id, {
    version: current?.version ?? null, previousVersion: current?.previous ?? null,
    stagedVersion: null, protocol: app?.manifest.protocol ?? null, manifest: app?.manifest ?? null,
    status: row?.enabled === false ? "disabled" : app ? "installed" : "absent", error: null,
    ...(app ? { installedAt: row?.installedAt ?? new Date() } : { requirements: null, requirementsAt: null }),
  }));
}
async function executeManager(
  database: Database, job: AppJob, signal: AbortSignal, onProgress: (p: AppProgress) => void,
) {
  const progress = (message: string) => onProgress({ progress: 0, message: job.tool + ": " + message });
  if (job.tool === "install" || job.tool === "update") {
    await queueWrite(() => updateApp(database, job.appId, { status: "installing", error: null }));
    const step = job.tool === "install" ? install : update;
    const outcome = await step(job.appId, { signal, onProgress: progress, probe });
    if (outcome.status === "staged") {
      await queueWrite(() => updateApp(database, job.appId, { stagedVersion: outcome.version, status: "staged" }));
      await activate(job.appId, outcome.version);
    }
    await syncInstalled(database, job.appId);
    await queueWrite(() => updateApp(database, job.appId, {
      requirements: Object.fromEntries(outcome.requirements.map(item => [item.id, item])), requirementsAt: new Date(),
    }));
    return { version: outcome.version, installed: true };
  }
  if (job.tool === "browser") await installBrowser(job.appId, progress, signal);
  else if (job.tool === "rollback") await rollback(job.appId);
  else if (job.tool === "enable" || job.tool === "disable") {
    await queueWrite(() => updateApp(database, job.appId, { enabled: job.tool === "enable" }));
  } else if (job.tool === "uninstall") await uninstall(job.appId, { keepData: true });
  else if (job.tool === "clean") {
    const result = await cleanData(job.appId);
    await queueWrite(() => forgetAppWorkspaces(database, job.appId));
    return result;
  } else if (job.tool === "check") {
    return { ...await registryVersion(officialApp(job.appId).pkg, { force: true, explicit: true }) };
  }
  else if (job.tool !== "doctor") throw new AppFault("unknown-app-operation");
  await syncInstalled(database, job.appId);
  if (job.tool === "browser" || job.tool === "doctor") {
    const measured = await probe(await installedApp(job.appId), signal, true);
    const requirements = Object.fromEntries(measured.map(item => [item.id, item]));
    await queueWrite(() => updateApp(database, job.appId, { requirements, requirementsAt: new Date() }));
    return { requirements };
  }
  return { complete: true };
}
/*
  A receipt is what the app says it attempted, and the ledger will still record no more than the
  job reserved. What it must not do is arrive so large that writing it throws: an absurd figure is
  bounded here, at the edge, so that a badly behaved child cannot turn its own receipt into an
  exception in the one write that closes a job.
 */
export function spendOf(result?: Record<string, unknown>) {
  const spend = result?.spend ?? result?.brain;
  if (!isRecord(spend) || typeof spend.calls !== "number") return undefined;
  if (!Number.isSafeInteger(spend.calls) || spend.calls < 0) return undefined;
  return { calls: Math.min(spend.calls, MAX_APP_SPEND_CALLS),
    provider: typeof spend.provider === "string" ? spend.provider :
      typeof spend.driver === "string" ? spend.driver : undefined,
    model: typeof spend.model === "string" ? spend.model : undefined };
}
async function executeVideo(
  database: Database, job: AppJob, signal: AbortSignal, onProgress: (p: AppProgress) => void,
) {
  const app = await getApp(database, job.appId);
  if (!app?.enabled || !app.version) throw new AppFault("app-not-enabled");
  const selectedId = typeof job.input._projectId === "string" ? job.input._projectId : undefined;
  const project = await appProject(database, job.identity, selectedId).catch(error => {
    if (!(error instanceof Error) || error.message !== "project-not-found" || !selectedId) throw error;
    return appProject(database, job.identity);
  });
  const workspace = await getAppWorkspace(database, job.appId, job.identity);
  const input: Record<string, unknown> = {
    ...job.input, project_path: project.root,
    ...(workspace ? { workspace_id: workspace.workspaceId } : {}),
  };
  delete input._projectId;
  const brain = typeof job.input.brain === "string" ? job.input.brain : "none";
  if (brain !== "none" && brain !== app.settings.brain) throw new AppFault("provider-not-enabled");
  if (job.reservedCalls) {
    const { cap } = await capFor("app");
    job = await queueWrite(() => revalidateAppBudget(database, job, Math.min(cap, 1000)));
    if (!job.reservedCalls) throw new AppFault("app-budget-exhausted");
  }
  const providerEnv: Record<string, string> = {};
  const usesVoice = VIDEO_FIELDS[job.tool]?.includes("voice") && app.settings.voice && input.voice !== "none";
  if (VIDEO_FIELDS[job.tool]?.includes("voice") && !app.settings.voice) input.voice = "none";
  if (brain !== "none" || usesVoice) {
    const config = await readConfig();
    const provider = brain === "auto" ? config.provider : brain;
    if (provider === "anthropic" || provider === "openai") {
      const key = config.keys?.[provider];
      if (key) providerEnv[provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"] = key;
      else if (brain === provider) throw new AppFault("provider-key-missing");
    }
    if (usesVoice) {
      // Only what the owner wrote in `ai.json`. Reading the server's own environment would be a
      // second, silent way for a credential to reach a child, and nothing announces it.
      const key = config.keys?.["elevenlabs"];
      if (!key) throw new AppFault("voice-key-missing");
      providerEnv["ELEVENLABS_API_KEY"] = key;
    }
  }
  const installed = await installedApp(job.appId, job.appVersion);
  const session = await connectApp(installed, {
    jobId: job.id, brain, providerEnv, maxBrainCalls: job.reservedCalls, signal,
  });
  let invoked = false;
  try {
    await queueWrite(async () => {
      await updateApp(database, job.appId, { requirements: session.guide.requirements, requirementsAt: new Date() });
      if (session.pid) await updateAppJobProgress(database, job.id, {
        stage: "starting", progress: 0, message: "starting: App connected", at: new Date().toISOString(),
      }, session.pid);
    });
    if (["panoma_video_auto", "panoma_video_render", "panoma_video_review"].includes(job.tool) &&
      !appRequirementsReady(session.guide.requirements, installed.manifest.requirements.map(item => item.id))) {
      throw new AppFault("requirement-missing");
    }
    invoked = true;
    const result = await session.call(job.tool, input, {
      signal, timeout: TOOL_TIMEOUT_MS[job.tool], token: job.id, onProgress,
    });
    if (typeof result.project_id === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(result.project_id)) {
      await queueWrite(() => saveAppWorkspace(database, {
        appId: job.appId, identity: job.identity, rootAtCreation: project.root,
        workspaceId: result.project_id as string,
      }));
    }
    const failure = appResultFailure(result, job.tool, input);
    if (failure) throw new AppCallError(failure, result);
    return result;
  } catch (error) {
    await session.close();
    const previous = error instanceof AppCallError ? error.result : undefined;
    const receipt = session.spend ?? previous?.spend ?? (!invoked ? { calls: 0 } : undefined);
    throw new AppCallError(error instanceof Error ? error.message : "app-failed", {
      ...previous, ...(receipt ? { spend: receipt } : {}),
    });
  } finally { await session.close(); }
}
export async function runAppQueue(database: Database, execute = executeJob): Promise<void> {
  const state = runtime(database);
  if (state.stopped) return;
  if (state.running) return state.running;
  const work = async () => {
    while (!state.stopped) {
      // The lock is only worth taking when there is something to claim.
      if (!(await hasPendingAppJob(database))) break;
      const job = await queueWrite(() => claimAppJob(database));
      if (!job) break;
      appJobsChanged();
      state.jobId = job.id; state.controller = new AbortController();
      try {
        await execute(database, job, state.controller.signal);
      } catch (error) {
        /*
          A claim is exclusive: one job whose ending never got written would leave its row
          `running`, and from then on nothing else would ever be claimed —the queue dead until
          the server restarts. So whatever the failure, the row is closed here.
         */
        await abandonAppJob(database, job.id, error);
      } finally {
        state.jobId = undefined; state.controller = undefined;
      }
    }
  };
  state.running = work();
  try { await state.running; } finally { state.running = undefined; }
}
async function abandonAppJob(database: Database, id: string, error: unknown): Promise<void> {
  try {
    await queueWrite(async () => {
      const current = await getAppJob(database, id);
      if (!current || !["running", "cancelling"].includes(current.status)) return;
      await transitionAppJob(database, id, current.status, "failed", {
        error: (error instanceof Error ? error.message : "app-failed").slice(0, 4000),
      });
    });
  } catch { /* A catalog that cannot even record a failure is past what this loop can repair. */ }
  appJobsChanged();
}
async function executeJob(database: Database, job: AppJob, signal: AbortSignal) {
  const controller = new AbortController();
  const forward = () => controller.abort(signal.reason);
  signal.addEventListener("abort", forward, { once: true });
  if (signal.aborted) forward();
  const deadline = setTimeout(() => controller.abort(new AppFault("timeout")),
    TOOL_TIMEOUT_MS[job.tool] ?? 30 * 60_000);
  const sink = appProgressSink(async progress => {
    await queueWrite(() => updateAppJobProgress(database, job.id, progress));
    appJobsChanged();
  });
  let result: Record<string, unknown> | undefined;
  let error: string | undefined;
  try {
    result = MANAGER_TOOLS.includes(job.tool as typeof MANAGER_TOOLS[number])
      ? await executeManager(database, job, controller.signal, sink.push)
      : await executeVideo(database, job, controller.signal, sink.push);
  } catch (caught) {
    if (caught instanceof AppCallError) result = caught.result;
    else if (!MANAGER_TOOLS.includes(job.tool as typeof MANAGER_TOOLS[number])) result = { spend: { calls: 0 } };
    error = controller.signal.aborted ? String((controller.signal.reason as Error)?.message ?? "cancelled")
      : caught instanceof Error ? caught.message.slice(0, 4000) : "app-failed";
  } finally {
    clearTimeout(deadline); signal.removeEventListener("abort", forward);
    await sink.flush().catch(() => { error ??= "progress-write-failed"; });
  }
  await queueWrite(async () => {
    const current = await getAppJob(database, job.id);
    if (!current || !["running", "cancelling"].includes(current.status)) return;
    await recordAppSpend(database, job, spendOf(result));
    /*
      This is not display: it decides whether the row lands in `cancelled` or in `failed`. The
      comparison used to be against whole message texts, so the day either of those two gained a
      payload — «timeout: …» — it would have silently started calling a timeout a cancellation.
      Comparing the code is what makes it survive the payload it is now allowed to carry.
     */
    const outcome = faultOf(error).code;
    const cancelled = current.status === "cancelling" && outcome !== "timeout" && outcome !== "interrupted";
    await transitionAppJob(database, job.id, current.status, cancelled ? "cancelled" : error ? "failed" : "done", {
      result: result ?? null, error: error ?? null,
    });
    if (error && ["install", "update", "browser"].includes(job.tool)) {
      await updateApp(database, job.appId, { status: "failed", error });
    }
  });
  appJobsChanged();
  const staged = await readStaged(job.appId).catch(() => undefined);
  if (staged) { await activate(job.appId, staged); await syncInstalled(database, job.appId); }
}
export async function enqueueAppJob(request: {
  appId: string; identity: string; projectId?: string; tool: string; input: Record<string, unknown>;
}) {
  if (process.env["DATABASE_URL"]) throw new AppFault("local-catalog-required");
  officialApp(request.appId);
  await ensureAppSupervisor();
  const { db: database } = await db();
  const manager = MANAGER_TOOLS.includes(request.tool as typeof MANAGER_TOOLS[number]);
  const app = await getApp(database, request.appId);
  if (!app) throw new AppFault("unknown-app");
  let input: Record<string, unknown> = {};
  let paid = false;
  if (!manager) {
    if (!app.enabled || !app.version) throw new AppFault("not-installed");
    if (!request.identity || request.identity.length > 1000) throw new AppFault("invalid-identity");
    const project = await appProject(database, request.identity, request.projectId);
    input = { ...validateAppInput(request.tool, request.input) };
    input._projectId = project.id;
    if (input.music && !(await insideDir(project.root, String(input.music)))) throw new AppFault("music-outside-project");
    if (VIDEO_FIELDS[request.tool]?.includes("brain")) {
      const asked = input.brain !== undefined && input.brain !== "none";
      if (asked && input.brain !== app.settings.brain) throw new AppFault("provider-not-enabled");
      input.brain = input.brain ?? app.settings.brain;
      paid = input.brain !== "none";
    }
    if (VIDEO_FIELDS[request.tool]?.includes("voice") && !app.settings.voice) input.voice = "none";
    if (VIDEO_FIELDS[request.tool]?.includes("voice") && app.settings.voice && input.voice !== "none") paid = true;
  } else if (Object.keys(request.input).length) throw new AppFault("unexpected-operation-input");
  const { cap } = await capFor("app");
  const response = await queueWrite(() => enqueueAppJobRow(database, {
    appId: request.appId, identity: manager ? "" : request.identity, tool: request.tool,
    input, appVersion: app.version ?? "uninstalled", paid, cap: Math.min(cap, 1000),
  }));
  appJobsChanged();
  void runAppQueue(database).catch(() => {});
  return response;
}
export async function cancelAppJob(id: string): Promise<AppJob | undefined> {
  await ensureAppSupervisor();
  const { db: database } = await db();
  await queueWrite(async () => {
    const job = await getAppJob(database, id);
    if (job?.status === "pending") {
      await recordAppSpend(database, job, { calls: 0 });
      await transitionAppJob(database, id, "pending", "cancelled");
    } else if (job?.status === "running") await transitionAppJob(database, id, "running", "cancelling");
  });
  appJobsChanged();
  const state = runtime(database);
  if (state.jobId === id) state.controller?.abort(new AppFault("cancelled"));
  return getAppJob(database, id);
}
