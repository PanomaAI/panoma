"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { paintMark } from "./landing-swarm";
import {
  PointBuckets,
  canvasPixelRatio,
  releaseScratchCanvas,
  scratchContext,
} from "./swarm-paint";
import { landingParticlePalette } from "./landing-theme";
import styles from "./hero-entrance.module.css";

/*
  The entrance: two hands that meet and dissolve in the mark.
  The particles do not travel alongside the photos — they are sampled over the silhouette of each
  hand and move with it, as if they were the same matter. When touched, they detach from the
  fingers towards the P, without the burst in the middle that split the gesture into three acts.
  The swarm below collects the letter when this veil disappears.
  ── What this piece DOES NOT do, since 28-Aug-2026 ──────────────────────────────────
  For seven seconds and a bit, this took away the scroll from whoever arrived: `overflow: hidden`
  at the root, the body pinned with `position: fixed`, and a listener that would return the page
  to the top if anyone tried it. There was no way to skip it and it would start over on every
  visit.
  Four reference homepages were measured that day —Linear, Vercel, Stripe, and Raycast— reading
  `overflow` and `position` every few milliseconds from loading: **none block scrolling, at any
  moment**. And the NN/g usability research on hijacked scrolling explains why: most participants
  became disoriented, and —what hurts the most on a product homepage— they read it as if *the page
  is broken*. Whoever arrives looking for a specific piece of information is the least tolerant of
  all, and it is precisely that person who converts.
  So the veil stays and the kidnapping goes. Now:
  - **Not a single style of the document should be touched.** Neither `overflow`, nor `position`,
  nor the scroll.
  - **Any intention ends it**: wheel, finger, key, click. It fades away and that's it.
  - **There is a skip button**, visible and focusable, for those who don't know they can touch it.
  - **Once per session.** The second visit of the day goes directly to the page.
  - **And it doesn't appear if the browser restored the scroll to mid-page**: showing the entry to
  someone who reloads in section four is not an entry, it is a jump back. This, moreover, is what
  used to force fixing the body — Chrome's late restoration upset the destination of the
  particles. Without entry there is no destination to unsettle.
 */

type Point = { x: number; y: number };

type HandSample = { u: number; v: number; shade: number };

type IntroDot = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  side: -1 | 1;
  u: number;
  v: number;
  shade: number;
  delay: number;
  phase: number;
  size: number;
  planted: boolean;
};

const INTRO_DURATION = 7200;

/** How long the fade lasts when someone skips it. Short: they already said they want to continue. */
const SKIP_FADE_MS = 260;

/**
 * The 'already seen' mark on this tab.
 *
 * In `sessionStorage` and not in `localStorage` on purpose: the entry is the brand presentation
 * and it deserves to be seen once per visit, not once in a lifetime. And it dies when the tab is
 * closed, which is what makes it a presentation again tomorrow.
 */
export const INTRO_SEEN_KEY = "panoma:intro:seen";

function alreadySeen(): boolean {
  try {
    return window.sessionStorage.getItem(INTRO_SEEN_KEY) !== null;
  } catch {
    /*
      Without a session where to note it, it is taught: it is the presentation of the brand, and
      the cost of repeating it is much lower than not showing it ever.
     */
    return false;
  }
}

