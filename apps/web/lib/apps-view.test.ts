import { describe, expect, it, vi, afterEach } from "vitest";
import { APP_FAULTS } from "@panoma/apps/faults";
import { t } from "./i18n";
import { activeOperation, appFaultText, appRequest, appStatusKey, requirementsOf, currentProduction, jobArtifacts, jobPercent, jobSeconds, nextStep, productionExport, productionInput, productionLanguages, productionStory, skippedGoals, stageReport, videoDestination, watchAppJob, VIDEO_STAGES, type AppJob, type AppSummary } from "./apps-view";

afterEach(() => vi.unstubAllGlobals());

describe("optional apps presentation", () => {
  it("does not mistake installation for a usable video runtime", () => {
    expect(appStatusKey({ id: "panoma-video", pkg: "@panoma/video", status: "installed", version: "0.2.0", ready: false })).toBe("apps.status.installed");
    expect(appStatusKey({ id: "panoma-video", pkg: "@panoma/video", status: "installed", version: "0.2.0", ready: true, enabled: false })).toBe("apps.status.disabled");
    expect(videoDestination("a project", false)).toBe("/apps/panoma-video?project=a%20project");
  });
  it("merges measured availability with the manifest's download disclosures", () => {
    expect(requirementsOf({ id: "panoma-video", pkg: "@panoma/video", status: "installed",
      manifest: { requirements: [{ id: "browser", approxMB: 550 }] }, requirements: { browser: { present: false }, home: "/tmp/private" },
    })).toEqual([{ id: "browser", approxMB: 550, present: false }]);
  });
  it("bounds progress and leaves unknown totals indeterminate", () => {
    const job = { id: "j", appId: "panoma-video", identity: "i", tool: "install", input: {}, status: "running" };
    expect(jobPercent({ ...job, progress: { progress: 20, total: 10 } })).toBe(100);
    expect(jobPercent({ ...job, progress: { progress: 20, total: 0 } })).toBeUndefined();
    expect(jobArtifacts({ ...job, result: { file: "/tmp/a.mp4", nested: { sheet: "/tmp/a.png" }, url: "https://example.com/a.mp4" } })).toEqual([
      { path: "/tmp/a.mp4", name: "a.mp4", kind: "video" }, { path: "/tmp/a.png", name: "a.png", kind: "image" },
    ]);
  });
  it("starts a preview in the chosen language without granting providers", () => {
    expect(productionInput({ language: "es", goal: "promo", format: "v" })).toEqual({ goal: "promo", format: "v", langs: ["es"], until: "preview" });
    // An address already running travels only when the person typed one; blanks are not a field.
    expect(productionInput({ language: "en", goal: "promo", format: "h", url: "  " })).toEqual({ goal: "promo", format: "h", langs: ["en"], until: "preview" });
    expect(productionInput({ language: "en", goal: "promo", format: "h", url: " http://127.0.0.1:4173 " })).toEqual({ goal: "promo", format: "h", langs: ["en"], until: "preview", url: "http://127.0.0.1:4173" });
  });
  it("keeps scene edits on the selected production and supports ProductPromo only", () => {
    const job: AppJob = { id: "story-a", appId: "panoma-video", identity: "i", tool: "panoma_video_story", input: {}, status: "done", result: { brief_id: "a" } };
    const latest = { ...job, id: "story-b", result: { brief_id: "b" } };
    const production = { ...job, tool: "panoma_video_auto", result: { briefs: [{ id: "a", recipe: "ProductPromo" }] } };
    expect(productionStory([latest, job], production)).toEqual({ brief: "a", job });
    expect(productionStory([latest, job], { ...production, result: { briefs: [{ id: "a", recipe: "Tutorial" }] } })).toEqual({ brief: undefined, job: undefined });
    expect(productionStory([{ ...job, requestedAt: "2026-09-08T10:00:00.000Z" }], { ...production, requestedAt: "2026-09-08T11:00:00.000Z" })).toEqual({ brief: "a", job: undefined });
  });
  it("exports the saved ProductPromo story through render without regenerating its revisions", () => {
    const production: AppJob = { id: "auto", appId: "panoma-video", identity: "i", tool: "panoma_video_auto", status: "done", input: { goal: "promo", until: "preview" },
      result: { briefs: [{ id: "saved-promo", recipe: "ProductPromo" }] } };
    expect(productionExport(production, { language: "es", format: "h" })).toEqual({ tool: "panoma_video_render", input: { brief_id: "saved-promo", lang: "es", format: "h" } });
    expect(productionExport({ ...production, result: { briefs: [] } }, { language: "es", format: "h" })).toEqual({ tool: "panoma_video_auto", input: { goal: "promo", until: "final" } });
  });
  it("treats an earlier render as historical when a newer auto reused its brief", () => {
    const old: AppJob = { id: "old", appId: "panoma-video", identity: "i", tool: "panoma_video_auto", status: "done", input: {}, result: { briefs: [{ id: "promo", recipe: "ProductPromo" }] } };
    const current = { ...old, id: "current" };
    expect(currentProduction([current, old], old)?.id).toBe("current");
    expect(currentProduction([current, old], current)?.id).toBe("current");
  });
  it("keeps saved production languages independent from the browser and new production form", () => {
    const production: AppJob = { id: "p", appId: "panoma-video", identity: "i", tool: "panoma_video_auto", status: "done", input: { langs: ["es"] } };
    const story = { ...production, result: { scenes: [{ text: { es: "Una escena", en: "" } }] } };
    expect(productionLanguages(production, undefined)).toEqual(["es"]);
    expect(productionLanguages(production, story)).toEqual(["es"]);
    expect(productionLanguages({ ...production, input: {} }, story)).toEqual(["es"]);
  });
  /*
    The page used to leave this to be worked out from which buttons were grey, and the buttons
    were in two columns the grid does not order. One step, in the order of the setup, and the
    server's own «ready» wins over anything the page could infer.
   */
  it("names the one step to take next, in the order of the setup", () => {
    const app: AppSummary = { id: "panoma-video", pkg: "@panoma/video", status: "absent" };
    expect(nextStep(app)).toBe("install");
    expect(nextStep({ ...app, version: "0.9.0", enabled: false })).toBe("enable");
    expect(nextStep({ ...app, version: "0.9.0", enabled: true })).toBe("check");
    expect(nextStep({ ...app, version: "0.9.0", enabled: true, requirements: { browser: { present: false }, ffmpeg: { present: true } } })).toBe("browser");
    expect(nextStep({ ...app, version: "0.9.0", enabled: true, requirements: { browser: { present: true }, ffmpeg: { present: false } } })).toBe("ffmpeg");
    // Both missing: the download this page can do comes before the install it can only describe.
    expect(nextStep({ ...app, version: "0.9.0", enabled: true, requirements: { browser: { present: false }, ffmpeg: { present: false } } })).toBe("browser");
    expect(nextStep({ ...app, version: "0.9.0", enabled: true, ready: true })).toBe("create");
  });
  it("finds the operation on the app itself and not a production", () => {
    const job: AppJob = { id: "b", appId: "panoma-video", identity: "", tool: "browser", input: {}, status: "running" };
    const app: AppSummary = { id: "panoma-video", pkg: "@panoma/video", status: "installed", jobs: [
      { ...job, id: "auto", tool: "panoma_video_auto", identity: "i" }, { ...job, id: "old", status: "done" }, job,
    ] };
    expect(activeOperation(app)?.id).toBe("b");
    expect(activeOperation({ ...app, jobs: [] })).toBeUndefined();
    expect(activeOperation(null)).toBeUndefined();
  });
  it("counts the seconds a job has been at it, or took", () => {
    const job: AppJob = { id: "j", appId: "panoma-video", identity: "i", tool: "panoma_video_auto", input: {}, status: "running", requestedAt: "2026-09-11T02:44:12.000Z" };
    expect(jobSeconds(job, Date.parse("2026-09-11T02:45:00.000Z"))).toBe(48);
    expect(jobSeconds({ ...job, status: "failed", finishedAt: "2026-09-11T02:54:01.000Z" }, 0)).toBe(589);
    expect(jobSeconds({ ...job, requestedAt: undefined })).toBeUndefined();
  });

  /*
    Two sources, one shape. While the run is on the only thing known is the stage the app last
    named; once it is over, its report says what every stage did. The report is what turns «a
    stage failed» into an answer, and this is what keeps the two readings from drifting apart.
   */
  it("reads the stages from the app's last word while running, and from its report after", () => {
    const running: AppJob = { id: "j", appId: "panoma-video", identity: "i", tool: "panoma_video_auto", input: {}, status: "running",
      progress: { stage: "record", message: "record: shooting take 2 of 2" } };
    const rows = stageReport(running);
    expect(rows.map((row) => row.name)).toEqual([...VIDEO_STAGES]);
    expect(rows.slice(0, 5).every((row) => row.state === "done")).toBe(true);
    expect(rows[5]).toEqual({ name: "record", state: "current", summary: "shooting take 2 of 2" });
    expect(rows.slice(6).every((row) => row.state === "pending")).toBe(true);
    // Before the first stage speaks, nothing is done and nothing is current.
    expect(stageReport({ ...running, progress: { stage: "starting", message: "starting: App connected" } }).every((row) => row.state === "pending")).toBe(true);

    const report = { stages: {
      scout: { status: "done", summary: "panoma-monorepo · web-app" },
      serve: { status: "done", summary: "could not start the product: `pnpm run dev` exited with code 1 — using the deployed address" },
      score: { status: "skipped", summary: "no track" },
      plan: { status: "failed", summary: "no brief could be planned: promo — needs a click" },
      render: { status: "skipped", summary: "not run" },
    } };
    const failed = stageReport({ ...running, status: "failed", progress: { stage: "plan", message: "plan: failed: …" }, result: report });
    expect(failed.find((row) => row.name === "serve")).toEqual({ name: "serve", state: "done", summary: report.stages.serve.summary });
    expect(failed.find((row) => row.name === "score")?.state).toBe("skipped");
    expect(failed.find((row) => row.name === "plan")?.state).toBe("failed");
    expect(failed.find((row) => row.name === "brand")?.state).toBe("pending");
    // A run that ended with no report — interrupted — is read like a running one, ended where it stood.
    expect(stageReport({ ...running, status: "failed", result: undefined }).find((row) => row.name === "record")?.state).toBe("failed");
    expect(stageReport(undefined)).toEqual([]);
  });
  it("puts the kind of video that was asked for first among the reasons nothing was planned", () => {
    const skipped = [
      { goal: "changelog", why: "no tagged CHANGELOG section" },
      { goal: "trailer", why: "no reachable tag" },
      { goal: "tutorial", why: "too few steps" },
      { goal: "promo", why: "A promotion needs a real product click." },
    ];
    const job: AppJob = { id: "j", appId: "panoma-video", identity: "i", tool: "panoma_video_auto", input: { goal: "promo" }, status: "failed", result: { skipped } };
    expect(skippedGoals(job)).toEqual({ asked: [skipped[3]], others: skipped.slice(0, 3) });
    // A tutorial is planned from the facts too, under that other name.
    expect(skippedGoals({ ...job, input: { goal: "tutorial" }, result: { skipped: [...skipped, { goal: "facts", why: "no facts" }] } }).asked.map((item) => item.goal)).toEqual(["tutorial", "facts"]);
    expect(skippedGoals({ ...job, input: {} }).asked).toHaveLength(4);
    expect(skippedGoals({ ...job, result: { skipped: "not a list" } })).toEqual({ asked: [], others: [] });
    expect(skippedGoals(undefined)).toEqual({ asked: [], others: [] });
  });
  it("observes a durable job until completion without sending a cancellation", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: "j", status: "running" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "j", status: "done" })));
    vi.stubGlobal("fetch", fetcher);
    const changed = vi.fn(); const failed = vi.fn();
    await watchAppJob("j", new AbortController().signal, changed, failed);
    expect(changed.mock.calls.map(([job]) => job.status)).toEqual(["running", "done"]);
    expect(fetcher.mock.calls.every(([url]) => url === "/api/apps/jobs/j?wait=1")).toBe(true);
    expect(failed).not.toHaveBeenCalled();
  });
  it("closing the observer aborts only its request", async () => {
    const controller = new AbortController(); const changed = vi.fn(); const failed = vi.fn();
    const fetcher = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    vi.stubGlobal("fetch", fetcher);
    const observer = watchAppJob("j", controller.signal, changed, failed);
    controller.abort(); await observer;
    expect(fetcher).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
  });
  it("follows a duplicate live job but rejects a conflict without a job", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: "existing" }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "busy" }), { status: 409 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await appRequest("/api/apps/panoma-video/jobs", { tool: "panoma_video_auto" })).toEqual({ id: "existing" });
    await expect(appRequest("/api/apps/panoma-video/jobs", {})).rejects.toThrow("busy");
  });
});

