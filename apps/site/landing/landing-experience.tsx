"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { IconType } from "react-icons";
import { HiOutlineCloudArrowUp, HiOutlineCodeBracketSquare } from "react-icons/hi2";
import {
  PiArrowCounterClockwiseBold,
  PiDiamondBold,
  PiGithubLogoBold,
  PiCompassBold,
  PiPackageBold,
  PiPauseFill,
  PiPenNibBold,
  PiPlayFill,
  PiRobotBold,
  PiMoonBold,
  PiSunBold,
  PiSquaresFourBold,
  PiStorefrontBold,
  PiTerminalWindowBold,
  PiWaveTriangleBold,
} from "react-icons/pi";
import {
  SiGo,
  SiJavascript,
  SiPython,
  SiReact,
  SiRust,
  SiTypescript,
} from "react-icons/si";
import { BRAND_ICONS } from "./brand-icons";
import type { Locale } from "../lib/locale";
import {
  FILM_BEATS,
  FILM_DURATION,
  filmBeatAt,
  filmBeatProgress,
  filmTypedChars,
  filmTypingOn,
} from "./film-beats";
import { type LandingCopy } from "./landing-copy";
import { FollowInvite } from "./follow-invite";
import { HeroEntrance } from "./hero-entrance";
import { LandingSwarm, paintMark, type SwarmShape } from "./landing-swarm";
import { LandingTower } from "./landing-tower";
import { LANDING_THEME_VAR, landingThemeValue } from "./landing-theme";
import {
  LANDING_COLOR_SCHEME,
  LANDING_DEFAULT_THEME,
  LANDING_THEME_COLOR,
  nextLandingTheme,
  type LandingColorTheme,
} from "./color-theme";
import { MARK } from "./panoma-mark";
import { canvasPixelRatio } from "./swarm-paint";
import styles from "./landing.module.css";
import theme from "./landing-theme.module.css";

type DemoState = "activo" | "pausa" | "dormido";

type DemoProject = {
  id: string;
  name: string;
  folder: string;
  root: string;
  /** `null` when the folder doesn't have an icon: the gap with `<>` appears, like in the app. */
  icon: IconType | null;
  tone: string;
  glyph: string;
  health: number;
  stack: string;
  stackIcon: IconType;
  stackTone: string;
  /** `"you"` is a placeholder, not a name: it is the only thing here that changes with the language. */
  collaborator: string;
  collaboratorAgent: boolean;
  state: DemoState;
  /** How long ago, in data. The phrase —"hace 2 d" / "2d ago"— is set by the language. */
  since: { unit: "today" | "yesterday" | "d" | "w" | "mo"; n: number };
  /** ISO. The Finder displays it with the language format, not with a manually written string. */
  modifiedAt: string;
  /** Cloud mark: exists only on this disc. */
  onlyLocal: boolean;
};

/*
  Twelve invented projects in the shape of a real disc: an app and its landing page, a panel that
  was left unfinished, a copy of a theme, a folder of screenshots that nobody opened again. The
  pretty names come from README; those that don't have them, keep the folder's name — which is
  exactly the difference the comparison shows.
 */
const PROJECTS: DemoProject[] = [
  {
    id: "kirvo",
    name: "Kirvo",
    folder: "kirvo-app-final",
    root: "~/Dev/kirvo-app-final",
    icon: PiPenNibBold,
    tone: "var(--project-kirvo)",
    glyph: "var(--on-accent)",
    health: 94,
    stack: "TypeScript",
    stackIcon: SiTypescript,
    stackTone: "var(--stack-typescript)",
    collaborator: "you",
    collaboratorAgent: false,
    state: "activo",
    since: { unit: "today", n: 0 },
    modifiedAt: "2026-08-17T10:42",
    onlyLocal: false,
  },
  {
    id: "marlow",
    name: "Marlow",
    folder: "marlow-main",
    root: "~/Dev/marlow-main",
    icon: PiPackageBold,
    tone: "var(--project-marlow)",
    glyph: "var(--on-accent)",
    health: 88,
    stack: "Go",
    stackIcon: SiGo,
    stackTone: "var(--stack-go)",
    collaborator: "Ana Pérez",
    collaboratorAgent: false,
    state: "activo",
    since: { unit: "yesterday", n: 0 },
    modifiedAt: "2026-08-16T18:21",
    onlyLocal: false,
  },
  {
    id: "kirvo-landing",
    name: "kirvo-landing",
    folder: "kirvo-landing",
    root: "~/Dev/kirvo-landing",
    icon: null,
    tone: "",
    glyph: "",
    health: 46,
    stack: "React",
    stackIcon: SiReact,
    stackTone: "var(--stack-react)",
    collaborator: "you",
    collaboratorAgent: false,
    state: "pausa",
    since: { unit: "d", n: 2 },
    modifiedAt: "2026-08-15T22:34",
    onlyLocal: true,
  },
  {
    id: "waypoint",
    name: "Waypoint",
    folder: "waypoint-web-v2",
    root: "~/Dev/waypoint-web-v2",
    icon: PiCompassBold,
    tone: "var(--project-waypoint)",
    glyph: "var(--on-accent)",
    health: 79,
    stack: "React",
    stackIcon: SiReact,
    stackTone: "var(--stack-react)",
    collaborator: "Waypoint Agent",
    collaboratorAgent: true,
    state: "activo",
    since: { unit: "d", n: 3 },
    modifiedAt: "2026-08-14T11:09",
    onlyLocal: false,
  },
  {
    id: "nimbus",
    name: "Nimbus",
    folder: "nimbus-cli",
    root: "~/Dev/nimbus-cli",
    icon: PiTerminalWindowBold,
    tone: "var(--project-nimbus)",
    glyph: "var(--on-accent)",
    health: 71,
    stack: "Python",
    stackIcon: SiPython,
    stackTone: "var(--stack-python)",
    collaborator: "Data Agent",
    collaboratorAgent: true,
    state: "activo",
    since: { unit: "d", n: 6 },
    modifiedAt: "2026-08-11T09:17",
    onlyLocal: false,
  },
  {
    id: "gridwork",
    name: "Gridwork",
    folder: "gridwork-templates",
    root: "~/Dev/gridwork-templates",
    icon: PiSquaresFourBold,
    tone: "var(--project-gridwork)",
    glyph: "var(--on-accent)",
    health: 66,
    stack: "TypeScript",
    stackIcon: SiTypescript,
    stackTone: "var(--stack-typescript)",
    collaborator: "you",
    collaboratorAgent: false,
    state: "pausa",
    since: { unit: "w", n: 2 },
    modifiedAt: "2026-08-03T08:55",
    onlyLocal: false,
  },
  {
    id: "marlow-panel",
    name: "marlow-panel",
    folder: "marlow-panel-old",
    root: "~/Dev/marlow-panel-old",
    icon: null,
    tone: "",
    glyph: "",
    health: 52,
    stack: "React",
    stackIcon: SiReact,
    stackTone: "var(--stack-react)",
    collaborator: "Jules",
    collaboratorAgent: false,
    state: "pausa",
    since: { unit: "w", n: 3 },
    modifiedAt: "2026-07-27T16:40",
    onlyLocal: true,
  },
  {
    id: "shopwell",
    name: "Shopwell",
    folder: "shopwell-shopify-theme",
    root: "~/Dev/shopwell-shopify-theme",
    icon: PiStorefrontBold,
    tone: "var(--project-shopwell)",
    glyph: "var(--on-accent)",
    health: 38,
    stack: "JavaScript",
    stackIcon: SiJavascript,
    stackTone: "var(--stack-javascript)",
    collaborator: "Ana Pérez",
    collaboratorAgent: false,
    state: "dormido",
    since: { unit: "mo", n: 1 },
    modifiedAt: "2026-07-14T12:02",
    onlyLocal: false,
  },
  {
    id: "kirvo-sync",
    name: "kirvo-sync",
    folder: "kirvo-sync",
    root: "~/Dev/kirvo-sync",
    icon: null,
    tone: "",
    glyph: "",
    health: 61,
    stack: "Go",
    stackIcon: SiGo,
    stackTone: "var(--stack-go)",
    collaborator: "Cron Agent",
    collaboratorAgent: true,
    state: "dormido",
    since: { unit: "mo", n: 1 },
    modifiedAt: "2026-07-09T19:28",
    onlyLocal: false,
  },
  {
    id: "trace89",
    name: "trace89",
    folder: "trace89",
    root: "~/Dev/trace89",
    icon: PiWaveTriangleBold,
    tone: "var(--project-trace)",
    glyph: "var(--on-accent)",
    health: 34,
    stack: "Python",
    stackIcon: SiPython,
    stackTone: "var(--stack-python)",
    collaborator: "you",
    collaboratorAgent: false,
    state: "dormido",
    since: { unit: "mo", n: 2 },
    modifiedAt: "2026-06-12T23:11",
    onlyLocal: true,
  },
  {
    id: "screens",
    name: "appstore_screens_v3",
    folder: "appstore_screens_v3",
    root: "~/Dev/appstore_screens_v3",
    icon: null,
    tone: "",
    glyph: "",
    health: 11,
    stack: "JavaScript",
    stackIcon: SiJavascript,
    stackTone: "var(--stack-javascript)",
    collaborator: "you",
    collaboratorAgent: false,
    state: "dormido",
    since: { unit: "mo", n: 4 },
    modifiedAt: "2026-04-21T15:07",
    onlyLocal: true,
  },
  {
    id: "harbor",
    name: "harbor-temp",
    folder: "harbor-temp",
    root: "~/Dev/harbor-temp",
    icon: null,
    tone: "",
    glyph: "",
    health: 24,
    stack: "Rust",
    stackIcon: SiRust,
    stackTone: "var(--stack-rust)",
    collaborator: "you",
    collaboratorAgent: false,
    state: "dormido",
    since: { unit: "mo", n: 5 },
    modifiedAt: "2026-03-19T09:44",
    onlyLocal: true,
  },
];

/*
  The repo lives under the organization, not under the personal account of the one who writes it:
  it is the address that those who come will copy, and moving it after it circulates costs much
  more than setting it correctly now.
 */
const GITHUB_URL = "https://github.com/PanomaAI/panoma";

/**
 * "2 d ago" / "2d ago": the same figure, said in whichever language applies.
 *
 * The month has a separate template for the singular. “hace 1 meses” appeared on two cards in the
 * demo, and a lack of agreement on the first screen of a product is read as carelessness in
 * everything else — it is what costs the most and what costs the least.
 */
function sinceLabel(since: DemoProject["since"], text: LandingCopy): string {
  const template = since.unit === "mo" && since.n === 1 ? text.since.mo1 : text.since[since.unit];
  return template.replace("{n}", String(since.n));
}

/*
  The input ends in a single form: the mark. Arrays live outside the component because they are
  dependencies of the `LandingSwarm` effect; thus copying a command or changing the topic does not
  unmount the canvas or force the P to form again.
  The engine retains its other capabilities —cursor response, off-screen pause, and responsive
  reconstruction—, but this path does not contain sentences or a second figure to which it can
  transform.
 */
const HERO_SHAPES: SwarmShape[] = [{ kind: "draw", paint: paintMark }];
const HERO_ORDER = [0];

const COMMAND = "npx panoma scan ~/Desktop";
/*
  The same command, with the entire disk.
  It was `scan ~`, and it stopped making sense the day the owner started offering `up`: anyone who
  reaches the closing has already seen the command that gets the catalog working, so proposing
  there a version that only prints is offering them the worst of the two. What changes between
  these two boxes is the scope —a folder or the entire disk—, not the degree of commitment. That
  is decided above, by the owner, which is where someone still doesn't know if they want anything.
 */
const COMMAND_ALL = "npx panoma up ~";
/*
  The one who truly opens the catalog, and leaves it full.
  `scan` shows a folder and doesn't save anything — it's the risk-free test, and that's why it
  rules. But for months this page did not offer any path to the product, because `panoma up` did
  not know how to start outside the monorepo: whoever ran the command got a report in the terminal
  and that was it.
  It includes the folder deliberately. Someone arriving through `npx` does not keep the `panoma`
  command in PATH —npx runs from its cache and doesn't link anything—, so splitting it into
  'start' and 'then scan' were two pastings and two trips to the cache. With the folder, `up`
  loads the catalog and fills it at once: it pastes only one thing and what comes out is the
  working product.
 */
const COMMAND_UP = "npx panoma up ~/Desktop";

