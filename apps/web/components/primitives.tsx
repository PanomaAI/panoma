import type {
  ButtonHTMLAttributes,
  MouseEvent,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import type { ProjectState } from "@panoma/db";
import { HiOutlineCodeBracketSquare } from "react-icons/hi2";
import { t, type Locale } from "@/lib/i18n";

export const STATE_STYLE: Record<ProjectState, { label: string; dot: string; text: string }> = {
  active: { label: "activo", dot: "bg-live", text: "text-live" },
  paused: { label: "en pausa", dot: "bg-idle", text: "text-idle" },
  dormant: { label: "dormido", dot: "bg-dormant", text: "text-dormant" },
  "no-git": { label: "sin git", dot: "bg-nogit", text: "text-faint" },
};

/**
 * The status point, with its word if requested.
 *
 * `locale` is optional and by default Spanish, the same pattern as `relativeDate` and
 * `RunStatusTag`: pages that are not yet translated —space, copies— continue to display exactly
 * what they displayed before, and those that are translated convey their language. The `label` in
 * the table remains as a backup for those who do not provide it.
 */
export function StateDot({
  state,
  withLabel = false,
  locale,
}: {
  state: ProjectState;
  withLabel?: boolean;
  locale: Locale;
}) {
  const style = STATE_STYLE[state];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-[6px] w-[6px] rounded-full ${style.dot}`} aria-hidden />
      {withLabel && (
        <span className={`font-mono text-[11px] ${style.text}`}>
          {t(locale, `state.${state}`).toLowerCase()}
        </span>
      )}
    </span>
  );
}

/**
 * Actual app icon when it exists; if not, a monogram with a color derived from the name. The
 * background is deterministic so that the grid does not change appearance between scans.
 *
 * `tone` decides what color that background is. By default, the brand's purple, which is what it
 * had and what all the pages that don't pass still render. The catalog asks for `neutral`: there,
 * most projects don't have their own icon, so the background appeared forty times on the same
 * screen and the purple stopped being an accent to become the background color of the entire
 * catalog.
 */
export function ProjectIcon({
  name,
  src,
  size = 56,
  tone = "brand",
  locale,
}: {
  name: string;
  src: string | null;
  size?: number;
  tone?: "brand" | "neutral";
  locale: Locale;
}) {
  const isPanoma = name.toLowerCase() === "panoma";
  const generatedAsset = name.toLowerCase() === "demo-runner"
    ? "/assets/projects/demo-runner.png"
    : null;
  const resolvedSrc = isPanoma ? "/assets/brand/panoma.svg" : src ?? generatedAsset;

  if (resolvedSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- ruta dinámica o asset local
      <img
        src={resolvedSrc}
        loading="lazy"
        alt={t(locale, "common.iconOf", { name })}
        width={size}
        height={size}
        className="shrink-0 rounded-[22%] border border-edge object-cover shadow-sm"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-[22%] border border-edge ${
        tone === "neutral" ? "project-icon--neutral" : "bg-raised text-accent"
      }`}
      style={{
        width: size,
        height: size,
      }}
    >
      <HiOutlineCodeBracketSquare style={{ width: size * 0.46, height: size * 0.46 }} />
    </span>
  );
}

/**
 * The technology and its version, as a word-pill.
 *
 * It is `Tag` and no longer its own chain: the set of utilities is the one it already had, letter
 * for letter, so nothing moves. What it stops being is a seventh copy of the pill — see the
 * comment above `TAG_TONE` for the six others and their five colour maps.
 *
 * `align="baseline"` is not decoration here: the version sits next to the name at a smaller ink
 * and lining up their baselines is the reason the two read as one word.
 */
export function TechChip({ name, version }: { name: string; version?: string | null }) {
  return (
    <Tag size="md" align="baseline">
      {name}
      {version && <span className="text-faint">{version}</span>}
    </Tag>
  );
}

