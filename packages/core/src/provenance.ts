import { userInfo } from "node:os";
import { basename } from "node:path";
import type { FileIndex, GitInfo, ProjectAnalysis } from "./types";
import { readJsonAt, readTextAt, readYamlAt } from "./fs-utils";
import { fold } from "./fold";

/**
 * Where a project came from: did you write it, clone it, or did a template generate it.
 *
 * The question seems simple and has a trap: the correct answer for almost everyone is 'it's mine,'
 * and a detector that responds 'it's mine' is always indistinguishable from one that does nothing.
 * That is why what is stored is not a verdict but **the reasons**: who made the first commit,
 * which part of the history is yours, whose remote account it is, what the license says. With
 * that, 'own' means something, and the day you clone someone else's repository, the change is
 * noticeable without having to rely on anyone.
 *
 * The user's identity is not asked: it is inferred from the portfolio itself. The email with which
 * they sign most of the repositories and the owner of most of the remotes *is you*, by definition.
 * It is an inference that only a catalog can make, because it needs to see all eighty projects at
 * once.
 */

/** Raw facts. The engine collects them; who 'you' is is decided further up. */
export interface Provenance {
  /** The folder name ends in `-main` or `-master`: that's how GitHub calls its ZIPs. */
  zipSuffix?: string;
  /** Copyright holder declared in LICENSE. */
  licenseHolder?: string;
  /** Repository declared in manifest (`repository`, `homepage`). */
  declaredRepo?: string;
  /** Author declared in the manifest. */
  declaredAuthor?: string;
  /** Generator that wrote the first commit, if recognized. */
  scaffold?: string;
  /** The project lives within a larger repository: the history is not just its own. */
  insideLargerRepo?: boolean;
  /**
   * The README is presented as material from another: a tutorial, a template, an example.
   *
   * It is the only sign left when someone downloads a repository and deletes the `.git` —or
   * downloads the ZIP, which is the same—, and there is no history, no remote, no license to look
   * at. The literal phrase that exposes it is kept so that it can be checked at a glance instead
   * of just believing the label.
   */
  tutorialMarker?: string;
}

/**
 * Headlines that appear in a LICENSE and belong to no one.
 *
 * The text of the GPL, the AGPL, and the LGPL **carries its own copyright notice** on the fourth
 * line: «Copyright (C) 2007 Free Software Foundation, Inc.». It is from the license, not from the
 * project. And the Apache, the MPL, and the three from the GNU family include at the end an
 * appendix with the space to fill in —«Copyright [yyyy] [name of copyright owner]», «Copyright (C)
 * <year> <name of author>»— which also does not name anyone.
 *
 * Without this, the first line that said 'copyright' won, and **anyone who chose a license from
 * the GNU family was classified as having departed from the work of the Free Software
 * Foundation**. Panoma did this to itself: it is AGPL-3.0, it marked itself as a fork, appeared in
 * the 'not mine' filter, and the record said 'the git history starts with you, so it was reset
 * when copied' about a repository started from scratch.
 *
 * The price is that a project that is truly from the FSF will not be recognized for its license.
 * With the other indications —the remote, the first commit— there is still plenty, and the mistake
 * in that regard happens to one in many while the other happened to all.
 */
const LICENSE_BOILERPLATE: RegExp[] = [
  /free software foundation/i,
  /open source initiative/i,
  // The holes of the appendices, in the two forms in which they are written.
  /name of (?:the )?(?:author|copyright owner|owner)/i,
  /<year>|\[yyyy\]|\byyyy\b/i,
];

/**
 * The copyright holder who declares a LICENSE, if they declare one.
 *
 * All copyright lines are checked, not just the first one: a project with a GNU license can add
 * its own above the text, and with the first one always winning, it would get the notice of the
 * license itself. The first one that names a real person wins.
 */
const NOTICE = /^[ \t]*copyright\b[ \t]*(\(c\)|©)?[ \t]*(\d{4}(?:\s*[-–,]\s*\d{4})*)?[ \t]*(.+)$/gim;

