import { expect, test } from 'claude-code/testing'

const usoCon = (tokens: number, usd: number) => ({
  startedAt: 0,
  context: { tokens, window: 200_000, percent: Math.round((tokens / 200_000) * 100) },
  rateLimits: [{ kind: 'five_hour', percentUsed: 41 }],
  cost: { usd },
})

test('la banda muestra contexto, costo y la alerta de /compact', async ($, on) => {
  let uso = usoCon(40_000, 0.5)
  on('session.usage', async () => ({ value: uso }))
  on('turn.complete', async () => ({ text: 'ok' }))

  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't' })
  uso = usoCon(170_000, 1.75)
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'contexto-costo', surface, component: 'AbovePrompt', props: { bodyColumns: 140 } as never })
    expect(await ui.find({ type: 'Text', text: /Contexto 85%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Sesión \$1\.75/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\/compact/ })).toBeDefined()
    await ui.unmount()
  }
})

test('el panel sin datos lo dice', async $ => {
  const ui = await $.ui.mount({ plugin: 'contexto-costo', surface: 'terminal', component: 'Pane', requestId: 'contexto-costo', props: { bodyColumns: 60 } } as never)
  expect(await ui.find({ type: 'Text', text: /Aún no hay datos/ })).toBeDefined()
  await ui.unmount()
})

test('el panel muestra el detalle por turno y los límites', async ($, on) => {
  on('session.usage', async () => ({ value: usoCon(60_000, 0.8) }))
  on('turn.complete', async () => ({ text: 'ok' }))
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'contexto-costo', surface, component: 'Pane', requestId: 'contexto-costo', props: { bodyColumns: 80 } } as never)
    expect(await ui.find({ type: 'Text', text: /60,000 de 200,000 tokens/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Sesión: \$0\.80/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5h 41%/ })).toBeDefined()
    await ui.unmount()
  }
})

test('la banda se ve antes del primer turno', async $ => {
  const ui = await $.ui.mount({ plugin: 'contexto-costo', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 120 } as never })
  expect(await ui.find({ type: 'Text', text: /aparecen al terminar el primer turno/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', label: 'Detalle' })).toBeDefined()
  await ui.unmount()
})

test('/costo responde con un resumen en texto', async ($, on) => {
  on('session.usage', async () => ({ value: usoCon(60_000, 0.8) }))
  on('turn.complete', async () => ({ text: 'ok' }))
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't' })
  const r = await $.command.run({ command: 'costo', args: '' } as never)
  expect(String((r as { text?: string }).text)).toContain('Contexto: 30%')
  expect(String((r as { text?: string }).text)).toContain('Límite 5h: 41%')
})
