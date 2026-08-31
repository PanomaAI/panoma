"use client";

import { useEffect, useRef } from "react";
import { MARK } from "./panoma-mark";
import {
  PointBuckets,
  canvasPixelRatio,
  releaseScratchCanvas,
  scratchContext,
} from "./swarm-paint";
import { lineBudget, wrapLine } from "./swarm-wrap";
import { SWARM_PERIOD, swarmBind, swarmClock } from "./swarm-bind";
import { landingParticleColor, landingParticlePalette } from "./landing-theme";
import styles from "./landing-swarm.module.css";

/*
  The swarm.
  The particles do not decorate: it's the projects. They start in disorder, orbiting around the P
  in elliptical orbits with different periods —the inner ones move more, like in a real orbit—,
  and when the tower scans they arrange themselves and form a phrase. The phrase holds, falls
  apart, and disorder returns with the next one.
  That is the product told without a single extra word: it takes what is lying around on the disc
  and puts it in order. And the one in charge is the logo — the swarm reorganizes to the rhythm of
  the window's light sweep, not at its own pace.
  How the text is formed: the sentence is painted on a separate canvas, its pixels are read, and a
  grid of dots is sampled with ink. Each particle receives one of those dots as a destination and
  arrives with a damped spring. The ones left over — there are always leftovers — continue
  orbiting: on the disk, there are more projects than can fit in a sentence.
  Everything goes in a `<canvas>` 2D and not in three dimensions: the text is flat, and a WebGL
  mesh for this would weigh twenty times more without looking better. A single
  `requestAnimationFrame`, a few thousand points, and a `fill` per opacity layer.
  And not a single new object per frame: the sampling canvas, the point clouds, and the
  distribution tables are reserved once —see `swarm-paint.ts` — because at sixty frames per second
  what is thrown away weighs more than what is kept.
 */

/*
  A form that the swarm knows how to adopt: either some lines of text, or any drawing. The drawing
  receives the canvas already centered and scaled and paints whatever it wants in black; from that
  the points come out. With that, the same engine raises the logo, a phrase, a bunch of scattered
  folders, or a horizon — without knowing what it is forming.
 */
export type SwarmShape =
  | { kind: "text"; lines: string[] }
  | { kind: "draw"; paint: (ctx: CanvasRenderingContext2D, size: number, family: string, width: number) => void };

/* One turn: the same rhythm of the tower. Five shapes per cycle with the mark. */
const PERIOD = SWARM_PERIOD;

/* The letter inside the viewBox 0 0 1024 1024, measured with getBBox on the served SVG. */
const MARK_BOX = { x: 280.5, y: 222.1, w: 519.9, h: 585.3 };

/*
  The cycle order: mark, phrase, mark, phrase… The lyrics return every two forms and act as a
  chorus, so whoever reaches the middle of the turn sees it the same. Linking the four phrases in
  a row left the mark appearing once every twenty seconds — too little for a page whose job is for
  the mark to be recognized.
 */

/*
  The radius of the mouse and the force with which it moves away. Enough to open a clearing and
  break a letter as it passes, not so much that the sentence ceases to be readable when crossed.
 */
const POINTER_R = 132;
/*
  Squared, which is how it is compared inside the loop: this way the square root is only taken
  from the few points that are actually inside the circle.
 */
const POINTER_R2 = POINTER_R * POINTER_R;
const POINTER_PUSH = 0.9;

type Dot = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /* The orbit at rest: proper center, radii, phase, and angular velocity. */
  ox: number;
  oy: number;
  rx: number;
  ry: number;
  phase: number;
  speed: number;
  /* The destiny in the sentence, or null if this particle happened to continue orbiting. */
  tx: number | null;
  ty: number | null;
  /* How much light it has: it goes up when it reaches its place and goes down when released. */
  glow: number;
  size: number;
  /** Index on the palette, when there is one. */
  hue: number;
  /** Where it stays perched while the block has not been seen. */
  floorX: number;
  floorY: number;
};

/*
  The sampling goes in two stages — painting and reading — and not in one, because the expensive
  part is painting: a canvas the size of the sheet and a reading of its pixels, about three
  megabytes. The search for the grid step tested ten densities and painted all ten; now it paints
  once and counts ten times over the same pixels, which is exactly the same number and costs a
  tenth.
 */

/*
  The ink of a shape: its pixels and on which row of the canvas the read band starts.
  It starts at zero for a drawing, and for a sentence it starts just above the first letter. A
  sentence takes up about two hundred pixels of the nine hundred of the fold, and reading them all
  was asking for four and a quarter megabytes per reading to look at two-thirds of nothing:
  sixteen readings per construction, seventy megabytes of external memory to the trash. The band
  reduces that to about twelve, and what is sampled is exactly the same pixel.
 */
type Ink = { data: Uint8ClampedArray; width: number; height: number; top: number };

/** A margin of grace around the measured ink, in case the stroke goes beyond the calculation. */
const INK_MARGIN = 6;

