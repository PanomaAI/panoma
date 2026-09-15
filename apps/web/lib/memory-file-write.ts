import type { Database } from "@panoma/db";

const runtime = globalThis as unknown as { panomaMemoryFileWrites?: WeakMap<Database, Promise<void>> };

/** Serialize owned-file writers with deletion cleanup; no database transaction spans file IO. */
export function memoryFileWrite<T>(database: Database, work: () => Promise<T>): Promise<T> {
  const writes = runtime.panomaMemoryFileWrites ??= new WeakMap();
  const result = (writes.get(database) ?? Promise.resolve()).then(work);
  writes.set(database, result.then(() => undefined, () => undefined));
  return result;
}
