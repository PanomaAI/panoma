"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { IconType } from "react-icons";
import {
  HiOutlineCircleStack,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineLink,
  HiOutlineComputerDesktop,
  HiOutlineCpuChip,
  HiOutlineCube,
  HiOutlineFingerPrint,
  HiOutlineKey,
  HiOutlineMagnifyingGlass,
  HiOutlinePlayCircle,
  HiOutlinePencilSquare,
  HiOutlineSignal,
  HiOutlineSquare2Stack,
  HiOutlineSquares2X2,
} from "react-icons/hi2";
import { LOCALE_COOKIE, type Locale, type MessageKey } from "@/lib/i18n";
import { CommandPalette } from "./command-palette";
import { useLocale, useT } from "./i18n-provider";
import { useSearch } from "./search-provider";
import { useDismissable } from "./use-dismissable";

export type ShellStats = {
  projects: number;
  /* The four states of `stateOf`, which add up to `projects`. See the breakdown below. */
  live: number;
  paused: number;
  dormant: number;
  noGit: number;
  /** Outside of `projects`, not inside. */
  copies: number;
  /** Projects with unsaved work. Absent if the page did not consult it. */
  unsaved?: number;
  /** Projects that you didn't start. */
  notMine?: number;
  /** Completed proposals waiting for human decision. */
  proposedRuns?: number;
};

type NavItem = {
  href: string;
  /** Dictionary key, not the text: the language is decided when rendering. */
  label: MessageKey;
  icon: IconType;
  exact?: boolean;
  /** `ShellStats` key whose value is displayed as a notice next to the name. */
  badge?: keyof ShellStats;
};

/*
  The order says what Panoma is for, so follow the pace at which each thing is used and not the
  order in which they were built.
  Above is what is seen every day —the catalog and what awaits a decision— and below are the
  diagnoses, which amaze on the first day and are then visited month by month. `/hidden` is not on
  the list: it is a trusted trash bin that is reached from where something is set aside, not a
  place you go to. It still has its URL and its page.
  "Home" and "Projects" were two entries for the same page—the second with an anchor that only
  scrolled down to the filters—and forced you to choose between two identical doors. Now there is
  one: the homepage *is* the catalog, so it is called by what it shows.
 */
const SIDEBAR_ITEMS: NavItem[] = [
  { href: "/", label: "nav.projects", icon: HiOutlineSquares2X2, exact: true },
  // The bridge right below the projects, and not at the end with the health screens: this is where
  // everything lights up, and what lights up cannot live where no one reaches.
  { href: "/bridge", label: "nav.bridge", icon: HiOutlineSignal },
  { href: "/runs", label: "nav.activity", icon: HiOutlinePlayCircle, badge: "proposedRuns" },
  { href: "/unsaved", label: "nav.unsaved", icon: HiOutlinePencilSquare, badge: "unsaved" },
  { href: "/agents", label: "nav.agents", icon: HiOutlineLink },
  { href: "/twin", label: "nav.twin", icon: HiOutlineFingerPrint },
  { href: "/ai", label: "nav.ai", icon: HiOutlineCpuChip },
  { href: "/packages", label: "nav.packages", icon: HiOutlineCube },
  { href: "/search", label: "nav.searchCode", icon: HiOutlineMagnifyingGlass },
  { href: "/credentials", label: "nav.credentials", icon: HiOutlineKey },
  { href: "/copies", label: "nav.copies", icon: HiOutlineSquare2Stack },
  { href: "/disk", label: "nav.disk", icon: HiOutlineCircleStack },
];

function routeIsActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname.startsWith(item.href);
}

/**
 * Where does the code for this live.
 *
 * A constant and not a translatable string: it is a URL, not a phrase. It lives here and not in
 * the dictionary for the same reason why commands are not translated either.
 */
const SOURCE_URL = "https://github.com/panomahq/panoma";

