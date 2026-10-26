import { JwtService } from '@nestjs/jwt';
import ExcelJS from 'exceljs';
import { PassThrough, Readable } from 'node:stream';
import { AccountService } from '../auth/account.service';
import { OtpService } from '../auth/otp.service';
import { PasswordService } from '../auth/password.service';
import { PermissionsService } from '../auth/permissions.service';
import { TokenService } from '../auth/token.service';
import { AppException } from '../common/app-exception';
import { AuthUser } from '../common/decorators';
import { CryptoService } from '../crypto/crypto.service';
import { renderEmail } from '../notifications/email-templates';
import { createFakePrisma, testConfig } from '../testing/fake-prisma';
import { AdminAuditService } from './admin-audit.service';
import { AdminLookupsService } from './admin-lookups.service';
import { checkMatchingSettings } from './admin-settings.service';
import { AdminUsersService, temporaryPassword } from './admin-users.service';
import { AdminExportController } from './admin.controllers';
import { ExportService } from './export/export.service';
import { writeWorkbook } from './export/workbook';

async function failure(
  p: Promise<unknown> | (() => unknown),
): Promise<{ code: string; status: number; details?: unknown }> {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    if (e instanceof AppException) {
      return { code: e.code, status: e.getStatus(), details: (e.getResponse() as any).details };
    }
    throw e;
  }
  return { code: 'OK', status: 200 };
}
const code = async (p: Promise<unknown> | (() => unknown)) => (await failure(p)).code;

const PASSWORD = 'Admin-Pass-2026';

