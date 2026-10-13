# Cambios · Changelog

## 2026-10-13

### Para todos
- **Idioma español / inglés** en los tres mods (opción *Idioma*, por defecto `auto`: usa el idioma de Claude Code o el del sistema).
- **Instalador de un comando** para macOS / Linux (`instalar.sh`) y Windows (`instalar.ps1`): revisa la versión de Claude Code y git, agrega el marketplace e instala o actualiza.
- README con sección de **problemas comunes**, versión en inglés y licencia MIT.
- Pruebas automáticas en GitHub Actions.

### guardia-produccion 0.3.0
- Lee los comandos como la shell: el texto entre comillas (mensajes de commit, `echo "..."`), los heredocs a archivos, `--help` y `--dry-run` ya no se detienen.
- Revisa lo que va dentro de `bash -c`, `sh -c`, `eval`, `ssh servidor "..."`, `$(...)` y heredocs a una shell.
- `git push` sin rama se detiene si estás en una rama protegida; también `--delete`, `:rama`, `--mirror`, `--all`.
- Nuevas reglas: `git branch -D`, `checkout -- .`, `restore .`, `stash drop/clear`, `filter-branch`, `find -delete`, `xargs rm -rf`, Docker (`volume rm`, `compose down -v`, `system prune`), `gh repo delete`, `npm unpublish`, Laravel, Ecto, Drizzle, Supabase, goose, dbmate, `gsutil rm -r`, `heroku apps:destroy`, `sls remove`, `dd`/`mkfs`, `Remove-Item -Recurse`.
- `rm -rf node_modules/../src` ya no se cuela; `rm -rf /tmp/algo` y carpetas desechables en subcarpetas (`apps/web/.next`) ya no preguntan.
- Revisa también la herramienta PowerShell (Windows).
- Opciones nuevas: ramas protegidas, comandos permitidos, categorías apagadas y qué hacer sin nadie que conteste (`claude -p`, CI).
- Diálogo más corto: máximo 3 motivos; el detalle completo en `/guardia`.

### detector-secretos 0.3.0
- Detecta secretos **sin comillas** (`.env`, YAML, `.properties`, docker-compose, `export`) y contraseñas dentro de URLs (`https://usuario:clave@...`).
- Nuevos proveedores: Azure Storage, Hugging Face, DigitalOcean, Shopify, Linear, Doppler, PyPI, Mailgun, Telegram, webhooks de Discord.
- Revisa lo que Claude escribe a archivos desde la shell (`> archivo`, `tee`, heredocs, `Set-Content`).
- Comentario `secretos:permitir` (o `gitleaks:allow`) para permitir una línea.
- Menos falsos positivos: variables de prueba (`testPassword`), referencias (`${{ secrets.X }}`, `!Ref`, `os.getenv(...)`), TTL, rutas.
- Rutas de Windows (`C:\proyecto\.env`) reconocidas como `.env` permitidos.
- Opción nueva: tipos que no se revisan.

### contexto-costo 0.4.0
- Corregido: después de 30 turnos el panel numeraba mal y el promedio por turno salía inflado.
- Idioma español / inglés.
