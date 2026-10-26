import { AppException } from '../common/app-exception';
import { CryptoService } from '../crypto/crypto.service';
import { createFakePrisma, testConfig } from '../testing/fake-prisma';
import { CvService } from './cv.service';
import { FileLinksService } from '../files/file-links.service';
import { ProfileService } from './profile.service';

const TODAY = new Date(Date.UTC(2026, 9, 26));

async function setup(opts: { analysis?: boolean } = {}) {
  const config = testConfig();
  if (opts.analysis) config.cvAnalysis.enabled = true;
  const prisma = createFakePrisma();
  const crypto = new CryptoService(config);
  const events = { changed: jest.fn().mockResolvedValue(undefined) };
  const profiles = new ProfileService(prisma as any, crypto, events as any, config);
  profiles.now = () => TODAY;
  const db = prisma.db as any;
  const user = await db.user.create({ data: { email: 'k@example.com', role: 'SEEKER' } });
  await db.seekerProfile.create({ data: { userId: user.id } });
  const sa = await db.country.create({ data: { isoCode: 'SA', nameAr: 'السعودية', nameEn: 'Saudi Arabia' } });
  const dar = await db.dar.create({ data: { code: 'D1', nameAr: 'د', nameEn: 'D' } });
  const fakhdh = await db.fakhdh.create({ data: { code: 'F1', nameAr: 'ف', nameEn: 'F', darId: dar.id } });
  const level = await db.educationLevel.create({
    data: { code: 'BACHELOR', nameAr: 'ب', nameEn: 'B', rank: 40 },
  });
  const storage = {
    put: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    getBuffer: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const cv = new CvService(
    prisma as any,
    profiles,
    new FileLinksService(crypto),
    crypto,
    storage,
    config,
    queue as any,
  );
  return { prisma, db, crypto, events, profiles, cv, storage, queue, user, sa, dar, fakhdh, level };
}

const personal = (nationalityId: string, idNumber: string | null = '1012345678') => ({
  firstName: 'خالد',
  fatherName: 'سالم',
  grandfatherName: 'محمد',
  familyName: 'العتيبي',
  idType: 'NATIONAL_ID' as const,
  idNumber,
  gender: 'MALE' as const,
  birthDate: '1995-05-20',
  nationalityId,
  hasSpecialNeeds: false,
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppException) {
      const details = e.details as { field: string; errors: string[] }[] | undefined;
      return Array.isArray(details)
        ? `${e.code}:${details.map((d) => `${d.field}=${d.errors}`).join(',')}`
        : e.code;
    }
    throw e;
  }
  return 'OK';
}

describe('ProfileService: personal step and the ID number', () => {
  it('stores the ID encrypted with an HMAC fingerprint, never in clear, and masks it on read', async () => {
    const c = await setup();
    const dto = await c.profiles.updatePersonal(c.user.id, personal(c.sa.id, '١٠١٢ ٣٤٥ ٦٧٨'));
    const person = c.db.person.rows[0];
    expect(JSON.stringify(person)).not.toContain('1012345678');
    expect(c.crypto.decrypt(person.idNumberEncrypted)).toBe('1012345678');
    expect(person.idNumberHash).toBe(c.crypto.hashIdNumber('NATIONAL_ID', '1012345678'));
    expect(dto.personal?.idNumberMasked).toBe('••••••5678');
    expect(dto.completionStep).toBe('TRIBE');
    expect(c.events.changed).toHaveBeenCalledWith(expect.any(String), 'personal');
  });

  it('requires the ID number the first time, then keeps it when omitted', async () => {
    const c = await setup();
    expect(await code(c.profiles.updatePersonal(c.user.id, personal(c.sa.id, null)))).toBe(
      'VALIDATION_FAILED:idNumber=isNotEmpty',
    );
    await c.profiles.updatePersonal(c.user.id, personal(c.sa.id));
    const hash = c.db.person.rows[0].idNumberHash;
    await c.profiles.updatePersonal(c.user.id, { ...personal(c.sa.id, null), firstName: 'خالد ' });
    expect(c.db.person.rows[0].idNumberHash).toBe(hash);
  });

  it('refuses an ID number already used by another person with a clear code', async () => {
    const c = await setup();
    await c.db.person.create({
      data: { userId: 'someone-else', idNumberHash: c.crypto.hashIdNumber('NATIONAL_ID', '1012345678') },
    });
    expect(await code(c.profiles.updatePersonal(c.user.id, personal(c.sa.id)))).toBe(
      'PROFILE_ID_NUMBER_TAKEN',
    );
  });

  it('validates age, ID format and nationality on the server', async () => {
    const c = await setup();
    const bad = {
      ...personal('00000000-0000-0000-0000-000000000000', '3012345678'),
      birthDate: '2016-01-01',
    };
    expect(await code(c.profiles.updatePersonal(c.user.id, bad))).toBe(
      'VALIDATION_FAILED:birthDate=AGE_RANGE,idNumber=NATIONAL_ID_FORMAT,nationalityId=LOOKUP_INVALID',
    );
  });

  it('later steps need the personal step first', async () => {
    const c = await setup();
    expect(
      await code(c.profiles.updateContact(c.user.id, { mobile: '0512345678', email: 'k@example.com' })),
    ).toBe('PROFILE_PERSONAL_REQUIRED');
  });
});

