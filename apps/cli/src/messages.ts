/**
 * What the CLI says.
 *
 * In English and only in English, by decision of August 25, 2026. The CLI was bilingual for a week
 * with `PANOMA_LANG`, and it was the only product interface where the language was duplicated: the
 * website is indeed bilingual —there the reader chooses and the cookie remembers—, but a terminal
 * does not have a selector, it inherits the system language, and the result was that the same
 * person saw the website in one language and the terminal in another. A single language on the
 * terminal is a decision, not a deficiency; the Spanish dictionary is in the git history.
 *
 * What **does not** go in here are the values —`critical`, `own`, `dependency-bump` —: those are
 * in English in the code and in the database, and what is taught is the word with which they are
 * presented. See `SEVERITY_WORD` in `index.ts`.
 */

import type { RiskCode } from "@panoma/core";
import { FAULT_PART, faultOf, type AppFaultCode } from "@panoma/apps/faults";

const MESSAGES = {
  "apps.help": "  panoma apps                  manage optional official apps (install, doctor, update, remove)",
  "apps.videoHelp": "  panoma video auto <project>  create a preview as a durable job (story, revise, render, review)",
  "apps.doctorHelp": "  panoma video doctor          check the installed video runtime without the catalog",
  "apps.usage": "Usage: panoma apps [install|update|rollback|remove|clean|doctor|enable|disable|check] <id> [--browser]",
  "apps.line": "{id} · {status} · {version}",
  "apps.rejected": "App operation failed: {detail}",
  /*
    What went wrong with an app, said in a sentence. Same codes as the browser, same words; the
    table that dispatches them is `appFaultText` below. It cannot be shared with `apps-view.ts`
    because that one is bilingual and the terminal is English only, so what the two share is the
    vocabulary — `AppFaultCode` — and each writes its own sentences.
   */
  "apps.fault.npmNotFound": "panoma needs npm to install apps. Install Node.js with npm and try again.",
  "apps.fault.appError": "The app answered: {detail}",
  "apps.fault.offline": "The published version could not be looked up, and none is cached. Check the connection and try again.",
  "apps.fault.nodeTooOld": "The app needs a newer Node.js than this machine has. Required: {needed}. Installed: {running}.",
  "apps.fault.npmTooOld": "The app needs a newer npm than this machine has. Required: {needed}. Installed: {running}.",
  "apps.fault.engineUnsupported": "npm rejected this machine's version of Node.js or npm, so the app cannot be installed here.",
  "apps.fault.doesNotStart": "The app installed, but it did not start.",
  "apps.fault.cancelled": "The operation was cancelled.",
  "apps.fault.timeout": "The operation took too long and was stopped.",
  "apps.fault.stalled": "The download stopped making progress and was halted.",
  "apps.fault.processFailed": "npm ended with an error.",
  "apps.fault.noPreviousVersion": "There is no previous version to go back to.",
  "apps.fault.operationInProgress": "This app already has an operation running. Wait for it to finish.",
  "apps.fault.playwrightMissing": "This version of the app does not ship Playwright, so it cannot download the browser.",
  "apps.fault.browserNotDeclared": "This version of the app declares no browser download.",
  "apps.fault.malformedRequirements": "The app did not answer with the requirements it declares.",
  "apps.fault.incompatibleProtocol": "This version of the app speaks a protocol this panoma does not understand. Update panoma.",
  "apps.fault.stagedUpdateInvalid": "The staged update could not be read and was discarded. The active version still works.",
  "apps.fault.diskUnreadable": "The app's installation on disk could not be read.",
  "apps.fault.unknownApp": "That app is not in the catalog.",
  "apps.fault.brokenPackage": "The downloaded package is damaged, so it was not installed.",
  "apps.fault.noSpaceLeft": "There is no space left on the disk.",
  "apps.fault.permissionDenied": "panoma is not allowed to write where it keeps apps.",
  "apps.fault.readOnlyDisk": "The disk where panoma keeps apps is read-only.",
  "apps.fault.tooManyOpenFiles": "The system would not open more files. Close something and try again.",
  "apps.fault.diskError": "A disk operation failed.",
  "apps.fault.commandDidNotStart": "The program that performs the installation could not be launched.",
  "apps.fault.localCatalogRequired": "This only works on the local catalog on your machine.",
  "apps.fault.unknownOperation": "That operation does not exist.",
  "apps.fault.appNotEnabled": "The app is disabled. Enable it before using it.",
  "apps.fault.providerNotEnabled": "That model is not enabled for this app.",
  "apps.fault.budgetExhausted": "Today's app call budget is used up.",
  "apps.fault.providerKeyMissing": "The chosen model has no key. Set one in AI.",
  "apps.fault.voiceKeyMissing": "The ElevenLabs key is missing. Save one before using narration.",
  "apps.fault.requirementMissing": "The app has requirements left to complete. Check them before creating the video.",
  "apps.fault.interrupted": "The catalog restarted while the job was running.",
  "apps.fault.appFailed": "The app failed without saying why.",
  "apps.fault.invalidIdentity": "The chosen project has no valid catalog identity.",
  "apps.fault.musicOutsideProject": "The music track has to live inside the project.",
  "apps.fault.confirmationRequired": "Enabling a model or a voice needs an explicit confirmation.",
  "apps.fault.invalidSetting": "That setting is not valid.",
  "apps.fault.appSpokeWrong": "The app answered something panoma could not read.",
  "apps.fault.badRequest": "The request was not valid.",
  "apps.fault.localUrlRequired": "The address has to be on this machine (localhost).",
  "apps.fault.jobNotFound": "That job no longer exists.",
  "apps.fault.projectNotFound": "That project is no longer in the catalog.",
  "apps.fault.ambiguousProject": "More than one project has that identity. Choose one.",
  "apps.fault.requestFailed": "The request to the app failed.",
  "apps.fault.artifactNotFound": "That file is no longer where the production left it.",
  "apps.fault.reviewFailed": "The video review did not pass.",
  "apps.fault.stageFailed": "A stage of the production failed.",
  "apps.fault.noProduction": "This production produced no video.",
  "apps.fault.internal": "panoma stopped on an internal check. The code is quoted below.",
  "apps.fault.notInstalled": "panoma video is not installed. Install it with: panoma apps install panoma-video",
  "apps.notInstalled": "panoma video is not installed. Install it with: panoma apps install panoma-video",
  "apps.browserConsent": "Playwright downloads {browser} from Google's servers, and Google's terms apply: {terms}. Approximate download in MB: {n}.",
  "apps.browserUndeclared": "This version of the app declares no browser download.",
  "apps.confirm": "Continue? Type yes: ",
  "apps.cleanConfirm": "This permanently deletes the app's productions. Space in bytes: {bytes}.",
  "apps.cancelled": "Cancelled.",
  "apps.job": "Job: {id}",
  "apps.jobProgress": "{status} · {message}",
  "apps.jobDone": "Job complete: {id}",
  "apps.jobFailed": "Job failed: {detail}",
  "apps.jobDetached": "The job continues in the catalog: {id}",
  "apps.requirement": "{name}: {status}",
  "apps.present": "available",
  "apps.missing": "missing",
  "apps.unchecked": "not checked",
  "apps.videoUsage": "Usage: panoma video auto|scout|story|render|review|revise <project> [brief-or-render-id] [--input <json>]. Use panoma video doctor for a local check.",
  "apps.videoVerb": "Unknown video operation: {verb}. Choose auto, scout, story, render, review, revise or doctor.",
  "apps.videoInput": "--input must be a JSON object.",
  "apps.noIdentity": "The selected project has no repository identity. Create its first commit and scan it again.",
  "apps.browserRequired": "Browser download needs confirmation in an interactive terminal. Open the app page to accept the download.",
  "server.unreachable": "Couldn’t reach the catalog at {api}.",
  "server.startIt": "Start it with: panoma up",
  "server.badApi": "“{api}” is not a valid address.",
  "server.notThisMachine": "{host} is not this machine.",
  "server.remoteHint":
    "`panoma up` only starts the local catalog; a remote one is started by whoever hosts it.",
  "server.alreadyUp": "The catalog was already up · {api}",
  "server.noMonorepo": "Can’t find Panoma’s monorepo from here.",
  "server.noMonorepoHint":
    "The web server lives in the source, not in the CLI package ({entry}).\nStart it from your clone: pnpm --filter @panoma/web run dev",
  "server.starting": "Starting the catalog…",
  "server.startingDev":
    "Starting the web server… the first run compiles, so it may take a while.",
  "server.noPnpm": "Couldn’t launch pnpm. Is it installed?",
  "server.pnpmFailed": "Couldn’t launch pnpm: {reason}",
  "server.pnpmHint": "Panoma starts the web app with pnpm, so it has to be on the PATH.",
  "server.timedOut": "The server didn’t answer within 60 seconds.",
  "server.oldDatabase":
    "Your catalog was written by an older panoma (PostgreSQL {written}; this one uses {current}).",
  "server.oldDatabaseHint":
    "The format changes between major Postgres versions. Your data is intact in {path}:\ndelete nothing. The conversion lives in the repository, at ops/migrate-pglite5.mjs.",
  "server.portBusy": "The port for {api} is already taken by something else.",
  "server.portBusyHint":
    "Stop whatever is there, or start this one elsewhere: panoma up --api http://localhost:4174",
  "server.childDied": "The server exited on its own (code {code}). The last thing it wrote:",
  "server.staleVersion":
    "A panoma {running} is running and the installed one is {installed}.",
  "server.staleVersionHint":
    "Updating does not replace the live process. Restart it: panoma down && panoma up",
  "server.otherInstance":
    "There is already a panoma at {api} (pid {pid}) using this same database.",
  "server.otherInstanceHint":
    "Two at once corrupt it. Stop that one with panoma down, or give this one its own PANOMA_HOME.",
  "server.databaseBusy": "Another process ({who}) already has this catalog's database open.",
  "server.databaseBusyHint":
    "Two at once corrupt it, whoever started them. Stop that one first, or give this one its own PANOMA_HOME. To see it yourself: lsof +D {db}",
  "server.databaseLeasedHint":
    "Two at once corrupt it, whoever started them. Stop that one first, or give this one its own PANOMA_HOME. It left its mark at {lease}",
  "server.timedOutHint": "What it said while starting up is in {log}",
  "server.up": "Catalog up · {api}",
  "server.upDetail": "pid {pid} · log at {log}",
  "server.upStop": "stop it with: panoma down",
  "server.networkOpen": "Open to your local network, with a key.",
  "server.networkLicence":
    "Sharing it over the network is what makes the AGPL ask you to offer the source to whoever opens it.\nThe catalog already links to it in the sidebar; if you modified it, publish your changes too.",
  "server.networkHint":
    "Anyone with these links is in your catalog. Open one once and that browser stays in:",
  "server.networkHere": "this machine",
  "server.networkThere": "your network",
  "server.networkLocalToo":
    "While the port is open, localhost needs the key too: from the network anyone can claim to be localhost.",
  "server.networkOperator":
    "Only the first link can run anything here — install, build, open an editor. The network link is for looking.",
  "server.none": "No server was started by panoma up.",
  "server.somethingElse": "But something answers at",
  "server.somethingElseHint": "something else started it, and I won’t touch that.",
  "server.gone": "Process {pid} is gone. Forgetting the pid and touching nothing else.",
  "server.stopped": "Catalog stopped (pid {pid})",
  "server.bootUnsupported": "--on-boot isn’t written for {platform} yet.",
  "server.bootUnsupportedHint":
    "It is written for macOS (a LaunchAgent), Linux (a systemd user unit) and Windows\n(a task at logon). Not for the others, and pretending otherwise would be worse\nthan saying so.",
  "server.bootNeedsBuild": "Starting at login needs the CLI to be built.",
  "server.bootNeedsBuildHint": "Build it with: pnpm --filter panoma build",
  "server.bootInstalled": "At login, the catalog starts itself.",
  "server.bootNotLoaded": "it was written, but could not be activated. By hand: {command}",
  "server.bootLog": "boot output goes to",
  "server.bootRemove": "to remove it:",

  "today.badReport": "The catalog replied with something that isn’t a report.",
  "today.tooOld":
    "This catalog doesn’t know about the daily report yet (404 on /api/today).\nUpdate the web app and try again.",
  "today.httpError": "The catalog returned {status}. {detail}",
  "today.nothing": "Nothing new {since}. All yours.",
  "today.emptyTitle": "Empty catalog: nothing scanned yet.",
  "today.emptyBody":
    "Scan a folder of projects to fill it. Scanning runs locally and stores metadata only: your code never leaves this disk.",
  "today.title": "Today",
  "today.waiting": "Waiting on you",
  "today.born": "New in the catalog",
  /*
    The first visit has no previous visit, and for weeks it was told the same sentence as everyone
    else. `visit.json` does not exist until someone has looked, `visitWindow` answers null, and
    `period` turned that null into "since you last looked" for a person who had never looked — the
    very first line of the product, and a comparison with nothing. Null is not "a long time ago"
    either: with no mark, `getDailyReport` opens a window of exactly one day, so this names the
    window instead of inventing the comparison.
   */
  "today.firstLook": "in the last day, on your first look",
  "today.sinceLastVisit": "since you last looked",
  "today.sinceToday": "since today at {time}",
  "today.sinceYesterday": "since yesterday at {time}",
  "today.sinceWeekday": "since {weekday} at {time}",
  "today.sinceDate": "since {date}",
  "today.minutesAgo": "{n} min ago",
  "today.hoursAgo": "{n} h ago",
  "today.daysAgo": "{n} day{s} ago",
  "today.projectsTouched": "{n} project{s} touched",
  "today.commits": "{n} commit{s}",
  "today.proposals": "{n} proposal{s}",
  "today.newProjects": "{n} new project{s}",
  "today.fromAgents": "{n} from agents",
  "today.andMoreCommits": "and {n} more commit{s}",
  "today.verified": "verified",
  "today.unverified": "unverified",
  "today.decideAt": "decide them at {url}",
  "today.notUp": "The catalog is not up:",
  "today.nobodyAt": "nobody answers at {api}.",
  "today.startIt": "Start it with",
  "today.andType": "and type",

  // ── Does it build? ────────────────────────────────────────────────────────
  "check.running":
    "Checking {name}: installs and builds in a separate worktree — your folder is untouched. This can take a few minutes.",
  "check.dirty": "You have uncommitted changes: the verdict is about the last commit.",
  "check.saved": "The verdict is saved on the project's page.",
  "usage.check": "Usage: panoma check <project>",

  "open.httpError": "The catalog returned {status}.",
  "open.noMatch": "No project looks like “{query}”.",
  "open.noMatchHint": "If it is new, put it in the catalog: panoma scan <path> --save",
  "open.several": "“{query}” matches {n} projects:",
  "open.copy": " · copy",
  "open.andMore": "and {n} more",
  "open.useSlug": "Try again with the exact slug.",
  "open.opened": "{name} opened with {with}",
  "open.allOpened": "{name}: everything open",
  "open.allPartial": "{name}: opened {done} of {n}",
  "open.allNothing": "{name}: nothing could be opened",
  "open.allStepFailed": "{name}: {error}",
  "open.allSuggested":
    "No plan saved for this project, so the suggested set opened. Decide what one click opens on its page, under “Open everything”.",
  "card.code": "Code",
  "card.git": "Git",
  "card.origin": "Origin",
  "card.icon": "Icon",
  "card.health": "Health",
  "card.unsaved": "Unsaved",
  "card.howToRun": "How to run it",
  /*
    A family of two folders holds exactly one copy, which is the commonest first find on any disk:
    `findDuplicateFamilies` discards a group only when it has fewer than two **members**, and the
    copies are the members minus the canonical one. So this printed «(1 copies)» — and the plurals
    guard could not see it, because an exemption there claimed that a group of one copy is never
    formed. It is formed by every single duplicated pair. The exemption went with this fix.
   */
  "card.copies": "({n} cop{ies})",
  "card.analyzed": "files analyzed: {files} · in {ms}ms",
  "card.truncated": " (truncated)",
  "card.agents": "Agents",
  "card.run": "Run",
  "card.needs": "Needs",
  "card.env": "Env",
  "card.envMissing": "{file} · without a value: {n}",
  "card.risks": "Unsaved",
  "card.today": "today",
  "card.yesterday": "yesterday",
  "card.daysAgo": "{n} day{s} ago",
  "card.monthsAgo": "{n} month{s} ago",
  "card.yearsAgo": "{n} year{s} ago",

  /*
    The eight risks of unsupported work.
    They are the SAME words as `apps/web/lib/i18n.ts`, copied on purpose and not similar: the same
    fact cannot be read differently depending on the screen from which it is viewed. Two codes
    carry a single form — `unversioned` has no number and `untracked` does not change with it —
    and `no-commits` changes the entire sentence, not the plural.
   */
  "risk.unversioned": "not under version control",
  "risk.no-commits": "repository with no commits at all",
  "risk.no-commits.n": "{n} file{s} and not a single commit",
  "risk.no-remote": "no remote · {n} commit only on this disk",
  "risk.no-remote.n": "no remote · {n} commit{s} only on this disk",
  "risk.unpushed": "{n} commit not pushed",
  "risk.unpushed.n": "{n} commit{s} not pushed",
  "risk.uncommitted": "{n} file not committed",
  "risk.uncommitted.n": "{n} file{s} not committed",
  "risk.untracked": "{n} not added to git",
  "risk.stashes": "{n} stash saved",
  "risk.stashes.n": "{n} stash{es} saved",
  "risk.behind": "{n} commit to pull",
  "risk.behind.n": "{n} commit{s} to pull",

  "origin.own": "you made it",
  "origin.forked": "started from someone else’s work",
  "origin.foreign": "you didn’t start it",
  "origin.template": "generated from a template",
  "origin.no-signals": "no way to tell",

  "families.title": "Copies grouped",
  "families.main": "main",

  "families.detected": "Copies found",
  "families.summary":
    "{families} famil{fs} · {folders} duplicate folder{ds} · {size} of repeated code",
  "families.alive": "✓ alive",
  "families.copy": "· copy",
  "families.noGit": "no git",
  "families.sameDate": "same date",
  "families.daysBehind": "{n} d behind",
  "families.none": "✓ No copies of the same project found.",
  "kind.framework": "Frameworks",
  "kind.model": "Models",
  "kind.language": "Languages",
  "kind.runtime": "Runtimes",
  "kind.platform": "Platforms",
  "kind.database": "Data",
  "kind.tool": "Tools",
  "kind.package-manager": "Package manager",

  "severity.critical": "critical",
  "severity.high": "high",
  "severity.medium": "medium",
  "severity.low": "low",
  "severity.unknown": "unknown",

  "secret.stripe-live": "Stripe live secret key",
  "secret.stripe-test": "Stripe test secret key",
  "secret.aws": "AWS access key",
  "secret.github-token": "GitHub token",
  "secret.anthropic": "Anthropic API key",
  "secret.openai": "OpenAI API key",
  "secret.slack": "Slack token",
  "secret.private-key": "Private key",
  "secret.supabase-service": "Supabase service_role key",
  "secret.google-api-key": "Google API key",
  "secret.sendgrid": "SendGrid key",
  "secret.env-file": "git-tracked .env file",
  "secret.key-file": "git-tracked key file",
  "secret.google-service-account": "git-tracked Google service account",
  "secret.ssh-private-key": "git-tracked SSH private key",
  "secrets.reading": "Reading the tracked files of every repository…",

  "secrets.none": "No credential with a recognizable shape in the tracked files.",



  "scan.none": "No project found under {path}",
  "scan.noSuchPath": "The folder {path} doesn’t exist. Is the path spelled right?",
  "scan.notAFolder": "{path} is a file, and scanning works on folders.",
  "scan.noPermission":
    "The system wouldn’t let {path} be read. On macOS, Desktop and Documents grant access app by app: System Settings → Privacy & Security → Files and Folders, and allow your terminal.",
  "scan.tasting":
    "That was a taste: nothing was saved. To save it and see it in one go: npx panoma up {path}",
  "scan.analyzing": "Analyzing {n} project{s} in {path}…",
  "scan.failed": "✗ {root}: {reason}",
  "scan.saved": "{n} project{s} in the catalog",
  "scan.saveFailed": "Couldn’t save to the catalog: {reason}",
  "scan.wrote": "Wrote {path}",
  "scan.nextApp": "The next step is the app: npx panoma up",
  "scan.catalogAt": "Your catalog is at {api}",
  "scan.projects": "{n} project{s}",
  /*
    A pair of keys and not a form gap, because the figure drags three words at once: with a single
    copy the sentence needs «looks», «a copy» and «it», and no suffix does that to a verb, a noun
    and a pronoun in the same pass. The singular spells the number out rather than printing it —
    «1 looks like a copy» would be the same bug wearing the bandage — and it reads after the count
    that opens the line: «12 projects · one looks like a copy».
   */
  "scan.looksLikeCopiesOne": "one looks like a copy · use -d to see it",
  "scan.looksLikeCopiesMany": "{n} look like copies · use -d to see them",
  "scan.seeFullCard": "use -v for the full report",
  /*
    Two keys and not a form hole, because with a commit the noun does not change by itself: the
    verb changes. '1 commits that live' is the mistake of the number at the end again, and not
    even `{s}` fixes it — 'that lives' requires the whole sentence.
   */
  "scan.noRemote": "{n} with no remote ({commits} commit that lives only on this disk)",
  "scan.noRemote.n": "{n} with no remote ({commits} commits that live only on this disk)",
  "scan.unsavedWork": "{n} with unsaved changes",
  "version.newer":
    "There is a newer panoma: {latest} (you have {current}).\nUpdate with: npm i -g panoma@latest — or npx panoma@latest if you use npx.",

  "enrich.working": "Fetching latest versions and vulnerabilities…",
  "enrich.done": "{n} package{s} up to date · {outdated} outdated · {vulns} with advisories",
  "enrich.failed": "Couldn’t enrich: {reason}",

  "disk.regenerate": "regenerate with one command",
  "disk.missing": "{n} folder{s} in the catalog no longer on disk",
  "search.matches": "{n} match{es}",
  "search.inProjects": "in {n} project{s}",
  "secrets.checked": "{n} repositor{y} checked · {skipped} without git · ",
  "secrets.publicByDesign": "{n} skipped as public by design",
  "secrets.revokeFirst":
    "Revoke it in the provider’s dashboard first: that is the only thing that turns it off.\nClean the history afterwards, with git filter-repo. Deleting the file and committing\ndoes nothing — the key is still in every earlier commit.",
  "secrets.findings": "{n} finding{s}",
  "secrets.inProjects": "in {n} project{s}",
  "agentKey.key": "Key",
  "agentKey.onlyNow": "(shown only now; the catalog stores only its hash)",
  "mcp.written": "MCP configuration written to {path}",
  "mcp.merged": "MCP configuration merged into {path}",
  "mcp.coexists": "coexists with: {list}",
  "mcp.gitWarning":
    "That file holds the key in the clear, and git would carry it.\n      Before you commit: echo '{name}' >> .gitignore",
  "disk.title": "Disk",
  "disk.inProjects": "{size} across {n} project{s}",
  "disk.breakdown": "The per-project breakdown, at {url}",
  "enrich.registries": "Registries",
  "enrich.resolved": "{n} package{s} resolved out of {checked} queried",
  "enrich.unresolvable": "{n} unpublished (private, local or renamed)",
  "enrich.retry": "{n} failed and will be retried",
  "enrich.portfolio": "Portfolio state",
  /*
    «dependency» and «advisory» lose the y when they grow, so the gap carries both halves, the same
    shape `cli.catalogUpdated` uses for «technology» and «family». One stale package used to read
    «1 direct dependencies outdated», and one stale package is exactly what a portfolio of one
    project has.
   */
  "enrich.outdated": "{n} direct dependenc{ies} outdated",
  "enrich.advisories": "{n} security advisor{ies}",
  /*
    A participle and not a conjugated verb. This half is printed right after `enrich.advisories`
    and its subject is that other count, which this sentence never receives: with one advisory it
    said «1 security advisory affect 2 versions in use». «affecting» has no number to agree with,
    so the seam between the two keys stops being a place where the grammar can break.
   */
  "enrich.affect": "affecting {n} version{s} in use",
  "enrich.noVulns": "no known vulnerabilities",
  "disk.measuring": "Measuring each project’s disk usage…",
  "disk.total": "{total} in total · {reclaimable} regenerates itself",

  "search.none": "Nothing matches “{query}”.",
  "search.found": "{n} match{s} in {projects} project{ps}",

  "search.searched": "{n} repositor{y} searched",
  "search.skippedNoGit": "{n} with no git, couldn’t be searched",
  "describe.asking": "Asking the model…",

  "run.queued": "Proposal queued · {id}",
  "run.watch": "Follow it with panoma, or on the project’s card.",

  "run.isolating": "Isolating {slug} in a worktree, installing and running the tests…",
  "run.alreadyFailed": "Already tried, already failed",
  "run.runId": "run {id}",
  "run.hardened": "clean environment, no container",
  "run.local": "not isolated",
  "agentKey.created": "Key created for {name}",
  "agentKey.installed": "Written to {path}",
  "agentKey.keep": "Keep it: it is not shown again.",

  "agentKey.registered": "Agent {name} registered.",
  "ai.unknownSubHint": "Use: panoma ai [status] · use <provider> · key <provider> · ask <question>",
  "ai.defaultModel": "default model",
  "ai.useSubscription": "Use a subscription you already have",
  "ai.useSubscriptionNote": "(no keys; Panoma calls the agent)",
  "ai.installed": "installed",
  "ai.agentBroken": "installed, but it does not run",
  "ai.notInstalled": "not installed",
  "ai.onDemand": "Panoma never calls a model on its own: only when you ask it to.",
  /*
    Why a model cannot be connected, and what to do — in English, like the whole terminal.
    `resolveCredential` launches these two errors in Spanish, and here they were printed as is:
    the only line that says how to get out of the problem came out in another language. It is not
    a word from a provider —there is not one to quote yet—, Panoma says it. The web solved it the
    same way and earlier, in `lib/model-errors.ts`: `NoCredentialError` is recognized, which
    travels typed with the entire provider inside, and the remedy is drafted here. What is indeed
    someone else's word —a 429, the network down— is left as is, because translating it would be
    inventing.
   */
  "ai.noCredential": "the {name} credential is missing",
  "ai.hintCli": "Install {name} and sign in; Panoma will call “{command}”.",
  "ai.hintOauth": "Sign in to {name} with: panoma ai use {id}",
  "ai.hintKey": "Save the key with: panoma ai key {id}   Get one at {url}",
  "ai.missingProvider": "The provider is missing.",
  "ai.available": "Available: {list}",
  "ai.chosenProvider": "Provider: {name}",
  "ai.chosenModel": " · model {model}",
  "ai.sessionModel": "from the session",
  "ai.keyUsage": "Usage: panoma ai key <provider>",
  "ai.keyProviders": "With a key: {list}",
  "ai.pasteKey": "Paste the {name} key and press Enter",
  "ai.pasteKeyNote": "(it won’t echo)",
  "ai.saved": "Saved {masked} for {name} at {path}",
  "ai.keyDetail": "key {masked} ({source})",
  "ai.fromEnv": "{name} in the environment",
  "ai.storedKey": "stored {masked}",
  "ai.source.env": "environment",
  "ai.source.file": "file",
  "ai.source.agent-session": "agent session",
  "ai.source.login": "logged in",
  "ai.activeProvider": "Active provider",
  "ai.none": "none — pick one with 'panoma ai use <provider>'",
  "ai.withKey": "Connect with an API key",
  "ai.withSession": "With a session you already have",
  "ai.configAt": "Config at {path} (mode 0600).",
  "ai.unknownProvider": "Unknown provider: {id}",
  "ai.unknownSub": "Unknown subcommand: {sub}",
  "ai.chosen": "Panoma now thinks with {name}.",
  "ai.keyPrompt": "Paste the {name} key and press ↵ (it won’t echo):",
  "ai.keyEmpty": "No key was read.",
  "ai.keySaved": "{name} key saved to {path}.",
  "ai.askUsage": 'Usage: panoma ai ask "your question"',
  "ai.answeredBy": "— {model}",

  "hooks.noRepo": "There is no git repository here ({root}).",
  "hooks.noRepoHint": "Hooks are installed inside the project you want to record.",
  "hooks.foreignPostCommit": "There is already a post-commit that isn’t Panoma’s:",
  "hooks.foreignHint": "Leaving it alone. If you want both, add this line at the end by hand:",
  "hooks.stopInstalled": "Claude Code Stop hook {path}",
  "hooks.signalInstalled": "Claude Code PreToolUse signal — sleeping notes fire on their paths {path}",
  "hooks.updated": " (updated)",
  "hooks.removeWith": "remove them with: panoma hooks --remove",
  "hooks.badJson": "{path} is not valid JSON ({reason}). Leaving it as it is.",
  "hooks.cantWrite": "Couldn’t touch {path}: {reason}",
  "hooks.noPanomaHook": "· {path} had no Panoma hook",
  "hooks.statusTitle": "Passive capture in",
  "hooks.gitPostCommit": "git post-commit {path}",
  "hooks.noSettings": "· no .claude/settings.json in this project",
  "hooks.statusHint": "panoma hooks --install to add them · --remove to take them out",
  "hooks.installed": "Stop hook installed {path}",
  "hooks.postCommit": "post-commit installed {path}",
  "hooks.notOurs": "the post-commit is not Panoma’s: leaving it alone",
  "hooks.postCommitRemoved": "post-commit removed {path}",
  "hooks.stopRemoved": "Stop hook removed {path}",
  "hooks.cantTouch": "Couldn’t touch {path}: {reason}",
  "hooks.notJson": "not a JSON object",
  "hooks.hooksNotObject": "“hooks” is not an object",
  "hooks.stopNotList": "“hooks.Stop” is not a list",

  "mcp.badJson": "{path} is not valid JSON ({reason}). Leaving it alone.",
  "env.notBuilt": "panoma is not on the PATH and the CLI is not built: this points at {entry}, which only very recent Node versions can run. Build it with “pnpm --filter panoma build” and install again.",
  "mcp.installed": "Panoma registered in {path}",
  "mcp.replaced": "The previous panoma entry was replaced.",

  "mcp.notBuilt":
    "The MCP server isn’t built yet ({path}).\nBuild it with: pnpm --filter @panoma/mcp build",
  "mcp.notAnObject": "The .mcp.json that’s there isn’t a JSON object. Leaving it alone.",
  "mcp.badToml": "{path} has a syntax error. Leaving it alone: fix it and paste this yourself.",
  "mcp.tomlManual": "Panoma is already in {path}, written your way. Leaving it alone: update it yourself with this.",
  "mcp.serversNotAnObject":
    "The .mcp.json that’s there has an “mcpServers” that isn’t an object. Leaving it alone.",
  "error.unknownCommand": "Unknown command: {command}",
  "error.noCommand": "(none)",
  "error.unknownFlag": "Unknown option: {flag}",
  "error.didYouMean": "did you mean {guess}?",
  "error.unknownIsolation": "Unknown isolation level: {value}",
  "error.seeHelp": "panoma --help to see them all.",

  "error.needsValue": "{flag} needs a value.",
  "error.isolationLevels": "The ones there are: {list}",
  "error.badLimit": "--limit needs a whole number greater than zero.",
  "error.folderAndTerminal": "--folder and --terminal ask for two different things. Pick one.",
  "error.allAndOne": "--all opens everything the plan lists; --folder and --terminal open one thing. Pick one.",
  "error.installAndRemove": "--install and --remove ask for two different things. Pick one.",
  // ── The agents' .md ───────────────────────────────────────────────────────
  "md.usage": "panoma md [check|fix|init|sync|review] [path]",
  "md.unknownSub": "Unknown subcommand: {sub}",
  "md.unknownSubHint": "Available: check (audit), fix (repair the obvious), init (add the block), sync (regenerate it), review (model opinion, paid).",
  "md.checking": "Checking the instructions file against the disk…",
  "md.noDocs": "There is no AGENTS.md or CLAUDE.md here.",
  "md.noDocsHint": "panoma md init creates AGENTS.md with panoma's context block.",
  "md.fileHead": "{file} · {tokens} token{ts} · {lines} line{ls}",
  "md.managedTag": "has panoma's block",
  "md.clean": "everything it claims exists",
  "md.findingCount": "{n} claim{s} no longer true",
  "md.findingCountOne": "1 claim that is no longer true",
  "md.blockBroken": "the panoma block never closes: fix it by hand",
  "md.versionWrong": "the project runs {v}",
  "md.envMissing": "the env example does not declare it",
  "md.envNear": "not declared in the env example; there is {names}",
  "md.fixDone": "{n} fix{es} in {file} · {m} left for your hand",
  "md.fixClean": "{file}: nothing fixable automatically; what remains needs your hand.",
  "md.fixNothing": "Nothing to fix: everything it claims exists.",
  "md.reviewAsking": "Reading the instructions file and asking the model…",
  "md.reviewBy": "opinion by {model} on “{name}” · stored in its page",
  "md.reviewUnsaved": "opinion by {model} on “{name}” · not stored: the project has no repository, so the catalog has nowhere to keep it",
  "md.reviewCached": "answered from the saved opinion; the file has not changed since it was written. --force asks the model again",
  "md.inherited": "also inherits: {path} ({tokens} tokens)",
  "md.inheritedHint": "agents read it on top of the project's own; check it with: panoma md check {dir}",
  "md.findingRow": "line {line} · {claim} — {reason}",
  "md.pathMissing": "does not exist in the project",
  "md.pathMovedTo": "missing; there is one at {path}",
  "md.scriptMissing": "not in the package.json scripts",
  "md.scriptNear": "not in the scripts; there is {names}",
  "md.truncated": "the project has more files than the index holds: paths were not checked",
  "md.touchedBy": "last agent touch: {agent} on {file} (+{added} −{deleted})",
  "md.notCataloged": "The project is not in the catalog: the block only carries what the disk shows.",
  "md.notCatalogedHint": "panoma scan . --save registers it; the block gains dependencies, advisories and tasks.",
  "md.initDone": "Panoma block written to {file}.",
  "md.initCreated": "There was no instructions file: {file} created with the block.",
  "md.initKeeps": "It regenerates itself while the watcher runs, or by hand with: panoma md sync",
  "md.bridgeCreated": "CLAUDE.md created with the @AGENTS.md import: Claude Code reads only its own file.",
  "md.bridgeMissing": "Claude Code will not load this file: it reads CLAUDE.md, never AGENTS.md.",
  "md.bridgeMissingHint": "panoma md init writes a one-line CLAUDE.md that imports AGENTS.md.",
  "md.syncDone": "Block regenerated in {file}.",
  "md.syncSame": "The block in {file} was already up to date: nothing changed.",
  "md.syncNone": "There is no panoma block in this project.",
  "md.syncNoneHint": "Add it with: panoma md init",
  "md.broken": "The block is broken: {reason}",
  "cli.httpError": "The catalog returned {status}. {detail}",
  "cli.ingestRejected": "The catalog rejected the ingest ({status}). {detail}",
  /*
    A pair each, because the word the number drags here is a verb: «1 were skipped» is the
    number-at-the-end bug in its worst shape, and a noun suffix never reaches «was». The noun that
    was missing goes in too — a bare figure followed by a verb left the reader guessing what had
    been retired.
   */
  "cli.removedOne": "{n} project no longer existed and was retired",
  "cli.removedMany": "{n} projects no longer existed and were retired",
  /*
    The three sentences npx needs, and none of them says «trial».
    What runs under `npx panoma` is this same package, byte for byte: nothing is limited and
    nothing expires. What is temporary is the command, and saying anything stronger would be a
    lie the rest of this product does not tell.
   */
  "npx.hooksRefused": "Hooks need a panoma that is still here tomorrow.",
  "npx.hooksRefusedWhy":
    "This copy runs from npx, which keeps it for one command and then lets it go. A hook written\n  now would call a command that stops existing the moment this one ends — and hooks stay quiet\n  by design, so nothing would ever tell you.",
  "npx.hooksRefusedHow": "Install it and try again:  npm i -g panoma",
  /*
    And the same refusal for the MCP, which needed it for the same reason and did not have it.
    `--install` writes a permanent file in somebody's agent that names a path inside npx's cache.
    That path is alive today and gone whenever npm clears it, and an MCP server that fails to
    start is not an error anyone sees: the agent simply comes up without the tools.
   */
  "npx.mcpRefused": "An agent's configuration outlives the copy that would write it.",
  "npx.mcpRefusedWhy":
    "This copy runs from npx, which keeps it for one command and then lets it go. The configuration\n  written now would point inside that cache, so the agent would stop getting the tools the day it\n  is cleared — and it would come up without them saying nothing, which is how MCP fails.",
  "npx.mcpRefusedHow": "Install it and try again:  npm i -g panoma",
  "npx.upEphemeral": "running from npx · to keep the command: npm i -g panoma",

  "cli.catalogUpdated":
    "Catalog updated: {projects} project{ps}, {technologies} technolog{ts}, {packages} package{ks}, {families} famil{fs}",
  /*
    «as you asked» is literal and was checked before it was kept: the rows come from the
    `exclusions` table, `excludeProject` writes them when someone takes a project out of the
    catalog from the web —typing its name to confirm— and `ingestPortfolio` reads them to skip
    those roots. The CLI never writes there; it only reports what the ingest left out.
   */
  "cli.excludedOne": "{n} project was skipped for living outside the catalog, as you asked",
  "cli.excludedMany": "{n} projects were skipped for living outside the catalog, as you asked",
  "cli.reslugged": "{n} changed address when unique names were handed out",
  "search.nothingTracked": "No git-tracked file contains “{term}”.",
  "disk.walking": "Walking each project’s tree. This takes several minutes…",
  "secrets.revoke": "Revoke it in the provider’s dashboard first: that is the only thing that disables it.\nClean the history afterwards, with git filter-repo. Deleting the file and committing\ndoes not help — the key is still in every earlier commit.",
  "describe.reading": "Reading {slug} and asking the model…",
  "describe.cached": "answered from the saved description; nothing changed since it was written. --force asks the model again",
  "describe.unsaved": "not stored: the project has no repository, so the catalog has nowhere to keep it",
  "enrich.asking": "Querying public registries and OSV.dev…",
  "mcp.configTitle": "MCP configuration",
  "mcp.pasteIt": "Paste it into .mcp.json or ~/.claude.json — or run it again with --install",
  "mcp.cannotWrite":
    "Nothing written: this agent keeps its MCP servers in a format I will not touch. Paste it into {path} yourself",
  "mcp.unknownAgent":
    "Nothing written: I don’t know where this agent keeps its MCP servers. Paste it wherever it does.",
  "mcp.restart": "Restart {name} so it picks this up.",
  "mcp.updated": "the “panoma” entry that was already there has been updated",
  "run.securityFix": "Security fix",
  "run.isolation": "Isolation",
  "run.container": "ephemeral container",
  "run.steps": "Steps",
  "run.notApplied": "The change is NOT applied in your folder.",
  "run.reviewAt": "Review the patch and decide at {url}",
  "run.nothingToChange": "Nothing to change.",
  "run.failed": "Failed",
  "run.proposalVerified": "Proposal verified",
  "run.proposalUnverified": "Proposal NOT verified",
  "run.branch": "branch",
  "open.openedWith": "opened with {tool}",
  "describe.writtenBy": "written by {model}",
  "run.stepOutput": "output of “{step}”:",
  "cli.trace": "PANOMA_DEBUG=1 to see the full trace.",
  "card.distribution": "Distribution",
  "card.noLockfile": "no lockfile",
  "card.lockUnresolved": "{path} (versions unresolved)",
  "hooks.noPostCommit": "· there was no post-commit",
  "ai.notEncrypted": "The file is mode 0600, but it is not encrypted.",
  "mcp.noServer":
    "No MCP server on this disk, so there is no configuration to give: it travels inside\nthe panoma package, and this copy has not got it. Reinstall panoma, or run this from\nyour clone of the repository.",
  "twin.usage":
    "panoma twin [sources|allow|revoke|forget|mine|verdicts|distill|synthesize|taste|score|design|look]",
  "twin.unknownSub": "Unknown subcommand: {sub}",
  "twin.unknownSubHint":
    "The ones that exist: sources (which histories are here and which are permitted), allow and revoke (grant and take back that permission), forget (delete what was stored), mine (what reading them yields), verdicts (what ended up in the catalog), distill (read them and pull out observations), synthesize (turn those observations into your portrait), taste (the portrait), score (how often you correct it) and look (what’s wrong with a screen you were just handed).",
  "twin.needsSource": "Missing the history: panoma twin {sub} <source>",
  "twin.badSource": "“{source}” is not an agent history Panoma knows about.",
  "twin.badSourceList": "The ones that exist: {list}",
  "twin.sourcesTitle": "Agent histories on this machine",
  "twin.sourcePresent": "{files} file{s} · {size}",
  "twin.sourceAbsent": "not on this machine",
  "twin.consentAllowed": "permitted",
  "twin.consentAllowedHint": "take it back with panoma twin revoke {source}",
  "twin.consentDenied": "not permitted",
  "twin.consentDeniedHint": "grant it with panoma twin allow {source}",
  "twin.consentNoReader": "no reader yet",
  "twin.consentNoReaderHint": "this format cannot be read yet: the permission would open nothing",
  "twin.sourcesTotal": "{n} source{s} on disk · {files} file{fs} · {size}",
  "twin.sourcesAllowed":
    "{n} permitted · {files} file{fs} · {size} that panoma twin mine would actually open",
  "twin.sourcesNoneAllowed":
    "None of them is permitted yet, so panoma twin mine would open nothing.",
  "twin.sourcesNone": "There are no agent histories on this machine.",
  "twin.sourcesNoneHint":
    "Twin reads what Claude Code, Codex, Cursor or Aider already wrote while you\nworked. With none of them here there is nothing to read.",
  "twin.sourcesNext":
    "panoma twin allow <source> grants the permission; panoma twin mine reads the permitted ones.",
  "twin.nothingRead":
    "Only the size was measured here: not one file opened, not one byte stored.",
  "twin.granted": "Permission granted: {label}",
  "twin.grantedCovers": "covers {files} file{s} · {size} in {path}",
  "twin.grantedAbsent": "nothing there for now: that tool has not written on this machine",
  "twin.grantedNoReader":
    "This format cannot be read yet, so the permission is stored with nothing to open.",
  "twin.grantedNext": "panoma twin mine --source {source} reads it now.",
  "twin.revoked": "Permission taken back: {label}",
  "twin.revokedDetail":
    "Those files do not get opened again. What was printed back then was not stored\n  anywhere either, other than whatever you sent to the catalog with --save.",
  "twin.mineReading": "Reading {label} on this disk…",
  "twin.mineTitle": "What comes out of your histories with the agents",
  "twin.mineNothingAllowed":
    "No history is permitted yet, so not one file has been opened.",
  "twin.mineNothingAllowedHint":
    "panoma twin sources shows which ones are here and how big they are, and that is where\n  the identifier panoma twin allow <source> wants comes from.",
  "twin.mineDenied": "{label} is on disk and is not permitted, so it was not opened.",
  "twin.mineDeniedHint": "panoma twin allow {source} grants it.",
  "twin.mineNoReader": "{label} gets measured, but cannot be read yet.",
  "twin.mineNoReaderHint":
    "Its format has no reader yet, and promising one on this screen would be a lie.",
  "twin.projectFilter":
    "Only sessions whose directory starts with “{prefix}”. For now --project filters by\n  path, and not by the catalog entry.",
  "twin.funnelTitle": "The funnel, all of it",
  "twin.funnelRead": "{files} file{s} read · {size}",
  "twin.funnelSessions": "sessions",
  "twin.funnelUserTurns": "turns of yours, with none of the above still in",
  "twin.funnelToolResults": "tool results, which you did not write",
  "twin.funnelSidechain": "subagent turns, which you did not either",
  "twin.funnelCommands": "slash commands: instructions, not reactions",
  "twin.funnelReactions": "reactions to something you had been handed",
  "twin.funnelBriefs": "one line or shorter",
  "twin.funnelSpontaneous": "with nobody asking you anything",
  "twin.funnelWithSignal": "carrying a signal we can name",
  "twin.funnelWholeCorpus":
    "The funnel counts the whole history: --project filters the reactions shown,\n    not the files that get read.",
  "twin.mineTotal":
    "{n} histor{y} together · {files} file{fs} · {size} · reactions: {reactions} · with a signal: {signals}",
  "twin.samplesTitle": "A few of them, exactly as you wrote them",
  "twin.sampleQuote": "“{text}”",
  "twin.sampleBrief": "one line",
  "twin.sampleRedacted": "something covered up, in case it was a credential",
  "twin.samplesNone": "No reaction of that shape in this history.",
  "twin.samplesMore": "and {n} more that do not fit here · --limit decides how many are shown",
  "twin.saveSending": "Sending what came out to the catalog, in batches of {size}…",
  "twin.saved": "stored: {saved} · already there: {duplicates} · no project: {unmatched}",
  "twin.savedProjects": "spread across {n} catalogued project{s}",
  "twin.savedUndated": "and {n} with no timestamp in the transcript, not stored and not fixable",
  "twin.savedUnmatched":
    "“no project” means its folder is not catalogued: panoma scan <path> adds it, and they\n    attach on the next save.",
  "twin.saveNothing": "No reaction came out, so there is nothing to send.",
  "twin.saveRejected": "The catalog rejected the reactions ({status}). {detail}",
  "twin.forgetUsage": "Say what to forget: panoma twin forget <source>. The ones that work:",
  "twin.forgotten": "Forgotten: {n} verdict{s} deleted from the catalog.",
  "twin.forgottenNarratives": "History records deleted with them: {n}.",
  "twin.forgottenEpisodes": "Extracted decision episodes deleted with them: {n}.",
  "twin.nothingSaved":
    "None of this was stored: it is read from disk, printed, and that is the end of it.",
  "twin.saveHint": "--save stores them in the catalog, the only thing that takes them out of here.",
  "twin.verdictsTitle": "What is already stored in the catalog",
  "twin.verdictsShown": "verdicts: {shown} of {total}, grouped by project",
  "twin.verdictsFiledBy":
    "The project is the identity each one was filed under —its repository’s root commit,\n  plus its path inside it—, and not the folder’s name: that way it survives a rename.",
  "twin.verdictsIn": "{n} verdict{s}",
  "twin.verdictsMore": "and {n} more in the catalog · --limit decides how many are fetched",
  "twin.verdictsSource": "Only the ones from “{source}”.",
  "twin.verdictsNone": "The catalog has no stored verdicts.",
  "twin.verdictsNoneSource": "No stored verdict came out of “{source}”.",
  "twin.verdictsNoneHint":
    "panoma twin mine --save stores them, the only thing that takes them off the disk.",
  "twin.verdictsRejected": "The catalog could not list the verdicts ({status}). {detail}",
  "twin.distillTitle": "Distil your verdicts into statements about your taste",
  "twin.distillEstimate": "{verdicts} verdict{s} · about {tokens} tokens · {provider} · {model}",
  "twin.distillCost": "That is what it would cost, counted before spending it.",
  "twin.distillDryRun": "With --dry-run it stops here: nothing was sent to any model.",
  "twin.distillDryRunHint":
    "Without --dry-run it runs, and whatever comes back waits for your review.",
  "twin.distillRunning": "Reading those verdicts with the model…",
  "twin.distillNothing": "There are no verdicts to distil.",
  "twin.distillNothingHint":
    "panoma twin mine --save fills the catalog, and panoma twin verdicts shows what is in it.",
  "twin.distilled": "observations: {observed} · stored: {saved} · out of {verdicts} verdict{s}",
  "twin.distilledUsage": "{model} · {input}→{output} tokens",
  "twin.distilledModel": "written by {model}",
  "twin.distilledNone": "The model pulled no observation out of these quotes.",
  "twin.distilledNext":
    "panoma twin synthesize turns them into your portrait, without asking you anything.",
  /*
    What no pass can send: a project's only unread quote cannot back an observation —the parser
    wants two from the same batch— so the route leaves it out and says so. Without this line the
    corpus said "1 left" forever, and `--all` paid a call per pass to keep it there.
   */
  "twin.distilledThin": "alone in their project, and so unread: {n}",
  /* Answers the output limit cut, asked again at once with twice the room. Each was a call. */
  "twin.distilledTruncated": "answers cut short and asked again with more room: {n}",
  "twin.distillMore": "still unread: {left} · next pass, number {pass}…",
  "twin.distillPasses": "chained passes: {n}",
  "twin.distillNoModel": "No model is connected, so there is nothing to distil with.",
  "twin.distillNoModelHint":
    "panoma ai shows which ones you can connect · panoma ai use <provider> picks one.",
  "twin.distillRejected": "The catalog could not distil ({status}). {detail}",
  "twin.tasteFull": "It doesn’t fit: the portrait would take {chars} of {cap} characters, and nothing was saved.",
  "twin.tasteFullHint":
    "For a new belief to get in, another has to come out — or stay only in its project,\n  which is what scoping it in the catalog does.",
  "twin.synthTitle": "Writing your portrait",
  "twin.synthSorted": "sorted by topic: {n}",
  "twin.synthMinted": "and {n} new topic that wasn’t on the list",
  "twin.synthEstimate":
    "topics: {topics} · observations: {observations} · about {tokens} input tokens",
  "twin.synthModel": "with {provider} · {model}",
  "twin.synthRunning": "Synthesizing…",
  "twin.synthSame": "Nothing changed: the evidence says what it said last time.",
  "twin.synthDone": "new: {created} · refined: {refined} · retired: {retired}",
  "twin.synthProposed":
    "{n} belief{s} you signed have a proposed version waiting for your answer.",
  /* The same count as `twin.distilledTruncated`, over the sorting call and the synthesis. */
  "twin.synthTruncated": "answers cut short and asked again with more room: {n}",
  "twin.synthNext": "panoma twin taste shows how it turned out.",
  "twin.churnTitle": "How your portrait has moved",
  "twin.churnMonth": "{month} — new: {created} · refined: {refined} · retired: {retired}",
  "twin.churnStill": "It hasn’t moved this month: what is there is already said.",
  "twin.churnOnlyRefined":
    "This month only rewrote what was already there: nothing new and nothing retired.",
  "twin.synthNothing": "There is no evidence to synthesize yet.",
  "twin.synthNothingHint":
    "panoma twin distill reads your verdicts and pulls out the observations the portrait\n  comes from.",
  "twin.synthUpToDate": "The portrait is already up to date: no new evidence has come in.",
  "twin.synthUpToDateHint":
    "panoma twin distill reads whatever is left of your history, and panoma twin taste shows\n  how the portrait turned out.",
  "twin.tasteTitle": "Your portrait, exactly as it is written",
  "twin.tasteBudget": "{chars} of {cap} characters · {left} left",
  "twin.tasteCitations": "{n} quote{s}",
  "twin.tasteFile": "It is written to TASTE.md, in Panoma’s home, so an agent can read it.",
  "twin.tasteForming":
    "and {n} belief{s} still forming · they need more evidence to reach the file",
  "twin.tasteWaiting":
    "There are beliefs with evidence to spare that aren’t here because you haven’t let them down: {n}",
  "twin.tasteWaitingHint":
    "What the machine works out on its own doesn’t reach your agents until you say yes once,\n  in the catalog. Until then, this is exactly what you signed.",
  "twin.tasteOnly": "only in {project}",
  "twin.tasteEmpty": "The portrait is empty: no belief has made it in yet.",
  "twin.tasteEmptyHint":
    "panoma twin distill reads your verdicts and panoma twin synthesize writes the portrait.",
  "twin.tasteRejected": "The catalog could not read the portrait ({status}). {detail}",
  "twin.topicDesign": "on design",
  "twin.topicFrontend": "on the interface itself",
  "twin.topicBackend": "on the server and its data",
  "twin.topicCli": "on the terminal",
  "twin.topicTesting": "on how things are checked",
  "twin.topicCopy": "on the words",
  "twin.topicWorkflow": "on how you work with your agents",
  "twin.topicTooling": "on the tooling",
  "twin.topicData": "on the data",
  "twin.topicOther": "on everything else",
  "twin.scoreTitle": "How often you correct it",
  "twin.scoreCounts": "beliefs: {beliefs} · forming: {forming} · signed: {signed}",
  "twin.scoreCorrections": "you have corrected {corrections} of {shown}",
  "twin.scoreRate": "{rate}% of what it told you, you had to correct",
  "twin.scoreDensity": "observations per belief: {density} · in total: {observations}",
  "today.critic": "The critic looked on its own",
  "today.criticLooks": "things it saw in inbox screenshots: {n} · screenshots looked at: {shots}",
  "today.criticReviews": "things it saw reading folders: {n} · folders reviewed: {projects}",
  "today.criticWhere": "the full verdict is in the catalog, on the critic's screen",
  "twin.scoreBriefs": "of what the critic has seen you have assigned {ordered} of {findings}",
  "twin.scoreBriefsRate": "{rate}% of what it points at works for you",
  "twin.scoreBriefsLaunched": "of those, sent to an agent: {launched}",
  "twin.scoreBriefsDiscarded": "and you said no to: {discarded}",
  "twin.scoreReach": "Your portrait goes down to the .md of these projects: {reached} of {projects}",
  "twin.scoreReachHow":
    "In none of them is the channel open, so there your agents work knowing nothing about this. You open it inside the folder, with: panoma md init",
  "twin.designTitle": "What yours looks like",
  "twin.designFrom": "From projects the critic has read, copies aside: {read} · of those, with something to look at: {withUi}",
  "twin.designEmpty":
    "No fingerprint has been stored yet. The mechanical critic writes one whenever it reviews a folder, and it reviews when there is a commit newer than its last review.",
  "twin.designProjects": "projects: {projects}",
  "twin.designFonts": "Typefaces: {fonts}",
  "twin.designRadii": "Corners: {radii}",
  "twin.designTraits": "With dark mode: {dark} · with animation: {animation}",
  "twin.designRejected": "The catalog would not give the visual portrait: {detail}",
  "twin.scoreBriefsRelaunched": "some more than once — launches: {launches}",
  "twin.scoreGraveyard":
    "What you veto is not deleted: it stays as negative evidence so it is never proposed\n  again.",
  "twin.scoreTooFew":
    "It has told you {shown}, and it takes {floor} for a percentage to say anything. Below\n  that, a single correction moves it more than five points, so it would be describing the\n  last belief you looked at and not your taste.",
  "twin.scoreNoTrend":
    "Where it stands today can be said; whether it improves, not yet: neither of the two\n  settled months reaches {floor} beliefs. The current month doesn’t count: its beliefs\n  haven’t been looked at yet.",
  "twin.scoreBetter":
    "Of what it told you last month you corrected {recent}%, and of the month before\n  {previous}%: it goes down, which is the only way this has of saying it is learning.",
  "twin.scoreNotBetter":
    "Of what it told you last month you corrected {recent}%, and of the month before\n  {previous}%: it does not go down. Until it goes down month over month, the twin is not\n  learning, and this scoreboard will not pretend otherwise.",
  "twin.scoreNothing": "There is nothing to score yet: no belief has been written.",
  "twin.scoreNothingHint":
    "panoma twin distill reads your verdicts and panoma twin synthesize writes the portrait;\n  this number comes out of what you correct there.",
  "twin.scoreRejected": "The catalog could not count your decisions ({status}). {detail}",

  "twin.saveRemapped":
    "{n} quote{s} that were already stored moved to another project: attribution is computed, and this pass resolved it better.",
  "twin.saveRestated":
    "Observations that moved project along with their quotes: {n}. Look at them with panoma twin taste.",
  "twin.corpusLeft":
    "You have {read} of {total} verdict{s} distilled from your history: {left} still unread,\n  and every pass moves on to the ones that haven’t been used yet.",
  /*
    A pair and not a gap: with one verdict the article, the noun and the verb all move at once
    —«all 1 stored verdicts already back» — and a suffix reaches none of them. The web half of this
    same sentence was split the same way on the same day.
   */
  "twin.corpusDoneOne":
    "Your whole history has been distilled: the one stored verdict already backs a\n  statement.",
  "twin.corpusDoneMany":
    "Your whole history has been distilled: all {total} stored verdicts already back some\n  statement.",
  "twin.lookNeedsArgs": "The project is missing: panoma twin look <project> [screenshot.png]",
  "twin.lookNoInbox": "This project has no inbox: {dir} isn’t there.",
  "twin.lookNoInboxHint":
    "panoma md init creates it and tells your agents to leave screenshots of what they\n  build in it. The folder is git-ignored.",
  "twin.lookInboxEmpty": "The inbox is set up and empty: {dir}.",
  "twin.lookInboxEmptyHint":
    "Your agents already have the instruction in AGENTS.md. Ask the one that is working to\n  leave a screenshot of the screen it just touched.",
  "twin.lookFromInbox": "from the inbox, left {when}",
  "twin.lookInboxMore": "{n} more unseen",
  "twin.lookInboxSkipped": "files that aren’t images: {n}",
  "twin.lookTitle": "What’s wrong with this screen",
  "twin.lookSending": "{file} · {size}{dims}",
  "twin.lookNotRedacted":
    "An image can’t be redacted: it leaves your disk exactly as it is, with whatever is\n  written on it. Look at it before you send it.",
  "twin.lookTiny":
    "It is {width} px wide. Below {floor}, whatever gets judged will be about the scale the\n  file was saved at rather than about your screen.",
  "twin.lookEstimate":
    "{statements} statement{s} from your portrait · {tokens} tokens of text · {size} of image · {provider}/{model}",
  /*
    What the critic is going to be shown, and what it was shown.
    Panoma refused for months to shrink a capture, and the reason still stands in
    `packages/core/src/screenshot.ts`: reducing what a model is going to judge, without saying so,
    changes the judgment behind the back of whoever asked for it. The owner can now ask for it on
    the Spend screen, and these seven sentences are what keeps the refusal's promise — the reason
    a capture travels whole is said as plainly as the reduction itself.
   */
  "twin.lookFitSent": "reduced for the critic · what it sees: {size} · what the file has: {from}",
  "twin.lookFitWhole": "you asked for it reduced and it travels whole: {why}",
  "twin.lookFitAsked": "you asked for it reduced: its long edge will be at most {edge} px",
  "twin.lookWhyFormat": "it isn’t a PNG, and only a PNG can be reduced here",
  "twin.lookWhyVariant": "it is a PNG written in a way panoma cannot read",
  "twin.lookWhyAlready": "it is already smaller than that size",
  "twin.lookWhyBroken": "it couldn’t be read to reduce it",
  "twin.lookCost":
    "The image is billed separately and every provider counts it its own way: this is its\n  size, not its price.",
  "twin.lookDryRun": "That’s as far as the rehearsal goes: nothing was looked at.",
  "twin.lookDryRunHint": "Drop --dry-run to look at it for real.",
  "twin.lookRunning": "Looking at the screenshot…",
  "twin.lookClean": "Nothing you have approved is broken on this screen.",
  "twin.lookBreaks": "Breaks your portrait in {n} place{s}",
  "twin.lookFix": "ask for: {fix}",
  "twin.lookAgainst": "breaks: “{statement}”",
  "twin.lookDropped": "{n} judgement{s} with nothing behind them, dropped.",
  "twin.lookDroppedHint":
    "Only what breaks a belief already written comes out here. The more your portrait has,\n  the more it can see: panoma twin synthesize.",
  "twin.lookUnreadable":
    "The model didn’t answer in the shape it was asked for, so there is nothing to show. The\n  call still counts against today’s looks.",
  "twin.lookFooter": "{statements} statement{s} in your portrait · looks today: {used} of {cap}",
  "twin.lookSpend": "Today, on looks: {input} input tokens and {output} output.{unmetered}",
  "twin.lookUnmetered": " {n} unmeasured: that provider doesn’t publish usage.",
  "twin.lookMissing": "I can’t find that file: {path}",
  "twin.lookEmpty": "That file is empty: {path}",
  "twin.lookNotImage": "That isn’t an image: {path}",
  /*
    The cap named here is the one for reading a file off this disk, which is not the one for what
    travels to a provider: how much of a capture is sent is chosen on the Spend screen and applied
    by the route, so this terminal no longer answers that question. What is left for it to refuse
    is a file so big that it is an export and not a screen.
   */
  "twin.lookTooBig":
    "That screenshot weighs {size} and the most that gets read off a disk is {cap}. A file that\n  big is an export, not a screen: crop it or export it smaller. How much of a capture the\n  critic is shown is decided on the Spend screen, not here.",
  "twin.lookRejected": "Couldn’t look at that ({status}). {detail}",

  "next.title": "What’s next",
  "next.count": "{n} project{s} with something to propose",
  "next.andMore": "and {n} more project{s} with something to propose",
  "next.onlyNorth": "{n} more project{s}, waiting for you to say what “finished” means there.",
  "next.onlyNorthHint":
    'Say it with: panoma north <project> "…"   ·   or on its card: {api}/p/<project>',
  "next.nothing": "Nothing to propose: what’s in the catalog is where it should be.",
  "next.nothingHint":
    "That’s neither praise nor a bug: it’s what comes out of looking at README, health, dependencies, advisories, unsaved work and months idle.",
  "next.tooOld": "This catalog can’t say what’s next yet.",
  "next.tooOldHint":
    "It’s older than this CLI. Update it and bring it back up: panoma down && panoma up",
  "next.badReport": "The catalog replied with something that isn’t a report.",
  "next.httpError": "The catalog returned {status}. {detail}",
  "next.noNorth":
    "Nobody has written what “finished” means here, so any ordering is guesswork.",
  "next.noNorthAll":
    "Without knowing what “finished” means, everything proposed below is guesswork.",
  "next.noNorthCount": "No north written: {n} on this list.",
  "next.resume": "Pick it back up",
  "next.presentable": "Make it presentable",
  "next.plan": "A prioritized plan",
  "next.competitors": "What it’s up against",
  "next.whyUnsaved": "{n} unsaved-work warning",
  "next.whyUnsavedMany": "{n} unsaved-work warnings",
  "next.whyNoReadme": "there is no README that explains it",
  "next.whyNeverBuilt": "nobody has ever checked whether it still builds",
  "next.whyIdle": "idle for a month",
  "next.whyIdleMany": "idle for {n} months",
  "next.whyAdvisories": "{n} open security advisory",
  "next.whyAdvisoriesMany": "{n} open security advisories",
  "next.whyOutdated": "{n} outdated direct dependency",
  "next.whyOutdatedMany": "{n} outdated direct dependencies",
  "next.whyLowHealth": "health {n} out of 100",
  "next.whyLongIdle": "{n} months idle: the question is no longer about maintenance",
  "next.whyCritiques": "{n} thing showing without opening the project",
  "next.whyCritiquesMany": "{n} things showing without opening the project",
  "next.noSuchProject": "“{query}” isn’t in what’s next today.",
  "next.noSuchProjectHint": "Today’s list comes out of: panoma next",
  "next.noSuchMove": "“{kind}” isn’t proposed on {name} today.",
  "next.noSuchMoveHint": "What is proposed there: {kinds}",
  "next.launching": "Opening your agent on {name}…",
  "next.launched": "working on {name}",

  "north.title": "Each project’s north: what “finished” means there",
  "north.quote": "“{north}”",
  "north.blankCount": "No north written: {n} of {total} project{s}.",
  "north.blankHint": 'Say it in one line, looking at the project: panoma north <project> "…"',
  "north.allWritten": "{n} project{s} in the catalog, and not one is left without a north.",
  "north.noneWritten": "No north has been written yet.",
  "north.unlistedCount":
    "Norths written that can’t be read from here: {n}, those of projects with nothing pending.",
  "north.rewrite": 'Rewrite it with: panoma north {slug} "…"',
  "north.sayIt": "Say it in one line, looking at the project:",
  "north.card": "or on its card: {url}",
  "north.unlistedOne": "There is a north written here and this terminal can’t read it.",
  "north.unlistedOneHint":
    "The daily report only carries projects with something pending, and nothing is pending in this one.",
  "north.blind": "A north that cannot be read is not replaced blind.",
  "north.blindHint":
    "Whatever is written would be gone before you ever saw it. If you want to replace it anyway: --force",
  "north.saved": "North written in {name}",
  "north.savedOver": "North replaced in {name}",
  "north.replaced": "It replaces this one, which the catalog no longer keeps:",
  "north.replacedBlind": "The one that was there couldn’t be read, so not even an echo of it is left.",
  "north.rejected": "The catalog could not store the north ({status}). {detail}",
  "north.noIdentityHint":
    "Scan it again and the sentence will have somewhere to live: panoma scan {root} --save",
  "north.noSuchProject": "“{query}” isn’t in the catalog.",
  "north.noSuchProjectHint": "The exact names, with their north, come out of: panoma north",

  "review.checking": "Checking the project against itself…",
  "review.title": "What is wrong, and provable without opening it",
  "review.count": "{n} mechanical problems · {files} file{s} read",
  "review.countOne": "1 mechanical problem · {files} file{s} read",
  "review.groupColor": "Colours that are not in the palette",
  "review.groupRadius": "Corners that do not match",
  "review.groupImage": "Images that do not say what they show",
  "review.groupLink": "Links that lead nowhere",
  "review.row": "{place} · {claim} — {reason}",
  "review.rowBare": "{claim} — {reason}",
  "review.more": "and {n} more of the same",
  "review.colorDrift": "used once or twice; the project uses {hint}",
  "review.radiusDrift": "and {hint} are the same corner by eye, written several ways",
  "review.imageNoAlt": "does not say what it shows: whoever cannot see it, misses it",
  "review.linkMissing": "does not exist in the project",
  "review.linkMoved": "missing; there is one at {path}",
  "review.truncated":
    "the project has more files than the index holds: links and palette were not checked",
  "review.next": "None of this needs judgement: fix it and run panoma review again.",
  "review.clean": "Nothing to report: {files} file{s} read, not one mechanical problem.",
  "review.cleanHint":
    "What is left —whether it looks good, whether it matches the rest— needs an eye, and this command hasn’t got one.",

  "usage.next": "Usage: panoma next   ·   panoma next <project> <assignment>",
  "usage.open": "Usage: panoma open <project>   ·   --folder   ·   --terminal   ·   --all",
  "usage.describe": "Usage: panoma describe <project>",
  "usage.search": 'Usage: panoma search "text to find"',
  "usage.run": "Usage: panoma run <project> <package> [version]   ·   panoma run <project> --security",
  "usage.agentKey": 'Missing the name: panoma agent-key "Claude Code"',

  // ── The portable memory ───────────────────────────────────────────────────
  "memory.usage": "Usage: panoma memory export <project> [--out <file>]",
  "memory.usageHint":
    "The project is its exact slug, the one the catalog shows. Without --out the JSON goes to stdout.",
  "memory.wrote": "Wrote {path} · notes: {notes} · decisions: {decisions}",

  // ── The spend: what the models cost, and the caps ─────────────────────────
  "spend.title": "Spend",
  "spend.today": "Today",
  "spend.month": "Last 30 days",
  "spend.family": "{name}: {used} of {cap} ({source})",
  "spend.source.factory": "factory",
  "spend.source.file": "chosen on the Spend screen",
  "spend.source.paused": "paused",
  "spend.source.env": "{variable} decides",
  "spend.source.envUnread": "{variable} is set but cannot be read, so the factory value applies",
  "spend.unbudgeted": "{name}: {n} (no cap)",
  "spend.shotsFull": "screenshots: the critic sees every pixel of the capture",
  "spend.shotsFit": "screenshots: fitted before travelling, to a long edge of {n} px",
  "spend.none": "No model was called today.",
  "spend.monthNone": "No model was called in the last thirty days.",
  "spend.calls": "calls: {n}",
  "spend.tokens": "tokens: {input} in · {output} out",
  "spend.unmetered": "unmetered: {n}",
  "spend.images": "images: {n}",
  "spend.cost": "cost: {money}",
  "spend.unpriced": "calls without a rate: {n}",
  "spend.noRate": "No rate written yet, so no money: write yours on the Spend screen.",
  "spend.paused": "Paused: every cap reads as zero until it is lifted on the Spend screen.",
  "spend.broken": "spend.json exists and cannot be read: the factory values apply.",
  "spend.screen": "The caps and your rates, at {url}",
  "spend.rejected": "The catalog could not report the spend ({status}). {detail}",
} as const;

