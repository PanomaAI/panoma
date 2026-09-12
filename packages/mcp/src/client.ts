import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readAccessKey } from "@panoma/core";

const run = promisify(execFile);

/**
 * The two keys of the catalog of this machine, if there are any: the network one and the
 * operator's.
 *
 * With `panoma up --network` the catalog requests credentials from **everyone**, including the
 * local loop — because from the outside it’s possible to fake coming from it — and this client
 * only sent its `Authorization: Bearer` with the agent key, which is a different thing. The
 * middleware would remove the `Bearer`, compare it against the network key, it didn’t match, and
 * returned 401 before `requireAgent` could even exist: opening the port to look at the catalog
 * from a mobile device would disconnect all agents on the same machine. That is `x-panoma-key`.
 *
 * `x-panoma-operator` is the second one, and it opens a different door. The network key lets you
 * look; the operator key lets you order this machine to do something, and it never travels in the
 * link the phone gets (`packages/core/src/access.ts`). Two of the routes this client calls —
 * `/api/agent/conversations` and `/api/agent/handoff` — read the person's own conversation
 * history off the disk and write into another agent's, and the family that owns those stores
 * (`/api/handoff`) is gated by the operator key: the same doctrine, so the same header, and the
 * agent key comes after it for attribution. The other routes ignore the header.
 *
 * Both come out of `~/.panoma/access.json`, which has permissions 0600. This process runs on
 * the same machine as the catalog —it is a child via stdio of the agent— so it can read it, and
 * the neighbor on the wifi cannot.
 *
 * **Only to the local loop, both of them.** `unsafeDestination` also allows private network
 * addresses, and nothing is sent there: `PANOMA_API` comes from a configuration file without
 * special permissions that is written inside the user's repositories, and sending either key to
 * the address that this file specifies would be giving it away to anyone who manages to edit a
 * line — and the operator key, on top of that, would be handing another machine the right to
 * command in this one. It is the rule `apps/cli/src/catalog-fetch.ts` follows, mirrored: a
 * remote catalog is configured manually, and a remote catalog can never hand off, because the
 * stores live on the catalog's own disk.
 */
interface LocalKeys {
  key: string;
  operator: string;
}

const NO_KEYS: LocalKeys = { key: "", operator: "" };

let stored: Promise<LocalKeys> | undefined;

function localKeys(api: string): Promise<LocalKeys> {
  let host: string;
  try {
    host = new URL(api).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return Promise.resolve(NO_KEYS);
  }
  if (!LOOPBACK.has(host)) return Promise.resolve(NO_KEYS);
  stored ??= readAccessKey()
    .then((found) => ({ key: found?.key ?? "", operator: found?.operator ?? "" }))
    // Without a file there are no keys, and it is not an error: it is the normal `panoma up`,
    // without an open port, where the catalog does not ask for any.
    .catch(() => NO_KEYS);
  return stored;
}

/**
 * Where the agent's key can be sent, and where it cannot.
 *
 * `PANOMA_API` comes from the configuration file MCP of the agent —`.mcp.json`, `~/.claude.json`,
 * `~/.codex/config.toml` — which is a text file on the user's disk, with no special permissions,
 * and which is also written inside their repositories. Whoever manages to change a line there
 * needs nothing else: this process starts automatically every time the agent opens a session and
 * sends, to the address specified in that line and with the Bearer key set, everything the agent
 * requests — the report of any project, its tasks, its log. Not even an exploit would be
 * necessary; the channel is exactly the one designed to work.
 *
 * Against that, the rule is that **a key does not travel in clear outside this house**:
 *
 * - Local loop, always: this is the normal case (`panoma up`).
 * - Private addresses (RFC 1918, link-local, IPv6 ULA) by `http`: it is `--network`, the catalog
 * on the desktop machine and the agent on the laptop next to it.
 * - Any destination by `https`: a real catalog behind a domain.
 * - **The rest, no.** `http://` to an internet name is the exact signature of a manipulated
 * configuration, and there it is better for the agent to see an error than to tell the truth to a
 * stranger.
 *
 * It is not a defense against someone who already writes on your disk —who can change `PANOMA_API`
 * can put a `https` with a valid certificate— but it turns a convenient attack into one that needs
 * to be prepared, and above all makes the attempt visible.
 */
