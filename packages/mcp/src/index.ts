#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CatalogClient, CatalogError, checkConversationId, describeLocation } from "./client";
import {
  formatApps,
  formatContext,
  formatConversations,
  formatHandoff,
  formatHandoffFault,
  formatJournalEntry,
  formatRecall,
  formatTasks,
  formatVideoFault,
  formatVideoJob,
  formatVideoJobs,
  formatVideoStart,
  type AgentApp,
  type Context,
  type ConversationsAnswer,
  type HandoffAnswer,
  type RecallEntry,
  type VideoJobAnswer,
  type VideoJobsAnswer,
  type VideoStartAnswer,
} from "./format";

/**
 * Server MCP of Panoma.
 *
 * The descriptions of the tools are the real interface of this program: it is the only thing the
 * agent reads to decide when to call them. They are written for that purpose, not as documentation
 * of a API.
 *
 * **They go in English, and everything that comes out of here as well.** Whoever reads is a model
 * that starts without a session and without anyone to ask which language they prefer; the
 * terminal's language does not reach here, and the website's cookie neither. The rule is the same
 * as that of CLI since 25-Aug-2026: where the reader is a machine, a single language. See
 * `AGENT_LANGUAGE`.
 */

const api = process.env["PANOMA_API"] ?? "http://localhost:4173";
const client = new CatalogClient(api, process.env["PANOMA_KEY"]);

const server = new McpServer({ name: "panoma", version: "0.1.0" });

/** Wrap a handler so that failures reach the agent as actionable text. */
function tool(handler: () => Promise<string>) {
  return async () => {
    try {
      return { content: [{ type: "text" as const, text: await handler() }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: (error as Error).message }],
        isError: true,
      };
    }
  };
}

const location = {
  path: z
    .string()
    .optional()
    .describe("Project path. Defaults to the current working directory."),
};

server.registerTool(
  "panoma_context",
  {
    title: "Project brief",
    description:
      "The brief for this project: what changed since yesterday and which agent changed it, " +
      "which proposals are parked waiting on a human decision, which tasks are yours to pick " +
      "up, the decisions the owner recorded here with their reasons and exceptions, and what " +
      "it is built with — stack, outdated dependencies, known vulnerabilities, and " +
      "what other AI agents did here before you. Call it when you start working, before you go " +
      "exploring files, and again every day you come back: half of what it carries changes from " +
      "one night to the next. If the project is not in the catalog, it analyses it and enrols " +
      "it on the spot, so it works the first time too. Before editing, pass files with the " +
      "project-relative paths you plan to touch: this also returns their approved local rules " +
      "in every connected client. Before starting a job, or when you are stuck on an error, " +
      "pass task — one sentence saying what you are about to do or what you are looking at — " +
      "and the rules and owner decisions whose words overlap it come back with the matched " +
      "words as the reason.",
    inputSchema: {
      ...location,
      files: z.array(z.string().min(1).max(2048)).max(30).optional()
        .describe("Files to check for applicable project memory, relative to the project root. At most 30."),
      task: z.string().min(1).max(1000).optional()
        .describe(
          "What you are about to do, or the error you are looking at, in one sentence. Returns the " +
          "approved rules and owner decisions whose words overlap it, with the matched words as the " +
          "reason. Pair it with files.",
        ),
    },
  },
  async ({ path, files, task }) =>
    tool(async () => {
      const where = await describeLocation(path);
      const context = await client.post<Context & { projectId: string }>(
        "/api/agent/context",
        { ...where, ...(files !== undefined ? { files } : {}), ...(task !== undefined ? { task } : {}) },
      );
      return formatContext(context);
    })(),
);

