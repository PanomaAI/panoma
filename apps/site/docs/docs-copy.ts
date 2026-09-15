/**
 * English documentation copy for `/docs`.
 *
 * This page does not share `landing-copy.ts` and has no locale switch. Every
 * string a visitor reads lives here. Command verbs and flags are the ones the
 * shipped CLI already accepts — see `apps/cli/src/lang.ts` (HELP_EN) and
 * `apps/cli/src/args.ts`.
 */

export const DOCS_NAV = [
  { id: "start", label: "Start" },
  { id: "catalog", label: "Catalog" },
  { id: "day", label: "Your day" },
  { id: "agents", label: "Agents" },
  { id: "handoff", label: "Handoff" },
  { id: "memory", label: "Memory" },
  { id: "twin", label: "Twin" },
  { id: "maintain", label: "Maintain" },
  { id: "models", label: "Models" },
  { id: "network", label: "Network" },
  { id: "commands", label: "Commands" },
  { id: "reference", label: "Reference" },
] as const;

export type DocsNavId = (typeof DOCS_NAV)[number]["id"];

export type DocsCommandBlock = {
  /** First positional the CLI dispatches on: scan, up, enrich, md, agent-key. */
  verb: string;
  command: string;
  title: string;
  body: string;
};

export const DOCS_COMMANDS: DocsCommandBlock[] = [
  {
    verb: "scan",
    command: "npx panoma scan ~/Desktop",
    title: "Look, before anything is installed",
    body: "Analyze one project, or every project under that path. Nothing is installed, nothing is written, nothing leaves this machine. --depth <n> goes deeper than the default three levels; --no-git skips history and is faster; -d shows only the families of copies of the same project.",
  },
  {
    verb: "scan",
    command: "panoma scan . -v",
    title: "The full report",
    body: "Dependencies and the health breakdown for one directory. --json prints the raw analysis and --out <file> writes it, which is the pair to use from a script.",
  },
  {
    verb: "up",
    command: "panoma up",
    title: "Start the catalog",
    body: "Binds 127.0.0.1:4173, this machine only. With the port shut there is no key to ask for: whoever can reach it is already inside the machine. Open the port with --network and then the key is asked of everyone, this machine included — the loopback exemption is gone, because the header that claimed to be the loopback was written by whoever was calling. --on-boot leaves it starting at login.",
  },
  {
    verb: "up",
    command: "npx panoma up ~/Desktop",
    title: "Start it and fill it",
    body: "One command instead of two: brings the catalog up and scans that folder into it. Worth knowing over npx, which leaves no panoma on your PATH — so every other command needs the prefix again.",
  },
  {
    verb: "down",
    command: "panoma down",
    title: "Stop it",
    body: "Exits 0 whatever it finds: stopped, nothing running, or a pid that was no longer ours. Stopping something that is already stopped is not a failure.",
  },
  {
    verb: "today",
    command: "panoma today",
    title: "What moved",
    body: "The day's report, written out: new commits, who wrote them, what agents logged. Same thing panoma with no verb prints.",
  },
  {
    verb: "next",
    command: "panoma next",
    title: "What to do, and why that one",
    body: "One assignment per project with the fact that picked it — never “pick this up”, always “pick this up, because nobody ever checked whether it still builds”. Reading does not consume the morning: it leaves the seen mark where it was.",
  },
  {
    verb: "next",
    command: "panoma next kestrel resume",
    title: "Hand it to your agent",
    body: "Two arguments and it opens your agent on that assignment, written by the catalog. Only assignments this same list offered can be launched, and the slug has to be exact: a near match here means an agent writing in the wrong folder.",
  },
  {
    verb: "north",
    command: 'panoma north kestrel "ships when a stranger can run it in one command"',
    title: "Say what finished means",
    body: "With no arguments it lists which projects say it and how many do not. With a sentence it shows the one already there before replacing it, and stops when it cannot read it — a catalog that is down, or older than this CLI. --force writes anyway.",
  },
  {
    verb: "open",
    command: "panoma open kestrel",
    title: "Open it",
    body: "Slug first, then exact name, then contains — accents and case ignored. Several matches are listed, not guessed. --folder reveals it in the file browser, --terminal opens a shell already there.",
  },
  {
    verb: "enrich",
    command: "panoma enrich",
    title: "Refresh versions",
    body: "Latest versions and advisories for what the catalog already holds. Cached 24 hours. The server asks the registries and OSV, so this is one of the few commands that goes off this machine.",
  },
  {
    verb: "enrich",
    command: "panoma enrich --force",
    title: "Skip the cache",
    body: "Also re-check what was checked less than 24 hours ago.",
  },
  {
    verb: "review",
    command: "panoma review",
    title: "The mechanical critic",
    body: "What is wrong and provable without opening it: images that do not say what they show, broken links, a colour used once next to one almost identical used forty times. No model, no network, nothing spent — and it works with the catalog down. A clean project gets a count of files looked at, not silence.",
  },
  {
    verb: "secrets",
    command: "panoma secrets",
    title: "Credentials in your repositories",
    body: "Only what git tracks, with file and line. Values arrive already trimmed: a terminal keeps its scrollback like a browser keeps its cache.",
  },
  {
    verb: "search",
    command: "panoma search fetchWithTimeout",
    title: "Search every project at once",
    body: "Two characters minimum. Finding nothing is an answer, and it exits 0.",
  },
  {
    verb: "disk",
    command: "panoma disk",
    title: "What it costs on disk",
    body: "How much the catalog takes, and how much of that regenerates itself if you delete it.",
  },
  {
    verb: "check",
    command: "panoma check kestrel",
    title: "Does it still build?",
    body: "Installs and builds in a separate worktree, so your folder is never touched, and the project page remembers the verdict. Five of them: ok, failed, no-git, no-toolchain, no-build.",
  },
  {
    verb: "run",
    command: "panoma run kestrel typescript",
    title: "Propose an upgrade",
    body: "Installs it, runs the tests, and leaves a branch with the patch for you to read. Nothing is merged. --isolation picks how sealed off the install is: local, hardened, or container when Docker or Podman is here.",
  },
  {
    verb: "run",
    command: "panoma run kestrel --security",
    title: "Upgrade to the fix, not to the latest",
    body: "Goes to the version that closes the most severe advisory instead of the newest release. A proposal that already failed stays in quarantine until --force asks again.",
  },
  {
    verb: "md",
    command: "panoma md check",
    title: "Lint instruction files",
    body: "What AGENTS.md or CLAUDE.md claims that is no longer true, checked against the real tree. Read-only, no network, works with the catalog down. panoma md fix repairs the ones that left a trail.",
  },
  {
    verb: "md",
    command: "panoma md init",
    title: "Write a living block",
    body: "Adds a self-maintaining context block to AGENTS.md, creating the file if none exists — plus a one-line CLAUDE.md bridge when there is none, because Claude Code only reads its own file. panoma md sync regenerates the block later. Both need the catalog up, but only to read it: writing happens in your terminal, or on the project page with a click. panoma md review is the model's opinion, and it is paid.",
  },
  {
    verb: "agent-key",
    command: 'panoma agent-key "Claude Code" --install',
    title: "Connect an agent",
    body: "Creates a key, prints it once, and writes the config where that agent reads it. The agent then sees the fifteen catalog tools. Or press Connect on the Agents page and skip the terminal.",
  },
  {
    verb: "handoff",
    command: "panoma handoff",
    title: "The conversations on this disk",
    body: "What your agents kept, newest first and grouped by project: the agent, the handle, the title, when it last moved, and whether it ended on a usage limit. Read from the agents' own stores — Claude Code, Codex CLI, OpenCode, Gemini CLI, and the two desktop apps on macOS — in process and on this machine. Nothing is ingested by looking.",
  },
  {
    verb: "handoff",
    command: "panoma handoff --to codex",
    title: "Continue it in another agent",
    body: "The newest conversation in this folder, written into Codex's own history with a fresh id, so its normal resume finds it as one of its own. The original is untouched. --tier compact sends the digest and the newest turns instead of every one; --dry-run shows what would travel and what would stay, and writes nothing. A handle picks a conversation that is not the newest: the first eight characters of its id, or any unique prefix of four or more.",
  },
  {
    verb: "handoff",
    command: "panoma handoff --to bundle --out conversation.json",
    title: "Take it to another machine",
    body: "A portable file with the conversation and its digest, outside every agent's store. On the other machine, panoma handoff conversation.json --to claude reads it back and writes it there. It is also the copy that survives a store being emptied or an agent being uninstalled.",
  },
  {
    verb: "hooks",
    command: "panoma hooks --install",
    title: "Record what happens here",
    body: "Two hooks: one writes down what agents do without them having to report it, one delivers sleeping notes at the path about to be edited. --remove undoes it. What it writes is the script that will call the catalog later, so it needs no catalog to install.",
  },
  {
    verb: "ai",
    command: "panoma ai",
    title: "Which model this uses",
    body: "Which provider is picked, which agents are already installed here, and which keys are stored. panoma ai key <provider> reads the key from stdin, never from an argument, so it stays out of your shell history.",
  },
  {
    verb: "ai",
    command: "panoma ai use claude-cli --model sonnet",
    title: "Pick one",
    body: "A cli provider is an agent already installed on this machine, so there are no tokens to count and no key to store. panoma ai ask checks the wiring works before anything else depends on it.",
  },
  {
    verb: "describe",
    command: "panoma describe kestrel",
    title: "Ask the model what it is",
    body: "The only text panoma prints that does not come from a verifiable fact, so it goes out with the model's name in front of it. Needs a provider picked.",
  },
  {
    verb: "spend",
    command: "panoma spend",
    title: "What the models cost",
    body: "What was called today and over the last thirty days, organ by organ, with how much of each ceiling is left and who decided it. Money only appears once you write your own rate, model by model, on the screen this prints: panoma ships no price table, because a year-old price is worse than none. --json prints the whole receipt.",
  },
  {
    verb: "twin",
    command: "panoma twin sources",
    title: "What your agents already know about you",
    body: "Which agent histories sit on this disk and how big they are. Measured with stat: not one file is opened until panoma twin allow names that source.",
  },
  {
    verb: "twin",
    command: "panoma twin look kestrel",
    title: "Show it a screen",
    body: "It names the rule of yours the screen breaks, with the next instruction already written. Costs a model call, capped per day. --dry-run stops at the estimate.",
  },
];

