"use client";

import { useEffect, useRef, useState } from "react";
import type { IconType } from "react-icons";
import {
  HiOutlineCheck,
  HiOutlineChevronDown,
  HiOutlineCommandLine,
  HiOutlineFolder,
} from "react-icons/hi2";
import { BRAND_ICONS } from "./brand-icons";
import { t, type Locale, type MessageKey } from "@/lib/i18n";
import { openTarget } from "@/lib/open-target";
import { useDismissable } from "./use-dismissable";
import { useOpenTarget } from "./use-open-target";
import { usePreference } from "./use-preference";

/**
 * All the places where a project can be opened, from its profile.
 *
 * The card offered three generic verbs —editor, terminal, folder— while the catalog panel already
 * listed the actual programs with their names. Two screens of the same project responding
 * differently to 'open it for me' is one of the things that make you doubt both.
 *
 * Horizontally, nine buttons do not fit, so it is a split button: the destination you have chosen
 * as usual and an arrow that unfolds the rest. Whoever opens by habit does not have to learn
 * anything new; anyone looking for another location finds it where expected.
 */

type Destination = {
  key: string;
  tool: "editor" | "app" | "agent" | "terminal" | "folder";
  /** Which one specifically, when there are several of the same type. */
  target?: string;
  name: string;
  sub?: MessageKey;
  icon: IconType;
};

export function OpenMenu({
  projectId,
  path,
  locale,
  onOpenChange,
  closed,
  compact,
}: {
  projectId: string;
  path: string;
  locale: Locale;
  /** Let the bar know to close its other menu: having two open at the same time is a mess. */
  onOpenChange?: (open: boolean) => void;
  /** The bar asks to close when it opens yours. */
  closed?: boolean;
  /**
   * At the line scale, for the 'resume' stripe on the cover. There, the high button on the card
   * would raise the stripe from 52 to 62 pixels, and that stripe exists precisely because it is
   * not a card: it is what the cover left starting above the fold.
   */
  compact?: boolean;
}) {
  const { remote, editors, apps, agents } = useOpenTarget();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"ready" | "opening" | "open">("ready");
  const [error, setError] = useState<string | null>(null);
  /*
    Claude is the first decision, not the first accidental element of a system response. Then it
    sends the user's last explicit choice and survives reloading.
   */
  const [preferredDestination, setPreferredDestination] = usePreference(
    "open:preferred-destination",
    "app:claude-app",
  );
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (closed) setOpen(false);
  }, [closed]);

  useDismissable(boxRef, open, () => setOpen(false));

  // Remotely, the server refuses to open — the folders are on another machine — so nothing is
  // displayed: a button that can only fail is not a button.
  if (remote) return null;

  async function launch(destination: Destination) {
    setOpen(false);
    setState("opening");
    setError(null);
    const result = await openTarget(
      { id: projectId, tool: destination.tool, with: destination.target },
      t(locale, "open.unreachable"),
    );
    if (result.ok) {
      setState("open");
      setTimeout(() => setState("ready"), 2000);
    } else {
      setState("ready");
      setError(result.message);
    }
  }

  /*
    The order is that of the catalog panel, and for the same reason: grouped by where you land.
    Applications — editors and desktop apps — end up in one window; agents, in a terminal. That
    both screens offer the same thing in the same order is what makes them read as a single
    product.
   */
  const destinations: Destination[] = [
    ...editors.map((editor) => ({
      key: `editor:${editor.id}`,
      tool: "editor" as const,
      target: editor.id,
      name: editor.name,
      icon: BRAND_ICONS[editor.id] ?? HiOutlineFolder,
    })),
    ...apps.map((app) => ({
      key: `app:${app.id}`,
      tool: "app" as const,
      target: app.id,
      name: app.name,
      sub: "catalog.appSub" as MessageKey,
      icon: BRAND_ICONS[app.id] ?? HiOutlineFolder,
    })),
    ...agents
      .filter((agent) => !agent.broken)
      .map((agent) => ({
        key: `agent:${agent.id}`,
        tool: "agent" as const,
        target: agent.id,
        name: agent.name,
        sub: "catalog.agentSub" as MessageKey,
        icon: BRAND_ICONS[agent.id] ?? HiOutlineCommandLine,
      })),
    {
      key: "terminal",
      tool: "terminal" as const,
      name: t(locale, "catalog.terminal"),
      sub: "catalog.terminalSub" as MessageKey,
      icon: HiOutlineCommandLine,
    },
    {
      key: "folder",
      tool: "folder" as const,
      name: t(locale, "catalog.folder"),
      sub: "catalog.folderSub" as MessageKey,
      icon: HiOutlineFolder,
    },
  ];

  /*
    The preference may point to an application that is no longer installed. In that case, it goes
    back to Claude if it exists, and if not, to the first real destination of this machine. The
    key is preserved: if the tool returns, the user's choice also returns.
   */
  const primary =
    destinations.find((destination) => destination.key === preferredDestination) ??
    destinations.find((destination) => destination.key === "app:claude-app") ??
    destinations[0]!;
  const Primary = primary.icon;

  function chooseAndLaunch(destination: Destination) {
    setPreferredDestination(destination.key);
    void launch(destination);
  }

  return (
    <div className={compact ? "open-menu open-menu--compact" : "open-menu"} ref={boxRef}>
      <div className="open-menu__split">
        <button
          type="button"
          className="open-menu__primary"
          onClick={() => void launch(primary)}
          disabled={state === "opening"}
          title={`${primary.name} · ${path}`}
        >
          <Primary aria-hidden />
          {state === "opening"
            ? t(locale, "open.busy")
            : state === "open"
              ? t(locale, "open.done")
              : t(locale, "open.openWith", { name: primary.name })}
        </button>
        {destinations.length > 1 && (
          <button
            type="button"
            className="open-menu__toggle"
            aria-label={t(locale, "open.moreDestinations")}
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => {
              const next = !open;
              setOpen(next);
              onOpenChange?.(next);
            }}
          >
            <HiOutlineChevronDown aria-hidden />
          </button>
        )}
      </div>

      {open && (
        <div className="open-menu__list" role="menu">
          {destinations.map((destination, index) => {
            const Icon = destination.icon;
            const selected = destination.key === primary.key;
            /*
              The line falls where the window you end up in changes: after the applications and
              after the agents. It is not decoration — it is the only difference between 'Claude'
              and 'Claude Code', which otherwise do not read the same.
             */
            const previous = destinations[index - 1];
            const changed = previous !== undefined && grupo(previous) !== grupo(destination);
            return (
              <button
                key={destination.key}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={`open-menu__item${changed ? " is-first-of-group" : ""}${selected ? " is-default" : ""}`}
                onClick={() => chooseAndLaunch(destination)}
              >
                <Icon aria-hidden />
                <span className="open-menu__item-copy">
                  <span>{destination.name}</span>
                  {(destination.sub || selected) && (
                    <small>
                      {destination.sub && t(locale, destination.sub)}
                      {destination.sub && selected && " · "}
                      {selected && <b>{t(locale, "open.defaultDestination")}</b>}
                    </small>
                  )}
                </span>
                {selected && <HiOutlineCheck className="open-menu__default-check" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}

      {error && <span className="open-menu__error">{error}</span>}
    </div>
  );
}

/** Which window you finish in. That's what decides where the line goes. */
function grupo(destination: Destination): "app" | "terminal" | "finder" {
  if (destination.tool === "editor" || destination.tool === "app") return "app";
  if (destination.tool === "folder") return "finder";
  return "terminal";
}