describe('ProfileService: affiliation, contact, education', () => {
  it('checks dar/fakhdh consistency and normalises the Saudi mobile', async () => {
    const c = await setup();
    await c.profiles.updatePersonal(c.user.id, personal(c.sa.id));
    const other = await c.db.dar.create({ data: { code: 'D2' } });
    expect(
      await code(c.profiles.updateAffiliation(c.user.id, { darId: other.id, fakhdhId: c.fakhdh.id })),
    ).toBe('VALIDATION_FAILED:fakhdhId=FAKHDH_DAR_MISMATCH');
    expect(await code(c.profiles.updateAffiliation(c.user.id, {}))).toBe(
      'VALIDATION_FAILED:darId=isNotEmpty',
    );
    await c.profiles.updateAffiliation(c.user.id, { darId: c.dar.id, fakhdhId: c.fakhdh.id });
    expect(await code(c.profiles.updateContact(c.user.id, { mobile: '0412345678', email: 'a@b.co' }))).toBe(
      'VALIDATION_FAILED:mobile=SAUDI_MOBILE',
    );
    const dto = await c.profiles.updateContact(c.user.id, { mobile: '+966 55 123 4567', email: 'a@b.co' });
    expect(dto.contact.mobile).toBe('+966551234567');
    expect(dto.completionStep).toBe('EDUCATION');
  });

  it('upserts one education row and rejects a graduation year before age 10', async () => {
    const c = await setup();
    await c.profiles.updatePersonal(c.user.id, personal(c.sa.id));
    const edu = {
      educationLevelId: c.level.id,
      graduationYear: 2018,
      institution: 'KSU',
      countryId: c.sa.id,
    };
    await c.profiles.updateEducation(c.user.id, edu);
    await c.profiles.updateEducation(c.user.id, { ...edu, graduationYear: 2019 });
    expect(c.db.seekerEducation.rows).toHaveLength(1);
    expect(c.db.seekerEducation.rows[0].graduationYear).toBe(2019);
    expect(await code(c.profiles.updateEducation(c.user.id, { ...edu, graduationYear: 2001 }))).toBe(
      'VALIDATION_FAILED:graduationYear=GRADUATION_YEAR_RANGE',
    );
  });
});

