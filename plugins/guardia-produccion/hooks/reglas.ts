// Reglas de la Guardia de producción.
//
// Funciones puras (sin `$`): reciben el texto de un comando de shell y
// devuelven la lista de riesgos encontrados. Así se pueden probar sin Claude Code.
//
// El comando se lee como lo leería la shell: se parte en &&, ||, ;, |, & y saltos
// de línea fuera de comillas, y el texto entre comillas con espacios (mensajes de
// commit, echo "...") no cuenta como comando. Lo que va dentro de `bash -c "..."`,
// `eval`, `ssh host "..."`, `$(...)` y heredocs a una shell sí se revisa.
//
// Para agregar una regla: añade una entrada a REGLAS_SEGMENTO (o REGLAS_BD) y un
// caso a tests/guardia.test.ts. Cada equipo puede sumar las suyas con la opción
// "Comandos extra a vigilar" sin tocar el código.

export type Idioma = 'es' | 'en'
export type Texto = Readonly<Record<Idioma, string>>

export type Categoria =
  | 'infraestructura'
  | 'kubernetes'
  | 'git'
  | 'bd'
  | 'migracion'
  | 'nube'
  | 'despliegue'
  | 'publicacion'
  | 'archivos'
  | 'docker'
  | 'produccion'
  | 'equipo'

export const CATEGORIAS: readonly Categoria[] = [
  'infraestructura',
  'kubernetes',
  'git',
  'bd',
  'migracion',
  'nube',
  'despliegue',
  'publicacion',
  'archivos',
  'docker',
  'produccion',
  'equipo',
]

export const NOMBRE_CATEGORIA: Record<Categoria, Texto> = {
  infraestructura: { es: 'Infraestructura', en: 'Infrastructure' },
  kubernetes: { es: 'Kubernetes', en: 'Kubernetes' },
  git: { es: 'Git', en: 'Git' },
  bd: { es: 'Base de datos', en: 'Database' },
  migracion: { es: 'Migración', en: 'Migration' },
  nube: { es: 'Nube', en: 'Cloud' },
  despliegue: { es: 'Despliegue', en: 'Deploy' },
  publicacion: { es: 'Publicación', en: 'Publish' },
  archivos: { es: 'Archivos', en: 'Files' },
  docker: { es: 'Docker', en: 'Docker' },
  produccion: { es: 'Producción', en: 'Production' },
  equipo: { es: 'Regla del equipo', en: 'Team rule' },
}

export type Riesgo = {
  categoria: Categoria
  /** Qué haría el comando. */
  motivo: Texto
}

/** Lo que el equipo configuró en el plugin, ya compilado. */
export type Config = {
  /** Reconoce producción en contextos de kubectl y en banderas (--env prod). */
  prod: RegExp
  /** Ramas a las que no se hace push sin confirmar (main, master...). */
  ramas: RegExp
  /** Reglas extra del equipo. */
  extras: RegExp[]
  /** Partes de un comando que nunca se detienen. */
  permitidos: RegExp[]
  /** Categorías que el equipo apagó. */
  ignoradas: ReadonlySet<Categoria>
  /** La rama actual, cuando el comando hace push sin decir a cuál (la averigua el hook). */
  ramaActual?: string
}

type Regla = { categoria: Categoria; motivo: Texto; patron: RegExp }

