import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadConfig } from './config/app-config';
import { QuietLogger } from './common/quiet-logger';

export async function startApi(): Promise<void> {
  const config = loadConfig(process.env, { generateMissingSecrets: true });
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: new QuietLogger() });
  configureApp(app);
  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on :${config.port} (prefix /api)`);
}

if (require.main === module) {
  startApi().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
