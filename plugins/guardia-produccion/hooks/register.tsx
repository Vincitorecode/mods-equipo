// Guardia de producción
//
// Antes de que Claude ejecute un comando de Bash (o PowerShell en Windows), revisa
// si es riesgoso (deploys, migraciones, borrados, force push, kubectl contra
// producción...). Si lo es, detiene el comando y te pregunta en el diálogo nativo
// de Claude Code si quieres ejecutarlo. Funciona en cualquier modo de permisos,
// incluso con auto-aceptar activado.
//
// Si respondes "Cancelar", cierras el diálogo o algo falla, el comando NO corre
// y Claude recibe el motivo para no reintentarlo.
//
// • Línea de estado bajo el prompt: guardia activa, clúster de kubectl y cuántos
//   comandos detuvo en la sesión.
// • /guardia abre un panel con lo que vigila y el historial de la sesión.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Evento, Permiso } from '../types'
import { elegirIdioma, locale } from './idioma'
import type { Idioma } from './idioma'
import {
  NOMBRE_CATEGORIA,
  PATRON_PROD_DEFECTO,
  carpetaDelComando,
  clasificar,
  clavesDePermiso,
  compilar,
  compilarCategorias,
  compilarLista,
  compilarRamas,
  contextoExplicito,
  expandirScripts,
  kubeMuta,
  pushUsaRamaActual,
  usaKube,
} from './reglas'
import type { Config, Riesgo, Script, Texto } from './reglas'

const PANEL = 'guardia-produccion'
const HISTORIA = 50
/** Motivos que caben en el diálogo; el resto se ve en /guardia. */
const MAX_MOTIVOS = 3
/** Panel más angosto que esto: sin el banner, para que quepa el texto. */
const ANCHO_CON_BANNER = 64

/** Banner del panel /guardia (siempre en inglés). */
const BANNER = ['█▀▀ █ █ ▄▀█ █▀█ █▀▄', '█▄█ █▄█ █▀█ █▀▄ █▄▀']

const eventos = atom({ plugin: 'guardia-produccion', key: 'eventos' } as const, [] as Evento[])
const kube = atom({ plugin: 'guardia-produccion', key: 'kube' } as const, null as string | null)
const permisos = atom({ plugin: 'guardia-produccion', key: 'permisos' } as const, [] as Permiso[])

