import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { EmailProcessor } from './email.processor';
import { EmailQueueService } from './email-queue.service';
import { EMAIL_QUEUE, EMAIL_SENDER } from './email.types';
import { redisConnection } from './redis';
import { SmtpEmailSender } from './smtp-email.sender';
import { createSmsSender, SMS_SENDER, SmsService } from './sms';

const bullRoot = BullModule.forRootAsync({
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) => ({ connection: redisConnection(config.redisUrl) }),
});

const smsProvider = { provide: SMS_SENDER, inject: [APP_CONFIG], useFactory: createSmsSender };

@Global()
@Module({})
export class NotificationsModule {
  /** API: producer only. */
  static forApi(): DynamicModule {
    return {
      module: NotificationsModule,
      imports: [bullRoot, BullModule.registerQueue({ name: EMAIL_QUEUE })],
      providers: [EmailQueueService, smsProvider, SmsService],
      exports: [EmailQueueService, SmsService],
    };
  }

  /** Worker: consumer with the SMTP transport. */
  static forWorker(): DynamicModule {
    return {
      module: NotificationsModule,
      imports: [bullRoot, BullModule.registerQueue({ name: EMAIL_QUEUE })],
      providers: [
        { provide: EMAIL_SENDER, useClass: SmtpEmailSender },
        EmailProcessor,
        smsProvider,
        SmsService,
      ],
      exports: [SmsService],
    };
  }
}
