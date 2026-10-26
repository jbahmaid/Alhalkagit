/**
 * Integration test against a real PostgreSQL 16 (Batch 4): lookups CRUD, accounts and the
 * system account (API refusal first, database trigger second), admin creation (display_name,
 * migration 0004), ID reveal, the audit viewer's filters, matching settings with a full
 * recompute, and the Excel export, with the audit rows of all of it.
 * Server: TEST_DATABASE_ADMIN_URL (default postgresql://postgres:pg@localhost:5432/postgres).
 */
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { ClsModule } from 'nestjs-cls';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { AdminAuditService } from '../src/admin/admin-audit.service';
import { AdminLookupsService } from '../src/admin/admin-lookups.service';
import { AdminSettingsService } from '../src/admin/admin-settings.service';
import { AdminUsersService } from '../src/admin/admin-users.service';
import { ExportService } from '../src/admin/export/export.service';
import { AuditModule } from '../src/audit/audit.module';
import { AuditService } from '../src/audit/audit.service';
import { PasswordService } from '../src/auth/password.service';
import { PermissionsService } from '../src/auth/permissions.service';
import { TokenService } from '../src/auth/token.service';
import { AppException } from '../src/common/app-exception';
import { AuthUser } from '../src/common/decorators';
import { AppConfig } from '../src/config/app-config';
import { APP_CONFIG, AppConfigModule } from '../src/config/config.module';
import { CryptoModule } from '../src/crypto/crypto.module';
import { CryptoService } from '../src/crypto/crypto.service';
import { MatchingService } from '../src/matching/matching.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProfileService } from '../src/seekers/profile.service';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://postgres:pg@localhost:5432/postgres';
const DB_NAME = `sanad_it_admin_${Date.now()}`;
const DB_URL = (() => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
})();
const API_ROOT = join(__dirname, '..');
const PASSWORD = 'Super-Admin-2026';

let server: PrismaClient;
let raw: PrismaClient;
let prisma: PrismaService;
let lookups: AdminLookupsService;
let users: AdminUsersService;
let auditLog: AdminAuditService;
let settings: AdminSettingsService;
let exporter: ExportService;
let profiles: ProfileService;
const email = { enqueue: jest.fn().mockResolvedValue(undefined) };
const matchingEvents = { recomputeAll: jest.fn().mockResolvedValue(undefined) };
const profileEvents = { changed: jest.fn().mockResolvedValue(undefined) };
let system: { id: string };
let superAdmin: AuthUser;

function node(args: string[], env: NodeJS.ProcessEnv) {
  const res = spawnSync(process.execPath, args, {
    cwd: API_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`${args.join(' ')} failed:\n${res.stdout}\n${res.stderr}`);
  return res.stdout;
}

const as = <T>(u: AuthUser, fn: () => Promise<T>) =>
  prisma.runAs({ userId: u.id, role: u.role, ip: '10.9.9.9', userAgent: 'int-test' }, fn);

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    if (e instanceof AppException) {
      const d = e.details as { field: string; errors: string[] }[] | undefined;
      return Array.isArray(d) ? `${e.code}:${d.map((x) => `${x.field}=${x.errors}`).join(',')}` : e.code;
    }
    throw e;
  }
}

