import pc from "picocolors";
import type { Flags } from "./args";
import { catalogFetch } from "./catalog-fetch";
import { say, type MessageKey } from "./messages";
import { unreachable } from "./server";

/**
 * `panoma spend` — what the models cost today and over the last thirty days, and who holds each
 * organ back.
 *
 * It reads `GET /api/spend` and prints it; nothing is decided here. The caps, the rates and the
 * size a screenshot travels at are written on the `/spend` screen, and the last line of the output
 * says where that is. The same receipt the screen paints travels whole with `--json`, for a script
 * or for a person who wants the days and the models this terminal does not lay out.
 *
 * Read-only and through HTTP, like `north` and `disk`: the catalog is a single-writer PGlite and
 * the ledger is its table, so the CLI asks the server instead of opening the database.
 */

/** The five accounts plus the money, as `SpendTotals` in `apps/web/lib/spend-report.ts`. */
export interface SpendTotals {
  calls: number;
  input: number;
  output: number;
  unmetered: number;
  images: number;
  cost: number | null;
  priced: number;
  unpriced: number;
}

/**
 * The four accounts a line can carry under itself, as `SpendDetail` in `apps/web/lib/spend-view.ts`.
 *
 * They travelled in the answer from the first day and this terminal threw them away: it printed
 * «used of cap» per family and then one total for the whole day, which cannot answer what the look
 * costs. The look is the only organ that sends pixels, and the pixels are most of what it pays for.
 */
export interface SpendDetail {
  input: number;
  output: number;
  unmetered: number;
  images: number;
}

/** One family of the day, reduced to what this terminal prints. */
export interface SpendFamily extends SpendDetail {
  family: string;
  variable: string;
  used: number;
  cap: number;
  source: "paused" | "env" | "file" | "factory";
  factory: number;
  env?: string;
  envReadable?: boolean;
}

export interface SpendReply {
  paused: boolean;
  broken: boolean;
  currency: string;
  /** What the critic is shown, so the receipt says it instead of leaving it to be guessed. */
  shots: "full" | "fit";
  /** The long edge a fitted capture is cut to, in pixels. The catalog owns the number. */
  shotEdge: number;
  today: SpendTotals;
  month: SpendTotals;
  families: SpendFamily[];
  unbudgeted: ({ kind: string; calls: number } & SpendDetail)[];
}

export async function spendCommand(parsed: Flags): Promise<number> {
  let response: Response;
  try {
    response = await catalogFetch(new URL("/api/spend", parsed.api));
  } catch {
    return unreachable(parsed.api);
  }

  if (!response.ok) {
    process.stderr.write(
      pc.red(`${say("spend.rejected", { status: response.status, detail: await refusal(response) })}\n`),
    );
    return 1;
  }

  const reply = (await response.json()) as SpendReply;
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(reply, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`${spendLines(reply, parsed.api).join("\n")}\n`);
  return 0;
}

/**
 * The receipt, laid out. One line per family in the order the catalog sends them —which is the
 * order of `BUDGET_FAMILIES`—, then what no cap holds back, then the totals of the day and of the
 * window. Money only when a rate was written: a figure of zero for a day done through a session
 * agent would read as a free day, and it is an unpriced one.
 */
export function spendLines(reply: SpendReply, api: string): string[] {
  const lines = ["", `  ${pc.bold(say("spend.title"))}`, ""];
  if (reply.broken) lines.push(`  ${pc.yellow(say("spend.broken"))}`, "");
  if (reply.paused) lines.push(`  ${pc.yellow(say("spend.paused"))}`, "");

  lines.push(`  ${say("spend.today")}`);
  for (const family of reply.families) {
    lines.push(
      `      ${say("spend.family", { name: family.family, used: family.used, cap: family.cap, source: sourceOf(family) })}`,
    );
    const detail = detailOf(family);
    if (detail) lines.push(pc.dim(`          ${detail}`));
  }
  for (const line of reply.unbudgeted) {
    lines.push(`      ${say("spend.unbudgeted", { name: line.kind, n: line.calls })}`);
    const detail = detailOf(line);
    if (detail) lines.push(pc.dim(`          ${detail}`));
  }
  lines.push(pc.dim(`      ${shotLine(reply)}`));
  lines.push(...totalLines(reply.today, reply.currency, "spend.none", true));

  lines.push("", `  ${say("spend.month")}`);
  lines.push(...totalLines(reply.month, reply.currency, "spend.monthNone", false));

  lines.push("", pc.dim(`      ${say("spend.screen", { url: new URL("/spend", api).href })}`), "");
  return lines;
}