export function Grade({
  score,
  grade,
  locale,
}: {
  score: number;
  grade: string;
  locale: Locale;
}) {
  const tone =
    grade === "A" || grade === "B" ? "text-live" : grade === "C" ? "text-idle" : "text-smoke";
  return (
    <span className={`font-mono text-xs ${tone}`} title={t(locale, "common.health", { score })}>
      {grade}
      <span className="text-faint">{score}</span>
    </span>
  );
}

/*
  `relativeDate` and `relativeTime` live in `lib/relative-date.ts` and are re-exported here.
  They left in order to be able to test themselves: the tests on this website do not transform
  `.tsx`, so everything that remains in this file is code with no one to defend it. They are
  re-exported because half the application imports them from here and moving the imports adds
  nothing.
 */
export { relativeDate, relativeTime } from "@/lib/relative-date";

/* And for the same reason, the bytes: there were three copies and they no longer said the same thing. */
export { formatBytes } from "@/lib/format-bytes";

/**
 * The red line that says what went wrong.
 *
 * It was handwritten in sixteen places with the SAME font, the same size, and the same red — and
 * with ten different class chains, because the only thing that really varied was the top margin.
 * Ten chains for one thing is what causes that the day someone decides to lower the red, nine get
 * changed and one is forgotten.
 *
 * The margin DOES NOT go in here: it is the only thing that depends on the site, and putting it
 * inside would require a parameter for each value. It comes through `className`, which is what
 * everyone is already doing.
 *
 * `role="alert"` does enter, and it's what most didn’t have: these lines appear AFTER someone
 * presses something, and without the paper, a screen reader announces nothing — the action fails
 * and whoever cannot see the screen is left waiting.
 */
export function ActionError({
  text,
  as = "p",
  className,
}: {
  text: string;
  /** `p` cuts the line, `span` goes inside one. It's what each site was already doing. */
  as?: "p" | "span";
  /** The margin, and only the margin. */
  className?: string;
}) {
  /* `Box` and not `Tag`: `Tag` is the word-pill further down, and shadowing it here would read
     as if this line rendered one. */
  const Box = as;
  return (
    <Box role="alert" className={`font-mono text-[11px] text-fail${className ? ` ${className}` : ""}`}>
      {text}
    </Box>
  );
}

