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
  "apps.jobs.stage.scout": "Leer proyecto",
  "apps.jobs.stage.brand": "Leer marca",
  "apps.jobs.stage.brain": "Preparar argumento",
  "apps.jobs.stage.serve": "Abrir producto",
  "apps.jobs.stage.tour": "Recorrer pantallas",
  "apps.jobs.stage.record": "Grabar",
  "apps.jobs.stage.score": "Preparar música",
  "apps.jobs.stage.study": "Estudiar grabación",
  "apps.jobs.stage.plan": "Planificar escenas",
  "apps.jobs.stage.narrate": "Preparar voz",
  "apps.jobs.stage.render": "Renderizar",
  "apps.jobs.stage.review": "Revisar",
  "apps.npmMissing": "panoma necesita npm para instalar apps. Instala Node.js con npm y reinicia panoma.",
  "apps.refreshRequirements": "Comprobar requisitos",
  "apps.registryAt": "Información de versiones consultada: {date}",
  "apps.jobs.chooseProduction": "Producción",
  "apps.jobs.history": "Historial de revisiones",
  "apps.jobs.restore": "Restaurar esta revisión",
  "apps.catalogEmpty": "No hay apps disponibles.",
  "apps.catalogOpen": "Ver app: {name}",
  "apps.catalogVersion": "Versión: {version}",
  "apps.optional": "Opcional",
  "apps.setupIntro": "Instala la app y comprueba las herramientas que necesita para grabar y exportar. Solo tienes que prepararlas una vez.",
  "apps.installHint": "Después de instalarla podrás comprobar y completar los requisitos.",
  "apps.browserHint": "Captura las pantallas del proyecto y prepara las escenas del vídeo.",
  "apps.ffmpegHint": "Compone el vídeo y exporta los archivos finales.",
  "apps.brainHint": "Ayuda a preparar el guion y las decisiones creativas. Las claves de los modelos se gestionan en IA.",
  "apps.configureModel": "Configurar modelo y credenciales",
  "apps.voiceHint": "Añade narración al vídeo. Con la voz activada, el texto de la narración se envía a ElevenLabs.",
  "apps.enableVoice": "Usar ElevenLabs para la narración",
  "apps.providersSaved": "Preferencias guardadas. Se aplican a las próximas producciones.",
  "apps.providersFailed": "No se pudieron guardar las preferencias. Vuelve a intentarlo.",
  "apps.saving": "Guardando…",
  "apps.spendLink": "Ver consumo y límites en Gasto",
  "apps.key.loading": "Comprobando si hay una clave guardada…",
  "apps.key.loadFailed": "No se pudo consultar la clave guardada. Solo el operador local puede gestionar credenciales.",
  "apps.key.label": "API key de ElevenLabs",
  "apps.key.hint": "Pega la clave de tu cuenta de ElevenLabs. Se guarda en la configuración local de Panoma; no necesitas editar un .env.",
  "apps.key.save": "Guardar clave",
  "apps.key.get": "Obtener una API key",
  "apps.key.configured": "Clave guardada",
  "apps.key.missing": "Falta la API key",
  "apps.key.saved": "Clave guardada. Se usará cuando actives la narración.",
  "apps.key.removed": "Clave eliminada de Panoma.",
  "apps.key.saveFailed": "No se pudo guardar el cambio. Comprueba la clave e inténtalo de nuevo.",
  "apps.key.required": "Guarda una API key para usar la narración, o desactiva la voz antes de guardar.",
  "apps.key.replace": "Cambiar clave",
  /*
    What went wrong, in the reader's language. The table that dispatches these keys lives in
    `apps-view.ts`, where the compiler forces it to cover every code; the sentences live here
    because the guards that watch the dictionary read THIS file as text and would not see a
    separate table. CamelCase after the dot: the gap tests read keys with `\w`, and a hyphen
    would make every one of these invisible to them.
   */
  "apps.fault.offline": "No se pudo consultar qué versión hay publicada, y no hay ninguna guardada. Comprueba la conexión y vuelve a intentarlo.",
  "apps.fault.nodeTooOld": "La app pide una versión de Node.js más nueva que la de esta máquina. Necesita: {needed}. Instalada: {running}.",
  "apps.fault.npmTooOld": "La app pide una versión de npm más nueva que la de esta máquina. Necesita: {needed}. Instalada: {running}.",
  "apps.fault.engineUnsupported": "npm rechazó la versión de Node.js o de npm de esta máquina, así que la app no se puede instalar aquí.",
  "apps.fault.doesNotStart": "La app se instaló, pero no llegó a arrancar.",
  "apps.fault.cancelled": "Se canceló la operación.",
  "apps.fault.timeout": "La operación tardó demasiado y se detuvo.",
  "apps.fault.stalled": "La descarga dejó de avanzar y se detuvo.",
  "apps.fault.processFailed": "npm terminó con un error.",
  "apps.fault.noPreviousVersion": "No hay una versión anterior a la que volver.",
  "apps.fault.notInstalled": "La app no está instalada.",
  "apps.fault.operationInProgress": "Esta app ya tiene una operación en marcha. Espera a que termine.",
  "apps.fault.playwrightMissing": "Esta versión de la app no trae Playwright, así que no puede descargar el navegador.",
  "apps.fault.browserNotDeclared": "Esta versión de la app no declara ninguna descarga de navegador.",
  "apps.fault.malformedRequirements": "La app no respondió con la lista de requisitos que declara.",
  "apps.fault.incompatibleProtocol": "Esta versión de la app habla un protocolo que este panoma no entiende. Actualiza panoma.",
  "apps.fault.stagedUpdateInvalid": "La actualización preparada no se pudo leer y se descartó. La versión activa sigue funcionando.",
  "apps.fault.diskUnreadable": "No se pudo leer la instalación de la app en el disco.",
  "apps.fault.unknownApp": "Esa app no está en el catálogo.",
  "apps.fault.brokenPackage": "El paquete descargado está dañado, así que no se instaló.",
  "apps.fault.noSpaceLeft": "No queda espacio en el disco.",
  "apps.fault.permissionDenied": "panoma no tiene permiso para escribir donde guarda las apps.",
  "apps.fault.readOnlyDisk": "El disco donde panoma guarda las apps es de solo lectura.",
  "apps.fault.tooManyOpenFiles": "El sistema no dejó abrir más archivos. Cierra algo y vuelve a intentarlo.",
  "apps.fault.diskError": "Falló una operación de disco.",
  "apps.fault.commandDidNotStart": "No se pudo lanzar el programa que hace la instalación.",
  "apps.fault.localCatalogRequired": "Esto solo funciona en el catálogo local de tu máquina.",
  "apps.fault.unknownOperation": "Esa operación no existe.",
  "apps.fault.appNotEnabled": "La app está desactivada. Actívala antes de usarla.",
  "apps.fault.providerNotEnabled": "Ese modelo no está activado para esta app.",
  "apps.fault.budgetExhausted": "Se agotó el presupuesto de llamadas de hoy para las apps.",
  "apps.faultNext.budget": "Súbelo en la pantalla de Gasto, o espera a mañana: el día se cuenta en tu hora local.",
  "apps.faultNext.provider": "Actívalo en la página de la app, en «Guion y voz».",
  "apps.faultNext.install": "Instálala y actívala en su página.",
  "apps.fault.providerKeyMissing": "El modelo elegido no tiene clave. Configúrala en IA.",
  "apps.fault.voiceKeyMissing": "Falta la clave de ElevenLabs. Guárdala antes de usar la narración.",
  "apps.fault.requirementMissing": "La app tiene requisitos sin completar. Compruébalos antes de crear el vídeo.",
  "apps.fault.interrupted": "El catálogo se reinició mientras el trabajo estaba en marcha.",
  "apps.fault.appFailed": "La app falló sin decir por qué.",
  "apps.fault.invalidIdentity": "El proyecto elegido no tiene una identidad válida en el catálogo.",
  "apps.fault.musicOutsideProject": "La pista de música tiene que estar dentro del proyecto.",
  "apps.fault.confirmationRequired": "Activar un modelo o la voz necesita una confirmación explícita.",
  "apps.fault.invalidSetting": "Ese ajuste no es válido.",
  "apps.fault.appSpokeWrong": "La app respondió algo que panoma no supo leer.",
  "apps.fault.badRequest": "La petición no era válida.",
  "apps.fault.localUrlRequired": "La dirección tiene que ser de esta máquina (localhost).",
  "apps.fault.jobNotFound": "Ese trabajo ya no existe.",
  "apps.fault.projectNotFound": "Ese proyecto ya no está en el catálogo.",
  "apps.fault.ambiguousProject": "Hay más de un proyecto con esa identidad. Elige uno.",
  "apps.fault.requestFailed": "La petición a la app falló.",
  "apps.fault.artifactNotFound": "Ese archivo ya no está donde lo dejó la producción.",
  "apps.fault.reviewFailed": "La revisión del vídeo no pasó.",
  "apps.fault.stageFailed": "Una etapa de la producción falló.",
  "apps.fault.noProduction": "No salió ningún vídeo de esta producción.",
  "apps.fault.internal": "panoma se detuvo por una comprobación interna. El código está abajo.",
  "apps.key.remove": "Quitar clave",
  "apps.key.removeConfirm": "La narración necesitará otra clave para funcionar. Se elimina de Panoma; no se revoca en ElevenLabs.",
  "apps.launch.title": "Crear un vídeo",
  "apps.launch.intro": "Elige un proyecto, revisa la previsualización y exporta el vídeo cuando esté listo.",
  "apps.launch.project": "Proyecto del catálogo",
  "apps.launch.choose": "Selecciona un proyecto",
  "apps.launch.open": "Abrir producción",
  "apps.launch.empty": "No hay proyectos disponibles",
  "apps.launch.emptyHint": "Para conservar sus producciones, el proyecto necesita una identidad estable en el catálogo. Añade o vuelve a escanear un proyecto.",
  "apps.launch.catalog": "Ver catálogo",
  "apps.launch.loadError": "No se pudieron cargar los proyectos.",
  "apps.launch.loading": "Cargando proyectos…",
  "apps.launch.missingProject": "El proyecto seleccionado ya no está disponible. Elige otro proyecto.",
  "apps.launch.openHint": "Abre la pantalla de producción. El vídeo se genera cuando lo solicitas allí.",
  "apps.launch.setupHint": "Puedes elegir el proyecto ahora. Completa la preparación y activa la app para abrir la producción.",
  "apps.launch.setupLink": "Revisar preparación",
  "apps.title": "Apps",
  "apps.intro": "Programas oficiales y opcionales para tus proyectos. Prepara cada app aquí y úsala con un proyecto de tu catálogo.",
  "apps.videoSummary": "Convierte un proyecto en vídeos de producto, tutoriales y clips revisados.",
  "apps.official": "Oficial de panoma",
  "apps.open": "Ver app",
  "apps.back": "Todas las apps",
  "apps.loading": "Cargando apps…",
  "apps.retry": "Volver a cargar",
  "apps.install": "Instalar app",
  "apps.update": "Actualizar",
  "apps.rollback": "Volver a la versión anterior",
  "apps.enable": "Activar",
  "apps.disable": "Desactivar",
  "apps.uninstall": "Desinstalar conservando producciones",
  "apps.clean": "Eliminar producciones",
  "apps.cleanConfirm": "Se eliminarán las producciones de esta app. Espacio: {bytes}. Esta acción no se puede deshacer.",
  "apps.confirm": "Confirmar eliminación",
  "apps.cancel": "Cancelar",
  "apps.check": "Buscar actualizaciones",
  "apps.requirements": "Preparación de la app",
  "apps.present": "Disponible",
  "apps.missing": "Falta",
  "apps.unchecked": "Sin comprobar",
  "apps.checkedAt": "Comprobados: {date}",
  "apps.browser": "Navegador para grabar y renderizar",
  "apps.ffmpeg": "FFmpeg y FFprobe",
  "apps.download": "Aceptar y descargar navegador",
  "apps.browserConsent": "Playwright descarga Chrome for Testing desde los servidores de Google. Se aplican sus términos. Descarga aproximada: {n} MB.",
  "apps.terms": "Leer términos",
  "apps.ffmpegInstall": "Instala FFmpeg con el gestor de tu sistema: brew install ffmpeg · choco install ffmpeg · apt install ffmpeg.",
  "apps.providers": "Guion y voz",
  "apps.providersIntro": "Puedes crear vídeos sin proveedores externos. Activa un modelo o la narración solo si los necesitas; su consumo corresponde a tu cuenta del proveedor.",
  "apps.brain": "Modelo para guion y decisiones",
  "apps.voice": "Voz de ElevenLabs",
  "apps.providerConfirm": "Entiendo qué información se envía y que el proveedor usa mi cuenta.",
  "apps.providerSave": "Guardar guion y voz",
  "apps.none": "Desactivado",
  "apps.auto": "Elegir proveedor configurado",
  "apps.versions": "Versiones y almacenamiento",
  "apps.version": "Activa: {version}",
  "apps.previous": "Anterior: {version}",
  "apps.available": "Disponible: {version}",
  "apps.staged": "Pendiente de activar: {version}",
  "apps.packageSpace": "Instalación: {bytes}",
  "apps.dataSpace": "Producciones: {bytes}",
  "apps.privacy": "El gestor consulta registry.npmjs.org. Descargar el navegador contacta los servidores de Playwright y Google. Los proveedores sólo reciben datos al activarlos.",
  "apps.legal": "Licencia y avisos",
  "apps.license": "Licencia",
  "apps.notices": "Avisos",
  "apps.codecs": "Códecs",
  "apps.createVideo": "Crear vídeo",
  "apps.continueProject": "Volver a la producción del proyecto",
  "apps.needsSetup": "Prepara panoma video para crear una producción de este proyecto.",
  "apps.videoGateTitle": "«Crear vídeo» lo trae una app",
  "apps.videoGateBody":
    "panoma video convierte este proyecto en vídeos de producto, tutoriales y clips revisados. Es una app aparte y vive en la pantalla de Apps; desde que esté lista, este botón abre la pantalla de producción.",
  "apps.videoGateGo": "Ver la app en Apps",
  "apps.more": "Más",
  "apps.moreSections": "Más secciones",
  "apps.error": "Respuesta de la app",
  "apps.status.absent": "Sin instalar",
  "apps.status.installed": "Instalada · faltan requisitos",
  "apps.status.ready": "Lista para crear",
  "apps.status.update": "Actualización disponible",
  "apps.status.broken": "Requiere reparación",
  "apps.status.disabled": "Desactivada",
  "apps.status.installing": "Instalando",
  "apps.status.failed": "La operación falló",
  "apps.status.staged": "Actualización preparada",
  "apps.jobs.title": "Trabajos recientes",
  "apps.jobs.empty": "Todavía no hay trabajos.",
  "apps.jobs.pending": "En espera",
  "apps.jobs.running": "En marcha",
  "apps.jobs.cancelling": "Cancelando",
  "apps.jobs.cancelled": "Cancelado",
  "apps.jobs.failed": "Falló",
  "apps.jobs.done": "Terminado",
  "apps.jobs.retry": "Repetir",
  "apps.jobs.cancel": "Cancelar trabajo",
  "apps.jobs.progress": "Progreso: {n}%",
  "apps.jobs.production": "Producciones",
  "apps.jobs.productionIntro": "Crea una primera versión, revisa el resultado y exporta cuando esté listo. Puedes cerrar esta pestaña durante el trabajo.",
  "apps.jobs.noIdentity": "Este proyecto necesita una identidad de repositorio para conservar sus producciones al moverlo.",
  "apps.jobs.language": "Idioma",
  "apps.jobs.url": "Dirección ya en marcha (opcional)",
  "apps.jobs.urlHint": "Si el producto ya está corriendo en esta máquina con datos de verdad, pon su dirección y la cámara la filma en vez de arrancar una copia vacía. Solo direcciones locales: localhost o 127.0.0.1.",
  "apps.jobs.format": "Formato",
  "apps.jobs.goal": "Tipo de vídeo",
  "apps.jobs.promo": "Promoción de producto",
  "apps.jobs.tutorial": "Tutorial",
  "apps.jobs.spotlight": "Detalle de una función",
  "apps.jobs.start": "Crear previsualización",
  "apps.jobs.preview": "Previsualización",
  "apps.jobs.contacts": "Hoja de contactos",
  "apps.jobs.review": "Revisar vídeo",
  "apps.jobs.export": "Exportar versiones finales",
  "apps.jobs.exportVariant": "Exportar · {format} · {language}",
  "apps.jobs.historical": "Esta producción es anterior al guion guardado actual. Puedes ver y descargar sus archivos.",
  "apps.jobs.current": "Abrir producción actual",
  "apps.jobs.savedStory": "Las revisiones y exportaciones usan el guion guardado actual. Los vídeos anteriores se conservan.",
  "apps.jobs.artifacts": "Archivos y exportaciones",
  "apps.jobs.story": "Ver escenas",
  "apps.jobs.scene": "Escena",
  "apps.jobs.revision": "Cambio de la escena",
  "apps.jobs.revise": "Revisar escena",
  "apps.jobs.revisionHelp": "Selecciona una escena de ProductPromo y escribe el texto que la reemplazará. Se crea una nueva revisión.",
  "apps.jobs.result": "Resultado y revisión",
  "apps.jobs.reviewStatus": "Revisión: {status}",
  "apps.jobs.reviewChecks": "Comprobaciones",
  "apps.fault.stageFailedAt": "La etapa «{stage}» falló.",
  "apps.jobs.formatVertical": "Vertical",
  "apps.jobs.formatHorizontal": "Horizontal",
  "apps.jobs.formatSquare": "Cuadrado",
  "apps.jobs.formatForV": "Móvil: Reels, Shorts, TikTok",
  "apps.jobs.formatForH": "YouTube, web y presentaciones",
  "apps.jobs.formatForS": "Publicaciones en el feed",
  "apps.jobs.goalTrailer": "Tráiler",
  "apps.jobs.goalChangelog": "Novedades de una versión",
  "apps.jobs.goalSitetour": "Recorrido del sitio",
  "apps.jobs.stages": "Etapas de la producción",
  "apps.jobs.stageState.done": "Hecha",
  "apps.jobs.stageState.current": "En curso",
  "apps.jobs.stageState.pending": "Pendiente",
  "apps.jobs.stageState.skipped": "Omitida",
  "apps.jobs.stageState.failed": "Falló",
  "apps.jobs.starting": "Arrancando la app…",
  "apps.jobs.elapsed": "En marcha desde hace {time}.",
  "apps.jobs.took": "Duró {time}.",
  "apps.jobs.requestedBy": "Lo pidió {name} por MCP.",
  "apps.jobs.ownCopy": "una copia que arrancó la propia app",
  "apps.jobs.ownCopyFailed": "La cámara filmó una copia del producto que arrancó la propia app.",
  "apps.jobs.ownCopyWhy": "Un producto cuyos datos viven fuera de su carpeta abre vacío en esa copia —este catálogo lo hace: lo guarda todo en su propia carpeta— y de una pantalla vacía no sale una promoción. Si el producto ya está corriendo en esta máquina, pon su dirección y crea la previsualización otra vez.",
  "apps.jobs.ownCopyNext": "Dirección ya en marcha, arriba.",
  "apps.jobs.runningNow": "Ahora mismo contesta en esta máquina:",
  "apps.jobs.runningDeclared": "el puerto que declaran los scripts del proyecto",
  "apps.jobs.runningFolder": "arrancado desde la carpeta del proyecto",
  "apps.nothingNewer": "Nada más nuevo: {version} es la última versión que anuncia el registro.",
  "apps.nothingNewerHint": "Si acabas de publicar una, el registro tarda un momento en anunciarla: vuelve a comprobar y luego actualiza.",
  "apps.jobs.minutes": "{m} min {s} s",
  "apps.jobs.seconds": "{s} s",
  "apps.jobs.report": "Última producción",
  "apps.jobs.reportDone": "La producción terminó. Abajo tienes la previsualización.",
  "apps.jobs.notPlanned": "La app no encontró con qué hacer un vídeo de tipo «{goal}». Su motivo:",
  "apps.jobs.notPlannedAny": "La app no encontró con qué hacer ningún vídeo. Sus motivos:",
  "apps.jobs.otherGoals": "Otros tipos de vídeo que tampoco salieron",
  "apps.jobs.lastSaid": "Lo último que dijo la app",
  "apps.jobs.beforeTitle": "Antes de producir",
  "apps.jobs.beforeIntro": "Lo que esta producción va a usar. Se cambia en la página de la app.",
  "apps.jobs.beforeApp": "App",
  "apps.jobs.beforeBrain": "Modelo para el guion",
  "apps.jobs.beforeVoice": "Narración",
  "apps.jobs.beforeProject": "Proyecto",
  "apps.jobs.beforeReady": "Todo listo",
  "apps.jobs.beforeNotReady": "Falta algo",
  "apps.jobs.changeInApp": "Cambiar en la app",
  "apps.jobs.voiceOff": "Sin narración",
  "apps.jobs.voiceOn": "ElevenLabs",
  "apps.next.install": "Siguiente paso: instala la app.",
  "apps.next.enable": "Siguiente paso: activa la app.",
  "apps.next.check": "Siguiente paso: comprueba los requisitos.",
  "apps.next.browser": "Siguiente paso: descarga el navegador.",
  "apps.next.ffmpeg": "Siguiente paso: instala FFmpeg en tu sistema y vuelve a comprobar.",
  "apps.next.create": "Todo listo: elige un proyecto y abre su producción.",
  "apps.stepOf": "Paso {n} de {total}",
  "apps.working.install": "Instalando la app…",
  "apps.working.update": "Actualizando la app…",
  "apps.working.browser": "Preparando la descarga del navegador…",
  "apps.working.browserPercent": "Descargando el navegador: {n} %",
  "apps.working.doctor": "Comprobando los requisitos…",
  "apps.working.other": "Operación en marcha…",
  "apps.browserOwnCopy": "panoma guarda su propia copia del navegador, aparte de los que tengas en el sistema, para que las grabaciones salgan iguales en cualquier máquina.",
  "spend.family.app": "Proveedores de apps",
  "spend.familyHint.app": "Llamadas a proveedores de modelos y voz habilitados en las apps de Panoma. Cuenta intentos, aunque no terminen.",
  "spend.kind.app": "Modelo de una app",
  "spend.family.handoff": "Relevos",
  "spend.familyHint.handoff":
    "El resumen que un modelo escribe de una conversación antes de pasársela a otro agente. Una conversación, una acción tuya.",
  "spend.kind.handoff": "Resumen de un relevo",
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
  "watch.catalogDetails": "Resumen del catálogo",
  "watch.catalogFolders": "Carpetas del catálogo",

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
  /*
    What the catalog says about its own version, and it is two different pieces of news.

    «Reinicia» is the sharper one and comes first when both are true: whoever has just installed
    the newer panoma has already done that half, and the only thing left is that this screen is
    still served by the process from before. Telling them to install it again would be getting it
    wrong at the one moment the notice finally mattered.

    Each line that offers the install names the restart in the same breath, which `ephemeral-copy.test.ts`
    demands of every string on this side: installing does not reach a server that is already running,
    so half the instruction leaves the reader refreshing a screen that keeps asking for what they
    just did.

    It goes in the same panel as the temporary-copy notice and for the reason written there: it is
    news about this installation, nothing is broken, and a banner across the top would be furniture
    by the second day. Every gap carries a version and never a count, so no word is ever inflected
    against a figure.
   */
  "shell.updateReady": "Hay un panoma más nuevo que el tuyo: {latest}",
  "shell.updateHave": "Este catálogo corre la {running}.",
  "shell.updateHowNpm":
    "Actualízalo con «npm i -g panoma@latest» y reinicia el catálogo con «{cli} down» y «{cli} up»: actualizar no cambia el proceso que ya está en marcha.",
  "shell.updateHowNpx":
    "Actualízalo con «npx panoma@latest» y reinicia el catálogo con «{cli} down» y «{cli} up»: actualizar no cambia el proceso que ya está en marcha.",
  "shell.restartReady": "Ya actualizaste panoma, pero esta pantalla la sirve la versión anterior: {running}",
  "shell.restartHave": "En el disco ya tienes la {installed}.",
  "shell.restartHow": "Reinicia el catálogo con «{cli} down» y «{cli} up».",
  "shell.localAccountUpdate": "Cuenta local · hay un panoma más nuevo",
  "shell.localAccountRestart": "Cuenta local · reinicia el catálogo",
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
  "shell.version": "panoma {version}",
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
  "nav.spend": "Gasto",
  "nav.packages": "Paquetes",
  "nav.activity": "Ejecuciones",
  "nav.copies": "Copias",
  "nav.bridge": "Puente",
  "nav.handoff": "Relevo",
  "dest.bridge": "Puente de mando",
  "bridge.setup.title": "Configuración",
  "bridge.setup.progress": "Pasos completados: {completed} de {total}",
  "bridge.setup.step": "Paso {n} de {total}",
  "bridge.state.done": "Listo",
  "bridge.state.next": "Siguiente paso",
  "bridge.state.waiting": "Pendiente",
  "bridge.refresh": "Actualizar estado",
  "bridge.refreshing": "Actualizando…",
  "bridge.refreshed": "Estado actualizado.",
  "bridge.terminal": "Ejecuta en tu terminal:",
  "bridge.copyCommand": "Copiar comando: {command}",
  "bridge.copyFailed": "No se pudo copiar. Selecciona el comando y cópialo manualmente.",
  "bridge.hooksFailed": "No se pudieron instalar los hooks. Comprueba que Panoma siga abierto e inténtalo de nuevo.",
  "bridge.step.catalog.purpose": "Reúne las carpetas, tecnologías y el estado de tus proyectos en un solo lugar.",
  "bridge.step.catalog.go": "Ver proyectos",
  "bridge.step.model.purpose": "Permite que Panoma analice tus proyectos y proponga notas para la memoria.",
  "bridge.step.model.manage": "Revisar IA",
  "bridge.step.model.detected": "Configuración detectada. Comprueba el proveedor y sus credenciales en IA.",
  "bridge.step.agent.purpose":
    "Da a Claude Code, Cursor u otro agente acceso al contexto y la memoria de tus proyectos por MCP: el parte, las notas y las quince herramientas.",
  "bridge.step.agent.manage": "Gestionar agentes",
  "bridge.step.agent.seen": "Ya se ha recibido una conexión. Esto no indica que el agente esté activo ahora.",
  "bridge.step.agent.terminal": "Conectar Claude Code desde el terminal",
  "bridge.step.hooks.purpose": "Los hooks registran commits sin depender de que el agente los recuerde.",
  "bridge.step.hooks.scope": "Se instalan en los repositorios Git del catálogo y respetan los hooks ajenos. También integran actividad y notas si el proyecto ya tiene configuración de Claude Code.",
  "bridge.step.hooks.terminal": "Ejecuta dentro de la carpeta de cada proyecto:",
  "bridge.step.hooks.noGit": "No hay repositorios Git disponibles para instalar hooks. Añade un proyecto con Git al catálogo para continuar con este paso.",
  "bridge.activity.lead": "Datos acumulados del catálogo, no solo de hoy.",
  "bridge.activity.empty": "Esperando la primera actividad",
  /*
    The one thing on this screen nobody here can press.

    The journal fills when an agent working in a project calls `panoma_log` — and the copy used to
    say «it turns on by itself once the rest is running», which is true and tells the reader nothing
    they can act on. Somebody with all four of their own parts done, reading that, is looking for
    the button. There is no button. So the tool is named, and what makes an agent reach for it.
    It sat under `bridge.step.alive.*` while the journal was a fifth step; it is the empty state of
    the activity card now, and the name says so.
   */
  "bridge.activity.pending": "Al terminar una tarea, pide a tu agente que registre lo hecho con {tool}. Aquí verás la actividad que alimenta la memoria.",
  "bridge.activity.review": "Las propuestas se revisan en cada proyecto. Tú decides qué notas se conservan; las notas por ruta se entregan al trabajar en esos archivos.",
  "bridge.activity.openTwin": "Explorar el Twin",
  "bridge.system.title": "Estado del sistema",
  "bridge.system.watcherOn": "Detecta cambios en tus carpetas y actualiza el catálogo.",
  "bridge.system.watcherOff": "No está vigilando las carpetas. Escanea de nuevo para recoger los cambios recientes.",
  "bridge.system.ablationOn": "Ablación activa: algunas consultas de agentes reciben el contexto sin memoria para comparar resultados.",
  "bridge.system.ablationOff": "La ablación está desactivada. Es el estado habitual; no requiere configuración.",
  "bridge.system.openScale": "Ver informe de la báscula (JSON)",
  "bridge.title": "Conecta tus proyectos con tus agentes",
  "bridge.titleReady": "Configuración preparada",
  "bridge.lead": "Configura cómo Panoma comparte el contexto de tus proyectos con tus agentes y conserva lo aprendido entre sesiones.",
  "bridge.leadReady": "Ya completaste la configuración. La actividad aparecerá cuando tus agentes registren trabajo en un proyecto.",
  "bridge.step.catalog.title": "Catálogo de proyectos",
  "bridge.step.catalog.detail": "Proyectos en el catálogo: {count}",
  "bridge.step.catalog.pending": "Escanea la carpeta donde guardas tus proyectos. Sustituye ~/Desktop por su ruta si están en otro lugar.",
  "bridge.step.model.title": "Modelo de IA",
  "bridge.step.model.detail": "Configuraciones detectadas: {count}",
  "bridge.step.model.go": "Configurar IA",
  "bridge.step.agent.title": "Agente de programación",
  "bridge.step.agent.detail": "Agentes que se han conectado: {count}",
  "bridge.step.agent.keyUnused": "La clave está creada, pero aún no se ha usado. Instala la configuración y reinicia la sesión de tu agente para completar la conexión.",
  "bridge.step.agent.go": "Conectar agente",
  "bridge.step.hooks.title": "Registro automático",
  /*
    «of {total}» is the ones that can carry a hook, not the whole catalog. A folder without git has
    nowhere to keep one, and counting it invented a debt that could never be paid: 44 of 76, with
    the hook in all 44 that had git, read as unfinished for ever.
   */
  "bridge.step.hooks.detail": "Repositorios con hooks: {count} de {total}",
  "bridge.restartHint": "Después de instalar, reinicia la sesión del agente para que cargue la configuración.",
  "bridge.todayTitle": "Actividad y memoria",
  "bridge.stat.journal": "Entradas de bitácora",
  "bridge.stat.approved": "Notas disponibles",
  "bridge.stat.sleeping": "Notas por ruta",
  "bridge.stat.pending": "Propuestas pendientes",
  "bridge.stat.consultations": "Consultas al Twin",
  "bridge.stat.watcher": "Vigía del catálogo",
  "bridge.stat.ablation": "Experimento de memoria",
  "bridge.on": "Activo",
  "bridge.off": "Inactivo",
  "bridge.copy": "Copiar",
  "bridge.copied": "Copiado",
  "bridge.step.hooks.install": "Instalar hooks en el catálogo",
  "bridge.step.hooks.installing": "Instalando hooks…",
  "bridge.hooksDone": "Instalados: {installed} · Sin Git: {noRepo} · Hooks ajenos respetados: {foreign} · Fallos: {failed}",
  "bridge.hooksAlt": "Instalar desde el terminal",
  "bridge.hooksNoCli": "El servidor no encuentra el comando panoma. Usa la opción de instalación desde el terminal.",
  "projectHooks.on": "Ganchos puestos: la bitácora de este proyecto se escribe sola.",
  "projectHooks.off": "Sin ganchos: el catálogo solo sabrá lo que el agente se acuerde de contarle.",
  "projectHooks.install": "Ponerlos",
  "bridge.scaleHint": "La báscula compara correcciones con y sin memoria. Su informe técnico está disponible en la API.",
  "nav.disk": "Disco",
  "nav.twin": "Twin",
  "nav.hidden": "Apartados",

  // The same destinations with their long name, for the palette.
  /*
    Use both words because the palette filters by the label and by nothing else: with just "MCP",
    typing "agent" stopped finding the page that lists them.
   */
  "dest.agents": "MCP: conectar tus agentes",
  "dest.handoff": "Relevo: continuar una conversación en otro agente",
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
  "catalog.title": "Tus proyectos",
  "catalog.presentation": "Presentación del catálogo",
  "catalog.discreet": "Modo discreto",
  "catalog.sort": "Ordenar",
  "catalog.latestCommit": "Último commit",
  "catalog.share": "Compartir",
  "catalog.list": "Lista",
  "catalog.grid": "Cuadrícula",
  "catalog.resume": "Retomar",
  "catalog.filteredBy": "Filtro: {filter}",
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
  "today.activity": "Actividad reciente",
  "today.proposalCount": "Propuestas: {n}",
  "today.findingCount": "Hallazgos: {n}",
  "today.commitCount": "Commits: {n}",
  "today.projectCount": "Proyectos: {n}",
  "today.bornCount": "Nuevos: {n}",
  "today.since": "desde {when}",
  "today.last24h": "en las últimas 24 horas",
  "today.nothing": "Sin actividad registrada {period}",
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
  /*
    "Open everything": one click, and the whole working set of a project is in front of you. The
    button, what it answers, and the configurator where the owner decides what one click opens.
    The plan's rules live in `lib/open-all.ts`; the words live here.
   */
  "openAll.button": "Abrir todo",
  "openAll.buttonTitle": "Abrir de una vez todo lo que usas en este proyecto",
  "openAll.willOpen": "Abrirá: {list}",
  "openAll.checking": "Mirando qué puede abrir…",
  "openAll.openingList": "Abriendo: {list}",
  "openAll.busy": "abriendo…",
  "openAll.doneAll": "✓ todo abierto",
  "openAll.donePartial": "Abrió {done} de {n}",
  "openAll.doneNone": "No se pudo abrir nada.",
  "openAll.missing": "ya no está en esta máquina",
  /*
    Going missing has two shapes, and saying one for the other sends the reader looking in the
    wrong place: an uninstalled tool is no longer on the machine; a link deleted from the accounts
    still is — what changed there is the project.
   */
  "openAll.missingLink": "ya no está entre los enlaces del proyecto",
  "openAll.configure": "Configurar «Abrir todo»…",
  "openAll.title": "Qué abre «Abrir todo» en {name}",
  "openAll.intro":
    "Un clic y todo lo que necesitas para trabajar está delante: los enlaces, una terminal, el editor, tu agente. Se abre en este orden, y lo último queda encima.",
  "openAll.opens": "Se abre",
  "openAll.doesNotOpen": "No se abre",
  "openAll.include": "Abrir {name}",
  "openAll.moveUp": "Subir {name}",
  "openAll.moveDown": "Bajar {name}",
  "openAll.sourceService": "detectado en el proyecto",
  "openAll.sourceAccount": "de tus cuentas",
  "openAll.sourceDistribution": "donde se publica",
  "openAll.sourceRemote": "remoto de git",
  "openAll.sourceCustom": "escrito aquí",
  "openAll.commandLabel": "Comando al abrir la terminal (opcional)",
  "openAll.commandPlaceholder": "por ejemplo, pnpm run dev",
  "openAll.commandHint":
    "Lo ejecuta tu shell en la carpeta del proyecto, tal como está escrito. Lo que arranque se queda en la ventana.",
  "openAll.useSuggested": "Usar «{command}»",
  "openAll.addTerminal": "Añadir una terminal",
  "openAll.addLink": "Añadir un enlace",
  "openAll.linkName": "Nombre del enlace",
  "openAll.linkUrl": "Dirección del enlace",
  "openAll.linkPlaceholder": "vercel.com/… · localhost:3000",
  "openAll.removeLink": "Quitar el enlace {name}",
  "openAll.customLink": "Enlace",
  "openAll.badUrl": "Hay un enlace que no se entiende. Vale https://…, un dominio o localhost:puerto.",
  "openAll.badLink": "Esa dirección no se puede abrir.",
  "openAll.saveAndOpen": "Guardar y abrir",
  "openAll.save": "Guardar",
  "openAll.saving": "guardando…",
  "openAll.openOnly": "Abrir",
  "openAll.cancel": "Cancelar",
  "openAll.reset": "Volver a lo sugerido",
  "openAll.noIdentity":
    "Este proyecto no tiene repositorio, así que el plan no se guarda: se abre lo marcado, y los comandos y enlaces propios no se pueden usar.",
  "openAll.nothingChosen": "Marca al menos una cosa.",
  "openAll.noCandidates": "Aquí no hay nada que abrir todavía: ni un editor instalado ni un enlace detectado.",
  "openAll.saved": "Plan guardado.",
  "openAll.notSaved": "El plan no se pudo guardar: este proyecto no tiene repositorio.",
  "openAll.emptyPlan": "No hay nada que abrir.",
  "openAll.badPlan": "El plan no se entiende.",
  "openAll.badPlanCommand": "Un comando solo puede ir en una terminal.",
  "openAll.badPlanKey": "Hay un paso que no se reconoce.",
  "openAll.badPlanUrl": "Hay un enlace que no se entiende.",
  "openAll.badPlanTooMany": "Demasiados pasos: el máximo es {n}.",
  "openAll.unknownAction": "No sé hacer «{action}».",
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
  "project.mdReviewAgain": "volver a pedirla, aunque nada haya cambiado",
  "project.mdReviewCached": "Contestada desde la opinión guardada: el fichero no cambió desde que se escribió.",
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
  "project.aiRewrite": "volver a escribir, aunque nada haya cambiado",
  /*
    The two honest lines behind a paid paragraph. The first says the answer cost nothing — it came
    from the saved description, because nothing changed. The second says the answer will not be
    there tomorrow: a project with no repository has no stable identity, and `decisions` hangs
    from the identity, so the text was paid for and has nowhere to live. Both components use it.
   */
  "project.aiCached": "Contestada desde la descripción guardada: nada cambió desde que se escribió.",
  "project.aiUnsaved":
    "Se conserva solo mientras esta página esté abierta: el proyecto no tiene repositorio, y panoma no tiene dónde guardarlo.",
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
  "api.action.handoff": "Leer y escribir conversaciones de agentes",
  "api.action.openAll": "Abrir todo",
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
  /*
    The brake of the project card: `/api/describe` and `/api/md/review` share one cap, the family
    `card`. The figure closes the sentence and the remedy travels as the hint, so the count is
    never glued to a noun.
   */
  "api.cardSpent": "Las descripciones y opiniones de hoy están gastadas: {used} de {cap}.",
  "api.handoffSpent": "Los resúmenes de relevo de hoy están gastados: {used} de {cap}.",
  "api.handoffSpentHint":
    "Vuelve mañana, sube el tope en /spend o exporta PANOMA_HANDOFF_BUDGET. El relevo sin modelo sigue disponible.",
  "api.cardSpentHint":
    "Vuelven mañana, o sube el tope en la pantalla de gasto (/spend) o con PANOMA_CARD_BUDGET.",
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
  "notes.extraction": "Aprendizaje de las sesiones",
  "notes.jobsPending": "En cola o trabajando: {n}",
  "notes.jobsDeferred": "Aplazadas: {n}",
  "notes.jobsFailed": "Con fallo: {n}",
  "notes.jobsHint": "El aprendizaje deja propuestas para tu revisión. Si falta presupuesto o espacio, espera. Un fallo del proveedor se reintenta hasta tres veces; una respuesta cortada se pide de nuevo una sola vez con más sitio, y una ilegible no se vuelve a pagar. El historial original sigue disponible.",
  "notes.coverage": "Última sesión procesada: registros incluidos {selected}/{total}; omitidos {omitted}; recortados {clipped}.",
  "twinMemory.errStale": "Este registro cambió en otra vista. Actualiza antes de volver a modificarlo.",
  /*
    The four links of the chain, which the screen used to leave for the reader to infer. The figure
    carries every number and the line under it carries none: «caracteres» and «historias» do not
    take a suffix from `{n}`, and a label with no digit in it cannot print «1 historias».
   */
  "twinPath.title": "El recorrido",
  "twinPath.lead":
    "Tu historial se convierte en lo que piensas, lo que piensas baja a un fichero, y ese fichero es lo que leen todos tus agentes. Cada paso tiene su sección aquí abajo.",
  "twinPath.history": "Tu historial",
  "twinPath.historyNote": "historias que has dejado leer",
  "twinPath.mind": "Lo que piensas",
  "twinPath.mindNote": "criterios y decisiones tuyas",
  "twinPath.file": "El fichero",
  "twinPath.fileNote": "caracteres en TASTE.md",
  "twinPath.agents": "Tus agentes",
  "twinPath.agentsNote": "proyectos que lo leen",
  "twin.memoryOnlyTitle": "Tus decisiones ya están guardadas",
  "twin.memoryOnlyIntro": "Tus decisiones guardadas están disponibles abajo. El retrato de tus preferencias todavía está vacío.",
  "twinTeach.episodes": "Decisiones y objetivos guardados",
  "twinMemory.currentVersion": "Abrir versión activa",
  "notes.always": "Al abrir el proyecto",
  "notes.scoped": "Al trabajar en estos archivos",
  "notes.scope": "Cuándo se aplica",
  "notes.scopeAll": "En todo el proyecto",
  "notes.scopePath": "En una ruta concreta",
  "notes.where": "Ruta relativa o carpeta/**",
  "notes.whereHint": "Archivo exacto o carpeta con /** al final. La regla se entrega al consultar esa ruta.",
  "notes.awakeBudget": "Caracteres al abrir: {used}/{budget}",
  "notes.scopedBudget": "Reglas por ruta: {used}/{budget}",
  "notes.pendingBudget": "Propuestas pendientes: {used}/{budget}",
  "notes.anchors": "Rutas vigiladas: {n}",
  "notes.noAnchors": "Sin comprobación automática de archivos",
  "notes.challengeHint": "Estas notas no se entregan a los agentes. Confírmalas solo si siguen siendo ciertas; se comprobarán contra el estado actual del disco.",
  "notes.reviewFirst": "Propuestas e impugnadas no se entregan hasta que las apruebes.",
  "notes.hint": "Reglas del proyecto aprobadas por ti. Unas se entregan al abrirlo; otras, al consultar los archivos donde se aplican.",
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
  /*
    The memory bridge of delivery A: the whole vocabulary of `private/memory-build-plan.md` §20.4
    lands at once, including the keys a later delivery renders (`staged`, `checkUnknown`,
    `outcomeConfirmed`, `falsePositive`, `publicationConflict`, `capacityLimited`), so the words
    are fixed before the screens that use them exist. The sentences say what the system knows
    and never present transport as obedience: a receipt proves the bytes were in the record, not
    that the model followed them.
   */
  "memory.deliveryUnknown": "No pudimos comprobar la recepción.",
  "memory.deliveryPartial": "El registro contiene solo parte de la memoria.",
  "memory.coreIncomplete": "Falta memoria necesaria para esta tarea.",
  "memory.requiresCheck": "Hay una condición pendiente de comprobar.",
  "memory.captureConsent": "Leer actividad local de las fuentes elegidas.",
  "memory.extractConsent": "Usar mensajes nuevos para proponer memoria del proyecto.",
  "memory.twinAutoLearnConsent": "Aprender mis criterios de los mensajes nuevos.",
  "memory.preConsentUnknown": "Este tramo podría ser anterior al permiso y no se procesó.",
  "memory.backlog": "Intervalos pendientes: {count}",
  "memory.readFailed": "No se pudo leer la fuente.",
  "memory.staged": "El resultado está guardado y espera su incorporación.",
  "memory.purgePreview": "Revisar el contenido que se eliminará.",
  "memory.purgeRemaining": "Copias pendientes de eliminar: {count}",
  "memory.staleRevision": "El contenido cambió. Revisa su versión actual.",
  "memory.checkUnknown": "No hay una comprobación suficiente.",
  "memory.outcomeConfirmed": "Resultado comprobado para este caso.",
  "memory.falsePositive": "Marcar esta incidencia como falsa alarma.",
  "memory.publicationConflict": "El archivo cambió y necesita reconciliación.",
  "memory.capacityLimited": "El trabajo llega más rápido de lo que permite la cuota.",
  /*
    The storage quota of plan §25.3 (delivery E): the pause with its reason — the scope that is
    full — the warning at four fifths, and the line with the figures, which closes on the limit
    so that «1» never meets an inflected word. The scope words are their own keys because the
    sentence names them in the middle and Spanish agrees the article.
   */
  "memory.quotaPaused": "Memoria automática nueva en pausa: se ha alcanzado la cuota de almacenamiento ({scope}). No se borra nada para hacer sitio; borra algo o sube el límite.",
  "memory.quotaNear": "Cuota de almacenamiento casi alcanzada en {scope}: al llegar, la memoria automática nueva se pausa.",
  "memory.quotaLine": "Memoria almacenada de {scope}: {used} de {limit}",
  "memory.quotaScopeCatalog": "el catálogo",
  "memory.quotaScopeProject": "este proyecto",
  /*
    The hooks of one project, event by event. Three evidences that the bridge collapsed into one
    until 14-Sep-2026: the brand is in the file, each event carries our entry with its verb or an
    older one, and the command those entries name exists on this disk without the PATH of a
    terminal — the 556 silent failures were hooks that passed the first two.
   */
  "memory.hooksTitle": "Ganchos por evento",
  "memory.eventSessionStart": "Al abrir la sesión (brief)",
  "memory.eventPreToolUse": "Antes de editar (señal)",
  "memory.eventStop": "Al terminar el turno (scan)",
  "memory.eventSessionEnd": "Al cerrar la sesión (puntero)",
  "memory.hookInstalled": "instalado",
  "memory.hookLegacy": "versión anterior",
  "memory.hookMissing": "falta",
  "memory.postCommit": "post-commit de git: instalado",
  "memory.postCommitMissing": "post-commit de git: falta",
  "memory.settingsNone": "Sin configuración de Claude Code en esta carpeta: solo puede llevar el gancho de git.",
  "memory.durable": "El comando de los ganchos existe en este disco y no depende del PATH de tu terminal.",
  "memory.notDurable": "El comando de los ganchos no se encuentra sin el PATH de tu terminal: fallan en silencio. Vuelve a instalarlos.",
  "memory.durableUnknown": "No hay ganchos nuestros que juzgar.",
  /*
    Delivery counters. Every figure closes its sentence; the chain reads top-down (§6.4): no
    offer, no reception to count. Failed sends are printed only when there is one.
   */
  "memory.deliveryTitle": "Entregas de memoria",
  "memory.offers": "Ofertas preparadas: {n}",
  "memory.receptionsFull": "Recibidas enteras: {n}",
  "memory.receptionsPartial": "Recibidas en parte: {n}",
  "memory.receptionsUnknown": "Recepción sin comprobar: {n}",
  "memory.receptionsNotObserved": "No observadas en el registro: {n}",
  "memory.unbound": "Sin sesión atada: {n}",
  "memory.attemptsFailed": "Envíos fallidos: {n}",
  "memory.quarantined": "El diario de borrados no cuadra con el catálogo: no se entrega ni se captura memoria hasta reconciliarlo.",
  "memory.quarantineReason": "Motivo: {reason}",
  "memory.captureOn": "Lectura de recibos: activa.",
  "memory.captureOff": "Lectura de recibos: sin permiso. Sin ella no hay recepciones que contar.",
  "memory.captureLink": "Permisos por fuente",
  "memory.deliveriesTitle": "Entregas",
  "memory.deliveriesHint": "Lo último que se preparó para un agente: qué unidades viajaron, por qué canal y si el registro de la sesión las contiene. Aquí no se repite el texto; cada unidad enlaza con su ficha.",
  "memory.deliveriesEmpty": "Ninguna entrega registrada todavía.",
  "memory.channelBrief": "al abrir la sesión",
  "memory.channelSignal": "señal al editar",
  "memory.channelMcp": "MCP",
  "memory.channelHandoff": "relevo",
  "memory.statusReady": "Lista.",
  "memory.statusConflict": "Dos decisiones activas se contradicen.",
  "memory.statusUnavailable": "No disponible.",
  "memory.receptionFull": "Recibida entera.",
  "memory.receptionNotObserved": "No se observó en el registro.",
  "memory.receptionNone": "Sin recibo todavía.",
  "memory.attemptSent": "enviada",
  "memory.attemptFailed": "el envío falló",
  "memory.attemptUnknown": "envío sin resultado",
  "memory.purgedOffer": "Contenido eliminado; queda el registro de que existió.",
  "memory.offerUnbound": "sin sesión atada",
  "memory.unitsTravelled": "Unidades entregadas: {n}",
  "memory.unitsReferenced": "Solo referenciadas, para leer aparte: {n}",
  "memory.unitsIntact": "Unidades intactas en el registro: {intact} de {total}",
  "memory.kindNote": "nota",
  "memory.kindCriterion": "criterio",
  "memory.kindDecision": "decisión",
  "memory.kindCommitment": "compromiso",
  "memory.kindCase": "caso",
  "memory.revision": "rev. {rev}",
  "memory.openUnit": "Abrir",
  "memory.omissionChannelLimit": "No cupieron en el canal: {count}",
  "memory.omissionUnresolvedScope": "Sin proyecto que nombrar: {count}",
  "memory.omissionConflict": "Retenidas por contradicción: {count}",
  "memory.omissionIncompleteCore": "Necesarias que no cupieron: {count}",
  "memory.omissionOther": "{reason}: {count}",
  "memory.openStatus": "Ver informe de entregas (JSON)",
  /* The bridge's reading of the whole catalog: installed, executed, observable, backlog. */
  "memory.bridgeTitle": "Memoria entregada",
  "memory.bridgeLead": "Lo que sabemos de la entrega, cada cosa por su prueba: instalado no es ejecutado, y ejecutado no es recibido.",
  "memory.judged": "Proyectos con configuración de Claude Code: {n}",
  "memory.eventCounts": "instalado: {installed} · versión anterior: {legacy} · falta: {missing}",
  "memory.durableCount": "Comando comprobado en el disco: {yes} · no encontrado: {no}",
  "memory.hostsTitle": "Programas observados",
  "memory.hostVersion": "versión {version}",
  "memory.hostVersionUnknown": "versión desconocida",
  "memory.invocationObserved": "ejecución observada",
  "memory.invocationFailed": "la última ejecución falló",
  "memory.invocationUnknown": "ejecución no observada",
  "memory.receiptVerified": "recepción observable",
  "memory.receiptUnsupported": "sin recibo posible",
  "memory.receiptUnknown": "recepción no verificada",
  "memory.hostConfigured": "configurado",
  "memory.hostNotConfigured": "sin configurar del todo",
  "memory.captureSources": "Fuentes con lectura de recibos: {n}",
  "memory.backlogBlocked": "Intervalos bloqueados: {count}",
  "memory.pointers": "Punteros de sesión en cola: {n}",
  /*
    The jobs block of the project card (delivery B): each job is one window of captured activity
    the processor sends to the model, and the card says its status, its attempts, what it paid
    for, why it stopped, and offers the two verbs the door takes with the row's revision. No
    internal name reaches the controls (plan §20.4): «staged» is «saved, not yet added», a lease
    is «the worker did not come back in time».
   */
  "memory.jobsTitle": "Trabajos de extracción",
  "memory.jobsHint": "Cada trabajo es una ventana de la actividad capturada que se envía al modelo para proponer memoria; toda propuesta espera tu aprobación arriba. Reintentar nunca salta la cuota.",
  "memory.jobsEmpty": "Ningún trabajo todavía.",
  "memory.jobsMore": "Hay trabajos más antiguos que no caben en esta página.",
  "memory.jobAttempts": "Intentos: {n}",
  "memory.jobPaid": "Llamadas pagadas: {n}",
  "memory.jobIntervals": "Intervalos: {n}",
  "memory.jobRetryAt": "Reintento previsto: {date}",
  "memory.jobPublished": "Publicado: notas {notes} · decisiones {episodes}",
  "memory.jobRetry": "Reintentar",
  "memory.jobCancel": "Cancelar",
  "memory.jobSaving": "Guardando…",
  "memory.jobStatusPending": "en cola",
  "memory.jobStatusRunning": "en curso",
  "memory.jobStatusStaged": "guardado, sin incorporar",
  "memory.jobStatusDeferred": "aplazado",
  "memory.jobStatusFailed": "falló",
  "memory.jobStatusComplete": "incorporado",
  "memory.jobStatusCancelled": "cancelado",
  "memory.jobStatusObsolete": "invalidado",
  "memory.processorLegacy": "sesión entera",
  "memory.processorExtract": "ventana del proyecto",
  "memory.originLegacy": "versión anterior",
  "memory.originManual": "a mano",
  "memory.originAutomatic": "automático",
  "memory.reasonBudget": "la cuota del día se agotó",
  "memory.reasonSubquota": "la cuota automática del día se agotó",
  "memory.reasonConversation": "esta conversación agotó sus llamadas del día",
  "memory.reasonQueueFull": "la cola de revisión está llena; el resultado espera guardado",
  "memory.reasonQuota": "la cuota de almacenamiento está alcanzada; el trabajo espera",
  "memory.reasonProvider": "no hay proveedor configurado; la ventana espera una hora",
  "memory.reasonPaused": "el gasto está en pausa",
  "memory.reasonSourceChanged": "la fuente cambió antes del envío",
  "memory.reasonUnusable": "la respuesta no sirvió",
  "memory.reasonUnreadable": "la respuesta no se pudo leer",
  "memory.reasonExtractionFailed": "la llamada falló",
  "memory.reasonPublishFailed": "la publicación falló",
  "memory.reasonUnavailable": "el catálogo no estaba disponible",
  "memory.reasonPaidCeiling": "se alcanzó el tope de llamadas pagadas de esta ventana",
  "memory.reasonDuplicateAttempt": "intento repetido",
  "memory.reasonLeaseExpired": "el trabajador no volvió a tiempo",
  "memory.reasonPermissionRevoked": "el permiso se retiró",
  "memory.reasonSourcePurged": "la fuente se purgó",
  "memory.reasonWindowOvertaken": "otra ventana ya cubrió estos bytes",
  "memory.reasonExtracted": "extraído",
  "memory.reasonDistilled": "destilado",
  "memory.reasonThin": "sin material suficiente",
  "memory.reasonUnpublished": "sin nada que publicar",
  "memory.reasonCancelled": "cancelado a mano",
  /*
    Delivery D: the three processors of the Twin's continuous learning and the outbox that writes
    the files, with the reasons each of them stamps. A processor word is what a person reads on a
    job row of the project card; the reasons say what happened without an internal name — a job
    whose file moved under it is «the file changed», never a lease or a hash.
   */
  "memory.processorTwinDistill": "lectura del Twin",
  "memory.processorTwinClassify": "clasificación del Twin",
  "memory.processorTwinSynthesize": "síntesis del Twin",
  "memory.processorTastePublish": "publicación del retrato",
  "memory.reasonCallFailed": "la llamada al proveedor falló",
  "memory.reasonBadManifest": "el trabajo no llevaba un encargo válido",
  "memory.reasonInputChanged": "la evidencia cambió durante la llamada",
  "memory.reasonTasteFull": "el retrato no cabe en el fichero",
  "memory.reasonWriteMismatch": "lo escrito no coincidió con lo leído después",
  "memory.reasonBlockBroken": "el bloque gestionado del fichero está roto",
  "memory.reasonNotManaged": "el fichero no tiene bloque gestionado",
  "memory.reasonRevisionsMoved": "los criterios cambiaron antes de escribirlos",
  "memory.reasonPermissionChanged": "el permiso cambió antes de escribir",
  "memory.reasonProjectGone": "el proyecto ya no está en el catálogo",
  "memory.reasonUnreconciled": "el fichero no se pudo reconciliar a tiempo",
  "memory.reasonClassified": "clasificado",
  "memory.reasonSynthesized": "sintetizado",
  "memory.reasonUnchanged": "sin cambios que pagar",
  "memory.reasonPublished": "escrito en el fichero",
  "memory.jobReasonOther": "{reason}",
  "memory.jobNotRetryable": "Ese trabajo ya es definitivo: no hay nada que reintentar ni cancelar.",
  "memory.jobStale": "El trabajo cambió desde que se cargó la pantalla. Recárgala y decide de nuevo.",
  "memory.jobUnknown": "Ese trabajo ya no existe en el catálogo.",
  "memory.jobFailed": "No se pudo cambiar el trabajo.",
  "memory.openJobs": "Ver trabajos (JSON)",
  /* The extraction's capacity (plan §8.5) and what waits to be windowed. */
  "memory.pendingBytes": "Actividad capturada sin extraer: {size}",
  "memory.oldestPending": "Lo más antiguo pendiente: {date}",
  "memory.attemptsPerWindow": "Llamadas pagadas por ventana incorporada: {n}",
  "memory.capacityHint": "La cola guarda el trabajo y nada se pierde. Decide si estrechar las fuentes, subir la cuota en /spend o dejarlo correr.",
  /* The typed facts of delivery B, by kind; never a command line, a message or a reply. */
  "memory.factsTitle": "Hechos capturados",
  "memory.factsHint": "Lo que la captura anotó de las sesiones de este proyecto, por clase. Nunca una línea de comando, un mensaje ni una respuesta.",
  "memory.factsEmpty": "Ningún hecho todavía: hacen falta el aviso 2 de la captura y una sesión posterior.",
  "memory.factRead": "Lecturas: {n}",
  "memory.factEdit": "Ediciones: {n}",
  "memory.factCommand": "Comandos, por familia: {n}",
  "memory.factTestResult": "Resultados de tests: {n}",
  "memory.factFailure": "Fallos: {n}",
  "memory.factCommit": "Commits: {n}",
  "memory.factLifecycle": "Ciclo de vida: {n}",
  "memory.factReceiptSeen": "Recibos vistos: {n}",
  /*
    Delivery C: what the disk showed. A check is a definition on a note, a decision or a
    commitment, and the patrol's look at it says `pass`, `fail` or `unknown` with its reason —
    never obeyed or ignored (plan §23.4): a look states the disk at one instant in one worktree,
    nothing about what an agent did with the rule. A look that could not read is a gap and says
    so; a check nobody looked at yet says that too.
   */
  "memory.checksTitle": "Comprobaciones",
  "memory.checkPass": "pasa",
  "memory.checkFail": "falla",
  "memory.checkUnknownResult": "desconocido",
  "memory.checkNotObserved": "sin observar todavía",
  "memory.checkStale": "no reciente",
  "memory.checkEarlierItem": "observado en una revisión anterior de este elemento",
  "memory.checkEarlierDefinition": "observado con una definición anterior",
  "memory.checkLegacy": "ancla de primera generación",
  "memory.checkLookedAt": "mirado {date}",
  "memory.checksUnreadable": "Las comprobaciones de este elemento no se pudieron leer.",
  "memory.checkCoverage": "Archivos inspeccionados: {inspected} · sin resolver: {unknown}",
  "memory.checkObserved": "visto: {observed}",
  "memory.purposeGrounds": "fundamento",
  "memory.purposeApplicability": "aplicabilidad",
  "memory.purposeViolation": "infracción",
  "memory.purposeCompletion": "finalización",
  "memory.checkPathExists": "existe {target}",
  "memory.checkPathAbsent": "no existe {target}",
  "memory.checkFileHash": "{target} con la huella {digest}…",
  "memory.checkTextPresent": "literal presente en {target}; caracteres: {chars}",
  "memory.checkTextAbsent": "literal ausente de {target}; caracteres: {chars}",
  "memory.checkManifestScript": "script {name} en {target}",
  "memory.checkDirectDependency": "dependencia {name} ({ecosystem}) en {target}",
  "memory.checkDirectDependencyVersion": "dependencia {name} ({ecosystem}) en {target}, versión {version}",
  "memory.checkStructuredKey": "clave {path} en {target}",
  "memory.checkReasonLimitReached": "se alcanzó un límite de lectura",
  "memory.checkReasonMalformed": "el documento no se pudo interpretar",
  "memory.checkReasonOutsideRoot": "la ruta sale del proyecto",
  "memory.checkReasonUnreadable": "el archivo no se pudo leer",
  "memory.checkReasonMissing": "el archivo no existe",
  "memory.checkReasonExists": "la ruta existe",
  "memory.checkReasonAbsent": "la ruta no existe",
  "memory.checkReasonPresent": "el literal está",
  "memory.checkReasonHashMatch": "la huella coincide",
  "memory.checkReasonHashMismatch": "la huella cambió",
  "memory.checkReasonScriptDefined": "el script está definido",
  "memory.checkReasonScriptMissing": "el script no está",
  "memory.checkReasonScriptDiffers": "el script es otro",
  "memory.checkReasonDependencyDeclared": "la dependencia está declarada",
  "memory.checkReasonDependencyMissing": "la dependencia no está",
  "memory.checkReasonVersionDiffers": "la versión es otra",
  "memory.checkReasonKeyPresent": "la clave está",
  "memory.checkReasonKeyMissing": "la clave no está",
  "memory.checkReasonValueMatches": "el valor coincide",
  "memory.checkReasonValueDiffers": "el valor es otro",
  "memory.checkReasonOther": "{reason}",
  "memory.looksLimited": "Se leyeron las ocurrencias más recientes y las anteriores no se muestran; leídas: {n}",
  "memory.looksUnreadable": "Lo que la patrulla observó no se pudo leer: ninguna comprobación de esta tarjeta tiene estado.",
  /* Succession and expiry of a note: a replaced or expired rule stays on the card with its state and its successor. */
  "memory.supersededTitle": "Sustituidas y caducadas",
  "memory.supersededHint": "Ya no viajan a ningún agente. Quedan aquí con su estado y, si la hay, con la regla que las sustituye.",
  "memory.noteSuperseded": "sustituida",
  "memory.noteExpired": "caducada",
  "memory.expiresOn": "caduca el {date}",
  "memory.expiredOn": "caducó el {date}",
  "memory.supersededBy": "sustituida por {id}",
  "memory.supersedes": "sustituye a {id}",
  /* The owner's decisions in force for this project, with their typed conditions and checks. */
  "memory.decisionsTitle": "Decisiones vigentes",
  "memory.decisionsHint": "Las decisiones tuyas que este proyecto recibe ahora mismo, con sus condiciones tipadas y el estado de sus comprobaciones. La ficha completa está en tu Twin.",
  "memory.decisionsEmpty": "Ninguna decisión vigente para este proyecto.",
  "memory.decisionsUnreadable": "Las decisiones no se pudieron leer.",
  "memory.decisionNoText": "Sin texto de decisión registrado.",
  "memory.decisionConditions": "condiciones: {text}",
  "memory.decisionExceptions": "excepciones: {text}",
  "memory.openDecision": "Abrir la ficha",
  /*
    Commitments (plan §9.4): a human obligation with a version. Its state and its observations
    are two things — a failing criterion never closes it, a passing one never closes it by
    itself — and only the owner, or a completion criterion the owner approved, fulfils it. A
    closed commitment is never reopened: a new one continues it.
   */
  "memory.commitmentsTitle": "Compromisos",
  "memory.commitmentsHint": "Obligaciones tuyas con versión. Lo que la patrulla observa de sus criterios vive aparte y nunca cambia su estado: solo tú lo cierras, o un criterio de finalización que aprobaste y que pasó entero. Uno cerrado no se reabre; otro lo continúa.",
  "memory.commitmentsEmpty": "Ningún compromiso todavía.",
  "memory.commitmentsUnreadable": "Los compromisos no se pudieron leer.",
  "memory.commitmentsMore": "Hay compromisos más antiguos que no caben en esta lista.",
  "memory.commitmentOpen": "abierto",
  "memory.commitmentFulfilled": "cumplido",
  "memory.commitmentCancelled": "cancelado",
  "memory.commitmentByOwner": "escrito por ti",
  "memory.commitmentByAgent": "escrito por un agente",
  "memory.commitmentTask": "tarea {id}",
  "memory.commitmentConditions": "condiciones: {text}",
  "memory.commitmentCriteria": "Criterios de finalización",
  "memory.commitmentNoCriteria": "Sin criterios de finalización: solo tú puedes darlo por cumplido.",
  "memory.commitmentChecks": "Otras comprobaciones",
  "memory.commitmentObservations": "Observaciones: {total} · pasan: {passed} · fallan: {failed} · desconocidas: {unknown}",
  "memory.commitmentIncidents": "Incidencias: {n}",
  "memory.commitmentRecent": "Las últimas observaciones",
  "memory.commitmentResolvedOwner": "cerrado por ti",
  "memory.commitmentResolvedChecks": "cumplido por sus criterios",
  "memory.commitmentReason": "motivo: {reason}",
  "memory.commitmentContinues": "continúa {id}",
  "memory.commitmentContinuedBy": "continuado por {id}",
  "memory.commitmentFulfil": "Dar por cumplido",
  "memory.commitmentCancel": "Cancelar",
  "memory.commitmentSaving": "Guardando…",
  "memory.commitmentClosed": "Ese compromiso ya está cerrado: no se reabre, no se revisa y no se cancela. Crea otro que lo continúe.",
  "memory.commitmentFailed": "No se pudo cambiar el compromiso.",
  "memory.openCommitments": "Ver compromisos (JSON)",
  /*
    Incidents (plan §9.3): a fail the patrol recorded on a rule that stays in force, with its
    own identity. The owner has two words for it — confirmed, or a false alarm — and the screen
    offers exactly those; it shows what the look could not cover and never says obeyed or
    ignored.
   */
  "memory.incidentsTitle": "Incidencias",
  "memory.incidentsHint": "Lo que la patrulla vio fallar en el disco sobre una regla que sigue vigente. Tu palabra: confirmarla o marcarla como falsa alarma. Una incidencia dice lo que había en el disco, no lo que hizo un agente.",
  "memory.incidentsEmpty": "Ninguna incidencia.",
  "memory.verdictConfirmed": "confirmada",
  "memory.verdictFalsePositive": "falsa alarma",
  "memory.verdictNone": "sin juicio",
  "memory.incidentOn": "sobre {kind} {id}",
  "memory.incidentRows": "Observaciones de esta ocurrencia: {n}",
  "memory.incidentHead": "HEAD {head}",
  "memory.deliveredBeforeYes": "esa revisión se había entregado antes en ese contexto",
  "memory.deliveredBeforeNo": "esa revisión no se había entregado antes en ese contexto",
  "memory.deliveredBeforeUnknown": "sin constancia de una entrega previa en ese contexto",
  "memory.incidentFailed": "No se pudo registrar el juicio.",
  "memory.openOutcomes": "Ver observaciones (JSON)",
  /*
    The decision case of a task (plan §9.4, §14.1): four columns read from rows that already
    exist. A half the projection could not fill says unknown; no story is written between the
    columns, and what an agent declared never stands in for what was checked.
   */
  "memory.casesTitle": "Casos de decisión",
  "memory.casesHint": "Por tarea: lo pedido, lo decidido, lo declarado por el agente y lo comprobado. Un hueco se dice como tal y no se rellena con una historia.",
  "memory.casesEmpty": "Ninguna tarea todavía.",
  "memory.caseOpen": "Ver el caso",
  "memory.caseClose": "Cerrar el caso",
  "memory.caseLoading": "Leyendo…",
  "memory.caseFailed": "No se pudo leer el caso.",
  "memory.caseCommitments": "Compromisos: {n}",
  "memory.caseAsked": "Pedido",
  "memory.caseDecided": "Decidido",
  "memory.caseDeclared": "Declarado",
  "memory.caseChecked": "Comprobado",
  "memory.caseUnknown": "desconocido",
  "memory.caseUnknownFields": "Sin dato: {list}",
  "memory.caseDecidedNote": "Las decisiones tuyas vigentes en el proyecto al leer; no una consecuencia de esta tarea.",
  "memory.caseDeclaredNote": "Lo que el agente anotó en su cuaderno mientras tenía la tarea. Es una declaración, no una comprobación.",
  "memory.caseCheckedNote": "Los compromisos de esta tarea con lo que la patrulla observó. Una observación nunca cierra un compromiso.",
  "memory.caseAskedAt": "pedido {date}",
  "memory.caseDecidedAt": "decidido {date}",
  "memory.caseObservedAt": "observado {date}",
  "memory.caseLooks": "miradas iguales en esta ocurrencia: {n}",
  "memory.caseByAgent": "agente: {agent}",
  "memory.caseSummary": "resumen de sesión",
  "memory.caseSession": "sesión {id}",
  /* The refusals of the C doors, by code. */
  "memory.invalidCheck": "Esa comprobación no tiene una forma que el catálogo acepte.",
  "memory.notFound": "Eso ya no existe en el catálogo. Recarga la pantalla.",
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
  /*
    What `@panoma/ai` says when the failure is panoma's own, in the reader's language.

    That package used to throw fixed Spanish, and both of its readers got the wrong one: the
    terminal prints `error.message` raw and is a machine surface, where the rule is English; the
    browser is bilingual and got Spanish either way. It carries a typed `failure` now, so these are
    keyed on its code and not on its prose — the previous half-fix matched the Spanish sentence
    «proveedor de IA» as if it were a key, which would have stopped working, silently, the first
    time anybody reworded it.

    What a provider said is not here. A 429, a refusal, someone else's API text: those arrive
    inside `{detail}` and travel whole, because translating a quote is inventing one.
   */
  "aiFail.noCommand": "{provider} no declara ningún comando que ejecutar.",
  "aiFail.launchFailed": "No se pudo lanzar {command}: {reason}",
  "aiFail.exited": "{provider} terminó con código {status}. {detail}",
  "aiFail.emptyBody": "{provider} contestó sin cuerpo.",
  "aiFail.providerRefused": "{provider} respondió {status}: {detail}",
  "aiFail.tokenRefused": "{provider} rechazó la petición de token ({status}): {detail}",
  "aiFail.neverAnswered": "{provider} no llegó a contestar: {detail}. No es que el modelo dijera que no — la petición no salió de esta máquina. Intentos: {attempts}",
  "aiFail.configShape": "El contenido no tiene la forma de una configuración de panoma.",
  "aiFail.configLocked": "Otro proceso de panoma está escribiendo la configuración. Si no hay ninguno corriendo, el cerrojo se quedó de una ejecución anterior: bórralo con {detail}",
  "aiFail.noProvider": "No hay ningún proveedor de IA configurado.",
  "aiFail.unknownProvider": "Proveedor desconocido: {provider}",
  "aiFail.oauthTimeout": "Se agotó el plazo esperando a que volvieras del navegador.",
  "aiFail.noOauth": "{provider} no usa inicio de sesión.",
  "aiFail.badUrl": "La dirección de {provider} no es una URL válida: «{detail}». Revisa {where}.",
  "aiFail.notHttp": "La dirección de {provider} tiene que ser http o https.",
  "aiFail.urlHasCredentials": "La dirección de {provider} lleva usuario o contraseña dentro. Quítalos y usa la clave.",
  "aiFail.insecureHost": "panoma no manda la credencial de {provider} sin cifrar a {detail}. Usa https, o un servidor en tu propia máquina.",
  "aiFail.visionUnsupported": "{provider} no sabe recibir imágenes. Conecta un proveedor con clave, o pásale uno con --provider.",
  "aiFail.configCorrupt": "No se pudo leer la configuración de IA en {detail}.",
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
    "Las miradas de hoy están gastadas: {used} de {cap}. Vuelven mañana, o sube el tope en la pantalla de gasto (/spend) o con PANOMA_LOOK_BUDGET.",
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
  /*
    One sentence for the two ways a capture does not get looked at, because they end the same: the
    file that cannot be opened, and the one that was opened and does not fit in a call. `{detail}`
    is what tells them apart —the name, the size, and the reason it could not be reduced— and it is
    what makes the refusal actionable instead of a shrug.
   */
  "look.unreadableShot":
    "Esa captura no se pudo mirar: {detail}. La habrán borrado, o pesa más de lo que se puede enviar.",
  /*
    The body, not the capture: it arrives cut and every field goes missing at once, so without
    this the route answered «you didn't say which project» to a file that was simply too big.
   */
  "look.unreadableBody":
    "No se pudo leer la petición. Si llevaba una captura, pesa más de lo que este servidor acepta de una vez.",

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
  /*
    What the critic will be shown, said before paying and again on the receipt.
    Panoma refused for months to shrink a capture, and the reason is still written in
    `screenshot.ts`: reducing what a model is going to judge, without saying so, changes the
    judgment behind the back of whoever asked for it. The choice on the Spend screen does not
    erase that reason, it honours it — and that is why the reason a capture travels whole is
    written in the same size of letter as the yes.
   */
  "look.fitSent": "reducida para el crítico · lo que ve: {size} · lo que hay en el fichero: {from}",
  "look.fitWhole": "pediste reducirla y viaja entera: {why}",
  "look.fitAsked": "pediste reducirla: su lado largo será como mucho de {edge} px",
  "look.whyFormat": "no es un PNG, y aquí solo se sabe reducir un PNG",
  "look.whyVariant": "es un PNG escrito de una forma que panoma no sabe leer",
  "look.whyAlready": "ya es más pequeña que ese tamaño",
  "look.whyBroken": "no se ha podido leer para reducirla",
  "look.whyHuge": "tiene más píxeles de los que caben en memoria para reducirla",
  /*
    The sixth case, which is not a refusal: the reduction worked and what came out still does not
    fit. A screen of noise or of photography compresses badly, and the person needs to know that
    re-exporting the format would change nothing.
   */
  "look.stillBig": "se redujo a {width}×{height} y aun así no cabe",
  /*
    The same refusal when the reason IS known. `look.unreadableShot` ends guessing —«la habrán
    borrado, o pesa más de lo que se puede enviar»— and that guess is right for a file that
    vanished and wrong next to a detail that already says exactly what happened. One sentence
    guesses, the other does not, and the route picks by whether it has something to say.
   */
  "look.shotRefused": "Esa captura no se pudo mirar: {detail}.",
  "look.shotsFull": "el crítico ve la captura tal cual, sin tocarla",
  "look.shotsFit": "el crítico la ve reducida, con un lado largo como mucho de {edge} px",
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
  /*
    Which of the two ceilings is in force here, and why it is that one. The number comes from the
    server —`readCeiling` picks it with what the Spend screen saved— so that the browser never
    refuses what the server would have accepted.
   */
  "look.uploadCapFit": "Se reduce antes de viajar, así que aquí se admite un fichero de hasta {cap}.",
  "look.uploadCapFull": "Viaja tal cual, así que aquí se admite un fichero de hasta {cap}.",
  "look.uploadTarget": "Proyecto al que subir la captura",
  "look.badType": "Eso no es una imagen de las que se pueden mirar: PNG, JPEG, WebP o GIF.",
  /*
    The advice changed with the second ceiling. «Export it as JPEG» was right when the only cap
    was the provider's and nothing here could shrink anything; today a JPEG is precisely what
    panoma cannot reduce, so it would travel whole and be refused again. What does work is asking
    for reduced captures, which is a switch on another screen, so the sentence names it.
   */
  "look.tooBig":
    "Esa imagen pesa {size} y el tope está en {cap}. Recórtala, o pide capturas reducidas en la pantalla de gasto (/spend) y cabrán las grandes.",
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
  "twinTeach.nav": "Explorar Twin",
  "twinTeach.navMemory": "Memoria de decisiones",
  "twinTeach.navTeach": "Enseñar",
  "twinTeach.navLab": "Ensayar una decisión",
  "twinTeach.navPortrait": "Mi retrato",
  "twinTeach.navHistory": "Aprender del historial",
  "twinTeach.details": "Evidencia, actividad y resultados",
  "twinTeach.signed": "Criterios firmados",
  "twinTeach.standing": "Inferencias con respaldo",
  "twinTeach.published": "Frases en el retrato",
  "twinTeach.portraitTitle": "El criterio que estás construyendo",
  "twinTeach.portraitEmpty": "Tu primera regla aparecerá aquí. Puedes escribirla arriba o permitir que Twin aprenda de tus conversaciones.",
  "twinTeach.eyebrow": "ENSEÑANZA DIRECTA",
  "twinTeach.ownerEvidence": "Escrito directamente por ti",
  "twinTeach.title": "Empieza por lo que tienes claro",
  "twinTeach.lead": "Escribe una regla concreta sobre cómo quieres que quede tu trabajo. Twin la guarda como un criterio firmado por ti y puedes limitarla a un proyecto.",
  "twinTeach.control": "Tu regla entra en TASTE.md. Puedes editarla o vetarla en tu retrato; la síntesis no puede reescribir lo que has firmado.",
  "twinTeach.statement": "Mi criterio",
  "twinTeach.placeholder": "Por ejemplo: Prefiero editar en la misma pantalla antes que abrir un modal para cambios pequeños.",
  "twinTeach.characters": "Caracteres: {n} / {max}",
  "twinTeach.topic": "Tema",
  "twinTeach.scope": "Dónde se aplica",
  "twinTeach.global": "En todos mis proyectos",
  /*
    Why the menu is shorter than the catalog. `TASTE.md` writes a scope as a NAME, so a rule can
    only name a project whose name belongs to it alone — on this disk that leaves 26 of 75, because
    twenty folders are called `kiosk_new` and thirteen `leaselab`. Those options used to be
    offered and every one of them failed after the press. Removing them without a word would teach
    the rule to nobody, so the count goes here, and the number closes the sentence.
   */
  "twinTeach.scopeOmitted":
    "Solo salen los proyectos con un nombre que no repite ningún otro: TASTE.md acota por nombre, y un nombre repetido acotaría en todos a la vez. Fuera por eso: {n}",
  "twinTeach.save": "Firmar y guardar",
  "twinTeach.saving": "Guardando criterio…",
  "twinTeach.cost": "Sin llamadas a modelos",
  "twinTeach.contextRules": "Condiciones y excepciones (opcional)",
  "predicate.and": " y ",
  "predicate.or": " o ",
  "predicate.not": "no ({value})",
  "predicate.project": "el proyecto es {value}",
  "predicate.path": "la ruta está dentro de {value}",
  "predicate.environment": "el entorno es {value}",
  "predicate.task": "la tarea es de tipo {value}",
  "predicate.operation": "la acción es {value}",
  "predicate.check": "la comprobación {value}, revisión {revision}, indica {result}",
  "predicate.pass": "conforme",
  "predicate.fail": "fallo",
  "predicate.unknown": "desconocido",
  "twinTeach.contextHint": "Si el agente no conoce un dato necesario, el criterio se entrega como condicional. La excepción impide aplicarlo cuando se cumple.",
  "twinTeach.conditions": "Aplicar cuando",
  "twinTeach.exceptions": "Excepto cuando",
  "twinTeach.match": "Coincidencia",
  "twinTeach.matchAll": "Se cumplen todas",
  "twinTeach.matchAny": "Se cumple alguna",
  "twinTeach.contextKind": "Dato del contexto",
  "twinTeach.operation": "Acción",
  "twinTeach.path": "Ruta del proyecto",
  "twinTeach.taskKind": "Tipo de tarea",
  "twinTeach.pathValue": "Ruta relativa, sin comodines",
  "twinTeach.taskValue": "Tipo de tarea declarado por el agente",
  "twinTeach.opRead": "Leer",
  "twinTeach.opEdit": "Editar",
  "twinTeach.opTest": "Probar",
  "twinTeach.opBuild": "Compilar",
  "twinTeach.opDeploy": "Desplegar",
  "twinTeach.opReview": "Revisar",
  "twinTeach.opOther": "Otra acción",
  "twinTeach.negate": "Negar esta condición",
  "twinTeach.removeCondition": "Quitar condición",
  "twinTeach.addCondition": "Añadir condición",
  "twinTeach.saved": "Criterio firmado y guardado en tu retrato.",
  "twinTeach.view": "Ver criterio",
  "twinTeach.failed": "No se pudo guardar el criterio. Tu texto sigue aquí.",
  "twinTeach.invalid": "Escribe un criterio de hasta 300 caracteres y elige un tema válido.",
  "twinTeach.scopeError": "Este proyecto necesita una identidad estable y un nombre único antes de poder limitarle un criterio.",
  "twinLab.eyebrow": "LABORATORIO DE DECISIONES",
  "twinLab.title": "¿Cómo resolvería esto tu Twin?",
  "twinLab.lead": "Plantea una decisión de tu trabajo. Primero inspecciona los criterios disponibles; después ensaya una respuesta respaldada por ellos.",
  "twinLab.question": "La decisión",
  "twinLab.placeholder": "¿Edición inline o un modal para cambiar el nombre de un proyecto?",
  "twinLab.questionHint": "Una elección concreta, con el contexto necesario.",
  "twinLab.characters": "Caracteres: {n} / {max}",
  "twinLab.project": "Contexto del proyecto",
  "twinLab.global": "Solo mi criterio general",
  "twinLab.scopeHint": "Al elegir un proyecto se incluyen también sus reglas específicas.",
  "twinLab.preview": "Explorar criterios",
  "twinLab.previewing": "Buscando criterios…",
  "twinLab.previewCost": "Consulta local, sin llamar al modelo",
  "twinLab.drafting": "Ensayando la decisión…",
  "twinLab.draftReady": "Ensayo listo",
  "twinLab.abstained": "Twin se abstuvo",
  "twinLab.evidenceCount": "Criterios disponibles: {n}",
  "twinLab.waiting": "CRITERIO ANTES DE RESPONDER",
  "twinLab.emptyTitle": "Una decisión, con sus razones a la vista",
  "twinLab.emptyBody": "Verás las reglas firmadas, las inferencias con respaldo y los episodios de decisión que encajen, con sus condiciones y excepciones. La búsqueda es local; la respuesta del modelo se pide después.",
  "twinLab.firstTitle": "Dale un primer criterio para empezar",
  "twinLab.noBeliefs": "No hay criterios aplicables ni episodios de decisión que encajen en este contexto. Registra una decisión, enséñale una regla o añade más contexto a la pregunta.",
  "twinLab.noMatch": "Los criterios disponibles no resuelven esta decisión. Añade el contexto que falta o enséñale cómo la resolverías.",
  "twinLab.unsupported": "La respuesta no aportó citas válidas suficientes. No se presenta como una decisión respaldada por tu criterio.",
  "twinLab.abstainedTitle": "Aún no puede decidir con tu criterio",
  "twinLab.draftTitle": "Lo que respondería",
  "twinLab.draftHint": "Comprueba que estas razones representan la decisión que tú tomarías.",
  "twinLab.citations": "Criterios citados",
  "twinLab.evidence": "Criterios que recibirá el modelo",
  "twinLab.openEvidence": "Abrir criterio en mi retrato",
  "twinLab.projectRule": "Solo en {project}",
  "twinLab.globalRule": "En todos mis proyectos",
  "twinLab.omitted": "Fuera del espacio de esta consulta: {n}",
  "twinLab.remaining": "Ensayos disponibles hoy: {n}",
  "twinLab.rehearse": "Ensayar esta decisión",
  "twinLab.draftCost": "Gasta un ensayo del presupuesto diario propio del Laboratorio, con tu modelo configurado. Comparte la pregunta y los criterios mostrados.",
  "twinLab.budgetReached": "Se agotó el presupuesto diario de ensayos; las preguntas de tus agentes no se ven afectadas. Puedes seguir explorando criterios sin coste, o subir el tope en la pantalla de gasto (/spend).",
  "twinLab.boundary": "Este ensayo no se guarda como evidencia, no modifica tu retrato y no responde a ningún agente. Tu Twin sigue en entrenamiento.",
  "twinLab.teach": "Enseñar un criterio",
  "twinLab.invalidRequest": "Escribe una decisión de hasta {max} caracteres y elige un proyecto válido.",
  "twinLab.failed": "No se pudo completar el ensayo. Vuelve a intentarlo.",
  "twinLab.episode": "Episodio de decisión",
  "twinLab.openEpisode": "Abrir la memoria de decisiones",
  "twinLab.episodeScope": "Se aplica en las condiciones registradas; revisa la fuente antes de generalizar.",
  "twinLab.disagree": "¿No estás de acuerdo? Enséñale el criterio que aplicarías.",
  /*
    What the decision-memory routes answer. They are read in the browser, by the person, so they
    go through the dictionary like every other route's error; the code travels beside the text so
    the screen can act on it without parsing prose.
   */
  "twinMemory.errBody": "Envía un registro de decisión.",
  "twinMemory.errFields": "Usa solo los campos reconocidos y no pases del límite de cada campo: {max}.",
  "twinMemory.errPurpose": "Registra una meta o una decisión para que el episodio tenga sentido.",
  "twinMemory.errStatus": "Indica el identificador del episodio y un estado: activo o descartado.",
  "twinMemory.errRevision": "Una revisión debe indicar el episodio anterior y conservar su proyecto.",
  "twinMemory.errProject": "Elige un proyecto válido.",
  "twinMemory.errUnstable": "Este proyecto todavía no tiene una identidad estable.",
  "twinMemory.errPreviousMissing": "El episodio que revisas ya no está disponible.",
  "twinMemory.errDismissedDuplicate": "Este episodio ya existe entre los descartados. Muéstralos y restáuralo o revísalo allí.",
  "twinMemory.errActiveSuccessor": "Hay otra versión activa de esta decisión. Ábrela o descártala antes de restaurar o revisar esta.",
  "twinMemory.errValidUntil": "Indica el último día en que se aplica esta decisión con el formato AAAA-MM-DD, o quítalo.",
  "twinMemory.errNotFound": "Episodio de decisión no encontrado.",
  "twinMemory.errInvalidId": "Identificador de episodio no válido.",
  "twinMemory.learnFlag": "El único parámetro admitido es dryRun, y debe ser verdadero o falso.",
  "twinMemory.learnBudget": "Se agotó el presupuesto diario de la memoria de decisiones. Mañana vuelve a haber, o antes si subes el tope en la pantalla de gasto (/spend).",
  "twinMemory.learnStale": "El material de origen o su atribución cambió durante el análisis. Actualiza el material pendiente antes de reintentar.",
  "twinMemory.learnUnsupported": "El modelo devolvió campos sin respaldo. El material sigue pendiente, y este pase lo aparta para leer otros primero.",
  "twinMemory.learnCut": "La respuesta del modelo se cortó en el límite de salida antes de cerrarse. El material sigue pendiente, y se aparta para leer otros primero.",
  /*
    The decision-memory screen itself. It shipped on 5-Sep-2026 with every sentence written into
    the component in English, under a `lang="en"` that declared the box monolingual on purpose;
    `components/twin-bilingual.test.ts` keeps it from happening again. Coverage is named, never
    scored: the screen lists the dimensions that were recorded and the ones that were not, and no
    key here says a percentage or the word confidence.
   */
  "twinMemory.eyebrow": "Decisiones, con sus razones",
  "twinMemory.title": "Memoria de decisiones",
  "twinMemory.lead": "Guarda la meta, las renuncias y las excepciones que hay detrás de una elección. Lo que falte se queda como desconocido hasta que haya evidencia que lo llene.",
  "twinMemory.captured": "Historial capturado: {n}",
  "twinMemory.awaiting": "Pendiente de análisis: {n}",
  "twinMemory.deferred": "Apartados tras una respuesta inservible, se reintentan después del resto: {n}",
  "twinMemory.passReads": "Registros que un pase puede leer como máximo: {n}",
  "twinMemory.queueDays": "Días para leer la cola con el presupuesto de hoy, como mínimo: {n}",
  "twinMemory.extractionOff": "La extracción está apagada: el presupuesto diario es cero.",
  "twinMemory.savedNew": "Episodio guardado con tus propias palabras.",
  "twinMemory.savedRevision": "Revisión guardada con tus palabras. La versión anterior se conserva entre los episodios descartados.",
  "twinMemory.recentTitle": "Registros de decisión recientes",
  "twinMemory.includeDismissed": "Incluir los descartados en esta vista: {n}",
  "twinMemory.shown": "Registros mostrados: {n}. Esta vista empieza por los más recientes, hasta 100, más cualquier registro abierto directamente; los más antiguos se cargan al final de la lista.",
  "twinMemory.emptyTitle": "Empieza por una decisión que importó.",
  "twinMemory.emptyBody": "Una elección con su razón vale más que una lista de preferencias. Añádela arriba, o captura el historial que has permitido y previsualiza un análisis.",
  "twinMemory.boundary": "Estos episodios conservan contexto. No se convierten solos en reglas firmadas ni aparecen en TASTE.md.",
  "twinMemory.captureTitle": "Registrar una decisión",
  "twinMemory.reviseTitle": "Revisando un episodio guardado",
  "twinMemory.captureHint": "Empieza con una meta o una decisión. Anota solo lo que sabes; los demás campos son opcionales.",
  "twinMemory.reviseHint": "Completa lo que falta o corrige el registro. Al guardar pasa a ser tu testimonio y la versión anterior se conserva como referencia.",
  "twinMemory.characters": "Caracteres: {n} / {max}",
  "twinMemory.projectContext": "Contexto del proyecto",
  "twinMemory.originalProject": "Contexto original del proyecto",
  "twinMemory.noProject": "Sin proyecto concreto",
  "twinMemory.moreFields": "Añadir razones, resultados y excepciones",
  "twinMemory.saving": "Guardando episodio…",
  "twinMemory.saveEpisode": "Guardar episodio",
  "twinMemory.saveRevision": "Guardar revisión",
  "twinMemory.cancelRevision": "Cancelar revisión",
  "twinMemory.localSave": "Se guarda en local · Sin llamada al modelo",
  "twinMemory.unsavedDraft": "Tienes un episodio sin guardar. Guárdalo o límpialo antes de revisar otro.",
  "twinMemory.clearDraft": "Limpiar",
  "twinMemory.fieldGoal": "Meta",
  "twinMemory.hintGoal": "¿Qué querías conseguir?",
  "twinMemory.fieldContext": "Contexto",
  "twinMemory.hintContext": "¿Qué situación marcó esta decisión?",
  "twinMemory.fieldConstraints": "Restricciones",
  "twinMemory.hintConstraints": "¿Qué límites, riesgos o compromisos pesaron?",
  "twinMemory.fieldAlternatives": "Alternativas",
  "twinMemory.hintAlternatives": "¿Qué otros caminos consideraste?",
  "twinMemory.fieldDecision": "Decisión",
  "twinMemory.hintDecision": "¿Qué elegiste o qué pediste cambiar?",
  "twinMemory.fieldRationale": "Razones",
  "twinMemory.hintRationale": "¿Por qué lo elegiste? ¿Qué renuncia aceptaste?",
  "twinMemory.fieldOutcome": "Resultado",
  "twinMemory.hintOutcome": "¿Qué pasó de verdad? Déjalo en blanco si aún no lo sabes.",
  "twinMemory.fieldConditions": "Cuándo se aplica",
  "twinMemory.hintConditions": "¿En qué circunstancias volverías a elegir esto?",
  "twinMemory.fieldExceptions": "Excepciones",
  "twinMemory.hintExceptions": "¿Cuándo sería mejor otra elección?",
  "twinMemory.untitled": "Episodio de decisión",
  "twinMemory.learnTitle": "Aprender más allá de las reacciones",
  "twinMemory.learnLead": "Trae tus metas, encargos, decisiones y correcciones desde las fuentes de historial que has permitido. Twin enlaza cada detalle extraído con su evidencia humana.",
  "twinMemory.step1": "01 · Capturar en local",
  "twinMemory.step1Hint": "Lee el historial permitido y lo guarda en la memoria local. Los registros que ya estaban no se duplican.",
  "twinMemory.capture": "Capturar historial",
  "twinMemory.capturing": "Capturando historial…",
  "twinMemory.noCall": "Sin llamada al modelo",
  "twinMemory.step2": "02 · Revisar el coste del análisis",
  "twinMemory.step2Hint": "Previsualiza un pase acotado antes de enviar historial a tu modelo configurado.",
  "twinMemory.preview": "Previsualizar el análisis",
  "twinMemory.previewing": "Preparando la vista previa…",
  "twinMemory.selected": "Historial seleccionado",
  "twinMemory.inputTokens": "Tokens de entrada estimados",
  "twinMemory.outputTokens": "Tokens de salida permitidos",
  "twinMemory.calls": "Llamadas al modelo",
  "twinMemory.remainingCalls": "Llamadas que quedan hoy",
  "twinMemory.contextOnly": "Guardados solo como contexto, sin llamada: {n}",
  "twinMemory.nothingUnread": "No hay historial sin leer que analizar. Captura el historial para buscar material nuevo.",
  "twinMemory.learn": "Aprender del historial",
  "twinMemory.learning": "Aprendiendo del historial…",
  "twinMemory.budgetShort": "El presupuesto diario del modelo no alcanza para este pase. Vuelve a intentarlo cuando se renueve.",
  "twinMemory.learnCost": "Esto envía el texto humano seleccionado y su contexto al modelo configurado. Tu proveedor puede cobrarlo.",
  "twinMemory.extracting": "Extrayendo detalles con respaldo. Los resultados y razones desconocidos se quedan vacíos.",
  "twinMemory.capturedNew": "Registros de historial nuevos guardados: {n}.",
  "twinMemory.capturedDenied": "Fuentes sin permiso: {n}. Revísalas en tus historias, más arriba.",
  "twinMemory.capturedUnmatched": "Registros omitidos por no coincidir con ningún proyecto: {n}.",
  "twinMemory.capturedUndated": "Registros omitidos por no tener una fecha válida: {n}.",
  "twinMemory.learnStored": "Registros de decisión guardados: {stored}. Registros de historial procesados: {processed}. Quedan: {remaining}.",
  "twinMemory.learnDropped": "Campos que citaban material pegado, descartados: {n}",
  "twinMemory.learnDeferred": "Registros apartados en este pase: {n}",
  "twinMemory.learnRetrying": "Registros que este pase vuelve a pagar porque un pase anterior los apartó: {n}",
  "twinMemory.requestFailed": "No se pudo completar la petición.",
  "twinMemory.evidenceFailed": "No se pudo cargar la evidencia de origen.",
  "twinMemory.byOwner": "Escrito por ti",
  "twinMemory.fromHistory": "Extraído del historial",
  "twinMemory.unlinkedProject": "Proyecto sin enlazar",
  "twinMemory.dismissed": "Descartado",
  "twinMemory.previousVersion": "Versión anterior",
  "twinMemory.outsideView": "fuera de esta vista reciente",
  "twinMemory.recorded": "Registrado: {list}",
  "twinMemory.notRecorded": "Sin registrar: {list}",
  "twinMemory.explore": "Explorar la decisión",
  "twinMemory.viewSource": "Ver la fuente humana",
  "twinMemory.viewSourceFor": "Ver la fuente humana de {field}",
  "twinMemory.viewEvidence": "Ver la evidencia de origen",
  "twinMemory.loadingEvidence": "Cargando la evidencia de origen…",
  "twinMemory.retryEvidence": "Reintentar",
  "twinMemory.sourceGone": "La fuente original ya no está disponible.",
  "twinMemory.kindOpening": "apertura",
  "twinMemory.kindReaction": "reacción",
  "twinMemory.kindBrief": "material pegado",
  "twinMemory.ownerText": "Texto del dueño",
  "twinMemory.briefText": "Texto pegado o estructurado: contexto, nunca citado",
  "twinMemory.truncated": "Esta fuente se acortó al capturarla.",
  "twinMemory.agentContext": "Contexto del agente · No son tus palabras",
  "twinMemory.revise": "Completar o revisar",
  "twinMemory.dismiss": "Descartar",
  "twinMemory.restore": "Restaurar",
  "twinMemory.successorActive": "Hay otra versión activa de esta decisión. Ábrela o descártala antes de restaurar o revisar esta.",
  "twinMemory.competingTitle": "Versiones en competencia",
  "twinMemory.competingLead": "Estas decisiones tienen más de una versión activa a la vez, de antes de que una revisión descartara a la que sustituye. Hasta que conserves una, ninguna llega al informe de los agentes ni al Laboratorio; conservar una descarta las demás, que siguen entre los descartados.",
  "twinMemory.competingFamilies": "Decisiones con versiones en competencia: {n}",
  "twinMemory.keepThis": "Conservar esta",
  "twinMemory.keeping": "Conservando…",
  "twinMemory.competingActive": "Otra versión de esta decisión también está activa; hasta que conserves una, ninguna se entrega.",
  "twinMemory.competingOpen": "Ir a las versiones en competencia",
  "twinMemory.reachProject": "Alcance: apta para el informe de los agentes de este proyecto y para el Laboratorio. El informe lleva seis decisiones como máximo, las del proyecto primero, así que aún puede dejar esta fuera.",
  "twinMemory.reachGeneral": "Alcance: apta para el informe de los agentes de todos los proyectos y para el Laboratorio. El informe lleva seis decisiones como máximo, las de cada proyecto primero, así que aún puede dejar esta fuera.",
  "twinMemory.reachLabOnly": "Alcance: solo el Laboratorio, hasta que la revises con tus propias palabras.",
  "twinMemory.reachNoDecision": "Alcance: solo el Laboratorio, hasta que registre una decisión.",
  "twinMemory.reachNowhere": "Alcance: no se entrega en ningún sitio.",
  "twinMemory.reachWithheld": "Alcance: retenida hasta que se conserve una sola versión.",
  "twinMemory.searchLabel": "Buscar en el archivo",
  "twinMemory.searchHint": "Busca en metas, decisiones, razones, condiciones, excepciones y contexto de todos los registros, no solo de los recientes.",
  "twinMemory.search": "Buscar",
  "twinMemory.searching": "Buscando…",
  "twinMemory.clearSearch": "Quitar la búsqueda",
  "twinMemory.shownMatches": "Registros que coinciden con «{query}»: {n}",
  "twinMemory.noMatches": "Ningún registro coincide con «{query}».",
  "twinMemory.loadOlder": "Cargar más antiguos",
  "twinMemory.loadingOlder": "Cargando más antiguos…",
  "twinMemory.errQuery": "El texto de búsqueda es demasiado largo. Caracteres como máximo: {max}.",
  "twinMemory.errCursor": "La posición de paginación no es válida. Vuelve a cargar la lista desde el principio.",
  "twinMemory.addField": "Añadir {field}",
  "twinMemory.validUntilLabel": "Último día en que se aplica",
  "twinMemory.validUntilHint": "Opcional. Es el último día en que la decisión se aplica. Pasado ese día tus agentes dejan de recibirla, y tú la sigues teniendo aquí.",
  "twinMemory.appliesThrough": "Se aplica hasta el {date} incluido.",
  "twinMemory.expiredOn": "Caducó el {date}.",
  "twinMemory.expiryTitle": "Hasta cuándo se aplica",
  "twinMemory.saveExpiry": "Guardar la fecha",
  "twinMemory.savingExpiry": "Guardando la fecha…",
  "twinMemory.clearExpiry": "Quitar la fecha",
  "twinMemory.clearingExpiry": "Quitando la fecha…",
  "twinMemory.reachExpired": "Alcance: caducada, no se entrega en ningún sitio. Sigue aquí para que la leas, y vuelve a entregarse en cuanto quites la fecha.",

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
    "Aquí conviven los criterios que firmas y las propuestas que Twin aprende del historial. Las propuestas inferidas no se publican hasta que actives ese permiso. Cada criterio muestra si ya llegó al fichero.",
  "twin.introEmpty":
    "Panoma lee tu historial con los agentes en tu propio disco y saca de ahí las pocas cosas que de verdad piensas sobre cómo quieres que quede tu trabajo, con las citas de las que salió cada una.",
  "twin.introEmptyHint":
    "Empieza aquí abajo, en tus historias: dice cuáles hay en esta máquina y cuánto ocupan, medido sin abrir ninguna.",
  /*
    Where all of this ends up, said to everybody. It was named by `twin.intro`, which only renders
    once there are beliefs, and by the hint on the file card at the bottom of a four-thousand-pixel
    page — so the one reader who needs to know what this screen is FOR was the only one who never
    read it.
   */
  "twin.payoff":
    "Al final de todo esto hay unas veinte frases en un fichero, TASTE.md, que panoma reparte al AGENTS.md de cada proyecto: eso es lo que leen tus agentes antes de tocar tu código.",
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
  /*
    The paid half says what it is doing, which is not what the free half does. Both buttons wore
    «Leyendo…» while one read the disk for free and the other was spending model calls, several
    in a row — the same word over two very different things.
   */
  "twin.distillingPaid": "Destilando…",
  "twin.distillEstimate":
    "lo que lee esta pasada — citas: {verdicts} · tokens de entrada (aproximados): {tokens}",
  "twin.distillProgress": "leídas: {read} · observaciones guardadas: {saved} · quedan: {left}",
  /*
    What no pass can send: a project's only unread quote cannot back an observation, so the
    route leaves it out and says so. Without this line the corpus said "1 left" forever.
   */
  "twin.distillThin": "sin pareja en su proyecto, y por eso sin leer: {n}",
  /* Answers the output limit cut, asked again at once with twice the room. Each was a call. */
  "twin.distillTruncated": "respuestas cortadas y pedidas de nuevo con más sitio: {n}",
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
  /*
    Publication is not capture. Plan §14.1 asks that the controls of a source keep their effects
    apart, and this yes sits three sections under the switch that opens a transcript: without the
    sentence, «let them reach the file» reads as one more door into the history.
   */
  "twin.consentDistinct": "Este sí publica lo ya deducido; no lee nada nuevo. Lo que se lee se decide arriba, fuente a fuente.",
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
  /*
    What to take out, said with the two halves of the figure in front. `heaviest()` has computed
    this split since the file was written and nothing rendered it, so «no cabe» came with no way to
    decide. The block of a project is the global PLUS its own, so naming only the project would
    send someone to trim there when the bulk is the part everybody reads. Measured live: trimming
    three consecutive sentences moved the total from 3.228 to 3.195, because they were scoped to
    the project that was already the heaviest — and without the split that reads as a dead button.
   */
  "twin.fileSplit": "de esos, en todos los proyectos: {global}",
  "twin.fileHeaviest": "y lo que añade el proyecto más cargado, {project}: {own}",
  /*
    Which of these sentences an agent actually reads. `taste-budget.ts` was written because the
    catalog held 27 publishable sentences, the file held 14, and the screen drew all 27 together
    under «lo que te representa» — so thirteen beliefs that reached nobody looked exactly like the
    fourteen that did. It has computed the difference ever since, and nothing rendered it.
   */
  "twin.notInFile": "no está en el fichero",
  "twin.notInFileWhy":
    "Está guardada aquí, pero no ha bajado a TASTE.md, así que ningún agente la lee todavía.",
  "twin.fileRoom": "Queda sitio, en caracteres: {n}",
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
  "twin.spendEpisodes": "llamadas de la memoria de decisiones: {used} de {cap}",
  "twin.spendRehearse": "ensayos: {used} de {cap}",
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
  /*
    The second permission of a source, and what is said before the yes (plan §7.1): what is
    read, what is kept, from which byte, how it is taken back and what stays. The short label
    is `memory.captureConsent`; the label alone is not the consent. The scope is global in
    delivery A — the switch per project is later — and the sentence says so instead of hiding
    it behind a word like «all».
   */
  "twin.captureTitle": "Comprobar que la memoria llega",
  "twin.captureReads":
    "Qué se lee: solo los recibos de los ganchos y los registros de ciclo de vida de cada transcripción (inicio, reanudación, compactación). Ni tus mensajes ni las respuestas del agente.",
  "twin.captureRetains":
    "Qué se guarda: identificadores de oferta, coordenadas en bytes y hashes. Nunca texto de la conversación.",
  "twin.captureFrom":
    "Desde dónde: el final de cada fichero en el momento de activarlo. Lo escrito antes no se procesa, tampoco al reactivar.",
  "twin.captureRevokeNote":
    "Cómo se retira: aquí mismo o borrando twin.json. Los recibos ya guardados se quedan; los elimina {cli} memory purge.",
  "twin.captureScope": "Vale para todos los proyectos del catálogo.",
  "twin.captureOn": "Recibos: leyendo desde el {date}",
  "twin.captureOff": "Recibos: no se leen",
  /*
    A source that is open but has no receipt reader yet gets a sentence, not a switch: a switch
    there would promise to read what nothing reads. And the grant door's refusals, by code — the
    door answers a machine shape because the CLI reads it too; the card says them in the reader's
    language (`captureRefusalKey` in `lib/memory-view.ts`).
   */
  "twin.captureUnsupported": "En esta versión no se leen los recibos de este programa.",
  "twin.grantConsentRequired": "Primero deja que Panoma lea esta fuente; el permiso de recibos va después.",
  "twin.grantUnsupportedSource": "En esta versión no hay lector de recibos para esta fuente.",
  "twin.grantStale": "El permiso cambió desde que se cargó la pantalla. Recárgala y decide de nuevo.",
  "twin.grantInvalid": "La petición no tenía la forma que espera el catálogo.",
  "twin.grantLocalOnly": "Este permiso solo se concede en el ordenador donde está el catálogo.",
  "twin.grantStalePolicy": "El permiso cambió desde que se hizo el plan. Vuelve a empezar.",
  /*
    Delivery B: two more decisions per open source, each with its own notice before the yes.
    The version-2 notice of the capture opens the typed facts (what is noted, and that a line,
    a message or a reply never is); the extraction notice says what travels to the provider,
    what is kept, what it costs, from which byte, how it is taken back and that it stops with
    the capture. The short labels are `memory.captureConsent` and `memory.extractConsent`;
    a label alone is never the consent.
   */
  "twin.captureAccept": "Leer los recibos de esta fuente",
  "twin.factsTitle": "Aviso 2: los hechos de cada sesión",
  "twin.factsReads":
    "Qué se anota además: lecturas, ediciones, la familia de cada comando (build, test, lint…), resultados de tests, fallos, commits y ciclo de vida. Nunca una línea de comando, un mensaje ni una respuesta.",
  "twin.factsFrom":
    "Desde dónde: el final de cada fichero al aceptar este aviso. Si dejas de leer los recibos, este aviso se cierra con ellos y hay que aceptarlo de nuevo.",
  "twin.factsAccept": "Anotar también los hechos de cada sesión",
  "twin.factsOn": "Hechos: anotando (aviso 2 aceptado)",
  "twin.factsOff": "Hechos: no se anotan",
  "twin.extractTitle": "Proponer memoria del proyecto",
  "twin.extractTravels":
    "Qué viaja al proveedor: tus mensajes nuevos del tramo permitido, con credenciales y secretos tachados, y los hechos anotados. Nunca las respuestas del agente.",
  "twin.extractRetains":
    "Qué se guarda: las citas que sostienen cada propuesta. Citas por propuesta, como máximo: {quotes}. Caracteres por cita, como máximo: {chars}.",
  "twin.extractQuota":
    "Cuánto se paga: llamadas automáticas al día, como máximo: {daily}. Por conversación y día, como máximo: {perConversation}.",
  "twin.extractFrom":
    "Desde dónde: el final de cada fichero en el momento de activarlo, con su propio límite aparte del de la captura. Lo escrito antes no viaja.",
  "twin.extractRevokeNote":
    "Cómo se retira: aquí mismo o borrando twin.json. Las propuestas ya hechas se quedan, los trabajos en curso dejan de valer y nada nuevo se paga.",
  "twin.extractNeedsCapture":
    "Depende de la captura: si dejas de leer los recibos de esta fuente, la extracción se para con ellos.",
  "twin.extractOn": "Extracción: activa desde el {date}",
  "twin.extractOff": "Extracción: apagada",
  "twin.extractPaused": "Extracción: concedida, pero parada mientras no se leen los recibos",
  "twin.consentDistinctExtract":
    "Tampoco propone memoria de proyecto: eso lo decide el permiso de extracción, fuente a fuente, y cada propuesta espera tu aprobación.",
  /*
    Delivery D: the fourth decision per open source, the Twin's continuous learning
    (`twinAutoLearn`, plan §10.5). Its notice says what travels (the person's new messages of
    the allowed range, redacted, in batches; never the agent's replies, never a copy or a relay),
    what is kept (observations with their exact quote and the criteria proposed, for review here),
    what it costs (the automatic batches a day inside the reading cap), what it never does (it
    publishes nothing: the publication permission stays its own switch), from which byte, how it
    is taken back and what a revocation keeps. The short label is `memory.twinAutoLearnConsent`.
   */
  "twin.learnSwitchTitle": "Aprender tus criterios",
  "twin.learnTravels":
    "Qué viaja al proveedor: tus mensajes nuevos del tramo permitido, con credenciales y secretos tachados, por lotes. Nunca las respuestas del agente; un mensaje copiado o relevado viaja marcado como copia y no sostiene ningún criterio.",
  "twin.learnRetains":
    "Qué se guarda: observaciones con su cita exacta y de qué conversación salieron, y los criterios que propone. Todo se revisa aquí, en el retrato.",
  "twin.learnQuota":
    "Cuánto se paga: lotes automáticos al día dentro de la cuota de lectura, como máximo: {daily}.",
  "twin.learnNeverPublishes":
    "Qué no hace: no publica nada. Que lo deducido llegue al fichero lo decide el permiso de publicación, más abajo, y aprender no lo concede.",
  "twin.learnFrom":
    "Desde dónde: el final de cada fichero al activarlo, con su propio límite aparte del de la captura. Lo escrito antes no se lee.",
  "twin.learnRevokeNote":
    "Cómo se retira: aquí mismo, en el bloque de aprendizaje o con {cli} memory revoke. Se conservan tus firmas, los criterios publicados y lo enseñado a mano; los lotes en curso dejan de valer.",
  "twin.learnNeedsCapture":
    "Depende de la captura: si dejas de leer los recibos de esta fuente, el aprendizaje se para con ellos.",
  "twin.learnOn": "Aprendizaje: activo desde el {date}",
  "twin.learnOff": "Aprendizaje: apagado",
  "twin.learnStopped": "Aprendizaje: concedido, pero parado mientras no se leen los recibos",
  /*
    The learning block on the portrait screen (plan §10.5, §14.1 «Aprendizaje continuo dentro de
    Twin»): active or paused per source and project, the last range processed, what waits, the
    automatic spend of the day and why it waits. It never asks per batch and never notifies per
    observation, and the block says so, because a person who has just granted a paid background
    process wants to know what will interrupt them — nothing — and where its output lands — the
    portrait, for review. The wait sentences say what the system knows: a batch that is still
    open, a quota that ran out, a provider that is missing. None of them says what the model did.
   */
  "twin.learnTitle": "Aprendizaje continuo",
  "twin.learnLead":
    "Lee tus mensajes nuevos por lotes, anota observaciones y propone criterios. No pregunta en cada lote ni avisa de cada observación: lo que cambie aparece en el retrato para revisar.",
  "twin.learnNone": "Ninguna fuente aprende de forma continua. Se activa fuente a fuente en tus historias, arriba.",
  "twin.learnActive": "aprendiendo",
  "twin.learnPaused": "en pausa",
  "twin.learnScopeGlobal": "todos los proyectos",
  "twin.learnScopeProject": "solo este proyecto",
  "twin.learnPending": "Pendiente de leer: {size} · conversaciones: {streams}",
  "twin.learnNothingPending": "Nada pendiente de leer",
  "twin.learnLast": "Último tramo procesado: {date}",
  "twin.learnLastNone": "Aún no se ha procesado ningún tramo",
  "twin.learnSpend": "Llamadas automáticas de hoy: {used} de {subquota} · cuota de lectura del día: {cap}",
  "twin.learnJobLine": "lotes {status}: {n}",
  "twin.learnWorking": "Trabajando: hay lotes en cola.",
  "twin.learnWaitPaused": "En espera: el gasto está en pausa.",
  "twin.learnWaitBudget": "En espera: la cuota del día se agotó. Lo guardado no se repaga; sigue mañana.",
  "twin.learnWaitProvider": "En espera: no hay proveedor configurado.",
  "twin.learnWaitNoGrant": "En espera: ningún permiso de aprendizaje está activo.",
  "twin.learnWaitUnstable":
    "En espera: la conversación sigue abierta. El lote se cierra a la media hora de calma o a las cuatro horas del primer mensaje pendiente.",
  "twin.learnWaitNoPending": "Al día: nada nuevo que leer.",
  "twin.learnWaitNoReferent": "Al día: los mensajes nuevos no nombraban nada de lo que aprender.",
  "twin.learnPause": "Pausar el aprendizaje",
  "twin.learnPausing": "Pausando…",
  "twin.learnPauseNote":
    "Pausar o retirar el permiso conserva tus firmas, los criterios publicados y lo enseñado a mano; los lotes pagados en curso dejan de valer. Se reanuda en tus historias, arriba.",
  "twin.learnRevoked": "Lotes en curso que dejaron de valer: {n}",
  "twin.learnRecentTitle": "Lo último anotado",
  "twin.learnRecentNone": "Todavía no hay observaciones anotadas.",
  /*
    The seven kinds of an observation (plan §21.3), as a tag beside its quote. An ambiguous
    reaction — «perfecto» with no object of feedback in reach — is kept as evidence and drawn as
    exactly that: it founds no preference, and the tag says so before anyone reads it as one.
   */
  "twin.observationKindReaction": "reacción",
  "twin.observationKindChoice": "elección",
  "twin.observationKindReason": "razón",
  "twin.observationKindCondition": "condición",
  "twin.observationKindException": "excepción",
  "twin.observationKindCounterexample": "contraejemplo",
  "twin.observationKindCorrection": "corrección",
  "twin.observationAmbiguous": "sin referente: no funda ninguna preferencia",
  /*
    A criterion's typed conditions and exceptions (plan §10.1), read-only and as sentences — the
    same sentences the brief and the agent read (`renderPredicate`). And its independence: how
    many independent cases stand behind an inference (plan §10.2), against the floor an automatic
    publication needs; an inherited row never counted them and says so instead of showing a zero
    that would read as «no evidence».
   */
  "twin.appliesWhen": "Se aplica cuando: {sentence}",
  "twin.exceptWhen": "Salvo cuando: {sentence}",
  "twin.families": "casos independientes: {n}",
  "twin.familiesShort": "publicarse sola pide casos independientes: {floor}",
  "twin.familiesLegacy": "casos independientes: sin contar (heredada)",
  "twin.signWhatYouSee": "Firmar firma también sus condiciones y excepciones tal como se leen aquí.",
  "twin.proposalGroup": "propuestas sobre este criterio: {n}",
  "twin.proposalEvidence": "pruebas de la propuesta: {n}",
  "twin.saveStale": "Algo cambió desde que se cargó la pantalla; no se aplicó nada. Se recarga para que firmes lo que ves.",
  /*
    The publication of the portrait (plan §10.4): the file is written by an outbox that compares
    the file it prepared against the file it finds. A moved file is a conflict and never a veto;
    the notice says what reconciling does — read the file again, keep the person's edits, write
    what is publishable — and offers it. A pending publication is said as waiting, not as done.
   */
  "twin.publicationTitle": "Publicación en el fichero",
  "twin.publicationWordNone": "sin planificar",
  "twin.publicationWordPending": "pendiente",
  "twin.publicationWordPublished": "escrito",
  "twin.publicationWordConflict": "en conflicto",
  "twin.publicationWordFailed": "falló",
  "twin.publicationNone": "Todavía no se ha planificado ninguna publicación.",
  "twin.publicationPending": "Pendiente de escribir en el fichero.",
  "twin.publicationPublished": "Escrito en el fichero: {date}",
  "twin.publicationFailed": "La publicación falló: {reason}",
  "twin.publicationConflictHint":
    "Alguien editó TASTE.md desde que se preparó la publicación. Reconciliar lee el fichero de nuevo, respeta tus ediciones y vuelve a escribir lo publicable.",
  "twin.publicationReconcile": "Reconciliar ahora",
  "twin.publicationReconciling": "Reconciliando…",
  "twin.publicationUnavailable": "El retrato no se pudo planificar para el fichero; los cambios sí se aplicaron.",
  /*
    Both callers of this route render it, and the histories card sits ABOVE both of them: above
    the distiller inside its own section, and above the memory capture two sections further down.
    It used to say «aquí abajo», which was written when the card was at the foot of the page.
   */
  "twin.mineNoConsent":
    "Ninguna de tus historias tiene permiso, así que no se ha abierto ni un fichero. Dilo en tus historias, aquí arriba.",
  "twin.mineNoReadable":
    "Las historias de este disco todavía no se saben leer, así que no hay permiso que valga: no se ha abierto ni un fichero.",
  "twin.mineNoHistories":
    "En este disco no hay ninguna historia de agente que leer, así que no se ha abierto ni un fichero.",
  "twin.mineButton": "Buscar lo nuevo en mi historial",
  "twin.mineButtonLeft": "Leer mi historial · quedan {n}",
  /* Said before the press and not after it: the 409 this replaces arrived a round trip too late. */
  "twin.distillNoConsent":
    "Primero deja que lea alguna de tus historias, aquí arriba. Sin eso no hay nada que leer.",
  /*
    The price of the only paid control on this screen that carried none. Reading first is free —
    the disk costs nothing — and the distillation after it is not, and it can run twenty passes in
    a row. It is said before the press, next to the button, like the Lab's and the memory's.
   */
  "twin.distillCost":
    "Leer el disco es gratis. Destilar lo que traiga llama a tu modelo configurado, varias veces seguidas, y va contra el tope diario de lecturas.",
  /*
    The yes that the estimate above asks for. The count is in the button because the two used to be
    one gesture: the route measured the cost and then spent it in the same tick, so the figure was
    something you watched go by. The number closes the sentence, as always.
   */
  "twin.distillGo": "Destilar, citas que leería: {n}",
  "twin.mining": "Leyendo tus historias…",
  "twin.mined": "citas nuevas: {saved} · ya estaban: {duplicates}",
  "twin.minedNone": "No hay nada nuevo en tus historias desde la última vez.",
  /*
    The other half of what one reading does. `POST /api/twin/mine` hard-codes `captureNarratives:
    true`, so every press saves quotes AND history records in the same transaction — and the two
    buttons that call it each reported only the half they were built for. Nothing was lost, but
    the person was told half of what their press had done, twice, from two places on one screen.
   */
  "twin.minedRecords": "y registros de historial, también nuevos: {n}",
  "twin.minedQuotes": "y citas para el retrato, también nuevas: {n}",
  /*
    And what was left out, said by the reading that left it out. The route separates `denied` from
    what it read and answers with it on a 200 as well; the browser declared only `saved` and
    `duplicates`, so somebody with one history granted and another refused was told «new quotes:
    12 · already there: 40» and never learned that half their disk had not been opened. The number
    closes the sentence because «1 fuente» and «2 fuentes» do not share a suffix here either.
   */
  "twin.minedDenied": "sin permiso, y por eso sin abrir: {n}",
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
  "twin.spendMore": "Cada órgano, los topes y el precio",
  /*
    The number closes the sentence, and the remedy names the screen before the variable: since
    6-Sep-2026 the cap is moved from the browser, and a 429 that only knew the variable sent the
    person to a terminal for something a click away.
   */
  "twin.readsSpent":
    "Las lecturas de hoy están gastadas. Vuelven mañana; el tope se sube en la pantalla de gasto (/spend) o con PANOMA_READ_BUDGET. Hoy: {used} de {cap}.",
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
  /* The same count as `twin.distillTruncated`, over the two calls this button makes. */
  "twin.synthTruncated": "Respuestas cortadas y pedidas de nuevo con más sitio: {n}.",
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
    "MCP es el canal por el que un agente habla con tu catálogo. Estos son los que hay en esta máquina: conectar uno le da las quince herramientas —el resumen del proyecto al empezar, la bitácora, la cola de tareas, el relevo y panoma video— y escribe su configuración donde ese agente la lee.",
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

  // ── The spend screen: what the models cost, and the caps ─────────────────────
  "spend.title": "Consumo y límites",
  "spend.intro": "Panoma utiliza IA para analizar proyectos, revisar capturas y construir tu memoria. Aquí puedes ver ese consumo y limitar las llamadas de cada función.",
  "spend.scope": "Incluye los modelos y proveedores de voz usados por Panoma y sus apps. No mide el gasto de tus sesiones externas de agentes ni tus suscripciones.",
  "spend.billingHint": "El coste es una estimación con tus tarifas y los tokens registrados, no una factura. Las llamadas sin tarifa o sin medición pueden dejar el importe incompleto.",
  "spend.totalCalls": "Llamadas registradas",
  "spend.estimatedCost": "Coste estimado",
  "spend.partialCost": "Estimación parcial",
  "spend.noActivityCost": "Sin consumo registrado",
  "spend.rateMissing": "Falta la tarifa",
  "spend.rateUnmetered": "Sin medición de tokens",
  "spend.dirty": "Cambios sin guardar",
  "spend.modelsEmptyHint": "Los modelos aparecerán después de usarlos desde Panoma. Aquí podrás añadir sus tarifas para estimar el coste.",
  "spend.unbudgetedHint": "También se incluyen en los totales. Las pruebas de credenciales, por ejemplo, no están sujetas a los límites ni a la pausa de esta página.",
  "spend.capCalls": "Llamadas / día",
  "spend.capAttempts": "Intentos / día",
  "spend.usageCalls": "Llamadas hoy: {used} / {cap}",
  "spend.usageAttempts": "Intentos registrados hoy: {used} / {cap}",
  "spend.state.paused": "En pausa",
  "spend.state.disabled": "Desactivado",
  "spend.state.exhausted": "Límite alcanzado",
  "spend.state.enabled": "Habilitado",
  "spend.appReservationsHint": "Las apps reservan intentos antes de ejecutarse; las reservas pendientes aún no aparecen en este contador.",
  "spend.today": "Hoy",
  "spend.month": "Últimos 30 días",
  "spend.byModel": "Coste por modelo y tarifas",
  "spend.caps": "Qué consume Panoma",
  "spend.capsHint": "Cada límite cuenta llamadas, no dinero, y se reinicia a medianoche en el servidor de Panoma. Usa 0 para desactivar una función o deja el campo vacío para restaurar su valor predeterminado.",
  "spend.shots": "Tamaño de las capturas para IA",
  "spend.shotsHint": "El tamaño que recibe la IA al revisar una captura puede influir en su coste y en los detalles que detecta.",
  "spend.shotFull": "Tamaño original",
  "spend.shotFullHint": "Conserva la resolución y todos los detalles de la captura.",
  "spend.shotFit": "Reducir el lado largo a {n} px",
  "spend.shotFitHint": "Puede reducir el consumo de imágenes. El texto pequeño y los detalles finos pueden perderse.",
  "spend.shotsPng": "La reducción solo se aplica a PNG; los demás formatos conservan su tamaño.",
  "spend.pause": "Pausar las funciones con límite",
  "spend.pauseHint": "Se aplica al guardar y bloquea nuevas llamadas de las funciones de abajo. No cancela las que están en curso ni bloquea las pruebas de credenciales.",
  "spend.paused": "Las funciones con límite están en pausa.",
  "spend.currency": "Moneda",
  "spend.currencyHint": "Código de tres letras, como USD o EUR. Usa tarifas en esa moneda: cambiarla no convierte los importes.",
  "spend.save": "Guardar ajustes",
  "spend.saving": "Guardando…",
  "spend.saved": "Ajustes guardados. Se aplican a las próximas llamadas.",
  "spend.failed": "El catálogo no pudo guardar los ajustes.",
  "spend.errBody": "El formulario no se pudo leer.",
  "spend.errCaps": "Un tope tiene que ser un número entero entre 0 y 100000.",
  "spend.errRates": "Una tarifa tiene que ser un número igual o mayor que cero, por millón de tokens.",
  "spend.errCurrency": "La moneda son tres letras mayúsculas, como USD.",
  "spend.errPaused": "La pausa es sí o no.",
  "spend.errShots": "El tamaño de las capturas es «completa» o «reducida», y nada más.",
  "spend.errQuota": "La cuota debe ser un entero entre 1 y 1048576 MiB. Deja el campo vacío para restaurar el valor predeterminado.",
  "spend.storage": "Almacenamiento de memoria",
  "spend.storageHint": "Limita el contenido nuevo que la memoria guarda automáticamente. Se mide en MiB; no es el tamaño del disco ni un límite de gasto. Al alcanzar la cuota se pausa la captura y el aprendizaje. No se borra contenido para hacer sitio.",
  "spend.storageUsed": "Contenido guardado: {used} / {limit} MiB",
  "spend.quotaCatalog": "Cuota del catálogo (MiB)",
  "spend.quotaProject": "Cuota por proyecto (MiB)",
  "spend.diskUnknown": "No se pudo medir el espacio físico disponible para el catálogo.",
  "spend.diskFull": "El disco del catálogo está lleno. Espacio disponible (MiB): {n}. Libera espacio en ese disco para poder guardar cambios.",
  "spend.diskLow": "Queda poco espacio físico para el catálogo (MiB): {n}. Subir la cuota de memoria no libera espacio en el disco.",
  "spend.diskAvailable": "Espacio físico disponible en el disco del catálogo (MiB): {n}.",
  "spend.empty": "Hoy Panoma no ha registrado llamadas a proveedores.",
  "spend.monthEmpty": "No hay llamadas registradas en este periodo.",
  "spend.brokenFile": "El fichero spend.json existe y no se pudo leer: se muestran los valores de fábrica.",
  "spend.remote": "Este catálogo usa una base de datos remota. Los límites corresponden al servidor que ejecuta Panoma.",
  "spend.used": "{used} de {cap}",
  "spend.unbudgeted": "Llamadas fuera de los límites diarios",
  "spend.kindLine": "{name}: {n}",
  "spend.calls": "llamadas: {n}",
  "spend.tokens": "tokens: {input} de entrada · {output} de salida",
  "spend.unmetered": "llamadas sin medición completa: {n}",
  "spend.images": "imágenes: {n}",
  "spend.cost": "coste: {money}",
  "spend.unpriced": "llamadas sin tarifa: {n}",
  "spend.noCost": "Añade las tarifas de los modelos más abajo para calcular una estimación.",
  "spend.daysAria":
    "Llamadas por día en los últimos treinta días. En total, llamadas: {calls}; tokens de entrada: {input}; de salida: {output}",
  "spend.dayTitle": "{day} · llamadas: {calls} · tokens: {tokens}",
  "spend.model": "Modelo",
  "spend.colCalls": "Llamadas",
  "spend.colIn": "Tokens de entrada",
  "spend.colOut": "Tokens de salida",
  "spend.colUnmetered": "Sin medir",
  "spend.colRateIn": "Entrada / 1 M tokens",
  "spend.colRateOut": "Salida / 1 M tokens",
  "spend.colCost": "Coste estimado",
  "spend.rateHint": "Consumo de los últimos 30 días. Introduce el precio de tu proveedor por millón de tokens de entrada y de salida. Panoma no consulta precios automáticamente.",
  "spend.rateInLabel": "Tarifa de entrada de {model}",
  "spend.rateOutLabel": "Tarifa de salida de {model}",
  "spend.envDecides": "Este límite se configura al iniciar Panoma con {name}={value}; no se puede editar aquí.",
  "spend.envUnread": "{name} vale «{value}» y no se entiende: se aplica el valor de fábrica, {factory}",
  "spend.factory": "predeterminado: {n}",
  "spend.family.read": "Análisis del historial",
  "spend.family.look": "Revisión de capturas",
  "spend.family.memory": "Memoria de sesiones",
  "spend.family.ask": "Respuestas del Twin",
  "spend.family.rehearse": "Laboratorio de decisiones",
  "spend.family.episodes": "Extracción de decisiones",
  "spend.family.card": "Análisis de proyectos",
  "spend.familyHint.read": "Resume y organiza el historial que importas para construir tu Twin.",
  "spend.familyHint.look": "Analiza capturas de tus proyectos, al pedir una revisión o mediante el observador automático.",
  "spend.familyHint.memory": "Guarda lo aprendido al finalizar sesiones con agentes, en segundo plano.",
  "spend.familyHint.ask": "Redacta respuestas para tus agentes a partir de tu memoria y preferencias.",
  "spend.familyHint.rehearse": "Contrasta una decisión con tus criterios y experiencias anteriores.",
  "spend.familyHint.episodes": "Convierte relatos guardados en decisiones que Panoma puede recordar.",
  "spend.familyHint.card": "Genera resúmenes de proyectos y revisa sus instrucciones AGENTS.md.",
  "spend.kind.look": "miradas",
  "spend.kind.distill": "destilaciones",
  "spend.kind.classify": "repartos por materia",
  "spend.kind.synthesize": "síntesis",
  "spend.kind.memory": "destilaciones de memoria",
  "spend.kind.ask": "borradores del doble",
  "spend.kind.rehearse": "ensayos",
  "spend.kind.episodes": "extracciones de decisiones",
  "spend.kind.describe": "resúmenes de proyecto",
  "spend.kind.review": "opiniones sobre AGENTS.md",
  "spend.kind.probe": "pruebas de credenciales",
  "spend.source.factory": "Valor predeterminado",
  "spend.source.file": "Configurado aquí",
  "spend.source.env": "Configurado al iniciar",
  "spend.source.paused": "en pausa",
  /*
    The handoff screen. Written here in Spanish first, the way every screen is; the English half
    names things as a native product would. Numbers close their sentences («turnos: {n}») so a one
    never meets an inflected word, and the same-agent copy speaks of signing in and resuming —
    never of getting around a limit. `{time}` and `{date}` arrive already formatted by `Intl` on
    the client; `{relative}` is `untilText`.
   */
  "handoff.eyebrow": "Relevo",
  "handoff.title": "Continúa una conversación en otro sitio",
  "handoff.intro":
    "Cuando un agente se para —un límite de uso, una herramienta que prefieres para esta tarea, otra máquina— panoma escribe la conversación en el historial propio del otro agente, para que su reanudación normal la encuentre. O te dice cómo reanudar la misma después de iniciar sesión. El original no se toca, y panoma nunca ve tu inicio de sesión.",
  "handoff.refresh": "Volver a mirar el disco",
  "handoff.listLoading": "Leyendo los historiales…",
  "handoff.conversations": "Conversaciones en este disco",
  "handoff.conversationsLead":
    "Lo que Claude Code, Codex, OpenCode y Gemini CLI guardaron en este ordenador, por proyecto. Nada se escribe hasta que lo pides.",
  "handoff.notInCatalog": "Fuera del catálogo",
  "handoff.scanHint": "Escanea {path} para atarlas a un proyecto.",
  "handoff.turns": "turnos: {n}",
  "handoff.size": "tamaño: {size}",
  "handoff.summarized": "trae su propio resumen",
  "handoff.summarizedTitle":
    "El agente de origen ya resumió el principio de esta conversación; ese resumen viaja con ella.",
  "handoff.limitBefore": "terminó en un límite de uso · vuelve {relative} ({time})",
  "handoff.limitAfter": "límite levantado a las {time}",
  "handoff.limitUnknown": "terminó en un límite de uso · hora de reinicio desconocida",
  "handoff.resumeAsWas": "Reanudar tal cual",
  "handoff.continueIn": "Continuar en…",
  "handoff.filterAgent": "Agente",
  "handoff.filterProject": "Proyecto",
  "handoff.allAgents": "Todos los agentes",
  "handoff.allProjects": "Todos los proyectos",
  "handoff.showAll": "Ver todas",
  "handoff.emptyAll": "No hay conversaciones en este disco",
  "handoff.emptyAllLead":
    "panoma lee los historiales propios de los agentes; no escribe nada hasta que se lo pides. Respeta CLAUDE_CONFIG_DIR, CODEX_HOME y XDG_DATA_HOME.",
  "handoff.storeFound": "{agent} · {path} · conversaciones: {n}",
  "handoff.storeMissing": "{agent} · {path} · no encontrado",
  "handoff.emptyFilter": "Nada de {agent} en {project}.",
  "handoff.remote": "Este catálogo vive en otra máquina. Sus conversaciones están en aquel disco, no en este.",
  "handoff.panelTitle": "Continuar en…",
  "handoff.loading": "Leyendo la conversación…",
  "handoff.close": "Cerrar",
  "handoff.copy": "copiar",
  "handoff.copied": "copiado",
  "handoff.target": "Destino",
  "handoff.targetInstalled": "instalado",
  "handoff.targetNotInstalled": "historial encontrado, no instalado aquí",
  "handoff.targetNative": "lo reanuda él mismo",
  "handoff.targetDocument": "solo documento",
  "handoff.sameAgent": "El mismo agente, con otra cuenta",
  "handoff.sameAgentLimitHint": "lo habitual cuando salta un límite: la otra cuenta continúa desde aquí",
  "handoff.sameAgentLead":
    "Tu conversación se queda en este disco. Cierra la sesión, inicia sesión con la cuenta que quieras y reanúdala. panoma no copia nada y nunca ve tu inicio de sesión.",
  "handoff.sameAgentStep1": "Cierra la sesión de {agent}:",
  "handoff.sameAgentStep2": "Inicia sesión con la cuenta con la que quieres continuar:",
  "handoff.sameAgentInside": "o {command} dentro de claude",
  "handoff.sameAgentStep3": "Reanúdala:",
  "handoff.sameAgentStep4": "Opcional — deja el original intacto bifurcando:",
  "handoff.sameAgentStep5": "Opcional — guarda una copia fuera del agente:",
  "handoff.keepCopyHint": "Tráela a cualquier agente más adelante con: {command}",
  "handoff.sameAgentHome":
    "Si {agent} tiene una segunda carpeta de configuración, el terminal puede escribir la copia allí:",
  "handoff.sameFile": "el mismo fichero, tal cual",
  "handoff.sameFileHint": "No se escribe nada: inicia sesión con la otra cuenta y reanúdala.",
  "handoff.sameCopyHint": "Una copia más corta en el mismo historial, con su propio id, para que la otra cuenta no vuelva a pagar la conversación entera.",
  "handoff.writeCopy": "Escribir la copia resumida",
  "handoff.sameAgentApp": "O ábrela en {app}, que adopta el original tal cual, sin copia:",
  "handoff.sameAgentAppNote":
    "Claude guarda su lista de Code por cuenta: la conversación no estará en la lista de la cuenta nueva hasta que este enlace la adopte.",
  "handoff.sameAgentCodexNote": "La app de Codex la lista en cuanto este enlace la registra.",
  "handoff.targetAppSub": "app de escritorio · se abre con un enlace",
  "handoff.openInApp": "Abrir en {app}",
  "handoff.appLine": "o, en un terminal:",
  "handoff.appTrust": "La app confiará en la carpeta {cwd} cuando adopte la conversación.",
  "handoff.appOpened": "Se le pidió a {app} que la abra; si no aparece, pega la línea de arriba.",
  "handoff.appOpenFailed": "No se pudo abrir en {app}.",
  /* What to do by hand when the app's link does not answer, one sentence per desktop app, by its id. */
  "handoff.inAppByHand.claude-app": "Si el enlace no responde: abre Claude, la pestaña Code, la carpeta {cwd}, y elige la conversación {id}.",
  "handoff.inAppByHand.codex-app": "Si el enlace no responde: abre la app de Codex, la carpeta {cwd}, y elige el hilo {id}.",
  "handoff.tier": "Cuánto viaja",
  "handoff.tier.full": "todo",
  "handoff.tier.compact": "resumen + últimos turnos",
  "handoff.tier.brief": "solo un documento",
  "handoff.tierHint.full": "Cada mensaje y cada llamada a herramientas, tal cual.",
  "handoff.tierHint.compact": "El resumen de panoma y los turnos más recientes; el resto se queda.",
  "handoff.tierHint.brief": "Un .md para pegar como primer mensaje en cualquier agente.",
  "handoff.tierPreselected": "Preseleccionado: esta ocupa {size}",
  "handoff.documentOnly": "{agent} no puede reanudar una conversación escrita: recibe un documento.",
  "handoff.digestModel": "Que un modelo escriba el resumen",
  "handoff.digestLeft": "quedan hoy {n} de {cap}",
  "handoff.digestNoModel": "Sin modelo conectado — elige uno en IA",
  /* The cap closes the sentence: a cap of one once read «Los 1 de hoy están gastados». A cap of zero is paused or disabled in Spend, not spent. */
  "handoff.digestSpent": "Los resúmenes de hoy están gastados — más mañana, o sube el tope en Gasto · tope: {cap}",
  "handoff.digestPaused": "Los resúmenes por modelo están en pausa o desactivados — actívalos en Gasto",
  "handoff.travels": "viaja",
  "handoff.stays": "se queda",
  "handoff.row.all": "cada mensaje y cada llamada a herramientas",
  "handoff.row.digest": "el resumen",
  "handoff.row.lastTurns": "los últimos turnos: {n}",
  "handoff.row.thinking": "razonamiento",
  "handoff.row.images": "imágenes",
  "handoff.row.subagents": "ejecuciones de subagentes",
  "handoff.row.offloaded": "salidas de herramientas en ficheros aparte",
  "handoff.row.secrets": "secretos enmascarados",
  "handoff.row.other": "otros registros",
  "handoff.never": "nunca viaja",
  "handoff.yes": "sí",
  "handoff.no": "no",
  "handoff.sizeLine": "turnos: {n} · ≈ {k}k tokens",
  /* A native writer with no `testedWith` in the engine's table: checked against the source only. */
  "handoff.neverRunLive": "cotejado con el código fuente del agente, nunca ejecutado en vivo",
  "handoff.digestPreview": "El resumen que viaja",
  "handoff.write": "Pásaselo a {agent}",
  "handoff.writing": "escribiendo…",
  "handoff.writeTitle":
    "Escribe una conversación nueva en el historial propio de {agent} en este ordenador. {agent} no se abre.",
  "handoff.copyDocument": "Copiar el documento",
  "handoff.saveDocument": "Guardar como .md",
  "handoff.savedAt": "Guardado en {path}",
  "handoff.ready": "Listo. {agent} la encontrará como una conversación nueva titulada «{title}».",
  "handoff.resumeLine": "Para reanudarla",
  "handoff.steps": "Antes de reanudar",
  "handoff.stepClaude":
    "En esta carpeta, `claude --continue` reanuda ahora la copia; usa `claude --resume <id>` para elegir cualquiera de las dos por su id.",
  "handoff.leftBehind": "Se queda atrás: {list}",
  "handoff.left.thinking": "razonamiento",
  "handoff.left.images": "imágenes: {n}",
  "handoff.left.subagents": "ejecuciones de subagentes: {n}",
  "handoff.left.offloaded": "salidas de herramientas en ficheros aparte: {n}",
  "handoff.left.secrets": "secretos enmascarados: {n}",
  "handoff.left.other": "otros registros: {n}",
  "handoff.already": "Ya pasada a {agent} el {date}. Reanuda aquella:",
  /* A brief receipt: a document was written, nothing can be resumed or launched from it. */
  "handoff.alreadyDocument": "Ya pasada a {agent} el {date} como documento.",
  "handoff.again": "Pasarla otra vez",
  "handoff.done": "Hecho hasta ahora",
  "handoff.doneEmpty": "Aún no hay relevos. El primero aparece aquí con su comando de reanudación.",
  "handoff.receipt": "{source} → {target} · {tier} · {when}",
  /* The receipt of a handoff an agent asked for over the MCP channel, by the name of its key. */
  "handoff.receiptVia": "vía {agent}",
  "handoff.fileGone": "fichero desaparecido — {agent} lo borró o lo movió",
  "handoff.openProject": "abrir el proyecto",
  "handoff.projectMore": "Ver todas en Relevo",
  /* One sentence per fault code of `@panoma/handoff/faults`; `handoffFaultKey` closes the set. */
  "handoff.fault.store-missing": "No se encontró el historial de ese agente en este ordenador.",
  "handoff.fault.conversation-not-found": "Esa conversación ya no está donde estaba.",
  "handoff.fault.ambiguous-id": "Ese prefijo vale para más de una conversación.",
  "handoff.fault.invalid-id": "Ese identificador no tiene la forma de ninguna conversación.",
  "handoff.fault.unreadable-transcript": "No se pudo leer la conversación: el fichero no tiene la forma esperada.",
  "handoff.fault.unsupported-target": "Ese agente no puede recibir una conversación escrita.",
  "handoff.fault.target-store-missing": "El agente de destino no tiene historial en este ordenador: ábrelo una vez y vuelve.",
  "handoff.fault.cwd-missing": "La carpeta de la conversación ya no existe.",
  "handoff.fault.write-failed": "No se pudo escribir la conversación nueva.",
  "handoff.fault.import-command-missing": "OpenCode no está instalado aquí: ejecuta el paso de importación a mano.",
  "handoff.fault.import-command-failed": "La importación de OpenCode falló; el fichero se queda para intentarlo a mano.",
  "handoff.fault.bundle-invalid": "Ese fichero no es un paquete de conversación de panoma.",
  "handoff.fault.too-large": "La conversación pasa de 64 MiB, más de lo que cabe en un relevo.",
  "handoff.fault.nothing-to-carry": "No hay ningún turno que llevar.",
  "handoff.fault.same-store": "Es el mismo historial: para seguir en el mismo agente, inicia sesión y reanuda, o elige «resumen + últimos turnos» para una copia más corta.",
  "handoff.fault.no-space-left": "No queda espacio en el disco.",
  "handoff.fault.permission-denied": "Sin permiso para escribir en el historial de ese agente.",
  "handoff.fault.read-only-disk": "Ese disco es de solo lectura.",
  "handoff.fault.disk-error": "El disco devolvió un error al escribir.",
  /* The block on the project card, in the «pick it up again» view. */
  "project.conversations": "Conversaciones en este disco",
  "project.conversationsLead":
    "Lo que Claude Code, Codex, OpenCode y Gemini CLI guardaron en esta carpeta. No lo que le contaron a panoma — eso está en Agentes.",
  "project.noConversations":
    "Aún no hay conversaciones en esta carpeta. Cuando Claude Code, Codex, OpenCode o Gemini CLI hable aquí, aparece.",
} satisfies Record<string, string>;

