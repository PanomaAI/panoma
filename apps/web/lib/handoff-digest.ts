import { complete } from "@panoma/ai";
import { redactSecrets, wrapUntrusted } from "@panoma/core";
import { saveModelCall, type Database } from "@panoma/db";
import { textOfPart, type Conversation, type Digest, type Part, type Turn } from "@panoma/handoff";
import { t, type Locale } from "./i18n";

/*
  The digest a model writes, when the person asks for one.

  The mechanical digest (`digestConversation`, free, default) already lists what happened: goal,
  decisions, files, commands, open items, the last exchange. What it cannot do is say what it
  *meant* — which of the six attempts was the one that worked, why the third file was touched —
  and that is the one section a model adds: the summary. Everything else in the digest stays
  the engine's; the model's paragraph goes into `summary` and `by` becomes `model`.

  ── The chain over the whole transcript ────────────────────────────────────────────────────────
  Until 15-Sep-2026 the model got one prompt with the newest turns up to 24,000 characters: a
  summary of the tail, and a person who handed a long conversation got a paragraph that knew
  nothing of its first half. Now panoma compacts the conversation itself, the way the agents
  do: the turns are rendered as text and split into windows of `WINDOW_CHARS`, oldest to
  newest, and the model reads them one call at a time, answering each with the running summary
  — the summary so far, corrected and extended with the window — so that the last answer is the
  summary of the whole. When the source agent already compacted the conversation and its newest
  summary is readable (Claude Code, OpenCode; a Codex summary is encrypted and never is), the
  windows cover only the turns after that summary and the summary is the chain's first «summary
  so far»: take the last compaction and what followed. The plan is pure and costs nothing:
  `planDigest` says how many calls the chain takes before anyone pays, and the preview shows it.

  ── What travels, and how ──────────────────────────────────────────────────────────────────────
  A conversation is the most foreign material panoma ever shows a model: the person's own words,
  every tool output the agent read, other people's READMEs and pages inside those outputs. So
  every part passes `redactSecrets` before it is cut, and every block goes wrapped as
  `conversation` origin — the goal, the lists, the summary so far (the source's own summary or
  the previous answer, both derived from the transcript), the window — with the three-line
  notice once, behind the last block; repeated behind each one it turns into filler
  (`packages/core` exports the wrapper and not the note, so the head is not an option). Thinking
  never travels: the readers keep no such part. A tool result is cut to 400 characters, a tool
  call to 600, a text part to 2,500, and a turn larger than a window is clipped to the window.

  ── The language ───────────────────────────────────────────────────────────────────────────────
  The instructions are English, like everything a machine reads; the summary follows the
  conversation, not the browser. A person working in Spanish with the browser in English gets a
  Spanish paragraph handed to the next agent, which is the one that has to read it.
  `model-language.test.ts` accepts a source-language rule and refuses a pinned one.

  ── The ledger before the answer is read ───────────────────────────────────────────────────────
  One row of kind `handoff` per call, written the moment the answer arrives and before anything
  looks at it: a brake that counts only answers it understood stops counting the day a model
  starts answering anything. The cap is checked before any call — `spent + calls > cap` is the
  429 the routes answer, with the two numbers — and again inside the loop, before each call. One
  retry at double the room when an answer was cut, and only while the cap still has a slot for
  it beyond the windows left to read: a retry never takes the slot of a window, because a chain
  that stops early is a summary of half the conversation labelled as the whole.
 */

/** The kind this writes in the ledger; the family `handoff` in `spend-settings.ts` counts it. */
export const DIGEST_KIND = "handoff";

/** Room for the paragraph, per call. Doubled once when the answer was cut. */
export const MAX_DIGEST_TOKENS = 1200;

/** Characters per window: one paid call reads one window. */
export const WINDOW_CHARS = 60_000;

/** Characters, per block: the goal, the summary so far, the two lists. */
const GOAL_LIMIT = 1500;
const SUMMARY_LIMIT = 12_000;
const LISTS_LIMIT = 6000;

/** Characters, per part: a text part, a tool call as its note, a tool result as its note. */
const TEXT_PART_CHARS = 2500;
const TOOL_CALL_CHARS = 600;
const TOOL_RESULT_CHARS = 400;

const CLIPPED = "\n…(turn clipped)";

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

