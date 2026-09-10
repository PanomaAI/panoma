import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOpenAll, runOpenAll, saveOpenAll } from "./open-all-api";

/**
 * The three calls of the button. What matters is what travels: a run carries an id and at most a
 * list of keys; a save carries the plan; and a "no" comes back with its two halves joined.
 */
const NOBODY = "no server";

function answers(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status < 400, status, json: async () => body })));
}
const call = () => (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;

afterEach(() => vi.unstubAllGlobals());

describe("talking to /api/open/all", () => {
  it("asks what could open, by id, and answers null when the server says no", async () => {
    answers(200, { remote: false, plan: null, candidates: [] });
    expect(await fetchOpenAll("p 1")).toMatchObject({ remote: false });
    expect(call()[0]).toBe("/api/open/all?id=p%201");
    vi.unstubAllGlobals();
    answers(404, { error: "nope" });
    expect(await fetchOpenAll("p1")).toBeNull();
  });

  it("a run sends the id and, only when given, the keys — never a command or an address", async () => {
    answers(200, { ok: true, opened: 1, total: 1, outcomes: [] });
    await runOpenAll("p1", NOBODY);
    expect((call()[1] as RequestInit).body).toBe('{"id":"p1","action":"run"}');
    vi.unstubAllGlobals();
    answers(200, { ok: true, opened: 1, total: 1, outcomes: [] });
    await runOpenAll("p1", NOBODY, ["editor:cursor", "terminal"]);
    expect((call()[1] as RequestInit).body).toBe('{"id":"p1","action":"run","keys":["editor:cursor","terminal"]}');
  });

  it("a save sends the plan, or null to go back to the suggestion", async () => {
    answers(200, { ok: true, saved: true });
    await saveOpenAll("p1", { version: 1, steps: [{ key: "folder" }] }, NOBODY);
    expect((call()[1] as RequestInit).body).toBe('{"id":"p1","action":"save","plan":{"version":1,"steps":[{"key":"folder"}]}}');
    vi.unstubAllGlobals();
    answers(200, { ok: true, saved: true });
    await saveOpenAll("p1", null, NOBODY);
    expect((call()[1] as RequestInit).body).toBe('{"id":"p1","action":"save","plan":null}');
  });

  it("the reason and the hint come back together", async () => {
    answers(410, { error: "The folder is gone.", hint: "Scan again." });
    expect(await runOpenAll("p1", NOBODY)).toEqual({ ok: false, message: "The folder is gone. Scan again." });
  });
});
