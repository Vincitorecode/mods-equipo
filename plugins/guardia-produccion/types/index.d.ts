export type Evento = {
  /** Cuándo se detuvo (ms desde epoch). */
  hora: number
  /** El comando, recortado. */
  comando: string
  /** Categorías de riesgo: Kubernetes, Git, Base de datos... */
  categorias: string[]
  /** Motivos legibles. */
  motivos: string[]
  /** Qué pasó: lo ejecutaste, lo cancelaste o no hubo a quién preguntar. */
  decision: 'ejecutado' | 'cancelado' | 'sin respuesta'
}

declare module 'claude-code' {
  interface PluginState {
    'guardia-produccion': {
      eventos: Evento[]
      /** Contexto actual de kubectl, si hay. */
      kube: string | null
    }
  }
}
