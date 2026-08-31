# La hoja de estilos de la aplicación

Esto es el CSS del catálogo — el grupo de rutas `(app)`, que desde la mudanza del sitio
público es lo único que hay en esta aplicación. La landing y `/docs` viven en `apps/site`, con
su propia hoja (`apps/site/app/site.css`) y sus propios módulos: nada de aquí llega allí, y
nada de allí llega aquí.

`app/globals.css` es la puerta: no contiene ni una declaración, solo trae los trozos en
orden. Todo lo demás vive en este directorio.

## Los trozos, y por qué ese orden

| fichero | qué pinta |
| --- | --- |
| `theme.css` | Las fichas de color y tipografía de Tailwind (`@theme`) |
| `tokens.css` | La escala de color, las sombras y los papeles semánticos |
| `base.css` | El documento, el cuerpo y lo que no es de ninguna pantalla |
| `app-shell.css` | Barra superior y barra lateral |
| `overlays.css` | Paleta de comandos y confirmación destructiva |
| `app-layout.css` | Pie de la barra lateral y ancho del área de contenido |
| `catalog-screen.css` | Catálogo: su paleta, el parte del día y los filtros |
| `catalog-views.css` | Lista y rejilla del catálogo |
| `detail-panel.css` | El panel lateral de un proyecto |
| `catalog-empty.css` | Vacíos del catálogo y sus cortes de ancho |
| `project-header.css` | Ficha: paleta propia, cabecera y acciones |
| `project-panels.css` | Ficha: paneles del resumen |
| `project-md.css` | Ficha: el `.md` de los agentes y las cuentas |
| `project-sections.css` | Ficha: secciones profundas |
| `responsive.css` | Los cortes de ancho que quedan, y el foco global |
| `catalog-extras.css` | Sitios, girador y modo discreto |
| `share.css` | Compartir, y el catálogo que no abre |
| `model-picker.css` | El selector de modelos de `/ai` |
| `forced-colors.css` | Alto contraste de Windows: lo que decía el color lo dice la forma |
| `print.css` | La hoja de papel: la ficha de un proyecto impresa |

**El orden no es cosmético.** En CSS, dos reglas con el mismo peso las decide quién va
después, y aquí hay cuatro sitios donde eso es la regla:

1. `catalog-empty.css` pisa a `catalog-screen`, `catalog-views` y `detail-panel`: sus tres
   `@media` cambian `grid-template-columns` de la fila, apagan `.catalog-hint` y sacan al
   panel de detalles de `sticky`.
2. `project-sections.css` pisa a `project-panels.css` en tres reglas
   (`.project-deep-heading`, su `h2` y `.project-empty-state`).
3. `responsive.css` pisa a casi todos los anteriores. Va detrás de ellos a propósito; si
   se adelantara, en móvil el contenido se quedaría con 68 px de margen por una barra que
   está abajo.
4. Dentro de `responsive.css`, `html.sidebar-collapsed .app-main` se redeclara con el
   mismo peso que en `app-layout.css` y gana solo por ir después.

`styles.test.ts` fija esa lista y ese orden. Cambiarlos obliga a tocar el test, que es
justo la fricción que se busca.

## Dos vocabularios, y cuál usar

Hay **dos** sitios donde nacen colores, y no son intercambiables:

- **`theme.css`** — el bloque `@theme` de Tailwind. De aquí salen las *utilidades* que se
  escriben en el JSX: `text-faint`, `border-edge`, `bg-surface`, `text-accent`. El marcado
  las usa unas setecientas veces. Su vocabulario es `chalk / smoke / faint / edge /
  surface / raised / ground / live / idle / dormant / nogit / accent / warn / fail`.
- **`tokens.css`** — propiedades normales en `:root`. De aquí no sale ninguna utilidad;
  esto se consume con `var()` desde el propio CSS. Su vocabulario es `ink / line / wash /
  paper / danger / success / seal / scrim`, porque es el que ya usan las dos paletas de
  pantalla que alimenta, más cuatro familias que no son color: `corner` (esquinas),
  `shadow`, `z` (capas) y `duration` / `ease` (tiempos).

**Ojo con los nombres de Tailwind.** `--radius-sm`, `--radius-lg`, `--shadow-md`,
`--breakpoint-*` y compañía son fichas suyas: redeclararlas —aunque sea dentro de una
pantalla— cambia en silencio las utilidades que las consumen. Las esquinas de esta app se
llaman `--corner*` justo por eso; el día que hubiera un `rounded-sm` dentro de la ficha,
habría salido a 5px en vez de a 4 y nadie lo habría relacionado con esto.

Sí, hay dos palabras para algunas cosas (`chalk` y `ink`, `edge` y `line`, `live` y
`success`). No es un descuido: unificarlas significa renombrar las setecientas utilidades
del marcado, y eso es un cambio mecánico grande que merece su propio día. Mientras tanto,
la regla es simple: **si el valor ya existe en `theme.css`, se usa ese y no se duplica.**

**Para elegir dónde poner un color nuevo:** ¿lo va a escribir un componente como clase?
Entonces `theme.css`. ¿Solo lo va a usar el CSS? Entonces `tokens.css`.

## Las dos paletas de pantalla

`.catalog-screen` y `.project-detail-page` declaran cada una su `--ink`, `--paper`,
`--line`, `--line-strong` y `--wash`, con los mismos nombres y **valores distintos**. Son
dos pantallas que se dibujaron por separado. Los valores están enfrentados en `tokens.css`.

Solo esos cinco nombres coinciden. `--card`, `--radius`, `--shadow-window`, `--muted` y
`--faint` nacen **solo** en la ficha; `--ink-2`, `--ink-3`, `--select`, `--good`, `--bad` y
`--lift` nacen **solo** en el catálogo.

