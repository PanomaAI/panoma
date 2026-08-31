"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HiOutlineFolderOpen, HiOutlineMagnifyingGlass, HiOutlinePlus } from "react-icons/hi2";
import { useT } from "./i18n-provider";

/**
 * Where Panoma looks, stated where its absence would be noticeable.
 *
 * It arises from a specific case: a project in `~/Documents` did not appear in the catalog and
 * there was no way to find out why, because the list of monitored folders did not exist anywhere —
 * neither in the interface nor on the disk. The catalog said '94 projects' and that number is read
 * as 'all yours,' which was false.
 *
 * That is why it lives folded and in a line. Open all the time it would be a configuration box on
 * top of the catalog, which is the opposite of what this screen tries to be; hidden in settings
 * nobody would find it, because the question 'are they all?' is asked here, looking at the grid,
 * and not on an options page that one goes to on purpose.
 */

interface Root {
  path: string;
  projects: number;
  exists: boolean;
}

export function Sites({ total }: { total: number }) {
  const t = useT();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [roots, setRoots] = useState<Root[] | null>(null);
  const [isOpen, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<Root[] | null>(null);
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/roots");
      const payload = (await response.json()) as { roots?: Root[] };
      setRoots(payload.roots ?? []);
    } catch {
      setRoots([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    Which folder is really being asked about. Just one: asking about two at the same time means
    nothing and confuses which one will get the projects.
   */
  const [asking, setAsking] = useState<string | null>(null);

  async function send(action: "add" | "remove", value: string) {
    if (busy || !value.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/roots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, path: value.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        found?: number;
        removed?: number;
      };
      if (!response.ok) {
        setNotice({ text: payload.error ?? t("sites.failed"), bad: true });
        return;
      }
      setPath("");
      await load();
      if (action === "add") {
        const n = payload.found ?? 0;
        setNotice({
          text: t(n === 1 ? "sites.addedOne" : "sites.addedMany", { n }),
          bad: false,
        });
        // The grid is repainted with what was just found: adding a folder and not seeing anything
        // appear would make you think it didn't work.
        startTransition(() => router.refresh());
      } else {
        setNotice({ text: t("sites.removed", { n: payload.removed ?? 0 }), bad: false });
        /*
          The grid is repainted: removing a folder and continuing to view its projects is exactly
          the bug that this is meant to fix.
         */
        startTransition(() => router.refresh());
      }
    } catch {
      setNotice({ text: t("task.unreachable"), bad: true });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Searches the disk and proposes. **Proposes**; it does not add.
   *
   * Watching a folder means analyzing it every time it changes, and that is a costly decision that
   * cannot be made on its own. What is automated is the boring part—going out to search—not the
   * decision of what goes into your catalog.
   */
  async function search() {
    if (searching || busy) return;
    setSearching(true);
    setNotice(null);
    try {
      const response = await fetch("/api/roots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search" }),
      });
      const payload = (await response.json()) as { candidates?: Root[] };
      setCandidates(payload.candidates ?? []);
      if ((payload.candidates ?? []).length === 0) {
        setNotice({ text: t("sites.searchNone"), bad: false });
      }
    } catch {
      setNotice({ text: t("task.unreachable"), bad: true });
    } finally {
      setSearching(false);
    }
  }

  // No answer yet, or nothing to say (remote catalog): not a single extra line.
  if (!roots || roots.length === 0) return null;

  const names = roots.map((r) => shorten(r.path));

  return (
    <div className="sites">
      <button
        type="button"
        className="sites__line"
        onClick={() => setOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <HiOutlineFolderOpen aria-hidden />
        <span>
          {t(total === 1 ? "sites.summaryOne" : "sites.summaryMany", {
            n: total,
            // Two names and 'and N more': the entire list in one line stops being read at the third
            // folder, and what needs to be conveyed is 'look here, not everywhere'.
            where: names.slice(0, 2).join(", "),
            extra:
              names.length > 2 ? ` ${t("sites.andMore", { n: names.length - 2 })}` : "",
          })}
        </span>
        <span className="sites__action">{t(isOpen ? "sites.close" : "sites.manage")}</span>
      </button>

      {isOpen && (
        <div className="sites__detail">
          <ul>
            {roots.map((root) => (
              <li key={root.path}>
                <code title={root.path}>{shorten(root.path)}</code>
                <span>
                  {t(root.projects === 1 ? "sites.countOne" : "sites.countMany", {
                    n: root.projects,
                  })}
                  {/*
                     A folder that is no longer there is said not to delete itself: it could be an
                     external drive that is disconnected, and deleting it would lose the
                     configuration for nothing.
                    */}
                  {!root.exists && ` · ${t("sites.missing")}`}
                </span>
                {/*
                   Remove in two steps, like disconnecting an agent.
                   One click keeps watching and that's it: it removes the projects that were
                   hanging from that folder. With forty underneath, that's a button that deletes
                   forty rows without asking, and it was next to the one that only changes a path.
                   The second step says how many it is going to take, which is the data that is
                   missing to decide.
                  */}
                {asking === root.path ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setAsking(null);
                        void send("remove", root.path);
                      }}
                      disabled={busy}
                      className="text-fail"
                    >
                      {t("sites.removeConfirm", { n: root.projects })}
                    </button>
                    <button type="button" onClick={() => setAsking(null)} disabled={busy}>
                      {t("accounts.cancel")}
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setAsking(root.path)} disabled={busy}>
                    {t("sites.remove")}
                  </button>
                )}
              </li>
            ))}
          </ul>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send("add", path);
            }}
          >
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder={t("sites.placeholder")}
              aria-label={t("sites.fieldLabel")}
              spellCheck={false}
            />
            <button type="submit" disabled={busy || !path.trim()}>
              <HiOutlinePlus aria-hidden />
              {t(busy ? "sites.adding" : "sites.add")}
            </button>
          </form>

          {/*
             Searching by disk goes below the field for writing by hand and not above: whoever
             already knows which folder they want types it in two seconds. This is for those who
             don't know, which is precisely the case where the promise 'discover all your
             projects' fails.
            */}
          <div className="sites__search">
            <button type="button" onClick={search} disabled={searching || busy}>
              <HiOutlineMagnifyingGlass aria-hidden />
              {t(searching ? "sites.searching" : "sites.search")}
            </button>
            <span>{t("sites.searchHint")}</span>
          </div>

          {candidates && candidates.length > 0 && (
            <ul className="sites__candidates">
              {candidates.map((c) => (
                <li key={c.path}>
                  <code title={c.path}>{shorten(c.path)}</code>
                  <span>
                    {t(c.projects === 1 ? "sites.countOne" : "sites.countMany", {
                      n: c.projects,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCandidates((previousOnes) =>
                        (previousOnes ?? []).filter((otherOne) => otherOne.path !== c.path),
                      );
                      void send("add", c.path);
                    }}
                    disabled={busy}
                  >
                    {t("sites.add")}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="sites__note">{t("sites.note")}</p>
          {notice && (
            <p className={notice.bad ? "sites__error" : "sites__note"}>{notice.text}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** `/Users/who/Documents` → `~/Documents`. The part that changes is the one that matters. */
function shorten(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}
