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
//
// • Línea de estado bajo el prompt: detector activo, modo y lo detectado.
// • /secretos abre un panel con lo que revisa y el historial de la sesión.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Deteccion } from '../types'
import { TIPOS, buscarSecretos, commitConTodo, esCommit, lineasAgregadas, rutasDeGitAdd } from './patrones'
import type { Hallazgo } from './patrones'

const PERMITIR = 'Permitir esta vez'
const BLOQUEAR = 'Bloquear'
const PERMITIDOS_DEFECTO = '(^|/)\\.env(\\.(local|development|test))?$'

const PANEL = 'detector-secretos'
const HISTORIA = 50

type Revision = { donde: string; hallazgos: Hallazgo[] }

const detecciones = atom({ plugin: 'detector-secretos', key: 'detecciones' } as const, [] as Deteccion[])
const revisados = atom({ plugin: 'detector-secretos', key: 'revisados' } as const, 0)

export const register: Register = (on, options) => {
  const soloBloquear = options.modo === 'bloquear'
  let permitidos: RegExp
  try {
    permitidos = new RegExp(String(options.archivosPermitidos || PERMITIDOS_DEFECTO))
  } catch {
    permitidos = new RegExp(PERMITIDOS_DEFECTO)
  }
  const permitido = (ruta: string) => permitidos.test(ruta)

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'secretos', description: 'Qué revisa el detector de secretos y lo que detectó en esta sesión' })
    await pintarEstado($, soloBloquear)
    return r
  })

  on('command.run', { command: 'secretos' }, async $ => {
    await $.ui.open({ id: PANEL, title: 'Detector de secretos', closeOnEscape: true })
    return { text: 'Panel del detector de secretos abierto.' }
  })

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

  // ---- Panel /secretos ----
  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const lista = await read($, detecciones)
    const total = await read($, revisados)
    const ancho = Math.max(30, (e.props.bodyColumns ?? 60) - 2)
    const filas = Math.max(2, Math.floor(((e.viewport?.rows ?? 30) - 20) / 4))
    const recientes = lista.slice(-filas).reverse()
    const bloqueados = lista.filter(d => d.decision === 'bloqueado').length

    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor={lista.length > 0 ? 'yellow' : 'green'} paddingX={1} flexDirection="column">
          <Text bold color="green">🔑 Detector de secretos activo</Text>
          <Text>
            <Text dimColor>Modo: </Text>
            {soloBloquear ? <Text color="red" bold>bloquear</Text> : <Text>preguntar</Text>}
            <Text dimColor>{soloBloquear ? ' (lo impide sin preguntar)' : ' (te muestra lo encontrado y decides)'}</Text>
          </Text>
          <Text>
            <Text dimColor>Se permiten en: </Text>
            {recortar(`/${permitidos.source}/`, ancho - 18)}
          </Text>
          <Text>
            <Text dimColor>Esta sesión: </Text>
            {total} revisión{total === 1 ? '' : 'es'} · {lista.length} con secretos · <Text color="green">{bloqueados} bloqueada{bloqueados === 1 ? '' : 's'}</Text> · <Text color="yellow">{lista.length - bloqueados} permitida{lista.length - bloqueados === 1 ? '' : 's'}</Text>
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Historial</Text>
          {recientes.length === 0 && <Text dimColor>Sin secretos detectados. Si Claude intenta escribir o commitear uno, aparecerá aquí (enmascarado).</Text>}
          {recientes.map((d, i) => (
            <Box key={`d${lista.length - i}`} flexDirection="column" marginBottom={i < recientes.length - 1 ? 1 : 0}>
              <Text>
                <Text color={d.decision === 'bloqueado' ? 'green' : 'yellow'}>{d.decision === 'bloqueado' ? '■ bloqueado' : '▶ permitido'}</Text>
                <Text dimColor>  {hora(d.hora)} · {d.accion === 'commit' ? 'commit' : 'escritura'} · {d.total} hallazgo{d.total === 1 ? '' : 's'}</Text>
              </Text>
              {d.hallazgos.slice(0, 3).map((hallazgo, j) => (
                <Text key={`h${j}`}>  {recortar(hallazgo, ancho - 2)}</Text>
              ))}
              {d.hallazgos.length > 3 && <Text dimColor>  …y {d.hallazgos.length - 3} más</Text>}
            </Box>
          ))}
          {lista.length > recientes.length && <Text dimColor>…y {lista.length - recientes.length} más antiguos</Text>}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Qué revisa</Text>
          <Text dimColor>Write, Edit y NotebookEdit antes de escribir, y lo que entra en cada git commit.</Text>
          <Text dimColor>{recortar(TIPOS.join(' · '), ancho * 3)}</Text>
        </Box>

        {lista.length > 0 && (
          <Box marginTop={1}>
            <Button key="limpiar" label="Limpiar historial" hotkey="l" onPress={async () => { await update($, detecciones, () => []); await pintarEstado($, soloBloquear) }} />
          </Box>
        )}
      </Box>
    )
  })
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
  await update($, revisados, n => n + 1)
  const conHallazgos = revisiones.filter(r => r.hallazgos.length > 0)
  if (conHallazgos.length === 0) return undefined

  const lineas = conHallazgos.flatMap(r => r.hallazgos.map(h => `${r.donde}${h.linea > 0 ? `:${h.linea}` : ''} — ${h.tipo}: ${h.muestra}`))
  const detalle = lineas.slice(0, 8).map(l => `• ${l}`).join('\n')
  const total = conHallazgos.reduce((n, r) => n + r.hallazgos.length, 0)
  const resumenTipos = [...new Set(conHallazgos.flatMap(r => r.hallazgos.map(h => h.tipo)))].join(', ')

  const paraClaude =
    `Detector de secretos detuvo ${accion === 'commit' ? 'el commit' : 'la escritura'}: ` +
    `encontró ${total} posible(s) secreto(s) (${resumenTipos}) en ${conHallazgos.map(r => r.donde).join(', ')}. ` +
    (accion === 'commit'
      ? 'Saca esos archivos o líneas del stage (git restore --staged), mueve los valores a variables de entorno y asegúrate de que .env esté en .gitignore. '
      : 'No pongas secretos en el código: léelos de variables de entorno (process.env, os.environ, etc.) y deja un placeholder en .env.example. ') +
    'Si el usuario dice que es un valor de prueba, pregúntale antes de reintentar.'

  const anotar = (decision: Deteccion['decision']) => anotarDeteccion($, soloBloquear, accion, lineas, total, decision)

  if (soloBloquear) {
    await anotar('bloqueado')
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
    await anotar('bloqueado')
    return paraClaude
  }
  if (respuesta === PERMITIR) {
    await anotar('permitido')
    $.ui.log(`detector-secretos: el usuario permitió ${accion} con ${total} hallazgo(s): ${resumenTipos}`, { to: 'debug' })
    return undefined
  }
  await anotar('bloqueado')
  $.ui.toast(`🔑 Detector de secretos bloqueó ${accion === 'commit' ? 'el commit' : 'la escritura'}. Detalle en /secretos`)
  return paraClaude
}