describe('ProfileService: experience and positions (unlimited)', () => {
  const pos = (title: string, startDate: string, endDate: string | null = null) => ({
    title,
    startDate,
    endDate,
  });

  it('saves the whole step: many positions in order, "present" as null, and the verifier', async () => {
    const c = await setup();
    await c.profiles.updatePersonal(c.user.id, personal(c.sa.id));
    const list = Array.from({ length: 12 }, (_, i) => pos(`P${i}`, `20${10 + i}-01`, `20${10 + i}-12`));
    list[0] = pos('Current', '2024-03', null);
    const dto = await c.profiles.updateExperience(c.user.id, {
      hasExperience: true,
      yearsOfExperience: 12,
      positions: list,
      verifier: { name: 'Ahmed', phone: '0501112222' },
    });
    expect(dto.experience.positions.map((p) => p.title)).toEqual(list.map((p) => p.title));
    expect(dto.experience.positions[0]).toMatchObject({
      startDate: '2024-03-01',
      endDate: null,
      sortOrder: 0,
    });
    expect(dto.experience.verifier).toMatchObject({ name: 'Ahmed', phone: '+966501112222' });
    expect(dto.steps.experience).toBe(true);
  });

  it('syncs the list: keeps ids, deletes missing ones (soft), creates new ones, reorders', async () => {
    const c = await setup();
    await c.profiles.updatePersonal(c.user.id, personal(c.sa.id));
    const first = await c.profiles.updateExperience(c.user.id, {
      hasExperience: true,
      yearsOfExperience: 5,
      positions: [pos('A', '2022-05'), pos('B', '2019-01', '2022-04'), pos('C', '2018-06', '2018-12')],
    });
    const [a, b, cc] = first.experience.positions;
    const second = await c.profiles.updateExperience(c.user.id, {
      hasExperience: true,
      yearsOfExperience: 5,
      positions: [{ ...cc, title: 'C2' }, a, pos('D', '2017-01', '2017-06')],
    });
    expect(second.experience.positions.map((p) => p.title)).toEqual(['C2', 'A', 'D']);
    expect(second.experience.positions[0].id).toBe(cc.id);
    const deleted = c.db.experiencePosition.rows.find((r: any) => r.id === b.id);
    expect(deleted.deletedAt).toBeInstanceOf(Date);
  });

  it('per-position endpoints: create, update, delete, reorder; dates are validated', async () => {
    const c = await setup();
    await c.profiles.updatePersonal(c.user.id, personal(c.sa.id));
    const p1 = await c.profiles.createPosition(c.user.id, pos('One', '2020-01', '2021-01'));
    const p2 = await c.profiles.createPosition(c.user.id, pos('Two', '2021-02'));
    const p3 = await c.profiles.createPosition(c.user.id, pos('Three', '2015-01', '2016-01'));
    expect([p1.sortOrder, p2.sortOrder, p3.sortOrder]).toEqual([0, 1, 2]);
    expect(c.db.seekerProfile.rows[0].hasExperience).toBe(true);

    const updated = await c.profiles.updatePosition(
      c.user.id,
      p2.id,
      pos('Two (lead)', '2021-02', '2023-06'),
    );
    expect(updated).toMatchObject({ title: 'Two (lead)', endDate: '2023-06-01' });
    expect(await code(c.profiles.updatePosition(c.user.id, p2.id, pos('X', '2021-02', '2020-01')))).toBe(
      'VALIDATION_FAILED:endDate=DATE_ORDER',
    );

    const reordered = await c.profiles.reorderPositions(c.user.id, [p3.id, p1.id, p2.id]);
    expect(reordered.map((p) => p.title)).toEqual(['Three', 'One', 'Two (lead)']);
    expect(await code(c.profiles.reorderPositions(c.user.id, [p1.id, p2.id]))).toBe(
      'POSITIONS_ORDER_MISMATCH',
    );

    await c.profiles.deletePosition(c.user.id, p1.id);
    expect((await c.profiles.listPositions(c.user.id)).map((p) => p.title)).toEqual(['Three', 'Two (lead)']);
    expect(await code(c.profiles.deletePosition(c.user.id, p1.id))).toBe('POSITION_NOT_FOUND');
  });

  it('cannot touch another seeker’s position', async () => {
    const c = await setup();
    await c.profiles.updatePersonal(c.user.id, personal(c.sa.id));
    const foreign = await c.db.experiencePosition.create({ data: { seekerId: 'other', title: 'x' } });
    expect(await code(c.profiles.updatePosition(c.user.id, foreign.id, pos('y', '2020-01')))).toBe(
      'POSITION_NOT_FOUND',
    );
    expect(await code(c.profiles.deletePosition(c.user.id, foreign.id))).toBe('POSITION_NOT_FOUND');
  });

  it('"no experience" clears years, positions and verifier', async () => {
    const c = await setup();
    await c.profiles.updatePersonal(c.user.id, personal(c.sa.id));
    await c.profiles.updateExperience(c.user.id, {
      hasExperience: true,
      yearsOfExperience: 2,
      positions: [pos('A', '2022-05')],
      verifier: { name: 'V', email: 'v@x.co' },
    });
    const dto = await c.profiles.updateExperience(c.user.id, { hasExperience: false, yearsOfExperience: 7 });
    expect(dto.experience).toEqual({
      hasExperience: false,
      yearsOfExperience: null,
      positions: [],
      verifier: null,
    });
    expect(await code(c.profiles.createPosition(c.user.id, pos('B', '2022-05')))).toBe('CONFLICT');
  });

  it('completes the experience step without a verifier (optional, owner decision)', async () => {
    const c = await setup();
    await c.profiles.updatePersonal(c.user.id, personal(c.sa.id));
    const dto = await c.profiles.updateExperience(c.user.id, {
      hasExperience: true,
      yearsOfExperience: 2,
      positions: [pos('Analyst', '2023-01')],
    });
    expect(dto.experience.verifier).toBeNull();
    expect(dto.steps.experience).toBe(true);
  });

  it('a verifier that is given still needs a phone or an email', async () => {
    const c = await setup();
    await c.profiles.updatePersonal(c.user.id, personal(c.sa.id));
    expect(
      await code(
        c.profiles.updateExperience(c.user.id, {
          hasExperience: true,
          yearsOfExperience: 1,
          verifier: { name: 'V' },
        }),
      ),
    ).toBe('VALIDATION_FAILED:verifier.phone=CONTACT_REQUIRED');
  });
});

