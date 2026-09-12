import { discoverConversations, type Discovery, type StoreOptions } from "@panoma/handoff";

/*
  The discovery of conversations, remembered for thirty seconds.

  Listing what the four agents kept on this disk is a `stat` over every candidate file and a read
  of the newest forty per store, and it is asked from three places at once when the screen
  opens: the list itself, the panel, and every project card in the `retomar` view. Thirty
  seconds is long enough that one visit costs one listing and short enough that a conversation
  that just ended shows up before the person has finished reading the page; the refresh button
  and the panel pass `fresh` and skip it. The entries live on `globalThis` for the same reason
  `db()` does: hot reload in Next re-evaluates modules and would otherwise start every module
  with an empty cache.

  ── One question per entry: the whole disk, or one folder ─────────────────────────────────────
  The agent channel asks for one project's conversations, and since 12-Sep-2026 it asks
  discovery with that folder as `cwd`, so the folder is chosen before the cap of forty per
  store; until then it filtered the disk-wide answer, and a project whose files were not among
  the newest forty of a store was answered as having none. A folder's answer is remembered
  under its own key, beside the disk-wide one, for the same thirty seconds: the two tools an
  agent calls in a row —the list, then the handoff— cost one listing, and neither evicts the
  listing the screen paid for. Entries past their time are dropped on the next call, so a
  catalog asked project by project does not keep every folder's answer around.

  ── Where the stores are, and why a test can move them ─────────────────────────────────────────
  In production the engine reads the machine's home and `process.env`; under `NODE_ENV=test` it
  refuses to guess either, so a forgotten default in a route test can never read — or, with
  `handoff()`, write — the developer's own `~/.claude`. `storeOptions()` is the one place the
  routes take their `{ home, env }` from: empty in production, and whatever a test put on
  `globalThis.__panomaHandoffStores` while it runs.
 */

const TTL_MS = 30_000;

interface Entry {
  at: number;
  value: Promise<Discovery>;
}

const global = globalThis as unknown as {
  panomaHandoffDiscovery?: Map<string, Entry>;
  __panomaHandoffStores?: StoreOptions;
};

/** The `{ home, env }` every store call takes: nothing in production, the test's under test. */
export function storeOptions(): StoreOptions {
  return global.__panomaHandoffStores ?? {};
}

export interface DiscoverCachedInput {
  /** The catalog roots and the server's cwd: folders whose sha256 may be a Gemini project id. */
  cwds: readonly string[];
  /** One folder's conversations, chosen before the cap; absent, the whole disk's newest per store. */
  cwd?: string;
  /** Skip the remembered answer: the refresh button and the panel opening. */
  fresh?: boolean;
  /** Injected by tests. */
  now?: () => number;
}

/**
 * The discovery, from the cache when it is younger than thirty seconds and was asked the same
 * question: the same folders, and the same `cwd` or none. A rejected discovery is not
 * remembered: the next caller gets a real attempt.
 */
export function discoverCached(input: DiscoverCachedInput): Promise<Discovery> {
  const now = input.now ?? Date.now;
  const key = `${[...new Set(input.cwds)].sort().join("\0")}\n${input.cwd ?? ""}`;
  const entries = (global.panomaHandoffDiscovery ??= new Map());
  for (const [asked, entry] of entries) if (now() - entry.at >= TTL_MS) entries.delete(asked);
  const cached = entries.get(key);
  if (!input.fresh && cached) return cached.value;

  const value = discoverConversations({ ...storeOptions(), cwds: input.cwds, ...(input.cwd !== undefined ? { cwd: input.cwd } : {}) }).catch(
    (error: unknown) => {
      if (entries.get(key)?.value === value) entries.delete(key);
      throw error;
    },
  );
  entries.set(key, { at: now(), value });
  return value;
}

/** After a write: the next listing must see the new file, whichever question it answers. */
export function forgetDiscovery(): void {
  global.panomaHandoffDiscovery = undefined;
}
