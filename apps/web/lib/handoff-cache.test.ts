import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  Thirty seconds, one listing: the cache in front of discovery, with the clock injected.
 */
const discoverMock = vi.fn();
vi.mock("@panoma/handoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@panoma/handoff")>()),
  discoverConversations: (...args: unknown[]) => discoverMock(...args),
}));

const { discoverCached, forgetDiscovery, storeOptions } = await import("./handoff-cache");

const global = globalThis as unknown as { __panomaHandoffStores?: unknown };
const EMPTY = { conversations: [], stores: [] };

let clock = 1_000_000;
const now = () => clock;

beforeEach(() => {
  forgetDiscovery();
  clock = 1_000_000;
  discoverMock.mockReset().mockResolvedValue(EMPTY);
  delete global.__panomaHandoffStores;
});

afterEach(() => {
  delete global.__panomaHandoffStores;
});

describe("the discovery cache", () => {
  it("lists once and answers from memory for thirty seconds", async () => {
    await discoverCached({ cwds: ["/a"], now });
    clock += 29_999;
    await discoverCached({ cwds: ["/a"], now });
    expect(discoverMock).toHaveBeenCalledTimes(1);
    clock += 1;
    await discoverCached({ cwds: ["/a"], now });
    expect(discoverMock).toHaveBeenCalledTimes(2);
  });

  it("`fresh` lists again and becomes the remembered answer", async () => {
    await discoverCached({ cwds: ["/a"], now });
    await discoverCached({ cwds: ["/a"], fresh: true, now });
    await discoverCached({ cwds: ["/a"], now });
    expect(discoverMock).toHaveBeenCalledTimes(2);
  });

  it("a different set of folders is a different question; their order is not", async () => {
    await discoverCached({ cwds: ["/a", "/b"], now });
    await discoverCached({ cwds: ["/b", "/a", "/a"], now });
    expect(discoverMock).toHaveBeenCalledTimes(1);
    await discoverCached({ cwds: ["/a"], now });
    expect(discoverMock).toHaveBeenCalledTimes(2);
  });

  it("a folder's question is its own entry beside the disk-wide one, and neither evicts the other", async () => {
    await discoverCached({ cwds: ["/a"], now });
    await discoverCached({ cwds: ["/a"], cwd: "/a/p", now });
    expect(discoverMock).toHaveBeenCalledTimes(2);
    expect(discoverMock).toHaveBeenLastCalledWith({ cwds: ["/a"], cwd: "/a/p" });
    // The list, then the handoff: one listing for the two calls the agent makes in a row.
    await discoverCached({ cwds: ["/a"], cwd: "/a/p", now });
    await discoverCached({ cwds: ["/a"], now });
    expect(discoverMock).toHaveBeenCalledTimes(2);
    // Another folder is another question; the first folder's answer is still there.
    await discoverCached({ cwds: ["/a"], cwd: "/a/q", now });
    await discoverCached({ cwds: ["/a"], cwd: "/a/p", now });
    expect(discoverMock).toHaveBeenCalledTimes(3);
    // Past the thirty seconds every entry goes, not only the one asked for.
    clock += 30_000;
    await discoverCached({ cwds: ["/a"], cwd: "/a/p", now });
    expect(discoverMock).toHaveBeenCalledTimes(4);
    await discoverCached({ cwds: ["/a"], cwd: "/a/q", now });
    await discoverCached({ cwds: ["/a"], now });
    expect(discoverMock).toHaveBeenCalledTimes(6);
  });

  it("forgets on demand, which is what a write does, whichever question was asked", async () => {
    await discoverCached({ cwds: ["/a"], now });
    await discoverCached({ cwds: ["/a"], cwd: "/a/p", now });
    forgetDiscovery();
    await discoverCached({ cwds: ["/a"], now });
    await discoverCached({ cwds: ["/a"], cwd: "/a/p", now });
    expect(discoverMock).toHaveBeenCalledTimes(4);
  });

  it("does not remember a failure", async () => {
    discoverMock.mockRejectedValueOnce(new Error("store-missing"));
    await expect(discoverCached({ cwds: ["/a"], now })).rejects.toThrow("store-missing");
    await discoverCached({ cwds: ["/a"], now });
    expect(discoverMock).toHaveBeenCalledTimes(2);
  });

  it("passes the folders on to discovery, with the stores a test injected", async () => {
    global.__panomaHandoffStores = { home: "/tmp/agents", env: { CODEX_HOME: "/tmp/codex" } };
    expect(storeOptions()).toEqual({ home: "/tmp/agents", env: { CODEX_HOME: "/tmp/codex" } });
    await discoverCached({ cwds: ["/a"], now });
    expect(discoverMock).toHaveBeenCalledWith({ home: "/tmp/agents", env: { CODEX_HOME: "/tmp/codex" }, cwds: ["/a"] });
    delete global.__panomaHandoffStores;
    expect(storeOptions()).toEqual({});
  });
});
