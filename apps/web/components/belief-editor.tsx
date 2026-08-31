"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./i18n-provider";
import type { MessageKey } from "@/lib/i18n";
import { citationDay, topicKey, type BeliefView } from "@/lib/taste-view";
import { ActionButton } from "./primitives";

/*
  The portrait, and the four gestures that direct it.
  This screen was a **queue**: sentences that a model had written about you, each waiting for a
  yes or no. With 2,278 quotes in the author's corpus, that's hundreds of decisions, and the
  author—the most motivated user this product will have—got bored on the nineteenth. Worse than
  bored: it recreated inside the product the task that the product exists to remove, that of
  reading what a machine produced and judging it one by one.
  It is now an **editor**. What you see is the portrait already written, by topic, with the
  evidence under each belief. There is nothing to approve: if you don't touch anything, the
  portrait is what the synthesis deduced, and it is already in `TASTE.md`. Reading is optional;
  directing, too.
  ── The four gestures, and none mandatory ─────────────────────────────────────
  - **Sign** —as is or by editing the sentence—, which takes it out of the reach of the synthesis
  forever. Editing and fixing are the same gesture with or without text: both end in a belief that
  the machine no longer touches, and separating them would have given two buttons that do the same
  thing.
  - **Veto**, which sends it to the cemetery. It does not delete: it remains as negative evidence
  so that the synthesis does not propose it again. A veto that deleted the row would have to be
  repeated every week.
  - **To limit**, which confines it to the project where it was learned or sends it back to
  everything you do. It is the cheap answer when the portrait does not fit: a limited belief stops
  costing tokens to the other one hundred eleven projects and no one loses anything.
  - **Resolve** a proposal, which is the only queue left: the synthesis wanted to touch something
  you signed, and it cannot do that alone.
  ── It is marked immediately and saved once ──────────────────────────────────────
  Each click marks and sends nothing, just like before and for the same two reasons. One: each
  `POST` reconciles `TASTE.md` by reading and rewriting it, so twelve consecutive clicks are
  twelve reads and writes of the same file overlapping each other. Two, and more importantly: this
  is a reading session, not twelve isolated gestures — and seeing the whole portrait changes what
  you think about the third belief when you are at the ninth.
 */

const BADGE: Record<BeliefView["badge"], MessageKey> = {
  signed: "twin.badgeSigned",
  standing: "twin.badgeStanding",
  forming: "twin.badgeForming",
};

/** A gesture marked over a belief, before storing it. */
type Gesture =
  | { kind: "sign"; statement?: string }
  | { kind: "veto" }
  | { kind: "scope"; identity: string | null };

