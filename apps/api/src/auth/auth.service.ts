import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditAction, User, UserRole, UserStatus, VerificationPurpose } from '@prisma/client';
import {
  FieldErrorDetail,
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_FAILED_ATTEMPTS,
  MeDto,
  normalizePhone,
  OTP_RESEND_COOLDOWN_SECONDS,
  PendingVerificationDto,
  RefreshResultDto,
  SessionDto,
} from '@sanad/shared';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { AuditService } from '../audit/audit.service';
import { AppException, Errors } from '../common/app-exception';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { EmailQueueService } from '../notifications/email-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ChangePasswordDto,
  LoginDto,
  ResetPasswordDto,
  SignupEmployerDto,
  SignupSeekerDto,
} from './dto/auth.dto';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { PermissionsService } from './permissions.service';
import { REFRESH_RACE_GRACE_MS, TokenService } from './token.service';

export interface ClientMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/** A session plus the refresh token the controller puts in the HttpOnly cookie. */
export interface IssuedSession {
  session: SessionDto;
  refreshToken: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly permissions: PermissionsService,
    private readonly email: EmailQueueService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Seeker sign-up and email verification (FR-2.1.1)
  // ---------------------------------------------------------------------------

  async signupSeeker(dto: SignupSeekerDto): Promise<PendingVerificationDto> {
    const locale = dto.locale ?? 'ar';
    const passwordHash = await this.passwords.hash(dto.password);
    const existing = await this.prisma.db.user.findFirst({
      where: { email: dto.email, deletedAt: undefined },
    });

    if (existing) {
      // Signing up again before verifying (lost code, typo in password): refresh the pending account.
      if (
        existing.status !== UserStatus.PENDING_VERIFICATION ||
        existing.role !== UserRole.SEEKER ||
        existing.deletedAt
      ) {
        throw Errors.conflict('AUTH_EMAIL_TAKEN');
      }
      await this.prisma.runAs({ userId: existing.id, role: existing.role }, async () => {
        await this.prisma.tx(async (tx) => {
          await tx.user.update({ where: { id: existing.id }, data: { passwordHash, locale } });
          await tx.seekerProfile.updateMany({
            where: { userId: existing.id },
            data: { shareConsentAt: new Date() },
          });
        });
      });
      return this.sendVerificationCode({ ...existing, locale }, { ignoreCooldown: true });
    }

    // Rows created during sign-up are attributed to the new user in the audit log.
    const userId = randomUUID();
    const user = await this.prisma.runAs({ userId, role: UserRole.SEEKER }, () =>
      this.prisma.tx(async (tx) => {
        const created = await tx.user.create({
          data: {
            id: userId,
            email: dto.email,
            passwordHash,
            role: UserRole.SEEKER,
            status: UserStatus.PENDING_VERIFICATION,
            locale,
          },
        });
        await tx.seekerProfile.create({ data: { userId, shareConsentAt: new Date() } });
        return created;
      }),
    );
    return this.sendVerificationCode(user, { ignoreCooldown: true });
  }

