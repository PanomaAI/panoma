import { describe, expect, it } from "vitest";
import type { AppJob } from "@panoma/db";
import { agentAppView, agentJobView, agentReport, productionInputOf, readCancel, readJobs, readProduction } from "./agent-video";

/**
 * The video door's own half: what an agent may send and what it reads back. The routes are
 * tested with a real catalog beside them; this is the shape work, which needs none.
 */

const ID = "c91d973b-fb4b-435a-9190-6b2c2fdc9c16";

describe("readProduction", () => {
  it("fills the terminal's defaults and keeps the location apart from the app's input", () => {
    const read = readProduction({ cwd: "/work/lemonade", root: "/work/lemonade", remote: "https://github.com/x/lemonade" });
    expect("body" in read).toBe(true);
    if (!("body" in read)) return;
    expect(read.body).toMatchObject({ cwd: "/work/lemonade", goal: "promo", format: "v", langs: ["en"], until: "preview" });
    expect(productionInputOf(read.body)).toEqual({ goal: "promo", format: "v", langs: ["en"], until: "preview" });
  });

  it("takes what the screen takes and the two an agent can know, and folds a repeated language", () => {
    const read = readProduction({
      cwd: "/work/lemonade", goal: "tutorial", format: "h", langs: ["es", "en", "es"], until: "final",
      url: "http://127.0.0.1:4173", theme: "grid", creative_brief: "For people who never opened a terminal.", force: true, new_story: false,
    });
    if (!("body" in read)) throw new Error(read.refused);
    expect(productionInputOf(read.body)).toEqual({
      goal: "tutorial", format: "h", langs: ["es", "en"], until: "final",
      url: "http://127.0.0.1:4173", theme: "grid", creative_brief: "For people who never opened a terminal.", force: true, new_story: false,
    });
  });

  it("names the person's two settings when an agent tries to send them, before any other refusal", () => {
    const brain = readProduction({ cwd: "/work", brain: "claude", nonsense: 1 });
    expect("refused" in brain && brain.refused).toMatch(/^brain is not on this channel/);
    const voice = readProduction({ cwd: "/work", voice: "none" });
    expect("refused" in voice && voice.refused).toMatch(/^voice is not on this channel/);
    const music = readProduction({ cwd: "/work", music: "/tmp/track.mp3" });
    expect("refused" in music && music.refused).toMatch(/^music is not on this channel/);
  });

  it("refuses what is not the shape, with the sentence that says what was wrong", () => {
    const cases: [unknown, RegExp][] = [
      [null, /expected exactly/],
      [[], /expected exactly/],
      [{ cwd: "/work", extra: true }, /unknown field extra/],
      [{ root: "/work" }, /cwd is required/],
      [{ cwd: 1 }, /cwd is required/],
      [{ cwd: "/work", goal: "advert" }, /goal is one of/],
      [{ cwd: "/work", format: "wide" }, /format is v/],
      [{ cwd: "/work", langs: [] }, /langs is a non-empty list/],
      [{ cwd: "/work", langs: ["fr"] }, /langs is a non-empty list/],
      [{ cwd: "/work", langs: "en" }, /langs is a non-empty list/],
      [{ cwd: "/work", until: "done" }, /until is plan/],
      [{ cwd: "/work", url: 4173 }, /url is an address/],
      [{ cwd: "/work", url: "x".repeat(2049) }, /url is an address/],
      [{ cwd: "/work", theme: "neon" }, /theme is one of/],
      [{ cwd: "/work", creative_brief: "" }, /creative_brief is a sentence/],
      [{ cwd: "/work", creative_brief: "x".repeat(2001) }, /creative_brief is a sentence/],
      [{ cwd: "/work", force: "yes" }, /force is a boolean/],
      [{ cwd: "/work", new_story: 1 }, /new_story is a boolean/],
    ];
    for (const [body, sentence] of cases) {
      const read = readProduction(body);
      expect("refused" in read, JSON.stringify(body)).toBe(true);
      if ("refused" in read) expect(read.refused, JSON.stringify(body)).toMatch(sentence);
    }
  });
});

