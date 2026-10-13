#!/usr/bin/env bash
# Instala (o actualiza) los mods de mods-equipo en Claude Code.
# Installs (or updates) the mods-equipo mods in Claude Code.
#
#   curl -fsSL https://raw.githubusercontent.com/Vincitorecode/mods-equipo/main/instalar.sh | bash
#
# Solo algunos / only some:
#   curl -fsSL https://raw.githubusercontent.com/Vincitorecode/mods-equipo/main/instalar.sh | bash -s -- guardia-produccion detector-secretos
#
# Se puede correr las veces que quieras: si ya están instalados, los actualiza.

set -u

REPO="Vincitorecode/mods-equipo"
MARKETPLACE="mods-equipo"
TODOS="guardia-produccion detector-secretos contexto-costo"
VERSION_MINIMA="2.1.287"

if [ "$#" -gt 0 ]; then MODS="$*"; else MODS="$TODOS"; fi

case "${LC_ALL:-${LANG:-}}" in es*) ES=1 ;; *) ES=0 ;; esac
msg() { if [ "$ES" = 1 ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi; }
ok() { printf '  \033[32m✔\033[0m %s\n' "$1"; }
falla() { printf '  \033[31m✘\033[0m %s\n' "$1"; }

# Compara versiones x.y.z: ¿$1 >= $2?
version_ok() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -n1)" = "$2" ]
}

echo
msg "Instalando mods de $REPO" "Installing mods from $REPO"
echo

# 1. Claude Code instalado
if ! command -v claude >/dev/null 2>&1; then
  falla "$(msg 'No encontré el comando claude.' 'The claude command was not found.')"
  msg "    Instala Claude Code: https://docs.claude.com/en/docs/claude-code/setup" \
      "    Install Claude Code: https://docs.claude.com/en/docs/claude-code/setup"
  exit 1
fi

# 2. Versión suficiente
VERSION="$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"
if [ -z "$VERSION" ]; then
  falla "$(msg 'No pude leer la versión de Claude Code.' 'Could not read the Claude Code version.')"
  exit 1
fi
if ! version_ok "$VERSION" "$VERSION_MINIMA"; then
  falla "$(msg "Tienes Claude Code $VERSION y los mods necesitan $VERSION_MINIMA o más reciente." "You have Claude Code $VERSION and the mods need $VERSION_MINIMA or newer.")"
  msg "    Actualiza con:  claude update     y vuelve a correr este instalador." \
      "    Update with:    claude update     and run this installer again."
  exit 1
fi
ok "Claude Code $VERSION"

# 3. git (el marketplace se descarga con git)
if ! command -v git >/dev/null 2>&1; then
  falla "$(msg 'No encontré git: hace falta para descargar los mods.' 'git was not found: it is needed to download the mods.')"
  msg "    macOS: xcode-select --install · Linux: instala el paquete git" \
      "    macOS: xcode-select --install · Linux: install the git package"
  exit 1
fi
ok "git"

# 4. Marketplace: agregarlo, o refrescarlo si ya estaba
if claude plugin marketplace list 2>/dev/null | grep -q "$MARKETPLACE"; then
  if claude plugin marketplace update "$MARKETPLACE" >/dev/null 2>&1; then
    ok "$(msg "Marketplace $MARKETPLACE actualizado" "Marketplace $MARKETPLACE updated")"
  else
    falla "$(msg "No pude actualizar el marketplace $MARKETPLACE. Revisa tu conexión a github.com." "Could not update the $MARKETPLACE marketplace. Check your connection to github.com.")"
    exit 1
  fi
else
  if SALIDA="$(claude plugin marketplace add "$REPO" 2>&1)"; then
    ok "$(msg "Marketplace $MARKETPLACE agregado" "Marketplace $MARKETPLACE added")"
  else
    falla "$(msg "No pude agregar el marketplace:" "Could not add the marketplace:")"
    printf '%s\n' "$SALIDA" | tail -n 5 | sed 's/^/    /'
    msg "    Si tu organización restringe los marketplaces o los mods, pide al admin que los habilite." \
        "    If your organization restricts marketplaces or mods, ask your admin to allow them."
    exit 1
  fi
fi

# 5. Cada mod: instalar o actualizar
ERRORES=0
for MOD in $MODS; do
  case " $TODOS " in
    *" $MOD "*) ;;
    *) falla "$(msg "No existe el mod \"$MOD\". Opciones: $TODOS" "There is no mod \"$MOD\". Options: $TODOS")"; ERRORES=1; continue ;;
  esac
  if claude plugin list 2>/dev/null | grep -q "$MOD@$MARKETPLACE"; then
    if claude plugin update "$MOD@$MARKETPLACE" >/dev/null 2>&1; then
      ok "$(msg "$MOD actualizado" "$MOD updated")"
    else
      falla "$(msg "No pude actualizar $MOD" "Could not update $MOD")"; ERRORES=1
    fi
  else
    if SALIDA="$(claude plugin install "$MOD@$MARKETPLACE" --scope user 2>&1)"; then
      ok "$(msg "$MOD instalado" "$MOD installed")"
    else
      falla "$(msg "No pude instalar $MOD:" "Could not install $MOD:")"
      printf '%s\n' "$SALIDA" | tail -n 3 | sed 's/^/    /'
      ERRORES=1
    fi
  fi
done

echo
if [ "$ERRORES" = 0 ]; then
  msg "Listo. Abre una sesión nueva de Claude Code (o escribe /reload-plugins en una abierta)." \
      "Done. Start a new Claude Code session (or type /reload-plugins in an open one)."
  msg "Comandos: /guardia · /secretos · /costo        Configurar: /plugin → Installed" \
      "Commands: /guardia · /secretos · /costo        Configure: /plugin → Installed"
else
  msg "Terminó con errores. Revisa la sección \"Problemas comunes\" del README:" \
      "Finished with errors. See the \"Troubleshooting\" section of the README:"
  echo "  https://github.com/$REPO#problemas-comunes--troubleshooting"
  exit 1
fi
