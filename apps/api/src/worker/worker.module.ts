import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { AuditModule } from '../audit/audit.module';
import { AppConfigModule } from '../config/config.module';
import { CryptoModule } from '../crypto/crypto.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Background worker (same image as the API, different command). Batch 1: sends emails.
 * Later batches add CV analysis and match scoring processors here.
 */
@Module({
  imports: [
    AppConfigModule.forRoot({ generateMissingSecrets: false }),
    ClsModule.forRoot({ global: true }),
    PrismaModule,
    AuditModule,
    CryptoModule,
    NotificationsModule.forWorker(),
  ],
})
export class WorkerModule {}
