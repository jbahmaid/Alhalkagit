import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { AuditModule } from '../audit/audit.module';
import { PasswordService } from '../auth/password.service';
import { AppConfigModule } from '../config/config.module';
import { CryptoModule } from '../crypto/crypto.module';
import { FileStorageModule } from '../files/files.module';
import { MatchingService } from '../matching/matching.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DemoSeedService } from './demo-seed.service';

/** Standalone context for `node dist/demo.js seed|remove` (no HTTP server, no queues). */
@Module({
  imports: [
    AppConfigModule.forRoot({ generateMissingSecrets: false }),
    ClsModule.forRoot({ global: true }),
    PrismaModule,
    AuditModule,
    CryptoModule,
    FileStorageModule,
  ],
  providers: [DemoSeedService, PasswordService, MatchingService],
})
export class DemoModule {}
