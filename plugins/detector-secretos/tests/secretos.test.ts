import { describe, expect, test } from 'claude-code/testing'

import { archivosQueEscribe, buscarSecretos, commitConTodo, esCommit, lineasAgregadas, rutasDeGitAdd } from '../hooks/patrones'

// Los valores de prueba se arman por partes para que el propio detector no marque este archivo.
const j = (...partes: string[]) => partes.join('')
const PW = j('pass', 'word')
const AWS = j('AKIA', 'IOSFODNN7EXAMPLQ')
const ids = (t: string) => buscarSecretos(t).map(h => h.id)

describe('patrones', () => {
  test('encuentra secretos reales', async () => {
    expect(ids(`const k = "${AWS}"`)).toContain('aws-access-key')
    expect(ids(j('token: ghp_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'))).toContain('github')
    expect(ids(j('-----BEGIN RSA PRIV', 'ATE KEY-----\nMIIE...'))).toContain('llave-privada')
    expect(ids(j('DATABASE_URL=postgres://admin:', 'S3cr3tPass@db.prod:5432/app'))).toContain('cadena-conexion')
    expect(ids(j('git remote add origin https://ana:', 'p4ssw0rd@github.com/org/repo.git'))).toContain('cadena-conexion')
    expect(ids(j('const apiKey = "q8Zr2Lm', 'N0vX4pT7w"'))).toContain('asignacion')
    expect(ids(j('stripe = "sk_live_', '51HxYzAbCdEfGhIjKlMnOpQr"'))).toContain('stripe')
    expect(ids(j('ANTHROPIC_API_KEY="sk-ant-', 'api03-abcdefghijklmnopqrstuvwxyz012345"'))).toContain('anthropic')
    expect(ids(j('HF_TOKEN=hf_', 'abcdefghijklmnopqrstuvwxyzABCDEFGH'))).toContain('huggingface')
  })

  test('encuentra secretos sin comillas (.env, YAML, properties, shell)', async () => {
    for (const t of [
      j('DB_', PW.toUpperCase(), '=Sup3rS3cret'),
      j('export API_KEY=q8Zr2Lm', 'N0vX4pT7w'),
      j('api_key: q8Zr2Lm', 'N0vX4pT7w'),
      j('  - ', PW.toUpperCase(), '=Kn0t10n2024!'),
      j('spring.datasource.', PW, '=S3cr3tPass99'),
    ]) {
      expect([t, ids(t)]).toEqual([t, ['asignacion']])
    }
  })

  test('ignora placeholders, referencias y nombres que no guardan secretos', async () => {
    for (const t of [
      'const apiKey = process.env.API_KEY',
      `${PW}: "changeme"`,
      'API_KEY="your_api_key_here"',
      'API_KEY=your_api_key_here',
      'secret = "${SECRET}"',
      `DB_${PW.toUpperCase()}=\${DB_PASSWORD}`,
      `${PW}: \${{ secrets.DB_PASSWORD }}`,
      `${PW}: "{{ .Values.pw }}"`,
      `${PW}: !Ref DbPassword`,
      `${PW} = os.getenv("PW", "dev")`,
      'access_token = get_token(client)',
      `DATABASE_URL=postgres://user:<${PW}>@localhost/app`,
      'token = "xxxxxxxxxxxx"',
      `const ${PW} = "${PW}"`,
      `${PW}Label: "Contraseña"`,
      'forgotPassword: "olvidaste"',
      `${PW}InputId: "login-${PW}-input"`,
      'apiKeyHeader: "X-Api-Key"',
      'secretName: "db-credentials"',
      `const ${PW.toUpperCase()}_MIN_LENGTH = "minimum8"`,
      'token_expires_in: 3600000',
      'PASSWORD_FILE=/run/secrets/db',
      j('const testPass', 'word = "Test1234!"'),
      j(PW, ' = "S3cr3tPass99" # secretos:permitir'),
      j(PW, ' = "S3cr3tPass99" // gitleaks:allow'),
    ]) {
      expect([t, buscarSecretos(t).length]).toEqual([t, 0])
    }
  })

  test('se pueden apagar tipos', async () => {
    expect(buscarSecretos(`k = "${AWS}"`, new Set(['aws-access-key'])).length).toBe(0)
  })

  test('enmascara el valor', async () => {
    const [h] = buscarSecretos(`k = "${AWS}"`)
    expect(h!.muestra).toBe('AKIA…LQ (20)')
  })

  test('lee las líneas agregadas de un diff', async () => {
    const d = '+++ b/src/a.ts\n@@ -1 +1 @@\n-viejo\n+nuevo\n+++ b/b.ts\n+otro'
    expect([...lineasAgregadas(d).keys()]).toEqual(['src/a.ts', 'b.ts'])
    expect(esCommit('git commit -m "x"')).toBe(true)
    expect(esCommit('git log')).toBe(false)
    expect(commitConTodo('git commit -am "x"')).toBe(true)
    expect(commitConTodo('git commit -m "add all"')).toBe(false)
  })

  test('sabe qué va a agregar un git add en el mismo comando', async () => {
    expect(rutasDeGitAdd('git commit -m x')).toBeUndefined()
    expect(rutasDeGitAdd('git add . && git commit -m x')).toEqual([])
    expect(rutasDeGitAdd('git add -A && git commit -m x')).toEqual([])
    expect(rutasDeGitAdd('git add src/a.ts "b c.ts" && git commit -m x')).toEqual(['src/a.ts', 'b c.ts'])
  })

  test('sabe a qué archivos escribe un comando de shell', async () => {
    expect(archivosQueEscribe('cat > config.ts <<EOF')).toEqual(['config.ts'])
    expect(archivosQueEscribe('echo x >> .env && echo y | tee -a a.txt')).toEqual(['.env', 'a.txt'])
    expect(archivosQueEscribe('npm test 2>&1 > /dev/null')).toEqual([])
    expect(archivosQueEscribe('ls -la')).toEqual([])
  })
})

