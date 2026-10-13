// Detector de secretos
//
// Revisa, antes de que ocurra:
//   • lo que Claude escribe con Write, Edit y NotebookEdit
//   • lo que Claude escribe a un archivo desde la shell (`> archivo`, `tee`, heredocs)
//   • lo que va a entrar en un `git commit` (los cambios en stage, y los
//     modificados si el commit usa -a)
// Si encuentra algo que parece una API key, token, llave privada, cadena de
// conexión con contraseña, etc., se detiene y te muestra lo encontrado
// (enmascarado). En modo "bloquear" lo impide sin preguntar.
//
// Los .env locales se permiten por defecto: es donde los secretos deben vivir.
//
// • Línea de estado bajo el prompt: detector activo, modo y lo detectado.
// • /secretos abre un panel con lo que revisa y el historial de la sesión.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Deteccion } from '../types'
import { elegirIdioma, locale } from './idioma'
import type { Idioma } from './idioma'
import { TIPOS, archivosQueEscribe, buscarSecretos, commitConTodo, compilarIds, esCommit, lineasAgregadas, rutaNormal, rutasDeGitAdd } from './patrones'
import type { Hallazgo, Texto } from './patrones'

const PERMITIDOS_DEFECTO = '(^|/)\\.env(\\.(local|development|test))?$'

const PANEL = 'detector-secretos'
const HISTORIA = 50
/** Archivos nuevos (sin versionar) que se revisan como máximo en un `git add && git commit`. */
const MAX_NUEVOS = 50
/** Hallazgos que caben en el diálogo; el resto se ve en /secretos. */
const MAX_DIALOGO = 4

const T = {
  permitir: { es: 'Permitir esta vez', en: 'Allow this time' },
  bloquear: { es: 'Bloquear', en: 'Block' },
  comando: { es: 'Qué revisa el detector de secretos y lo que detectó en esta sesión', en: 'What the secret detector checks and what it found this session' },
  titulo: { es: 'Detector de secretos', en: 'Secret detector' },
  abierto: { es: 'Panel del detector de secretos abierto.', en: 'Secret detector panel opened.' },
  fallo: {
    es: 'detector-secretos: hubo un error al revisar el contenido, así que no se escribió por seguridad.',
    en: 'detector-secretos: checking the content failed, so it was not written, to be safe.',
  },
} satisfies Record<string, Texto>

type Revision = { donde: string; hallazgos: Hallazgo[] }
type Ajustes = { L: Idioma; soloBloquear: boolean }

const detecciones = atom({ plugin: 'detector-secretos', key: 'detecciones' } as const, [] as Deteccion[])
const revisados = atom({ plugin: 'detector-secretos', key: 'revisados' } as const, 0)

