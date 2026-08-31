import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

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
     * ten slugs spread across fifty-three folders, twenty of them called `chatbot-new`. With that,
     * `/p/chatbot-new` would open a different folder according to the query plan, and anything
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
    /** proposed · approved · discarded · challenged (the sentinel's lawsuit: see `challenge`) */
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
  },
  (table) => [index("notes_project_idx").on(table.projectId, table.status)],
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
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** served · withheld */
    arm: text("arm").notNull(),
    /** The delivered — or withheld — notes: the same ones that would have traveled. */
    noteIds: jsonb("note_ids").notNull(),
    /** How much did the delivery weigh, in order to relate effect with size. */
    noteChars: integer("note_chars").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("servings_project_idx").on(table.projectId, table.at)],
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
  },
  (table) => [
    // The synthesis always asks the same thing: 'give me what is on this topic, the most recent
    // first.'
    index("observations_topic_idx").on(table.topic, table.at),
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
  },
  (table) => [
    // The screen always asks the same thing: 'the portrait, by subjects'.
    index("beliefs_topic_idx").on(table.topic, table.createdAt),
    // And the synthesis: 'what is alive, what is buried'.
    index("beliefs_state_idx").on(table.state),
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
  },
  // The question is always 'what has moved since such a date,' and then it is grouped by month.
  (table) => [index("synthesis_passes_at_idx").on(table.at)],
);

export const modelCalls = pgTable(
  "model_calls",
  {
    id: text("id").primaryKey(),
    /** look · distill · classify · synthesize. Which organ spent: the budget is handled separately. */
    kind: text("kind").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
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
  },
  // The budget always asks the same thing: 'how many of this kind go today?'
  (table) => [index("model_calls_kind_idx").on(table.kind, table.createdAt)],
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
