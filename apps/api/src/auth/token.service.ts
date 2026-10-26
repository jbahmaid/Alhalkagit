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

/** Short-lived proof that an admin re-entered their password before an export (architecture §8). */
export interface ExportPayload {
  sub: string;
  typ: 'export';
}

export const EXPORT_TOKEN_TTL_SECONDS = 300;

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

  signExport(userId: string): { token: string; expiresAt: Date } {
    const payload: ExportPayload = { sub: userId, typ: 'export' };
    const token = this.jwt.sign(payload, {
      secret: this.config.secrets.JWT_ACCESS_SECRET,
      expiresIn: EXPORT_TOKEN_TTL_SECONDS,
      algorithm: 'HS256',
    });
    return { token, expiresAt: new Date(Date.now() + EXPORT_TOKEN_TTL_SECONDS * 1000) };
  }

  /** The export token must be valid, of type 'export', and issued to this same user. */
  verifyExport(token: string, userId: string): void {
    let payload: ExportPayload;
    try {
      payload = this.jwt.verify<ExportPayload>(token, {
        secret: this.config.secrets.JWT_ACCESS_SECRET,
        algorithms: ['HS256'],
      });
    } catch {
      throw Errors.forbidden('EXPORT_TOKEN_INVALID');
    }
    if (payload.typ !== 'export' || payload.sub !== userId) throw Errors.forbidden('EXPORT_TOKEN_INVALID');
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

  /** True while the session family still has a usable token (not ended by logout etc.). */
  async familyActive(familyId: string): Promise<boolean> {
    const n = await this.prisma.db.refreshToken.count({
      where: { familyId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    return n > 0;
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
