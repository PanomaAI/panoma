import pc from "picocolors";
import { plural, say, type MessageKey } from "./messages";
import { unreachable } from "./server";
import { reportUrl } from "./today";
import { catalogFetch } from "./catalog-fetch";

/**
 * `panoma next` — what needs to be done today in each project, and why that one and not another.
 *
 * It is the other half of the morning. `panoma hoy` recounts what **happened** while you were not
 * looking; this answers what is **missing**, which is the sentence that the person wrote by itself
 * in front of eighty folders. Both come from the same report and the same consultation, so that
 * the terminal and the cover do not suggest different things on the same day.
 *
 * Three decisions that support reading:
 *
 * 1. **The fact is tied to the movement.** Never "take this up again," always "take this up again,
 * because no one has ever checked if it still compiles." An ordered list without reasons is read,
 * nodded at, and nothing is done: there is nothing to verify or discuss.
 * 2. **The order is decided by the server** —`apps/web/lib/next-moves.ts`— and here it is only
 * rendered. What travels is the assignment and the fact, neutrals; the sentence is written here, in
 * the language of the terminal, just like with work risks without saving.
 * 3. **Reading does not consume the morning.** It is requested with `?fijo=1`, so looking at what
 * appears does not move the "already seen" mark and does not delete the new items you were going
 * to read later with `panoma`. The same caution and for the same reason as in `hoy.ts`.
 *
 * With two arguments it launches: `panoma next <proyecto> <encargo>` opens your agent with the
 * drafted assignment. **There** is no second way to dispatch here — it calls
 * `/api/assignments/launch`, which is the same gateway that the tile button uses: the one that
 * resolves the route in the catalog, drafts the assignment on the server, and never lets the text
 * go through the shell. And only what this very list has proposed is launched, so the rule that an
 * assignment is not offered where it does not apply is fulfilled from end to end.
 */

/** What the catalog proposes in a project, just as it travels through `/api/today`. */
export interface ProjectMoves {
  slug: string;
  name: string;
  north: string | null;
  moves: { kind: string; reason: { code: string; count?: number } }[];
}

/** How many projects are shown before summarizing the rest. One screen, not a wall. */
const VISIBLE_PROJECTS = 8;

/** The name of each assignment. Explicit map: a key with a template escapes the compiler. */
const MOVE_TITLE: Record<string, MessageKey> = {
  resume: "next.resume",
  presentable: "next.presentable",
  plan: "next.plan",
  competitors: "next.competitors",
};

/**
 * The fact, with singular and plural where the number changes the word.
 *
 * In Spanish, 'mes' does not pluralize with a loose 's', so those that have a number have their
 * two keys instead of going through `plural()`. Those that do not have a number have only one, and
 * it is the same in both cases.
 */
const MOVE_WHY: Record<string, MessageKey | [MessageKey, MessageKey]> = {
  "no-north": "next.noNorth",
  "unsaved-work": ["next.whyUnsaved", "next.whyUnsavedMany"],
  "no-readme": "next.whyNoReadme",
  "never-built": "next.whyNeverBuilt",
  idle: ["next.whyIdle", "next.whyIdleMany"],
  advisories: ["next.whyAdvisories", "next.whyAdvisoriesMany"],
  outdated: ["next.whyOutdated", "next.whyOutdatedMany"],
  "low-health": "next.whyLowHealth",
  "long-idle": "next.whyLongIdle",
  critiques: ["next.whyCritiques", "next.whyCritiquesMany"],
};

export async function nextCommand(
  api: string,
  positionals: string[],
  ): Promise<number> {
  const [query, kind] = positionals;

  /*
    A third argument is not ignored in silence. `panoma next demo plan deprisa` would be obeyed
    half-heartedly, and whoever wrote it would be convinced that that 'quickly' has done
    something. An unnecessary argument is an order that has not been understood.
   */
  if (positionals.length > 2) {
    process.stderr.write(pc.red(`${say("usage.next")}\n`));
    return 1;
  }

  const reply = await requestMoves(api);
  if (reply.state === "caido") return unreachable(api);
  if (reply.state === "error") {
    process.stderr.write(pc.red(`${reply.error}\n`));
    if (reply.hint) process.stderr.write(pc.dim(`${reply.hint}\n`));
    return 1;
  }

  const projects = reply.projects;

  /*
    It keeps the same schedule as the daily report, and for the same reason: 'what is in the
    catalog is in its place' said about a catalog where there is nothing is the most reassuring
    lie possible, and also the first one that anyone who has just installed it would read. With
    `catalog` absent —a server older than this CLI— neither one nor the other is affirmed, and it
    falls to the usual message.
   */
  if (reply.catalog === 0) {
    process.stdout.write(
      `\n  ${pc.yellow(say("today.emptyTitle"))}\n` +
        `  ${pc.dim(say("today.emptyBody"))}\n\n` +
        `  ${pc.cyan("panoma scan ~/Desktop --save")}\n\n`,
    );
    return 0;
  }

  if (!query) {
    process.stdout.write(`${nextLines(projects, api).join("\n")}\n`);
    return 0;
  }

  /*
    By exact slug and not by similarity. The slug was written by this same list two lines above,
    so there is nothing to guess; and guessing here would end up launching an agent with write
    permission in the wrong folder, which is the worst place in the product to get it right
    "almost always".
   */
  const chosen = projects.find((project) => project.slug === query);
  if (!chosen) {
    process.stderr.write(
      pc.red(`${say("next.noSuchProject", { query })}\n`) +
        pc.dim(`${say("next.noSuchProjectHint")}\n`),
    );
    return 1;
  }

  if (!kind) {
    process.stdout.write(`${nextLines([chosen], api).join("\n")}\n`);
    return 0;
  }

  return launch(api, chosen, kind);
}

