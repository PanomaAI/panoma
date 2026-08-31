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

type TechnologyMeta = { icon: IconType; color: string };

const TECHNOLOGY_ICONS: Record<string, TechnologyMeta> = {
  anthropic: { icon: SiAnthropic, color: "#d97757" },
  typescript: { icon: SiTypescript, color: "#3178c6" },
  nextdotjs: { icon: SiNextdotjs, color: "#111111" },
  "next.js": { icon: SiNextdotjs, color: "#111111" },
  react: { icon: SiReact, color: "#149eca" },
  flutter: { icon: SiFlutter, color: "#02569b" },
  dart: { icon: SiDart, color: "#0175c2" },
  nodedotjs: { icon: SiNodedotjs, color: "#5fa04e" },
  "node.js": { icon: SiNodedotjs, color: "#5fa04e" },
  python: { icon: SiPython, color: "#3776ab" },
  rust: { icon: SiRust, color: "#111111" },
  go: { icon: SiGo, color: "#00add8" },
  vue: { icon: SiVuedotjs, color: "#42b883" },
  svelte: { icon: SiSvelte, color: "#ff3e00" },
  swift: { icon: SiSwift, color: "#f05138" },
  kotlin: { icon: SiKotlin, color: "#7f52ff" },
  ruby: { icon: SiRuby, color: "#cc342d" },
  php: { icon: SiPhp, color: "#777bb4" },
  express: { icon: SiExpress, color: "#111111" },
  tailwindcss: { icon: SiTailwindcss, color: "#06b6d4" },
  docker: { icon: SiDocker, color: "#2496ed" },
  postgresql: { icon: SiPostgresql, color: "#4169e1" },
  drizzle: { icon: SiDrizzle, color: "#c5f74f" },
  supabase: { icon: SiSupabase, color: "#3ecf8e" },
  firebase: { icon: SiFirebase, color: "#ffca28" },
};

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
  const key = (iconSlug ?? name).toLowerCase();
  const meta = TECHNOLOGY_ICONS[key] ?? TECHNOLOGY_ICONS[name.toLowerCase()];
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
