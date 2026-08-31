import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Extensions where there may be a written credential.
 *
 * It is an inclusion list and not an exclusion list on purpose: reading a 40 MB `.psd` to look for
 * `sk_live_` finds nothing and costs the same as reading a hundred code files. What is left out
 * are binaries, images, and video.
 */
const TEXT_EXTENSIONS =
  /\.(ts|tsx|js|jsx|mjs|cjs|dart|py|rb|go|rs|php|java|kt|swift|m|mm|c|h|cpp|cs|sh|bash|zsh|fish|sql|graphql|json|ya?ml|toml|ini|cfg|conf|properties|xml|plist|env|txt|md|gradle|tf|tfvars|pem|key|Dockerfile)$|(^|\/)(Dockerfile|Makefile|Procfile|\.env[^/]*)$/i;

/**
 * Committed credentials: what git currently tracks, read from the working tree.
 *
 * This module plays all its usefulness in false positives. A detector that shouts 'key leaked' for
 * the Google Maps key of a `google-services.json` —which is public by design, travels inside the
 * APK, and anyone can see it— achieves two things: that you ignore it, and that the day you
 * actually leak a real one, you don't follow it either. So there is an explicit list of what **is
 * not** a secret, and when something is dismissed, it is stated how much has been dismissed and
 * why.
 *
 * Only what git tracks is seen, in its current content. A key in a `.env` that is ignored is on
 * your disk, not in your history: it is a different risk, much smaller, and mixing them would make
 * the list unmanageable exactly in the projects that are most careful.
 *
 * Known limitation: a key that was committed and then deleted from the tree is still alive in the
 * old blobs, and this module still doesn't look there. That's why no text in this module says
 * 'history': promising the complete history without traversing it would be the same silent failure
 * that this detector exists to prevent.
 */

export type Severity = "critical" | "high" | "medium";

interface Rule {
  id: string;
  label: string;
  severity: Severity;
  pattern: RegExp;
  why: string;
  /**
   * It searches the entire file instead of line by line.
   *
   * It is necessary when what distinguishes a true finding is on the next line, as in a PEM: the
   * header stands alone and the material starts below.
   */
  wholeFile?: boolean;
  /**
   * Second check on the text that follows the match.
   *
   * For when the shape is not enough and it is necessary to look at the size of what is behind. It
   * receives up to 2,400 characters from the start of the match.
   */
  confirm?: (context: string) => boolean;
}

/**
 * A real private key comes whole; an example from documentation, trimmed.
 *
 * `MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcw` appears at the beginning of **all** RSA keys in PKCS#8
 * —it is the header of the format, not secret material—, so any `README` that shows how to set the
 * environment variable matches the pattern. On this disk there were five findings from three
 * documentation files.
 *
 * The first version discarded them by demanding two hundred Base64 characters, with the reasoning
 * that "a real key exceeds a thousand." **That is only true for RSA.** Measured with `openssl`: an
 * Ed25519 in PKCS#8 is 64 characters of material; an EC P-256, 164 in SEC1 and 184 in PKCS#8. All
 * three fell below the cutoff, so a JWT signing key or a `.p8` AuthKey for App Store Connect
 * pasted inside a code file **was not reported**, and the report said the repository was clean.
 * With the name `clave.pem` the file name rule triggered in the same way, and that hid the hole:
 * it only appears when the key lives inside something else.
 *
 * What really separates a key from an example is not the size, it is the **footer**: a
 * `-----END … PRIVATE KEY-----` behind the material. A trimmed example ends in ellipsis and does
 * not have it. When the footer is present, forty-eight characters are enough — below the shortest
 * that exists; when it is not, the old cut is maintained, because the context is 2,400 characters
 * and a 4096-bit RSA does not fit entirely: there the absence of a footer proves nothing.
 */
function hasRealKeyMaterial(context: string): boolean {
  const end = context.indexOf("-----END");
  if (end < 0) return countBase64(context) >= 200;
  return countBase64(context.slice(0, end)) >= 48;
}

function countBase64(text: string): number {
  return text.match(/[A-Za-z0-9+/=]/g)?.length ?? 0;
}

/**
 * Patterns with a recognizable shape and without ambiguity.
 *
 * Nothing like heuristics such as 'a 32-character string next to the word key': that marks half of
 * a lockfile. Each rule is a prefix that only one provider emits.
 */
