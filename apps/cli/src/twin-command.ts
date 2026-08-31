import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import pc from "picocolors";
import type { ConsentState } from "@panoma/core";
import type { Flags } from "./args";
import { plural, say, type MessageKey, type Vars } from "./messages";
import { unreachable } from "./server";
import { sinceMs } from "./today";
import type {
  HistorySource,
  HistorySourceId,
  MineOptions,
  MineStats,
  QuoteRedaction,
  Reaction,
} from "@panoma/core";
import { catalogFetch } from "./catalog-fetch";

/*
  `panoma twin` — what your agents have already written about you, read once.
  Every session with Claude Code, Codex, or Cursor leaves on the disk a record of everything you
  requested and how you responded to what was delivered to you. No one ever reads it: it's
  hundreds of megabytes of JSONL in a hidden folder that only grows. And there lies the only
  honest proof of what you accept and what you reject — not what you would say in a survey about
  your way of working, but the 'no, not like that' at eleven o'clock at night.
  Hence the order of the subcommands, which is the order of trust and not of implementation.
  `sources` does not open a single file: it says what stories are on this machine, how many files
  and how many bytes, so that the offer can be read **before** accepting anything. `allow` and
  `revoke` are the response to that offer. `mine` does read, and only what has been allowed, and
  that is why it shows the entire funnel.
  The funnel is the part that cannot be trimmed. Out of forty thousand lines of yours on the disk,
  what remains as a true reaction to a submission is just a few thousand, and of those, half are
  one-liners. Showing only the final number —"6,240 reactions"— invites you to believe that Panoma
  has read your mind; showing the discards makes it clear that this is a mechanical filter over
  files you already had. A product that promises to understand you must be the first to show where
  it does not reach.
  ── Why does the permission live on this screen and not on a README ────────────────────
  The engine no longer allows reading without permission: outside of `@panoma/core` there only
  exists `mineHistory`, which consults `twin.json` before opening anything and returns
  `allowed: false` instead of throwing. That makes the path without permission unreachable, but it
  doesn't make anyone grant it: the default value is "no" for all five sources, so **the first
  execution for everyone is empty**. That is why `sources` shows the state of each story alongside
  its size and the exact command that opens it, and that is why `mine` with nothing allowed does
  not display a funnel of zeros but rather the phrase that explains what is missing. A permissions
  screen that doesn't say how to say yes is a screen that only knows how to say no.
  And on that screen, you can't exaggerate in either direction. Cursor and Aider are **measured**
  —the inventory counts them with `stat` — and are still not **read**: there is no reader for
  their format. Offering permission for them would be asking for a yes in exchange for nothing, so
  they are distinguished from those that are without permission and are called by name.
  ── What comes out of here, and only if you ask ───────────────────────────────────────
  Without `--save` this is still the same as always: it is read from the disk, printed, and that's
  it—no database, no network, no output file—and it is indicated in the output itself, in gray and
  at the end. With `--save` the reactions are sent to the catalog, which is the only way for them
  to leave the terminal, and then what is reported is what the catalog did with them: how many it
  saved, how many it already had, and how many it could not attach to any cataloged project. The
  three figures together, because “saved: 0” out of three thousand reactions is not an error if
  all three thousand were already there, but it does seem like one if considered alone.
  ── From the reactions to the portrait, and from there to the note ─────────────────────────────
  `mine --save` sent the reactions to the catalog and that was the end of the road. On this
  machine, there are 2,604 verdicts saved, and the terminal didn't know how to show a single one:
  the only way to check the phrase 'saved: 2,604' was to open the database. `verdicts` is that
  receipt — what exists, distributed by project, with its day, its signals, and your words.
  The other three are the path that turns those verdicts into a portrait, and they go in the order
  in which they are followed. `distill` is the only one that spends money, so it always starts
  with the essay: how many verdicts, how many tokens, which provider and which model, printed
  **before** spending anything and without needing to remember to request it. `review` is where a
  person says yes or no to each sentence, one by one and with the citations that support it in
  front — because what is accepted ends up written in TASTE.md, which is a file your agents will
  read, and what is rejected is never proposed again. And `taste` shows what has remained with the
  budget in sight: three thousand characters are a hard limit, and a screen that silenced it would
  leave the 'does not fit' for the day when it no longer fit.
  And the fifth one is the one that was missing to be able to say whether this works or not. The
  document of the double commits to a single metric —'how many times do you correct me?'— and to
  teaching it 'on its page,' that is, also the bad months. Without `score`, a Twin who has gone
  off to invent things confidently reads exactly the same as one who gets it right, because both
  teach a ton of sentences with citations underneath. It counts the only thing that can be counted
  today without pretending —the yeses, the nos, and what follows without looking— and keeps quiet
  about the percentage as long as there aren't enough decisions for it to mean anything.
  None of the five touch the record or the database: all five communicate with the catalog through
  HTTP, which is the unique writer. It is the same rule that requires `--save` to go through
  `/api/twin/verdicts` instead of writing in PGlite, and it is argued in the header of that path.
 */

/** How many reactions are taught when no one asks for anything else with `--limit`. */
const DEFAULT_SAMPLES = 8;

/**
 * How many verdicts are brought from the catalog when no one asks for anything else.
 *
 * Here the `undefined` of `--limit` cannot mean "all," which is exactly what it means in `mine`.
 * In the catalog of this machine, there are 2,604 verdicts, and each one occupies two lines: the
 * first execution of the subcommand would wipe out the scrollback with five thousand two hundred.
 * Twenty fit on one screen, and below goes the line that says how many are left and with which
 * flag they are fetched — which is the same as `mine` does with its samples.
 */
const DEFAULT_VERDICTS = 20;

/** What fits of a reaction on a terminal line without breaking it. */
const QUOTE_MAX = 70;

/**
 * How many citations accompany a sentence in the review.
 *
 * The ones that are needed in order to be able to judge it without the question scrolling off the
 * screen. A distilled sentence can come with twelve verdicts behind it, and twelve quotes are
 * twenty-four lines: by the time they are finished, the 'is it true?' is at the very top and what
 * is being answered is no longer visible. The ones that don't fit are counted in one line.
 */

/**
 * From which part of the budget the portrait stops being rendered in gray.
 *
 * A hard stop that you only notice when you crash into it is a stop that is discovered at the
 * worst moment: by accepting a sentence that no longer fits. Ninety percent of the time it's a
 * margin of three hundred characters, that is, two or three sentences, which is enough notice to
 * choose which one goes before you have to choose by force.
 */
const FULL_ENOUGH = 0.9;

/** How sha is taught of a catalog identity. See `projectLabel`. */
const IDENTITY_SHA = 8;

/** When the session did not say in which folder it occurred. */
const NO_PROJECT = "—";

/**
 * How many reactions are there on each POST of `--save`.
 *
 * Measured here against a double from the catalog: 500 Codex reactions are 345 KB of JSON, because
 * each one contains both the delivery **and** the reaction. The corpus of this machine is 2,010 of
 * Claude Code and 1,431 of Codex, that is, a single body of about 2.4 MB that the server would
 * have to hold entirely in memory to parse it, and that with a year and a half more of history
 * only grows. They are sent in sequential batches —not in parallel: the catalog is a
 * single-process PGlite, and three writes at the same time compete for the same database— and the
 * counters are added at the end.
 */
const SAVE_BATCH = 500;

/**
 * The office, and with it the lazy load of the engine.
 *
 * `import("@panoma/core")` goes inside each subcommand and not at the top on purpose. First,
 * because the miner opens thousands of files and has no effect at the startup of `panoma open`;
 * and second, because this way the lower-level formatters —which are the only ones with their own
 * logic— can be tested without having the package rebuilt. The types are imported at the top:
 * `import type` leaves nothing in JavaScript.
 */
export async function twinCommand(parsed: Flags): Promise<number> {
  const sub = parsed.positionals[1];

  if (sub === undefined || sub === "sources") return sources();
  if (sub === "allow") return decide(parsed, true);
  if (sub === "revoke") return decide(parsed, false);
  if (sub === "forget") return forget(parsed);
  if (sub === "mine") return mine(parsed);
  if (sub === "verdicts") return verdicts(parsed);
  if (sub === "distill") return distill(parsed);
  if (sub === "synthesize") return synthesize(parsed);
  if (sub === "taste") return taste(parsed);
  if (sub === "score") return score(parsed);
  if (sub === "design") return design(parsed);
  if (sub === "look") return look(parsed);

  process.stderr.write(
    pc.red(`${say("twin.unknownSub", { sub })}\n`) +
      pc.dim(`${say("twin.unknownSubHint")}\n${say("twin.usage")}\n`),
  );
  return 1;
}

/** `sources`: what is in this machine and what can be opened, measured without opening anything. */
async function sources(): Promise<number> {
  const { consentState, inventoryHistory, isAllowed, readConsent, readableSources } =
    await import("@panoma/core");
  const found = await inventoryHistory();
  const consent = await readConsent();
  const readable = readableSources();

  const rows: SourceRow[] = found.map((source) => ({
    source,
    state: consentState(source, isAllowed(consent, source.id), readable.includes(source.id)),
  }));

  const lines = ["", `  ${pc.bold(say("twin.sourcesTitle"))}`, ""];
  lines.push(...sourceLines(rows), "");

  const present = found.filter((source) => source.present);
  if (present.length === 0) {
    lines.push(`  ${pc.yellow(say("twin.sourcesNone"))}`);
    lines.push(`  ${pc.dim(say("twin.sourcesNoneHint"))}`, "");
  } else {
    lines.push(
      `  ${say("twin.sourcesTotal", {
        n: present.length,
        s: plural(present.length),
        files: present.reduce((total, source) => total + source.files, 0),
        fs: plural(present.reduce((total, source) => total + source.files, 0)),
        size: size(present.reduce((total, source) => total + source.bytes, 0)),
      })}`,
    );
    /*
      And below, what would really open today. The total above is that of the disc and does not
      change when granting anything; without this second line, whoever has not allowed anything
      reads '3 stories · 328 files · 5.1 GB' and understands that `mine` is going to read them.
     */
    const open = rows.filter((row) => row.state === "allowed").map((row) => row.source);
    if (open.length === 0) {
      lines.push(`  ${pc.yellow(say("twin.sourcesNoneAllowed"))}`);
    } else {
      const openFiles = open.reduce((total, source) => total + source.files, 0);
      lines.push(
        `  ${pc.green(
          say("twin.sourcesAllowed", {
            n: open.length,
            files: openFiles,
            fs: plural(openFiles),
            size: size(open.reduce((total, source) => total + source.bytes, 0)),
          }),
        )}`,
      );
    }
    lines.push(`  ${pc.dim(say("twin.sourcesNext"))}`, "");
  }

  lines.push(`  ${pc.dim(say("twin.nothingRead"))}`, "");
  process.stdout.write(lines.join("\n"));
  return 0;
}

/*
  In what situation is a story regarding the permission.
  `noReader` is not a shade of `denied`: they are opposites. The second one says 'you're missing a
  yes' and carries the gesture that gives it; the first one says 'we don't know how to read this,'
  and there the gesture would be useless. rendering them the same would turn the only screen that
  cannot lie into one that promises to read Cursor in exchange for a permission.
  The guy and the rule live in `@panoma/core` because they are asked by the terminal **and** the
  web, and it is the same question: copied in both, the day a new reader enters a surface it would
  say ‘grant permission’ and the other ‘we still don't know how to read this’ about the same
  folder. They are re-exported from here because the test of this command and its word table name
  them.
 */
export type { ConsentState } from "@panoma/core";

/** A story and its situation, ready to be rendered. */
export interface SourceRow {
  source: HistorySource;
  state: ConsentState;
}


/**
 * The text and the color of each situation, and the clue that accompanies it.
 *
 * `absent` is not there, and that's why the guy excludes it instead of giving it any row: there is
 * nothing to offer about a tool that has not been written here, and a dead entry in this table
 * would be precisely the one someone would copy the day they want to add a state.
 */
const CONSENT_WORD: Record<
  Exclude<ConsentState, "absent">,
  [word: MessageKey, hint: MessageKey, tone: (text: string) => string]
> = {
  allowed: ["twin.consentAllowed", "twin.consentAllowedHint", pc.green],
  denied: ["twin.consentDenied", "twin.consentDeniedHint", pc.yellow],
  noReader: ["twin.consentNoReader", "twin.consentNoReaderHint", pc.dim],
};

/**
 * One line per story, whether it is there or not, and another below with what can be done.
 *
 * The absent ones are taught the same way and with their route: without them, someone who only has
 * Claude Code would not know that there is a possibility that there could be more, and someone who
 * has Codex installed elsewhere would not know where it has been checked. "Not there" and "empty"
 * are also not the same, so the absent one does not say "0 files".
 *
 * The permission situation goes on a second line and not at the end of the first because that
 * first line already has sixty-something grid columns —brand, identifier, name, path, and size—:
 * with the command pasted at the end, the terminal breaks it wherever it sees fit and the first
 * thing that gets lost is exactly `panoma twin allow …`, which is the only actionable thing on the
 * screen. It's the same lesson that `sampleLines` learned with the covered notice.
 *
 * The absent one does not take a second line: there is nothing to concede about what is not there,
 * and one clue for each of the five turns the inventory into a wall.
 */
export function sourceLines(rows: SourceRow[]): string[] {
  const lines: string[] = [];
  for (const { source, state } of rows) {
    const mark = source.present ? pc.green("✓") : pc.dim("·");
    const measure = source.present
      ? say("twin.sourcePresent", {
          files: source.files,
          s: plural(source.files),
          size: size(source.bytes),
        })
      : pc.dim(say("twin.sourceAbsent"));
    lines.push(
      `  ${mark} ${source.id.padEnd(12)} ${source.label.padEnd(14)} ` +
        `${pc.dim(shortPath(source.path).padEnd(30))} ${measure}`,
    );

    if (state === "absent") continue;
    const [word, hint, tone] = CONSENT_WORD[state];
    lines.push(
      `      ${tone(say(word))} ${pc.dim(`· ${say(hint, { source: source.id })}`)}`,
    );
  }
  return lines;
}