export function BeliefEditor({
  beliefs,
  graveyard,
  proposals,
  locale,
}: {
  beliefs: BeliefView[];
  graveyard: BeliefView[];
  proposals: BeliefView[];
  locale: "es" | "en";
}) {
  const translate = useT();
  const router = useRouter();
  const [gestures, setGestures] = useState<Map<string, Gesture>>(new Map());
  const [answers, setAnswers] = useState<Map<string, boolean>>(new Map());
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
    By subject and in the order in which they arrive, which is that of the server and that of the
    file. Sorting here by something else would make the screen and `TASTE.md` not be read the same
    way, and the file is the other half of this interface: whoever deletes a line in their editor
    is vetoing.
   */
  const byTopic = useMemo(() => {
    const groups = new Map<string, BeliefView[]>();
    for (const one of beliefs) {
      const list = groups.get(one.topic);
      if (list) list.push(one);
      else groups.set(one.topic, [one]);
    }
    return [...groups];
  }, [beliefs]);

  const marked = gestures.size > 0 || answers.size > 0;

  function set(id: string, gesture: Gesture | undefined) {
    setGestures((current) => {
      const copy = new Map(current);
      if (gesture === undefined) copy.delete(id);
      else copy.set(id, gesture);
      return copy;
    });
  }

  /**
   * A gesture on which it was already marked removes it, which is how you change your mind.
   *
   * With one exception: signing exactly **on top of an edition** is not unchecking, it is changing
   * your mind about how to sign it. Without it, pressing "it's well said" after having written
   * your own version deleted the entire gesture and with it what had been typed, which could not
   * be recovered from anywhere — and the button would appear inactive, so it seemed as if nothing
   * had happened.
   */
  function toggle(id: string, gesture: Gesture) {
    const now = gestures.get(id);
    const escrita = now?.kind === "sign" && now.statement !== undefined;
    if (now && now.kind === gesture.kind && !escrita) set(id, undefined);
    else set(id, gesture);
  }

  async function save() {
    setSaving(true);
    setError(null);

    const sign: { id: string; statement?: string }[] = [];
    const veto: string[] = [];
    const scope: { id: string; identity: string | null }[] = [];
    for (const [id, gesture] of gestures) {
      if (gesture.kind === "sign") {
        sign.push({ id, ...(gesture.statement ? { statement: gesture.statement } : {}) });
      } else if (gesture.kind === "veto") veto.push(id);
      else scope.push({ id, identity: gesture.identity });
    }
    const resolve = [...answers].map(([id, accept]) => ({ id, accept }));

    try {
      const response = await fetch("/api/twin/taste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sign, veto, scope, resolve }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? String(response.status));
        return;
      }
      setGestures(new Map());
      setAnswers(new Map());
      setEditing(null);
      router.refresh();
    } catch {
      setError(translate("project.unreachable"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {proposals.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            {translate("twin.proposalsTitle")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-smoke">
            {translate("twin.proposalsNote")}
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {proposals.map((one) => (
              <li
                key={one.id}
                className={`rounded-lg border px-4 py-4 ${
                  answers.has(one.id) ? "border-l-2 border-l-chalk border-edge" : "border-edge"
                }`}
              >
                <p className="eyebrow">
                  {topicName(one.topic, translate)}
                  {one.supersedes && one.supersedes.length > 1
                    ? ` · ${translate("twin.proposalJoins", { n: one.supersedes.length })}`
                    : ""}
                </p>
                {/*
                   What they say today, above and **whole**. Without them the question is "do you
                   like this sentence?", which is not the question: the question is whether this
                   says what those said, and that is only answered with the two parts in front.
                   And they are sentences that the person signed: accepting them makes them
                   disappear from the portrait, so hiding them would be the silent compression
                   that `taste.ts` forbids.
                  */}
                {one.supersedes?.map((antes) => (
                  <p
                    key={antes}
                    className="mt-1 max-w-2xl text-sm leading-relaxed text-smoke line-through decoration-faint"
                  >
                    {antes}
                  </p>
                ))}
                <p className="mt-2 max-w-2xl text-[15px] leading-relaxed">{one.statement}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Action
                    label={translate("twin.proposalAccept")}
                    active={answers.get(one.id) === true}
                    onClick={() => setAnswers(flip(answers, one.id, true))}
                  />
                  <Action
                    label={translate("twin.proposalReject")}
                    active={answers.get(one.id) === false}
                    onClick={() => setAnswers(flip(answers, one.id, false))}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {byTopic.map(([topic, rows]) => (
        <section key={topic} className="mt-12">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            {topicName(topic, translate)}
          </h2>
          <ul className="mt-4 flex flex-col gap-3">
            {rows.map((one) => (
              <Card
                key={one.id}
                belief={one}
                locale={locale}
                gesture={gestures.get(one.id)}
                editing={editing === one.id}
                onEdit={(next) => setEditing(next ? one.id : null)}
                onGesture={(gesture) => toggle(one.id, gesture)}
                onWrite={(statement) => set(one.id, { kind: "sign", statement })}
                translate={translate}
              />
            ))}
          </ul>
        </section>
      ))}

      {graveyard.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            {translate("twin.graveyardTitle")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-smoke">
            {translate("twin.graveyardNote")}
          </p>
          <ul className="mt-4 flex flex-col gap-2">
            {graveyard.map((one) => (
              <li key={one.id} className="rounded-lg border border-edge px-4 py-3 opacity-60">
                <p className="text-sm leading-relaxed text-smoke line-through decoration-faint">
                  {one.statement}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {marked && (
        <div className="sticky bottom-4 z-10 mt-8 flex flex-wrap items-center gap-3 rounded-lg border border-edge bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
          <span className="font-mono text-xs text-smoke">
            {translate("twin.markedGestures", { n: gestures.size + answers.size })}
          </span>
          <ActionButton
            tone="accent"
            type="button"
            onClick={save}
            busy={saving}
            busyLabel={translate("twin.saving")}
          >
            {translate("twin.save")}
          </ActionButton>
          <button
            type="button"
            onClick={() => {
              setGestures(new Map());
              setAnswers(new Map());
              setEditing(null);
            }}
            disabled={saving}
            className="font-mono text-xs text-smoke underline-offset-2 hover:underline disabled:opacity-50"
          >
            {translate("twin.cancel")}
          </button>
          {error && (
            <span className="font-mono text-xs text-fail">
              {translate("twin.saveFailed", { detail: error })}
            </span>
          )}
        </div>
      )}
    </>
  );
}

/*
  The map lives in `lib/taste-view.ts`: the card of a project shows the same subjects from the
  server, and two copies give two names for the same thing in the same session.
 */
function topicName(
  topic: string,
  translate: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  const key = topicKey(topic);
  return key ? translate(key) : topic;
}

function flip(current: Map<string, boolean>, id: string, next: boolean): Map<string, boolean> {
  const copy = new Map(current);
  if (copy.get(id) === next) copy.delete(id);
  else copy.set(id, next);
  return copy;
}

function Card({
  belief,
  locale,
  gesture,
  editing,
  onEdit,
  onGesture,
  onWrite,
  translate,
}: {
  belief: BeliefView;
  locale: "es" | "en";
  gesture?: Gesture;
  editing: boolean;
  onEdit: (open: boolean) => void;
  onGesture: (gesture: Gesture) => void;
  onWrite: (statement: string) => void;
  translate: (key: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(belief.statement);
  const written = gesture?.kind === "sign" ? gesture.statement : undefined;

  return (
    <li
      className={[
        "rounded-lg border px-4 py-4 transition-colors",
        gesture?.kind === "sign"
          ? "border-l-2 border-l-live border-edge bg-live/[0.05]"
          : gesture?.kind === "veto"
            ? "border-l-2 border-l-faint border-edge opacity-60"
            : gesture !== undefined
              ? "border-l-2 border-l-chalk border-edge"
              : "border-edge",
      ].join(" ")}
    >
      <p className="eyebrow">
        <span className={belief.badge === "forming" ? "text-idle" : ""}>
          {translate(BADGE[belief.badge])}
        </span>
        {belief.scope ? ` · ${translate("twin.scopedTag", { project: belief.scope })}` : ""}
      </p>

      {editing ? (
        <div className="mt-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            /*
              The sentence above is the model's belief, not the label of this field: whoever does
              not see the screen heard 'text area' and nothing else.
             */
            aria-label={translate("twin.editText")}
            rows={3}
            className="w-full max-w-2xl rounded border border-edge bg-transparent px-3 py-2 text-[15px] leading-relaxed"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {/*
               Emptying the text is not signing in blank. It stored `{kind:"sign", statement:""}`,
               the card represented the belief without a phrase —`""` is not nullish— and when
               saving the empty string it was discarded, so the phrase **from the model** was
               signed as if it were its own. Without text there is no own version: the button does
               nothing.
              */}
            <Action
              label={translate("twin.editSave")}
              active
              onClick={() => {
                if (draft.trim() === "") return;
                onWrite(draft.trim());
                onEdit(false);
              }}
            />
            <Action
              label={translate("twin.cancel")}
              onClick={() => {
                setDraft(belief.statement);
                onEdit(false);
              }}
            />
          </div>
        </div>
      ) : (
        <p className="mt-1 max-w-2xl text-[15px] leading-relaxed">
          {written ?? belief.statement}
        </p>
      )}

      {/*
         Evidence, always raw. It's what turns a belief into something that can be discussed, and
         what can be discussed can be thrown away: without this number, 'you haven't signed it'
         would be the only defense against an invented phrase, and here no one signs anything.
        */}
      <p className="mt-2 font-mono text-xs text-smoke">
        {translate("twin.support", {
          observations: belief.support.observations,
          projects: belief.support.projects,
          days: belief.support.days,
        })}
        {/*
           And what is missing for the one that is in training. The three numbers alone do not say
           it: you have to know that the soil requires three observations **and** two sites, and
           that rule lives in the catalog. Without the phrase, "in training" is a label that
           cannot be acted upon — the person does not know whether to wait, distill more, or sign
           it themselves.
          */}
        {belief.badge === "forming" ? (
          <span className="text-idle">{` · ${translate("twin.formingWhy")}`}</span>
        ) : null}
        {belief.citations.length > 0 && (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => setOpen((now) => !now)}
              className="underline-offset-2 hover:underline"
            >
              {translate(open ? "twin.hideCitations" : "twin.showCitations", {
                n: belief.citations.length,
              })}
            </button>
          </>
        )}
      </p>

      {open && (
        <ul className="mt-3 flex flex-col gap-2.5 border-l border-edge pl-3">
          {belief.citations.map((cite) => (
            <li key={cite.verdictId}>
              {/*
                 Trimmed to two lines, and not for aesthetics. Measured in the author's corpus: a
                 real quote can exceed six hundred characters—a whole order dictated in one
                 sitting, with six changes within. The full text is still there: in the attribute
                 `title` and when copying.
                */}
              <p className="line-clamp-2 text-sm italic leading-snug text-smoke" title={cite.quote}>
                «{cite.quote}»
              </p>
              <p className="mt-0.5 font-mono text-xs text-faint">
                {citationDay(cite.at, locale)}
                {cite.project ? ` · ${translate("twin.citedIn", { project: cite.project })}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      {!editing && (
        <div className="mt-3 flex flex-wrap gap-2">
          {/*
             Sign only if it is not already signed: a signed one cannot be signed again and the
             button would do nothing. Editing it yes, and that signs it again with the new words.
            */}
          {belief.badge !== "signed" && (
            <Action
              label={translate("twin.sign")}
              active={gesture?.kind === "sign" && written === undefined}
              onClick={() => onGesture({ kind: "sign" })}
            />
          )}
          <Action
            label={translate("twin.edit")}
            active={written !== undefined}
            onClick={() => {
              setDraft(written ?? belief.statement);
              onEdit(true);
            }}
          />
          <Action
            label={translate("twin.veto")}
            active={gesture?.kind === "veto"}
            onClick={() => onGesture({ kind: "veto" })}
          />
          {/*
             Limit only when there is something to limit. A belief without a project —the evidence
             comes from several— cannot be limited to any, and a button that cannot function is
             worse than its absence. The one that is already limited shows the way back.
            */}
          {belief.scope ? (
            <Action
              label={translate("twin.scopeAll")}
              active={gesture?.kind === "scope" && gesture.identity === null}
              onClick={() => onGesture({ kind: "scope", identity: null })}
            />
          ) : belief.learnedIn ? (
            <Action
              label={translate("twin.scopeOnly", { project: belief.learnedIn.name })}
              active={gesture?.kind === "scope"}
              onClick={() =>
                onGesture({ kind: "scope", identity: belief.learnedIn?.identity ?? null })
              }
            />
          ) : null}
        </div>
      )}
    </li>
  );
}

function Action({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded border px-2.5 py-1 font-mono text-xs transition-colors",
        active ? "border-accent text-accent" : "border-edge text-smoke hover:border-chalk",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
