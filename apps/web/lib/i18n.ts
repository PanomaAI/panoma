/**
 * The interface texts, in Spanish and in English.
 *
 * Without a library: two flat dictionaries and a function that looks up the key. The compiler does
 * the job that the framework would do — `MessageKey` comes out of the Spanish dictionary with
 * `satisfies`, so a key that is missing or extra in English does not compile, and a key misspelled
 * in a component neither. Spanish is the reference language: the product was born here and the
 * texts are written here first.
 *
 * The keys with a gap use `{name}` and are filled in with the third argument of `t`. There are no
 * automatic plurals or date formats: where the text changes with the number, there are two keys
 * and the component decides, which is the one that has the number in front.
 */

export type Locale = "es" | "en";

/**
 * The cookie that saves the chosen language. It is written by the footer selector and read by
 * `getLocale`.
 */
export const LOCALE_COOKIE = "panoma-lang";

const es = {
  /*
    The description of the document: what appears when sharing a link from the app and what a
    screen reader reads when announcing the page. It is for the entire site, so it does not refer
    to any specific screen. The landing page has its own, written separately.
   */
  "meta.description":
    "Tu catálogo personal de software. Abre, revisa y mantén al día cada proyecto.",

  /*
    The fallen watcher. It is not said what the cause is —the why comes from the server in fixed
    Spanish and this is read in two languages— but what ceases to be true in the meantime, which
    is the only thing the reader needs to decide whether to scan again.
   */
  "watch.off":
    "El vigía no está en marcha: los proyectos nuevos y los commits de hoy pueden no aparecer hasta que vuelvas a escanear.",

  /*
    The catalog that doesn't open, which is the worst thing that can happen here.
    Only the facts come from the server —the route and what the database reported—; the sentence is
    composed here, in the language that is being read. That is the difference with `watch.off`,
    which gave up on telling the cause precisely because it could not translate it.
    It also says 'do not delete anything' because the first thing someone who reads 'do not open'
    does is delete the folder, and inside are their data.
   */
  "catalog.down.title": "El catálogo no abre",
  "catalog.down.body":
    "La web sigue en pie, pero sin datos. Aparta {path} con otro nombre y vuelve a arrancar: se crea uno nuevo y se rellena con «{cli} scan». No borres nada: si algún día se puede rescatar, será de ahí.",
  "catalog.down.detail": "Lo que dijo la base: {detail}",

  /*
    The error page, for when what broke is not the database. In production, the real message does
    not reach the browser —Next replaces it with a generic one and a digest—, so here it is not
    promised to explain the cause: it is offered to try again.
   */
  "error.title": "Algo se rompió al pintar esta página",
  "error.body":
    "No es el catálogo: eso se avisa aparte. Vuelve a intentarlo, y si insiste, el motivo está en el registro del servidor.",
  "error.retry": "Reintentar",

  // Frame: top bar, side, and foot.
  "shell.brandHome": "Panoma · Inicio",
  "shell.searchPlaceholder": "Buscar proyectos, tecnologías o agentes",
  "shell.openPalette": "Abrir la paleta de comandos",
  "shell.topNav": "Navegación principal",
  "shell.sections": "Secciones de Panoma",
  /*
    The first tab of the page. See `.skip-link` in `base.css` and the layout comment: in front of
    the content there are twenty keyboard stops, and without this you have to go through them ALL
    on each page that is opened.
   */
  "shell.skipToContent": "Saltar al contenido",
  "shell.localAccount": "Cuenta local",
  /*
    What the corner button panel says. It is the promise of the product, not filler so that the
    button has something to show.
   */
  "shell.accountNone":
    "No hay cuenta ni nube que administrar: panoma corre en este ordenador y el catálogo se queda aquí.",
  /*
    The one thing worth saying about this installation, when it is true.

    It is not a trial. Under `npx` this is the same package, byte for byte, with nothing limited
    and nothing that expires; what is temporary is the command, and claiming more would be a lie
    the rest of this product does not tell.

    It goes here, in the panel that already answers «what is this installation», and not in a
    banner across the top: nothing is wrong, and a permanent warning about a healthy state becomes
    furniture by the second day. A modal was considered and refused for a reason already paid for
    on the landing page, where a seven-second scroll lock was removed because people read it as
    the page being broken.
   */
  "shell.ephemeral": "Esta copia es temporal",
  "shell.ephemeralDetail":
    "La arrancaste con npx, que la guarda para un comando y la suelta. El catálogo se queda; el comando no. Para tenerlo: npm i -g panoma — y después reinicia el catálogo, o esta pantalla seguirá escribiendo «npx panoma» en cada comando que te dé.",
  "shell.pending": "{n} pendiente{s}",
  "shell.setupLeft": "quedan {n} paso{s} por encender",
  "shell.summary": "Resumen del catálogo",
  "shell.summaryProjects": "{n} proyecto{s}",
  "shell.summaryScope": "en tu catálogo",
  "shell.live": "activos",
  "shell.paused": "en pausa",
  "shell.dormant": "dormidos",
  /*
    “without git” and not “without repository”: it is the word that is read on the card and on the
    grid, and the label must be searchable exactly as it is on the screen next to it.
   */
  "shell.noGit": "sin git",
  "shell.copies": "copias",
  "shell.hidden": "ocultos",
  "shell.footerLocal": "Catálogo local",
  "shell.footerPrivate": "Privado por diseño",
  "shell.footerSource": "AGPL-3.0 · código fuente",
  "shell.language": "Idioma",
  /*
    They don't say 'hide' because the bar no longer hides: when folded it stays in the icon tray.
    Promising that something disappears and leaving it in view is as confusing as the opposite.
   */
  "shell.hideSidebar": "Plegar menú",
  "shell.showSidebar": "Desplegar menú",

  // Navigation: short labels of the bars.
  "nav.projects": "Proyectos",
  "nav.unsaved": "Sin guardar",
  "nav.searchCode": "Código",
  "nav.credentials": "Claves",
  /*
    It says "MCP" and not "Agents" because that is what is being searched for: whoever comes to
    this page comes to wire their agent, and that word is the one used by Claude Code, Cursor, and
    Codex in their own settings. The key continues to be called `nav.agents` on purpose: it names
    the destination — the path is `/agents` — not the label, which can change.
   */
  "nav.agents": "MCP",
  "nav.ai": "IA",
  "nav.packages": "Paquetes",
  "nav.activity": "Ejecuciones",
  "nav.copies": "Copias",
  "nav.bridge": "Puente",
  "dest.bridge": "Puente de mando",
  "bridge.title": "Encender panoma, paso a paso",
  "bridge.titleReady": "Todo encendido",
  /*
    The lead says what is at stake and not only what the screen is.
    This page is the answer to «why isn't this doing anything», and it was written as a tour: every
    piece with its state. Whoever had not yet realised there was something to switch on read that
    as a dashboard and left. The first sentence now names the stake, because the reader who most
    needs this screen is exactly the one who does not know they need it.
   */
  "bridge.lead": "Panoma no está entero hasta que estos pasos estén dados: hasta entonces hay piezas que sencillamente no funcionan. Cada una con su estado y un solo siguiente paso señalado — nada de adivinar comandos: lo que toca ahora lleva una flecha, y lo demás espera su turno.",
  "bridge.leadReady": "El catálogo, el modelo, los agentes y los ganchos están en marcha. Desde aquí solo queda ver la memoria respirar — y decidir en las fichas lo que los agentes propongan.",
  "bridge.step.catalog.title": "El catálogo",
  "bridge.step.catalog.detail": "proyectos: {count}",
  "bridge.step.catalog.pending": "Escanea una carpeta con tus proyectos. Un solo comando los analiza y arranca esta web.",
  "bridge.step.model.title": "Un modelo de IA",
  "bridge.step.model.detail": "conectados: {count}",
  "bridge.step.model.pending": "El crítico, el destilador y el doble necesitan un modelo. Conecta un proveedor o exporta una clave.",
  "bridge.step.model.go": "Ir a la pantalla de IA",
  "bridge.step.agent.title": "Un agente conectado",
  "bridge.step.agent.detail": "activos: {count}",
  "bridge.step.agent.pending": "Conecta tu agente (Claude Code, Cursor…) para que reciba el parte, la memoria y las nueve herramientas.",
  "bridge.step.agent.keyUnused": "La clave existe pero ningún agente la ha usado todavía: instala la configuración y reinicia la sesión del agente.",
  "bridge.step.agent.go": "Ir a la pantalla de Agentes",
  "bridge.step.hooks.title": "Los ganchos",
  /*
    «of {total}» is the ones that can carry a hook, not the whole catalog. A folder without git has
    nowhere to keep one, and counting it invented a debt that could never be paid: 44 of 76, with
    the hook in all 44 that had git, read as unfinished for ever.
   */
  "bridge.step.hooks.detail": "con gancho: {count} de {total} que pueden llevarlo",
  "bridge.step.hooks.pending": "Dentro de cada proyecto donde trabajes: apuntan la actividad sin que el modelo se acuerde, y entregan las notas dormidas en su ruta.",
  "bridge.step.alive.title": "La memoria, viva",
  "bridge.step.alive.detail": "entradas de bitácora: {count}",
  /*
    The journal, which is the one thing on this page nobody here can press.

    It fills when an agent working in a project calls `panoma_log` — and it said «it turns on by
    itself once the rest is running», which is true and tells the reader nothing they can act on.
    Somebody with all four of their own parts done, reading that, is looking for the button. There
    is no button. So the tool is named, and what makes an agent reach for it.
   */
  "bridge.step.alive.pending": "Esta no es tuya: la llena un agente. Cuando termine algo que se sostenga solo en uno de tus proyectos, llama a la herramienta {tool} y aquí aparece la primera entrada — pídeselo si no lo hace por su cuenta. A partir de ahí el destilador propone y tú decides.",
  "bridge.restartHint": "Después de instalar, reinicia la sesión del agente: una sesión ya abierta no recoge nada.",
  "bridge.todayTitle": "Los números de hoy",
  "bridge.stat.journal": "Bitácora",
  "bridge.stat.approved": "Notas servidas",
  "bridge.stat.sleeping": "Notas dormidas",
  "bridge.stat.pending": "Propuestas esperando",
  "bridge.stat.consultations": "Preguntas al doble",
  "bridge.stat.watcher": "Vigía",
  "bridge.stat.ablation": "Báscula (ablación)",
  "bridge.on": "encendido",
  "bridge.off": "apagado",
  "bridge.copy": "copiar",
  "bridge.copied": "copiado",
  "bridge.step.hooks.install": "Ponerlos en todos los proyectos",
  "bridge.step.hooks.installing": "Poniendo los ganchos…",
  "bridge.hooksDone": "Hecho — con ganchos: {installed} · sin repositorio: {noRepo} · ajenos respetados: {foreign} · fallos: {failed}",
  "bridge.hooksAlt": "O desde el terminal, proyecto a proyecto:",
  "bridge.hooksNoCli": "El servidor no encuentra el comando panoma: ponlos desde el terminal con el comando de al lado.",
  "projectHooks.on": "Ganchos puestos: la bitácora de este proyecto se escribe sola.",
  "projectHooks.off": "Sin ganchos: el catálogo solo sabrá lo que el agente se acuerde de contarle.",
  "projectHooks.install": "Ponerlos",
  "bridge.scaleHint": "La medida fina —si la memoria reduce correcciones de verdad— vive en GET /api/scale.",
  "nav.disk": "Disco",
  "nav.twin": "Twin",
  "nav.hidden": "Apartados",

  // The same destinations with their long name, for the palette.
  /*
    Use both words because the palette filters by the label and by nothing else: with just "MCP",
    typing "agent" stopped finding the page that lists them.
   */
  "dest.agents": "MCP: conectar tus agentes",
  "dest.unsaved": "Trabajo sin guardar",
  "dest.disk": "Espacio en disco",
  "dest.twin": "Tu doble: el retrato de tu gusto",
  "dest.searchCode": "Buscar en el código",
  "dest.credentials": "Credenciales en el historial",
  "dest.hidden": "Ocultos y excluidos",
  "dest.ai": "Con qué piensa Panoma",

  // Paleta de comandos.
  "palette.aria": "Paleta de comandos",
  "palette.placeholder": "Busca un proyecto o escribe una acción…",
  "palette.searchAria": "Buscar en el catálogo",
  "palette.loading": "cargando el catálogo…",
  "palette.noMatch": "Nada coincide con «{query}».",
  /*
    Only a screen reader hears it: the list changes with each letter and, without this, someone
    who doesn't see it types blindly without knowing if anything is underneath. The `{s}` gap is
    solved `t()` by looking `{n}` — see `shapeFor` below.
   */
  "palette.results": "{n} resultado{s}",
  "palette.groupProjects": "Proyectos",
  "palette.groupActions": "Acciones",
  "palette.groupGoTo": "Ir a",
  "palette.openFolderOf": "Abrir la carpeta de {name}",
  "palette.searchEverywhere": "Buscar «{query}» en el código de todos los proyectos",
  "palette.opening": "abriendo {name}…",
  "palette.openFailed": "No se pudo abrir.",
  "palette.unreachable": "No se pudo contactar con el servidor.",
  "palette.enterEditor": "↵ abrir en el editor",
  "palette.enterCard": "↵ ver la ficha",
  "palette.openTerminalOf": "Abrir un terminal en {name}",
  "palette.openCardOf": "Ver la ficha de {name}",
  "palette.keysMove": "↑↓ moverse",
  /*
    «↵ open» lied halfway since ↵ opens the editor: in a project row it does not open the card,
    and in «Go to Packages» it opens nothing, it navigates. What ↵ does in all the rows is stay
    with the selected one; what happens next is indicated by the cue of that same row.
   */
  "palette.keysOpen": "↵ elegir",
  "palette.keysClose": "esc cerrar",

  // Cover without catalog.
  "home.emptyKicker": "Catálogo vacío",
  "home.emptyTitle": "Aún no has escaneado nada",
  "home.emptyBody":
    "Analiza una carpeta con tus proyectos para llenar el catálogo. El escaneo es local y solo guarda metadatos: tu código nunca sale del disco.",

  /*
    The risks of working without saving, written here and not in the engine.
    The engine returns the fact —the code and the number— since it was seen that the interface in
    English said 'Needs attention' and below 'no remote · 4 commits only on this disk'. An engine
    that drafts forces translation in the wrong place.
   */
  "activityKind.change": "cambio",
  "activityKind.decision": "decisión",
  "activityKind.note": "nota",
  "activityKind.blocker": "bloqueo",
  "taskState.open": "abierta",
  "taskState.in-progress": "en curso",
  "taskState.done": "hecha",
  "taskState.discarded": "descartada",
  "severity.critical": "crítica",
  "severity.high": "alta",
  "severity.medium": "media",
  "severity.low": "baja",
  "severity.unknown": "desconocida",
  "run.pending": "pendiente",
  "run.running": "ejecutando",
  "run.proposed": "propuesto",
  "run.failed": "fallido",
  "run.no-changes": "sin cambios",
  "run.applied": "aplicado",
  "run.discarded": "descartado",
  "risk.unversioned": "sin control de versiones",
  "risk.no-commits": "repositorio sin ningún commit",
  "risk.no-commits.n": "{n} fichero{s} y ningún commit",
  "risk.no-remote": "sin remoto · {n} commit solo en este disco",
  "risk.no-remote.n": "sin remoto · {n} commit{s} solo en este disco",
  "risk.unpushed": "{n} commit sin subir",
  "risk.unpushed.n": "{n} commit{s} sin subir",
  "risk.uncommitted": "{n} fichero sin commitear",
  "risk.uncommitted.n": "{n} fichero{s} sin commitear",
  "risk.untracked": "{n} sin añadir a git",
  "risk.stashes": "{n} stash guardado",
  "risk.stashes.n": "{n} stash{es} guardado{s}",
  "risk.behind": "{n} commit por traer",
  "risk.behind.n": "{n} commit{s} por traer",

  // Cover: header, work hazard notice, filters and tools.
  "store.kicker": "Explorar",
  "store.title": "Descubre lo que has construido",
  "store.subtitle": "Tu catálogo personal de software. Abre, revisa y mantén al día cada proyecto.",
  "store.spotlight": "Resumen destacado",
  "store.review": "Revisar",
  "filter.all": "Todos",
  "filter.attention": "Atención",
  "filter.favorites": "Favoritos",
  "filter.notMine": "No es mío",
  "filter.web": "Web",
  "filter.mobile": "Móvil",
  "filter.backend": "Backend",
  "filter.tools": "Herramientas",
  "filter.ai": "IA",
  "filter.other": "Otros",
  "store.filterAria": "Filtrar proyectos",
  "store.hideNames": "Ocultar nombres e iconos",
  "store.showNames": "Volver a enseñar nombres e iconos",
  "store.hidden": "Proyecto {n}",

  // Compartir tu panorama. Ver `components/compartir.ts`.
  "share.abrir": "Compartir mi panorama",
  "share.cerrar": "Cerrar",
  "share.preview": "Vista previa de la tarjeta",
  "share.titulo": "{n} proyecto{s} creados.",
  "share.proyectos": "proyectos en total",
  "share.tecnologias": "tecnologías",
  "share.commits": "commits",
  "share.agentes": "del historial con agentes",
  "share.activos": "en marcha",
  "share.salud": "Salud de cada proyecto",
  "share.saludBien": "Bien",
  "share.saludRevisar": "Revisar",
  "share.saludAtencion": "Atención",
  "share.more": "+{n} más",
  "share.local": "Local-first · Tus datos, en tu disco.",
  "share.idioma": "Idioma de la imagen",
  "share.usuario": "tu cuenta",
  "share.usuarioVacio": "sin poner",
  "share.conIconos": "Incluir iconos y nombres de mis proyectos",
  "share.descargar": "descargar la imagen",
  "share.copiarTexto": "copiar el texto",
  "share.textoCopiado": "copiado",
  "share.image.idle": "compartir imagen",
  "share.image.preparing": "preparando imagen…",
  "share.image.copied": "imagen copiada",
  "share.image.downloaded": "imagen descargada",
  "share.image.failed": "no se pudo compartir",
  "share.x.idle": "abrir directamente en X",
  "share.x.preparing": "abriendo X…",
  "share.x.copied": "X abierto · pega la imagen",
  "share.x.downloaded": "X abierto · sube la imagen",
  "share.x.failed": "no se pudo abrir X",
  "share.nota":
    "Compartir imagen abre el menú del sistema. X abre el compositor directamente y deja el PNG copiado para que lo pegues; Panoma no sube la imagen.",
  "share.texto":
    "{n} proyecto{s} creados — mi centro de control local con {domain}.",

  "store.sortLabel": "Ordenar proyectos",
  "store.sortRecent": "Más recientes",
  "store.sortName": "Nombre",
  "store.sortHealth": "Mejor salud",
  "store.viewAria": "Vista del catálogo",
  "store.viewGrid": "Vista de cuadrícula",
  "store.viewList": "Vista de lista",
  "store.browseTitle": "Explorar proyectos",
  "store.total": "{n} proyecto{s} en total",
  "store.noResults": "No encontramos proyectos",
  "store.noResultsBody": "Prueba con otra búsqueda o cambia el filtro seleccionado.",
  "store.clearFilters": "Limpiar filtros",
  /* The way back from something that has just been set aside. See `project-store.tsx`. */
  "store.justHidden": "«{name}» ya no está en el catálogo.",
  "store.undoHide": "deshacer",
  "store.seeHidden": "ver ocultos",
  "store.showing": "Mostrando {shown} de {total} proyecto{totals}",

  // Cover: featured project and service panel.
  "store.lastCommit": "Último commit {when}",
  "store.workedOn": "Has trabajado en este proyecto {when}.",
  "store.openProject": "Abrir proyecto",
  /*
    A single pair for three sites —the featured one, the panel care badge, and the bottom of the
    card—, even though the markers asked for two. It's the same fact said with the same words, and
    splitting it into `waiting` and `pending` would have left two twin keys waiting for someone to
    touch one and forget the other.
   */
  "store.proposalsWaitingOne": "1 propuesta sin decidir",
  "store.proposalsWaitingMany": "{n} propuestas sin decidir",
  "store.proposalsBody": "El cambio ya está hecho y probado. Nadie lo aplica hasta que lo digas tú.",
  "store.resume": "Retomar donde lo dejaste",
  /* In the grid, the entire row is already from the project, and the site is narrow. */
  "store.editorShort": "editor",
  "store.openingEditor": "abriendo…",
  "store.openedEditor": "✓ abierto",
  "store.openNamedInEditor": "abrir {name} en el editor",
  "store.unreachable": "No se pudo contactar con el servidor.",
  "store.attention": "Atención",
  "store.attentionBody": "Proyectos que necesitan tu revisión.",
  "store.viewAll": "Ver todo",
  "store.allClear": "Todo está al día.",
  "store.viewAllIssues": "Ver los {n} proyecto{s} con problemas",

  // Cover: grid cards.
  "store.depsBehind": "{n} dep. atrasada{s}",
  "store.depsBehindRatio": "{n}/{total} dep. atrasada{s}",
  "store.depsUnchecked": "dependencias sin comprobar",
  /*
    The phrase that Panoma composes by itself, in pieces.
    It is what is taught about projects without their own description —neither manifest nor README
    with prose—, which on a real disk are the majority. It was entirely composed within the engine
    and in Spanish, so it came out the same no matter who looked. Now the engine delivers the data
    and the words are placed here.
    Proper names are NOT in this dictionary and they should not be: `Flutter`, `Stripe`, and
    `App Store` are called the same in both languages.
   */
  "summary.kind.mobileApp": "App móvil",
  "summary.kind.webApp": "Aplicación web",
  "summary.kind.cli": "Herramienta de línea de comandos",
  "summary.kind.package": "Paquete publicable",
  "summary.kind.backend": "Servicio de backend",
  "summary.kind.container": "Servicio en contenedor",
  "summary.kind.project": "Proyecto",
  "summary.builtWith": "{kind} en {stack}",
  "summary.uses": "usa {list}",
  "summary.publishedOn": "se publica en {list}",
  "summary.writtenBy": "{share}% del historial lo escribió {agent}",
  "summary.and": "y",
  "store.noticeOne": "1 aviso",
  "store.noticesMany": "{n} aviso{s}",
  "store.commitCount": "{n} commit{s}",
  "store.noAlerts": "Sin alertas",
  "store.open": "Abrir",
  "store.openNamed": "Abrir {name}",
  "store.favoriteAdd": "Añadir {name} a favoritos",
  "store.favoriteRemove": "Quitar {name} de favoritos",
  "store.hideNamed": "Ocultar {name}",
  "store.noStack": "Pila no detectada",
  "store.builtWith": "Proyecto local construido con {tech}.",
  "store.detected": "Proyecto local detectado en tu catálogo.",

  /*
    Catalog: the bar, the table, the icon grid, and the details panel.
    Own prefix and not `store.`: these are the texts of the redesigned screen—columns, side panel,
    shortcuts—and having them together allows you to see at a glance what is said in the table and
    what in the panel, which is where the vocabulary is actually repeated.
   */
  "catalog.title": "Catálogo de proyectos",
  "catalog.count": "{n} proyecto{s}",
  "catalog.countOne": "1 proyecto",
  "catalog.filterPlaceholder": "Filtrar el catálogo",
  "catalog.category": "Categoría",
  "catalog.colProject": "Proyecto",
  "catalog.colHealth": "Salud",
  "catalog.colStack": "Stack",
  "catalog.colActivity": "Última actividad",
  "catalog.rowsAria": "Proyectos del catálogo",
  "catalog.hint": "Un clic enseña los detalles. Dos abren la ficha.",
  /* The shortcut is said on the handle itself: it is where you read it just before needing it. */
  "catalog.openHandle": "Abrir la ficha de {name} — o haz doble clic",
  "catalog.opening": "Abriendo la ficha…",
  "catalog.healthOf": "Salud {n} sobre 100",
  "catalog.noHealth": "Sin medir",
  "catalog.detailsOf": "Detalles de {name}",
  "catalog.close": "Cerrar los detalles",
  "catalog.repository": "Repositorio",
  "catalog.remote": "Con copia remota",
  "catalog.localOnly": "Solo en este disco",
  "catalog.noGit": "Sin git",
  "catalog.size": "Tamaño",
  "catalog.commits": "Commits",
  "catalog.origin": "Origen",
  "catalog.openIn": "Abrir en",
  "catalog.editor": "Editor",
  "catalog.editorSub": "Editar el código",
  "catalog.terminal": "Terminal",
  "catalog.terminalSub": "Una terminal en esta carpeta",
  "catalog.folder": "Carpeta",
  "catalog.folderSub": "Ver los archivos",
  "catalog.fullDetail": "Ver la ficha completa",
  "catalog.emptyTitle": "Ningún proyecto seleccionado",
  "catalog.emptyBody": "Elige uno de la lista y sus detalles salen aquí.",
  "catalog.needsReview": "Necesita revisión",
  /*
    It says 'in a terminal' rather than 'in this folder'.
    Claude Code and Codex are also desktop applications, so a row that only says 'Claude Code'
    doesn't indicate where it leads: whoever had the app open would click it and a Terminal would
    pop up. The folder is taken for granted —this entire panel belongs to a project—; what needs
    to be stated is in which window you end up.
   */
  "catalog.agentSub": "Agente, en un terminal",
  "catalog.appSub": "App de escritorio",
  "catalog.agentBroken": "Instalado, pero no arranca",
  "catalog.reviewUnsaved": "Ver qué hay sin guardar",
  "catalog.reviewSecurity": "Ver los avisos de seguridad",
  "catalog.reviewDeps": "Ver las dependencias atrasadas",

  // Status and origin of a project.
  "state.active": "Activo",
  "state.paused": "En pausa",
  "state.dormant": "Dormido",
  "state.no-git": "Sin git",
  "origin.foreign": "no es tuyo",
  "origin.forked": "partió de otro",
  "origin.template": "plantilla",
  "origin.templateTitle": "Lo generó una herramienta y no se ha tocado desde entonces.",
  "origin.startedBy": "Empezado por {name}. Abre la ficha para ver en qué se basa.",
  "origin.openDetail": "Abre la ficha para ver en qué se basa.",

  // The daily report, the section that is read every morning before anything else.
  "today.title": "Desde la última vez",
  "today.since": "desde {when}",
  "today.last24h": "en las últimas 24 horas",
  "today.nothing": "Sin novedades {period}. Todo tuyo.",
  "today.commitOne": "{n} commit",
  "today.commitMany": "{n} commit{s}",
  "today.fromAgents": "({n} de agentes)",
  "today.inProject": "en {project}",
  "today.agentNoted": "{name} anotó {n}",
  "today.born": "Nuevos en el catálogo:",
  "today.resume": "Retomar",
  "today.opening": "Abriendo…",
  "today.openFailed": "No se pudo",
  "today.openNamed": "Abrir {name} en el editor",
  /*
    The folded report: a line that says how much there is, and the detail at one click. The facts
    go in the order that matters —what awaits a response, what was moved, what appeared by itself—
    and the one that is worth zero is not written.
   */
  "today.waitingOne": "1 espera tu decisión",
  "today.waitingMany": "{n} esperan tu decisión",
  "today.inProjectsOne": "{c} en 1 proyecto",
  "today.inProjectsMany": "{c} en {n} proyecto{s}",
  "today.bornOne": "1 proyecto nuevo",
  "today.bornMany": "{n} proyecto{s} nuevos",
  "today.expand": "Ver el parte del día",
  "today.collapse": "Plegar el parte del día",
  "today.quiet": "Sin novedades",
  /* How many attempts are there of the same package. The most recent one is shown; see `groupProposals`. */
  "today.attempts": "{n} intento{s}",

  /*
    Agent proposals awaiting a decision.
    Own area and not one of the card because the same thing is said on three screens: the card
    stripe, the day's section on the cover, and the status label of the executions. One single
    fact, just a few words — if 'tests in green' had three keys, one day it would say three
    different things and you would have to learn all three.
   */
  "proposals.waiting": "Esperan tu decisión",
  "proposals.readyOne": "Hay una propuesta preparada y sin decidir",
  "proposals.readyMany": "Hay {n} propuestas preparadas y sin decidir",
  "proposals.branchNote":
    "El cambio ya está hecho y probado en una rama aparte. Nadie lo aplica a tu carpeta hasta que lo digas tú.",
  "proposals.fallbackName": "propuesta",
  "proposals.andMore": "y {n} más",
  "proposals.testsGreen": "tests en verde",
  "proposals.unverified": "sin verificar",

  // "What has happened here": the commit panel of the file, with its time windows.
  "changes.question": "Qué ha pasado aquí",
  "changes.latest": "Lo último, {when}",
  "changes.nothingYet": "Todavía no ha pasado nada",
  "changes.totalCommits": "{n} commit{s} en total",
  "changes.window24h": "En las últimas 24 horas",
  "changes.window48h": "El día anterior",
  "changes.windowBefore": "Antes de eso",
  "changes.signedBy": "Firmado por {agent} con un trailer Co-Authored-By",
  "changes.unsignedNote":
    "Los commits sin etiqueta no llevan firma de nadie. Eso no quiere decir que los escribieras tú.",
  "changes.moreOne": "Hay 1 más entre los últimos veinte que guarda el catálogo.",
  "changes.moreMany": "Hay {n} más entre los últimos veinte que guarda el catálogo.",
  "changes.empty": "Aún no hay commits recientes que mostrar.",
  "changes.agentLog": "Ver actividad de agentes",

  // Leave a written message for the agent, from the record.
  "task.title": "Déjalo anotado",
  "task.openOne": "{n} abierta",
  "task.openMany": "{n} abiertas",
  "task.placeholder": "mañana arregla el login",
  "task.fieldLabel": "Qué hay que hacer en este proyecto",
  "task.save": "anotar",
  "task.saving": "anotando…",
  "task.mcpNote":
    "Panoma no administra tareas: las guarda. Tu agente las lee por MCP cuando entra al proyecto, las coge y las cierra él.",
  "task.saveFailed": "No se pudo anotar.",
  /* Who wrote it. The raw database value —'human'— was rendered in both languages. */
  "task.byHuman": "tú",
  "task.unreachable": "No se pudo contactar con el catálogo.",

  // Assignments: Panoma drafts the message with the facts of the project and the agent collects it.
  "assignment.question": "¿Qué hacemos con esto?",
  "assignment.title": "Encárgaselo a tu agente",
  "assignment.note":
    "Panoma redacta el encargo con lo que sabe del proyecto. Ábrelo en tu terminal y tu agente empieza ahora, en este ordenador; déjalo en la cola y no pasa nada hasta que entre en el proyecto; o cópiatelo y llévatelo donde quieras.",
  "assignment.see": "ver el encargo",
  "assignment.copy": "copiar",
  "assignment.copied": "copiado",
  /*
    The clipboard does not exist outside of a secure origin, and `panoma up --network` serves the
    app through IP: there the button did not copy, it did not say so, and on top of that it was
    the only way left —from the mobile there is no terminal to open.
   */
  "assignment.copyFailed": "No se pudo copiar. Abre «ver el encargo» y selecciónalo a mano.",
  "assignment.send": "dejarlo en la cola",
  "assignment.sending": "a la cola…",
  /*
    The sign says the destination and the title says the term: the two buttons in the row differ
    in when and where what is going to happen occurs, and it was exactly what they did not say.
   */
  "assignment.sendTitle":
    "Se queda esperando a que tu agente entre en este proyecto. Ahora mismo no se ejecuta nada",
  "assignment.launch": "abrir en tu terminal",
  "assignment.launching": "abriendo…",
  "assignment.launchTitle":
    "Abre un terminal en este ordenador con {agent} dentro del proyecto y el encargo puesto: empieza a trabajar en cuanto se abra",
  "assignment.launched": "{agent} está trabajando en tu terminal.",
  "assignment.launchFailed": "No se pudo abrir el terminal.",
  "assignment.queued": "en la cola",
  "assignment.queuedNote": "En la cola. Tu agente lo recoge al entrar en el proyecto.",
  /* Undo the button next to it, which was the only action of the card without a return. */
  "assignment.withdraw": "retirarlo",
  "assignment.withdrawing": "retirando…",
  "assignment.withdrawn": "Retirado. Tu agente ya no lo va a ver.",
  "assignment.withdrawFailed": "No se pudo retirar.",
  "assignment.failed": "No se pudo dejar en la cola.",
  "assignment.resume": "Dime qué me falta para retomarlo",
  "assignment.resume.promise":
    "Que intente arrancarlo, apunte cada tropiezo y diga en qué se quedó el trabajo.",
  "assignment.competitors": "Busca a sus competidores",
  "assignment.competitors.promise":
    "Quién resuelve lo mismo hoy —vivo o muerto—, y qué hueco queda de verdad.",
  "assignment.plan": "Hazme un plan de mejora",
  "assignment.plan.promise":
    "Qué tocar primero y por qué, cruzando el código con lo que panoma ya mide.",
  "assignment.presentable": "Ponlo en forma para enseñarlo",
  "assignment.presentable.promise":
    "Un README honesto, para que alguien de fuera lo entienda en dos minutos.",
  /*
    The fifth is not written by the catalog with what it knows: it is written by the mechanical
    critic with what it has seen while reading the folder, so the promise says where the list comes
    from.
   */
  "assignment.review": "Arregla lo que se ve sin abrir nada",
  "assignment.review.promise":
    "Colores y esquinas sueltos, imágenes que no dicen qué muestran, enlaces rotos: lo que panoma vio leyendo la carpeta.",
  "assignment.securityTitle": "Cierra la vulnerabilidad más grave",
  "assignment.securityPromise":
    "Panoma prepara el arreglo en una copia aparte del proyecto y te deja la propuesta esperando.",
  "assignment.depsTitle": "Pon al día sus dependencias",
  "assignment.depsPromiseOne": "{n} directa atrasada — elige cuál y panoma te trae la propuesta.",
  "assignment.depsPromiseMany": "{n} directa{s} atrasadas — elige cuál y panoma te trae la propuesta.",
  "assignment.depsChoose": "elegir cuál",

  // Which model does Panoma use: already installed agents and API keys.

  // Where Panoma looks. See `components/sitios.tsx`.
  "sites.summaryOne": "{n} proyecto, mirando en {where}{extra}",
  "sites.summaryMany": "{n} proyecto{s}, mirando en {where}{extra}",
  "sites.andMore": "y {n} más",
  "sites.manage": "cambiar",
  "sites.close": "cerrar",
  "sites.countOne": "{n} proyecto",
  "sites.countMany": "{n} proyecto{s}",
  "sites.missing": "la carpeta ya no está",
  "sites.remove": "quitar",
  /* The number goes at the end, which is where it does not force the word next to it to change. */
  "sites.removeConfirm": "sí, quitar y retirar sus proyectos: {n}",
  "sites.removed": "Deja de mirarse, y se retiran sus proyectos: {n}. Si la vuelves a añadir, vuelven.",
  "sites.add": "añadir",
  "sites.adding": "buscando…",
  "sites.addedOne": "Añadida. Encontré 1 proyecto.",
  "sites.addedMany": "Añadida. Encontré {n} proyecto{s}.",
  "sites.placeholder": "~/Documents",
  "sites.fieldLabel": "Carpeta donde también quieres que mire",
  "sites.note":
    "Panoma solo encuentra proyectos dentro de estas carpetas. Uno que viva fuera no aparecerá nunca, ni escaneando ni esperando.",
  "sites.search": "buscar por mi disco",
  "sites.searching": "buscando…",
  "sites.searchHint": "Recorre tu carpeta personal y propone dónde tienes más proyectos.",
  "sites.searchNone": "No encontré proyectos fuera de lo que ya se mira.",
  "sites.failed": "No se pudo.",

  "ai.title": "Con qué piensa Panoma",
  "ai.intro":
    "Panoma no llama a ningún modelo por su cuenta: solo cuando tú se lo pides — al describir un proyecto, al redactar un encargo. Aquí eliges con cuál.",
  "ai.loading": "leyendo la configuración…",
  "ai.loadingSlow": "sigue leyendo… la primera vez tarda más.",
  "ai.loadFailed": "No se pudo leer la configuración de IA ({status}).",
  "ai.loadTimeout": "La configuración tardó demasiado en llegar.",
  "ai.retry": "reintentar",
  "ai.retrying": "reintentando…",
  "ai.brokenTitle": "La configuración no se puede leer",
  "ai.fileNote":
    "La configuración vive en {path}, con permisos 0600. Eso impide que otro usuario de esta máquina la lea, pero no está cifrada: cualquier proceso que corra con tu usuario puede abrirla. Si prefieres no guardar nada en disco, exporta la clave como variable de entorno o usa un agente que ya tengas instalado.",
  "ai.remote": "El catálogo es remoto: el modelo se configura en la máquina que lo sirve.",
  "ai.activeTitle": "Proveedor activo",
  "ai.none": "Ninguno todavía. Elige uno de los de abajo.",
  "ai.defaultModel": "modelo por defecto",
  "ai.modelLabel": "modelo",
  "ai.modelPlaceholder": "el de por defecto del proveedor",
  "ai.modelSaved": "Ahora usa {model}.",
  "ai.modelCleared": "Vuelve al modelo por defecto del proveedor.",
  "ai.modelsFetch": "traer los suyos",
  "ai.modelsLoading": "preguntando…",
  "ai.modelsOpen": "ver los modelos",
  "ai.modelsLive": "Dichos por el proveedor ahora mismo: {n}.",
  "ai.modelsHint": "Sugerencias nuestras, que pueden estar viejas: {n}. Pulsa «traer los suyos» para la lista de verdad — o escribe el nombre que quieras.",
  "ai.modelsEmpty": "No traemos sugerencias para este proveedor. Pulsa «traer los suyos» para pedírselas — o escribe el nombre a mano.",
  "ai.modelsNoMatch": "Ninguno se llama así. Se guarda tal cual lo escribas.",
  "ai.modelsNone": "Este proveedor no publica su catálogo. Escribe el nombre del modelo a mano.",
  "ai.redirected": "Una variable de entorno redirigió este proveedor a otra dirección. Tu clave se manda ahí.",
  "ai.sourceEnv": "del entorno",
  "ai.sourceFile": "del fichero",
  "ai.sourceAgent": "sesión de tu agente",
  "ai.sourceKey": "{source} · {key}",
  "ai.sourceLogin": "sesión iniciada",
  "ai.connected": "sesión iniciada",
  "ai.notConnected": "sin sesión",
  "ai.login": "entrar",
  "ai.loginAgain": "volver a entrar",
  "ai.loggingIn": "esperando…",
  "ai.loginWaiting": "Se abrió una pestaña para entrar en {name}. Aquí te espero.",
  "ai.loginDone": "Sesión iniciada en {name}.",
  "ai.loginFailed": "No se pudo iniciar sesión.",
  "ai.loginTimeout": "Se acabó el plazo esperando la vuelta del navegador.",
  "ai.logout": "cerrar sesión",
  "ai.test": "probar",
  "ai.testing": "probando…",
  "ai.testOk": "Contestó {model} en {s}s.",
  "ai.testHint": "Guarda una clave arriba, o elige un agente que ya tengas instalado.",
  "ai.failed": "No se pudo.",
  "ai.nowUsing": "Ahora usa {name}.",
  "ai.forgotten": "Clave olvidada.",
  "ai.forgottenButEnv": "Clave olvidada del fichero, pero {var} sigue puesta en el entorno.",
  "ai.subscriptionTitle": "Usa una suscripción que ya tienes",
  "ai.subscriptionNote":
    "Si ya pagas Claude Pro o ChatGPT y tienes su herramienta con sesión iniciada, Panoma le pasa el trabajo a ella. No guarda ningún token ni ve tus credenciales: la suscripción la usa tu propia herramienta, en tu máquina.",
  "ai.installed": "instalado",
  "ai.notInstalled": "no encontré «{command}»",
  "ai.keysTitle": "Conecta con una clave",
  "ai.fromEnv": "{var} en el entorno",
  "ai.stored": "guardada {key}",
  "ai.noKey": "sin clave",
  "ai.keyPlaceholder": "pega la clave",
  "ai.keyLabel": "Clave de {name}",
  "ai.save": "guardar",
  "ai.saving": "guardando…",
  "ai.forget": "olvidar",
  "ai.getKey": "sacar una",
  "ai.inUse": "en uso",
  "ai.choose": "usar este",
  "ai.choosing": "cambiando…",
  "ai.cantUse": "Necesita una clave guardada o el agente instalado.",

  // Search text in the code of the entire catalog.
  "search.fieldLabel": "Texto a buscar en el código",
  "search.submit": "buscar",
  "search.searching": "buscando…",
  "search.scopeNote":
    "Texto literal, sin distinguir mayúsculas. Solo se miran ficheros seguidos por git, así que un fichero sin commitear no aparece.",
  "search.scopeVendors":
    "Tampoco se busca en dependencias de terceros aunque estén en el historial —es código que no escribiste—:",
  /*
    Two independent numbers in the same sentence, so two pairs and not four keys: «{n} matches»
    and «in {n} projects» are chosen separately and combined when rendering. With a single key, all
    four combinations of singular and plural would be needed.
   */
  "search.matchOne": "1 coincidencia",
  "search.matchMany": "{n} coincidencias",
  "search.inProjectOne": "en 1 proyecto",
  "search.inProjectMany": "en {n} proyecto{s}",
  "search.reposSearched": "{n} repositorio{s} buscado{s}",
  "search.skipped": "{n} sin git, no se pudieron buscar",
  "search.skippedTitle": "Carpetas sin git: no hay nada que preguntar.",
  "search.clickToOpen": "pulsa una coincidencia para abrirla en el editor",
  "search.noMatch": "Ningún fichero seguido por git contiene «{query}».",
  "search.openAt": "Abrir {file} en la línea {line}",
  "search.truncated": "Solo se enseñan las primeras {n}. Abre la carpeta para verlas todas.",
  "search.openFolder": "Abrir la carpeta",
  "search.openFolderAria": "Abrir la carpeta del proyecto",
  "search.failed": "No se pudo buscar.",
  "search.openFailed": "No se pudo abrir.",
  "search.unreachable": "No se pudo contactar con el servidor.",

  /*
    Open the project where work actually happens, and copy a command to paste it.
    Own and non `project.` areas: the two buttons also appear in 'Work without saving,' which
    remains entirely in Spanish, and hanging them from the record would tie their text to a screen
    where they don't even appear. They also don't borrow the keys from the cover page even if some
    phrase matches: there they are the label of a catalog row and here a button.
   */
  "open.folder": "abrir carpeta",
  "open.editor": "abrir en el editor",
  "open.terminal": "abrir terminal aquí",
  "open.busy": "abriendo…",
  "open.doneFolder": "✓ abierta",
  "open.done": "✓ abierto",
  "open.unreachable": "No se pudo contactar con el servidor.",
  /*
    The button says the name of the program, not 'the editor'.
    With Cursor and VS Code installed, 'open in editor' did not say which one until it opened —
    and with two editors that is not an aesthetic preference: it is opening the project, closing
    it, and reopening it. The arrow next to it leads to the rest of the places.
   */
  "open.openWith": "Abrir en {name}",
  "open.moreDestinations": "Más sitios donde abrirlo",
  "open.defaultDestination": "Predeterminado",
  "copy.command": "Copiar «{command}»",
  "copy.done": "copiado",

  // The project sheet, from top to bottom.
  "project.health": "Salud {n}",
  "project.healthTitle": "Salud {n} de 100",
  "project.heroStatus": "Estado",
  "project.heroActivity": "Actividad",
  "project.heroCommits": "Commits",
  "project.heroHealth": "Salud",
  "project.commitOne": "{n} commit",
  "project.commitMany": "{n} commit{s}",
  "project.sections": "Secciones del proyecto",
  "project.navAll": "Todo",
  "project.navSummary": "Resumen",
  "project.navChanges": "Qué pasó",
  "project.navResume": "Retomar",
  "project.navAssignments": "Encargos",
  "project.navDeps": "Mantenimiento",
  "project.navAgents": "Agentes",
  "project.navMd": "El .md",
  "project.mdQuestion": "¿Lo que leen tus agentes es verdad?",
  "project.mdTitle": "El fichero de instrucciones",
  "project.mdCost": "{n} tokens de contexto en cada sesión",
  /*
    Name the two files on purpose. He said 'it has no instruction file' plain and simple, and
    anyone reading it in a repository with its README, CONTRIBUTING, and three more .md files
    understood that Panoma didn't know how to look. They are two specific files, not just any
    markdown.
   */
  "project.mdNone":
    "Aquí no hay AGENTS.md ni CLAUDE.md, que son los dos que los agentes leen solos al entrar: entran a este proyecto sin saber nada de él.",
  /*
    And the case in the middle, which said the opposite of what was happening: without its own
    file but with one inherited from the folder above, the card released 'they enter knowing
    nothing about it' on top of the line that counted the tokens of that same file. The agent who
    enters here reads it: saying that it knows nothing is exactly the kind of false statement that
    this section exists to catch.
   */
  "project.mdOnlyInherited":
    "Este proyecto no tiene AGENTS.md ni CLAUDE.md propio, pero hereda lo que dicen las carpetas de arriba: eso es lo que tus agentes leen al entrar aquí.",
  "project.mdNoneHint": "El botón crea AGENTS.md con un bloque de contexto —pila, comandos, avisos, tareas— que Panoma mantiene al día solo.",
  /*
    The number at the end, and not in front, in these two.
    They read «1 tokens · 1 líneas» on a one-line AGENTS.md, which is the file a project has on
    the day it opens the channel. The gap is called after what it counts —`{tokens}`, `{lines}`—
    and the guard that catches «1 commits» knew a closed list of names, so it never looked here.
   */
  "project.mdFileMeta": "tokens: {tokens} · líneas: {lines}",
  "project.mdManaged": "bloque de Panoma",
  "project.mdClean": "Todo lo que afirma existe.",
  "project.mdFindingOne": "1 afirmación que ya no es verdad",
  "project.mdFindings": "{n} afirmaciones que ya no son verdad",
  "project.mdLine": "línea {n}",
  "project.mdPathMissing": "no existe en el proyecto",
  "project.mdPathMovedTo": "no existe; hay uno en {path}",
  "project.mdScriptMissing": "no está en los scripts del package.json",
  "project.mdScriptNear": "no está en los scripts; hay {names}",
  "project.mdBlockBroken": "el bloque de Panoma no se cierra: revísalo a mano",
  "project.navAccounts": "Cuentas",
  "accounts.copy": "copiar",
  "accounts.copied": "copiado",
  "accounts.editList": "Editar la lista",
  "accounts.title": "Cuentas y enlaces",
  "accounts.question": "¿Con qué cuenta iba esto?",
  "accounts.hint": "Lo que falta al volver: el correo del despliegue, el dominio, el panel de siempre.",
  "accounts.empty": "Nada apuntado todavía. El correo de la cuenta de despliegue, el registrador del dominio, el panel que siempre cuesta encontrar…",
  "accounts.addFirst": "Apuntar la primera",
  "accounts.edit": "Editar",
  "accounts.addRow": "Añadir otra",
  "accounts.save": "Guardar",
  "accounts.saving": "Guardando…",
  "accounts.cancel": "cancelar",
  "accounts.remove": "Quitar entrada",
  "accounts.label": "Qué es (Vercel, dominio, Stripe…)",
  "accounts.email": "correo de la cuenta",
  "accounts.note": "nota",
  "accounts.noSecrets": "Sin contraseñas ni claves: esto viaja en claro por el catálogo. Los secretos, al Llavero del sistema.",
  /*
    The two notices from the editor. They exist because before they didn’t: what was not
    understood was silently discarded and the field appeared empty upon return. Neither of the two
    erases anything — the text stays where it is and the row is indicated.
   */
  "accounts.badUrl":
    "Hay un enlace que no se entiende. Vale el dominio (vercel.com/x), la dirección entera (https://…) o la máquina con su puerto (localhost:3000). No se ha guardado nada.",
  "accounts.needsLabel":
    "Hay una fila con datos y sin nombre. Ponle qué es —Vercel, dominio, Stripe— o quítala con la ×. No se ha guardado nada.",

  // ── Does it still compile? — the verdict of Panoma check ──────────────────────
  "check.title": "¿Todavía compila?",
  "check.none":
    "Nadie lo ha comprobado aún. La salud de arriba deduce; esto demuestra: se instala y se compila en un worktree aparte, con aislamiento, sin tocar tu carpeta.",
  "check.run": "Comprobarlo ahora",
  "check.rerun": "Volver a comprobar",
  "check.running":
    "Instalando y compilando en un worktree aparte… puede tardar unos minutos. Tu carpeta no se toca.",
  "check.ok": "Compila",
  "check.broken": "La build está rota",
  "check.inconclusive": "Sin veredicto",
  "check.checkedOn": "comprobado el {date} · {seconds}s",
  "check.dirty": "Había cambios sin confirmar: el veredicto habla del último commit.",

  "project.mdVersionWrong": "el proyecto lleva la {v}",
  "project.mdEnvMissing": "el ejemplo de entorno no la declara",
  "project.mdEnvNear": "el ejemplo no la declara; hay {names}",
  "project.mdLead": "Es lo primero que tus agentes leen al entrar en este proyecto. Panoma vigila que lo que diga siga siendo verdad.",
  "project.mdInitButton": "Crear AGENTS.md con el contexto",
  "project.mdAddBlockButton": "Añadir el bloque de contexto",
  "project.mdSyncButton": "Regenerar el bloque",
  "project.mdApplyWorking": "Escribiendo…",
  "project.mdInitDone": "Hecho: {file} creado con el bloque de contexto. Tus agentes lo leerán en su próxima sesión, y Panoma lo mantendrá al día solo.",
  "project.mdBlockAdded": "Hecho: el bloque de contexto ya está en {file}. Se regenera solo cuando cambie la realidad.",
  "project.mdSyncDone": "Bloque regenerado en {file}.",
  "project.mdSyncSame": "El bloque ya estaba al día: nada que cambiar.",
  "project.mdBridgeMissing":
    "Claude Code no leerá este fichero: solo carga CLAUDE.md, y este proyecto no tiene. El botón de abajo escribe también el puente — un CLAUDE.md de una línea que importa AGENTS.md.",
  "project.mdBridgeWritten":
    "Y CLAUDE.md quedó escrito con la importación @AGENTS.md, que es lo único que Claude Code carga.",
  "project.mdTerminalAlt": "o en el terminal:",
  "project.mdFindingsIntro": "Esto es lo que el fichero afirma y ya no es verdad. Lo que lleva pista lo repara el botón; el resto se arregla editando el fichero, y al guardar Panoma lo repasa de nuevo.",
  "project.mdReviewTitle": "La opinión del modelo",
  "project.mdReviewAsk": "Pedir opinión al modelo",
  "project.mdReviewAsking": "Leyendo el fichero…",
  "project.mdReviewAgain": "volver a pedirla",
  "project.mdReviewStale": "El fichero cambió después de esta opinión: pídela de nuevo si quieres juicio fresco.",
  "project.mdReviewNote": "Contradicciones, redundancia y lo que falta: lo que el verificador mecánico no puede ver.",
  "project.mdInherited": "También hereda, de las carpetas de arriba",
  "project.mdInheritedMeta": "tokens: {tokens}",
  "project.mdInspectButton": "Repasarlo ahora",
  "project.mdInspectWorking": "Repasando contra el disco…",
  "project.mdRepairButton": "Reparar lo evidente ({n})",
  "project.mdRepairWorking": "Reparando…",
  "project.mdRepairDone": "{n} arreglo{s} aplicado{s}. Quedan {m} para tu mano.",
  "project.mdRepairDoneAll": "{n} arreglo{s} aplicado{s}. No queda ninguno.",
  "project.mdInheritedNote": "Tus agentes también leen estos, de las carpetas de arriba. El repaso enseña qué afirma cada uno que ya no es verdad, con su línea.",
  "project.mdTouches": "Últimos toques al fichero",
  "project.mdTouchAnon": "sin firma",
  "project.mdTruncated": "El proyecto tiene más ficheros de los que se indexan: las rutas no se comprobaron.",
  "project.navDetails": "Detalles",

  // Sheet: the action bar of the header and its more options menu.
  "project.moreActions": "Más acciones del proyecto",
  "project.copyPath": "Copiar ruta",
  "project.pathCopied": "Ruta copiada",
  "project.pathCopyFailed": "No se pudo copiar la ruta",
  "project.rescan": "Volver a escanear",
  "project.rescanning": "Actualizando…",
  "project.rescanned": "Proyecto actualizado",
  "project.rescanFailed": "No se pudo actualizar",

  /*
    File: hide and remove from the catalog, with its confirmation dialog.
    The notice that the folder must not be touched is split into two keys because on screen it is
    split in two: the first phrase is a `<strong>` and the rest is not. A single key with the
    label inside would put HTML in the dictionary, which is exactly what this file is not.
   */
  "project.show": "mostrar",
  "project.hide": "ocultar",
  "project.showTitle": "Volver a enseñarlo en la vista principal",
  "project.hideTitle": "Sacarlo de la vista principal. Sigue en el catálogo.",
  "project.remove": "quitar del catálogo",
  "project.removeTitle": "Sacarlo del catálogo. No borra ninguna carpeta.",
  "project.actionFailed": "No se pudo.",
  "project.unreachable": "No se pudo contactar con el servidor.",
  "project.removeHeading": "Quitar {name} del catálogo",
  "project.removeBody":
    "Panoma se olvidará de este proyecto y ningún escaneo lo volverá a añadir. Se pierden su ficha, su historial de análisis y lo que hayas escrito sobre él aquí.",
  "project.removeSafeStrong": "Tu carpeta no se toca.",
  "project.removeSafeBody":
    "El código, el historial de git y todo lo que hay dentro se quedan exactamente donde están. Esto solo borra lo que Panoma sabía.",
  "project.removeTypeBefore": "Escribe",
  "project.removeTypeAfter": "para confirmar",
  "project.removeTypeAria": "Escribe {name} para confirmar",
  "project.cancel": "Cancelar",
  "project.removing": "quitando…",
  "project.removeConfirm": "Quitar del catálogo",

  // Card: the three cards of the summary.
  "project.overviewTitle": "Resumen del proyecto",
  "project.whatChanged": "Qué cambió",
  "project.recentActivity": "Actividad reciente",
  "project.today": "hoy",
  "project.whereProtected": "Dónde está protegido",
  "project.versionControl": "Control de código",
  "project.withRemote": "Con remoto",
  "project.withoutRemote": "Sin remoto",
  "project.withoutGit": "Sin Git",
  "project.historyCopied": "El historial tiene una copia fuera de este disco.",
  "project.onlyHereOne": "1 commit solo en este disco.",
  "project.onlyHereMany": "{n} commit{s} solo en este disco.",
  "project.whatNeedsAttention": "Qué necesita atención",
  "project.maintenance": "Mantenimiento y salud",
  "project.noMajorIssues": "No hay problemas importantes.",
  "project.issuesOne": "1 asunto requiere revisión.",
  "project.issuesMany": "{n} asuntos requieren revisión.",

  /*
    File: the two graphs of the summary — what is read under the health ring and what only a
    screen reader hears.
    The ring is announced with the same key as the header badge: it is the same number over the
    same total, and two twin keys would end up saying two things.
   */
  "project.outOf100": "de 100",
  "project.commitChartAria": "Commits de los últimos siete días",

  // Sheet: the service panel, with one row per reason.
  "project.attnNoRemote": "Sin repositorio remoto",
  "project.attnNoRemoteDetail": "El proyecto solo existe en este disco.",
  "project.attnNoRemoteAction": "Configurar remoto",
  "project.attnAdvisoriesOne": "1 aviso de seguridad",
  "project.attnAdvisoriesMany": "{n} aviso{s} de seguridad",
  "project.attnAdvisoriesDetail": "Hay dependencias que requieren revisión.",
  "project.attnAdvisoriesAction": "Revisar avisos",
  /*
    What is written when the counter above means nothing.
    To know if a dependency has a security notice, its exact version is needed, and that comes
    from the lock file. When it cannot be opened —today `bun.lockb`, which is binary, or a corrupt
    one— nothing is asked from OSV and the counter remains at zero **for not having asked**. Such
    a zero is read as healthy, which is exactly the opposite of what happens.
    The file name goes inside on purpose: «unchecked» is a warning and «unchecked: bun.lockb» is
    an instruction.
   */
  "project.depsUnchecked": "sin comprobar",
  "project.depsUncheckedWhy":
    "No se ha podido leer {file}, así que no se conocen las versiones exactas y no se ha preguntado por avisos de seguridad.",
  "project.attnUnchecked": "Los avisos de seguridad están sin comprobar",
  "project.attnUncheckedDetail":
    "{file} no se puede leer, y sin las versiones exactas no hay nada que preguntar. El cero de aquí abajo no dice que esté limpio.",
  "project.attnUncheckedAction": "Ver dependencias",
  /*
    The older brother of the case above: there a lockfile could not be read, here nothing has been
    asked at all.
    `outdated_deps` and `vuln_count` are born at zero and only the enrichment writes them
    (`panoma enrich`, or the watcher's heartbeat), so until then `enriched_at` is NULL and the
    card showed «All clear · Nothing risky right now» over a project nobody had ever looked at:
    the zero of «I looked and there is nothing» used for «I have not looked». The name of the
    command goes inside the sentence, because a warning that does not say how to close it is
    noise.
   */
  "project.attnUnenriched": "Nadie ha preguntado por las dependencias",
  "project.attnUnenrichedDetail":
    "Las versiones al día y los avisos de seguridad se le preguntan a los registros, y en este proyecto no se ha preguntado nunca. Los ceros de aquí abajo no dicen que esté limpio: ejecuta {cmd}.",
  "project.attnUnenrichedAction": "Ver dependencias",
  "project.depsUnenrichedWhy":
    "Este proyecto no se ha enriquecido nunca: no se ha preguntado a los registros ni por versiones ni por avisos, así que no hay respuesta que enseñar.",
  /*
    Both gaps look at `{total}` and are therefore named after it: `shapeFor` cuts the ending off
    the gap's own name to find whose number it follows, so `{s}` would have looked at a `{n}` that
    governs a different word here. In English the plural is irregular and is written the way this
    file writes them —stem outside, both endings inside, `dependenc{totalies}`— because the
    English twin said «1/1 dependencie behind», which is not a word.
   */
  "project.attnOutdated": "{n}/{total} dependencia{totals} atrasada{totals}",
  "project.attnOutdatedDetail": "Actualizar mejora la salud del proyecto.",
  "project.attnOutdatedAction": "Ver dependencias",
  "project.allGood": "Todo en orden",
  "project.allGoodDetail": "No hay riesgos importantes ahora mismo.",

  // Sheet: who built it and what it is made of.
  "project.whoBuilt": "Quién lo construyó",
  "project.ofHistory": "del historial",
  "project.agentsShare": "Agentes: {n}% del historial",
  "project.noAgentCommits": "No se detectaron commits de agentes.",
  "project.builtWith": "Con qué está hecho",
  "project.kindLanguage": "Lenguaje",
  "project.kindFramework": "Framework",
  "project.seeFullStack": "Ver pila completa",
  "project.fullStackTitle": "Pila tecnológica completa",
  "project.signalsDetected": "{n} señal{es} detectada{s}",
  "project.confidence": "{n}% de confianza",

  // Card: resume and protect, which are the two things that can be done.
  "project.resumeQuestion": "Vuelve a entrar sin investigar",
  "project.resumeTitle": "Cómo retomar el proyecto",
  "project.noCommands": "No se han detectado comandos de arranque en esta carpeta.",

  // Card: the block to resume —the last thing you did, what is typed, and what is needed.
  "project.lastYouDid": "Lo último que hiciste",
  "project.howToStart": "Cómo se arranca",
  "project.whatItNeeds": "Qué necesita instalado",
  "project.runtimeChecking": "comprobando…",
  "project.runtimeHave": "tienes {version}",
  "project.runtimeMissing": "no está instalado",
  "project.missingEnv": "Variables de entorno que faltan ({n})",
  /*
    Divided into three because on the screen there are two `<code>` in the middle: the example
    file and `.env`. The names of the two files are data, not text to translate.
   */
  "project.envDeclaredIn": "Declaradas en",
  "project.envNoValue": "y sin valor en tu",
  "project.envWhy":
    "Es la causa más común de que un proyecto viejo arranque y falle en la primera pantalla.",

  /*
    What each command in the runbook is for.
    Own zone because the value is set by the engine —one of four closed words, like the risk
    codes— and it is translated the same as them. What is never translated is the command next to
    it: `pnpm dev` is typed, and a translated command starts nothing.
   */
  "purpose.install": "instalar",
  "purpose.start": "arrancar",
  "purpose.tests": "tests",
  "purpose.build": "compilar",

  "project.protectQuestion": "Protege tu trabajo",
  "project.protectTitle": "Hay cambios que solo existen en este disco",
  "project.protectBody":
    "Panoma no publica nada por ti: te deja el comando listo y tú decides cuándo ejecutarlo.",

  // Ficha: dependencias y seguridad.
  "project.depsQuestion": "Manténlo saludable",
  "project.depsTitle": "Dependencias",
  "project.depsInstalled": "{n} instalada{s}",
  "project.depsDirect": "{n} directa{s}",
  "project.depsOutdated": "{n} atrasada{s}",
  "project.depsDirectAria": "Dependencias directas de {ecosystem}",
  "project.depsTransitiveAria": "Dependencias transitivas de {ecosystem}",
  "project.depsTransitiveOne": "1 transitiva, que arrastra una directa",
  "project.depsTransitiveMany": "{n} transitivas, que arrastran las directa{s}",
  "project.depDev": "Desarrollo",
  "project.depDirect": "Directa",
  "project.depTransitive": "Transitiva",
  "project.depUpToDate": "Al día",
  "project.noDeps": "No se detectaron dependencias.",

  /*
    Card: propose moving a dependency up, from its own row in the table. The button says "propose"
    and not "update" in both languages for the same reason.
   */
  "project.propose": "proponer",
  "project.proposing": "probando…",
  "project.proposeDone": "Hecho.",
  "project.alreadyFailed": "Ya se intentó y falló:",
  "project.tryAnyway": "intentarlo de todos modos",
  "project.proposeRefused": "El servidor no aceptó la propuesta ({status}).",
  "project.proposeUnreadable": "El servidor contestó algo que este botón no sabe leer ({status}).",
  "project.runUnreachable": "No se pudo contactar con el catálogo.",

  "project.securityQuestion": "Revisa lo importante",
  "project.securityTitle": "Seguridad",
  "project.fixedIn": "Corregido en {versions}",

  // Sheet: details, logbook, services, and footer.
  "project.detailsQuestion": "Contexto técnico",
  "project.detailsTitle": "Ficha del proyecto",
  "project.whatItIs": "Propósito",
  "project.noDescription": "No hay suficiente contexto escrito para explicar el propósito de este proyecto.",
  "project.detected": "Detectado: {text}",

  /*
    Card: the paragraph that a model writes, with their signature in front.
    “a model” is a loose key because it is what fills `{model}` when the server didn't say who
    wrote it: the gap of a signature cannot be left blank.
   */
  "project.aiExplain": "explicar de qué trata",
  "project.aiReading": "leyendo el proyecto…",
  "project.aiWriting": "escribiendo…",
  "project.aiRewrite": "volver a escribir",
  "project.aiWrittenBy": "escrito por {model}",
  "project.aiSomeModel": "un modelo",
  /*
    It only appears when what is saved is NOT in the language of the viewer.
    This text was written by a model once, it cost a paid call and stayed in the database: it
    cannot follow the reader like the rest of the interface. What can be done is to say it, and
    leave the rewrite button right next to it — which is the remedy, and it was already there.
   */
  "project.aiWrittenIn": "escrito en {lang}",
  "lang.es": "español",
  "lang.en": "inglés",
  "project.aiNoteBefore": "Usa el modelo que hayas conectado con",
  "project.aiNoteAfter":
    "Se le da el README, la pila detectada y los últimos commits, y se le prohíbe afirmar nada que no esté ahí. No sustituye a la descripción del proyecto: se guarda aparte.",

  "project.whereFrom": "Procedencia",
  "project.originOwn": "Lo hiciste tú",
  "project.originForked": "Partió del trabajo de otro",
  "project.originForeign": "No lo empezaste tú",
  "project.originTemplate": "Lo generó una plantilla",
  "project.originUnknown": "No hay forma de saberlo",
  "project.originEvidence": "Señales que sustentan el resultado",
  /*
    Why Panoma classified this project this way, phrase by phrase.
    The verdict —'own', 'bifurcated', 'someone else's'— was already passing through here; these
    reasons appeared below in fixed Spanish, so half the screen was translated and the other half
    was not.
    And they are the half that matters: for almost everyone, the verdict is 'their own,' and without
    the reasons it is indistinguishable from a default value. What convinces that Panoma has
    really looked is reading 'the first commit is yours' and being able to go check it.
   */
  "origin.remote-foreign": "el remoto está en la cuenta de {value}, no en la tuya",
  "origin.first-commit-foreign": "el primer commit lo hizo {value}",
  "origin.license-foreign": "la licencia es de {value}",
  "origin.history-restarted": "el historial de git empieza contigo, así que se reinició al copiarlo",
  "origin.your-share": "{value}% del historial es tuyo",
  "origin.zip-suffix": "la carpeta acaba en «-{value}», como los ZIP de GitHub",
  "origin.scaffold-first-commit": "el primer commit lo escribió {value}",
  "origin.only-commit": "y es el único que hay: nadie lo ha tocado desde entonces",
  "origin.commit-count": "y el historial tiene {n} commit{s}",
  "origin.container-yours": "el repositorio que lo contiene lo empezaste tú ({value})",
  "origin.first-commit-yours": "el primer commit es tuyo ({value})",
  "origin.all-history-yours": "todo el historial es tuyo ({n} commit{s})",
  "origin.remote-yours": "el remoto está en tu cuenta ({value})",
  "origin.scaffold-continued": "empezó desde {value} y lo has seguido tú",
  "origin.zip-suffix-own":
    "la carpeta acaba en «-{value}», como los ZIP que sirve GitHub: probablemente empezó como una descarga",
  "origin.zip-suffix-none":
    "la carpeta acaba en «-{value}», que es como GitHub nombra los ZIP de «Download ZIP»",
  "origin.manifest-repo": "el manifiesto apunta a {value}",
  "origin.readme-foreign": "el README se presenta como material ajeno: «{value}»",
  "origin.no-own-repo": "y no hay repositorio propio donde empezara",
  "origin.no-repo": "no hay repositorio: sin historial no se puede saber quién lo empezó",
  "project.noOriginEvidence": "Panoma no encontró señales suficientes para justificar una procedencia.",
  "project.localDataQuestion": "Lo que Panoma ha medido",
  "project.localData": "Inventario local",
  "project.primaryLanguage": "Lenguaje principal",
  "project.notDetected": "No detectado",
  "project.versionControlRemote": "Git · con copia remota",
  "project.versionControlLocal": "Git · solo en este equipo",
  "project.versionControlNone": "Sin Git",
  "project.versionControlUnknown": "No comprobado",
  "project.firstSeen": "En el catálogo desde",
  "project.fileCount": "Ficheros de código",
  "project.path": "Ruta",
  "project.branch": "Rama",
  "project.lastScan": "Último escaneo",
  "project.size": "Tamaño",
  "project.files": "{n} fichero{s}",
  "project.logQuestion": "Trabajo coordinado",
  "project.logTitle": "Actividad de agentes",
  /* How many remain outside the limit of eight. The final number, as the house dictates. */
  "project.logMore": "y más: {n}",
  /* The files the agent reported touching. They were saved but not rendered. */
  "project.logFiles": "ficheros: {n}",
  "project.logbook": "Bitácora",
  /*
    What was sent to a terminal from the 'open in your terminal' button. The table had had an
    index since its first day whose comment promised this screen, and the screen did not exist: it
    was written on each launch and no one read it.
   */
  "project.launches": "En tu terminal",
  "project.launchOf": "encargo redactado",
  /*
    It used to say 'no agent has worked here yet,' which contradicted the panel next to it: the
    card of the person who built it pulls the agents from the commit signatures, and it can say
    that they wrote 62% while this says that none have passed. This list measures something else —
    what an agent writes on MCP while working — and now it says it.
   */
  "project.logEmpty": "Ningún agente ha apuntado nada aquí por MCP todavía.",
  "project.logEmptyHow":
    "Conecta uno a este proyecto y lo que vaya apuntando —cambios, decisiones, bloqueos— queda escrito aquí, para quien pase dentro de tres meses.",
  "project.tasks": "Tareas",
  "project.proposals": "Propuestas",
  "project.servicesQuestion": "Dónde vive",
  "project.servicesTitle": "Servicios y distribución",
  "project.servicesEmpty": "No se detectaron servicios ni destinos de distribución.",
  "project.noTechnologies": "No se detectaron tecnologías todavía.",
  "project.cleanupQuestion": "Limpieza",
  "project.cleanupTitle": "Recursos sin usar",

  // File: the resources that no code file mentions.
  "project.assetsSearch": "buscar recursos sin usar",
  "project.assetsReading": "leyendo el código…",
  "project.assetsSlow": "Lee todos los ficheros de código del proyecto, así que tarda unos segundos.",
  "project.assetsFailed": "No se pudo analizar.",
  /*
    Three figures in one sentence, and each one had its word inflected behind it: «1 recursos
    analizados · 1 gestionados · 1 ficheros de código leídos». It sat exempt in
    `plurals.test.ts` on the grounds that fixing it meant redoing the sentence — which was true,
    and redoing it is what this is. Three suffixes would have needed agreement on the participle
    as well; putting each figure at the end of its own piece needs none.
   */
  "project.assetsStats":
    "recursos analizados: {n} · gestionados por la plataforma (no se miran): {platform} · ficheros de código leídos: {sources}",
  "project.assetsAllUsed": "Todos los recursos aparecen mencionados en el código.",
  "project.assetsUnused": "{n} sin referencia",
  "project.assetsDynamic":
    "En {dirs} el código construye las rutas a trozos, así que esas carpetas quedan fuera del análisis: un fichero puede usarse sin que su nombre aparezca escrito.",
  "project.assetsCaveat":
    "«Sin referencia» significa que el nombre del fichero no aparece en ningún fichero de código. Es una pista, no una prueba — compruébalo antes de borrar nada.",

  "project.updated": "Actualizado {when}",
  "project.codeSize": "{size} de código",
  "project.backToCatalog": "Volver al catálogo",

  /*
    Ten pages that never went through here.
    Cover, form, and template translated; space, copies, sections, executions, packages, agents,
    credentials, search, and unsaved work had Spanish written by hand in the JSX. With the
    interface in English, that didn't read as 'not translated' — it read as if half the
    application is another application.
   */

  // Texts that appear on more than one page. Here and not repeated: the same heading with two
  // wordings is read as two different things.
  "common.copyOf": "copia de {name}",
  "common.iconOf": "Icono de {name}",
  "common.health": "Salud {score}/100",

  // Search in the code: the header. The inside part was already translated.
  "search.title": "Busca en todos tus proyectos a la vez",
  "search.intro":
    "«¿Dónde escribí yo aquello del webhook de Stripe?». Ningún editor puede contestarlo, porque ninguno tiene abiertos los ochenta proyectos.",

  // Credentials in the history.
  "credentials.title": "Claves commiteadas en tus repositorios",
  "credentials.intro":
    "Se busca en lo que git sigue, en todos tus repositorios a la vez. Una clave en un {env} ignorado está en tu disco; una clave commiteada está en cada copia que alguien haya clonado, y sigue en el historial aunque borres el fichero. Hoy se lee el contenido actual de lo seguido: una clave que ya borraste del árbol sigue en los commits viejos y todavía no se busca ahí.",
  "credentials.allowlist":
    "Solo se marcan credenciales con forma reconocible —prefijos que emite un único proveedor—, nunca heurísticas del tipo «una cadena larga junto a la palabra key». Y hay una lista explícita de lo que {not} es un secreto: las claves de cliente de Firebase y Google Maps son públicas por diseño, viajan dentro del APK y marcarlas sería la forma más rápida de que dejaras de mirar esta página.",
  "credentials.not": "no",

  // The review itself, with its button and its report.
  "scan.start": "revisar el portafolio",
  "scan.again": "revisar otra vez",
  "scan.busy": "leyendo el historial…",
  "scan.failed": "No se pudo revisar.",
  "scan.unreachable": "No se pudo contactar con el servidor.",
  "scan.findingOne": "{n} hallazgo",
  "scan.findingMany": "{n} hallazgos",
  "scan.reposScanned": "{n} repositorio{s} revisado{s}",
  "scan.skipped": "{n} sin git",
  "scan.public": "{n} descartado{s} por ser públicos por diseño",
  "scan.publicTitle":
    "Claves de cliente de Firebase y Google Maps, ficheros de ejemplo y dependencias de terceros.",
  "scan.clean": "Ninguna credencial con forma reconocible en el historial de tus repositorios.",
  "scan.trackedByGit": "{label} seguido por git",
  /*
    The fifteen types of credential that the scanner looks for, by their identifier.
    The texts live in `packages/core/src/secrets.ts` alongside the pattern that finds them, and
    there they are in Spanish: it is repository prose. The terminal already translated them via
    `ruleId` from its own dictionary; the web displayed them raw, so an entry in English showed
    "Secret Stripe key in production" and composed ".env file tracked by git," which reads like a
    mistake. Same mechanism here, with `label` of `core` as backup in case a new rule appears
    before its key.
    The four in the file go without «followed by git» inside: that is put by `scan.trackedByGit`,
    which is what separates «this file should not exist» from «this file is committed».
   */
  "secret.stripe-live": "Clave secreta de Stripe en producción",
  "secret.stripe-test": "Clave secreta de Stripe de pruebas",
  "secret.aws": "Clave de acceso de AWS",
  "secret.github-token": "Token de GitHub",
  "secret.anthropic": "Clave de API de Anthropic",
  "secret.openai": "Clave de API de OpenAI",
  "secret.slack": "Token de Slack",
  "secret.private-key": "Clave privada",
  "secret.supabase-service": "Clave service_role de Supabase",
  "secret.google-api-key": "Clave de API de Google",
  "secret.sendgrid": "Clave de SendGrid",
  "secret.env-file": "fichero .env",
  "secret.key-file": "fichero de claves",
  "secret.google-service-account": "cuenta de servicio de Google",
  "secret.ssh-private-key": "clave SSH privada",
  /* And why each one matters. The four from the file share a reason: see `secretWhy.file`. */
  "secretWhy.stripe-live": "Permite cobrar y mover dinero de la cuenta real.",
  "secretWhy.stripe-test": "Solo afecta al entorno de pruebas, pero no debería estar en el historial.",
  "secretWhy.aws": "Da acceso a la cuenta de AWS según los permisos del usuario.",
  "secretWhy.github-token": "Da acceso a los repositorios del usuario según sus permisos.",
  "secretWhy.anthropic": "Se factura a tu cuenta hasta que la revoques.",
  "secretWhy.openai": "Se factura a tu cuenta hasta que la revoques.",
  "secretWhy.slack": "Da acceso al espacio de trabajo de Slack.",
  "secretWhy.private-key": "Una clave privada en el historial deja de ser privada.",
  "secretWhy.supabase-service":
    "Salta todas las políticas de seguridad a nivel de fila. Es la llave maestra.",
  "secretWhy.google-api-key":
    "Fuera de la configuración de cliente, una clave de Google sin restricciones de dominio la puede usar cualquiera y se factura a tu cuenta.",
  "secretWhy.sendgrid": "Permite enviar correo en tu nombre.",
  "secretWhy.file":
    "Borrarlo del árbol no basta: lo commiteado sigue en el historial y la clave hay que rotarla.",
  "scan.orderTitle": "Si algo de esto es real, el orden importa",
  "scan.step1Act": "Revoca la clave en el panel del proveedor.",
  "scan.step1": "{act} Es lo único que la desactiva de verdad.",
  "scan.step2": "Emite una nueva y ponla en un `.env` ignorado.",
  "scan.step3Act": "Después, si quieres, límpiala del historial con `git filter-repo`.",
  "scan.step3":
    "{act} Borrarla del fichero y commitear no sirve: sigue en todos los commits anteriores, y en cualquier copia que alguien haya clonado.",
  "scan.notStored":
    "Este informe no se guarda en la base de datos. Guardar dónde están exactamente tus claves filtradas sería crear un segundo sitio del que se pueden filtrar.",

  // Packages: the portfolio seen by department.
  "packages.title": "{n} dependencia{s} en tu portafolio",
  "packages.emptyTitle": "Sin dependencias todavía",
  "packages.emptyBody":
    "Salen de los proyectos del catálogo: escanea una carpeta y las dependencias de cada proyecto aparecen aquí, con su versión y sus avisos.",
  "packages.intro":
    "El portafolio visto por paquete en vez de por proyecto. Ningún gestor de paquetes puede darte esta vista: solo ve un proyecto a la vez.",
  /*
    Three words that have to agree in Spanish —«1 dependencias directas atrasadas» is what it
    said— and an irregular plural in English. That is why the figures are called `{n}` and `{m}`:
    a shape gap only knows how to look at those names, and with them each word follows its own
    number in both languages.
   */
  "packages.stats":
    "{n} dependencia{s} directa{s} atrasada{s} · {m} aviso{ms} · comprobado {when}",
  /*
    And what is written when nobody has asked yet.
    `outdated_deps` and `vuln_count` are born at zero and only enrichment fills them, so on a
    freshly scanned catalog «0 dependencies behind · 0 advisories» is not a healthy portfolio: it
    is a question nobody asked. The header says so, and names the command that asks it.
   */
  "packages.statsUnchecked":
    "Versiones y avisos sin preguntar todavía — ejecuta {cmd} y esta línea se rellena.",
  "packages.colPackage": "paquete",
  "packages.colProjects": "proyectos",
  "packages.colInUse": "en uso",
  "packages.colLatest": "última",
  "packages.colAdvisories": "avisos",
  "packages.deprecated": "obsoleto",
  "packages.unpinned": "sin fijar",

  // Agents: what they have done and how they connect.
  "agents.empty": "Ningún agente conectado",
  "agents.countOne": "{n} agente",
  "agents.countMany": "{n} agentes",
  "agents.intro":
    "Lo que los agentes de IA han hecho en tus proyectos, en un solo sitio. Se conectan por MCP y reportan lo que hacen mientras trabajan.",
  "agents.connectFirst": "Conecta uno desde la terminal:",
  "agents.connectNote":
    "El comando imprime la clave y la configuración MCP lista para pegar. Mientras tanto, la atribución por trailers de git ya funciona sin instalar nada — mira cualquier proyecto con historial.",
  "agents.entries": "{n} entrada{s} · {m} proyecto{ms}",
  "agents.seen": "visto {when}",
  "agents.recentActivity": "Actividad reciente",

  // Familias de copias.
  /*
    The gap fixes the noun and not the verb: «1 carpeta que son copia» is what came out, and a
    catalog with a single family of two members is the normal case right after installing. With
    two keys each form is written whole, which is the other way of following the house rule.
   */
  "families.titleOne": "{n} carpeta que es copia",
  "families.titleMany": "{n} carpetas que son copia",
  "families.intro":
    "Agrupadas por commit raíz, remoto de git, nombre y dependencias compartidas. Para cada familia, panoma señala cuál conservar — no borra nada. Que sea la principal no significa que el proyecto esté vivo: eso lo dice su estado, aparte.",
  /*
    `n` and not `families`, for the reason written on the agents page: the shape gaps that keep
    «1 familias» away only know how to look at `n` and `m`. A catalog with a single duplicated
    pair makes exactly one family, so this line met its one on the first copy anyone found.
   */
  "families.stats": "{n} familia{s} · {bytes} de código repetido",
  "families.empty": "No hay copias en el catálogo. Escanea una carpeta con {cmd} para buscarlas.",
  "families.copiesAndSize": "{n} copia{s} · {bytes}",
  /*
    What this row stands for besides itself.

    The grid shows the canonical folder and keeps its copies, so one line can be worth four folders
    without ever saying so. `copyCount` was queried, sent to the browser and drawn nowhere: either
    the figure is used or it is surplus.

    It goes on the path line and not beside the name. The two marks up there are reserved, in that
    file's own words, for «things that do not wait» — someone awaiting an answer, work that exists
    only on this disk. This one does not press. It places.
   */
  "store.alsoCopies": "· {n} copia{s} más",
  "store.alsoCopiesTitle": "Esta ficha vale por la carpeta buena; las otras están en Copias.",
  /*
    The same fact for the tile, where the sentence does not fit and becomes the tooltip. It is
    written whole, with its figure inside, instead of joining `store.alsoCopies` and the title at
    render time: the «·» that opens the other one is a separator between the path and this, not
    prose, and a tooltip assembled from two strings cannot be read here as the reader will hear it.
   */
  "store.alsoCopiesMark": "{n} copia{s} más. Esta ficha vale por la carpeta buena; las otras están en Copias.",
  "families.canonical": "principal",
  "families.copy": "copia",
  "families.noGit": "sin git",
  "families.sameDate": "misma fecha",
  "families.daysBehind": "{n} d por detrás",

  // Executions: the list and the card of a proposal.
  "runs.empty": "Ninguna propuesta todavía",
  "runs.countOne": "{n} propuesta",
  "runs.countMany": "{n} propuestas",
  "runs.intro":
    "Cada propuesta se prepara en un worktree aislado: se edita el manifiesto, se instala y se ejecutan los tests. El resultado es una rama con el parche — nunca un cambio aplicado en tu carpeta, y nunca un push.",
  "runs.tryHint": "Prueba con una dependencia atrasada:",
  "runs.argProject": "proyecto",
  "runs.argPackage": "paquete",
  "runs.branch": "rama",
  "runs.security": "seguridad",
  "runs.advisory": "aviso",
  "runs.noTestsEmphasis": "nadie ha comprobado",
  "runs.noTests":
    "Este proyecto no tiene tests, así que {nobody} que siga funcionando con esta versión. Revisa el parche con más cuidado del habitual.",
  "runs.steps": "Pasos",
  "runs.patchLines": "Parche · {n} línea{s}",
  "patch.output": "output ({n} caracteres)",
  "runActions.apply": "Aplicar en mi repositorio",
  "runActions.merging": "Fusionando…",
  "runActions.discard": "Descartar",
  "runActions.discarding": "Borrando…",
  "runActions.note": "Fusiona {branch} en tu rama actual. No hace push.",
  "runActions.noDetail": "Sin detalle.",
  "runActions.unreachable": "No se pudo contactar con el servidor.",

  /*
    The isolation under which it ran a proposal. The title is not decoration: it says what an
    installation script touched on your machine, and that is the last thing that should appear in
    a language the reader does not understand.
   */
  "isolation.container": "contenedor",
  "isolation.container.title":
    "Ejecutado en un contenedor efímero: sin acceso a tu disco ni a tus procesos.",
  "isolation.hardened": "entorno limpio",
  "isolation.hardened.title":
    "Ejecutado con las variables de entorno filtradas y HOME desechable: los scripts de instalación no vieron tus credenciales. Siguen ejecutándose en tu máquina y con red.",
  "isolation.local": "sin aislar",
  "isolation.local.title":
    "Ejecutado en tu máquina con tu entorno completo. Un script de instalación tuvo acceso a tus variables y a tu disco.",
  "isolation.degraded": "degradado",

  // Sections: what you took out of sight, and how to return it.
  "hidden.empty": "No has apartado nada",
  /*
    «1 ocultos y 0 fuera del catálogo», in the heading of the page, from the first project
    anyone hides. `{hidden}` also renamed because two keys three lines apart were using that
    same name for two different things: a figure here, a `<strong>` word in `hidden.intro`.
   */
  "hidden.count": "{n} oculto{s} y {m} fuera del catálogo",
  "hidden.wordHidden": "oculto",
  "hidden.wordExcluded": "fuera del catálogo",
  "hidden.intro":
    "Un proyecto {hidden} sigue en el catálogo con todos sus datos: solo deja de aparecer en la rejilla y en los contadores. Uno {excluded} se ha borrado de Panoma, y ningún escaneo lo vuelve a añadir hasta que lo readmitas.",
  "hidden.diskNote":
    "Ninguna de las dos cosas ha tocado tu disco. Todas las carpetas siguen donde estaban, con su código y su historial intactos.",
  "hidden.sectionHidden": "Ocultos ({n})",
  "hidden.sectionExcluded": "Fuera del catálogo ({n})",
  "hidden.outSince": "fuera desde {when}",
  "hidden.readmitNote":
    "Readmitir solo levanta el veto: el proyecto reaparece en el siguiente {cmd}, con sus datos analizados de nuevo desde cero.",
  "hidden.emptyBody": "Cuando ocultes o quites un proyecto, aparecerá aquí para que puedas devolverlo.",
  "undo.unhide": "volver a mostrar",
  "undo.readmit": "readmitir",
  "undo.failed": "No se pudo.",
  "undo.unreachable": "No se pudo contactar con el servidor.",

  // Espacio en disco.
  "disk.empty": "Todavía no has medido nada",
  "disk.title": "{bytes} vuelven con un comando",
  "disk.intro":
    "Dependencias instaladas, cachés y salidas de compilación. Panoma no borra nada: mide, dice de dónde sale cada cifra y te deja el comando que la regenera.",
  "disk.metricTotal": "ocupan en total",
  "disk.metricReclaimable": "regenerable",
  "disk.metricShare": "{n}% del total",
  "disk.metricDormant": "en proyectos dormidos",
  "disk.metricDormantDetail": "sin un commit en más de un año",
  "disk.metricMeasured": "proyectos medidos",
  "disk.ofTotal": "de {bytes}",
  "disk.shareAria": "{n}% del proyecto es regenerable",
  "disk.moreDirs": "+{n} más",
  "disk.measuredAt": "medido {when}",
  "disk.rules":
    "Una carpeta entra en esta lista por una de dos razones: su nombre solo significa «generado» ({generated}) o el propio proyecto la ignora en git. Las de nombre ambiguo —{ambiguous}— que git no ignora se quedan fuera: en un proyecto son basura y en el de al lado son código escrito a mano.",
  "measure.start": "medir el disco",
  "measure.again": "volver a medir",
  "measure.busy": "recorriendo el disco…",
  "measure.noteFirst":
    "Recorre el árbol completo de cada proyecto. La primera vez tarda varios minutos.",
  "measure.noteBusy":
    "Recorre el árbol completo de cada proyecto. Puede tardar varios minutos; no cierres esta pestaña.",
  "measure.noteLast":
    "Última medición: {when}. Los tamaños cambian cada vez que instalas o compilas.",
  "measure.done": "{n} proyecto{s} medidos",
  "measure.missing": "{n} carpeta{s} ya no en el disco",
  "measure.failed": "No se pudo medir.",
  "measure.unreachable": "No se pudo contactar con el servidor.",

  // I work without saving, for what is at stake and not for a project.
  "unsaved.safe": "Todo está a salvo",
  "unsaved.countOne": "{n} proyecto con trabajo sin guardar",
  "unsaved.countMany": "{n} proyecto{s} con trabajo sin guardar",
  "unsaved.intro":
    "Lo que existe solo en este disco. Panoma lee el estado de git de cada carpeta y no toca nada: aquí se enseña el comando, lo ejecutas tú.",
  "unsaved.statUnversioned": "{n} carpeta{s} sin control de versiones",
  /*
    `{shown}` carries the already formatted figure —thousands separator included— and `{n}`
    travels beside it only so that `{s}` has a number to look at: `shapeFor` demands
    `typeof === "number"` and gave up on the formatted string, so the page printed «12 commit{s}»
    with the braces on screen. Same split as `store.showing`: what is read, and what is counted.
   */
  "unsaved.statOrphanCommits": "{shown} commit{s} sin ninguna copia remota",
  "unsaved.statUnpushed": "{n} commit{s} sin subir",
  "unsaved.statChecked": "comprobado en el último escaneo · vuelve a correr {cmd} para refrescarlo",
  "unsaved.emptyBody":
    "Ningún proyecto del catálogo tiene cambios sin commitear, commits sin subir ni repositorios sin remoto.",
  "unsaved.emptyNote":
    "Los proyectos escaneados con {flag} no aparecen aquí: de esos no se sabe nada, que no es lo mismo que estar limpios.",
  "unsaved.group.no-git": "Sin control de versiones",
  "unsaved.blurb.no-git":
    "Carpetas con código y sin repositorio. No hay historial, ni remoto, ni forma de deshacer nada: un borrado accidental aquí no se recupera.",
  "unsaved.group.no-commits": "Con repositorio y ningún commit",
  "unsaved.blurb.no-commits":
    "Alguien hizo `git init` y ahí se quedó. Todo lo que hay dentro está fuera de cualquier historial.",
  "unsaved.group.no-remote": "Solo en este disco",
  "unsaved.blurb.no-remote":
    "Repositorios sin remoto configurado. Todo su historial existe en un único sitio: aquí.",
  "unsaved.group.unpushed": "Con commits sin subir",
  "unsaved.blurb.unpushed": "Tienen remoto, pero hay commits que todavía no han salido de aquí.",
  "unsaved.group.uncommitted": "Con cambios sin commitear",
  "unsaved.blurb.uncommitted": "Ficheros tocados o sin añadir que no están en ningún historial.",
  "unsaved.group.stashes": "Con stashes olvidados",
  "unsaved.blurb.stashes": "Cambios apartados «un momento» que llevan ahí desde entonces.",
  "unsaved.files": "{n} fichero{s}",
  "unsaved.copyOfTitle":
    "Panoma la considera una copia de {name}. Aun así, lo que hayas tocado aquí solo está aquí.",

  /*
    What the routes answer when something fails.
    The two screens that are called `error` and `hint` exactly like that, so each error was a
    sentence in Spanish within an English interface — and an error is precisely the moment when
    you need to understand what it says. The agent routes and the MCP server are deliberately left
    out: that is a protocol for another audience, and it deserves its own decision.
   */
  "api.localOnly": "{action} solo funciona con el catálogo local.",
  "api.action.openFolder": "Abrir carpetas",
  "api.action.aiConfig": "Configurar el modelo",
  "api.action.assign": "Encargar",
  "api.action.withdraw": "Retirar un encargo",
  "api.action.launchAgent": "Lanzar un agente",
  "api.action.check": "Comprobar la build",
  "api.action.measureDisk": "Medir el disco",
  "api.action.writeBlock": "Escribir el bloque",
  "api.action.rescan": "Volver a escanear",
  "api.action.noteTask": "Anotar tareas",
  "api.action.noteMemory": "Curar la memoria",
  "api.action.hooks": "Poner los ganchos",
  "api.missingId": "Falta el identificador del proyecto.",
  "api.missingProject": "Falta el proyecto.",
  "api.noProject": "Proyecto no encontrado.",
  "api.noAssignment": "Ese encargo no existe.",
  "api.unknownAction": "Acción desconocida.",
  /*
    A cap that is not understood. It goes with the value in front because whoever wrote it is
    looking at their own URL or their own `curl`, and 'the limit is not valid' forces them to
    guess which of the two numbers they put is the wrong one.
   */
  "api.badLimit": "«{value}» no vale como límite: hace falta un entero de 1 a {cap}.",
  "api.unreachable": "No se pudo contactar con el servidor.",
  "api.folderGone": "La carpeta ya no está en {root}. Vuelve a escanear.",

  // The origin guardian. The message appears entirely on the screen when a button is rejected.
  "guard.rejected": "Petición rechazada: {detail}.",
  "guard.rejectedHint": "Panoma solo acepta acciones desde su propia interfaz o desde el CLI.",
  "guard.otherSite": "la petición viene de otro sitio ({site})",
  "guard.otherOrigin": "el origen {origin} no es esta aplicación",
  "guard.localOperatorOnly":
    "Esto le da órdenes al ordenador donde vive el catálogo, y para eso hace falta su clave de operador.",
  "guard.localOperatorOnlyHint":
    "Abre el catálogo con el enlace de «esta máquina» que imprime «{cli} up --network», o hazlo desde el propio ordenador.",

  // Open a project: the path that most often responds with an error, because the folders are moved
  // and the programs are not always installed.
  "open.unknownTool": "No sé abrir con «{tool}».",
  "open.gone": "La carpeta ya no está en {root}.",
  "open.goneHint":
    "Puede que la movieras o la borraras. Vuelve a escanear para actualizar el catálogo.",
  "open.noEditor": "No encontré ningún editor en el PATH.",
  "open.noConfig": "No sabemos dónde guarda ese agente su configuración.",
  "open.noEditorHint":
    "Se buscan, por este orden: {order}. En VS Code o Cursor se instala con «Shell Command: Install 'code' command in PATH», y el orden se cambia con la variable PANOMA_EDITOR.",
  "open.unsupportedTool": "No sé abrir «{tool}» en {os}.",
  "open.launchFailed": "No se pudo abrir con {command}.",
  "open.launchNamedFailed": "No se pudo abrir {name}: {detail}",
  "open.noTerminalHere": "Todavía no sé abrir un terminal en {os}.",
  "open.noTerminalHereHint": "Abre la carpeta y lanza tu agente a mano.",
  "open.noAgent": "No encontré ningún agente instalado.",
  "open.noAgentHint":
    "Se buscan, por este orden: {agents}. Con uno instalado y con la sesión iniciada, este botón lo lanza.",
  "open.appMissing": "Esa aplicación no está instalada en esta máquina.",

  // Modelo y credenciales.
  "ai.unknownProvider": "Proveedor desconocido.",
  "ai.noKeyNeeded": "{name} no usa clave: usa tu sesión ya iniciada.",
  "ai.emptyKey": "La clave llegó vacía.",
  "ai.notAKey": "Eso no parece una clave.",
  "ai.noLogin": "Ese proveedor no usa inicio de sesión.",
  "ai.loginBusy": "Ya hay un inicio de sesión a medias. Termínalo o espera a que caduque.",

  // Orders, build verification, tasks, and monitored sites.
  "assign.alreadyQueued": "Ese encargo ya está en la cola.",
  "assign.pasteHint": "Copia el encargo y pégaselo a tu agente.",
  "check.busy": "Ya hay una comprobación en marcha para este proyecto.",
  "check.failed": "No se pudo comprobar: {detail}",
  "tasks.needTitle": "La tarea necesita una frase.",
  "tasks.tooLong": "La frase no puede pasar de {n} caracteres.",
  "notes.tooLong": "Una nota es un hecho en una o dos frases: ni vacía ni un párrafo. El tope de caracteres es 500.",
  "notes.overBudget": "La memoria está llena: consolida o descarta alguna nota antes de aprobar otra. El tope de caracteres es 2000.",
  "notes.sleepingFull": "Las señales dormidas están al completo: descarta o consolida una antes de aprobar otra. El tope de plazas es 30.",
  "notes.pendingFull": "Hay demasiadas propuestas esperando: decide sobre las que hay antes de añadir más. El tope es 20.",
  "notes.gone": "Esa nota ya está decidida.",
  "notes.saveFailed": "No se pudo guardar.",
  "notes.title": "Memoria",
  "notes.hint": "Hechos durables que cualquier agente recibe al abrir el proyecto. Lo que propone un agente espera aquí tu sí.",
  "notes.empty": "Nada apuntado todavía.",
  "notes.pendingTitle": "Propuestas",
  "notes.approve": "Aprobar",
  "notes.discard": "Descartar",
  "notes.add": "Apuntar",
  "notes.addPlaceholder": "Un hecho durable del proyecto…",
  "notes.proposedBy": "propuesta de {agent}",
  "notes.sleepsAt": "duerme en {trigger}",
  "notes.badTrigger": "El dónde tiene que ser una ruta relativa del proyecto: exacta o zona con /** al final.",
  "notes.challengedTitle": "Impugnadas",
  "notes.challengedEvidence": "el disco cambió: {target} ({observed})",
  "notes.reapprove": "Reaprobar",
  "double.title": "El doble",
  "double.shadowTag": "en sombra",
  "double.hint": "Lo que tus agentes te habrían preguntado, y lo que tu doble habría contestado. Nadie ha visto estas respuestas: etiquetarlas es su examen.",
  "double.askedBy": "pregunta de {agent}",
  "double.drafting": "El doble aún no ha redactado.",
  "double.abstained": "El doble se abstuvo: ninguna de tus creencias cubre esta pregunta.",
  "double.cites": "Se apoya en:",
  "double.backed": "Habría dicho lo mismo",
  "double.vetoed": "No",
  "double.labeledBacked": "coincidiste",
  "double.labeledVetoed": "no coincidiste",
  "double.gone": "Esa consulta ya está etiquetada.",
  "double.saveFailed": "No se pudo guardar.",
  "roots.serverOnly": "Los sitios vigilados son de la máquina que sirve el catálogo.",
  "roots.missingFolder": "Falta la carpeta.",
  "roots.system": "{path} es del sistema: ahí no hay proyectos tuyos.",
  "roots.home": "Tu carpeta personal entera es demasiado: añade las carpetas donde programas.",
  "roots.library": "Ahí solo hay datos de apps.",
  "roots.notAFolder": "{path} no es una carpeta que exista.",
  /*
    The folder that already covers it is named because it is the information needed to decide, and
    because keeping it silent had consequences: adding an internal folder did nothing, it
    responded 'found: 2', and whoever thought they had put it in would later remove the external
    one and also take out the internal ones with it.
   */
  "roots.covered":
    "{path} ya está dentro de {covering}, que se mira entera. Si solo quieres esa, quita antes la de fuera.",
  "rescan.failed": "No se pudo actualizar {name}: {detail}",

  // El canal .md.
  "md.missingSlugPath": "Falta el proyecto o el fichero.",
  "md.missingSlugAction": "Falta el proyecto, o qué hacer con el bloque.",
  "accounts.missingInput": "Falta el proyecto o la lista de cuentas.",
  /* The server neither rules it out by staying silent: it says what the input is and keeps nothing. */
  "accounts.badUrlAt": "El enlace de «{label}» no se entiende. No se ha guardado nada.",

  /* Connect an agent to the MCP from the 'Agents' page. */
  "agentMcp.localOnly": "Conectar un agente escribe en este disco: solo desde la máquina local.",
  "agentMcp.missingInput": "Falta el agente.",
  /*
    The same refusal the screen already makes, kept on this side too. The button knows and comes up
    disabled, so nobody reaches here by accident — but a tab left open since before the install, or
    anything calling the route directly, would. A guard that only lives in the interface is a
    guard for the people who were not going to break it anyway.
   */
  "agentMcp.ephemeral": "Esta copia corre desde npx: la configuración apuntaría a una caché que npm puede borrar, y el agente arrancaría sin las herramientas sin decirlo.",
  "agentMcp.ephemeralHow": "Instala panoma y reinicia el catálogo: npm i -g panoma · panoma down && panoma up",
  "agentMcp.noServer":
    "El servidor MCP no está en esta instalación. Constrúyelo con: pnpm --filter @panoma/mcp run build",
  "agentMcp.badJson":
    "{path} tiene un error de sintaxis. No lo toco: arréglalo y pega esto tú, o vuelve a intentarlo.",
  "agentMcp.notAnObject":
    "{path} no tiene la forma que esperábamos. No lo toco: pega esto donde corresponda.",
  "agentMcp.badToml":
    "{path} tiene un error de sintaxis. No lo toco: arréglalo y pega esto tú, o vuelve a intentarlo.",
  "agentMcp.tomlManual":
    "Panoma ya está en {path}, escrito a tu manera. No lo toco: actualízalo tú con esto.",

  /*
    Create and withdraw an agent's key. The path is called two: the "Agents" screen, which a
    person reads in their language, and `panoma agent-key`, which declares English with
    `Accept-Language`. That is why they go here and not as literals — they were literals, and the
    terminal received Spanish.
   */
  "agentKeys.localOnly": "Solo desde la máquina local.",
  "agentKeys.missingField": "Falta «{field}».",
  "agentKeys.gone": "Ese agente ya no está.",

  /*
    The verdicts that come from «Panoma twin mine --save». Both sentences end by saying that
    nothing has been saved, and that is the first thing you need to know: whoever manages
    thousands of entries needs to distinguish between “did not enter” and “partially entered”
    before deciding whether to repeat it. The top one gives both numbers because the action it
    resolves —sending them in batches— depends on how much is left over.
   */
  "verdicts.malformed":
    "Falta la lista de reacciones, o alguna no tiene la forma esperada. No se ha guardado nada.",
  "verdicts.tooMany":
    "Llegan {n} reacciones y de una vez caben {cap}. No se ha guardado nada: mándalas por tandas.",
  /*
    The deletion. `verdicts.badSource` comes with the list inside because whoever makes a mistake
    writing a source doesn't know which ones there are, and sending them to another screen to find
    out is the safest way for them to leave with their data still saved.
   */
  "verdicts.badSource":
    "«{source}» no es una fuente que se pueda olvidar. Las que hay: {sources}, o «all» para todas.",
  /*
    The one to read the saved. The one from the source says "known" and not "that can be
    forgotten" because here nothing is erased, and the one from the review lists the three
    complete words: the three states of `accepted` are the only part of the scheme that you need
    to know to request a screen, and whoever writes "accepted=yes" has no way of deducing them.
   */
  "verdicts.unknownSource": "«{source}» no es una fuente conocida. Las que hay: {sources}.",
  "verdicts.badAccepted":
    "«{value}» no dice nada sobre la revisión. Escribe accepted=true, accepted=false o accepted=pending.",

  /*
    Distillation. The motive arrives in fixed Spanish from the provider and is not translated
    —that is what it reported—, but the sentence that frames it is, as in `runs.crashed`. The clue goes
    separately and only when the credential is missing, which is the only fault here with a
    one-line remedy.
   */
  "distill.failed": "No se pudo destilar: {detail}",
  "distill.noProvider": "Configura un proveedor con: {cli} ai use <proveedor>",

  /*
    The two model errors that every newcomer sees, written by Panoma and not cited from anyone:
    see `lib/model-errors.ts`. The rest of the errors travel just as they are.
   */
  "api.modelFailed": "No se pudo pedir al modelo: {detail}",
  "model.noneConnected": "no hay ningún modelo conectado",
  "model.connectHint":
    "Conecta uno en la página Modelo, o desde el terminal: {cli} ai use <proveedor>",
  "model.noCredential": "falta la credencial de {name}",
  "model.hintCli": "Instala {name} e inicia sesión; Panoma llamará a «{command}».",
  "model.hintOauth": "Inicia sesión en {name} desde la página Modelo.",
  "model.hintKey":
    "Guarda la clave en la página Modelo o con «{cli} ai key {id}». Se saca en {url}",

  /*
    The critic with eyes. The first three are negatives that occur BEFORE calling anyone, and that
    is why they contain within them what to do next: a negative that just says no does not require
    going to look for the why in the documentation. `look.noProfile` is the most important of the
    three — it is not an error, it is the critic saying that without a portrait, it has no
    standard of measurement, that it is the only honest answer to a screen without judgment.
   */
  "look.noImage": "Falta la captura: no hay ninguna imagen que mirar.",
  "look.badImage": "Esa imagen no se puede leer: llega vacía o en un formato que no es imagen.",
  "look.noProfile":
    "No hay con qué medir esta pantalla: tu retrato está vacío y este proyecto no tiene norte. Destila tu historial —{cli} twin distill— o escribe un norte con {cli} north.",
  "look.budgetSpent":
    "Las miradas de hoy están gastadas: {used} de {cap}. Vuelven mañana, o sube el tope con PANOMA_LOOK_BUDGET.",
  "look.failed": "No se pudo mirar: {detail}",
  "look.noVision":
    "El proveedor que tienes configurado no sabe recibir imágenes: {detail}",
  "look.assignMalformed": "Falta decir qué hallazgo hay que encargar.",
  "look.assignGone": "Ese hallazgo ya no está: la mirada de la que salía se borró.",
  "look.assignQueued": "Eso ya está en la cola.",
  "look.assignButton": "Dejarlo en la cola",
  "look.assignDone": "Encargado en {project}: {title}",
  "look.assignNow": "Hazlo ahora",
  "look.assignAgain": "Mándalo otra vez",
  "look.dismissButton": "Descartarlo",
  "look.dismissed": "descartado",
  "look.dismissDone": "Descartado. Si cambias de idea, se puede volver a poner en la cola.",
  "critique.showOne": "Ver el hallazgo",
  "critique.showMany": "Verlos de uno en uno — hallazgos: {findings}",
  "critique.hide": "Cerrar la lista",
  /*
    The review redoes itself when changing the folder: between rendering the list and pressing, the
    position can point to another finding. Before, that other one was handled without saying
    anything.
   */
  "critique.moved":
    "Esta revisión ya no es la que estás viendo: la carpeta cambió y panoma la rehizo. Recarga para ver los hallazgos de ahora.",
  /*
    The three pieces of news that looked the same —that is, did not look different—: never
    checked, checked and clean, and half-checked. "Nothing" does not distinguish "no issues" from
    "I haven't looked," and these are very different things for someone deciding whether to trust
    the section.
   */
  "critique.never":
    "Panoma todavía no ha leído esta carpeta, así que aquí no hay nada que enseñar: ni bueno ni malo.",
  "critique.clean": "Panoma la leyó y no encontró ni una pega mecánica. Ficheros mirados: {n}.",
  "critique.partial":
    "Y no llegó a mirarla entera: la carpeta trae más de lo que cabe en una pasada.",
  /*
    Letter by letter just like `assignment.queuedNote`: it is the same event in two blocks of the
    same screen, and two similar writings are read as two different things.
   */
  "critique.queued": "En la cola. Tu agente lo recoge al entrar en el proyecto.",
  "critique.dismissed": "Descartado. Si cambias de idea, se puede volver a poner en la cola.",
  "look.assignLaunched": "Terminal abierto con {agent} trabajando en ello.",
  "look.assigning": "A la cola…",
  "look.assigned": "en la cola",
  "assign.noTask": "Ese encargo ya no está en la cola.",
  "assign.notQueued": "Ese encargo ya no estaba en la cola: puede que un agente lo cerrara.",
  /* It goes inside the text that the agent receives when opening the terminal, not on the screen. */
  "assign.taskIdLine":
    "Este encargo está en la cola de panoma con el id {id}: cógelo con panoma_claim_task antes de empezar y ciérralo con panoma_complete_task al terminar.",
  "look.noIdentity":
    "Este proyecto todavía no tiene identidad estable —sale del primer commit—, así que no habría dónde guardar lo que se mirase. Haz el primer commit y vuelve a intentarlo.",
  "look.noShot": "Esa captura ya no está en el buzón: {name}",
  "look.noShotName": "Falta decir qué captura hay que mirar.",
  "look.unreadableShot":
    "Esa captura estaba en la lista y no se pudo abrir: {detail}. La habrán borrado, o pesa más de lo que se puede mirar.",

  /*
    The critic's screen. It is the organ through which everything else exists, and until today it
    only lived in the terminal: a verdict on a capture that you cannot see while reading it cannot
    be contradicted. Two sentences cannot be cut from here — the one that says that an image
    travels without erasing anything, and the one that says what the watcher spends on its own.
   */
  "dest.look": "El crítico: qué está mal en lo que te entregaron",
  "look.kicker": "Twin · el crítico",
  "look.title": "Qué está mal en lo que te acaban de entregar",
  "look.intro":
    "El turno del medio, hecho por otro. Mira la pantalla con tu retrato delante y dice qué frase tuya rompe, con la siguiente orden ya redactada. Un juicio que no cuelgue de una frase que firmaste no sale de aquí.",
  "look.yardstick": "vara de medir · frases del retrato: {n}",
  "look.noYardstick":
    "Tu retrato está vacío, así que no hay con qué medir: esto solo denuncia lo que incumple una frase tuya. Empieza por tu doble.",
  "look.budget": "miradas de hoy: {used} · tope del día: {cap}",
  "look.watch":
    "El vigía mira solo lo que aparezca en un buzón, y cada captura una vez. Su reserva del día: {cap}.",
  "look.notRedacted":
    "Una captura viaja entera: no hay forma de tachar píxeles. Lo que se vea en ella —una clave en un terminal, un correo real— sale con la imagen.",
  "look.inboxTitle": "El buzón",
  "look.inboxOf": "El buzón de {project}",
  "look.inboxEmpty": "Montado y vacío: todavía no ha dejado nada ningún agente.",
  "look.inboxSkipped": "ficheros que no son imágenes y no se miran: {n}",
  "look.noInbox": "Ningún proyecto tiene el buzón montado.",
  "look.noInboxHint":
    "Se monta con «{cli} md init» dentro del proyecto. A partir de ahí tus agentes leen en AGENTS.md dónde dejar lo que construyen, y aparece aquí.",
  "look.button": "Mirar",
  "look.buttonAgain": "Volver a mirar",
  "look.looking": "Mirando…",
  "look.looked": "ya mirada · hallazgos: {n}",
  "look.lookedClean": "ya mirada · no rompía nada",
  "look.estimate": "frases: {statements} · tokens del encargo: {tokens} · imagen: {size}",
  "look.verdictOf": "Lo que dice de {subject}",
  "look.clean": "No rompe ninguna de tus frases.",
  "look.unreadable":
    "La respuesta no tenía forma de hallazgos. La llamada se pagó igual, y se puede volver a mirar.",
  "look.fix": "Pídele: {fix}",
  "look.against": "contra: {statement}",
  "look.measured": "medido contra frases: {statements}",
  "look.dropped": "juicios sin respaldo descartados: {n}",
  "look.uploadTitle": "¿No está en ningún buzón?",
  "look.uploadHint":
    "Una aplicación de escritorio, un marco de Figma, la foto de un móvil: lo que ningún agente puede capturar se sube desde aquí.",
  "look.uploadPick": "Elegir imagen",
  "look.uploadTarget": "Proyecto al que subir la captura",
  "look.badType": "Eso no es una imagen de las que se pueden mirar: PNG, JPEG, WebP o GIF.",
  "look.tooBig": "Esa imagen pesa {size} y el tope está en {cap}. Recórtala o expórtala a JPEG.",
  "look.historyTitle": "Lo que ya ha mirado",
  "look.historyEmpty": "Todavía no ha mirado nada.",
  "look.firedWatch": "lo miró el vigía",
  "look.firedHand": "lo pediste tú",

  /*
    The portrait. `taste.full` carries both figures because what it resolves —removing something—
    depends on how much is left over, just like in `verdicts.tooMany`.
   */
  /*
    “Your decision was kept, but…” was true and ceased to be: since the request goes in a
    transaction, a portrait that does not fit keeps nothing. A sentence that promises the opposite
    is worse than saying nothing — whoever reads it will believe that it is already decided.
   */
  "taste.full":
    "No cabe: el retrato ocuparía {chars} de {cap} caracteres. No se ha guardado nada. Quita alguna frase, o acótala a su proyecto para que solo cuente allí, y vuelve a guardar.",

  /*
    The double page. It is the only surface where the portrait is decided with the mouse, and
    that's why the text carries two things that the terminal mentioned in passing: that nothing
    proposed reaches the agents until the person says yes, and that the file is the other door to
    the same thing. Without those two sentences, the screen looks like a report about someone
    instead of a document that is signed.
   */
  "twin.toCritic": "Enseñarle una pantalla al crítico →",
  "twin.title": "Esto es lo que he aprendido de ti",
  "twin.titleEmpty": "Todavía no he aprendido nada de ti",
  /*
    The second half is the one that teaches how to decide. What is accepted does not go to the
    project where it was learned: it goes to everyone's AGENTS.md, and without saying it the
    question the person asks themselves is 'is this true?' instead of 'is this also true for
    others?'. The phrase that revealed it was true where it was said and absurd next to it: an
    audio tray requested from an application that keeps a car's history.
   */
  "twin.intro":
    "Cada creencia sale de cosas que le escribiste a tus agentes, con las citas debajo. No hay nada que aprobar: si no tocas nada, esto es lo que leen tus agentes. Léelo, y corrige lo que no seas tú.",
  /*
    And the same introduction while the permission is not given, because then the one above is
    false: the file is empty and the agents do not read any.
   */
  "twin.introWaiting":
    "Cada creencia sale de cosas que le escribiste a tus agentes, con las citas debajo. Todavía no llegan a ellos: esto lo dedujo una máquina y hace falta que digas que sí una vez, ahí abajo.",
  "twin.introEmpty":
    "Panoma lee tu historial con los agentes en tu propio disco y saca de ahí las pocas cosas que de verdad piensas sobre cómo quieres que quede tu trabajo, con las citas de las que salió cada una.",
  "twin.introEmptyHint":
    "Empieza aquí abajo, en tus historias: dice cuáles hay en esta máquina y cuánto ocupan, medido sin abrir ninguna.",
  "twin.counts": "creencias: {beliefs} · en formación: {forming} · evidencia: {observations}",
  /*
    Density: how much evidence supports each belief. It is the number that tells whether this
    works — if it stays at one, the synthesis is copying instead of synthesizing.
   */
  "twin.density": "observaciones por creencia: {density}",
  /*
    The piles go in front of the percentage, always. The denominator is everything the machine has
    told you, and silence counts as a correct answer, so the raw number is the one you can verify
    by looking at the screen and not the percentage.
   */
  "twin.corrections": "has corregido {corrections} de {shown}",
  "twin.rate": "{rate} % ha necesitado que lo corrijas",
  /* The other half of the note. The number at the end, like in everything that is counted here. */
  /*
    The banner announces; the detail says where. Without this second half, the notice was a
    mystery: you knew there was something and not how to get there.
   */
  "today.criticWhere": "Lo que vio, y dónde",
  "today.criticFindingOne": "{n} cosa",
  "today.criticFindingMany": "{n} cosa{s}",
  "today.criticOne": "el crítico ha visto algo mientras no mirabas",
  "today.criticMany": "el crítico ha visto cosas mientras no mirabas: {n}",
  "twin.briefs": "de lo que el crítico ha visto has encargado {ordered} de {findings}",
  "twin.briefsRate": "{rate} % de lo que señala te vale",
  "twin.briefsLaunched": "de esos han salido a un agente: {launched}",
  "twin.briefsDiscarded": "y has dicho que no a: {discarded}",
  "twin.reachTitle": "Quién lo lee",
  "twin.reach": "Tu retrato baja al .md de estos proyectos: {reached} de {projects}",
  "twin.reachNone": "Ahora mismo no lo lee ningún agente: ninguno de tus proyectos tiene abierto el canal. Se abre uno a uno, dentro de la carpeta.",
  "twin.reachSome": "En los demás no está abierto el canal, así que ahí tus agentes trabajan sin saber nada de esto.",
  "twin.reachHow": "{cli} md init",
  "twin.designTitle": "Cómo se ve lo tuyo",
  "twin.designFrom": "Sale de los proyectos que el crítico ha leído, sin contar copias: {read} · de esos, con algo que mirar: {withUi}",
  "twin.designProjects": "proyectos: {projects}",
  "twin.designFonts": "Tipografías: {fonts}",
  "twin.designRadii": "Esquinas: {radii}",
  "twin.designTraits": "Con modo oscuro: {dark} · con animación: {animation}",
  "twin.briefsRelaunched": "alguno más de una vez — lanzamientos: {launches}",
  "twin.digest":
    "En los últimos {days} días — nuevas: {created} · afinadas: {refined} · retiradas: {retired}.",
  /*
    From how much history the portrait comes out. It is the missing line: without it, fourteen
    determined sentences and none waiting read like the end of the road, when they were 9% of a
    corpus of 2,264 quotes. The number turns a finished screen into the next command.
   */
  "twin.corpusLeft":
    "Esto sale de {read} de {total} cita{totals} tuya{totals} guardada{totals}. Sin leer: {left}.",
  /*
    The front door, in the catalog. With the figure: it is the only Twin surface that really wears
    out, and it wears out many times in a row.
   */
  "twin.distillAll": "Leer el resto de mi historial · quedan {n} cita{s}",
  "twin.distilling": "Leyendo…",
  "twin.distillEstimate":
    "lo que lee esta pasada — citas: {verdicts} · tokens de entrada (aproximados): {tokens}",
  "twin.distillProgress": "leídas: {read} · observaciones guardadas: {saved} · quedan: {left}",
  "twin.distillNothing": "No queda historial por leer.",
  /*
    A pair and not a suffix. With one quote the sentence needs «la única cita guardada ya se ha
    leído»: the article, the participle and the verb all move, and `{totals}` only knew how to
    drop an «s» off «cita» — it printed «las 1 cita guardadas ya se han leído». The English half
    was no better with «all 1 stored quotes have been read».
   */
  "twin.corpusDoneOne": "Sale de tu historial entero: la única cita guardada ya se ha leído.",
  "twin.corpusDoneMany": "Sale de tu historial entero: las {total} citas guardadas ya se han leído.",
  /*
    The third answer. It is not 'yes' or 'no': it is 'yes, but here.' It includes the name of the
    project inside because without it the sentence does not indicate where the rule is, and the
    place is exactly what is being decided.
   */
  "twin.scopeOnly": "Solo en {project}",
  "twin.scopeAll": "Vale en todo lo que haces",
  "twin.scopedTag": "solo en {project}",
  /*
    The three badges. 'In formation' is not a warning: it is a belief that the evidence does not
    yet support, so it is seen here and does not go down to the file that agents read.
   */
  "twin.badgeSigned": "firmada por ti",
  "twin.badgeStanding": "en pie",
  "twin.badgeForming": "en formación",
  /* What's missing, because 'in training' without the rule next to it cannot be activated. */
  "twin.formingWhy": "le faltan pruebas: hacen falta tres, de dos días o de dos proyectos",
  /*
    The evidence, raw and always. It is what turns a belief into something that can be discussed,
    and what can be discussed can be thrown away.
   */
  "twin.support": "observaciones: {observations} · proyectos: {projects} · días: {days}",
  "twin.showCitations": "ver las citas: {n}",
  "twin.hideCitations": "ocultar las citas",
  /*
    The four gestures. None is mandatory, and that is why none says 'save' or 'accept': the
    portrait is already written, this is directing it.
   */
  "twin.sign": "Está bien dicha",
  "twin.edit": "Decirlo con mis palabras",
  "twin.editSave": "Guardar mi versión",
  "twin.editText": "Texto de la creencia",
  "twin.veto": "Eso no lo pienso",
  "twin.markedGestures": "cambios marcados: {n}",
  /* The subjects. What the classifier coins is not here and is taught as it is. */
  "twin.topicDesign": "Diseño",
  "twin.topicFrontend": "La interfaz por dentro",
  "twin.topicBackend": "El servidor y sus datos",
  "twin.topicCli": "La terminal",
  "twin.topicTesting": "Cómo se comprueba",
  "twin.topicCopy": "Las palabras",
  "twin.topicWorkflow": "Cómo trabajas con tus agentes",
  "twin.topicTooling": "Las herramientas",
  "twin.topicData": "Los datos",
  "twin.topicOther": "Lo demás",
  /*
    The only question of all Twin, and it is asked once. With the figure in front: a permit
    without the number next to it is a button to accept terms.
   */
  "twin.consentTitle": "Una sola pregunta",
  "twin.consentBody":
    "Hay creencias que la máquina ha deducido sola y que todavía no has mirado. Mientras no digas que sí, el fichero que leen tus agentes es exactamente lo que tú firmaste: nada que no hayas escrito habla en tu nombre.",
  /*
    «{chars} caracteres» cannot take a suffix —«carácter» moves its accent, which is why
    `patch.output` and `twin.fileRoom` are exempt in `plurals.test.ts`— so the figure goes to
    the end instead, which is the other half of the house rule and costs no second key.
   */
  "twin.consentCount": "esperando: {n} · caracteres que ocuparían en total: {chars}",
  "twin.consentOver":
    "con ellas el retrato no cabría en {cap} caracteres, así que habría que sacar algo",
  "twin.consentAllow": "Que bajen al fichero",
  "twin.consentRevoke": "Se retira borrando twin.json, sin abrir esto.",
  /* The only hitch left: the synthesis wanted to touch something you signed and didn't do it. */
  "twin.proposalsTitle": "Quiere cambiar algo que firmaste",
  "twin.proposalsNote":
    "Estas las escribiste tú, así que la máquina no las toca: dice cómo las diría ahora y espera.",
  /*
    How many it joins, when it joins more than one: it is what turns "change this" into "these
    three say the same thing." Without saying it, three crossed-out sentences seem like a rendering
    mistake.
   */
  "twin.proposalJoins": "junta estas: {n}",
  "twin.proposalAccept": "Que lo cambie",
  "twin.proposalReject": "Déjalo como está",
  /*
    The cemetery. It is not a trash can: what is inside is negative evidence, and that is why it
    is taught instead of disappearing — so that it can be seen that the veto is still doing
    something.
   */
  "twin.graveyardTitle": "Lo que dijiste que no eras",
  "twin.graveyardNote":
    "No se borra: se queda aquí para que la síntesis no lo vuelva a proponer con otras palabras.",
  "twin.save": "Guardar",
  "twin.saving": "Guardando…",
  "twin.cancel": "Descartar lo marcado",
  "twin.saveFailed": "No se pudo guardar: {detail}",
  /*
    The withdrawn is said separately from what is accepted and what is rejected because it is
    neither of the two: they are phrases that were inside and have fallen out when reconciling the
    file. To keep it quiet would be for them to disappear from the screen without anyone saying
    so.
   */
  "twin.fileTitle": "TASTE.md",
  "twin.fileSize": "{chars} de {cap} caracteres",
  "twin.fileHint":
    "Es el fichero que leen tus agentes, y la otra puerta para lo mismo: ábrelo y borra una línea, y esa frase sale del retrato la próxima vez que decidas algo aquí.",
  /*
    The limit cannot be increased just like that: each character is paid for in tokens in each
    session of each agent. That is why the file fails when it fills up instead of pruning itself —
    and that is why this screen has to say what is inside before someone crashes into it.
   */
  "twin.fileFull":
    "No cabe. Hasta que saques algo, lo que decidas se guarda en el catálogo pero no llega al fichero, y el fichero es lo único que leen tus agentes.",
  "twin.fileWritten": "escritas ahora mismo: {n}",
  "twin.fileRoom": "Queda sitio para {n} caracteres.",
  /*
    The distribution and not the name: the block of a project is the global PLUS its own, so just
    naming it would imply removing things from that project when what is bulky could be the shared
    part.
   */
  "twin.spendTitle": "Lo que ha costado hoy",
  "twin.spendLooks": "miradas: {used} de {cap}",
  "twin.spendTokens": "{input} tokens de entrada · {output} de salida",
  "twin.spendNone": "Hoy no se ha llamado a ningún modelo.",
  "twin.spendUnmetered": "{n} sin medir: ese proveedor no publica el consumo.",
  /*
    The other two classes from the expense book. They were missing, and that’s why the receipt
    stayed still for an entire afternoon dripping: only the look managed to write itself. The
    number at the end, as always in this family.
   */
  "twin.spendDistills": "destilaciones: {n}",
  "twin.spendClassify": "repartos por materia: {n}",
  "twin.spendSynth": "síntesis: {n}",
  /*
    The brake of the three organs that read, which is one for the three because they are a single
    chained work. The reason for the number is in `lib/reads.ts`.
   */
  /*
    A project's file shows which phrases of the portrait apply inside. The keys go in `twin.*` and
    not in `project.*` because they are from Twin: what they say comes from `TASTE.md` and changes
    when the portrait changes, not when the file changes.
   */
  /*
    The movement of the portrait by months, which is the question that beliefs alone cannot
    answer: they keep track of when each one was touched for the last time, not every time. The
    month comes first because it is the label of the line; the figures, at the end of theirs.
   */
  /*
    Read the history from the screen. The permission is by source, so the output when it is
    missing is not to retry: it is to go grant it.
   */
  /*
    The first gesture of all: what stories exist and which ones can be opened. It is measured with
    `stat`, without opening a single file, and that is why the figure can go ahead of the
    permission.
   */
  "twin.sourcesTitle": "Tus historias con tus agentes",
  "twin.sourcesLead":
    "Panoma las mide sin abrirlas. Nada se lee hasta que digas que sí, y el sí es de una en una: leer Claude Code no es leer Codex.",
  "twin.sourcesNone":
    "En este disco no hay ninguna historia de agente que Panoma sepa medir.",
  "twin.sourceSize": "ficheros: {files} · {size}",
  "twin.sourceGone": "ya no está en este disco",
  "twin.sourceAllow": "Dejar que la lea",
  "twin.sourceRevoke": "Dejar de leerla",
  "twin.sourceNoReader": "todavía no sabemos leerla",
  "twin.sourcesRevokeNote":
    "Dejar de leerla cierra la puerta y no borra lo que ya entró: eso lo hace {cli} twin forget.",
  "twin.consentMalformed": "Falta decir qué fuente y si se permite.",
  "twin.consentUnknown": "Esa fuente no existe en este disco: {source}",
  "twin.mineNoConsent":
    "Ninguna de tus historias tiene permiso, así que no se ha abierto ni un fichero. Dilo aquí abajo, en tus historias.",
  "twin.mineNoReadable":
    "Las historias de este disco todavía no se saben leer, así que no hay permiso que valga: no se ha abierto ni un fichero.",
  "twin.mineNoHistories":
    "En este disco no hay ninguna historia de agente que leer, así que no se ha abierto ni un fichero.",
  "twin.mineButton": "Buscar lo nuevo en mi historial",
  "twin.mineButtonLeft": "Leer mi historial · quedan {n}",
  "twin.mining": "Leyendo tus historias…",
  "twin.mined": "citas nuevas: {saved} · ya estaban: {duplicates}",
  "twin.minedNone": "No hay nada nuevo en tus historias desde la última vez.",
  "twin.churnTitle": "Cómo se ha movido tu retrato",
  "twin.churnMonth": "{month} — nuevas: {created} · afinadas: {refined} · retiradas: {retired}",
  "twin.churnStill": "Este mes no se ha movido: lo que hay ya está dicho.",
  "twin.churnOnlyRefined":
    "Este mes solo se ha reescrito lo que ya había: nada nuevo y nada retirado.",
  "twin.projectQuestion": "¿Con qué se mide lo que se entrega aquí?",
  "twin.projectTitle": "Lo que tus agentes leen aquí",
  "twin.projectLead":
    "Baja por AGENTS.md a cada sesión que abras en esta carpeta. Lo global va en todos tus proyectos; lo demás vale solo aquí.",
  /*
    And if this project does not have a Panoma block in its AGENTS.md, the portrait does not
    download anywhere: promising it would be like mentioning a channel that does not exist.
   */
  "twin.projectLeadUnmanaged":
    "Lo global vale en todos tus proyectos; lo demás, solo aquí. Todavía no baja a tus agentes: este proyecto no tiene el bloque de Panoma en su AGENTS.md.",
  "twin.projectCount": "frases que rigen aquí: {n}",
  "twin.projectOnly": "solo de este proyecto: {n}",
  "twin.projectOnlyHere": "solo aquí",
  "twin.projectNone": "Todavía no hay retrato, así que aquí no se mide nada.",
  "twin.projectNoneHere": "Tu retrato no dice nada que rija en este proyecto.",
  "twin.projectForming": "en formación sobre este proyecto: {n}",
  "twin.projectOpen": "Abrir tu gemelo",
  "twin.spendReads": "lecturas: {used} de {cap}",
  "twin.readsSpent":
    "Las lecturas de hoy están gastadas: {used} de {cap}. Vuelven mañana, o sube el tope con PANOMA_READ_BUDGET.",
  /*
    Synthesize from the screen. Distribute by subjects what does not have it and then write the
    portrait: two calls and a single gesture, because for whoever presses it, it is 'catch up'.
   */
  "twin.synthesize": "Rehacer el retrato",
  "twin.synthesizing": "Escribiendo…",
  "twin.synthHint": "Lee toda tu evidencia y reescribe lo que la máquina cree de ti.",
  "twin.synthDone": "nuevas: {created} · afinadas: {refined} · retiradas: {retired}.",
  "twin.synthAsks": "Y te pregunta por creencias que firmaste: {n}.",
  "twin.synthSame": "Nada ha cambiado: la evidencia dice lo mismo que la última vez.",
  /*
    The two silences, with the same letter as the terminal. Confusing them sends to distill
    someone who already has everything distilled.
   */
  "twin.synthNothing":
    "Todavía no hay evidencia que sintetizar. Lee tu historial aquí arriba: de ahí salen las observaciones de las que sale el retrato.",
  "twin.synthUpToDate": "El retrato ya está al día: no ha entrado evidencia nueva.",
  "twin.synthFailed": "No se pudo escribir el retrato.",
  "twin.citedIn": "en {project}",
  /*
    In amber and whole: saying yes to a merge erases phrases you have already approved, and that
    is the only answer on this screen that destroys something.
   */

  /*
    The Twin marker, which comes out through `/api/twin/score`: how many times it has to be
    corrected. There are four sentences because there are four answers, and two of them do not
    congratulate anyone — `EL-DOBLE.md` asks to be able to see this metric "on its page," that is,
    also the months when it goes wrong. A screen that only knows how to say that everything is
    fine measures nothing.
   */
  "score.tooFew":
    "Te ha dicho {shown}. Hacen falta {floor} para que un porcentaje signifique algo: por debajo, una sola corrección lo mueve más de cinco puntos y hablaría de la última creencia que miraste, no de tu gusto.",
  "score.noTrend":
    "El {rate} % es cómo está hoy, no si mejora: ninguno de los dos meses ya juzgados llega a {floor} creencias, así que la comparación mes a mes todavía no se puede hacer. El mes en curso no entra: sus creencias no se han terminado de mirar.",
  "score.better":
    "De lo que te dijo el mes pasado has corregido el {recent} %, y de lo del anterior el {previous} %: baja, que es lo único que quiere decir que el doble está aprendiendo.",
  "score.notBetter":
    "De lo que te dijo el mes pasado has corregido el {recent} %, y de lo del anterior el {previous} %: no baja. Mientras no baje mes a mes, el doble no está aprendiendo, y este marcador no va a decir otra cosa.",

  /* The section to connect agents, in 'Agents'. */
  /*
    It says «MCP» in the title and in the first line on purpose. The page's introduction already
    mentioned it, but it is three paragraphs above, and whoever comes looking for how to set up
    the MCP doesn't read the page: they search for the word. That the place where the buttons are
    didn't have it was asking them to guess that 'connect an agent' is this.
   */
  "connect.title": "Conectar un agente por MCP",
  "connect.lead":
    "MCP es el canal por el que un agente habla con tu catálogo. Estos son los que hay en esta máquina: conectar uno le da las nueve herramientas —el resumen del proyecto al empezar, la bitácora y la cola de tareas— y escribe su configuración donde ese agente la lee.",
  "connect.do": "Conectar",
  "connect.again": "Volver a conectar",
  "connect.alreadyOn": "conectado",
  /*
    «Connected» was said of an agent that had never once called. The badge read a row in `agents`
    —a key was issued— and printed the word for a connection, while the bridge, two clicks away,
    counted `last_seen_at` and answered zero. Two screens, one fact, and the one that overstated
    was the one you land on.
    So the key that exists gets its own word, and the green one is kept for an agent that has
    actually been in. And because a state nobody can act on is worse than no state, the step comes
    with it: an already-open session picks up nothing, which is the whole reason it never entered.
   */
  "connect.keyIssued": "clave emitida",
  "connect.neverUsed": "La clave está escrita, pero {name} no la ha usado todavía. Reinicia su sesión: una que ya estaba abierta no recoge nada.",
  "connect.ephemeral": "Esta copia corre desde npx y se va al acabar la orden. La configuración apuntaría a su caché, y el día que se limpie {name} arrancaría sin las herramientas y sin decirlo.",
  /*
    Two commands, because installing is not the half that unblocks this.

    It said «install it and try again», and whoever did exactly that watched the screen not change
    and had nothing to read. This page is served by a process that was started from npx, and a
    running process does not inherit an install that happened after it: the notice would have stayed
    there through any number of refreshes. The reader did what they were told and the product went
    on asking for it.

    The terminal's version of this refusal is right to say «try again», because there the next
    invocation IS the newly installed one. Here the thing that has to be restarted is the catalog,
    so here it is named.
   */
  "connect.ephemeralHow": "Instálalo y reinicia el catálogo: esta pantalla la sirve la copia de npx, y un servidor ya en marcha no hereda lo que instales después.",
  /*
    How much it costs to press it again, said before and not after.
    Reconnecting keeps the card and its history, but **emits another key**. Where Panoma writes
    the file it is not noticeable, because it overwrites it with the new one. Where the block was
    pasted manually, the old copy ceases to be valid without giving any error: the agent stops
    entering and there is nothing to check. That is why the gesture that fixes it is named.
   */
  "connect.againCost":
    "Ya está conectado. Volver a conectarlo emite una clave nueva: donde panoma escribe el fichero se actualiza sola, pero si pegaste el bloque a mano en algún sitio, esa copia dejará de funcionar y habrá que volver a pegarla.",
  "connect.working": "Conectando…",
  "connect.written": "Configuración MCP escrita.",
  "connect.updated": "Se ha actualizado la entrada de panoma que ya había.",
  "connect.coexists": "Siguen ahí: {list}.",
  /*
    The notice of the plaintext key inside a repository.
    This is not a manual warning: that file has `PANOMA_KEY`, which opens the report, the log, and
    the tasks of the eighty projects, and it is in a folder that is uploaded entirely with a
    `git add .`. Panoma does not touch anyone's `.gitignore` — it is that person's repository — so
    it says so at the only moment when it is looking: right after writing it. It also gives the
    exact order, because a warning without what to do only produces unease.
   */
  "connect.gitWarning":
    "Ojo: este fichero lleva la clave del agente en claro y git se lo llevaría. Añade su nombre al .gitignore antes de commitear.",
  "connect.restart": "Reinicia {name} para que la lea.",
  "connect.pasteInto": "Este agente guarda sus servidores MCP en un formato que no vamos a tocar. Pega esto en:",
  "connect.pasteSomewhere": "No sabemos dónde guarda este agente sus servidores MCP. Pega esto donde los tenga:",
  "connect.copy": "Copiar la configuración MCP",
  "connect.openFile": "Abrir el fichero",
  "connect.opened": "Abierto en {editor}. Pega el bloque, guarda, y reinicia {name}.",
  "connect.copied": "copiado",
  "disconnect.do": "desconectar",
  "disconnect.confirm": "Sí, desconectar",
  "disconnect.working": "Quitando…",
  /*
    The account comes first because it is the only thing needed to respond: the log of that agent
    hangs from its record and travels with it.
   */
  "disconnect.losing": "Se irá también lo que {name} anotó aquí: {n} entrada{s}.",
  "disconnect.nothingLost": "{name} no ha anotado nada todavía.",
  "md.noBlock": "No hay bloque de Panoma en este proyecto; créalo primero.",
  "md.notInherited": "Ese fichero no es un heredado de este proyecto.",
  "md.fileGone": "El fichero ya no está donde estaba.",
  "md.noFiles": "Este proyecto no tiene AGENTS.md ni CLAUDE.md.",
  "md.inspectLocalOnly": "El repaso lee tu disco: solo funciona con el catálogo local.",
  "md.repairLocalOnly": "Reparar escribe en tu disco: solo funciona con el catálogo local.",

  /*
    Proposals. The 'there is already one underway' council directed to /executions, which ceased
    to exist when the routes switched to English: it was a 404 at the end of an error message.
   */
  "runs.notFound": "Ejecución no encontrada.",
  "runs.noBranch": "Esta ejecución no dejó ninguna rama que aplicar.",
  "runs.alreadyRunning": "Ya hay una ejecución en marcha en {name}.",
  "runs.alreadyRunningHint": "Espera a que termine, o míralo en Actividad.",
  "runs.missingPackage": "Falta el nombre del paquete.",
  "runs.noFixForPackage": "{package} no tiene ningún aviso con versión corregida en {name}.",
  "runs.noFixes": "{name} no tiene vulnerabilidades con arreglo publicado.",
  "runs.enrichAdvisories": "Ejecuta '{cli} enrich' para refrescar los avisos de OSV.",
  "runs.notADependency":
    "{package} no está entre las dependencias de {name}, o no sé cuál es su última versión.",
  "runs.enrichVersions": "Ejecuta '{cli} enrich' para traer las versiones de los registros.",
  "runs.unsupportedEcosystem": "Todavía no sé actualizar dependencias de {ecosystem}.",
  "runs.knownFailureHint": "Vuelve a intentarlo con --force si crees que algo ha cambiado.",
  "runs.quarantined":
    "{package} {version} se publicó hace {age} y la cuarentena de Panoma son {days} días.",
  "runs.quarantinedHint":
    "Una versión recién publicada es donde aparecen los compromisos de cadena de suministro, y casi siempre se retiran en el primer día o dos. Vuelve a intentarlo más adelante, o ahora mismo con --force si sabes lo que haces. El umbral se cambia con PANOMA_CUARENTENA_DIAS.",
  "runs.crashed": "La ejecución se rompió: {detail}",

  /*
    The north of the project: what is 'finished' here. It is written by the person and is not
    deduced from anything, so the errors of this path speak about the phrase and not about the
    catalog.
   */
  "north.missing": "Falta la frase: escribe qué sería tener este proyecto terminado.",
  "north.tooLong":
    "Son {n} caracteres y el norte es una línea: cabe hasta {max}. Lo largo es un plan, y para eso está el encargo de plan.",
  "north.noIdentity":
    "Este proyecto todavía no tiene una identidad estable, así que no hay dónde guardar la frase para que sobreviva a mover la carpeta. Vuelve a escanearlo y prueba otra vez.",

  /*
    The fact that it chose every director action. They arrive neutral from
    `next-moves.ts` —code and number— and the sentence is written here, as with the work risks
    without saving. They are fragments in lowercase: they are read behind the name of the task.
   */
  "move.noNorth": "nadie ha escrito todavía qué es «terminado» aquí",
  "move.unsavedWork": "{n} aviso de trabajo sin guardar",
  "move.unsavedWork.n": "{n} aviso{s} de trabajo sin guardar",
  "move.noReadme": "no hay ningún README que lo explique",
  "move.neverBuilt": "nadie ha comprobado nunca si todavía compila",
  /*
    What the mechanical critic sees. The name does not say 'findings' on purpose: whoever reads
    the report in the morning does not need to know that there is an organ called that.
   */
  "move.critiques": "{n} cosa a la vista sin abrir el proyecto",
  "move.critiques.n": "{n} cosa{s} a la vista sin abrir el proyecto",
  "move.idle": "{n} mes parado",
  "move.idle.n": "{n} mes{es} parado",
  "move.advisories": "{n} aviso de seguridad abierto",
  "move.advisories.n": "{n} aviso{s} de seguridad abierto{s}",
  "move.outdated": "{n} dependencia directa atrasada",
  "move.outdated.n": "{n} dependencia{s} directa{s} atrasada{s}",
  "move.lowHealth": "salud {n} de 100",
  "move.longIdle": "{n} mes{es} parado: la pregunta ya no es de mantenimiento",
} satisfies Record<string, string>;