/**
 * `allow` and `revoke`: the yes and the no, stored where the engine queries them.
 *
 * The identifier is validated against the inventory **plus** the sources with a reader, and not
 * against a list written here: a handwritten list becomes outdated the day a new reader comes in,
 * and becoming outdated here means rejecting a permission that does exist. An identifier that is
 * in neither of the two places is neither interpreted nor approximated: `panoma twin allow claude`
 * cannot end up granting `claude-code`, because over-granting is exactly the failure from which
 * there is no return. It states which ones exist and exits with 1.
 */
/** What can be forgotten all at once. `all` included, and on purpose the last one. */
const FORGETTABLE = ["claude-code", "codex", "interview", "critic", "director", "all"];

/**
 * `panoma twin forget <fuente|all>` — delete from the catalog what was saved.
 *
 * `revoke` closes the front door and leaves inside everything that has already entered; this is
 * the other half. Without both, "you can withdraw the permission" was half true, which in a
 * promise of privacy is the same as being false.
 *
 * The source goes as positional and there is no way to omit it. A plain `forget` that empties the
 * table would be a keystroke away from a command, and this is not reconstructed from the disk: the
 * history is mined again, yes, but what had been marked as accepted does not return.
 */
async function forget(parsed: Flags): Promise<number> {
  const source = parsed.positionals[2];
  if (source === undefined || !FORGETTABLE.includes(source)) {
    process.stderr.write(pc.red(`${say("twin.forgetUsage")}\n`));
    process.stderr.write(pc.dim(`  ${FORGETTABLE.join(", ")}\n`));
    return 1;
  }

  let response: Response;
  try {
    response = await catalogFetch(new URL("/api/twin/verdicts", parsed.api), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    });
  } catch {
    return unreachable(parsed.api);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body.replace(/\s+/g, " ").trim().slice(0, 200);
    const line = say("twin.saveRejected", { status: response.status, detail });
    process.stderr.write(pc.red(`${line.trimEnd()}\n`));
    return 1;
  }

  const { forgotten } = (await response.json()) as { forgotten: number };
  const lines = [
    "",
    `  ${pc.green("✓")} ${say("twin.forgotten", { n: forgotten, s: plural(forgotten) })}`,
    "",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function decide(parsed: Flags, allowed: boolean): Promise<number> {
  const { inventoryHistory, readableSources, setConsent } = await import("@panoma/core");
  const found = await inventoryHistory();
  const readable = readableSources();
  const known = knownSources(found, readable);

  // `--source codex` also applies here: whoever learned it in `mine` does not have to know that in
  // this other subcommand the identifier goes loose.
  const wanted = parsed.positionals[2] ?? parsed.source;
  const list = known.map((source) => source.id).join(" · ");
  if (wanted === undefined) {
    process.stderr.write(
      pc.red(`${say("twin.needsSource", { sub: allowed ? "allow" : "revoke" })}\n`) +
        pc.dim(`${say("twin.badSourceList", { list })}\n`),
    );
    return 1;
  }

  const source = known.find((candidate) => candidate.id === wanted);
  if (source === undefined) return badSource(wanted, list);

  await setConsent(source.id, allowed);
  const lines = decisionLines(source, allowed, readable.includes(source.id));
  process.stdout.write(lines.join("\n"));
  return 0;
}

/** The identifier does not exist: those that do exist are told, and none can be guessed. */
function badSource(wanted: string, list: string): number {
  process.stderr.write(
    pc.red(`${say("twin.badSource", { source: wanted })}\n`) +
      pc.dim(`${say("twin.badSourceList", { list })}\n`),
  );
  return 1;
}

/**
 * What is answered to a yes or a no, with the size of what is granted inside.
 *
 * A plain 'fact' is worthless. They just gave Panoma access to the entire year-and-a-half
 * conversation with a work tool, and the inventory already knows how much that is: 82 files and
 * 1.5 GB in the case of Claude Code here. Stating it in the confirmation is the last chance for
 * whoever used the wrong source to see it, and it costs a `revoke`; keeping silent turns the
 * figure that justified the permission screen into decoration.
 *
 * The two rare cases are said instead of being concealed: without a reader, the permission remains
 * saved and with nothing to open —it is the truth, and it is reversible—; and on a tool that has
 * not written on this machine, a "covers 0 files · 0 B" would be read as a failure.
 */
export function decisionLines(
  source: HistorySource,
  allowed: boolean,
  readable: boolean,
  ): string[] {
  if (!allowed) {
    return [
      "",
      `  ${pc.green("✓")} ${pc.bold(say("twin.revoked", { label: source.label }))}`,
      `  ${pc.dim(say("twin.revokedDetail"))}`,
      "",
      "",
    ];
  }

  const lines = [
    "",
    `  ${pc.green("✓")} ${pc.bold(say("twin.granted", { label: source.label }))}`,
  ];
  lines.push(
    source.present
      ? `    ${pc.dim(
          say("twin.grantedCovers", {
            files: source.files,
            s: plural(source.files),
            size: size(source.bytes),
            path: shortPath(source.path),
          }),
        )}`
      : `    ${pc.dim(say("twin.grantedAbsent"))}`,
  );

  if (!readable) {
    lines.push("", `  ${pc.yellow("!")} ${say("twin.grantedNoReader")}`);
  } else if (source.present) {
    lines.push("", `  ${pc.dim(say("twin.grantedNext", { source: source.id }))}`);
  }

  lines.push("", "");
  return lines;
}

/** A story already read, with its name in front to be able to render several in a row. */
interface MinedSource {
  id: HistorySourceId;
  label: string;
  stats: MineStats;
  reactions: Reaction[];
}

/**
 * `mine`: the funnel of each allowed story, and a few genuine reactions.
 *
 * Without `--source`, **all** the ones that have a reader and permission are browsed, not the
 * first one that appears: each tool is used for a different job, and sticking to just one would
 * give a picture of half of the days. With `--source`, it is restricted to one, and if that one
 * doesn’t have permission, it is reported the same as in the list, with its command — a filter
 * that returns zero without explaining why is read as if there is nothing there, which is exactly
 * the opposite.
 */
async function mine(parsed: Flags): Promise<number> {
  const {
    expandTilde,
    inventoryHistory,
    isAllowed,
    mineHistory,
    readConsent,
    readableSources,
    redactQuote,
  } = await import("@panoma/core");

  const found = await inventoryHistory();
  const readable = readableSources();
  const known = knownSources(found, readable);

  const wanted = parsed.source;
  const only = wanted === undefined ? undefined : known.find((source) => source.id === wanted);
  if (wanted !== undefined && only === undefined) {
    return badSource(wanted, known.map((source) => source.id).join(" · "));
  }

  const consent = await readConsent();
  const targets =
    only === undefined
      ? known.filter((source) => readable.includes(source.id) && isAllowed(consent, source.id))
      : [only];

  const options: MineOptions = {};
  const collect = collectLimit(parsed);
  if (collect !== undefined) options.limit = collect;
  const project =
    parsed.project === undefined ? undefined : projectPrefix(parsed.project, expandTilde);
  if (project !== undefined) options.cwdPrefix = project;

  const lines = ["", `  ${pc.bold(say("twin.mineTitle"))}`, ""];
  if (project !== undefined) {
    // The route that is taught is the standardized one, which is the one that is actually being
    // compared: saying 'starts with "~/Desktop/anotes"' when what was compared was the absolute one
    // would be teaching a different filter from the one applied.
    lines.push(`  ${pc.dim(say("twin.projectFilter", { prefix: project }))}`, "");
  }

  /*
    The first execution of everyone, and the only one that cannot go wrong. A funnel of zeros here
    would be technically true and completely misleading: it would seem that the files have been
    opened and that there was nothing inside, when none have been opened.
   */
  if (targets.length === 0) {
    lines.push(`  ${pc.yellow(say("twin.mineNothingAllowed"))}`);
    lines.push(`  ${pc.dim(say("twin.mineNothingAllowedHint"))}`, "", "");
    process.stdout.write(lines.join("\n"));
    return 0;
  }

  const denied = (source: HistorySource): void => {
    lines.push(`  ${pc.yellow("!")} ${say("twin.mineDenied", { label: source.label })}`);
    lines.push(`    ${pc.dim(say("twin.mineDeniedHint", { source: source.id }))}`, "");
  };

  const mined: MinedSource[] = [];
  for (const source of targets) {
    const label = source.label;
    if (!readable.includes(source.id)) {
      lines.push(`  ${pc.yellow("!")} ${say("twin.mineNoReader", { label })}`);
      lines.push(`    ${pc.dim(say("twin.mineNoReaderHint"))}`, "");
      continue;
    }
    /*
      The permission is checked **before** announcing the reading, even though `mineHistory` will
      check it on its own. Without this line, a `--source codex` without permission would write
      "Reading Codex on this disk..." and then say that it hadn’t opened it: the entire screen
      exists so that no one has to rely on our word about which files are opened, and there it
      loudly stated that it was opening one that it didn’t open. The door is still the engine’s —
      the `outcome.allowed` below —; this only prevents promising it.
     */
    if (!isAllowed(consent, source.id)) {
      denied(source);
      continue;
    }

    // By source and not just once at the beginning: it is 4.6 s for Claude Code and 4.2 s for Codex
    // on this machine, and without this the nine seconds pass without anything moving.
    process.stderr.write(pc.dim(`${say("twin.mineReading", { label })}\n`));
    const outcome = await mineHistory(source.id, options);
    if (!outcome.allowed || outcome.result === undefined) {
      denied(source);
      continue;
    }
    mined.push({ id: source.id, label: source.label, ...outcome.result });
  }

  /*
    Without anything read one does not say 'none of this has been saved': there is no 'this'. That
    phrase is the promise that accompanies a screen full of your quotes, and alone under a 'no
    permission' it is as superfluous as the `--save` track.
   */
  if (mined.length === 0) {
    lines.push("");
    process.stdout.write(lines.join("\n"));
    return 0;
  }

  const shown = parsed.limit ?? DEFAULT_SAMPLES;
  for (const one of mined) {
    lines.push(`  ${pc.bold(one.label)} ${pc.dim(`· ${one.id}`)}`, "");
    lines.push(...funnelLines(one.stats));
    if (project !== undefined) lines.push(`    ${pc.dim(say("twin.funnelWholeCorpus"))}`);
    lines.push("");

    const samples = one.reactions
      .slice(0, shown)
      .map((reaction) => toSample(reaction, redactQuote(reaction.reaction)));

    if (samples.length === 0) {
      lines.push(`  ${pc.yellow(say("twin.samplesNone"))}`, "");
      continue;
    }
    lines.push(`  ${pc.bold(say("twin.samplesTitle"))}`, "");
    lines.push(...sampleLines(samples), "");
    const rest = restCount(one.stats, samples.length, project !== undefined);
    if (rest !== undefined) {
      lines.push(`  ${pc.dim(say("twin.samplesMore", { n: rest }))}`, "");
    }
  }

  const totals = totalLines(mined);
  if (totals.length > 0) lines.push(...totals, "");

  if (!parsed.save) {
    lines.push(`  ${pc.dim(say("twin.nothingSaved"))}`);
    lines.push(`  ${pc.dim(say("twin.saveHint"))}`, "");
    process.stdout.write(lines.join("\n"));
    return 0;
  }

  lines.push("");
  process.stdout.write(lines.join("\n"));
  return save(parsed.api, mined);
}

/**
 * A story alongside what can be decided about it.
 *
 * The inventory returns the five sources today, so this usually adds nothing. It exists for the
 * reverse order: the day a reader of a tool that the inventory does not yet measure enters,
 * `readableSources()` would name it and `allow` would reject it for not being on the list.
 * Preferring to be on an empty row rather than missing a permission that does exist is the same
 * choice that `consent.ts` makes when discarding identifiers it does not know: erring on the side
 * that does not grant too much.
 */
function knownSources(found: HistorySource[], readable: HistorySourceId[]): HistorySource[] {
  const rows = [...found];
  for (const id of readable) {
    if (rows.some((source) => source.id === id)) continue;
    rows.push({ id, label: id, path: "", present: false, files: 0, bytes: 0 });
  }
  return rows;
}

/**
 * The route of `--project`, left comparable with what is in the transcripts.
 *
 * `underPrefix` (shared.ts:132) just compares text: it doesn’t touch the disk on purpose, because
 * half of the history points to folders deleted months ago. That means that a
 * `--project "~/Desktop/anotes"` —quoted in zsh, or any invocation from PowerShell that doesn’t
 * expand `~` in native program arguments— arrived with the tilde in place and didn’t prefix any
 * absolute `cwd`. Measured: the absolute form returned a reaction and the tilde form, zero. Same
 * with `--project apps/web`. And the failure was silent: “No reaction with that form” with the
 * whole funnel on top, which is exactly the opposite of what `--limit` does, which refuses to
 * guess. `resolve(expandTilde(…))` is what the other routes of CLI already do (index.ts:146, 163,
 * 242).
 *
 * The expander is passed as a parameter for the same reason as the wording in `toSample`: in this
 * way this is tested without having `@panoma/core` reconstructed.
 */
/**
 * How many reactions are **collected**, which are not always the ones that are taught.
 *
 * The screen says —and it is true— that `--limit` decides how many are shown. While they were only
 * being printed, limiting the pickup and limiting the sample were the same and it was free. As
 * soon as there is somewhere to send them, they stop being so: `twin mine --limit 5 --save` picked
 * up five and kept five out of two thousand, and answered "kept: 5" without lying in a single word
 * and deceiving in the whole sentence. Whoever asks for a small sample is asking to read less, not
 * to archive less.
 */
export function collectLimit(parsed: { limit?: number; save: boolean }): number | undefined {
  if (parsed.save) return undefined;
  return parsed.limit;
}

export function projectPrefix(project: string, expand: (path: string) => string): string {
  return resolve(expand(project));
}

/**
 * How many reactions are left out of the sample, or none if it cannot be known.
 *
 * `stats.reactions` is counted before the route filter (claude-code.ts:347 compared to
 * `underPrefix` of the 355), so with `--project` the two numbers are from different populations:
 * measured with four reactions, one of which fell under the prefix, the remainder announced “and 3
 * more that don’t fit here” when under that project there were none left. No one knows the total
 * filtered without a new counter in the engine, so with a filter a remainder is not promised
 * instead of promising a false one.
 */
export function restCount(
  stats: MineStats,
  shown: number,
  filtered: boolean,
): number | undefined {
  if (filtered) return undefined;
  const rest = stats.reactions - shown;
  return rest > 0 ? rest : undefined;
}

/**
 * A step of the funnel: how it is marked, how much it is worth, what it is called, and what color
 * it goes.
 */
type FunnelRow = [prefix: string, n: number, key: MessageKey, tone: (text: string) => string];

/**
 * The funnel, with the discards in view and only one subtraction: the one that fits.
 *
 * The three discards are what make the result believable: a tool result is not your opinion, a
 * sub-agent's turn was not written by you, and a bar order is an instruction and not a reaction.
 * Added together, they make up about ninety percent of what is on the disk, and that is why they
 * are taught instead of disappearing silently. What they no longer do is subtract themselves. They
 * went with '−' below `userTurns`, and the miner increments `stats.userTurns` (claude-code.ts:334)
 * AFTER having done `continue` in the three
 * (lines 313, 318, and 330), that is to say, that figure comes net already: the rendered remainder
 * was
 * arithmetically false right in the row with which the command sells its honesty. Measured over a
 * transcript with 5 truth turns, 1 tool result, and 1 bar order, the miner returns {userTurns:5,
 * toolResults:1, sidechain:0, commands:1, reactions:5} and the screen showed «5 − 1 − 0 − 1 = 5».
 * With a truth corpus it doesn't even come out positive, because the tool results are four times
 * the turns. They go with «· », the same dot with which `sources` marks what is not there.
 *
 * The real remainder is that of the spontaneous ones, and it was hidden in the bleeding block as
 * if it were a breakdown of the reactions. It is its exact complement: the miner does
 * `spontaneous += 1; continue` (line 338) before `reactions += 1` (347), so that
 * `userTurns − spontaneous = reactions` —an invariant that the engine itself checks in
 * claude-code.test.ts:463—. Bleeding under the “=” told the reader that those turns were inside
 * the total, and they are outside; in the degenerate case of the corpus that only has opening
 * messages, there remained a “= 0 reactions” with “30 without anyone asking you anything” nested
 * inside. Only `briefs` and `withSignal` remain inside, which indeed are.
 */
export function funnelLines(stats: MineStats): string[] {
  const plain = (text: string): string => text;
  const lines = [
    `  ${pc.bold(say("twin.funnelTitle"))}`,
    `    ${pc.dim(
      say("twin.funnelRead", {
        files: stats.files,
        s: plural(stats.files),
        size: size(stats.bytes),
      }),
    )}`,
  ];

  const steps: FunnelRow[] = [
    ["  ", stats.sessions, "twin.funnelSessions", pc.dim],
    ["· ", stats.toolResults, "twin.funnelToolResults", pc.dim],
    ["· ", stats.sidechain, "twin.funnelSidechain", pc.dim],
    ["· ", stats.commands, "twin.funnelCommands", pc.dim],
    ["  ", stats.userTurns, "twin.funnelUserTurns", plain],
    ["− ", stats.spontaneous, "twin.funnelSpontaneous", pc.dim],
    ["= ", stats.reactions, "twin.funnelReactions", pc.bold],
  ];
  for (const [prefix, n, key, tone] of steps) {
    lines.push(`    ${tone(prefix)}${tone(String(n).padStart(7))}  ${tone(say(key))}`);
  }

  const inside: FunnelRow[] = [
    ["  ", stats.briefs, "twin.funnelBriefs", pc.dim],
    ["  ", stats.withSignal, "twin.funnelWithSignal", pc.green],
  ];
  for (const [prefix, n, key, tone] of inside) {
    lines.push(`      ${tone(prefix)}${tone(String(n).padStart(7))}  ${tone(say(key))}`);
  }

  return lines;
}

/**
 * The line that adds up the stories, and only when there is more than one to add.
 *
 * With a single source, it would be the same figure from the funnel repeated two lines below, and
 * a total that repeats a subtotal teaches you to skip the totals. With two, it does say something
 * that is not on any other line: how much disk has actually been opened and how many reactions
 * have come out of the two together, which is the population that `taste` will work on.
 *
 * `userTurns` nor the discards are added. Each funnel fits within its own story —`userTurns −
 * spontaneous = reactions`— and an added funnel would invite making that subtraction over corpora
 * of different formats, where 'bar order' doesn’t even mean the same thing in both.
 */
export function totalLines(mined: Array<{ stats: MineStats }>): string[] {
  if (mined.length < 2) return [];
  const total = (pick: (stats: MineStats) => number): number =>
    mined.reduce((sum, one) => sum + pick(one.stats), 0);

  const minedFiles = total((stats) => stats.files);
  return [
    `  ${pc.bold(
      say("twin.mineTotal", {
        n: mined.length,
        y: plural(mined.length, "ies", "y"),
        files: minedFiles,
        fs: plural(minedFiles),
        size: size(total((stats) => stats.bytes)),
        reactions: total((stats) => stats.reactions),
        signals: total((stats) => stats.withSignal),
      }),
    )}`,
  ];
}

/** A reaction already ready to be printed: without raw material, without secrets, and without jumps. */
export interface TwinSample {
  /** The day, without hour: places the reaction without turning the line into a record. */
  day: string;
  /** The name of the folder, not the path: the project is what locates it, not the drive. */
  project: string;
  signals: string[];
  text: string;
  redacted: boolean;
  brief: boolean;
}

/**
 * From what the miner returns to what can be taught.
 *
 * The text is passed as a parameter and is not called here for two reasons: this function remains
 * pure and testable without the engine, and above all, passing through `redactQuote` becomes
 * impossible to forget — the text that is printed is the one that arrives, and the one that
 * arrives has already passed through the blocker. Your reaction can carry an attached API key, and
 * this takes it from a file that only you could read to put it on the terminal.
 */
export function toSample(reaction: Reaction, redaction: QuoteRedaction): TwinSample {
  return {
    day: day(reaction.at),
    project: reaction.cwd ? basename(reaction.cwd) || NO_PROJECT : NO_PROJECT,
    signals: reaction.signals,
    text: oneLine(redaction.text),
    redacted: redaction.redacted,
    brief: reaction.brief,
  };
}

/**
 * A single-line quote without overflowing the terminal.
 *
 * Line breaks are crushed before trimming, not after: a three-paragraph reaction whose first
 * seventy characters were 'no.
 *
 * ' would have passed the cut and broken the grid just the same. It's loose here because three
 * screens do it — the `mine` samples, the saved verdicts, and the review quotes — and a trimming
 * rule repeated three times is a rule that ends up diverging.
 */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= QUOTE_MAX ? flat : `${flat.slice(0, QUOTE_MAX - 1)}…`;
}

