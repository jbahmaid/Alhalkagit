import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const TTL_MS = 30_000;

/**
 * Effective permissions = role defaults (role_permissions) + per-user grants
 * (user_permissions.granted=true) - per-user revocations (granted=false).
 * SUPER_ADMIN always has every permission. Cached briefly per user.
 */
@Injectable()
export class PermissionsService {
  private readonly cache = new Map<string, { at: number; perms: Set<string> }>();

  constructor(private readonly prisma: PrismaService) {}

  async effective(userId: string, role: UserRole): Promise<Set<string>> {
    const key = `${userId}:${role}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.perms;

    let perms: Set<string>;
    if (role === UserRole.SUPER_ADMIN) {
      const all = await this.prisma.db.permission.findMany({ select: { code: true } });
      perms = new Set(all.map((p) => p.code));
    } else {
      const [roleRows, userRows] = await Promise.all([
        this.prisma.db.rolePermission.findMany({
          where: { role },
          select: { permission: { select: { code: true } } },
        }),
        this.prisma.db.userPermission.findMany({
          where: { userId },
          select: { granted: true, permission: { select: { code: true } } },
        }),
      ]);
      perms = new Set(roleRows.map((r) => r.permission.code));
      for (const u of userRows) {
        if (u.granted) perms.add(u.permission.code);
        else perms.delete(u.permission.code);
      }
    }
    this.cache.set(key, { at: Date.now(), perms });
    return perms;
  }

  async has(userId: string, role: UserRole, codes: string[]): Promise<boolean> {
    if (role === UserRole.SUPER_ADMIN) return true;
    const perms = await this.effective(userId, role);
    return codes.every((c) => perms.has(c));
  }

  /** Call after changing a user's role or grants. */
  invalidate(userId?: string): void {
    if (!userId) return this.cache.clear();
    for (const k of this.cache.keys()) if (k.startsWith(`${userId}:`)) this.cache.delete(k);
  }
}