export const register: Register = (on, options) => {
  const soloBloquear = options.modo === 'bloquear'
  let permitidos: RegExp
  try {
    permitidos = new RegExp(String(options.archivosPermitidos || PERMITIDOS_DEFECTO), 'i')
  } catch {
    permitidos = new RegExp(PERMITIDOS_DEFECTO, 'i')
  }
  const ignorados = compilarIds(String(options.tiposIgnorados ?? ''))
  const permitido = (ruta: string) => permitidos.test(rutaNormal(ruta))
  const buscar = (texto: string) => buscarSecretos(texto, ignorados)

  let L: Idioma = elegirIdioma(options.idioma, undefined, [])
  const t = (x: Texto) => x[L]
  const aj = () => ({ L, soloBloquear })

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    L = await idiomaDeSesion($, options.idioma)
    await $.command.register({ name: 'secretos', description: t(T.comando) })
    await pintarEstado($, aj())
    return r
  })

  on('command.run', { command: 'secretos' }, async $ => {
    await $.ui.open({ id: PANEL, title: t(T.titulo), closeOnEscape: true })
    return { text: t(T.abierto) }
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (permitido(e.file_path)) return next(e)
    const motivo = await decidir($, aj(), [{ donde: e.file_path, hallazgos: buscar(e.content) }])
    return motivo === undefined ? next(e) : { deny: motivo }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: t(T.fallo) }))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (permitido(e.file_path)) return next(e)
    const motivo = await decidir($, aj(), [{ donde: e.file_path, hallazgos: buscar(e.new_string) }])
    return motivo === undefined ? next(e) : { deny: motivo }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: t(T.fallo) }))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const motivo = await decidir($, aj(), [{ donde: e.notebook_path, hallazgos: buscar(e.new_source) }])
    return motivo === undefined ? next(e) : { deny: motivo }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: t(T.fallo) }))

  // Shell: lo que escribe a archivos, y lo que va a entrar a un commit (ahí un secreto ya es difícil de borrar).
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const comando = String(e.command ?? '')

    const destinos = archivosQueEscribe(comando).filter(f => !permitido(f))
    if (destinos.length > 0) {
      const motivo = await decidir($, aj(), [{ donde: destinos.join(', '), hallazgos: buscar(comando) }])
      if (motivo !== undefined) return { deny: motivo }
    }

    if (!esCommit(comando)) return next(e)
    let revisiones: Revision[]
    try {
      revisiones = await revisarCommit($, comando, permitido, buscar)
    } catch {
      // Si la revisión falla (ej. no es un repo git) se deja seguir: git dará su propio error.
      return next(e)
    }
    const motivo = await decidir($, aj(), revisiones, 'commit')
    return motivo === undefined ? next(e) : { deny: motivo }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: t(T.fallo) }))

  // ---- Panel /secretos ----
  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const es = L === 'es'
    const lista = await read($, detecciones)
    const total = await read($, revisados)
    const ancho = Math.max(30, (e.props.bodyColumns ?? 60) - 2)
    const filas = Math.max(2, Math.floor(((e.viewport?.rows ?? 30) - 20) / 4))
    const recientes = lista.slice(-filas).reverse()
    const bloqueados = lista.filter(d => d.decision === 'bloqueado').length
    const permitidas = lista.length - bloqueados
    const s = (n: number) => (n === 1 ? '' : 's')

    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor={lista.length > 0 ? 'yellow' : 'green'} paddingX={1} flexDirection="column">
          <Text bold color="green">{es ? '🔑 Detector de secretos activo' : '🔑 Secret detector active'}</Text>
          <Text>
            <Text dimColor>{es ? 'Modo: ' : 'Mode: '}</Text>
            {soloBloquear ? <Text color="red" bold>{es ? 'bloquear' : 'block'}</Text> : <Text>{es ? 'preguntar' : 'ask'}</Text>}
            <Text dimColor>{soloBloquear ? (es ? ' (lo impide sin preguntar)' : ' (blocks without asking)') : es ? ' (te muestra lo encontrado y decides)' : ' (shows what it found and you decide)'}</Text>
          </Text>
          <Text>
            <Text dimColor>{es ? 'Se permiten en: ' : 'Allowed in: '}</Text>
            {recortar(`/${permitidos.source}/`, ancho - 18)}
          </Text>
          {ignorados.size > 0 && <Text dimColor>{recortar(`${es ? 'Tipos apagados' : 'Disabled types'}: ${[...ignorados].join(', ')}`, ancho)}</Text>}
          <Text>
            <Text dimColor>{es ? 'Esta sesión: ' : 'This session: '}</Text>
            {es ? `${total} revisión${total === 1 ? '' : 'es'} · ${lista.length} con secretos · ` : `${total} check${s(total)} · ${lista.length} with secrets · `}
            <Text color="green">{es ? `${bloqueados} bloqueada${s(bloqueados)}` : `${bloqueados} blocked`}</Text> · <Text color="yellow">{es ? `${permitidas} permitida${s(permitidas)}` : `${permitidas} allowed`}</Text>
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>{es ? 'Historial' : 'History'}</Text>
          {recientes.length === 0 && <Text dimColor>{es ? 'Sin secretos detectados. Si Claude intenta escribir o commitear uno, aparecerá aquí (enmascarado).' : 'No secrets found. If Claude tries to write or commit one, it will show up here (masked).'}</Text>}
          {recientes.map((d, i) => (
            <Box key={`d${lista.length - i}`} flexDirection="column" marginBottom={i < recientes.length - 1 ? 1 : 0}>
              <Text>
                <Text color={d.decision === 'bloqueado' ? 'green' : 'yellow'}>{d.decision === 'bloqueado' ? (es ? '■ bloqueado' : '■ blocked') : es ? '▶ permitido' : '▶ allowed'}</Text>
                <Text dimColor>  {hora(d.hora, L)} · {d.accion === 'commit' ? 'commit' : es ? 'escritura' : 'write'} · {d.total} {es ? `hallazgo${s(d.total)}` : `finding${s(d.total)}`}</Text>
              </Text>
              {d.hallazgos.slice(0, 3).map((hallazgo, j) => (
                <Text key={`h${j}`}>  {recortar(hallazgo, ancho - 2)}</Text>
              ))}
              {d.hallazgos.length > 3 && <Text dimColor>  {es ? `…y ${d.hallazgos.length - 3} más` : `…and ${d.hallazgos.length - 3} more`}</Text>}
            </Box>
          ))}
          {lista.length > recientes.length && <Text dimColor>{es ? `…y ${lista.length - recientes.length} más antiguos` : `…and ${lista.length - recientes.length} older`}</Text>}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>{es ? 'Qué revisa' : 'What it checks'}</Text>
          <Text dimColor>{es ? 'Write, Edit, NotebookEdit y lo que la shell escribe a archivos, antes de escribir; y lo que entra en cada git commit.' : 'Write, Edit, NotebookEdit and what the shell writes to files, before writing; and what goes into each git commit.'}</Text>
          <Text dimColor>{recortar(TIPOS.filter(x => !ignorados.has(x.id)).map(x => t(x.tipo)).join(' · '), ancho * 3)}</Text>
          <Text dimColor>{es ? 'Para permitir una línea: agrega el comentario secretos:permitir (o gitleaks:allow).' : 'To allow one line: add the comment secretos:permitir (or gitleaks:allow).'}</Text>
        </Box>

        {lista.length > 0 && (
          <Box marginTop={1}>
            <Button key="limpiar" label={es ? 'Limpiar historial' : 'Clear history'} hotkey="l" onPress={async () => { await update($, detecciones, () => []); await pintarEstado($, aj()) }} />
          </Box>
        )}
      </Box>
    )
  })
}

