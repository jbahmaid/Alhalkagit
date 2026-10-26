/**
 * Integration test against a real PostgreSQL 16 (Batch 5): the demo seed (idempotent, audited,
 * removable), the S-22 report queries on that data with the under-5 suppression and the admin
 * filters, an employer's own-jobs report, and the reports export.
 * Server: TEST_DATABASE_ADMIN_URL (default postgresql://postgres:pg@localhost:5432/postgres).
 */
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { ReportRow } from '@sanad/shared';
import ExcelJS from 'exceljs';
import { ClsModule } from 'nestjs-cls';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { AdminAuditService } from '../src/admin/admin-audit.service';
import { AdminUsersService } from '../src/admin/admin-users.service';
import { ExportService } from '../src/admin/export/export.service';
import { AuditModule } from '../src/audit/audit.module';
import { AuditService } from '../src/audit/audit.service';
import { PasswordService } from '../src/auth/password.service';
import { AppConfig } from '../src/config/app-config';
import { APP_CONFIG, AppConfigModule } from '../src/config/config.module';
import { CryptoModule } from '../src/crypto/crypto.module';
import { CryptoService } from '../src/crypto/crypto.service';
import { DEMO_DOMAIN, DEMO_EMPLOYERS, DEMO_JOBS, DEMO_PASSWORD, DEMO_SEEKERS } from '../src/demo/demo-data';
import { DemoSeedService } from '../src/demo/demo-seed.service';
import { MatchingService } from '../src/matching/matching.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReportsService } from '../src/reports/reports.service';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://postgres:pg@localhost:5432/postgres';
const DB_NAME = `sanad_it_reports_${Date.now()}`;
const DB_URL = (() => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
})();
const API_ROOT = join(__dirname, '..');

let server: PrismaClient;
let raw: PrismaClient;
let prisma: PrismaService;
let reports: ReportsService;
let demo: DemoSeedService;
let exporter: ExportService;
const stored = new Map<string, Buffer>();
const storage = {
  put: jest.fn(async (key: string, body: Buffer) => void stored.set(key, body)),
  remove: jest.fn(async (key: string) => void stored.delete(key)),
  get: jest.fn(),
  getBuffer: jest.fn(async (key: string) => stored.get(key)!),
};

function node(args: string[], env: NodeJS.ProcessEnv) {
  const res = spawnSync(process.execPath, args, {
    cwd: API_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`${args.join(' ')} failed:\n${res.stdout}\n${res.stderr}`);
  return res.stdout;
}

const counts = (rows: ReportRow[]) => rows.map((r) => r.count);
const visible = (o: unknown): number[] => {
  const out: number[] = [];
  JSON.stringify(o, (k, v) => {
    if (k === 'count' && typeof v === 'number') out.push(v);
    return v;
  });
  return out;
};

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
  reports = new ReportsService(prisma);
  demo = new DemoSeedService(prisma, crypto, passwords, new MatchingService(prisma), storage as any, config);
  const users = new AdminUsersService(
    prisma,
    audit,
    {} as any,
    passwords,
    {} as any,
    crypto,
    {} as any,
    config,
  );
  exporter = new ExportService(prisma, audit, crypto, users, new AdminAuditService(prisma), reports);
  raw = new PrismaClient({ datasources: { db: { url: DB_URL } } });
}, 120_000);

afterAll(async () => {
  await raw?.$disconnect();
  await (prisma as any)?.onModuleDestroy?.();
  await server.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await server.$disconnect();
});

