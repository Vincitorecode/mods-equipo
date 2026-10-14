import { describe, expect, test } from 'claude-code/testing'

import { elegirIdioma } from '../hooks/idioma'
import { clasificar, clavesDePermiso, compilarCategorias, configPorDefecto, expandirScripts, kubeMuta, pushUsaRamaActual, recetasMake, scriptNpm } from '../hooks/reglas'

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

describe('scripts de npm y targets de make', () => {
  const PKG = JSON.stringify({
    scripts: {
      dev: 'next dev',
      build: 'next build',
      test: 'jest',
      predeploy: 'npm run build',
      deploy: 'firebase deploy --only hosting',
      'deploy:prod': 'vercel --prod',
      'db:reset': 'prisma migrate reset --force',
      limpiar: 'rm -rf dist .next',
      'build:fn': 'rm -rf lib && tsc',
      borrarTodo: 'rm -rf ../otro-repo',
      borrarCasa: 'rm -rf ~/proyectos',
      todo: 'npm run db:reset && npm test',
    },
  })
  const MAKEFILE = [
    'KUBECTL ?= kubectl',
    'ENTORNO := production',
    '',
    '.PHONY: build deploy release',
    'build:',
    '\tgo build ./...',
    '',
    'test: build',
    '\t@go test ./...',
    '',
    'deploy: build',
    '\t$(KUBECTL) delete pod -l app=api',
    '',
    'release: test publicar',
    'publicar:',
    '\t-git push --force origin main',
    '',
    'migrar:',
    '\tDEPLOY_ENV=$(ENTORNO) ./migrate.sh deploy',
    '\techo $$HOME',
  ].join('\n')
  const archivos: Record<string, string> = {
    '/p/package.json': PKG,
    '/p/Makefile': MAKEFILE,
    '/p/web/package.json': JSON.stringify({ scripts: { deploy: 'netlify deploy --prod' } }),
  }
  const leer = async (ruta: string) => archivos[ruta]
  const riesgos = async (c: string) => {
    const scripts = await expandirScripts(c, '/p', leer)
    return [...clasificar(c, config), ...scripts.flatMap(s => clasificar(s.cuerpo, { ...config, enScript: true }))]
  }

  test('lee el script con su pre y su post', async () => {
    expect(scriptNpm(PKG, 'deploy')).toBe('npm run build\nfirebase deploy --only hosting')
    expect(scriptNpm(PKG, 'no-existe')).toBeUndefined()
    expect(scriptNpm('{ roto', 'deploy')).toBeUndefined()
  })

  test('lee la receta de make con sus prerrequisitos y variables', async () => {
    expect(recetasMake(MAKEFILE, ['deploy'])).toBe('go build ./...\nkubectl delete pod -l app=api')
    expect(recetasMake(MAKEFILE, ['release'])).toBe('go build ./...\ngo test ./...\ngit push --force origin main')
    expect(recetasMake(MAKEFILE, [])).toBe('go build ./...') // sin target: el primero
    expect(recetasMake(MAKEFILE, ['migrar'])).toBe('DEPLOY_ENV=production ./migrate.sh deploy\necho $HOME')
  })

  test('detiene lo riesgoso que va dentro del script', async () => {
    for (const c of [
      'npm run deploy',
      'npm run deploy:prod',
      'yarn deploy:prod',
      'pnpm run db:reset',
      'bun run deploy:prod',
      'npm run todo', // script que llama a otro script
      'npm run borrarTodo', // rm fuera del proyecto
      'npm run borrarCasa',
      'npm run deploy --prefix web',
      'cd web && npm run deploy',
      'make deploy',
      'make release',
      'make -C . migrar',
      'make -f Makefile publicar',
    ]) {
      expect([c, (await riesgos(c)).length > 0]).toEqual([c, true])
    }
  })

  test('deja pasar scripts normales, simulacros y lo que no puede leer', async () => {
    for (const c of [
      'npm run dev',
      'npm run build',
      'npm test',
      'npm run limpiar',
      'npm run build:fn', // rm -rf de una carpeta del proyecto: limpieza
      'pnpm install',
      'yarn add lodash',
      'npm run no-existe',
      'make',
      'make test',
      'make -n deploy',
      'make deploy --dry-run',
      'npm run deploy -- --help',
      'cd otro && npm run deploy', // no hay package.json ahí
      'echo "npm run deploy"',
    ]) {
      expect([c, (await riesgos(c)).length > 0]).toEqual([c, false])
    }
  })

  test('rm -rf lib escrito por Claude sigue preguntando; en un script es limpieza', async () => {
    expect(clasificar('rm -rf lib', config).length).toBe(1)
    expect(clasificar('rm -rf lib', { ...config, enScript: true }).length).toBe(0)
    expect(clasificar('rm -rf .', { ...config, enScript: true }).length).toBe(1)
    expect(clasificar('rm -rf $DIR', { ...config, enScript: true }).length).toBe(1)
  })

  test('respeta los comandos permitidos', async () => {
    expect(await expandirScripts('npm run deploy', '/p', leer, [/npm run deploy$/])).toEqual([])
  })
})

