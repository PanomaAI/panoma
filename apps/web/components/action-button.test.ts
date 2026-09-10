import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "@/lib/source-files";

/**
 * The button that turns off while working is rendered with `ActionButton`, and not by hand.
 *
 * There were forty buttons with `disabled` tied to the work state and a label that alternates
 * between "saving" and "save," spread across twenty-six files and written with twenty-nine
 * different class strings. Of those twenty-nine, only four were repeated, and they covered
 * fourteen buttons: those four were the first tones of the primitive, and this test was born
 * pinning them letter by letter.
 *
 * ── What changed on 8-Sep-2026, and why this file had to change with it ────────────────────
 *
 * The primitive now splits what those four chains ran together. A chain like
 * `rounded border border-edge bg-raised px-3 py-1.5 font-mono text-[11px] …` says two things at
 * once — a colour and a box — and `primitives.tsx` explains at length why keeping them fused cost
 * twelve hand-written near-clones. So a recipe is composed today from four pieces: the control
 * base, the family base, the tone, and the size.
 *
 * That leaves this test with a trap of its own, and it is worth naming because it is the reason
 * the assertions below are shaped the way they are. The twelve files listed further down hold
 * strings that are DELIBERATELY near-identical to the four. The moment one of them is tidied — a
 * `disabled:opacity-40` brought to 50, a `text-[10px]` brought onto the scale — the near-clone
 * becomes an exact clone, and a guard that only forbids the string would go red for doing exactly
 * the right thing. It would also be red at the wrong address: the file it names would be the one
 * that just got better.
 *
 * So the rule is: the string is forbidden in the MARKUP and allowed in the primitive. Anything
 * that arrives at one of these chains has one correct destination — `<ActionButton>` — and if a
 * component ends up holding the chain whole it is by definition writing the primitive out by
 * hand, whether it got there by copying or by converging.
 *
 * The ENTIRE class is targeted, with its `className="` in front, and not a substring. That too is
 * deliberate, because the near-misses still exist for a reason:
 *
 * - `self-start` in front of the `plain` tone in `twin-distill.tsx` and `twin-synthesize.tsx`, and
 * `mt-auto self-start` in `twin-look.tsx`: it is placement inside a flex column.
 * - the ternary of `twin-sources.tsx`, which alternates `plain` and `accent` according to the
 * state of the row: there is not one string, there are two.
 * - `md-apply.tsx` and `md-review.tsx`, which are preceded by `inline-flex items-center gap-2`
 * because they have an icon inside.
 * - those that only resemble each other, and resemble each other on purpose: `ai-panel.tsx`
 * repeats the tone in `text-[10px]`, in `text-faint`, and with `disabled:opacity-40`;
 * `run-button.tsx` tightens it to `px-2 py-0.5`; `assignments.tsx`, `project-accounts.tsx`, and
 * `md-repair.tsx` use the accent in `text-[11px]`; `today.tsx` is not `font-mono`. Twelve of the
 * sixteen differ by SIZE alone, which is the axis the primitive grew for them.
 * - the red eraser of `disconnect-agent.tsx`, and those who dress with class from the sheet:
 * `open-menu.tsx`, `project-action-bar.tsx`, `describe.tsx`, `project-actions.tsx`,
 * `hidden-actions.tsx`, `sites.tsx`, `code-search.tsx`, `open-folder.tsx`.
 *
 * It reads as text because vitest does not transform `.tsx` on purpose. Same pattern as
 * `action-error.test.ts`.
 */
const AQUI = new URL(".", import.meta.url);

/** The one file allowed to hold any of these strings: the primitive itself. */
const LA_PRIMITIVA = "primitives.tsx";

/**
 * The four chains as they were written until 8-Sep-2026, letter by letter.
 *
 * They are kept after the split for the same reason a demolished wall is kept on the plan: these
 * exact strings are what the twenty-six files copied, and a copy that survived the migration —or
 * one pasted tomorrow from an old branch— still says everything the primitive says, only worse.
 */
const RECETAS_HEREDADAS: Record<string, string> = {
  raised:
    "rounded border border-edge bg-raised px-3 py-1.5 font-mono text-[11px] text-smoke transition-colors hover:border-accent hover:text-accent disabled:opacity-50",
  surface:
    "rounded border border-edge bg-surface px-3 py-1.5 font-mono text-xs text-smoke transition-colors hover:border-accent hover:text-accent disabled:opacity-50",
  plain:
    "rounded border border-edge px-2.5 py-1 font-mono text-xs text-smoke transition-colors hover:border-chalk disabled:opacity-50",
  accent:
    "rounded border border-accent bg-accent px-3 py-1.5 font-mono text-xs text-white transition-opacity hover:opacity-85 disabled:opacity-50",
};

