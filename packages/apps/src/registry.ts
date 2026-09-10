import { join } from "node:path";
import { OFFICIAL } from "./official";
import { appsDir, readJson, writeJsonAtomic } from "./layout";
import { assertVersion } from "./manifest";
import { AppFault } from "./faults";

export const NPM_REGISTRY = "https://registry.npmjs.org";
export const REGISTRY_TTL_MS = 24 * 60 * 60_000;
export interface RegistryVersion {
  version?: string;
  checkedAt?: string;
  fetchedAt?: string;
  stale: boolean;
  disabled: boolean;
}
interface CacheEntry { version?: string; checkedAt: string; fetchedAt?: string }
export interface RegistryOptions { force?: boolean; explicit?: boolean }
export interface RegistryClient {
  latest(pkg: string, options?: RegistryOptions): Promise<RegistryVersion>;
}

/** Internal injection seam: public entry points always use the npm origin below. */
export function createRegistryClient(input: {
  origin: string;
  fetch?: typeof fetch;
  now?: () => number;
}): RegistryClient {
  const ask = input.fetch ?? fetch;
  const now = input.now ?? Date.now;
  const pending = new Map<string, Promise<RegistryVersion>>();
  // Also remember failures when the cache directory cannot be written.
  const memory = new Map<string, CacheEntry>();
  return {
    async latest(pkg, options = {}) {
      if (!OFFICIAL.some((app) => app.pkg === pkg)) throw new AppFault("unknown-app");
      const key = `${appsDir()}:${pkg}`;
      if (pending.has(key)) return pending.get(key)!;
      const work = async (): Promise<RegistryVersion> => {
        const path = join(appsDir(), "registry.json");
        const all = await readJson(path).catch(() => undefined) as Record<string, CacheEntry> | undefined;
        const raw = memory.get(key) ?? all?.[pkg];
        let old: CacheEntry | undefined;
        if (raw && typeof raw.checkedAt === "string" && Number.isFinite(Date.parse(raw.checkedAt))) {
          try {
            if (raw.version) assertVersion(raw.version);
            old = raw;
          } catch { /* An invalid cache is absent, never an install target. */ }
        }
        const disabled = process.env.PANOMA_NO_UPDATE_CHECK === "1" && !options.explicit;
        if (disabled || (!options.force && old && now() - Date.parse(old.checkedAt) < REGISTRY_TTL_MS)) {
          return { ...old, stale: !old?.fetchedAt || old.checkedAt !== old.fetchedAt, disabled };
        }
        const checkedAt = new Date(now()).toISOString();
        let fresh: string | undefined;
        try {
          const response = await ask(`${input.origin}/${encodeURIComponent(pkg)}/latest`, {
            headers: { accept: "application/json" }, signal: AbortSignal.timeout(2_000), redirect: "error",
          });
          if (!response.ok) throw new Error("registry-unavailable");
          const reader = response.body?.getReader();
          if (!reader) throw new Error("registry-empty-response");
          let bytes = 0;
          const chunks: Uint8Array[] = [];
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
              if (bytes > 65_536) throw new Error("registry-response-too-large");
              chunks.push(value);
            }
          } finally { await reader.cancel().catch(() => undefined); }
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { name?: string; version?: string };
          if (body.name !== pkg || typeof body.version !== "string") throw new Error("registry-package-mismatch");
          fresh = assertVersion(body.version);
        } catch { /* A failed refresh preserves the previous version and its successful date. */ }
        const next: CacheEntry = {
          checkedAt, version: fresh ?? old?.version, fetchedAt: fresh ? checkedAt : old?.fetchedAt,
        };
        memory.set(key, next);
        await writeJsonAtomic(path, { ...(all && typeof all === "object" ? all : {}), [pkg]: next }).catch(() => undefined);
        return { ...next, stale: !fresh, disabled: false };
      };
      const promise = work().finally(() => pending.delete(key));
      pending.set(key, promise);
      return promise;
    },
  };
}

const registry = createRegistryClient({ origin: NPM_REGISTRY });
export function registryVersion(pkg: string, options?: RegistryOptions): Promise<RegistryVersion> {
  return registry.latest(pkg, options);
}
export async function latestOnRegistry(pkg: string, options?: RegistryOptions): Promise<string | undefined> {
  return (await registryVersion(pkg, options)).version;
}