server.registerTool(
  "panoma_log",
  {
    title: "Log work",
    description:
      "Record in panoma what you just did in this project. Call it when you finish a change " +
      "that stands on its own, make a design decision worth remembering, or hit something that " +
      "blocks you. Do not call it for every single edit: the log is for what the next agent (or " +
      "the owner) will need to know three months from now. It is also what fills the “since " +
      "yesterday” section of panoma_context: without it, tomorrow only the commits show, and " +
      "whoever comes through will not know why they are the way they are.",
    inputSchema: {
      ...location,
      summary: z.string().describe("One clear sentence about what you did."),
      kind: z
        .enum(["change", "decision", "note", "blocker"])
        .optional()
        .describe("Entry type. Defaults to 'change'."),
      details: z.string().optional().describe("Extra context: the why, the alternatives."),
      filesTouched: z.array(z.string()).optional().describe("Files you changed."),
      closeSession: z
        .boolean()
        .optional()
        .describe("true if this is the last thing you do in this project for now."),
    },
  },
  async ({ path, ...body }) =>
    tool(async () => {
      const where = await describeLocation(path);
      const result = await client.post<{ project: string }>("/api/agent/log", {
        ...where,
        ...body,
      });
      return `Logged in ${result.project}.`;
    })(),
);

server.registerTool(
  "panoma_remember",
  {
    title: "Propose a durable fact",
    /*
      The pair of panoma_log, and the description exists so that the model can choose well between
      the two: the log is what HAPPENED (it grows, it is archived); the memory is what REMAINS
      TRUE (it heals, it stays small). And it says "propose" and not "save" on purpose — the note
      doesn’t go to anyone until the person approves it, and a model to which immediate
      persistence is promised would consider it done.
     */
    description:
      "Propose a durable fact about this project for its curated memory: something that will " +
      "still be true next month and that every agent should know before acting — “tests need a " +
      "build first on a cold tree”, “the server on 4173 is a production build”. One or two " +
      "sentences, 500 characters at most. The owner reviews it before it reaches anyone: " +
      "panoma_context serves only approved notes, under a shared budget. For what you *did*, " +
      "use panoma_log instead — the journal records events; memory keeps rules. If the fact " +
      "belongs to one PLACE — a file or directory — add `where`: the note then sleeps outside " +
      "the budget. Retrieve its rule before editing with panoma_context and the files input.",
    inputSchema: {
      ...location,
      note: z.string().describe("The durable fact, in one or two sentences."),
      where: z
        .string()
        .optional()
        .describe("Optional place: an exact relative path ('docs/memory.md') or a zone ('apps/web/**')."),
    },
  },
  async ({ path, note, where: notePlace }) =>
    tool(async () => {
      const where = await describeLocation(path);
      const result = await client.post<{ proposed: boolean; pending?: number; reason?: string }>(
        "/api/agent/notes",
        { ...where, note, ...(notePlace !== undefined ? { where: notePlace } : {}) },
      );
      if (!result.proposed) return `Not proposed: ${result.reason ?? "the catalog refused it"}`;
      return (
        `Proposed. The owner decides in the project's screen; nothing is served until approved. ` +
        `Proposals now waiting: ${result.pending ?? 1}.`
      );
    })(),
);

server.registerTool(
  "panoma_recall",
  {
    title: "Search the project's journal",
    /*
      The other half of the pair that closes the memory: panoma_remember writes on the hot one and
      this one reads the cold one. The description separates the three possible readings —the
      report (window), the memory (rules), and the archive (history)— because a model with three
      sources and no map asks the one that is not.
     */
    description:
      "Search this project's full journal — everything any agent ever logged here, not just " +
      "the recent window panoma_context shows. Use it for history: “how was the broken catalog " +
      "fixed”, “did anyone already try upgrading X”. Words or a \"quoted phrase\"; matches only " +
      "what was logged, in the language it was logged in. Results include matched excerpts and " +
      "entry IDs. Pass entryId to read a complete original in bounded segments; continue with " +
      "its nextOffset. Continue a search with its nextCursor and the same query. For durable " +
      "rules use panoma_context, with files for rules attached to specific paths.",
    inputSchema: {
      ...location,
      query: z.string().min(1).max(1000).optional().describe("Search words or a quoted phrase. Omit when opening an entryId."),
      cursor: z.string().max(4096).optional().describe("The nextCursor of a search, copied verbatim with the same query."),
      entryId: z.string().max(128).optional().describe("An ID returned by this project's journal search. Opens the original."),
      offset: z.number().int().nonnegative().optional().describe("The nextOffset returned by an original entry read."),
    },
  },
  async ({ path, query, cursor, entryId, offset }) =>
    tool(async () => {
      const where = await describeLocation(path);
      const result = await client.post<{
        project: string;
        query: string;
        matches: Parameters<typeof formatRecall>[1];
        nextCursor?: string | null;
        entry?: RecallEntry;
      }>("/api/agent/journal", { ...where, query, cursor, entryId, offset });
      return result.entry ? formatJournalEntry(result.entry) : formatRecall(result.query, result.matches, result.nextCursor);
    })(),
);

