import { describe, expect, it } from "vitest";
import { REDACTED, pointsElsewhere, checkBaseUrl, redact } from "./safety";
import { findProvider } from "./providers";

const OPENAI = findProvider("openai")!;
const LOCAL = findProvider("local")!;

/**
 * The two ways for a credential to slip out without anyone noticing: sending it to the wrong place
 * and writing it in a message. Neither leaves a trace if it is not tested.
 */

describe("a dónde se puede mandar una credencial", () => {
  it("la dirección propia del proveedor vale", () => {
    expect(checkBaseUrl(OPENAI, "https://api.openai.com/v1")).toBe("https://api.openai.com/v1");
  });

  it("una pasarela ajena por https también: cambiar de sitio es legítimo", () => {
    // Half of the point of `baseUrlEnvVar` is to target LiteLLM or its own gateway. What is being
    // checked is not where it goes, but how it goes.
    expect(checkBaseUrl(OPENAI, "https://pasarela.miempresa.com/v1")).toBeTruthy();
  });

  it("en claro contra tu propia máquina, sí", () => {
    // There is no network to spy on between the process and the model running alongside it.
    expect(checkBaseUrl(LOCAL, "http://127.0.0.1:11434/v1")).toBeTruthy();
    expect(checkBaseUrl(LOCAL, "http://localhost:1234/v1")).toBeTruthy();
    expect(checkBaseUrl(LOCAL, "http://[::1]:8080/v1")).toBeTruthy();
  });

  it("en claro fuera de la máquina, NO", () => {
    // The hole that almost no one out there documents closed: a `OPENAI_BASE_URL` set to a foreign
    // http sends the key over the network in plain sight of anyone.
    expect(() => checkBaseUrl(OPENAI, "http://sitio-ajeno.example/v1")).toThrow(/sin cifrar/);
    expect(() => checkBaseUrl(OPENAI, "http://10.0.0.9:8080/v1")).toThrow(/sin cifrar/);
  });

  it("con usuario y contraseña dentro de la URL, tampoco", () => {
    expect(() => checkBaseUrl(OPENAI, "https://quien:sea@pasarela.example/v1")).toThrow(
      /usuario o contraseña/,
    );
  });

  it("ni con un esquema que no es web", () => {
    expect(() => checkBaseUrl(OPENAI, "file:///etc/passwd")).toThrow(/http o https/);
    expect(() => checkBaseUrl(OPENAI, "no-es-una-url")).toThrow(/no es una URL/);
  });

  it("sabe decir cuándo se apunta a otro sitio, sin cortar", () => {
    expect(pointsElsewhere(OPENAI, "https://api.openai.com/v1")).toBe(false);
    expect(pointsElsewhere(OPENAI, "https://pasarela.miempresa.com/v1")).toBe(true);
    expect(pointsElsewhere(OPENAI, undefined)).toBe(false);
  });
});

describe("tachar credenciales de los mensajes", () => {
  it("tacha la credencial que se está usando ahora mismo, tenga la forma que tenga", () => {
    // The strongest defense: it does not depend on recognizing any shape.
    const message = redact("falló con la clave miclaverarita123", ["miclaverarita123"]);
    expect(message).toBe(`falló con la clave ${REDACTED}`);
  });

  it("tacha las formas conocidas aunque no sepamos que estaban", () => {
    const testCases = [
      "invalid api key: sk-proj-AbCdEf123456789",
      "Bearer eyJhbGciOiJIUzI1NiJ9.cuerpoDelTokenQueEsLargo.firma",
      "usa AIzaSyD-1234567890abcdefg",
      "token ghp_1234567890abcdefghij",
    ];
    for (const testCase of testCases) {
      expect(redact(testCase), testCase).toContain(REDACTED);
      expect(redact(testCase), testCase).not.toMatch(/sk-proj-AbCdEf|ghp_1234|AIzaSyD-1234/);
    }
  });

  it("la red genérica pilla cualquier tirada larga", () => {
    const largo = "Q".repeat(48);
    expect(redact(`respondió 401: ${largo}`)).toBe(`respondió 401: ${REDACTED}`);
  });

  it("pero no destroza un mensaje normal", () => {
    // A crossed-out error that is extra stops serving the purpose for which it was taught. Model
    // names, paths, and phrases have to survive intact.
    const message =
      "ChatGPT (Codex) respondió 400: The 'gpt-5.1-codex' model is not supported when " +
      "using Codex with a ChatGPT account.";
    expect(redact(message)).toBe(message);
    expect(redact("no encontré accounts/fireworks/models/kimi-k2-instruct")).toContain("kimi-k2");
  });

  it("un secreto ridículamente corto no se usa para tachar media frase", () => {
    // With `known: ["ab"]` and naive strikethrough, any word with 'ab' would be broken.
    expect(redact("no se pudo abrir la tabla", ["ab"])).toBe("no se pudo abrir la tabla");
  });
});
