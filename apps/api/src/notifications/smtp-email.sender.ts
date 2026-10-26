import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import type { EmailMessage, EmailSender } from './email.types';

@Injectable()
export class SmtpEmailSender implements EmailSender {
  private readonly logger = new Logger('SmtpEmailSender');
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.from = config.smtp.from;
    this.transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
    this.logger.log(`Email "${message.subject}" sent`);
  }
}
