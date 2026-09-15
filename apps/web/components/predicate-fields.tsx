"use client";

import { useId } from "react";
import type { MemoryOperation, Predicate, PredicateNode } from "@panoma/core";
import { useT } from "./i18n-provider";
import { ActionButton, Check, Field, Select } from "./primitives";

export interface PredicateDraft {
  mode: "all" | "any";
  rows: { kind: "operation_is" | "path_under" | "task_kind_is"; value: string; negated: boolean }[];
}

export function predicateFromDraft(draft: PredicateDraft): Predicate | null {
  if (!draft.rows.length) return null;
  const nodes: PredicateNode[] = draft.rows.map((row) => {
    const leaf: PredicateNode = row.kind === "operation_is"
      ? { kind: row.kind, operation: row.value as MemoryOperation }
      : row.kind === "path_under" ? { kind: row.kind, path: row.value.trim() }
        : { kind: row.kind, taskKind: row.value.trim() };
    return row.negated ? { not: leaf } : leaf;
  });
  return { schemaVersion: 1, expression: draft.mode === "all" ? { all: nodes } : { any: nodes } };
}

/** Common context conditions, authored by the person and sent as the revisioned predicate. */
export function PredicateFields({ label, value, onChange, disabled }: {
  label: string; value: PredicateDraft; onChange: (value: PredicateDraft) => void; disabled: boolean;
}) {
  const translate = useT();
  const id = useId();
  const update = (index: number, patch: Partial<PredicateDraft["rows"][number]>) =>
    onChange({ ...value, rows: value.rows.map((row, current) => current === index ? { ...row, ...patch } : row) });
  return <fieldset disabled={disabled} className="mt-4 border-t border-edge pt-4">
    <legend className="text-sm font-semibold">{label}</legend>
    {value.rows.length > 1 && <Select label={translate("twinTeach.match")} value={value.mode}
      onChange={(event) => onChange({ ...value, mode: event.target.value as "all" | "any" })}>
      <option value="all">{translate("twinTeach.matchAll")}</option>
      <option value="any">{translate("twinTeach.matchAny")}</option>
    </Select>}
    <div className="space-y-3">
      {value.rows.map((row, index) => <div key={`${id}-${index}`} className="mt-3 space-y-2 rounded border border-edge p-3">
        <Select label={translate("twinTeach.contextKind")} value={row.kind}
          onChange={(event) => update(index, { kind: event.target.value as typeof row.kind, value: event.target.value === "operation_is" ? "edit" : "" })}>
          <option value="operation_is">{translate("twinTeach.operation")}</option>
          <option value="path_under">{translate("twinTeach.path")}</option>
          <option value="task_kind_is">{translate("twinTeach.taskKind")}</option>
        </Select>
        {row.kind === "operation_is" ? <Select label={translate("twinTeach.operation")} value={row.value}
          onChange={(event) => update(index, { value: event.target.value })}>
          <option value="read">{translate("twinTeach.opRead")}</option>
          <option value="edit">{translate("twinTeach.opEdit")}</option>
          <option value="test">{translate("twinTeach.opTest")}</option>
          <option value="build">{translate("twinTeach.opBuild")}</option>
          <option value="deploy">{translate("twinTeach.opDeploy")}</option>
          <option value="review">{translate("twinTeach.opReview")}</option>
          <option value="other">{translate("twinTeach.opOther")}</option>
        </Select> : <Field label={translate(row.kind === "path_under" ? "twinTeach.pathValue" : "twinTeach.taskValue")}
          value={row.value} required maxLength={row.kind === "path_under" ? 2048 : 64}
          pattern={row.kind === "task_kind_is" ? "[a-z][a-z0-9_-]*" : undefined}
          placeholder={row.kind === "path_under" ? "src/components" : "implementation"}
          onChange={(event) => update(index, { value: event.target.value })} />}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Check checked={row.negated} onChange={(event) => update(index, { negated: event.target.checked })}>{translate("twinTeach.negate")}</Check>
          <ActionButton type="button" tone="quiet" size="sm" onClick={() => onChange({ ...value, rows: value.rows.filter((_, current) => current !== index) })}>
            {translate("twinTeach.removeCondition")}
          </ActionButton>
        </div>
      </div>)}
    </div>
    <ActionButton type="button" tone="quiet" size="sm" className="mt-3" disabled={disabled || value.rows.length >= 20}
      onClick={() => onChange({ ...value, rows: [...value.rows, { kind: "operation_is", value: "edit", negated: false }] })}>
      {translate("twinTeach.addCondition")}
    </ActionButton>
  </fieldset>;
}
