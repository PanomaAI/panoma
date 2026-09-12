/**
 * What a person types back, resolved against the list: the full `agent:sessionId`, the whole
 * session id, or any unique prefix of at least four characters of the handle. Ambiguity is a
 * fault that names the candidates, so the next attempt can be exact.
 */
import { HandoffFault } from "./faults";
import { isSafeId, shortHandle, splitConversationId } from "./ids";
import { isAgentId, type ConversationRef, type Discovery } from "./types";

export const MIN_PREFIX = 4;

export function resolveConversation(handleOrPrefix: string, discovery: Discovery): ConversationRef {
  const wanted = handleOrPrefix.trim();
  const split = splitConversationId(wanted);
  if (split && isAgentId(split.agent)) {
    const exact = discovery.conversations.find((ref) => ref.id === wanted);
    if (exact) return exact;
    throw new HandoffFault("conversation-not-found", wanted);
  }
  if (!isSafeId(wanted)) throw new HandoffFault("invalid-id", wanted);
  if (wanted.length < MIN_PREFIX) throw new HandoffFault("invalid-id", `at least ${MIN_PREFIX} characters`);

  const bySession = discovery.conversations.filter((ref) => ref.sessionId === wanted);
  if (bySession.length === 1) return bySession[0]!;
  const lower = wanted.toLowerCase();
  const matches = discovery.conversations.filter((ref) => {
    const handle = shortHandle(ref.agent, ref.sessionId).toLowerCase();
    const body = (ref.agent === "opencode" && ref.sessionId.startsWith("ses_") ? ref.sessionId.slice(4) : ref.sessionId).toLowerCase();
    return handle.startsWith(lower) || body.startsWith(lower) || ref.sessionId.toLowerCase().startsWith(lower);
  });
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new HandoffFault("conversation-not-found", wanted);
  throw new HandoffFault("ambiguous-id", matches.map((ref) => `${ref.agent}:${ref.handle}`).join(", "));
}

/** Two conversations from different agents closer than this are not chosen between. */
export const SAME_HOUR_MS = 60 * 60 * 1000;

/**
 * The conversation a caller means when it names none: the newest of the folder — and the rival
 * that stops the choice, when there is one. Two agents within the same hour is not a choice the
 * machine makes: the person was in both, and the wrong one handed over is the one they were not
 * looking at. Every row within the hour of the newest is looked at, not only the second: two
 * Codex sessions ten minutes apart and a Claude one behind them are still two agents in one
 * hour, and until 12-Sep-2026 both doors read the second row alone and handed the newest over.
 * The rows come newest first, as discovery lists them; the rule is shared by `panoma handoff`
 * and `POST /api/agent/handoff` so the two doors cannot drift apart.
 */
export function newestOfFolder(refs: readonly ConversationRef[]): { newest: ConversationRef | undefined; rival: ConversationRef | undefined } {
  const [newest] = refs;
  if (!newest) return { newest: undefined, rival: undefined };
  const since = Date.parse(newest.updatedAt);
  const rival = refs.slice(1).find((ref) => ref.agent !== newest.agent && since - Date.parse(ref.updatedAt) < SAME_HOUR_MS);
  return { newest, rival };
}