/*
  ══ The controls ═══════════════════════════════════════════════════════════════════════════
  One vocabulary for everything a finger presses or a keyboard types into: a base, a tone, a size.
  Everything below is written as global tokens and nothing else — `docs/theme.md` is the record of
  where the values come from and D1…D13 are the decisions they answer to.

  ── The size axis, which this file refused once ────────────────────────────────────────────
  The comment that stood here said, in so many words, that `tone` "does NOT unify sizes: `raised`
  goes in `text-[11px]` and `surface` in `text-xs` because they are areas of different density,
  and swapping one for the other would move pixels." Both halves of that were true, and the second
  one still is. What it did not say — because at the time nobody had counted — is what the refusal
  cost.

  Counted on 8-Sep-2026 over `components/` and `app/(app)/`: 144 raw `<button>` against 45
  `<ActionButton>`, some 83 distinct visual recipes for one control, and of the sixteen buttons
  that are near-clones of these tones, TWELVE differ from them by size alone — a padding step, a
  type step, or both. With no size axis every one of those twelve had to be written out by hand,
  and every hand-written copy picked its own density. The refusal did not protect the two
  densities. It multiplied them into twelve.

  So the answer to that comment is not "density does not matter". It is that density is a NAMED
  axis now, and any tone can be asked for any of the three: `size="sm"` is the 11px one the dense
  areas wanted, available on every tone instead of on the one tone that happened to be written
  that afternoon. What moves in exchange is that `tone="raised"` at the default size renders
  `text-xs` rather than `text-[11px]` — one pixel of type on the buttons that do not ask for
  `size="sm"`. That pixel is the whole price, it is paid once, and it is written here rather than
  scattered over twelve files.

  ── The four control heights ───────────────────────────────────────────────────────────────
  Not one hand-written button in this tree declares a height. The entire markup holds two `min-h-*`
  utilities and neither is on a button, so 53 buttons are as tall as their padding plus a line box
  and the smallest measures about 19px. The sheets, meanwhile, declare ten control heights.

  Four survive, as a 4px ladder that both families walk:

                26px      30px      34px      38px
      button     sm        md        lg         ·
      field       ·        sm        md        lg

  A button sits one step below a field of the same name, which is what this application already
  does: its buttons measure 26 to 34 in the sheets (`.catalog-empty button` is 34, `.open-handle`
  30) and its fields 32 to 38 (`.confirm-dialog input` is 38, `.open-all-row input` 32). Every one
  of the four is attested in `app/styles/`; none is invented here.

  It is `min-height` and not `height`, and that is what makes it safe to add everywhere at once: a
  minimum can only GROW a box. On a control that already measured right it changes nothing; on the
  19px one it is the fix. The four want to be a `--control-*` group in `tokens.css` next to
  `--space-*`; until that lands, the two size tables below are their only home.

  ── Nine controls that are NOT expressed here, on purpose ──────────────────────────────────
  A tone × size × shape grid is the right answer for the eighty-odd recipes it replaces and the
  wrong answer for these nine. Forcing them in would cost more than the duplication it removes,
  so they stay where they are and this is the list, so that the next reader knows the omission was
  a decision:

  · `.open-handle` — `opacity: 0` at rest, revealed by the row it belongs to. Its visibility is a
    property of its PARENT, and no tone can carry that.
  · `.skip-link` — parked off-screen with `transform` and still focusable; see `base.css`.
  · `.share__backdrop` — a full-viewport `position: fixed` scrim that happens to be a `<button>`.
    It has no height, no tone and no label; it is a click target the size of the window.
  · `.model-picker__toggle` — an affix INSIDE a field, bordered on one side only and inset by the
    field's own border width. It is part of another control, not a control.
  · the inline button of `not-found-view.tsx` — rendered outside every stylesheet, which is
    exactly why it is written by hand.
  · `.mobile-more` — a dock item below 760px; its geometry is the dock's, not this ladder's.
  · the status-toned button of `run-button.tsx` — its border and ink follow the run's state, so
    its tone is data and not a choice.
  · the two two-line link cards — a title over a description: a card that is a link, not a button.
  · the split `.open-menu` / `.open-all` pair — one control with two halves and a shared border
    between them, whose radius is split per corner.

  ── One disabled treatment, one transition ─────────────────────────────────────────────────
  Seven disabled opacities and three durations across the tree. What survives is
  `disabled:opacity-50`, which was already the majority, and `--duration-fast` (120ms), which is
  what the sheets already animate a control's border and ink with — `.catalog-empty button` says
  `transition: border-color var(--duration-fast) ease`. The duration is read from the token rather
  than restated as a number, so the one place it lives stays `tokens.css`.
 */
const CONTROL_BASE =
  "rounded border transition duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/** The three steps of the size axis, for every control in this file. */
export type ControlSize = "sm" | "md" | "lg";