beforeAll(async () => {
  server = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  await server.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
  const env = { DATABASE_URL: DB_URL };
  node([require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], env);
  const secretsDir = mkdtempSync(join(tmpdir(), 'sanad-int-'));
  node([require.resolve('tsx/cli'), 'prisma/seed.ts'], {
    ...env,
    ADMIN_EMAIL: 'admin@sanad.example',
    ADMIN_PASSWORD_FILE: join(secretsDir, 'admin-initial-password.txt'),
  });

  process.env.DATABASE_URL = DB_URL;
  process.env.SECRETS_FILE = join(secretsDir, 'keys.json');
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppConfigModule.forRoot({ generateMissingSecrets: true }),
      ClsModule.forRoot({ global: true }),
      PrismaModule,
      AuditModule,
      CryptoModule,
    ],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  const crypto = moduleRef.get(CryptoService);
  const audit = moduleRef.get(AuditService);
  const config = moduleRef.get<AppConfig>(APP_CONFIG);
  const passwords = new PasswordService();
  const tokens = new TokenService(config, new JwtService({}), prisma, crypto);
  lookups = new AdminLookupsService(prisma);
  users = new AdminUsersService(
    prisma,
    audit,
    new PermissionsService(prisma),
    passwords,
    tokens,
    crypto,
    email as any,
    config,
  );
  auditLog = new AdminAuditService(prisma);
  settings = new AdminSettingsService(prisma, new MatchingService(prisma), matchingEvents as any);
  exporter = new ExportService(prisma, audit, crypto, users, auditLog);
  profiles = new ProfileService(prisma, crypto, profileEvents as any, config);
  raw = new PrismaClient({ datasources: { db: { url: DB_URL } } });

  system = await raw.user.findFirstOrThrow({ where: { isSystemAccount: true } });
  const sup = await raw.user.create({
    data: {
      email: 'super2@sanad.example',
      passwordHash: await passwords.hash(PASSWORD),
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  superAdmin = { id: sup.id, role: 'SUPER_ADMIN', mustChangePassword: false };
}, 120_000);

afterAll(async () => {
  await raw?.$disconnect();
  await (prisma as any)?.onModuleDestroy?.();
  await server.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await server.$disconnect();
});

describe('Batch 4 admin area on PostgreSQL', () => {
  it('lookups: add, unique code, deactivate (kept on records, gone from active lists), all audited', async () => {
    const dar = await as(superAdmin, () =>
      lookups.create('dars', { code: 'DAR_NEW', nameAr: 'دار جديدة', nameEn: 'New dar' }),
    );
    expect(dar).toMatchObject({ code: 'DAR_NEW', isActive: true });
    expect(
      await codeOf(
        as(superAdmin, () => lookups.create('dars', { code: 'DAR_NEW', nameAr: 'x', nameEn: 'y' })),
      ),
    ).toBe('VALIDATION_FAILED:code=LOOKUP_CODE_TAKEN');
    // every ISO country is seeded already: SA is taken, a user-assigned code is free
    expect(
      await codeOf(
        as(superAdmin, () => lookups.create('countries', { code: 'SA', nameAr: 'x', nameEn: 'y' })),
      ),
    ).toBe('VALIDATION_FAILED:code=LOOKUP_CODE_TAKEN');
    const xq = await as(superAdmin, () =>
      lookups.create('countries', { code: 'XQ', nameAr: 'دولة اختبار', nameEn: 'Test land' }),
    );
    expect((await raw.country.findUniqueOrThrow({ where: { id: xq.id } })).isoCode).toBe('XQ');

    await as(superAdmin, () => lookups.update('dars', dar.id, { isActive: false }));
    expect((await raw.dar.findUniqueOrThrow({ where: { id: dar.id } })).isActive).toBe(false);
    const rows = await raw.auditLog.findMany({
      where: { entity: 'dars', entityId: dar.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
    expect(rows[1].actorUserId).toBe(superAdmin.id);
  });

  it('creates an admin with display_name (migration 0004); the temporary password is never logged', async () => {
    const row = await as(superAdmin, () =>
      users.createAdmin({
        email: 'ops@sanad.example',
        username: 'ops',
        name: 'مدير العمليات',
        role: 'ADMIN',
      }),
    );
    const u = await raw.user.findUniqueOrThrow({ where: { id: row.id } });
    expect(u).toMatchObject({
      displayName: 'مدير العمليات',
      mustChangePassword: true,
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    const temp = email.enqueue.mock.calls.at(-1)[0].vars.password as string;
    const audit = await raw.auditLog.findFirstOrThrow({
      where: { entity: 'users', entityId: row.id, action: 'CREATE' },
    });
    expect(JSON.stringify(audit.after)).not.toContain(temp);
    expect(JSON.stringify(audit.after)).toContain('[REDACTED]');
    expect((await users.list({ q: 'العمليات' })).items.map((x) => x.id)).toEqual([row.id]);
  });

  it('system account: refused by the API first, by the database trigger second; its email may change', async () => {
    const attempts: (() => Promise<unknown>)[] = [
      () => users.suspend(superAdmin, system.id),
      () => users.remove(superAdmin, system.id),
      () => users.changeRole(superAdmin, system.id, 'ADMIN'),
    ];
    for (const attempt of attempts) {
      expect(await codeOf(as(superAdmin, attempt))).toBe('SYSTEM_ACCOUNT_PROTECTED');
    }
    await expect(
      raw.user.update({ where: { id: system.id }, data: { status: 'SUSPENDED' } }),
    ).rejects.toThrow();
    await expect(raw.user.update({ where: { id: system.id }, data: { role: 'ADMIN' } })).rejects.toThrow();

    const row = await as(superAdmin, () =>
      users.changeEmail(superAdmin, system.id, { email: 'root@sanad.example', currentPassword: PASSWORD }),
    );
    expect(row.email).toBe('root@sanad.example');
    const audit = await raw.auditLog.findFirstOrThrow({
      where: { entity: 'users', entityId: system.id, action: 'UPDATE', actorUserId: superAdmin.id },
    });
    expect(audit.after).toMatchObject({ email: 'root@sanad.example' });
  });

  it('seekers: admin edits the profile through the wizard rules and reveals the ID (VIEW_SENSITIVE)', async () => {
    const seeker = await raw.user.create({
      data: {
        email: 'seeker@s.example',
        passwordHash: 'x',
        role: 'SEEKER',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    await raw.seekerProfile.create({ data: { userId: seeker.id } });
    const sa = (await raw.country.findUniqueOrThrow({ where: { isoCode: 'SA' } })).id;
    await as(superAdmin, () =>
      profiles.updatePersonal(seeker.id, {
        firstName: 'خالد',
        fatherName: 'سالم',
        grandfatherName: 'محمد',
        familyName: 'العتيبي',
        idType: 'NATIONAL_ID',
        idNumber: '1098765432',
        gender: 'MALE',
        birthDate: '1995-05-20',
        nationalityId: sa,
        hasSpecialNeeds: false,
      }),
    );
    await as(superAdmin, () =>
      profiles.updateContact(seeker.id, { mobile: '0551234567', email: 'k@contact.example' }),
    );
    expect(await as(superAdmin, () => users.revealId(seeker.id))).toEqual({
      idType: 'NATIONAL_ID',
      idNumber: '1098765432',
    });
    const view = await raw.auditLog.findFirstOrThrow({ where: { action: 'VIEW_SENSITIVE' } });
    expect(view).toMatchObject({ actorUserId: superAdmin.id, entity: 'persons' });
    expect(JSON.stringify(await raw.auditLog.findMany({}))).not.toContain('1098765432');
    // search by the seeker's name (relation filter on persons)
    expect((await users.list({ q: 'العتيبي', role: 'SEEKER' })).items.map((x) => x.id)).toEqual([seeker.id]);
  });

  it('audit viewer filters by user text, action, table and date range', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const page = await auditLog.page({ user: 'super2@', action: 'VIEW_SENSITIVE', from: today, to: today });
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ actorLabel: 'super2@sanad.example', entity: 'persons' });
    expect(page.entities).toEqual(expect.arrayContaining(['users', 'dars', 'persons']));
    expect((await auditLog.page({ entity: 'dars', to: '2000-01-01' })).total).toBe(0);
  });

  it('matching settings: weights must sum to 100; saving updates the rows and queues a full recompute', async () => {
    expect(
      await codeOf(
        as(superAdmin, () =>
          settings.save(superAdmin.id, {
            weights: { sector: 40, education: 20, experience: 20, keywords: 10 },
            thresholds: { suitable: 70, near: 50 },
          }),
        ),
      ),
    ).toBe('VALIDATION_FAILED:weights=WEIGHTS_SUM');
    await as(superAdmin, () =>
      settings.save(superAdmin.id, {
        weights: { sector: 40, education: 20, experience: 20, keywords: 20 },
        thresholds: { suitable: 75, near: 45 },
      }),
    );
    expect(await settings.get()).toEqual({
      weights: { sector: 40, education: 20, experience: 20, keywords: 20 },
      thresholds: { suitable: 75, near: 45 },
    });
    expect(matchingEvents.recomputeAll).toHaveBeenCalledTimes(1);
    expect(
      await raw.auditLog.count({ where: { entity: 'settings', action: 'UPDATE' } }),
    ).toBeGreaterThanOrEqual(2);
  });

  it('full export streams a workbook with the decrypted ID and is audited as EXPORT', async () => {
    const plan = await as(superAdmin, () => exporter.prepare({ kind: 'full', locale: 'en' }));
    const out = new PassThrough();
    const parts: Buffer[] = [];
    out.on('data', (c) => parts.push(c));
    const counts = await exporter.write(plan, 'en', out);
    expect(counts).toMatchObject({ seekers: 1, users: 4 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.concat(parts) as any);
    const ws = wb.getWorksheet('Seekers')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    const id = ws.getRow(2).getCell(header.indexOf('ID number') + 1).value;
    const mobile = ws.getRow(2).getCell(header.indexOf('Mobile') + 1).value;
    expect([id, mobile]).toEqual(['1098765432', '0551234567']);
    expect(wb.getWorksheet('Audit log')!.rowCount).toBeGreaterThan(5);
    const row = await raw.auditLog.findFirstOrThrow({ where: { action: 'EXPORT' } });
    expect(row).toMatchObject({ actorUserId: superAdmin.id, entity: 'export' });
    expect(row.after).toMatchObject({ kind: 'full', locale: 'en' });
  });
});