const RULES: Rule[] = [
  {
    id: "stripe-live",
    label: "Clave secreta de Stripe en producción",
    severity: "critical",
    pattern: /\bsk_live_[A-Za-z0-9]{16,}/,
    why: "Permite cobrar y mover dinero de la cuenta real.",
  },
  {
    id: "stripe-test",
    label: "Clave secreta de Stripe de pruebas",
    severity: "medium",
    pattern: /\bsk_test_[A-Za-z0-9]{16,}/,
    why: "Solo afecta al entorno de pruebas, pero no debería estar en el historial.",
  },
  {
    id: "aws",
    label: "Clave de acceso de AWS",
    severity: "critical",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    why: "Da acceso a la cuenta de AWS según los permisos del usuario.",
  },
  {
    id: "github-token",
    label: "Token de GitHub",
    severity: "critical",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}|\bgithub_pat_[A-Za-z0-9_]{20,}/,
    why: "Da acceso a los repositorios del usuario según sus permisos.",
  },
  {
    id: "anthropic",
    label: "Clave de API de Anthropic",
    severity: "high",
    pattern: /\bsk-ant-[A-Za-z0-9\-_]{20,}/,
    why: "Se factura a tu cuenta hasta que la revoques.",
  },
  {
    id: "openai",
    label: "Clave de API de OpenAI",
    severity: "high",
    // `_` and `-` within the class: without them the match was cut off at the first hyphen of
    // `sk-proj-Gn…-6N5cvVf3…`, and since the trimming only covers **what matched**, the interface
    // ended up showing the rest of the entire key. The detector filtered the credential that came
    // to warn that it was leaked.
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/,
    why: "Se factura a tu cuenta hasta que la revoques.",
  },
  {
    id: "slack",
    label: "Token de Slack",
    severity: "high",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
    why: "Da acceso al espacio de trabajo de Slack.",
  },
  {
    id: "private-key",
    label: "Clave privada",
    severity: "critical",
    /*
      The header **and material behind it**. Searching only the header marked twenty-one false
      positives on this disk, all in the same way:
      .replace('-----BEGIN PRIVATE KEY-----', '')
      which is code removing the header to keep the base64, that is, exactly the opposite of a
      leaked key. Requiring that base64 comes afterward distinguishes 'here is a key' from 'here
      we talk about a key'.
     */
    /*
      `BLOCK` optional and `ENCRYPTED` added: the OpenPGP armor is
      `-----BEGIN PGP PRIVATE KEY BLOCK-----` (RFC 4880 §6.2), with that word in the middle, so
      the `PGP ` alternative of the first version could never match.
     */
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----[\s"'\\n]{0,8}[A-Za-z0-9+/=]{32,}/,
    why: "Una clave privada en el historial deja de ser privada.",
    wholeFile: true,
    confirm: hasRealKeyMaterial,
  },
  {
    id: "supabase-service",
    label: "Clave service_role de Supabase",
    severity: "critical",
    pattern: /"?service_role"?\s*[:=]\s*"?eyJ[A-Za-z0-9\-_.]{40,}/,
    why: "Salta todas las políticas de seguridad a nivel de fila. Es la llave maestra.",
  },
  {
    id: "google-api-key",
    label: "Clave de API de Google",
    severity: "medium",
    pattern: /\bAIza[A-Za-z0-9\-_]{35}\b/,
    why: "Fuera de la configuración de cliente, una clave de Google sin restricciones de dominio la puede usar cualquiera y se factura a tu cuenta.",
  },
  {
    id: "sendgrid",
    label: "Clave de SendGrid",
    severity: "high",
    pattern: /\bSG\.[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}/,
    why: "Permite enviar correo en tu nombre.",
  },
];

/**
 * Files where a credential in the form of a key **is not** a leak.
 *
 * The first three are client configuration that Google and Firebase publish on purpose: they
 * travel inside the APK and IPA, anyone can extract them, and their security depends on the
 * console restrictions, not the secret. Flagging them would be the false positive that makes no
 * one look at this page again.
 */
const PUBLIC_BY_DESIGN = [
  /(^|\/)google-services\.json$/,
  /(^|\/)GoogleService-Info\.plist$/,
  /(^|\/)firebase_options\.dart$/,
  /(^|\/)\.env\.(example|sample|template)$/,
  /(^|\/)(README|CONTRIBUTING|CHANGELOG)\.md$/i,
  // Lock files: full of hashes shaped like everything.
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Podfile\.lock|Cargo\.lock)$/,
  /*
    Third-party dependencies committed. `ios/Pods 2/gRPC-C++/etc/roots.pem` is the gRPC root
    certificates package —public, it goes in all installations worldwide— and it showed up as a
    'critical private key.' Whatever is in there you didn't write and it's not yours to leak. The
    asterisk on `Pods*` is because on this disk there are 'Pods 2' folders, which is what Finder
    does when copying.
   */
  /(^|\/)Pods[^/]*\//,
  /(^|\/)node_modules\//,
  /(^|\/)vendor\//,
  /(^|\/)third_party\//,
  /(^|\/)Carthage\//,
];

/** Files that should not be in the history because of what they are, not because of what they say. */
const SECRET_FILES: { id: string; pattern: RegExp; label: string; severity: Severity }[] = [
  { id: "env-file", pattern: /(^|\/)\.env(\.(local|production|prod|development|dev|staging))?$/, label: "fichero .env", severity: "high" },
  { id: "key-file", pattern: /\.(pem|key|p12|pfx|jks|keystore)$/, label: "fichero de claves", severity: "critical" },
  { id: "google-service-account", pattern: /(^|\/)service-?account.*\.json$/i, label: "cuenta de servicio de Google", severity: "critical" },
  { id: "ssh-private-key", pattern: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, label: "clave SSH privada", severity: "critical" },
];

