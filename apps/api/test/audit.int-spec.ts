/**
 * Integration test against a real PostgreSQL 16: applies migrations 0001-0003 and the seed to a
 * fresh database, then checks the audit extension and the system-account protection.
 * Server: TEST_DATABASE_ADMIN_URL (default postgresql://postgres:pg@localhost:5432/postgres).
 */
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { ClsModule } from 'nestjs-cls';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditModule } from '../src/audit/audit.module';
import { AuditService } from '../src/audit/audit.service';
import { toApiError } from '../src/common/all-exceptions.filter';
import { AppConfigModule } from '../src/config/config.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://postgres:pg@localhost:5432/postgres';
const DB_NAME = `sanad_it_${Date.now()}`;
const DB_URL = (() => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
})();
const API_ROOT = join(__dirname, '..');

let admin: PrismaClient;
let prisma: PrismaService;
let audit: AuditService;
let raw: PrismaClient;

function node(args: string[], env: NodeJS.ProcessEnv) {
  const res = spawnSync(process.execPath, args, {
    cwd: API_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`${args.join(' ')} failed:\n${res.stdout}\n${res.stderr}`);
  return res.stdout;
}

const actor = {
  userId: '00000000-0000-4000-8000-000000000001',
  role: 'SUPER_ADMIN' as const,
  ip: '10.1.2.3',
  userAgent: 'int-test',
};
const asActor = <T>(fn: () => Promise<T>) => prisma.runAs(actor, fn);
const auditRows = (entityId: string) =>
  raw.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
  const env = { DATABASE_URL: DB_URL };
  node([require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], env);
  const secretsDir = mkdtempSync(join(tmpdir(), 'sanad-int-'));
  const seedOut = node([require.resolve('tsx/cli'), 'prisma/seed.ts'], {
    ...env,
    ADMIN_EMAIL: 'jbahmaid@gmail.com',
    ADMIN_PASSWORD_FILE: join(secretsDir, 'admin-initial-password.txt'),
  });
  expect(seedOut).toContain('Username : admin');

  process.env.DATABASE_URL = DB_URL;
  process.env.SECRETS_FILE = join(secretsDir, 'keys.json');
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppConfigModule.forRoot({ generateMissingSecrets: true }),
      ClsModule.forRoot({ global: true }),
      PrismaModule,
      AuditModule,
    ],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  audit = moduleRef.get(AuditService);
  raw = new PrismaClient({ datasources: { db: { url: DB_URL } } });
});

afterAll(async () => {
  await raw?.$disconnect();
  await (prisma as any)?.onModuleDestroy?.();
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin.$disconnect();
});

