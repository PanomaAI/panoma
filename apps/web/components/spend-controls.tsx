"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useLocale, useT } from "./i18n-provider";
import { ActionButton, ActionError, Card, Check, EmptyState, Field, Tag } from "./primitives";
import {
  FAMILY_HINT_KEY, FAMILY_KEY, SOURCE_KEY, formatMoney, formatTokens, hasDetail, hasNoTokenMeasurement, rowCost, share,
  type RateLike, type SpendDetail,
} from "@/lib/spend-format";
import type { ModelLine, SpendReport } from "@/lib/spend-report";
import type { FamilyLine } from "@/lib/spend-view";

/** What the critic is shown. Mirrors `ShotPolicy`, which lives on the server half of the settings. */
type ShotChoice = "full" | "fit";

/**
 * The owner's hand on the spend: a rate per model, a cap per family, the pause and the currency.
 *
 * One form and one POST. The route takes the whole patch or none of it, naming the field it
 * refused, and answers with the same receipt the page was rendered from, so what is painted after
 * a save is what is on disk and not what was typed. The two cards above the form are the server's;
 * they are refreshed through the router once the answer is in hand.
 *
 * The drafts start from what the file holds —`chosen` and `rates`— and not from the resolved
 * caps: while the pause is on every cap reads as zero, and a form that started from that zero
 * would write it down on the first save. A family the environment decides is shown disabled with
 * the variable named; it is left out of the patch, so the file keeps whatever it had for it.
 */

/*
  CapRow keeps a native field because its label belongs to the usage column and its box belongs
  to the control column. Field binds both into one label; the rate and currency boxes use it.
 */
const FIELD =
  "block w-full rounded border border-edge bg-surface px-2 py-1.5 font-mono text-xs disabled:opacity-50";

interface RateDraft {
  input: string;
  output: string;
}

function draftRates(models: ModelLine[]): Record<string, RateDraft> {
  return Object.fromEntries(
    models.map((row) => [
      row.key,
      { input: row.rate ? String(row.rate.input) : "", output: row.rate ? String(row.rate.output) : "" },
    ]),
  );
}

function draftCaps(report: SpendReport): Record<string, string> {
  return Object.fromEntries(
    report.families.map((line) => {
      const chosen = report.chosen[line.family];
      return [line.family, chosen === undefined ? "" : String(chosen)];
    }),
  );
}

/** Two empty boxes are no rate; one filled box is a rate with the other half at zero. */
function toRate(draft: RateDraft | undefined): RateLike | null {
  if (!draft || (draft.input.trim() === "" && draft.output.trim() === "")) return null;
  return { input: Number(draft.input || 0), output: Number(draft.output || 0) };
}

