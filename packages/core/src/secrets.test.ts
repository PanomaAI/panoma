import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findSecrets } from "./secrets";

/*
  The scanner reads what git tracks, so each case needs a real repository with its commit. You set
  up just one and add files to it: `git ls-files` sees them as soon as they are in the index,
  without needing to commit each one.
 */
let repo = "";

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "panoma-secretos-"));
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "t"]);
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

function plant(name: string, body: string): void {
  const file = join(repo, name);
  mkdirSync(join(repo, "."), { recursive: true });
  writeFileSync(file, body, "utf8");
  execFileSync("git", ["-C", repo, "add", name]);
}

async function labelsFor(name: string): Promise<string[]> {
  const report = await findSecrets(repo);
  return report.findings.filter((finding) => finding.file === name).map((f) => f.label);
}

/** Plausible base64 material, without being anyone's real key. */
function material(chars: number): string {
  return "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ".repeat(40).slice(0, chars);
}

function pem(body: string, kind = ""): string {
  return `-----BEGIN ${kind}PRIVATE KEY-----\n${body}\n-----END ${kind}PRIVATE KEY-----`;
}

describe("findSecrets: claves privadas dentro de otro fichero", () => {
  it("denuncia una clave moderna aunque su material sea corto", async () => {
    // Measured with openssl: an Ed25519 in PKCS#8 is 64 base64 characters. The 200 cutoff of the
    // first version let it pass completely, and with it the AuthKey `.p8` from App Store Connect
    // (EC P-256, 184) and the JWT signing keys.
    plant("config.ts", `export const SIGNING_KEY = \`${pem(material(64))}\`;\n`);

    expect(await labelsFor("config.ts")).toContain("Clave privada");
  });

  it("denuncia una clave EC pegada en el código", async () => {
    plant("apple.ts", `export const APPLE_KEY = \`${pem(material(164), "EC ")}\`;\n`);

    expect(await labelsFor("apple.ts")).toContain("Clave privada");
  });

  it("denuncia un bloque de OpenPGP, que lleva BLOCK en la armadura", async () => {
    // `-----BEGIN PGP PRIVATE KEY BLOCK-----` (RFC 4880 §6.2). Without the word `BLOCK` in the
    // pattern, the alternative `PGP ` was dead code: there is no armor that simply says "PGP
    // PRIVATE KEY".
    const block = `-----BEGIN PGP PRIVATE KEY BLOCK-----\n${material(300)}\n-----END PGP PRIVATE KEY BLOCK-----`;
    plant("llavero.txt", block);

    expect(await labelsFor("llavero.txt")).toContain("Clave privada");
  });

  it("sigue callándose ante el ejemplo recortado de un README", async () => {
    // The false positive that size-based filtering protected: the header from PKCS#8 is the same in
    // all RSA keys, so documenting the environment variable matched the pattern. What distinguishes
    // it from a key is not the size: it is that it does not close.
    plant(
      "README.md",
      ["Pon la clave en una sola línea:", "", "```", `PRIVATE_KEY="-----BEGIN PRIVATE KEY-----${material(36)}..."`, "```"].join("\n"),
    );

    expect(await labelsFor("README.md")).not.toContain("Clave privada");
  });

  it("sigue callándose ante el código que quita la cabecera", async () => {
    // Twenty-one false positives on the author's disc had this exact shape.
    plant("limpia.ts", `const body = raw.replace('-----BEGIN PRIVATE KEY-----', '');\n`);

    expect(await labelsFor("limpia.ts")).not.toContain("Clave privada");
  });

  it("denuncia una RSA tan larga que su cierre no cabe en la ventana de contexto", async () => {
    // The window is 2,400 characters. A 4,096-bit RSA does not fit entirely, so the absence of
    // closure there proves nothing and the size cutoff must still apply.
    plant("legacy.ts", `export const LEGACY = \`${pem(material(3200))}\`;\n`);

    expect(await labelsFor("legacy.ts")).toContain("Clave privada");
  });
});
