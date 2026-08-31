import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { panomaPath } from "./home";
import { restrictToOwner } from "./restrict";

/**
 * The credential you need to get to Panoma from outside this machine.
 *
 * Panoma runs on your computer and does real things on it: it opens folders, installs
 * dependencies, runs tests, reads the files that git tracks in eighty repositories. With the port
 * bound to the local loop that is safe because no one else can call it. As soon as it is opened to
 * the network it ceases to be safe: it was checked from the home wifi that `POST /api/secrets`
 * returned 55 credentials found, with file and line, to whoever requested it.
 *
 * Hence the rule that governs this file: **exposing Panoma requires two things at once, address
 * and credential, and never just the address.** Opening the port without a key is not an option
 * that can be chosen by oversight; it is a state that the server refuses to serve.
 *
 * The key lives in `~/.panoma/access.json` with 0600 permissions and is generated once. It does
 * not expire on purpose: a key that expires on its own turns 'logging in from the mobile' into a
 * weekly procedure, and the procedure ends with someone leaving the port open without a key to
 * avoid repeating it. It can be rotated when necessary, which is what matters.
 *
 * ## Two keys, and why one is not enough
 *
 * `key` opens the catalog from the network: it is the one that travels within the link that opens
 * on the mobile. `operator` authorizes what gives orders to **this** machine —install, build, open
 * an editor, launch a proposal— and **does not** travel in that link.
 *
 * The difference is the one that separates looking from commanding, and until 25-Aug-2026 it did
 * not exist. Those routes were defended by looking at header `Host`, which is written by whoever
 * calls, so a `Host: localhost` was enough to order a compilation from the wifi. With a single key
 * the arrangement was impossible: the mobile and the computer brought exactly the same, and
 * through HTTP there is no way to distinguish the local loop from whoever claims to be it.
 *
 * With two yeses, because `operator` cannot be accessed from outside. It is only in two places,
 * and both require being on the machine: this file with 0600 permissions —from where CLI reads it—
 * and the link "this machine" that `panoma up --network` prints on the terminal. Whoever reads
 * that terminal is already in front of the keyboard.
 *
 * So the mobile link can be leaked —through a screenshot, through the clipboard, through a proxy
 * log— and whoever has it will see the catalog, which is what was agreed upon when opening the
 * port; but they will not be able to make this machine run anything.
 */

/** 32 bytes in hexadecimal. Enough so that guessing it is not a strategy. */
const BYTES = 32;

export interface AccessKey {
  /** Open the catalog from the network. Travel on the mobile link. */
  key: string;
  /** Authorize what is executed on this machine. It does not travel over the mobile link. */
  operator: string;
  createdAt: string;
}

function file(): string {
  return panomaPath("access.json");
}

/**
 * The saved keys, or `null` if none were ever created.
 *
 * `operator` may be missing and it is not a corrupted file: it is a `access.json` written before
 * the second key existed. It is returned empty and `ensureAccessKey` fills it without touching
 * `key`, so that the phone that already had a link continues to access.
 */
export async function readAccessKey(): Promise<AccessKey | null> {
  try {
    const raw = JSON.parse(await readFile(file(), "utf8")) as Partial<AccessKey>;
    return typeof raw.key === "string" && raw.key.length >= 32
      ? {
          key: raw.key,
          operator: typeof raw.operator === "string" && raw.operator.length >= 32 ? raw.operator : "",
          createdAt: raw.createdAt ?? "",
        }
      : null;
  } catch {
    // Without a file, illegible or half-written: there is no key. Whoever asks creates it.
    return null;
  }
}

/**
 * Returns the key, creating it if it does not exist.
 *
 * `rotate` forces a new one and **invalidates the previous one**: the phone that had it stops
 * accessing it, which is exactly what is wanted on the day it is shared where it shouldn’t have
 * been.
 */
export async function ensureAccessKey(options: { rotate?: boolean } = {}): Promise<AccessKey> {
  if (!options.rotate) {
    const existing = await readAccessKey();
    /*
      A `access.json` from before the operator key is not rotated entirely: the missing part is
      added. Rotating `key` in the process would leave out the phone that already had its link,
      and for a reason that is not its own — updating Panoma should not expel anyone.
     */
    if (existing?.operator) return existing;
    if (existing) {
      return write({ ...existing, operator: randomBytes(BYTES).toString("hex") });
    }
  }

  return write({
    key: randomBytes(BYTES).toString("hex"),
    operator: randomBytes(BYTES).toString("hex"),
    createdAt: new Date().toISOString(),
  });
}

/** Leave the file on disk, whole and only for its owner. */
async function write(fresh: AccessKey): Promise<AccessKey> {
  const target = file();
  await mkdir(dirname(target), { recursive: true });
  /*
    Atomic writing and 0600, like `ai.json`.
    The mode matters more here than in any other file of Panoma: whoever can read it enters the
    catalog from anywhere on the network. And the temporary one has pid and randomness because two
    processes writing the same `.tmp` overwrite each other — it happened with `visit.json` and it
    threw the entire cover.
   */
  const temporary = `${target}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(fresh, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
  // The `mode` above protects nothing in Windows, where permissions are not a number.
  await restrictToOwner(target);
  return fresh;
}

/**
 * Addresses that are 'this machine' and do not require credentials.
 *
 * They are compared against header `Host`, which is the address the client wrote. The three
 * writings of the local loop are the same thing, and `[::1]` comes with brackets because that is
 * how an IPv6 address with a port is written.
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/**
 * Did the request come through the local loop?
 *
 * `0.0.0.0` counts as local on purpose: it is the address to which the server **binds**, not one
 * that anyone really calls, and it appears when something internal requests itself. Whoever comes
 * from the network brings IP from the machine on the LAN or a name, never this.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  // `host` comes as "name:port"; the port doesn't say anything about where it is being called from.
  const name = host.replace(/:\d+$/, "").toLowerCase();
  return LOOPBACK.has(name);
}
