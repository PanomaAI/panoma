import { t, type Locale } from "@/lib/i18n";

/**
 * The patch, which is the product of a proposal.
 *
 * A diff is read by color before by text: green for what comes in, red for what goes out, and the
 * rest in gray so it doesn't compete. Without this, the screen indicates that there was a change
 * but doesn't allow you to decide, which was exactly what was missing.
 */
export function Patch({ patch }: { patch: string }) {
  const lines = patch.split("\n");

  return (
    <div className="overflow-x-auto rounded-lg border border-edge bg-ground">
      <pre className="min-w-max py-2 font-mono text-[11px] leading-[1.6]">
        {lines.map((line, i) => {
          const style = line.startsWith("+++") || line.startsWith("---")
            ? "text-faint"
            : line.startsWith("@@")
              ? "bg-accent/10 text-accent"
              : line.startsWith("+")
                ? "bg-live/10 text-live"
                : line.startsWith("-")
                  ? "bg-fail/10 text-fail"
                  : line.startsWith("diff ") || line.startsWith("index ")
                    ? "text-faint"
                    : "text-smoke";
          return (
            <div key={i} className={`px-4 ${style}`}>
              {line || " "}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

interface Step {
  name: string;
  command: string;
  exitCode: number | null;
  durationMs: number;
  output?: string;
}

/** Each command executed, with its exit code and its actual output. */
export function Steps({ steps, locale }: { steps: Step[]; locale: Locale }) {
  return (
    <ul className="space-y-2">
      {steps.map((step, i) => {
        const ok = step.exitCode === 0;
        return (
          <li key={i} className="rounded-lg border border-edge bg-surface">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <span className={`font-mono text-xs ${ok ? "text-live" : "text-fail"}`}>
                {ok ? "✓" : "✗"}
              </span>
              <span className="text-xs font-semibold text-chalk">{step.name}</span>
              <code className="font-mono text-[11px] text-smoke">{step.command}</code>
              {step.durationMs > 0 && (
                <span className="ml-auto font-mono text-[11px] text-faint">
                  {(step.durationMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>
            {/*
               The output only displays when the step failed or when requested: pasting 16 KB of
               installation log in green does not help anyone.
              */}
            {step.output && step.output.trim() && (
              <details className="border-t border-edge" open={!ok}>
                <summary className="cursor-pointer px-4 py-2 font-mono text-[11px] text-faint hover:text-smoke">
                  {t(locale, "patch.output", { n: step.output.length })}
                </summary>
                <pre className="max-h-80 overflow-auto border-t border-edge bg-ground px-4 py-3 font-mono text-[11px] leading-relaxed text-smoke">
                  {step.output.trim()}
                </pre>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
