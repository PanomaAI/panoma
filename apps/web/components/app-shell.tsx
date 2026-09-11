"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { IconType } from "react-icons";
import {
  HiOutlineBanknotes,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineCodeBracket,
  HiOutlineCommandLine,
  HiOutlineLink,
  HiOutlineComputerDesktop,
  HiOutlineCpuChip,
  HiOutlineCube,
  HiOutlineFingerPrint,
  HiOutlineFolder,
  HiOutlineEllipsisHorizontal,
  HiOutlineKey,
  HiOutlineMagnifyingGlass,
  HiOutlinePlayCircle,
  HiOutlinePencilSquare,
  HiOutlineServer,
  HiOutlineSquare2Stack,
  HiOutlineSquares2X2,
} from "react-icons/hi2";
import { LOCALE_COOKIE, type Locale, type MessageKey } from "@/lib/i18n";
import { CommandPalette } from "./command-palette";
import { useCliName, useLocale, useT } from "./i18n-provider";
import { useSearch } from "./search-provider";
import { useDismissable } from "./use-dismissable";
import type { VersionNotice } from "@/lib/version-notice";

export type ShellStats = {
  projects: number;
  /* The four states of `stateOf`, which add up to `projects`. */
  live: number;
  paused: number;
  dormant: number;
  noGit: number;
  /** Outside of `projects`, not inside. */
  copies: number;
  /** Outside of `projects` too, and for the other reason: you set these aside yourself. */
  hidden: number;
  /** Projects with unsaved work. Absent if the page did not consult it. */
  unsaved?: number;
  /** Projects that you didn't start. */
  notMine?: number;
  /** Completed proposals waiting for human decision. */
  proposedRuns?: number;
  /**
   * Steps of the bridge that are not done yet.
   *
   * It rides in the frame and not on its own screen because that is the whole point: the bridge
   * exists to answer «what is missing for this to work», and it answered it only to whoever
   * already thought to go and ask. Quorum mining found a catalog with 76 projects, nine agent
   * tools built and zero usage — and the bridge had been written for exactly that person, sitting
   * one unvisited click away.
   */
  bridgePending?: number;
};

