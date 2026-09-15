import {
  MemoryShapeError,
  TASTE_CAP,
  TasteFullError,
  parseTaste,
  publishesInferred,
  readConsent,
  readTaste,
  redactSecrets,
  renderTaste,
  setInferredConsent,
  validatePredicate,
  writeTaste,
  type Predicate,
  type TasteLine,
} from "@panoma/core";
import {
  ALIVE,
  inTransaction,
  insertBeliefs,
  jobById,
  listBeliefs,
  markPublished,
  projectNamesByIdentity,
  queueWrite,
  resolveProject,
  resolveProposal,
  resolveProposalByRevision,
  setBeliefScope,
  setBeliefScopeByRevision,
  signBelief,
  signBeliefByRevision,
  tasteScore,
  vetoBelief,
  vetoBeliefByRevision,
  type BeliefRow,
  type BeliefWrite,
  type Database,
  type JobRow,
} from "@panoma/db";
import { NO_STORE, RETRYABLE, type MemoryRefusalCode } from "@/lib/agent-channel";
import { db, memoryQuarantine } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";
import { publishable, reconcileWithFile, unresolvedPublishable } from "@/lib/publishable";
import { PUBLICATIONS_PER_PASS, lineKey, planPublication, publicationState, runPublicationPass, type PublicationStatus } from "@/lib/taste-publish";
import { TEACH_MAX, parseTeaching, scopable, teachBelief, TeachingError, type Teaching } from "@/lib/teach";
import { memoryFence, MemoryUnavailableError, memoryUnavailableResponse } from "@/lib/memory-availability";
import { memoryFileWrite } from "@/lib/memory-file-write";

/**
 * The portrait: what is read and what is signed.
 *
 * Write `TASTE.md` from the **beliefs**, which is the only thing that reaches the agents. Before,
 * it was written from the accepted sentences one by one; the reason for the change is in
 * `schema.ts`, above the two tables, and the consequence for this route is that there is nothing
 * to approve anymore. What there are are four gestures, and none is mandatory:
 *
 * - **to sign** —editing the sentence or saying that it is okay—, which takes it out of the reach
 * of synthesis forever;
 * - **veto**, which sends it to the cemetery and turns it into negative evidence;
 * - **to delimit**, which limits it to a project or returns it to everything you do;
 * - **resolve** a proposal, which is the only queue left: the synthesis wanted to touch something
 * signed and it cannot do that alone.
 *
 * ── Remove from the file ──────────────────────────────────────────────────────────
 *
 * What is signed always, and from what is inferred only what exceeds the trust floor—three
 * observations from two days or from two projects, see `standsUp`. What is below can be seen on
 * the screen marked 'in formation' and does not go beyond that: inferring without asking, yes;
 * noise directing agents, no. That is the line that replaces the signature as a brake, and that is
 * why the floor lives in `@panoma/db`, where it is shared by the terminal and the web.
 *
 * ── And one question, just once ─────────────────────────────────────────────────
 *
 * None of what is **inferred** goes down until the person says yes once. It is not a disguised
 * tail: it is a boundary that does deserve to be questioned, because by closing the review phrase
 * by phrase something that no one has signed went on to be able to speak on their behalf in each
 * session of each agent. Before, there were hundreds of decisions; now there is one, and as long
 * while the portrait remains unanswered, it is exactly what the person signed. The absence of a response **is
 * not** a yes — see `publishesInferred`.
 *
 * ── The file is still an entry ──────────────────────────────────────────
 *
 * And now it does more than before. `reconcileTaste` distinguishes a **deleted** line from a
 * **rewritten** line by the quote mark that travels with it, and here each thing means one:
 * deleting a line is vetoing that belief, and rewriting it is signing it with the new words. It is
 * the best version of 'the file is the undo': anyone who does not want to open the screen can
 * direct their entire portrait with a text editor.
 *
 * ── GET is seen from the mobile; POST, not ──────────────────────────────────
 *
 * `localOperatorOnly` in the POST and not in the GET, which is the doctrine of `lib/guard.ts`: the
 * key of `panoma up --network` allows **looking at** the catalog, not putting hands on the
 * keyboard of this machine. And here the POST does the two things that that phrase excludes — it
 * writes `TASTE.md`, which is what all the agents of this person read in all their sessions, and
 * it saves the permission for what the machine deduced on its own to speak on their behalf.
 *
 * The doctrine test found it, not a review: the rule said 'routes that start
 * processes,' this one doesn't start any, yet it grants permission. The rule now also names those
 * that open the history or make decisions about it.
 *
 * ── Either everything goes in or nothing goes in
 * ─────────────────────────────────────────────────
 *
 * The database guarantees it. Without the transaction, a portrait that does not fit would leave the
 * gestures saved and the file as it was, and that split state is **unstable**: `reconcileTaste`
 * withdraws any belief whose sentence isn't in the file, so the next save that does fit would veto
 * exactly what never got written. See `inTransaction`, where it is argued why writing to the file
 * goes inside.
 *
 * ── Version 2: the revision goes with the gesture, and the file goes through the outbox ─────
 *
 * Since delivery D a body with `version: 2` names, in every gesture, the revision of the belief
 * the person was looking at (`expectedRevision`), and the writers of `@panoma/db` refuse with
 * `stale_revision` what moved meanwhile — a synthesis, another tab, a redistribution. The
 * gestures of one request are one transaction: a single stale one leaves every other unapplied
 * (409, nothing written), so the screen re-reads and the person signs what they see. A teaching
 * or a signature may carry typed conditions and exceptions; they are validated as predicates
 * before any write, and what the photograph then holds is exactly the owner's tree under the
 * owner's authority. A tree a model proposed is never a signed condition by being valid JSON:
 * a bare signature over an inferred criterion clears the model's predicates, and only a gesture
 * that restates them signs them. Changing `publishInferred` names the publication generation GET
 * reported (`expectedPublicationRevision`); a generation that moved is `publication_conflict`.
 *
 * The portrait's cap is still measured inside the transaction — over the file as it was read
 * before it, without touching the disk from inside — so a refusal of the text budget leaves no
 * signature half-made. The file itself is no longer written here: the request plans a
 * publication (`planPublication`), runs the outbox once, and answers 200 when the job finished
 * inline or 202 with `publication: { id, status }` when it is still pending or in conflict.
 * A conflict on the file is never a veto; the screen shows the reconciliation.
 */

