import pc from "picocolors";
import { plural, riskText, say, type MessageKey } from "./messages";
import { evidenceText, workRisks } from "@panoma/core";
import type { ProjectOrigin } from "@panoma/core";
import type { HealthScore, ProjectAnalysis, ProjectFamily, TechKind } from "@panoma/core";

const KIND_ORDER: TechKind[] = [
  "framework",
  "model",
  "language",
  "runtime",
  "platform",
  "database",
  "tool",
  "package-manager",
];

const KIND_LABELS: Record<TechKind, MessageKey> = {
  framework: "kind.framework",
  model: "kind.model",
  language: "kind.language",
  runtime: "kind.runtime",
  platform: "kind.platform",
  database: "kind.database",
  tool: "kind.tool",
  "package-manager": "kind.package-manager",
};

export function gradeColor(grade: HealthScore["grade"]): (s: string) => string {
  if (grade === "A") return pc.green;
  if (grade === "B") return pc.greenBright;
  if (grade === "C") return pc.yellow;
  if (grade === "D") return pc.magenta;
  return pc.red;
}

const ORIGIN_LABEL: Record<string, MessageKey> = {
  own: "origin.own",
  forked: "origin.forked",
  foreign: "origin.foreign",
  template: "origin.template",
  "no-signals": "origin.no-signals",
};