/*
  The gap checker in `i18n-gaps.test.ts` reads the dictionary as text and follows keys it can see
  written at a call site. These are dispatched from a table, so it cannot see any of them: it goes
  dark for exactly the sentences a person reads at the worst moment. This loop is what replaces
  it, and it has to render every code in both languages — «1 commits» came back nine times
  because a sentence with a gap in it looks fine until the one case that fills it wrong.
 */
describe("every failure has a sentence, in both languages", () => {
  it.each(APP_FAULTS)("%s", (code) => {
    const detail = code === "node-too-old" || code === "npm-too-old" ? ">=22.18 | v22.17.0" : "npm error code E404";
    const said = appFaultText(`${code}: ${detail}`);
    for (const locale of ["es", "en"] as const) {
      const sentence = t(locale, said.key, said.vars);
      expect(sentence, `${code} in ${locale}: says nothing`).not.toBe("");
      expect(sentence, `${code} in ${locale}: a gap was left unfilled`).not.toMatch(/[{}]/);
    }
  });

  it("names the stage that failed in the reader's language, and quotes one it does not know", () => {
    const said = appFaultText("stage-failed: plan");
    expect(said).toEqual({ key: "apps.fault.stageFailedAt", stage: "plan" });
    expect(t("es", said.key, { stage: t("es", "apps.jobs.stage.plan") })).toBe("La etapa «Planificar escenas» falló.");
    expect(t("en", said.key, { stage: t("en", "apps.jobs.stage.plan") })).toBe("The “Plan scenes” stage failed.");
    expect(appFaultText("stage-failed: kit")).toEqual({ key: "apps.fault.stageFailed", quote: "kit" });
    expect(appFaultText("stage-failed")).toEqual({ key: "apps.fault.stageFailed" });
  });

  it("names both figures when an engine is too old, and neither when they will not parse", () => {
    const said = appFaultText("node-too-old: >=22.18 | v22.17.0");
    expect(said.vars).toEqual({ needed: ">=22.18", running: "v22.17.0" });
    expect(t("es", said.key, said.vars)).toBe("La app pide una versión de Node.js más nueva que la de esta máquina. Necesita: >=22.18. Instalada: v22.17.0.");
    expect(t("en", said.key, said.vars)).toBe("The app needs a newer Node.js than this machine has. Required: >=22.18. Installed: v22.17.0.");
    // A payload that does not split in two loses the figures rather than showing half of them.
    expect(appFaultText("node-too-old: nonsense").key).toBe("apps.fault.engineUnsupported");
    expect(appFaultText("node-too-old").key).toBe("apps.fault.engineUnsupported");
  });

  /*
    The `error` column is plain text with no version marker, and the fifteen most recent job rows
    are re-read on every visit. The first release carrying this vocabulary reads rows the release
    before it wrote — raw npm output, a transport failure, the app's own prose — and every one of
    them has to render exactly as it did then: the generic label, and the text quoted whole.
   */
  it("quotes what it does not recognise, as it always did", () => {
    for (const legacy of ["HTTP 500", "Provider refused [redacted]", "Invalid URL", "npm ERR! code E404"]) {
      expect(appFaultText(legacy)).toEqual({ key: "apps.error", quote: legacy });
    }
    expect(appFaultText(null)).toEqual({ key: "apps.error" });
    expect(appFaultText("")).toEqual({ key: "apps.error" });
    // And what it does recognise keeps the machine's own words underneath the sentence.
    expect(appFaultText("process-failed: npm error code E404"))
      .toEqual({ key: "apps.fault.processFailed", quote: "npm error code E404" });
    expect(appFaultText("offline")).toEqual({ key: "apps.fault.offline" });
  });
});
