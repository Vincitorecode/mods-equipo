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

const pasoCon = (tokens: number, model = 'claude-opus-5-5') => async function* () {
  return {
    turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'tool_use',
    usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: tokens - 1500, cache_creation_input_tokens: 0, model },
  } as never
}

/** La fila que el motor dibujaría por su cuenta. */
const filaPropia = async () => ({ type: 'Text', children: ['Herramienta(...)'] }) as never

async function paso($: Parameters<Parameters<typeof test>[1]>[0], agentId?: string) {
  const s = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId } as never)
  for await (const _ of s) { /* sin chunks */ }
}

test('cada llamada muestra el contexto del agente principal', async ($, on) => {
  let id = ''
  on('ui.render', { component: 'ToolUse' }, filaPropia)
  on('session.usage', async () => ({ value: usoCon(90_000, 0.5) }))
  on('turn.step', pasoCon(90_000))
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    id = e.tool_use_id
    return { result: { stdout: '', stderr: '', interrupted: false, isImage: false } }
  })
  await paso($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  const ui = await $.ui.mount({ plugin: 'contexto-costo', surface: 'terminal', component: 'ToolUse', requestId: id, props: { tool_use_id: id, tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false } } as never)
  expect(await ui.find({ type: 'Text', text: /45%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /quedan 110k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Herramienta/ })).toBeDefined() // la fila original sigue
  await ui.unmount()
})

test('las llamadas de un subagente dicen cuál es', async ($, on) => {
  let id = ''
  on('ui.render', { component: 'ToolUse' }, filaPropia)
  on('session.usage', async () => ({ value: usoCon(20_000, 0.5) }))
  on('agent.list', async () => ({ value: [{ id: 'a1', description: 'buscar archivos', type: 'Explore', status: 'running' }] as never }))
  on('turn.step', pasoCon(150_000, 'claude-haiku-4-5'))
  on('tool.call', { tool: 'Grep' }, async (_$, e) => {
    id = e.tool_use_id
    return { result: { mode: 'files_with_matches', filenames: [], numFiles: 0 } as never }
  })
  await paso($, 'a1')
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'a1' } as never)

  const ui = await $.ui.mount({ plugin: 'contexto-costo', surface: 'desktop', component: 'ToolUse', requestId: id, props: { tool_use_id: id, tool: 'Grep', input: { pattern: 'x' }, isRunning: false, isErrored: false, isInterrupted: false } } as never)
  expect(await ui.find({ type: 'Text', text: /75%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Explore: buscar archivos/ })).toBeDefined()
  await ui.unmount()
})