server.registerTool(
  "panoma_ask",
  {
    title: "Ask the owner's double",
    /*
      The promise is written in the future on purpose: in the shadows the agent receives no
      response from the double, and promising it would be lying to the model about what the tool
      does today. What is already true: asking here costs one turn less than interrupting, and
      trains the double that will one day answer instantly.
     */
    description:
      "Before interrupting the owner with a criterion question — “modal or inline?”, “does " +
      "this copy go bilingual?” — leave it here. The owner's double (a model of their taste, " +
      "mined from their real verdicts) is in shadow training: it drafts what it would have " +
      "answered, the owner grades it, and once proven it will answer questions like yours " +
      "instantly. For now you still ask the owner directly; this call makes that question " +
      "count. One question, 300 characters at most.",
    inputSchema: {
      ...location,
      question: z.string().describe("One criterion question, plainly stated."),
    },
  },
  async ({ path, question }) =>
    tool(async () => {
      const where = await describeLocation(path);
      const result = await client.post<{ recorded: boolean; mode?: string; pending?: number; reason?: string }>(
        "/api/agent/consult",
        { ...where, question },
      );
      if (!result.recorded) return `Not recorded: ${result.reason ?? "the catalog refused it"}`;
      return (
        "Recorded. The double is in shadow training, so ask the owner directly this time — " +
        "your question is now part of the double's exam. " +
        `Questions awaiting the owner's review: ${result.pending ?? 1}.`
      );
    })(),
);

server.registerTool(
  "panoma_tasks",
  {
    title: "Project tasks",
    /*
      It promised the closed ones and the route never sends them: `/api/agent/tasks` filters by
      open and in progress, and it does so on purpose — a discarded one is the person saying no,
      and a done one is history the agent doesn't need to start working —. So the agent who called
      looking for 'how that ended' got a list with nothing and without being able to distinguish
      'there is none' from 'not served'. The description matches what exists.
     */
    description:
      "Lists the project's pending tasks — open and in progress — with who has claimed each " +
      "one and the full body of every note. panoma_context already carries a summary; use this " +
      "when the brief warned you there were more than fitted, or when you need the whole text " +
      "of one.",
    inputSchema: location,
  },
  async ({ path }) =>
    tool(async () => {
      const where = await describeLocation(path);
      const result = await client.post<{
        project: string;
        tasks: Parameters<typeof formatTasks>[0];
      }>("/api/agent/tasks", where);
      return `Tasks in ${result.project}:\n${formatTasks(result.tasks)}`;
    })(),
);

server.registerTool(
  "panoma_create_task",
  {
    title: "Create task",
    description:
      "Note down something that needs doing but falls outside what you are doing right now: " +
      "technical debt, a dependency worth updating, a missing test. It lands in the project's " +
      "queue for whoever picks it up next, human or agent.",
    inputSchema: {
      ...location,
      title: z.string().describe("What needs doing, in one line."),
      description: z.string().optional().describe("Detail and enough context to act on."),
    },
  },
  async ({ path, title, description }) =>
    tool(async () => {
      const where = await describeLocation(path);
      const result = await client.post<{ id: string }>("/api/agent/tasks", {
        ...where,
        title,
        description,
      });
      return `Task created (id: ${result.id}).`;
    })(),
);

server.registerTool(
  "panoma_claim_task",
  {
    title: "Claim a task",
    description:
      "Marks a task as yours before you start it, so another agent does not work on the same " +
      "thing. It can legitimately fail if someone got there first: pick another one in that case.",
    inputSchema: { taskId: z.string().describe("Task id, exactly as panoma_tasks gives it.") },
  },
  async ({ taskId }) =>
    tool(async () => {
      const result = await client.task<{ claimed: boolean; reason?: string }>(taskId, {
        action: "claim",
      });
      return result.claimed ? "Task assigned to you." : `Could not claim it: ${result.reason}`;
    })(),
);

