/*
  The workshop of swarms: the sampling canvas and the point cloud.
  Both pieces are here for the same reason, and it is not code sharing: it is that neither of the
  two things can be hot-swapped.
  Sampling a sentence required a new canvas —the size of the fold— for each density test, and
  painting a frame required a new `Path2D` for each layer of opacity. Measured on the real page, a
  single `build()` from the hero's swarm created 100 canvases of 1200 × 655 and read 300 MB of
  pixels; the drawing loop threw about seventy paths per frame, and at sixty per second, that’s
  four thousand per second.
  None of that lives in the JavaScript heap: the canvases and paths are native memory that the
  collector only releases when it remembers. Hence the process reached gigabytes while
  `usedJSHeapSize` kept showing one hundred seventy megabytes — the heap was clean and the garbage
  was out.
  Here there is a single canvas, which grows and never shrinks, and some buckets that empty
  instead of being refilled. The drawing comes out identical; the only thing that disappears is
  the trash.
 */

let scratch: HTMLCanvasElement | undefined;
let scratchCtx: CanvasRenderingContext2D | null | undefined;

/*
  A retina screen does not need to turn every full-bleed particle layer into a 4x bitmap.
  The particles are deliberately soft and in motion, so a bounded backing store looks the
  same while avoiding tens of megabytes per canvas. The budget is expressed in physical
  pixels so it also protects ultrawide and very tall windows.
*/
export function canvasPixelRatio(
  width: number,
  height: number,
  deviceRatio: number,
  maxRatio = 1.5,
  pixelBudget = 2_200_000,
): number {
  const area = Math.max(1, width * height);
  const budgetRatio = Math.sqrt(pixelBudget / area);
  return Math.max(0.5, Math.min(deviceRatio || 1, maxRatio, budgetRatio));
}

/**
 * The sampling canvas, one for the entire page. It grows to whatever is requested, does not
 * shrink, and is returned clean in the requested region and with the matrix set to zero.
 *
 * Whoever uses it has to finish with it —reading its pixels— before asking for it again: there are
 * not two. All the samplings on the landing page are synchronous from start to finish, so none
 * overlaps with another.
 */
export function scratchContext(width: number, height: number): CanvasRenderingContext2D | null {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));

  scratch ??= document.createElement("canvas");
  if (scratch.width < w || scratch.height < h) {
    /*
      Touching `width` or `height` resets the entire canvas, so it is only touched when growing
      and it grows to the maximum seen: whoever asks for a narrow fold after a wide one reuses the
      large one instead of rebuilding it.
     */
    scratch.width = Math.max(scratch.width, w);
    scratch.height = Math.max(scratch.height, h);
  }

  scratchCtx ??= scratch.getContext("2d", { willReadFrequently: true });
  const ctx = scratchCtx;
  if (!ctx) return null;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);

  /*
    And it is returned in blank state, not just in pixels.
    A newly created canvas arrives with the default state, and whoever used it took that for
    granted: the signature at the bottom placed the word at an absolute coordinate using
    `textAlign: "start"`. When sharing the canvas, the swarm of the fold samples its phrases
    beforehand —and it samples them with `textAlign: "center"` —, so the next one to arrive
    inherited an alignment that no one had asked for and painted half a word out of place. Sharing
    the canvas obliges you to return it as it was.
   */
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  return ctx;
}

/** Releases the native bitmap once a synchronous sampling pass has finished. */
export function releaseScratchCanvas(): void {
  if (!scratch) return;
  scratch.width = 1;
  scratch.height = 1;
}

/**
 * The points of a frame, grouped by layer without reserving anything.
 *
 * Grouping is a count, not an ordering: it counts how many points fall into each layer, the
 * principles are summed and placed. It comes out in two linear passes, and the six tables needed
 * for that are reserved once and reused forever.
 *
 * The use is always the same: `reset`, one `push` per point, `sort`, and then one layer per turn
 * reading `start` and `count`.
 */
export class PointBuckets {
  private capacity = 0;
  private keys = 0;
  private used = 0;
  private key = new Int32Array(0);
  private cursor = new Int32Array(0);

  /** Where each point is located, in the order in which it was entered. */
  x = new Float32Array(0);
  y = new Float32Array(0);
  size = new Float32Array(0);

  /** How many points does each layer have, and where does yours start within `order`. */
  count = new Int32Array(0);
  start = new Int32Array(0);
  /** The indices of the points, grouped by layer. */
  order = new Int32Array(0);

  /** Empty the buckets for a new frame. The tables only grow. */
  reset(capacity: number, keys: number): void {
    if (capacity > this.capacity) {
      this.capacity = capacity;
      this.key = new Int32Array(capacity);
      this.order = new Int32Array(capacity);
      this.x = new Float32Array(capacity);
      this.y = new Float32Array(capacity);
      this.size = new Float32Array(capacity);
    }
    if (keys > this.keys) {
      this.keys = keys;
      this.count = new Int32Array(keys);
      this.start = new Int32Array(keys);
      this.cursor = new Int32Array(keys);
    }
    this.count.fill(0);
    this.used = 0;
  }

  /** A point on its layer. `key` goes from 0 to `keys - 1`. */
  push(key: number, x: number, y: number, size: number): void {
    const at = this.used;
    if (at >= this.capacity || key < 0 || key >= this.keys) return;
    this.key[at] = key;
    this.x[at] = x;
    this.y[at] = y;
    this.size[at] = size;
    this.count[key] = this.count[key]! + 1;
    this.used = at + 1;
  }

  /** Distribute the indexes by layer. After this, `start` and `count` are already usable. */
  sort(): void {
    let at = 0;
    for (let k = 0; k < this.keys; k += 1) {
      this.start[k] = at;
      this.cursor[k] = at;
      at += this.count[k]!;
    }
    for (let i = 0; i < this.used; i += 1) {
      const k = this.key[i]!;
      const slot = this.cursor[k]!;
      this.order[slot] = i;
      this.cursor[k] = slot + 1;
    }
  }

  /** Drops the reusable typed arrays when a whole section has left the viewport. */
  release(): void {
    this.capacity = 0;
    this.keys = 0;
    this.used = 0;
    this.key = new Int32Array(0);
    this.cursor = new Int32Array(0);
    this.x = new Float32Array(0);
    this.y = new Float32Array(0);
    this.size = new Float32Array(0);
    this.count = new Int32Array(0);
    this.start = new Int32Array(0);
    this.order = new Int32Array(0);
  }
}
