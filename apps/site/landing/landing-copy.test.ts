import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KNOWN_FLAGS } from "../../cli/src/args";
import { helpText } from "../../cli/src/lang";
import { LANDING_COPY } from "./landing-copy";

/**
 * May the prose not misrepresent what lies just beneath.
 *
 * The closing said 'the four things below' and there were five: the fifth—the AI exception, the
 * only thing that takes content from your projects—was added later and no one touched the number.
 * It is the worst place to make a mistake, because that whole section exists to make the reader
 * trust: a list of privacy promises that starts off counting wrong invites doubt about all five.
 *
 * English got away with writing it without a number ("everything below follows from that"), which
 * is the lesson: a number in prose that reflects an array is a copy of the data, and copies age on
 * their own. This does not forbid the number —sometimes it reads better— but it forces it to
 * match.
 */

const NUMEROS: Record<string, number> = {
  una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

describe("los números de la landing cuadran con lo que enseña", () => {
  for (const [idioma, copy] of Object.entries(LANDING_COPY)) {
    it(`el cierre no promete más ni menos verdades de las que hay (${idioma})`, () => {
      const cuantas = copy.close.truths.length;
      expect(cuantas).toBeGreaterThan(0);

      /*
        Any number written on the two lines that present the list has to be from the list. Without
        a number, the test passes: it is the safest way to put it.
       */
      for (const linea of [copy.close.line1, copy.close.line2]) {
        for (const palabra of linea.toLowerCase().split(/[^a-záéíóúñ]+/)) {
          const numero = NUMEROS[palabra];
          if (numero !== undefined) expect(numero, linea).toBe(cuantas);
        }
      }
    });

    it(`cada verdad dice dónde vive y qué promete (${idioma})`, () => {
      for (const verdad of copy.close.truths) {
        expect(verdad.locus.length, verdad.claim).toBeGreaterThan(0);
        expect(verdad.claim.length, verdad.locus).toBeGreaterThan(0);
        expect(verdad.why.length, verdad.claim).toBeGreaterThan(0);
      }
      /*
        And at least one has to be marked as coming out: a section titled 'where all this lives'
        in which nothing ever comes out would never be a lie, and it already was once.
       */
      expect(copy.close.truths.some((verdad) => verdad.leaves)).toBe(true);
    });
  }
});

/**
 * That the commands that the page offers exist.
 *
 * This is the kind of bug that already bit in `/docs`: the page showed `npx -y @panoma/mcp`, which
 * was correct the day it was written and stopped being so without anything failing. Here the risk
 * is worse, because these commands come with a copy button: whoever pastes it is not reading
 * documentation, they are executing.
 *
 * They are read from the component itself and not from the copy, which is where they reside —
 * three constants with a `copy` next to them.
 */
describe("los comandos de la landing existen de verdad", () => {
  const fuente = readFileSync(new URL("./landing-experience.tsx", import.meta.url), "utf8");
  const comandos = [...fuente.matchAll(/^const COMMAND[A-Z_]* = "([^"]+)";$/gm)].map((m) => m[1]!);

  it("hay comandos que comprobar", () => {
    expect(comandos.length).toBeGreaterThanOrEqual(3);
  });

  /*
    The video types the headline command, not the tasting one: if it went back to `COMMAND`
    (scan), whoever watches the clip would copy something different from what they just saw.
   */
  it("el vídeo teclea el comando que abre el catálogo", () => {
    expect(fuente).toContain("filmTypedChars(at, COMMAND_UP.length)");
    expect(comandos).toContain("npx panoma up ~/Desktop");
  });

  it("cada verbo lo despacha el CLI", () => {
    const help = helpText();
    for (const comando of comandos) {
      const verbo = /^npx panoma ([a-z][a-z-]*)/.exec(comando)?.[1];
      expect(verbo, comando).toBeDefined();
      expect(help, comando).toContain(`panoma ${verbo}`);
    }
  });

  it("cada bandera la conoce el parser", () => {
    for (const comando of comandos) {
      for (const match of comando.matchAll(/(?<![\w-])--[a-z][a-z0-9-]*/g)) {
        expect(KNOWN_FLAGS, comando).toContain(match[0]);
      }
    }
  });

  /*
    The port is written on the catalog label; if one day the one that comes with the CLI by
    default changes, the page would say it wrong and no one would notice.
   */
  it("el puerto que promete el rótulo es el que usa el CLI", () => {
    const args = readFileSync(new URL("../../cli/src/args.ts", import.meta.url), "utf8");
    const porDefecto = /http:\/\/localhost:(\d+)/.exec(args)?.[1];
    expect(porDefecto).toBeDefined();
    for (const copy of Object.values(LANDING_COPY)) {
      for (const match of copy.command.catalog.matchAll(/localhost:(\d+)/g)) {
        expect(match[1], copy.command.catalog).toBe(porDefecto);
      }
    }
  });
});

describe("Memory se entiende en una mirada", () => {
  const fuente = readFileSync(new URL("./landing-experience.tsx", import.meta.url), "utf8");

  it("aparece antes de Twin", () => {
    const memory = fuente.indexOf("<MemorySection text={text} />");
    const twin = fuente.indexOf("<TwinSection text={text}");
    expect(memory).toBeGreaterThan(-1);
    expect(twin).toBeGreaterThan(memory);
  });

  it("la secuencia nace en Panoma y termina en los agentes", () => {
    const panoma = fuente.indexOf('data-memory-core="panoma"');
    expect(panoma).toBeGreaterThan(-1);
    expect(fuente).toContain("styles.memoryNetworkMark");
    expect(fuente).toContain('data-memory-agent={agent.id}');
    expect(fuente).toContain('id: "claude-cli"');
    expect(fuente).toContain('id: "codex-cli"');
    expect(fuente).toContain('id: "cursor-agent"');
    expect(fuente).toContain("MEMORY_AGENT_TRACKS");
    expect(fuente).toContain("memoryAgentTrack([");
    expect(fuente).toContain("keepMemoryCoreClear");
    expect(fuente).not.toContain("MEMORY_AGENT_ORBIT");
    expect(fuente).toContain("nearestMemoryProject(point)");
    expect(fuente).toContain('repeatCount="indefinite"');
    expect(fuente).not.toContain("MEMORY_NETWORK_NEURITES");
  });

  for (const [idioma, copy] of Object.entries(LANDING_COPY)) {
    it(`vende la memoria con un titular y una sola explicación (${idioma})`, () => {
      expect(copy.memory.line1.length).toBeGreaterThan(0);
      expect(copy.memory.line1.length).toBeLessThan(52);
      expect(copy.memory.line2.length).toBeGreaterThan(0);
      expect(copy.memory.line2.length).toBeLessThan(24);
      expect(copy.memory.lead.length).toBeGreaterThan(0);
      expect(copy.memory.lead.length).toBeLessThan(64);
      expect(copy.memory.projects).toHaveLength(5);
      expect(new Set(copy.memory.projects).size).toBe(5);
    });
  }
});

describe("la entrada termina en la marca", () => {
  const fuente = readFileSync(new URL("./landing-experience.tsx", import.meta.url), "utf8");

  it("el enjambre principal no recibe frases ni otras figuras", () => {
    expect(fuente).toContain(
      'const HERO_SHAPES: SwarmShape[] = [{ kind: "draw", paint: paintMark }];',
    );
    expect(fuente).toContain("const HERO_ORDER = [0];");
    expect(fuente).not.toContain("text.swarm.map");
    expect(LANDING_COPY.en).not.toHaveProperty("swarm");
    expect(LANDING_COPY.es).not.toHaveProperty("swarm");
  });

  it("forma la P después de las manos y la conserva", () => {
    const empieza = fuente.indexOf("<LandingSwarm");
    const termina = fuente.indexOf("/>", empieza);
    const enjambre = fuente.slice(empieza, termina);

    expect(enjambre).toContain("shapes={HERO_SHAPES}");
    expect(enjambre).toContain("order={HERO_ORDER}");
    expect(enjambre).toContain("delay={4450}");
    expect(enjambre).toContain("stayFormed");
  });
});

describe("el cierre lleva las carpetas directamente a Panoma", () => {
  const fuente = readFileSync(new URL("./landing-experience.tsx", import.meta.url), "utf8");

  it("no conserva el paso central", () => {
    expect(fuente).not.toContain("data-finale-core");
    expect(fuente).not.toContain("styles.finalePanoma");
    expect(fuente).not.toContain('style.setProperty("--core-x"');
    expect(fuente).not.toContain('style.setProperty("--core-y"');
  });

  it("identifica la ventana final como Panoma", () => {
    expect(fuente).toContain('className={styles.finaleWindowTitle}>Panoma</b>');
    expect(fuente).toContain("styles.finaleLooseWindow");
    expect(fuente).toContain("data-finale-traveler");
    expect(fuente).toContain('setProperty("--target-scale", String(targetScale))');
    expect(fuente).not.toContain("targetScale * 0.9");
    expect(LANDING_COPY.en.footer.finaleCatalog).toBe("One living catalog");
    expect(LANDING_COPY.es.footer.finaleCatalog).toBe("Un catálogo vivo");
    expect(LANDING_COPY.en.footer.finaleDisk).toBe("Your disk");
    expect(LANDING_COPY.es.footer.finaleDisk).toBe("Tu disco");
    expect(LANDING_COPY.en.footer.finaleLoose).toBe("Loose projects");
    expect(LANDING_COPY.es.footer.finaleLoose).toBe("Proyectos sueltos");
  });

  it("conserva el titular original", () => {
    expect(LANDING_COPY.en.footer.finaleEyebrow).toBe("Agentic coding changed the scale");
    expect(LANDING_COPY.en.footer.finaleLine1).toBe(
      "Without Panoma, two projects feel like too many.",
    );
    expect(LANDING_COPY.en.footer.finaleLine2).toBe("With Panoma, you control dozens.");
    expect(LANDING_COPY.es.footer.finaleEyebrow).toBe(
      "La codificación agéntica cambió la escala",
    );
    expect(LANDING_COPY.es.footer.finaleLine1).toBe(
      "Sin Panoma, dos proyectos parecen demasiados.",
    );
    expect(LANDING_COPY.es.footer.finaleLine2).toBe("Con Panoma, controlas decenas.");
  });
});

/**
 * The 'nothing comes out of the disk' by itself was a lie once: the queue of packages, in the same
 * section, confesses that the names of public packages do come out — to npm, once every twelve
 * hours. The adjective is the repair: nothing YOURS comes out. This test prevents a style tweak
 * from losing the word unnoticed and returning the contradiction to the same screen.
 */
describe("el cierre no promete más silencio del que guarda", () => {
  it("el arranque dice «nada tuyo», no «nada» a secas", () => {
    expect(LANDING_COPY.en.close.grow).toContain("nothing of yours leaves");
    expect(LANDING_COPY.es.close.grow).toContain("nada tuyo sale");
  });
});

/**
 * The buttons to the documentation: the front page promises /docs anchors and no one else monitors
 * them. It already happened with the skip to content link — it pointed to an id that did not exist
 * and no test saw it — so this reads both files and requires that every anchor that the front page
 * offers exists as a section on the docs page.
 */
describe("los botones a la documentación llevan a alguna parte", () => {
  it("cada ancla /docs#… de la portada existe como sección en /docs", () => {
    const portada = readFileSync(new URL("./landing-experience.tsx", import.meta.url), "utf8");
    const docs = readFileSync(new URL("../docs/docs-experience.tsx", import.meta.url), "utf8");
    const secciones = new Set(
      [...docs.matchAll(/<section className=\{styles\.section\} id="([a-z]+)"/g)].map((m) => m[1]),
    );

    const anclas = [...portada.matchAll(/href="\/docs#([a-z]+)"/g)].map((m) => m[1]);
    expect(anclas.length).toBeGreaterThanOrEqual(2);
    for (const ancla of anclas) expect(secciones, ancla).toContain(ancla);
  });
});

/**
 * The two sentences that say what Panoma is, nailed it.
 *
 * They have come and gone three times in two days—the owner removed 'clever' from the footer, restored the
 * superlative to the ending, returned the intelligence to the foot—and on all three occasions
 * there was nothing for either of them to look at. A loop of pleasure turns into a decision once
 * changing it forces erasing an assertion on purpose.
 *
 * They are fixed as a whole, as the holder of the closure fixes a few lines below: what is
 * protected here is not a single word but the distribution between the two. The foot gives the
 * category, its two qualities, and for whom; the end gives the role and seals it with 'That is
 * Panoma.' If someone changes them, let them do so knowing that they are a pair.
 */
describe("qué dice la portada que es panoma", () => {
  it("el pie del hero da categoría, cualidades y público", () => {
    expect(LANDING_COPY.en.hero.copy).toBe(
      "Panoma · the local catalog of your projects — intelligent, always learning, for you and your agents",
    );
    expect(LANDING_COPY.es.hero.copy).toBe(
      "Panoma · el catálogo local de tus proyectos, con inteligencia y aprendizaje, para ti y tus agentes",
    );
  });

  it("el remate de la pregunta da el rol y lo sella", () => {
    expect(LANDING_COPY.en.door.kicker).toBe("A superintelligent front door. That's panoma.");
    expect(LANDING_COPY.es.door.kicker).toBe(
      "Una puerta de entrada superinteligente. Eso es panoma.",
    );
  });

  /*
    The chosen category survives any rewriting of the footnote: it is the word of the empty
    quadrant, and the day the page falls, it ceases to have a shelf.
   */
  it("la categoría no se pierde por el camino", () => {
    expect(LANDING_COPY.en.hero.copy).toContain("the local catalog of your projects");
    expect(LANDING_COPY.es.hero.copy).toContain("el catálogo local de tus proyectos");
  });
});
