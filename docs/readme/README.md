# Las imágenes del README

Siete ficheros que solo usa la portada del repositorio. Están aquí y no en
`apps/site/public/` porque no los sirve ninguna aplicación: los lee GitHub al pintar el
README, y nada más.

Lo que no se puede deducir mirándolos es de dónde salieron, así que va escrito: **de la
composición del vídeo de lanzamiento**, que vive fuera de este repositorio. Sin esta
página, rehacer un GIF significaría adivinar segundos sobre un MP4 de 70 s.

| fichero | qué es | de dónde sale |
| --- | --- | --- |
| `logo-light.png` · `logo-dark.png` | La marca, 240 px con alfa | `apps/site/public/assets/brand/panoma.svg` |
| `scan.gif` · `scan.es.gif` | El comando y las fichas, 900 px · 15 fps | `panoma-launch.mp4` y `panoma-launch-es.mp4` |
| `before-folders.jpg` | El escritorio de carpetas genéricas | `panoma-launch.mp4`, 8,55 s |
| `after-catalog.png` · `after-catalog.es.png` | El catálogo, sin nada encima | `media/shots/grid.png` y `shots-es/grid.png` |

## Por qué hay dos de casi todo

Un README lo lee una persona, así que sigue la regla de la casa: cada idioma enseña su
propia interfaz. El GIF castellano no es el inglés con otro pie —es otro render, con la
terminal contestando «proyectos: 23 · agentes: 5» y las pastillas diciendo «una cara, un
nombre, un pulso»—, y lo mismo la captura del catálogo. El escritorio de carpetas es el
único que sirve para los dos: se le recortó el subtítulo y ya no dice nada en ningún
idioma.

El logo también es dos, y esa pareja no es de idioma sino de tema: la marca es negra, y
sobre el fondo oscuro de GitHub un PNG negro desaparece. Se eligen con `<picture>` y
`prefers-color-scheme`, que es lo que GitHub entiende.

## Por qué el GIF salta del comando a las fichas

Se corta el plano del medio —la rejilla completa— a propósito, y merece la pena decir por
qué para que nadie lo «arregle» añadiéndolo.

El rótulo inglés de ese plano dice «Twenty-three projects. One page.» sobre una captura
que dice **22 projects** tres veces: en la cabecera, en la barra de la ruta y en el panel
izquierdo. Es un fallo conocido del vídeo, anotado en su propio `copy/catalog.ts`, y ahí
se queda porque el render inglés no se toca. Lo que no puede es viajar al README. Taparlo
tampoco valía: el rótulo se apoya sobre un degradado del propio panel, así que un
rectángulo negro encima se ve.

Las fichas no arrastran el fallo —no llevan ninguna cifra— y enseñan lo mismo que se
quiere enseñar: icono, nombre, salud. Y el catálogo entero sí está en el README, en
`after-catalog.png`, que es la captura cruda de la aplicación sin ningún rótulo encima.

Las cifras que sí salen en el GIF —23 proyectos, 5 agentes, 9 que nunca salieron del
disco— vienen de `counts.json`, que el vídeo cuenta sobre el disco de mentira al sacar las
capturas. No están tecleadas a mano en ningún sitio.

## Rehacerlos

Hace falta la composición del vídeo. Los segundos son de esos MP4 concretos: si se
rerenderiza el vídeo con otra voz, el reloj se mueve y hay que volver a buscarlos.

```bash
# El GIF inglés: comando (24,70–30,05) y fichas (34,05–37,75), con fundido entre ambos
ffmpeg -i panoma-launch.mp4 -filter_complex "\
[0:v]trim=24.7:30.05,setpts=PTS-STARTPTS[a];\
[0:v]trim=34.05:37.75,setpts=PTS-STARTPTS[b];\
[a][b]xfade=transition=fade:duration=0.35:offset=5.0,fade=t=out:st=8.30:d=0.40,\
fps=15,scale=900:-1:flags=lanczos,split[s0][s1];\
[s0]palettegen=max_colors=256:stats_mode=diff[p];\
[s1][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle" -loop 0 scan.gif
```

El castellano es el mismo montaje con otro reloj —la voz dura más— sobre
`panoma-launch-es.mp4`: comando 26,30–32,05 y fichas 36,35–40,15, con el fundido en 5,40 y
el cierre en 8,80.

El fundido final a negro no es decoración: un GIF vuelve al primer fotograma de golpe, y
el primero aquí es casi negro. Sin él, el bucle da un latigazo.

`before-folders.jpg` se recorta para quitarle el subtítulo quemado, y va en JPEG porque es
fotografía: en PNG pesaba 1,5 MB y en JPEG pesa 196 KB con el mismo tamaño.

```bash
ffmpeg -ss 8.55 -i panoma-launch.mp4 -frames:v 1 folders-full.png
magick folders-full.png -crop 1560x830+232+55 +repage -resize 1760x \
  -quality 88 -sampling-factor 4:2:0 -strip before-folders.jpg
```
