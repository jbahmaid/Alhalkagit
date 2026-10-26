import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { renderEmail } from './email-templates';
import { EMAIL_QUEUE, EMAIL_SENDER, EmailJob, EmailSender } from './email.types';

/** Worker side: consumes the `email` queue. */
@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger('EmailProcessor');

  constructor(@Inject(EMAIL_SENDER) private readonly sender: EmailSender) {
    super();
  }

  async process(job: Job<EmailJob>): Promise<void> {
    const message = renderEmail(job.data);
    await this.sender.send(message);
    this.logger.log(`Job ${job.id} (${job.name}) done`);
  }
}
