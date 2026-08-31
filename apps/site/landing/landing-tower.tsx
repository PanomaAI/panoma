import { MARK } from "./panoma-mark";
import styles from "./landing-tower.module.css";

/*
  The control tower, told by the logo itself.
  The P carries the product drawn from the beginning: its die punch is a six-panel window. Here
  those panels stop being dead ink and become six lit monitors where the miniature app lives, each
  with a purpose and placed according to the story that the landing page already tells — Find,
  Understand, Return — from left to right:
  left column the catalog: the list of identified folders and the chosen project central column
  the diagnosis: the health ring and the activity being drawn right column the action: the
  commits, the live status, and the 'open in' arrow
  Every 4.5 seconds a sweep of light crosses the window and the tower turns to the next project:
  the ring is redrawn with another note, the selection in the list jumps a row, the activity
  changes shape, and the icon changes color. The loop is not a reset — it is the tower browsing
  your catalog. The values change column by column, in the order that the sweep crosses them:
  causality, not choreography.
  The lettering never deforms. The panels don't move: they light up. All the content is cut out to
  the actual silhouette of each panel (`clipPath`), so not a single stroke ever touches the ink —
  the logo remains intact in every frame, and with `prefers-reduced-motion` the piece freezes on a
  complete board that continues selling the same thing in a single image.
 */

type Tone = "good" | "warn";

type Page = {
  id: string;
  accent: string;
  tone: Tone;
  health: number;
  /** Remaining circumference of the ring for that note; the arc is drawn up to here. */
  rest: number;
  commits: number;
  bars: [number, number, number, number];
  spark: string;
  sparkEnd: [number, number];
  glyph: string;
  /** Displacement of the selected row of the catalog with respect to the rest position row. */
  accentSquareY: number;
};

const RING_R = 28;
const RING_C = 2 * Math.PI * RING_R;
const rest = (health: number) => (RING_C * (100 - health)) / 100;

/*
  Three projects from the catalog: healthy, half-abandoned, healthy with another stack. The same
  accents as the invented apps from the comparison below.
 */
const PAGES: Page[] = [
  {
    id: "a",
    accent: "var(--accent-violet)",
    tone: "good",
    health: 94,
    rest: rest(94),
    commits: 27,
    bars: [24, 14, 30, 18],
    spark: "480,514 490,507 500,511 510,497 521,503 531,489 542,494",
    sparkEnd: [542, 494],
    glyph: "M400 392 L409 377 L414 381 L405 394 Z",
    accentSquareY: 501.5,
  },
  {
    id: "b",
    accent: "var(--accent-orange)",
    tone: "warn",
    health: 46,
    rest: rest(46),
    commits: 3,
    bars: [5, 8, 4, 6],
    spark: "480,519 492,518 504,520 516,517 528,519 540,518",
    sparkEnd: [540, 518],
    glyph: "M407 372 L416 377 L416 387 L407 392 L398 387 L398 377 Z",
    accentSquareY: 541.5,
  },
  {
    id: "c",
    accent: "var(--accent-mint)",
    tone: "good",
    health: 88,
    rest: rest(88),
    commits: 12,
    bars: [15, 9, 21, 12],
    spark: "480,510 489,502 498,512 508,494 518,507 528,497 540,502",
    sparkEnd: [540, 502],
    glyph: "M407 372 L414 390 L407 385 L400 390 Z",
    accentSquareY: 481.5,
  },
];

/* The rows of the catalog in the lower left panel: folder (little square) + name (bar). */
const ROWS = [
  { y: 486, width: 46 },
  { y: 506, width: 36 },
  { y: 526, width: 42 },
  { y: 546, width: 30 },
  { y: 566, width: 40 },
];

const BAR_X = [590, 606, 622, 638];
const BAR_BASE = 450;

/** One-third cycle window, in phase with its page and its column. */
function win(page: number, col: "L" | "C" | "R"): string {
  return `${styles.win} ${styles[`page${page}`]} ${styles[`col${col}`]}`;
}

