# Memoria de Panoma: implementado, auditoría y pendiente

Fecha: 6 de septiembre de 2026. Código revisado: `dbea289`.
[Informe canónico en inglés, con referencias técnicas completas](../docs/memory-audit-2026-09-06.md).
Esta lectura en español resume los hallazgos y desarrolla su significado para el producto.
Los defectos reproducidos quedaron corregidos en el mismo cambio que añadió este informe. Un segundo
cambio, el mismo día, quitó cuatro puntos más de la lista pendiente: la entrega por las palabras de
una tarea, la resolución y la navegación del archivo de decisiones, el estado «no verificado» de los
centinelas, y la exportación portable. Un tercero quitó tres más: una fecha de caducidad que
mantiene fuera del contexto de un agente una decisión que ya no se aplica, una sola llamada de
destilación más ancha en vez de varias, y un formulario que pide una dimensión cada vez. La
arquitectura propuesta sigue siendo una dirección: no todas sus capacidades están implementadas.

## Estado actual

**Los defectos reproducidos están corregidos, pero no está implementada toda la arquitectura
propuesta.** Este documento reúne el diagnóstico inicial, las correcciones posteriores y el
diseño futuro. Los hallazgos históricos describen el código `dbea289`, anterior a las correcciones.

| Fase | Estado en el repositorio | Qué falta |
| --- | --- | --- |
| 1. Integridad | Implementada para los fallos reproducidos F1–F7 | Ninguno de esos siete casos sigue abierto. Las propuestas más amplias se indican aparte. |
| 2. Recuperación y entrega | Parcial: consulta por archivos, selección por las palabras de una tarea con esas palabras como motivo, una caducidad puesta por el dueño que retiene lo que ya no se aplica, fragmentos pertinentes y lectura completa del original | Ordenar además por la operación y el error observado, reconstruir qué valía en una fecha pasada, y la relevancia entre todos los tipos de memoria. |
| 3. Mantenimiento | Parcial: extracción persistente con una ventana que lleva una sesión larga entera en una sola llamada de pago, reintentos, cobertura visible, revisión de anclas con un estado explícito de «no verificado», caducidad puesta por el dueño e integridad de decisiones | Comprobaciones del comportamiento del código, vigencia que decida una máquina, procedimientos estructurados y consolidación revisable. Extraer contra un catálogo remoto y el recorrido por trozos quedan aplazados a propósito. |
| 4. Experiencia de producto | Parcial: pestaña Memoria del proyecto, reglas por archivo, límites, estado de extracción, un formulario que pide una dimensión cada vez, y un archivo de decisiones que se busca, se pagina, dice a dónde llega cada registro y ofrece salida a un conflicto heredado | Una vista común de notas, decisiones, procedimientos y evidencia con filtros por tarea y fuente. |
| 5. Evaluación de resultados | Pendiente; sí están las pruebas de regresión y la separación de experimentos | Casos propios reservados para evaluación, una referencia inicial y medición de resultados reales de tareas. |
| App instalada | Sin actualizar | Empaquetar e instalar los cambios probados; la app instalada sigue usando el paquete anterior. |

Siguen pendientes las relaciones comunes entre recuerdos y el contrato de borrado de datos
derivados. La exportación portable versionada ya existe desde el segundo cambio —`panoma memory
export <proyecto>` escribe en un solo JSON las notas, las decisiones con sus enlaces de revisión
y los recibos de extracción de un proyecto—, pero nada la vuelve a leer: la portabilidad está
construida a medias, y a propósito. Guardar todo localmente, proyectar Markdown o enlazar
revisiones de decisiones no completa esas propuestas. La búsqueda semántica de todo el archivo
queda condicionada a que la evaluación demuestre su necesidad.

Las pruebas aprobadas comprueban las correcciones implementadas. No demuestran que exista
toda la arquitectura propuesta ni que la memoria mejore los resultados de las tareas.