/**
 * The pieces the primitive composes today, letter by letter, just as `primitives.tsx` fixes them.
 *
 * `BASE_DE_CONTROL` is shared with the field family: one box, one disabled treatment, one
 * duration read from `--duration-fast` instead of restated as a number.
 */
const BASE_DE_CONTROL =
  "rounded border transition duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
const BASE_DE_BOTON = "inline-flex items-center justify-center gap-1.5 font-mono";

/** Six tones, which is what `docs/theme.md` counts. Colour alone: border, fill, ink, hover. */
const TONOS: Record<string, string> = {
  raised: "border-edge bg-raised text-smoke hover:border-accent hover:text-accent",
  surface: "border-edge bg-surface text-smoke hover:border-accent hover:text-accent",
  plain: "border-edge text-smoke hover:border-chalk",
  accent: "border-accent bg-accent text-white hover:opacity-85",
  danger: "border-fail text-fail hover:bg-fail hover:text-white",
  quiet: "border-transparent text-faint hover:text-smoke",
};

/** Three sizes. The box alone: a height, a padding, a type step. */
const TAMANOS: Record<string, string> = {
  sm: "min-h-[26px] px-2.5 py-1 text-[11px]",
  md: "min-h-[30px] px-3 py-1.5 text-xs",
  lg: "min-h-[34px] px-4 py-1.5 text-sm",
};

/** And the field ladder, which walks the same four heights one step up. */
const TAMANOS_DE_CAMPO: Record<string, string> = {
  sm: "min-h-[30px] px-2.5 py-1.5 text-xs",
  md: "min-h-[34px] px-3 py-1.5 text-sm",
  lg: "min-h-[38px] px-3.5 py-2 text-sm",
};

/**
 * The four control heights, and the whole point of this list is that it is CLOSED.
 *
 * The sheets declare ten; the markup declared none, which is why 53 buttons were as tall as their
 * padding plus a line box and the smallest measured about 19px. Four is the number
 * `docs/theme.md` settles on, and a fifth appearing in this file is the failure this pins: it
 * would mean a control that answers "how tall is a control here" for the eleventh time.
 */
const ALTURAS_DE_CONTROL = ["min-h-[26px]", "min-h-[30px]", "min-h-[34px]", "min-h-[38px]"];

/** The composed recipe, in the same order the primitive composes it. */
const receta = (tono: string, tamano: string) =>
  `${BASE_DE_CONTROL} ${BASE_DE_BOTON} ${TONOS[tono]} ${TAMANOS[tamano]}`;

