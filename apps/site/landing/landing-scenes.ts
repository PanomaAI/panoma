/*
  The signature of the foot: the name, formed by the same points as the crease.
  It does not adopt any other shape — it rises once and stays. It is the site's signature, and a
  signature that transforms into things is not a signature. The only thing that changes from above
  is the color: here each dot carries its own, because the foot is the place where the product has
  already explained itself and can be celebrated.
  Below goes the name alone, without the letter. Above, the swarm already shows the mark —the
  shape of the P and returns to it every two sentences—, so repeating it at the closure does not
  add recognition: it distributes it. And a signature is a signature because it is read, not
  because it has the logo attached. The space that the set occupied is taken entirely by the word.
 */

/** The letter inside the viewBox 0 0 1024 1024, measured with getBBox on the served SVG. */
const BOX = { x: 280.5, y: 222.1, w: 519.9, h: 585.3 };

export function paintSignature(
  ctx: CanvasRenderingContext2D,
  size: number,
  family: string,
  width: number,
): void {
  /*
    The measure on which everything hangs is still the height that the letter would have, even if
    it is no longer drawn: it is the one that the foot block negotiates with the window, and the
    one that made the signature grow and shrink with the screen without getting displaced. Taking
    the body of the name out of there leaves it tied to the same thing as before.
   */
  const markH = size;
  const markW = BOX.w * (markH / BOX.h);
  const gap = markH * 0.24;

  /*
    The name is really measured before composing: written by eye, the whole becomes unbalanced as
    soon as the typography loads and changes width.
   */
  const fontSize = markH * 0.62;
  ctx.font = `800 ${fontSize}px ${family}, system-ui, sans-serif`;
  ctx.textBaseline = "alphabetic";
  const nameW = ctx.measureText("panoma").width;

  /*
    How much the word grows when left alone: until it occupies the space that the entire signature
    —letter, air, and name— used to occupy, which is how a place is inherited without changing the
    composition of the line. Alone and next to the body that was beside the P, it remained a
    whisper in the middle of the block.
    With a ceiling: on a narrow screen that gap doesn't fit —the text was measured against the
    height of the stage and the name against the width, and below about six hundred pixels the
    whole needed more width than there is—, so the width of the block dictates.
   */
  const want = Math.min(markW + gap + nameW, width * 0.84);
  ctx.font = `800 ${fontSize * (want / nameW)}px ${family}, system-ui, sans-serif`;

  /*
    Centered by its ink, not by its box. Without the letter next to it, there is nothing to align
    with, so what has to fall in the middle of the stage is what is seen —and the typographic box
    is not what is seen: on the top and bottom it has the bands that leave space for accents and
    tails, and on the sides the air of the sides of the p and the a. Centering by the box, the
    word ended up three pixels to the right.
   */
  const ink = ctx.measureText("panoma");
  ctx.fillText(
    "panoma",
    (ink.actualBoundingBoxLeft - ink.actualBoundingBoxRight) / 2,
    (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2,
  );
}