export function unsafeDestination(api: string): string | undefined {
  let url: URL;
  try {
    url = new URL(api);
  } catch {
    return `PANOMA_API is not a valid address: ${api}`;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `PANOMA_API has to be http or https, and it is ${url.protocol}`;
  }
  if (url.protocol === "https:") return undefined;

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (LOOPBACK.has(host) || PRIVATE.some((range) => range.test(host))) return undefined;

  return (
    `PANOMA_API points at ${url.origin}, which is off this machine and unencrypted: the ` +
    `agent key is not sent there. If the catalog is yours and remote, put it behind https. ` +
    `If you did not expect this, look at your agent's MCP config file — it is the only ` +
    `thing that decides this address.`
  );
}

/**
 * The language of the agent protocol.
 *
 * It is the twin of `CLI_LANGUAGE`: two machine surfaces, one language. The website is still
 * bilingual because there is a person with a preference there; here the reader is a model that
 * starts without a session, without a cookie, and without anyone to ask.
 */
export const AGENT_LANGUAGE = "en";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "::"]);

/** RFC 1918, IPv6 link-local and ULA: the home network, which is where `--network` lives. */
const PRIVATE = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^127\./,
  /^f[cd][0-9a-f]{2}:/,
  /^fe80:/,
];

/**
 * A task ID that can be pasted in a path without ceasing to be an ID.
 *
 * The catalog IDs are `tsk_` and twelve characters, but the one that arrives here is not chosen by
 * the catalog: it is chosen **by the agent**, and what the agent thinks is an ID may come from a
 * task written by someone else, from the subject of a commit from another clone, or from a README.
 * That is, from text that Panoma marks as unverified precisely because it isn't.
 *
 * Without this, `taskId = "../../secrets"` did not give an error: `new URL()` crashes `..` and the
 * request went to `/api/secrets` of the catalog, with the Bearer key set and the method changed.
 * Today there is no PATCH that responds there, so it didn’t carry anything — but the route was
 * chosen by whoever wrote the text, not us, and that is what is being fixed. The same with `?` and
 * `#`, which graft parameters into someone else's call.
 */
function taskPath(taskId: string): string {
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(taskId)) {
    throw new Error(
      `“${taskId.slice(0, 60)}” is not shaped like a task id. Ids come from panoma_tasks ` +
        `and are copied verbatim; do not build one out of other text.`,
    );
  }
  return `/api/agent/tasks/${encodeURIComponent(taskId)}`;
}

/**
 * A conversation id as `panoma_conversations` lists it, or nothing.
 *
 * `<agent>:<sessionId>`: letters, digits, `_`, `-` and `.` on both sides of one colon, and no more
 * than 200 characters. It travels in a body, not in a path, so it cannot choose a route the way a
 * task id could; the check is here for the same reason all the same — what the agent takes for an
 * id may come from a README or from somebody else's commit subject — and so that the catalog is
 * asked only with something shaped like an id. The route checks the id against that agent's own
 * shape afterwards; this is the coarse net.
 */
const CONVERSATION_ID = /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/;

export function checkConversationId(id: string): string {
  if (id.length > 200 || !CONVERSATION_ID.test(id)) {
    throw new Error(
      `“${id.slice(0, 60)}” is not shaped like a conversation id. Ids come from ` +
        `panoma_conversations as agent:sessionId and are copied verbatim; do not build one out of other text.`,
    );
  }
  return id;
}

/**
 * What the catalog answered when it refused, with the three fields its routes agree on.
 *
 * `error` is a sentence on most routes and a **code** on the handoff ones (`same-store`,
 * `ambiguous-id`…), `detail` is what the code was about — the two candidate ids, the id that was
 * not found — and `hint` is the one English sentence a route adds for the model. The message
 * keeps the shape the tools have always shown; the fields exist so that a formatter can turn a
 * code into a sentence and keep the detail, which the message alone dropped.
 */
export class CatalogError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly detail: string | undefined,
    readonly hint: string | undefined,
  ) {
    super(`${code ?? `HTTP ${status}`}.${hint ? ` ${hint}` : ""}`);
    this.name = "CatalogError";
  }
}

/**
 * Catalog client.
 *
 * The MCP server **does not touch the database**: it talks to the API just like the CLI. It is the same
 * single-owner rule that cost us a corrupted database to discover, and here it matters even more —
 * there may be several agents running at the same time.
 */
export class CatalogClient {
  /**
   * Why is this address not valid, if it is not valid. It is calculated once and it is said when
   * calling.
   */
  private readonly unsafe: string | undefined;

  constructor(
    private readonly api: string,
    private readonly key: string | undefined,
  ) {
    this.unsafe = unsafeDestination(api);
  }

  /** Pick up or close a task. The id is validated here: see `taskPath`. */
  async task<T>(taskId: string, body: unknown): Promise<T> {
    return this.post<T>(taskPath(taskId), body, "PATCH");
  }