const T = {
  ejecutar: { es: 'Ejecutar de todas formas', en: 'Run anyway' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  permitirSesion: { es: 'Permitir en esta sesión', en: 'Allow for this session' },
  comando: { es: 'Qué vigila la guardia de producción y lo que detuvo en esta sesión', en: 'What the production guard watches and what it stopped this session' },
  titulo: { es: 'Guardia de producción', en: 'Production guard' },
  abierto: { es: 'Panel de la guardia de producción abierto.', en: 'Production guard panel opened.' },
  detuvo: { es: '🧨 Guardia de producción detuvo este comando:', en: '🧨 Production guard stopped this command:' },
  ctxKube: { es: 'Contexto de Kubernetes', en: 'Kubernetes context' },
  pregunta: { es: '¿Quieres ejecutarlo?', en: 'Do you want to run it?' },
  cabecera: { es: 'Producción', en: 'Production' },
  nadie: { es: 'nadie confirmó el comando', en: 'nobody confirmed the command' },
  eligioCancelar: { es: 'el usuario eligió Cancelar', en: 'the user chose Cancel' },
  error: {
    es: 'guardia-produccion: hubo un error al revisar el comando, así que no se ejecutó por seguridad.',
    en: 'guardia-produccion: checking the command failed, so it was not run, to be safe.',
  },
  activa: { es: '📡 Guardia activa', en: '📡 Guard active' },
} satisfies Record<string, Texto>

/** Lo que vigila, para el panel. */
const VIGILA: [Texto, Texto][] = [
  [NOMBRE_CATEGORIA.infraestructura, { es: 'terraform apply/destroy, pulumi, cdk deploy', en: 'terraform apply/destroy, pulumi, cdk deploy' }],
  [NOMBRE_CATEGORIA.kubernetes, { es: 'delete/drain, helm uninstall; cualquier cambio en producción', en: 'delete/drain, helm uninstall; any change in production' }],
  [NOMBRE_CATEGORIA.git, { es: 'push --force, push a ramas protegidas, reset --hard, branch -D…', en: 'push --force, push to protected branches, reset --hard, branch -D…' }],
  [NOMBRE_CATEGORIA.bd, { es: 'DROP, TRUNCATE, DELETE/UPDATE sin WHERE, FLUSHALL', en: 'DROP, TRUNCATE, DELETE/UPDATE without WHERE, FLUSHALL' }],
  [NOMBRE_CATEGORIA.migracion, { es: 'Prisma, Rails, Django, Laravel, Alembic, Flyway…', en: 'Prisma, Rails, Django, Laravel, Alembic, Flyway…' }],
  [NOMBRE_CATEGORIA.nube, { es: 'borrados en aws, gcloud, az, heroku, fly…', en: 'deletes on aws, gcloud, az, heroku, fly…' }],
  [NOMBRE_CATEGORIA.despliegue, { es: 'vercel --prod, firebase deploy, fly deploy…', en: 'vercel --prod, firebase deploy, fly deploy…' }],
  [NOMBRE_CATEGORIA.publicacion, { es: 'npm publish/unpublish, gh repo delete…', en: 'npm publish/unpublish, gh repo delete…' }],
  [NOMBRE_CATEGORIA.docker, { es: 'volume rm, compose down -v, system prune', en: 'volume rm, compose down -v, system prune' }],
  [NOMBRE_CATEGORIA.archivos, { es: 'rm -r fuera de node_modules, dist, build…; find -delete', en: 'rm -r outside node_modules, dist, build…; find -delete' }],
]

export const register: Register = (on, options) => {
  const config: Config = {
    prod: compilar(String(options.patronProduccion ?? ''), PATRON_PROD_DEFECTO),
    ramas: compilarRamas(String(options.ramasProtegidas ?? '')),
    extras: compilarLista(String(options.patronesExtra ?? '')),
    permitidos: compilarLista(String(options.comandosPermitidos ?? '')),
    ignoradas: compilarCategorias(String(options.categoriasIgnoradas ?? '')),
  }
  const permitirSinRespuesta = options.sinRespuesta === 'permitir'
  const permitirEnSesion = options.permitirEnSesion !== false
  const esProd = (ctx: string | null) => ctx !== null && config.prod.test(ctx)

  // Se decide al abrir la sesión; hasta entonces, lo que diga la opción.
  let L: Idioma = elegirIdioma(options.idioma, undefined, [])
  const t = (x: Texto) => x[L]

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    L = await idiomaDeSesion($, options.idioma)
    await $.command.register({ name: 'guardia', description: t(T.comando) })
    const ctx = await contextoKubeActual($)
    await update($, kube, () => ctx ?? null)
    $.ui.invalidate('ui.render')
    return r
  })

  on('command.run', { command: 'guardia' }, async $ => {
    const ctx = await contextoKubeActual($)
    await update($, kube, () => ctx ?? null)
    $.ui.invalidate('ui.render')
    await $.ui.open({ id: PANEL, title: t(T.titulo), closeOnEscape: true })
    return { text: t(T.abierto) }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const motivo = await revisar($, String(e.command ?? ''), { config, L, permitirSinRespuesta, permitirEnSesion })
    return motivo === undefined ? next(e) : { deny: motivo }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: t(T.error) }))

  // En Windows, Claude Code puede usar PowerShell en lugar de Bash.
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) !== 'PowerShell') return next(e)
    const motivo = await revisar($, String((e as { command?: unknown }).command ?? ''), { config, L, permitirSinRespuesta, permitirEnSesion })
    return motivo === undefined ? next(e) : { deny: motivo }
  }).catch(($, e, next) => (next.called || String(e.tool) !== 'PowerShell' ? next(e) : { deny: t(T.error) }))

  // ---- Franja sobre el prompt: estado en color, encima de lo que pinten los demás ----
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const abajo = await next(e)
    if (e.props.hasSurvey) return abajo
    const { Box, Text } = $.ui.resolve(e)
    const es = L === 'es'
    // Lo que pasó por un permiso de sesión no se detuvo.
    const lista = (await read($, eventos)).filter(l => l.decision !== 'permitido en sesión')
    const ctx = await read($, kube)
    const nPermisos = (await read($, permisos)).length
    const cancelados = lista.filter(l => l.decision === 'cancelado' || l.decision === 'sin respuesta').length
    const s = (n: number) => (n === 1 ? '' : 's')
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" paddingX={1}>
          <Text color="success" bold>{t(T.activa)}</Text>
          {ctx !== null && (esProd(ctx)
            ? <Text color="error" bold> · 🔥 k8s PROD: {ctx}</Text>
            : <Text color="success"> · ⚓ k8s: {ctx}</Text>)}
          {lista.length > 0 && (
            <Text color="warning">
              {' · '}
              {es
                ? `${lista.length} detenido${s(lista.length)}${cancelados > 0 ? ` (${cancelados} cancelado${s(cancelados)})` : ''}`
                : `${lista.length} stopped${cancelados > 0 ? ` (${cancelados} cancelled)` : ''}`}
            </Text>
          )}
          {nPermisos > 0 && <Text color="warning">{es ? ` · ${nPermisos} permitido${s(nPermisos)} en sesión` : ` · ${nPermisos} allowed this session`}</Text>}
          <Text dimColor> · /guardia</Text>
        </Box>
        {abajo}
      </Box>
    )
  })

  // ---- Panel /guardia ----
  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const es = L === 'es'
    const lista = await read($, eventos)
    const ctx = await read($, kube)
    const ancho = Math.max(30, (e.props.bodyColumns ?? 60) - 2)
    // Lo que queda junto al banner.
    const anchoInfo = ancho >= ANCHO_CON_BANNER ? ancho - 30 : ancho
    const filas = Math.max(3, Math.floor(((e.viewport?.rows ?? 30) - 24) / 3))
    const recientes = lista.slice(-filas).reverse()
    const permitidos = await read($, permisos)
    const ejecutados = lista.filter(l => corrio(l.decision)).length
    const sinPreguntar = lista.filter(l => l.decision === 'permitido en sesión').length
    const detenidos = lista.length - ejecutados
    const s = (n: number) => (n === 1 ? '' : 's')
    const etiqueta = (d: Evento['decision']) =>
      d === 'ejecutado' ? (es ? '▶ ejecutado' : '▶ ran') : d === 'cancelado' ? (es ? '■ cancelado' : '■ cancelled') : d === 'sin respuesta' ? (es ? '■ sin respuesta' : '■ no answer') : d === 'permitido en sesión' ? (es ? '▶ permitido en sesión' : '▶ allowed this session') : es ? '▶ sin respuesta (permitido)' : '▶ no answer (allowed)'

    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor={esProd(ctx) ? 'red' : 'green'} paddingX={1} flexDirection="row">
          {ancho >= ANCHO_CON_BANNER && (
            <Box flexDirection="column" marginRight={3}>
              {BANNER.map((l, i) => <Text key={`b${i}`} color={esProd(ctx) ? 'red' : 'green'}>{l}</Text>)}
              <Text dimColor>{esProd(ctx) ? 'root@guard:~# PROD!_' : 'root@guard:~# watch_'}</Text>
            </Box>
          )}
          <Box flexDirection="column" flexShrink={1}>
          <Text bold color="green">{t(T.activa)}</Text>
          <Text>
            <Text dimColor>Kubernetes: </Text>
            {ctx === null ? <Text dimColor>{es ? 'sin contexto de kubectl' : 'no kubectl context'}</Text> : <Text color={esProd(ctx) ? 'red' : undefined} bold={esProd(ctx)}>{ctx}{esProd(ctx) ? (es ? '  ← PRODUCCIÓN' : '  ← PRODUCTION') : ''}</Text>}
          </Text>
          <Text>
            <Text dimColor>{es ? 'Producción = ' : 'Production = '}</Text>/{config.prod.source}/
            <Text dimColor>{es ? ' · Ramas protegidas = ' : ' · Protected branches = '}</Text>{config.ramas.source.replace(/^\^\(|\)\$$/g, '')}
          </Text>
          {(config.extras.length > 0 || config.permitidos.length > 0 || config.ignoradas.size > 0) && (
            <Text dimColor>
              {recortar(
                [
                  config.extras.length > 0 ? (es ? `${config.extras.length} regla${s(config.extras.length)} extra` : `${config.extras.length} extra rule${s(config.extras.length)}`) : '',
                  config.permitidos.length > 0 ? (es ? `${config.permitidos.length} permitido${s(config.permitidos.length)}` : `${config.permitidos.length} allowed`) : '',
                  config.ignoradas.size > 0 ? `${es ? 'apagadas' : 'off'}: ${[...config.ignoradas].map(c => t(NOMBRE_CATEGORIA[c])).join(', ')}` : '',
                ].filter(x => x !== '').join(' · '),
                anchoInfo,
              )}
            </Text>
          )}
          <Text>
            <Text dimColor>{es ? 'Esta sesión: ' : 'This session: '}</Text>
            {es ? `${lista.length - sinPreguntar} detenido${s(lista.length - sinPreguntar)} · ` : `${lista.length - sinPreguntar} stopped · `}
            <Text color="green">{es ? `${detenidos} cancelado${s(detenidos)}` : `${detenidos} cancelled`}</Text> · <Text color="yellow">{es ? `${ejecutados} ejecutado${s(ejecutados)}` : `${ejecutados} ran`}</Text>
          </Text>
          </Box>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>{es ? 'Historial' : 'History'}</Text>
          {recientes.length === 0 && <Text dimColor>{es ? 'Nada detenido todavía. Cuando Claude intente algo riesgoso aparecerá aquí.' : 'Nothing stopped yet. When Claude tries something risky it will show up here.'}</Text>}
          {recientes.map((ev, i) => (
            <Box key={`e${lista.length - i}`} flexDirection="column" marginBottom={i < recientes.length - 1 ? 1 : 0}>
              <Text>
                <Text color={corrio(ev.decision) ? 'yellow' : 'green'}>{etiqueta(ev.decision)}</Text>
                <Text dimColor>  {hora(ev.hora, L)} · {ev.categorias.join(', ')}</Text>
              </Text>
              <Text>  $ {recortar(ev.comando, ancho - 4)}</Text>
              <Text dimColor>  {recortar(ev.motivos.join('; '), ancho - 2)}</Text>
            </Box>
          ))}
          {lista.length > recientes.length && <Text dimColor>{es ? `…y ${lista.length - recientes.length} más antiguos` : `…and ${lista.length - recientes.length} older`}</Text>}
        </Box>

        {permitidos.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>{es ? 'Permitido en esta sesión' : 'Allowed this session'}</Text>
            {permitidos.map(p => (
              <Text key={p.clave}>
                <Text color="yellow">  {recortar(p.clave, ancho - 12)}</Text>
                {p.hora > 0 && <Text dimColor>  {hora(p.hora, L)}</Text>}
              </Text>
            ))}
            <Box marginTop={1}>
              <Button key="quitar" label={es ? 'Quitar permisos' : 'Revoke all'} hotkey="p" onPress={async () => { await update($, permisos, () => []); $.ui.invalidate('ui.render') }} />
            </Box>
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          <Text bold>{es ? 'Qué vigila' : 'What it watches'}</Text>
          {VIGILA.map(([cat, que]) => (
            <Text key={cat.es}>
              <Text color="cyan">{t(cat).padEnd(16)}</Text>
              <Text dimColor>{recortar(t(que), ancho - 17)}</Text>
            </Text>
          ))}
        </Box>

        {lista.length > 0 && (
          <Box marginTop={1}>
            <Button key="limpiar" label={es ? 'Limpiar historial' : 'Clear history'} hotkey="l" onPress={async () => { await update($, eventos, () => []); $.ui.invalidate('ui.render') }} />
          </Box>
        )}
      </Box>
    )
  })
}

