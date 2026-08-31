import { t, type Locale, type MessageKey } from "@/lib/i18n";

const RUN_STYLE: Record<string, string> = {
  proposed: "text-live border-live/30",
  failed: "text-fail border-fail/30",
  "no-changes": "text-faint border-edge",
  running: "text-accent border-accent/30",
  applied: "text-live border-live/30",
  discarded: "text-faint border-edge",
};

/*
  The language is optional and Spanish by default, just like in `relativeDate`: the project sheet
  is already translated and goes through it, and the execution pages —which are still entirely in
  Spanish— call as usual and don’t change a single word. Translating this loose label there would
  leave an English phrase in the middle of a Spanish page, which is worse than not translating.
  What is rendered is the translated word, not the value. The value was rendered when the value was
  in Spanish and it was read just as well; as soon as the data moved to English, the label started
  to say 'failed' in the middle of a page in Spanish. The raw value, which is what the database
  stores and what the agent reads, remains in `title`: whoever is debugging has it a pointer away.
 */
export function RunStatusTag({
  status,
  verified,
  locale,
}: {
  status: string;
  verified?: boolean;
  locale: Locale;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`rounded border bg-raised px-1.5 py-0.5 font-mono text-[10px] ${
          RUN_STYLE[status] ?? RUN_STYLE["no-changes"]
        }`}
        title={status}
      >
        {t(locale, `run.${status}` as MessageKey) ?? status}
      </span>
      {status === "proposed" && (
        // The distinction is the product: a proposal without tests is not a verified proposal, and
        // mixing them would be exactly what makes a verifier useless.
        <span className={`font-mono text-[10px] ${verified ? "text-live" : "text-idle"}`}>
          {t(locale, verified ? "proposals.testsGreen" : "proposals.unverified")}
        </span>
      )}
    </span>
  );
}
