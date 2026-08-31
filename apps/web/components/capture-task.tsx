"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
// The list of 'pending' states lives in `lib/tasks`: the record (server) filters the queue with it,
// and from a client module it could not be imported as a value.
import { OPEN_STATUSES } from "@/lib/tasks";
import { TaskStatus } from "./activity";
import { useLocale, useT } from "./i18n-provider";
import { ActionButton, ActionError } from "./primitives";

/**
 * Write a message for your agent and see it waiting.
 *
 * It is the only part of the record that is written instead of read, and it is here because of
 * what happens when it is not: you think "tomorrow we need to fix the login" while looking at the
 * project, you have nowhere to put it —the task queue only accepted entries with an agent key— and
 * it ends up on a piece of paper, in a TODO lost in a file, or in nothing.
 *
 * What it **is not**, and should not become: a task manager. There are no states to change, no
 * assignments, no columns, no order to drag. It is captured and seen; the work is picked up by the
 * agent through MCP, and it is they who move the state, which is the only version of this that
 * does not compete with the promise of the product. The cemetery of kanban boards for agents is
 * already full —Vibe Kanban closed with thirty thousand users— and they all died of the same
 * thing: asking the human to manage the work they had delegated.
 *
 * That's why the list next door shows only the open ones. The completed ones are in the logbook,
 * which is where you look at what has already happened; here only what the agent is going to find
 * matters.
 */

/*
  The task states are rendered translated —`taskState.open` and its three sisters— and what travels
  to the agent through MCP is still the raw value from the database: they are two surfaces with
  two languages, and what keeps them aligned is that the translation is done when rendering and
  nowhere else. Here it said the opposite, that they were not translated, and it had been lying
  since `TaskStatus` started requesting language.
 */
export interface CapturedTask {
  id: string;
  title: string;
  status: string;
  createdBy: string;
  agentName: string | null;
}


/**
 * The same stop that validates the route; here it only prevents writing too much so that it gets
 * cut off.
 */
const MAX_TITLE = 160;

export function CaptureTask({ slug, tasks }: { slug: string; tasks: CapturedTask[] }) {
  const t = useT();
  /*
    The language, for the state chips.
    `TaskStatus` requested it with a Spanish defect, so this card —which is displayed in English
    like the entire interface— showed 'abierta' and 'en curso' embedded within English text. The
    defect no longer exists: whoever displays a chip now has to specify in which language.
   */
  const locale = useLocale();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();
  const router = useRouter();

  const open = tasks.filter((task) => OPEN_STATUSES.includes(task.status));
  const busy = saving || refreshing;

  async function capture(event: React.FormEvent) {
    event.preventDefault();
    const frase = title.trim();
    if (!frase || busy) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, title: frase }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.ok) {
        // The field empties before refreshing: the task is already saved and leaving it written
        // invites sending it twice while the server comes back.
        setTitle("");
        startTransition(() => router.refresh());
      } else {
        // The server message sends when there is one: the routes of `app/api` respond in Spanish
        // and translating only the backup would leave half of the errors in one language and the
        // other half in another. See the reason in `app/api/tasks/route.ts`.
        setError(payload.error ?? t("task.saveFailed"));
      }
    } catch {
      setError(t("task.unreachable"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-edge bg-surface p-4">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h3 className="eyebrow">{t("task.title")}</h3>
        {open.length > 0 && (
          <span className="font-mono text-[10px] text-faint">
            {t(open.length === 1 ? "task.openOne" : "task.openMany", { n: open.length })}
          </span>
        )}
      </div>

      <form onSubmit={capture} className="flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={MAX_TITLE}
          placeholder={t("task.placeholder")}
          aria-label={t("task.fieldLabel")}
          className="min-w-0 flex-1 rounded border border-edge bg-raised px-2.5 py-1.5 text-xs text-chalk placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <ActionButton
          tone="raised"
          type="submit"
          busy={saving}
          busyLabel={t("task.saving")}
          disabled={busy || !title.trim()}
        >
          {t("task.save")}
        </ActionButton>
      </form>

      <p className="mt-2 font-mono text-[11px] leading-relaxed text-faint">{t("task.mcpNote")}</p>

      {error && <ActionError text={error} className="mt-2" />}

      {open.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-edge pt-3">
          {open.map((task) => (
            <li key={task.id} className="flex flex-wrap items-baseline gap-2 text-xs">
              <TaskStatus status={task.status} locale={locale} />
              <span className="min-w-0 flex-1 leading-relaxed text-smoke">{task.title}</span>
              {/*
                 The agent signs with its name; a task written here keeps 'human', which is a
                 database value and not interface text: it appeared raw, the same in both
                 languages. Any other value is displayed as is — it is a name.
                */}
              <span className="shrink-0 font-mono text-[10px] text-faint">
                {task.agentName ?? (task.createdBy === "human" ? t("task.byHuman") : task.createdBy)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