/** ¿El comando corrió? (Con tu confirmación, con un permiso de sesión, o sin nadie a quien preguntar.) */
function corrio(d: Evento['decision']): boolean {
  return d === 'ejecutado' || d === 'permitido en sesión' || d === 'sin respuesta (permitido)'
}

type Ajustes = { config: Config; L: Idioma; permitirSinRespuesta: boolean; permitirEnSesion: boolean }

/** Revisa un comando de shell; undefined si puede correr, o el motivo para negarlo. */
async function revisar($: EngineInterface, comando: string, aj: Ajustes): Promise<string | undefined> {
  const { config, L } = aj
  const t = (x: Texto) => x[L]
  let cfg = config
  // `npm run x` / `make x`: lo que de verdad corre está en el package.json o el Makefile.
  // Si no se pueden leer, se revisa solo el comando, como antes.
  const scripts: Script[] = /\b(npm|yarn|pnpm|bun|g?make)\b/.test(comando)
    ? await (async () => expandirScripts(comando, await $.session.cwd(), leerArchivo($), config.permitidos))().catch(() => [])
    : []
  const textos = [comando, ...scripts.map(s => s.cuerpo)]
  // `git push` sin rama: averiguar a cuál va.
  if (textos.some(pushUsaRamaActual)) {
    const rama = await ramaActual($, comando)
    if (rama !== undefined) cfg = { ...config, ramaActual: rama }
  }
  const riesgos: Riesgo[] = clasificar(comando, cfg)
  for (const s of scripts) {
    for (const r of clasificar(s.cuerpo, { ...cfg, enScript: true })) {
      const motivo = { es: `${s.etiqueta} → ${r.motivo.es}`, en: `${s.etiqueta} → ${r.motivo.en}` }
      if (!riesgos.some(x => x.motivo.es === motivo.es)) riesgos.push({ categoria: r.categoria, motivo })
    }
  }

  // Kubernetes / Helm: averiguar a qué clúster apunta el comando (o sus scripts).
  const todo = textos.join('\n')
  let contexto: string | undefined
  if (usaKube(todo) && !config.ignoradas.has('kubernetes')) {
    const actual = await contextoKubeActual($)
    if (actual !== undefined) await update($, kube, () => actual)
    contexto = contextoExplicito(todo) ?? actual
    if (contexto !== undefined && config.prod.test(contexto) && kubeMuta(todo)) {
      riesgos.push({ categoria: 'kubernetes', motivo: { es: `cambia el clúster de PRODUCCIÓN "${contexto}"`, en: `changes the PRODUCTION cluster "${contexto}"` } })
    }
  }

  if (riesgos.length === 0) return undefined

  // Ya permitido con "Permitir en esta sesión": corre sin preguntar, y queda en el historial.
  const claves = clavesDePermiso(comando, riesgos)
  if (aj.permitirEnSesion) {
    const ya = new Set((await read($, permisos)).map(p => p.clave))
    if (claves.every(c => ya.has(c))) {
      await anotar($, aj, comando, riesgos, 'permitido en sesión')
      return undefined
    }
  }

  // Diálogo corto: un motivo por categoría, tres como máximo. El detalle completo queda en /guardia.
  const porCategoria = [...new Map(riesgos.map(r => [r.categoria, r])).values()]
  const resumen = porCategoria
    .slice(0, MAX_MOTIVOS)
    .map(r => `• ${t(r.motivo)}`)
    .join('\n')
  const resto = riesgos.length - Math.min(MAX_MOTIVOS, porCategoria.length)
  const pregunta =
    `${t(T.detuvo)}\n` +
    `  $ ${recortar(comando, 140)}\n` +
    `${resumen}${resto > 0 ? (L === 'es' ? `\n  +${resto} más (en /guardia)` : `\n  +${resto} more (in /guardia)`) : ''}\n` +
    (contexto ? `${t(T.ctxKube)}: ${contexto}\n` : '') +
    (aj.permitirEnSesion ? alcance(claves, L) + '\n' : '') +
    t(T.pregunta)

  let respuesta: string
  try {
    respuesta = await $.ui.ask(pregunta, { header: t(T.cabecera), options: aj.permitirEnSesion ? [t(T.cancelar), t(T.ejecutar), t(T.permitirSesion)] : [t(T.cancelar), t(T.ejecutar)] })
  } catch {
    // Diálogo cerrado, o sesión sin nadie a quien preguntar (claude -p, CI).
    if (aj.permitirSinRespuesta) {
      await anotar($, aj, comando, riesgos, 'sin respuesta (permitido)')
      $.ui.log(`guardia-produccion: sin nadie a quien preguntar, se permitió → ${recortar(comando, 200)}`, { to: 'debug' })
      return undefined
    }
    await anotar($, aj, comando, riesgos, 'sin respuesta')
    return negar(riesgos, t(T.nadie))
  }

  const categoria = t(NOMBRE_CATEGORIA[riesgos[0]!.categoria])
  if (aj.permitirEnSesion && respuesta === t(T.permitirSesion)) {
    // Si no se puede guardar el permiso, el comando corre igual: el usuario dijo que sí.
    try {
      const hora = await $.clock.now().catch(() => 0)
      await update($, permisos, lista => [...lista.filter(p => !claves.includes(p.clave)), ...claves.map(clave => ({ clave, hora }))])
    } catch {
      // nada
    }
    await anotar($, aj, comando, riesgos, 'ejecutado')
    $.ui.toast(L === 'es' ? `🚀 Guardia: permitido en esta sesión (${categoria}). Quítalo en /guardia` : `🚀 Guard: allowed for this session (${categoria}). Revoke it in /guardia`)
    $.ui.log(`guardia-produccion: permitido en esta sesión → ${claves.join(' · ')}`, { to: 'debug' })
    return undefined
  }
  if (respuesta === t(T.ejecutar)) {
    await anotar($, aj, comando, riesgos, 'ejecutado')
    $.ui.toast(L === 'es' ? `🚀 Guardia: ejecutando con tu confirmación (${categoria})` : `🚀 Guard: running with your confirmation (${categoria})`)
    $.ui.log(`guardia-produccion: confirmado por el usuario → ${recortar(comando, 200)}`, { to: 'debug' })
    return undefined
  }
  await anotar($, aj, comando, riesgos, 'cancelado')
  $.ui.toast(L === 'es' ? `🧯 Guardia: comando cancelado (${categoria}). Detalle en /guardia` : `🧯 Guard: command cancelled (${categoria}). Details in /guardia`)
  return negar(riesgos, respuesta === t(T.cancelar) ? t(T.eligioCancelar) : L === 'es' ? `el usuario respondió: "${respuesta}"` : `the user answered: "${respuesta}"`)
}

