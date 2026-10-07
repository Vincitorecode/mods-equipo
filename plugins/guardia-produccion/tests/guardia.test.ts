import { describe, expect, test } from 'claude-code/testing'

import { PATRON_PROD_DEFECTO, clasificar, compilar } from '../hooks/reglas'

const prod = compilar('', PATRON_PROD_DEFECTO)
const riesgoso = (c: string) => clasificar(c, prod).length > 0

describe('reglas', () => {
  test('deja pasar comandos normales', async () => {
    for (const c of [
      'ls -la',
      'npm test',
      'git status && git diff',
      'git push origin feature/login',
      'rm -rf node_modules dist .next',
      'grep -rn "DROP TABLE" src/',
      'kubectl get pods',
      'psql -c "SELECT * FROM users WHERE id = 1"',
      'terraform plan',
      'npm run build -- --env production',
    ]) {
      expect(riesgoso(c)).toBe(false)
    }
  })

  test('detiene comandos riesgosos', async () => {
    for (const c of [
      'terraform apply -auto-approve',
      'cd infra && terraform destroy',
      'kubectl delete deployment api',
      'git push --force origin feature/x',
      'git push origin main',
      'git reset --hard HEAD~3',
      'rm -rf src',
      'sudo rm -rf /var/www',
      'psql $DATABASE_URL -c "DROP TABLE users"',
      'mysql -e "DELETE FROM orders;"',
      'psql -c "UPDATE users SET admin = true"',
      'npx prisma migrate deploy',
      'python manage.py migrate',
      'bundle exec rails db:migrate',
      'aws s3 rm s3://bucket --recursive',
      'aws ec2 terminate-instances --instance-ids i-123',
      'vercel --prod',
      'npm publish',
      'redis-cli FLUSHALL',
      'npm run deploy -- --stage production',
      'NODE_ENV=production npm run migrate',
    ]) {
      expect(riesgoso(c)).toBe(true)
    }
  })

  test('acepta reglas extra del equipo', async () => {
    expect(clasificar('./scripts/release.sh', prod, [/release\.sh/i]).length).toBe(1)
  })
})

describe('en Claude Code', () => {
  test('un comando normal corre sin preguntar', async ($, on) => {
    on('tool.call', { tool: 'Bash' }, async () => ({ result: { stdout: 'ok', stderr: '', interrupted: false, isImage: false } }))
    const r = await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(r.deny).toBeUndefined()
  })

  test('si nadie confirma, el comando riesgoso no corre', async ($, on) => {
    let corrio = false
    on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'cerrado' }))
    on('tool.call', { tool: 'Bash' }, async () => {
      corrio = true
      return { result: { stdout: '', stderr: '', interrupted: false, isImage: false } }
    })
    const r = await $.tool.call({ tool: 'Bash', command: 'terraform apply' })
    expect(corrio).toBe(false)
    expect(String(r.deny ?? r.text)).toContain('Guardia de producción')
  })
})
