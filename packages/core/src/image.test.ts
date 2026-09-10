import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MAX_FIT_PIXELS, fitScreenshot } from "./image";

/*
  Every image here is built byte by byte and none is read from a folder of material.
  The reason is the same one written in `screenshot.test.ts` and one more. The same one: what is
  being checked are the bytes —the header that decides the size, the filter of each line, the
  color type— and a PNG saved in the repository hides all of that behind a name. The extra one:
  half of these cases cannot be saved as a normal file, because they are deliberately impossible
  captures —a stream that does not inflate, a line count that does not match— and any tool that
  passes over the repository repairs or deletes them.
  The decoder at the bottom is written here on purpose instead of being imported from the module.
  It only reads what `fitScreenshot` writes —filter 0, one `IDAT`— so it is fifteen lines, and it
  is a second opinion: a symmetric mistake in encoding and decoding would pass unnoticed if both
  sides were the same code.
 */

describe("fitScreenshot", () => {
  it("fits a wide capture by its long edge", () => {
    const result = fitScreenshot(flat(200, 100, 2, [40, 90, 160]), 50);
    if (!result.ok) throw new Error(`refused with ${result.why}`);
    expect(result.shot.width).toBe(50);
    expect(result.shot.height).toBe(25);
    expect(result.shot.from).toEqual({ width: 200, height: 100 });
  });

  it("fits a tall capture by its long edge as well", () => {
    const result = fitScreenshot(flat(100, 200, 2, [40, 90, 160]), 50);
    if (!result.ok) throw new Error(`refused with ${result.why}`);
    expect(result.shot.width).toBe(25);
    expect(result.shot.height).toBe(50);
  });

  it("keeps the color of a flat capture through the reduction", () => {
    const result = fitScreenshot(flat(200, 100, 2, [40, 90, 160]), 50);
    if (!result.ok) throw new Error(`refused with ${result.why}`);
    const decoded = decode(result.shot.bytes);
    expect([...decoded.pixels.subarray(0, 3)]).toEqual([40, 90, 160]);
  });

  it("leaves alone a capture whose long edge already fits", () => {
    expect(fitScreenshot(flat(300, 120, 2, [0, 0, 0]), 300)).toEqual({ ok: false, why: "already" });
    expect(fitScreenshot(flat(120, 90, 2, [0, 0, 0]), 300)).toEqual({ ok: false, why: "already" });
  });

  it("refuses a capture that is not a PNG", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    expect(fitScreenshot(jpeg, 50)).toEqual({ ok: false, why: "format" });
  });

  it("refuses a PNG with a palette", () => {
    const indexes = new Array(200 * 100).fill(0);
    const palette = Uint8Array.from([255, 0, 0, 0, 255, 0]);
    const png = assemble(header(200, 100, 3, 8, 0), lines(200 * 1, 100, indexes), [
      chunk("PLTE", palette),
    ]);
    expect(fitScreenshot(png, 50)).toEqual({ ok: false, why: "variant" });
  });

  it("refuses an interlaced PNG", () => {
    const samples = new Array(200 * 100 * 3).fill(120);
    const png = assemble(header(200, 100, 2, 8, 1), lines(200 * 3, 100, samples));
    expect(fitScreenshot(png, 50)).toEqual({ ok: false, why: "variant" });
  });

  it("refuses a bit depth this decoder does not read", () => {
    const png = assemble(header(200, 100, 0, 4, 0), lines(100, 100, new Array(100 * 100).fill(0)));
    expect(fitScreenshot(png, 50)).toEqual({ ok: false, why: "variant" });
  });

  it("refuses bytes that are not a readable PNG", () => {
    const whole = flat(200, 100, 2, [10, 20, 30]);
    expect(fitScreenshot(whole.subarray(0, 20), 50)).toEqual({ ok: false, why: "broken" });
    expect(fitScreenshot(new Uint8Array(64), 50)).toEqual({ ok: false, why: "broken" });
    // A stream that is not zlib at all, and one that inflates to fewer lines than announced.
    const notZlib = assemble(header(200, 100, 2, 8, 0), Uint8Array.from([1, 2, 3, 4]));
    expect(fitScreenshot(notZlib, 50)).toEqual({ ok: false, why: "broken" });
    const short = assemble(header(200, 100, 2, 8, 0), deflateSync(Buffer.alloc(10)));
    expect(fitScreenshot(short, 50)).toEqual({ ok: false, why: "broken" });
  });

  it("averages the area instead of choosing one of the two pixels", () => {
    // One black and one white, into a single pixel: neither of the two survives, their average
    // does. 127.5 rounds up, which is the only reason the number is 128 and not 127.
    const result = fitScreenshot(assemble(header(2, 1, 0, 8, 0), lines(2, 1, [0, 255])), 1);
    if (!result.ok) throw new Error(`refused with ${result.why}`);
    expect(result.shot.width).toBe(1);
    expect(result.shot.height).toBe(1);
    expect(decode(result.shot.bytes).pixels[0]).toBe(128);
  });

  it("averages an uneven ratio by weighting the edges it half covers", () => {
    // Three pixels into two: the middle one goes half to each side, so what comes out is the
    // average of one and a half pixels on each side and not the nearest one.
    const png = assemble(header(3, 1, 0, 8, 0), lines(3, 1, [0, 120, 240]));
    const result = fitScreenshot(png, 2);
    if (!result.ok) throw new Error(`refused with ${result.why}`);
    expect([...decode(result.shot.bytes).pixels]).toEqual([40, 200]);
  });

  it("composes alpha so that a transparent neighbor does not darken the color", () => {
    const png = assemble(header(2, 1, 6, 8, 0), lines(8, 1, [255, 0, 0, 255, 0, 0, 0, 0]));
    const result = fitScreenshot(png, 1);
    if (!result.ok) throw new Error(`refused with ${result.why}`);
    const decoded = decode(result.shot.bytes);
    expect(decoded.color).toBe(6);
    expect([...decoded.pixels]).toEqual([255, 0, 0, 128]);
  });

  it("reads the five line filters and gets the same image from all of them", () => {
    const samples = ramp(60, 40, 3);
    const outputs = [0, 1, 2, 3, 4].map((filter) => {
      const png = assemble(header(60, 40, 2, 8, 0), lines(60 * 3, 40, samples, filter, 3));
      const result = fitScreenshot(png, 20);
      if (!result.ok) throw new Error(`filter ${filter} refused with ${result.why}`);
      return Buffer.from(result.shot.bytes).toString("base64");
    });
    expect(new Set(outputs).size).toBe(1);
  });

  it("brings sixteen bits down to eight", () => {
    // 0x8000 out of 0xffff is a hair over half: 128 at eight bits.
    const samples = new Array(80 * 40).fill(0).flatMap(() => [0x80, 0x00]);
    const png = assemble(header(80, 40, 0, 16, 0), lines(80 * 2, 40, samples));
    const result = fitScreenshot(png, 20);
    if (!result.ok) throw new Error(`refused with ${result.why}`);
    const decoded = decode(result.shot.bytes);
    expect(decoded.depth).toBe(8);
    expect(decoded.color).toBe(0);
    expect(decoded.pixels[0]).toBe(128);
  });

  it("gives back a PNG that decodes to the size it claims", () => {
    const result = fitScreenshot(noise(240, 180), 60);
    if (!result.ok) throw new Error(`refused with ${result.why}`);
    const decoded = decode(result.shot.bytes);
    expect(decoded.width).toBe(result.shot.width);
    expect(decoded.height).toBe(result.shot.height);
    expect(decoded.pixels.length).toBe(60 * 45 * 3);
  });

  it("writes the same bytes on two calls with the same capture", () => {
    const source = noise(240, 180);
    const first = fitScreenshot(source, 60);
    const second = fitScreenshot(source, 60);
    if (!first.ok || !second.ok) throw new Error("refused");
    expect(Buffer.from(first.shot.bytes).equals(Buffer.from(second.shot.bytes))).toBe(true);
  });

  it("comes out lighter than the capture it came from", () => {
    const source = noise(240, 180);
    const result = fitScreenshot(source, 60);
    if (!result.ok) throw new Error(`refused with ${result.why}`);
    expect(result.shot.bytes.length).toBeLessThan(source.length);
  });

  /*
    The pixel data of this one is a lie —eight deflated bytes where a hundred million samples
    should be— and that is the whole point: the refusal has to happen with the `IHDR` in hand and
    nothing allocated, so the test does not need a real capture of ten thousand by ten thousand
    and this machine does not need the four hundred megabytes it would take to build one. If the
    guard ever moved below the decoder, this case would stop refusing and start inflating, which
    is what it is here to catch.
   */
  it("refuses a capture with more pixels than it will hold, before decoding it", () => {
    const side = Math.ceil(Math.sqrt(MAX_FIT_PIXELS)) + 1;
    const png = assemble(header(side, side, 2, 8, 0), deflateSync(Buffer.alloc(8)));
    expect(fitScreenshot(png, 50)).toEqual({ ok: false, why: "huge" });
  });

  /* And the one right below it is read as any other, so the ceiling is a ceiling and not a wall. */
  it("reduces a capture that stays under that count", () => {
    const result = fitScreenshot(noise(600, 400), 60);
    if (!result.ok) throw new Error(`refused with ${result.why}`);
    expect(result.shot.width).toBe(60);
  });
});