/**
 * A command with its button and its label.
 *
 * Before there was a command and, below it, a note that said 'the whole disk? the same command
 * with ~'. That is asking the reader to read the note, understand the substitution, and manually
 * edit what they just copied — three steps for what could be done with a button. Now both methods
 * are written out and both can be copied: the Desktop to test, the whole disk for real, and the
 * label says which is which without having to deduce it from the path.
 *
 * Each box has its own 'copying' because otherwise, copying one turns on both and the reader
 * doesn't know what has been taken.
 */
function CommandBox({
  command,
  label,
  text,
  quiet,
}: {
  command: string;
  label: string;
  text: LandingCopy;
  quiet?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  /*
    The clipboard promise is expected before saying 'copied.' Not waiting for it seems the same
    but it is not: where there is no safe context `navigator.clipboard` does not exist, `?.`
    swallowed it silently, and the button claimed to have copied a command that had not left the
    page. If it fails, the label does not change — the command is in plain sight and is selected
    by hand, which is exactly what `CopyCommand` does in the app.
    And the timer is saved so it can be canceled: two consecutive clicks scheduled two shutdowns,
    and the first click would cancel the 'copying' of the second halfway through.
   */
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className={styles.commandRow}>
      <div className={styles.commandBox} data-quiet={quiet || undefined}>
        <code>
          <b>$</b> {command}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={`${text.copy.aria}: ${command}`}
        >
          {copied ? text.copy.done : text.copy.idle}
        </button>
      </div>
      <p className={styles.commandLabel}>{label}</p>
    </div>
  );
}

/** The two paths, in the same order in the two places where they are offered. */
/*
  The pair of commands, and the next step only where it fits.
  `withUp` is not a configuration whim: the headline is designed to fit on a screen —774 px of 720
  with three boxes, measured— so adding the third one there puts it just below the fold, which is
  the worst thing you can do with a command: it's there and not visible. And the argument of the
  headline is that `scan` doesn't commit you to anything; putting in the command that actually
  brings up a server changes its message.
  At the closing, eleven thousand pixels later, whoever keeps reading is already convinced and
  what they need is the entire sequence.
 */
/**
 * The commands of the holder: first the one that leaves the catalog working.
 *
 * Here `up` is in charge and not `scan`, and the change is recent. While `panoma up` couldn't
 * start outside of the monorepo, the only thing this page could offer was a tasting; now a single
 * hit lifts the catalog and fills it —measured from end to end from a clean npm installation: 21
 * seconds on a 52 GB desktop, 75 projects— and hiding that behind eleven thousand pixels was
 * giving away the best thing the product has.
 *
 * They are still two boxes and not three. The headline is designed to fit on a screen — with three
 * it goes from 526 to 774 pixels against a window of 720, measured — so the third would be just
 * below the fold: out of view. The free trial isn't lost, it drops to the second box; and the full
 * disc is still at the checkout, which is where someone considers scanning everything.
 */
function HeroCommands({ text }: { text: LandingCopy }) {
  return (
    <div className={styles.commands}>
      <CommandBox
        command={COMMAND_UP}
        label={text.command.catalog}
        text={text}
      />
      <CommandBox
        command={COMMAND_ALL}
        label={text.footer.finaleAllCommand}
        text={text}
        quiet
      />
    </div>
  );
}

/**
 * The closure commands: itself, and how far it goes.
 *
 * Here there is no tasting anymore. Whoever gets to the bottom has read the entire page, and what
 * remains to decide is not whether to try, but how much of the record to look at. Offering `scan`
 * at this point — after the headline taught them the command that lifts the catalog — was putting
 * in front of them the worst version of something they already know, and making them wonder if the
 * good version had some flaw that wasn't told to them.
 */
function CommandPair({ text }: { text: LandingCopy }) {
  return (
    <div className={styles.commands}>
      <CommandBox command={COMMAND_UP} label={text.command.desktop} text={text} />
      <CommandBox command={COMMAND_ALL} label={text.command.wholeDisk} text={text} quiet />
    </div>
  );
}

/** Convert the `acentos graves` from the copy into <code>, which is what they are. */
function mdInline(text: string): ReactNode[] {
  return text
    .split("`")
    .map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>));
}

/**
 * The final diagram is neither a snapshot nor an abstract promise: it reproduces the real
 * operation of the product without an artificial stop. The disk folders are directly converted
 * into readable projects within Panoma. Being HTML/CSS, it preserves detail at any width, respects
 * the reduced movement, and does not add another bitmap.
 */