export function AppShell({ stats }: { stats?: ShellStats }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  // The term is not from this bar: it is from the screen, and `SearchProvider` keeps it. Here there
  // was a personal copy manually synchronized with the one on the grid, which is exactly what was
  // coming apart.
  const { query, setQuery } = useSearch();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useLayoutEffect(() => {
    if (window.localStorage.getItem("panoma-shell-sidebar") === "hidden") {
      setSidebarOpen(false);
    }
  }, []);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("sidebar-collapsed", !sidebarOpen);
    return () => document.documentElement.classList.remove("sidebar-collapsed");
  }, [sidebarOpen]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.documentElement.classList.add("sidebar-ready");
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.documentElement.classList.remove("sidebar-ready");
    };
  }, []);

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    router.push(params.size > 0 ? `/?${params.toString()}` : "/");
  }

  /*
    The language lives in a cookie and not in localStorage because the first rendering is done by
    the server: a preference that the server cannot read would be applied late, with half the
    interface flashing in the other language. One year of life — it is a preference, not a session
    — and `router.refresh()` so that the server tree repaints immediately.
   */
  function toggleSidebar() {
    setSidebarOpen((open) => {
      const next = !open;
      window.localStorage.setItem("panoma-shell-sidebar", next ? "open" : "hidden");
      return next;
    });
  }

  function switchLanguage(next: Locale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <>
      <CommandPalette />

      <header className="app-topbar">
        <div className="brand-cluster">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleSidebar}
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar"
            aria-label={t(sidebarOpen ? "shell.hideSidebar" : "shell.showSidebar")}
            title={t(sidebarOpen ? "shell.hideSidebar" : "shell.showSidebar")}
          >
            {/*
               Two arrows and not a hamburger: the hamburger promises a menu that is not on
               screen, and folded the bar is still there in the form of a track. What the button
               does is narrow it and widen it, and that is what it says.
              */}
            {sidebarOpen ? <HiOutlineChevronLeft aria-hidden /> : <HiOutlineChevronRight aria-hidden />}
          </button>
          <Link href="/" className="brand-lockup" aria-label={t("shell.brandHome")}>
            {/* eslint-disable-next-line @next/next/no-img-element -- asset local optimizado */}
            <img src="/assets/brand/panoma.svg" alt="" width={38} height={38} />
            <span>Panoma</span>
          </Link>
        </div>

        <form className="global-search" role="search" onSubmit={submitSearch}>
          <HiOutlineMagnifyingGlass aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("shell.searchPlaceholder")}
            aria-label={t("shell.searchPlaceholder")}
          />
          {/*
             The key was announced from the first day without doing anything. Now it opens the
             palette, and also when clicked with the mouse: if it is visible, it can be touched.
            */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("panoma:palette"))}
            aria-label={t("shell.openPalette")}
          >
            <kbd>⌘ K</kbd>
          </button>
        </form>

        {/*
           Here lived a second menu with three destinations —Explore, Agents, Packages— that were
           already all on the side. Two menus that lead to the same place force you to look at
           both to know where you are, and on top of that this one was highlighted incorrectly:
           'Explore' appeared lit on all pages because `/` is a prefix of any route. The top bar
           sticks to its own thing, which is searching.
          */}
        <AccountButton />
      </header>

      <aside id="app-sidebar" className="app-sidebar" aria-label={t("shell.sections")}>
        {/*
           Navigation and summary share the scrollable space. The footer is left out so that
           language, local promise, and source do not disappear in low-height windows.
          */}
        <div className="sidebar-scroll">
          <nav>
          {SIDEBAR_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = routeIsActive(pathname, item);
            const badge = item.badge ? stats?.[item.badge] : undefined;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={active ? "is-active" : undefined}
                /*
                  Folded, only the icon is visible, and an icon is guessed — it is not read. The
                  system label when hovered over is what makes the lane usable on the first day;
                  when expanded, it is unnecessary, because the name is written next to it.
                 */
                title={sidebarOpen ? undefined : t(item.label)}
              >
                <Icon aria-hidden />
                {/*
                   With class, and not a plain `<span>`, because the lane hides the name from CSS:
                   a rule that said 'all spans except the notice' would wipe out any other added
                   here —which is exactly what happened to the load turner.
                  */}
                <span className="nav-label">{t(item.label)}</span>
                {typeof badge === "number" && badge > 0 && (
                  <span className="nav-badge" aria-label={t("shell.pending", { n: badge })}>
                    {badge}
                  </span>
                )}
                <NavSpinner />
              </Link>
            );
          })}
          </nav>

          {stats && (
            <div className="catalog-summary" aria-label={t("shell.summary")}>
            <div className="catalog-summary__title">
              <HiOutlineSquares2X2 aria-hidden />
              <p>
                <strong>{t("shell.summaryProjects", { n: stats.projects })}</strong>
                <span>{t("shell.summaryScope")}</span>
              </p>
              {/*
                 The same data in a lane: just the figure, because "65 projects / in your catalog"
                 doesn't fit in 46 pixels nor split into two lines. `aria-hidden` goes there, and
                 the paragraph above hides in plain sight but not from the reader, so whoever
                 listens hears the whole sentence while the viewer sees the number —without
                 anyone getting both things.
                */}
              <strong
                className="catalog-summary__count"
                title={`${t("shell.summaryProjects", { n: stats.projects })} · ${t("shell.summaryScope")}`}
                aria-hidden
              >
                {stats.projects}
              </strong>
            </div>
            {/*
               The four states, and they add up to the total above.
               They were two and didn't add up: it showed «32 projects · 7 active · 15 dormant»
               —the ten on hold were missing, not appearing anywhere— and of those fifteen, only
               seven appeared when filtering the grid by dormant, because the query combined the
               dormant with the folders without a repository. A list that looks like a breakdown
               has to break down: if it doesn't add up, whoever reads it will be left searching
               for the rest.
               The copies go behind a line because **they are not in that sum**: the count above
               excludes them, so showing them in the same column made them seem like part of the
               32 when they are 44 separate.
              */}
            <dl>
              <SummaryRow label={t("shell.live")} value={stats.live} tone="live" />
              <SummaryRow label={t("shell.paused")} value={stats.paused} tone="paused" />
              <SummaryRow label={t("shell.dormant")} value={stats.dormant} tone="dormant" />
              <SummaryRow label={t("shell.noGit")} value={stats.noGit} tone="muted" />
            </dl>
            <dl className="catalog-summary__aside">
              <SummaryRow label={t("shell.copies")} value={stats.copies} tone="muted" />
            </dl>
            </div>
          )}
        </div>

        {/*
           On the same row as the slogan, not below it. The buttons say 'ES / EN' and not 'Español
           / English': someone looking to change the language recognizes the pair of abbreviations
           even if the interface is in the language they do not understand, which is exactly when
           they need it.
          */}
        <div className="sidebar-foot">
          {/*
             The link to the source, and it's not here out of courtesy.
             Panoma is AGPL-3.0, and its §13 requires offering the code **to anyone who uses the
             program over a network**. With the catalog in `localhost` that does not apply: there
             is only one user and nothing is transmitted. But `panoma up --network` opens it to
             the local network, and there anyone who opens it from another device is exactly that
             remote user — and until now the application did not link to its code from anywhere.
             It is always taught and not just in online mode: a condition that must be remembered
             to activate is a condition that one day is not activated. And saying what the program
             that teaches you what your projects are made of is made of is consistent.
            */}
          <p className="sidebar-update">
            <span>{t("shell.footerLocal")}</span>
            <span>{t("shell.footerPrivate")}</span>
            <a href={SOURCE_URL} target="_blank" rel="noreferrer">
              {t("shell.footerSource")}
            </a>
          </p>
          <div className="lang-toggle" role="group" aria-label={t("shell.language")}>
            <button
              type="button"
              onClick={() => switchLanguage("es")}
              className={locale === "es" ? "is-active" : undefined}
              aria-pressed={locale === "es"}
              title="Español"
            >
              ES
            </button>
            <button
              type="button"
              onClick={() => switchLanguage("en")}
              className={locale === "en" ? "is-active" : undefined}
              aria-pressed={locale === "en"}
              title="English"
            >
              EN
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

