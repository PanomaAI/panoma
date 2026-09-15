import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/*
  Memory revisions, in one sentence: every row an agent may receive carries `memory_rev`, a
  counter that moves only when the content, authority, scope, standing or membership of that row
  changes — never when it is merely delivered or counted. A write that changes one of those things
  compares the revision it read (`update … where memory_rev = expected`) and increments it, and in
  the same transaction photographs the row into `memory_revisions`. The domain table keeps the
  current state; the photograph is what an offer, a receipt or a dependency can name exactly.
  `docs/memory.md` and `private/memory-build-plan.md` (§11, §22) hold the whole argument.
 */

/** `scope_kind`: an explicit global, a project, or unresolved — which never grants global reach. */
const SCOPE_KINDS = sql`'global', 'project', 'unresolved'`;

/** Installed programs and their work survive catalog rescans and project retirement. */
export const apps = pgTable("apps", {
  id: text("id").primaryKey(),
  pkg: text("pkg").notNull(),
  version: text("version"),
  stagedVersion: text("staged_version"),
  previousVersion: text("previous_version"),
  protocol: text("protocol"),
  status: text("status").notNull().default("absent"),
  enabled: boolean("enabled").notNull().default(true),
  manifest: jsonb("manifest"),
  requirements: jsonb("requirements"),
  requirementsAt: timestamp("requirements_at", { withTimezone: true }),
  settings: jsonb("settings").$type<{ brain: string; voice: boolean }>()
    .notNull().default({ brain: "none", voice: false }),
  error: text("error"),
  installedAt: timestamp("installed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appJobs = pgTable("app_jobs", {
  id: text("id").primaryKey(),
  appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
  identity: text("identity").notNull(),
  workspaceId: text("workspace_id"),
  tool: text("tool").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  status: text("status").$type<"pending" | "running" | "cancelling" | "cancelled" | "failed" | "done">()
    .notNull().default("pending"),
  progress: jsonb("progress").$type<{
    stage: string; progress: number; total?: number; message: string; at: string;
  }>(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  error: text("error"),
  appVersion: text("app_version").notNull(),
  pid: integer("pid"),
  dedupeKey: text("dedupe_key").notNull(),
  /** Reserved before launch, released only after a receipt; unknown paid work stays charged. */
  reservedCalls: integer("reserved_calls").notNull().default(0),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /**
   * The agent that asked for it over the MCP channel (`panoma_video`), by the name its key was
   * issued under; `null` when a person did, from the screen or the terminal. The same word the
   * `handoffs` table keeps, for the same reason: attribution, not authority — the job's gate is
   * the operator's, and its budget is the person's settings whoever asked.
   */
  requestedBy: text("requested_by"),
}, (table) => [
  index("app_jobs_identity_idx").on(table.identity, table.requestedAt),
  index("app_jobs_status_idx").on(table.status),
  uniqueIndex("app_jobs_dedupe_live").on(table.dedupeKey)
    .where(sql`status in ('pending', 'running', 'cancelling')`),
]);

export const appWorkspaces = pgTable("app_workspaces", {
  appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
  identity: text("identity").notNull(),
  workspaceId: text("workspace_id").notNull(),
  rootAtCreation: text("root_at_creation").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.appId, table.identity] })]);

/**
 * Catalog outline.
 *
 * Two decisions that condition everything else:
 *
 * 1. **`snapshots` is append-only.** We never update an analysis, we insert a new one. It costs
 * more rows and in exchange gives the project's timeline for free ("in March you were using
 * Riverpod 2.4, today 2.6") and allows reprocessing of the history when the engine is improved.
 *
 * 2. **Identifiers are deterministic** (hash of the path, `ecosistema:name`, the rule id). This
 * turns ingestion into pure upserts: no prior reads, no duplicate ids when rescanning, and
 * rescanning is idempotent by design.
 */

export const projects = pgTable(
  "projects",
  {
    /** sha1 of the absolute path. */
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /**
     * Identifier of the URL. **Unique**, guaranteed by the intake.
     *
     * It comes from the name manifest, and the copies share manifest: in this catalog there were
     * ten slugs spread across fifty-three folders, twenty of them called `kiosk-new`. With that,
     * `/p/kiosk-new` would open a different folder according to the query plan, and anything
     * saved against a project would be written in one and read from another. See `assignSlugs` in
     * `ingest.ts`.
     */
    slug: text("slug").notNull().unique(),
    root: text("root").notNull().unique(),
    /**
     * Stable identity of the project, which survives moving the folder.
     *
     * `id` is the sha1 of the path and that is why it fails when renaming; this comes from the
     * root commit of the repository. User decisions hang from here, not from `id`. See
     * `packages/core/src/identity.ts` and the table `decisions`.
     */
    identity: text("identity"),
    description: text("description"),
    version: text("version"),
    /** Real app icon, embedded as a data URI so that the catalog is portable. */
    iconDataUri: text("icon_data_uri"),
    /**
     * sha1 of the icon. It is used to recognize template icons: the same file byte by byte in six
     * unrelated apps is not the logo of any of them.
     */
    iconHash: text("icon_hash"),
    primaryLanguage: text("primary_language"),
    healthScore: integer("health_score").notNull().default(0),
    healthGrade: text("health_grade").notNull().default("F"),
    sourceBytes: integer("source_bytes").notNull().default(0),
    fileCount: integer("file_count").notNull().default(0),

    gitBranch: text("git_branch"),
    gitRemoteUrl: text("git_remote_url"),
    gitCommitCount: integer("git_commit_count"),
    lastCommitAt: timestamp("last_commit_at", { withTimezone: true }),

    /**
     * What it is about, and where the phrase came from.
     *
     * `description` keeps what manifest says exactly; `summary` keeps what needs to be taught,
     * which is not the same when manifest shows «A new Flutter project».
     */
    summary: text("summary"),
    /** `manifiesto` · `readme` · `compuesta` */
    summarySource: text("summary_source"),
    /** The paragraph of README, even if it is not the chosen sentence. */
    summaryReadme: text("summary_readme"),
    /** The sentence composed with the facts, always available to teach it alongside. */
    summaryComposed: text("summary_composed"),
    /**
     * And its pieces, so the sentence can be written in the viewer's language.
     *
     * `summary_composed` is the same phrase already written, in English, and it is what the
     * terminal and the MCP server—both monolingual—read. The web cannot use it: it shows that
     * description in the record of the worst-documented projects, which in a real disk are the
     * majority, and a Spanish-speaking reader received English (and before August 25, 2026, the
     * other way around).
     *
     * The composition is saved and is not recalculated when rendering because the pieces come from
     * things that the record query does not bring: deep links, distributions, and the allocation
     * of the history among agents. Form: `{ kind, stack[], services[], stores[], topAgent? }`.
     */
    summaryComposition: jsonb("summary_composition"),
    /**
     * Where the project came from: `own`, `bifurcado`, `ajeno`, `plantilla`, `sin-señales`.
     *
     * The verdict is kept along with its reasons because for almost everyone the answer is 'own,'
     * and a verdict without reasons is indistinguishable from a default value. See
     * `packages/core/src/provenance.ts`.
     */
    originKind: text("origin_kind"),
    originStartedBy: text("origin_started_by"),
    /** Proportion of the history written by the catalog owner, 0..1. */
    originShare: real("origin_share"),
    originEvidence: jsonb("origin_evidence"),

    /**
     * How it is installed, started, and tested, with what the project itself declares.
     *
     * Its own column and not a corner of the snapshot: it's the first thing you read when opening
     * the file of a dormant project, and taking it out of a two-hundred-kilobyte JSONB to display
     * four commands doesn't make sense.
     */
    runbook: jsonb("runbook"),
    /** Latest commits, to remember what you were working on. */
    recentCommits: jsonb("recent_commits"),
    /**
     * The agents' instruction file (AGENTS.md/CLAUDE.md), reviewed against the reality of the
     * disk: weight in tokens, statements that are no longer true, whether it carries the managed
     * block, and who touched it. Own column because the record displays it upon opening and
     * because the notice 'your agent wrote this' cannot live buried in a snapshot. It is written
     * by the scan; format in `AgentsMdReport` from @panoma/core.
     */
    agentsMd: jsonb("agents_md"),

    /**
     * State of the working tree in the last scan.
     *
     * They go as columns and not inside the snapshot because they are the only part of the
     * analysis for which the entire catalog **is sorted and filtered**: 'show me everything I can
     * lose' has to be a query, not a walk through eighty JSON.
     *
     * Nulls on purpose when scanned with `--no-git`: “we don’t know” and “there is nothing
     * pending” are different answers, and showing the second when the first applies is exactly the
     * way to make sure no one trusts this panel again.
     *
     * `git_versioned`: `false` = there is no repository here. Null = it was scanned without
     * looking at git.
     */
    gitVersioned: boolean("git_versioned"),
    gitModified: integer("git_modified"),
    gitUntracked: integer("git_untracked"),
    gitAhead: integer("git_ahead"),
    gitBehind: integer("git_behind"),
    gitStashes: integer("git_stashes"),
    gitOwnRepo: boolean("git_own_repo"),

    /** Summary of the enrichment, so as not to recalculate it in each query. */
    directDeps: integer("direct_deps").notNull().default(0),
    outdatedDeps: integer("outdated_deps").notNull().default(0),
    /**
     * Which lockfile could not be read, if any. Null means that all were read.
     *
     * It is what separates 'I looked and there is nothing' from 'I didn't know how to look,' and
     * without it both things are written the same on screen: a `0`. To know if a dependency has a
     * security notice, you need its exact version, and that comes from the lock; when the file
     * cannot be opened — today only `bun.lockb`, which is binary, and a corrupted lock — OSV is
     * not asked anything and the counter remains at zero for not having asked.
     *
     * The file name is saved and not a boolean because on the screen the difference between
     * 'unchecked' and 'unchecked: bun.lockb' is the difference between a warning and an
     * instruction. With several ecosystems, both are shown, separated by a comma.
     */
    depsUnresolved: text("deps_unresolved"),
    majorBehind: integer("major_behind").notNull().default(0),
    vulnCount: integer("vuln_count").notNull().default(0),
    vulnCritical: integer("vuln_critical").notNull().default(0),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),

    /**
     * Disk usage, measured in a separate pass (`panoma disk`).
     *
     * It doesn't enter the scan because going through the entire tree of eighty projects —with
     * their `node_modules` and their `build` of seven gigs— multiplies by four the time it takes,
     * to answer a question that is asked once a month and not once a day.
     */
    // `bigint` and not `integer`: a single Flutter project with its `build/` exceeds 9 GB, and the
    // PostgreSQL `integer` runs out at 2.1. An overflow here would not give an error, it would
    // display a negative number of gigabytes on the screen.
    diskTotalBytes: bigint("disk_total_bytes", { mode: "number" }),
    diskReclaimableBytes: bigint("disk_reclaimable_bytes", { mode: "number" }),
    /** Each recoverable folder with its size and why it is considered disposable. */
    diskDirs: jsonb("disk_dirs"),
    diskMeasuredAt: timestamp("disk_measured_at", { withTimezone: true }),

    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("projects_health_idx").on(table.healthScore),
    index("projects_last_commit_idx").on(table.lastCommitAt),
  ],
);

export const snapshots = pgTable(
  "snapshots",
  {
    /** sha1(ruta + instante de escaneo). */
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull(),
    commitSha: text("commit_sha"),
    engineVersion: text("engine_version").notNull(),
    healthScore: integer("health_score").notNull(),
    /** The complete analysis. It allows reprocessing without touching the disc again. */
    report: jsonb("report").notNull(),
  },
  (table) => [index("snapshots_project_idx").on(table.projectId, table.scannedAt)],
);

/** Canonical catalog of technologies. The id is that of the engine rule (`flutter`, `nextjs`). */
export const technologies = pgTable("technologies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  iconSlug: text("icon_slug"),
});

export const projectTechnologies = pgTable(
  "project_technologies",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    technologyId: text("technology_id")
      .notNull()
      .references(() => technologies.id, { onDelete: "cascade" }),
    version: text("version"),
    confidence: real("confidence").notNull(),
    /** Why we detect it. It is what allows explaining —and correcting— a detection. */
    evidence: jsonb("evidence").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.technologyId] }),
    index("project_technologies_tech_idx").on(table.technologyId),
  ],
);

/**
 * Canonical packages, shared between projects.
 *
 * When 15 projects use `dio`, this is one row, not fifteen. Convert future enrichment (latest
 * versions, OSV) from O(projects × deps) to O(unique packages) — the difference between a viable
 * API invoice and an unviable one.
 */
export const packages = pgTable(
  "packages",
  {
    /** `ecosistema:name`. */
    id: text("id").primaryKey(),
    ecosystem: text("ecosystem").notNull(),
    name: text("name").notNull(),
    /** They are filled in from public records. */
    latestVersion: text("latest_version"),
    latestCheckedAt: timestamp("latest_checked_at", { withTimezone: true }),
    /** The record responded 'does not exist': avoid retrying it each time. */
    unresolvable: boolean("unresolvable").notNull().default(false),
    deprecated: boolean("deprecated").notNull().default(false),
    license: text("license"),
  },
  (table) => [
    index("packages_ecosystem_idx").on(table.ecosystem),
    index("packages_checked_idx").on(table.latestCheckedAt),
  ],
);

/**
 * Security notice, as published by OSV.dev.
 *
 * The id is that of OSV (`GHSA-…`, `PYSEC-…`, `RUSTSEC-…` ), so the table is naturally idempotent
 * and shared between projects.
 */
export const advisories = pgTable("advisories", {
  id: text("id").primaryKey(),
  summary: text("summary").notNull(),
  severity: text("severity").notNull().default("unknown"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  url: text("url"),
  /** Versions that fix the problem, if the notice declares them. */
  fixedVersions: jsonb("fixed_versions"),
});

/**
 * Which specific version of which package is affected.
 *
 * We keep the version consulted —not a range— because it is what we asked OSV and the only thing
 * we can assert without re-implementing the range resolution of each ecosystem. A project is at
 * risk if its `resolved_version` appears here.
 */
export const vulnerabilities = pgTable(
  "vulnerabilities",
  {
    packageId: text("package_id")
      .notNull()
      .references(() => packages.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    advisoryId: text("advisory_id")
      .notNull()
      .references(() => advisories.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.packageId, table.version, table.advisoryId] }),
    index("vulnerabilities_package_idx").on(table.packageId, table.version),
  ],
);

