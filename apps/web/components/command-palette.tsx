"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HiOutlineArchiveBox,
  HiOutlineArrowTopRightOnSquare,
  HiOutlineCircleStack,
  HiOutlineCodeBracketSquare,
  HiOutlineCommandLine,
  HiOutlineCpuChip,
  HiOutlineCube,
  HiOutlineEye,
  HiOutlineFingerPrint,
  HiOutlineFolderOpen,
  HiOutlineKey,
  HiOutlineMagnifyingGlass,
  HiOutlinePlayCircle,
  HiOutlineLink,
  HiOutlinePencilSquare,
  HiOutlineSignal,
  HiOutlineSquare2Stack,
  HiOutlineSquares2X2,
} from "react-icons/hi2";
import type { IconType } from "react-icons";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "./i18n-provider";
import { useOpenTarget } from "./use-open-target";
import { useFocusTrap } from "./use-focus-trap";
import { fold } from "@panoma/core/fold";

/**
 * Command palette (⌘K).
 *
 * The search bar displayed a `⌘ K` key from day one and nothing happened when pressing it. An
 * advertised but unimplemented shortcut is worse than none: it teaches not to trust the rest of
 * the interface.
 *
 * With eighty projects, typing the name is faster than recognizing an icon in a grid, and the
 * catalog loads only once —when opening the palette for the first time— so that the list is
 * instant from then on.
 *
 * And ↵ **opens the editor**, not a page. The actual time to go from opening Panoma to working was
 * measured: about ten seconds, two clicks, and two loads, compared to five seconds for `cd` and
 * `code .` on a terminal. Everything that the palette saved was returned on the last screen. Now
 * ⌘K, three letters, and ↵ are a gesture that ends in the editor.
 */

type Project = {
  id: string;
  name: string;
  slug: string;
  root: string;
  hasIcon: boolean;
  language: string | null;
  state: "active" | "paused" | "dormant" | "no-git";
  copyOf: string | null;
};

type Command = {
  key: string;
  label: string;
  hint?: string;
  /** What it does ↵ here. It is only rendered in the indicated row, which is where it matters. */
  enter?: string;
  icon: IconType;
  /** Dictionary key: the header is translated when printing, the grouping does not change. */
  group: "palette.groupProjects" | "palette.groupActions" | "palette.groupGoTo";
  run: () => void | Promise<void>;
};

/** Projects that fit on the list before it stops being read at a glance. */
const MAX_PROJECTS = 8;

const DESTINATIONS: { href: string; label: MessageKey; icon: IconType }[] = [
  { href: "/", label: "nav.projects", icon: HiOutlineSquares2X2 },
  { href: "/bridge", label: "dest.bridge", icon: HiOutlineSignal },
  { href: "/unsaved", label: "dest.unsaved", icon: HiOutlinePencilSquare },
  { href: "/disk", label: "dest.disk", icon: HiOutlineCircleStack },
  { href: "/search", label: "dest.searchCode", icon: HiOutlineMagnifyingGlass },
  { href: "/credentials", label: "dest.credentials", icon: HiOutlineKey },
  { href: "/agents", label: "dest.agents", icon: HiOutlineLink },
  { href: "/twin", label: "dest.twin", icon: HiOutlineFingerPrint },
  { href: "/twin/look", label: "dest.look", icon: HiOutlineEye },
  { href: "/ai", label: "dest.ai", icon: HiOutlineCpuChip },
  { href: "/packages", label: "nav.packages", icon: HiOutlineCube },
  { href: "/runs", label: "nav.activity", icon: HiOutlinePlayCircle },
  { href: "/copies", label: "nav.copies", icon: HiOutlineSquare2Stack },
  { href: "/hidden", label: "dest.hidden", icon: HiOutlineArchiveBox },
];