/**
 * Two lines per reaction: where and when it was, and what you said.
 *
 * The labels all go on top — signs, brevity, cover notice — and the one at the bottom is left only
 * with your words. With the notice behind the quote, a long reaction gave a line of one hundred
 * and twenty columns that the terminal split wherever it felt like, and the first thing that was
 * lost was precisely the “!”.
 *
 * The filling of the name is counted over the plain text and not over the already colored text:
 * ANSI escapes take up characters that do not occupy columns, so a `padEnd` over the colored
 * string misaligns the grid as soon as there are colors.
 */
export function sampleLines(samples: TwinSample[]): string[] {
  const lines: string[] = [];
  for (const sample of samples) {
    const mark = sample.signals.length > 0 ? pc.green("✓") : pc.dim("·");
    const tags = sample.signals.map((signal) => pc.cyan(signal)).join(pc.dim(" · "));
    const brief = sample.brief ? pc.dim(` · ${say("twin.sampleBrief")}`) : "";
    const redacted = sample.redacted
      ? ` ${pc.yellow("!")} ${pc.dim(say("twin.sampleRedacted"))}`
      : "";
    const pad = " ".repeat(Math.max(1, 21 - sample.project.length));
    const head = `  ${mark} ${pc.dim(sample.day)}  ${pc.bold(sample.project)}${pad}`;
    lines.push(`${head}${tags}${brief}${redacted}`.trimEnd());
    lines.push(`      ${pc.dim(say("twin.sampleQuote", { text: sample.text }))}`);
  }
  return lines;
}

/**
 * What the catalog answers to a batch. `/api/twin/verdicts` writes it.
 *
 * `undated` is here because the route returns it **so that the accounts balance**: the reactions
 * whose transcript line did not have a time cannot be saved, and without this fifth number
 * `saved + duplicates + unmatched` would give less than what was sent with nothing to explain it.
 * Collecting it and not showing it would be the same silence that the `twin mine` funnel spends
 * the entire screen showing how not to have.
 */
export interface SaveReply {
  saved: number;
  duplicates: number;
  /** Appointments that were already there and that this sweep has moved to the correct project. */
  remapped?: number;
  /** Portrait phrases that have changed projects because their quotes did. */
  restated?: number;
  unmatched: number;
  undated: number;
  projects: number;
}

/** The same, added — except for the projects, which cannot be added. See `saveTotals`. */
export interface SaveTotals {
  saved: number;
  duplicates: number;
  remapped: number;
  restated: number;
  unmatched: number;
  undated: number;
  projects?: number;
}

/**
 * The reactions, sent in batches of the size that a POST can handle.
 *
 * An empty list gives **zero** batches and not an empty one: sending `{ reactions: [] }` would be
 * a request that can only return zeros, and those zeros would be displayed as «saved: 0» on a
 * screen that had nothing to save.
 *
 * The `per < 1` is not defensive for no reason: the size comes from a constant today, but a zero
 * there turns the loop into infinity with the entire list in memory, and that is not discovered in
 * a review.
 */
export function reactionBatches(reactions: Reaction[], per: number = SAVE_BATCH): Reaction[][] {
  if (per < 1) return reactions.length > 0 ? [reactions] : [];
  const groups: Reaction[][] = [];
  for (let i = 0; i < reactions.length; i += per) groups.push(reactions.slice(i, i + per));
  return groups;
}

/**
 * The counters of all the rounds, and the only one that is not added.
 *
 * `saved`, `duplicates`, `unmatched`, and `undated` count reactions, and each reaction goes in one
 * batch and in only one: adding them up is exact. `projects` counts **different projects**
 * touched, and a large project distributes its reactions across several batches — they go in the
 * order returned by the miner, that is, grouped by session and therefore by folder — so adding it
 * up counts the same project as many times as the batches it occupies. With 3,400 reactions from
 * two projects, there were seven.
 *
 * Knowing the true number requires that the server states it over the total, and today it does
 * not. So it is shown when there was a single batch and kept silent when there were several: it is
 * the same thing that `restCount` does with `--project`, and for the same reason — hiding a figure
 * costs a line, and publishing a false one costs the credibility of the other three.
 */