function licenseHolderOf(license: string): string | undefined {
  // The HTML entities appear exactly as they are in the LICENSES that come from a website.
  const text = license.replace(/&copy;/gi, "©");

  for (const found of text.matchAll(NOTICE)) {
    /*
      A notice, not just the word. The body of the AGPL says «…assert copyright on the software,
      and (2) offer…» in the middle of a paragraph, and searching for «copyright» alone, the
      project title turned out to be «on the software, and (2) offer». A real notice starts a new
      line and includes a mark or year; without either, it is prose.
     */
    if (!found[1] && !found[2]) continue;
    const cleaned = found[3]
      ?.trim()
      // “All rights reserved” is the phrase that follows the holder, not part of it.
      .replace(/[.,]?\s*all rights reserved\.?$/i, "")
      // Email or the web between angles is about how to locate it, not what it is called.
      .replace(/\s*<[^>]*>\s*$/, "")
      .replace(/[.,]$/, "")
      .trim();
    if (!cleaned || cleaned.length <= 1 || cleaned.length >= 80) continue;
    if (/^all rights/i.test(cleaned)) continue;
    if (LICENSE_BOILERPLATE.some((pattern) => pattern.test(cleaned))) continue;
    return cleaned;
  }
  return undefined;
}

/**
 * Phrases with which a README presents itself as foreign material.
 *
 * They all describe the repository from the outside — 'this repository contains,' 'how to build' —
 * which is how someone writes when publishing an example for others to copy, and not how someone
 * writes when they are building their own product.
 */
const TUTORIAL_MARKERS: RegExp[] = [
  /this (?:repo|repository) (?:contains|is|shows|demonstrates)/i,
  /how to (?:build|create|make) (?:a|an|your)/i,
  /in this (?:tutorial|video|article|course)/i,
  /follow along with/i,
  /^\s*a (?:starter|boilerplate|template|sample|example|demo)\b/i,
  /(?:starter|boilerplate) (?:template|kit|project) for/i,
  /forked from/i,
];

export type OriginKind = "own" | "forked" | "foreign" | "template" | "no-signals";

/**
 * Every reason why this project was classified this way, as code and not as a phrase.
 *
 * The verdict —'own', 'bifurcated', 'other's'— was already in the dictionary, and these reasons
 * appeared below in fixed Spanish: half the screen translated and the other half not. It was seen
 * especially on the terminal, which speaks English, and on a sheet in English.
 *
 * And the reasons are the half that matters. For almost everyone, the verdict is 'own,' so without
 * them it is indistinguishable from a default value: what convinces that Panoma has truly looked
 * is reading 'the first commit is yours' and being able to check it.
 *
 * Each code carries at most one piece of information —an account, a name, a figure— and that is
 * why `value` is one and not an object: the sentence is formed by whoever has the dictionary.
 */
export const ORIGIN_EVIDENCE_CODES = [
  "remote-foreign",
  "first-commit-foreign",
  "license-foreign",
  "history-restarted",
  "your-share",
  "zip-suffix",
  "scaffold-first-commit",
  "only-commit",
  "commit-count",
  "container-yours",
  "first-commit-yours",
  "all-history-yours",
  "remote-yours",
  "scaffold-continued",
  "zip-suffix-own",
  "zip-suffix-none",
  "manifest-repo",
  "readme-foreign",
  "no-own-repo",
  "no-repo",
] as const;

export type OriginEvidenceCode = (typeof ORIGIN_EVIDENCE_CODES)[number];

export interface OriginEvidence {
  code: OriginEvidenceCode;
  /** The only gap in the sentence, when it has one: an account, a name, or a number. */
  value?: string | number;
}

/**
 * Every written test, in English.
 *
 * Same treatment and same reason as `composedText` in `summary.ts`: whoever reads this is a
 * machine or the terminal —the MCP server, the agent protocol and `panoma scan`, all three
 * monolingual—. The web does not go through here: it has the codes and its dictionary, and writes
 * the same sentence in the viewer's language.
 *
 * Being here and not in the CLI dictionary prevents the other possible error: twenty English
 * sentences written twice, which start the same and end up saying different things.
 */
const EVIDENCE_IN_ENGLISH: Record<OriginEvidenceCode, string> = {
  "remote-foreign": "the remote lives in {value}’s account, not yours",
  "first-commit-foreign": "the first commit was made by {value}",
  "license-foreign": "the licence belongs to {value}",
  "history-restarted": "the git history starts with you, so it was restarted when the folder was copied",
  "your-share": "{value}% of the history is yours",
  "zip-suffix": "the folder ends in “-{value}”, the way GitHub names its ZIPs",
  "scaffold-first-commit": "the first commit was written by {value}",
  "only-commit": "and it is the only one: nobody has touched it since",
  "commit-count": "and the history has {n} commit{s}",
  "container-yours": "you started the repository that contains it ({value})",
  "first-commit-yours": "the first commit is yours ({value})",
  "all-history-yours": "the whole history is yours ({n} commit{s})",
  "remote-yours": "the remote is in your account ({value})",
  "scaffold-continued": "it started from {value} and you carried it on",
  "zip-suffix-own": "the folder ends in “-{value}”, the way GitHub serves its ZIPs: it probably started as a download",
  "zip-suffix-none": "the folder ends in “-{value}”, which is how GitHub names a “Download ZIP”",
  "manifest-repo": "the manifest points at {value}",
  "readme-foreign": "the README introduces itself as somebody else’s material: “{value}”",
  "no-own-repo": "and there is no repository of its own where it could have started",
  "no-repo": "there is no repository: with no history there is no way to know who started it",
};