export const projectDependencies = pgTable(
  "project_dependencies",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    packageId: text("package_id")
      .notNull()
      .references(() => packages.id, { onDelete: "cascade" }),
    constraint: text("constraint").notNull(),
    resolvedVersion: text("resolved_version"),
    isDev: boolean("is_dev").notNull().default(false),
    isDirect: boolean("is_direct").notNull().default(true),
    source: text("source"),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.packageId] }),
    index("project_dependencies_package_idx").on(table.packageId),
  ],
);

export const distributions = pgTable(
  "distributions",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    evidence: text("evidence").notNull(),
    url: text("url"),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.kind, table.label] })],
);

/**
 * Links to the panel of each project's external service.
 *
 * Separate table from `distributions` because they answer different questions: `distributions`
 * says *where this can live*, `project_links` says *where I administer it*. A project can have
 * Firebase without being deployed anywhere, and be published on the web without having any console
 * to open.
 */
export const projectLinks = pgTable(
  "project_links",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Service ID; matches that of the rule when it is also a technology. */
    serviceId: text("service_id").notNull(),
    service: text("service").notNull(),
    label: text("label").notNull(),
    url: text("url").notNull(),
    /** `deep` opens the specific project; `console` only the service panel. */
    kind: text("kind").notNull(),
    evidence: text("evidence").notNull(),
    iconSlug: text("icon_slug"),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.serviceId] })],
);

/**
 * AI agents who have worked on a project.
 *
 * In Phase 1 it comes out of the `Co-Authored-By` trailers from the git history — the passive
 * route, which works without anyone installing anything. In Phase 3 the MCP server will add
 * sessions and activity here with much more detail.
 */
export const projectAgents = pgTable(
  "project_agents",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentName: text("agent_name").notNull(),
    commits: integer("commits").notNull(),
    source: text("source").notNull().default("git-trailer"),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.agentName] })],
);

/**
 * Registered AI agent.
 *
 * The key is stored hashed and is only shown once, when it is created: if the catalog is filtered,
 * the keys do not travel with it. It is the same reason why we never save the key in plain text,
 * not even locally — the habit matters more than today's risk.
 */
export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** claude_code, cursor, codex, custom… */
  kind: text("kind").notNull().default("custom"),
  apiKeyHash: text("api_key_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

/**
 * A work shift of an agent on a project.
 *
 * Grouping matters: without sessions, a project's record ends up being a flat list of five hundred
 * log lines where 'fixed the login' is not distinguished from 'renamed a variable.' With sessions,
 * each agent visit is read as a diary entry.
 */
export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Summary that the agent writes when closing, if they close it. */
    summary: text("summary"),
  },
  (table) => [index("agent_sessions_project_idx").on(table.projectId, table.startedAt)],
);

/** What the agent did. It is the record that turns Panoma into the project's memory. */
export const agentActivities = pgTable(
  "agent_activities",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** change · decision · note · block */
    kind: text("kind").notNull().default("change"),
    summary: text("summary").notNull(),
    details: text("details"),
    filesTouched: jsonb("files_touched"),
    commitSha: text("commit_sha"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agent_activities_project_idx").on(table.projectId, table.createdAt),
    /*
      The reading room of the archive: full-text search over the entire logbook.
      `simple` and not `spanish` nor `english`, by the way: entries are written by agents in the
      language they speak that day, and a lemmatizer applied to the wrong language makes the
      search worse than none — 'building' lemmatized in Spanish finds nothing. Without
      lemmatizing, what is written is what is found, in any language.
     */
    index("agent_activities_search_idx").using(
      "gin",
      sql`to_tsvector('simple', ${table.summary} || ' ' || coalesce(${table.details}, ''))`,
    ),
  ],
);

/**
 * Recoverable session distillation. Project ownership follows the session when a catalog entry
 * moves; keeping another project_id here would strand queued work at the old folder.
 */
export const memoryJobs = pgTable("memory_jobs", {
  /**
   * Its own id since delivery B. A job used to be the session it distilled, and `session_id` was
   * the key; a batch of intervals across streams, or a topic of the Twin, has no single session.
   * Legacy rows are backfilled as `legacy:<session_id>` and keep their `session_id`.
   */
  id: text("id").primaryKey(),
  sessionId: text("session_id").references(() => agentSessions.id, { onDelete: "cascade" }),
  /**
   * `pending → running → staged → complete`, with `deferred`, `failed`, `cancelled` and
   * `obsolete` as outcomes. `complete` is the SQL word for the plan's `published`; `staged` is
   * a paid answer that has been validated and saved and waits to be published without paying
   * again; `obsolete` is a staged answer the world overtook (a permission, a purge, a signature).
   */
  status: text("status").$type<"pending" | "running" | "staged" | "deferred" | "failed" | "complete" | "cancelled" | "obsolete">().notNull().default("pending"),
  /** Claims, not calls: the paid calls of a job live in `model_calls` under `job_id`. */
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /** Rotates on every claim, so an expired worker cannot finish another worker's attempt. */
  leaseToken: text("lease_token"),
  /** When the lease ends; a claim after this instant may take the job over, staged output included. */
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  reason: text("reason"),
  /** Counts and coverage only; source excerpts and model output belong in neither receipt nor logs. */
  receipt: jsonb("receipt").$type<Record<string, unknown>>(),
  /** `legacy_session` (the session distiller) · `project_extract` · later the Twin's processors. */
  processor: text("processor").notNull().default("legacy_session"),
  /** The logical key of the batch or topic: one job per (processor, work key), never restarted. */
  workKey: text("work_key").notNull(),
  /** The scope the batch belongs to: a project id, an identity, or a topic. */
  scopeKey: text("scope_key").notNull(),
  /** The project of a batch; the legacy job derives it from its session, which can move. */
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  /** `legacy_memory` · `project_extract` — the permission it runs under. */
  purpose: text("purpose").notNull().default("legacy_memory"),
  /** legacy · manual · automatic */
  origin: text("origin").notNull().default("legacy"),
  /** The frozen input: intervals, evidence and context references, grants. Never text. */
  inputManifest: jsonb("input_manifest").$type<Record<string, unknown>>().notNull().default({ schemaVersion: 1, processor: "legacy_session", coverage: "baseline_only" }),
  /** Canonical hash of the manifest, which does not include itself. */
  inputHash: text("input_hash").notNull().default(""),
  /** Rises when activity arrives while the job runs: the next window is pending, this one keeps its manifest. */
  requestedRev: bigint("requested_rev", { mode: "number" }).notNull().default(1),
  /** Compare-and-set counter of the row. */
  rev: bigint("rev", { mode: "number" }).notNull().default(1),
  /** The validated answer waiting to be published; never copied into receipts or logs. */
  stagedOutput: jsonb("staged_output").$type<Record<string, unknown>>(),
  /** Capacity held for an automatic model answer and its publication, charged to memory_usage. */
  storageReservedBytes: bigint("storage_reserved_bytes", { mode: "number" }).notNull().default(0),
}, (table) => [
  index("memory_jobs_ready_idx").on(table.status, table.availableAt),
  index("memory_jobs_project_idx").on(table.projectId, table.createdAt),
  uniqueIndex("memory_jobs_work_idx").on(table.processor, table.workKey),
  uniqueIndex("memory_jobs_legacy_session_idx").on(table.sessionId).where(sql`processor = 'legacy_session'`),
  check("memory_jobs_status_check", sql`${table.status} in ('pending', 'running', 'staged', 'deferred', 'failed', 'complete', 'cancelled', 'obsolete')`),
  check("memory_jobs_attempts_check", sql`${table.attempts} >= 0`),
  check("memory_jobs_origin_check", sql`${table.origin} in ('legacy', 'manual', 'automatic')`),
  check("memory_jobs_rev_check", sql`${table.rev} > 0 and ${table.requestedRev} > 0`),
  check("memory_jobs_storage_reserved_check", sql`${table.storageReservedBytes} >= 0 and ${table.storageReservedBytes} <= 9007199254740991`),
]);

/**
 * A typed local fact read from a program's own record: what was read, edited, run, what a test
 * said, what failed, that a commit happened, a lifecycle event, a receipt seen. The list is closed
 * and the payload of each kind is closed too (`packages/db/src/session-facts.ts`): no command
 * line, no prompt, no assistant text, no tool output ever lands here. A fact is identified by
 * its stream, generation, byte offset and sub-index under one parser version; a new parser
 * version reads the same bytes again into rows of its own and never adds a second confirmation
 * of the same event. `ingest_seq` orders what the catalog learned, not what happened.
 */
export const sessionFacts = pgTable(
  "session_facts",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull().references(() => memorySources.id, { onDelete: "restrict" }),
    byteOffset: bigint("byte_offset", { mode: "number" }).notNull(),
    subIndex: integer("sub_index").notNull(),
    parserVersion: text("parser_version").notNull(),
    ingestSeq: bigint("ingest_seq", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    identity: text("identity"),
    recipientKey: text("recipient_key"),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("session_facts_identity_idx").on(table.sourceId, table.byteOffset, table.subIndex, table.parserVersion),
    uniqueIndex("session_facts_ingest_idx").on(table.ingestSeq),
    index("session_facts_project_idx").on(table.projectId, table.ingestSeq),
    index("session_facts_source_idx").on(table.sourceId, table.byteOffset),
    check("session_facts_offset_check", sql`${table.byteOffset} >= 0 and ${table.subIndex} >= 0`),
    check(
      "session_facts_kind_check",
      sql`${table.kind} in ('read', 'edit', 'command', 'test_result', 'failure', 'commit', 'lifecycle', 'receipt_seen')`,
    ),
  ],
);

/** Work queue: what agents can pick up. */
export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body"),
    /** abierta · en curso · hecha · descartada */
    status: text("status").notNull().default("open"),
    createdBy: text("created_by").notNull().default("human"),
    /**
     * Which critic review and finding produced this assignment.
     *
     * Null in everything else, which is almost everything. They exist because the critic left its
     * work half done: it would write the assignment —'unify the border of the three cards'— and it had to
     * be copied by hand to the agent, which means that the role this body exists to remove still
     * had a manual step within.
     *
     * And they are two columns and not a `created_by = "twin"` label, which is what the plan said.
     * `created_by` answers **who requested it** and is displayed exactly as in the record: the
     * person who presses the button is an individual, so putting 'twin' there would make the queue
     * lie about who made the request. What needed to be known is where the text came from, and one
     * reference says that and also specifies which — so that you can show 'already requested' in
     * the exact finding, not queue it twice, and later count how many of those the critic drafted
     * were submitted as is. A label would not have been able to do any of the three.
     *
     * Without being a stranger to `looks`, like the rest of Twin: erasing a look doesn't have to
     * take down the task it caused, which by that point is already someone else's work.
     */
    fromLook: text("from_look"),
    /** The finding's index within its review. The order of stored `jsonb` does not change. */
    fromFinding: integer("from_finding"),
    /**
     * From what finding of the **mechanical** critic it emerged, due to its content and not
     * because of its position.
     *
     * The column next to it is no good for this, and the difference is in the two tables: `looks`
     * writes one row per view and never touches it, so an index in there points to the same thing
     * forever; `reviews` stores one row per folder and **overwrites it with each revision**, so
     * it’s enough for one more broken link to appear for yesterday’s index to point to something
     * else. The key comes from what is reported —class, file, line, and value— and is calculated
     * by `critiqueKey`.
     *
     * And that gives for free what was missing: the same broken link found next week is the same
     * key, so if your order is still alive it doesn't get queued again.
     */
    fromCritique: text("from_critique"),
    assignedAgentId: text("assigned_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    result: text("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("tasks_project_idx").on(table.projectId, table.status)],
);

/**
 * The curated memory of the project: durable facts, few and with a budget.
 *
 * The logbook (`agent_activities`) already records what happened, but it is a record: it grows, is
 * organized by date, and what happened a month ago gets buried under what happened this week. What
 * an agent discovers and **remains true** —'the tests require a build earlier in a cold tree,'
 * 'the 4173 server is a production build'— would get lost among log lines as soon as it fell out
 * of the fifteen-day window. This table is the other half of that pair, and the distinction is
 * what matters: the log grows and is archived; memory heals and is kept small.
 *
 * ── Small by contract, not by custom ───────────────────────────────────────────
 *
 * The approved ones of a project fit in `NOTE_BUDGET` characters **in total**, and when it
 * overflows there is no automatic compaction: approval is denied and you have to consolidate or
 * discard beforehand. It is the same pattern as `TASTE.md` (its limit triggers instead of
 * trimming), and the reason is the same in both: a store that always fits entirely in the context
 * does not need search, nor ranking, nor a model to decide what to retrieve — it is served
 * complete and the retrieval problem is over.
 *
 * ── The gate is a person ──────────────────────────────────────────────────────
 *
 * A note is proposed by an agent (`proposed`) and does not travel to any other agent until the
 * person approves it. It is not bureaucracy: what enters here is injected into **all** the project
 * agents on their first turn, so a poisoned note from a foreign README would be an injection with
 * persistence and distribution. Approval turns that channel into the same thing discarded tasks
 * already are: each row carries a yes or no from someone. A discarded one is that no, and it is
 * never proposed or served again.
 *
 * Hang from `project_id` like the logbook and the queue, not from the stable identity like
 * `decisions`: the note talks about the folder being worked on, and if the project is cloned to
 * another path, its operational facts ("this tree needs build before test") still belong to the
 * tree, not to the lineage.
 */
