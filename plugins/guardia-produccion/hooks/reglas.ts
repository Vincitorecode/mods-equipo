// Reglas de la Guardia de producción.
//
// Funciones puras (sin `$`): reciben el texto de un comando de shell y
// devuelven la lista de riesgos encontrados. Así se pueden probar sin Claude Code.
//
// Para agregar una regla al equipo: añade una entrada a REGLAS_SEGMENTO
// (se evalúa en cada parte del comando separada por &&, ||, ;, | o salto de línea)
// o usa la opción "Comandos extra a vigilar" del plugin.

export type Riesgo = {
  /** Categoría corta, se muestra en el diálogo (ej. "Base de datos"). */
  categoria: string
  /** Qué haría el comando, en palabras del equipo. */
  motivo: string
}

type Regla = {
  categoria: string
  motivo: string
  patron: RegExp
}

/** Carpetas que es normal borrar con rm -rf: no se pide confirmación. */
const RM_SEGURO =
  /^(\.\/)?(node_modules|dist|build|out|\.next|\.nuxt|\.turbo|\.cache|\.parcel-cache|coverage|target|tmp|\.pytest_cache|__pycache__|\.venv|venv)(\/.*)?$/

/** Clientes de base de datos: las reglas SQL solo aplican si el comando usa uno. */
const CLIENTE_BD =
  /\b(psql|mysql|mariadb|sqlcmd|sqlite3|clickhouse(-client)?|cockroach|mongosh|mongo|redis-cli|bq\s+query|prisma\s+db\s+execute|supabase\s+db)\b/i

const REGLAS_SEGMENTO: Regla[] = [
  // Infraestructura
  { categoria: 'Infraestructura', motivo: 'terraform apply / destroy cambia infraestructura real', patron: /\b(terraform|tofu|terragrunt)\b.*\b(apply|destroy)\b/ },
  { categoria: 'Infraestructura', motivo: 'pulumi up / destroy cambia infraestructura real', patron: /\bpulumi\b.*\b(up|destroy|update)\b/ },
  { categoria: 'Infraestructura', motivo: 'cdk / sam deploy o destroy cambia infraestructura de AWS', patron: /\b(cdk|sam)\s+(deploy|destroy)\b/ },

  // Git (el subcomando va justo después de `git`, para no confundirse con el texto de un mensaje de commit)
  { categoria: 'Git', motivo: 'git push --force reescribe el historial remoto', patron: /\bgit(\s+-[cC]\s+\S+)*\s+push\b.*(\s--force(-with-lease)?\b|\s-[a-zA-Z]*f[a-zA-Z]*\b|\s\+\S)/ },
  { categoria: 'Git', motivo: 'push directo a main / master', patron: /\bgit(\s+-[cC]\s+\S+)*\s+push(\s+-\S+)*\s+[^\s-]\S*\s+(\S*:)?(main|master)(?=$|\s)/ },
  { categoria: 'Git', motivo: 'git reset --hard descarta cambios sin commit', patron: /\bgit(\s+-[cC]\s+\S+)*\s+reset\b.*\s--hard\b/ },
  { categoria: 'Git', motivo: 'git clean -f borra archivos no versionados', patron: /\bgit(\s+-[cC]\s+\S+)*\s+clean\b.*\s-[a-zA-Z]*f/ },

  // Migraciones y bases de datos
  { categoria: 'Migración', motivo: 'prisma migrate deploy / reset aplica o reinicia el esquema', patron: /\bprisma\s+migrate\s+(deploy|reset)\b/ },
  { categoria: 'Migración', motivo: 'prisma db push con pérdida de datos', patron: /\bprisma\s+db\s+push\b.*(--accept-data-loss|--force-reset)/ },
  { categoria: 'Migración', motivo: 'rails / rake db: migrate, drop, reset o rollback', patron: /\b(rails|rake)\s+db:(migrate|drop|reset|rollback|schema:load|purge)\b/ },
  { categoria: 'Migración', motivo: 'Django migrate / flush', patron: /\bmanage\.py\s+(migrate|flush)\b/ },
  { categoria: 'Migración', motivo: 'alembic upgrade / downgrade', patron: /\balembic\s+(upgrade|downgrade)\b/ },
  { categoria: 'Migración', motivo: 'knex / sequelize / typeorm ejecuta migraciones', patron: /\b(knex\s+migrate:(latest|rollback|up|down)|sequelize(-cli)?\s+db:(migrate|drop)|typeorm\b.*migration:(run|revert)|schema:drop)\b/ },
  { categoria: 'Migración', motivo: 'flyway / liquibase cambia el esquema', patron: /\b(flyway\b.*\b(migrate|clean|undo)|liquibase\b.*\b(update|rollback|drop-all))\b/ },

  // Nube
  { categoria: 'Nube', motivo: 'aws: borra o termina recursos', patron: /\baws\s+\S+\s+(delete|terminate|remove|rb|purge|deregister)[\w-]*/ },
  { categoria: 'Nube', motivo: 'aws s3 rm --recursive borra muchos objetos', patron: /\baws\s+s3\s+rm\b.*--recursive/ },
  { categoria: 'Nube', motivo: 'gcloud / az: borra recursos', patron: /\b(gcloud|az)\b.*\bdelete\b/ },

  // Despliegues y publicaciones
  { categoria: 'Despliegue', motivo: 'despliegue a producción', patron: /\b(vercel\b.*--prod\b|netlify\s+deploy\b.*--prod\b|firebase\s+deploy\b|fly(ctl)?\s+deploy\b|eb\s+deploy\b|(serverless|sls)\s+deploy\b|heroku\b.*\b(releases:rollback|pg:reset|ps:scale)\b)/ },
  { categoria: 'Publicación', motivo: 'publica un paquete en el registro público', patron: /\b(npm|yarn|pnpm)\s+publish\b|\btwine\s+upload\b|\bcargo\s+publish\b/ },
]