/** Paint a sentence on the shared canvas and return the strip where its ink has fallen. */
function inkOfPhrase(
  lines: string[],
  width: number,
  height: number,
  fontSize: number,
  family: string,
): Ink | null {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const ctx = scratchContext(w, h);
  if (!ctx) return null;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  /*
    `ctx.font` does not understand variables CSS: you have to give it the family already resolved
    or the canvas stays silent in its default «10px sans-serif» and the sampling comes out in
    thumbnail.
   */
  ctx.font = `800 ${fontSize}px ${family}, system-ui, sans-serif`;

  const lineHeight = fontSize * 0.94;
  const top = h / 2 - ((lines.length - 1) * lineHeight) / 2;

  /*
    The edges of the band are questioned, they are not estimated by eye from the body: with weight
    800 and accented capitals —WHO, PORTABLE— the ink rises more than expected.
   */
  let inkTop = h;
  let inkBottom = 0;
  lines.forEach((line, index) => {
    const y = top + index * lineHeight;
    const metrics = ctx.measureText(line);
    inkTop = Math.min(inkTop, y - metrics.actualBoundingBoxAscent);
    inkBottom = Math.max(inkBottom, y + metrics.actualBoundingBoxDescent);
    ctx.fillText(line, w / 2, y);
  });

  if (!(inkBottom > inkTop)) return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h, top: 0 };

  const bandTop = Math.max(0, Math.floor(inkTop - INK_MARGIN));
  const bandBottom = Math.min(h, Math.ceil(inkBottom + INK_MARGIN));
  const bandHeight = Math.max(1, bandBottom - bandTop);

  return {
    data: ctx.getImageData(0, bandTop, w, bandHeight).data,
    width: w,
    height: bandHeight,
    top: bandTop,
  };
}

/** Paint any drawing on the shared canvas, centered and at the requested scale. */
function inkOfDraw(
  paint: (ctx: CanvasRenderingContext2D, size: number, family: string, width: number) => void,
  width: number,
  height: number,
  size: number,
  centerX: number,
  centerY: number,
  family: string,
): Ink | null {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const ctx = scratchContext(w, h);
  if (!ctx) return null;

  ctx.save();
  ctx.translate(centerX, centerY);
  paint(ctx, size, family, w);
  ctx.restore();

  /*
    The drawing is not dimensioned: the signature at the bottom is sized against the width of the
    block and not against the `size` it receives, so its ink falls far outside what that number
    would suggest. Here the band is the canvas.
   */
  return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h, top: 0 };
}

/** How many seats would this ink give at a given grid step. Count only: no reservation. */
function countInk(ink: Ink, step: number): number {
  const { data, width, height, top } = ink;
  let seats = 0;
  /*
    The grid is traversed in canvas coordinates, not band coordinates: the first step falls where
    it would have fallen reading the entire fold. Starting at the edge of the band, the grid would
    move to one step less and other points would appear.
   */
  for (let y = firstStep(top, step); y < top + height; y += step) {
    const row = (y - top) * width;
    for (let x = 0; x < width; x += step) {
      if (data[(row + x) * 4 + 3]! > 128) seats += 1;
    }
  }
  return seats;
}

/** The first line of the grid that falls within the band, in phase with the canvas. */
function firstStep(top: number, step: number): number {
  return Math.ceil(top / step) * step;
}

/** The seats of this ink, with the grid tremor that every shape asks for. */
function pointsOfInk(ink: Ink, step: number, jitter: number): { x: number; y: number }[] {
  const { data, width, height, top } = ink;
  const points: { x: number; y: number }[] = [];
  for (let y = firstStep(top, step); y < top + height; y += step) {
    const row = (y - top) * width;
    for (let x = 0; x < width; x += step) {
      if (data[(row + x) * 4 + 3]! > 128) {
        points.push({
          x: x + (Math.random() - 0.5) * jitter,
          y: y + (Math.random() - 0.5) * jitter,
        });
      }
    }
  }
  return points;
}

/*
  The grid spacing is searched in both directions until it approaches about 2,400 seats. Before,
  it only knew how to increase —decrease density if there were leftover points— and never
  decrease, so with a large body it stayed at 800 points and the sentence came out broken. All
  reasonable steps are tested and the one that deviates least from the target wins.
  With more seats, the stroke of each letter fills in and the phrase can be read at a glance,
  which is what is asked of a headline.
 */
const WANT = 2400;

/*
  The body below which the letter ceases to be read, made of dots.
  It comes out of the account backwards: for a stroke to capture two points with the finest grid
  allowed — two pixels — the stroke has to measure four, and the stroke of the Geist at weight 800
  is 0.14 of its body. Four divided by 0.14 is twenty-eight and something.
 */
const MIN_BODY = 28.6;
const PROBE_FROM = 3;
const PROBE_TO = 12;