export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;
  // After the guard, never before: the quarantine check opens the catalog (`gates.test.ts`).
  if ((await memoryQuarantine()).quarantined) return Response.json({ code: "unavailable", error: "Memory is quarantined until its deletion journal is reconciled." }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const { db: database } = await db();
  const [beliefs, profile, score, names, consent, publication] = await Promise.all([
    listBeliefs(database),
    readTaste(),
    tasteScore(database),
    projectNamesByIdentity(database),
    readConsent(),
    publicationState(database, { target: "TASTE" }),
  ]);

  return Response.json({
    beliefs,
    profile,
    score,
    names,
    /* If the inferred can go down. Without this, the terminal cannot say why it is missing. */
    publishesInferred: publishesInferred(consent),
    /*
      Delivery D: the state of the publication — its generation, which a `publishInferred` gesture
      must name back — and the revision of every criterion, which every v2 gesture names. The
      beliefs above already travel to this audience; nothing private is added for another one.
     */
    publication,
    revisions: Object.fromEntries(beliefs.map((row) => [row.id, row.memoryRev])),
  }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  // Write the file that all your agents read and save a permission. See header.
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  if ((await memoryQuarantine()).quarantined) return Response.json({ code: "unavailable", error: "Memory is quarantined until its deletion journal is reconciled." }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const locale = localeFrom(request);
  const raw = await request.json().catch(() => ({}));
  const body = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as {
    version?: unknown;
    sign?: unknown;
    veto?: unknown;
    scope?: unknown;
    resolve?: unknown;
    publishInferred?: unknown;
    teach?: unknown;
  };

  // Delivery D: the revisioned body goes its own way; the legacy body below keeps its behaviour.
  if (body.version === 2) return postV2(body as Record<string, unknown>, locale);

  let teaching: Teaching | undefined;
  if (body.teach !== undefined) {
    try {
      teaching = parseTeaching(body.teach);
    } catch {
      return Response.json({ error: t(locale, "twinTeach.invalid") }, { status: 400 });
    }
  }

  /*
    The answer to the only question, if it comes. It is saved **before** reconciling because it
    changes what is written: saying yes and that the file will not change until the next action
    would leave someone looking at a screen that says 'granted' and a file that does not know it.
    Only a boolean counts, and absence is nothing: a body without the key is a normal save, not a
    revocation.
   */
  if (typeof body.publishInferred === "boolean") {
    await setInferredConsent(body.publishInferred);
  }

  const gestures: Gestures = {
    sign: signs(body.sign),
    veto: ids(body.veto),
    scope: scopes(body.scope),
    resolve: resolutions(body.resolve),
    ...(teaching ? { teach: teaching } : {}),
  };

  /*
    Without gestures it is not a mistake: it is 'pick up what I edited by hand.' Someone opens the
    file, deletes a sentence that no longer represents them, and wants Twin to find out without
    having to sign something to trigger it.
   */
  const { db: database } = await db();

  try {
    return await memoryFileWrite(database, async () => {
      const memoryCurrent = await memoryFence(database);
      await memoryCurrent();
      return queueWrite(() => inTransaction(database, async (tx) => apply(tx, gestures)));
    });
  } catch (error) {
    if (error instanceof MemoryUnavailableError) return memoryUnavailableResponse();
    if (error instanceof TeachingError) {
      return Response.json({ error: t(locale, error.reason === "project" ? "api.noProject" : "twinTeach.scopeError") }, { status: error.reason === "project" ? 404 : 400 });
    }
    if (error instanceof TasteFullError) {
      return Response.json(
        {
          error: t(locale, "taste.full", { chars: error.chars, cap: error.cap }),
          chars: error.chars,
          cap: error.cap,
          // Everything to zero and not what was applied: the transaction was reversed, so nothing
          // was applied. Showing 'signed: 3' on an intact basis would be lying.
          signed: 0,
          taught: 0,
          vetoed: 0,
          scoped: 0,
          resolved: 0,
          withdrawn: 0,
          rewritten: 0,
          profile: await readTaste(),
        },
        { status: 409 },
      );
    }
    throw error;
  }
}

interface Gestures {
  sign: { id: string; statement?: string }[];
  veto: string[];
  scope: { id: string; identity: string | null }[];
  resolve: { id: string; accept: boolean }[];
  teach?: Teaching;
}

async function apply(database: Database, gestures: Gestures): Promise<Response> {
  const [file, names, consent] = await Promise.all([
    readTaste(),
    projectNamesByIdentity(database),
    readConsent(),
  ]);
  const inferred = publishesInferred(consent);
  const taught = gestures.teach ? await teachBelief(database, gestures.teach, names) : undefined;

  /*
    They are applied one by one and the ones that actually changed are counted. Each function
    returns whether there was a row to modify, and the id comes from outside: a screen opened
    before a `forget` sends ids that no longer exist, and counting them as completed would be
    promising a change that did not happen.
   */
  let signed = 0;
  for (const one of gestures.sign) {
    if (await signBelief(database, one.id, one.statement)) signed += 1;
  }
  let vetoed = 0;
  for (const id of gestures.veto) if (await vetoBelief(database, id)) vetoed += 1;
  let scoped = 0;
  for (const one of gestures.scope) {
    if (await setBeliefScope(database, one.id, one.identity)) scoped += 1;
  }
  let resolved = 0;
  for (const one of gestures.resolve) {
    if (await resolveProposal(database, one.id, one.accept)) resolved += 1;
  }

  /*
    Everything in the database, read **after** applying the gestures: what should be written is
    the current state and not the one from before the person touched anything.
   */
  const todas = await listBeliefs(database);
  const rows = publishable(
    todas.filter((row) => ALIVE.includes(row.state)),
    names,
    inferred,
  );
  const publicables = new Set(rows.map((row) => row.id));
  /*
    What the file will NOT carry although the person could publish it: a belief whose project has
    no name in the catalog. Until 14-Sep-2026 it went down as a global line, which is the one thing
    a missing name must never grant; now it stays out and is counted, so the screen can say it.
   */
  const unresolved = unresolvedPublishable(todas.filter((row) => ALIVE.includes(row.state)), names, inferred).length;

  /*
    And what was written and is no longer published: banned, withdrawn, absorbed by a merger, or
    fallen below the floor. Its lines are removed from the file **before** reconciling, so it was
    written about them and not for what the row says today.
    It was missing, and it was serious in both directions. Removing it got nothing out of the
    file: the line was a gap that no one claimed, the rule of ‘what no one claimed stays’
    preserved it, and the agents kept reading a belief that the catalog had already considered
    dead — without any gesture capable of removing it, because the screen only lists what is
    alive. And the sisters that an accepted merger withdrew left their old lines there forever.
    Since 14-Sep-2026 the computation is `reconcileWithFile`, the same one the selector runs
    before serving a criterion (A20/T57): one reading of the file, on both roads.
   */
  const retiradas = todas.filter((row) => row.publishedAs !== null && !publicables.has(row.id));
  const merge = reconcileWithFile(todas, names, inferred, file.lines);

  /*
    Deleting a line by hand is vetoing that belief, and rewriting it is signing it. Both things
    happen **before** writing: the disk has been saying it since before the request, so this just
    brings the database up to date with the file.
   */
  let withdrawn = 0;
  for (const id of merge.withdrawn) if (await vetoBelief(database, id)) withdrawn += 1;
  let rewritten = 0;
  for (const one of merge.rewritten) {
    if (await signBelief(database, one.id, one.statement)) rewritten += 1;
  }

  /*
    Without `try`. What I launch here comes out of the transaction and reverses it, which is
    exactly what has to happen: `TasteFullError` included. The 409 response is composed outside,
    with the database already intact.
   */
  const profile = await writeTaste(merge.lines);

  /*
    And it notes **what** has been written of each one, now with the file on the disk. It is taken
    from `profile.lines`, which is what `writeTaste` ended up putting —processed through
    `oneLine`, with the scope clean— and not from what was requested: the next reconciliation
    compares against the disk, so what is saved has to be the disk.
    And it searches by the line that **the reconciliation** says each row claimed, not by the text
    of the row. Here it was searching by the text, and that failed precisely in the case that
    matters most: a belief that the person rewrote by hand ends up in the file with **its** text
    and in the database with the previous one —`signBelief` runs afterward—, so it didn't find its
    own line and would mark «never written». The next day, deleting that line stopped preventing
    it —it would be added again as if it had never been there— and blocking it from the screen
    didn't remove it from the file. The same hole opened without touching anything whenever what
    was written differed from what was requested: a sentence with `-->` inside, or a project with
    two colons in the name.
    What came out of the file is marked with nothing, so that its absence is not read as a
    deletion of the person next time.
   */
  const escrito = new Map(profile.lines.map((line) => [lineKey(line), line] as const));
  const gone = new Set(merge.withdrawn);
  await markPublished(database, [
    ...merge.claims
      .filter((claim) => !gone.has(claim.id))
      .map((claim) => {
        const line = escrito.get(lineKey(claim.line));
        return {
          id: claim.id,
          published: line
            ? {
                topic: line.topic,
                statement: line.statement,
                ...(line.scope ? { scope: line.scope } : {}),
              }
            : null,
        };
      }),
    ...retiradas.map((row) => ({ id: row.id, published: null })),
    ...merge.withdrawn.map((id) => ({ id, published: null })),
  ]);

  return Response.json({ signed, vetoed, scoped, resolved, withdrawn, rewritten, profile, unresolved,
    taught: taught?.created ? 1 : 0, ...(taught ? { beliefId: taught.id } : {}) });
}

/**
 * The signatures required by the body: an ID, and optionally the new text.
 *
 * The loose string is accepted in addition to the object, because 'fix this as is' is the most
 * common gesture and `{"sign":["abc"]}` is what the person writes by hand when testing with
 * `curl`. An object without `statement` means the same.
 */
function signs(value: unknown): { id: string; statement?: string }[] {
  if (!Array.isArray(value)) return [];
  const out = new Map<string, { id: string; statement?: string }>();
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) {
      out.set(item, { id: item });
      continue;
    }
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row["id"] === "string" ? row["id"] : undefined;
    if (!id) continue;
    const statement = typeof row["statement"] === "string" ? row["statement"].trim() : undefined;
    out.set(id, { id, ...(statement ? { statement } : {}) });
  }
  return [...out.values()];
}

