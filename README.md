# Mods de Claude Code para el equipo

Tres mods que hacen a Claude Code más seguro y más transparente en el día a día. Se instalan por separado, así que cada quien elige los que quiere.

| Mod | Qué hace | Cuándo lo ves |
| --- | --- | --- |
| **guardia-produccion** | Detiene comandos riesgosos y te pregunta antes de ejecutarlos | Solo cuando Claude intenta algo peligroso |
| **detector-secretos** | Evita que Claude escriba o commitee API keys, tokens o contraseñas | Solo cuando encuentra un posible secreto |
| **contexto-costo** | Muestra el uso de contexto, el costo y tus límites de uso | Siempre, en una línea sobre el prompt |

## Requisitos

- Claude Code **v2.1.287 o más reciente** en la terminal (revisa con `claude --version`), o la app de escritorio **v2.1.286+** (pestaña Code, `/status`).
- Los mods vienen activados por defecto. Si tu organización usa `allowManagedModsOnly`, pídele al admin que los distribuya como mods administrados.

## Instalación

En una sesión de Claude Code en la terminal, instala los que quieras:

```
/plugin install guardia-produccion --marketplace <owner>/<repo>
/plugin install detector-secretos --marketplace <owner>/<repo>
/plugin install contexto-costo --marketplace <owner>/<repo>
```

La primera vez te pregunta si quieres agregar el marketplace: responde `y` y elige el scope **user** (para que funcione en todos tus proyectos).

Si el repo no está en GitHub (GitLab, Bitbucket, servidor interno), agrégalo con su URL de git y después instala:

```bash
claude plugin marketplace add https://gitlab.tuempresa.com/equipo/mods-equipo.git
claude plugin install guardia-produccion@mods-equipo
claude plugin install detector-secretos@mods-equipo
claude plugin install contexto-costo@mods-equipo
```

Si al instalar dice que hay opciones sin configurar, no pasa nada: cada mod usa sus valores por defecto hasta que los cambies.

Para confirmar que cargaron, escribe `/plugin` en Claude Code: debajo de las pestañas verás algo como `3 mods active · guardia-produccion, detector-secretos, contexto-costo`.

## Actualizar, desactivar o desinstalar

- **Actualizar:** `claude plugin update guardia-produccion@mods-equipo` (igual para los otros) y luego `/reload-plugins` en la sesión abierta.
- **Desactivar uno:** `/plugin` → pestaña *Installed* → desactívalo.
- **Desactivar todos por una sesión:** `claude --safe-mode`.

---

## guardia-produccion

Antes de que Claude ejecute un comando de Bash, lo revisa. Si es riesgoso, aparece el diálogo de Claude Code con el comando, el motivo y dos opciones: **Cancelar** (predeterminado) o **Ejecutar de todas formas**. Funciona en cualquier modo de permisos, **incluso con auto-aceptar activado**, que es justo cuando más se necesita.

Detiene, entre otros:

- **Infraestructura:** `terraform apply/destroy`, `pulumi up/destroy`, `cdk deploy`
- **Kubernetes:** `kubectl delete/drain`, `helm uninstall/rollback`, y **cualquier cambio** (`apply`, `scale`, `rollout`, `exec`…) si el contexto actual de kubectl es de producción
- **Git:** `push --force`, push directo a `main`/`master`, `reset --hard`, `clean -f`
- **Bases de datos** (vía `psql`, `mysql`, `mongosh`, `redis-cli`…): `DROP`, `TRUNCATE`, `DELETE`/`UPDATE` sin `WHERE`, `FLUSHALL`
- **Migraciones:** Prisma, Rails, Django, Alembic, Knex, Sequelize, TypeORM, Flyway, Liquibase
- **Nube:** borrados en `aws`, `gcloud`, `az`; `aws s3 rm --recursive`
- **Despliegues y publicaciones:** `vercel --prod`, `firebase deploy`, `fly deploy`, `serverless deploy`, `npm publish`…
- **Señales de producción** en el comando: `--env production`, `--stage prod`, `NODE_ENV=production`… junto a un verbo como deploy, migrate o delete
- `rm -r` sobre cualquier cosa que no sea `node_modules`, `dist`, `build`, `.next`, `coverage`, etc.

