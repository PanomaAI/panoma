import type { MemoryCopy } from "./memory-copy";

/**
 * The twelve drawings of `/memory`, one per frame, all in the same 200 × 200 box and drawn with
 * two strokes and one gold: the gold is always the sentence, wherever it is at that moment.
 *
 * Every drawing is a function of the stylesheet's class map and the labels the copy provides,
 * so the same picture serves both registers and both languages. Motion is the stylesheet's: a
 * frame that has been on screen carries the `on` class, and the delayed transitions inside
 * (`fade`, `draw`, `rise`, `hand`, `slideIn`, `dropIn`, `lens`, `pop`) play from there. The lock
 * of the third frame is the one drawing with a state of its own: it opens when the permission is
 * given, from the switch beside the text.
 */

export type PicStyles = Readonly<Record<string, string>>;

export interface PicProps {
  s: PicStyles;
  labels: MemoryCopy["pics"];
  allowed?: boolean;
}

const join = (...names: (string | undefined | false)[]) => names.filter(Boolean).join(" ");

function YouWrite({ s }: PicProps) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="44" cy="126" r="16" className={join(s.st, s.fill)} />
      <path d="M14 178 C14 146 74 146 74 178" className={join(s.st, s.fill)} />
      <path
        d="M78 34 h108 a10 10 0 0 1 10 10 v46 a10 10 0 0 1 -10 10 h-70 l-22 18 v-18 h-16 a10 10 0 0 1 -10 -10 v-46 a10 10 0 0 1 10 -10 z"
        className={join(s.st, s.fill, s.gold, s.rise)}
      />
      <rect x="94" y="52" width="74" height="4" rx="2" className={join(s.goldfill, s.fade, s.d1)} />
      <rect x="94" y="64" width="86" height="4" rx="2" className={join(s.goldfill, s.fade, s.d2)} />
      <rect x="94" y="76" width="50" height="4" rx="2" className={join(s.goldfill, s.fade, s.d3)} />
    </svg>
  );
}

function FileGrows({ s }: PicProps) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <path d="M52 22 h66 l30 30 v126 h-96 z" className={join(s.st, s.fill)} />
      <path d="M118 22 v30 h30" className={s.st} />
      <rect x="68" y="72" width="60" height="4" rx="2" className={join(s.inkfill, s.fade, s.d1)} opacity="0.3" />
      <rect x="68" y="86" width="44" height="4" rx="2" className={join(s.inkfill, s.fade, s.d2)} opacity="0.3" />
      <rect x="68" y="100" width="64" height="4" rx="2" className={join(s.goldfill, s.fade, s.d3)} />
      <rect x="68" y="114" width="52" height="4" rx="2" className={join(s.inkfill, s.fade, s.d4)} opacity="0.3" />
      <rect x="68" y="128" width="58" height="4" rx="2" className={join(s.inkfill, s.fade, s.d5)} opacity="0.3" />
    </svg>
  );
}

function Locked({ s, allowed }: PicProps) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <path d="M52 22 h66 l30 30 v126 h-96 z" className={join(s.st, s.fill)} />
      <path d="M118 22 v30 h30" className={s.st} />
      <rect x="68" y="72" width="60" height="4" rx="2" className={s.inkfill} opacity="0.3" />
      <rect x="68" y="86" width="44" height="4" rx="2" className={s.inkfill} opacity="0.3" />
      <rect x="68" y="100" width="64" height="4" rx="2" className={s.goldfill} />
      <g className={join(s.lock, allowed && s.open)} transform="translate(120,118)">
        <path className={join(s.st, s.shackle)} d="M14 26 v-12 a14 14 0 0 1 28 0 v12" />
        <rect x="4" y="26" width="48" height="36" rx="6" className={join(s.st, s.fill)} />
        <circle cx="28" cy="44" r="4" className={s.inkfill} />
      </g>
    </svg>
  );
}

