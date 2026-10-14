export type Evento = {
  /** Cuándo se detuvo (ms desde epoch). */
  hora: number
  /** El comando, recortado. */
  comando: string
  /** Categorías de riesgo: Kubernetes, Git, Base de datos... */
  categorias: string[]
  /** Motivos legibles. */
  motivos: string[]
  /** Qué pasó: lo ejecutaste, lo cancelaste, corrió por un permiso de esta sesión, o no hubo a quién preguntar (y se bloqueó o se permitió según la opción). */
  decision: 'ejecutado' | 'cancelado' | 'sin respuesta' | 'sin respuesta (permitido)' | 'permitido en sesión'
}

/** Algo que el usuario permitió para el resto de la sesión. */
export type Permiso = {
  /** `$ comando exacto` o `push a main` (ver clavesDePermiso). */
  clave: string
  /** Cuándo se permitió (ms desde epoch). */
  hora: number
}

declare module 'claude-code' {
  interface PluginState {
    'guardia-produccion': {
      eventos: Evento[]
      /** Contexto actual de kubectl, si hay. */
      kube: string | null
      /** Lo permitido con "Permitir en esta sesión". */
      permisos: Permiso[]
    }
  }
}