/**
 * The scopes that the body asks for: an ID and which project it is limited to, or `null` for
 * everything.
 *
 * Null is a value and not the absence of one, so it is distinguished from 'don't send it': a
 * missing key and a `identity: null` would mean opposite things—leave it as it is and return it to
 * everything you do—and confusing them would silently expand the scope of a belief to one hundred
 * and twelve projects.
 */
function scopes(value: unknown): { id: string; identity: string | null }[] {
  if (!Array.isArray(value)) return [];
  const out = new Map<string, { id: string; identity: string | null }>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row["id"] === "string" ? row["id"] : undefined;
    if (!id || !("identity" in row)) continue;
    const identity = typeof row["identity"] === "string" ? row["identity"] : null;
    out.set(id, { id, identity });
  }
  return [...out.values()];
}

/** The resolved proposals: an id and if it is accepted. Without legible `accept`, it is discarded. */
function resolutions(value: unknown): { id: string; accept: boolean }[] {
  if (!Array.isArray(value)) return [];
  const out = new Map<string, { id: string; accept: boolean }>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row["id"] === "string" ? row["id"] : undefined;
    if (!id) continue;
    out.set(id, { id, accept: row["accept"] === true });
  }
  return [...out.values()];
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const item of value) if (typeof item === "string" && item.length > 0) out.add(item);
  return [...out];
}

