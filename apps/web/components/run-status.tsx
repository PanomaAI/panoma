import { t, type Locale, type MessageKey } from "@/lib/i18n";
import { Tag, type TagTone } from "./primitives";

/*
  How a run ended, as one of the pill's tones.
  This was the third of the five colour maps that sat behind one word-pill, and four of its six
  entries move with the merge: `proposed`, `failed`, `running` and `applied` were a coloured border
  over `bg-raised` and now carry the hue's own tint at 10%, which is what every coloured pill in
  the app renders. `--color-fail` over its own 10% tint is, on top of that, the one pairing
  `contrast.test.ts` measures on every run — so the tinted form is also the measured one.
 */
const RUN_TONE: Record<string, TagTone> = {
  proposed: "live",
  failed: "fail",
  "no-changes": "quiet",
  running: "accent",
  applied: "live",
  discarded: "quiet",
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
      <Tag tone={RUN_TONE[status] ?? RUN_TONE["no-changes"]!} title={status}>
        {t(locale, `run.${status}` as MessageKey) ?? status}
      </Tag>
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
