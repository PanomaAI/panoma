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
después. Dentro de la pantalla eso es la regla en cuatro sitios —los que `globals.css` llama
«los que más duelen»—:

1. `catalog-empty.css` pisa a `catalog-screen`, `catalog-views` y `detail-panel`: sus
   `@media` cambian `grid-template-columns` de la fila y sacan al panel de detalles de `sticky`.
2. `project-sections.css` pisa a `project-panels.css` en **dos** reglas
   (`.project-deep-heading` y su `h2`). Eran tres: `.project-empty-state` estaba en las dos
   hojas y se leía como un pisotón deliberado, pero era una sola clase declarada dos veces —
   ahora vive una vez, en `project-panels.css`.
3. `responsive.css` pisa a casi todos los anteriores. Va detrás de ellos a propósito; si
   se adelantara, en móvil el contenido se quedaría con 68 px de margen por una barra que
   está abajo.
4. Dentro de `responsive.css`, `html.sidebar-collapsed .app-main` se redeclara con el
   mismo peso que en `app-layout.css` y gana solo por ir después.

Y hay dos más, que son los dos últimos trozos y no se ven en pantalla: `forced-colors.css`
y `print.css` reescriben reglas de casi todos los anteriores con el mismo peso y ganan solo
por ir al final. Cada uno lo lleva escrito en su cabecera. Son seis en total, no cuatro.

`styles.test.ts` fija esa lista y ese orden. Cambiarlos obliga a tocar el test, que es
justo la fricción que se busca.

## Dos vocabularios, y cuál usar

Hay **dos** sitios donde nacen colores, y no son intercambiables:

- **`theme.css`** — el bloque `@theme` de Tailwind. De aquí salen las *utilidades* que se
  escriben en el JSX: `text-faint`, `border-edge`, `bg-surface`, `text-accent`. El marcado
  las escribe **más de mil veces**; contadas sobre `components/` y `app/(app)/` el
  8-sep-2026, 1.157. Aquí ponía «unas setecientas», que es lo que suman las `text-…`
  solas —695 ese mismo día— sin las otras familias que también llevan color: `border-…`
  303, `bg-…` 155, y dos `decoration-…` y dos `divide-…`. La cifra exacta se mueve con
  cada componente que se escribe; el orden de magnitud, no. Su vocabulario son quince
  colores: `chalk / smoke / faint / edge / edge-bright / surface / raised / ground / live /
  idle / dormant / nogit / accent / warn / fail`.
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
`success`). No es un descuido: unificarlas significa renombrar las mil y pico utilidades
del marcado, y eso es un cambio mecánico grande que merece su propio día. Mientras tanto,
la regla es simple: **si el valor ya existe en `theme.css`, se usa ese y no se duplica.**

**Para elegir dónde poner un color nuevo:** ¿lo va a escribir un componente como clase?
Entonces `theme.css`. ¿Solo lo va a usar el CSS? Entonces `tokens.css`.

## Las tres puertas, y por qué siguen siendo tres

Hasta el 8-sep-2026 esto se llamaba «las dos paletas de pantalla» y describía un problema:
`.catalog-screen` y `.project-detail-page` declaraban cada una `--ink`, `--paper`, `--line`,
`--line-strong` y `--wash`, con los mismos nombres y valores distintos, y un tercio de la
aplicación —dieciocho páginas sobre `.legacy-page`, que ya no existe— no declaraba nada y se pintaba con
utilidades de Tailwind escritas a mano.

**Los roles se declaran ahora una sola vez, en `:root`** (final de `tokens.css`), y las dos
clases que quedan son *puntos de anulación* que casi no anulan nada:

| clase | lo único que sigue siendo suyo | declaraciones |
| --- | --- | --- |
| `.catalog-screen` | `--paper` significa aquí la tarjeta y no la página, y pinta su banda | de 11 a 2 |
| `.project-detail-page` | pinta su fondo, su tinta y el suavizado | de 8 a 3 |

Iban a ser tres. `.legacy-page` era la tercera, y dejó de hacer falta: cuando las veinte
pantallas pasaron a `<PageShell>` se quedó sin nadie que la escribiera, y quien lo dijo no fue
nadie acordándose sino el test de clases huérfanas. Una puerta sin nada detrás no es una puerta.

**Que las dos sigan existiendo es a propósito**, y es lo que dice el apartado de límites de más
abajo: son la única puerta por la que entraría un tema oscuro, y disolverlas en `:root` la
cerraría.

