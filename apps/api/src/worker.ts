import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';
import { QuietLogger } from './common/quiet-logger';
import { EmailProcessor } from './notifications/email.processor';

/** Touched every few seconds while the queue consumer runs; the compose healthcheck reads it. */
export const WORKER_HEARTBEAT_FILE = '/tmp/worker-heartbeat';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: new QuietLogger() });
  app.enableShutdownHooks();
  const processor = app.get(EmailProcessor);
  const beat = () => {
    if (!processor.worker.isRunning()) return;
    try {
      writeFileSync(WORKER_HEARTBEAT_FILE, String(Date.now()));
    } catch {
      // the healthcheck simply fails; nothing else depends on the file
    }
  };
  beat();
  setInterval(beat, 5000).unref();
  new Logger('Worker').log('Worker started: consuming the email queue');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