/** Every new key is first used in `es`; this type forces `en` to keep pace. */
export type MessageKey = keyof typeof es;

/*
  English does not translate word for word: it names things as a native product would. 'Espacio'
  is 'Disk', not 'Space'; 'Apartados' is 'Hidden', not 'Set aside'. If a translation from here
  sounds like a dictionary, it is wrong even if it is correct.
 */
const en = {
  "watch.off":
    "The watcher isn’t running: new projects and today’s commits may not show up until you scan again.",

  "catalog.down.title": "The catalog will not open",
  "catalog.down.body":
    "The app is still up, but with no data. Rename {path} to something else and start again: a fresh one is created, and «{cli} scan» fills it. Delete nothing — if it can ever be rescued, it will be rescued from there.",
  "catalog.down.detail": "What the database said: {detail}",

  "error.title": "Something broke while rendering this page",
  "error.body":
    "Not the catalog — that gets its own notice. Try again, and if it keeps happening, the reason is in the server log.",
  "error.retry": "Try again",

  "meta.description":
    "Your personal software catalog. Open, review, and keep every project current.",

  "shell.brandHome": "Panoma · Home",
  "shell.searchPlaceholder": "Search projects, technologies, or agents",
  "shell.openPalette": "Open the command palette",
  "shell.topNav": "Main navigation",
  "shell.sections": "Panoma sections",
  "shell.skipToContent": "Skip to content",
  "shell.localAccount": "Local account",
  "shell.accountNone":
    "There’s no account or cloud to manage: panoma runs on this computer and the catalog stays here.",
  "shell.ephemeral": "This copy is temporary",
  "shell.ephemeralDetail":
    "You started it with npx, which keeps it for one command and lets it go. The catalog stays; the command does not. To keep it: npm i -g panoma — then restart the catalog, or this screen will go on writing «npx panoma» into every command it hands you.",
  "shell.pending": "{n} pending",
  "shell.setupLeft": "{n} step{s} left to switch on",
  "shell.summary": "Catalog summary",
  "shell.summaryProjects": "{n} project{s}",
  "shell.summaryScope": "in your catalog",
  "shell.live": "live",
  "shell.paused": "paused",
  "shell.dormant": "dormant",
  "shell.noGit": "no git",
  "shell.copies": "copies",
  "shell.hidden": "hidden",
  "shell.footerLocal": "Local catalog",
  "shell.footerPrivate": "Private by design",
  "shell.footerSource": "AGPL-3.0 · source code",
  "shell.language": "Language",
  "shell.hideSidebar": "Collapse menu",
  "shell.showSidebar": "Expand menu",

  "nav.projects": "Projects",
  "nav.unsaved": "Unbacked",
  "nav.searchCode": "Code",
  "nav.credentials": "Keys",
  "nav.agents": "MCP",
  "nav.ai": "AI",
  "nav.packages": "Packages",
  "nav.activity": "Runs",
  "nav.copies": "Copies",
  "nav.bridge": "Bridge",
  "dest.bridge": "The bridge",
  "bridge.title": "Power panoma on, step by step",
  "bridge.titleReady": "Everything is on",
  /*
    The lead says what is at stake and not only what the screen is.
    This page is the answer to «why isn't this doing anything», and it was written as a tour: every
    piece with its state. Whoever had not yet realised there was something to switch on read that
    as a dashboard and left. The first sentence now names the stake, because the reader who most
    needs this screen is exactly the one who does not know they need it.
   */
  "bridge.lead": "Panoma is not whole until these steps are done: until then there are pieces that simply do not work. Each one with its state and a single next step marked — no guessing commands: what to do now carries an arrow, and the rest waits its turn.",
  "bridge.leadReady": "Catalog, model, agents and hooks are running. From here you just watch the memory breathe — and decide on what agents propose, project by project.",
  "bridge.step.catalog.title": "The catalog",
  "bridge.step.catalog.detail": "projects: {count}",
  "bridge.step.catalog.pending": "Scan a folder with your projects. One command analyzes them and starts this web app.",
  "bridge.step.model.title": "An AI model",
  "bridge.step.model.detail": "connected: {count}",
  "bridge.step.model.pending": "The critic, the distiller and the double need a model. Connect a provider or export a key.",
  "bridge.step.model.go": "Go to the AI screen",
  "bridge.step.agent.title": "A connected agent",
  "bridge.step.agent.detail": "active: {count}",
  "bridge.step.agent.pending": "Connect your agent (Claude Code, Cursor…) so it receives the brief, the memory and the nine tools.",
  "bridge.step.agent.keyUnused": "The key exists but no agent has ever used it: install the config and restart the agent's session.",
  "bridge.step.agent.go": "Go to the Agents screen",
  "bridge.step.hooks.title": "The hooks",
  /*
    «of {total}» is the ones that can carry a hook, not the whole catalog. A folder without git has
    nowhere to keep one, and counting it invented a debt that could never be paid: 44 of 76, with
    the hook in all 44 that had git, read as unfinished for ever.
   */
  "bridge.step.hooks.detail": "hooked: {count} of {total} that can take one",
  "bridge.step.hooks.pending": "Inside each project you work on: they record activity without the model having to remember, and deliver sleeping notes on their paths.",
  "bridge.step.alive.title": "The memory, alive",
  "bridge.step.alive.detail": "journal entries: {count}",
  /*
    The journal, which is the one thing on this page nobody here can press.

    It fills when an agent working in a project calls `panoma_log` — and it said «it turns on by
    itself once the rest is running», which is true and tells the reader nothing they can act on.
    Somebody with all four of their own parts done, reading that, is looking for the button. There
    is no button. So the tool is named, and what makes an agent reach for it.
   */
  "bridge.step.alive.pending": "This one is not yours: an agent fills it. When it finishes something that stands on its own in one of your projects it calls the {tool} tool, and the first entry lands here — ask it to, if it does not on its own. From there the distiller proposes and you decide.",
  "bridge.restartHint": "After installing, restart the agent's session: an already-open session picks up nothing.",
  "bridge.todayTitle": "Today's numbers",
  "bridge.stat.journal": "Journal",
  "bridge.stat.approved": "Notes served",
  "bridge.stat.sleeping": "Sleeping notes",
  "bridge.stat.pending": "Proposals waiting",
  "bridge.stat.consultations": "Questions to the double",
  "bridge.stat.watcher": "Watcher",
  "bridge.stat.ablation": "Scale (ablation)",
  "bridge.on": "on",
  "bridge.off": "off",
  "bridge.copy": "copy",
  "bridge.copied": "copied",
  "bridge.step.hooks.install": "Install in every project",
  "bridge.step.hooks.installing": "Installing the hooks…",
  "bridge.hooksDone": "Done — hooked: {installed} · no repository: {noRepo} · foreign left alone: {foreign} · failures: {failed}",
  "bridge.hooksAlt": "Or from the terminal, project by project:",
  "bridge.hooksNoCli": "The server cannot find the panoma command: install from the terminal with the command shown.",
  "projectHooks.on": "Hooks installed: this project's journal writes itself.",
  "projectHooks.off": "No hooks: the catalog only learns what the agent remembers to tell it.",
  "projectHooks.install": "Install them",
  "bridge.scaleHint": "The fine measure — whether memory actually reduces corrections — lives in GET /api/scale.",
  "nav.disk": "Disk",
  "nav.twin": "Twin",
  "nav.hidden": "Hidden",

  "dest.agents": "MCP: connect your agents",
  "dest.unsaved": "Unbacked work",
  "dest.disk": "Disk space",
  "dest.twin": "Your twin: the portrait of your taste",
  "dest.searchCode": "Search the code",
  "dest.credentials": "Credentials in git history",
  "dest.hidden": "Hidden & excluded",
  "dest.ai": "What Panoma thinks with",

  "palette.aria": "Command palette",
  "palette.placeholder": "Find a project or type an action…",
  "palette.searchAria": "Search the catalog",
  "palette.loading": "loading the catalog…",
  "palette.noMatch": "Nothing matches “{query}”.",
  "palette.results": "{n} result{s}",
  "palette.groupProjects": "Projects",
  "palette.groupActions": "Actions",
  "palette.groupGoTo": "Go to",
  "palette.openFolderOf": "Open {name}’s folder",
  "palette.searchEverywhere": "Search every project’s code for “{query}”",
  "palette.opening": "opening {name}…",
  "palette.openFailed": "Couldn’t open it.",
  "palette.unreachable": "Couldn’t reach the server.",
  "palette.enterEditor": "↵ open in the editor",
  "palette.enterCard": "↵ open the project page",
  "palette.openTerminalOf": "Open a terminal in {name}",
  "palette.openCardOf": "Open {name}’s project page",
  "palette.keysMove": "↑↓ move",
  "palette.keysOpen": "↵ choose",
  "palette.keysClose": "esc close",

  "home.emptyKicker": "Empty catalog",
  "home.emptyTitle": "Nothing scanned yet",
  "home.emptyBody":
    "Scan a folder of projects to fill the catalog. Scanning runs locally and stores metadata only: your code never leaves this disk.",

  // Risks of working without saving. See the equivalent block in Spanish.
  "activityKind.change": "change",
  "activityKind.decision": "decision",
  "activityKind.note": "note",
  "activityKind.blocker": "blocker",
  "taskState.open": "open",
  "taskState.in-progress": "in progress",
  "taskState.done": "done",
  "taskState.discarded": "discarded",
  "severity.critical": "critical",
  "severity.high": "high",
  "severity.medium": "medium",
  "severity.low": "low",
  "severity.unknown": "unknown",
  "run.pending": "pending",
  "run.running": "running",
  "run.proposed": "proposed",
  "run.failed": "failed",
  "run.no-changes": "no changes",
  "run.applied": "applied",
  "run.discarded": "discarded",
  "risk.unversioned": "not under version control",
  "risk.no-commits": "repository with no commits at all",
  "risk.no-commits.n": "{n} file{s} and not a single commit",
  "risk.no-remote": "no remote · {n} commit only on this disk",
  "risk.no-remote.n": "no remote · {n} commit{s} only on this disk",
  "risk.unpushed": "{n} commit not pushed",
  "risk.unpushed.n": "{n} commit{s} not pushed",
  "risk.uncommitted": "{n} file not committed",
  "risk.uncommitted.n": "{n} file{s} not committed",
  "risk.untracked": "{n} not added to git",
  "risk.stashes": "{n} stash saved",
  "risk.stashes.n": "{n} stash{es} saved",
  "risk.behind": "{n} commit to pull",
  "risk.behind.n": "{n} commit{s} to pull",

  "store.kicker": "Explore",
  "store.title": "Discover what you’ve built",
  "store.subtitle": "Your personal software catalog. Open, review, and keep every project current.",
  "store.spotlight": "Highlights",
  "store.review": "Review",
  "filter.all": "All",
  "filter.attention": "Attention",
  "filter.favorites": "Favorites",
  "filter.notMine": "Not mine",
  "filter.web": "Web",
  "filter.mobile": "Mobile",
  "filter.backend": "Backend",
  "filter.tools": "Tools",
  "filter.ai": "AI",
  "filter.other": "Other",
  "store.filterAria": "Filter projects",
  "store.hideNames": "Hide names and icons",
  "store.showNames": "Show names and icons again",
  "store.hidden": "Project {n}",

  "share.abrir": "Share my panorama",
  "share.cerrar": "Close",
  "share.preview": "Preview of the card",
  "share.titulo": "{n} project{s} built.",
  "share.proyectos": "projects in total",
  "share.tecnologias": "technologies",
  "share.commits": "commits",
  "share.agentes": "of history with agents",
  "share.activos": "still moving",
  "share.salud": "Health of each project",
  "share.saludBien": "Healthy",
  "share.saludRevisar": "Review",
  "share.saludAtencion": "Attention",
  "share.more": "+{n} more",
  "share.local": "Local-first · Your data, on your disk.",
  "share.idioma": "Image language",
  "share.usuario": "your handle",
  "share.usuarioVacio": "left out",
  "share.conIconos": "Include my projects’ icons and names",
  "share.descargar": "download the image",
  "share.copiarTexto": "copy the text",
  "share.textoCopiado": "copied",
  "share.image.idle": "share image",
  "share.image.preparing": "preparing image…",
  "share.image.copied": "image copied",
  "share.image.downloaded": "image downloaded",
  "share.image.failed": "couldn’t share image",
  "share.x.idle": "open directly on X",
  "share.x.preparing": "opening X…",
  "share.x.copied": "X opened · paste the image",
  "share.x.downloaded": "X opened · upload the image",
  "share.x.failed": "couldn’t open X",
  "share.nota":
    "Share image opens the system menu. X opens the composer directly and copies the PNG for you to paste; Panoma uploads nothing.",
  "share.texto":
    "{n} project{s} built — my local control center with {domain}.",

  "store.sortLabel": "Sort projects",
  "store.sortRecent": "Most recent",
  "store.sortName": "Name",
  "store.sortHealth": "Healthiest",
  "store.viewAria": "Catalog view",
  "store.viewGrid": "Grid view",
  "store.viewList": "List view",
  "store.browseTitle": "Browse projects",
  "store.total": "{n} project{s} in total",
  "store.noResults": "No projects found",
  "store.noResultsBody": "Try another search or switch the selected filter.",
  "store.clearFilters": "Clear filters",
  "store.justHidden": "“{name}” is out of the catalog.",
  "store.undoHide": "undo",
  "store.seeHidden": "see hidden",
  "store.showing": "Showing {shown} of {total} project{totals}",

  "store.lastCommit": "Last commit {when}",
  "store.workedOn": "You worked on this project {when}.",
  "store.openProject": "Open project",
  "store.proposalsWaitingOne": "1 proposal to decide on",
  "store.proposalsWaitingMany": "{n} proposals to decide on",
  "store.proposalsBody": "The change is made and tested. Nothing gets applied until you say so.",
  "store.resume": "Pick up where you left off",
  "store.editorShort": "editor",
  "store.openingEditor": "opening…",
  "store.openedEditor": "✓ opened",
  "store.openNamedInEditor": "open {name} in the editor",
  "store.unreachable": "Couldn’t reach the server.",
  "store.attention": "Needs attention",
  "store.attentionBody": "Projects that need your review.",
  "store.viewAll": "View all",
  "store.allClear": "Everything is up to date.",
  "store.viewAllIssues": "See all {n} project{s} with issues",

  "store.depsBehind": "{n} outdated deps",
  "store.depsBehindRatio": "{n}/{total} outdated dep{s}",
  "store.depsUnchecked": "dependencies not checked",
  "summary.kind.mobileApp": "Mobile app",
  "summary.kind.webApp": "Web app",
  "summary.kind.cli": "Command-line tool",
  "summary.kind.package": "Publishable package",
  "summary.kind.backend": "Backend service",
  "summary.kind.container": "Containerized service",
  "summary.kind.project": "Project",
  "summary.builtWith": "{kind} in {stack}",
  "summary.uses": "uses {list}",
  "summary.publishedOn": "published on {list}",
  "summary.writtenBy": "{share}% of the history written by {agent}",
  "summary.and": "and",
  "store.noticeOne": "1 advisory",
  "store.noticesMany": "{n} advisorie{s}",
  "store.commitCount": "{n} commit{s}",
  "store.noAlerts": "No alerts",
  "store.open": "Open",
  "store.openNamed": "Open {name}",
  "store.favoriteAdd": "Add {name} to favorites",
  "store.favoriteRemove": "Remove {name} from favorites",
  "store.hideNamed": "Hide {name}",
  "store.noStack": "No stack detected",
  "store.builtWith": "A local project built with {tech}.",
  "store.detected": "A local project found in your catalog.",

  "catalog.title": "Project catalog",
  "catalog.count": "{n} project{s}",
  "catalog.countOne": "1 project",
  "catalog.filterPlaceholder": "Filter the catalog",
  "catalog.category": "Category",
  "catalog.colProject": "Project",
  "catalog.colHealth": "Health",
  "catalog.colStack": "Stack",
  "catalog.colActivity": "Last activity",
  "catalog.rowsAria": "Catalog projects",
  "catalog.hint": "One click shows the details. Two open the project.",
  "catalog.openHandle": "Open {name}’s page — or double-click",
  "catalog.opening": "Opening the project…",
  "catalog.healthOf": "Health {n} out of 100",
  "catalog.noHealth": "Not measured",
  "catalog.detailsOf": "Details for {name}",
  "catalog.close": "Close the details",
  "catalog.repository": "Repository",
  "catalog.remote": "Has a remote copy",
  "catalog.localOnly": "Only on this disk",
  "catalog.noGit": "No git",
  "catalog.size": "Size",
  "catalog.commits": "Commits",
  "catalog.origin": "Origin",
  "catalog.openIn": "Open in",
  "catalog.editor": "Editor",
  "catalog.editorSub": "Edit the code",
  "catalog.terminal": "Terminal",
  "catalog.terminalSub": "A terminal in this folder",
  "catalog.folder": "Folder",
  "catalog.folderSub": "Browse the files",
  "catalog.fullDetail": "Open the full project page",
  "catalog.emptyTitle": "No project selected",
  "catalog.emptyBody": "Pick one from the list and its details show up here.",
  "catalog.needsReview": "Needs review",
  "catalog.agentSub": "Agent, in a terminal",
  "catalog.appSub": "Desktop app",
  "catalog.agentBroken": "Installed, but it does not run",
  "catalog.reviewUnsaved": "See what is unsaved",
  "catalog.reviewSecurity": "See the security advisories",
  "catalog.reviewDeps": "See the outdated dependencies",

  "state.active": "Active",
  "state.paused": "Paused",
  "state.dormant": "Dormant",
  "state.no-git": "No git",
  "origin.foreign": "not yours",
  "origin.forked": "forked",
  "origin.template": "template",
  "origin.templateTitle": "A tool generated it, and it hasn’t been touched since.",
  "origin.startedBy": "Started by {name}. Open the project page to see where it comes from.",
  "origin.openDetail": "Open the project page to see where it comes from.",

  "today.title": "Since you last looked",
  "today.since": "since {when}",
  "today.last24h": "in the last 24 hours",
  "today.nothing": "Nothing new {period}. The day is yours.",
  "today.commitOne": "{n} commit",
  "today.commitMany": "{n} commit{s}",
  "today.fromAgents": "({n} from agents)",
  "today.inProject": "in {project}",
  "today.agentNoted": "{name} logged {n}",
  "today.born": "New in the catalog:",
  "today.resume": "Resume",
  "today.opening": "Opening…",
  "today.openFailed": "Didn’t work",
  "today.openNamed": "Open {name} in the editor",
  "today.waitingOne": "1 waiting on you",
  "today.waitingMany": "{n} waiting on you",
  "today.inProjectsOne": "{c} in 1 project",
  "today.inProjectsMany": "{c} in {n} project{s}",
  "today.bornOne": "1 new project",
  "today.bornMany": "{n} new project{s}",
  "today.expand": "Show the daily brief",
  "today.collapse": "Collapse the daily brief",
  "today.quiet": "Nothing new",
  "today.attempts": "{n} attempt{s}",

  "proposals.waiting": "Waiting on you",
  "proposals.readyOne": "One proposal is ready and undecided",
  "proposals.readyMany": "{n} proposals are ready and undecided",
  "proposals.branchNote":
    "The change is made and tested on a branch of its own. Nothing touches your folder until you say so.",
  "proposals.fallbackName": "proposal",
  "proposals.andMore": "{n} more",
  "proposals.testsGreen": "tests passing",
  "proposals.unverified": "unverified",

  "changes.question": "What happened here",
  "changes.latest": "Last thing, {when}",
  "changes.nothingYet": "Nothing has happened yet",
  "changes.totalCommits": "{n} commit{s} in total",
  "changes.window24h": "In the last 24 hours",
  "changes.window48h": "The day before",
  "changes.windowBefore": "Before that",
  "changes.signedBy": "Signed by {agent} with a Co-Authored-By trailer",
  "changes.unsignedNote":
    "Commits with no tag carry nobody’s signature. That doesn’t mean you wrote them.",
  "changes.moreOne": "There’s 1 more among the twenty the catalog keeps.",
  "changes.moreMany": "There are {n} more among the twenty the catalog keeps.",
  "changes.empty": "No recent commits to show yet.",
  "changes.agentLog": "See agent activity",

  "task.title": "Jot it down",
  "task.openOne": "{n} open",
  "task.openMany": "{n} open",
  "task.placeholder": "tomorrow, fix the login",
  "task.fieldLabel": "What needs doing in this project",
  "task.save": "jot it",
  "task.saving": "jotting…",
  "task.mcpNote":
    "Panoma doesn’t manage tasks, it keeps them. Your agent reads them over MCP when it enters the project, picks them up, and closes them itself.",
  "task.saveFailed": "Couldn’t jot that down.",
  "task.byHuman": "you",
  "task.unreachable": "Couldn’t reach the catalog.",

  "assignment.question": "What do we do with this?",
  "assignment.title": "Hand it to your agent",
  "assignment.note":
    "Panoma writes the assignment from what it knows about the project. Open it in your terminal and your agent starts now, on this machine; add it to the queue and nothing happens until it next enters the project; or copy it and take it anywhere.",
  "assignment.see": "see the assignment",
  "assignment.copy": "copy",
  "assignment.copied": "copied",
  "assignment.copyFailed": "Couldn’t copy. Open “see the assignment” and select it by hand.",
  "assignment.send": "add to the queue",
  "assignment.sending": "queueing…",
  "assignment.sendTitle":
    "It waits until your agent next enters this project. Nothing runs right now",
  "assignment.launch": "open in your terminal",
  "assignment.launching": "opening…",
  "assignment.launchTitle":
    "Opens a terminal on this machine with {agent} inside the project and the assignment loaded: it starts working as soon as it opens",
  "assignment.launched": "{agent} is working in your terminal.",
  "assignment.launchFailed": "Couldn’t open the terminal.",
  "assignment.queued": "in the queue",
  "assignment.queuedNote": "Queued. Your agent picks it up when it enters the project.",
  "assignment.withdraw": "take it back",
  "assignment.withdrawing": "taking it back…",
  "assignment.withdrawn": "Taken back. Your agent won’t see it.",
  "assignment.withdrawFailed": "Couldn’t take it back.",
  "assignment.failed": "Couldn’t add it to the queue.",
  "assignment.resume": "Tell me what it takes to pick it back up",
  "assignment.resume.promise":
    "Have it try to start the project, note every stumble, and say where the work left off.",
  "assignment.competitors": "Find its competitors",
  "assignment.competitors.promise":
    "Who solves the same thing today — alive or dead — and what gap is really left.",
  "assignment.plan": "Draft an improvement plan",
  "assignment.plan.promise":
    "What to touch first and why, crossing the code with what panoma already measures.",
  "assignment.presentable": "Get it fit to show",
  "assignment.presentable.promise":
    "An honest README, so an outsider gets it in two minutes.",
  "assignment.review": "Fix what shows without opening anything",
  "assignment.review.promise":
    "Stray colours and corners, images that don’t say what they show, broken links: what panoma saw by reading the folder.",
  "assignment.securityTitle": "Close the worst vulnerability",
  "assignment.securityPromise":
    "Panoma prepares the fix on a separate copy of the project and leaves the proposal waiting for you.",
  "assignment.depsTitle": "Bring its dependencies up to date",
  "assignment.depsPromiseOne": "{n} direct dependency behind — pick which, and panoma brings you a proposal.",
  "assignment.depsPromiseMany": "{n} direct dependencie{s} behind — pick which, and panoma brings you a proposal.",
  "assignment.depsChoose": "pick which",


  "sites.summaryOne": "{n} project, looking in {where}{extra}",
  "sites.summaryMany": "{n} project{s}, looking in {where}{extra}",
  "sites.andMore": "and {n} more",
  "sites.manage": "change",
  "sites.close": "close",
  "sites.countOne": "{n} project",
  "sites.countMany": "{n} project{s}",
  "sites.missing": "the folder is gone",
  "sites.remove": "remove",
  "sites.removeConfirm": "yes, remove it and its projects: {n}",
  "sites.removed": "No longer watched, and its projects are retired: {n}. Add it back and they return.",
  "sites.add": "add",
  "sites.adding": "searching…",
  "sites.addedOne": "Added. Found 1 project.",
  "sites.addedMany": "Added. Found {n} project{s}.",
  "sites.placeholder": "~/Documents",
  "sites.fieldLabel": "Folder you also want watched",
  "sites.note":
    "Panoma only finds projects inside these folders. One living outside will never show up, no matter how long you wait.",
  "sites.search": "search my disk",
  "sites.searching": "searching…",
  "sites.searchHint": "Walks your home folder and suggests where you have more projects.",
  "sites.searchNone": "Found no projects outside what's already watched.",
  "sites.failed": "Didn’t work.",

  "ai.title": "What Panoma thinks with",
  "ai.intro":
    "Panoma never calls a model on its own: only when you ask it to — describing a project, drafting an assignment. Here you pick which one.",
  "ai.loading": "reading the configuration…",
  "ai.loadingSlow": "still reading… the first time takes longer.",
  "ai.loadFailed": "Couldn’t read the AI configuration ({status}).",
  "ai.loadTimeout": "The configuration took too long to arrive.",
  "ai.retry": "retry",
  "ai.retrying": "retrying…",
  "ai.brokenTitle": "The configuration can’t be read",
  "ai.fileNote":
    "The configuration lives in {path}, with 0600 permissions. That stops another user of this machine from reading it, but it isn’t encrypted: any process running as you can open it. If you’d rather keep nothing on disk, export the key as an environment variable or use an agent you already have installed.",
  "ai.remote": "The catalog is remote: the model is configured on the machine that serves it.",
  "ai.activeTitle": "Active provider",
  "ai.none": "None yet. Pick one below.",
  "ai.defaultModel": "default model",
  "ai.modelLabel": "model",
  "ai.modelPlaceholder": "the provider’s default",
  "ai.modelSaved": "Now using {model}.",
  "ai.modelCleared": "Back to the provider’s default model.",
  "ai.modelsFetch": "fetch theirs",
  "ai.modelsLoading": "asking…",
  "ai.modelsOpen": "see the models",
  "ai.modelsLive": "Straight from the provider, right now: {n}.",
  "ai.modelsHint": "Suggestions of ours, which may be stale: {n}. Hit “fetch theirs” for the real list — or type any name you want.",
  "ai.modelsEmpty": "We ship no suggestions for this provider. Hit “fetch theirs” to ask it — or type the name by hand.",
  "ai.modelsNoMatch": "Nothing here goes by that name. It saves exactly what you type.",
  "ai.modelsNone": "This provider doesn’t publish a catalog. Type the model name by hand.",
  "ai.redirected": "An environment variable pointed this provider somewhere else. Your key goes there.",
  "ai.sourceEnv": "from the environment",
  "ai.sourceFile": "from the file",
  "ai.sourceAgent": "your agent’s session",
  "ai.sourceKey": "{source} · {key}",
  "ai.sourceLogin": "signed in",
  "ai.connected": "signed in",
  "ai.notConnected": "not signed in",
  "ai.login": "sign in",
  "ai.loginAgain": "sign in again",
  "ai.loggingIn": "waiting…",
  "ai.loginWaiting": "A tab opened to sign in to {name}. I’ll wait here.",
  "ai.loginDone": "Signed in to {name}.",
  "ai.loginFailed": "Couldn’t sign in.",
  "ai.loginTimeout": "Timed out waiting for the browser to come back.",
  "ai.logout": "sign out",
  "ai.test": "test it",
  "ai.testing": "testing…",
  "ai.testOk": "{model} answered in {s}s.",
  "ai.testHint": "Save a key above, or pick an agent you already have installed.",
  "ai.failed": "Didn’t work.",
  "ai.nowUsing": "Now using {name}.",
  "ai.forgotten": "Key forgotten.",
  "ai.forgottenButEnv": "Key forgotten from the file, but {var} is still set in the environment.",
  "ai.subscriptionTitle": "Use a subscription you already pay for",
  "ai.subscriptionNote":
    "If you already pay for Claude Pro or ChatGPT and have their tool signed in, Panoma hands the work to it. It stores no token and never sees your credentials: the subscription is used by your own tool, on your machine.",
  "ai.installed": "installed",
  "ai.notInstalled": "couldn’t find “{command}”",
  "ai.keysTitle": "Connect with a key",
  "ai.fromEnv": "{var} in the environment",
  "ai.stored": "saved {key}",
  "ai.noKey": "no key",
  "ai.keyPlaceholder": "paste the key",
  "ai.keyLabel": "{name} key",
  "ai.save": "save",
  "ai.saving": "saving…",
  "ai.forget": "forget",
  "ai.getKey": "get one",
  "ai.inUse": "in use",
  "ai.choose": "use this",
  "ai.choosing": "switching…",
  "ai.cantUse": "Needs a saved key or the agent installed.",

  "search.fieldLabel": "Text to find in the code",
  "search.submit": "search",
  "search.searching": "searching…",
  "search.scopeNote":
    "Literal text, case-insensitive. Only files tracked by git are read, so an uncommitted file won’t show up.",
  "search.scopeVendors":
    "Third-party dependencies are skipped even when git tracks them — it isn’t code you wrote:",
  "search.matchOne": "1 match",
  "search.matchMany": "{n} matches",
  "search.inProjectOne": "in 1 project",
  "search.inProjectMany": "in {n} project{s}",
  "search.reposSearched": "{n} repositor{y} searched",
  "search.skipped": "{n} with no git, couldn’t be searched",
  "search.skippedTitle": "Folders without git: there is nothing to ask.",
  "search.clickToOpen": "click a match to open it in the editor",
  "search.noMatch": "No file tracked by git contains “{query}”.",
  "search.openAt": "Open {file} at line {line}",
  "search.truncated": "Only the first {n} are shown. Open the folder to see them all.",
  "search.openFolder": "Open the folder",
  "search.openFolderAria": "Open the project’s folder",
  "search.failed": "Couldn’t run the search.",
  "search.openFailed": "Couldn’t open it.",
  "search.unreachable": "Couldn’t reach the server.",

  // Open and copy. See the equivalent block in Spanish for the reason of the zones.
  "open.folder": "open folder",
  "open.editor": "open in the editor",
  "open.terminal": "open a terminal here",
  "open.busy": "opening…",
  "open.doneFolder": "✓ opened",
  "open.done": "✓ opened",
  "open.unreachable": "Couldn’t reach the server.",
  "open.openWith": "Open in {name}",
  "open.moreDestinations": "More places to open it",
  "open.defaultDestination": "Default",
  "copy.command": "Copy “{command}”",
  "copy.done": "copied",

  "project.health": "Health {n}",
  "project.healthTitle": "Health {n} out of 100",
  "project.heroStatus": "Status",
  "project.heroActivity": "Activity",
  "project.heroCommits": "Commits",
  "project.heroHealth": "Health",
  "project.commitOne": "{n} commit",
  "project.commitMany": "{n} commit{s}",
  "project.sections": "Project sections",
  "project.navAll": "All",
  "project.navSummary": "Overview",
  "project.navChanges": "What happened",
  "project.navResume": "Resume",
  "project.navAssignments": "Assignments",
  "project.navDeps": "Maintenance",
  "project.navAgents": "Agents",
  "project.navMd": "The .md",
  "project.mdQuestion": "Is what your agents read true?",
  "project.mdTitle": "The instructions file",
  "project.mdCost": "{n} tokens of context every session",
  "project.mdNone":
    "There’s no AGENTS.md or CLAUDE.md here — the two files agents read on their own when they enter: they come into this project knowing nothing about it.",
  "project.mdOnlyInherited":
    "This project has no AGENTS.md or CLAUDE.md of its own, but it inherits what the folders above say: that is what your agents read when they come in here.",
  "project.mdNoneHint": "The button creates AGENTS.md with a context block —stack, commands, advisories, tasks— that Panoma keeps fresh on its own.",
  "project.mdFileMeta": "tokens: {tokens} · lines: {lines}",
  "project.mdManaged": "Panoma block",
  "project.mdClean": "Everything it claims exists.",
  "project.mdFindingOne": "1 claim that is no longer true",
  "project.mdFindings": "{n} claims that are no longer true",
  "project.mdLine": "line {n}",
  "project.mdPathMissing": "does not exist in the project",
  "project.mdPathMovedTo": "missing; there is one at {path}",
  "project.mdScriptMissing": "not in the package.json scripts",
  "project.mdScriptNear": "not in the scripts; there is {names}",
  "project.mdBlockBroken": "the Panoma block never closes: fix it by hand",
  "project.navAccounts": "Accounts",
  "accounts.copy": "copy",
  "accounts.copied": "copied",
  "accounts.editList": "Edit the list",
  "accounts.title": "Accounts & links",
  "accounts.question": "Which account was this on?",
  "accounts.hint": "What is missing when you come back: the deploy email, the domain, the usual dashboard.",
  "accounts.empty": "Nothing written down yet. The deploy account email, the domain registrar, the dashboard you can never find…",
  "accounts.addFirst": "Write down the first",
  "accounts.edit": "Edit",
  "accounts.addRow": "Add another",
  "accounts.save": "Save",
  "accounts.saving": "Saving…",
  "accounts.cancel": "cancel",
  "accounts.remove": "Remove entry",
  "accounts.label": "What it is (Vercel, domain, Stripe…)",
  "accounts.email": "account email",
  "accounts.note": "note",
  "accounts.noSecrets": "No passwords or keys: this travels in the clear through the catalog. Secrets belong in the system Keychain.",
  "accounts.badUrl":
    "One of the links doesn’t make sense. A domain (vercel.com/x), a full address (https://…) or a machine with its port (localhost:3000) all work. Nothing was saved.",
  "accounts.needsLabel":
    "There’s a row with details and no name. Say what it is —Vercel, domain, Stripe— or drop it with the ×. Nothing was saved.",

  // ── Does it still build? — the panoma check verdict ───────────────────────
  "check.title": "Does it still build?",
  "check.none":
    "Nobody has checked yet. The health above deduces; this proves it: install and build run in a separate worktree, isolated, without touching your folder.",
  "check.run": "Check it now",
  "check.rerun": "Check again",
  "check.running":
    "Installing and building in a separate worktree… this can take a few minutes. Your folder is untouched.",
  "check.ok": "It builds",
  "check.broken": "The build is broken",
  "check.inconclusive": "No verdict",
  "check.checkedOn": "checked on {date} · {seconds}s",
  "check.dirty": "There were uncommitted changes: the verdict is about the last commit.",

  "project.mdVersionWrong": "the project runs {v}",
  "project.mdEnvMissing": "the env example does not declare it",
  "project.mdEnvNear": "not declared in the env example; there is {names}",
  "project.mdLead": "It is the first thing your agents read when they enter this project. Panoma keeps what it says true.",
  "project.mdInitButton": "Create AGENTS.md with the context",
  "project.mdAddBlockButton": "Add the context block",
  "project.mdSyncButton": "Regenerate the block",
  "project.mdApplyWorking": "Writing…",
  "project.mdInitDone": "Done: {file} created with the context block. Your agents will read it next session, and Panoma keeps it fresh on its own.",
  "project.mdBlockAdded": "Done: the context block is now in {file}. It regenerates itself when reality changes.",
  "project.mdSyncDone": "Block regenerated in {file}.",
  "project.mdSyncSame": "The block was already up to date: nothing to change.",
  "project.mdBridgeMissing":
    "Claude Code will not read this file: it only loads CLAUDE.md, and this project has none. The button below also writes the bridge — a one-line CLAUDE.md that imports AGENTS.md.",
  "project.mdBridgeWritten":
    "And CLAUDE.md was written with the @AGENTS.md import, which is all Claude Code loads.",
  "project.mdTerminalAlt": "or in the terminal:",
  "project.mdFindingsIntro": "This is what the file claims that is no longer true. The button fixes the ones with a hint; the rest you fix by editing the file, and Panoma re-checks it on save.",
  "project.mdReviewTitle": "The model's opinion",
  "project.mdReviewAsk": "Ask the model's opinion",
  "project.mdReviewAsking": "Reading the file…",
  "project.mdReviewAgain": "ask again",
  "project.mdReviewStale": "The file changed after this opinion: ask again if you want fresh judgement.",
  "project.mdReviewNote": "Contradictions, redundancy and what is missing: what the mechanical checker cannot see.",
  "project.mdInherited": "Also inherits, from the folders above",
  "project.mdInheritedMeta": "tokens: {tokens}",
  "project.mdInspectButton": "Check it now",
  "project.mdInspectWorking": "Checking against the disk…",
  "project.mdRepairButton": "Fix the obvious ({n})",
  "project.mdRepairWorking": "Fixing…",
  "project.mdRepairDone": "{n} fix{es} applied. {m} left for your hand.",
  "project.mdRepairDoneAll": "{n} fix{es} applied. None left.",
  "project.mdInheritedNote": "Your agents read these too, from the folders above. The check shows what each one claims that is no longer true, line by line.",
  "project.mdTouches": "Latest touches to the file",
  "project.mdTouchAnon": "unsigned",
  "project.mdTruncated": "The project has more files than the index holds: paths were not checked.",
  "project.navDetails": "Details",

  "project.moreActions": "More project actions",
  "project.copyPath": "Copy path",
  "project.pathCopied": "Path copied",
  "project.pathCopyFailed": "Couldn’t copy the path",
  "project.rescan": "Scan it again",
  "project.rescanning": "Updating…",
  "project.rescanned": "Project updated",
  "project.rescanFailed": "Couldn’t update it",

  "project.show": "show",
  "project.hide": "hide",
  "project.showTitle": "Put it back in the main view",
  "project.hideTitle": "Take it out of the main view. It stays in the catalog.",
  "project.remove": "remove from the catalog",
  "project.removeTitle": "Take it out of the catalog. No folder gets deleted.",
  "project.actionFailed": "Didn’t work.",
  "project.unreachable": "Couldn’t reach the server.",
  "project.removeHeading": "Remove {name} from the catalog",
  "project.removeBody":
    "Panoma will forget this project and no scan will bring it back. Its page, its analysis history, and anything you wrote about it here are gone.",
  "project.removeSafeStrong": "Your folder is left alone.",
  "project.removeSafeBody":
    "The code, the git history, and everything inside stay exactly where they are. This only erases what Panoma knew.",
  "project.removeTypeBefore": "Type",
  "project.removeTypeAfter": "to confirm",
  "project.removeTypeAria": "Type {name} to confirm",
  "project.cancel": "Cancel",
  "project.removing": "removing…",
  "project.removeConfirm": "Remove from the catalog",

  "project.overviewTitle": "Project overview",
  "project.whatChanged": "What changed",
  "project.recentActivity": "Recent activity",
  "project.today": "today",
  "project.whereProtected": "Where it’s backed up",
  "project.versionControl": "Version control",
  "project.withRemote": "Has a remote",
  "project.withoutRemote": "No remote",
  "project.withoutGit": "No Git",
  "project.historyCopied": "The history has a copy off this disk.",
  "project.onlyHereOne": "1 commit lives only on this disk.",
  "project.onlyHereMany": "{n} commit{s} live only on this disk.",
  "project.whatNeedsAttention": "What needs attention",
  "project.maintenance": "Maintenance and health",
  "project.noMajorIssues": "Nothing important is wrong.",
  "project.issuesOne": "1 thing needs a look.",
  "project.issuesMany": "{n} thing{s} need a look.",

  "project.outOf100": "out of 100",
  "project.commitChartAria": "Commits over the last seven days",

  "project.attnNoRemote": "No remote repository",
  "project.attnNoRemoteDetail": "This project exists only on this disk.",
  "project.attnNoRemoteAction": "Set up a remote",
  "project.attnAdvisoriesOne": "1 security advisory",
  "project.attnAdvisoriesMany": "{n} security advisorie{s}",
  "project.attnAdvisoriesDetail": "Some dependencies need reviewing.",
  "project.attnAdvisoriesAction": "Review advisories",
  "project.depsUnchecked": "not checked",
  "project.depsUncheckedWhy":
    "{file} could not be read, so the exact versions are unknown and nothing was asked about advisories.",
  "project.attnUnchecked": "Advisories have not been checked",
  "project.attnUncheckedDetail":
    "{file} cannot be read, and without exact versions there is nothing to ask. The zero below does not mean it is clean.",
  "project.attnUncheckedAction": "See dependencies",
  "project.attnUnenriched": "Nobody has asked about the dependencies",
  "project.attnUnenrichedDetail":
    "Up-to-date versions and security advisories are asked of the registries, and this project has never asked. The zeros below do not mean it is clean: run {cmd}.",
  "project.attnUnenrichedAction": "See dependencies",
  "project.depsUnenrichedWhy":
    "This project has never been enriched: the registries were never asked about versions or advisories, so there is no answer to show.",
  "project.attnOutdated": "{n}/{total} dependenc{totalies} behind",
  "project.attnOutdatedDetail": "Updating raises the project’s health.",
  "project.attnOutdatedAction": "See dependencies",
  "project.allGood": "All clear",
  "project.allGoodDetail": "Nothing risky right now.",

  "project.whoBuilt": "Who built it",
  "project.ofHistory": "of the history",
  "project.agentsShare": "Agents: {n}% of the history",
  "project.noAgentCommits": "No agent commits detected.",
  "project.builtWith": "What it’s built with",
  "project.kindLanguage": "Language",
  "project.kindFramework": "Framework",
  "project.seeFullStack": "See the full stack",
  "project.fullStackTitle": "The whole technology stack",
  "project.signalsDetected": "{n} signal{s} detected",
  "project.confidence": "{n}% confidence",

  "project.resumeQuestion": "Get back in without digging",
  "project.resumeTitle": "How to pick this up again",
  "project.noCommands": "No start-up commands found in this folder.",

  "project.lastYouDid": "What you did last",
  "project.howToStart": "How to start it",
  "project.whatItNeeds": "What it needs installed",
  "project.runtimeChecking": "checking…",
  "project.runtimeHave": "you have {version}",
  "project.runtimeMissing": "not installed",
  "project.missingEnv": "Environment variables with no value ({n})",
  "project.envDeclaredIn": "Declared in",
  "project.envNoValue": "and with no value in your",
  "project.envWhy":
    "It’s the most common reason an old project starts up and dies on the first screen.",

  "purpose.install": "install",
  "purpose.start": "start",
  "purpose.tests": "tests",
  "purpose.build": "build",

  "project.protectQuestion": "Protect your work",
  "project.protectTitle": "Some changes exist only on this disk",
  "project.protectBody":
    "Panoma publishes nothing for you: it leaves the command ready and you decide when to run it.",

  "project.depsQuestion": "Keep it healthy",
  "project.depsTitle": "Dependencies",
  "project.depsInstalled": "{n} installed",
  "project.depsDirect": "{n} direct",
  "project.depsOutdated": "{n} behind",
  "project.depsDirectAria": "Direct {ecosystem} dependencies",
  "project.depsTransitiveAria": "Transitive {ecosystem} dependencies",
  "project.depsTransitiveOne": "1 transitive, pulled in by a direct one",
  "project.depsTransitiveMany": "{n} transitive, pulled in by the direct ones",
  "project.depDev": "Dev",
  "project.depDirect": "Direct",
  "project.depTransitive": "Transitive",
  "project.depUpToDate": "Up to date",
  "project.noDeps": "No dependencies detected.",

  "project.propose": "propose",
  "project.proposing": "testing…",
  "project.proposeDone": "Done.",
  "project.alreadyFailed": "Tried before, and it failed:",
  "project.tryAnyway": "try anyway",
  "project.proposeRefused": "The server did not accept the proposal ({status}).",
  "project.proposeUnreadable": "The server answered something this button cannot read ({status}).",
  "project.runUnreachable": "Couldn’t reach the catalog.",

  "project.securityQuestion": "Review what matters",
  "project.securityTitle": "Security",
  "project.fixedIn": "Fixed in {versions}",

  "project.detailsQuestion": "Technical context",
  "project.detailsTitle": "Project profile",
  "project.whatItIs": "Purpose",
  "project.noDescription": "There is not enough written context to explain what this project is for.",
  "project.detected": "Detected: {text}",

  "project.aiExplain": "explain what it’s about",
  "project.aiReading": "reading the project…",
  "project.aiWriting": "writing…",
  "project.aiRewrite": "write it again",
  "project.aiWrittenBy": "written by {model}",
  "project.aiSomeModel": "a model",
  "project.aiWrittenIn": "written in {lang}",
  "lang.es": "Spanish",
  "lang.en": "English",
  "project.aiNoteBefore": "Uses whichever model you connected with",
  "project.aiNoteAfter":
    "It gets the README, the detected stack, and the latest commits, and it isn’t allowed to claim anything that isn’t in them. It doesn’t replace the project description: it’s kept separately.",

  "project.whereFrom": "Provenance",
  "project.originOwn": "You made it",
  "project.originForked": "It started from someone else’s work",
  "project.originForeign": "You didn’t start it",
  "project.originTemplate": "A template generated it",
  "project.originUnknown": "No way to tell",
  "project.originEvidence": "Signals supporting this result",
  "origin.remote-foreign": "the remote lives in {value}’s account, not yours",
  "origin.first-commit-foreign": "the first commit was made by {value}",
  "origin.license-foreign": "the licence belongs to {value}",
  "origin.history-restarted":
    "the git history starts with you, so it was restarted when the folder was copied",
  "origin.your-share": "{value}% of the history is yours",
  "origin.zip-suffix": "the folder ends in “-{value}”, the way GitHub names its ZIPs",
  "origin.scaffold-first-commit": "the first commit was written by {value}",
  "origin.only-commit": "and it is the only one: nobody has touched it since",
  "origin.commit-count": "and the history has {n} commit{s}",
  "origin.container-yours": "you started the repository that contains it ({value})",
  "origin.first-commit-yours": "the first commit is yours ({value})",
  "origin.all-history-yours": "the whole history is yours ({n} commit{s})",
  "origin.remote-yours": "the remote is in your account ({value})",
  "origin.scaffold-continued": "it started from {value} and you carried it on",
  "origin.zip-suffix-own":
    "the folder ends in “-{value}”, the way GitHub serves its ZIPs: it probably started as a download",
  "origin.zip-suffix-none": "the folder ends in “-{value}”, which is how GitHub names a “Download ZIP”",
  "origin.manifest-repo": "the manifest points at {value}",
  "origin.readme-foreign": "the README introduces itself as somebody else’s material: “{value}”",
  "origin.no-own-repo": "and there is no repository of its own where it could have started",
  "origin.no-repo":
    "there is no repository: with no history there is no way to know who started it",
  "project.noOriginEvidence": "Panoma did not find enough evidence to support a provenance result.",
  "project.localDataQuestion": "What Panoma measured",
  "project.localData": "Local inventory",
  "project.primaryLanguage": "Primary language",
  "project.notDetected": "Not detected",
  "project.versionControlRemote": "Git · remote copy",
  "project.versionControlLocal": "Git · only on this computer",
  "project.versionControlNone": "No Git",
  "project.versionControlUnknown": "Not checked",
  "project.firstSeen": "In the catalog since",
  "project.fileCount": "Source files",
  "project.path": "Path",
  "project.branch": "Branch",
  "project.lastScan": "Last scan",
  "project.size": "Size",
  "project.files": "{n} file{s}",
  "project.logQuestion": "Coordinated work",
  "project.logTitle": "Agent activity",
  "project.logMore": "and more: {n}",
  "project.logFiles": "files: {n}",
  "project.logbook": "Logbook",
  "project.launches": "In your terminal",
  "project.launchOf": "redacted assignment",
  "project.logEmpty": "No agent has written anything here over MCP yet.",
  "project.logEmptyHow":
    "Connect one to this project and whatever it notes down — changes, decisions, blockers — gets written here, for whoever comes by three months from now.",
  "project.tasks": "Tasks",
  "project.proposals": "Proposals",
  "project.servicesQuestion": "Where it lives",
  "project.servicesTitle": "Services and distribution",
  "project.servicesEmpty": "No services or distribution targets were detected.",
  "project.noTechnologies": "No technologies have been detected yet.",
  "project.cleanupQuestion": "Cleanup",
  "project.cleanupTitle": "Unused assets",

  "project.assetsSearch": "find unused assets",
  "project.assetsReading": "reading the code…",
  "project.assetsSlow": "It reads every source file in the project, so it takes a few seconds.",
  "project.assetsFailed": "Couldn’t analyze it.",
  "project.assetsStats":
    "assets analyzed: {n} · owned by the platform (not checked): {platform} · source files read: {sources}",
  "project.assetsAllUsed": "Every asset is mentioned somewhere in the code.",
  "project.assetsUnused": "{n} unreferenced",
  "project.assetsDynamic":
    "In {dirs} the code builds its paths piece by piece, so those folders stay out of the analysis: a file can be in use without its name ever appearing.",
  "project.assetsCaveat":
    "“Unreferenced” means the file’s name appears in no source file. That’s a hint, not proof — check before you delete anything.",

  "project.updated": "Updated {when}",
  "project.codeSize": "{size} of code",
  "project.backToCatalog": "Back to the catalog",

  "common.copyOf": "copy of {name}",
  "common.iconOf": "{name} icon",
  "common.health": "Health {score}/100",

  "search.title": "Search every project at once",
  "search.intro":
    "“Where did I write that Stripe webhook thing?” No editor can answer that, because none of them has all eighty projects open.",

  "credentials.title": "Keys committed to your repositories",
  "credentials.intro":
    "It searches what git tracks, across every repository at once. A key in an ignored {env} sits on your disk; a committed key sits in every clone anyone ever made, and stays in the history even after you delete the file. Today it reads the current contents of tracked files: a key you already deleted from the tree is still in the old commits, and those aren’t searched yet.",
  "credentials.allowlist":
    "Only credentials with a recognizable shape get flagged — prefixes issued by exactly one provider — never heuristics along the lines of “a long string next to the word key”. And there’s an explicit list of what is {not} a secret: Firebase and Google Maps client keys are public by design, they ship inside the APK, and flagging them would be the fastest way to make you stop reading this page.",
  "credentials.not": "not",

  "scan.start": "check the portfolio",
  "scan.again": "check again",
  "scan.busy": "reading the history…",
  "scan.failed": "Couldn’t run the check.",
  "scan.unreachable": "Couldn’t reach the server.",
  "scan.findingOne": "{n} finding",
  "scan.findingMany": "{n} findings",
  "scan.reposScanned": "{n} repositor{y} checked",
  "scan.skipped": "{n} without git",
  "scan.public": "{n} skipped as public by design",
  "scan.publicTitle":
    "Firebase and Google Maps client keys, example files, and third-party dependencies.",
  "scan.clean": "No credential with a recognizable shape anywhere in your repositories.",
  "scan.trackedByGit": "{label} tracked by git",
  "secret.stripe-live": "Stripe live secret key",
  "secret.stripe-test": "Stripe test secret key",
  "secret.aws": "AWS access key",
  "secret.github-token": "GitHub token",
  "secret.anthropic": "Anthropic API key",
  "secret.openai": "OpenAI API key",
  "secret.slack": "Slack token",
  "secret.private-key": "Private key",
  "secret.supabase-service": "Supabase service_role key",
  "secret.google-api-key": "Google API key",
  "secret.sendgrid": "SendGrid key",
  "secret.env-file": ".env file",
  "secret.key-file": "key file",
  "secret.google-service-account": "Google service account",
  "secret.ssh-private-key": "SSH private key",
  "secretWhy.stripe-live": "Lets anyone charge and move money out of the real account.",
  "secretWhy.stripe-test": "Only touches the test environment, but it should not be in the history either.",
  "secretWhy.aws": "Opens the AWS account, with whatever that user is allowed to do.",
  "secretWhy.github-token": "Opens the user’s repositories, with whatever their permissions allow.",
  "secretWhy.anthropic": "Billed to your account until you revoke it.",
  "secretWhy.openai": "Billed to your account until you revoke it.",
  "secretWhy.slack": "Opens the Slack workspace.",
  "secretWhy.private-key": "A private key in the history has stopped being private.",
  "secretWhy.supabase-service":
    "Skips every row-level security policy. It is the master key.",
  "secretWhy.google-api-key":
    "Outside client configuration, a Google key with no domain restriction can be used by anyone and is billed to you.",
  "secretWhy.sendgrid": "Lets anyone send mail in your name.",
  "secretWhy.file":
    "Deleting it from the tree is not enough: what was committed stays in the history, and the key has to be rotated.",
  "scan.orderTitle": "If any of this is real, the order matters",
  "scan.step1Act": "Revoke the key in the provider’s console.",
  "scan.step1": "{act} It’s the only thing that actually turns it off.",
  "scan.step2": "Issue a new one and put it in an ignored `.env`.",
  "scan.step3Act": "After that, if you want, scrub it from the history with `git filter-repo`.",
  "scan.step3":
    "{act} Deleting it from the file and committing doesn’t help: it’s still in every earlier commit, and in any clone anyone made.",
  "scan.notStored":
    "This report isn’t saved to the database. Storing exactly where your leaked keys are would create a second place to leak them from.",

  "packages.title": "{n} dependencie{s} across your portfolio",
  "packages.emptyTitle": "No dependencies yet",
  "packages.emptyBody":
    "They come from the projects in the catalog: scan a folder and each project’s dependencies show up here, with versions and advisories.",
  "packages.intro":
    "Your portfolio seen by package instead of by project. No package manager can show you this: each one only ever sees a single project.",
  "packages.stats":
    "{n} direct dependenc{ies} behind · {m} advisor{mies} · checked {when}",
  "packages.statsUnchecked":
    "Versions and advisories not asked for yet — run {cmd} and this line fills in.",
  "packages.colPackage": "package",
  "packages.colProjects": "projects",
  "packages.colInUse": "in use",
  "packages.colLatest": "latest",
  "packages.colAdvisories": "advisories",
  "packages.deprecated": "deprecated",
  "packages.unpinned": "unpinned",

  "agents.empty": "No agents connected",
  "agents.countOne": "{n} agent",
  "agents.countMany": "{n} agents",
  "agents.intro":
    "What AI agents have done across your projects, in one place. They connect over MCP and report as they work.",
  "agents.connectFirst": "Connect one from the terminal:",
  "agents.connectNote":
    "The command prints the key and an MCP config ready to paste. Meanwhile, attribution from git trailers already works with nothing installed — open any project with history.",
  "agents.entries": "{n} entr{ies} · {m} project{ms}",
  "agents.seen": "seen {when}",
  "agents.recentActivity": "Recent activity",

  "families.titleOne": "{n} folder that is a copy",
  "families.titleMany": "{n} folders that are a copy",
  "families.intro":
    "Grouped by root commit, git remote, name, and shared dependencies. For each family, panoma points at the one to keep — it deletes nothing. Being the main one doesn’t mean the project is alive: its state says that, separately.",
  "families.stats": "{n} famil{ies} · {bytes} of repeated code",
  "families.empty": "No copies in the catalog. Scan a folder with {cmd} to look for them.",
  "families.copiesAndSize": "{n} cop{ies} · {bytes}",
  "store.alsoCopies": "· {n} more cop{ies}",
  "store.alsoCopiesTitle": "This row stands for the good folder; the others are under Copies.",
  /*
    The same fact for the tile, where the sentence does not fit and becomes the tooltip. It is
    written whole, with its figure inside, instead of joining `store.alsoCopies` and the title at
    render time: the «·» that opens the other one is a separator between the path and this, not
    prose, and a tooltip assembled from two strings cannot be read here as the reader will hear it.
   */
  "store.alsoCopiesMark": "{n} more cop{ies}. This tile stands for the good folder; the others are under Copies.",
  "families.canonical": "main",
  "families.copy": "copy",
  "families.noGit": "no git",
  "families.sameDate": "same date",
  "families.daysBehind": "{n} d behind",

  "runs.empty": "No proposals yet",
  "runs.countOne": "{n} proposal",
  "runs.countMany": "{n} proposals",
  "runs.intro":
    "Every proposal is prepared in an isolated worktree: edit the manifest, install, run the tests. The result is a branch with the patch — never a change applied in your folder, and never a push.",
  "runs.tryHint": "Try it on a dependency that’s behind:",
  "runs.argProject": "project",
  "runs.argPackage": "package",
  "runs.branch": "branch",
  "runs.security": "security",
  "runs.advisory": "advisory",
  "runs.noTestsEmphasis": "nobody has checked",
  "runs.noTests":
    "This project has no tests, so {nobody} that it still works with this version. Review the patch more carefully than usual.",
  "runs.steps": "Steps",
  "runs.patchLines": "Patch · {n} line{s}",
  "patch.output": "output ({n} characters)",
  "runActions.apply": "Apply to my repository",
  "runActions.merging": "Merging…",
  "runActions.discard": "Discard",
  "runActions.discarding": "Deleting…",
  "runActions.note": "Merges {branch} into your current branch. It doesn’t push.",
  "runActions.noDetail": "No detail.",
  "runActions.unreachable": "Couldn’t reach the server.",

  "isolation.container": "container",
  "isolation.container.title":
    "Ran in a throwaway container: no access to your disk or your processes.",
  "isolation.hardened": "clean environment",
  "isolation.hardened.title":
    "Ran with filtered environment variables and a throwaway HOME: install scripts never saw your credentials. They still ran on your machine, with network access.",
  "isolation.local": "not isolated",
  "isolation.local.title":
    "Ran on your machine with your full environment. An install script had access to your variables and your disk.",
  "isolation.degraded": "degraded",

  "hidden.empty": "Nothing set aside",
  "hidden.count": "{n} hidden and {m} out of the catalog",
  "hidden.wordHidden": "hidden",
  "hidden.wordExcluded": "out of the catalog",
  "hidden.intro":
    "A {hidden} project stays in the catalog with all its data: it just stops showing up in the grid and the counters. One that’s {excluded} has been deleted from Panoma, and no scan adds it back until you readmit it.",
  "hidden.diskNote":
    "Neither of those touched your disk. Every folder is still where it was, with its code and its history intact.",
  "hidden.sectionHidden": "Hidden ({n})",
  "hidden.sectionExcluded": "Out of the catalog ({n})",
  "hidden.outSince": "out since {when}",
  "hidden.readmitNote":
    "Readmitting only lifts the ban: the project comes back on the next {cmd}, with its data analyzed again from scratch.",
  "hidden.emptyBody": "When you hide or remove a project, it shows up here so you can put it back.",
  "undo.unhide": "show again",
  "undo.readmit": "readmit",
  "undo.failed": "Couldn’t do it.",
  "undo.unreachable": "Couldn’t reach the server.",

  "disk.empty": "Nothing measured yet",
  "disk.title": "{bytes} come back with one command",
  "disk.intro":
    "Installed dependencies, caches, and build output. Panoma deletes nothing: it measures, says where each number comes from, and hands you the command that regenerates it.",
  "disk.metricTotal": "total on disk",
  "disk.metricReclaimable": "regenerable",
  "disk.metricShare": "{n}% of the total",
  "disk.metricDormant": "in dormant projects",
  "disk.metricDormantDetail": "no commit in over a year",
  "disk.metricMeasured": "projects measured",
  "disk.ofTotal": "of {bytes}",
  "disk.shareAria": "{n}% of the project is regenerable",
  "disk.moreDirs": "+{n} more",
  "disk.measuredAt": "measured {when}",
  "disk.rules":
    "A folder makes this list for one of two reasons: its name only ever means “generated” ({generated}), or the project itself ignores it in git. Ambiguously named ones —{ambiguous}— that git doesn’t ignore stay out: in one project they’re junk, and in the next one they’re hand-written code.",
  "measure.start": "measure the disk",
  "measure.again": "measure again",
  "measure.busy": "walking the disk…",
  "measure.noteFirst":
    "It walks every project’s full tree. The first run takes several minutes.",
  "measure.noteBusy":
    "It walks every project’s full tree. This can take several minutes; don’t close this tab.",
  "measure.noteLast":
    "Last measured: {when}. Sizes change every time you install or build.",
  "measure.done": "{n} project{s} measured",
  "measure.missing": "{n} folder{s} no longer on disk",
  "measure.failed": "Couldn’t measure.",
  "measure.unreachable": "Couldn’t reach the server.",

  "unsaved.safe": "Everything is safe",
  "unsaved.countOne": "{n} project with unbacked work",
  "unsaved.countMany": "{n} project{s} with unbacked work",
  "unsaved.intro":
    "What exists only on this disk. Panoma reads each folder’s git state and touches nothing: it shows you the command, you run it.",
  "unsaved.statUnversioned": "{n} folder{s} with no version control",
  "unsaved.statOrphanCommits": "{shown} commit{s} with no remote copy anywhere",
  "unsaved.statUnpushed": "{n} commit{s} not pushed",
  "unsaved.statChecked": "as of the last scan · run {cmd} again to refresh it",
  "unsaved.emptyBody":
    "No project in the catalog has uncommitted changes, unpushed commits, or a repository without a remote.",
  "unsaved.emptyNote":
    "Projects scanned with {flag} don’t show up here: nothing is known about those, which is not the same as being clean.",
  "unsaved.group.no-git": "No version control",
  "unsaved.blurb.no-git":
    "Folders with code and no repository. No history, no remote, no way to undo anything: an accidental delete here doesn’t come back.",
  "unsaved.group.no-commits": "A repository and not one commit",
  "unsaved.blurb.no-commits":
    "Someone ran `git init` and stopped there. Everything inside is outside any history.",
  "unsaved.group.no-remote": "Only on this disk",
  "unsaved.blurb.no-remote":
    "Repositories with no remote configured. Their entire history exists in exactly one place: here.",
  "unsaved.group.unpushed": "Commits not pushed",
  "unsaved.blurb.unpushed":
    "They have a remote, but there are commits that haven’t left this machine.",
  "unsaved.group.uncommitted": "Uncommitted changes",
  "unsaved.blurb.uncommitted": "Files touched or never added that aren’t in any history.",
  "unsaved.group.stashes": "Forgotten stashes",
  "unsaved.blurb.stashes": "Changes set aside “for a second” that have been there ever since.",
  "unsaved.files": "{n} file{s}",
  "unsaved.copyOfTitle":
    "Panoma considers this a copy of {name}. Even so, whatever you touched here is only here.",

  "api.localOnly": "{action} only works with a local catalog.",
  "api.action.openFolder": "Opening folders",
  "api.action.aiConfig": "Configuring the model",
  "api.action.assign": "Assigning work",
  "api.action.withdraw": "Taking an assignment back",
  "api.action.launchAgent": "Launching an agent",
  "api.action.check": "Checking the build",
  "api.action.measureDisk": "Measuring the disk",
  "api.action.writeBlock": "Writing the block",
  "api.action.rescan": "Rescanning",
  "api.action.noteTask": "Noting tasks",
  "api.action.noteMemory": "Curating memory",
  "api.action.hooks": "Installing the hooks",
  "api.missingId": "The project id is missing.",
  "api.missingProject": "The project is missing.",
  "api.noProject": "Project not found.",
  "api.noAssignment": "No such assignment.",
  "api.unknownAction": "Unknown action.",
  "api.badLimit": "“{value}” doesn’t work as a limit: it takes a whole number from 1 to {cap}.",
  "api.unreachable": "Couldn’t reach the server.",
  "api.folderGone": "The folder is no longer at {root}. Scan again.",

  "guard.rejected": "Request rejected: {detail}.",
  "guard.rejectedHint": "Panoma only accepts actions from its own interface or from the CLI.",
  "guard.otherSite": "the request comes from another site ({site})",
  "guard.otherOrigin": "the origin {origin} is not this application",
  "guard.localOperatorOnly":
    "This gives orders to the computer the catalog lives on, and that needs its operator key.",
  "guard.localOperatorOnlyHint":
    "Open the catalog with the “this machine” link that “{cli} up --network” prints, or do it on the computer itself.",

  "open.unknownTool": "I don’t know how to open with “{tool}”.",
  "open.gone": "The folder is no longer at {root}.",
  "open.goneHint": "You may have moved or deleted it. Scan again to update the catalog.",
  "open.noEditor": "I couldn’t find an editor on the PATH.",
  "open.noConfig": "We don’t know where that agent keeps its configuration.",
  "open.noEditorHint":
    "It looks for these, in order: {order}. In VS Code or Cursor you install it with “Shell Command: Install 'code' command in PATH”, and the order changes with the PANOMA_EDITOR variable.",
  "open.unsupportedTool": "I don’t know how to open “{tool}” on {os}.",
  "open.launchFailed": "Couldn’t open with {command}.",
  "open.launchNamedFailed": "Couldn’t open {name}: {detail}",
  "open.noTerminalHere": "I can’t open a terminal on {os} yet.",
  "open.noTerminalHereHint": "Open the folder and start your agent by hand.",
  "open.noAgent": "I couldn’t find any agent installed.",
  "open.noAgentHint":
    "It looks for these, in order: {agents}. With one installed and signed in, this button launches it.",
  "open.appMissing": "That app isn’t installed on this machine.",

  "ai.unknownProvider": "Unknown provider.",
  "ai.noKeyNeeded": "{name} doesn’t use a key: it uses the session you already signed into.",
  "ai.emptyKey": "The key arrived empty.",
  "ai.notAKey": "That doesn’t look like a key.",
  "ai.loginBusy": "There’s already a sign-in half done. Finish it or wait for it to expire.",
  "ai.noLogin": "That provider doesn’t use sign-in.",

  "assign.alreadyQueued": "That assignment is already in the queue.",
  "assign.pasteHint": "Copy the assignment and paste it to your agent.",
  "check.busy": "There’s already a check running for this project.",
  "check.failed": "Couldn’t check it: {detail}",
  "tasks.needTitle": "The task needs a sentence.",
  "tasks.tooLong": "The sentence can’t go past {n} characters.",
  "notes.tooLong": "A note is a durable fact in a sentence or two: neither empty nor an essay. The character cap is 500.",
  "notes.overBudget": "The memory is full: consolidate or discard a note before approving another. The character cap is 2000.",
  "notes.sleepingFull": "Sleeping signals are at capacity: discard or consolidate one before approving another. The slot cap is 30.",
  "notes.pendingFull": "Too many proposals are waiting: decide on those first. The cap is 20.",
  "notes.gone": "That note is already decided.",
  "notes.saveFailed": "Couldn’t save it.",
  "notes.title": "Memory",
  "notes.hint": "Durable facts every agent receives on opening the project. What an agent proposes waits here for your yes.",
  "notes.empty": "Nothing noted yet.",
  "notes.pendingTitle": "Proposed",
  "notes.approve": "Approve",
  "notes.discard": "Discard",
  "notes.add": "Note it",
  "notes.addPlaceholder": "A durable fact about this project…",
  "notes.proposedBy": "proposed by {agent}",
  "notes.sleepsAt": "sleeps on {trigger}",
  "notes.badTrigger": "The where must be a relative path in this project: exact, or a zone ending in /**.",
  "notes.challengedTitle": "Challenged",
  "notes.challengedEvidence": "the disk moved: {target} ({observed})",
  "notes.reapprove": "Re-approve",
  "double.title": "The double",
  "double.shadowTag": "in shadow",
  "double.hint": "What your agents would have asked you, and what your double would have answered. Nobody has seen these answers: grading them is its exam.",
  "double.askedBy": "asked by {agent}",
  "double.drafting": "The double has not drafted yet.",
  "double.abstained": "The double abstained: none of your beliefs covers this question.",
  "double.cites": "Backed by:",
  "double.backed": "I would have said the same",
  "double.vetoed": "No",
  "double.labeledBacked": "you agreed",
  "double.labeledVetoed": "you disagreed",
  "double.gone": "That consultation is already graded.",
  "double.saveFailed": "Couldn’t save it.",
  "roots.serverOnly": "Watched places belong to the machine serving the catalog.",
  "roots.missingFolder": "The folder is missing.",
  "roots.system": "{path} belongs to the system: none of your projects live there.",
  "roots.home": "Your whole home folder is too much: add the folders where you actually code.",
  "roots.library": "That’s app data, not your projects.",
  "roots.notAFolder": "{path} isn’t a folder that exists.",
  "roots.covered":
    "{path} is already inside {covering}, which is watched whole. If you only want that one, remove the outer folder first.",
  "rescan.failed": "Couldn’t update {name}: {detail}",

  "md.missingSlugPath": "The project or the file is missing.",
  "md.missingSlugAction": "The project is missing, or what to do with the block.",
  "accounts.missingInput": "The project or the list of accounts is missing.",
  "accounts.badUrlAt": "The link on “{label}” doesn’t make sense. Nothing was saved.",

  "agentMcp.localOnly": "Connecting an agent writes to this disk: local machine only.",
  "agentMcp.missingInput": "The agent is missing.",
  /*
    The same refusal the screen already makes, kept on this side too. The button knows and comes up
    disabled, so nobody reaches here by accident — but a tab left open since before the install, or
    anything calling the route directly, would. A guard that only lives in the interface is a
    guard for the people who were not going to break it anyway.
   */
  "agentMcp.ephemeral": "This copy runs from npx: the configuration would point at a cache npm may clear, and the agent would start without the tools and never say so.",
  "agentMcp.ephemeralHow": "Install panoma and restart the catalog: npm i -g panoma · panoma down && panoma up",
  "agentMcp.noServer":
    "The MCP server isn’t in this install. Build it with: pnpm --filter @panoma/mcp run build",
  "agentMcp.badJson":
    "{path} has a syntax error. Leaving it alone: fix it and paste this yourself, or try again.",
  "agentMcp.notAnObject":
    "{path} isn’t shaped the way we expected. Leaving it alone: paste this where it belongs.",
  "agentMcp.badToml":
    "{path} has a syntax error. Leaving it alone: fix it and paste this yourself, or try again.",
  "agentMcp.tomlManual":
    "Panoma is already in {path}, written your way. Leaving it alone: update it yourself with this.",
  "agentKeys.localOnly": "Local machine only.",
  "agentKeys.missingField": "Missing “{field}”.",
  "agentKeys.gone": "That agent is gone.",

  "verdicts.malformed":
    "The list of reactions is missing, or one of them isn’t shaped the way we expected. Nothing was saved.",
  "verdicts.tooMany":
    "{n} reactions arrived and {cap} fit at a time. Nothing was saved: send them in batches.",
  "verdicts.badSource":
    "“{source}” isn’t a source that can be forgotten. The ones there are: {sources}, or “all” for every one.",
  "verdicts.unknownSource": "“{source}” isn’t a known source. The ones there are: {sources}.",
  "verdicts.badAccepted":
    "“{value}” says nothing about the review. Write accepted=true, accepted=false or accepted=pending.",

  "distill.failed": "Couldn’t distill that: {detail}",
  "distill.noProvider": "Set up a provider with: {cli} ai use <provider>",

  "api.modelFailed": "Couldn’t ask the model: {detail}",
  "model.noneConnected": "no model is connected yet",
  "model.connectHint":
    "Connect one on the Model page, or from the terminal: {cli} ai use <provider>",
  "model.noCredential": "the {name} credential is missing",
  "model.hintCli": "Install {name} and sign in; Panoma will call “{command}”.",
  "model.hintOauth": "Sign in to {name} from the Model page.",
  "model.hintKey": "Save the key on the Model page or with “{cli} ai key {id}”. Get one at {url}",

  "look.noImage": "The screenshot is missing: there is no image to look at.",
  "look.badImage": "That image can’t be read: it arrives empty or in a format that isn’t an image.",
  "look.noProfile":
    "There is nothing to measure this screen against: your portrait is empty and this project has no north. Distill your history —{cli} twin distill— or write a north with {cli} north.",
  "look.budgetSpent":
    "Today’s looks are spent: {used} of {cap}. They come back tomorrow, or raise the cap with PANOMA_LOOK_BUDGET.",
  "look.failed": "Couldn’t look at that: {detail}",
  "look.noVision": "The provider you have set up can’t receive images: {detail}",
  "look.assignMalformed": "You didn’t say which finding to turn into an assignment.",
  "look.assignGone": "That finding is gone: the look it came from was deleted.",
  "look.assignQueued": "That is already in the queue.",
  "look.assignButton": "Add to the queue",
  "look.assignDone": "Queued in {project}: {title}",
  "look.assignNow": "Do it now",
  "look.assignAgain": "Send it again",
  "look.dismissButton": "Discard it",
  "look.dismissed": "discarded",
  "look.dismissDone": "Discarded. If you change your mind, you can put it back in the queue.",
  "critique.showOne": "See the finding",
  "critique.showMany": "See them one by one — findings: {findings}",
  "critique.hide": "Close the list",
  "critique.moved":
    "This review is no longer the one you are looking at: the folder changed and panoma redid it. Reload to see the current findings.",
  "critique.never":
    "Panoma hasn’t read this folder yet, so there’s nothing to show here: neither good nor bad.",
  "critique.clean": "Panoma read it and found not one mechanical problem. Files read: {n}.",
  "critique.partial": "And it didn’t get through all of it: the folder holds more than one pass covers.",
  "critique.queued": "Queued. Your agent picks it up when it enters the project.",
  "critique.dismissed": "Discarded. If you change your mind, you can put it back in the queue.",
  "look.assignLaunched": "Terminal opened with {agent} working on it.",
  "look.assigning": "Queueing…",
  "look.assigned": "in the queue",
  "assign.noTask": "That assignment is no longer in the queue.",
  "assign.notQueued": "That assignment was no longer in the queue: an agent may have closed it.",
  "assign.taskIdLine":
    "This assignment is in panoma's queue with id {id}: claim it with panoma_claim_task before you start and close it with panoma_complete_task when you are done.",
  "look.noIdentity":
    "This project has no stable identity yet —it comes from the first commit— so there would be nowhere to keep what was looked at. Make the first commit and try again.",
  "look.noShot": "That screenshot is no longer in the inbox: {name}",
  "look.noShotName": "You didn’t say which screenshot to look at.",
  "look.unreadableShot":
    "That screenshot was in the list and couldn’t be opened: {detail}. It was probably deleted, or it weighs more than can be looked at.",

  "dest.look": "The critic: what’s wrong with what you were handed",
  "look.kicker": "Twin · the critic",
  "look.title": "What’s wrong with what you were just handed",
  "look.intro":
    "The middle turn, done by someone else. It looks at the screen with your portrait in hand and says which of your statements it breaks, with the next instruction already written. A judgement that doesn’t hang off a statement you signed doesn’t leave here.",
  "look.yardstick": "measured against · portrait statements: {n}",
  "look.noYardstick":
    "Your portrait is empty, so there is nothing to measure with: this only reports what breaks a statement of yours. Start with your twin.",
  "look.budget": "looks today: {used} · cap for the day: {cap}",
  "look.watch":
    "The watcher only looks at what shows up in an inbox, and at each screenshot once. Its share of the day: {cap}.",
  "look.notRedacted":
    "A screenshot travels whole: there is no way to redact pixels. Whatever is visible in it —a key in a terminal, a real email address— leaves with the image.",
  "look.inboxTitle": "The inbox",
  "look.inboxOf": "{project}’s inbox",
  "look.inboxEmpty": "Mounted and empty: no agent has left anything yet.",
  "look.inboxSkipped": "files that aren’t images and don’t get looked at: {n}",
  "look.noInbox": "No project has the inbox mounted.",
  "look.noInboxHint":
    "Mount it with “{cli} md init” inside the project. From then on your agents read in AGENTS.md where to leave what they build, and it shows up here.",
  "look.button": "Look",
  "look.buttonAgain": "Look again",
  "look.looking": "Looking…",
  "look.looked": "already looked at · findings: {n}",
  "look.lookedClean": "already looked at · broke nothing",
  "look.estimate": "statements: {statements} · prompt tokens: {tokens} · image: {size}",
  "look.verdictOf": "What it says about {subject}",
  "look.clean": "It doesn’t break any of your statements.",
  "look.unreadable":
    "The answer didn’t have the shape of findings. The call was paid for anyway, and you can look again.",
  "look.fix": "Ask for: {fix}",
  "look.against": "against: {statement}",
  "look.measured": "measured against statements: {statements}",
  "look.dropped": "judgements without backing, dropped: {n}",
  "look.uploadTitle": "Not in any inbox?",
  "look.uploadHint":
    "A desktop app, a Figma frame, a photo taken with a phone: whatever no agent can capture goes up from here.",
  "look.uploadPick": "Choose an image",
  "look.uploadTarget": "Project to upload the screenshot to",
  "look.badType": "That isn’t an image that can be looked at: PNG, JPEG, WebP or GIF.",
  "look.tooBig": "That image weighs {size} and the cap sits at {cap}. Crop it or export it as JPEG.",
  "look.historyTitle": "What it has looked at",
  "look.historyEmpty": "It hasn’t looked at anything yet.",
  "look.firedWatch": "the watcher looked at it",
  "look.firedHand": "you asked for it",

  "taste.full":
    "It doesn’t fit: the portrait would take {chars} of {cap} characters. Nothing was saved. Take a statement out, or scope it to its project so it only counts there, and save again.",

  "twin.toCritic": "Show the critic a screen →",
  "twin.title": "This is what I learned about you",
  "twin.titleEmpty": "I haven’t learned anything about you yet",
  "twin.intro":
    "Every belief comes from things you wrote to your agents, with the quotes underneath. There is nothing to approve: if you touch nothing, this is what your agents read. Read it, and correct whatever isn’t you.",
  "twin.introWaiting":
    "Every belief comes from things you wrote to your agents, with the quotes underneath. They don’t reach them yet: a machine worked these out, and it takes one yes from you, down below.",
  "twin.introEmpty":
    "Panoma reads your history with your agents on your own disk and pulls out the few things you actually believe about how your work should come out, each with the quotes it came from.",
  "twin.introEmptyHint":
    "Start just below, under your histories: it says which ones are on this machine and how much they weigh, measured without opening any.",
  "twin.counts": "beliefs: {beliefs} · forming: {forming} · evidence: {observations}",
  "twin.density": "observations per belief: {density}",
  "twin.corrections": "you have corrected {corrections} of {shown}",
  "twin.rate": "{rate}% needed correcting",
  "today.criticWhere": "What it saw, and where",
  "today.criticFindingOne": "{n} thing",
  "today.criticFindingMany": "{n} thing{s}",
  "today.criticOne": "the critic saw something while you were away",
  "today.criticMany": "things the critic saw while you were away: {n}",
  "twin.briefs": "of what the critic has seen you have assigned {ordered} of {findings}",
  "twin.briefsRate": "{rate}% of what it points at works for you",
  "twin.briefsLaunched": "of those, sent to an agent: {launched}",
  "twin.briefsDiscarded": "and you said no to: {discarded}",
  "twin.reachTitle": "Who reads it",
  "twin.reach": "Your portrait goes down to the .md of these projects: {reached} of {projects}",
  "twin.reachNone": "Right now no agent reads it: none of your projects has the channel open. You open it one at a time, inside the folder.",
  "twin.reachSome": "In the rest the channel is closed, so there your agents work knowing nothing about this.",
  "twin.reachHow": "{cli} md init",
  "twin.designTitle": "What yours looks like",
  "twin.designFrom": "From projects the critic has read, copies aside: {read} · of those, with something to look at: {withUi}",
  "twin.designProjects": "projects: {projects}",
  "twin.designFonts": "Typefaces: {fonts}",
  "twin.designRadii": "Corners: {radii}",
  "twin.designTraits": "With dark mode: {dark} · with animation: {animation}",
  "twin.briefsRelaunched": "some more than once — launches: {launches}",
  "twin.digest":
    "In the last {days} days — new: {created} · refined: {refined} · retired: {retired}.",
  "twin.corpusLeft":
    "This comes from {read} of {total} stored quote{totals} of yours. Unread: {left}.",
  "twin.distillAll": "Read the rest of my history · {n} quote{s} left",
  "twin.distilling": "Reading…",
  "twin.distillEstimate":
    "what this pass reads — quotes: {verdicts} · input tokens (roughly): {tokens}",
  "twin.distillProgress": "read: {read} · observations stored: {saved} · left: {left}",
  "twin.distillNothing": "There is no history left to read.",
  "twin.corpusDoneOne": "It comes from your whole history: the one stored quote has been read.",
  "twin.corpusDoneMany": "It comes from your whole history: all {total} stored quotes have been read.",
  "twin.scopeOnly": "Only in {project}",
  "twin.scopeAll": "Applies to everything you make",
  "twin.scopedTag": "only in {project}",
  "twin.badgeSigned": "signed by you",
  "twin.badgeStanding": "standing",
  "twin.badgeForming": "forming",
  "twin.formingWhy": "not enough proof yet: it takes three, from two days or two projects",
  "twin.support": "observations: {observations} · projects: {projects} · days: {days}",
  "twin.showCitations": "show the quotes: {n}",
  "twin.hideCitations": "hide the quotes",
  "twin.sign": "It’s well put",
  "twin.edit": "Say it in my words",
  "twin.editSave": "Save my version",
  "twin.editText": "Belief text",
  "twin.veto": "That’s not what I think",
  "twin.markedGestures": "changes marked: {n}",
  "twin.topicDesign": "Design",
  "twin.topicFrontend": "The interface itself",
  "twin.topicBackend": "The server and its data",
  "twin.topicCli": "The terminal",
  "twin.topicTesting": "How things are checked",
  "twin.topicCopy": "The words",
  "twin.topicWorkflow": "How you work with your agents",
  "twin.topicTooling": "The tooling",
  "twin.topicData": "The data",
  "twin.topicOther": "Everything else",
  "twin.consentTitle": "One single question",
  "twin.consentBody":
    "There are beliefs the machine worked out on its own that you haven’t looked at yet. Until you say yes, the file your agents read is exactly what you signed: nothing you didn’t write speaks for you.",
  "twin.consentCount": "waiting: {n} · characters they would take in total: {chars}",
  "twin.consentOver":
    "with them the portrait wouldn’t fit in {cap} characters, so something would have to come out",
  "twin.consentAllow": "Let them reach the file",
  "twin.consentRevoke": "Taken back by deleting twin.json, without opening this.",
  "twin.proposalsTitle": "It wants to change something you signed",
  "twin.proposalsNote":
    "You wrote these, so the machine leaves them alone: it says how it would put them now, and waits.",
  "twin.proposalJoins": "merging this many: {n}",
  "twin.proposalAccept": "Let it change",
  "twin.proposalReject": "Leave it as it is",
  "twin.graveyardTitle": "What you said you are not",
  "twin.graveyardNote":
    "It isn’t deleted: it stays here so synthesis never proposes it again in other words.",
  "twin.save": "Save",
  "twin.saving": "Saving…",
  "twin.cancel": "Discard what’s marked",
  "twin.saveFailed": "Couldn’t save that: {detail}",
  "twin.fileTitle": "TASTE.md",
  "twin.fileSize": "{chars} of {cap} characters",
  "twin.fileHint":
    "This is the file your agents read, and the other door to the same thing: open it and delete a line, and that statement leaves the portrait the next time you decide something here.",
  "twin.fileFull":
    "It doesn’t fit. Until something comes out, what you decide is stored in the catalog but never reaches the file, and the file is all your agents read.",
  "twin.fileWritten": "written right now: {n}",
  "twin.fileRoom": "There is room for {n} more characters.",
  "twin.spendTitle": "What it cost today",
  "twin.spendLooks": "looks: {used} of {cap}",
  "twin.spendTokens": "{input} input tokens · {output} output",
  "twin.spendNone": "No model was called today.",
  "twin.spendUnmetered": "{n} unmeasured: that provider doesn’t publish usage.",
  "twin.spendDistills": "distillations: {n}",
  "twin.spendClassify": "topic passes: {n}",
  "twin.spendSynth": "syntheses: {n}",
  "twin.sourcesTitle": "Your histories with your agents",
  "twin.sourcesLead":
    "Panoma measures them without opening them. Nothing is read until you say so, and you say so one at a time: reading Claude Code is not reading Codex.",
  "twin.sourcesNone": "There is no agent history on this disk that Panoma knows how to measure.",
  "twin.sourceSize": "files: {files} · {size}",
  "twin.sourceGone": "no longer on this disk",
  "twin.sourceAllow": "Let it read this",
  "twin.sourceRevoke": "Stop reading this",
  "twin.sourceNoReader": "we can’t read this one yet",
  "twin.sourcesRevokeNote":
    "Stopping closes the door and doesn’t delete what already came in: that’s {cli} twin forget.",
  "twin.consentMalformed": "It needs to say which source and whether it’s allowed.",
  "twin.consentUnknown": "That source isn’t on this disk: {source}",
  "twin.mineNoConsent":
    "None of your histories has permission, so not one file was opened. Say so just below, under your histories.",
  "twin.mineNoReadable":
    "The histories on this disk can’t be read yet, so no permission would help: not one file was opened.",
  "twin.mineNoHistories":
    "There is no agent history on this disk to read, so not one file was opened.",
  "twin.mineButton": "Look for what’s new in my history",
  "twin.mineButtonLeft": "Read my history · {n} left",
  "twin.mining": "Reading your histories…",
  "twin.mined": "new quotes: {saved} · already there: {duplicates}",
  "twin.minedNone": "Nothing new in your histories since last time.",
  "twin.churnTitle": "How your portrait has moved",
  "twin.churnMonth": "{month} — new: {created} · refined: {refined} · retired: {retired}",
  "twin.churnStill": "It hasn’t moved this month: what is there is already said.",
  "twin.churnOnlyRefined":
    "This month only rewrote what was already there: nothing new and nothing retired.",
  "twin.projectQuestion": "What is work here measured against?",
  "twin.projectTitle": "What your agents read here",
  "twin.projectLead":
    "It goes down through AGENTS.md into every session you open in this folder. The global ones apply across all your projects; the rest only here.",
  "twin.projectLeadUnmanaged":
    "The global ones apply across all your projects; the rest only here. It doesn’t reach your agents yet: this project has no Panoma block in its AGENTS.md.",
  "twin.projectCount": "statements that apply here: {n}",
  "twin.projectOnly": "only this project: {n}",
  "twin.projectOnlyHere": "only here",
  "twin.projectNone": "There is no portrait yet, so nothing is measured here.",
  "twin.projectNoneHere": "Your portrait says nothing that applies to this project.",
  "twin.projectForming": "still forming about this project: {n}",
  "twin.projectOpen": "Open your twin",
  "twin.spendReads": "reads: {used} of {cap}",
  "twin.readsSpent":
    "Today’s reads are spent: {used} of {cap}. They come back tomorrow, or raise the cap with PANOMA_READ_BUDGET.",
  "twin.synthesize": "Rewrite the portrait",
  "twin.synthesizing": "Writing…",
  "twin.synthHint": "Reads all your evidence and rewrites what the machine believes about you.",
  "twin.synthDone": "new: {created} · refined: {refined} · retired: {retired}.",
  "twin.synthAsks": "And it asks you about beliefs you signed: {n}.",
  "twin.synthSame": "Nothing changed: the evidence says what it said last time.",
  "twin.synthNothing":
    "There is no evidence to synthesize yet. Read your history above: that’s where the observations the portrait comes from are pulled out.",
  "twin.synthUpToDate": "The portrait is already up to date: no new evidence has come in.",
  "twin.synthFailed": "The portrait couldn’t be written.",
  "twin.citedIn": "in {project}",

  "score.tooFew":
    "It has told you {shown}. It takes {floor} for a percentage to mean anything: below that, a single correction moves it more than five points, and it would be describing the last belief you looked at rather than your taste.",
  "score.noTrend":
    "The {rate}% is where it stands today, not whether it improves: neither of the two settled months reaches {floor} beliefs, so the month-over-month comparison can’t be made yet. The current month doesn’t count: its beliefs haven’t been looked at yet.",
  "score.better":
    "Of what it told you last month you corrected {recent}%, and of the month before {previous}%: it goes down, which is the only thing that means the twin is learning.",
  "score.notBetter":
    "Of what it told you last month you corrected {recent}%, and of the month before {previous}%: it doesn’t go down. Until it goes down month over month, the twin isn’t learning, and this scoreboard isn’t going to say otherwise.",

  "connect.title": "Connect an agent over MCP",
  "connect.lead":
    "MCP is the channel an agent uses to talk to your catalog. These are the ones on this machine: connecting one gives it the nine tools — the project brief on arrival, the log, and the task queue — and writes its configuration where that agent reads it.",
  "connect.do": "Connect",
  "connect.again": "Connect again",
  "connect.alreadyOn": "connected",
  /*
    «Connected» was said of an agent that had never once called. The badge read a row in `agents`
    —a key was issued— and printed the word for a connection, while the bridge, two clicks away,
    counted `last_seen_at` and answered zero. Two screens, one fact, and the one that overstated
    was the one you land on.
    So the key that exists gets its own word, and the green one is kept for an agent that has
    actually been in. And because a state nobody can act on is worse than no state, the step comes
    with it: an already-open session picks up nothing, which is the whole reason it never entered.
   */
  "connect.keyIssued": "key issued",
  "connect.neverUsed": "The key is written, but {name} has never used it. Restart its session: one that was already open picks up nothing.",
  "connect.ephemeral": "This copy runs from npx and goes away when the command ends. The configuration would point inside its cache, and the day it is cleared {name} would start without the tools and never say so.",
  /*
    Two commands, because installing is not the half that unblocks this.

    It said «install it and try again», and whoever did exactly that watched the screen not change
    and had nothing to read. This page is served by a process that was started from npx, and a
    running process does not inherit an install that happened after it: the notice would have stayed
    there through any number of refreshes. The reader did what they were told and the product went
    on asking for it.

    The terminal's version of this refusal is right to say «try again», because there the next
    invocation IS the newly installed one. Here the thing that has to be restarted is the catalog,
    so here it is named.
   */
  "connect.ephemeralHow": "Install it and restart the catalog: this screen is served by the npx copy, and a running server does not inherit what you install afterwards.",
  "connect.againCost":
    "Already connected. Connecting again issues a new key: where panoma writes the file it updates itself, but if you pasted the block by hand anywhere, that copy will stop working and you will have to paste it again.",
  "connect.working": "Connecting…",
  "connect.written": "MCP configuration written.",
  "connect.updated": "The panoma entry that was already there has been updated.",
  "connect.coexists": "Still there: {list}.",
  "connect.gitWarning":
    "Heads up: this file holds the agent key in the clear and git would carry it. Add its name to .gitignore before you commit.",
  "connect.restart": "Restart {name} so it picks this up.",
  "connect.pasteInto": "This agent keeps its MCP servers in a format we will not touch. Paste this into:",
  "connect.pasteSomewhere": "We don’t know where this agent keeps its MCP servers. Paste this wherever it does:",
  "connect.copy": "Copy the MCP configuration",
  "connect.openFile": "Open the file",
  "connect.opened": "Opened in {editor}. Paste the block, save, and restart {name}.",
  "connect.copied": "copied",
  "disconnect.do": "disconnect",
  "disconnect.confirm": "Yes, disconnect",
  "disconnect.working": "Removing…",
  "disconnect.losing": "What {name} recorded here goes too: {n} entrie{s}.",
  "disconnect.nothingLost": "{name} hasn’t recorded anything yet.",
  "md.noBlock": "There’s no Panoma block in this project; create it first.",
  "md.notInherited": "That file isn’t an inherited one from this project.",
  "md.fileGone": "The file is no longer where it was.",
  "md.noFiles": "This project has no AGENTS.md or CLAUDE.md.",
  "md.inspectLocalOnly": "The review reads your disk: it only works with a local catalog.",
  "md.repairLocalOnly": "Repairing writes to your disk: it only works with a local catalog.",

  "runs.notFound": "Run not found.",
  "runs.noBranch": "This run left no branch to apply.",
  "runs.alreadyRunning": "There’s already a run in progress on {name}.",
  "runs.alreadyRunningHint": "Wait for it to finish, or watch it under Activity.",
  "runs.missingPackage": "The package name is missing.",
  "runs.noFixForPackage": "{package} has no advisory with a fixed version in {name}.",
  "runs.noFixes": "{name} has no vulnerabilities with a published fix.",
  "runs.enrichAdvisories": "Run '{cli} enrich' to refresh the OSV advisories.",
  "runs.notADependency":
    "{package} isn’t among {name}’s dependencies, or I don’t know its latest version.",
  "runs.enrichVersions": "Run '{cli} enrich' to pull versions from the registries.",
  "runs.unsupportedEcosystem": "I can’t update {ecosystem} dependencies yet.",
  "runs.knownFailureHint": "Try again with --force if you think something has changed.",
  "runs.quarantined":
    "{package} {version} was published {age} ago and Panoma’s quarantine is {days} days.",
  "runs.quarantinedHint":
    "A freshly published version is where supply-chain compromises show up, and they’re almost always pulled within a day or two. Try again later, or right now with --force if you know what you’re doing. The threshold changes with PANOMA_CUARENTENA_DIAS.",
  "runs.crashed": "The run crashed: {detail}",

  "north.missing": "The sentence is missing: write what having this project finished would be.",
  "north.tooLong":
    "That’s {n} characters and the north is one line: up to {max} fits. Anything longer is a plan, and there’s a plan assignment for that.",
  "north.noIdentity":
    "This project has no stable identity yet, so there’s nowhere to store the sentence where it would survive moving the folder. Scan it again and try once more.",

  "move.noNorth": "nobody has written what “finished” means here yet",
  "move.unsavedWork": "{n} unsaved-work warning",
  "move.unsavedWork.n": "{n} unsaved-work warnings",
  "move.noReadme": "there is no README that explains it",
  "move.neverBuilt": "nobody has ever checked whether it still builds",
  "move.critiques": "{n} thing showing without opening the project",
  "move.critiques.n": "{n} thing{s} showing without opening the project",
  "move.idle": "idle for {n} month",
  "move.idle.n": "idle for {n} month{s}",
  "move.advisories": "{n} open security advisory",
  "move.advisories.n": "{n} open security advisories",
  "move.outdated": "{n} outdated direct dependency",
  "move.outdated.n": "{n} outdated direct dependencies",
  "move.lowHealth": "health {n} out of 100",
  "move.longIdle": "{n} month{s} idle: the question is no longer about maintenance",
} satisfies Record<MessageKey, string>;

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { es, en };