// ── Version 2 ──────────────────────────────────────────────────────────────────────────────

/** The gestures of one request, at most this many: a screen sends what a person can look at. */
const GESTURES_MAX = 20;
const V2_KEYS = ["version", "teach", "sign", "veto", "scope", "resolve", "publishInferred", "expectedPublicationRevision"];
const TOPIC = /^[a-z][a-z0-9-]{0,23}$/;

interface TeachV2 extends Teaching {
  conditions?: Predicate | null;
  exceptions?: Predicate | null;
}

interface SignV2 {
  id: string;
  expectedRevision: number;
  statement?: string;
  conditions?: Predicate | null;
  exceptions?: Predicate | null;
}

interface ScopeV2 {
  id: string;
  expectedRevision: number;
  scope: "global" | "project";
  slug?: string;
}

interface GesturesV2 {
  teach?: TeachV2;
  sign: SignV2[];
  veto: { id: string; expectedRevision: number }[];
  scope: ScopeV2[];
  resolve: { id: string; expectedRevision: number; accept: boolean }[];
  publishInferred?: boolean;
  expectedPublicationRevision?: number;
}

/** A refusal in the shape of the memory doors — a code of their vocabulary, an English sentence, `no-store` — with the fields a gesture needs beside it (`id`, `currentRevision`, `reason`). */
function refusal(code: MemoryRefusalCode, status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ code, error, retryable: RETRYABLE.has(code), ...extra }, { status, headers: NO_STORE });
}

