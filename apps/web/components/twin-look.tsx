"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "./i18n-provider";
import { useLocalAgent } from "./use-local-agent";
import { ActionButton, formatBytes } from "./primitives";

/*
  The critic, with a screen.
  It was the only Twin organ that existed only on the terminal, and the one that handled it the
  worst: `panoma twin look <proyecto>` prints three findings about a capture that you cannot see
  while you read them. A verdict on something invisible cannot be contradicted — "this breaks the
  spacing of header" next to the thumbnail can be checked in a second, and alone you have to
  believe it.
  ── The mailbox is the normal way, and the loose file the exception ─────────────────────
  What repeats is this: the agent finishes, leaves the capture in `.panoma/shots/` because the
  block of `AGENTS.md` asks for it, and here you only have to say which one. That’s why the
  mailbox goes on top and with the images placed, and the upload goes below: uploading a file is
  for what no agent can capture —a desktop app, a Figma frame, a mobile photo— and not for the
  everyday case.
  ── What has already been seen is said, and the button is not hidden
  ───────────────────────────────
  A captured glance carries its badge with what came out. But the button is still there, because
  looking at the same screen again is a legitimate and frequent request: today's portrait is not
  last week's, and a new phrase can reveal what the previous one did not see. Removing the button
  would decide for the viewer; putting the badge first gives them evidence for the decision.
  ── The price comes first, as with everything it spends ──────────────────────────────────
  The essay first and always, without having to remember to ask for it: how many sentences make
  the rod, how many tokens the assignment weighs, how much the image weighs and how much of the
  day's budget remains. It is the same thing `twin look` does in the terminal and the same thing
  distilling does.
  And the warning that cannot be silenced: an image **does not pass through any censor**.
  Everything else that comes out of this recording on its way to a model is censored; pixels are
  not, because there is no way to censor what is not looked at. If there is a password written on
  a terminal in the corner of the capture, that password travels.
 */

/** The four types that the three families of providers accept today. See `ImageType`. */
const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** A mailbox delivery, with what is already known about it. */
export interface InboxShot {
  name: string;
  bytes: number;
  at: string;
  /** Findings of the last look, or `null` if it has never been looked at. */
  findings: number | null;
}

/** The mailbox of a project. */
export interface LookBoard {
  slug: string;
  name: string;
  dir: string;
  skipped: number;
  shots: InboxShot[];
}

interface Finding {
  what: string;
  where: string;
  fix: string;
  cites: string[];
}

interface Receipt {
  /** The line that was saved: is what is needed to order a finding. */
  lookId?: string;
  findings?: Finding[];
  dropped?: number;
  unreadable?: boolean;
  statements?: number;
  model?: string;
  error?: string;
}

interface Estimate {
  statements?: number;
  estimatedTokens?: number;
  imageBytes?: number;
  error?: string;
}