export type TranslationVars = Record<string, string | number>;

/** The form of `t` already with the language applied: what `useT()` returns on the client. */
export type Translate = (key: MessageKey, vars?: TranslationVars) => string;

/**
 * The correct form of a word according to the number that accompanies it.
 *
 * `{s}` comes from `{n}`; `{ms}` from `{m}`; `{totals}` from `{total}`. The rule is this: a gap
 * called 'something + s' is filled by looking at the gap 'something', which already comes with the
 * figure.
 *
 * It is resolved here and not in each call because the error it fixes is of forgetting, not of
 * calculation: '1 commits,' '1 folders not under version control,' '1 signals detected' — nine
 * times the same, and always because the person who wrote the phrase didn't remember that the
 * number can be one. With fifty-two affected texts, asking each place to pass `s: plural(n)` is
 * like asking someone to remember fifty-two times.
 *
 * Irregulars cannot be guessed: 'copies' and 'repositories' have their space written in the text
 * (`cop{ies}`, `repositor{y}` ) and their value is calculated the same way, by looking at the
 * number.
 */
const SHAPES: Record<string, [one: string, many: string]> = {
  s: ["", "s"],
  es: ["", "es"],
  y: ["y", "ies"],
  ies: ["y", "ies"],
};

function shapeFor(name: string, vars: TranslationVars): string | undefined {
  /* `{s}` mira `{n}`; `{ms}` mira `{m}`; `{totals}` mira `{total}`. */
  const suffix = (["ies", "es", "s", "y"] as const).find((end) => name.endsWith(end));
  if (!suffix) return undefined;
  const shape = SHAPES[suffix];
  if (!shape) return undefined;
  const stem = name.slice(0, name.length - suffix.length);
  const count = vars[stem === "" ? "n" : stem];
  if (typeof count !== "number") return undefined;
  return count === 1 ? shape[0] : shape[1];
}