export function saveTotals(replies: SaveReply[]): SaveTotals {
  /*
    Anything that is not a number counts as zero and not as `NaN`. These figures come from a
    `await response.json()` with a `as`, that is, from the server's word: a catalog from another
    version that returned four fields instead of five would display «saved: NaN», which is the
    worst of the three possible responses — worse than a zero and much worse than silence. A
    `?? 0` would not be enough, because `null` and `"12"` also come through there.
   */
  const total = (pick: (reply: SaveReply) => number): number =>
    replies.reduce((sum, reply) => {
      const n = pick(reply);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);

  const totals: SaveTotals = {
    saved: total((reply) => reply.saved),
    duplicates: total((reply) => reply.duplicates),
    // Absent in a previous catalog before the re-attribution: there it is not zero, it is that it
    // does not say it, and the `total` above already converts anything that is not a number into
    // zero without marking `NaN`.
    remapped: total((reply) => reply.remapped ?? 0),
    restated: total((reply) => reply.restated ?? 0),
    unmatched: total((reply) => reply.unmatched),
    undated: total((reply) => reply.undated),
  };
  const single = replies[0];
  if (replies.length === 1 && single !== undefined) totals.projects = single.projects;
  return totals;
}

/**
 * `--save`: the only thing that elicits reactions from this terminal.
 *
 * It is sent just as it came from the miner —already drafted: `redactQuote` runs inside the
 * engine, before trimming, so there is no way for the raw material to reach here—. And it is sent
 * in sequential batches according to what `SAVE_BATCH` says.
 *
 * The path of error is the same as always and not a new one: `unreachable` when no one answers,
 * which is the same message and the same clue —"Lift it with: Panoma up"— given by `enrich`,
 * `run`, and the others. Inventing another wording here for the same problem forces learning the
 * same solution twice. As soon as one batch fails it stops: continuing to send the next ones
 * against a catalog that has already said no not only lengthens the wait but also disorganizes the
 * count.
 */
async function save(api: string, mined: MinedSource[]): Promise<number> {
  const groups = reactionBatches(mined.flatMap((one) => one.reactions));
  if (groups.length === 0) {
    process.stdout.write(`  ${pc.yellow(say("twin.saveNothing"))}\n\n`);
    return 0;
  }

  process.stderr.write(pc.dim(`${say("twin.saveSending", { size: SAVE_BATCH })}\n`));

  const replies: SaveReply[] = [];
  for (const group of groups) {
    let response: Response;
    try {
      response = await catalogFetch(new URL("/api/twin/verdicts", api), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reactions: group }),
      });
    } catch {
      return unreachable(api);
    }
    if (!response.ok) {
      /*
        The body of the error, crushed and trimmed. The route responds `{ error }` in the 400s
        that it itself writes, but a 500 is rendered by the framework: in development that is an
        entire HTML page, and dumping it raw to the terminal buries the only line that matters
        —the status code itself— under kilobytes of markup. Measured against the catalog of this
        machine, a 500 returned an empty body and the sentence was left with a dangling space at
        the end; hence also the `trimEnd`.
       */
      const body = await response.text().catch(() => "");
      const detail = body.replace(/\s+/g, " ").trim().slice(0, 200);
      const line = say("twin.saveRejected", { status: response.status, detail });
      process.stderr.write(pc.red(`${line.trimEnd()}\n`));
      return 1;
    }
    replies.push((await response.json()) as SaveReply);
  }

  const totals = saveTotals(replies);
  const lines = [
    `  ${pc.green("✓")} ${say("twin.saved", {
      saved: pc.bold(String(totals.saved)),
      duplicates: totals.duplicates,
      unmatched: totals.unmatched,
    })}`,
  ];
  /*
    The re-attributed ones, only when there are any. It is a rare and good piece of news —'this
    was already here and it was misfiled'— and it deserves to be said: otherwise, a sweep that
    moves four hundred project citations reads as one that did nothing, because 'saved: 0' is the
    only thing you see.
   */
  if (totals.remapped > 0) {
    lines.push(
      `    ${pc.dim(say("twin.saveRemapped", { n: totals.remapped, s: plural(totals.remapped) }))}`,
    );
  }
  /*
    And the sentences that have followed their quotes. They are called apart from the moved quotes
    because they are the visible consequence: what changes on the review screen are not the
    quotes, it is the label with which it is decided whether a sentence is valid outside of where
    it was learned.
   */
  if (totals.restated > 0) {
    lines.push(
      `    ${pc.dim(say("twin.saveRestated", { n: totals.restated }))}`,
    );
  }
  if (totals.projects !== undefined) {
    lines.push(
      `    ${pc.dim(
        say("twin.savedProjects", {
          n: totals.projects,
          s: plural(totals.projects),
        }),
      )}`,
    );
  }
  /*
    And those that fall for not having an appointment, which without this line would disappear
    from the account: `saved + duplicates + unmatched` would give less than what was sent and
    nothing would explain it. Just like the one for 'without project,' it is only said when there
    is one — on a zero it would be a warning about something that has not happened.
   */
  if (totals.undated > 0) {
    lines.push(`    ${pc.dim(say("twin.savedUndated", { n: totals.undated }))}`);
  }
  if (totals.unmatched > 0) lines.push(`    ${pc.dim(say("twin.savedUnmatched"))}`);

  process.stdout.write(`${lines.join("\n")}\n\n`);
  return 0;
}

/*
  ── The five screens that talk with the catalog ───────────────────────────────
  From this point on, not a single file from the disk is opened: it asks for HTTP and displays
  whatever it responds. The two helpers below exist so that the five fail in the same way, which
  is half of what makes a CLI believable: `tryFetch` converts 'no one is listening' into the same
  'lift it with: Panoma up' that `enrich` and `run` already gave, and `refusalOf` converts an
  error body — which can be either the `{ error }` of the path or a Next page HTML in development
  — into a line that fits on the terminal.
 */

/**
 * A call to the catalog that does not ring when there is no one on the other side.
 *
 * `fetch` against a closed port does not return a 502: it throws. And a `TypeError: fetch failed`
 * with its trace behind is exactly what this CLI never shows, because the message it touches is
 * that of `unreachable` and it brings the command that fixes it. `undefined` is returned instead
 * of being printed here so that the decision —which message, with what exit code— remains with the
 * caller.
 */
async function tryFetch(url: URL, init?: RequestInit): Promise<Response | undefined> {
  try {
    return await catalogFetch(url, init);
  } catch {
    return undefined;
  }
}

/** The body of a POST to the catalog, with the header that its routes expect. */
function post(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** The 'no' of the catalog, already read: why, with what clue, and with what numbers. */
interface Refusal {
  status: number;
  /** The phrase that the route sent; if it sent none, its crushed body. */
  detail: string;
  hint?: string;
  /** Only when the portrait is full: what it occupies and what fits. */
  chars?: number;
  cap?: number;
}

/**
 * What the catalog said when rejecting, in the two ways it can say it.
 *
 * The routes respond `{ error }` —and sometimes `hint`, like `/api/describe` does— in the 400 and
 * 502 that they write, but a 500 is rendered by the framework: in development that is a whole HTML
 * page, and dumping it raw buries the only line that matters under kilobytes of markup. Hence the
 * flattening and trimming, which are the same as `save` already did.
 *
 * `JSON.parse` is tested and discarded without noise, and it is checked that what comes out is an
 * object: an empty body throws and `"null"` does not, so without that second check the path of the
 * error would have its own error inside.
 */
async function refusalOf(response: Response): Promise<Refusal> {
  const text = await response.text().catch(() => "");
  let body: { error?: string; hint?: string; chars?: number; cap?: number } = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object") body = parsed;
  } catch {
    // It wasn't JSON. The raw text works just the same, and crushed it fits on one line.
  }

  const refusal: Refusal = {
    status: response.status,
    detail: (body.error ?? text).replace(/\s+/g, " ").trim().slice(0, 200),
    hint: body.hint,
  };
  if (Number.isFinite(body.chars) && Number.isFinite(body.cap)) {
    refusal.chars = body.chars;
    refusal.cap = body.cap;
  }
  return refusal;
}

/** The rejection, said as `save` says it: status, reason, and the clue if there was one. */
function rejected(refusal: Refusal, key: MessageKey): number {
  const line = say(key, { status: refusal.status, detail: refusal.detail });
  process.stderr.write(pc.red(`${line.trimEnd()}\n`));
  if (refusal.hint) process.stderr.write(pc.dim(`${refusal.hint}\n`));
  return 1;
}

/**
 * `verdicts`: the receipt of what was saved, which until now could not be requested.
 *
 * `mine --save` replied "saved: 2,604" and that was all the terminal knew to say about them. The
 * figure could be checked by opening the database, that is, it could not be checked: a product
 * that promises to save nothing behind your back has to be able to show what it did save, one by
 * one and with your words inside.
 *
 * They are already brought limited by the server —`limit` goes in the query— instead of bringing
 * them all and cutting them here: it's 2,604 rows with the full entry inside, and requesting them
 * to discard 2,584 is wasting the catalog's time on something no one is going to read.
 */
async function verdicts(parsed: Flags): Promise<number> {
  const url = new URL("/api/twin/verdicts", parsed.api);
  url.searchParams.set("limit", String(parsed.limit ?? DEFAULT_VERDICTS));
  if (parsed.source !== undefined) url.searchParams.set("source", parsed.source);

  const response = await tryFetch(url);
  if (response === undefined) return unreachable(parsed.api);
  if (!response.ok) return rejected(await refusalOf(response), "twin.verdictsRejected");

  const reply = (await response.json()) as VerdictsReply;
  const rows = Array.isArray(reply.verdicts) ? reply.verdicts : [];
  const total = Number.isFinite(reply.total) ? reply.total : rows.length;
  // The names are an extra of the route: a previous catalog does not send them and the screen
  // continues to work with the identity, which is what existed before they existed.
  const names =
    reply.names !== null && typeof reply.names === "object" ? reply.names : {};

  const lines = ["", `  ${pc.bold(say("twin.verdictsTitle"))}`, ""];
  if (parsed.source !== undefined) {
    lines.push(`  ${pc.dim(say("twin.verdictsSource", { source: parsed.source }))}`, "");
  }

  /*
    The emptiness is said differently depending on whether there is a filter or not. 'The catalog
    has no saved verdicts' under a 'only those from codex' would be false in half of the cases
    —and in the worse half, that of someone who has just saved two thousand from Claude Code and
    wrote the source incorrectly—, so the filter gets its own phrase.
   */
  if (rows.length === 0) {
    const empty = parsed.source === undefined ? "twin.verdictsNone" : "twin.verdictsNoneSource";
    lines.push(`  ${pc.yellow(say(empty, { source: parsed.source ?? "" }))}`);
    lines.push(`  ${pc.dim(say("twin.verdictsNoneHint"))}`, "", "");
    process.stdout.write(lines.join("\n"));
    return 0;
  }

  lines.push(
    `  ${say("twin.verdictsShown", { shown: rows.length, total })}`,
  );
  lines.push(`  ${pc.dim(say("twin.verdictsFiledBy"))}`, "");
  lines.push(...verdictLines(groupVerdicts(rows, names)));

  const rest = total - rows.length;
  if (rest > 0) lines.push(`  ${pc.dim(say("twin.verdictsMore", { n: rest }))}`, "");

  lines.push("");
  process.stdout.write(lines.join("\n"));
  return 0;
}

/** What `GET /api/twin/verdicts` answers. */
export interface VerdictsReply {
  /** Identity → project name, if the catalog knows it today. */
  names?: Record<string, string> | null;
  verdicts: StoredVerdict[];
  total: number;
}

/**
 * A verdict as it travels through HTTP, which is not how it is in the database.
 *
 * `Verdict` declares `at: Date` because that's what drizzle returns, and `Response.json` converts
 * it into an ISO string along the way: asserting the database type here would place a fake `Date` over
 * which `getFullYear()` does not exist. The honest way is also the one that fits, because `day()`
 * already receives strings — that's what the miner provides.
 *
 * `signals` arrives optionally for the same reason that `SaveReply` is defended from a missing
 * field: this is the word of a server that may be from another version, and the column is `jsonb`.
 */
export interface StoredVerdict {
  identity: string | null;
  source: string;
  at: string;
  quote: string;
  signals?: string[] | null;
}

/** An already normalized verdict, attached to its project. */
export interface GroupedVerdict {
  source: string;
  at: string;
  quote: string;
  signals: string[];
}

/** A project and what was said within it. */
export interface VerdictGroup {
  /** The identity, abbreviated so that it fits on the line. See `projectLabel`. */
  label: string;
  verdicts: GroupedVerdict[];
}

/**
 * The verdicts, distributed by project and without rearranging anything.
 *
 * The catalog returns them from the most recent to the oldest —`listVerdicts` sorts by `createdAt`
 * and breaks ties by `id` — and that order is maintained within each group and also between
 * groups: the first one that appears is the one containing the newest verdict. They are not sorted
 * by size on purpose. The project you worked on last night is the one being searched for on this
 * screen, not the one that has accumulated the most of your sentences over the past year.
 *
 * And here `signals` is normalized, which in the database is `jsonb` and for drizzle is `unknown`.
 * The route confirms it as `string[]` before sending it, but this arrives over the network: a
 * `null` in there would break the `.map` of the painter with a fault that mentions neither
 * verdicts nor signals. It is the same defense that `saveTotals` does with the meters, and for the
 * same reason.
 */
export function groupVerdicts(
  rows: StoredVerdict[],
  names: Record<string, string> = {},
): VerdictGroup[] {
  const groups = new Map<string, VerdictGroup>();
  for (const row of rows) {
    // The name if the catalog has it today; the identity if not. See `projectLabel`.
    const named = row.identity === null ? undefined : names[row.identity];
    const label = named ?? projectLabel(row.identity);
    let group = groups.get(label);
    if (group === undefined) {
      group = { label, verdicts: [] };
      groups.set(label, group);
    }
    group.verdicts.push({
      source: row.source,
      at: row.at,
      quote: row.quote,
      signals: Array.isArray(row.signals) ? row.signals : [],
    });
  }
  return [...groups.values()];
}

/**
 * The name with which a project is grouped, which is its identity and not its name.
 *
 * A verdict keeps `identity` and nothing else, and it is not an oversight: the table does not have
 * a single foreign key to `projects` — `schema.ts` argues — precisely so that rescanning or
 * deleting a project does not wipe out what you said inside it. The name lives in the record, and
 * the path sends it separately (`names`) for whoever has it today; this is what remains when it
 * does not exist, which is the real case of a mined project that was deleted afterward. Measured
 * in the author's catalog: `ruta:681195ec` as a group title tells no one anything, and the screen
 * exists so that you recognize what is yours.
 *
 * What can be done is to make it readable without making it ambiguous. `git:<sha>:apps/web`
 * becomes `git:5f2a1c9d:apps/web`: the internal path is half of it that can be recognized at a
 * glance, and the short sha is what prevents the `apps/web` from two different repositories from
 * being read as the same project. Cutting it completely would save eight columns and erase exactly
 * the difference. What does not have that form is returned intact — the `project` of a quote may
 * already come as a name, and cutting nothing is better than cutting blindly.
 */
export function projectLabel(identity: string | null | undefined): string {
  if (!identity) return NO_PROJECT;
  const [kind, value, ...inner] = identity.split(":");
  if (kind === undefined || value === undefined) return identity;
  const short = value.length > IDENTITY_SHA ? value.slice(0, IDENTITY_SHA) : value;
  return [kind, short, ...inner].join(":");
}

