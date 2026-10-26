import { Injectable } from '@nestjs/common';
import { VerificationPurpose } from '@prisma/client';
import type { AccountDto, PendingVerificationDto } from '@sanad/shared';
import { Errors } from '../common/app-exception';
import { EmailQueueService } from '../notifications/email-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { nameOf } from '../common/names';
import { ConfirmEmailChangeDto, RequestEmailChangeDto } from './dto/auth.dto';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';

/**
 * "My account" for every role: change the login email (password re-confirmed, then a code sent
 * to the new address; the old address is told afterwards). Password changes use
 * POST /auth/password/change.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly otp: OtpService,
    private readonly email: EmailQueueService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  /** The address of an unexpired, unused email-change code (sentTo differs from the email). */
  private async pending(userId: string, current: string) {
    const rec = await this.db.emailVerificationCode.findFirst({
      where: { userId, purpose: VerificationPurpose.EMAIL_VERIFICATION, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rec && rec.sentTo !== current && rec.expiresAt.getTime() > Date.now() ? rec : null;
  }

  async get(userId: string): Promise<AccountDto> {
    const u = await this.db.user.findFirst({ where: { id: userId } });
    if (!u) throw Errors.unauthenticated();
    const [person, employer] = await Promise.all([
      this.db.person.findFirst({ where: { userId } }),
      this.db.employer.findFirst({ where: { userId }, select: { contactName: true } }),
    ]);
    const p = await this.pending(userId, u.email);
    return {
      email: u.email,
      username: u.username,
      displayName: nameOf(u, person, employer),
      role: u.role,
      isSystemAccount: u.isSystemAccount,
      pendingEmail: p?.sentTo ?? null,
    };
  }

  async requestEmailChange(userId: string, dto: RequestEmailChangeDto): Promise<PendingVerificationDto> {
    const u = await this.db.user.findFirst({ where: { id: userId } });
    if (!u) throw Errors.unauthenticated();
    if (!(await this.passwords.verify(u.passwordHash, dto.currentPassword))) {
      throw Errors.forbidden('AUTH_WRONG_PASSWORD');
    }
    if (dto.email === u.email) throw Errors.badRequest('EMAIL_UNCHANGED');
    const clash = await this.db.user.findFirst({ where: { email: dto.email, deletedAt: undefined } });
    if (clash) throw Errors.conflict('AUTH_EMAIL_TAKEN');
    const { code, minutes } = await this.otp.issue(userId, VerificationPurpose.EMAIL_VERIFICATION, dto.email);
    await this.email.enqueue({
      template: 'emailChangeCode',
      to: dto.email,
      locale: u.locale,
      vars: { code, minutes },
    });
    return { email: dto.email, resendAvailableIn: 60 };
  }

  async confirmEmailChange(userId: string, dto: ConfirmEmailChangeDto): Promise<AccountDto> {
    const u = await this.db.user.findFirst({ where: { id: userId } });
    if (!u) throw Errors.unauthenticated();
    const rec = await this.pending(userId, u.email);
    if (!rec) throw Errors.badRequest('EMAIL_CHANGE_NOT_PENDING');
    await this.otp.verify(userId, VerificationPurpose.EMAIL_VERIFICATION, dto.code);
    const clash = await this.db.user.findFirst({ where: { email: rec.sentTo, deletedAt: undefined } });
    if (clash) throw Errors.conflict('AUTH_EMAIL_TAKEN');
    const previous = u.email;
    await this.db.user.update({ where: { id: userId }, data: { email: rec.sentTo } });
    await this.email.enqueue({
      template: 'emailChanged',
      to: previous,
      locale: u.locale,
      vars: { newEmail: rec.sentTo },
    });
    return this.get(userId);
  }
}
