// Contexto y costo
//
// • Banda sobre el prompt: % de contexto usado con su tendencia, costo de la
//   sesión, costo del último turno y el límite de uso más cercano.
// • Aviso (toast) al pasar el umbral de contexto configurado, y otro al 95%.
// • Bajo cada llamada a una herramienta, una línea con el % de contexto del agente
//   que la hizo, los tokens que le quedan y, si es un subagente, cuál es.
// • /costo abre un panel con el detalle por turno y los límites de uso.
//
// Los costos son los mismos que calcula /cost (equivalente en precio de API).
// Con un plan de suscripción no se cobran así, pero sirven para comparar.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { Lectura, Limite, Llamada, Paso } from '../types'
import { elegirIdioma, locale } from './idioma'
import type { Idioma } from './idioma'

const PANEL = 'contexto-costo'
const HISTORIA = 30
const BARRAS = '▁▂▃▄▅▆▇█'

const lecturas = atom({ plugin: 'contexto-costo', key: 'lecturas' } as const, [] as Lectura[])
const limites = atom({ plugin: 'contexto-costo', key: 'limites' } as const, [] as Limite[])
const alertado = atom({ plugin: 'contexto-costo', key: 'alertado' } as const, 0)
const actual = atom({ plugin: 'contexto-costo', key: 'actual' } as const, null as Lectura | null)
const pasos = atom({ plugin: 'contexto-costo', key: 'pasos' } as const, {} as Record<string, Paso>)
const llamadas = atom({ plugin: 'contexto-costo', key: 'llamadas' } as const, [] as Llamada[])
const nombres = atom({ plugin: 'contexto-costo', key: 'nombres' } as const, {} as Record<string, string>)

/** Fotos de llamadas que se guardan (las filas más viejas pierden su barra). */
const MAX_LLAMADAS = 400
const PRINCIPAL = 'principal'

