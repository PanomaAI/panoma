<#
  Dónde vive una aplicación en Windows: la misma foto antes y después de instalarla.

  Panoma sabe abrir un proyecto con la app de escritorio de Claude o de ChatGPT, pero solo
  en macOS, donde una aplicación es una carpeta con un nombre fijo en uno de dos sitios
  fijos, y donde el sistema declara por escrito —en `CFBundleDocumentTypes`— si sabe abrir
  una carpeta. En Windows no hay nada de eso: hay cuatro sitios donde puede caer un
  ejecutable, un registro con tres vistas, y una tienda que instala en un sitio al que no
  se llega por ruta.

  Escribir esas rutas de memoria es exactamente el fallo que este proyecto lleva días
  arreglando: código que compila, pasa los tests y falla en la máquina de otro. Así que en
  vez de adivinar, esto mira. Se ejecuta dos veces sobre una máquina limpia —antes y
  después de instalar— y lo que haya cambiado entre las dos fotos es, sin margen de
  interpretación, lo que dejó el instalador.

  No instala nada ni abre nada: solo lee el registro y lista carpetas. Se puede ejecutar
  en la máquina de cualquiera sin consecuencias.

  Uso:  powershell -ExecutionPolicy Bypass -File apps-probe.ps1 -Salida antes
#>
param(
  [Parameter(Mandatory = $true)][string]$Salida
)

# Un sondeo que aborta a la primera clave que no existe no sirve de nada: la mitad de las
# claves que se miran aquí solo existen en algunas máquinas, y su ausencia es un dato.
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $Salida | Out-Null
Remove-Item -LiteralPath (Join-Path $Salida 'conteos.txt') -ErrorAction SilentlyContinue

function Guardar($nombre, $datos) {
  $lista = @($datos)
  $ruta = Join-Path $Salida "$nombre.json"
  <#
    El array se compone a mano, elemento a elemento.

    La forma corta —`,$lista | ConvertTo-Json`— produce dos cosas distintas según la
    PowerShell que la ejecute: en la 7 un array, y en la 5.1 un envoltorio
    `{"value":[...],"Count":n}`. El primer sondeo se escribió con la 5.1 y se leyó con esa
    suposición, y el informe salió diciendo «nada nuevo» sobre una máquina donde acababa
    de instalarse una aplicación entera. Un objeto suelto sí se serializa igual en las
    dos, así que se serializan de uno en uno y el array lo pone este guion.
  #>
  $piezas = foreach ($item in $lista) { $item | ConvertTo-Json -Depth 6 -Compress }
  ('[' + ($piezas -join ',') + ']') | Set-Content -LiteralPath $ruta -Encoding UTF8
  Write-Host ("  {0,-22} {1,5} entradas" -f $nombre, $lista.Count)
  # El recuento, aparte y en texto plano: es lo que permite que el informe se dé cuenta de
  # que ha leído mal en vez de concluir en falso. Ver `apps-report.ps1`.
  Add-Content -LiteralPath (Join-Path $Salida 'conteos.txt') -Value ("{0}={1}" -f $nombre, $lista.Count)
}

function ValorDe($clave, $nombre) {
  if ($null -eq $clave) { return $null }
  try { return $clave.GetValue($nombre) } catch { return $null }
}

function ComandoDe($rutaDeClave) {
  $clave = Get-Item -LiteralPath "Registry::$rutaDeClave" -ErrorAction SilentlyContinue
  return (ValorDe $clave '')
}

Write-Host "Sondeo en $Salida"

# ─── 1 · Programas instalados ────────────────────────────────────────────────────────
#
# La lista de «Agregar o quitar programas». Es el sitio donde un instalador de escritorio
# declara su nombre, su versión y —cuando se digna— su carpeta. Tres vistas porque un
# programa de 32 bits, uno de 64 y uno instalado solo para este usuario viven en claves
# distintas, y el de Claude en Windows es de los que se instalan por usuario.
$desinstalar = Get-ItemProperty -ErrorAction SilentlyContinue -Path @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
) | Where-Object { $_.DisplayName } | ForEach-Object {
  [pscustomobject]@{
    Nombre     = $_.DisplayName
    Version    = $_.DisplayVersion
    Editor     = $_.Publisher
    Carpeta    = $_.InstallLocation
    Icono      = $_.DisplayIcon
    Desinstala = $_.UninstallString
    Clave      = ($_.PSPath -replace '^Microsoft\.PowerShell\.Core\\Registry::', '')
  }
}
Guardar 'programas' $desinstalar

# ─── 2 · App Paths ───────────────────────────────────────────────────────────────────
#
# El mecanismo de Windows para «este nombre es un programa aunque no esté en el PATH».
# Es lo más parecido que hay a un `which` para aplicaciones de escritorio, y si Claude se
# registra aquí, detectarla es leer una clave y ya está.
$rutasDeApp = foreach ($raiz in @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths'
)) {
  Get-ChildItem -LiteralPath $raiz -ErrorAction SilentlyContinue | ForEach-Object {
    [pscustomobject]@{
      Nombre  = $_.PSChildName
      Ruta    = (ValorDe $_ '')
      Carpeta = (ValorDe $_ 'Path')
      Clave   = $_.Name
    }
  }
}
Guardar 'rutas-de-app' $rutasDeApp

