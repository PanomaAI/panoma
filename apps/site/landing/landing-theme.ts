/*
  The bridge for what is painted by hand, which does not know how to read a variable from CSS.
  The values live in `landing-theme.module.css` and from there they are taken by the sections
  without naming a color. But a 2D Canvas canvas does not consume variables: it receives strings.
  So here the token is resolved once and the palettes are assembled with transparency **outside
  the painting loop** — asking the browser for the color on each frame is a computed style read
  per particle and per frame, which is the most expensive way to find out something that has not
  changed.
  And if the token is missing it is thrown instead of continuing with an empty string:
  `rgba(, 0.4)` is not a color, it paints nothing and gives no error — the failure would appear as
  a swarm that ceased to exist, without a single clue as to why.
 */
export const LANDING_THEME_VAR = {
  ink: "--ink",
  particleRgb: "--particle-rgb",
} as const;

export function landingThemeValue(
  element: Element,
  variable: (typeof LANDING_THEME_VAR)[keyof typeof LANDING_THEME_VAR],
): string {
  const value = window.getComputedStyle(element).getPropertyValue(variable).trim();
  if (!value) throw new Error(`Falta el token del tema de la landing: ${variable}`);
  return value;
}

export function landingParticleColor(element: Element, alpha: number): string {
  const channels = landingThemeValue(element, LANDING_THEME_VAR.particleRgb);
  return `rgba(${channels}, ${Math.max(0, Math.min(1, alpha))})`;
}

export function landingParticlePalette(element: Element, levels = 10): string[] {
  return Array.from({ length: levels }, (_, level) =>
    landingParticleColor(element, level / levels),
  );
}
