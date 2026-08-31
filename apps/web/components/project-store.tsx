"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import type { IconType } from "react-icons";
import {
  HiOutlineArrowUpRight,
  HiOutlineArrowUturnLeft,
  HiOutlineBars3,
  HiOutlineEye,
  HiOutlineShare,
  HiOutlineCloudArrowUp,
  HiOutlineEyeSlash,
  HiOutlineInboxArrowDown,
  HiOutlineSquares2X2,
  HiOutlineStar,
  HiOutlineXMark,
  HiStar,
} from "react-icons/hi2";
import {
  SiDart,
  SiDocker,
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
import { riskText, type MessageKey, type Translate } from "@/lib/i18n";
import { projectCategories, type Category } from "@/lib/categories";
import { Today, type ReportView } from "./today";
import { WatchWarning } from "./watch-warning";
import { Sites } from "./sites";
import { SharePanel, type PanoramaData } from "./share-panel";
import { useLocale, useT } from "./i18n-provider";
import { OpenMenu } from "./open-menu";
import { useSearch } from "./search-provider";
import { formatBytes, ProjectIcon, relativeDate } from "./primitives";
import { usePreference } from "./use-preference";
import { fold } from "@panoma/core/fold";

export type StoreProject = {
  id: string;
  name: string;
  slug: string;
  /** Where the folder lives. It is taught in shortened form; the original goes in the `title`. */
  root: string;
  sourceBytes: number;
  gitRemoteUrl: string | null;
  /** `false` if the folder is not under version control; `null` if it was not looked at. */
  gitVersioned: boolean | null;
  description: string | null;
  /** Where did the phrase come from: manifest, readme or composite. */
  summarySource: string | null;
  /** own · forked · foreign · template · signal-less */
  originKind: string | null;
  originStartedBy: string | null;
  hasIcon: boolean;
  primaryLanguage: string | null;
  healthScore: number;
  healthGrade: string;
  lastCommitAt: string | null;
  gitCommitCount: number | null;
  technologies: { id: string; name: string; kind: string; version: string | null }[];
  agents: { name: string; commits: number }[];
  copyCount: number;
  outdatedDeps: number;
  directDeps: number;
  vulnCount: number;
  /**
   * Which lockfile could not be read, or `null`. With this set, the two meters on top are zero
   * because they could not be queried, not because they are up to date.
   */
  depsUnresolved: string | null;
  state: "active" | "paused" | "dormant" | "no-git";
  /**
   * What is in the folder and is not safe. Empty if there is nothing or if git was not read.
   *
   * The code and the number arrive, not the sentence: the engine stopped writing when it saw that
   * the interface in English showed "without remote · 4 commits only on this disk." The sentence
   * is composed here with `riskText`, which is who knows in what language it is being written.
   */
  risks: { level: "high" | "medium" | "low"; code: string; count?: number }[];
  /**
   * Completed proposals of this project waiting for a human decision.
   *
   * Optional even though the cover already sent it: zero and 'I haven't asked' are rendered the
   * same — without a distinctive mark —, so the day another page sets up this catalog without
   * consulting it, the row stays silent instead of making up a number.
   */
  proposedRuns?: number;
  /** The subject of the last commit: the only sentence that answers 'what were you up to?'. */
  lastCommitSubject?: string | null;
};

type StoreStats = {
  projects: number;
  live: number;
  paused: number;
  dormant: number;
  noGit: number;
  copies: number;
  unsaved: number;
  noRemote: number;
  notMine: number;
};

type TechnologyMeta = { icon: IconType; color: string };

/*
  The brand colors remain even though the rest of the screen is ink on paper.
  They are not decoration: the blue of TypeScript and the green of Node are how a stack is
  recognized at a glance among forty lines, just like an app icon is recognized. What was turned
  off was the purple of the interface —buttons, selection, links—, which did compete.
 */
const TECHNOLOGY_ICONS: Record<string, TechnologyMeta> = {
  typescript: { icon: SiTypescript, color: "#3178c6" },
  "next.js": { icon: SiNextdotjs, color: "#111111" },
  nextjs: { icon: SiNextdotjs, color: "#111111" },
  react: { icon: SiReact, color: "#149eca" },
  flutter: { icon: SiFlutter, color: "#02569b" },
  dart: { icon: SiDart, color: "#0175c2" },
  "node.js": { icon: SiNodedotjs, color: "#5fa04e" },
  nodejs: { icon: SiNodedotjs, color: "#5fa04e" },
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
  supabase: { icon: SiSupabase, color: "#3ecf8e" },
  firebase: { icon: SiFirebase, color: "#ffca28" },
};

const FILTERS = [
  "all",
  "attention",
  "favorites",
  "not-mine",
  "web",
  "mobile",
  "backend",
  "tools",
  "ai",
  "other",
] as const;
type Filter = (typeof FILTERS)[number];

/*
  The values of `FILTERS` are identifiers, not text: they live in localStorage and in the logic of
  `projectCategory`. What is displayed comes from the dictionary, so the same filter is called
  "Herramientas" or "Tools" depending on the language without changing what is stored.
 */
const FILTER_LABELS: Record<Filter, MessageKey> = {
  all: "filter.all",
  attention: "filter.attention",
  favorites: "filter.favorites",
  "not-mine": "filter.notMine",
  web: "filter.web",
  mobile: "filter.mobile",
  backend: "filter.backend",
  tools: "filter.tools",
  ai: "filter.ai",
  other: "filter.other",
};

/** What a row needs to know, whether a line or an icon: both views are rendered the same. */
type RowProps = {
  project: StoreProject;
  index: number;
  selected: boolean;
  /** Yes, it is the one that enters the tab order. Only one is in the entire list. */
  tabbable: boolean;
  favorite: boolean;
  /** If your file is loading right now. See `openCard` in `ProjectStore`. */
  opening: boolean;
  /** No name and no icon, for screen sharing. See `discreet` on `ProjectStore`. */
  discreet: boolean;
  onSelect: () => void;
  onOpen: () => void;
};

/**
 * The handle to open.
 *
 * Double-clicking is not announced by itself on a website: there is no pointer that changes, no
 * underlining, and anyone who doesn't try it will never know it exists. This teaches it without
 * cluttering the view — it appears when you hover over it, when tabbing, and when the project is
 * selected, and the shortcut is indicated on its label. On a touchscreen, there is no "hovering"
 * or double-clicking, so there it is the only door: you tap once to select, and the handle appears
 * to enter.
 */
function OpenHandle({ name, onOpen }: { name: string; onOpen: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className="open-handle"
      title={t("catalog.openHandle", { name })}
      aria-label={t("catalog.openHandle", { name })}
      // Without this, the click goes up to the row and only selects it, which is the opposite of
      // what it asks.
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <HiOutlineArrowUpRight aria-hidden />
    </button>
  );
}

/** That something is happening while the token loads. See `openCard` in `ProjectStore`. */
function OpeningSpinner() {
  const t = useT();
  return <span className="opening-spinner" role="status" aria-label={t("catalog.opening")} />;
}

/**
 * Proposals awaiting decision, assuming the case that the data has not arrived.
 *
 * A single place where it is decided what 'does not come' means: if this were read separately in
 * five components, the day the field actually arrives there would be five places to check.
 */
function proposals(project: StoreProject): number {
  return project.proposedRuns ?? 0;
}

/**
 * A project requests review if it awaits a decision, if it could lose work, or if it carries
 * warnings.
 *
 * The first one is of a different kind than the rest: a vulnerability or an outdated dependency is
 * maintenance—they'll wait for you just as quietly next week—while a finished proposal is a
 * stopped agent. He did the work at night and can't continue without you; the cost of not looking
 * at it is not accumulated risk, it's completed work that goes unused.
 */
function needsAttention(project: StoreProject): boolean {
  return (
    proposals(project) > 0 ||
    project.risks.length > 0 ||
    project.vulnCount > 0 ||
    project.outdatedDeps > 0 ||
    /*
      The fact that it could not be looked at is a reason for attention in its own right. Without
      this line, a project whose lock cannot be read comes out with zero warnings and zero delays,
      and the "Attention" filter leaves it out: identical to a flawless one.
     */
    Boolean(project.depsUnresolved)
  );
}

/*
  Without accents, because nobody types them when looking for their own.
  `panoma open diseno` opened 'Web Design' from the terminal always; writing the same here found
  nothing. The recipe is in `@panoma/core/fold`, which is where it already lived — repeated five
  times — and now one lives there.
 */
function searchableText(project: StoreProject): string {
  return fold(
    [
      project.name,
      project.description,
      project.primaryLanguage,
      ...project.technologies.flatMap((technology) => [technology.name, technology.version]),
      ...project.agents.map((agent) => agent.name),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/** Three tones, the same thresholds that the engine uses to distribute the notes: A and B are fine. */
function healthTone(grade: string): "good" | "warn" | "bad" {
  if (grade === "A" || grade === "B") return "good";
  if (grade === "C") return "warn";
  return "bad";
}

/**
 * The route as it is read, not as it is saved.
 *
 * `/Users/who-sea/Dev/project` takes up half a column saying the same thing twice: that it is your
 * computer and that it is your folder. The accent is what is written in a terminal and what is
 * understood without reading. The original remains intact in `title` of the row.
 */
function shortPath(root: string): string {
  return root.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

/*
  Receive the translator instead of calling it: it is not a component and hooks cannot enter here.
  The real description —if the project has one— is shown exactly as it comes, in the language in
  which it is written: it is project data, not interface text.
 */
function projectDescription(project: StoreProject, t: Translate): string {
  if (project.description) return project.description;
  const primary = project.technologies.find(
    (technology) => technology.kind === "framework" || technology.kind === "language",
  );
  return primary ? t("store.builtWith", { tech: primary.name }) : t("store.detected");
}

export function ProjectStore({
  projects,
  report,
}: {
  projects: StoreProject[];
  stats: StoreStats;
  /** The day's report, which is rendered folded on top of the catalog. See `Today`. */
  report: ReportView;
}) {
  const router = useRouter();
  const t = useT();
  // Shared with the top bar box: a single state, two readers. Before they were two states and a
  // one-way event — see `search-provider.tsx`.
  const { query, setQuery } = useSearch();
  // Everything the user explicitly chooses is remembered. Previously, it was lost when browsing.
  const [stored, setFilter] = usePreference<Filter>("filter", "all", "filtro");
  /*
    A saved filter that no longer exists is ignored instead of emptying the catalog.
    The values of `FILTERS` changed from «Todos» to `all` when translating the project, and the
    saved preference survived the change with its old name: the catalog opened filtered by a
    category that does not exist, that is, with zero projects and without saying why. The same
    network applies to any filter that is removed in the future.
   */
  const filter: Filter = FILTERS.includes(stored) ? stored : "all";
  const [sort, setSort] = usePreference("sort", "recent", "orden");
  /*
    It opens in icons.
    It is the view of recognizing, and recognizing is the first thing you do upon arriving: you
    open the catalog knowing which one you are going to, not reading which is which. The list is
    one click away for when what is needed is to compare health, battery, and dates in a column.
   */
  const [view, setView] = usePreference<"grid" | "list">("view", "grid", "vista");
  /*
    Discreet mode: no names and no icons.
    To share your screen, record, or show this to someone without showing them what you're doing.
    It is remembered like the rest of the preferences, because whoever turns it on is usually in
    the middle of something, and turning it off again every time it reloads would be worse than
    not having it.
   */
  const [discreet, setDiscreet] = usePreference("discreet", false, "discreto");
  const [sharing, setSharing] = useState(false);
  const [favoriteIds, setFavoriteIds] = usePreference<string[]>("favorites", [], "favoritos");
  const favorites = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  /*
    Which project is open in the panel. It lives here and not in the row because the panel is one
    for the whole screen: if each row remembered if it is open, they would have to be turned off
    one by one, and a single failure would be enough to have two panels arguing.
    Start with the first slot, and not empty, because opening the panel takes 312 px away from the
    grid: with the panel closed, seven icons fit per row and with it open, five, so the first
    click would reorder the entire grid and the icon you were going to press was no longer where
    you left it. Starting with the panel open, the width never changes and pressing an icon only
    changes what the panel counts. At the same time, the panel explains itself: you can see what
    it's for before touching anything.
   */
  const [selectedId, setSelectedId] = useState<string | null>(projects[0]?.id ?? null);
  /*
    If the user has already chosen —or closed the panel— the correction below remains silent
    forever. Without this, closing the panel would reopen it in the same instant.
   */
  const touched = useRef(false);
  const rowsRef = useRef<HTMLDivElement>(null);
  /*
    What the server responds when hiding does not go well. Live here and not on the panel because
    the one making the call is this screen.
   */
  const [hideError, setHideError] = useState<string | null>(null);
  /*
    And what has just been hidden, which is what makes `/hidden` a place that one reaches.
    The sidebar does not show `/hidden` on purpose: it is not a section, it is a trusted trash
    'that is reached from where something is set aside' —according to `app-shell.tsx` —. It's just
    that it could not be reached from anywhere: hiding made the project disappear without saying
    where it went, and the only way was to know that ⌘K hides 'Hidden and Excluded'. For someone
    who doesn't know the palette, hiding was irreversible; exactly the opposite of a trash bin.
    The notice does not go away by itself with a timer. An output that expires in five seconds is
    an output for someone who already knew it was there.
   */
  const [justHidden, setJustHidden] = useState<{ id: string; name: string } | null>(null);

  /*
    The project to resume is the most recent one, nothing more. The query already arrives sorted
    by the date of the last commit.
   */
  const resume = projects[0];

  const attentionCount = useMemo(() => projects.filter(needsAttention).length, [projects]);
  const favoriteCount = useMemo(
    () => projects.filter((project) => favorites.has(project.id)).length,
    [favorites, projects],
  );

  const filtered = useMemo(() => {
    const normalizedQuery = fold(query.trim());
    const matches = projects.filter((project) => {
      const matchesQuery = !normalizedQuery || searchableText(project).includes(normalizedQuery);
      const matchesFilter =
        filter === "all"
          ? true
          : filter === "attention"
            ? needsAttention(project)
            : filter === "favorites"
              ? favorites.has(project.id)
              : filter === "not-mine"
                ? project.originKind === "foreign" ||
                  project.originKind === "forked" ||
                  project.originKind === "template"
                : projectCategories(project).has(filter as Category);
      return matchesQuery && matchesFilter;
    });

    return matches.sort((a, b) => {
      // Favorites first, always. Marking them has to serve for more than just drawing a star.
      const starred = Number(favorites.has(b.id)) - Number(favorites.has(a.id));
      if (starred !== 0) return starred;
      if (sort === "name") return a.name.localeCompare(b.name, "es");
      if (sort === "health") return b.healthScore - a.healthScore;
      return (
        (b.lastCommitAt ? Date.parse(b.lastCommitAt) : 0) -
        (a.lastCommitAt ? Date.parse(a.lastCommitAt) : 0)
      );
    });
  }, [favorites, filter, projects, query, sort]);

  /*
    The selected item is searched for in what is filtered, not in the entire catalog: if you
    change the filter and the open project no longer appears in the list, the panel closes by
    itself. An open panel on something that is not visible is a window to a place you can no
    longer return to.
   */
  const activeIndex = useMemo(
    () => filtered.findIndex((project) => project.id === selectedId),
    [filtered, selectedId],
  );
  const selected = activeIndex === -1 ? null : filtered[activeIndex];

  /*
    Reposition the boot selection when the list is not yet final.
    The initial state points to the first item in the catalog, which is the only thing known when
    rendering on the server. On the client, the saved preferences—filter, order, favorites—are
    read in an effect, so the list is reordered a moment later and that first item may stop being
    the first, or disappear. As long as no one has interacted with anything, the selection follows
    the first item of what is being viewed; as soon as it is touched, this no longer applies.
   */
  useEffect(() => {
    if (touched.current) return;
    const first = filtered[0];
    if (first && first.id !== selectedId) setSelectedId(first.id);
  }, [filtered, selectedId]);

  /** Choose by hand: turn off the correction above and move the panel. */
  const select = useCallback((id: string | null) => {
    touched.current = true;
    setSelectedId(id);
    setHideError(null);
  }, []);

  /*
    Open the tab, saying that it is being opened.
    `/p/[slug]` is rendered on the server with the database open, so between the double-click and
    the page change almost a second passes in which nothing happens: neither does the pointer
    change nor does the row notice. A double-click that does not respond is repeated, and
    repeating it on a grid that is already navigating is the easiest way to end up somewhere else.
    `useTransition` marks that gap —`pending` is true while React prepares the new page— and
    `openingId` says which of the thirty-six requested it, so that the signal goes above the one
    that was touched and not spread across the whole screen.
   */
  const [pending, startTransition] = useTransition();
  const [openingId, setOpeningId] = useState<string | null>(null);

  const openCard = useCallback(
    (project: StoreProject) => {
      setOpeningId(project.id);
      startTransition(() => router.push(`/p/${project.slug}`));
    },
    [router],
  );

  /** How many columns the grid is rendering right now, asking the browser. */
  const columnCount = useCallback(() => {
    const nodes = rowsRef.current?.querySelectorAll<HTMLElement>("[data-index]");
    const first = nodes?.[0];
    if (!first) return 1;
    const top = first.offsetTop;
    let columns = 0;
    for (const node of nodes) {
      if (node.offsetTop !== top) break;
      columns += 1;
    }
    return Math.max(1, columns);
  }, []);

  /*
    Move with the arrows.
    It is what separates a list that is looked at from a list that is used: with forty projects
    the hand should not leave the keyboard to go through them. The focus travels with the
    selection so that the panel and the screen reader report the same thing.
   */
  function move(delta: number) {
    if (filtered.length === 0) return;
    const current = filtered.findIndex((project) => project.id === selectedId);
    const next =
      current === -1 ? 0 : Math.min(filtered.length - 1, Math.max(0, current + delta));
    const target = filtered[next];
    if (!target) return;
    select(target.id);
    rowsRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus();
  }

  function onRowsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const columns = view === "grid" ? columnCount() : 1;
    const steps: Record<string, number> = {
      ArrowDown: columns,
      ArrowUp: -columns,
      ...(view === "grid" ? { ArrowRight: 1, ArrowLeft: -1 } : {}),
    };
    const step = steps[event.key];
    if (step !== undefined) {
      event.preventDefault();
      move(step);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      move(event.key === "Home" ? -filtered.length : filtered.length);
      return;
    }
    if (event.key === "Escape" && selectedId) {
      event.preventDefault();
      select(null);
    }
  }

  /*
    Hide from the catalog.
    Here there was a `.catch(() => undefined)` followed by a `router.refresh()`: whatever
    happened—server down, project that no longer exists, blocked database—the screen would reload
    as if it had worked, and the project remained where it was without anyone saying why. The same
    action from the record does give a warning (`project-actions.tsx`), so the same command lied
    or not depending on where it was requested from.
    Now the panel only closes if the server confirms. If not, it stays open with whatever the
    server has said: the project remains in view and the button stays where it was to try again.
   */
  async function hide(id: string) {
    setHideError(null);
    let response: Response;
    try {
      response = await fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ocultar", id }),
      });
    } catch {
      setHideError(t("project.unreachable"));
      return;
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setHideError(payload.error ?? t("project.actionFailed"));
      return;
    }
    if (selectedId === id) select(null);
    // The name is saved before the refresh: afterwards it is no longer on the list.
    setJustHidden({ id, name: projects.find((project) => project.id === id)?.name ?? "" });
    router.refresh();
  }

  /** Undo the last thing that was hidden, without having to go look for it. */
  async function unhide(id: string) {
    setHideError(null);
    try {
      const response = await fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mostrar", id }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setHideError(payload.error ?? t("project.actionFailed"));
        return;
      }
    } catch {
      setHideError(t("project.unreachable"));
      return;
    }
    setJustHidden(null);
    router.refresh();
  }

  function toggleFavorite(id: string) {
    setFavoriteIds(
      favorites.has(id) ? favoriteIds.filter((item) => item !== id) : [...favoriteIds, id],
    );
  }

  const filterCounts: Partial<Record<Filter, number>> = {
    attention: attentionCount,
    favorites: favoriteCount,
  };

  if (!resume) return null;

  /*
    The destination of the jump link goes here, and not in `page.tsx`.
    The cover has two branches: `EmptyState`, which renders its own `<main>` and if it had it, and
    this one, which is the one seen 99% of the time. Since the `skip-target.test.ts` scanner
    searched the string in the entire file, the empty branch responded for the full one and the
    most visited screen of the application was left without a destination for a day: the link
    would render, focus, and go nowhere.
   */
  return (
    <main id="app-main" tabIndex={-1} className="app-main catalog-screen">
      <div className="catalog-screen__inner">
        <Today report={report} />
        <WatchWarning />

        {justHidden && (
          <p className="brief brief--dismissed" role="status">
            <HiOutlineEyeSlash aria-hidden />
            <span>{t("store.justHidden", { name: justHidden.name })}</span>
            <button type="button" onClick={() => void unhide(justHidden.id)}>
              {t("store.undoHide")}
            </button>
            <Link href="/hidden">{t("store.seeHidden")}</Link>
          </p>
        )}

        <div className="catalog-bar">
          <h1>
            {t("catalog.title")}
            <span>
              {filtered.length === projects.length
                ? t(projects.length === 1 ? "catalog.countOne" : "catalog.count", {
                    n: projects.length,
                  })
                : `${filtered.length} / ${projects.length}`}
            </span>
          </h1>
          <div className="catalog-bar__tools">
            <p className="catalog-hint">{t("catalog.hint")}</p>
            <label className="catalog-sort">
              <span className="sr-only">{t("store.sortLabel")}</span>
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="recent">{t("store.sortRecent")}</option>
                <option value="name">{t("store.sortName")}</option>
                <option value="health">{t("store.sortHealth")}</option>
              </select>
            </label>
            <button
              type="button"
              className={`catalog-tool${discreet ? " is-active" : ""}`}
              onClick={() => setDiscreet(!discreet)}
              aria-pressed={discreet}
              title={t(discreet ? "store.showNames" : "store.hideNames")}
            >
              {discreet ? <HiOutlineEyeSlash aria-hidden /> : <HiOutlineEye aria-hidden />}
            </button>
            <button
              type="button"
              className="catalog-tool"
              onClick={() => setSharing(true)}
              aria-label={t("share.abrir")}
              title={t("share.abrir")}
            >
              <HiOutlineShare aria-hidden />
            </button>
            <div className="view-switch" role="group" aria-label={t("store.viewAria")}>
              <button
                type="button"
                onClick={() => setView("list")}
                className={view === "list" ? "is-active" : undefined}
                aria-label={t("store.viewList")}
                aria-pressed={view === "list"}
              >
                <HiOutlineBars3 aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setView("grid")}
                className={view === "grid" ? "is-active" : undefined}
                aria-label={t("store.viewGrid")}
                aria-pressed={view === "grid"}
              >
                <HiOutlineSquares2X2 aria-hidden />
              </button>
            </div>
          </div>
        </div>

        <div className="catalog-filters" role="group" aria-label={t("store.filterAria")}>
          {FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={filter === item ? "is-active" : undefined}
              aria-pressed={filter === item}
            >
              {t(FILTER_LABELS[item])}
              {filterCounts[item] ? <span>{filterCounts[item]}</span> : null}
            </button>
          ))}
        </div>

        <ResumeStrip
          project={resume}
          discreet={discreet}
          index={Math.max(0, projects.findIndex((project) => project.id === resume.id))}
        />
        {/*
           Below the filters and not at the very top: the question it answers —'are all my
           projects there?'— is asked after looking at the grid, not before.
          */}
        <Sites total={projects.length} />

        {sharing && (
          <SharePanel
            data={panorama(projects)}
            discreet={discreet}
            onClose={() => setSharing(false)}
          />
        )}

        <div className="catalog-split" data-open={selected ? "true" : "false"}>
          <div className="catalog-body">
            {filtered.length > 0 ? (
              <>
                {view === "list" && (
                  <div className="catalog-columns" aria-hidden>
                    <span>{t("catalog.colProject")}</span>
                    <span>{t("catalog.colHealth")}</span>
                    <span>{t("catalog.colStack")}</span>
                    <span>{t("catalog.colActivity")}</span>
                  </div>
                )}
                <div
                  ref={rowsRef}
                  role="listbox"
                  aria-label={t("catalog.rowsAria")}
                  className={`catalog-rows catalog-rows--${view}`}
                  onKeyDown={onRowsKeyDown}
                >
                  {filtered.map((project, index) => {
                    const common = {
                      project,
                      index,
                      selected: project.id === selectedId,
                      /*
                        Only one row enters the tab order: the chosen one, or the first one if
                        there is none. With the forty tab-able, exiting the catalog with the
                        keyboard required forty keystrokes — which is the reason this pattern
                        exists.
                       */
                      tabbable: index === (activeIndex === -1 ? 0 : activeIndex),
                      favorite: favorites.has(project.id),
                      opening: pending && openingId === project.id,
                      discreet,
                      onSelect: () => select(project.id),
                      onOpen: () => openCard(project),
                    };
                    return view === "list" ? (
                      <ProjectRow key={project.id} {...common} />
                    ) : (
                      <ProjectTile key={project.id} {...common} />
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="catalog-empty" role="status">
                <HiOutlineSquares2X2 aria-hidden />
                <h2>{t("store.noResults")}</h2>
                <p>{t("store.noResultsBody")}</p>
                <button
                  type="button"
                  onClick={() => {
                    setFilter("all");
                    setQuery("");
                    /*
                      And the URL with them, if it had a term.
                      The state clears immediately—the grid waits for no one—but leaving a `?q=`
                      hanging in the address bar would be the same discord as before with a
                      different face: refreshing would resurrect a filter that the user just
                      deleted. `replace` and not `push`: deleting a filter is not a place to
                      return to with Back.
                     */
                    if (window.location.search) router.replace("/", { scroll: false });
                  }}
                >
                  {t("store.clearFilters")}
                </button>
              </div>
            )}
          </div>

          {selected && (
            <DetailPanel
              key={selected.id}
              project={selected}
              discreet={discreet}
              index={Math.max(0, filtered.findIndex((project) => project.id === selected.id))}
              favorite={favorites.has(selected.id)}
              onFavorite={() => toggleFavorite(selected.id)}
              onHide={() => hide(selected.id)}
              onClose={() => select(null)}
              error={hideError}
            />
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * Resume, in one line.
 *
 * It was a three-hundred-pixel card with a storefront-sized icon, five metrics, and two buttons.
 * It said only one thing —"you were here yesterday"— and took up half of the first screen to say
 * it, so what it came to do, which is look at the catalog, started below the fold. Now it's a
 * line: where you left off, what you wrote in the last commit, and the button that takes you back
 * to the editor.
 */
function ResumeStrip({
  project,
  discreet,
  index,
}: {
  project: StoreProject;
  discreet: boolean;
  index: number;
}) {
  const t = useT();
  const locale = useLocale();
  const visibleName = discreet ? t("store.hidden", { n: index + 1 }) : project.name;
  return (
    <section className="resume-strip" aria-label={t("store.resume")}>
      <HiOutlineArrowUturnLeft aria-hidden />
      <p>
        <strong>{visibleName}</strong>
        {/*
           The commit subject is shown exactly as it was written: it is project text, not
           interface text, and translating it would be inventing it.
          */}
        <span>{project.lastCommitSubject || projectDescription(project, t)}</span>
      </p>
      <span className="resume-strip__when">{relativeDate(project.lastCommitAt, locale)}</span>
      {/*
         The same dropdown as the card, and not a standalone 'open in editor'.
         It used to show the generic verb and open the first editor it found: with Cursor and VS
         Code installed, you never knew which one would come up until it did. And it was the only
         door on the front page — to open in a terminal, in the folder, or in an agent, you had to
         enter the project, even if the list of sites was already calculated and in view two
         panels over. Now it says the name of the program and the arrow takes you to the rest,
         just like inside.
        */}
      <OpenMenu projectId={project.id} path={project.root} locale={locale} compact />
    </section>
  );
}

/**
 * A row of the catalog.
 *
 * One click selects and two open the record, so the row cannot be a link: a link navigates on the
 * first click and there would be no second. It is an option from a list —that is the role that
 * describes what it does— and the real link, the one that can be copied and opened in another tab,
 * lives in the details panel. `Enter` does the same as the double click.
 *
 * No action is shown in the row. Forty rows with star, eye, button, and link are one hundred sixty
 * things you can press by accident while looking for a name; actions are shown when a project is
 * selected, which is when they mean something.
 */
function ProjectRow({
  project,
  index,
  selected,
  tabbable,
  favorite,
  opening,
  discreet,
  onSelect,
  onOpen,
}: RowProps) {
  const t = useT();
  const locale = useLocale();
  const waiting = proposals(project);
  return (
    <div
      id={`catalog-${project.id}`}
      role="option"
      aria-selected={selected}
      aria-busy={opening}
      tabIndex={tabbable ? 0 : -1}
      data-index={index}
      className="catalog-row"
      title={discreet ? t("store.hidden", { n: index + 1 }) : project.root}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onOpen();
        }
        if (event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="catalog-row__identity">
        {discreet ? (
          <ConcealedProjectMark size="row" variant={index} />
        ) : (
          <ProjectIcon
            locale={locale}
            name={project.name}
            src={project.hasIcon ? `/icon/${project.id}` : null}
            size={40}
            tone="neutral"
          />
        )}
        <span className="catalog-row__names">
          <span className="catalog-row__name">
            <span>{discreet ? t("store.hidden", { n: index + 1 }) : project.name}</span>
            {favorite && <HiStar className="catalog-row__star" aria-hidden />}
            {/*
               The only two distinguishing features of the row, and both are of the same kind:
               things that do not wait. One is someone standing waiting for your response; the
               other, work that exists only on this disk. The whole number is said in the `title`
               and on the panel — in the row fits the fact, not the sentence.
              */}
            {waiting > 0 && (
              <span
                className="waiting-badge"
                title={t(
                  waiting === 1 ? "store.proposalsWaitingOne" : "store.proposalsWaitingMany",
                  { n: waiting },
                )}
              >
                <span aria-hidden>{waiting}</span>
                <span className="sr-only">
                  {t(
                    waiting === 1 ? "store.proposalsWaitingOne" : "store.proposalsWaitingMany",
                    { n: waiting },
                  )}
                </span>
              </span>
            )}
            {project.risks.length > 0 && (
              <HiOutlineCloudArrowUp
                className="risk-mark"
                title={project.risks.map((risk) => riskText(t, risk)).join(" · ")}
              />
            )}
          </span>
          {/*
             The path carries the name of the folder and that of the person who has it: subtly it
             reveals as much as the name itself.
            */}
          {!discreet && <span className="catalog-row__path">{shortPath(project.root)}</span>}
        </span>
      </span>
      <HealthDial score={project.healthScore} grade={project.healthGrade} />
      <StackMark technologies={project.technologies} />
      <span className="catalog-row__activity">
        <StateDot state={project.state} />
        {relativeDate(project.lastCommitAt, locale)}
      </span>
      <span className="catalog-row__handle">
        {opening ? (
          <OpeningSpinner />
        ) : (
          <OpenHandle
            name={discreet ? t("store.hidden", { n: index + 1 }) : project.name}
            onOpen={onOpen}
          />
        )}
      </span>
    </div>
  );
}

/** The same row in icon form: the view to recognize at a glance, not to read. */
function ProjectTile({
  project,
  index,
  selected,
  tabbable,
  favorite,
  opening,
  discreet,
  onSelect,
  onOpen,
}: RowProps) {
  const locale = useLocale();
  const t = useT();
  return (
    <div
      id={`catalog-${project.id}`}
      role="option"
      aria-selected={selected}
      aria-busy={opening}
      tabIndex={tabbable ? 0 : -1}
      data-index={index}
      className="catalog-tile"
      title={discreet ? t("store.hidden", { n: index + 1 }) : project.root}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onOpen();
        }
        if (event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <HealthDial score={project.healthScore} grade={project.healthGrade} />
      <span className="catalog-tile__handle">
        {opening ? (
          <OpeningSpinner />
        ) : (
          <OpenHandle
            name={discreet ? t("store.hidden", { n: index + 1 }) : project.name}
            onOpen={onOpen}
          />
        )}
      </span>
      {discreet ? (
        <ConcealedProjectMark size="tile" variant={index} />
      ) : (
        <ProjectIcon
          locale={locale}
          name={project.name}
          src={project.hasIcon ? `/icon/${project.id}` : null}
          size={54}
          tone="neutral"
        />
      )}
      <span className="catalog-tile__name">
        {favorite && <HiStar aria-hidden />}
        <span>{discreet ? t("store.hidden", { n: index + 1 }) : project.name}</span>
      </span>
      <span className="catalog-tile__meta">
        <StateDot state={project.state} />
        {relativeDate(project.lastCommitAt, locale)}
        {/*
           The cloud goes in both views, not just in the list.
           The one with icons is the one that appears by default and was exactly the one that gave
           no warning: the only place where 'this only exists on this disk' was seen was a strip
           above the catalog that talked about sixty-three projects at once, without saying which
           ones. A portfolio notice is no use for deciding about a project; on its card, yes.
          */}
        {project.risks.length > 0 && (
          <HiOutlineCloudArrowUp
            className="risk-mark"
            title={project.risks.map((risk) => riskText(t, risk)).join(" · ")}
          />
        )}
      </span>
    </div>
  );
}

/**
 * Private identity does not disappear nor imitate a logo: it remains sealed. The pattern is unique
 * to the interface and changes slightly by position, never based on the hidden image.
 */
function ConcealedProjectMark({
  size,
  variant,
}: {
  size: "row" | "tile";
  variant: number;
}) {
  return (
    <span
      className={`catalog-private-mark catalog-private-mark--${size}`}
      data-variant={variant % 4}
      aria-hidden
    >
      <span className="catalog-private-mark__seal" />
    </span>
  );
}

/**
 * Health, drawn.
 *
 * It is the only number that orders the catalog and the only place where color remains, so it
 * earns the drawing: a ring that fills up to where the note reaches. A single number is read one
 * by one; a ring is compared with the one above and the one below without reading any.
 */
function HealthDial({ score, grade }: { score: number; grade: string }) {
  const t = useT();
  const radius = 11;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * circumference;
  return (
    <span
      className={`health-dial health-dial--${healthTone(grade)}`}
      title={t("catalog.healthOf", { n: score })}
    >
      <svg viewBox="0 0 26 26" aria-hidden>
        <circle className="health-dial__track" cx="13" cy="13" r={radius} />
        <circle
          className="health-dial__arc"
          cx="13"
          cy="13"
          r={radius}
          strokeDasharray={`${filled} ${circumference}`}
        />
      </svg>
      <span>{score}</span>
    </span>
  );
}

/** The stack in one line: the brand icon and the name of the main thing that was detected. */
function StackMark({ technologies }: { technologies: StoreProject["technologies"] }) {
  const primary = technologies.find(
    (technology) => technology.kind === "framework" || technology.kind === "language",
  );
  if (!primary) return <span className="stack-mark stack-mark--empty">—</span>;
  const meta = TECHNOLOGY_ICONS[primary.name.toLowerCase()];
  const Icon = meta?.icon;
  return (
    <span className="stack-mark">
      {Icon ? <Icon aria-hidden style={{ color: meta.color }} /> : null}
      <span>{primary.name}</span>
    </span>
  );
}

/**
 * The status point.
 *
 * It carries the hidden word in addition to the color. Six green pixels are the whole signal that
 * a project is alive, and whoever cannot distinguish green from amber—or listens to the line
 * instead of seeing it—missed the full data. The `title` says it when hovering over it; the
 * `sr-only`, to whoever listens to it.
 */
function StateDot({ state }: { state: StoreProject["state"] }) {
  const t = useT();
  return (
    <span className={`state-dot state-dot--${state}`} title={t(stateKey(state))}>
      <span className="sr-only">{t(stateKey(state))}</span>
    </span>
  );
}

/**
 * Quick details: what is answered about a project without going into its file.
 *
 * It opens with one click and that is the whole promise — who it is, how it is, and where to enter
 * to work. What it asks to read slowly (dependencies, executions, history) remains in the record,
 * with a double click or at the link at the bottom, which is a real link and can be opened in
 * another tab.
 */
function DetailPanel({
  project,
  discreet,
  index,
  favorite,
  onFavorite,
  onHide,
  onClose,
  error,
}: {
  project: StoreProject;
  discreet: boolean;
  index: number;
  favorite: boolean;
  onFavorite: () => void;
  onHide: () => void;
  onClose: () => void;
  error: string | null;
}) {
  const t = useT();
  const locale = useLocale();
  const waiting = proposals(project);
  const tone = healthTone(project.healthGrade);
  const visibleName = discreet ? t("store.hidden", { n: index + 1 }) : project.name;
  const repository =
    project.gitVersioned === false
      ? t("catalog.noGit")
      : project.gitRemoteUrl
        ? t("catalog.remote")
        : t("catalog.localOnly");
  const origin =
    project.originKind === "foreign"
      ? t("origin.foreign")
      : project.originKind === "forked"
        ? t("origin.forked")
        : project.originKind === "template"
          ? t("origin.template")
          : null;

  return (
    <aside className="detail-panel" aria-label={t("catalog.detailsOf", { name: visibleName })}>
      <header className="detail-panel__head">
        {discreet ? (
          <ConcealedProjectMark size="row" variant={index} />
        ) : (
          <ProjectIcon
            locale={locale}
            name={project.name}
            src={project.hasIcon ? `/icon/${project.id}` : null}
            size={38}
            tone="neutral"
          />
        )}
        <div>
          <h2>{visibleName}</h2>
          {!discreet && <p title={project.root}>{shortPath(project.root)}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label={t("catalog.close")}>
          <HiOutlineXMark aria-hidden />
        </button>
      </header>

      {/*
         The main action lives where the decision is made: next to the identity, before reading
         metrics. The arrow retains all destinations without filling the button panel and shares
         the same preference as the 'Resume' strip.
        */}
      <div className="detail-panel__open">
        <OpenMenu projectId={project.id} path={project.root} locale={locale} />
      </div>

      <section className={`detail-health detail-health--${tone}`}>
        <p>
          <StateDot state={project.state} />
          {t("catalog.colHealth")}
        </p>
        <p className="detail-health__score">
          <strong>{project.healthScore}</strong>
          <span>/100</span>
        </p>
        <span className="detail-health__meter">
          <span style={{ width: `${Math.max(0, Math.min(100, project.healthScore))}%` }} />
        </span>
      </section>

      <dl className="detail-facts">
        <div>
          <dt>{t("catalog.colStack")}</dt>
          <dd>
            <StackMark technologies={project.technologies} />
          </dd>
        </div>
        <div>
          <dt>{t("catalog.colActivity")}</dt>
          <dd>{relativeDate(project.lastCommitAt, locale)}</dd>
        </div>
        <div>
          <dt>{t("catalog.commits")}</dt>
          <dd>{project.gitCommitCount ?? "—"}</dd>
        </div>
        <div>
          <dt>{t("catalog.repository")}</dt>
          <dd>{repository}</dd>
        </div>
        <div>
          <dt>{t("catalog.size")}</dt>
          <dd>{formatBytes(project.sourceBytes)}</dd>
        </div>
        {/*
           The origin only appears when it is not 'proper.'
           It is the answer for almost the entire catalog, and a piece of information that appears
           on all the sheets saying the same thing ceases to be information. Down here and only
           when it departs from the normal — which is exactly what was sought when asking where
           each thing came from.
          */}
        {origin && (
          <div>
            <dt>{t("catalog.origin")}</dt>
            <dd title={project.originStartedBy ?? undefined}>{origin}</dd>
          </div>
        )}
      </dl>

      {needsAttention(project) && (
        <section className="detail-review">
          <h3>{t("catalog.needsReview")}</h3>
          {/*
             The proposal comes first and is the only one with its own link: the other lines tell
             something that remains the same tomorrow, this one has someone waiting.
            */}
          {waiting > 0 && (
            <Link href={`/p/${project.slug}#propuestas`} className="detail-review__waiting">
              <HiOutlineInboxArrowDown aria-hidden />
              <span>
                {t(waiting === 1 ? "store.proposalsWaitingOne" : "store.proposalsWaitingMany", {
                  n: waiting,
                })}
              </span>
            </Link>
          )}
          {/*
             Every finding leads to where it is resolved.
             They were three lines of dead text: they said what was happening and left the reader
             looking for where to view it. A section called 'needs review' that offers no way to
             review is a sign, not a tool. The destinations are anchors of this project's record,
             not global pages: what one wants to see is the notice for *this* project, not the
             list of eighty.
            */}
          <ul>
            {project.risks.map((risk) => (
              <li key={risk.code} className="is-danger">
                <Link href={`/p/${project.slug}#unsaved`} title={t("catalog.reviewUnsaved")}>
                  {riskText(t, risk)}
                </Link>
              </li>
            ))}
            {project.vulnCount > 0 && (
              <li className="is-danger">
                <Link href={`/p/${project.slug}#security`} title={t("catalog.reviewSecurity")}>
                  {project.vulnCount === 1
                    ? t("store.noticeOne")
                    : t("store.noticesMany", { n: project.vulnCount })}
                </Link>
              </li>
            )}
            {project.outdatedDeps > 0 && (
              <li>
                <Link href={`/p/${project.slug}#dependencies`} title={t("catalog.reviewDeps")}>
                  {t("store.depsBehindRatio", {
                    n: project.outdatedDeps,
                    total: project.directDeps || 0,
                  })}
                </Link>
              </li>
            )}
            {project.depsUnresolved && (
              <li>
                <Link
                  href={`/p/${project.slug}#dependencies`}
                  title={t("project.depsUncheckedWhy", { file: project.depsUnresolved })}
                >
                  {t("store.depsUnchecked")}
                </Link>
              </li>
            )}
          </ul>
        </section>
      )}

      {error && (
        <p className="detail-panel__error" role="alert">
          {error}
        </p>
      )}

      <footer className="detail-panel__foot">
        <Link href={`/p/${project.slug}`}>
          {t("catalog.fullDetail")} <HiOutlineArrowUpRight aria-hidden />
        </Link>
        <div>
          <button
            type="button"
            onClick={onFavorite}
            aria-label={
              favorite
                ? t("store.favoriteRemove", { name: project.name })
                : t("store.favoriteAdd", { name: project.name })
            }
            aria-pressed={favorite}
          >
            {favorite ? <HiStar aria-hidden /> : <HiOutlineStar aria-hidden />}
          </button>
          {/*
             Hiding is indeed here; removing from the catalog, not. Hiding is an action on this
             screen and can be undone from 'Sections', so its place is on this screen. Removing is
             irreversible without rescanning: it lives in the record, where you have to enter
             deliberately.
            */}
          <button
            type="button"
            onClick={onHide}
            aria-label={t("store.hideNamed", { name: project.name })}
          >
            <HiOutlineEyeSlash aria-hidden />
          </button>
        </div>
      </footer>
    </aside>
  );
}

/** The internal state does not change language; its dictionary key does. */
function stateKey(state: StoreProject["state"]): MessageKey {
  return state === "active"
    ? "state.active"
    : state === "paused"
      ? "state.paused"
      : state === "dormant"
        ? "state.dormant"
        : "state.no-git";
}

/**
 * The numbers that summarize an entire portfolio on a card.
 *
 * They are calculated here, on what is already on the screen, and not on the server: this way what
 * is shared is exactly what is being seen —copies out, sections out— and not a second account that
 * might not match the one on the grid.
 */
function panorama(projects: StoreProject[]): PanoramaData {
  const commits = projects.reduce((sum, p) => sum + (p.gitCommitCount ?? 0), 0);
  const technologies = new Set(projects.flatMap((p) => p.technologies.map((tech) => tech.name)));

  /*
    Agent commits are added **from the same projects** as the total.
    The `agentCommits` in the catalog counts the entire portfolio, copies included, and here the
    denominator is only the visible ones. With forty-five copies of the same two apps, the
    numerator came from a much larger set than the denominator, and the card even ended up saying
    '100% written with agents' — a false figure, and one of those that are shared.
   */
  const byAgents = projects.reduce(
    (sum, p) => sum + p.agents.reduce((n, agent) => n + agent.commits, 0),
    0,
  );

  return {
    projects: projects.length,
    technologies: technologies.size,
    commits,
    // Without a history there is no percentage to give, and a 0% would say something false: it
    // would say that you did not work with agents, when what happens is that there is nothing to
    // measure. The cap at 100 is strict: a trailer signed twice cannot exceed the total.
    agents:
      commits > 0 && byAgents > 0 ? Math.min(100, Math.round((byAgents / commits) * 100)) : null,
    featuredProjects: projects
      .filter((p) => p.hasIcon)
      .slice(0, 8)
      .map((p) => ({
        name: p.name,
        health: p.healthScore,
        icon: `/icon/${p.id}`,
      })),
  };
}
