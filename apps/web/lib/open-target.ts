/**
 * Open a project on the disk: the folder, the editor, or a terminal.
 *
 * This was written TWICE, letter by letter: `open()` in `components/open-folder.tsx` and
 * `launch()` in `components/open-menu.tsx`. The same call, the same unpacking, the same way of
 * combining the pattern with the track, the same network down message. The only difference was
 * that one sends `with` and the other does not.
 *
 * And since the two lived in `.tsx`, nobody tried them: the tests on this website do not transform
 * `.tsx` on purpose. Here they do, and their test is next to it.
 *
 * The clue comes together with the reason and is not shown separately because they are a single
 * sentence: `/api/open` sends the what in `error` —'could not open Cursor'— and the how to fix it
 * in `hint` —'is it installed?'—. Showing only the what leaves the reader without the half that is
 * useful.
 */
import { postJson } from "./api";

/*
  The five words that `/api/open` understands (see its path: it rejects any other with a 400).
  They are written here once so that the type of the callers does not fall short again:
  `open-folder.tsx` reported three and `open-menu.tsx` five, each on their own.
 */
export type Tool = "folder" | "editor" | "terminal" | "agent" | "app";

export type OpenOutcome = { ok: true } | { ok: false; message: string };

export async function openTarget(
  input: { id: string; tool: Tool; with?: string },
  /** The phrase on this screen for when there is no server on the other side. */
  unreachable: string,
): Promise<OpenOutcome> {
  const result = await postJson<Record<string, never>>(
    "/api/open",
    { id: input.id, tool: input.tool, ...(input.with ? { with: input.with } : {}) },
    unreachable,
    (payload) => [payload.error, payload.hint].filter(Boolean).join(" "),
  );
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}
