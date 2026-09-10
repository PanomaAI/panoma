import { deflateSync, inflateSync } from "node:zlib";
import { imageTypeOf } from "./screenshot";

/*
  A capture reduced to the size its owner asked for, and nothing else.
  Why panoma does not do this on its own is written in `screenshot.ts`, and those reasons still
  hold: shrinking what a model is going to judge, without saying so, changes the judgment behind
  the back of the person who asked for it. What changed on 6-Sep-2026 is who decides. The owner
  chooses on the Spend screen between the capture as it is and a reduced one, the reduction is
  said out loud before spending, and it is said again on the receipt. This file is only the
  arithmetic: it reduces when it is called, refuses when it cannot, and decides nothing.
  ── Only PNG, and not one dependency ──────────────────────────────────────────────────────
  There is no image library in this repository and none may enter: a license test watches the
  dependencies, and the package travels as a single npm tarball whose size —16.7 MB with the
  catalog inside— is the reason nothing heavy gets in. The system tools that know how to do this,
  `sips` among them, exist on one of the three systems in the CI matrix, which is what already
  ruled them out once. What is left is `node:zlib`, which comes with Node and is enough, because
  a PNG is a zlib stream with a header in front — and a PNG is what a screen capture is on all
  three systems. A JPEG is another animal entirely (Huffman tables, cosine blocks, subsampled
  chroma): writing that decoder by hand to save a few tokens is a bad trade, so a JPEG comes back
  as `format` and the caller sends the original and says so.
  ── A refusal is not a failure ──────────────────────────────────────────────────────────────
  The five refusals exist so that this module never has to guess. `format` is a type that is not
  PNG; `already` is a capture whose long edge is under the limit, which must not be enlarged nor
  re-encoded for nothing; `variant` is a PNG written in a way this decoder does not read;
  `broken` is bytes that are not a readable PNG; and `huge` is a capture with more pixels than
  this machine is going to hold. In all five the caller sends the original: a capture reduced by
  guesswork is worse than a capture that arrives whole. That is also why nothing here throws — an
  exception in the middle of a paid call is a decision made by falling over.
  ── And `huge` measures this machine's memory, not the provider's ───────────────────────────
  What a PNG weighs says nothing about what it costs to open one. The decoder holds the whole
  image as raw samples while it resamples —width × height × channels, and the output beside it—
  so a file of four megabytes that deflated well is tens of megabytes of buffer here, and a
  refusal by file size would be measuring the wrong thing. `MAX_FIT_PIXELS` measures the right
  one, and it is read out of the `IHDR` before a single byte is allocated. Forty megapixels
  covers what this exists for: a 6K screen is about twenty and a long full-page capture about
  twenty-three, so nothing anybody actually wants judged lands here. Above it, a refusal is
  honest and an out-of-memory in the middle of a look is not — that call was already going to be
  paid for.
  What is read: color types 0 (gray), 2 (RGB), 4 (gray with alpha) and 6 (RGBA), at 8 or 16 bits,
  without interlacing. That is what a screen capture is on macOS, on Windows, and on the Linuxes
  of the matrix. A palette (color type 3) needs the `PLTE` and `tRNS` tables and is what an
  exported icon looks like, not a screen; Adam7 interlacing is seven images woven together and is
  what a web page from another decade looks like. Both are refused with `variant` instead of
  being read halfway.
  ── The filter: the average of the area, not the nearest pixel ──────────────────────────────
  Each output pixel covers a rectangle of the original, and its value is the average of that
  rectangle with the edges weighted by how much of them it covers. This is the correct filter for
  reducing and the reason is the thing being reduced: a screen is one-pixel lines, text at small
  sizes, and borders. Taking the nearest pixel —which is what is written by whoever wants to go
  fast— erases one of every n lines and leaves the rest intact, so a table loses half its rules
  and the critic reports a design flaw that does not exist. The average turns that line into a
  softer line, which is what someone looking at the screen from further away sees. And it works
  at any ratio, not only at whole factors: the target is the long edge, and the other side follows
  in proportion and never falls below one pixel.
  Alpha is composed, not averaged alongside the color. The color of each pixel is weighted by its
  own alpha before entering the average, and the result is divided by the alpha that came out.
  Without that, a transparent corner —whose color bytes are usually zeros— darkens the neighbors
  it is averaged with, and a rounded corner arrives with a dirty halo that was not in the
  original.
  ── Sixteen bits in, eight bits out ─────────────────────────────────────────────────────────
  A 16-bit capture is read whole and written at 8. It is not a loss worth defending here: 16 bits
  per channel exist for photographic work with room to correct exposure, and what travels from
  here is a screen going to be read by a critic that judges hierarchy, spacing, and contrast. The
  second byte of each channel doubles the size of what is paid for and does not change a single
  judgment. Whoever wants those bits does not fit the capture: that is what `full` is for.
  ── The encoder: filter 0, one IDAT, and its CRCs ───────────────────────────────────────────
  Out comes a PNG with the four pieces that make one: signature, `IHDR`, one `IDAT`, `IEND`. Each
  line goes out with filter byte 0 —no prediction— and this is the simplest thing that is also
  correct. The predictive filters exist to help the compressor and would save something here, but
  they are five more branches to get right on the way out with no one to compare against, and the
  image already leaves reduced by ten or twenty times. Simple and verifiable beats a few
  kilobytes. The CRC table is eight lines and is written here for the same reason as everything
  else in this file: it saves a dependency.
  ── The same bytes in give the same bytes out ───────────────────────────────────────────────
  Nothing here reads the clock, the environment, or a random number, and the accumulations always
  run in the same order. That is a property a test can assert, and it is worth asserting: a
  capture that is reduced twice into two different files is a capture whose reduction cannot be
  audited by the person paying for it.
 */

