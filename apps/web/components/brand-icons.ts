import type { IconType } from "react-icons";
import {
  SiClaude,
  SiCursor,
  SiGithubcopilot,
  SiGooglegemini,
  SiIntellijidea,
  SiOpencode,
  SiSublimetext,
  SiWebstorm,
  SiWindsurf,
  SiZedindustries,
} from "react-icons/si";
import { VscOpenai, VscVscode } from "react-icons/vsc";

/**
 * The logo of each program, by its identifier.
 *
 * The panel rendered a generic bracket for "Editor" and some sparks for the agent, so five
 * different rows looked the same and you had to read them all. A mark is recognized before reading
 * it —that's what it exists for— and here recognition is exactly what is needed: you look for "the
 * one for Cursor," not "the second one on the list."
 *
 * It lives in its own file because it is used by the two screens that offer to open a project: the
 * catalog panel and the record. With the duplicated table, adding an agent fixed one and left the
 * other with the generic icon — and that difference is read as a failure.
 *
 * Anything that does not have a brand on the icon package falls into the generic of whoever renders
 * it. Inventing a similar logo would be worse than not putting one: an almost identical logo reads
 * like that of another product.
 */
export const BRAND_ICONS: Record<string, IconType> = {
  // Editores
  cursor: SiCursor,
  code: VscVscode,
  windsurf: SiWindsurf,
  subl: SiSublimetext,
  webstorm: SiWebstorm,
  idea: SiIntellijidea,
  zed: SiZedindustries,
  // Encoding agents
  "claude-cli": SiClaude,
  "codex-cli": VscOpenai,
  "gemini-cli": SiGooglegemini,
  "cursor-agent": SiCursor,
  "copilot-cli": SiGithubcopilot,
  opencode: SiOpencode,
  // Desktop apps share the brand with their terminal agent on purpose: it's the same tool. What
  // separates them is the label underneath, which says where you end up.
  "claude-app": SiClaude,
  "chatgpt-app": VscOpenai,
};
