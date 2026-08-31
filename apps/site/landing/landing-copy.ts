import type { Locale } from "../lib/locale";

/*
  The texts of the landing page, in both languages.
  They go here and not in `lib/i18n.ts` because the landing is a separate surface from the app:
  its own layout, its own fonts, its own CSS, and not a single key shared with the catalog.
  Putting sixty keys that none of the product screens are going to use into the common dictionary
  only makes that file grow and causes two surfaces that don't communicate to share a destination.
  The mechanism is indeed the same — `getLocale()`, the cookie `panoma-lang` and the header
  `Accept-Language` —, so choosing the language in the app also chooses it here and vice versa.
  English rules: it is the default language of the product externally. Spanish is not a
  word-for-word translation but the same idea expressed as a native would say it.
  How is it written here:
  - You say what happens, not what sounds good. 'Returns months later' was brochure lie: nobody
  abandons a project for half a year and comes back; the normal thing is two weeks between
  sprints, and the reader does recognize that figure as their own.
  - No headlines with the comma turned around («Rancid instructions, hunted»). That inversion
  sounds like a slogan written by a machine; a verb in the present and its complement —«hunt the
  instructions that are no longer true»— says more and does not boast.
  - Each benefit comes with its example inside. 'Check every statement' is empty words; 'the .md
  says `scripts/deploy.sh` and that script was deleted in March' is visible.
  - Panoma is not just the entrance door: it is a superintelligent door. Anyone with a Finder can
  have the door itself. What is sold is what is behind the door — which one you were in, which one
  is broken, which one you never went up.
 */