Si cancelas, Claude recibe el motivo y la instrucción de no reintentar ni buscar otra vía, sino preguntarte.

**Configuración** (`/plugin` → el mod → configurar):

- *Patrón de producción*: regex para reconocer producción. Por defecto `prod|production|prd|live`.
- *Comandos extra a vigilar*: regex separadas por `;;`, por ejemplo `./scripts/deploy.sh;;make release`.

## detector-secretos

Revisa **antes** de que pase:

- Lo que Claude escribe con Write, Edit y NotebookEdit.
- Lo que va a entrar en un `git commit` (los cambios en stage, y los modificados si usa `-a`). También avisa si un archivo `.env` está a punto de entrar al historial.

Detecta llaves privadas, llaves de AWS, tokens de GitHub, GitLab, Slack, npm, llaves de Anthropic, OpenAI, Google, Stripe (live), Twilio, SendGrid, JWTs, cadenas de conexión con contraseña y asignaciones como `password = "..."` o `apiKey: "..."`. Ignora placeholders (`changeme`, `your_api_key`, `${VAR}`, `xxx`…) y lecturas de entorno (`process.env`, `os.environ`).

Lo que encuentra se muestra **enmascarado** (`AKIA…LQ (20 caracteres)`), nunca completo.

**Configuración:**

- *Qué hacer al encontrar un secreto*: `preguntar` (por defecto) o `bloquear` (lo impide sin preguntar).
- *Archivos donde sí se permiten secretos*: regex sobre la ruta. Por defecto `.env`, `.env.local`, `.env.development` y `.env.test` (no `.env.example`).

> Es una red de seguridad, no un reemplazo de herramientas como gitleaks o el secret scanning de GitHub. Usa ambos.

## contexto-costo

Una línea sobre el prompt que se actualiza al terminar cada turno:

```
◕ Contexto 78% 156k/200k ▂▃▄▅▆ · Sesión $2.34 · último turno $0.41 · límite 5h 37%
```

- El color pasa de verde a amarillo a rojo según te acercas al umbral, y al pasarlo aparece `→ /compact`.
- Un aviso al cruzar el umbral (80% por defecto) y otro al 95%.
- Las partes de la línea se ocultan si la terminal es angosta.
- **`/costo`** abre un panel con el detalle: barra de contexto, costo de la sesión y promedio por turno, límites de uso con su hora de reinicio, y una tabla por turno (contexto, costo, herramientas usadas) con el turno más caro resaltado.

Los costos son los mismos que calcula `/cost` (equivalente en precio de API). Si usas un plan de suscripción no se te cobran así, pero sirven para comparar sesiones y detectar turnos caros.

**Configuración:** *Alertar al llegar a este % de contexto* (por defecto 80) y *Mostrar la banda sobre el prompt* (si la apagas, `/costo` sigue funcionando).

---

## Para quien mantenga los mods

```
.claude-plugin/marketplace.json     ← lista los 3 mods
plugins/
  guardia-produccion/
    .claude-plugin/plugin.json      ← manifiesto y opciones
    hooks/hooks.json                ← apunta a register.ts
    hooks/register.ts               ← los hooks
    hooks/reglas.ts                 ← las reglas (funciones puras)
    tests/guardia.test.ts
  detector-secretos/                ← misma estructura; patrones en hooks/patrones.ts
  contexto-costo/                   ← la UI está en hooks/register.tsx; el estado en types/index.d.ts
```

**Agregar una regla o un patrón:** edita `reglas.ts` (guardia) o `patrones.ts` (secretos), agrega un caso a su test y corre:

```bash
claude plugin validate plugins/guardia-produccion   # revisa manifiesto, hooks y llamadas
claude plugin test plugins/guardia-produccion       # corre los tests
```

**Probar cambios sin instalar:** `claude --plugin-dir ./plugins/guardia-produccion` carga el mod desde la carpeta y se recarga al guardar.

**Publicar una versión:** sube el campo `version` en el `plugin.json` del mod, haz commit y push. El equipo la recibe con `claude plugin update`.

**Revisar qué puede hacer cada mod:** `claude plugin validate` lista los eventos que usa (`hooks:`) y lo que pide a Claude Code (`calls:`). Ninguno hace peticiones de red. La guardia ejecuta `kubectl config current-context` y el detector ejecuta `git diff`, ambos solo para leer.
