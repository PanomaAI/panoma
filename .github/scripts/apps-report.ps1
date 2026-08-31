<#
  Lo que cambió entre las dos fotos, escrito para que se pueda leer sin ser de Windows.

  Un volcado del registro no es una respuesta; es material para una. Aquí se compara la
  foto de antes con la de después y se responde a las cuatro preguntas que decidirán si
  Panoma puede tener en Windows el botón que ya tiene en macOS:

    1. ¿Se instaló algo?  (si no, el resto del informe no significa nada)
    2. ¿Dónde quedó el ejecutable, y por qué clave se llega a él sin adivinar la ruta?
    3. ¿La app declaró que sabe abrir una carpeta?
    4. ¿Se puede lanzar por identificador, para las que llegan por la tienda?

  Uso:  powershell -File apps-report.ps1 -Antes antes -Despues despues -Salida i.md -Patron 'claude|anthropic'
#>
param(
  [Parameter(Mandatory = $true)][string]$Antes,
  [Parameter(Mandatory = $true)][string]$Despues,
  [Parameter(Mandatory = $true)][string]$Salida,
  [Parameter(Mandatory = $true)][string]$Patron
)

$ErrorActionPreference = 'Continue'

function Leer($carpeta, $fichero) {
  $ruta = Join-Path $carpeta "$fichero.json"
  if (-not (Test-Path -LiteralPath $ruta)) { return , @() }
  $texto = Get-Content -LiteralPath $ruta -Raw
  if ([string]::IsNullOrWhiteSpace($texto)) { return , @() }
  $datos = $texto | ConvertFrom-Json
  # Un sondeo viejo pudo escribir el envoltorio de la PowerShell 5.1; se acepta igual.
  if ($datos -is [psobject] -and $null -ne $datos.PSObject.Properties['value']) { $datos = $datos.value }
  # La coma de vuelta importa: sin ella, una lista de un elemento se desenvuelve al salir
  # de la función y `$actuales.Count` deja de contar filas para leer una propiedad del
  # objeto que llevaba dentro. Ese fue exactamente el fallo del primer sondeo.
  return , @($datos)
}

<#
  Lo que dijo el sondeo que había guardado, para poder desmentirse a sí mismo.

  El primer informe dijo «nada nuevo» sobre una máquina en la que se acababa de instalar
  una aplicación, y lo dijo con toda la seguridad del mundo. Un informe que no se puede
  equivocar en silencio vale más que uno bonito: si lo que se lee no cuadra con lo que se
  escribió, aquí no hay veredicto.
#>
function Conteos($carpeta) {
  $tabla = @{}
  $ruta = Join-Path $carpeta 'conteos.txt'
  if (-not (Test-Path -LiteralPath $ruta)) { return $tabla }
  foreach ($linea in (Get-Content -LiteralPath $ruta)) {
    $partes = $linea -split '=', 2
    if ($partes.Count -eq 2) { $tabla[$partes[0]] = [int]$partes[1] }
  }
  return $tabla
}

function Celda($valor) {
  $texto = "$valor"
  if ([string]::IsNullOrWhiteSpace($texto)) { return '—' }
  $texto = $texto -replace '\r?\n', ' '
  if ($texto.Length -gt 200) { $texto = $texto.Substring(0, 197) + '…' }
  # La barra vertical parte una tabla de Markdown por la mitad, y las rutas de Windows
  # están llenas de comandos que la llevan dentro.
  $texto = $texto -replace '\|', '\|'
  return "``$texto``"
}

function Tabla($filas, $columnas) {
  $lineas = @()
  $lineas += '| ' + ($columnas -join ' | ') + ' |'
  $lineas += '| ' + (($columnas | ForEach-Object { '---' }) -join ' | ') + ' |'
  foreach ($fila in $filas) {
    $celdas = foreach ($columna in $columnas) { Celda $fila.$columna }
    $lineas += '| ' + ($celdas -join ' | ') + ' |'
  }
  return $lineas
}

<#
  Qué identifica a una fila, por nombre de propiedad y no por un bloque de código.

  La primera versión llevaba un `{ $_.Clave }` por sección y lo aplicaba con
  `$fila | ForEach-Object $clave`, que monta una tubería entera para leer una propiedad.
  Con cuatrocientas filas por sección y dos fotos, eso son miles de tuberías y el informe
  tardaba minutos en una máquina lenta. Un nombre de propiedad hace lo mismo sin montar
  nada.
