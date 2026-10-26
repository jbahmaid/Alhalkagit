import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config';

/** SMS transport. Built now, disabled by default (SMS_ENABLED=false), per the owner's decision. */
export interface SmsSender {
  readonly enabled: boolean;
  send(to: string, text: string): Promise<{ sent: boolean; reason?: string }>;
}
export const SMS_SENDER = Symbol('SMS_SENDER');

/** Default: does nothing. */
export class DisabledSmsSender implements SmsSender {
  readonly enabled = false;
  async send(): Promise<{ sent: boolean; reason?: string }> {
    return { sent: false, reason: 'SMS_DISABLED' };
  }
}

/**
 * Stub provider used when SMS_ENABLED=true and SMS_PROVIDER=log: logs instead of sending.
 * A real provider (e.g. Unifonic, Twilio) implements SmsSender and is selected in createSmsSender.
 */
export class LogSmsSender implements SmsSender {
  readonly enabled = true;
  private readonly logger = new Logger('LogSmsSender');
  async send(to: string, text: string): Promise<{ sent: boolean }> {
    this.logger.log(`SMS to ${to.slice(0, 4)}***: ${text.length} chars (stub provider, not delivered)`);
    return { sent: true };
  }
}

export function createSmsSender(config: Pick<AppConfig, 'sms'>): SmsSender {
  if (!config.sms.enabled) return new DisabledSmsSender();
  switch (config.sms.provider) {
    case 'log':
      return new LogSmsSender();
    default:
      throw new Error(`Unknown SMS_PROVIDER "${config.sms.provider}"`);
  }
}

@Injectable()
export class SmsService {
  constructor(@Inject(SMS_SENDER) private readonly sender: SmsSender) {}
  get enabled(): boolean {
    return this.sender.enabled;
  }
  send(to: string, text: string) {
    return this.sender.send(to, text);
  }
}
