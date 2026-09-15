import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readAccessKey, type MemoryKind, type MemoryOperation } from "@panoma/core";
import { z } from "zod";

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
 *
 * The memory routes (14-Sep-2026) write a third shape, `{ code, error, hint?, retryable }`, where
 * `code` is the word a program branches on (`stale_cursor`, `not_found`…) and `error` the
 * sentence a person reads. There `code` becomes this `code`, and the sentence travels ahead of
 * the hint so that the message still says what happened: `stale_cursor. The continuation is
 * stale. Restart the read.` A route without a `code` field is read exactly as before.
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
      const code = text("code");
      if (code === undefined) {
        throw new CatalogError(response.status, text("error") ?? (response.statusText || undefined), text("detail"), text("hint"));
      }
      const said = [text("error"), text("hint")].filter((part) => part !== undefined).join(" ");
      throw new CatalogError(response.status, code, text("detail"), said || undefined);
    }

    return payload as T;
  }
}

// ── The memory contract, version 2: what is asked and how the catalog is asked for it ────────

/**
 * Which memory contract the catalog speaks: `1` is the legacy briefing, `2` the versioned
 * contract of 14-Sep-2026 with full reads by id and continuations.
 */
export type MemoryVersion = 1 | 2;

/** What `POST /api/agent/hello` answers; `memory` is absent on a catalog older than the contract. */
export interface HelloAnswer {
  ok: boolean;
  agent: string;
  memory?: { versions?: number[]; features?: string[]; profiles?: string[] };
}

/** The version a hello answer enables. Anything that is not a list naming 2 is the legacy catalog. */
export function memoryVersionOf(answer: unknown): MemoryVersion {
  if (answer === null || typeof answer !== "object") return 1;
  const memory = (answer as { memory?: unknown }).memory;
  if (memory === null || typeof memory !== "object") return 1;
  const versions = (memory as { versions?: unknown }).versions;
  return Array.isArray(versions) && versions.includes(2) ? 2 : 1;
}

/**
 * The hello, kept.
 *
 * The server has said «I am here» to the catalog since 0.10 — after `connect`, fire and forget,
 * because a catalog that is slow or absent must not delay the channel with the agent. The
 * answer was thrown away. Now it is the negotiation: a catalog that lists version 2 in
 * `memory.versions` gets the versioned contract on every brief, and one that does not — or that
 * did not answer — is treated as legacy for the life of this process. **Without a second
 * query.** A failed hello is not retried on the next tool call: the agent's first call would
 * pay for the retry, and the legacy answer is a complete answer, not a degraded one. The agent
 * that wants the contract anyway says so with `memoryVersion: 2`, which is a request, not a
 * retry.
 *
 * A tool call that arrives while the hello is still in flight waits for it: it is the same
 * catalog the call is about to ask, so the wait costs nothing the call would not have paid.
 * Before `start()` — before `connect` — there is no hello to wait for, and the answer is legacy.
 */
export class MemoryNegotiation {
  private outcome: Promise<MemoryVersion> | undefined;

  constructor(private readonly client: CatalogClient) {}

  /** Send the hello once. Nothing is reported: on stdio, noise is not a message anybody reads. */
  start(): void {
    this.outcome ??= this.client.post<HelloAnswer>("/api/agent/hello", {}).then(memoryVersionOf, () => 1);
  }

  version(): Promise<MemoryVersion> {
    return this.outcome ?? Promise.resolve(1);
  }
}

/*
  What the two memory tools accept, beside the bodies they become.

  The shapes live here and not in `index.ts` for one reason: `index.ts` connects to stdio when it
  is imported, so nothing in it can be tested, and the rule that spans fields — `memoryId` needs
  `memoryKind` and `revision`, and excludes `query` and `entryId` — is exactly the kind of rule
  that is written once and drifts. It cannot be expressed in the raw shape the SDK publishes to
  the agent either: a refined object has no `.shape`, and the SDK then advertises the tool with
  an empty input schema. So the raw shape is what the SDK sees, and `checkRecallInput` runs the
  refinement on what it parsed.
 */

