export type Lectura = {
  /** Tokens en el contexto al terminar el turno. */
  tokens: number
  /** Tamaño de la ventana de contexto. */
  ventana: number
  /** Porcentaje usado (0-100). */
  porcentaje: number
  /** Costo acumulado de la sesión en USD al terminar el turno. */
  usd: number
  /** Costo de ese turno en USD. */
  usdTurno: number
  /** Herramientas usadas en el turno. */
  herramientas: number
}

export type Limite = {
  /** five_hour, seven_day, spend_limit... */
  tipo: string
  porcentaje: number
  reinicia?: string
}

declare module 'claude-code' {
  interface PluginState {
    'contexto-costo': {
      lecturas: Lectura[]
      limites: Limite[]
      alertado: number
    }
  }
}
