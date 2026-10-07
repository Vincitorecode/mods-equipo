// Guardia de producción
//
// Antes de que Claude ejecute un comando de Bash, revisa si es riesgoso
// (deploys, migraciones, borrados, force push, kubectl contra producción...).
// Si lo es, detiene el comando y te pregunta en el diálogo nativo de Claude Code
// si quieres ejecutarlo. Funciona en cualquier modo de permisos, incluso con
// auto-aceptar activado.
//
// Si respondes "Cancelar", cierras el diálogo o algo falla, el comando NO corre
// y Claude recibe el motivo para no reintentarlo.
//
// • Línea de estado bajo el prompt: guardia activa, clúster de kubectl y cuántos
//   comandos detuvo en la sesión.
// • /guardia abre un panel con lo que vigila y el historial de la sesión.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Evento } from '../types'
import {
  PATRON_PROD_DEFECTO,
  clasificar,
  compilar,
  compilarLista,
  contextoExplicito,
  kubeMuta,
  usaKube,
} from './reglas'
import type { Riesgo } from './reglas'

const EJECUTAR = 'Ejecutar de todas formas'
const CANCELAR = 'Cancelar'
const PANEL = 'guardia-produccion'
const HISTORIA = 50

const eventos = atom({ plugin: 'guardia-produccion', key: 'eventos' } as const, [] as Evento[])
const kube = atom({ plugin: 'guardia-produccion', key: 'kube' } as const, null as string | null)

const VIGILA = [
  ['Infraestructura', 'terraform apply/destroy, pulumi, cdk deploy'],
  ['Kubernetes', 'delete/drain, helm uninstall; cualquier cambio en un clúster de producción'],
  ['Git', 'push --force, push a main/master, reset --hard, clean -f'],
  ['Bases de datos', 'DROP, TRUNCATE, DELETE/UPDATE sin WHERE, FLUSHALL'],
  ['Migraciones', 'Prisma, Rails, Django, Alembic, Knex, Flyway…'],
  ['Nube', 'borrados en aws, gcloud, az'],
  ['Deploys', 'vercel --prod, firebase deploy, npm publish…'],
  ['Archivos', 'rm -r fuera de node_modules, dist, build…'],
] as const

export const register: Register = (on, options) => {
  const prod = compilar(String(options.patronProduccion ?? ''), PATRON_PROD_DEFECTO)
  const extras = compilarLista(String(options.patronesExtra ?? ''))
  const esProd = (ctx: string | null) => ctx !== null && prod.test(ctx)

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'guardia', description: 'Qué vigila la guardia de producción y lo que detuvo en esta sesión' })
    const ctx = await contextoKubeActual($)
    await update($, kube, () => ctx ?? null)
    await pintarEstado($, prod)
    return r
  })

  on('command.run', { command: 'guardia' }, async $ => {
    const ctx = await contextoKubeActual($)
    await update($, kube, () => ctx ?? null)
    await pintarEstado($, prod)
    await $.ui.open({ id: PANEL, title: 'Guardia de producción', closeOnEscape: true })
    return { text: 'Panel de la guardia de producción abierto.' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const comando = String(e.command ?? '')
    const riesgos: Riesgo[] = clasificar(comando, prod, extras)

    // Kubernetes / Helm: averiguar a qué clúster apunta el comando.
    let contexto: string | undefined
    if (usaKube(comando)) {
      const actual = await contextoKubeActual($)
      if (actual !== undefined) await update($, kube, () => actual)
      contexto = contextoExplicito(comando) ?? actual
      if (contexto !== undefined && prod.test(contexto) && kubeMuta(comando)) {
        riesgos.push({ categoria: 'Kubernetes', motivo: `cambia el clúster de PRODUCCIÓN "${contexto}"` })
      }
    }

    if (riesgos.length === 0) {
      return next(e)
    }

    const resumen = riesgos.map(r => `• ${r.categoria}: ${r.motivo}`).join('\n')
    const pregunta =
      `⚠ Guardia de producción detuvo este comando:\n\n` +
      `  ${recortar(comando, 300)}\n\n` +
      `${resumen}\n` +
      (contexto ? `\nContexto de Kubernetes: ${contexto}\n` : '') +
      `\n¿Quieres ejecutarlo?`

    let respuesta: string
    try {
      respuesta = await $.ui.ask(pregunta, { header: 'Producción', options: [CANCELAR, EJECUTAR] })
    } catch {
      // Diálogo cerrado, o sesión sin nadie a quien preguntar (claude -p).
      await anotar($, prod, comando, riesgos, 'sin respuesta')
      return { deny: negar(riesgos, 'nadie confirmó el comando') }
    }

    if (respuesta === EJECUTAR) {
      await anotar($, prod, comando, riesgos, 'ejecutado')
      $.ui.toast(`🛡 Guardia: ejecutando con tu confirmación (${riesgos[0]!.categoria})`)
      $.ui.log(`guardia-produccion: confirmado por el usuario → ${recortar(comando, 200)}`, { to: 'debug' })
      return next(e)
    }
    await anotar($, prod, comando, riesgos, 'cancelado')
    $.ui.toast(`🛡 Guardia: comando cancelado (${riesgos[0]!.categoria}). Detalle en /guardia`)
    return { deny: negar(riesgos, respuesta === CANCELAR ? 'el usuario eligió Cancelar' : `el usuario respondió: "${respuesta}"`) }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'guardia-produccion: hubo un error al revisar el comando, así que no se ejecutó por seguridad.' },
  )

  // ---- Panel /guardia ----
  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const lista = await read($, eventos)
    const ctx = await read($, kube)
    const ancho = Math.max(30, (e.props.bodyColumns ?? 60) - 2)
    const filas = Math.max(3, Math.floor(((e.viewport?.rows ?? 30) - 22) / 3))
    const recientes = lista.slice(-filas).reverse()
    const ejecutados = lista.filter(l => l.decision === 'ejecutado').length

    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor={esProd(ctx) ? 'red' : 'green'} paddingX={1} flexDirection="column">
          <Text bold color="green">🛡 Guardia activa</Text>
          <Text>
            <Text dimColor>Kubernetes: </Text>
            {ctx === null ? <Text dimColor>sin contexto de kubectl</Text> : <Text color={esProd(ctx) ? 'red' : undefined} bold={esProd(ctx)}>{ctx}{esProd(ctx) ? '  ← PRODUCCIÓN' : ''}</Text>}
          </Text>
          <Text>
            <Text dimColor>Producción = </Text>/{prod.source}/
            {extras.length > 0 && <Text dimColor> · {extras.length} regla{extras.length === 1 ? '' : 's'} extra</Text>}
          </Text>
          <Text>
            <Text dimColor>Esta sesión: </Text>
            {lista.length} detenido{lista.length === 1 ? '' : 's'} · <Text color="green">{lista.length - ejecutados} cancelado{lista.length - ejecutados === 1 ? '' : 's'}</Text> · <Text color="yellow">{ejecutados} ejecutado{ejecutados === 1 ? '' : 's'}</Text>
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Historial</Text>
          {recientes.length === 0 && <Text dimColor>Nada detenido todavía. Cuando Claude intente algo riesgoso aparecerá aquí.</Text>}
          {recientes.map((ev, i) => (
            <Box key={`e${lista.length - i}`} flexDirection="column" marginBottom={i < recientes.length - 1 ? 1 : 0}>
              <Text>
                <Text color={ev.decision === 'ejecutado' ? 'yellow' : 'green'}>{ev.decision === 'ejecutado' ? '▶ ejecutado' : ev.decision === 'cancelado' ? '■ cancelado' : '■ sin respuesta'}</Text>
                <Text dimColor>  {hora(ev.hora)} · {ev.categorias.join(', ')}</Text>
              </Text>
              <Text>  $ {recortar(ev.comando, ancho - 4)}</Text>
              <Text dimColor>  {recortar(ev.motivos.join('; '), ancho - 2)}</Text>
            </Box>
          ))}
          {lista.length > recientes.length && <Text dimColor>…y {lista.length - recientes.length} más antiguos</Text>}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Qué vigila</Text>
          {VIGILA.map(([cat, que]) => (
            <Text key={cat}>
              <Text color="cyan">{cat.padEnd(16)}</Text>
              <Text dimColor>{recortar(que, ancho - 17)}</Text>
            </Text>
          ))}
        </Box>

        {lista.length > 0 && (
          <Box marginTop={1}>
            <Button key="limpiar" label="Limpiar historial" hotkey="l" onPress={async () => { await update($, eventos, () => []); await pintarEstado($, prod) }} />
          </Box>
        )}
      </Box>
    )
  })
}