/**
 * The button that turns off while it works.
 *
 * Forty buttons on this website write the same thing by hand: `disabled` tied to the work state
 * and a label that alternates between "saving" and "save." Among those forty, there are
 * twenty-nine different class strings, and only four are repeated: those four were the first
 * tones here, and they covered fourteen buttons.
 *
 * `tone` is now colour ALONE — the border, the fill and the ink, and what each does on hover — and
 * `size` is the box: its height, its padding and its type. Splitting them is what lets `raised`
 * and `surface` be what they always were, the same button on two papers, instead of two recipes
 * that also disagreed about type size for no recorded reason.
 *
 * Six tones, which is the number `docs/theme.md` counts: the four that existed, plus `danger` —
 * the red eraser that `disconnect-agent.tsx` writes by hand, and the one pairing
 * `contrast.test.ts` already measures white against — and `quiet`, the borderless text button
 * written some fifteen times as `text-faint … hover:text-smoke`. `quiet` keeps
 * `border-transparent` rather than dropping the border, so its box measures the same as every
 * other tone's and a row of mixed tones lines up.
 *
 * `busy` decides the label; `disabled` decides if it can be clicked, and by default it takes the
 * value of `busy`. They are separated on purpose: half a dozen places turn off the button for more
 * reasons than just working — the field is empty, nothing to save — and joining them here would
 * change when each one is turned off.
 *
 * ── Why an off button is sometimes `aria-disabled` and not `disabled` ──────────────────────
 *
 * Because the browser blurs a control the moment it becomes truly disabled, and the focus lands on
 * `<body>`. Every asynchronous gesture in this application therefore threw the keyboard back to
 * the top of the document: press «save» on the ninth belief of `/twin`, and when the button comes
 * back you are thirty-five tab stops away from it. `aria-disabled` says the same thing to a screen
 * reader, keeps the control focusable, and the guard below makes the click do nothing — which is
 * all `disabled` was doing.
 *
 * It is used ONLY where `type` is explicitly `"button"`. A `<button>` with no type is a submit
 * button, and a submit button that is merely `aria-disabled` still answers the implicit submission
 * of a form — Enter in any text field would send it a second time. Of the ninety-three buttons in
 * this tree, eleven say `submit` and ten say nothing at all; those twenty-one keep the real
 * attribute, because a lost focus is a nuisance and a double POST is a duplicated record.
 *
 * Margin and placement DO NOT count: they are the only thing that depends on the site. They arrive
 * via `className`, just like in `ActionError`.
 */
const ACTION_BUTTON_BASE = "inline-flex items-center justify-center gap-1.5 font-mono";

const ACTION_BUTTON_TONE = {
  raised: "border-edge bg-raised text-smoke hover:border-accent hover:text-accent",
  surface: "border-edge bg-surface text-smoke hover:border-accent hover:text-accent",
  plain: "border-edge text-smoke hover:border-chalk",
  accent: "border-accent bg-accent text-white hover:opacity-85",
  danger: "border-fail text-fail hover:bg-fail hover:text-white",
  quiet: "border-transparent text-faint hover:text-smoke",
} as const;

const ACTION_BUTTON_SIZE = {
  sm: "min-h-[26px] px-2.5 py-1 text-[11px]",
  md: "min-h-[30px] px-3 py-1.5 text-xs",
  lg: "min-h-[34px] px-4 py-1.5 text-sm",
} as const;

export type ActionButtonTone = keyof typeof ACTION_BUTTON_TONE;