const REGLAS_SEGMENTO: Regla[] = [
  // Infraestructura
  { categoria: 'infraestructura', motivo: { es: 'terraform apply / destroy cambia infraestructura real', en: 'terraform apply / destroy changes real infrastructure' }, patron: /\b(terraform|tofu|terragrunt)\b.*\b(apply|destroy|run-all\s+(apply|destroy))\b/ },
  { categoria: 'infraestructura', motivo: { es: 'pulumi up / destroy cambia infraestructura real', en: 'pulumi up / destroy changes real infrastructure' }, patron: /\bpulumi\b.*\b(up|destroy|update)\b/ },
  { categoria: 'infraestructura', motivo: { es: 'cdk / sam deploy o destroy cambia infraestructura de AWS', en: 'cdk / sam deploy or destroy changes AWS infrastructure' }, patron: /\b(cdk|sam)\s+(deploy|destroy)\b/ },

  // Git (el resto de push se analiza aparte, palabra por palabra)
  { categoria: 'git', motivo: { es: 'git reset --hard descarta cambios sin commit', en: 'git reset --hard discards uncommitted changes' }, patron: /\bgit(\s+-[cC]\s+\S+)*\s+reset\b.*\s--hard\b/ },
  { categoria: 'git', motivo: { es: 'git clean -f borra archivos no versionados', en: 'git clean -f deletes untracked files' }, patron: /\bgit(\s+-[cC]\s+\S+)*\s+clean\b.*\s-[a-zA-Z]*f/ },
  { categoria: 'git', motivo: { es: 'git checkout / restore descarta los cambios sin commit', en: 'git checkout / restore discards uncommitted changes' }, patron: /\bgit(\s+-[cC]\s+\S+)*\s+(checkout(\s+\S+)?\s+--\s+\.|checkout\s+\.|restore(?!.*--staged)(\s+-\S+)*\s+\.)(\s|$)/ },
  { categoria: 'git', motivo: { es: 'git branch -D borra una rama aunque no esté fusionada', en: 'git branch -D deletes a branch even if unmerged' }, patron: /\bgit(\s+-[cC]\s+\S+)*\s+branch\b.*(\s-[a-zA-Z]*D\b|\s--delete\b.*\s(--force|-f)\b)/ },
  { categoria: 'git', motivo: { es: 'git stash drop / clear borra cambios guardados', en: 'git stash drop / clear deletes saved changes' }, patron: /\bgit(\s+-[cC]\s+\S+)*\s+stash\s+(drop|clear)\b/ },
  { categoria: 'git', motivo: { es: 'reescribe todo el historial del repositorio', en: 'rewrites the whole repository history' }, patron: /\bgit(\s+-[cC]\s+\S+)*\s+(filter-branch|filter-repo)\b/ },

  // Migraciones
  { categoria: 'migracion', motivo: { es: 'prisma migrate deploy / reset aplica o reinicia el esquema', en: 'prisma migrate deploy / reset applies or resets the schema' }, patron: /\bprisma\s+migrate\s+(deploy|reset)\b/ },
  { categoria: 'migracion', motivo: { es: 'prisma db push con pérdida de datos', en: 'prisma db push with data loss' }, patron: /\bprisma\s+db\s+push\b.*(--accept-data-loss|--force-reset)/ },
  { categoria: 'migracion', motivo: { es: 'rails / rake db: migrate, drop, reset o rollback', en: 'rails / rake db: migrate, drop, reset or rollback' }, patron: /\b(rails|rake)\s+db:(migrate|drop|reset|rollback|schema:load|purge)\b/ },
  { categoria: 'migracion', motivo: { es: 'Django migrate / flush', en: 'Django migrate / flush' }, patron: /\bmanage\.py\s+(migrate|flush)\b/ },
  { categoria: 'migracion', motivo: { es: 'alembic upgrade / downgrade', en: 'alembic upgrade / downgrade' }, patron: /\balembic\s+(upgrade|downgrade)\b/ },
  { categoria: 'migracion', motivo: { es: 'knex / sequelize / typeorm ejecuta migraciones', en: 'knex / sequelize / typeorm runs migrations' }, patron: /\b(knex\s+migrate:(latest|rollback|up|down)|sequelize(-cli)?\s+db:(migrate|drop)|typeorm\b.*migration:(run|revert)|schema:drop)\b/ },
  { categoria: 'migracion', motivo: { es: 'flyway / liquibase cambia el esquema', en: 'flyway / liquibase changes the schema' }, patron: /\b(flyway\b.*\b(migrate|clean|undo)|liquibase\b.*\b(update|rollback|drop-all))\b/ },
  { categoria: 'migracion', motivo: { es: 'Laravel migrate / db:wipe cambia o borra la base', en: 'Laravel migrate / db:wipe changes or wipes the database' }, patron: /\bartisan\s+(migrate(:fresh|:reset|:rollback|:refresh)?|db:wipe)\b/ },
  { categoria: 'migracion', motivo: { es: 'Ecto migrate / drop / reset', en: 'Ecto migrate / drop / reset' }, patron: /\bmix\s+ecto\.(migrate|rollback|drop|reset)\b/ },
  { categoria: 'migracion', motivo: { es: 'drizzle-kit push / migrate cambia el esquema', en: 'drizzle-kit push / migrate changes the schema' }, patron: /\bdrizzle-kit\s+(push|migrate|drop)\b/ },
  { categoria: 'migracion', motivo: { es: 'supabase db reset / push cambia la base', en: 'supabase db reset / push changes the database' }, patron: /\bsupabase\s+db\s+(reset|push)\b/ },
  { categoria: 'migracion', motivo: { es: 'goose / dbmate / migrate aplica o revierte migraciones', en: 'goose / dbmate / migrate applies or reverts migrations' }, patron: /\b(goose\b.*\b(up|down|reset|redo)|dbmate\s+(up|down|drop|rollback)|migrate\b.*\s-(path|database|source)\b.*\b(up|down|drop|force))\b/ },

  // Nube
  { categoria: 'nube', motivo: { es: 'aws: borra o termina recursos', en: 'aws: deletes or terminates resources' }, patron: /\baws\s+\S+\s+(delete|terminate|remove|rb|purge|deregister)[\w-]*/ },
  { categoria: 'nube', motivo: { es: 'aws s3 rm --recursive borra muchos objetos', en: 'aws s3 rm --recursive deletes many objects' }, patron: /\baws\s+s3\s+rm\b.*--recursive/ },
  { categoria: 'nube', motivo: { es: 'gcloud / az / doctl: borra recursos', en: 'gcloud / az / doctl: deletes resources' }, patron: /\b(gcloud|az|doctl)\b.*\bdelete\b/ },
  { categoria: 'nube', motivo: { es: 'borra objetos de Cloud Storage', en: 'deletes Cloud Storage objects' }, patron: /\b(gsutil\b.*\brm\b.*\s-[a-zA-Z]*r|gcloud\s+storage\s+rm\b.*(-r|--recursive))/ },
  { categoria: 'nube', motivo: { es: 'borra una app o base en la plataforma', en: 'deletes an app or database on the platform' }, patron: /\b(heroku\b.*\b(apps:destroy|pg:reset)\b|fly(ctl)?\s+(apps\s+destroy|destroy)\b|(serverless|sls)\s+remove\b|vercel\s+(remove|rm)\b|firebase\s+\S*:delete\b)/ },

  // Docker
  { categoria: 'docker', motivo: { es: 'borra volúmenes de Docker (y sus datos)', en: 'deletes Docker volumes (and their data)' }, patron: /\bdocker\s+(volume\s+(rm|prune)\b|system\s+prune\b.*(--volumes|-[a-zA-Z]*a))|\bdocker(-|\s+)compose\b.*\bdown\b.*(\s-v\b|--volumes\b)/ },

  // Despliegues y publicaciones
  { categoria: 'despliegue', motivo: { es: 'despliegue a producción', en: 'production deploy' }, patron: /\b(vercel\b.*--prod\b|netlify\s+deploy\b.*--prod\b|firebase\s+deploy\b|fly(ctl)?\s+deploy\b|eb\s+deploy\b|(serverless|sls)\s+deploy\b|heroku\b.*\b(releases:rollback|ps:scale)\b)/ },
  { categoria: 'publicacion', motivo: { es: 'publica o retira un paquete del registro público', en: 'publishes or removes a package from the public registry' }, patron: /\b(npm|yarn|pnpm|bun)\s+(publish|unpublish)\b|\btwine\s+upload\b|\bcargo\s+publish\b|\bgem\s+push\b|\bpoetry\s+publish\b|\bdotnet\s+nuget\s+push\b/ },
  { categoria: 'publicacion', motivo: { es: 'borra un repositorio o release de GitHub', en: 'deletes a GitHub repository or release' }, patron: /\bgh\s+(repo|release)\s+delete\b/ },

  // Archivos
  { categoria: 'archivos', motivo: { es: 'find borra todos los archivos que encuentra', en: 'find deletes every file it matches' }, patron: /\bfind\b.*\s(-delete\b|-exec(dir)?\s+rm\b)/ },
  { categoria: 'archivos', motivo: { es: 'borra carpetas de forma permanente (PowerShell / cmd)', en: 'permanently deletes folders (PowerShell / cmd)' }, patron: /\b(Remove-Item|ri|rmdir|rd|del)\b.*\s-Recurse\b|\b(rmdir|rd)\s+\/s\b/i },
  { categoria: 'archivos', motivo: { es: 'escribe directo sobre un disco o lo formatea', en: 'writes straight to a disk or formats it' }, patron: /\bdd\b.*\bof=\/dev\/|\bmkfs(\.\w+)?\s|\bdiskutil\s+(erase\w*|partitionDisk)\b/ },
]

