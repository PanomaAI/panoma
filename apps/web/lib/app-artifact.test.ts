import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { appResultHasPath, byteRange, serveAppFile } from "./app-artifact";

const mocks = vi.hoisted(() => ({ getAppJob: vi.fn() }));
vi.mock("@panoma/db", async (original) => ({ ...await original<typeof import("@panoma/db")>(), getAppJob: mocks.getAppJob }));
vi.mock("./db", () => ({ db: async () => ({ db: {} }) }));
let home: string;
let data: string;
let file: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-artifact-"));
  vi.stubEnv("PANOMA_HOME", home);
  data = join(home, "video"); await mkdir(data);
  file = join(data, "preview.mp4"); await writeFile(file, "0123456789");
  mocks.getAppJob.mockResolvedValue({ id: "job", appId: "panoma-video", result: { renders: [{ file }] } });
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }); mocks.getAppJob.mockReset(); });
function request(path?: string, range?: string) {
  return new Request(`http://localhost:4173/api/apps/jobs/job/artifact${path ? `?path=${encodeURIComponent(path)}` : ""}`, {
    headers: range ? { range } : {},
  });
}

describe("contained job artifacts", () => {
  it("recognizes only an exact path in the result", () => {
    expect(appResultHasPath({ renders: [{ file }] }, file)).toBe(true);
    expect(appResultHasPath({ message: `Saved ${file}` }, file)).toBe(false);
    expect(appResultHasPath({ file }, `${file}.backup`)).toBe(false);
  });
  it("requires the path in the owning job, even when the file is inside the video home", async () => {
    const { GET } = await import("../app/api/apps/jobs/[jobId]/artifact/route");
    const context = { params: Promise.resolve({ jobId: "job" }) };
    const unlisted = join(data, "private.json"); await writeFile(unlisted, "{}");
    expect((await GET(request(unlisted), context)).status).toBe(404);
    const response = await GET(request(file), context);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("0123456789");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("rejects a sibling with the same prefix and a symlink into it", async () => {
    const sibling = join(home, "video-backup"); await mkdir(sibling);
    const outside = join(sibling, "secret.mp4"); await writeFile(outside, "private");
    const link = join(data, "link.mp4"); await symlink(outside, link);
    for (const path of [outside, link, data]) expect((await serveAppFile(request(path), data, path)).status).toBe(404);
    const { GET } = await import("../app/api/apps/jobs/[jobId]/artifact/route");
    mocks.getAppJob.mockResolvedValue({ id: "job", appId: "panoma-video", result: { file: link } });
    expect((await GET(request(link), { params: Promise.resolve({ jobId: "job" }) })).status).toBe(404);
  });
  it("serves ranges for seeking and returns 416 with the actual length", async () => {
    const partial = await serveAppFile(request(file, "bytes=2-4"), data, file);
    expect(partial.status).toBe(206); expect(await partial.text()).toBe("234");
    expect(partial.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(partial.headers.get("content-length")).toBe("3");
    const suffix = await serveAppFile(request(file, "bytes=-3"), data, file);
    expect(await suffix.text()).toBe("789");
    for (const range of ["bytes=20-30", "bytes=8-2", "bytes=-0", "bytes=1-2,4-5", "not-a-range"]) {
      const rejected = await serveAppFile(request(file, range), data, file);
      expect(rejected.status).toBe(416); expect(rejected.headers.get("content-range")).toBe("bytes */10");
    }
  });
  it("handles large requested ends without allowing unsafe offsets", () => {
    expect(byteRange("bytes=7-999", 10)).toEqual({ start: 7, end: 9 });
    expect(() => byteRange("bytes=99999999999999999-", 10)).toThrow("invalid-range");
  });
});
