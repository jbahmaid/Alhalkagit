import { Inject, Injectable } from '@nestjs/common';
import { AuditAction, EmployerApprovalStatus } from '@prisma/client';
import { AdminEmployerDto } from '@sanad/shared';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/app-exception';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { EmailQueueService } from '../notifications/email-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { toAccountDto } from './employers.service';

/**
 * Minimal admin API for employer approval (FR-2.2.2). The admin screen (S-18) comes in batch 4.
 * Approval and rejection are audited (UPDATE of the row plus an APPROVE / REJECT event) and the
 * employer is emailed in their language.
 */
@Injectable()
export class AdminEmployersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailQueueService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  async list(status?: EmployerApprovalStatus): Promise<AdminEmployerDto[]> {
    const rows = await this.db.employer.findMany({
      where: status ? { approvalStatus: status } : {},
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { emailVerifiedAt: true } } },
    });
    return rows.map((e) => ({ id: e.id, ...toAccountDto(e, e.user.emailVerifiedAt) }));
  }

  private async load(id: string) {
    const e = await this.db.employer.findFirst({ where: { id }, include: { user: true } });
    if (!e) throw Errors.notFound('EMPLOYER_NOT_FOUND');
    return e;
  }

  async approve(adminId: string, id: string): Promise<AdminEmployerDto> {
    const e = await this.load(id);
    if (e.approvalStatus === 'APPROVED') throw Errors.conflict('EMPLOYER_ALREADY_DECIDED');
    const updated = await this.prisma.tx(async () => {
      const row = await this.db.employer.update({
        where: { id },
        data: { approvalStatus: 'APPROVED', approvedById: adminId, approvedAt: new Date(), rejectionReason: null },
      });
      await this.audit.record(AuditAction.APPROVE, 'employers', id, { approvalStatus: 'APPROVED' });
      return row;
    });
    const locale = e.user.locale === 'en' ? 'en' : 'ar';
    await this.email.enqueue({
      template: 'employerApproved',
      to: e.email,
      locale,
      vars: { name: e.contactName, link: `${this.config.publicUrl}/${locale}/employer` },
    });
    return { id, ...toAccountDto(updated, e.user.emailVerifiedAt) };
  }

  async reject(id: string, reason: string | null | undefined): Promise<AdminEmployerDto> {
    const e = await this.load(id);
    if (e.approvalStatus !== 'PENDING') throw Errors.conflict('EMPLOYER_ALREADY_DECIDED');
    const updated = await this.prisma.tx(async () => {
      const row = await this.db.employer.update({
        where: { id },
        data: { approvalStatus: 'REJECTED', rejectionReason: reason ?? null },
      });
      await this.audit.record(AuditAction.REJECT, 'employers', id, { approvalStatus: 'REJECTED', reason: reason ?? null });
      return row;
    });
    await this.email.enqueue({
      template: 'employerRejected',
      to: e.email,
      locale: e.user.locale === 'en' ? 'en' : 'ar',
      vars: { name: e.contactName, reason: reason ?? null },
    });
    return { id, ...toAccountDto(updated, e.user.emailVerifiedAt) };
  }
}
