"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "./i18n-provider";
import type { MessageKey } from "@/lib/i18n";
import { citationDay, topicKey, type BeliefView, type Citation } from "@/lib/taste-view";
import {
  OBSERVATION_KIND_KEYS,
  PUBLICATION_STATUS_KEYS,
  PUBLICATION_STATUS_TONES,
  familiesLine,
  jobReasonKey,
  proposalGroups,
  tasteRefusalKey,
  SUPPORT_FAMILIES_FLOOR,
  type CriterionRowView,
  type EvidenceMark,
  type PublicationView,
} from "@/lib/memory-view";
import { ActionButton, ActionError, Notice, Tag, TextArea, relativeDate } from "./primitives";

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
  ── Since delivery D every gesture names the revision it saw ─────────────────────────
  The body is the revisioned one (`version: 2`): each gesture carries `expectedRevision`, the
  `memory_rev` of the criterion as this screen read it, and the door applies the whole batch or
  nothing. A criterion that moved meanwhile — a synthesis, another tab, a scope from the
  terminal — is refused as `stale_revision` with nothing applied; the card says so and reloads,
  so the person signs what is there and never a sentence they did not read. The door takes
  twenty gestures at a time, so a longer session is sent in batches of twenty, in order, and
  stops at the first refusal with the earlier batches applied. A narrowing names the project by
  its slug and the scope in so many words, because the door refuses a slug alone.
  ── What is signed is what is read ────────────────────────────────────────────────
  A criterion may carry typed conditions and exceptions (plan §10.1), drawn here as the same
  sentences the brief and the agent read («Applies when», «Except when»), read-only. Signing a
  criterion that shows them restates them in the gesture: the door clears a model's trees under
  a bare signature, so the only way the trees a person saw become signed is to send them back,
  and the hint under the row says that is what signing does. Editing a signed row keeps the
  trees it already had, by the door's rule for silence.
  ── Independence, and the proposals grouped with every evidence ──────────────────────
  Under an inference the row says how many independent cases stand behind it (plan §10.2) and
  the floor an automatic publication needs; an inherited row says it was never counted. The
  proposals of the synthesis are grouped by the signed criteria they would replace, and each
  proposal shows all of its evidence open, with the kind of every quote — an ambiguous reaction
  is tagged as founding nothing, so a «perfecto» never reads as a preference.
  ── The publication is a state of its own ─────────────────────────────────────────
  `TwinPublication` draws what the outbox says about the file: pending, written, failed, or in
  conflict because the file moved since the publication was prepared (plan §10.4). A conflict is
  never a veto; the notice offers to reconcile, which is one more plan through the same door —
  the permission restated with the generation this screen read — and the outbox then reads the
  file again, keeps the person's edits and writes what is publishable.
 */

const BADGE: Record<BeliefView["badge"], MessageKey> = {
  signed: "twin.badgeSigned",
  standing: "twin.badgeStanding",
  forming: "twin.badgeForming",
};

/** How many gestures the door takes in one request; a longer session goes in batches of this size. */
export const GESTURES_PER_REQUEST = 20;

/** A gesture marked over a belief, before storing it. */
type Gesture =
  | { kind: "sign"; statement?: string }
  | { kind: "veto" }
  | { kind: "scope"; slug: string | null };