async function setup() {
  const config = testConfig();
  const prisma = createFakePrisma();
  const db = prisma.db as any;
  const crypto = new CryptoService(config);
  const passwords = new PasswordService();
  const tokens = new TokenService(config, new JwtService({}), prisma as any, crypto);
  const permissions = new PermissionsService(prisma as any);
  const email = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const otp = new OtpService(prisma as any, crypto);

  const lookups = new AdminLookupsService(prisma as any);
  const users = new AdminUsersService(
    prisma as any,
    audit as any,
    permissions,
    passwords,
    tokens,
    crypto,
    email as any,
    config,
  );
  const auditLog = new AdminAuditService(prisma as any);
  const exports = new ExportService(prisma as any, audit as any, crypto, users, auditLog);
  const exportController = new AdminExportController(users, tokens, exports);
  const account = new AccountService(prisma as any, passwords, otp, email as any);

  // Role permissions as seeded: admins have users.manage and data.export, not admins.manage.
  for (const p of ['users.manage', 'data.export', 'audit.read']) {
    await db.rolePermission.create({ data: { role: 'ADMIN', permission: { code: p } } });
  }
  await db.permission.create({ data: { code: 'admins.manage' } });

  const hash = await passwords.hash(PASSWORD);
  const mk = (data: Record<string, unknown>) =>
    db.user.create({ data: { status: 'ACTIVE', emailVerifiedAt: new Date(), passwordHash: hash, ...data } });
  const system = await mk({
    email: 'admin@sanad.local',
    username: 'admin',
    role: 'SUPER_ADMIN',
    isSystemAccount: true,
  });
  const superAdmin = await mk({ email: 'super@sanad.local', role: 'SUPER_ADMIN', displayName: 'Super Two' });
  const admin = await mk({ email: 'ops@sanad.local', role: 'ADMIN', displayName: 'Ops Admin' });
  const seekerUser = await mk({ email: 'seeker@s.example', role: 'SEEKER' });
  const employerUser = await mk({ email: 'boss@e.example', role: 'EMPLOYER' });
  const as = (u: { id: string; role: string }): AuthUser => ({
    id: u.id,
    role: u.role as any,
    mustChangePassword: false,
  });

  const sa = await db.country.create({
    data: { isoCode: 'SA', nameAr: 'السعودية', nameEn: 'Saudi Arabia', sortOrder: 1 },
  });
  const it = await db.sector.create({
    data: { code: 'IT', nameAr: 'تقنية المعلومات', nameEn: 'IT', sortOrder: 1 },
  });
  const bt = await db.businessType.create({
    data: { code: 'PRIVATE', nameAr: 'خاص', nameEn: 'Private', sortOrder: 1 },
  });
  const bachelor = await db.educationLevel.create({
    data: { code: 'BACHELOR', nameAr: 'بكالوريوس', nameEn: "Bachelor's", rank: 40, sortOrder: 1 },
  });
  const dar = await db.dar.create({
    data: { code: 'DAR_A', nameAr: 'دار أ', nameEn: 'Dar A', sortOrder: 1 },
  });

  const id = crypto.protectIdNumber('NATIONAL_ID', '1012345678');
  const person = await db.person.create({
    data: {
      userId: seekerUser.id,
      firstName: 'خالد',
      fatherName: 'سالم',
      grandfatherName: 'علي',
      familyName: 'الحربي',
      idType: 'NATIONAL_ID',
      ...id,
      gender: 'MALE',
      birthDate: new Date('1995-05-20T00:00:00Z'),
      nationalityId: sa.id,
      hasSpecialNeeds: false,
      darId: dar.id,
      mobile: '+966501234567',
      email: 'khaled@contact.example',
    },
  });
  const profile = await db.seekerProfile.create({
    data: { userId: seekerUser.id, personId: person.id, hasExperience: true, yearsOfExperience: 5 },
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
      organization: 'Acme',
      sectorId: it.id,
      startDate: new Date('2020-01-01'),
    },
  });
  // A second seeker whose passport number starts with zeros.
  const seeker2 = await mk({ email: 'second@s.example', role: 'SEEKER' });
  const pid = crypto.protectIdNumber('PASSPORT', '00A12345');
  const person2 = await db.person.create({
    data: {
      userId: seeker2.id,
      firstName: 'Sara',
      fatherName: 'Omar',
      grandfatherName: 'Ali',
      familyName: 'Zahrani',
      idType: 'PASSPORT',
      ...pid,
      gender: 'FEMALE',
      birthDate: new Date('1999-01-02T00:00:00Z'),
      nationalityId: sa.id,
      hasSpecialNeeds: true,
    },
  });
  await db.seekerProfile.create({ data: { userId: seeker2.id, personId: person2.id } });

  const employer = await db.employer.create({
    data: {
      userId: employerUser.id,
      contactName: 'Fahad Contact',
      organizationName: 'Madar Co',
      sectorId: it.id,
      businessTypeId: bt.id,
      email: 'hr@madar.example',
      phone: '+966512345678',
      approvalStatus: 'APPROVED',
    },
  });
  const job = await db.job.create({
    data: {
      employerId: employer.id,
      title: 'Backend Developer',
      description: 'x',
      sectorId: it.id,
      city: 'Riyadh',
      countryId: sa.id,
      status: 'UNAVAILABLE',
      closedOutcome: 'HIRED_VIA_PLATFORM',
      hiredSeekerId: profile.id,
      closedAt: new Date('2026-03-01T09:00:00Z'),
    },
  });
  await db.interestRequest.create({
    data: { jobId: job.id, seekerId: profile.id, status: 'HIRED', consentAt: new Date() },
  });
  await db.auditLog.create({
    data: {
      actorUserId: admin.id,
      actorRole: 'ADMIN',
      action: 'UPDATE',
      entity: 'users',
      entityId: seekerUser.id,
      before: { passwordHash: '[REDACTED]' },
      after: { passwordHash: '[REDACTED]' },
      createdAt: new Date('2026-05-10T10:00:00Z'),
    },
  });

  return {
    config,
    prisma,
    db,
    crypto,
    tokens,
    email,
    audit,
    lookups,
    users,
    auditLog,
    exports,
    exportController,
    account,
    system,
    superAdmin,
    admin,
    seekerUser,
    seeker2,
    employerUser,
    as,
    sa,
    it,
    dar,
    bachelor,
  };
}

/** Collects a stream into one buffer. */
async function collect(stream: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of stream) parts.push(Buffer.from(c));
  return Buffer.concat(parts);
}

async function workbook(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  return wb;
}

function headerOf(ws: ExcelJS.Worksheet): string[] {
  return (ws.getRow(1).values as unknown[]).slice(1).map(String);
}

