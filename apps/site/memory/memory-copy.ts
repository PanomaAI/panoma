import type { Locale } from "../lib/locale";

/**
 * The copy of `/memory`: one sentence of yours followed from the conversation to a rule every
 * agent receives, told twice — plainly, for anyone, and technically, with the names, tables and
 * limits the code uses — in the two languages the site speaks.
 *
 * The frames of the two registers line up one to one: frame `i` of the technical telling is the
 * same moment as frame `i` of the plain one, so the drawings (`memory-pics.tsx`) and the two
 * gates — the permission switch and the approve/discard buttons — are shared. `memory-copy.test.ts`
 * pins that alignment, keeps the figures equal to the constants they quote, and checks that every
 * `panoma` command named here is one the shipped CLI dispatches.
 *
 * Inline markup, rendered by `renderInline` in `memory-story.tsx` and never as HTML:
 * `` `code` ``, `**strong**`, `[[term]]` for a name of the house, `_em_`.
 */

export type MemoryMode = "easy" | "tech";

export interface MemoryFrame {
  h: string;
  p: string[];
  /** The frame that waits for a hand: the permission switch, or the approve/discard pair. */
  act?: "allow" | "decide";
}

export interface MemoryTelling {
  title: string;
  lede: string;
  sentence: string;
  proposalSentence: string;
  /** One label per frame: the sentence's state while that frame is on screen. */
  states: string[];
  stateAllowed: string;
  stateDiscarded: string;
  allowNote: string;
  allowedNote: string;
  discardedNote: string;
  approvedNote: string;
  frames: MemoryFrame[];
  endTitle: string;
  end: string[];
  namesTitle: string;
  names: [string, string][];
}

export interface MemoryCopy {
  modeEasy: string;
  modeTech: string;
  kindLabel: string;
  eyebrow: string;
  pics: Record<"p3a" | "p3b" | "p3c" | "p4a" | "p5a", string>;
  allow: string;
  allowed: string;
  approve: string;
  discard: string;
  easy: MemoryTelling;
  tech: MemoryTelling;
}

/** The frames that carry a gate, and the ones where the sentence changes shape. */
export const ALLOW_FRAME = 2;
export const PROPOSAL_FRAME = 5;
export const DECIDE_FRAME = 6;
export const RULE_FRAME = 7;
export const FRAME_COUNT = 12;

