import { describe, expect, test } from 'claude-code/testing'

import { buscarSecretos, esCommit, lineasAgregadas, rutasDeGitAdd } from '../hooks/patrones'

const tipos = (t: string) => buscarSecretos(t).map(h => h.tipo)

describe('patrones', () => {
  test('encuentra secretos reales', async () => {
    expect(tipos('const k = "AKIAIOSFODNN7EXAMPLQ"')).toContain('AWS Access Key')
    expect(tipos('token: ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8')).toContain('GitHub token')
    expect(tipos('-----BEGIN RSA PRIVATE KEY-----\nMIIE...')).toContain('Llave privada')
    expect(tipos('DATABASE_URL=postgres://admin:S3cr3tPass@db.prod:5432/app')).toContain('Cadena de conexión con contraseña')
    expect(tipos('const apiKey = "q8Zr2LmN0vX4pT7w"')).toContain('Contraseña o token en el código')
    expect(tipos('stripe = "sk_live_' + '51HxYzAbCdEfGhIjKlMnOpQr"')).toContain('Stripe live key')
    expect(tipos('ANTHROPIC_API_KEY="sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345"')).toContain('Anthropic API key')
  })

  test('ignora placeholders y lecturas de entorno', async () => {
    for (const t of [
      'const apiKey = process.env.API_KEY',
      'password: "changeme"',
      'API_KEY="your_api_key_here"',
      'secret = "${SECRET}"',
      'DATABASE_URL=postgres://user:<password>@localhost/app',
      'token = "xxxxxxxxxxxx"',
      'const password = "password"',
      'passwordLabel: "Contraseña"',
      'forgotPassword: "olvidaste"',
      'passwordInputId: "login-password-input"',
      'apiKeyHeader: "X-Api-Key"',
      'secretName: "db-credentials"',
      'const PASSWORD_MIN_LENGTH = "minimum8"',
    ]) {
      expect(buscarSecretos(t).length).toBe(0)
    }
  })

  test('enmascara el valor', async () => {
    const [h] = buscarSecretos('k = "AKIAIOSFODNN7EXAMPLQ"')
    expect(h!.muestra).toBe('AKIA…LQ (20 caracteres)')
  })

  test('lee las líneas agregadas de un diff', async () => {
    const d = '+++ b/src/a.ts\n@@ -1 +1 @@\n-viejo\n+nuevo\n+++ b/b.ts\n+otro'
    expect([...lineasAgregadas(d).keys()]).toEqual(['src/a.ts', 'b.ts'])
    expect(esCommit('git commit -m "x"')).toBe(true)
    expect(esCommit('git log')).toBe(false)
  })

  test('sabe qué va a agregar un git add en el mismo comando', async () => {
    expect(rutasDeGitAdd('git commit -m x')).toBeUndefined()
    expect(rutasDeGitAdd('git add . && git commit -m x')).toEqual([])
    expect(rutasDeGitAdd('git add -A && git commit -m x')).toEqual([])
    expect(rutasDeGitAdd('git add src/a.ts "b c.ts" && git commit -m x')).toEqual(['src/a.ts', 'b c.ts'])
  })
})

describe('en Claude Code', () => {
  test('escribir código limpio no pregunta nada', async ($, on) => {
    on('tool.call', { tool: 'Write' }, async () => ({ result: { type: 'create', filePath: '/p/a.ts', content: 'x', structuredPatch: [], originalFile: null } }))
    const r = await $.tool.call({ tool: 'Write', file_path: '/p/a.ts', content: 'const key = process.env.KEY' })
    expect(r.deny).toBeUndefined()
  })

  test('un secreto sin confirmar no se escribe', async ($, on) => {
    let escribio = false
    on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'cerrado' }))
    on('tool.call', { tool: 'Write' }, async () => {
      escribio = true
      return { result: { type: 'create', filePath: '/p/a.ts', content: 'x', structuredPatch: [], originalFile: null } }
    })
    const r = await $.tool.call({ tool: 'Write', file_path: '/p/config.ts', content: 'export const k = "AKIAIOSFODNN7EXAMPLQ"' })
    expect(escribio).toBe(false)
    expect(String(r.deny ?? r.text)).toContain('Detector de secretos')
  })

  test('git add . && git commit revisa lo que aún no está en stage', async ($, on) => {
    let corrio = false
    on('session.cwd', async () => ({ value: '/p' }))
    const salida = (exitCode: number, stdout: string) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    on('process.run', async (_$, e) => {
      const a = e.argv.join(' ')
      if (a.includes('ls-files')) return salida(0, 'config.ts\0')
      if (a.includes('--no-index')) return salida(1, '+++ b/config.ts\n+export const k = "AKIAIOSFODNN7EXAMPLQ"\n')
      return salida(0, '')
    })
    on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'cerrado' }))
    on('tool.call', { tool: 'Bash' }, async () => {
      corrio = true
      return { result: { stdout: '', stderr: '', interrupted: false, isImage: false } }
    })
    const r = await $.tool.call({ tool: 'Bash', command: 'git add . && git commit -m "config"' })
    expect(corrio).toBe(false)
    expect(String(r.deny ?? r.text)).toContain('Detector de secretos')
  })

  test('los .env locales se permiten', async ($, on) => {
    on('tool.call', { tool: 'Write' }, async () => ({ result: { type: 'create', filePath: '/p/.env', content: 'x', structuredPatch: [], originalFile: null } }))
    const r = await $.tool.call({ tool: 'Write', file_path: '/p/.env', content: 'AWS_KEY=AKIAIOSFODNN7EXAMPLQ' })
    expect(r.deny).toBeUndefined()
  })
})

describe('interfaz', () => {
  // Clave de prueba armada por partes para que el propio detector no la marque en este archivo.
  const falsa = 'AKIA' + 'IOSFODNN7EXAMPLQ'

  test('/secretos muestra lo detectado, enmascarado', async ($, on) => {
    on('clock.now', async () => ({ value: Date.UTC(2026, 9, 7, 15, 30) }))
    on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'cerrado' }))
    await $.tool.call({ tool: 'Write', file_path: '/p/config.ts', content: `export const k = "${falsa}"` })

    const ui = await $.ui.mount({ plugin: 'detector-secretos', surface: 'terminal', component: 'Pane', requestId: 'detector-secretos', props: { bodyColumns: 80 } } as never)
    expect(await ui.find({ type: 'Text', text: /Detector de secretos activo/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /bloqueado/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /AKIA…LQ/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: new RegExp(falsa) })).toBeUndefined()
    await ui.unmount()
  })
})
