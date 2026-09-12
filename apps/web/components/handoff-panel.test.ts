import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * What the handoff panel, the receipts and the project card promise, read off their source.
 *
 * Vitest does not transform `.tsx` here on purpose (the pattern of `project-views.test.ts` and
 * `modal-keyboard.test.ts`), so each invariant below is a shape in the text: a gate that must be
 * on a button, a state that must not be read raw, a sentence that must come from the dictionary.
 * Every one of them is a defect the audit of 12-Sep-2026 confirmed on the screen; none was visible
 * in a unit test of the pure helpers, because each is about which helper a component asks.
 */
const panel = readFileSync(new URL("./handoff-panel.tsx", import.meta.url), "utf8");
const receipts = readFileSync(new URL("./handoff-receipts.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("../app/(app)/p/[slug]/page.tsx", import.meta.url), "utf8");

describe("the panel speaks the viewer's language", () => {
  /*
    The engine words two things in English for the terminal and the channel: the by-hand fallback
    of an app door (`ResumeInApp.sentence`) and, until 12-Sep-2026, Gemini's `testedWith`. The
    panel painted both as they came. Now the first is a key per app and the second is data —
    a version and a date — or the absence's own sentence.
   */
  it("never paints the engine's English fallback sentence of an app door", () => {
    expect(panel).not.toMatch(/\.sentence\}/);
    expect(panel).toContain("IN_APP_BY_HAND_KEY[inApp.app.id]");
    expect(panel).toMatch(/t\(byHandKey, \{ cwd, id: receipt\.targetSessionId \}\)/);
  });

  it("paints `testedWith` as data and says «never run live» from the dictionary when it is absent", () => {
    expect(panel).not.toContain("!.testedWith}");
    expect(panel).toMatch(/\?\.testedWith \?\? t\("handoff\.neverRunLive"\)/);
  });
});

describe("the travels / stays-behind table", () => {
  /*
    The screen once knew four of the six counts of `Dropped`; the rows come from `DROPPED_KEYS`
    now, the same list `leftBehind` reads, so a count the engine adds reaches both places or
    neither.
   */
  it("paints one row per count the engine keeps, through the shared list", () => {
    expect(panel).toContain("DROPPED_KEYS.map(");
    expect(panel).not.toMatch(/\[t\("handoff\.row\.(images|subagents|secrets)"\)/);
  });

  /*
    A document-only target always writes `brief`, but the `tier` state stops following the target
    once a person touches a radio. One effective tier is derived and fed to the table, the digest
    checkbox and the write, so what the table says is what the button saves.
   */
  it("reads one effective tier, and so do the digest checkbox and the write", () => {
    expect(panel).toMatch(/const effectiveTier: Tier = target === "same" \? sameTier : native \? tier : "brief";/);
    expect(panel).toContain("<FidelityTable tier={effectiveTier}");
    expect(panel).toContain('const digestNeeded = effectiveTier !== "full";');
    expect(panel.match(/void write\(effectiveTier\)/g)?.length).toBe(2);
    expect(panel).not.toMatch(/write\("brief"\)|write\(sameCopy \? "compact" : tier\)/);
    expect(panel).not.toContain("<FidelityTable tier={tier}");
  });
});

describe("a brief is a document, not a session", () => {
  /*
    The receipt of a brief carries the document's stem where a session id would go, and
    `resumeCommand: null`. The launch route can only answer `invalid-id` for it, so no surface
    offers the door: not «Done so far», not the panel's «already handed» box, and the box says a
    document was saved instead of «Resume that one».
   */
  it("gets no launch button on either surface", () => {
    expect(receipts).toMatch(/const canLaunch = [^\n]*receipt\.tier !== "brief"/);
    expect(panel).toMatch(/if \(!receipt\.projectId \|\| !isNativeTarget\(receipt\.targetAgent\) \|\| receipt\.tier === "brief"\) return null;/);
  });

  it("is announced as a saved document in the «already handed» box, with the path and no door", () => {
    const box = /\{destination && already && already\.tier === "brief" && \([\s\S]*?\n {16}\)\}/.exec(panel)?.[0] ?? "";
    expect(box, "the brief box is missing").not.toBe("");
    expect(box).toContain('t("handoff.alreadyDocument"');
    expect(box).toContain('t("handoff.savedAt", { path: already.targetPath })');
    expect(box).not.toMatch(/LaunchButton|OpenInApp|ResumeLine/);
    expect(panel).toContain('{destination && already && already.tier !== "brief" && (');
  });

  /*
    «claude --continue now resumes the copy» is true of a written conversation only. A brief to
    Claude Code writes a `.md`, and `--continue` takes whatever Claude Code kept last in that
    folder — the original when the source was a Claude conversation there, an unrelated session
    or nothing otherwise.
   */
  it("does not print the `claude --continue` step after a document", () => {
    expect(panel).toContain('const claudeCopy = receipt.targetAgent === "claude-cli" && Boolean(result.resume);');
    expect(panel).toContain('{claudeCopy && <li>{t("handoff.stepClaude")}</li>}');
    expect(panel).not.toMatch(/receipt\.targetAgent === "claude-cli" && <li>/);
    expect(panel).not.toMatch(/result\.steps\.length > 0 \|\| receipt\.targetAgent === "claude-cli"/);
  });
});

describe("the project card resolves conversations the way the screen does", () => {
  /*
    The screen matches a conversation's folder against the root as stored and as resolved, and
    the agent channel resolves both sides; the card compared raw strings, so a root the catalog
    keeps through a link (or `/var` against `/private/var`) said «no conversations» while
    `/handoff` listed them under that very project. `inProject` is the channel's helper.
   */
  it("filters through inProject, which resolves both sides on disk", () => {
    expect(card).toContain("inProject(found.conversations, data.project.root)");
    expect(card).not.toMatch(/insideFolder\(ref\.cwd/);
  });
});
