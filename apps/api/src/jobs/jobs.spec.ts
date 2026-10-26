import { AppException } from '../common/app-exception';
import { CryptoService } from '../crypto/crypto.service';
import { FileLinksService } from '../files/file-links.service';
import { MatchingService } from '../matching/matching.service';
import { createFakePrisma, testConfig } from '../testing/fake-prisma';
import { EmployersService } from './employers.service';
import { SEEKER_JOB_KEYS, SEEKER_JOB_SELECT, SeekerJobView } from './seeker-job.view';
import { SeekerJobsService } from './seeker-jobs.service';

const EMPLOYER = {
  contactName: 'Sara Hidden-Contact',
  organizationName: 'Madar Hidden-Org',
  email: 'hidden-employer@madar.example',
  phone: '+966112345678',
};

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppException) return e.code;
    throw e;
  }
  return 'OK';
}

async function setup() {
  const config = testConfig();
  const prisma = createFakePrisma();
  const db = prisma.db as any;
  const crypto = new CryptoService(config);
  const matching = new MatchingService(prisma as any);
  const events = { jobChanged: jest.fn().mockResolvedValue(undefined) };
  const email = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const employers = new EmployersService(
    prisma as any,
    matching,
    events as any,
    new FileLinksService(crypto),
    audit as any,
  );
  const seekers = new SeekerJobsService(prisma as any, matching, email as any, config);

  const it = await db.sector.create({ data: { code: 'IT', nameAr: 'تقنية', nameEn: 'IT' } });
  const fin = await db.sector.create({ data: { code: 'FIN', nameAr: 'مالية', nameEn: 'Finance' } });
  const sa = await db.country.create({ data: { isoCode: 'SA', nameAr: 'السعودية', nameEn: 'Saudi Arabia' } });
  const bachelor = await db.educationLevel.create({
    data: { code: 'BACHELOR', nameAr: 'ب', nameEn: 'B', rank: 40 },
  });
  const btype = await db.businessType.create({ data: { code: 'PRIVATE', nameAr: 'خاص', nameEn: 'Private' } });

  async function employer(approved: boolean, tag: string) {
    const user = await db.user.create({
      data: { email: `${tag}@e.example`, role: 'EMPLOYER', status: 'ACTIVE' },
    });
    const row = await db.employer.create({
      data: {
        ...EMPLOYER,
        email: `${tag}-${EMPLOYER.email}`,
        userId: user.id,
        sectorId: it.id,
        businessTypeId: btype.id,
        approvalStatus: approved ? 'APPROVED' : 'PENDING',
        user: { locale: 'en' },
      },
    });
    return { user, row };
  }

  async function seeker(tag: string, completed = true) {
    const user = await db.user.create({
      data: { email: `${tag}@s.example`, role: 'SEEKER', status: 'ACTIVE' },
    });
    const person = await db.person.create({
      data: {
        userId: user.id,
        firstName: 'Khaled',
        fatherName: 'Salem',
        grandfatherName: 'Ali',
        familyName: tag,
        idType: 'NATIONAL_ID',
        idNumberEncrypted: 'ENCRYPTED-ID',
        idNumberHash: `hash-${tag}`,
        gender: 'MALE',
        birthDate: new Date('1995-05-20T00:00:00Z'),
        nationalityId: sa.id,
        hasSpecialNeeds: false,
        darId: 'DAR-SECRET',
        fakhdhId: 'FAKHDH-SECRET',
        mobile: '+966501234567',
        email: `${tag}@contact.example`,
      },
    });
    const profile = await db.seekerProfile.create({
      data: {
        userId: user.id,
        personId: person.id,
        hasExperience: true,
        yearsOfExperience: 5,
        completedAt: completed ? new Date() : null,
      },
    });
    await db.seekerEducation.create({
      data: {
        seekerId: profile.id,
        educationLevelId: bachelor.id,
        institution: 'KSU',
        countryId: sa.id,
        graduationYear: 2017,
      },
    });
    await db.experiencePosition.create({
      data: {
        seekerId: profile.id,
        title: 'Data Analyst',
        sectorId: it.id,
        startDate: new Date('2020-01-01'),
        endDate: null,
      },
    });
    return { user, profile, person };
  }

  const jobInput = (over: Record<string, unknown> = {}) => ({
    title: 'Data Analyst',
    description: 'Analyse data and build dashboards for the business.',
    sectorId: it.id,
    city: 'Riyadh',
    countryId: sa.id,
    requiredEducationLevelId: bachelor.id,
    minYearsExperience: 3,
    employmentType: 'FULL_TIME' as const,
    ...over,
  });

  return { prisma, db, employers, seekers, events, email, audit, employer, seeker, jobInput, it, fin, sa };
}

