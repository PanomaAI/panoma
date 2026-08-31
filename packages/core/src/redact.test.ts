import { describe, expect, it } from "vitest";
import { REDACTED, redactSecrets } from "./redact";

/**
 * The contract is double and both halves weigh the same: a key with a known shape does not pass,
 * and normal technical prose passes intact — a wording that bites shas or URLs would end up
 * disabled, which is worse than not having it.
 */

const PEM_MATERIAL = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ";

describe("lo que parece una llave no entra", () => {
  it("tapa las formas de los proveedores, estén donde estén", () => {
    const cases = [
      `falló con sk-ant-api03-${"a".repeat(40)} en la cabecera`,
      `export OPENAI_KEY=sk-${"b".repeat(40)}`,
      `stripe dice sk_live_${"c".repeat(24)}`,
      `el token ghp_${"C".repeat(36)} caducó`,
      `el fino github_pat_${"d".repeat(22)}_${"e".repeat(20)} se revocó`,
      "la cuenta AKIAIOSFODNN7EXAMPLE no existe",
      "avisa por xoxb-123456789012-abcdefghijkl",
      `maps con AIza${"f".repeat(35)}`,
      `npm_${"g".repeat(36)} en el .npmrc`,
      `el JWT eyJ${"h".repeat(20)}.eyJ${"i".repeat(20)}.${"j".repeat(20)} venció`,
    ];
    for (const text of cases) {
      const out = redactSecrets(text);
      expect(out, text).toContain(REDACTED);
      expect(out, "la prosa alrededor sobrevive").not.toBe(REDACTED);
    }
  });

  it("una clave privada PEM cae entera, aunque el pegote venga cortado", () => {
    const whole = `-----BEGIN RSA PRIVATE KEY-----\n${PEM_MATERIAL}\n-----END RSA PRIVATE KEY-----`;
    expect(redactSecrets(`antes\n${whole}\ndespués`)).toBe(`antes\n${REDACTED}\ndespués`);
    // Cut: without closure, you eat until the end, which is the safe side of making a mistake.
    expect(redactSecrets(`log: -----BEGIN PRIVATE KEY-----\n${PEM_MATERIAL}`)).toBe(`log: ${REDACTED}`);
  });

  it("es idempotente: tapar lo tapado no cambia nada", () => {
    const once = redactSecrets(`token sk-ant-${"k".repeat(30)}`);
    expect(redactSecrets(once)).toBe(once);
  });
});

describe("la prosa técnica normal pasa intacta", () => {
  it("ni shas, ni rutas, ni palabras que empiezan parecido", () => {
    const innocents = [
      "el commit b9fbd06e3a1f4c72 arregla el WAL",
      "usa ops/migrar-base-pglite5.mjs para el rescate",
      "skeleton loader en apps/web/components",
      "la tarea sk-review quedó abierta", // short: does not reach the size of a key
      "ghp_corto no es un token",
      "AKIA a secas tampoco",
    ];
    for (const text of innocents) {
      expect(redactSecrets(text), text).toBe(text);
    }
  });

  it("el código que QUITA una cabecera PEM no es una clave — la lección del escáner", () => {
    const code = `const body = raw.replace('-----BEGIN PRIVATE KEY-----', '');`;
    expect(redactSecrets(code)).toBe(code);
  });
});
