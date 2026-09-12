import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAgent, type Database } from "@panoma/db";

/**
 * The channel's app list: what `panoma_apps` reads. The catalog is real for the agent key; the
 * app detail is the operator door's own answer, mocked to a fixture because measuring it means a
 * registry and a probe, and the view is tested on its own in `lib/agent-video.test.ts`.
 */
let database: Database;
let home: string;
let apiKey: string;

vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
vi.mock("@/lib/apps", () => ({
  getApps: async () => ({
    apps: [{
      id: "panoma-video", pkg: "@panoma/video", version: "0.9.0", latestVersion: "0.9.1", enabled: true, ready: false, status: "installed",
      manifest: { displayName: { en: "panoma video", es: "panoma vídeo" }, requirements: [{ id: "browser" }, { id: "ffmpeg" }] },
      requirements: { ffmpeg: { present: true, version: "9.0.1", path: "/opt/homebrew/bin/ffmpeg" }, browser: { present: false } },
      settings: { brain: "none", voice: false }, jobs: [], npm: { present: true, source: "path" },
    }],
  }),
  publicAppValue: (value: unknown) => value,
}));

const { POST } = await import("./route");
const originalHome = process.env["PANOMA_HOME"];

function call(body: unknown, init: { key?: string | null; crossSite?: boolean } = {}): Request {
  const key = init.key === undefined ? apiKey : init.key;
  return new Request("http://localhost:4173/api/agent/apps", {
    method: "POST",
    headers: {
      host: "localhost:4173",
      "content-type": "application/json",
      "accept-language": "en",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(init.crossSite ? { origin: "http://evil.example", "sec-fetch-site": "cross-site" } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-agent-apps-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database } = await openDatabase());
  ({ apiKey } = await createAgent(database, { name: "claude-code", kind: "claude_code" }));
});

afterAll(async () => {
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  await rm(home, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env["DATABASE_URL"];
});

describe("POST /api/agent/apps", () => {
  it("stops the tab next door before the body, and the stranger after", async () => {
    const foreign = call({}, { crossSite: true });
    const readBody = vi.spyOn(foreign, "json");
    expect((await POST(foreign)).status).toBe(403);
    expect(readBody).not.toHaveBeenCalled();
    expect((await POST(call({}, { key: null }))).status).toBe(401);
  });

  it("answers each app's state and the person's next step, and never a path", async () => {
    const response = await POST(call({ cwd: "/anywhere" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toEqual({
      apps: [{
        id: "panoma-video", name: "panoma video", version: "0.9.0", latestVersion: "0.9.1", enabled: true, ready: false,
        requirements: [{ id: "browser", present: false }, { id: "ffmpeg", present: true, version: "9.0.1" }],
        providers: { brain: "none", voice: false }, next: "browser",
      }],
    });
    expect(JSON.stringify(body)).not.toContain("/opt/homebrew");
  });

  it("refuses a body that is not empty or a location, and a catalog on another machine", async () => {
    expect((await POST(call({ id: "panoma-video" }))).status).toBe(400);
    expect((await POST(call([]))).status).toBe(400);
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    const response = await POST(call({}));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "local-catalog-required" });
  });
});