export function t(locale: Locale, key: MessageKey, vars?: TranslationVars): string {
  const text = MESSAGES[locale][key];
  if (!vars) return text;
  // A worthless hole stays written as is: better to see `{n}` on the screen than a mutilated text
  // that no one would know how to trace back here.
  return text.replace(/\{(\w+)\}/g, (hole, name: string) => {
    const value = vars[name];
    if (value !== undefined) return String(value);
    return shapeFor(name, vars) ?? hole;
  });
}

/*
  `next/headers` is loaded at runtime with the same trick as `lib/db.ts`: this file is also
  imported by client components (the provider needs the dictionaries), and a static import of
  `next/headers` would put server-exclusive code in the browser graph — Next stops the compilation
  when it sees it. With `new Function`, webpack never finds out; on the server, the import
  resolves normally.
  With extension because this import does not go through the bundler: Node resolves it raw, and
  the package `next` does not bring a map of `exports`, so «next/headers» without `.js` does not
  exist for the ESM resolver.
 */
const runtimeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<typeof import("next/headers")>;

const headersModule = () => runtimeImport("next/headers.js");

/**
 * The language of the request, only for Server Components.
 *
 * Send the cookie that the selector wrote; without it, the first clue from the browser in
 * `Accept-Language` that is Spanish or English. Browsers send that list already sorted by
 * preference, so it is traversed as is: a parser of `q` values to choose between two languages
 * would be more code than criterion. Ultimately, Spanish.
 */
