import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EMAIL_QUEUE, EmailJob } from './email.types';

/** API side: puts emails on the queue; the worker renders and sends them. */
@Injectable()
export class EmailQueueService {
  constructor(@InjectQueue(EMAIL_QUEUE) private readonly queue: Queue<EmailJob>) {}

  async enqueue(job: EmailJob): Promise<void> {
    await this.queue.add(job.template, job, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }
}
