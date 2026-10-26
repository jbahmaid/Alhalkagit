import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MatchingModule } from '../matching/matching.module';
import { SeekersModule } from '../seekers/seekers.module';
import { AdminAuditService } from './admin-audit.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminLookupsService } from './admin-lookups.service';
import { AdminSettingsService } from './admin-settings.service';
import { AdminUsersService } from './admin-users.service';
import {
  AdminAdminsController,
  AdminAuditController,
  AdminDashboardController,
  AdminExportController,
  AdminLookupsController,
  AdminSettingsController,
  AdminUsersController,
} from './admin.controllers';
import { ExportService } from './export/export.service';

/** Admin area (FR-2.4.1 to FR-2.4.3) and Excel export (FR-2.5.4). Approvals live in JobsModule. */
@Module({
  imports: [AuthModule, SeekersModule, MatchingModule],
  controllers: [
    AdminDashboardController,
    AdminLookupsController,
    AdminUsersController,
    AdminAdminsController,
    AdminAuditController,
    AdminSettingsController,
    AdminExportController,
  ],
  providers: [
    AdminDashboardService,
    AdminLookupsService,
    AdminUsersService,
    AdminAuditService,
    AdminSettingsService,
    ExportService,
  ],
})
export class AdminModule {}
