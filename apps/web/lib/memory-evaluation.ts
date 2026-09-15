/** A task-wide account, shared by recovery, full reads, repetitions and revalidation. */
export interface EvaluationTokenizer {
  id: string;
  count(text: string): number;
}

/** Conservative offline accounting, not a provider's model token count. */
export const BYTE_TOKENIZER: EvaluationTokenizer = {
  id: "utf8-byte-upper-bound-v1",
  count: (text) => Buffer.byteLength(text, "utf8"),
};

export type EvaluationCall = "recovery" | "full_read" | "revalidation";
export interface EvaluationLimits { tokens: number; bytes: number; recovery: number; full_read: number; milliseconds: number }
export const EVALUATION_LIMITS: EvaluationLimits = { tokens: 8_000, bytes: 32 * 1024, recovery: 2, full_read: 4, milliseconds: 5_000 };

export class MemoryEvaluationBudget {
  readonly entries: { kind: EvaluationCall; bytes: number; tokens: number; failed: boolean; elapsedMs: number }[] = [];
  private readonly started: number;
  constructor(
    readonly tokenizer: EvaluationTokenizer,
    readonly limits: EvaluationLimits = EVALUATION_LIMITS,
    private readonly clock: () => number = () => performance.now(),
  ) { this.started = clock(); }

  get totals() {
    return {
      tokens: this.entries.reduce((sum, entry) => sum + entry.tokens, 0),
      bytes: this.entries.reduce((sum, entry) => sum + entry.bytes, 0),
      recovery: this.entries.filter((entry) => entry.kind === "recovery").length,
      full_read: this.entries.filter((entry) => entry.kind === "full_read").length,
      elapsedMs: this.clock() - this.started,
      failures: this.entries.filter((entry) => entry.failed).length,
    };
  }

  canCall(kind: EvaluationCall): boolean {
    const used = this.totals;
    return used.tokens < this.limits.tokens && used.bytes < this.limits.bytes && used.elapsedMs < this.limits.milliseconds
      && (kind === "revalidation" || used[kind] < this.limits[kind]);
  }

  /** Keep an oversized response in the account: an overrun is a failure, never hidden by trimming. */
  record(kind: EvaluationCall, serializedResponse: string, failed = false): void {
    this.entries.push({ kind, bytes: Buffer.byteLength(serializedResponse, "utf8"), tokens: this.tokenizer.count(serializedResponse), failed, elapsedMs: this.clock() - this.started });
  }

  get conforms(): boolean {
    const used = this.totals;
    return used.tokens <= this.limits.tokens && used.bytes <= this.limits.bytes && used.recovery <= this.limits.recovery
      && used.full_read <= this.limits.full_read && used.elapsedMs <= this.limits.milliseconds;
  }
}

/** An interrupted case remains in the denominator; a partial run never reports a pass. */
export function evaluationCoverage(expected: readonly { id: string }[], results: readonly { id: string; conformity: boolean }[]) {
  const completed = new Map(results.map((row) => [row.id, row]));
  const missingCases = expected.filter((row) => !completed.has(row.id)).map((row) => row.id);
  return {
    status: missingCases.length ? "incomplete" : expected.some((row) => !completed.get(row.id)?.conformity) ? "failed" : "passed",
    cases: expected.length,
    observedCases: expected.length - missingCases.length,
    missingCases,
  };
}

/** Wilson interval, reported alongside the numerator and denominator even for zero failures. */
export function proportion(successes: number, total: number) {
  if (!total) return { successes, total, rate: null, lower95: null, upper95: null };
  const z = 1.959963984540054;
  const p = successes / total;
  const scale = 1 + z * z / total;
  const middle = (p + z * z / (2 * total)) / scale;
  const width = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / scale;
  return { successes, total, rate: p, lower95: Math.max(0, middle - width), upper95: Math.min(1, middle + width) };
}