/** Reglas SQL / Mongo, evaluadas solo si el comando usa un cliente de base de datos. */
const REGLAS_BD: Regla[] = [
  { categoria: 'bd', motivo: { es: 'DROP elimina tablas, esquemas o bases completas', en: 'DROP removes whole tables, schemas or databases' }, patron: /\bdrop\s+(table|database|schema|index|view|collection)\b/i },
  { categoria: 'bd', motivo: { es: 'TRUNCATE vacía una tabla', en: 'TRUNCATE empties a table' }, patron: /\btruncate\b/i },
  { categoria: 'bd', motivo: { es: 'DELETE sin WHERE borra todas las filas', en: 'DELETE without WHERE removes every row' }, patron: /\bdelete\s+from\s+[\w."`[\]]+\s*(;|'|"|$)/im },
  { categoria: 'bd', motivo: { es: 'UPDATE sin WHERE modifica todas las filas', en: 'UPDATE without WHERE changes every row' }, patron: /\bupdate\s+[\w."`[\]]+\s+set\b(?![^;'"]*\bwhere\b)/i },
  { categoria: 'bd', motivo: { es: 'ALTER TABLE ... DROP elimina columnas', en: 'ALTER TABLE ... DROP removes columns' }, patron: /\balter\s+table\b[^;]*\bdrop\b/i },
  { categoria: 'bd', motivo: { es: 'Mongo: borra colecciones, bases o todos los documentos', en: 'Mongo: drops collections, databases or every document' }, patron: /\.(dropDatabase|drop)\s*\(\s*\)|\.deleteMany\s*\(\s*\{\s*\}\s*\)/ },
  { categoria: 'bd', motivo: { es: 'Redis FLUSHALL / FLUSHDB borra todas las llaves', en: 'Redis FLUSHALL / FLUSHDB deletes every key' }, patron: /\bflush(all|db)\b/i },
]