/** Complete project record — the console equivalent of the detail view. */
export function renderProject(
  analysis: ProjectAnalysis,
  options: { verbose: boolean; origin?: ProjectOrigin },
): string {
  const lines: string[] = [];
  const color = gradeColor(analysis.health.grade);

  lines.push("");
  lines.push(
    `${pc.bold(pc.cyan(analysis.name))}${analysis.version ? pc.dim(` v${analysis.version}`) : ""}  ${color(
      pc.bold(`${analysis.health.grade} ${analysis.health.score}/100`),
    )}`,
  );
  lines.push(pc.dim(`  ${analysis.root}`));
  // The summary and not the description of the manifest: that can be template text.
  lines.push(pc.dim(`  ${truncate(analysis.summary.text, 100)}`));
  lines.push("");

  // ── Technology Stack ────────────────────────────────────────────────────────
  const byKind = new Map<TechKind, string[]>();
  for (const tech of analysis.technologies) {
    const label = tech.version ? `${tech.name} ${pc.dim(tech.version)}` : tech.name;
    const suffix = tech.confidence < 0.75 ? pc.dim("?") : "";
    byKind.set(tech.kind, [...(byKind.get(tech.kind) ?? []), label + suffix]);
  }

  for (const kind of KIND_ORDER) {
    const items = byKind.get(kind);
    if (!items?.length) continue;
    lines.push(`  ${pc.bold(say(KIND_LABELS[kind]).padEnd(20))}${items.join(pc.dim(" · "))}`);
  }

  if (analysis.languages.length > 0) {
    const top = analysis.languages
      .slice(0, 5)
      .map((l) => `${l.name} ${pc.dim(`${Math.round(l.share * 100)}%`)}`)
      .join(pc.dim(" · "));
    lines.push(`  ${pc.bold(say("card.code").padEnd(20))}${top}`);
  }

  // ── Dependencias ────────────────────────────────────────────────────────────
  lines.push("");
  for (const report of analysis.ecosystems) {
    const direct = report.dependencies.filter((d) => !d.isDev).length;
    const dev = report.dependencies.filter((d) => d.isDev).length;
    const lock = report.lockfilePath
      ? report.lockUnresolved
        ? pc.yellow(say("card.lockUnresolved", { path: report.lockfilePath }))
        : pc.green(report.lockfilePath)
      : pc.red(say("card.noLockfile"));

    lines.push(
      `  ${pc.bold(report.ecosystem.padEnd(10))}${pc.dim((report.packageManager ?? "—").padEnd(9))}` +
        `${direct} deps + ${dev} dev  ${pc.dim("·")}  ${lock}`,
    );

    if (options.verbose) {
      for (const dep of report.dependencies.filter((d) => !d.isDev).slice(0, 40)) {
        const resolved = dep.resolvedVersion
          ? pc.green(dep.resolvedVersion)
          : pc.dim(dep.constraint);
        const source = dep.source ? pc.yellow(` [${dep.source}]`) : "";
        lines.push(`      ${dep.name.padEnd(38)} ${resolved}${source}`);
      }
    }
  }

  // ── Distribution ────────────────────────────────────────────────────────────
  if (analysis.distributions.length > 0) {
    lines.push("");
    lines.push(
      `  ${pc.bold(say("card.distribution").padEnd(20))}${analysis.distributions
        .map((d) => d.label)
        .join(pc.dim(" · "))}`,
    );
  }

  // ── Git y agentes ───────────────────────────────────────────────────────────
  if (analysis.git) {
    const { branch, lastCommitAt, commitCount, agentContributors } = analysis.git;
    const parts = [
      branch,
      commitCount !== undefined ? `${commitCount} commit${plural(commitCount)}` : undefined,
      lastCommitAt ? relativeDate(lastCommitAt) : undefined,
    ].filter(Boolean);
    // A newly initialized repo with no commits has nothing to tell.
    if (parts.length > 0) {
      lines.push(`  ${pc.bold(say("card.git").padEnd(20))}${pc.dim(parts.join(" · "))}`);
    }

    if (agentContributors.length > 0) {
      lines.push(
        `  ${pc.bold(say("card.agents").padEnd(20))}${agentContributors
          .map((a) => `${pc.magenta(a.name)} ${pc.dim(`${a.commits} commit${plural(a.commits)}`)}`)
          .join(pc.dim(" · "))}`,
      );
    }
  }

  // What can be lost comes with its color, not in gray: it is the only thing on this card that
  // requires doing something today. And it goes **outside** the git block: the greater risk —a
  // folder without a repository— is precisely the case in which there is no git block to show.
  const risks = workRisks({
    versioned: analysis.versioned,
    remoteUrl: analysis.git?.remoteUrl,
    commitCount: analysis.git?.commitCount,
    work: analysis.git?.work,
  });
  if (risks.length > 0) {
    const tone = { high: pc.red, medium: pc.yellow, low: pc.dim } as const;
    lines.push(
      `  ${pc.bold(say("card.risks").padEnd(20))}${risks
        .map((risk) => tone[risk.level](riskText(risk)))
        .join(pc.dim(" · "))}`,
    );
  }

  // ── How it is resumed ──────────────────────────────────────────────────────────
  const { commands, runtimes, missingEnv, envExample } = analysis.runbook;
  if (commands.length > 0) {
    lines.push(
      `  ${pc.bold(say("card.run").padEnd(20))}${commands
        .map((c) => `${pc.dim(`${c.purpose}:`)} ${pc.cyan(c.command)}`)
        .join(pc.dim("  ·  "))}`,
    );
  }
  if (runtimes.length > 0) {
    lines.push(
      `  ${pc.bold(say("card.needs").padEnd(20))}${runtimes
        .map((r) => `${r.name} ${pc.dim(r.required)}`)
        .join(pc.dim(" · "))}`,
    );
  }
  if (missingEnv.length > 0) {
    lines.push(
      `  ${pc.bold(say("card.env").padEnd(20))}${pc.yellow(
        say("card.envMissing", { file: envExample ?? ".env.example", n: missingEnv.length }),
      )} ${pc.dim(missingEnv.slice(0, 4).join(", "))}${missingEnv.length > 4 ? pc.dim("…") : ""}`,
    );
  }

  if (options.origin) {
    const { kind, evidence } = options.origin;
    const color = kind === "own" ? pc.green : kind === "no-signals" ? pc.dim : pc.cyan;
    lines.push(`  ${pc.bold(say("card.origin").padEnd(20))}${color(ORIGIN_LABEL[kind] ? say(ORIGIN_LABEL[kind]) : kind)}`);
    // The reasons below and always: for almost everyone the verdict is 'own', and without them it
    // is indistinguishable from a default value.
    /*
      The reasons come from the engine as codes and are written here in English, which is what
      this terminal speaks. Before, they already arrived written in Spanish, under a verdict that
      was indeed translated: half the card in one language and half in another.
     */
    for (const reason of evidence) {
      lines.push(pc.dim(`  ${" ".repeat(20)}· ${evidenceText(reason)}`));
    }
  }

  if (analysis.iconPath) {
    lines.push(`  ${pc.bold(say("card.icon").padEnd(20))}${pc.dim(analysis.iconPath)}`);
  }

  // ── Salud ───────────────────────────────────────────────────────────────────
  if (options.verbose) {
    lines.push("");
    lines.push(`  ${pc.bold(say("card.health"))}`);
    for (const signal of analysis.health.signals) {
      const ratio = signal.max === 0 ? 0 : signal.points / signal.max;
      const mark = ratio >= 0.8 ? pc.green("●") : ratio >= 0.4 ? pc.yellow("●") : pc.red("●");
      lines.push(
        `      ${mark} ${signal.label.padEnd(24)} ${String(signal.points).padStart(2)}/${signal.max}  ${pc.dim(signal.detail)}`,
      );
    }
    if (analysis.health.skipped.length > 0) {
      lines.push(
        pc.dim(`      ○ omitidas (requieren red): ${analysis.health.skipped.join(", ")}`),
      );
    }
  }

  /*
    By the dictionary, like its neighbors: it was the only line of the card written by hand, so
    with the CLI in English the card closed in Spanish. And with the number after the word, which
    to inflect together with a figure is the mistake that is only seen with n = 1.
   */
  lines.push(
    pc.dim(
      `  ${say("card.analyzed", { files: analysis.stats.files, ms: analysis.stats.durationMs })}` +
        (analysis.stats.truncated ? say("card.truncated") : ""),
    ),
  );

  return lines.join("\n");
}