/**
 * The operations a brief may declare: the tuple is what `z.enum` needs, the vocabulary is core's.
 * `satisfies` refuses a word core does not know; the test refuses a word of core's missing here.
 */
const OPERATION_WORDS = ["read", "edit", "test", "build", "deploy", "review", "other"] as const satisfies readonly MemoryOperation[];

/**
 * What a read by id may name: the three unit kinds of the contract, and — since delivery C — an
 * open commitment of the project or the case of one of its tasks. A case is a projection with
 * no revision of its own, so `revision` may be left out for it and is 1 (plan §9.4, §23.4).
 */
export type MemoryReadKind = MemoryKind | "commitment" | "case";
const READ_KINDS = ["note", "criterion", "decision", "commitment", "case"] as const satisfies readonly MemoryReadKind[];
const CASE_REVISION = 1;

/** An id as the catalog issues them: nothing that could choose a route or carry a sentence. */
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const CONTEXT_MEMORY_INPUT = {
  memoryVersion: z.literal(2).optional()
    .describe(
      "Ask for the memory contract, version 2, even if the catalog did not announce it when this " +
      "server started. Omit it: the contract is used whenever the catalog speaks it.",
    ),
  operation: z.enum(OPERATION_WORDS).optional()
    .describe("What you are about to do: read, edit, test, build, deploy, review or other. Pair it with task."),
  contextId: z.string().regex(OPAQUE_ID).optional()
    .describe("The context id a previous brief of this same session gave. Keeps its deliveries attributed to one context."),
  contextGeneration: z.number().int().positive().optional()
    .describe("The generation that came with that context id, copied verbatim."),
  continuation: z.string().min(1).max(4096).optional()
    .describe("The continuation a previous brief gave when more units may exist, with the same files and task."),
};

export const RECALL_INPUT = {
  query: z.string().min(1).max(1000).optional().describe("Search words or a quoted phrase. Omit when opening an entryId."),
  cursor: z.string().max(4096).optional().describe("The nextCursor of a search, copied verbatim with the same query."),
  entryId: z.string().max(128).optional().describe("An ID returned by this project's journal search. Opens the original."),
  offset: z.number().int().nonnegative().optional().describe("The nextOffset returned by an original entry read."),
  memoryKind: z.enum(READ_KINDS).optional()
    .describe(
      "With memoryId and revision: the kind of the memory unit to read whole, as a brief listed it — " +
      "note, criterion or decision; or commitment (an open obligation of this project, by its id) " +
      "or case (the decision case of one task of this project, by the task id; revision may be omitted).",
    ),
  memoryId: z.string().regex(OPAQUE_ID).optional()
    .describe("The id of a memory unit a brief listed, of an open commitment, or of a task for its case. Reads that unit whole; not with query or entryId."),
  revision: z.number().int().positive().optional()
    .describe("The revision of that unit, as the brief listed it. The read keeps that revision, current or not. A case has none: omit it."),
  continuation: z.string().min(1).max(4096).optional()
    .describe("The continuation a partial memory read gave, with the same memoryKind, memoryId and revision."),
};

export interface MemoryReadAsk {
  memoryKind: MemoryReadKind;
  memoryId: string;
  revision: number;
  continuation?: string;
}

export interface JournalAsk {
  query?: string;
  cursor?: string;
  entryId?: string;
  offset?: number;
}

export type RecallAsk = { read: MemoryReadAsk } | { journal: JournalAsk };

