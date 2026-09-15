import styles from "./docs.module.css";

/**
 * The memory loop as one figure: what already exists on the disk, the reader that opens it only
 * under a switch, the proposals, the owner's yes, the memory itself, the selector and the offer,
 * the agent's context, and the receipt read back from the transcript — with the patrol and the
 * forgetting attached to the memory, because both act on it and neither goes through the gate.
 *
 * Drawn by hand in SVG rather than loaded from an image so that it takes the page's own ink and
 * lines, scales with the column and stays legible to a screen reader through its title and
 * description. Every word in it is also said in the prose beside it; the figure is the map, not
 * the only copy of the territory.
 */

type Station = {
  x: number;
  y: number;
  width: number;
  height?: number;
  title: string;
  lines: string[];
  emphasis?: boolean;
  dashed?: boolean;
};

const BOX_HEIGHT = 72;

const STATIONS: Station[] = [
  { x: 16, y: 30, width: 190, title: "What already exists", lines: ["the agents' own transcripts", "git · hooks · what you type"] },
  { x: 238, y: 30, width: 190, title: "The reader", lines: ["receipts, facts, your turns", "only under a switch"] },
  { x: 460, y: 30, width: 160, title: "Proposals", lines: ["an agent · the extractor", "the Twin"] },
  { x: 764, y: 30, width: 224, title: "The memory", lines: ["notes · criteria · decisions", "commitments, with their checks"], emphasis: true },
  { x: 1024, y: 30, width: 160, title: "Forgetting", lines: ["withdraw · purge", "journal outside the base"], dashed: true },
  { x: 1024, y: 176, width: 160, title: "The patrol", lines: ["looks at the disk", "pass · fail · unknown"] },
  { x: 764, y: 176, width: 224, title: "The selector", lines: ["one contract per delivery", "hashed, kept, with a manifest"] },
  { x: 764, y: 322, width: 224, title: "The agent's context", lines: ["session start · edit hook · MCP", "a measured limit per road"] },
];

const GATE = { cx: 690, cy: 66, halfWidth: 50, halfHeight: 34 };

function Box({ station }: { station: Station }) {
  const height = station.height ?? BOX_HEIGHT;
  const centerX = station.x + station.width / 2;
  return (
    <g>
      <rect
        x={station.x}
        y={station.y}
        width={station.width}
        height={height}
        rx={6}
        className={`${styles.figureBox}${station.emphasis ? ` ${styles.figureBoxStrong}` : ""}${station.dashed ? ` ${styles.figureBoxDashed}` : ""}`}
      />
      <text x={centerX} y={station.y + 26} textAnchor="middle" className={styles.figureTitle}>
        {station.title}
      </text>
      {station.lines.map((line, index) => (
        <text key={line} x={centerX} y={station.y + 44 + index * 15} textAnchor="middle" className={styles.figureLine}>
          {line}
        </text>
      ))}
    </g>
  );
}

export function MemoryFigure() {
  const { cx, cy, halfWidth, halfHeight } = GATE;
  return (
    <figure className={styles.figure}>
      <svg
        viewBox="0 0 1200 420"
        role="img"
        aria-labelledby="memory-figure-title memory-figure-desc"
        className={styles.figureCanvas}
      >
        <title id="memory-figure-title">The memory loop</title>
        <desc id="memory-figure-desc">
          What already exists on the disk is opened by a reader only under a switch; the reader
          and the agents feed proposals; nothing passes into the memory without your yes; the
          selector turns the memory into one hashed contract per delivery for the agent's context;
          the receipt is read back from the agent's own transcript; the patrol checks the memory
          against the disk, and forgetting acts on the memory through a journal.
        </desc>
        <defs>
          <marker id="memory-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className={styles.figureArrowHead} />
          </marker>
        </defs>

        {/* The top row: sources → reader → proposals → the gate → the memory. */}
        <line x1={206} y1={66} x2={236} y2={66} className={styles.figureArrow} markerEnd="url(#memory-arrow)" />
        <line x1={428} y1={66} x2={458} y2={66} className={styles.figureArrow} markerEnd="url(#memory-arrow)" />
        <line x1={620} y1={66} x2={cx - halfWidth - 2} y2={66} className={styles.figureArrow} markerEnd="url(#memory-arrow)" />
        <line x1={cx + halfWidth} y1={66} x2={762} y2={66} className={styles.figureArrow} markerEnd="url(#memory-arrow)" />

        {/* The column: the memory → the selector → the agent's context. */}
        <line x1={876} y1={102} x2={876} y2={174} className={styles.figureArrow} markerEnd="url(#memory-arrow)" />
        <line x1={876} y1={248} x2={876} y2={320} className={styles.figureArrow} markerEnd="url(#memory-arrow)" />

        {/* The receipt: from the agent's context back to the reader, read from the transcript. */}
        <polyline
          points="764,358 333,358 333,104"
          className={styles.figureArrowDashed}
          markerEnd="url(#memory-arrow)"
        />
        <text x={548} y={348} textAnchor="middle" className={styles.figureCaption}>
          the receipt, read back from the agent's own transcript
        </text>

        {/* The patrol and the memory look at each other: an elbow, arrows at both ends. */}
        <polyline
          points="1022,212 950,212 950,104"
          className={styles.figureArrow}
          markerStart="url(#memory-arrow)"
          markerEnd="url(#memory-arrow)"
        />
        <text x={958} y={150} textAnchor="start" className={styles.figureCaption}>
          observations · incidents
        </text>

        {/* Forgetting reaches the memory, and it is dashed because it removes rather than adds. */}
        <line x1={1022} y1={66} x2={990} y2={66} className={styles.figureArrowDashed} markerEnd="url(#memory-arrow)" />

        {/* The gate: the one diamond on the page, filled with ink, because it is the person. */}
        <polygon
          points={`${cx},${cy - halfHeight} ${cx + halfWidth},${cy} ${cx},${cy + halfHeight} ${cx - halfWidth},${cy}`}
          className={styles.figureGate}
        />
        <text x={cx} y={cy + 5} textAnchor="middle" className={styles.figureGateLabel}>
          your yes
        </text>

        {STATIONS.map((station) => (
          <Box key={station.title} station={station} />
        ))}
      </svg>
      <figcaption className={styles.figureNote}>
        The loop, whole. Reading needs a switch, entering needs your yes, and what leaves is written
        down before it goes and read back after it arrives.
      </figcaption>
    </figure>
  );
}
