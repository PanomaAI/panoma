import { describe, expect, it } from "vitest";
import { diskCapacity } from "./memory-disk";

describe("physical disk capacity remains separate from logical storage", () => {
  it("distinguishes full, low and unavailable capacity without promising room for a write", () => {
    expect(diskCapacity(0, 1_000_000_000).state).toBe("full");
    expect(diskCapacity(1024, 1_000_000_000).state).toBe("low");
    expect(diskCapacity(512 * 1024 * 1024, 1_000_000_000).state).toBe("available");
    expect(diskCapacity(NaN, 1_000_000_000)).toEqual({ state: "unknown", availableBytes: null, totalBytes: null });
    expect(diskCapacity(-1, 1_000_000_000).state).toBe("unknown");
  });
});
