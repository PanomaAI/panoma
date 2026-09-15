import { deletionGeneration, ensureDeletionJournal, listDeletions, queueWrite, type Database } from "@panoma/db";

export class MemoryUnavailableError extends Error {
  constructor() { super("Memory changed or is quarantined; retry after its deletion journal is reconciled."); }
}

export function memoryUnavailableResponse(): Response {
  return Response.json({ code: "unavailable", error: "Memory changed or is quarantined; retry after its deletion journal is reconciled." }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

/** Check the journal against this catalog before reading, processing or publishing memory. */
export async function memoryAvailability(database: Database, home?: string): Promise<boolean> {
  try {
    return !(await queueWrite(() => ensureDeletionJournal(database, home))).quarantined;
  } catch {
    return false;
  }
}

/** A paid reader rechecks the same deletion generation immediately before sending or saving. */
export async function memoryFence(database: Database): Promise<() => Promise<void>> {
  if (!await memoryAvailability(database)) throw new MemoryUnavailableError();
  const generation = await deletionGeneration(database);
  const check = async () => {
    if (!await memoryAvailability(database) || await deletionGeneration(database) !== generation) throw new MemoryUnavailableError();
    if ((await listDeletions(database)).some((row) => row.state === "pending" || row.state === "cleaning")) throw new MemoryUnavailableError();
  };
  await check();
  return check;
}