export type LandingCopy = {
  nav: {
    memory: string;
    agents: string;
    local: string;
    github: string;
    /*
      The last three are not read: they are heard. They were written in the component and in fixed
      Spanish, so the English version announced 'Panoma, start' and 'Sections' to those navigating
      with a screen reader.
     */
    brand: string;
    sections: string;
    language: string;
    lightTheme: string;
    darkTheme: string;
    goldTheme: string;
  };
  sectionFrame: {
    feature: string;
    foundation: string;
    memory: string;
    twin: string;
    agents: string;
    local: string;
  };
  hero: { h1: string; copy: string };
  /*
    The Desktop was the example and the entire disk a footnote that said 'the same command with
    ~'. That forces you to read, understand, and manually edit what has just been copied. Now
    there are two commands, each with its button and label: you choose and paste.
   */
  /*
    The tower is parked and `aria-hidden`, so today no one hears it — but its description lives
    here and not in the component because the component doesn't know in what language the page is
    being read, and the day the compiler returns it will ask for the text in both languages before
    allowing it to be mounted.
   */
  tower: { aria: string };
  command: { desktop: string; wholeDisk: string; catalog: string };
  /*
    `mo1` exists because 'hace 1 meses' betrays the machine that wrote the text as much as a
    spelling mistake. The plural is a language choice, not a template.
   */
  since: { today: string; yesterday: string; d: string; w: string; mo: string; mo1: string };
  rival: { eyebrow: string; line1: string; line2: string; githubHead: string; panomaHead: string; neverLeft: string; foot: string; countGithub: string; countPanoma: string; verdict: string; verdictNote: string; missing: string; knows: string[] };
  hands: {
    aria: string;
    line1Lead: string;
    line1Tail: string;
    line1Aria: string;
    line2: string;
    filesLabel: string;
    files: { name: string; agent: string }[];
    file: {
      meta: string;
      rows: { text: string; verdict?: string }[];
      blockLabel: string;
      block: string[];
      foot: string;
    };
    gains: { title: string; body: string }[];
    note: string;
  };
  /*
    The question that sets up the void, with its stopwatch.
    Each piece does a different psychological job and none are unnecessary:
    - `hint` asks to answer out loud. Without that task, the reader watches the number pass; with
    it, they try, fail, and the void measured by the clock is theirs and not ours.
    - `counting` → `settledLabel` turns the clock into an instrument that gives a verdict:
    'searching for an answer' for five seconds and then 'no answer'.
    - `kicker` is what the reader takes away: a super-intelligent door. The tagline has already
    promised intelligence above, so the superlative here does not introduce the idea: it charges
    it. Between the promise and the charge goes the timer and the response that lists what — which
    one you were on, which one is broken, which one you never uploaded — and that is why the
    'super' is not volume: it is the receipt of something the reader has just seen. It goes at the
    end because a receipt is given afterward, never before.
   */
  door: {
    eyebrow: string;
    question: string;
    hint: string;
    counting: string;
    settledLabel: string;
    answerLead: string;
    answer: string;
    kicker: string;
  };
  /*
    The ten seconds that come after the question.
    The door section ends by saying what Panoma is; the video shows it, which is the only thing a
    paragraph cannot do. It goes right after and in the same dark band so that it reads like the
    same sentence and not like another chapter.
    `beats` are the sections of the video, in their order. Each one has two things: the `label`,
    which is the index —it can be seen on the bar at the bottom and can be clicked to jump there—,
    and the `line`, which is what is really being watched. The sentence alone is not enough:
    without the index, the reader does not know how much is left; the index alone does not say
    anything.
    The subtitles are NOT here. They belong to the video file, not the language, and live in
    `film-beats.ts` — changing the editing shouldn't require touching two translations.
   */
  film: {
    eyebrow: string;
    aria: string;
    play: string;
    pause: string;
    replay: string;
    beats: { label: string; line: string }[];
  };
  memory: {
    aria: string;
    line1: string;
    line2: string;
    lead: string;
    docs: string;
    projects: string[];
  };
  twin: {
    line1: string;
    line2: string;
    file: string;
    agentsAria: string;
    docs: string;
  };
  /*
    The closing responded to two different questions at once —"how do I start" in the headline and
    "where does my data end up" in the list— and didn't quite answer either. Now it is just one:
    where all of this lives. The headline gives the reason from which the four promises hang
    (there is no server), each promise comes with its why —a statement without a mechanism is a
    'trust me,' which is exactly what cannot be asked when talking about credentials—, and
    starting from a folder down to the command, which is where it's needed and where it finally
    explains why a `git clone` enters by itself.
   */
  close: {
    eyebrow: string;
    line1: string;
    line2: string;
    stays: string;
    leaves: string;
    truths: { locus: string; path: string; claim: string; why: string; leaves?: boolean }[];
    dareKicker: string;
    darePath: string;
    dare: string;
    doorQuestion: string;
    doorAnswer: string;
    grow: string;
  };
  copy: { idle: string; done: string; aria: string };
  footer: {
    product: string;
    more: string;
    rights: string;
    built: string;
    lang: string;
    finaleEyebrow: string;
    finaleLine1: string;
    finaleLine2: string;
    finaleFolderCommand: string;
    finaleAllCommand: string;
    finaleDisk: string;
    finaleLoose: string;
    finaleCatalog: string;
    finaleFeatures: string[];
  };
  /*
    The invitation to follow on X. It goes here and not in the component because it is prose read
    by a person, and that is the language boundary of the house.
   */
  /*
    The final card. A single thing to request —the mail— and the rest in a low voice: two short
    sentences, and the link to X as text and not as a second button, so that it does not compete
    with the only thing being requested.
   */
  follow: {
    title: string;
    body: string;
    /* The form. It only exists with `NEXT_PUBLIC_LOOPS_FORM_ID` applied. */
    emailLabel: string;
    emailPlaceholder: string;
    subscribe: string;
    sending: string;
    /* What needs to be said at the pickup point: how often, and through which exit. */
    emailNote: string;
    /*
      The acknowledgment. It carries `{email}` because repeating the typed address is not
      decorative: without a confirmation email, a typo never bounces back, and this line is the
      only chance to catch it.
     */
    done: string;
    error: string;
    /* When the hourly brake trips: it says what happens and what to do. */
    tooMany: string;
    xLink: string;
    close: string;
    /* Screen reader only: the X link opens externally. */
    newTab: string;
  };
  skip: string;
  /** The button that jumps the entrance. */
  skipIntro: string;
};