/** The test, with its hole filled in. `{s}` leaves the number, so that «1 commits» does not return. */
export function evidenceText(item: OriginEvidence): string {
  const template = EVIDENCE_IN_ENGLISH[item.code];
  if (!template) return "";
  const value = item.value ?? "";
  return template
    .replace(/\{value\}/g, String(value))
    .replace(/\{n\}/g, String(value))
    .replace(/\{s\}/g, value === 1 ? "" : "s");
}

export interface ProjectOrigin {
  kind: OriginKind;
  /** Proportion of the history written by you, 0..1. Absent if there is no history. */
  yourShare?: number;
  /** Who started it, when it wasn't you. */
  startedBy?: string;
  /** Each reason, in pieces that can be checked by hand and written in any language. */
  evidence: OriginEvidence[];
}

/**
 * Phrases with which the generators start.
 *
 * A template project is not alien —the code is yours as soon as you touch it— but it is also not
 * *yours yet*, and distinguishing that matters: `qrchat` has a commit, and that commit was written
 * by `create-next-app`.
 */
const SCAFFOLDS: { pattern: RegExp; name: string }[] = [
  { pattern: /from Create Next App/i, name: "create-next-app" },
  { pattern: /Initial commit from Create React App/i, name: "create-react-app" },
  { pattern: /^Initial commit$/i, name: "plantilla de GitHub" },
  { pattern: /generated by create-t3-app/i, name: "create-t3-app" },
  { pattern: /^init(ial)? (flutter )?(project|app)$/i, name: "template" },
  { pattern: /created with Expo/i, name: "create-expo-app" },
  { pattern: /bootstrapped with Vite/i, name: "create-vite" },
];

export async function readProvenance(
  index: FileIndex,
  git: GitInfo | undefined,
): Promise<Provenance> {
  const provenance: Provenance = {};

  // GitHub names `<repo>-<rama>` the ZIPs it serves in 'Download ZIP'. A `-main` at the end of a
  // folder is the trace of a download, even if you later made it yours.
  const folder = basename(index.root);
  const zip = /-(main|master|develop)$/.exec(folder);
  if (zip) provenance.zipSuffix = zip[1];

  const license = index.fileSet.has("LICENSE")
    ? await readTextAt(index.root, "LICENSE")
    : index.fileSet.has("LICENSE.md")
      ? await readTextAt(index.root, "LICENSE.md")
      : undefined;
  if (license) provenance.licenseHolder = licenseHolderOf(license);

  if (index.fileSet.has("package.json")) {
    const manifest = await readJsonAt<{
      repository?: string | { url?: string };
      homepage?: string;
      author?: string | { name?: string };
    }>(index.root, "package.json");
    const repository =
      typeof manifest?.repository === "string" ? manifest.repository : manifest?.repository?.url;
    provenance.declaredRepo = repository ?? manifest?.homepage;
    provenance.declaredAuthor =
      typeof manifest?.author === "string" ? manifest.author : manifest?.author?.name;
  } else if (index.fileSet.has("pubspec.yaml")) {
    const manifest = await readYamlAt<{ repository?: string; homepage?: string }>(
      index.root,
      "pubspec.yaml",
    );
    provenance.declaredRepo = manifest?.repository ?? manifest?.homepage;
  }

  const subject = git?.rootAuthor?.subject;
  if (subject) {
    provenance.scaffold = SCAFFOLDS.find(({ pattern }) => pattern.test(subject))?.name;
  }

  if (git?.repoRoot && git.repoRoot !== index.root) provenance.insideLargerRepo = true;

  const readme = index.fileSet.has("README.md")
    ? await readTextAt(index.root, "README.md")
    : undefined;
  if (readme) {
    // Just the beginning: further down, a README itself can explain 'how to build' something
    // without that saying anything about its origin.
    const opening = readme.slice(0, 1200);
    for (const pattern of TUTORIAL_MARKERS) {
      const match = pattern.exec(opening);
      if (!match) continue;
      const line = opening
        .slice(Math.max(0, match.index - 40), match.index + 120)
        .split("\n")
        .find((candidate) => pattern.test(candidate));
      provenance.tutorialMarker = (line ?? match[0]).trim().replace(/\s+/g, " ").slice(0, 140);
      break;
    }
  }

  return provenance;
}