  async post<T>(path: string, body: unknown, method = "POST"): Promise<T> {
    if (this.unsafe) throw new Error(this.unsafe);

    if (!this.key) {
      throw new Error(
        "No agent key. Create one with `panoma agent-key \"<name>\"` and export it as PANOMA_KEY.",
      );
    }

    let response: Response;
    try {
      const local = await localKeys(this.api);
      response = await fetch(new URL(path, this.api), {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.key}`,
          /* The network gate, when it is closed, and the operator's. See `localKeys`. */
          ...(local.key ? { "x-panoma-key": local.key } : {}),
          ...(local.operator ? { "x-panoma-operator": local.operator } : {}),
          /*
            The catalog is bilingual and decides for this header. Without it, it inherits the
            language of whoever is in front —or of its owner's browser— and the agent receives the
            same error in one language or another depending on who was looking at the website.
            There is no reader to follow here: the agent protocol speaks English and says so.
           */
          "Accept-Language": AGENT_LANGUAGE,
        },
        body: JSON.stringify(body),
        /*
          A redirect is not followed: it is taught.
          `fetch` would follow it alone, and although it removes the header `Authorization` when
          changing origin, following it within the same origin is already letting the response
          decide which path the key goes to. The catalog never redirects these paths, so a 3xx
          here means that on the other side the catalog is not there — and that is exactly what
          needs to be counted, not obeyed.
         */
        redirect: "manual",
        /*
          And a limit. Without it, a server that accepts the connection and does not respond
          leaves the agent hanging forever: it does not fail, it stays still, which is the most
          expensive malfunction to diagnose. One minute is more than enough —the longest call is a
          registration, which analyzes a folder— and very little compared to 'never'.
         */
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      if ((error as Error).name === "TimeoutError") {
        throw new Error(
          `The catalog at ${this.api} accepted the connection and did not answer within a ` +
            `minute. Check that it is still alive with \`panoma check\`.`,
          { cause: error },
        );
      }
      /*
        `panoma up` and not `pnpm --filter @panoma/web run dev`.
        The old recipe required knowing where the monorepo is installed and having pnpm in front,
        and whoever reads this is an agent working within **another** project: the folder from
        which pnpm would be run is not the catalog's. CLI already removed that clue for that very
        reason; it stayed here.
       */
      throw new Error(
        `Could not reach the catalog at ${this.api}. Start it with \`panoma up\`.`,
        { cause: error },
      );
    }

    if (response.status >= 300 && response.status < 400) {
      throw new Error(
        `${this.api} answered with a redirect, and the catalog never redirects: panoma is ` +
          `not at that address. Check PANOMA_API in your agent's MCP config.`,
      );
    }

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const text = (field: string) => (typeof payload[field] === "string" ? (payload[field] as string) : undefined);
      throw new CatalogError(response.status, text("error") ?? (response.statusText || undefined), text("detail"), text("hint"));
    }

    return payload as T;
  }
}

export interface Location {
  cwd: string;
  /**
   * Repository root (`git rev-parse --show-toplevel`).
   *
   * It is sent as soon as the catalog can register a project at the moment: what has to be entered
   * is the repository, not the subfolder where the agent is located. Without this, working on
   * `packages/core` in a monorepo would register `packages/core` as if it were a standalone
   * project, and the catalog gets filled with folders that their owner does not recognize. To
   * *find* an already cataloged project is not necessary —the catalog resolves by prefix— so this
   * only matters at registration.
   */
  root?: string;
  remote?: string;
}

/**
 * Identify where the agent is working.
 *
 * We send the route *and* remote because each one fails in a different way: the route breaks when
 * moving the folder, and the remote is shared by all copies of the project. With both, the catalog
 * can disambiguate.
 */
export async function describeLocation(cwd?: string): Promise<Location> {
  const directory = cwd ?? process.cwd();

  const [remote, root] = await Promise.all([
    git(directory, ["config", "--get", "remote.origin.url"]),
    git(directory, ["rev-parse", "--show-toplevel"]),
  ]);

  // The catalog keeps the remotes normalized to https, so the SSH form translates here: otherwise,
  // the same repository cloned by SSH and by HTTPS appear as two.
  const ssh = remote ? /^git@([^:]+):(.+?)(\.git)?$/.exec(remote) : null;
  const normalized = ssh ? `https://${ssh[1]}/${ssh[2]}` : remote?.replace(/\.git$/, "");

  return { cwd: directory, root: root || undefined, remote: normalized || undefined };
}

/** A git value, or nothing. There is no failure here that deserves breaking the tool. */
async function git(directory: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run("git", ["-C", directory, ...args], { timeout: 5_000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