De ahí la regla que ya siguen `.open-menu__list` y `.catalogo-caido`: **toda regla que se
pueda pintar bajo las dos pantallas necesita respaldo**, `var(--ink, var(--color-ink-catalog))`.

## Tres cosas que rompen la hoja sin dar un solo error

**No envuelvas ningún trozo en `@layer`.** Tailwind emite sus utilidades dentro de
`@layer utilities`, y en la cascada todo el CSS sin capa gana a cualquier capa. Esta hoja
gana siempre a `rounded-lg`, `text-faint` o `p-4`, y la app entera está construida sobre
eso. Meterlos en `@layer components` invertiría la relación de golpe. El test lo comprueba.

**No reordenes los `@import`.** Ver arriba.

**No cites un token de `@theme` solo desde un `style={{…}}` de TSX.** Tailwind poda las
fichas que no menciona nadie, y no mira dentro del JSX: el token desaparecería de la salida
sin aviso. Hoy no ocurre —el marcado no usa `var()` en ninguna parte— y conviene que siga
así.

## Límites conocidos

Están aquí escritos porque una carencia anotada es una decisión, y una sin anotar es un
descuido.

- **Una sola paleta, a propósito.** `html { color-scheme: light }` y ni un
  `prefers-color-scheme` en toda la hoja. Añadir un tema oscuro es posible y los dos únicos
  puntos de entrada son `.catalog-screen` y `.project-detail-page` — por eso conviene **no**
  disolverlos en `:root`. Pero es una superficie grande y no está hecha.
- **Siete colores de texto no llegan a AA, y ya no se cuentan a mano.** El inventario
  vive en `contrast.test.ts`, que vuelve a medir en cada ejecución: una lista escrita a
  mano envejece en silencio, porque un comentario con una cifra vieja no falla nunca.

  Los que el **marcado** escribe como `text-…`, medidos sobre blanco, que es el papel más
  generoso que hay (WCAG 2.1, 4.5:1 para texto normal; el umbral de 3:1 es para texto
  grande y aquí no hay ninguno — el texto de color va a 11 y 12 píxeles):

  | token | sobre blanco | qué es |
  | --- | --- | --- |
  | `--color-idle` | 2.15:1 | el ámbar de «en pausa», y 32 sitios lo escriben como palabra |
  | `--color-dormant` | 2.54:1 | el gris de «dormido» |
  | `--color-live` | 2.56:1 | el verde de «activo», y 17 sitios lo escriben como palabra |
  | `--color-faint` | 2.58:1 | el gris de `.eyebrow`, y 185 sitios más |
  | `--color-warn` | 3.54:1 | el ámbar de los avisos |

  Y los que solo consume el **CSS**, anotados uno a uno en `tokens.css`:
  `--color-ink-faint-catalog` 2.94:1 sobre su papel y `--color-success` 3.61:1 sobre
  blanco. Los dos valen para un icono o un borde, no para texto.

  Ninguno es un descuido: son la paleta de la casa, y subirlos de tono es un cambio de
  identidad visual que se decide mirando la pantalla. Lo que el test impide es que aparezca
  un **octavo** sin que nadie se entere.

- **El rojo de que algo falló sí se arregló, y es `--color-fail`.** Vive en `theme.css`
  porque el marcado lo escribe como clase. Sustituye a tres rojos de fábrica de Tailwind
  que nadie había elegido —`text-red-400` 2.61:1, `text-red-500` 3.81:1, `text-red-600`
  4.30:1— y a los cuatro rojos de `tokens.css` que se usaban como texto, dos de los cuales
  tampoco llegaban. Mide 5.39:1 en el peor papel de la aplicación y 4.59:1 sobre su propio
  tinte al 10 %, que es el fondo de las pastillas de gravedad. `contrast.test.ts` lo
  comprueba sobre los trece papeles, uno a uno.
- **Sin `prefers-contrast`.** `forced-colors.css` cubre el modo de alto contraste de
  Windows, que es donde la app se rompía de verdad; `prefers-contrast: more` —el ajuste
  suave, sin paleta forzada— sigue sin tocar nada. Es una decisión pendiente, no un olvido:
  significaría subir de tono los cuatro grises de abajo, y eso es un cambio visual.
- **En papel, dos grises suben y en pantalla no.** `print.css` sube `.eyebrow` y compañía a
  `--color-smoke` porque una impresora de chorro convierte 2.58:1 en nada. En pantalla los
  valores siguen intactos: cambiarlos ahí es la decisión visual del punto de arriba.
- **El 60 de la ficha de la cuenta es un número local.** `.app-topbar` es `fixed` con capa
  propia, así que abre su propio contexto de apilado y su hija nunca puede subir por encima
  del 50 global. Se llama `--z-account` para que no se lea como si compitiera con
  `--z-overlay`, pero comparte valor con `--z-dock` por casualidad, no por diseño.
- **Seis duraciones para tres trabajos.** La misma pareja de propiedades se anima a 120ms
  en tres reglas y a 160ms en dos, y los tres giros de carga van a 620, 620 y 900. Los
  valores se conservan y están juntos en `tokens.css`; unificarlos es una decisión de
  sensación, no una limpieza.

## Cómo comprobar que un cambio no movió nada

Las dos herramientas están en el historial de este trabajo y se pueden rehacer en veinte
líneas: se concatenan los trozos en el orden de `globals.css`, se deshace cada `var()`
hasta el literal, se quitan comentarios y espacios, y se compara con la hoja de antes. Si
el texto resultante es idéntico, no se movió un píxel. Es como se comprobó que partir seis
mil líneas y sustituir 119 literales no cambiaba nada.
