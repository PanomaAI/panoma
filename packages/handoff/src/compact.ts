/**
 * The `compact` tier: the digest as a summary, then the newest turns whole.
 *
 * The window never opens on a tool result whose call is behind it: when the first kept turn
 * is a user turn of results, the assistant turn that made the calls comes along, so a native
 * writer has nothing to balance away. The hash is recomputed — it is a different conversation
 * now — and the `dropped` counts travel as they were: what the source lost, it still lost.
 */
import { digestMarkdown } from "./digest";
import { hashTurns } from "./hash";
import { KEEP_TURNS_DEFAULT, type Conversation, type Digest, type Turn } from "./types";

export interface CompactOptions {
  keepTurns?: number;
}

export function compactConversation(
  conversation: Conversation,
  digest: Digest,
  options: CompactOptions = {},
): Conversation {
  const keep = Math.max(1, Math.floor(options.keepTurns ?? KEEP_TURNS_DEFAULT));
  const source = conversation.turns;
  let start = Math.max(0, source.length - keep);
  // The summary the source already carried is inside the digest; it does not travel twice.
  while (start < source.length && source[start]!.parts.every((part) => part.kind === "summary")) start += 1;
  const first = source[start];
  if (start > 0 && first && first.role === "user" && first.parts.some((part) => part.kind === "tool_result")) {
    start -= 1;
  }
  const kept: Turn[] = source.slice(start).map((turn) => ({ ...turn, parts: [...turn.parts] }));
  const summary: Turn = { role: "user", parts: [{ kind: "summary", text: digestMarkdown(digest) }] };
  const at = kept[0]?.at ?? conversation.startedAt;
  if (at) summary.at = at;
  const turns = [summary, ...kept];
  return {
    ...conversation,
    turns,
    turnCount: turns.length,
    compacted: true,
    hash: hashTurns(turns),
    compactions: [...conversation.compactions],
    dropped: { ...conversation.dropped },
  };
}