export type MessageKey = keyof typeof MESSAGES;
/**
 * The language that the CLI requests from the catalog.
 *
 * The website IS bilingual, so header still makes sense: it says in which language we want the
 * answer. What no longer makes sense is to calculate it, because the terminal speaks only one.
 */
export const CLI_LANGUAGE = "en";

export type Vars = Record<string, string | number>;

/**
 * The sentence, with its blanks filled in.
 *
 * A worthless hole remains written as is —`{n}`— instead of disappearing: seeing `{n}` in the
 * terminal is ugly but can be traced up to here in a grep, and a mutilated phrase cannot.
 */
export function say(key: MessageKey, vars: Vars = {}): string {
  return MESSAGES[key].replace(/\{(\w+)\}/g, (hole, name: string) => {
    const value = vars[name];
    return value === undefined ? hole : String(value);
  });
}

/**
 * The plural of a short word, which in English is resolved with an 's'.
 *
 * It is valid for «project/projects», which is everything that is pluralized in this output. When
 * an irregular form is needed, it will have its own key instead of a special case here.
 */
export function plural(n: number, many = "s", one = ""): string {
  return n === 1 ? one : many;
}

/**
 * The risk, drafted.
 *
 * The engine returns the fact —the code and the number— and the painter puts the words. He did it
 * halfway: `workRisks` also brought a `label` already written in Spanish, with the reason «because
 * CLI is Spanish». CLI stopped being so on 25-Aug-2026 and the field outlived the reason, so the
 * `panoma scan` record printed «4 uncommitted files» below an entire output in English. The
 * Spanish sweep of this same directory did not see it: the sentence was written in
 * `packages/core`, which is outside of it.
 *
 * It is the twin of `riskText` in `apps/web/lib/i18n.ts` —same keys, same words— and now the
 * engine has nothing to contradict either of them with.
 */