export const notes = pgTable(
  "notes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The fact, in one or two sentences. The cap per grade lives in `notes.ts` (`NOTE_MAX`). */
    body: text("body").notNull(),
    /**
     * proposed · approved · discarded · challenged (the sentinel's lawsuit: see `challenge`) ·
     * superseded (since delivery C: an approved successor named it in `supersedes_id`).
     */
    status: text("status").notNull().default("proposed"),
    /** The name of the agent who proposed it, or `human` if it was written by the person. */
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** When did someone say yes or no. Null while waiting. */
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /**
     * The sentinels: the observable conditions on the disc under which this note ceases to be
     * credible.
     *
     * A text note ages in silence; a note with a sentinel betrays itself. Each element is
     * `{ kind, target, expected }` — today `path_exists` (the path that the note mentions still
     * exists), `file_hash` and `file_contains` — and the watcher reevaluates them in the same
     * pass in which it reanalyzes the project: comparison against the disk, zero paid calls. It is
     * Doyle's (1979) truth-maintenance system with the file system as the justification base,
     * and no one else in the sector can have it because no one else is on the disk.
     *
     * They are set by customs of approval (`lib/sentinels.ts` extracts anchors from its own body:
     * no person drafts conditions by hand), and they are re-anchored in each re-approval — the
     * current basis is that of the last yes.
     */
    sentinels: jsonb("sentinels").notNull().default([]),
    /**
     * The note's 'where': the trigger that lets it sleep outside the report.
     *
     * Null is the normal case: the note is awake and travels in each `panoma_context`, paying the
     * budget. With a trigger —an exact route or a `dir/**` prefix, relative to the root— the note
     * SLEEPS: it does not travel in the report nor pay the 2,000, and is served only at the moment
     * when an agent is going to touch that route (the `panoma hooks --install` hook asks for it
     * before each edit). It is the traffic signal in front of the employee manual: knowing-where
     * at zero cost, and the solution to the central tension of the budget — the memory can be
     * large if almost everything sleeps.
     */
    trigger: text("trigger"),
    /**
     * The evidence of the challenge, when a sentinel fires: `{ at, sentinel, observed }`. Null
     * while the note is credible. Firing does NOT erase or rewrite — it moves to `challenged`,
     * which is not served to any agent, and leaves the dispute with its diff at the usual gate:
     * the person re-approves (re-anchoring) or discards. Entering suspicion does not ask for
     * permission; exiting it does, always.
     */
    challenge: jsonb("challenge"),
    /**
     * The delivery revision: see the block at the top of this file. Body, status, trigger,
     * sentinels and the challenge move it; a serving or a receipt does not. Notes keep
     * `project_id` as their scope and a null `trigger` as their membership in the core.
     */
    memoryRev: bigint("memory_rev", { mode: "number" }).notNull().default(1),
    /**
     * The owner's explicit expiry, since delivery C. An expired note is not eligible and travels
     * nowhere; the date is the owner's and is shown as they wrote it, never re-interpreted.
     */
    validUntil: timestamp("valid_until", { withTimezone: true }),
    /**
     * The note this one replaced when it was approved (delivery C). Approving a successor sets the
     * predecessor `superseded` in the same transaction, by compare-and-set on both revisions; the
     * predecessor is never deleted (`restrict`), so the succession stays readable.
     */
    supersedesId: text("supersedes_id").references((): AnyPgColumn => notes.id, { onDelete: "restrict" }),
  },
  (table) => [
    index("notes_project_idx").on(table.projectId, table.status),
    uniqueIndex("notes_successor_idx").on(table.supersedesId).where(sql`status = 'approved' and supersedes_id is not null`),
    check("notes_memory_rev_check", sql`${table.memoryRev} > 0`),
    check("notes_status_check", sql`${table.status} in ('proposed', 'approved', 'discarded', 'challenged', 'superseded')`),
  ],
);

/**
 * An assignment that went to an agent: which one, from whom, and when.
 *
 * It is the missing row, and its absence was Twin's oldest gap. `POST /api/assignments/launch`
 * writes the assignment in `~/.panoma/assignments`, opens the terminal with the agent already
 * working, and answers `{ ok: true }` — and that was it. The only trace was a file that **is
 * overwritten with each relaunch**, so the disk could say 'this was launched at least once' and
 * never how many times, or when, or if the one next to it was launched at any point. With that,
 * the bottom half of the pyramid —assign, deliver, measure— was cut off right before the last
 * question: of everything I wrote for you, how much actually got out?
 *
 * ── What is saved is the gesture, not the work ──────────────────────────────────────
 *
 * One row per click, stateless and endless. What happens on that terminal —whether the agent
 * understood the task, whether they did it, whether they did it well— is not recorded here and
 * cannot be: it's the session of another program, on someone's machine, over a repository that
 * Panoma only looks at. What happens afterwards is told by the commits, which is where this
 * catalog gets everything else from. Confusing 'I launched it' with 'it got done' would be exactly
 * the kind of number this repository refuses to write.
 *
 * ── And that is why there are as many lines as clicks
 * ────────────────────────────────────────────
 *
 * Relaunch the same task, write another one. It is not noise: a task that has to be launched four
 * times is exactly what the double document calls correcting, and it was invisible. `launched`
 * counts different tasks and `launches` counts gestures, which are two facts and not one — the
 * same separation that `briefScore` already made between assigned findings and created tasks.
 *
 * ── What still cannot be told, said here ──────────────────────────────────────
 *
 * “Released **unedited**,” which is how the duplicate document states its metric. Editing an
 * assignment before sending it does not exist in this product, and not for lack of time: the text
 * that reaches an agent with tools is always written by the server with what is in the database,
 * and a route that would accept that client text would be a route that tells an agent what to
 * write. As long as that door remains closed, “unedited” is 100% by design, and 100% by design is
 * not a measure. What can be measured is what is next to it, and it is measured: released by those
 * in charge, and discarded by those indicated.
 */
/**
 * The substitute: the questions an agent would have asked the owner.
 *
 * The documented pain of the owner is the middle turn — judging, directing, repeating. The
 * substitute's bet is that their Twin (~25 quotable beliefs, mined from their real verdicts) can
 * answer some of those questions on their behalf. But that bet is not served by faith: first it
 * runs IN SHADOW. Each row of this table is a real question from an agent; the double drafts their
 * answer afterwards and DOES NOT give it to anyone — it stays here, waiting for the person to
 * label it: "would have said the same" or "no." From those labels come the two numbers that decide
 * if the double comes out of the shadow: coverage (how many questions they did not abstain from)
 * and fidelity (how many labeled they got right). Without high fidelity in the non-abstained, the
 * double never speaks.
 *
 * `status` is the life of the draft: `drafting` (just asked, the model hasn't run yet), `drafted`
 * (there is an answer with its cited beliefs), `abstained` (the beliefs did not cover the question
 * — which is the most common honest answer and counts as data, not as a failure). `verdict` is the
 * person's label on a `drafted`: `backed` or `vetoed`. In shadow, the veto is only a measure; the
 * day the double speaks, a veto will downgrade the belief that underpinned the answer.
 */
export const consultations = pgTable(
  "consultations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    /** The draft of the double. Null while drafting and in abstentions. */
    answer: text("answer"),
    /** The beliefs that the draft cites. The answer without a citation does not exist in this house. */
    beliefIds: jsonb("belief_ids"),
    /** drafting · drafted · abstained */
    status: text("status").notNull().default("drafting"),
    /** backed · vetoed — the person's label. Null if untagged. */
    verdict: text("verdict"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /*
      The two dates are saved for tomorrow's latency report —how long it takes the double to
      draft, how long the person to label—, just as `servings` saves its raw materials before
      there is anyone to read them. Today no one reads them, knowingly.
     */
    draftedAt: timestamp("drafted_at", { withTimezone: true }),
    verdictAt: timestamp("verdict_at", { withTimezone: true }),
  },
  (table) => [index("consultations_project_idx").on(table.projectId, table.createdAt)],
);

/**
 * The scale: each time the report delivers (or withholds) the memory to an agent.
 *
 * It exists because the entire building of memory rests on a premise that no one in the field has
 * measured: that an agent who is given a note **pays attention to it**. This same repository
 * disproves it on a small scale — 'the number always at the end' reappeared seven times with
 * memory in front — so before building anything else on top, the instrument that weighs it is
 * built.
 *
 * A row per memory delivery in `panoma_context`, with two arms:
 *
 * - `served`: the notes traveled. It is the usual arm and the only one that exists with the
 * ablation turned off.
 * - `withheld`: the notes were purposely withheld (only with `PANOMA_MEMORY_ABLATION` on, and only
 * in the agent channel — nothing is ever hidden from the person).
 *
 * `note_ids` saves the notes that traveled **or that would have been served**: without that, the
 * two arms are not twins — you cannot ask 'did the absence of THIS note coincide with the
 * recurrence?'. The arm is decided by a deterministic hash of (agent, project, day), not a die:
 * the same visit always falls into the same arm, and the allocation can be audited by
 * recalculating it.
 *
 * The row is written only when the project has approved grades: a submission with nothing to
 * submit weighs nothing and would only bloat the table. And this book is not just about the scale:
 * it is the substrate of everything that the border called "scars" — knowing what grade was given
 * to whom is half of being able to ask later if it was of any use.
 *
 * There is no pruning, and it is a decision and not neglect: the scars are history that does not
 * return, and at the pace of the local catalog (a few rows per agent visit) it will take years to
 * matter. The day they matter, the correct pruning is to compact the oldest into daily aggregates
 * — the report only reads windows — and that day is decided here, not in silence.
 */
export const servings = pgTable(
  "servings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /**
     * Nullable since the memory contract v2: a hook has no agent key, and an offer made to a
     * hook's context must not invent one. Deleting an agent keeps the offer and blanks the name —
     * the offer is a record of what was prepared, not a possession of the key.
     */
    agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    /** served · withheld */
    arm: text("arm").notNull(),
    /** Null means ordinary delivery; only enrolled servings belong in an experiment comparison. */
    experimentId: text("experiment_id"),
    /** The delivered — or withheld — notes: the same ones that would have traveled. */
    noteIds: jsonb("note_ids").notNull(),
    /** How much did the delivery weigh, in order to relate effect with size. */
    noteChars: integer("note_chars").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /*
      ── The offer of the memory contract v2 ────────────────────────────────────────────────
      The legacy row above says "these notes travelled in the briefing"; it never said which
      bytes. From v2 an offer is immutable: the canonical payload and its hash, the exact message
      the adapter emits (`rendered`, whose UTF-8 bytes every unit offset refers to), the manifest
      of complete units inside it, the context and generation it was prepared for, and the policy
      snapshot that authorized it. A retry with the same determinants reuses the offer; changing
      one relevant byte is another offer. Attempts and observations go to `serving_events` and
      never rewrite this row. `schema_version` 0 is the legacy row; 2 is a v2 offer, and the
      check below demands the whole manifest for a v2 offer that has not been purged.
     */
    schemaVersion: integer("schema_version").notNull().default(0),
    contextId: text("context_id").references(() => memoryContexts.id, { onDelete: "set null" }),
    contextGeneration: bigint("context_generation", { mode: "number" }),
    /** brief · signal · mcp · handoff — the closed list lives in `@panoma/core` (`memory-contract.ts`). */
    channel: text("channel"),
    /** Caller, context, generation, channel and request id: an identical retry finds its offer here. */
    requestKey: text("request_key"),
    /** The canonical contract without presentation, contract id or its own hash. */
    payload: jsonb("payload"),
    /** SHA-256 hex of the canonical payload: the public `contentHash`. */
    contentHash: text("content_hash"),
    /** `presentation.text`, exactly as emitted. Unit offsets are UTF-8 byte ranges of this text. */
    rendered: text("rendered"),
    /** SHA-256 hex of `rendered`: the `renderedHash`, computed after the id and the body. */
    renderedHash: text("rendered_hash"),
    /** Bytes of the final message of the emitted profile, wrapper and escaping included. */
    serializedBytes: bigint("serialized_bytes", { mode: "number" }),
    /** `{ schemaVersion: 1, units: [{ kind, id, revision, start, end, unitHash }] }`. */
    unitManifest: jsonb("unit_manifest"),
    /** Grants and generations that authorized the offer; never source text. */
    policySnapshot: jsonb("policy_snapshot"),
    /** Purging blanks payload, rendered, hashes and manifest; the row and its events remain. */
    purgedAt: timestamp("purged_at", { withTimezone: true }),
  },
  (table) => [
    index("servings_project_idx").on(table.projectId, table.at),
    index("servings_context_idx").on(table.contextId, table.at),
    uniqueIndex("servings_request_key_idx").on(table.requestKey).where(sql`request_key is not null`),
    check("servings_schema_version_check", sql`${table.schemaVersion} in (0, 2)`),
    check("servings_serialized_bytes_check", sql`${table.serializedBytes} is null or ${table.serializedBytes} >= 0`),
    check(
      "servings_v2_complete_check",
      sql`${table.schemaVersion} <> 2 or ${table.purgedAt} is not null or (
        ${table.payload} is not null and ${table.contentHash} is not null and ${table.rendered} is not null
        and ${table.renderedHash} is not null and ${table.unitManifest} is not null
        and ${table.serializedBytes} is not null and ${table.channel} is not null and ${table.policySnapshot} is not null
      )`,
    ),
  ],
);

/**
 * A context: what one recipient keeps, as opposed to a session, which is a conversation.
 *
 * A subagent has its own context although its facts group under the parent's session. Every
 * start, resume or compaction that discards context invalidates what was "seen" in the previous
 * generation, and the memory that had travelled becomes eligible again: repeating a rule costs
 * tokens, suppressing one that may have vanished costs the rule. `lifecycle_key` names the native
 * event when the program gives a reliable one, which is what allows an idempotent retry; without
 * it an ambiguous resume creates a new context, on purpose. The authoritative state lives here,
 * never in a file shared by hooks: restarting the server loses no generation.
 */
export const memoryContexts = pgTable(
  "memory_contexts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    /** The adapter with an implementation: `claude-code` · `codex`. */
    harness: text("harness").notNull(),
    /** cli · desktop · mcp · unknown — where the program was entered from, as it declares it. */
    entrypoint: text("entrypoint").notNull(),
    /** The recipient inside the session: the main context or a subagent, or a fresh instance. */
    recipientKey: text("recipient_key").notNull(),
    /** The program's own session id, pseudonymized; null when the caller cannot be bound to one. */
    nativeSessionKey: text("native_session_key"),
    agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    /** Rises on every lifecycle event that discards context. */
    generation: bigint("generation", { mode: "number" }).notNull().default(1),
    /** Compare-and-set counter for the row itself. */
    rev: bigint("rev", { mode: "number" }).notNull().default(1),
    /** harness / entrypoint / recipient / native event coordinate. Never a timestamp. */
    lifecycleKey: text("lifecycle_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("memory_contexts_project_idx").on(table.projectId, table.lastSeenAt),
    uniqueIndex("memory_contexts_lifecycle_idx").on(table.lifecycleKey).where(sql`lifecycle_key is not null`),
    check("memory_contexts_generation_check", sql`${table.generation} > 0`),
    check("memory_contexts_rev_check", sql`${table.rev} > 0`),
  ],
);

