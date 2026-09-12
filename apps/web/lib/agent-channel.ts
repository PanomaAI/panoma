import { listProjectRoots, resolveProject, type Database } from "@panoma/db";

/*
  What every door of the agent channel that takes a location shares — `POST /api/agent/conversations`,
  `POST /api/agent/handoff` and the video four — and the operator doors do not: the location an MCP
  client describes, the project it resolves to, and the fixed English refusals a machine reads.
  Data, not responses: each route wraps them with its status and the `no-store` header, so that
  what a door answers stays in the door. It lived in `handoff-write.ts` until 12-Sep-2026, when a
  second family needed the same three things and would otherwise have imported the handoff engine
  to get a header and a body reader.
 */

/** `Cache-Control` of everything the channel answers: private state, derived on request. */
export const NO_STORE: Readonly<Record<string, string>> = { "Cache-Control": "private, no-store" };

/** Where the MCP client stands: its folder, the repository root it found, the remote. */
export interface Location {
  cwd?: string;
  root?: string;
  remote?: string;
}

export const LOCATION_KEYS = ["cwd", "root", "remote"] as const;

/** The location fields of a body, when each present one is a string; the rest is the caller's to read. */
export function locationOf(body: Record<string, unknown>): Location | undefined {
  const location: Location = {};
  for (const key of LOCATION_KEYS) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== "string") return undefined;
    location[key] = value;
  }
  return location;
}

/** A body that is not the declared shape. */
export function channelBodyRefusal(detail: string): { error: "body"; code: "body"; detail: string } {
  return { error: "body", code: "body", detail };
}

/** The hint names the tool the agent already has, not a terminal it may not: `panoma_context` enrols an unknown folder on its first call. */
export const NO_PROJECT = {
  error: "no-project",
  code: "no-project",
  detail: "No project in the catalog matches this folder.",
  hint: "Call panoma_context for this folder first: it enrols the project, and then this call finds it.",
} as const;

export type CatalogProject = Awaited<ReturnType<typeof listProjectRoots>>[number];

/**
 * The catalog project an agent stands in, from the location the MCP client describes: the
 * folder first, then the repository root it found, then the remote — one question to the
 * catalog per hint, in that order, so a folder the catalog knows wins over a remote that two
 * copies share. Never a path from the body reaching the disk: the project is resolved against
 * what the catalog recorded.
 */
export async function projectAt(
  database: Database,
  location: { cwd?: string; root?: string; remote?: string },
): Promise<CatalogProject | undefined> {
  const hints: { cwd?: string; remote?: string }[] = [];
  if (location.cwd) hints.push({ cwd: location.cwd });
  if (location.root && location.root !== location.cwd) hints.push({ cwd: location.root });
  if (location.remote) hints.push({ remote: location.remote });
  for (const hint of hints) {
    const found = await resolveProject(database, hint);
    if (found) return { id: found.id, name: found.name, slug: found.slug, root: found.root, identity: found.identity };
  }
  return undefined;
}
