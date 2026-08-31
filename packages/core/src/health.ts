import type {
  EcosystemReport,
  FileIndex,
  GitInfo,
  HealthScore,
  HealthSignal,
} from "./types";
import { readTextAt } from "./fs-utils";

const CI_FILES = [
  /^\.github\/workflows\/.+\.ya?ml$/,
  /^\.gitlab-ci\.yml$/,
  /^\.circleci\/config\.yml$/,
  /^azure-pipelines\.yml$/,
  /^Jenkinsfile$/,
  /^\.travis\.yml$/,
  /^bitbucket-pipelines\.yml$/,
];

const TEST_PATTERNS = [
  /(^|\/)(test|tests|__tests__|spec)\//,
  /\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/,
  /_test\.(go|dart|py)$/,
  /(^|\/)test_[^/]+\.py$/,
];

const LICENSE_PATTERN = /^(LICENSE|LICENCE|COPYING)(\.(md|txt))?$/i;

/**
 * Health score 0-100.
 *
 * The two most important indicators of the plan — % of up-to-date dependencies and vulnerabilities
 * — require a network, so here they are marked as omitted and the rest is **normalized over the
 * maximum available**. This way, a healthy project does not appear failing just because the scan
 * was local. When Phase 2 adds log and OSV data, they come in without affecting the rest.
 */
export async function computeHealth(
  index: FileIndex,
  ecosystems: EcosystemReport[],
  git: GitInfo | undefined,
): Promise<HealthScore> {
  const signals: HealthSignal[] = [];
  const skipped = ["dependencias-al-dia", "vulnerabilidades"];

  // ── Frescura ────────────────────────────────────────────────────────────────
  if (git?.lastCommitAt) {
    const days = Math.floor((Date.now() - Date.parse(git.lastCommitAt)) / 86_400_000);
    // Logarithmic decay: 0-30 days is worth almost everything, one year is worth little, never
    // negative.
    const points = Math.max(0, Math.round(20 * (1 - Math.log10(Math.max(days, 1) + 1) / 3)));
    signals.push({
      id: "frescura",
      label: "Actividad reciente",
      points,
      max: 20,
      detail: days === 0 ? "último commit hoy" : `último commit hace ${days} días`,
    });
  }

  // ── Lockfile ────────────────────────────────────────────────────────────────
  if (ecosystems.length > 0) {
    const withLock = ecosystems.filter((e) => e.lockfilePath).length;
    signals.push({
      id: "lockfile",
      label: "Builds reproducibles",
      points: Math.round((withLock / ecosystems.length) * 15),
      max: 15,
      detail:
        withLock === ecosystems.length
          ? "todos los manifiestos tienen lockfile"
          : `${withLock}/${ecosystems.length} manifiestos con lockfile`,
    });
  }

  // ── CI ──────────────────────────────────────────────────────────────────────
  const ciFile = index.files.find((path) => CI_FILES.some((pattern) => pattern.test(path)));
  signals.push({
    id: "ci",
    label: "Integración continua",
    points: ciFile ? 15 : 0,
    max: 15,
    detail: ciFile ?? "sin CI configurada",
  });

  // ── Tests ───────────────────────────────────────────────────────────────────
  const testFiles = index.files.filter((path) =>
    TEST_PATTERNS.some((pattern) => pattern.test(path)),
  );
  signals.push({
    id: "tests",
    label: "Tests",
    points: testFiles.length === 0 ? 0 : testFiles.length < 3 ? 8 : 15,
    max: 15,
    detail: testFiles.length === 0 ? "no se encontraron tests" : `${testFiles.length} ficheros de test`,
  });

  // ── README ──────────────────────────────────────────────────────────────────
  const readmePath = index.files.find((path) => /^readme(\.(md|rst|txt))?$/i.test(path));
  const readme = readmePath ? await readTextAt(index.root, readmePath) : undefined;
  const readmeLength = readme?.trim().length ?? 0;
  signals.push({
    id: "readme",
    label: "Documentación",
    points: readmeLength >= 400 ? 10 : readmeLength >= 100 ? 5 : 0,
    max: 10,
    detail:
      readmeLength === 0
        ? "sin README"
        : readmeLength < 400
          ? "README muy corto"
          : `README de ${readmeLength} caracteres`,
  });

  // ── Licencia ────────────────────────────────────────────────────────────────
  const licenseFile = index.files.find((path) => LICENSE_PATTERN.test(path));
  signals.push({
    id: "licencia",
    label: "Licencia",
    points: licenseFile ? 5 : 0,
    max: 5,
    detail: licenseFile ?? "sin fichero de licencia",
  });

  const earned = signals.reduce((sum, s) => sum + s.points, 0);
  const available = signals.reduce((sum, s) => sum + s.max, 0);
  const score = available === 0 ? 0 : Math.round((earned / available) * 100);

  return { score, grade: toGrade(score), signals, skipped };
}

/**
 * Add to a score the two signals that need a network.
 *
 * It is applied *on top* of the motor's result instead of inside, so as not to break the rule that
 * the motor does not grade. The omitted signals stop being omitted and the scoring is renormalized
 * over the new maximum: a project does not lose points simply because we now know more about it,
 * only for what that knowledge reveals.
 */
export function applyEnrichment(
  base: HealthScore,
  input: { directDeps: number; outdatedDeps: number; vulnCount: number; vulnCritical: number },
): HealthScore {
  // We removed previous versions of these signals so that re-enriching is idempotent.
  const signals = base.signals.filter(
    (signal) => signal.id !== "dependencias-al-dia" && signal.id !== "vulnerabilidades",
  );

  if (input.directDeps > 0) {
    /*
      `outdatedDeps` limited to `directDeps`.
      Today, whoever calls guarantees that one is a subset of the other — `refresh.ts` counts the
      overdue ones within the comparable direct ones — but that is an agreement between two
      modules, not something this function can check. Without the cap, `outdated > direct` gives a
      negative ratio and the grade goes to −22,661: not a strange datum, an impossible number
      stored in the catalog quite naturally. It was found by the first invariants test written for
      this file.
      The vulnerability signal, two blocks further down, was already bracketed with
      `Math.max(0,…)`. This one was left unbracketed, which is exactly how these flaws survive.
     */
    const outdated = Math.min(Math.max(0, input.outdatedDeps), input.directDeps);
    const upToDate = input.directDeps - outdated;
    signals.push({
      id: "dependencias-al-dia",
      label: "Dependencias al día",
      points: Math.round(25 * (upToDate / input.directDeps)),
      max: 25,
      detail: `${upToDate} de ${input.directDeps} en su última versión`,
    });
  }

  // A serious vulnerability weighs much more than several minor ones: ten points each, three for
  // the others. With two serious ones, the signal is already at zero.
  const penalty = input.vulnCritical * 10 + (input.vulnCount - input.vulnCritical) * 3;
  signals.push({
    id: "vulnerabilidades",
    label: "Vulnerabilidades",
    points: Math.max(0, 25 - penalty),
    max: 25,
    detail:
      input.vulnCount === 0
        ? "ninguna conocida"
        : `${input.vulnCount} avisos (${input.vulnCritical} de gravedad alta o crítica)`,
  });

  const earned = signals.reduce((sum, signal) => sum + signal.points, 0);
  const available = signals.reduce((sum, signal) => sum + signal.max, 0);
  const score = available === 0 ? 0 : Math.round((earned / available) * 100);

  return { score, grade: toGrade(score), signals, skipped: [] };
}

function toGrade(score: number): HealthScore["grade"] {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}
