export type Locale = 'ar' | 'en';

export const EMAIL_QUEUE = 'email';

/** Jobs placed on the BullMQ `email` queue by the API and sent by the worker. */
export type EmailJob =
  | { template: 'verifyEmail'; to: string; locale: Locale; vars: { code: string; minutes: number } }
  | { template: 'passwordReset'; to: string; locale: Locale; vars: { code: string; minutes: number } };

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Outgoing email transport. SMTP in every environment (Mailpit locally). */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