describe("el botón que se apaga mientras trabaja", () => {
  /* Enter the subdirectories: see `lib/source-files.ts`. */
  const ficheros = sourceFiles(AQUI, [".tsx"]);
  const marcado = ficheros.filter((file) => file !== LA_PRIMITIVA);
  const fuente = (file: string) => readFileSync(new URL(file, AQUI), "utf8");

  /* The floor is the same one `lib/source-files.ts` explains: a sweep that stops seeing is
     indistinguishable from a sweep that approves. */
  it("la barredera ve el árbol entero", () => {
    expect(ficheros.length).toBeGreaterThan(50);
    expect(ficheros).toContain(LA_PRIMITIVA);
  });

  for (const [tono, clase] of Object.entries(RECETAS_HEREDADAS)) {
    it(`nadie escribe a mano la receta heredada del tono ${tono}`, () => {
      // With the `className="` in front and the quote behind: `self-start rounded …` is another
      // string, and the ternary of `twin-sources.tsx` does not have a quote attached to the equals
      // sign.
      const aMano = `className="${clase}"`;
      const culpables = marcado.filter((file) => fuente(file).includes(aMano));
      expect(
        culpables,
        `usa <ActionButton tone="${tono}"> de ./primitives en: ${culpables.join(", ")}`,
      ).toEqual([]);
    });
  }

  /*
    And the same thing said about the recipe the primitive composes TODAY, which is the copy a
    future reader would make: the four above are a copy of what the primitive used to render, and
    these eighteen are a copy of what it renders now.
   */
  it("ni la receta que compone hoy la primitiva, en ninguna de sus dieciocho formas", () => {
    const culpables: string[] = [];
    for (const tono of Object.keys(TONOS)) {
      for (const tamano of Object.keys(TAMANOS)) {
        const aMano = `className="${receta(tono, tamano)}"`;
        for (const file of marcado) {
          if (fuente(file).includes(aMano)) culpables.push(`${file}: ${tono}/${tamano}`);
        }
      }
    }
    expect(
      culpables,
      `escribe a mano lo que <ActionButton tone size> ya compone:\n${culpables.join("\n")}`,
    ).toEqual([]);
  });

  it("la primitiva fija las piezas, y se apaga y lo dice", () => {
    const source = fuente(LA_PRIMITIVA);
    const desde = source.indexOf("const ACTION_BUTTON_TONE");
    expect(desde, "ACTION_BUTTON_TONE desapareció de primitives.tsx").toBeGreaterThan(-1);
    expect(source).toContain(BASE_DE_CONTROL);
    for (const clase of Object.values(TONOS)) expect(source).toContain(clase);
    for (const clase of Object.values(TAMANOS)) expect(source).toContain(clase);
    expect(source).toContain(BASE_DE_BOTON);
    const cuerpo = source.slice(desde);
    expect(cuerpo).toContain("export function ActionButton");
    // Shutting down while working is half; saying that you work is the other.
    expect(cuerpo).toContain("const off = disabled ?? busy;");
    expect(cuerpo).toContain("{ disabled: off }");
    expect(cuerpo).toContain("busy && busyLabel !== undefined ? busyLabel : children");
    // And the size axis exists, which is the axis twelve of the sixteen near-clones differ by.
    expect(cuerpo).toContain("const ACTION_BUTTON_SIZE");
    expect(cuerpo).toContain('size = "md"');
  });

  /*
    An off button is `aria-disabled` instead of `disabled` ONLY where the type is explicitly
    `"button"`, and this is the assertion that exception rests on.

    The reason for the exception: the browser blurs a truly disabled control, so every async
    gesture threw the keyboard to `<body>` — thirty-five tab stops from where it was pressed on
    `/twin`. The reason for its limit: a `<button>` with no type IS a submit button, and one that
    is only `aria-disabled` still answers a form's implicit submission, so Enter in a text field
    would send it a second time. Of the ninety-three in this tree, eleven say `submit` and ten say
    nothing; those twenty-one must keep the real attribute. A lost caret is a nuisance; a second
    POST is a duplicated record.
   */
  it("solo un type=\"button\" explícito se apaga en blando, y nunca un submit", () => {
    const cuerpo = fuente(LA_PRIMITIVA);
    expect(cuerpo).toContain('rest.type === "button"');
    /* The guard that replaces what `disabled` was doing; without it the press would go through. */
    expect(cuerpo).toContain('"aria-disabled": true');
    expect(cuerpo).toContain("event.preventDefault()");
    /* And the greying follows the soft form too, or an off button would look pressable. */
    expect(cuerpo).toContain("aria-disabled:opacity-50");
  });

  /*
    The heights, which are the reason this step exists at all. Every variant declares one, they
    are the same four for the buttons and the fields, and there is no fifth.
   */
  it("cada variante declara una altura, y las alturas son cuatro", () => {
    const source = fuente(LA_PRIMITIVA);
    for (const [nombre, clase] of [
      ...Object.entries(TAMANOS),
      ...Object.entries(TAMANOS_DE_CAMPO),
    ]) {
      const altura = ALTURAS_DE_CONTROL.find((alto) => clase.startsWith(alto));
      expect(altura, `el tamaño ${nombre} no abre con una de las cuatro alturas: ${clase}`).toBeDefined();
      expect(source, `primitives.tsx ya no declara el tamaño ${nombre}`).toContain(clase);
    }
    const escritas = [...new Set([...source.matchAll(/min-h-\[[^\]]+\]/g)].map((m) => m[0]))].sort();
    expect(
      escritas,
      "una quinta altura de control: las diez de la hoja se reducían a cuatro, no a cinco",
    ).toEqual([...ALTURAS_DE_CONTROL].sort());
  });

  /*
    Seven disabled opacities and three durations were what the tree had. One of each is what this
    file may hold, and the duration is read from the token so that the value keeps living in
    `tokens.css` and not here.
   */
  it("una sola manera de apagarse y una sola duración", () => {
    const source = fuente(LA_PRIMITIVA);
    const apagadas = [...new Set([...source.matchAll(/disabled:opacity-[\w.[\]]+/g)].map((m) => m[0]))];
    expect(apagadas, "más de una opacidad de apagado en la primitiva").toEqual(["disabled:opacity-50"]);
    const duraciones = [...new Set([...source.matchAll(/duration-\[[^\]]+\]/g)].map((m) => m[0]))];
    expect(duraciones, "más de una duración en la primitiva").toEqual(["duration-[var(--duration-fast)]"]);
    expect(
      source.match(/transition-(?:colors|opacity|all)\b/g),
      "una transición por propiedades: la primitiva anima con `transition` y la duración del token",
    ).toBeNull();
  });

  /* And that someone actually uses it: a primitive without callers is dead code with a test. */
  it("y la usan los componentes, que es de donde salió", () => {
    const llamantes = marcado.filter((file) => fuente(file).includes("<ActionButton"));
    /*
      A ratchet, like the scale in `app/styles/styles.test.ts`: the floor is today's real count —
      eighteen components on 8-Sep-2026, up from the nine this test was written with — and it only
      goes up. A conversion that lands raises it; a conversion undone by accident turns it red.
     */
    expect(llamantes.length, "nadie usa ActionButton").toBeGreaterThan(17);
  });
});
