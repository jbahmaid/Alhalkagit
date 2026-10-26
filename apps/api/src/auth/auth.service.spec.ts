import { JwtService } from '@nestjs/jwt';
import { AppException } from '../common/app-exception';
import { CryptoService } from '../crypto/crypto.service';
import { createFakePrisma, testConfig } from '../testing/fake-prisma';
import { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { PermissionsService } from './permissions.service';
import { REFRESH_RACE_GRACE_MS, TokenService } from './token.service';

const meta = { ip: '10.0.0.1', userAgent: 'jest' };

function setup() {
  const config = testConfig();
  const prisma = createFakePrisma();
  const crypto = new CryptoService(config);
  const passwords = new PasswordService();
  const tokens = new TokenService(config, new JwtService({}), prisma as any, crypto);
  const permissions = new PermissionsService(prisma as any);
  const email = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const audit = new AuditService(prisma as any, { isActive: () => false } as any);
  const otp = new OtpService(prisma as any, crypto);
  const auth = new AuthService(
    config,
    prisma as any,
    passwords,
    otp,
    tokens,
    permissions,
    email as any,
    audit,
  );
  const lastCode = () => email.enqueue.mock.calls.at(-1)![0].vars.code as string;
  const actions = () => prisma.audits.map((a) => a.action);
  return { config, prisma, auth, tokens, email, lastCode, actions, passwords };
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(AppException);
  await p.catch((e: AppException) => expect(e.code).toBe(code));
}

const SIGNUP = {
  email: 'seeker@example.com',
  password: 'Passw0rd!',
  consentShare: true,
  consentTerms: true,
} as const;

async function activeSeeker(ctx: ReturnType<typeof setup>) {
  await ctx.auth.signupSeeker({ ...SIGNUP });
  return ctx.auth.verifyEmail(SIGNUP.email, ctx.lastCode(), meta);
}

describe('AuthService: seeker sign-up and email verification', () => {
  it('creates a pending seeker with consent and emails a 6-digit code', async () => {
    const ctx = setup();
    const res = await ctx.auth.signupSeeker({ ...SIGNUP, locale: 'en' });
    expect(res).toEqual({ email: SIGNUP.email, resendAvailableIn: 60 });
    const user = ctx.prisma.db.user.rows[0];
    expect(user).toMatchObject({ role: 'SEEKER', status: 'PENDING_VERIFICATION', locale: 'en' });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(ctx.prisma.db.seekerProfile.rows[0]).toMatchObject({ userId: user.id });
    expect(ctx.prisma.db.seekerProfile.rows[0].shareConsentAt).toBeInstanceOf(Date);
    expect(ctx.email.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'verifyEmail', to: SIGNUP.email, locale: 'en' }),
    );
    expect(ctx.lastCode()).toMatch(/^\d{6}$/);
    // the code itself is never stored
    expect(JSON.stringify(ctx.prisma.db.emailVerificationCode.rows)).not.toContain(ctx.lastCode());
  });

  it('refuses an email that already belongs to an active account', async () => {
    const ctx = setup();
    await activeSeeker(ctx);
    await expectCode(ctx.auth.signupSeeker({ ...SIGNUP }), 'AUTH_EMAIL_TAKEN');
  });

  it('enforces the resend cooldown', async () => {
    const ctx = setup();
    await ctx.auth.signupSeeker({ ...SIGNUP });
    await expectCode(ctx.auth.resendVerification(SIGNUP.email), 'AUTH_RESEND_COOLDOWN');
  });

  it('counts wrong codes, then activates with the right one and logs the user in', async () => {
    const ctx = setup();
    await ctx.auth.signupSeeker({ ...SIGNUP });
    const code = ctx.lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    await expectCode(ctx.auth.verifyEmail(SIGNUP.email, wrong, meta), 'AUTH_CODE_INVALID');
    expect(ctx.prisma.db.emailVerificationCode.rows[0].attempts).toBe(1);

    const issued = await ctx.auth.verifyEmail(SIGNUP.email, code, meta);
    expect(issued.session.user).toMatchObject({
      role: 'SEEKER',
      status: 'ACTIVE',
      mustChangePassword: false,
    });
    expect(issued.session.accessToken).toBeTruthy();
    expect(issued.refreshToken).toBeTruthy();
    expect(ctx.actions()).toEqual(expect.arrayContaining(['EMAIL_VERIFIED', 'LOGIN']));
    await expectCode(ctx.auth.verifyEmail(SIGNUP.email, code, meta), 'AUTH_ALREADY_VERIFIED');
  });

  it('rejects expired codes and locks the code after too many attempts', async () => {
    const ctx = setup();
    await ctx.auth.signupSeeker({ ...SIGNUP });
    const rec = ctx.prisma.db.emailVerificationCode.rows[0];
    rec.expiresAt = new Date(Date.now() - 1000);
    await expectCode(ctx.auth.verifyEmail(SIGNUP.email, ctx.lastCode(), meta), 'AUTH_CODE_EXPIRED');
    rec.expiresAt = new Date(Date.now() + 60_000);
    rec.attempts = 5;
    await expectCode(ctx.auth.verifyEmail(SIGNUP.email, ctx.lastCode(), meta), 'AUTH_CODE_TOO_MANY_ATTEMPTS');
  });
});