/*
  The chosen step is saved. The same fold with the same phrase always gives the same step, and
  reconstructing is normal: when finishing loading the font, when rotating the phone and
  returning, when a scrollbar appears and disappears. Without this table, each of those times it
  would repaint ten canvases per line.
 */
const stepMemo = new Map<string, number>();

function gridStep(
  lines: string[],
  width: number,
  height: number,
  fontSize: number,
  family: string,
): number {
  const memo = `${width}x${height}|${Math.round(fontSize)}|${family}|${lines.join(" ")}`;
  const known = stepMemo.get(memo);
  if (known !== undefined) return known;

  /*
    Without text there is nothing to probe—the signature is just a drawing—and the minimum of an
    entry leaves the comparison where it was.
   */
  const seats = new Array<number>(PROBE_TO - PROBE_FROM + 1).fill(1);
  for (const line of lines) {
    const ink = inkOfPhrase([line], width, height, fontSize, family);
    if (!ink) break;
    for (let probe = PROBE_FROM; probe <= PROBE_TO; probe += 1) {
      const at = probe - PROBE_FROM;
      seats[at] = Math.max(seats[at]!, countInk(ink, probe) * 2);
    }
  }

  let step = PROBE_FROM;
  let best = Number.POSITIVE_INFINITY;
  for (let probe = PROBE_FROM; probe <= PROBE_TO; probe += 1) {
    const miss = Math.abs(seats[probe - PROBE_FROM]! - WANT);
    if (miss < best) {
      best = miss;
      step = probe;
    }
  }

  /*
    The page has two swarms and a few widths; if someone drags the edge of the window for a
    minute, the entire table is thrown and it starts over.
   */
  if (stepMemo.size > 24) stepMemo.clear();
  stepMemo.set(memo, step);
  return step;
}

/** The brand, as a drawing: its seven routes climbed to the requested height. */
export function paintMark(ctx: CanvasRenderingContext2D, size: number): void {
  const scale = size / MARK_BOX.h;
  ctx.scale(scale, scale);
  ctx.translate(-(MARK_BOX.x + MARK_BOX.w / 2), -(MARK_BOX.y + MARK_BOX.h / 2));
  /*
    The letter brings its counterpunch as an inverse subtrace, so the window gap comes out by
    itself; on top go the six panels, which are what turn it into this P.
   */
  for (const d of [MARK.ink, MARK.paneLT, MARK.paneLB, MARK.paneCT, MARK.paneCB, MARK.paneRT, MARK.paneRB]) {
    ctx.fill(new Path2D(d));
  }
}

