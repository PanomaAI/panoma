# Contribuir a panoma

Esta es la traducción al español. La versión canónica está en
[`CONTRIBUTING.md`](../CONTRIBUTING.md).

Gracias por mirar. Esta guía lleva una aportación desde la primera búsqueda hasta la
revisión: qué conviene hablar antes, dónde vive cada pieza, cómo montar el entorno y qué
evidencia necesita un pull request para poder revisarse.

Al participar aceptas el [código de conducta](CODE_OF_CONDUCT.es.md). Las discrepancias sobre
el código se resuelven con evidencia y argumentos; el respeto a quien está detrás no se
negocia.

## Antes de escribir código

Busca primero en las [incidencias](https://github.com/PanomaAI/panoma/issues?q=is%3Aissue)
y los [pull requests](https://github.com/PanomaAI/panoma/pulls?q=is%3Apr), incluidos los
cerrados. Busca también en `apps/`, `packages/` y `docs/`: el seguimiento puede ir por
detrás del código. Si ya hay un pull request para lo mismo, ayudar a terminarlo suele ser
más útil que abrir otro; si hay una incidencia, deja un comentario antes de empezar un
cambio grande para que dos personas no hagan el mismo trabajo.

| lo que traes | por dónde empezar | qué hace falta |
| --- | --- | --- |
| Un fallo | [Informe de fallo](https://github.com/PanomaAI/panoma/issues/new?template=bug_report.yml) | Lo esperado, lo ocurrido, pasos exactos, versión y sistema operativo. Si falla el escaneo, `panoma --version` ahorra media conversación. |
| Una función nueva o un cambio de arquitectura | [Propuesta](https://github.com/PanomaAI/panoma/issues/new?template=feature_request.yml), antes del código | El problema, cómo se resuelve hoy y por qué encaja en el norte de panoma. |
| Una corrección inequívoca de documentación | Un pull request directo puede bastar | Qué afirmación era incorrecta y cómo comprobaste la correcta. Si cambia una decisión, abre una propuesta primero. |
| Un posible fallo de seguridad | [Aviso privado](SECURITY.es.md), nunca una incidencia pública | Impacto, versión, sistema y una reproducción mínima sin publicar claves ni rutas privadas. |

Panoma tiene un norte estrecho a propósito —ser la puerta de entrada a los proyectos que ya
tienes en el disco— y decir que no a cosas buenas que no son eso es parte del trabajo. Vale
más media hora de conversación que una tarde de código que no se puede fusionar.

Antes de tratar algo extraño como un fallo, lee [las preguntas abiertas](../docs/open-questions.md).
Ahí están tanto los huecos que sí se pueden coger como las decisiones que parecen a medias y
no deben «arreglarse» sin reabrir antes el argumento.

## Encontrar la pieza correcta

La primera vez, lee [la arquitectura](../docs/architecture.md),
[el vocabulario](../docs/glossary.md) y [la doctrina](../docs/doctrine.md). Después sigue solo la
ruta de lo que vayas a tocar:

| si vas a tocar… | empieza en | lee antes |
| --- | --- | --- |
| El terminal | `apps/cli` | [cli.md](../docs/cli.md) |
| Una pantalla o un componente del catálogo | `apps/web` | [web-app.md](../docs/web-app.md), [accessibility.md](../docs/accessibility.md) e [i18n.md](../docs/i18n.md) |
| Una ruta HTTP | `apps/web/app/api` | [http-api.md](../docs/http-api.md) y [guards.md](../docs/guards.md) |
| El análisis de una carpeta | `packages/core` | [discovery.md](../docs/discovery.md), [analysis.md](../docs/analysis.md) y [health.md](../docs/health.md) |
| El esquema o una migración | `packages/db` | [database.md](../docs/database.md) y [single-writer.md](../docs/single-writer.md) |
| El canal de agentes | `packages/mcp` y `/api/agent/*` | [agent-channel.md](../docs/agent-channel.md), [mcp-security.md](../docs/mcp-security.md) y [untrusted.md](../docs/untrusted.md) |
| `run`, `check` o el enriquecimiento | `packages/runner` y `packages/enrich` | [run-and-isolation.md](../docs/run-and-isolation.md) y [enrichment.md](../docs/enrichment.md) |
| La landing, `/docs` o el despliegue | `apps/site` | [deploy.md](../docs/deploy.md); acuerda primero el alcance porque esa aplicación se publica y lleva otro ritmo. |

El índice entero está en [docs/README.md](../docs/README.md). Si una carpeta trae su propio
`AGENTS.md`, sus instrucciones se suman a estas para todo lo que haya debajo.

## Montarlo

Hace falta Node 22 o superior y pnpm. El suelo es 22 y no 20 porque es lo que el CI
mide de verdad: la matriz corre la 22 y la última en los tres sistemas, y prometer una
versión que nadie ejecuta es prometer de más. Hay una `.nvmrc` con el suelo y la versión
de pnpm fijada está en `packageManager`, dentro de `package.json`.

Haz un fork, clónalo y, desde la raíz del repositorio, deja primero el punto de partida en
verde:

```bash
pnpm install
pnpm --filter "./packages/*" build
pnpm test
```

La compilación de los paquetes no es opcional: las aplicaciones y los paquetes se importan
entre sí por `dist`. Sin ella, los tests fallan con `Failed to resolve entry for package
"@panoma/db"`, que parece un `package.json` roto y no un paso ausente. Si cambias un paquete
y pruebas después a quien lo consume, reconstrúyelo antes; por ejemplo:

```bash
pnpm --filter @panoma/core build
pnpm vitest run packages/mcp/src/format.test.ts
```

Para trabajar con las dos superficies principales:

```bash
pnpm run dev                              # catálogo en http://localhost:4173
pnpm --filter panoma run dev -- --help   # CLI sin compilar
```

El servidor usa `~/.panoma` de fábrica. Si ya utilizas panoma, no levantes dos servidores
sobre el mismo directorio de datos: PGlite admite un solo escritor. Usa un `PANOMA_HOME`
absoluto y un `PANOMA_DIST` distintos para el entorno de desarrollo; el motivo y los límites
están en [environment.md](../docs/environment.md).

## Comprobar el cambio

Antes de abrir un pull request:

```bash
pnpm lint
pnpm -r typecheck
pnpm test
```

Los tres tienen que estar en verde.

Además, recorre a mano el camino que cambiaste. Si tocaste el ensamblado de Next, el
empaquetado, una dependencia o una frontera entre paquetes, ejecuta también `pnpm build`.
El CI lo hará de todos modos, pero la descripción del pull request debe poder contar qué
comprobaste tú y qué dejaste únicamente al CI.

Si el cambio toca rutas, procesos, shells, permisos o programas externos, lee también
[platforms.md](../docs/platforms.md) y piensa en macOS, Linux y Windows. La matriz los ejecuta,
pero no sustituye contar en cuál probaste a mano y cuál conoces solo por el CI.

La suite entera tarda cerca de un minuto: una docena de suites levantan un PostgreSQL en
WASM dentro de su `beforeAll`, y los tests van en serie a propósito porque el recurso
compartido es el disco. Mientras trabajas, un test suelto:

```bash
pnpm vitest run apps/web/lib/format-bytes.test.ts
```

**Hay linter, y no hay formateador.** La diferencia importa. `pnpm lint` comprueba lo que
un typecheck no puede: código que sobra, capturas que pierden la causa de lo que falló, y
las reglas de los hooks de React. Está en verde y se pide que siga estándolo.

Formato no se comprueba, y es a propósito: los comentarios de este código están rotos a
mano alrededor de 96 columnas y esa forma es parte de cómo se lee. Un formateador la rehace
y el diff se vuelve ilegible. Así que no mandes un diff reformateado. Sangría de dos
espacios, comillas dobles y punto y coma; está en `.editorconfig`, que tu editor lee solo.

Si el linter te señala algo que de verdad es correcto, apágalo **en la línea** con el
motivo escrito detrás de `--`, no en la configuración:

```ts
// eslint-disable-next-line prefer-const -- `close()` lo captura antes de asignarlo
```

## Cómo se escribe aquí

- **El inglés es el idioma canónico de la prosa del repositorio.** Los identificadores, los
  nombres de fichero, los comentarios, la documentación y los mensajes de commit van en
  inglés. Las traducciones al castellano viven en `translations/` y enlazan al original.
- **Un comentario que cuenta una decisión vale**; uno que repite la línea de abajo,
  estorba. Si arreglas algo sutil, deja escrito qué se rompía — el siguiente que pase
  por ahí lo va a necesitar.
- **Todo lo que el usuario ve pasa por el diccionario** (`apps/web/lib/i18n.ts` o
  `apps/site/landing/landing-copy.ts`). Texto fijo en un componente es un fallo:
  la interfaz es bilingüe entera.
- **Las promesas se prueban.** Si tu cambio afirma algo —que un orden es correcto, que
  una ruta no filtra— que haya un test que falle si deja de ser verdad.
- **El test vive al lado de su código, y es un `.ts`.** Vitest no transforma `.tsx` a
  propósito: la lógica que merece prueba tiene que poder importarse sin montar React. Lo
  que sí se puede comprobar de un componente es su contrato, leyendo el fuente como
  texto — `apps/web/components/project-views.test.ts` es el ejemplo a copiar, y
  `apps/web/app/styles/styles.test.ts` es el mismo patrón sobre la hoja de estilos.
- **Los mensajes de commit cuentan el efecto, no el fichero.** «Model selection no longer
  filters against the saved value», no «Fix ai-panel.tsx».

No edites a mano el bloque gestionado de `AGENTS.md`: `panoma md sync` lo genera desde el
disco y sobrescribirá el cambio. Tampoco mezcles un arreglo con reformateos, renombres o
limpiezas que no necesita; una aportación enfocada permite revisar el riesgo real.

## Preparar el pull request

Abre el pull request contra `main` y deja su descripción como el registro durable del
cambio, no como una nota de entrega. Tiene que contestar:

- **Qué problema resuelve y por qué pertenece a panoma.** Enlaza la incidencia con `Closes
  #…` cuando corresponda.
- **Qué comportamiento cambió.** Cuenta el efecto observable, no una lista de ficheros.
- **Cómo se comprobó.** Incluye los comandos exactos, el recorrido manual, el sistema
  operativo y cualquier límite que no pudiste verificar.
- **Qué lo protege en adelante.** Señala el test que fallaría si la promesa se rompe. Para
  una corrección documental, cuenta contra qué fuente comprobaste el dato.

Si cambia una pantalla, guarda la captura final en `.panoma/shots/` y adjunta al pull request
una imagen de antes y otra de después. La carpeta está ignorada por git: es evidencia para
revisar, no parte del producto.

Un pull request hace una sola cosa. Si durante el trabajo encuentras otro problema, anótalo
en otra incidencia o explica por qué es inseparable; no lo arregles de paso. Si la revisión
cambia el alcance o la verificación, actualiza la descripción para que la conversación y el
código no cuenten historias distintas.

## El acuerdo de colaboración (CLA)

Antes de fusionar tu primera aportación tienes que firmar el
[acuerdo de colaboración](../CLA.md). Se lee en cinco minutos, se firma una vez y cubre
tanto lo que ya habías enviado como todo lo que envíes después. Cuatro cosas, sin
rodeos:

**Conservas tu copyright.** Es una licencia, no una cesión. Puedes usar, publicar y
relicenciar tu propio trabajo como quieras, siempre.

**Para qué nos sirve:** para vender excepciones a la AGPL y para construir productos de
pago que reutilicen código del proyecto — las dos cosas, con las mismas palabras que
usa el §2 del acuerdo. Hay empresas que no pueden usar software AGPL por política
interna; venderles una licencia comercial del mismo código, y cobrar por servicios
nuevos construidos encima, es como se financia este proyecto sin cerrarlo. Ofrecer eso
exige permiso de todo el que haya escrito una línea — eso es lo que firmas.

**Lo que nos ata a nosotros (§4 del acuerdo):** todo lo que aportes seguirá disponible
bajo su licencia libre, como cláusula del contrato y no como promesa de blog. Si esa
cláusula se rompiera y no se subsanara, el acuerdo te da derecho a retirarnos la
licencia hacia adelante — y lo que el público ya recibió bajo AGPL es irrevocable, así
que la base legal de un fork queda intacta a propósito. Cerrar lo que tú aportaste no
es que no queramos: es que firmamos que no podemos.

**No lo inventamos nosotros:** es la estructura del CLA de Element para Synapse y la
que Canonical usa para Ubuntu desde hace más de una década — el ICLA de Apache más el
compromiso de licencia de salida del proyecto Harmony (la «Opción Cinco»).

Para firmar, abre tu pull request y publica en él este comentario, exacto:

```
I have read the CLA Document and I hereby sign the CLA
```

Las firmas se guardan en [`.github/cla-signers.json`](../.github/cla-signers.json), en
este repositorio y a la vista. Ningún servicio externo las custodia ni tiene permisos
sobre este repo.

### Si el código que escribes es de tu empresa

Entonces no puedes firmar el individual con verdad, porque en él afirmas que la obra es
tuya. Para eso está el [acuerdo corporativo](../CCLA.md), y la diferencia es quién firma: no
tú, sino alguien que pueda obligar a la empresa. Trae además una lista de personas
autorizadas —el Anexo A— y a partir de ahí sus pull requests no necesitan firma
individual; el comprobador automático las reconoce.

Escribe a `support@panoma.ai` desde una dirección de la empresa antes de abrir el pull
request. El acuerdo y la lista quedan en
[`.github/cla-signers.json`](../.github/cla-signers.json), a la vista como todo lo demás.

## Licencia

Al contribuir, aceptas que tu trabajo se publique bajo la
[AGPL-3.0](../LICENSE), como el resto del proyecto.