export function TwinLook({
  boards,
  projects,
  maxBytes,
}: {
  boards: LookBoard[];
  /** All projects, for the upload: a single image is also judged against one. */
  projects: { slug: string; name: string }[];
  maxBytes: number;
}) {
  const translate = useT();
  // The date of a delivery is displayed with the language set, not with the system's: on a screen
  // in Spanish, `8/22/2026, 2:05 PM` is from another application.
  const locale = useLocale();
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<{ subject: string; receipt: Receipt } | null>(null);
  const [target, setTarget] = useState(projects[0]?.slug ?? "");

  /**
   * A whole look: the rehearsal, the call, and whatever remains on screen.
   *
   * The essay is not optional nor can it be skipped from here. It costs a trip that does not call
   * any model and in return puts the price upfront, which is the rule for everything spent on this
   * product — and here it matters more than anywhere else, because what travels is an image of the
   * viewer's disk.
   */
  async function look(body: Record<string, unknown>, key: string, subject: string) {
    setBusy(key);
    setNote(null);
    setResult(null);

    try {
      const dry = (await post({ ...body, dryRun: true })) as Estimate;
      if (dry.error) {
        setNote(dry.error);
        return;
      }
      setNote(
        translate("look.estimate", {
          statements: dry.statements ?? 0,
          tokens: dry.estimatedTokens ?? 0,
          size: formatBytes(dry.imageBytes ?? 0),
        }),
      );

      const receipt = (await post({ ...body, dryRun: false })) as Receipt;
      if (receipt.error) {
        setNote(receipt.error);
        return;
      }
      setResult({ subject, receipt });
      setNote(null);
      /* And the insignia of 'already looked at,' which the server renders by reading the memory. */
      router.refresh();
    } catch {
      setNote(translate("project.unreachable"));
    } finally {
      setBusy(null);
    }
  }

  /**
   * The image that the viewer brings, read in the browser.
   *
   * The two checks are the same ones the engine makes when reading a file from the disk, and they
   * are here because the place where a denial costs less is before uploading four megabytes. The
   * limit comes from the server —`MAX_SCREENSHOT_BYTES`— so that there are not two numbers.
   */
  async function upload(picked: File) {
    if (!TYPES.includes(picked.type)) {
      setNote(translate("look.badType"));
      return;
    }
    if (picked.size > maxBytes) {
      setNote(
        translate("look.tooBig", { size: formatBytes(picked.size), cap: formatBytes(maxBytes) }),
      );
      return;
    }

    const data = base64(new Uint8Array(await picked.arrayBuffer()));
    await look(
      { slug: target, image: data, mediaType: picked.type, imageBytes: picked.size },
      "upload",
      picked.name,
    );
  }

  return (
    <section className="mt-8 flex flex-col gap-6">
      {/*
         What cannot be crossed out, said before there is anything to cross out. See header of
         `screenshot.ts`: an image is the only thing that comes out of this disc without going
         through a filter.
        */}
      <p className="font-mono text-xs text-idle">{translate("look.notRedacted")}</p>

      {boards.length === 0 ? (
        <div className="rounded-lg border border-edge px-4 py-4">
          <p className="eyebrow">{translate("look.inboxTitle")}</p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed">{translate("look.noInbox")}</p>
          <p className="mt-1 max-w-2xl font-mono text-xs text-smoke">
            {translate("look.noInboxHint")}
          </p>
        </div>
      ) : (
        boards.map((board) => (
          <div key={board.slug} className="rounded-lg border border-edge px-4 py-4">
            <p className="eyebrow">{translate("look.inboxOf", { project: board.name })}</p>
            <p className="mt-1 font-mono text-xs text-faint">{board.dir}</p>

            {board.shots.length === 0 ? (
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-smoke">
                {translate("look.inboxEmpty")}
              </p>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {board.shots.map((shot) => {
                  const key = `${board.slug}/${shot.name}`;
                  return (
                    <div key={key} className="flex gap-3 rounded border border-edge p-2">
                      {/*
                         The thumbnail comes from `/api/twin/shot`, which serves the bytes without
                         caching: the agent overwrites `home.png` on each pass, so the same
                         address shows a different screen each time.
                        */}
                      {/* eslint-disable-next-line @next/next/no-img-element -- la sirve una ruta propia y cambia en cada pasada: no hay nada que cachear */}
                      <img
                        src={`/api/twin/shot?slug=${encodeURIComponent(board.slug)}&name=${encodeURIComponent(shot.name)}`}
                        alt={shot.name}
                        className="h-20 w-28 shrink-0 rounded border border-edge bg-raised object-cover"
                      />
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="truncate font-mono text-xs">{shot.name}</span>
                        <span className="font-mono text-xs text-faint">
                          {formatBytes(shot.bytes)} · {new Date(shot.at).toLocaleString(locale)}
                        </span>
                        {shot.findings !== null && (
                          <span className="font-mono text-xs text-smoke">
                            {shot.findings === 0
                              ? translate("look.lookedClean")
                              : translate("look.looked", { n: shot.findings })}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => look({ slug: board.slug, shot: shot.name }, key, shot.name)}
                          disabled={busy !== null}
                          className="mt-auto self-start rounded border border-edge px-2.5 py-1 font-mono text-xs text-smoke transition-colors hover:border-chalk disabled:opacity-50"
                        >
                          {busy === key
                            ? translate("look.looking")
                            : translate(shot.findings === null ? "look.button" : "look.buttonAgain")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {board.skipped > 0 && (
              <p className="mt-2 font-mono text-xs text-faint">
                {translate("look.inboxSkipped", { n: board.skipped })}
              </p>
            )}
          </div>
        ))
      )}

      {/* And what no agent can capture. See header. */}
      {projects.length > 0 && (
        <div className="rounded-lg border border-edge px-4 py-4">
          <p className="eyebrow">{translate("look.uploadTitle")}</p>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-smoke">
            {translate("look.uploadHint")}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              aria-label={translate("look.uploadTarget")}
              className="rounded border border-edge bg-transparent px-2 py-1 font-mono text-xs"
            >
              {projects.map((project) => (
                <option key={project.slug} value={project.slug}>
                  {project.name}
                </option>
              ))}
            </select>
            <input
              ref={file}
              type="file"
              accept={TYPES.join(",")}
              className="hidden"
              onChange={(event) => {
                const picked = event.target.files?.[0];
                // And it empties: choosing the same file twice in a row does not trigger `change`.
                event.target.value = "";
                if (picked) void upload(picked);
              }}
            />
            <ActionButton
              tone="plain"
              type="button"
              onClick={() => file.current?.click()}
              busy={busy === "upload"}
              busyLabel={translate("look.looking")}
              disabled={busy !== null || target === ""}
            >
              {translate("look.uploadPick")}
            </ActionButton>
          </div>
        </div>
      )}

      {note && <p className="font-mono text-xs text-smoke">{note}</p>}
      {result && <Verdict subject={result.subject} receipt={result.receipt} />}
    </section>
  );
}

/**
 * What you just said, in front and whole.
 *
 * The three fields go together and in their order because they are a single movement: what is
 * wrong, where it is seen, and what to ask for. The last one is the one that saves the work—the
 * next order, already written—and the phrase of the portrait that breaks goes below in gray, which
 * is where it is verified that this comes from what you signed and not from the taste of a model.
 */
function Verdict({ subject, receipt }: { subject: string; receipt: Receipt }) {
  const translate = useT();
  const findings = receipt.findings ?? [];

  return (
    <div className="rounded-lg border border-edge px-4 py-4">
      <p className="eyebrow">{translate("look.verdictOf", { subject })}</p>

      {receipt.unreadable ? (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-idle">
          {translate("look.unreadable")}
        </p>
      ) : findings.length === 0 ? (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed">{translate("look.clean")}</p>
      ) : (
        <LookFindings lookId={receipt.lookId ?? ""} findings={findings} assigned={{}} />
      )}

      <p className="mt-3 font-mono text-xs text-faint">
        {translate("look.measured", { statements: receipt.statements ?? 0 })}
        {receipt.model ? ` · ${receipt.model}` : ""}
      </p>
      {/*
         Unbacked judgments, counted. The model will have opinions about your screen —it has
         opinions about everything— and saying how many have been thrown out is what distinguishes
         'this comes from your phrases' from 'this comes from its taste'.
        */}
      {(receipt.dropped ?? 0) > 0 && (
        <p className="mt-1 font-mono text-xs text-faint">
          {translate("look.dropped", { n: receipt.dropped ?? 0 })}
        </p>
      )}
    </div>
  );
}

/**
 * The findings of a glance, each with what it takes for it to stop being so.
 *
 * This is where the critic stops being advice. Previously it would write the assignment —'unify the
 * edge of the three cards'— and it had to be copied by hand to the agent, meaning that the step
 * for which this organ exists to remove still had a manual step within it, and the last one.
 *
 * **Ordering it** leaves the message in the project queue: any agent connected through MCP reads
 * it with `panoma_tasks` and can pick it up, without having to open anything. **Do it now** opens
 * a terminal with the agent already working on that order, and it only shows if this machine can
 * do it — a «now» that doesn't happen is worse than not offering it.
 *
 * The second one appears **after** the first one and not in its place. What is sent is the row
 * that Panoma wrote and saved, read from the database by its identifier: the text that an agent
 * with permission to edit receives cannot leave the browser. It is the same rule that makes what
 * is sent to place an order a finding number and not its phrase.
 *
 * Both surfaces are rendered —the newly made look and the saved ones— with the same component,
 * because they are the same list. The only thing that changes is that the saved ones already know
 * which ones are assigned; a newly made one cannot have any.
 */
export function LookFindings({
  lookId,
  findings,
  assigned,
  launched = [],
  discarded = [],
}: {
  lookId: string;
  findings: Finding[];
  /** From the finding index to the live assignment that came from it, if there is one. */
  assigned: Record<number, string>;
  /**
   * Of those assignments, which ones have already gone out to an agent.
   *
   * With a default value because the freshly made look has none: its findings have just been born
   * and there is still no task to launch, much less launched.
   */
  launched?: string[];
  /**
   * Which ones did you say no to?
   *
   * It is rendered, it is not hidden. A discarded finding that disappeared from the list would
   * leave the screen telling a false story —"the critic saw two things" when it saw three— and
   * would also remove the only way to change one's mind.
   */
  discarded?: number[];
}) {
  const translate = useT();
  const router = useRouter();
  const agent = useLocalAgent();
  const [tasks, setTasks] = useState<Record<number, string>>(assigned);
  const [out, setOut] = useState<ReadonlySet<string>>(() => new Set(launched));
  const [dead, setDead] = useState<ReadonlySet<number>>(() => new Set(discarded));
  const [busy, setBusy] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});

  function note(index: number, text: string) {
    setNotes((before) => ({ ...before, [index]: text }));
  }

  async function assign(index: number) {
    setBusy(index);
    try {
      const response = await fetch("/api/twin/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The finding number, never its text. See the header of the path.
        body: JSON.stringify({ lookId, finding: index }),
      });
      const payload = (await response.json()) as {
        id?: string;
        title?: string;
        project?: string;
        error?: string;
      };

      if (!response.ok) {
        /*
          A 409 is not an error: it means it was already ordered, and it brings the identifier of
          the one that existed. It is saved anyway, which is what keeps the button next to it
          working.
         */
        if (payload.id) setTasks((before) => ({ ...before, [index]: payload.id! }));
        note(index, payload.error ?? String(response.status));
        return;
      }

      if (payload.id) setTasks((before) => ({ ...before, [index]: payload.id! }));
      // Ordering what you had discarded is changing your mind, and the 'discarded' is unnecessary.
      setDead((before) => {
        const next = new Set(before);
        next.delete(index);
        return next;
      });
      note(
        index,
        translate("look.assignDone", {
          project: payload.project ?? "",
          title: payload.title ?? "",
        }),
      );
      router.refresh();
    } catch {
      note(index, translate("project.unreachable"));
    } finally {
      setBusy(null);
    }
  }

  /**
   * To say no.
   *
   * The same route to order, with the decision inside: what changes is the state with which the
   * row is born, not where the text comes from. And the row is needed —it's not enough to not
   * press anything— because without it, 'I looked at it and it's no good' looks exactly the same
   * as 'I haven't looked at it yet,' which is the difference the critic needs to gauge themselves.
   */
  async function dismiss(index: number) {
    setBusy(index);
    try {
      const response = await fetch("/api/twin/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookId, finding: index, decision: "discard" }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        note(index, payload.error ?? String(response.status));
        return;
      }
      setDead((before) => new Set(before).add(index));
      // Discarding what was in the queue takes it out of it: the launch button no longer has a task
      // to target, and leaving it rendered would be promising a terminal that doesn't open.
      setTasks((before) => {
        const next = { ...before };
        delete next[index];
        return next;
      });
      note(index, translate("look.dismissDone"));
      router.refresh();
    } catch {
      note(index, translate("project.unreachable"));
    } finally {
      setBusy(null);
    }
  }

  async function launch(index: number, taskId: string) {
    setBusy(index);
    try {
      const response = await fetch("/api/assignments/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      const payload = (await response.json()) as { agent?: string; error?: string };
      // The button finds out right here: the line is already written, but reloading the page to see
      // a word change on the button you just pressed would be a journey for nothing.
      if (response.ok) setOut((before) => new Set(before).add(taskId));
      note(
        index,
        response.ok
          ? translate("look.assignLaunched", { agent: payload.agent ?? "" })
          : (payload.error ?? String(response.status)),
      );
    } catch {
      note(index, translate("project.unreachable"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ol className="mt-3 flex flex-col gap-4">
      {findings.map((finding, index) => {
        const taskId = tasks[index];
        const no = dead.has(index);
        return (
          <li key={index} className="flex flex-col gap-1">
            <p className="max-w-2xl text-sm leading-relaxed">{finding.what}</p>
            <p className="max-w-2xl font-mono text-xs text-faint">{finding.where}</p>
            <p className="max-w-2xl text-sm leading-relaxed text-smoke">
              {translate("look.fix", { fix: finding.fix })}
            </p>
            {finding.cites.map((cite) => (
              <p key={cite} className="max-w-2xl font-mono text-xs text-faint">
                {translate("look.against", { statement: cite })}
              </p>
            ))}

            {/*
               Without a look identifier there is nothing to order: it happens with those saved
               from before this column existed. The record is still read in full; what cannot be
               done is promise a button that has nothing to point to.
              */}
            {lookId !== "" && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <ActionButton
                  tone="plain"
                  type="button"
                  onClick={() => void assign(index)}
                  busy={busy === index && taskId === undefined}
                  busyLabel={translate("look.assigning")}
                  disabled={busy !== null || taskId !== undefined}
                >
                  {taskId !== undefined ? translate("look.assigned") : translate("look.assignButton")}
                </ActionButton>
                {/*
                   And the other side of the decision, which until today did not exist: saying no.
                   It goes alongside ordering and not hidden in a menu, because the response that
                   gauges a critic is rejection, not applause.
                   It disappears when it is already discarded —there is nothing to discard twice—
                   and the one about ordering remains: changing your mind is legitimate and must
                   be accommodated.
                  */}
                {!no && (
                  <button
                    type="button"
                    onClick={() => void dismiss(index)}
                    disabled={busy !== null}
                    className="rounded border border-edge px-2.5 py-1 font-mono text-xs text-faint transition-colors hover:border-chalk hover:text-smoke disabled:opacity-50"
                  >
                    {translate("look.dismissButton")}
                  </button>
                )}
                {no && (
                  <span className="font-mono text-xs text-faint">
                    {translate("look.dismissed")}
                  </span>
                )}
                {taskId !== undefined && agent.available && (
                  <button
                    type="button"
                    onClick={() => void launch(index, taskId)}
                    disabled={busy !== null}
                    className="rounded border border-accent bg-accent px-2.5 py-1 font-mono text-xs text-white transition-opacity hover:opacity-85 disabled:opacity-50"
                  >
                    {/*
                       'Again' when it has already come out, which is something that until now
                       could not be known. The button does not turn off: relaunching is legitimate
                       —the terminal closed, the agent was lost— and what is needed is for it to
                       be seen, not for it to be prevented.
                      */}
                    {translate(out.has(taskId) ? "look.assignAgain" : "look.assignNow")}
                  </button>
                )}
              </div>
            )}
            {notes[index] && (
              <p className="max-w-2xl font-mono text-xs text-smoke">{notes[index]}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch("/api/twin/look", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (response.ok) return payload;
  return { ...payload, error: payload["error"] ?? String(response.status) };
}

/**
 * Base64 in chunks.
 *
 * A sudden hit doesn't count: `String.fromCharCode(...bytes)` with three megas inside crashes the
 * browser's call stack, and it's exactly the normal size of a full screenshot.
 */
function base64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(binary);
}