describe('permitir en esta sesión', () => {
  const claves = (c: string, rama?: string) => clavesDePermiso(c, clasificar(c, { ...config, ramaActual: rama }))

  test('el push a una rama protegida se permite por rama', async () => {
    expect(claves('git push', 'main')).toEqual(['push a main'])
    expect(claves('git push origin main')).toEqual(['push a main'])
    expect(claves('git  push   -u origin main')).toEqual(['push a main'])
    expect(claves('git push origin master')).toEqual(['push a master'])
    // force push no queda cubierto por el permiso de push a main
    expect(claves('git push --force origin main')).toContain('$ git push --force origin main')
  })

  test('lo demás, solo el comando exacto', async () => {
    expect(claves('terraform apply')).toEqual(['$ terraform apply'])
    expect(claves('terraform  apply ')).toEqual(['$ terraform apply'])
    expect(claves('terraform destroy')).toEqual(['$ terraform destroy'])
    expect(claves('rm -rf src')).not.toEqual(claves('rm -rf docs'))
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

  test('"Permitir en esta sesión" no vuelve a preguntar por ese mismo comando', { options: { idioma: 'es' } }, async ($, on) => {
    let preguntas = 0
    let corridas = 0
    on('tool.call', { tool: 'AskUserQuestion' }, async ($, e) => {
      preguntas++
      const q = e.questions[0]!
      expect(q.options.map(o => o.label)).toContain('Permitir en esta sesión')
      return { result: { questions: e.questions, answers: { [q.question]: 'Permitir en esta sesión' } } }
    })
    on('tool.call', { tool: 'Bash' }, async () => {
      corridas++
      return bash
    })
    await $.tool.call({ tool: 'Bash', command: 'terraform apply' })
    await $.tool.call({ tool: 'Bash', command: 'terraform apply' })
    expect([preguntas, corridas]).toEqual([1, 2])
    // Otro comando de la misma categoría sí pregunta.
    await $.tool.call({ tool: 'Bash', command: 'terraform destroy' })
    expect(preguntas).toBe(2)
  })

  test('sin la opción, pregunta siempre', { options: { idioma: 'es', permitirEnSesion: false } }, async ($, on) => {
    let opciones: string[] = []
    on('tool.call', { tool: 'AskUserQuestion' }, async ($, e) => {
      opciones = e.questions[0]!.options.map(o => o.label)
      return { deny: 'cerrado' }
    })
    on('tool.call', { tool: 'Bash' }, async () => bash)
    await $.tool.call({ tool: 'Bash', command: 'terraform apply' })
    expect(opciones).toEqual(['Cancelar', 'Ejecutar de todas formas'])
  })

  test('npm run deploy se detiene si el script despliega', async ($, on) => {
    let corrio = false
    let pregunta = ''
    on('session.cwd', async () => ({ value: '/p' }))
    on('fs.read', async ($, e) => (e.path === '/p/package.json' ? { value: JSON.stringify({ scripts: { deploy: 'vercel --prod' } }) } : { error: 'ENOENT' }))
    on('tool.call', { tool: 'AskUserQuestion' }, async ($, e) => {
      pregunta = JSON.stringify(e)
      return { deny: 'cerrado' }
    })
    on('tool.call', { tool: 'Bash' }, async () => {
      corrio = true
      return bash
    })
    await $.tool.call({ tool: 'Bash', command: 'npm run deploy' })
    expect(corrio).toBe(false)
    expect(pregunta).toContain('npm run deploy →')
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

  test('/guardia muestra lo permitido en la sesión y lo puede quitar', { options: { idioma: 'es' } }, async ($, on) => {
    on('clock.now', async () => ({ value: Date.UTC(2026, 9, 7, 15, 30) }))
    on('tool.call', { tool: 'AskUserQuestion' }, async ($, e) => ({ result: { questions: e.questions, answers: { [e.questions[0]!.question]: 'Permitir en esta sesión' } } }))
    on('tool.call', { tool: 'Bash' }, async () => bash)
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => $.ui.resolve(e).Box({}))
    await $.tool.call({ tool: 'Bash', command: 'terraform apply' })
    await $.tool.call({ tool: 'Bash', command: 'terraform apply' })

    const banda = await $.ui.mount({ plugin: 'guardia-produccion', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 120 } as never })
    expect(await banda.find({ type: 'Text', text: /1 permitido en sesión/ })).toBeDefined()
    expect(await banda.find({ type: 'Text', text: /1 detenido\b/ })).toBeDefined() // el segundo no se detuvo
    await banda.unmount()

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'guardia-produccion', surface, component: 'Pane', requestId: 'guardia-produccion', props: { bodyColumns: 80 } } as never)
      expect(await ui.find({ type: 'Text', text: /Permitido en esta sesión/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /\$ terraform apply/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /permitido en sesión/ })).toBeDefined() // en el historial
      if (surface === 'desktop') {
        await ui.press({ key: 'quitar' })
        expect(await ui.find({ type: 'Text', text: /Permitido en esta sesión/ })).toBeUndefined()
      }
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