describe('Batch 5 demo data and reports on PostgreSQL', () => {
  it('an empty platform hides every group', async () => {
    const r = await reports.report('all', {});
    expect(r.seekers.total).toBeNull();
    expect(r.jobs.total).toBeNull();
    expect(r.seekers.byGender).toEqual([]);
    expect(r.minGroupSize).toBe(5);
  });

  it('demo seed: adds the set once, audited, with working logins; a second run does nothing', async () => {
    expect(await demo.seed()).toBe('seeded');
    expect(await demo.seed()).toBe('present');
    const users = await raw.user.findMany({ where: { email: { endsWith: `@${DEMO_DOMAIN}` } } });
    expect(users).toHaveLength(1 + DEMO_EMPLOYERS.length + DEMO_SEEKERS.length);
    expect(users.every((u) => u.status === 'ACTIVE' && !u.mustChangePassword)).toBe(true);
    expect(await new PasswordService().verify(users[0].passwordHash, DEMO_PASSWORD)).toBe(true);
    expect(await raw.job.count()).toBe(DEMO_JOBS.length);
    expect(await raw.employer.count({ where: { approvalStatus: 'PENDING' } })).toBe(1);
    expect(await raw.interestRequest.count()).toBeGreaterThanOrEqual(DEMO_JOBS.length * 2);
    expect(await raw.matchScore.count()).toBeGreaterThan(0);
    expect(stored.size).toBe(DEMO_SEEKERS.filter((s) => s.cv).length);
    const audited = await raw.auditLog.count({ where: { userAgent: 'demo-seed', action: 'CREATE' } });
    expect(audited).toBeGreaterThan(300);
  });

  it('admin report on the demo data: meaningful groups, nothing under 5 visible', async () => {
    const r = await reports.report('all', {});
    expect(r.seekers.total).toBe(40);
    expect(r.seekers.withExperience! + r.seekers.withoutExperience!).toBe(40);
    expect(counts(r.seekers.byAge)).toEqual([8, 17, 10, 5]);
    expect(r.seekers.byGender).toEqual([
      { key: 'MALE', count: 24 },
      { key: 'FEMALE', count: 16 },
    ]);
    // Saudi and Yemeni shown; Egyptian and Sudanese (3 each) hidden.
    const nat = Object.fromEntries(r.seekers.byNationality.map((x) => [x.nameEn, x.count]));
    expect(nat).toMatchObject({ 'Saudi Arabia': 28, Yemen: 6 });
    expect(r.seekers.byNationality.filter((x) => x.count === null)).toHaveLength(2);
    expect(r.seekers.byEducation.every((x) => x.count === null || x.count >= 5)).toBe(true);
    expect(r.seekers.bySector.length).toBeGreaterThanOrEqual(5);
    expect(r.jobs).toMatchObject({
      total: 20,
      open: 10,
      unavailable: 10,
      hiredViaPlatform: 5,
      closedWithoutHiring: 5,
    });
    expect(r.jobs.interestRequests).toBeGreaterThanOrEqual(40);
    expect(r.own).toBeNull();
    for (const n of visible(r)) expect(n).toBeGreaterThanOrEqual(5);
    // No personal data in the payload: no names, emails or ID numbers of the demo people.
    const text = JSON.stringify(r);
    for (const s of DEMO_SEEKERS.slice(0, 5)) expect(text).not.toContain(s.name[3]);
    expect(text).not.toContain(DEMO_DOMAIN);
  });

  it('admin filters: sector, nationality and date range narrow the population', async () => {
    const it = await raw.sector.findFirstOrThrow({ where: { code: 'IT' } });
    const sa = await raw.country.findFirstOrThrow({ where: { isoCode: 'SA' } });
    const bySector = await reports.report('all', { sectorId: it.id });
    expect(bySector.jobs.total).toBe(6);
    expect(bySector.seekers.total).toBeGreaterThanOrEqual(5);
    expect(bySector.seekers.total!).toBeLessThan(40);
    const byCountry = await reports.report('all', { countryId: sa.id });
    expect(byCountry.seekers.total).toBe(28);
    expect(byCountry.jobs.total).toBe(19);
    const today = new Date().toISOString().slice(0, 10);
    const recent = await reports.report('all', { from: '2000-01-01', to: today });
    expect(recent.seekers.total).toBe(40);
    const none = await reports.report('all', { from: '2000-01-01', to: '2000-12-31' });
    expect(none.seekers.total).toBeNull();
    expect(none.filters).toEqual({ from: '2000-01-01', to: '2000-12-31' });
  });

  it('employer: general reports without filters plus their own jobs, unsuppressed', async () => {
    const u = await raw.user.findFirstOrThrow({ where: { email: `employer1@${DEMO_DOMAIN}` } });
    const it = await raw.sector.findFirstOrThrow({ where: { code: 'IT' } });
    const r = await reports.report('general', { sectorId: it.id }, u.id);
    expect(r.scope).toBe('general');
    expect(r.filters).toEqual({});
    expect(r.seekers.total).toBe(40);
    expect(r.own).toMatchObject({ total: 6, open: 3, hiredViaPlatform: 2, closedWithoutHiring: 1 });
    expect(r.own!.jobs).toHaveLength(6);
    expect(r.own!.interestRequests).toBe(r.own!.jobs.reduce((s, j) => s + j.interestRequests, 0));
    expect(JSON.stringify(r.own)).not.toMatch(/seeker|name|email/i);
  });

  it('reports export: three sheets, the same suppression, audited as EXPORT', async () => {
    const plan = await prisma.runAs({ userId: null, role: 'SUPER_ADMIN' }, () =>
      exporter.prepare({ kind: 'reports', locale: 'ar', reports: {} }),
    );
    expect(plan.sheets.map((s) => s.key)).toEqual(['reportSeekers', 'reportJobs', 'reportInfo']);
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on('data', (c) => chunks.push(c));
    await exporter.write(plan, 'ar', out);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.concat(chunks) as any);
    const ws = wb.getWorksheet('تقرير الباحثين')!;
    const rows: unknown[][] = [];
    ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
    expect(rows[0]).toEqual(['التقرير', 'الفئة', 'العدد']);
    expect(rows).toContainEqual(['إجمالي الباحثين', 'الكل', 40]);
    expect(rows.filter((r) => r[2] === 'مخفية (أقل من 5)').length).toBeGreaterThanOrEqual(2);
    for (const r of rows.slice(1)) if (typeof r[2] === 'number') expect(r[2]).toBeGreaterThanOrEqual(5);
    const audit = await raw.auditLog.findFirstOrThrow({
      where: { action: 'EXPORT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.after).toMatchObject({ kind: 'reports', filters: { reports: {} } });
  });

  it('demo remove: every demo row is gone, real data stays, deletions are audited', async () => {
    const before = await raw.user.count({ where: { NOT: { email: { endsWith: `@${DEMO_DOMAIN}` } } } });
    expect(await demo.remove()).toBe(1 + DEMO_EMPLOYERS.length + DEMO_SEEKERS.length);
    expect(await raw.user.count({ where: { email: { endsWith: `@${DEMO_DOMAIN}` } } })).toBe(0);
    expect(await raw.user.count()).toBe(before);
    for (const t of [
      'job',
      'employer',
      'seekerProfile',
      'person',
      'interestRequest',
      'matchScore',
      'uploadedFile',
    ] as const)
      expect(await (raw[t] as any).count()).toBe(0);
    expect(stored.size).toBe(0);
    expect(
      await raw.auditLog.count({ where: { userAgent: 'demo-seed', action: 'HARD_DELETE' } }),
    ).toBeGreaterThan(100);
    expect(await demo.remove()).toBe(0);
    // And it can be added again afterwards.
    expect(await demo.seed()).toBe('seeded');
  });
});