/** Who you are, according to your own portfolio. */
export interface Identity {
  /** Emails with which you sign. The most used first. */
  emails: string[];
  /** Accounts of the platforms where you host: `jesus89x2` from `github.com/jesus89x2/…`. */
  handles: string[];
  /**
   * How you sign with letters: 'Jesus Castillo', not `jesus89x2` nor an email.
   *
   * It was missing, and that is why Panoma marked **its own repository** as foreign: its `LICENSE`
   * says «Copyright (c) 2026 Jesus Castillo» and the license check only knew how to compare
   * against the email and the GitHub account. Neither of the two looks like a name written as
   * names are written, so the own license seemed like someone else's.
   */
  names: string[];
}

/**
 * Deduce the identity of the owner of the catalog.
 *
 * It is neither asked nor configured. The email with which you sign most of the repositories and
 * the owner of most of the remotes is you: it is a tautology, and that is why it is reliable.
 * Agent emails are discarded because they sign *on your behalf* —a repository where Claude has
 * made a thousand commits is still yours.
 */
export function deduceIdentity(analyses: ProjectAnalysis[]): Identity {
  /** With the ones git is set up to sign. It is the strongest proof there is. */
  const configured = new Set<string>();
  const commits = new Map<string, number>();
  const handles = new Map<string, number>();
  /** Name with which they sign each email, with how many commits they back it up. */
  const names = new Map<string, Map<string, number>>();

  for (const analysis of analyses) {
    const git = analysis.git;
    if (!git) continue;

    if (git.identityEmail) configured.add(git.identityEmail);
    for (const author of git.authors) {
      if (isAgentEmail(author.email)) continue;
      commits.set(author.email, (commits.get(author.email) ?? 0) + author.commits);
      if (author.name.trim()) {
        const byEmail = names.get(author.email) ?? new Map<string, number>();
        byEmail.set(author.name.trim(), (byEmail.get(author.name.trim()) ?? 0) + author.commits);
        names.set(author.email, byEmail);
      }
    }

    const owner = ownerOf(git.remoteUrl);
    if (owner) handles.set(owner, (handles.get(owner) ?? 0) + 1);
  }

  /*
    A collaborator is not you.
    Claiming as your own **any** email that appears in the history caused `franciscotp90@`,
    `minusgat@`, and a couple more to be included in the identity. With that, a genuinely external
    repository in which you had made a commit would be considered yours: precisely the case this
    module exists to distinguish. It is required either to be configured as a signer in some
    repository, or to carry at least a tenth of the commits in the portfolio.
   */
  const busiest = Math.max(0, ...commits.values());
  const significant = [...commits.entries()]
    .filter(([email, count]) => configured.has(email) || count >= busiest * 0.1)
    .sort((a, b) => b[1] - a[1])
    .map(([email]) => email);

  const emails = [...new Set([...configured, ...significant])];

  /*
    The names come from the emails that have already been accepted as yours, not from the entire
    history: otherwise, any collaborator's name could sneak in the back door and make a repository
    that isn't yours appear as yours — exactly what this module prevents with the emails. Ordered
    by commits, which is what indicates which one you actually use.
   */
  const byName = new Map<string, number>();
  for (const email of emails) {
    for (const [name, howMany] of names.get(email) ?? []) {
      byName.set(name, (byName.get(name) ?? 0) + howMany);
    }
  }

  return {
    emails,
    handles: sortedKeys(handles),
    names: [...sortedKeys(byName), ...systemAccount()],
  };
}

/**
 * Classify each project against that identity.
 *
 * The order of the rules is that of the strength of the evidence: the license and the owner of the
 * remote are explicit statements; who made the first commit is a fact; the name of the folder is
 * an indication and never decides on its own.
 */
