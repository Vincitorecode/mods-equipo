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
  /**
   * El comando es un script del package.json o una receta del Makefile: lo escribió
   * alguien del equipo, así que `rm -r` de una carpeta del proyecto (`rm -rf lib`) es limpieza.
   */
  enScript?: boolean
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
function rmPeligroso(toks: string[], enScript = false): boolean {
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
  return objetivos.some(o => !rutaDesechable(o) && !(enScript && rutaDelProyecto(o)))
}

/** Una carpeta dentro del proyecto, dicha con nombre: `lib`, `./out/cache`; no `.`, `..`, `~`, `/`, `*` ni `$VAR`. */
function rutaDelProyecto(ruta: string): boolean {
  const r = ruta.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  return r !== '' && r !== '.' && !/^([/~]|[A-Za-z]:)/.test(r) && !/[*?$`]/.test(r) && !r.split('/').includes('..')
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

    if (rmPeligroso(toks, config.enScript)) agregar({ categoria: 'archivos', motivo: { es: 'rm -r borra carpetas de forma permanente', en: 'rm -r permanently deletes folders' } })

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

// ---- Scripts de npm / yarn / pnpm / bun y targets de make ----
//
// `npm run deploy` o `make release` no dicen nada por sí solos: lo riesgoso está en
// el package.json o en el Makefile. Se lee el script o la receta y se revisa como si
// Claude lo hubiera escrito en la shell.

/** Un script o target que el comando va a ejecutar, ya leído. */
export type Script = {
  /** Cómo se invocó, para el motivo: `npm run deploy`, `make release`. */
  etiqueta: string
  /** Lo que ejecuta, como texto de shell. */
  cuerpo: string
}

/** Lee un archivo; undefined si no existe o no se pudo leer. */
export type Lector = (ruta: string) => Promise<string | undefined>

type Invocacion =
  | { tipo: 'npm'; etiqueta: string; script: string; dir?: string }
  | { tipo: 'make'; etiqueta: string; objetivos: string[]; dir?: string; archivo?: string }

/** Subcomandos propios de cada gestor: con ellos no corre un script del package.json. */
const PROPIOS: Record<'yarn' | 'pnpm' | 'bun', ReadonlySet<string>> = {
  yarn: new Set(['add', 'install', 'remove', 'upgrade', 'upgrade-interactive', 'up', 'init', 'info', 'why', 'workspace', 'workspaces', 'dlx', 'exec', 'config', 'cache', 'global', 'link', 'unlink', 'create', 'set', 'plugin', 'version', 'pack', 'publish', 'npm', 'bin', 'outdated', 'audit', 'list', 'licenses', 'import', 'policies', 'owner', 'tag', 'team', 'autoclean', 'check', 'help', 'node', 'dedupe', 'explain', 'constraints', 'patch', 'patch-commit', 'rebuild', 'search', 'stage', 'unplug', 'login', 'logout', 'generate-lock-entry']),
  pnpm: new Set(['add', 'install', 'i', 'update', 'up', 'upgrade', 'remove', 'rm', 'uninstall', 'un', 'link', 'ln', 'unlink', 'import', 'rebuild', 'rb', 'prune', 'fetch', 'patch', 'patch-commit', 'audit', 'list', 'ls', 'outdated', 'why', 'licenses', 'exec', 'dlx', 'create', 'env', 'setup', 'store', 'root', 'bin', 'config', 'c', 'init', 'publish', 'pack', 'deploy', 'server', 'recursive', 'help', 'dedupe', 'approve-builds', 'cat-file', 'self-update']),
  bun: new Set(['install', 'i', 'add', 'a', 'remove', 'rm', 'update', 'outdated', 'link', 'unlink', 'pm', 'x', 'create', 'init', 'upgrade', 'build', 'test', 'publish', 'patch', 'patch-commit', 'repl', 'exec', 'audit', 'info', 'why']),
}

/** Scripts que npm corre sin `run`. */
const NPM_SIN_RUN: Record<string, string> = { start: 'start', test: 'test', t: 'test', tst: 'test', stop: 'stop', restart: 'restart' }

/** Lo que puede ir antes del programa sin cambiar qué se ejecuta. */
const PREFIJO_INVOCACION = /^(sudo|doas|command|builtin|exec|env|nohup|time|nice)$/

/** ¿La parte del comando corre un script de npm / yarn / pnpm / bun o un target de make? */
function leerInvocacion(toks: string[]): Invocacion | undefined {
  let i = 0
  while (
    i < toks.length &&
    (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i]!) || PREFIJO_INVOCACION.test(base(toks[i])) || (i > 0 && toks[i]!.startsWith('-') && PREFIJO_INVOCACION.test(base(toks[i - 1]))))
  )
    i++
  const prog = base(toks[i])
  const args = toks.slice(i + 1)
  if (prog === 'make' || prog === 'gmake') return leerMake(args)
  if (prog === 'npm' || prog === 'yarn' || prog === 'pnpm' || prog === 'bun') return leerGestor(prog, args)
  return undefined
}

function leerGestor(prog: 'npm' | 'yarn' | 'pnpm' | 'bun', args: string[]): Invocacion | undefined {
  let dir: string | undefined
  const pos: string[] = []
  for (let j = 0; j < args.length; j++) {
    const a = args[j]!
    if (a === '--') break // lo que sigue son argumentos para el script
    const m = a.match(/^(--prefix|--cwd|--dir|-C)(?:=(.*))?$/)
    if (m) {
      dir = m[2] ?? args[++j]
      continue
    }
    if (/^(-w|--workspace|--filter|-F)$/.test(a)) j++
    else if (!a.startsWith('-')) pos.push(a)
  }
  const [sub, nombre] = pos
  if (sub === undefined) return undefined
  let script: string | undefined
  if (/^(run|run-script|rum|urn)$/.test(sub)) script = nombre
  else if (prog === 'npm') script = NPM_SIN_RUN[sub]
  else if (!PROPIOS[prog].has(sub)) script = sub // yarn deploy, pnpm deploy:prod, bun release
  if (script === undefined) return undefined
  return { tipo: 'npm', etiqueta: sub === script ? `${prog} ${script}` : `${prog} ${sub} ${script}`, script, dir }
}

function leerMake(args: string[]): Invocacion | undefined {
  let dir: string | undefined
  let archivo: string | undefined
  const objetivos: string[] = []
  for (let j = 0; j < args.length; j++) {
    const a = args[j]!
    let m: RegExpMatchArray | null
    if (a === '-C' || a === '--directory') dir = args[++j]
    else if ((m = a.match(/^(?:-C|--directory=)(.+)$/))) dir = m[1]
    else if (a === '-f' || a === '--file' || a === '--makefile') archivo = args[++j]
    else if ((m = a.match(/^(?:-f|--file=|--makefile=)(.+)$/))) archivo = m[1]
    // Simulacros: make solo imprime o pregunta, no ejecuta.
    else if (/^(--dry-run|--just-print|--recon|--question|--print-data-base)$/.test(a) || /^-[a-zA-Z]*[nqp][a-zA-Z]*$/.test(a)) return undefined
    else if (/^(-[IoW]|--include-dir|--old-file|--what-if|--new-file|--assume-old|--assume-new)$/.test(a)) j++
    else if ((a === '-j' || a === '-l') && /^\d+$/.test(args[j + 1] ?? '')) j++
    else if (!a.startsWith('-') && !a.includes('=')) objetivos.push(a)
  }
  return { tipo: 'make', etiqueta: ['make', ...objetivos].join(' '), objetivos, dir, archivo }
}

/** El script `nombre` del package.json con su pre y su post; undefined si no existe. */
export function scriptNpm(packageJson: string, nombre: string): string | undefined {
  let scripts: unknown
  try {
    scripts = (JSON.parse(packageJson) as { scripts?: unknown })?.scripts
  } catch {
    return undefined
  }
  if (typeof scripts !== 'object' || scripts === null) return undefined
  const s = scripts as Record<string, unknown>
  if (typeof s[nombre] !== 'string') return undefined
  return [`pre${nombre}`, nombre, `post${nombre}`].map(n => s[n]).filter((c): c is string => typeof c === 'string').join('\n')
}

/**
 * Las recetas de unos targets de make y de sus prerrequisitos, una línea por
 * comando, con las variables del Makefile sustituidas. Sin targets, las del primero.
 */
export function recetasMake(makefile: string, objetivos: string[]): string {
  const lineas = makefile.replace(/\r\n/g, '\n').replace(/\\\n/g, ' ').split('\n')
  const vars = new Map<string, string>([['MAKE', 'make']])
  const reglas = new Map<string, { prereqs: string[]; receta: string[] }>()
  const regla = (t: string) => reglas.get(t) ?? reglas.set(t, { prereqs: [], receta: [] }).get(t)!
  const sinPrefijo = (cmd: string) => cmd.trim().replace(/^[@+-]+\s*/, '')
  let primero: string | undefined
  let actuales: string[] = []
  let enDefine = false

  for (const linea of lineas) {
    if (enDefine) {
      if (/^\s*endef\b/.test(linea)) enDefine = false
      continue
    }
    if (linea.startsWith('\t')) {
      const cmd = sinPrefijo(linea.slice(1))
      if (cmd !== '' && !cmd.startsWith('#')) for (const t of actuales) regla(t).receta.push(cmd)
      continue
    }
    const texto = linea.replace(/(^|[^\\])#.*$/, '$1')
    if (texto.trim() === '') continue // una línea en blanco no termina la receta
    actuales = []
    if (/^\s*define\b/.test(texto)) {
      enDefine = true
      continue
    }
    const v = texto.match(/^\s*(?:export\s+|override\s+)?([A-Za-z_][\w.-]*)\s*(\+=|\?=|!=|:{0,3}=)\s*(.*)$/)
    if (v) {
      const [, nombre, op, valor] = v as unknown as [string, string, string, string]
      if (op === '+=') vars.set(nombre, `${vars.get(nombre) ?? ''} ${valor.trim()}`.trim())
      else if (op === '?=') {
        if (!vars.has(nombre)) vars.set(nombre, valor.trim())
      } else if (op !== '!=') vars.set(nombre, valor.trim())
      continue
    }
    const r = texto.match(/^([^:=\s][^:=]*?)\s*::?(?!=)(.*)$/)
    if (!r) continue
    const [der, ...enLinea] = r[2]!.split(';')
    const targets = r[1]!.trim().split(/\s+/)
    const prereqs = der!.replace('|', ' ').split(/\s+/).filter(p => p !== '' && !p.includes('='))
    for (const t of targets) {
      regla(t).prereqs.push(...prereqs)
      const cmd = sinPrefijo(enLinea.join(';'))
      if (cmd !== '') regla(t).receta.push(cmd)
      if (primero === undefined && !t.startsWith('.') && !t.includes('%')) primero = t
    }
    actuales = targets
  }

  const salida: string[] = []
  const vistos = new Set<string>()
  const visitar = (t: string) => {
    const r = reglas.get(t)
    if (vistos.has(t) || r === undefined) return
    vistos.add(t)
    r.prereqs.forEach(visitar)
    salida.push(...r.receta)
  }
  ;(objetivos.length > 0 ? objetivos : primero !== undefined ? [primero] : []).forEach(visitar)

  // $(VAR) y ${VAR} del Makefile; $$ es un $ para la shell.
  let s = salida.join('\n')
  for (let k = 0; k < 3; k++) s = s.replace(/\$\$|\$[({]([A-Za-z_][\w.-]*)[)}]/g, (m, n?: string) => (n === undefined ? m : vars.get(n) ?? m))
  return s.replace(/\$\$/g, '$')
}

/**
 * Los scripts de npm / yarn / pnpm / bun y los targets de make que corre el
 * comando, leídos de su package.json o Makefile (y los que esos a su vez llaman).
 */
export async function expandirScripts(comando: string, carpeta: string, leer: Lector, permitidos: RegExp[] = [], profundidad = 0): Promise<Script[]> {
  if (profundidad >= 3) return []
  const salida: Script[] = []
  let dir = carpeta
  for (const crudo of segmentos(separarHeredocs(comando).sin)) {
    const toks = palabras(crudo.replace(/^[({!\s]+/, '').replace(/[)\s]+$/, ''))
    if (base(toks[0]) === 'cd') {
      if (toks[1] !== undefined) dir = unir(dir, toks[1])
      continue
    }
    if (permitidos.some(p => p.test(crudo)) || toks.some(t => SOLO_AYUDA.test(t))) continue
    const inv = leerInvocacion(toks)
    if (inv === undefined) continue
    const donde = inv.dir === undefined ? dir : unir(dir, inv.dir)
    let cuerpo: string | undefined
    if (inv.tipo === 'npm') {
      const pkg = await leer(`${donde}/package.json`)
      cuerpo = pkg === undefined ? undefined : scriptNpm(pkg, inv.script)
    } else {
      const makefile = await leerMakefile(leer, donde, inv.archivo)
      cuerpo = makefile === undefined ? undefined : recetasMake(makefile, inv.objetivos)
    }
    if (cuerpo === undefined || cuerpo.trim() === '') continue
    salida.push({ etiqueta: inv.etiqueta, cuerpo })
    for (const dentro of await expandirScripts(cuerpo, donde, leer, permitidos, profundidad + 1)) {
      salida.push({ etiqueta: `${inv.etiqueta} → ${dentro.etiqueta}`, cuerpo: dentro.cuerpo })
    }
  }
  return salida
}

async function leerMakefile(leer: Lector, dir: string, archivo?: string): Promise<string | undefined> {
  if (archivo !== undefined) return leer(unir(dir, archivo))
  for (const nombre of ['GNUmakefile', 'makefile', 'Makefile']) {
    const texto = await leer(`${dir}/${nombre}`)
    if (texto !== undefined) return texto
  }
  return undefined
}

function unir(dir: string, ruta: string): string {
  if (ruta === '.' || ruta === './') return dir
  return /^([/~]|[A-Za-z]:[\\/])/.test(ruta) ? ruta : `${dir.replace(/[\\/]+$/, '')}/${ruta}`
}

/** La carpeta donde corre el comando: la de la sesión, movida por `cd x &&` o `git -C x`. */
export function carpetaDelComando(base: string, comando: string): string {
  const destino = comando.match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/)?.[1] ?? comando.match(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*&&/)?.[1]
  if (destino === undefined) return base
  const limpio = destino.replace(/^["']|["']$/g, '')
  return /^([/~]|[A-Za-z]:[\\/])/.test(limpio) ? limpio : `${base}/${limpio}`
}
