import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAppDetail, publicAppValue, saveAppSettings } from "./apps";

const mocks = vi.hoisted(() => ({
  getApp: vi.fn(), listAppJobs: vi.fn(), updateApp: vi.fn(), supervisor: vi.fn(),
  directoryBytes: vi.fn(async () => 123),
}));
vi.mock("./db", () => ({ db: async () => ({ db: {} }) }));
vi.mock("./app-jobs", () => ({ ensureAppSupervisor: mocks.supervisor }));
vi.mock("@panoma/db", async (original) => ({ ...await original<typeof import("@panoma/db")>(),
  getApp: mocks.getApp, listAppJobs: mocks.listAppJobs, updateApp: mocks.updateApp,
  queueWrite: async (write: () => Promise<unknown>) => write(),
}));
vi.mock("@panoma/apps", async (original) => ({ ...await original<typeof import("@panoma/apps")>(),
  registryVersion: async () => ({ version: "0.2.0", checkedAt: new Date("2026-09-08T00:00:00Z") }),
  directoryBytes: mocks.directoryBytes,
  findNpm: () => ({ source: "node-sibling", file: "/private/npm-cli.js" }),
}));
/* The manifest is the one the published package actually declares, install line included. */
const FFMPEG_INSTALL = "brew install ffmpeg / choco install ffmpeg / apt install ffmpeg";
const base = () => ({ id: "panoma-video", pkg: "@panoma/video", version: "0.2.0", status: "installed", enabled: true,
  settings: { brain: "none", voice: false },
  manifest: { entry: { mcp: "dist/mcp.js" }, displayName: { en: "panoma video", es: "panoma video" },
    requirements: [
      { id: "browser", kind: "playwright-browser", approxMB: 550, termsUrl: "https://www.google.com/chrome/terms/" },
      { id: "ffmpeg", kind: "executable", install: { en: FFMPEG_INSTALL, es: FFMPEG_INSTALL } },
    ] },
  requirements: { browser: { present: true, path: "/Users/person/chrome" }, ffmpeg: { present: true, path: "C:\\tools\\ffmpeg.exe" }, home: "/home/person/video" },
  error: null,
});
beforeEach(() => {
  vi.clearAllMocks(); mocks.getApp.mockResolvedValue(base());
  mocks.listAppJobs.mockResolvedValue([{ id: "j", appId: "panoma-video", status: "done", requestedAt: new Date("2026-09-08T00:00:00Z"),
    input: { project_path: "/Users/person/project" }, result: { file: "/home/person/render.mp4" }, pid: 123 }]);
});

describe("official app detail and settings", () => {
  it("omits local paths from the public detail while preserving legal URLs and job dates", async () => {
    const detail = await getAppDetail("panoma-video", { space: true });
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toMatch(/\/Users|\/home|C:\\\\|\/private/);
    expect(serialized).toContain("https://www.google.com/chrome/terms/");
    expect(detail.space).toEqual({ packageBytes: 123, dataBytes: 123 });
    expect(detail.jobs[0]).toMatchObject({ requestedAt: "2026-09-08T00:00:00.000Z" });
    expect(detail.ready).toBe(true);
    expect(detail.jobs[0]).not.toHaveProperty("input");
    expect(detail.jobs[0]).not.toHaveProperty("result");
    expect(detail.jobs[0]).not.toHaveProperty("pid");
  });
  it.each(["broken", "disabled", "installing", "absent"])("does not call %s ready despite stale requirements", async (status) => {
    mocks.getApp.mockResolvedValue({ ...base(), status });
    expect((await getAppDetail("panoma-video")).ready).toBe(false);
  });
  it("requires both enabled state and a complete probe", async () => {
    mocks.getApp.mockResolvedValue({ ...base(), enabled: false }); expect((await getAppDetail("panoma-video")).ready).toBe(false);
    mocks.getApp.mockResolvedValue({ ...base(), requirements: { browser: { present: false }, ffmpeg: { present: true } } });
    expect((await getAppDetail("panoma-video")).ready).toBe(false);
  });
  it("keeps the manifest's own words, which are the same on every machine", async () => {
    const detail = await getAppDetail("panoma-video");
    const manifest = detail.manifest as { requirements: { id: string; install?: { en: string } }[] };
    // The line that says how to install FFmpeg is three commands separated by slashes; reading a
    // lone slash as the start of a path used to leave `[local path]` where each separator was.
    expect(manifest.requirements.find((item) => item.id === "ffmpeg")?.install?.en).toBe(FFMPEG_INSTALL);
    expect(manifest.requirements.find((item) => item.id === "browser")?.id).toBe("browser");
  });
  it("does not walk the disk for a screen that shows no sizes", async () => {
    const detail = await getAppDetail("panoma-video");
    expect(mocks.directoryBytes).not.toHaveBeenCalled();
    expect(detail).not.toHaveProperty("space");
    expect(detail.ready).toBe(true);
    await getAppDetail("panoma-video", { space: true });
    expect(mocks.directoryBytes).toHaveBeenCalledTimes(2);
  });
  it("keeps a Windows path with a space whole instead of leaving its tail in view", () => {
    expect(publicAppValue("ffprobe missing at C:\\Program Files\\ffmpeg\\bin")).toBe("ffprobe missing at [local path]");
    expect(publicAppValue("saved file:///Users/person/render.mp4")).toBe("saved [local path]");
    expect(publicAppValue("aspect 16:9 or 9:16, ratio 4/3")).toBe("aspect 16:9 or 9:16, ratio 4/3");
  });
  it("redacts error paths in arbitrary Unix mount points without damaging URLs", () => {
    expect(publicAppValue("Cannot open /mnt/projects/private/file and C:\\work\\secret.txt")).not.toMatch(/\/mnt|C:\\/);
    expect(publicAppValue("https://registry.npmjs.org/@panoma/video")).toBe("https://registry.npmjs.org/@panoma/video");
  });
  it("keeps default providers off and refuses enabling without explicit confirmation", async () => {
    expect(await saveAppSettings("panoma-video", {})).toEqual({ brain: "none", voice: false });
    mocks.updateApp.mockClear();
    await expect(saveAppSettings("panoma-video", { brain: "openai" })).rejects.toThrow("provider-confirmation-required");
    await expect(saveAppSettings("panoma-video", { voice: true })).rejects.toThrow("provider-confirmation-required");
    expect(mocks.updateApp).not.toHaveBeenCalled();
  });
  it("stores confirmed provider settings without persisting confirmation or accepting credentials", async () => {
    expect(await saveAppSettings("panoma-video", { brain: "openai", confirm: true })).toEqual({ brain: "openai", voice: false });
    expect(mocks.updateApp.mock.calls[0]?.[2]).toEqual({ settings: { brain: "openai", voice: false } });
    await expect(saveAppSettings("panoma-video", { OPENAI_API_KEY: "secret" })).rejects.toThrow("unknown-setting");
  });
});
