import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SCREENSHOT_BYTES, SHOTS_DIR, writeTaste } from "@panoma/core";
import { listLooks, schema, type Database } from "@panoma/db";
import { formatBytes } from "@/lib/format-bytes";
import { emptySpendSettings, writeSpendSettings, type ShotPolicy } from "@/lib/spend-settings";

/**
 * The critic's surfaces, read as text.
 *
 * Two invariants live here that no execution would catch. The first is where the day's cap comes
 * from: since 6-Sep-2026 every organ asks `capFor` in `spend-settings.ts`, which is what makes
 * the owner's screen and the environment agree. A surface that went back to reading the variable
 * on its own would keep braking —at the factory value— and stop obeying the screen in silence.
 * The second is what the dry run uploads: nothing but the numbers. The upload path used to send
 * the whole base64 twice, once to ask the price and once to pay it, up to 4.67 MB for a figure
 * the route computes from `imageBytes`.
 */

const WEB = join(import.meta.dirname, "..", "..", "..", "..");
const read = (path: string) => readFileSync(join(WEB, path), "utf8");

describe("every look surface asks spend-settings for the day's cap", () => {
  for (const path of ["app/api/twin/look/route.ts", "lib/auto-look.ts", "app/(app)/twin/look/page.tsx"]) {
    it(`${path} calls capFor("look") and reads no variable of its own`, () => {
      const source = read(path);
      expect(source).toContain('capFor("look")');
      expect(source).not.toContain("PANOMA_LOOK_BUDGET");
      expect(source).not.toContain("budgetFrom");
    });
  }

  it("and the route keeps the same-origin guard in front of both handlers", () => {
    const source = read("app/api/twin/look/route.ts");
    expect(source.split("sameOrigin(request)").length - 1).toBe(2);
  });
});

/**
 * And one door for the reduction, which is a decision that cannot be taken twice.
 *
 * A capture reaches the model through three of them —the browser upload, `panoma twin look`, and
 * the watcher over the mailbox— and the two that live in this application apply the owner's choice
 * through the same helper, on the bytes that are about to travel. A surface that called the engine
 * on its own would drift the day one of the two learns something the other does not, and what
 * would drift is what the critic sees: two different screens depending on who asked.
 */
describe("the reduction is decided in one place", () => {
  for (const path of ["app/api/twin/look/route.ts", "lib/auto-look.ts"]) {
    it(`${path} goes through fitForLook and does not resize on its own`, () => {
      const source = read(path);
      expect(source).toContain("fitForLook(");
      expect(source).not.toContain("fitScreenshot(");
    });
  }

  it("and the watcher obeys the same saved choice, with nobody in front of it", () => {
    const source = read("lib/auto-look.ts");
    expect(source).toContain("await shotPolicy()");
  });
});

describe("the dry run travels without the image", () => {
  it("the screen strips `image` from the rehearsal body and keeps `imageBytes`", () => {
    const source = read("components/twin-look.tsx");
    expect(source).toContain("withoutImage(body), dryRun: true");
    expect(source).toContain('key !== "image"');
    expect(source).toContain("imageBytes: picked.size");
  });

  it("and the route measures what it is told when nothing arrived", () => {
    const source = read("app/api/twin/look/route.ts");
    expect(source).toContain("imageBytesOf(body, image)");
    expect(source).toContain("if (!dryRun && image === \"\")");
  });
});

/**
 * And what the critic is actually shown, which since 6-Sep-2026 the owner chooses.
 *
 * The refusal that `screenshot.ts` still carries —panoma does not shrink a capture, because
 * reducing what a model judges without saying so changes the judgment behind the back of whoever
 * asked for it— is kept by these four cases, not undone by them. The choice is applied on the
 * bytes that are about to travel, and both the rehearsal and the receipt say what happened: the
 * pixels that go, the pixels the file has, and, when the reduction was asked for and did not
 * happen, the reason in a code.
 *
 * The capture is built here byte by byte for the same reason as in `image.test.ts`: what is being
 * checked is a size read out of a header, and a PNG saved in the repository hides that behind a
 * name. What the mocked model receives is decoded and its `IHDR` is read, because "it travelled
 * reduced" is a claim about the bytes the provider got and nothing else proves it.
 */

const completeMock = vi.fn();
let database: Database;
vi.mock("@panoma/ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("@panoma/ai")>(),
  complete: (...args: unknown[]) => completeMock(...args),
  resolveCredential: async () => ({ provider: { id: "test" }, model: "test-eye" }),
}));
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }), memoryQuarantine: async () => ({ quarantined: false }) }));
const { POST } = await import("./route");