export const register: Register = (on, options) => {
  const umbral = clamp(Number(options.umbralAlerta ?? 80), 10, 99)
  const mostrarBanda = options.mostrarBanda !== false
  const mostrarEnLlamadas = options.mostrarEnLlamadas !== false

  let L: Idioma = elegirIdioma(options.idioma, undefined, [])
  const tr = (es: string, en: string) => (L === 'es' ? es : en)

  // Datos del turno en curso (solo los usa el hook de cierre de turno).
  let usdAlInicio = 0
  let herramientas = 0

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    L = await idiomaDeSesion($, options.idioma)
    await $.command.register({ name: 'costo', description: tr('Detalle de contexto, costo por turno y límites de uso', 'Context, cost per turn and usage limits') })
    const uso = await leerUso($)
    usdAlInicio = uso?.usd ?? 0
    // La banda se ve desde el arranque, sin esperar al primer turno.
    if (uso !== undefined) {
      await update($, actual, () => ({ tokens: uso.tokens, ventana: uso.ventana, porcentaje: uso.porcentaje, usd: uso.usd, usdTurno: 0, herramientas: 0, numero: 0 }))
      await update($, limites, () => uso.limites)
    }
    return r
  })

  // Además del panel, responde con un resumen en texto: así /costo sirve donde no se
  // dibujan paneles (la web en claude.ai/code, Remote Control).
  on('command.run', { command: 'costo' }, async $ => {
    const uso = await leerUso($)
    try {
      await $.ui.open({ id: PANEL, title: tr('Contexto y costo', 'Context and cost'), closeOnEscape: true })
    } catch {
      // Superficie sin paneles: queda el resumen.
    }
    return { text: uso === undefined ? tr('Aún no hay datos de contexto y costo.', 'No context or cost data yet.') : resumen(uso, await read($, lecturas), umbral, L) }
  })

  on('prompt.submit', async ($, e, next) => {
    herramientas = 0
    usdAlInicio = (await leerUso($))?.usd ?? usdAlInicio
    return next(e)
  }).catch(($, e, next) => next(e)) // la banda nunca debe frenar un prompt

  // Cada petición al modelo: cuántos tokens lleva el agente que la hizo.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    try {
      if (r.usage) await anotarPaso($, e.agentId, r.usage)
    } catch {
      // Solo es para mostrar: nunca afecta la respuesta.
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) herramientas += 1
    try {
      await anotarLlamada($, e.tool_use_id, e.agentId)
    } catch {
      // nada
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // ---- Barra de contexto bajo cada llamada ----
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const propio = await next(e)
    if (!mostrarEnLlamadas) return propio
    const foto = (await read($, llamadas)).find(l => l.id === e.props.tool_use_id)
    if (foto === undefined || foto.ventana <= 0) return propio

    const { Box, Text } = $.ui.resolve(e)
    const porcentaje = Math.min(100, Math.round((foto.tokens / foto.ventana) * 100))
    const color = colorDe(porcentaje, umbral)
    return (
      <Box flexDirection="column">
        {propio}
        <Text>
          <Text dimColor>  ⎿ </Text>
          <Text color={color}>{barra(porcentaje, 10)}</Text>
          <Text color={color} bold> {porcentaje}%</Text>
          <Text dimColor> {tr('contexto · quedan', 'context · left')} {corto(Math.max(0, foto.ventana - foto.tokens))}</Text>
          {foto.agente !== null && <Text color="cyan"> · {foto.agente}</Text>}
        </Text>
      </Box>
    )
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r // los subagentes no cierran el turno principal

    const uso = await leerUso($)
    if (uso === undefined) return r

    const previas = await read($, lecturas)
    const lectura: Lectura = {
      tokens: uso.tokens,
      ventana: uso.ventana,
      porcentaje: uso.porcentaje,
      usd: uso.usd,
      usdTurno: Math.max(0, uso.usd - usdAlInicio),
      herramientas,
      numero: (previas[previas.length - 1]?.numero ?? 0) + 1,
    }
    usdAlInicio = uso.usd
    await update($, actual, () => lectura)
    await update($, lecturas, lista => [...lista.filter(l => l.tokens > 0), lectura].slice(-HISTORIA))
    await update($, limites, () => uso.limites)

    // Avisos: una vez al pasar el umbral y otra al 95%. Se rearma si el contexto baja (/compact).
    const yaAvisado = await read($, alertado)
    if (lectura.porcentaje >= 95 && yaAvisado < 95) {
      $.ui.toast(
        tr(
          `Contexto al ${lectura.porcentaje}%: Claude compactará pronto. Usa /compact ahora o abre una sesión nueva.`,
          `Context at ${lectura.porcentaje}%: Claude will compact soon. Run /compact now or start a new session.`,
        ),
        { timeoutMs: 10000 },
      )
      await update($, alertado, () => 95)
    } else if (lectura.porcentaje >= umbral && yaAvisado < umbral) {
      $.ui.toast(
        tr(`Contexto al ${lectura.porcentaje}%: buen momento para /compact o para una sesión nueva.`, `Context at ${lectura.porcentaje}%: a good time for /compact or a new session.`),
        { timeoutMs: 8000 },
      )
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
    const ultima = (await read($, actual)) ?? lista[lista.length - 1]
    const { Box, Text, Button } = $.ui.resolve(e)
    const detalle = (
      <Button key="detalle" label={tr('Detalle', 'Details')} hotkey="c" onPress={() => $.ui.open({ id: PANEL, title: tr('Contexto y costo', 'Context and cost'), closeOnEscape: true })} />
    )
    if (ultima === undefined) {
      return (
        <Box flexDirection="row" paddingX={1}>
          <Text dimColor>{tr('○ Contexto y costo: aparecen al terminar el primer turno · ', '○ Context and cost: shown after the first turn · ')}</Text>
          {detalle}
        </Box>
      )
    }
    const lims = await read($, limites)

    const ancho = e.props.bodyColumns ?? 80
    const color = colorDe(ultima.porcentaje, umbral)
    const limite = limiteMasAlto(lims)

    return (
      <Box flexDirection="row" paddingX={1}>
        <Text color={color} bold>
          {icono(ultima.porcentaje)} {tr('Contexto', 'Context')} {ultima.porcentaje}%
        </Text>
        <Text dimColor> {corto(ultima.tokens)}/{corto(ultima.ventana)}</Text>
        {ancho >= 70 && <Text color={color}> {grafica(lista.slice(-10))}</Text>}
        <Text dimColor> · </Text>
        <Text>{tr('Sesión', 'Session')} {usd(ultima.usd)}</Text>
        {ancho >= 90 && <Text dimColor> · {tr('último turno', 'last turn')} {usd(ultima.usdTurno)}</Text>}
        {limite !== undefined && ancho >= 110 && (
          <Text color={limite.porcentaje >= 80 ? 'red' : undefined} dimColor={limite.porcentaje < 80}>
            {' '}· {tr('límite', 'limit')} {nombreLimite(limite.tipo, L)} {Math.round(limite.porcentaje)}%
          </Text>
        )}
        {ultima.porcentaje >= umbral && <Text color="red"> → /compact</Text>}
        <Text> </Text>
        {detalle}
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
          <Text dimColor>{tr('Aún no hay datos: aparecen al terminar el primer turno.', 'No data yet: it shows up after the first turn.')}</Text>
        </Box>
      )
    }

    const filas = Math.max(3, (e.viewport?.rows ?? 30) - 16)
    const turnos = lista.slice(-filas)
    const color = colorDe(ultima.porcentaje, umbral)
    const caro = turnos.reduce((m, l) => Math.max(m, l.usdTurno), 0)
    const loc = locale(L)

    return (
      <Box flexDirection="column">
        <Text bold>{tr('Contexto', 'Context')}</Text>
        <Text>
          <Text color={color}>{barra(ultima.porcentaje, Math.min(40, ancho - 12))}</Text> {ultima.porcentaje}%
        </Text>
        <Text dimColor>
          {ultima.tokens.toLocaleString(loc)} {tr('de', 'of')} {ultima.ventana.toLocaleString(loc)} tokens · {tr('alerta al', 'alert at')} {umbral}%
        </Text>

        <Box marginTop={1} flexDirection="column">
          <Text bold>{tr('Costo', 'Cost')}</Text>
          <Text>
            {tr('Sesión', 'Session')}: {usd(ultima.usd)} · {tr('promedio por turno', 'average per turn')}: {usd(ultima.usd / Math.max(1, ultima.numero))}
          </Text>
          <Text dimColor>{tr('Equivalente en precio de API, como /cost.', 'API-price equivalent, like /cost.')}</Text>
        </Box>

        {lims.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>{tr('Límites de uso', 'Usage limits')}</Text>
            {lims.map(l => (
              <Text key={l.tipo}>
                <Text color={l.porcentaje >= 80 ? 'red' : l.porcentaje >= 50 ? 'yellow' : 'green'}>{barra(l.porcentaje, 20)}</Text>{' '}
                {nombreLimite(l.tipo, L)} {Math.round(l.porcentaje)}%{l.reinicia ? <Text dimColor> · {tr('reinicia', 'resets')} {hora(l.reinicia, L)}</Text> : null}
              </Text>
            ))}
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          <Text bold>{tr('Por turno', 'Per turn')}</Text>
          <Text dimColor>{tr('  #   contexto   costo     herramientas', '  #   context    cost      tools')}</Text>
          {turnos.map(l => (
            <Text key={`t${l.numero}`} color={l.usdTurno === caro && caro > 0 ? 'yellow' : undefined}>
              {String(l.numero).padStart(3)}  {`${l.porcentaje}%`.padStart(5)} {corto(l.tokens).padStart(5)}  {usd(l.usdTurno).padStart(7)}   {l.herramientas}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>{tr('Tip: un turno caro suele venir de leer archivos grandes; pide a Claude rangos o resúmenes.', 'Tip: an expensive turn usually comes from reading large files; ask Claude for ranges or summaries.')}</Text>
        </Box>
      </Box>
    )
  })
}

type Uso = { tokens: number; ventana: number; porcentaje: number; usd: number; limites: Limite[] }

async function idiomaDeSesion($: EngineInterface, opcion: unknown): Promise<Idioma> {
  if (opcion === 'es' || opcion === 'en') return opcion
  const ajuste = await $.settings.read().then(s => s.language, () => undefined)
  const lcAll = await $.env.get('LC_ALL').catch(() => undefined)
  const lang = await $.env.get('LANG').catch(() => undefined)
  return elegirIdioma(opcion, ajuste, [lcAll, lang])
}

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

/** El mismo detalle del panel, en texto plano. */
function resumen(uso: Uso, lista: Lectura[], umbral: number, L: Idioma): string {
  const es = L === 'es'
  const loc = locale(L)
  const turnos = lista[lista.length - 1]?.numero ?? 0
  const lineas = [
    es
      ? `Contexto: ${uso.porcentaje}% (${uso.tokens.toLocaleString(loc)} de ${uso.ventana.toLocaleString(loc)} tokens)${uso.porcentaje >= umbral ? ' → conviene /compact' : ''}`
      : `Context: ${uso.porcentaje}% (${uso.tokens.toLocaleString(loc)} of ${uso.ventana.toLocaleString(loc)} tokens)${uso.porcentaje >= umbral ? ' → consider /compact' : ''}`,
    es
      ? `Costo de la sesión: ${usd(uso.usd)}${turnos > 0 ? ` · promedio por turno ${usd(uso.usd / turnos)}` : ''} (equivalente en precio de API)`
      : `Session cost: ${usd(uso.usd)}${turnos > 0 ? ` · average per turn ${usd(uso.usd / turnos)}` : ''} (API-price equivalent)`,
  ]
  for (const l of uso.limites) {
    const reinicia = l.reinicia ? ` · ${es ? 'reinicia' : 'resets'} ${hora(l.reinicia, L)}` : ''
    lineas.push(`${es ? 'Límite' : 'Limit'} ${nombreLimite(l.tipo, L)}: ${Math.round(l.porcentaje)}%${reinicia}`)
  }
  const caro = lista.reduce<Lectura | undefined>((m, l) => (m === undefined || l.usdTurno > m.usdTurno ? l : m), undefined)
  if (caro !== undefined && caro.usdTurno > 0) {
    lineas.push(es ? `Turno más caro: #${caro.numero} ${usd(caro.usdTurno)} (${caro.herramientas} herramientas)` : `Most expensive turn: #${caro.numero} ${usd(caro.usdTurno)} (${caro.herramientas} tools)`)
  }
  return lineas.join('\n')
}

/** Guarda cuántos tokens lleva un agente según su última petición al modelo. */
async function anotarPaso($: EngineInterface, agentId: string | undefined, uso: ModelUsage & { model: string }): Promise<void> {
  // Lo que se envió más lo que respondió: con eso empieza su siguiente petición.
  const tokens = uso.input_tokens + uso.cache_read_input_tokens + uso.cache_creation_input_tokens + uso.output_tokens
  await update($, pasos, m => ({ ...m, [agentId ?? PRINCIPAL]: { tokens, modelo: uso.model } }))
  if (agentId !== undefined && (await read($, nombres))[agentId] === undefined) {
    const info = (await $.agent.list()).find(a => a.id === agentId)
    const nombre = info === undefined ? 'subagent' : info.description ? `${info.type}: ${info.description}` : info.type
    await update($, nombres, m => ({ ...m, [agentId]: nombre }))
  }
}

/** Toma la foto del contexto del agente que hace esta llamada. */
async function anotarLlamada($: EngineInterface, id: string, agentId: string | undefined): Promise<void> {
  const todos = await read($, pasos)
  const paso = todos[agentId ?? PRINCIPAL]
  if (paso === undefined) return
  const principal = todos[PRINCIPAL]
  const ventanaPrincipal = (await leerUso($))?.ventana ?? 200_000
  // La ventana del principal la da la sesión; la de un subagente se deduce de su modelo.
  const ventana =
    agentId === undefined || paso.modelo === principal?.modelo ? ventanaPrincipal : paso.modelo.includes('[1m]') ? 1_000_000 : 200_000
  const agente = agentId === undefined ? null : ((await read($, nombres))[agentId] ?? 'subagent')
  const llamada: Llamada = { id, agente, tokens: paso.tokens, ventana }
  await update($, llamadas, lista => [...lista, llamada].slice(-MAX_LLAMADAS))
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

function nombreLimite(tipo: string, L: Idioma): string {
  const nombres: Record<string, [string, string]> = {
    five_hour: ['5h', '5h'],
    seven_day: ['semanal', 'weekly'],
    seven_day_opus: ['semanal Opus', 'weekly Opus'],
    spend_limit: ['gasto', 'spend'],
  }
  const n = nombres[tipo]
  return n === undefined ? tipo : n[L === 'es' ? 0 : 1]
}

function hora(iso: string, L: Idioma): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(locale(L), { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}
