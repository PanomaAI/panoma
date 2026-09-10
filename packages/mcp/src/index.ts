#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CatalogClient, describeLocation } from "./client";
import { formatContext, formatJournalEntry, formatRecall, formatTasks, type Context, type RecallEntry } from "./format";

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