describe('Seeker job DTO privacy', () => {
  it('the seeker select and the view contain no employer field', () => {
    expect(Object.keys(SEEKER_JOB_SELECT)).not.toContain('employerId');
    expect(Object.keys(SEEKER_JOB_SELECT).some((k) => /employer|org|phone|email|business/i.test(k))).toBe(
      false,
    );
  });

  it('copies only whitelisted fields even from a row that carries employer data', () => {
    const row = {
      id: 'j1',
      title: 'Analyst',
      description: 'd',
      sectorId: 's',
      city: 'Riyadh',
      countryId: 'c',
      requiredEducationLevelId: null,
      minYearsExperience: 0,
      employmentType: 'FULL_TIME' as const,
      status: 'OPEN' as const,
      publishedAt: new Date(),
      employerId: 'EMPLOYER-ID',
      employer: { ...EMPLOYER, businessTypeId: 'BT' },
    };
    const match = {
      score: 50,
      label: 'NEAR' as const,
      breakdown: {
        sector: 40,
        education: 0,
        experience: 0,
        keywords: 10,
        sectorMatch: true,
        educationMet: false,
        experienceMet: false,
        keywordShare: 1,
        extra: 'x',
      },
    };
    const view = new SeekerJobView(row, match as any, null);
    const json = JSON.stringify(view);
    expect(Object.keys(view).sort()).toEqual(SEEKER_JOB_KEYS);
    for (const secret of [...Object.values(EMPLOYER), 'EMPLOYER-ID', 'employer', 'BT', 'extra']) {
      expect(json).not.toContain(secret);
    }
  });

  it('list, detail, interest and my-requests responses never contain employer data', async () => {
    const c = await setup();
    const e = await c.employer(true, 'e1');
    const s = await c.seeker('s1');
    const job = await c.employers.createJob(e.user.id, c.jobInput());
    const responses = [
      await c.seekers.list(s.user.id, {}),
      await c.seekers.detail(s.user.id, job.id),
      await c.seekers.expressInterest(s.user.id, job.id, { consent: true }),
      await c.seekers.myInterests(s.user.id),
    ];
    const json = JSON.stringify(responses);
    for (const secret of [...Object.values(EMPLOYER), e.row.id, e.user.id, e.row.email, 'employerId']) {
      expect(json).not.toContain(secret);
    }
  });
});

