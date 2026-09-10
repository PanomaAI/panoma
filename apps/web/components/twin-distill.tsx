"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./i18n-provider";
import { ActionButton } from "./primitives";

/*
  Read the history from the catalog, which until now could only be done from the terminal.
  It was a large and hard-to-see hole: the portrait screen knew how to **rewrite it** —synthesize,
  sign, veto— but not feed it. The evidence entered only through `panoma twin distill`, so whoever
  worked on the browser had a double who could only ruminate on what they already knew. And the
  screen itself betrayed it: the corpus line said '1,739 unread remaining' and then prompted to
  type a command.
  ── It links actions, which is why you can see what it is doing ───────────────────────────
  At most, a pass reads `MAX_CHUNKS` projects, which in a corpus of two thousand citations is a
  tenth. The number that bounded a pass was a person's patience in front of a list of proposals,
  and that list no longer exists; what remains is a long wait, so what needs to be provided is not
  a faster button but one that **tells where it is going**.
  It stops at three points, the same as `--all` in the terminal: there is nothing left to read, a
  pass reads nothing —which prevents the infinite loop when what is missing cannot be read—, or
  the model fails, and then it stops there with what has already been saved.
  ── And before distilling, mining ───────────────────────────────────────────────────
  Distill chews on what is already stored, so this button alone, without mining, cannot bring
  anything you wrote today. The screen itself demonstrated it: with the entire corpus read, the
  button disappeared, and then there was **no** way to feed the double without opening a terminal.
  Mining comes first and is free — it does not call any model, it only reads files from the disk —
  so it always goes, even if it seems that there is nothing left to read: that's exactly when it
  is needed.
  A failure in mining does not stop distillation: what has already been stored can be distilled
  anyway, and refusing because a history could not be opened would be punishing the work done for
  what is missing. Except for the one that stops everything, which is having no permission from
  any source — there is nothing to distill there either, because nothing has ever entered.
  ── The price, ahead ───────────────────────────────────────────────────────────
  The drill comes first and it is not an option that you have to remember to request: it tells you
  how many appointments and how many tokens the next pass would cost before spending a single one.
  It is the same thing the terminal does and for the same reason — this is the only surface of
  Twin that actually spends, and it spends many times in a row.
 */

/** How many passes does it chain at most. The handbrake, not the real stop. */
const MAX_PASSES = 20;

interface Receipt {
  verdicts?: number;
  observed?: number;
  saved?: number;
  /** What no pass can send: a project's lone unread quote. See `planDistillation`. */
  thin?: number;
  /** Answers cut by the output limit and asked again with double room. See the route. */
  truncated?: number;
  corpus?: { total: number; read: number };
  estimatedTokens?: number;
  error?: string;
  /*
    The one-line remedy that the route sends along with the 502 —"connect one on the Model page…"—
    and that this component threw: the error said what happened and stayed silent about how to fix
    it, right in front of the user who doesn't know commands.
   */
  hint?: string;
}

/** What `POST /api/twin/mine` answers. */
interface Mined {
  saved?: number;
  duplicates?: number;
  /*
    The histories the reading skipped for want of permission. The route answers with them on a 200
    as well as on the 409, and this interface used to stop at `duplicates`, so a person with Claude
    Code granted and Codex refused read «new quotes: 12 · already there: 40» over a disk half of
    which had never been opened — a complete-looking receipt for a partial pass.
   */
  denied?: string[];
  /*
    The other harvest of the same call. The route hard-codes `captureNarratives: true`, so this
    press always saves history records as well as quotes — and this receipt used to name only the
    quotes, which made half the work of every press invisible from here.
   */
  narrativesSaved?: number;
  error?: string;
}

/** The plan a dry run returned, waiting for a yes. See `read()` and `distill()` below. */
interface Plan {
  verdicts: number;
  tokens: number;
}

