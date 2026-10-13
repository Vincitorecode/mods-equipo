// Idioma de la interfaz: español o inglés.
//
// "auto" usa, en orden, el ajuste `language` de Claude Code, luego LC_ALL / LANG
// del sistema, y si nada lo dice, inglés.

export type Idioma = 'es' | 'en'

export function elegirIdioma(opcion: unknown, ajuste: unknown, entorno: (string | undefined)[]): Idioma {
  if (opcion === 'es' || opcion === 'en') return opcion
  if (typeof ajuste === 'string' && ajuste.trim() !== '') return /^(es|spa|esp)/i.test(ajuste.trim()) ? 'es' : 'en'
  const locale = entorno.find(v => v !== undefined && v !== '' && v !== 'C' && v !== 'POSIX')
  return locale !== undefined && /^es/i.test(locale) ? 'es' : 'en'
}

export function locale(idioma: Idioma): string {
  return idioma === 'es' ? 'es-MX' : 'en-US'
}