server.registerTool(
  "panoma_complete_task",
  {
    title: "Close a task",
    description: "Marks a task as done and briefly explains how you resolved it.",
    inputSchema: {
      taskId: z.string().describe("Task id."),
      result: z.string().optional().describe("How it was resolved."),
    },
  },
  async ({ taskId, result }) =>
    tool(async () => {
      const response = await client.task<{ completed: boolean; reason?: string }>(taskId, {
        action: "complete",
        result,
      });
      return response.completed ? "Task closed." : `Could not close it: ${response.reason}`;
    })(),
);

/*
  The handoff pair: the machine door to `packages/handoff`, which until 12-Sep-2026 a person
  reached only through the /handoff screen or `panoma handoff`. Two things govern both tools.

  The gate is the operator's, ahead of the agent's. What the first tool lists is the person's own
  conversation history —the four stores— and what the second writes is a file into another
  agent's history; that family is behind the operator key on the web, and it is the same family
  here, so the client sends that key (loopback only, `localKeys`) and the route checks it before
  it looks at the agent key. The agent key comes second and attributes the receipt to the agent
  that asked; the scope is the location's, as on every tool — the catalog project it names, its
  root and every folder inside it — and the key adds no scope of its own.

  And the same agent is not a target here. The person's two-account flow —sign out, sign in with
  the account they want to continue with, resume the same file— is a sequence of the person's own
  steps, on the screen or in the terminal, and this channel does not carry it: the route answers
  `same-store` with the sentence that says where the person does it.
 */

/**
 * Ask a handoff route, and let a refusal reach the model as an answer.
 *
 * A refusal is an answer, not a channel error. `same-store`, `ambiguous-id`,
 * `conversation-not-found`, `no-project`… come back as text with the route's hint, because none
 * of them is fixed by calling again, and a model that reads an error retries. What is not a known
 * code — the catalog down, a redirect, a 403 from the gate — is still an error. Both tools go
 * through here: the list refuses with the same codes the write does, and a code that reached the
 * model bare, with a full stop after it, was the list's until 12-Sep-2026.
 */
async function askHandoffRoute(call: () => Promise<string>): Promise<string> {
  try {
    return await call();
  } catch (error) {
    const said = error instanceof CatalogError && error.code !== undefined
      ? formatHandoffFault({ code: error.code, detail: error.detail, hint: error.hint })
      : undefined;
    if (said === undefined) throw error;
    return said;
  }
}

/** The words the route takes after `target`: the plain words, the canonical ids, and the two apps. */
const TARGET_WORDS = [
  "claude",
  "codex",
  "opencode",
  "gemini",
  "cursor",
  "copilot",
  "aider",
  "amp",
  "goose",
  "claude-cli",
  "codex-cli",
  "gemini-cli",
  "cursor-agent",
  "copilot-cli",
  "amp-cli",
  "claude-app",
  "codex-app",
] as const;

server.registerTool(
  "panoma_conversations",
  {
    title: "Conversations kept for this project",
    description:
      "Lists the conversations the coding agents on this machine — Claude Code, Codex, OpenCode, " +
      "Gemini CLI, and the Claude and Codex desktop apps — kept on disk for this project: one line " +
      "per conversation with its id, its agent, when it was last updated, its size, whether it " +
      "carries a summary of its own and whether it ended on a usage limit. It also lists the " +
      "handoffs already recorded for the project, so a copy written before is known before a " +
      "second one is. Call it before panoma_handoff when you need to name a conversation by id, " +
      "or when the person asks what is there to continue. The scope is the catalog project the " +
      "location names — its root and every folder inside it; naming another project's path " +
      "works exactly as with panoma_context. It reads the agents' own files and writes nothing.",
    inputSchema: location,
  },
  async ({ path }) =>
    tool(() =>
      askHandoffRoute(async () => {
        const where = await describeLocation(path);
        return formatConversations(await client.post<ConversationsAnswer>("/api/agent/conversations", where));
      }),
    )(),
);