/**
 * What went wrong with an app, as one line for the terminal.
 *
 * `satisfies Record<AppFaultCode, MessageKey>` is the whole point: a code added to the
 * vocabulary without a sentence here does not compile. It is the same enforcement `apps-view.ts`
 * gets on the browser side, and the same reason `CASOS` above is a `Record<RiskCode, …>` — a
 * key composed at a call site escapes the compiler unless something closes the set.
 *
 * The fallback is not decoration. This function is fed the `error` column of a job row, and
 * those rows hold values written before this vocabulary existed, plus the app's own prose. An
 * unrecognised value is quoted exactly as it was before, under the sentence it always had.
 */
const FAULT_KEY = {
  offline: "apps.fault.offline",
  "npm-not-found": "apps.fault.npmNotFound",
  "node-too-old": "apps.fault.nodeTooOld",
  "npm-too-old": "apps.fault.npmTooOld",
  "engine-unsupported": "apps.fault.engineUnsupported",
  "does-not-start": "apps.fault.doesNotStart",
  cancelled: "apps.fault.cancelled",
  timeout: "apps.fault.timeout",
  stalled: "apps.fault.stalled",
  "process-failed": "apps.fault.processFailed",
  "no-previous-version": "apps.fault.noPreviousVersion",
  "not-installed": "apps.fault.notInstalled",
  "app-operation-in-progress": "apps.fault.operationInProgress",
  "playwright-not-installed": "apps.fault.playwrightMissing",
  "browser-not-declared": "apps.fault.browserNotDeclared",
  "malformed-requirements": "apps.fault.malformedRequirements",
  "incompatible-protocol": "apps.fault.incompatibleProtocol",
  "staged-update-invalid": "apps.fault.stagedUpdateInvalid",
  "disk-unreadable": "apps.fault.diskUnreadable",
  "unknown-app": "apps.fault.unknownApp",
  "no-space-left": "apps.fault.noSpaceLeft",
  "permission-denied": "apps.fault.permissionDenied",
  "read-only-disk": "apps.fault.readOnlyDisk",
  "too-many-open-files": "apps.fault.tooManyOpenFiles",
  "disk-error": "apps.fault.diskError",
  "command-did-not-start": "apps.fault.commandDidNotStart",
  "broken-installation": "apps.fault.brokenPackage",
  "broken-package-manifest": "apps.fault.brokenPackage",
  "package-outside-installation": "apps.fault.brokenPackage",
  "package-version-mismatch": "apps.fault.brokenPackage",
  "manifest-id-mismatch": "apps.fault.brokenPackage",
  "manifest-file-missing-or-outside": "apps.fault.brokenPackage",
  "invalid-version": "apps.fault.brokenPackage",
  "path-outside-home": "apps.fault.internal",
  "managed-path-is-symlink": "apps.fault.internal",
  "use-clean-data": "apps.fault.internal",
  "invalid-brain-budget": "apps.fault.internal",
  "provider-key-not-allowed": "apps.fault.internal",
  "fixtures-are-test-only": "apps.fault.internal",
  "fixture-registry-must-be-loopback": "apps.fault.internal",
  "invalid-app-job-transition": "apps.fault.internal",
  "invalid-app-spend-receipt": "apps.fault.internal",
  "local-catalog-required": "apps.fault.localCatalogRequired",
  "unknown-app-operation": "apps.fault.unknownOperation",
  "app-not-enabled": "apps.fault.appNotEnabled",
  "provider-not-enabled": "apps.fault.providerNotEnabled",
  "app-budget-exhausted": "apps.fault.budgetExhausted",
  "provider-key-missing": "apps.fault.providerKeyMissing",
  "voice-key-missing": "apps.fault.voiceKeyMissing",
  "requirement-missing": "apps.fault.requirementMissing",
  interrupted: "apps.fault.interrupted",
  "app-failed": "apps.fault.appFailed",
  "invalid-identity": "apps.fault.invalidIdentity",
  "music-outside-project": "apps.fault.musicOutsideProject",
  "provider-confirmation-required": "apps.fault.confirmationRequired",
  "unknown-setting": "apps.fault.invalidSetting",
  "invalid-brain": "apps.fault.invalidSetting",
  "invalid-voice": "apps.fault.invalidSetting",
  "malformed-guide": "apps.fault.appSpokeWrong",
  "protocol-mismatch": "apps.fault.appSpokeWrong",
  "invalid-job-id": "apps.fault.badRequest",
  "invalid-body": "apps.fault.badRequest",
  "body-too-large": "apps.fault.badRequest",
  "invalid-app-input": "apps.fault.badRequest",
  "unknown-app-input": "apps.fault.badRequest",
  "unknown-app-tool": "apps.fault.badRequest",
  "invalid-brief_id": "apps.fault.badRequest",
  "invalid-render_id": "apps.fault.badRequest",
  "invalid-hook": "apps.fault.badRequest",
  "invalid-job": "apps.fault.badRequest",
  "invalid-document": "apps.fault.badRequest",
  "unexpected-operation-input": "apps.fault.badRequest",
  "invalid-range": "apps.fault.badRequest",
  "local-url-required": "apps.fault.localUrlRequired",
  "job-not-found": "apps.fault.jobNotFound",
  "app-job-not-found": "apps.fault.jobNotFound",
  "project-not-found": "apps.fault.projectNotFound",
  "ambiguous-project": "apps.fault.ambiguousProject",
  "app-request-failed": "apps.fault.requestFailed",
  "artifact-not-found": "apps.fault.artifactNotFound",
  "review-failed": "apps.fault.reviewFailed",
  "stage-failed": "apps.fault.stageFailed",
  "no-supported-production": "apps.fault.noProduction",
  "app-error": "apps.fault.appError",
} satisfies Record<AppFaultCode, MessageKey>;