/** Reglas SQL / Mongo, evaluadas solo si el comando usa un cliente de base de datos. */
const REGLAS_BD: Regla[] = [
  { categoria: 'Base de datos', motivo: 'DROP elimina tablas, esquemas o bases completas', patron: /\bdrop\s+(table|database|schema|index|view)\b/i },
  { categoria: 'Base de datos', motivo: 'TRUNCATE vacía una tabla', patron: /\btruncate\b/i },
  { categoria: 'Base de datos', motivo: 'DELETE sin WHERE borra todas las filas', patron: /\bdelete\s+from\s+[\w."`\[\]]+\s*(;|'|"|$)/i },
  { categoria: 'Base de datos', motivo: 'UPDATE sin WHERE modifica todas las filas', patron: /\bupdate\s+[\w."`\[\]]+\s+set\b(?![^;'"]*\bwhere\b)/i },
  { categoria: 'Base de datos', motivo: 'ALTER TABLE ... DROP elimina columnas', patron: /\balter\s+table\b[^;]*\bdrop\b/i },
  { categoria: 'Base de datos', motivo: 'Mongo: borra colecciones, bases o todos los documentos', patron: /\.(dropDatabase|drop)\s*\(\s*\)|\.deleteMany\s*\(\s*\{\s*\}\s*\)/ },
  { categoria: 'Base de datos', motivo: 'Redis FLUSHALL / FLUSHDB borra todas las llaves', patron: /\bflush(all|db)\b/i },
]

/** Subcomandos de kubectl / helm que cambian el clúster (se vigilan si el contexto es de producción). */
const KUBECTL_MUTA = new Set(['apply', 'create', 'delete', 'patch', 'edit', 'replace', 'scale', 'rollout', 'drain', 'cordon', 'uncordon', 'taint', 'set', 'label', 'annotate', 'exec', 'run', 'expose', 'autoscale'])
const HELM_MUTA = new Set(['install', 'upgrade', 'uninstall', 'delete', 'rollback'])

/** Banderas globales de kubectl / helm que llevan un valor aparte (`-n prod`). */
const BANDERA_CON_VALOR = /^(-n|--namespace|--context|--kube-context|--kubeconfig|-s|--server|--cluster|--user|--token|--as)$/

/** El subcomando de kubectl / helm en una parte del comando (`kubectl -n x delete pod` → "delete"). */
function subcomandoKube(segmento: string): { cli: 'kubectl' | 'helm'; verbo: string } | undefined {
  const palabras = segmento.split(/\s+/)
  const i = palabras.findIndex(p => /(^|\/)(kubectl|helm)$/.test(p))
  if (i < 0) return undefined
  const cli = palabras[i]!.endsWith('helm') ? 'helm' : 'kubectl'
  for (let j = i + 1; j < palabras.length; j++) {
    const p = palabras[j]!
    if (BANDERA_CON_VALOR.test(p)) j++
    else if (!p.startsWith('-')) return { cli, verbo: p }
  }
  return undefined
}

/** Verbos que, junto a una señal de producción en el mismo comando, merecen confirmación. */
const VERBO_ESCRITURA =
  /\b(deploy|apply|migrate|migration|delete|destroy|drop|push|restart|scale|release|rollback|publish|upgrade|truncate|seed|reset)\b/i

export const PATRON_PROD_DEFECTO = 'prod|production|prd|live'

