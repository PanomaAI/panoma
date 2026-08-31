import { readFile, stat } from "node:fs/promises";

/*
  A capture read from the disk, checked inside and ready to travel to a model.
  Panoma does not take the capture. Your project doesn't start, it doesn't open a browser, and it
  doesn't have one to open: putting a Chromium in the package would multiply it by a hundred —
  today it's 16.7 MB in total, catalog included — it would only serve for what is seen on a web
  page, and it would require starting your server to see your own screen. What is seen is what you
  give it. That applies to a route, to a desktop application, to a Figma frame, and to a mobile
  photo taken with the other mobile, and in all four it is exactly what you had in front of you
  when you were going to judge it.
  ── The type comes from the bytes, never from the extension ──────────────────────────────────
  A `.png` that is a JPEG on the inside is the most normal thing in the world: it comes from
  renaming a file, from a 'save as' that doesn't convert, or from any tool that exports whatever
  it wants. Declaring `image/png` over JPEG bytes is rejected by the provider with an error that
  talks about encoding and not about your file, in the middle of a call that has already been paid
  for. Eight bytes read here save that, and in the process are the only check that distinguishes
  an image from a PDF that someone dragged by mistake.
  ── What cannot be crossed out ─────────────────────────────────────────────────────────
  Everything else that comes out of this disk on its way to a model first goes through a marker:
  quotes through `redactQuote`, provider errors through `redact`. **An image does not.** There is
  no way to mark pixels without seeing them, and seeing them is exactly what is not done here. If
  in the corner of your capture there is a key written on a terminal, that key comes out with the
  image. That’s why the caller has to say out loud which file is going to be sent and where before
  sending it — `twin look` does this on the terminal — and that’s why this module returns the path
  and the size along with the bytes: so that phrase can be written.
  ── The stop, and why it is rejected instead of shrinking ───────────────────────────────────
  Anthropic accepts five megabytes per already encoded image, and base64 inflates by a third:
  hence the 3.5 MB file. A full screenshot on a modern laptop easily exceeds this, so this is
  going to be encountered for real. And still, the image isn't shrunk: there is no image library
  in this repository, writing a resizer by hand for something that is taught to a model is
  changing what it judges without telling anyone, and the system tools that do know how to do this
  —`sips`— exist in one of the three systems of the CI matrix. It is rejected based on size, which
  is what allows trimming or exporting to JPEG with judgment.
 */

/** The four types that today are accepted by the three families of providers. */
export type ImageType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** A capture already read: the bytes in base64 and what is known about it without looking at it. */
export interface Screenshot {
  /** The route exactly as written by the caller. It is taught before sending. */
  path: string;
  /** The content in base64, without the prefix `data:`. */
  data: string;
  mediaType: ImageType;
  bytes: number;
  /**
   * In pixels, when the header of the format says so. It serves two purposes: to show that the
   * file has really been read, and to warn that a 200 px thumbnail is not enough to judge a
   * screen. It is missing when the header comes in a variant that this module does not know how to
   * read, and missing is better than inventing it.
   */
  width?: number;
  height?: number;
}

/** Why can't this file be looked at. Neutral: the sentence is written by every surface. */
export type ScreenshotProblem = "missing" | "empty" | "not-an-image" | "too-big";

export class ScreenshotError extends Error {
  constructor(
    readonly problem: ScreenshotProblem,
    readonly path: string,
    /** What matters, when it became known. */
    readonly bytes?: number,
  ) {
    super(`No se puede mirar ${path}: ${problem}`);
    this.name = "ScreenshotError";
  }
}

/**
 * The file limit, in bytes. See header: five megabytes from the provider minus what Base64
 * inflates.
 */
export const MAX_SCREENSHOT_BYTES = 3_500_000;

/**
 * Below this, it is not a screen, it is a thumbnail.
 *
 * It does not refuse —whoever wants to show an icon to a model is within their right— but the
 * caller can give a warning. The number is the width of a small mobile: below that, a judgment
 * about spacing or hierarchy speaks of the scale at which the file was saved.
 */
export const SMALL_SCREENSHOT_WIDTH = 480;

/**
 * Read a screenshot and prepare it to send, or explain why not.
 *
 * `stat` is done before `readFile` on purpose: an eighty-megabyte file is rejected without loading
 * it into memory, which is the difference between an error message and a dead process. The
 * subsequent `readFile` may read something different from what `stat` measured—the file can grow
 * between the two—so the true size is checked again based on the bytes read, which is the only one
 * that will be sent.
 */