/** Guarda en el historial lo detectado (ya enmascarado) y lo que pasó. */
async function anotarDeteccion(
  $: EngineInterface,
  soloBloquear: boolean,
  accion: Deteccion['accion'],
  hallazgos: string[],
  total: number,
  decision: Deteccion['decision'],
): Promise<void> {
  // El historial es solo para mostrar: si falla, la decisión de seguridad sigue igual.
  try {
    const deteccion: Deteccion = { hora: await $.clock.now(), accion, hallazgos: hallazgos.slice(0, 20), total, decision }
    await update($, detecciones, lista => [...lista, deteccion].slice(-HISTORIA))
    await pintarEstado($, soloBloquear)
  } catch {
    // nada
  }
}

/** Pinta la línea de estado bajo el prompt. */
async function pintarEstado($: EngineInterface, soloBloquear: boolean): Promise<void> {
  const lista = await read($, detecciones)
  const partes = [`🔑 Secretos: ${soloBloquear ? 'bloquear' : 'preguntar'}`]
  if (lista.length > 0) {
    const bloqueados = lista.filter(d => d.decision === 'bloqueado').length
    partes.push(`${lista.length} detectado${lista.length === 1 ? '' : 's'}${bloqueados > 0 ? ` (${bloqueados} bloqueado${bloqueados === 1 ? '' : 's'})` : ''}`)
  }
  partes.push('/secretos')
  $.ui.status(partes.join(' · '))
}

function recortar(texto: string, max: number): string {
  const una = texto.replace(/\s+/g, ' ').trim()
  return una.length > max ? `${una.slice(0, Math.max(1, max - 1))}…` : una
}

function hora(ms: number): string {
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
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
