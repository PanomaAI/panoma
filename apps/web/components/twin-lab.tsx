"use client";

import { useRef, useState, type FormEvent } from "react";
import { HiOutlineArrowUpRight, HiOutlineBeaker } from "react-icons/hi2";
import { useT } from "./i18n-provider";
import { QUESTION_MAX } from "@/lib/twin-limits";
import { ActionButton, ActionError, Card, EmptyState, Select, TextArea } from "./primitives";
import { topicKey } from "@/lib/taste-view";



interface Rehearsal {
  status: "preview" | "drafted" | "abstained";
  answer?: string;
  evidence: {
    id: string;
    statement: string;
    state: string;
    topic: string;
    scope?: string;
    kind?: "episode";
  }[];
  omittedBeliefs: number;
  reason?: "no-beliefs" | "no-match" | "unsupported";
  remainingCalls: number;
}

/**
 * A decision can be inspected before a model is called. The first submit only retrieves local
 * evidence; spending belongs to a separate button offered after that evidence is visible.
 * Changing either input invalidates the preview, so a draft never silently uses another case.
 */
export function TwinLab({
  projects,
  hasBeliefs,
}: {
  /** `label` and not `name`: the folders repeat, and a menu of identical lines picks nothing. */
  projects: { slug: string; label: string }[];
  hasBeliefs: boolean;
}) {
  const translate = useT();
  const [question, setQuestion] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState<"preview" | "draft" | null>(null);
  const [result, setResult] = useState<Rehearsal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  // A second click in the same render must not reserve another paid call.
  const inFlight = useRef(false);
  const project = projects.find((one) => one.slug === slug);

  function invalidate() {
    setResult(null);
    setError(null);
  }

  async function rehearse(dryRun: boolean) {
    if (inFlight.current) return;
    const trimmed = question.trim();
    if (!trimmed || trimmed.length > QUESTION_MAX) {
      setError(translate("twinLab.invalidRequest", { max: QUESTION_MAX }));
      return;
    }
    if (!dryRun && (result?.status !== "preview" || !result.evidence.length)) return;
    inFlight.current = true;
    setBusy(dryRun ? "preview" : "draft");
    setError(null);
    if (dryRun) setResult(null);

    try {
      const response = await fetch("/api/twin/rehearse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, ...(slug ? { slug } : {}), dryRun }),
      });
      const payload = (await response.json()) as Rehearsal & { error?: string; hint?: string };
      if (typeof payload.remainingCalls === "number") setRemaining(payload.remainingCalls);
      if (!response.ok) {
        setError(
          response.status === 429
            ? translate("twinLab.budgetReached")
            : [payload.error ?? translate("twinLab.failed"), payload.hint].filter(Boolean).join(" "),
        );
        return;
      }
      if (!Array.isArray(payload.evidence) || !["preview", "drafted", "abstained"].includes(payload.status)) {
        setError(translate("twinLab.failed"));
        return;
      }
      setResult(payload);
    } catch {
      setError(translate("project.unreachable"));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void rehearse(true);
  }

  const abstention = result?.reason === "no-beliefs"
    ? "twinLab.noBeliefs"
    : result?.reason === "no-match"
      ? "twinLab.noMatch"
      : "twinLab.unsupported";

  return (
    <section id="decision-lab" tabIndex={-1} aria-labelledby="twin-lab-title" className="page-shell__section scroll-mt-24 rounded-lg border border-edge bg-surface">
      <div className="border-b border-edge px-5 py-5 sm:px-6">
        <p className="flex items-center gap-2 font-mono text-xs text-smoke">
          <HiOutlineBeaker aria-hidden className="h-4 w-4" />
          {translate("twinLab.eyebrow")}
        </p>
        <h2 id="twin-lab-title" className="mt-2 text-base font-semibold">
          {translate("twinLab.title")}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-smoke">
          {translate("twinLab.lead")}
        </p>
      </div>

      <div className="grid lg:grid-cols-2">
        <form onSubmit={preview} className="min-w-0 px-5 py-5 sm:px-6" aria-busy={busy !== null}>
          <TextArea
            label={translate("twinLab.question")}
            value={question}
            onChange={(event) => { setQuestion(event.target.value); invalidate(); }}
            maxLength={QUESTION_MAX}
            rows={4}
            required
            disabled={busy !== null || !hasBeliefs}
            aria-describedby={`twin-lab-question-hint twin-lab-count${hasBeliefs ? "" : " twin-lab-untrained"}`}
            placeholder={translate("twinLab.placeholder")}
          />
          {/*
             Why the box is grey, said against the box. With nothing to rehearse against, the
             textarea and the picker were merely dimmed and the reason sat in the OTHER column —
             so the form read as broken rather than as not-yet-usable, and this is the state every
             first visit is in. The way out stays where it was, under the heading that offers it.
            */}
          {!hasBeliefs && (
            <p id="twin-lab-untrained" className="mt-2 text-xs leading-relaxed text-smoke">
              {translate("twinLab.firstTitle")}
            </p>
          )}
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-smoke">
            <p id="twin-lab-question-hint">{translate("twinLab.questionHint")}</p>
            <p id="twin-lab-count" className="font-mono">
              {translate("twinLab.characters", { n: question.length, max: QUESTION_MAX })}
            </p>
          </div>

          <Select
            label={translate("twinLab.project")}
            className="mt-5"
            value={slug}
            onChange={(event) => { setSlug(event.target.value); invalidate(); }}
            disabled={busy !== null || !hasBeliefs}
            aria-describedby="twin-lab-scope-hint"
          >
            <option value="">{translate("twinLab.global")}</option>
            {projects.map((one) => <option key={one.slug} value={one.slug}>{one.label}</option>)}
          </Select>
          <p id="twin-lab-scope-hint" className="mt-2 text-xs leading-relaxed text-smoke">
            {translate("twinLab.scopeHint")}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <ActionButton
              type="submit"
              tone="surface"
              busy={busy === "preview"}
              busyLabel={translate("twinLab.previewing")}
              disabled={busy !== null || !question.trim() || !hasBeliefs}
            >
              {translate("twinLab.preview")}
            </ActionButton>
            <span className="text-xs text-smoke">{translate("twinLab.previewCost")}</span>
          </div>
          {error && <ActionError text={error} className="mt-4" />}
        </form>

        <div className="min-w-0 border-t border-edge bg-ground px-5 py-5 sm:px-6 lg:border-t-0 lg:border-l">
          <p role="status" aria-live="polite" className="font-mono text-xs text-smoke">
            {busy === "preview"
              ? translate("twinLab.previewing")
              : busy === "draft"
                ? translate("twinLab.drafting")
                : result?.status === "drafted"
                  ? translate("twinLab.draftReady")
                  : result?.status === "abstained"
                    ? translate("twinLab.abstained")
                    : result?.status === "preview"
                      ? translate("twinLab.evidenceCount", { n: result.evidence.length })
                      : translate("twinLab.waiting")}
          </p>

          {/*
             `bare` and not the frame: this column already IS a panel —its own paper, its own
             border down the left— and boxing the emptiness inside it draws a box inside a box.
             What it loses in the exchange is a `<h3>`: the block is a title over a line, not a
             section of the document, and the two headings this column really has are the ones
             below, on a draft and on its citations.
            */}
          {!result && (
            <EmptyState
              variant="bare"
              className="mt-4 max-w-md"
              title={translate(hasBeliefs ? "twinLab.emptyTitle" : "twinLab.firstTitle")}
              action={!hasBeliefs && <TeachLink />}
            >
              {translate(hasBeliefs ? "twinLab.emptyBody" : "twinLab.noBeliefs")}
            </EmptyState>
          )}

          {result?.status === "abstained" && (
            <div className="mt-3">
              <h3 className="text-base font-semibold">{translate("twinLab.abstainedTitle")}</h3>
              <p className="mt-2 text-sm leading-relaxed text-smoke">{translate(abstention)}</p>
              <TeachLink className="mt-3" />
            </div>
          )}

          {result?.status === "drafted" && (
            <Card className="mt-3">
              <h3 className="text-sm font-semibold">{translate("twinLab.draftTitle")}</h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-base leading-relaxed">
                {result.answer}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-smoke">{translate("twinLab.draftHint")}</p>
              {/*
                 The only way to disagree with a draft: teach the criterion. The owner's verdict on
                 a rehearsal is not a fidelity measurement —rehearsing a decision already made is
                 not a held-out test— so there is no thumbs up or down here, on purpose.
                */}
              <p className="mt-3 text-xs leading-relaxed text-smoke">{translate("twinLab.disagree")}</p>
              <TeachLink className="mt-3" />
            </Card>
          )}

          {result && result.evidence.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold">
                {translate(result.status === "drafted" ? "twinLab.citations" : "twinLab.evidence")}
              </h3>
              <ol className="mt-3 flex flex-col gap-2" role="list">
                {result.evidence.map((one, index) => {
                  const topic = topicKey(one.topic);
                  return (
                    <Card as="li" key={one.id} pad="sm">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-smoke">
                        <span aria-hidden>{String(index + 1).padStart(2, "0")}</span>
                        <span>{translate(one.kind === "episode" ? "twinLab.episode" : one.state === "signed" ? "twin.badgeSigned" : "twin.badgeStanding")}</span>
                        {one.kind !== "episode" && <span>· {topic ? translate(topic) : one.topic}</span>}
                      </p>
                      <a href={one.kind === "episode" ? `/twin?episode=${encodeURIComponent(one.id)}#episode-${one.id}` : `#belief-${one.id}`} className="mt-1.5 flex items-start gap-2 text-sm leading-relaxed underline-offset-4 hover:underline">
                        <span className="min-w-0 flex-1 whitespace-pre-line break-words">{one.statement}</span>
                        <HiOutlineArrowUpRight aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-smoke" />
                        <span className="sr-only">{translate(one.kind === "episode" ? "twinLab.openEpisode" : "twinLab.openEvidence")}</span>
                      </a>
                      <p className="mt-2 text-xs text-smoke">
                        {one.kind === "episode"
                          ? translate("twinLab.episodeScope")
                          : one.scope
                            ? translate("twinLab.projectRule", { project: project?.label ?? one.scope })
                            : translate("twinLab.globalRule")}
                      </p>
                    </Card>
                  );
                })}
              </ol>
            </div>
          )}

          {result && result.omittedBeliefs > 0 && (
            <p className="mt-3 font-mono text-xs text-smoke">
              {translate("twinLab.omitted", { n: result.omittedBeliefs })}
            </p>
          )}
          {remaining !== null && (
            <p className="mt-3 font-mono text-xs text-smoke">
              {translate("twinLab.remaining", { n: remaining })}
            </p>
          )}
          {result?.status === "preview" && result.evidence.length > 0 && (
            <div className="mt-5 border-t border-edge pt-4">
              <ActionButton
                type="button"
                tone="accent"
                busy={busy === "draft"}
                busyLabel={translate("twinLab.drafting")}
                disabled={busy !== null || remaining === 0}
                onClick={() => void rehearse(false)}
              >
                {translate("twinLab.rehearse")}
              </ActionButton>
              <p className="mt-2 text-xs leading-relaxed text-smoke">
                {translate(remaining === 0 ? "twinLab.budgetReached" : "twinLab.draftCost")}
              </p>
            </div>
          )}
        </div>
      </div>
      <p className="border-t border-edge px-5 py-3 text-xs leading-relaxed text-smoke sm:px-6">
        {translate("twinLab.boundary")}
      </p>
    </section>
  );
}

/*
   The gap belongs to whoever places it, not to the link.

   It carried `mt-3` itself, which is right in the two blocks below that end with it and wrong in
   the third: `EmptyState`'s `action` slot already spaces what it holds, so inside it the two
   margins stacked to 24px. Each of the three sites now says its own gap, and all three render the
   12px they rendered before.
 */
function TeachLink({ className }: { className?: string }) {
  const translate = useT();
  return (
    <a href="#teach" className={`inline-flex items-center gap-1 text-sm underline underline-offset-4${className ? ` ${className}` : ""}`}>
      {translate("twinLab.teach")}
      <HiOutlineArrowUpRight aria-hidden className="h-4 w-4" />
    </a>
  );
}