describe('AuthService: employer sign-up', () => {
  async function withLookups(ctx: ReturnType<typeof setup>) {
    const sector = await ctx.prisma.db.sector.create({ data: { code: 'IT', nameAr: 'تقنية', nameEn: 'IT' } });
    const bt = await ctx.prisma.db.businessType.create({
      data: { code: 'PRIVATE', nameAr: 'خاص', nameEn: 'Private' },
    });
    return {
      contactName: 'سارة',
      organizationName: 'شركة الأفق',
      sectorId: sector.id as string,
      businessTypeId: bt.id as string,
      email: 'hr@example.com',
      phone: '0551234567',
      password: 'Passw0rd!',
      consentTerms: true as const,
    };
  }

  it('creates a pending employer with its organization and emails a code', async () => {
    const ctx = setup();
    const dto = await withLookups(ctx);
    await ctx.auth.signupEmployer({ ...dto, locale: 'en' });
    const user = ctx.prisma.db.user.rows[0];
    expect(user).toMatchObject({ role: 'EMPLOYER', status: 'PENDING_VERIFICATION', locale: 'en' });
    expect(ctx.prisma.db.employer.rows[0]).toMatchObject({
      userId: user.id,
      organizationName: 'شركة الأفق',
      phone: '+966551234567',
    });
    expect(ctx.prisma.db.employer.rows[0].approvalStatus ?? 'PENDING').toBe('PENDING');
    expect(ctx.email.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'verifyEmail', locale: 'en' }),
    );
  });

  it('rejects unknown lookups and a bad phone with field errors', async () => {
    const ctx = setup();
    const dto = await withLookups(ctx);
    const p = ctx.auth.signupEmployer({
      ...dto,
      phone: '12',
      businessTypeId: '00000000-0000-4000-8000-000000000000',
    });
    await expectCode(p, 'VALIDATION_FAILED');
    expect(ctx.prisma.db.user.rows).toHaveLength(0);
  });

  it('refuses an email that belongs to a seeker', async () => {
    const ctx = setup();
    await activeSeeker(ctx);
    const dto = await withLookups(ctx);
    await expectCode(ctx.auth.signupEmployer({ ...dto, email: SIGNUP.email }), 'AUTH_EMAIL_TAKEN');
  });
});