/** A capture already reduced: the new bytes, the size they have, and the size they came from. */
export interface FittedShot {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** What it measured before. This is half the sentence the caller has to say out loud. */
  from: { width: number; height: number };
}

/** Why a capture comes back untouched. None of the five is a failure; see the header. */
export type FitRefusal = "format" | "variant" | "already" | "broken" | "huge";

/**
 * How many pixels this decoder is willing to hold, at most. See header.
 *
 * It is a limit about the memory of this machine and not about what a provider accepts, which is
 * why it is a pixel count and not a file size.
 */
export const MAX_FIT_PIXELS = 40_000_000;

/**
 * Fit a capture so that its long edge measures `maxEdge`, or explain why it comes back whole.
 *
 * `maxEdge` is the caller's and is not refused over: a fraction is floored, and a limit that is
 * not a number —or one without a ceiling— means there is nothing to fit and answers `already`.
 */
export function fitScreenshot(
  bytes: Uint8Array,
  maxEdge: number,
): { ok: true; shot: FittedShot } | { ok: false; why: FitRefusal } {
  const type = imageTypeOf(asBuffer(bytes));
  // Not one of the four signatures: these bytes are not an image this repository sends anywhere.
  if (type === undefined) return refuse("broken");
  if (type !== "image/png") return refuse("format");

  const parts = splitChunks(bytes);
  if (parts === undefined) return refuse("broken");

  const header = readHeader(parts.ihdr);
  if (header === undefined) return refuse("broken");

  const edge = Math.floor(maxEdge);
  // `!(edge >= 1)` and not `edge < 1`, so that a limit that is not a number lands here too.
  if (!(edge >= 1)) return refuse("already");
  if (Math.max(header.width, header.height) <= edge) return refuse("already");

  // Out of the header and before anything is allocated: what has to be bounded is the pixel count
  // the decoder would have to hold, and the file size does not know it. See the header.
  if (header.width * header.height > MAX_FIT_PIXELS) return refuse("huge");

  const channels = CHANNELS[header.color];
  if (channels === undefined) return refuse(header.color === 3 ? "variant" : "broken");
  if (header.depth !== 8 && header.depth !== 16) return refuse("variant");
  if (header.interlace !== 0) return refuse("variant");
  // Both fields have exactly one value defined in the standard; anything else is a PNG written
  // against a specification this decoder has never read.
  if (header.compression !== 0 || header.filter !== 0) return refuse("variant");

  let raw: Uint8Array;
  try {
    raw = inflateSync(asBuffer(concat(parts.idat)));
  } catch {
    // A zlib stream that does not open is corruption, and it is caught here rather than falling
    // over on top of the caller.
    return refuse("broken");
  }

  const bytesPerPixel = channels * (header.depth === 16 ? 2 : 1);
  const pixels = unfilter(raw, header.width, header.height, bytesPerPixel);
  if (pixels === undefined) return refuse("broken");

  const target = fitted(header.width, header.height, edge);
  const reduced = resample(
    { pixels, width: header.width, height: header.height, channels, depth: header.depth },
    target.width,
    target.height,
  );

  return {
    ok: true,
    shot: {
      bytes: encodePng(reduced, target.width, target.height, header.color, channels),
      width: target.width,
      height: target.height,
      from: { width: header.width, height: header.height },
    },
  };
}