#>
$secciones = @(
  @{ Fichero = 'programas';         Titulo = 'Programas instalados';       Claves = @('Clave');            Columnas = @('Nombre', 'Version', 'Editor', 'Carpeta', 'Icono', 'Desinstala') },
  @{ Fichero = 'rutas-de-app';      Titulo = 'App Paths';                  Claves = @('Clave');            Columnas = @('Nombre', 'Ruta', 'Carpeta') },
  @{ Fichero = 'menu-inicio';       Titulo = 'Menú de inicio';             Claves = @('Enlace');           Columnas = @('Nombre', 'Destino', 'Argumentos', 'Carpeta') },
  @{ Fichero = 'menu-appid';        Titulo = 'Identificadores de inicio';  Claves = @('AppID');            Columnas = @('Nombre', 'AppID') },
  @{ Fichero = 'verbos-de-carpeta'; Titulo = 'Verbos de carpeta';          Claves = @('Clase', 'Verbo');   Columnas = @('Clase', 'Verbo', 'Texto', 'Comando') },
  @{ Fichero = 'protocolos';        Titulo = 'Protocolos';                 Claves = @('Esquema');          Columnas = @('Esquema', 'Comando') },
  @{ Fichero = 'tienda';            Titulo = 'Apps de la tienda';          Claves = @('Familia');          Columnas = @('Nombre', 'Familia', 'Carpeta') },
  @{ Fichero = 'carpetas';          Titulo = 'Carpetas de primer nivel';   Claves = @('Carpeta');          Columnas = @('Carpeta') }
)

function Unir($fila, $propiedades, $separador) {
  $partes = @()
  foreach ($propiedad in $propiedades) { $partes += "$($fila.$propiedad)" }
  return ($partes -join $separador)
}

$nuevas = @{}
$cuerpo = @()

$conteosAntes = Conteos $Antes
$conteosDespues = Conteos $Despues
$desacuerdos = @()

foreach ($seccion in $secciones) {
  $viejas = Leer $Antes $seccion.Fichero
  $actuales = Leer $Despues $seccion.Fichero

  foreach ($par in @(
    @{ Foto = 'antes';   Leidas = $viejas.Count;   Dichas = $conteosAntes[$seccion.Fichero] },
    @{ Foto = 'después'; Leidas = $actuales.Count; Dichas = $conteosDespues[$seccion.Fichero] }
  )) {
    if ($null -ne $par.Dichas -and $par.Leidas -ne $par.Dichas) {
      $desacuerdos += "$($seccion.Fichero) ($($par.Foto)): el sondeo guardó $($par.Dichas) y aquí se han leído $($par.Leidas)"
    }
  }
  $conocidas = @{}
  foreach ($item in $viejas) { $conocidas[(Unir $item $seccion.Claves '|')] = $true }
  $recien = @()
  foreach ($item in $actuales) { if (-not $conocidas[(Unir $item $seccion.Claves '|')]) { $recien += $item } }
  $nuevas[$seccion.Fichero] = $recien

  $cuerpo += ''
  $cuerpo += "### $($seccion.Titulo) · $($recien.Count) nuevas de $($actuales.Count)"
  if ($recien.Count -eq 0) {
    $cuerpo += ''
    $cuerpo += '_Nada nuevo._'
  } else {
    $cuerpo += ''
    $cuerpo += Tabla ($recien | Select-Object -First 40) $seccion.Columnas
    if ($recien.Count -gt 40) { $cuerpo += ''; $cuerpo += "_…y $($recien.Count - 40) más, en el artefacto._" }
  }
}

# ─── Los ejecutables que dejó, con nombre y sitio ────────────────────────────────────
$ejecutables = @()
foreach ($carpeta in $nuevas['carpetas']) {
  $ejecutables += Get-ChildItem -LiteralPath $carpeta.Carpeta -Recurse -Depth 3 -Filter *.exe -ErrorAction SilentlyContinue |
    Select-Object -First 30 | ForEach-Object {
      [pscustomobject]@{ Ruta = $_.FullName; Tamano = "{0:N1} MB" -f ($_.Length / 1MB); Bytes = $_.Length }
    }
}
# De mayor a menor: en una carpeta de Electron hay un ejecutable de verdad y tres lanzadores
# de medio mega, y el orden del disco no distingue entre ellos.
$ejecutables = @($ejecutables | Sort-Object -Property Bytes -Descending)

