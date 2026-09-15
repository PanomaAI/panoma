import { statfs } from "node:fs/promises";
import { panomaHome } from "@panoma/core";

/** Physical capacity is independent of the logical quota; an unreadable disk is unknown. */
export type MemoryDisk =
  | { state: "available" | "low" | "full"; availableBytes: number; totalBytes: number }
  | { state: "unknown"; availableBytes: null; totalBytes: null };

export function diskCapacity(availableBytes: number, totalBytes: number): MemoryDisk {
  if (!Number.isFinite(availableBytes) || !Number.isFinite(totalBytes) || availableBytes < 0 || totalBytes <= 0) {
    return { state: "unknown", availableBytes: null, totalBytes: null };
  }
  return {
    state: availableBytes === 0 ? "full" : availableBytes < 256 * 1024 * 1024 ? "low" : "available",
    availableBytes, totalBytes,
  };
}

export async function memoryDisk(): Promise<MemoryDisk> {
  if (process.env["DATABASE_URL"]) return { state: "unknown", availableBytes: null, totalBytes: null };
  try {
    const stats = await statfs(panomaHome());
    return diskCapacity(stats.bavail * stats.bsize, stats.blocks * stats.bsize);
  } catch {
    return { state: "unknown", availableBytes: null, totalBytes: null };
  }
}
