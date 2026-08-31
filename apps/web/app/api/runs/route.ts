import { revalidatePath } from "next/cache";
import {
  createRun,
  findKnownFailure,
  findRunningRun,
  findUpgradeTarget,
  finishRun,
  listSecurityTargets,
  reapStaleRuns,
  resolveProject,
} from "@panoma/db";
import { checkQuarantine, compareSeverity, quarantineDecision } from "@panoma/enrich";
import { runDependencyBump } from "@panoma/runner";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/**
 * Dispatches an execution.
 *
 * Two recipes, both limited and verifiable by the project's own tests:
 *
 * - `bump-dependencia` — uploads a package to its latest published version.
 * - `arreglo-vulnerabilidad` — upgrade to the version that **the OSV notice declares as fixed**,
 * which is almost always much closer to the current one. Upgrading three major versions to cover a
 * security flaw is replacing one problem with another.
 *
 * The work is done here, synchronously. In production, this goes into a queue (Inngest,
 * Trigger.dev) because installing and testing takes minutes; locally, waiting is simpler.
 */
export async function POST(request: Request) {
  /*
    And only from this machine, even if the network key is brought.
    Proposing an update is to install the package and run the project's test suite, with the
    `postinstall` that comes with whatever is installed. That means running third-party code on
    the computer of the person who has the catalog, and it cannot depend on a link that travels
    via WhatsApp. The doctrine is written in `lib/guard.ts`: the key allows you to look, not hands
    on the keyboard.
   */
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  const body = (await request.json().catch(() => ({}))) as {
    slug?: string;
    cwd?: string;
    packageName?: string;
    targetVersion?: string;
    requestedBy?: string;
    /** Choose the target based on a vulnerability instead of the latest version. */
    security?: boolean;
    /** Retry even if this same upload has failed before. */
    force?: boolean;
    /** local · hardened · container. Por defecto hardened. */
    isolation?: "local" | "hardened" | "container";
  };

  const { db: database } = await db();

  // Before deciding anything: close the ones that were left hanging. If not, a dead execution from
  // weeks ago will block this project forever because of the guard below.
  await reapStaleRuns(database);

  const project = await resolveProject(database, body);
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  /*
    A live execution per project.
    Two at once on the same repository fight over the worktree: `createWorktree` deletes the
    `panoma/…` branch before creating it, so the second one takes the branch from the first and
    both end up with a result that is not theirs.
   */
  const running = await findRunningRun(database, project.id);
  if (running) {
    return Response.json(
      {
        error: t(locale, "runs.alreadyRunning", { name: project.name }),
        runId: running.id,
        hint: t(locale, "runs.alreadyRunningHint"),
      },
      { status: 409 },
    );
  }

  let packageName = body.packageName;
  let targetVersion = body.targetVersion;
  let ecosystem: string | undefined;
  let kind = "dependency-bump";
  let advisoryId: string | undefined;

  if (body.security) {
    const targets = await listSecurityTargets(database, project.id);
    const candidates = packageName
      ? targets.filter((entry) => entry.packageName === packageName)
      : targets;

    if (candidates.length === 0) {
      return Response.json(
        {
          error: packageName
            ? t(locale, "runs.noFixForPackage", { package: packageName, name: project.name })
            : t(locale, "runs.noFixes", { name: project.name }),
          hint: t(locale, "runs.enrichAdvisories"),
        },
        { status: 400 },
      );
    }

    /*
      The most serious first: one pending criticism weighs more than five minor ones.
      The order is placed by `compareSeverity`, who lives with the normalizer that writes these
      gravities in the database. Here there was a handwritten and half-translated map —`{ crítica:
      0, high: 1, media: 2, low: 3 }`— that didn't match what was stored: `critical` and `medium`
      didn't appear, they fell to the bottom, and the safety mode suggested fixing the **low**
      vulnerability by leaving the critique open.
     */
    candidates.sort((a, b) => compareSeverity(a.severity, b.severity));
    const pick = candidates[0]!;

    packageName = pick.packageName;
    targetVersion = pick.fixedVersion;
    ecosystem = pick.ecosystem;
    kind = "vulnerability-fix";
    advisoryId = pick.advisoryId;
  } else {
    if (!packageName) {
      return Response.json({ error: t(locale, "runs.missingPackage") }, { status: 400 });
    }

    const target = await findUpgradeTarget(database, project.id, packageName);
    if (!target) {
      return Response.json(
        {
          error: t(locale, "runs.notADependency", {
            package: packageName,
            name: project.name,
          }),
          hint: t(locale, "runs.enrichVersions"),
        },
        { status: 400 },
      );
    }
    targetVersion ??= target.latestVersion;
    ecosystem = target.ecosystem;
  }

  if (ecosystem !== "npm" && ecosystem !== "pub") {
    return Response.json(
      { error: t(locale, "runs.unsupportedEcosystem", { ecosystem }) },
      { status: 400 },
    );
  }

  // A previous failure with the same target already told us that this is not possible. Repeating it
  // costs an installation and a batch of tests to arrive at the same conclusion.
  if (!body.force) {
    const known = await findKnownFailure(database, project.id, packageName!, targetVersion!);
    if (known) {
      return Response.json(
        {
          skipped: true,
          knownFailure: {
            runId: known.id,
            summary: known.summary,
            at: known.createdAt,
          },
          hint: t(locale, "runs.knownFailureHint"),
        },
        { status: 409 },
      );
    }
  }

  /*
    Quarantine.
    A version published twenty minutes ago hasn't been seen by anyone yet. The npm packages that
    have caused damage —event-stream, ua-parser-js, node-ipc, the batch from September 2025— were
    removed within hours or a few days, so waiting three almost always turns the problem into
    someone else's.
    With `--security` the scale is reversed and that is why it does not lock: the version is named
    in a public notice *as the fix*, and leaving a known vulnerability open out of caution for a
    hypothetical situation is changing a certain risk for a speculative one. It is notified, and
    the notice is recorded in the execution record.
   */
  const quarantine = await checkQuarantine(ecosystem, packageName!, targetVersion!);
  const decision = quarantineDecision(quarantine, { security: body.security, force: body.force });

  if (decision.action === "bloquear") {
    return Response.json(
      {
        error: t(locale, "runs.quarantined", {
          package: packageName!,
          version: targetVersion!,
          age: decision.age ?? "",
          days: quarantine.days,
        }),
        hint: t(locale, "runs.quarantinedHint"),
        quarantine: { publishedAt: quarantine.publishedAt, days: quarantine.days },
      },
      { status: 409 },
    );
  }
  const quarantineNote = decision.action === "avisar" ? decision.note : undefined;

  const runId = await createRun(database, {
    projectId: project.id,
    kind,
    target: { packageName, targetVersion, ecosystem, advisoryId },
    requestedBy: body.requestedBy ?? "human",
  });

  /*
    Whatever happens, the execution closes.
    Without this `catch`, an exception — a choking git, the disk full, an executor failure — would
    leave the queue in 'running' forever: no one would touch it again. In the list, it appeared as
    if it were still working, the upper-level guard blocked the entire project, and
    `findKnownFailure` didn't see it, so the same proposal would be relaunched.
   */
  let outcome: Awaited<ReturnType<typeof runDependencyBump>>;
  try {
    outcome = await runDependencyBump({
      projectRoot: project.root,
      projectName: project.name,
      ecosystem,
      packageName: packageName!,
      targetVersion: targetVersion!,
      isolation: body.isolation,
    });
  } catch (error) {
    await finishRun(database, runId, {
      status: "failed",
      /*
        In Spanish on purpose, and different from the `error` in the answer below. This text is
        stored in the row, so the language at the moment it was written is frozen: there is no way
        for it to follow the reader. The hundreds of summaries that already exist are in Spanish,
        and translating stored prose is not a mechanical migration; a half-and-half database reads
        worse than one entirely in one language. What the user sees right now is the `error`, and
        that one does go by the dictionary.
       */
      summary: `La ejecución se rompió: ${(error as Error).message}`,
      verified: false,
      isolation: body.isolation ?? "hardened",
      steps: [],
    });
    revalidatePath("/runs");
    return Response.json(
      { runId, error: t(locale, "runs.crashed", { detail: (error as Error).message }) },
      { status: 500 },
    );
  }

  const isolationNote = [outcome.isolationNote, quarantineNote].filter(Boolean).join(". Además, ");

  await finishRun(database, runId, {
    status: outcome.status,
    summary: outcome.summary,
    verified: outcome.verified,
    isolation: outcome.isolation,
    isolationNote: isolationNote || undefined,
    branch: outcome.branch,
    patch: outcome.patch,
    commitSha: outcome.commitSha,
    steps: outcome.steps,
  });

  revalidatePath(`/p/${project.slug}`);
  revalidatePath("/runs");

  return Response.json({
    runId,
    project: project.slug,
    kind,
    advisoryId,
    ...outcome,
    isolationNote: isolationNote || undefined,
  });
}

// Installing and testing may take several minutes.
export const maxDuration = 900;
