"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./i18n-provider";

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
  error?: string;
}

export function TwinDistill({ left }: { left: number }) {
  const translate = useT();
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setNote(null);

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
        setNote(
          nuevas === 0
            ? translate("twin.minedNone")
            : translate("twin.mined", { saved: nuevas, duplicates: mined.duplicates ?? 0 }),
        );
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
      setNote(
        translate("twin.distillEstimate", {
          verdicts: dry.verdicts,
          tokens: dry.estimatedTokens ?? 0,
        }),
      );

      let read = 0;
      let saved = 0;
      for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
        const outcome = await post({});
        read += outcome.verdicts ?? 0;
        saved += outcome.saved ?? 0;

        if (outcome.error) {
          setNote(outcome.hint ? `${outcome.error} ${outcome.hint}` : outcome.error);
          break;
        }
        const remaining = outcome.corpus
          ? Math.max(outcome.corpus.total - outcome.corpus.read, 0)
          : 0;
        setNote(translate("twin.distillProgress", { read, saved, left: remaining }));
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
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="self-start rounded border border-edge px-2.5 py-1 font-mono text-xs text-smoke transition-colors hover:border-chalk disabled:opacity-50"
      >
        {running
          ? translate("twin.distilling")
          : left > 0
            ? translate("twin.mineButtonLeft", { n: left })
            : translate("twin.mineButton")}
      </button>
      {note && <p className="font-mono text-xs text-smoke">{note}</p>}
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
