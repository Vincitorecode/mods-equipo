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

import type { EngineInterface, Register } from 'claude-code'

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

export const register: Register = (on, options) => {
  const prod = compilar(String(options.patronProduccion ?? ''), PATRON_PROD_DEFECTO)
  const extras = compilarLista(String(options.patronesExtra ?? ''))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const comando = String(e.command ?? '')
    const riesgos: Riesgo[] = clasificar(comando, prod, extras)

    // Kubernetes / Helm: averiguar a qué clúster apunta el comando.
    let contexto: string | undefined
    if (usaKube(comando)) {
      contexto = contextoExplicito(comando) ?? (await contextoKubeActual($))
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
      return { deny: negar(riesgos, 'nadie confirmó el comando') }
    }

    if (respuesta === EJECUTAR) {
      $.ui.toast(`Guardia: ejecutando con tu confirmación (${riesgos[0]!.categoria})`)
      $.ui.log(`guardia-produccion: confirmado por el usuario → ${recortar(comando, 200)}`, { to: 'debug' })
      return next(e)
    }
    return { deny: negar(riesgos, respuesta === CANCELAR ? 'el usuario eligió Cancelar' : `el usuario respondió: "${respuesta}"`) }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'guardia-produccion: hubo un error al revisar el comando, así que no se ejecutó por seguridad.' },
  )
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
  return una.length > max ? `${una.slice(0, max - 1)}…` : una
}
