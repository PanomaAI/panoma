/*
  The drafting of secrets: what looks like a key does not appear in the catalog.
  Sister of `secrets.ts` and with the roles clear: that one SCANS what git follows and notifies
  the person; this one COVERS what an agent is about to store in memory. The memory of Panoma is
  text that is archived and then served again — to agents, for months. A token that an agent
  pasted in the logbook (“failed with sk-…”) traveled intact to the archive, from there to the
  distiller, could end up in a note and be served forever: the audit identified it as the hygiene
  hole that it was. And the vault rule was already written: metadata yes, secrets never — neither
  by HTTP nor in logs, and certainly not in the database.
  The forms copy the scanner's lessons: prefixes that are only issued by one provider, no entropy
  heuristics that sooner or later devour a sha or a URL. A secret without a known form that slips
  away is the cheap failure; a logbook riddled with false positives would make someone shut down
  the entire drafting, which is the expensive one.
 */

/**
 * The mark that remains where there was a key. It is seen, on purpose: to erase without saying is
 * to lie.
 */
export const REDACTED = "[secret-redacted]";

const SECRET_SHAPES: RegExp[] = [
  // Anthropic, and OpenAI with its `sk-proj-`: the sizes come measured in secrets.ts.
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g,
  // Stripe, production and testing.
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/g,
  // GitHub: classic and fine-grained.
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  // AWS access key id.
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Slack.
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  // Google API.
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  // npm.
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  // A signed JWT: three base64url segments with its dot. `eyJ` is `{"` encoded.
  /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/g,
  /*
    A PEM private key with material behind it — the same lesson as in secrets.ts: only look for
    the header mark in the code that removes it with `.replace(…)`. Base64 material is required to
    be pasted at header, and the closure is optional because a log chunk may be cut — without
    closure, the parser consumes until the end, which is the safe side.
   */
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----[\s"'`\\]{0,8}[A-Za-z0-9+/=]{32,}[\s\S]*?(?:-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----|$)/g,
];

/** The text with its keys covered. Idempotent: the mark has no key shape. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const shape of SECRET_SHAPES) out = out.replace(shape, REDACTED);
  return out;
}
