"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { HiOutlineArrowPath, HiOutlineChatBubbleLeftRight, HiOutlineSparkles } from "react-icons/hi2";
import type { ConversationRef } from "@panoma/handoff";
import {
  AGENT_LABELS,
  agentLabel,
  clockText,
  dedupeById,
  filterConversations,
  groupByProject,
  iconKey,
  limitBadge,
  projectFilterFrom,
  resumeCommandOf,
  sizeText,
  sortNewest,
  sourceLabel,
  untilText,
  type HandoffList,
  type HandoffReceiptView,
  type RootRow,
} from "@/lib/handoff-view";
import { relativeTime } from "@/lib/relative-date";
import { BRAND_ICONS } from "./brand-icons";
import { inFolder, type Shell } from "./command";
import { CopyCommand } from "./copy-button";
import { HandoffPanel } from "./handoff-panel";
import { HandoffReceipts } from "./handoff-receipts";
import { useLocale, useT } from "./i18n-provider";
import { PageSection } from "./page-shell";
import { ActionButton, ActionError, Card, EmptyState, Select, Tag } from "./primitives";

/*
  The screen: what the agents kept on this disk, grouped by project, and what was handed on so
  far. The list is fetched once from `GET /api/handoff` — discovery stats every candidate file, so
  it is asked for on purpose and not on every render — and refreshed with `?fresh=1` when the
  person asks, or after a write.

  The receipts arrive from the server page, which is the one that can `stat` each target file;
  a receipt written from this screen is added to the top of that list without a round trip.
 */
export function HandoffScreen({
  roots,
  shell,
  receipts: initialReceipts,
  remote,
  initialProject,
}: {
  roots: RootRow[];
  shell: Shell;
  receipts: HandoffReceiptView[];
  remote: boolean;
  initialProject?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [data, setData] = useState<HandoffList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [agent, setAgent] = useState("all");
  const [project, setProject] = useState(() => projectFilterFrom(initialProject, roots));
  const [open, setOpen] = useState<ConversationRef | null>(null);
  const [receipts, setReceipts] = useState(initialReceipts);
  /* After `router.refresh()` the page hands a new list, with the project slug and the file check. */
  useEffect(() => setReceipts(initialReceipts), [initialReceipts]);
  /* One clock per render of the list, so every badge agrees on what «now» is. */
  const [now, setNow] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(attempt === 0 ? "/api/handoff" : "/api/handoff?fresh=1", { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as HandoffList & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? String(response.status));
        return payload;
      })
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setData(loaded);
        setError(null);
        setNow(Date.now());
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("project.unreachable"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // `t` changes only with the locale, which remounts the tree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  function refresh() {
    setLoading(true);
    setAttempt((current) => current + 1);
  }

  const rows = useMemo(() => dedupeById(data?.conversations ?? []), [data]);
  const filtered = useMemo(() => filterConversations(rows, roots, { agent, project }), [rows, roots, agent, project]);
  const groups = useMemo(() => groupByProject(filtered, roots), [filtered, roots]);
  const agentsSeen = useMemo(() => [...new Set(rows.map((row) => row.agent))].sort(), [rows]);
  const isRemote = remote || data?.remote === true;
  const filtering = agent !== "all" || project !== "all";

  const projectWord =
    project === "all" ? t("handoff.allProjects") : project === "none" ? t("handoff.notInCatalog") : roots.find((root) => root.slug === project)?.name ?? project;
  const agentWord = agent === "all" ? t("handoff.allAgents") : agentLabel(agent);

  return (
    <>
      <PageSection title={t("handoff.conversations")}>
        <div className="flex flex-wrap items-end gap-3">
          <p className="min-w-0 flex-1 basis-64 text-sm text-smoke">{t("handoff.conversationsLead")}</p>
          <Select label={t("handoff.filterAgent")} size="sm" value={agent} onChange={(event) => setAgent(event.target.value)} className="w-44">
            <option value="all">{t("handoff.allAgents")}</option>
            {agentsSeen.map((id) => (
              <option key={id} value={id}>
                {AGENT_LABELS[id] ?? id}
              </option>
            ))}
          </Select>
          <Select label={t("handoff.filterProject")} size="sm" value={project} onChange={(event) => setProject(event.target.value)} className="w-52">
            <option value="all">{t("handoff.allProjects")}</option>
            {roots.map((root) => (
              <option key={root.slug} value={root.slug}>
                {root.name}
              </option>
            ))}
            <option value="none">{t("handoff.notInCatalog")}</option>
          </Select>
          <ActionButton tone="surface" size="sm" type="button" onClick={refresh} busy={loading} busyLabel={t("handoff.listLoading")} aria-label={t("handoff.refresh")} title={t("handoff.refresh")}>
            <HiOutlineArrowPath aria-hidden className="h-4 w-4" />
          </ActionButton>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4">
          {error && <ActionError text={error} />}
          {loading && !data && (
            <p role="status" className="text-sm text-smoke">
              {t("handoff.listLoading")}
            </p>
          )}
          {isRemote && data && <EmptyState variant="framed" icon={<HiOutlineChatBubbleLeftRight className="h-8 w-8" />} title={t("handoff.remote")} />}
          {!isRemote && data && rows.length === 0 && (
            <EmptyState variant="framed" icon={<HiOutlineChatBubbleLeftRight className="h-8 w-8" />} title={t("handoff.emptyAll")}>
              {t("handoff.emptyAllLead")}
            </EmptyState>
          )}
          {!isRemote && data && rows.length === 0 && (
            <ul className="grid grid-cols-1 gap-1 font-mono text-[11px] text-smoke">
              {data.stores.map((store) => (
                <li key={store.agent}>
                  {store.found
                    ? t("handoff.storeFound", { agent: agentLabel(store.agent), path: store.path, n: store.conversations })
                    : t("handoff.storeMissing", { agent: agentLabel(store.agent), path: store.path })}
                </li>
              ))}
            </ul>
          )}
          {!isRemote && data && rows.length > 0 && filtered.length === 0 && (
            <EmptyState
              variant="bare"
              title={t("handoff.emptyFilter", { agent: agentWord, project: projectWord })}
              action={
                <ActionButton
                  tone="surface"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setAgent("all");
                    setProject("all");
                  }}
                >
                  {t("handoff.showAll")}
                </ActionButton>
              }
            />
          )}
          {groups.map((group) => (
            <Card as="section" key={group.slug ?? group.path} aria-labelledby={`handoff-group-${group.slug ?? "loose"}-${hash(group.path)}`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {group.slug ? (
                  <h3 id={`handoff-group-${group.slug}-${hash(group.path)}`} className="font-display text-base font-semibold tracking-tight">
                    <Link href={`/p/${group.slug}`} className="hover:underline">
                      {group.name}
                    </Link>
                  </h3>
                ) : (
                  <h3 id={`handoff-group-loose-${hash(group.path)}`} className="font-display text-base font-semibold tracking-tight">
                    {t("handoff.notInCatalog")}
                  </h3>
                )}
                <span className="min-w-0 max-w-full truncate font-mono text-[11px] text-faint" title={group.path}>
                  {group.path}
                </span>
              </div>
              {!group.slug && <p className="mt-1 text-xs text-smoke">{t("handoff.scanHint", { path: group.path })}</p>}
              <ul className="mt-3 divide-y divide-edge/50">
                {sortNewest(group.conversations).map((row) => (
                  <ConversationRow key={row.id} row={row} now={now} shell={shell} onOpen={() => setOpen(row)} />
                ))}
              </ul>
            </Card>
          ))}
          {filtering && filtered.length > 0 && (
            <div>
              <ActionButton
                tone="quiet"
                size="sm"
                type="button"
                onClick={() => {
                  setAgent("all");
                  setProject("all");
                }}
              >
                {t("handoff.showAll")}
              </ActionButton>
            </div>
          )}
        </div>
      </PageSection>

      <PageSection title={t("handoff.done")}>
        <HandoffReceipts receipts={receipts} />
      </PageSection>

      {open && data && (
        <HandoffPanel
          conversation={open}
          agents={data.agents}
          stores={data.stores}
          digest={data.digest}
          shell={shell}
          onClose={() => setOpen(null)}
          onWritten={(receipt) => {
            setReceipts((current) => [receipt, ...current]);
            router.refresh();
            refresh();
          }}
        />
      )}
    </>
  );
}

