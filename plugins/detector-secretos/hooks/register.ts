// Detector de secretos
//
// Revisa, antes de que ocurra:
//   • lo que Claude escribe con Write, Edit y NotebookEdit
//   • lo que va a entrar en un `git commit` (los cambios en stage, y los
//     modificados si el commit usa -a)
// Si encuentra algo que parece una API key, token, llave privada, cadena de
// conexión con contraseña, etc., se detiene y te muestra lo encontrado
// (enmascarado). En modo "bloquear" lo impide sin preguntar.
//
// Los .env locales se permiten por defecto: es donde los secretos deben vivir.

import type { EngineInterface, Register } from 'claude-code'

import { buscarSecretos, commitConTodo, esCommit, lineasAgregadas, rutasDeGitAdd } from './patrones'
import type { Hallazgo } from './patrones'

const PERMITIR = 'Permitir esta vez'
const BLOQUEAR = 'Bloquear'
const PERMITIDOS_DEFECTO = '(^|/)\\.env(\\.(local|development|test))?$'

type Revision = { donde: string; hallazgos: Hallazgo[] }

export const register: Register = (on, options) => {
  const soloBloquear = options.modo === 'bloquear'
  let permitidos: RegExp
  try {
    permitidos = new RegExp(String(options.archivosPermitidos || PERMITIDOS_DEFECTO))
  } catch {
    permitidos = new RegExp(PERMITIDOS_DEFECTO)
  }
  const permitido = (ruta: string) => permitidos.test(ruta)

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (permitido(e.file_path)) return next(e)
    const motivo = await decidir($, soloBloquear, [{ donde: e.file_path, hallazgos: buscarSecretos(e.content) }])
    return motivo === undefined ? next(e) : { deny: motivo }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: FALLO }))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (permitido(e.file_path)) return next(e)
    const motivo = await decidir($, soloBloquear, [{ donde: e.file_path, hallazgos: buscarSecretos(e.new_string) }])
    return motivo === undefined ? next(e) : { deny: motivo }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: FALLO }))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const motivo = await decidir($, soloBloquear, [{ donde: e.notebook_path, hallazgos: buscarSecretos(e.new_source) }])
    return motivo === undefined ? next(e) : { deny: motivo }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: FALLO }))

  // git commit: revisa lo que va a entrar al historial (ahí un secreto ya es difícil de borrar).
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const comando = String(e.command ?? '')
    if (!esCommit(comando)) return next(e)

    const cwd = await carpetaDelComando($, comando)
    const diffs = [await diff($, cwd, ['diff', '--cached', '-U0', '--no-color'])]
    if (commitConTodo(comando)) diffs.push(await diff($, cwd, ['diff', '-U0', '--no-color']))
    // `git add ... && git commit` en un solo comando: lo que se va a agregar aún no está en stage.
    const rutas = rutasDeGitAdd(comando)
    if (rutas !== undefined) {
      diffs.push(await diff($, cwd, ['diff', '-U0', '--no-color', '--', ...rutas]))
      const nuevos = (await diff($, cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...rutas])).split('\0').filter(f => f !== '')
      for (const archivo of nuevos.slice(0, MAX_NUEVOS)) {
        diffs.push(await diff($, cwd, ['diff', '--no-index', '-U0', '--no-color', '--', '/dev/null', archivo]))
      }
    }

    const revisiones: Revision[] = []
    for (const [archivo, texto] of lineasAgregadas(diffs.join('\n'))) {
      if (permitido(archivo)) {
        revisiones.push({ donde: `${archivo} (archivo .env en el commit)`, hallazgos: [{ tipo: 'Archivo de entorno versionado', muestra: archivo, linea: 0 }] })
        continue
      }
      revisiones.push({ donde: archivo, hallazgos: buscarSecretos(texto) })
    }
    const motivo = await decidir($, soloBloquear, revisiones, 'commit')
    return motivo === undefined ? next(e) : { deny: motivo }
  }).catch(($, e, next) => next(e))
  // ↑ En commits, si la revisión falla (ej. no es un repo git) se deja seguir: git dará su propio error.
}

/** Archivos nuevos (sin versionar) que se revisan como máximo en un `git add && git commit`. */
const MAX_NUEVOS = 50

const FALLO = 'detector-secretos: hubo un error al revisar el contenido, así que no se escribió por seguridad.'

/**
 * Devuelve undefined si se puede continuar, o el texto para Claude si no.
 */
async function decidir(
  $: EngineInterface,
  soloBloquear: boolean,
  revisiones: Revision[],
  accion: 'escritura' | 'commit' = 'escritura',
): Promise<string | undefined> {
  const conHallazgos = revisiones.filter(r => r.hallazgos.length > 0)
  if (conHallazgos.length === 0) return undefined

  const detalle = conHallazgos
    .flatMap(r => r.hallazgos.map(h => `• ${r.donde}${h.linea > 0 ? `:${h.linea}` : ''} — ${h.tipo}: ${h.muestra}`))
    .slice(0, 8)
    .join('\n')
  const total = conHallazgos.reduce((n, r) => n + r.hallazgos.length, 0)
  const resumenTipos = [...new Set(conHallazgos.flatMap(r => r.hallazgos.map(h => h.tipo)))].join(', ')

  const paraClaude =
    `Detector de secretos detuvo ${accion === 'commit' ? 'el commit' : 'la escritura'}: ` +
    `encontró ${total} posible(s) secreto(s) (${resumenTipos}) en ${conHallazgos.map(r => r.donde).join(', ')}. ` +
    (accion === 'commit'
      ? 'Saca esos archivos o líneas del stage (git restore --staged), mueve los valores a variables de entorno y asegúrate de que .env esté en .gitignore. '
      : 'No pongas secretos en el código: léelos de variables de entorno (process.env, os.environ, etc.) y deja un placeholder en .env.example. ') +
    'Si el usuario dice que es un valor de prueba, pregúntale antes de reintentar.'

  if (soloBloquear) {
    $.ui.toast(`Detector de secretos bloqueó ${accion === 'commit' ? 'un commit' : 'una escritura'} (${resumenTipos})`)
    return paraClaude
  }

  let respuesta: string
  try {
    respuesta = await $.ui.ask(
      `🔑 Posibles secretos ${accion === 'commit' ? 'en el commit' : 'en lo que Claude va a escribir'}:\n\n${detalle}` +
        (total > 8 ? `\n…y ${total - 8} más` : '') +
        `\n\n¿Qué hago?`,
      { header: 'Secretos', options: [BLOQUEAR, PERMITIR] },
    )
  } catch {
    return paraClaude
  }
  if (respuesta === PERMITIR) {
    $.ui.log(`detector-secretos: el usuario permitió ${accion} con ${total} hallazgo(s): ${resumenTipos}`, { to: 'debug' })
    return undefined
  }
  return paraClaude
}

/** La carpeta donde corre el commit: la de la sesión, movida por `cd x &&` o `git -C x`. */
async function carpetaDelComando($: EngineInterface, comando: string): Promise<string> {
  const base = await $.session.cwd()
  const destino = comando.match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/)?.[1] ?? comando.match(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*&&/)?.[1]
  if (destino === undefined) return base
  const limpio = destino.replace(/^["']|["']$/g, '')
  return limpio.startsWith('/') ? limpio : `${base}/${limpio}`
}

async function diff($: EngineInterface, cwd: string, args: string[]): Promise<string> {
  const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 10000 })
  // `git diff --no-index` termina con 1 cuando hay diferencias.
  return r.exitCode === 0 || (args.includes('--no-index') && r.exitCode === 1) ? r.stdout : ''
}