/**
 * A physical generation of a stream a reader may observe: one transcript file as it exists now.
 *
 * Not a permission and not an agent session. A truncation, substitution, rotation or rewrite of
 * the file opens a new generation with `previous_id` pointing at the old one, so that a receipt
 * observed at byte 4,000 of generation 1 keeps meaning that and nothing else. `stream_key` derives
 * from the program's stable identifier (or its hash), never from a sensitive phrase; `locator`
 * and `file_identity` stay in the catalog and are blanked on purge. `origin` says whether the
 * stream is native, a copy (a handoff, an export) or unknown — a copy never seals a receipt.
 */
export const memorySources = pgTable(
  "memory_sources",
  {
    id: text("id").primaryKey(),
    streamKey: text("stream_key").notNull(),
    generation: bigint("generation", { mode: "number" }).notNull(),
    previousId: text("previous_id").references((): AnyPgColumn => memorySources.id, { onDelete: "restrict" }),
    harness: text("harness").notNull(),
    entrypoint: text("entrypoint").notNull(),
    nativeSessionKey: text("native_session_key"),
    /** The validated local path. Only the catalog reads it; a client never supplies it as authority. */
    locator: text("locator"),
    /** `{ device?, inode?, nativeFileId?, observedSize, anchorFrom, anchorTo }`, as the adapter declares. */
    fileIdentity: jsonb("file_identity"),
    /** Fingerprint of the bytes around the cursor: a growing size does not prove an intact prefix. */
    anchorHash: text("anchor_hash"),
    /** native · copy · unknown. `native` demands validated provenance. */
    origin: text("origin").notNull().default("unknown"),
    /** Proven lineage of a copy; null proves no independence. */
    originKey: text("origin_key"),
    parentStreamKey: text("parent_stream_key"),
    /** active · replaced · blocked · purged */
    status: text("status").notNull().default("active"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("memory_sources_stream_idx").on(table.streamKey, table.generation),
    index("memory_sources_status_idx").on(table.status, table.lastSeenAt),
    check("memory_sources_generation_check", sql`${table.generation} > 0`),
    check("memory_sources_origin_check", sql`${table.origin} in ('native', 'copy', 'unknown')`),
    check("memory_sources_status_check", sql`${table.status} in ('active', 'replaced', 'blocked', 'purged')`),
    check(
      "memory_sources_purged_check",
      sql`${table.purgedAt} is null or (${table.locator} is null and ${table.fileIdentity} is null and ${table.anchorHash} is null)`,
    ),
  ],
);

/**
 * Where each purpose stands on each stream, per grant and scope — relational, so that no
 * permission or coverage hides inside a growing JSON.
 *
 * `allowed_from` is the boundary the permission fixed (the exact EOF at activation); `next_byte`
 * only crosses complete records that were processed or excluded with a reason. A record cut in
 * half at the boundary is excluded whole. The first unresolved gap stays in `blocked_from` /
 * `blocked_to` and the cursor never advances over it. A backfill is another `grant_id` with a
 * closed range; it never rewinds the ordinary cursor. Delivery A has one purpose, `receipt`;
 * later deliveries add `facts`, `project_extract` and `twin_extract`, each with its own progress.
 */
export const memorySourceCursors = pgTable(
  "memory_source_cursors",
  {
    sourceId: text("source_id").notNull().references(() => memorySources.id, { onDelete: "restrict" }),
    purpose: text("purpose").notNull(),
    grantId: text("grant_id").notNull(),
    /** A project identity or reference; `*` only under an explicit global grant. */
    scopeKey: text("scope_key").notNull(),
    grantGeneration: bigint("grant_generation", { mode: "number" }).notNull(),
    /** The exact base and semantic grants that authorised a historical range; null for ordinary cursors. */
    permissionSnapshot: jsonb("permission_snapshot").$type<Record<string, unknown>>(),
    allowedFrom: bigint("allowed_from", { mode: "number" }).notNull(),
    allowedTo: bigint("allowed_to", { mode: "number" }),
    nextByte: bigint("next_byte", { mode: "number" }).notNull(),
    /** A concrete version, never "latest". */
    parserVersion: text("parser_version").notNull(),
    /** pending · active · blocked · complete · revoked */
    state: text("state").notNull().default("pending"),
    rev: bigint("rev", { mode: "number" }).notNull().default(1),
    leaseToken: text("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    /** A bounded code; never a line of the session. */
    reason: text("reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    blockedFrom: bigint("blocked_from", { mode: "number" }),
    blockedTo: bigint("blocked_to", { mode: "number" }),
  },
  (table) => [
    primaryKey({ columns: [table.sourceId, table.purpose, table.grantId, table.scopeKey] }),
    index("memory_source_cursors_purpose_idx").on(table.purpose, table.state, table.updatedAt),
    check("memory_source_cursors_grant_generation_check", sql`${table.grantGeneration} > 0`),
    check("memory_source_cursors_range_check", sql`${table.allowedFrom} >= 0 and (${table.allowedTo} is null or ${table.allowedTo} > ${table.allowedFrom})`),
    check("memory_source_cursors_next_check", sql`${table.nextByte} >= ${table.allowedFrom} and (${table.allowedTo} is null or ${table.nextByte} <= ${table.allowedTo})`),
    check("memory_source_cursors_state_check", sql`${table.state} in ('pending', 'active', 'blocked', 'complete', 'revoked')`),
    check("memory_source_cursors_rev_check", sql`${table.rev} > 0`),
    check("memory_source_cursors_lease_check", sql`(${table.leaseToken} is null) = (${table.leaseUntil} is null)`),
    check("memory_source_cursors_blocked_check", sql`${table.blockedTo} is null or (${table.blockedFrom} is not null and ${table.blockedTo} > ${table.blockedFrom})`),
  ],
);

/**
 * What happened to an offer after it was prepared: an attempt to transport it, or an observation
 * of it in a native record. Append-only; nothing here rewrites the offer's time or content.
 *
 * An attempt says the server tried to answer, with its local result and latency. A reception
 * says the adapter found those bytes at a validated site of the program's own record — `full`,
 * `partial`, `unknown` or `not_observed` — with the source and byte coordinate that prove it.
 * `event_key` is the native event's identity when the program gives a reliable one; then the
 * same observation cannot be recorded twice. Two markers at the ends do not prove an intact
 * middle: the reception compares the units of the manifest.
 */
export const servingEvents = pgTable(
  "serving_events",
  {
    id: text("id").primaryKey(),
    servingId: text("serving_id").notNull().references(() => servings.id, { onDelete: "cascade" }),
    /** attempt · reception */
    eventKind: text("event_kind").notNull(),
    eventKey: text("event_key"),
    sourceId: text("source_id").references(() => memorySources.id, { onDelete: "restrict" }),
    byteOffset: bigint("byte_offset", { mode: "number" }),
    /** attempt: sent · failed · unknown — reception: full · partial · unknown · not_observed */
    result: text("result").notNull(),
    /** `{ schemaVersion: 1, … }`: latency, units checked, parser version. Never source text. */
    details: jsonb("details").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("serving_events_serving_idx").on(table.servingId, table.observedAt),
    index("serving_events_source_idx").on(table.sourceId, table.byteOffset),
    uniqueIndex("serving_events_event_key_idx").on(table.eventKey).where(sql`event_key is not null`),
    check("serving_events_kind_check", sql`${table.eventKind} in ('attempt', 'reception')`),
    check(
      "serving_events_result_check",
      sql`(${table.eventKind} = 'attempt' and ${table.result} in ('sent', 'failed', 'unknown'))
        or (${table.eventKind} = 'reception' and ${table.result} in ('full', 'partial', 'unknown', 'not_observed'))`,
    ),
    check("serving_events_offset_check", sql`${table.byteOffset} is null or ${table.byteOffset} >= 0`),
  ],
);

/**
 * The photograph of a delivered object at one revision. See the block at the top of the file.
 *
 * `kind` names the domain (`note`, `criterion`, `decision`, and the evidence domains that are
 * only photographed when they become an input of a revision or an offer); `object_id` the row;
 * `rev` its `memory_rev`. `payload` keeps every semantic column of the row and `payload_hash`
 * the SHA-256 of its canonical JSON. A baseline (`coverage = baseline_only`) is what the
 * migration writes for rows that existed before this table: it preserves id, state, text, scope
 * and signature, and invents no approval nor instant that was never recorded. Purging a
 * photograph blanks payload and hash and leaves the row as the receipt of the gap: this table
 * promises no immutability that would stop the owner from deleting data.
 */
export const memoryRevisions = pgTable(
  "memory_revisions",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    objectId: text("object_id").notNull(),
    rev: bigint("rev", { mode: "number" }).notNull(),
    previousId: text("previous_id").references((): AnyPgColumn => memoryRevisions.id, { onDelete: "restrict" }),
    schemaVersion: integer("schema_version").notNull().default(1),
    scopeKind: text("scope_kind").notNull(),
    scopeRef: text("scope_ref"),
    /** owner_instruction · owner_confirmation · owner_report · agent_report · observed_result · inference */
    authority: text("authority").notNull(),
    /** The domain's own state word at that revision (approved, signed, active…). */
    disposition: text("disposition").notNull(),
    payload: jsonb("payload"),
    payloadHash: text("payload_hash"),
    /** complete · baseline_only */
    coverage: text("coverage").notNull().default("complete"),
    /** create · edit · approve · adopt · veto · supersede · support · scope · policy · baseline */
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("memory_revisions_object_rev_idx").on(table.kind, table.objectId, table.rev),
    index("memory_revisions_object_idx").on(table.kind, table.objectId, table.createdAt),
    index("memory_revisions_scope_idx").on(table.scopeKind, table.scopeRef, table.createdAt),
    check("memory_revisions_rev_check", sql`${table.rev} > 0`),
    check("memory_revisions_schema_version_check", sql`${table.schemaVersion} = 1`),
    check("memory_revisions_scope_kind_check", sql`${table.scopeKind} in (${SCOPE_KINDS})`),
    check("memory_revisions_scope_ref_check", sql`${table.scopeKind} <> 'project' or ${table.scopeRef} is not null`),
    check("memory_revisions_coverage_check", sql`${table.coverage} in ('complete', 'baseline_only')`),
    check(
      "memory_revisions_payload_check",
      sql`(${table.purgedAt} is null and ${table.payload} is not null and ${table.payloadHash} is not null)
        or (${table.purgedAt} is not null and ${table.payload} is null and ${table.payloadHash} is null)`,
    ),
  ],
);

/**
 * What a derived object was built from, and what supports it: the reverse index that a
 * withdrawal or a purge walks.
 *
 * `derived_from` records what really entered a transformation and is immutable; every required
 * group must remain permitted for that revision to be served. `supported_by` is additional,
 * independent support and may open an alternative group. Withdrawing one of two alternatives
 * keeps a fact with enough support; withdrawing an indispensable input blocks that version and
 * asks for a regeneration from what remains. Exactly one `dependent_*` and one `input_*` are set
 * on every edge; a group has one mode; an empty required group does not exist. Delivery B adds
 * `dependent_job_id`.
 */
export const memoryDependencies = pgTable(
  "memory_dependencies",
  {
    id: text("id").primaryKey(),
    /** The canonical key of ends, relation and group: the same edge cannot be written twice. */
    dependencyKey: text("dependency_key").notNull(),
    dependentRevisionId: text("dependent_revision_id").references(() => memoryRevisions.id, { onDelete: "restrict" }),
    dependentServingId: text("dependent_serving_id").references(() => servings.id, { onDelete: "cascade" }),
    /** Since delivery B: a job is a derived object too — what it read is what it may publish from. */
    dependentJobId: text("dependent_job_id").references(() => memoryJobs.id, { onDelete: "cascade" }),
    inputRevisionId: text("input_revision_id").references(() => memoryRevisions.id, { onDelete: "restrict" }),
    inputSourceId: text("input_source_id").references(() => memorySources.id, { onDelete: "restrict" }),
    /** Byte range of the source input, `[from, to)`; only with a source. */
    inputFrom: bigint("input_from", { mode: "number" }),
    inputTo: bigint("input_to", { mode: "number" }),
    /** derived_from · supported_by · exception · counterexample */
    relation: text("relation").notNull(),
    groupNo: integer("group_no").notNull().default(0),
    /** all · any */
    groupMode: text("group_mode").notNull().default("all"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("memory_dependencies_key_idx").on(table.dependencyKey),
    index("memory_dependencies_input_revision_idx").on(table.inputRevisionId),
    index("memory_dependencies_input_source_idx").on(table.inputSourceId),
    index("memory_dependencies_dependent_revision_idx").on(table.dependentRevisionId),
    index("memory_dependencies_dependent_serving_idx").on(table.dependentServingId),
    index("memory_dependencies_dependent_job_idx").on(table.dependentJobId),
    check(
      "memory_dependencies_dependent_check",
      sql`(${table.dependentRevisionId} is not null)::int + (${table.dependentServingId} is not null)::int + (${table.dependentJobId} is not null)::int = 1`,
    ),
    check(
      "memory_dependencies_input_check",
      sql`(${table.inputRevisionId} is not null)::int + (${table.inputSourceId} is not null)::int = 1`,
    ),
    check(
      "memory_dependencies_range_check",
      sql`(${table.inputSourceId} is null and ${table.inputFrom} is null and ${table.inputTo} is null)
        or (${table.inputSourceId} is not null and (${table.inputFrom} is null or (${table.inputFrom} >= 0 and (${table.inputTo} is null or ${table.inputTo} > ${table.inputFrom}))))`,
    ),
    check("memory_dependencies_relation_check", sql`${table.relation} in ('derived_from', 'supported_by', 'exception', 'counterexample')`),
    check("memory_dependencies_group_check", sql`${table.groupNo} >= 0 and ${table.groupMode} in ('all', 'any')`),
  ],
);

/**
 * A commitment: a human obligation with a version, since delivery C. Its text, project, optional
 * task, typed conditions and completion criteria are the owner's; `status` is the obligation
 * (`open` · `fulfilled` · `cancelled`) and the observations of its completion checks live apart in
 * `memory_outcomes`, so a failed check while working never closes it and a later regression never
 * erases that it was once fulfilled. Fulfilment is declared by the owner or by every completion
 * check the owner approved passing on the current revision in one environment; an agent's
 * `task_closed` report is a report. A closed commitment is never reopened: a new one is created
 * and linked through a dependency edge between their revisions.
 */
export const commitments = pgTable(
  "commitments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    /** 1 to 2,000 UTF-16 units; the cap lives in `commitments.ts`. */
    text: text("text").notNull(),
    /** A predicate of `packages/core/src/predicates.ts`, or null. */
    conditions: jsonb("conditions").$type<Record<string, unknown>>(),
    /** Up to six checks of purpose `completion`, approved by the owner. */
    completionChecks: jsonb("completion_checks").$type<Record<string, unknown>[]>().notNull().default([]),
    /** Checks of the other purposes, the same shape as on a note. */
    checks: jsonb("checks").$type<Record<string, unknown>[]>().notNull().default([]),
    /** open · fulfilled · cancelled */
    status: text("status").notNull().default("open"),
    memoryRev: bigint("memory_rev", { mode: "number" }).notNull().default(1),
    /** human · agent — who wrote the obligation down, never who fulfils it. */
    createdBy: text("created_by").notNull().default("human"),
    /** `{ schemaVersion, actor: owner | checks, revision, checks?, reason?, environmentId? }` at closure. */
    resolution: jsonb("resolution").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("commitments_project_idx").on(table.projectId, table.status),
    check("commitments_status_check", sql`${table.status} in ('open', 'fulfilled', 'cancelled')`),
    check("commitments_memory_rev_check", sql`${table.memoryRev} > 0`),
    check("commitments_created_by_check", sql`${table.createdBy} in ('human', 'agent')`),
    check(
      "commitments_resolution_check",
      sql`(${table.status} = 'open' and ${table.resolution} is null and ${table.resolvedAt} is null)
        or (${table.status} <> 'open' and ${table.resolution} is not null and ${table.resolvedAt} is not null)`,
    ),
  ],
);

/**
 * What a check observed, and the incidents it opened, since delivery C. An observation is one
 * row per look: the check revision, the environment the disk was in (`environment_id` tells two
 * dirty worktrees at one HEAD apart), the result and the evidence with its coverage. An incident
 * is an occurrence with an identity of its own — another row even with the same text and HEAD —
 * whose only mutable field is the owner's verdict, by compare-and-set on `verdict_rev`. Observing
 * never rewrites an earlier row and never moves a definition revision.
 */
export const memoryOutcomes = pgTable(
  "memory_outcomes",
  {
    id: text("id").primaryKey(),
    /** observation · incident */
    kind: text("kind").notNull(),
    /** The occurrence this row belongs to: a hash of subject, check and environment for an observation, its own id for an incident. */
    occurrenceId: text("occurrence_id").notNull(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    /** The photographed revision of the note, decision, criterion or commitment observed. */
    subjectRevisionId: text("subject_revision_id").notNull().references(() => memoryRevisions.id, { onDelete: "restrict" }),
    checkId: text("check_id"),
    checkRev: bigint("check_rev", { mode: "number" }),
    /** `{ schemaVersion, environmentId, projectRef, resolvedRoot, head?, dirtyFingerprint?, observedAt, inspected }`. */
    environment: jsonb("environment").$type<Record<string, unknown>>().notNull(),
    /** pass · fail · unknown */
    result: text("result").notNull(),
    /** `{ schemaVersion, sourceRefs, checkRevision?, observedCoverage, deliveredBefore, reason }`. */
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    sourceId: text("source_id").references(() => memorySources.id, { onDelete: "restrict" }),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** confirmed · false_positive, the owner's word on an incident; null until they speak. */
    ownerVerdict: text("owner_verdict"),
    verdictRev: bigint("verdict_rev", { mode: "number" }).notNull().default(1),
  },
  (table) => [
    index("memory_outcomes_occurrence_idx").on(table.occurrenceId),
    index("memory_outcomes_subject_idx").on(table.subjectRevisionId),
    index("memory_outcomes_project_idx").on(table.projectId, table.createdAt),
    check("memory_outcomes_kind_check", sql`${table.kind} in ('observation', 'incident')`),
    check("memory_outcomes_result_check", sql`${table.result} in ('pass', 'fail', 'unknown')`),
    check("memory_outcomes_check_pair_check", sql`(${table.checkId} is null) = (${table.checkRev} is null) and (${table.checkRev} is null or ${table.checkRev} > 0)`),
    check("memory_outcomes_verdict_check", sql`${table.ownerVerdict} is null or ${table.ownerVerdict} in ('confirmed', 'false_positive')`),
    check("memory_outcomes_verdict_rev_check", sql`${table.verdictRev} > 0`),
  ],
);

/**
 * The logical bytes of derived memory content, per catalog and per project (plan §25.3): the
 * canonical payloads of the photographs, the offers, the typed facts and the staged answers,
 * counted by the writer in the same transaction that adds them and reduced by the writer that
 * removes them. It is accounting, not a measure of the database on disk: the quota it is
 * compared with pauses new automatic retention when reached, never prunes pending or cited
 * evidence to make room, and is reconciled from the rows themselves (`reconcileUsage`).
 */
export const memoryUsage = pgTable(
  "memory_usage",
  {
    /** `catalog` for the whole catalog (one row, key `catalog`), `project` for one project by id. */
    scopeKind: text("scope_kind").notNull(),
    scopeKey: text("scope_key").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKind, table.scopeKey] }),
    check("memory_usage_scope_kind_check", sql`${table.scopeKind} in ('catalog', 'project')`),
    check("memory_usage_bytes_check", sql`${table.bytes} >= 0`),
  ],
);

