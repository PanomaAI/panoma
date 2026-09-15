import {
  consentState,
  grantFor,
  inventoryHistory,
  isAllowed,
  readConsent,
  readableSources,
  setConsent,
  setGrant,
  type ConsentGrant,
  type ConsentState,
  type GrantPurpose,
  type GrantScope,
  type HistorySourceId,
  type TwinConsent,
} from "@panoma/core";
import { jobById, listProjects, liveJobsFor, obsoleteJobs, queueWrite, resolveProject, type Database } from "@panoma/db";
import { NO_STORE, memoryRefusal, unknownProperty } from "@/lib/agent-channel";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";
import { CAPTURE_SOURCES } from "@/lib/memory-view";

/**
 * The first gesture of all: what stories are in this machine and which ones can be opened.
 *
 * It was missing, and it was the hole in the first screen. `panoma twin sources` measures the disk
 * without opening anything and `panoma twin allow <fuente>` saves the yes, but both things were
 * only from the terminal — so the portrait screen, with the empty catalog, could do nothing more
 * than send you to type a command. A product whose first step is a terminal command does not have
 * a first step: it has a prerequisite.
 *
 * ── It is measured without opening a single file ───────────────────────────────────────────
 *
 * `inventoryHistory` uses `stat`: it counts files and bytes and doesn't read a single line. That
 * distinction is what supports this entire screen — you can say "Claude Code: 778 files, 1.7 GB"
 * **before** having permission to open them, and without it the permission would be requested in
 * the abstract. No one decides on "your history"; it is decided on 1.7 GB with a name in front.
 *
 * ── The yes is by source, and the no is the default value ────────────────────────
 *
 * Reading Claude Code is not reading Codex: they are different tools, often from different
 * clients. The full reason is in header of `history/consent.ts`. What matters here is that the
 * POST touches **one** source and never all: a 'allow all' button turns five decisions into one,
 * and whoever has to choose between everything and nothing chooses wrong.
 *
 * ── You can look from the phone; decide, no ──────────────────────────────────
 *
 * The GET carries only `sameOrigin`, and the POST also carries `localOperatorOnly`. The asymmetry
 * is the doctrine of `lib/guard.ts` applied to the most intimate case there is: the key of
 * `panoma up --network` allows **viewing** the catalog from the mobile, not putting hands on this
 * machine's keyboard. To see what stories exist and the state of each permission is to view.
 * Granting one is deciding that this computer opens 1.78 GB of private conversation, and nobody
 * who is not sitting in front of it does that. The key travels in a link and stays on the
 * clipboard of the person who shares it, so 'having the key' does not mean 'being the person'.
 *
 * ── Revoking does not erase ────────────────────────────────────────────────────────────
 *
 * Removing permission closes the door and leaves inside what has already entered. It is the truth
 * and it must be said on the screen itself, because the word "revoke" promises something else;
 * what it erases is `panoma twin forget`. Half a promise on a privacy screen is a false promise.
 *
 * ── The grants, since the memory contract v2 ──────────────────────────────────────────────
 *
 * The base permission says whether a source may be opened at all. A grant says what for and
 * where (plan §7.1, §23.3.1): `memoryCapture` lets the capture pass open the source's
 * transcripts of one project —or of every project, when the person chooses `global` with all
 * the letters— and `memoryExtract` lets the paid processor send the human fragments of what was
 * captured to the provider. The POST keeps the legacy body `{ source, allowed }` untouched and
 * adds the alternative `{ source, purpose, scope, slug?, allowed, expectedRevision?,
 * noticeVersion }`: a project grant needs the slug and the server resolves it to the project's
 * identity, a global one forbids it, and omitting `scope` is a refusal, never a global
 * permission. The alternative needs the local catalog (the grant names this disk's transcripts),
 * the base permission first (`consent_required`), a source the reader can actually read
 * (`unsupported_source`: the `CAPTURE_SOURCES` set of `lib/memory-view.ts`, which is the
 * screen's word on where a switch may be drawn) and, when the client says what it saw, the
 * generation it saw (`stale_revision`). Those refusals are the machine shape `{ code, error }`,
 * because the CLI reads them too; the histories card translates the code (`captureRefusalKey`).
 *
 * ── Two notices, one generation ───────────────────────────────────────────────────────────
 *
 * A capture grant at notice version 1 authorises receipts and lifecycle records; version 2 also
 * authorises the typed facts of delivery B (reads, edits, command families, test outcomes —
 * never a line of text). Raising the version is an explicit re-consent and nothing else: the
 * generation does not move, so the reader's frontiers stay where they were and the facts start
 * at the end of each stream as it is when version 2 is accepted (`consent.ts`, `memory-capture.ts`).
 * A revocation carries whatever notice the client sends and stores none of it: the grant keeps
 * the version the person accepted, because taking a permission back is not accepting a smaller
 * one. `memoryExtract` has its own grant, at notice 1 in this delivery, and it is granted only
 * on top of an enabled capture for the same scope (`consent_required` otherwise): a process
 * that may not observe may not extract.
 *
 * ── The third grant: the Twin learns on its own (delivery D) ──────────────────────────────
 *
 * `twinAutoLearn` lets the worker distil the new human turns of a scope into observations of
 * the Twin, classify the ones left without a topic and synthesize the topics that moved, in
 * batches it pays for on its own inside the `read` cap (plan §10.5, §23.5). It is granted like
 * the extraction: on top of an enabled capture of the same scope (`consent_required`
 * otherwise), with its own notice (version 1 in this delivery) and its own frontier — the
 * `twin_extract` cursor of the capture pass, never the extraction's — and it never touches the
 * publication switch: learning and publishing are two acts, and `publishInferred` stays where
 * it was. A grant of extraction alone starts no learning, and a grant of learning alone starts
 * no extraction (T62): each purpose opens exactly its cursor.
 *
 * ── Revoking fences the work in flight (T76), one family at a time ────────────────────────
 *
 * Switching a grant off makes the jobs it authorized obsolete in one short transaction right
 * after the consent write: a staged answer that was paid for under the old permission becomes
 * unpublishable the moment the grant is off, before any worker gets to re-validate it. The
 * fence names the projects the revocation reaches — the one project, or for a global grant
 * every project the revocation leaves without an effective grant of that purpose — and the
 * processors that purpose authorizes, and nothing else: revoking the extraction finishes
 * `project_extract` jobs and leaves the Twin's running; revoking the learning finishes the
 * three `twin_*` processors and leaves the extraction running; revoking the capture, or the
 * source itself, finishes both, because both depend on it. Only jobs of the revoked harness:
 * the legacy distiller's jobs never depended on a capture grant, and a revocation of one
 * harness says nothing about the other's. What a revocation of the learning never touches is
 * the person's own word: signed criteria, published criteria and direct teaching stay exactly
 * as they were. The worker's own re-validation at publish stays the last line of defence.
 *
 * The GET lists every grant with its project's slug, so the screen can show each concession
 * where it was made, says per source whether a reader exists for it (`captureSupported`, from
 * the same set), and with `?slug=` describes the effective permissions of that project per
 * source and purpose — without a slug, the global ones (plan §23.3.1).
 */