# ─── Lo que lleva el nombre de la app, haya cambiado o no ────────────────────────────
#
# El diff enseña lo que apareció; esto enseña lo que hay. Sirve para el caso incómodo de
# que la app ya estuviera de fábrica en la imagen del runner, en el que el diff saldría
# vacío y la conclusión «no se instaló» sería falsa.
$coincidencias = @()
foreach ($seccion in $secciones) {
  $actuales = Leer $Despues $seccion.Fichero
  $filas = @()
  foreach ($fila in $actuales) { if ((Unir $fila $seccion.Columnas ' ') -match $Patron) { $filas += $fila } }
  if ($filas.Count -gt 0) {
    $coincidencias += ''
    $coincidencias += "### $($seccion.Titulo) · $($filas.Count) coinciden"
    $coincidencias += ''
    $coincidencias += Tabla ($filas | Select-Object -First 20) $seccion.Columnas
  }
}

# ─── Antes de opinar, comprobar que se ha leído lo que hay ───────────────────────────
if ($desacuerdos.Count -gt 0) {
  $aviso = @('# Sondeo sin veredicto', '', 'Lo leído no cuadra con lo guardado, así que no hay conclusión que dar:', '')
  $aviso += ($desacuerdos | ForEach-Object { "- $_" })
  $aviso += @('', 'Las dos fotos están en el artefacto: la respuesta sigue ahí, sin nadie que la resuma.')
  $aviso -join "`n" | Set-Content -LiteralPath $Salida -Encoding UTF8
  Write-Host ($aviso -join "`n")
  exit 3
}

# ─── Veredicto ───────────────────────────────────────────────────────────────────────
function Frase($condicion, $cuandoSi, $cuandoNo) { if ($condicion) { $cuandoSi } else { $cuandoNo } }

$instalado = ($nuevas['programas'].Count + $nuevas['tienda'].Count + $ejecutables.Count) -gt 0
$veredicto = @()
$veredicto += "## Veredicto"
$veredicto += ''
$veredicto += "- **¿Se instaló?** " + (Frase $instalado 'Sí.' 'No: ni un programa nuevo, ni un paquete de tienda, ni un ejecutable. Lo de abajo no significa nada todavía.')
$mayor = $(if ($ejecutables.Count -gt 0) { $ejecutables[0].Ruta } else { '' })
$veredicto += "- **¿Ejecutable?** " + (Frase ($ejecutables.Count -gt 0) "Sí, $($ejecutables.Count); el mayor en ``$mayor``." 'No apareció ninguno en las carpetas nuevas.')
$veredicto += "- **¿Se llega sin adivinar la ruta?** " + (Frase ($nuevas['rutas-de-app'].Count -gt 0) 'Sí, por App Paths.' (Frase ($nuevas['menu-inicio'].Count -gt 0) 'Por App Paths no, pero sí por el acceso directo del menú de inicio.' (Frase ($nuevas['programas'].Count -gt 0) 'Solo por la clave de desinstalación, que trae carpeta o icono.' 'No, por ninguna de las tres vías.')))
$veredicto += "- **¿Dice saber abrir una carpeta?** " + (Frase ($nuevas['verbos-de-carpeta'].Count -gt 0) "Sí: $($nuevas['verbos-de-carpeta'].Count) verbo(s) nuevo(s) bajo Directory\shell." 'No. No registró ningún verbo de carpeta, así que pasarle una ruta sería inventarse una promesa que no hizo.')
$veredicto += "- **¿Protocolo propio?** " + (Frase ($nuevas['protocolos'].Count -gt 0) "Sí: $(($nuevas['protocolos'] | ForEach-Object { $_.Esquema }) -join ', ')." 'No registró ninguno.')
$veredicto += "- **¿Identificador de inicio?** " + (Frase ($nuevas['menu-appid'].Count -gt 0) "Sí: $(($nuevas['menu-appid'] | ForEach-Object { $_.AppID }) -join ', ')." 'No apareció en el menú de inicio.')

$informe = @()
$informe += "# Sondeo · $Patron"
$informe += ''
$informe += $veredicto
if ($ejecutables.Count -gt 0) {
  $informe += ''
  $informe += '## Ejecutables en las carpetas nuevas'
  $informe += ''
  $informe += Tabla $ejecutables @('Ruta', 'Tamano')
}
$informe += ''
$informe += '## Lo que cambió'
$informe += $cuerpo
if ($coincidencias.Count -gt 0) {
  $informe += ''
  $informe += '## Lo que lleva el nombre, cambiara o no'
  $informe += $coincidencias
}

$informe -join "`n" | Set-Content -LiteralPath $Salida -Encoding UTF8
Write-Host ($informe -join "`n")