function invalid(reason: string): Response {
  return refusal("invalid_input", 400, `The body is not a valid taste request: ${reason}.`, { reason });
}

/** The gesture that could not be applied: the whole transaction rolls back with it. */
class GestureRefusal extends Error {
  constructor(readonly code: "stale_revision" | "not_found", readonly id: string, readonly currentRevision?: number) {
    super(code);
  }
}

class BodyRefusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function idOf(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) throw new BodyRefusal("id");
  return value;
}

function revisionOf(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new BodyRefusal("expectedRevision");
  return value as number;
}

/** `undefined` keeps the row's, `null` clears, an object must be a predicate of core. */
function predicateOf(value: unknown, field: "conditions" | "exceptions"): Predicate | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  try {
    return validatePredicate(value);
  } catch (error) {
    throw new BodyRefusal(`${field}:${error instanceof MemoryShapeError ? error.code : "shape"}`);
  }
}

function statementOf(value: unknown): string {
  if (typeof value !== "string") throw new BodyRefusal("statement");
  const clean = redactSecrets(value.normalize("NFC").replace(/\s+/g, " ").trim());
  if (clean === "" || clean.length > TEACH_MAX) throw new BodyRefusal("statement");
  return clean;
}

function closed(value: Record<string, unknown>, keys: string[], what: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new BodyRefusal(`${what}.${key}`);
}

/** `scope: "global"` with no slug, or `scope: "project"` with one: a global rule is chosen expressly, never by an absent slug. */
function scopeOf(value: Record<string, unknown>, what: string): { scope: "global" | "project"; slug?: string } {
  const scope = value["scope"];
  const slug = value["slug"];
  if (scope === "global") {
    if (slug !== undefined) throw new BodyRefusal(`${what}.slug`);
    return { scope };
  }
  if (scope === "project") {
    if (typeof slug !== "string" || slug.trim() === "") throw new BodyRefusal(`${what}.slug`);
    return { scope, slug: slug.trim() };
  }
  throw new BodyRefusal(`${what}.scope`);
}

function list(value: unknown, what: string): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) throw new BodyRefusal(what);
  return value as Record<string, unknown>[];
}

