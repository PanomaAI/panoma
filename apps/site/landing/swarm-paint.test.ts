import { describe, expect, it } from "vitest";
import { PointBuckets, canvasPixelRatio } from "./swarm-paint";

describe("canvas pixel budget", () => {
  it("keeps ordinary screens crisp without exceeding the physical-pixel budget", () => {
    expect(canvasPixelRatio(1200, 700, 2, 1.5, 2_200_000)).toBe(1.5);
    const ultrawide = canvasPixelRatio(2560, 1440, 2, 1.5, 2_200_000);
    expect(2560 * 1440 * ultrawide ** 2).toBeCloseTo(2_200_000, -1);
  });

  it("never upscales past the device ratio", () => {
    expect(canvasPixelRatio(900, 600, 1, 1.5, 2_200_000)).toBe(1);
  });
});

/**
 * The buckets replaced a `Map` of `Path2D` built fresh on every frame. Nothing about the
 * drawing may change: every point must come back, in its own layer, with its own size.
 * These are the invariants the canvas relies on sixty times a second.
 */
describe("point buckets", () => {
  const drain = (buckets: PointBuckets, keys: number) => {
    buckets.sort();
    const out: Record<number, { x: number; y: number; size: number }[]> = {};
    for (let key = 0; key < keys; key += 1) {
      const seats = buckets.count[key]!;
      if (seats === 0) continue;
      const from = buckets.start[key]!;
      out[key] = [];
      for (let i = from; i < from + seats; i += 1) {
        const at = buckets.order[i]!;
        out[key]!.push({ x: buckets.x[at]!, y: buckets.y[at]!, size: buckets.size[at]! });
      }
    }
    return out;
  };

  it("groups every point under its own layer and loses none", () => {
    const buckets = new PointBuckets();
    buckets.reset(5, 3);
    buckets.push(2, 10, 11, 2);
    buckets.push(0, 20, 21, 3);
    buckets.push(2, 30, 31, 2);
    buckets.push(1, 40, 41, 3);
    buckets.push(0, 50, 51, 2);

    const layers = drain(buckets, 3);
    expect(layers[0]).toEqual([
      { x: 20, y: 21, size: 3 },
      { x: 50, y: 51, size: 2 },
    ]);
    expect(layers[1]).toEqual([{ x: 40, y: 41, size: 3 }]);
    expect(layers[2]).toEqual([
      { x: 10, y: 11, size: 2 },
      { x: 30, y: 31, size: 2 },
    ]);
  });

  /*
    The tables are 32-bit on purpose: half the memory and the error is seven orders of magnitude
    below a pixel, which is the unit in which it is drawn.
   */
  it("keeps a point where it was to well under a pixel", () => {
    const buckets = new PointBuckets();
    buckets.reset(1, 1);
    buckets.push(0, 123.456, 654.321, 1.7);
    buckets.sort();
    expect(buckets.x[0]!).toBeCloseTo(123.456, 3);
    expect(buckets.y[0]!).toBeCloseTo(654.321, 3);
    expect(buckets.size[0]!).toBeCloseTo(1.7, 5);
  });

  it("empty layers are skipped, not drawn blank", () => {
    const buckets = new PointBuckets();
    buckets.reset(2, 10);
    buckets.push(9, 1, 2, 1);
    buckets.push(9, 3, 4, 1);

    const layers = drain(buckets, 10);
    expect(Object.keys(layers)).toEqual(["9"]);
    expect(layers[9]).toHaveLength(2);
  });

  it("a second frame starts empty and reuses the same tables", () => {
    const buckets = new PointBuckets();
    buckets.reset(3, 2);
    buckets.push(0, 1, 1, 1);
    buckets.push(1, 2, 2, 1);
    const first = buckets.x;

    buckets.reset(3, 2);
    buckets.push(1, 9, 9, 2);

    /* The same table, not a new one: that's what the whole arrangement is about. */
    expect(buckets.x).toBe(first);
    expect(drain(buckets, 2)).toEqual({ 1: [{ x: 9, y: 9, size: 2 }] });
  });

  it("tables grow with the swarm and never shrink under it", () => {
    const buckets = new PointBuckets();
    buckets.reset(2, 2);
    buckets.reset(4000, 60);
    for (let i = 0; i < 4000; i += 1) buckets.push(i % 60, i, i, 1);

    buckets.sort();
    let seen = 0;
    for (let key = 0; key < 60; key += 1) seen += buckets.count[key]!;
    expect(seen).toBe(4000);

    /* A narrower fold cannot leave points from the previous one hanging. */
    buckets.reset(10, 60);
    buckets.push(3, 7, 7, 1);
    expect(drain(buckets, 60)).toEqual({ 3: [{ x: 7, y: 7, size: 1 }] });
  });

  it("can release its backing arrays when a section leaves the viewport", () => {
    const buckets = new PointBuckets();
    buckets.reset(4000, 60);
    buckets.release();

    expect(buckets.x).toHaveLength(0);
    expect(buckets.order).toHaveLength(0);
    buckets.reset(2, 2);
    buckets.push(1, 4, 5, 1);
    expect(drain(buckets, 2)).toEqual({ 1: [{ x: 4, y: 5, size: 1 }] });
  });
});
