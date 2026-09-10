import { listProjectNotes, triggerMatches, validMemoryPath, type Database } from "@panoma/db";

/** File queries are literal project-relative paths; they never open arbitrary files. */
export function memoryFiles(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30 || value.some((path) => typeof path !== "string" || !validMemoryPath(path))) {
    throw new RangeError("Files must contain at most 30 literal paths relative to the project root, without traversal or wildcards.");
  }
  return [...new Set(value as string[])];
}

/** Any connected client can retrieve the same rules that an edit hook would deliver. */
export async function projectMemoryForFiles(database: Database, projectId: string, files: string[]) {
  if (files.length === 0) return [];
  const notes = await listProjectNotes(database, projectId);
  return notes.flatMap((note) => {
    if (note.trigger === null) return [];
    const matching = files.filter((path) => triggerMatches(note.trigger!, path));
    return matching.length === 0 ? [] : [{
      id: note.id, body: note.body, createdBy: note.createdBy, trigger: note.trigger, files: matching,
    }];
  });
}
