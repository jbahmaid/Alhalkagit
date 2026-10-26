import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSIONS as P, type ReportsDto } from '@sanad/shared';
import { PermissionsService } from '../auth/permissions.service';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/decorators';
import { ReportFiltersDto } from '../admin/dto/admin.dto';
import { ReportsService } from './reports.service';

/**
 * S-22. Admins (`reports.all.read`) get every report with filters; employers
 * (`reports.general.read`) get the general reports, unfiltered, plus their own jobs.
 */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  @RequirePermissions(P.REPORTS_GENERAL_READ)
  async get(@CurrentUser() user: AuthUser, @Query() q: ReportFiltersDto): Promise<ReportsDto> {
    const all = await this.permissions.has(user.id, user.role, [P.REPORTS_ALL_READ]);
    if (all) return this.reports.report('all', q);
    return this.reports.report('general', {}, user.role === 'EMPLOYER' ? user.id : undefined);
  }
}
