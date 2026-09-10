"use client";

import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { HiOutlineArrowDownTray, HiOutlineBookmarkSquare, HiOutlineSparkles } from "react-icons/hi2";
import { useLocale, useT } from "./i18n-provider";
import { ActionButton, ActionError, Check, EmptyState, Field, Select, TextArea } from "./primitives";
import type { MessageKey, Translate } from "@/lib/i18n";
import {
  CALLS_PER_PASS, EPISODE_QUERY_MAX, FIELD_KEYS, MEMORY_FIELDS, RECORDS_PER_CALL, episodeCoverage, episodeExpired,
  episodeReach, episodeTitle, type EpisodeView, type MemoryField,
} from "@/lib/twin-memory-view";

export type { EpisodeView } from "@/lib/twin-memory-view";

/**
 * A project as this section names it.
 *
 * `name` is what the catalog stored and `label` is what a person can tell apart — they differ on
 * every folder whose name repeats, which on a real disk is most of the copies. The card that
 * reports which project an episode belongs to reads `label` for the same reason the selector does.
 */
type ProjectOption = { slug: string; name: string; label: string; identity?: string };
type Draft = Partial<Record<MemoryField, string>>;

/** What `POST /api/twin/episodes/learn` answers, with or without `dryRun`. */
interface LearnReceipt {
  pending: number;
  selected: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  remainingCalls: number;
  contextOnly: number;
  /** Selected records a previous pass already paid for and deferred; absent on older servers. */
  retrying?: number;
  provider?: string;
  model?: string;
  stored?: number;
  processed?: number;
  dropped?: number;
  remaining?: number;
  failed?: { batches: number; records: number; reason: "unsupported" | "cut" };
}
interface NarrativeEvidence {
  id: string;
  source: string;
  at: string;
  text: string;
  context: string | null;
  kind: string;
  truncated: boolean;
}

const FIELD_LIMIT = 1_200;

/** The conversation role of an evidence record, in the reader's language; an unknown role stays raw. */
const KIND_KEYS: Record<string, MessageKey> = {
  opening: "twinMemory.kindOpening",
  reaction: "twinMemory.kindReaction",
  brief: "twinMemory.kindBrief",
};

/*
  No `Accept-Language` header: the routes read the `panoma-lang` cookie, so the error and the
  hint arrive in the language of the screen, like every other route this app calls.
 */
async function post<T>(path: string, body: object, fallback: string): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as T & { error?: string; hint?: string };
  if (!response.ok) {
    throw new Error([payload.error ?? fallback, payload.hint].filter(Boolean).join(" "));
  }
  return payload;
}

function failure(error: unknown, translate: Translate): string {
  return error instanceof Error ? error.message : translate("project.unreachable");
}

/** What `GET /api/twin/episodes` answers for a page of the archive, before the names are resolved. */
interface EpisodePage {
  episodes: EpisodeView[];
  nextCursor: string | null;
}