export function LandingSwarm({
  shapes,
  order,
  intro = 0,
  scale = 0.76,
  delay = 0,
  palette,
  wakeOnView = false,
  stayFormed = false,
}: {
  /** The forms it knows how to adopt, in the order in which they are numbered. */
  shapes: SwarmShape[];
  /** The route: `shapes` indexes, one entry per turn. */
  order: number[];
  /** Milliseconds that the first form lasts too long when entering. */
  intro?: number;
  /** How much of the stage a drawing occupies, from 0 to 1. */
  scale?: number;
  /** Wait before starting the clock; allow chaining an entry without restarting the swarm. */
  delay?: number;
  /** If it comes, each point takes a color from here instead of the ink on the page. */
  palette?: string[];
  /** Sleep perched on the ground until the block enters the screen, and then take off. */
  wakeOnView?: boolean;
  /**
   * After forming the first composition, it keeps it. Points with a base maintain minimal
   * residual movement, and the remnants continue orbiting around the shape.
   */
  stayFormed?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const inkByShade = landingParticlePalette(host);
    const stillInk = landingParticleColor(host, 0.82);

    const quiet = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dots: Dot[] = [];
    let targets: { x: number; y: number }[][] = [];
    /*
      The seats of each shape, already arranged by their angle around the center.
      They were arranged within `assign`, that is, in the frame of each sentence change: two
      thousand four hundred points arranged again every four and a half seconds to give exactly
      the same list, because neither the destinations nor the center move outside of `build()`.
      Here it is arranged once per shape and saved.
     */
    let rings: { x: number; y: number; a: number }[][] = [];
    let frame = 0;
    let alive = true;
    let startedAt = 0;
    let onScreen = false;
    let hydrated = false;
    /*
      The milliseconds that the swarm has been without anyone watching it: they are subtracted
      from the navigator's clock so that the lap continues from where it left off.
     */
    let drift = 0;

    /*
      The frame cubes: one layer per opacity step, and with palette one per step and color. They
      are reserved once for the entire life of the swarm and are emptied on each turn — before
      they were a `Map` and a handful of new `Path2D` every sixteen milliseconds, which is native
      memory that the collector releases whenever it feels like it.
     */
    const tones = palette?.length ?? 1;
    const keys = palette ? 10 * tones : 10;
    const buckets = new PointBuckets();

    /*
      The mouse. `px` /`py` is where it is, and `sx` /`sy` is where the swarm thinks it is: the
      smoothed version lags a bit behind, and that delay is exactly what turns a push into a
      trail. `grip` goes up when entering and down when leaving so that nothing appears or
      disappears suddenly.
     */
    let px = -9999;
    let py = -9999;
    let sx = -9999;
    let sy = -9999;
    let grip = 0;
    let wanted = 0;

    /*
      The dream. With `wakeOnView` the points start resting on the floor of the block —like fallen
      dust— and do not lift off until the block enters the screen. `lift` goes from 0 to 1 and is
      what mixes the floor with the flight: being a smooth ramp, what is seen is the swarm rising,
      not appearing.
     */
    let lift = wakeOnView ? 0 : 1;
    let awake = !wakeOnView;
    let wakeAt = -1;

    /*
      The scenario: a single center for the brand and for the phrases. That they share a site is
      what makes the text open in the phrase instead of jumping from one side to the other.
      It is measured separately from the `build` and stored, because the drawing loop required it
      in each frame: two `getBoundingClientRect` and one `querySelector` sixty times per second
      per swarm, which forces the browser to redo the layout before responding. The center only
      moves when the block changes size, and that is already signaled by the `ResizeObserver`.
     */
    let markX = 0;
    let markY = 0;
    let stageH = 0;
    let family = "system-ui";
    /* How much each point shrinks compared to its usual size. One on a wide screen. */
    let dotScale = 1;

    const measure = () => {
      /*
        The stage is a brother of the canvas, not a son: the canvas goes in its own absolute layer
        and the gap lives in the flow. Searching for it inside `host` it was never found and
        everything fell to the center due to the backup value — which hit by chance while the
        layer and the gap measured the same, and stopped hitting as soon as they did not.
       */
      const stage =
        host.parentElement?.querySelector<HTMLElement>("[data-swarm-slot]") ??
        host.querySelector<HTMLElement>("[data-swarm-slot]");
      const box = host.getBoundingClientRect();
      const stageBox = stage?.getBoundingClientRect();

      width = Math.max(1, Math.round(box.width));
      height = Math.max(1, Math.round(box.height));
      markX = stageBox ? stageBox.left - box.left + stageBox.width / 2 : width / 2;
      markY = stageBox ? stageBox.top - box.top + stageBox.height / 2 : height / 2;
      stageH = stageBox ? stageBox.height : height * 0.6;
      /*
        The royal family, taken from the node itself: it is where Next sets up the display
        typography variable of the landing.
       */
      family =
        getComputedStyle(host).getPropertyValue("--font-landing-display").trim() || "system-ui";

      /*
        The footprint of everything that matters to `build`. As long as it doesn't change, there
        is nothing to rebuild: `ResizeObserver` also notifies about the measures that have not
        moved —starting with the first, which always arrives— and each notification cost the
        entire sampling.
       */
      return `${width}x${height}|${Math.round(markX)},${Math.round(markY)},${Math.round(stageH)}|${family}`;
    };

    const build = () => {
      const dpr = canvasPixelRatio(width, height, window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      /*
        The beams, already distributed for this width.
        On any screen that is not a phone, the cap is longer than the longest line written by hand
        and this doesn't affect anything: the sentences come out exactly as they were written. On
        a mobile, however, a line of twenty-six characters does not fit in any body where the text
        can be read —it didn't even fit before: it went out of the block and was cut off on both
        sides—, so it gets distributed. See `swarm-wrap.ts`.
       */
      const budget = lineBudget(width, MIN_BODY);
      const wrapped = shapes.map((shape) =>
        shape.kind === "text" ? shape.lines.flatMap((line) => wrapLine(line, budget)) : [],
      );

      /*
        The body is measured against the available width: the longest line dictates, so that 'WHO
        WROTE' never goes beyond the sides.
       */
      const lines = wrapped.flat();
      const longest = Math.max(8, ...lines.map((line) => line.length));
      const fontSize = Math.max(24, Math.min(86, ((width * 0.78) / longest) * 1.62));

      /*
        And the grid never thicker than half of the stroke.
        The survey seeks a number of seats, which is what matters to a large body. For a small
        body, that same number comes from a grid too loose for the thickness of the letter: with
        the stroke at 3.4 px and the step at 3, a stroke would pick up **one** dot and the word
        could not be read. Here a ceiling is put on it taken from the stroke itself.
        The 0.14 is the thickness of the Geist in weight 800 measured against its body, and the
        1.9 is what the desk already achieved, where it reads well. Checked at six widths: from
        700 px upwards this ceiling does not change the spacing chosen by the survey; below it
        lowers it to two, which is exactly where the problem was.
       */
      const strokeCap = Math.max(2, Math.round((fontSize * 0.14) / 1.9));
      const step = Math.min(gridStep(lines, width, height, fontSize, family), strokeCap);
      const shift = markY - height / 2;

      /*
        And the dot shrinks with the letter.
        This was the fundamental flaw, and the one that doesn't show up in the density numbers:
        the dot measured 2.7 px and the stroke it had to draw, 3.4. Each dot was as wide as the
        entire letter, so the word came out like a string of blotches. On a desktop, the dot is a
        quarter of the stroke, and that's why it is readable there.
        Above 41 px body the scale is one and the sizes are the usual: the desktop doesn't notice.
        Below, the point goes down with the letter.
       */
      dotScale = Math.min(1, fontSize / 41);

      /* The drawings occupy a part of the stage; the text is already measured by its body. */
      const drawSize = Math.min(stageH * scale, width * 0.58);
      const drawStep = Math.max(3, Math.round(step * 0.82));

      targets = shapes.map((shape, at) => {
        if (shape.kind === "text") {
          const ink = inkOfPhrase(wrapped[at] ?? shape.lines, width, height, fontSize, family);
          /*
            The sampling of the text comes out centered on the canvas; it is taken to the stage.
            The trembling is half-step: aligned to the pixel it reads like printed pattern, and at
            full step the stroke comes out spongy.
           */
          return ink
            ? pointsOfInk(ink, step, step * 0.5).map((point) => ({ x: point.x, y: point.y + shift }))
            : [];
        }
        const ink = inkOfDraw(shape.paint, width, height, drawSize, markX, markY, family);
        return ink ? pointsOfInk(ink, drawStep, drawStep) : [];
      });

      /*
        The angle of each seat is taken once and arranged by that number. Sorting with a
        comparator that calls `Math.atan2` required two arctangents per comparison: fifty-four
        thousand for two thousand four hundred angles.
       */
      const most = Math.max(...targets.map((set) => set.length));
      rings = targets.map((set) =>
        set
          .map((point) => ({
            x: point.x,
            y: point.y,
            a: Math.atan2(point.y - markY, point.x - markX),
          }))
          .sort((a, b) => a.a - b.a),
      );
      /*
        `rings` already contains the coordinates. Keeping all the objects from `targets` also
        duplicated the map of each sentence until the tab was closed.
       */
      targets = [];

      /*
        More points than any shape ever uses: the surplus is what keeps orbiting while the rest
        arranges itself, and it is what makes the swarm look like a whole portfolio and not the
        exact number of pieces to write four words.
       */
      /*
        The surplus is calculated by area, not by a fixed number: the field occupies the entire
        fold and what needs to remain constant is the density, not the count. One per 110 px²
        creates a populated sky without reaching a pattern. With 9,000 points the frame takes
        about 2.5 ms, measured — there's enough margin for sixty per second.
       */
      const field = Math.round((width * height) / 110);
      /*
        The surplus scales with the field: nine hundred points are sky in the fold of the desk and
        confetti that buries the word at the foot of a telephone.
       */
      const extra = Math.min(900, Math.round(field * 0.4));
      const count = Math.max(most + extra, Math.min(9600, field));

      /*
        The field, not a ring.
        Before, they all orbited around the same center and the result was a doughnut: a ring of
        points with the middle empty, which also left half the screen blank. Now each point has
        its own place spread across the fold and spins in a small ellipse around it. Resting is a
        whole sky, and when the letter forms the points come from all over instead of closing from
        a ring.
        The halftone is a grid with vibration and not pure randomness: randomly there appear
        clumps and open spaces that are read as dirt, and a clean grid is read as a printing
        pattern. The grid with vibration is the only thing that appears natural.
       */
      const columns = Math.max(1, Math.round(Math.sqrt((count * width) / Math.max(1, height))));
      const rows = Math.max(1, Math.ceil(count / columns));
      const cellW = width / columns;
      const cellH = height / rows;

      dots = Array.from({ length: count }, (_, i) => {
        const col = i % columns;
        const row = Math.floor(i / columns);
        const baseX = (col + 0.5 + (Math.random() - 0.5) * 0.92) * cellW;
        const baseY = (row + 0.5 + (Math.random() - 0.5) * 0.92) * cellH;

        /* The ones further inside deviate a little more: it gives depth without affecting the size. */
        const near =
          1 -
          Math.min(
            1,
            Math.hypot(baseX - markX, baseY - markY) / Math.max(1, Math.hypot(width, height) * 0.5),
          );

        return {
          x: baseX,
          y: baseY,
          vx: 0,
          vy: 0,
          ox: baseX,
          oy: baseY,
          rx: 12 + near * 30 + Math.random() * 16,
          ry: 10 + near * 24 + Math.random() * 14,
          phase: Math.random() * Math.PI * 2,
          speed: 0.1 + Math.random() * 0.26,
          tx: null,
          ty: null,
          glow: 0,
          size: (Math.random() < 0.16 ? 2.4 : 1.7) * dotScale,
          hue: i,
          /*
            The floor: scattered across the width and piled below with an irregular slope, which
            is how dust settles. A straight line would read like a ruler.
           */
          floorX: baseX,
          floorY: height - 4 - Math.random() ** 2 * 26,
        };
      });
    };

    /*
      Assignment of destinations. It is ordered by angle around the center so that no particle
      crosses the entire swarm: each one takes the spot that comes in its path, and thus the
      sentence closes from the outside in instead of getting mixed up.
     */
    const assign = (index: number) => {
      /* They already come sorted from `build()`: here they are only distributed. */
      const seats = rings[index] ?? [];
      const order = dots
        .map((dot, i) => ({ i, a: Math.atan2(dot.y - markY, dot.x - markX) }))
        .sort((a, b) => a.a - b.a);

      /*
        There are always extra particles, and the ones that are left over must be distributed
        throughout the ring. By placing the first ones and leaving out the last ones in the
        angular order, the surplus fell entirely into the same sector: a quarter of the sky
        remained unsettled while the rest formed. One is placed from each `dots/seats`, so the
        disorder that remains surrounds the phrase equally.
       */
      const ratio = seats.length / Math.max(1, order.length);
      let seat = 0;
      order.forEach((entry, i) => {
        const dot = dots[entry.i]!;
        const want = Math.floor((i + 1) * ratio);
        const target = want > seat ? seats[seat] : undefined;
        if (target) {
          dot.tx = target.x;
          dot.ty = target.y;
          seat += 1;
        } else {
          dot.tx = null;
          dot.ty = null;
        }
      });
    };

    /*
      It is heard on the window and not on the canvas: the canvas does not receive the mouse —it
      has `pointer-events: none` so as not to steal the click from the command— and yet the swarm
      has to find out where it passes.
     */
    const onMove = (event: PointerEvent) => {
      if (!onScreen || !hydrated) return;
      const box = host.getBoundingClientRect();
      px = event.clientX - box.left;
      py = event.clientY - box.top;
      if (grip === 0) {
        sx = px;
        sy = py;
      }
      wanted = px >= -80 && px <= width + 80 && py >= -80 && py <= height + 80 ? 1 : 0;
    };
    const onLeave = () => {
      wanted = 0;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave, { passive: true });
    window.addEventListener("blur", onLeave);

    /*
      Measuring is cheap —two rectangles— and it is needed now, because `onMove` compares against
      the width of the block. Sampling, on the other hand, waits for the typography to be set:
      that is the expensive part, and doing it beforehand gave the sentence in Helvetica and
      forced it to be repeated entirely. That's why the footprint of what has been built starts
      empty: nothing has been built yet.
     */
    measure();
    let built = "";

    /*
      Rebuild only if something that matters to the sampling has changed. The `ResizeObserver`
      always notifies when starting to look, and on a mobile it notifies again every time the
      browser bar hides: without this gate, each notification would redraw and read a canvas the
      size of the fold for each line and density.
     */
    const rebuild = (force = false) => {
      const shape = measure();
      if (!force && shape === built) return false;
      try {
        build();
        built = shape;
        hydrated = true;
      } finally {
        /*
          The shapes are already coordinated; the read bitmap does not have to stay taking up
          several megabytes throughout the visit.
         */
        releaseScratchCanvas();
      }
      return true;
    };

    /*
      It wakes up when it enters the screen, and only once: putting it back to sleep upon exiting
      would make anyone going up and down see it take off every time, which is exactly the
      opposite of a finish.
     */
    let viewer: IntersectionObserver | undefined;
    if (wakeOnView) {
      viewer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            awake = true;
            viewer?.disconnect();
          }
        },
        { threshold: 0.25 },
      );
      viewer.observe(host);
    }

    let phrase = 0;
    let held = -1;

    const draw = (raw: number) => {
      if (!alive) return;
      /*
        The swarm's clock is not the navigator's: it lacks the moments when no one was watching.
        Everything that moves —the cycle, the orbits, the takeoff— reads this one.
       */
      const now = raw - drift;
      if (startedAt === 0) startedAt = now;

      /*
        The clock freezes when the first composition is formed if this canvas should not go
        through more figures.
       */
      const elapsed = Math.max(0, now - startedAt - delay);
      const clock = swarmClock(elapsed, intro, stayFormed);

      const cycle = (clock % (PERIOD * order.length)) / PERIOD;
      const index = order[Math.floor(cycle) % order.length]!;
      const t = cycle % 1;

      if (index !== held) {
        held = index;
        phrase = index;
        assign(phrase);
      }

      /*
        The curve of the turn, in phase with the sweep of the tower. It starts forming and does
        not disperse: the sweep crosses the window in the first 12% of the cycle, so the first
        thing a newcomer sees is the light passing and the swarm organizing behind it. Starting in
        disorder left the visitor watching noise for two seconds.
        0 → 0.32 it closes over the phrase 0.32 → 0.74 it holds it 0.74 → 0.94 it releases and
        orbits again 0.94 → 1 loose, just before the next sweep
       */
      const bind = swarmBind(t, stayFormed);

      ctx.clearRect(0, 0, width, height);

      const spin = now / 1000;

      buckets.reset(dots.length, keys);

      /*
        The burst. When a shape is released, the orbit it returns to opens a quarter and then
        closes immediately: what is seen is the letter bursting outward before recomposing in the
        next sentence, instead of two drawings merging. It only acts while the release lasts, and
        it goes to the square so that the impact is sharp.
       */
      const release = t > 0.74 && t < 0.98 ? 1 - Math.abs((t - 0.82) / 0.16) : 0;
      const burst = Math.max(0, release) ** 2 * 0.2;
      const cx = markX;
      const cy = markY;

      /* The cursor drags its own position with delay: that's where the trail comes from. */
      /*
        The takeoff takes a little less than two seconds: shorter it feels like a jump and longer
        it makes someone who has already reached the end of the page wait. It goes by the clock
        and not by frame: counted in frames, an accelerated blink drags it along.
       */
      if (awake && lift < 1) {
        if (wakeAt < 0) wakeAt = now;
        lift = Math.min(1, (now - wakeAt) / 1750);
      }

      grip += (wanted - grip) * 0.1;
      sx += (px - sx) * 0.16;
      sy += (py - sy) * 0.16;

      for (const dot of dots) {
        /*
          Its place in the field, plus the push of the explosion: when a shape is released, each
          point moves a fifth of its length away from the center and returns. The letter bursts
          outward instead of merging with what comes.
         */
        const homeX =
          dot.ox + (dot.ox - cx) * burst + Math.cos(dot.phase + spin * dot.speed) * dot.rx;
        const homeY =
          dot.oy + (dot.oy - cy) * burst + Math.sin(dot.phase + spin * dot.speed) * dot.ry;

        const seated = dot.tx !== null && dot.ty !== null;
        let goalX = seated ? homeX + (dot.tx! - homeX) * bind : homeX;
        let goalY = seated ? homeY + (dot.ty! - homeY) * bind : homeY;

        /* The settled form preserves a thread of movement without losing legibility. */
        if (stayFormed && seated && bind > 0.98) {
          goalX += Math.cos(spin * 0.55 + dot.phase) * 0.32;
          goalY += Math.sin(spin * 0.47 + dot.phase) * 0.32;
        }

        /*
          While it sleeps, its destination is its place on the ground; upon waking, the mixture slides
          toward its true destiny and the swarm rises.
         */
        if (lift < 1) {
          goalX = dot.floorX + (goalX - dot.floorX) * lift;
          goalY = dot.floorY + (goalY - dot.floorY) * lift;
        }

        /* Damped spring: it arrives with inertia, not in a jump. */
        dot.vx = (dot.vx + (goalX - dot.x) * 0.14) * 0.76;
        dot.vy = (dot.vy + (goalY - dot.y) * 0.14) * 0.76;

        /*
          And the sweep. Within the radius, the cursor pushes outward with a smooth fall —strong
          in the center, none at the edge—, so it opens a clearing as it passes and breaks the
          letter or the phrase right there. The position is not adjusted by hand: speed is added,
          which is what makes them later return on their own with their spring instead of staying
          stuck to the edge of the circle.
         */
        if (grip > 0.01) {
          const dx = dot.x - sx;
          const dy = dot.y - sy;
          /*
            It is measured squared and the square root only comes out for those who are within the
            radius. Previously it was taken for the seven thousand and the one for the six
            thousand eight hundred who were left outside was discarded: `Math.hypot` cost 0.16 ms
            per frame, and this costs 0.05 — the same calculation, measured on the page.
           */
          const reach = dx * dx + dy * dy;
          if (reach < POINTER_R2 && reach > 0.000001) {
            const distance = Math.sqrt(reach);
            const fall = (1 - distance / POINTER_R) ** 2;
            const push = fall * POINTER_PUSH * grip;
            dot.vx += (dx / distance) * push * 9;
            dot.vy += (dy / distance) * push * 9;
          }
        }

        dot.x += dot.vx;
        dot.y += dot.vy;

        const want = seated ? bind : 0;
        dot.glow += (want - dot.glow) * 0.08;

        /*
          The seated, more ink (0.72 → 0.8): the contrast with those who orbit is half of the
          legibility; the other half is the sampling jitter.
         */
        const alpha = (0.2 - bind * 0.11) + dot.glow * 0.8;
        const shade = Math.min(9, Math.max(0, Math.round(alpha * 10)));
        /*
          With a palette, there is one layer per color and opacity; without it, only by opacity.
          It is grouped the same because what is expensive is not the color, it is the number of
          calls to `fill`.
         */
        const key = palette ? shade * tones + (dot.hue % tones) : shade;
        buckets.push(key, dot.x, dot.y, dot.size + dot.glow * dotScale);
      }

      buckets.sort();
      for (let key = 0; key < keys; key += 1) {
        const seats = buckets.count[key]!;
        if (seats === 0) continue;

        if (palette) {
          ctx.globalAlpha = Math.floor(key / tones) / 10;
          ctx.fillStyle = palette[key % tones]!;
        } else {
          ctx.globalAlpha = 1;
          ctx.fillStyle = inkByShade[key]!;
        }

        /*
          The path of one's own context instead of a `Path2D` per layer: the context reuses its
          own between `beginPath` and `beginPath`, and a `Path2D` is a new native object that
          needs to be collected afterwards. Seventy per frame at sixty frames per second are four
          thousand objects per second thrown away.
         */
        ctx.beginPath();
        const from = buckets.start[key]!;
        for (let i = from; i < from + seats; i += 1) {
          const at = buckets.order[i]!;
          const size = buckets.size[at]!;
          ctx.rect(buckets.x[at]! - size / 2, buckets.y[at]! - size / 2, size, size);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      frame = requestAnimationFrame(draw);
    };

    /*
      The swarm only runs while it is being watched.
      They are two canvases at sixty frames per second with thousands of points each, and the page
      is long: the one on the fold kept calculating orbits with the visitor reading the caption,
      and the one at the foot had been running since the page loaded. Off-screen the whole clock
      stops, and when it comes back it resumes right where it left off: what stops is the
      spending, not the animation — nobody sees a jump or misses a turn.
      The browser already freezes `requestAnimationFrame` in a hidden tab, but it does not
      subtract that time from the clock: when returning, the phrase would have gone around three
      times at once. That is why the deduction applies here and also for the tab.
     */
    let started = false;
    let running = false;
    let pausedAt = 0;
    let releaseTimer = 0;

    const sync = () => {
      if (!alive || quiet || !started || !hydrated) return;
      const shouldRun = onScreen && !document.hidden;
      if (shouldRun && !running) {
        running = true;
        if (pausedAt > 0) drift += performance.now() - pausedAt;
        pausedAt = 0;
        frame = requestAnimationFrame(draw);
      } else if (!shouldRun && running) {
        running = false;
        pausedAt = performance.now();
        cancelAnimationFrame(frame);
      }
    };

    const start = () => {
      started = true;
      if (quiet) {
        lift = 1;
        /* Without movement: the first sentence, formed and still. It keeps saying the same thing. */
        assign(phrase);
        ctx.clearRect(0, 0, width, height);
        for (const dot of dots) {
          if (dot.tx === null || dot.ty === null) continue;
          ctx.fillStyle = palette ? palette[dot.hue % palette.length]! : stillInk;
          ctx.fillRect(dot.tx - 0.9, dot.ty - 0.9, 1.8, 1.8);
        }
        return;
      }
      sync();
    };

    let sampled = false;

    const hydrate = () => {
      if (!alive || !sampled || hydrated || !onScreen || document.hidden) return;
      rebuild(true);
      assign(phrase);
      held = phrase;
      start();
    };

    const release = () => {
      releaseTimer = 0;
      if (!alive || !hydrated || (onScreen && !document.hidden)) return;
      cancelAnimationFrame(frame);
      running = false;
      canvas.width = 1;
      canvas.height = 1;
      dots = [];
      targets = [];
      rings = [];
      buckets.release();
      built = "";
      hydrated = false;
      held = -1;
    };

    const scheduleRelease = () => {
      window.clearTimeout(releaseTimer);
      /*
        The margin prevents reconstructions if the user barely touches the edge of the block, but
        it soon releases a section that was already several folds back.
       */
      releaseTimer = window.setTimeout(release, 2400);
    };

    const watcher = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        onScreen = entry.isIntersecting;
        if (onScreen) {
          window.clearTimeout(releaseTimer);
          hydrate();
        } else {
          scheduleRelease();
        }
        sync();
      },
      { threshold: 0 },
    );
    watcher.observe(host);

    const onVisibility = () => {
      if (document.hidden) scheduleRelease();
      else {
        window.clearTimeout(releaseTimer);
        hydrate();
      }
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);

    /*
      Fonts first: sample before Bricolage loads, the sentence is in Helvetica. And the footer is
      not sampled until it actually comes on screen.
     */
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (!alive) return;
      sampled = true;
      hydrate();
    });

    const observer = new ResizeObserver(() => {
      /*
        Before the typography is in place, nothing is built: the `then` up there will do it, and
        doing it twice is paying for the sampling twice.
       */
      if (!alive || !sampled || !hydrated) return;
      if (!rebuild()) return;
      assign(phrase);
      if (quiet) start();
    });
    observer.observe(host);

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      window.clearTimeout(releaseTimer);
      observer.disconnect();
      viewer?.disconnect();
      watcher.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      canvas.width = 1;
      canvas.height = 1;
      dots = [];
      targets = [];
      rings = [];
      buckets.release();
    };
  }, [shapes, order, intro, scale, delay, palette, wakeOnView, stayFormed]);

  return (
    <div className={styles.field} ref={hostRef}>
      <canvas className={styles.canvas} ref={canvasRef} aria-hidden />
    </div>
  );
}