/* ── Making PNGs by hand ─────────────────────────────────────────────────────────────────── */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The thirteen bytes of `IHDR`, with every field open so the refusals can be provoked. */
function header(
  width: number,
  height: number,
  color: number,
  depth: number,
  interlace: number,
): Uint8Array {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = depth;
  ihdr[9] = color;
  ihdr[12] = interlace;
  return ihdr;
}

/**
 * The lines, deflated, with the requested filter applied to all of them.
 *
 * `stride` is in bytes and not in pixels, so that a 16-bit image is written the same way as an
 * 8-bit one: what the filter operates on is bytes, in both cases. And `pixel` is how many bytes
 * one pixel occupies, which is the distance the neighbor to the left is at: taking the previous
 * byte instead —the mistake this helper made first— filters the red against the blue and only
 * shows up with filters 1, 3, and 4.
 */
function lines(stride: number, height: number, samples: number[], filter = 0, pixel = 1): Buffer {
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x += 1) {
      const value = samples[y * stride + x]! & 0xff;
      const left = x >= pixel ? samples[y * stride + x - pixel]! & 0xff : 0;
      const up = y > 0 ? samples[(y - 1) * stride + x]! & 0xff : 0;
      const corner = x >= pixel && y > 0 ? samples[(y - 1) * stride + x - pixel]! & 0xff : 0;
      raw[y * (stride + 1) + 1 + x] = predict(filter, value, left, up, corner) & 0xff;
    }
  }
  return deflateSync(Buffer.from(raw));
}

