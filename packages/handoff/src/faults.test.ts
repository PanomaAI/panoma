import { describe, expect, it } from "vitest";
import { HANDOFF_FAULTS, HandoffFault, asHandoffFault, faultOf, isHandoffFaultCode } from "./faults";

/**
 * The vocabulary is closed inside and total at the edge, like `packages/apps/src/faults.ts`:
 * a code is kebab-case and distinct, the message is the code so `toThrow("<code>")` reads
 * it, and whatever was never a code comes back with a null code to be quoted, not looked up.
 */
describe("handoff fault codes", () => {
  it("are distinct, lowercase, kebab-case", () => {
    expect(new Set(HANDOFF_FAULTS).size).toBe(HANDOFF_FAULTS.length);
    for (const code of HANDOFF_FAULTS) expect(code).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("the message is the code, or code: detail", () => {
    expect(new HandoffFault("too-large").message).toBe("too-large");
    expect(new HandoffFault("write-failed", "ENOSPC").message).toBe("write-failed: ENOSPC");
    expect(new HandoffFault("too-large").name).toBe("HandoffFault");
  });

  it("faultOf is total", () => {
    expect(faultOf(new HandoffFault("ambiguous-id", "a3f1, a3f2"))).toEqual({
      code: "ambiguous-id",
      detail: "a3f1, a3f2",
    });
    expect(faultOf("bundle-invalid")).toEqual({ code: "bundle-invalid" });
    expect(faultOf(new TypeError("fetch failed"))).toEqual({ code: null, detail: "fetch failed" });
    expect(faultOf(undefined)).toEqual({ code: null });
    expect(isHandoffFaultCode("nothing-to-carry")).toBe(true);
    expect(isHandoffFaultCode("nothing")).toBe(false);
  });

  it("maps the operating system's refusals and keeps the cause", () => {
    const enospc = Object.assign(new Error("no space"), { code: "ENOSPC" });
    const fault = asHandoffFault(enospc);
    expect(fault.code).toBe("no-space-left");
    expect(fault.cause).toBe(enospc);
    expect(asHandoffFault(new Error("odd"), "write-failed").code).toBe("write-failed");
    const own = new HandoffFault("cwd-missing");
    expect(asHandoffFault(own)).toBe(own);
  });
});
