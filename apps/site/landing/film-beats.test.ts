import { describe, expect, it } from "vitest";
import {
  FILM_BEATS,
  FILM_DURATION,
  FILM_TYPING,
  filmBeatAt,
  filmBeatProgress,
  filmTypedChars,
  filmTypingOn,
} from "./film-beats";
import { LANDING_COPY } from "./landing-copy";

/**
 * The video clock. What is tested here is what decides which sentence is read while it runs: if
 * the section is wrong, the reader sees the catalog with the folder footer.
 */
describe("los tramos del vídeo", () => {
  it("empieza en el primero y termina en el último", () => {
    expect(filmBeatAt(0)).toBe(0);
    expect(filmBeatAt(FILM_DURATION)).toBe(FILM_BEATS.length - 1);
  });

  it("cambia de tramo justo en su segundo, no antes", () => {
    FILM_BEATS.forEach((start, index) => {
      expect(filmBeatAt(start)).toBe(index);
      if (index > 0) expect(filmBeatAt(start - 0.001)).toBe(index - 1);
    });
  });

  /*
    A video that has not yet loaded gives `currentTime` 0, and a poorly cropped progress bar
    painted it as if it were negative.
   */
  it("aguanta instantes fuera del vídeo", () => {
    expect(filmBeatAt(-3)).toBe(0);
    expect(filmBeatAt(9999)).toBe(FILM_BEATS.length - 1);
    expect(filmBeatProgress(-3, 0)).toBe(0);
    expect(filmBeatProgress(9999, 0)).toBe(1);
    expect(filmBeatProgress(0, 99)).toBe(0);
  });

  it("el avance de cada tramo va de 0 a 1 y no se sale", () => {
    FILM_BEATS.forEach((start, index) => {
      const end = FILM_BEATS[index + 1] ?? FILM_DURATION;
      expect(filmBeatProgress(start, index)).toBe(0);
      expect(filmBeatProgress(end, index)).toBe(1);
      expect(filmBeatProgress((start + end) / 2, index)).toBeCloseTo(0.5, 5);
      /* The sections already passed remain full: the bar does not empty as you move forward. */
      if (index > 0) expect(filmBeatProgress(start, index - 1)).toBe(1);
    });
  });

  /*
    The clock and the sentences live in different files on purpose—one is the video and the other
    the language—so someone has to watch to make sure they keep saying the same thing.
   */
  it("hay una frase por tramo en los dos idiomas", () => {
    for (const copy of Object.values(LANDING_COPY)) {
      expect(copy.film.beats).toHaveLength(FILM_BEATS.length);
    }
  });
});

/**
 * The command that is typed in the terminal on the laptop screen. What is being tested is the only
 * thing that can ruin it: that it comes out of the slot in which the screen is blank.
 */
describe("el comando escrito en la pantalla", () => {
  const LARGO = "npx panoma up ~/Desktop".length;

  /*
    The gap measured over the frames: the screen is clear at second 2.00 and the mark starts to
    draw at 4.30 —which is precisely where the third section begins—. If someone moves these
    numbers without measuring again, the command ends up written on top of the mark, and that in a
    screenshot is not seen until it is already published.
   */
  it("cabe entero dentro de la pantalla en blanco", () => {
    expect(FILM_TYPING.from).toBeGreaterThanOrEqual(2);
    expect(FILM_TYPING.until).toBeLessThanOrEqual(FILM_BEATS[2]!);
    expect(FILM_TYPING.start).toBeGreaterThanOrEqual(FILM_TYPING.from);
    expect(FILM_TYPING.done).toBeLessThan(FILM_TYPING.until);
  });

  it("solo se ve dentro de su ventana", () => {
    expect(filmTypingOn(0)).toBe(false);
    expect(filmTypingOn(FILM_TYPING.from - 0.01)).toBe(false);
    expect(filmTypingOn(FILM_TYPING.from)).toBe(true);
    expect(filmTypingOn(3)).toBe(true);
    expect(filmTypingOn(FILM_TYPING.until)).toBe(false);
    expect(filmTypingOn(FILM_BEATS[2]!)).toBe(false);
    expect(filmTypingOn(FILM_DURATION)).toBe(false);
  });

  it("se teclea entero y no se pasa", () => {
    expect(filmTypedChars(0, LARGO)).toBe(0);
    expect(filmTypedChars(FILM_TYPING.start, LARGO)).toBe(0);
    expect(filmTypedChars(FILM_TYPING.done, LARGO)).toBe(LARGO);
    expect(filmTypedChars(9, LARGO)).toBe(LARGO);
    /*
      Halfway, half command — with a margin character, because the midpoint of two tenths doesn't
      fall exactly in binary, and asking for the precise number is asking the floating point for
      something it cannot give.
     */
    const medio = filmTypedChars((FILM_TYPING.start + FILM_TYPING.done) / 2, LARGO);
    expect(medio).toBeGreaterThanOrEqual(Math.floor(LARGO / 2));
    expect(medio).toBeLessThanOrEqual(Math.ceil(LARGO / 2));
  });

  it("nunca borra lo que ya escribió", () => {
    let previo = 0;
    for (let s = FILM_TYPING.from; s <= FILM_TYPING.until; s += 0.02) {
      const ahora = filmTypedChars(s, LARGO);
      expect(ahora).toBeGreaterThanOrEqual(previo);
      expect(ahora).toBeLessThanOrEqual(LARGO);
      previo = ahora;
    }
    expect(previo).toBe(LARGO);
  });
});