const RECALL_RULES = z.object(RECALL_INPUT).superRefine((input, report) => {
  const memoryFields = (["memoryKind", "memoryId", "revision", "continuation"] as const).filter((key) => input[key] !== undefined);
  if (memoryFields.length === 0) return;
  if (input.memoryId === undefined) {
    report.addIssue({ code: z.ZodIssueCode.custom, message: `${memoryFields.join(", ")} only make sense with memoryId: name the unit a brief listed.` });
    return;
  }
  // A case is read at revision 1 whether or not the caller says so: a projection has no other.
  const missing = (["memoryKind", "revision"] as const).filter((key) => input[key] === undefined && !(key === "revision" && input.memoryKind === "case"));
  if (missing.length > 0) {
    report.addIssue({ code: z.ZodIssueCode.custom, message: `memoryId needs memoryKind and revision, exactly as the brief listed them; missing: ${missing.join(", ")}.` });
  }
  const journalFields = (["query", "cursor", "entryId", "offset"] as const).filter((key) => input[key] !== undefined);
  if (journalFields.length > 0) {
    report.addIssue({ code: z.ZodIssueCode.custom, message: `A memory read by id is one call and a journal search another: drop ${journalFields.join(", ")} or drop memoryId.` });
  }
});

/**
 * Sort a `panoma_recall` call into the read it is: a memory unit by id, or the journal as always.
 * Throws with the rule that was broken, in the words the agent can act on.
 */
export function checkRecallInput(input: z.input<typeof RECALL_RULES>): RecallAsk {
  const checked = RECALL_RULES.safeParse(input);
  if (!checked.success) throw new Error(checked.error.issues.map((issue) => issue.message).join(" "));
  const { memoryKind, memoryId, revision, continuation, ...journal } = checked.data;
  if (memoryId !== undefined && memoryKind !== undefined) {
    const asked = revision ?? (memoryKind === "case" ? CASE_REVISION : undefined);
    if (asked !== undefined) return { read: { memoryKind, memoryId, revision: asked, ...(continuation !== undefined ? { continuation } : {}) } };
  }
  return { journal };
}

export interface ContextAsk {
  files?: string[];
  task?: string;
  memoryVersion?: 2;
  operation?: MemoryOperation;
  contextId?: string;
  contextGeneration?: number;
  continuation?: string;
}

/**
 * The body of a brief request.
 *
 * Without the contract it is the body the tool has always sent — location, `files`, `task` —
 * byte for byte, so a legacy catalog sees nothing new. With it, `memory` is added and nothing
 * else moves: the mode is `action` as soon as the agent named files or a task, because a rule
 * that sleeps on a path or a decision conditioned on an operation is then being asked about a
 * concrete step, and `orientation` otherwise. The contract travels when the hello enabled it or
 * when the agent asked for it by name: a legacy catalog ignores the key and answers as before.
 */
export function contextRequest(where: Location, ask: ContextAsk, negotiated: MemoryVersion): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...where,
    ...(ask.files !== undefined ? { files: ask.files } : {}),
    ...(ask.task !== undefined ? { task: ask.task } : {}),
  };
  if (ask.memoryVersion !== 2 && negotiated !== 2) return body;
  return {
    ...body,
    memory: {
      version: 2,
      mode: ask.files !== undefined || ask.task !== undefined ? "action" : "orientation",
      ...(ask.operation !== undefined ? { operation: ask.operation } : {}),
      ...(ask.contextId !== undefined ? { contextId: ask.contextId } : {}),
      ...(ask.contextGeneration !== undefined ? { contextGeneration: ask.contextGeneration } : {}),
      ...(ask.continuation !== undefined ? { continuation: ask.continuation } : {}),
    },
  };
}

/**
 * The body of a full read by id: the location and `memory.read`, and nothing of a brief — no
 * task, no files, no mode. The route refuses the mix, and a read must never enrol a project or
 * patrol its sentinels, which are the two things a brief does on the way.
 */
export function memoryReadRequest(where: Location, read: MemoryReadAsk): Record<string, unknown> {
  return {
    ...where,
    memory: {
      version: 2,
      read: {
        kind: read.memoryKind,
        id: read.memoryId,
        revision: read.revision,
        ...(read.continuation !== undefined ? { continuation: read.continuation } : {}),
      },
    },
  };
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
