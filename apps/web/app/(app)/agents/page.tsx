import Link from "next/link";
import { listAgents, listAllActivity } from "@panoma/db";
import { canonicalAgentKind } from "@panoma/core";
import { db } from "@/lib/db";
import { relativeDate } from "@/components/primitives";
import { ActivityKind } from "@/components/activity";
import { ConnectAgent } from "@/components/connect-agent";
import { isEphemeral } from "@/lib/cli-name";
import { DisconnectAgent } from "@/components/disconnect-agent";
import { cliName } from "@/lib/cli-name";
import { getLocale, t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.agents") };
}

export default async function AgentsPage() {
  const { db: database } = await db();
  const [agents, activity, locale] = await Promise.all([
    listAgents(database),
    listAllActivity(database),
    getLocale(),
  ]);

  return (
    <>

      <main id="app-main" tabIndex={-1} className="app-main legacy-page">
        <section className="pt-12">
          <p className="eyebrow">{t(locale, "nav.agents")}</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
            {agents.length === 0
              ? t(locale, "agents.empty")
              : t(locale, agents.length === 1 ? "agents.countOne" : "agents.countMany", {
                  n: agents.length,
                })}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-smoke">
            {t(locale, "agents.intro")}
          </p>
        </section>

        {/*
           First: connect. Panoma already knows which agents you have, so sending the terminal to
           copy a command was asking the user to act as a cable.
           And it also passes **what is already connected**, which is something the component
           could not know on its own: it detects the installed items by asking `/api/open`, but
           who has a record lives in the database and only the server knows it. Without this, a
           connected agent would continue to show 'Connect' on each reload—right above its own
           row, which said 'disconnect'—and pressing it emits a new key.
           It is canonized because the saved `kind` may be from an earlier vocabulary
           (`codex`, `claude_code`) and the detected ones use the provider's `id`.
          */}
        {/*
           Two lists and not one, because they answer two questions the screen was merging.
           `connected` is who has a key; `active` is who has ever used it. The badge printed the
           word «connected» off the first list while the bridge counted the second and said zero —
           and the bridge was right. Passing both lets the row say which of the two it means.
          */}
        <ConnectAgent
          connected={agents.map((agent) => canonicalAgentKind(agent.kind))}
          active={agents
            .filter((agent) => agent.lastSeenAt !== null)
            .map((agent) => canonicalAgentKind(agent.kind))}
          ephemeral={isEphemeral()}
        />

        {agents.length === 0 ? (
          <section className="mt-10 rounded-lg border border-edge bg-surface p-6">
            <p className="text-sm text-smoke">{t(locale, "agents.connectFirst")}</p>
            <pre className="mt-4 overflow-x-auto rounded border border-edge bg-ground p-4 font-mono text-xs text-chalk">
              {cliName()} agent-key &quot;Claude Code&quot;
            </pre>
            <p className="mt-4 text-xs leading-relaxed text-faint">
              {t(locale, "agents.connectNote")}
            </p>
          </section>
        ) : (
          <section className="mt-10">
            <ul className="grid gap-3 sm:grid-cols-2">
              {agents.map((agent) => (
                <li key={agent.id} className="rounded-lg border border-edge bg-surface p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="font-display text-lg font-semibold tracking-tight">
                      {agent.name}
                    </h2>
                    <span className="font-mono text-[11px] text-faint">{agent.kind}</span>
                  </div>
                  <p className="mt-2 font-mono text-[11px] text-smoke">
                    {/*
                       `n` and `m` and not `entries` and `projects`: the shape gaps that keep «1
                       entries · 1 projects» from coming back only know how to look at those two
                       names. An agent that has just connected is exactly the one that reads this.
                      */}
                    {t(locale, "agents.entries", { n: agent.activities, m: agent.projects })}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-faint">
                    {t(locale, "agents.seen", { when: relativeDate(agent.lastSeenAt, locale) })}
                  </p>
                  <div className="mt-3">
                    <DisconnectAgent id={agent.id} name={agent.name} entries={agent.activities} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {activity.length > 0 && (
          <section className="mt-12">
            <h2 className="eyebrow mb-3 border-b border-edge pb-2">
              {t(locale, "agents.recentActivity")}
            </h2>
            <ul className="space-y-1">
              {activity.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-edge/50 py-2"
                >
                  <ActivityKind kind={entry.kind} locale={locale} />
                  <Link
                    href={`/p/${entry.projectSlug}`}
                    className="font-mono text-[11px] text-accent hover:underline"
                  >
                    {entry.projectName}
                  </Link>
                  <span className="flex-1 text-xs text-chalk">{entry.summary}</span>
                  <span className="font-mono text-[11px] text-faint">
                    {entry.agentName} · {relativeDate(entry.createdAt, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
