import type { ClsStore } from 'nestjs-cls';
import type { UserRole } from '@prisma/client';

/** Per-request values kept in AsyncLocalStorage (nestjs-cls). Read by the audit extension. */
export interface RequestContext extends ClsStore {
  userId?: string | null;
  role?: UserRole | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export const CTX = {
  userId: 'userId',
  role: 'role',
  ip: 'ip',
  userAgent: 'userAgent',
  requestId: 'requestId',
  /** Active interactive transaction client (see PrismaService.tx). */
  tx: 'prismaTx',
  /** Set by PrismaService.hardDelete to let a real DELETE through. */
  hardDelete: 'prismaHardDelete',
} as const;