let home: string;
let root: string;
let close: (() => Promise<void>) | undefined;
const originalHome = process.env["PANOMA_HOME"];

/** Wider than the long edge of a fitted capture, so that there is something to reduce. */
const WIDE = { width: 1_600, height: 800 };
/** What `SHOT_MAX_EDGE` leaves of it: the long edge at the limit and the other side in proportion. */
const FIT = { width: 1_568, height: 784 };

let BIG: string;

/**
 * The capture the owner was refused: over the provider's cap on this disk, and far under it once
 * reduced.
 *
 * Three thousand by two thousand in grey, which is the shape of a screen on a machine that doubles
 * its pixels, and pure noise so that the file weighs what its pixels weigh — a gradient deflates to
 * a fraction and would need tens of millions of pixels to pass three and a half megabytes.
 */
const HEAVY = { width: 3_000, height: 2_000 };
/** What `SHOT_MAX_EDGE` leaves of it: the long edge at the limit, the other in proportion. */
const HEAVY_FIT = { width: 1_568, height: 1_045 };
const HEAVY_SHOT = "delivery-6-mb.png";
let heavyBytes: number;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-look-route-"));
  root = await mkdtemp(join(tmpdir(), "panoma-look-project-"));
  process.env["PANOMA_HOME"] = home;

  BIG = Buffer.from(png(WIDE.width, WIDE.height)).toString("base64");
  await mkdir(join(root, SHOTS_DIR), { recursive: true });
  await writeFile(join(root, SHOTS_DIR, "home.png"), Buffer.from(BIG, "base64"));

  const heavy = noisy(HEAVY.width, HEAVY.height);
  heavyBytes = heavy.length;
  await writeFile(join(root, SHOTS_DIR, HEAVY_SHOT), heavy);

  // The yardstick: without a portrait the route refuses before spending, which is another test.
  await writeTaste(
    [
      {
        topic: "design",
        statement: "Quieres que todas las secciones compartan la misma UI.",
        citations: ["v1"],
      },
    ],
    home,
  );

  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: "project-look", slug: "look", name: "Look", root, identity: "git:look" },
  ]);
});

