import { describe, expect, it } from "vitest";
import { episodeCoverage, episodeCursor, episodeExpired, episodeReach, episodeTitle, parseEpisodeCursor } from "./twin-memory-view";

const owner = {
  identity: "git:atlas", origin: "owner" as const, status: "active" as const, validUntil: null,
  fields: { decision: { text: "Use inline editing." } },
};

/** The instants either side of a day that is already over, and one that is still to come. */
const GONE = "2020-03-01T23:59:59.999Z";
const AHEAD = "2999-03-01T23:59:59.999Z";

describe("the reach line of a decision card", () => {
  it("names the doors open to a record, and the reason the others are closed", () => {
    expect(episodeReach(owner, false)).toBe("twinMemory.reachProject");
    expect(episodeReach({ ...owner, identity: null }, false)).toBe("twinMemory.reachGeneral");
    expect(episodeReach({ ...owner, fields: { goal: { text: "Ship it." }, decision: { text: "  " } } }, false)).toBe("twinMemory.reachNoDecision");
    expect(episodeReach({ ...owner, origin: "history" }, false)).toBe("twinMemory.reachLabOnly");
    expect(episodeReach(owner, true)).toBe("twinMemory.reachWithheld");
    // A dismissed record is delivered nowhere, whatever else is true of it.
    expect(episodeReach({ ...owner, status: "dismissed" }, true)).toBe("twinMemory.reachNowhere");
    expect(episodeReach({ ...owner, status: "dismissed", origin: "history" }, false)).toBe("twinMemory.reachNowhere");
  });

  it("stops at the expiry before it asks who wrote the record or what it decided", () => {
    expect(episodeReach({ ...owner, validUntil: GONE }, false)).toBe("twinMemory.reachExpired");
    // Neither of the two answers below survives the date: an expired record reaches nobody.
    expect(episodeReach({ ...owner, validUntil: GONE, origin: "history" }, false)).toBe("twinMemory.reachExpired");
    expect(episodeReach({ ...owner, validUntil: GONE, fields: {} }, false)).toBe("twinMemory.reachExpired");
    /*
      And it is asked before the competing case, because the withheld sentence promises a way out
      —keep one version— that the date would break. What a dismissed record says still wins: it is
      the owner's own decision about the row, and clearing the date would not deliver it either.
     */
    expect(episodeReach({ ...owner, validUntil: GONE }, true)).toBe("twinMemory.reachExpired");
    expect(episodeReach({ ...owner, validUntil: GONE, status: "dismissed" }, false)).toBe("twinMemory.reachNowhere");
    // A date still ahead changes nothing: the record is delivered exactly as one without a date.
    expect(episodeReach({ ...owner, validUntil: AHEAD }, false)).toBe("twinMemory.reachProject");
    expect(episodeReach({ ...owner, validUntil: AHEAD }, true)).toBe("twinMemory.reachWithheld");
  });
});

describe("the last day a decision applies", () => {
  it("is over once the instant has passed, and never for a record without one", () => {
    const day = Date.parse("2026-03-01T23:59:59.999Z");
    expect(episodeExpired({ validUntil: null }, day)).toBe(false);
    expect(episodeExpired({ validUntil: "2026-03-01T23:59:59.999Z" }, day)).toBe(true);
    expect(episodeExpired({ validUntil: "2026-03-01T23:59:59.999Z" }, day - 1)).toBe(false);
    expect(episodeExpired({ validUntil: "2026-03-02T23:59:59.999Z" }, day)).toBe(false);
    /*
      A string that is not an instant is not an expiry: the record keeps being delivered, which is
      what it did before anyone wrote a date on it. Refusing to deliver on an unreadable value
      would silence a decision over a bug in whoever wrote the value.
     */
    expect(episodeExpired({ validUntil: "not a date" }, day)).toBe(false);
  });
});

describe("the paging cursor", () => {
  it("round-trips a position and refuses anything that is not one", () => {
    const position = { createdAt: "2026-09-03T00:00:00.123Z", id: "cbb85b25f58450ef86592e48" };
    const cursor = episodeCursor(position);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parseEpisodeCursor(cursor)).toEqual({ createdAt: new Date(position.createdAt), id: position.id });
    for (const bad of [
      "", "not base64!", "x".repeat(513), btoa("[]"), btoa("null"), btoa("{}"),
      btoa(JSON.stringify({ createdAt: "2026-09-03", id: position.id })),
      btoa(JSON.stringify({ createdAt: "2026-13-45T00:00:00.000Z", id: position.id })),
      btoa(JSON.stringify({ createdAt: position.createdAt, id: "../etc" })),
      btoa(JSON.stringify({ createdAt: position.createdAt })),
    ]) {
      expect(parseEpisodeCursor(bad.replace(/=+$/, "")), bad).toBeUndefined();
    }
  });
});

describe("the card's own summary", () => {
  it("lists recorded and missing dimensions by name and picks the first field worth a headline", () => {
    expect(episodeCoverage({ fields: { goal: { text: "Ship." }, outcome: { text: " " } } })).toEqual({
      recorded: ["goal"],
      missing: ["context", "constraints", "alternatives", "decision", "rationale", "outcome", "conditions", "exceptions"],
    });
    expect(episodeTitle({ fields: { context: { text: "After the incident" }, goal: { text: "Ship." } } })).toBe("Ship.");
    expect(episodeTitle({ fields: {} })).toBeNull();
  });
});