/**
 * Two lines per verdict, in the same form as the samples of `mine`.
 *
 * The same on purpose: whoever comes from `twin mine` has just learned to read «mark, day,
 * signals» above and the quote below, and these are the same saved phrases. What changes is what
 * occupies the project column, which here is the header of the group and is not repeated in each
 * line; in its place goes the source, which is what distinguishes within the same project what you
 * said to Claude Code from what you said to Codex — and what `--source` filters.
 *
 * Quotes are not covered again: they arrive drafted by `redactQuote` from the parser, which is the
 * only place where drafting occurs **before** the trim, and a second pass would not cover anything
 * new and would indeed ruin real quotes. This is argued by `lib/verdicts.ts`.
 */
export function verdictLines(groups: VerdictGroup[]): string[] {
  const lines: string[] = [];
  for (const group of groups) {
    const n = group.verdicts.length;
    const count = say("twin.verdictsIn", { n, s: plural(n) });
    lines.push(`  ${pc.bold(group.label)} ${pc.dim(`· ${count}`)}`, "");

    for (const verdict of group.verdicts) {
      const mark = verdict.signals.length > 0 ? pc.green("✓") : pc.dim("·");
      const tags = verdict.signals.map((signal) => pc.cyan(signal)).join(pc.dim(" · "));
      const when = pc.dim(day(verdict.at));
      const head = `    ${mark} ${when}  ${pc.dim(verdict.source.padEnd(12))}`;
      lines.push(`${head}${tags}`.trimEnd());
      const quote = say("twin.sampleQuote", { text: oneLine(verdict.quote) });
      lines.push(`        ${pc.dim(quote)}`);
    }
    lines.push("");
  }
  return lines;
}

/** What the `POST /api/twin/distill` essay answers. */
/** How much history has the catalog been distilled and how much is there. See `corpusProgress`. */
export interface CorpusProgress {
  total: number;
  read: number;
}

export interface DistillEstimate {
  verdicts: number;
  estimatedTokens: number;
  provider: string;
  model: string;
  corpus?: CorpusProgress;
}

/** And what the past really answers. */
export interface DistillOutcome {
  verdicts: number;
  /**
   * How many observations did the model write. It was called `proposed` when they were proposals
   * that needed to be approved; the route stopped sending that name when the queue was closed, and
   * this guy got left behind, so the receipt printed 'undefined' over a distillation that had gone
   * well. Optional so as not to crash against a previous catalog.
   */
  observed?: number;
  saved: number;
  model: string;
  usage?: { input: number; output: number };
  corpus?: CorpusProgress;
}

/**
 * `distill`: the only subcommand that spends money, and therefore the only one that budgets.
 *
 * The trial is not an option you have to remember to request: it is done **always**, it is the
 * first thing that is printed, and `--dry-run` does not turn it on but prevents proceeding. The
 * difference matters. With the trial behind a flag, the path of spending and not spending are a
 * keystroke away from each other, and there is nothing in between that shows the figure; thus, the
 * number of verdicts, the number of tokens, the provider, and the model are read before the first
 * request to the model goes out, with or without a flag.
 *
 * It costs two requests to the catalog in the complete past, and both are cheap: the essay one
 * counts rows and does not talk to any model. In exchange, the budget is displayed on the screen
 * while waiting—which is exactly when you would want to know what you are spending—and not
 * afterwards, when it is no longer useful for deciding. Hence also that there are two writings on
 * output and not one: they are two screens separated by a wait.
 */
async function distill(parsed: Flags): Promise<number> {
  const url = new URL("/api/twin/distill", parsed.api);
  const body: { limit?: number; dryRun: boolean } = { dryRun: true };
  if (parsed.limit !== undefined) body.limit = parsed.limit;

  const first = await tryFetch(url, post(body));
  if (first === undefined) return unreachable(parsed.api);
  if (!first.ok) return distillRefused(await refusalOf(first));

  const estimate = (await first.json()) as DistillEstimate;
  const lines = ["", `  ${pc.bold(say("twin.distillTitle"))}`, ""];

  /*
    Without verdicts, no budget of zero is requested nor is any model called: it is stated where
    they come from. It is the same case as the `mine` without permissions —the first execution of
    everyone— and it deserves the same response, which is the one that the missing command brings.
   */
  if (!(estimate.verdicts > 0)) {
    lines.push(`  ${pc.yellow(say("twin.distillNothing"))}`);
    lines.push(`  ${pc.dim(say("twin.distillNothingHint"))}`, "", "");
    process.stdout.write(lines.join("\n"));
    return 0;
  }

  lines.push(...dryRunLines(estimate), "");
  if (parsed.dryRun) {
    lines.push(`  ${pc.dim(say("twin.distillDryRun"))}`);
    lines.push(`  ${pc.dim(say("twin.distillDryRunHint"))}`, "", "");
    process.stdout.write(lines.join("\n"));
    return 0;
  }

  // The budget, printed before spending it and not after. The blank line at the end is the one that
  // separates what has already been written from the waiting notice, which appears due to the
  // error.
  lines.push("");
  process.stdout.write(lines.join("\n"));
  process.stderr.write(pc.dim(`${say("twin.distillRunning")}\n`));

  let last: DistillOutcome | undefined;
  const totals = { verdicts: 0, observed: 0, saved: 0, passes: 0 };

  /*
    One pass, or all. `--all` chains until there is no history left to read, and it exists because
    the number that capped a pass was the patience of a person in front of a list of proposals —
    and that list no longer exists. With 2,278 entries, one pass reads 10% of the corpus; no one
    presses the button ten times, so in practice the portrait was left short of a fifth of what
    the person has said.
    It stops at three places, and all three matter:
    - **There is nothing left to read**, which is the good ending.
    - **One pass reads nothing**, which is the end that prevents the infinite loop: if the corpus
    says there are still quotes and the distillation fails to read any —all from projects that no
    longer exist, or a limit that leaves them out— continuing to try is just wasting effort.
    - **The model fails**, and then it stops there with what has already been saved, which is the
    same as what a loose pass does.
   */
  do {
    const response = await tryFetch(url, post({ ...body, dryRun: false }));
    if (response === undefined) return unreachable(parsed.api);
    if (!response.ok) return distillRefused(await refusalOf(response));

    last = (await response.json()) as DistillOutcome;
    totals.passes += 1;
    totals.verdicts += last.verdicts;
    totals.observed += last.observed ?? 0;
    totals.saved += last.saved;

    if (!parsed.all || last.verdicts === 0) break;
    const left = last.corpus === undefined ? 0 : last.corpus.total - last.corpus.read;
    if (left <= 0) break;
    process.stderr.write(
      pc.dim(`${say("twin.distillMore", { left, pass: totals.passes })}\n`),
    );
  } while (true);

  /*
    The receipt is from the last round with the totals of all of them: what matters in the end is
    where it leaves the corpus —the last one tells that— and how much it has cost to get there,
    which is the sum. Showing only the last one would say '12 quotes read' after twenty minutes.
   */
  process.stdout.write(
    distilledLines({ ...last, ...totals, model: last.model }).join("\n"),
  );
  if (totals.passes > 1) {
    process.stdout.write(
      `  ${pc.dim(say("twin.distillPasses", { n: totals.passes }))}\n\n`,
    );
  }
  return 0;
}

/**
 * The budget: how many verdicts, how many tokens, with whom and with what.
 *
 * All four together and in a row because all four are needed to decide. The number of tokens alone
 * does not indicate the cost —it is not the same in a subscription model as in one that is paid
 * per token— and the provider alone does not indicate how much will be sent to them.
 */
export function dryRunLines(estimate: DistillEstimate): string[] {
  return [
    `  ${pc.bold(
      say("twin.distillEstimate", {
        verdicts: estimate.verdicts,
        s: plural(estimate.verdicts),
        tokens: estimate.estimatedTokens,
        provider: estimate.provider,
        model: estimate.model,
      }),
    )}`,
    `  ${pc.dim(say("twin.distillCost"))}`,
    ...corpusLines(estimate.corpus),
  ];
}

/**
 * From how much history this batch comes out, and how much is left unread.
 *
 * It is the missing line and its absence was costly: '203 verdicts' is read as the entire corpus,
 * so a screen without new proposals seems like the end of the road when it was 9% of it. With the
 * number next to it, '2,061 remain' turns an empty screen into the next command.
 *
 * It doesn't come out when the catalog doesn't send it —an earlier version— nor when nothing is
 * left: there the correct phrase is said by `twin.distilledNone`, which already exists and already
 * explains what to do.
 */
export function corpusLines(corpus: CorpusProgress | undefined): string[] {
  if (corpus === undefined || corpus.total === 0) return [];
  const left = Math.max(corpus.total - corpus.read, 0);
  if (left === 0) {
    const clave = corpus.total === 1 ? "twin.corpusDoneOne" : "twin.corpusDoneMany";
    return [`  ${pc.dim(say(clave, { total: corpus.total }))}`];
  }
  return [
    `  ${pc.dim(say("twin.corpusLeft", { read: corpus.read, total: corpus.total, s: plural(corpus.total), left }))}`,
  ];
}

/**
 * What came back from the model, with the three figures that do not mean the same thing.
 *
 * `observed` are the phrases that the model wrote and `saved` are the ones that actually entered
 * the catalog: the remainder are the ones that were already there, because the identifier of an
 * observation is deterministic and distilling the same corpus twice does not duplicate anything.
 * Showing only the second one would make 'saved: 0' read as a failure when it is the correct
 * response to having repeated the command. It is the same lesson as `twin.saved`, and the same
 * wording.
 */
export function distilledLines(outcome: DistillOutcome): string[] {
  const lines = [""];
  if (!((outcome.observed ?? 0) > 0)) {
    lines.push(`  ${pc.yellow(say("twin.distilledNone"))}`, "", "");
    return lines;
  }

  lines.push(
    `  ${pc.green("✓")} ${say("twin.distilled", {
      observed: pc.bold(String(outcome.observed ?? 0)),
      saved: outcome.saved,
      verdicts: outcome.verdicts,
      s: plural(outcome.verdicts),
    })}`,
  );
  lines.push(
    `    ${pc.dim(
      outcome.usage === undefined
        ? say("twin.distilledModel", { model: outcome.model })
        : say("twin.distilledUsage", {
            model: outcome.model,
            input: outcome.usage.input,
            output: outcome.usage.output,
          }),
    )}`,
  );
  lines.push(...corpusLines(outcome.corpus));
  lines.push("", `  ${pc.dim(say("twin.distilledNext"))}`, "", "");
  return lines;
}

/**
 * The 'no' of `distill`, with the case that it is not an error separate from those that are.
 *
 * 502 is what the Panoma routes respond when someone says that it is not the model layer and not
 * them: it is `/api/describe` that does it since it has existed. And not having a model connected
 * is the normal state of a newly made installation —the default value of `panoma ai` is "none"—,
 * so showing it as a red rejection with a dump behind would display a failure where only a step is
 * missing. It is said what happens, the command that fixes it is stated —which also lives in
 * another command and nobody would guess— and below it, what the server said is left, which is the
 * only thing that distinguishes "no provider" from "the key expired".
 *
 * It exits due to the error and with code 1 just like the others: what was requested has not been
 * done, and a script that chains `distill` with `review` must be able to find out.
 */
function distillRefused(refusal: Refusal): number {
  if (refusal.status !== 502) return rejected(refusal, "twin.distillRejected");

  const lines = [
    "",
    `  ${pc.yellow("!")} ${say("twin.distillNoModel")}`,
    `  ${pc.dim(say("twin.distillNoModelHint"))}`,
  ];
  if (refusal.detail) lines.push(`  ${pc.dim(refusal.detail)}`);
  lines.push("", "");
  process.stderr.write(lines.join("\n"));
  return 1;
}

/** What `GET /api/twin/taste` answers. */
export interface TasteReply {
  beliefs: BeliefWire[];
  profile: TasteProfileWire;
  score?: { standing?: number; forming?: number; observations?: number };
  /**
   * If what the machine deduces by itself can go down to the file.
   *
   * Optional because a previous catalog does not send it, and there `undefined` is read as
   * granted: if that version does not know the permission, it means it does not apply it, and to
   * notify about a stop that does not exist would be to explain an absence with the wrong reason.
   */
  publishesInferred?: boolean;
  /** From identity to project name. Without this, you cannot say 'only in dricopilot'. */
  names?: Record<string, string>;
}

/** A belief: `BeliefRow`, by HTTP. */
export interface BeliefWire {
  id: string;
  topic: string;
  statement: string;
  /** inferred · signed · vetoed · retired · proposed. See the column in `schema.ts`. */
  state: string;
  /** The identity of the project to which it is limited, or nothing if it is valid in everything. */
  identity?: string | null;
  support?: { observations?: number; projects?: number; days?: number } | null;
  citations?: BeliefCitationWire[] | null;
}

/**
 * A verdict of yours quoted under a belief. `at` travels as a string, just like in `StoredVerdict`
 * and for the same reason: what is on the other side of `Response.json` is not a `Date`.
 */
export interface BeliefCitationWire {
  verdictId: string;
  quote: string;
  at: string;
  project?: string;
}

/** The portrait with its budget: `TasteProfile`, for HTTP. */
export interface TasteProfileWire {
  lines: Array<{
    topic: string;
    statement: string;
    citations?: string[] | null;
    /** The project to which it is limited, by its name. Absent is 'in everything you do'. */
    scope?: string;
  }>;
  chars: number;
  cap: number;
}

/** What `POST /api/twin/synthesize` answers. */
export interface SynthesizeReply {
  topics?: number;
  /** Subjects that have not been called because no new evidence has been presented. See the route. */
  unchanged?: number;
  created?: number;
  refined?: number;
  retired?: number;
  proposed?: number;
  observations?: number;
  estimatedTokens?: number;
  provider?: string;
  model?: string;
}

