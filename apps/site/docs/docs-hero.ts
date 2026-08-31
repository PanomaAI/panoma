import { MARK } from "../landing/panoma-mark";

/** Letter bounds inside the 1024 viewBox, same numbers the landing swarm uses. */
const BOX = { x: 280.5, y: 222.1, w: 519.9, h: 585.3 };

const PATHS = [MARK.ink, MARK.paneLT, MARK.paneLB, MARK.paneCT, MARK.paneCB, MARK.paneRT, MARK.paneRB];

/**
 * One composition: the Panoma mark, with the word `DOCS` under it.
 * The swarm samples this drawing once and holds it.
 */
export function paintMarkAndDocs(
  ctx: CanvasRenderingContext2D,
  size: number,
  family: string,
  width: number,
): void {
  const narrow = width < 700;
  /* The logo stops eating the word: it keeps leading, but DOCS has its own body. */
  const markH = size * (narrow ? 0.52 : 0.62);
  const scale = markH / BOX.h;
  const lift = size * (narrow ? 0.22 : 0.18);

  ctx.save();
  ctx.translate(0, -lift);
  ctx.scale(scale, scale);
  ctx.translate(-(BOX.x + BOX.w / 2), -(BOX.y + BOX.h / 2));
  for (const d of PATHS) ctx.fill(new Path2D(d));
  ctx.restore();

  const fontSize = narrow
    ? Math.max(68, Math.min(90, width * 0.19))
    : Math.max(82, Math.min(104, width * 0.09));
  ctx.font = `850 ${fontSize}px ${family}, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const wordY = markH * 0.5 - lift + Math.max(16, fontSize * 0.16);
  /* The outer stroke prevents gaps in diagonals and curves when sampling the grid. */
  ctx.lineWidth = Math.max(1.8, fontSize * 0.055);
  ctx.lineJoin = "round";
  ctx.strokeText("DOCS", 0, wordY);
  ctx.fillText("DOCS", 0, wordY);
}