function parseV2(body: Record<string, unknown>): GesturesV2 {
  closed(body, V2_KEYS, "body");
  const gestures: GesturesV2 = { sign: [], veto: [], scope: [], resolve: [] };
  if (body["teach"] !== undefined) {
    if (!isRecord(body["teach"])) throw new BodyRefusal("teach");
    closed(body["teach"], ["statement", "topic", "scope", "slug", "conditions", "exceptions"], "teach");
    const scope = scopeOf(body["teach"], "teach");
    let teaching: Teaching;
    try {
      teaching = parseTeaching({ statement: body["teach"]["statement"], topic: body["teach"]["topic"], ...(scope.slug ? { slug: scope.slug } : {}) });
    } catch {
      throw new BodyRefusal("teach");
    }
    if (!TOPIC.test(teaching.topic)) throw new BodyRefusal("teach.topic");
    const conditions = predicateOf(body["teach"]["conditions"], "conditions");
    const exceptions = predicateOf(body["teach"]["exceptions"], "exceptions");
    gestures.teach = { ...teaching, ...(conditions !== undefined ? { conditions } : {}), ...(exceptions !== undefined ? { exceptions } : {}) };
  }
  for (const item of list(body["sign"], "sign")) {
    closed(item, ["id", "expectedRevision", "statement", "conditions", "exceptions"], "sign");
    const conditions = predicateOf(item["conditions"], "conditions");
    const exceptions = predicateOf(item["exceptions"], "exceptions");
    gestures.sign.push({
      id: idOf(item["id"]), expectedRevision: revisionOf(item["expectedRevision"]),
      ...(item["statement"] !== undefined ? { statement: statementOf(item["statement"]) } : {}),
      ...(conditions !== undefined ? { conditions } : {}), ...(exceptions !== undefined ? { exceptions } : {}),
    });
  }
  for (const item of list(body["veto"], "veto")) {
    closed(item, ["id", "expectedRevision"], "veto");
    gestures.veto.push({ id: idOf(item["id"]), expectedRevision: revisionOf(item["expectedRevision"]) });
  }
  for (const item of list(body["scope"], "scope")) {
    closed(item, ["id", "expectedRevision", "scope", "slug"], "scope");
    gestures.scope.push({ id: idOf(item["id"]), expectedRevision: revisionOf(item["expectedRevision"]), ...scopeOf(item, "scope") });
  }
  for (const item of list(body["resolve"], "resolve")) {
    closed(item, ["id", "expectedRevision", "accept"], "resolve");
    if (typeof item["accept"] !== "boolean") throw new BodyRefusal("resolve.accept");
    gestures.resolve.push({ id: idOf(item["id"]), expectedRevision: revisionOf(item["expectedRevision"]), accept: item["accept"] });
  }
  if (body["publishInferred"] !== undefined) {
    if (typeof body["publishInferred"] !== "boolean") throw new BodyRefusal("publishInferred");
    // The permission names the generation of the publication the person looked at, always.
    if (!Number.isSafeInteger(body["expectedPublicationRevision"]) || (body["expectedPublicationRevision"] as number) < 1) throw new BodyRefusal("expectedPublicationRevision");
    gestures.publishInferred = body["publishInferred"];
    gestures.expectedPublicationRevision = body["expectedPublicationRevision"] as number;
  } else if (body["expectedPublicationRevision"] !== undefined) {
    throw new BodyRefusal("expectedPublicationRevision");
  }

  // Two gestures on one belief cannot both name the revision they saw: one of them lies.
  const ids = [...gestures.sign, ...gestures.veto, ...gestures.scope, ...gestures.resolve].map((one) => one.id);
  if (new Set(ids).size !== ids.length) throw new BodyRefusal("duplicate_id");
  const count = ids.length + (gestures.teach ? 1 : 0) + (gestures.publishInferred === undefined ? 0 : 1);
  if (count === 0) throw new BodyRefusal("no_gesture");
  if (count > GESTURES_MAX) throw new BodyRefusal("too_many_gestures");
  return gestures;
}

interface AppliedV2 {
  changed: { taught: number; signed: number; vetoed: number; scoped: number; resolved: number };
  revisions: Record<string, number>;
  beliefId?: string;
  unresolved: number;
}

/** The publication state a job row maps to, with the vocabulary GET uses. */
function publicationOf(job: JobRow | undefined, revision: number): { id?: string; status: PublicationStatus; reason?: string; revision: number } {
  if (!job) return { status: "none", revision };
  const base = { id: job.id, revision, ...(job.reason ? { reason: job.reason } : {}) };
  if (job.status === "complete") return { ...base, status: "published" };
  if (job.status === "failed") return { ...base, status: "failed" };
  if (job.status === "deferred" && job.reason === "file_changed") return { ...base, status: "conflict" };
  return { ...base, status: "pending" };
}

