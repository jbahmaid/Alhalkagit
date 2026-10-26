import { Injectable } from '@nestjs/common';
import { VerificationPurpose } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_MINUTES } from '@sanad/shared';
import { Errors } from '../common/app-exception';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

/** Email one-time codes (verification and password reset). Only a keyed hash is stored. */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Seconds left before a new code may be sent (0 = now). */
  async cooldownLeft(userId: string, purpose: VerificationPurpose, now = new Date()): Promise<number> {
    const last = await this.prisma.db.emailVerificationCode.findFirst({
      where: { userId, purpose },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (!last) return 0;
    const elapsed = Math.floor((now.getTime() - last.createdAt.getTime()) / 1000);
    return Math.max(0, OTP_RESEND_COOLDOWN_SECONDS - elapsed);
  }

  /** Creates a new code. Throws AUTH_RESEND_COOLDOWN while the previous one is too recent. */
  async issue(
    userId: string,
    purpose: VerificationPurpose,
    sentTo: string,
  ): Promise<{ code: string; minutes: number }> {
    const wait = await this.cooldownLeft(userId, purpose);
    if (wait > 0) throw Errors.tooMany('AUTH_RESEND_COOLDOWN', { retryAfter: wait });
    const id = randomUUID();
    const code = this.crypto.generateOtp();
    await this.prisma.db.emailVerificationCode.create({
      data: {
        id,
        userId,
        purpose,
        codeHash: this.crypto.hashOtp(id, code),
        expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
        maxAttempts: OTP_MAX_ATTEMPTS,
        sentTo,
      },
    });
    return { code, minutes: OTP_TTL_MINUTES };
  }

  /** Checks the latest unconsumed code; failed attempts are counted and persisted. */
  async verify(userId: string, purpose: VerificationPurpose, code: string): Promise<void> {
    const rec = await this.prisma.db.emailVerificationCode.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!rec) throw Errors.badRequest('AUTH_CODE_INVALID');
    if (rec.attempts >= rec.maxAttempts) throw Errors.badRequest('AUTH_CODE_TOO_MANY_ATTEMPTS');
    if (rec.expiresAt.getTime() < Date.now()) throw Errors.badRequest('AUTH_CODE_EXPIRED');
    if (!this.crypto.safeEqualHex(rec.codeHash, this.crypto.hashOtp(rec.id, code))) {
      const attempts = rec.attempts + 1;
      await this.prisma.db.emailVerificationCode.update({ where: { id: rec.id }, data: { attempts } });
      if (attempts >= rec.maxAttempts) throw Errors.badRequest('AUTH_CODE_TOO_MANY_ATTEMPTS');
      throw Errors.badRequest('AUTH_CODE_INVALID', { attemptsLeft: rec.maxAttempts - attempts });
    }
    await this.prisma.db.emailVerificationCode.update({
      where: { id: rec.id },
      data: { consumedAt: new Date(), attempts: rec.attempts + 1 },
    });
  }
}
