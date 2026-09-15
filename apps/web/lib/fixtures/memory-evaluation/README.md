# Frozen retrieval fixtures

The manifest freezes 32 development and 40 evaluation cases before the selector is exercised.
The two splits use different project contexts. Each case supplies source facts, a task and
withheld expected behavior. The loader never writes `expected`, the labels or the answer
requirement into memory. Fixing a loader to satisfy the database's provenance contract is not
changing an expected answer; changing a frozen fact or expectation requires a new corpus version.

Run from the repository root, after building the packages:

```sh
PANOMA_MEMORY_EVALUATION_REPORT=/absolute/path/report.json pnpm exec vitest run apps/web/lib/memory-corpus.test.ts apps/web/lib/memory-evaluation.test.ts
```

The integration runner calls `prepareMemory` and uses the contract's own continuation and full
read references. It tests archive retrieval beyond the recent rows, mixed-language identifiers,
project boundaries, unconfirmed extractions, expiration, unknown conditions and complete
exceptions. A common task budget charges complete serialized responses, including repeated
presentation text and metadata. Failed calls, repetitions and revalidation are covered by the
budget tests. Timing starts after fixture construction; this is a warm local service measurement,
not cold startup or maintenance cost.

The default offline counter is `utf8-byte-upper-bound-v1`: one accounting unit per UTF-8 byte.
It is deliberately stricter than usual model tokenization and is **not a provider token count**.
A response that exceeds the budget is reported as a failed budget, never silently truncated or
removed from the denominator. The budget object accepts a named tokenizer for the model pilot.

The report separates retrieval recall from required abstentions and reports false applications,
contract conformity and Wilson intervals. The cases use synthetic templates: their 72 IDs do not
establish 72 independent human decisions, and the intervals are descriptive only. No agent
answers are generated or judged here; this is not evidence for the plan's 38/40 answer threshold,
superiority to another system, or real-world response accuracy. That comparison still needs a
fixed model, its tokenizer, an equal baseline/context/output budget and independent answer
judgment. The 120-case generalization study and native-host reception pilot remain separate.
