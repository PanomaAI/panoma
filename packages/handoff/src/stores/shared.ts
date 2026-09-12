/**
 * What every store module needs: the resolved options, the path module for the platform, and
 * the guard that keeps a test away from the real stores under `~`.
 *
 * Under test, `home` and `env` are mandatory. The failure this prevents already has a shape: a
 * forgotten default on a developer machine reads — and with `handoff()` writes — the person's
 * own transcripts. The guard throws before any path is even built.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { HandoffFault } from "../faults";
import type { StoreOptions } from "../types";

export interface ResolvedStoreOptions {
  home: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  /** `path.win32` or `path.posix`, so the Windows branch runs on any machine. */
  path: typeof posix;
}

export const TEST_GUARD_DETAIL = "tests must pass home and env";

export function resolveStoreOptions(options: StoreOptions = {}): ResolvedStoreOptions {
  if (process.env.NODE_ENV === "test" && (options.home === undefined || options.env === undefined)) {
    throw new HandoffFault("store-missing", TEST_GUARD_DETAIL);
  }
  const platform = options.platform ?? process.platform;
  return {
    home: options.home ?? homedir(),
    env: options.env ?? process.env,
    platform,
    path: platform === "win32" ? win32 : posix,
  };
}

/** A variable with something inside, or nothing: an empty value is an absent value. */
export function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function exists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

/** The path module of the machine this runs on. */
export function nativePath(): typeof posix {
  return process.platform === "win32" ? win32 : posix;
}

/** A directory is absolute on the platform it names, not on the one running the check. */
export function isAbsoluteOn(path: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" ? win32.isAbsolute(path) : posix.isAbsolute(path);
}