function refuse(why: FitRefusal): { ok: false; why: FitRefusal } {
  return { ok: false, why };
}

/** How many samples each color type carries. Absent means this decoder does not read it. */
const CHANNELS: Record<number, number | undefined> = { 0: 1, 2: 3, 4: 2, 6: 4 };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface PngHeader {
  width: number;
  height: number;
  depth: number;
  color: number;
  compression: number;
  filter: number;
  interlace: number;
}

interface Plane {
  pixels: Uint8Array;
  width: number;
  height: number;
  channels: number;
  depth: number;
}

/**
 * Walk the pieces of the file and keep the two that carry the image.
 *
 * The CRC of what comes in is not checked, and that is deliberate: the pixels travel inside a
 * zlib stream that carries its own checksum, so the corruption that matters is caught anyway when
 * inflating. Refusing a capture whose pixels open perfectly, because a piece nobody reads has a
 * stale CRC, would be throwing away an image the model could have looked at.
 */
function splitChunks(bytes: Uint8Array): { ihdr: Uint8Array; idat: Uint8Array[] } | undefined {
  if (bytes.length < 8) return undefined;
  for (let at = 0; at < 8; at += 1) if (bytes[at] !== PNG_SIGNATURE[at]) return undefined;

  let at = 8;
  let ihdr: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  while (at + 8 <= bytes.length) {
    const length = uint32(bytes, at);
    const next = at + 12 + length;
    // A piece that says it is longer than what is left: the file is cut off.
    if (next > bytes.length) return undefined;
    const name = chunkName(bytes, at + 4);
    if (name === "IHDR") ihdr = bytes.subarray(at + 8, at + 8 + length);
    else if (name === "IDAT") idat.push(bytes.subarray(at + 8, at + 8 + length));
    else if (name === "IEND") break;
    at = next;
  }

  if (ihdr === undefined || ihdr.length < 13 || idat.length === 0) return undefined;
  return { ihdr, idat };
}

/** The four letters that name a piece, which the standard fixes as ASCII. */
function chunkName(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
}

/** The thirteen bytes of `IHDR`. A side measuring zero is not an image. */
function readHeader(ihdr: Uint8Array): PngHeader | undefined {
  const width = uint32(ihdr, 0);
  const height = uint32(ihdr, 4);
  if (width === 0 || height === 0) return undefined;
  return {
    width,
    height,
    depth: ihdr[8]!,
    color: ihdr[9]!,
    compression: ihdr[10]!,
    filter: ihdr[11]!,
    interlace: ihdr[12]!,
  };
}

/**
 * Undo the prediction of each line and leave the samples flat.
 *
 * Every line arrives with a byte in front saying which of the five filters was applied to it, and
 * all five predict from the pixel to the left, the one above, and the one above-left. The count
 * has to come out exact: a stream that inflates to a different number of bytes than the header
 * announces is a file this decoder is reading wrong, and reading it wrong is exactly what must
 * not reach a model.
 */
function unfilter(
  raw: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number,
): Uint8Array | undefined {
  const stride = width * bytesPerPixel;
  if (raw.length !== height * (stride + 1)) return undefined;

  const out = new Uint8Array(height * stride);
  let read = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[read]!;
    read += 1;
    const line = y * stride;
    const above = line - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[read + x]!;
      const left = x >= bytesPerPixel ? out[line + x - bytesPerPixel]! : 0;
      const up = y > 0 ? out[above + x]! : 0;
      const corner = x >= bytesPerPixel && y > 0 ? out[above + x - bytesPerPixel]! : 0;
      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4:
          restored = value + paeth(left, up, corner);
          break;
        default:
          return undefined;
      }
      out[line + x] = restored & 0xff;
    }
    read += stride;
  }
  return out;
}

/** The predictor of filter 4: of the three neighbors, the one closest to their linear estimate. */
function paeth(left: number, up: number, corner: number): number {
  const estimate = left + up - corner;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toCorner = Math.abs(estimate - corner);
  if (toLeft <= toUp && toLeft <= toCorner) return left;
  return toUp <= toCorner ? up : corner;
}

/** The long edge lands on the limit and the other follows in proportion, never below one pixel. */
function fitted(width: number, height: number, edge: number): { width: number; height: number } {
  if (width >= height) {
    return { width: edge, height: Math.max(1, Math.round((height * edge) / width)) };
  }
  return { width: Math.max(1, Math.round((width * edge) / height)), height: edge };
}