export async function getLocale(): Promise<Locale> {
  const { cookies, headers } = await headersModule();

  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (saved === "es" || saved === "en") return saved;

  const accepted = (await headers()).get("accept-language") ?? "";
  for (const part of accepted.split(",")) {
    const tag = part.trim().toLowerCase();
    if (tag.startsWith("en")) return "en";
    if (tag.startsWith("es")) return "es";
  }
  /*
    Output English. The product was born in Spanish and the texts are still written there first,
    but outwardly the door opens in English: whoever arrives without a cookie and without a
    recognizable header is, almost always, someone who does not speak Spanish. The one who does
    speak it indicates it in their `Accept-Language` and enters in Spanish without touching
    anything.
   */
  return "en";
}

/**
 * The language of a request, for the API routes.
 *
 * `getLocale()` does not work here: it reads from `next/headers`, which in a route handler forces
 * a `await` and to load the module by the `new Function` trick, when the handler already has the
 * `Request` in hand. This reads the same cookie and the same header, without any of that, and
 * works the same in any runtime.
 *
 * The routes return `error` and `hint`, and the two screens that call them display that text
 * exactly as it is. Without this, each error was a phrase in Spanish within an English interface —
 * and an error is exactly the moment when it is necessary to understand what it says.
 */
export function localeFrom(request: Request): Locale {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== LOCALE_COOKIE) continue;
    const value = rest.join("=");
    if (value === "es" || value === "en") return value;
  }

  // Without a cookie, the first recognizable browser fingerprint; ultimately English, the same
  // criterion and the same order as `getLocale`.
  for (const part of (request.headers.get("accept-language") ?? "").split(",")) {
    const tag = part.trim().toLowerCase();
    if (tag.startsWith("en")) return "en";
    if (tag.startsWith("es")) return "es";
  }
  return "en";
}