Lo peligroso nunca fueron las clases. Era que **366 reglas leen esos nombres y 339 lo hacen sin
respaldo**, y un `var()` sin declarar no es un error en CSS: la declaración se descarta y la
propiedad se queda con lo que heredó. Eso ya había costado tres fallos y uno de ellos estaba en
producción: `.open-project-action` se pintaba en `/unsaved` sin borde y sin relleno desde que esa
página existe, porque lee `--line-strong`, `--card` y `--muted` y las tres vivían solo en la
ficha. Con los roles en `:root` no queda ninguna regla que pueda pintarse donde sus nombres no
existen, y los respaldos que ya estaban escritos —`var(--ink, var(--color-ink))`— se quedan:
no cuestan nada y documentan el peligro.

### Lo que costó unificarlas, en valores

Seis grises se quedaron en dos filos; dos tintas, en una; dos grises medios, en uno; dos
tenues, en uno. Los papeles se fueron a `theme.css`, que es de donde el marcado ya los leía.
Los sufijos `-catalog` y `-sheet` han desaparecido de todos los nombres, porque un sufijo con
el nombre de una pantalla es la promesa de que las dos van a seguir separadas.

De las cuatro diferencias que quedaban, **solo una se veía**, y esa la decidió el dueño:

| nombre | catálogo | ficha | Δ por canal | Δ luminancia | queda en |
| --- | --- | --- | --- | --- | --- |
| `--line-strong` | `#dbdde0` | `#c8c8c8` | 19 · 21 · 24 | 0,1440 | **`#dddddd`** |
| `--line` | `#ebecee` | `#e6e6e6` | 5 · 6 · 8 | 0,0470 | `#e6e6e6` |
| `--paper` | `#ffffff` | `#fafafa` | 5 · 5 · 5 | 0,0440 | página `#fafafa`, tarjeta `#ffffff` |
| `--ink` | `#0e0f11` | `#0a0a0a` | 4 · 5 · 7 | 0,0017 | `#0a0a0a` |

Las tres últimas se decidieron con la calculadora —las dos negras de `--ink` se separaban en
diecisiete diezmilésimas de luminancia— y la primera con los ojos, que es lo que había que
hacer: es el filo de los doce paneles más grandes de la ficha.

Y la paleta entera pasó a **neutro puro**, que es la de la ficha y, letra por letra, la del
sitio público. **No costó un punto de legibilidad**, y eso no es suerte: una razón de contraste
de la WCAG depende solo de la luminancia relativa, así que un gris sustituido por el neutro de
la misma luminancia conserva todas sus cifras. Las excepciones están anotadas en `theme.css`.

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
- **Seis colores no llegan a AA sobre blanco, y ninguno se queda corto sobre su papel.** Y
  ya no se cuentan a mano: el inventario vive en
  `contrast.test.ts`, que vuelve a medir en cada ejecución: una lista escrita a mano
  envejece en silencio, porque un comentario con una cifra vieja no falla nunca.

  Los que el **marcado** escribe como `text-…`, medidos sobre blanco, que es el papel más
  generoso que hay (WCAG 2.1, 4.5:1 para texto normal; el umbral de 3:1 es para texto
  grande y aquí no hay ninguno — el texto de color va a 11 y 12 píxeles):

  | token | sobre blanco | qué es |
  | --- | --- | --- |
  | `--color-idle` | 2.15:1 | el ámbar de «en pausa», escrito como palabra en el marcado: 34 |
  | `--color-dormant` | 2.55:1 | el gris de «dormido» |
  | `--color-live` | 2.56:1 | el verde de «activo», escrito como palabra en el marcado: 18 |
  | `--color-faint` | 2.58:1 | el gris de `.eyebrow`, y de otros sitios hasta 172 |
  | `--color-warn` | 3.54:1 | el ámbar de los avisos |

  Las cuentas de sitios son del 8-sep-2026 y se mueven con cada componente que se escribe
  —aquí ponían 36, 20 y 188, y antes 32, 17 y 185: bajaron el mismo día, al reescribirse el
  lanzador del catálogo—; la medida de contraste, no: esa la rehace el test en cada ejecución.
  Lo que sí envejece es la copia a mano que hay aquí, y ya había pasado: en esta tabla ponía
  2.54 para el gris «dormido», que es su cifra de antes de la paleta neutra. Mide 2.55, y eso
  es lo que dice el test.

  Y el que solo consume el **CSS**, anotado en `tokens.css`: `--color-success`, 3.61:1
  sobre blanco. Vale para un icono o un borde, no para texto. Aquí figuraba también
  `--color-ink-faint-catalog` con su 2.94:1, y ya no: `.catalog-screen` construye su
  `--ink-3` con el gris de la **ficha**, así que ninguna regla leía ese valor y se ha ido
  de `tokens.css`. Era la forma más silenciosa de esta trampa — una cifra que describe un
  color que nadie pinta no falla jamás.

  **Y el séptimo, que ya no lo es.** El blanco es el papel más generoso, y quien escribe
  `text-smoke` no elige lo que hay debajo: la misma clase cae en el panel levantado, en la
  fila seleccionada, en el agua del catálogo compartido y en los cuatro tintes de peligro.
  Ahí estaba el punto ciego entero — una tinta pasa 4.5:1 sobre blanco y se queda corta sobre
  el papel donde de verdad cae, y nada lo dice. `--color-smoke` era ese caso: siendo `#667085`
  daba 4.9748:1 sobre blanco y 4.4894 sobre `--color-raised`; la paleta neutra lo dejó en
  `#6f6f6f`, mejor sobre todos los papeles, y aun así en 4.4093 sobre `--color-selected` y
  4.4084 sobre `--color-danger-soft-deep`.

  **El 8-sep-2026 el dueño lo zanjó: dos escalones más abajo, `#6d6d6d`.** Es el primer valor
  de la escala que pasa de 4.5:1 sobre los diez papeles —4.5404 y 4.5395 en esos dos—; `#6e6e6e`
  se queda en 4.4733 y no. Dos escalones de 255 son 0.006 de luminancia, por debajo de lo que
  el ojo resuelve, así que el color más escrito de la aplicación —257 `text-smoke` en el marcado
  y 51 reglas en las hojas— cruzó AA sin que la interfaz se moviera. La segunda lista de
  `contrast.test.ts`, la que cruza cada tinta con cada papel, se queda **vacía y midiéndose en
  cada ejecución**: vacía es su estado de trabajo, y es lo que cazará a la siguiente.

  Ninguno de los seis de arriba es un descuido: son la paleta de la casa, y subirlos de tono
  es un cambio de identidad visual que se decide mirando la pantalla. El gris de faena no era
  de esa familia —pasaba sobre blanco, que es justo por lo que nadie lo vio— y por eso se
  arregló en vez de anotarse. Lo que el test impide es que aparezca uno más sin que nadie se
  entere.