/** The average of the area covered by each output pixel. The header explains why this filter. */
function resample(source: Plane, width: number, height: number): Uint8Array {
  const { pixels, channels, depth } = source;
  const alphaAt = channels === 2 ? 1 : channels === 4 ? 3 : -1;
  const colors = alphaAt < 0 ? channels : channels - 1;
  const top = depth === 16 ? 65535 : 255;

  const out = new Uint8Array(width * height * channels);
  const sums = new Float64Array(colors);
  for (let y = 0; y < height; y += 1) {
    const from = (y * source.height) / height;
    const to = ((y + 1) * source.height) / height;
    const firstRow = Math.floor(from);
    const lastRow = Math.min(source.height - 1, Math.ceil(to) - 1);
    for (let x = 0; x < width; x += 1) {
      const start = (x * source.width) / width;
      const end = ((x + 1) * source.width) / width;
      const firstColumn = Math.floor(start);
      const lastColumn = Math.min(source.width - 1, Math.ceil(end) - 1);

      sums.fill(0);
      let alpha = 0;
      let area = 0;
      for (let row = firstRow; row <= lastRow; row += 1) {
        // What this output pixel covers of this row: whole in the middle, a fraction at the edges.
        const tall = Math.min(to, row + 1) - Math.max(from, row);
        if (tall <= 0) continue;
        for (let column = firstColumn; column <= lastColumn; column += 1) {
          const wide = Math.min(end, column + 1) - Math.max(start, column);
          if (wide <= 0) continue;
          const weight = tall * wide;
          const at = (row * source.width + column) * channels;
          const opacity = alphaAt < 0 ? 1 : sampleOf(pixels, at + alphaAt, depth) / top;
          const weighted = weight * opacity;
          area += weight;
          alpha += weighted;
          for (let channel = 0; channel < colors; channel += 1) {
            sums[channel]! += weighted * (sampleOf(pixels, at + channel, depth) / top);
          }
        }
      }

      const at = (y * width + x) * channels;
      // Divided by the alpha that came out, not by the area: that is what un-weights the color.
      // With everything transparent there is no color to recover, and zero is as good as any.
      for (let channel = 0; channel < colors; channel += 1) {
        out[at + channel] = alpha > 0 ? byteOf(sums[channel]! / alpha) : 0;
      }
      if (alphaAt >= 0) out[at + alphaAt] = area > 0 ? byteOf(alpha / area) : 0;
    }
  }
  return out;
}

/** One sample, whatever its depth. At 16 bits the two bytes come in big-endian, as in the file. */
function sampleOf(pixels: Uint8Array, index: number, depth: number): number {
  if (depth === 8) return pixels[index]!;
  const at = index * 2;
  return (pixels[at]! << 8) | pixels[at + 1]!;
}

function byteOf(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

/**
 * The four pieces of a PNG, with the lines deflated at the slowest level.
 *
 * The level is worth it: this is compressed once and what comes out is paid for by the token on
 * every call that looks at it. Deflating harder is the cheapest saving in the whole path.
 */
function encodePng(
  pixels: Uint8Array,
  width: number,
  height: number,
  color: number,
  channels: number,
): Uint8Array {
  const stride = width * channels;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    // Filter byte 0: this line is not predicted from anything. See the header.
    raw[y * (stride + 1)] = 0;
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  putUint32(ihdr, 0, width);
  putUint32(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = color;

  return concat([
    Uint8Array.from(PNG_SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(asBuffer(raw), { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** A piece: its length, its name, its content, and the CRC of the last two. */
function chunk(name: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  putUint32(out, 0, data.length);
  for (let at = 0; at < 4; at += 1) out[4 + at] = name.charCodeAt(at);
  out.set(data, 8);
  putUint32(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** The table of the standard, which is the same one in every PNG ever written. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let byte = 0; byte < 256; byte += 1) {
    let value = byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[byte] = value;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = -1;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ -1) >>> 0;
}

function uint32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0
  );
}

function putUint32(target: Uint8Array, at: number, value: number): void {
  target[at] = (value >>> 24) & 0xff;
  target[at + 1] = (value >>> 16) & 0xff;
  target[at + 2] = (value >>> 8) & 0xff;
  target[at + 3] = value & 0xff;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** `imageTypeOf` reads a `Buffer`. This looks at the same memory without copying it. */
function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