/**
 * The work risk without saving, written in the language that applies.
 *
 * Live here and not on every screen because there are three that depict it —the grid, the card,
 * and the unsaved work page— and a plural rule repeated three times is a rule that ends up
 * diverging. It receives the translation function instead of the language to serve both a server
 * component (`t` with its locale) and a client component (`useT()`).
 */
export function riskText(
  translate: Translate,
  risk: { code: string; count?: number },
): string {
  const n = risk.count ?? 0;

  // Two codes are not pluralized by number: one does not take a number and the other changes the
  // entire phrase depending on whether there are files waiting or not.
  if (risk.code === "unversioned") return translate("risk.unversioned");
  if (risk.code === "untracked") return translate("risk.untracked", { n });
  if (risk.code === "no-commits") {
    return n > 0 ? translate("risk.no-commits.n", { n }) : translate("risk.no-commits");
  }

  const key = (n === 1 ? `risk.${risk.code}` : `risk.${risk.code}.n`) as MessageKey;
  return translate(key, { n });
}

/*
  The selected director action, already drafted.
  The map is explicit and not a `move.${code}` template, unlike in `riskText` above. The
  difference is who writes the code: those for the risks come from `workRisks`, which has been
  there for years; these are new and will still move. A key composed by hand escapes the compiler,
  so renaming a code would leave the gap blank at runtime instead of breaking the compilation.
  With the map, the day `MoveReasonCode` gets a value, TypeScript points out this table.
  The two codes with singular and plural have their two keys; the rest, one.
 */
const MOVE_TEXT: Record<string, MessageKey | [MessageKey, MessageKey]> = {
  "no-north": "move.noNorth",
  "unsaved-work": ["move.unsavedWork", "move.unsavedWork.n"],
  "no-readme": "move.noReadme",
  "never-built": "move.neverBuilt",
  idle: ["move.idle", "move.idle.n"],
  advisories: ["move.advisories", "move.advisories.n"],
  outdated: ["move.outdated", "move.outdated.n"],
  "low-health": "move.lowHealth",
  "long-idle": "move.longIdle",
  critiques: ["move.critiques", "move.critiques.n"],
};

/**
 * Why is this movement proposed, in the language that applies.
 *
 * Same treatment as `riskText` and for the same reason: the one who orders returns the neutral
 * fact —code and number— and the sentence is written where both languages are. It receives the
 * function of translating to serve equally a server component and a client component.
 */
export function moveText(
  translate: Translate,
  reason: { code: string; count?: number },
): string {
  const n = reason.count ?? 0;
  const entry = MOVE_TEXT[reason.code];
  if (!entry) return reason.code;
  if (typeof entry === "string") return translate(entry, { n });
  return translate(n === 1 ? entry[0] : entry[1], { n });
}
