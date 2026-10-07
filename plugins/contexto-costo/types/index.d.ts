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

/** El contexto de un agente en su última petición al modelo. */
export type Paso = {
  tokens: number
  modelo: string
}

/** Foto del contexto en el momento de una llamada a una herramienta. */
export type Llamada = {
  /** tool_use_id de la llamada. */
  id: string
  /** Nombre del subagente que la hizo; null si fue el agente principal. */
  agente: string | null
  tokens: number
  ventana: number
}

declare module 'claude-code' {
  interface PluginState {
    'contexto-costo': {
      lecturas: Lectura[]
      limites: Limite[]
      alertado: number
      /** La lectura más reciente (también la del arranque, antes del primer turno). */
      actual: Lectura | null
      /** Último paso de cada agente: 'principal' o el id del subagente. */
      pasos: Record<string, Paso>
      /** Fotos de contexto por llamada, para la barra bajo cada herramienta. */
      llamadas: Llamada[]
      /** Nombre legible de cada subagente por id. */
      nombres: Record<string, string>
    }
  }
}
