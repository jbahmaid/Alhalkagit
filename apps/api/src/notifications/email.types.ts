export type Locale = 'ar' | 'en';

export const EMAIL_QUEUE = 'email';

/** Jobs placed on the BullMQ `email` queue by the API and sent by the worker. */
export type EmailJob =
  | { template: 'verifyEmail'; to: string; locale: Locale; vars: { code: string; minutes: number } }
  | { template: 'passwordReset'; to: string; locale: Locale; vars: { code: string; minutes: number } }
  /** FR-2.2.2: the admin approved the employer account. */
  | { template: 'employerApproved'; to: string; locale: Locale; vars: { name: string; link: string } }
  /** FR-2.2.2: the admin rejected it; the reason is optional. */
  | { template: 'employerRejected'; to: string; locale: Locale; vars: { name: string; reason: string | null } }
  /**
   * FR-2.3.3: a seeker expressed interest in the employer's job. Carries only the job title and
   * a link to the applicants page: never the seeker's ID number, dar or fakhdh.
   */
  | { template: 'newInterest'; to: string; locale: Locale; vars: { jobTitle: string; link: string } };

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