/** Compila una expresión regular del usuario; si es inválida usa la de respaldo. */
export function compilar(fuente: string, respaldo: string): RegExp {
  try {
    return new RegExp(fuente.trim() === '' ? respaldo : fuente, 'i')
  } catch {
    return new RegExp(respaldo, 'i')
  }
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

/** Divide un comando en partes por &&, ||, ;, | y saltos de línea. */
export function segmentos(comando: string): string[] {
  return comando
    .split(/&&|\|\||;|\||\n/)
    .map(s => s.trim())
    .filter(s => s !== '')
}

/** Quita sudo, VAR=valor y prefijos inofensivos del inicio de una parte. */
function limpiar(segmento: string): string {
  let s = segmento.replace(/^[({\s]+/, '')
  for (;;) {
    const antes = s
    s = s
      .replace(/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*)\s+/, '')
      .replace(/^(sudo(\s+-\S+)*|command|exec|env|nohup|time|npx|bunx|pnpm\s+exec|yarn|pnpm|poetry\s+run|uv\s+run|bundle\s+exec|python3?|\\)\s+/, '')
    if (s === antes) return s
  }
}

/** ¿Es un rm recursivo/forzado sobre algo que no está en la lista segura? */
function rmPeligroso(segmento: string): boolean {
  const palabras = segmento.split(/\s+/)
  const cmd = palabras[0]?.replace(/^\\/, '')
  if (cmd !== 'rm' && !cmd?.endsWith('/rm')) return false
  const banderas = palabras.slice(1).filter(p => p.startsWith('-'))
  const recursivo = banderas.some(b => b === '--recursive' || (/^-[^-]/.test(b) && /[rR]/.test(b)))
  if (!recursivo) return false
  const objetivos = palabras.slice(1).filter(p => !p.startsWith('-'))
  if (objetivos.length === 0) return false
  return objetivos.some(o => !RM_SEGURO.test(o.replace(/^['"]|['"]$/g, '')))
}

/**
 * Riesgos de un comando. `prod` es el patrón de producción; `extras`, las
 * reglas que el equipo agregó en la configuración del plugin.
 */
export function clasificar(comando: string, prod: RegExp, extras: RegExp[] = []): Riesgo[] {
  const riesgos: Riesgo[] = []
  const agregar = (r: Riesgo) => {
    if (!riesgos.some(x => x.motivo === r.motivo)) riesgos.push(r)
  }

  const usaBd = CLIENTE_BD.test(comando)
  for (const crudo of segmentos(comando)) {
    if (rmPeligroso(limpiar(crudo))) agregar({ categoria: 'Archivos', motivo: 'rm -r borra carpetas de forma permanente' })
    // Kubernetes y Helm: siempre peligrosos, en cualquier contexto
    const kube = subcomandoKube(crudo)
    if (kube?.cli === 'kubectl' && (kube.verbo === 'delete' || kube.verbo === 'drain')) {
      agregar({ categoria: 'Kubernetes', motivo: 'kubectl delete / drain elimina recursos o vacía nodos' })
    }
    if (kube?.cli === 'helm' && ['uninstall', 'delete', 'rollback'].includes(kube.verbo)) {
      agregar({ categoria: 'Kubernetes', motivo: 'helm uninstall / rollback cambia una release' })
    }
    for (const regla of REGLAS_SEGMENTO) {
      if (regla.patron.test(crudo)) agregar({ categoria: regla.categoria, motivo: regla.motivo })
    }
  }
  // Las reglas SQL miran el comando completo: la consulta suele ir entre comillas tras -c / -e.
  if (usaBd) {
    for (const regla of REGLAS_BD) {
      if (regla.patron.test(comando)) agregar({ categoria: regla.categoria, motivo: regla.motivo })
    }
  }
  for (const extra of extras) {
    if (extra.test(comando)) agregar({ categoria: 'Regla del equipo', motivo: `coincide con "${extra.source}"` })
  }
  // Señal de producción explícita en el comando (--env production, NODE_ENV=prod, --stage prd...)
  const senal = comando.match(
    new RegExp(`(--?(env|environment|stage|context|profile|target|e|s)[= ]|\\b[A-Z_]*(ENV|STAGE|PROFILE)=)["']?(${prod.source})\\b`, 'i'),
  )
  if (senal && VERBO_ESCRITURA.test(comando)) {
    agregar({ categoria: 'Producción', motivo: `el comando apunta a producción (${senal[0].trim()})` })
  }
  return riesgos
}

/** ¿El comando usa kubectl o helm? */
export function usaKube(comando: string): boolean {
  return /\b(kubectl|helm)\b/.test(comando)
}

/** ¿El comando cambia el clúster? */
export function kubeMuta(comando: string): boolean {
  return segmentos(comando).some(s => {
    const kube = subcomandoKube(s)
    return kube !== undefined && (kube.cli === 'kubectl' ? KUBECTL_MUTA : HELM_MUTA).has(kube.verbo)
  })
}

/** El contexto pasado con --context / --kube-context, si lo hay. */
export function contextoExplicito(comando: string): string | undefined {
  return comando.match(/--(kube-)?context[= ]["']?([^\s"']+)/)?.[2]
}