export function TwinMemory({ projects, episodes, coverage, dailyCalls, focusId, olderCursor, conflicts }: {
  projects: ProjectOption[];
  episodes: EpisodeView[];
  coverage: { total: number; pending: number; deferred: number };
  /** The episodes cap as `spend-settings` resolved it (pause, variable, file or factory); zero means extraction is off. */
  dailyCalls: number;
  focusId?: string;
  /** The position after the last row the server sent, or null when the archive ends there. */
  olderCursor: string | null;
  /** The revision families with more than one active version, each newest first. */
  conflicts: EpisodeView[][];
}) {
  const translate = useT();
  const focusedDismissed = episodes.find((episode) => episode.id === focusId)?.status === "dismissed";
  const [showDismissed, setShowDismissed] = useState(focusedDismissed);
  const [revision, setRevision] = useState<EpisodeView | null>(null);
  /*
    A revision the person asked for while the form still held unsaved words. The form stays as it
    is and says so; the request waits here until the draft is saved or cleared on purpose.
   */
  const [blocked, setBlocked] = useState<EpisodeView | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  /*
    Whether the capture form holds words nobody saved. A ref and not state: it is read in the
    click handler that decides whether to switch, and nothing renders from it.
   */
  const draftDirty = useRef(false);
  /*
    The list on screen, seeded by the server and grown by hand: a search replaces it, "load older"
    appends to it, and every server refresh — after a save, a dismissal, a kept version — resets it
    to what the server now says, so the row just written is on screen without a reload. The reset
    compares the prop by identity, because each server render hands down a fresh array; it happens
    during render, which is how React asks for state derived from a prop, and the effect below
    repeats the search that was open, if one was.
   */
  const [seed, setSeed] = useState(episodes);
  const [list, setList] = useState(episodes);
  const [nextCursor, setNextCursor] = useState(olderCursor);
  const [queryText, setQueryText] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [listBusy, setListBusy] = useState<"search" | "older" | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const listPending = useRef(false);
  if (seed !== episodes) {
    setSeed(episodes);
    setList(episodes);
    setNextCursor(olderCursor);
  }
  const visible = list.filter((episode) => showDismissed || episode.status === "active");
  const dismissed = list.filter((episode) => episode.status === "dismissed").length;

  useEffect(() => {
    if (!focusId) return;
    if (focusedDismissed) setShowDismissed(true);
    setRevealedId(focusId);
    document.getElementById(`episode-${focusId}`)?.focus();
  }, [focusId, focusedDismissed]);

  useEffect(() => {
    if (revealedId) document.getElementById(`episode-${revealedId}`)?.focus();
  }, [revealedId, showDismissed]);

  /*
    The route answers raw rows: the project is an identity and the dates are strings. The names
    come from the same list the capture form offers, which is every project with an identity.
   */
  function asView(episode: EpisodeView): EpisodeView {
    return { ...episode, projectName: episode.identity ? projects.find((project) => project.identity === episode.identity)?.label ?? null : null };
  }

  async function fetchPage(query: string, before: string | null): Promise<EpisodePage> {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (before) params.set("before", before);
    const search = params.toString();
    const response = await fetch(`/api/twin/episodes${search ? `?${search}` : ""}`);
    const payload = await response.json() as Partial<EpisodePage> & { error?: string };
    if (!response.ok || !Array.isArray(payload.episodes)) throw new Error(payload.error ?? translate("twinMemory.requestFailed"));
    return { episodes: payload.episodes.map(asView), nextCursor: payload.nextCursor ?? null };
  }

  async function search(text: string) {
    if (listPending.current) return;
    const clean = text.trim();
    if (!clean) {
      setActiveQuery("");
      setList(episodes);
      setNextCursor(olderCursor);
      setListError(null);
      return;
    }
    listPending.current = true;
    setListBusy("search");
    setListError(null);
    try {
      const page = await fetchPage(clean, null);
      setActiveQuery(clean);
      setList(page.episodes);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setListError(failure(error, translate));
    } finally {
      listPending.current = false;
      setListBusy(null);
    }
  }

  async function loadOlder() {
    if (listPending.current || !nextCursor) return;
    listPending.current = true;
    setListBusy("older");
    setListError(null);
    try {
      const page = await fetchPage(activeQuery, nextCursor);
      // The record opened directly rides at the end of the first page and can come back in an older one.
      setList((current) => {
        const seen = new Set(current.map((episode) => episode.id));
        return [...current, ...page.episodes.filter((episode) => !seen.has(episode.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (error) {
      setListError(failure(error, translate));
    } finally {
      listPending.current = false;
      setListBusy(null);
    }
  }

  /*
    A refresh resets the list to the server's rows; when a search was open, the person still sees
    the search, re-run against the rows the server now has. The query is read from state and not
    listed as a dependency on purpose: this runs when the server hands down a new array, not on
    every keystroke.
   */
  useEffect(() => {
    if (activeQuery) void search(activeQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodes]);

  function requestRevision(episode: EpisodeView) {
    setSavedMessage(null);
    if (episode.id !== revision?.id) {
      if (draftDirty.current) setBlocked(episode);
      else {
        setBlocked(null);
        setRevision(episode);
      }
    }
    document.getElementById("memory-capture-form")?.scrollIntoView({ block: "start", behavior: "instant" });
  }

  return (
    <section id="decision-memory" tabIndex={-1} aria-labelledby="twin-memory-title"
      className="page-shell__section scroll-mt-24 overflow-hidden rounded-lg border border-edge bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-edge px-5 py-5 sm:px-6">
        <div className="max-w-2xl">
          <p className="flex items-center gap-2 font-mono text-xs text-smoke">
            <HiOutlineBookmarkSquare aria-hidden className="h-4 w-4" />
            {translate("twinMemory.eyebrow")}
          </p>
          <h2 id="twin-memory-title" className="mt-2 text-base font-semibold">
            {translate("twinMemory.title")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-smoke">{translate("twinMemory.lead")}</p>
        </div>
        <div className="rounded-lg border border-edge bg-ground px-3 py-2 font-mono text-xs text-smoke">
          <p>{translate("twinMemory.captured", { n: coverage.total })}</p>
          <p className="mt-1">{translate("twinMemory.awaiting", { n: coverage.pending })}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1.3fr_1fr]">
        <CaptureEpisode projects={projects} revision={revision} blocked={blocked} dirty={draftDirty}
          savedMessage={savedMessage}
          onCancel={() => { setRevision(null); setBlocked(null); setSavedMessage(null); }}
          onClear={() => { setRevision(blocked); setBlocked(null); }}
          onSaved={() => {
            setSavedMessage(translate(revision ? "twinMemory.savedRevision" : "twinMemory.savedNew"));
            setRevision(null);
            setBlocked(null);
          }} />
        <LearnEpisodes pendingCount={coverage.pending} deferred={coverage.deferred} dailyCalls={dailyCalls} />
      </div>

      {conflicts.length > 0 && (
        <div id="competing-versions" tabIndex={-1} aria-labelledby="twin-competing-title"
          className="scroll-mt-24 border-t border-edge px-5 py-5 sm:px-6">
          <h3 id="twin-competing-title" className="text-base font-semibold">{translate("twinMemory.competingTitle")}</h3>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-smoke">{translate("twinMemory.competingLead")}</p>
          <p className="mt-2 font-mono text-xs text-smoke">{translate("twinMemory.competingFamilies", { n: conflicts.length })}</p>
          <ul className="mt-4 grid items-start gap-3 xl:grid-cols-2" role="list">
            {conflicts.map((family) => <CompetingFamily key={family.map((member) => member.id).join(",")} family={family} />)}
          </ul>
        </div>
      )}

      <div className="border-t border-edge px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold">{translate("twinMemory.recentTitle")}</h3>
          {dismissed > 0 && (
            <Check size="sm" checked={showDismissed}
              onChange={(event) => setShowDismissed(event.target.checked)}>
              {translate("twinMemory.includeDismissed", { n: dismissed })}
            </Check>
          )}
        </div>
        <form role="search" aria-busy={listBusy === "search"} className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => { event.preventDefault(); void search(queryText); }}>
          <Field label={translate("twinMemory.searchLabel")} className="min-w-0 grow sm:max-w-md"
            type="search" value={queryText} maxLength={EPISODE_QUERY_MAX} disabled={listBusy !== null}
            aria-describedby="memory-search-hint"
            onChange={(event) => {
              setQueryText(event.target.value);
              // The native clear of a search field is the same gesture as an empty submit.
              if (!event.target.value.trim() && activeQuery) void search("");
            }} />
          <ActionButton type="submit" tone="surface" busy={listBusy === "search"} busyLabel={translate("twinMemory.searching")}
            disabled={listBusy !== null}>{translate("twinMemory.search")}</ActionButton>
          {activeQuery && (
            <ActionButton type="button" tone="plain" disabled={listBusy !== null}
              onClick={() => { setQueryText(""); void search(""); }}>{translate("twinMemory.clearSearch")}</ActionButton>
          )}
        </form>
        <p id="memory-search-hint" className="mt-1 text-xs leading-relaxed text-smoke">{translate("twinMemory.searchHint")}</p>
        {listError && <ActionError text={listError} className="mt-2" />}
        <p className="mt-3 text-xs text-smoke">
          {activeQuery
            ? translate("twinMemory.shownMatches", { query: activeQuery, n: visible.length })
            : translate("twinMemory.shown", { n: visible.length })}
        </p>
        {/*
           The last `border-dashed` written by hand in the whole markup, and the lightest of the
           three dashed frames the theme found: this one drew its border in `--color-edge` and
           padded 20px, where the catalog's `.catalog-empty` draws `--line-strong` — a step darker
           — and pads 40. Nobody chose either figure. It is the house frame now, `EmptyState` in
           `primitives.tsx`, and the search's «nothing matched» beside it is the same component's
           `note`, so the two answers this one panel gave to «there is nothing here» are one.
          */}
        {visible.length === 0 && activeQuery ? (
          <EmptyState
            variant="note"
            role="status"
            className="mt-4"
            title={translate("twinMemory.noMatches", { query: activeQuery })}
          />
        ) : visible.length === 0 ? (
          <EmptyState className="mt-4" title={translate("twinMemory.emptyTitle")}>
            {translate("twinMemory.emptyBody")}
          </EmptyState>
        ) : (
          <ul className="mt-4 grid items-start gap-3 xl:grid-cols-2" role="list">
            {visible.map((episode) => <EpisodeCard key={episode.id} episode={episode}
              previousAvailable={Boolean(episode.supersedesId && list.some((one) => one.id === episode.supersedesId))}
              hasActiveSuccessor={Boolean(episode.activeRevisionId)}
              onPrevious={() => {
                setShowDismissed(true);
                setRevealedId(episode.supersedesId ?? null);
                document.getElementById(`episode-${episode.supersedesId}`)?.focus();
              }} onRevise={() => requestRevision(episode)} />)}
          </ul>
        )}
        {nextCursor && (
          <ActionButton type="button" tone="surface" className="mt-4" busy={listBusy === "older"}
            busyLabel={translate("twinMemory.loadingOlder")} disabled={listBusy !== null}
            onClick={() => void loadOlder()}>{translate("twinMemory.loadOlder")}</ActionButton>
        )}
        <p className="mt-4 text-xs leading-relaxed text-smoke">{translate("twinMemory.boundary")}</p>
      </div>
    </section>
  );
}

/**
 * One family with two or more live versions, and the way to end it: keeping a version dismisses
 * every other active member, one status change each with the revision the screen read, so a row
 * that moved under the person is refused with the usual stale conflict instead of overwritten. The
 * dismissals go one by one on purpose — the route takes one — and a failure halfway leaves the
 * ones already made: the screen refreshes either way, so what it shows is what the store holds.
 */
function CompetingFamily({ family }: { family: EpisodeView[] }) {
  const translate = useT();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  async function keep(kept: EpisodeView) {
    if (pending.current) return;
    pending.current = true;
    setBusyId(kept.id);
    setError(null);
    let changed = false;
    try {
      for (const other of family) {
        if (other.id === kept.id) continue;
        await post("/api/twin/episodes", { id: other.id, status: "dismissed", expectedUpdatedAt: other.updatedAt }, translate("twinMemory.requestFailed"));
        changed = true;
      }
    } catch (error) {
      setError(failure(error, translate));
    } finally {
      pending.current = false;
      setBusyId(null);
      if (changed) router.refresh();
    }
  }

  return (
    <li className="min-w-0 rounded-lg border border-edge bg-ground p-4">
      <ol className="space-y-3" role="list">
        {family.map((member) => (
          <li key={member.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-edge pt-3 first:border-t-0 first:pt-0">
            <div className="min-w-0">
              <p className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-[11px] text-smoke">
                <span>{translate(member.origin === "owner" ? "twinMemory.byOwner" : "twinMemory.fromHistory")}</span>
                <span>· {member.projectName ?? translate(member.identity ? "twinMemory.unlinkedProject" : "twinMemory.noProject")}</span>
                <time dateTime={member.createdAt}>· {member.createdAt.slice(0, 10)}</time>
              </p>
              <p className="mt-1 line-clamp-3 break-words text-sm leading-relaxed">{episodeTitle(member) ?? translate("twinMemory.untitled")}</p>
              <a href={`#episode-${member.id}`} className="mt-1 inline-block text-xs underline underline-offset-4">{translate("twinMemory.explore")}</a>
            </div>
            <ActionButton type="button" tone="surface" busy={busyId === member.id} busyLabel={translate("twinMemory.keeping")}
              disabled={busyId !== null} onClick={() => void keep(member)}>{translate("twinMemory.keepThis")}</ActionButton>
          </li>
        ))}
      </ol>
      {error && <ActionError text={error} className="mt-3" />}
    </li>
  );
}

/**
 * The form, mounted once. It used to be keyed on the revision id, so asking to revise a card —or
 * cancelling a revision— remounted it and threw away whatever was typed. Now the mode comes down
 * as a prop, the fields are reset only when `revision` changes, and a request that would lose a
 * draft is shown next to the form instead of being obeyed.
 */
function CaptureEpisode({ projects, revision, blocked, dirty, savedMessage, onSaved, onCancel, onClear }: {
  projects: ProjectOption[];
  revision: EpisodeView | null;
  /** A revision asked for while the draft was unsaved; the notice offers to clear and switch. */
  blocked: EpisodeView | null;
  dirty: RefObject<boolean>;
  savedMessage: string | null;
  onSaved: () => void;
  onCancel: () => void;
  onClear: () => void;
}) {
  const translate = useT();
  const router = useRouter();
  const [fields, setFields] = useState<Draft>({});
  const [slug, setSlug] = useState("");
  /*
    The optional dimensions the person asked to see. They used to arrive all seven at once behind
    one disclosure, which made a form long enough that the two fields that matter —the goal and the
    decision— were the smallest part of it. Now each one is asked for by name and appears on its
    own, and the set says which have been asked for.

    A field that already carries words is revealed whatever the set says: that is how a revision
    opens with everything its owner wrote. The set is *seeded* with those fields rather than only
    unioned at render, so emptying a textarea does not make it vanish under the cursor.
   */
  const [revealed, setRevealed] = useState<Set<MemoryField>>(new Set());
  /** The last field asked for, so the textarea that replaces its button receives the focus. */
  const [justRevealed, setJustRevealed] = useState<MemoryField | null>(null);
  /** The calendar day the decision stops applying, `YYYY-MM-DD` as the date input writes it. */
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edited, setEdited] = useState(false);
  const pending = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const hasCore = Boolean(fields.goal?.trim() || fields.decision?.trim());
  const optional = MEMORY_FIELDS.filter((field) => field !== "goal" && field !== "decision");
  const shown = optional.filter((field) => revealed.has(field) || Boolean(fields[field]?.trim()));
  const hidden = optional.filter((field) => !shown.includes(field));
  /*
    The project of the episode under revision, reduced to its slug before it enters the reset
    below. `projects` is a fresh array on every server refresh, and a reset keyed on the array
    would wipe the draft each time the page revalidated behind the form; a string only changes
    when the revision does.
   */
  const revisionSlug = revision?.identity
    ? projects.find((project) => project.identity === revision.identity)?.slug ?? ""
    : "";

  useEffect(() => {
    setFields(revision
      ? Object.fromEntries(MEMORY_FIELDS.map((field) => [field, revision.fields[field]?.text ?? ""]))
      : {});
    setRevealed(new Set(revision ? MEMORY_FIELDS.filter((field) => revision.fields[field]?.text.trim()) : []));
    setJustRevealed(null);
    // The stored expiry is an instant closing a day in UTC, and the input speaks that same day.
    setValidUntil(revision?.validUntil?.slice(0, 10) ?? "");
    setSlug(revisionSlug);
    setEdited(false);
    dirty.current = false;
    if (revision) form.current?.querySelector("textarea")?.focus({ preventScroll: true });
  }, [revision, revisionSlug, dirty]);

  /*
    The button that asks for a field is the button that disappears when the field arrives, and a
    keyboard leaving nothing where it was standing lands back at the top of the document. So the
    textarea that has just been opened takes the focus: it is where the person was going anyway.
   */
  useEffect(() => {
    if (justRevealed) document.getElementById(`memory-${justRevealed}`)?.focus();
  }, [justRevealed]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !hasCore) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await post("/api/twin/episodes", {
        fields,
        /*
          An empty date is sent as no key at all and not as null: a revision saves a new record,
          so leaving the date out is already the way to say the new one never expires.
         */
        ...(validUntil ? { validUntil } : {}),
        ...(revision ? { replacesId: revision.id, expectedUpdatedAt: revision.updatedAt } : slug ? { slug } : {}),
      }, translate("twinMemory.requestFailed"));
      setFields({});
      setRevealed(new Set());
      setJustRevealed(null);
      setValidUntil("");
      setEdited(false);
      dirty.current = false;
      onSaved();
      router.refresh();
    } catch (error) {
      setError(failure(error, translate));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function fieldInput(field: MemoryField) {
    const value = fields[field] ?? "";
    return (
      <div key={field}>
        <TextArea label={translate(FIELD_KEYS[field].label)}
          id={`memory-${field}`} value={value} maxLength={FIELD_LIMIT} rows={field === "decision" ? 3 : 2}
          disabled={busy} placeholder={translate(FIELD_KEYS[field].hint)}
          aria-describedby={`memory-${field}-count`}
          onChange={(event) => {
            setFields((current) => ({ ...current, [field]: event.target.value }));
            setEdited(true);
            dirty.current = true;
          }} />
        <p id={`memory-${field}-count`} className="mt-1 text-right font-mono text-[11px] text-smoke">
          {translate("twinMemory.characters", { n: value.length, max: FIELD_LIMIT })}
        </p>
      </div>
    );
  }

  return (
    <form id="memory-capture-form" ref={form} onSubmit={save} aria-busy={busy}
      aria-labelledby="memory-capture-title" className="min-w-0 scroll-mt-24 px-5 py-5 sm:px-6">
      <h3 id="memory-capture-title" className="text-base font-semibold">
        {translate(revision ? "twinMemory.reviseTitle" : "twinMemory.captureTitle")}
      </h3>
      <p className="mt-2 text-xs leading-relaxed text-smoke">
        {translate(revision ? "twinMemory.reviseHint" : "twinMemory.captureHint")}
      </p>
      <div role="status" aria-live="polite">
        {blocked && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-edge bg-ground px-3 py-3">
            <p className="text-xs leading-relaxed text-smoke">{translate("twinMemory.unsavedDraft")}</p>
            <ActionButton type="button" tone="surface" disabled={busy} onClick={onClear}>
              {translate("twinMemory.clearDraft")}
            </ActionButton>
          </div>
        )}
      </div>
      <div className="mt-4 space-y-3">
        {fieldInput("goal")}
        {fieldInput("decision")}
        <Select label={translate("twinMemory.projectContext")}
          value={slug} disabled={busy || revision !== null} onChange={(event) => setSlug(event.target.value)}>
          <option value="">
            {revision?.identity && !slug
              ? revision.projectName ?? translate("twinMemory.originalProject")
              : translate("twinMemory.noProject")}
          </option>
          {projects.map((project) => <option key={project.slug} value={project.slug}>{project.label}</option>)}
        </Select>
        <div>
          <Field label={translate("twinMemory.validUntilLabel")}
            type="date" value={validUntil} disabled={busy} aria-describedby="memory-valid-until-hint"
            onChange={(event) => {
              setValidUntil(event.target.value);
              setEdited(true);
              dirty.current = true;
            }} />
          <p id="memory-valid-until-hint" className="mt-1 text-xs leading-relaxed text-smoke">
            {translate("twinMemory.validUntilHint")}
          </p>
        </div>
        {shown.map(fieldInput)}
        {hidden.length > 0 && (
          <div className="rounded-lg border border-edge px-3 py-3">
            <p className="text-sm font-medium">{translate("twinMemory.moreFields")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {hidden.map((field) => (
                <ActionButton key={field} type="button" tone="surface" disabled={busy}
                  aria-label={translate("twinMemory.addField", { field: translate(FIELD_KEYS[field].label).toLocaleLowerCase() })}
                  onClick={() => {
                    setRevealed((current) => new Set(current).add(field));
                    setJustRevealed(field);
                  }}>
                  {translate(FIELD_KEYS[field].label)}
                </ActionButton>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ActionButton type="submit" tone="accent" busy={busy} busyLabel={translate("twinMemory.saving")}
          disabled={busy || !hasCore}>{translate(revision ? "twinMemory.saveRevision" : "twinMemory.saveEpisode")}</ActionButton>
        {revision && <ActionButton type="button" tone="plain" disabled={busy} onClick={onCancel}>
          {translate("twinMemory.cancelRevision")}
        </ActionButton>}
        <span className="text-xs text-smoke">{translate("twinMemory.localSave")}</span>
      </div>
      {error && <ActionError text={error} className="mt-3" />}
      <div role="status" aria-live="polite">
        {savedMessage && !edited && <p className="mt-3 text-sm text-smoke">{savedMessage}</p>}
      </div>
    </form>
  );
}

function LearnEpisodes({ pendingCount, deferred, dailyCalls }: {
  pendingCount: number;
  deferred: number;
  dailyCalls: number;
}) {
  const translate = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<"capture" | "preview" | "learn" | null>(null);
  const [preview, setPreview] = useState<LearnReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const pending = useRef(false);
  /*
    How long the queue takes at today's budget, so the pending count is a forecast and not a
    bare number. A day's budget times the records a call carries is the ceiling; the queue over
    that ceiling, rounded up, is the days. Zero budget means nothing is read, and the screen says
    so instead of dividing by it.
   */
  const queueDays = dailyCalls > 0 && pendingCount > 0
    ? Math.max(1, Math.ceil(pendingCount / (RECORDS_PER_CALL * dailyCalls)))
    : null;

  async function run(action: "capture" | "preview" | "learn") {
    if (pending.current) return;
    if (action === "learn" && (!preview || !preview.selected || preview.remainingCalls < preview.calls)) return;
    pending.current = true;
    setBusy(action);
    setError(null);
    setNote(null);
    const fallback = translate("twinMemory.requestFailed");
    try {
      if (action === "capture") {
        const result = await post<{
          narrativesSaved: number;
          narrativesUnmatched?: number;
          narrativesUndated?: number;
          /*
            The other harvest of the same call. One reading saves history records AND quotes for
            the portrait in one transaction — `captureNarratives` is hard-coded true in the route,
            so this is not something this button asked for, it is what the reading does. Naming
            only the records made the rest of the press invisible from here, and the button in the
            histories section had the mirror image of the same gap.
           */
          saved?: number;
          denied?: string[];
        }>("/api/twin/mine", { captureNarratives: true }, fallback);
        setPreview(null);
        setNote([
          translate("twinMemory.capturedNew", { n: result.narrativesSaved ?? 0 }),
          result.saved ? translate("twin.minedQuotes", { n: result.saved }) : "",
          result.denied?.length ? translate("twinMemory.capturedDenied", { n: result.denied.length }) : "",
          result.narrativesUnmatched ? translate("twinMemory.capturedUnmatched", { n: result.narrativesUnmatched }) : "",
          result.narrativesUndated ? translate("twinMemory.capturedUndated", { n: result.narrativesUndated }) : "",
        ].filter(Boolean).join(" "));
        router.refresh();
      } else if (action === "preview") {
        setPreview(await post<LearnReceipt>("/api/twin/episodes/learn", { dryRun: true }, fallback));
      } else {
        const result = await post<LearnReceipt>("/api/twin/episodes/learn", {}, fallback);
        setPreview(null);
        setNote([
          translate("twinMemory.learnStored", {
            stored: result.stored ?? 0, processed: result.processed ?? 0, remaining: result.remaining ?? 0,
          }),
          result.dropped ? translate("twinMemory.learnDropped", { n: result.dropped }) : "",
          result.failed ? translate(result.failed.reason === "cut" ? "twinMemory.learnCut" : "twinMemory.learnUnsupported") : "",
          result.failed ? translate("twinMemory.learnDeferred", { n: result.failed.records }) : "",
        ].filter(Boolean).join(" "));
        router.refresh();
      }
    } catch (error) {
      setError(failure(error, translate));
      // A failed paid pass can still have saved earlier batches. Refresh its durable progress.
      if (action === "learn") { setPreview(null); router.refresh(); }
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  return (
    <div className="min-w-0 border-t border-edge bg-ground px-5 py-5 sm:px-6 lg:border-t-0 lg:border-l"
      aria-busy={busy !== null}>
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <HiOutlineSparkles aria-hidden className="h-4 w-4 text-smoke" />
        {translate("twinMemory.learnTitle")}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-smoke">{translate("twinMemory.learnLead")}</p>

      <div className="mt-5 rounded-lg border border-edge bg-surface p-4">
        <p className="font-mono text-xs text-smoke">{translate("twinMemory.step1")}</p>
        <p className="mt-2 text-xs leading-relaxed text-smoke">{translate("twinMemory.step1Hint")}</p>
        <ActionButton type="button" tone="surface" className="mt-3" busy={busy === "capture"}
          busyLabel={translate("twinMemory.capturing")} disabled={busy !== null} onClick={() => void run("capture")}>
          <HiOutlineArrowDownTray aria-hidden className="h-4 w-4" />
          {translate("twinMemory.capture")}
        </ActionButton>
        <p className="mt-2 text-xs text-smoke">{translate("twinMemory.noCall")}</p>
      </div>

      <div className="mt-3 rounded-lg border border-edge bg-surface p-4">
        <p className="font-mono text-xs text-smoke">{translate("twinMemory.step2")}</p>
        <p className="mt-2 text-xs leading-relaxed text-smoke">{translate("twinMemory.step2Hint")}</p>
        <ActionButton type="button" tone="surface" className="mt-3" busy={busy === "preview"}
          busyLabel={translate("twinMemory.previewing")} disabled={busy !== null} onClick={() => void run("preview")}>
          {translate("twinMemory.preview")}
        </ActionButton>
        {!preview && (
          <div className="mt-2 space-y-1 text-xs text-smoke">
            <p>{translate("twinMemory.awaiting", { n: pendingCount })}</p>
            {deferred > 0 && <p>{translate("twinMemory.deferred", { n: deferred })}</p>}
            {dailyCalls > 0
              ? <p>{translate("twinMemory.passReads", { n: RECORDS_PER_CALL * CALLS_PER_PASS })}</p>
              : <p>{translate("twinMemory.extractionOff")}</p>}
            {queueDays !== null && <p>{translate("twinMemory.queueDays", { n: queueDays })}</p>}
          </div>
        )}

        {preview && (
          <div className="mt-4 border-t border-edge pt-4">
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-xs">
              <dt className="text-smoke">{translate("twinMemory.selected")}</dt><dd className="font-mono">{preview.selected}</dd>
              <dt className="text-smoke">{translate("twinMemory.inputTokens")}</dt><dd className="font-mono">{preview.inputTokens}</dd>
              <dt className="text-smoke">{translate("twinMemory.outputTokens")}</dt><dd className="font-mono">{preview.outputTokens}</dd>
              <dt className="text-smoke">{translate("twinMemory.calls")}</dt><dd className="font-mono">{preview.calls}</dd>
              <dt className="text-smoke">{translate("twinMemory.remainingCalls")}</dt><dd className="font-mono">{preview.remainingCalls}</dd>
            </dl>
            {preview.contextOnly > 0 && <p className="mt-2 text-xs text-smoke">
              {translate("twinMemory.contextOnly", { n: preview.contextOnly })}
            </p>}
            {/*
               A batch the model could not ground is deferred, not lost, and comes back once the
               rest is read. Saying so before the button is what lets the person decide whether
               to pay for it a second time.
              */}
            {(preview.retrying ?? 0) > 0 && <p className="mt-2 text-xs text-smoke">
              {translate("twinMemory.learnRetrying", { n: preview.retrying ?? 0 })}
            </p>}
            {(preview.provider || preview.model) && <p className="mt-3 break-words font-mono text-[11px] text-smoke">
              {[preview.provider, preview.model].filter(Boolean).join(" / ")}
            </p>}
            {preview.selected === 0 ? (
              <EmptyState variant="note" className="mt-3" title={translate("twinMemory.nothingUnread")} />
            ) : (
              <>
                <ActionButton type="button" tone="accent" className="mt-4" busy={busy === "learn"}
                  busyLabel={translate("twinMemory.learning")}
                  disabled={busy !== null || preview.remainingCalls < preview.calls}
                  onClick={() => void run("learn")}>{translate("twinMemory.learn")}</ActionButton>
                <p className="mt-2 text-xs leading-relaxed text-smoke">
                  {translate(preview.remainingCalls < preview.calls ? "twinMemory.budgetShort" : "twinMemory.learnCost")}
                </p>
              </>
            )}
          </div>
        )}
      </div>
      {error && <ActionError text={error} className="mt-3" />}
      <p role="status" aria-live="polite" className="mt-3 text-xs leading-relaxed text-smoke">
        {busy === "learn" ? translate("twinMemory.extracting") : note}
      </p>
    </div>
  );
}

function EpisodeCard({ episode, onRevise, previousAvailable, hasActiveSuccessor, onPrevious }: {
  episode: EpisodeView;
  onRevise: () => void;
  previousAvailable: boolean;
  hasActiveSuccessor: boolean;
  onPrevious: () => void;
}) {
  const translate = useT();
  const locale = useLocale();
  const router = useRouter();
  const { recorded, missing } = episodeCoverage(episode);
  /*
    One gesture at a time, and the label says which. The status change and the two expiry buttons
    share the `pending` ref below, so the flag also names the button that is working: with a plain
    boolean, dismissing a record made the expiry button announce that it was saving a date.
   */
  const [busy, setBusy] = useState<null | "status" | "expiry" | "clearExpiry">(null);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<NarrativeEvidence[] | null>(null);
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [sourceRequest, setSourceRequest] = useState<string | null>(null);
  /*
    The date on screen, and the stored one it came from. The card is keyed on the record's
    identifier and survives a refresh, so a draft typed here would otherwise outlive the save that
    stored it —and a cleared date would leave the old day sitting in the input. Comparing the prop
    against what it was seeded from is the same idiom the list above uses for its rows.
   */
  const [savedExpiry, setSavedExpiry] = useState(episode.validUntil);
  const [expiryDraft, setExpiryDraft] = useState(episode.validUntil?.slice(0, 10) ?? "");
  if (savedExpiry !== episode.validUntil) {
    setSavedExpiry(episode.validUntil);
    setExpiryDraft(episode.validUntil?.slice(0, 10) ?? "");
  }
  const pending = useRef(false);
  const evidencePending = useRef(false);
  const evidencePanel = useRef<HTMLDetailsElement>(null);
  const hasEvidence = recorded.some((field) => Boolean(episode.fields[field]?.narrativeId));
  const title = episodeTitle(episode) ?? translate("twinMemory.untitled");
  /*
    Coverage is evidence, not a score. The recorded dimensions are listed by name, the missing
    ones only inside the details; there is no bar, no fraction and no percentage to read as
    confidence in something that only counts what was written down.
   */
  const named = (fields: MemoryField[]) => fields.map((field) => translate(FIELD_KEYS[field].label).toLocaleLowerCase()).join(", ");
  const restorable = episode.status === "dismissed" && !hasActiveSuccessor;
  /*
    An active row with another active version is a legacy conflict, not a superseded record: the
    sentence it gets points at the section that resolves it, and its reach says it is withheld.
   */
  const competing = episode.status === "active" && hasActiveSuccessor;
  const expired = episodeExpired(episode);
  /*
    The stored instant closes a calendar day in UTC, and that day is what the sentence names. It is
    formatted in UTC on purpose: read in the browser's own zone, an instant of 23:59:59.999 lands
    on the next day for every reader east of Greenwich, so the card would name a day the owner
    never wrote.
   */
  const expiryDay = episode.validUntil
    ? new Date(episode.validUntil).toLocaleDateString(locale, { timeZone: "UTC" })
    : null;

  useEffect(() => {
    if (!evidence || !sourceRequest) return;
    document.getElementById(`episode-${episode.id}-source-${sourceRequest}`)?.focus();
  }, [evidence, episode.id, sourceRequest]);

  async function changeStatus() {
    if (pending.current) return;
    pending.current = true;
    setBusy("status");
    setError(null);
    try {
      await post("/api/twin/episodes", {
        id: episode.id, status: episode.status === "active" ? "dismissed" : "active", expectedUpdatedAt: episode.updatedAt,
      }, translate("twinMemory.requestFailed"));
      router.refresh();
    } catch (error) {
      setError(failure(error, translate));
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  /**
   * Set or clear the last day this decision applies. It travels the same road as the status
   * change —the record it was read from, so a row that moved under the person comes back refused
   * instead of overwritten— because it decides the same thing from the other side: what the
   * agents receive.
   */
  async function changeExpiry(day: string | null) {
    if (pending.current) return;
    pending.current = true;
    setBusy(day === null ? "clearExpiry" : "expiry");
    setError(null);
    try {
      await post("/api/twin/episodes", {
        id: episode.id, validUntil: day, expectedUpdatedAt: episode.updatedAt,
      }, translate("twinMemory.requestFailed"));
      router.refresh();
    } catch (error) {
      setError(failure(error, translate));
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  async function loadEvidence() {
    if (evidence !== null || evidencePending.current) return;
    evidencePending.current = true;
    setLoadingEvidence(true);
    setEvidenceError(null);
    try {
      const response = await fetch(`/api/twin/episodes?id=${encodeURIComponent(episode.id)}`);
      const result = await response.json() as { evidence?: NarrativeEvidence[]; error?: string };
      if (!response.ok || !Array.isArray(result.evidence)) {
        throw new Error(result.error ?? translate("twinMemory.evidenceFailed"));
      }
      setEvidence(result.evidence);
    } catch (error) {
      setEvidenceError(failure(error, translate));
    } finally {
      evidencePending.current = false;
      setLoadingEvidence(false);
    }
  }

  return (
    <li id={`episode-${episode.id}`} tabIndex={-1}
      className="min-w-0 scroll-mt-24 rounded-lg border border-edge bg-ground p-4">
      <p className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-[11px] text-smoke">
        <span>{translate(episode.origin === "owner" ? "twinMemory.byOwner" : "twinMemory.fromHistory")}</span>
        <span>· {episode.projectName ?? translate(episode.identity ? "twinMemory.unlinkedProject" : "twinMemory.noProject")}</span>
        {episode.status === "dismissed" && <span>· {translate("twinMemory.dismissed")}</span>}
      </p>
      <h4 className="mt-2 line-clamp-3 break-words text-sm font-medium leading-relaxed">{title}</h4>
      {episode.supersedesId && <p className="mt-2 text-xs text-smoke">
        {previousAvailable ? (
          <a href={`#episode-${episode.supersedesId}`} onClick={onPrevious}
            className="underline underline-offset-4">{translate("twinMemory.previousVersion")}</a>
        ) : (
          <a href={`/twin?episode=${encodeURIComponent(episode.supersedesId)}#episode-${episode.supersedesId}`}
            className="underline underline-offset-4">
            {translate("twinMemory.previousVersion")} <span className="sr-only">{translate("twinMemory.outsideView")}</span>
          </a>
        )}
      </p>}
      <p className="mt-3 font-mono text-[11px] text-smoke">{translate("twinMemory.recorded", { list: named(recorded) })}</p>
      <p className="mt-1 text-xs leading-relaxed text-smoke">{translate(episodeReach(episode, competing))}</p>
      {expiryDay && <p className="mt-1 text-xs leading-relaxed text-smoke">
        {translate(expired ? "twinMemory.expiredOn" : "twinMemory.appliesThrough", { date: expiryDay })}
      </p>}

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium underline-offset-4 hover:underline">{translate("twinMemory.explore")}</summary>
        <dl className="mt-3 space-y-3">
          {recorded.map((field) => (
            <div key={field}>
              <dt className="text-xs font-medium">{translate(FIELD_KEYS[field].label)}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-smoke">
                {episode.fields[field]!.text}
                {episode.fields[field]?.narrativeId && (
                  /* Inline again, and for the third time in this step: this control sits at the
                     end of the recorded text, inside the `<dd>`, and reads as a link in it. A
                     border and a 30px floor would turn the tail of a paragraph into a box. */
                  <button type="button" className="mt-1 block text-xs underline underline-offset-4"
                    aria-label={translate("twinMemory.viewSourceFor", { field: translate(FIELD_KEYS[field].label).toLocaleLowerCase() })}
                    onClick={() => {
                      const narrativeId = episode.fields[field]!.narrativeId!;
                      if (evidencePanel.current) evidencePanel.current.open = true;
                      setSourceRequest(narrativeId);
                      if (evidence) document.getElementById(`episode-${episode.id}-source-${narrativeId}`)?.focus();
                      void loadEvidence();
                    }}>{translate("twinMemory.viewSource")}</button>
                )}
              </dd>
            </div>
          ))}
        </dl>
        {missing.length > 0 && <p className="mt-4 border-t border-edge pt-3 text-xs leading-relaxed text-smoke">
          {translate("twinMemory.notRecorded", { list: named(missing) })}
        </p>}
        {/*
           The date lives inside this panel and not on the face of the card. The face already
           carries the origin, the project, the title, the previous version, the coverage, the
           reach, and two buttons; a date field with two more buttons next to them turns a card
           you can read at a glance into a form. What the face keeps is the one line that says
           until when it applies, which is what somebody scanning the archive needs.
          */}
        <div className="mt-4 border-t border-edge pt-3">
          <p className="text-xs font-medium">{translate("twinMemory.expiryTitle")}</p>
          <Field label={translate("twinMemory.validUntilLabel")} className="mt-2" size="sm"
            type="date" value={expiryDraft} disabled={busy !== null}
            aria-describedby={`episode-${episode.id}-expiry-hint`}
            onChange={(event) => setExpiryDraft(event.target.value)} />
          <p id={`episode-${episode.id}-expiry-hint`} className="mt-1 text-xs leading-relaxed text-smoke">
            {translate("twinMemory.validUntilHint")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ActionButton type="button" tone="surface" busy={busy === "expiry"}
              busyLabel={translate("twinMemory.savingExpiry")}
              disabled={busy !== null || !expiryDraft || expiryDraft === episode.validUntil?.slice(0, 10)}
              onClick={() => void changeExpiry(expiryDraft)}>{translate("twinMemory.saveExpiry")}</ActionButton>
            {episode.validUntil && (
              <ActionButton type="button" tone="plain" busy={busy === "clearExpiry"}
                busyLabel={translate("twinMemory.clearingExpiry")} disabled={busy !== null}
                onClick={() => void changeExpiry(null)}>{translate("twinMemory.clearExpiry")}</ActionButton>
            )}
          </div>
        </div>
      </details>

      {hasEvidence && (
        <details ref={evidencePanel} className="mt-3"
          onToggle={(event) => { if (event.currentTarget.open) void loadEvidence(); }}>
          <summary className="cursor-pointer text-xs font-medium underline-offset-4 hover:underline">{translate("twinMemory.viewEvidence")}</summary>
          {loadingEvidence && <p role="status" className="mt-2 text-xs text-smoke">{translate("twinMemory.loadingEvidence")}</p>}
          {evidenceError && <div className="mt-2">
            <ActionError text={evidenceError} />
            <ActionButton type="button" tone="surface" className="mt-2" onClick={() => void loadEvidence()}>
              {translate("twinMemory.retryEvidence")}
            </ActionButton>
          </div>}
          {evidence && evidence.length === 0 && <p className="mt-2 text-xs text-smoke">{translate("twinMemory.sourceGone")}</p>}
          {evidence?.map((source) => {
            const kind = KIND_KEYS[source.kind];
            return <div key={source.id} id={`episode-${episode.id}-source-${source.id}`}
              tabIndex={-1} className="mt-3 scroll-mt-24 rounded border border-edge bg-surface p-3">
              <p className="break-words font-mono text-[10px] text-smoke">
                {source.source} · {kind ? translate(kind) : source.kind} · {source.at.slice(0, 10)}
              </p>
              {/*
                 A brief is pasted or structured material —very often the assistant's own plan
                 pasted back— kept as context and never cited. The heading says which it is, so a
                 quotation is never mistaken for the person's own words.
                */}
              <p className="mt-2 text-xs font-medium">
                {translate(source.kind === "brief" ? "twinMemory.briefText" : "twinMemory.ownerText")}
              </p>
              <blockquote className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-smoke">{source.text}</blockquote>
              {source.truncated && <p className="mt-2 text-xs text-smoke">{translate("twinMemory.truncated")}</p>}
              {source.context && <details className="mt-3 border-t border-edge pt-2">
                <summary className="cursor-pointer text-xs text-smoke">{translate("twinMemory.agentContext")}</summary>
                <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-smoke">{source.context}</p>
              </details>}
            </div>;
          })}
        </details>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-3">
        <time dateTime={episode.createdAt} className="font-mono text-[10px] text-smoke">{episode.createdAt.slice(0, 10)}</time>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton type="button" tone="surface" disabled={busy !== null || hasActiveSuccessor} onClick={onRevise}>{translate("twinMemory.revise")}</ActionButton>
          {(episode.status === "active" || restorable) && (
            <ActionButton type="button" tone="plain" busy={busy === "status"} busyLabel={translate("twin.saving")}
              disabled={busy !== null} onClick={() => void changeStatus()}>
              {translate(episode.status === "active" ? "twinMemory.dismiss" : "twinMemory.restore")}
            </ActionButton>
          )}
        </div>
      </div>
      {hasActiveSuccessor && (
        <p className="mt-2 text-xs leading-relaxed text-smoke">
          {translate(competing ? "twinMemory.competingActive" : "twinMemory.successorActive")}{" "}
          {competing ? (
            <a href="#competing-versions" className="underline underline-offset-4">{translate("twinMemory.competingOpen")}</a>
          ) : (
            <a href={`/twin?episode=${encodeURIComponent(episode.activeRevisionId!)}#episode-${episode.activeRevisionId}`}
              className="underline underline-offset-4">{translate("twinMemory.currentVersion")}</a>
          )}
        </p>
      )}
      {error && <ActionError text={error} className="mt-2" />}
    </li>
  );
}
