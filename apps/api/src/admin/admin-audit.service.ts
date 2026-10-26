import { Injectable } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';
import type { AuditEntryDto, AuditPageDto } from '@sanad/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditFiltersDto, AuditQueryDto } from './dto/admin.dto';

/** S-21 audit log viewer (`audit.read`). Read only: the table itself refuses updates and deletes. */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.db;
  }

  /** Filters to a Prisma where. The user filter matches email, username or admin display name. */
  async where(f: AuditFiltersDto): Promise<Prisma.AuditLogWhereInput> {
    const where: Prisma.AuditLogWhereInput = {};
    if (f.action) where.action = f.action;
    if (f.entity) where.entity = f.entity;
    if (f.from || f.to) {
      where.createdAt = {
        ...(f.from ? { gte: new Date(`${f.from}T00:00:00.000Z`) } : {}),
        ...(f.to ? { lt: new Date(new Date(`${f.to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}),
      };
    }
    const q = f.user?.trim();
    if (q) {
      const has = { contains: q, mode: 'insensitive' as const };
      const users = await this.db.user.findMany({
        where: {
          deletedAt: undefined,
          OR: [
            { email: has },
            { username: has },
            { displayName: has },
            { person: { is: { OR: [{ firstName: has }, { familyName: has }] } } },
            { employer: { is: { contactName: has } } },
          ],
        },
        select: { id: true },
        take: 500,
      });
      where.actorUserId = { in: users.map((u) => u.id) };
    }
    return where;
  }

  async toDtos(rows: AuditLog[]): Promise<AuditEntryDto[]> {
    const ids = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))];
    const users = ids.length
      ? await this.db.user.findMany({
          where: { id: { in: ids }, deletedAt: undefined },
          select: { id: true, email: true, username: true },
        })
      : [];
    const label = new Map(users.map((u) => [u.id, u.username ?? u.email]));
    return rows.map((r) => ({
      id: String(r.id),
      createdAt: r.createdAt.toISOString(),
      actorUserId: r.actorUserId,
      actorLabel: r.actorUserId ? (label.get(r.actorUserId) ?? null) : null,
      actorRole: r.actorRole,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      ip: r.ip,
      before: r.before,
      after: r.after,
    }));
  }

  async page(q: AuditQueryDto): Promise<AuditPageDto> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where = await this.where(q);
    const [total, rows, entities] = await Promise.all([
      this.db.auditLog.count({ where }),
      this.db.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.auditLog.groupBy({ by: ['entity'], orderBy: { entity: 'asc' } }),
    ]);
    return {
      items: await this.toDtos(rows),
      total,
      page,
      pageSize,
      entities: entities.map((e) => e.entity),
    };
  }

  async latest(n: number): Promise<AuditEntryDto[]> {
    return this.toDtos(
      await this.db.auditLog.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: n }),
    );
  }
}