/** Lo que va a entrar al commit, por archivo. */
async function revisarCommit($: EngineInterface, comando: string, permitido: (ruta: string) => boolean, buscar: (texto: string) => Hallazgo[]): Promise<Revision[]> {
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
      revisiones.push({ donde: archivo, hallazgos: [{ id: 'env', tipo: { es: 'Archivo de entorno versionado', en: 'Environment file committed' }, muestra: archivo, linea: 0 }] })
      continue
    }
    revisiones.push({ donde: archivo, hallazgos: buscar(texto) })
  }
  return revisiones
}

/**
 * Devuelve undefined si se puede continuar, o el texto para Claude si no.
 */
async function decidir($: EngineInterface, aj: Ajustes, revisiones: Revision[], accion: 'escritura' | 'commit' = 'escritura'): Promise<string | undefined> {
  const { L, soloBloquear } = aj
  const es = L === 'es'
  await update($, revisados, n => n + 1)
  const conHallazgos = revisiones.filter(r => r.hallazgos.length > 0)
  if (conHallazgos.length === 0) return undefined

  const lineas = conHallazgos.flatMap(r => r.hallazgos.map(h => `${nombreCorto(r.donde)}${h.linea > 0 ? `:${h.linea}` : ''} — ${h.tipo[L]}: ${h.muestra}`))
  const total = lineas.length
  const tipos = [...new Set(conHallazgos.flatMap(r => r.hallazgos.map(h => h.tipo.en)))].join(', ')
  const tiposLocal = [...new Set(conHallazgos.flatMap(r => r.hallazgos.map(h => h.tipo[L])))].join(', ')

  const paraClaude =
    `Detector de secretos (secret detector) stopped ${accion === 'commit' ? 'the commit' : 'the write'}: ` +
    `found ${total} possible secret(s) (${tipos}) in ${conHallazgos.map(r => r.donde).join(', ')}. ` +
    (accion === 'commit'
      ? 'Unstage those files or lines (git restore --staged), move the values to environment variables and make sure .env is in .gitignore. '
      : 'Do not put secrets in code: read them from environment variables (process.env, os.environ, etc.) and leave a placeholder in .env.example. ') +
    'If the user says it is a test value, ask them before retrying; they can add the comment secretos:permitir to that line.'

  const anotar = (decision: Deteccion['decision']) => anotarDeteccion($, aj, accion, lineas, total, decision)
  const queCosa = accion === 'commit' ? (es ? 'el commit' : 'the commit') : es ? 'la escritura' : 'the write'

  if (soloBloquear) {
    await anotar('bloqueado')
    $.ui.toast(es ? `🔑 Detector de secretos bloqueó ${queCosa} (${tiposLocal})` : `🔑 Secret detector blocked ${queCosa} (${tiposLocal})`)
    return paraClaude
  }

  // Diálogo corto: los primeros hallazgos; el resto en /secretos.
  const detalle = lineas.slice(0, MAX_DIALOGO).map(l => `• ${l}`).join('\n')
  const resto = total - MAX_DIALOGO
  let respuesta: string
  try {
    respuesta = await $.ui.ask(
      (es ? `🔑 Posibles secretos ${accion === 'commit' ? 'en el commit' : 'en lo que Claude va a escribir'}:\n` : `🔑 Possible secrets ${accion === 'commit' ? 'in the commit' : 'in what Claude is about to write'}:\n`) +
        detalle +
        (resto > 0 ? (es ? `\n  +${resto} más (en /secretos)` : `\n  +${resto} more (in /secretos)`) : ''),
      { header: es ? 'Secretos' : 'Secrets', options: [T.bloquear[L], T.permitir[L]] },
    )
  } catch {
    await anotar('bloqueado')
    return paraClaude
  }
  if (respuesta === T.permitir[L]) {
    await anotar('permitido')
    $.ui.log(`detector-secretos: el usuario permitió ${accion} con ${total} hallazgo(s): ${tipos}`, { to: 'debug' })
    return undefined
  }
  await anotar('bloqueado')
  $.ui.toast(es ? `🔑 Detector de secretos bloqueó ${queCosa}. Detalle en /secretos` : `🔑 Secret detector blocked ${queCosa}. Details in /secretos`)
  return paraClaude
}

