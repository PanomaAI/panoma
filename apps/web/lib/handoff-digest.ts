import { complete } from "@panoma/ai";
import { redactSecrets, wrapUntrusted } from "@panoma/core";
import { saveModelCall, type Database } from "@panoma/db";
import { textOfPart, type Conversation, type Digest } from "@panoma/handoff";

/*
  The digest a model writes, when the person asks for one.

  The mechanical digest (`digestConversation`, free, default) already lists what happened: goal,
  decisions, files, commands, open items, the last exchange. What it cannot do is say what it
  *meant* — which of the six attempts was the one that worked, why the third file was touched —
  and that is the one section a model adds: the summary. Everything else in the digest stays
  the engine's; the model's paragraph goes into `summary` and `by` becomes `model`.

  ── What travels, and how ──────────────────────────────────────────────────────────────────────
  A conversation is the most foreign material panoma ever shows a model: the person's own words,
  every tool output the agent read, other people's READMEs and pages inside those outputs. So
  every turn passes `redactSecrets` and every block goes wrapped as `conversation` origin, with
  the three-line notice once, behind the last block — repeated behind each one it turns into
  filler (`packages/core` exports the wrapper and not the note, so the head is not an option). The
  turns travel newest first up to a character budget, because the end of a conversation is what
  the next agent has to continue from; the first user turn always travels, because it is the
  goal.

  ── The language ───────────────────────────────────────────────────────────────────────────────
  The instructions are English, like everything a machine reads; the summary follows the
  conversation, not the browser. A person working in Spanish with the browser in English gets a
  Spanish paragraph handed to the next agent, which is the one that has to read it.
  `model-language.test.ts` accepts a source-language rule and refuses a pinned one.

  ── The ledger before the answer is read ───────────────────────────────────────────────────────
  One row of kind `handoff` per call, written the moment the answer arrives and before anything
  looks at it: a brake that counts only answers it understood stops counting the day a model
  starts answering anything. One retry at double the room when the answer was cut, and only
  while the day's cap still has a slot for it.
 */

/** The kind this writes in the ledger; the family `handoff` in `spend-settings.ts` counts it. */
export const DIGEST_KIND = "handoff";

/** Room for the paragraph. Doubled once when the first answer was cut. */
export const MAX_DIGEST_TOKENS = 1200;

/** Characters, per block: the goal, the source's own summary, the two lists, all the turns together, one turn. */
const GOAL_LIMIT = 1500;
const SOURCE_SUMMARY_LIMIT = 3000;
const LISTS_LIMIT = 6000;
const TURNS_LIMIT = 24_000;
const TURN_LIMIT = 2500;

/**
 * A user turn that is only the agent's marker of a slash command (`/compact`, `/clear`) states
 * no goal. The engine's `digestConversation` skips it the same way; this is its `COMMAND_MARKER`
 * (`packages/handoff/src/digest.ts`), repeated because the engine does not export it, and
 * `handoff-digest.test.ts` holds the two selections to the same answer.
 */
const COMMAND_MARKER = /^\s*<command-(?:name|message)>[\s\S]*$/;

const SYSTEM =
  "You write the summary of a conversation between a person and a coding agent, so that " +
  "another agent can continue the work without reading the transcript. Plain prose, one to " +
  "three paragraphs, no headings, no lists, no preamble. Only what the material says: if it " +
  "does not say why something was done, do not guess.";

export interface DigestPrompt {
  system: string;
  prompt: string;
  /** How many of the conversation's turns fit in the budget, newest first. */
  turnsIncluded: number;
}

/** One turn as text: its parts joined, tool parts as the notes a text-only agent would keep. */
function textOfTurn(turn: Conversation["turns"][number]): string {
  return turn.parts.map(textOfPart).filter((text) => text.trim() !== "").join("\n");
}

/**
 * The person's first message, chosen as the engine chooses the digest's `goal`: the first user
 * turn with a text part that is not a slash-command marker, else the first with any text part.
 * A `summary` part is not text — every reader opens a compacted conversation with the previous
 * summary as a user turn, and that block already travels once, labelled as what it is — so a
 * whole turn is never taken: until 12-Sep-2026 it was, and a compacted source sent its summary
 * twice, once as «the person's first message». The engine cuts its goal to 600 characters and
 * the prompt keeps 1500, which is why the text is picked here and not copied from the digest.
 */
