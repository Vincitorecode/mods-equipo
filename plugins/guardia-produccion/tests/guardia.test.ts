import { describe, expect, test } from 'claude-code/testing'

import { elegirIdioma } from '../hooks/idioma'
import { clasificar, compilarCategorias, configPorDefecto, kubeMuta, pushUsaRamaActual } from '../hooks/reglas'

const config = configPorDefecto()
const riesgoso = (c: string) => clasificar(c, config).length > 0

describe('reglas', () => {
  test('deja pasar comandos normales', async () => {
    for (const c of [
      'ls -la',
      'npm test',
      'git status && git diff',
      'git push origin feature/login',
      'git push -u origin feature/x',
      'rm -rf node_modules dist .next',
      'rm -rf build/ "node_modules" apps/web/.next',
      'rm -rf /tmp/foo',
      'grep -rn "DROP TABLE" src/',
      'kubectl get pods',
      'psql -c "SELECT * FROM users WHERE id = 1"',
      'psql -c "DELETE FROM t WHERE id=1"',
      'terraform plan',
      'npm run build -- --env production',
      'git commit -m "fix: push to main button"',
      'git commit -m "aws s3 rm --recursive fix"',
      'git push origin main-feature',
      'git push origin feature/main',
      'kubectl logs delete-job-123',
      // Texto, no comandos
      'echo "npm publish"',
      'echo npm publish',
      'git log --grep "terraform apply"',
      'cat <<EOF > notas.md\nrm -rf /\nterraform apply\nEOF',
      'git commit -m "$(cat <<EOF\nterraform apply y npm publish\nEOF\n)"',
      // Ayuda y simulacros
      'terraform apply --help',
      'vercel --prod --help',
      'kubectl apply --dry-run=client -f x.yaml',
      'git restore --staged .',
      'git branch -d ya-fusionada',
      'ls 2>&1 | head',
    ]) {
      expect([c, riesgoso(c)]).toEqual([c, false])
    }
  })

  test('detiene comandos riesgosos', async () => {
    for (const c of [
      'terraform apply -auto-approve',
      'cd infra && terraform destroy',
      'kubectl delete deployment api',
      'kubectl -n api delete pod x',
      'git push --force origin feature/x',
      'git push -f',
      'git push origin +main',
      'git push origin main',
      'git push origin "main"',
      'git push -u origin main',
      'git push --set-upstream origin master',
      'git push origin HEAD:main',
      'git push origin main:main',
      'git push --all',
      'git push --mirror',
      'git push origin --delete feature',
      'git push origin :feature',
      'git -C repo push --force',
      'git reset --hard HEAD~3',
      'git branch -D main',
      'git checkout -- .',
      'git restore .',
      'git stash drop',
      'rm -rf src',
      'rm -r -f src',
      'rm -rf node_modules/../src',
      'sudo rm -rf /var/www',
      'ls | xargs rm -rf',
      'find . -delete',
      'find src -name "*.ts" -exec rm {} +',
      'Remove-Item -Recurse -Force src',
      'psql $DATABASE_URL -c "DROP TABLE users"',
      'echo "DROP TABLE users" | psql',
      'psql <<SQL\nDROP TABLE users;\nSQL',
      'mysql -e "DELETE FROM orders;"',
      'psql -c "UPDATE users SET admin = true"',
      'mongosh --eval "db.users.drop()"',
      'redis-cli FLUSHALL',
      'npx prisma migrate deploy',
      'python manage.py migrate',
      'bundle exec rails db:migrate',
      'php artisan migrate:fresh',
      'supabase db reset',
      'aws s3 rm s3://bucket --recursive',
      'aws ec2 terminate-instances --instance-ids i-123',
      'gsutil rm -r gs://bucket',
      'heroku apps:destroy',
      'sls remove --stage prod',
      'docker volume rm db',
      'docker compose down -v',
      'vercel --prod',
      'npm publish',
      'npm unpublish paquete',
      'gh repo delete org/x',
      'npm run deploy -- --stage production',
      'NODE_ENV=production npm run migrate',
      // Comandos dentro de otros
      'bash -c "terraform apply"',
      "sh -c 'rm -rf src'",
      'eval "rm -rf src"',
      'ssh servidor "rm -rf /var/www"',
      'echo $(rm -rf src)',
      'bash <<EOF\nterraform apply\nEOF',
    ]) {
      expect([c, riesgoso(c)]).toEqual([c, true])
    }
  })

  test('git push sin rama mira la rama actual', async () => {
    expect(pushUsaRamaActual('git push')).toBe(true)
    expect(pushUsaRamaActual('git push origin HEAD')).toBe(true)
    expect(pushUsaRamaActual('git push origin feature/x')).toBe(false)
    expect(clasificar('git push', { ...config, ramaActual: 'main' }).length).toBe(1)
    expect(clasificar('git push', { ...config, ramaActual: 'feature/x' }).length).toBe(0)
  })

  test('distingue los subcomandos de kubectl que cambian el clúster', async () => {
    for (const c of ['kubectl apply -f x.yaml', 'kubectl --context prod-mx scale deploy api --replicas 0', 'helm upgrade api ./chart']) expect(kubeMuta(c)).toBe(true)
    for (const c of ['kubectl logs api-run-worker', 'kubectl get pods -l app=label-svc', 'kubectl -n exec describe pod x', 'helm list']) expect(kubeMuta(c)).toBe(false)
  })

  test('se adapta a cada equipo', async () => {
    expect(clasificar('./scripts/release.sh', { ...config, extras: [/release\.sh/i] }).length).toBe(1)
    // Ramas protegidas propias
    const conDevelop = { ...config, ramas: /^(main|develop|release\/.*)$/i }
    expect(clasificar('git push origin develop', conDevelop).length).toBe(1)
    expect(clasificar('git push origin release/1.2', conDevelop).length).toBe(1)
    // Permitidos: solo esa parte del comando deja de revisarse
    const permitidos = { ...config, permitidos: [/deploy-staging\.sh/] }
    expect(clasificar('./deploy-staging.sh --env production', permitidos).length).toBe(0)
    expect(clasificar('./deploy-staging.sh && rm -rf src', permitidos).length).toBe(1)
    // Categorías apagadas, por id o por nombre en cualquier idioma
    expect([...compilarCategorias('Archivos, docker, Database')].sort()).toEqual(['archivos', 'bd', 'docker'])
    expect(clasificar('rm -rf src', { ...config, ignoradas: compilarCategorias('archivos') }).length).toBe(0)
  })

  test('elige el idioma', async () => {
    expect(elegirIdioma('en', 'español', ['es_MX.UTF-8'])).toBe('en')
    expect(elegirIdioma('auto', 'spanish', [])).toBe('es')
    expect(elegirIdioma('auto', 'japanese', ['es_MX.UTF-8'])).toBe('en')
    expect(elegirIdioma('auto', undefined, [undefined, 'es_MX.UTF-8'])).toBe('es')
    expect(elegirIdioma('auto', undefined, ['C', 'en_US.UTF-8'])).toBe('en')
    expect(elegirIdioma('auto', undefined, [])).toBe('en')
  })
})