/** Data rows as objects keyed by header text. */
function rowsOf(ws: ExcelJS.Worksheet): Record<string, ExcelJS.CellValue>[] {
  const h = headerOf(ws);
  const out: Record<string, ExcelJS.CellValue>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    out.push(Object.fromEntries(h.map((k, i) => [k, row.getCell(i + 1).value])));
  });
  return out;
}

// ---------------------------------------------------------------------------

describe('S-19 lookups', () => {
  it('lists every item (inactive too), sorted', async () => {
    const c = await setup();
    await c.db.sector.create({
      data: { code: 'OLD', nameAr: 'قديم', nameEn: 'Old', isActive: false, sortOrder: 0 },
    });
    const list = await c.lookups.list('sectors');
    expect(list.map((x) => x.code)).toEqual(['OLD', 'IT']);
    expect(list[0].isActive).toBe(false);
    expect(await code(c.lookups.list('nope'))).toBe('LOOKUP_TYPE_UNKNOWN');
  });

  it('adds items with unique codes, and countries need an ISO code', async () => {
    const c = await setup();
    const d = await c.lookups.create('dars', { code: 'DAR_B', nameAr: 'دار ب', nameEn: 'Dar B' });
    expect(d).toMatchObject({ code: 'DAR_B', isActive: true, sortOrder: 0 });
    const dup = await failure(c.lookups.create('dars', { code: 'DAR_B', nameAr: 'x', nameEn: 'y' }));
    expect(dup).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(dup.details).toEqual([{ field: 'code', errors: ['LOOKUP_CODE_TAKEN'] }]);
    // a deleted row still holds its code (the unique index covers it)
    c.db.dar.rows.find((r: any) => r.code === 'DAR_A').deletedAt = new Date();
    expect(
      (await failure(c.lookups.create('dars', { code: 'DAR_A', nameAr: 'x', nameEn: 'y' }))).details,
    ).toEqual([{ field: 'code', errors: ['LOOKUP_CODE_TAKEN'] }]);

    expect(
      (await failure(c.lookups.create('countries', { code: 'KSA', nameAr: 'x', nameEn: 'y' }))).details,
    ).toEqual([{ field: 'code', errors: ['matches'] }]);
    const ae = await c.lookups.create('countries', { code: 'AE', nameAr: 'الإمارات', nameEn: 'UAE' });
    expect(ae.code).toBe('AE');
    expect(c.db.country.rows.find((r: any) => r.id === ae.id).isoCode).toBe('AE');
  });

  it('education levels need a unique rank; fakhdhs link to an existing dar', async () => {
    const c = await setup();
    expect(
      (await failure(c.lookups.create('education-levels', { code: 'MASTER', nameAr: 'م', nameEn: 'M' })))
        .details,
    ).toEqual([{ field: 'rank', errors: ['isInt'] }]);
    expect(
      (
        await failure(
          c.lookups.create('education-levels', { code: 'MASTER', nameAr: 'م', nameEn: 'M', rank: 40 }),
        )
      ).details,
    ).toEqual([{ field: 'rank', errors: ['LOOKUP_RANK_TAKEN'] }]);
    const m = await c.lookups.create('education-levels', {
      code: 'MASTER',
      nameAr: 'م',
      nameEn: 'M',
      rank: 50,
    });
    expect(m.rank).toBe(50);

    const bad = await failure(
      c.lookups.create('fakhdhs', {
        code: 'F1',
        nameAr: 'ف',
        nameEn: 'F',
        darId: '00000000-0000-4000-8000-000000000000',
      }),
    );
    expect(bad.details).toEqual([{ field: 'darId', errors: ['LOOKUP_INVALID'] }]);
    const f = await c.lookups.create('fakhdhs', { code: 'F1', nameAr: 'ف', nameEn: 'F', darId: c.dar.id });
    expect(f.darId).toBe(c.dar.id);
    const loose = await c.lookups.create('fakhdhs', { code: 'F2', nameAr: 'ف٢', nameEn: 'F2' });
    expect(loose.darId).toBeNull();
  });

  it('edits and deactivates (never deletes); unchanged code on itself is fine', async () => {
    const c = await setup();
    const off = await c.lookups.update('sectors', c.it.id, {
      isActive: false,
      code: 'IT',
      nameEn: 'Information tech',
    });
    expect(off).toMatchObject({ isActive: false, nameEn: 'Information tech', code: 'IT' });
    expect(c.db.sector.rows).toHaveLength(1);
    expect(
      await code(c.lookups.update('sectors', '00000000-0000-4000-8000-000000000000', { isActive: true })),
    ).toBe('LOOKUP_NOT_FOUND');
  });
});