function FinaleSystem({ text }: { text: LandingCopy }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [awake, setAwake] = useState(false);
  const [routesReady, setRoutesReady] = useState(false);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setAwake(true);
        observer.disconnect();
      },
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!awake) return;

    const root = rootRef.current;
    if (!root) return;
    let resizeTimer = 0;
    let measureTimer = 0;

    const measureRoutes = () => {
      const sources = Array.from(
        root.querySelectorAll<HTMLElement>("[data-finale-folder]"),
      );
      const travelers = Array.from(
        root.querySelectorAll<HTMLElement>("[data-finale-traveler]"),
      );
      const projects = Array.from(
        root.querySelectorAll<HTMLElement>("[data-finale-project]"),
      );
      if (sources.length === 0 || travelers.length === 0 || projects.length === 0) return;

      const rootRect = root.getBoundingClientRect();
      travelers.forEach((traveler, index) => {
        const source = sources[index % sources.length];
        const target = projects[(index * 2) % projects.length];
        if (!source || !target) return;

        const sourceRect = source.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const targetScale = Math.min(
          targetRect.width / sourceRect.width,
          targetRect.height / sourceRect.height,
        );

        traveler.style.width = `${sourceRect.width}px`;
        traveler.style.height = `${sourceRect.height}px`;
        traveler.style.setProperty("--source-x", `${sourceRect.left - rootRect.left}px`);
        traveler.style.setProperty("--source-y", `${sourceRect.top - rootRect.top}px`);
        traveler.style.setProperty(
          "--target-x",
          `${targetRect.left + targetRect.width / 2 - rootRect.left - sourceRect.width / 2}px`,
        );
        traveler.style.setProperty(
          "--target-y",
          `${targetRect.top + targetRect.height / 2 - rootRect.top - sourceRect.height / 2}px`,
        );
        traveler.style.setProperty("--target-scale", String(targetScale));
        traveler.style.setProperty("--launch-delay", `${index * -1800}ms`);
      });

      setRoutesReady(true);
    };

    const scheduleMeasure = (delay: number) => {
      window.clearTimeout(measureTimer);
      measureTimer = window.setTimeout(measureRoutes, delay);
    };

    scheduleMeasure(1800);
    const onResize = () => {
      setRoutesReady(false);
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => scheduleMeasure(80), 180);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(resizeTimer);
      window.clearTimeout(measureTimer);
    };
  }, [awake]);

  return (
    <div
      ref={rootRef}
      className={styles.finaleSystem}
      data-awake={awake ? "true" : "false"}
      data-routes={routesReady ? "true" : "false"}
      aria-hidden
    >
      <div className={`${styles.finaleNode} ${styles.finaleDisk}`}>
        <p className={styles.finaleMapLabel}>
          <span>01</span>
          {text.footer.finaleDisk}
        </p>
        <div className={styles.finaleCatalogBody}>
          <div className={`${styles.finaleCatalogWindow} ${styles.finaleLooseWindow}`}>
            <span className={styles.finaleWindowBar}>
              <b className={styles.finaleWindowTitle}>{text.footer.finaleDisk}</b>
            </span>
            <span className={styles.finaleWindowRail} />
            <span className={styles.finaleFolderField}>
              {Array.from({ length: 12 }, (_, index) => (
                <i key={index} className={styles.finaleFolder} data-finale-folder>
                  <span><b /></span>
                </i>
              ))}
            </span>
          </div>
          <ul className={`${styles.finaleFeatureList} ${styles.finaleLooseList}`}>
            <li><i />{text.footer.finaleLoose}</li>
          </ul>
        </div>
      </div>

      <div className={styles.finaleFlow} />

      <div className={`${styles.finaleNode} ${styles.finaleCatalog}`}>
        <p className={styles.finaleMapLabel}>
          <span>02</span>
          {text.footer.finaleCatalog}
        </p>
        <div className={styles.finaleCatalogBody}>
          <div className={styles.finaleCatalogWindow}>
            <span className={styles.finaleWindowBar}>
              <b className={styles.finaleWindowTitle}>Panoma</b>
            </span>
            <span className={styles.finaleWindowRail} />
            <span className={styles.finaleProjectGrid}>
              {Array.from({ length: 12 }, (_, index) => (
                <i
                  key={index}
                  data-finale-project
                  style={{ "--i": index } as CSSProperties}
                />
              ))}
            </span>
          </div>
          <ul className={styles.finaleFeatureList}>
            {text.footer.finaleFeatures.map((feature, index) => (
              <li key={feature} style={{ "--i": index } as CSSProperties}>
                <i />
                {feature}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <span className={styles.finaleTravelLayer}>
        {Array.from({ length: 4 }, (_, index) => (
          <i key={index} className={styles.finaleTraveler} data-finale-traveler>
            <span><b /></span>
          </i>
        ))}
      </span>

    </div>
  );
}

/**
 * Rewrite the tags that tell the browser what color its frame should be.
 *
 * **The `content` of those that are already there is mutated, the nodes are not replaced.** Both
 * ways are valid for the browser —the spec forces you to recalculate before inserting, deleting
 * and changing `content`, and WebKit and Blink implement all three since Safari 15 and Chrome 93—,
 * but with two tags of the same name it sends the FIRST of the tree, not the last ("put your
 * fallback first, not last", said Apple when presenting them). And Next re-assembles its own at
 * the end of the `<head>` in each client navigation, without ever reconciling one that it did not
 * put in: replacing nodes by hand ends, after the first navigation, with two tags whose winner
 * depends on the order in which they were assembled. Mutating the present —all of them, in case
 * that day comes— does not create anything that can be duplicated. Creating one only matters if
 * there is none, which on this page does not happen: `generateViewport` always serves them.
 *
 * Notice for anyone coming to debug this with an iPhone: in iOS 26 this function cannot do
 * anything to the bar. Safari 26 (Liquid Glass) ignores `theme-color` by design and colors its
 * frame by sampling the painted background — and that sampling remains frozen on the first paint
 * of each load (WebKit 306074 and 309956, open). iOS 26 is handled by the slats of `frameTint*`
 * and `?theme=` that this very button writes to the address; the label remains for those who
 * actually honor it: Safari 15–18 with the active tint, Chrome and Edge on Android with the system
 * in light mode, Samsung Internet in light mode.
 */
function repintarElMarco(tema: LandingColorTheme) {
  const etiquetas: [string, string][] = [
    ["theme-color", LANDING_THEME_COLOR[tema]],
    ["color-scheme", LANDING_COLOR_SCHEME[tema]],
  ];
  for (const [nombre, valor] of etiquetas) {
    const presentes = document.head.querySelectorAll(`meta[name="${nombre}"]`);
    if (presentes.length === 0) {
      const nueva = document.createElement("meta");
      nueva.setAttribute("name", nombre);
      nueva.setAttribute("content", valor);
      document.head.appendChild(nueva);
      continue;
    }
    for (const meta of presentes) {
      meta.setAttribute("content", valor);
    }
  }
}

export function LandingExperience({
  locale,
  copy: text,
  initialTheme,
  newsletterOn,
}: {
  locale: Locale;
  copy: LandingCopy;
  initialTheme: LandingColorTheme;
  /*
    If there is a database to save the additions. It's decided by the server and comes down as a
    boolean: the keys of the database cannot pass through here, which is code that the visitor
    downloads.
   */
  newsletterOn: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [colorTheme, setColorTheme] = useState<LandingColorTheme>(initialTheme);

  /* The same cookie as the app: choosing the language here also chooses it in the catalog. */
  const switchTo = (next: Locale) => {
    document.cookie = `panoma-lang=${next}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  };

  const copy = () => {
    void navigator.clipboard?.writeText(COMMAND);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const toggleTheme = () => {
    setColorTheme((current) => {
      const next = nextLandingTheme(current);
      const url = new URL(window.location.href);
      /*
        Writing the theme in the address does two jobs. The visible one: linking and reloading
        preserve the chosen reading. The invisible one, and it's what makes it essential: in iOS
        26 the top bar of the browser remains frozen with the color of the first paint of each
        load (WebKit 306074) — reloading is the ONLY way to set it to the theme color, and only if
        the server already knows what it is. With `?theme=` in the address, `generateViewport` and
        `body:has()` from `site.css` serve that color from the first byte.
        The topic of the house is not written in the bar: `panoma.ai` as is and
        `panoma.ai/?theme=light` are the same page, and an address with a parameter that adds
        nothing is an address that someone copies and shares worse. It is compared against the
        constant and not against a manually written topic: the defect has already moved twice —to
        dark on 27-Aug-2026, back to light on the 28th—, and moving it like that is changing a
        site.
       */
      if (next === LANDING_DEFAULT_THEME) url.searchParams.delete("theme");
      else url.searchParams.set("theme", next);
      window.history.replaceState(window.history.state, "", url);

      /*
        And the browser frame with it.
        The tags are set by the server in the first response —`generateViewport` in
        `app/page.tsx`, with the `?theme=` of the address—, so the frame already comes out in the
        theme color without flickering. But changing the theme here does not request the page
        again, so they have to be redone manually.
       */
      repintarElMarco(next);

      return next;
    });
  };

  const nextTheme = nextLandingTheme(colorTheme);
  const nextThemeLabel = nextTheme === "dark"
    ? text.nav.darkTheme
    : nextTheme === "gold"
      ? text.nav.goldTheme
      : text.nav.lightTheme;

  return (
    <div className={`${theme.theme} ${styles.page}`} data-theme={colorTheme}>
      {/*
         The strips sampled by iOS 26. Safari 26 no longer reads `theme-color`: it decides the
         color of its frame by looking at what is painted attached to the edges —a fixed element
         first, the body if not— and only recalculates it when a fixed element APPEARS, not when
         one that was already there changes color: the sampling of the first painting is frozen
         (WebKit 306074). The `key` with the theme is the entire layout — changing the theme
         unmounts these two and mounts new ones, and that appearance is what forces re-sampling.
         Measured on the iOS simulator 26.3 on 28-Aug-2026, full round dark→white→gold→dark: the
         address bar —below— follows the button live with this and without this it stays the color
         of the load. The TOP stripe has no ribbon that moves it: it remains frozen until reload,
         also at the site of the pattern author. It is handled by the `?theme=` that the button
         writes to the address, which makes the reload a path that preserves the theme. Outside of
         iOS the ribbons do not exist: `landing.module.css` turns them off except under
         `@supports (-webkit-touch-callout: none)`.
        */}
      <div key={`frame-tint-${colorTheme}`} aria-hidden="true">
        <div className={styles.frameTintTop} />
        <div className={styles.frameTintBottom} />
      </div>
      <a className={styles.skipLink} href="#main">
        {text.skip}
      </a>

      <header className={styles.nav}>
        <div className={styles.navInner}>
          <Link className={styles.brand} href="/" aria-label={text.nav.brand}>
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG oficial suministrado */}
            <img src="/assets/brand/panoma.svg" alt="" width={32} height={32} />
            <span>panoma</span>
          </Link>
          <nav className={styles.navLinks} aria-label={text.nav.sections}>
            <a href="#memory">{text.nav.memory}</a>
            <a href="#agents">{text.nav.agents}</a>
            <a href="#local">{text.nav.local}</a>
            <Link href="/docs">Docs</Link>
          </nav>
          <div className={styles.navActions}>
            <button
              className={styles.themeSwitch}
              type="button"
              onClick={toggleTheme}
              aria-label={nextThemeLabel}
              title={nextThemeLabel}
              data-next-theme={nextTheme}
            >
              {nextTheme === "dark" ? (
                <PiMoonBold aria-hidden />
              ) : nextTheme === "gold" ? (
                <PiDiamondBold aria-hidden />
              ) : (
                <PiSunBold aria-hidden />
              )}
            </button>
            {/*
               In the bar and not in the footer: buried four thousand pixels down the scroll, a
               language selector is like not having one. The bar is fixed, so it can be found from
               any point on the page.
              */}
            {/*
               A segmented control and not two separate words: with plain text it doesn't read as
               something that can be tapped, and the active state was confused with emphasis. The
               sliding pill is a single element behind the two buttons —not a background per
               button—, so the change is animated instead of jumping.
              */}
            <div
              className={styles.langSwitch}
              role="group"
              aria-label={text.nav.language}
              data-lang={locale}
            >
              <span className={styles.langThumb} aria-hidden />
              <button
                type="button"
                onClick={() => switchTo("en")}
                aria-pressed={locale === "en"}
                lang="en"
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => switchTo("es")}
                aria-pressed={locale === "es"}
                lang="es"
              >
                ES
              </button>
            </div>
            <a
              className={styles.navCta}
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              aria-label={text.nav.github}
            >
              <PiGithubLogoBold aria-hidden />
              <span className={styles.navCtaLabel}>{text.nav.github}</span>
            </a>
          </div>
        </div>
      </header>

      {/*
         The entry lives in the root of the page. If it were inside the hero, the `isolation` of
         that block would enclose its z-index, and when reloading with the scroll restored further
         down, the subsequent sections could be painted on top.
        */}
      <HeroEntrance skipLabel={text.skipIntro} />

      {/*
         `tabIndex={-1}` because without it, in Safari, the anchor moves the scroll but not the
         focus: the keyboard stays in the bar and the link seems to do nothing. It is the same
         convention as the `<main id="app-main">` of the catalog.
        */}
      <main id="main" tabIndex={-1}>
        {/*
           The first fold.
           The hands deliver their particles to the P and the swarm of this block collects it in
           the same place. From there the mark remains formed on the proposal and the two entry
           paths to the product; it no longer becomes subsequent messages.
          */}
        <section className={styles.hero}>
          <LandingSwarm
            key={colorTheme}
            shapes={HERO_SHAPES}
            order={HERO_ORDER}
            delay={4450}
            stayFormed
          />

          {/*
             The semantic headline remains here for search engines and screen readers. The visual
             opening no longer repeats it: the particles are reserved for the brand.
            */}
          <h1 className={styles.srOnly}>{text.hero.h1}</h1>

          <div className={styles.heroStage}>
            {/*
               The tower is assembled but turned off. The logo of the fold is now lifted by the
               particles, so showing both at the same time would be saying the same thing twice —
               but the piece is finished and tuned, and comes back whenever needed: its own
               section, a project sheet, a video. It is not erased because of that.
              */}
            <div className={styles.heroTowerParked} aria-hidden>
              <LandingTower label={text.tower.aria} />
            </div>

            {/* The stage of the swarm. Intentionally empty: the canvas fills it. */}
            <div className={styles.phraseSlot} data-swarm-slot aria-hidden />

            <p className={styles.heroQualifier}>{text.hero.copy}</p>

            {/* The two paths, each one copyable: try and open the catalog. */}
            <HeroCommands text={text} />
          </div>
        </section>

        {/*
           The question goes BEFORE the demo on purpose: first you feel the void —stopwatch
           running—, and the next section puts a face to the answer.
          */}
        <DoorSection text={text} locale={locale} />

        {/*
           And here it is seen. The question is answered with a sentence and demonstrated with ten
           seconds: the two sections share a dark band because they are the same moment.
          */}
        <FilmSection text={text} />

        <MemorySection text={text} />

        <TwinSection text={text} colorTheme={colorTheme} />


        {/*
           The obvious substitute.
           Without this section, the visitor thinks "I already have the list of GitHub repos" and
           leaves. The argument is not explained: it is measured. The right column is longer, and
           what sticks out is exactly what you never uploaded.
          */}
        <section className={styles.rival} id="encuentra" aria-labelledby="rival-title">
          <div className={styles.rivalInner}>
            <p className={styles.eyebrow}>{text.rival.eyebrow}</p>
            <h2 className={styles.duo} id="rival-title">
              {text.rival.line1}
              <span>{text.rival.line2}</span>
            </h2>

            {/*
               The two lists go row by row, not one longer than the other. When comparing by
               height, you had to count lines to see the point; now each project occupies the same
               line on both sides, and where GitHub has nothing, the gap remains open at the exact
               height of the missing project.
               And the difference stops being how many: it is how much each row knows. On the
               left, a name and a date. On the right, the icon, the health score, the stack, and
               the warning of what is not backed up — everything a repo listing cannot know
               because it has not looked inside the folder.
              */}
            <div className={styles.rivalGrid}>
              <article className={styles.rivalCard}>
                <p className={styles.rivalCount}>
                  <strong>{PROJECTS.filter((project) => !project.onlyLocal).length}</strong>
                  <span>{text.rival.countGithub}</span>
                </p>
                <header>{text.rival.githubHead}</header>
                <ul>
                  {PROJECTS.map((project) =>
                    project.onlyLocal ? (
                      <li className={styles.rivalGap} key={project.id}>
                        <span aria-hidden />
                        <small>{text.rival.missing}</small>
                      </li>
                    ) : (
                      <li key={project.id}>
                        <span className={styles.rivalPlain}>{project.folder}</span>
                        <small>{sinceLabel(project.since, text)}</small>
                      </li>
                    ),
                  )}
                </ul>
              </article>

              <article className={`${styles.rivalCard} ${styles.rivalCardFull}`}>
                <p className={`${styles.rivalCount} ${styles.rivalCountWin}`}>
                  <strong>{PROJECTS.length}</strong>
                  <span>{text.rival.countPanoma}</span>
                </p>
                <header>{text.rival.panomaHead}</header>
                <ul>
                  {PROJECTS.map((project) => {
                    const Icon = project.icon;
                    return (
                      <li key={project.id} className={project.onlyLocal ? styles.rivalOnlyLocal : ""}>
                        <span className={styles.rivalRich}>
                          {Icon ? (
                            <i style={{ background: project.tone, color: project.glyph }}>
                              <Icon aria-hidden />
                            </i>
                          ) : (
                            <i className={styles.rivalIconEmpty}>
                              <HiOutlineCodeBracketSquare aria-hidden />
                            </i>
                          )}
                          <b>{project.name}</b>
                          <em>{project.stack}</em>
                        </span>
                        {project.onlyLocal ? (
                          <small className={styles.rivalWarn}>
                            <HiOutlineCloudArrowUp aria-hidden />
                            {text.rival.neverLeft}
                          </small>
                        ) : (
                          <small className={`${styles.rivalHealth} ${project.health < 55 ? styles.rivalHealthBad : project.health < 70 ? styles.rivalHealthWarn : ""}`}>
                            {project.health}
                          </small>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </article>
            </div>
            {/* What is only known after having opened the folder. */}
            <p className={styles.knows}>
              {text.rival.knows.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </p>

            <div className={styles.verdict}>
              <strong>{PROJECTS.filter((project) => project.onlyLocal).length}</strong>
              <p>
                {text.rival.verdict}
                <span>{text.rival.verdictNote}</span>
              </p>
            </div>
            <p className={styles.rivalFoot}>{text.rival.foot}</p>
          </div>
        </section>


        {/*
           What really makes the bridge with the agents.
           Before this used to sell «Panoma knows which agent wrote each commit», which is
           accounting: it's good to know it and it doesn't keep anyone awake at night. The real
           pain is different and is stated in the description of `panoma_context` on the server
           MCP: «call it when starting work, BEFORE exploring the files». An agent who opens a
           project that has been idle for three months knows nothing — not what is broken, nor
           what was left halfway, nor what the previous agent decided and why— and the worst part
           is that half of that is not in the code, so no matter how much they read, they won't
           find it.
           That's what is sold here: the startup. And as a bonus, that two agents stop stepping on
           each other, which is the only one of the six tools that solves a problem that only
           appears when you have more than one.
          */}
        <section className={styles.hands} id="agents" aria-label={text.hands.aria}>
          <div className={styles.handsInner}>
            <p className={styles.productMarker}>
              <span>{text.sectionFrame.feature}</span>
              <b>{text.sectionFrame.agents}</b>
            </p>
            {/*
               The model that tells everything without reading anything: the active .md —not just
               one— with two crossed-out statements and its verdict, and below the Panoma block.
               The file is the channel: each agent opens theirs; the lie is the same.
              */}
            <AgentDocBlock text={text} />

            <ul className={styles.gains}>
              {text.hands.gains.map((gain) => (
                <li key={gain.title}>
                  <strong>{gain.title}</strong>
                  <span>{mdInline(gain.body)}</span>
                </li>
              ))}
            </ul>

            <p className={styles.handsNote}>{text.hands.note}</p>
          </div>
        </section>


        {/*
           The closure: where all of this lives.
           Here was 'Free, open source and without an account,' which at the time was false: the
           tree still said 'all rights reserved' and the AGPL was a pending decision. Today half
           open source is already true — AGPL-3.0-only, with the LICENSE at the root — but the
           phrase does not return: what replaces it is stronger precisely because it is narrower —
           and because the reader can break it in thirty seconds.
           And then it answered two questions at once: the headline said how to start and the list
           said where your data ends up. Now the section has a single subject, the headline gives
           the reason on which the four promises hang —there is no server— and each promise has
           its mechanism. 'Your credentials stay where they are' without explaining why it is a
           'trust me,' and that is the only thing that cannot be asked for right when talking
           about credentials.
          */}
        <section className={styles.close} id="local">
          <div className={styles.closeInner}>
            <p className={styles.productMarker} data-foundation>
              <span>{text.sectionFrame.foundation}</span>
              <b>{text.sectionFrame.local}</b>
            </p>
            <p className={styles.eyebrow}>{text.close.eyebrow}</p>
            <h2 className={styles.duo}>
              {text.close.line1}
              <span>{text.close.line2}</span>
            </h2>

            <ul className={styles.custody}>
              {text.close.truths.map((truth) => (
                <li key={truth.claim} data-exit={truth.leaves ? "" : undefined}>
                  <p className={styles.custodyLocus}>
                    <span>{truth.locus}</span>
                    <em>{truth.leaves ? text.close.leaves : text.close.stays}</em>
                  </p>
                  <b>{truth.claim}</b>
                  <span>{truth.why}</span>
                  <code>{truth.path}</code>
                </li>
              ))}
            </ul>

            <p className={styles.dare}>
              <span>{text.close.dareKicker}</span>
              <strong>{text.close.dare}</strong>
              <code>{text.close.darePath}</code>
            </p>

            {/*
               The climax: the question from the beginning, now with an answer. It closes the
               frame that the stopwatch opened — and underneath, the command that opens the door.
              */}
            <p className={styles.closeDoorQuestion}>{text.close.doorQuestion}</p>
            <p className={styles.closeDoorAnswer}>{text.close.doorAnswer}</p>

            {/*
               Starting with a folder lives here and not in the headline: it's what happens right
               after pasting the command.
               Watch out for what it promises: `panoma scan` without `--save` only prints to the
               terminal (apps/cli/src/index.ts:228), and the watcher lives on the web server. This
               paragraph said "Panoma stays watching it" attached to the command, and whoever
               pasted it would get neither catalog nor surveillance. Now separate the two things:
               what the command gives, and that the catalog comes afterward.
               The thing about «`panoma up` only knows how to lift within the monorepo» is no
               longer true since the catalog travels in the npm package — `scan` itself concludes
               with «The next step is the app: npx Panoma up». That this page does not offer that
               command anywhere is a pending decision, not a limitation.
              */}
            <p className={styles.closeGrow}>{text.close.grow}</p>

            <CommandPair text={text} />
          </div>
        </section>
      </main>

      {/*
         The closure is the product, not an image of the product. The diagram originates from the
         same pieces that Panoma arranges, and the legal/commercial links participate in the
         composition instead of being pushed to a rear strip.
        */}
      <footer className={styles.footer}>
        <section className={styles.finale} aria-labelledby="finale-title">
          <div className={styles.finaleCopy}>
            <p className={styles.finaleEyebrow}>{text.footer.finaleEyebrow}</p>
            <h2 id="finale-title" className={styles.finaleTitle}>
              <span>{text.footer.finaleLine1}</span>
              <span>{text.footer.finaleLine2}</span>
            </h2>
          </div>

          <FinaleSystem text={text} />

          <div className={styles.finaleUtilities}>
            <nav className={styles.finaleNav} aria-label={text.footer.product}>
              <b>{text.footer.product}</b>
              <a href="#memory">{text.nav.memory}</a>
              <a href="#agents">{text.nav.agents}</a>
              <a href="#local">{text.nav.local}</a>
              <Link href="/docs">Docs</Link>
            </nav>

            <div className={`${styles.commands} ${styles.finaleCommand}`}>
              <CommandBox
                command={COMMAND_UP}
                label={text.footer.finaleFolderCommand}
                text={text}
              />
              <CommandBox
                command={COMMAND_ALL}
                label={text.footer.finaleAllCommand}
                text={text}
                quiet
              />
            </div>

            <nav className={styles.finaleNav} aria-label={text.footer.more}>
              <b>{text.footer.more}</b>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                {text.nav.github}
              </a>
              <button type="button" onClick={copy}>
                {copied ? text.copy.done : text.copy.aria}
              </button>
            </nav>
          </div>

          <div className={styles.footerBar}>
            <span className={styles.footerNote}>{text.footer.built}</span>
            <span>
              {/*
                 The ownership of the house. Four were purchased —`.ai`, `.dev`, `.io`, `.app` —
                 and the one in use is this one; the others exist so that no one else uses them.
                 It has to say the same here, on the card that is shared, and in the `homepage` of
                 the npm package: three places, one domain.
                */}
              <b>panoma.ai</b> · © {new Date().getFullYear()} · {text.footer.rights}
            </span>
            <span className={styles.footLang}>{text.footer.lang}</span>
          </div>
        </section>
      </footer>

      {/*
         The invitation to follow on X, and here is the last one of the tree for a mechanical
         reason: its sentinel is the last thing you encounter going down, so reaching it IS having
         read the page. Placing it higher would interrupt mid-reading, which is what everyone
         complains about with this pattern — and what Google penalizes on mobile.
        */}
      <FollowInvite
        locale={locale}
        copy={text}
        newsletterOn={newsletterOn}
      />
    </div>
  );
}

const DOC_CYCLE_MS = 2400;

/**
 * The headline, the names, and the mockup of the .md.
 *
 * Each agent opens a different file. If the owner stays in CLAUDE.md, the section is read as an
 * extra of Claude. Here the name rotates —and the entire list is in view— so that it can be
 * understood at a glance, without waiting for the cycle.
 */
/**
 * The question with a timer.
 *
 * “What is the entrance to your projects?” creates a void: the reader tries to answer and cannot.
 * The stopwatch turns that void into a number that rises in front of the visitor — and after five seconds
 * it freezes and the answer appears. Without a conclusion it would be a trick; with a conclusion
 * it is the plot made into theater.
 *
 * The four springs, in order of appearance and each with its reason:
 *
 * 1. The task ("answer it out loud") calls for an attempt. It is the difference between looking at
 * someone else's number and discovering your own gap: the second is indisputable, because you have
 * just checked it yourself.
 * 2. Measurement turns discomfort into a figure. The diffuse is forgotten; the measured is
 * counted.
 * 3. The verdict —«SEARCHING FOR ANSWER» for five seconds, «NO ANSWER» in the end— closes the
 * sample as an instrument would, not an advertisement.
 * 4. The punchline names what has just happened: a super-intelligent door. The hero’s foot has
 * already promised intelligence, so this is not the debut of the label but its fulfillment — and a
 * fulfillment placed after the experience stays; placed before, it is debated.
 *
 * It starts when the section enters the screen (PC or mobile, same observer), it pauses if you
 * leave before time, and once the empty space is measured it remains measured: going through the
 * section again does not restart the function.
 */
function DoorSection({ text, locale }: { text: LandingCopy; locale: Locale }) {
  const hostRef = useRef<HTMLElement | null>(null);
  const [tenths, setTenths] = useState(0);
  const [settled, setSettled] = useState(false);
  const shownRef = useRef(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let raf = 0;
    let inView = false;
    let running = false;
    let done = false;
    let elapsed = 0; // ms measured up to the last pause
    let startedAt = 0;

    const tick = (now: number) => {
      if (!running || done) return;
      const total = Math.min(5000, elapsed + (now - startedAt));
      const show = Math.floor(total / 100);
      /*
        It repaints only when the tenth changes: sixty setState per second to move a digit ten
        times would be paying six times too much.
       */
      if (show !== shownRef.current) {
        shownRef.current = show;
        setTenths(show);
      }
      if (total >= 5000) {
        done = true;
        setSettled(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    /*
      The clock measures WATCHED time, not elapsed time: it pauses when the screen section goes
      out and also when the tab is hidden. Without the second, switching tabs freezes the rAF with
      the clock "running" and when returning the count would jump suddenly to five — a stopwatch
      that jumps confesses to being a lie.
     */
    const sync = () => {
      const shouldRun = inView && !document.hidden && !done;
      if (shouldRun && !running) {
        running = true;
        startedAt = performance.now();
        raf = requestAnimationFrame(tick);
      } else if (!shouldRun && running) {
        running = false;
        elapsed += performance.now() - startedAt;
        cancelAnimationFrame(raf);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        /*
          Being 'inside' is fulfilled in two ways, and both are necessary.
          Half a section in view is fine on a laptop. On a mobile, the section is taller than the
          screen; that 50% never fits, and the clock would never start: what matters there is how
          much screen it occupies. And looking at `isIntersecting` by itself —which is what there
          was— left the clock running with the section almost out of view, because for that, a
          single pixel peeking is enough.
         */
        inView =
          entry.intersectionRatio >= 0.5 ||
          entry.intersectionRect.height >= window.innerHeight * 0.5;
        sync();
      },
      { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1] },
    );
    observer.observe(host);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      cancelAnimationFrame(raf);
    };
  }, []);

  /*
    The comma is Spanish and the period English — a stopwatch with the foreign separator is read
    as a template without translation.
   */
  const seconds = (tenths / 10).toFixed(1);
  const shown = locale === "es" ? seconds.replace(".", ",") : seconds;

  return (
    <section
      className={styles.door}
      ref={hostRef}
      data-settled={settled || undefined}
      aria-label={text.door.eyebrow}
    >
      <span className={styles.doorTrustImage} aria-hidden />
      <span className={styles.doorEdges} aria-hidden>
        <svg
          className={styles.doorCurve}
          viewBox="0 0 1440 48"
          preserveAspectRatio="none"
          focusable="false"
        >
          <defs>
            <path
              id="door-bottom-curve-path"
              d="M0 10 C300 10 360 34 720 34 C1080 34 1140 10 1440 10"
            />
          </defs>
          <path
            className={styles.doorCurvePaper}
            d="M0 10 C300 10 360 34 720 34 C1080 34 1140 10 1440 10 L1440 48 L0 48 Z"
          />
          <use className={styles.doorCurveLine} href="#door-bottom-curve-path" />
        </svg>
      </span>
      <div className={styles.doorInner}>
        <p className={styles.eyebrow}>{text.door.eyebrow}</p>
        <h2 className={styles.doorQuestion}>{text.door.question}</h2>
        <p className={styles.doorHint} data-off={settled || undefined}>
          {text.door.hint}
        </p>

        {/*
           The device remains outside the entire accessibility tree: a figure that changes ten
           times per second turns any screen reader into a chime. Whoever does not see the
           measurement encounters the response directly, which is what the section had to say.
          */}
        <div className={styles.doorMeter} data-settled={settled || undefined} aria-hidden>
          <p className={styles.doorTimer}>
            <span>{shown}</span>
            <i>s</i>
          </p>
          <div className={styles.doorTrack}>
            <span
              className={styles.doorFill}
              style={{ transform: `scaleX(${Math.min(1, tenths / 50)})` }}
            />
          </div>
          <p className={styles.doorState}>
            {settled ? text.door.settledLabel : text.door.counting}
          </p>
        </div>

        {/* Always in the flow: the answer appears where its gap already was, it doesn't push. */}
        <div className={styles.doorReveal} data-on={settled || undefined}>
          <p className={styles.doorLead}>{text.door.answerLead}</p>
          <p className={styles.doorAnswer}>{text.door.answer}</p>
          <p className={styles.doorKicker}>{text.door.kicker}</p>
        </div>
      </div>
    </section>
  );
}

/*
  The ten seconds that teach the answer.
  The section above tells what Panoma is; this one teaches it, which is the only thing a paragraph
  doesn't know how to do. The video is not an ornament: it tells the same story as the page in its
  order —today's album, the command, the door, all the projects, what's inside you— and that's why
  underneath goes a power strip with those sections. The power strip does three things at once: it
  puts into words what you're watching, it says how much is left, and it lets any section jump by
  pressing it. A silent video without it is a beautiful animation from which no one takes
  anything.
  The start and stop are handled by the same rules as the door timer, for the same reasons: it
  plays when you are looking and stops when you leave the screen or hide the tab — a video running
  in a background tab consumes battery and reaches the end without anyone seeing it. With two
  additions that were not needed there:
  - Whoever presses pause is in charge. Re-entering the section does not start it again; that’s
  what the button is for, which is never hidden (the rule requires it: something that moves by
  itself for more than five seconds has to be able to be stopped).
  - At the end, it stays on the last frame —the project's card, which is where we want to leave
  the reader— and the button changes to say 'watch it again.' It doesn't rewind by itself: going
  back at once through the forty folders undoes what the video has just told.
 */
function FilmSection({ text }: { text: LandingCopy }) {
  const hostRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  /* What is pressed by hand wins over what the scroll decides. */
  const heldRef = useRef(false);
  const warmedRef = useRef(false);

  const [shown, setShown] = useState(false);
  const [beat, setBeat] = useState(0);
  /*
    The strip filler is written by hand on the node, not by state.
    It progresses in two hundred steps per section —that fineness is what makes the bar not look
    fake— and as a state that meant hundreds of repaints of this section by reproduction, each one
    reconciling the seven buttons, their fillings, and the seven phrases, to move a `transform`
    from a single node. The section (`beat`) does stay in state: it changes seven times and truly
    changes the tree —which button is marked, which phrase is read—. The filling does not change
    the tree, it changes a number.
   */
  const fills = useRef<(HTMLSpanElement | null)[]>([]);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [reduced, setReduced] = useState(false);
  /* The command that is typed on the laptop screen while it is blank. */
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState(0);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  /*
    The entrance. Once it is turned on it does not turn off: going up and down again does not have
    to repeat the animation, which the second time does not count anything.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  /*
    The video is prepared when the section is a fold away. `metadata` brings duration and the
    first state without yet turning on the 1080p decoder or filling buffers while the visitor
    remains in the hero. Upon truly entering, the playback logic raises the preload to `auto`.
    To those who asked not to use data, nothing is downloaded: they keep the `preload="none"` from
    the HTML and the poster, and the video only plays if they press it.
   */
  useEffect(() => {
    const link = (
      navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
    ).connection;
    if (link?.saveData) return;
    if (link?.effectiveType && ["slow-2g", "2g", "3g"].includes(link.effectiveType)) return;

    const host = hostRef.current;
    if (!host) return;

    const warm = () => {
      const video = videoRef.current;
      if (!video || warmedRef.current) return;
      warmedRef.current = true;
      video.preload = "metadata";
      video.load();
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        warm();
        observer.disconnect();
      },
      { threshold: 0, rootMargin: "700px 0px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  /*
    The power strip clock. It goes with `requestAnimationFrame` and not with `timeupdate` because
    that event arrives four times per second: the bar would advance in quarter-second jumps, which
    is exactly what gives away a fake bar. It only redraws when the segment or step of the bar
    changes, and the loop only runs while the video is running.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let raf = 0;
    let lastBeat = -1;
    let lastFill = -1;
    let lastOn: boolean | null = null;
    let lastTyped = -1;

    const read = () => {
      const at = video.currentTime;
      const index = filmBeatAt(at);
      const fill = Math.round(filmBeatProgress(at, index) * 200) / 200;
      if (index !== lastBeat) {
        lastBeat = index;
        setBeat(index);
      }
      if (fill !== lastFill) {
        lastFill = fill;
        paintRail(index, fill);
      }
      /*
        The command comes from the same clock as the power strip: a separate timer becomes
        unsynchronized as soon as someone pauses or skips a section.
       */
      const on = filmTypingOn(at);
      if (on !== lastOn) {
        lastOn = on;
        setTyping(on);
      }
      const chars = filmTypedChars(at, COMMAND_UP.length);
      if (chars !== lastTyped) {
        lastTyped = chars;
        setTyped(chars);
      }
    };
    const loop = () => {
      read();
      raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      setPlaying(true);
      setEnded(false);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      read();
    };
    const onEnded = () => {
      setPlaying(false);
      setEnded(true);
      cancelAnimationFrame(raf);
      read();
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("seeked", read);
    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("seeked", read);
    };
  }, []);

  /*
    What is being looked at is reproduced. The double path — medium high or half screen — is the
    same as the door: on a mobile, the section does not fit entirely and that 50% never reaches.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let inView = false;
    const sync = () => {
      const video = videoRef.current;
      if (!video) return;
      const shouldRun = inView && !document.hidden && !reduced && !heldRef.current;
      if (shouldRun) {
        if (video.paused && !video.ended) {
          video.preload = "auto";
          warmedRef.current = true;
          /*
            If the browser says no —there are those who block all playback by itself—, the button
            is still there: nothing is lost, you just press it.
           */
          void video.play().catch(() => undefined);
        }
      } else if (!video.paused) {
        video.pause();
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        inView =
          entry.intersectionRatio >= 0.5 ||
          entry.intersectionRect.height >= window.innerHeight * 0.5;
        sync();
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    observer.observe(host);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [reduced]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      heldRef.current = true;
      video.pause();
      return;
    }
    heldRef.current = false;
    if (video.ended || video.currentTime >= FILM_DURATION - 0.05) video.currentTime = 0;
    video.preload = "auto";
    warmedRef.current = true;
    void video.play().catch(() => undefined);
  };

  /*
    The entire strip at once: the past sections full, the current one up to whatever is due, the
    remaining ones at zero. It is called from the video clock and from the section jump.
   */
  const paintRail = (index: number, fill: number) => {
    fills.current.forEach((node, at) => {
      if (!node) return;
      node.style.transform = `scaleX(${at < index ? 1 : at === index ? fill : 0})`;
    });
  };

  const jump = (index: number) => {
    const video = videoRef.current;
    if (!video) return;
    heldRef.current = false;
    video.preload = "auto";
    warmedRef.current = true;
    video.currentTime = FILM_BEATS[index] ?? 0;
    setBeat(index);
    /*
      By hand and that's it, not in the render that's coming: jumping back you could see a frame
      with the bar of the old section still full.
     */
    paintRail(index, 0);
    setEnded(false);
    void video.play().catch(() => undefined);
  };

  const ToggleIcon = ended ? PiArrowCounterClockwiseBold : playing ? PiPauseFill : PiPlayFill;
  const toggleLabel = ended ? text.film.replay : playing ? text.film.pause : text.film.play;

  return (
    <section className={styles.film} ref={hostRef} aria-label={text.film.aria}>
      <div className={styles.filmInner}>
        <p className={styles.eyebrow}>{text.film.eyebrow}</p>

        <figure className={styles.filmStage} data-on={shown || undefined}>
          <div className={styles.filmFrame}>
            {/*
               The video goes without `aria-label`: the name of this is given by the section, and
               repeating the same phrase twice in a row on a screen reader is noise. What happens
               inside is told by the strip below, which is text.
              */}
            <video
              ref={videoRef}
              className={styles.filmVideo}
              width={1920}
              height={1080}
              poster="/assets/landing/panoma-poster.jpg"
              preload="none"
              muted
              playsInline
            >
              <source src="/assets/landing/panoma.mp4" type="video/mp4" />
            </video>

            {/* He looks whole while standing and retreats —without leaving— while running. */}
            {/*
               The command, written in a terminal on the laptop screen.
               It goes here and not painted inside the video for three reasons: it's real text —it
               reads clearly at any resolution and doesn't pixelate with h264—, it's the SAME
               `COMMAND_UP` that is copied in the headline, so it can't get outdated, and if the
               command changes, you don't have to re-edit the clip.
               The box is in frame percentages because that is where the laptop screen falls:
               measured over the blank frames, x from 23.6% to 75.9% and from 7.1% to 66.3% in
               height. It holds as long as the video remains 16:9 and the frame does too —which is
               the case— because then `cover` does not crop anything and the percentage always
               falls in the same place in the image.
              */}
            <div className={styles.filmScreen} data-on={typing || undefined} aria-hidden>
              <div className={styles.filmTerm}>
                <div className={styles.filmTermBar}>
                  <span className={styles.filmTermDots}>
                    <i />
                    <i />
                    <i />
                  </span>
                  {/*
                     The prefix goes in its own element because in a narrow bar it is removed and
                     only the path remains: the reason is in `.filmTermTitleBrand`.
                    */}
                  <span className={styles.filmTermTitle}>
                    <span className={styles.filmTermTitleBrand}>panoma · </span>~/Desktop
                  </span>
                </div>
                <div className={styles.filmTermBody}>
                  <code
                    className={styles.filmCommand}
                    style={{ "--film-ch": String(COMMAND_UP.length + 3) } as CSSProperties}
                  >
                    <b>$</b> {COMMAND_UP.slice(0, reduced ? COMMAND_UP.length : typed)}
                    <i className={styles.filmCaret} />
                  </code>
                </div>
              </div>
            </div>

            <button
              type="button"
              className={styles.filmToggle}
              data-on={!playing || undefined}
              onClick={toggle}
            >
              <ToggleIcon aria-hidden />
              <span>{toggleLabel}</span>
            </button>
          </div>

          <figcaption className={styles.filmScript}>
            <ol className={styles.filmRail}>
              {text.film.beats.map((item, index) => (
                <li key={item.label}>
                  <button
                    type="button"
                    className={styles.filmBeat}
                    data-on={index === beat || undefined}
                    data-done={index < beat || undefined}
                    onClick={() => jump(index)}
                  >
                    <span className={styles.filmBeatTrack} aria-hidden>
                      <span
                        className={styles.filmBeatFill}
                        ref={(node) => {
                          fills.current[index] = node;
                        }}
                        /*
                          The starting value when mounting and at each section change; from there,
                          the video clock takes over, which writes on top.
                         */
                        style={{ transform: `scaleX(${index < beat ? 1 : 0})` }}
                      />
                    </span>
                    <span className={styles.filmBeatLabel}>{item.label}</span>
                    {/*
                       Whoever doesn't watch the video gets here what happens in each section: it
                       is the caption of the image and, while at it, the name of the button that
                       jumps to it.
                      */}
                    <span className={styles.srOnly}>{item.line}</span>
                  </button>
                </li>
              ))}
            </ol>

            {/*
               All the sentences occupy the same cell: the box measures by the tallest and the
               foot does not jump each time the section changes.
              */}
            <span className={styles.filmLines} aria-hidden>
              {text.film.beats.map((item, index) => (
                <span
                  key={item.label}
                  className={styles.filmLine}
                  data-on={index === beat || undefined}
                >
                  {item.line}
                </span>
              ))}
            </span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

/*
  The central brain is Panoma. From it arises the living memory of each project, and the network
  grows asymmetrically; the sequence explains continuity without turning the section into a
  technical diagram.
 */
const MEMORY_NETWORK_BRAIN =
  "M252,124a60.14,60.14,0,0,0-32-53.08,52,52,0,0,0-92-32.11A52,52,0,0,0,36,70.92a60,60,0,0,0,0,106.14,52,52,0,0,0,92,32.13,52,52,0,0,0,92-32.13A60.05,60.05,0,0,0,252,124ZM88,204a28,28,0,0,1-26.85-20.07c1,0,1.89.07,2.85.07h8a12,12,0,0,0,0-24H64A36,36,0,0,1,52,90.05a12,12,0,0,0,8-11.32V72a28,28,0,0,1,56,0v60.18a51.61,51.61,0,0,0-7.2-3.85,12,12,0,1,0-9.6,22A28,28,0,0,1,88,204Zm104-44h-8a12,12,0,0,0,0,24h8c1,0,1.9,0,2.85-.07a28,28,0,1,1-38-33.61,12,12,0,1,0-9.6-22,51.61,51.61,0,0,0-7.2,3.85V72a28,28,0,0,1,56,0v6.73a12,12,0,0,0,8,11.32,36,36,0,0,1-12,70Zm16-44a12,12,0,0,1-12,12,40,40,0,0,1-40-40V84a12,12,0,0,1,24,0v4a16,16,0,0,0,16,16A12,12,0,0,1,208,116ZM100,88a40,40,0,0,1-40,40,12,12,0,0,1,0-24A16,16,0,0,0,76,88V84a12,12,0,0,1,24,0Z";

const MEMORY_NETWORK_PARTICLES = Array.from({ length: 96 }, (_, index) => {
  const angle = index * 2.399963;
  const shell = index % 4;
  const radiusX = 158 + shell * 70 + ((index * 17) % 19);
  const radiusY = 68 + shell * 31 + ((index * 11) % 13);
  return {
    cx: Number((450 + Math.cos(angle) * radiusX).toFixed(3)),
    cy: Number((210 + Math.sin(angle) * radiusY).toFixed(3)),
    r: Number((0.64 + (index % 4) * 0.28).toFixed(2)),
    delay: `${-(index % 18) * 0.37}s`,
  };
});

const MEMORY_NETWORK_BRANCHES = [
  { d: "M377 181 C322 157 267 137 205 120", delay: "1.35s" },
  { d: "M385 232 C340 255 290 285 245 315", delay: "2.02s" },
  { d: "M516 169 C565 135 625 112 690 105", delay: "2.69s" },
  { d: "M530 207 C600 210 670 230 730 260", delay: "3.36s" },
  { d: "M510 250 C535 285 562 315 590 340", delay: "4.03s" },
] as const;

const LANDING_AGENTS = [
  { id: "claude-cli", label: "Claude Code" },
  { id: "codex-cli", label: "Codex" },
  { id: "cursor-agent", label: "Cursor" },
] as const;

type MemoryNetworkPoint = { x: number; y: number };

const MEMORY_CORE_CLEARANCE = { x: 450, y: 210, rx: 205, ry: 155 } as const;

function keepMemoryCoreClear(point: MemoryNetworkPoint): MemoryNetworkPoint {
  const dx = point.x - MEMORY_CORE_CLEARANCE.x;
  const dy = point.y - MEMORY_CORE_CLEARANCE.y;
  const distance = Math.hypot(dx / MEMORY_CORE_CLEARANCE.rx, dy / MEMORY_CORE_CLEARANCE.ry);
  if (distance >= 1.08) return point;
  if (distance < 0.001) {
    return { x: MEMORY_CORE_CLEARANCE.x, y: MEMORY_CORE_CLEARANCE.y - MEMORY_CORE_CLEARANCE.ry * 1.08 };
  }
  const scale = 1.08 / distance;
  return {
    x: Number((MEMORY_CORE_CLEARANCE.x + dx * scale).toFixed(2)),
    y: Number((MEMORY_CORE_CLEARANCE.y + dy * scale).toFixed(2)),
  };
}

const MEMORY_NETWORK_NODES = [
  { x: 205, y: 120, scale: 0.43, rotate: -12, delay: "2.06s" },
  { x: 245, y: 315, scale: 0.47, rotate: 8, delay: "2.73s" },
  { x: 690, y: 105, scale: 0.45, rotate: 11, delay: "3.4s" },
  { x: 730, y: 260, scale: 0.4, rotate: -8, delay: "4.07s" },
  { x: 590, y: 340, scale: 0.42, rotate: 13, delay: "4.74s" },
] as const;

function memoryAgentTrack(anchors: readonly MemoryNetworkPoint[]) {
  const samples = 5;
  const count = anchors.length;
  const track = anchors.flatMap((point, index) => {
    const previous = anchors[(index - 1 + count) % count] ?? point;
    const next = anchors[(index + 1) % count] ?? point;
    const afterNext = anchors[(index + 2) % count] ?? next;
    return Array.from({ length: samples }, (_, sample) => {
      const t = sample / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      const interpolate = (p0: number, p1: number, p2: number, p3: number) =>
        0.5 *
        (2 * p1 +
          (-p0 + p2) * t +
          (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
          (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
      return keepMemoryCoreClear({
        x: Number(interpolate(previous.x, point.x, next.x, afterNext.x).toFixed(2)),
        y: Number(interpolate(previous.y, point.y, next.y, afterNext.y).toFixed(2)),
      });
    });
  });
  return [...track, track[0] ?? { x: 450, y: 10 }];
}

/*
  They do not share an orbit. Each path alternates outer corridors, changes in radius and
  direction; Catmull–Rom smooths the flight and `keepMemoryCoreClear` turns the brain of Panoma
  into an exclusion zone that no frame can invade.
 */
const MEMORY_AGENT_TRACKS = {
  claude: memoryAgentTrack([
    { x: 35, y: 240 },
    { x: 120, y: 55 },
    { x: 350, y: 20 },
    { x: 560, y: 60 },
    { x: 845, y: 80 },
    { x: 820, y: 320 },
    { x: 610, y: 420 },
    { x: 390, y: 440 },
    { x: 135, y: 405 },
    { x: 80, y: 285 },
  ]),
  codex: memoryAgentTrack([
    { x: 450, y: 15 },
    { x: 735, y: 50 },
    { x: 850, y: 210 },
    { x: 860, y: 335 },
    { x: 790, y: 420 },
    { x: 455, y: 400 },
    { x: 250, y: 420 },
    { x: 45, y: 340 },
    { x: 80, y: 110 },
    { x: 300, y: 65 },
  ]),
  cursor: memoryAgentTrack([
    { x: 865, y: 235 },
    { x: 760, y: 65 },
    { x: 540, y: 25 },
    { x: 300, y: 45 },
    { x: 75, y: 45 },
    { x: 35, y: 300 },
    { x: 240, y: 410 },
    { x: 500, y: 440 },
    { x: 720, y: 420 },
    { x: 850, y: 390 },
  ]),
} as const;

function memoryAgentRoute(
  source: MemoryNetworkPoint,
  target: MemoryNetworkPoint,
  bend: number,
) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const controlX = (source.x + target.x) / 2 - (dy / length) * bend;
  const controlY = (source.y + target.y) / 2 + (dx / length) * bend;
  return `M${source.x} ${source.y} Q${controlX.toFixed(2)} ${controlY.toFixed(2)} ${target.x} ${target.y}`;
}

function nearestMemoryProject(source: MemoryNetworkPoint): MemoryNetworkPoint {
  const nearest = MEMORY_NETWORK_NODES.reduce((best, candidate) => {
    const bestDistance = Math.hypot(best.x - source.x, best.y - source.y);
    const candidateDistance = Math.hypot(candidate.x - source.x, candidate.y - source.y);
    return candidateDistance < bestDistance ? candidate : best;
  });
  return { x: nearest.x, y: nearest.y };
}

/*
  The agents arrive after the five memories, they fly along independent routes and change their
  connection to the nearest project. Each tool ends up going through the five memories without
  being assigned to a fixed place.
 */
const MEMORY_NETWORK_AGENTS = [
  {
    ...LANDING_AGENTS[0],
    enterX: "-72px",
    enterY: "0px",
    delay: "5.9s",
    routeDelay: "6.52s",
    pulsePhase: "0s",
    duration: "31s",
    phase: "-2s",
    restIndex: 0,
    bend: -14,
    track: MEMORY_AGENT_TRACKS.claude,
  },
  {
    ...LANDING_AGENTS[1],
    enterX: "0px",
    enterY: "-62px",
    delay: "6.12s",
    routeDelay: "6.74s",
    pulsePhase: "-1.6s",
    duration: "35s",
    phase: "-12s",
    restIndex: 16,
    bend: 16,
    track: MEMORY_AGENT_TRACKS.codex,
  },
  {
    ...LANDING_AGENTS[2],
    enterX: "72px",
    enterY: "0px",
    delay: "6.34s",
    routeDelay: "6.96s",
    pulsePhase: "-3.2s",
    duration: "27s",
    phase: "-18s",
    restIndex: 32,
    bend: -10,
    track: MEMORY_AGENT_TRACKS.cursor,
  },
] as const;

function MemorySection({ text }: { text: LandingCopy }) {
  const hostRef = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShown(true);
        observer.disconnect();
      },
      { threshold: 0.16, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      className={styles.memory}
      id="memory"
      ref={hostRef}
      data-on={shown || undefined}
      aria-labelledby="memory-title"
    >
      <div className={styles.memoryInner}>
        <header className={styles.memoryCopy}>
          <p className={`${styles.productMarker} ${styles.featureMarkerCentered}`}>
            <span>{text.sectionFrame.feature}</span>
            <b>{text.sectionFrame.memory}</b>
          </p>
          <h2 className={styles.featureTitle} id="memory-title">
            <span>{text.memory.line1}</span>
            <span>{text.memory.line2}</span>
          </h2>
          <p className={styles.memoryLead}>{text.memory.lead}</p>
          <Link className={styles.featureDocsLink} href="/docs#memory">
            {text.memory.docs}
          </Link>
        </header>

        <div className={styles.memoryVisual} aria-hidden>
          <svg className={styles.memoryNetwork} viewBox="0 0 900 460">
            <defs>
              <pattern id="memory-network-dots" width="5.8" height="5.8" patternUnits="userSpaceOnUse">
                <circle cx="1.15" cy="1.15" r="0.72" fill="currentColor" />
                <circle cx="4.75" cy="4.2" r="0.34" fill="currentColor" opacity="0.42" />
              </pattern>
              <radialGradient id="memory-network-core" cx="50%" cy="50%" r="50%">
                <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
                <stop offset="0.62" stopColor="currentColor" stopOpacity="0.06" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </radialGradient>
              <g id="memory-network-brain">
                <path className={styles.memoryNetworkBase} d={MEMORY_NETWORK_BRAIN} />
                <path className={styles.memoryNetworkMatter} d={MEMORY_NETWORK_BRAIN} />
                <path className={styles.memoryNetworkContour} d={MEMORY_NETWORK_BRAIN} />
                <g className={styles.memoryNetworkSignals}>
                  <path d="M66 74 C86 91 88 112 72 131 C63 143 70 160 90 176" />
                  <path d="M190 74 C170 91 168 112 184 131 C193 143 186 160 166 176" />
                  <path d="M94 119 C111 105 145 105 162 119" />
                  <path d="M128 49 V207" />
                </g>
              </g>
            </defs>

            <ellipse className={styles.memoryNetworkHalo} cx="450" cy="210" rx="340" ry="170" />

            <g className={styles.memoryNetworkDust}>
              {MEMORY_NETWORK_PARTICLES.map((particle, index) => (
                <circle
                  cx={particle.cx}
                  cy={particle.cy}
                  r={particle.r}
                  key={index}
                  style={{ "--memory-delay": particle.delay } as CSSProperties}
                />
              ))}
            </g>

            <g className={styles.memoryNetworkBranches}>
              {MEMORY_NETWORK_BRANCHES.map((link) => (
                <g
                  key={link.d}
                  style={{ "--network-delay": link.delay } as CSSProperties}
                >
                  <path className={styles.memoryNetworkBranchGlow} d={link.d} pathLength="1" />
                  <path className={styles.memoryNetworkBranch} d={link.d} pathLength="1" />
                  <path className={styles.memoryNetworkFlow} d={link.d} pathLength="1" />
                </g>
              ))}
            </g>

            <g className={`${styles.memoryNetworkBranches} ${styles.memoryNetworkAgentRoutes}`}>
              {MEMORY_NETWORK_AGENTS.map((agent) => {
                const rest = agent.track[agent.restIndex] ?? agent.track[0];
                const track = reduced ? (rest ? [rest] : []) : agent.track;
                const frames = track.map((point) =>
                  memoryAgentRoute(point, nearestMemoryProject(point), agent.bend),
                );
                const route = frames[0] ?? "";
                const motion = () => (
                  <animate
                    attributeName="d"
                    values={frames.join(";")}
                    dur={agent.duration}
                    begin={agent.phase}
                    repeatCount="indefinite"
                  />
                );
                return (
                  <g
                    key={agent.id}
                    style={
                      {
                        "--network-delay": agent.routeDelay,
                        "--route-phase": agent.pulsePhase,
                      } as CSSProperties
                    }
                  >
                    <path className={styles.memoryNetworkBranchGlow} d={route} pathLength="1">
                      {!reduced && motion()}
                    </path>
                    <path className={styles.memoryNetworkBranch} d={route} pathLength="1">
                      {!reduced && motion()}
                    </path>
                    <path className={styles.memoryNetworkFlow} d={route} pathLength="1">
                      {!reduced && motion()}
                    </path>
                  </g>
                );
              })}
            </g>

            <g className={styles.memoryNetworkAgents}>
              {MEMORY_NETWORK_AGENTS.map((agent) => {
                const AgentIcon = BRAND_ICONS[agent.id];
                const rest = agent.track[agent.restIndex] ?? agent.track[0];
                return (
                  <g transform={`translate(${rest?.x ?? 450} ${rest?.y ?? 25})`} key={agent.id}>
                    {!reduced ? (
                      <animateTransform
                        attributeName="transform"
                        type="translate"
                        values={agent.track.map((point) => `${point.x} ${point.y}`).join(";")}
                        dur={agent.duration}
                        begin={agent.phase}
                        repeatCount="indefinite"
                      />
                    ) : null}
                    <g
                      className={styles.memoryNetworkAgent}
                      data-memory-agent={agent.id}
                      style={
                        {
                          "--agent-delay": agent.delay,
                          "--agent-enter-x": agent.enterX,
                          "--agent-enter-y": agent.enterY,
                        } as CSSProperties
                      }
                    >
                      <foreignObject className={styles.memoryNetworkAgentObject} x="-23" y="-23" width="46" height="46">
                        <span className={styles.memoryNetworkAgentIcon}>
                          {AgentIcon ? <AgentIcon aria-hidden /> : null}
                        </span>
                      </foreignObject>
                      <text className={styles.memoryNetworkAgentLabel} y="36">
                        {agent.label}
                      </text>
                    </g>
                  </g>
                );
              })}
            </g>

            <g className={styles.memoryNetworkNodes}>
              {MEMORY_NETWORK_NODES.map((node, index) => (
                <g transform={`translate(${node.x} ${node.y})`} key={text.memory.projects[index]}>
                  <g
                    className={styles.memoryNetworkNode}
                    data-memory-node={index + 1}
                    style={{ "--network-delay": node.delay } as CSSProperties}
                  >
                    <circle className={styles.memoryNetworkNodeHalo} r="68" />
                    <g className={styles.memoryNetworkBrain}>
                      <g transform={`rotate(${node.rotate}) scale(${node.scale}) translate(-128 -128)`}>
                        <use href="#memory-network-brain" />
                      </g>
                    </g>
                    <text className={styles.memoryNetworkLabel} dy="0.35em">
                      {text.memory.projects[index]}
                    </text>
                  </g>
                </g>
              ))}
            </g>

            <g transform="translate(450 210)">
              <g
                className={styles.memoryNetworkPanoma}
                data-memory-core="panoma"
                style={{ "--network-delay": "0.12s" } as CSSProperties}
              >
                <circle className={styles.memoryNetworkPanomaHalo} r="118" />
                <g className={styles.memoryNetworkBrain}>
                  <g transform="scale(0.84) translate(-128 -128)">
                    <use href="#memory-network-brain" />
                  </g>
                </g>
                <g className={styles.memoryNetworkMark} transform="scale(0.19) translate(-540 -515)">
                  <path d={MARK.ink} />
                  <path d={MARK.paneLT} />
                  <path d={MARK.paneLB} />
                  <path d={MARK.paneCT} />
                  <path d={MARK.paneCB} />
                  <path d={MARK.paneRT} />
                  <path d={MARK.paneRB} />
                </g>
              </g>
            </g>
          </svg>
        </div>

        <p className={styles.srOnly}>{text.memory.aria}</p>
      </div>
    </section>
  );
}

/*
  Twin is not explained with a screen inventory: a correction comes in, the criterion is saved,
  and the three agents receive the same. The male reference figure and the new female figure
  maintain their transparency; the female one already comes reflected in the asset so that both
  look at the core without duplicating visual transformations in the browser.
 */
type TwinFloatParticle = {
  alpha: number;
  drift: number;
  orbitX: number;
  orbitY: number;
  phase: number;
  radius: number;
  side: -1 | 1;
  speed: number;
  u: number;
  v: number;
};

type TwinTextParticle = {
  delay: number;
  radius: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
};

type TwinPoint = { x: number; y: number };

/*
  The moving dust does not try to redraw the characters: the two WebPs remain the visual truth.
  These two canvases only add depth — one behind and one in front —, they form TASTE.MD from the
  fingertips and replace the three immobile lines with paths of dots. The clock pauses off-screen
  so as not to sacrifice the landing optimizations.
 */
function TwinParticleField({
  active,
  label,
  colorTheme,
}: {
  active: boolean;
  label: string;
  colorTheme: LandingColorTheme;
}) {
  const backRef = useRef<HTMLCanvasElement | null>(null);
  const frontRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const back = backRef.current;
    const front = frontRef.current;
    /*
      The reference box is what the canvas **is stretched against**, and that is not the section.
      Both canvases are `position: absolute; inset: 0`, so their box is that of their positioned
      predecessor —`.twinInner`—, not that of `<section class="twin">`. Here the section was
      measured: the buffer was sized with `760px` in height while the element occupied `570px`,
      and the browser stretched what was painted to fill. Everything this field calculates in
      coordinates of DOM —the particles that draw the file name and the rays of the core to the
      three agents— landed offset in relation to the elements it has to match.
      Measured on 27-Aug-2026 at 375×812: section 375×760, canvas 351×570, that is **a 33%
      vertical error** and 7% horizontal. At 1440×900 the height matched by coincidence —both 760—
      and there was only 9% width left, which is a symmetrical shrinking and that’s why it looked
      almost right. The error was not from mobile; on mobile is where it is noticeable.
      `offsetParent` and not `closest(".twinInner")` on purpose: `inset: 0` and `offsetParent`
      resolve against **the same** rule —the nearest positioned predecessor—, so if tomorrow
      someone moves the `position: relative` out of place, the measure moves with the canvas
      instead of staying pointing to a box that is no longer its own.
     */
    const host = front?.offsetParent;
    if (!back || !front || !host || !active) return;

    const backContext = back.getContext("2d");
    const frontContext = front.getContext("2d");
    if (!backContext || !frontContext) return;
    const particleInk = landingThemeValue(host, LANDING_THEME_VAR.ink);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let seed = 0x51f15e;
    const random = () => {
      seed += 0x6d2b79f5;
      let value = seed;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    const range = (min: number, max: number) => min + (max - min) * random();
    const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
    const ease = (value: number) => 1 - Math.pow(1 - clamp(value), 3);

    let width = 0;
    let height = 0;
    let ratio = 1;
    let leftRect: DOMRect | null = null;
    let rightRect: DOMRect | null = null;
    let textParticles: TwinTextParticle[] = [];
    let rayTargets: TwinPoint[] = [];
    let rayOrigin: TwinPoint = { x: 0, y: 0 };

    const makeFloaters = (count: number, foreground: boolean): TwinFloatParticle[] =>
      Array.from({ length: count }, (_, index) => ({
        alpha: range(foreground ? 0.18 : 0.11, foreground ? 0.52 : 0.32),
        drift: range(foreground ? 28 : 18, foreground ? 94 : 58),
        orbitX: range(foreground ? 6 : 20, foreground ? 22 : 72),
        orbitY: range(foreground ? 4 : 10, foreground ? 15 : 42),
        phase: random(),
        radius: range(foreground ? 0.58 : 0.42, foreground ? 1.9 : 1.42),
        side: index % 2 === 0 ? -1 : 1,
        speed: foreground ? range(0.055, 0.12) : range(0.022, 0.06),
        u: random(),
        v: random(),
      }));

    let backParticles: TwinFloatParticle[] = [];
    let frontParticles: TwinFloatParticle[] = [];

    const localRect = (element: Element | null) => {
      if (!element) return null;
      const hostRect = host.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      return new DOMRect(
        rect.left - hostRect.left,
        rect.top - hostRect.top,
        rect.width,
        rect.height,
      );
    };

    const localFigureRect = (element: Element | null) => {
      if (!(element instanceof HTMLElement) || !(element.offsetParent instanceof HTMLElement)) {
        return localRect(element);
      }
      const hostRect = host.getBoundingClientRect();
      const parentRect = element.offsetParent.getBoundingClientRect();
      return new DOMRect(
        parentRect.left - hostRect.left + element.offsetLeft,
        parentRect.top - hostRect.top + element.offsetTop,
        element.offsetWidth,
        element.offsetHeight,
      );
    };

    const sampleText = (center: TwinPoint, font: string) => {
      const source = document.createElement("canvas");
      /*
        At thirteen pixels, the stroke of the mono was practically as wide as a particle and
        TASTE.MD ended up looking like a blot. The wider bitmap allows for a large word and leaves
        enough air for the point to be read as a dot.
       */
      source.width = width < 520 ? 174 : 256;
      source.height = width < 520 ? 44 : 64;
      const context = source.getContext("2d", { willReadFrequently: true });
      if (!context) return [];
      context.clearRect(0, 0, source.width, source.height);
      context.fillStyle = particleInk;
      context.font = font;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label, source.width / 2, source.height / 2);
      const pixels = context.getImageData(0, 0, source.width, source.height).data;
      const step = 1;
      const targets: TwinPoint[] = [];
      for (let y = 0; y < source.height; y += step) {
        for (let x = 0; x < source.width; x += step) {
          /*
            The faintest edge of the antialias is discarded: those points did not complete the
            stroke, they only blurred the space between the E, the period, and MD.
           */
          if (pixels[(y * source.width + x) * 4 + 3]! < 128) continue;
          targets.push({
            x: center.x + x - source.width / 2,
            y: center.y + y - source.height / 2,
          });
        }
      }
      source.width = 1;
      source.height = 1;
      return targets;
    };

    const resize = () => {
      const hostRect = host.getBoundingClientRect();
      width = Math.max(1, Math.round(hostRect.width));
      height = Math.max(1, Math.round(hostRect.height));
      ratio = canvasPixelRatio(
        width,
        height,
        window.devicePixelRatio || 1,
        1.25,
        1_600_000,
      );
      for (const canvas of [back, front]) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      backContext.setTransform(ratio, 0, 0, ratio, 0, 0);
      frontContext.setTransform(ratio, 0, 0, ratio, 0, 0);

      leftRect = localFigureRect(host.querySelector('[data-twin-figure="left"]'));
      rightRect = localFigureRect(host.querySelector('[data-twin-figure="right"]'));
      const coreText = host.querySelector("[data-twin-core] strong");
      const coreStyle = coreText ? window.getComputedStyle(coreText) : null;
      const leftFinger = leftRect
        ? { x: leftRect.x + leftRect.width * 0.988, y: leftRect.y + leftRect.height * 0.54 }
        : { x: width * 0.46, y: height * 0.66 };
      const rightFinger = rightRect
        ? { x: rightRect.x + rightRect.width * 0.012, y: rightRect.y + rightRect.height * 0.54 }
        : { x: width * 0.54, y: height * 0.66 };
      const center = {
        x: (leftFinger.x + rightFinger.x) / 2,
        y: (leftFinger.y + rightFinger.y) / 2,
      };
      rayOrigin = { x: center.x, y: center.y + (width < 520 ? 10 : 14) };
      rayTargets = Array.from(host.querySelectorAll("[data-twin-agent]"))
        .map((agent) => localRect(agent))
        .filter((rect): rect is DOMRect => Boolean(rect))
        .map((rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height - 29 }));

      const compact = width < 520;
      const fontSize = compact ? 16 : 21;
      const fontFamily = coreStyle?.fontFamily || "ui-monospace, monospace";
      const targets = sampleText(center, `700 ${fontSize}px ${fontFamily}`);
      /*
        Two points fit within the stroke. In the previous version, the diameter could exceed the
        thickness of the letter, exactly the flaw that made the small phrases of the main swarm
        illegible.
       */
      const radius = compact ? { min: 0.38, max: 0.58 } : { min: 0.45, max: 0.7 };
      textParticles = targets.map((target, index) => {
        const origin = index % 2 === 0 ? leftFinger : rightFinger;
        return {
          delay: range(0, 0.24),
          radius: range(radius.min, radius.max),
          startX: origin.x + range(-3.5, 3.5),
          startY: origin.y + range(-3.5, 3.5),
          targetX: target.x,
          targetY: target.y,
        };
      });

      backParticles = makeFloaters(compact ? 180 : 420, false);
      frontParticles = makeFloaters(compact ? 160 : 300, true);
    };

    const drawFloaters = (
      context: CanvasRenderingContext2D,
      particles: TwinFloatParticle[],
      seconds: number,
      reveal: number,
      foreground: boolean,
    ) => {
      if (!leftRect || !rightRect) return;
      context.fillStyle = particleInk;
      for (const particle of particles) {
        const rect = particle.side < 0 ? leftRect : rightRect;
        const cycle = (particle.phase + seconds * particle.speed) % 1;
        const angle = (
          particle.phase + seconds * particle.speed * (particle.side < 0 ? 1 : -1)
        ) * Math.PI * 2;
        const outerU = particle.side < 0
          ? 0.03 + particle.u * 0.58
          : 0.39 + particle.u * 0.58;
        const baseX = rect.x + rect.width * outerU;
        const baseY = rect.y + rect.height * (0.08 + particle.v * 0.84);
        const orbitX = Math.cos(angle) * particle.orbitX;
        const orbitY = Math.sin(angle) * particle.orbitY;
        const x = foreground
          ? baseX + particle.side * cycle * particle.drift + orbitX
          : baseX + orbitX + particle.side * Math.sin(angle * 0.47) * particle.drift * 0.22;
        const y = foreground
          ? baseY + orbitY + (cycle - 0.5) * 18
          : baseY + orbitY + Math.cos(angle * 0.63) * 5;
        const life = foreground
          ? Math.sin(Math.PI * cycle)
          : 0.62 + Math.sin(angle + particle.phase * 5) * 0.38;
        const alpha = particle.alpha * reveal * (0.34 + life * 0.66);
        context.beginPath();
        context.globalAlpha = alpha;
        context.arc(x, y, particle.radius * (foreground ? 1 : 0.82), 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
    };

    const drawText = (elapsed: number) => {
      const raw = clamp((elapsed - 1550) / 1500);
      frontContext.fillStyle = particleInk;
      for (const particle of textParticles) {
        const progress = ease(clamp((raw - particle.delay) / (1 - particle.delay)));
        if (progress <= 0) continue;
        const arc = Math.sin(Math.PI * progress) * (particle.startX < width / 2 ? -12 : 12);
        const settled = progress > 0.985;
        const x = particle.startX + (particle.targetX - particle.startX) * progress;
        const y = particle.startY + (particle.targetY - particle.startY) * progress + arc;
        const jitter = settled ? Math.sin(elapsed * 0.002 + particle.targetX) * 0.35 : 0;
        frontContext.beginPath();
        frontContext.globalAlpha = 0.22 + progress * 0.78;
        frontContext.arc(x + jitter, y, particle.radius, 0, Math.PI * 2);
        frontContext.fill();
      }
      frontContext.globalAlpha = 1;
    };

    const drawRays = (elapsed: number) => {
      const reveal = ease(clamp((elapsed - 3000) / 1050));
      if (reveal <= 0) return;
      frontContext.fillStyle = particleInk;
      rayTargets.forEach((target, pathIndex) => {
        const distance = Math.hypot(target.x - rayOrigin.x, target.y - rayOrigin.y);
        const count = Math.max(8, Math.round(distance / 8));
        const visible = Math.max(1, Math.floor(count * reveal));
        for (let index = 0; index < visible; index += 1) {
          const progress = index / Math.max(1, count - 1);
          const wave = 0.2 + 0.22 * Math.sin(elapsed * 0.003 + index * 0.72 + pathIndex);
          const x = rayOrigin.x + (target.x - rayOrigin.x) * progress;
          const y = rayOrigin.y + (target.y - rayOrigin.y) * progress;
          frontContext.beginPath();
          frontContext.globalAlpha = Math.max(0.08, wave);
          frontContext.arc(x, y, 0.78, 0, Math.PI * 2);
          frontContext.fill();
        }
        for (let pulse = 0; pulse < 3; pulse += 1) {
          const progress = ((elapsed * 0.00019 + pathIndex * 0.17 + pulse / 3) % 1) * reveal;
          const x = rayOrigin.x + (target.x - rayOrigin.x) * progress;
          const y = rayOrigin.y + (target.y - rayOrigin.y) * progress;
          frontContext.beginPath();
          frontContext.globalAlpha = 0.82;
          frontContext.arc(x, y, 1.55, 0, Math.PI * 2);
          frontContext.fill();
        }
      });
      frontContext.globalAlpha = 1;
    };

    let raf = 0;
    let accumulated = 0;
    let startedAt = 0;
    let running = false;
    let inView = true;
    let allocated = false;
    let releaseTimer = 0;

    const draw = (now: number) => {
      const elapsed = reduced ? 5600 : accumulated + (now - startedAt);
      const seconds = elapsed / 1000;
      const reveal = ease(clamp(elapsed / 1250));
      backContext.clearRect(0, 0, width, height);
      frontContext.clearRect(0, 0, width, height);
      drawFloaters(backContext, backParticles, seconds, reveal, false);
      drawFloaters(frontContext, frontParticles, seconds, reveal, true);
      drawText(elapsed);
      drawRays(elapsed);
      if (!reduced && running) raf = window.requestAnimationFrame(draw);
    };

    const sync = () => {
      if (inView && !document.hidden && !allocated) {
        resize();
        allocated = true;
        if (reduced) draw(performance.now());
      }
      const shouldRun = !reduced && inView && !document.hidden;
      if (shouldRun && !running) {
        running = true;
        startedAt = performance.now();
        raf = window.requestAnimationFrame(draw);
      } else if (!shouldRun && running) {
        accumulated += performance.now() - startedAt;
        running = false;
        window.cancelAnimationFrame(raf);
      }
    };

    resize();
    allocated = true;

    const release = () => {
      releaseTimer = 0;
      if (inView && !document.hidden) return;
      window.cancelAnimationFrame(raf);
      running = false;
      back.width = 1;
      back.height = 1;
      front.width = 1;
      front.height = 1;
      backParticles = [];
      frontParticles = [];
      textParticles = [];
      rayTargets = [];
      leftRect = null;
      rightRect = null;
      allocated = false;
    };

    const scheduleRelease = () => {
      window.clearTimeout(releaseTimer);
      releaseTimer = window.setTimeout(release, 2400);
    };

    const resizeObserver = new ResizeObserver(() => {
      if (!allocated || !inView) return;
      resize();
      if (reduced || !running) draw(performance.now());
    });
    const viewObserver = new IntersectionObserver(
      ([entry]) => {
        inView = Boolean(entry?.isIntersecting);
        if (inView) window.clearTimeout(releaseTimer);
        else scheduleRelease();
        sync();
      },
      { threshold: 0.04 },
    );
    resizeObserver.observe(host);
    viewObserver.observe(host);
    const onVisibility = () => {
      if (document.hidden) scheduleRelease();
      else window.clearTimeout(releaseTimer);
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (reduced) draw(performance.now());
    else sync();

    return () => {
      resizeObserver.disconnect();
      viewObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.cancelAnimationFrame(raf);
      window.clearTimeout(releaseTimer);
      back.width = 1;
      back.height = 1;
      front.width = 1;
      front.height = 1;
      backParticles = [];
      frontParticles = [];
      textParticles = [];
      rayTargets = [];
    };
  }, [active, label, colorTheme]);

  return (
    <>
      <canvas ref={backRef} className={`${styles.twinParticleCanvas} ${styles.twinParticlesBack}`} aria-hidden />
      <canvas ref={frontRef} className={`${styles.twinParticleCanvas} ${styles.twinParticlesFront}`} aria-hidden />
    </>
  );
}

function TwinSection({
  text,
  colorTheme,
}: {
  text: LandingCopy;
  colorTheme: LandingColorTheme;
}) {
  const hostRef = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShown(true);
        observer.disconnect();
      },
      { threshold: 0.42, rootMargin: "-8% 0px -12% 0px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      className={styles.twin}
      ref={hostRef}
      data-on={shown || undefined}
      aria-labelledby="twin-title"
    >
      <div className={styles.twinInner}>
        <TwinParticleField active={shown} label={text.twin.file} colorTheme={colorTheme} />

        <header className={styles.twinCopy}>
          <p className={`${styles.productMarker} ${styles.featureMarkerCentered}`}>
            <span>{text.sectionFrame.feature}</span>
            <b>{text.sectionFrame.twin}</b>
          </p>
          <h2 id="twin-title" className={styles.featureTitle}>
            <span>{text.twin.line1}</span>
            <span>{text.twin.line2}</span>
          </h2>
          <Link className={styles.featureDocsLink} href="/docs#twin">
            {text.twin.docs}
          </Link>
        </header>

        <div className={styles.twinFigures} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element -- decorativas y ya en webp; el optimizador no aporta */}
          <img
            className={`${styles.twinFigure} ${styles.twinFigureLeft}`}
            src="/assets/landing/twin-figure-left.webp"
            alt=""
            width={1448}
            height={1086}
            data-twin-figure="left"
            loading="lazy"
            decoding="async"
          />
          {/* eslint-disable-next-line @next/next/no-img-element -- la pareja de la de arriba */}
          <img
            className={`${styles.twinFigure} ${styles.twinFigureRight}`}
            src="/assets/landing/twin-figure-right.webp"
            alt=""
            width={1448}
            height={1086}
            data-twin-figure="right"
            loading="lazy"
            decoding="async"
          />
        </div>

        <div className={styles.twinCore} data-twin-core aria-hidden>
          <strong>{text.twin.file}</strong>
        </div>

        <div className={styles.twinAgentMap} aria-label={text.twin.agentsAria}>
          {LANDING_AGENTS.map((agent, index) => {
            const Icon = BRAND_ICONS[agent.id] ?? PiRobotBold;
            return (
              <span
                className={styles.twinAgent}
                key={agent.id}
                role="img"
                aria-label={agent.label}
                data-twin-agent
              >
                <i className={styles.twinRay} data-ray={index + 1} aria-hidden />
                <Icon aria-hidden />
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function AgentDocBlock({ text }: { text: LandingCopy }) {
  const files = text.hands.files;
  const [active, setActive] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [inView, setInView] = useState(false);
  const [reduced, setReduced] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(Boolean(entry?.isIntersecting)),
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (reduced || pinned || !inView) return;
    const timer = window.setInterval(() => {
      setActive((index) => (index + 1) % files.length);
    }, DOC_CYCLE_MS);
    return () => window.clearInterval(timer);
  }, [files.length, inView, pinned, reduced]);

  const current = files[active] ?? files[0]!;
  const longest = files.reduce((name, file) => (file.name.length > name.length ? file.name : name), "");

  const pick = (index: number) => {
    setActive(index);
    setPinned(true);
  };

  return (
    <div className={styles.agentLayout} ref={rootRef}>
      <h2 className={styles.duo}>
        <span className={styles.srOnly}>
          {text.hands.line1Aria} {text.hands.line2}
        </span>
        <span className={styles.duoInk} aria-hidden>
          {text.hands.line1Lead}
        </span>
        <span className={styles.fileReel} aria-hidden>
          <span className={styles.fileReelSizer}>{longest}</span>
          {files.map((file, index) => (
            <span
              key={file.name}
              className={index === active ? styles.fileReelOn : styles.fileReelOff}
            >
              {file.name}
            </span>
          ))}
        </span>
        <span className={styles.duoInk} aria-hidden>
          {text.hands.line1Tail}
        </span>
        <span aria-hidden>{text.hands.line2}</span>
      </h2>

      <div className={styles.docTabs} role="tablist" aria-label={text.hands.filesLabel}>
        {files.map((file, index) => (
          <button
            key={file.name}
            type="button"
            role="tab"
            aria-selected={index === active}
            className={styles.docTab}
            onClick={() => pick(index)}
          >
            {file.name}
          </button>
        ))}
      </div>
      <p className={styles.docTabAgent} aria-live="polite">
        {current.agent}
      </p>

      <div className={styles.mdCard} aria-label={text.hands.aria}>
        <p className={styles.mdHead}>
          <b>{current.name}</b>
          <span>{text.hands.file.meta}</span>
        </p>
        <div className={styles.mdBody}>
          {text.hands.file.rows.map((row) => (
            <p
              key={row.text}
              className={row.verdict ? `${styles.mdRow} ${styles.mdRowBad}` : styles.mdRow}
            >
              <span>{mdInline(row.text)}</span>
              {row.verdict && <em>{row.verdict}</em>}
            </p>
          ))}
          <div className={styles.mdBlock}>
            <span className={styles.mdBlockTag}>{text.hands.file.blockLabel}</span>
            <p className={styles.mdMarker}>{"<!-- panoma:begin -->"}</p>
            {text.hands.file.block.map((line) => (
              <p key={line} className={styles.mdRow}>
                <span>{mdInline(line)}</span>
              </p>
            ))}
            <p className={styles.mdMarker}>{"<!-- panoma:end -->"}</p>
          </div>
        </div>
        <p className={styles.mdFoot}>{text.hands.file.foot}</p>
      </div>
    </div>
  );
}
