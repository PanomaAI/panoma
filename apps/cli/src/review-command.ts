import pc from "picocolors";
import type { CriticFinding, CriticKind, CriticReport } from "@panoma/core";
import { plural, say, type MessageKey } from "./messages";

/*
  `panoma review` — what's wrong, without opening it.
  Today, when an agent returns a screen, the person opens it and judges it entirely: whether it is
  pretty, whether it matches the rest, whether the link below leads somewhere, and whether the
  image shows what it depicts. The last two questions do not require anyone in front. This command
  does that part and nothing more: it passes the index and the design fingerprint to the
  `@panoma/core` critic and writes down whatever comes out. There is no model, no browser, no
  network, and not a cent is spent — this is the complete difference with `panoma md review`,
  which asks a model for its opinion on the instruction file and charges for it.
  That is why the output is grouped by class and not by file: what is shown is not a listing of
  sites but a listing of **defects**, and for a defect, one wants to see at a glance how many
  times it occurs. And that is why there is a limit of rows per group: on the author's disk,
  `mapbox-maps-flutter-main` returns ninety broken links from a single tracking table, and ninety
  consecutive lines do not convey anything that the number does not.
  ── Silence is also a response, and it must be written down ────────────────────────
  A critic who, faced with a clean project, prints nothing leaves the person who launched it not
  knowing if they looked. So when there is nothing, it is stated how many files were looked at and
  it exits with zero, which is what a CI needs to distinguish. With findings it exits with 1, just
  like `panoma md check`: they are facts, not tastes, and a fact can break a pipe without anyone
  feeling judged.
  And it is also said what this command **cannot** do. The other half of the review—whether it is
  nice, whether it is consistent with the rest of the catalog—requires judgment, and promising it
  from here would be selling what does not exist.
 */

/**
 * How many rows are shown per class before counting the rest.
 *
 * Twelve appear on the screen along with their header and leave space for another class
 * underneath. Those that do not fit are counted in one line, which is the same as what `twin mine`
 * does with its samples: the number indicates the size of the problem and the first twelve
 * indicate its shape, which is what is needed to decide whether to fix it now or open the file.
 */
const ROWS_SHOWN = 12;

/** The titles of each group. In the same order in which the engine arranges them. */
const GROUP_LABELS: Record<CriticKind, MessageKey> = {
  "color-drift": "review.groupColor",
  "radius-drift": "review.groupRadius",
  "image-no-alt": "review.groupImage",
  "broken-link": "review.groupLink",
};

export async function reviewCommand(target: string): Promise<number> {
  /*
    The engine loads in here and not above, as in `twin-command.ts`: its types are erased when
    compiling, so the painters below can be tested without having `@panoma/core` rebuilt with the
    critic inside.
   */
  const { buildFileIndex, readDesign, reviewProject } = await import("@panoma/core");

  process.stderr.write(pc.dim(`${say("review.checking")}\n`));

  const index = await buildFileIndex(target);
  const design = await readDesign(index);
  const report = await reviewProject(index, design);

  process.stdout.write(`${reviewLines(report).join("\n")}\n`);
  return report.findings.length > 0 ? 1 : 0;
}

/** Distribute the findings by class while keeping the order in which they arrive. */
export function groupByKind(findings: CriticFinding[]): Map<CriticKind, CriticFinding[]> {
  const groups = new Map<CriticKind, CriticFinding[]>();
  for (const finding of findings) {
    const group = groups.get(finding.kind) ?? [];
    group.push(finding);
    groups.set(finding.kind, group);
  }
  return groups;
}

/**
 * Why is it wrong, written here and not in the engine.
 *
 * The finding travels neutral —class, statement, and clue— and the sentence puts each surface in
 * its language. It is the contract of `AgentsMdFinding`, and the reason the engine does not know
 * how to say 'does not exist' in two languages.
 */
export function reasonOf(finding: CriticFinding): string {
  if (finding.kind === "color-drift") {
    return say("review.colorDrift", { hint: finding.hint ?? "?" });
  }
  if (finding.kind === "radius-drift") {
    return say("review.radiusDrift", { hint: finding.hint ?? "?" });
  }
  if (finding.kind === "image-no-alt") return say("review.imageNoAlt");
  return finding.hint
    ? say("review.linkMoved", { path: finding.hint })
    : say("review.linkMissing");
}

/** A line: where it was, what is claimed, and why it is wrong. */
export function findingRow(finding: CriticFinding): string {
  const reason = reasonOf(finding);
  const claim = finding.claim;

  // The file and the line are only written if they are known. A radio does not have either of them
  // — the design footprint does not record where each one came from — and a color has a file but
  // not a line; putting a `?` in its place would be pretending it is known.
  if (finding.file) {
    const place = finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
    return say("review.row", { place: pc.dim(place), claim, reason });
  }
  return say("review.rowBare", { claim, reason });
}

/** The entire report, in lines: what is written with findings and what is written without. */
export function reviewLines(report: CriticReport): string[] {
  const files = report.sourcesRead;
  const lines: string[] = [""];

  if (report.findings.length === 0) {
    lines.push(
      `  ${pc.green(say("review.clean", { files, s: plural(files) }))}`,
      `  ${pc.dim(say("review.cleanHint"))}`,
    );
    /*
      With the short walk, 'there is nothing' is 'we haven't seen anything': if it were not said
      here, the partial silence would be read as a complete pass.
     */
    if (report.truncated) lines.push("", `  ${pc.yellow(say("review.truncated"))}`);
    return [...lines, ""];
  }

  const total = report.findings.length;
  lines.push(
    `  ${pc.bold(say("review.title"))}`,
    `  ${pc.red(
      total === 1
        ? say("review.countOne", { files, s: plural(files) })
        : say("review.count", { n: total, files, s: plural(files) }),
    )}`,
    "",
  );

  for (const [kind, findings] of groupByKind(report.findings)) {
    lines.push(`  ${pc.bold(say(GROUP_LABELS[kind]))}`);
    for (const finding of findings.slice(0, ROWS_SHOWN)) {
      lines.push(`      ${findingRow(finding)}`);
    }
    const rest = findings.length - ROWS_SHOWN;
    if (rest > 0) lines.push(`      ${pc.dim(say("review.more", { n: rest }))}`);
    lines.push("");
  }

  if (report.truncated) lines.push(`  ${pc.yellow(say("review.truncated"))}`, "");

  lines.push(`  ${pc.dim(say("review.next"))}`, "");
  return lines;
}
