/**
 * The image that Panoma composes locally to share a catalog.
 *
 * It is canvas on purpose: it doesn't need a network, it doesn't upload data, and the preview is
 * exactly the PNG that ends up on the disk. The mark, however, is not redrawn: it receives and
 * paints the official SVG so that the card that circulates has the same identity as the product.
 */

export const WIDTH = 1600;
export const HEIGHT = 900;
const MAX_PROJECT_SLOTS = 8;

export interface ShareProject {
  name: string;
  health: number;
  icon: CanvasImageSource | null;
  /** Use the official SVG of Panoma, dyed with the semantic color of health. */
  panomaMark?: boolean;
  /** Occupy the place of the real identity with a neutral piece, without suggesting another logo. */
  concealed?: boolean;
  /** The last box summarizes omitted projects; it is not a project nor does it have health. */
  summary?: boolean;
}

export interface CardData {
  projects: number;
  technologies: number;
  commits: number;
  /** Percentage of history signed by agents. `null` if there is no history to measure. */
  agents: number | null;
  user?: string | undefined;
  domain: string;
  /** The official SVG already loaded by the panel. */
  logo: HTMLImageElement | null;
  /** Maintain health and order; discreetly use the anonymous identity of Panoma. */
  featuredProjects: ShareProject[];
  texts: {
    title: string;
    projects: string;
    technologies: string;
    commits: string;
    agents: string;
    health: string;
    healthGood: string;
    healthReview: string;
    healthAttention: string;
    localFirst: string;
  };
}

const INK = "#0e0f11";
const INK_2 = "#5c6169";
const INK_3 = "#8b9098";
const RULE_COLOR = "#e7e8ea";
const PAPER = "#ffffff";
const FONT = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