export function SpendControls({ initial }: { initial: SpendReport }) {
  const translate = useT();
  const locale = useLocale();
  const router = useRouter();
  // Live usage follows server refreshes; editable drafts remain local until saved.
  const report = initial;
  const [caps, setCaps] = useState(() => draftCaps(initial));
  const [rates, setRates] = useState(() => draftRates(initial.models));
  const [currency, setCurrency] = useState(initial.currency);
  const [paused, setPaused] = useState(initial.paused);
  const [shots, setShots] = useState<ShotChoice>(initial.shots);
  const [quota, setQuota] = useState(() => Object.fromEntries(initial.storage.scopes.map((row) => [row.scope, row.chosenMb === null ? "" : String(row.chosenMb)])));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A second click in the same render must not send a second patch.
  const inFlight = useRef(false);
  const shown = currency.trim().length === 3 ? currency.trim().toUpperCase() : report.currency;

  function touch() {
    setDirty(true);
    setSaved(false);
    setError(null);
  }

  function setRate(key: string, half: keyof RateDraft, value: string) {
    setRates((current) => ({ ...current, [key]: { ...(current[key] ?? { input: "", output: "" }), [half]: value } }));
    touch();
  }

  function choose(value: ShotChoice) {
    setShots(value);
    touch();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    touch();

    const patch = {
      caps: Object.fromEntries(
        report.families
          .filter((line) => line.env === undefined)
          .map((line) => {
            const raw = (caps[line.family] ?? "").trim();
            return [line.family, raw === "" ? null : Number(raw)];
          }),
      ),
      // Every rate on disk first, so a pair not seen in thirty days survives the save; then the
      // table, where an emptied pair sends null and the route drops it.
      rates: {
        ...report.rates,
        ...Object.fromEntries(report.models.map((row) => [row.key, toRate(rates[row.key])])),
      },
      currency: currency.trim().toUpperCase(),
      paused,
      shots,
      quota: Object.fromEntries(report.storage.scopes.filter((row) => row.source !== "variable").map((row) => {
        const value = (quota[row.scope] ?? "").trim();
        return [row.scope === "catalog" ? "catalogMb" : "projectMb", value === "" ? null : Number(value)];
      })),
    };

    try {
      const response = await fetch("/api/spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<SpendReport> & { error?: string; hint?: string };
      if (!response.ok) {
        setError([payload.error ?? translate("spend.failed"), payload.hint].filter(Boolean).join(" "));
        return;
      }
      if (!Array.isArray(payload.families) || !Array.isArray(payload.models)) {
        setError(translate("spend.failed"));
        return;
      }
      const next = payload as SpendReport;
      setCaps(draftCaps(next));
      setRates(draftRates(next.models));
      setCurrency(next.currency);
      setPaused(next.paused);
      setShots(next.shots);
      setQuota(Object.fromEntries(next.storage.scopes.map((row) => [row.scope, row.chosenMb === null ? "" : String(row.chosenMb)])));
      setSaved(true);
      setDirty(false);
      // The two cards above are the server's: the same receipt, painted again.
      router.refresh();
    } catch {
      setError(translate("project.unreachable"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} aria-busy={busy} className="mt-6 space-y-4">
      <Card as="section" aria-labelledby="spend-storage-title">
        <h2 id="spend-storage-title" className="text-base font-semibold">{translate("spend.storage")}</h2>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-smoke">{translate("spend.storageHint")}</p>
        <p className="mt-3 font-mono text-xs text-smoke">{translate("spend.storageUsed", {
          used: (report.storage.state.catalog.bytes / 1024 / 1024).toLocaleString(locale, { maximumFractionDigits: 2 }),
          limit: report.storage.state.catalog.limit / 1024 / 1024,
        })}</p>
        {(report.storage.state.paused || Object.values(report.storage.state.projects).some((row) => row.exceeded)) && (
          <p role="status" className="mt-2 text-sm text-smoke">{translate("memory.quotaPaused", { scope: translate(report.storage.state.paused ? "memory.quotaScopeCatalog" : "memory.quotaScopeProject") })}</p>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {report.storage.scopes.map((row) => <div key={row.scope}>
            <Field label={translate(row.scope === "catalog" ? "spend.quotaCatalog" : "spend.quotaProject")}
              type="number" min={1} max={report.storage.maximumMb} step={1} inputMode="numeric"
              value={quota[row.scope] ?? ""} placeholder={String(row.effectiveMb)}
              disabled={busy || row.source === "variable"}
              onChange={(event) => { setQuota((current) => ({ ...current, [row.scope]: event.target.value })); touch(); }} />
            <p className="mt-1 text-xs text-smoke">{row.source === "variable"
              ? translate("spend.source.env", { name: row.variable })
              : translate("spend.factory", { n: row.factoryMb })}</p>
          </div>)}
        </div>
        <p className="mt-4 text-xs text-smoke" role={report.storage.disk.state === "full" ? "alert" : undefined}>
          {report.storage.disk.state === "unknown" ? translate("spend.diskUnknown")
            : translate(report.storage.disk.state === "full" ? "spend.diskFull" : report.storage.disk.state === "low" ? "spend.diskLow" : "spend.diskAvailable", {
              n: (report.storage.disk.availableBytes / 1024 / 1024).toLocaleString(locale, { maximumFractionDigits: 0 }),
            })}
        </p>
      </Card>
      <Card as="section" aria-labelledby="spend-caps-title">
        <h2 id="spend-caps-title" className="text-base font-semibold">{translate("spend.caps")}</h2>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-smoke">{translate("spend.capsHint")}</p>
        <div className="mt-4 border-b border-edge pb-4">
          <Check
            checked={paused}
            disabled={busy}
            onChange={(event) => {
              setPaused(event.target.checked);
              touch();
            }}
          >
            {translate("spend.pause")}
            <span className="mt-1 block text-xs leading-relaxed text-smoke">{translate("spend.pauseHint")}</span>
          </Check>
        </div>
        <ul className="mt-4 space-y-4">
          {report.families.map((line) => (
            <CapRow
              key={line.family}
              line={line}
              value={caps[line.family] ?? ""}
              disabled={busy}
              onChange={(value) => {
                setCaps((current) => ({ ...current, [line.family]: value }));
                touch();
              }}
            />
          ))}
        </ul>
      </Card>

      <Card as="section" aria-labelledby="spend-rates-title">
        <h2 id="spend-rates-title" className="text-base font-semibold">{translate("spend.byModel")}</h2>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-smoke">{translate("spend.rateHint")}</p>
        <div className="mt-4">
          <Field
            label={translate("spend.currency")}
            aria-describedby="spend-currency-hint"
            type="text"
            maxLength={3}
            autoCapitalize="characters"
            spellCheck={false}
            value={currency}
            disabled={busy}
            onChange={(event) => {
              setCurrency(event.target.value);
              touch();
            }}
            className="w-24"
          />
          <p id="spend-currency-hint" className="mt-1 max-w-2xl text-xs leading-relaxed text-smoke">
            {translate("spend.currencyHint")}
          </p>
        </div>
        {report.models.length === 0 ? (
          <EmptyState variant="bare" className="mt-4" title={translate("spend.monthEmpty")}>
            {translate("spend.modelsEmptyHint")}
          </EmptyState>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">{translate("spend.byModel")} · {translate("spend.month")}</caption>
              <thead>
                <tr className="text-left font-mono text-[11px] text-smoke">
                  <th scope="col" className="py-1 pr-3 font-normal">{translate("spend.model")}</th>
                  <th scope="col" className="py-1 pr-3 text-right font-normal">{translate("spend.colCalls")}</th>
                  <th scope="col" className="py-1 pr-3 text-right font-normal">{translate("spend.colIn")}</th>
                  <th scope="col" className="py-1 pr-3 text-right font-normal">{translate("spend.colOut")}</th>
                  <th scope="col" className="py-1 pr-3 text-right font-normal">{translate("spend.colUnmetered")}</th>
                  <th scope="col" className="py-1 pr-3 font-normal">{translate("spend.colRateIn")}</th>
                  <th scope="col" className="py-1 pr-3 font-normal">{translate("spend.colRateOut")}</th>
                  <th scope="col" className="py-1 text-right font-normal">{translate("spend.colCost")}</th>
                </tr>
              </thead>
              <tbody>
                {report.models.map((row) => {
                  const draft = rates[row.key] ?? { input: "", output: "" };
                  const cost = rowCost(row, toRate(draft));
                  return (
                    <tr key={row.key} className="border-t border-edge">
                      <th scope="row" className="py-2 pr-3 text-left font-mono text-xs font-normal">{row.key}</th>
                      <td className="py-2 pr-3 text-right font-mono text-xs">{formatTokens(row.calls, locale)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-xs">{formatTokens(row.input, locale)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-xs">{formatTokens(row.output, locale)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-xs">{formatTokens(row.unmetered, locale)}</td>
                      {/*
                         The column heading is not a label a screen reader reaches from inside the
                         cell, which is why each of these carried its own `aria-label` naming the
                         model. `hideLabel` keeps that word and attaches it to the box.
                        */}
                      <td className="py-2 pr-3">
                        <Field
                          label={translate("spend.rateInLabel", { model: row.key })}
                          hideLabel
                          size="sm"
                          className="w-24"
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          placeholder="—"
                          value={draft.input}
                          disabled={busy}
                          onChange={(event) => setRate(row.key, "input", event.target.value)}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Field
                          label={translate("spend.rateOutLabel", { model: row.key })}
                          hideLabel
                          size="sm"
                          className="w-24"
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          placeholder="—"
                          value={draft.output}
                          disabled={busy}
                          onChange={(event) => setRate(row.key, "output", event.target.value)}
                        />
                      </td>
                      <td className="py-2 text-right font-mono text-xs">
                        {hasNoTokenMeasurement(row)
                          ? translate("spend.rateUnmetered")
                          : cost === null ? translate("spend.rateMissing") : formatMoney(cost, shown, locale)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card as="section" aria-labelledby="spend-shots-title">
        <h2 id="spend-shots-title" className="text-base font-semibold">{translate("spend.shots")}</h2>
        <p id="spend-shots-hint" className="mt-2 max-w-2xl text-xs leading-relaxed text-smoke">{translate("spend.shotsHint")}</p>
        <fieldset aria-labelledby="spend-shots-title" aria-describedby="spend-shots-hint" className="mt-4 flex flex-col gap-3 border-0 p-0">
          <ShotOption
            value="full"
            chosen={shots}
            disabled={busy}
            label={translate("spend.shotFull")}
            hint={translate("spend.shotFullHint")}
            onChoose={choose}
          />
          <ShotOption
            value="fit"
            chosen={shots}
            disabled={busy}
            label={translate("spend.shotFit", { n: formatTokens(report.shotEdge, locale) })}
            hint={translate("spend.shotFitHint")}
            onChoose={choose}
          />
        </fieldset>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-smoke">{translate("spend.shotsPng")}</p>
      </Card>

      <div className={dirty || busy || saved
        ? "sticky bottom-[calc(var(--dock-height)+env(safe-area-inset-bottom,0px)+var(--space-2))] rounded-lg border border-edge bg-surface p-3 min-[761px]:bottom-4"
        : "py-2"}
      >
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton type="submit" tone="accent" busy={busy} busyLabel={translate("spend.saving")}>
            {translate("spend.save")}
          </ActionButton>
          <p role="status" aria-live="polite" className="text-xs text-smoke">
            {dirty ? translate("spend.dirty") : saved ? translate("spend.saved") : ""}
          </p>
        </div>
        {error && <ActionError text={error} className="mt-3" />}
      </div>
    </form>
  );
}

/**
 * One of the two sizes a capture can travel at.
 *
 * A radio and not a switch because there is no default half of this pair to hide: `screenshot.ts`
 * refused to shrink a capture at all rather than change what the critic judges without telling
 * anyone, and the answer to that refusal is a choice with both halves on screen and what each one
 * costs written beside it. No token figure is promised here on purpose — every provider counts the
 * pixels of an image with its own arithmetic, which is why `look.ts` sends none — so the trade is
 * spoken in pixels, which are the same everywhere.
 */
/*
  A RADIO, and there is no radio in the primitives: `Check` is `type="checkbox"` with the type
  omitted from what a caller may pass, and `Field` draws a text box. So this pair stays as it is,
  and it is the one shape of the five the theme's control family does not cover.
 */
function ShotOption({
  value,
  chosen,
  disabled,
  label,
  hint,
  onChoose,
}: {
  value: ShotChoice;
  chosen: ShotChoice;
  disabled: boolean;
  label: string;
  hint: string;
  onChoose: (value: ShotChoice) => void;
}) {
  const id = `spend-shots-${value}`;
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-sm">
      <input
        id={id}
        type="radio"
        name="spend-shots"
        value={value}
        checked={chosen === value}
        disabled={disabled}
        onChange={() => onChoose(value)}
        className="mt-1"
      />
      <span className="max-w-2xl">
        {label}
        <span className="mt-0.5 block text-xs leading-relaxed text-smoke">{hint}</span>
      </span>
    </label>
  );
}

/**
 * One family: its name, what its cap holds back, and the box. When the environment decides, the
 * box is off and the note names the variable — and says so when its value could not be read,
 * because a file value nobody is applying must not look chosen.
 */
function CapRow({
  line,
  value,
  disabled,
  onChange,
}: {
  line: FamilyLine;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const translate = useT();
  const locale = useLocale();
  const id = `spend-cap-${line.family}`;
  const fromEnv = line.env !== undefined;
  const isPaused = line.source === "paused";
  const isDisabled = line.cap === 0;
  const isExhausted = line.used >= line.cap;
  const source = line.source === "env"
    ? translate("spend.source.env", { name: line.variable })
    : translate(SOURCE_KEY[line.source]);
  return (
    <li className="border-t border-edge pt-4 first:border-0 first:pt-0">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem] sm:gap-x-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <label id={`${id}-name`} htmlFor={id} className="text-sm font-semibold">
              {translate(FAMILY_KEY[line.family])}
            </label>
            <Tag tone={isPaused || isDisabled || isExhausted ? "strong" : "neutral"} size="md">
              {translate(isPaused ? "spend.state.paused" : isDisabled ? "spend.state.disabled" : isExhausted ? "spend.state.exhausted" : "spend.state.enabled")}
            </Tag>
          </div>
          <p id={`${id}-hint`} className="mt-1 text-xs leading-relaxed text-smoke">
            {translate(FAMILY_HINT_KEY[line.family])}
          </p>
          <p className="mt-2 font-mono text-xs text-smoke">
            {translate(line.family === "app" ? "spend.usageAttempts" : "spend.usageCalls", {
              used: formatTokens(line.used, locale), cap: formatTokens(line.cap, locale),
            })}
          </p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-raised" aria-hidden>
            <div className="h-full bg-chalk" style={{ width: `${share(line.used, line.cap)}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-2 text-xs text-smoke">
            <Tag size="md">{source}</Tag>
            {line.source !== "factory" && <span>{translate("spend.factory", { n: formatTokens(line.factory, locale) })}</span>}
          </div>
          <SpendDetails row={line} />
        </div>
        <div className="max-w-28">
          <span id={`${id}-unit`} className="mb-1 block text-xs leading-relaxed text-smoke">
            {translate(line.family === "app" ? "spend.capAttempts" : "spend.capCalls")}
          </span>
          <input
            id={id}
            aria-labelledby={`${id}-name ${id}-unit`}
            aria-describedby={`${id}-hint${fromEnv ? ` ${id}-env` : ""}`}
            type="number"
            min={0}
            max={100000}
            step={1}
            inputMode="numeric"
            placeholder={String(line.factory)}
            value={fromEnv ? String(line.cap) : value}
            disabled={disabled || fromEnv}
            onChange={(event) => onChange(event.target.value)}
            className={FIELD}
          />
        </div>
      </div>
      {fromEnv && (
        <p id={`${id}-env`} className="mt-2 text-xs leading-relaxed text-smoke">
          {line.envReadable === false
            ? translate("spend.envUnread", { name: line.variable, value: line.env ?? "", factory: line.factory })
            : translate("spend.envDecides", { name: line.variable, value: line.env ?? "" })}
        </p>
      )}
      {line.family === "app" && <p className="mt-2 text-xs leading-relaxed text-smoke">{translate("spend.appReservationsHint")}</p>}
    </li>
  );
}

/** Usage stays beside the family that generated it, including calls with no token measurement. */
function SpendDetails({ row }: { row: SpendDetail }) {
  const translate = useT();
  const locale = useLocale();
  if (!hasDetail(row)) return null;
  const parts: string[] = [];
  if (row.input + row.output > 0) {
    parts.push(translate("spend.tokens", {
      input: formatTokens(row.input, locale), output: formatTokens(row.output, locale),
    }));
  }
  if (row.unmetered > 0) parts.push(translate("spend.unmetered", { n: formatTokens(row.unmetered, locale) }));
  if (row.images > 0) parts.push(translate("spend.images", { n: formatTokens(row.images, locale) }));
  return <p className="mt-2 font-mono text-xs leading-relaxed text-smoke">{parts.join(" · ")}</p>;
}