/** What `POST /api/twin/classify` answers. */
export interface ClassifyReply {
  pending?: number;
  classified?: number;
  minted?: number;
  left?: number;
}

/**
 * `synthesize`: write the portrait, without asking anyone anything.
 *
 * It replaces `review` and `consolidate`, which were the two queue commands. The former asked
 * phrase by phrase—with 2,278 quotes on this machine, that is hundreds of questions, and the
 * author got bored at the nineteenth—and the latter proposes merges that also had to be approved.
 * Here there is nothing to approve: the synthesis reads all the evidence of each subject and
 * writes down the beliefs of that subject. What is directed is directed afterward: by signing,
 * vetoing, or commenting, and always on something that already exists.
 *
 * Two calls and a command, in series. Before synthesizing, you have to distribute by subjects what
 * doesn’t have it, because the synthesis runs by topic; synthesizing over a half distribution
 * would write the portrait of the drawer. If the distribution fails, the synthesis doesn’t run.
 *
 * The essay goes first, as in `distill` and in `look`: how many subjects, how much evidence, and
 * how many tokens, **before** spending anything.
 */
async function synthesize(parsed: Flags): Promise<number> {
  const sorted = await tryFetch(new URL("/api/twin/classify", parsed.api), post({}));
  if (sorted === undefined) return unreachable(parsed.api);
  if (!sorted.ok) return distillRefused(await refusalOf(sorted));
  const reparto = (await sorted.json()) as ClassifyReply;

  const url = new URL("/api/twin/synthesize", parsed.api);
  const first = await tryFetch(url, post({ dryRun: true }));
  if (first === undefined) return unreachable(parsed.api);
  if (!first.ok) return distillRefused(await refusalOf(first));

  const estimate = (await first.json()) as SynthesizeReply;
  if (!(estimate.topics && estimate.topics > 0)) {
    /*
      Two distinct silences, and confusing them sends to distill the one who has already distilled
      everything. Without evidence there is no portrait, and the way out is to read the history;
      with complete evidence and nothing new since the last pass, the portrait is already written
      and there is nothing to do — which is what it has to say, instead of sending to repeat work
      already done.
     */
    const alDia = (estimate.unchanged ?? 0) > 0;
    process.stdout.write(
      `\n  ${pc.yellow(say(alDia ? "twin.synthUpToDate" : "twin.synthNothing"))}\n  ${pc.dim(
        say(alDia ? "twin.synthUpToDateHint" : "twin.synthNothingHint"),
      )}\n\n`,
    );
    return 0;
  }

  process.stdout.write(synthEstimateLines(estimate, reparto).join("\n"));

  const response = await tryFetch(url, post({}));
  if (response === undefined) return unreachable(parsed.api);
  if (!response.ok) return distillRefused(await refusalOf(response));

  process.stdout.write(synthLines((await response.json()) as SynthesizeReply).join("\n"));
  return 0;
}

/**
 * What it is going to cost, and what has already been distributed, before spending.
 *
 * The distribution is counted separately because it is another call and another price, and because
 * the first time is the large number: a database from the old tail contains hundreds of
 * sentences without substance, and not saying it would leave the essay promising a cheap synthesis
 * behind a distribution that it was not.
 */
export function synthEstimateLines(
  estimate: SynthesizeReply,
  sorted: ClassifyReply,
  ): string[] {
  const lines = ["", `  ${pc.bold(say("twin.synthTitle"))}`, ""];

  const classified = sorted.classified ?? 0;
  if (classified > 0) {
    lines.push(
      `  ${say("twin.synthSorted", { n: classified, s: plural(classified) })}`,
    );
    const minted = sorted.minted ?? 0;
    if (minted > 0) lines.push(`  ${pc.dim(say("twin.synthMinted", { n: minted }))}`);
  }

  lines.push(
    `  ${say("twin.synthEstimate", {
      topics: estimate.topics ?? 0,
      observations: estimate.observations ?? 0,
      tokens: estimate.estimatedTokens ?? 0,
    })}`,
  );
  if (estimate.provider) {
    lines.push(
      `  ${pc.dim(
        say("twin.synthModel", {
          provider: estimate.provider,
          model: estimate.model ?? "",
        }),
      )}`,
    );
  }
  lines.push("", `  ${pc.dim(say("twin.synthRunning"))}`, "");
  return lines;
}

/**
 * What moved, and the silence spoken aloud.
 *
 * A portrait that does not change is the correct response to a pass over evidence that was already
 * looked at, not a failure. Keeping quiet would cause the command to be launched again just in
 * case, which is exactly the expense that this receipt exists to prevent.
 */
export function synthLines(reply: SynthesizeReply): string[] {
  const created = reply.created ?? 0;
  const refined = reply.refined ?? 0;
  const retired = reply.retired ?? 0;
  const proposed = reply.proposed ?? 0;
  const lines: string[] = [];

  if (created + refined + retired + proposed === 0) {
    lines.push(`  ${pc.dim(say("twin.synthSame"))}`, "", "");
    return lines;
  }

  lines.push(
    `  ${pc.green("✓")} ${say("twin.synthDone", { created, refined, retired })}`,
  );
  /*
    The proposals are stated separately and with notice, because they are the only part of the
    entire synthesis that expects something from the person: the machine tried to change a belief
    that the person signed and the machine did not change. Merging them in the line above would turn them into just another
    number on a receipt that, moreover, asks for nothing.
   */
  if (proposed > 0) {
    lines.push(
      `  ${pc.yellow("!")} ${say("twin.synthProposed", { n: proposed, s: plural(proposed) })}`,
    );
  }
  lines.push("", `  ${pc.dim(say("twin.synthNext"))}`, "", "");
  return lines;
}

/**
 * `taste`: the portrait, and how much of the budget remains.
 *
 * Here, 'not yet' is no longer answered. What is taught is the file that your agents are going to
 * read, said in the language of the CLI and with the phrases grouped by where they are valid.
 */
async function taste(parsed: Flags): Promise<number> {
  const response = await tryFetch(new URL("/api/twin/taste", parsed.api));
  if (response === undefined) return unreachable(parsed.api);
  if (!response.ok) return rejected(await refusalOf(response), "twin.tasteRejected");

  const reply = (await response.json()) as TasteReply;
  // A catalog of another version that does not send a portrait falls on the empty screen, which
  // brings the path that fills it, instead of on a `undefined.lines` without explanation.
  const profile = reply.profile ?? { lines: [], chars: 0, cap: 0 };
  const forming = reply.score?.forming ?? 0;
  const standing = reply.score?.standing ?? 0;

  const lines = ["", `  ${pc.bold(say("twin.tasteTitle"))}`, ""];
  lines.push(...profileLines(profile));
  /*
    And why is what is missing absent, when it is missing because of permission and not because of
    evidence. They are two absences that look the same in the file and ask for opposite things:
    one waits for more appointments, the other waits for a response. Keeping it quiet would leave
    someone waiting for a floor to be filled that is already full.
   */
  if (reply.publishesInferred === false && standing > profile.lines.length) {
    const esperando = standing - profile.lines.length;
    lines.push("", `  ${pc.yellow(say("twin.tasteWaiting", { n: esperando }))}`);
    lines.push(`  ${pc.dim(say("twin.tasteWaitingHint"))}`);
  }
  /*
    What is in formation is spoken, and not taught. They are beliefs that evidence does not yet
    support: they do not go down to the file, so no agent reads them, and putting them here
    alongside those that do go down would suggest the portrait is bigger than it is. But keeping
    them completely silent would leave a number that does not match between this screen and the
    website.
   */
  if (forming > 0) {
    const waiting = say("twin.tasteForming", { n: forming, s: plural(forming) });
    lines.push("", `  ${pc.dim(waiting)}`);
  }
  lines.push("", "");

  process.stdout.write(lines.join("\n"));
  return 0;
}

/** The order in which they are read. The same as `TASTE_TOPICS`, with the drawer at the end. */
const TOPIC_ORDER = [
  "design",
  "frontend",
  "backend",
  "cli",
  "testing",
  "copy",
  "workflow",
  "tooling",
  "data",
  "other",
];

/**
 * What is each subject called, and what do you do with one that this CLI does not know.
 *
 * The vocabulary is **open**: the classifier can coin a subject that no one anticipated, and it is
 * stored in a text column rather than an enum. It is taught just as it is instead of being hidden
 * behind a filler 'others': the belief can still be read, and an invented label would be the only
 * word on the screen that came neither from you nor from the model. It is the same rule that
 * `verdicts.ts` follows when leaving `category` in `null` before filling it in.
 */
const TOPIC_WORD: Record<string, MessageKey> = {
  design: "twin.topicDesign",
  frontend: "twin.topicFrontend",
  backend: "twin.topicBackend",
  cli: "twin.topicCli",
  testing: "twin.topicTesting",
  copy: "twin.topicCopy",
  workflow: "twin.topicWorkflow",
  tooling: "twin.topicTooling",
  data: "twin.topicData",
  other: "twin.topicOther",
};

export function topicWord(topic: string): string {
  const key = TOPIC_WORD[topic];
  return key === undefined ? topic : say(key);
}

/**
 * The entire portrait: the sentences by section, and the budget below.
 *
 * The void is not an empty box but the path that fills it. A portrait without phrases is the state
 * of the whole world until it distills and reviews for the first time, that is, the screen that
 * the most people are going to see: a frame with "0 of 3,000 characters" inside would be
 * technically correct and would not say the only thing that needs to be known, which are the two
 * commands that must be typed. It is the same decision that `mine` makes when no permission is
 * granted.
 *
 * And the budget is always mentioned, not just when it’s tight. Three thousand characters is a
 * hard limit —imposed by `writeTaste`, which refuses to be exceeded— and a limit that you only
 * notice when you hit it is a limit that is discovered at the worst possible moment: by accepting
 * a sentence that no longer fits. Starting from `FULL_ENOUGH` the line leaves gray and turns
 * amber, which is the same color code the rest of the command uses to warn of what will hurt
 * later.
 */
export function profileLines(profile: TasteProfileWire): string[] {
  const rows = Array.isArray(profile.lines) ? profile.lines : [];
  if (rows.length === 0) {
    return [
      `  ${pc.yellow(say("twin.tasteEmpty"))}`,
      `  ${pc.dim(say("twin.tasteEmptyHint"))}`,
    ];
  }

  const lines: string[] = [];
  for (const topic of topicsOf(rows)) {
    lines.push(`  ${pc.bold(topicWord(topic))}`, "");
    for (const row of rows.filter((one) => one.topic === topic)) {
      const n = Array.isArray(row.citations) ? row.citations.length : 0;
      const backing =
        n > 0 ? ` ${pc.dim(`· ${say("twin.tasteCitations", { n, s: plural(n) })}`)}` : "";
      /*
        And where is it valid, when it is not valid everywhere. It has been missing since the
        reach exists: the file is written —`only in dricopilot:`— and this screen threw it when
        reading it, so the terminal generally showed one that only applies in a project.
       */
      const only = row.scope ? ` ${pc.dim(`· ${say("twin.tasteOnly", { project: row.scope })}`)}` : "";
      lines.push(`    ${pc.dim("·")} ${row.statement}${only}${backing}`);
    }
    lines.push("");
  }

  const tone = profile.chars >= profile.cap * FULL_ENOUGH ? pc.yellow : pc.dim;
  lines.push(
    `  ${tone(
      say("twin.tasteBudget", {
        chars: profile.chars,
        cap: profile.cap,
        left: Math.max(0, profile.cap - profile.chars),
      }),
    )}`,
  );
  lines.push(`  ${pc.dim(say("twin.tasteFile"))}`);
  return lines;
}

/**
 * What materials there are and in what order they are rendered.
 *
 * Those planted in the order of `TOPIC_ORDER` and behind them the minted ones, in the order in
 * which they arrived —which is the order of the file, and the file writes them alphabetically—.
 * Sorting by what the catalog provides would allow two consecutive runs to depict the same
 * portrait in two different orders, and a portrait that is reordered alone is read as if it had
 * changed.
 */
function topicsOf(rows: Array<{ topic: string }>): string[] {
  const seen = rows.map((row) => row.topic);
  const known = TOPIC_ORDER.filter((topic) => seen.includes(topic));
  const rest = seen.filter((topic) => !TOPIC_ORDER.includes(topic));
  return [...known, ...new Set(rest)];
}

/** What `GET /api/twin/score` answers. */
/** A month of activity, just as `/api/twin/score` dictates. */
export interface ChurnLine {
  month: string;
  created: number;
  refined: number;
  retired: number;
  proposed: number;
  moved: number;
}

export interface ScoreReply {
  /** Living beliefs: the inferred plus the signed. */
  beliefs: number;
  /** Those that exceed the floor of evidence and go down to the file. */
  standing: number;
  /** The ones that haven't yet: they appear on the screen and don't leave it. */
  forming: number;
  signed: number;
  vetoed: number;
  /** Everything the machine has come to tell you. The denominator. */
  shown: number;
  /** Vetos plus rewrites: the times you have had to correct it. */
  corrections: number;
  /** How much evidence there is underneath, and how much by belief. */
  observations: number;
  density: number | null;
  /** `null` below `floor`. It is not a zero: it is 'it still means nothing'. */
  rate: number | null;
  /** How many beliefs are needed for there to be a percentage. The catalog decides. */
  floor: number;
  recent: ScoreWindow;
  previous: ScoreWindow;
  /** How much the portrait has moved, month by month, from the most recent to the oldest. */
  churn?: ChurnLine[];
  /**
   * The other half of the note: of what the critic has pointed out, how much ended up in a
   * commission.
   *
   * Optional like churn and for the same reason: an older catalog does not send it, and the
   * terminal has to keep printing the marker instead of failing because of a field that did not
   * arrive.
   */
  briefs?: {
    findings: number;
    ordered: number;
    rate: number | null;
    /** Of the critic's assignments, how many different ones have been sent to an agent. */
    launched?: number;
    /** And to how many findings did you say no? */
    discarded?: number;
    /** And how many times, counting re-releases: a commission that comes out four times is seen here. */
    launches?: number;
  };
  /**
   * How many projects does the portrait reach, which is the question on which the others depend.
   *
   * Optional like the churn and for the same reason: an older catalog doesn't send it, and the
   * terminal has to keep printing the marker instead of being silent because of a field that
   * didn't arrive.
   */
  reach?: { projects: number; reached: number };
  /**
   * What the numbers say, in one word.
   *
   * Chain and not closed union on purpose: it is written by the catalog, which may be from another
   * version and bring a fifth reading that does not exist here. A type that promised four would
   * make that case impossible to even write, and that is precisely the one that needs to be
   * addressed.
   */
  reading: string;
  /**
   * The same reading, already drafted along the route and in the language requested by `withLang`.
   *
   * This command does not print it: yours is in `messages.ts`, split across the width of a
   * terminal and with its color. The one from the path is a continuous sentence, written for a
   * page. It is declared because it appears in the body and whoever reads this has to know it is
   * there.
   */
  sentence?: string;
}

