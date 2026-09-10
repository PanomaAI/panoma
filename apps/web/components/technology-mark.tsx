import type { IconType } from "react-icons";
import {
  SiAnthropic,
  SiDart,
  SiDocker,
  SiDrizzle,
  SiExpress,
  SiFirebase,
  SiFlutter,
  SiGo,
  SiKotlin,
  SiNextdotjs,
  SiNodedotjs,
  SiPhp,
  SiPostgresql,
  SiPython,
  SiReact,
  SiRuby,
  SiRust,
  SiSupabase,
  SiSvelte,
  SiSwift,
  SiTailwindcss,
  SiTypescript,
  SiVuedotjs,
} from "react-icons/si";

export type TechnologyMeta = { icon: IconType; color: string };

/**
 * Which mark a technology draws, and in what colour. One map, where there were two.
 *
 * `project-store.tsx` carried a second copy for the catalog's stack column, and by 8-Sep-2026 the
 * two had drifted: 21 keys in common, four unique to each side. The consequence was visible and
 * nobody had seen it, because seeing it means crossing two files — **anthropic** and **drizzle**
 * drew an icon on the project sheet and nothing at all in the catalog, and `nextjs`, `nodejs`,
 * `vue.js` and `tailwind` did the opposite. The 21 shared keys agreed on every colour, which is
 * the only reason the drift stayed silent instead of showing up as two different blues.
 *
 * The union is 29 keys. Both spellings of everything are kept on purpose: the engine writes a
 * technology's `name` from what it found in the project — `Next.js`, `nextjs` and `nextdotjs` all
 * arrive — and an icon that does not draw is not an error anybody sees.
 *
 * The brand colours stay even though the rest of the screen is ink on paper. They are not
 * decoration: the blue of TypeScript and the green of Node are how a stack is recognised at a
 * glance among forty lines, the same way an app icon is. What was turned off was the purple of
 * the interface — buttons, selection, links — which did compete.
 */
export const TECHNOLOGY_ICONS: Record<string, TechnologyMeta> = {
  anthropic: { icon: SiAnthropic, color: "#d97757" },
  typescript: { icon: SiTypescript, color: "#3178c6" },
  nextdotjs: { icon: SiNextdotjs, color: "#111111" },
  nextjs: { icon: SiNextdotjs, color: "#111111" },
  "next.js": { icon: SiNextdotjs, color: "#111111" },
  react: { icon: SiReact, color: "#149eca" },
  flutter: { icon: SiFlutter, color: "#02569b" },
  dart: { icon: SiDart, color: "#0175c2" },
  nodedotjs: { icon: SiNodedotjs, color: "#5fa04e" },
  nodejs: { icon: SiNodedotjs, color: "#5fa04e" },
  "node.js": { icon: SiNodedotjs, color: "#5fa04e" },
  python: { icon: SiPython, color: "#3776ab" },
  rust: { icon: SiRust, color: "#111111" },
  go: { icon: SiGo, color: "#00add8" },
  vue: { icon: SiVuedotjs, color: "#42b883" },
  "vue.js": { icon: SiVuedotjs, color: "#42b883" },
  svelte: { icon: SiSvelte, color: "#ff3e00" },
  swift: { icon: SiSwift, color: "#f05138" },
  kotlin: { icon: SiKotlin, color: "#7f52ff" },
  ruby: { icon: SiRuby, color: "#cc342d" },
  php: { icon: SiPhp, color: "#777bb4" },
  express: { icon: SiExpress, color: "#111111" },
  tailwind: { icon: SiTailwindcss, color: "#06b6d4" },
  tailwindcss: { icon: SiTailwindcss, color: "#06b6d4" },
  docker: { icon: SiDocker, color: "#2496ed" },
  postgresql: { icon: SiPostgresql, color: "#4169e1" },
  drizzle: { icon: SiDrizzle, color: "#c5f74f" },
  supabase: { icon: SiSupabase, color: "#3ecf8e" },
  firebase: { icon: SiFirebase, color: "#ffca28" },
};

/**
 * The lookup, so that the two callers cannot disagree about it either.
 *
 * The slug wins when the enricher supplied one, and the name is the fallback: the catalog has no
 * slug to give — `StoreProject["technologies"]` does not carry the field — so it asks by name and
 * gets whatever the union holds for it.
 */
export function technologyIcon(name: string, iconSlug?: string | null): TechnologyMeta | undefined {
  return TECHNOLOGY_ICONS[(iconSlug ?? name).toLowerCase()] ?? TECHNOLOGY_ICONS[name.toLowerCase()];
}

export function TechnologyMark({
  name,
  version,
  iconSlug,
  detail,
}: {
  name: string;
  version?: string | null;
  iconSlug?: string | null;
  detail?: string;
}) {
  const meta = technologyIcon(name, iconSlug);
  const Icon = meta?.icon;

  return (
    <span className="technology-mark" title={version ? `${name} ${version}` : name}>
      {Icon && <Icon aria-hidden style={{ color: meta.color }} />}
      <span>
        <strong>{name}</strong>
        {detail && <small>{detail}</small>}
      </span>
      {version && <code>{version}</code>}
    </span>
  );
}