/* ── The plan: pure, and what the preview shows ─────────────────────────────────────────────── */

export interface DigestPlan {
  /** The rendered window texts, oldest to newest: one paid call each. */
  windows: string[];
  /** The index of the first turn the windows cover: after the newest readable summary, else 0. */
  from: number;
  /** `windows.length`: retries are not planned. */
  calls: number;
}

/** One part as the text the model reads: the note a text-only agent would keep, covered, then cut. */
function renderPart(part: Part): string {
  switch (part.kind) {
    case "text":
    case "summary":
      return clip(redactSecrets(part.text), TEXT_PART_CHARS);
    case "tool_call":
      return clip(redactSecrets(textOfPart(part)), TOOL_CALL_CHARS);
    case "tool_result":
      return clip(redactSecrets(textOfPart(part)), TOOL_RESULT_CHARS);
  }
}

/** One turn as text: its parts joined, or nothing when none of them says anything. */
function renderTurn(turn: Turn): string {
  return turn.parts.map(renderPart).filter((text) => text.trim() !== "").join("\n");
}

/** A turn made only of the source's summary: the marker of a compaction, at its position. */
function isSummaryTurn(turn: Turn): boolean {
  return turn.parts.length > 0 && turn.parts.every((part) => part.kind === "summary");
}

/**
 * Where the windows start. With a readable newest summary, after the newest summary-only turn:
 * the summary stands for everything before it. Without one — never compacted, or compacted by
 * Codex, whose summaries only Codex can open — from the first turn.
 */
function coveredFrom(conversation: Conversation, digest: Digest): number {
  if (digest.summary === undefined) return 0;
  for (let index = conversation.turns.length - 1; index >= 0; index -= 1) {
    if (isSummaryTurn(conversation.turns[index]!)) return index + 1;
  }
  return 0;
}

/**
 * The windows the chain reads, and nothing paid: the preview counts them, the routes check the
 * cap against them, and the paid half reads them one call at a time. Turns are rendered oldest
 * to newest as `[role]` lines and packed into windows of `WINDOW_CHARS`; a turn larger than a
 * window is clipped to it and takes a window of its own. A conversation with nothing to render
 * still plans one window, so the chain still makes one call — the model then writes from the
 * goal and the summary so far, exactly what the single call did before the chain existed.
 */
export function planDigest(conversation: Conversation, digest: Digest): DigestPlan {
  const from = coveredFrom(conversation, digest);
  const windows: string[] = [];
  let current: string[] = [];
  let used = 0;
  for (let index = from; index < conversation.turns.length; index += 1) {
    const turn = conversation.turns[index]!;
    const text = renderTurn(turn);
    if (text.trim() === "") continue;
    const line = clip(`[${turn.role}]\n${text}`, WINDOW_CHARS);
    // Two characters for the blank line between turns; a window that is full closes first.
    if (used > 0 && used + 2 + line.length > WINDOW_CHARS) {
      windows.push(current.join("\n\n"));
      current = [];
      used = 0;
    }
    current.push(line);
    used += (used > 0 ? 2 : 0) + line.length;
  }
  if (current.length > 0) windows.push(current.join("\n\n"));
  if (windows.length === 0) windows.push("(nothing to show)");
  return { windows, from, calls: windows.length };
}

/* ── The prompt of one call ─────────────────────────────────────────────────────────────────── */

export interface DigestStep {
  /** This call's place in the chain, 1-based, of `calls`. */
  call: number;
  calls: number;
  /** The window this call reads, as `planDigest` rendered it. */
  window: string;
  /**
   * The running summary this call extends: on the first call the source agent's own newest
   * summary when it has one, after that the previous answer. Absent on a first call over a
   * conversation nobody compacted.
   */
  summarySoFar?: string;
}

export interface DigestPrompt {
  system: string;
  prompt: string;
  /** The step this prompt is for. */
  call: number;
  calls: number;
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
  return text.length > limit ? `${text.slice(0, limit - CLIPPED.length)}${CLIPPED}` : text;
}

/** The first step of the chain over this conversation: what a prompt built without a step is for. */
function firstStep(conversation: Conversation, digest: Digest): DigestStep {
  const plan = planDigest(conversation, digest);
  return {
    call: 1,
    calls: plan.calls,
    window: plan.windows[0]!,
    ...(digest.summary !== undefined ? { summarySoFar: digest.summary } : {}),
  };
}

