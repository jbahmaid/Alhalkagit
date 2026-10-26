/**
 * Integration test against a real PostgreSQL 16: the seeker profile wizard, positions, CV upload
 * (storage faked in memory) and their audit rows, on a freshly migrated and seeded database.
 * Server: TEST_DATABASE_ADMIN_URL (default postgresql://postgres:pg@localhost:5432/postgres).
 */
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { ClsModule } from 'nestjs-cls';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { AuditModule } from '../src/audit/audit.module';
import { AppException } from '../src/common/app-exception';
import { APP_CONFIG, AppConfigModule } from '../src/config/config.module';
import { AppConfig } from '../src/config/app-config';
import { CryptoModule } from '../src/crypto/crypto.module';
import { CryptoService } from '../src/crypto/crypto.service';
import { FileLinksService } from '../src/files/file-links.service';
import { FileStorage } from '../src/files/file-storage';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CvService } from '../src/seekers/cv.service';
import { ProfileService } from '../src/seekers/profile.service';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://postgres:pg@localhost:5432/postgres';
const DB_NAME = `sanad_it_profile_${Date.now()}`;
const DB_URL = (() => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
})();
const API_ROOT = join(__dirname, '..');

let admin: PrismaClient;
let raw: PrismaClient;
let prisma: PrismaService;
let crypto: CryptoService;
let profiles: ProfileService;
let cv: CvService;
const events = { changed: jest.fn().mockResolvedValue(undefined) };
const objects = new Map<string, Buffer>();
const storage: FileStorage = {
  put: async (key, body) => void objects.set(key, body),
  get: async (key) => ({ body: Readable.from(objects.get(key)!), contentLength: objects.get(key)!.length }),
  getBuffer: async (key) => objects.get(key)!,
  remove: async (key) => void objects.delete(key),
};
const queue = { add: jest.fn().mockResolvedValue(undefined) };

function node(args: string[], env: NodeJS.ProcessEnv) {
  const res = spawnSync(process.execPath, args, {
    cwd: API_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`${args.join(' ')} failed:\n${res.stdout}\n${res.stderr}`);
  return res.stdout;
}

async function seekerAccount(email: string) {
  const user = await raw.user.create({
    data: { email, passwordHash: 'x', role: 'SEEKER', status: 'ACTIVE' },
  });
  await raw.seekerProfile.create({ data: { userId: user.id } });
  return user;
}

/** Runs as the seeker, like a request would (actor in the audit trail). */
const as = <T>(userId: string, fn: () => Promise<T>) =>
  prisma.runAs({ userId, role: 'SEEKER', ip: '10.9.9.9', userAgent: 'int-test' }, fn);

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    if (e instanceof AppException) return e.code;
    throw e;
  }
}

let lookups: { sa: string; dar: string; fakhdh: string; level: string };

