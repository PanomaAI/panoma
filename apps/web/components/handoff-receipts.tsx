"use client";

import Link from "next/link";
import { useState } from "react";
import { HiOutlineArrowRight, HiOutlineSparkles } from "react-icons/hi2";
import { postJson } from "@/lib/api";
import { TIER_KEY, agentLabel, iconKey, isNativeTarget, sourceLabel, type HandoffReceiptView } from "@/lib/handoff-view";
import { relativeTime } from "@/lib/relative-date";
import { BRAND_ICONS } from "./brand-icons";
import { CopyCommand } from "./copy-button";
import { useLocale, useT } from "./i18n-provider";
import { ActionButton, ActionError, Card, EmptyState, Tag } from "./primitives";

/*
  «Done so far»: the receipts, newest first. A receipt says which conversation became which, at
  which tier, and the line that resumes it; it never holds the text. The page looked at every
  target file before handing the rows over, so a copy the agent has since deleted or moved says so
  here instead of handing the person a command that fails.

  A copy meant for a desktop app reads «→ Claude (app)» and its button opens the app's link
  instead of a terminal; the server builds the link from the receipt, never from a stored string.
 */
export function HandoffReceipts({ receipts }: { receipts: HandoffReceiptView[] }) {
  const t = useT();
  if (receipts.length === 0) {
    return <EmptyState variant="note" title={t("handoff.doneEmpty")} />;
  }
  return (
    <ul className="grid grid-cols-1 gap-3">
      {receipts.map((receipt) => (
        <ReceiptRow key={receipt.id} receipt={receipt} />
      ))}
    </ul>
  );
}

function ReceiptRow({ receipt }: { receipt: HandoffReceiptView }) {
  const t = useT();
  const locale = useLocale();
  const Source = BRAND_ICONS[receipt.sourceAgent] ?? HiOutlineSparkles;
  const inApp = receipt.targetSurface === "app";
  const Target = BRAND_ICONS[iconKey(receipt.targetAgent, receipt.targetSurface)] ?? HiOutlineSparkles;
  const targetName = sourceLabel(receipt.targetAgent, receipt.targetSurface);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  /* The same outcomes as an assignment's «open in your terminal»; the server re-derives argv. */
  async function launch() {
    setBusy(true);
    setNote(null);
    const answer = await postJson<{ with?: string }>("/api/handoff/launch", { receipt: receipt.id }, t("project.unreachable"));
    setNote(
      answer.ok
        ? { text: inApp ? t("handoff.appOpened", { app: targetName }) : t("assignment.launched", { agent: targetName }), bad: false }
        : { text: `${inApp ? t("handoff.appOpenFailed", { app: targetName }) : t("assignment.launchFailed")} ${answer.message}`, bad: true },
    );
    setBusy(false);
  }

  /*
    Both doors want the project's folder the catalog vouches for; without one, the line is copied
    by hand. A brief is a document, not a session: its receipt names the file's stem where a
    session id would go, and the launch route could only answer invalid-id, so it gets no door.
   */
  const canLaunch = receipt.projectId !== null && isNativeTarget(receipt.targetAgent) && receipt.tier !== "brief" && receipt.fileExists !== false;

  return (
    <Card as="li" className="grid grid-cols-1 gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Source aria-hidden className="h-4 w-4 text-smoke" />
        <HiOutlineArrowRight aria-hidden className="h-3.5 w-3.5 text-faint" />
        <Target aria-hidden className="h-4 w-4 text-smoke" />
        <span className="font-mono text-[11px] text-smoke">
          {t("handoff.receipt", {
            source: agentLabel(receipt.sourceAgent),
            target: targetName,
            tier: t(TIER_KEY[receipt.tier]),
            when: relativeTime(receipt.createdAt, locale),
          })}
        </span>
        {receipt.requestedBy && (
          /* An agent asked over the MCP channel: the receipt says which, by the name of its key. */
          <span className="font-mono text-[11px] text-faint">{t("handoff.receiptVia", { agent: receipt.requestedBy })}</span>
        )}
        {receipt.fileExists === false && (
          <Tag tone="idle" className="ml-auto">
            {t("handoff.fileGone", { agent: targetName })}
          </Tag>
        )}
      </div>
      {receipt.title && <p className="truncate text-sm text-chalk">{receipt.title}</p>}
      {receipt.resumeCommand && (
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded border border-edge bg-ground px-2 py-1 font-mono text-[11px] text-chalk">
            {receipt.resumeCommand}
          </code>
          <CopyCommand command={receipt.resumeCommand} label={t("handoff.copy")} locale={locale} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {canLaunch && (
          <ActionButton
            tone="accent"
            size="sm"
            type="button"
            onClick={() => void launch()}
            busy={busy}
            busyLabel={t("assignment.launching")}
            title={inApp ? undefined : t("assignment.launchTitle", { agent: targetName })}
          >
            {inApp ? t("handoff.openInApp", { app: targetName }) : t("assignment.launch")}
          </ActionButton>
        )}
        {receipt.projectSlug && (
          <Link href={`/p/${receipt.projectSlug}`} className="font-mono text-[11px] text-accent hover:underline">
            {t("handoff.openProject")}
          </Link>
        )}
        {note && (note.bad ? <ActionError as="span" text={note.text} /> : <span role="status" className="text-xs text-smoke">{note.text}</span>)}
      </div>
    </Card>
  );
}
