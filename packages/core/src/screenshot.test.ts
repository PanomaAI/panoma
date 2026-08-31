import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MAX_SCREENSHOT_BYTES,
  ScreenshotError,
  readScreenshot,
  type ImageType,
} from "./screenshot";

/**
 * The images here are made byte by byte and are not read from any test material folder, for two
 * reasons.
 *
 * The first is that what is checked **are** the bytes: the signature that decides the type and the
 * header from which the size comes. A PNG saved in the repository would have them the same, but no
 * one reading the test could see what they are or why those; written here, the case and its
 * explanation are on the same screen.
 *
 * The second is that the cases that matter cannot be saved in a normal file: a JPEG with a PNG
 * name, a RIFF that is a WAV, a PNG cut off after the signature. These are deliberately malformed
 * files, and a repository loses them as soon as someone runs a tool over them.
 *
 * None of this is a decodable image, and it doesn't need to be: this module doesn't decode
 * anything. It reads the header and converts the bytes to base64.
 */

let carpeta: string;

beforeAll(async () => {
  carpeta = await mkdtemp(join(tmpdir(), "panoma-captura-"));
});

afterAll(async () => {
  await rm(carpeta, { recursive: true, force: true });
});

/** A real PNG, with its `IHDR` and a `IDAT` that decompresses. */
function png(width: number, height: number): Buffer {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

let tabla: Int32Array | undefined;
function crc32(buffer: Buffer): number {
  if (!tabla) {
    tabla = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabla[n] = c;
    }
  }
  let c = -1;
  for (const byte of buffer) c = tabla[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return c ^ -1;
}

/** A JPEG with an EXIF segment in front of the frame, which is what comes out of a camera. */
function jpeg(width: number, height: number): Buffer {
  const exif = Buffer.alloc(64, 0);
  exif.writeUInt16BE(exif.length - 2, 0); // The length counts itself, not the marker.
  const sof = Buffer.alloc(17, 0);
  sof.writeUInt16BE(15, 0);
  sof[2] = 8;
  sof.writeUInt16BE(height, 3);
  sof.writeUInt16BE(width, 5);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe1]),
    exif,
    Buffer.from([0xff, 0xc0]),
    sof,
    Buffer.from([0xff, 0xd9]),
  ]);
}

function gif(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(14, 0);
  buffer.write("GIF89a", 0, "latin1");
  buffer.writeUInt16LE(width, 6);
  buffer.writeUInt16LE(height, 8);
  return buffer;
}

/** Lossless WebP: fourteen bits wide and fourteen high, minus one, packed. */
function webpLossless(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30, 0);
  buffer.write("RIFF", 0, "latin1");
  buffer.write("WEBP", 8, "latin1");
  buffer.write("VP8L", 12, "latin1");
  buffer[20] = 0x2f;
  buffer.writeUInt32LE(((height - 1) << 14) | (width - 1), 21);
  return buffer;
}

async function escribir(nombre: string, bytes: Buffer): Promise<string> {
  const ruta = join(carpeta, nombre);
  await writeFile(ruta, bytes);
  return ruta;
}

/** What was launched, already recognized: `expect().rejects` does not allow viewing the error fields. */
async function problema(ruta: string): Promise<ScreenshotError> {
  try {
    await readScreenshot(ruta);
  } catch (error) {
    if (error instanceof ScreenshotError) return error;
    throw error;
  }
  throw new Error(`Se esperaba un ScreenshotError leyendo ${ruta} y no hubo ninguno.`);
}