const es: MemoryCopy = {
  modeEasy: "Sencilla",
  modeTech: "Técnica",
  kindLabel: "Tipo de explicación",
  eyebrow: "Tu frase",
  pics: {
    p3a: "leyó 3 archivos",
    p3b: "cambió 1 archivo",
    p3c: "pruebas: pasan",
    p4a: "30 minutos parada",
    p5a: "Propuesta",
  },
  allow: "Dar los permisos",
  allowed: "Permisos dados",
  approve: "Aprobar",
  discard: "Descartar",
  easy: {
    title: "Cómo una frase tuya se convierte en algo que tus agentes recuerdan",
    lede: "Le escribes a tu agente de programación. Esto es, paso a paso y sin tecnicismos, lo que panoma hace para que esa frase acabe siendo una regla que todos tus agentes reciben, y para comprobar que la recibieron. Baja para verlo.",
    sentence: "«Deja el diario en solo-añadir hasta que acabe la migración.»",
    proposalSentence: "«El diario se queda en solo-añadir hasta que termine la migración.»",
    states: [
      "en la conversación",
      "guardada en un archivo de tu ordenador",
      "panoma no puede leerla: falta tu permiso",
      "leída por panoma",
      "enviada a la IA",
      "propuesta (todavía no vale)",
      "esperando tu decisión",
      "regla del proyecto · versión 1",
      "regla del proyecto · y panoma aprende tus gustos",
      "entregada al agente",
      "confirmada: llegó",
      "vigilada",
    ],
    stateAllowed: "panoma ya puede leerla",
    stateDiscarded: "descartada: no vale y no se repite",
    allowNote: "Ahora mismo panoma no puede leer nada. Enciende los permisos para ver qué pasa después.",
    allowedNote: "Con los permisos dados, panoma puede leer el archivo y preguntar a la IA. Sigue bajando.",
    discardedNote: "Descartada. panoma apunta tu «no», no vuelve a proponer esa misma frase y ningún agente la verá nunca. Pulsa Aprobar para ver el camino completo.",
    approvedNote: "Aprobada. A partir de aquí, la frase es una regla del proyecto.",
    frames: [
      {
        h: "Le escribes algo a tu agente",
        p: [
          "Por ejemplo, a Claude Code: «Deja el diario en solo-añadir hasta que acabe la migración». Es una frase dentro de una conversación, como cualquier otra.",
          "Nadie la guarda como regla. Si mañana abres otra sesión, el agente no se acuerda.",
        ],
      },
      {
        h: "La conversación se guarda en un archivo, en tu ordenador",
        p: [
          "El agente apunta todo lo que pasa —lo que le dices y lo que hace— en un archivo. Ese archivo es del agente y está en tu disco.",
          "panoma no lo toca: puede leerlo si tú lo permites, pero nunca escribe en él.",
        ],
      },
      {
        h: "panoma no puede leer ese archivo hasta que tú lo permitas",
        p: [
          "Tú decides, agente por agente. Y son tres permisos distintos:",
          "**Permiso para leer** [[en panoma: captura]]: panoma puede abrir el archivo y apuntar qué hizo el agente —qué archivos tocó, si las pruebas pasaron—. Nunca copia lo que se dijo.",
          "**Permiso para preguntar a la IA** [[en panoma: extracción]]: panoma puede enviar tus frases —solo las tuyas, nunca las del agente— a una IA para que busque reglas en ellas.",
          "**Permiso para aprender tus gustos** [[en panoma: Twin]]: panoma puede fijarse en lo que repites para proponerte criterios de gusto (lo ves en el paso 9).",
          "Sin el primero, no se lee nada. Sin el segundo, nada sale de tu ordenador. Este recorrido usa los dos primeros.",
        ],
        act: "allow",
      },
      {
        h: "Con permiso, panoma lee el archivo y apunta qué pasó",
        p: [
          "Solo una lista corta de hechos, sin el texto de la conversación: el agente leyó 3 archivos, cambió 1, las pruebas pasaron.",
          "Lee poco a poco y en segundo plano, para no frenar tu ordenador.",
        ],
      },
      {
        h: "Cuando la conversación lleva media hora parada, pregunta a la IA",
        p: [
          "panoma reúne tus frases (tapando cualquier contraseña) y los hechos que apuntó, y le pregunta a la IA: ¿hay aquí algo que deba ser una regla de este proyecto?",
          "Preguntar cuesta dinero, así que hay un tope: 12 preguntas al día como mucho. Si el tope se acaba, espera a mañana.",
        ],
      },
      {
        h: "La IA propone una regla",
        p: [
          "Devuelve una frase corta y señala de qué mensaje tuyo la sacó.",
          "Es solo una propuesta: todavía no vale para nada y ningún agente la ve.",
        ],
      },
      {
        h: "Tú decides",
        p: [
          "La propuesta aparece en la app de panoma, en la pestaña Memoria del proyecto. Solo tú puedes aprobarla o descartarla: ningún agente puede, ni siquiera con su clave.",
          "Nunca hay más de 20 propuestas esperando, para que revisarlas no se convierta en una tarea eterna.",
        ],
        act: "decide",
      },
      {
        h: "Ya es una regla del proyecto",
        p: [
          "Corta (500 letras como mucho) y numerada: versión 1. Si un día la cambias, panoma guarda cómo era antes.",
          "Puedes añadirle detalles: en qué carpeta vale, qué tiene que seguir siendo cierto (por ejemplo, que exista un archivo) y hasta qué fecha.",
        ],
      },
      {
        h: "panoma también aprende cómo te gusta trabajar",
        p: [
          "Con el tercer permiso, panoma se fija en lo que les dices a tus agentes una y otra vez —«respuestas cortas», «nada de colores fuera del archivo de colores»— y lo convierte en criterios de gusto. A esa parte de panoma se la llama [[Twin]].",
          "Los criterios se apuntan en un archivo tuyo, TASTE.md, que los agentes también reciben. Puedes editarlo a mano: si borras una línea, panoma lo entiende como un no; si la reescribes, como un sí con tus palabras.",
          "Un criterio nuevo solo se publica solo cuando panoma lo ha visto en al menos tres conversaciones distintas y tú has dicho, una vez, que puede hacerlo. Si no, espera tu sí como cualquier propuesta.",
        ],
      },
      {
        h: "La próxima vez que un agente empieza, recibe las reglas antes de tu primer mensaje",
        p: [
          "panoma junta las reglas del proyecto y tus criterios de gusto en un paquete y se lo entrega al agente al abrir la sesión.",
          "Antes de entregarlo, guarda una copia de exactamente qué envió, con una huella: un código único que identifica ese contenido.",
        ],
      },
      {
        h: "panoma comprueba que llegó de verdad",
        p: [
          "Más tarde mira el archivo de esa conversación nueva y busca el paquete, byte a byte, en el sitio donde el agente guarda lo que recibe.",
          "Si está: llegó completo. Si no está o está a medias, lo apunta tal cual. No se fía; lo comprueba.",
        ],
      },
      {
        h: "Y sigue vigilando",
        p: [
          "Una regla puede dejar de ser cierta. panoma revisa tus archivos cada poco: si la regla decía «existe este archivo» y ya no existe, la aparta y te avisa con la prueba.",
          "Y si un día quieres borrar una regla, panoma te enseña antes qué va a borrar y lo apunta en un registro.",
        ],
      },
    ],
    endTitle: "En resumen",
    end: [
      "Nada se lee sin tu permiso, y el permiso se da agente por agente.",
      "Nada se convierte en regla sin tu sí.",
      "Cada regla y cada criterio llegan al agente al empezar la sesión, y panoma comprueba en el archivo del agente que llegaron.",
      "Lo que deja de ser cierto se aparta y te avisa.",
    ],
    namesTitle: "Cómo se llama cada cosa dentro de panoma",
    names: [
      ["captura", "el permiso para leer el archivo de la conversación y apuntar qué pasó"],
      ["extracción", "el permiso para enviar tus frases a la IA"],
      ["Twin", "la parte de panoma que aprende tus gustos, y el tercer permiso"],
      ["propuesta", "una regla que espera tu sí"],
      ["nota", "una regla aprobada del proyecto"],
      ["criterio", "un gusto tuyo, apuntado en TASTE.md"],
      ["contrato", "el paquete de reglas y criterios que recibe el agente al empezar"],
      ["recibo", "la comprobación de que el paquete llegó"],
      ["patrulla", "la revisión de que las reglas siguen siendo ciertas"],
    ],
  },
  tech: {
    title: "La memoria de panoma, por dentro",
    lede: "El mismo recorrido, con los nombres, las tablas, los límites y las puertas reales. Cada cifra es una constante del código; cada estado, una columna. Para quien quiera saber exactamente qué pasa con un turno tuyo desde el historial hasta el recibo.",
    sentence: "«Deja el diario en solo-añadir hasta que acabe la migración.»",
    proposalSentence: "«El diario se queda en solo-añadir hasta que termine la migración.»",
    states: [
      "turno del dueño en el transcript",
      "registro user en el .jsonl del harness",
      "sin grant: byte no leído",
      "session_facts escritos; turno leído en su intervalo",
      "ventana congelada · job project_extract staged",
      "notes.status = proposed",
      "esperando decideNote",
      "notes.status = approved · memory_rev 1",
      "beliefs (criterios) · TASTE.md",
      "servings: oferta srv_… con contentHash",
      "serving_events: reception full",
      "memory_outcomes: pass",
    ],
    stateAllowed: "grants capture + extract en vigor",
    stateDiscarded: "notes.status = discarded",
    allowNote: "Sin grant no hay lectura: el reader salta la fuente entera. Enciende los grants para seguir.",
    allowedNote: "Grants memoryCapture (notice 2) y memoryExtract en vigor para el ámbito. Sigue bajando.",
    discardedNote: "discarded: fotografiado en memory_revisions con su rev; la comprobación de duplicados del extractor lo lee (incluidos caducados) y no vuelve a proponer la misma frase.",
    approvedNote: "approved: memory_rev 1, fotografía en memory_revisions, bytes cargados a memory_usage. A partir de aquí es una unidad elegible del selector.",
    frames: [
      {
        h: "Un turno tuyo en el harness",
        p: [
          "Un registro `user` en la conversación con Claude Code o Codex. panoma no intercepta el prompt: no hay gancho en él.",
          "Lo único que ya ocurrió es al arrancar la sesión: el gancho `SessionStart` ejecutó `panoma brief`, que pidió el contrato de memoria del proyecto y lo imprimió en el contexto (paso 10). Ese contrato ya quedó anotado como oferta antes de salir.",
        ],
      },
      {
        h: "El transcript: un archivo del harness, en tu disco",
        p: [
          "Claude Code escribe `~/.claude/projects/<carpeta>/<sesión>.jsonl` (y `<sesión>/subagents/*.jsonl` para los subagentes); Codex, `~/.codex/sessions/**/*.jsonl`. Cada línea es un registro: turnos, llamadas y resultados de herramientas, y la salida de los ganchos como adjunto `hook_additional_context`.",
          "panoma lo abre solo para leer. Cada archivo es una _fuente_ (`memory_sources`) con una identidad: tamaño, un hash de anclaje de los 256 bytes anteriores al cursor y, cuando lo hay, la versión del programa. Una truncación, una rotación o un prefijo reescrito abren una _generación_ nueva, y el cursor empieza otra vez en el tamaño encontrado.",
        ],
      },
      {
        h: "Tres grants sobre el permiso base de la fuente",
        p: [
          "El permiso base vive en `~/.panoma/twin.json`: si una fuente puede abrirse. Encima van los grants, cada uno `{ purpose, scope: project | global, generation, noticeVersion }`, y uno de proyecto gana al global.",
          "`memoryCapture`: en el aviso 1 el reader lee solo recibos y registros de ciclo de vida; en el aviso 2 —un consentimiento explícito nuevo— también los hechos tipados. `memoryExtract`: los turnos del dueño pueden ir al modelo; exige captura en el mismo ámbito (`409 consent_required` si no). `twinAutoLearn`: el Twin destila esos turnos por su cuenta; también exige captura.",
          "La frontera es por generación de flujo: un archivo anterior al grant empieza en el tamaño que tenía al verse (`preconsent`) y nunca se rebobina; un registro cortado en la frontera se excluye entero. Revocar cierra el trabajo en vuelo: los jobs del ámbito pasan a `obsolete / permission_revoked`.",
          "Terminal: `panoma memory allow <fuente> capture|extract|twin --all | --project <slug> [--notice 2]`, `revoke`, `backfill --from --until`. Puerta: la alternativa de grant de `POST /api/twin/sources`.",
        ],
        act: "allow",
      },
      {
        h: "La pasada de captura: hechos tipados con coordenadas",
        p: [
          "En cada latido del worker, tras la pasada de recibos, `runCapturePass` recorre las fuentes con grant desde su cursor. Escribe `session_facts` de ocho tipos: `read · edit · command · test_result · failure · commit · lifecycle · receipt_seen`, con payload validado por tipo y el intervalo de bytes de origen; nunca texto de la conversación. Los turnos del dueño no se almacenan: se leen del archivo cuando se abre una ventana.",
          "Presupuestos: 8 MiB y 250 ms por pasada, 16 MiB por minuto para el proceso. Un cursor por flujo y propósito, avanzado con compare-and-set sobre `rev` bajo un arrendamiento; una línea rota bloquea el cursor y se cruza en la visita siguiente como hueco anotado. Un puntero de `SessionEnd` (`POST /api/hook/session`) acelera; nunca es evidencia.",
        ],
      },
      {
        h: "La ventana: congelada antes de pagarla",
        p: [
          "`planWindows` decide sin pagar, por proyecto con los dos grants y por harness. Abre cuando el hecho o turno más nuevo tiene 30 min (`STABILITY_MS`), o hay 96 KiB pendientes (`PENDING_BYTES_TRIGGER`), o el más viejo lleva 4 h (`OLDEST_PENDING_MS`); y solo si la fuente está activa y fuera de la barrera de borrado, no hay job del proyecto en vuelo, hay señal útil (un turno tuyo o un hecho `edit`, `test_result` o `failure`) y la cola de revisión tiene sitio.",
          "El manifiesto se congela: intervalos de bytes por flujo `{ sourceId, generation, grantId, start, end, parserVersion }`, tus fragmentos como `frag:<sourceId>:<offset>:<len>:<sha256-16>`, las revisiones de la memoria ya aprobada como contexto (≤ 4 000 unidades UTF-16) y una foto de los permisos. Topes: 24 000 unidades de evidencia nueva, 128 KiB de prompt, cada turno tuyo ≤ 2 000 puntos de código, tras `redactQuote`; los turnos copiados por un relevo no entran; el texto del asistente jamás.",
          "El job (`memory_jobs`, procesador `project_extract`) tiene `UNIQUE (processor, work_key)` —la misma ventana dos veces es un solo job—, estados `pending → running → staged → complete` con `deferred`, `failed`, `cancelled` y `obsolete`, y autoridad por el par `(lease_token, rev)`.",
        ],
      },
      {
        h: "Una reserva en el libro, la llamada, y la propuesta",
        p: [
          "Antes de salir, la llamada es una fila de `model_calls` en estado `reserved` bajo `pg_advisory_xact_lock('model_calls:memory:<día>')`, con el recuento del día tomado bajo ese cerrojo (`reserveModelCall`). Familia `memory`: 12 llamadas al día (`PANOMA_DISTILL_BUDGET`); la extracción automática usa como mucho 4. Sin sitio: `deferred / budget` hasta mañana, con la ventana intacta.",
          "El proveedor se llama fuera de la base; la fila pasa a `sent`, `completed` o `uncertain` (que sigue contando: el proveedor pudo cobrar). Solo una reserva que nunca salió se libera. Como mucho una llamada de pago por latido.",
          "La respuesta se valida, se comparan las candidatas con las notas aprobadas, propuestas, descartadas e impugnadas del proyecto (caducadas incluidas) y las repetidas se descartan; una respuesta ilegible se reintenta una vez. La respuesta preparada se guarda con su cuota reservada antes de la fila (256 MiB por catálogo, 64 por proyecto: `PANOMA_MEMORY_QUOTA_MB`, `PANOMA_PROJECT_QUOTA_MB`).",
          "Cada candidata entra en `notes` como `proposed`, con las citas que la sostienen como referencias a fragmentos (coordenadas y hash, nunca el texto suelto) y su origen. La cola tiene tope: `NOTE_PENDING_MAX` = 20, y el planificador no abre ventanas mientras esté llena.",
          "Otros caminos a la misma cola: el agente por MCP con `panoma_remember` (una clave de agente solo propone), el destilador legado sobre una sesión cerrada (`legacy_session`), y el Twin, que propone criterios (`beliefs`) y no notas.",
        ],
      },
      {
        h: "decideNote: un gesto en pantalla",
        p: [
          "Aprobar o descartar pasa por `decideNote` detrás del guard de la pantalla (`sameOrigin`, operador), nunca detrás de una clave de agente. Las dos decisiones se fotografían en `memory_revisions` (`kind = note`, razón `approve` o `veto`): un no es un estado con número, no un borrado.",
          "Al aprobar puedes fijar `supersedesId` con `expectedPredecessorRev` (sustituye una nota anterior en la misma transacción; si movió, `stale_revision` y no se aprueba nada), `valid_until`, un disparador de ruta (nota dormida) y comprobaciones. Topes: `NOTE_MAX` 500, `NOTE_BUDGET` 2 000 despiertos por proyecto, `NOTE_SLEEPING_MAX` 30. La escritura humana se carga a la cuota y nunca se rechaza.",
        ],
        act: "decide",
      },
      {
        h: "Una unidad de memoria con revisión, comprobaciones y predicados",
        p: [
          "Cuatro tipos de unidad: `note` (regla del proyecto), `criterion` (`beliefs`, gusto, global o de proyecto), `decision` (`decision_episodes`, con su porqué y sus condiciones) y `commitment` (obligación con criterios de cumplimiento). Cada fila lleva `memory_rev` y una fotografía por revisión en `memory_revisions` —tipo, id, rev, payload, ámbito, autoridad, razón—, que es lo que una entrega y una mirada referencian.",
          "Una comprobación es `{ purpose, kind, target, expected }`: propósitos `grounds · applicability · violation · completion`; tipos `path_exists · file_hash · text_present · text_absent · manifest_script · direct_dependency · structured_key`; se leen, nunca se ejecutan. Un predicado tipado compone `all / any / not` sobre `project_is · path_under · operation_is · environment_is · task_kind_is · check_result_is`, y el selector lo juzga en tres valores: se sirve, se deja fuera (`not_applicable`) o viaja `conditional` con una línea `requires_check` por hecho que lo zanjaría.",
          "Una nota dormida lleva un disparador por segmentos de ruta y solo viaja cuando la ruta tocada lo cubre; una nota despierta viaja siempre. Nada caduca solo; nada se edita en el sitio.",
        ],
      },
      {
        h: "El Twin aprende por su cuenta: twinAutoLearn",
        p: [
          "Con el tercer grant, la pasada de captura abre un cursor `twin_extract` por flujo, y el worker encadena tres jobs por lotes: `twin_distill` (observaciones con la cita exacta y su `case_origin_key` = `<harness>:<sesión>:<destinatario>`), `twin_classify` (tema para las que no lo tenían) y `twin_synthesize` (creencias por tema cuya huella de evidencia se movió, para que el ciclo no se alimente a sí mismo). Una etapa de pago por vez, dentro del tope `read` y un subtope propio.",
          "El apoyo se cuenta en familias de origen (`SUPPORT_FAMILIES_FLOOR` = 3, además del suelo legado de 3 observaciones y 2 días o 2 proyectos): la misma sesión copiada en dos ventanas es una sola familia; una reacción ambigua no sostiene nada. Aprender y publicar son dos actos: con `publishInferred` apagado las inferencias esperan en el Twin como propuestas.",
          "Publicar pasa por un buzón durable (`taste_publish`) que compara TASTE.md antes de escribir y lo relee después; el archivo tiene tope `TASTE_CAP` = 3 000. TASTE.md se escucha antes de servir cualquier criterio: una línea borrada es un veto, una reescrita es tu firma con esas palabras (`reconcileWithFile`). Un criterio puede llevar condiciones y excepciones tipadas, que viajan dentro de la unidad como «Applies when / Except when». El bloque gestionado de AGENTS.md lleva el retrato a cada proyecto.",
        ],
      },
      {
        h: "La entrega: un contrato por sesión, con su oferta anotada",
        p: [
          "`SessionStart` (startup, resume, clear, compact) → `panoma brief` → `POST /api/hook/context` → `prepareMemory`. El selector va en este orden: elegibilidad (notas aprobadas no sustituidas ni caducadas, decisiones activas del dueño, criterios publicables y reconciliados con TASTE.md, nada bajo retirada o purga); el núcleo entero y sin clasificar (notas despiertas, criterios `core` = publicados, notas dormidas cuya ruta se va a tocar); rutas exactas; búsqueda léxica sobre todo el archivo elegible con `1 + ln(1 + N/df)` por palabra compartida; y por último los límites (100 por ruta, 200 tras la unión, continuación atada a una huella de revisiones).",
          "`packMemory` mete primero lo obligatorio y descarta lo opcional por el final al manifiesto con `channel_limit`; si el núcleo solo no cabe, el contrato es `incomplete`. El resultado es un `MemoryContractV2`: `items` enteros (tipo, id, revisión, ámbito, autoridad, texto, condiciones, excepciones), `checks`, `coverage`, `omissions`, `manifest`, `snapshot`, `continuation`, `status ∈ ready · requires_check · conflict · incomplete · unavailable`.",
          "La oferta se persiste en `servings` (esquema 2) antes de que salga un byte: `contentHash` (SHA-256 del JSON canónico), `renderedHash` (del texto exacto), el rango de bytes de cada unidad dentro del texto, y la foto de permisos; la confirmación relee el consentimiento y las revisiones en una transacción corta (`revisions_changed` si algo movió). Perfiles: `hook-brief-v1` 6 500 puntos de código y 24 KiB; `mcp-memory-v2` 24 KiB por `panoma_context` con `memoryVersion: 2`; `panoma_recall` lee cualquier unidad por tipo, id y revisión. El texto va dentro de la valla `untrusted_data` entre `panoma-memory <id> <hash16> begin` y `… end`.",
        ],
      },
      {
        h: "El recibo: los bytes de la oferta, encontrados en el transcript",
        p: [
          "El lector de recibos abre el transcript bajo el grant de captura y busca los adjuntos `hook_additional_context` cuyo contenido nombra la oferta, en la sesión nativa a la que se ató el contexto y en el sitio del canal (`SessionStart` para el parte). `checkReception` decide: `full` si el texto observado hashea igual o cada unidad está intacta en sus líneas; `partial`; `unknown` en un programa o sitio no verificados; `not_observed` si no hay nada de la oferta.",
          "Tres registros que prueban tres cosas distintas: la oferta (`servings`), el intento (`serving_events.attempt`: sent, failed, unknown, con latencia) y la recepción (`serving_events.reception`, con id de fuente, desplazamiento y clave de evento nativa). Los mismos bytes en un prompt, un resultado de herramienta o un README nunca son una recepción.",
          "La matriz de capacidades (`VERIFIED_HOSTS`) se rellena con tres evidencias separadas —gancho instalado, invocación observada, sitio de recibo verificado por una persona— y hoy dice: Claude Code 2.1.258 desde la app de escritorio, verificado; `cli`, desconocido; Codex, sin soporte para recibos. Todo se lee en `GET /api/memory/status` y `panoma memory status`.",
        ],
      },
      {
        h: "La patrulla, las incidencias y el olvido",
        p: [
          "`runPatrol` corre en las pasadas libres del worker, 2 s por proyecto y turno (`PATROL_BUDGET_MS`), mirando el disco fuera de toda transacción. `evaluateCheck` es puro: `pass · fail · unknown` con motivo, sin ejecutar nada; lo ilegible es `unknown`. Cada mirada es una observación en `memory_outcomes` con la ocurrencia (revisión, comprobación, entorno = HEAD, estado sucio y hashes) y caduca a los 10 min (`FRESHNESS_MS`).",
          "El propósito decide el efecto de un `fail`: `grounds` impugna la nota (deja de servirse y vuelve a ti con la prueba); `violation` abre una incidencia `inc_…` con tu veredicto `confirmed | false_positive`; `completion` solo observa, nunca cierra un compromiso. `deliveredBefore` es `yes` solo con una recepción `full` de esa revisión antes de la mirada, en el mismo contexto.",
          "Olvidar: `POST /api/memory/withdraw` (quita la elegibilidad, conserva los bytes) y `POST /api/memory/purge` (blanquea fotografías, ofertas y localizadores, conserva las coordenadas). Las dos previsualizan (`dryRun` → plan con recuentos y lo retenido) y se confirman con `planId` + `expectedRevision`, siguen el índice inverso de `memory_dependencies` en lotes de 200 y se anotan antes en `PANOMA_HOME/memory-deletions.jsonl` con fsync; si una copia restaurada no coincide con el diario, cuarentena: todas las puertas responden 503 hasta que una persona reconcilia.",
        ],
      },
    ],
    endTitle: "Las garantías, en una línea cada una",
    end: [
      "Ningún byte de un transcript se lee sin un grant en vigor para su ámbito, desde una frontera que nunca se rebobina.",
      "Ninguna unidad se sirve sin haberse aprobado (nota), firmado o publicado bajo tu sí (criterio) o decidido por ti (decisión); una clave de agente solo propone y lee.",
      "Cada entrega es una oferta con hash persistida antes de salir, y cada recepción es un registro encontrado en el archivo del harness, nunca una suposición.",
      "Lo que el disco contradice se impugna o abre una incidencia; lo que borras se previsualiza, se anota fuera de la base y se pone en cuarentena si una copia discrepa.",
    ],
    namesTitle: "Dónde leer más",
    names: [
      [
        "docs/memory-contract.md",
        "el contrato v2, el selector, las ofertas, los recibos, los grants y el olvido",
      ],
      ["docs/memory-capture.md", "hechos tipados, ventanas, jobs, reservas, cuota"],
      ["docs/memory-checks.md", "comprobaciones, patrulla, incidencias, compromisos, casos, predicados"],
      [
        "docs/twin-learning.md",
        "el tercer grant, las familias de apoyo, el buzón de TASTE.md, las condiciones de un criterio",
      ],
      ["docs/memory.md", "los cuatro pisos y un día con la memoria, paso a paso"],
    ],
  },
};