const bash = { result: { stdout: '', stderr: '', interrupted: false, isImage: false } }

describe('en Claude Code', () => {
  test('un comando normal corre sin preguntar', async ($, on) => {
    on('tool.call', { tool: 'Bash' }, async () => bash)
    const r = await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(r.deny).toBeUndefined()
  })

  test('si nadie confirma, el comando riesgoso no corre', async ($, on) => {
    let corrio = false
    on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'cerrado' }))
    on('tool.call', { tool: 'Bash' }, async () => {
      corrio = true
      return bash
    })
    const r = await $.tool.call({ tool: 'Bash', command: 'terraform apply' })
    expect(corrio).toBe(false)
    expect(String(r.deny ?? r.text)).toContain('Guardia de producción')
  })

  test('con "sin respuesta: permitir", corre sin nadie que confirme', { options: { sinRespuesta: 'permitir' } }, async ($, on) => {
    let corrio = false
    on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'cerrado' }))
    on('tool.call', { tool: 'Bash' }, async () => {
      corrio = true
      return bash
    })
    await $.tool.call({ tool: 'Bash', command: 'terraform apply' })
    expect(corrio).toBe(true)
  })

  test('git push en main se detiene', async ($, on) => {
    let corrio = false
    on('session.cwd', async () => ({ value: '/p' }))
    on('process.run', async () => ({ value: { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'cerrado' }))
    on('tool.call', { tool: 'Bash' }, async () => {
      corrio = true
      return bash
    })
    await $.tool.call({ tool: 'Bash', command: 'git push' })
    expect(corrio).toBe(false)
  })
})

