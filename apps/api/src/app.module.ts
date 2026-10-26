import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { AppConfig } from './config/app-config';
import { APP_CONFIG, AppConfigModule } from './config/config.module';
import { CryptoModule } from './crypto/crypto.module';
import { FilesModule } from './files/files.module';
import { HealthController } from './health/health.controller';
import { LookupsModule } from './lookups/lookups.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { JobsModule } from './jobs/jobs.module';
import { SeekersModule } from './seekers/seekers.module';

@Module({
  imports: [
    AppConfigModule.forRoot({ generateMissingSecrets: true }),
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        setup: (cls, req: Request) => {
          cls.set('ip', req.ip ?? null);
          cls.set('userAgent', req.headers['user-agent'] ?? null);
          const rid = req.headers['x-request-id'];
          cls.set('requestId', typeof rid === 'string' && rid.length <= 64 ? rid : randomUUID());
        },
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
        skipIf: () => !config.throttle.enabled,
      }),
    }),
    PrismaModule,
    AuditModule,
    CryptoModule,
    NotificationsModule.forApi(),
    AuthModule,
    LookupsModule,
    FilesModule,
    SeekersModule,
    JobsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Global guards, in order: rate limit, authenticate, check permissions.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: PermissionsGuard },
  ],
})
export class AppModule {}
