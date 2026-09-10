import { createHash } from "node:crypto";

/*
  The fingerprint of what the project card sends to a model.

  `/api/describe` pays a call to write two to four sentences about a project, and until
  6-Sep-2026 it paid again on every press, whether or not anything had changed since the last
  paragraph. The saved text now carries the fingerprint of the material it was written from
  (`decisions.aiSummaryHash`), and the route answers a press on an unchanged project from the
  saved text instead of the model. This is the function that says "unchanged".

  It hashes the raw pieces, not the prompt. The prompt wraps the README and the commits in the
  untrusted-material envelope, and the wording of that envelope belongs to `packages/core`: a
  fingerprint over the prompt would change every time that wording did, and every project would
  pay one call to find out nothing had changed. The pieces are joined length-prefixed so that two
  different lists cannot fold into one string — "ab" + "c" and "a" + "bc" are different material.

  Sixteen hex characters, like `docHash` in `packages/core`: the column is compared for equality
  and nothing else, and a shorter value reads better in a database browser.
 */
export function cardFingerprint(parts: readonly (string | undefined)[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    const text = part ?? "";
    hash.update(`${text.length}:`);
    hash.update(text);
    hash.update("\n");
  }
  return hash.digest("hex").slice(0, 16);
}
