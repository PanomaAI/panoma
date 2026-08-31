import { isLoopbackHost, readAccessKey } from "@panoma/core";
import { CLI_LANGUAGE } from "./messages";

/**
 * A call to the catalog, with the terminal's language and the credentials that correspond to it.
 *
 * ## The language
 *
 * The website is bilingual and decides with `localeFrom`, which reads a cookie and, if there isn't
 * one, `accept-language`. The browser always sends that header; `fetch` from Node doesn't send
 * any, so the route is served in the factory language without anyone having chosen it — and the
 * routes that return prose (`error`, `hint`, the distilled taste) answered in a language different
 * from the terminal that requested them.
 *
 * The header was manually placed in six sites and was left out of eighteen, which is what always
 * happens with a header that you have to remember to put. Here goes once, and
 * `catalog-fetch.test.ts` checks that no one calls the catalog on their own again.
 *
 * ## The two credentials, and why one doesn't leave this machine
 *
 * With the port open (`panoma up --network`) the catalog asks for credentials from everyone, and
 * there are two different ones: `key` allows viewing and `operator` allows sending. The difference
 * is fully explained in `packages/core/src/access.ts`.
 *
 * **Both go to this machine's catalog, and they come out of the file.** `~/.panoma/access.json`
 * has permissions 0600, so CLI can read it and the wifi neighbor cannot. Both are needed: without
 * the network one, the middleware responds 401 with the port open —and then `up --network` never
 * manages to start, because its own probing consumes the 401— and without the operator one, the
 * routes that execute something respond 403.
 *
 * **Outside this machine only the network one goes out, and only if it was exported.** The `if` of
 * the local loop is the whole point: if the operator one traveled to a remote catalog, we would be
 * giving another machine permission to command in ours. The network one goes out from
 * `PANOMA_ACCESS_KEY` because it is the one the owner printed to look from outside; without it, a
 * `--api` pointing to another machine runs into a 401 with no visible remedy.
 *
 * **And the surveys show nothing**: that's what `catalogProbe` is for. See their comment.
 *
 * Against the npm registry —`version-check.ts`— none of this is used: there the language doesn't
 * matter and the destination is not the catalog.
 */

/** They are read once: there are twenty-four calls per scan and the file does not change. */
let stored: Promise<{ key: string; operator: string }> | undefined;

function localKeys(): Promise<{ key: string; operator: string }> {
  stored ??= readAccessKey()
    .then((found) => ({ key: found?.key ?? "", operator: found?.operator ?? "" }))
    // Without a file there are no keys, and it is not an error: it is the normal `panoma up`, where
    // none are needed. Whoever needs them will receive a 401 or a 403 that says what to do.
    .catch(() => ({ key: "", operator: "" }));
  return stored;
}

export async function catalogFetch(url: URL | string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Accept-Language", CLI_LANGUAGE);

  const target = typeof url === "string" ? new URL(url) : url;

  if (isLoopbackHost(target.hostname)) {
    const local = await localKeys();
    if (local.operator) headers.set("x-panoma-operator", local.operator);
    if (local.key) headers.set("x-panoma-key", local.key);
  }

  /* What the user exports overrides what is on disk: it is the way to point to another. */
  const access = (process.env["PANOMA_ACCESS_KEY"] ?? "").trim();
  if (access) headers.set("x-panoma-key", access);

  return fetch(url, { ...init, headers });
}

/**
 * To ask who is at a gate **without** showing them the keys.
 *
 * `catalogFetch` sends both keys to anything that responds in the local loop, and that is fine for
 * working —the server is ours— but not for *finding out if it is*. The two probes of CLI exist
 * precisely for that doubt: `isAlive` asks if ours has already started and `strangerOnPort` asks
 * if the port is occupied by a stranger. Sending them the credentials would be giving them to
 * someone we still don't know who they are — and on a shared machine, another account could tie up
 * the port before us and take them without ever being able to read the 0600 file.
 *
 * What remains uncovered, and it is said: after the survey, the work calls do go with the keys.
 * Closing that would require the server to identify itself first, and that is not written. In the
 * normal case —a process of yours occupying the port— the escalation is zero, because that process
 * could already read the file.
 */
export function catalogProbe(url: URL | string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Accept-Language", CLI_LANGUAGE);
  return fetch(url, { ...init, headers });
}
