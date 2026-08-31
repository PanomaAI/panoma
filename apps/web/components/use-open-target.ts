"use client";

import { useEffect, useState } from "react";

/**
 * What can open this Panoma facility.
 *
 * Three different places —the palette, the grid, and the code search— need the same thing: whether
 * the folders are on this disk and which editor will be used. `GET /api/open`, who is the one who
 * really knows, asks it, and the promise is saved in the module so that it is **one** query per
 * tab and not one per mounted component.
 */
export type InstalledTool = { id: string; name: string; broken?: string | null };

export type OpenTarget = {
  /** The catalog lives on another machine: opening folders from here means nothing. */
  remote: boolean;
  /** The binary that would be used by default, or `null` if there is none in PATH. */
  editor: string | null;
  /**
   * The editors and the agents that actually exist in this machine, with their name.
   *
   * The panel displayed 'Editor' and opened the first one it found: with Cursor and VS Code
   * installed there was no way to know which one would open until it did. With the list, each one
   * has its row and its name, and what is not installed is not shown.
   */
  editors: InstalledTool[];
  /**
   * Desktop applications that know how to open on a folder.
   *
   * They go apart from the agents even if they share a brand: 'Claude' opens the application and
   * 'Claude Code' opens a terminal, and confusing them is the mistake that brought this list.
   */
  apps: InstalledTool[];
  agents: (InstalledTool & { broken?: string | null })[];
};

/**
 * While the response does not arrive, it is assumed local.
 *
 * The other way around, a blink would be seen in the normal case —Panoma runs on your machine— and
 * hiding the button that was about to be pressed for half a second is worse than showing too much
 * for half a second in the rare case.
 */
const ASSUMED: OpenTarget = { remote: false, editor: null, editors: [], apps: [], agents: [] };

let pending: Promise<OpenTarget> | undefined;

export function useOpenTarget(enabled = true): OpenTarget {
  const [target, setTarget] = useState<OpenTarget>(ASSUMED);

  useEffect(() => {
    if (!enabled) return;
    pending ??= fetch("/api/open")
      .then((response) => response.json() as Promise<OpenTarget>)
      .catch(() => ASSUMED);
    let alive = true;
    void pending.then((value) => {
      if (alive) setTarget(value);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  return target;
}

/**
 * URL schemes that open a file on their line.
 *
 * They are recorded by the editor itself when installed and are resolved by the operating system,
 * so the link does not go through the server: there is no route traveling from the browser to
 * `/api/open`, which by the way never accepts one. The route is composed here with the root that
 * the catalog has already sent, which is server data and not something anyone has typed.
 *
 * Those that are missing (`subl`, `webstorm`, `idea` ) do not publish a schematic with a line that
 * can be considered valid. There, no link is drawn, which is more honest than drawing one that
 * leads to nothing.
 */
const SCHEMES: Record<string, string> = {
  cursor: "cursor",
  code: "vscode",
  windsurf: "windsurf",
  zed: "zed",
};

export function fileLink(
  editor: string | null,
  root: string,
  file: string,
  line: number,
): string | null {
  // Without a known editor, one goes for VS Code: it is the scheme that has the most machines
  // registered, and at most the system does nothing.
  const scheme = SCHEMES[editor ?? "code"];
  if (!scheme) return null;
  const path = `${root.replace(/\/$/, "")}/${file}`;
  // `encodeURI` lets `#` and `?` pass, and a folder can be called 'notes #2'.
  const encoded = encodeURI(path).replace(/#/g, "%23").replace(/\?/g, "%3F");
  return `${scheme}://file${encoded.startsWith("/") ? "" : "/"}${encoded}:${line}`;
}