/** Guarda en el historial un comando detenido y lo que decidió el usuario. */
async function anotar($: EngineInterface, aj: Ajustes, comando: string, riesgos: Riesgo[], decision: Evento['decision']): Promise<void> {
  const { config, L } = aj
  const t = (x: Texto) => x[L]
  // El historial es solo para mostrar: si falla, la decisión de seguridad sigue igual.
  try {
    const evento: Evento = {
      hora: await $.clock.now(),
      comando: recortar(comando, 300),
      categorias: [...new Set(riesgos.map(r => t(NOMBRE_CATEGORIA[r.categoria])))],
      motivos: riesgos.map(r => t(r.motivo)),
      decision,
    }
    await update($, eventos, lista => [...lista, evento].slice(-HISTORIA))
    $.ui.invalidate('ui.render')
  } catch {
    // nada
  }
}


async function idiomaDeSesion($: EngineInterface, opcion: unknown): Promise<Idioma> {
  if (opcion === 'es' || opcion === 'en') return opcion
  const ajuste = await $.settings.read().then(s => s.language, () => undefined)
  const lcAll = await $.env.get('LC_ALL').catch(() => undefined)
  const lang = await $.env.get('LANG').catch(() => undefined)
  return elegirIdioma(opcion, ajuste, [lcAll, lang])
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

/** Lee un archivo del proyecto (package.json, Makefile); undefined si no está. */
function leerArchivo($: EngineInterface): (ruta: string) => Promise<string | undefined> {
  return ruta => $.fs.read(ruta).then(
    t => (typeof t === 'string' ? t : undefined),
    () => undefined,
  )
}

/** La rama de git donde corre el comando, o undefined si no es un repo o falla. */
async function ramaActual($: EngineInterface, comando: string): Promise<string | undefined> {
  try {
    const cwd = carpetaDelComando(await $.session.cwd(), comando)
    const r = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 3000 })
    const rama = r.stdout.trim()
    return r.exitCode === 0 && rama !== '' && rama !== 'HEAD' ? rama : undefined
  } catch {
    return undefined
  }
}