function markSeen(): void {
  try {
    window.sessionStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    /* Nothing to do. */
  }
}
const MORPH_FROM = 2680;
const MORPH_FOR = 2520;
const STAGGER = 640;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function ease(value: number): number {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

function easeInOut(value: number): number {
  const t = clamp(value);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function seeded(index: number, salt = 0): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function sampleLogo(
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  size: number,
): Point[] {
  /*
    The sampling canvas is the same one the swarm uses: one for the entire page, which grows and
    is reused. A new one for each call was three megabytes of native memory waiting for someone to
    pick them up.
   */
  const ctx = scratchContext(width, height);
  if (!ctx) return [];

  ctx.save();
  ctx.translate(centerX, centerY);
  paintMark(ctx, size);
  ctx.restore();

  const { data } = ctx.getImageData(0, 0, width, height);
  const step = width < 620 ? 2 : 3;
  const points: Point[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (data[(y * width + x) * 4 + 3]! > 100) points.push({ x, y });
    }
  }

  if (points.length <= 2100) return points;
  const stride = points.length / 2100;
  return Array.from({ length: 2100 }, (_, index) => points[Math.floor(index * stride)]!);
}

function sampleHand(image: HTMLImageElement, want: number): HandSample[] {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width < 2 || height < 2) return [];

  const ctx = scratchContext(width, height);
  if (!ctx) return [];
  ctx.drawImage(image, 0, 0);

  const { data } = ctx.getImageData(0, 0, width, height);
  const step = width > 700 ? 3 : 2;
  const raw: HandSample[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3]!;
      if (alpha < 28) continue;
      raw.push({
        u: (x + 0.5) / width,
        v: (y + 0.5) / height,
        shade: (data[i]! + data[i + 1]! + data[i + 2]!) / 3,
      });
    }
  }

  if (raw.length <= want) return raw;
  const stride = raw.length / want;
  return Array.from({ length: want }, (_, index) => raw[Math.floor(index * stride)]!);
}

function imageRect(
  box: DOMRect,
  host: DOMRect,
  naturalWidth: number,
  naturalHeight: number,
): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const w = naturalWidth * scale;
  const h = naturalHeight * scale;
  return {
    x: box.left - host.left + (box.width - w) / 2,
    y: box.top - host.top + (box.height - h) / 2,
    w,
    h,
  };
}

/*
  To wait for a photo without waiting forever.
  `complete` in true with `naturalWidth` in zero is a BROKEN image: it already finished, and it
  finished badly. Asking about both things would fall to the lower branch, which starts listening
  to a `load` and a `error` that have already passed — and there no one comes back. Since this
  veil is opaque and takes up the entire window, the page would remain completely covered, with
  the wheel scrolling under a blank rectangle. Send `complete`: if it already finished, it
  continues.
 */
function waitForImage(image: HTMLImageElement): Promise<void> {
  if (image.complete) {
    return image.naturalWidth > 0 && image.decode
      ? image.decode().catch(() => undefined)
      : Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => resolve();
    image.addEventListener("load", done, { once: true });
    image.addEventListener("error", done, { once: true });
  });
}