function goalOf(turns: Conversation["turns"]): string {
  const textOf = (keep: (text: string) => boolean) => {
    for (const turn of turns) {
      if (turn.role !== "user") continue;
      const part = turn.parts.find((p) => p.kind === "text" && p.text.trim() !== "" && keep(p.text.trim()));
      if (part && part.kind === "text") return part.text.trim();
    }
    return undefined;
  };
  return textOf((text) => !COMMAND_MARKER.test(text)) ?? textOf(() => true) ?? "";
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n…(turn clipped)` : text;
}

/**
 * The prompt, and nothing paid: the route tests it without a model.
 *
 * Blocks: the goal, the source agent's own summary when there is one, the two lists the
 * mechanical digest quotes from the transcript, and the turns — the newest ones that fit
 * `TURNS_LIMIT`, each clipped to `TURN_LIMIT` so one enormous tool output cannot eat the whole
 * window. The digest's counts go as plain lines: a number is the engine's own fact. Its lists
 * are not: the files touched are paths out of tool inputs and the open items are lines of the
 * assistant's last answer, and no reader redacts either (`packages/handoff/src/readers` only
 * counts `redacted_thinking` blocks), so they pass the redactor and go inside a block like the
 * turns they came from — until 12-Sep-2026 they went plain, on the belief that the reader had
 * covered them, and a key in a «next steps» line reached the provider bare while the same line
 * inside the turns block was masked. A model that sees "files touched" spelled out writes a
 * summary that agrees with the rest of the digest, which is why the lists travel at all.
 */
export function buildDigestPrompt(conversation: Conversation, digest: Digest): DigestPrompt {
  const wrap = (text: string, limit: number, last = false) =>
    wrapUntrusted(text, { origin: "conversation", limit, ...(last ? {} : { includeNote: false }) });

  const turns = conversation.turns;
  const goal = redactSecrets(goalOf(turns));

  const chosen: string[] = [];
  let used = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    const text = clip(redactSecrets(textOfTurn(turn)), TURN_LIMIT);
    if (text.trim() === "") continue;
    const line = `[${turn.role}]\n${text}`;
    if (used + line.length > TURNS_LIMIT && chosen.length > 0) break;
    chosen.unshift(line);
    used += line.length;
  }

  const facts = [
    digest.decisions.length > 0 ? `Decisions the agent stated: ${digest.decisions.length}` : "",
    digest.commandsRun.length > 0 ? `Commands run: ${digest.commandsRun.length}` : "",
    `Turns in the conversation: ${digest.stats.turns}; shown below, newest last: ${chosen.length}`,
  ].filter(Boolean);
  const lists = [
    digest.filesTouched.length > 0 ? `Files touched: ${digest.filesTouched.map(redactSecrets).join(", ")}` : "",
    digest.openItems.length > 0 ? `Open items the agent listed: ${digest.openItems.map(redactSecrets).join(" · ")}` : "",
  ].filter(Boolean);

  const prompt = [
    "Write the summary in the language the conversation is written in.",
    "Say what the person was trying to do, what was decided and why when the transcript says",
    "why, what was tried and did not work, and what is still open. Name files and commands",
    "exactly as they appear. Do not address the person; describe the work.",
    "",
    "Facts the engine already extracted:",
    ...facts.map((fact) => `- ${fact}`),
    ...(lists.length > 0 ? ["", "What the transcript names, as the engine listed it:", wrap(lists.join("\n"), LISTS_LIMIT)] : []),
    "",
    "The person's first message:",
    wrap(goal, GOAL_LIMIT) || "(empty)",
    ...(digest.summary
      ? ["", "The summary the source agent had already made of the earlier part:", wrap(redactSecrets(digest.summary), SOURCE_SUMMARY_LIMIT)]
      : []),
    "",
    "The conversation, oldest to newest:",
    // The budget was applied above; the wrapper's own cut only guards the one turn that may
    // overshoot it when it is the newest and nothing else fit.
    wrap(chosen.join("\n\n"), TURNS_LIMIT + TURN_LIMIT + 256, true) || "(nothing to show)",
  ].join("\n");

  return { system: SYSTEM, prompt, turnsIncluded: chosen.length };
}

/** The paragraph, or nothing when the model answered with nothing readable. */
export function parseDigestAnswer(text: string): string | undefined {
  const cleaned = redactSecrets(text).replace(/^\s*(?:summary|resumen)\s*:\s*/i, "").trim();
  return cleaned === "" ? undefined : cleaned;
}

/** The engine's digest with the model's paragraph in the one place a model may write. */
export function withModelSummary(digest: Digest, summary: string): Digest {
  return { ...digest, by: "model", summary };
}

export interface ModelDigestInput {
  conversation: Conversation;
  digest: Digest;
  /** The family's cap for today, and how many calls it already spent: the in-loop brake. */
  cap: number;
  spent: number;
  identity?: string | null;
}

export interface ModelDigestResult {
  digest: Digest;
  /** How many paid calls this took: one, or two when the first answer was cut. */
  calls: number;
  provider: string;
  model: string;
}

/**
 * The paid half. The caller checked the cap already and answers the 429; this pays, writes the
 * ledger row, retries once on a cut answer while the cap allows, and hands back the digest.
 * A model failure propagates: the route turns it into the 502 with `modelErrorParts`.
 */
export async function writeDigestWithModel(database: Database, input: ModelDigestInput): Promise<ModelDigestResult> {
  const built = buildDigestPrompt(input.conversation, input.digest);
  let calls = input.spent;
  const ask = async (maxTokens: number) => {
    const answer = await complete({ system: built.system, prompt: built.prompt, maxTokens });
    calls += 1;
    await saveModelCall(database, {
      kind: DIGEST_KIND,
      provider: answer.provider,
      model: answer.model,
      identity: input.identity ?? null,
      ...(answer.usage ? { input: answer.usage.input, output: answer.usage.output } : {}),
    });
    return answer;
  };

  let answer = await ask(MAX_DIGEST_TOKENS);
  if (answer.stopReason === "length" && calls < input.cap) {
    answer = await ask(MAX_DIGEST_TOKENS * 2);
  }
  const summary = parseDigestAnswer(answer.text) ?? input.digest.summary ?? "";
  return {
    digest: withModelSummary(input.digest, summary),
    calls: calls - input.spent,
    provider: answer.provider,
    model: answer.model,
  };
}