describe("readJobs and readCancel", () => {
  it("take a job id as the catalog issues them and nothing shaped otherwise", () => {
    expect(readJobs({ cwd: "/work" })).toEqual({ body: { cwd: "/work", wait: false } });
    expect(readJobs({ cwd: "/work", id: ID, wait: true })).toEqual({ body: { cwd: "/work", id: ID, wait: true } });
    expect(readJobs({ cwd: "/work", id: "../secrets" })).toEqual({ refused: "id is a job id exactly as panoma_video or panoma_video_jobs gave it" });
    expect(readJobs({ cwd: "/work", wait: true })).toEqual({ refused: "wait needs an id: the list does not wait" });
    expect(readJobs({ cwd: "/work", wait: "yes", id: ID })).toEqual({ refused: "wait is a boolean" });
    expect(readJobs({ cwd: "/work", cancel: true })).toEqual({ refused: "unknown field cancel: expected exactly {cwd, root?, remote?, id?, wait?}" });
    expect(readCancel({ cwd: "/work", id: ID })).toEqual({ body: { cwd: "/work", id: ID } });
    expect(readCancel({ cwd: "/work" })).toEqual({ refused: "id is a job id exactly as panoma_video or panoma_video_jobs gave it" });
    expect(readCancel({ id: ID })).toEqual({ refused: "cwd is required, and every location field is a string" });
  });
});

function row(over: Partial<AppJob> = {}): AppJob {
  return {
    id: ID, appId: "panoma-video", identity: "git:lemonade", workspaceId: null, tool: "panoma_video_auto",
    input: { goal: "promo", format: "v", langs: ["en"], until: "preview", _projectId: "project-lemonade" },
    status: "running", progress: { stage: "plan", progress: 0, message: "plan: writing the briefs", at: "2026-09-12T10:00:05.000Z" },
    result: null, error: null, appVersion: "0.9.1", pid: 4242, dedupeKey: "k", reservedCalls: 0,
    requestedAt: new Date("2026-09-12T10:00:00.000Z"), startedAt: new Date("2026-09-12T10:00:01.000Z"), finishedAt: null,
    requestedBy: "claude-code",
    ...over,
  };
}