export function HeroEntrance({ skipLabel }: { skipLabel: string }) {
  /*
    Three states and not two. `finished` disassembles; `leaving` only paints the faded — jumping
    without it is a dry cut that looks like a loading failure.
   */
  const [finished, setFinished] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const leftImageRef = useRef<HTMLImageElement>(null);
  const rightImageRef = useRef<HTMLImageElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const fade = useRef<number | undefined>(undefined);

  /*
    Exit, by any means. Idempotent because it will be called multiple times: whoever scrolls with
    their finger triggers `touchstart` and `wheel` almost at the same time.
   */
  const leave = useCallback(() => {
    setLeaving((already) => {
      if (already) return already;
      markSeen();
      window.clearTimeout(fade.current);
      fade.current = window.setTimeout(() => setFinished(true), SKIP_FADE_MS);
      return true;
    });
  }, []);

  /*
    ── The decision of whether this is taught at all ──────────────────────────────────────
    It goes in an effect and not in the first render because the three responses live in the
    browser, and the server does not have them: rendering it in the HTML and then removing it
    would be a blink. The cost is that the input starts one frame late, which is not visible.
   */
  useEffect(() => {
    if (finished) return;

    /* Who asked for less movement does not receive a seven-second movie. */
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setFinished(true);
      return;
    }
    /* The visitor has already seen it today. */
    if (alreadySeen()) {
      setFinished(true);
      return;
    }
    /*
      And the browser restored the scroll to the middle of the page: anyone who reloads in section
      four wants to return to section four. Before, this was 'fixed' by pinning the document to
      the top; now it is respected, which is what should have been done from the beginning.
     */
    if (window.scrollY > 4) {
      setFinished(true);
      return;
    }

    markSeen();

    /*
      And from here, the visitor is in charge. Any gesture that means 'I want the page' closes it.
      `wheel` and `touchstart` are passive because nothing is canceled — the page DOES scroll
      while this fades, which is exactly the fix.
     */
    const opciones = { passive: true } as const;
    window.addEventListener("wheel", leave, opciones);
    window.addEventListener("touchstart", leave, opciones);
    window.addEventListener("scroll", leave, opciones);
    window.addEventListener("keydown", leave);
    window.addEventListener("pointerdown", leave);
    return () => {
      window.removeEventListener("wheel", leave);
      window.removeEventListener("touchstart", leave);
      window.removeEventListener("scroll", leave);
      window.removeEventListener("keydown", leave);
      window.removeEventListener("pointerdown", leave);
    };
  }, [finished, leave]);

  useEffect(() => {
    /*
      And you re-enter here when the entry ends, which is the only thing that releases what this
      effect has grabbed. With the dependency list empty, the cleanup only ran on unmount, but
      `HeroEntrance` remains mounted even though it ends up returning `null`. The veil would leave
      the tree, and its canvas —the fold at two pixels per point, about twenty-two megabytes of
      native memory— would stay alive in the closure until the tab was closed.
     */
    if (finished) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setFinished(true);
      return;
    }

    const host = hostRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const leftHand = leftRef.current;
    const rightHand = rightRef.current;
    const leftImage = leftImageRef.current;
    const rightImage = rightImageRef.current;
    if (!host || !canvas || !ctx || !leftHand || !rightHand || !leftImage || !rightImage) return;
    const inkByLayer = landingParticlePalette(host);

    let width = 1;
    let height = 1;
    let dots: IntroDot[] = [];
    let logo: Point[] = [];
    let logoCenterX = 0;
    let logoCenterY = 0;
    let frame = 0;
    let alive = true;
    let leftNatural = { w: 914, h: 887 };
    let rightNatural = { w: 914, h: 887 };
    let assigned: (Point | null)[] = [];
    /* The nine layers of frame opacity, reserved once. */
    const buckets = new PointBuckets();

    const build = () => {
      const box = host.getBoundingClientRect();
      width = Math.max(1, Math.round(box.width));
      height = Math.max(1, Math.round(box.height));
      const dpr = canvasPixelRatio(width, height, window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const stage = document.querySelector<HTMLElement>("[data-swarm-slot]");
      const stageBox = stage?.getBoundingClientRect();
      logoCenterX = stageBox ? stageBox.left - box.left + stageBox.width / 2 : width / 2;
      logoCenterY = stageBox ? stageBox.top - box.top + stageBox.height / 2 : height * 0.45;
      const logoSize = stageBox
        ? Math.min(stageBox.height * 0.76, width * 0.58)
        : Math.min(width < 620 ? width * 0.34 : width * 0.18, height * 0.34);
      logo = sampleLogo(width, height, logoCenterX, logoCenterY, logoSize);

      const want = Math.max(820, Math.round((width < 620 ? 900 : 1100) * (width < 620 ? 0.86 : 1)));
      const leftSamples = sampleHand(leftImage, want);
      const rightSamples = sampleHand(rightImage, want);
      leftNatural = { w: leftImage.naturalWidth || 914, h: leftImage.naturalHeight || 887 };
      rightNatural = { w: rightImage.naturalWidth || 914, h: rightImage.naturalHeight || 887 };

      const leftSorted = [...leftSamples].sort((a, b) => a.v - b.v);
      const rightSorted = [...rightSamples].sort((a, b) => a.v - b.v);
      const leftLogo = logo.filter((point) => point.x < logoCenterX).sort((a, b) => a.y - b.y);
      const rightLogo = logo.filter((point) => point.x >= logoCenterX).sort((a, b) => a.y - b.y);

      const makeDots = (samples: HandSample[], side: -1 | 1): IntroDot[] =>
        samples.map((sample, index) => {
          const fingertip = side < 0 ? sample.u : 1 - sample.u;
          return {
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            side,
            u: sample.u,
            v: sample.v,
            shade: sample.shade,
            delay: (1 - fingertip) * (0.55 + seeded(index, 1) * 0.45),
            phase: seeded(index, 2) * Math.PI * 2,
            size: seeded(index, 3) > 0.84 ? 2.6 : 1.7,
            planted: false,
          };
        });

      dots = [...makeDots(leftSorted, -1), ...makeDots(rightSorted, 1)];

      const leftCount = leftSorted.length;
      assigned = dots.map((dot, index) => {
        if (dot.side < 0) {
          if (leftLogo.length === 0) return null;
          return leftLogo[Math.floor((index / Math.max(1, leftCount)) * leftLogo.length)] ?? null;
        }
        if (rightLogo.length === 0) return null;
        const local = index - leftCount;
        return rightLogo[Math.floor((local / Math.max(1, rightSorted.length)) * rightLogo.length)] ?? null;
      });

      /*
        We already have the normalized samples and the logo destinations: keeping the bitmap used
        to read the hands only inflated the native memory of the tab.
       */
      releaseScratchCanvas();
    };

    const start = async () => {
      await Promise.all([waitForImage(leftImage), waitForImage(rightImage)]);
      if (!alive) return;
      build();
      host.dataset.running = "true";

      const draw = (now: number, startedAt: number) => {
        if (!alive) return;
        const elapsed = now - startedAt;
        const seconds = now / 1000;
        const enter = ease((elapsed - 80) / 520);
        buckets.reset(dots.length, 10);
        const hostBox = host.getBoundingClientRect();
        const leftBox = leftHand.getBoundingClientRect();
        const rightBox = rightHand.getBoundingClientRect();
        const leftDrawn = imageRect(leftBox, hostBox, leftNatural.w, leftNatural.h);
        const rightDrawn = imageRect(rightBox, hostBox, rightNatural.w, rightNatural.h);

        ctx.clearRect(0, 0, width, height);

        dots.forEach((dot, index) => {
          const drawn = dot.side < 0 ? leftDrawn : rightDrawn;
          const handX = drawn.x + dot.u * drawn.w;
          const handY = drawn.y + dot.v * drawn.h;
          const shimmer = (1 - clamp((elapsed - MORPH_FROM) / 400)) * 1.4;
          const orbitX = Math.cos(dot.phase + seconds * 0.7) * shimmer;
          const orbitY = Math.sin(dot.phase * 1.15 + seconds * 0.55) * shimmer * 0.8;

          const local = easeInOut((elapsed - MORPH_FROM - dot.delay * STAGGER) / MORPH_FOR);
          const arc = Math.sin(local * Math.PI) * (18 + seeded(index, 4) * 26);
          const mark = assigned[index];

          let targetX = handX + orbitX;
          let targetY = handY + orbitY;
          let formed = 0;

          if (local > 0) {
            if (mark) {
              targetX = handX + (mark.x - handX) * local;
              targetY = handY + (mark.y - handY) * local - arc;
              formed = local;
            } else {
              const angle = dot.phase + seconds * 0.14;
              const radius = Math.sqrt(seeded(index, 5));
              const haloX = logoCenterX + Math.cos(angle) * Math.min(width * 0.42, 480) * radius;
              const haloY = logoCenterY + Math.sin(angle) * height * 0.36 * radius;
              targetX = handX + (haloX - handX) * local;
              targetY = handY + (haloY - handY) * local - arc * 0.4;
            }
          }

          if (local <= 0) {
            dot.x = targetX;
            dot.y = targetY;
            dot.vx = 0;
            dot.vy = 0;
            dot.planted = true;
          } else if (!dot.planted) {
            dot.x = targetX;
            dot.y = targetY;
            dot.planted = true;
          } else {
            const stiff = 0.14 + formed * 0.22;
            const damp = 0.76 - formed * 0.1;
            dot.vx = (dot.vx + (targetX - dot.x) * stiff) * damp;
            dot.vy = (dot.vy + (targetY - dot.y) * stiff) * damp;
            dot.x += dot.vx;
            dot.y += dot.vy;
          }

          const alpha = (0.38 + (1 - dot.shade / 255) * 0.22 + formed * 0.36) * enter;
          const layer = Math.max(1, Math.min(9, Math.round(alpha * 10)));
          buckets.push(layer, dot.x, dot.y, dot.size + formed * 0.55);
        });

        /*
          A `fill` per opacity layer, with the path of the own context. Before it was a new
          `Path2D` per layer and per frame: nine native objects every sixteen milliseconds during
          the seven seconds that the entry lasts.
         */
        buckets.sort();
        for (let layer = 1; layer < 10; layer += 1) {
          const seats = buckets.count[layer]!;
          if (seats === 0) continue;
          ctx.fillStyle = inkByLayer[layer]!;
          ctx.beginPath();
          const from = buckets.start[layer]!;
          for (let i = from; i < from + seats; i += 1) {
            const at = buckets.order[i]!;
            const x = buckets.x[at]!;
            const y = buckets.y[at]!;
            const radius = buckets.size[at]! / 2;
            ctx.moveTo(x + radius, y);
            ctx.arc(x, y, radius, 0, Math.PI * 2);
          }
          ctx.fill();
        }

        if (elapsed < INTRO_DURATION) frame = requestAnimationFrame((next) => draw(next, startedAt));
      };

      /*
        A couple of frames so that the `translateX` from the hands is already applied: if it is
        planted earlier, the particles are born in the center and jump to the edge.
       */
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!alive) return;
          const startedAt = performance.now();
          /* It has already started: the watcher is unnecessary and the entrance clock rules. */
          window.clearTimeout(guard);
          guard = 0;
          timer.current = window.setTimeout(() => {
            alive = false;
            cancelAnimationFrame(frame);
            setFinished(true);
          }, INTRO_DURATION);
          frame = requestAnimationFrame((now) => draw(now, startedAt));
        });
      });
    };

    /*
      The watcher, armed here and not inside `start()`: if the two photos don’t arrive —one
      broken, a `decode()` that doesn’t resolve— the promise from inside doesn’t return, the
      normal timer doesn’t get armed, and this opaque veil stays covering the page. With a loose
      ceiling, so that it only jumps when nothing has really started.
     */
    let guard = window.setTimeout(() => {
      alive = false;
      cancelAnimationFrame(frame);
      setFinished(true);
    }, INTRO_DURATION + 6000);

    void start();
    const resize = new ResizeObserver(() => {
      if (!alive || dots.length === 0) return;
      /*
        Only if it has really changed size. The observer also warns when it hasn't, and each
        warning resamples both hands and the mark — three pixel readings that also replant all the
        particles halfway through the entry.
       */
      const box = host.getBoundingClientRect();
      if (Math.round(box.width) === width && Math.round(box.height) === height) return;
      build();
      for (const dot of dots) dot.planted = false;
    });
    resize.observe(host);

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.clearTimeout(timer.current);
      window.clearTimeout(fade.current);
      window.clearTimeout(guard);
      /*
        And the canvas is released. Setting its size to zero frees its memory immediately, without
        waiting for the collector to remember a node that is no longer in the tree.
       */
      canvas.width = 0;
      canvas.height = 0;
      dots = [];
      logo = [];
      assigned = [];
      buckets.release();
      releaseScratchCanvas();
    };
  }, [finished]);

  if (finished) return null;

  return (
    <div className={`${styles.intro} ${leaving ? styles.leaving : ""}`} ref={hostRef}>
      {/*
         The jump button, and it goes OUTSIDE of any `aria-hidden`: it is the only control of this
         piece, and an output that only exists for those who see the screen is not an output. With
         a keyboard, you reach it with a tab from the beginning of the document.
         There are still three more ways to leave —wheel, hitchhiking, any key— but none of them
         is announced. This one is.
        */}
      <button type="button" className={styles.skip} onClick={leave}>
        {skipLabel}
      </button>
      <div className={styles.art} aria-hidden>
      <div className={`${styles.hand} ${styles.left}`} ref={leftRef}>
        {/* eslint-disable-next-line @next/next/no-img-element -- generated transparent entrance artwork */}
        <img
          ref={leftImageRef}
          className={styles.image}
          src="/assets/landing/hand-left-intro.webp"
          alt=""
          draggable={false}
        />
      </div>
      <div className={`${styles.hand} ${styles.right}`} ref={rightRef}>
        {/* eslint-disable-next-line @next/next/no-img-element -- generated transparent entrance artwork */}
        <img
          ref={rightImageRef}
          className={styles.image}
          src="/assets/landing/hand-right-intro.webp"
          alt=""
          draggable={false}
        />
      </div>
      {/*
         Decorative, and that's why outside the tree: the particles don't say anything that the
         text next to them doesn't already say. Its two siblings on the landing already had it.
        */}
      <canvas className={styles.particles} ref={canvasRef} aria-hidden />
      </div>
    </div>
  );
}
