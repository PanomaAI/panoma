/**
 * A conversation written where Gemini CLI's own resume should find it.
 *
 * Verified against the gemini-cli source, never run live (docs/open-questions.md): a JSONL
 * whose first line is the metadata `{sessionId, projectHash, startTime, lastUpdated, kind}`,
 * then `{id, timestamp, type: "user" | "gemini", content: [{text}]}` per message, and a final
 * `{"$set": {"summary": …}}` that names the row in the picker. The project id must match the
 * folder the file sits in — the registry slug when the cwd is registered, `sha256(cwd)`
 * otherwise. A `summary` part travels as the first user text: Gemini has no compaction
 * record. Tool activity becomes text notes. The loader treats every line with a string `id`
 * as a message, so every id here is a fresh uuid.
 */
import { textOfPart } from "../notes";
import { geminiChatPath, geminiProjectId, geminiStoreAt } from "../stores/gemini";
import type { WriteResult } from "../types";
import { Redactor, clock, resultOf, withProvenance, writeAtomic, type WriteRequest } from "./shared";

export async function writeGeminiConversation(request: WriteRequest): Promise<WriteResult> {
  const { conversation, cwd, random, now, platform, title } = request;
  const store = geminiStoreAt(request.root, { home: request.root, env: {}, platform });
  const sessionId = random.uuid();
  const projectId = geminiProjectId(store, cwd);
  const path = geminiChatPath(store, projectId, now, sessionId);
  const dir = store.resolved.path.dirname(path);
  const redactor = new Redactor();
  const turns = withProvenance(conversation.turns, request);
  const tick = clock(now);
  const lines: Record<string, unknown>[] = [];
  let written = 0;
  let last = now.toISOString();

  for (const turn of turns) {
    const at = turn.at ?? tick().toISOString();
    const texts = turn.parts.map((part) => redactor.text(textOfPart(part))).filter((t) => t.length > 0);
    if (texts.length === 0) continue;
    lines.push({
      id: random.uuid(),
      timestamp: at,
      type: turn.role === "user" ? "user" : "gemini",
      content: texts.map((text) => ({ text })),
    });
    written += 1;
    last = at;
  }

  lines.unshift({
    sessionId,
    projectHash: projectId,
    startTime: turns[0]?.at ?? now.toISOString(),
    lastUpdated: last,
    kind: "main",
  });
  const shownTitle = title ?? conversation.title;
  if (shownTitle) lines.push({ $set: { summary: redactor.text(shownTitle) } });

  const content = `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
  const bytes = await writeAtomic(path, content, dir, sessionId);
  return resultOf("gemini-cli", request, sessionId, path, written, bytes, redactor);
}
