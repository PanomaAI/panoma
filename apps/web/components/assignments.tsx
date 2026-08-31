"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HiOutlineArrowRight, HiOutlineCheck, HiOutlineChevronRight } from "react-icons/hi2";
import { RunButton } from "./run-button";
import { useT } from "./i18n-provider";
import { useCopied } from "./use-copied";
import { useLocalAgent, type LocalAgent } from "./use-local-agent";
import { ActionButton } from "./primitives";

/**
 * The tasks section: what the card offers to do, not just to read.
 *
 * Each row is one of the two machines that already exist, presented as an assignment:
 *
 * - The drafts (`/api/assignments`): Panoma writes the message with the project's facts. Three
 * ways to deliver it, and all three are the same text: **open in your terminal** lets your agent
 * work now on this computer, **leave it in the queue** waits for it to enter the project, and
 * **copy** takes it pasted wherever you want.
 *
 * The signs name the destination and not the gesture on purpose. They said 'do it now' and
 * 'order,' which are two verbs that do not differ in what is the only thing that differentiates
 * them: where what is going to happen occurs and when. With two buttons a centimeter apart, one
 * that opens an agent with editing permission and another that does nothing until tomorrow, that
 * is not a matter of stylistic nuance.
 * - Those from the runner (security arrangement, dependencies): do not go through the queue — they
 * trigger an isolated execution that ends in proposal, the usual `/runs` circuit.
 *
 * The body is taught whole before handing it over: what is going to be told to an agent with tools
 * cannot be a mystery, by the same rule that `CopyCommand` teaches the command instead of
 * executing it.
 */

export interface AssignmentView {
  kind: string;
  title: string;
  promise: string;
  body: string;
}

/** A notice under a row: the result of the last thing that was pressed there. */
type Note = { text: string; bad: boolean };

