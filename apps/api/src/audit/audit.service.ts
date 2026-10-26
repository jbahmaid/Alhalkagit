import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditActor } from '../prisma/audited-client';
import { ClsService } from 'nestjs-cls';
import { RequestContext } from '../common/request-context';

/**
 * Explicit audit events that are not row changes (LOGIN, LOGIN_FAILED, LOGOUT, EMAIL_VERIFIED,
 * PASSWORD_RESET, VIEW_SENSITIVE, EXPORT...). Row changes are audited automatically by the
 * Prisma extension.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async record(
    action: AuditAction,
    entity: string,
    entityId: string | null,
    after?: Record<string, unknown> | null,
    actor?: AuditActor,
  ): Promise<void> {
    const write = () => this.prisma.db.$audit({ action, entity, entityId, after: after ?? null });
    if (actor) await this.prisma.runAs(actor, write);
    else await write();
  }

  /** Sets the actor for the rest of the request (e.g. right after a successful login). */
  setActor(userId: string, role: AuditActor['role']): void {
    if (!this.cls.isActive()) return;
    this.cls.set('userId', userId);
    this.cls.set('role', role);
  }
}