export function CommandPalette() {
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // The catalog is requested only once, and only when the palette truly opens: loading it on every
  // visit to any page would cost a query that almost no one ends up using.
  useEffect(() => {
    if (!open || projects) return;
    fetch("/api/catalog")
      .then((response) => response.json())
      .then((payload: { projects: Project[] }) => setProjects(payload.projects))
      .catch(() => setProjects([]));
  }, [open, projects]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    const onOpen = () => setOpen(true);
    window.addEventListener("panoma:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("panoma:palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      setNotice(null);
      // The focus after rendering: otherwise, the input still does not exist.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // It only asks when opening the palette, just like the catalog: the answer determines whether the
  // open actions make sense in this installation.
  const { remote } = useOpenTarget(open);

  const openWith = useCallback(
    async (project: Project, tool: "folder" | "editor" | "terminal") => {
      setNotice(t("palette.opening", { name: project.name }));
      try {
        const response = await fetch("/api/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: project.id, tool }),
        });
        const payload = await response.json();
        setNotice(
          response.ok
            ? null
            : ((payload as { error?: string }).error ?? t("palette.openFailed")),
        );
        if (response.ok) setOpen(false);
      } catch {
        setNotice(t("palette.unreachable"));
      }
    },
    [t],
  );

  const goTo = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  /** The projects that match, already sorted and trimmed. */
  const matched = useMemo<Project[]>(() => {
    const term = fold(query.trim());
    const list = (projects ?? []).filter((project) => !term || matches(project, term));
    // Sort by how well it fits, not by the order in which they arrived from the catalog.
    if (term) list.sort((a, b) => score(b.name, term) - score(a.name, term));
    return list.slice(0, MAX_PROJECTS);
  }, [projects, query]);

  /*
    The actions act on the **indicated** result.
    Before there was only 'open the first folder,' so moving down the list didn't change anything
    that was offered: the action remained anchored to the result that just wasn't the one you were
    looking at. The last selected project is remembered—and the cursor is not read alone—so that
    actions don't change owner as soon as the cursor moves over them. How many action rows there
    are doesn't depend on which project it is, so moving between projects never moves the ground
    under the cursor.
   */
  const [anchor, setAnchor] = useState(0);
  useEffect(() => {
    if (cursor < matched.length) setAnchor(cursor);
  }, [cursor, matched.length]);
  const target = matched[Math.min(anchor, matched.length - 1)];

  const commands = useMemo<Command[]>(() => {
    const term = fold(query.trim());
    const top: Command[] = matched.map((project) => ({
      key: `p:${project.id}`,
      label: project.name,
      hint: shorten(project.root),
      enter: t(remote ? "palette.enterCard" : "palette.enterEditor"),
      icon: remote ? HiOutlineArrowTopRightOnSquare : HiOutlineCodeBracketSquare,
      group: "palette.groupProjects",
      run: () =>
        remote ? goTo(`/p/${project.slug}`) : openWith(project, "editor"),
    }));

    /*
      ↵ open the editor and not the tab.
      The old reason was that opening the folder "is what is wanted in half of the cases." It
      stops being so when the work is done by agents inside the editor: the Finder shows file
      names, and you go to the folder to copy something or to check a size, not to keep
      programming. The folder and the terminal are still here, a line below, because they are
      needed for that; what changes is which of the three costs nothing.
     */
    if (target) {
      if (!remote) {
        top.push({
          key: `folder:${target.id}`,
          label: t("palette.openFolderOf", { name: target.name }),
          hint: shorten(target.root),
          icon: HiOutlineFolderOpen,
          group: "palette.groupActions",
          run: () => openWith(target, "folder"),
        });
        top.push({
          key: `terminal:${target.id}`,
          label: t("palette.openTerminalOf", { name: target.name }),
          hint: shorten(target.root),
          icon: HiOutlineCommandLine,
          group: "palette.groupActions",
          run: () => openWith(target, "terminal"),
        });
      }
      // The card loses the ↵ but not the palette: this is where the dependencies, notices, and
      // proposals are, and it stays one line away.
      top.push({
        key: `card:${target.id}`,
        label: t("palette.openCardOf", { name: target.name }),
        icon: HiOutlineArrowTopRightOnSquare,
        group: "palette.groupActions",
        run: () => goTo(`/p/${target.slug}`),
      });
    }

    if (term.length >= 2) {
      top.push({
        key: "search-code",
        label: t("palette.searchEverywhere", { query: query.trim() }),
        icon: HiOutlineMagnifyingGlass,
        group: "palette.groupActions",
        run: () => goTo(`/search?q=${encodeURIComponent(query.trim())}`),
      });
    }

    for (const destination of DESTINATIONS) {
      // It overlays on the translated text: it is what the user sees and what they type.
      if (term && !fold(t(destination.label)).includes(term)) continue;
      top.push({
        key: `go:${destination.href}`,
        label: t(destination.label),
        icon: destination.icon,
        group: "palette.groupGoTo",
        run: () => goTo(destination.href),
      });
    }

    return top;
  }, [goTo, matched, openWith, query, remote, t, target]);

  useEffect(() => {
    setCursor((current) => Math.min(current, Math.max(0, commands.length - 1)));
  }, [commands.length]);

  /*
    If there is a list in sight. Send `aria-expanded` and decide if there is a marked row to
    announce: while the catalog loads there is none, and saying that there is would point to an
    identifier that does not yet exist on the page.
   */
  const listaVisible = projects !== null && commands.length > 0;

  /* The Tab does not leave the dialog, and when the focus is closed it returns to where it was. */
  useFocusTrap(dialogRef, open);

  /*
    That the indicated row is in view.
    `listRef` had been declared since the first day and not read by anyone: with more than eight
    results —and with twenty-something destinations always on the list, there are— pressing the
    down arrow moved the mark to rows that were outside the visible slot. With a mouse it doesn't
    happen, because the cursor only points to what is visible; with a keyboard the list was
    navigated blindly from the third row.
    `behavior: "instant"` and not the one that comes by default: `base.css` puts
    `scroll-behavior: smooth` in the entire document, and a list that scrolls with animation
    behind a repeating arrow is always one step behind where the focus is.
   */
  useEffect(() => {
    if (!open) return;
    const fila = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    fila?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [cursor, open, commands.length]);

  if (!open) return null;

  function onKeyDown(event: React.KeyboardEvent) {
    /*
      While the catalog is loading, nothing is executed.
      The results area says "loading" and there is no list in sight, but `commands` already brings
      the destinations from the side menu: one ↵ as soon as you open with ⌘K —the natural gesture
      of someone who is going to type the name of a project— navigated to the first of those
      destinations. An action that the reader hadn't seen, and almost never the one they wanted.
      With the list hidden, the keys that traverse it and the one that executes it do nothing; the
      text keeps being written, which is the only thing that makes sense to do while waiting.
     */
    if (projects === null) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((current) => (current + 1) % Math.max(1, commands.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) => (current - 1 + commands.length) % Math.max(1, commands.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      void commands[cursor]?.run();
    }
  }

  let lastGroup = "";

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.aria")}
        ref={dialogRef}
      >
        <div className="palette__search">
          <HiOutlineMagnifyingGlass aria-hidden />
          {/*
             The full combobox pattern, and not a box with a list next to it.
             The focus NEVER moves from here: the arrows change `aria-activedescendant`, which is
             how you tell a screen reader "that is the highlighted row" without moving the focus
             from where you are typing. Without this, scrolling down the list announced absolutely
             nothing—the focus remained on the box and the box hadn't changed—so the palette was,
             with a screen reader, a text box that when you pressed ↵ did something that hadn't
             been mentioned.
            */}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.searchAria")}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={listaVisible}
            aria-controls="palette-results"
            aria-activedescendant={listaVisible ? `palette-option-${cursor}` : undefined}
          />
          <kbd>esc</kbd>
        </div>

        {/*
           How many results there are, and only for the one who does not see them.
           The list changes with each letter. Whoever looks at it sees it; whoever doesn't, typed
           blindly without knowing if anything remained underneath. `role="status"` announces it
           by itself when changing, without stealing the focus, which is what is needed while
           continuing to write.
          */}
        <p className="sr-only" role="status">
          {projects === null ? t("palette.loading") : t("palette.results", { n: commands.length })}
        </p>

        {projects === null ? (
          <p className="palette__empty">{t("palette.loading")}</p>
        ) : commands.length === 0 ? (
          <p className="palette__empty">{t("palette.noMatch", { query })}</p>
        ) : (
          <ul
            className="palette__list"
            id="palette-results"
            ref={listRef}
            role="listbox"
            aria-label={t("palette.aria")}
          >
            {commands.map((command, index) => {
              const Icon = command.icon;
              const header = command.group !== lastGroup ? command.group : null;
              lastGroup = command.group;
              return (
                /*
                  The `<li>` go with `role="presentation"` because a list of options only supports
                  options as children: with the `listitem` from the factory in the middle, the
                  tree was broken and some readers did not even announce how many rows there were.
                  And the group header, moreover, `aria-hidden`. It is a visual grouping; when
                  placed in the tree it sneaks in as loose text between two options, which is
                  harder to read than not reading it. What needs to be announced is the
                  highlighted row, and that is handled by `aria-activedescendant`.
                 */
                <Fragment key={command.key}>
                  {header && (
                    <li role="presentation" aria-hidden>
                      <p className="palette__group">{t(header)}</p>
                    </li>
                  )}
                  <li role="presentation">
                    <button
                      id={`palette-option-${index}`}
                      type="button"
                      role="option"
                      /*
                        Outside the Tab path: in this pattern the focus stays on the cell and it
                        is the arrows that move through the list.
                       */
                      tabIndex={-1}
                      aria-selected={index === cursor}
                      className={index === cursor ? "is-active" : undefined}
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => void command.run()}
                    >
                      <Icon aria-hidden />
                      <span>{command.label}</span>
                      {command.hint && <span className="palette__hint">{command.hint}</span>}
                      {/*
                         The track goes only in the marked row: if ↵ no longer does the usual, one
                         must be able to read it without pressing it, and repeating it in eight
                         rows would be noise in seven of them.
                        */}
                      {index === cursor && command.enter && (
                        <kbd className="palette__enter">{command.enter}</kbd>
                      )}
                    </button>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        )}

        {/*
           `role="status"` because this appears AFTER pressing: without it, opening a failing
           editor says nothing to someone who doesn't see the screen.
          */}
        {notice && (
          <p className="palette__notice" role="status">
            {notice}
          </p>
        )}

        <p className="palette__footer">
          <span>{t("palette.keysMove")}</span>
          <span>{t("palette.keysOpen")}</span>
          <span>{t("palette.keysClose")}</span>
        </p>
      </div>
    </div>
  );
}

/** Match by name, by path, or by language: the three ways to remember a project. */
function matches(project: Project, term: string): boolean {
  /* Without accents, like the terminal: whoever types «diseno» is looking for «Web Design». */
  return fold([project.name, project.root, project.language ?? ""].join(" ")).includes(term);
}

/** A name that *starts* with what was typed is almost always the one that was being searched for. */
function score(label: string, term: string): number {
  const lower = fold(label);
  if (lower === term) return 3;
  if (lower.startsWith(term)) return 2;
  if (lower.includes(term)) return 1;
  return 0;
}

function shorten(root: string): string {
  const parts = root.split("/");
  return parts.length <= 3 ? root : `…/${parts.slice(-2).join("/")}`;
}