export function ActionButton({
  tone,
  size = "md",
  busy = false,
  busyLabel,
  disabled,
  className,
  children,
  ...rest
}: {
  tone: ActionButtonTone;
  /** The box: 26px, 30px or 34px tall. `md` is the one that was there before it had a name. */
  size?: ControlSize;
  /** While it is true `busyLabel` is rendered, and it is not pressed unless `disabled` says otherwise. */
  busy?: boolean;
  /**
   * What it says while working. Without it, the label does not change: there are buttons that
   * turn off without changing the word.
   */
  busyLabel?: ReactNode;
  /** When you CANNOT press, if it is for something other than working. */
  disabled?: boolean;
  /** The margin and the placement, and that's it. */
  className?: string;
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "disabled" | "children">) {
  const off = disabled ?? busy;
  /* Only an explicit `type="button"` is safe to leave focusable. See the note above. */
  const soft = off && rest.type === "button";
  return (
    <button
      aria-busy={busy || undefined}
      {...rest}
      {...(soft
        ? {
            "aria-disabled": true,
            /*
              The guard that does what `disabled` was doing. It REPLACES the caller's handler —
              this object is spread after `rest`, so the press never reaches it — which makes a
              click while the work is in flight the same no-op it always was. The only difference
              is that the caret stays on the button instead of falling to `<body>`. It also covers
              the keyboard: Enter and Space on a focused button raise a click like any other.
             */
            onClick: (event: MouseEvent<HTMLButtonElement>) => {
              event.preventDefault();
            },
          }
        : { disabled: off })}
      className={`${CONTROL_BASE} ${ACTION_BUTTON_BASE} ${ACTION_BUTTON_TONE[tone]} ${ACTION_BUTTON_SIZE[size]}${className ? ` ${className}` : ""}`}
    >
      {busy && busyLabel !== undefined ? busyLabel : children}
    </button>
  );
}

/**
 * ── The typed-into family: `Field`, `Select`, `TextArea` ───────────────────────────────────
 *
 * Fifteen input recipes, six select recipes and six textarea recipes for six textareas: not one of
 * the three shapes had a second user. What they all agreed on, when they agreed, is what
 * `FIELD_BASE` says — a raised well, a hairline that turns to the accent on focus, and no outline
 * on top of that border because the border IS the focus mark here.
 *
 * The label is not optional, and that is the other half of this primitive. `accessible-names.test`
 * already caught two fields whose only name was the drawing next to them; a control that arrives
 * with its label attached cannot lose it. Whoever wants no visible label passes `hideLabel` and
 * the word stays in the accessibility tree with `sr-only` — hidden from the eye, never from the
 * reader.
 *
 * `invalid` paints the border in `--color-fail` and sets `aria-invalid`, which is what makes it
 * agree with the `ActionError` line underneath instead of merely sitting above it.
 */
const FIELD_BASE =
  "w-full bg-raised text-chalk placeholder:text-faint focus:border-accent focus:outline-none";

const FIELD_SIZE = {
  sm: "min-h-[30px] px-2.5 py-1.5 text-xs",
  md: "min-h-[34px] px-3 py-1.5 text-sm",
  lg: "min-h-[38px] px-3.5 py-2 text-sm",
} as const;

/** The word above the box. `sr-only` when it is not drawn; never absent. */
const FIELD_LABEL = "mb-1 block font-mono text-[11px] text-smoke";

function fieldClass(size: ControlSize, invalid: boolean, extra?: string): string {
  return `${CONTROL_BASE} ${FIELD_BASE} ${invalid ? "border-fail" : "border-edge"} ${FIELD_SIZE[size]}${
    extra ? ` ${extra}` : ""
  }`;
}

export function Field({
  label,
  hideLabel = false,
  size = "md",
  invalid = false,
  className,
  ...rest
}: {
  /** What the box is for. Drawn above it, or hidden with `hideLabel` — but always said. */
  label: ReactNode;
  hideLabel?: boolean;
  size?: ControlSize;
  invalid?: boolean;
  /** The margin and the placement of the whole block, label included. */
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "size">) {
  return (
    <label className={`block${className ? ` ${className}` : ""}`}>
      <span className={hideLabel ? "sr-only" : FIELD_LABEL}>{label}</span>
      <input {...rest} aria-invalid={invalid || undefined} className={fieldClass(size, invalid)} />
    </label>
  );
}

/**
 * The same box with the options inside.
 *
 * The native arrow is kept — no `appearance-none` — because drawing our own means an affix inside
 * the field, which is the one thing this file says it does not do: see `.model-picker__toggle` in
 * the list of nine.
 */
export function Select({
  label,
  hideLabel = false,
  size = "md",
  invalid = false,
  className,
  children,
  ...rest
}: {
  label: ReactNode;
  hideLabel?: boolean;
  size?: ControlSize;
  invalid?: boolean;
  className?: string;
  children?: ReactNode;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "size" | "children">) {
  return (
    <label className={`block${className ? ` ${className}` : ""}`}>
      <span className={hideLabel ? "sr-only" : FIELD_LABEL}>{label}</span>
      <select
        {...rest}
        aria-invalid={invalid || undefined}
        className={fieldClass(size, invalid, "cursor-pointer")}
      >
        {children}
      </select>
    </label>
  );
}

/**
 * And the same box with room for paragraphs.
 *
 * `rows` sets how tall it opens; the control height is its FLOOR, so an emptied textarea never
 * collapses under the field it sits next to. `leading-relaxed` is `--lead-body`, which is what the
 * markup already writes 165 times for running text.
 */
export function TextArea({
  label,
  hideLabel = false,
  size = "md",
  invalid = false,
  rows = 3,
  className,
  ...rest
}: {
  label: ReactNode;
  hideLabel?: boolean;
  size?: ControlSize;
  invalid?: boolean;
  rows?: number;
  className?: string;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "rows">) {
  return (
    <label className={`block${className ? ` ${className}` : ""}`}>
      <span className={hideLabel ? "sr-only" : FIELD_LABEL}>{label}</span>
      <textarea
        {...rest}
        rows={rows}
        aria-invalid={invalid || undefined}
        className={fieldClass(size, invalid, "resize-y leading-relaxed")}
      />
    </label>
  );
}

/**
 * The box you tick, and the words next to it.
 *
 * Five of these are rendered today with no class at all — `apps.tsx` twice, `twin-memory.tsx`,
 * `spend-controls.tsx` twice — which means five browser defaults: the tick is the operating
 * system's blue on macOS, something else on Windows, and the only accent in an application whose
 * accent is black. `accent-accent` is one line and it is the whole fix.
 *
 * The row takes the BUTTON height of its size and not the field's, because what a checkbox lines
 * up with is a button: they are what a form's last row is made of.
 *
 * The label wraps the box, so the words are the name and the whole row is the target. That is why
 * `accessible-names.test` excuses a checkbox from carrying `aria-label`, and it is only true while
 * the two travel together — which here they must.
 */
const CHECK_ROW = {
  sm: "min-h-[26px] gap-2 text-xs",
  md: "min-h-[30px] gap-2 text-sm",
  /*
    44px, and it is the only step in any ladder here that is a hit area rather than a rhythm.
    `apps.tsx` wrote `min-h-11` by hand — one of exactly two `min-h-*` in the whole markup — and
    the first conversion onto this primitive dropped it to 34, which still clears WCAG 2.5.8 AA at
    24px but stops clearing 2.5.5 AAA at 44. A checkbox is aimed at with a finger; the ladder can
    afford one step that is measured in fingers.
   */
  lg: "min-h-11 gap-2.5 text-sm",
} as const;

const CHECK_BOX = { sm: "size-3.5", md: "size-4", lg: "size-[18px]" } as const;

export function Check({
  size = "md",
  disabled,
  className,
  children,
  ...rest
}: {
  size?: ControlSize;
  disabled?: boolean;
  /** The margin and the placement. */
  className?: string;
  /** The words. They are the name of the control, so there is no version without them. */
  children: ReactNode;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "size" | "type" | "children">) {
  return (
    <label
      className={`inline-flex items-center ${CHECK_ROW[size]} ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }${className ? ` ${className}` : ""}`}
    >
      <input
        {...rest}
        type="checkbox"
        disabled={disabled}
        className={`${CHECK_BOX[size]} shrink-0 accent-accent`}
      />
      <span>{children}</span>
    </label>
  );
}

/**
 * ── The surfaces: `Card`, `EmptyState`, `Tag` ──────────────────────────────────────────────
 *
 * A bordered panel is written `rounded-lg border border-edge` 67 times in the markup, plus seven
 * near-variants that differ only in the paper under them or in how much they pad. Those two
 * differences are the two axes here and there is no third.
 *
 * `rounded-lg` is 8px, and it agrees with `--corner` by COINCIDENCE. `docs/theme.md`, D8, records
 * that the coincidence is deliberately not removed: declaring `--radius-lg` to make it explicit
 * would move all 178 surfaces that read Tailwind's own name for it. So the markup keeps writing
 * `rounded-lg` and knows why.
 *
 * `emphatic` is D10: `.project-view-frame` and `.project-proposals-strip` are bordered in the ink
 * itself, and without a variant for it they flatten to a hairline and the project sheet loses its
 * spine.
 */
const CARD_TONE = {
  surface: "bg-surface",
  raised: "bg-raised",
  ground: "bg-ground",
  /** No paper of its own: the panel is a frame over whatever is underneath. */
  plain: "bg-transparent",
} as const;

const CARD_PAD = { none: "", sm: "p-3", md: "p-4", lg: "p-6" } as const;

export function Card({
  as = "div",
  tone = "surface",
  pad = "md",
  emphatic = false,
  className,
  children,
  ...rest
}: {
  as?: "div" | "section" | "article" | "li";
  tone?: keyof typeof CARD_TONE;
  pad?: keyof typeof CARD_PAD;
  /** Bordered in the ink instead of the hairline. The sheet's strongest structural cue. */
  emphatic?: boolean;
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">) {
  /* `Box`, for the same reason as in `ActionError`: `Tag` is taken by the pill below. */
  const Box = as;
  const padding = CARD_PAD[pad];
  return (
    <Box
      {...rest}
      className={`rounded-lg border ${emphatic ? "border-chalk" : "border-edge"} ${CARD_TONE[tone]}${
        padding ? ` ${padding}` : ""
      }${className ? ` ${className}` : ""}`}
    >
      {children}
    </Box>
  );
}

/**
 * The frame that says there is nothing here yet.
 *
 * The differences between the treatments were never decisions: each was drawn on the day its
 * screen needed one. Counted on 8-Sep-2026 there were three dashed frames — `.catalog-empty` over
 * `--line-strong` padded 40px, `.project-log-empty` over `--color-edge-bright` padded 20, and
 * `twin-memory`'s over the lighter `border-edge` padded 20 — twelve box-less chains of utilities
 * in the markup, and five classes in the sheets saying the same sentence five ways. The corner was
 * the one thing the three agreed on, and only because the theme's sweep had already pulled them
 * onto 8px from 8, 10 and 11.
 *
 * Measured rather than listed, though, the tree holds THREE shapes and not twenty, so this is one
 * component with three named steps and there is no fourth:
 *
 * · `framed` — the frame the catalog already draws in `catalog-empty.css`: a dashed strong
 *   hairline, one corner, centred, the title at `--type-sm`/600 and the line under it at
 *   `--type-xs`. What a whole screen or a whole panel shows when it holds nothing.
 * · `bare` — the same block with no frame and no paper, and LEFT aligned. It is for the emptiness
 *   that is already inside a panel, where a second border draws a box inside a box; and it is left
 *   aligned because a frame gives a block a shape of its own to centre inside, while a block
 *   without one belongs to the column it sits in, and that column is not centred.
 * · `note` — one muted sentence, `--type-sm` in `--color-smoke`, which is what a section says when
 *   the list under a heading is empty and the heading has already named it. Twelve hand-written
 *   chains in the markup and five classes in the sheets were each writing exactly this.
 *
 * `framed` is the default because it is what the call sites that already existed render, and none
 * of them moves.
 *
 * The three share one block: same element, same gap, same order — icon, title, line, action — so
 * the step chooses a voice and a frame and never a structure. What `note` does not have is a
 * heading voice; it keeps `children` and `action` because a muted sentence with a link after it is
 * still one sentence, and dropping them silently would be the worse answer.
 */
const EMPTY_FRAME = {
  framed: " place-items-center rounded-lg border border-dashed border-edge-bright bg-ground p-8 text-center",
  bare: "",
  note: "",
} as const;

/** The title's voice. Two of the three are a heading; the third is the sentence itself. */
const EMPTY_TITLE = {
  framed: "text-sm font-semibold text-chalk",
  bare: "text-sm font-semibold text-chalk",
  note: "text-sm text-smoke",
} as const;

export type EmptyStateVariant = keyof typeof EMPTY_FRAME;

export function EmptyState({
  icon,
  title,
  action,
  variant = "framed",
  className,
  children,
  ...rest
}: {
  /** Drawn, never announced: it repeats what the title says. */
  icon?: ReactNode;
  title: ReactNode;
  /** What to do about it, if there is anything to do. */
  action?: ReactNode;
  /** The frame and the voice. `framed` boxes it, `bare` drops the box, `note` is one line. */
  variant?: EmptyStateVariant;
  /** The margin and the placement, and that's it — the same rule as `ActionButton`. */
  className?: string;
  /** The line under the title, if the title is not enough. */
  children?: ReactNode;
  /* `role="status"` travels through here: half of these appear after somebody pressed something. */
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children" | "title">) {
  return (
    <div
      {...rest}
      className={`grid gap-1${EMPTY_FRAME[variant]}${className ? ` ${className}` : ""}`}
    >
      {icon && (
        <span className="text-smoke" aria-hidden>
          {icon}
        </span>
      )}
      <p className={EMPTY_TITLE[variant]}>{title}</p>
      {children && <p className="text-xs text-smoke">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/**
 * The word-pill: a state, a severity, a level, a kind, in one word.
 *
 * Six sites write `px-1.5 py-0.5 font-mono text-[10px]` inside a bordered pill —`deps.tsx`,
 * `isolation.tsx`, `activity.tsx` twice, `run-status.tsx`, `resume.tsx`— behind FIVE separate
 * colour maps, and the maps disagree about something none of them ever decided: three paint
 * `bg-raised` under a coloured border and two paint the hue's own tint at 10%. One recipe wins
 * here, the tint, because a coloured border over a grey ground is a pill that half-committed; and
 * `--color-fail` over its own 10% tint is the one pairing `contrast.test.ts` measures on every
 * run, so the tinted form is the measured one.
 *
 * The three neutral tones keep `bg-raised`, which is what a pill with no hue has always been.
 */
const TAG_BASE = "inline-flex rounded border px-1.5 py-0.5 font-mono";

const TAG_TONE = {
  neutral: "border-edge bg-raised text-smoke",
  quiet: "border-edge bg-raised text-faint",
  strong: "border-edge bg-raised text-chalk",
  accent: "border-accent/30 bg-accent/10 text-accent",
  /*
    These two read their word in ink and not in their own colour, and it is the same division the
    rest of the interface makes: the hue goes on the mark, the word is read. Measured with
    `contrast.test.ts`'s own formula, `text-live` on `bg-live/10` is 2.34:1 and `text-idle` on
    `bg-idle/10` is 1.99:1 — and neither figure is one the register describes, because the
    inventory measures ink against PAPERS and only `--color-fail` against its own tint. `fail`
    below keeps its colour because it is the one that was measured for exactly this: 4.59:1 on its
    own tint over the worst paper in the app, and a test holds it there.
   */
  live: "border-live/30 bg-live/10 text-chalk",
  idle: "border-idle/30 bg-idle/10 text-chalk",
  fail: "border-fail/30 bg-fail/10 text-fail",
} as const;

/** Two steps only: this is a word, and a word does not need three. */
const TAG_SIZE = { sm: "text-[10px]", md: "text-[11px]" } as const;

/**
 * `baseline` exists for the one pill that carries two inks — a name and its version — where
 * centring the box leaves the two words sitting on different lines.
 */
const TAG_ALIGN = { center: "items-center gap-1", baseline: "items-baseline gap-1" } as const;

export type TagTone = keyof typeof TAG_TONE;

export function Tag({
  tone = "neutral",
  size = "sm",
  align = "center",
  className,
  children,
  ...rest
}: {
  tone?: TagTone;
  size?: keyof typeof TAG_SIZE;
  align?: keyof typeof TAG_ALIGN;
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLSpanElement>, "className" | "children">) {
  return (
    <span
      {...rest}
      className={`${TAG_BASE} ${TAG_ALIGN[align]} ${TAG_SIZE[size]} ${TAG_TONE[tone]}${
        className ? ` ${className}` : ""
      }`}
    >
      {children}
    </span>
  );
}