# ─── 3 · Menú de inicio ──────────────────────────────────────────────────────────────
#
# Los accesos directos que crea cualquier instalador de escritorio. Se resuelve cada uno
# para quedarse con a qué apunta, que es lo que hace falta para lanzarlo. El COM de
# WScript.Shell es de 1998 y sigue siendo la forma de leer un `.lnk` sin dependencias.
$menus = @(
  (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'),
  (Join-Path $env:APPDATA     'Microsoft\Windows\Start Menu\Programs')
)
$shell = New-Object -ComObject WScript.Shell
$accesos = foreach ($menu in $menus) {
  if (-not (Test-Path -LiteralPath $menu)) { continue }
  Get-ChildItem -LiteralPath $menu -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
    $enlace = $null
    try { $enlace = $shell.CreateShortcut($_.FullName) } catch { }
    [pscustomobject]@{
      Nombre     = $_.BaseName
      Enlace     = $_.FullName
      Destino    = $(if ($enlace) { $enlace.TargetPath } else { '' })
      Argumentos = $(if ($enlace) { $enlace.Arguments } else { '' })
      Carpeta    = $(if ($enlace) { $enlace.WorkingDirectory } else { '' })
    }
  }
}
Guardar 'menu-inicio' $accesos

# ─── 4 · Identificadores del menú de inicio ──────────────────────────────────────────
#
# `Get-StartApps` lista lo mismo que ve quien pulsa Inicio, con una diferencia importante:
# incluye las aplicaciones de la tienda, que no tienen `.lnk` ni ruta y se lanzan por su
# identificador. Si ChatGPT llega por la tienda, aparecerá aquí y en ningún otro sitio.
$identificadores = @()
try { $identificadores = Get-StartApps | ForEach-Object { [pscustomobject]@{ Nombre = $_.Name; AppID = $_.AppID } } }
catch { Write-Host "  (Get-StartApps no está disponible: $($_.Exception.Message))" }
Guardar 'menu-appid' $identificadores

# ─── 5 · Verbos de carpeta ───────────────────────────────────────────────────────────
#
# La pregunta que decide si el botón puede existir. En macOS una app declara que sabe
# abrir una carpeta en su `Info.plist`; aquí lo declara escribiendo un verbo bajo
# `Directory\shell`, que es lo que sale al pulsar el botón derecho sobre una carpeta. Si
# después de instalar no hay verbo nuevo, la app no ha prometido nada sobre carpetas y
# pasarle una ruta sería inventar.
$verbos = foreach ($clase in @('Directory', 'Directory\Background', 'Folder', 'Drive')) {
  Get-ChildItem -LiteralPath "Registry::HKEY_CLASSES_ROOT\$clase\shell" -ErrorAction SilentlyContinue | ForEach-Object {
    [pscustomobject]@{
      Clase   = $clase
      Verbo   = $_.PSChildName
      Texto   = (ValorDe $_ '')
      Comando = (ComandoDe "$($_.Name)\command")
    }
  }
}
Guardar 'verbos-de-carpeta' $verbos

# ─── 6 · Protocolos ──────────────────────────────────────────────────────────────────
#
# La otra forma de hablar con una app que ya está abierta. Panoma no compone esquemas a
# mano —un `claude://` no documentado cambia sin avisar y deja el botón mudo—, pero saber
# si existe y con qué comando se resuelve es parte del mapa.
$protocolos = Get-ChildItem -LiteralPath 'Registry::HKEY_CLASSES_ROOT' -ErrorAction SilentlyContinue |
  Where-Object { $_.PSChildName -notlike '.*' -and $null -ne (ValorDe $_ 'URL Protocol') } |
  ForEach-Object {
    [pscustomobject]@{
      Esquema = $_.PSChildName
      Comando = (ComandoDe "$($_.Name)\shell\open\command")
    }
  }
Guardar 'protocolos' $protocolos

# ─── 7 · Aplicaciones de la tienda ───────────────────────────────────────────────────
$tienda = @()
try {
  $tienda = Get-AppxPackage -ErrorAction SilentlyContinue | ForEach-Object {
    [pscustomobject]@{ Nombre = $_.Name; Familia = $_.PackageFamilyName; Carpeta = $_.InstallLocation }
  }
} catch { Write-Host "  (Get-AppxPackage no está disponible: $($_.Exception.Message))" }
Guardar 'tienda' $tienda

# ─── 8 · Carpetas de primer nivel ────────────────────────────────────────────────────
#
# Cuatro sitios donde cae un programa en Windows, y la única forma de saber en cuál cayó
# este es haber mirado antes. Solo el primer nivel: lo que interesa es qué carpeta nueva
# apareció, no su contenido, que se lista después sabiendo ya dónde mirar.
$carpetas = foreach ($raiz in @($env:LOCALAPPDATA, $env:APPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramData)) {
  if ([string]::IsNullOrWhiteSpace($raiz) -or -not (Test-Path -LiteralPath $raiz)) { continue }
  Get-ChildItem -LiteralPath $raiz -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    [pscustomobject]@{ Carpeta = $_.FullName }
  }
}
Guardar 'carpetas' $carpetas

Write-Host "Sondeo terminado."
