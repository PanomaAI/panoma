import type { Composition, ProjectKind } from "@panoma/core";
import { t, type Locale, type MessageKey } from "@/lib/i18n";

/**
 * The phrase that Panoma composes by itself, written in the language of whoever reads it.
 *
 * It is the description of the projects that do not have any: not a single line in manifest nor a
 * README with prose. On a real disk, those are the majority, so this sentence is what is read on
 * half of the cards — and until today it was composed in Spanish within the engine and came out
 * exactly like that, no matter what the browser said.
 *
 * The engine keeps composing, but now it delivers **pieces**: what kind of project it is, what it
 * is made of, what services it uses, where it is published, and who wrote its history. The words
 * are provided by this, which is the only thing that has in front of it a person and a dictionary.
 *
 * Proper names do not go through the dictionary and should not: `Flutter`, `Stripe`, and
 * `App Store` are called the same in both languages, and 'translating' them would be inventing a
 * product.
 */

/** Each type of project has its key; the engine only says which one. */
const KIND: Record<ProjectKind, MessageKey> = {
  "mobile-app": "summary.kind.mobileApp",
  "web-app": "summary.kind.webApp",
  cli: "summary.kind.cli",
  package: "summary.kind.package",
  backend: "summary.kind.backend",
  container: "summary.kind.container",
  project: "summary.kind.project",
};

export function renderComposition(locale: Locale, composition: Composition): string {
  const parts: string[] = [];
  const kind = t(locale, KIND[composition.kind] ?? "summary.kind.project");

  parts.push(
    composition.stack.length > 0
      ? t(locale, "summary.builtWith", { kind, stack: join(locale, composition.stack) })
      : kind,
  );

  if (composition.services.length > 0) {
    parts.push(t(locale, "summary.uses", { list: join(locale, composition.services) }));
  }
  if (composition.stores.length > 0) {
    parts.push(t(locale, "summary.publishedOn", { list: join(locale, composition.stores) }));
  }
  if (composition.topAgent) {
    parts.push(
      t(locale, "summary.writtenBy", {
        share: composition.topAgent.share,
        agent: composition.topAgent.name,
      }),
    );
  }

  return `${parts.join(", ")}.`;
}

/**
 * «a, b, and c» — the conjunction is also from the language, and it is the only thing that is
 * translated from the list.
 */
function join(locale: Locale, items: string[]): string {
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} ${t(locale, "summary.and")} ${items[items.length - 1]}`;
}

/**
 * What needs to be taught from a project, choosing between what a person wrote and what the engine
 * composed.
 *
 * The order does not change: what someone wrote rules. The only thing that changes is that when
 * there is no one to quote, the sentence is written here instead of coming ready-made from the
 * scan.
 *
 * `composed` —the same phrase, in English, exactly as it came out of the engine— is kept as a
 * backup for the scanned rows before the composition existed. Teaching old English is better than
 * teaching a blank.
 */
export function summaryToShow(
  locale: Locale,
  project: {
    summary?: string | null;
    summarySource?: string | null;
    summaryComposition?: unknown;
    summaryComposed?: string | null;
    description?: string | null;
  },
): string | null {
  if (project.summarySource === "composed" && isComposition(project.summaryComposition)) {
    return renderComposition(locale, project.summaryComposition);
  }
  return project.summary ?? project.description ?? null;
}

/** It comes from `jsonb`, so it arrives as `unknown` and you have to look at it before believing it. */
function isComposition(value: unknown): value is Composition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Composition>;
  return (
    typeof candidate.kind === "string" &&
    Array.isArray(candidate.stack) &&
    Array.isArray(candidate.services) &&
    Array.isArray(candidate.stores)
  );
}