/** What is taught from each story. None of this requires having opened a file. */
export interface SourceView {
  id: HistorySourceId;
  label: string;
  path: string;
  present: boolean;
  files: number;
  bytes: number;
  state: ConsentState;
  /** Whether this version reads receipts from the source: the capture grant is offered only where it is true. */
  captureSupported: boolean;
}

/** A grant as the screen and the CLI see it: the project by its slug, never by its identity string. */
export interface GrantView {
  grantId: string;
  source: HistorySourceId;
  purpose: ConsentGrant["purpose"];
  scope: ConsentGrant["scope"];
  slug?: string;
  allowed: boolean;
  permissionRevision: number;
  noticeVersion: number;
}

/** One purpose of one source for the scope asked: whether it is effectively allowed, and the grant of exactly that scope. */
export interface PurposePermission {
  /** The effective answer under plan §25.1 precedence: the source floor, the explicit project grant over the global one, capture before a semantic purpose. */
  allowed: boolean;
  /** Which grant decides the answer: the project's own, the global one, or none. */
  decidedBy: GrantScope | null;
  /** The generation of the grant of exactly the scope asked (the project's for a slug, the global one without), for `expectedRevision`; 0 when none exists. */
  permissionRevision: number;
  /** The notice version of that same grant; 0 when none exists. */
  noticeVersion: number;
}