beforeAll(async () => {
  admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
  const env = { DATABASE_URL: DB_URL };
  node([require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], env);
  const secretsDir = mkdtempSync(join(tmpdir(), 'sanad-int-'));
  node([require.resolve('tsx/cli'), 'prisma/seed.ts'], {
    ...env,
    ADMIN_EMAIL: 'jbahmaid@gmail.com',
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
  crypto = moduleRef.get(CryptoService);
  const config = moduleRef.get<AppConfig>(APP_CONFIG);
  profiles = new ProfileService(prisma, crypto, events as any, config);
  cv = new CvService(prisma, profiles, new FileLinksService(crypto), crypto, storage, config, queue as any);
  raw = new PrismaClient({ datasources: { db: { url: DB_URL } } });

  const sa = await raw.country.findUniqueOrThrow({ where: { isoCode: 'SA' } });
  const dar = await raw.dar.findUniqueOrThrow({ where: { code: 'SAMPLE_DAR_1' } });
  const fakhdh = await raw.fakhdh.findUniqueOrThrow({ where: { code: 'SAMPLE_FAKHDH_1A' } });
  const level = await raw.educationLevel.findUniqueOrThrow({ where: { code: 'BACHELOR' } });
  lookups = { sa: sa.id, dar: dar.id, fakhdh: fakhdh.id, level: level.id };
}, 120_000);

afterAll(async () => {
  await raw?.$disconnect();
  await (prisma as any)?.onModuleDestroy?.();
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin.$disconnect();
});

const personal = (idNumber: string | null) => ({
  firstName: 'خالد',
  fatherName: 'سالم',
  grandfatherName: 'محمد',
  familyName: 'العتيبي',
  idType: 'NATIONAL_ID' as const,
  idNumber,
  gender: 'MALE' as const,
  birthDate: '1995-05-20',
  nationalityId: lookups.sa,
  hasSpecialNeeds: false,
});

describe('seeker profile on a real database', () => {
  let userId: string;
  let seekerId: string;

  it('runs the whole wizard and tracks completion_step', async () => {
    const user = await seekerAccount('wizard@example.com');
    userId = user.id;
    seekerId = (await raw.seekerProfile.findUniqueOrThrow({ where: { userId } })).id;

    let p = await as(userId, () => profiles.updatePersonal(userId, personal('١٠١٢٣٤٥٦٧٨')));
    expect(p.completionStep).toBe('TRIBE');
    p = await as(userId, () =>
      profiles.updateAffiliation(userId, { darId: lookups.dar, fakhdhId: lookups.fakhdh }),
    );
    p = await as(userId, () =>
      profiles.updateContact(userId, { mobile: '0551234567', email: 'k@example.com' }),
    );
    p = await as(userId, () =>
      profiles.updateEducation(userId, {
        educationLevelId: lookups.level,
        graduationYear: 2018,
        institution: 'جامعة الملك سعود',
        countryId: lookups.sa,
      }),
    );
    expect(p.completionStep).toBe('EXPERIENCE');
    p = await as(userId, () =>
      profiles.updateExperience(userId, {
        hasExperience: true,
        yearsOfExperience: 6,
        positions: [
          { title: 'محلل بيانات', startDate: '2022-05', endDate: null },
          { title: 'مساعد محلل', startDate: '2019-01', endDate: '2022-04' },
          { title: 'متدرب', startDate: '2018-06', endDate: '2018-12' },
        ],
        verifier: { name: 'أحمد', phone: '0501112222' },
      }),
    );
    expect(p.experience.positions).toHaveLength(3);
    expect(p.completionStep).toBe('CV');

    await as(userId, () => profiles.deletePosition(userId, p.experience.positions[2].id));
    const left = await as(userId, () => profiles.listPositions(userId));
    expect(left.map((x) => x.title)).toEqual(['محلل بيانات', 'مساعد محلل']);
    const reordered = await as(userId, () => profiles.reorderPositions(userId, [left[1].id, left[0].id]));
    expect(reordered[0].title).toBe('مساعد محلل');

    p = await as(userId, () => profiles.complete(userId));
    expect(p.completionStep).toBe('COMPLETED');
    const row = await raw.seekerProfile.findUniqueOrThrow({ where: { id: seekerId } });
    expect(row.completionStep).toBe('COMPLETED');
    expect(events.changed).toHaveBeenCalledWith(seekerId, 'completed');
  });

  it('keeps the ID number encrypted at rest and refuses duplicates across accounts', async () => {
    const person = await raw.person.findFirstOrThrow({ where: { userId } });
    expect(person.idNumberEncrypted).not.toContain('1012345678');
    expect(crypto.decrypt(person.idNumberEncrypted)).toBe('1012345678');
    expect(person.idNumberHash).toBe(crypto.hashIdNumber('NATIONAL_ID', '1012345678'));
    expect(person.mobile).toBe('+966551234567');

    const other = await seekerAccount('other@example.com');
    expect(await codeOf(as(other.id, () => profiles.updatePersonal(other.id, personal('1012345678'))))).toBe(
      'PROFILE_ID_NUMBER_TAKEN',
    );
  });

  it('uploads, replaces (keeping the previous file) and removes the CV', async () => {
    const pdf = Buffer.from('%PDF-1.4\n% test\n%%EOF');
    await as(userId, () => cv.upload(userId, { originalname: 'cv-1.pdf', buffer: pdf, size: pdf.length }));
    const p = await as(userId, () =>
      cv.upload(userId, { originalname: 'سيرتي.pdf', buffer: pdf, size: pdf.length }),
    );
    expect(p.cv.file?.originalName).toBe('سيرتي.pdf');
    expect(p.cv.previousVersions).toBe(1);
    expect(p.cv.analysis?.status).toBe('SKIPPED');
    expect(await raw.uploadedFile.count({ where: { ownerUserId: userId } })).toBe(2);
    expect(objects.size).toBe(2);

    const removed = await as(userId, () => cv.remove(userId));
    expect(removed.cv.file).toBeNull();
    const files = await raw.uploadedFile.findMany({
      where: { ownerUserId: userId },
      orderBy: { createdAt: 'asc' },
    });
    expect(files.map((f) => !!f.deletedAt)).toEqual([false, true]);
  });

  it('writes audit rows for every change, attributed to the seeker, with the ID masked', async () => {
    const rows = await raw.auditLog.findMany({ where: { actorUserId: userId } });
    const count = (entity: string, action: string) =>
      rows.filter((r) => r.entity === entity && r.action === action).length;
    expect(count('persons', 'CREATE')).toBe(1);
    expect(count('persons', 'UPDATE')).toBeGreaterThanOrEqual(2);
    expect(count('seeker_educations', 'CREATE')).toBe(1);
    expect(count('experience_positions', 'CREATE')).toBe(3);
    expect(count('experience_positions', 'DELETE')).toBe(1);
    expect(count('experience_contacts', 'CREATE')).toBe(1);
    expect(count('uploaded_files', 'CREATE')).toBe(2);
    expect(count('uploaded_files', 'DELETE')).toBe(1);
    expect(count('cv_analyses', 'CREATE')).toBe(2);
    expect(count('seeker_profiles', 'UPDATE')).toBeGreaterThan(5);
    const personRow = rows.find((r) => r.entity === 'persons' && r.action === 'CREATE')!;
    expect((personRow.after as any).idNumberEncrypted).toBe('[REDACTED]');
    expect((personRow.after as any).idNumberHash).toBe('[REDACTED]');
    expect(JSON.stringify(rows)).not.toContain('1012345678');
    expect(personRow).toMatchObject({ actorRole: 'SEEKER', ip: '10.9.9.9' });
  });

  it('enforces date order in the database too (CHECK constraint)', async () => {
    await expect(
      raw.experiencePosition.create({
        data: { seekerId, title: 'x', startDate: new Date('2022-01-01'), endDate: new Date('2021-01-01') },
      }),
    ).rejects.toThrow(/experience_positions_dates_chk/);
  });
});