/** Three outcomes, as in the report: does not answer, answers badly, or answers. */
type MovesResponse =
  | { state: "caido" }
  | { state: "error"; error: string; hint?: string }
  | { state: "ok"; projects: ProjectMoves[]; catalog?: number };

async function requestMoves(api: string): Promise<MovesResponse> {
  let reply: Response;
  try {
    /*
      Always without moving the mark: looking at what comes up is not having read the news. It is
      the same caution of `hoy.ts` and chosen towards the same side — not moving it at most makes
      you see the same thing twice; moving it too much erases without reading what you came to
      read, and here on top of that you weren't even looking at it.
      The header carries the terminal's language because `fetch` from Node doesn't send any and
      `localeFrom` defaults to English without it. Here it would only be noticed in the errors
      that the catalog writes, but a failure is precisely the moment when it is necessary to
      understand it.
     */
    reply = await catalogFetch(reportUrl(api, false));
  } catch {
    return { state: "caido" };
  }

  if (!reply.ok) {
    if (reply.status === 404) return { state: "error", error: say("next.tooOld") };
    const detail = await reply.text().catch(() => "");
    return {
      state: "error",
      error: say("next.httpError", { status: reply.status, detail }).trim(),
    };
  }

  const raw = (await reply.json().catch(() => undefined)) as
    | { nextMoves?: ProjectMoves[]; catalog?: number }
    | undefined;
  if (!raw) return { state: "error", error: say("next.badReport") };

  /*
    Without the field, the catalog is older than this CLI and it must be said: an empty list would
    say 'there is nothing to do in eighty projects,' which is a lie and also the most reassuring
    lie possible.
   */
  if (!raw.nextMoves) {
    return { state: "error", error: say("next.tooOld"), hint: say("next.tooOldHint") };
  }

  return {
    state: "ok",
    projects: raw.nextMoves.map((project) => ({ ...project, moves: project.moves ?? [] })),
    catalog: raw.catalog,
  };
}

/**
 * The whole list, line by line.
 *
 * Return the lines and not a string so that it can be tested with literals, which is how what it
 * decides in this CLI is tested: raising a catalog to check a layout would be slow here and red in
 * the CI of Windows without anything being broken.
 */
/**
 * A project whose only proposal is a question proposes nothing.
 *
 * Measured in the author's catalog the first time this was executed: 112 projects, and the vast
 * majority opened with the same sentence —“no one has written what is finished here” — because the
 * north is new and no one has it yet. One hundred twelve times the same line is not a work screen,
 * it is a scolding with scroll, and the question that the product most needs to be answered ends
 * up being the one most learned to be skipped.
 *
 * So they split in two: those who have something to do teach themselves, and those who only have
 * that question are counted at the end in a line. The question is still there —it's what is needed
 * for the rest to stop being conjecture— but it is asked once.
 */
export function withMoves(projects: ProjectMoves[]): ProjectMoves[] {
  return projects.filter((project) =>
    project.moves.some((move) => move.reason.code !== "no-north"),
  );
}