/** The permissions of one source for the scope asked (plan §23.3.1). */
export interface SourcePermissions {
  sourceAllowed: boolean;
  memoryCapture: PurposePermission;
  memoryExtract: PurposePermission;
  twinAutoLearn: PurposePermission;
}

interface Snapshot {
  sources: SourceView[];
  grants: GrantView[];
  permissions: Record<string, SourcePermissions>;
  updatedAt?: string;
}

const GRANT_KEYS = ["source", "purpose", "scope", "slug", "allowed", "expectedRevision", "noticeVersion"] as const;
const QUERY_KEYS = ["slug"] as const;
const SLUG = /^[A-Za-z0-9._-]{1,200}$/;
/** The purposes this delivery grants, with the notice versions each one may be accepted at. */
const NOTICE_VERSIONS: Record<GrantPurpose, readonly number[]> = { memoryCapture: [1, 2], memoryExtract: [1], twinAutoLearn: [1] };
const PURPOSES: readonly GrantPurpose[] = ["memoryCapture", "memoryExtract", "twinAutoLearn"];
/** The two purposes granted on top of capture, and what they say about themselves when the capture is missing. */
const ON_TOP_OF_CAPTURE: Record<"memoryExtract" | "twinAutoLearn", { does: string; hint: string }> = {
  memoryExtract: { does: "extraction is granted on top of capture", hint: "Grant the capture for the same scope first, then the extraction." },
  twinAutoLearn: { does: "the Twin learns on top of capture", hint: "Grant the capture for the same scope first, then the learning." },
};
/** The paid processors of each purpose granted on top of capture: the ones its revocation fences (T76). */
const PROCESSORS_OF: Record<"memoryExtract" | "twinAutoLearn", ReadonlySet<string>> = {
  memoryExtract: new Set(["project_extract"]),
  twinAutoLearn: new Set(["twin_distill", "twin_classify", "twin_synthesize"]),
};
/** Which families a revocation reaches: its own, or both when the capture underneath them goes. */
const FENCED_BY: Record<GrantPurpose, readonly ("memoryExtract" | "twinAutoLearn")[]> = {
  memoryCapture: ["memoryExtract", "twinAutoLearn"],
  memoryExtract: ["memoryExtract"],
  twinAutoLearn: ["twinAutoLearn"],
};
/** The scope key of a global grant, and of a question asked without a slug. */
const GLOBAL_KEY = "*";

function scopeKeyOf(project: { id: string; identity?: string | null }): string {
  return project.identity ?? project.id;
}

/** The grant of exactly this scope: a project grant naming the key alone, or the global one. */
function exactGrant(grants: ConsentGrant[], source: HistorySourceId, purpose: GrantPurpose, scope: GrantScope, scopeKey: string): ConsentGrant | undefined {
  return grants.find((grant) =>
    grant.source === source && grant.purpose === purpose && grant.scope === scope
    && grant.scopeKeys.length === 1 && grant.scopeKeys[0] === scopeKey);
}

/** The grant that decides a purpose for a key under plan §25.1: an explicit project grant (a disabled one first), else the global one. */
function decidingGrant(grants: ConsentGrant[], source: HistorySourceId, purpose: GrantPurpose, scopeKey: string): ConsentGrant | undefined {
  const own = grants.filter((grant) => grant.source === source && grant.purpose === purpose);
  const explicit = own.filter((grant) => grant.scope === "project" && grant.scopeKeys.includes(scopeKey));
  if (explicit.length > 0) return explicit.find((grant) => !grant.enabled) ?? explicit[0];
  return own.find((grant) => grant.scope === "global");
}