export function drawCard(canvas: HTMLCanvasElement, data: CardData): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.strokeStyle = RULE_COLOR;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, WIDTH - 2, HEIGHT - 2);

  const margin = 82;
  brand(ctx, data.logo, margin, 66);

  ctx.font = `500 25px ${FONT}`;
  ctx.fillStyle = INK_3;
  ctx.textAlign = "right";
  ctx.fillText(data.domain, WIDTH - margin, 105);
  ctx.textAlign = "left";

  ctx.fillStyle = INK;
  fittedFont(
    ctx,
    data.texts.title,
    WIDTH - margin * 2,
    data.featuredProjects.length > 0 ? 86 : 102,
  );
  ctx.fillText(data.texts.title, margin, data.featuredProjects.length > 0 ? 278 : 350);

  if (data.featuredProjects.length > 0) {
    projectPanorama(ctx, data.featuredProjects, margin, 348, data.texts);
  }

  const ruleY = data.featuredProjects.length > 0 ? 655 : 505;
  rule(ctx, margin, ruleY, WIDTH - margin * 2);
  figures(ctx, data, margin, ruleY + 51);

  if (data.user) {
    ctx.fillStyle = INK_2;
    ctx.font = `550 27px ${FONT}`;
    ctx.fillText(data.user, margin, HEIGHT - 61);
  }

  ctx.fillStyle = INK_3;
  ctx.font = `500 23px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(data.texts.localFirst, WIDTH - margin, HEIGHT - 61);
  ctx.textAlign = "left";
}

function brand(
  ctx: CanvasRenderingContext2D,
  logo: HTMLImageElement | null,
  x: number,
  y: number,
): void {
  const side = 66;
  if (logo) {
    try {
      // The official SVG keeps a 1024×1024 canvas with space around it. Only that space is cropped
      // when painting it; the geometry of the brand is not modified or redrawn.
      ctx.drawImage(
        logo,
        logo.naturalWidth * (280 / 1024),
        logo.naturalHeight * (222 / 1024),
        logo.naturalWidth * (528 / 1024),
        logo.naturalHeight * (586 / 1024),
        x,
        y,
        60,
        side,
      );
    } catch {
      // The word retains the attribution even if the browser cannot decode the SVG.
    }
  }

  ctx.fillStyle = INK;
  ctx.font = `650 42px ${FONT}`;
  ctx.fillText("panoma", x + side + 22, y + 48);
}

/** Each application has its own bar: fuller means healthier. */
function projectPanorama(
  ctx: CanvasRenderingContext2D,
  projects: ShareProject[],
  x: number,
  y: number,
  texts: Pick<CardData["texts"], "health" | "healthGood" | "healthReview" | "healthAttention">,
): void {
  const visible = projects.slice(0, 8);
  const width = WIDTH - x * 2;
  const slot = width / visible.length;
  const iconTop = y + 50;
  const iconSide = 74;
  const meterWidth = Math.min(122, slot - 28);
  const meterHeight = 10;

  ctx.fillStyle = INK_3;
  ctx.font = `600 18px ${FONT}`;
  ctx.fillText(texts.health.toUpperCase(), x, y);
  healthLegend(ctx, WIDTH - x, y, texts);

  visible.forEach((project, index) => {
    const center = x + slot * index + slot / 2;
    const iconLeft = center - iconSide / 2;

    ctx.save();
    rounded(ctx, iconLeft, iconTop, iconSide, iconSide, 18);
    ctx.clip();
    ctx.fillStyle = PAPER;
    ctx.fill();
    if (project.concealed) {
      drawConcealedIdentity(ctx, iconLeft, iconTop, iconSide, index);
    } else if (project.icon) {
      try {
        if (project.panomaMark && project.icon instanceof HTMLImageElement) {
          drawTintedPanomaMark(
            ctx,
            project.icon,
            iconLeft + 15,
            iconTop + 11,
            44,
            50,
            project.summary ? INK : healthColor(project.health),
          );
        } else {
          ctx.drawImage(project.icon, iconLeft, iconTop, iconSide, iconSide);
        }
      } catch {
        // A failing icon does not prevent sharing the rest of the panorama.
      }
    }
    ctx.restore();
    ctx.strokeStyle = RULE_COLOR;
    ctx.lineWidth = 1.5;
    rounded(ctx, iconLeft, iconTop, iconSide, iconSide, 18);
    ctx.stroke();

    ctx.fillStyle = INK;
    ctx.font = `600 21px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(ellipsis(ctx, project.name, slot - 16), center, iconTop + 104);

    /*
      "+25 more" is the summary of the portfolio, not a fictional project. Keep its box in the
      row, but it does not receive a bar or a 0/100 that would turn the summary into a false
      alert.
     */
    if (project.summary) {
      ctx.textAlign = "left";
      return;
    }

    const meterX = center - meterWidth / 2;
    const meterY = iconTop + 128;
    ctx.fillStyle = RULE_COLOR;
    rounded(ctx, meterX, meterY, meterWidth, meterHeight, meterHeight / 2);
    ctx.fill();

    ctx.fillStyle = healthColor(project.health);
    rounded(
      ctx,
      meterX,
      meterY,
      Math.max(meterHeight, meterWidth * (clamp(project.health, 0, 100) / 100)),
      meterHeight,
      meterHeight / 2,
    );
    ctx.fill();

    ctx.fillStyle = healthColor(project.health);
    ctx.font = `650 19px ${FONT}`;
    ctx.fillText(`${project.health}/100`, center, iconTop + 171);
    ctx.textAlign = "left";
  });
}

/**
 * The same sealed identity used by the catalog. It retains the visual weight of the icon without
 * reconstructing its colors, silhouette, or initials; variations never come from data.
 */
function drawConcealedIdentity(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  side: number,
  index: number,
): void {
  ctx.fillStyle = "#111316";
  ctx.fillRect(x, y, side, side);

  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.085)";
  ctx.lineWidth = 1.5;
  const shift = [0, 7, -5, 12][index % 4] ?? 0;
  for (let line = -side; line < side * 2; line += 17) {
    ctx.beginPath();
    ctx.moveTo(x + line + shift, y + side);
    ctx.lineTo(x + line + side + shift, y);
    ctx.stroke();
  }
  ctx.restore();

  const maskWidth = 44;
  const maskHeight = 10;
  ctx.save();
  ctx.shadowColor = "rgba(255, 255, 255, 0.12)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#f4f4f2";
  rounded(ctx, x + (side - maskWidth) / 2, y + (side - maskHeight) / 2, maskWidth, maskHeight, 6);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "rgba(77, 81, 88, 0.7)";
  for (let slit = 0; slit < 4; slit += 1) {
    rounded(ctx, x + side / 2 - 11 + slit * 7, y + side / 2 - 2, 2, 4, 1);
    ctx.fill();
  }
}

/**
 * Reuse the geometry of the official SVG and change only its ink. The auxiliary canvas prevents
 * `source-in` from affecting any other part already painted on the card.
 */
