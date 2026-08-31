import { copyFile, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { panomaPath } from "@panoma/core";
import { findProvider, type Provider } from "./providers";
import { expired, refresh, type OauthToken } from "./oauth";
import { checkBaseUrl } from "./safety";
import { restrictToOwner } from "@panoma/core";
import { AiError } from "./failures";

/**
 * Where the AI configuration lives and in what order the credentials are resolved.
 *
 * The order —environment first, file second— is the convention of the tools in this family, and it
 * is not arbitrary: it allows the same installation to work on a development machine
 * (where one already has `ANTHROPIC_API_KEY` exported) and on a server or in CI (where the
 * keys arrive as injected environment variables) without touching any file.
 *
 * The file is written with 0600 permissions. It's the minimum, and still it's worth saying out
 * loud what it is not: **a key in a text file on your disk is not encrypted.** Any process running
 * under your user can read it — exactly the same hole we measured with the `local` isolation of
 * the executions. Encrypting it against the system keychain is pending work, not something that
 * has already been done.
 *
 * This is the only file of Panoma that stores something that cannot be deduced again from the
 * disk. Everything else—the catalog, the worktrees—is regenerated with a scan; a lost API key has
 * to be retrieved from the provider's panel, and several of them are only shown once. That is why
 * it is written the way it is: temporary, `fsync`, `rename`.
 */

export function configPath(): string {
  return panomaPath("ai.json");
}

/**
 * The copy of the latest version that could be read entirely.
 *
 * It is not a history or a real backup: it is exactly a version of distance, enough so that a cut
 * in the middle of writing does not leave anyone without keys.
 */
function backupPath(): string {
  return `${configPath()}.anterior`;
}

export interface AiConfig {
  /** Proveedor activo. */
  provider?: string;
  /** Model, if one wants one different from the provider's default. */
  model?: string;
  /** Keys by provider. Only those that the user has saved here. */
  keys?: Record<string, string>;
  /**
   * Provider tokens with login.
   *
   * They go in the same file as the keys and with the same care —0600, atomic write, lock— because
   * they are exactly equally sensitive: an access token is a key with an expiration date. And
   * that's why `forget` has to delete from both places.
   */
  tokens?: Record<string, OauthToken>;
}

/**
 * The file exists but it is not understood.
 *
 * It is thrown instead of returning `{}` because 'there is no configuration' and 'I cannot read
 * the configuration' lead to opposite actions. Confusing them was a quiet way to lose everything:
 * `panoma ai key` read `{}`, saved a single key on top, and the other four ceased to exist without
 * anyone seeing an error along the way.
 */
export class ConfigCorruptError extends Error {
  constructor(
    readonly path: string,
    problem: Error,
    readonly recovery?: { path: string; keys: number },
  ) {
    const lines = [`Could not read the AI configuration at ${path}: ${problem.message}`];
    if (recovery) {
      lines.push(
        /*
          Both forms written whole rather than an `s` glued to the figure. The house rule: never
          attach an inflected word to a digit, and this line only ever reads wrong at one.
         */
        recovery.keys === 1
          ? `There is an earlier copy at ${recovery.path} holding one key. Recover it with:`
          : `There is an earlier copy at ${recovery.path} holding ${recovery.keys} keys. Recover it with:`,
        `  mv ${recovery.path} ${path}`,
        "Do not run 'panoma ai key' first: it would overwrite the file and whatever is left in it.",
      );
    } else {
      lines.push(
        "There is no earlier copy. Open it and fix it by hand, or delete it to start over —",
        "you will lose whatever keys were saved inside.",
      );
    }
    super(lines.join("\n"), { cause: problem });
    this.name = "ConfigCorruptError";
  }
}

/**
 * Check the form, not just that it is a valid JSON.
 *
 * `null`, `[]` and `42` are JSON perfectly valid and none is a configuration. Without this, a
 * `null` would pass the `JSON.parse` and break later in the first `.keys`, with a message that did
 * not point to the file.
 */
function isConfig(value: unknown): value is AiConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record["provider"] !== undefined && typeof record["provider"] !== "string") return false;
  if (record["model"] !== undefined && typeof record["model"] !== "string") return false;
  const keys = record["keys"];
  if (keys !== undefined) {
    if (typeof keys !== "object" || keys === null || Array.isArray(keys)) return false;
    if (Object.values(keys).some((key) => typeof key !== "string")) return false;
  }
  const tokens = record["tokens"];
  if (tokens !== undefined) {
    if (typeof tokens !== "object" || tokens === null || Array.isArray(tokens)) return false;
    // The minimum that makes a token a token: without `access` it is useless, and accepting it here
    // only delays the failure until the first request, with a worse message.
    if (
      Object.values(tokens).some(
        (token) =>
          typeof token !== "object" ||
          token === null ||
          typeof (token as { access?: unknown }).access !== "string",
      )
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Read and validate a file. `undefined` if it does not exist; throw if it exists and is not
 * understood.
 */
async function readFileConfig(path: string): Promise<AiConfig | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isConfig(parsed)) {
    throw new AiError({ code: "configShape" });
  }
  return parsed;
}