function permissionsOf(consent: TwinConsent, source: HistorySourceId, scopeKey: string): SourcePermissions {
  const grants = consent.grants ?? [];
  const scope: GrantScope = scopeKey === GLOBAL_KEY ? "global" : "project";
  const purpose = (name: GrantPurpose): PurposePermission => {
    const deciding = decidingGrant(grants, source, name, scopeKey);
    const exact = exactGrant(grants, source, name, scope, scopeKey);
    return {
      allowed: grantFor(consent, source, name, scopeKey) !== undefined,
      decidedBy: deciding?.scope ?? null,
      permissionRevision: exact?.generation ?? 0,
      noticeVersion: exact?.noticeVersion ?? 0,
    };
  };
  return {
    sourceAllowed: isAllowed(consent, source),
    memoryCapture: purpose("memoryCapture"),
    memoryExtract: purpose("memoryExtract"),
    twinAutoLearn: purpose("twinAutoLearn"),
  };
}

async function grantViews(consent: TwinConsent): Promise<GrantView[]> {
  const grants = consent.grants ?? [];
  if (grants.length === 0) return [];
  const slugs = new Map<string, string>();
  for (const project of await listProjects((await db()).db)) {
    slugs.set(project.id, project.slug);
    if (project.identity) slugs.set(project.identity, project.slug);
  }
  return grants.map((grant) => {
    const slug = grant.scope === "project" ? grant.scopeKeys.map((key) => slugs.get(key)).find((one) => one !== undefined) : undefined;
    return {
      grantId: grant.grantId,
      source: grant.source,
      purpose: grant.purpose,
      scope: grant.scope,
      ...(slug !== undefined ? { slug } : {}),
      allowed: grant.enabled,
      permissionRevision: grant.generation,
      noticeVersion: grant.noticeVersion,
    };
  });
}

/** The inventory, every grant, and the permissions of the scope asked — the global ones when no project is named. */
async function snapshot(scopeKey: string = GLOBAL_KEY): Promise<Snapshot> {
  const [found, consent] = await Promise.all([inventoryHistory(), readConsent()]);
  const readable = readableSources();

  const sources = found.map((source) => ({
    id: source.id,
    label: source.label,
    path: source.path,
    present: source.present,
    files: source.files,
    bytes: source.bytes,
    state: consentState(source, isAllowed(consent, source.id), readable.includes(source.id)),
    captureSupported: CAPTURE_SOURCES.has(source.id),
  }));
  const permissions: Record<string, SourcePermissions> = {};
  for (const source of found) permissions[source.id] = permissionsOf(consent, source.id, scopeKey);

  return { sources, grants: await grantViews(consent), permissions, ...(consent.updatedAt ? { updatedAt: consent.updatedAt } : {}) };
}