function Facts({ s, labels }: PicProps) {
  const rows: { y: number; text: string; delay: string | undefined }[] = [
    { y: 66, text: labels.p3a, delay: s.d2 },
    { y: 100, text: labels.p3b, delay: s.d3 },
    { y: 134, text: labels.p3c, delay: s.d4 },
  ];
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <path d="M6 48 h44 l18 18 v90 h-62 z" className={join(s.st, s.fill)} />
      <path d="M50 48 v18 h18" className={s.st} />
      <rect x="16" y="86" width="34" height="4" rx="2" className={s.inkfill} opacity="0.3" />
      <rect x="16" y="100" width="40" height="4" rx="2" className={s.goldfill} />
      <rect x="16" y="114" width="30" height="4" rx="2" className={s.inkfill} opacity="0.3" />
      <path d="M74 100 h12" className={join(s.st, s.draw)} />
      {rows.map((row) => (
        <g key={row.text} className={join(s.fade, row.delay)}>
          <path d={`M92 ${row.y} l5 5 l10 -10`} className={s.st} />
          <text x="112" y={row.y + 4} className={join(s.t, s.tFaint, s.tSmall)}>
            {row.text}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Quiet({ s, labels }: PicProps) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="60" cy="100" r="38" className={join(s.st, s.fill)} />
      <line x1="60" y1="100" x2="60" y2="70" className={join(s.st, s.hand)} />
      <circle cx="60" cy="100" r="3" className={s.inkfill} />
      <text x="60" y="160" className={join(s.t, s.tFaint)} textAnchor="middle">
        {labels.p4a}
      </text>
      <path d="M106 100 h34" className={join(s.st, s.draw, s.d3)} />
      <path d="M132 92 l8 8 l-8 8" className={join(s.st, s.draw, s.d3)} />
      <circle cx="166" cy="100" r="22" className={join(s.st, s.fill, s.fade, s.d4)} />
      <text x="166" y="105" className={join(s.t, s.fade, s.d4)} textAnchor="middle">
        IA
      </text>
    </svg>
  );
}

function Proposes({ s, labels }: PicProps) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="40" cy="60" r="22" className={join(s.st, s.fill)} />
      <text x="40" y="65" className={s.t} textAnchor="middle">
        IA
      </text>
      <path d="M40 90 v40 a8 8 0 0 0 8 8 h10" className={join(s.st, s.draw)} />
      <path d="M52 130 l8 8 l-8 8" className={join(s.st, s.draw, s.d1)} />
      <g className={s.dropIn}>
        <rect x="70" y="110" width="118" height="58" rx="8" className={join(s.st, s.fill, s.gold)} />
        <text x="80" y="128" className={join(s.t, s.tFaint)}>
          {labels.p5a}
        </text>
        <rect x="80" y="138" width="90" height="4" rx="2" className={s.goldfill} />
        <rect x="80" y="150" width="70" height="4" rx="2" className={s.goldfill} />
      </g>
    </svg>
  );
}

function Decide({ s }: PicProps) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="36" cy="56" r="16" className={join(s.st, s.fill)} />
      <path d="M6 108 C6 76 66 76 66 108" className={join(s.st, s.fill)} />
      <rect x="72" y="60" width="118" height="58" rx="8" className={join(s.st, s.fill, s.gold, s.rise)} />
      <rect x="84" y="78" width="90" height="4" rx="2" className={join(s.goldfill, s.fade, s.d1)} />
      <rect x="84" y="92" width="70" height="4" rx="2" className={join(s.goldfill, s.fade, s.d1)} />
      <g className={join(s.fade, s.d3)}>
        <rect x="72" y="134" width="54" height="26" rx="6" className={s.inkfill} />
        <text x="99" y="151" className={join(s.t, s.onInk)} textAnchor="middle">
          ✓
        </text>
      </g>
      <g className={join(s.fade, s.d3)}>
        <rect x="136" y="134" width="54" height="26" rx="6" className={join(s.st, s.fill)} />
        <text x="163" y="151" className={s.t} textAnchor="middle">
          ✕
        </text>
      </g>
    </svg>
  );
}

function Shelf({ s }: PicProps) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <rect x="24" y="40" width="152" height="130" rx="10" className={join(s.st, s.fill)} />
      <rect x="40" y="58" width="120" height="26" rx="5" className={s.stSoft} strokeDasharray="4 4" />
      <rect x="40" y="94" width="120" height="26" rx="5" className={s.stSoft} strokeDasharray="4 4" />
      <rect x="40" y="130" width="120" height="26" rx="5" className={s.stSoft} strokeDasharray="4 4" />
      <g className={s.dropIn}>
        <rect x="40" y="58" width="120" height="26" rx="5" className={join(s.st, s.fill)} />
        <rect x="50" y="69" width="70" height="4" rx="2" className={s.inkfill} />
        <rect x="126" y="63" width="28" height="16" rx="3" className={s.inkfill} />
        <text x="140" y="75" className={join(s.t, s.tSmall, s.onInk)} textAnchor="middle">
          v1
        </text>
      </g>
    </svg>
  );
}