export function Assignments({
  slug,
  assignments,
  queuedKinds,
  securityOpen,
  outdatedDeps,
}: {
  slug: string;
  assignments: AssignmentView[];
  /** Orders with a task still open in the queue: they are marked as 'in the queue' for input. */
  queuedKinds: string[];
  /** If there is any open security alert: show the runner array row. */
  securityOpen: boolean;
  outdatedDeps: number;
}) {
  const t = useT();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const agent = useLocalAgent();
  const [queued, setQueued] = useState<ReadonlySet<string>>(() => new Set(queuedKinds));
  /*
    And what the server says is looked at again.
    The `useState` initializer runs once on mount, and this component does not unmount: the tab
    menu hides the views with CSS. So the set only grew — a task that an agent closed while you
    were watching still said "in the queue" until manually reloading. It is compared by content
    and not by identity because the array arrives new on each server render, and with identity
    this would be a loop.
   */
  const encoladas = queuedKinds.join(" ");
  useEffect(() => {
    setQueued(new Set(encoladas === "" ? [] : encoladas.split(" ")));
  }, [encoladas]);
  const [sending, setSending] = useState<string | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, Note>>({});

  function note(kind: string, value: Note | null) {
    setNotes((previous) => {
      const next = { ...previous };
      if (value) next[kind] = value;
      else delete next[kind];
      return next;
    });
  }

  async function assign(kind: string) {
    if (sending) return;
    setSending(kind);
    note(kind, null);
    try {
      const response = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, kind }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        hint?: string;
      };
      if (response.ok) {
        setQueued((previous) => new Set(previous).add(kind));
        note(kind, { text: t("assignment.queuedNote"), bad: false });
        // The logbook's task list shows the new one without reloading manually.
        startTransition(() => router.refresh());
      } else if (response.status === 409) {
        // It was already done: it's not a failure, it's the piece getting aware. It renders itself
        // as glued.
        setQueued((previous) => new Set(previous).add(kind));
        note(kind, { text: payload.error ?? t("assignment.queuedNote"), bad: false });
      } else {
        /*
          The server text rules when it exists, as in `CaptureTask`: the paths of `app/api`
          respond entirely in Spanish and the dictionary part is the backup. And with its clue,
          which is the half that says what to do: the guard always answers both, and here one was
          thrown — the same rejection was read entirely by 'open in your terminal' and partially
          by this button.
         */
        note(kind, {
          text: [payload.error ?? t("assignment.failed"), payload.hint].filter(Boolean).join(" "),
          bad: true,
        });
      }
    } catch {
      note(kind, { text: t("task.unreachable"), bad: true });
    } finally {
      setSending(null);
    }
  }

  /*
    And undo it, which is what was missing.
    Ordering was the only action for the form with no turning back: once in the queue, only an
    agent could close it for MCP. Removing does not turn this into a task manager —states are not
    moved manually nor is anything ordered—: it undoes the button next to it, which is something
    else.
   */
  async function withdraw(kind: string) {
    if (withdrawing) return;
    setWithdrawing(kind);
    note(kind, null);
    try {
      const response = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, kind, action: "withdraw" }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        hint?: string;
      };
      if (response.ok) {
        setQueued((previous) => {
          const next = new Set(previous);
          next.delete(kind);
          return next;
        });
        note(kind, { text: t("assignment.withdrawn"), bad: false });
        startTransition(() => router.refresh());
      } else {
        /*
          A 409 here is the token realizing it was no longer there, not a failure: it is counted
          in gray and the sign is removed, which is what the server just said.
         */
        if (response.status === 409) {
          setQueued((previous) => {
            const next = new Set(previous);
            next.delete(kind);
            return next;
          });
        }
        note(kind, {
          text: [payload.error ?? t("assignment.withdrawFailed"), payload.hint]
            .filter(Boolean)
            .join(" "),
          bad: response.status !== 409,
        });
      }
    } catch {
      note(kind, { text: t("task.unreachable"), bad: true });
    } finally {
      setWithdrawing(null);
    }
  }

  /*
    Launching does not enqueue: it does not create a task nor mark the queue, so the page does not
    refresh — the job went to your terminal and whatever happens there will be recorded by the
    commits. It does leave a trace, two: the order file in `~/.panoma/assignments` and a row in
    `launches`, which the path points to after opening the window. Here it said it did not leave
    any.
   */
  async function launch(kind: string) {
    if (launching) return;
    setLaunching(kind);
    note(kind, null);
    try {
      const response = await fetch("/api/assignments/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, kind }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        hint?: string;
        agent?: string;
      };
      note(
        kind,
        response.ok
          ? { text: t("assignment.launched", { agent: payload.agent ?? "" }), bad: false }
          : {
              text: [payload.error ?? t("assignment.launchFailed"), payload.hint]
                .filter(Boolean)
                .join(" "),
              bad: true,
            },
      );
    } catch {
      note(kind, { text: t("task.unreachable"), bad: true });
    } finally {
      setLaunching(null);
    }
  }

  return (
    <div className="rounded-lg border border-edge bg-surface px-4 py-1">
      {assignments.map((assignment) => (
        <RedactedRow
          key={assignment.kind}
          assignment={assignment}
          agent={agent}
          enCola={queued.has(assignment.kind)}
          launching={launching === assignment.kind}
          assigning={sending === assignment.kind}
          withdrawing={withdrawing === assignment.kind}
          ocupado={launching !== null || sending !== null || withdrawing !== null}
          grade={notes[assignment.kind]}
          onLaunch={() => launch(assignment.kind)}
          onAssign={() => assign(assignment.kind)}
          onWithdraw={() => withdraw(assignment.kind)}
        />
      ))}

      {securityOpen && (
        <Row
          title={t("assignment.securityTitle")}
          promise={t("assignment.securityPromise")}
          actions={<RunButton slug={slug} security />}
        />
      )}

      {outdatedDeps > 0 && (
        <Row
          title={t("assignment.depsTitle")}
          promise={t(outdatedDeps === 1 ? "assignment.depsPromiseOne" : "assignment.depsPromiseMany", {
            n: outdatedDeps,
          })}
          actions={
            <a
              href="#dependencies"
              className="inline-flex items-center gap-1 rounded border border-edge bg-raised px-3 py-1.5 font-mono text-[11px] text-smoke transition-colors hover:border-accent hover:text-accent"
            >
              {t("assignment.depsChoose")} <HiOutlineArrowRight aria-hidden />
            </a>
          }
        />
      )}
    </div>
  );
}