/**
 * A fifth of beliefs: those that were born in a batch of thirty days, and how many of them you
 * have ended up correcting.
 *
 * The two fifths run one month apart —the last one and the one before, never the current one—: a
 * newly born fifth has not yet been fully judged, and comparing it with an established one would
 * always say that it has improved. The full reason is in `TasteWindow`, in `@panoma/db`.
 */
export interface ScoreWindow {
  shown: number;
  corrections: number;
  /** Subject to the same floor as the total, so almost always zero at the beginning. */
  rate: number | null;
}

/**
 * `score`: the only note that Twin gives himself, and it has to be able to be bad.
 *
 * The other screens show what Twin **has done**: how many reactions came from the disc, which
 * verdicts it saved, which beliefs it wrote down. None answers the question with which
 * `EL-DOBLE.md` stakes the entire project — 'how many times do you correct me?' — and without it,
 * a double that has gone off making things up confidently reads exactly the same as one that gets
 * it right: both show sentences with quotes underneath.
 *
 * What is counted changed with the tail. Before, it was the yeses on what was decided; now no one
 * signs anything by default, so the **corrections** are counted: vetoes and rewrites. And `better`
 * becomes less, not more.
 *
 * It is one of the shortest because it decides nothing. The piles, the percentage, the floor, and
 * the reading are counted by the catalog in a single pass —`tasteScore`, where it is explained why
 * the floor is twenty and why the months are thirty-day windows—, and here they are only rendered.
 * The fact that the reading comes from there is what prevents the terminal and the web from giving
 * different answers on the same day about the same portrait.
 */
async function score(parsed: Flags): Promise<number> {
  const response = await tryFetch(new URL("/api/twin/score", parsed.api));
  if (response === undefined) return unreachable(parsed.api);
  if (!response.ok) return rejected(await refusalOf(response), "twin.scoreRejected");

  process.stdout.write(scoreLines((await response.json()) as ScoreReply).join("\n"));
  return 0;
}

/** What `/api/twin/design` returns. See `portfolioDesign`. */
export interface DesignReply {
  /** Projects with a saved footprint. The denominator of everything else. */
  read: number;
  withUi: number;
  colors: { value: string; projects: number; uses: number | null }[];
  fonts: { value: string; projects: number }[];
  radii: { value: string; projects: number }[];
  darkMode: number;
  animation: number;
}

/** `design`: the portrait that doesn't carry a single word. */
async function design(parsed: Flags): Promise<number> {
  const response = await tryFetch(new URL("/api/twin/design", parsed.api));
  if (response === undefined) return unreachable(parsed.api);
  if (!response.ok) return rejected(await refusalOf(response), "twin.designRejected");

  process.stdout.write(designLines((await response.json()) as DesignReply).join("\n"));
  return 0;
}

/**
 * The visual portrait, on a terminal where colors cannot be displayed.
 *
 * So hexadecimal is taught and **in how many projects it is**, which is of the two things the one
 * that really says something: a color that appears four hundred times in one place and nowhere
 * else is not a palette, it is a project. On the screen the little square is visible and the
 * number looks like a footnote; here there is no little square and the number is the entire
 * content.
 *
 * And the void is explained instead of printing three blank lists: without revisions there are no
 * traces, and without traces this is not 'you have no style,' it is 'nothing has been read yet.'
 */
export function designLines(reply: DesignReply): string[] {
  const lines = ["", `  ${pc.bold(say("twin.designTitle"))}`, ""];

  if (reply.read === 0) {
    lines.push(`  ${pc.dim(say("twin.designEmpty"))}`, "");
    return lines;
  }

  lines.push(
    `  ${pc.dim(say("twin.designFrom", { read: reply.read, withUi: reply.withUi }))}`,
    "",
  );

  for (const color of reply.colors) {
    lines.push(
      `    ${color.value.padEnd(9)}  ${pc.dim(
        say("twin.designProjects", { projects: color.projects }),
      )}`,
    );
  }

  if (reply.fonts.length > 0) {
    lines.push("", `  ${say("twin.designFonts", {
      fonts: reply.fonts.map((font) => font.value).join(" · "),
    })}`);
  }
  if (reply.radii.length > 0) {
    lines.push(`  ${say("twin.designRadii", {
      radii: reply.radii.map((radius) => radius.value).join(" · "),
    })}`);
  }
  lines.push(
    `  ${pc.dim(
      say("twin.designTraits", { dark: reply.darkMode, animation: reply.animation }),
    )}`,
    "",
  );
  return lines;
}

/**
 * Each reading with its phrase and its color, which here is not decoration.
 *
 * The green is the same as `distilledLines` and the amber is the one the rest of the command uses
 * for what is going to hurt later. A "no improvement" printed in the gray of the footnotes would
 * be the polite way to hide it, and this screen exists precisely to not hide it. The two readings
 * that don't know anything yet do go in gray: they are not bad news, they are the absence of news.
 */
const READING: Record<string, { key: MessageKey; tone: (text: string) => string }> = {
  tooFew: { key: "twin.scoreTooFew", tone: pc.dim },
  noTrend: { key: "twin.scoreNoTrend", tone: pc.dim },
  better: { key: "twin.scoreBetter", tone: pc.green },
  notBetter: { key: "twin.scoreNotBetter", tone: pc.yellow },
};

/**
 * The score: the piles, the percentage if any, and what it means.
 *
 * In that order because in that order it is read, and with two things that must be said out loud:
 *
 * - **The percentage is not rendered below the floor.** A `null` drawn as "0%" would be the
 * **best** possible grade here — "you didn't have to correct it even once" — said about a double
 * of which nothing is known yet. Instead, the phrase goes that says how many are missing.
 * - **The piles go in front of the percentage, always.** The denominator is everything the machine
 * has told you, and silence counts as a correct answer: it is weaker than counting decisions one
 * by one, so «out of 24, you vetoed 2 and rewrote 1» has to go in front, because that is checked
 * by looking at the portrait and 12% does not.
 *
 * The reading arrives in a word and here it is only translated. One that CLI does not know —a
 * newer catalog, with a fifth— is neither translated nor invented: the numbers are taught the same
 * and the sentence is left out. It is the same that `topicWord` does with a coined material.
 */
export function scoreLines(reply: ScoreReply): string[] {
  const lines = ["", `  ${pc.bold(say("twin.scoreTitle"))}`, ""];

  /*
    Without anything said, a zero marker is not rendered: it is said where the numbers come from.
    It is the same case as the empty portrait and the `distill` without verdicts —the first screen
    for everyone— and it deserves the same response, which is the one that brings the missing
    commands.
   */
  if (!(reply.shown > 0)) {
    lines.push(`  ${pc.yellow(say("twin.scoreNothing"))}`);
    lines.push(`  ${pc.dim(say("twin.scoreNothingHint"))}`, "", "");
    return lines;
  }

  lines.push(
    `  ${say("twin.scoreCounts", {
      beliefs: reply.beliefs,
      forming: reply.forming,
      signed: reply.signed,
    })}`,
  );
  lines.push(
    `  ${say("twin.scoreCorrections", {
      corrections: reply.corrections,
      shown: reply.shown,
    })}`,
  );
  if (typeof reply.rate === "number") {
    lines.push(`  ${pc.bold(say("twin.scoreRate", { rate: reply.rate }))}`);
  }
  if (typeof reply.density === "number") {
    lines.push(
      `  ${pc.dim(
        say("twin.scoreDensity", {
          density: reply.density,
          observations: reply.observations,
        }),
      )}`,
    );
  }

  /*
    And what you have done with what the critic pointed out. Only if it has seen something:
    'in charge: 0 of 0' about a critic who hasn't looked at anything yet is not a zero, it's a
    gap.
   */
  const briefs = reply.briefs;
  if (briefs !== undefined && briefs.findings > 0) {
    lines.push(
      `  ${say("twin.scoreBriefs", {
        ordered: briefs.ordered,
        findings: briefs.findings,
      })}`,
    );
    if (typeof briefs.rate === "number") {
      lines.push(`  ${pc.dim(say("twin.scoreBriefsRate", { rate: briefs.rate }))}`);
    }
    /*
      And of the managers, how many have actually left. An old catalog doesn’t run the field, and
      nothing gets published there: a "launched: 0" that actually means "this version didn’t
      record it" is the worse of the two ways to stay silent.
     */
    const launched = briefs.launched;
    if (typeof launched === "number" && briefs.ordered > 0) {
      lines.push(`  ${pc.dim(say("twin.scoreBriefsLaunched", { launched }))}`);
      // The second figure only when it says something that the first does not: relaunching is
      // correcting.
      const launches = briefs.launches;
      if (typeof launches === "number" && launches > launched) {
        lines.push(`  ${pc.dim(say("twin.scoreBriefsRelaunched", { launches }))}`);
      }
    }
    // And the rejected, which is the other half of the decision. Only when it exists: a zero there
    // is read as a judgment on the critic instead of as a button that no one has pressed.
    const discarded = briefs.discarded;
    if (typeof discarded === "number" && discarded > 0) {
      lines.push(`  ${pc.dim(say("twin.scoreBriefsDiscarded", { discarded }))}`);
    }
  }

  /*
    And how many does it reach. It goes in amber when it doesn't reach anyone and not in gray,
    because it is not a footnote: it is the news. Everything above measures a portrait that no one
    is reading there.
   */
  const reach = reply.reach;
  if (reach !== undefined && reach.projects > 0) {
    const linea = say("twin.scoreReach", {
      reached: reach.reached,
      projects: reach.projects,
    });
    lines.push("", `  ${reach.reached === 0 ? pc.yellow(linea) : linea}`);
    if (reach.reached === 0) {
      lines.push(`  ${pc.dim(say("twin.scoreReachHow"))}`);
    }
  }

  const reading = READING[reply.reading];
  if (reading !== undefined) {
    /*
      Only the percentages that exist. A null filled with a zero would appear on the screen as a
      perfect measurement instead of as a gap; without it, `say` shows `{recent}`, which is ugly,
      visible, and fixed in a grep. It is the rule that `say` itself documents.
     */
    const vars: Vars = { shown: reply.shown, floor: reply.floor };
    const recent = reply.recent?.rate;
    const previous = reply.previous?.rate;
    if (typeof recent === "number") vars["recent"] = recent;
    if (typeof previous === "number") vars["previous"] = previous;
    lines.push("", `  ${reading.tone(say(reading.key, vars))}`);
  }

  if (reply.vetoed > 0) lines.push("", `  ${pc.dim(say("twin.scoreGraveyard"))}`);

  lines.push(...churnLines(reply.churn ?? []));

  lines.push("", "");
  return lines;
}

/**
 * How much the portrait has moved, month by month.
 *
 * It goes under the marker and not inside because they are two questions: the marker shows how
 * much you have had to correct it —your part— and this shows how much it moves on its own. A
 * double that doesn't force you to correct anything because it says nothing new gets a good grade
 * above and is useless; together, the two figures do reveal it.
 *
 * Without a verdict, just like on the screen: 'it moved less than last month' does not mean
 * convergence if last month five hundred appointments came in and this month none. Only what
 * admits no doubt is commented on — that last month it did not move, or that it was only
 * rewritten.
 */
export function churnLines(churn: ChurnLine[]): string[] {
  if (churn.length === 0) return [];

  const lines = ["", `  ${pc.dim(say("twin.churnTitle"))}`];
  for (const one of churn) {
    lines.push(
      `  ${say("twin.churnMonth", {
        month: one.month,
        created: one.created,
        refined: one.refined,
        retired: one.retired,
      })}`,
    );
  }

  const latest = churn[0];
  if (latest === undefined) return lines;
  if (latest.moved === 0) lines.push(`  ${pc.green(say("twin.churnStill"))}`);
  else if (latest.created === 0 && latest.retired === 0 && latest.refined > 0) {
    lines.push(`  ${pc.yellow(say("twin.churnOnlyRefined"))}`);
  }

  return lines;
}