/** Single ignition at start, in phase with its column. */
function hold(col: "L" | "C" | "R"): string {
  return `${styles.hold} ${styles[`col${col}`]}`;
}

/**
 * The description comes by prop and does not live here: written inside, the English version of the
 * landing announced the tower in Spanish. It is mandatory on purpose — today the tower is parked
 * under a `aria-hidden` and nobody hears it, but the day it returns to a place where it can be
 * read, the compiler will request the text before allowing it to be assembled.
 */
export function LandingTower({ label }: { label: string }) {
  return (
    <div className={styles.tower}>
      <svg className={styles.stage} viewBox="252 194 576 642" role="img" aria-label={label}>
        <defs>
          {/* The sweep: a sheet of light with the front edge shiny. */}
          <linearGradient id="tw-beam" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--card)" stopOpacity="0" />
            <stop offset="0.72" stopColor="var(--card)" stopOpacity="0.08" />
            <stop offset="1" stopColor="var(--card)" stopOpacity="0.34" />
          </linearGradient>
          <clipPath id="tw-LT"><path d={MARK.paneLT} /></clipPath>
          <clipPath id="tw-LB"><path d={MARK.paneLB} /></clipPath>
          <clipPath id="tw-CT"><path d={MARK.paneCT} /></clipPath>
          <clipPath id="tw-CB"><path d={MARK.paneCB} /></clipPath>
          <clipPath id="tw-RT"><path d={MARK.paneRT} /></clipPath>
          <clipPath id="tw-RB"><path d={MARK.paneRB} /></clipPath>
        </defs>

        {/* The lettering and the six panels, pure ink: the logo, intact. */}
        <path className={styles.ink} d={MARK.ink} />
        <path className={styles.ink} d={MARK.paneLT} />
        <path className={styles.ink} d={MARK.paneLB} />
        <path className={styles.ink} d={MARK.paneCT} />
        <path className={styles.ink} d={MARK.paneCB} />
        <path className={styles.ink} d={MARK.paneRT} />
        <path className={styles.ink} d={MARK.paneRB} />

        {/* ——— Izquierda arriba: el proyecto elegido — icono, nombre, ruta ——— */}
        <g clipPath="url(#tw-LT)">
          <g className={hold("L")}>
            <path d={MARK.paneLT} fill="var(--card)" fillOpacity="0.05" />
            <rect x="384" y="412" width="46" height="6" rx="3" className={styles.barStrong} />
            <rect x="384" y="424" width="32" height="4" rx="2" className={styles.barFaint} />
          </g>
          {PAGES.map((page, index) => (
            <g key={page.id} className={win(index, "L")}>
              <g className={styles.tilePop}>
                <rect x="389" y="366" width="36" height="36" rx="10" fill={page.accent} />
                <path d={page.glyph} fill="var(--card)" />
              </g>
            </g>
          ))}
          <rect className={styles.sweep} x="333" y="300" width="30" height="430" fill="url(#tw-beam)" />
        </g>

        {/* ——— Bottom left: the catalog — the list, and the selection paginating ——— */}
        <g clipPath="url(#tw-LB)">
          <g className={hold("L")}>
            <path d={MARK.paneLB} fill="var(--card)" fillOpacity="0.05" />
            {ROWS.map((row) => (
              <g key={row.y}>
                <rect x="376" y={row.y - 4.5} width="9" height="9" rx="2" className={styles.squareFaint} />
                <rect x="390" y={row.y - 2.5} width={row.width} height="5" rx="2.5" className={styles.barFaint} />
              </g>
            ))}
          </g>
          {/* The selection: the same clear row with an ink edge that the app uses. */}
          <g className={hold("L")}>
            <g className={styles.selection}>
              <rect x="372" y="498" width="70" height="16" rx="4" fill="var(--card)" fillOpacity="0.1" />
              <rect x="372" y="498" width="2.5" height="16" fill="var(--card)" fillOpacity="0.9" />
            </g>
          </g>
          {PAGES.map((page, index) => (
            <g key={page.id} className={win(index, "L")}>
              <rect x="376" y={page.accentSquareY} width="9" height="9" rx="2" fill={page.accent} />
            </g>
          ))}
          <rect className={styles.sweep} x="333" y="300" width="30" height="430" fill="url(#tw-beam)" />
        </g>

        {/* ——— Center top: health — the same ring that the app draws ——— */}
        <g clipPath="url(#tw-CT)">
          <g className={hold("C")}>
            <path d={MARK.paneCT} fill="var(--card)" fillOpacity="0.05" />
            <circle className={styles.ringTrack} cx="513.5" cy="393" r={RING_R} />
          </g>
          {PAGES.map((page, index) => (
            <g key={page.id} className={win(index, "C")}>
              <circle
                className={`${styles.ringArc} ${styles[page.tone]}`}
                cx="513.5"
                cy="393"
                r={RING_R}
                style={{ "--rest": page.rest.toFixed(1) } as React.CSSProperties}
              />
              <text className={`${styles.num} ${styles.numSlide}`} x="513.5" y="402" fontSize="26">
                {page.health}
              </text>
            </g>
          ))}
          <rect className={styles.sweep} x="333" y="300" width="30" height="430" fill="url(#tw-beam)" />
        </g>

        {/* ——— Center below: the activity — the pulse of commits, being drawn ——— */}
        <g clipPath="url(#tw-CB)">
          <g className={hold("C")}>
            <path d={MARK.paneCB} fill="var(--card)" fillOpacity="0.05" />
          </g>
          {PAGES.map((page, index) => (
            <g key={page.id} className={win(index, "C")}>
              <polyline className={styles.spark} points={page.spark} />
              <circle
                className={styles.sparkDot}
                cx={page.sparkEnd[0]}
                cy={page.sparkEnd[1]}
                r="4"
                fill={page.accent}
              />
            </g>
          ))}
          <rect className={styles.sweep} x="333" y="300" width="30" height="430" fill="url(#tw-beam)" />
        </g>

        {/* ——— Top right: workload — commits of the week ——— */}
        <g clipPath="url(#tw-RT)">
          <g className={hold("R")}>
            <path d={MARK.paneRT} fill="var(--card)" fillOpacity="0.05" />
          </g>
          {PAGES.map((page, index) => (
            <g key={page.id} className={win(index, "R")}>
              <text className={`${styles.num} ${styles.numSlide}`} x="612" y="398" fontSize="30">
                {page.commits}
              </text>
              {page.bars.map((height, barIndex) => (
                <rect
                  key={barIndex}
                  className={styles.bar}
                  style={{ "--bd": `${barIndex * 0.05}s` } as React.CSSProperties}
                  x={BAR_X[barIndex]}
                  y={BAR_BASE - height}
                  width="10"
                  height={height}
                  rx="2"
                />
              ))}
            </g>
          ))}
          <rect className={styles.sweep} x="333" y="300" width="30" height="430" fill="url(#tw-beam)" />
        </g>

        {/* ——— Bottom right: the state and the lap — live, and one click away ——— */}
        <g clipPath="url(#tw-RB)">
          <g className={hold("R")}>
            <path d={MARK.paneRB} fill="var(--card)" fillOpacity="0.05" />
            <path className={styles.arrow} d="M613 509 L629 493 M629 493 L619 493 M629 493 L629 503" />
          </g>
          {PAGES.map((page, index) => (
            <g key={page.id} className={win(index, "R")}>
              <circle className={`${styles.stateDot} ${styles[page.tone]}`} cx="592" cy="500" r="5.5" />
            </g>
          ))}
          <rect className={styles.sweep} x="333" y="300" width="30" height="430" fill="url(#tw-beam)" />
        </g>
      </svg>
    </div>
  );
}
