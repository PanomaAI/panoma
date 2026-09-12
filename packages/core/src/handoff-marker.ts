/**
 * How a copy `packages/handoff` wrote is told apart from a conversation the person had.
 *
 * It lives here and not in the handoff package because the twin's history readers
 * (`history/claude-code.ts`, `history/codex.ts`) must recognise the carried records and skip
 * them, and `@panoma/core` imports nothing from the other packages. A carried record is not
 * owner evidence: the person said those words at the source, where they were already mined,
 * and counting them again would weigh every reaction in that conversation twice.
 *
 * The marks are the writers' own stamps on the record, never the text of the first prompt:
 * `version` on every Claude Code record `writers/claude.ts` writes, and
 * `session_meta.payload.originator` on every rollout `writers/codex.ts` writes. Until
 * 12-Sep-2026 the readers keyed on the first two words of the provenance line instead, and
 * dropped the file whole; that lost two things the feature exists for. A `brief` is a Markdown
 * document that starts with the same line and is meant to be pasted as a first message, so the
 * person's own conversation that opened with one vanished from the twin. And `claude --resume`
 * and `codex resume` append the person's new turns to the copy itself, so every reaction given
 * after the handoff was never read. A stamp is on the record and not in its text — a person
 * cannot type it — and it marks the carried prefix and not the file. The prefix constant stays
 * for the line the writers put in front of the first turn (`notes.ts` in the handoff package)
 * and for a person reading the file; it is not a skip key anywhere, and both stamps have been
 * on every copy since the first one was written on 11-Sep-2026, so no older copy needs it.
 */
export const HANDOFF_PROVENANCE_PREFIX = "Continued from ";

/** The `version` every Claude Code record written by `packages/handoff` carries. Claude Code writes its own version number there. */
export const HANDOFF_CLAUDE_RECORD_VERSION = "panoma-handoff";

/** The `originator` in the `session_meta` of every Codex rollout written by `packages/handoff`. Codex writes its client's name there. */
export const HANDOFF_CODEX_ORIGINATOR = "panoma";