describe('S-20 accounts and the system account', () => {
  it('lists with search, role and status filters; the system account first', async () => {
    const c = await setup();
    const all = await c.users.list({});
    expect(all.items[0]).toMatchObject({ username: 'admin', isSystemAccount: true });
    expect(all.total).toBe(6);
    expect((await c.users.list({ role: 'SEEKER' })).items.map((u) => u.email).sort()).toEqual([
      'second@s.example',
      'seeker@s.example',
    ]);
    expect((await c.users.list({ q: 'OPS@' })).items.map((u) => u.name)).toEqual(['Ops Admin']);
    const row = (await c.users.list({ role: 'SEEKER', q: 'seeker@' })).items[0];
    expect(row.name).toBe('خالد سالم علي الحربي');
  });

  it('refuses suspend / delete / role change on the system account before the database', async () => {
    const c = await setup();
    const actor = c.as(c.superAdmin);
    for (const p of [
      c.users.suspend(actor, c.system.id),
      c.users.remove(actor, c.system.id),
      c.users.changeRole(actor, c.system.id, 'ADMIN'),
      c.users.reactivate(actor, c.system.id),
    ]) {
      expect(await failure(p)).toMatchObject({ code: 'SYSTEM_ACCOUNT_PROTECTED', status: 403 });
    }
    expect(c.db.user.rows.find((u: any) => u.id === c.system.id)).toMatchObject({
      status: 'ACTIVE',
      role: 'SUPER_ADMIN',
    });
  });

  it('no self-targeting, and only SUPER_ADMIN acts on admin accounts', async () => {
    const c = await setup();
    expect(await code(c.users.suspend(c.as(c.admin), c.admin.id))).toBe('CANNOT_TARGET_SELF');
    expect(await failure(c.users.suspend(c.as(c.admin), c.superAdmin.id))).toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    });
    expect(await code(c.users.changeRole(c.as(c.superAdmin), c.admin.id, 'SUPER_ADMIN'))).toBe('OK');
    expect(await code(c.users.changeRole(c.as(c.superAdmin), c.seekerUser.id, 'ADMIN'))).toBe('NOT_AN_ADMIN');
  });

  it('suspends (sessions end, audited SUSPEND) and reactivates', async () => {
    const c = await setup();
    await c.db.refreshToken.create({ data: { userId: c.seekerUser.id, tokenHash: 'h', familyId: 'f' } });
    const row = await c.users.suspend(c.as(c.admin), c.seekerUser.id);
    expect(row.status).toBe('SUSPENDED');
    expect(c.db.refreshToken.rows[0].revokedAt).toBeInstanceOf(Date);
    expect(c.audit.record).toHaveBeenCalledWith('SUSPEND', 'users', c.seekerUser.id, { status: 'SUSPENDED' });
    expect((await c.users.reactivate(c.as(c.admin), c.seekerUser.id)).status).toBe('ACTIVE');
    expect(c.audit.record).toHaveBeenCalledWith('STATUS_CHANGE', 'users', c.seekerUser.id, {
      status: 'ACTIVE',
    });
    await c.users.remove(c.as(c.admin), c.seekerUser.id);
    expect(await c.db.user.findFirst({ where: { id: c.seekerUser.id } })).toBeNull();
  });

  it("changes another account's email with the acting admin's password; the system account's email too", async () => {
    const c = await setup();
    const actor = c.as(c.superAdmin);
    expect(
      await failure(
        c.users.changeEmail(actor, c.system.id, { email: 'root@sanad.local', currentPassword: 'wrong-1' }),
      ),
    ).toMatchObject({ code: 'AUTH_WRONG_PASSWORD', status: 403 });
    expect(
      await code(
        c.users.changeEmail(actor, c.system.id, { email: 'ops@sanad.local', currentPassword: PASSWORD }),
      ),
    ).toBe('AUTH_EMAIL_TAKEN');
    expect(
      await code(
        c.users.changeEmail(actor, c.system.id, { email: 'admin@sanad.local', currentPassword: PASSWORD }),
      ),
    ).toBe('EMAIL_UNCHANGED');
    const row = await c.users.changeEmail(actor, c.system.id, {
      email: 'root@sanad.local',
      currentPassword: PASSWORD,
    });
    expect(row.email).toBe('root@sanad.local');
    expect(c.email.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'emailChanged',
        to: 'admin@sanad.local',
        vars: { newEmail: 'root@sanad.local' },
      }),
    );
    // An ADMIN cannot touch the system account (it is an admin account).
    expect(
      await code(
        c.users.changeEmail(c.as(c.admin), c.system.id, {
          email: 'x@sanad.local',
          currentPassword: PASSWORD,
        }),
      ),
    ).toBe('PERMISSION_DENIED');
  });

  it('creates an admin with a temporary password sent by email and a forced change', async () => {
    const c = await setup();
    const row = await c.users.createAdmin({
      email: 'new@sanad.local',
      username: 'newadmin',
      name: 'New Admin',
      role: 'ADMIN',
    });
    expect(row).toMatchObject({ role: 'ADMIN', status: 'ACTIVE', name: 'New Admin' });
    const u = c.db.user.rows.find((x: any) => x.id === row.id);
    expect(u).toMatchObject({ mustChangePassword: true, displayName: 'New Admin', username: 'newadmin' });
    const job = c.email.enqueue.mock.calls.at(-1)[0];
    expect(job).toMatchObject({ template: 'adminInvite', to: 'new@sanad.local' });
    expect(job.vars.login).toBe('newadmin');
    expect(await new PasswordService().verify(u.passwordHash, job.vars.password)).toBe(true);
    expect(job.vars.link).toMatch(/\/ar\/login$/);
    const mail = renderEmail(job);
    expect(mail.text).toContain(job.vars.password);
    expect(mail.html).not.toContain('<p style="font-size:14px;color:#56615C;margin:0"></p>');

    expect(await code(c.users.createAdmin({ email: 'ops@sanad.local', name: 'x', role: 'ADMIN' }))).toBe(
      'AUTH_EMAIL_TAKEN',
    );
    expect(
      (
        await failure(
          c.users.createAdmin({ email: 'b@sanad.local', username: 'admin', name: 'x', role: 'ADMIN' }),
        )
      ).details,
    ).toEqual([{ field: 'username', errors: ['USERNAME_TAKEN'] }]);
  });

  it('temporary passwords meet the policy', () => {
    for (let i = 0; i < 50; i++) {
      const p = temporaryPassword();
      expect(p).toHaveLength(14);
      expect(p).toMatch(/[A-Za-z]/);
      expect(p).toMatch(/\d/);
    }
  });

  it('reveals a seeker ID number, audited as VIEW_SENSITIVE', async () => {
    const c = await setup();
    expect(await c.users.revealId(c.seekerUser.id)).toEqual({
      idType: 'NATIONAL_ID',
      idNumber: '1012345678',
    });
    expect(c.audit.record).toHaveBeenCalledWith('VIEW_SENSITIVE', 'persons', expect.any(String), {
      field: 'idNumber',
      userId: c.seekerUser.id,
    });
    expect(await code(c.users.revealId(c.employerUser.id))).toBe('PROFILE_NOT_FOUND');
  });

  it('edits an employer, keeping a lookup value that was deactivated since', async () => {
    const c = await setup();
    c.db.sector.rows[0].isActive = false;
    const d = await c.users.updateEmployer(c.employerUser.id, {
      contactName: 'New Contact',
      organizationName: 'Madar Group',
      sectorId: c.it.id,
      businessTypeId: c.db.businessType.rows[0].id,
      email: 'jobs@madar.example',
      phone: '0551234567',
    });
    expect(d.employer).toMatchObject({ organizationName: 'Madar Group', phone: '+966551234567' });
    const other = await c.db.sector.create({
      data: { code: 'OFF', nameAr: 'x', nameEn: 'x', isActive: false },
    });
    expect(
      (
        await failure(
          c.users.updateEmployer(c.employerUser.id, {
            contactName: 'a',
            organizationName: 'b',
            sectorId: other.id,
            businessTypeId: c.db.businessType.rows[0].id,
            email: 'a@b.example',
            phone: 'abc',
          }),
        )
      ).details,
    ).toEqual([
      { field: 'phone', errors: ['PHONE_FORMAT'] },
      { field: 'sectorId', errors: ['LOOKUP_INVALID'] },
    ]);
  });
});