/**
 * The durable intention and progress of a withdrawal or a purge — never a payload.
 *
 * Every operation is also appended, before the database is touched, to
 * `PANOMA_HOME/memory-deletions.jsonl`, a journal that sits outside what a database backup
 * restores: a copy taken before a purge must not bring the purged text back in silence, and the
 * journal is how a restored catalog learns which deletions it has to honour or quarantine
 * itself. `targets` names ids, origins, stores and counts; `progress` keeps the checkpoint, the
 * pending stores and the last error code. The intention is immutable; progress moves by CAS.
 * `complete` demands a date and every store confirmed. The `baseline` operation is written once
 * when this delivery initializes, so the journal exists before there is anything to delete.
 */
export const memoryDeletions = pgTable(
  "memory_deletions",
  {
    id: text("id").primaryKey(),
    journalId: text("journal_id").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    /** baseline · withdraw · purge */
    operation: text("operation").notNull(),
    /** pending · cleaning · complete · failed */
    state: text("state").notNull().default("pending"),
    targets: jsonb("targets").notNull(),
    progress: jsonb("progress").notNull(),
    rev: bigint("rev", { mode: "number" }).notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    reason: text("reason"),
  },
  (table) => [
    uniqueIndex("memory_deletions_journal_idx").on(table.journalId, table.sequence),
    index("memory_deletions_state_idx").on(table.state, table.sequence),
    check("memory_deletions_sequence_check", sql`${table.sequence} > 0`),
    check("memory_deletions_rev_check", sql`${table.rev} > 0`),
    check("memory_deletions_operation_check", sql`${table.operation} in ('baseline', 'withdraw', 'purge')`),
    check("memory_deletions_state_check", sql`${table.state} in ('pending', 'cleaning', 'complete', 'failed')`),
    check("memory_deletions_complete_check", sql`${table.state} <> 'complete' or ${table.completedAt} is not null`),
  ],
);

export const launches = pgTable(
  "launches",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /**
     * The assignment of the tail, when it left the tail.
     *
     * Null in the four drafts written on the fly, which are written at the moment of being
     * launched and leave no homework: there what identifies the task is its `kind`. The two
     * columns are mutually exclusive and both can be missing in the other row, so none can be
     * requested.
     */
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    /** Which of the drafted assignments was null when it came from the queue. */
    kind: text("kind"),
    /** The agent that opened it, by name —«Claude Code»— rather than by binary. */
    agent: text("agent").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  // The screen asks 'what has been launched from this project, the latest first'.
  (table) => [index("launches_project_idx").on(table.projectId, table.at)],
);

/** What could not travel in a handoff, counted; mirrors `Dropped` in `@panoma/handoff`. */
export interface HandoffDropped {
  thinking: number;
  images: number;
  subagents: number;
  offloaded: number;
  secrets: number;
  other: number;
}

/**
 * The receipt of a handoff: which conversation became which, when, at which tier, what was left
 * behind, and the command that resumes it. Never the text — the conversation itself lives in the
 * agents' own stores and panoma keeps no copy of it.
 *
 * Never comes back. A rescan of the disk recomputes nothing here: the receipt records an event a
 * person asked for, so it hangs off `project_id` with `set null` (a conversation whose folder is
 * not in the catalog still gets a receipt) and joins the `rehomeMemory` family when a folder
 * moves. `resume_command` is the display line the server derived from `target_agent` and
 * `target_session_id`; it never comes from a client and it is never executed as stored — argv is
 * re-derived every time from a binary the detector verified.
 */
export const handoffs = pgTable(
  "handoffs",
  {
    /** `hnd_` + random: a receipt is born of an event, and two handoffs of one conversation are two rows. */
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    /** The folder the conversation belongs to, kept even when it is not a catalog project. */
    cwd: text("cwd").notNull(),
    /** The source title, redacted before it is stored. */
    title: text("title"),
    /** Canonical provider ids: `claude-cli`, `codex-cli`, `opencode`, `gemini-cli`… */
    sourceAgent: text("source_agent").notNull(),
    sourceSessionId: text("source_session_id").notNull(),
    sourcePath: text("source_path").notNull(),
    /** sha256 over the normalized turns: the key that says 'this one was already handed to that agent'. */
    sourceHash: text("source_hash").notNull(),
    targetAgent: text("target_agent").notNull(),
    /**
     * `cli` or `app`: the terminal, or the vendor's desktop app, which shares the store. The file
     * is the same either way; the surface decides which door the receipt opens (a command or a
     * deep link) and keys the 'already handed to Claude (app)' check together with the agent.
     */
    targetSurface: text("target_surface").$type<"cli" | "app">().notNull().default("cli"),
    targetSessionId: text("target_session_id").notNull(),
    targetPath: text("target_path").notNull(),
    tier: text("tier").$type<"full" | "compact" | "brief">().notNull(),
    turns: integer("turns").notNull(),
    bytes: integer("bytes").notNull(),
    dropped: jsonb("dropped")
      .$type<HandoffDropped>()
      .notNull()
      .default({ thinking: 0, images: 0, subagents: 0, offloaded: 0, secrets: 0, other: 0 }),
    resumeCommand: text("resume_command"),
    /**
     * The agent that asked for it over the MCP channel (`panoma_handoff`), by the name its key
     * was issued under; `null` when a person did, from the screen or the terminal. Attribution,
     * not authority: the channel's gate is the operator's, and the name is what the receipt says
     * afterwards.
     */
    requestedBy: text("requested_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The project card and the screen ask 'what was handed off from here, the latest first'.
    index("handoffs_project_idx").on(table.projectId, table.createdAt),
    // The panel asks 'was this conversation already handed to that agent?' before writing again.
    index("handoffs_source_idx").on(table.sourceHash, table.targetAgent),
  ],
);

/**
 * Execution dispatched on a project.
 *
 * The result is never an applied change: it is a branch and a patch awaiting review. `verified`
 * distinguishes 'the tests pass' from 'there were no tests,' which is the difference between a
 * verified proposal and a gamble — and mixing them would be the worst form of lying.
 */
export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    /** bump-dependencia · (futuras recetas) */
    kind: text("kind").notNull(),
    /** pending · running · proposed · failed · no-changes · applied · discarded */
    status: text("status").notNull().default("pending"),
    /** What was requested to change: package, target version, ecosystem. */
    target: jsonb("target").notNull(),
    summary: text("summary"),
    verified: boolean("verified").notNull().default(false),
    /** local · hardened · container — with what insulation it actually ran. */
    isolation: text("isolation").notNull().default("local"),
    /** Reason if a higher level was requested and could not be provided. */
    isolationNote: text("isolation_note"),
    branch: text("branch"),
    patch: text("patch"),
    commitSha: text("commit_sha"),
    /** Each command executed with its exit code and its output. */
    steps: jsonb("steps"),
    requestedBy: text("requested_by").notNull().default("human"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("runs_project_idx").on(table.projectId, table.createdAt)],
);

/**
 * What the person decided, separate from what the machine deduced.
 *
 * `projects` derives from the disk: if you delete the row and rescan, it comes back the same. Not
 * this. Hiding a project is a decision, and a description written by a model costs a paid call.
 * The ingestion tried not to overwrite them column by column, but that caution evaporated as soon
 * as the path changed: `id` is the SHA1 of the path, so renaming a folder created a new project,
 * removed the old one, and wiped out what the user had written.
 *
 * The key is the stable identity —the root commit of the repository— and not the path. See
 * `packages/core/src/identity.ts`.
 *
 * `projects` can be deleted entirely without losing anything from here, which is exactly the
 * property that was sought.
 */