describe('interfaz', () => {
  test('/guardia muestra el comando detenido en el historial', { options: { idioma: 'es' } }, async ($, on) => {
    on('clock.now', async () => ({ value: Date.UTC(2026, 9, 7, 15, 30) }))
    on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'cerrado' }))
    await $.tool.call({ tool: 'Bash', command: 'terraform apply -auto-approve' })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'guardia-produccion', surface, component: 'Pane', requestId: 'guardia-produccion', props: { bodyColumns: 80 } } as never)
      expect(await ui.find({ type: 'Text', text: /Guardia activa/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /sin respuesta/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /terraform apply -auto-approve/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('/guardia sin historial lo dice', { options: { idioma: 'es' } }, async $ => {
    const ui = await $.ui.mount({ plugin: 'guardia-produccion', surface: 'terminal', component: 'Pane', requestId: 'guardia-produccion', props: { bodyColumns: 80 } } as never)
    expect(await ui.find({ type: 'Text', text: /Nada detenido todavía/ })).toBeDefined()
    await ui.unmount()
  })

  test('/guardia muestra el banner, y lo oculta si el panel es angosto', { options: { idioma: 'es' } }, async $ => {
    const ui = await $.ui.mount({ plugin: 'guardia-produccion', surface: 'terminal', component: 'Pane', requestId: 'guardia-produccion', props: { bodyColumns: 80 } } as never)
    expect(await ui.find({ type: 'Text', text: /█▄█ █▄█ █▀█ █▀▄ █▄▀/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /root@guard:~# watch_/ })).toBeDefined()
    await ui.unmount()

    const angosto = await $.ui.mount({ plugin: 'guardia-produccion', surface: 'terminal', component: 'Pane', requestId: 'guardia-produccion', props: { bodyColumns: 50 } } as never)
    expect(await angosto.find({ type: 'Text', text: /root@guard/ })).toBeUndefined()
    expect(await angosto.find({ type: 'Text', text: /Guardia activa/ })).toBeDefined()
    await angosto.unmount()
  })

  test('en producción el banner avisa', { options: { idioma: 'es' } }, async ($, on) => {
    on('command.run', async () => ({}))
    on('process.run', async () => ({ value: { exitCode: 0, stdout: 'prod-mx\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    await $.command.run({ command: 'guardia', args: '' })
    const ui = await $.ui.mount({ plugin: 'guardia-produccion', surface: 'terminal', component: 'Pane', requestId: 'guardia-produccion', props: { bodyColumns: 80 } } as never)
    expect(await ui.find({ type: 'Text', text: /root@guard:~# PROD!_/ })).toBeDefined()
    await ui.unmount()
  })

  test('en inglés', { options: { idioma: 'en' } }, async $ => {
    const ui = await $.ui.mount({ plugin: 'guardia-produccion', surface: 'terminal', component: 'Pane', requestId: 'guardia-produccion', props: { bodyColumns: 80 } } as never)
    expect(await ui.find({ type: 'Text', text: /Guard active/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Nothing stopped yet/ })).toBeDefined()
    await ui.unmount()
  })
})

test('la franja sobre el prompt dice que la guardia está activa, en verde', { options: { idioma: 'es' } }, async ($, on) => {
  on('ui.render', async ($, e) => $.ui.resolve(e).Box({}))
  const ui = await $.ui.mount({ plugin: 'guardia-produccion', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 120 } as never })
  const texto = await ui.find({ type: 'Text', text: /Guardia activa/ })
  expect(texto).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\/guardia/ })).toBeDefined()
  await ui.unmount()
})