function drawTintedPanomaMark(
  ctx: CanvasRenderingContext2D,
  logo: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void {
  const scale = 2;
  const mask = document.createElement("canvas");
  mask.width = Math.round(width * scale);
  mask.height = Math.round(height * scale);
  const maskCtx = mask.getContext("2d");
  if (!maskCtx) return;

  maskCtx.drawImage(
    logo,
    logo.naturalWidth * (280 / 1024),
    logo.naturalHeight * (222 / 1024),
    logo.naturalWidth * (528 / 1024),
    logo.naturalHeight * (586 / 1024),
    0,
    0,
    mask.width,
    mask.height,
  );
  maskCtx.globalCompositeOperation = "source-in";
  maskCtx.fillStyle = color;
  maskCtx.fillRect(0, 0, mask.width, mask.height);
  ctx.drawImage(mask, x, y, width, height);
}

function healthLegend(
  ctx: CanvasRenderingContext2D,
  right: number,
  y: number,
  texts: Pick<CardData["texts"], "healthGood" | "healthReview" | "healthAttention">,
): void {
  const items: [string, string][] = [
    [texts.healthGood, "#2eaa63"],
    [texts.healthReview, "#e4a30b"],
    [texts.healthAttention, "#ea5a58"],
  ];
  ctx.font = `550 17px ${FONT}`;
  const gap = 28;
  const widths = items.map(([label]) => 14 + ctx.measureText(label).width);
  const total = widths.reduce((sum, item) => sum + item, 0) + gap * (items.length - 1);
  let cursor = right - total;

  for (const [label, color] of items) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cursor + 5, y - 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK_2;
    ctx.fillText(label, cursor + 16, y);
    cursor += 14 + ctx.measureText(label).width + gap;
  }
}

function figures(ctx: CanvasRenderingContext2D, data: CardData, x: number, y: number): void {
  const items: [string, string][] = [
    [plainInteger(data.projects), data.texts.projects],
    [plainInteger(data.commits), data.texts.commits],
    [plainInteger(data.technologies), data.texts.technologies],
  ];
  if (data.agents !== null) items.push([`${data.agents}%`, data.texts.agents]);

  const width = WIDTH - x * 2;
  const slot = width / items.length;
  items.forEach(([value, label], index) => {
    const left = x + slot * index;
    if (index > 0) {
      ctx.strokeStyle = RULE_COLOR;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(left - 34, y - 10);
      ctx.lineTo(left - 34, y + 79);
      ctx.stroke();
    }

    ctx.fillStyle = INK;
    ctx.font = `650 54px ${FONT}`;
    ctx.fillText(value, left, y + 45);
    ctx.fillStyle = INK_3;
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText(label, left, y + 78);
  });
}

/**
 * The shared figures are visual identifiers, not amounts for calculations. Without regional
 * grouping, `1234` looks the same in Spanish, English, and any browser.
 */
export function plainInteger(value: number): string {
  return String(Math.max(0, Math.trunc(value)));
}

/**
 * Eight squares at most. If even one project is missing, the last one stops pretending the list is
 * complete and says exactly how many were left out.
 */
export function withProjectRemainder<T>(
  projects: T[],
  total: number,
  summary: (omitted: number) => T,
): T[] {
  const normalizedTotal = Math.max(0, Math.trunc(total));
  if (normalizedTotal <= MAX_PROJECT_SLOTS && projects.length >= normalizedTotal) {
    return projects.slice(0, normalizedTotal);
  }

  const visible = projects.slice(0, Math.min(MAX_PROJECT_SLOTS - 1, normalizedTotal));
  const omitted = Math.max(0, normalizedTotal - visible.length);
  return omitted > 0 ? [...visible, summary(omitted)] : visible;
}

function ellipsis(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && ctx.measureText(`${shortened}…`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}…`;
}

function fittedFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  preferredSize: number,
): void {
  let size = preferredSize;
  ctx.font = `650 ${size}px ${FONT}`;
  while (size > 62 && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = `650 ${size}px ${FONT}`;
  }
}

function healthColor(score: number): string {
  if (score >= 75) return "#2eaa63";
  if (score >= 50) return "#e4a30b";
  return "#ea5a58";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rule(ctx: CanvasRenderingContext2D, x: number, y: number, width: number): void {
  ctx.strokeStyle = RULE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.stroke();
}

function rounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

export function loadIcon(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ready) => {
    const img = new Image();
    img.onload = () => ready(img);
    img.onerror = () => ready(null);
    img.src = src;
  });
}