server.registerTool(
  "panoma_handoff",
  {
    title: "Continue this conversation in another agent",
    /*
      The trigger clause comes second, right after what the tool does, because this is the one
      tool that writes into another agent's history: a description that says only what it does
      is read by a model as something it may do, and a README that says «continue this in codex»
      is then enough. The target list and the tiers are in the inputSchema and not here, so the
      description stays shorter than panoma_context's: the model reads it on every turn it
      considers the tool.
     */
    description:
      "Hands a conversation kept on this machine to another coding agent, so the person continues " +
      "it there. Call it only when the person asks to continue somewhere else, and only once per " +
      "request: it is never a step of your own, never at the start of a session, and a dryRun " +
      "first is the safe way to show them what would travel. It WRITES a new conversation, with " +
      "an id of its own, into the target agent's own history, and never touches the original. " +
      "Without id it takes the newest conversation kept for this project (its root " +
      "and every folder inside it) — when you are that conversation's agent, this very " +
      "conversation up to this call; two different agents active in the same hour is refused, " +
      "naming both ids. The scope is the catalog project the location names; another project's " +
      "path works exactly as with panoma_context, and the receipt names who asked. The answer " +
      "carries the line the PERSON runs to resume the copy: show it to them, never run it " +
      "yourself. The same agent the conversation lives in is refused. No model writes the digest.",
    inputSchema: {
      ...location,
      id: z
        .string()
        .min(3)
        .max(200)
        .optional()
        .describe(
          "A conversation id exactly as panoma_conversations lists it (agent:sessionId). Omit it to " +
            "take the newest conversation kept for this project.",
        ),
      target: z
        .enum(TARGET_WORDS)
        .describe("The agent that continues the conversation, or one of its desktop apps (claude-app, codex-app)."),
      tier: z
        .enum(["full", "compact", "brief"])
        .optional()
        .describe(
          "How much travels. full: every turn (default). compact: the digest plus the newest turns, " +
            "for a conversation that hit a limit. brief: a Markdown document only.",
        ),
      keepTurns: z
        .number()
        .int()
        .positive()
        .max(500)
        .optional()
        .describe("With compact: how many of the newest turns travel whole. Default 12."),
      dryRun: z
        .boolean()
        .optional()
        .describe("true: answer what would travel and write nothing."),
    },
  },
  async ({ path, id, target, tier, keepTurns, dryRun }) =>
    tool(() =>
      askHandoffRoute(async () => {
        // The id's shape first, before the catalog is asked anything: a bad one never travels.
        const checked = id !== undefined ? checkConversationId(id) : undefined;
        const where = await describeLocation(path);
        const body = {
          ...where,
          ...(checked !== undefined ? { id: checked } : {}),
          target,
          ...(tier !== undefined ? { tier } : {}),
          ...(keepTurns !== undefined ? { keepTurns } : {}),
          ...(dryRun !== undefined ? { dryRun } : {}),
        };
        return formatHandoff(await client.post<HandoffAnswer>("/api/agent/handoff", body));
      }),
    )(),
);

/*
  The video four: the machine door to the optional apps, which until 12-Sep-2026 a person reached
  only through the Apps screen, the production screen or `panoma apps` and `panoma video`. What
  governs them is what governs the app's own doors, one floor up (docs/apps.md): the person
  installs, switches on and pays; an agent may ask for a production and follow it. So the two
  that move something — a start, a cancel — carry the operator key ahead of the agent key, like
  the handoff pair, and the two that read carry the agent key alone. The model and the voice are
  never in a body here: they are the app's settings, confirmed with its disclosure, and every run
  reads them from there whoever asked.
 */

/**
 * Ask a video route, and let a refusal reach the model as an answer — the same arrangement as
 * `askHandoffRoute`, with the app's own vocabulary: `not-installed`, `app-budget-exhausted`,
 * `local-url-required`… are answers a person acts on, not errors a retry fixes.
 */
