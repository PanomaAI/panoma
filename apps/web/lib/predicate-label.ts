import type { PredicateNode } from "@panoma/core";
import { t, type Locale, type MessageKey } from "./i18n";

/** Browser wording of the same tree; machine delivery continues to use core's English renderer. */
export function predicateLabel(locale: Locale, node: PredicateNode): string {
  if ("all" in node) return node.all.map((child) => `(${predicateLabel(locale, child)})`).join(t(locale, "predicate.and"));
  if ("any" in node) return node.any.map((child) => `(${predicateLabel(locale, child)})`).join(t(locale, "predicate.or"));
  if ("not" in node) return t(locale, "predicate.not", { value: predicateLabel(locale, node.not) });
  switch (node.kind) {
    case "project_is": return t(locale, "predicate.project", { value: node.projectId });
    case "path_under": return t(locale, "predicate.path", { value: node.path });
    case "environment_is": return t(locale, "predicate.environment", { value: node.environmentId });
    case "task_kind_is": return t(locale, "predicate.task", { value: node.taskKind });
    case "check_result_is": return t(locale, "predicate.check", { value: node.checkId, revision: node.revision, result: t(locale, node.result === "pass" ? "predicate.pass" : node.result === "fail" ? "predicate.fail" : "predicate.unknown") });
    case "operation_is": {
      const keys: Record<typeof node.operation, MessageKey> = { read: "twinTeach.opRead", edit: "twinTeach.opEdit", test: "twinTeach.opTest", build: "twinTeach.opBuild", deploy: "twinTeach.opDeploy", review: "twinTeach.opReview", other: "twinTeach.opOther" };
      return t(locale, "predicate.operation", { value: t(locale, keys[node.operation]) });
    }
  }
}