/** Every new key is first used in `es`; this type forces `en` to keep pace. */
export type MessageKey = keyof typeof es;

/*
  English does not translate word for word: it names things as a native product would. 'Espacio'
  is 'Disk', not 'Space'; 'Apartados' is 'Hidden', not 'Set aside'. If a translation from here
  sounds like a dictionary, it is wrong even if it is correct.
 */
const en = {
  "apps.jobs.stage.scout": "Read project",
  "apps.jobs.stage.brand": "Read brand",
  "apps.jobs.stage.brain": "Prepare argument",
  "apps.jobs.stage.serve": "Start product",
  "apps.jobs.stage.tour": "Walk screens",
  "apps.jobs.stage.record": "Record",
  "apps.jobs.stage.score": "Prepare music",
  "apps.jobs.stage.study": "Study recording",
  "apps.jobs.stage.plan": "Plan scenes",
  "apps.jobs.stage.narrate": "Prepare voice",
  "apps.jobs.stage.render": "Render",
  "apps.jobs.stage.review": "Review",
  "apps.npmMissing": "panoma needs npm to install apps. Install Node.js with npm and restart panoma.",
  "apps.refreshRequirements": "Check requirements",
  "apps.registryAt": "Version information checked: {date}",
  "apps.jobs.chooseProduction": "Production",
  "apps.jobs.history": "Revision history",
  "apps.jobs.restore": "Restore this revision",
  "apps.catalogEmpty": "No apps are available.",
  "apps.catalogOpen": "View app: {name}",
  "apps.catalogVersion": "Version: {version}",
  "apps.optional": "Optional",
  "apps.setupIntro": "Install the app and check the tools it needs to record and export. You only need to set them up once.",
  "apps.installHint": "After installing, you can check and complete the requirements.",
  "apps.browserHint": "Captures project screens and prepares video scenes.",
  "apps.ffmpegHint": "Assembles the video and exports the final files.",
  "apps.brainHint": "Helps prepare the script and creative decisions. Model credentials are managed in AI.",
  "apps.configureModel": "Configure model and credentials",
  "apps.voiceHint": "Adds narration to the video. When voice is enabled, narration text is sent to ElevenLabs.",
  "apps.enableVoice": "Use ElevenLabs for narration",
  "apps.providersSaved": "Preferences saved. They apply to future productions.",
  "apps.providersFailed": "Could not save preferences. Please try again.",
  "apps.saving": "Saving…",
  "apps.spendLink": "View usage and limits in Spend",
  "apps.key.loading": "Checking for a saved key…",
  "apps.key.loadFailed": "Could not check the saved key. Only the local operator can manage credentials.",
  "apps.key.label": "ElevenLabs API key",
  "apps.key.hint": "Paste the key from your ElevenLabs account. It is saved in Panoma’s local configuration; you do not need to edit an .env file.",
  "apps.key.save": "Save key",
  "apps.key.get": "Get an API key",
  "apps.key.configured": "Key saved",
  "apps.key.missing": "API key needed",
  "apps.key.saved": "Key saved. It will be used when narration is enabled.",
  "apps.key.removed": "Key removed from Panoma.",
  "apps.key.saveFailed": "Could not save the change. Check the key and try again.",
  "apps.key.required": "Save an API key to use narration, or turn voice off before saving.",
  "apps.key.replace": "Replace key",
  // The same set as the Spanish half; a key missing in either does not compile.
  "apps.fault.offline": "The published version could not be looked up, and none is cached. Check the connection and try again.",
  "apps.fault.nodeTooOld": "The app needs a newer Node.js than this machine has. Required: {needed}. Installed: {running}.",
  "apps.fault.npmTooOld": "The app needs a newer npm than this machine has. Required: {needed}. Installed: {running}.",
  "apps.fault.engineUnsupported": "npm rejected this machine's version of Node.js or npm, so the app cannot be installed here.",
  "apps.fault.doesNotStart": "The app installed, but it did not start.",
  "apps.fault.cancelled": "The operation was cancelled.",
  "apps.fault.timeout": "The operation took too long and was stopped.",
  "apps.fault.stalled": "The download stopped making progress and was halted.",
  "apps.fault.processFailed": "npm ended with an error.",
  "apps.fault.noPreviousVersion": "There is no previous version to go back to.",
  "apps.fault.notInstalled": "The app is not installed.",
  "apps.fault.operationInProgress": "This app already has an operation running. Wait for it to finish.",
  "apps.fault.playwrightMissing": "This version of the app does not ship Playwright, so it cannot download the browser.",
  "apps.fault.browserNotDeclared": "This version of the app declares no browser download.",
  "apps.fault.malformedRequirements": "The app did not answer with the requirements it declares.",
  "apps.fault.incompatibleProtocol": "This version of the app speaks a protocol this panoma does not understand. Update panoma.",
  "apps.fault.stagedUpdateInvalid": "The staged update could not be read and was discarded. The active version still works.",
  "apps.fault.diskUnreadable": "The app's installation on disk could not be read.",
  "apps.fault.unknownApp": "That app is not in the catalog.",
  "apps.fault.brokenPackage": "The downloaded package is damaged, so it was not installed.",
  "apps.fault.noSpaceLeft": "There is no space left on the disk.",
  "apps.fault.permissionDenied": "panoma is not allowed to write where it keeps apps.",
  "apps.fault.readOnlyDisk": "The disk where panoma keeps apps is read-only.",
  "apps.fault.tooManyOpenFiles": "The system would not open more files. Close something and try again.",
  "apps.fault.diskError": "A disk operation failed.",
  "apps.fault.commandDidNotStart": "The program that performs the installation could not be launched.",
  "apps.fault.localCatalogRequired": "This only works on the local catalog on your machine.",
  "apps.fault.unknownOperation": "That operation does not exist.",
  "apps.fault.appNotEnabled": "The app is disabled. Enable it before using it.",
  "apps.fault.providerNotEnabled": "That model is not enabled for this app.",
  "apps.fault.budgetExhausted": "Today's app call budget is used up.",
  "apps.faultNext.budget": "Raise it on the Spend screen, or wait for tomorrow: the day is counted in your local time.",
  "apps.faultNext.provider": "Switch it on on the app's page, under “Script and voice”.",
  "apps.faultNext.install": "Install it and switch it on from its page.",
  "apps.fault.providerKeyMissing": "The chosen model has no key. Set one in AI.",
  "apps.fault.voiceKeyMissing": "The ElevenLabs key is missing. Save one before using narration.",
  "apps.fault.requirementMissing": "The app has requirements left to complete. Check them before creating the video.",
  "apps.fault.interrupted": "The catalog restarted while the job was running.",
  "apps.fault.appFailed": "The app failed without saying why.",
  "apps.fault.invalidIdentity": "The chosen project has no valid catalog identity.",
  "apps.fault.musicOutsideProject": "The music track has to live inside the project.",
  "apps.fault.confirmationRequired": "Enabling a model or a voice needs an explicit confirmation.",
  "apps.fault.invalidSetting": "That setting is not valid.",
  "apps.fault.appSpokeWrong": "The app answered something panoma could not read.",
  "apps.fault.badRequest": "The request was not valid.",
  "apps.fault.localUrlRequired": "The address has to be on this machine (localhost).",
  "apps.fault.jobNotFound": "That job no longer exists.",
  "apps.fault.projectNotFound": "That project is no longer in the catalog.",
  "apps.fault.ambiguousProject": "More than one project has that identity. Choose one.",
  "apps.fault.requestFailed": "The request to the app failed.",
  "apps.fault.artifactNotFound": "That file is no longer where the production left it.",
  "apps.fault.reviewFailed": "The video review did not pass.",
  "apps.fault.stageFailed": "A stage of the production failed.",
  "apps.fault.noProduction": "This production produced no video.",
  "apps.fault.internal": "panoma stopped on an internal check. The code is quoted below.",
  "apps.key.remove": "Remove key",
  "apps.key.removeConfirm": "Narration will need another key to work. This removes it from Panoma; it does not revoke it in ElevenLabs.",
  "apps.launch.title": "Create a video",
  "apps.launch.intro": "Choose a project, review the preview, and export the video when it is ready.",
  "apps.launch.project": "Catalog project",
  "apps.launch.choose": "Select a project",
  "apps.launch.open": "Open production",
  "apps.launch.empty": "No projects available",
  "apps.launch.emptyHint": "To keep its productions, a project needs a stable identity in the catalog. Add or rescan a project.",
  "apps.launch.catalog": "View catalog",
  "apps.launch.loadError": "Could not load projects.",
  "apps.launch.loading": "Loading projects…",
  "apps.launch.missingProject": "The selected project is no longer available. Choose another project.",
  "apps.launch.openHint": "Opens the production screen. The video is generated when you request it there.",
  "apps.launch.setupHint": "You can choose a project now. Finish setup and enable the app to open production.",
  "apps.launch.setupLink": "Review setup",
  "apps.title": "Apps",
  "apps.intro": "Optional official programs for your projects. Set up each app here, then use it with a project from your catalog.",
  "apps.videoSummary": "Turn a project into product videos, tutorials and reviewed clips.",
  "apps.official": "Official from panoma",
  "apps.open": "View app",
  "apps.back": "All apps",
  "apps.loading": "Loading apps…",
  "apps.retry": "Reload",
  "apps.install": "Install app",
  "apps.update": "Update",
  "apps.rollback": "Use previous version",
  "apps.enable": "Enable",
  "apps.disable": "Disable",
  "apps.uninstall": "Uninstall and keep productions",
  "apps.clean": "Delete productions",
  "apps.cleanConfirm": "This deletes this app’s productions. Space: {bytes}. This cannot be undone.",
  "apps.confirm": "Confirm deletion",
  "apps.cancel": "Cancel",
  "apps.check": "Check for updates",
  "apps.requirements": "App setup",
  "apps.present": "Available",
  "apps.missing": "Missing",
  "apps.unchecked": "Not checked",
  "apps.checkedAt": "Checked: {date}",
  "apps.browser": "Browser for recording and rendering",
  "apps.ffmpeg": "FFmpeg and FFprobe",
  "apps.download": "Accept and download browser",
  "apps.browserConsent": "Playwright downloads Chrome for Testing from Google’s servers. Their terms apply. Approximate download: {n} MB.",
  "apps.terms": "Read terms",
  "apps.ffmpegInstall": "Install FFmpeg with your system’s package manager: brew install ffmpeg · choco install ffmpeg · apt install ffmpeg.",
  "apps.providers": "Script and voice",
  "apps.providersIntro": "You can create videos without external providers. Enable a model or narration when you need them; usage is charged to your provider account.",
  "apps.brain": "Model for script and decisions",
  "apps.voice": "ElevenLabs voice",
  "apps.providerConfirm": "I understand what information is sent and that the provider uses my account.",
  "apps.providerSave": "Save script and voice settings",
  "apps.none": "Off",
  "apps.auto": "Use a configured provider",
  "apps.versions": "Versions and storage",
  "apps.version": "Active: {version}",
  "apps.previous": "Previous: {version}",
  "apps.available": "Available: {version}",
  "apps.staged": "Waiting to activate: {version}",
  "apps.packageSpace": "Installation: {bytes}",
  "apps.dataSpace": "Productions: {bytes}",
  "apps.privacy": "The manager contacts registry.npmjs.org. Browser downloads contact Playwright and Google servers. Providers receive data only when enabled.",
  "apps.legal": "License and notices",
  "apps.license": "License",
  "apps.notices": "Notices",
  "apps.codecs": "Codecs",
  "apps.createVideo": "Create video",
  "apps.continueProject": "Continue to the project’s production",
  "apps.needsSetup": "Set up panoma video to create a production for this project.",
  "apps.videoGateTitle": "“Create video” comes from an app",
  "apps.videoGateBody":
    "panoma video turns this project into product videos, tutorials and reviewed clips. It is a separate app and it lives on the Apps screen; once it is ready, this button opens the production screen.",
  "apps.videoGateGo": "See the app in Apps",
  "apps.more": "More",
  "apps.moreSections": "More sections",
  "apps.error": "App response",
  "apps.status.absent": "Not installed",
  "apps.status.installed": "Installed · requirements missing",
  "apps.status.ready": "Ready to create",
  "apps.status.update": "Update available",
  "apps.status.broken": "Needs repair",
  "apps.status.disabled": "Disabled",
  "apps.status.installing": "Installing",
  "apps.status.failed": "Operation failed",
  "apps.status.staged": "Update staged",
  "apps.jobs.title": "Recent jobs",
  "apps.jobs.empty": "No jobs yet.",
  "apps.jobs.pending": "Queued",
  "apps.jobs.running": "Running",
  "apps.jobs.cancelling": "Cancelling",
  "apps.jobs.cancelled": "Cancelled",
  "apps.jobs.failed": "Failed",
  "apps.jobs.done": "Complete",
  "apps.jobs.retry": "Retry",
  "apps.jobs.cancel": "Cancel job",
  "apps.jobs.progress": "Progress: {n}%",
  "apps.jobs.production": "Productions",
  "apps.jobs.productionIntro": "Create a first cut, review the result and export when ready. You can close this tab while the job runs.",
  "apps.jobs.noIdentity": "This project needs a repository identity to keep its productions when it moves.",
  "apps.jobs.language": "Language",
  "apps.jobs.url": "Address already running (optional)",
  "apps.jobs.urlHint": "If the product is already running on this machine with real data in it, name its address and the camera films that instead of starting an empty copy. Local addresses only: localhost or 127.0.0.1.",
  "apps.jobs.format": "Format",
  "apps.jobs.goal": "Video type",
  "apps.jobs.promo": "Product promotion",
  "apps.jobs.tutorial": "Tutorial",
  "apps.jobs.spotlight": "Feature spotlight",
  "apps.jobs.start": "Create preview",
  "apps.jobs.preview": "Preview",
  "apps.jobs.contacts": "Contact sheet",
  "apps.jobs.review": "Review video",
  "apps.jobs.export": "Export final versions",
  "apps.jobs.exportVariant": "Export · {format} · {language}",
  "apps.jobs.historical": "This production predates the current saved story. You can view and download its files.",
  "apps.jobs.current": "Open current production",
  "apps.jobs.savedStory": "Revisions and exports use the current saved story. Earlier videos are preserved.",
  "apps.jobs.artifacts": "Files and exports",
  "apps.jobs.story": "Read scenes",
  "apps.jobs.scene": "Scene",
  "apps.jobs.revision": "Scene change",
  "apps.jobs.revise": "Revise scene",
  "apps.jobs.revisionHelp": "Select a ProductPromo scene and write its replacement text. This creates a new revision.",
  "apps.jobs.result": "Result and review",
  "apps.jobs.reviewStatus": "Review: {status}",
  "apps.jobs.reviewChecks": "Checks",
  "apps.fault.stageFailedAt": "The “{stage}” stage failed.",
  "apps.jobs.formatVertical": "Vertical",
  "apps.jobs.formatHorizontal": "Landscape",
  "apps.jobs.formatSquare": "Square",
  "apps.jobs.formatForV": "Phone: Reels, Shorts, TikTok",
  "apps.jobs.formatForH": "YouTube, web and slides",
  "apps.jobs.formatForS": "Feed posts",
  "apps.jobs.goalTrailer": "Trailer",
  "apps.jobs.goalChangelog": "Release changelog",
  "apps.jobs.goalSitetour": "Site tour",
  "apps.jobs.stages": "Production stages",
  "apps.jobs.stageState.done": "Done",
  "apps.jobs.stageState.current": "In progress",
  "apps.jobs.stageState.pending": "Pending",
  "apps.jobs.stageState.skipped": "Skipped",
  "apps.jobs.stageState.failed": "Failed",
  "apps.jobs.starting": "Starting the app…",
  "apps.jobs.elapsed": "Running for {time}.",
  "apps.jobs.took": "Took {time}.",
  "apps.jobs.requestedBy": "Asked by {name} over MCP.",
  "apps.jobs.ownCopy": "a copy the app started itself",
  "apps.jobs.ownCopyFailed": "The camera filmed a copy of the product that the app started itself.",
  "apps.jobs.ownCopyWhy": "A product whose data lives outside its folder opens empty in that copy — this catalog does, it keeps everything in its own home — and a promotion cannot be planned from an empty screen. If the product is already running on this machine, give its address and create the preview again.",
  "apps.jobs.ownCopyNext": "Address already running, above.",
  "apps.jobs.runningNow": "Answering on this machine right now:",
  "apps.jobs.runningDeclared": "the port this project's scripts declare",
  "apps.jobs.runningFolder": "started from this project's folder",
  "apps.nothingNewer": "Nothing newer: {version} is the latest version the registry reports.",
  "apps.nothingNewerHint": "If you just published one, the registry takes a moment to report it: check for updates again, then update.",
  "apps.jobs.minutes": "{m} min {s} s",
  "apps.jobs.seconds": "{s} s",
  "apps.jobs.report": "Latest production",
  "apps.jobs.reportDone": "The production finished. The preview is below.",
  "apps.jobs.notPlanned": "The app found nothing to make a “{goal}” video from. Its reason:",
  "apps.jobs.notPlannedAny": "The app found nothing to make any video from. Its reasons:",
  "apps.jobs.otherGoals": "Other kinds of video that did not work out either",
  "apps.jobs.lastSaid": "The last thing the app said",
  "apps.jobs.beforeTitle": "Before producing",
  "apps.jobs.beforeIntro": "What this production will use. It is changed on the app's page.",
  "apps.jobs.beforeApp": "App",
  "apps.jobs.beforeBrain": "Model for the script",
  "apps.jobs.beforeVoice": "Narration",
  "apps.jobs.beforeProject": "Project",
  "apps.jobs.beforeReady": "All set",
  "apps.jobs.beforeNotReady": "Something is missing",
  "apps.jobs.changeInApp": "Change in the app",
  "apps.jobs.voiceOff": "No narration",
  "apps.jobs.voiceOn": "ElevenLabs",
  "apps.next.install": "Next step: install the app.",
  "apps.next.enable": "Next step: enable the app.",
  "apps.next.check": "Next step: check the requirements.",
  "apps.next.browser": "Next step: download the browser.",
  "apps.next.ffmpeg": "Next step: install FFmpeg on your system and check again.",
  "apps.next.create": "All set: choose a project and open its production.",
  "apps.stepOf": "Step {n} of {total}",
  "apps.working.install": "Installing the app…",
  "apps.working.update": "Updating the app…",
  "apps.working.browser": "Preparing the browser download…",
  "apps.working.browserPercent": "Downloading the browser: {n}%",
  "apps.working.doctor": "Checking the requirements…",
  "apps.working.other": "Operation in progress…",
  "apps.browserOwnCopy": "panoma keeps its own copy of the browser, apart from any on your system, so recordings come out the same on every machine.",
  "spend.family.app": "App providers",
  "spend.familyHint.app": "Calls to model and voice providers enabled in Panoma apps. Counts attempts, even if they do not finish.",
  "spend.kind.app": "App model",
  "spend.family.handoff": "Handoffs",
  "spend.familyHint.handoff":
    "The digest a model writes of a conversation before it is handed to another agent. One conversation, one action of yours.",
  "spend.kind.handoff": "Handoff digest",
  "watch.off":
    "The watcher isn’t running: new projects and today’s commits may not show up until you scan again.",
  "watch.catalogDetails": "Catalog overview",
  "watch.catalogFolders": "Catalog folders",

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
  "shell.updateReady": "There is a newer panoma than yours: {latest}",
  "shell.updateHave": "This catalog is running {running}.",
  "shell.updateHowNpm":
    "Update it with “npm i -g panoma@latest” and restart the catalog with “{cli} down” and “{cli} up”: updating does not replace the process already running.",
  "shell.updateHowNpx":
    "Update it with “npx panoma@latest” and restart the catalog with “{cli} down” and “{cli} up”: updating does not replace the process already running.",
  "shell.restartReady": "You already updated panoma, but this screen is served by the previous version: {running}",
  "shell.restartHave": "You already have {installed} on disk.",
  "shell.restartHow": "Restart the catalog with “{cli} down” and “{cli} up”.",
  "shell.localAccountUpdate": "Local account · there is a newer panoma",
  "shell.localAccountRestart": "Local account · restart the catalog",
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
  "shell.version": "panoma {version}",
  "shell.language": "Language",
  "shell.hideSidebar": "Collapse menu",
  "shell.showSidebar": "Expand menu",

  "nav.projects": "Projects",
  "nav.unsaved": "Unbacked",
  "nav.searchCode": "Code",
  "nav.credentials": "Keys",
  "nav.agents": "MCP",
  "nav.ai": "AI",
  "nav.spend": "Spend",
  "nav.packages": "Packages",
  "nav.activity": "Runs",
  "nav.copies": "Copies",
  "nav.bridge": "Bridge",
  "nav.handoff": "Handoff",
  "dest.bridge": "The bridge",
  "bridge.setup.title": "Setup",
  "bridge.setup.progress": "Steps completed: {completed} of {total}",
  "bridge.setup.step": "Step {n} of {total}",
  "bridge.state.done": "Ready",
  "bridge.state.next": "Next step",
  "bridge.state.waiting": "Pending",
  "bridge.refresh": "Refresh status",
  "bridge.refreshing": "Refreshing…",
  "bridge.refreshed": "Status refreshed.",
  "bridge.terminal": "Run in your terminal:",
  "bridge.copyCommand": "Copy command: {command}",
  "bridge.copyFailed": "Could not copy. Select the command and copy it manually.",
  "bridge.hooksFailed": "Could not install hooks. Check that Panoma is still running and try again.",
  "bridge.step.catalog.purpose": "Bring your project folders, technologies and status together in one place.",
  "bridge.step.catalog.go": "View projects",
  "bridge.step.model.purpose": "Let Panoma analyze your projects and propose notes for memory.",
  "bridge.step.model.manage": "Review AI setup",
  "bridge.step.model.detected": "Configuration detected. Check the provider and its credentials in AI.",
  "bridge.step.agent.purpose":
    "Give Claude Code, Cursor or another agent access to your project context and memory through MCP: the brief, the notes and the fifteen tools.",
  "bridge.step.agent.manage": "Manage agents",
  "bridge.step.agent.seen": "A connection has been received. This does not indicate that the agent is currently active.",
  "bridge.step.agent.terminal": "Connect Claude Code from the terminal",
  "bridge.step.hooks.purpose": "Hooks record commits without relying on the agent to remember them.",
  "bridge.step.hooks.scope": "Installs in the catalog’s Git repositories and preserves existing hooks. Also integrates activity and notes when the project already has Claude Code configuration.",
  "bridge.step.hooks.terminal": "Run inside each project folder:",
  "bridge.step.hooks.noGit": "There are no Git repositories available for hooks. Add a project with Git to the catalog to continue this step.",
  "bridge.activity.lead": "Catalog totals, not just today’s activity.",
  "bridge.activity.empty": "Waiting for the first activity",
  /*
    The one thing on this screen nobody here can press.

    The journal fills when an agent working in a project calls `panoma_log` — and the copy used to
    say «it turns on by itself once the rest is running», which is true and tells the reader nothing
    they can act on. Somebody with all four of their own parts done, reading that, is looking for
    the button. There is no button. So the tool is named, and what makes an agent reach for it.
    It sat under `bridge.step.alive.*` while the journal was a fifth step; it is the empty state of
    the activity card now, and the name says so.
   */
  "bridge.activity.pending": "After finishing a task, ask your agent to record its work with {tool}. This is where you will see the activity that feeds memory.",
  "bridge.activity.review": "Review proposals in each project. You decide which notes to keep; path-triggered notes are delivered when working on those files.",
  "bridge.activity.openTwin": "Explore the Twin",
  "bridge.system.title": "System status",
  "bridge.system.watcherOn": "Detects changes in your folders and updates the catalog.",
  "bridge.system.watcherOff": "Folders are not being watched. Scan again to pick up recent changes.",
  "bridge.system.ablationOn": "Ablation is on: some agent requests receive context without memory to compare results.",
  "bridge.system.ablationOff": "Ablation is off. This is the normal state; no setup is required.",
  "bridge.system.openScale": "View scale report (JSON)",
  "bridge.title": "Connect your projects to your agents",
  "bridge.titleReady": "Setup is ready",
  "bridge.lead": "Set up how Panoma shares your project context with your agents and preserves what they learn between sessions.",
  "bridge.leadReady": "You have completed setup. Activity will appear when your agents log work in a project.",
  "bridge.step.catalog.title": "Project catalog",
  "bridge.step.catalog.detail": "Projects in the catalog: {count}",
  "bridge.step.catalog.pending": "Scan the folder where you keep your projects. Replace ~/Desktop with its path if they are stored elsewhere.",
  "bridge.step.model.title": "AI model",
  "bridge.step.model.detail": "Configurations detected: {count}",
  "bridge.step.model.go": "Set up AI",
  "bridge.step.agent.title": "Coding agent",
  "bridge.step.agent.detail": "Agents that have connected: {count}",
  "bridge.step.agent.keyUnused": "The key exists, but has not been used yet. Install the configuration and restart your agent session to complete the connection.",
  "bridge.step.agent.go": "Connect agent",
  "bridge.step.hooks.title": "Automatic logging",
  /*
    «of {total}» is the ones that can carry a hook, not the whole catalog. A folder without git has
    nowhere to keep one, and counting it invented a debt that could never be paid: 44 of 76, with
    the hook in all 44 that had git, read as unfinished for ever.
   */
  "bridge.step.hooks.detail": "Repositories with hooks: {count} of {total}",
  "bridge.restartHint": "After installing, restart your agent session to load the configuration.",
  "bridge.todayTitle": "Activity and memory",
  "bridge.stat.journal": "Journal entries",
  "bridge.stat.approved": "Available notes",
  "bridge.stat.sleeping": "Path-triggered notes",
  "bridge.stat.pending": "Pending proposals",
  "bridge.stat.consultations": "Twin consultations",
  "bridge.stat.watcher": "Catalog watcher",
  "bridge.stat.ablation": "Memory experiment",
  "bridge.on": "On",
  "bridge.off": "Off",
  "bridge.copy": "Copy",
  "bridge.copied": "Copied",
  "bridge.step.hooks.install": "Install hooks in the catalog",
  "bridge.step.hooks.installing": "Installing hooks…",
  "bridge.hooksDone": "Installed: {installed} · Without Git: {noRepo} · Existing hooks preserved: {foreign} · Failed: {failed}",
  "bridge.hooksAlt": "Install from the terminal",
  "bridge.hooksNoCli": "The server cannot find the panoma command. Use the terminal installation option.",
  "projectHooks.on": "Hooks installed: this project's journal writes itself.",
  "projectHooks.off": "No hooks: the catalog only learns what the agent remembers to tell it.",
  "projectHooks.install": "Install them",
  "bridge.scaleHint": "The scale compares corrections with and without memory. Its technical report is available through the API.",
  "nav.disk": "Disk",
  "nav.twin": "Twin",
  "nav.hidden": "Hidden",

  "dest.agents": "MCP: connect your agents",
  "dest.handoff": "Handoff: continue a conversation in another agent",
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

  "catalog.title": "Your projects",
  "catalog.presentation": "Catalog presentation",
  "catalog.discreet": "Discreet mode",
  "catalog.sort": "Sort",
  "catalog.latestCommit": "Latest commit",
  "catalog.share": "Share",
  "catalog.list": "List",
  "catalog.grid": "Grid",
  "catalog.resume": "Resume",
  "catalog.filteredBy": "Filter: {filter}",
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
  "today.activity": "Recent activity",
  "today.proposalCount": "Proposals: {n}",
  "today.findingCount": "Findings: {n}",
  "today.commitCount": "Commits: {n}",
  "today.projectCount": "Projects: {n}",
  "today.bornCount": "New: {n}",
  "today.since": "since {when}",
  "today.last24h": "in the last 24 hours",
  "today.nothing": "No recorded activity {period}",
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
  "openAll.button": "Open everything",
  "openAll.buttonTitle": "Open everything you use in this project, at once",
  "openAll.willOpen": "Will open: {list}",
  "openAll.checking": "Checking what it can open…",
  "openAll.openingList": "Opening: {list}",
  "openAll.busy": "opening…",
  "openAll.doneAll": "✓ all open",
  "openAll.donePartial": "Opened {done} of {n}",
  "openAll.doneNone": "Nothing could be opened.",
  "openAll.missing": "no longer on this machine",
  "openAll.missingLink": "no longer among this project’s links",
  "openAll.configure": "Configure “Open everything”…",
  "openAll.title": "What “Open everything” opens for {name}",
  "openAll.intro":
    "One click and everything you need to work is in front of you: the links, a terminal, the editor, your agent. They open in this order, and the last one ends up on top.",
  "openAll.opens": "Opens",
  "openAll.doesNotOpen": "Doesn’t open",
  "openAll.include": "Open {name}",
  "openAll.moveUp": "Move {name} up",
  "openAll.moveDown": "Move {name} down",
  "openAll.sourceService": "detected in the project",
  "openAll.sourceAccount": "from your accounts",
  "openAll.sourceDistribution": "where it is published",
  "openAll.sourceRemote": "git remote",
  "openAll.sourceCustom": "written here",
  "openAll.commandLabel": "Command to run when the terminal opens (optional)",
  "openAll.commandPlaceholder": "for example, pnpm run dev",
  "openAll.commandHint":
    "Your shell runs it in the project folder, exactly as written. Whatever it starts stays in the window.",
  "openAll.useSuggested": "Use “{command}”",
  "openAll.addTerminal": "Add a terminal",
  "openAll.addLink": "Add a link",
  "openAll.linkName": "Link name",
  "openAll.linkUrl": "Link address",
  "openAll.linkPlaceholder": "vercel.com/… · localhost:3000",
  "openAll.removeLink": "Remove the link {name}",
  "openAll.customLink": "Link",
  "openAll.badUrl": "One link can’t be understood. https://…, a bare domain or localhost:port all work.",
  "openAll.badLink": "That address can’t be opened.",
  "openAll.saveAndOpen": "Save and open",
  "openAll.save": "Save",
  "openAll.saving": "saving…",
  "openAll.openOnly": "Open",
  "openAll.cancel": "Cancel",
  "openAll.reset": "Back to the suggestion",
  "openAll.noIdentity":
    "This project has no repository, so the plan isn’t saved: what is ticked opens, and commands and custom links can’t be used.",
  "openAll.nothingChosen": "Tick at least one thing.",
  "openAll.noCandidates": "Nothing to open here yet: no editor installed and no link detected.",
  "openAll.saved": "Plan saved.",
  "openAll.notSaved": "The plan couldn’t be saved: this project has no repository.",
  "openAll.emptyPlan": "There is nothing to open.",
  "openAll.badPlan": "The plan can’t be understood.",
  "openAll.badPlanCommand": "A command can only go with a terminal.",
  "openAll.badPlanKey": "One step isn’t recognised.",
  "openAll.badPlanUrl": "One link can’t be understood.",
  "openAll.badPlanTooMany": "Too many steps: the maximum is {n}.",
  "openAll.unknownAction": "I don’t know how to “{action}”.",
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
  "project.mdReviewAgain": "ask again, even if nothing changed",
  "project.mdReviewCached": "Answered from the saved opinion: the file has not changed since it was written.",
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
  "project.aiRewrite": "write it again, even if nothing changed",
  "project.aiCached": "Answered from the saved description: nothing changed since it was written.",
  "project.aiUnsaved":
    "Kept only while this page is open: the project has no repository, so panoma has nowhere to keep it.",
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
  "api.action.handoff": "Reading and writing agent conversations",
  "api.action.openAll": "Opening everything",
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
  "api.cardSpent": "Today’s descriptions and reviews are spent: {used} of {cap}.",
  "api.handoffSpent": "Today’s handoff digests are spent: {used} of {cap}.",
  "api.handoffSpentHint":
    "Come back tomorrow, raise the cap in /spend or export PANOMA_HANDOFF_BUDGET. The handoff without a model is still available.",
  "api.cardSpentHint":
    "They come back tomorrow, or raise the cap on the Spend screen (/spend) or with PANOMA_CARD_BUDGET.",
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
  "notes.extraction": "Learning from sessions",
  "notes.jobsPending": "Queued or running: {n}",
  "notes.jobsDeferred": "Deferred: {n}",
  "notes.jobsFailed": "With a failure: {n}",
  "notes.jobsHint": "Learning leaves proposals for your review. It waits when budget or space is unavailable. A provider failure retries up to three times; a cut-off answer is asked for once more with more room, and an unreadable one is never paid for again. The original history remains available.",
  "notes.coverage": "Latest processed session: included records {selected}/{total}; omitted {omitted}; clipped {clipped}.",
  "twinMemory.errStale": "This record changed in another view. Refresh before changing it again.",
  "twinPath.title": "The chain",
  "twinPath.lead":
    "Your history becomes what you think, what you think goes down into one file, and that file is what every agent of yours reads. Each step has its own section below.",
  "twinPath.history": "Your history",
  "twinPath.historyNote": "histories you have let it read",
  "twinPath.mind": "What you think",
  "twinPath.mindNote": "criteria and decisions of yours",
  "twinPath.file": "The file",
  "twinPath.fileNote": "characters in TASTE.md",
  "twinPath.agents": "Your agents",
  "twinPath.agentsNote": "projects that read it",
  "twin.memoryOnlyTitle": "Your decisions are already remembered",
  "twin.memoryOnlyIntro": "Your recorded decisions are available below. The portrait of your preferences is still empty.",
  "twinTeach.episodes": "Recorded decisions and goals",
  "twinMemory.currentVersion": "Open active version",
  "notes.always": "On opening the project",
  "notes.scoped": "When working on these files",
  "notes.scope": "When it applies",
  "notes.scopeAll": "Throughout the project",
  "notes.scopePath": "At a specific path",
  "notes.where": "Relative path or folder/**",
  "notes.whereHint": "Exact file or folder ending in /**. The rule is delivered when that path is requested.",
  "notes.awakeBudget": "Opening characters: {used}/{budget}",
  "notes.scopedBudget": "Path rules: {used}/{budget}",
  "notes.pendingBudget": "Pending proposals: {used}/{budget}",
  "notes.anchors": "Watched paths: {n}",
  "notes.noAnchors": "No automatic file checks",
  "notes.challengeHint": "These notes are withheld from agents. Confirm them only if they remain true; their checks will be rebuilt against the current disk.",
  "notes.reviewFirst": "Proposed and challenged notes are withheld until you approve them.",
  "notes.hint": "Project rules approved by you. Some are delivered on opening; others when the relevant files are requested.",
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
  /* The memory bridge of delivery A; see the Spanish block for why every key lands at once. */
  "memory.deliveryUnknown": "Receipt could not be verified.",
  "memory.deliveryPartial": "The record contains only part of the memory.",
  "memory.coreIncomplete": "Required memory is missing for this task.",
  "memory.requiresCheck": "A condition still needs checking.",
  "memory.captureConsent": "Read local activity from the selected sources.",
  "memory.extractConsent": "Use new messages to propose project memory.",
  "memory.twinAutoLearnConsent": "Learn my preferences from new messages.",
  "memory.preConsentUnknown": "This range may predate permission and was not processed.",
  "memory.backlog": "Pending ranges: {count}",
  "memory.readFailed": "The source could not be read.",
  "memory.staged": "The result is saved and waiting to be added.",
  "memory.purgePreview": "Review the content to be deleted.",
  "memory.purgeRemaining": "Copies pending deletion: {count}",
  "memory.staleRevision": "The content changed. Review the current version.",
  "memory.checkUnknown": "There is not enough verification.",
  "memory.outcomeConfirmed": "Outcome verified for this case.",
  "memory.falsePositive": "Mark this occurrence as a false alarm.",
  "memory.publicationConflict": "The file changed and needs reconciliation.",
  "memory.capacityLimited": "Work is arriving faster than the quota can process it.",
  "memory.quotaPaused": "New automatic memory is paused: the storage quota of {scope} is reached. Nothing is deleted to make room; delete something or raise the limit.",
  "memory.quotaNear": "The storage quota of {scope} is almost reached: new automatic memory pauses at the limit.",
  "memory.quotaLine": "Memory stored by {scope}: {used} of {limit}",
  "memory.quotaScopeCatalog": "the catalog",
  "memory.quotaScopeProject": "this project",
  "memory.hooksTitle": "Hooks by event",
  "memory.eventSessionStart": "At session start (brief)",
  "memory.eventPreToolUse": "Before an edit (signal)",
  "memory.eventStop": "At the end of a turn (scan)",
  "memory.eventSessionEnd": "At session end (pointer)",
  "memory.hookInstalled": "installed",
  "memory.hookLegacy": "older version",
  "memory.hookMissing": "missing",
  "memory.postCommit": "git post-commit: installed",
  "memory.postCommitMissing": "git post-commit: missing",
  "memory.settingsNone": "No Claude Code settings in this folder: only the git hook can live here.",
  "memory.durable": "The hook command exists on this disk and does not depend on your terminal's PATH.",
  "memory.notDurable": "The hook command cannot be found without your terminal's PATH: the hooks fail silently. Install them again.",
  "memory.durableUnknown": "There is no hook of ours to judge.",
  "memory.deliveryTitle": "Memory deliveries",
  "memory.offers": "Offers prepared: {n}",
  "memory.receptionsFull": "Received whole: {n}",
  "memory.receptionsPartial": "Received in part: {n}",
  "memory.receptionsUnknown": "Receipt unverified: {n}",
  "memory.receptionsNotObserved": "Not observed in the record: {n}",
  "memory.unbound": "Not bound to a session: {n}",
  "memory.attemptsFailed": "Failed sends: {n}",
  "memory.quarantined": "The deletion journal does not match the catalog: memory is neither delivered nor captured until it is reconciled.",
  "memory.quarantineReason": "Reason: {reason}",
  "memory.captureOn": "Receipt reading: on.",
  "memory.captureOff": "Receipt reading: not permitted. Without it there are no receipts to count.",
  "memory.captureLink": "Permissions by source",
  "memory.deliveriesTitle": "Deliveries",
  "memory.deliveriesHint": "The latest memory prepared for an agent: which units travelled, through which channel, and whether the session's record contains them. The text is not repeated here; each unit links to its own record.",
  "memory.deliveriesEmpty": "No delivery recorded yet.",
  "memory.channelBrief": "at session start",
  "memory.channelSignal": "signal on edit",
  "memory.channelMcp": "MCP",
  "memory.channelHandoff": "handoff",
  "memory.statusReady": "Ready.",
  "memory.statusConflict": "Two active decisions contradict each other.",
  "memory.statusUnavailable": "Unavailable.",
  "memory.receptionFull": "Received whole.",
  "memory.receptionNotObserved": "Not observed in the record.",
  "memory.receptionNone": "No receipt yet.",
  "memory.attemptSent": "sent",
  "memory.attemptFailed": "the send failed",
  "memory.attemptUnknown": "send result unknown",
  "memory.purgedOffer": "Content deleted; the record that it existed remains.",
  "memory.offerUnbound": "not bound to a session",
  "memory.unitsTravelled": "Units delivered: {n}",
  "memory.unitsReferenced": "Referenced only, to read separately: {n}",
  "memory.unitsIntact": "Units intact in the record: {intact} of {total}",
  "memory.kindNote": "note",
  "memory.kindCriterion": "criterion",
  "memory.kindDecision": "decision",
  "memory.kindCommitment": "commitment",
  "memory.kindCase": "case",
  "memory.revision": "rev. {rev}",
  "memory.openUnit": "Open",
  "memory.omissionChannelLimit": "Did not fit the channel: {count}",
  "memory.omissionUnresolvedScope": "Without a project to name: {count}",
  "memory.omissionConflict": "Withheld for a contradiction: {count}",
  "memory.omissionIncompleteCore": "Required ones that did not fit: {count}",
  "memory.omissionOther": "{reason}: {count}",
  "memory.openStatus": "View delivery report (JSON)",
  "memory.bridgeTitle": "Memory delivered",
  "memory.bridgeLead": "What we know about delivery, each thing by its own evidence: installed is not executed, and executed is not received.",
  "memory.judged": "Projects with Claude Code settings: {n}",
  "memory.eventCounts": "installed: {installed} · older version: {legacy} · missing: {missing}",
  "memory.durableCount": "Command verified on disk: {yes} · not found: {no}",
  "memory.hostsTitle": "Programs observed",
  "memory.hostVersion": "version {version}",
  "memory.hostVersionUnknown": "version unknown",
  "memory.invocationObserved": "invocation observed",
  "memory.invocationFailed": "the last invocation failed",
  "memory.invocationUnknown": "invocation not observed",
  "memory.receiptVerified": "receipt observable",
  "memory.receiptUnsupported": "no receipt possible",
  "memory.receiptUnknown": "receipt unverified",
  "memory.hostConfigured": "configured",
  "memory.hostNotConfigured": "not fully configured",
  "memory.captureSources": "Sources with receipt reading: {n}",
  "memory.backlogBlocked": "Blocked ranges: {count}",
  "memory.pointers": "Session pointers queued: {n}",
  /* The jobs block of the project card (delivery B); see the Spanish block for the rules. */
  "memory.jobsTitle": "Extraction jobs",
  "memory.jobsHint": "Each job is one window of captured activity sent to the model to propose memory; every proposal waits for your approval above. Retrying never skips the quota.",
  "memory.jobsEmpty": "No job yet.",
  "memory.jobsMore": "Older jobs exist beyond this page.",
  "memory.jobAttempts": "Attempts: {n}",
  "memory.jobPaid": "Paid calls: {n}",
  "memory.jobIntervals": "Ranges: {n}",
  "memory.jobRetryAt": "Retry due: {date}",
  "memory.jobPublished": "Published: notes {notes} · decisions {episodes}",
  "memory.jobRetry": "Retry",
  "memory.jobCancel": "Cancel",
  "memory.jobSaving": "Saving…",
  "memory.jobStatusPending": "queued",
  "memory.jobStatusRunning": "running",
  "memory.jobStatusStaged": "saved, not yet added",
  "memory.jobStatusDeferred": "deferred",
  "memory.jobStatusFailed": "failed",
  "memory.jobStatusComplete": "added",
  "memory.jobStatusCancelled": "cancelled",
  "memory.jobStatusObsolete": "invalidated",
  "memory.processorLegacy": "whole session",
  "memory.processorExtract": "project window",
  "memory.originLegacy": "older version",
  "memory.originManual": "by hand",
  "memory.originAutomatic": "automatic",
  "memory.reasonBudget": "the day's quota ran out",
  "memory.reasonSubquota": "the day's automatic quota ran out",
  "memory.reasonConversation": "this conversation used up its calls for the day",
  "memory.reasonQueueFull": "the review queue is full; the result waits, saved",
  "memory.reasonQuota": "the storage quota is reached; the work waits",
  "memory.reasonProvider": "no provider is configured; the window waits an hour",
  "memory.reasonPaused": "spending is paused",
  "memory.reasonSourceChanged": "the source changed before sending",
  "memory.reasonUnusable": "the answer was unusable",
  "memory.reasonUnreadable": "the answer could not be read",
  "memory.reasonExtractionFailed": "the call failed",
  "memory.reasonPublishFailed": "publishing failed",
  "memory.reasonUnavailable": "the catalog was unavailable",
  "memory.reasonPaidCeiling": "the paid-call ceiling of this window was reached",
  "memory.reasonDuplicateAttempt": "duplicate attempt",
  "memory.reasonLeaseExpired": "the worker did not come back in time",
  "memory.reasonPermissionRevoked": "the permission was withdrawn",
  "memory.reasonSourcePurged": "the source was purged",
  "memory.reasonWindowOvertaken": "another window already covered these bytes",
  "memory.reasonExtracted": "extracted",
  "memory.reasonDistilled": "distilled",
  "memory.reasonThin": "too little material",
  "memory.reasonUnpublished": "nothing to publish",
  "memory.reasonCancelled": "cancelled by hand",
  "memory.processorTwinDistill": "Twin reading",
  "memory.processorTwinClassify": "Twin sorting",
  "memory.processorTwinSynthesize": "Twin synthesis",
  "memory.processorTastePublish": "portrait publication",
  "memory.reasonCallFailed": "the call to the provider failed",
  "memory.reasonBadManifest": "the job carried no valid brief",
  "memory.reasonInputChanged": "the evidence changed during the call",
  "memory.reasonTasteFull": "the portrait does not fit in the file",
  "memory.reasonWriteMismatch": "what was written did not match what was read back",
  "memory.reasonBlockBroken": "the managed block of the file is broken",
  "memory.reasonNotManaged": "the file has no managed block",
  "memory.reasonRevisionsMoved": "the criteria changed before they were written",
  "memory.reasonPermissionChanged": "the permission changed before the write",
  "memory.reasonProjectGone": "the project is no longer in the catalog",
  "memory.reasonUnreconciled": "the file could not be reconciled in time",
  "memory.reasonClassified": "sorted",
  "memory.reasonSynthesized": "synthesized",
  "memory.reasonUnchanged": "nothing changed that would be worth paying for",
  "memory.reasonPublished": "written to the file",
  "memory.jobReasonOther": "{reason}",
  "memory.jobNotRetryable": "That job is final: there is nothing to retry or cancel.",
  "memory.jobStale": "The job changed since this screen loaded. Reload it and decide again.",
  "memory.jobUnknown": "That job no longer exists in the catalog.",
  "memory.jobFailed": "The job could not be changed.",
  "memory.openJobs": "View jobs (JSON)",
  "memory.pendingBytes": "Captured activity not yet extracted: {size}",
  "memory.oldestPending": "Oldest pending: {date}",
  "memory.attemptsPerWindow": "Paid calls per window added: {n}",
  "memory.capacityHint": "The queue keeps the work and nothing is lost. Decide whether to narrow the sources, raise the quota on /spend, or let it run.",
  "memory.factsTitle": "Captured facts",
  "memory.factsHint": "What capture noted from this project's sessions, by kind. Never a command line, a message or a reply.",
  "memory.factsEmpty": "No facts yet: they need capture's notice 2 and a session after it.",
  "memory.factRead": "Reads: {n}",
  "memory.factEdit": "Edits: {n}",
  "memory.factCommand": "Commands, by family: {n}",
  "memory.factTestResult": "Test outcomes: {n}",
  "memory.factFailure": "Failures: {n}",
  "memory.factCommit": "Commits: {n}",
  "memory.factLifecycle": "Lifecycle: {n}",
  "memory.factReceiptSeen": "Receipts seen: {n}",
  "memory.checksTitle": "Checks",
  "memory.checkPass": "passes",
  "memory.checkFail": "fails",
  "memory.checkUnknownResult": "unknown",
  "memory.checkNotObserved": "not observed yet",
  "memory.checkStale": "not recent",
  "memory.checkEarlierItem": "observed on an earlier revision of this item",
  "memory.checkEarlierDefinition": "observed with an earlier definition",
  "memory.checkLegacy": "first-generation anchor",
  "memory.checkLookedAt": "looked at {date}",
  "memory.checksUnreadable": "The checks of this item could not be read.",
  "memory.checkCoverage": "Files inspected: {inspected} · unresolved: {unknown}",
  "memory.checkObserved": "seen: {observed}",
  "memory.purposeGrounds": "grounds",
  "memory.purposeApplicability": "applicability",
  "memory.purposeViolation": "violation",
  "memory.purposeCompletion": "completion",
  "memory.checkPathExists": "{target} exists",
  "memory.checkPathAbsent": "{target} is absent",
  "memory.checkFileHash": "{target} at digest {digest}…",
  "memory.checkTextPresent": "literal present in {target}; characters: {chars}",
  "memory.checkTextAbsent": "literal absent from {target}; characters: {chars}",
  "memory.checkManifestScript": "script {name} in {target}",
  "memory.checkDirectDependency": "dependency {name} ({ecosystem}) in {target}",
  "memory.checkDirectDependencyVersion": "dependency {name} ({ecosystem}) in {target}, version {version}",
  "memory.checkStructuredKey": "key {path} in {target}",
  "memory.checkReasonLimitReached": "a reading limit was reached",
  "memory.checkReasonMalformed": "the document could not be parsed",
  "memory.checkReasonOutsideRoot": "the path leaves the project",
  "memory.checkReasonUnreadable": "the file could not be read",
  "memory.checkReasonMissing": "the file does not exist",
  "memory.checkReasonExists": "the path exists",
  "memory.checkReasonAbsent": "the path does not exist",
  "memory.checkReasonPresent": "the literal is there",
  "memory.checkReasonHashMatch": "the digest matches",
  "memory.checkReasonHashMismatch": "the digest changed",
  "memory.checkReasonScriptDefined": "the script is defined",
  "memory.checkReasonScriptMissing": "the script is missing",
  "memory.checkReasonScriptDiffers": "the script is different",
  "memory.checkReasonDependencyDeclared": "the dependency is declared",
  "memory.checkReasonDependencyMissing": "the dependency is missing",
  "memory.checkReasonVersionDiffers": "the version is different",
  "memory.checkReasonKeyPresent": "the key is there",
  "memory.checkReasonKeyMissing": "the key is missing",
  "memory.checkReasonValueMatches": "the value matches",
  "memory.checkReasonValueDiffers": "the value is different",
  "memory.checkReasonOther": "{reason}",
  "memory.looksLimited": "The newest occurrences were read and older ones are not shown; read: {n}",
  "memory.looksUnreadable": "What the patrol observed could not be read: no check on this card has a state.",
  "memory.supersededTitle": "Superseded and expired",
  "memory.supersededHint": "They no longer travel to any agent. They stay here with their state and, when there is one, the rule that replaced them.",
  "memory.noteSuperseded": "superseded",
  "memory.noteExpired": "expired",
  "memory.expiresOn": "expires on {date}",
  "memory.expiredOn": "expired on {date}",
  "memory.supersededBy": "superseded by {id}",
  "memory.supersedes": "supersedes {id}",
  "memory.decisionsTitle": "Decisions in force",
  "memory.decisionsHint": "Your decisions this project receives right now, with their typed conditions and the state of their checks. The full record is on your Twin.",
  "memory.decisionsEmpty": "No decision in force for this project.",
  "memory.decisionsUnreadable": "The decisions could not be read.",
  "memory.decisionNoText": "No decision text on record.",
  "memory.decisionConditions": "conditions: {text}",
  "memory.decisionExceptions": "exceptions: {text}",
  "memory.openDecision": "Open the record",
  "memory.commitmentsTitle": "Commitments",
  "memory.commitmentsHint": "Your obligations, versioned. What the patrol observes of their criteria lives apart and never changes their state: only you close one, or a completion criterion you approved that passed whole. A closed one is never reopened; another continues it.",
  "memory.commitmentsEmpty": "No commitment yet.",
  "memory.commitmentsUnreadable": "The commitments could not be read.",
  "memory.commitmentsMore": "Older commitments exist beyond this list.",
  "memory.commitmentOpen": "open",
  "memory.commitmentFulfilled": "fulfilled",
  "memory.commitmentCancelled": "cancelled",
  "memory.commitmentByOwner": "written by you",
  "memory.commitmentByAgent": "written by an agent",
  "memory.commitmentTask": "task {id}",
  "memory.commitmentConditions": "conditions: {text}",
  "memory.commitmentCriteria": "Completion criteria",
  "memory.commitmentNoCriteria": "No completion criteria: only you can mark it fulfilled.",
  "memory.commitmentChecks": "Other checks",
  "memory.commitmentObservations": "Observations: {total} · passing: {passed} · failing: {failed} · unknown: {unknown}",
  "memory.commitmentIncidents": "Incidents: {n}",
  "memory.commitmentRecent": "Latest observations",
  "memory.commitmentResolvedOwner": "closed by you",
  "memory.commitmentResolvedChecks": "fulfilled by its criteria",
  "memory.commitmentReason": "reason: {reason}",
  "memory.commitmentContinues": "continues {id}",
  "memory.commitmentContinuedBy": "continued by {id}",
  "memory.commitmentFulfil": "Mark fulfilled",
  "memory.commitmentCancel": "Cancel",
  "memory.commitmentSaving": "Saving…",
  "memory.commitmentClosed": "That commitment is closed: it is never reopened, revised or cancelled. Create another one that continues it.",
  "memory.commitmentFailed": "The commitment could not be changed.",
  "memory.openCommitments": "View commitments (JSON)",
  "memory.incidentsTitle": "Incidents",
  "memory.incidentsHint": "What the patrol saw fail on the disk against a rule that stays in force. Your word: confirm it or mark it a false alarm. An incident says what the disk held, not what an agent did.",
  "memory.incidentsEmpty": "No incident.",
  "memory.verdictConfirmed": "confirmed",
  "memory.verdictFalsePositive": "false alarm",
  "memory.verdictNone": "unjudged",
  "memory.incidentOn": "on {kind} {id}",
  "memory.incidentRows": "Looks at this occurrence: {n}",
  "memory.incidentHead": "HEAD {head}",
  "memory.deliveredBeforeYes": "that revision had been delivered before in that context",
  "memory.deliveredBeforeNo": "that revision had not been delivered before in that context",
  "memory.deliveredBeforeUnknown": "no record of a prior delivery in that context",
  "memory.incidentFailed": "The verdict could not be recorded.",
  "memory.openOutcomes": "View looks (JSON)",
  "memory.casesTitle": "Decision cases",
  "memory.casesHint": "Per task: what was asked, what was decided, what the agent declared and what was checked. A gap is said as a gap and never filled with a story.",
  "memory.casesEmpty": "No task yet.",
  "memory.caseOpen": "View the case",
  "memory.caseClose": "Close the case",
  "memory.caseLoading": "Reading…",
  "memory.caseFailed": "The case could not be read.",
  "memory.caseCommitments": "Commitments: {n}",
  "memory.caseAsked": "Asked",
  "memory.caseDecided": "Decided",
  "memory.caseDeclared": "Declared",
  "memory.caseChecked": "Checked",
  "memory.caseUnknown": "unknown",
  "memory.caseUnknownFields": "No data: {list}",
  "memory.caseDecidedNote": "Your decisions in force for the project at the time of reading; not a consequence of this task.",
  "memory.caseDeclaredNote": "What the agent wrote in its logbook while it held the task. A declaration, not a check.",
  "memory.caseCheckedNote": "The commitments of this task with what the patrol observed. An observation never closes a commitment.",
  "memory.caseAskedAt": "asked {date}",
  "memory.caseDecidedAt": "decided {date}",
  "memory.caseObservedAt": "observed {date}",
  "memory.caseLooks": "looks alike on this occurrence: {n}",
  "memory.caseByAgent": "agent: {agent}",
  "memory.caseSummary": "session summary",
  "memory.caseSession": "session {id}",
  "memory.invalidCheck": "That check is not in a shape the catalog accepts.",
  "memory.notFound": "That no longer exists in the catalog. Reload the screen.",
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
  /*
    What `@panoma/ai` says when the failure is panoma's own, in the reader's language.

    That package used to throw fixed Spanish, and both of its readers got the wrong one: the
    terminal prints `error.message` raw and is a machine surface, where the rule is English; the
    browser is bilingual and got Spanish either way. It carries a typed `failure` now, so these are
    keyed on its code and not on its prose — the previous half-fix matched the Spanish sentence
    «proveedor de IA» as if it were a key, which would have stopped working, silently, the first
    time anybody reworded it.

    What a provider said is not here. A 429, a refusal, someone else's API text: those arrive
    inside `{detail}` and travel whole, because translating a quote is inventing one.
   */
  "aiFail.noCommand": "{provider} declares no command to run.",
  "aiFail.launchFailed": "Could not launch {command}: {reason}",
  "aiFail.exited": "{provider} exited with code {status}. {detail}",
  "aiFail.emptyBody": "{provider} answered with no body.",
  "aiFail.providerRefused": "{provider} answered {status}: {detail}",
  "aiFail.tokenRefused": "{provider} refused the token request ({status}): {detail}",
  "aiFail.neverAnswered": "{provider} never answered: {detail}. The model did not say no — the request never left this machine. Attempts: {attempts}",
  "aiFail.configShape": "The contents are not shaped like a panoma configuration.",
  "aiFail.configLocked": "Another panoma process is writing the configuration. If none is running, the lock was left behind by an earlier run: remove it with {detail}",
  "aiFail.noProvider": "No AI provider is configured.",
  "aiFail.unknownProvider": "Unknown provider: {provider}",
  "aiFail.oauthTimeout": "Timed out waiting for you to come back from the browser.",
  "aiFail.noOauth": "{provider} does not use sign-in.",
  "aiFail.badUrl": "{provider}'s address is not a valid URL: «{detail}». Check {where}.",
  "aiFail.notHttp": "{provider}'s address has to be http or https.",
  "aiFail.urlHasCredentials": "{provider}'s address carries a user or a password inside. Take them out and use the key.",
  "aiFail.insecureHost": "panoma will not send {provider}'s credential unencrypted to {detail}. Use https, or a server on your own machine.",
  "aiFail.visionUnsupported": "{provider} cannot take images. Connect a provider with a key, or pass one with --provider.",
  "aiFail.configCorrupt": "Could not read the AI configuration at {detail}.",
  "model.noCredential": "the {name} credential is missing",
  "model.hintCli": "Install {name} and sign in; Panoma will call “{command}”.",
  "model.hintOauth": "Sign in to {name} from the Model page.",
  "model.hintKey": "Save the key on the Model page or with “{cli} ai key {id}”. Get one at {url}",

  "look.noImage": "The screenshot is missing: there is no image to look at.",
  "look.badImage": "That image can’t be read: it arrives empty or in a format that isn’t an image.",
  "look.noProfile":
    "There is nothing to measure this screen against: your portrait is empty and this project has no north. Distill your history —{cli} twin distill— or write a north with {cli} north.",
  "look.budgetSpent":
    "Today’s looks are spent: {used} of {cap}. They come back tomorrow, or raise the cap on the Spend screen (/spend) or with PANOMA_LOOK_BUDGET.",
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
    "That screenshot could not be looked at: {detail}. It was probably deleted, or it weighs more than can be sent.",
  "look.unreadableBody":
    "The request could not be read. If it carried a capture, it weighs more than this server accepts at once.",

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
  "look.fitSent": "reduced for the critic · what it sees: {size} · what the file has: {from}",
  "look.fitWhole": "you asked for it reduced and it travels whole: {why}",
  "look.fitAsked": "you asked for it reduced: its long edge will be at most {edge} px",
  "look.whyFormat": "it is not a PNG, and only a PNG can be reduced here",
  "look.whyVariant": "it is a PNG written in a way panoma cannot read",
  "look.whyAlready": "it is already smaller than that size",
  "look.whyBroken": "it could not be read to reduce it",
  "look.whyHuge": "it has more pixels than fit in memory to reduce it",
  "look.stillBig": "it was reduced to {width}×{height} and still does not fit",
  "look.shotRefused": "That screenshot could not be looked at: {detail}.",
  "look.shotsFull": "the critic sees the capture as it is, untouched",
  "look.shotsFit": "the critic sees it reduced, its long edge at most {edge} px",
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
  "look.uploadCapFit": "It is reduced before it travels, so what is accepted here is a file of up to {cap}.",
  "look.uploadCapFull": "It travels as it is, so what is accepted here is a file of up to {cap}.",
  "look.uploadTarget": "Project to upload the screenshot to",
  "look.badType": "That isn’t an image that can be looked at: PNG, JPEG, WebP or GIF.",
  "look.tooBig":
    "That image weighs {size} and the cap sits at {cap}. Crop it, or ask for fitted captures on the Spend screen (/spend) and the big ones will fit.",
  "look.historyTitle": "What it has looked at",
  "look.historyEmpty": "It hasn’t looked at anything yet.",
  "look.firedWatch": "the watcher looked at it",
  "look.firedHand": "you asked for it",

  "taste.full":
    "It doesn’t fit: the portrait would take {chars} of {cap} characters. Nothing was saved. Take a statement out, or scope it to its project so it only counts there, and save again.",

  "twin.toCritic": "Show the critic a screen →",
  "twinTeach.nav": "Explore Twin",
  "twinTeach.navMemory": "Decision memory",
  "twinTeach.navTeach": "Teach",
  "twinTeach.navLab": "Rehearse a decision",
  "twinTeach.navPortrait": "My portrait",
  "twinTeach.navHistory": "Learn from history",
  "twinTeach.details": "Evidence, activity and outcomes",
  "twinTeach.signed": "Signed criteria",
  "twinTeach.standing": "Supported inferences",
  "twinTeach.published": "Statements in the portrait",
  "twinTeach.portraitTitle": "The judgment you are building",
  "twinTeach.portraitEmpty": "Your first rule will appear here. Write it above or let Twin learn from your conversations.",
  "twinTeach.eyebrow": "DIRECT TEACHING",
  "twinTeach.ownerEvidence": "Written directly by you",
  "twinTeach.title": "Start with what you know",
  "twinTeach.lead": "Write a concrete rule about how you want your work to turn out. Twin saves it as a criterion you signed, with an optional project scope.",
  "twinTeach.control": "Your rule goes into TASTE.md. Edit or veto it in your portrait; synthesis cannot rewrite what you signed.",
  "twinTeach.statement": "My criterion",
  "twinTeach.placeholder": "For example: I prefer editing in place over opening a modal for small changes.",
  "twinTeach.characters": "Characters: {n} / {max}",
  "twinTeach.topic": "Topic",
  "twinTeach.scope": "Where it applies",
  "twinTeach.global": "Across all my projects",
  "twinTeach.scopeOmitted":
    "Only projects whose name no other project shares: TASTE.md scopes by name, and a shared name would scope to all of them at once. Left out for that reason: {n}",
  "twinTeach.save": "Sign and save",
  "twinTeach.saving": "Saving criterion…",
  "twinTeach.cost": "No model calls",
  "twinTeach.contextRules": "Conditions and exceptions (optional)",
  "predicate.and": " and ",
  "predicate.or": " or ",
  "predicate.not": "not ({value})",
  "predicate.project": "the project is {value}",
  "predicate.path": "the path is under {value}",
  "predicate.environment": "the environment is {value}",
  "predicate.task": "the task kind is {value}",
  "predicate.operation": "the action is {value}",
  "predicate.check": "check {value}, revision {revision}, reports {result}",
  "predicate.pass": "pass",
  "predicate.fail": "fail",
  "predicate.unknown": "unknown",
  "twinTeach.contextHint": "When the agent lacks a required fact, the criterion remains conditional. A matching exception prevents it from applying.",
  "twinTeach.conditions": "Apply when",
  "twinTeach.exceptions": "Except when",
  "twinTeach.match": "Match",
  "twinTeach.matchAll": "All conditions match",
  "twinTeach.matchAny": "Any condition matches",
  "twinTeach.contextKind": "Context fact",
  "twinTeach.operation": "Action",
  "twinTeach.path": "Project path",
  "twinTeach.taskKind": "Task kind",
  "twinTeach.pathValue": "Relative path, without wildcards",
  "twinTeach.taskValue": "Task kind declared by the agent",
  "twinTeach.opRead": "Read",
  "twinTeach.opEdit": "Edit",
  "twinTeach.opTest": "Test",
  "twinTeach.opBuild": "Build",
  "twinTeach.opDeploy": "Deploy",
  "twinTeach.opReview": "Review",
  "twinTeach.opOther": "Other action",
  "twinTeach.negate": "Negate this condition",
  "twinTeach.removeCondition": "Remove condition",
  "twinTeach.addCondition": "Add condition",
  "twinTeach.saved": "Criterion signed and saved in your portrait.",
  "twinTeach.view": "View criterion",
  "twinTeach.failed": "The criterion could not be saved. Your text is still here.",
  "twinTeach.invalid": "Write a criterion of up to 300 characters and choose a valid topic.",
  "twinTeach.scopeError": "This project needs a stable identity and a unique name before a criterion can be scoped to it.",
  "twinLab.eyebrow": "DECISION LAB",
  "twinLab.title": "How would your Twin decide?",
  "twinLab.lead": "Describe a decision from your work. First inspect the available criteria, then rehearse an answer grounded in them.",
  "twinLab.question": "The decision",
  "twinLab.placeholder": "Inline editing or a modal to rename a project?",
  "twinLab.questionHint": "One concrete choice, with enough context.",
  "twinLab.characters": "Characters: {n} / {max}",
  "twinLab.project": "Project context",
  "twinLab.global": "My general criteria only",
  "twinLab.scopeHint": "Choose a project to include its specific rules as well.",
  "twinLab.preview": "Explore criteria",
  "twinLab.previewing": "Finding criteria…",
  "twinLab.previewCost": "Local lookup, no model call",
  "twinLab.drafting": "Rehearsing the decision…",
  "twinLab.draftReady": "Rehearsal ready",
  "twinLab.abstained": "Twin abstained",
  "twinLab.evidenceCount": "Available criteria: {n}",
  "twinLab.waiting": "CRITERIA BEFORE AN ANSWER",
  "twinLab.emptyTitle": "A decision with its reasons in view",
  "twinLab.emptyBody": "Inspect signed rules, supported inferences and relevant decision episodes, including their conditions and exceptions. Search stays local; requesting a model answer is a separate step.",
  "twinLab.firstTitle": "Give it a first criterion to start",
  "twinLab.noBeliefs": "No applicable criteria or matching decision episodes were found in this context. Record a decision, teach a rule, or add more context to the question.",
  "twinLab.noMatch": "The available criteria do not resolve this decision. Add the missing context or teach it how you would decide.",
  "twinLab.unsupported": "The answer did not provide valid supporting citations. It cannot be presented as a decision grounded in your criteria.",
  "twinLab.abstainedTitle": "It cannot decide from your criteria yet",
  "twinLab.draftTitle": "What it would answer",
  "twinLab.draftHint": "Check whether these reasons represent the decision you would make.",
  "twinLab.citations": "Cited criteria",
  "twinLab.evidence": "Evidence the model will receive",
  "twinLab.openEvidence": "Open criterion in my portrait",
  "twinLab.projectRule": "Only in {project}",
  "twinLab.globalRule": "Across all my projects",
  "twinLab.omitted": "Outside this consultation’s context budget: {n}",
  "twinLab.remaining": "Rehearsal calls remaining today: {n}",
  "twinLab.rehearse": "Rehearse this decision",
  "twinLab.draftCost": "Spends one rehearsal call from the Lab's own daily budget, on your configured model. Sends the question and the criteria shown.",
  "twinLab.budgetReached": "The daily rehearsal budget is exhausted; your agents' questions are unaffected. You can still explore criteria without a model call, or raise the cap on the Spend screen (/spend).",
  "twinLab.boundary": "This rehearsal is not saved as evidence, does not change your portrait, and does not answer an agent. Your Twin remains in training.",
  "twinLab.teach": "Teach a criterion",
  "twinLab.invalidRequest": "Write a decision of up to {max} characters and choose a valid project.",
  "twinLab.failed": "The rehearsal could not be completed. Try again.",
  "twinLab.episode": "Decision episode",
  "twinLab.openEpisode": "Open decision memory",
  "twinLab.episodeScope": "Applies under the recorded conditions; inspect the source before generalizing.",
  "twinLab.disagree": "Disagree? Teach the criterion you would apply.",
  "twinMemory.errBody": "Provide a decision record.",
  "twinMemory.errFields": "Use recognized fields only and stay within the limit of each field: {max}.",
  "twinMemory.errPurpose": "Record a goal or a decision to give this episode a purpose.",
  "twinMemory.errStatus": "Provide an episode identifier and a status: active or dismissed.",
  "twinMemory.errRevision": "A revision must name its previous episode and keep its project.",
  "twinMemory.errProject": "Select a valid project.",
  "twinMemory.errUnstable": "This project does not have a stable identity yet.",
  "twinMemory.errPreviousMissing": "The episode being revised is no longer available.",
  "twinMemory.errDismissedDuplicate": "This episode already exists among the dismissed ones. Show them and restore or revise it there.",
  "twinMemory.errActiveSuccessor": "Another version of this decision is active. Open or dismiss that version before restoring or revising this one.",
  "twinMemory.errValidUntil": "Give the last day this decision applies as YYYY-MM-DD, or clear it.",
  "twinMemory.errNotFound": "Decision episode not found.",
  "twinMemory.errInvalidId": "Invalid episode identifier.",
  "twinMemory.learnFlag": "The only accepted flag is dryRun, and it must be true or false.",
  "twinMemory.learnBudget": "The daily decision-memory budget is exhausted. It comes back tomorrow, or sooner if you raise the cap on the Spend screen (/spend).",
  "twinMemory.learnStale": "The source material or its attribution changed during analysis. Refresh the pending material before retrying.",
  "twinMemory.learnUnsupported": "The model returned unsupported fields. The material stays pending, and this pass defers it so others are read first.",
  "twinMemory.learnCut": "The model's answer was cut at the output limit before it closed. The material stays pending, and it is deferred so others are read first.",
  "twinMemory.eyebrow": "Decisions, with their reasons",
  "twinMemory.title": "Decision memory",
  "twinMemory.lead": "Keep the goal, tradeoffs, and exceptions behind a choice. Missing details stay unknown until there is evidence to fill them.",
  "twinMemory.captured": "History captured: {n}",
  "twinMemory.awaiting": "Awaiting analysis: {n}",
  "twinMemory.deferred": "Deferred after an unusable answer, retried after the rest: {n}",
  "twinMemory.passReads": "Records a pass can read at most: {n}",
  "twinMemory.queueDays": "Days to read the queue at today's budget, at least: {n}",
  "twinMemory.extractionOff": "Extraction is switched off: the daily budget is zero.",
  "twinMemory.savedNew": "Episode saved with your own words.",
  "twinMemory.savedRevision": "Revision saved in your words. The previous version is kept in dismissed episodes.",
  "twinMemory.recentTitle": "Recent decision records",
  "twinMemory.includeDismissed": "Include dismissed in this view: {n}",
  "twinMemory.shown": "Records shown: {n}. This view starts with the most recent records, up to 100, plus any record opened directly; older ones load at the end of the list.",
  "twinMemory.emptyTitle": "Start with one decision that mattered.",
  "twinMemory.emptyBody": "A choice with a reason is more useful than a list of preferences. Add it above, or capture your permitted history and preview an analysis.",
  "twinMemory.boundary": "These episodes preserve context. They do not automatically become signed rules or appear in TASTE.md.",
  "twinMemory.captureTitle": "Record a decision",
  "twinMemory.reviseTitle": "Revising a saved episode",
  "twinMemory.captureHint": "Add a goal or decision to start. Capture only what you know; every other field is optional.",
  "twinMemory.reviseHint": "Complete the missing details or correct the record. Saving makes this your testimony and keeps the previous version for reference.",
  "twinMemory.characters": "Characters: {n} / {max}",
  "twinMemory.projectContext": "Project context",
  "twinMemory.originalProject": "Original project context",
  "twinMemory.noProject": "No specific project",
  "twinMemory.moreFields": "Add reasoning, outcomes, and exceptions",
  "twinMemory.saving": "Saving episode…",
  "twinMemory.saveEpisode": "Save episode",
  "twinMemory.saveRevision": "Save revision",
  "twinMemory.cancelRevision": "Cancel revision",
  "twinMemory.localSave": "Local save · No model call",
  "twinMemory.unsavedDraft": "You have an unsaved episode. Save it or clear it before revising another.",
  "twinMemory.clearDraft": "Clear",
  "twinMemory.fieldGoal": "Goal",
  "twinMemory.hintGoal": "What were you trying to achieve?",
  "twinMemory.fieldContext": "Context",
  "twinMemory.hintContext": "What situation shaped this decision?",
  "twinMemory.fieldConstraints": "Constraints",
  "twinMemory.hintConstraints": "What limits, risks, or commitments mattered?",
  "twinMemory.fieldAlternatives": "Alternatives",
  "twinMemory.hintAlternatives": "What other approaches did you consider?",
  "twinMemory.fieldDecision": "Decision",
  "twinMemory.hintDecision": "What did you choose or ask to change?",
  "twinMemory.fieldRationale": "Reasoning",
  "twinMemory.hintRationale": "Why did you choose it? What tradeoff did you accept?",
  "twinMemory.fieldOutcome": "Outcome",
  "twinMemory.hintOutcome": "What actually happened? Leave blank if still unknown.",
  "twinMemory.fieldConditions": "When it applies",
  "twinMemory.hintConditions": "Under what circumstances would you choose this again?",
  "twinMemory.fieldExceptions": "Exceptions",
  "twinMemory.hintExceptions": "When would a different choice be better?",
  "twinMemory.untitled": "Decision episode",
  "twinMemory.learnTitle": "Learn beyond reactions",
  "twinMemory.learnLead": "Bring in your goals, briefs, decisions, and corrections from the history sources you have enabled. Twin links each extracted detail to its human evidence.",
  "twinMemory.step1": "01 · Capture locally",
  "twinMemory.step1Hint": "Read permitted history into local memory. Existing records are deduplicated.",
  "twinMemory.capture": "Capture history",
  "twinMemory.capturing": "Capturing history…",
  "twinMemory.noCall": "No model call",
  "twinMemory.step2": "02 · Review the analysis cost",
  "twinMemory.step2Hint": "Preview a bounded pass before sending any history to your configured model.",
  "twinMemory.preview": "Preview analysis",
  "twinMemory.previewing": "Preparing preview…",
  "twinMemory.selected": "History selected",
  "twinMemory.inputTokens": "Estimated input tokens",
  "twinMemory.outputTokens": "Output token allowance",
  "twinMemory.calls": "Model calls",
  "twinMemory.remainingCalls": "Daily calls remaining",
  "twinMemory.contextOnly": "Kept as context only, no call: {n}",
  "twinMemory.nothingUnread": "There is no unread history to analyze. Capture history to check for new material.",
  "twinMemory.learn": "Learn from history",
  "twinMemory.learning": "Learning from history…",
  "twinMemory.budgetShort": "The daily model budget is too small for this pass. Try again after the daily reset.",
  "twinMemory.learnCost": "This sends the selected human text and supporting context to the configured model. Provider charges may apply.",
  "twinMemory.extracting": "Extracting supported details. Unknown outcomes and reasons will stay empty.",
  "twinMemory.capturedNew": "New history records saved: {n}.",
  "twinMemory.capturedDenied": "Sources without permission: {n}. Review them under your histories, above.",
  "twinMemory.capturedUnmatched": "Records skipped without a matching project: {n}.",
  "twinMemory.capturedUndated": "Records skipped without a usable date: {n}.",
  "twinMemory.learnStored": "Decision records saved: {stored}. History records processed: {processed}. Remaining: {remaining}.",
  "twinMemory.learnDropped": "Fields that quoted pasted material, dropped: {n}",
  "twinMemory.learnDeferred": "Records deferred this pass: {n}",
  "twinMemory.learnRetrying": "Records this pass pays for again because an earlier pass deferred them: {n}",
  "twinMemory.requestFailed": "The request could not be completed.",
  "twinMemory.evidenceFailed": "The source evidence could not be loaded.",
  "twinMemory.byOwner": "Written by you",
  "twinMemory.fromHistory": "Extracted from history",
  "twinMemory.unlinkedProject": "Unlinked project",
  "twinMemory.dismissed": "Dismissed",
  "twinMemory.previousVersion": "Previous version",
  "twinMemory.outsideView": "outside this recent view",
  "twinMemory.recorded": "Recorded: {list}",
  "twinMemory.notRecorded": "Not recorded: {list}",
  "twinMemory.explore": "Explore the decision",
  "twinMemory.viewSource": "View human source",
  "twinMemory.viewSourceFor": "View human source for {field}",
  "twinMemory.viewEvidence": "View source evidence",
  "twinMemory.loadingEvidence": "Loading source evidence…",
  "twinMemory.retryEvidence": "Retry evidence",
  "twinMemory.sourceGone": "The original source is no longer available.",
  "twinMemory.kindOpening": "opening",
  "twinMemory.kindReaction": "reaction",
  "twinMemory.kindBrief": "pasted material",
  "twinMemory.ownerText": "Owner text",
  "twinMemory.briefText": "Pasted or structured text — context, never cited",
  "twinMemory.truncated": "This source was shortened when captured.",
  "twinMemory.agentContext": "Agent context · Not your words",
  "twinMemory.revise": "Complete or revise",
  "twinMemory.dismiss": "Dismiss",
  "twinMemory.restore": "Restore",
  "twinMemory.successorActive": "Another version of this decision is active. Open or dismiss that version before restoring or revising this one.",
  "twinMemory.competingTitle": "Competing versions",
  "twinMemory.competingLead": "These decisions have more than one active version at once, from before a revision dismissed the one it replaces. Until you keep one, none of them reaches the agents' briefing or the Lab; keeping one dismisses the others, which stay among the dismissed records.",
  "twinMemory.competingFamilies": "Decisions with competing versions: {n}",
  "twinMemory.keepThis": "Keep this one",
  "twinMemory.keeping": "Keeping…",
  "twinMemory.competingActive": "Another version of this decision is also active; until you keep one, none of them is delivered.",
  "twinMemory.competingOpen": "Go to the competing versions",
  "twinMemory.reachProject": "Reach: eligible for the agents' briefing of this project and for the Lab. The briefing carries six decisions at most, the project's own first, so it can still leave this one out.",
  "twinMemory.reachGeneral": "Reach: eligible for the agents' briefing of every project and for the Lab. The briefing carries six decisions at most, each project's own first, so it can still leave this one out.",
  "twinMemory.reachLabOnly": "Reach: Lab only, until you revise it into your own words.",
  "twinMemory.reachNoDecision": "Reach: Lab only, until it records a decision.",
  "twinMemory.reachNowhere": "Reach: delivered nowhere.",
  "twinMemory.reachWithheld": "Reach: withheld until a single version is kept.",
  "twinMemory.searchLabel": "Search the archive",
  "twinMemory.searchHint": "Searches goals, decisions, reasons, conditions, exceptions and context across every record, not only the recent ones.",
  "twinMemory.search": "Search",
  "twinMemory.searching": "Searching…",
  "twinMemory.clearSearch": "Clear the search",
  "twinMemory.shownMatches": "Records matching “{query}”: {n}",
  "twinMemory.noMatches": "No record matches “{query}”.",
  "twinMemory.loadOlder": "Load older",
  "twinMemory.loadingOlder": "Loading older…",
  "twinMemory.errQuery": "The search text is too long. Characters at most: {max}.",
  "twinMemory.errCursor": "The paging position is invalid. Reload the list from the start.",
  "twinMemory.addField": "Add {field}",
  "twinMemory.validUntilLabel": "Last day it applies",
  "twinMemory.validUntilHint": "Optional. The last day this decision applies. After that day your agents stop receiving it, and you still keep it here.",
  "twinMemory.appliesThrough": "Applies through {date}, that day included.",
  "twinMemory.expiredOn": "Expired on {date}.",
  "twinMemory.expiryTitle": "How long it applies",
  "twinMemory.saveExpiry": "Save the date",
  "twinMemory.savingExpiry": "Saving the date…",
  "twinMemory.clearExpiry": "Clear the date",
  "twinMemory.clearingExpiry": "Clearing the date…",
  "twinMemory.reachExpired": "Reach: expired, delivered nowhere. It stays here for you to read, and it is delivered again as soon as you clear the date.",

  "twin.title": "This is what I learned about you",
  "twin.titleEmpty": "I haven’t learned anything about you yet",
  "twin.intro":
    "Every belief comes from things you wrote to your agents, with the quotes underneath. There is nothing to approve: if you touch nothing, this is what your agents read. Read it, and correct whatever isn’t you.",
  "twin.introWaiting":
    "Your signed criteria and proposals learned from history appear here. Inferred proposals are not published until you enable that permission. Each criterion shows whether it has reached the file.",
  "twin.introEmpty":
    "Panoma reads your history with your agents on your own disk and pulls out the few things you actually believe about how your work should come out, each with the quotes it came from.",
  "twin.introEmptyHint":
    "Start just below, under your histories: it says which ones are on this machine and how much they weigh, measured without opening any.",
  "twin.payoff":
    "At the end of all this there are about twenty sentences in one file, TASTE.md, which panoma hands down into every project's AGENTS.md: that is what your agents read before they touch your code.",
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
  "twin.distillingPaid": "Distilling…",
  "twin.distillEstimate":
    "what this pass reads — quotes: {verdicts} · input tokens (roughly): {tokens}",
  "twin.distillProgress": "read: {read} · observations stored: {saved} · left: {left}",
  "twin.distillThin": "alone in their project, and so unread: {n}",
  "twin.distillTruncated": "answers cut short and asked again with more room: {n}",
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
  "twin.consentDistinct": "This yes publishes what was already inferred; it reads nothing new. What gets read is decided above, source by source.",
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
  "twin.fileSplit": "of those, read in every project: {global}",
  "twin.fileHeaviest": "and what the heaviest project adds, {project}: {own}",
  "twin.notInFile": "not in the file",
  "twin.notInFileWhy":
    "It is saved here, but it has not gone down into TASTE.md, so no agent reads it yet.",
  "twin.fileRoom": "Room left, in characters: {n}",
  "twin.spendTitle": "What it cost today",
  "twin.spendLooks": "looks: {used} of {cap}",
  "twin.spendTokens": "{input} input tokens · {output} output",
  "twin.spendNone": "No model was called today.",
  "twin.spendUnmetered": "{n} unmeasured: that provider doesn’t publish usage.",
  "twin.spendDistills": "distillations: {n}",
  "twin.spendClassify": "topic passes: {n}",
  "twin.spendSynth": "syntheses: {n}",
  "twin.spendEpisodes": "Decision memory calls: {used} / {cap}",
  "twin.spendRehearse": "Rehearsal calls: {used} / {cap}",
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
  "twin.captureTitle": "Check that memory arrives",
  "twin.captureReads":
    "What is read: only hook receipts and the lifecycle records of each transcript (start, resume, compaction). Never your messages or the agent's replies.",
  "twin.captureRetains":
    "What is kept: offer ids, byte coordinates and hashes. Never conversation text.",
  "twin.captureFrom":
    "From where: the end of each file at the moment you turn it on. Nothing written before is processed, not even when you turn it back on.",
  "twin.captureRevokeNote":
    "How to take it back: right here, or by deleting twin.json. Receipts already kept stay; {cli} memory purge removes them.",
  "twin.captureScope": "Applies to every project in the catalog.",
  "twin.captureOn": "Receipts: reading since {date}",
  "twin.captureOff": "Receipts: not read",
  "twin.captureUnsupported": "Receipts are not read from this program in this version.",
  "twin.grantConsentRequired": "Let Panoma read this source first; the receipts permission comes after.",
  "twin.grantUnsupportedSource": "This version has no receipt reader for this source.",
  "twin.grantStale": "The permission changed since this screen loaded. Reload it and decide again.",
  "twin.grantInvalid": "The request was not in the shape the catalog expects.",
  "twin.grantLocalOnly": "This permission is granted only on the computer where the catalog lives.",
  "twin.grantStalePolicy": "The permission changed since the plan was made. Start again.",
  "twin.captureAccept": "Read this source's receipts",
  "twin.factsTitle": "Notice 2: the facts of each session",
  "twin.factsReads":
    "What is also noted: reads, edits, the family of each command (build, test, lint…), test outcomes, failures, commits and lifecycle. Never a command line, a message or a reply.",
  "twin.factsFrom":
    "From where: the end of each file when you accept this notice. Stop reading the receipts and this notice closes with them; it has to be accepted again.",
  "twin.factsAccept": "Also note the facts of each session",
  "twin.factsOn": "Facts: noted (notice 2 accepted)",
  "twin.factsOff": "Facts: not noted",
  "twin.extractTitle": "Propose project memory",
  "twin.extractTravels":
    "What travels to the provider: your new messages from the allowed range, credentials and secrets redacted, and the noted facts. Never the agent's replies.",
  "twin.extractRetains":
    "What is kept: the quotes that support each proposal. Quotes per proposal, at most: {quotes}. Characters per quote, at most: {chars}.",
  "twin.extractQuota":
    "What it costs: automatic calls a day, at most: {daily}. Per conversation and day, at most: {perConversation}.",
  "twin.extractFrom":
    "From where: the end of each file at the moment you turn it on, with its own boundary apart from capture's. Nothing written before travels.",
  "twin.extractRevokeNote":
    "How to take it back: right here, or by deleting twin.json. Proposals already made stay, jobs in flight stop counting, and nothing new is paid for.",
  "twin.extractNeedsCapture":
    "It depends on capture: stop reading this source's receipts and extraction stops with them.",
  "twin.extractOn": "Extraction: on since {date}",
  "twin.extractOff": "Extraction: off",
  "twin.extractPaused": "Extraction: granted, but stopped while receipts are not read",
  "twin.consentDistinctExtract":
    "Nor does it propose project memory: the extraction permission decides that, source by source, and every proposal waits for your approval.",
  "twin.learnSwitchTitle": "Learn your preferences",
  "twin.learnTravels":
    "What travels to the provider: your new messages of the allowed range, with credentials and secrets redacted, in batches. Never the agent's replies; a copied or relayed message travels marked as a copy and supports no criterion.",
  "twin.learnRetains":
    "What is kept: observations with their exact quote and which conversation they came from, and the criteria it proposes. All of it is reviewed here, on the portrait.",
  "twin.learnQuota":
    "What it costs: automatic batches a day inside the reading cap, at most: {daily}.",
  "twin.learnNeverPublishes":
    "What it never does: it publishes nothing. Whether what it infers reaches the file is the publication permission further down, and learning does not grant it.",
  "twin.learnFrom":
    "From where: the end of each file at activation, with its own boundary apart from the capture's. What was written before is not read.",
  "twin.learnRevokeNote":
    "How it is taken back: right here, in the learning block or with {cli} memory revoke. Your signatures, the published criteria and what you taught by hand stay; batches in flight stop counting.",
  "twin.learnNeedsCapture":
    "Depends on capture: if you stop reading this source's receipts, learning stops with them.",
  "twin.learnOn": "Learning: on since {date}",
  "twin.learnOff": "Learning: off",
  "twin.learnStopped": "Learning: granted, but stopped while the receipts are not read",
  "twin.learnTitle": "Continuous learning",
  "twin.learnLead":
    "It reads your new messages in batches, notes observations and proposes criteria. It never asks per batch and never notifies per observation: whatever changes shows up on the portrait for review.",
  "twin.learnNone": "No source learns continuously. It is turned on source by source under your histories, above.",
  "twin.learnActive": "learning",
  "twin.learnPaused": "paused",
  "twin.learnScopeGlobal": "every project",
  "twin.learnScopeProject": "this project only",
  "twin.learnPending": "Waiting to be read: {size} · conversations: {streams}",
  "twin.learnNothingPending": "Nothing waiting to be read",
  "twin.learnLast": "Last range processed: {date}",
  "twin.learnLastNone": "No range has been processed yet",
  "twin.learnSpend": "Automatic calls today: {used} of {subquota} · day's reading cap: {cap}",
  "twin.learnJobLine": "batches {status}: {n}",
  "twin.learnWorking": "Working: batches are queued.",
  "twin.learnWaitPaused": "Waiting: spending is paused.",
  "twin.learnWaitBudget": "Waiting: the day's quota ran out. What was saved is not paid twice; it continues tomorrow.",
  "twin.learnWaitProvider": "Waiting: no provider is configured.",
  "twin.learnWaitNoGrant": "Waiting: no learning permission is active.",
  "twin.learnWaitUnstable":
    "Waiting: the conversation is still open. The batch closes after thirty minutes of quiet, or four hours after the first pending message.",
  "twin.learnWaitNoPending": "Up to date: nothing new to read.",
  "twin.learnWaitNoReferent": "Up to date: the new messages named nothing to learn from.",
  "twin.learnPause": "Pause learning",
  "twin.learnPausing": "Pausing…",
  "twin.learnPauseNote":
    "Pausing or revoking the permission keeps your signatures, the published criteria and what you taught by hand; paid batches in flight stop counting. It resumes under your histories, above.",
  "twin.learnRevoked": "Batches in flight that stopped counting: {n}",
  "twin.learnRecentTitle": "Latest notes",
  "twin.learnRecentNone": "No observations have been noted yet.",
  "twin.observationKindReaction": "reaction",
  "twin.observationKindChoice": "choice",
  "twin.observationKindReason": "reason",
  "twin.observationKindCondition": "condition",
  "twin.observationKindException": "exception",
  "twin.observationKindCounterexample": "counterexample",
  "twin.observationKindCorrection": "correction",
  "twin.observationAmbiguous": "no referent: founds no preference",
  "twin.appliesWhen": "Applies when: {sentence}",
  "twin.exceptWhen": "Except when: {sentence}",
  "twin.families": "independent cases: {n}",
  "twin.familiesShort": "publishing on its own takes independent cases: {floor}",
  "twin.familiesLegacy": "independent cases: not counted (inherited)",
  "twin.signWhatYouSee": "Signing signs its conditions and exceptions too, as they read here.",
  "twin.proposalGroup": "proposals about this criterion: {n}",
  "twin.proposalEvidence": "evidence behind the proposal: {n}",
  "twin.saveStale": "Something changed since the screen was loaded; nothing was applied. It reloads so you sign what you see.",
  "twin.publicationTitle": "Publication to the file",
  "twin.publicationWordNone": "not planned",
  "twin.publicationWordPending": "pending",
  "twin.publicationWordPublished": "written",
  "twin.publicationWordConflict": "in conflict",
  "twin.publicationWordFailed": "failed",
  "twin.publicationNone": "No publication has been planned yet.",
  "twin.publicationPending": "Waiting to be written to the file.",
  "twin.publicationPublished": "Written to the file: {date}",
  "twin.publicationFailed": "The publication failed: {reason}",
  "twin.publicationConflictHint":
    "Someone edited TASTE.md since the publication was prepared. Reconciling reads the file again, keeps your edits and writes what is publishable once more.",
  "twin.publicationReconcile": "Reconcile now",
  "twin.publicationReconciling": "Reconciling…",
  "twin.publicationUnavailable": "The portrait could not be planned for the file; the changes were applied.",
  "twin.mineNoConsent":
    "None of your histories has permission, so not one file was opened. Say so under your histories, just above.",
  "twin.mineNoReadable":
    "The histories on this disk can’t be read yet, so no permission would help: not one file was opened.",
  "twin.mineNoHistories":
    "There is no agent history on this disk to read, so not one file was opened.",
  "twin.mineButton": "Look for what’s new in my history",
  "twin.mineButtonLeft": "Read my history · {n} left",
  "twin.distillNoConsent":
    "Let it read one of your histories first, just above. Without that there is nothing to read.",
  "twin.distillCost":
    "Reading the disk is free. Distilling what it brings calls your configured model, several times in a row, and goes against the daily reading cap.",
  "twin.distillGo": "Distil, quotes it would read: {n}",
  "twin.mining": "Reading your histories…",
  "twin.mined": "new quotes: {saved} · already there: {duplicates}",
  "twin.minedNone": "Nothing new in your histories since last time.",
  "twin.minedRecords": "and history records, also new: {n}",
  "twin.minedQuotes": "and quotes for the portrait, also new: {n}",
  "twin.minedDenied": "not allowed, and so not opened: {n}",
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
  "twin.spendMore": "Every organ, the caps and the price",
  "twin.readsSpent":
    "Today’s reads are spent. They come back tomorrow; the cap goes up on the Spend screen (/spend) or with PANOMA_READ_BUDGET. Today: {used} of {cap}.",
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
  "twin.synthTruncated": "Answers cut short and asked again with more room: {n}.",
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
    "MCP is the channel an agent uses to talk to your catalog. These are the ones on this machine: connecting one gives it the fifteen tools — the project brief on arrival, the log, the task queue, the handoff and panoma video — and writes its configuration where that agent reads it.",
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

  "spend.title": "Usage and limits",
  "spend.intro": "Panoma uses AI to analyze projects, review screenshots and build your memory. See that usage here and limit the calls each function can make.",
  "spend.scope": "Includes models and voice providers used by Panoma and its apps. It does not track your external agent sessions or subscription charges.",
  "spend.billingHint": "Cost is an estimate from your rates and recorded tokens, not an invoice. Calls without a rate or usage measurement can leave the amount incomplete.",
  "spend.totalCalls": "Recorded calls",
  "spend.estimatedCost": "Estimated cost",
  "spend.partialCost": "Partial estimate",
  "spend.noActivityCost": "No recorded usage",
  "spend.rateMissing": "Rate needed",
  "spend.rateUnmetered": "Token usage unavailable",
  "spend.dirty": "Unsaved changes",
  "spend.modelsEmptyHint": "Models appear after you use them through Panoma. You can then add their rates here to estimate cost.",
  "spend.unbudgetedHint": "These are also included in the totals. Credential tests, for example, are not subject to this page’s limits or pause.",
  "spend.capCalls": "Calls / day",
  "spend.capAttempts": "Attempts / day",
  "spend.usageCalls": "Calls today: {used} / {cap}",
  "spend.usageAttempts": "Attempts recorded today: {used} / {cap}",
  "spend.state.paused": "Paused",
  "spend.state.disabled": "Disabled",
  "spend.state.exhausted": "Limit reached",
  "spend.state.enabled": "Enabled",
  "spend.appReservationsHint": "Apps reserve attempts before running; pending reservations are not yet included in this count.",
  "spend.today": "Today",
  "spend.month": "Last 30 days",
  "spend.byModel": "Model costs and rates",
  "spend.caps": "What Panoma uses AI for",
  "spend.capsHint": "Each limit counts calls, not money, and resets at midnight on the Panoma server. Use 0 to disable a function or leave the field empty to restore its default.",
  "spend.shots": "Screenshot size for AI",
  "spend.shotsHint": "The image size sent for a screenshot review can affect its cost and the details the AI can detect.",
  "spend.shotFull": "Original size",
  "spend.shotFullHint": "Preserves the screenshot’s resolution and detail.",
  "spend.shotFit": "Fit the longest edge to {n} px",
  "spend.shotFitHint": "May reduce image usage. Small text and fine details can be lost.",
  "spend.shotsPng": "Resizing applies only to PNG; other formats keep their original size.",
  "spend.pause": "Pause functions with a daily limit",
  "spend.pauseHint": "Takes effect when saved and blocks new calls from the functions below. It does not cancel calls in progress or block credential tests.",
  "spend.paused": "Functions with a daily limit are paused.",
  "spend.currency": "Currency",
  "spend.currencyHint": "Three-letter code, such as USD or EUR. Enter rates in that currency: changing it does not convert amounts.",
  "spend.save": "Save settings",
  "spend.saving": "Saving…",
  "spend.saved": "Settings saved. They apply to future calls.",
  "spend.failed": "The catalog could not save the settings.",
  "spend.errBody": "The form could not be read.",
  "spend.errCaps": "A cap has to be a whole number between 0 and 100000.",
  "spend.errRates": "A rate has to be a number of zero or more, per million tokens.",
  "spend.errCurrency": "The currency is three capital letters, like USD.",
  "spend.errPaused": "The pause is yes or no.",
  "spend.errShots": "The screenshot size is either full or fitted, and nothing else.",
  "spend.errQuota": "The quota must be an integer from 1 to 1048576 MiB. Leave the field empty to restore the default.",
  "spend.storage": "Memory storage",
  "spend.storageHint": "Limit the new content that memory retains automatically. This is measured in MiB, separate from disk size and spending. Reaching the quota pauses capture and learning. No content is deleted to make room.",
  "spend.storageUsed": "Retained content: {used} / {limit} MiB",
  "spend.quotaCatalog": "Catalog quota (MiB)",
  "spend.quotaProject": "Quota per project (MiB)",
  "spend.diskUnknown": "The physical space available to the catalog could not be measured.",
  "spend.diskFull": "The catalog disk is full. Available space (MiB): {n}. Free space on that disk to save changes.",
  "spend.diskLow": "Physical space for the catalog is low (MiB): {n}. Raising the memory quota does not free disk space.",
  "spend.diskAvailable": "Physical space available on the catalog disk (MiB): {n}.",
  "spend.empty": "Panoma has not recorded any provider calls today.",
  "spend.monthEmpty": "No calls recorded in this period.",
  "spend.brokenFile": "The spend.json file exists and could not be read: the factory values are shown.",
  "spend.remote": "This catalog uses a remote database. Limits apply on the server running Panoma.",
  "spend.used": "{used} of {cap}",
  "spend.unbudgeted": "Calls outside daily limits",
  "spend.kindLine": "{name}: {n}",
  "spend.calls": "calls: {n}",
  "spend.tokens": "tokens: {input} in · {output} out",
  "spend.unmetered": "calls without complete usage data: {n}",
  "spend.images": "images: {n}",
  "spend.cost": "cost: {money}",
  "spend.unpriced": "calls without a rate: {n}",
  "spend.noCost": "Add model rates below to calculate an estimate.",
  "spend.daysAria":
    "Calls per day over the last thirty days. In total, calls: {calls}; input tokens: {input}; output: {output}",
  "spend.dayTitle": "{day} · calls: {calls} · tokens: {tokens}",
  "spend.model": "Model",
  "spend.colCalls": "Calls",
  "spend.colIn": "Input tokens",
  "spend.colOut": "Output tokens",
  "spend.colUnmetered": "Unmetered",
  "spend.colRateIn": "Input / 1M tokens",
  "spend.colRateOut": "Output / 1M tokens",
  "spend.colCost": "Estimated cost",
  "spend.rateHint": "Usage over the last 30 days. Enter your provider’s price per million input and output tokens. Panoma does not fetch prices automatically.",
  "spend.rateInLabel": "Input rate of {model}",
  "spend.rateOutLabel": "Output rate of {model}",
  "spend.envDecides": "This limit is set when Panoma starts with {name}={value}; it cannot be edited here.",
  "spend.envUnread": "{name} is “{value}” and cannot be read: the factory value applies, {factory}",
  "spend.factory": "default: {n}",
  "spend.family.read": "History analysis",
  "spend.family.look": "Screenshot reviews",
  "spend.family.memory": "Session memory",
  "spend.family.ask": "Twin responses",
  "spend.family.rehearse": "Decision lab",
  "spend.family.episodes": "Decision extraction",
  "spend.family.card": "Project analysis",
  "spend.familyHint.read": "Summarizes and organizes the history you import to build your Twin.",
  "spend.familyHint.look": "Analyzes project screenshots when you request a review or through the automatic watcher.",
  "spend.familyHint.memory": "Saves what was learned when agent sessions end, in the background.",
  "spend.familyHint.ask": "Drafts replies for your agents using your memory and preferences.",
  "spend.familyHint.rehearse": "Checks a decision against your principles and previous experiences.",
  "spend.familyHint.episodes": "Turns saved accounts into decisions Panoma can recall.",
  "spend.familyHint.card": "Generates project summaries and reviews their AGENTS.md instructions.",
  "spend.kind.look": "looks",
  "spend.kind.distill": "distillations",
  "spend.kind.classify": "topic passes",
  "spend.kind.synthesize": "syntheses",
  "spend.kind.memory": "memory distillations",
  "spend.kind.ask": "drafts of the double",
  "spend.kind.rehearse": "rehearsals",
  "spend.kind.episodes": "decision extractions",
  "spend.kind.describe": "project summaries",
  "spend.kind.review": "opinions on AGENTS.md",
  "spend.kind.probe": "credential tests",
  "spend.source.factory": "Default setting",
  "spend.source.file": "Set here",
  "spend.source.env": "Set at startup",
  "spend.source.paused": "paused",
  /* The handoff screen. See the Spanish block for the rules the copy follows. */
  "handoff.eyebrow": "Handoff",
  "handoff.title": "Continue a conversation somewhere else",
  "handoff.intro":
    "When an agent stops — a usage limit, a tool you prefer for this task, another machine — panoma writes the conversation into the other agent’s own history, so its normal resume picks it up. Or it tells you how to resume the same one after signing in. The original is never touched, and panoma never sees your login.",
  "handoff.refresh": "Look at the disk again",
  "handoff.listLoading": "Reading the histories…",
  "handoff.conversations": "Conversations on this disk",
  "handoff.conversationsLead":
    "What Claude Code, Codex, OpenCode and Gemini CLI kept on this computer, by project. Nothing is written until you ask.",
  "handoff.notInCatalog": "Not in the catalog",
  "handoff.scanHint": "Scan {path} to attach them to a project.",
  "handoff.turns": "turns: {n}",
  "handoff.size": "size: {size}",
  "handoff.summarized": "carries its own summary",
  "handoff.summarizedTitle":
    "The source agent already summarized the beginning of this conversation; that summary travels with it.",
  "handoff.limitBefore": "ended on a usage limit · back {relative} ({time})",
  "handoff.limitAfter": "limit lifted at {time}",
  "handoff.limitUnknown": "ended on a usage limit · reset time unknown",
  "handoff.resumeAsWas": "Resume as it was",
  "handoff.continueIn": "Continue in…",
  "handoff.filterAgent": "Agent",
  "handoff.filterProject": "Project",
  "handoff.allAgents": "All agents",
  "handoff.allProjects": "All projects",
  "handoff.showAll": "Show all",
  "handoff.emptyAll": "No conversations found on this disk",
  "handoff.emptyAllLead":
    "panoma reads the agents’ own histories; it writes nothing until you ask. CLAUDE_CONFIG_DIR, CODEX_HOME and XDG_DATA_HOME are honoured.",
  "handoff.storeFound": "{agent} · {path} · conversations: {n}",
  "handoff.storeMissing": "{agent} · {path} · not found",
  "handoff.emptyFilter": "Nothing from {agent} in {project}.",
  "handoff.remote": "This catalog lives on another machine. Its conversations are on that disk, not this one.",
  "handoff.panelTitle": "Continue in…",
  "handoff.loading": "Reading the conversation…",
  "handoff.close": "Close",
  "handoff.copy": "copy",
  "handoff.copied": "copied",
  "handoff.target": "Target",
  "handoff.targetInstalled": "installed",
  "handoff.targetNotInstalled": "history found, not installed here",
  "handoff.targetNative": "resumes it itself",
  "handoff.targetDocument": "document only",
  "handoff.sameAgent": "Same agent, another account",
  "handoff.sameAgentLimitHint": "the usual move when a limit hits: the other account continues from here",
  "handoff.sameAgentLead":
    "Your conversation stays on this disk. Sign out, sign in with the account you want, and resume it. panoma copies nothing and never sees your login.",
  "handoff.sameAgentStep1": "Sign out of {agent}:",
  "handoff.sameAgentStep2": "Sign in with the account you want to continue with:",
  "handoff.sameAgentInside": "or {command} inside claude",
  "handoff.sameAgentStep3": "Resume it:",
  "handoff.sameAgentStep4": "Optional — keep the original untouched by forking:",
  "handoff.sameAgentStep5": "Optional — keep a copy outside the agent:",
  "handoff.keepCopyHint": "Bring it into any agent later with: {command}",
  "handoff.sameAgentHome":
    "If {agent} has a second configuration folder, the terminal can write the copy there:",
  "handoff.sameFile": "the same file, as it is",
  "handoff.sameFileHint": "Nothing is written: sign in with the other account and resume it.",
  "handoff.sameCopyHint": "A shorter copy in the same history, with an id of its own, so the other account does not pay for the whole conversation again.",
  "handoff.writeCopy": "Write the shorter copy",
  "handoff.sameAgentApp": "Or open it in {app}, which adopts the original in place, with no copy:",
  "handoff.sameAgentAppNote":
    "Claude keeps its Code list per account: the conversation will not be in the new account’s list until this link adopts it.",
  "handoff.sameAgentCodexNote": "The Codex app lists it once this link registers it.",
  "handoff.targetAppSub": "desktop app · opens with a link",
  "handoff.openInApp": "Open in {app}",
  "handoff.appLine": "or, in a terminal:",
  "handoff.appTrust": "The app will trust the folder {cwd} when it adopts the conversation.",
  "handoff.appOpened": "{app} was asked to open it; if it does not show up, paste the line above.",
  "handoff.appOpenFailed": "Could not open it in {app}.",
  "handoff.inAppByHand.claude-app": "If the link does not answer: open Claude, the Code tab, the folder {cwd}, and pick the conversation {id}.",
  "handoff.inAppByHand.codex-app": "If the link does not answer: open the Codex app, the folder {cwd}, and pick the thread {id}.",
  "handoff.tier": "How much travels",
  "handoff.tier.full": "everything",
  "handoff.tier.compact": "digest + last turns",
  "handoff.tier.brief": "document only",
  "handoff.tierHint.full": "Every message and every tool call, as they are.",
  "handoff.tierHint.compact": "panoma’s digest and the newest turns; the rest stays.",
  "handoff.tierHint.brief": "A .md to paste as the first message in any agent.",
  "handoff.tierPreselected": "Preselected: this one is {size}",
  "handoff.documentOnly": "{agent} cannot resume a written conversation: it gets a document.",
  "handoff.digestModel": "Let a model write the digest",
  "handoff.digestLeft": "{n} of {cap} left today",
  "handoff.digestNoModel": "No model connected — choose one in AI",
  "handoff.digestSpent": "Today’s digests are spent — more tomorrow, or raise the cap in Spend · cap: {cap}",
  "handoff.digestPaused": "Model digests are paused or disabled — turn them on in Spend",
  "handoff.travels": "travels",
  "handoff.stays": "stays behind",
  "handoff.row.all": "every message and tool call",
  "handoff.row.digest": "the digest",
  "handoff.row.lastTurns": "the last turns: {n}",
  "handoff.row.thinking": "thinking",
  "handoff.row.images": "images",
  "handoff.row.subagents": "subagent runs",
  "handoff.row.offloaded": "offloaded tool outputs",
  "handoff.row.secrets": "secrets masked",
  "handoff.row.other": "other records",
  "handoff.never": "never travels",
  "handoff.yes": "yes",
  "handoff.no": "no",
  "handoff.sizeLine": "turns: {n} · ≈ {k}k tokens",
  "handoff.neverRunLive": "checked against the agent’s source, never run live",
  "handoff.digestPreview": "The digest that travels",
  "handoff.write": "Hand it to {agent}",
  "handoff.writing": "writing…",
  "handoff.writeTitle":
    "Writes a new conversation into {agent}’s own history on this computer. {agent} is not opened.",
  "handoff.copyDocument": "Copy the document",
  "handoff.saveDocument": "Save as .md",
  "handoff.savedAt": "Saved at {path}",
  "handoff.ready": "Ready. {agent} will find it as a new conversation titled “{title}”.",
  "handoff.resumeLine": "To resume it",
  "handoff.steps": "Before resuming",
  "handoff.stepClaude":
    "In this folder `claude --continue` now resumes the copy; use `claude --resume <id>` to pick either one by id.",
  "handoff.leftBehind": "Left behind: {list}",
  "handoff.left.thinking": "thinking",
  "handoff.left.images": "images: {n}",
  "handoff.left.subagents": "subagent runs: {n}",
  "handoff.left.offloaded": "offloaded tool outputs: {n}",
  "handoff.left.secrets": "secrets masked: {n}",
  "handoff.left.other": "other records: {n}",
  "handoff.already": "Already handed to {agent} on {date}. Resume that one:",
  "handoff.alreadyDocument": "Already handed to {agent} on {date} as a document.",
  "handoff.again": "Hand it again",
  "handoff.done": "Done so far",
  "handoff.doneEmpty": "No handoffs yet. The first one appears here with its resume command.",
  "handoff.receipt": "{source} → {target} · {tier} · {when}",
  "handoff.receiptVia": "via {agent}",
  "handoff.fileGone": "file gone — {agent} deleted or moved it",
  "handoff.openProject": "open the project",
  "handoff.projectMore": "See them all under Handoff",
  "handoff.fault.store-missing": "That agent’s history was not found on this computer.",
  "handoff.fault.conversation-not-found": "That conversation is no longer where it was.",
  "handoff.fault.ambiguous-id": "That prefix matches more than one conversation.",
  "handoff.fault.invalid-id": "That identifier is not the shape of any conversation.",
  "handoff.fault.unreadable-transcript": "The conversation could not be read: the file is not the shape expected.",
  "handoff.fault.unsupported-target": "That agent cannot receive a written conversation.",
  "handoff.fault.target-store-missing": "The target agent has no history on this computer yet: open it once and come back.",
  "handoff.fault.cwd-missing": "The conversation’s folder no longer exists.",
  "handoff.fault.write-failed": "The new conversation could not be written.",
  "handoff.fault.import-command-missing": "OpenCode is not installed here: run the import step by hand.",
  "handoff.fault.import-command-failed": "OpenCode’s import failed; the file stays so you can try by hand.",
  "handoff.fault.bundle-invalid": "That file is not a panoma conversation bundle.",
  "handoff.fault.too-large": "The conversation is over 64 MiB, which is more than a handoff carries.",
  "handoff.fault.nothing-to-carry": "There is no turn to carry.",
  "handoff.fault.same-store": "That is the same history: to go on in the same agent, sign in and resume, or pick «digest + last turns» for a shorter copy.",
  "handoff.fault.no-space-left": "No space left on the disk.",
  "handoff.fault.permission-denied": "No permission to write into that agent’s history.",
  "handoff.fault.read-only-disk": "That disk is read-only.",
  "handoff.fault.disk-error": "The disk returned an error while writing.",
  "project.conversations": "Conversations on this disk",
  "project.conversationsLead":
    "What Claude Code, Codex, OpenCode and Gemini CLI kept in this folder. Not what they reported to panoma — that is under Agents.",
  "project.noConversations":
    "No conversations in this folder yet. When Claude Code, Codex, OpenCode or Gemini CLI talks here, it shows up.",
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