async function askVideoRoute(call: () => Promise<string>): Promise<string> {
  try {
    return await call();
  } catch (error) {
    const said = error instanceof CatalogError && error.code !== undefined
      ? formatVideoFault({ code: error.code, detail: error.detail, hint: error.hint })
      : undefined;
    if (said === undefined) throw error;
    return said;
  }
}

/** A job id as the catalog issues them, or the sentence: a UUID, and nothing that could pick a route. */
function checkJobId(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(
      `“${id.slice(0, 60)}” is not shaped like a job id. Ids come from panoma_video and ` +
        `panoma_video_jobs and are copied verbatim; do not build one out of other text.`,
    );
  }
  return id;
}

server.registerTool(
  "panoma_apps",
  {
    title: "Optional apps on this machine",
    description:
      "Lists the optional apps panoma can drive on this machine — today panoma video, which " +
      "turns a project into a short product video — with what each one has: the installed " +
      "version and the newest on npm, whether it is enabled and ready, each requirement it " +
      "declares and whether it is present, the model and the voice the person switched on for " +
      "it, and the person's next step when it is not ready. Call it before panoma_video when you " +
      "do not know whether a video can be made here, or when the person asks what the app needs. " +
      "It reads the catalog and writes nothing: installing, enabling and switching a provider on " +
      "are the person's, from the Apps screen, and no tool here does them.",
    inputSchema: {},
  },
  async () =>
    tool(() =>
      askVideoRoute(async () => formatApps(await client.post<{ apps: AgentApp[] }>("/api/agent/apps", {}))),
    )(),
);

server.registerTool(
  "panoma_video",
  {
    title: "Make a video of this project",
    /*
      The trigger clause comes right after what the tool does, as in panoma_handoff: a run takes
      minutes, starts the project's own development server, and spends what the person switched
      on for the app. A description that says only what it does is read by a model as something
      it may do, and «make me a promo» in a README would then be enough.
     */
    description:
      "Starts a production of panoma video for the catalog project the location names: the app " +
      "reads the project, starts it, films it in a browser of its own, writes the words and " +
      "renders the cuts, in a durable job that outlives this call. Call it only when the person " +
      "asks for a video of the project — a promo, a trailer, a tutorial — and never as a step of " +
      "your own: a run takes minutes and spends the model and the voice the person switched on " +
      "for the app, which this call cannot choose. The answer is the job with its id and first " +
      "state; follow it with panoma_video_jobs, which also says where each cut was written. A " +
      "second identical request while the first runs answers the running job, not a new one.",
    inputSchema: {
      ...location,
      goal: z
        .enum(["promo", "trailer", "spotlight", "tutorial", "sitetour", "facts", "all"])
        .optional()
        .describe(
          "What to make. promo (default): one supported benefit through real actions, type and " +
            "music, no narration. trailer: announces a release, needs a reachable tag. spotlight: " +
            "isolates controls. tutorial: teaches with narration. sitetour: shows sections. facts: " +
            "for CLIs and libraries. all: every kind the project earns.",
        ),
      format: z
        .enum(["v", "h", "s"])
        .optional()
        .describe(
          "The shape of the cut, and what the app films for it: v vertical 9:16 (default) films " +
            "the phone layout, h landscape 16:9 and s square 1:1 film the desktop one. A cut in " +
            "another shape later is a new production with its own recording.",
        ),
      langs: z
        .array(z.enum(["en", "es"]))
        .min(1)
        .max(2)
        .optional()
        .describe("Languages to produce. Default [\"en\"]."),
      until: z
        .enum(["plan", "preview", "final"])
        .optional()
        .describe(
          "How far to go. plan: the briefs only, seconds, no browser. preview (default): one " +
            "reference cut per brief, minutes. final: every language and format with its kit, many minutes.",
        ),
      url: z
        .string()
        .max(2048)
        .optional()
        .describe(
          "An address already running on this machine with real content in it — localhost, " +
            "127.0.0.1 or [::1] — to film instead of starting the project. Any other host is refused.",
        ),
      theme: z
        .enum(["normal", "flat", "vibrant", "block", "grid", "auto"])
        .optional()
        .describe("The look of the added graphics of a promo. Omitted is normal; auto lets the model choose."),
      creative_brief: z
        .string()
        .min(1)
        .max(2000)
        .optional()
        .describe("Editorial direction for a promo: audience, emphasis, effects. It guides choices over what was filmed; it cannot invent features."),
      force: z.boolean().optional().describe("true: film the project again even when nothing changed."),
      new_story: z.boolean().optional().describe("true: plan a new promo and archive the previous one's revisions."),
    },
  },
  async ({ path, ...asked }) =>
    tool(() =>
      askVideoRoute(async () => {
        const where = await describeLocation(path);
        const body = Object.fromEntries(Object.entries({ ...where, ...asked }).filter(([, value]) => value !== undefined));
        return formatVideoStart(await client.post<VideoStartAnswer>("/api/agent/video", body));
      }),
    )(),
);

