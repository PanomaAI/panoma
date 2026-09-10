"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IconType } from "react-icons";
import {
  HiOutlineAdjustmentsHorizontal,
  HiOutlineArrowDown,
  HiOutlineArrowPath,
  HiOutlineArrowTopRightOnSquare,
  HiOutlineArrowUp,
  HiOutlineBolt,
  HiOutlineCommandLine,
  HiOutlineFolder,
  HiOutlinePlus,
  HiOutlineWindow,
  HiOutlineXMark,
} from "react-icons/hi2";
import { BRAND_ICONS } from "./brand-icons";
import { useT } from "./i18n-provider";
import { useFocusTrap } from "./use-focus-trap";
import { useOpenTarget } from "./use-open-target";
import { usePreference } from "./use-preference";
import { normalizeAccountUrl } from "@/lib/account-url";
import { VIDEO_ACTION_KEY } from "@/lib/apps-view";
import type { MessageKey, Translate } from "@/lib/i18n";
import {
  CUSTOM_LINK_KEY,
  FOLDER_KEY,
  MAX_COMMAND,
  MAX_LABEL,
  MAX_STEPS,
  PLAN_VERSION,
  TERMINAL_KEY,
  describePlan,
  stepDisplayName,
  suggestPlan,
  type Candidate,
  type LinkSource,
  type OpenPlan,
  type OpenStep,
} from "@/lib/open-all";
import { openableUrl } from "@/lib/open-url";
import {
  fetchOpenAll,
  runOpenAll,
  saveOpenAll,
  type OpenAllState,
  type StepOutcome,
} from "@/lib/open-all-api";

/**
 * The button that opens the whole working set of a project, and the dialog where the owner
 * decides what that is.
 *
 * It sits next to the split button. That one opens the project in **one** place; this one opens
 * it in all of them: the browser tabs the catalog already knows —repository, deploy, database,
 * `localhost:3000`—, a terminal with the dev server running, the editor, the agent. The first
 * click on a project shows the plan before running it, prefilled with what the catalog suggests,
 * because a click that opens six windows nobody has read is a surprise and not a shortcut; from
 * then on it just opens.
 *
 * The small button beside it goes back to the plan, and it is not decoration: the catalog panel
 * has no ⋯ menu, so without it the plan could be run there forever and never changed.
 *
 * Everything with a rule of its own is out of here, in `lib/open-all.ts` and `lib/open-all-api.ts`:
 * this file paints and forwards. What it does decide is the shape of the dialog — one list, the
 * ticked rows in order at the top, the rest below, the terminal row with its command field, and
 * the terminals and links the owner adds by hand at the end.
 */

/** The state of the button, in the order it goes through. */
type Phase = "ready" | "loading" | "opening";

