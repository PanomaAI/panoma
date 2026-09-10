import { expect, it } from "vitest";
import { APP_FAULTS, AppFault, asAppFault, faultOf, isAppFaultCode } from "./faults";

/*
  Three underscores are deliberate: `app-input.ts` composes `"invalid-" + field` over the app's
  own field names, `brief_id`, `render_id` and `hook`. Named here so the shape test is a rule
  with a written exception rather than a rule with a hole.
 */
const COMPOSED = new Set(["invalid-brief_id", "invalid-render_id", "invalid-hook"]);

it("is a set of distinct, path-safe codes", () => {
  expect(new Set(APP_FAULTS).size).toBe(APP_FAULTS.length);
  for (const code of APP_FAULTS) {
    if (COMPOSED.has(code)) expect(code).toMatch(/^[a-z][a-z0-9_-]*$/);
    else expect(code).toMatch(/^[a-z][a-z0-9-]*$/);
  }
  expect(isAppFaultCode("offline")).toBe(true);
  expect(isAppFaultCode("something-else")).toBe(false);
});

/*
  The message is the contract this change was built around: nine assertions elsewhere in this
  package read it as a string, and `manager.ts` nests one code inside another's payload. If a
  fault ever stops saying its own code, those go red for a reason nobody will connect to this.
 */
it("says its code, and its payload after it", () => {
  expect(new AppFault("offline").message).toBe("offline");
  expect(new AppFault("does-not-start", "guide timeout").message).toBe("does-not-start: guide timeout");
  expect(new AppFault("staged-update-invalid", "incompatible-protocol").message)
    .toBe("staged-update-invalid: incompatible-protocol");
});

/*
  Reading it back is total on purpose. It is fed rows written before this vocabulary existed and
  values that were never codes at all, and every one of those has to render as it did before —
  a null code is the signal to quote the text instead of translating it.
 */
it("reads back a code, and refuses to invent one", () => {
  expect(faultOf(new AppFault("stalled", "Downloading | 40%")))
    .toEqual({ code: "stalled", detail: "Downloading | 40%" });
  expect(faultOf("interrupted")).toEqual({ code: "interrupted" });
  expect(faultOf("process-failed: npm error code E404"))
    .toEqual({ code: "process-failed", detail: "npm error code E404" });
  expect(faultOf("HTTP 500")).toEqual({ code: null, detail: "HTTP 500" });
  // The app's own prose, which begins with a word that is not a code and must stay quoted.
  expect(faultOf("Provider refused [redacted]")).toEqual({ code: null, detail: "Provider refused [redacted]" });
  expect(faultOf(undefined)).toEqual({ code: null });
  expect(faultOf(null)).toEqual({ code: null });
});

/* «Disk full» used to arrive as `ENOSPC: no space left on device, write '/Users/…'`. */
it("turns the operating system's refusals into codes", () => {
  const full = Object.assign(new Error("ENOSPC: no space left on device, write '/Users/x/.panoma/a.tmp'"), { code: "ENOSPC" });
  expect(asAppFault(full).code).toBe("no-space-left");
  expect(asAppFault(Object.assign(new Error("denied"), { code: "EACCES" })).code).toBe("permission-denied");
  // An errno with no meaning of its own falls to the caller's word for "something on disk failed".
  expect(asAppFault(Object.assign(new Error("odd"), { code: "EXDEV" })).code).toBe("disk-error");
  expect(asAppFault(new Error("boom"), "command-did-not-start").code).toBe("command-did-not-start");
  // A fault that already knows what it is passes through untouched, payload included.
  const known = new AppFault("timeout");
  expect(asAppFault(known)).toBe(known);
  expect(asAppFault(new Error("does-not-start: guide timeout")).detail).toBe("guide timeout");
});
