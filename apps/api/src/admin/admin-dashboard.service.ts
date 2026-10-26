import { Injectable } from '@nestjs/common';
import type { AdminDashboardDto } from '@sanad/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';

/** S-17 counters, the pending approvals shortcut and the latest audit entries. */
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async get(): Promise<AdminDashboardDto> {
    const db = this.prisma.db;
    const [seekers, approved, pendingCount, openJobs, interestRequests, hired, pending, recentAudit] =
      await Promise.all([
        db.user.count({ where: { role: 'SEEKER' } }),
        db.employer.count({ where: { approvalStatus: 'APPROVED' } }),
        db.employer.count({ where: { approvalStatus: 'PENDING' } }),
        db.job.count({ where: { status: 'OPEN' } }),
        db.interestRequest.count({ where: { status: { not: 'WITHDRAWN' } } }),
        db.job.count({ where: { closedOutcome: 'HIRED_VIA_PLATFORM' } }),
        db.employer.findMany({
          where: { approvalStatus: 'PENDING' },
          orderBy: { createdAt: 'asc' },
          take: 3,
          select: { id: true, organizationName: true, sectorId: true, createdAt: true },
        }),
        this.audit.latest(5),
      ]);
    return {
      stats: {
        seekers,
        employersApproved: approved,
        employersPending: pendingCount,
        openJobs,
        interestRequests,
        hiredViaPlatform: hired,
      },
      pending: pending.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
      recentAudit,
    };
  }
}