type NavItem = {
  href: string;
  /** Dictionary key, not the text: the language is decided when rendering. */
  label: MessageKey;
  icon: IconType;
  exact?: boolean;
  /** A visual pause between everyday work, connected tools, and catalog diagnostics. */
  groupStart?: boolean;
  /** `ShellStats` key whose value is displayed as a notice next to the name. */
  badge?: keyof ShellStats;
  /**
   * What that number is called out loud. Without this every notice was read as «3 pending», which
   * is true of proposals waiting for a decision and false of a setup that is unfinished: the two
   * ask opposite things of whoever hears them.
   */
  badgeLabel?: MessageKey;
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
/*
  How many sections fit in the mobile bar before «More» takes over. The number lives twice —here,
  and as `nth-child(n + 5)` in `responsive.css`, where the bar hides the rest— because CSS cannot
  read a constant. `styles.test.ts` compares the two, so moving one without the other fails
  instead of hiding a section from both places at once.
 */
export const MOBILE_NAV_ITEMS = 4;

const SIDEBAR_ITEMS: NavItem[] = [
  { href: "/", label: "nav.projects", icon: HiOutlineFolder, exact: true },
  // The bridge right below the projects, and not at the end with the health screens: this is where
  // everything lights up, and what lights up cannot live where no one reaches.
  {
    href: "/bridge",
    label: "nav.bridge",
    icon: HiOutlineLink,
    badge: "bridgePending",
    badgeLabel: "shell.setupLeft",
  },
  { href: "/spend", label: "nav.spend", icon: HiOutlineBanknotes },
  { href: "/runs", label: "nav.activity", icon: HiOutlinePlayCircle, badge: "proposedRuns" },
  { href: "/unsaved", label: "nav.unsaved", icon: HiOutlinePencilSquare, badge: "unsaved" },
  { href: "/agents", label: "nav.agents", icon: HiOutlineCommandLine, groupStart: true },
  { href: "/apps", label: "apps.title", icon: HiOutlineSquares2X2 },
  { href: "/twin", label: "nav.twin", icon: HiOutlineFingerPrint },
  { href: "/ai", label: "nav.ai", icon: HiOutlineCpuChip },
  { href: "/packages", label: "nav.packages", icon: HiOutlineCube, groupStart: true },
  { href: "/search", label: "nav.searchCode", icon: HiOutlineCodeBracket },
  { href: "/credentials", label: "nav.credentials", icon: HiOutlineKey },
  { href: "/copies", label: "nav.copies", icon: HiOutlineSquare2Stack },
  { href: "/disk", label: "nav.disk", icon: HiOutlineServer },
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
const SOURCE_URL = "https://github.com/PanomaAI/panoma";

export function AppShell({
  stats,
  ephemeral,
  notice,
  version,
}: {
  stats?: ShellStats;
  ephemeral?: boolean;
  /** What this catalog has to say about its own version, when it has anything to say. */
  notice?: VersionNotice;
  /**
   * The version that is serving this page, when the seal in `~/.panoma/web.json` describes this
   * very process. The notice above only speaks when there is news; the number itself was shown
   * nowhere, so a person who wanted to say which panoma they were on had no place to read it.
   */
  version?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  // The term is not from this bar: it is from the screen, and `SearchProvider` keeps it. Here there
  // was a personal copy manually synchronized with the one on the grid, which is exactly what was
  // coming apart.
  const { query, setQuery } = useSearch();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = SIDEBAR_ITEMS.slice(MOBILE_NAV_ITEMS).some((item) =>
    routeIsActive(pathname, item),
  );
  const sidebarRef = useRef<HTMLElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  useDismissable(sidebarRef, moreOpen, (reason) => {
    setMoreOpen(false);
    if (reason === "escape") moreButton.current?.focus();
  });
  useEffect(() => { setMoreOpen(false); }, [pathname]);

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

  function toggleSidebar() {
    setSidebarOpen((open) => {
      const next = !open;
      window.localStorage.setItem("panoma-shell-sidebar", next ? "open" : "hidden");
      return next;
    });
  }

  /* The server reads this cookie too, so refreshing keeps both rendered trees in one language. */
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
        <div className="topbar-actions">
          <div className="lang-toggle" role="group" aria-label={t("shell.language")}>
            <button
              type="button"
              onClick={() => switchLanguage("es")}
              className={locale === "es" ? "is-active" : undefined}
              aria-pressed={locale === "es"}
              aria-label="Español"
              lang="es"
              title="Español"
            >
              ES
            </button>
            <button
              type="button"
              onClick={() => switchLanguage("en")}
              className={locale === "en" ? "is-active" : undefined}
              aria-pressed={locale === "en"}
              aria-label="English"
              lang="en"
              title="English"
            >
              EN
            </button>
          </div>
          <AccountButton ephemeral={ephemeral} notice={notice} version={version} />
        </div>
      </header>

      <aside ref={sidebarRef} id="app-sidebar" className="app-sidebar" aria-label={t("shell.sections")}>
        {/*
           Navigation scrolls independently so the footer stays reachable in short windows.
          */}
        <div className="sidebar-scroll">
          <nav aria-label={t("shell.sections")}>
          {SIDEBAR_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = routeIsActive(pathname, item);
            const badge = item.badge ? stats?.[item.badge] : undefined;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={active ? "is-active" : undefined}
                aria-current={active ? "page" : undefined}
                data-group-start={item.groupStart || undefined}
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
                  <span className="nav-badge" aria-label={t(item.badgeLabel ?? "shell.pending", { n: badge })}>
                    {badge}
                  </span>
                )}
                <NavSpinner />
              </Link>
            );
          })}
          <button
            ref={moreButton}
            type="button"
            className={moreActive ? "mobile-more is-active" : "mobile-more"}
            aria-expanded={moreOpen}
            aria-controls="mobile-sections"
            onClick={() => setMoreOpen((shown) => !shown)}
            aria-label={t("apps.moreSections")}
          >
            <HiOutlineEllipsisHorizontal aria-hidden />
            <span>{t("apps.more")}</span>
          </button>
          </nav>
          {moreOpen && <div className="mobile-sections" id="mobile-sections">
            <p>{t("apps.moreSections")}</p>
            {SIDEBAR_ITEMS.slice(MOBILE_NAV_ITEMS).map((item) => {
              const Icon = item.icon;
              return <Link key={item.href} href={item.href} aria-current={routeIsActive(pathname, item) ? "page" : undefined}
                onClick={() => setMoreOpen(false)}><Icon aria-hidden /><span>{t(item.label)}</span></Link>;
            })}
          </div>}


        </div>

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
            {version && <span>{t("shell.version", { version })}</span>}
            <span>{t("shell.footerLocal")}</span>
            <span>{t("shell.footerPrivate")}</span>
            <a href={SOURCE_URL} target="_blank" rel="noreferrer">
              {t("shell.footerSource")}
            </a>
          </p>
        </div>
      </aside>
    </>
  );
}