describe('audit extension on a real database', () => {
  let userId: string;

  it('writes a CREATE row with actor, IP and masked secrets', async () => {
    const user = await asActor(() =>
      prisma.db.user.create({
        data: { email: 'it@example.com', passwordHash: 'argon-hash', role: 'SEEKER' },
      }),
    );
    userId = user.id;
    const [row] = await auditRows(user.id);
    expect(row).toMatchObject({
      action: 'CREATE',
      entity: 'users',
      actorUserId: actor.userId,
      actorRole: 'SUPER_ADMIN',
      ip: '10.1.2.3',
      userAgent: 'int-test',
    });
    expect((row.after as any).email).toBe('it@example.com');
    expect((row.after as any).passwordHash).toBe('[REDACTED]');
    expect(JSON.stringify(row)).not.toContain('argon-hash');
  });

  it('writes UPDATE rows with before and after', async () => {
    await asActor(() => prisma.db.user.update({ where: { id: userId }, data: { locale: 'en' } }));
    const rows = await auditRows(userId);
    const upd = rows.find((r) => r.action === 'UPDATE')!;
    expect((upd.before as any).locale).toBe('ar');
    expect((upd.after as any).locale).toBe('en');
  });

  it('turns delete into an audited soft delete hidden from normal reads', async () => {
    await asActor(() => prisma.db.user.delete({ where: { id: userId } }));
    expect(await prisma.db.user.findUnique({ where: { id: userId } })).toBeNull();
    const stillThere = await prisma.db.user.findFirst({ where: { id: userId, deletedAt: { not: null } } });
    expect(stillThere?.deletedAt).toBeInstanceOf(Date);
    expect((await auditRows(userId)).map((r) => r.action)).toContain('DELETE');

    await asActor(() => prisma.db.user.update({ where: { id: userId }, data: { deletedAt: null } }));
    expect((await auditRows(userId)).map((r) => r.action)).toContain('RESTORE');
  });

  it('audits hard deletes as HARD_DELETE with the previous values', async () => {
    await asActor(() => prisma.hardDelete((db) => db.user.delete({ where: { id: userId } })));
    expect(await raw.user.findUnique({ where: { id: userId } })).toBeNull();
    const last = (await auditRows(userId)).at(-1)!;
    expect(last.action).toBe('HARD_DELETE');
    expect((last.before as any).email).toBe('it@example.com');
  });

  it('audits every row of createMany / updateMany', async () => {
    await asActor(() =>
      prisma.db.sector.createMany({
        data: [
          { code: 'IT_TEST_A', nameAr: 'أ', nameEn: 'A' },
          { code: 'IT_TEST_B', nameAr: 'ب', nameEn: 'B' },
        ],
      }),
    );
    const sectors = await raw.sector.findMany({ where: { code: { startsWith: 'IT_TEST_' } } });
    await asActor(() =>
      prisma.db.sector.updateMany({ where: { code: { startsWith: 'IT_TEST_' } }, data: { isActive: false } }),
    );
    for (const s of sectors) {
      expect((await auditRows(s.id)).map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
    }
  });

  it('keeps audit rows inside the transaction (rolled back together)', async () => {
    const email = 'rollback@example.com';
    await expect(
      prisma.tx(async (tx) => {
        await tx.user.create({ data: { email, passwordHash: 'x', role: 'SEEKER' } });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await raw.user.findFirst({ where: { email } })).toBeNull();
    const orphan = await raw.auditLog.findFirst({
      where: { entity: 'users', after: { path: ['email'], equals: email } },
    });
    expect(orphan).toBeNull();

    const created = await prisma.tx((tx) =>
      tx.user.create({ data: { email, passwordHash: 'x', role: 'SEEKER' } }),
    );
    expect(await auditRows(created.id)).toHaveLength(1);
  });

  it('records explicit events (LOGIN_FAILED) through AuditService', async () => {
    await audit.record(
      'LOGIN_FAILED',
      'users',
      null,
      { identifier: 'x', reason: 'UNKNOWN_ACCOUNT' },
      { ip: '1.1.1.1' },
    );
    const row = await raw.auditLog.findFirst({ where: { action: 'LOGIN_FAILED' } });
    expect(row).toMatchObject({ actorUserId: null, ip: '1.1.1.1' });
  });

  it('cannot be bypassed: nested writes, raw writes and audit_log changes are refused', async () => {
    await expect(
      prisma.db.user.create({
        data: {
          email: 'nested@example.com',
          passwordHash: 'x',
          role: 'SEEKER',
          seekerProfile: { create: {} },
        },
      }),
    ).rejects.toThrow(/Nested write/);
    await expect(prisma.db.$executeRaw`UPDATE users SET locale = 'en'`).rejects.toMatchObject({
      code: 'RAW_WRITE_FORBIDDEN',
    });
    const any = await raw.auditLog.findFirstOrThrow();
    await expect(
      prisma.db.auditLog.update({ where: { id: any.id }, data: { action: 'LOGIN' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.db.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
    // and the database itself refuses it too (trigger from migration 0001)
    await expect(raw.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
  });
});

describe('system admin account (FR-2.4.3)', () => {
  it('exists after the seed as SUPER_ADMIN, active, forced to change the password', async () => {
    const adminUser = await prisma.db.user.findUnique({ where: { username: 'admin' } });
    expect(adminUser).toMatchObject({
      email: 'jbahmaid@gmail.com',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      isSystemAccount: true,
      mustChangePassword: true,
    });
  });

  it('cannot be soft-deleted, hard-deleted, suspended, demoted or renamed', async () => {
    const { id } = await prisma.db.user.findUniqueOrThrow({ where: { username: 'admin' } });
    const attempts: Array<() => Promise<unknown>> = [
      () => prisma.db.user.delete({ where: { id } }),
      () => prisma.hardDelete((db) => db.user.delete({ where: { id } })),
      () => prisma.db.user.update({ where: { id }, data: { status: 'SUSPENDED' } }),
      () => prisma.db.user.update({ where: { id }, data: { role: 'ADMIN' } }),
      () => prisma.db.user.update({ where: { id }, data: { username: 'root' } }),
    ];
    for (const attempt of attempts) {
      const err = await asActor(attempt).then(
        () => null,
        (e) => e,
      );
      expect(err).not.toBeNull();
      expect(toApiError(err)).toMatchObject({ statusCode: 403, code: 'SYSTEM_ACCOUNT_PROTECTED' });
    }
    const stillThere = await raw.user.findUniqueOrThrow({ where: { id } });
    expect(stillThere).toMatchObject({
      status: 'ACTIVE',
      role: 'SUPER_ADMIN',
      username: 'admin',
      deletedAt: null,
    });
    // no audit row for a refused change
    expect((await auditRows(id)).filter((r) => r.action !== 'CREATE')).toHaveLength(0);
  });

  it('allows changing the email (audited)', async () => {
    const { id } = await prisma.db.user.findUniqueOrThrow({ where: { username: 'admin' } });
    await asActor(() => prisma.db.user.update({ where: { id }, data: { email: 'new-admin@example.com' } }));
    expect((await auditRows(id)).map((r) => r.action)).toContain('UPDATE');
  });
});