export function OpenAll({
  projectId,
  projectName,
  compact,
  /** The ⋯ menu asks to open the configurator directly. */
  configureSignal,
}: {
  projectId: string;
  projectName: string;
  /** For the catalog panel, where the row is narrow. */
  compact?: boolean;
  configureSignal?: number;
}) {
  const translate = useT();
  const { remote } = useOpenTarget();
  const [phase, setPhase] = useState<Phase>("ready");
  const [state, setState] = useState<OpenAllState | null>(null);
  const [dialog, setDialog] = useState(false);
  const [notice, setNotice] = useState<{ text: string; failures: StepOutcome[] } | null>(null);
  /* The same preference as the split button: the tool the owner opens by habit leads the suggestion. */
  const [preferred] = usePreference("open:preferred-destination", "desktop:claude-app");
  const buttonRef = useRef<HTMLButtonElement>(null);

  /*
    What this project could open is asked once, lazily: on the first hover, focus or click, not on
    mount. The card mounts this button on every visit and the answer costs a catalog read plus the
    inventory of installed tools; asking before anyone reaches for the button would be paying for
    a tooltip.
   */
  const pending = useRef<Promise<OpenAllState | null> | null>(null);
  const load = useCallback(async (): Promise<OpenAllState | null> => {
    if (state) return state;
    pending.current ??= fetchOpenAll(projectId);
    const loaded = await pending.current;
    /*
      A failure is not remembered. `fetchOpenAll` answers `null` for a server that is restarting as
      much as for one that is not there, and holding on to that promise turned a two-second stumble
      into a button that stayed broken until the page was reloaded: every later hover awaited the
      same already-resolved `null`.
     */
    if (!loaded) pending.current = null;
    else setState(loaded);
    return loaded;
  }, [projectId, state]);

  /*
    The timer that clears a good notice lives in a ref so the next run can cancel it. Without that,
    a run that went well at t=0 wiped the failure of the run at t=0.5 before it could be read.
   */
  const clearing = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
    And the one that arms the sentence for the wait. It is a timer and not a `setNotice` because
    the answer is usually already here: the button asks the server on the first hover or the first
    focus, so by the time it is pressed the state is normally cached and `load()` resolves in one
    microtask. Written straight, «checking what it can open» appeared and disappeared within a
    single frame on every warm press — a flicker under the button and a sentence announced to a
    reader for nothing. Armed on a timer, it is only said when there really is a wait.
   */
  const checking = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (clearing.current) clearTimeout(clearing.current);
      if (checking.current) clearTimeout(checking.current);
    },
    [],
  );

  /**
   * What a run is about to open, in the reader's language and in the order it opens.
   *
   * The same list the tooltip promises, built the same way: the saved plan, or the suggestion when
   * there is none, or — for a project that cannot store one — the keys the dialog just ticked.
   */
  const namesFor = useCallback(
    (keys?: string[]): string[] => {
      if (!state) return [];
      const plan = keys
        ? { version: PLAN_VERSION, steps: keys.map((key) => ({ key })) }
        : (state.plan ?? suggestPlan(state.candidates, preferred));
      return describePlan(plan, state.candidates, stepLabels(translate));
    },
    [state, preferred, translate],
  );

  const run = useCallback(
    async (keys?: string[]) => {
      if (clearing.current) clearTimeout(clearing.current);
      setPhase("opening");
      /*
        What is being opened, while it is being opened. The label says "opening…", and that is a
        state and not an account: the steps go one after another with a breath between them, so a
        desk of six windows takes about a second, and for that second the only thing on the screen
        was a word. The list is the one the tooltip already promised, and the outcome replaces it
        the moment there is one.
       */
      const opening = namesFor(keys);
      setNotice(
        opening.length > 0
          ? { text: translate("openAll.openingList", { list: opening.join(" · ") }), failures: [] }
          : null,
      );
      const result = await runOpenAll(projectId, translate("open.unreachable"), keys);
      setPhase("ready");
      if (!result.ok) {
        setNotice({ text: result.message, failures: [] });
        return;
      }
      const { opened, total, outcomes } = result.data;
      const failures = outcomes.filter((outcome) => !outcome.ok);
      const text =
        opened === 0
          ? translate("openAll.doneNone")
          : opened === total
            ? translate("openAll.doneAll")
            : translate("openAll.donePartial", { done: opened, n: total });
      setNotice({ text, failures });
      if (failures.length === 0) {
        clearing.current = setTimeout(() => setNotice(null), 2400);
      }
    },
    [namesFor, projectId, translate],
  );

  const configure = useCallback(async () => {
    const loaded = await load();
    if (loaded) setDialog(true);
    else setNotice({ text: translate("open.unreachable"), failures: [] });
  }, [load, translate]);

  async function click() {
    if (phase !== "ready") return;
    setPhase("loading");
    /*
      The press is answered before the server is. What this project could open is asked lazily, and
      that question probes the agents installed here for their version: the first press of the day
      waits on it, and until now it waited in silence — nothing moved on the button and nothing was
      announced to a reader. The turning arrow says it from the first frame; the sentence waits a
      sixth of a second, because a wait nobody notices does not need one.
     */
    if (clearing.current) clearTimeout(clearing.current);
    setNotice(null);
    checking.current = setTimeout(
      () => setNotice({ text: translate("openAll.checking"), failures: [] }),
      160,
    );
    const loaded = await load();
    if (checking.current) clearTimeout(checking.current);
    setPhase("ready");
    if (!loaded) {
      setNotice({ text: translate("open.unreachable"), failures: [] });
      return;
    }
    if (loaded.plan) await run();
    else {
      setNotice(null);
      setDialog(true);
    }
  }

  /* The ⋯ menu changes the signal; every change opens the configurator. */
  const seenSignal = useRef(configureSignal);
  useEffect(() => {
    if (configureSignal === undefined || configureSignal === seenSignal.current) return;
    seenSignal.current = configureSignal;
    void configure();
  }, [configureSignal, configure]);

  /* Closing the dialog gives the keyboard back to the button that opened it. */
  const close = useCallback(() => {
    setDialog(false);
    buttonRef.current?.focus();
  }, []);

  // Remotely, the server refuses to open — the folders are on another machine — so nothing is
  // displayed: a button that can only fail is not a button.
  if (remote) return null;

  /* What the tooltip promises and what the run says while it runs are one list, built once. */
  const listed = namesFor();
  const title =
    listed.length > 0
      ? translate("openAll.willOpen", { list: listed.join(" · ") })
      : translate("openAll.buttonTitle");

  return (
    <div className={compact ? "open-all open-all--compact" : "open-all"}>
      <div className="open-all__pair">
        <button
          ref={buttonRef}
          type="button"
          className="open-all__button"
          onClick={() => void click()}
          onPointerEnter={() => void load()}
          onFocus={() => void load()}
          /*
            `aria-busy` and not `disabled`: a disabled button loses the focus it holds and the
            browser hands it to the body, so the dialog recorded the body as the place to give the
            keyboard back to and closing it left the person nowhere. The early return in `click()`
            is what stops a second press.
           */
          aria-busy={phase !== "ready" || undefined}
          title={title}
        >
          {/*
             The bolt turns into a turning arrow, and that is the whole of the answer at the
             instant of the press. `aria-busy` says it to a reader and the label says it to whoever
             is looking, but the label only changes once the run has started: between the press and
             that moment there is a question to the server, and a button that said "opening…" and
             then showed a dialog would have been describing something that never happened.
            */}
          {phase === "ready" ? (
            <HiOutlineBolt aria-hidden />
          ) : (
            <HiOutlineArrowPath aria-hidden className="is-spinning" />
          )}
          {/*
             Both words on the same cell, and the one that is not being said is hidden rather than
             removed. They are not the same width in either language, and swapping one for the
             other moved the three controls to the right of this button every time a plan ran.
             `visibility` keeps the room and still takes the hidden string out of what a reader
             announces, which is the reason it is not `opacity`.
            */}
          <span className="open-all__label" data-busy={phase === "opening" || undefined}>
            <span>{translate("openAll.button")}</span>
            <span>{translate("openAll.busy")}</span>
          </span>
        </button>
        <button
          type="button"
          className="open-all__configure"
          onClick={() => void configure()}
          onPointerEnter={() => void load()}
          aria-label={translate("openAll.configure")}
          title={translate("openAll.configure")}
        >
          <HiOutlineAdjustmentsHorizontal aria-hidden />
        </button>
      </div>

      {/*
         The live region is always here and only its content changes. A `role="status"` mounted
         with its text already inside is announced only sometimes —readers watch for changes
         **within** an existing region— and this notice is the only account of an action that has
         just opened six windows.
        */}
      <div className="open-all__notice" role="status">
        {notice && (
          <>
            <span>{notice.text}</span>
            {notice.failures.length > 0 && (
              <ul>
                {notice.failures.map((failure, index) => (
                  <li key={`${index}:${failure.key}`}>
                    <b>{failure.name}</b> · {failure.error}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {dialog && state && (
        <OpenAllDialog
          projectId={projectId}
          projectName={projectName}
          state={state}
          preferred={preferred}
          onCancel={close}
          onSaved={(plan, andRun) => {
            setState((current) => (current ? { ...current, plan } : current));
            /* Saving without opening closes the dialog, and something has to say it went through. */
            if (!andRun) {
              if (clearing.current) clearTimeout(clearing.current);
              setNotice({ text: translate("openAll.saved"), failures: [] });
              clearing.current = setTimeout(() => setNotice(null), 2400);
            }
          }}
          onRun={async (keys) => {
            close();
            await run(keys);
          }}
        />
      )}
    </div>
  );
}

/** The three keys that have no name of their own, in the reader's language. */
function stepLabels(translate: Translate): Record<string, string> {
  return {
    [TERMINAL_KEY]: translate("catalog.terminal"),
    [FOLDER_KEY]: translate("catalog.folder"),
    "link:remote": translate("openAll.sourceRemote"),
    [VIDEO_ACTION_KEY]: translate("apps.createVideo"),
  };
}

/*
  A row of the dialog: a candidate, or something the owner added — a second terminal with its
  command, a link written by hand. `on` is whether it opens; the ticked rows keep their order,
  which is the order they open in.
 */
interface Row {
  id: number;
  key: string;
  on: boolean;
  candidate?: Candidate;
  command?: string;
  url?: string;
  label?: string;
  /** What it was called when it went into the plan, for a step whose candidate is gone. */
  name?: string;
  /**
   * A second row for a key that already has one: the test watcher next to the dev server.
   *
   * It matters for what the row **says**: without the flag, the second terminal had no candidate
   * to resolve —the first one took it— and read as "no longer on this machine", which is exactly
   * the opposite of what it is. And it is the flag, not the absence of a candidate, that tells an
   * extra row from a step whose tool really is gone.
   */
  extra?: boolean;
}

let nextRowId = 1;

/**
 * The rows, from the plan and the candidates.
 *
 * The plan's steps first, in their order and ticked; every candidate the plan does not name
 * after, unticked. A step the machine can no longer honour —an editor that is gone— is kept
 * ticked with no candidate, so the owner sees it and can untick it, instead of it vanishing
 * from the plan the first time the dialog is opened without that tool.
 */
function rowsFrom(plan: OpenPlan, candidates: Candidate[]): Row[] {
  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const used = new Set<string>();
  const rows: Row[] = plan.steps.map((step) => {
    const extra = used.has(step.key);
    used.add(step.key);
    return {
      id: nextRowId++,
      key: step.key,
      on: true,
      candidate: extra ? undefined : byKey.get(step.key),
      command: step.command,
      url: step.url,
      label: step.label,
      name: step.name,
      ...(extra ? { extra: true } : {}),
    };
  });
  for (const candidate of candidates) {
    if (used.has(candidate.key)) continue;
    rows.push({ id: nextRowId++, key: candidate.key, on: false, candidate });
  }
  return rows;
}

/**
 * The plan the rows describe.
 *
 * Each step carries the name it is showing right now: the key cannot name an agent or a service
 * link once the catalog stops resolving it, and that is exactly the moment the report has to say
 * which thing it is talking about.
 */
function planFrom(rows: Row[], labels: Record<string, string>): OpenPlan {
  const steps: OpenStep[] = [];
  for (const row of rows) {
    if (!row.on) continue;
    const step: OpenStep = { key: row.key };
    if (row.key === TERMINAL_KEY && row.command?.trim()) step.command = row.command.trim();
    if (row.key === CUSTOM_LINK_KEY) {
      step.url = row.url?.trim();
      if (row.label?.trim()) step.label = row.label.trim();
    } else {
      const name = nameOf(row, labels);
      if (name && name !== row.key) step.name = name.slice(0, MAX_LABEL);
    }
    steps.push(step);
  }
  return { version: PLAN_VERSION, steps };
}

const SOURCE_KEY: Record<LinkSource | "custom", MessageKey> = {
  service: "openAll.sourceService",
  account: "openAll.sourceAccount",
  distribution: "openAll.sourceDistribution",
  remote: "openAll.sourceRemote",
  custom: "openAll.sourceCustom",
};

function iconFor(row: Row): IconType {
  const candidate = row.candidate;
  if (!candidate) {
    if (row.key === CUSTOM_LINK_KEY || row.key.startsWith("link:")) {
      return HiOutlineArrowTopRightOnSquare;
    }
    if (row.key === TERMINAL_KEY) return HiOutlineCommandLine;
    if (row.key === FOLDER_KEY) return HiOutlineFolder;
    return HiOutlineWindow;
  }
  if (candidate.kind === "link") return HiOutlineArrowTopRightOnSquare;
  if (candidate.kind === "folder") return HiOutlineFolder;
  if (candidate.kind === "terminal") return HiOutlineCommandLine;
  return (candidate.icon && BRAND_ICONS[candidate.icon]) || HiOutlineWindow;
}

function OpenAllDialog({
  projectId,
  projectName,
  state,
  preferred,
  onCancel,
  onSaved,
  onRun,
}: {
  projectId: string;
  projectName: string;
  state: OpenAllState;
  preferred: string;
  onCancel: () => void;
  onSaved: (plan: OpenPlan | null, andRun: boolean) => void;
  onRun: (keys?: string[]) => Promise<void>;
}) {
  const translate = useT();
  const labels = stepLabels(translate);
  const dialogRef = useRef<HTMLFormElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const initial = state.plan ?? suggestPlan(state.candidates, preferred);
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(initial, state.candidates));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [badRows, setBadRows] = useState<number[]>([]);
  /** Whether the press that may become a click on the curtain started on the curtain. */
  const pressedOnBackdrop = useRef(false);

  /* The Tab stays inside, and the focus goes back to the button that opened this. */
  useFocusTrap(dialogRef, true);

  /*
    The initial focus happens once, and its effect depends on nothing: with `onCancel` —an inline
    arrow function from the parent— among the dependencies, every repaint of the parent focused the
    first row again, on top of whoever was typing a command. The dialog itself is the fallback, so
    a list with no checkbox still announces its title instead of leaving the keyboard behind the
    curtain.
   */
  useEffect(() => {
    requestAnimationFrame(() => (firstRef.current ?? dialogRef.current)?.focus());
  }, []);

  /*
    Escape closes, reading the latest `onCancel` through a ref for the same reason — and the ref is
    written inside an effect, never while rendering: React may start a render, throw it away and
    start again. It is the same seam, and the same rule, as `useDismissable`.
   */
  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /*
    Where the keyboard goes after a change that unmounts the control it was on. Ticking a row moves
    it between the two lists, so the checkbox that was just pressed is destroyed and built again
    under another parent: without this, every tick threw the person out of the dialog and behind
    the curtain, and only the next Tab brought them back — to the top of the list.
   */
  const focusAfter = useRef<number | null>(null);
  useLayoutEffect(() => {
    const id = focusAfter.current;
    if (id === null) return;
    focusAfter.current = null;
    document.getElementById(`open-all-row-${id}`)?.focus();
  }, [rows]);

  const on = rows.filter((row) => row.on);
  const off = rows.filter((row) => !row.on);

  function update(id: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setBadRows((current) => current.filter((bad) => bad !== id));
    setError(null);
  }

  function toggle(id: number, value: boolean) {
    focusAfter.current = id;
    setRows((current) => {
      const row = current.find((entry) => entry.id === id);
      if (!row) return current;
      const rest = current.filter((entry) => entry.id !== id);
      /* Ticking appends to the end of what opens; unticking sends it below, in candidate order. */
      return value
        ? [...rest.filter((r) => r.on), { ...row, on: true }, ...rest.filter((r) => !r.on)]
        : [...rest.filter((r) => r.on), { ...row, on: false }, ...rest.filter((r) => !r.on)];
    });
    setError(null);
  }

  function move(id: number, direction: -1 | 1) {
    setRows((current) => {
      const ticked = current.filter((row) => row.on);
      const at = ticked.findIndex((row) => row.id === id);
      const to = at + direction;
      if (at === -1 || to < 0 || to >= ticked.length) return current;
      const reordered = [...ticked];
      [reordered[at], reordered[to]] = [reordered[to]!, reordered[at]!];
      return [...reordered, ...current.filter((row) => !row.on)];
    });
  }

  function add(row: { key: string; command?: string; url?: string; label?: string; extra?: boolean }) {
    if (on.length >= MAX_STEPS) return;
    const id = nextRowId++;
    focusAfter.current = id;
    setRows((current) => [
      ...current.filter((entry) => entry.on),
      { ...row, id, on: true },
      ...current.filter((entry) => !entry.on),
    ]);
  }

  function remove(id: number) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  function reset() {
    setRows(rowsFrom(suggestPlan(state.candidates, preferred), state.candidates));
    setError(null);
    setBadRows([]);
  }

  /**
   * What is wrong before sending anything.
   *
   * The address is checked with **both** rules: the one that understands what a person types and
   * the one that decides what may be handed to the browser opener. A space inside the path passes
   * the first and is refused by the second, and saving it produced a plan whose link failed on
   * every click with the dialog seeing nothing wrong with it.
   */
  function review(): OpenPlan | null {
    const bad = on
      .filter((row) => {
        if (row.key !== CUSTOM_LINK_KEY) return false;
        const link = normalizeAccountUrl(row.url);
        return link.kind !== "url" || !openableUrl(link.url);
      })
      .map((row) => row.id);
    setBadRows(bad);
    if (bad.length > 0) {
      setError(translate("openAll.badUrl"));
      return null;
    }
    const plan = planFrom(rows, labels);
    if (plan.steps.length === 0) {
      setError(translate("openAll.nothingChosen"));
      return null;
    }
    return plan;
  }

  async function submit(andRun: boolean) {
    const plan = review();
    if (!plan || busy) return;
    setBusy(true);
    setError(null);

    if (!state.canSave) {
      /*
        Nowhere to store it: what is ticked opens, by key, and the server resolves each key
        against what it offered. Commands and custom links cannot travel this way; the notice above
        the list says so before anyone types one.
       */
      setBusy(false);
      await onRun(plan.steps.map((step) => step.key));
      return;
    }

    const result = await saveOpenAll(projectId, plan, translate("open.unreachable"));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (!result.data.saved) {
      setError(translate("openAll.notSaved"));
      return;
    }
    /*
      What the client keeps is what the server stored, not what the fields held: an address typed
      as `localhost:3000` is saved as `http://localhost:3000`, and keeping the raw text left the
      button's tooltip naming a link with an empty string.
     */
    onSaved(result.data.plan ?? plan, andRun);
    if (andRun) await onRun();
    else onCancel();
  }

  const hasCandidates = state.candidates.length > 0;
  const describedBy = state.canSave ? undefined : "open-all-no-identity";

  /*
    The curtain goes on the `body`, and not because of where it looks better. This dialog is
    written twice into other people's boxes — the header of a project sheet and the catalog's
    detail panel — and both of them used to be its ceiling: the header carried a `z-index`, and the
    panel is `position: sticky`, which opens a stacking context on its own with no number in sight.
    Inside either, `--z-overlay` stops being 70. `modal-keyboard.test.ts` holds the whole account.
   */
  return createPortal(
    <div
      className="palette-backdrop"
      role="presentation"
      /*
        Where the press started decides whether this is a click on the curtain. Selecting the text
        of a command and releasing the mouse past the edge of the dialog produces a click whose
        target is the backdrop, and that closed the dialog and threw away what had been typed.
       */
      onPointerDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedOnBackdrop.current && event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        ref={dialogRef}
        className="open-all-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="open-all-title"
        /* So there is somewhere to land when the list has no checkbox to focus. */
        tabIndex={-1}
        /*
          Enter saves and does not open. Someone typing `pnpm run dev` and pressing Enter out of
          terminal habit was opening every window of the plan, which is the very surprise the first
          click exists to avoid. Without a repository there is nothing to save, and there opening is
          the only outcome there is.
         */
        onSubmit={(event) => {
          event.preventDefault();
          void submit(!state.canSave);
        }}
      >
        <h2 id="open-all-title">{translate("openAll.title", { name: projectName })}</h2>
        <p className="open-all-dialog__intro">{translate("openAll.intro")}</p>

        {!state.canSave && (
          <p className="open-all-dialog__warning" id="open-all-no-identity">
            {translate("openAll.noIdentity")}
          </p>
        )}
        {!hasCandidates && (
          <p className="open-all-dialog__warning">{translate("openAll.noCandidates")}</p>
        )}

        <div className="open-all-dialog__body">
          <div className="open-all-dialog__list">
            <h3>{translate("openAll.opens")}</h3>
            {/*
               Only when there is something to tick. With no editor installed and no link detected,
               asking to tick one sat right under the line saying there is nothing.
              */}
            {on.length === 0 && hasCandidates && (
              <p className="open-all-dialog__empty">{translate("openAll.nothingChosen")}</p>
            )}
            <ul>
              {on.map((row, index) => {
                const Icon = iconFor(row);
                const name = nameOf(row, labels);
                const isCustom = row.key === CUSTOM_LINK_KEY;
                const isTerminal = row.key === TERMINAL_KEY;
                const own = isCustom || row.extra === true;
                return (
                  <li
                    key={row.id}
                    className={`open-all-row${badRows.includes(row.id) ? " is-bad" : ""}`}
                  >
                    {/*
                       A custom link and an extra terminal carry no checkbox: they are not
                       candidates that can be put back, so unticking them would be deleting them
                       under a control that promises the opposite. The ✕ at the end is the one that
                       deletes, and it says so.
                      */}
                    {own ? (
                      <span className="open-all-row__spacer" aria-hidden />
                    ) : (
                      <input
                        id={`open-all-row-${row.id}`}
                        ref={index === 0 ? firstRef : undefined}
                        type="checkbox"
                        checked
                        onChange={() => toggle(row.id, false)}
                        aria-label={translate("openAll.include", { name })}
                      />
                    )}
                    <Icon aria-hidden className="open-all-row__icon" />
                    <div className="open-all-row__body">
                      {isCustom ? (
                        <div className="open-all-row__fields">
                          <input
                            id={`open-all-row-${row.id}`}
                            value={row.label ?? ""}
                            onChange={(event) => update(row.id, { label: event.target.value })}
                            placeholder={translate("openAll.linkName")}
                            aria-label={translate("openAll.linkName")}
                            aria-describedby={describedBy}
                            maxLength={MAX_LABEL}
                            disabled={!state.canSave}
                          />
                          <input
                            value={row.url ?? ""}
                            onChange={(event) => update(row.id, { url: event.target.value })}
                            placeholder={translate("openAll.linkPlaceholder")}
                            aria-label={translate("openAll.linkUrl")}
                            aria-invalid={badRows.includes(row.id) || undefined}
                            aria-describedby={
                              badRows.includes(row.id) ? "open-all-error" : describedBy
                            }
                            spellCheck={false}
                            disabled={!state.canSave}
                          />
                        </div>
                      ) : (
                        <>
                          <strong>{name}</strong>
                          <small>{detailOf(row, translate)}</small>
                        </>
                      )}
                      {isTerminal && (
                        <div className="open-all-row__command">
                          <label>
                            <span>{translate("openAll.commandLabel")}</span>
                            <input
                              {...(own ? { id: `open-all-row-${row.id}` } : {})}
                              value={row.command ?? ""}
                              onChange={(event) => update(row.id, { command: event.target.value })}
                              placeholder={translate("openAll.commandPlaceholder")}
                              aria-describedby={describedBy}
                              maxLength={MAX_COMMAND}
                              spellCheck={false}
                              disabled={!state.canSave}
                            />
                          </label>
                          {state.startCommand && !row.command && state.canSave && (
                            <button
                              type="button"
                              className="open-all-row__suggest"
                              onClick={() => update(row.id, { command: state.startCommand ?? "" })}
                            >
                              {translate("openAll.useSuggested", { command: state.startCommand })}
                            </button>
                          )}
                          <small>{translate("openAll.commandHint")}</small>
                        </div>
                      )}
                    </div>
                    <div className="open-all-row__order">
                      {/*
                         `aria-disabled` and not `disabled`: at the ends of the list the arrow that
                         was just pressed becomes unusable, and a disabled control loses the focus
                         it holds — which is exactly where a reorder finishes.
                        */}
                      <button
                        type="button"
                        onClick={() => move(row.id, -1)}
                        aria-disabled={index === 0}
                        aria-label={translate("openAll.moveUp", { name })}
                      >
                        <HiOutlineArrowUp aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(row.id, 1)}
                        aria-disabled={index === on.length - 1}
                        aria-label={translate("openAll.moveDown", { name })}
                      >
                        <HiOutlineArrowDown aria-hidden />
                      </button>
                      {own && (
                        <button
                          type="button"
                          onClick={() => remove(row.id)}
                          aria-label={translate("openAll.removeLink", { name })}
                        >
                          <HiOutlineXMark aria-hidden />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="open-all-dialog__adders">
              {/*
                 A second terminal is not a whim: the dev server in one window and the test watcher
                 in another is a real desk, and the plan already tells two terminals apart by their
                 command.
                */}
              <button
                type="button"
                className="open-all-dialog__add"
                onClick={() => add({ key: TERMINAL_KEY, command: "", extra: true })}
                disabled={!state.canSave || on.length >= MAX_STEPS}
                aria-describedby={describedBy}
              >
                <HiOutlinePlus aria-hidden />
                {translate("openAll.addTerminal")}
              </button>
              <button
                type="button"
                className="open-all-dialog__add"
                onClick={() => add({ key: CUSTOM_LINK_KEY, url: "", label: "" })}
                disabled={!state.canSave || on.length >= MAX_STEPS}
                aria-describedby={describedBy}
              >
                <HiOutlinePlus aria-hidden />
                {translate("openAll.addLink")}
              </button>
            </div>
          </div>

          {off.length > 0 && (
            <div className="open-all-dialog__list">
              <h3>{translate("openAll.doesNotOpen")}</h3>
              <ul>
                {off.map((row) => {
                  const Icon = iconFor(row);
                  const name = nameOf(row, labels);
                  return (
                    <li key={row.id} className="open-all-row is-off">
                      <input
                        id={`open-all-row-${row.id}`}
                        type="checkbox"
                        checked={false}
                        onChange={() => toggle(row.id, true)}
                        aria-label={translate("openAll.include", { name })}
                      />
                      <Icon aria-hidden className="open-all-row__icon" />
                      <div className="open-all-row__body">
                        <strong>{name}</strong>
                        <small>{detailOf(row, translate)}</small>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {error && (
          <p className="open-all-dialog__error" id="open-all-error" role="alert">
            {error}
          </p>
        )}

        <div className="open-all-dialog__actions">
          <button type="button" className="open-all-dialog__reset" onClick={reset} disabled={busy}>
            {translate("openAll.reset")}
          </button>
          <span className="open-all-dialog__spacer" />
          <button type="button" onClick={onCancel} disabled={busy}>
            {translate("openAll.cancel")}
          </button>
          {state.canSave && (
            <button type="submit" disabled={busy}>
              {translate(busy ? "openAll.saving" : "openAll.save")}
            </button>
          )}
          <button
            type={state.canSave ? "button" : "submit"}
            className="is-primary"
            onClick={state.canSave ? () => void submit(true) : undefined}
            disabled={busy}
          >
            {translate(state.canSave ? "openAll.saveAndOpen" : "openAll.openOnly")}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/** What this row is called, by the same rule the run answer uses. */
function nameOf(row: Row, labels: Record<string, string>): string {
  const step: OpenStep = { key: row.key };
  if (row.name) step.name = row.name;
  if (row.label) step.label = row.label;
  if (row.url) step.url = row.url;
  return stepDisplayName(step, row.candidate, labels);
}

function detailOf(row: Row, translate: Translate): string {
  const candidate = row.candidate;
  if (!candidate) {
    /* A second terminal is not a missing one: it has no candidate because the first row took it. */
    if (row.extra) return translate("catalog.terminalSub");
    /* And for the rest, the same two ways of going missing that the run answer distinguishes. */
    return translate(row.key.startsWith("link:") ? "openAll.missingLink" : "openAll.missing");
  }
  if (candidate.kind === "link") {
    const where = translate(SOURCE_KEY[candidate.source ?? "custom"]);
    return candidate.detail ? `${candidate.detail} · ${where}` : where;
  }
  return candidate.detail ?? "";
}