export async function readConfig(): Promise<AiConfig> {
  const path = configPath();
  try {
    return (await readFileConfig(path)) ?? {};
  } catch (error) {
    // The file is there and it doesn't make sense. Before giving the warning, see if the previous
    // copy works: that turns 'I lost the keys' into 'run this command'.
    const recovered = await readFileConfig(backupPath()).catch(() => undefined);
    throw new ConfigCorruptError(
      path,
      error as Error,
      recovered
        ? { path: backupPath(), keys: Object.keys(recovered.keys ?? {}).length }
        : undefined,
    );
  }
}

/**
 * Write the configuration without being able to leave it halfway.
 *
 * `writeFile` on the destination truncates the file before writing the new content: if the process
 * dies between those two things — a Ctrl-C, a battery, an OOM — what remains on the disk is a
 * `ai.json` of zero bytes or cut in half, and inside were all the keys. The time sequence →
 * `fsync` → `rename` does not have that gap: `rename` on the same filesystem is atomic, so any
 * reader sees either the entire previous file or the entire subsequent file, never a half.
 *
 * The `fsync` before the `rename` is the part that is forgotten: without it, the rename can reach
 * the disk before the data and a power outage leaves the good name pointing to an empty file.
 * Exactly the failure that was being tried to avoid, with one more step in between.
 */