const escrito = { result: { type: 'create', filePath: '/p/a.ts', content: 'x', structuredPatch: [], originalFile: null } } as never
const bash = { result: { stdout: '', stderr: '', interrupted: false, isImage: false } }

describe('en Claude Code', () => {
  test('escribir código limpio no pregunta nada', async ($, on) => {
    on('tool.call', { tool: 'Write' }, async () => escrito)
    const r = await $.tool.call({ tool: 'Write', file_path: '/p/a.ts', content: 'const key = process.env.KEY' })
    expect(r.deny).toBeUndefined()
  })

  test('un secreto sin confirmar no se escribe', async ($, on) => {
    let escribio = false
    on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'cerrado' }))
    on('tool.call', { tool: 'Write' }, async () => {
      escribio = true
      return escrito
    })
    const r = await $.tool.call({ tool: 'Write', file_path: '/p/config.ts', content: `export const k = "${AWS}"` })
    expect(escribio).toBe(false)
    expect(String(r.deny ?? r.text)).toContain('Detector de secretos')
  })

  test('un secreto escrito desde la shell también se revisa', async ($, on) => {
    let corrio = false
    on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'cerrado' }))
    on('tool.call', { tool: 'Bash' }, async () => {
      corrio = true
      return bash
    })
    await $.tool.call({ tool: 'Bash', command: `cat > config.ts <<EOF\nexport const k = "${AWS}"\nEOF` })
    expect(corrio).toBe(false)
  })

  test('git add . && git commit revisa lo que aún no está en stage', async ($, on) => {
    let corrio = false
    on('session.cwd', async () => ({ value: '/p' }))
    const salida = (exitCode: number, stdout: string) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    on('process.run', async (_$, e) => {
      const a = e.argv.join(' ')
      if (a.includes('ls-files')) return salida(0, 'config.ts\0')
      if (a.includes('--no-index')) return salida(1, `+++ b/config.ts\n+export const k = "${AWS}"\n`)
      return salida(0, '')
    })
    on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'cerrado' }))
    on('tool.call', { tool: 'Bash' }, async () => {
      corrio = true
      return bash
    })
    const r = await $.tool.call({ tool: 'Bash', command: 'git add . && git commit -m "config"' })
    expect(corrio).toBe(false)
    expect(String(r.deny ?? r.text)).toContain('Detector de secretos')
  })

  test('los .env locales se permiten, también con rutas de Windows', async ($, on) => {
    on('tool.call', { tool: 'Write' }, async () => escrito)
    for (const ruta of ['/p/.env', 'C:\\proyecto\\.env.local']) {
      const r = await $.tool.call({ tool: 'Write', file_path: ruta, content: `AWS_KEY=${AWS}` })
      expect(r.deny).toBeUndefined()
    }
  })
})

describe('interfaz', () => {
  test('/secretos muestra lo detectado, enmascarado', { options: { idioma: 'es' } }, async ($, on) => {
    on('clock.now', async () => ({ value: Date.UTC(2026, 9, 7, 15, 30) }))
    on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'cerrado' }))
    await $.tool.call({ tool: 'Write', file_path: '/p/config.ts', content: `export const k = "${AWS}"` })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'detector-secretos', surface, component: 'Pane', requestId: 'detector-secretos', props: { bodyColumns: 80 } } as never)
      expect(await ui.find({ type: 'Text', text: /Detector de secretos activo/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /bloqueado/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /AKIA…LQ/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: new RegExp(AWS) })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('en inglés', { options: { idioma: 'en' } }, async $ => {
    const ui = await $.ui.mount({ plugin: 'detector-secretos', surface: 'terminal', component: 'Pane', requestId: 'detector-secretos', props: { bodyColumns: 80 } } as never)
    expect(await ui.find({ type: 'Text', text: /Secret detector active/ })).toBeDefined()
    await ui.unmount()
  })
})