describe("agentJobView", () => {
  it("shows a running job with its stage, the app's line without the stage prefix, and no host field", () => {
    const view = agentJobView(row());
    expect(view).toMatchObject({
      id: ID, status: "running", requestedBy: "claude-code", stage: "plan", lastLine: "writing the briefs",
      requestedAt: "2026-09-12T10:00:00.000Z", startedAt: "2026-09-12T10:00:01.000Z", finishedAt: null, error: null, report: null,
    });
    expect(view.input).toEqual({ goal: "promo", format: "v", langs: ["en"], until: "preview" });
    expect(JSON.stringify(view)).not.toContain("_projectId");
    expect(JSON.stringify(view)).not.toContain("4242");
    expect(view.stages.map((stage) => `${stage.name}:${stage.state}`)).toEqual([
      "scout:done", "brand:done", "brain:done", "serve:done", "tour:done", "record:done", "score:done", "study:done",
      "plan:current", "narrate:pending", "render:pending", "review:pending",
    ]);
    expect(view.stages[8]?.summary).toBe("writing the briefs");
  });

  it("reduces a finished report to the cuts, the kinds set aside, the spend and the workspace", () => {
    const result = {
      project_id: "lemonade-1234", project_dir: "/home/x/.panoma/video/projects/lemonade-1234",
      stages: { scout: { status: "done", summary: "read 12 routes" }, plan: { status: "failed", summary: "no brief could be planned: promo — needs a click" } },
      briefs: [{ id: "promo-1", goal: "promo", file: "/x", recipe: "r", claims: 2 }],
      skipped: [{ goal: "trailer", why: "no reachable tag" }, { bad: true }],
      renders: [{
        id: "promo-1-en-v", file: "/home/x/.panoma/video/projects/lemonade-1234/renders/promo-1-en-v.mp4", seconds: 28.4,
        review: { status: "warn", failing: [{ id: "loudness", summary: "-11 LUFS", fix: { by: "render" } }], file: "/x/review.json" },
        provenance: "p",
      }, { id: 7 }],
      disclose: ["promo-1-en-v"], reference: "promo-1-en-v", spend: { calls: 5, provider: "claude", model: "sonnet" },
    };
    const view = agentJobView(row({ status: "done", finishedAt: new Date("2026-09-12T10:09:00.000Z"), result, progress: null }));
    expect(view.stages.find((stage) => stage.name === "plan")).toEqual({ name: "plan", state: "failed", summary: "no brief could be planned: promo — needs a click" });
    expect(view.stages.find((stage) => stage.name === "render")).toEqual({ name: "render", state: "pending" });
    expect(view.report).toEqual({
      renders: [{ id: "promo-1-en-v", file: "/home/x/.panoma/video/projects/lemonade-1234/renders/promo-1-en-v.mp4", seconds: 28.4,
        review: { status: "warn", failing: [{ id: "loudness", summary: "-11 LUFS" }] } }],
      skipped: [{ goal: "trailer", why: "no reachable tag" }],
      briefs: [{ id: "promo-1", goal: "promo" }],
      disclose: ["promo-1-en-v"], reference: "promo-1-en-v", dir: "/home/x/.panoma/video/projects/lemonade-1234",
      spend: { calls: 5, provider: "claude", model: "sonnet" },
    });
    expect(agentReport("not a report")).toBeNull();
    expect(agentReport({})).toEqual({ renders: [], skipped: [], briefs: [], disclose: [], reference: null, dir: null, spend: null });
  });
});

describe("agentAppView", () => {
  const detail = {
    id: "panoma-video", pkg: "@panoma/video", version: "0.9.0", latestVersion: "0.9.1", enabled: true, ready: true, status: "installed",
    manifest: { displayName: { en: "panoma video", es: "panoma vídeo" }, requirements: [{ id: "browser", kind: "playwright-browser" }, { id: "ffmpeg" }] },
    requirements: { ffmpeg: { present: true, version: "9.0.1" }, browser: { present: true, name: "chromium" } },
    settings: { brain: "claude", voice: true },
  };

  it("keeps state and never a path", () => {
    expect(agentAppView(detail as never)).toEqual({
      id: "panoma-video", name: "panoma video", version: "0.9.0", latestVersion: "0.9.1", enabled: true, ready: true,
      requirements: [{ id: "browser", present: true }, { id: "ffmpeg", present: true, version: "9.0.1" }],
      providers: { brain: "claude", voice: true }, next: "create",
    });
  });

  it("says the next step of the setup in the setup's order", () => {
    expect(agentAppView({ ...detail, version: null, ready: false } as never).next).toBe("install");
    expect(agentAppView({ ...detail, enabled: false, ready: false } as never).next).toBe("enable");
    expect(agentAppView({ ...detail, ready: false, requirements: {} } as never)).toMatchObject({
      next: "check", requirements: [{ id: "browser", present: null }, { id: "ffmpeg", present: null }],
    });
    expect(agentAppView({ ...detail, ready: false, requirements: { ffmpeg: { present: false }, browser: { present: true } } } as never).next).toBe("ffmpeg");
    expect(agentAppView({ ...detail, ready: false, requirements: { ffmpeg: { present: true }, browser: { present: false } } } as never).next).toBe("browser");
    expect(agentAppView({ ...detail, settings: undefined, manifest: null } as never)).toMatchObject({ name: "panoma-video", providers: { brain: "none", voice: false } });
  });
});