/**
 * The prompt of one call, and nothing paid: the route tests it without a model. Without a
 * step, the first call's.
 *
 * The head is the same on every call: the instructions, the digest's counts as plain lines — a
 * number is the engine's own fact — the two lists the mechanical digest quotes from the
 * transcript, and the person's first message. The lists are not facts: the files touched are
 * paths out of tool inputs and the open items are lines of the assistant's last answer, and no
 * reader redacts either (`packages/handoff/src/readers` only counts `redacted_thinking` blocks),
 * so they pass the redactor and go inside a block like the turns they came from — until
 * 12-Sep-2026 they went plain, on the belief that the reader had covered them, and a key in a
 * «next steps» line reached the provider bare while the same line inside the turns block was
 * masked. A model that sees "files touched" spelled out writes a summary that agrees with the
 * rest of the digest, which is why the lists travel at all, and on every call, so that every
 * window names things the same way. What changes from call to call is the summary so far and
 * the window: the summary so far is the source's own on the first call, the previous answer
 * after, and both go wrapped, because both are made of the transcript.
 */
export function buildDigestPrompt(conversation: Conversation, digest: Digest, step?: DigestStep): DigestPrompt {
  const wrap = (text: string, limit: number, last = false) =>
    wrapUntrusted(text, { origin: "conversation", limit, ...(last ? {} : { includeNote: false }) });

  const { call, calls, window, summarySoFar } = step ?? firstStep(conversation, digest);
  const chained = calls > 1 || summarySoFar !== undefined;
  const goal = redactSecrets(goalOf(conversation.turns));

  const facts = [
    digest.decisions.length > 0 ? `Decisions the agent stated: ${digest.decisions.length}` : "",
    digest.commandsRun.length > 0 ? `Commands run: ${digest.commandsRun.length}` : "",
    `Turns in the conversation: ${digest.stats.turns}`,
  ].filter(Boolean);
  const lists = [
    digest.filesTouched.length > 0 ? `Files touched: ${digest.filesTouched.map(redactSecrets).join(", ")}` : "",
    digest.openItems.length > 0 ? `Open items the agent listed: ${digest.openItems.map(redactSecrets).join(" · ")}` : "",
  ].filter(Boolean);

  const instructions = [
    "Write the summary in the language the conversation is written in.",
    "Say what the person was trying to do, what was decided and why when the transcript says",
    "why, what was tried and did not work, and what is still open. Name files and commands",
    "exactly as they appear. Do not address the person; describe the work.",
  ];
  if (chained) {
    instructions.push(
      "",
      `The transcript arrives in windows, oldest to newest, one per call; this is window ${call} of ${calls}.`,
      summarySoFar !== undefined
        ? "A summary so far covers what came before this window. Answer with that summary written" +
          " again: keep what still holds, correct what this window contradicts, add what it brings," +
          " and drop nothing that is still open. The answer to the last window is the summary of the whole conversation."
        : "Nothing came before this window. Answer with its summary, which is the summary so far for the next call.",
    );
  }
  const summaryLabel =
    call === 1
      ? "The summary so far, made by the source agent of the part before this window:"
      : "The summary so far, from the previous window:";
  const windowLabel = chained ? `The conversation, window ${call} of ${calls}, oldest to newest:` : "The conversation, oldest to newest:";

  const prompt = [
    ...instructions,
    "",
    "Facts the engine already extracted:",
    ...facts.map((fact) => `- ${fact}`),
    ...(lists.length > 0 ? ["", "What the transcript names, as the engine listed it:", wrap(lists.join("\n"), LISTS_LIMIT)] : []),
    "",
    "The person's first message:",
    wrap(goal, GOAL_LIMIT) || "(empty)",
    ...(summarySoFar !== undefined ? ["", summaryLabel, wrap(redactSecrets(summarySoFar), SUMMARY_LIMIT) || "(empty)"] : []),
    "",
    windowLabel,
    // The window was packed to `WINDOW_CHARS` by the plan; the wrapper's own cut only guards the
    // few characters its neutralizing may add.
    wrap(window, WINDOW_CHARS + 256, true) || "(nothing to show)",
  ].join("\n");

  return { system: SYSTEM, prompt, call, calls };
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

/* ── The brake ──────────────────────────────────────────────────────────────────────────────── */

export interface DigestBrake {
  /** The family's cap for today, and how many calls it already spent. */
  cap: number;
  spent: number;
  /** What the chain would take: `planDigest(...).calls`. */
  calls: number;
}

/**
 * The 429 body when the chain does not fit today, or nothing when it does. Two sentences, for
 * two cases a person acts on differently: nothing left (`api.handoffSpent`, as before the
 * chain), or something left but not enough for this conversation (`api.handoffNeeds`, with the
 * calls it needs and the calls left as fields beside the sentence, for a screen to paint).
 */
export function digestRefusal(locale: Locale, brake: DigestBrake): { error: string; hint: string; needs?: number; left?: number } | undefined {
  const left = Math.max(brake.cap - brake.spent, 0);
  if (left <= 0) {
    return { error: t(locale, "api.handoffSpent", { used: brake.spent, cap: brake.cap }), hint: t(locale, "api.handoffSpentHint") };
  }
  if (brake.spent + brake.calls > brake.cap) {
    return {
      error: t(locale, "api.handoffNeeds", { needs: brake.calls, left, cap: brake.cap }),
      hint: t(locale, "api.handoffNeedsHint"),
      needs: brake.calls,
      left,
    };
  }
  return undefined;
}

/* ── The paid half ──────────────────────────────────────────────────────────────────────────── */

export interface ModelDigestInput {
  conversation: Conversation;
  digest: Digest;
  /** The family's cap for today, and how many calls it already spent: the in-loop brake. */
  cap: number;
  spent: number;
  /** The plan the caller checked the cap against; planned here when absent, and the same plan either way. */
  plan?: DigestPlan;
  identity?: string | null;
}

export interface ModelDigestResult {
  digest: Digest;
  /** How many paid calls this took: one per window, plus one for each answer that was cut and asked again. */
  calls: number;
  /** The windows the plan had, and how many the chain read: fewer only when the in-loop brake stopped it. */
  windows: { planned: number; read: number };
  provider: string;
  model: string;
}

/**
 * The paid half. The caller checked the cap against the plan already and answers the 429; this
 * pays one call per window, writes a ledger row per call, retries a cut answer once at double
 * the room while the cap allows it beyond the windows still to read, and hands back the digest
 * with the last answer as its summary. A window whose answer said nothing readable leaves the
 * summary so far as it was. A model failure propagates: the route turns it into the 502 with
 * `modelErrorParts`; the rows of the calls that answered stay, because they were paid.
 */
export async function writeDigestWithModel(database: Database, input: ModelDigestInput): Promise<ModelDigestResult> {
  const plan = input.plan ?? planDigest(input.conversation, input.digest);
  let calls = input.spent;
  const ask = async (built: DigestPrompt, maxTokens: number) => {
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

  let summarySoFar = input.digest.summary !== undefined ? redactSecrets(input.digest.summary) : undefined;
  let last: { provider: string; model: string } | undefined;
  let read = 0;
  for (let index = 0; index < plan.windows.length; index += 1) {
    // The in-loop brake: never past the cap, whatever the pre-check saw.
    if (calls >= input.cap) break;
    const built = buildDigestPrompt(input.conversation, input.digest, {
      call: index + 1,
      calls: plan.calls,
      window: plan.windows[index]!,
      ...(summarySoFar !== undefined ? { summarySoFar } : {}),
    });
    let answer = await ask(built, MAX_DIGEST_TOKENS);
    const windowsLeft = plan.windows.length - index - 1;
    if (answer.stopReason === "length" && calls + windowsLeft < input.cap) {
      answer = await ask(built, MAX_DIGEST_TOKENS * 2);
    }
    read += 1;
    const parsed = parseDigestAnswer(answer.text);
    if (parsed !== undefined) summarySoFar = parsed;
    last = { provider: answer.provider, model: answer.model };
  }
  if (!last) throw new Error(`the handoff family has no call left today: ${input.spent} of ${input.cap} spent`);

  return {
    digest: withModelSummary(input.digest, summarySoFar ?? ""),
    calls: calls - input.spent,
    windows: { planned: plan.calls, read },
    provider: last.provider,
    model: last.model,
  };
}
