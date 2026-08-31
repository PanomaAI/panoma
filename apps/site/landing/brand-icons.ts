import type { IconType } from "react-icons";
import { SiClaude, SiCursor } from "react-icons/si";
import { VscOpenai } from "react-icons/vsc";

/**
 * The logo of the three agents that the landing mentions, and only those three.
 *
 * The panel has its own map in `apps/web/components/brand-icons.ts` with seventeen entries: the
 * editors it knows how to open, the terminal agents, and the two desktop apps. They are not needed
 * here, because nothing opens here — the landing looks like Claude Code, Codex, and Cursor in the
 * memory scene and in the row of agents, and that's it.
 *
 * Copying three entries instead of importing seventeen is what prevents `apps/site` from depending
 * on `apps/web`, which is exactly what makes this application deployable. `brand-icons.test.ts`
 * checks that no landing agent is left without a brand: if a fourth one comes in tomorrow, the
 * test turns red instead of leaving the generic backup robot running in production.
 */
export const BRAND_ICONS: Record<string, IconType> = {
  "claude-cli": SiClaude,
  "codex-cli": VscOpenai,
  "cursor-agent": SiCursor,
};
