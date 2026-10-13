# Mods de Claude Code: seguridad y visibilidad

*[English below](#english)*

Tres mods que hacen a Claude Code más seguro y más transparente en el día a día. Se instalan por separado, así que cada quien elige los que quiere. Funcionan en español o en inglés.

| Mod | Qué hace | Cuándo lo ves |
| --- | --- | --- |
| **guardia-produccion** | Detiene comandos riesgosos y te pregunta antes de ejecutarlos | Solo cuando Claude intenta algo peligroso |
| **detector-secretos** | Evita que Claude escriba o commitee API keys, tokens o contraseñas | Solo cuando encuentra un posible secreto |
| **contexto-costo** | Muestra el uso de contexto, el costo y tus límites de uso | Siempre, en una línea sobre el prompt |

## Instalación

Necesitas **Claude Code 2.1.287 o más reciente** (revisa con `claude --version`; actualiza con `claude update`) y **git**.

### Opción 1: un solo comando (recomendada)

En la terminal (no dentro de Claude Code):

**macOS / Linux / WSL**

```bash
curl -fsSL https://raw.githubusercontent.com/Vincitorecode/mods-equipo/main/instalar.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/Vincitorecode/mods-equipo/main/instalar.ps1 | iex
```

Revisa tu versión de Claude Code y git, agrega el marketplace e instala los tres mods. Si ya los tenías, los actualiza. Para instalar solo algunos:

```bash
curl -fsSL https://raw.githubusercontent.com/Vincitorecode/mods-equipo/main/instalar.sh | bash -s -- guardia-produccion detector-secretos
```

### Opción 2: a mano, desde la terminal

```bash
claude plugin marketplace add Vincitorecode/mods-equipo
claude plugin install guardia-produccion@mods-equipo
claude plugin install detector-secretos@mods-equipo
claude plugin install contexto-costo@mods-equipo
```

### Opción 3: dentro de Claude Code (en la terminal)

```
/plugin install guardia-produccion --marketplace Vincitorecode/mods-equipo
```

La primera vez pregunta si quieres agregar el marketplace: responde `y` y elige el scope **user** (para que funcione en todos tus proyectos). Repite con `detector-secretos` y `contexto-costo`.

> En la **app de escritorio** (pestaña Code) el comando `/plugin install` no está disponible: instala desde la terminal con la opción 1 o 2 y los mods cargan también en la app.

### Comprobar que cargaron

Abre una sesión **nueva** de Claude Code (o escribe `/reload-plugins` en una abierta) y escribe `/plugin`: verás algo como `3 mods active · guardia-produccion, detector-secretos, contexto-costo`. También puedes probar `/guardia`, `/secretos` o `/costo`.

Si al instalar dice `userConfig options not yet set`, no pasa nada: cada mod usa sus valores por defecto hasta que los cambies.

## Problemas comunes · Troubleshooting

| Lo que ves | Qué hacer |
| --- | --- |
| `claude: command not found` | Instala Claude Code: https://docs.claude.com/en/docs/claude-code/setup |
| `/plugin install` no reconoce `--marketplace`, o los mods no hacen nada | Tu Claude Code es viejo. Corre `claude update`, cierra y abre Claude Code. |
| *"command is not available"* en la app de escritorio | Instala desde la terminal (opción 1 o 2). |
| `Marketplace file not found` | El nombre del repo está mal escrito: es `Vincitorecode/mods-equipo`. |
| `Plugin "…" not found in marketplace "mods-equipo"` | El nombre del mod está mal escrito: `guardia-produccion`, `detector-secretos`, `contexto-costo` (sin acentos). |
| Error de `git` o de clonado | Instala git (macOS: `xcode-select --install`; Windows: `winget install Git.Git`) y revisa que puedas abrir github.com. |
| Error que menciona *policy*, `allowManagedModsOnly` o `strictKnownMarketplaces` | Tu organización restringe los mods o los marketplaces. Pide al admin que agregue `Vincitorecode/mods-equipo` o que los distribuya como mods administrados. |
| Se instalaron pero no veo nada | Abre una sesión nueva o usa `/reload-plugins`. Revisa en `/plugin` → *Installed* que estén activados. |
| No me llega la versión nueva | Vuelve a correr el instalador, o `claude plugin marketplace update mods-equipo` y luego `claude plugin update <mod>@mods-equipo`. |

Si nada de esto lo resuelve, abre un *issue* con la salida de `claude --version` y el error completo.

## Actualizar, desactivar o desinstalar

- **Actualizar:** vuelve a correr el instalador, o `claude plugin update guardia-produccion@mods-equipo` (igual para los otros) y luego `/reload-plugins` en la sesión abierta.
- **Desactivar uno:** `/plugin` → pestaña *Installed* → desactívalo.
- **Desinstalar:** `claude plugin uninstall guardia-produccion@mods-equipo`.
- **Desactivar todos por una sesión:** `claude --safe-mode`.

## Configuración

Cada mod se configura en `/plugin` → *Installed* → el mod → configurar. Todos tienen **Idioma** (`auto`, `es`, `en`). Con `auto` usa el idioma de Claude Code (ajuste `language`) o el de tu sistema.

---

## guardia-produccion

Antes de que Claude ejecute un comando de Bash (o de PowerShell en Windows), lo revisa. Si es riesgoso, aparece el diálogo de Claude Code con el comando, el motivo y dos opciones: **Cancelar** (predeterminado) o **Ejecutar de todas formas**. Funciona en cualquier modo de permisos, **incluso con auto-aceptar activado**, que es justo cuando más se necesita.

Detiene, entre otros:

- **Infraestructura:** `terraform apply/destroy`, `pulumi up/destroy`, `cdk deploy`
- **Kubernetes:** `kubectl delete/drain`, `helm uninstall/rollback`, y **cualquier cambio** (`apply`, `scale`, `rollout`, `exec`…) si el contexto de kubectl es de producción
- **Git:** `push --force`, push a una **rama protegida** (también `git push` sin rama estando en `main`), borrar ramas remotas, `push --mirror`, `reset --hard`, `clean -f`, `branch -D`, `checkout -- .`, `restore .`, `stash drop`
- **Bases de datos** (vía `psql`, `mysql`, `mongosh`, `redis-cli`…): `DROP`, `TRUNCATE`, `DELETE`/`UPDATE` sin `WHERE`, `FLUSHALL`
- **Migraciones:** Prisma, Rails, Django, Laravel, Alembic, Knex, Sequelize, TypeORM, Flyway, Liquibase, Ecto, Drizzle, Supabase, goose, dbmate
- **Nube:** borrados en `aws`, `gcloud`, `az`, `doctl`, `gsutil`, Heroku, Fly, Serverless, Vercel, Firebase
- **Docker:** `volume rm`, `compose down -v`, `system prune`
- **Despliegues y publicaciones:** `vercel --prod`, `firebase deploy`, `fly deploy`, `npm publish/unpublish`, `gh repo delete`…
- **Señales de producción** en el comando: `--env production`, `--stage prod`, `NODE_ENV=production`… junto a un verbo como deploy, migrate o delete
- **Archivos:** `rm -r` sobre cualquier cosa que no sea `node_modules`, `dist`, `build`, `.next`, `coverage`, `/tmp/…`, etc.; `find -delete`, `xargs rm -rf`, `Remove-Item -Recurse`

También revisa lo que va dentro de `bash -c "…"`, `eval`, `ssh servidor "…"` y `$(…)`. **No** se detiene por texto: mensajes de commit, `echo "…"`, heredocs que escriben un archivo, `--help` ni `--dry-run`.

Si cancelas, Claude recibe el motivo y la instrucción de no reintentar ni buscar otra vía, sino preguntarte.

**Interfaz:**

- Línea de estado: `📡 Guardia activa · ⚓ k8s: dev-cluster · 2 detenidos (1 cancelado) · /guardia`. Si tu contexto de kubectl es de producción lo marca: `🔥 k8s PROD: prod-mx`.
- **`/guardia`** abre un panel con el estado, el historial de comandos detenidos en la sesión con lo que decidiste, y la lista de lo que vigila.

**Configuración:**

| Opción | Por defecto | Para qué |
| --- | --- | --- |
| Patrón de producción | `prod\|production\|prd\|live` | Regex que reconoce producción en contextos de kubectl y banderas |
| Ramas protegidas | `main\|master` | Regex de ramas a las que no se hace push sin confirmar, ej. `main\|develop\|release/.*` |
| Comandos extra a vigilar | — | Regex separadas por `;;`, ej. `./scripts/deploy.sh;;make release` |
| Comandos que nunca se detienen | — | Para tus falsos positivos, ej. `rm -rf \./generated;;./deploy-staging.sh` |
| Categorías apagadas | — | Separadas por comas: `infraestructura, kubernetes, git, bd, migracion, nube, despliegue, publicacion, archivos, docker, produccion` |
| Sin nadie a quien preguntar | `bloquear` | En `claude -p` o CI: `bloquear` (más seguro) o `permitir` (ejecuta y lo anota) |

## detector-secretos

Revisa **antes** de que pase:

- Lo que Claude escribe con Write, Edit y NotebookEdit.
- Lo que Claude escribe a un archivo desde la shell (`> archivo`, `tee`, heredocs, `Set-Content`).
- Lo que va a entrar en un `git commit` (los cambios en stage, y los modificados si usa `-a`). También avisa si un archivo `.env` está a punto de entrar al historial.

Detecta llaves privadas, llaves de AWS y Azure, tokens de GitHub, GitLab, Slack, npm, PyPI, Hugging Face, DigitalOcean, Shopify, Linear, Doppler, Telegram, llaves de Anthropic, OpenAI, Google, Stripe (live), Twilio, SendGrid, Mailgun, webhooks de Slack y Discord, JWTs, cadenas de conexión y URLs con contraseña, y asignaciones como `password = "..."`, `apiKey: "..."` **o sin comillas** (`DB_PASSWORD=...` en `.env`, YAML o `.properties`).

Ignora placeholders (`changeme`, `your_api_key`, `${VAR}`, `${{ secrets.X }}`, `xxx`…), lecturas de entorno (`process.env`, `os.environ`, `getenv(...)`) y variables de prueba (`testPassword`, `mockToken`).

Lo que encuentra se muestra **enmascarado** (`AKIA…LQ (20)`), nunca completo.

**¿Un falso positivo?** Agrega el comentario `secretos:permitir` (o `gitleaks:allow`) en esa línea.

**Interfaz:**

- Línea de estado: `🥷 Secretos: preguntar · 1 detectado (1 bloqueado) · /secretos`.
- **`/secretos`** abre un panel con el modo, los archivos permitidos, cuántas escrituras y commits revisó, y el historial de lo detectado (enmascarado).

**Configuración:**

| Opción | Por defecto | Para qué |
| --- | --- | --- |
| Qué hacer al encontrar un secreto | `preguntar` | `preguntar` o `bloquear` (lo impide sin preguntar) |
| Archivos donde sí se permiten secretos | `.env`, `.env.local`, `.env.development`, `.env.test` | Regex sobre la ruta |
| Tipos que no se revisan | — | Ids separados por comas: `llave-privada, aws-access-key, aws-secret-key, github, gitlab, anthropic, openai, google, google-service-account, azure-storage, slack, slack-webhook, discord-webhook, telegram, stripe, twilio, sendgrid, mailgun, npm, pypi, huggingface, digitalocean, shopify, linear, doppler, jwt, cadena-conexion, asignacion` |

> Es una red de seguridad, no un reemplazo de herramientas como gitleaks o el secret scanning de GitHub. Usa ambos.

## contexto-costo

**Bajo cada llamada** a una herramienta, una línea con el contexto del agente que la hizo en ese momento:

```
Bash(npm test)
  ⎿ █████░░░░░ 47% contexto · quedan 106k
Grep("TODO")
  ⎿ ███████░░░ 75% contexto · quedan 50k · Explore: buscar archivos
```

El color pasa de verde a amarillo a rojo según el umbral. Si la llamada la hizo un subagente, dice cuál y mide **su** contexto, no el del agente principal.

Además, una línea sobre el prompt que se actualiza al terminar cada turno:

```
◕ Contexto 78% 156k/200k ▂▃▄▅▆ · Sesión $2.34 · último turno $0.41 · límite 5h 37%
```

- Al pasar el umbral aparece `→ /compact`, con un aviso al cruzarlo (80% por defecto) y otro al 95%.
- Las partes de la línea se ocultan si la terminal es angosta.
- Botón **Detalle** (tecla `c` con la banda enfocada) y **`/costo`**: barra de contexto, costo de la sesión y promedio por turno, límites de uso con su hora de reinicio, y una tabla por turno con el más caro resaltado.

**Dónde se ve:** terminal, app de escritorio (pestaña Code), VS Code y app móvil. En el navegador (claude.ai/code) no hay banda ni panel, pero `/costo` responde con el mismo resumen en texto.

Los costos son los mismos que calcula `/cost` (equivalente en precio de API). Con un plan de suscripción no se te cobran así, pero sirven para comparar sesiones y detectar turnos caros.

**Configuración:** *Alertar al llegar a este % de contexto* (80), *Mostrar la barra de contexto bajo cada llamada* y *Mostrar la banda sobre el prompt* (si la apagas, `/costo` sigue funcionando).

---

## Para quien mantenga los mods

```
.claude-plugin/marketplace.json     ← lista los 3 mods
instalar.sh / instalar.ps1          ← instaladores de un comando
plugins/
  guardia-produccion/
    .claude-plugin/plugin.json      ← manifiesto y opciones
    hooks/hooks.json                ← apunta a register.tsx
    hooks/register.tsx              ← los hooks y la interfaz
    hooks/reglas.ts                 ← las reglas (funciones puras)
    hooks/idioma.ts                 ← español / inglés (igual en los 3 mods)
    tests/guardia.test.ts
  detector-secretos/                ← misma estructura; patrones en hooks/patrones.ts
  contexto-costo/                   ← la UI está en hooks/register.tsx; el estado en types/index.d.ts
```

**Agregar una regla o un patrón:** edita `reglas.ts` (guardia) o `patrones.ts` (secretos), agrega un caso a su test y corre:

```bash
claude plugin validate plugins/guardia-produccion   # revisa manifiesto, hooks y llamadas
claude plugin test plugins/guardia-produccion       # corre los tests
```

Las pruebas corren solas en GitHub Actions en cada push.

**Probar cambios sin instalar:** `claude --plugin-dir ./plugins/guardia-produccion` carga el mod desde la carpeta y se recarga al guardar.

**Publicar una versión:** sube el campo `version` en el `plugin.json` del mod (si no sube, `claude plugin update` no la ve), anótala en `CHANGELOG.md`, haz commit y push.

**Revisar qué puede hacer cada mod:** `claude plugin validate` lista los eventos que usa (`hooks:`) y lo que pide a Claude Code (`calls:`). Ninguno hace peticiones de red. La guardia ejecuta `kubectl config current-context` y `git rev-parse --abbrev-ref HEAD`, y el detector ejecuta `git diff`, todos solo para leer.

Licencia MIT.

---

<a id="english"></a>

# English

Three Claude Code mods that make it safer and more transparent. Install only the ones you want. The interface is in Spanish or English (option **Idioma · Language**: `auto`, `es`, `en`; `auto` follows Claude Code's `language` setting or your system locale).

| Mod | What it does |
| --- | --- |
| **guardia-produccion** | Stops risky commands (deploys, migrations, deletes, force push, kubectl on prod, push to protected branches…) and asks before running them, even in auto-accept mode. `/guardia` shows what it watches and what it stopped. |
| **detector-secretos** | Stops Claude before it writes or commits API keys, tokens, private keys or passwords (quoted or in `.env`/YAML), masked in the dialog. `/secretos` shows the history. Add `secretos:permitir` or `gitleaks:allow` to a line to allow it. |
| **contexto-costo** | Context bar under every tool call (main agent and subagents), a band above the prompt with context, cost and usage limits, and `/costo` with per-turn details. |

### Install

You need **Claude Code 2.1.287 or newer** (`claude --version`, update with `claude update`) and **git**. In a terminal:

```bash
# macOS / Linux / WSL
curl -fsSL https://raw.githubusercontent.com/Vincitorecode/mods-equipo/main/instalar.sh | bash
```

```powershell
# Windows
irm https://raw.githubusercontent.com/Vincitorecode/mods-equipo/main/instalar.ps1 | iex
```

Or by hand:

```bash
claude plugin marketplace add Vincitorecode/mods-equipo
claude plugin install guardia-produccion@mods-equipo
claude plugin install detector-secretos@mods-equipo
claude plugin install contexto-costo@mods-equipo
```

Then start a new Claude Code session (or run `/reload-plugins`). `/plugin install` doesn't work inside the desktop app's Code tab: install from a terminal, and the mods load in the app too. See the [troubleshooting table](#problemas-comunes--troubleshooting) above for common errors.

Configure each mod in `/plugin` → *Installed* → the mod. MIT licensed.
