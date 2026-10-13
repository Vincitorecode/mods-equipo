export type Evento = {
  /** Cuándo se detuvo (ms desde epoch). */
  hora: number
  /** El comando, recortado. */
  comando: string
  /** Categorías de riesgo: Kubernetes, Git, Base de datos... */
  categorias: string[]
  /** Motivos legibles. */
  motivos: string[]
  /** Qué pasó: lo ejecutaste, lo cancelaste, o no hubo a quién preguntar (y se bloqueó o se permitió según la opción). */
  decision: 'ejecutado' | 'cancelado' | 'sin respuesta' | 'sin respuesta (permitido)'
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