export function nextLines(all: ProjectMoves[], api: string): string[] {
  const projects = withMoves(all);
  const soloPregunta = all.length - projects.length;
  if (projects.length === 0 && soloPregunta === 0) {
    return [
      "",
      `  ${pc.green(say("next.nothing"))}`,
      `  ${pc.dim(say("next.nothingHint"))}`,
      "",
    ];
  }

  const lines: string[] = [""];
  if (projects.length === 0) {
    // All there is are unanswered questions: they are said below, in their line.
    lines.push(`  ${pc.bold(say("next.title"))}`, "");
    lines.push(
      `  ${pc.yellow(say("next.onlyNorth", { n: soloPregunta, s: plural(soloPregunta) }))}`,
    );
    lines.push(pc.dim(`  ${say("next.onlyNorthHint", { api })}`), "");
    return lines;
  }
  lines.push(
    `  ${pc.bold(say("next.title"))}  ${pc.dim(
      `· ${say("next.count", { n: projects.length, s: plural(projects.length) })}`,
    )}`,
  );
  lines.push("");

  /*
    The invitation to write the north, once and with its account.
    It was inside each project and looked reasonable with two; with eight on the screen, they were
    eight identical paragraphs, and with the author's catalog —where the north had just existed
    and no one had it— the entire screen was the same repeated sentence. A warning that appears
    eight times in a row is not read eight times: it stops being read.
   */
  const sinNorte = projects.filter((project) => !project.north).length;
  if (sinNorte > 0) {
    lines.push(`  ${pc.yellow(say("next.noNorthAll"))}`);
    lines.push(
      pc.dim(`  ${say("next.noNorthCount", { n: sinNorte })}`),
      // Where to say it, now that there is a place: `panoma north` in front and the file behind.
      // The address is written with the one brought by `--api` and not with the usual one, which is
      // what this function receives from the catalog.
      pc.dim(`  ${say("next.onlyNorthHint", { api })}`),
      "",
    );
  }

  for (const project of projects.slice(0, VISIBLE_PROJECTS)) {
    lines.push(`  ${pc.cyan(pc.bold(project.name || project.slug))}`);
    // The north only when it exists: the absence has already been mentioned above, for everyone.
    if (project.north) lines.push(`      ${pc.dim(`«${project.north}»`)}`);

    for (const move of project.moves) {
      // The movement without a north has already been mentioned above, at the place of the north.
      // Repeating it here would be insisting, and that question is asked once or not at all.
      if (move.reason.code === "no-north") continue;
      const title = MOVE_TITLE[move.kind];
      // Without a key for this task, its raw code is shown: a catalog newer than this CLI can
      // propose one that here is not known how to name, and a blank line would be worse than an
      // English word.
      const name = title ? say(title) : move.kind;
      lines.push(`      ${name.padEnd(26)}${pc.dim(reasonText(move.reason))}`);
      lines.push(pc.dim(`          panoma next ${project.slug} ${move.kind}`));
    }
    lines.push("");
  }

  const rest = projects.length - VISIBLE_PROJECTS;
  if (rest > 0) {
    lines.push(pc.dim(`  ${say("next.andMore", { n: rest, s: plural(rest) })}`));
    lines.push("");
  }

  if (soloPregunta > 0) {
    lines.push(
      `  ${pc.yellow(
        say("next.onlyNorth", { n: soloPregunta, s: plural(soloPregunta) }),
      )}`,
    );
    lines.push(pc.dim(`  ${say("next.onlyNorthHint", { api })}`), "");
  }

  return lines;
}

/** The selected action, already drafted. */
export function reasonText(reason: { code: string; count?: number }): string {
  const n = reason.count ?? 0;
  const entry = MOVE_WHY[reason.code];
  if (!entry) return reason.code;
  if (typeof entry === "string") return say(entry, { n });
  return say(n === 1 ? entry[0] : entry[1], { n });
}

/**
 * Open the agent with the assignment, through the door that already exists.
 *
 * Only what this list has proposed is launched. It is not an excess of caution:
 * `/api/assignments/launch` fulfills any task it is asked for —it does it on purpose, because
 * between marking the item and pressing the button the project can change status—, so the one who
 * decides if a task applies is the one who offers it. Here it is offered by this list, and here it
 * is checked.
 */
async function launch(
  api: string,
  project: ProjectMoves,
  kind: string,
  ): Promise<number> {
  const move = project.moves.find((candidate) => candidate.kind === kind);
  if (!move) {
    process.stderr.write(
      pc.red(`${say("next.noSuchMove", { kind, name: project.name || project.slug })}\n`) +
        pc.dim(
          `${say("next.noSuchMoveHint", {
            kinds: project.moves.map((candidate) => candidate.kind).join(" · ") || "—",
          })}\n`,
        ),
    );
    return 1;
  }

  process.stderr.write(
    pc.dim(`${say("next.launching", { name: project.name || project.slug })}\n`),
  );

  let response: Response;
  try {
    response = await catalogFetch(new URL("/api/assignments/launch", api), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: project.slug, kind }),
    });
  } catch {
    return unreachable(api);
  }

  const result = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    agent?: string;
    error?: string;
    hint?: string;
  };

  if (!response.ok || !result.ok) {
    process.stderr.write(pc.red(`${result.error ?? response.statusText}\n`));
    if (result.hint) process.stderr.write(pc.dim(`${result.hint}\n`));
    return 1;
  }

  const title = MOVE_TITLE[kind];
  const name = title ? say(title) : kind;
  // The agent's name is indicated by the path that opened it; if it didn't, the sentence reads the
  // same without it. A `pc.bold("")` would leave two spaces and a pair of color escapes.
  const agent = result.agent ? `${pc.bold(result.agent)} ` : "";
  process.stdout.write(
    `\n  ${pc.green("✓")} ${agent}${say("next.launched", {
      name: project.name || project.slug,
    })}\n` + `      ${pc.dim(`${name} · ${reasonText(move.reason)}`)}\n\n`,
  );
  return 0;
}
