import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MAX_SCREENSHOT_BYTES, SHOTS_DIR } from "@panoma/core";
import { schema, type Database } from "@panoma/db";
import { emptySpendSettings, writeSpendSettings, type ShotPolicy } from "@/lib/spend-settings";

/**
 * The thumbnail follows the look, and that is the whole rule of this route.
 *
 * The equality was written the day the mailbox got a screen: what does not fit in a call does not
 * need to be rendered either, because the button next to it will refuse it — two different limits
 * would give a beautiful miniature of something that later cannot be looked at. Since 6-Sep-2026
 * that same reasoning points the other way as well. With `fit` a six-megabyte delivery **is**
 * looked at, because it travels reduced; a thumbnail that still refused it would leave the person
 * choosing between file names, blind, in front of a capture the critic reads perfectly well.
 *
 * The capture is noise on purpose: a file has to pass the provider's cap for real, and anything
 * that deflates would need tens of millions of pixels to get there.
 */

let database: Database;
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
const { GET } = await import("./route");

let home: string;
let root: string;
let close: (() => Promise<void>) | undefined;
const originalHome = process.env["PANOMA_HOME"];

const HEAVY = "delivery-6-mb.png";
const LIGHT = "home.png";
let heavyBytes: number;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-shot-route-"));
  root = await mkdtemp(join(tmpdir(), "panoma-shot-project-"));
  process.env["PANOMA_HOME"] = home;

  await mkdir(join(root, SHOTS_DIR), { recursive: true });
  const heavy = noisy(3_000, 2_000);
  heavyBytes = heavy.length;
  await writeFile(join(root, SHOTS_DIR, HEAVY), heavy);
  await writeFile(join(root, SHOTS_DIR, LIGHT), noisy(200, 120));

  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: "project-shot", slug: "shot", name: "Shot", root, identity: "git:shot" },
  ]);
});

afterAll(async () => {
  await close?.();
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  await rm(home, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

/** What the owner chose on the Spend screen, saved where the route reads it. */
async function chooses(shots: ShotPolicy): Promise<void> {
  await writeSpendSettings({ ...emptySpendSettings(), shots });
}

function ask(name: string): Request {
  const url = new URL("http://localhost:4173/api/twin/shot");
  url.searchParams.set("slug", "shot");
  url.searchParams.set("name", name);
  return new Request(url, { headers: { "accept-language": "en" } });
}

describe("the thumbnail uses the ceiling the look would use", () => {
  it("renders a capture over the provider's cap when it was chosen reduced", async () => {
    await chooses("fit");
    expect(heavyBytes).toBeGreaterThan(MAX_SCREENSHOT_BYTES);

    const response = await GET(ask(HEAVY));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Number(response.headers.get("content-length"))).toBe(heavyBytes);
  });

  it("refuses the same file, with its size, when it was chosen whole", async () => {
    await chooses("full");
    const response = await GET(ask(HEAVY));

    expect(response.status).toBe(409);
    const { error } = (await response.json()) as { error: string };
    expect(error).toContain(HEAVY);
    expect(error).toContain(`${heavyBytes} B`);
  });

  it("renders what fits under either of the two", async () => {
    for (const shots of ["full", "fit"] as const) {
      await chooses(shots);
      const response = await GET(ask(LIGHT));
      expect(response.status, shots).toBe(200);
    }
  });
});

/* ── A capture made by hand ─────────────────────────────────────────────────────────────── */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Grey noise, so that the file weighs what its pixels weigh. Fixed seed: the same bytes always. */
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
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Length, name, content and the CRC of the last two. `node:zlib` brings the CRC. */
function chunk(name: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(name, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
