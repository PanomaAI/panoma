<#
  Instala en el CI la app de escritorio que se quiere sondear, sin inventarse la URL.

  La tentación aquí es escribir a mano el enlace de descarga que uno recuerda haber visto.
  No: el catálogo de winget es público, lo mantiene quien publica cada app, y dice en un
  fichero versionado de dónde se baja el instalador y con qué opción se instala en
  silencio. Este guion lee ese fichero. Si el catálogo no tiene la app, no hay descarga —
  y eso también es una respuesta, mejor que una URL adivinada que un día devuelve 404.

  Primero se prueba `winget` a secas, que es lo que haría cualquiera; si el runner no lo
  trae o el paquete no está en su índice, se resuelve el manifiesto por la API de GitHub y
  se baja el instalador a mano. Las dos rutas acaban en el mismo sitio.

  Uso:  powershell -ExecutionPolicy Bypass -File install-app.ps1 -App claude
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('claude', 'chatgpt')][string]$App
)

$ErrorActionPreference = 'Continue'
# Windows PowerShell 5.1 negocia TLS 1.0 si nadie le dice lo contrario, y ni GitHub ni
# ninguna descarga seria lo acepta ya. Sin esta línea el fallo llega como «conexión
# cerrada», que no se parece en nada a su causa.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

<#
  De dónde sale cada identificador, para que nadie los tenga que recordar:

  · `Anthropic.Claude` está en el catálogo comunitario de winget, y el primer sondeo lo
    instaló con él: versión 1.30096.1, bajada de downloads.claude.ai.

  · ChatGPT no está en ese catálogo. Se buscó `OpenAI.ChatGPT` y no existe —bajo `OpenAI`
    solo hay `Codex`—, así que el primer sondeo se quedó sin instalar nada. Preguntando a
    la fuente de la tienda, que es la misma que consulta winget, aparece con el
    identificador `9PLM9XGG6VKS`. Eso lo cambia todo para el sondeo: una aplicación de la
    tienda no tiene ruta de instalación ni clave de desinstalación, y se busca y se lanza
    por su familia de paquete.
#>
$catalogo = @{
  claude  = @{ Id = 'Anthropic.Claude'; Nombre = 'Claude';  Fuentes = @('winget');  Manifiesto = 'manifests/a/Anthropic/Claude' }
  chatgpt = @{ Id = '9PLM9XGG6VKS';     Nombre = 'ChatGPT'; Fuentes = @('msstore'); Manifiesto = $null }
}
$ficha = $catalogo[$App]
Write-Host "== Instalando $($ficha.Id) =="

<#
  Los instaladores de Electron arrancan la aplicación al terminar, y los de tipo Squirrel
  además dejan un proceso hijo copiando ficheros después de que el padre haya salido. La
  foto de después no puede hacerse encima de eso.
#>
function Rematar($codigo) {
  Start-Sleep -Seconds 15
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match '(?i)claude|chatgpt' } |
    ForEach-Object { Write-Host "-- cerrando $($_.ProcessName)"; try { $_.CloseMainWindow() | Out-Null; $_.Kill() } catch { } }
  exit $codigo
}

function Cabeceras {
  $cabeceras = @{ 'User-Agent' = 'panoma-sondeo' }
  if ($env:GITHUB_TOKEN) { $cabeceras['Authorization'] = "Bearer $env:GITHUB_TOKEN" }
  return $cabeceras
}

