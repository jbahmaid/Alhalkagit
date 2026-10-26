import { Inject, Injectable } from '@nestjs/common';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { createHmac, randomUUID } from 'node:crypto';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { Errors } from '../common/app-exception';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

export interface AccessPayload {
  sub: string;
  role: UserRole;
  typ: 'access';
}

/** A refresh token that was just rotated may be presented again for this long (parallel tabs). */
export const REFRESH_RACE_GRACE_MS = 30_000;

export interface IssuedRefresh {
  token: string;
  expiresAt: Date;
}

@Injectable()
export class TokenService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  get accessTtlSeconds(): number {
    return this.config.jwt.accessTtlSeconds;
  }

  signAccess(userId: string, role: UserRole): string {
    const payload: AccessPayload = { sub: userId, role, typ: 'access' };
    return this.jwt.sign(payload, {
      secret: this.config.secrets.JWT_ACCESS_SECRET,
      expiresIn: this.config.jwt.accessTtlSeconds,
      algorithm: 'HS256',
    });
  }

  verifyAccess(token: string): AccessPayload {
    try {
      const payload = this.jwt.verify<AccessPayload>(token, {
        secret: this.config.secrets.JWT_ACCESS_SECRET,
        algorithms: ['HS256'],
      });
      if (payload.typ !== 'access') throw Errors.unauthenticated('AUTH_TOKEN_INVALID');
      return payload;
    } catch (err) {
      if (err instanceof TokenExpiredError) throw Errors.unauthenticated('AUTH_TOKEN_EXPIRED');
      throw Errors.unauthenticated('AUTH_TOKEN_INVALID');
    }
  }

  /** Keyed hash of an opaque refresh token (only the hash is stored). */
  hashRefresh(token: string): string {
    return createHmac('sha256', this.config.secrets.JWT_REFRESH_SECRET).update(token).digest('hex');
  }

  refreshExpiry(): Date {
    return new Date(Date.now() + this.config.jwt.refreshTtlDays * 86_400_000);
  }

  /** Starts a new session family, or continues one when rotating. */
  async issueRefresh(
    userId: string,
    meta: { ip?: string | null; userAgent?: string | null },
    familyId: string = randomUUID(),
  ): Promise<IssuedRefresh & { id: string }> {
    const token = this.crypto.generateToken(32);
    const expiresAt = this.refreshExpiry();
    const rec = await this.prisma.db.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashRefresh(token),
        familyId,
        expiresAt,
        ip: meta.ip?.slice(0, 45) ?? null,
        userAgent: meta.userAgent?.slice(0, 512) ?? null,
      },
      select: { id: true },
    });
    return { id: rec.id, token, expiresAt };
  }

  findByToken(token: string) {
    return this.prisma.db.refreshToken.findUnique({ where: { tokenHash: this.hashRefresh(token) } });
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.prisma.db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }
}