const FAULT_FIGURES: ReadonlySet<AppFaultCode> = new Set(["node-too-old", "npm-too-old"]);

export function appFaultText(value: string | null | undefined, unknown: MessageKey): string {
  const { code, detail } = faultOf(value);
  if (!code) return say(unknown, { detail: value ?? "" });
  if (FAULT_FIGURES.has(code)) {
    const [needed, running, ...rest] = (detail ?? "").split(FAULT_PART);
    // Two figures through one text column. Anything but exactly two and the sentence names none.
    if (!needed || !running || rest.length) return say("apps.fault.engineUnsupported");
    return say(FAULT_KEY[code], { needed, running });
  }
  if (code === "app-error") return say("apps.fault.appError", { detail: detail ?? "" });
  const said = say(FAULT_KEY[code]);
  return detail ? `${said} ${detail}` : said;
}

export function riskText(risk: { code: RiskCode; count?: number }): string {
  const n = risk.count ?? 0;
  /* Both forms always go: the sentence stays with the gap it uses. */
  const vars = { n, s: plural(n), es: plural(n, "es") };

  /*
    Two codes are not pluralized by the number — one does not take it and the other does not
    change with it — and `no-commits` changes the entire phrase depending on whether there is
    something waiting or not.
   */
  if (risk.code === "unversioned") return say("risk.unversioned");
  if (risk.code === "untracked") return say("risk.untracked", vars);
  if (risk.code === "no-commits") {
    return n > 0 ? say("risk.no-commits.n", vars) : say("risk.no-commits");
  }

  return say((n === 1 ? `risk.${risk.code}` : `risk.${risk.code}.n`) as MessageKey, vars);
}
