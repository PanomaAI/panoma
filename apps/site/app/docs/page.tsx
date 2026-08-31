import type { Metadata, Viewport } from "next";
import { DocsExperience } from "../../docs/docs-experience";
import { LANDING_COLOR_SCHEME, LANDING_THEME_COLOR } from "../../landing/color-theme";

/*
  `/docs` does not have a theme selector: it fixes `data-theme="light"` at its root, so the
  browser frame goes with the light paper and never changes.
 */
export const viewport: Viewport = {
  themeColor: LANDING_THEME_COLOR.light,
  colorScheme: LANDING_COLOR_SCHEME.light,
};

export const metadata: Metadata = {
  title: "Docs",
  description:
    "Install Panoma, start the local catalog, and connect agents. Commands match the shipped CLI.",
};

export default function DocsPage() {
  return <DocsExperience />;
}