/** Guarda en el historial lo detectado (ya enmascarado) y lo que pasó. */
async function anotarDeteccion($: EngineInterface, aj: Ajustes, accion: Deteccion['accion'], hallazgos: string[], total: number, decision: Deteccion['decision']): Promise<void> {
  // El historial es solo para mostrar: si falla, la decisión de seguridad sigue igual.
  try {
    const deteccion: Deteccion = { hora: await $.clock.now(), accion, hallazgos: hallazgos.slice(0, 20), total, decision }
    await update($, detecciones, lista => [...lista, deteccion].slice(-HISTORIA))
    await pintarEstado($, aj)
  } catch {
    // nada
  }
}

/** Pinta la línea de estado bajo el prompt. */
async function pintarEstado($: EngineInterface, aj: Ajustes): Promise<void> {
  const es = aj.L === 'es'
  const lista = await read($, detecciones)
  const partes = [es ? `🔑 Secretos: ${aj.soloBloquear ? 'bloquear' : 'preguntar'}` : `🔑 Secrets: ${aj.soloBloquear ? 'block' : 'ask'}`]
  if (lista.length > 0) {
    const bloqueados = lista.filter(d => d.decision === 'bloqueado').length
    const s = (n: number) => (n === 1 ? '' : 's')
    partes.push(
      es
        ? `${lista.length} detectado${s(lista.length)}${bloqueados > 0 ? ` (${bloqueados} bloqueado${s(bloqueados)})` : ''}`
        : `${lista.length} found${bloqueados > 0 ? ` (${bloqueados} blocked)` : ''}`,
    )
  }
  partes.push('/secretos')
  $.ui.status(partes.join(' · '))
}

async function idiomaDeSesion($: EngineInterface, opcion: unknown): Promise<Idioma> {
  if (opcion === 'es' || opcion === 'en') return opcion
  const ajuste = await $.settings.read().then(s => s.language, () => undefined)
  const lcAll = await $.env.get('LC_ALL').catch(() => undefined)
  const lang = await $.env.get('LANG').catch(() => undefined)
  return elegirIdioma(opcion, ajuste, [lcAll, lang])
}

/** "/Users/ana/proyecto/src/config.ts" → "src/config.ts": lo que importa cabe en el diálogo. */
function nombreCorto(ruta: string): string {
  const partes = rutaNormal(ruta).split('/').filter(p => p !== '')
  return partes.length > 3 ? `…/${partes.slice(-3).join('/')}` : ruta
}

function recortar(texto: string, max: number): string {
  const una = texto.replace(/\s+/g, ' ').trim()
  return una.length > max ? `${una.slice(0, Math.max(1, max - 1))}…` : una
}

function hora(ms: number, L: Idioma): string {
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(locale(L), { hour: '2-digit', minute: '2-digit' })
}

/** La carpeta donde corre el commit: la de la sesión, movida por `cd x &&` o `git -C x`. */
async function carpetaDelComando($: EngineInterface, comando: string): Promise<string> {
  const base = await $.session.cwd()
  const destino = comando.match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/)?.[1] ?? comando.match(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*&&/)?.[1]
  if (destino === undefined) return base
  const limpio = destino.replace(/^["']|["']$/g, '')
  return /^([/~]|[A-Za-z]:[\\/])/.test(limpio) ? limpio : `${base}/${limpio}`
}

async function diff($: EngineInterface, cwd: string, args: string[]): Promise<string> {
  const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 10000 })
  // `git diff --no-index` termina con 1 cuando hay diferencias.
  return r.exitCode === 0 || (args.includes('--no-index') && r.exitCode === 1) ? r.stdout : ''
}
