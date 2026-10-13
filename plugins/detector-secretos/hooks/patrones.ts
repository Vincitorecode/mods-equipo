// Patrones del Detector de secretos.
//
// Funciones puras: reciben texto y devuelven los hallazgos, ya enmascarados.
// Para agregar un proveedor, añade una entrada a PATRONES y un caso a
// tests/secretos.test.ts.
//
// Una línea con `secretos:permitir`, `gitleaks:allow` o `pragma: allowlist secret`
// en un comentario no se revisa.

export type Idioma = 'es' | 'en'
export type Texto = Readonly<Record<Idioma, string>>

export type Hallazgo = {
  /** Id del tipo de secreto (ej. "aws-access-key"). */
  id: string
  /** Qué tipo de secreto parece, en los dos idiomas. */
  tipo: Texto
  /** El valor enmascarado, para mostrarlo sin filtrarlo (ej. "AKIA…XY (20)"). */
  muestra: string
  /** Línea donde aparece, contando desde 1. */
  linea: number
}

type Patron = {
  id: string
  tipo: Texto
  patron: RegExp
  /** Grupo con el valor; sin él, todo lo que coincide. */
  grupo?: number
  /** Para asignaciones genéricas: confirmar que el valor parece un secreto real. */
  revisar?: boolean
}

const ASIGNACION = 'asignacion'

/** Nombres de variable que suelen guardar un secreto (dbPassword, API_KEY, client_secret...). */
const NOMBRES_SENSIBLES = [
  '[A-Za-z0-9_.-]*(?:',
  ['password', 'passwd', 'pwd', 'secret', 'api[_-]?key', 'apikey', 'access[_-]?key', 'access[_-]?token', 'auth[_-]?token', 'client[_-]?secret', 'private[_-]?key', 'credentials?', 'token'].join('|'),
  ')[A-Za-z0-9_.-]*',
].join('')