describe('AuthService: login and lockout', () => {
  it('logs in with email or with username', async () => {
    const ctx = setup();
    await activeSeeker(ctx);
    ctx.prisma.db.user.rows[0].username = 'khaled';
    const byEmail = await ctx.auth.login({ identifier: SIGNUP.email, password: SIGNUP.password }, meta);
    expect(byEmail.session.user.email).toBe(SIGNUP.email);
    const byName = await ctx.auth.login({ identifier: 'khaled', password: SIGNUP.password }, meta);
    expect(byName.session.user.id).toBe(byEmail.session.user.id);
    expect(ctx.actions().filter((a) => a === 'LOGIN').length).toBeGreaterThanOrEqual(3);
  });

  it('records failed logins, locks after 5 and refuses while locked', async () => {
    const ctx = setup();
    await activeSeeker(ctx);
    for (let i = 0; i < 5; i++) {
      await expectCode(
        ctx.auth.login({ identifier: SIGNUP.email, password: 'Wrong1234' }, meta),
        'AUTH_INVALID_CREDENTIALS',
      );
    }
    const user = ctx.prisma.db.user.rows[0];
    expect(user.lockedUntil.getTime()).toBeGreaterThan(Date.now());
    await expectCode(
      ctx.auth.login({ identifier: SIGNUP.email, password: SIGNUP.password }, meta),
      'AUTH_ACCOUNT_LOCKED',
    );
    expect(ctx.actions().filter((a) => a === 'LOGIN_FAILED')).toHaveLength(6);
    // a failed attempt has no actor; the targeted account is the entity
    const failed = ctx.prisma.audits.find((a) => a.action === 'LOGIN_FAILED')!;
    expect(failed.entityId).toBe(user.id);
    expect((failed.actor as any).userId).toBeNull();
  });

  it('answers unknown accounts like wrong passwords and audits them without an actor', async () => {
    const ctx = setup();
    await expectCode(
      ctx.auth.login({ identifier: 'nobody@example.com', password: 'x' }, meta),
      'AUTH_INVALID_CREDENTIALS',
    );
    expect(ctx.prisma.audits[0]).toMatchObject({ action: 'LOGIN_FAILED', entityId: null });
    expect((ctx.prisma.audits[0].actor as any).userId).toBeNull();
  });

  it('routes pending accounts to verification and refuses suspended ones', async () => {
    const ctx = setup();
    await ctx.auth.signupSeeker({ ...SIGNUP });
    await expectCode(
      ctx.auth.login({ identifier: SIGNUP.email, password: SIGNUP.password }, meta),
      'AUTH_EMAIL_NOT_VERIFIED',
    );
    ctx.prisma.db.user.rows[0].status = 'SUSPENDED';
    await expectCode(
      ctx.auth.login({ identifier: SIGNUP.email, password: SIGNUP.password }, meta),
      'AUTH_ACCOUNT_SUSPENDED',
    );
  });
});

