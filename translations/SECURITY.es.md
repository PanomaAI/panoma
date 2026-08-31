# Seguridad

Esta es la traducción al español. La versión canónica está en
[`SECURITY.md`](../SECURITY.md).

## Cómo avisar de un fallo de seguridad

**No abras una incidencia pública.** Escribe a **support@panoma.ai** con el asunto
`[security] panoma`.

Cuenta qué se puede hacer, con qué versión y en qué sistema, y cómo reproducirlo. Un
guion mínimo que lo demuestre ahorra días. Si prefieres cifrar, dilo en el primer correo
y se acuerda cómo.

- **Acuse de recibo:** dentro de 72 horas.
- **Primer diagnóstico:** dentro de 7 días, con si se confirma y qué gravedad tiene.
- **Publicación:** cuando haya arreglo, o a los 90 días, lo que llegue antes. Se acredita
  a quien avisó salvo que prefiera lo contrario.

Mientras tanto, agradecemos discreción: panoma se instala en el portátil de alguien y
lee su disco entero, así que un aviso público sin parche es un mapa.

## Qué versiones reciben arreglos

El proyecto todavía no ha publicado una versión estable. Hasta la 1.0, **la rama
`master` es lo único que se arregla**: si encuentras algo, se corrige ahí y sale en la
siguiente publicación. No hay ramas de mantenimiento que respaldar.

## Qué hay dentro del alcance

Panoma es una herramienta local. Esto es lo que guarda y lo que expone, que es donde
está el riesgo de verdad:

| Superficie | Dónde vive | Por qué importa |
| --- | --- | --- |
| Claves de proveedores de IA | `~/.panoma/ai.json`, permisos `0600` | Son claves de pago de quien las puso |
| La clave del canal de agentes | `~/.panoma/ai.json`, y el bloque MCP que escribe `panoma agent-key --install` | Con ella se lee el parte, la bitácora y las tareas de **todo** el catálogo |
| El catálogo | `~/.panoma/db` (PostgreSQL en WASM, local) | Rutas, nombres y descripciones de todo lo que hay en el disco |
| El servidor web | `127.0.0.1:4173` por defecto | Sin credencial: quien alcance el puerto ve el catálogo |
| El acceso desde la red | `panoma up --network` | Abre el puerto a la red local **detrás de dos credenciales**: una deja mirar el catálogo y otra, que no viaja en el enlace del móvil, deja ejecutar en esta máquina |
| El canal de agentes | rutas `/api/agent/*`, `/api/ingest` | La puerta por la que un agente de IA entra al catálogo |
| El servidor MCP | proceso hijo por stdio, sin puerto | Lo que un agente puede leer y escribir |
| El ejecutor de propuestas | `git worktree` local | Ejecuta comandos del proyecto del usuario |

Nos interesan especialmente:

- Cualquier forma de leer el catálogo sin credencial cuando `--network` está activo.
- Cualquier forma de que una ruta de `/api/agent/*` conteste sin guarda.
- Que texto ajeno —el contenido de un `AGENTS.md`, la descripción de una dependencia—
  consiga salirse de su bloque y llegar al modelo como si fuera una instrucción.
- Que una clave acabe en un log, en una respuesta HTTP o en un mensaje de error.
- Que el ejecutor de propuestas escape del worktree o toque el proyecto original.
- Escrituras fuera de las raíces que el usuario dio.

Cómo está construida cada una de esas defensas hoy —y qué reconocemos que **todavía no**
cubren— está en [`docs/mcp-security.md`](../docs/mcp-security.md) y
[`docs/network-access.md`](../docs/network-access.md). Leerlos antes ahorra reportar algo
que ya está documentado como límite conocido.

## Qué queda fuera del alcance

- **Que el catálogo sea legible en `127.0.0.1` sin contraseña.** Es el diseño: es tu
  máquina y tu disco. El modelo de amenaza empieza cuando se abre a la red.
- **Que quien tenga tu sesión de usuario pueda leer `~/.panoma/`.** Los permisos `0600`
  paran a otros usuarios de la máquina, no a un proceso que ya corre como tú.
- **Lo que hace el agente de IA que conectes.** Panoma le da contexto y una cola de
  tareas; lo que el modelo decida hacer con eso es del modelo y de quien lo conectó.
- **Vulnerabilidades de dependencias sin camino de explotación** en panoma. Repórtalas
  igualmente si has encontrado el camino; si es solo la salida de un `audit`, abre una
  incidencia normal.
- Informes automáticos de escáneres sin un caso reproducible detrás.

## Si el fallo está en un proyecto tuyo que panoma escaneó

No lo cuentes aquí. Panoma **lee** los proyectos del disco y enseña lo que encuentra
—credenciales commiteadas, dependencias con avisos—; encontrar algo así significa que la
herramienta funcionó. Lo que hay que arreglar está en tu proyecto, no en este.