server.registerTool(
  "panoma_video_jobs",
  {
    title: "The productions of this project",
    description:
      "The productions of panoma video for the catalog project the location names. Without id, " +
      "the newest ten, one line each: state, who asked, what was asked, how long. With id, one " +
      "job whole: its twelve stages with what each did in the app's own words, the app's last " +
      "line while it runs, how long it has been at it, and once it ended the cuts with their " +
      "files on this machine and their reviews, the kinds of video set aside with the reason, " +
      "and the model calls it spent. wait: true holds the call up to twenty-five seconds until " +
      "the job moves, so following a run costs one call per change and not one per second. It " +
      "reads the catalog and writes nothing.",
    inputSchema: {
      ...location,
      id: z
        .string()
        .min(36)
        .max(36)
        .optional()
        .describe("A job id exactly as panoma_video or this tool gave it. Omit it for the list."),
      wait: z
        .boolean()
        .optional()
        .describe("With id: true holds the call until the job moves, up to twenty-five seconds."),
    },
  },
  async ({ path, id, wait }) =>
    tool(() =>
      askVideoRoute(async () => {
        const checked = id !== undefined ? checkJobId(id) : undefined;
        const where = await describeLocation(path);
        const body = { ...where, ...(checked !== undefined ? { id: checked } : {}), ...(wait !== undefined ? { wait } : {}) };
        if (checked === undefined) return formatVideoJobs(await client.post<VideoJobsAnswer>("/api/agent/video/jobs", body));
        return formatVideoJob(await client.post<VideoJobAnswer>("/api/agent/video/jobs", body));
      }),
    )(),
);

server.registerTool(
  "panoma_video_cancel",
  {
    title: "Stop a production",
    description:
      "Stops a production of this project that is pending or running, by the id panoma_video or " +
      "panoma_video_jobs gave. Call it only when the person asks to stop it, or when you started " +
      "it and they changed their mind. What the run had already recorded stays on disk for the " +
      "next one, which redoes only what changed. The answer is the job as it stands afterwards.",
    inputSchema: {
      ...location,
      id: z.string().min(36).max(36).describe("The job id, exactly as it was given."),
    },
  },
  async ({ path, id }) =>
    tool(() =>
      askVideoRoute(async () => {
        const checked = checkJobId(id);
        const where = await describeLocation(path);
        return formatVideoJob(await client.post<VideoJobAnswer>("/api/agent/video/cancel", { ...where, id: checked }));
      }),
    )(),
);

await server.connect(new StdioServerTransport());

/*
  And then it says it is here.

  Everything above talks to the catalog only inside a tool, so an agent that starts and is not
  asked for anything is invisible to panoma — which spent three releases telling people their agent
  was «connected» off the fact that a key existed, and then telling them to restart a session that
  changed nothing they could see. It changed nothing because nothing reached the other side.

  After `connect` and not before: the channel with the agent is what must not be kept waiting, and
  a catalog that is slow to answer —or not running at all— has no business delaying it.

  Nothing is awaited and nothing is reported. If it fails, the agent is up, its tools work the
  moment the catalog returns, and the only cost is a badge that stays honest about not having seen
  it yet. Announcing that failure on stdio would be worse than the silence: this transport carries
  the protocol, and noise on it is not a message anybody reads.
 */
void client.post("/api/agent/hello", {}).catch(() => undefined);
