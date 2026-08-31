"use client";

import { useLocale, useT } from "./i18n-provider";

/**
 * “Written in English,” and only when that is not what you are reading.
 *
 * Almost everything that Panoma teaches follows the reader: it comes out of the dictionary and is
 * displayed in the language requested by the browser. The two texts that a model writes—the
 * project description and the opinion on the instruction file—cannot. They were requested once,
 * cost a paid call, and were saved in the database: translating them on the fly would be asking
 * and paying again.
 *
 * What can be done is not to pretend. Until 25-Aug-2026 the prompt fixed plain Spanish, so a card
 * in English would show a paragraph in Spanish as if it were its own. Now the model writes in the
 * language of the person asking, and what happened before carries this mark.
 *
 * It goes in the line of the signature, next to the model and the date, because there is also the
 * rewrite button there: the notice and its remedy a finger away.
 */

/** Language names live in the dictionary, like everything a person reads. */
const NAME = { es: "lang.es", en: "lang.en" } as const;

export function WrittenIn({ lang }: { lang: string | null | undefined }) {
  const translate = useT();
  const locale = useLocale();

  /*
    Null is not 'unknown': it is 'it was saved before this column existed,' and so the prompt set
    Spanish without looking at anyone. So null is Spanish, and saying it is more honest than
    staying silent — it is precisely the text that caused all of this.
   */
  const written = lang === "en" ? "en" : "es";
  if (written === locale) return null;

  return <span>{translate("project.aiWrittenIn", { lang: translate(NAME[written]) })}</span>;
}