const en: LandingCopy = {
  nav: {
    memory: "Project memory",
    agents: "Your agents",
    local: "Local",
    github: "GitHub",
    brand: "Panoma, home",
    sections: "Sections",
    language: "Language",
    lightTheme: "Use light theme",
    darkTheme: "Use dark theme",
    goldTheme: "Use mineral gold theme",
  },
  sectionFrame: {
    feature: "Panoma feature",
    foundation: "Panoma foundation",
    memory: "Project memory",
    twin: "Twin",
    agents: "Agent context",
    local: "Local by design",
  },
  hero: {
    /*
      The founder's phrase, not a marketing one: «I found it hard to turn off the laptop because I
      had everything open.» What is sold is not the memory of Panoma but what that memory lets you
      do — close the laptop and leave. The second half names the role (the door) and shows what
      the door knows in three concrete things, because a label without its example inside sells
      nothing.
     */
    h1: "Close your laptop and walk away. Panoma is the front door to every project on your disk — and it knows which one you were in, which one is broken and which one you never pushed.",
    /*
      Three pieces and each one does a job: the chosen category ('local catalog of your
      projects'), what separates this catalog from a Finder with good intentions
      (think and learn), and for whom (you and your agents), which is the verifiable fact
      which prevents the previous two from being adjectives in the air.
      The episode, because this line has already come and gone three times and a rule without its
      episode strikes again: “the SMART local catalog of your projects” was cut for being a
      preposed adjective, attached to the category and with nothing named after it. What we have
      now is a postposed complement that names two capabilities with their own section —Memory and
      Twin— and a third complement that can be disproved by looking at the product. Different
      position, different function. And “for you and your agents” is also the only “why now” that
      the page has at the top: the final punchline says it.
      ("the agentic coding changed the scale") but that is a whole page away from
      distance.
      In English, one does not say 'with intelligence and learning': the standalone noun sounds
      like a consulting brochure. A native speaker says it with an adjective and a verb, and
      separates the category from its qualities with a dash to avoid chaining three commas.
     */
    copy:
      "Panoma · the local catalog of your projects — intelligent, always learning, for you and your agents",
  },
  tower: {
    aria:
      "The P of Panoma as a control tower: its six panels show the project catalog, its " +
      "health, its activity and the state of each one, moving from one project to the next.",
  },
  /*
    The third command is not a third folder: it is the next step. `scan` teaches and does not save
    anything; `up` is the one that opens the catalog — and until the catalog traveled inside the
    npm package, this page couldn't provide it because outside the monorepo it wouldn't start. Now
    it starts. The label shows where it is located and does not "open," because `up` prints the
    address and does not launch the browser.
   */
  command: {
    desktop: "just the Desktop",
    wholeDisk: "your whole disk",
    catalog: "any folder · Desktop in this example · ready at localhost:4173",
  },
  since: { today: "today", yesterday: "yesterday", d: "{n}d ago", w: "{n}w ago", mo: "{n}mo ago", mo1: "{n}mo ago" },
  rival: {
    eyebrow: "The obvious substitute",
    line1: "GitHub only knows what you pushed.",
    line2: "Panoma knows everything you've built.",
    githubHead: "github.com/youruser · repositories",
    panomaHead: "panoma · ~/Dev",
    neverLeft: "never left this disk",
    foot: "sample data · yours come from your own disk",
    countGithub: "repos it can see",
    countPanoma: "projects you actually have",
    verdict: "invisible to GitHub",
    verdictNote: "Not because you hid them. Because you never pushed them.",
    missing: "not here",
    knows: ["health", "stack", "who touched it", "unpushed work"],
  },
  hands: {
    aria: "The instruction files agents open first — AGENTS.md, CLAUDE.md, GEMINI.md, copilot-instructions.md — with two stale claims flagged by panoma and a self-maintained context block",
    line1Lead: "Your agents read",
    line1Tail: "before anything else.",
    line1Aria:
      "Your agents read AGENTS.md, CLAUDE.md, GEMINI.md or copilot-instructions.md before anything else.",
    line2: "Panoma keeps what they read true.",
    filesLabel: "The .md each agent opens first",
    files: [
      { name: "AGENTS.md", agent: "Codex, Cursor and the rest" },
      { name: "CLAUDE.md", agent: "Claude Code" },
      { name: "GEMINI.md", agent: "Gemini CLI" },
      { name: "copilot-instructions.md", agent: "GitHub Copilot" },
    ],
    file: {
      meta: "1,240 tokens · read at the start of every session",
      rows: [
        { text: "# Project guide" },
        { text: "Deploy with `npm run deploy`", verdict: "script removed in March" },
        { text: "Auth lives in `src/auth/session.ts`", verdict: "file no longer exists" },
        { text: "Start with `pnpm dev`" },
      ],
      blockLabel: "kept fresh by panoma",
      block: [
        "stack: React · TypeScript · Postgres",
        "commands: install `pnpm install` · start `pnpm dev`",
        "dependencies: 12 direct · 2 with security advisories",
        "open tasks: 3 — claim them over MCP",
      ],
      foot: "Cursor added 3 lines yesterday. Panoma noticed and told you.",
    },
    gains: [
      {
        title: "It catches the instructions that stopped being true",
        body: "AGENTS.md says `scripts/deploy.sh`; that script vanished in March. Panoma checks the real project and flags the stale line.",
      },
      {
        title: "It keeps the context current without you touching it",
        body: "`panoma md init` keeps stack, commands, advisories and open tasks current. Your own writing stays untouched.",
      },
      {
        title: "You know which agent changed the rules",
        body: "When an agent signs an AGENTS.md change, Panoma records its name and date on the project page — no git archaeology.",
      },
    ],
    note:
      "With several agents, Panoma is their shared memory: claimed work locks, the log travels " +
      "to whoever arrives next, and the facts you approve reach every agent's first turn.",
  },
  door: {
    eyebrow: "One question",
    question: "What's the front door to your projects?",
    hint: "Answer it out loud before you read on.",
    counting: "looking for an answer",
    settledLabel: "no answer",
    answerLead: "Five seconds looking for an answer you didn't have.",
    answer: "GitHub only opens what you pushed. Your editor opens one project. Panoma opens all of them — and tells you which one you were in, which one is broken and which one never left this disk.",
    kicker: "A superintelligent front door. That's panoma.",
  },
  film: {
    eyebrow: "Ten seconds",
    aria: "Ten seconds of panoma: a disk full of folders becomes a catalog of projects.",
    play: "Play",
    pause: "Pause",
    replay: "Play it again",
    beats: [
      {
        label: "Your disk today",
        line: "Forty folders, and their names stopped meaning anything months ago.",
      },
      {
        label: "One command",
        line: "The screen sweeps clean, and one command reads them where they are — nothing installed, nothing uploaded.",
      },
      {
        label: "The front door",
        line: "And a door appears where there wasn't one. One click opens it.",
      },
      {
        label: "Every project",
        line: "All of them on one page — and the one you touched today shows up first.",
      },
      {
        label: "What's inside",
        line: "And inside each one: what it's built with, what's broken, what never left this disk.",
      },
    ],
  },
  memory: {
    aria:
      "Panoma's brain creates five independent project memories. Then Claude Code, Codex and Cursor fly through the network on different paths and connect to every project.",
    /*
      The superlative is the decision, not a lapse: the thesis that was here one day ('memory
      belongs to the project, not the agent') described without selling. What supports the
      statement is the lead just below —a memory per project that all agents read, not one per
      agent—, and that combination, according to the market study of August 26, 2026, nobody else
      offers. The day someone offers it, this line is the first one that needs reviewing.
      The lead says «the agents» and not the three names on purpose: the three that the animation
      draws are today’s, and a list of brands in the copy ages every time a new agent appears. The
      names are still where they don’t lie — the `aria` of the section, which describes what is
      seen.
     */
    line1: "The most advanced memory for your projects.",
    line2: "Panoma has it.",
    lead: "It updates live and your agents read it.",
    docs: "How memory works",
    projects: ["Project 1", "Project 2", "Project 3", "Project 4", "Project 5"],
  },
  twin: {
    line1: "Twin learns how you decide.",
    line2: "And guides all your agents.",
    file: "TASTE.MD",
    agentsAria: "Your criterion reaches Claude Code, Codex and Cursor",
    docs: "How Twin works",
  },
  close: {
    eyebrow: "Where your data lives",
    line1: "All of this happens inside your computer.",
    line2: "Panoma has no server to send anything to — everything below follows from that.",
    stays: "stays here",
    leaves: "can leave",
    truths: [
      {
        locus: "This machine",
        path: "~/.panoma",
        claim: "There's no account to create.",
        why: "Panoma runs on your machine and keeps what it learns in a file inside your home folder. There's nobody to sign up with, because there's nobody on the other end.",
      },
      {
        locus: "This disk",
        path: "folders · git history",
        claim: "The scan never touches the network.",
        why: "It reads the folders and the git history already sitting on your disk. That's why it works exactly the same on a plane.",
      },
      {
        locus: "The index card",
        path: "path · stack · last touch · what's broken",
        claim: "Your code and your credentials stay where they are.",
        why: "Panoma keeps the project's index card — where it lives, what it's written in, when you last touched it, what is broken — not its contents. What's inside only moves if you connect a model and ask it to.",
      },
      {
        locus: "The packets",
        path: "npm · “react”",
        leaves: true,
        claim: "Connect nothing and the only thing that leaves is public package names.",
        why: "To find out whether your react is current, someone has to ask npm about “react”. That happens when you ask for it, and once every twelve hours so you don't have to. Nothing of yours travels in that question.",
      },
      {
        locus: "If you connect a model",
        path: "your key · the project you pick",
        leaves: true,
        claim: "Whatever you ask it to describe travels to that provider.",
        why: "Panoma brings no model of its own: it uses yours, with your key. When you ask it to describe a project, that project's README and commit subjects go to Anthropic, OpenAI or whoever you set up. Nobody turns it on for you: connect nothing and it never happens.",
      },
    ],
    dareKicker: "Prove it",
    darePath: "wifi off · same catalog",
    dare: "See for yourself: pull the wifi and scan again. Same result.",
    doorQuestion: "What's the front door to your projects?",
    doorAnswer: "Now you have an answer. And it's one command away.",
    grow: "Start with one folder: the catalog comes up, fills itself with what it finds — what's there, what's broken, what you never pushed — and waits in your browser. Nothing gets installed and nothing of yours leaves the disk. From then on the next git clone shows up on its own.",
  },
  copy: { idle: "copy", done: "copied", aria: "Copy the command" },
  footer: {
    product: "Product",
    more: "More",
    /*
      The notice identifies the holder, who is the one who can license: «All rights reserved»
      alone was anonymous and also a lie — the code grants almost all its rights under AGPL.
     */
    rights: "Jesus Castillo · free software under AGPL-3.0",
    built: "Built on a real disk, in the United States.",
    lang: "English",
    finaleEyebrow: "Agentic coding changed the scale",
    finaleLine1: "Without Panoma, two projects feel like too many.",
    finaleLine2: "With Panoma, you control dozens.",
    finaleFolderCommand: "any folder · Desktop in this example",
    finaleAllCommand: "all your projects",
    finaleDisk: "Your disk",
    finaleLoose: "Loose projects",
    finaleCatalog: "One living catalog",
    finaleFeatures: [
      "Agents",
      "Memory",
      "Twin",
      "Project health",
      "Shortcuts",
      "Fast execution",
      "Always organized",
      "Unlimited projects",
    ],
  },
  follow: {
    title: "panoma updates",
    body: "What changed, when it changes.",
    emailLabel: "Email",
    emailPlaceholder: "you@example.com",
    subscribe: "Get updates",
    sending: "Sending…",
    emailNote: "Only when there is a release. One click to leave.",
    done: "You are in — {email}. Nothing arrives until there is news.",
    error: "That address did not go through. Try again?",
    tooMany: "Too many tries from here. Give it an hour.",
    xLink: "Follow on X",
    close: "Close",
    newTab: "(opens in a new tab)",
  },
  skip: "Skip to content",
  skipIntro: "Skip",
};

