import { describe, expect, it } from "vitest";
import { paintSignature } from "./landing-scenes";

/**
 * The footer signature is the name and nothing else. The mark lives in the fold, where the
 * swarm forms it every other phrase; repeating it down here spent recognition instead of
 * building it. These tests pin that — and pin the size, because a word alone at the body it
 * had beside the letter reads as a whisper in the middle of the block.
 *
 * The canvas is a stub: the point is what gets asked of it, not what it paints.
 */

type Call = { text: string; x: number; y: number; fontSize: number };

/*
  Proportions measured on the actual typography of the page: «Panoma» at 800 measures 3.98 times
  the body in width, and its ink occupies 0.70 in height —0.52 above, 0.18 below, which is how
  much the leg of the p descends. The exact numbers do not matter as long as expectations use the
  same; what is checked are the relationships.
 */
const W_PER_EM = 3.98;
const ASC_PER_EM = 0.52;
const DESC_PER_EM = 0.18;
/*
  The air on the sides: the ink starts a little to the right of the drawing point and ends a
  little before the end of the advance. It's exactly what offset the word.
 */
const INK_LEFT_PER_EM = -0.06;
const INK_RIGHT_PER_EM = W_PER_EM - 0.01;

function stubContext() {
  const fills: Call[] = [];
  let paths = 0;
  let size = 10;

  const ctx = {
    set font(value: string) {
      size = Number(/(\d+(?:\.\d+)?)px/.exec(value)?.[1] ?? 10);
    },
    get font() {
      return `800 ${size}px stub`;
    },
    textBaseline: "alphabetic",
    fillStyle: "#000",
    strokeStyle: "#000",
    measureText: (text: string) => ({
      width: text.length * (W_PER_EM / 6) * size,
      actualBoundingBoxAscent: ASC_PER_EM * size,
      actualBoundingBoxDescent: DESC_PER_EM * size,
      actualBoundingBoxLeft: INK_LEFT_PER_EM * size,
      actualBoundingBoxRight: INK_RIGHT_PER_EM * size,
    }),
    fillText: (text: string, x: number, y: number) => fills.push({ text, x, y, fontSize: size }),
    fill: () => {
      paths += 1;
    },
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    scale: () => undefined,
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, paths: () => paths };
}

describe("footer signature", () => {
  it("draws the name and never the mark", () => {
    const { ctx, fills, paths } = stubContext();
    paintSignature(ctx, 171.6, "stub", 1036);

    expect(fills.map((call) => call.text)).toEqual(["panoma"]);
    /* A single `fill` would be enough to reveal a route of the letter: the mark is seven. */
    expect(paths()).toBe(0);
  });

  it("the word inherits the room the whole lockup used to take", () => {
    const { ctx, fills } = stubContext();
    const size = 171.6;
    const width = 1036;
    paintSignature(ctx, size, "stub", width);

    const markW = 519.9 * (size / 585.3);
    const gap = size * 0.24;
    const nameW = W_PER_EM * (size * 0.62);
    const lockup = markW + gap + nameW;
    expect(lockup).toBeLessThan(width * 0.84);

    const drawn = fills[0]!;
    expect(drawn.fontSize * W_PER_EM).toBeCloseTo(lockup, 4);
  });

  it("a narrow block caps the word at the block, not at the lockup", () => {
    const { ctx, fills } = stubContext();
    const size = 132;
    const width = 360;
    paintSignature(ctx, size, "stub", width);

    const lockup = 519.9 * (size / 585.3) + size * 0.24 + W_PER_EM * (size * 0.62);
    expect(lockup).toBeGreaterThan(width * 0.84);

    const drawn = fills[0]!;
    expect(drawn.fontSize * W_PER_EM).toBeCloseTo(width * 0.84, 4);
  });

  it("sits centred on the stage by its ink, on both axes", () => {
    const { ctx, fills } = stubContext();
    paintSignature(ctx, 171.6, "stub", 1036);

    const drawn = fills[0]!;
    /*
      The ink goes from `x - left` to `x + right`, and its center falls at the origin — which is
      the center of the stage. The same above and below with the ascent and the descent.
     */
    const left = drawn.x - INK_LEFT_PER_EM * drawn.fontSize;
    const right = drawn.x + INK_RIGHT_PER_EM * drawn.fontSize;
    expect((left + right) / 2).toBeCloseTo(0, 6);

    const top = drawn.y - ASC_PER_EM * drawn.fontSize;
    const bottom = drawn.y + DESC_PER_EM * drawn.fontSize;
    expect((top + bottom) / 2).toBeCloseTo(0, 6);
  });

  it("centring by the box instead of the ink would push it right", () => {
    const { ctx, fills } = stubContext();
    paintSignature(ctx, 171.6, "stub", 1036);
    const drawn = fills[0]!;
    /* The proof that the arrangement does something: the box and the ink do not ask for the same place. */
    expect(drawn.x).not.toBeCloseTo(-(drawn.fontSize * W_PER_EM) / 2, 2);
  });

  it("grows and shrinks with the block instead of sitting at a fixed body", () => {
    const small = stubContext();
    const big = stubContext();
    paintSignature(small.ctx, 120, "stub", 1036);
    paintSignature(big.ctx, 200, "stub", 1036);
    expect(big.fills[0]!.fontSize).toBeGreaterThan(small.fills[0]!.fontSize);
  });
});
