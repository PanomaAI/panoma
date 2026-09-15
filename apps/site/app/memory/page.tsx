import type { Metadata, Viewport } from "next";
import { LANDING_COLOR_SCHEME, LANDING_THEME_COLOR } from "../../landing/color-theme";
import { getLocale } from "../../lib/locale";
import { MemoryStory } from "../../memory/memory-story";

/*
  `/memory` is set like `/docs`: light paper fixed at the root, so the browser frame never
  changes with the landing's theme button.
 */
export const viewport: Viewport = {
  themeColor: LANDING_THEME_COLOR.light,
  colorScheme: LANDING_COLOR_SCHEME.light,
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return locale === "es"
    ? {
        title: "La memoria, paso a paso",
        description:
          "Cómo una frase tuya se convierte en una regla que todos tus agentes reciben, y cómo panoma comprueba que la recibieron. Contado sencillo o técnico.",
      }
    : {
        title: "The memory, step by step",
        description:
          "How a sentence of yours becomes a rule every one of your agents receives, and how panoma checks that they received it. Told plainly or technically.",
      };
}

export default async function MemoryPage() {
  const locale = await getLocale();
  return <MemoryStory locale={locale} />;
}