afterAll(async () => {
  await close?.();
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  await rm(home, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  completeMock.mockReset().mockResolvedValue({
    text: "[]",
    provider: "test",
    model: "test-eye",
    usage: { input: 100, output: 10 },
  });
  await database.delete(schema.modelCalls);
  await database.delete(schema.looks);
});

/** What the owner chose on the Spend screen, saved where the route reads it. */
async function chooses(shots: ShotPolicy): Promise<void> {
  await writeSpendSettings({ ...emptySpendSettings(), shots });
}

function request(body: object): Request {
  return new Request("http://localhost:4173/api/twin/look", {
    method: "POST",
    headers: { "content-type": "application/json", "accept-language": "en" },
    body: JSON.stringify(body),
  });
}

/** The bytes the provider was handed, decoded. */
function shown(): Buffer {
  const call = completeMock.mock.calls[0]?.[0] as
    | { images: { data: string; mediaType: string }[] }
    | undefined;
  expect(call, "nobody was called").toBeTruthy();
  return Buffer.from(call!.images[0]!.data, "base64");
}

/** The size in the `IHDR` of a PNG: signature, length and name are sixteen bytes. */
function sizeOf(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("how much of the capture the critic gets to see", () => {
  it("reduces it when that is what was chosen, and says so before and after", async () => {
    await chooses("fit");
    const response = await POST(request({ slug: "look", image: BIG, mediaType: "image/png" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sent: { policy: "fit", fitted: true, ...FIT, from: WIDE },
    });
    expect(sizeOf(shown())).toEqual(FIT);
    /*
      And it is not the file with another header: what travels are other bytes. The weight is not
      asserted on purpose — an image is billed by its pixels, and this hand-made gradient deflates
      better than what comes out of resampling it, which says something about the fixture and
      nothing about the reduction.
     */
    expect(shown().equals(Buffer.from(BIG, "base64"))).toBe(false);
  });

  it("sends the very same file when nothing was chosen, and claims nothing else", async () => {
    await chooses("full");
    const response = await POST(request({ slug: "look", image: BIG, mediaType: "image/png" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sent: { policy: "full", fitted: false } });
    expect(shown().equals(Buffer.from(BIG, "base64"))).toBe(true);
    expect(sizeOf(shown())).toEqual(WIDE);
  });

  /*
    A JPEG is another animal —Huffman tables, cosine blocks— and this repository reads PNG and
    only PNG. What matters is not that it comes back whole, it is that the receipt says why: a
    capture that quietly ignored the choice would be the same silence the refusal was written
    against.
   */
  it("leaves a JPEG whole and names the reason on the receipt", async () => {
    await chooses("fit");
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]).toString("base64");
    const response = await POST(request({ slug: "look", image: jpeg, mediaType: "image/jpeg" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sent: { policy: "fit", fitted: false, why: "format" },
    });
    expect(shown().equals(Buffer.from(jpeg, "base64"))).toBe(true);
  });

  it("says in the rehearsal what would be sent, without calling anybody", async () => {
    await chooses("fit");
    const response = await POST(
      request({ slug: "look", image: BIG, mediaType: "image/png", dryRun: true }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sent: { policy: "fit", fitted: true, ...FIT, from: WIDE },
    });
    expect(completeMock).not.toHaveBeenCalled();
  });

  /*
    The rehearsal the browser and the terminal actually make travels without the image, so at that
    moment nobody has looked at those bytes. What it must not do is answer «it travels whole»,
    which is a claim, instead of «this is what you asked for», which is all that is known.
   */
  it("promises no size in a rehearsal that did not carry the image", async () => {
    await chooses("fit");
    const response = await POST(
      request({ slug: "look", mediaType: "image/png", imageBytes: 4_000_000, dryRun: true }),
    );

    const body = (await response.json()) as { sent: Record<string, unknown> };
    expect(body.sent).toEqual({ policy: "fit", maxEdge: 1_568 });
    expect(completeMock).not.toHaveBeenCalled();
  });

  /*
    And the row still remembers the delivery by its file. The watcher asks «has this been looked
    at?» with the digest of what is on the disk, and the mailbox screen paints its badge the same
    way: remembering a reduced capture by the digest of its reduction would make both answer no
    for ever, so the watcher would pay again on every pass.
   */
  it("remembers the capture by the file even when a reduction travelled", async () => {
    await chooses("fit");
    const response = await POST(request({ slug: "look", shot: "home.png" }));
    expect(response.status).toBe(200);

    const [row] = await listLooks(database, { limit: 1 });
    expect(row?.digest).toBe(createHash("sha256").update(Buffer.from(BIG, "base64")).digest("hex"));
    expect(sizeOf(shown())).toEqual(FIT);
  });
});

/**
 * The capture that weighs more than a provider accepts, which is the case the whole choice is for.
 *
 * Until 6-Sep-2026 the provider's 3.5 MB was applied when the file was opened **off this disk**,
 * which is another act with another price: a six-megabyte delivery was refused before anybody
 * could reduce it, and reducing it is precisely what `fit` does — this one leaves at a third of
 * the cap. So the ceilings were separated, the generous one for reading and the strict one for
 * what travels, and these four cases are the two halves of that: what now gets looked at, and what
 * still does not leave, with the reason said out loud in both directions.
 */
describe("a capture heavier than what a provider accepts", () => {
  it("is looked at when it was chosen reduced, and the size that travelled is said", async () => {
    await chooses("fit");
    expect(heavyBytes).toBeGreaterThan(MAX_SCREENSHOT_BYTES);

    const response = await POST(request({ slug: "look", shot: HEAVY_SHOT }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { sent: { bytes: number } };
    expect(body).toMatchObject({
      sent: { policy: "fit", fitted: true, ...HEAVY_FIT, from: HEAVY },
    });
    /* What the provider was handed, which is the only thing that proves the cap was honoured. */
    expect(sizeOf(shown())).toEqual(HEAVY_FIT);
    expect(shown().length).toBeLessThan(MAX_SCREENSHOT_BYTES);
    expect(body.sent.bytes).toBe(shown().length);
  });

  /*
    And under the policy panoma has always had, nothing moves: what is read is what leaves, so the
    provider's number governs from the moment the file is opened and the refusal carries its size.
   */
  it("is refused with its size when it was chosen whole", async () => {
    await chooses("full");
    const response = await POST(request({ slug: "look", shot: HEAVY_SHOT }));

    expect(response.status).toBe(409);
    const { error } = (await response.json()) as { error: string };
    expect(error).toContain(HEAVY_SHOT);
    expect(error).toContain(`${heavyBytes} B`);
    expect(completeMock).not.toHaveBeenCalled();
  });

  /*
    A JPEG is the other half of the same rule and the one that would have been sent by accident:
    it passes the door —under `fit` a file may arrive far heavier— and there is nothing here that
    can reduce it, so what would travel is six megabytes of a call that comes back as an error
    about encoding. It is refused before spending, and the sentence says why it could not be
    reduced instead of only how much it weighs.
   */
  it("refuses a JPEG over the cap and says why it could not be reduced", async () => {
    await chooses("fit");
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
      Buffer.alloc(MAX_SCREENSHOT_BYTES, 0x41),
    ]).toString("base64");

    const response = await POST(
      request({ slug: "look", image: jpeg, mediaType: "image/jpeg" }),
    );

    expect(response.status).toBe(409);
    const { error } = (await response.json()) as { error: string };
    expect(error).toContain("only a PNG can be reduced here");
    expect(completeMock).not.toHaveBeenCalled();
  });

  /*
    And the upload door checks the size itself, which it did not do at all: the browser refused
    what it would not accept and the browser is not the one who decides — `panoma up --network`
    serves this route to a phone, and a body arrives with whatever it likes inside.
   */
  it("refuses an upload over the cap on the server, not only in the browser", async () => {
    await chooses("full");
    const heavy = Buffer.alloc(MAX_SCREENSHOT_BYTES + 4_096, 0x7f).toString("base64");

    const response = await POST(
      request({ slug: "look", image: heavy, mediaType: "image/png" }),
    );

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: string };
    expect(error).toContain(formatBytes(MAX_SCREENSHOT_BYTES + 4_096));
    expect(error).toContain(formatBytes(MAX_SCREENSHOT_BYTES));
    expect(completeMock).not.toHaveBeenCalled();
  });
});

/* ── A capture made by hand ─────────────────────────────────────────────────────────────── */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * A PNG of the requested size: eight bits, three channels, filter 0 on every line.
 *
 * The pattern is a gradient and not a flat colour so that the reduction has something to average:
 * a capture of one single colour comes out of the resampler byte for byte identical whatever it
 * is asked, and a test over that proves the arithmetic ran, not that it worked.
 */
function png(width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const header = new DataView(ihdr.buffer);
  header.setUint32(0, width);
  header.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const stride = width * 3;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * (stride + 1) + 1 + x * 3;
      raw[at] = (x * 7) % 256;
      raw[at + 1] = (y * 5) % 256;
      raw[at + 2] = (x + y) % 256;
    }
  }

  return Uint8Array.from([
    ...SIGNATURE,
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", deflateSync(raw)),
    ...chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * A grey capture of pure noise, assembled with buffers because it weighs six megabytes.
 *
 * Noise and not a pattern because the file has to pass the provider's cap for real: anything that
 * deflates —a flat colour, the gradient above— would need tens of millions of pixels to get there,
 * and the reduction of tens of millions of pixels is not something to run inside a test. One
 * channel instead of three for the same reason. The generator is a xorshift with a fixed seed, so
 * the bytes are the same on every run and the sizes below can be asserted at all.
 */
function noisy(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;

  const raw = Buffer.alloc(height * (width + 1));
  let seed = 0x2f6e2b1;
  for (let y = 0; y < height; y += 1) {
    const line = y * (width + 1);
    for (let x = 0; x < width; x += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      raw[line + 1 + x] = seed & 0xff;
    }
  }

  return Buffer.concat([
    Buffer.from(SIGNATURE),
    heavyChunk("IHDR", ihdr),
    heavyChunk("IDAT", deflateSync(raw)),
    heavyChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The same piece as `chunk`, without spreading six million bytes through an array literal. */
function heavyChunk(name: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(name, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Length, name, content and the CRC of the last two. `node:zlib` brings the CRC. */
function chunk(name: string, data: Uint8Array): Uint8Array {
  const body = Uint8Array.from([...Buffer.from(name, "ascii"), ...data]);
  const out = new Uint8Array(body.length + 8);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(body, 4);
  new DataView(out.buffer).setUint32(body.length + 4, crc32(Buffer.from(body)));
  return out;
}

/*
  The fence: a catalog whose deletion journal is missing is quarantined, and a paid route sends
  nothing while it is — the door answers `503 unavailable`, the provider is never called, and
  the journal is put back afterwards. Pinned here for each paid door since 14-Sep-2026; the
  route tests above mock the quarantine away, so without this the fence guarded nothing a test
  could see.
 */
describe("the fence", () => {
  it("sends nothing and answers 503 unavailable while the deletion journal is missing", async () => {
    const { ensureDeletionJournal, deletionJournalPath } = await import("@panoma/db");
    const { rename } = await import("node:fs/promises");
    await ensureDeletionJournal(database, home);
    const path = deletionJournalPath(home);
    await rename(path, `${path}.held`);
    try {
      const response = await POST(request({ slug: "look", image: BIG, mediaType: "image/png" }));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "unavailable" });
      expect(completeMock).not.toHaveBeenCalled();
    } finally {
      await rename(`${path}.held`, path);
    }
  });
});