const es: LandingCopy = {
  nav: {
    memory: "Memoria de proyectos",
    agents: "Tus agentes",
    local: "Local",
    github: "GitHub",
    brand: "Panoma, inicio",
    sections: "Secciones",
    language: "Idioma",
    lightTheme: "Usar tema claro",
    darkTheme: "Usar tema oscuro",
    goldTheme: "Usar tema oro mineral",
  },
  sectionFrame: {
    feature: "Función de Panoma",
    foundation: "Base de Panoma",
    memory: "Memoria de proyectos",
    twin: "Twin",
    agents: "Contexto para agentes",
    local: "Local por diseño",
  },
  hero: {
    h1: "Apaga el portátil y vete tranquilo. Panoma es la puerta de entrada a todos los proyectos de tu disco — y sabe en cuál estabas, cuál está roto y cuál nunca llegaste a subir.",
    copy:
      "Panoma · el catálogo local de tus proyectos, con inteligencia y aprendizaje, para ti y tus agentes",
  },
  tower: {
    aria:
      "La P de Panoma como torre de control: sus seis paneles muestran el catálogo de " +
      "proyectos, la salud, la actividad y el estado de cada uno, y van pasando de un " +
      "proyecto al siguiente.",
  },
  command: {
    desktop: "solo el Escritorio",
    wholeDisk: "todo tu disco",
    catalog: "cualquier carpeta · Escritorio en este ejemplo · catálogo listo en localhost:4173",
  },
  since: { today: "hoy", yesterday: "ayer", d: "hace {n} d", w: "hace {n} sem", mo: "hace {n} meses", mo1: "hace {n} mes" },
  rival: {
    eyebrow: "El sustituto obvio",
    line1: "GitHub solo conoce lo que subiste.",
    line2: "Panoma conoce todo lo que has construido.",
    githubHead: "github.com/tuusuario · repositories",
    panomaHead: "panoma · ~/Dev",
    neverLeft: "nunca salió de este disco",
    /*
      The twelve projects in this comparison are made up —a real album cannot be shown without
      showing someone else's work—, so the footnote says it instead of swearing otherwise. It said
      'a real · unedited album,' and that was the only false detail on a page that sells without
      lying to you. The confession also points to what matters: the numbers that count are those
      of the album of the person reading, not those of this example.
     */
    foot: "datos de muestra · los tuyos salen de tu disco",
    countGithub: "repos que puede ver",
    countPanoma: "proyectos que de verdad tienes",
    verdict: "invisibles para GitHub",
    verdictNote: "No porque los escondieras. Porque nunca los subiste.",
    missing: "no está",
    knows: ["salud", "pila", "quién lo tocó", "trabajo sin subir"],
  },
  hands: {
    aria: "Los ficheros de instrucciones que abren los agentes — AGENTS.md, CLAUDE.md, GEMINI.md, copilot-instructions.md — con dos afirmaciones rancias señaladas por panoma y un bloque de contexto que se cuida solo",
    line1Lead: "Tus agentes leen",
    line1Tail: "antes que nada.",
    line1Aria:
      "Tus agentes leen AGENTS.md, CLAUDE.md, GEMINI.md o copilot-instructions.md antes que nada.",
    line2: "Panoma se asegura de que lo que leen sea verdad.",
    filesLabel: "El .md que abre cada agente",
    files: [
      { name: "AGENTS.md", agent: "Codex, Cursor y los demás" },
      { name: "CLAUDE.md", agent: "Claude Code" },
      { name: "GEMINI.md", agent: "Gemini CLI" },
      { name: "copilot-instructions.md", agent: "GitHub Copilot" },
    ],
    file: {
      meta: "1.240 tokens · leído al empezar cada sesión",
      rows: [
        { text: "# Guía del proyecto" },
        { text: "Despliega con `npm run deploy`", verdict: "el script se borró en marzo" },
        { text: "La sesión vive en `src/auth/session.ts`", verdict: "ese fichero ya no existe" },
        { text: "Arranca con `pnpm dev`" },
      ],
      blockLabel: "panoma lo mantiene fresco",
      /*
        In English on purpose: the block is an artifact that the machine writes only once for all
        languages, and the model shows the artifact for real.
       */
      block: [
        "stack: React · TypeScript · Postgres",
        "commands: install `pnpm install` · start `pnpm dev`",
        "dependencies: 12 direct · 2 with security advisories",
        "open tasks: 3 — claim them over MCP",
      ],
      foot: "Cursor añadió 3 líneas ayer. Panoma se dio cuenta y te avisó.",
    },
    gains: [
      {
        title: "Caza las instrucciones que ya no son verdad",
        body: "AGENTS.md dice `scripts/deploy.sh`; ese script desapareció en marzo. Panoma comprueba el proyecto real y señala la línea desactualizada.",
      },
      {
        title: "Mantiene el contexto al día sin que lo toques",
        body: "`panoma md init` mantiene al día pila, comandos, avisos y tareas abiertas. Lo que escribiste tú no se toca.",
      },
      /*
        It said "It notifies you when an agent changes the rules" and "each edit is attributed,"
        and both halves were false: there is no notification —there is a list on the project page—
        and the attribution comes from the commit trailer, so an unsigned edit is not attributed
        to anyone (packages/core/src/agentsmd.ts:70 says it: "its absence does not say human").
        What it does do is real and GitHub doesn't do it, so it is reported as is: who signed,
        when, and where it can be seen.
       */
      {
        title: "Sabes qué agente cambió las reglas",
        body: "Cuando un agente firma un cambio en AGENTS.md, Panoma muestra su nombre y fecha en la ficha — sin buscar en el historial.",
      },
    ],
    note:
      "Con varios agentes, Panoma es su memoria compartida: el trabajo reclamado se bloquea, el " +
      "registro viaja al siguiente que llegue, y los hechos que apruebas llegan al primer turno de todos.",
  },
  door: {
    eyebrow: "Una pregunta",
    question: "¿Cuál es la puerta de entrada a tus proyectos?",
    hint: "Contéstala en voz alta antes de seguir leyendo.",
    counting: "buscando respuesta",
    settledLabel: "sin respuesta",
    answerLead: "Cinco segundos buscando una respuesta que no tenías.",
    answer: "GitHub solo abre lo que subiste. Tu editor abre un proyecto. Panoma los abre todos — y te dice en cuál estabas, cuál está roto y cuál nunca salió de tu disco.",
    kicker: "Una puerta de entrada superinteligente. Eso es panoma.",
  },
  film: {
    eyebrow: "Diez segundos",
    aria: "Diez segundos de panoma: un disco lleno de carpetas se convierte en un catálogo de proyectos.",
    play: "Reproducir",
    pause: "Pausa",
    replay: "Verlo otra vez",
    beats: [
      {
        label: "Tu disco hoy",
        line: "Cuarenta carpetas, y hace meses que sus nombres no te dicen nada.",
      },
      {
        label: "Un comando",
        line: "La pantalla se despeja y un comando las lee donde están: no instala nada y no sube nada.",
      },
      {
        label: "La puerta",
        line: "Y aparece una puerta donde no había ninguna. Un clic y se abre.",
      },
      {
        label: "Todos tus proyectos",
        line: "Todos en una página, y el que tocaste hoy sale el primero.",
      },
      {
        label: "La ficha",
        line: "Y dentro de cada uno: con qué está hecho, qué está roto, qué nunca salió de este disco.",
      },
    ],
  },
  memory: {
    aria:
      "El cerebro de Panoma crea cinco memorias de proyecto independientes. Después Claude Code, Codex y Cursor vuelan por la red en trayectorias distintas y se conectan con todos los proyectos.",
    line1: "La memoria más avanzada para tus proyectos.",
    line2: "La tiene Panoma.",
    lead: "Se actualiza en vivo y la leen los agentes.",
    docs: "Cómo funciona la memoria",
    projects: ["Proyecto 1", "Proyecto 2", "Proyecto 3", "Proyecto 4", "Proyecto 5"],
  },
  twin: {
    line1: "Twin aprende cómo decides.",
    line2: "Y guía a todos tus agentes.",
    file: "TASTE.MD",
    agentsAria: "Tu criterio llega a Claude Code, Codex y Cursor",
    docs: "Cómo funciona Twin",
  },
  close: {
    eyebrow: "Dónde vive todo esto",
    line1: "Todo esto pasa dentro de tu ordenador.",
    line2: "Panoma no tiene servidor al que mandar nada — y de ahí sale todo lo de abajo.",
    stays: "se queda",
    leaves: "puede salir",
    truths: [
      {
        locus: "Esta máquina",
        path: "~/.panoma",
        claim: "No hay ninguna cuenta que crear.",
        why: "Panoma corre en tu máquina y guarda lo que aprende en un fichero dentro de tu carpeta personal. No hay con quién registrarse porque no hay nadie al otro lado.",
      },
      {
        locus: "Este disco",
        path: "carpetas · historial de git",
        claim: "El escaneo no toca la red.",
        why: "Lee las carpetas y el historial de git que ya tienes en el disco. Por eso funciona exactamente igual en un avión.",
      },
      {
        locus: "La ficha",
        path: "ruta · pila · último toque · qué está roto",
        claim: "Tu código y tus credenciales se quedan donde están.",
        why: "Panoma se queda con la ficha del proyecto —dónde vive, en qué está escrito, cuándo lo tocaste, qué está roto—, no con lo que hay dentro. Lo de dentro solo se mueve si tú conectas un modelo y se lo pides.",
      },
      /*
        The twelve hours are written because they are true: `ENRICH_EVERY_MS` in
        apps/web/lib/watch.ts makes the watcher refresh versions and notices twice a day on its
        own. Here it said «and only when you request», and that section invites the reader to
        check it with a sniffer — they would see traffic that the page swore wouldn’t appear.
        Telling it, moreover, doesn’t take away: refreshing is just a function.
       */
      {
        locus: "Los paquetes",
        path: "npm · «react»",
        leaves: true,
        claim: "Sin conectar nada, lo único que sale son nombres de paquetes públicos.",
        why: "Para saber si tu react está al día, alguien tiene que preguntarle a npm por «react». Eso pasa cuando lo pides y una vez cada doce horas, para que no tengas que pedirlo. En esa pregunta no viaja nada tuyo.",
      },
      /*
        The missing exception, and the only one that had anything from inside your projects.
        Panoma does not come with a model: it uses the one you connect, so describing a project
        sends its README and its commits to the provider you have set. It is opt-in and many
        people will never activate it, but a section called 'where all this lives' that bypasses
        the only door through which content exits is not useful for what exists. Telling it costs
        one line; letting the reader discover it costs the entire section.
       */
      {
        locus: "Si conectas un modelo",
        path: "tu clave · el proyecto que elijas",
        leaves: true,
        claim: "Lo que le pidas describir viaja a ese proveedor.",
        why: "Panoma no trae modelo propio: usa el tuyo, con tu clave. Cuando le pides que describa un proyecto, su README y los asuntos de sus commits van a Anthropic, OpenAI o quien hayas puesto. Nadie te lo activa: sin conectar nada, no ocurre nunca.",
      },
    ],
    dareKicker: "Compruébalo",
    darePath: "wifi apagado · el mismo catálogo",
    dare: "Míralo con tus propios ojos: apaga el wifi y vuelve a escanear. Sale lo mismo.",
    doorQuestion: "¿Cuál es la puerta de entrada a tus proyectos?",
    doorAnswer: "Ya la tienes. Y está a un comando de distancia.",
    grow: "Empieza por una carpeta: el catálogo se levanta, se llena con lo que encuentra —lo que hay, qué está roto, qué nunca subiste— y te espera en el navegador. No se instala nada y nada tuyo sale del disco. A partir de ahí el próximo git clone entra solo.",
  },
  copy: { idle: "copiar", done: "copiado", aria: "Copiar el comando" },
  footer: {
    product: "Producto",
    more: "Más",
    rights: "Jesus Castillo · software libre bajo AGPL-3.0",
    built: "Hecho sobre un disco de verdad, en Estados Unidos.",
    lang: "Español",
    finaleEyebrow: "La codificación agéntica cambió la escala",
    finaleLine1: "Sin Panoma, dos proyectos parecen demasiados.",
    finaleLine2: "Con Panoma, controlas decenas.",
    finaleFolderCommand: "cualquier carpeta · Escritorio en este ejemplo",
    finaleAllCommand: "todos tus proyectos",
    finaleDisk: "Tu disco",
    finaleLoose: "Proyectos sueltos",
    finaleCatalog: "Un catálogo vivo",
    finaleFeatures: [
      "Agentes",
      "Memoria",
      "Twin",
      "Salud del proyecto",
      "Accesos directos",
      "Ejecución rápida",
      "Siempre organizado",
      "Proyectos sin límite",
    ],
  },
  follow: {
    title: "Novedades de panoma",
    body: "Lo que cambia, cuando cambia.",
    emailLabel: "Correo",
    emailPlaceholder: "tu@ejemplo.com",
    subscribe: "Avísame",
    sending: "Enviando…",
    emailNote: "Solo cuando haya versión nueva. Te vas en un clic.",
    done: "Ya estás — {email}. No llega nada hasta que haya novedad.",
    error: "Esa dirección no ha entrado. ¿Lo intentas otra vez?",
    tooMany: "Demasiados intentos desde aquí. Prueba dentro de una hora.",
    xLink: "Seguir en X",
    close: "Cerrar",
    newTab: "(se abre en otra pestaña)",
  },
  skip: "Saltar al contenido",
  skipIntro: "Saltar",
};

export const LANDING_COPY: Record<Locale, LandingCopy> = { en, es };