/** Clientes de base de datos: las reglas SQL solo aplican si el comando usa uno. */
const CLIENTE_BD =
  /\b(psql|pgcli|mysql|mariadb|sqlcmd|sqlite3|clickhouse(-client)?|cockroach|mongosh|mongo|redis-cli|bq\s+query|prisma\s+db\s+execute|supabase\s+db|turso\s+db\s+shell|wrangler\s+d1\s+execute)\b/i

/** Programas que solo leen o imprimen: lo que lleven como argumento no se ejecuta. */
const SOLO_LECTURA = new Set(['echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'cat', 'bat', 'less', 'more', 'head', 'tail', 'man', 'which', 'type', 'wc', 'whatis', 'tldr'])

/** Banderas que piden ayuda o un simulacro: el comando no cambia nada. */
const SOLO_AYUDA = /^(--help|--dry-run(=.*)?|--dryrun|--what-if|-WhatIf)$/i

/** Carpetas que es normal borrar con rm -rf: no se pide confirmación. */
const CARPETA_DESECHABLE = new Set([
  'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.parcel-cache', '.vite',
  'coverage', '.nyc_output', 'target', 'tmp', '.tmp', '.pytest_cache', '__pycache__', '.mypy_cache', '.ruff_cache',
  '.venv', 'venv', '.tox', '.gradle', '.dart_tool', 'DerivedData', '.angular', 'storybook-static',
])

/** Subcomandos de kubectl / helm que cambian el clúster (se vigilan si el contexto es de producción). */
const KUBECTL_MUTA = new Set(['apply', 'create', 'delete', 'patch', 'edit', 'replace', 'scale', 'rollout', 'drain', 'cordon', 'uncordon', 'taint', 'set', 'label', 'annotate', 'exec', 'run', 'expose', 'autoscale'])
const HELM_MUTA = new Set(['install', 'upgrade', 'uninstall', 'delete', 'rollback'])

/** Banderas globales de kubectl / helm que llevan un valor aparte (`-n prod`). */
const BANDERA_CON_VALOR = /^(-n|--namespace|--context|--kube-context|--kubeconfig|-s|--server|--cluster|--user|--token|--as)$/

/** Verbos que, junto a una señal de producción en el mismo comando, merecen confirmación. */
const VERBO_ESCRITURA =
  /\b(deploy|apply|migrate|migration|delete|destroy|drop|push|restart|scale|release|rollback|publish|upgrade|truncate|seed|reset)\b/i

export const PATRON_PROD_DEFECTO = 'prod|production|prd|live'
export const RAMAS_DEFECTO = 'main|master'

// ---- Configuración ----

/** Compila una expresión regular del usuario; si es inválida usa la de respaldo. */
export function compilar(fuente: string, respaldo: string): RegExp {
  try {
    return new RegExp(fuente.trim() === '' ? respaldo : fuente, 'i')
  } catch {
    return new RegExp(respaldo, 'i')
  }
}

/** Las ramas protegidas como regex de nombre completo: "main|release/.*" → /^(main|release\/.*)$/i. */
export function compilarRamas(fuente: string): RegExp {
  const r = compilar(fuente, RAMAS_DEFECTO)
  return new RegExp(`^(${r.source})$`, 'i')
}

/** Convierte "a;;b" en [/a/, /b/], ignorando las inválidas. */
export function compilarLista(fuente: string): RegExp[] {
  return fuente
    .split(';;')
    .map(s => s.trim())
    .filter(s => s !== '')
    .flatMap(s => {
      try {
        return [new RegExp(s, 'i')]
      } catch {
        return []
      }
    })
}

/** "archivos, git" → {archivos, git}. Acepta el id o el nombre en cualquier idioma. */
export function compilarCategorias(fuente: string): Set<Categoria> {
  const normal = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const pedidas = new Set(fuente.split(/[,;]/).map(normal).filter(s => s !== ''))
  return new Set(CATEGORIAS.filter(c => pedidas.has(c) || pedidas.has(normal(NOMBRE_CATEGORIA[c].es)) || pedidas.has(normal(NOMBRE_CATEGORIA[c].en))))
}

export function configPorDefecto(): Config {
  return { prod: compilar('', PATRON_PROD_DEFECTO), ramas: compilarRamas(''), extras: [], permitidos: [], ignoradas: new Set() }
}

// ---- Lectura del comando ----

/** Divide un comando en partes por &&, ||, ;, |, & y saltos de línea, sin cortar dentro de comillas. */
export function segmentos(comando: string): string[] {
  const partes: string[] = []
  let actual = ''
  let comilla: '"' | "'" | null = null
  for (let i = 0; i < comando.length; i++) {
    const c = comando[i]!
    if (comilla !== null) {
      actual += c
      if (c === '\\' && comilla === '"' && i + 1 < comando.length) actual += comando[++i]
      else if (c === comilla) comilla = null
      continue
    }
    if (c === '\\' && i + 1 < comando.length) {
      // Una línea partida con \ sigue siendo el mismo comando.
      actual += comando[i + 1] === '\n' ? ' ' : c + comando[i + 1]
      i++
      continue
    }
    if (c === '"' || c === "'") {
      comilla = c
      actual += c
      continue
    }
    // `2>&1` y `&>` son redirecciones, no separadores.
    if (c === '&' && (comando[i - 1] === '>' || comando[i + 1] === '>')) {
      actual += c
      continue
    }
    if (c === ';' || c === '\n' || c === '|' || c === '&') {
      partes.push(actual)
      actual = ''
      if ((c === '&' || c === '|') && (comando[i + 1] === c || (c === '|' && comando[i + 1] === '&'))) i++
      continue
    }
    actual += c
  }
  partes.push(actual)
  return partes.map(s => s.trim()).filter(s => s !== '')
}

/** Las palabras de una parte del comando, sin comillas (`rm -rf "a b"` → rm, -rf, a b). */
export function palabras(segmento: string): string[] {
  const salida: string[] = []
  let actual: string | null = null
  let comilla: '"' | "'" | null = null
  for (let i = 0; i < segmento.length; i++) {
    const c = segmento[i]!
    if (comilla !== null) {
      if (c === comilla) comilla = null
      else if (c === '\\' && comilla === '"' && i + 1 < segmento.length) actual = (actual ?? '') + segmento[++i]
      else actual = (actual ?? '') + c
      continue
    }
    if (/\s/.test(c)) {
      if (actual !== null) salida.push(actual)
      actual = null
    } else if (c === '"' || c === "'") {
      comilla = c
      actual = actual ?? ''
    } else if (c === '\\' && i + 1 < segmento.length) {
      actual = (actual ?? '') + segmento[++i]
    } else {
      actual = (actual ?? '') + c
    }
  }
  if (actual !== null) salida.push(actual)
  return salida
}

/**
 * El texto que se compara con las reglas: lo entre comillas con espacios
 * (un mensaje, un echo) se vacía; una sola palabra entre comillas se queda.
 */
function enmascarar(segmento: string): string {
  return segmento.replace(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g, (_m, dobles?: string, simples?: string) => {
    const dentro = dobles ?? simples ?? ''
    return /\s/.test(dentro) ? '""' : dentro
  })
}

/** Quita sudo, VAR=valor y prefijos inofensivos del inicio de una parte. */
function limpiar(segmento: string): string {
  let s = segmento.replace(/^[({!\s]+/, '')
  for (;;) {
    const antes = s
    s = s
      .replace(/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*)\s+/, '')
      .replace(/^(sudo(\s+-[ugCDhpr]\s+\S+|\s+-\S+)*|doas|command|builtin|exec|env(\s+-\S+)*|nohup|nice(\s+-n\s*\S+)?|time|timeout\s+\S+|npx(\s+-y|\s+--yes)?|bunx|pnpm\s+(exec|dlx)|yarn(\s+dlx)?|pnpm|poetry\s+run|uv\s+run|pipenv\s+run|bundle\s+exec|python3?(\s+-m)?|\\)\s+/, '')
    if (s === antes) return s
  }
}

/** Separa los heredocs: el comando sin sus cuerpos y los cuerpos que van a una shell. */
function separarHeredocs(comando: string): { sin: string; aShell: string[] } {
  const lineas = comando.split('\n')
  const salida: string[] = []
  const aShell: string[] = []
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i]!
    salida.push(linea)
    const m = linea.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/)
    if (!m) continue
    const fin = m[2]!
    const cuerpo: string[] = []
    while (i + 1 < lineas.length && lineas[i + 1]!.trim() !== fin) cuerpo.push(lineas[++i]!)
    i++ // la línea que cierra
    if (/(^|[\s|;&(])(ba|z|da|k)?sh(\s|$)/.test(linea.slice(0, m.index))) aShell.push(cuerpo.join('\n'))
    // El cuerpo de un heredoc a psql sí cuenta para las reglas de BD: queda en el comando crudo.
  }
  return { sin: salida.join('\n'), aShell }
}

/** Comandos anidados que también se ejecutan: bash -c "...", eval "...", ssh host "...", $(...). */
function anidados(segmento: string, toks: string[]): string[] {
  const salida: string[] = []
  const prog = base(toks[0])
  if (/^(ba|z|da|k)?sh$/.test(prog)) {
    const i = toks.indexOf('-c')
    if (i >= 0 && toks[i + 1] !== undefined) salida.push(toks[i + 1]!)
  }
  if (prog === 'eval' && toks.length > 1) salida.push(toks.slice(1).join(' '))
  if (prog === 'ssh') {
    // ssh [-opciones [valor]] host comando...
    let j = 1
    while (j < toks.length && toks[j]!.startsWith('-')) j += /^-[bcDEeFIiJLlmOopQRSWw]$/.test(toks[j]!) ? 2 : 1
    if (toks.length > j + 1) salida.push(toks.slice(j + 1).join(' '))
  }
  for (const m of segmento.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) salida.push(m[1] ?? m[2] ?? '')
  return salida.filter(s => s.trim() !== '')
}

function base(p: string | undefined): string {
  return (p ?? '').replace(/^\\/, '').split('/').pop() ?? ''
}

// ---- Reglas que miran palabra por palabra ----

/** ¿Es un rm recursivo sobre algo que no es una carpeta desechable? */
function rmPeligroso(toks: string[]): boolean {
  let i = 0
  let porXargs = false
  if (base(toks[0]) === 'xargs') {
    porXargs = true
    i = 1
    while (i < toks.length && toks[i]!.startsWith('-')) i += /^-[IinPLdEs]$/.test(toks[i]!) ? 2 : 1
  }
  if (base(toks[i]) !== 'rm') return false
  const args = toks.slice(i + 1)
  const banderas = args.filter(p => p.startsWith('-') && p !== '--')
  const recursivo = banderas.some(b => b === '--recursive' || (/^-[^-]/.test(b) && /[rR]/.test(b)))
  if (!recursivo) return false
  const objetivos = args.filter(p => !p.startsWith('-'))
  // Con xargs los objetivos llegan por la tubería: no se sabe qué borra.
  if (objetivos.length === 0) return porXargs
  return objetivos.some(o => !rutaDesechable(o))
}

function rutaDesechable(ruta: string): boolean {
  const r = ruta.replace(/\\/g, '/').replace(/\/+$/, '')
  if (r === '' || r.split('/').includes('..')) return false
  // Algo dentro de la carpeta temporal (no la carpeta misma).
  if (/^(\/private)?\/tmp\/[^/]+/.test(r) || /^\$\{?TMPDIR\}?\/[^/]+/.test(r)) return true
  return CARPETA_DESECHABLE.has(r.split('/').pop() ?? '')
}

/** El subcomando de kubectl / helm en una parte del comando (`kubectl -n x delete pod` → "delete"). */
function subcomandoKube(toks: string[]): { cli: 'kubectl' | 'helm'; verbo: string } | undefined {
  const i = toks.findIndex(p => /^(kubectl|helm|oc)$/.test(base(p)))
  if (i < 0) return undefined
  const cli = base(toks[i]) === 'helm' ? 'helm' : 'kubectl'
  for (let j = i + 1; j < toks.length; j++) {
    const p = toks[j]!
    if (BANDERA_CON_VALOR.test(p)) j++
    else if (!p.startsWith('-')) return { cli, verbo: p }
  }
  return undefined
}

type Push = { force: boolean; mirror: boolean; todas: boolean; borra: string[]; destinos: string[]; usaActual: boolean }

/** Lee un `git push` palabra por palabra; undefined si la parte no es un push. */
function leerPush(toks: string[]): Push | undefined {
  let i = toks.findIndex(p => base(p) === 'git')
  if (i < 0) return undefined
  i++
  while (i < toks.length && /^(-C|-c|--git-dir|--work-tree)$/.test(toks[i]!)) i += 2
  if (toks[i] !== 'push') return undefined
  const push: Push = { force: false, mirror: false, todas: false, borra: [], destinos: [], usaActual: false }
  let borrar = false
  const posicionales: string[] = []
  for (let j = i + 1; j < toks.length; j++) {
    const p = toks[j]!
    if (/^(-o|--push-option|--repo|--receive-pack|--exec)$/.test(p)) j++
    else if (/^--force(-with-lease|-if-includes)?(=.*)?$/.test(p) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(p)) push.force = true
    else if (p === '--mirror') push.mirror = true
    else if (p === '--all' || p === '--branches') push.todas = true
    else if (p === '--delete' || /^-[a-zA-Z]*d[a-zA-Z]*$/.test(p)) borrar = true
    else if (!p.startsWith('-')) posicionales.push(p)
  }
  const refspecs = posicionales.slice(1)
  if (refspecs.length === 0 && !push.mirror && !push.todas && !borrar) push.usaActual = true
  for (const ref of refspecs) {
    if (ref.startsWith('+')) push.force = true
    const r = ref.replace(/^\+/, '')
    const destino = (r.includes(':') ? r.slice(r.indexOf(':') + 1) : r).replace(/^refs\/heads\//, '')
    if (borrar || (r.startsWith(':') && destino !== '')) push.borra.push(destino)
    else if (destino === 'HEAD' || destino === '@') push.usaActual = true
    else push.destinos.push(destino)
  }
  return push
}

/** ¿Algún push del comando va a la rama actual sin nombrarla? (Para averiguar cuál es.) */
export function pushUsaRamaActual(comando: string): boolean {
  return segmentos(separarHeredocs(comando).sin).some(s => leerPush(palabras(limpiar(s)))?.usaActual === true)
}

// ---- Clasificación ----

/**
 * Riesgos de un comando, según la configuración del equipo.
 */
export function clasificar(comando: string, config: Config = configPorDefecto(), profundidad = 0): Riesgo[] {
  const riesgos: Riesgo[] = []
  const agregar = (r: Riesgo) => {
    if (!config.ignoradas.has(r.categoria) && !riesgos.some(x => x.motivo.es === r.motivo.es)) riesgos.push(r)
  }

  const { sin, aShell } = separarHeredocs(comando)
  const visibles: string[] = []
  for (const crudo of segmentos(sin)) {
    if (config.permitidos.some(p => p.test(crudo))) continue
    const limpio = limpiar(crudo)
    const toks = palabras(limpio)
    if (profundidad < 3) for (const dentro of anidados(limpio, toks)) clasificar(dentro, config, profundidad + 1).forEach(agregar)
    if (SOLO_LECTURA.has(base(toks[0])) || toks.some(t => SOLO_AYUDA.test(t)) || toks[1] === 'help') continue
    const visible = enmascarar(limpio)
    visibles.push(visible)

    if (rmPeligroso(toks)) agregar({ categoria: 'archivos', motivo: { es: 'rm -r borra carpetas de forma permanente', en: 'rm -r permanently deletes folders' } })

    // Kubernetes y Helm: siempre peligrosos, en cualquier contexto
    const kube = subcomandoKube(toks)
    if (kube?.cli === 'kubectl' && (kube.verbo === 'delete' || kube.verbo === 'drain')) {
      agregar({ categoria: 'kubernetes', motivo: { es: 'kubectl delete / drain elimina recursos o vacía nodos', en: 'kubectl delete / drain removes resources or empties nodes' } })
    }
    if (kube?.cli === 'helm' && ['uninstall', 'delete', 'rollback'].includes(kube.verbo)) {
      agregar({ categoria: 'kubernetes', motivo: { es: 'helm uninstall / rollback cambia una release', en: 'helm uninstall / rollback changes a release' } })
    }

    const push = leerPush(toks)
    if (push !== undefined) revisarPush(push, config, agregar)

    for (const regla of REGLAS_SEGMENTO) {
      if (regla.patron.test(visible)) agregar({ categoria: regla.categoria, motivo: regla.motivo })
    }
  }
  if (profundidad < 3) for (const cuerpo of aShell) clasificar(cuerpo, config, profundidad + 1).forEach(agregar)

  const texto = visibles.join('\n')
  // Las reglas SQL miran el comando completo: la consulta suele ir entre comillas tras -c / -e o en un heredoc.
  if (CLIENTE_BD.test(texto)) {
    for (const regla of REGLAS_BD) {
      if (regla.patron.test(comando)) agregar({ categoria: regla.categoria, motivo: regla.motivo })
    }
  }
  for (const extra of config.extras) {
    if (extra.test(texto)) agregar({ categoria: 'equipo', motivo: { es: `coincide con "${extra.source}"`, en: `matches "${extra.source}"` } })
  }
  // Señal de producción explícita en el comando (--env production, NODE_ENV=prod, --stage prd...)
  const senal = texto.match(
    new RegExp(`(--?(env|environment|stage|context|profile|target|e|s)[= ]|\\b[A-Z_]*(ENV|STAGE|PROFILE)=)["']?(${config.prod.source})\\b`, 'i'),
  ) ?? comando.match(new RegExp(`^\\s*[A-Z_]*(ENV|STAGE|PROFILE)=["']?(${config.prod.source})\\b`, 'i'))
  if (senal && VERBO_ESCRITURA.test(texto)) {
    const s = senal[0].trim()
    agregar({ categoria: 'produccion', motivo: { es: `el comando apunta a producción (${s})`, en: `the command targets production (${s})` } })
  }
  return riesgos
}

function revisarPush(push: Push, config: Config, agregar: (r: Riesgo) => void): void {
  if (push.force) agregar({ categoria: 'git', motivo: { es: 'git push --force reescribe el historial remoto', en: 'git push --force rewrites remote history' } })
  if (push.mirror) agregar({ categoria: 'git', motivo: { es: 'git push --mirror reemplaza todo el remoto (y borra lo que no tengas)', en: 'git push --mirror replaces the whole remote (and deletes what you lack)' } })
  if (push.borra.length > 0) {
    const r = push.borra.join(', ')
    agregar({ categoria: 'git', motivo: { es: `borra la rama remota ${r}`, en: `deletes the remote branch ${r}` } })
  }
  const protegidas = push.destinos.filter(d => config.ramas.test(d))
  if (push.usaActual && config.ramaActual !== undefined && config.ramas.test(config.ramaActual)) protegidas.push(config.ramaActual)
  if (push.todas) protegidas.push('--all')
  if (protegidas.length > 0) {
    const r = [...new Set(protegidas)].join(', ')
    agregar({ categoria: 'git', motivo: { es: `push directo a una rama protegida (${r})`, en: `direct push to a protected branch (${r})` } })
  }
}

/** ¿El comando usa kubectl o helm? */
export function usaKube(comando: string): boolean {
  return /\b(kubectl|helm|oc)\b/.test(comando)
}

/** ¿El comando cambia el clúster? */
export function kubeMuta(comando: string): boolean {
  return segmentos(comando).some(s => {
    const kube = subcomandoKube(palabras(limpiar(s)))
    return kube !== undefined && (kube.cli === 'kubectl' ? KUBECTL_MUTA : HELM_MUTA).has(kube.verbo)
  })
}

/** El contexto pasado con --context / --kube-context, si lo hay. */
export function contextoExplicito(comando: string): string | undefined {
  const m = comando.match(/--(kube-)?context[= ](?:"([^"]+)"|'([^']+)'|(\S+))/)
  return m === null ? undefined : (m[2] ?? m[3] ?? m[4])
}

/** La carpeta donde corre el comando: la de la sesión, movida por `cd x &&` o `git -C x`. */
export function carpetaDelComando(base: string, comando: string): string {
  const destino = comando.match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/)?.[1] ?? comando.match(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*&&/)?.[1]
  if (destino === undefined) return base
  const limpio = destino.replace(/^["']|["']$/g, '')
  return /^([/~]|[A-Za-z]:[\\/])/.test(limpio) ? limpio : `${base}/${limpio}`
}