/** The revisioned body of the portrait door, one batch. */
interface GestureBatch {
  version: 2;
  sign: { id: string; expectedRevision: number; statement?: string; conditions?: CriterionRowView["conditions"]; exceptions?: CriterionRowView["exceptions"] }[];
  veto: { id: string; expectedRevision: number }[];
  scope: { id: string; expectedRevision: number; scope: "global" | "project"; slug?: string }[];
  resolve: { id: string; expectedRevision: number; accept: boolean }[];
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function BeliefEditor({
  beliefs,
  graveyard,
  proposals,
  unpublished,
  locale,
  criteria,
  evidence,
  slugs,
}: {
  beliefs: BeliefView[];
  graveyard: BeliefView[];
  proposals: BeliefView[];
  /**
   * The ids of the beliefs that would fit in the portrait and are not in the file.
   *
   * `budgetOf` has returned this set since the day `taste-budget.ts` was written, and no screen
   * ever drew it — which put back the exact confusion that file records: a catalog with 27
   * publishable sentences, a file with 14, and one list showing all 27 as «what represents you».
   * A belief nobody reads and a belief every agent reads looked identical.
   */
  unpublished: ReadonlySet<string>;
  locale: "es" | "en";
  /** Per belief id: its revision, its predicates as trees and sentences, its independence. */
  criteria: Record<string, CriterionRowView>;
  /** Per belief id, per quote (`verdictId`): the kind of the observation it came from. */
  evidence: Record<string, Record<string, EvidenceMark>>;
  /** From a project's identity to its slug, for the projects a criterion may be narrowed to. */
  slugs: Record<string, string>;
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

  /* The proposals, one group per set of signed criteria they would replace, every evidence kept. */
  const groups = useMemo(() => proposalGroups(proposals), [proposals]);

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

  /** The revision this screen read for a belief; a row the page did not shape names 0 and is refused, never guessed. */
  const revisionOf = (id: string) => criteria[id]?.revision ?? 0;

  /**
   * The batches, twenty gestures each, in the order they were marked. Signing an unsigned
   * criterion restates the trees it shows; an edited signed row says nothing about them.
   */
  function batches(): GestureBatch[] {
    const out: GestureBatch[] = [];
    let current: GestureBatch = { version: 2, sign: [], veto: [], scope: [], resolve: [] };
    let count = 0;
    const push = (add: (batch: GestureBatch) => void) => {
      if (count === GESTURES_PER_REQUEST) {
        out.push(current);
        current = { version: 2, sign: [], veto: [], scope: [], resolve: [] };
        count = 0;
      }
      add(current);
      count += 1;
    };
    for (const [id, gesture] of gestures) {
      const expectedRevision = revisionOf(id);
      if (gesture.kind === "sign") {
        const row = criteria[id];
        const signed = beliefs.find((one) => one.id === id)?.badge === "signed";
        push((batch) => batch.sign.push({
          id, expectedRevision,
          ...(gesture.statement ? { statement: gesture.statement } : {}),
          ...(!signed && row?.conditions ? { conditions: row.conditions } : {}),
          ...(!signed && row?.exceptions ? { exceptions: row.exceptions } : {}),
        }));
      } else if (gesture.kind === "veto") {
        push((batch) => batch.veto.push({ id, expectedRevision }));
      } else {
        const slug = gesture.slug;
        push((batch) => batch.scope.push({ id, expectedRevision, ...(slug ? { scope: "project", slug } : { scope: "global" }) }));
      }
    }
    for (const [id, accept] of answers) push((batch) => batch.resolve.push({ id, expectedRevision: revisionOf(id), accept }));
    if (count > 0) out.push(current);
    return out;
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      for (const batch of batches()) {
        const response = await fetch("/api/twin/taste", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(batch),
        });
        const payload = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
        /* 200 written inline, 202 still in the outbox: both are applied gestures. */
        if (!response.ok) {
          const key = tasteRefusalKey(payload.code);
          setError(key ? translate(key) : payload.error ?? String(response.status));
          /* A moved revision applied nothing: the screen reloads so the next signature is over what is there. */
          if (payload.code === "stale_revision" || payload.code === "publication_conflict") router.refresh();
          return;
        }
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
      {groups.length > 0 && (
        <section className="mt-8">
          <h3 className="text-sm font-semibold">
            {translate("twin.proposalsTitle")}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-smoke">
            {translate("twin.proposalsNote")}
          </p>
          <ul className="mt-4 flex flex-col gap-3" role="list">
            {groups.map((group) => {
              const first = group.proposals[0]!;
              const key = group.criteria.length > 0 ? group.criteria.join("\0") : first.id;
              return (
                <li key={key} className="rounded-lg border border-edge px-4 py-4">
                  <p className="eyebrow">
                    {topicName(first.topic, translate)}
                    {group.criteria.length > 1
                      ? ` · ${translate("twin.proposalJoins", { n: group.criteria.length })}`
                      : ""}
                    {group.proposals.length > 1
                      ? ` · ${translate("twin.proposalGroup", { n: group.proposals.length })}`
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
                  {group.criteria.map((antes) => (
                    <p
                      key={antes}
                      className="mt-1 max-w-2xl text-sm leading-relaxed text-smoke line-through decoration-faint"
                    >
                      {antes}
                    </p>
                  ))}
                  <ul className="mt-2 flex flex-col gap-3" role="list">
                    {group.proposals.map((one) => (
                      <li
                        key={one.id}
                        className={`rounded border px-3 py-3 ${
                          answers.has(one.id) ? "border-l-2 border-l-chalk border-edge" : "border-edge"
                        }`}
                      >
                        <p className="max-w-2xl text-base leading-relaxed">{one.statement}</p>
                        <Predicates view={criteria[one.id]} translate={translate} />
                        <p className="mt-2 font-mono text-xs text-smoke">
                          <Families view={criteria[one.id]} translate={translate} />
                          {one.citations.length > 0 ? ` · ${translate("twin.proposalEvidence", { n: one.citations.length })}` : ""}
                        </p>
                        {/* Every evidence of a proposal, open: a question is answered with all of it in front. */}
                        <Citations citations={one.citations} marks={evidence[one.id] ?? {}} locale={locale} translate={translate} />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Action
                            label={translate("twin.proposalAccept")}
                            toggle
                            active={answers.get(one.id) === true}
                            onClick={() => setAnswers(flip(answers, one.id, true))}
                          />
                          <Action
                            label={translate("twin.proposalReject")}
                            toggle
                            active={answers.get(one.id) === false}
                            onClick={() => setAnswers(flip(answers, one.id, false))}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {byTopic.map(([topic, rows]) => (
        <section key={topic} className="mt-8">
          <h3 className="text-sm font-semibold">
            {topicName(topic, translate)}
          </h3>
          <ul className="mt-4 flex flex-col gap-3" role="list">
            {rows.map((one) => (
              <BeliefRowCard
                key={one.id}
                belief={one}
                criterion={criteria[one.id]}
                marks={evidence[one.id] ?? {}}
                narrowTo={one.learnedIn ? slugs[one.learnedIn.identity] ?? null : null}
                locale={locale}
                gesture={gestures.get(one.id)}
                stranded={one.badge !== "forming" && unpublished.has(one.id)}
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
        <section className="mt-8">
          <h3 className="text-sm font-semibold">
            {translate("twin.graveyardTitle")}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-smoke">
            {translate("twin.graveyardNote")}
          </p>
          <ul className="mt-4 flex flex-col gap-2" role="list">
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
          <ActionButton
            tone="quiet"
            type="button"
            onClick={() => {
              setGestures(new Map());
              setAnswers(new Map());
              setEditing(null);
            }}
            disabled={saving}
          >
            {translate("twin.cancel")}
          </ActionButton>
          {error && (
            <ActionError as="span" text={translate("twin.saveFailed", { detail: error })} />
          )}
        </div>
      )}
    </>
  );
}

/**
 * What the outbox says about the file, and the one action a conflict offers.
 *
 * It sits on the file card, beside the meter, because «does it fit» and «was it written» are
 * the two halves of one answer. `pending` is said as waiting and never as done; `failed` names
 * the reason with the same sentences the job rows use; `conflict` is the file moved under a
 * prepared publication, which is never a veto (plan §10.4): the notice says what reconciling
 * does and offers it. Reconciling is one more plan through the portrait door — the permission
 * restated with the generation this screen read, a gesture that changes nothing and makes the
 * outbox read the file again — so a stale screen meets `publication_conflict` and reloads.
 */
export function TwinPublication({
  publication,
  publishesInferred,
}: {
  publication: PublicationView | null;
  /** The current permission, restated by the reconcile so the plan changes nothing. */
  publishesInferred: boolean;
}) {
  const translate = useT();
  const locale = useLocale();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (publication === null) return null;

  async function reconcile() {
    if (publication === null) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/twin/taste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 2, publishInferred: publishesInferred, expectedPublicationRevision: publication.revision }),
      });
      const payload = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!response.ok) {
        const key = tasteRefusalKey(payload.code);
        setError(key ? translate(key) : payload.error ?? String(response.status));
      }
      router.refresh();
    } catch {
      setError(translate("project.unreachable"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 border-t border-edge pt-3">
      <p className="font-mono text-xs text-smoke">
        {translate("twin.publicationTitle")}{" "}
        <Tag tone={PUBLICATION_STATUS_TONES[publication.status]}>{translate(PUBLICATION_STATUS_KEYS[publication.status])}</Tag>
      </p>
      {publication.status === "none" && (
        <p className="mt-1 text-xs leading-relaxed text-smoke">{translate("twin.publicationNone")}</p>
      )}
      {publication.status === "pending" && (
        <p className="mt-1 text-xs leading-relaxed text-smoke">{translate("twin.publicationPending")}</p>
      )}
      {publication.status === "published" && (
        <p className="mt-1 text-xs leading-relaxed text-smoke">
          {translate("twin.publicationPublished", { date: publication.at ? relativeDate(publication.at, locale) : "—" })}
        </p>
      )}
      {publication.status === "failed" && (
        <Notice tone="fail" className="mt-2" title={translate("twin.publicationFailed", { reason: publication.reason ? translate(jobReasonKey(publication.reason), { reason: publication.reason }) : "—" })} />
      )}
      {publication.status === "conflict" && (
        <Notice tone="warn" className="mt-2" title={translate("memory.publicationConflict")}>
          <p className="mt-1 text-xs leading-relaxed text-smoke">{translate("twin.publicationConflictHint")}</p>
          <div className="mt-2">
            <ActionButton
              tone="raised"
              size="sm"
              type="button"
              onClick={() => void reconcile()}
              busy={saving}
              busyLabel={translate("twin.publicationReconciling")}
            >
              {translate("twin.publicationReconcile")}
            </ActionButton>
          </div>
        </Notice>
      )}
      {error && <ActionError text={error} className="mt-2" />}
    </div>
  );
}

/*
  The map lives in `lib/taste-view.ts`: the card of a project shows the same subjects from the
  server, and two copies give two names for the same thing in the same session.
 */
function topicName(topic: string, translate: Translate): string {
  const key = topicKey(topic);
  return key ? translate(key) : topic;
}

function flip(current: Map<string, boolean>, id: string, next: boolean): Map<string, boolean> {
  const copy = new Map(current);
  if (copy.get(id) === next) copy.delete(id);
  else copy.set(id, next);
  return copy;
}

/** The typed conditions and exceptions of a criterion, as the sentences the agent reads, read-only. */
function Predicates({ view, translate }: { view: CriterionRowView | undefined; translate: Translate }) {
  if (!view || (view.appliesWhen === null && view.exceptWhen === null)) return null;
  return (
    <div className="mt-1 max-w-2xl text-xs leading-relaxed text-smoke">
      {view.appliesWhen !== null && <p>{translate("twin.appliesWhen", { sentence: view.appliesWhen })}</p>}
      {view.exceptWhen !== null && <p>{translate("twin.exceptWhen", { sentence: view.exceptWhen })}</p>}
    </div>
  );
}

/** The independence of an inference: the families counted, and the floor when they fall short. */
function Families({ view, translate }: { view: CriterionRowView | undefined; translate: Translate }) {
  if (!view) return null;
  const line = familiesLine(view);
  return (
    <>
      {translate(line.key, line.vars)}
      {view.families !== null && !view.meetsFloor ? (
        <span className="text-idle">{` · ${translate("twin.familiesShort", { floor: SUPPORT_FAMILIES_FLOOR })}`}</span>
      ) : null}
    </>
  );
}

/**
 * The quotes under a belief, each with the kind of the observation it came from when the page
 * could tell. An ambiguous reaction is drawn as evidence that founds nothing — the tag and the
 * sentence say so — and never as a preference in waiting.
 */
function Citations({
  citations,
  marks,
  locale,
  translate,
}: {
  citations: Citation[];
  marks: Record<string, EvidenceMark>;
  locale: "es" | "en";
  translate: Translate;
}) {
  if (citations.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-2.5 border-l border-edge pl-3" role="list">
      {citations.map((cite) => {
        const mark = marks[cite.verdictId];
        return (
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
              {mark?.kind ? (
                <>
                  {" · "}
                  <Tag tone={mark.ambiguous ? "idle" : "quiet"}>{translate(OBSERVATION_KIND_KEYS[mark.kind])}</Tag>
                </>
              ) : null}
              {mark?.ambiguous ? <span className="text-idle">{` · ${translate("twin.observationAmbiguous")}`}</span> : null}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One belief, as a row you can argue with.
 *
 * It was called `Card`, which is the name of the surface primitive the page beside it imports —
 * two components, one word, in files a reader moves between. This one is not that one: it renders
 * an `<li>` with the four gestures on a belief, and it has no paper or padding axis.
 */
function BeliefRowCard({
  belief,
  criterion,
  marks,
  narrowTo,
  locale,
  gesture,
  stranded,
  editing,
  onEdit,
  onGesture,
  onWrite,
  translate,
}: {
  belief: BeliefView;
  /** Its revision, predicates and independence; undefined for a row the page could not shape. */
  criterion: CriterionRowView | undefined;
  marks: Record<string, EvidenceMark>;
  /** The slug of the project it could be narrowed to, or null when there is none to offer. */
  narrowTo: string | null;
  locale: "es" | "en";
  gesture?: Gesture;
  /** Publishable, and not in the file: saved here and read by no agent. See `BeliefEditor`. */
  stranded: boolean;
  editing: boolean;
  onEdit: (open: boolean) => void;
  onGesture: (gesture: Gesture) => void;
  onWrite: (statement: string) => void;
  translate: Translate;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(belief.statement);
  const written = gesture?.kind === "sign" ? gesture.statement : undefined;
  const typed = criterion !== undefined && (criterion.appliesWhen !== null || criterion.exceptWhen !== null);

  return (
    <li
      id={`belief-${belief.id}`}
      tabIndex={-1}
      className={[
        "scroll-mt-24 rounded-lg border px-4 py-4 transition-colors",
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
        {/*
           And whether it reaches anybody, which is the one thing this row could not say. A
           «forming» belief is not marked: it is not publishable yet, so its absence from the file
           is what the badge beside it already means, and saying it twice would read as two faults.
          */}
        {stranded ? (
          <span className="text-idle">{` · ${translate("twin.notInFile")}`}</span>
        ) : null}
      </p>
      {stranded ? (
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-smoke">
          {translate("twin.notInFileWhy")}
        </p>
      ) : null}

      {editing ? (
        <div className="mt-2">
          {/*
             The sentence above is the model's belief, not the label of this field: whoever does
             not see the screen heard 'text area' and nothing else. `hideLabel` keeps that word in
             the tree without drawing it, which is what the design has room for.
            */}
          <TextArea
            label={translate("twin.editText")}
            hideLabel
            rows={3}
            className="max-w-2xl"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
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
        <p className="mt-1 max-w-2xl text-base leading-relaxed">
          {written ?? belief.statement}
        </p>
      )}

      {/* The typed conditions and exceptions, as sentences and read-only: what the agent reads. */}
      <Predicates view={criterion} translate={translate} />

      {/*
         Evidence, always raw. It's what turns a belief into something that can be discussed, and
         what can be discussed can be thrown away: without this number, 'you haven't signed it'
         would be the only defense against an invented phrase, and here no one signs anything.
        */}
      <p className="mt-2 font-mono text-xs text-smoke">
        {belief.authored ? translate("twinTeach.ownerEvidence") : translate("twin.support", {
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
        {/*
           And its independence (plan §10.2): the families of case behind an inference, against
           the floor an automatic publication needs. Not for what the owner taught, which needs
           no quorum, and not for a row that was signed: a signature outranks the count.
          */}
        {!belief.authored && belief.badge !== "signed" && criterion ? (
          <>
            {" · "}
            <Families view={criterion} translate={translate} />
          </>
        ) : null}
        {belief.citations.length > 0 && (
          <>
            {" · "}
            {/*
               NOT a primitive: this one lives INSIDE the evidence sentence, after a ` · `, and
               inherits its `font-mono text-xs text-smoke`. A control base would give it a border,
               a 30px floor and padding in the middle of a running line. It is the same exception
               as the «ask again» of `md-review.tsx`: an inline control inside a sentence.
              */}
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

      {open && <Citations citations={belief.citations} marks={marks} locale={locale} translate={translate} />}

      {!editing && (
        <div className="mt-3 flex flex-wrap gap-2">
          {/*
             Sign only if it is not already signed: a signed one cannot be signed again and the
             button would do nothing. Editing it yes, and that signs it again with the new words.
            */}
          {belief.badge !== "signed" && (
            <Action
              label={translate("twin.sign")}
              toggle
              active={gesture?.kind === "sign" && written === undefined}
              onClick={() => onGesture({ kind: "sign" })}
            />
          )}
          <Action
            label={translate("twin.edit")}
            toggle
            active={written !== undefined}
            onClick={() => {
              setDraft(written ?? belief.statement);
              onEdit(true);
            }}
          />
          <Action
            label={translate("twin.veto")}
            toggle
            active={gesture?.kind === "veto"}
            onClick={() => onGesture({ kind: "veto" })}
          />
          {/*
             Limit only when there is something to limit. A belief without a project —the evidence
             comes from several— cannot be limited to any, and a button that cannot function is
             worse than its absence. The one that is already limited shows the way back. The
             narrowing names the project by its slug, which is what the revisioned door takes.
            */}
          {belief.scope ? (
            <Action
              label={translate("twin.scopeAll")}
              toggle
              active={gesture?.kind === "scope" && gesture.slug === null}
              onClick={() => onGesture({ kind: "scope", slug: null })}
            />
          ) : belief.learnedIn && narrowTo ? (
            <Action
              label={translate("twin.scopeOnly", { project: belief.learnedIn.name })}
              toggle
              active={gesture?.kind === "scope"}
              onClick={() => onGesture({ kind: "scope", slug: narrowTo })}
            />
          ) : null}
        </div>
      )}
      {/* Signing a criterion that shows conditions or exceptions signs them too; the person is told before the press. */}
      {!editing && typed && belief.badge !== "signed" ? (
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-faint">{translate("twin.signWhatYouSee")}</p>
      ) : null}
    </li>
  );
}

/**
 * One of the four gestures, marked or not.
 *
 * The hand-written pair was `border-accent text-accent` against `border-edge text-smoke`: an
 * OUTLINED accent for «this one is marked», which none of the six tones spells. What the house
 * already answers that question with is the filled accent — `twin-sources.tsx` alternates `plain`
 * and `accent` by the state of its row — so this takes the same pair, and «this one is current»
 * has one answer here instead of two.
 *
 * And it says that it is a TOGGLE where it is one. `aria-pressed` belongs on the four gestures of
 * a belief and on the two answers to a proposal, and NOT on the two commands that borrow this same
 * button — «save the edit» and «cancel» are pressed once and do a thing. One prop could not tell
 * those apart, so for a while the attribute was left off all of them and written down instead:
 * every gesture read as an ordinary button, and which one was marked reached the eye through an
 * accent fill and reached a screen reader not at all. `toggle` is the prop that tells them apart,
 * declared at the seven sites that are toggles and absent at the two that are commands.
 */
function Action({
  label,
  active,
  toggle = false,
  onClick,
}: {
  label: string;
  active?: boolean;
  /** True where pressing marks a state rather than performing a one-shot command. */
  toggle?: boolean;
  onClick: () => void;
}) {
  return (
    <ActionButton
      tone={active ? "accent" : "plain"}
      type="button"
      {...(toggle ? { "aria-pressed": active ?? false } : {})}
      onClick={onClick}
    >
      {label}
    </ActionButton>
  );
}
