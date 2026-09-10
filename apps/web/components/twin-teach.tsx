"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { HiOutlinePencilSquare } from "react-icons/hi2";
import { useT } from "./i18n-provider";
import { ActionButton, ActionError, Select, TextArea } from "./primitives";
import { TOPIC_NAME } from "@/lib/taste-view";
import { TEACH_MAX } from "@/lib/twin-limits";

/** Direct teaching gives a new Twin usable criteria without a history read or a model call. */
export function TwinTeach({ projects, omitted }: {
  projects: { slug: string; label: string }[];
  /**
   * How many projects the scope menu cannot offer, and says so.
   *
   * `TASTE.md` writes a scope as a name, so `teachBelief` refuses a project whose name another
   * project shares — on the author's disk that is 49 of 75, because twenty folders are called
   * `kiosk_new`. They used to be listed and every one failed after the press. Dropping them
   * silently would replace a late error with an invisible rule, which is not better; the count is
   * what turns the shorter menu back into something a person can learn.
   */
  omitted: number;
}) {
  const translate = useT();
  const router = useRouter();
  const [statement, setStatement] = useState("");
  const [topic, setTopic] = useState("workflow");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const pending = useRef(false);

  async function teach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !statement.trim()) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    setSavedId(null);
    try {
      const response = await fetch("/api/twin/taste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teach: { statement, topic, ...(slug ? { slug } : {}) } }),
      });
      const receipt = await response.json() as { error?: string; beliefId?: string };
      if (!response.ok || !receipt.beliefId) {
        setError(receipt.error ?? translate("twinTeach.failed"));
        return;
      }
      setStatement("");
      setSavedId(receipt.beliefId);
      router.refresh();
    } catch {
      setError(translate("project.unreachable"));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <section id="teach" tabIndex={-1} aria-labelledby="twin-teach-title" className="page-shell__section scroll-mt-24 rounded-lg border border-edge bg-surface p-5 sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <p className="flex items-center gap-2 font-mono text-xs text-smoke">
            <HiOutlinePencilSquare aria-hidden className="h-4 w-4" />
            {translate("twinTeach.eyebrow")}
          </p>
          <h2 id="twin-teach-title" className="mt-2 text-base font-semibold">
            {translate("twinTeach.title")}
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-smoke">{translate("twinTeach.lead")}</p>
          <p className="mt-3 max-w-md text-xs leading-relaxed text-smoke">{translate("twinTeach.control")}</p>
        </div>
        <form onSubmit={teach} aria-busy={saving}>
          <TextArea
            label={translate("twinTeach.statement")}
            value={statement}
            onChange={(event) => { setStatement(event.target.value); setSavedId(null); }}
            required maxLength={TEACH_MAX} rows={3} disabled={saving}
            placeholder={translate("twinTeach.placeholder")}
            aria-describedby="twin-teach-count"
          />
          <p id="twin-teach-count" className="mt-1 text-right font-mono text-xs text-smoke">
            {translate("twinTeach.characters", { n: statement.length, max: TEACH_MAX })}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Select label={translate("twinTeach.topic")} value={topic} disabled={saving}
              onChange={(event) => setTopic(event.target.value)}>
              {Object.entries(TOPIC_NAME).map(([value, key]) => <option key={value} value={value}>{translate(key)}</option>)}
            </Select>
            {/*
               And the label of each project is the one that appears once in the list. The name on
               its own repeated twenty times here — they are real folders and most of them copies —
               so choosing the scope of a rule meant picking one of twenty identical lines.
              */}
            <div>
              <Select label={translate("twinTeach.scope")} value={slug} disabled={saving}
                aria-describedby={omitted > 0 ? "twin-teach-scope-note" : undefined}
                onChange={(event) => setSlug(event.target.value)}>
                <option value="">{translate("twinTeach.global")}</option>
                {projects.map((project) => <option key={project.slug} value={project.slug}>{project.label}</option>)}
              </Select>
              {omitted > 0 && (
                <p id="twin-teach-scope-note" className="mt-2 text-xs leading-relaxed text-smoke">
                  {translate("twinTeach.scopeOmitted", { n: omitted })}
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ActionButton type="submit" tone="accent" busy={saving} busyLabel={translate("twinTeach.saving")}
              disabled={saving || !statement.trim()}>{translate("twinTeach.save")}</ActionButton>
            <span className="text-xs text-smoke">{translate("twinTeach.cost")}</span>
          </div>
          {error && <ActionError text={error} className="mt-3" />}
          <div role="status" aria-live="polite">
            {savedId && <p className="mt-3 text-sm text-smoke">
              {translate("twinTeach.saved")} {" "}
              <a href={`#belief-${savedId}`} className="underline underline-offset-4">{translate("twinTeach.view")}</a>
            </p>}
          </div>
        </form>
      </div>
    </section>
  );
}