  /**
   * Employer sign-up (S-10, FR-2.2.1): user (EMPLOYER, pending verification) plus the employer
   * row in PENDING approval. Verification uses the same code flow as seekers; posting jobs
   * waits for an admin's approval (enforced in EmployersService).
   */
  async signupEmployer(dto: SignupEmployerDto): Promise<PendingVerificationDto> {
    const errors: FieldErrorDetail[] = [];
    const phone = normalizePhone(dto.phone);
    if (!phone) errors.push({ field: 'phone', errors: ['PHONE_FORMAT'] });
    const [sector, businessType] = await Promise.all([
      this.prisma.db.sector.count({ where: { id: dto.sectorId, isActive: true } }),
      this.prisma.db.businessType.count({ where: { id: dto.businessTypeId, isActive: true } }),
    ]);
    if (!sector) errors.push({ field: 'sectorId', errors: ['LOOKUP_INVALID'] });
    if (!businessType) errors.push({ field: 'businessTypeId', errors: ['LOOKUP_INVALID'] });
    if (errors.length) throw Errors.validation(errors);

    const locale = dto.locale ?? 'ar';
    const passwordHash = await this.passwords.hash(dto.password);
    const employerData = {
      contactName: dto.contactName,
      organizationName: dto.organizationName,
      sectorId: dto.sectorId,
      businessTypeId: dto.businessTypeId,
      email: dto.email,
      phone: phone!,
    };
    const existing = await this.prisma.db.user.findFirst({
      where: { email: dto.email, deletedAt: undefined },
    });
    if (existing) {
      if (
        existing.status !== UserStatus.PENDING_VERIFICATION ||
        existing.role !== UserRole.EMPLOYER ||
        existing.deletedAt
      ) {
        throw Errors.conflict('AUTH_EMAIL_TAKEN');
      }
      await this.prisma.runAs({ userId: existing.id, role: existing.role }, () =>
        this.prisma.tx(async (tx) => {
          await tx.user.update({ where: { id: existing.id }, data: { passwordHash, locale } });
          await tx.employer.updateMany({ where: { userId: existing.id }, data: employerData });
        }),
      );
      return this.sendVerificationCode({ ...existing, locale }, { ignoreCooldown: true });
    }

    const userId = randomUUID();
    const user = await this.prisma.runAs({ userId, role: UserRole.EMPLOYER }, () =>
      this.prisma.tx(async (tx) => {
        const created = await tx.user.create({
          data: {
            id: userId,
            email: dto.email,
            passwordHash,
            role: UserRole.EMPLOYER,
            status: UserStatus.PENDING_VERIFICATION,
            locale,
          },
        });
        await tx.employer.create({ data: { ...employerData, userId } });
        return created;
      }),
    );
    return this.sendVerificationCode(user, { ignoreCooldown: true });
  }

  /** Issues and emails a verification code. Returns how long until the next one may be requested. */
  private async sendVerificationCode(
    user: Pick<User, 'id' | 'email' | 'locale' | 'role'>,
    opts: { ignoreCooldown?: boolean } = {},
  ): Promise<PendingVerificationDto> {
    try {
      await this.prisma.runAs({ userId: user.id, role: user.role }, async () => {
        const { code, minutes } = await this.otp.issue(
          user.id,
          VerificationPurpose.EMAIL_VERIFICATION,
          user.email,
        );
        await this.email.enqueue({
          template: 'verifyEmail',
          to: user.email,
          locale: user.locale,
          vars: { code, minutes },
        });
      });
      return { email: user.email, resendAvailableIn: OTP_RESEND_COOLDOWN_SECONDS };
    } catch (err) {
      if (opts.ignoreCooldown && err instanceof AppException && err.code === 'AUTH_RESEND_COOLDOWN') {
        const wait = await this.otp.cooldownLeft(user.id, VerificationPurpose.EMAIL_VERIFICATION);
        return { email: user.email, resendAvailableIn: wait };
      }
      throw err;
    }
  }

  async resendVerification(email: string): Promise<PendingVerificationDto> {
    const user = await this.prisma.db.user.findUnique({ where: { email } });
    if (!user) return { email, resendAvailableIn: OTP_RESEND_COOLDOWN_SECONDS }; // no account enumeration
    if (user.status === UserStatus.ACTIVE) throw Errors.badRequest('AUTH_ALREADY_VERIFIED');
    if (user.status !== UserStatus.PENDING_VERIFICATION) throw Errors.forbidden('AUTH_ACCOUNT_SUSPENDED');
    return this.sendVerificationCode(user);
  }

