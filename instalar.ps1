# Instala (o actualiza) los mods de mods-equipo en Claude Code, en Windows.
# Installs (or updates) the mods-equipo mods in Claude Code, on Windows.
#
#   irm https://raw.githubusercontent.com/Vincitorecode/mods-equipo/main/instalar.ps1 | iex
#
# Se puede correr las veces que quieras: si ya están instalados, los actualiza.

$ErrorActionPreference = 'Continue'

$Repo = 'Vincitorecode/mods-equipo'
$Marketplace = 'mods-equipo'
$Todos = @('guardia-produccion', 'detector-secretos', 'contexto-costo')
$VersionMinima = [version]'2.1.287'
# Para instalar solo algunos, define antes:  $Mods = @('guardia-produccion')
if (-not $Mods) { $Mods = $Todos }

$Es = (Get-Culture).TwoLetterISOLanguageName -eq 'es'
function Msg($es, $en) { if ($Es) { $es } else { $en } }
function Ok($t) { Write-Host "  " -NoNewline; Write-Host "✔" -ForegroundColor Green -NoNewline; Write-Host " $t" }
function Falla($t) { Write-Host "  " -NoNewline; Write-Host "✘" -ForegroundColor Red -NoNewline; Write-Host " $t" }

Write-Host ""
Write-Host (Msg "Instalando mods de $Repo" "Installing mods from $Repo")
Write-Host ""

# 1. Claude Code instalado
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Falla (Msg 'No encontré el comando claude.' 'The claude command was not found.')
  Write-Host (Msg '    Instala Claude Code: https://docs.claude.com/en/docs/claude-code/setup' '    Install Claude Code: https://docs.claude.com/en/docs/claude-code/setup')
  return
}

# 2. Versión suficiente
$texto = (claude --version 2>$null | Out-String)
if ($texto -notmatch '(\d+\.\d+\.\d+)') {
  Falla (Msg 'No pude leer la versión de Claude Code.' 'Could not read the Claude Code version.')
  return
}
$version = [version]$Matches[1]
if ($version -lt $VersionMinima) {
  Falla (Msg "Tienes Claude Code $version y los mods necesitan $VersionMinima o más reciente." "You have Claude Code $version and the mods need $VersionMinima or newer.")
  Write-Host (Msg '    Actualiza con:  claude update     y vuelve a correr este instalador.' '    Update with:    claude update     and run this installer again.')
  return
}
Ok "Claude Code $version"

# 3. git (el marketplace se descarga con git)
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Falla (Msg 'No encontré git: hace falta para descargar los mods.' 'git was not found: it is needed to download the mods.')
  Write-Host '    winget install --id Git.Git -e'
  return
}
Ok 'git'

# 4. Marketplace: agregarlo, o refrescarlo si ya estaba
$lista = (claude plugin marketplace list 2>$null | Out-String)
if ($lista -match [regex]::Escape($Marketplace)) {
  claude plugin marketplace update $Marketplace *> $null
  if ($LASTEXITCODE -ne 0) {
    Falla (Msg "No pude actualizar el marketplace $Marketplace. Revisa tu conexión a github.com." "Could not update the $Marketplace marketplace. Check your connection to github.com.")
    return
  }
  Ok (Msg "Marketplace $Marketplace actualizado" "Marketplace $Marketplace updated")
} else {
  $salida = (claude plugin marketplace add $Repo 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) {
    Falla (Msg 'No pude agregar el marketplace:' 'Could not add the marketplace:')
    Write-Host $salida
    Write-Host (Msg '    Si tu organización restringe los marketplaces o los mods, pide al admin que los habilite.' '    If your organization restricts marketplaces or mods, ask your admin to allow them.')
    return
  }
  Ok (Msg "Marketplace $Marketplace agregado" "Marketplace $Marketplace added")
}

# 5. Cada mod: instalar o actualizar
$errores = $false
$instalados = (claude plugin list 2>$null | Out-String)
foreach ($mod in $Mods) {
  if ($Todos -notcontains $mod) {
    Falla (Msg "No existe el mod `"$mod`". Opciones: $($Todos -join ', ')" "There is no mod `"$mod`". Options: $($Todos -join ', ')")
    $errores = $true
    continue
  }
  if ($instalados -match [regex]::Escape("$mod@$Marketplace")) {
    claude plugin update "$mod@$Marketplace" *> $null
    if ($LASTEXITCODE -eq 0) { Ok (Msg "$mod actualizado" "$mod updated") } else { Falla (Msg "No pude actualizar $mod" "Could not update $mod"); $errores = $true }
  } else {
    $salida = (claude plugin install "$mod@$Marketplace" --scope user 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0) { Ok (Msg "$mod instalado" "$mod installed") } else { Falla (Msg "No pude instalar ${mod}:" "Could not install ${mod}:"); Write-Host $salida; $errores = $true }
  }
}

Write-Host ""
if (-not $errores) {
  Write-Host (Msg 'Listo. Abre una sesión nueva de Claude Code (o escribe /reload-plugins en una abierta).' 'Done. Start a new Claude Code session (or type /reload-plugins in an open one).')
  Write-Host (Msg 'Comandos: /guardia · /secretos · /costo        Configurar: /plugin → Installed' 'Commands: /guardia · /secretos · /costo        Configure: /plugin → Installed')
} else {
  Write-Host (Msg 'Terminó con errores. Revisa la sección "Problemas comunes" del README:' 'Finished with errors. See the "Troubleshooting" section of the README:')
  Write-Host "  https://github.com/$Repo#problemas-comunes--troubleshooting"
}
