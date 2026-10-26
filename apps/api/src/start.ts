/**
 * Docker entrypoint of the `api` service (plain Node, no shell script, so CRLF checkouts on
 * Windows cannot break it):
 *   1. make sure the secrets exist (generate on first boot, persist on the secrets volume);
 *   2. wait for PostgreSQL;
 *   3. apply migrations (prisma migrate deploy). Only the api service migrates;
 *   4. run the idempotent seed (lookups, permissions, settings, admin account);
 *   5. with SEED_DEMO=true, add the demo data (idempotent, see src/demo.ts);
 *   6. start the HTTP server.
 */
import 'reflect-metadata';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_SECRETS_FILE, resolveSecrets } from './config/secrets';

const API_ROOT = join(__dirname, '..');
const SCHEMA = join(API_ROOT, 'prisma', 'schema.prisma');

function log(msg: string) {
  console.log(`[start] ${msg}`);
}

function run(label: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  log(`${label}...`);
  const res = spawnSync(process.execPath, args, { cwd: API_ROOT, env, stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`${label} failed (exit code ${res.status ?? res.signal})`);
  }
}

async function waitForDatabase(url: string, attempts = 60) {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    for (let i = 1; i <= attempts; i++) {
      try {
        await client.$queryRaw`SELECT 1`;
        log('database is reachable');
        return;
      } catch (err) {
        if (i === attempts) throw err;
        log(`waiting for database (${i}/${attempts})`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  const file = process.env.SECRETS_FILE || DEFAULT_SECRETS_FILE;
  const { generated } = resolveSecrets(process.env, { file, generateMissing: true });
  if (generated.length) log(`generated ${generated.join(', ')} and saved them to ${file}`);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  await waitForDatabase(databaseUrl);

  run('applying migrations', [
    require.resolve('prisma/build/index.js'),
    'migrate',
    'deploy',
    '--schema',
    SCHEMA,
  ]);

  if (process.env.SEED_ON_START !== 'false') {
    run('seeding reference data', [require.resolve('tsx/cli'), join(API_ROOT, 'prisma', 'seed.ts')], {
      ...process.env,
      ADMIN_PASSWORD_FILE: process.env.ADMIN_PASSWORD_FILE || '/app/secrets/admin-initial-password.txt',
    });
  }

  if (process.env.SEED_DEMO === 'true') {
    // Demo data is a convenience: a failure is reported but does not stop the platform.
    try {
      run('adding demo data (SEED_DEMO=true)', [join(__dirname, 'demo.js'), 'seed']);
    } catch (err) {
      log(`demo data was not added: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { startApi } = require('./main') as typeof import('./main');
  await startApi();
}

main().catch((err) => {
  console.error('[start] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
