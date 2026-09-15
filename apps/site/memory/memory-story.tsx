"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "../lib/locale";
import theme from "../landing/landing-theme.module.css";
import {
  ALLOW_FRAME,
  DECIDE_FRAME,
  MEMORY_COPY,
  PROPOSAL_FRAME,
  RULE_FRAME,
  type MemoryMode,
} from "./memory-copy";
import { MEMORY_PICS } from "./memory-pics";
import styles from "./memory.module.css";

/*
  `/memory`: one sentence of yours, followed down the page until it is a rule every agent
  receives — and checked. The sentence stays on screen (sticky) and changes state as the frames
  scroll past; each frame is one idea, one drawing, one or two paragraphs. Two gates wait for a
  hand, as the product does: the permission switch and the approve/discard pair.

  Two pickers: the language, which starts at the visitor's locale like the landing, and the
  register — plain or technical — which is the reader's own choice and starts plain. Both only
  change words: the frames, the drawings and the gates are the same.

  Motion is opt-in by scrolling: a frame that has been on screen once keeps its `on` class, so
  the transitions inside its drawing play once and stay. `prefers-reduced-motion` turns them off
  in the stylesheet. Nothing here waits on an observer to become visible: the first frame is `on`
  from the first render.
 */

type Decision = "approve" | "discard" | null;

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\[\[[^\]]+\]\]|(?<![\w])_[^_\n]+?_(?![\w]))/g;

/** The copy's small markup, rendered as elements and never as HTML. */
function renderInline(text: string): React.ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    if (!part) return null;
    if (part.startsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("[[")) return <span key={index} className={styles.term}>{part.slice(2, -2)}</span>;
    if (part.startsWith("_") && part.endsWith("_") && part.length > 2) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}

export interface MemoryStoryProps {
  locale: Locale;
  /**
   * Inside another page — `/docs`, whose Memory section opens with the walk before the
   * reference: no header, no title, one language (the host page's), the register picker kept,
   * the sentence stuck under the host's own bar.
   */
  embedded?: boolean;
}

