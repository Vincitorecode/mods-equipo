// Patrones del Detector de secretos.
//
// Funciones puras: reciben texto y devuelven los hallazgos, ya enmascarados.
// Para agregar un proveedor que usa el equipo, añade una entrada a PATRONES.

export type Hallazgo = {
  /** Qué tipo de secreto parece (ej. "AWS Access Key"). */
  tipo: string
  /** El valor enmascarado, para mostrarlo sin filtrarlo (ej. "AKIA…XY (20)"). */
  muestra: string
  /** Línea donde aparece, contando desde 1. */
  linea: number
}

type Patron = { tipo: string; patron: RegExp; grupo?: number }

const PATRONES: Patron[] = [
  { tipo: 'Llave privada', patron: /-----BEGIN ((RSA|EC|DSA|OPENSSH|PGP|ENCRYPTED) )?PRIVATE KEY( BLOCK)?-----/g },
  { tipo: 'AWS Access Key', patron: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { tipo: 'AWS Secret Key', patron: /aws_?secret_?access_?key["'\s]*[:=]\s*["']?([A-Za-z0-9/+=]{40})\b/gi, grupo: 1 },
  { tipo: 'GitHub token', patron: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g },
  { tipo: 'GitLab token', patron: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { tipo: 'Anthropic API key', patron: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { tipo: 'OpenAI API key', patron: /\bsk-(proj-|svcacct-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}|\bsk-proj-[A-Za-z0-9_-]{40,}/g },
  { tipo: 'Google API key', patron: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { tipo: 'Cuenta de servicio de Google', patron: /"type"\s*:\s*"service_account"[\s\S]{0,400}"private_key"/g },
  { tipo: 'Slack token', patron: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { tipo: 'Slack webhook', patron: /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+/g },
  { tipo: 'Stripe live key', patron: /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
  { tipo: 'Twilio API key', patron: /\bSK[0-9a-f]{32}\b/g },
  { tipo: 'SendGrid API key', patron: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  { tipo: 'npm token', patron: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { tipo: 'JWT', patron: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    tipo: 'Cadena de conexión con contraseña',
    patron: /\b(postgres(ql)?|mysql|mariadb|mongodb(\+srv)?|redis|rediss|amqps?|mssql|sqlserver):\/\/[^:\s/@]+:([^@\s/]{3,})@/gi,
    grupo: 4,
  },
  {
    tipo: 'Contraseña o token en el código',
    patron:
      /\b[A-Za-z0-9_]*(password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)[A-Za-z0-9_]*["']?\s*[:=]\s*["']([^"'\s]{8,})["']/gi,
    grupo: 2,
  },
]

/** Los tipos de secreto que se detectan, para mostrarlos. */
export const TIPOS: string[] = PATRONES.map(p => p.tipo)

/** Valores que son claramente de ejemplo: no cuentan como secreto. */
const DE_EJEMPLO =
  /^(x+|\*+|\.+|-+|0+)$|xxx|\*\*\*|<[^>]*>|\$\{|\{\{|%\(|(^|[^a-z])(your|tu)[_-]|example|ejemplo|changeme|change[_-]me|placeholder|dummy|fake|redacted|sample|test(ing)?[_-]?(key|token|secret|password)?$|^password$|^secret$|process\.env|os\.environ|getenv|import\.meta\.env/i

/** Busca secretos en `texto`. Devuelve un hallazgo por valor distinto. */
export function buscarSecretos(texto: string): Hallazgo[] {
  const hallazgos: Hallazgo[] = []
  const vistos = new Set<string>()
  for (const { tipo, patron, grupo } of PATRONES) {
    patron.lastIndex = 0
    for (const m of texto.matchAll(patron)) {
      const valor = grupo !== undefined ? m[grupo] : m[0]
      if (valor === undefined || DE_EJEMPLO.test(valor) || vistos.has(valor)) continue
      if (tipo === 'Contraseña o token en el código' && !pareceSecreto(m[0], valor)) continue
      vistos.add(valor)
      const linea = texto.slice(0, m.index ?? 0).split('\n').length
      hallazgos.push({ tipo, muestra: enmascarar(tipo === 'Llave privada' ? m[0] : valor), linea })
    }
  }
  return hallazgos
}

/** Nombres que hablan de una contraseña pero no la guardan: passwordLabel, secretName, apiKeyHeader... */
const NOMBRE_NO_SECRETO =
  /(label|text|placeholder|title|hint|message|msg|error|name|id|field|input|header|regex|pattern|min|max|length|len|url|path|route|type|policy|rule|format|description|desc|selector|class|icon)s?$/i

/**
 * Para `nombre = "valor"`: ¿parece un secreto de verdad y no un texto de la UI
 * o un identificador ("Contraseña", "login-password-input", "X-Api-Key")?
 */
function pareceSecreto(asignacion: string, valor: string): boolean {
  const nombre = asignacion.split(/["']?\s*[:=]/)[0] ?? ''
  if (NOMBRE_NO_SECRETO.test(nombre)) return false
  // Un valor muy repetitivo o sin variedad (aaaaaaaa, 12345678) no es un secreto real.
  if (new Set(valor).size < 5) return false
  // Los secretos llevan números o símbolos, o son una cadena larga sin separadores de palabras.
  return /\d/.test(valor) || /[!@#$%^&*+=?~]/.test(valor) || (valor.length >= 20 && !/[-_.]/.test(valor))
}

/** "AKIAABCDEFGHIJKLMNOP" → "AKIA…OP (20 caracteres)" */
export function enmascarar(valor: string): string {
  if (valor.startsWith('-----BEGIN')) return valor
  if (valor.length <= 8) return `${'•'.repeat(valor.length)}`
  return `${valor.slice(0, 4)}…${valor.slice(-2)} (${valor.length} caracteres)`
}

/** Las líneas agregadas (+) de un `git diff`, agrupadas por archivo. */
export function lineasAgregadas(diff: string): Map<string, string> {
  const porArchivo = new Map<string, string>()
  let archivo = '(desconocido)'
  for (const linea of diff.split('\n')) {
    if (linea.startsWith('+++ ')) {
      archivo = linea.slice(4).replace(/^b\//, '')
      continue
    }
    if (linea.startsWith('+') && !linea.startsWith('+++')) {
      porArchivo.set(archivo, `${porArchivo.get(archivo) ?? ''}${linea.slice(1)}\n`)
    }
  }
  return porArchivo
}

/** ¿El comando hace un commit (o un push sin commit previo revisado)? */
export function esCommit(comando: string): boolean {
  return /\bgit\b(\s+-[cC]\s+\S+)*\s+commit\b/.test(comando)
}

/** ¿El commit incluye `-a` / `--all` (agrega archivos modificados además de los staged)? */
export function commitConTodo(comando: string): boolean {
  return /\bcommit\b.*(\s--all\b|\s-[a-zA-Z]*a[a-zA-Z]*\b)/.test(comando)
}

/**
 * Las rutas que un `git add` del mismo comando va a agregar antes del commit
 * (`git add src/a.ts && git commit ...`). undefined si no hay `git add`;
 * [] si agrega todo (`git add .`, `-A`, `--all`).
 */
export function rutasDeGitAdd(comando: string): string[] | undefined {
  let rutas: string[] | undefined
  for (const parte of comando.split(/&&|\|\||;|\n/)) {
    const m = parte.match(/^\s*git(\s+-C\s+\S+)*\s+add\b(.*)$/)
    if (!m) continue
    const args = ((m[2] ?? '').match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(a => a.replace(/^["']|["']$/g, ''))
    const todo = args.some(a => a === '.' || a === '-A' || a === '--all' || a === ':/')
    const nuevas = args.filter(a => !a.startsWith('-'))
    if (todo || nuevas.length === 0 || rutas?.length === 0) rutas = []
    else rutas = [...(rutas ?? []), ...nuevas]
  }
  return rutas
}