export function TwinDistill({ left, granted }: {
  left: number;
  /**
   * Whether any history has been granted at all.
   *
   * Without one this button is a dead end by construction: the press costs a round trip and comes
   * back with a 409 and a sentence. It used to be rendered enabled anyway, so the first control a
   * new person met on this screen was the one guaranteed to do nothing — and the sentence it
   * returned pointed «just below» at a card that, until the sections were put in dependency order,
   * was above it. The condition is on the screen now, before the press.
   */
  granted: boolean;
}) {
  const translate = useT();
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /*
    What the next pass would cost, held until the person says yes.

    The route's own header says the dry run exists so it can tell you «how many quotes and how many
    tokens the next pass would cost before spending a single one», and that it does this because
    «this is the only surface of Twin that actually spends, and it spends many times in a row». In
    the browser it printed the estimate and then spent it in the same tick, so the figure was a
    fact you saw go past and never a decision — while the terminal did use it as one. Twenty paid
    passes now need a second, separate press.
   */
  const [plan, setPlan] = useState<Plan | null>(null);

  /** The free half: read the disk, then ask what the paid half would cost. Spends nothing. */
  async function preview() {
    setRunning(true);
    setNote(null);
    setPlan(null);

    try {
      /*
        First the disk. It doesn't cost a call to any model, so it always goes: it's the only
        thing that can bring what you wrote today, and just when the corpus seems finished is when
        it is the only thing that does anything.
       */
      setNote(translate("twin.mining"));
      const mined = await mine();
      if (mined.unreachable) setNote(translate("project.unreachable"));
      else if (mined.error !== undefined) {
        setNote(mined.error);
        // Without permission from any source, there is nothing to mine **nor** to distill again.
        if (mined.blocked) return;
      } else {
        const nuevas = mined.saved ?? 0;
        const skipped = mined.denied?.length ?? 0;
        const receipt =
          nuevas === 0
            ? translate("twin.minedNone")
            : translate("twin.mined", { saved: nuevas, duplicates: mined.duplicates ?? 0 });
        const parts = [receipt];
        if ((mined.narrativesSaved ?? 0) > 0) {
          parts.push(translate("twin.minedRecords", { n: mined.narrativesSaved ?? 0 }));
        }
        if (skipped > 0) parts.push(translate("twin.minedDenied", { n: skipped }));
        setNote(parts.join(" · "));
      }

      const dry = await post({ dryRun: true });
      if (dry.error) {
        setNote(dry.hint ? `${dry.error} ${dry.hint}` : dry.error);
        return;
      }
      if (!dry.verdicts) {
        setNote(translate("twin.distillNothing"));
        return;
      }
      /*
        And it stops here. The sentence below is the same one it always printed; what changed is
        that it is now the end of a gesture instead of a line in the middle of one.
       */
      setPlan({ verdicts: dry.verdicts, tokens: dry.estimatedTokens ?? 0 });
      setNote(
        translate("twin.distillEstimate", {
          verdicts: dry.verdicts,
          tokens: dry.estimatedTokens ?? 0,
        }),
      );
      router.refresh();
    } catch {
      setNote(translate("project.unreachable"));
    } finally {
      setRunning(false);
    }
  }

  /** The paid half, and only after a yes: up to `MAX_PASSES` distillation passes. */
  async function distill() {
    setRunning(true);
    setPlan(null);

    try {
      let read = 0;
      let saved = 0;
      let truncated = 0;
      for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
        const outcome = await post({});
        read += outcome.verdicts ?? 0;
        saved += outcome.saved ?? 0;
        truncated += outcome.truncated ?? 0;

        if (outcome.error) {
          setNote(outcome.hint ? `${outcome.error} ${outcome.hint}` : outcome.error);
          break;
        }
        const remaining = outcome.corpus
          ? Math.max(outcome.corpus.total - outcome.corpus.read, 0)
          : 0;
        /*
          The thin count is the last pass's and not a sum: it is a state of the corpus —the quotes
          no pass can send— and every pass reports the same ones. The cut answers do add up: each
          was a call.
         */
        const thin = outcome.thin ?? 0;
        const parts = [translate("twin.distillProgress", { read, saved, left: remaining })];
        if (thin > 0) parts.push(translate("twin.distillThin", { n: thin }));
        if (truncated > 0) parts.push(translate("twin.distillTruncated", { n: truncated }));
        setNote(parts.join(" · "));
        // A pass that reads nothing is not going to read the next one either: stopping is the cheap
        // part.
        if (!outcome.verdicts || remaining <= 0) break;
      }

      router.refresh();
    } catch {
      setNote(translate("project.unreachable"));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          tone="plain"
          type="button"
          onClick={preview}
          busy={running && plan === null}
          busyLabel={translate("twin.distilling")}
          disabled={!granted || running}
          aria-describedby={granted ? undefined : "twin-distill-why"}
          className="self-start"
        >
          {left > 0 ? translate("twin.mineButtonLeft", { n: left }) : translate("twin.mineButton")}
        </ActionButton>
        {/*
           The yes, and it only exists once there is something to say yes to. It carries the count
           in its own words so the press and the figure cannot come apart: the sentence above says
           what it would cost, and the button says what it would do.
          */}
        {plan !== null && (
          <ActionButton
            tone="accent"
            type="button"
            onClick={distill}
            busy={running}
            busyLabel={translate("twin.distillingPaid")}
            disabled={running}
          >
            {translate("twin.distillGo", { n: plan.verdicts })}
          </ActionButton>
        )}
      </div>
      {/* What it costs, before the press. Every other paid control on this screen says so. */}
      {granted && <p className="text-xs leading-relaxed text-smoke">{translate("twin.distillCost")}</p>}
      {/* The reason rides with the button: a disabled control explained elsewhere reads as broken. */}
      {!granted && (
        <p id="twin-distill-why" className="text-xs leading-relaxed text-smoke">
          {translate("twin.distillNoConsent")}
        </p>
      )}
      {/*
         Always mounted, so the progress of a run that can last minutes is actually announced. A
         `role="status"` that appears at the same moment as its first sentence is a region nobody
         was watching yet.
        */}
      <div role="status" aria-live="polite">
        {note && <p className="font-mono text-xs text-smoke">{note}</p>}
      </div>
    </div>
  );
}

/**
 * Read the stories from the disk. It never launches: a history that cannot be opened cannot
 * prevent what was already stored from being distilled.
 *
 * `blocked` distinguishes the only failure that stops everything —there is no permission from any
 * source, meaning nothing has ever gotten in— from the others, which are a setback with work done
 * behind them.
 */
async function mine(): Promise<Mined & { blocked?: boolean; unreachable?: boolean }> {
  try {
    const response = await fetch("/api/twin/mine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const payload = (await response.json()) as Mined;
    if (response.ok) return payload;
    return {
      error: payload.error ?? String(response.status),
      ...(response.status === 409 ? { blocked: true } : {}),
    };
  } catch {
    // The server does not respond. The sentence is set by the caller, who has the translator.
    return { unreachable: true };
  }
}

async function post(body: object): Promise<Receipt> {
  const response = await fetch("/api/twin/distill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as Receipt;
  /*
    A 502 brings the receipt inside in addition to the error: the route saves what was already
    answered by the previous rounds and returns the same counters that it would return with a 200.
    What was read before failing is added, because it was paid.
   */
  return response.ok ? payload : { ...payload, error: payload.error ?? String(response.status) };
}
