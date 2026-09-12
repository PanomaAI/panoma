/**
 * A conversation written as the envelope `opencode import` takes.
 *
 * Verified on OpenCode 1.2.6 (11-Sep-2026) against a copy of the real database: the envelope
 * is `{info: <session>, messages: [{info: <message>, parts: [<part>]}]}`, `info.projectID` must
 * be a row that exists (`"global"` is), ids carry the `ses_`/`msg_`/`prt_` prefixes with the
 * time-sortable encoding, an assistant message needs `parentID`, `modelID`, `providerID`,
 * `mode`, `agent`, `path`, `cost` and `tokens`, a user message needs `agent` and `model`. The
 * file goes next to the database at 0600 and the caller runs the import: this package starts
 * no process. A `summary` part becomes the compaction pair — a user message with a
 * `compaction` part and an assistant reply with `summary: true` — which is where OpenCode's
 * own replay starts. Tool activity becomes text notes.
 *
 * The model written is `panoma/handoff`: the next turn needs `-m provider/model`, which the
 * fidelity table says before the write.
 */
import { opencodeId } from "../ids";
import { textOfPart } from "../notes";
import { opencodeEnvelopePath, opencodeStoreAt } from "../stores/opencode";
import { quoteForShell } from "../fidelity";
import type { Part, WriteResult } from "../types";
import { Redactor, clock, resultOf, withProvenance, writeAtomic, type WriteRequest } from "./shared";

export const OPENCODE_PROVIDER = "panoma";
export const OPENCODE_MODEL = "handoff";
export const OPENCODE_VERSION = "0.0.0-panoma";

export async function writeOpencodeConversation(request: WriteRequest): Promise<WriteResult> {
  const { conversation, cwd, random, now, platform, title } = request;
  const store = opencodeStoreAt(request.root, { home: request.root, env: {}, platform });
  const redactor = new Redactor();
  const turns = withProvenance(conversation.turns, request);
  const tick = clock(now);
  let counter = 0;
  const nextId = (prefix: "ses" | "msg" | "prt", at: Date): string => opencodeId(prefix, at, counter++, random);

  const sessionId = nextId("ses", now);
  const path = opencodeEnvelopePath(store, sessionId);
  const shownTitle = redactor.text(title ?? conversation.title ?? "Handed off by panoma");
  const messages: { info: Record<string, unknown>; parts: Record<string, unknown>[] }[] = [];
  let lastUser: string | undefined;
  let written = 0;

  const userMessage = (at: Date, parts: Record<string, unknown>[], id: string) => {
    lastUser = id;
    messages.push({
      info: {
        id,
        sessionID: sessionId,
        role: "user",
        time: { created: at.getTime() },
        agent: "build",
        model: { providerID: OPENCODE_PROVIDER, modelID: OPENCODE_MODEL },
      },
      parts,
    });
  };
  const assistantMessage = (at: Date, parts: Record<string, unknown>[], id: string, summary: boolean) => {
    const info: Record<string, unknown> = {
      id,
      sessionID: sessionId,
      role: "assistant",
      time: { created: at.getTime(), completed: at.getTime() },
      parentID: lastUser ?? id,
      modelID: OPENCODE_MODEL,
      providerID: OPENCODE_PROVIDER,
      mode: summary ? "compaction" : "build",
      agent: summary ? "compaction" : "build",
      path: { cwd, root: cwd },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
    };
    if (summary) info["summary"] = true;
    messages.push({ info, parts });
  };
  const textPart = (messageId: string, at: Date, text: string): Record<string, unknown> => ({
    id: nextId("prt", at),
    sessionID: sessionId,
    messageID: messageId,
    type: "text",
    text,
    time: { start: at.getTime(), end: at.getTime() },
  });

  for (const turn of turns) {
    const at = turn.at ? new Date(turn.at) : tick();
    const when = Number.isNaN(at.getTime()) ? tick() : at;
    const summary = turn.parts.find((part): part is Extract<Part, { kind: "summary" }> => part.kind === "summary");
    if (summary) {
      // The compaction pair: OpenCode's replay starts at the newest one.
      const compactionId = nextId("msg", when);
      userMessage(when, [{
        id: nextId("prt", when),
        sessionID: sessionId,
        messageID: compactionId,
        type: "compaction",
        auto: false,
      }], compactionId);
      const summaryId = nextId("msg", when);
      assistantMessage(when, [textPart(summaryId, when, redactor.text(summary.text))], summaryId, true);
      written += 1;
    }
    const texts = turn.parts
      .filter((part) => part.kind !== "summary")
      .map((part) => redactor.text(textOfPart(part)))
      .filter((text) => text.length > 0);
    if (texts.length === 0) continue;
    const id = nextId("msg", when);
    const parts = texts.map((text) => textPart(id, when, text));
    if (turn.role === "user") userMessage(when, parts, id);
    else assistantMessage(when, parts, id, false);
    written += 1;
  }

  const envelope = {
    info: {
      id: sessionId,
      slug: `handoff-${sessionId.slice(-6).toLowerCase()}`,
      projectID: "global",
      directory: cwd,
      title: shownTitle,
      version: OPENCODE_VERSION,
      time: { created: now.getTime(), updated: tick().getTime() },
    },
    messages,
  };
  const content = `${JSON.stringify(envelope, null, 2)}\n`;
  const bytes = await writeAtomic(path, content, store.root, sessionId, 0o600);
  const steps = [`opencode import ${quoteForShell(path, platform)}`];
  return resultOf("opencode", request, sessionId, path, written, bytes, redactor, steps);
}
