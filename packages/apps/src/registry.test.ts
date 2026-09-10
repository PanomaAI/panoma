import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRegistryClient, NPM_REGISTRY, REGISTRY_TTL_MS } from "./registry";

let home: string;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "panoma-app-registry-")); vi.stubEnv("PANOMA_HOME", home); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }); });

it("asks only npm with plain JSON and remembers both success and failure for a day", async () => {
  let now = Date.parse("2026-09-08T12:00:00Z");
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ name: "@panoma/video", version: "0.2.0" })));
  const registry = createRegistryClient({ origin: NPM_REGISTRY, fetch: request, now: () => now });
  const initial = await registry.latest("@panoma/video");
  expect(initial.version).toBe("0.2.0");
  expect(request.mock.calls[0]?.[0]).toBe("https://registry.npmjs.org/%40panoma%2Fvideo/latest");
  expect(request.mock.calls[0]?.[1]?.headers).toEqual({ accept: "application/json" });
  await registry.latest("@panoma/video");
  expect(request).toHaveBeenCalledTimes(1);
  now += REGISTRY_TTL_MS + 1;
  request.mockRejectedValue(new Error("offline"));
  const cached = await registry.latest("@panoma/video");
  expect(cached).toMatchObject({ version: "0.2.0", fetchedAt: initial.fetchedAt, stale: true });
  await registry.latest("@panoma/video");
  expect(request).toHaveBeenCalledTimes(2);
});

it("respects the update switch but permits an explicit install lookup, and rejects nonofficial names", async () => {
  vi.stubEnv("PANOMA_NO_UPDATE_CHECK", "1");
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ name: "@panoma/video", version: "0.2.0" })));
  const registry = createRegistryClient({ origin: NPM_REGISTRY, fetch: request });
  expect((await registry.latest("@panoma/video")).disabled).toBe(true);
  expect(request).not.toHaveBeenCalled();
  await registry.latest("@panoma/video", { explicit: true });
  expect(request).toHaveBeenCalledTimes(1);
  await expect(registry.latest("another-package")).rejects.toThrow("unknown-app");
});

it("bounds response bytes and rejects mismatched package names and invalid versions", async () => {
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("x".repeat(65_537)))
    .mockResolvedValueOnce(new Response(JSON.stringify({ name: "another-package", version: "1.2.3" })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ name: "@panoma/video", version: "../../escape" })));
  const registry = createRegistryClient({ origin: NPM_REGISTRY, fetch: request });
  for (let at = 0; at < 3; at += 1) expect((await registry.latest("@panoma/video", { force: true })).version).toBeUndefined();
});
