"use client";

import Link from "next/link";
import { HiOutlineSparkles } from "react-icons/hi2";
import type { ConversationRef } from "@panoma/handoff";
import { iconKey, sizeText, sourceLabel } from "@/lib/handoff-view";
import { relativeDate } from "@/lib/relative-date";
import { BRAND_ICONS } from "./brand-icons";
import { useLocale, useT } from "./i18n-provider";
import { Card, EmptyState } from "./primitives";

/*
  The block on the project card: what the agents kept in this folder, on this disk. It is a
  different fact from what they reported through the agent channel — that is under Agents — and
  the sub-line says so, because the two lists can disagree and both be right.

  The rows are read by the page, newest five, and every one links to the handoff screen with the
  project preselected: nothing is handed on from here, only found.
 */
export function HandoffConversations({ conversations, slug }: { conversations: ConversationRef[]; slug: string }) {
  const t = useT();
  const locale = useLocale();
  const target = `/handoff?project=${encodeURIComponent(slug)}`;

  return (
    <Card as="section" aria-labelledby="project-conversations-title">
      <h3 id="project-conversations-title" className="eyebrow mb-1">
        {t("project.conversations")}
      </h3>
      <p className="mb-2.5 text-xs leading-relaxed text-smoke">{t("project.conversationsLead")}</p>
      {conversations.length === 0 ? (
        <EmptyState variant="note" title={t("project.noConversations")} />
      ) : (
        <>
          <ul className="space-y-1.5">
            {conversations.map((row) => {
              const Icon = BRAND_ICONS[iconKey(row.agent, row.surface)] ?? HiOutlineSparkles;
              return (
                <li key={row.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs">
                  <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-smoke" />
                  <span className="shrink-0 font-mono text-[10px] text-faint">{sourceLabel(row.agent, row.surface)}</span>
                  <Link href={target} className="min-w-0 max-w-full flex-1 basis-40 truncate text-chalk hover:underline" title={row.title ?? row.handle}>
                    {row.title ?? row.handle}
                  </Link>
                  <span className="font-mono text-[10px] text-faint">
                    {row.turnCount === null ? t("handoff.size", { size: sizeText(row.bytes) }) : t("handoff.turns", { n: row.turnCount })}
                    {" · "}
                    {relativeDate(row.updatedAt, locale)}
                  </span>
                </li>
              );
            })}
          </ul>
          <Link href={target} className="mt-2.5 inline-block font-mono text-[11px] text-accent hover:underline">
            {t("handoff.projectMore")}
          </Link>
        </>
      )}
    </Card>
  );
}