export function classifyOrigin(
  analysis: ProjectAnalysis,
  identity: Identity,
): ProjectOrigin {
  const git = analysis.git;
  const provenance = analysis.provenance;
  const evidence: OriginEvidence[] = [];

  const mine = (email: string) =>
    identity.emails.includes(email) || isAgentEmail(email);

  const total = git?.authors.reduce((sum, author) => sum + author.commits, 0) ?? 0;
  const yours = git?.authors
    .filter((author) => mine(author.email))
    .reduce((sum, author) => sum + author.commits, 0);
  const yourShare = total > 0 ? (yours ?? 0) / total : undefined;

  // ── Signs that you didn't start it ──────────────────────────────────────
  const owner = ownerOf(git?.remoteUrl);
  const foreignOwner = owner && identity.handles.length > 0 && !identity.handles.includes(owner);
  const rootEmail = git?.rootAuthor?.email;
  const foreignRoot = rootEmail ? !mine(rootEmail) : false;
  /*
    The license belongs to someone else only if it does not mention you **in any of the three
    ways** you appear: your email, your platform account, or your name. The third was missing, and
    that is why Panoma marked their own repository as belonging to someone else.
   */
  const licenseOf = provenance?.licenseHolder?.toLowerCase();
  const foreignLicense = Boolean(
    licenseOf &&
      !identity.emails.some((email) => licenseOf.includes(email.split("@")[0]!)) &&
      !identity.handles.some((handle) => licenseOf.includes(handle.toLowerCase())) &&
      !identity.names.some((name) => namesOverlap(licenseOf, name)),
  );

  if (foreignOwner) evidence.push({ code: "remote-foreign", value: owner });
  if (foreignRoot) {
    evidence.push({ code: "first-commit-foreign", value: git!.rootAuthor!.name || rootEmail });
  }
  if (foreignLicense) evidence.push({ code: "license-foreign", value: provenance!.licenseHolder });

  if (foreignOwner || foreignRoot || foreignLicense) {
    // Who started it is **the one with the mark that jumped**, not the first one at hand. The first
    // version always put the remote owner: `mapbox-maps-flutter-main` appeared as "started by
    // jesus89x2" just below "the license is from Mapbox".
    const startedBy = foreignOwner
      ? owner
      : foreignRoot
        ? git?.rootAuthor?.name || rootEmail
        : provenance?.licenseHolder;
    if (yourShare !== undefined) {
      // With someone else's license and your entire history, what happened is that the folder was
      // copied and the repository was restarted. Saying '100% of the history is yours' outright,
      // right below 'the license is from Mapbox,' sounds like a contradiction.
      evidence.push(
        yourShare >= 0.999 && !foreignRoot
          ? { code: "history-restarted" }
          : { code: "your-share", value: Math.round(yourShare * 100) },
      );
    }
    if (provenance?.zipSuffix) {
      evidence.push({ code: "zip-suffix", value: provenance.zipSuffix });
    }
    return {
      // With a significant part of your history in it, this is no longer 'from someone else': it is
      // a branch in which you have work inside, and deleting it is not the same.
      kind: (yourShare ?? 0) >= 0.2 ? "forked" : "foreign",
      yourShare,
      startedBy,
      evidence,
    };
  }

  // ── Plantilla ───────────────────────────────────────────────────────────────
  if (provenance?.scaffold && (git?.commitCount ?? 0) <= 2) {
    evidence.push({ code: "scaffold-first-commit", value: provenance.scaffold });
    evidence.push(
      git?.commitCount === 1
        ? { code: "only-commit" }
        : { code: "commit-count", value: git?.commitCount ?? 0 },
    );
    return { kind: "template", yourShare, evidence };
  }

  // ── Tuyo ────────────────────────────────────────────────────────────────────
  if (git?.rootAuthor) {
    const who = git.rootAuthor.name || rootEmail;
    evidence.push(
      provenance?.insideLargerRepo
        ? { code: "container-yours", value: who }
        : { code: "first-commit-yours", value: who },
    );
    if (yourShare !== undefined) {
      evidence.push(
        yourShare >= 0.999
          ? { code: "all-history-yours", value: total }
          : { code: "your-share", value: Math.round(yourShare * 100) },
      );
    }
    if (owner) evidence.push({ code: "remote-yours", value: owner });
    if (provenance?.scaffold) {
      evidence.push({ code: "scaffold-continued", value: provenance.scaffold });
    }
    if (provenance?.zipSuffix) {
      evidence.push({ code: "zip-suffix-own", value: provenance.zipSuffix });
    }
    return { kind: "own", yourShare, evidence };
  }

  // ── Without repository: only the traces of paperwork remain ────────────────────
  if (provenance?.zipSuffix) {
    evidence.push({ code: "zip-suffix-none", value: provenance.zipSuffix });
  }
  if (provenance?.licenseHolder) evidence.push({ code: "license-foreign", value: provenance.licenseHolder });
  if (provenance?.declaredRepo) evidence.push({ code: "manifest-repo", value: provenance.declaredRepo });
  if (provenance?.tutorialMarker) {
    evidence.push({ code: "readme-foreign", value: provenance.tutorialMarker });
  }

  /*
    The folder suffix **does not** decide. It is a clue and nothing more: `-develop` is how GitHub
    names a ZIP, and also how anyone names the folder of their own development branch. With the
    suffix as sufficient evidence, `rentasos-app-movil-develop` —which belongs to the user, with
    two sister folders of the same project next to it— appeared as foreign.
    The statements decide: a license in someone else's name, or a README that is presented as
    material to copy. The suffix accompanies as evidence.
   */
  if (provenance?.tutorialMarker || provenance?.licenseHolder) {
    evidence.push({ code: "no-own-repo" });
    return { kind: "foreign", startedBy: provenance.licenseHolder, evidence };
  }

  evidence.push({ code: "no-repo" });
  return { kind: "no-signals", evidence };
}