export async function readScreenshot(
  path: string,
  options: { maxBytes?: number } = {},
): Promise<Screenshot> {
  const cap = options.maxBytes ?? MAX_SCREENSHOT_BYTES;

  const info = await stat(path).catch(() => undefined);
  if (info === undefined || !info.isFile()) throw new ScreenshotError("missing", path);
  if (info.size > cap) throw new ScreenshotError("too-big", path, info.size);

  const bytes = await readFile(path).catch(() => undefined);
  if (bytes === undefined) throw new ScreenshotError("missing", path);
  if (bytes.length === 0) throw new ScreenshotError("empty", path, 0);
  if (bytes.length > cap) throw new ScreenshotError("too-big", path, bytes.length);

  const mediaType = imageTypeOf(bytes);
  if (mediaType === undefined) throw new ScreenshotError("not-an-image", path, bytes.length);

  const size = dimensions(bytes, mediaType);
  return {
    path,
    data: bytes.toString("base64"),
    mediaType,
    bytes: bytes.length,
    ...(size ? { width: size.width, height: size.height } : {}),
  };
}

/**
 * The type, read from the first bytes. Twelve are enough: none of the four signatures is longer,
 * so anyone who only wants to know if a file is an image can read the header and not the file —
 * which is what `readShots` does when going through a mailbox.
 *
 * The four signatures are those of the standard for each format and never change: they are the
 * beginning of the file by definition. WebP is the only one that needs two pieces — `RIFF` at the
 * beginning and `WEBP` at byte eight — because `RIFF` on its own is also a WAV or an AVI, and
 * sending an audio file claiming it is an image is exactly the mistake this function exists to
 * avoid making.
 */
export function imageTypeOf(bytes: Buffer): ImageType | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6) {
    const head = bytes.subarray(0, 6).toString("latin1");
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The size in pixels, or nothing. Never throws: a rare header is worth less than the process. */
function dimensions(bytes: Buffer, type: ImageType): { width: number; height: number } | undefined {
  try {
    if (type === "image/png") return pngSize(bytes);
    if (type === "image/gif") return gifSize(bytes);
    if (type === "image/jpeg") return jpegSize(bytes);
    return webpSize(bytes);
  } catch {
    // A file cut in half is still an image that the model might know how to read. What is lost is
    // the width, not the call.
    return undefined;
  }
}

/** PNG: the header `IHDR` is mandatory and is the first piece, always in the same place. */
function pngSize(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 24 || bytes.subarray(12, 16).toString("latin1") !== "IHDR") return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** GIF: width and height in byte six, in little-endian. The format has not changed since 1989. */
function gifSize(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 10) return undefined;
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

/**
 * JPEG: you have to move the markers up to the one that declares the frame.
 *
 * There is no fixed location: before the frame there may be EXIF, a color profile, the camera
 * thumbnail, and various comments, each with its length. It skips segment by segment until it
 * comes to a `SOFn`, which is the only one that carries the size. `C4`, `C8`, and `CC` are
 * excluded because they fall within the `C0..CF` range and are not frames: they are the Huffman
 * tables, a JPEG extension that does not exist in practice, and the arithmetic definition.
 * Confusing one of these with a frame would give a size taken from a table.
 */
function jpegSize(bytes: Buffer): { width: number; height: number } | undefined {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1]!;
    // Filler between segments: a strip of `ff` is legal and does not start anything.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
    }
    // `SOS` (`da`) opens the compressed data: from then on there is no headers left to read.
    if (marker === 0xda) return undefined;
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  return undefined;
}

/**
 * WebP: three formats within the same wrapper, and all three keep different sizes.
 *
 * `VP8X` is the extended (animation, transparency): canvas in three little-endian bytes minus one.
 * `VP8L` is lossless: fourteen bits wide and fourteen high packed in four bytes. `VP8 ` is lossy:
 * two fourteen-bit integers behind the sync code. A variant that is none of the three remains
 * without size.
 */
function webpSize(bytes: Buffer): { width: number; height: number } | undefined {
  const kind = bytes.subarray(12, 16).toString("latin1");

  if (kind === "VP8X" && bytes.length >= 30) {
    const width = bytes.readUIntLE(24, 3) + 1;
    const height = bytes.readUIntLE(27, 3) + 1;
    return { width, height };
  }

  if (kind === "VP8L" && bytes.length >= 25) {
    const packed = bytes.readUInt32LE(21);
    return { width: (packed & 0x3fff) + 1, height: ((packed >> 14) & 0x3fff) + 1 };
  }

  if (kind === "VP8 " && bytes.length >= 30) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }

  return undefined;
}