describe('my account: email change', () => {
  it('needs the password, sends a code to the new address, then switches', async () => {
    const c = await setup();
    const me = c.system.id;
    expect(
      await code(
        c.account.requestEmailChange(me, { email: 'root@sanad.local', currentPassword: 'nope-1234' }),
      ),
    ).toBe('AUTH_WRONG_PASSWORD');
    expect(
      await code(c.account.requestEmailChange(me, { email: 'admin@sanad.local', currentPassword: PASSWORD })),
    ).toBe('EMAIL_UNCHANGED');
    expect(
      await code(c.account.requestEmailChange(me, { email: 'ops@sanad.local', currentPassword: PASSWORD })),
    ).toBe('AUTH_EMAIL_TAKEN');
    expect(await code(c.account.confirmEmailChange(me, { code: '123456' }))).toBe('EMAIL_CHANGE_NOT_PENDING');

    await c.account.requestEmailChange(me, { email: 'root@sanad.local', currentPassword: PASSWORD });
    const job = c.email.enqueue.mock.calls.at(-1)[0];
    expect(job).toMatchObject({ template: 'emailChangeCode', to: 'root@sanad.local' });
    expect((await c.account.get(me)).pendingEmail).toBe('root@sanad.local');
    expect(
      await code(
        c.account.confirmEmailChange(me, { code: job.vars.code === '000000' ? '111111' : '000000' }),
      ),
    ).toBe('AUTH_CODE_INVALID');
    const after = await c.account.confirmEmailChange(me, { code: job.vars.code });
    expect(after).toMatchObject({ email: 'root@sanad.local', pendingEmail: null, isSystemAccount: true });
    expect(c.email.enqueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ template: 'emailChanged', to: 'admin@sanad.local' }),
    );
  });
});

