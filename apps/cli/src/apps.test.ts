import { afterEach, describe, expect, it, vi } from "vitest";
import { appsCommand, followAppJob } from "./apps";
import { parseArgs, type Flags } from "./args";
import { videoInput } from "./video";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("./catalog-fetch", () => ({ catalogFetch: fetcher }));
vi.mock("./server", () => ({ unreachable: () => 1 }));
afterEach(() => { vi.restoreAllMocks(); fetcher.mockReset(); });
function flags(args: string[]): Flags { return parseArgs(args) as Flags; }
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }

describe("apps CLI", () => {
  it("lists host state and never opens a database", async () => {
    fetcher.mockResolvedValue(response({ apps: [{ id: "panoma-video", status: "installed", version: "0.2.0", ready: true }] }));
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(await appsCommand(flags(["apps"]))).toBe(0);
    expect(output).toHaveBeenCalledWith("panoma-video · ready · 0.2.0\n");
  });
  it.each([["done", 0], ["failed", 1], ["cancelled", 3]])("maps %s to its documented exit code", async (status, code) => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    fetcher.mockResolvedValue(response({ id: "j", status, error: "fixture" }));
    expect(await followAppJob("http://localhost:4173", "j", false)).toBe(code);
  });
  it("rejects missing and unknown video verbs", () => {
    expect(parseArgs(["video"])).toHaveProperty("error");
    expect(parseArgs(["video", "publish"])).toHaveProperty("error");
    expect(parseArgs(["video", "doctor"])).not.toHaveProperty("error");
  });
  it("builds the machine input and preserves strict JSON for scene revisions", () => {
    expect(videoInput(flags(["video", "auto", "shop", "--langs=es", "--format=h", "--until=final"]))).toEqual({ goal: "promo", until: "final", langs: ["es"], format: "h" });
    expect(videoInput(flags(["video", "review", "shop", "cut"]))).toEqual({ render_id: "cut" });
    expect(() => videoInput(flags(["video", "revise", "shop", "--input=[]"]))).toThrow("JSON object");
  });
});