function RedactedRow({
  assignment,
  agent,
  enCola,
  launching,
  assigning,
  withdrawing,
  ocupado,
  grade,
  onLaunch,
  onAssign,
  onWithdraw,
}: {
  assignment: AssignmentView;
  agent: LocalAgent;
  enCola: boolean;
  launching: boolean;
  assigning: boolean;
  withdrawing: boolean;
  ocupado: boolean;
  grade: Note | undefined;
  onLaunch: () => void;
  onAssign: () => void;
  onWithdraw: () => void;
}) {
  const t = useT();
  /*
    Opened/closed by hand instead of with `<details>`.
    `details` is a block, so 'copy' next to 'view the order' fell to the next line and the only
    two ways to inspect the order ended up on two different lines. With the state here, both go on
    the same line and the body unfolds below, which is how it is read.
   */
  const [isOpen, setOpen] = useState(false);

  return (
    <Row
      title={assignment.title}
      promise={assignment.promise}
      actions={
        <>
          {/*
             “Do it now” only appears when there is actually an agent to launch. The rest of the
             queue works the same without it: ordering and copying do not depend on anything being
             installed on this machine.
            */}
          {agent.available && (
            <button
              type="button"
              onClick={onLaunch}
              disabled={ocupado}
              title={t("assignment.launchTitle", { agent: agent.agent ?? "" })}
              // The black of the product is `accent` (#0b0b0d), the same as the «open in editor»
              // button: in a row with three ways, the immediate one is the one that is seen.
              className="rounded border border-accent bg-accent px-3 py-1.5 font-mono text-[11px] text-white transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              {t(launching ? "assignment.launching" : "assignment.launch")}
            </button>
          )}
          {enCola ? (
            <span className="inline-flex items-center gap-1 rounded border border-edge bg-raised px-3 py-1.5 font-mono text-[11px] text-faint">
              <HiOutlineCheck aria-hidden /> {t("assignment.queued")}
            </span>
          ) : (
            <ActionButton
              tone="raised"
              type="button"
              onClick={onAssign}
              busy={assigning}
              busyLabel={t("assignment.sending")}
              disabled={ocupado}
              /*
                The other button in the row had a title forever and this one didn't, which is as
                much as to say that the immediate path explains itself and the one afterwards
                doesn't need to be explained. The two differ in when and where what happens,
                happens.
               */
              title={t("assignment.sendTitle")}
            >
              {t("assignment.send")}
            </ActionButton>
          )}
        </>
      }
    >
      {/*
         See and copy go in text and not in button: they are the two ways to inspect the task, not
         to deliver it. With three buttons on the right, the row stopped indicating which is the
         main action.
        */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 font-mono text-[11px]">
        <button
          type="button"
          onClick={() => setOpen(!isOpen)}
          aria-expanded={isOpen}
          className="inline-flex items-center gap-1 text-faint transition-colors hover:text-smoke"
        >
          <HiOutlineChevronRight
            className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
            aria-hidden
          />
          {t("assignment.see")}
        </button>
        <CopyAssignment body={assignment.body} />
        {/*
           Withdraw goes here and not next to the "in line" sign for the same reason as see and
           copy: it is not a way to deliver the assignment, so it does not compete with the two
           buttons on the right. And it only exists while there is something to withdraw.
          */}
        {enCola && (
          <button
            type="button"
            onClick={onWithdraw}
            disabled={ocupado}
            className="text-faint transition-colors hover:text-smoke disabled:opacity-50"
          >
            {t(withdrawing ? "assignment.withdrawing" : "assignment.withdraw")}
          </button>
        )}
      </div>

      {isOpen && (
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-edge bg-raised p-3 font-mono text-[11px] leading-relaxed text-smoke">
          {assignment.body}
        </pre>
      )}

      {grade && (
        <p className={`mt-1.5 font-mono text-[11px] ${grade.bad ? "text-fail" : "text-faint"}`}>
          {grade.text}
        </p>
      )}
    </Row>
  );
}

function Row({
  title,
  promise,
  actions,
  children,
}: {
  title: string;
  promise: string;
  actions: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <article className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-edge py-3.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-chalk">{title}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-faint">{promise}</p>
        {children}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">{actions}</div>
    </article>
  );
}

function CopyAssignment({ body }: { body: string }) {
  const t = useT();
  /* `failed` matters here and not in the other three: the reason is in `use-copied.ts`. */
  const { copied, failed, copy } = useCopied();

  return (
    <>
      <button
        type="button"
        onClick={() => copy(body)}
        className="text-faint transition-colors hover:text-smoke"
      >
        {t(copied ? "assignment.copied" : "assignment.copy")}
      </button>
      {failed && (
        <span role="status" className="text-fail">
          {t("assignment.copyFailed")}
        </span>
      )}
    </>
  );
}