describe('ProfileService: finishing', () => {
  it('refuses to complete with missing steps and completes once they are done', async () => {
    const c = await setup();
    await c.profiles.updatePersonal(c.user.id, personal(c.sa.id));
    expect(await code(c.profiles.complete(c.user.id))).toBe('PROFILE_INCOMPLETE');
    await c.profiles.updateAffiliation(c.user.id, { darId: c.dar.id, fakhdhId: c.fakhdh.id });
    await c.profiles.updateContact(c.user.id, { mobile: '0512345678', email: 'a@b.co' });
    await c.profiles.updateEducation(c.user.id, {
      educationLevelId: c.level.id,
      graduationYear: 2018,
      institution: 'KSU',
      countryId: c.sa.id,
    });
    const before = await c.profiles.updateExperience(c.user.id, { hasExperience: false });
    expect(before.completionStep).toBe('CV');
    const done = await c.profiles.complete(c.user.id);
    expect(done.completionStep).toBe('COMPLETED');
    expect(done.completedAt).toBe(TODAY.toISOString());
  });
});

describe('CvService', () => {
  const pdf = Buffer.from('%PDF-1.4\nhello\n%%EOF');

  it('rejects missing, oversized and wrong-type files', async () => {
    const c = await setup();
    expect(await code(c.cv.upload(c.user.id, undefined))).toBe('FILE_REQUIRED');
    expect(
      await code(c.cv.upload(c.user.id, { originalname: 'a.pdf', buffer: pdf, size: 11 * 1024 * 1024 })),
    ).toBe('FILE_TOO_LARGE');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
    expect(await code(c.cv.upload(c.user.id, { originalname: 'a.pdf', buffer: png, size: png.length }))).toBe(
      'FILE_TYPE_NOT_ALLOWED',
    );
    expect(c.storage.put).not.toHaveBeenCalled();
  });

  it('uploads to private storage, keeps previous versions, analysis SKIPPED when disabled', async () => {
    const c = await setup();
    await c.cv.upload(c.user.id, { originalname: 'cv1.pdf', buffer: pdf, size: pdf.length });
    const dto = await c.cv.upload(c.user.id, { originalname: 'cv2.pdf', buffer: pdf, size: pdf.length });
    expect(c.storage.put).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^cv/${c.user.id}/[0-9a-f-]+\\.pdf$`)),
      pdf,
      'application/pdf',
    );
    expect(dto.cv.file?.originalName).toBe('cv2.pdf');
    expect(dto.cv.previousVersions).toBe(1);
    expect(dto.cv.analysis?.status).toBe('SKIPPED');
    expect(c.queue.add).not.toHaveBeenCalled();
    expect(c.events.changed).toHaveBeenCalledWith(expect.any(String), 'cv');

    const link = await c.cv.link(c.user.id);
    expect(link.url).toMatch(/^\/api\/files\//);
    const removed = await c.cv.remove(c.user.id);
    expect(removed.cv.file).toBeNull();
    expect(c.db.uploadedFile.rows.filter((r: any) => r.deletedAt).length).toBe(1);
  });

  it('queues a cv-analysis job when analysis is enabled; sector correction needs a finished analysis', async () => {
    const c = await setup({ analysis: true });
    const dto = await c.cv.upload(c.user.id, { originalname: 'cv.pdf', buffer: pdf, size: pdf.length });
    expect(dto.cv.analysis?.status).toBe('PENDING');
    expect(c.queue.add).toHaveBeenCalledWith(
      'analyze',
      { analysisId: dto.cv.analysis!.id },
      expect.objectContaining({ attempts: 3, jobId: `cv-${dto.cv.analysis!.id}` }),
    );
    expect(await code(c.cv.correctSector(c.user.id, null))).toBe('CV_ANALYSIS_NOT_READY');
    const sector = await c.db.sector.create({ data: { code: 'IT' } });
    c.db.cvAnalysis.rows[0].status = 'COMPLETED';
    c.db.cvAnalysis.rows[0].suggestedSectorId = 'x';
    const fixed = await c.cv.correctSector(c.user.id, sector.id);
    expect(fixed).toMatchObject({
      correctedSectorId: sector.id,
      sectorId: sector.id,
      suggestedSectorId: 'x',
    });
  });

  it('removes the stored object when the database write fails', async () => {
    const c = await setup();
    c.db.uploadedFile.create = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(
      c.cv.upload(c.user.id, { originalname: 'cv.pdf', buffer: pdf, size: pdf.length }),
    ).rejects.toThrow('db down');
    expect(c.storage.remove).toHaveBeenCalledWith(c.storage.put.mock.calls[0][0]);
  });
});
