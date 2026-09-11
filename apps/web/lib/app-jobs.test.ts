import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureApp, enqueueAppJobRow, getAppJob, claimAppJob, hasPendingAppJob, transitionAppJob, schema, MAX_APP_SPEND_CALLS, type AppJob, type Database } from "@panoma/db";
import { appJobsChanged, appProgressSink, browserProgress, reconcileApps, runAppQueue, spendOf, stopAppSupervisor, whenAppJobsChange } from "./app-jobs";
import { MANAGER_TOOLS, appResultFailure, validateAppInput } from "./app-input";

vi.mock("./db", () => ({ db: vi.fn() }));
let database: Database;
let close: () => Promise<unknown>;
let home: string;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-app-supervisor-"));
  vi.stubEnv("PANOMA_HOME", home); vi.stubEnv("DATABASE_URL", "");
  ({ db: database, close } = await (await import("@panoma/db/client")).openDatabase());
});
beforeEach(async () => {
  await database.delete(schema.apps);
  await ensureApp(database, "panoma-video", "@panoma/video");
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await stopAppSupervisor(database); await close(); vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});
const enqueue = (identity: string) => enqueueAppJobRow(database, {
  appId: "panoma-video", identity, tool: "panoma_video_auto", input: {}, appVersion: "0.2.0",
});
describe("app supervision", () => {
  it("drains durable jobs one at a time despite overlapping wakeups", async () => {
    const first = await enqueue("one"); const second = await enqueue("two");
    let release!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const started: string[] = [];
    const execute = async (db: Database, job: AppJob) => {
      started.push(job.id);
      if (job.id === first.job.id) await paused;
      await transitionAppJob(db, job.id, "running", "done");
    };
    const worker = runAppQueue(database, execute);
    await expect.poll(() => started.length).toBe(1);
    const anotherWake = runAppQueue(database, execute);
    expect((await getAppJob(database, second.job.id))?.status).toBe("pending");
    release(); await Promise.all([worker, anotherWake]);
    expect(started).toEqual([first.job.id, second.job.id]);
    expect((await getAppJob(database, second.job.id))?.status).toBe("done");
  });
  /*
    The claim is exclusive, so an ending that never gets written is not one lost job: it is every
    later job, until somebody restarts the server. This is the case that used to do it — a receipt
    the ledger refuses, thrown from inside the write that closes the job.
   */
  it("closes a job whose ending cannot be written instead of stopping the queue for good", async () => {
    expect(await hasPendingAppJob(database)).toBe(false);
    const first = await enqueue("explodes"); const second = await enqueue("after");
    expect(await hasPendingAppJob(database)).toBe(true);
    const execute = async (db: Database, job: AppJob) => {
      if (job.id === first.job.id) throw new Error("invalid-app-spend-receipt");
      await transitionAppJob(db, job.id, "running", "done");
    };
    await runAppQueue(database, execute);
    expect(await getAppJob(database, first.job.id)).toMatchObject({ status: "failed", error: "invalid-app-spend-receipt" });
    expect((await getAppJob(database, second.job.id))?.status).toBe("done");
    expect(await hasPendingAppJob(database)).toBe(false);
  });
  it("bounds a receipt to what the ledger accepts rather than letting it throw", () => {
    expect(spendOf({ spend: { calls: 5_000, provider: "openai" } })).toMatchObject({ calls: MAX_APP_SPEND_CALLS, provider: "openai" });
    expect(spendOf({ spend: { calls: 3 } })?.calls).toBe(3);
    expect(spendOf({ spend: { calls: -1 } })).toBeUndefined();
    expect(spendOf({})).toBeUndefined();
  });
  it("recovers interrupted work without killing a stored PID or losing pending work", async () => {
    const first = await enqueue("interrupted"); await claimAppJob(database);
    await database.update(schema.appJobs).set({ pid: process.pid });
    const pending = await enqueue("pending");
    await reconcileApps(database);
    expect(await getAppJob(database, first.job.id)).toMatchObject({ status: "failed", error: "interrupted", pid: null });
    expect((await getAppJob(database, pending.job.id))?.status).toBe("pending");
    expect(() => process.kill(process.pid, 0)).not.toThrow();
  });
  it("coalesces progress at one second and flushes the last update", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const write = vi.fn(async (_progress: NonNullable<AppJob["progress"]>) => {}); const sink = appProgressSink(write);
    for (let i = 0; i < 30; i++) sink.push({ progress: i, total: 100, message: "render: frame" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toMatchObject({ progress: 29, stage: "render" });
    sink.push({ progress: 100, message: "done: completed" }); await sink.flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]?.[0]).toMatchObject({ progress: 100 });
  });
  /*
    One route now answers for every lifecycle operation, so the closed list it validates against is
    the only thing standing between a path segment and the dispatcher. Both surfaces that can name
    an operation are read here: eleven identical files could drift one at a time, one file plus one
    list cannot.
   */
  /*
    Captured from `playwright install chromium` with stdout piped, which is how the guardian runs
    it: the basic printer, one line per ten per cent. The download was on the screen only as this
    text quoted whole, and a person who had just pressed the button read a bar of block characters
    at the foot of the page instead of seeing one.
   */
  it("reads the percentage out of the downloader's lines and starts over on each archive", () => {
    const measure = browserProgress();
    expect(measure("Downloading Chromium 141.0.7390.37 (playwright build v1194) from https://cdn.playwright.dev/x.zip")).toEqual({ progress: 0 });
    expect(measure("|■■■■■■■■                                                                        |  10% of 143.3 MiB")).toEqual({ progress: 10, total: 100 });
    expect(measure("|■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■| 100% of 143.3 MiB")).toEqual({ progress: 100, total: 100 });
    // A line with no figure keeps the last one: the bar must not vanish between two archives.
    expect(measure("Chromium 141.0.7390.37 (playwright build v1194) downloaded to /x")).toEqual({ progress: 100, total: 100 });
    expect(measure("Downloading FFmpeg playwright build v1011 from https://cdn.playwright.dev/y.zip")).toEqual({ progress: 0 });
    expect(measure("|■■■■■■■■■■■■■■■■                                                                |  20% of 2.3 MiB")).toEqual({ progress: 20, total: 100 });
  });
  it("accepts only the operations the supervisor dispatches, from either surface", async () => {
    const route = await readFile(new URL("../app/api/apps/[id]/[operation]/route.ts", import.meta.url), "utf8");
    expect(route).toContain("MANAGER_TOOLS.includes(operation");
    /*
      Next matches a static segment before a dynamic one —the built route manifest lists
      `[id]/jobs`, `[id]/legal` and `[id]/settings` above `[id]/[operation]`— so an operation
      named after one of those neighbours would be shadowed for good and answer 405 instead.
     */
    expect(MANAGER_TOOLS.filter(name => ["jobs", "settings", "legal"].includes(name))).toEqual([]);
    const screen = await readFile(new URL("../components/apps.tsx", import.meta.url), "utf8");
    const clicked = [...screen.matchAll(/onOperate\((?:[^)"]*\? )?"([a-z]+)"(?: : "([a-z]+)")?/g)]
      .flatMap(match => [match[1]!, match[2]]).filter((name): name is string => !!name);
    expect(new Set(clicked).size).toBeGreaterThan(5);
    expect(clicked.filter(name => !MANAGER_TOOLS.includes(name as typeof MANAGER_TOOLS[number]))).toEqual([]);
    const cli = await readFile(new URL("../../cli/src/apps.ts", import.meta.url), "utf8");
    const verbs = JSON.parse(/includes\(verb\)[\s\S]*?/.test(cli)
      ? /(\[(?:"[a-z]+",?\s*)+\])\.includes\(verb\)/.exec(cli)![1]!.replace(/,\s*\]/, "]") : "[]") as string[];
    expect(verbs.length).toBeGreaterThan(5);
    // `remove` is the terminal's word for the operation the supervisor calls `uninstall`.
    expect(verbs.map(verb => verb === "remove" ? "uninstall" : verb)
      .filter(name => !MANAGER_TOOLS.includes(name as typeof MANAGER_TOOLS[number]))).toEqual([]);
  });
  it("wakes an observer when a job moves and still gives up on its own", async () => {
    const woken = { now: false };
    const controller = new AbortController();
    const waiting = whenAppJobsChange(controller.signal, 60_000).then(() => { woken.now = true; });
    await Promise.resolve();
    expect(woken.now).toBe(false);
    appJobsChanged();
    await waiting;
    expect(woken.now).toBe(true);
    // The backstop is what makes a notification that never arrives cost a moment and not the wait.
    const started = Date.now();
    await whenAppJobsChange(new AbortController().signal, 20);
    expect(Date.now() - started).toBeGreaterThanOrEqual(10);
    // A reader that closes its tab releases the wait instead of holding a timer for its full term.
    const closing = new AbortController();
    const abandoned = whenAppJobsChange(closing.signal, 60_000);
    closing.abort();
    await abandoned;
  });
  it("blocks host arguments and remote URLs, and preserves semantic render failures", () => {
    expect(() => validateAppInput("panoma_video_auto", { project_path: "/tmp" })).toThrow("unknown-app-input");
    expect(() => validateAppInput("panoma_video_auto", { url: "https://example.com" })).toThrow("local-url-required");
    expect(appResultFailure({ stages: { render: { status: "failed" } } }, "panoma_video_auto", {})).toContain("stage-failed");
    expect(appResultFailure({ review: { status: "fail" } }, "panoma_video_render", {})).toBe("review-failed");
    expect(appResultFailure({ status: "fail" }, "panoma_video_review", {})).toBe("review-failed");
    expect(appResultFailure({ renders: [] }, "panoma_video_auto", { until: "preview" })).toBe("no-supported-production");
    expect(appResultFailure({ renders: [] }, "panoma_video_auto", { until: "plan" })).toBeUndefined();
  });
});