export const decisions = pgTable("decisions", {
  /** Stable identity, not the project ID. */
  identity: text("identity").primaryKey(),
  /**
   * Out of the main view, but within the catalog. For folders that are real projects and still get
   * in the way in the grid.
   */
  hidden: boolean("hidden").notNull().default(false),
  /** Description written by a model, with which one and when. It never replaces the others. */
  aiSummary: text("ai_summary"),
  aiSummaryModel: text("ai_summary_model"),
  aiSummaryAt: timestamp("ai_summary_at", { withTimezone: true }),
  /**
   * And in what language was it written, which is what was missing.
   *
   * This text is one of the few in the catalog that **cannot follow the reader**: it was requested
   * once, it caused a paid call, and it stays written. Until August 25, 2026, the prompt set plain
   * Spanish, so the entry in English showed a paragraph in Spanish as if it were its own and there
   * was no way to know — nor to distinguish what was saved before the fix.
   *
   * Saving it translates nothing: it allows **to say it**. Null means «written before this
   * existed», and there the language is Spanish according to how the prompt was.
   */
  aiSummaryLang: text("ai_summary_lang"),
  /**
   * The fingerprint of the material the description was written from: name, declared
   * description, stack, services, stores, commit subjects, README. Like `mdReviewHash`, it says
   * which version of the project the text refers to — and here it also saves money: pressing the
   * button again on an unchanged project returns the saved text instead of paying a second call
   * for the same paragraph. Null means written before the fingerprint existed and is treated as
   * unknown, so the next press pays once and then stores it.
   */
  aiSummaryHash: text("ai_summary_hash"),
  /**
   * The model's opinion on the agents' instruction file: contradictions, redundancy, what is
   * missing. Like the description: a call is required, it is requested manually (`panoma md
   * review`), it is signed with model and date, and it is never regenerated on its own. The
   * footprint indicates which version of the files it opined on — when the .md changes, the record
   * warns that the opinion has aged instead of pretending it is still fresh.
   */
  mdReview: text("md_review"),
  mdReviewModel: text("md_review_model"),
  mdReviewAt: timestamp("md_review_at", { withTimezone: true }),
  mdReviewHash: text("md_review_hash"),
  /** In what language was it written. Same reason as `aiSummaryLang`, same treatment of the null. */
  mdReviewLang: text("md_review_lang"),
  /**
   * The project's accounts and links, written by the user: which email is associated with the
   * deployment account, where the domain is hosted, the control panel that's always hard to find.
   * This is the non-secret half of 'picking up after eight months' — passwords and keys never go
   * here (that's requested by the system Keychain, separate phase). In decisions and not in
   * projects for the usual reason: it was written by one person and survives renaming. Format: [{
   * label, url?, email?, note? }].
   */
  accounts: jsonb("accounts"),
  /**
   * What "open everything" opens for this project, in order: the plan.
   *
   * A list of steps by key —`editor:cursor`, `terminal`, `link:service:repository`—, plus the one
   * command a terminal step may carry and the address of a link the owner added by hand. In
   * decisions and not in projects for the same reason as the accounts: a person wrote it, and a
   * folder that moves must not lose it. Shape and rules in `apps/web/lib/open-all.ts`; whatever
   * is not a plan reads back as "no plan".
   */
  openPlan: jsonb("open_plan"),
  /**
   * The latest verdict of 'does this still compile?'.
   *
   * Health deduces; this demonstrates: `panoma check` lifts an ephemeral worktree, installs
   * without scripts, and runs the project's build in isolation, and here is the result with a date
   * — “compiled on Aug 18 in 41s” or “broken: missing OPENAI_API_KEY”. In decisions because it is
   * a conquered fact, not derived from the disk: a re-scan must not erase it. Form: { status, at,
   * durationMs, command?, isolation, isolationNote?, reason?, sha?, dirty? }.
   */
  buildCheck: jsonb("build_check"),
  /**
   * What is 'finished' in this project, and for whom. One line, written by the person.
   *
   * It is half of the daily question that the catalog did not know how to answer. Panoma can say
   * what a **project** is —it deduces it from the entire disk— and cannot say what needs to be
   * done in it, because "the next" only means something in relation to a destination, and the
   * destination is not written in any file: it lives in the head of the one who started it.
   * Without this line, any order proposed by the catalog is a well-presented guess.
   *
   * In `decisions` and not in `projects` because of what the header of this table argues: the row
   * of `projects` is derived from the disk and can be completely deleted without losing anything,
   * and this is not derived from anything. A README is read again in the next scan; 'let my
   * brother install it without calling me' never returns.
   *
   * Voidable and null by default, on purpose: 'nobody has written it yet' is a real and the most
   * common state, and it is precisely what makes the director have something to request. An empty
   * string by default would make the silence of the response indistinguishable.
   */
  north: text("north"),
  /** The last known name, just so that a list of orphaned decisions reads. */
  lastName: text("last_name"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Folders that the user has removed from the catalog.
 *
 * It exists because deleting a project and rescanning it would bring it back, and a delete button
 * whose effect is undone only on the next scan is not a delete button: it is a joke. The exclusion
 * is by the user and survives scans.
 *
 * The route is the key, not the id: the id is a hash of the route, so they are the same, but the
 * route can be read and can be manually removed from the table if necessary.
 */
export const exclusions = pgTable("exclusions", {
  root: text("root").primaryKey(),
  /** The name it had, in order to be able to teach a list that can be understood. */
  name: text("name").notNull(),
  excludedAt: timestamp("excluded_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Families of copies of the same project. */
export const families = pgTable("families", {
  /** sha1 of the canonical path. */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  canonicalProjectId: text("canonical_project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  canonicalReason: text("canonical_reason").notNull(),
  redundantBytes: integer("redundant_bytes").notNull().default(0),
});

export const familyMembers = pgTable(
  "family_members",
  {
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    confidence: real("confidence").notNull(),
    reason: text("reason").notNull(),
    daysBehind: integer("days_behind"),
  },
  (table) => [
    primaryKey({ columns: [table.familyId, table.projectId] }),
    index("family_members_project_idx").on(table.projectId),
  ],
);

/**
 * A judgment of the person: undermined by their agent history or said within the app.
 *
 * It hangs from the **stable identity** and not from `projects.id`, just like `decisions` and for
 * the same reason — but here the cost of making a mistake is higher. `projects.id` is the sha1 of
 * the absolute path, so renaming a folder removes one project and creates another. With
 * `decisions` it would wipe out a description that cost a paid call; with this it would take the
 * only thing in the entire catalog that **cannot be recomputed**. The design footprint below is
 * retrieved from the disk in a scan; a “no, not like that” at eleven at night doesn’t come back,
 * because the transcript of the one who left may have been deleted and because no one is going to
 * give the same opinion twice.
 *
 * And **there is no foreign key**, neither against `projects` nor against `decisions`. A mined
 * verdict comes from a `cwd` in the history —see rule 7 of
 * `packages/core/src/history/claude-code.ts` — and half of those folders no longer exist:
 * ephemeral worktrees, `apps/web` inside a monorepo, projects that moved to another drive. With a
 * foreign key, mining a year and a half of conversations would completely crash because of the
 * first dead folder; or, worse, you would have to silently discard precisely the verdicts of the
 * projects that are no longer there, which are the ones that show how you worked. The identity is
 * kept as is and is resolved by whoever has the catalog in front of them.
 */
export const verdicts = pgTable(
  "verdicts",
  {
    /** Determinista: sha1 de (source, sessionId, at, quote). Ver `saveVerdicts`. */
    id: text("id").primaryKey(),
    /** Stable identity of the project, without foreign elements and without any guarantee that it exists. */
    identity: text("identity").notNull(),
    /** claude-code · codex · interview · critic · director */
    source: text("source").notNull(),
    /** The source session. For mined entries, this is the transcript UUID. */
    sessionId: text("session_id").notNull(),
    /** When did you say it. */
    at: timestamp("at", { withTimezone: true }).notNull(),
    category: text("category"),
    /** Your words, already drafted by `redactQuote`. No secret fits in here. */
    quote: text("quote").notNull(),
    /** What you were looking at when you said it: the delivery, trimmed. */
    context: text("context"),
    /** The detected signals, as returned by `detectSignals`. Format: string[]. */
    signals: jsonb("signals").notNull(),
    /**
     * Three states on purpose, and the one that matters is the third: `null` is 'I haven't looked
     * at it yet,' `true` is 'yes, this is me,' `false` is 'this does not represent me.'
     *
     * A two-state boolean would force birth in `false`, and then "unreviewed" and "rejected" would
     * be the same row: the first sweep would leave thousands of entries marked as rejected without
     * anyone having read them, and from there on there is no way to distinguish silence from no.
     * Review is slow and voluntary —these are thousands of phrases—, so most of these rows are
     * going to live forever in `null`, and that has to be able to be said instead of pretending.
     */
    accepted: boolean("accepted"),
    /**
     * When was this quote taught to a model for the first time.
     *
     * It is what makes distillation progress. Without it, each pass would choose exactly the same
     * ones —those that bring a signal, and among those the recent ones—, the model would write the
     * same sentences, the deterministic identifier would make them collide with the already
     * decided rows, and it would propose nothing. Measured here: 2,264 verdicts saved, 203 read in
     * the first pass, and a second that would have reread those same 203. 91% of the corpus was
     * unreachable.
     *
     * What is marked is the **sent** and not the **cited**, which are very different things: of
     * those 203, only 33 ended up supporting a statement. Filtering by what is cited would advance
     * 33 rows per pass — sixty-eight passes to go through this corpus — and would again pay to
     * look at material that a model has already considered and did not find useful. A citation
     * that was sent and not used is not an unread citation: it is one that has already been
     * judged.
     *
     * It is born null and **is not filled backwards**, because what was sent in the first pass was
     * not recorded anywhere and reconstructing it would be inventing it. The consequence is
     * accepted and stated: the first pass with this column overlaps with the previous one and
     * produces few new sentences. It is one pass, and from there each one advances two hundred.
     *
     * `coalesce(distilled_at, now())` when dialing: remember the first time and none of the
     * following, just like `taste_entries.decided_at`.
     */
    distilledAt: timestamp("distilled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /*
      By `createdAt` and not by `at`, which is the field that seems to be the correct one.
      `at` comes from the transcript and the real corpus has lines without `timestamp` —the miner
      returns an empty string when there isn't any—, so whoever translates a reaction to a row
      will have to make something up. `createdAt` is set by the database and doesn't depend on
      anyone: it's the only thing with which a review list can be ordered without a 1970 row
      sneaking in at the beginning.
     */
    index("verdicts_identity_idx").on(table.identity, table.createdAt),
    // The review screen always asks the same thing: 'give me what I haven't looked at yet'.
    index("verdicts_accepted_idx").on(table.accepted),
  ],
);

/**
 * Human narratives preserve the opening request and structured briefs as well as reactions.
 * They belong to stable project identities, without a project foreign key: moving or rescanning
 * a folder must not erase what its owner said. A read marker records completed extraction even
 * when the model found no decision episode. Source material remains separate from model output.
 */
export const narratives = pgTable(
  "narratives",
  {
    id: text("id").primaryKey(),
    identity: text("identity").notNull(),
    source: text("source").notNull(),
    sessionId: text("session_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    kind: text("kind", { enum: ["opening", "reaction", "brief"] }).notNull(),
    text: text("text").notNull(),
    /** Agent delivery for interpretation only; it is never evidence of the owner's judgment. */
    context: text("context"),
    truncated: boolean("truncated").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    /**
     * When a paid pass over this record came back unusable. The next pass takes the records that
     * never failed first, so one batch the model cannot ground rotates behind the rest instead of
     * being re-selected —and re-paid— on every click until the day's budget is gone.
     */
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("narratives_identity_idx").on(table.identity, table.at),
    index("narratives_read_idx").on(table.readAt, table.at),
  ],
);

/**
 * Decision episodes retain goals, tradeoffs and exceptions before any preference is summarized.
 * History fields cite their human narrative; owner-authored episodes have no model attribution.
 * Dismissal is a durable owner decision and is never overwritten by repeated extraction.
 * Like narratives, these records survive a project disappearing from the catalog.
 */
export const decisionEpisodes = pgTable(
  "decision_episodes",
  {
    id: text("id").primaryKey(),
    identity: text("identity"),
    /** Explicit owner revision link; the earlier episode remains available as decision history. */
    supersedesId: text("supersedes_id"),
    origin: text("origin", { enum: ["owner", "history"] }).notNull(),
    fields: jsonb("fields").notNull(),
    model: text("model"),
    status: text("status", { enum: ["active", "dismissed"] }).notNull().default("active"),
    /**
     * When this decision stops applying, or null for one that never does — which is every row
     * written before 6-Sep-2026 and the default for every new one. Nothing expires by itself: the
     * owner writes the date, and only the delivery to an agent reads it.
     *
     * The owner gives a calendar day and it is stored as that day at 23:59:59.999 **UTC**, so the
     * decision holds through the end of that day. A date carries no timezone, and dressing one up
     * as a local midnight is the bug this avoids: the same `2026-12-31` would mean a different
     * instant on every machine that wrote it.
     *
     * It is a column and not a field of `fields` because `episodeId` hashes `fields`: a date in
     * there would change the identifier of a record whose testimony never changed, so an
     * idempotent retry of the same save would store a second copy instead of returning the first.
     */
    validUntil: timestamp("valid_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** The delivery revision. It neither replaces `supersedes_id` nor changes the episode's id. */
    memoryRev: bigint("memory_rev", { mode: "number" }).notNull().default(1),
    /**
     * `global` · `project` · `unresolved`. A null identity used to mean "every project" by the
     * shape of the schema alone; the backfill keeps that meaning for the rows that already exist
     * and writes it down. A new row without a resolved project is `unresolved`: visible to the
     * owner so the attribution can be repaired, never delivered to another project.
     */
    scopeKind: text("scope_kind").notNull().default("unresolved"),
    /**
     * The typed conditions and exceptions of delivery C: `{ schemaVersion: 1, expression }` as
     * `packages/core/src/predicates.ts` validates them, or null when none is declared. Null never
     * means the narrative was checked; the narrative in `fields` stays whole beside them.
     */
    conditionsPredicate: jsonb("conditions_predicate").$type<Record<string, unknown>>(),
    exceptionsPredicate: jsonb("exceptions_predicate").$type<Record<string, unknown>>(),
    /** The checks of this decision (delivery C): `{ schemaVersion, checkId, revision, purpose, kind, target, expected }[]`. */
    checks: jsonb("checks").$type<Record<string, unknown>[]>().notNull().default([]),
  },
  (table) => [
    index("decision_episodes_identity_idx").on(table.identity, table.status, table.createdAt),
    index("decision_episodes_supersedes_idx").on(table.supersedesId),
    check("decision_episodes_memory_rev_check", sql`${table.memoryRev} > 0`),
    check("decision_episodes_scope_kind_check", sql`${table.scopeKind} in (${SCOPE_KINDS})`),
    check(
      "decision_episodes_scope_identity_check",
      sql`(${table.scopeKind} <> 'global' or ${table.identity} is null) and (${table.scopeKind} <> 'project' or ${table.identity} is not null)`,
    ),
  ],
);

/**
 * The evidence: a sentence that the distiller took from your quotes and that **no one has to
 * approve**.
 *
 * It is the table that replaces `taste_entries`, and the name change is the product change. That
 * one was a review queue: each sentence was born with `accepted` as null and stayed there until
 * someone signed it. With 2,278 citations in the author's corpus, that is hundreds of decisions,
 * and the author—the most motivated user this product will have—got bored on the nineteenth. A
 * review queue is O(corpus) work, and no design that asks someone to do work the size of their
 * history survives the first day. Worse: it recreated within the product the shift that the
 * product exists to remove —reading what a machine delivered and judging it one by one—, which is
 * what `EL-DOBLE.md` calls the third shift.
 *
 * So a distilled sentence is no longer a proposal: it is an **observation**. It is not reviewed,
 * not exported, and does not reach any agent. It is material. What reaches the agents are the
 * beliefs of `beliefs`, and those are written by the synthesis reading all of this at once.
 *
 * The pyramid, with the numbers from this catalog: 2,278 quotes → a few hundred observations →
 * about twenty-five beliefs → **zero mandatory approvals**.
 *
 * ── The topic, and why it is kept here and not deduced afterwards ──────────────────────
 *
 * An observation is filed by subject —`design`, `backend`, `testing` …— and the summary goes **by
 * topic**: all the design stuff together, so you can say what this person asks from design.
 * Without that, a single call with hundreds of mixed phrases returns generalities, which is
 * exactly what the portrait cannot be.
 *
 * `classified` exists because the vocabulary was not available on the day the rows that this table
 * inherits were written: everything that came from `taste_entries` goes into `other` and
 * unclassified, and a pass of the classifier distributes them. It is born in `false` and not in
 * `true` because the honest value for a migrated row is 'no one has checked what it's about,' and
 * a `default true` would have said that all of them were in the drawer on purpose.
 */
export const observations = pgTable(
  "observations",
  {
    /** Determinista: sha1 de (identity, statement). Ver `saveObservations`. */
    id: text("id").primaryKey(),
    /**
     * Stable identity of the project where it was said, or **null** when the observation is of the
     * entire portfolio. It is what makes a belief able to be bounded: if all the evidence for a
     * belief comes from one project, the belief holds there and not in the other one hundred and
     * eleven.
     */
    identity: text("identity"),
    /** The matter. See `TASTE_TOPICS` in `@panoma/core`, and `classified` here next to it. */
    topic: text("topic").notNull(),
    /** If someone has seen what it’s about. See the block above. */
    classified: boolean("classified").notNull().default(false),
    /** What the distiller read in your quotes. It is not written in any file. */
    statement: text("statement").notNull(),
    /**
     * The verdicts on which it is based: id, citation, and date. Format: `TasteCitation[]`.
     *
     * Copied and not resolved by an outsider against `verdicts`, just like before and for the same
     * reason: the quote is the receipt that is displayed under a belief, and it has to remain
     * legible after a `twin forget codex`.
     */
    citations: jsonb("citations").notNull(),
    /** Which model wrote it. The house signs with model and date what a model writes. */
    model: text("model").notNull(),
    /**
     * When it was said: the date of your most recent appointment.
     *
     * It is not `createdAt`, which is when it was distilled. The synthesis weighs the recent so
     * that a belief that has lost support can be withdrawn, and for that, 'recent' has to mean
     * when you said it, not when the machine read it. With `createdAt`, a distillation run today
     * would leave a March verdict just as fresh as one from yesterday.
     */
    at: timestamp("at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * When it entered its current topic. This is not the same as when it was distilled.
     *
     * It is the column that answers ‘Has anything new come in this subject?’, which is what
     * decides whether it is resynthesized. `created_at` answers another question —when the quote
     * was read— and using it for this froze entire subjects: an observation from March that the
     * classifier distributes today to `security` does not move `created_at`, so `security` still
     * seemed behind with respect to its own beliefs and was not resynthesized. And since
     * `created_at` is immutable, no future pass would unlock it: you just have to request the
     * subject by its name.
     *
     * It moves when distilling —the row is born with its material in place— and when distributing.
     * No gesture of the person moves it: what it measures is the arrival of material, not
     * decisions.
     */
    topicAt: timestamp("topic_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * The delivery revision of the observation (delivery D): reclassifying moves it and
     * photographs the row; the backfill set it to the highest photographed revision or 1.
     */
    memoryRev: bigint("memory_rev", { mode: "number" }).notNull().default(1),
    /**
     * The independence unit of §10.2: `<harness>:<native session key>:<recipient>` for a turn read
     * from a stream, `teach:<gesture>` for a lesson; a copy or the system's own output carries
     * `copied:` and never counts. Null for the legacy rows, whose origin is unknown.
     */
    caseOriginKey: text("case_origin_key"),
    /**
     * What the distiller read the turn as (plan §21.3, delivery D): a reaction, a choice, a
     * reason, a condition, an exception, a counterexample or a correction. Null for a legacy row
     * and for a statement filed without one; never a guess.
     */
    kind: text("kind"),
    /**
     * What a reaction or a choice was about, as the distiller read it. The literal `unknown` is
     * the ambiguous case the plan names — «perfecto» with no object — which no synthesis reads as
     * a preference; null when the kind names no referent or the row is a legacy one.
     */
    referent: text("referent"),
  },
  (table) => [
    // The synthesis always asks the same thing: 'give me what is on this topic, the most recent
    // first.'
    index("observations_topic_idx").on(table.topic, table.at),
    index("observations_origin_idx").on(table.caseOriginKey),
    check("observations_memory_rev_check", sql`${table.memoryRev} > 0`),
    check("observations_kind_check", sql`${table.kind} is null or ${table.kind} in ('reaction', 'choice', 'reason', 'condition', 'exception', 'counterexample', 'correction')`),
    // And the classifier: «what remains to be seen».
    index("observations_classified_idx").on(table.classified),
  ],
);

/**
 * A belief: one of the twenty things that this person thinks about how they want their work to
 * turn out. It is what is written in `TASTE.md` and the only thing that reaches the agents.
 *
 * ── The trust rule, which replaces the signature with a phrase ─────────────────────
 *
 * **The model freely rewrites what the model inferred; it asks permission to touch what the person
 * signed.** By default nothing is signed, so by default it asks nothing —which is what this entire
 * increment is about—. Signing is voluntary and is done in one of two ways: by editing the
 * sentence, or by saying that it is fine as it is.
 *
 * This amends two invariants that `TWIN-PLAN.md` had written —"approved entry by entry" and
 * "nothing self-applies"— and it is worth saying it out loud here instead of slipping it in. What
 * replaces the signature as a security mechanism are four things, and all four are in this scheme:
 * the evidence is shown in full (`citations`), there is a floor below which a belief does not
 * leave the screen (`support`), the veto is definitive and is negative evidence (`state =
 * 'vetoed'`), and the file continues to be undo.
 *
 * ── Why the `id` is not derived from the content ────────────────────────────────────
 *
 * Unlike everything else in this house. A belief **is rewritten**: next week's summary is refined
 * with the new evidence, and that is their job. With an id derived from the text, refining a
 * sentence would turn it into another row and its signature, veto, and history would be lost —
 * that is, exactly what needs to be preserved. The id is random and stable, and the text is what
 * changes.
 */
export const beliefs = pgTable(
  "beliefs",
  {
    /** Random and stable. See the block above: here the content changes. */
    id: text("id").primaryKey(),
    /** The subject. See `TASTE_TOPICS` in `@panoma/core`. */
    topic: text("topic").notNull(),
    /** If someone has looked at what it is about. False in what is inherited from `taste_entries`. */
    classified: boolean("classified").notNull().default(true),
    /** The sentence, exactly as it is written in `TASTE.md`. */
    statement: text("statement").notNull(),
    /**
     * The project to which it is limited, or **null** for 'it is valid in everything you do'.
     *
     * It is proposed by the synthesis and only when all its evidence comes from the same project;
     * it is decided by the person with a click. By identity and not by name, as in `verdicts`: the
     * name goes down to the file, which is what is read and corrected, but what is saved has to
     * survive someone renaming the folder.
     */
    identity: text("identity"),
    /**
     * `inferred` · `signed` · `vetoed` · `retired` · `proposed`.
     *
     * - **`inferred`** — wrote the synthesis and no one has touched it. It rewrites itself.
     * - **`signed`** — the person edited it or said it was fine. **It is never rewritten**, and
     * the wall is mechanical: `applySynthesis` does not put the signed ones into the set it writes
     * on. An instruction in the prompt would not have been a wall, it would have been a plea.
     * - **`vetoed`** — the cemetery, and it is negative evidence: the synthesis sees it and cannot
     * propose the same thing again. A veto that only erased the row would make it reappear in the
     * next round, and the user would have to veto the same thing every week.
     * - **`retired`** — the synthesis stopped being written because the evidence no longer
     * supports it. It is not deleted: silent withdrawal is the silent compaction that `taste.ts`
     * forbids, moved one floor up.
     * - **`proposed`** — the only tail that remains. The synthesis wants to replace a **signed**
     * belief, and it cannot do that on its own. See `supersedes`.
     */
    state: text("state").notNull(),
    /**
     * Only in `proposed`: the `id` of the **signed** beliefs that this one would like to replace.
     * Form: `string[]`.
     *
     * A list and not an ID, and that is what makes the portrait able to shrink. The synthesis
     * joins what is repeated by construction, but only among what it can rewrite: two signed
     * beliefs it cannot touch, so without this the two remain forever saying the same thing, and
     * the limit ends up refusing to write anything. Measured when migrating the author's catalog:
     * twenty-seven signed, fifteen of them design, and a portrait of 3,189 characters against a
     * limit of 3,000.
     *
     * With the list, the machine can ask "these three say the same thing, should I merge them?"
     * and one answer solves three. It still can't do it on its own: it's a proposal, and the
     * person sees the full ones that would disappear before answering.
     */
    supersedes: jsonb("supersedes"),
    /**
     * A handful of literal quotes, for the drawer that unfolds beneath belief.
     *
     * Trimmed to the most recent and not all: a belief with forty-three observations behind it has
     * hundreds of citations, and keeping them whole in each row would be copying the corpus once
     * per belief. The real counts are in `support`, which is what decides whether the belief comes
     * out; this is what is taught.
     */
    citations: jsonb("citations").notNull(),
    /**
     * How much evidence supports it: `{ observations, projects, days }`.
     *
     * It is the ground of trust. A belief only comes out of the screen —and goes down to
     * `TASTE.md` — with three observations and evidence from two different days or two different
     * projects. Inferring without asking, yes; noise directing agents, no.
     *
     * It is calculated when written and saved, instead of being deducted from a list of IDs with a
     * `join`. The reason is the usual one in this house: citations are copied so that they remain
     * readable after a `twin forget`, and an account that depended on the `observations` rows
     * would decrease on its own the day someone deletes their history — removing beliefs due to a
     * deletion that does not contradict them.
     */
    support: jsonb("support").notNull(),
    /**
     * The typed conditions and exceptions of delivery D, a predicate of
     * `packages/core/src/predicates.ts` or null: null means none is declared, never that the
     * narrative was checked. A criterion is applicable only when its conditions are true and its
     * exceptions false; an unknown decisive exception asks to be checked.
     */
    conditions: jsonb("conditions").$type<Record<string, unknown>>(),
    exceptions: jsonb("exceptions").$type<Record<string, unknown>>(),
    /**
     * The independence behind an inference, since delivery D: `{ schemaVersion, supportPolicyVersion,
     * families, counts, refs }`, derived from the observations' origin keys and never from a model.
     * Legacy rows keep null and their policy; a new or revised inference publishes automatically
     * only with three families of known origin besides the floor `support` still guards.
     */
    supportEvidence: jsonb("support_evidence").$type<Record<string, unknown>>(),
    /** Which model wrote it. Empty when the person editing it wrote it. */
    model: text("model").notNull(),
    /** When the person signed it. Null while it is inferred. */
    signedAt: timestamp("signed_at", { withTimezone: true }),
    /** When it was vetoed. Null except in the cemetery. */
    vetoedAt: timestamp("vetoed_at", { withTimezone: true }),
    /** When did the evidence stop supporting it. None except withdrawn. */
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    /**
     * **What was written** in `TASTE.md` the last time, and not only when. Format:
     * `{ topic, statement, scope? }`, or null if it has never reached the file.
     *
     * It exists to distinguish three things that the file does not distinguish and that demand the
     * opposite: a belief that **has never been written** —it must be added—, one that **was
     * written and is no longer** —the person deleted it, so they vetoed it— and one whose **line
     * is old because the machine changed the row** —it must be rewritten—.
     *
     * A single date only distinguished the first two, and that third is the path most traveled:
     * refining is the normal work of synthesis. Measured: a published belief that synthesis
     * refines stops matching by text and citation mark, so reconciliation was read as handwritten
     * — it was vetoed, sent to the cemetery as negative evidence that can no longer be proposed,
     * its old line left in the file and the correction marker raised. Each pass of synthesis
     * killed what had just been improved.
     *
     * With the written text saved, the question is answered by comparing: if the line in the file
     * says the same thing that was written, no one has touched it and the row is sent; if it says
     * something else, the person touched it and the file is sent.
     *
     * It is written **after** the file is actually written and within the same transaction: a save
     * that does not fit throws, the transaction is rolled back, and no belief is marked as
     * published without being so.
     */
    publishedAs: jsonb("published_as"),
    /**
     * The last time its text or evidence changed. **Only that.**
     *
     * It is from what comes out the 'tuned' from the screen summary and the metric that says if
     * this converges: a synthesis that rewrites half a dozen beliefs each pass is not tuning, it
     * is shuffling.
     *
     * The person's gestures **do not move it**, even if the row changes: veto, bracket, and
     * withdraw each have their own date. Moving it, vetoing two beliefs and bracketing three read
     * as "tuned: 5" without the machine having written a word — meaning that the person's gestures
     * were counted as churn by the machine. The only exception is signing **by editing**, because
     * that does change the text.
     */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * The delivery revision, independent of `updated_at`, whose meaning — "the machine changed
     * the text or the evidence" — is kept as it is. Statement, state, scope and support move this
     * one; publication, the delivery mode (which moves `delivery_policy_rev`) and a serving do not.
     */
    memoryRev: bigint("memory_rev", { mode: "number" }).notNull().default(1),
    /**
     * `global` · `project` · `unresolved`. Same rule as on `decision_episodes`: a null identity is
     * global only when it says so, and the migration says so for the rows that predate the word.
     */
    scopeKind: text("scope_kind").notNull().default("unresolved"),
    /**
     * `core` · `contextual`. Whether the criterion travels in every delivery to the projects it
     * applies to (core) or only when the task reaches for it (contextual). It is seeded from the
     * published manifest, decided by policy, and a signature by itself does not turn a preference
     * into mandatory content of every task.
     */
    deliveryMode: text("delivery_mode").notNull().default("contextual"),
    /** The revision of that policy decision; part of every receipt that carries the belief. */
    deliveryPolicyRev: bigint("delivery_policy_rev", { mode: "number" }).notNull().default(1),
    /** The checks of this criterion (delivery C), the same shape as on a decision. */
    checks: jsonb("checks").$type<Record<string, unknown>[]>().notNull().default([]),
  },
  (table) => [
    // The screen always asks the same thing: 'the portrait, by subjects'.
    index("beliefs_topic_idx").on(table.topic, table.createdAt),
    // And the synthesis: 'what is alive, what is buried'.
    index("beliefs_state_idx").on(table.state),
    check("beliefs_memory_rev_check", sql`${table.memoryRev} > 0`),
    check("beliefs_delivery_policy_rev_check", sql`${table.deliveryPolicyRev} > 0`),
    check("beliefs_scope_kind_check", sql`${table.scopeKind} in (${SCOPE_KINDS})`),
    check(
      "beliefs_scope_identity_check",
      sql`(${table.scopeKind} <> 'global' or ${table.identity} is null) and (${table.scopeKind} <> 'project' or ${table.identity} is not null)`,
    ),
    check("beliefs_delivery_mode_check", sql`${table.deliveryMode} in ('core', 'contextual')`),
  ],
);

/**
 * The visual footprint of a project, saved exactly as calculated by `readDesign`.
 *
 * The asymmetry with `verdicts` is deliberate and it is advisable to read them together, because
 * both tables come from the same command and behave in reverse: **this row dies with its
 * project**. It hangs from `projects.id` with cascading deletion, so it goes away when the project
 * goes away — and the project goes away through three paths which are routine, not an accident:
 * `pruneMissing` when scanning a path where the folder is no longer there, `excludeProject` when
 * the user removes it from the catalog, and renaming the folder, which changes the sha1 of the
 * path and therefore `id`.
 *
 * It is accepted because a fingerprint is **cheap to recompute**: it's just a few hundred style
 * files read from the disk with a budget of bytes, no model, no network, and without asking
 * anything from anyone. The next scan leaves it as it was. `verdicts` cannot afford that —hence it
 * goes by identity and without foreign key— and that is why the two tables, which are written in
 * the same pass, are stored with opposite rules.
 */
export const designFingerprints = pgTable("design_fingerprints", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** The entire report of `readDesign`. Form: `DesignFingerprint` of `@panoma/core`. */
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A call to a model, pointed after it returns.
 *
 * It is Twin's expense book and it exists for a specific reason: the systems that are being built
 * —the critical one, and tomorrow the bots' routines— call models **without anyone watching**, and
 * a loop that makes mistakes in spending goes unnoticed until the bill arrives or the quota is
 * exhausted. The daily budget is checked by counting rows from here, so this table is not
 * telemetry: it is the brake.
 *
 * ── The tokens are null, and zero is prohibited ────────────────────────────────
 *
 * The providers `cli` —`claude -p`, `codex exec` — do not publish the consumption, and there a
 * zero would be read as "this call was free" instead of as "this call does not say." It is the
 * same rule with which `distill` decides whether or not to show the receipt, written this time in
 * the scheme: null means that it is not known, and `modelSpendToday` counts those rows separately
 * so that the total for the day does not appear smaller than it actually was.
 *
 * ── And there is no column of money ────────────────────────────────────────────────────
 *
 * Not for now and not out of negligence. In this repository, there isn’t a single rate table —
 * it’s documented in `lib/distill.ts` and in the distillation path — and the provider with which
 * this was built charges by subscription: there, the cost of a call is not unknown, it is
 * **undefined**. A column `cost` full of nulls or, worse, of zeros calculated with a rate from a
 * year ago, would be the number someone looks at to decide whether to keep spending. What is known
 * is saved — who, with which model, how many tokens and how many images — and the price is set by
 * whoever knows their invoice.
 */
/**
 * What moved each pass of synthesis, one row per subject.
 *
 * Answer the only question that beliefs alone cannot answer: **is this converging?** The `beliefs`
 * rows keep track of when each one was created and when it was last touched, so from that comes
 * 'what moved this week' and nothing more: a belief tuned five times in March has a single date,
 * and in April that date is no longer there. The history of what moved cannot be reconstructed
 * from the state; it has to be written down as it happens.
 *
 * One row per **subject** and not per past submission, because the interesting question is finer:
 * a portrait can be still in eight subjects and moving in the ninth, and that summed into a single
 * figure reads as 'a little movement in everything.' Adding rows to have the entire past
 * submission is trivial; splitting an already summed figure is not.
 *
 * ── Only what was called is written ───────────────────────────────────────────────
 *
 * A subject that did not receive new evidence is not synthesized —see the path— and therefore does
 * not leave a row. Absence means 'was not looked at,' and a row with everything at zero means 'was
 * looked at and nothing changed,' which is the signal of convergence and it must be possible to
 * distinguish it from silence.
 *
 * ── Without pass identifier, on purpose ──────────────────────────────────────
 *
 * The rows of the same batch share `at` with milliseconds, and grouping them by that would be
 * fragile. But grouping them is not necessary: what is being asked is by month and by subject, and
 * no number in this table is read better knowing that two subjects were synthesized together. A
 * column that does not answer any question is a column that must be kept.
 */
export const synthesisPasses = pgTable(
  "synthesis_passes",
  {
    id: text("id").primaryKey(),
    topic: text("topic").notNull(),
    /** New beliefs, refined, withdrawn, and open questions against something signed. */
    created: integer("created").notNull().default(0),
    refined: integer("refined").notNull().default(0),
    retired: integer("retired").notNull().default(0),
    proposed: integer("proposed").notNull().default(0),
    /**
     * How much evidence did the material have in front.
     *
     * Without this, 'three new beliefs' cannot be read: three out of four hundred observations is
     * a subject that has barely solidified, and three out of nine is one that has just been born
     * whole.
     */
    observations: integer("observations").notNull().default(0),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** The job of delivery D that ran the pass; null for a manual pass and for the legacy ones. */
    jobId: text("job_id").references(() => memoryJobs.id, { onDelete: "set null" }),
    /** The topic fingerprint the pass was synthesized from (delivery D): an equal one is not paid again. Null for legacy passes. */
    inputHash: text("input_hash"),
  },
  // The question is always 'what has moved since such a date,' and then it is grouped by month.
  (table) => [
    index("synthesis_passes_at_idx").on(table.at),
    index("synthesis_passes_topic_hash_idx").on(table.topic, table.inputHash),
  ],
);

export const modelCalls = pgTable(
  "model_calls",
  {
    id: text("id").primaryKey(),
    /**
     * Which organ spent: look · distill · classify · synthesize · memory · ask · rehearse ·
     * episodes · describe · review · app · handoff · probe. The list lives in
     * `apps/web/lib/spend-settings.ts` (`FAMILY_KINDS`), and the budgets are applied per family
     * there, not per kind.
     */
    kind: text("kind").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    appId: text("app_id"),
    appJobId: text("app_job_id"),
    /** The identity of the project that was being looked at, when there was one. */
    identity: text("identity"),
    /** Null when the provider does not publish the consumption. See the block above. */
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    /**
     * How many images traveled. Zero in the so-called text-only calls.
     *
     * It is kept apart from the tokens because it is the only thing that distinguishes a call that
     * pulled pixels from your disk from one that pulled already redacted text, and that
     * distinction is more about privacy than money: an image does not go through any redactor.
     */
    images: integer("images").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /*
      ── The reservation, since delivery B ────────────────────────────────────────────────
      A row used to be written after the answer came back, and the cap was read before the call
      by whoever was about to pay: two callers could read the same count and both spend the last
      call of the day. Now the row is inserted BEFORE the call, under a lock per family and local
      day, in the state `reserved`; it moves to `sent`, then `completed` (with the usage) or
      `uncertain` (a network result nobody can read: still counted), and only a reservation that
      demonstrably never left the process is `released` and stops counting. Legacy rows carry
      `origin = legacy` and `state = completed`, and keep counting by their creation day.
     */
    /** legacy · manual · automatic */
    origin: text("origin").notNull().default("legacy"),
    /** reserved · sent · completed · uncertain · released */
    state: text("state").notNull().default("completed"),
    /** One reservation per attempt of a job: a retry is a new key. */
    attemptKey: text("attempt_key"),
    jobId: text("job_id").references(() => memoryJobs.id, { onDelete: "set null" }),
    /** The local calendar day the call is charged to, fixed at reservation and moved at send when midnight passed. */
    budgetDay: date("budget_day"),
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    reservationRev: bigint("reservation_rev", { mode: "number" }).notNull().default(1),
  },
  // The budget always asks the same thing: 'how many of this kind go today?'
  (table) => [
    index("model_calls_kind_idx").on(table.kind, table.createdAt),
    index("model_calls_budget_idx").on(table.kind, table.budgetDay, table.origin, table.state),
    uniqueIndex("model_calls_attempt_idx").on(table.attemptKey).where(sql`attempt_key is not null`),
    check("model_calls_origin_check", sql`${table.origin} in ('legacy', 'manual', 'automatic')`),
    check("model_calls_state_check", sql`${table.state} in ('reserved', 'sent', 'completed', 'uncertain', 'released')`),
    check("model_calls_reservation_rev_check", sql`${table.reservationRev} > 0`),
  ],
);

/**
 * What is seen without looking: the verdict of the mechanical critic.
 *
 * `reviewProject` has been checking things since its increase that are proven by reading the disk
 * —two almost identical colors, two radios that to the eye are the same, an image that does not
 * say what it shows, a link that points to something that is not there— and until today it was
 * only reached by typing `panoma review` in a terminal. It was the critic that **does not cost a
 * cent** and the only one that did not run alone.
 *
 * ── For its record, not its identity ────────────────────────────────────────────────
 *
 * It is the difference with `looks` and with `decisions`, and it is not a detail: an identity
 * comes from the root commit, so all copies of a repository share it — forty-five in this catalog
 * — and what this reviewer looks at are **the files in a specific folder**. The copy from a year
 * ago has other loose colors and other broken links that are alive. Saving it by identity would
 * show the findings of one in the record of the other.
 *
 * ── And it can be erased entirely ─────────────────────────────────────────────────────────
 *
 * That's why it doesn't live in `decisions`, which is where one would first look for the
 * `buildCheck` neighborhood. That table stores what **is not** derived from the disk — what a
 * person decided, or what took minutes of compilation — and this is completely derived: it is
 * recalculated in a second and a half by reading the same folder. Putting it there would break the
 * property that this table defends in its header.
 */
export const reviews = pgTable("reviews", {
  /** A folder review, the last one. The previous is not saved: it is recalculated. */
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** Forma: `CriticFinding[]` — `{ kind, claim, hint?, file?, line? }`. */
  findings: jsonb("findings").notNull(),
  /**
   * Truly open files.
   *
   * Travel because silence has to be readable, which is the same reason why the engine returns it:
   * 'nothing to report' on zero files and on one hundred twenty-eight are two different pieces of
   * news, and an empty screen counts them the same.
   */
  sourcesRead: integer("sources_read").notNull().default(0),
  /** The walk fell short. With this in place, the silence is partial and it must be said. */
  truncated: boolean("truncated").notNull().default(false),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * What the critic saw, once said and kept.
 *
 * Until today, a glance was printed on a terminal and was lost when scrolling: the three findings,
 * the sentence you broke, and the written assignment lived only as long as a screen lasted. That
 * turned it into a loose piece of advice, and a loose piece of advice is not an organ — it cannot
 * be compared with yesterday’s, you cannot count how many times you have broken the same sentence,
 * and above all, you cannot let anyone other than the person writing fire it.
 *
 * Because that is the part that memory unlocks and it is not a decoration: **the automatic critic
 * cannot exist without it**. The watcher looks at a folder, and a folder that does not change
 * still has the same capture inside tomorrow. Without a row that says 'this has already been
 * looked at,' the shot is not a shot, it is a loop that pays for the same image every time the
 * server wakes up.
 *
 * ── A capture is what is inside, not what it is called ────────────────────────────────
 *
 * Hence `digest`, which is the sha256 of the bytes. An agent who works leaves `home.png` and then
 * leaves it again with the same name in the next pass: by name, the second one would never be
 * checked; by date, a folder copied from one place to another would be checked entirely again.
 * What really identifies a delivery is the image, so it is checked by its content — and as a
 * result, two projects with the same screen inside are checked separately, which is correct: the
 * portrait by which it is judged can be limited to a project.
 *
 * ── The findings go inside and not in their own table ──────────────────────────────────
 *
 * It is the question that arises on its own coming from `beliefs`, and the answer is that a
 * finding does not exist outside of its look. A belief has weight because it is signed, vetoed,
 * cited, and published: things are done to it one by one over months. A finding is a sentence from
 * a judgment made a while ago against a portrait that has already changed; putting it on its own
 * table would give stable identifiers to something that no one is going to name again, and would
 * force a union to render the only thing that is rendered, which is the whole look.
 *
 * ── Who captured it, in one column ──────────────────────────────────────────────
 *
 * `hand` or `watch`. It's not telemetry: the budget allocation depends on this —the automatic
 * cannot take up the whole day and leave the person sitting in front unable to ask for a glance—
 * and besides, they are two different facts that are read differently. 'The machine looked at your
 * delivery by itself and found this' is not at all similar to 'you asked it to look.'
 */
export const looks = pgTable(
  "looks",
  {
    /**
     * Random, for the same reason as in `model_calls`: looking at the same capture twice counts as
     * two looks. It is done on purpose when the portrait has changed between one and the other,
     * and an identifier taken from the content would merge them into one, leaving the first
     * without a trace just when what was wanted was to see the difference.
     */
    id: text("id").primaryKey(),
    /** The project whose screen was looked at. Without a foreigner, like the rest of Twin. */
    identity: text("identity").notNull(),
    /** The sha256 of the image bytes. It is what prevents looking at the same thing twice. */
    digest: text("digest").notNull(),
    /** What was the file called in the mailbox, when it came out of a mailbox. */
    shot: text("shot"),
    bytes: integer("bytes").notNull().default(0),
    /** hand · watch. Who shot it. See the block above. */
    fired: text("fired").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /**
     * With how many sentences was it measured.
     *
     * Without this, 'zero findings' cannot be read: zero against twenty sentences is a screen that
     * holds the entire portrait, and zero against one is a critic who had nothing to measure with.
     * It is the same number that the receipt shows on the terminal, and it is needed here because
     * the portrait a month from now will no longer be this one.
     */
    statements: integer("statements").notNull().default(0),
    /** Judgments that did not quote any phrase and fell apart. They are counted, not kept. */
    dropped: integer("dropped").notNull().default(0),
    /** The answer did not take the form of a list of findings. Different from finding nothing. */
    unreadable: boolean("unreadable").notNull().default(false),
    /** Form: `{ what, where, fix, cites: string[] }[]`, the appointments have already been resolved. */
    findings: jsonb("findings").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // ‘What has been looked at in this project?’, which is the question on the screen.
    index("looks_identity_idx").on(table.identity, table.at),
    // And 'has this capture already been looked at?', which is the watcher's before spending.
    index("looks_digest_idx").on(table.identity, table.digest),
  ],
);