/** Qué deja de preguntar "Permitir en esta sesión", para el diálogo. */
function alcance(claves: string[], L: Idioma): string {
  const push = claves.filter(c => !c.startsWith('$ ')).map(c => c.replace(/^push a /, ''))
  const exacto = claves.some(c => c.startsWith('$ '))
  if (L === 'es') return `(Permitir en esta sesión: ${exacto ? 'este mismo comando' : `el push a ${push.join(', ')}`} ya no pregunta hasta que cierres Claude Code)`
  return `(Allow for this session: ${exacto ? 'this exact command' : `pushing to ${push.join(', ')}`} stops asking until Claude Code closes)`
}

function negar(riesgos: Riesgo[], porque: string): string {
  // Para Claude, no para la persona: un solo idioma basta y Claude responde en el de la conversación.
  return (
    `Guardia de producción (production guard) did not run the command: ${porque}. ` +
    `Reason: ${riesgos.map(r => r.motivo.en).join('; ')}. ` +
    `Do not retry it or look for another way to do the same thing; ask the user how they want to continue.`
  )
}

function recortar(texto: string, max: number): string {
  const una = texto.replace(/\s+/g, ' ').trim()
  return una.length > max ? `${una.slice(0, Math.max(1, max - 1))}…` : una
}

function hora(ms: number, L: Idioma): string {
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(locale(L), { hour: '2-digit', minute: '2-digit' })
}
