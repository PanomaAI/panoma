import { describe, expect, it } from "vitest";
import { HANDOFF_CLAUDE_RECORD_VERSION, HANDOFF_CODEX_ORIGINATOR, HANDOFF_PROVENANCE_PREFIX } from "./handoff-marker";

/**
 * A handed-off copy is not owner evidence: the person did not say its first words, panoma did.
 * The twin's history readers recognise the writers' stamps and skip the carried records; this
 * pins the three constants so the writers in `packages/handoff` —whose test asserts it writes
 * exactly these— and the readers here cannot drift apart in silence.
 */
describe("the handoff marks", () => {
  it("are the line the writers put first, and the two stamps the readers key on", () => {
    expect(HANDOFF_PROVENANCE_PREFIX).toBe("Continued from ");
    expect(HANDOFF_CLAUDE_RECORD_VERSION).toBe("panoma-handoff");
    expect(HANDOFF_CODEX_ORIGINATOR).toBe("panoma");
  });

  it("cannot be typed: neither stamp is a version number Claude Code or Codex would write", () => {
    // Claude Code writes its own version (`2.1.258`), Codex its client (`codex_cli_rs`, `Codex Desktop`).
    expect(HANDOFF_CLAUDE_RECORD_VERSION).not.toMatch(/^\d+\.\d+\.\d+/);
    expect(HANDOFF_CODEX_ORIGINATOR).not.toMatch(/codex/i);
  });
});
