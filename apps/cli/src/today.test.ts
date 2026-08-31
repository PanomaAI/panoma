import { describe, expect, it } from "vitest";
import { reportUrl } from "./today";

/**
 * The 'already seen' mark belongs to a single person and cannot be returned.
 *
 * What is checked here is not that the URL is well-formed, but **who can spend the human's news**:
 * a cron that consumes the report every hour leaves the cover saying 'no news' over an entire
 * night of work, and from the outside that is indistinguishable from a night in which nothing
 * really happened.
 */
describe("reportUrl", () => {
  it("con terminal delante, la lectura cuenta y mueve la marca", () => {
    expect(reportUrl("http://127.0.0.1:4173", true).searchParams.get("fijo")).toBeNull();
  });

  it("sin terminal —cron, tubería, CI— se lee sin tocarla", () => {
    expect(reportUrl("http://127.0.0.1:4173", false).searchParams.get("fijo")).toBe("1");
  });

  it("respeta el catálogo al que se apunta", () => {
    const url = reportUrl("http://192.168.1.40:4173", false);
    expect(url.origin).toBe("http://192.168.1.40:4173");
    expect(url.pathname).toBe("/api/today");
  });
});