const en: MemoryCopy = {
  modeEasy: "Simple",
  modeTech: "Technical",
  kindLabel: "Kind of explanation",
  eyebrow: "Your sentence",
  pics: {
    p3a: "read 3 files",
    p3b: "changed 1 file",
    p3c: "tests: pass",
    p4a: "30 minutes idle",
    p5a: "Proposal",
  },
  allow: "Give the permissions",
  allowed: "Permissions given",
  approve: "Approve",
  discard: "Discard",
  easy: {
    title: "How a sentence of yours becomes something your agents remember",
    lede: "You write to your coding agent. This is, step by step and without jargon, what panoma does so that sentence ends up as a rule every one of your agents receives, and to check that they received it. Scroll to see it.",
    sentence: "“Keep the journal append-only until the migration finishes.”",
    proposalSentence: "“The journal stays append-only until the migration finishes.”",
    states: [
      "in the conversation",
      "saved in a file on your computer",
      "panoma cannot read it: your permission is missing",
      "read by panoma",
      "sent to the AI",
      "a proposal (not valid yet)",
      "waiting for your decision",
      "project rule · version 1",
      "project rule · and panoma learns your taste",
      "delivered to the agent",
      "confirmed: it arrived",
      "watched",
    ],
    stateAllowed: "panoma may read it now",
    stateDiscarded: "discarded: not valid, never repeated",
    allowNote: "Right now panoma cannot read anything. Turn the permissions on to see what happens next.",
    allowedNote: "With the permissions given, panoma may read the file and ask the AI. Keep scrolling.",
    discardedNote: "Discarded. panoma writes down your “no”, never proposes that same sentence again, and no agent will ever see it. Press Approve to see the whole path.",
    approvedNote: "Approved. From here on, the sentence is a rule of the project.",
    frames: [
      {
        h: "You write something to your agent",
        p: [
          "For example, to Claude Code: “Keep the journal append-only until the migration finishes.” It is a sentence inside a conversation, like any other.",
          "Nobody stores it as a rule. If you open another session tomorrow, the agent does not remember it.",
        ],
      },
      {
        h: "The conversation is saved in a file, on your computer",
        p: [
          "The agent writes down everything that happens — what you tell it and what it does — in a file. That file belongs to the agent and lives on your disk.",
          "panoma does not touch it: it may read it if you allow that, but it never writes into it.",
        ],
      },
      {
        h: "panoma cannot read that file until you allow it",
        p: [
          "You decide, agent by agent. And they are three separate permissions:",
          "**Permission to read** [[in panoma: capture]]: panoma may open the file and write down what the agent did — which files it touched, whether the tests passed. It never copies what was said.",
          "**Permission to ask the AI** [[in panoma: extraction]]: panoma may send your sentences — only yours, never the agent's — to an AI to look for rules in them.",
          "**Permission to learn your taste** [[in panoma: Twin]]: panoma may notice what you keep repeating and propose taste criteria (you will see it in step 9).",
          "Without the first, nothing is read. Without the second, nothing leaves your computer. This journey uses the first two.",
        ],
        act: "allow",
      },
      {
        h: "With permission, panoma reads the file and writes down what happened",
        p: [
          "Only a short list of facts, without the conversation's text: the agent read 3 files, changed 1, the tests passed.",
          "It reads a little at a time and in the background, so your computer is not slowed down.",
        ],
      },
      {
        h: "When the conversation has been idle for half an hour, it asks the AI",
        p: [
          "panoma gathers your sentences (masking any password) and the facts it wrote down, and asks the AI: is there anything here that should be a rule of this project?",
          "Asking costs money, so there is a cap: 12 questions a day at most. When the cap runs out, it waits for tomorrow.",
        ],
      },
      {
        h: "The AI proposes a rule",
        p: [
          "It returns a short sentence and points at the message of yours it came from.",
          "It is only a proposal: it counts for nothing yet and no agent sees it.",
        ],
      },
      {
        h: "You decide",
        p: [
          "The proposal shows up in the panoma app, in the project's Memory tab. Only you can approve or discard it: no agent can, not even with its key.",
          "There are never more than 20 proposals waiting, so reviewing them never becomes an endless chore.",
        ],
        act: "decide",
      },
      {
        h: "Now it is a rule of the project",
        p: [
          "Short (500 characters at most) and numbered: version 1. If you change it one day, panoma keeps how it was before.",
          "You can add details: which folder it applies to, what must stay true (for example, that a file exists) and until which date.",
        ],
      },
      {
        h: "panoma also learns how you like things done",
        p: [
          "With the third permission, panoma notices what you tell your agents again and again — “short answers”, “no colours outside the colour file” — and turns it into taste criteria. That part of panoma is called the [[Twin]].",
          "The criteria are written into a file of yours, TASTE.md, which the agents receive too. You can edit it by hand: delete a line and panoma reads it as a no; rewrite one and it reads it as a yes in your own words.",
          "A new criterion publishes itself only when panoma has seen it in at least three different conversations and you have said, once, that it may. Otherwise it waits for your yes like any proposal.",
        ],
      },
      {
        h: "The next time an agent starts, it receives the rules before your first message",
        p: [
          "panoma gathers the project's rules and your taste criteria into one package and hands it to the agent when the session opens.",
          "Before handing it over, it keeps a copy of exactly what it sent, with a fingerprint: a unique code that identifies that content.",
        ],
      },
      {
        h: "panoma checks that it really arrived",
        p: [
          "Later it looks at the file of that new conversation and searches for the package, byte by byte, in the place where the agent stores what it receives.",
          "If it is there: it arrived whole. If it is missing or partial, panoma writes that down as it is. It does not trust; it checks.",
        ],
      },
      {
        h: "And it keeps watching",
        p: [
          "A rule can stop being true. panoma checks your files every so often: if the rule said “this file exists” and it no longer does, it sets the rule aside and tells you, with the evidence.",
          "And if one day you want to delete a rule, panoma shows you first what it is going to delete and writes it into a log.",
        ],
      },
    ],
    endTitle: "In short",
    end: [
      "Nothing is read without your permission, and permission is given agent by agent.",
      "Nothing becomes a rule without your yes.",
      "Every rule and every criterion reaches the agent when the session starts, and panoma checks in the agent's own file that they arrived.",
      "What stops being true is set aside, and you are told.",
    ],
    namesTitle: "What each thing is called inside panoma",
    names: [
      ["capture", "the permission to read the conversation file and write down what happened"],
      ["extraction", "the permission to send your sentences to the AI"],
      ["Twin", "the part of panoma that learns your taste, and the third permission"],
      ["proposal", "a rule waiting for your yes"],
      ["note", "an approved rule of the project"],
      ["criterion", "a taste of yours, written in TASTE.md"],
      ["contract", "the package of rules and criteria the agent receives when it starts"],
      ["receipt", "the check that the package arrived"],
      ["patrol", "the check that the rules are still true"],
    ],
  },
  tech: {
    title: "panoma's memory, from the inside",
    lede: "The same journey with the real names, tables, limits and doors. Every figure is a constant in the code; every state, a column. For whoever wants to know exactly what happens to one turn of yours, from the transcript to the receipt.",
    sentence: "“Keep the journal append-only until the migration finishes.”",
    proposalSentence: "“The journal stays append-only until the migration finishes.”",
    states: [
      "owner turn in the transcript",
      "a user record in the harness's .jsonl",
      "no grant: byte never read",
      "session_facts written; turn read within its interval",
      "window frozen · project_extract job staged",
      "notes.status = proposed",
      "awaiting decideNote",
      "notes.status = approved · memory_rev 1",
      "beliefs (criteria) · TASTE.md",
      "servings: offer srv_… with contentHash",
      "serving_events: reception full",
      "memory_outcomes: pass",
    ],
    stateAllowed: "capture + extract grants in force",
    stateDiscarded: "notes.status = discarded",
    allowNote: "Without a grant there is no read: the reader skips the whole source. Turn the grants on to continue.",
    allowedNote: "memoryCapture (notice 2) and memoryExtract grants in force for the scope. Keep scrolling.",
    discardedNote: "discarded: photographed in memory_revisions with its rev; the extractor's duplicate check reads it (expired ones included) and never proposes the same sentence again.",
    approvedNote: "approved: memory_rev 1, a photograph in memory_revisions, bytes charged to memory_usage. From here on it is an eligible unit for the selector.",
    frames: [
      {
        h: "A turn of yours in the harness",
        p: [
          "A `user` record in the conversation with Claude Code or Codex. panoma does not intercept the prompt: there is no hook on it.",
          "The only thing that already happened is at session start: the `SessionStart` hook ran `panoma brief`, which asked for the project's memory contract and printed it into the context (step 10). That contract was written down as an offer before it left.",
        ],
      },
      {
        h: "The transcript: a file of the harness, on your disk",
        p: [
          "Claude Code writes `~/.claude/projects/<folder>/<session>.jsonl` (and `<session>/subagents/*.jsonl` for subagents); Codex, `~/.codex/sessions/**/*.jsonl`. Each line is a record: turns, tool calls and results, and the hooks' output as a `hook_additional_context` attachment.",
          "panoma opens it to read only. Each file is a _source_ (`memory_sources`) with a file identity: size, an anchor hash of the 256 bytes before the cursor and, when known, the program version. A truncation, a rotation or a rewritten prefix opens a new _generation_, and the cursor starts again at the size found.",
        ],
      },
      {
        h: "Three grants on top of the source's base permission",
        p: [
          "The base permission lives in `~/.panoma/twin.json`: whether a source may be opened at all. Grants sit on top, each `{ purpose, scope: project | global, generation, noticeVersion }`, and a project grant wins over a global one.",
          "`memoryCapture`: at notice 1 the reader takes only receipts and lifecycle records; at notice 2 — an explicit re-consent — the typed facts too. `memoryExtract`: the owner's turns may go to the model; it requires capture on the same scope (`409 consent_required` otherwise). `twinAutoLearn`: the Twin distils those turns on its own; it requires capture as well.",
          "The boundary is per stream generation: a file older than the grant starts at the size it had when first seen (`preconsent`) and is never rewound; a record cut at the boundary is excluded whole. Revoking fences the work in flight: the scope's jobs become `obsolete / permission_revoked`.",
          "Terminal: `panoma memory allow <source> capture|extract|twin --all | --project <slug> [--notice 2]`, `revoke`, `backfill --from --until`. Door: the grant alternative of `POST /api/twin/sources`.",
        ],
        act: "allow",
      },
      {
        h: "The capture pass: typed facts with coordinates",
        p: [
          "On every worker heartbeat, after the receipt pass, `runCapturePass` walks the granted sources from their cursors. It writes `session_facts` of eight kinds — `read · edit · command · test_result · failure · commit · lifecycle · receipt_seen` — with a payload validated per kind and the byte interval it came from; never conversation text. The owner's turns are not stored: they are read from the file when a window opens.",
          "Budgets: 8 MiB and 250 ms per pass, 16 MiB a minute for the process. One cursor per stream and purpose, advanced by compare-and-set on `rev` under a lease; a torn line blocks the cursor and is crossed on the next visit as a recorded gap. A `SessionEnd` pointer (`POST /api/hook/session`) accelerates; it is never evidence.",
        ],
      },
      {
        h: "The window: frozen before it is paid for",
        p: [
          "`planWindows` decides without paying, per project with both grants and per harness. It opens when the newest fact or turn is 30 min old (`STABILITY_MS`), or 96 KiB are pending (`PENDING_BYTES_TRIGGER`), or the oldest is 4 h old (`OLDEST_PENDING_MS`); and only if the source is active and outside the deletion barrier, no job of the project is in flight, there is a useful signal (a turn of yours or an `edit`, `test_result` or `failure` fact) and the review queue has room.",
          "The manifest is frozen: byte intervals per stream `{ sourceId, generation, grantId, start, end, parserVersion }`, your fragments as `frag:<sourceId>:<offset>:<len>:<sha256-16>`, the revisions of the memory already approved as context (≤ 4,000 UTF-16 units) and a snapshot of the permissions. Caps: 24,000 units of new evidence, a 128 KiB prompt, each turn of yours ≤ 2,000 code points after `redactQuote`; turns copied by a handoff stay out; the assistant's text never enters.",
          "The job (`memory_jobs`, processor `project_extract`) has `UNIQUE (processor, work_key)` — the same window twice is one job —, states `pending → running → staged → complete` with `deferred`, `failed`, `cancelled` and `obsolete`, and authority by the pair `(lease_token, rev)`.",
        ],
      },
      {
        h: "A reservation in the ledger, the call, and the proposal",
        p: [
          "Before it leaves, the call is a `model_calls` row in state `reserved` under `pg_advisory_xact_lock('model_calls:memory:<day>')`, with the day's count taken under that lock (`reserveModelCall`). Family `memory`: 12 calls a day (`PANOMA_DISTILL_BUDGET`); automatic extraction uses at most 4. No room: `deferred / budget` until tomorrow, with the window intact.",
          "The provider is called outside the database; the row moves to `sent`, `completed` or `uncertain` (which keeps counting: the provider may have charged). Only a reservation that never left is released. At most one paid call per heartbeat.",
          "The answer is validated, candidates are compared with the project's approved, proposed, discarded and challenged notes (expired included) and repeats are dropped; an unreadable answer is retried once. The staged answer is stored with its quota reserved before the row (256 MiB per catalog, 64 per project: `PANOMA_MEMORY_QUOTA_MB`, `PANOMA_PROJECT_QUOTA_MB`).",
          "Each candidate enters `notes` as `proposed`, with the quotes that support it as fragment references (coordinates and a hash, never loose text) and its origin. The queue is capped: `NOTE_PENDING_MAX` = 20, and the planner opens no window while it is full.",
          "Other roads to the same queue: the agent over MCP with `panoma_remember` (an agent key only proposes), the legacy distiller over a closed session (`legacy_session`), and the Twin, which proposes criteria (`beliefs`), not notes.",
        ],
      },
      {
        h: "decideNote: a gesture on the screen",
        p: [
          "Approving or discarding goes through `decideNote` behind the screen's guard (`sameOrigin`, operator), never behind an agent key. Both decisions are photographed in `memory_revisions` (`kind = note`, reason `approve` or `veto`): a no is a state with a number, not an erasure.",
          "On approval you may set `supersedesId` with `expectedPredecessorRev` (it replaces an earlier note in the same transaction; if that one moved, `stale_revision` and nothing is approved), `valid_until`, a path trigger (a sleeping note) and checks. Caps: `NOTE_MAX` 500, `NOTE_BUDGET` 2,000 awake per project, `NOTE_SLEEPING_MAX` 30. A human write is charged to the quota and never refused.",
        ],
        act: "decide",
      },
      {
        h: "A memory unit with a revision, checks and predicates",
        p: [
          "Four unit kinds: `note` (a project rule), `criterion` (`beliefs`, taste, global or per project), `decision` (`decision_episodes`, with its rationale and conditions) and `commitment` (an obligation with completion criteria). Every row carries `memory_rev` and one photograph per revision in `memory_revisions` — kind, id, rev, payload, scope, authority, reason — which is what a delivery and a look refer to.",
          "A check is `{ purpose, kind, target, expected }`: purposes `grounds · applicability · violation · completion`; kinds `path_exists · file_hash · text_present · text_absent · manifest_script · direct_dependency · structured_key`; read, never run. A typed predicate composes `all / any / not` over `project_is · path_under · operation_is · environment_is · task_kind_is · check_result_is`, and the selector judges it in three values: served, left out (`not_applicable`), or delivered `conditional` with one `requires_check` line per fact that would settle it.",
          "A sleeping note carries a trigger by path segments and travels only when the touched path is covered; an awake note always travels. Nothing expires on its own; nothing is edited in place.",
        ],
      },
      {
        h: "The Twin learns on its own: twinAutoLearn",
        p: [
          "With the third grant, the capture pass opens a `twin_extract` cursor per stream, and the worker chains three batch jobs: `twin_distill` (observations with the exact quote and their `case_origin_key` = `<harness>:<session>:<recipient>`), `twin_classify` (a topic for those without one) and `twin_synthesize` (beliefs per topic whose evidence fingerprint moved, so the cycle never feeds itself). One paid stage at a time, inside the `read` cap and a subquota of its own.",
          "Support is counted in origin families (`SUPPORT_FAMILIES_FLOOR` = 3, on top of the legacy floor of 3 observations and 2 days or 2 projects): the same session copied into two windows is one family; an ambiguous reaction supports nothing. Learning and publishing are two acts: with `publishInferred` off, inferences wait in the Twin as proposals.",
          "Publishing goes through a durable outbox (`taste_publish`) that compares TASTE.md before writing and reads it back after; the file is capped at `TASTE_CAP` = 3,000. TASTE.md is heard before any criterion is served: a deleted line is a veto, a rewritten line is your signature on those words (`reconcileWithFile`). A criterion may carry typed conditions and exceptions, which travel inside the unit as “Applies when / Except when”. The managed AGENTS.md block carries the portrait to every project.",
        ],
      },
      {
        h: "Delivery: one contract per session, its offer written down",
        p: [
          "`SessionStart` (startup, resume, clear, compact) → `panoma brief` → `POST /api/hook/context` → `prepareMemory`. The selector runs in this order: eligibility (approved notes neither superseded nor expired, the owner's active decisions, publishable criteria reconciled with TASTE.md, nothing under a withdrawal or purge); the core whole and unranked (awake notes, `core` criteria = published, sleeping notes whose path is about to be touched); exact routes; a lexical search over the whole eligible archive scoring `1 + ln(1 + N/df)` per shared word; and only then the limits (100 per route, 200 after the union, a continuation bound to a fingerprint of the revisions).",
          "`packMemory` places the required units first and drops optional ones from the end into the manifest with `channel_limit`; if the core alone does not fit, the contract is `incomplete`. The result is a `MemoryContractV2`: whole `items` (kind, id, revision, scope, authority, text, conditions, exceptions), `checks`, `coverage`, `omissions`, `manifest`, `snapshot`, `continuation`, `status ∈ ready · requires_check · conflict · incomplete · unavailable`.",
          "The offer is persisted in `servings` (schema 2) before a byte leaves: `contentHash` (SHA-256 of the canonical JSON), `renderedHash` (of the exact text), each unit's byte range inside the text, and the permission snapshot; the confirmation re-reads consent and revisions in a short transaction (`revisions_changed` if anything moved). Profiles: `hook-brief-v1` 6,500 code points and 24 KiB; `mcp-memory-v2` 24 KiB over `panoma_context` with `memoryVersion: 2`; `panoma_recall` reads any unit by kind, id and revision. The text travels inside the `untrusted_data` fence between `panoma-memory <id> <hash16> begin` and `… end`.",
        ],
      },
      {
        h: "The receipt: the offer's bytes, found in the transcript",
        p: [
          "The receipt reader opens the transcript under the capture grant and looks for `hook_additional_context` attachments whose content names the offer, in the native session the context was bound to and at the channel's site (`SessionStart` for the brief). `checkReception` decides: `full` when the observed text hashes the same or every unit is intact on its own lines; `partial`; `unknown` on an unverified program or site; `not_observed` when nothing of the offer is there.",
          "Three records proving three different things: the offer (`servings`), the attempt (`serving_events.attempt`: sent, failed, unknown, with latency) and the reception (`serving_events.reception`, with the source id, the offset and the native event key). The same bytes in a prompt, a tool result or a README are never a reception.",
          "The capability matrix (`VERIFIED_HOSTS`) is filled from three separate pieces of evidence — a hook installed, an invocation observed, a receipt site verified by a person — and today says: Claude Code 2.1.258 from the desktop app, verified; `cli`, unknown; Codex, unsupported for receipts. All of it is read at `GET /api/memory/status` and `panoma memory status`.",
        ],
      },
      {
        h: "The patrol, incidents and forgetting",
        p: [
          "`runPatrol` runs in the worker's free passes, 2 s per project and turn (`PATROL_BUDGET_MS`), looking at the disk outside any transaction. `evaluateCheck` is pure: `pass · fail · unknown` with a reason, nothing executed; the unreadable is `unknown`. Each look is an observation in `memory_outcomes` keyed by occurrence (revision, check, environment = HEAD, dirty state and hashes), stale after 10 min (`FRESHNESS_MS`).",
          "The purpose decides what a `fail` does: `grounds` challenges the note (it stops being served and comes back to you with the evidence); `violation` opens an incident `inc_…` with your verdict `confirmed | false_positive`; `completion` only observes and never closes a commitment. `deliveredBefore` is `yes` only with a `full` reception of that revision before the look, in the same context.",
          "Forgetting: `POST /api/memory/withdraw` (takes eligibility away, keeps the bytes) and `POST /api/memory/purge` (blanks photographs, offers and locators, keeps the coordinates). Both preview (`dryRun` → a plan with counts and what is retained) and confirm with `planId` + `expectedRevision`, follow the reverse index in `memory_dependencies` in batches of 200, and are appended first to `PANOMA_HOME/memory-deletions.jsonl` with fsync; a restored copy that disagrees with the journal puts the memory in quarantine: every door answers 503 until a person reconciles.",
        ],
      },
    ],
    endTitle: "The guarantees, one line each",
    end: [
      "No byte of a transcript is read without a grant in force for its scope, from a boundary that is never rewound.",
      "No unit is served without having been approved (a note), signed or published under your yes (a criterion) or decided by you (a decision); an agent key only proposes and reads.",
      "Every delivery is a hashed offer persisted before it leaves, and every reception is a record found in the harness's own file, never an assumption.",
      "What the disk contradicts is challenged or opens an incident; what you delete is previewed, journaled outside the database and quarantined when a copy disagrees.",
    ],
    namesTitle: "Where to read more",
    names: [
      ["docs/memory-contract.md", "contract v2, the selector, offers, receipts, grants and forgetting"],
      ["docs/memory-capture.md", "typed facts, windows, jobs, reservations, the quota"],
      ["docs/memory-checks.md", "checks, the patrol, incidents, commitments, cases, predicates"],
      [
        "docs/twin-learning.md",
        "the third grant, support families, the TASTE.md outbox, a criterion's conditions",
      ],
      ["docs/memory.md", "the four floors and a day with the memory, step by step"],
    ],
  },
};

export const MEMORY_COPY: Record<Locale, MemoryCopy> = { es, en };