describe('matching settings', () => {
  it('weights must add up to 100 and near < suitable', () => {
    expect(
      checkMatchingSettings({
        weights: { sector: 30, education: 25, experience: 25, keywords: 20 },
        thresholds: { suitable: 70, near: 50 },
      }),
    ).toEqual([]);
    expect(
      checkMatchingSettings({
        weights: { sector: 30, education: 25, experience: 25, keywords: 10 },
        thresholds: { suitable: 50, near: 50 },
      }),
    ).toEqual([
      { field: 'weights', errors: ['WEIGHTS_SUM'] },
      { field: 'thresholds.near', errors: ['THRESHOLD_ORDER'] },
    ]);
  });
});

describe('S-21 audit viewer', () => {
  it('filters by user, action, table and inclusive dates', async () => {
    const c = await setup();
    const page = await c.auditLog.page({
      user: 'ops@',
      action: 'UPDATE',
      entity: 'users',
      from: '2026-05-10',
      to: '2026-05-10',
    });
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      actorLabel: 'ops@sanad.local',
      after: { passwordHash: '[REDACTED]' },
    });
    expect(page.entities).toEqual(['users']);
    expect((await c.auditLog.page({ to: '2026-05-09' })).total).toBe(0);
    expect((await c.auditLog.page({ user: 'nobody' })).total).toBe(0);
  });
});

