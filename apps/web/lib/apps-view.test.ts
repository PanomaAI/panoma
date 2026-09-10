import { describe, expect, it, vi, afterEach } from "vitest";
import { APP_FAULTS } from "@panoma/apps/faults";
import { t } from "./i18n";
import { appFaultText, appRequest, appStatusKey, requirementsOf, currentProduction, jobArtifacts, jobPercent, productionExport, productionInput, productionLanguages, productionStory, videoDestination, watchAppJob, type AppJob } from "./apps-view";

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
