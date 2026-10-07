// Contexto y costo
//
// • Banda sobre el prompt: % de contexto usado con su tendencia, costo de la
//   sesión, costo del último turno y el límite de uso más cercano.
// • Aviso (toast) al pasar el umbral de contexto configurado, y otro al 95%.
// • /costo abre un panel con el detalle por turno y los límites de uso.
//
// Los costos son los mismos que calcula /cost (equivalente en precio de API).
// Con un plan de suscripción no se cobran así, pero sirven para comparar.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Lectura, Limite } from '../types'

const PANEL = 'contexto-costo'
const HISTORIA = 30
const BARRAS = '▁▂▃▄▅▆▇█'

const lecturas = atom({ plugin: 'contexto-costo', key: 'lecturas' } as const, [] as Lectura[])
const limites = atom({ plugin: 'contexto-costo', key: 'limites' } as const, [] as Limite[])
const alertado = atom({ plugin: 'contexto-costo', key: 'alertado' } as const, 0)

export const register: Register = (on, options) => {
  const umbral = clamp(Number(options.umbralAlerta ?? 80), 10, 99)
  const mostrarBanda = options.mostrarBanda !== false

  // Datos del turno en curso (solo los usa el hook de cierre de turno).
  let usdAlInicio = 0
  let herramientas = 0

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'costo', description: 'Detalle de contexto, costo por turno y límites de uso' })
    const uso = await leerUso($)
    usdAlInicio = uso?.usd ?? 0
    return r
  })

  on('command.run', { command: 'costo' }, async $ => {
    await $.ui.open({ id: PANEL, title: 'Contexto y costo', closeOnEscape: true })
    return { text: 'Panel de contexto y costo abierto.' }
  })

  on('prompt.submit', async ($, e, next) => {
    herramientas = 0
    usdAlInicio = (await leerUso($))?.usd ?? usdAlInicio
    return next(e)
  }).catch(($, e, next) => next(e)) // la banda nunca debe frenar un prompt

  on('tool.call', ($, e, next) => {
    if (e.agentId === undefined) herramientas += 1
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r // los subagentes no cierran el turno principal

    const uso = await leerUso($)
    if (uso === undefined) return r

    const lectura: Lectura = {
      tokens: uso.tokens,
      ventana: uso.ventana,
      porcentaje: uso.porcentaje,
      usd: uso.usd,
      usdTurno: Math.max(0, uso.usd - usdAlInicio),
      herramientas,
    }
    usdAlInicio = uso.usd
    await update($, lecturas, lista => [...lista.filter(l => l.tokens > 0), lectura].slice(-HISTORIA))
    await update($, limites, () => uso.limites)

    // Avisos: una vez al pasar el umbral y otra al 95%. Se rearma si el contexto baja (/compact).
    const yaAvisado = await read($, alertado)
    if (lectura.porcentaje >= 95 && yaAvisado < 95) {
      $.ui.toast(`Contexto al ${lectura.porcentaje}%: Claude compactará pronto. Usa /compact ahora o abre una sesión nueva.`, { timeoutMs: 10000 })
      await update($, alertado, () => 95)
    } else if (lectura.porcentaje >= umbral && yaAvisado < umbral) {
      $.ui.toast(`Contexto al ${lectura.porcentaje}%: buen momento para /compact o para una sesión nueva.`, { timeoutMs: 8000 })
      await update($, alertado, () => umbral)
    } else if (lectura.porcentaje < umbral && yaAvisado > 0) {
      await update($, alertado, () => 0)
    }
    return r
  })

  // ---- Banda sobre el prompt ----
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!mostrarBanda || e.props.hasSurvey) return next(e)
    const lista = await read($, lecturas)
    const ultima = lista[lista.length - 1]
    if (ultima === undefined) return next(e)
    const lims = await read($, limites)

    const { Box, Text } = $.ui.resolve(e)
    const ancho = e.props.bodyColumns ?? 80
    const color = colorDe(ultima.porcentaje, umbral)
    const limite = limiteMasAlto(lims)

    return (
      <Box flexDirection="row" paddingX={1}>
        <Text color={color} bold>
          {icono(ultima.porcentaje)} Contexto {ultima.porcentaje}%
        </Text>
        <Text dimColor> {corto(ultima.tokens)}/{corto(ultima.ventana)}</Text>
        {ancho >= 70 && <Text color={color}> {grafica(lista.slice(-10))}</Text>}
        <Text dimColor> · </Text>
        <Text>Sesión {usd(ultima.usd)}</Text>
        {ancho >= 90 && <Text dimColor> · último turno {usd(ultima.usdTurno)}</Text>}
        {limite !== undefined && ancho >= 110 && (
          <Text color={limite.porcentaje >= 80 ? 'red' : undefined} dimColor={limite.porcentaje < 80}>
            {' '}· límite {nombreLimite(limite.tipo)} {Math.round(limite.porcentaje)}%
          </Text>
        )}
        {ultima.porcentaje >= umbral && <Text color="red"> → /compact</Text>}
      </Box>
    )
  })

  // ---- Panel /costo ----
  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const lista = await read($, lecturas)
    const lims = await read($, limites)
    const ultima = lista[lista.length - 1]
    const ancho = Math.max(30, (e.props.bodyColumns ?? 60) - 2)

    if (ultima === undefined) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Aún no hay datos: aparecen al terminar el primer turno.</Text>
        </Box>
      )
    }

    const filas = Math.max(3, (e.viewport?.rows ?? 30) - 16)
    const turnos = lista.slice(-filas)
    const primero = lista.length - turnos.length + 1
    const color = colorDe(ultima.porcentaje, umbral)
    const caro = turnos.reduce((m, l) => Math.max(m, l.usdTurno), 0)

    return (
      <Box flexDirection="column">
        <Text bold>Contexto</Text>
        <Text>
          <Text color={color}>{barra(ultima.porcentaje, Math.min(40, ancho - 12))}</Text> {ultima.porcentaje}%
        </Text>
        <Text dimColor>
          {ultima.tokens.toLocaleString('es-MX')} de {ultima.ventana.toLocaleString('es-MX')} tokens · alerta al {umbral}%
        </Text>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Costo</Text>
          <Text>
            Sesión: {usd(ultima.usd)} · promedio por turno: {usd(ultima.usd / Math.max(1, lista.length))}
          </Text>
          <Text dimColor>Equivalente en precio de API, como /cost.</Text>
        </Box>

        {lims.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Límites de uso</Text>
            {lims.map(l => (
              <Text key={l.tipo}>
                <Text color={l.porcentaje >= 80 ? 'red' : l.porcentaje >= 50 ? 'yellow' : 'green'}>{barra(l.porcentaje, 20)}</Text>{' '}
                {nombreLimite(l.tipo)} {Math.round(l.porcentaje)}%{l.reinicia ? <Text dimColor> · reinicia {hora(l.reinicia)}</Text> : null}
              </Text>
            ))}
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          <Text bold>Por turno</Text>
          <Text dimColor>  #   contexto   costo     herramientas</Text>
          {turnos.map((l, i) => (
            <Text key={`t${primero + i}`} color={l.usdTurno === caro && caro > 0 ? 'yellow' : undefined}>
              {String(primero + i).padStart(3)}  {`${l.porcentaje}%`.padStart(5)} {corto(l.tokens).padStart(5)}  {usd(l.usdTurno).padStart(7)}   {l.herramientas}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Tip: un turno caro suele venir de leer archivos grandes; pide a Claude rangos o resúmenes.</Text>
        </Box>
      </Box>
    )
  })
}

type Uso = { tokens: number; ventana: number; porcentaje: number; usd: number; limites: Limite[] }

async function leerUso($: EngineInterface): Promise<Uso | undefined> {
  try {
    const u = await $.session.usage()
    const ventana = u.context.window
    if (!ventana) return undefined
    const tokens = u.context.tokens ?? 0
    return {
      tokens,
      ventana,
      porcentaje: Math.round(u.context.percent ?? (tokens / ventana) * 100),
      usd: u.cost?.usd ?? 0,
      limites: u.rateLimits.map(l => ({ tipo: l.kind, porcentaje: l.percentUsed, reinicia: l.resetsAt })),
    }
  } catch {
    return undefined
  }
}

function clamp(n: number, min: number, max: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 80
}

function colorDe(p: number, umbral: number): string {
  return p >= umbral ? 'red' : p >= umbral - 25 ? 'yellow' : 'green'
}

function icono(p: number): string {
  return p < 25 ? '○' : p < 50 ? '◔' : p < 75 ? '◑' : p < 90 ? '◕' : '●'
}

function grafica(lista: Lectura[]): string {
  const tope = Math.max(...lista.map(l => l.ventana), 1)
  return lista.map(l => BARRAS[Math.min(BARRAS.length - 1, Math.floor((l.tokens / tope) * BARRAS.length))]).join('')
}

function barra(p: number, ancho: number): string {
  const llenas = Math.round((Math.min(100, Math.max(0, p)) / 100) * ancho)
  return '█'.repeat(llenas) + '░'.repeat(Math.max(0, ancho - llenas))
}

function usd(n: number): string {
  return n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`
}

function corto(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

function limiteMasAlto(lims: Limite[]): Limite | undefined {
  return lims.reduce<Limite | undefined>((m, l) => (m === undefined || l.porcentaje > m.porcentaje ? l : m), undefined)
}

function nombreLimite(tipo: string): string {
  return { five_hour: '5h', seven_day: 'semanal', seven_day_opus: 'semanal Opus', spend_limit: 'gasto' }[tipo] ?? tipo
}

function hora(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-MX', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}