export async function writeConfig(config: AiConfig): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });

  // The copy is made from what exists *before* touching anything, and only if it can be read
  // entirely: backing up a corrupted file over a good one would be losing the only network left.
  const current = await readFileConfig(path).catch(() => undefined);
  if (current) {
    // The backup uses the same keys as the original, so it is protected the same way: a `chmod`
    // here left the copy wide open in Windows.
    await copyFile(path, backupPath())
      .then(() => restrictToOwner(backupPath()))
      .catch(() => {});
  }

  const temporary = `${path}.${process.pid}.tmp`;
  const body = `${JSON.stringify(config, null, 2)}\n`;
  try {
    // The mode is set during creation and not afterward: between a `writeFile` and a `chmod` there
    // is a moment with the key inside and permissions 0644.
    const handle = await open(temporary, "w", 0o600);
    try {
      await handle.writeFile(body, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }

  /*
    `rename` preserves the temporary mode, so on macOS and Linux this doesn't change anything: it
    is in case the file was ever created by another means with more open permissions.
    In Windows it does change, and a lot. There the `mode: 0o600` of the creation means
    nothing—permissions are access control lists, not a number—and the file inherits those of its
    folder. This breaks the inheritance and leaves a single entry: that of the owner.
   */
  await restrictToOwner(path);

  // Durability of the rename itself: in most systems the directory entry is also cached. If the
  // system does not allow opening a directory (Windows), it doesn't matter — the content is already
  // on disk due to the `sync` above.
  await open(dirname(path), "r")
    .then(async (dir) => {
      await dir.sync().catch(() => {});
      await dir.close();
    })
    .catch(() => {});

  await sweepTemporaries();
}

/**
 * Remove the temporary files left by a process that no longer exists.
 *
 * A SIGKILL between `open` and `rename` does not execute any `catch`, so the temporary file
 * remains. Killing the writer forty times, sixteen left one. It is not a data loss—the good
 * `ai.json` remains intact—but each remnant is a complete copy of your keys in a file that no one
 * remembers, accumulating forever.
 *
 * The pid goes in the name exactly for this: a temporary file is only deleted if its process is no
 * longer running. Sweeping by age would delete the temporary file of a `panoma ai key` that is
 * currently being written to in another terminal.
 */
async function sweepTemporaries(): Promise<void> {
  const directory = dirname(configPath());
  const prefix = `${basename(configPath())}.`;
  const files = await readdir(directory).catch(() => [] as string[]);

  for (const file of files) {
    if (!file.startsWith(prefix) || !file.endsWith(".tmp")) continue;
    const pid = Number.parseInt(file.slice(prefix.length, -".tmp".length), 10);
    if (!Number.isInteger(pid)) continue;
    if (pid !== process.pid && isRunning(pid)) continue;
    await rm(join(directory, file), { force: true }).catch(() => {});
  }
}

/** Signal 0 is not sent: it only checks that the process exists and is accessible. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Execute a modification of the configuration exclusively.
 *
 * Reading, modifying in memory, and writing is not atomic even though the writing itself is: two
 * `panoma ai key` at the same time read the same state and the second saves over the first, so one
 * of the two keys disappears without any error. The lock is a file created with `wx`, which fails
 * if it already exists — the check and creation happen inside the file system and cannot be
 * interposed.
 */
async function withLock<T>(action: () => Promise<T>): Promise<T> {
  const lock = `${configPath()}.lock`;
  await mkdir(dirname(lock), { recursive: true });

  const deadline = Date.now() + 3000;
  for (;;) {
    try {
      const handle = await open(lock, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`, "utf8").catch(() => {});
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() > deadline) {
        const owner = await readFile(lock, "utf8").catch(() => "");
        throw new AiError({
          code: "configLocked",
          lock,
          holder: owner.trim() ? `pid ${owner.trim()}` : undefined,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  try {
    return await action();
  } finally {
    await rm(lock, { force: true }).catch(() => {});
  }
}

export interface ResolvedCredential {
  provider: Provider;
  model: string;
  /** Absent in the suppliers `cli`: there is nothing to save there. */
  apiKey?: string;
  baseUrl?: string;
  /** To which account is it charged, in suppliers with login. */
  accountId?: string;
  /** Where the key came from. The user is taught; the value never. */
  source: "env" | "file" | "agent-session" | "login";
}

/** Why it could not be resolved, in a message that says what to do next. */
export class NoCredentialError extends Error {
  constructor(readonly provider: Provider) {
    const how =
      provider.auth === "cli"
        ? `Install ${provider.name} and sign in; panoma will call '${provider.command}'.`
        : provider.auth === "oauth"
          ? `Sign in to ${provider.name} from the model page in panoma.`
          : `Run 'panoma ai key ${provider.id}' or export ${provider.apiKeyEnvVars?.[0]}. ` +
            `The key comes from ${provider.signupUrl}.`;
    /*
      English here as everywhere else this package throws: the terminal prints it raw. The browser
      never reads this sentence — `model-errors.ts` rebuilds the whole remedy from `provider`,
      which is why this class carries it.
     */
    super(`No credential for ${provider.name}. ${how}`);
    this.name = "NoCredentialError";
  }
}

export async function resolveCredential(
  providerId?: string,
  config?: AiConfig,
): Promise<ResolvedCredential> {
  const settings = config ?? (await readConfig());
  const id = providerId ?? settings.provider;
  if (!id) {
    throw new AiError({ code: "noProvider" });
  }

  const provider = findProvider(id);
  if (!provider) throw new AiError({ code: "unknownProvider", id });

  if (provider.auth === "cli") {
    return { provider, model: settings.model ?? "", source: "agent-session" };
  }

  if (provider.auth === "oauth") {
    const savedValue = settings.tokens?.[provider.id];
    if (!savedValue) throw new NoCredentialError(provider);

    /*
      It refreshes here and not at the moment of failing.
      A token like this lasts for hours, so half the times that Panoma needs it, it has already
      expired. Reacting to the 401 would mean that the first request of each session fails and has
      to be retried; checking the date with a margin costs nothing and makes sure none fail. If
      there is no refresh token, nothing can be done: you have to log in again, and the message
      says so.
     */
    let token = savedValue;
    if (expired(token)) {
      if (!token.refresh) throw new NoCredentialError(provider);
      token = await refresh(provider, token.refresh);
      await saveToken(provider.id, token);
    }

    return {
      provider,
      model: settings.model ?? provider.defaultModel ?? "",
      apiKey: token.access,
      baseUrl: resolveBaseUrl(provider),
      ...(token.accountId ? { accountId: token.accountId } : {}),
      source: "login",
    };
  }

  // Environment before file: an exported key is a more recent and more deliberate decision than one
  // saved months ago, and it is what makes CI work without touching anything.
  for (const variable of provider.apiKeyEnvVars ?? []) {
    const value = process.env[variable];
    if (value) {
      return {
        provider,
        model: settings.model ?? provider.defaultModel ?? "",
        apiKey: value,
        baseUrl: resolveBaseUrl(provider),
        source: "env",
      };
    }
  }

  const stored = settings.keys?.[provider.id];
  if (stored) {
    return {
      provider,
      model: settings.model ?? provider.defaultModel ?? "",
      apiKey: stored,
      baseUrl: resolveBaseUrl(provider),
      source: "file",
    };
  }

  throw new NoCredentialError(provider);
}

function resolveBaseUrl(provider: Provider): string | undefined {
  const override = provider.baseUrlEnvVar ? process.env[provider.baseUrlEnvVar] : undefined;
  const chosenOne = override || provider.baseUrl;
  // Here and not in every call: this is the only place through which a credential passes on the way
  // to an address, so checking it here is checking it in all. See `seguridad.ts`.
  return chosenOne ? checkBaseUrl(provider, chosenOne) : undefined;
}

/** Save a key without overriding the rest of the configuration. */
export async function saveKey(providerId: string, apiKey: string): Promise<void> {
  await withLock(async () => {
    const config = await readConfig();
    config.keys = { ...config.keys, [providerId]: apiKey };
    config.provider ??= providerId;
    await writeConfig(config);
  });
}

/** The same for a session token. Same lock: it is written in the same file. */
export async function saveToken(providerId: string, token: OauthToken): Promise<void> {
  await withLock(async () => {
    const config = await readConfig();
    config.tokens = { ...config.tokens, [providerId]: token };
    config.provider ??= providerId;
    await writeConfig(config);
  });
}

/**
 * Delete whatever there is from a provider: key, token, or both.
 *
 * In one place and not in each caller because forgetting one of the two halves is the silent way
 * for 'forgetting' to leave the session open.
 */
export async function forgetCredential(providerId: string): Promise<void> {
  await updateConfig((config) => {
    const keys = { ...config.keys };
    const tokens = { ...config.tokens };
    delete keys[providerId];
    delete tokens[providerId];
    return { ...config, keys, tokens };
  });
}

/**
 * Apply a change to the current configuration, exclusively.
 *
 * For everything that involves read-modify-write. `writeConfig` alone is fine when you already
 * have the whole object and want to put it exactly as it is.
 */
export async function updateConfig(
  change: (current: AiConfig) => AiConfig | Promise<AiConfig>,
): Promise<AiConfig> {
  return withLock(async () => {
    const next = await change(await readConfig());
    await writeConfig(next);
    return next;
  });
}

/**
 * To teach a key without teaching it.
 *
 * A `sk-ant-***` by itself does not allow you to check *which* of the three keys one has is
 * configured; the last four characters do, and they don't bring anyone closer to guessing the
 * rest.
 */
export function maskKey(apiKey: string): string {
  return apiKey.length <= 8 ? "••••" : `${apiKey.slice(0, 3)}…${apiKey.slice(-4)}`;
}
