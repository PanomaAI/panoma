import Link from "next/link";
import { readTaste } from "@panoma/core";
import { listBeliefs, standsUp } from "@panoma/db";
import { countProjectTaste, tasteForProject } from "@/lib/project-taste";
import { db } from "@/lib/db";
import { t, type Locale } from "@/lib/i18n";
import { topicKey } from "@/lib/taste-view";

/*
  What your agents read when they work here.
  It's the strangest gap that remained: the portrait can be linked to a project, the linking
  travels to the file, and the file goes down through `AGENTS.md` to the agent who opens this
  folder — and from the project record none of that could be seen. Neither which phrases apply
  here, nor that three are just from here, nor that there is a screen to correct them.
  ── From the file, and not from the database ──────────────────────────────────────────────────
  For the same reason as the critic: `TASTE.md` is exactly what is downloaded by `AGENTS.md`.
  Teaching the beliefs of the catalog would teach things that may not be written yet, and the
  sentence that heads this block — 'this is what your agents read here' — would cease to be true.
  The filter is that of `tasteDigest`, in `lib/project-taste.ts`, so that the screen and the
  channel cannot disagree.
  It is a server component and reads the disk when it renders. It does not touch the database:
  `readTaste` opens a file of three thousand characters, so there is no need to pass it through
  props or chain it to the project query.
 */

export async function ProjectTaste({
  project,
  identity,
  managed,
  locale,
}: {
  project: string;
  identity: string | null;
  /** If this project has the block Panoma in its `AGENTS.md`. See the introduction. */
  managed: boolean;
  locale: Locale;
}) {
  const profile = await readTaste();
  const topics = tasteForProject(profile.lines, project);
  const { total, only } = countProjectTaste(topics);
  const forming = await formingHere(identity);

  return (
    <section className="project-deep-section" id="retrato" aria-labelledby="taste-title">
      <div className="project-deep-heading">
        <div>
          <p className="project-question">{t(locale, "twin.projectQuestion")}</p>
          <h2 id="taste-title">{t(locale, "twin.projectTitle")}</h2>
        </div>
        {total > 0 && (
          <p>
            {t(locale, "twin.projectCount", { n: total })}
            {only > 0 ? ` · ${t(locale, "twin.projectOnly", { n: only })}` : ""}
          </p>
        )}
      </div>

      {total === 0 ? (
        /*
          And the void says which of the two voids it is. There is no portrait yet, or there is
          one and here nothing applies: they are two situations with two different outcomes, and a
          single sentence for both sends half the people to the wrong screen.
         */
        <p className="project-muted-message">
          {t(locale, profile.lines.length === 0 ? "twin.projectNone" : "twin.projectNoneHere")}{" "}
          <Link href="/twin" className="project-md-hint">
            {t(locale, "twin.projectOpen")}
          </Link>
        </p>
      ) : (
        <>
          {/*
             The introduction says that the portrait goes down through AGENTS.md, and that is only
             true if this project has the block Panoma inside: the summary travels **in** that
             block, which is written by `md init` and `md sync`. Without it, the sentences still
             apply—they are yours—but no agent reads them, and promising it would be to reveal a
             channel that does not exist.
            */}
          <p className="project-md-lead">
            {t(locale, managed ? "twin.projectLead" : "twin.projectLeadUnmanaged")}
          </p>
          <div className="project-md-files">
            {topics.map((one) => (
              <div key={one.topic}>
                <p className="project-question">{topicName(one.topic, locale)}</p>
                <ul>
                  {one.lines.map((line) => (
                    <li key={line.statement}>
                      {line.statement}
                      {line.only && (
                        <span className="project-md-alt">
                          {` · ${t(locale, "twin.projectOnlyHere")}`}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {/*
             And what Twin has learned from this project but still cannot say on the person's behalf. Without
             this line, a project with five scoped beliefs shows twenty global phrases and not a
             single word of its own — which is the question that leads here
             whoever opens this view. They are not listed: they are not written anywhere, and
             teaching them here would be publishing through the back door what the file does not
             publish.
            */}
          {forming > 0 && (
            <p className="project-md-alt">
              {t(locale, "twin.projectForming", { n: forming })}
              <span className="project-md-hint">{` · ${t(locale, "twin.formingWhy")}`}</span>
            </p>
          )}
          <p className="project-md-alt">
            <Link href="/twin">{t(locale, "twin.projectOpen")}</Link>
          </p>
        </>
      )}
    </section>
  );
}

/* The same map as the portrait screen. The coined one is shown as is, in lowercase. */
function topicName(topic: string, locale: Locale): string {
  const key = topicKey(topic);
  return key ? t(locale, key) : topic;
}

/**
 * How many beliefs of this project are in formation: they are yours and do not reach the ground.
 *
 * It's the only thing this block asks of the catalog, and it goes apart from the rest for that
 * reason: the list comes from the file —what the agents really read— and this figure can't come
 * from there because precisely what defines it is that it **is not** written.
 *
 * Without identity there is nothing to tell: a project without a stable identity cannot have its
 * own beliefs, because scope depends on identity and not on the folder.
 */
async function formingHere(identity: string | null): Promise<number> {
  if (!identity) return 0;
  const { db: database } = await db();
  const alive = await listBeliefs(database, { states: ["inferred"] });
  return alive.filter((row) => row.identity === identity && !standsUp(row.support)).length;
}