describe('Excel export', () => {
  async function exportBuffer(
    c: Awaited<ReturnType<typeof setup>>,
    kind: 'full' | 'users' | 'audit',
    locale: 'ar' | 'en',
    extra = {},
  ) {
    const actor = c.as(c.admin);
    const { token } = await c.exportController.token(actor, { password: PASSWORD });
    const res = { setHeader: jest.fn() };
    const file = await c.exportController.export(actor, kind, { token, locale, ...extra }, res as any);
    return { buf: await collect(file.getStream()), res, file };
  }

  it('needs an admin role, the password, and a valid export token of the same user', async () => {
    const c = await setup();
    const res = { setHeader: jest.fn() };
    expect(
      await failure(c.exportController.token(c.as(c.employerUser), { password: PASSWORD })),
    ).toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    });
    expect(await failure(c.exportController.token(c.as(c.seekerUser), { password: PASSWORD }))).toMatchObject(
      {
        status: 403,
      },
    );
    expect(
      await failure(c.exportController.token(c.as(c.admin), { password: 'wrong-pass-1' })),
    ).toMatchObject({
      code: 'AUTH_WRONG_PASSWORD',
      status: 403,
    });
    const access = c.tokens.signAccess(c.admin.id, 'ADMIN');
    expect(await code(c.exportController.export(c.as(c.admin), 'full', { token: access }, res as any))).toBe(
      'EXPORT_TOKEN_INVALID',
    );
    const other = c.tokens.signExport(c.superAdmin.id).token;
    expect(await code(c.exportController.export(c.as(c.admin), 'full', { token: other }, res as any))).toBe(
      'EXPORT_TOKEN_INVALID',
    );
    const mine = c.tokens.signExport(c.admin.id).token;
    expect(await code(c.exportController.export(c.as(c.admin), 'nope', { token: mine }, res as any))).toBe(
      'NOT_FOUND',
    );
    // An export token is never an access token.
    expect(await code(() => c.tokens.verifyAccess(mine))).toBe('AUTH_TOKEN_INVALID');
    expect(c.audit.record).not.toHaveBeenCalledWith(
      'EXPORT',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('full export (Arabic): seven RTL sheets, decrypted IDs and leading zeros as text, real dates', async () => {
    const c = await setup();
    const { buf, file } = await exportBuffer(c, 'full', 'ar');
    expect(file.getHeaders().disposition).toMatch(
      /attachment; filename="sanad-full-\d{4}-\d{2}-\d{2}\.xlsx"/,
    );
    expect(c.audit.record).toHaveBeenCalledWith(
      'EXPORT',
      'export',
      null,
      expect.objectContaining({
        kind: 'full',
        locale: 'ar',
        sheets: ['seekers', 'employers', 'jobs', 'interests', 'hires', 'users', 'audit'],
      }),
    );

    const wb = await workbook(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'الباحثون',
      'أصحاب العمل',
      'الفرص',
      'طلبات الاهتمام',
      'التوظيف',
      'المستخدمون',
      'سجل التدقيق',
    ]);
    for (const ws of wb.worksheets) {
      expect(ws.views[0]).toMatchObject({ rightToLeft: true, state: 'frozen', ySplit: 1 });
      expect(ws.getRow(1).font?.bold).toBe(true);
      expect(ws.autoFilter).toBeTruthy();
    }

    const seekers = wb.getWorksheet('الباحثون')!;
    expect(headerOf(seekers).slice(0, 6)).toEqual([
      'الاسم الأول',
      'اسم الأب',
      'اسم الجد',
      'اسم العائلة',
      'نوع الهوية',
      'رقم الهوية',
    ]);
    const [khaled, sara] = rowsOf(seekers);
    expect(khaled['رقم الهوية']).toBe('1012345678');
    expect(khaled['الجوال']).toBe('0501234567');
    expect(khaled['الدار']).toBe('دار أ');
    expect(khaled['المستوى التعليمي']).toBe('بكالوريوس');
    expect(khaled['سنوات الخبرة']).toBe(5);
    expect(String(khaled['المناصب'])).toContain(
      'Data Analyst (Acme، تقنية المعلومات): 2020-01-01 → حتى الآن',
    );
    expect(khaled['تاريخ الميلاد']).toBeInstanceOf(Date);
    expect((khaled['تاريخ الميلاد'] as Date).toISOString().slice(0, 10)).toBe('1995-05-20');
    expect(sara['رقم الهوية']).toBe('00A12345');
    expect(sara['نوع الهوية']).toBe('جواز سفر');
    expect(sara['احتياجات خاصة']).toBe('نعم');
    // text columns are stored as text (numFmt "@")
    const idCol = headerOf(seekers).indexOf('رقم الهوية') + 1;
    expect(seekers.getRow(2).getCell(idCol).numFmt).toBe('@');
    expect(seekers.getRow(2).getCell(idCol).type).toBe(ExcelJS.ValueType.String);

    const employers = rowsOf(wb.getWorksheet('أصحاب العمل')!);
    expect(employers[0]).toMatchObject({
      المؤسسة: 'Madar Co',
      'تصنيف قطاع الأعمال': 'خاص',
      'حالة الاعتماد': 'معتمد',
      'رقم التواصل': '0512345678',
    });
    const jobs = rowsOf(wb.getWorksheet('الفرص')!);
    expect(jobs[0]).toMatchObject({ المسمى: 'Backend Developer', المؤسسة: 'Madar Co', 'عدد المهتمين': 1 });
    const hires = rowsOf(wb.getWorksheet('التوظيف')!);
    expect(hires[0]).toMatchObject({ 'اسم الباحث': 'خالد سالم علي الحربي', الجوال: '0501234567' });
    // Saudi wall-clock time: 09:00 UTC is written as 12:00
    expect((hires[0]['تاريخ التوظيف'] as Date).toISOString()).toBe('2026-03-01T12:00:00.000Z');
    expect(rowsOf(wb.getWorksheet('طلبات الاهتمام')!)[0]).toMatchObject({ 'حالة الطلب': 'تم التوظيف' });
    expect(rowsOf(wb.getWorksheet('المستخدمون')!)).toHaveLength(6);
    const audit = rowsOf(wb.getWorksheet('سجل التدقيق')!);
    expect(audit[0]['بعد']).toBe('{"passwordHash":"[REDACTED]"}');
  });

  it('English headers, left-to-right, and per-screen exports use the filters', async () => {
    const c = await setup();
    const users = await workbook((await exportBuffer(c, 'users', 'en', { users: { role: 'SEEKER' } })).buf);
    expect(users.worksheets.map((w) => w.name)).toEqual(['Users']);
    const ws = users.worksheets[0];
    expect(ws.views[0].rightToLeft).toBeFalsy();
    expect(headerOf(ws)).toEqual([
      'Name',
      'Login email',
      'Username',
      'Role',
      'Account status',
      'System account',
      'Email verified on',
      'Last login',
      'Registered on',
    ]);
    expect(rowsOf(ws).map((r) => r['Role'])).toEqual(['Job seeker', 'Job seeker']);
    expect(c.audit.record).toHaveBeenCalledWith(
      'EXPORT',
      'export',
      null,
      expect.objectContaining({ kind: 'users', filters: { users: { role: 'SEEKER' } } }),
    );

    const audit = await workbook((await exportBuffer(c, 'audit', 'en', { audit: { action: 'LOGIN' } })).buf);
    expect(audit.worksheets.map((w) => w.name)).toEqual(['Audit log']);
    expect(rowsOf(audit.worksheets[0])).toHaveLength(0);
  });

  it('the workbook writer streams any sheet spec (extensible for reports)', async () => {
    const out = new PassThrough();
    const done = collect(out);
    const counts = await writeWorkbook(out, 'en', [
      {
        key: 'users',
        columns: [
          { key: 'phone', value: (r: any) => r.phone },
          { key: 'completion', type: 'percent', value: (r: any) => r.p },
        ],
        rows: async function* () {
          yield [{ phone: '0055', p: 50 }];
          yield [{ phone: '012', p: 100 }];
        },
      },
    ]);
    expect(counts).toEqual({ users: 2 });
    const wb = await workbook(await done);
    expect(rowsOf(wb.worksheets[0])).toEqual([
      { Phone: '0055', 'Profile completion': 0.5 },
      { Phone: '012', 'Profile completion': 1 },
    ]);
  });
});
