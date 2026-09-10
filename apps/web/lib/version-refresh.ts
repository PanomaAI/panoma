import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { panomaPath } from "@panoma/core";
import { runningVersion } from "./version-notice";

/**
 * Ask the npm registry, once a day, whether there is a newer panoma — from the server this time.
 *
 * The terminal has asked this since the beginning and still does. What it cannot do is ask on
 * behalf of somebody who has not opened a terminal in three weeks, which is precisely the person
 * `panoma up` created: the catalog runs for weeks and the answer written the day it started ages
 * with it. That is the whole reason this file exists, and it is also why it lives **apart from
 * `version-notice.ts`** — the half the screen waits on reads three local files and its test proves
 * it contains no `fetch`. Nothing on the path of a request goes out to the network; this is fired
 * and forgotten, and the answer lands one navigation later.
 *
 * **It is not telemetry, and the line is not a matter of degree.** The question goes to
 * registry.npmjs.org and never to a server of panoma's: ours would turn its logs into a counter of
 * active users and "panoma has no server to send anything to" would stop being true. The argument
 * is written in full in `apps/cli/src/version-check.ts` and in `docs/doctrine.md`, and this second
 * caller changed nothing about it — the host, the two-second ceiling, the daily memory and the off
 * switch are the same ones. What travels is the name of a public package, which is the same thing
 * the same process already sends to seven registries every twelve hours when it refreshes
 * versions and advisories.
 *
 * The two halves share **one clock**, `~/.panoma/version.json`: if you ran a command an hour ago,
 * this does not ask again, and if this asked an hour ago, your next command does not either.
 */

/** The same day the terminal waits, and the same ceiling. Two clocks would be two rules. */
const EVERY = 24 * 60 * 60 * 1000;
const CEILING_MS = 2_000;

const LATEST = "https://registry.npmjs.org/panoma/latest";

/**
 * Good manners, borrowed from the client the enrichment already uses: we identify ourselves to a
 * free service nobody forces to keep running, and without accents, because a header is ASCII and
 * an `á` once made crates.io answer 400 to every Rust query, silently.
 */
const USER_AGENT = "panoma/0.1 (catalogo de proyectos; +https://panoma.ai)";

/**
 * How much of the answer is read. The document for one version is a few kilobytes.
 *
 * The cap is counted **while the body arrives** and not after it, which is the only way it bounds
 * anything: `Content-Length` is a number the other side chooses, it is absent on a chunked
 * response, and by the time `text()` has resolved the memory is already spent. It is the pattern
 * `packages/enrich/src/http.ts` arrived at for the same reason, in the same house.
 */
const MAX_BYTES = 64 * 1024;

type Memory = { visto: number; ultima?: string };

/**
 * When this process last asked, kept in memory as well as on disk.
 *
 * Next renders a page several times at once and this server lives for weeks, so the disk alone is
 * not enough: a home that cannot be written —a read-only volume, a full disk— would otherwise mean
 * one query per render, for ever. The mark is set **before** asking, which is the ordering the
 * enrichment already uses: a pass that fails costs one skipped window, never a retry per render.
 */
let askedAt = 0;

/** One question at a time, however many renders arrive together. */
let inFlight: Promise<void> | undefined;

function file(): string {
  return panomaPath("version.json");
}

async function read(): Promise<Memory | undefined> {
  try {
    return JSON.parse(await readFile(file(), "utf8")) as Memory;
  } catch {
    return undefined;
  }
}

/**
 * Atomic, because this file now has two writers.
 *
 * The terminal writes it too, and a half-finished write would be read by the other side as "nobody
 * has ever asked". The temporary name carries the pid and a random tail for the reason `visit.ts`
 * records: two concurrent renders writing the same temporary name left one of them renaming a file
 * the other had already moved.
 */
async function save(memory: Memory): Promise<void> {
  const target = file();
  try {
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await writeFile(temp, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
    await rename(temp, target);
  } catch {
    /* At most the answer is not remembered; the in-memory mark still holds the day. */
  }
}

/**
 * The body, counting the bytes as they come and giving up as soon as they pass the cap.
 *
 * Reading it whole and measuring afterwards measures nothing: the allocation has already happened.
 * A body with no `Content-Length` —every chunked answer— would sail straight past the check above.
 */
async function readBounded(response: Response): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }

  const whole = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    whole.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(whole);
}

/** What the registry publishes, or nothing. It never throws and never waits past the ceiling. */
async function askNpm(): Promise<string | undefined> {
  try {
    const response = await fetch(LATEST, {
      signal: AbortSignal.timeout(CEILING_MS),
      /*
        `application/json`, not npm's abbreviated format: that one is defined for a package's full
        packument and the registry answers 406 to it on `/<name>/latest`. The terminal's half sent
        it for months and its failures were invisible, because any non-200 reads here as "no
        answer". The reasoning lives in `apps/cli/src/version-check.ts`, next to the fix.
       */
      headers: { accept: "application/json", "user-agent": USER_AGENT },
    });
    if (!response.ok) return undefined;

    /* Declared too big: cut before downloading what would be thrown away anyway. */
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      await response.body?.cancel().catch(() => {});
      return undefined;
    }

    const body = await readBounded(response);
    if (body === undefined) return undefined;

    const parsed = JSON.parse(body) as { version?: string };
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Refresh the answer if a day has gone by, and say nothing either way.
 *
 * It is called without being awaited, the way the front page wakes the watcher: no screen ever
 * waits on npm, and what it learns is read by the next navigation. Returning a promise anyway is
 * for the tests, which do have to wait for it.
 */
export function refreshLatestIfDue(): Promise<void> {
  if (process.env["PANOMA_NO_UPDATE_CHECK"] === "1") return Promise.resolve();
  inFlight ??= run().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

async function run(): Promise<void> {
  const now = Date.now();
  if (askedAt && now - askedAt < EVERY) return;

  /*
    Nobody asks on behalf of a server that does not know which panoma it is. Under `pnpm dev`, an
    editor panel or a seal left behind by another process there is nothing to compare an answer
    against, so the question would be a request to a free service in exchange for nothing.
   */
  if (!(await runningVersion())) return;

  const memory = await read();
  if (memory && now - memory.visto < EVERY) return;

  /* Marked before asking: a failed pass costs one window, not a retry on every render. */
  askedAt = now;

  const latest = await askNpm();
  if (!latest) return;
  await save({ visto: now, ultima: latest });
}