async function postV2(body: Record<string, unknown>, locale: ReturnType<typeof localeFrom>): Promise<Response> {
  let gestures: GesturesV2;
  try {
    gestures = parseV2(body);
  } catch (error) {
    if (error instanceof BodyRefusal) return invalid(error.reason);
    throw error;
  }

  const { db: database } = await db();
  const [names, consent] = await Promise.all([projectNamesByIdentity(database), readConsent()]);

  /*
    The permission over the inferred names the generation of the publication the person looked
    at; a generation that moved — another plan, another flip — is refused before anything is
    written, and the screen re-reads. The flip itself is written after the gestures commit.
   */
  if (gestures.publishInferred !== undefined) {
    const state = await publicationState(database, { target: "TASTE" });
    if (state.revision !== gestures.expectedPublicationRevision) {
      return refusal("publication_conflict", 409, "The publication moved since it was read; read it again before changing the permission.", { currentRevision: state.revision });
    }
  }
  const inferred = gestures.publishInferred ?? publishesInferred(consent);
  // The file as it is now, read before the transaction: the cap is measured over it, never from inside.
  const file = await readTaste();

  let applied: AppliedV2;
  try {
    applied = await queueWrite(() => inTransaction(database, (tx) => applyV2(tx, gestures, names, inferred, file.lines)));
  } catch (error) {
    if (error instanceof GestureRefusal) {
      return error.code === "not_found"
        ? refusal("not_found", 404, "A gesture names a belief that is not there, or not alive.", { id: error.id })
        : refusal("stale_revision", 409, "A gesture names a revision the belief has left; nothing was applied.", {
          id: error.id, ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
        });
    }
    if (error instanceof TeachingError) {
      return error.reason === "project"
        ? refusal("not_found", 404, t(locale, "api.noProject"), { reason: "project" })
        : invalid(error.reason === "scope" ? "scope" : "teach");
    }
    if (error instanceof TasteFullError) {
      // The transaction was reversed: no signature is half-made, and the numbers say so.
      return refusal("taste_full", 409, t(locale, "taste.full", { chars: error.chars, cap: error.cap }), {
        chars: error.chars, cap: error.cap, changed: { taught: 0, signed: 0, vetoed: 0, scoped: 0, resolved: 0 },
      });
    }
    throw error;
  }

  if (gestures.publishInferred !== undefined) await setInferredConsent(gestures.publishInferred);

  // The file goes through the outbox: one plan, one turn of the pass, and the state it left.
  const plan = await planPublication(database, { target: "TASTE", origin: "manual" });
  if ("code" in plan) {
    return refusal("unavailable", 503, "The portrait could not be planned for publication; the gestures were applied.", {
      reason: plan.reason, changed: applied.changed, revisions: applied.revisions, ...(applied.beliefId ? { beliefId: applied.beliefId } : {}),
    });
  }
  await runPublicationPass(database, { max: PUBLICATIONS_PER_PASS });
  const [job, state, profile] = await Promise.all([jobById(database, plan.id), publicationState(database, { target: "TASTE" }), readTaste()]);
  const publication = publicationOf(job, state.revision);
  return Response.json({
    changed: applied.changed,
    revisions: applied.revisions,
    ...(applied.beliefId ? { beliefId: applied.beliefId } : {}),
    unresolved: applied.unresolved,
    publication,
    profile,
  }, { status: publication.status === "published" ? 200 : 202, headers: NO_STORE });
}

function written(result: BeliefWrite, id: string, current: BeliefRow | undefined): number {
  if ("conflict" in result) throw new GestureRefusal(result.reason, id, current?.memoryRev);
  return result.revision;
}

/**
 * The gestures, all or nothing, inside one transaction. Each writer is a compare-and-set on the
 * revision the gesture names; the first refusal throws and the transaction rolls back with every
 * other gesture unapplied. The cap of the portrait is measured at the end over the rows as they
 * would be published, against the file lines read before the transaction.
 */