/** A short, stable suffix for an element id derived from a path; only letters and digits survive. */
function hash(path: string): string {
  let h = 0;
  for (const char of path) h = (h * 31 + char.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

function ConversationRow({
  row,
  now,
  shell,
  onOpen,
}: {
  row: ConversationRef;
  now: number;
  shell: Shell;
  onOpen: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const Icon = BRAND_ICONS[iconKey(row.agent, row.surface)] ?? HiOutlineSparkles;
  const badge = limitBadge(row.limit, now);
  const resume = badge?.state === "after" ? resumeCommandOf(row.agent, row.sessionId) : undefined;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
      <span className="flex items-center gap-1.5 font-mono text-[11px] text-smoke">
        <Icon aria-hidden className="h-4 w-4" />
        {sourceLabel(row.agent, row.surface)}
      </span>
      <span className="min-w-0 max-w-full flex-1 basis-48 truncate text-sm text-chalk" title={row.title ?? row.handle}>
        {row.title ?? row.handle}
      </span>
      <span className="font-mono text-[11px] text-faint">{relativeTime(row.updatedAt, locale, now)}</span>
      <span className="font-mono text-[11px] text-faint">
        {row.turnCount === null ? t("handoff.size", { size: sizeText(row.bytes) }) : t("handoff.turns", { n: row.turnCount })}
      </span>
      {row.compacted && (
        <Tag tone="neutral" title={t("handoff.summarizedTitle")}>
          {t("handoff.summarized")}
        </Tag>
      )}
      {badge && (
        /*
          A fact in ink, with the hue on the dot: the amber word alone would be 3.54:1, unreadable
          at this size, and the badge is precisely what a person reads on the way to the button.
         */
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-chalk">
          <span className={`h-[6px] w-[6px] rounded-full ${badge.state === "after" ? "bg-live" : "bg-idle"}`} aria-hidden />
          {badge.state === "before"
            ? t("handoff.limitBefore", { relative: untilText(badge.resetsAt, locale, now), time: clockText(badge.resetsAt, locale, now) })
            : badge.state === "after"
              ? t("handoff.limitAfter", { time: clockText(badge.resetsAt, locale, now) })
              : t("handoff.limitUnknown")}
        </span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {resume && <CopyCommand command={inFolder(row.cwd, resume, shell)} label={t("handoff.resumeAsWas")} locale={locale} />}
        <ActionButton tone="accent" size="sm" type="button" onClick={onOpen}>
          {t("handoff.continueIn")}
        </ActionButton>
      </span>
    </li>
  );
}