export const DOCS_MD_SUBS = ["check", "fix", "init", "sync", "review"] as const;

export const REQUIRED_DOCS_VERBS = ["scan", "up", "enrich", "md", "agent-key"] as const;

export function documentedCommandVerbs(blocks: readonly DocsCommandBlock[] = DOCS_COMMANDS): string[] {
  return [...new Set(blocks.map((block) => block.verb))];
}

export function documentedFlags(blocks: readonly DocsCommandBlock[] = DOCS_COMMANDS): string[] {
  const flags = new Set<string>();
  for (const block of blocks) {
    for (const match of block.command.matchAll(/--[a-z][a-z0-9-]*/g)) {
      flags.add(match[0]!);
    }
  }
  return [...flags];
}

export const DOCS_COPY = {
  skip: "Skip to documentation",
  brand: "panoma",
  heading: "docs",
  catalogLink: "Catalog",
  landingLink: "Product",
  github: "GitHub",
  githubUrl: "https://github.com/PanomaAI/panoma",
  heroKicker: "Reference",
  heroLine: "The local catalog, from this machine.",
  scroll: "Read the reference",
  copy: { idle: "copy", done: "copied", aria: "Copy command" },
  start: {
    kicker: "01",
    title: "Start",
    lead: "Two steps: look at a folder, then start the catalog the web app reads.",
    tryNote: "No install. Analyzes the folder and prints what lives there.",
    upNote: "Starts the web app. Default bind is 127.0.0.1:4173.",
    downNote: "Stop it.",
    downCommand: "npx panoma down",
    more: "From this repository, pnpm --filter @panoma/web run dev is the same server. Scan is a one-time fill: after that, the watcher keeps the catalog current. Set PANOMA_WATCH=0 to turn the watcher off.",
  },
  catalog: {
    kicker: "02",
    title: "Catalog",
    lead: "Each project page has a section rail. All is the default. Click a section to keep that view and the right-hand column; the rest recedes. Click the same section again to return to All.",
    hint: "Hashes still work. Open /p/<slug>#md and you land on that view, not a buried scroll target.",
    views: [
      { hash: "#all", label: "All" },
      { hash: "#summary", label: "Overview" },
      { hash: "#activity", label: "What happened" },
      { hash: "#resume", label: "Resume" },
      { hash: "#accounts", label: "Accounts" },
      { hash: "#assignments", label: "Assignments" },
      { hash: "#memory", label: "Memory" },
      { hash: "#md", label: "The .md" },
      { hash: "#dependencies", label: "Maintenance" },
      { hash: "#agents", label: "Agents" },
      { hash: "#details", label: "Details" },
    ],
  },
  day: {
    kicker: "03",
    title: "Your day",
    lead: "Two questions each morning, and they are not the same question: what moved, and what to do about it. Both come out of the same report, so the terminal and the front page never propose different things on the same day.",
    commands: [
      { command: "panoma", note: "The day's report: what moved since you last looked. New commits, what agents logged here, proposals parked on a yes or a no. With the catalog down it still exits 0 — it prints how to start it, then the help, because on day one that is the thing you were missing." },
      { command: "panoma today", note: "The same report, written out. For when your fingers already typed a verb." },
      { command: "panoma next", note: "What to do in each project, and the fact that picked it. Never “pick this up”, always “pick this up, because nothing has ever checked whether it still builds”. Eight projects on screen, the rest summarized; projects whose only move is a missing north are counted in one line instead of repeating the same scolding once per folder." },
      { command: "panoma next <project> <assignment>", note: "Two arguments and it launches: your agent opens with the assignment already written. The project is matched by exact slug — the one this same list just printed — and only assignments that list offered are accepted: resume, presentable, plan, competitors. The text is composed on the server and never goes through a shell. A third argument is an error, not a word to ignore." },
      { command: "panoma north", note: "What “finished” means in each project, how many do not say it, and where to write it. The count is exact: a project without a north always shows up in the report, so nothing hides in the tally. A north this terminal cannot read is marked as such instead of being shown blank." },
      { command: "panoma north <project> \"ships when the importer runs green\"", note: "Writes it. Up to 300 characters. Replacing one shows you the sentence that was there first, and refuses when this terminal cannot read that sentence; --force writes anyway. Exact slug only: opening the wrong folder costs a keystroke, overwriting the wrong north destroys a sentence nobody asked to lose." },
    ],
    northTitle: "The north is one sentence",
    northBody: "A north says what finished means here, in a way that can be checked: “ships when the importer runs green”, not “improve the importer”. Until one exists, the first thing next proposes in that project is writing it, because every other order would be a guess — and in a fresh catalog that is the same line under every project, which is why they get folded into one count. Once the sentence is there, the moves have something to point at and the list stops asking and starts proposing. It is the only write in the whole catalog that cannot be worked out from your disk: everything else is there to be observed, this has to be told.",
    seenTitle: "The report is consumed by reading it",
    seenBody: "“What moved since you last looked” only means anything if the mark moves when a person actually looks. So it moves on a terminal and nowhere else. Piped into a pager, redirected to a file, run from cron or from CI, the report is fetched without touching the mark — otherwise a scheduled job would eat your morning and the front page would say “nothing new” over a whole night of agent work. panoma next never moves it either: seeing what is pending is not the same as having read the news. The error is chosen toward this side on purpose. Leaving the mark alone costs you seeing something twice; moving it too eagerly deletes what you came to read.",
  },
  agents: {
    kicker: "04",
    title: "Agents",
    lead: "Context goes out through the instruction file. The trail comes back through MCP. They do not replace each other.",

    mcpTitle: "MCP",
    mcpLead:
      "An agent opens every session blind. It can read your files, so it can work out what the project is — but not what happened here yesterday, not what the last agent already tried and gave up on, not which finished proposal is parked waiting on you. MCP is the channel that carries all of that in, and carries today's work back out for whoever shows up tomorrow.",

    whyTitle: "What it changes",
    why: [
      {
        title: "The session opens informed",
        body: "One call, before a single file is opened: the stack, the dependencies that are behind, the open advisories, the tasks nobody has taken, and what other agents did here. Half of it changes overnight, which is why it is worth asking again each day.",
      },
      {
        title: "The work leaves a reason",
        body: "Commits record what changed. panoma_log records why — a decision, a dead end, a blocker — and that is what tomorrow's since-yesterday is made of. Without it, the next session rebuilds your reasoning from diffs, badly.",
      },
      {
        title: "Two agents stop colliding",
        body: "The queue is shared and a claim can legitimately fail. An agent takes a task before starting it; if somebody got there first, it picks another one instead of doing the same work twice.",
      },
      {
        title: "The first call already works",
        body: "If the project is not in the catalog yet, panoma_context analyzes it and enrolls it on the spot. No scan first, no error telling a working agent to go find a human.",
      },
    ],

    setupTitle: "Connect one",
    setupLead:
      "The shortest way is not the terminal: open Agents in the app and press Connect next to the one you want. Panoma already knows which agents are on this machine, so it fills in the key and writes the config where that agent reads it. From the terminal, inside the project you want it to see:",
    setupSteps: [
      {
        command: "panoma up",
        note: "The tools answer from the catalog on this machine, so it has to be running.",
      },
      {
        command: 'panoma agent-key "Claude Code" --install',
        note: "Registers that agent, prints its key once, and writes the file that agent actually reads — for Claude Code that is this project's .mcp.json, with command, PANOMA_API and PANOMA_KEY filled in. Other MCP servers in that file are kept, and it says which ones.",
      },
    ],
    setupNote:
      "Not every agent gets a file written. Where the format is one we will not merge blind — Codex keeps its servers in TOML — the block is printed with the exact path to paste it into, and nothing is touched. Writing a file the agent does not read and calling it done is worse than printing it, because it takes half an hour to find out. Same reason the block points at a server path on this disk and never at a package fetched at launch.",
    setupRestart:
      "Then restart the agent. None of this is picked up by a session that was already open, and an agent that starts without the tools looks exactly like an agent that was never connected.",

    toolsTitle: "The fifteen tools",
    tools: [
      {
        name: "panoma_context",
        why: "The brief. Called on arrival, before any file is opened, and again on each new day. If the project is not in the catalog, this same call enrolls it.",
      },
      {
        name: "panoma_log",
        why: "Record a change worth remembering, a decision, a dead end, a blocker. Not every edit — what somebody will need three months from now.",
      },
      {
        name: "panoma_remember",
        why: "Propose a durable fact for the project's curated memory. The log records what happened; memory keeps what is still true. Nothing is served until the owner approves it.",
      },
      {
        name: "panoma_recall",
        why: "Search the full journal — everything ever logged here, not just the recent window. For history: how something was fixed, whether an upgrade was already tried.",
      },
      {
        name: "panoma_ask",
        why: "Leave a criterion question for the owner's double instead of interrupting the owner. In shadow training for now: the double drafts, the owner grades, and one day it answers instantly.",
      },
      {
        name: "panoma_tasks",
        why: "The queue, open and closed. Closed is the useful half: it says what was already tried here, and how it went.",
      },
      {
        name: "panoma_create_task",
        why: "Park work that is not this session: debt, a bump, a missing test. It waits for whoever picks it up, human or agent.",
      },
      {
        name: "panoma_claim_task",
        why: "Take one before starting it. This can fail, and a failure means somebody else got there first.",
      },
      {
        name: "panoma_complete_task",
        why: "Close it, and say how it was solved.",
      },
      {
        name: "panoma_conversations",
        why: "The conversations kept for this project, newest first, and the receipts of what was already handed off. Read from the agents' own stores on this machine; nothing is ingested by looking.",
      },
      {
        name: "panoma_handoff",
        why: "Continue this conversation in another agent, when the person asks. The copy goes into that agent's own history with the mechanical digest; dryRun shows what would travel and writes nothing. The same agent is not a target on this channel: see Handoff below.",
      },
      {
        name: "panoma_apps",
        why: "The optional apps on this machine: installed version and the newest on npm, whether each is ready, every requirement and whether it is present, the model and the voice you switched on, and your next step when it is not ready. Reads only.",
      },
      {
        name: "panoma_video",
        why: "Make a video of this project with panoma video, when you ask for one: a promo, a trailer, a tutorial. A durable job in the agent's name, with the model and the voice you confirmed on the app's page — the agent cannot choose them, and it cannot install, enable or download anything.",
      },
      {
        name: "panoma_video_jobs",
        why: "The project's productions, or one whole: its twelve stages with what each did, the cuts with their files on this machine, the kinds of video set aside and why, what it spent. wait holds the call until the job moves.",
      },
      {
        name: "panoma_video_cancel",
        why: "Stop a production of this project. What it had already recorded stays for the next run.",
      },
    ],

    reportTitle: "What comes back",
    reportLead:
      "panoma_context answers with a written brief, not with JSON. The reader is a language model, and an ordered summary is used better than an object graph. What is left out is a decision too: 300 dependencies help nobody, the 12 that are behind and the 3 advisories do.",
    reportOrder: [
      "What moved since that agent last looked: new commits, who wrote them, and what other agents logged here.",
      "Finished proposals, parked on a yes or a no from you.",
      "Open tasks, and who is holding each one.",
      "The stack, the dependencies that are behind, and the advisories that hit them.",
    ],
    reportNote:
      "That order is load-bearing. What changes overnight goes first, so the daily call has something new at the top and so that part survives if the brief has to be trimmed. Two identical calls return identical text: ties break by name, never by whatever order the database happened to return.",
    reportLang: "The brief is in English, and so are the tool names and their arguments — whatever language the catalog is showing you. A model has no locale to negotiate.",

    safetyTitle: "It arrives as data, not as orders",
    safetyBody:
      "Almost nothing in that brief was written by whoever is asking. Descriptions come from a manifest that may belong to somebody else's clone, advisories from OSV, tasks and log entries from other agents holding a key. All of it lands in a model that has tools and your disk in front of it, through the same channel instructions arrive on — so it travels wrapped, marked as unverified, and the brief opens by saying what that mark means. Length is capped for the same reason: one task with a two-megabyte body would eat the window the agent came to use.",

    mdTitle: "Instruction files",
    mdLead: "Agents already read AGENTS.md — except Claude Code, which only reads CLAUDE.md. Panoma checks those claims against the real tree, and writes the one-line bridge for the exception.",
    mdCommands: [
      { command: "panoma md check", note: "Read-only. Exit 1 only when something is false. Fine in CI." },
      { command: "panoma md fix", note: "Repair the obvious lies — the ones with a trail." },
      { command: "panoma md init", note: "Write the living block. Creates AGENTS.md if none exists, and a CLAUDE.md bridge for Claude Code. Needs the catalog up." },
      { command: "panoma md sync", note: "Regenerate the block. Needs the catalog up." },
      { command: "panoma md review", note: "The model's opinion. Paid. On purpose." },
    ],
  },
  handoff: {
    kicker: "05",
    title: "Handoff",
    lead: "A conversation continues in another agent, and the original stays where it was.",
    leadBody:
      "You are working with an agent and the usage limit hits, or the next step wants a different tool. Until now the answer was re-explaining everything, or pasting a summary by hand. A handoff writes a new conversation into the target agent's own history, with an id of its own, so that agent's normal resume picks it up as one of its own — no prompt to paste, no summary to trust. The original is never modified: the copy is written beside it and renamed into place, and the two can be opened a month later and told apart. Nothing is deleted anywhere.",

    targetsTitle: "Who can take one",
    targetsLead:
      "Every agent's own resume reads a file from a folder, consults no index, and accepts a file somebody else wrote as long as it has the shape. That observation is the whole feature, and it draws the line between three kinds of target.",
    targets: [
      {
        title: "Resume it themselves",
        body: "Claude Code, Codex CLI, OpenCode and Gemini CLI. The copy is written into their own store and the resume command each of them already has picks it up, from the project folder. OpenCode imports the file first: Panoma runs opencode import for you when it finds the binary, prints the line when it does not, and always prints it when an agent asked. The same four are the sources, because those are the stores Panoma reads. Three were resumed live — Claude Code 2.1.258, Codex CLI 0.153.0, OpenCode 1.2.6 —; Gemini CLI was checked against its source and never run, so the first person with it installed is the first real test.",
      },
      {
        title: "Open it through a link, on macOS",
        body: "Claude (app) and Codex (app). An app is not another agent, it is a surface: one vendor, one store, two doors. The file written is the same the terminal target gets, and the door is the vendor's own link, run once each on the builds of 11-Sep-2026 — Claude.app 1.52386.3, and the Codex app inside ChatGPT.app: the Claude link adopts the file and marks the folder as trusted, the Codex link registers the thread and opens it. The terminal line is printed under the link every time, and off macOS the two app targets are not offered.",
      },
      {
        title: "Get a document",
        body: "Cursor, Copilot, Aider, Amp and Goose cannot resume a file Panoma wrote, so they get a Markdown document with the digest and the last exchange, to paste as the first message. Their stores are not read: targets, never sources, and a target that cannot resume what was written says so instead of pretending.",
      },
    ],

    tiersTitle: "Three tiers",
    tiersLead:
      "How much travels is chosen before anything is written, with the counts and what each tier weighs in tokens in front of you.",
    tiers: [
      {
        level: "full",
        body: "Every turn, the tool calls and their results, the source's own summaries where each was made, and the title. A conversation the agent compacted travels whole: the target's own model restarts from the newest summary, as the source's did, and the transcript on both sides is everything. The default for a native target, and the promise the tests hold: read back, the copy hashes the same as the source.",
      },
      {
        level: "compact",
        body: "The digest written as the first turn, plus the newest turns whole — twelve by default, and --keep changes it. For a source that is large: a conversation that ended on a limit is usually the size that hit it, and the Handoff screen preselects this tier over 16 MiB or 150,000 estimated tokens and says which measure decided. Every tier is weighed before anything is written, and the screen prints its tokens next to it. With the model box ticked, the connected model compacts the whole conversation itself, in windows of 60,000 characters read oldest to newest, one call per window, and the last answer is the summary: the box starts ticked when the source carries no summary Panoma can read, and off when it does, because then the model would only add what came after that summary. A chain that does not fit in the calls left today is refused before the first one, with both figures; with no model connected, the screen says beside the box that the mechanical digest travels instead, and links to where a model is connected.",
      },
      {
        level: "brief",
        body: "A Markdown document with the digest and the last exchange, to paste as the first message. Any agent takes it, and it is the only tier for a document-only one.",
      },
    ],

    staysTitle: "What never travels",
    stays: [
      "Thinking and reasoning blocks. Claude's signed ones cannot be reproduced, and Codex's cannot be produced at all. A target cannot verify another model's reasoning, and that is a loss you are told about, not a fix waiting to happen.",
      "Images.",
      "Subagent runs.",
      "Secrets. Every text the writers emit — turn text, tool output, summary, title — goes through the same redactor as the journal, and each mark is one more in the count. It matches known provider shapes and nothing else: a password with no known shape travels, and the count is a count of what matched.",
      "A conversation over 64 MiB. Refused before anything is written.",
    ],
    staysNote:
      "None of it is dropped in silence. The counts are computed before the write and painted on the Handoff screen, above the button, as travels and stays behind, so the decision is taken with the figures in front of you. And the first written turn — or the summary, when there is one — starts with Continued from, followed by the source agent, its session id, the date and the tier. It is there for whoever opens the file a month later, and for Twin: the history readers skip a file that starts with it, so a handed-off copy is never mined as your own evidence a second time.",

    doorsTitle: "Three doors",
    doorsLead:
      "The screen, the terminal, and the agent channel open the same engine. The screen is /handoff, behind the second key, the one that authorizes running things on this machine (Network, below): the conversations on this disk grouped by project, a badge on the ones that ended on a limit, a preview with what travels and what stays, one press to write, and a launch button that opens the terminal or the app on the copy. Listing and previewing read the stores in process and store nothing: a conversation appears because it is on the disk. From the terminal:",
    commands: [
      {
        command: "panoma handoff",
        note: "The list: what your agents kept on this disk, newest first, grouped by project when the catalog is up and plain when it is not.",
      },
      {
        command: "panoma handoff --to codex",
        note: "The newest conversation in this folder, into Codex's own history. Two different agents within the same hour is not a choice this command makes: it names both handles and stops, because the wrong one handed over is the one you were not looking at.",
      },
      {
        command: "panoma handoff 3f9a --to claude --tier compact",
        note: "A handle picks one that is not the newest: the first eight characters of the id, or any unique prefix of four or more. Ambiguity is an error that names the candidates, never a guess. --keep changes how many of the newest turns travel whole.",
      },
      {
        command: "panoma handoff --to opencode --dry-run",
        note: "What would travel and what would stay, with the counts and what each tier weighs in tokens, and nothing written. --json prints the same as an object, for a script.",
      },
      {
        command: "panoma handoff --to bundle --out conversation.json",
        note: "The portable file: the conversation and its digest, outside every agent. It survives a store that is emptied, an agent that is uninstalled, another machine — where panoma handoff conversation.json --to codex reads it back.",
      },
      {
        command: "panoma handoff --to codex --digest model",
        note: "A model writes the summary section of the digest instead of a function, reading the whole conversation in windows of 60,000 characters, one call each. Paid, under its own daily cap of ten, checked against the whole chain before the first call; the conversation travels to the provider wrapped as untrusted material, the catalog has to be up, and the terminal says how many calls it took. Off by default here, because the mechanical digest is free and the same on every run.",
      },
    ],
    commandsNote:
      "Every path honours the agent's own variable — CLAUDE_CONFIG_DIR, CODEX_HOME, XDG_DATA_HOME — and --target-home points a copy at a second home of the same agent that already exists. The terminal is the only door that takes a path.",

    mcpTitle: "The agent hands its own conversation on",
    mcpBody:
      "The third door is MCP. An agent with a key can list the conversations kept for the project its call names — the folder it is in unless it names another, the way panoma_context does — and the receipts of what was already handed off, with panoma_conversations; and when the person asks, hand its own conversation to another agent with panoma_handoff — the newest one for the project unless an id names another, at any tier, to a terminal or an app target, with dryRun answering what would travel and writing nothing: no file, no receipt. The write answers what the screen gets — the digest redacted, and never the document itself — and the receipt carries the agent's name as who asked. Two things are decided at the door. The same agent is not a target on this channel, at any tier or surface: continuing with the account you sign in with is your own gesture, on the screen or in the terminal, and an agent never takes it for you. And the model-written digest is not on this channel either: an agent gets the mechanical one, so no conversation is sent to a provider because a model decided to. One more step in the flow stays yours too: for OpenCode the import line is printed for you to run, never run by the agent.",
    mcpGate:
      "The stores are private history, so the gate is that second key's before it is the agent's: both routes answer this machine only, then ask for the agent key, which sets who asked and which project. A catalog reached over the network cannot hand off, whatever key it holds, because the conversations live on the catalog's disk and the second key never leaves it. Under a remote database the routes refuse outright.",

    sameTitle: "The same agent, the account you sign in with",
    sameBody:
      "Every store is per machine and per folder, never per account — Claude Code's projects folder, Codex's sessions, OpenCode's database, Gemini's chats — so signing out removes a credential and not a file, and the conversation is still on the disk when you sign in again. That is why the same agent, whichever surface, writes nothing at full: there is nothing to write. What the screen and the terminal print is your own steps, and neither runs one of them: sign out of that agent, sign in with the account you want to continue with, and resume the same file with its normal line. Two optional lines under it: a fork, so the original stays as it is, and the bundle above. On macOS the app link is printed under the resume step, because Claude.app lists conversations per account and the link adopts the file into whichever you signed in with, and the Codex app lists from the shared database, where the thread already is. At compact it does write: a shorter copy in the same store with an id of its own, for a conversation that hit the limit at exactly the size that hit it — the steps are the same, with the copy's line under the third. Panoma holds no credential, rotates nothing and automates nothing here.",

    receiptTitle: "The receipt",
    receiptBody:
      "What reaches the catalog is the receipt, never the text: which conversation became which, when, at which tier, on which surface, who asked, what was left behind, and the line that resumes it. It is what lets the screen say already handed to Codex on Tuesday, resume that one, instead of writing a second copy — keyed by source, agent and surface, so a copy for the app and one for the terminal are two receipts — and what Done so far lists at the foot of the screen, with what travelled and what stayed. The resume line is a display line: the launch button re-derives the command from the agent and the id every time and hands it to a binary the detector verified, so nothing stored is ever executed as stored. The receipt does not watch the file; if the agent later deletes or moves it, the screen says file gone when it looks, and nothing else. And the digest is not memory: title, goal, decisions, files touched, commands run, open items, the last exchange and the counts are derived from one file for one gesture, regenerable from the same conversation, and stored nowhere.",
  },
  memory: {
    kicker: "06",
    title: "Memory",
    /*
      The phrase that gives name to the entire floor, and the contrast that explains it. It comes
      from the panel that sought the axis that no one occupies: the memory of a chat only knows
      what someone tells it; it lives on the disk and sees the world change.
     */
    lead: "The first agent memory that lives in the world, not in the conversation.",
    leadBody:
      "A chat remembers what somebody typed at it. Panoma sits on your disk: it sees files change, scripts disappear, projects move. That is why its memory can do something a conversational one cannot — notice on its own that something it remembers stopped being true, and stop saying it, without anyone having to speak. And every byte it hands an agent is written down before it leaves and read back afterwards from the agent's own record, so the question “did the rule reach it?” has an answer that is not a guess.",

    storyLine: "Before the reference, the walk: one sentence of yours followed until it is a rule every agent receives — told plainly, or with every name and figure the code uses.",
    storyAside: "The same walk on a page of its own, in Spanish as well:",
    storyLink: "/memory",

    floorsTitle: "Four floors",
    floorsLead:
      "Each one answers a different question. The journal says what happened; the curated memory says what is still true; a sleeping note says where; a check says what the disk has to look like for that to hold.",
    floors: [
      {
        title: "The journal",
        body: "Everything agents log here, kept forever and searchable page by page. panoma_recall reads it; the hooks write to it without anyone having to remember.",
      },
      {
        title: "The curated memory",
        body: "What is still true, in one or two sentences each: a note, a criterion of your taste, a decision with its rationale, a commitment you took on. Agents propose, you approve, and only then does it travel to every agent that opens this project. Every unit has a revision, and every change photographs the row as it was.",
      },
      {
        title: "Notes that sleep",
        body: "A note can carry a where — an exact path, or a zone such as apps/web. Then it does not travel in the brief and costs nothing: it wakes at the instant an agent is about to touch that path, like a sign at the spot rather than a page in a manual.",
      },
      {
        title: "Checks",
        body: "A rule can say what the disk should look like: a script that must exist, a literal that must not come back, a dependency that must be declared. The patrol looks, in the worker's free passes, and writes what it saw. A foundation that breaks challenges the note; a violation opens an incident and leaves the rule alone.",
      },
    ],

    gateTitle: "Nothing is served without your yes",
    gateBody:
      "Agents can only ever propose — an agent through panoma_remember, the extractor from your own messages, the Twin from what you told your agents — and all of it lands in one queue. Approving and discarding live behind a screen action, never behind an agent key, and the reason is blunt: an approved note is shown to every agent that opens this project, so a poisoned memory would be a virus with a loudspeaker. Reviewing is the antivirus, and the queue is capped so that reviewing never becomes a chore nobody does.",

    contractTitle: "What an agent receives is a contract",
    contractLead:
      "One selector over the whole eligible archive, and one contract per delivery. It names every unit it carries and every unit it does not, and it is written down — an offer with the hash of its content and of the exact text emitted, and the byte range of each unit inside it — before a byte leaves this machine.",
    contract: [
      { name: "items", body: "Every unit that travelled, whole: kind, revision, scope, authority, the text and its rationale, its conditions and exceptions. A unit is indivisible — a rule travels with its exceptions or it does not travel." },
      { name: "checks", body: "What the catalog could not resolve, as text, so the agent knows what remains to be verified before acting." },
      { name: "omissions · manifest", body: "What did not fit, by reason and count, readable whole by id. A required unit is never dropped to make room for an optional one; when the core alone does not fit, the contract says incomplete instead of pretending." },
      { name: "status", body: "ready, requires_check, conflict, incomplete or unavailable. Two active decisions from one family are withheld as a conflict rather than resolved by picking the newer one." },
    ],
    contractOrder:
      "The selector's order is the decision: eligibility first, then the core whole and unranked — the awake notes, the published criteria, the sleeping notes a touched path triggers —, then a lexical search over everything eligible, so a decision recorded behind 250 newer ones is found by its words, and only then the limits. Never the limits first.",

    roadsTitle: "Three roads, each with a measured limit",
    roads: [
      { name: "Session start", body: "A hook prints the contract into a new Claude Code context at startup, resume, clear and compaction. 6,500 code points and 24 KiB, counted on the message the program receives." },
      { name: "The edit", body: "A second hook delivers the sleeping notes pinned to the path an agent is about to touch, at the spot." },
      { name: "MCP", body: "panoma_context carries the same contract, and panoma_recall reads any unit whole by id and revision. 24 KiB." },
    ],
    roadsNote:
      "Limits are characters and bytes and are never called tokens. A compaction or a clear empties a context, and the next brief is a new contract under a new generation — a rule is never suppressed because a context that no longer exists once saw it.",

    receiptTitle: "The receipt",
    receiptBody:
      "An offer proves what the catalog prepared; it does not prove that anything arrived. With the capture switch on, a reader opens the agent's own transcript — read only, never modified — and looks for those exact bytes at the one site that seals a reception: the record the agent writes for the hook's output, in the session the offer was bound to. It writes what it found, unit by unit: full, partial, unknown or not observed. The same bytes in a prompt, a tool result or a README are never a reception, and on a program nobody has verified the answer is unknown, never full.",
    matrixBody:
      "The catalog keeps a capability matrix per program, filled from three separate pieces of evidence: a hook was installed, an invocation was observed, a receipt site was verified by a person reading the record. Verified today: Claude Code 2.1.258 from the desktop app. What is not verified is declared as such and never counted.",

    switchesTitle: "Reading your histories, under three switches",
    switchesLead:
      "Every agent history on this disk is a source, and nothing in it is opened until you allow that source by name. On top of that, three grants — each with a purpose, a scope of one project or all, and a boundary inside every file that the permission never rewinds past.",
    switches: [
      { title: "Capture", body: "At its first notice the reader takes only the receipts and the lifecycle records. At the second — an explicit re-consent — it also keeps typed facts of what the tools did, with coordinates and never a line of text: read, edit, command, test result, failure, commit." },
      { title: "Extraction", body: "Your own turns of the allowed range — redacted, bounded, never the assistant's words — go to the model you connected, with those facts, in a window frozen before it is paid for: after thirty quiet minutes, or 96 KiB pending, or four hours since the oldest. What comes back is a proposal with its quotes, waiting for your yes like everything else." },
      { title: "Twin learning", body: "The same turns, distilled in the background into observations about your taste. Told under Twin below." },
    ],
    switchesNote:
      "Every paid call is reserved in the ledger before it leaves, under the daily cap of its family, so two organs can never both spend the last call of the day. Switching a grant off fences the work in flight: an answer paid for under the old permission is never published.",

    checksTitle: "What the disk may say about a rule",
    checksLead:
      "A check has a purpose, a kind, a target and an expected value. Seven kinds — a path exists, a file hashes to this, a literal is present or absent, a manifest declares this script, this dependency, this structured key — and all of them are read, never run. The purpose decides what a failure does:",
    checks: [
      { name: "grounds", body: "The foundation the rule stands on. A note is challenged and stops being served; a decision or a criterion gets an incident and stays — a rule is never retired by a scanner." },
      { name: "applicability", body: "Where the unit applies. An observation, and nothing else: the selector leaves the unit out where it does not apply." },
      { name: "violation", body: "What a rule in force forbids. An incident; the rule stays exactly as it is." },
      { name: "completion", body: "The finishing line of a commitment. An observation while it is open — a fail never closes an obligation." },
    ],
    checksNote:
      "The patrol looks in the worker's free passes, two seconds per project and turn, and no hook ever waits for it. Each look is an observation with the exact state it saw — HEAD, dirty or clean, the hash of every file inspected — and unknown is never a fail: a file it cannot read challenges nothing. An observation goes stale after ten minutes and asks for another look; it never turns a rule on or off. An incident carries your verdict, confirmed or false positive, and never a judgement of obedience: whether the rule had reached the agent is answered yes only when a full receipt of that revision precedes the look in the same context.",

    commitmentsTitle: "Commitments, cases, and conditions in three values",
    commitmentsBody:
      "A commitment is an obligation with a version: a text, optional typed conditions, up to six completion criteria. Only two actors close it — you, or every criterion passing on the current revision, fresh, in one environment. An agent saying “done” is a report and closes nothing. A case is a projection of a task and never a row: what was asked, what was decided, what the agent declared and what the checks saw, in four separate columns, with unknown where nothing was recorded.",
    conditionsBody:
      "A decision, a criterion or a commitment may carry a typed predicate beside its narrative — all, any and not over six facts: the project, a path, the operation, the environment, the kind of task, the result of a check. True and it is served; false and it is left out whole; undecidable and it travels conditional, with one line per fact that would settle it. The sentences go inside the unit, “Applies when” and “Except when”, on every road and in the taste file alike.",

    capsTitle: "Small on purpose",
    capsLead:
      "Because a project's whole awake memory fits in front of the model, there is no retrieval step at all: no embeddings, no ranking, nothing that can pick the wrong memory. When it fills up, nothing is summarized away behind your back — you are told, and you decide what goes.",
    caps: [
      { value: "500", label: "characters in a single note" },
      { value: "2,000", label: "characters of awake memory, per project" },
      { value: "30", label: "sleeping notes, per project" },
      { value: "20", label: "proposals waiting for review" },
    ],
    quotaBody:
      "Above the character budgets sits a storage quota for everything the machine derives on its own — photographs, offers, typed facts, staged answers —: 256 MiB per catalog and 64 MiB per project out of the box, or PANOMA_MEMORY_QUOTA_MB and PANOMA_PROJECT_QUOTA_MB. A full quota pauses the machine and never the person: what you approve or write by hand is always taken, and nothing is deleted to make room.",

    forgettingTitle: "Forgetting that survives a backup",
    forgettingBody:
      "Two doors, one protocol. A withdrawal takes eligibility away and keeps the bytes; a purge blanks the copies as well — photographs, offers, a stream's locator — and keeps the coordinates, so the receipt can still say what was cleaned. Both preview first, with the counts they would reach and what would be retained, and confirm only through the door that previewed. Every operation is appended to a journal outside the database before its row exists: a copy restored from before a purge finds a journal it does not carry, and the memory goes into quarantine — every delivery answers unavailable until a person reconciles — instead of bringing the text back in silence.",

    scaleTitle: "It measures itself",
    scaleBody:
      "Every delivery is written down: which units travelled, to which agent, how heavy they were, and what the receipt found. With PANOMA_MEMORY_ABLATION set, half the visits get their memory and half have it held back — and the ledger records what would have been served, so both arms are twins. Then relaunches are counted on each side: relaunching is the gesture that gives a correction away. Off by default, agent channel only, and readable at /api/scale. It is the one memory that does not ask you to take its word for it.",

    doubleTitle: "Questions go to your double",
    doubleBody:
      "When an agent hits a question of taste rather than fact, panoma_ask leaves it for your double instead of interrupting you. Today the double is in training: it drafts what it would have answered, citing your beliefs, and you grade it. See Twin below.",

    refusesTitle: "What it refuses to do",
    refuses: [
      "No semantic search, no embeddings. The budget makes retrieval unnecessary, and every retrieval step that does not exist is one that cannot retrieve the wrong thing.",
      "No automatic compaction. Deciding what deserves to survive is exactly the decision this product keeps for you.",
      "No editing in place. A rewrite is a new revision that names the one it supersedes, so it passes your hands one more time and the old text stays photographed.",
      "No keys stored. Anything shaped like a credential is masked at the door of the journal, of notes, of questions and of the turns sent to a model — with a visible mark where it was.",
      "Nothing is run. A check reads a path, a hash, a literal, a manifest; it never executes a command, and what it cannot read is unknown, not a failure.",
      "Agents never decide. An agent key proposes and re-reads; approving, closing a commitment and judging an incident are gestures of the person.",
      "No verdict on obedience. A receipt says the bytes reached the context; an observation says what the disk looked like. Nothing in between is invented.",
    ],

    movingTitle: "Moving a folder does not kill it",
    movingBody:
      "Rename or move a project, rescan, and the curated memory follows: the catalog looks for the heir by identity — the repository's root commit, the same fingerprint your decisions survive on — and moves the notes, the commitments, the journal, the questions and the ledgers before retiring the old row.",

    turnOnTitle: "Turn it on",
    turnOnLead:
      "Open Bridge in the app: four setup steps, each carrying its state as a word beside its title, and the commands you do not need yet folded away. The hooks step has a button that installs them across the catalog, and each project page says whether its own are in place. The three switches sit on the Twin screen, one per source, each with the sentence that says what is read, from which byte and how to take it back. From the terminal:",
    turnOnSteps: [
      {
        command: 'panoma agent-key "Claude Code" --install',
        note: "Registers the agent and writes the config it reads. That is what brings the tools, the brief and the memory with it.",
      },
      {
        command: "panoma hooks --install",
        note: "The hooks: the brief at session start, the sleeping notes at the path they were left on, the record without the model having to remember, and the receipt pointer when the session ends.",
      },
      {
        command: "panoma memory allow claude-code capture --all --notice 2",
        note: "Lets the reader open that history for receipts and typed facts, on every project. extract sends your own turns to the model for one project with --project; twin lets the Twin learn on its own. revoke takes one back and says what stops with it.",
      },
      {
        command: "panoma memory status",
        note: "Offers, receipts, the reader's cursors and which programs are verified; --json for the whole document. withdraw and purge are the two doors above, previewed first and confirmed with --yes.",
      },
    ],
    turnOnNote:
      "Then restart the agent's session: one already open picks up nothing. What the distiller, the extractor and the double may spend in a day has a ceiling each, on the Spend screen or with PANOMA_DISTILL_BUDGET and PANOMA_ASK_BUDGET; 0 turns either of them off.",
  },
  twin: {
    kicker: "07",
    title: "Twin",
    lead: "A portrait of your taste, mined from what you already told your agents.",
    leadBody:
      "Not a questionnaire. What a portrait can be built on is what you rejected and what you let through — years of verdicts already sitting in your agent histories. Nothing is read without permission: the inventory measures those files with stat and does not open one until you allow that source by name.",

    pyramidTitle: "How it narrows",
    pyramidLead:
      "Each floor is an order of magnitude smaller than the one below, and that narrowing is the product. Numbers here are from the author's own catalog, for scale.",
    pyramid: [
      { step: "History on disk", detail: "what already existed, unopened" },
      { step: "2,648 verdicts", detail: "what you said when something was handed to you" },
      { step: "409 observations", detail: "what repeats, with its citations" },
      { step: "34 beliefs", detail: "what can actually be broken" },
      { step: "20 lines in TASTE.md", detail: "3,000 characters, a hard cap" },
      { step: "Every project's AGENTS.md", detail: "what all your agents read — Claude Code via the bridge" },
      { step: "One look from the critic", detail: "does this screen break one of them?" },
    ],

    floorsTitle: "Floors, not ceilings",
    floorsBody:
      "A belief is written so it can be broken: something a screen either respects or does not. Wishes make bad beliefs — an experiment proved it — so what gets mined is refusals and defaults. You sign the ones that are yours and veto the ones that are not, and only signed lines carry weight.",

    learnTitle: "It learns on its own, under a third switch",
    learnBody:
      "On top of capture, a third grant lets the worker distil your new turns into observations of the Twin in the background — one paid stage at a time inside the same daily cap: observations with the exact quote and its origin, a topic for those that had none, a synthesis of each topic whose inputs moved. A topic is re-synthesized only when the evidence behind it changed, so the cycle never feeds itself. Support is counted in cases — the origin of a quote, so one session copied into two windows is one case — and an inference publishes on its own only with three families of known origin behind it. A pasted document that may be the assistant's own words counts for nothing.",

    outboxTitle: "Learning and publishing are two acts",
    outboxBody:
      "What it infers waits in the Twin until you have said, once, that inferences may reach the taste file. Every write of that file goes through an outbox that compares the file before writing and reads it back after, so a line you deleted by hand is a veto and a line you rewrote is your signature on those words — and both are heard before any criterion is served to an agent again.",

    limitsTitle: "A criterion learns its limits",
    limitsBody:
      "A criterion can carry the conditions under which it applies and the exceptions under which it does not — the same typed predicate a decision or a commitment uses. The selector judges them in three values before serving it, and the sentences travel inside the rule, on every road and in the file alike: “Applies when the operation is edit. Except when the path is under apps/site.” One sentence for one tree, on the screen, in the brief and in the file.",

    criticsTitle: "Two critics, two different rulers",
    critics: [
      {
        title: "Mechanical",
        body: "Reads the folder and compares the project with itself: a colour used once next to one almost identical used forty times is not a decision, it is a typo. No model, no cost, no portrait needed — so it works on day one, and the watcher runs it after every commit.",
      },
      {
        title: "With eyes",
        body: "Hand it a screen and it names the rule of yours it breaks, with the next instruction already written. This one compares against your signed lines, so it needs a portrait — and it costs a model call, capped per day with half the day reserved for the automatic ones.",
      },
    ],

    doubleTitle: "The double, in shadow",
    doubleBody:
      "The pain this product exists for is the middle turn: judging, directing, repeating. The bet is that a portrait built from your real verdicts can answer part of what your agents would otherwise ask you. It runs in shadow first: an agent leaves its question, the double drafts what it would have said — only from your beliefs, citing them, or it abstains — and you grade the draft with two buttons. Coverage and fidelity come out of those grades, and the rule was written before any of it ran: without high fidelity on what it did not abstain from, the double never speaks.",

    reachTitle: "The number that measures outward",
    reachBody:
      "Two of Twin's marks measure it from the inside, and both can look fine in a catalog where nobody reads the portrait: the AGENTS.md block only exists where you asked for it. Reach says how many projects actually carry your lines, and says it in amber when that number is zero.",

    commandsTitle: "From the terminal",
    commands: [
      { command: "panoma twin sources", note: "Which agent histories are on this disk, and how big. Nothing is opened." },
      { command: "panoma twin allow <source>", note: "Permit reading one. Without it, not a file gets opened." },
      { command: "panoma twin mine --save", note: "Read the permitted ones and store what you said when something was handed to you." },
      { command: "panoma twin distill", note: "Pull observations about your taste out of those verdicts." },
      { command: "panoma twin synthesize", note: "Turn observations into beliefs. Ask for one topic by name to make a quiet one move." },
      { command: "panoma twin look <project>", note: "Show it a screen: it names the rule it breaks and writes the assignment." },
      { command: "panoma twin score", note: "How often you correct it — the only mark Twin gives itself." },
    ],
    commandsNote:
      "Everything here also has a screen: the terminal is where it gets tested, the browser is where it gets used. Budgets are counted in calls, not tokens — with a CLI provider there are no tokens to count, and a token budget would let exactly the runaway loop through. Reading your history and looking at a screen have a ceiling each, and both are moved on the Spend screen or with PANOMA_READ_BUDGET and PANOMA_LOOK_BUDGET.",
  },
  maintain: {
    kicker: "08",
    title: "Keep it working",
    lead: "A project that scanned clean in March may not build in August. These three commands go and find out, and the answer is written on the project card with a date.",
    commands: [
      {
        command: "panoma enrich",
        note: "Asks seven public registries which version is the latest, and OSV which versions carry advisories. Only a package name leaves this machine — no code, no paths, no project names. Answers are cached for 24 hours, and the watcher runs this by itself twice a day.",
      },
      {
        command: "panoma enrich --force",
        note: "Also re-checks what was checked less than 24 hours ago. Same work, cache ignored. Worth it after a registry outage, not on a schedule.",
      },
      {
        command: "panoma check <project>",
        note: "Does it still build? Installs and builds in a throwaway worktree, then stores the verdict: built on this date, or broken since that one. Your folder is untouched — no node_modules, no dist, no lockfile. With uncommitted changes it judges the last commit and says so. The build gets 10 minutes; the command waits 15. Without git, a known toolchain or a build script it answers exactly that instead of inventing a plausible command.",
      },
      {
        command: "panoma run <project> <package>",
        note: "Proposes an upgrade: edits the manifest, installs with dependency install scripts off, runs the tests, and leaves a branch with one commit and a patch to read. It never pushes and never touches your working tree. One run per project at a time, and it refuses to start on a dirty tree.",
      },
      {
        command: "panoma run <project> <package> --security",
        note: "Targets the version that closes the most severe advisory instead of the newest release. Drop the package name and it picks the target itself, from the project's own advisories. A version published in the last 3 days is normally held back; with this flag it warns and goes ahead, because a known hole beats a hypothetical one. PANOMA_CUARENTENA_DIAS moves that window.",
      },
    ],
    isolationTitle: "Three levels, strongest first",
    isolationLead:
      "Both commands run somebody else's code on your computer. The worktree isolates the changes, not the process: an install script still runs as your user, on your network, and does not care that it sits in a temporary checkout. So the process gets a scale of its own. Panoma picks the strongest level this machine can give, and writes down which one it used. Ask for one by name with --isolation.",
    isolation: [
      {
        level: "container",
        body: "Docker, Podman, nerdctl or finch, whichever answers first. The worktree is mounted and nothing else: the rest of your disk does not exist for the process. Capabilities dropped, no new privileges, read-only filesystem, memory and process caps. Tests and builds run with the network disconnected; the install does not, because it needs the registry. That asymmetry is real and it is stated rather than hidden.",
      },
      {
        level: "hardened",
        body: "Environment cut down to eleven names, anything shaped like a token or a password thrown away, and a throwaway HOME. On macOS your home folder is sealed as well, so ~/.ssh and your documents come back as permission errors. On Linux and Windows there is no system sandbox to call: hardened is a clean environment and little else, the code can still read your home folder by absolute path, and the run card records that promise as unmet. Changing HOME changes where the tilde points, not who you are.",
      },
      {
        level: "local",
        body: "A plain spawn in the worktree with your environment. It protects nothing beyond the changes. It exists for when the owner decides nothing more is needed, and the card stores the level so that a green here never reads like a green in a container.",
      },
    ],
    verifiedTitle: "What verified means",
    verifiedBody:
      "Verified means there were tests and they passed. It does not mean the change is correct. With no test command the proposal stays unverified, the summary says the project has no tests and that nobody has checked it still works, and the commit message writes it out. The placeholder test script npm init leaves behind counts as having no tests: running it and calling that verification would be worse than running nothing. When tests do pass outside a container, the card adds a line saying so — tests are code from the repository itself. And if the package being upgraded is one the project already lets run install scripts, the card says that in capitals: trusting a package is not the same as trusting every future version of it.",
  },
  models: {
    kicker: "09",
    title: "Pick a model",
    lead: "Most of this program is disk reads and arithmetic, and costs nothing. A few parts ask a model, and none of them answer until you say whose model it is.",
    freeTitle: "What never spends",
    freeBody:
      "panoma scan, panoma review, panoma twin design, panoma disk, panoma secrets and panoma search never call anything. No key, no account, no network. They work on the first day and they work offline. What does spend is named where it appears: panoma describe, panoma md review, panoma twin distill, panoma twin look, and panoma handoff only with --digest model.",
    commands: [
      {
        command: "panoma ai",
        note: "What is active: the provider, the model, where its credential came from, and the path of the file holding it. Then the whole catalog — 17 providers that take a key, nine command-line agents, and the one that signs in through a browser. Each agent reads as installed, present but not starting, or absent: three states, and only one of them is fixed by installing.",
      },
      {
        command: "panoma ai use <provider>",
        note: "Pick one by id. If it is a command-line agent you already have signed in — claude, codex, gemini — that is the whole setup, and no credential ever reaches panoma: the prompt goes in on standard input and the subscription stays with its own tool. Slower, seconds and not milliseconds, and it reports no token counts. --model pins which model to ask for. Switching provider drops the previous pin, because a model name from one vendor is a 404 at the next. The credential is checked right there instead of failing at your first real call.",
      },
      {
        command: "panoma ai key <provider>",
        note: "Store an API key, for the providers that take one. It is read from standard input and never accepted as an argument: an argument outlives the command in your shell history and in the process list, where any other user of this machine can read it. Nothing is echoed while you type, so it stays out of the scrollback too.",
      },
      {
        command: "panoma ai ask <question>",
        note: "One question, to prove the wiring. Under the answer: provider, model, seconds, and token counts when the provider publishes any. --provider aims this one question somewhere else without changing what is active. Nothing is stored and no cap covers it.",
      },
    ],
    keyTitle: "The key is not encrypted",
    keyBody:
      "A stored key goes to ~/.panoma/ai.json, written at mode 0600. That is the floor, not protection: the file is plain text, and any process running as you can read it whole. There is no keychain and no passphrase yet. If that is not good enough, export the key in your environment and store nothing — the environment is read first and wins over the file. What comes back on screen is always masked, three characters and the last four, which is enough to tell which of your keys is in there. Reach a model through a command-line agent instead and there is no key to keep at all. One key in that file is not a model's: an app that narrates needs an ElevenLabs key, and it is typed on that app's own page in Apps rather than here. It lands in the same ~/.panoma/ai.json at the same 0600, under its own name, and only the operator of this machine may write it or ask whether it is there. It is deliberately not a provider you can pick under Models, so nothing you set here reaches it — and switching voice on is a separate change that asks you to confirm.",
    capsTitle: "Nine daily caps",
    capsLead:
      "Each organ that spends has its own ceiling for the day, and the day is this machine's own day, not a sliding window. The Spend screen moves any of them without restarting anything, and says which ceiling an exported variable is deciding — the variable always wins over the screen, so an install behaves the same on a laptop and in CI.",
    caps: [
      {
        name: "PANOMA_READ_BUDGET",
        value: "300",
        what: "Rereading your agent history: distill, sort by subject, synthesize. One cap for the three, because they are one chained job.",
      },
      {
        name: "PANOMA_LOOK_BUDGET",
        value: "20",
        what: "The critic looking at a screen. Half of that, rounded down, is all the watcher may spend on shots that appeared by themselves; the other half waits for you.",
      },
      {
        name: "PANOMA_DISTILL_BUDGET",
        value: "12",
        what: "The distiller rereading a closed agent session and proposing what is worth keeping.",
      },
      {
        name: "PANOMA_ASK_BUDGET",
        value: "20",
        what: "The double, drafting what you would have answered an agent.",
      },
      {
        name: "PANOMA_REHEARSE_BUDGET",
        value: "20",
        what: "The Decision Lab, rehearsing a decision of yours against your beliefs. Apart from the double's cap because one morning of rehearsals once left every question of the day undrafted.",
      },
      {
        name: "PANOMA_EPISODE_BUDGET",
        value: "20",
        what: "Turning captured history into decisions with their evidence, at most two calls per press.",
      },
      {
        name: "PANOMA_CARD_BUDGET",
        value: "100",
        what: "The project card: the summary of what a project is, and the opinion on its instruction file. Neither pays again while the material has not changed.",
      },
      {
        name: "PANOMA_APP_BUDGET",
        value: "20",
        what: "What an installed app may spend in a day: the model calls and the narration requests it makes on your behalf. Capacity is held before the work is queued and checked again before it runs, so a ceiling you lower mid-job is obeyed.",
      },
      {
        name: "PANOMA_HANDOFF_BUDGET",
        value: "10",
        what: "The model-written digest of a conversation being handed off. Asked for only by a person — the box on the screen, or --digest model in the terminal — and never through MCP, where an agent gets the mechanical digest. It is the one call that sends a whole transcript, redacted and wrapped, to a provider, in windows of 60,000 characters counted against the cap before the first one, which is why the cap is the smallest of the nine; the box starts ticked only when the source carries no summary Panoma can read and the chain fits the day, and off when the source's own summary already travels inside the digest.",
      },
    ],
    capsNote:
      "Calls, not tokens. A command-line agent returns loose text and no usage at all, so a token cap would count a thousand runaway calls as zero and let through exactly the case that runs away easiest. Tokens are still recorded and shown, because they are the price; what gets stopped is how often. Spent means 429 for the six somebody asked for, with both numbers in the message, and 409 for an app job that is refused before it is queued. The distiller and the double run in the background with nobody to answer, so they go quiet and pick it up tomorrow. Set one to 0 to switch that organ off; anything unreadable falls back to the default and never to no limit. The Spend screen adds one switch the variables do not have: a pause that reads every ceiling as zero until you lift it.",
  },
  network: {
    kicker: "10",
    title: "Network",
    lead: "The catalog does real work on this machine: opens folders, installs, runs tests, reads what git tracks. Binding to the loopback is what keeps that private.",
    localTitle: "This machine",
    localBody: "Without --network the process binds 127.0.0.1, and nothing needs a key: whoever can reach the port is already inside the machine. That is the default.",
    openTitle: "Your local network",
    openBody: "Exposing the catalog needs an address and a credential, together. --network does both or it does neither: bind 0.0.0.0, write ~/.panoma/access.json at 0600, and print two links that carry the keys. Open one once and that browser stays in — the server stores the key in an HttpOnly cookie and strips it from the URL.",
    twoKeysTitle: "Two keys: looking and running",
    twoKeysBody: "The network link carries the key that opens the catalog. The “this machine” link carries a second one that authorizes anything running here — installs, builds, opening an editor. That second key never leaves this computer: it lives in the 0600 file and in the line your own terminal printed. So a leaked phone link shows the catalog, which is what you accepted when you opened the port, and cannot put this machine to work.",
    openCommand: "panoma up --network",
    closeTitle: "Close it",
    closeBody: "Stop, then start again without the flag.",
    closeCommand: "panoma down && panoma up",
    rotateTitle: "Rotate the key",
    rotateBody: "The previous key stops working at once. Cookies that carried it die: they are compared to the live key, not to a list.",
    rotateCommand: "panoma up --network --rotate-key",
    rulesTitle: "How the door works",
    rules: [
      "With the port closed, nothing needs a key. That is the default, and it is this machine.",
      "With the port open, everyone needs the key — this machine included, because from the network anyone can claim to be it.",
      "It arrives four ways and any of them works: ?key= on first open, the cookie, x-panoma-key, or Authorization: Bearer for scripts.",
      "An open port with no PANOMA_ACCESS_KEY serves nobody at all: 503. The unsafe path does not exist.",
      "This is not HTTPS. Traffic on wifi is in the clear. A tailscale hop is a different tool.",
    ],
    home: "State lives in ~/.panoma. The default catalog address is http://localhost:4173. Use --api or PANOMA_API to point elsewhere. The CLI speaks English.",
  },
  commands: {
    kicker: "11",
    title: "All commands",
    lead: "Twenty-two verbs are written out here. Three more exist and are not: panoma apps, panoma video and panoma memory, which belong to the optional apps and are listed by panoma --help. Flags match panoma --help, and a flag it does not recognise is an error rather than a warning: a mistyped one is a different command that succeeds.",
    extrasTitle: "Before any verb",
    extras: [
      {
        command: "panoma",
        note: "No verb at all: the day's report, what moved since you last looked. With the catalog down it says how to start it and then shows the help, and still exits 0 — not knowing yet is not a failure.",
      },
      {
        command: "panoma --help",
        note: "The whole list. It wins over everything, including an argument that does not parse.",
      },
      {
        command: "panoma --version",
        note: "The number on its own, like node and npm. The short form is -V, because -v was already --verbose.",
      },
      {
        command: "panoma --api http://localhost:4173",
        note: "Point at a catalog somewhere else. PANOMA_API does the same without typing it each time. Only the network key travels to a remote catalog; the key that authorizes running things stays on this machine.",
      },
      {
        command: "PANOMA_DEBUG=1 panoma up",
        note: "Errors print their message, not twenty lines of stack; this puts the stack back. PANOMA_NO_UPDATE_CHECK=1 turns off the once-a-day question to the npm registry, which is asked by whichever half you are using: the terminal when you type a command, and the catalog while it is left running.",
      },
    ],
    exitTitle: "Exit codes",
    exitLead: "Four of these are not what a script would guess, and guessing wrong means either passing a broken build or failing a clean one.",
    exits: [
      {
        code: "secrets · review · md check",
        when: "1 when there are findings, 0 when there are none. Linter convention, so all three can gate a commit hook or a pipeline: they report facts, and a fact can break a build without anyone feeling judged. With no instruction file at all, md check exits 0 — the 1 is reserved for claims that are false, and a pipeline needs to tell a lie apart from an absence.",
      },
      {
        code: "check",
        when: "0 on ok, and also on no-build. A project that declares no build script, or an ecosystem whose build needs a target nobody here should pick, has no build to break; answering 1 would turn every Python project in the catalog into an alarm. failed, no-git and no-toolchain exit 1, because all three describe something you can fix in the folder.",
      },
      {
        code: "up",
        when: "1 when something was already answering on the port with a version other than the one installed. After an upgrade the process holding the port is still the old one, with the new files underneath it; saying “already running” and going quiet would hide that from the one person who needs to know. Same version, and it exits 0.",
      },
      {
        code: "signal",
        when: "0, always. It is the PreToolUse hook, not something anyone types, and it is deliberately left out of --help. Catalog down, unreadable event, path outside the project, timeout, full disk: all of it ends in empty output and a 0, because blocking an edit is forbidden by contract, not merely avoided.",
      },
    ],
  },
  reference: {
    kicker: "12",
    title: "Reference",
    lead: "Where the state lives, which knobs are worth touching, and what to do when something is broken. None of this is needed for normal use.",
    filesTitle: "Inside ~/.panoma",
    filesLead: "Everything Panoma writes outside your projects lives here, it all moves together with PANOMA_HOME, and panoma disk counts it.",
    files: [
      {
        path: "db/",
        note: "The catalog: a PGlite data directory, which is PostgreSQL 18 compiled to WASM. One process writes it, the web app. Does not regenerate — the journal, the curated memory, the tasks and the mined verdicts exist nowhere else. A rescan rebuilds only what can be read off the disk.",
      },
      {
        path: "ai.json",
        note: "Active provider, model, API keys and OAuth tokens. 0600, written atomically. Does not regenerate. If it cannot be parsed it says so and stops, instead of reporting no configuration and writing a fresh one over your keys.",
      },
      {
        path: "spend.json",
        note: "The caps, the rates, the currency and the pause: everything the Spend screen writes. Does not regenerate, and the factory ceilings come back with it.",
      },
      {
        path: "twin.json",
        note: "Which agent histories Twin is allowed to read. Two-space JSON with the identifiers untranslated, so it reads with cat and revokes with rm. Does not regenerate, and that is the point: silence is not a yes.",
      },
      {
        path: "TASTE.md",
        note: "The portrait that goes down to your agents, capped at 3,000 characters. Plain text, and it is the input, not a report: delete a line and that belief is vetoed. Rewritten every time you save from the Twin screen.",
      },
      {
        path: "access.json",
        note: "The network key and the operator key, with their date. 0600. Regenerates: it is created the first time a key is needed, and an operator key missing from an older file is filled in rather than treated as damage.",
      },
      {
        path: "roots.json",
        note: "The folders you declared for the watcher to look at. Does not regenerate: nothing else knows where you wanted it to look.",
      },
      {
        path: "logs/web.log",
        note: "Everything the server printed, appended. When it does not come up, the reason is here. Regenerates, and it is never rotated: it grows, and shortening it means deleting it.",
      },
      {
        path: "watcher.jsonl",
        note: "One line per watcher event. The panel keeps the last 20; this keeps all of them. A half-written line from a power cut is skipped without losing the rest. Regenerates, also unrotated.",
      },
      {
        path: "web.json",
        note: "The stamp of the live server: which panoma up started it, with what pid, what version, against what address, and with which node interpreter. That node is what gets written into an agent's MCP config. Written by up, removed by down.",
      },
      {
        path: "web.pid",
        note: "The server's pid, kept apart from the stamp so that a file an older version may have written never changes shape. Regenerates.",
      },
      {
        path: "db.lease.d/",
        note: "One <pid>.json per process holding the database open. It is the guard against a second writer that works on all three systems, where lsof does not. Regenerates: notes from dead pids are ignored and swept by the next writer.",
      },
      {
        path: "ai.json.anterior",
        note: "The previous ai.json, kept only when the old one could be read whole. It is what the corrupt-config message points you at. Rewritten on every save.",
      },
      {
        path: "version.json",
        note: "When npm was last asked about a newer release, and what it answered. The visit is recorded even when the question fails, so a machine with no network does not ask on every run. Regenerates.",
      },
      {
        path: "visit.json",
        note: "Where the day's report starts counting from: the window, the last visit, and when that window opened. Regenerates.",
      },
      {
        path: "signal-seen.json",
        note: "Which sleeping notes were already handed to which session, so the same signal is not injected on every edit under its zone. Up to 20 sessions. Regenerates.",
      },
      {
        path: "assignments/",
        note: "The brief handed to an agent and the launcher that opens it. 0700 directory, 0600 brief, 0700 script. Outside the project because it is not that project's code. Regenerates.",
      },
      {
        path: "open/",
        note: "One script per provider for opening an agent in a terminal, with the extension each system knows how to run. 0700. Regenerates.",
      },
      {
        path: "work/",
        note: "Worktrees of runs, and only when the run happens in a container; everywhere else they go to the system temp directory. Regenerates, and each worktree is destroyed when its run ends, pass or fail.",
      },
      {
        path: "apps/",
        note: "One directory per installed app: its versions, its browser cache and its logs. What an app produced sits beside it, under video/. Reinstalling regenerates the app; it does not regenerate the work.",
      },
      {
        path: "on-boot.cmd",
        note: "Windows only: the wrapper the logon task runs, with the PATH of the day it was installed inside it. Written by panoma up --on-boot, removed when the task is deleted. Does not regenerate.",
      },
    ],
    envTitle: "Environment variables",
    envLead: "None is required, and none is checked at startup: a value the code cannot read falls back to the default in silence, which is right for a brake and misleading for whoever typed it.",
    env: [
      {
        name: "PANOMA_HOME",
        note: "Where all of the above lives. Default ~/.panoma. An empty value counts as unset; a relative path is anchored to the process directory, which gives you one catalog per place you launch from. It moves the whole set and never one piece: half a catalog here and half there fails weeks later, when something reads what it should not.",
      },
      {
        name: "PANOMA_API",
        note: "The address the CLI and the MCP server talk to. Default http://localhost:4173. The --api flag does the same for a single command.",
      },
      {
        name: "PANOMA_KEY",
        note: "The agent key the MCP server sends. Written for you by panoma agent-key --install. Treat it as a credential: it has no per-project scope, and it reads the brief, the journal and the tasks of the whole catalog. It can also list and hand off the conversations kept for a project — those two calls are scoped to the project the call names, the way panoma_context is, answer this machine only, and pass the operator's door before the key is even read.",
      },
      {
        name: "PANOMA_ACCESS_KEY",
        note: "The network key, set for you by panoma up --network. While it is set, every caller needs it, this machine included. With the port open and no key set, the answer is 503 to everyone: the unsafe path does not exist.",
      },
      {
        name: "PANOMA_WATCH",
        note: "Only the exact value 0 stops the watcher. Then the app says it is off instead of serving a catalog that quietly stopped tracking anything.",
      },
      {
        name: "PANOMA_READ_BUDGET",
        note: "The daily brakes, with PANOMA_LOOK_BUDGET, PANOMA_DISTILL_BUDGET, PANOMA_ASK_BUDGET, PANOMA_REHEARSE_BUDGET, PANOMA_EPISODE_BUDGET, PANOMA_CARD_BUDGET, PANOMA_APP_BUDGET and PANOMA_HANDOFF_BUDGET. They count calls, not tokens: with a session agent as the provider there are no tokens to count. Unreadable falls back to the default, never to unlimited; 0 is legitimate and turns that organ off. Exporting one takes that ceiling away from the Spend screen, which then says so instead of showing a number nobody is applying.",
      },
      {
        name: "PANOMA_EDITOR",
        note: "Reorders the editors tried when opening a project. The word is never executed: anything outside the known list is ignored, so an invented value cannot become a command.",
      },
      {
        name: "PANOMA_NO_UPDATE_CHECK",
        note: "Only the exact value 1 stops the once-a-day question to npm about a newer release.",
      },
      {
        name: "PANOMA_DEBUG",
        note: "Any non-empty value prints the full stack trace when the CLI fails. Without it you get the message alone, because twenty lines of stack bury the sentence that says what to do.",
      },
    ],
    troubleTitle: "When something breaks",
    trouble: [
      {
        title: "The port is taken",
        body: "Something else holds 4173, and startup stops there rather than half-working. Stop that something, or put this one elsewhere: panoma up --api http://localhost:4174. Whatever address you start on is the address your CLI and your agents have to be told about, through --api or PANOMA_API.",
      },
      {
        title: "A different Panoma is already up",
        body: "Two shapes, and they read alike. Either the catalog was already running on that address and there is nothing to do, or the process that is running is an older version than the one you just installed. Installing does not replace a live process. Restart it: panoma down && panoma up.",
      },
      {
        title: "The catalog will not open",
        body: "The app still serves, with no data, and a strip on the page says so. Two different failures hide behind that line. A data directory written by an older PostgreSQL (16, while this one uses 18) is refused before anything starts, and that is not damage: the rows are intact, the format changed between major versions, and ops/migrate-pglite5.mjs converts it. A broken write-ahead log is real corruption, and PostgreSQL's own tools recover it, on a copy, counting rows before anything goes back. Either way: delete nothing. If you need a working catalog today, rename ~/.panoma/db aside and start again; a fresh one is created and panoma scan fills what can be read off the disk. The journal, the curated memory and the verdicts are only in the directory you were about to delete. What the server printed while it failed is in ~/.panoma/logs/web.log.",
      },
      {
        title: "Something else already has the database open",
        body: "PGlite takes one writer and does not lock its own data directory, so two servers over one catalog open happily and corrupt it. Startup refuses when the stamp, lsof, or a lease note says another process is in there. Stop that one, or give this one its own PANOMA_HOME. Notes left by dead processes are ignored and swept; the one blocking you belongs to something still alive.",
      },
      {
        title: "Two catalogs at once, on purpose",
        body: "PANOMA_HOME is how, and it moves everything together: catalog, keys, portrait, logs. Give the second one its own home and its own address with --api, or the two of them will meet on the same data directory. A second development server from a clone also needs PANOMA_DIST, because two Next builds cannot share an output directory either.",
      },
      {
        title: "Nothing updates itself any more",
        body: "New projects and today's commits stop appearing. The watcher is not running, and the app prints that rather than looking healthy: it was turned off with PANOMA_WATCH=0, or the catalog underneath it did not open. Until it is back, scanning by hand is what keeps the catalog current, and the versions and advisories it refreshes on its own every 12 hours have to be asked for with panoma enrich.",
      },
      {
        title: "The Apps screen, and what panoma video needs before it films",
        body: "Apps is where an optional app is installed, and one is listed: panoma video, which adds a production screen to every project and a Create video button to the project header — press that button before installing and a dialog sends you here. Its page is numbered, and the sentence under the title is the next step: install the package from npm, then check its two requirements — a browser of its own, downloaded from that page after you read its size and Google's terms, apart from any browser on the system; and FFmpeg, which the catalog detects on your PATH and never installs — and then create. The key that app needs is typed on its own page rather than under Models. A production says what it will use before the button that starts it — the app's version, the two requirements, the model, whether narration has a key — and while it runs the twelve stages are listed with the one in progress; when it ends without a preview, the same list stays as the report, stage by stage in the app's own words. An agent connected through MCP can ask for a production too, with panoma_video, and it spends only what you switched on.",
      },
    ],
    privacyTitle: "What leaves this machine",
    privacyBody: "No telemetry. Nothing is reported about how you use this, there is no account it could be reported to, and the analyzer does not touch the network at all — that one is tested, by running it with http, https, dns, net and fetch sabotaged. Three things go out on their own, and you can name all three. Model calls, to the provider you configured, and only when you ask for one: describe a project, panoma md review, distill, the critic with eyes, and the handoff digest when you tick the box or pass --digest model — that last one carries a whole conversation, redacted, and only a person can ask for it, never an agent through MCP. Then panoma enrich, which asks the public registries — npm, PyPI, crates.io, RubyGems, Packagist, the Go proxy — and OSV for advisories, sending package names and versions and nothing else. And once a day the npm registry is asked whether there is a newer release: by the terminal when you type a command, and by the catalog on its own while it is left running, because a server up for weeks would otherwise never find out. It is one question a day between the two, it carries the name of a public package and nothing else, and PANOMA_NO_UPDATE_CHECK=1 stops it. A fourth exists only if you put it there: an optional app is the one thing that can add a destination, and it names that destination before you switch it on. Panoma Video asks npm for its own releases, downloads its recording browser when you press the button that says so, and sends narration text to ElevenLabs once you turn voice on. Nothing on that list moves until you confirm it. One warning about the first of the three: an image travels whole, so anything written in a screenshot goes with it.",
  },
} as const;

export const DOCS_SWARM = {
  stayFormed: true,
  order: [0],
  word: "docs",
} as const;
