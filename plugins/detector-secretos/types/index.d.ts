export type Deteccion = {
  /** Cuándo se detectó (ms desde epoch). */
  hora: number
  /** Escritura de un archivo o un commit. */
  accion: 'escritura' | 'commit'
  /** Lo encontrado, ya enmascarado: "config.ts:3 — AWS Access Key: AKIA…LQ". */
  hallazgos: string[]
  /** Cuántos secretos en total. */
  total: number
  /** Qué pasó con la escritura o el commit. */
  decision: 'bloqueado' | 'permitido'
}

declare module 'claude-code' {
  interface PluginState {
    'detector-secretos': {
      detecciones: Deteccion[]
      /** Escrituras y commits revisados en la sesión. */
      revisados: number
    }
  }
}
