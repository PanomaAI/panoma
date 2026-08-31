"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PiGithubLogoBold } from "react-icons/pi";
import { LandingSwarm, type SwarmShape } from "../landing/landing-swarm";
import theme from "../landing/landing-theme.module.css";
import { copyCommand } from "./copy-command";
import { DOCS_COMMANDS, DOCS_COPY as text, DOCS_NAV, DOCS_SWARM } from "./docs-copy";
import { paintMarkAndDocs } from "./docs-hero";
import styles from "./docs.module.css";

/*
  Outside the component, and not written in the JSX, for the same reason as on the landing page:
  they are dependencies of the only effect of `LandingSwarm`, and an array written inside JSX is a
  new array on each render. This page re-renders every time the side index changes section — that
  is, while scrolling down — so the swarm was dismantled and mounted again at each segment: the
  mark would disappear and reform by itself, and each time it paid the full sampling. If they go
  back to JSX, the problem returns.
 */
const DOCS_SHAPES: SwarmShape[] = [{ kind: "draw", paint: paintMarkAndDocs }];
const DOCS_ORDER = [...DOCS_SWARM.order];

export function DocsExperience() {
  const [active, setActive] = useState<string>(DOCS_NAV[0]!.id);

  useEffect(() => {
    const nodes = DOCS_NAV.map((item) => document.getElementById(item.id)).filter(
      (node): node is HTMLElement => node !== null,
    );
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0.15, 0.4, 0.7] },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={`${theme.theme} ${styles.page}`} data-theme="light" lang="en">
      <a className={styles.skipLink} href="#docs-main">
        {text.skip}
      </a>

      <header className={styles.nav}>
        <div className={styles.navInner}>
          <div className={styles.brandBlock}>
            <Link className={styles.brand} href="/" aria-label="Panoma">
              {/* eslint-disable-next-line @next/next/no-img-element -- official mark */}
              <img src="/assets/brand/panoma.svg" alt="" width={28} height={28} />
              <span>{text.brand}</span>
            </Link>
            <h1 className={styles.heading}>{text.heading}</h1>
          </div>

          <nav className={styles.navLinks} aria-label="On this page">
            {DOCS_NAV.map((item) => (
              <a key={item.id} href={`#${item.id}`} aria-current={active === item.id ? "location" : undefined}>
                {item.label}
              </a>
            ))}
          </nav>

          <div className={styles.navActions}>
            <Link className={styles.textLink} href="/">
              {text.catalogLink}
            </Link>
            <a
              className={styles.navCta}
              href={text.githubUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={text.github}
            >
              <PiGithubLogoBold aria-hidden />
              <span>{text.github}</span>
            </a>
          </div>
        </div>
      </header>

      <section className={styles.hero} aria-label="Panoma docs">
        <LandingSwarm
          shapes={DOCS_SHAPES}
          order={DOCS_ORDER}
          stayFormed={DOCS_SWARM.stayFormed}
          scale={0.88}
        />
        <div className={styles.heroStage}>
          <div className={styles.phraseSlot} data-swarm-slot aria-hidden />
          <p className={styles.heroKicker}>{text.heroKicker}</p>
          <p className={styles.heroLine}>{text.heroLine}</p>
          <a className={styles.scroll} href="#start">
            {text.scroll}
          </a>
        </div>
      </section>

      <div className={styles.shell}>
        <nav className={styles.toc} aria-label="Sections">
          <p className={styles.tocLabel}>On this page</p>
          <ol>
            {DOCS_NAV.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} aria-current={active === item.id ? "location" : undefined}>
                  {item.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <main className={styles.main} id="docs-main" tabIndex={-1}>
          <section className={styles.section} id="start">
            <p className={styles.kicker}>{text.start.kicker}</p>
            <h2>{text.start.title}</h2>
            <p className={styles.lead}>{text.start.lead}</p>
            <CommandBlock command="npx panoma scan ~/Desktop" note={text.start.tryNote} />
            <CommandBlock command="npx panoma up" note={text.start.upNote} />
            <CommandBlock command={text.start.downCommand} note={text.start.downNote} quiet />
            <p className={styles.note}>{text.start.more}</p>
          </section>

          <section className={styles.section} id="catalog">
            <p className={styles.kicker}>{text.catalog.kicker}</p>
            <h2>{text.catalog.title}</h2>
            <p className={styles.lead}>{text.catalog.lead}</p>
            <p className={styles.note}>{text.catalog.hint}</p>
            <ul className={styles.viewList}>
              {text.catalog.views.map((view) => (
                <li key={view.hash}>
                  <code>{view.hash}</code>
                  <span>{view.label}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section} id="day">
            <p className={styles.kicker}>{text.day.kicker}</p>
            <h2>{text.day.title}</h2>
            <p className={styles.lead}>{text.day.lead}</p>
            <ul className={styles.extraList}>
              {text.day.commands.map((row) => (
                <li key={row.command}>
                  <CommandBlock command={row.command} note={row.note} quiet />
                </li>
              ))}
            </ul>
            <h3 className={styles.subhead}>{text.day.northTitle}</h3>
            <p className={styles.note}>{text.day.northBody}</p>
            <h3 className={styles.subhead}>{text.day.seenTitle}</h3>
            <p className={styles.note}>{text.day.seenBody}</p>
          </section>

          <section className={styles.section} id="agents">
            <p className={styles.kicker}>{text.agents.kicker}</p>
            <h2>{text.agents.title}</h2>
            <p className={styles.lead}>{text.agents.lead}</p>
            <h3 className={styles.subhead}>{text.agents.mcpTitle}</h3>
            <p className={styles.note}>{text.agents.mcpLead}</p>
            <div className={styles.rules}>
              {text.agents.why.map((card) => (
                <article key={card.title}>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>

            <h3 className={styles.subhead}>{text.agents.setupTitle}</h3>
            <p className={styles.note}>{text.agents.setupLead}</p>
            <ul className={styles.extraList}>
              {text.agents.setupSteps.map((step) => (
                <li key={step.command}>
                  <CommandBlock command={step.command} note={step.note} quiet />
                </li>
              ))}
            </ul>
            <p className={styles.note}>{text.agents.setupNote}</p>
            <p className={styles.note}>{text.agents.setupRestart}</p>

            <h3 className={styles.subhead}>{text.agents.toolsTitle}</h3>
            <ul className={styles.tools}>
              {text.agents.tools.map((tool) => (
                <li key={tool.name}>
                  <code>{tool.name}</code>
                  <span>{tool.why}</span>
                </li>
              ))}
            </ul>

            <h3 className={styles.subhead}>{text.agents.reportTitle}</h3>
            <p className={styles.note}>{text.agents.reportLead}</p>
            <ol className={styles.door}>
              {text.agents.reportOrder.map((part) => (
                <li key={part}>{part}</li>
              ))}
            </ol>
            <p className={styles.note}>{text.agents.reportNote}</p>
            <p className={styles.note}>{text.agents.reportLang}</p>

            <h3 className={styles.subhead}>{text.agents.safetyTitle}</h3>
            <p className={styles.note}>{text.agents.safetyBody}</p>
            <h3 className={styles.subhead}>{text.agents.mdTitle}</h3>
            <p className={styles.note}>{text.agents.mdLead}</p>
            <ul className={styles.extraList}>
              {text.agents.mdCommands.map((row) => (
                <li key={row.command}>
                  <CommandBlock command={row.command} note={row.note} quiet />
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section} id="memory">
            <p className={styles.kicker}>{text.memory.kicker}</p>
            <h2>{text.memory.title}</h2>
            <p className={styles.lead}>{text.memory.lead}</p>
            <p className={styles.note}>{text.memory.leadBody}</p>

            <h3 className={styles.subhead}>{text.memory.floorsTitle}</h3>
            <p className={styles.note}>{text.memory.floorsLead}</p>
            <div className={styles.rules}>
              {text.memory.floors.map((floor) => (
                <article key={floor.title}>
                  <h3>{floor.title}</h3>
                  <p>{floor.body}</p>
                </article>
              ))}
            </div>

            <h3 className={styles.subhead}>{text.memory.gateTitle}</h3>
            <p className={styles.note}>{text.memory.gateBody}</p>

            <h3 className={styles.subhead}>{text.memory.capsTitle}</h3>
            <p className={styles.note}>{text.memory.capsLead}</p>
            <ul className={styles.tools}>
              {text.memory.caps.map((cap) => (
                <li key={cap.label}>
                  <code>{cap.value}</code>
                  <span>{cap.label}</span>
                </li>
              ))}
            </ul>

            <h3 className={styles.subhead}>{text.memory.scaleTitle}</h3>
            <p className={styles.note}>{text.memory.scaleBody}</p>

            <h3 className={styles.subhead}>{text.memory.doubleTitle}</h3>
            <p className={styles.note}>{text.memory.doubleBody}</p>

            <h3 className={styles.subhead}>{text.memory.refusesTitle}</h3>
            <ol className={styles.door}>
              {text.memory.refuses.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ol>

            <h3 className={styles.subhead}>{text.memory.movingTitle}</h3>
            <p className={styles.note}>{text.memory.movingBody}</p>

            <h3 className={styles.subhead}>{text.memory.turnOnTitle}</h3>
            <p className={styles.note}>{text.memory.turnOnLead}</p>
            <ul className={styles.extraList}>
              {text.memory.turnOnSteps.map((step) => (
                <li key={step.command}>
                  <CommandBlock command={step.command} note={step.note} quiet />
                </li>
              ))}
            </ul>
            <p className={styles.note}>{text.memory.turnOnNote}</p>
          </section>

          <section className={styles.section} id="twin">
            <p className={styles.kicker}>{text.twin.kicker}</p>
            <h2>{text.twin.title}</h2>
            <p className={styles.lead}>{text.twin.lead}</p>
            <p className={styles.note}>{text.twin.leadBody}</p>

            <h3 className={styles.subhead}>{text.twin.pyramidTitle}</h3>
            <p className={styles.note}>{text.twin.pyramidLead}</p>
            <ul className={styles.viewList}>
              {text.twin.pyramid.map((floor) => (
                <li key={floor.step}>
                  <code>{floor.step}</code>
                  <span>{floor.detail}</span>
                </li>
              ))}
            </ul>

            <h3 className={styles.subhead}>{text.twin.floorsTitle}</h3>
            <p className={styles.note}>{text.twin.floorsBody}</p>

            <h3 className={styles.subhead}>{text.twin.criticsTitle}</h3>
            <div className={styles.rules}>
              {text.twin.critics.map((critic) => (
                <article key={critic.title}>
                  <h3>{critic.title}</h3>
                  <p>{critic.body}</p>
                </article>
              ))}
            </div>

            <h3 className={styles.subhead}>{text.twin.doubleTitle}</h3>
            <p className={styles.note}>{text.twin.doubleBody}</p>

            <h3 className={styles.subhead}>{text.twin.reachTitle}</h3>
            <p className={styles.note}>{text.twin.reachBody}</p>

            <h3 className={styles.subhead}>{text.twin.commandsTitle}</h3>
            <ul className={styles.extraList}>
              {text.twin.commands.map((row) => (
                <li key={row.command}>
                  <CommandBlock command={row.command} note={row.note} quiet />
                </li>
              ))}
            </ul>
            <p className={styles.note}>{text.twin.commandsNote}</p>
          </section>

          <section className={styles.section} id="maintain">
            <p className={styles.kicker}>{text.maintain.kicker}</p>
            <h2>{text.maintain.title}</h2>
            <p className={styles.lead}>{text.maintain.lead}</p>
            <ul className={styles.extraList}>
              {text.maintain.commands.map((row) => (
                <li key={row.command}>
                  <CommandBlock command={row.command} note={row.note} quiet />
                </li>
              ))}
            </ul>
            <h3 className={styles.subhead}>{text.maintain.isolationTitle}</h3>
            <p className={styles.note}>{text.maintain.isolationLead}</p>
            <div className={styles.rules}>
              {text.maintain.isolation.map((level) => (
                <article key={level.level}>
                  <h3>{level.level}</h3>
                  <p>{level.body}</p>
                </article>
              ))}
            </div>
            <h3 className={styles.subhead}>{text.maintain.verifiedTitle}</h3>
            <p className={styles.note}>{text.maintain.verifiedBody}</p>
          </section>

          <section className={styles.section} id="models">
            <p className={styles.kicker}>{text.models.kicker}</p>
            <h2>{text.models.title}</h2>
            <p className={styles.lead}>{text.models.lead}</p>
            <h3 className={styles.subhead}>{text.models.freeTitle}</h3>
            <p className={styles.note}>{text.models.freeBody}</p>
            <ul className={styles.extraList}>
              {text.models.commands.map((row) => (
                <li key={row.command}>
                  <CommandBlock command={row.command} note={row.note} quiet />
                </li>
              ))}
            </ul>
            <h3 className={styles.subhead}>{text.models.keyTitle}</h3>
            <p className={styles.note}>{text.models.keyBody}</p>
            <h3 className={styles.subhead}>{text.models.capsTitle}</h3>
            <p className={styles.note}>{text.models.capsLead}</p>
            <ul className={styles.tools}>
              {text.models.caps.map((cap) => (
                <li key={cap.name}>
                  <code>{cap.name}</code>
                  <span>
                    {cap.value} — {cap.what}
                  </span>
                </li>
              ))}
            </ul>
            <p className={styles.note}>{text.models.capsNote}</p>
          </section>

          <section className={styles.section} id="network">
            <p className={styles.kicker}>{text.network.kicker}</p>
            <h2>{text.network.title}</h2>
            <p className={styles.lead}>{text.network.lead}</p>
            <div className={styles.rules}>
              <article>
                <h3>{text.network.localTitle}</h3>
                <p>{text.network.localBody}</p>
              </article>
              <article>
                <h3>{text.network.openTitle}</h3>
                <p>{text.network.openBody}</p>
                <CommandBlock command={text.network.openCommand} />
              </article>
              <article>
                <h3>{text.network.twoKeysTitle}</h3>
                <p>{text.network.twoKeysBody}</p>
              </article>
              <article>
                <h3>{text.network.closeTitle}</h3>
                <p>{text.network.closeBody}</p>
                <CommandBlock command={text.network.closeCommand} quiet />
              </article>
              <article>
                <h3>{text.network.rotateTitle}</h3>
                <p>{text.network.rotateBody}</p>
                <CommandBlock command={text.network.rotateCommand} quiet />
              </article>
            </div>
            <h3 className={styles.subhead}>{text.network.rulesTitle}</h3>
            <ol className={styles.door}>
              {text.network.rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ol>
            <p className={styles.note}>{text.network.home}</p>
          </section>

          <section className={styles.section} id="commands">
            <p className={styles.kicker}>{text.commands.kicker}</p>
            <h2>{text.commands.title}</h2>
            <p className={styles.lead}>{text.commands.lead}</p>
            <ul className={styles.cards}>
              {DOCS_COMMANDS.map((block) => (
                <li key={block.command}>
                  <p className={styles.cardVerb}>{block.verb}</p>
                  <h3>{block.title}</h3>
                  <p>{block.body}</p>
                  <CommandBlock command={block.command} />
                </li>
              ))}
            </ul>
            <h3 className={styles.subhead}>{text.commands.extrasTitle}</h3>
            <ul className={styles.extraList}>
              {text.commands.extras.map((row) => (
                <li key={row.command}>
                  <CommandBlock command={row.command} note={row.note} quiet />
                </li>
              ))}
            </ul>
            <h3 className={styles.subhead}>{text.commands.exitTitle}</h3>
            <p className={styles.note}>{text.commands.exitLead}</p>
            <ul className={styles.tools}>
              {text.commands.exits.map((row) => (
                <li key={row.code}>
                  <code>{row.code}</code>
                  <span>{row.when}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section} id="reference">
            <p className={styles.kicker}>{text.reference.kicker}</p>
            <h2>{text.reference.title}</h2>
            <p className={styles.lead}>{text.reference.lead}</p>

            <h3 className={styles.subhead}>{text.reference.filesTitle}</h3>
            <p className={styles.note}>{text.reference.filesLead}</p>
            <ul className={styles.tools}>
              {text.reference.files.map((file) => (
                <li key={file.path}>
                  <code>{file.path}</code>
                  <span>{file.note}</span>
                </li>
              ))}
            </ul>

            <h3 className={styles.subhead}>{text.reference.envTitle}</h3>
            <p className={styles.note}>{text.reference.envLead}</p>
            <ul className={styles.tools}>
              {text.reference.env.map((row) => (
                <li key={row.name}>
                  <code>{row.name}</code>
                  <span>{row.note}</span>
                </li>
              ))}
            </ul>

            <h3 className={styles.subhead}>{text.reference.troubleTitle}</h3>
            <div className={styles.rules}>
              {text.reference.trouble.map((card) => (
                <article key={card.title}>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>

            <h3 className={styles.subhead}>{text.reference.privacyTitle}</h3>
            <p className={styles.note}>{text.reference.privacyBody}</p>
          </section>
        </main>
      </div>
    </div>
  );
}

function CommandBlock({
  command,
  note,
  quiet,
}: {
  command: string;
  note?: string;
  quiet?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await copyCommand(command, navigator.clipboard);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* The command stays selectable. */
    }
  }

  return (
    <div className={styles.commandRow}>
      <div className={styles.commandBox} data-quiet={quiet || undefined}>
        <code>
          <b>$</b> {command}
        </code>
        <button type="button" onClick={() => void onCopy()} aria-label={`${text.copy.aria}: ${command}`}>
          {copied ? text.copy.done : text.copy.idle}
        </button>
      </div>
      {note ? <p className={styles.commandNote}>{note}</p> : null}
    </div>
  );
}
