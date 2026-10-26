/**
 * Integration test against a real PostgreSQL 16 (Batch 3): employer approval, job posting,
 * matching recompute into match_scores, interest requests, applicants, closing as hired, and
 * the audit rows of all of it, on a freshly migrated and seeded database.
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
import { AppException } from '../src/common/app-exception';
import { APP_CONFIG, AppConfigModule } from '../src/config/config.module';
import { AppConfig } from '../src/config/app-config';
import { CryptoModule } from '../src/crypto/crypto.module';
import { CryptoService } from '../src/crypto/crypto.service';
import { FileLinksService } from '../src/files/file-links.service';
import { AdminEmployersService } from '../src/jobs/admin-employers.service';
import { EmployersService } from '../src/jobs/employers.service';
import { SeekerJobsService } from '../src/jobs/seeker-jobs.service';
import { MatchingService } from '../src/matching/matching.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProfileService } from '../src/seekers/profile.service';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://postgres:pg@localhost:5432/postgres';
const DB_NAME = `sanad_it_jobs_${Date.now()}`;
const DB_URL = (() => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
})();
const API_ROOT = join(__dirname, '..');

let admin: PrismaClient;
let raw: PrismaClient;
let prisma: PrismaService;
let profiles: ProfileService;
let matching: MatchingService;
let employers: EmployersService;
let adminEmployers: AdminEmployersService;
let seekerJobs: SeekerJobsService;
const email = { enqueue: jest.fn().mockResolvedValue(undefined) };
const matchingEvents = { jobChanged: jest.fn().mockResolvedValue(undefined) };
const profileEvents = { changed: jest.fn().mockResolvedValue(undefined) };

function node(args: string[], env: NodeJS.ProcessEnv) {
  const res = spawnSync(process.execPath, args, {
    cwd: API_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`${args.join(' ')} failed:\n${res.stdout}\n${res.stderr}`);
  return res.stdout;
}

const as = <T>(userId: string, role: 'SEEKER' | 'EMPLOYER' | 'SUPER_ADMIN', fn: () => Promise<T>) =>
  prisma.runAs({ userId, role, ip: '10.8.8.8', userAgent: 'int-test' }, fn);

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    if (e instanceof AppException) return e.code;
    throw e;
  }
}

let L: {
  sa: string;
  dar: string;
  fakhdh: string;
  bachelor: string;
  diploma: string;
  it: string;
  health: string;
  bt: string;
};

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
  const crypto = moduleRef.get(CryptoService);
  const audit = moduleRef.get(AuditService);
  const config = moduleRef.get<AppConfig>(APP_CONFIG);
  profiles = new ProfileService(prisma, crypto, profileEvents as any, config);
  matching = new MatchingService(prisma);
  employers = new EmployersService(
    prisma,
    matching,
    matchingEvents as any,
    new FileLinksService(crypto),
    audit,
  );
  adminEmployers = new AdminEmployersService(prisma, audit, email as any, config);
  seekerJobs = new SeekerJobsService(prisma, matching, email as any, config);
  raw = new PrismaClient({ datasources: { db: { url: DB_URL } } });

  const code = async (t: 'sector' | 'educationLevel', c: string) =>
    (await (raw[t] as any).findUniqueOrThrow({ where: { code: c } })).id as string;
  L = {
    sa: (await raw.country.findUniqueOrThrow({ where: { isoCode: 'SA' } })).id,
    dar: (await raw.dar.findUniqueOrThrow({ where: { code: 'SAMPLE_DAR_1' } })).id,
    fakhdh: (await raw.fakhdh.findUniqueOrThrow({ where: { code: 'SAMPLE_FAKHDH_1A' } })).id,
    bachelor: await code('educationLevel', 'BACHELOR'),
    diploma: await code('educationLevel', 'DIPLOMA'),
    it: await code('sector', 'IT'),
    health: await code('sector', 'HEALTH'),
    bt: (await raw.businessType.findUniqueOrThrow({ where: { code: 'PRIVATE_SME' } })).id,
  };
}, 120_000);

afterAll(async () => {
  await raw?.$disconnect();
  await (prisma as any)?.onModuleDestroy?.();
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin.$disconnect();
});

async function employerAccount(emailAddr: string, org: string, locale: 'ar' | 'en' = 'ar') {
  const user = await raw.user.create({
    data: {
      email: emailAddr,
      passwordHash: 'x',
      role: 'EMPLOYER',
      status: 'ACTIVE',
      locale,
      emailVerifiedAt: new Date(),
    },
  });
  const employer = await raw.employer.create({
    data: {
      userId: user.id,
      contactName: `مسؤول ${org}`,
      organizationName: org,
      sectorId: L.it,
      businessTypeId: L.bt,
      email: emailAddr,
      phone: '+966511112222',
    },
  });
  return { userId: user.id, employerId: employer.id };
}

async function completeSeeker(emailAddr: string, idNumber: string) {
  const user = await raw.user.create({
    data: { email: emailAddr, passwordHash: 'x', role: 'SEEKER', status: 'ACTIVE' },
  });
  await raw.seekerProfile.create({ data: { userId: user.id } });
  const u = user.id;
  await as(u, 'SEEKER', async () => {
    await profiles.updatePersonal(u, {
      firstName: 'خالد',
      fatherName: 'سالم',
      grandfatherName: 'محمد',
      familyName: 'العتيبي',
      idType: 'NATIONAL_ID',
      idNumber,
      gender: 'MALE',
      birthDate: '1995-05-20',
      nationalityId: L.sa,
      hasSpecialNeeds: false,
    });
    await profiles.updateAffiliation(u, { darId: L.dar, fakhdhId: L.fakhdh });
    await profiles.updateContact(u, { mobile: '0551234567', email: emailAddr });
    await profiles.updateEducation(u, {
      educationLevelId: L.bachelor,
      graduationYear: 2017,
      institution: 'جامعة الملك سعود',
      countryId: L.sa,
      fieldOfStudy: 'علوم الحاسب',
    } as any);
    await profiles.updateExperience(u, {
      hasExperience: true,
      yearsOfExperience: 6,
      positions: [{ title: 'محلل بيانات', startDate: '2019-01', endDate: null, sectorId: L.it }],
      verifier: null,
    } as any);
    await profiles.complete(u);
  });
  const profile = await raw.seekerProfile.findUniqueOrThrow({ where: { userId: u } });
  return { userId: u, seekerId: profile.id };
}

const job = (over: Record<string, unknown> = {}) => ({
  title: 'محلل بيانات أول',
  description: 'تحليل بيانات المبيعات وبناء لوحات المتابعة للإدارة.',
  sectorId: L.it,
  city: 'الرياض',
  countryId: L.sa,
  requiredEducationLevelId: L.bachelor,
  minYearsExperience: 3,
  employmentType: 'FULL_TIME' as const,
  ...over,
});

describe('employers, jobs, matching and interest on a real database', () => {
  let emp: { userId: string; employerId: string };
  let other: { userId: string; employerId: string };
  let seeker: { userId: string; seekerId: string };
  let outsider: { userId: string; seekerId: string };
  let adminId: string;
  let fitJobId: string;
  let farJobId: string;
  let interestId: string;

  beforeAll(async () => {
    adminId = (await raw.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' } })).id;
    emp = await employerAccount('hr@horizon.example', 'شركة الأفق', 'en');
    other = await employerAccount('hr@other.example', 'مؤسسة أخرى');
    seeker = await completeSeeker('seeker@example.com', '1012345678');
    outsider = await completeSeeker('outsider@example.com', '1098765432');
  });

  it('blocks an unapproved employer, then approves and emails in the employer language', async () => {
    expect(await codeOf(as(emp.userId, 'EMPLOYER', () => employers.createJob(emp.userId, job())))).toBe(
      'EMPLOYER_NOT_APPROVED',
    );
    await as(adminId, 'SUPER_ADMIN', () => adminEmployers.approve(adminId, emp.employerId));
    await as(adminId, 'SUPER_ADMIN', () => adminEmployers.approve(adminId, other.employerId));
    expect(email.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'employerApproved', to: 'hr@horizon.example', locale: 'en' }),
    );
    expect(
      await codeOf(as(adminId, 'SUPER_ADMIN', () => adminEmployers.approve(adminId, emp.employerId))),
    ).toBe('EMPLOYER_ALREADY_DECIDED');
    const row = await raw.employer.findUniqueOrThrow({ where: { id: emp.employerId } });
    expect(row).toMatchObject({ approvalStatus: 'APPROVED', approvedById: adminId });
  });

  it('posts jobs and recomputes match_scores (job side and seeker side)', async () => {
    fitJobId = (await as(emp.userId, 'EMPLOYER', () => employers.createJob(emp.userId, job()))).id;
    farJobId = (
      await as(emp.userId, 'EMPLOYER', () =>
        employers.createJob(
          emp.userId,
          job({
            title: 'ممرض',
            sectorId: L.health,
            minYearsExperience: 10,
            description: 'رعاية المرضى في قسم الطوارئ بالمستشفى.',
          }),
        ),
      )
    ).id;
    expect(matchingEvents.jobChanged).toHaveBeenCalledWith(fitJobId);

    // What the worker does for job.updated, then for profile.updated.
    expect(await as(adminId, 'SUPER_ADMIN', () => matching.recomputeJob(fitJobId))).toBe(2);
    expect(await as(adminId, 'SUPER_ADMIN', () => matching.recomputeSeeker(seeker.seekerId))).toBe(1);
    // Nothing changed: nothing is rewritten (and nothing more is audited).
    expect(await as(adminId, 'SUPER_ADMIN', () => matching.recomputeSeeker(seeker.seekerId))).toBe(0);

    const scores = await raw.matchScore.findMany({ where: { seekerId: seeker.seekerId } });
    const fit = scores.find((s) => s.jobId === fitJobId)!;
    const far = scores.find((s) => s.jobId === farJobId)!;
    expect(fit).toMatchObject({ label: 'SUITABLE' });
    expect(fit.score).toBeGreaterThanOrEqual(90);
    expect(fit.breakdown).toMatchObject({ sectorMatch: true, educationMet: true, experienceMet: true });
    expect(far.label).toBe('NONE');
  });

  it('lists jobs for the seeker best first, with no employer data', async () => {
    const list = await as(seeker.userId, 'SEEKER', () => seekerJobs.list(seeker.userId, {}));
    expect(list.items.map((j) => j.id)).toEqual([fitJobId, farJobId]);
    expect(list.items[0].match.label).toBe('SUITABLE');
    const fitOnly = await as(seeker.userId, 'SEEKER', () => seekerJobs.list(seeker.userId, { fit: true }));
    expect(fitOnly.items.map((j) => j.id)).toEqual([fitJobId]);
    const byCity = await as(seeker.userId, 'SEEKER', () =>
      seekerJobs.list(seeker.userId, { city: 'الرياض', q: 'محلل' }),
    );
    expect(byCity.items.map((j) => j.id)).toEqual([fitJobId]);
    const json = JSON.stringify(list);
    for (const s of ['شركة الأفق', 'hr@horizon.example', '511112222', emp.employerId, emp.userId]) {
      expect(json).not.toContain(s);
    }
  });

  it('records an interest with consent and emails the employer without seeker identifiers', async () => {
    const res = await as(seeker.userId, 'SEEKER', () =>
      seekerJobs.expressInterest(seeker.userId, fitJobId, { consent: true }),
    );
    expect(res.interest?.status).toBe('SUBMITTED');
    const req = await raw.interestRequest.findFirstOrThrow({
      where: { jobId: fitJobId, seekerId: seeker.seekerId },
    });
    interestId = req.id;
    expect(req.consentAt).toBeInstanceOf(Date);
    expect(
      await codeOf(
        as(seeker.userId, 'SEEKER', () =>
          seekerJobs.expressInterest(seeker.userId, fitJobId, { consent: true }),
        ),
      ),
    ).toBe('INTEREST_EXISTS');
    const mail = email.enqueue.mock.calls.map((c) => c[0]).find((m) => m.template === 'newInterest');
    expect(mail).toMatchObject({ to: 'hr@horizon.example', locale: 'en' });
    expect(mail.vars.link).toContain(`/en/employer/jobs/${fitJobId}/applicants`);
    expect(JSON.stringify(mail)).not.toMatch(/1012345678|SAMPLE_DAR|SAMPLE_FAKHDH/);
  });

  it('shows applicants only to the owning employer, without ID, dar or fakhdh', async () => {
    const list = await as(emp.userId, 'EMPLOYER', () => employers.applicants(emp.userId, fitJobId));
    expect(list.applicants).toHaveLength(1);
    expect(list.applicants[0]).toMatchObject({ interestId, fullName: expect.stringContaining('خالد') });

    expect(
      await codeOf(as(other.userId, 'EMPLOYER', () => employers.applicants(other.userId, fitJobId))),
    ).toBe('JOB_NOT_FOUND');
    expect(
      await codeOf(as(other.userId, 'EMPLOYER', () => employers.applicant(other.userId, interestId))),
    ).toBe('APPLICANT_NOT_FOUND');

    const profile = await as(emp.userId, 'EMPLOYER', () => employers.applicant(emp.userId, interestId));
    expect(profile.mobile).toBe('+966551234567');
    const json = JSON.stringify(profile);
    expect(json).not.toMatch(/1012345678|idNumber|darId|fakhdhId|dar"|fakhdh"/);
    expect((await raw.interestRequest.findUniqueOrThrow({ where: { id: interestId } })).status).toBe(
      'VIEWED',
    );

    // The outsider never expressed interest: there is no interest id that reaches them.
    const outsiderInterest = await raw.interestRequest.findFirst({ where: { seekerId: outsider.seekerId } });
    expect(outsiderInterest).toBeNull();
  });

  it('closes the job as hired, counts it, and the seeker sees it as no longer available', async () => {
    await as(emp.userId, 'EMPLOYER', () =>
      employers.closeJob(emp.userId, fitJobId, {
        outcome: 'HIRED_VIA_PLATFORM',
        hiredInterestId: interestId,
      }),
    );
    const j = await raw.job.findUniqueOrThrow({ where: { id: fitJobId } });
    expect(j).toMatchObject({
      status: 'UNAVAILABLE',
      closedOutcome: 'HIRED_VIA_PLATFORM',
      hiredSeekerId: seeker.seekerId,
    });
    const dash = await as(emp.userId, 'EMPLOYER', () => employers.dashboard(emp.userId));
    expect(dash.stats).toEqual({ openJobs: 1, interestRequests: 1, hiredViaPlatform: 1 });

    const mine = await as(seeker.userId, 'SEEKER', () => seekerJobs.myInterests(seeker.userId));
    expect(mine).toEqual([expect.objectContaining({ status: 'HIRED', jobAvailable: false })]);
    expect(
      await codeOf(
        as(outsider.userId, 'SEEKER', () =>
          seekerJobs.expressInterest(outsider.userId, fitJobId, { consent: true }),
        ),
      ),
    ).toBe('JOB_CLOSED');
    expect(
      await codeOf(as(outsider.userId, 'SEEKER', () => seekerJobs.detail(outsider.userId, fitJobId))),
    ).toBe('JOB_NOT_AVAILABLE');
    const list = await as(seeker.userId, 'SEEKER', () => seekerJobs.list(seeker.userId, {}));
    expect(list.items.map((x) => x.id)).toEqual([farJobId]);
  });

  it('writes audit rows for approval, jobs, interests, match scores and sensitive views', async () => {
    const rows = await raw.auditLog.findMany({});
    const count = (entity: string, action: string, actor?: string) =>
      rows.filter((r) => r.entity === entity && r.action === action && (!actor || r.actorUserId === actor))
        .length;
    expect(count('employers', 'APPROVE', adminId)).toBe(2);
    expect(count('employers', 'UPDATE', adminId)).toBe(2);
    expect(count('jobs', 'CREATE', emp.userId)).toBe(2);
    expect(count('jobs', 'UPDATE', emp.userId)).toBe(1);
    expect(count('interest_requests', 'CREATE', seeker.userId)).toBe(1);
    expect(count('interest_requests', 'UPDATE', emp.userId)).toBeGreaterThanOrEqual(2); // VIEWED, then HIRED
    expect(count('match_scores', 'CREATE')).toBe(3); // fit job x 2 seekers, then the seeker x the other job
    expect(count('seeker_profiles', 'VIEW_SENSITIVE', emp.userId)).toBe(1);
    expect(JSON.stringify(rows.filter((r) => r.entity === 'interest_requests'))).not.toContain('1012345678');
  });
});