  async verifyEmail(email: string, code: string, meta: ClientMeta): Promise<IssuedSession> {
    const user = await this.prisma.db.user.findUnique({ where: { email } });
    if (!user) throw Errors.badRequest('AUTH_CODE_INVALID');
    if (user.status === UserStatus.ACTIVE) throw Errors.badRequest('AUTH_ALREADY_VERIFIED');
    if (user.status !== UserStatus.PENDING_VERIFICATION) throw Errors.forbidden('AUTH_ACCOUNT_SUSPENDED');

    return this.prisma.runAs({ userId: user.id, role: user.role, ...meta }, async () => {
      await this.otp.verify(user.id, VerificationPurpose.EMAIL_VERIFICATION, code);
      const activated = await this.prisma.db.user.update({
        where: { id: user.id },
        data: { status: UserStatus.ACTIVE, emailVerifiedAt: new Date(), lastLoginAt: new Date() },
      });
      await this.audit.record(AuditAction.EMAIL_VERIFIED, 'users', user.id, { email: user.email });
      await this.audit.record(AuditAction.LOGIN, 'users', user.id, { method: 'EMAIL_VERIFICATION' });
      return this.startSession(activated, meta);
    });
  }

  // ---------------------------------------------------------------------------
  // Login, refresh, logout
  // ---------------------------------------------------------------------------