describe('Employer approval and own jobs', () => {
  it('an unapproved employer cannot post a job (server-side)', async () => {
    const c = await setup();
    const e = await c.employer(false, 'pending');
    expect(await code(c.employers.createJob(e.user.id, c.jobInput()))).toBe('EMPLOYER_NOT_APPROVED');
    expect(c.db.job.rows).toHaveLength(0);
  });

  it('an approved employer posts a job and matching is queued', async () => {
    const c = await setup();
    const e = await c.employer(true, 'ok');
    const job = await c.employers.createJob(e.user.id, c.jobInput());
    expect(job.status).toBe('OPEN');
    expect(c.events.jobChanged).toHaveBeenCalledWith(job.id);
  });

  it('rejects unknown lookups', async () => {
    const c = await setup();
    const e = await c.employer(true, 'ok');
    expect(
      await code(
        c.employers.createJob(e.user.id, c.jobInput({ sectorId: '00000000-0000-0000-0000-000000000000' })),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('an edit keeps a sector deactivated since, but a new job needs an active one', async () => {
    const c = await setup();
    const e = await c.employer(true, 'ok');
    const job = await c.employers.createJob(e.user.id, c.jobInput());
    c.db.sector.rows.find((s: any) => s.id === c.it.id).isActive = false;
    expect(
      await code(c.employers.updateJob(e.user.id, job.id, c.jobInput({ title: 'Senior analyst' }))),
    ).toBe('OK');
    expect(await code(c.employers.createJob(e.user.id, c.jobInput()))).toBe('VALIDATION_FAILED');
  });

  it("cannot read, edit, close or list applicants of another employer's job", async () => {
    const c = await setup();
    const a = await c.employer(true, 'a');
    const b = await c.employer(true, 'b');
    const job = await c.employers.createJob(a.user.id, c.jobInput());
    expect(await code(c.employers.getJob(b.user.id, job.id))).toBe('JOB_NOT_FOUND');
    expect(await code(c.employers.updateJob(b.user.id, job.id, c.jobInput({ title: 'X' })))).toBe(
      'JOB_NOT_FOUND',
    );
    expect(await code(c.employers.closeJob(b.user.id, job.id, { outcome: 'CLOSED_WITHOUT_HIRING' }))).toBe(
      'JOB_NOT_FOUND',
    );
    expect(await code(c.employers.applicants(b.user.id, job.id))).toBe('JOB_NOT_FOUND');
  });
});

describe('Interest requests and applicant access', () => {
  it('needs consent, a completed profile and an open job; one request per job', async () => {
    const c = await setup();
    const e = await c.employer(true, 'e');
    const job = await c.employers.createJob(e.user.id, c.jobInput());
    const incomplete = await c.seeker('inc', false);
    const s = await c.seeker('ok');
    expect(await code(c.seekers.expressInterest(s.user.id, job.id, { consent: false }))).toBe(
      'INTEREST_CONSENT_REQUIRED',
    );
    expect(await code(c.seekers.expressInterest(incomplete.user.id, job.id, { consent: true }))).toBe(
      'PROFILE_INCOMPLETE',
    );
    const res = await c.seekers.expressInterest(s.user.id, job.id, { consent: true });
    expect(res.interest?.status).toBe('SUBMITTED');
    expect(c.db.interestRequest.rows[0].consentAt).toBeInstanceOf(Date);
    expect(await code(c.seekers.expressInterest(s.user.id, job.id, { consent: true }))).toBe(
      'INTEREST_EXISTS',
    );
  });

  it("emails the employer in the employer's language without the seeker's ID, dar or fakhdh", async () => {
    const c = await setup();
    const e = await c.employer(true, 'e');
    const job = await c.employers.createJob(e.user.id, c.jobInput());
    const s = await c.seeker('ok');
    await c.seekers.expressInterest(s.user.id, job.id, { consent: true });
    expect(c.email.enqueue).toHaveBeenCalledTimes(1);
    const sent = c.email.enqueue.mock.calls[0][0];
    expect(sent).toMatchObject({ template: 'newInterest', to: e.row.email, locale: 'en' });
    expect(sent.vars.link).toContain(`/en/employer/jobs/${job.id}/applicants`);
    const json = JSON.stringify(sent);
    for (const secret of ['ENCRYPTED-ID', 'hash-ok', 'DAR-SECRET', 'FAKHDH-SECRET', s.person.id]) {
      expect(json).not.toContain(secret);
    }
  });

  it('the employer sees only applicants of their own jobs, without ID, dar or fakhdh', async () => {
    const c = await setup();
    const a = await c.employer(true, 'a');
    const b = await c.employer(true, 'b');
    const jobA = await c.employers.createJob(a.user.id, c.jobInput());
    const jobB = await c.employers.createJob(b.user.id, c.jobInput({ title: 'Accountant' }));
    const applied = await c.seeker('applied');
    const other = await c.seeker('other');
    await c.seekers.expressInterest(applied.user.id, jobA.id, { consent: true });
    await c.seekers.expressInterest(other.user.id, jobB.id, { consent: true });
    const interestA = c.db.interestRequest.rows.find((r: any) => r.jobId === jobA.id);
    const interestB = c.db.interestRequest.rows.find((r: any) => r.jobId === jobB.id);

    const profile = await c.employers.applicant(a.user.id, interestA.id);
    expect(profile.fullName).toBe('Khaled Salem Ali applied');
    expect(profile.mobile).toBe('+966501234567');
    const json = JSON.stringify(profile);
    for (const secret of [
      'ENCRYPTED-ID',
      'hash-applied',
      'DAR-SECRET',
      'FAKHDH-SECRET',
      'idNumber',
      'darId',
      'fakhdhId',
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(c.db.interestRequest.rows.find((r: any) => r.id === interestA.id).status).toBe('VIEWED');
    expect(c.audit.record).toHaveBeenCalledWith(
      'VIEW_SENSITIVE',
      'seeker_profiles',
      applied.profile.id,
      expect.anything(),
    );

    // Someone who expressed interest in ANOTHER employer's job is out of reach.
    expect(await code(c.employers.applicant(a.user.id, interestB.id))).toBe('APPLICANT_NOT_FOUND');
    expect(await code(c.employers.applicantCvLink(a.user.id, interestB.id))).toBe('APPLICANT_NOT_FOUND');
    // A random id (e.g. a seeker profile id) is not an interest request either.
    expect(await code(c.employers.applicant(a.user.id, other.profile.id))).toBe('APPLICANT_NOT_FOUND');
  });

  it('issues a 5-minute CV link only for an applicant who has a CV', async () => {
    const c = await setup();
    const e = await c.employer(true, 'e');
    const job = await c.employers.createJob(e.user.id, c.jobInput());
    const s = await c.seeker('cv');
    await c.seekers.expressInterest(s.user.id, job.id, { consent: true });
    const interest = c.db.interestRequest.rows[0];
    expect(await code(c.employers.applicantCvLink(e.user.id, interest.id))).toBe('CV_NOT_FOUND');
    const file = await c.db.uploadedFile.create({ data: { ownerUserId: s.user.id, originalName: 'cv.pdf' } });
    s.profile.currentCvFileId = file.id;
    const link = await c.employers.applicantCvLink(e.user.id, interest.id);
    expect(link.url).toMatch(/^\/api\/files\//);
    expect(new Date(link.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(300_000);
  });
});

describe('Closing a job', () => {
  it('hired via platform marks the applicant hired; the job becomes unavailable to everyone else', async () => {
    const c = await setup();
    const e = await c.employer(true, 'e');
    const job = await c.employers.createJob(e.user.id, c.jobInput());
    const s = await c.seeker('hired');
    const late = await c.seeker('late');
    await c.seekers.expressInterest(s.user.id, job.id, { consent: true });
    const interest = c.db.interestRequest.rows[0];

    expect(
      await code(
        c.employers.closeJob(e.user.id, job.id, {
          outcome: 'HIRED_VIA_PLATFORM',
          hiredInterestId: late.profile.id,
        }),
      ),
    ).toBe('HIRED_APPLICANT_INVALID');
    const closed = await c.employers.closeJob(e.user.id, job.id, {
      outcome: 'HIRED_VIA_PLATFORM',
      hiredInterestId: interest.id,
    });
    expect(closed).toMatchObject({ status: 'UNAVAILABLE', closedOutcome: 'HIRED_VIA_PLATFORM' });
    expect(interest.status).toBe('HIRED');

    const dash = await c.employers.dashboard(e.user.id);
    expect(dash.stats).toEqual({ openJobs: 0, interestRequests: 1, hiredViaPlatform: 1 });

    // closed: no new requests, hidden from others, "no longer available" for the applicant
    expect(await code(c.seekers.expressInterest(late.user.id, job.id, { consent: true }))).toBe('JOB_CLOSED');
    expect(await code(c.seekers.detail(late.user.id, job.id))).toBe('JOB_NOT_AVAILABLE');
    expect((await c.seekers.list(late.user.id, {})).items).toHaveLength(0);
    const mine = await c.seekers.myInterests(s.user.id);
    expect(mine[0]).toMatchObject({ jobAvailable: false, status: 'HIRED' });
    expect(await code(c.employers.closeJob(e.user.id, job.id, { outcome: 'CLOSED_WITHOUT_HIRING' }))).toBe(
      'JOB_CLOSED',
    );
    expect(await code(c.employers.updateJob(e.user.id, job.id, c.jobInput()))).toBe('JOB_CLOSED');
  });
});

describe('Seeker job list ranking', () => {
  it('sorts by score and filters suitable / near only', async () => {
    const c = await setup();
    const e = await c.employer(true, 'e');
    const fit = await c.employers.createJob(e.user.id, c.jobInput());
    const poor = await c.employers.createJob(
      e.user.id,
      c.jobInput({ title: 'Senior Accountant', sectorId: c.fin.id, minYearsExperience: 15 }),
    );
    const s = await c.seeker('rank');
    const all = await c.seekers.list(s.user.id, {});
    expect(all.items.map((j) => j.id)).toEqual([fit.id, poor.id]);
    expect(all.items[0].match).toMatchObject({ score: 100, label: 'SUITABLE' });
    expect(all.items[1].match.label).toBe('NONE');
    expect(all.thresholds).toEqual({ suitable: 70, near: 45 });
    const fitOnly = await c.seekers.list(s.user.id, { fit: true });
    expect(fitOnly.items.map((j) => j.id)).toEqual([fit.id]);
  });
});
