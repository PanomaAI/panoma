/**
 * Client HTTP shared by all records.
 *
 * We are consulting public and free services that no one forces us to keep running, so good
 * manners are part of the design: identifying ourselves, limiting attendance, setting a maximum
 * time, and retrying only when it makes sense.
 */

/*
  Without accents, and not by carelessness.
  A header HTTP is ASCII. The `á` of "catalog" caused crates.io to respond
  `400 invalid HTTP header (user-agent)` to **all** Rust package queries, always and silently: the
  failure was counted as "we will retry" and the Rust projects in the catalog ended up without a
  known version without anyone seeing an error. The other registries tolerate it, which is exactly
  what makes it so hard to see.
 */
export const USER_AGENT = "panoma/0.1 (catalogo de proyectos; +https://panoma.ai)";

const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

/**
 * How much of an answer is accepted to read.
 *
 * Without limits, `response.json()` swallows whatever is sent to it: a compromised record, a
 * misconfigured company proxy, or a simple lying `Content-Length` is enough for Panoma to run out
 * of memory while checking if `left-pad` has a new version. And bad faith isn't necessary: **the
 * complete `typescript` document on npm weighs 15 MB** and that of `@types/node` almost 11,
 * measured today.
 *
 * The limit is checked **in two ways** because one alone is not enough: `Content-Length` arrives
 * before downloading anything and saves the work, but it is a data point provided by the server
 * and it may be missing or false — in a chunked response it doesn't even appear. That’s why the
 * incoming data is also counted and cut off as soon as it passes the limit. It is the pattern that
 * veteran tools ended up adopting through repeated reviews, one by one.
 */
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

export class ResponseTooLargeError extends Error {
  constructor(url: string, maxBytes: number) {
    super(`La respuesta de ${url} pasa de ${Math.round(maxBytes / 1024)} KB y se ha cortado.`);
    this.name = "ResponseTooLargeError";
  }
}

/** Read the body counting bytes, and abort as soon as it goes over. */
async function readBounded(response: Response, url: string, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    // Canceling here prevents downloading what we already know we are going to throw away.
    await response.body?.cancel().catch(() => {});
    throw new ResponseTooLargeError(url, maxBytes);
  }

  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ResponseTooLargeError(url, maxBytes);
    }
    chunks.push(value);
  }

  return new TextDecoder().decode(concat(chunks, total));
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The resource does not exist. It is not a failure: the package may be private or renamed. */
export const NOT_FOUND = Symbol("not-found");

/**
 * Can this name be entered into a URL registration?
 *
 * The names come from manifests, which could have been written by anyone, and two of the seven
 * clients interpolate them without encoding—packagist and the Go proxy—because their names contain
 * slashes and `encodeURIComponent` would break them. The host cannot be changed from there, so
 * **this is not an SSRF**; what can be done is to move through the registry itself: measured, a
 * `composer.json` called `a/../../evil` ends up requesting `/evil.json`, and one with `#` behind
 * it cuts the path early. In both cases, Panoma would bring the data of another package and show
 * it as if it were from this one—including its vulnerabilities, or the absence thereof.
 *
 * The check is a list of what cannot appear, and not one of valid forms by ecosystem: the seven
 * have different rules and a list of allowed items that is too narrow would leave legitimate
 * packages unresolved, which is a silent failure and worse.
 */
export function isSafeRegistryName(name: string): boolean {
  if (!name || name.length > 214) return false;
  if (name.startsWith("/") || name.startsWith(".")) return false;
  // `..` navigates, `?` opens the query, `#` cuts the path, `\` and spaces are garbage, and control
  // characters have no place in a package name.
  return !/(\.\.|[?#\\\s]|[\x00-\x1f\x7f])/.test(name);
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit & { maxBytes?: number } = {},
): Promise<T | typeof NOT_FOUND> {
  const maxBytes = init.maxBytes ?? DEFAULT_MAX_BYTES;
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential wait with some margin: 400 ms, 1200 ms.
      await sleep(400 * 3 ** (attempt - 1));
    }

    try {
      const response = await fetch(url, {
        ...init,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...init.headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.status === 404 || response.status === 410) return NOT_FOUND;

      // 4xx (except 429) is our fault: retrying won't fix it.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new HttpError(response.status, `${response.status} en ${url}`);
      }

      if (!response.ok) {
        lastError = new HttpError(response.status, `${response.status} en ${url}`);
        continue;
      }

      return JSON.parse(await readBounded(response, url, maxBytes)) as T;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // Oversizing doesn't get fixed by retrying: the response is going to come back just as big,
      // and each attempt costs the entire download again.
      if (error instanceof ResponseTooLargeError) throw error;
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Falló la petición a ${url}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes tasks with a concurrency limit.
 *
 * Without this, 243 packages go out as 243 simultaneous requests and some server —with good
 * reason— starts returning 429.
 */
export async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]!, index);
    }
  });

  await Promise.all(runners);
  return results;
}