  async login(dto: LoginDto, meta: ClientMeta): Promise<IssuedSession> {
    const identifier = dto.identifier;
    const user = await this.prisma.db.user.findFirst({
      where: identifier.includes('@') ? { email: identifier } : { username: identifier },
    });

    if (!user) {
      await this.passwords.dummyVerify(dto.password);
      await this.audit.record(
        AuditAction.LOGIN_FAILED,
        'users',
        null,
        { identifier, reason: 'UNKNOWN_ACCOUNT' },
        {
          userId: null,
          role: null,
          ...meta,
        },
      );
      throw Errors.unauthenticated('AUTH_INVALID_CREDENTIALS');
    }

    const actor = { userId: user.id, role: user.role, ...meta };
    // Failed attempts have no authenticated actor (docs/database.md section 6); the account is the entity.
    const anonymous = { userId: null, role: null, ...meta };
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.audit.record(AuditAction.LOGIN_FAILED, 'users', user.id, { reason: 'LOCKED' }, anonymous);
      throw new AppException('AUTH_ACCOUNT_LOCKED', 423, {
        retryAfter: Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000),
      });
    }

    const ok = await this.passwords.verify(user.passwordHash, dto.password);
    if (!ok) {
      await this.prisma.runAs(anonymous, async () => {
        const failed = user.failedLoginCount + 1;
        const lock = failed >= LOGIN_MAX_FAILED_ATTEMPTS;
        await this.prisma.db.user.update({
          where: { id: user.id },
          data: lock
            ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOGIN_LOCK_MINUTES * 60_000) }
            : { failedLoginCount: failed },
        });
        await this.audit.record(AuditAction.LOGIN_FAILED, 'users', user.id, {
          reason: 'WRONG_PASSWORD',
          locked: lock,
        });
      });
      throw Errors.unauthenticated('AUTH_INVALID_CREDENTIALS');
    }

    if (user.status === UserStatus.PENDING_VERIFICATION) {
      const pending = await this.sendVerificationCode(user, { ignoreCooldown: true });
      throw Errors.forbidden('AUTH_EMAIL_NOT_VERIFIED', pending);
    }
    if (user.status !== UserStatus.ACTIVE) {
      await this.audit.record(AuditAction.LOGIN_FAILED, 'users', user.id, { reason: 'SUSPENDED' }, anonymous);
      throw Errors.forbidden('AUTH_ACCOUNT_SUSPENDED');
    }

    return this.prisma.runAs(actor, async () => {
      const updated = await this.prisma.db.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      await this.audit.record(AuditAction.LOGIN, 'users', user.id, { method: 'PASSWORD' });
      return this.startSession(updated, meta);
    });
  }

  async refresh(
    rawToken: string | undefined,
    meta: ClientMeta,
  ): Promise<
    | { result: Extract<RefreshResultDto, { authenticated: true }>; issued: IssuedSession }
    | { result: Extract<RefreshResultDto, { authenticated: false }>; clearCookies: boolean }
  > {
    const invalid = (code: string, clearCookies = true) => ({
      result: { authenticated: false as const, code },
      clearCookies,
    });
    if (!rawToken) return invalid('AUTH_REFRESH_INVALID');
    const rec = await this.tokens.findByToken(rawToken);
    if (!rec) return invalid('AUTH_REFRESH_INVALID');

    // Rotated a moment ago (two tabs, or a navigation that dropped the response with the new
    // cookie): the old token still opens the session for a short grace period, in a new
    // sibling token of the same family. The old record keeps its rotation time, so the grace
    // never extends, and nothing is issued once the family has ended (logout, password change).
    let grace = false;
    if (rec.revokedAt) {
      const justRotated =
        rec.revokeReason === 'ROTATED' && Date.now() - rec.revokedAt.getTime() < REFRESH_RACE_GRACE_MS;
      if (justRotated) {
        if (!(await this.tokens.familyActive(rec.familyId))) return invalid('AUTH_REFRESH_INVALID');
        grace = true;
      } else {
        // A revoked token was replayed: assume theft and end the whole session family.
        await this.prisma.runAs({ userId: rec.userId, ...meta }, () =>
          this.tokens.revokeFamily(rec.familyId, 'REUSE_DETECTED'),
        );
        return invalid('AUTH_REFRESH_REUSED');
      }
    }
    if (rec.expiresAt.getTime() < Date.now()) return invalid('AUTH_REFRESH_INVALID');

    const user = await this.prisma.db.user.findUnique({ where: { id: rec.userId } });
    if (!user || user.status !== UserStatus.ACTIVE) return invalid('AUTH_ACCOUNT_SUSPENDED');

    if (grace) {
      const issued = await this.prisma.runAs({ userId: user.id, role: user.role, ...meta }, async () => {
        const next = await this.tokens.issueRefresh(user.id, meta, rec.familyId);
        return {
          session: await this.buildSession(user),
          refreshToken: next.token,
          refreshExpiresAt: next.expiresAt,
        };
      });
      return { result: { authenticated: true, ...issued.session }, issued };
    }

    const issued = await this.prisma.runAs({ userId: user.id, role: user.role, ...meta }, () =>
      this.prisma.tx(async (tx) => {
        const next = await this.tokens.issueRefresh(user.id, meta, rec.familyId);
        await tx.refreshToken.update({
          where: { id: rec.id },
          data: {
            revokedAt: new Date(),
            revokeReason: 'ROTATED',
            replacedById: next.id,
            lastUsedAt: new Date(),
          },
        });
        return {
          session: await this.buildSession(user),
          refreshToken: next.token,
          refreshExpiresAt: next.expiresAt,
        };
      }),
    );
    return { result: { authenticated: true, ...issued.session }, issued };
  }

  async logout(rawToken: string | undefined, meta: ClientMeta): Promise<void> {
    if (!rawToken) return;
    const rec = await this.tokens.findByToken(rawToken);
    if (!rec) return;
    const user = await this.prisma.db.user.findUnique({ where: { id: rec.userId }, select: { role: true } });
    await this.prisma.runAs({ userId: rec.userId, role: user?.role ?? null, ...meta }, async () => {
      await this.tokens.revokeFamily(rec.familyId, 'LOGOUT');
      await this.audit.record(AuditAction.LOGOUT, 'users', rec.userId, null);
    });
  }

  // ---------------------------------------------------------------------------
  // Passwords
  // ---------------------------------------------------------------------------

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.db.user.findUnique({ where: { email } });
    if (!user || user.status !== UserStatus.ACTIVE) return; // same answer either way
    try {
      await this.prisma.runAs({ userId: user.id, role: user.role }, async () => {
        const { code, minutes } = await this.otp.issue(
          user.id,
          VerificationPurpose.PASSWORD_RESET,
          user.email,
        );
        await this.email.enqueue({
          template: 'passwordReset',
          to: user.email,
          locale: user.locale,
          vars: { code, minutes },
        });
      });
    } catch (err) {
      if (err instanceof AppException && err.code === 'AUTH_RESEND_COOLDOWN') return;
      throw err;
    }
  }

  async resetPassword(dto: ResetPasswordDto, meta: ClientMeta): Promise<void> {
    const user = await this.prisma.db.user.findUnique({ where: { email: dto.email } });
    if (!user || user.status !== UserStatus.ACTIVE) throw Errors.badRequest('AUTH_CODE_INVALID');
    await this.prisma.runAs({ userId: user.id, role: user.role, ...meta }, async () => {
      await this.otp.verify(user.id, VerificationPurpose.PASSWORD_RESET, dto.code);
      await this.prisma.db.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await this.passwords.hash(dto.newPassword),
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await this.tokens.revokeAllForUser(user.id, 'PASSWORD_RESET');
      await this.audit.record(AuditAction.PASSWORD_RESET, 'users', user.id, { method: 'EMAIL_CODE' });
    });
    if (user.isSystemAccount) await this.forgetInitialAdminPassword();
  }

  async changePassword(userId: string, dto: ChangePasswordDto, meta: ClientMeta): Promise<IssuedSession> {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.unauthenticated();
    if (!(await this.passwords.verify(user.passwordHash, dto.currentPassword))) {
      throw Errors.badRequest('AUTH_WRONG_PASSWORD');
    }
    if (dto.currentPassword === dto.newPassword) throw Errors.badRequest('AUTH_PASSWORD_REUSED');

    const updated = await this.prisma.db.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(dto.newPassword), mustChangePassword: false },
    });
    await this.tokens.revokeAllForUser(user.id, 'PASSWORD_CHANGE');
    await this.audit.record(AuditAction.PASSWORD_RESET, 'users', user.id, {
      method: 'CHANGE',
      wasForced: user.mustChangePassword,
    });
    if (user.isSystemAccount) await this.forgetInitialAdminPassword();
    return this.startSession(updated, meta);
  }

  /** The generated first-run admin password is useless once changed; remove its file. */
  private async forgetInitialAdminPassword(): Promise<void> {
    try {
      await rm(this.config.adminInitialPasswordFile, { force: true });
    } catch (err) {
      this.logger.warn(`Could not remove ${this.config.adminInitialPasswordFile}: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Sessions and the /me payload
  // ---------------------------------------------------------------------------

  private async startSession(user: User, meta: ClientMeta): Promise<IssuedSession> {
    const refresh = await this.tokens.issueRefresh(user.id, meta);
    return {
      session: await this.buildSession(user),
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
    };
  }

  private async buildSession(user: User): Promise<SessionDto> {
    return {
      accessToken: this.tokens.signAccess(user.id, user.role),
      expiresIn: this.tokens.accessTtlSeconds,
      user: await this.me(user.id),
    };
  }

  async me(userId: string): Promise<MeDto> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      include: {
        person: { select: { firstName: true, familyName: true } },
        employer: { select: { contactName: true } },
      },
    });
    if (!user) throw Errors.unauthenticated();
    const perms = await this.permissions.effective(user.id, user.role);
    const displayName = user.person
      ? `${user.person.firstName} ${user.person.familyName}`
      : (user.employer?.contactName ?? user.displayName ?? user.username ?? user.email.split('@')[0]);
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName,
      role: user.role,
      status: user.status,
      locale: user.locale,
      mustChangePassword: user.mustChangePassword,
      isSystemAccount: user.isSystemAccount,
      permissions: [...perms].sort(),
    };
  }

  async updateLocale(userId: string, locale: 'ar' | 'en'): Promise<MeDto> {
    await this.prisma.db.user.update({ where: { id: userId }, data: { locale } });
    return this.me(userId);
  }
}