/**
 * The round button in the corner, which until today did nothing.
 *
 * It had an avatar, hand cursor, and `aria-label`, and no `onClick`. It's the same pattern as this
 * code criticizes two files beyond, on account of `⌘K` which was announced but didn't work: a
 * shortcut announced and not implemented teaches you not to trust the rest of the interface. And
 * here it was harder, because clicking the corner avatar is one of the most automatic gestures
 * there is — whoever clicks it is not exploring, they are looking for their account.
 *
 * The honest answer is that **there is no account**, and saying it is not filling in the gap: it
 * is the promise of the product. Panoma runs on your computer and the catalog does not leave it.
 *
 * And there is a second reason for the panel to exist, which is what makes it necessary rather
 * than just correct. The link to the source code —the one that AGPL-3.0 §13 requires to provide to
 * anyone using the program over a network— lived **only** in the footer of the sidebar, and that
 * footer disappears in two ways: by collapsing the bar (`sidebar-collapsed` leaves it in
 * `visibility: hidden` ) and, above all, **below 760px wide, where `.sidebar-foot` is
 * `display: none` and nothing more**. So anyone opening a `panoma up --network` from a mobile
 * device had no door to the source, neither collapsed nor uncollapsed. This button does not hide
 * at any size, so now it is always there.
 *
 * The "N" that was inside was from before the name change: the initial of a product that is no
 * longer called that, serving as the initial of an account that does not exist. A computer icon
 * says what the panel confirms — this is your machine, not your profile.
 */
function AccountButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  /*
    Closing when clicking outside is what the rest of the interface does, and this one did it
    differently: `mousedown` over `document` instead of `pointerdown` over `window`. With a stylus
    or a finger on a tablet, this panel would stay open when touching outside while the other
    three would close. Now all four share the hook.
    With Escape, moreover, the focus returns to the button: otherwise, someone navigating with the
    keyboard ends up in nothingness and has to go through the entire bar to return to where they
    were.
   */
  useDismissable(holder, open, (reason) => {
    setOpen(false);
    if (reason === "escape") button.current?.focus();
  });

  return (
    <div className="account-holder" ref={holder}>
      <button
        ref={button}
        type="button"
        className="account-button"
        aria-expanded={open}
        aria-label={t("shell.localAccount")}
        title={t("shell.localAccount")}
        onClick={() => setOpen((shown) => !shown)}
      >
        <HiOutlineComputerDesktop aria-hidden />
      </button>
      {open && (
        <div className="account-card" role="dialog" aria-label={t("shell.localAccount")}>
          <strong>{t("shell.footerLocal")}</strong>
          <p>{t("shell.accountNone")}</p>
          <a href={SOURCE_URL} target="_blank" rel="noreferrer">
            {t("shell.footerSource")}
          </a>
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "live" | "paused" | "dormant" | "muted";
}) {
  return (
    <div>
      {/*
         The sign is wrapped to be able to hide it in the lane and leave the figure: a loose text
         node cannot be selected from CSS. The `title` counts what the color dot keeps silent when
         the word is not there.
        */}
      <dt title={label}>
        <span className={`summary-dot summary-dot--${tone}`} aria-hidden />
        <span className="summary-figure">
          {value} <span className="summary-label">{label}</span>
        </span>
      </dt>
    </div>
  );
}

/**
 * The turner that appears in the link that was just clicked.
 *
 * Without this, pressing a section and seeing absolutely nothing for seconds reads like a broken
 * menu — which is exactly how it read. And the seconds are real: `panoma up` boots `next dev`,
 * which compiles each route the first time it is requested (three to five seconds); from then on
 * it drops to less than half. The menu isn't slow, it's that the page doesn't exist yet when you
 * request it.
 *
 * `useLinkStatus` only works inside a `<Link>`, which is why it is a separate component and not a
 * state of the frame: it is the link itself that knows if its navigation is in progress, and thus
 * the notice appears on the one you clicked and not on all of them.
 */
function NavSpinner() {
  const { pending } = useLinkStatus();
  return pending ? <span className="nav-pending" aria-hidden /> : null;
}