describe("el tipo sale de los bytes", () => {
  const casos: { nombre: string; fichero: string; bytes: () => Buffer; tipo: ImageType }[] = [
    { nombre: "un PNG", fichero: "pantalla.png", bytes: () => png(1440, 900), tipo: "image/png" },
    { nombre: "un JPEG", fichero: "foto.jpg", bytes: () => jpeg(4032, 3024), tipo: "image/jpeg" },
    { nombre: "un GIF", fichero: "captura.gif", bytes: () => gif(800, 600), tipo: "image/gif" },
    {
      nombre: "un WebP sin pérdida",
      fichero: "exportado.webp",
      bytes: () => webpLossless(1024, 768),
      tipo: "image/webp",
    },
  ];

  for (const caso of casos) {
    it(`reconoce ${caso.nombre}`, async () => {
      const captura = await readScreenshot(await escribir(caso.fichero, caso.bytes()));
      expect(captura.mediaType).toBe(caso.tipo);
      expect(captura.bytes).toBeGreaterThan(0);
    });
  }

  /*
    The case that justifies the whole module. With the extension, this would travel declared as
    PNG and the provider would respond with an encoding error in the middle of an already paid
    call.
   */
  it("un JPEG llamado .png viaja como JPEG", async () => {
    const captura = await readScreenshot(await escribir("mentira.png", jpeg(1200, 800)));
    expect(captura.mediaType).toBe("image/jpeg");
  });

  it("un PDF arrastrado por error no es una imagen", async () => {
    const error = await problema(
      await escribir("informe.pdf", Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj", "latin1")),
    );
    expect(error.problem).toBe("not-an-image");
  });

  /*
    `RIFF` by itself also starts a WAV and an AVI. Without the second check —`WEBP` in byte eight—
    an audio would come out of here declared as an image.
   */
  it("un WAV no pasa por WebP aunque empiece por RIFF", async () => {
    const wav = Buffer.alloc(44, 0);
    wav.write("RIFF", 0, "latin1");
    wav.write("WAVE", 8, "latin1");
    expect((await problema(await escribir("sonido.wav", wav))).problem).toBe("not-an-image");
  });
});

describe("el tamaño en píxeles", () => {
  it("lo lee del IHDR de un PNG", async () => {
    const captura = await readScreenshot(await escribir("retina.png", png(2880, 1800)));
    expect(captura.width).toBe(2880);
    expect(captura.height).toBe(1800);
  });

  /*
    The height comes before the width within the `SOFn`, the opposite of all the other formats in
    this file. A landscape photo read in reverse comes out vertical, and the warning 'this is a
    thumbnail' would trigger in the wrong half of the cases.
   */
  it("salta el EXIF de un JPEG y no confunde el alto con el ancho", async () => {
    const captura = await readScreenshot(await escribir("movil.jpg", jpeg(4032, 3024)));
    expect(captura.width).toBe(4032);
    expect(captura.height).toBe(3024);
  });

  it("lo lee en little-endian de un GIF", async () => {
    const captura = await readScreenshot(await escribir("animado.gif", gif(320, 240)));
    expect(captura.width).toBe(320);
    expect(captura.height).toBe(240);
  });

  it("lo desempaqueta de los catorce bits de un WebP sin pérdida", async () => {
    const captura = await readScreenshot(await escribir("web.webp", webpLossless(1024, 768)));
    expect(captura.width).toBe(1024);
    expect(captura.height).toBe(768);
  });

  /*
    A cut file is still an image that the model might be able to read, so what is lost is the size
    and not the call. The alternative —launching— would turn a half download into a command that
    doesn't start.
   */
  it("una cabecera cortada deja la captura sin tamaño, no sin viaje", async () => {
    const cortado = png(100, 100).subarray(0, 10);
    const captura = await readScreenshot(await escribir("cortado.png", cortado));
    expect(captura.mediaType).toBe("image/png");
    expect(captura.width).toBeUndefined();
    expect(captura.height).toBeUndefined();
  });
});

describe("lo que no se puede mirar", () => {
  it("un fichero que no está", async () => {
    expect((await problema(join(carpeta, "no-existe.png"))).problem).toBe("missing");
  });

  it("una carpeta donde iba el fichero", async () => {
    expect((await problema(carpeta)).problem).toBe("missing");
  });

  it("un fichero vacío", async () => {
    expect((await problema(await escribir("vacio.png", Buffer.alloc(0)))).problem).toBe("empty");
  });

  /*
    The size travels within the error because it is the only thing that makes the rejection
    actionable: "3.5 MB at most" without saying how much yours weighs forces you to go check it
    elsewhere.
   */
  it("uno que se pasa del tope, con su tamaño dentro del error", async () => {
    const grande = Buffer.concat([png(4, 4), Buffer.alloc(MAX_SCREENSHOT_BYTES, 0x20)]);
    const error = await problema(await escribir("enorme.png", grande));
    expect(error.problem).toBe("too-big");
    expect(error.bytes).toBe(grande.length);
  });

  /*
    The limit is checked with `stat` before reading: an eighty-megabyte file should not enter
    memory in order to be able to reject it. Here the observable consequence is stated — the size
    of the error is that of the entire file, which only `stat` knows without reading it.
   */
  it("se rechaza por lo que mide, no por lo que se llegó a leer", async () => {
    const error = await problema(
      await escribir("tocho.bin", Buffer.alloc(MAX_SCREENSHOT_BYTES + 1024, 0)),
    );
    expect(error.bytes).toBe(MAX_SCREENSHOT_BYTES + 1024);
  });
});

/*
  What is sent is exactly what is on the disk. It is the promise that underlies the command's
  warning —'this comes from your machine'—: if it were cut, recompressed, or had its metadata
  removed here, the phrase shown to the user would describe another file.
 */
it("los bytes viajan enteros, en base64", async () => {
  const original = png(64, 48);
  const captura = await readScreenshot(await escribir("intacta.png", original));
  expect(Buffer.from(captura.data, "base64").equals(original)).toBe(true);
  expect(captura.bytes).toBe(original.length);
});