/** Pinta la línea de estado bajo el prompt. */
async function pintarEstado($: EngineInterface, prod: RegExp): Promise<void> {
  const lista = await read($, eventos)
  const ctx = await read($, kube)
  const partes = ['🛡 Guardia activa']
  if (ctx !== null) partes.push(prod.test(ctx) ? `⚠ k8s PROD: ${ctx}` : `k8s: ${ctx}`)
  if (lista.length > 0) {
    const cancelados = lista.filter(l => l.decision !== 'ejecutado').length
    partes.push(`${lista.length} detenido${lista.length === 1 ? '' : 's'}${cancelados > 0 ? ` (${cancelados} cancelado${cancelados === 1 ? '' : 's'})` : ''}`)
  }
  partes.push('/guardia')
  $.ui.status(partes.join(' · '))
}

/** Guarda en el historial un comando detenido y lo que decidió el usuario. */
async function anotar($: EngineInterface, prod: RegExp, comando: string, riesgos: Riesgo[], decision: Evento['decision']): Promise<void> {
  // El historial es solo para mostrar: si falla, la decisión de seguridad sigue igual.
  try {
    const evento: Evento = {
      hora: await $.clock.now(),
      comando: recortar(comando, 300),
      categorias: [...new Set(riesgos.map(r => r.categoria))],
      motivos: riesgos.map(r => r.motivo),
      decision,
    }
    await update($, eventos, lista => [...lista, evento].slice(-HISTORIA))
    await pintarEstado($, prod)
  } catch {
    // nada
  }
}

/** El contexto actual de kubectl, o undefined si no hay kubectl o falla. */
async function contextoKubeActual($: EngineInterface): Promise<string | undefined> {
  try {
    const r = await $.process.run(['kubectl', 'config', 'current-context'], { timeoutMs: 3000 })
    const ctx = r.stdout.trim()
    return r.exitCode === 0 && ctx !== '' ? ctx : undefined
  } catch {
    return undefined
  }
}

function negar(riesgos: Riesgo[], porque: string): string {
  return (
    `Guardia de producción no ejecutó el comando: ${porque}. ` +
    `Motivo: ${riesgos.map(r => r.motivo).join('; ')}. ` +
    `No lo reintentes ni busques otra forma de hacer lo mismo; pregunta al usuario cómo quiere continuar.`
  )
}

function recortar(texto: string, max: number): string {
  const una = texto.replace(/\s+/g, ' ').trim()
  return una.length > max ? `${una.slice(0, Math.max(1, max - 1))}…` : una
}

function hora(ms: number): string {
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}
