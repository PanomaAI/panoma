# Marca

**La fuente de verdad es el SVG**, no un PNG:
`apps/web/public/assets/brand/panoma.svg`.

Un monograma de **P** con una ventana panorámica curvada recortada en el contrapunzón.
Lee a la vez como *vista amplia* (panorama, de donde viene el nombre) y como *rejilla de
baldosas* (la propia tienda de apps del producto).

## Ficheros

| Fichero | Para qué |
|---|---|
| `apps/web/public/assets/brand/panoma.svg` | marca ajustada, sin margen — uso en línea |
| `apps/web/components/brand-icons.ts` | el trazado en línea, para heredar `currentColor` |
| `apps/web/app/icon.png`, `apple-icon.png` | rasterizados **desde el SVG**, no reducidos del PNG |

Esta tabla prometía además `panoma-icon.svg` y `brand.tsx`, y los dos se borraron hace
tiempo. Lo que hace su trabajo hoy es `brand-icons.ts`. Un README que nombra ficheros que
no existen es peor que uno corto: manda a buscar.

El trazado usa `fill-rule="evenodd"` con tres niveles: contorno de la P (relleno),
contorno del cristal (hueco) y los seis paneles (relleno). Por eso los canales son
transparentes y el logo se invierte solo sobre fondo oscuro, sin mantener dos versiones.

## Qué se corrigió al vectorizar

La geometría se midió sobre `p.png` original, con dos cambios deliberados:

- **Fuera la cola blanca inferior.** Bajaba del cristal hacia el asta y no significaba
  nada: ni ventana, ni rejilla. Ensuciaba el contorno del contrapunzón.
- **Canales de 24 → 32 unidades.** Por debajo de 32px se cerraban y la ventana se volvía
  una mancha clara.

La perspectiva sí se conservó, porque es el carácter del dibujo: el borde superior del
cristal es casi plano y el inferior sube hacia la derecha, así que la fila de abajo se
comprime (116 → 89 → 63 unidades de alto). Un primer intento sin ese detalle salió plano
y parecía una rejilla cualquiera.

## Iteraciones descartadas

Se guardan porque el motivo del descarte es más útil que el archivo.

- `panoma.png` — P con un **ojo**. Bien construida, pero un ojo significa vigilancia, y la
  promesa del producto es la contraria: el código nunca sale de tu disco.
- `panoma-a.png` — abanico radial. Sin relación con la letra ni con el nombre, y con dos
  lecturas accidentales fuertes: Pokéball y símbolo de radiación.
- `rejected-1.png`, `rejected-2.png` — trama de semitono. Los puntos se promedian al
  reducir: la tinta caía del 18 % al 10,8 % y 9,1 %, y de 16 a 32px la letra salía **gris**
  en vez de negra. La 2, sin contorno, ni siquiera conservaba silueta.
- `rejected-3.png` — sólida con seis paneles de color. Dos problemas: paneles de ventana
  multicolor *es* la gestalt del logo de Windows, y a una sola tinta los seis colores
  colapsan a negro y la ventana desaparece.

Si algún día se quiere color, con **uno** basta: el morado de acento de la interfaz
(`#6d4aff`). Sale del territorio de Windows y sobrevive a la tinta única.

## Pendiente

Variante simplificada 2×2 para 16-24px, donde la rejilla de 3×2 aún se cierra.