export interface SecretFinding {
  file: string;
  /** `0` when the finding is the entire file and not a specific line. */
  line: number;
  ruleId: string;
  label: string;
  severity: Severity;
  /** The snippet with the truncated value: a full credential is never copied. */
  excerpt: string;
  why: string;
}

export interface SecretReport {
  /** `false` if the folder is not a repository: there are no tracked files to review. */
  scanned: boolean;
  findings: SecretFinding[];
  /** Matches discarded for being in public files by design. */
  ignoredPublic: number;
}

/** No legitimate configuration file weighs this much; above this, it is almost certainly a blob. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export async function findSecrets(root: string): Promise<SecretReport> {
  /*
    The pairing is done on Node and not with `git grep`.
    The first version passed the combined rules to `git grep -E`, which uses extended POSIX
    regular expressions: it does not understand `\b` or `(?:…)`, which are PCRE. Git exited with
    code 128, `catch` interpreted it as "this is not a repository," and the report said
    `scanned: false` with zero findings. That is: the detector detected nothing and presented it
    as if there was nothing to detect, which is the worst possible way for a secrets detector to
    fail.
    `git grep -P` would have worked where git comes with compiled PCRE, but that cannot be assumed
    and the alternative was to have two different behaviors depending on the machine. Reading the
    files here leaves the rules as the only source of truth.
   */
  let tracked: string[];
  try {
    const { stdout } = await run("git", ["-C", root, "ls-files", "-z", "--", "."], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 30_000,
    });
    tracked = stdout.split("\0").filter(Boolean);
  } catch {
    return { scanned: false, findings: [], ignoredPublic: 0 };
  }

  const findings: SecretFinding[] = [];
  let ignoredPublic = 0;

  for (const file of tracked) {
    // ── The file is the problem, regardless of what it says ──────────
    if (!PUBLIC_BY_DESIGN.some((pattern) => pattern.test(file))) {
      const fileRule = SECRET_FILES.find((candidate) => candidate.pattern.test(file));
      if (fileRule) {
        findings.push({
          file,
          line: 0,
          ruleId: fileRule.id,
          label: fileRule.label,
          severity: fileRule.severity,
          excerpt: file,
          why: "Borrarlo del árbol no basta: lo commiteado sigue en el historial y la clave hay que rotarla.",
        });
      }
    }

    if (!TEXT_EXTENSIONS.test(file)) continue;

    let text: string;
    try {
      const stats = await stat(join(root, file));
      if (stats.size > MAX_FILE_BYTES) continue;
      text = await readFile(join(root, file), "utf8");
    } catch {
      continue;
    }

    const isPublic = PUBLIC_BY_DESIGN.some((pattern) => pattern.test(file));

    // The rules that need to see more than one line go over the entire text, and the line number is
    // deduced by counting line breaks up to the position of the match.
    for (const rule of RULES.filter((candidate) => candidate.wholeFile)) {
      const hit = rule.pattern.exec(text);
      if (!hit) continue;
      if (rule.confirm && !rule.confirm(text.slice(hit.index, hit.index + 2400))) continue;
      if (isPublic) {
        ignoredPublic++;
        continue;
      }
      const line = text.slice(0, hit.index).split("\n").length;
      findings.push({
        file,
        line,
        ruleId: rule.id,
        label: rule.label,
        severity: rule.severity,
        excerpt: redact(hit[0].slice(0, 90), hit[0].slice(0, 90)),
        why: rule.why,
      });
    }

    const lineRules = RULES.filter((candidate) => !candidate.wholeFile);
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      if (line.length > 2000) continue; // minified: there is nothing to read there

      for (const rule of lineRules) {
        const hit = rule.pattern.exec(line);
        if (!hit) continue;
        if (isPublic) {
          ignoredPublic++;
          break;
        }
        findings.push({
          file,
          line: index + 1,
          ruleId: rule.id,
          label: rule.label,
          severity: rule.severity,
          excerpt: redact(line, hit[0]),
          why: rule.why,
        });
        break;
      }
    }
  }

  const order: Severity[] = ["critical", "high", "medium"];
  findings.sort(
    (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || a.file.localeCompare(b.file),
  );

  return { scanned: true, findings, ignoredPublic };
}

/**
 * Let me see that there is a credential without exposing it again.
 *
 * A page that shows the entire key is just another site from which it is leaked: it stays in the
 * browser cache, in a screenshot, in the tab history. The prefix is enough to find it and to know
 * which provider it is from.
 */
function redact(text: string, secret: string): string {
  const shown = secret.slice(0, Math.min(10, Math.floor(secret.length / 3)));
  const masked = `${shown}${"·".repeat(8)}`;
  const line = text.replace(secret, masked);

  /*
    Second pass over **any** long string that remains.
    Covering only what matched depends on the pattern covering the entire credential, and that
    assumption has already failed once: OpenAI's pattern was cut at a dash and the rest of the key
    appeared on the screen as if it were context. A rule that assumes nothing about the patterns
    costs one line and does not fail again for the same reason.
   */
  return line
    .replace(/[A-Za-z0-9+/=_-]{28,}/g, (token) => `${token.slice(0, 8)}${"·".repeat(8)}`)
    .trim()
    .slice(0, 160);
}