- **El rojo de que algo falló sí se arregló, y es `--color-fail`.** Vive en `theme.css`
  porque el marcado lo escribe como clase. Sustituye a tres rojos de fábrica de Tailwind
  que nadie había elegido —`text-red-400` 2.61:1, `text-red-500` 3.81:1, `text-red-600`
  4.30:1— y a los cuatro rojos de `tokens.css` que se usaban como texto, dos de los cuales
  tampoco llegaban. Mide 5.39:1 en el peor papel de la aplicación y 4.59:1 sobre su propio
  tinte al 10 %, que es el fondo de las pastillas de gravedad. `contrast.test.ts` lo
  comprueba papel a papel sobre todos los fondos sólidos de la aplicación. La lista de
  papeles vive allí y se recorre entera en cada ejecución, que es justo lo que una cifra
  escrita aquí no hace: el día que se escribió esto eran trece, y ya no.
- **Sin `prefers-contrast`.** `forced-colors.css` cubre el modo de alto contraste de
  Windows, que es donde la app se rompía de verdad; `prefers-contrast: more` —el ajuste
  suave, sin paleta forzada— sigue sin tocar nada. Es una decisión pendiente, no un olvido:
  significaría subir de tono los cinco tonos de la tabla de arriba —dos grises, dos
  ámbares y un verde—, y eso es un cambio visual.
- **En papel suben tres grises, y en pantalla no.** `print.css` lleva siete selectores a
  `--color-smoke` porque una impresora de chorro convierte 2.58:1 en nada, pero solo tres de
  los siete venían de `--color-faint`: `.eyebrow`, el pie de página y la pista del `.md`.
  Los otros cuatro ya se leían —resuelven a `--color-ink-faint-sheet` o a
  `--color-ink-muted-sheet`— y están ahí para que el grupo se imprima como UN gris en vez de
  tres, que es una decisión sobre la página y no sobre la legibilidad. En pantalla los
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
mil líneas y sustituir los literales de color no cambiaba nada. Aquí ponía 119 y no hay de
dónde sacar esa cifra: el commit que lo hizo (`900a4ed`) dice 6.032 líneas y 122 colores
escritos a mano, y 122 es también lo que dice la cabecera de `tokens.css`.