La siguiente entrega propuesta está registrada en
[Futuras implementaciones: requisitos, verificación y memoria](#futuras-implementaciones-requisitos-verificación-y-memoria).
Amplía el trabajo pendiente de mantenimiento, experiencia de producto y evaluación.

Panoma tiene una buena base de memoria. Ya distingue eventos, notas aprobadas, decisiones
del propietario e inferencias sobre sus preferencias. La auditoría inicial encontró fallos
de integridad, vigencia y entrega. Las correcciones resuelven los casos reproducidos; sigue
pendiente ampliar cómo se verifica y recupera el conocimiento.

La meta debería ser esta: que un agente nuevo pueda retomar un proyecto, entender por qué
se tomó una decisión, reconocer sus excepciones y evitar un fallo conocido sin hacer que
tengas que volver a explicarlo.

## Correcciones y revisión de la memoria de proyectos

Tras aclarar que la prioridad era la memoria de cada proyecto, se corrigieron los fallos
reproducidos y se revisó su flujo completo:

- La ficha tiene una pestaña **Memoria** propia. Distingue reglas generales y reglas por
  archivo, muestra sus límites y permite escribir ambas. Aprobar otra nota conserva el borrador.
- La aprobación comprueba el proyecto y guarda la nota junto con sus nuevas comprobaciones.
  Los límites resisten escrituras simultáneas. Una comprobación antigua no invalida un sí reciente.
- El contexto y las consultas de memoria revisan los archivos vigilados antes de entregar
  reglas. Todos los clientes MCP pueden pedir las reglas aplicables a rutas concretas.
- La búsqueda devuelve el fragmento que contiene la coincidencia y permite recuperar el
  registro original completo, por partes y dentro del proyecto correspondiente.
- El aprendizaje de sesiones tiene una cola persistente, reintentos limitados y estados
  visibles. Prioriza el final de la sesión e informa cuántos registros incluyó u omitió.
- Las revisiones de decisiones de Twin mantienen una sola versión activa. Las condiciones
  incompletas no se presentan como reglas completas y los objetivos no desplazan las decisiones.
- La medición separa las entregas ordinarias de las inscritas en un experimento.

Las migraciones conservan las memorias existentes. No se programan automáticamente sesiones
antiguas para analizarlas con un modelo. Las pruebas visuales usan un catálogo temporal con
datos sintéticos y no modifican las memorias del catálogo instalado.

Quedan límites explícitos: comprobar que existe un archivo no demuestra que una afirmación
sobre él siga siendo cierta; sin un hook, el agente debe pedir las rutas pertinentes; y
entregar una regla no demuestra que el agente la obedeció. La búsqueda semántica de todo el
archivo y la memoria de procedimientos siguen siendo propuestas, no funciones terminadas.

Validación final: compilación de paquetes, linter, tipos y suite completa aprobados.
Pasaron 220 archivos de pruebas, con 2821 pruebas en total. La verificación visual se hizo
en el catálogo temporal; la app instalada sigue usando su paquete anterior.

## Segundo repaso: cuatro puntos menos en la lista

Ese mismo día, después de escribir el informe anterior, se construyeron cuatro de los puntos
pendientes. Se nombran aquí para que lo de abajo se lea como historia y esto como presente.

| Punto | Qué existe ahora | Qué no afirma |
| --- | --- | --- |
| Entrega por tarea | `panoma_context` acepta `task`: una frase de 1.000 caracteres como mucho. Sus palabras —sin tildes, sin palabras vacías— se comparan con las notas dormidas aprobadas del proyecto, cuerpo y disparador, y con las decisiones activas del dueño que el informe por recencia no llevaba; ordena por lo rara que es cada palabra compartida. Ocho notas y cuatro decisiones como mucho, 4.000 caracteres entre todas, cada una con las palabras que coincidieron y, al final, cuántas quedaron fuera. | Es literal: encuentra la palabra escrita, no la idea. Una coincidencia es un motivo para leer la regla, y el informe lo dice en cada entrega. No ordena por la operación, ni por el archivo que se edita, ni por una fecha. |
| El archivo de decisiones | Las familias con dos versiones vivas se listan arriba de la pantalla de memoria, con lo que cuesta retenerlas, y un clic conserva una y descarta las rivales por la ruta de siempre. Cada fila nombra la otra versión viva de su familia, sea cual sea su estado, y cada ficha dice a dónde llega ese registro: al informe y al laboratorio, solo al laboratorio, a ninguna parte, o retenido. El archivo responde a una búsqueda por los campos guardados y pagina hacia atrás. | El alcance dice que un registro es elegible, no que cupo: el tope de seis decisiones y 1.500 caracteres puede recortarlo. La búsqueda es literal. Ya nada crea una familia en conflicto: la lista está vacía en un catálogo que nunca tuvo una. |
| Lo que no se puede comprobar | Si la raíz del proyecto no es una carpeta en la máquina que sirve, la ronda devuelve cuántas notas quedan sin verificar y por qué, en vez de impugnarlas todas, y el informe al agente lo dice en una línea. Era un fallo vivo también en local: un volumen desmontado impugnaba de golpe la memoria entera de un proyecto. | Que un ancla aguante demuestra que el archivo existe, no que la frase sobre él siga siendo cierta. La extracción de pago contra un catálogo remoto se construyó y se volvió a apagar en el tercer cambio; el motivo y las tres guardas están en `docs/open-questions.md`. El vigilante sigue apagado allí también. |
| Exportación portable | `panoma memory export <proyecto>` y `GET /api/memory/export` escriben en un solo JSON versionado las notas en todos sus estados, las decisiones con sus enlaces de revisión y su marca de evidencia, las decisiones generales del dueño y los recibos del destilador, nunca la reserva de un trabajo. Pide la clave de operador, como el resto del testimonio del dueño. | Nada lo vuelve a leer, y el borrado sigue sin contrato para los datos derivados. La mitad de la portabilidad, dicho en voz alta en vez de dejarlo suponer. |

Las pruebas de esos cuatro puntos entraron en el mismo cambio: la selección y sus topes, la
búsqueda y la paginación, el estado desconocido de la ronda con y sin catálogo remoto, y que la
exportación no entregue la reserva de un trabajo. Después de todo ello volvieron a pasar la
compilación, el linter, los tipos y la suite entera: 226 archivos de pruebas, y pruebas: 2.880.

## Tercer repaso: lo que cuesta un recuerdo que ya no vale

El dueño leyó la lista pendiente y la contestó punto por punto. Tres de sus respuestas se
construyeron ese mismo día; dos se anotaron, que también es una respuesta.

**Una decisión puede decir hasta qué día se aplica, y pasado ese día no la entrega nadie.** El
dueño pone una fecha opcional en cualquier decisión. Pasada, el registro deja de llegar al
informe de los agentes, a las palabras de una tarea y a la evidencia del laboratorio, y se queda
en el archivo del dueño marcado como caducado, con la opción de quitarle la fecha. La auditoría
proponía dos salidas: retener el registro caducado o entregarlo con un aviso. El dueño eligió
retenerlo, y su razón es la que decide casi toda esta página: una regla que ya no vale no es un
error pequeño, es contexto que el agente ha pagado y con el que ahora tiene que discutir. Nada
caduca solo. La fecha se guarda como ese día natural a las 23:59:59.999 UTC, y es una columna y
no un campo del testimonio, porque la identidad de un episodio es el hash de sus campos y una
fecha ahí le daría identidad nueva a un registro que nadie reescribió.

**Una sesión larga viaja en una llamada, no en seis.** La ventana pasó de cincuenta actividades a
cien, y el sobre de 24.000 caracteres a 36.000, con una sola llamada de pago por sesión cerrada.
Lo que había sobre la mesa era recorrerla por trozos, una llamada cada uno. Seis llamadas sobre
una sesión de trescientos registros pagan seis veces el coste fijo —el prompt entero y el bloque
de 4.000 caracteres de memoria existente— y se llevan seis de las doce extracciones de pago del
día: medio día en una sola sesión. Lo que sigue sin cubrirse está escrito donde están las cifras:
una sesión que pase del sobre pierde sus registros más viejos, y el recibo lo dice.

**El formulario pide una dimensión cada vez.** Los siete campos opcionales se abrían juntos tras
un solo desplegable, que es justo por lo que la auditoría original llamó largo al formulario.
Ahora cada uno se añade cuando se pide, y el que ya tiene texto está siempre abierto, así que una
revisión sigue llegando completa.

**Dos respuestas fueron anotar en vez de construir.** La extracción de pago contra un catálogo
remoto se construyó en el segundo cambio y aquí se volvió a apagar: no la frena nada técnico,
pero la pagaría la clave del servidor para todos los proyectos y hoy panoma es local. Y la quinta
fase, medir si la memoria mejora una tarea, es un protocolo con sus propias semanas. Las dos son
ahora entradas de `docs/open-questions.md`, con quién las decide y, la primera, con las tres
guardas que la vuelven a encender.

Lo que este cambio no añade: no ordena por la operación que el agente está haciendo, no
reconstruye qué valía en una fecha pasada, y no comprueba solo que una regla siga cuadrando con
el código. La caducidad es una fecha que escribe el dueño, y su honestidad es del dueño.

## Auditoría inicial: qué comprobé antes de corregir

Esta sección y los hallazgos históricos siguientes corresponden a `dbea289`. El recuento
de pruebas y las referencias originales describen ese momento; las correcciones y la
validación posteriores están documentadas arriba.

Revisé notas, episodios, extracción de historial, retrato, vigilancia de archivos, contexto
para agentes, búsqueda y medición. Leí las decisiones documentadas antes de juzgar los
comportamientos que parecían incompletos.

La app instalada en el puerto 4173 es anterior al código de este repositorio. Para revisar
la interfaz actual levanté un catálogo temporal separado en el puerto 4175. Allí guardé una
decisión de prueba, abrí sus razones y excepciones y la recuperé desde el laboratorio.
No importé tus conversaciones ni realicé llamadas a modelos.

Las reproducciones técnicas utilizaron bases de datos en memoria o temporales. Confirman
que los fallos son posibles; no demuestran que ya hayan ocurrido en tus datos.

En la auditoría inicial pasaron la compilación de paquetes, lint, tipos y la suite existente.
Pruebas aprobadas entonces: 2.716; archivos: 212. Las comprobaciones adicionales descubrieron
casos que esa suite no cubría. En aquella primera fase solo se auditó; después sí se modificó
el código funcional y se añadieron pruebas. El recuento final es de 2821 pruebas aprobadas.

## Fallos originales F1–F7: casos reproducidos ya corregidos

Los siete casos de esta tabla están corregidos y cubiertos por pruebas de regresión.
Se conserva la descripción de cómo fallaban antes. Las recomendaciones más amplias, como
ordenar por relevancia para una tarea, no se consideran implementadas por corregir esos casos.

| Prioridad | Hallazgo | Consecuencia |
| --- | --- | --- |
| Alta | Una cadena A → B → C permite restaurar A y dejar activas A y C | Una decisión corregida vuelve a competir con su corrección |
| Alta | Dos escrituras simultáneas superan los límites de notas | El sistema deja de garantizar el presupuesto que promete |
| Alta | Reaprobar una nota puede conservar su ancla inválida | La siguiente revisión vuelve a impugnarla inmediatamente |
| Media | El identificador de una nota y el proyecto enviado no se comprueban juntos | Una nota puede anclarse contra los archivos de otro proyecto |
| Media | Objetivos nuevos desplazan decisiones vigentes antes de filtrar qué sirve | La decisión sigue guardada, pero desaparece del contexto |
| Media | Los disparadores rechazan paréntesis y corchetes | No se pueden asociar notas a muchas rutas reales de esta app |
| Media | La búsqueda encuentra una frase que el formateador recorta después | El agente recibe un resultado sin la evidencia buscada y sin acceso al original |

Los números de las carreras fueron concretos: desde un uso de 1.960 caracteres, dos notas
simultáneas de 30 terminaron en 2.020 sobre un máximo de 2.000. La cola de propuestas llegó
a 21 sobre 20 y las notas dormidas a 31 sobre 30. No basta con comprobar el límite antes de
escribir: hay que proteger ambas cosas como una sola operación.

En decisiones, el problema aparece porque se comprueba solo si hay una revisión directa
activa. Hace falta una identidad para toda la familia y una única versión vigente protegida
en almacenamiento. La historia puede conservar todas las versiones; el presente debe ser
inequívoco.

La pérdida por acumulación también se reprodujo: una decisión válida se entregaba; después
de añadir 50 objetivos sin decisión, dejaron de entregarse decisiones. El límite se aplica
antes de comprobar qué registros cumplen las condiciones. El informe canónico enlaza los
archivos y las líneas de cada hallazgo.

## Debilidades originales y su estado actual

Los párrafos siguientes conservan el diagnóstico anterior a las correcciones. Su estado actual:

- Vigencia: las consultas ya revisan las anclas, y una raíz que la máquina que sirve no ve se
  informa como «no verificada» en vez de leerse como un ancla caída; falta comprobar el
  significado de las reglas.
- Memoria dormida: ya existe consulta por archivos y por las palabras de una tarea, para
  cualquier cliente; falta ordenar por la operación en sí, y la cobertura automática de los
  hooks sigue limitada.
- Extracción: se priorizan actividades recientes y resoluciones finales, mostrando cobertura, y
  la ventana ya lleva una sesión larga entera en una sola llamada de pago; una sesión que pase
  de ese sobre sigue perdiendo sus registros más viejos, y el recibo dice cuántos.
- Recuperación: ya existen tareas persistentes, reservas de ejecución y reintentos limitados.
- Medición: ya se separa la pertenencia a experimentos; falta medir el beneficio en tareas.
- Recibos de entrega: cada coincidencia por tarea llega al agente con las palabras que la
  eligieron y con cuántas quedaron fuera, y cada ficha de decisión dice a dónde llega ese
  registro. El registro de entregas sigue guardando solo las notas despiertas, así que el
  recibo de *por qué* se entregó algo está en el informe al agente, no en la base.

**La vigencia está insuficientemente comprobada.** El vigilante no observa recursivamente
todos los archivos a los que puede referirse una nota. Además, que un archivo exista no
demuestra que siga conteniendo el comportamiento que justificaba la regla. La memoria
necesita distinguir «aprobada por ti» de «verificada contra el proyecto actual».

**La memoria dormida no llega de la misma forma a todos los agentes.** Depende de un hook
concreto y de ciertas herramientas de edición. Un agente que trabaja por otra vía puede
tener memoria guardada que nunca recibe. La solución es una consulta común por tarea y
archivos, accesible mediante MCP; el hook seguiría siendo una comodidad automática.

**La extracción puede perder cómo terminó la sesión.** Se toman las primeras actividades y
fragmentos iniciales de sus detalles. Si la corrección definitiva aparece al final, el
destilador puede ver el intento fallido y perder la resolución. Debe registrar qué partes
procesó y conservar las correcciones finales, mediante bloques acotados.

**El trabajo automático no tiene recuperación durable.** Si falla la extracción de una
sesión, falta una tarea persistente que permita ver qué quedó pendiente y reintentarlo.
Una cola local con estados y claves idempotentes permitiría continuar después de una caída
sin demorar el trabajo del agente.

**La medición actual no prueba que la memoria reduzca errores.** Se mezclan entregas normales
y experimentales sin identificar su pertenencia, y se usan lanzamientos posteriores como
aproximación a correcciones. Hay que separar lo disponible, lo entregado, lo consultado y
lo que realmente ayudó. Recuperar una nota muchas veces no la convierte en correcta.

No considero fallos por sí mismos la aprobación humana, la búsqueda literal, el presupuesto
pequeño o la ausencia de compresión automática: son decisiones explícitas y defendibles.
También está documentado el límite de cobertura de los hooks; ampliarlo es una decisión de
producto que esta propuesta justifica.

## Modelo objetivo: todavía no implementado por completo

Esta sección describe el diseño futuro. La tabla de estado distingue las partes ya
implementadas; el contrato completo que sigue todavía no es una garantía del producto.

Cada recuerdo debería poder responder seis preguntas: **de dónde salió, quién lo autorizó,
dónde aplica, qué lo invalidaría, cuál es su revisión vigente y por qué se mostró ahora**.

Mantendría cinco capas, con una lectura común para la persona y el agente:

| Capa | Qué conserva | Cuándo aparece |
| --- | --- | --- |
| Reglas estables | Pocas restricciones aprobadas del proyecto | Al comenzar una tarea |
| Estado de trabajo | Objetivo, punto de reanudación, dudas y siguiente acción | Durante esa tarea; se cierra con ella |
| Decisiones | Elección, razones, alternativas, resultado y excepciones | Cuando la tarea o una consulta histórica las necesita |
| Procedimientos | Condiciones previas, pasos, comprobación y fallos conocidos | Al realizar una operación relacionada |
| Evidencia | Entradas originales y fuentes permitidas | Bajo demanda, con fragmento pertinente e identificador estable |

No hace falta destruir las tablas actuales para conseguirlo. Primero añadiría una
representación común de lectura que conserve los tipos y la autoridad de cada fuente.

**Separaría autoridad y verdad.** Tú puedes definir una preferencia. Una afirmación sobre
el código requiere evidencia técnica. La frecuencia de una frase, la confianza del modelo
y tu aprobación son datos distintos; no deberían esconderse en una puntuación única.

**Separaría tres momentos.** Cuándo se registró, cuándo aplicaba y cuándo se comprobó por
última vez. Un recuerdo poco consultado puede seguir siendo correcto. Uno recién guardado
puede describir un entorno antiguo. Una pregunta sobre el pasado debe poder recuperar lo
que era válido entonces.

**Daría condiciones verificables a las reglas que las admitan.** Por ejemplo, el valor de
un script del manifiesto, una dependencia entre paquetes o una exportación concreta. Las
comprobaciones deben ser pequeñas y limitadas; no comandos arbitrarios ejecutados desde un
recuerdo. Un cambio en el archivo dispara una revisión, pero no demuestra automáticamente
que toda la regla sea falsa. Cuando no se pueda comprobar algo, la respuesta debe ser
«desconocido». Las preferencias personales pueden no tener una comprobación mecánica.

**Conservaría relaciones explícitas.** Esta decisión sustituye a aquella; esta regla tiene
esta excepción; esta evidencia sostiene esta afirmación; este resultado vino de esta
acción. Las relaciones sugeridas por similitud deben diferenciarse de las confirmadas.
Un grafo visual puede llegar después: primero debe servir para abrir la fuente y entender
la cadena. Repetir la misma fuente no cuenta como corroboración independiente.

**Recuperaría por lo que se va a hacer.** La consulta incluiría tarea, operación, archivos,
error observado y, si hace falta, fecha histórica. Primero se filtran ámbito, autoridad,
vigencia y revisión; después se ordena la relevancia y se ajusta al presupuesto. Una regla
general y su excepción local deben evaluarse juntas. Si no cabe la condición completa,
hay que indicar que la evidencia está incompleta y permitir abrirla.

**Permitiría reemplazos revisables y atómicos.** En lugar de obligarte a descartar varias
notas y escribir otra desde cero, mostraría el antes y el después. Tú apruebas ese resultado
concreto y se reemplaza el conjunto en una transacción, conservando fuentes e historia.
Esto reabre la decisión actual de no editar, pero mantiene la razón que la protege: nada
aprobado se reescribe silenciosamente.

**Mantendría la memoria portable.** Exportación local versionada de registros, relaciones
y procedencia; índices reconstruibles; vistas Markdown legibles. Revocar una fuente y
borrar sus datos son operaciones distintas. El borrado debe revisar derivados, índices y
cachés; la conservación de una decisión escrita independientemente por ti requiere una
política explícita. Es una propuesta de contrato, no una garantía que ya exista.

**Mostraría el motivo de cada entrega.** «Esto aparece porque vas a modificar este paquete;
procede de esta decisión; se verificó contra esta configuración». La memoria debe poder
explicar también por qué dejó de entregar una regla. Las entregas se registran localmente,
sin convertir un contador de lecturas en evidencia de utilidad.

## Ejemplo propuesto: todavía no es un flujo implementado

Un agente cambia una biblioteca compartida y va a ejecutar pruebas de un paquete que la
consume. Panoma detecta esa relación y recupera la decisión que explica por qué probar
contra una compilación antigua dio un resultado engañoso. Muestra la comprobación del
consumidor actual y la excepción para quienes importan el código fuente directamente.

Más adelante se cambia ese consumidor para importar fuentes. El incidente original sigue
en la historia, pero el requisito del procedimiento deja de cumplirse. Panoma deja de dar
ese consejo en esa tarea y puede explicar la razón. Si no puede leer la configuración,
declara la incertidumbre.

Eso es conocimiento mantenido: conserva por qué existió una regla y sabe cuándo dejar de
aplicarla. Esta propuesta está diseñada para Panoma; no es una afirmación de novedad
científica ni procede de copiar una implementación.

## Qué aprendí de la investigación

Estudié código y documentación públicos para contrastar patrones. No se incorporó código
ajeno ni nombres de productos externos. La documentación pública de una aplicación no se
presentó como si fuera acceso a su implementación completa.

La investigación reciente aporta tres criterios útiles. Hay evaluaciones que distinguen
hechos, cambios de estado, procedimientos, fallos recurrentes y premisas equivocadas; ese
es un mejor examen que preguntar únicamente si se recuerda una frase.
[Evaluación de experiencia de agentes, mayo de 2026](https://arxiv.org/abs/2605.12493).

También se distinguen conflictos temporales, fácticos y condicionales: lo más reciente no
siempre es correcto y dos preferencias pueden coexistir si aplican en situaciones distintas.
[Evaluación de memoria con conflictos, mayo de 2026](https://arxiv.org/abs/2605.20926).

Los procedimientos pueden ayudar, pero algunos pierden eficacia al trasladarlos a otros
contextos. Por eso una solución que funcionó una vez necesita condiciones y pruebas de
transferencia antes de convertirse en regla general.
[Memoria procedural y transferencia, junio de 2026](https://arxiv.org/abs/2606.23127).

Son estudios recientes con sus propios entornos y limitaciones. Sirven para diseñar
preguntas y pruebas; no justifican prometer una mejora porcentual para esta app.

## Interfaz propuesta y observaciones de la auditoría inicial

Una entrada principal llamada Memoria, con filtros por proyecto y tarea. Desde allí:
conocimiento vigente, decisiones, procedimientos, elementos por revisar y evidencia.
Cada recuerdo tendría su procedencia, ámbito, revisión, comprobación y canales de entrega.

Ya existe una pestaña Memoria en la ficha del proyecto; las decisiones siguen en Twin.
Los contadores de Twin ya incluyen decisiones y distinguen un retrato vacío de una memoria
vacía. El archivo ya se busca y se pagina, cada ficha dice a dónde llega, y el formulario pide
una dimensión cada vez. Sigue pendiente la vista común con filtros por tarea y fuente.

El recorrido siguiente describe la interfaz anterior a esas correcciones. El mensaje
incorrecto del primer punto ya está resuelto; el formulario y la navegación del archivo
siguen siendo posibles mejoras:

1. **Entrar en Twin: estado mixto.** La navegación es visible, pero el mensaje de memoria
   vacía se basa solo en creencias y permanece después de guardar una decisión.
2. **Registrar: funciona.** Basta un objetivo o decisión y el guardado es local. Desplegar
   de golpe los campos adicionales producía un formulario largo; en el tercer repaso cada campo
   se añade cuando se pide.
3. **Inspeccionar: funciona, con límites.** Conserva razones, condiciones y excepciones,
   y señala lo desconocido. Faltaban búsqueda y navegación para recuperar episodios antiguos
   desde la propia sección; mostraba los recientes, hasta 100, y los abiertos directamente.
   Ambas se construyeron en el segundo repaso.
4. **Recuperar en el laboratorio: funciona para el caso probado.** Muestra la evidencia
   antes del modelo. No ejecuté el ensayo de pago ni evalué exhaustivamente paráfrasis o idiomas.

Las capturas verificadas viajan junto al informe canónico, en `docs/memory-audit-2026-09-06/`;
el resto del material —las sondas, sus salidas y las capturas descartadas— sigue en
`.panoma/shots/memory-audit-2026-09-06/`, que es el buzón del producto y no se versiona. El texto pequeño y tenue presenta un riesgo de
legibilidad ya documentado en el proyecto. Se observaron etiquetas y controles en el árbol
de accesibilidad; esto no equivale a una auditoría completa de teclado, lector de pantalla,
móvil o cumplimiento WCAG.

## Futuras implementaciones: requisitos, verificación y memoria

**Estado: pendiente.** Esta sección registra trabajo futuro; no marca estas capacidades
como implementadas ni activa decisiones autónomas. La primera entrega será una tarea
completa cuyos criterios de aceptación, cambio comprobado, resultados observados y memoria
de apoyo puedan consultarse juntos.

La cadena que debe conservarse es: requisito → versión del código → comprobación ejecutada
→ resultado observado y artefactos → regla o decisión vinculada. Se reutilizarán los
registros existentes de tareas, ejecuciones y compilación cuando sus contratos encajen,
sin crear una historia paralela.
La marca de verificación actual de una ejecución describe sus pruebas, no el cumplimiento
de todos los requisitos de la tarea.

| Orden | Entrega | Criterios de aceptación |
| --- | --- | --- |
| 1 | Separar finalización declarada y criterios verificados | Una tarea conserva el informe del agente sin atribuirle verificación. Cada criterio indica aprobado, fallido o sin verificar, con evidencia y cobertura omitida. Las comprobaciones se vinculan a la versión de la app y de las pruebas; se identifican los cambios sin commit. Una evidencia de otra versión no valida silenciosamente el cambio actual. |
| 2 | Vincular reglas y decisiones con evidencia observada | Un recuerdo permite abrir la comprobación que lo sostiene, el proyecto y la versión aplicables y sus condiciones. Aprobación del propietario y vigencia técnica permanecen separadas. Un cambio pertinente provoca una revisión; una evidencia ilegible sigue siendo desconocida. La evidencia anterior se conserva como historia. |
| 3 | Convertir decisiones arquitectónicas seleccionadas en comprobaciones | Un conjunto acotado de decisiones verificables tiene controles explícitos, por ejemplo límites entre paquetes o reglas de autorización. Cada control acepta un caso válido y detecta otro deliberadamente incorrecto. Las decisiones que requieren juicio siguen identificadas como tales. |
| 4 | Evaluar antes de ampliar la autoridad delegada | Casos aislados miden por separado resultados de tareas, vigencia de la memoria, excepciones, abstención e intervención del propietario. Después se podrán considerar respuestas acotadas por decisiones explícitas, con ámbito, fuentes y abstención. Ampliar la autoridad del agente sigue siendo una decisión de producto separada. |

**Contrato de evidencia.** Cada comprobación registra ejecutor, comando o identificador,
entorno, momento, resultado y artefactos locales, con límites y salidas recortadas. Debe
distinguirse el origen de cada dato: afirmación del agente, informe importado o resultado
capturado por el ejecutor. Una captura, una traza, un comando exitoso o un commit solo
respaldan el comportamiento que realmente comprueban. Los resultados importados conservan
su procedencia y no se presentan como ejecuciones locales verificadas independientemente.
Un recorrido de navegador necesita comprobar el estado final pertinente, además de
registrar las pantallas visitadas.

**Contrato de memoria.** Los criterios y las evidencias se enlazan con recuerdos existentes
mediante identificadores estables. El ámbito y la revisión de cada enlace pueden consultarse.
Una comprobación exitosa no convierte automáticamente la interpretación del agente en una
regla aprobada, y recuperar una decisión anterior no concede permiso para una acción nueva.

**Contrato de evaluación.** Se partirá de los casos originales descritos abajo, separando los
resultados esperados del material usado para ajustar el sistema. Se comparará con una
referencia fija y la misma configuración del agente lector, repitiendo intentos cuando
importe la variación del modelo. Los casos incluyen memoria irrelevante, evidencia obsoleta,
excepciones locales, conclusiones sin apoyo y abstención correcta. Se medirán resultados,
errores repetidos, intervenciones del propietario, latencia y consumo conocido; un coste
desconocido seguirá indicado como desconocido. Coincidir con el propietario y acertar
técnicamente son medidas distintas. Los fallos del proveedor y las respuestas inutilizables
se contarán por separado de una abstención deliberada. Un porcentaje global de coincidencia
no basta para autorizar más delegación. La evaluación permanece aislada del trabajo ordinario
y de sus controles necesarios.

**Aceptación de la primera entrega.** Al abrir una tarea terminada, el propietario puede ver
qué se pidió, qué cambio se comprobó, qué pasó las comprobaciones, qué sigue sin verificar
y qué memoria queda respaldada. Si cambia el código pertinente, el resultado anterior sigue
disponible, pero deja de presentarse como verificación actual. Este recorrido será la primera
implementación antes de extender el modelo a todas las tareas y superficies de memoria.

## Fases: estado y trabajo restante

| Fase | Estado | Trabajo restante |
| --- | --- | --- |
| 1. Integridad | Implementada para F1–F7 | Las regresiones cubren los siete casos reproducidos. |
| 2. Recuperación y entrega | Parcial | Ordenar por la operación y el error, y reconstruir qué valía en una fecha pasada. La consulta por archivos, la consulta por tarea y la caducidad ya existen. |
| 3. Mantenimiento | Parcial | Comprobaciones técnicas del significado y vigencia que decida una máquina, procedimientos y consolidación atómica revisable. Las tareas persistentes, la ventana ancha, el estado desconocido y la caducidad ya existen. |
| 4. Producto | Parcial | Vista común, filtros y relaciones. El archivo con búsqueda, la resolución de conflictos, el alcance por registro y la exportación portable ya existen. |
| 5. Evaluación | Pendiente | Comparar recuperación de evidencia y resultados de tareas con casos reservados para evaluación. |

Actualizar la app instalada es un paso separado de esas fases: permite usar las correcciones
ya probadas, pero no añade las capacidades que aquí siguen pendientes.

Prepararía un conjunto original de casos: 24–40. Incluiría cambios de comando sin borrar
archivos, revisiones encadenadas, excepciones locales, preguntas históricas, ramas con
requisitos diferentes, paráfrasis bilingües, correcciones al final de una sesión y borrado
de fuentes con derivados. Se repetirían al incorporar conocimiento nuevo.

Mediría por separado evidencia recuperada, validez, conservación de excepciones, abstención
correcta, resultado de la tarea, repetición de correcciones, latencia y tamaño de contexto.
La búsqueda semántica local quedaría condicionada a demostrar una carencia que la búsqueda
textual y las relaciones explícitas no resuelvan.

La inversión más útil ahora es conseguir que lo que Panoma recuerda sea coherente, vigente
y utilizable. Esa es la base que permitiría ampliar la memoria con confianza.