/**
 * The installation button in the corner, which originally did nothing.
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
function AccountButton({ ephemeral, notice, version }: {
  ephemeral?: boolean; notice?: VersionNotice; version?: string;
}) {
  const t = useT();
  /* `panoma` or `npx panoma`, so the commands the panel hands out are the ones that work here. */
  const cli = useCliName();
  const label =
    notice === undefined
      ? "shell.localAccount"
      : notice.kind === "restart"
        ? "shell.localAccountRestart"
        : "shell.localAccountUpdate";
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
        /*
          The news is in the name and not only in the dot. A coloured dot says «something» to
          whoever can see it and nothing at all to whoever cannot, and this button is the only
          door to the panel that holds the sentence.
         */
        aria-label={t(label)}
        title={t(label)}
        onClick={() => setOpen((shown) => !shown)}
      >
        <HiOutlineComputerDesktop aria-hidden />
        {/*
           Only while there is something to say, like the counters on the bar: a permanent mark
           over a healthy state is furniture by the second day. It disappears on its own the moment
           you update or restart — nobody has to dismiss it.
          */}
        {notice && <span className="account-dot" aria-hidden />}
      </button>
      {open && (
        <div className="account-card" role="dialog" aria-label={t("shell.localAccount")}>
          <strong>{t("shell.footerLocal")}</strong>
          {version && <p>{t("shell.version", { version })}</p>}
          {/*
             What to do about the version, when there is something to do. Two pieces of news and
             never both: having already updated makes «update it» wrong, so the restart is the one
             that shows. Same anatomy as the temporary-copy block below, and for the same reason —
             it is news about this installation, not an alarm.
            */}
          {notice && (
            <p className="account-update">
              <strong>
                {notice.kind === "restart"
                  ? t("shell.restartReady", { running: notice.running })
                  : t("shell.updateReady", { latest: notice.latest })}
              </strong>
              <br />
              {notice.kind === "restart"
                ? t("shell.restartHave", { installed: notice.installed })
                : t("shell.updateHave", { running: notice.running })}
              <br />
              {notice.kind === "restart"
                ? t("shell.restartHow", { cli })
                : t(ephemeral ? "shell.updateHowNpx" : "shell.updateHowNpm", { cli })}
            </p>
          )}
          <p>{t("shell.accountNone")}</p>
          {/*
            Only when it is true, and inside the panel that already answers «what is this
            installation». Not a banner: nothing is wrong here, and a permanent warning over a
            healthy state is noise nobody reads by the second day.
           */}
          {ephemeral && (
            <p className="account-ephemeral">
              <strong>{t("shell.ephemeral")}</strong>
              <br />
              {t("shell.ephemeralDetail")}
            </p>
          )}
          <a href={SOURCE_URL} target="_blank" rel="noreferrer">
            {t("shell.footerSource")}
          </a>
        </div>
      )}
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
