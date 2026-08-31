/**
 * What theme the landing depicts, and in what order one goes from one to another.
 *
 * Live apart from `landing-experience.tsx` because both sides need it: the page
 * (`app/page.tsx`), which is a server component and decides the initial topic before
 * send nothing, and the experience, which is an entire client and changes it with the button.
 * Taking it out here prevents a server component from having to import from a `"use client"`
 * module to read a constant, and leaves the test next to what it tests.
 *
 * Do not confuse with `landing-theme.ts`, which is the bridge for reading tokens from CSS from the
 * swarm canvas. That one resolves colors; this one decides which of the three maps is used.
 */
export type LandingColorTheme = "light" | "dark" | "gold";

/**
 * The clearing is the theme of the house.
 *
 * The landing was painted light first, the dark one took the defect on August 27, 2026, and on the
 * 28th the light one returned. The back-and-forth is noted because the decision is the page
 * owner's, and nothing written here implies otherwise: whoever comes to 'fix' this thinking that
 * the dark one matches better with a six-panel instrument should know that it has already been
 * tried.
 *
 * Being the default value has a consequence that is worth seeing written down: it is the layer
 * that takes the first painting of the server, so it is the only one that **never** blinks. And it
 * is the only one that does not need `?theme=` in the address, so it is the one seen by anyone who
 * arrives via a clean link.
 */
export const LANDING_DEFAULT_THEME: LandingColorTheme = "light";

/**
 * The return: `light → dark → gold → light`.
 *
 * The first click leads to the maximum contrast with what is being seen, which now is the dark.
 * Gold comes third because it is an author's reading and not a system preference: whoever wants it
 * looks for it, and putting it in the middle would force crossing it to return home.
 */
export function nextLandingTheme(current: LandingColorTheme): LandingColorTheme {
  if (current === "light") return "dark";
  if (current === "dark") return "gold";
  return "light";
}

/**
 * The subject that the management requests, if it requests a valid one.
 *
 * `?theme=` exists to be able to link a specific reading —a capture, a slide from the launch kit—
 * without touching anyone's cookie. Anything else falls into the home one: an invented value is
 * not a reason not to render the page.
 */
export function landingThemeFromParam(value: string | undefined): LandingColorTheme {
  if (value === "light" || value === "dark" || value === "gold") return value;
  return LANDING_DEFAULT_THEME;
}

/**
 * The role of each theme, for the browser bar.
 *
 * It is what goes in `<meta name="theme-color">`: on a phone, the address bar and the status bar
 * are tinted with that color. Without it, they remain the factory gray, and the frame is not from
 * the theme — two foreign stripes at the top and bottom, which with the dark or gold ones applied
 * is what stands out most on this page on a mobile.
 *
 * With a limit that is good to know before debugging anything with an iPhone nearby: iOS 26 Safari
 * (Liquid Glass) ignores this tag by design and colors its frame by sampling the painted
 * background. There, the same color comes through two other ways that say the same thing: the
 * `body:has()` from `site.css` and the `frameTint*` strips from the landing. The tag still remains
 * the way for Safari 15–18, Chrome and Edge on Android with the system in light mode, and Samsung
 * Internet in light mode — and it costs nothing to maintain it telling the truth.
 *
 * They are the values of `--paper` from `landing-theme.module.css`, copied by hand. There is no
 * way to avoid it: the server has to decide the color, before there is a document to ask a custom
 * property. That they do not get out of sync is monitored by `color-theme.test.ts`, which reads
 * both sources and compares them.
 *
 * The paper goes and not the color of the glued strip, even if it is the strip that remains under
 * the frame: that is `--paper-a-90` over the page, that is, the same paper with a veil. Using pure
 * paper is what makes the edge between the browser and the page disappear.
 */
export const LANDING_THEME_COLOR: Record<LandingColorTheme, string> = {
  light: "#fafafa",
  dark: "#0a0a0a",
  gold: "#d2bd7f",
};

/**
 * The color scheme of each theme, for the browser.
 *
 * It's what goes in `<meta name="color-scheme">`, and it's not the same as `theme-color`: that one
 * tells you what color to paint the frame, and this one tells the browser **what mode the page is
 * in**. From there it gets the colors of its own controls, the scroll bars, and, in several
 * browsers, whether the frame is light or dark.
 *
 * The server declares it for a reason of order, not of preference: until now this only existed in
 * CSS —`html { color-scheme: light }` by default, and the dark one coming later via
 * `html:has([data-theme="dark"])` —, and that `:has()` requires that the element with the
 * attribute already exists in the document. The browser decides how to render its frame before
 * that, so the first response was saying "sure". In a tag, it goes in the first byte and does not
 * depend on the body having arrived.
 *
 * Gold is a CLEAR topic even though its role is golden: this is declared by
 * `landing-theme.module.css`, and that is why its native controls are in clear.
 * `color-theme.test.ts` compares the three against that sheet.
 */
export const LANDING_COLOR_SCHEME: Record<LandingColorTheme, "light" | "dark"> = {
  light: "light",
  dark: "dark",
  gold: "light",
};