# ─── Primer intento: winget ──────────────────────────────────────────────────────────
$winget = Get-Command winget -ErrorAction SilentlyContinue
if ($winget) {
  Write-Host "-- winget está: $($winget.Source)"
  foreach ($fuente in $ficha.Fuentes) {
    Write-Host "-- winget install --source $fuente"
    & winget install --id $ficha.Id --exact --source $fuente --silent `
      --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1 |
      ForEach-Object { Write-Host "   $_" }
    if ($LASTEXITCODE -eq 0) {
      Write-Host "-- instalado por winget desde $fuente"
      Rematar 0
    }
    Write-Host "-- winget/$fuente salió con $LASTEXITCODE"
    # Si el identificador no vale, lo útil no es volver a adivinar otro: es dejar escrito
    # lo que esa fuente sí tiene con ese nombre, para que el siguiente sondeo lo use.
    Write-Host "-- lo que hay en $fuente con el nombre «$($ficha.Nombre)»:"
    & winget search $ficha.Nombre --source $fuente --accept-source-agreements --disable-interactivity 2>&1 |
      Select-Object -First 15 | ForEach-Object { Write-Host "   $_" }
  }
} else {
  Write-Host "-- winget no está en este runner"
}

if (-not $ficha.Manifiesto) {
  Write-Host "!! $($ficha.Nombre) solo se distribuye por la tienda y la tienda no lo ha dado."
  Write-Host "!! No hay segunda vía: un paquete de la tienda no se baja por URL."
  exit 2
}

# ─── Segundo intento: el manifiesto, leído ───────────────────────────────────────────
Write-Host "-- buscando el manifiesto en microsoft/winget-pkgs"
$indice = "https://api.github.com/repos/microsoft/winget-pkgs/contents/$($ficha.Manifiesto)"
try {
  $versiones = Invoke-RestMethod -Uri $indice -Headers (Cabeceras) -UseBasicParsing
} catch {
  Write-Host "!! el catálogo de winget no tiene $($ficha.Id): $($_.Exception.Message)"
  Write-Host "!! sin manifiesto no hay descarga verificable; no se inventa ninguna URL."
  exit 2
}

$carpetas = @($versiones | Where-Object { $_.type -eq 'dir' } | ForEach-Object { $_.name })
if ($carpetas.Count -eq 0) { Write-Host '!! el manifiesto no lista versiones'; exit 2 }
$ultima = $carpetas | Sort-Object -Property @{ Expression = {
  $v = $null
  if ([version]::TryParse($_, [ref]$v)) { $v } else { [version]'0.0' }
} }, @{ Expression = { $_ } } | Select-Object -Last 1
Write-Host "-- versión más alta del catálogo: $ultima"

$crudo = "https://raw.githubusercontent.com/microsoft/winget-pkgs/master/$($ficha.Manifiesto)/$ultima/$($ficha.Id).installer.yaml"
try {
  $yaml = (Invoke-WebRequest -Uri $crudo -Headers (Cabeceras) -UseBasicParsing).Content
} catch {
  Write-Host "!! no se pudo leer $crudo : $($_.Exception.Message)"
  exit 2
}
Write-Host "-- manifiesto leído ($($yaml.Length) bytes)"

# El manifiesto es YAML y aquí no hay analizador de YAML; se leen las tres cosas que
# hacen falta con expresiones regulares, y se dice cuáles se han leído para que quien
# mire el registro pueda comprobarlo contra el fichero original.
$bloques = @($yaml -split '(?m)^\s*-\s+(?=Architecture:)') | Where-Object { $_ -match 'InstallerUrl:' }
$elegido = $bloques | Where-Object { $_ -match '(?m)^\s*Architecture:\s*x64' } | Select-Object -First 1
if (-not $elegido) { $elegido = $bloques | Select-Object -First 1 }
if (-not $elegido) { Write-Host '!! el manifiesto no trae ningún InstallerUrl'; exit 2 }

$url = ([regex]::Match($elegido, '(?m)^\s*InstallerUrl:\s*(\S+)')).Groups[1].Value
$tipo = ([regex]::Match($yaml, '(?m)^\s*InstallerType:\s*(\S+)')).Groups[1].Value
$silencio = ([regex]::Match($yaml, '(?m)^\s*Silent:\s*(.+?)\s*$')).Groups[1].Value
Write-Host "-- URL:      $url"
Write-Host "-- tipo:     $tipo"
Write-Host "-- silencio: $(if ($silencio) { $silencio } else { '(no declarado)' })"

$destino = Join-Path $env:RUNNER_TEMP ([IO.Path]::GetFileName(([uri]$url).AbsolutePath))
Write-Host "-- bajando a $destino"
Invoke-WebRequest -Uri $url -OutFile $destino -UseBasicParsing
Write-Host "-- bajado: $((Get-Item -LiteralPath $destino).Length) bytes"

# Cada familia de instaladores tiene su opción para no abrir ventanas. Si el manifiesto la
# declara se usa la suya; si no, la de su tipo. Adivinar aquí es barato de comprobar: si
# la opción no es la buena, el instalador abre una ventana, nadie la cierra y el proceso
# se queda colgado — por eso hay un límite de tiempo más abajo.
$argumentos = @()
if ($silencio) {
  $argumentos = @($silencio)
} else {
  switch -Regex ($tipo) {
    'nullsoft' { $argumentos = @('/S') }
    'inno'     { $argumentos = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') }
    'burn|wix' { $argumentos = @('/quiet', '/norestart') }
    default    { $argumentos = @('--silent') }
  }
}

$extension = [IO.Path]::GetExtension($destino).ToLowerInvariant()
if ($extension -in @('.msix', '.appx', '.msixbundle', '.appxbundle')) {
  Write-Host "-- Add-AppxPackage $destino"
  Add-AppxPackage -Path $destino
  Rematar $(if ($?) { 0 } else { 3 })
}

if ($extension -eq '.msi') {
  $proceso = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"$destino`"", '/qn', '/norestart') -PassThru
} else {
  Write-Host "-- ejecutando con: $($argumentos -join ' ')"
  $proceso = Start-Process -FilePath $destino -ArgumentList $argumentos -PassThru
}

# Cinco minutos: un instalador de escritorio tarda segundos, y uno que lleva cinco minutos
# está esperando a que alguien pulse un botón que aquí no va a pulsar nadie.
if (-not $proceso.WaitForExit(300000)) {
  Write-Host '!! el instalador sigue vivo a los cinco minutos; se cierra'
  try { $proceso.Kill() } catch { }
  exit 4
}
Write-Host "-- el instalador salió con $($proceso.ExitCode)"
Rematar $proceso.ExitCode