/** Grid view: the console equivalent of the App Store grid. */
export function renderGrid(analyses: ProjectAnalysis[], baseDir?: string): string {
  const lines: string[] = [""];
  const nameWidth = Math.min(28, Math.max(12, ...analyses.map((a) => a.name.length)));

  // With copies of the same project in several folders, the name alone doesn't distinguish
  // anything.
  const nameCounts = new Map<string, number>();
  for (const analysis of analyses) {
    nameCounts.set(analysis.name, (nameCounts.get(analysis.name) ?? 0) + 1);
  }

  for (const analysis of analyses) {
    const color = gradeColor(analysis.health.grade);
    const stack = analysis.technologies
      .filter((t) => t.kind === "framework" || t.kind === "language")
      .slice(0, 4)
      .map((t) => t.name)
      .join(", ");

    const agents = analysis.git?.agentContributors ?? [];
    const agentTag = agents.length > 0 ? pc.magenta(` ⚡${agents.map((a) => a.name).join("/")}`) : "";

    const duplicated = (nameCounts.get(analysis.name) ?? 0) > 1;
    const where = duplicated ? pc.dim(`  ${relativePath(analysis.root, baseDir)}`) : "";

    lines.push(
      `  ${color(analysis.health.grade)} ${pc.dim(String(analysis.health.score).padStart(3))}  ` +
        `${pc.bold(truncate(analysis.name, nameWidth).padEnd(nameWidth))}  ` +
        `${pc.cyan(truncate(stack || "—", 40).padEnd(40))}${agentTag}${where}`,
    );
  }

  return lines.join("\n");
}

/**
 * Copies of families.
 *
 * The tone matters: this does not accuse anyone or propose to erase anything. It says what the
 * living version is and leaves the decision to the user.
 */
export function renderFamilies(families: ProjectFamily[], baseDir?: string): string {
  if (families.length === 0) return "";

  const totalCopies = families.reduce((sum, f) => sum + f.copies.length, 0);
  const totalBytes = families.reduce((sum, f) => sum + f.redundantBytes, 0);

  const lines = [
    "",
    pc.bold(
      `  ${say("families.detected")}  ${pc.dim(
        say("families.summary", {
          families: families.length,
          fs: plural(families.length, "ies", "y"),
          folders: totalCopies,
          ds: plural(totalCopies),
          size: formatBytes(totalBytes),
        }),
      )}`,
    ),
    "",
  ];

  for (const family of families) {
    const copies = family.copies.length;
    lines.push(
      `  ${pc.bold(pc.cyan(family.name))} ${pc.dim(say("card.copies", { n: copies, ies: plural(copies, "ies", "y") }))}`,
    );
    lines.push(
      `    ${pc.green(say("families.alive"))}   ${relativePath(family.canonical.root, baseDir).padEnd(48)} ${pc.dim(family.canonicalReason)}`,
    );

    for (const copy of family.copies) {
      const behind =
        copy.daysBehind === undefined
          ? pc.dim(say("families.noGit"))
          : copy.daysBehind === 0
            ? pc.dim(say("families.sameDate"))
            : pc.yellow(say("families.daysBehind", { n: copy.daysBehind }));
      lines.push(
        `    ${pc.dim(say("families.copy"))}  ${pc.dim(relativePath(copy.analysis.root, baseDir).padEnd(48))} ${behind}  ${pc.dim(`${Math.round(copy.confidence * 100)}% · ${copy.reason}`)}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function relativePath(root: string, baseDir?: string): string {
  const trimmed = baseDir && root.startsWith(baseDir) ? root.slice(baseDir.length + 1) : root;
  // Only the context matters, not the full path: the last two folders are enough.
  const parts = trimmed.split("/");
  return parts.length <= 2 ? trimmed : `…/${parts.slice(-2).join("/")}`;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * "three days ago," in the language in which it is being read.
 *
 * The five keys had existed since the record was translated —`card.today`, `card.yesterday`,
 * `card.daysAgo` …— and this function kept returning fixed Spanish, so the git line of each
 * project came out half in Spanish.
 */
function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return say("card.today");
  if (days === 1) return say("card.yesterday");
  if (days < 30) return say("card.daysAgo", { n: days, s: plural(days) });
  const months = Math.floor(days / 30);
  if (days < 365) return say("card.monthsAgo", { n: months, s: plural(months) });
  const years = Math.floor(days / 365);
  return say("card.yearsAgo", { n: years, s: plural(years) });
}