export function MemoryStory({ locale, embedded = false }: MemoryStoryProps) {
  const [lang, setLang] = useState<Locale>(locale);
  const [mode, setMode] = useState<MemoryMode>("easy");
  const [allowed, setAllowed] = useState(false);
  const [decided, setDecided] = useState<Decision>(null);
  const [active, setActive] = useState(0);
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set([0]));
  const framesRef = useRef<HTMLDivElement>(null);

  const common = MEMORY_COPY[lang];
  const copy = common[mode];

  // Which frame the reader is on: the last one whose top has passed the upper half of the view.
  const measure = useCallback(() => {
    const root = framesRef.current;
    if (!root) return;
    const height = window.innerHeight;
    let current: number | null = null;
    root.querySelectorAll<HTMLElement>("[data-frame]").forEach((frame) => {
      const rect = frame.getBoundingClientRect();
      if (rect.top < height * 0.55 && rect.bottom > height * 0.25) current = Number(frame.dataset.frame);
    });
    if (current !== null) setActive(current);
  }, []);

  useEffect(() => {
    const root = framesRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const shown = entries.filter((entry) => entry.isIntersecting).map((entry) => Number((entry.target as HTMLElement).dataset.frame));
        if (shown.length) setSeen((previous) => { const next = new Set(previous); for (const index of shown) next.add(index); return next; });
        measure();
      },
      { threshold: [0, 0.2, 0.5, 0.8] },
    );
    root.querySelectorAll("[data-frame]").forEach((frame) => observer.observe(frame));
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => { raf = 0; measure(); });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { observer.disconnect(); window.removeEventListener("scroll", onScroll); if (raf) window.cancelAnimationFrame(raf); };
  }, [measure, lang, mode]);

  // The sentence's state while the active frame is on screen.
  const thread = useMemo(() => {
    const discarded = decided === "discard" && active >= DECIDE_FRAME;
    let label = copy.states[active] ?? "";
    if (active === ALLOW_FRAME && allowed) label = copy.stateAllowed;
    if (discarded) label = copy.stateDiscarded;
    return {
      sentence: active >= PROPOSAL_FRAME ? copy.proposalSentence : copy.sentence,
      label,
      rule: active >= RULE_FRAME && decided !== "discard",
      discarded,
    };
  }, [copy, active, allowed, decided]);

  return (
    <div className={`${embedded ? styles.embed : `${theme.theme} ${styles.page}`} ${mode === "tech" ? styles.tech : ""}`} data-theme="light" lang={lang}>
      <div className={styles.wrap}>
        {!embedded && (
          <header className={styles.top}>
            <Link className={styles.brand} href="/">panoma</Link>
            <div className={styles.seg} role="group" aria-label={lang === "es" ? "Idioma" : "Language"}>
              <button type="button" aria-pressed={lang === "es"} onClick={() => setLang("es")}>ES</button>
              <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
            </div>
          </header>
        )}

        <div className={styles.intro}>
          <div className={styles.kind}>
            <span id="memory-kind">{common.kindLabel}</span>
            <div className={styles.seg} role="group" aria-labelledby="memory-kind">
              <button type="button" aria-pressed={mode === "easy"} onClick={() => setMode("easy")}>{common.modeEasy}</button>
              <button type="button" aria-pressed={mode === "tech"} onClick={() => setMode("tech")}>{common.modeTech}</button>
            </div>
          </div>
          {!embedded && <h1>{copy.title}</h1>}
          {!embedded && <p>{copy.lede}</p>}
        </div>

        <div className={styles.story}>
          <aside className={styles.thread} aria-live="polite">
            <div className={styles.eyebrow}>{common.eyebrow}</div>
            <div className={`${styles.msg} ${thread.rule ? styles.rule : ""} ${thread.discarded ? styles.away : ""}`}>{thread.sentence}</div>
            <div className={`${styles.state} ${thread.rule ? styles.rule : ""}`}>{thread.label}</div>
          </aside>

          <div className={styles.frames} ref={framesRef}>
            {copy.frames.map((frame, index) => {
              const Pic = MEMORY_PICS[index]!;
              return (
                <section key={`${lang}-${mode}-${index}`} className={`${styles.frame} ${seen.has(index) ? styles.on : ""}`} data-frame={index}>
                  <div className={styles.pic}>
                    <Pic s={styles} labels={common.pics} allowed={allowed} />
                  </div>
                  <div>
                    <div className={styles.num}>{index + 1} / {copy.frames.length}</div>
                    <h2>{frame.h}</h2>
                    {frame.p.map((paragraph) => (
                      <p key={paragraph}>{renderInline(paragraph)}</p>
                    ))}
                    {frame.act === "allow" && (
                      <div>
                        <div className={styles.act}>
                          <button type="button" className={styles.switch} role="switch" aria-checked={allowed} onClick={() => setAllowed((value) => !value)}>
                            <span className={styles.knob} aria-hidden="true" />
                            <span>{allowed ? common.allowed : common.allow}</span>
                          </button>
                        </div>
                        <div className={styles.note}>{allowed ? copy.allowedNote : copy.allowNote}</div>
                      </div>
                    )}
                    {frame.act === "decide" && (
                      <div>
                        <div className={styles.act}>
                          <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => setDecided("approve")}>{common.approve}</button>
                          <button type="button" className={`${styles.btn} ${styles.quiet}`} onClick={() => setDecided("discard")}>{common.discard}</button>
                        </div>
                        <div className={styles.note}>{decided === "approve" ? copy.approvedNote : decided === "discard" ? copy.discardedNote : ""}</div>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        <section className={styles.end}>
          <h2>{copy.endTitle}</h2>
          <ul>
            {copy.end.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className={styles.names}>
            <h3>{copy.namesTitle}</h3>
            <dl>
              {copy.names.map(([term, what]) => (
                <div key={term} className={styles.name}>
                  <dt>{term}</dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </div>
          {!embedded && (
            <p className={styles.more}>
              <Link href="/docs#memory">{lang === "es" ? "La referencia, en inglés" : "The reference"}</Link>
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