/** `https://github.com/jesus89x2/maps` → `jesus89x2` */
function ownerOf(remoteUrl: string | undefined): string | undefined {
  if (!remoteUrl) return undefined;
  const match = /[:/]([^/:]+)\/[^/]+?(?:\.git)?$/.exec(remoteUrl);
  return match?.[1];
}

/**
 * An agent signs on your behalf.
 *
 * A repository where Claude has made a thousand commits is still yours, so its email counts as
 * yours both for deducing the identity and for distributing authorship. Without this, cabeman
 * —with 90% of the history signed by an agent— would be considered someone else's.
 */
function isAgentEmail(email: string): boolean {
  return /noreply@anthropic\.com|@users\.noreply\.github\.com$|cursor|copilot|devin/i.test(email);
}

function sortedKeys(counts: Map<string, number>): string[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
}

/**
 * The system account, as the last name with which you can appear.
 *
 * It is the same tautology that this entire module upholds — "the email with which you sign most
 * of your repositories is you" — applied to the other obvious thing: the person whose personal
 * folder contains these ninety projects is their owner.
 *
 * It was needed because the previous two methods failed at the same time in the most embarrassing
 * possible case: **Panoma marked its own repository as foreign.** Its `LICENSE` says «Copyright
 * (c) 2026 Jesus Castillo», git signs as `jesus89x2`, and the GitHub account is `jesus89x2`;
 * neither of the two resembles the name written in letters. The personal folder,
 * `/Users/jesuscastillo`, does.
 *
 * Generic account names are ruled out: in a `admin` or a `user` the match would be coincidental
 * and would turn any license that carries that word into 'yours'.
 */
const GENERIC_ACCOUNTS = new Set(["user", "admin", "root", "guest", "macbook", "usuario", "mac"]);

function systemAccount(): string[] {
  try {
    const account = userInfo().username?.trim();
    if (!account || account.length < 4) return [];
    if (GENERIC_ACCOUNTS.has(account.toLowerCase())) return [];
    return [account];
  } catch {
    // Without a readable user —in unusual containers— continue without one.
    return [];
  }
}

/**
 * If a license text mentions this person.
 *
 * It's not enough with `includes`: the license might say «Jesus Castillo» and the git name be
 * «Jesús Castillo» —with an accent— or vice versa, and on macOS both forms of the same character
 * coexist. They are compared without accents and word by word: it's enough that all the words of
 * the name are there, in any order, for it not to be from someone else.
 */
function namesOverlap(text: string, name: string): boolean {
  const flat = fold;

  const donde = flat(text);

  /*
    First pasted, and this is what is missing for the system account: `jesuscastillo` does not
    appear with that spacing in «Jesus Castillo», but it does if the spaces are removed from both.
    Comparing it this way catches the name written in any way.
   */
  const lettersOnly = (value: string) => flat(value).replace(/[^\p{L}\p{N}]+/gu, "");
  if (lettersOnly(name).length >= 4 && lettersOnly(text).includes(lettersOnly(name))) return true;

  // And if not, word by word: 'Jesús Castillo' versus a license that says 'Jesus Castillo Pérez' is
  // still the same person.
  const reports = flat(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((report) => report.length > 1);
  if (reports.length === 0) return false;

  return reports.every((report) => donde.includes(report));
}