function Taste({ s }: PicProps) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="40" cy="70" r="16" className={join(s.st, s.fill)} />
      <path d="M10 122 C10 90 70 90 70 122" className={join(s.st, s.fill)} />
      <path d="M78 100 h22" className={join(s.st, s.draw)} />
      <path d="M94 92 l8 8 l-8 8" className={join(s.st, s.draw, s.d1)} />
      <g className={join(s.rise, s.d2)}>
        <path d="M112 40 h50 l22 22 v98 h-72 z" className={join(s.st, s.fill)} />
        <path d="M162 40 v22 h22" className={s.st} />
        <text x="124" y="80" className={join(s.t, s.tFaint, s.tSmall)}>
          TASTE.md
        </text>
        <rect x="124" y="94" width="48" height="4" rx="2" className={join(s.goldfill, s.fade, s.d3)} />
        <rect x="124" y="108" width="40" height="4" rx="2" className={join(s.goldfill, s.fade, s.d4)} />
        <rect x="124" y="122" width="52" height="4" rx="2" className={join(s.goldfill, s.fade, s.d5)} />
      </g>
    </svg>
  );
}

function Delivered({ s }: PicProps) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <rect x="86" y="40" width="100" height="120" rx="8" className={join(s.st, s.fill)} />
      <path d="M86 58 h100" className={s.st} />
      <circle cx="98" cy="49" r="2.5" className={s.inkfill} opacity="0.4" />
      <circle cx="108" cy="49" r="2.5" className={s.inkfill} opacity="0.4" />
      <text x="100" y="150" className={join(s.t, s.tFaint, s.tSmall)}>
        ›_
      </text>
      <g className={s.slideIn}>
        <rect x="96" y="76" width="80" height="52" rx="6" className={join(s.st, s.fill)} />
        <path d="M96 84 l40 26 l40 -26" className={s.st} />
        <circle cx="136" cy="112" r="8" className={s.goldfill} />
      </g>
    </svg>
  );
}

function Receipt({ s }: PicProps) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <path d="M52 22 h66 l30 30 v126 h-96 z" className={join(s.st, s.fill)} />
      <path d="M118 22 v30 h30" className={s.st} />
      <rect x="68" y="72" width="60" height="4" rx="2" className={s.inkfill} opacity="0.3" />
      <rect x="68" y="86" width="44" height="4" rx="2" className={s.inkfill} opacity="0.3" />
      <circle cx="74" cy="104" r="5" className={s.goldfill} />
      <rect x="86" y="102" width="42" height="4" rx="2" className={s.inkfill} opacity="0.3" />
      <rect x="68" y="118" width="52" height="4" rx="2" className={s.inkfill} opacity="0.3" />
      <g className={s.lens}>
        <circle cx="44" cy="70" r="20" className={join(s.st, s.clear)} />
        <line x1="58" y1="84" x2="76" y2="102" className={join(s.st, s.thick)} />
      </g>
      <g className={join(s.pop, s.late)}>
        <circle cx="154" cy="150" r="18" className={s.inkfill} />
        <path d="M145 150 l6 6 l12 -12" className={join(s.st, s.onInkStroke)} />
      </g>
    </svg>
  );
}

function Watching({ s }: PicProps) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <path d="M20 100 C50 56 110 56 140 100 C110 144 50 144 20 100 z" className={join(s.st, s.fill)} />
      <circle cx="80" cy="100" r="14" className={join(s.st, s.fill)} />
      <circle cx="80" cy="100" r="5" className={s.inkfill} />
      <path d="M150 62 h30 l12 12 v50 h-42 z" className={join(s.st, s.fill, s.fade, s.d1)} />
      <path d="M166 90 l6 6 l12 -12" className={join(s.st, s.fade, s.d2)} />
      <path d="M150 128 h30 l12 12 v50 h-42 z" className={join(s.st, s.fill, s.fade, s.d3)} strokeDasharray="4 4" />
      <path d="M166 152 l16 16 M182 152 l-16 16" className={join(s.st, s.fade, s.d4)} />
    </svg>
  );
}

/** One drawing per frame, in the order of the copy's frames. */
export const MEMORY_PICS: ((props: PicProps) => React.JSX.Element)[] = [
  YouWrite,
  FileGrows,
  Locked,
  Facts,
  Quiet,
  Proposes,
  Decide,
  Shelf,
  Taste,
  Delivered,
  Receipt,
  Watching,
];