/**
 * `look`: show the critic a screen and have it say what is wrong, with your portrait in front.
 *
 * It's the middle turn, which is where it really hurts: the agent delivers, and between that
 * delivery and the next order you have to open the screen, judge it, and write what is missing.
 * This command does the middle part and returns the last thing already written — each finding
 * brings the task that should be given.
 *
 * ── You bring the capture, and here there is no consent other than the command ──────
 *
 * Panoma does not start your project nor does it carry a browser inside: you show it a file. That
 * works for a route, for a desktop application, for a Figma frame, and for a photo from the phone,
 * and in all four it is exactly what you had in front of you.
 *
 * And no separate permission is requested, unlike with the agent stories. The difference is real:
 * `twin allow claude-code` opens 778 files that no one has selected one by one, so the yes has to
 * be an act distinct from reading them. Here you write the path of the only file that will come
 * out, each time. The gesture **is** the permission, and a 'are you sure?' on top would be
 * theater. What is done, however, is to say out loud what is being sent and warn about what Panoma
 * cannot fix: an image does not go through any striking-out tool.
 *
 * ── It is always rehearsed, and the rehearsal does not raise the image
 * ────────────────────────────
 *
 * The budget is shown before spending it, as in `distill`. What changes is that here the test goes
 * **without the image**: only with its weight. Uploading four and a half megabytes to ask how much
 * it costs to upload them is paying the shipping for the privilege of being told the price.
 */
async function look(parsed: Flags): Promise<number> {
  const slug = parsed.positionals[2];
  const file = parsed.positionals[3];
  if (slug === undefined) {
    process.stderr.write(pc.red(`${say("twin.lookNeedsArgs")}\n`));
    return 1;
  }

  const { MAX_SCREENSHOT_BYTES, SMALL_SCREENSHOT_WIDTH, ScreenshotError, readScreenshot } =
    await import("@panoma/core");

  /*
    Without a file, the last one from the mailbox.
    It is the gesture that will really be repeated: the agent finishes, leaves the capture of what
    it has done in `.panoma/shots/` because the `AGENTS.md` block asks for it, and here you only
    have to say which project. The file method is kept for what the agent cannot capture — a
    desktop app, a Figma frame, a photo from a mobile.
   */
  let chosen: string;
  let from: Chosen | undefined;
  if (file !== undefined) {
    chosen = resolve(file);
  } else {
    const picked = await fromInbox(slug, parsed.api);
    if (typeof picked === "number") return picked;
    chosen = picked.path;
    from = picked;
  }

  let shot;
  try {
    shot = await readScreenshot(chosen);
  } catch (error) {
    if (!(error instanceof ScreenshotError)) throw error;
    return unreadable(error, MAX_SCREENSHOT_BYTES);
  }

  const lines = ["", `  ${pc.bold(say("twin.lookTitle"))}`, ""];
  // The size in pixels when known, and nothing when not —not even the separator—: `readScreenshot`
  // leaves the field out rather than invent it, and this line does the same.
  const dims = shot.width && shot.height ? ` · ${shot.width}×${shot.height}` : "";
  const sending = say("twin.lookSending", {
    file: shortPath(shot.path),
    size: size(shot.bytes),
    dims,
  });
  lines.push(`  ${sending}`);
  if (from !== undefined) lines.push(`  ${pc.dim(inboxLine(from))}`);
  lines.push(`  ${pc.yellow(say("twin.lookNotRedacted"))}`);
  if (shot.width !== undefined && shot.width < SMALL_SCREENSHOT_WIDTH) {
    lines.push(
      `  ${pc.dim(
        say("twin.lookTiny", { width: shot.width, floor: SMALL_SCREENSHOT_WIDTH }),
      )}`,
    );
  }
  lines.push("");

  const url = new URL("/api/twin/look", parsed.api);
  const first = await tryFetch(
    url,
    post({ slug, mediaType: shot.mediaType, imageBytes: shot.bytes, dryRun: true }),
  );
  if (first === undefined) return unreachable(parsed.api);
  if (!first.ok) return rejected(await refusalOf(first), "twin.lookRejected");

  const estimate = (await first.json()) as LookEstimate;
  lines.push(...lookEstimateLines(estimate, shot.bytes), "");

  if (parsed.dryRun) {
    lines.push(`  ${pc.dim(say("twin.lookDryRun"))}`);
    lines.push(`  ${pc.dim(say("twin.lookDryRunHint"))}`, "", "");
    process.stdout.write(lines.join("\n"));
    return 0;
  }

  process.stdout.write(lines.join("\n"));
  process.stderr.write(pc.dim(`${say("twin.lookRunning")}\n`));

  const second = await tryFetch(
    url,
    post({ slug, mediaType: shot.mediaType, image: shot.data, dryRun: false }),
  );
  if (second === undefined) return unreachable(parsed.api);
  if (!second.ok) return rejected(await refusalOf(second), "twin.lookRejected");

  process.stdout.write(lookLines((await second.json()) as LookReply).join("\n"));
  return 0;
}

/** The chosen capture of the mailbox, with what is needed to count where it came from. */
interface Chosen {
  path: string;
  at: string;
  /** How many are there in total, so that 'the last one' does not seem 'the only one'. */
  total: number;
  /** Mailbox files that are not images. See `ShotsInbox.skipped`. */
  skipped: number;
}

export interface InboxReply {
  slug: string;
  dir: string;
  exists: boolean;
  skipped: number;
  shots: { name: string; bytes: number; at: string }[];
}

/**
 * The last delivery of the mailbox, or the reason why there is none.
 *
 * The two “no” are different and are said differently: without a folder the channel is not set up
 * and it is fixed with `panoma md init`; with a folder and without captures the channel is set up
 * and the one who has not done their part is the agent. Sending the person to execute `md init` on
 * a channel that is already set up is sending them to fix what is not broken.
 */
async function fromInbox(slug: string, api: string): Promise<Chosen | number> {
  const url = new URL("/api/twin/look", api);
  url.searchParams.set("slug", slug);

  const response = await tryFetch(url);
  if (response === undefined) return unreachable(api);
  if (!response.ok) return rejected(await refusalOf(response), "twin.lookRejected");

  const inbox = (await response.json()) as InboxReply;
  const newest = inbox.shots[0];

  if (!inbox.exists || newest === undefined) {
    const key: MessageKey = inbox.exists ? "twin.lookInboxEmpty" : "twin.lookNoInbox";
    const hint: MessageKey = inbox.exists ? "twin.lookInboxEmptyHint" : "twin.lookNoInboxHint";
    process.stderr.write(
      pc.yellow(`${say(key, { dir: shortPath(inbox.dir) })}\n`) +
        pc.dim(`${say(hint)}\n`),
    );
    return 1;
  }

  return {
    path: join(inbox.dir, newest.name),
    at: newest.at,
    total: inbox.shots.length,
    skipped: inbox.skipped,
  };
}

/**
 * Where the capture came from: from the mailbox, when they left it, and how many more there were.
 *
 * The total number is not decoration. 'The last one' on a mailbox of four means that there are
 * three deliveries that nobody has looked at, and without that number the screen reads as if the
 * agent had left just one thing. What is not an image is named for the same reason: if the agent
 * is leaving notes there, the person looking has to know that Panoma is not reading them.
 */
export function inboxLine(chosen: Chosen, now = new Date().toISOString()): string {
  const parts = [
    say("twin.lookFromInbox", { when: sinceMs(chosen.at, now) }),
    ...(chosen.total > 1 ? [say("twin.lookInboxMore", { n: chosen.total - 1 })] : []),
    ...(chosen.skipped > 0 ? [say("twin.lookInboxSkipped", { n: chosen.skipped })] : []),
  ];
  return parts.join(" · ");
}

/** The 'no' of the disk, with the top mentioned in the same unit as the file. */
function unreadable(
  error: { problem: string; path: string; bytes?: number },
  cap: number,
  ): number {
  const path = shortPath(error.path);
  if (error.problem === "too-big") {
    process.stderr.write(
      pc.red(
        `${say("twin.lookTooBig", { size: size(error.bytes ?? 0), cap: size(cap) })}\n`,
      ),
    );
    return 1;
  }

  const key: MessageKey =
    error.problem === "empty"
      ? "twin.lookEmpty"
      : error.problem === "not-an-image"
        ? "twin.lookNotImage"
        : "twin.lookMissing";
  process.stderr.write(pc.red(`${say(key, { path })}\n`));
  return 1;
}

/** What was spent today on glances, just as the spending book of the catalog recounts. */
export interface LookBudget {
  used: number;
  cap: number;
  input: number;
  output: number;
  /** Today's calls that did not report their usage. See `ModelSpend` in `@panoma/db`. */
  unmetered: number;
}

export interface LookEstimate {
  statements: number;
  estimatedTokens: number;
  imageBytes: number;
  provider: string;
  model: string;
  budget: LookBudget;
}

export interface LookFinding {
  what: string;
  where: string;
  fix: string;
  cites: string[];
}

export interface LookReply {
  findings: LookFinding[];
  dropped: number;
  unreadable?: boolean;
  statements: number;
  model: string;
  usage?: { input: number; output: number };
  budget: LookBudget;
}

/**
 * The budget of a glance: what it will be measured with, how much it weighs, and with whom.
 *
 * The size of the image is rendered from what the disk measured and not from what the server
 * answered. In the test, they are the same number —we just told you that— and as soon as they stop
 * being the same, the one that must be shown is the one from the file that is going to be sent.
 */
export function lookEstimateLines(estimate: LookEstimate, bytes: number): string[] {
  return [
    `  ${pc.bold(
      say("twin.lookEstimate", {
        statements: estimate.statements,
        s: plural(estimate.statements),
        tokens: estimate.estimatedTokens,
        size: size(bytes),
        provider: estimate.provider,
        model: estimate.model,
      }),
    )}`,
    `  ${pc.dim(say("twin.lookCost"))}`,
  ];
}

/**
 * The findings, each with its assignment and with your phrase that breaks.
 *
 * The order of the three lines is based on usage and not importance: what is wrong, what to
 * request, and why it is wrong. What is going to be copied to the agent is the second one, so it
 * goes attached to the first; the quote goes below because it is read once — to decide if you
 * agree — and then it is not looked at again.
 *
 * Without findings, one does not draw an empty list or a '0 problems': it is said that nothing you
 * passed breaks, which is the statement that has really been verified. And the footnote comes out
 * the same, because 'how many sentences you had in front of you' is exactly what you need to know
 * to read a pass.
 */
export function lookLines(reply: LookReply): string[] {
  const lines = [""];

  if (reply.unreadable === true) {
    lines.push(`  ${pc.yellow(say("twin.lookUnreadable"))}`, "");
  } else if (reply.findings.length === 0) {
    lines.push(`  ${pc.green("✓")} ${say("twin.lookClean")}`, "");
  } else {
    lines.push(
      `  ${pc.bold(
        say("twin.lookBreaks", {
          n: reply.findings.length,
          s: plural(reply.findings.length),
        }),
      )}`,
      "",
    );

    reply.findings.forEach((finding, index) => {
      lines.push(`  ${pc.yellow(String(index + 1))}  ${finding.what}`);
      lines.push(`     ${pc.dim(finding.where)}`);
      lines.push(`     ${pc.green("→")} ${say("twin.lookFix", { fix: finding.fix })}`);
      for (const cite of finding.cites) {
        lines.push(`     ${pc.dim(say("twin.lookAgainst", { statement: cite }))}`);
      }
      lines.push("");
    });
  }

  /*
    The discards are always mentioned whenever there are any, even when the screen comes out clean
    — and that is where they are most needed: a 'nothing breaks' with four judgments thrown behind
    means that the model saw things and none could be hung on one of your sentences, which is not
    the same as having seen nothing.
   */
  if (reply.dropped > 0) {
    lines.push(
      `  ${pc.dim(say("twin.lookDropped", { n: reply.dropped, s: plural(reply.dropped) }))}`,
    );
    lines.push(`  ${pc.dim(say("twin.lookDroppedHint"))}`, "");
  }

  lines.push(
    `  ${pc.dim(
      say("twin.lookFooter", {
        statements: reply.statements,
        s: plural(reply.statements),
        used: reply.budget.used,
        cap: reply.budget.cap,
      }),
    )}`,
  );

  /*
    The expense of the day, and only when someone has posted it.
    It is what `EL-DOBLE.md` asks to be able to see, and here is where there is a screen to show
    it. With subscription providers both numbers come to zero and the line does not appear: a "0
    tokens" under three looks would be read as if they were free, when what happens is that that
    backup does not say that. When there are unmeasured calls they are named, which is the only
    way for the total not to appear smaller than it actually was.
   */
  const tokens = reply.budget.input + reply.budget.output;
  if (tokens > 0) {
    lines.push(
      `  ${pc.dim(
        say("twin.lookSpend", {
          input: reply.budget.input,
          output: reply.budget.output,
          unmetered:
            reply.budget.unmetered > 0
              ? say("twin.lookUnmetered", { n: reply.budget.unmetered })
              : "",
        }),
      )}`,
    );
  }

  lines.push("", "");
  return lines;
}

/**
 * The day locally and in fixed format.
 *
 * Neither `toLocaleDateString` nor `toISOString`: the first one changes form according to the
 * machine and the second one changes day — a reaction at eleven thirty at night would appear dated
 * tomorrow as soon as there is a time zone ahead of UTC.
 */
function day(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at.slice(0, 10);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The path with the abbreviated home, respecting the separator of each system. */
function shortPath(path: string): string {
  const home = homedir();
  return home && path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path;
}

/*
  The third byte formatter of the repository, and not for no reason.
  There are already two —`formatBytes` in `render.ts` and `size` in `index.ts` — and none of them
  are exported, so reusing them requires touching files that this task does not open. This copy is
  the one from `index.ts` letter by letter so that merging the three is a deletion and not a
  decision.
 */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  /*
    A decimal below ten megas, and not to boast of precision.
    With whole megabytes, the rejection of a capture that is too large said "it weighs 3 MB and
    the limit is 3 MB," which is a phrase that makes it seem like the command is broken: 3,522,274
    bytes and 3,500,000 are rounded to the same number. With a decimal, you read 3.4 and 3.3,
    which is what really happens. Above ten megabytes, the decimal stops meaning anything and
    becomes noise, so rounding is continued there.
   */
  if (bytes < 10 * 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