function predict(filter: number, value: number, left: number, up: number, corner: number): number {
  if (filter === 1) return value - left;
  if (filter === 2) return value - up;
  if (filter === 3) return value - ((left + up) >> 1);
  if (filter === 4) return value - paeth(left, up, corner);
  return value;
}

function paeth(left: number, up: number, corner: number): number {
  const estimate = left + up - corner;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toCorner = Math.abs(estimate - corner);
  if (toLeft <= toUp && toLeft <= toCorner) return left;
  return toUp <= toCorner ? up : corner;
}

function assemble(ihdr: Uint8Array, idat: Uint8Array, extra: Uint8Array[] = []): Uint8Array {
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk("IHDR", ihdr),
    ...extra,
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

function chunk(name: string, data: Uint8Array): Uint8Array {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(name, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function crc32(bytes: Uint8Array): number {
  let value = -1;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
  }
  return (value ^ -1) >>> 0;
}

/** An image of one repeated color, which is what a screen with a background looks like. */
function flat(width: number, height: number, color: number, pixel: number[]): Uint8Array {
  const samples = new Array(width * height).fill(0).flatMap(() => pixel);
  return assemble(header(width, height, color, 8, 0), lines(width * pixel.length, height, samples));
}

/** A gradient: the five filters have something to predict, which is the point of that test. */
function ramp(width: number, height: number, channels: number): number[] {
  const samples: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width * channels; x += 1) samples.push((x * 3 + y * 7) & 0xff);
  }
  return samples;
}

/**
 * Noise, which is the worst thing that can happen to a compressor and is therefore what makes the
 * comparison of sizes worth something: a flat image already leaves as four kilobytes.
 */
function noise(width: number, height: number): Uint8Array {
  const samples: number[] = [];
  let seed = 12345;
  for (let at = 0; at < width * height * 3; at += 1) {
    // `Math.imul` and not `*`: the product of two 32-bit numbers does not fit in a double, and
    // what gets lost is exactly the low bits this takes.
    seed = (Math.imul(seed, 1103515245) + 12345) | 0;
    samples.push((seed >>> 16) & 0xff);
  }
  return assemble(header(width, height, 2, 8, 0), lines(width * 3, height, samples));
}

/* ── Reading back what came out ──────────────────────────────────────────────────────────── */

const DECODED_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

interface Decoded {
  width: number;
  height: number;
  depth: number;
  color: number;
  pixels: Uint8Array;
}

/** Reads only what `fitScreenshot` writes: one `IDAT` and every line with filter 0. */
function decode(bytes: Uint8Array): Decoded {
  const buffer = Buffer.from(bytes);
  expect([...buffer.subarray(0, 8)]).toEqual(SIGNATURE);
  const pieces = new Map<string, Buffer[]>();
  let at = 8;
  while (at + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(at);
    const name = buffer.subarray(at + 4, at + 8).toString("latin1");
    const found = pieces.get(name) ?? [];
    found.push(buffer.subarray(at + 8, at + 8 + length));
    pieces.set(name, found);
    at += 12 + length;
  }

  const ihdr = pieces.get("IHDR")![0]!;
  const idat = pieces.get("IDAT")!;
  expect(idat.length).toBe(1);
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const channels = DECODED_CHANNELS[ihdr[9]!]!;
  const stride = width * channels;

  const raw = inflateSync(idat[0]!);
  expect(raw.length).toBe(height * (stride + 1));
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    expect(raw[y * (stride + 1)]).toBe(0);
    pixels.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { width, height, depth: ihdr[8]!, color: ihdr[9]!, pixels };
}