const PATRONES: Patron[] = [
  { id: 'llave-privada', tipo: { es: 'Llave privada', en: 'Private key' }, patron: /-----BEGIN ((RSA|EC|DSA|OPENSSH|PGP|ENCRYPTED) )?PRIVATE KEY( BLOCK)?-----/g },
  { id: 'aws-access-key', tipo: { es: 'AWS Access Key', en: 'AWS Access Key' }, patron: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'aws-secret-key', tipo: { es: 'AWS Secret Key', en: 'AWS Secret Key' }, patron: /aws_?secret_?access_?key["'\s]*[:=]\s*["']?([A-Za-z0-9/+=]{40})\b/gi, grupo: 1 },
  { id: 'github', tipo: { es: 'Token de GitHub', en: 'GitHub token' }, patron: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g },
  { id: 'gitlab', tipo: { es: 'Token de GitLab', en: 'GitLab token' }, patron: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'anthropic', tipo: { es: 'API key de Anthropic', en: 'Anthropic API key' }, patron: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: 'openai', tipo: { es: 'API key de OpenAI', en: 'OpenAI API key' }, patron: /\bsk-(proj-|svcacct-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}|\bsk-proj-[A-Za-z0-9_-]{40,}/g },
  { id: 'google', tipo: { es: 'API key de Google', en: 'Google API key' }, patron: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'google-service-account', tipo: { es: 'Cuenta de servicio de Google', en: 'Google service account' }, patron: /"type"\s*:\s*"service_account"[\s\S]{0,400}"private_key"/g },
  { id: 'azure-storage', tipo: { es: 'Llave de Azure Storage', en: 'Azure Storage key' }, patron: /AccountKey=([A-Za-z0-9+/]{80,}={0,2})/g, grupo: 1 },
  { id: 'slack', tipo: { es: 'Token de Slack', en: 'Slack token' }, patron: /\bxox[abprse]-[A-Za-z0-9-]{10,}/g },
  { id: 'slack-webhook', tipo: { es: 'Webhook de Slack', en: 'Slack webhook' }, patron: /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+/g },
  { id: 'discord-webhook', tipo: { es: 'Webhook de Discord', en: 'Discord webhook' }, patron: /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{30,}/g },
  { id: 'telegram', tipo: { es: 'Token de bot de Telegram', en: 'Telegram bot token' }, patron: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g },
  { id: 'stripe', tipo: { es: 'Llave live de Stripe', en: 'Stripe live key' }, patron: /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
  { id: 'twilio', tipo: { es: 'API key de Twilio', en: 'Twilio API key' }, patron: /\bSK[0-9a-f]{32}\b/g },
  { id: 'sendgrid', tipo: { es: 'API key de SendGrid', en: 'SendGrid API key' }, patron: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  { id: 'mailgun', tipo: { es: 'API key de Mailgun', en: 'Mailgun API key' }, patron: /\bkey-[0-9a-f]{32}\b/g },
  { id: 'npm', tipo: { es: 'Token de npm', en: 'npm token' }, patron: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: 'pypi', tipo: { es: 'Token de PyPI', en: 'PyPI token' }, patron: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/g },
  { id: 'huggingface', tipo: { es: 'Token de Hugging Face', en: 'Hugging Face token' }, patron: /\bhf_[A-Za-z0-9]{34,}\b/g },
  { id: 'digitalocean', tipo: { es: 'Token de DigitalOcean', en: 'DigitalOcean token' }, patron: /\bdo[opr]_v1_[a-f0-9]{64}\b/g },
  { id: 'shopify', tipo: { es: 'Token de Shopify', en: 'Shopify token' }, patron: /\bshp(at|ss|ca|pa)_[a-fA-F0-9]{32}\b/g },
  { id: 'linear', tipo: { es: 'API key de Linear', en: 'Linear API key' }, patron: /\blin_api_[A-Za-z0-9]{40}\b/g },
  { id: 'doppler', tipo: { es: 'Token de Doppler', en: 'Doppler token' }, patron: /\bdp\.(pt|st|sa|ct)\.[A-Za-z0-9]{40,}\b/g },
  { id: 'jwt', tipo: { es: 'JWT', en: 'JWT' }, patron: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    id: 'cadena-conexion',
    tipo: { es: 'Cadena de conexión o URL con contraseña', en: 'Connection string or URL with password' },
    patron: /\b(postgres(ql)?|mysql|mariadb|mongodb(\+srv)?|redis|rediss|amqps?|mssql|sqlserver|https?|ftp|sftp|smtps?):\/\/[^:\s/@"'`]+:([^@\s/"'`]{3,})@/gi,
    grupo: 4,
  },
  {
    // nombre = "valor" en cualquier lenguaje (JS, Python, JSON, Ruby...)
    id: ASIGNACION,
    tipo: { es: 'Contraseña o token en el código', en: 'Password or token in code' },
    patron: new RegExp(`\\b(${NOMBRES_SENSIBLES})["']?\\s*(?::=|=>|[:=])\\s*["'\`]([^"'\`\\s]{8,})["'\`]`, 'gi'),
    grupo: 2,
    revisar: true,
  },
  {
    // NOMBRE=valor sin comillas: .env, YAML, .properties, docker-compose, shell
    id: ASIGNACION,
    tipo: { es: 'Contraseña o token en el código', en: 'Password or token in code' },
    patron: new RegExp(`^[ \\t-]*(?:export\\s+)?(${NOMBRES_SENSIBLES})\\s*[:=][ \\t]*([^\\s"'\`#,;(){}\\[\\]<>]{8,})[ \\t]*(?:#.*)?$`, 'gim'),
    grupo: 2,
    revisar: true,
  },
]

/** Los tipos de secreto que se detectan, para mostrarlos y para apagarlos por id. */
export const TIPOS: { id: string; tipo: Texto }[] = [...new Map(PATRONES.map(p => [p.id, { id: p.id, tipo: p.tipo }])).values()]

/** Valores que son claramente de ejemplo: no cuentan como secreto. */
const DE_EJEMPLO =
  /^(x+|\*+|\.+|-+|0+)$|xxx|\*\*\*|<[^>]*>|\$\{|\{\{|%\(|^\$[A-Za-z_]|(^|[^a-z])(your|tu|my|mi)[_-]|example|ejemplo|changeme|change[_-]me|placeholder|dummy|fake|redacted|sample|replace[_-]?me|todo|test(ing)?[_-]?(key|token|secret|password)?$|^password$|^secret$|process\.env|os\.environ|getenv|import\.meta\.env|^env\(|^!(Ref|Sub|GetAtt)|^secrets\.|^vault:|^arn:aws:secretsmanager/i

/** Comentario que pide no revisar esa línea. */
const PERMITIR_LINEA = /secretos:permitir|gitleaks:allow|pragma:\s*allowlist\s+secret|nosec\b/i

/** Busca secretos en `texto`. Devuelve un hallazgo por valor distinto. */
export function buscarSecretos(texto: string, ignorados: ReadonlySet<string> = new Set()): Hallazgo[] {
  const hallazgos: Hallazgo[] = []
  const vistos = new Set<string>()
  const lineas = texto.split('\n')
  for (const { id, tipo, patron, grupo, revisar } of PATRONES) {
    if (ignorados.has(id)) continue
    patron.lastIndex = 0
    for (const m of texto.matchAll(patron)) {
      const valor = grupo !== undefined ? m[grupo] : m[0]
      if (valor === undefined || DE_EJEMPLO.test(valor) || vistos.has(valor)) continue
      if (revisar && !pareceSecreto(m[1] ?? '', valor)) continue
      const linea = texto.slice(0, m.index ?? 0).split('\n').length
      if (PERMITIR_LINEA.test(lineas[linea - 1] ?? '')) continue
      vistos.add(valor)
      hallazgos.push({ id, tipo, muestra: enmascarar(id === 'llave-privada' ? m[0] : valor), linea })
    }
  }
  return hallazgos.sort((a, b) => a.linea - b.linea)
}

/** Nombres que hablan de una contraseña pero no la guardan: passwordLabel, secretName, apiKeyHeader... */
const NOMBRE_NO_SECRETO =
  /(label|text|placeholder|title|hint|message|msg|error|name|id|field|input|header|regex|pattern|min|max|length|len|url|uri|path|file|route|type|policy|rule|format|description|desc|selector|class|icon|count|expir\w*|ttl|timeout|enabled|required|visible|button|link|key_?id|version|endpoint|provider|ref|env|var|param)s?$/i

/** Nombres de variables de prueba: un valor ahí casi nunca es real. */
const NOMBRE_DE_PRUEBA = /(test|mock|fake|dummy|example|sample|fixture|stub)/i

/**
 * Para `nombre = "valor"`: ¿parece un secreto de verdad y no un texto de la UI
 * o un identificador ("Contraseña", "login-password-input", "X-Api-Key")?
 */
function pareceSecreto(nombre: string, valor: string): boolean {
  if (NOMBRE_NO_SECRETO.test(nombre) || NOMBRE_DE_PRUEBA.test(nombre)) return false
  // Booleanos, números, rutas y llamadas no son secretos.
  if (/^(true|false|null|none|nil|undefined|\d+)$/i.test(valor) || /^[./~]/.test(valor) || /^[A-Za-z_][\w.]*\(/.test(valor)) return false
  // Un valor muy repetitivo o sin variedad (aaaaaaaa, 12345678) no es un secreto real.
  if (new Set(valor).size < 5) return false
  // Los secretos llevan números o símbolos, o son una cadena larga sin separadores de palabras.
  return /\d/.test(valor) || /[!@#$%^&*+=?~]/.test(valor) || (valor.length >= 20 && !/[-_.]/.test(valor))
}

/** Muestra el principio y el final: "ABCD…YZ (20)". */
export function enmascarar(valor: string): string {
  if (valor.startsWith('-----BEGIN')) return valor
  if (valor.length <= 8) return `${'•'.repeat(valor.length)}`
  return `${valor.slice(0, 4)}…${valor.slice(-2)} (${valor.length})`
}

/** "a, b;c" → {a, b, c} */
export function compilarIds(fuente: string): Set<string> {
  return new Set(fuente.split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(s => s !== ''))
}

/** Normaliza una ruta para compararla con el patrón de archivos permitidos (Windows usa \). */
export function rutaNormal(ruta: string): string {
  return ruta.replace(/\\/g, '/')
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

/** ¿El comando hace un commit? */
export function esCommit(comando: string): boolean {
  return /\bgit\b(\s+-[cC]\s+\S+)*\s+commit\b/.test(comando)
}

/** ¿El commit incluye `-a` / `--all` (agrega archivos modificados además de los staged)? */
export function commitConTodo(comando: string): boolean {
  // Sin el mensaje: `-m "add all"` no es `-a`.
  const sinMensaje = comando.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""')
  return /\bcommit\b.*(\s--all\b|\s-[a-zA-Z]*a[a-zA-Z]*\b)/.test(sinMensaje)
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

/**
 * Si un comando de shell escribe a archivos (`> f`, `>> f`, `tee f`, Set-Content),
 * las rutas a las que escribe. [] si no escribe a ninguno.
 */
export function archivosQueEscribe(comando: string): string[] {
  const rutas: string[] = []
  for (const m of comando.matchAll(/(?:^|[^0-9&<>=-])>>?\s*("[^"]+"|'[^']+'|[^\s;&|<>]+)/g)) rutas.push(m[1]!)
  for (const m of comando.matchAll(/\btee(?:\s+-a|\s+--append)*\s+("[^"]+"|'[^']+'|[^\s;&|<>-][^\s;&|<>]*)/g)) rutas.push(m[1]!)
  for (const m of comando.matchAll(/\b(?:Set-Content|Add-Content|Out-File)\b[^|;\n]*?(?:-(?:Path|FilePath)\s+)?("[^"]+"|'[^']+'|[^\s;|-][^\s;|]*)/gi)) rutas.push(m[1]!)
  return rutas.map(r => r.replace(/^["']|["']$/g, '')).filter(r => !/^\/dev\/(null|stdout|stderr)$/.test(r) && r !== '&1' && r !== '&2')
}