export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const query = new URL(request.url).searchParams;
  const unknown = [...query.keys()].find((key) => !(QUERY_KEYS as readonly string[]).includes(key));
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known query parameter.`, 400);
  const slug = query.get("slug") ?? undefined;
  if (slug !== undefined && !SLUG.test(slug)) return memoryRefusal("invalid_input", "slug is not a project slug.", 400);

  let scopeKey = GLOBAL_KEY;
  if (slug !== undefined) {
    const project = await resolveProject((await db()).db, { slug });
    if (!project) return memoryRefusal("not_found", "No project has that slug.", 404);
    scopeKey = scopeKeyOf(project);
  }
  return Response.json(await snapshot(scopeKey), { headers: NO_STORE });
}

/**
 * The fence of a revocation (T76): the paid jobs the revoked grant leaves without an effective
 * permission are finished `obsolete` in one short transaction, staged answers dropped. One
 * family per purpose — `project_extract` for the extraction, the three `twin_*` processors for
 * the learning — and both when the capture or the source itself goes; only jobs of the revoked
 * harness, and never the legacy distiller's. Returns how many jobs this call finished.
 */
async function fenceJobs(
  database: Database,
  consent: TwinConsent,
  source: HistorySourceId,
  scope: GrantScope,
  project: { id: string; identity: string | null } | undefined,
  revoked: GrantPurpose,
): Promise<number> {
  const projects = scope === "project" && project !== undefined ? [] : await listProjects(database);
  const plans: { processors: ReadonlySet<string>; projectIds: string[]; scopeKeys: string[] }[] = [];
  for (const purpose of FENCED_BY[revoked]) {
    const projectIds: string[] = [];
    const scopeKeys: string[] = [];
    if (scope === "project" && project !== undefined) {
      projectIds.push(project.id);
      scopeKeys.push(scopeKeyOf(project));
    } else {
      // Every project the global revocation leaves without that purpose; one with its own enabled grants keeps its work.
      for (const one of projects) {
        const key = scopeKeyOf(one);
        if (grantFor(consent, source, purpose, key) !== undefined) continue;
        projectIds.push(one.id);
        scopeKeys.push(key);
      }
    }
    if (projectIds.length > 0) plans.push({ processors: PROCESSORS_OF[purpose], projectIds, scopeKeys });
  }
  if (plans.length === 0) return 0;
  return queueWrite(() => database.transaction(async (tx) => {
    const fenced = new Set<string>();
    for (const plan of plans) {
      for (const id of await liveJobsFor(tx, { scopeKeys: plan.scopeKeys, projectIds: plan.projectIds })) {
        if (fenced.has(id)) continue;
        const job = await jobById(tx, id);
        if (job === undefined || !plan.processors.has(job.processor)) continue;
        const snapshot = (job.inputManifest as { permissionSnapshot?: { harness?: unknown } } | null)?.permissionSnapshot;
        // A manifest of another harness keeps its permission; one that names none is fenced, conservatively.
        if (typeof snapshot?.harness === "string" && snapshot.harness !== source) continue;
        fenced.add(id);
      }
    }
    return obsoleteJobs(tx, fenced, "permission_revoked");
  }));
}

/**
 * The grant alternative of the POST: everything checked before anything is written, and each
 * refusal with the code the screen translates and the CLI prints.
 */
async function grantRequest(body: Record<string, unknown>): Promise<Response> {
  if (process.env["DATABASE_URL"]) {
    return memoryRefusal("local_catalog_required", "A capture grant names this machine's transcripts and needs the local catalog.", 403);
  }
  const unknown = unknownProperty(body, GRANT_KEYS);
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known property.`, 400);
  const { source, purpose, scope, slug, allowed, expectedRevision, noticeVersion } = body;
  const versions = typeof purpose === "string" && PURPOSES.includes(purpose as GrantPurpose) ? NOTICE_VERSIONS[purpose as GrantPurpose] : undefined;
  if (versions === undefined) return memoryRefusal("invalid_input", "purpose must be memoryCapture, memoryExtract or twinAutoLearn.", 400);
  if (typeof source !== "string") return memoryRefusal("invalid_input", "source must name a history source.", 400);
  if (scope !== "project" && scope !== "global") return memoryRefusal("invalid_input", "scope must be project or global; omitting it never means global.", 400);
  if (typeof allowed !== "boolean") return memoryRefusal("invalid_input", "allowed must be true or false.", 400);
  if (typeof noticeVersion !== "number" || !versions.includes(noticeVersion)) {
    return memoryRefusal("invalid_input", `noticeVersion must be ${versions.join(" or ")} for ${String(purpose)}: the notices this version shows.`, 400);
  }
  if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0)) {
    return memoryRefusal("invalid_input", "expectedRevision must be the permissionRevision the client saw.", 400);
  }
  if (scope === "global" && slug !== undefined) return memoryRefusal("invalid_input", "A global grant names no slug: it covers every project on purpose.", 400);
  if (scope === "project" && (typeof slug !== "string" || !SLUG.test(slug))) return memoryRefusal("invalid_input", "A project grant names the project by its slug.", 400);

  const found = await inventoryHistory();
  const known = found.find((one) => one.id === source);
  if (known === undefined) return memoryRefusal("invalid_input", `${source} is not a history source of this machine.`, 400);

  const database = (await db()).db;
  let scopeKey = GLOBAL_KEY;
  let project: { id: string; identity: string | null } | undefined;
  if (scope === "project") {
    const row = await resolveProject(database, { slug: slug as string });
    if (!row) return memoryRefusal("not_found", "No project has that slug.", 404);
    project = { id: row.id, identity: row.identity };
    scopeKey = scopeKeyOf(project);
  }
  const scopeKeys = [scopeKey];
  const granted = purpose as GrantPurpose;

  const consent = await readConsent();
  if (allowed && !isAllowed(consent, known.id)) {
    return memoryRefusal("consent_required", `${known.id} is not allowed as a source yet; the base permission comes first.`, 409, "Allow the source, then grant the capture.");
  }
  if (allowed && !CAPTURE_SOURCES.has(known.id)) {
    return memoryRefusal("unsupported_source", `No receipt reader exists for ${known.id} in this version.`, 409);
  }
  if (allowed && granted !== "memoryCapture" && grantFor(consent, known.id, "memoryCapture", scopeKey) === undefined) {
    const { does, hint } = ON_TOP_OF_CAPTURE[granted];
    return memoryRefusal("consent_required", `No enabled memoryCapture grant of ${known.id} covers that scope; ${does}.`, 409, hint);
  }
  const current = exactGrant(consent.grants ?? [], known.id, granted, scope, scopeKey);
  if (expectedRevision !== undefined && expectedRevision !== (current?.generation ?? 0)) {
    return memoryRefusal("stale_revision", `The grant is at revision ${current?.generation ?? 0}, not ${String(expectedRevision)}.`, 409, "Read the grants again before deciding.");
  }

  // A revocation accepts no notice: the grant keeps the version the person accepted.
  const accepted = allowed ? noticeVersion : (current?.noticeVersion ?? noticeVersion);
  const { consent: after, grant } = await setGrant({ source: known.id, purpose: granted, scope, scopeKeys, enabled: allowed, noticeVersion: accepted });
  const jobsObsoleted = allowed ? undefined : await fenceJobs(database, after, known.id, scope, project, granted);
  return Response.json({
    ...(await snapshot(scopeKey)),
    permissionRevision: grant.generation,
    ...(jobsObsoleted !== undefined ? { jobsObsoleted } : {}),
  }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  // You can look from the network; granting, only from this machine. See the header.
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  const body = (await request.json().catch(() => ({}))) as {
    source?: unknown;
    allowed?: unknown;
    purpose?: unknown;
  };
  // The grant alternative; the legacy body below never carries a purpose.
  if (body !== null && typeof body === "object" && !Array.isArray(body) && body.purpose !== undefined) {
    return grantRequest(body as Record<string, unknown>);
  }

  /*
    The two mandatory keys with no default value for either. A missing `allowed` taken as `true`
    would grant access to someone's history due to a poorly constructed body, and that is the only
    flaw in this path from which there is no return: when it is discovered, it has already been
    read. A missing `source` cannot fall into 'all' for the same reason.
   */
  const source = typeof body.source === "string" ? body.source : undefined;
  const allowed = typeof body.allowed === "boolean" ? body.allowed : undefined;
  if (source === undefined || allowed === undefined) {
    return Response.json({ error: t(locale, "twin.consentMalformed") }, { status: 400 });
  }

  /*
    And the source has to be one of those named in the inventory. `setConsent` already rules out
    what it doesn't know —the asymmetry documented in `consent.ts` — but silently ruling it out
    here would respond "done" about a permission that was not saved.
   */
  const found = await inventoryHistory();
  const known = found.find((one) => one.id === source);
  if (known === undefined) {
    return Response.json(
      { error: t(locale, "twin.consentUnknown", { source }) },
      { status: 400 },
    );
  }

  const after = await setConsent(known.id, allowed);
  /*
    The source permission is the floor under every grant of the source: taking it back leaves the
    extraction and the learning of every project without an effective grant, so the same fence
    as a capture revocation runs, for both families, over every project. Granting it back changes
    nothing here — the grants come back with a new generation (`consent.ts`) and the cursors
    start a new frontier — so the answer keeps the shape it always had.
   */
  const jobsObsoleted = allowed ? undefined : await fenceJobs((await db()).db, after, known.id, "global", undefined, "memoryCapture");
  return Response.json({
    ...(await snapshot()),
    ...(jobsObsoleted !== undefined ? { jobsObsoleted } : {}),
  }, { headers: NO_STORE });
}