/**
 * What a family or a kind spent, under its own line: tokens always, and the other two only when
 * there are any. Nothing at all where there is nothing, so a family nobody called today keeps its
 * single line instead of growing a row of zeros.
 */
function detailOf(row: SpendDetail): string | null {
  const parts: string[] = [];
  if (row.input + row.output > 0) {
    parts.push(say("spend.tokens", { input: count(row.input), output: count(row.output) }));
  }
  if (row.unmetered > 0) parts.push(say("spend.unmetered", { n: row.unmetered }));
  if (row.images > 0) parts.push(say("spend.images", { n: row.images }));
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * How much of a capture the critic is shown.
 *
 * It is printed whichever the answer is, and not only when it is the reduced one, because the rule
 * this choice was built under is that panoma never shrinks an image without saying so — a receipt
 * that mentions the cut only when it happens teaches nobody that the cut exists. No token figure:
 * every provider counts the pixels of an image with its own arithmetic, which is why none travels
 * from the catalog either.
 */
function shotLine(reply: SpendReply): string {
  return reply.shots === "fit"
    ? say("spend.shotsFit", { n: count(reply.shotEdge) })
    : say("spend.shotsFull");
}

/** Who decided the cap, in the words of the dictionary. */
function sourceOf(family: SpendFamily): string {
  switch (family.source) {
    case "paused":
      return say("spend.source.paused");
    case "env":
      return family.envReadable === false
        ? say("spend.source.envUnread", { variable: family.variable })
        : say("spend.source.env", { variable: family.variable });
    case "file":
      return say("spend.source.file");
    default:
      return say("spend.source.factory");
  }
}

/**
 * The totals of a window, in two lines at most: the accounts, then the money. The hint about
 * writing a rate goes only under the day, so it is not read twice.
 */
function totalLines(totals: SpendTotals, currency: string, emptyKey: MessageKey, hint: boolean): string[] {
  if (totals.calls === 0) return [`      ${pc.dim(say(emptyKey))}`];

  const parts = [say("spend.calls", { n: totals.calls })];
  if (totals.input + totals.output > 0) {
    parts.push(say("spend.tokens", { input: count(totals.input), output: count(totals.output) }));
  }
  if (totals.unmetered > 0) parts.push(say("spend.unmetered", { n: totals.unmetered }));
  if (totals.images > 0) parts.push(say("spend.images", { n: totals.images }));
  const lines = [`      ${parts.join(" · ")}`];

  if (totals.cost !== null) {
    const money = [say("spend.cost", { money: formatMoney(totals.cost, currency) })];
    if (totals.unpriced > 0) money.push(say("spend.unpriced", { n: totals.unpriced }));
    lines.push(`      ${money.join(" · ")}`);
  } else if (hint) {
    lines.push(`      ${pc.dim(say("spend.noRate"))}`);
  }
  return lines;
}

/** A token count with its thousands separated, in the only language this terminal speaks. */
function count(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

/**
 * Money with up to four decimals: a day of small calls is a fraction of a cent, and rounding it
 * to «0.01» would round the only figure the person came to read. A currency code `Intl` refuses
 * falls to the plain figure with the code behind it.
 */
export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** The catalog's «no», read the two ways it can be said. Same squashing as `refusalOf` in `twin-command.ts`. */
async function refusal(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object") {
      const { error } = parsed as { error?: unknown };
      if (typeof error === "string") return error;
    }
  } catch {
    // It wasn't JSON. The raw text works just the same, and crushed it fits on one line.
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}
