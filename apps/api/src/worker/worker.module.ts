import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { AuditModule } from '../audit/audit.module';
import { AppConfigModule } from '../config/config.module';
import { CryptoModule } from '../crypto/crypto.module';
import { CvAnalysisModule } from '../cv-analysis/cv-analysis.module';
import { FileStorageModule } from '../files/files.module';
import { MatchingModule } from '../matching/matching.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Background worker (same image as the API, different command): emails, CV analysis and the
 * profile.updated hook for match scores (no-op until batch 3).
 */
@Module({
  imports: [
    AppConfigModule.forRoot({ generateMissingSecrets: false }),
    ClsModule.forRoot({ global: true }),
    PrismaModule,
    AuditModule,
    CryptoModule,
    NotificationsModule.forWorker(),
    FileStorageModule,
    CvAnalysisModule,
    MatchingModule,
  ],
})
export class WorkerModule {}