describe('AuthService: refresh token rotation', () => {
  it('rotates within the same family and revokes the old token', async () => {
    const ctx = setup();
    const first = await activeSeeker(ctx);
    const out = await ctx.auth.refresh(first.refreshToken, meta);
    expect(out.result.authenticated).toBe(true);
    const issued = (out as any).issued;
    expect(issued.refreshToken).not.toBe(first.refreshToken);
    const [old, next] = ctx.prisma.db.refreshToken.rows;
    expect(old).toMatchObject({ revokeReason: 'ROTATED', replacedById: next.id, familyId: next.familyId });
    expect(next.revokedAt).toBeNull();
    expect(old.tokenHash).not.toContain(first.refreshToken);
  });

  it('accepts a just-rotated token within the grace period (lost cookie, parallel tabs)', async () => {
    const ctx = setup();
    const first = await activeSeeker(ctx);
    const a = await ctx.auth.refresh(first.refreshToken, meta);
    // The response with the new cookie never arrived: the browser sends the old one again.
    const b = await ctx.auth.refresh(first.refreshToken, meta);
    expect(b.result.authenticated).toBe(true);
    const rows = ctx.prisma.db.refreshToken.rows;
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.familyId)).size).toBe(1);
    // Both new tokens are valid: either tab can go on with the cookie it got.
    expect(rows.filter((r) => !r.revokedAt)).toHaveLength(2);
    expect((await ctx.auth.refresh((a as any).issued.refreshToken, meta)).result.authenticated).toBe(true);
    expect((await ctx.auth.refresh((b as any).issued.refreshToken, meta)).result.authenticated).toBe(true);
    // The old record keeps its rotation time: the grace period does not extend.
    expect(rows[0].revokeReason).toBe('ROTATED');
  });

  it('reuse after the grace period is theft: the whole family is revoked', async () => {
    const ctx = setup();
    const first = await activeSeeker(ctx);
    await ctx.auth.refresh(first.refreshToken, meta);
    ctx.prisma.db.refreshToken.rows[0].revokedAt = new Date(Date.now() - REFRESH_RACE_GRACE_MS - 1000);
    const reuse = await ctx.auth.refresh(first.refreshToken, meta);
    expect(reuse.result).toEqual({ authenticated: false, code: 'AUTH_REFRESH_REUSED' });
    expect(ctx.prisma.db.refreshToken.rows.every((r) => r.revokedAt)).toBe(true);
  });

  it('the grace period never revives a session that has ended (logout after rotation)', async () => {
    const ctx = setup();
    const first = await activeSeeker(ctx);
    const a = await ctx.auth.refresh(first.refreshToken, meta);
    await ctx.auth.logout((a as any).issued.refreshToken, meta);
    const again = await ctx.auth.refresh(first.refreshToken, meta);
    expect(again.result).toEqual({ authenticated: false, code: 'AUTH_REFRESH_INVALID' });
    expect(ctx.prisma.db.refreshToken.rows).toHaveLength(2);
  });

  it('logout revokes the session and is audited', async () => {
    const ctx = setup();
    const s = await activeSeeker(ctx);
    await ctx.auth.logout(s.refreshToken, meta);
    expect(ctx.prisma.db.refreshToken.rows[0].revokeReason).toBe('LOGOUT');
    expect(ctx.actions()).toContain('LOGOUT');
    const after = await ctx.auth.refresh(s.refreshToken, meta);
    expect(after.result.authenticated).toBe(false);
  });

  it('returns unauthenticated (not an error) without a cookie', async () => {
    const ctx = setup();
    expect((await ctx.auth.refresh(undefined, meta)).result).toEqual({
      authenticated: false,
      code: 'AUTH_REFRESH_INVALID',
    });
  });
});

describe('AuthService: passwords', () => {
  it('forced change: clears mustChangePassword, needs the current password, starts a new session', async () => {
    const ctx = setup();
    await activeSeeker(ctx);
    const user = ctx.prisma.db.user.rows[0];
    user.mustChangePassword = true;
    await expectCode(
      ctx.auth.changePassword(user.id, { currentPassword: 'Nope12345', newPassword: 'NewPassw0rd' }, meta),
      'AUTH_WRONG_PASSWORD',
    );
    await expectCode(
      ctx.auth.changePassword(
        user.id,
        { currentPassword: SIGNUP.password, newPassword: SIGNUP.password },
        meta,
      ),
      'AUTH_PASSWORD_REUSED',
    );
    const issued = await ctx.auth.changePassword(
      user.id,
      { currentPassword: SIGNUP.password, newPassword: 'NewPassw0rd' },
      meta,
    );
    expect(issued.session.user.mustChangePassword).toBe(false);
    expect(ctx.prisma.db.refreshToken.rows.filter((r) => !r.revokedAt)).toHaveLength(1);
    expect(ctx.prisma.audits.at(-1)).toBeDefined();
    expect(ctx.actions()).toContain('PASSWORD_RESET');
    await ctx.auth.login({ identifier: SIGNUP.email, password: 'NewPassw0rd' }, meta);
  });

  it('forgot + reset with an emailed code', async () => {
    const ctx = setup();
    await activeSeeker(ctx);
    await ctx.auth.forgotPassword('unknown@example.com'); // silent
    await ctx.auth.forgotPassword(SIGNUP.email);
    const call = ctx.email.enqueue.mock.calls.at(-1)![0];
    expect(call.template).toBe('passwordReset');
    await ctx.auth.resetPassword(
      { email: SIGNUP.email, code: call.vars.code, newPassword: 'Reset1234' },
      meta,
    );
    await expect(
      ctx.auth.login({ identifier: SIGNUP.email, password: 'Reset1234' }, meta),
    ).resolves.toBeDefined();
    expect(
      ctx.prisma.db.refreshToken.rows.filter((r) => r.revokeReason === 'PASSWORD_RESET').length,
    ).toBeGreaterThan(0);
  });
});