async function applyV2(tx: Database, gestures: GesturesV2, names: Record<string, string>, inferred: boolean, file: TasteLine[]): Promise<AppliedV2> {
  const before = new Map((await listBeliefs(tx)).map((row) => [row.id, row] as const));
  const revisions: Record<string, number> = {};
  const changed = { taught: 0, signed: 0, vetoed: 0, scoped: 0, resolved: 0 };
  let beliefId: string | undefined;

  if (gestures.teach) {
    const taught = await teachV2(tx, gestures.teach, names, before);
    beliefId = taught.id;
    revisions[taught.id] = taught.revision;
    if (taught.created) changed.taught += 1;
  }
  for (const one of gestures.sign) {
    const row = before.get(one.id);
    /*
      A bare signature over an inferred criterion clears the predicates a model proposed: only a
      gesture that restates them signs them. Over a signed row, silence keeps what the owner
      already signed.
     */
    const clears = row?.state === "inferred";
    const result = await signBeliefByRevision(tx, one.id, { memoryRev: one.expectedRevision }, {
      ...(one.statement !== undefined ? { statement: one.statement } : {}),
      conditions: one.conditions !== undefined ? one.conditions : clears ? null : undefined,
      exceptions: one.exceptions !== undefined ? one.exceptions : clears ? null : undefined,
    });
    revisions[one.id] = written(result, one.id, row);
    changed.signed += 1;
  }
  for (const one of gestures.veto) {
    revisions[one.id] = written(await vetoBeliefByRevision(tx, one.id, { memoryRev: one.expectedRevision }), one.id, before.get(one.id));
    changed.vetoed += 1;
  }
  for (const one of gestures.scope) {
    const identity = await identityOf(tx, one, names);
    revisions[one.id] = written(await setBeliefScopeByRevision(tx, one.id, { memoryRev: one.expectedRevision }, identity), one.id, before.get(one.id));
    changed.scoped += 1;
  }
  for (const one of gestures.resolve) {
    // The comparison under the row lock, like the other three writers; an answer that found no heir is still an answer.
    revisions[one.id] = written(await resolveProposalByRevision(tx, one.id, { memoryRev: one.expectedRevision }, one.accept), one.id, before.get(one.id));
    changed.resolved += 1;
  }

  /*
    Everything in the database, read after the gestures: the portrait that would be published is
    measured here, over the file as it was read before the transaction, without touching the disk.
    Over the cap, the throw reverses every gesture above: no signature is half-made.
   */
  const rows = await listBeliefs(tx);
  for (const id of Object.keys(revisions)) {
    const row = rows.find((one) => one.id === id);
    if (row) revisions[id] = row.memoryRev;
  }
  for (const one of gestures.resolve) {
    const row = rows.find((candidate) => candidate.id === one.id);
    if (row) revisions[one.id] = row.memoryRev;
  }
  const merge = reconcileWithFile(rows, names, inferred, file);
  const profile = parseTaste(renderTaste(merge.lines));
  if (profile.chars > TASTE_CAP) throw new TasteFullError(profile.chars, TASTE_CAP);
  const unresolved = unresolvedPublishable(rows.filter((row) => ALIVE.includes(row.state)), names, inferred).length;
  return { changed, revisions, ...(beliefId ? { beliefId } : {}), unresolved };
}

/** The identity a scope gesture resolves to: null for everything you do, the project's for one repository that can be named. */
async function identityOf(tx: Database, one: { scope: "global" | "project"; slug?: string }, names: Record<string, string>): Promise<string | null> {
  if (one.scope === "global") return null;
  const project = await resolveProject(tx, { slug: one.slug! });
  if (!project) throw new TeachingError("project");
  if (!scopable(project.identity, names)) throw new TeachingError("scope");
  return project.identity;
}

/**
 * The teaching of version 2: the same dedupe as `teachBelief`, with the owner's predicates
 * stored on the row it creates or finds. A duplicate is signed by compare-and-set on the
 * revision it has now, so the typed clauses land on it under the same guard as any signature.
 */
async function teachV2(tx: Database, teaching: TeachV2, names: Record<string, string>, before: Map<string, BeliefRow>): Promise<{ id: string; created: boolean; revision: number }> {
  const identity = teaching.slug ? await identityOf(tx, { scope: "project", slug: teaching.slug }, names) : null;
  const key = (text: string) => text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  const duplicate = [...before.values()].find((belief) =>
    ALIVE.includes(belief.state) && belief.topic === teaching.topic && belief.identity === identity && key(belief.statement) === key(teaching.statement),
  );
  if (duplicate) {
    const result = await signBeliefByRevision(tx, duplicate.id, { memoryRev: duplicate.memoryRev }, {
      ...(teaching.conditions !== undefined ? { conditions: teaching.conditions } : {}),
      ...(teaching.exceptions !== undefined ? { exceptions: teaching.exceptions } : {}),
    });
    return { id: duplicate.id, created: false, revision: written(result, duplicate.id, duplicate) };
  }
  const [id] = await insertBeliefs(tx, [{
    topic: teaching.topic,
    statement: teaching.statement,
    identity,
    state: "signed",
    citations: [],
    support: { observations: 0, projects: 0, days: 0 },
    // Authorship, not a correction of the machine's prose: see `teachBelief`.
    model: "owner",
    ...(teaching.conditions !== undefined ? { conditions: teaching.conditions } : {}),
    ...(teaching.exceptions !== undefined ? { exceptions: teaching.exceptions } : {}),
  }]);
  // The signature date, as `teachBelief` stamps it; the state is already signed, so no revision moves.
  await signBelief(tx, id!);
  const row = (await listBeliefs(tx)).find((one) => one.id === id);
  return { id: id!, created: true, revision: row?.memoryRev ?? 1 };
}
